import { app } from 'electron'
import { readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { importBook, readChapter } from './import/importBook'
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
    say(`  切分: ${report.strategy}${report.unit ? ` 依「${report.unit}」` : ''}`)
    say(`  候選 ${report.candidates} → 採用 ${report.accepted}，剔除 ${report.rejectedOutOfOrder}，特殊章 ${report.specials}`)
    say(`  單位競爭: ${report.unitScores.map((u) => `${u.unit}(命中${u.candidates}/序列${u.longestRun})`).join(' ')}`)
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

    if (options.keep) say(`  已保留於書櫃: ${book.id}`)
    else await removeBook(book.id)
  }

  say('='.repeat(70))
  say(failures === 0 ? '全部通過' : `${failures} 項失敗`)

  writeFileSync(join(app.getPath('userData'), 'selftest.log'), lines.join('\n'), 'utf-8')
  return failures === 0 ? 0 : 1
}
