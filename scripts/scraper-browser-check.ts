import { app } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { BrowserPageLoader } from '../src/main/scraper/browserLoader'
import { ScraperEngine, builtinProfiles, parseCatalog, parseChapter } from 'novel-scraper-core'

app.setName('novel-scraper-browser-check')
void app.whenReady().then(async () => {
  const loader = new BrowserPageLoader({ partition: 'scraper-test', timeoutMs: 1600, showVerification: false })
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (req.url === '/wait') { res.end('<title>Just a moment...</title>'); return }
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'https://not-allowed.invalid/' }); res.end(); return }
    if (req.url === '/book') { res.setHeader('Set-Cookie', 'testcookie=present; Path=/'); res.end('<h1>測試書</h1><a class="chapter" href="/chapter">第1章 測試</a>'); return }
    const n = String(Date.now())
    res.end(`<h1>第1章 測試</h1><main id="body">${n} ${req.headers.cookie ?? ''} require=<script>document.write(typeof require)</script><br>正文完整保留，網址 https://example.com 也是正文。</main>`)
  })
  const profile = { id: 'test', name: '測試', hosts: ['127.0.0.1'], bookTitle: 'h1', chapterLinks: 'a.chapter', chapterTitle: 'h1', chapterBody: '#body', minBodyLength: 15, transport: 'browser' as const }
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await loader.load(`${base}/book`, { profile, kind: 'catalog' })
    const first = await loader.load(`${base}/chapter`, { profile, kind: 'chapter' })
    const second = await loader.load(`${base}/chapter`, { profile, kind: 'chapter' })
    assert.notEqual(first, second, '重複網址不得回傳前一次 DOM')
    assert.match(second, /testcookie=present/, '同一網站瀏覽器應保留自己的 Cookie')
    assert.match(parseChapter(second, profile).body, /require=undefined/, '遠端網頁不得存取 Node.js')
    assert.match(second, /https:\/\/example.com/, '正文網址應保留')
    const controller = new AbortController()
    const pending = loader.load(`${base}/wait`, { profile, kind: 'chapter', signal: controller.signal })
    setTimeout(() => controller.abort(), 80)
    await assert.rejects(pending)
    await assert.rejects(loader.load(`${base}/wait`, { profile, kind: 'chapter' }), /尚未提供可讀取/)
    await assert.rejects(loader.load('https://not-allowed.invalid/', { profile, kind: 'chapter' }), /不符合/)
    console.log('PASS: isolated browser cookies, no Node access, fresh DOM, cancellation, and challenge rejection')

    if (process.argv.includes('--live')) {
      const live = new BrowserPageLoader({ partition: 'scraper-czbooks-live-test', timeoutMs: 90000 })
      try {
        const p = builtinProfiles.find(p => p.id === 'czbooks')!
        const catalogUrl = 'https://czbooks.net/n/s6p7h2'
        const html = await live.load(catalogUrl, { profile: p, kind: 'catalog' })
        const catalog = parseCatalog(html, catalogUrl, p)
        const chapter = parseChapter(await live.load(catalog.chapters[0]!.url, { profile: p, kind: 'chapter' }), p)
        console.log(JSON.stringify({ live: 'PASS', title: catalog.title, total: catalog.chapters.length, firstTitle: chapter.title, bodyCharacters: chapter.body.length }))
        const dataArgument = process.argv.find(a => a.startsWith('--job-data='))
        if (dataArgument) {
          const engine = new ScraperEngine(dataArgument.slice('--job-data='.length), { browserLoader: (url, context) => live.load(url, context) })
          const result = await engine.run({ url: catalogUrl, limit: 2, cleaning: 'conservative' })
          assert.equal(result.state, 'sample_complete')
          assert.equal(result.completed, 2)
          assert.ok(result.rawOutput && result.cleanedOutput)
          console.log(JSON.stringify({ pipeline: 'PASS', completed: result.completed, gaps: result.gaps, rawOutput: result.rawOutput, cleanedOutput: result.cleanedOutput }))
        }
      } finally { live.dispose() }
    }
    // Ensure the exported engine can use this implementation's transport signature.
    const engine = new ScraperEngine('.', { browserLoader: (url, context) => loader.load(url, context) })
    assert.ok((await engine.profiles()).some(p => p.id === 'czbooks'))
    process.exitCode = 0
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { loader.dispose(); server.close(); app.exit(Number(process.exitCode ?? 0)) }
})
