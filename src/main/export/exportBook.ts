import { writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import type { ExportResult } from '@shared/types'
import { contentFile, getBook, readIndex } from '../storage/library'

/**
 * 把整理好的內容匯出成一個 UTF-8 的 TXT。
 *
 * 匯出的不是「原始檔換個編碼」，而是這個 app 處理過的成果：正確解碼、
 * 章節切分、雜訊清理、以及精校結果都在裡面。使用者拿去手機閱讀器或
 * 編輯器開，看到的會是乾淨版本。原始檔案自始至終不會被改動。
 */

/** 段首縮排。純文字閱讀器沒有 CSS，縮排得寫進內容裡才看得出段落 */
const INDENT = '　　'

/**
 * 換行用 CRLF、開頭加 BOM。
 *
 * 這兩個都是為了「在別的程式開得正確」——使用者的來源檔多半是 GBK，
 * 在其他工具裡常被誤判成亂碼。BOM 讓 Windows 上的記事本、Word 之類
 * 直接確定是 UTF-8，不必再猜。
 */
const EOL = '\r\n'
const BOM = '﻿'

export async function exportBookText(id: string, target: string): Promise<ExportResult> {
  const book = getBook(id)
  if (!book) throw new Error('找不到這本書')

  const { chapters } = readIndex(id)
  const buf = await readFile(contentFile(id))

  const parts: string[] = [BOM, book.title, EOL]
  if (book.author) parts.push(`作者：${book.author}`, EOL)
  parts.push(EOL)

  for (const c of chapters) {
    parts.push(c.title, EOL, EOL)
    const body = buf.subarray(c.byteStart, c.byteEnd).toString('utf-8')
    for (const line of body.split('\n')) {
      if (!line) continue
      parts.push(INDENT, line, EOL)
    }
    parts.push(EOL)
  }

  const text = parts.join('')
  const bytes = Buffer.from(text, 'utf-8')
  await writeFile(target, bytes)

  return { path: target, bytes: bytes.length, chapters: chapters.length }
}

/** 檔名不能含 Windows 保留字元，書名常常有「：」「？」 */
export function safeFileName(title: string): string {
  return `${title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80).trim() || '未命名'}.txt`
}
