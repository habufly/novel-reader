import { app } from 'electron'
import { readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { importBook, readChapter } from './import/importBook'
import { exportBookText } from './export/exportBook'
import { readIndex, removeBook } from './storage/library'

/**
 * 匯入管線的煙霧測試。用真實小說檔跑完整流程，驗證編碼偵測、章節切分、
 * 寫檔與位元組範圍回讀，最後把測試產生的資料清掉。
 *
 * 由 `npm run selftest` 觸發。解析規則很吃真實資料的樣貌，
 * 之後加新格式或調正規表示式時，這支可以立刻看出有沒有退步。
 */
export interface SelfTestOptions {
  /** 保留匯入結果而不清除，方便灌測試資料進書櫃 */
  keep: boolean
}

export async function runSelfTest(argPaths: string[], options: SelfTestOptions): Promise<number> {
  const targets = argPaths.length
    ? argPaths.map((p) => resolve(p))
    : (() => {
        const dir = resolve('docs')
        try {
          return readdirSync(dir)
            .filter((f) => f.toLowerCase().endsWith('.txt'))
            .map((f) => join(dir, f))
        } catch {
          return []
        }
      })()

  if (!targets.length) {
    console.log('沒有找到測試檔案。用法: npm run selftest -- <檔案路徑…>（預設讀 docs/*.txt）')
    return 1
  }

  const lines: string[] = []
  const say = (s: string): void => {
    console.log(s)
    lines.push(s)
  }

  let failures = 0

  for (const path of targets) {
    say('='.repeat(70))
    say(path)
    const bytes = statSync(path).size
    const t0 = Date.now()

    const { book, report } = await importBook(path, undefined, () => {})
    const elapsed = Date.now() - t0

    say(`  ${(bytes / 1024 / 1024).toFixed(2)} MB → ${elapsed}ms`)
    say(`  書名: ${book.title}${book.author ? ` / ${book.author}` : ''}`)
    say(`  編碼: ${book.encoding}`)
    say(`  切分: ${report.strategy}${report.unit ? ` 依「${report.unit}」` : ''}${report.volumes > 1 ? `，${report.volumes} 卷` : ''}`)
    say(`  候選 ${report.candidates} → 採用 ${report.accepted}，剔除 ${report.rejectedOutOfOrder}，特殊章 ${report.specials}`)
    say(`  單位競爭: ${report.unitScores.map((u) => `${u.unit}(命中${u.candidates}/採用${u.accepted})`).join(' ')}`)
    say(`  雜訊行: ${report.junkLines}`)
    say(`  總計 ${book.chapterCount} 章 / ${book.charCount} 字`)

    const index = readIndex(book.id)
    const check = (label: string, ok: boolean, detail = ''): void => {
      if (!ok) failures++
      say(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
    }

    check('索引章數與書籍記錄一致', index.chapters.length === book.chapterCount)
    check('沒有空章', index.chapters.every((c) => c.charCount > 0),
      `最小 ${Math.min(...index.chapters.map((c) => c.charCount))} 字`)
    check('位元組範圍遞增且不重疊',
      index.chapters.every((c, i) => i === 0 || c.byteStart > index.chapters[i - 1]!.byteEnd))

    /**
     * 超大章節就是切分失敗的信號 —— 一整段內容沒被切開才會變這麼大。
     * 《赤心巡天》曾經有 323 萬字擠在同一章（半本書），但因為當時沒有這項
     * 檢查，selftest 全綠卻沒人發現。門檻放寬到 10 萬字，正常長章不會誤報。
     */
    const largest = index.chapters.reduce((a, c) => (c.charCount > a.charCount ? c : a))
    check(
      '沒有異常巨大的章節',
      largest.charCount < 100_000,
      `最大 ${largest.charCount} 字（${largest.title.slice(0, 20)}）`
    )

    // 抽首、中、尾三章回讀，確認 seek 範圍沒有切到多位元組字元中間
    const probes = [0, Math.floor(index.chapters.length / 2), index.chapters.length - 1]
    for (const id of probes) {
      const meta = index.chapters[id]!
      const body = await readChapter(book.id, meta)
      check(
        `第 ${id} 章回讀字數相符`,
        body.length === meta.charCount,
        `期望 ${meta.charCount} 實得 ${body.length}`
      )
      check(`第 ${id} 章無替換字元`, !body.includes('�'))
    }

    say(`  首章: ${index.chapters[0]?.title}`)
    say(`  次章: ${index.chapters[1]?.title}`)
    say(`  末章: ${index.chapters.at(-1)?.title}`)

    // --- 匯出：格式檢查 + 來回轉換 ---
    const exported = join(app.getPath('temp'), `nr-export-${book.id}.txt`)
    const out = await exportBookText(book.id, exported)
    const raw = readFileSync(exported)
    const text = raw.toString('utf-8')

    check('匯出檔有 UTF-8 BOM', raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
    check('匯出檔使用 CRLF 換行', text.includes('\r\n') && !/[^\r]\n/.test(text.slice(0, 100_000)))
    // 用行集合比對而不是逐個 includes：後者是 2777 × 20MB 的掃描，
    // 七本連跑會把記憶體與時間吃光（實測會讓整個行程掛掉）
    const exportedLines = new Set(text.split('\r\n'))
    check('匯出檔含全部章節標題',
      index.chapters.every((c) => exportedLines.has(c.title)),
      `${out.chapters} 章 / ${(out.bytes / 1024 / 1024).toFixed(1)} MB`)

    /**
     * 來回轉換：把匯出的檔案再匯入一次。
     *
     * 檢查的是「內容守恆」而不是「章數相同」。純文字格式沒有辦法保證
     * 重新解析後的分章完全一致 —— 有些書的標題超過 40 字（會被當成正文），
     * 有些書有兩章標題文字一模一樣（合併成一章）。那些情況下文字仍然
     * 全部都在，只是換了個歸屬。真正不能接受的是內容變少。
     *
     * 所以比的是「內文 + 標題」的總字數：不論某一行被歸為標題還是正文，
     * 都會被算進去。
     */
    const round = await importBook(exported, undefined, () => {})
    const roundIndex = readIndex(round.book.id)
    const sumTitles = (cs: typeof index.chapters): number =>
      cs.reduce((n, c) => n + c.title.length, 0)
    const before = book.charCount + sumTitles(index.chapters)
    const after = round.book.charCount + sumTitles(roundIndex.chapters)

    check(
      '匯出後重新匯入內容守恆',
      Math.abs(after - before) <= Math.max(200, before * 0.0005),
      `${before} → ${after}（差 ${after - before}）`
    )
    say(`  匯出回讀章數: ${book.chapterCount} → ${round.book.chapterCount}`)
    say('  匯出格式前 7 行:')
    for (const l of text.replace(/^﻿/, '').split('\r\n').slice(0, 7)) {
      say(`    ${JSON.stringify(l.slice(0, 40))}`)
    }

    await removeBook(round.book.id)
    rmSync(exported, { force: true })

    if (options.keep) say(`  已保留於書櫃: ${book.id}`)
    else await removeBook(book.id)
  }

  say('='.repeat(70))
  say(failures === 0 ? '全部通過' : `${failures} 項失敗`)

  writeFileSync(join(app.getPath('userData'), 'selftest.log'), lines.join('\n'), 'utf-8')
  return failures === 0 ? 0 : 1
}
