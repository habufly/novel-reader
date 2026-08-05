import { basename, extname } from 'node:path'

export interface BookMeta {
  title: string
  author?: string
}

/** 『書名/作者:某某』——常見於電子書網站匯出的檔頭 */
const BRACKET_HEAD = /^[『「【]\s*([^/／\]』」】]{1,60})\s*[/／]\s*作\s*者\s*[:：]\s*([^』」】]{1,40})/
const AUTHOR_LINE = /^作\s*者\s*[:：]\s*(.{1,40})$/
const SKIP_LINE = /^(簡介|简介|內容簡介|内容简介|狀態|状态|標籤|标签|分類|分类)\s*[:：]?/

/**
 * 從檔頭前幾行猜書名與作者。猜不到就退回檔名 ——
 * 這只是顯示用的標籤，猜錯不影響閱讀，之後可以讓使用者改。
 */
export function extractMeta(lines: string[], filePath: string): BookMeta {
  const fallback = basename(filePath, extname(filePath))
  const head = lines.slice(0, 20)

  let title: string | undefined
  let author: string | undefined

  for (const line of head) {
    const b = BRACKET_HEAD.exec(line)
    if (b) {
      title ??= b[1]!.trim()
      author ??= b[2]!.trim()
      break
    }
  }

  if (!author) {
    for (const line of head) {
      const a = AUTHOR_LINE.exec(line)
      if (a) {
        author = a[1]!.trim()
        break
      }
    }
  }

  if (!title) {
    // 第一行若是短句且不是欄位標籤，通常就是書名
    const first = head[0]?.trim()
    if (first && first.length <= 60 && !SKIP_LINE.test(first) && !AUTHOR_LINE.test(first)) {
      title = first.replace(/^[『「【]|[』」】]$/g, '').trim()
    }
  }

  return { title: title || fallback, author }
}
