import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'novel-browser-check-'));
try {
  const output = path.join(temp, 'check.cjs');
  await build({entryPoints:[path.join(root,'scripts/scraper-browser-check.ts')],outfile:output,bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'warning'});
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [output, ...process.argv.slice(2)], {stdio:'inherit',env,windowsHide:true});
    child.on('error',reject);child.on('exit',code=>resolve(code??1));
  });
} finally {
  if (path.dirname(temp) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('novel-browser-check-')) throw new Error('Invalid temporary test directory');
  await fs.rm(temp,{recursive:true,force:true});
}
