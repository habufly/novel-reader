import assert from 'node:assert/strict';
import { cleanup } from '../src/main/import/textCleanup.ts';

const prose = [
  '她收到 https://example.com 的網址。',
  'www.example.com 是故事中的線索。',
  'PS：這是角色寫的筆記。',
  '更多電子書值得分享，角色如此說。',
  '————',
  '普通正文。',
];
assert.deepEqual(cleanup(prose.join('\r\n')).lines, prose);
assert.equal(cleanup(prose.join('\n')).junkLines, 0);
console.log('Import preserves URLs, notes, promotional-looking dialogue, and separators.');
