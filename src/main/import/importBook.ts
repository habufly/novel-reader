import { readFile, writeFile, mkdir, open } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  ChapterMeta,
  FilePreview,
  ImportProgress,
  ImportResult
} from '@shared/types'
import { decode, detectEncoding, replacementRatio } from './encoding'
import { cleanup } from './textCleanup'
import { splitChapters } from './chapterSplitter'
import { extractMeta } from './metadata'
import {
  bookDir,
  contentFile,
  newBookId,
  progressFile,
  saveBook,
  writeIndex
} from '../storage/library'
import { writeJson } from '../storage/jsonStore'

export type ProgressFn = (p: ImportProgress) => void

const PREVIEW_BYTES = 64 * 1024
const PREVIEW_CHARS = 1200

/**
 * 匯入前的預覽：偵測編碼並解一小段出來。
 * 匯入對話框用它顯示內文與亂碼比例，讓使用者在 Big5／GB18030 誤判時能手動改。
 */
export async function previewFile(path: string, encoding?: string): Promise<FilePreview> {
  const full = await readFile(path)
  const guess = encoding
    ? { encoding, source: 'manual' as const, confidence: 1, candidates: [] as string[] }
    : detectEncoding(full)

  // 預覽只解開頭，但編碼偵測要看全檔才準
  const head = full.subarray(0, PREVIEW_BYTES)
  const sample = decode(head, guess.encoding).slice(0, PREVIEW_CHARS)

  return {
    path,
    fileName: basename(path),
    bytes: full.length,
    guess: { ...guess, candidates: guess.candidates.length ? guess.candidates : detectEncoding(full).candidates },
    sample,
    replacementRatio: replacementRatio(sample)
  }
}

export async function importBook(
  path: string,
  encoding: string | undefined,
  onProgress: ProgressFn
): Promise<ImportResult> {
  const fileName = basename(path)
  const report = (stage: ImportProgress['stage'], percent: number): void =>
    onProgress({ fileName, stage, percent })

  report('reading', 0)
  const raw = await readFile(path)

  report('decoding', 15)
  const enc = encoding ?? detectEncoding(raw).encoding
  const text = decode(raw, enc)

  report('cleaning', 35)
  const { lines, junkLines } = cleanup(text)

  report('splitting', 55)
  const { chapters, report: splitReport } = splitChapters(lines, junkLines)
  const meta = extractMeta(lines, path)

  report('writing', 75)
  const id = newBookId()
  await mkdir(bookDir(id), { recursive: true })

  // 全書寫成單一正規化檔，索引記位元組範圍。
  // 比一章一個檔好：少了近千個小檔案，讀單章時直接 seek 該範圍即可。
  const parts: Buffer[] = []
  const metas: ChapterMeta[] = []
  let offset = 0
  let charCount = 0

  chapters.forEach((c, chapterId) => {
    const body = c.paragraphs.join('\n')
    const bodyBytes = Buffer.byteLength(body, 'utf-8')
    metas.push({
      id: chapterId,
      title: c.title,
      charCount: body.length,
      byteStart: offset,
      byteEnd: offset + bodyBytes
    })
    parts.push(Buffer.from(`${body}\n`, 'utf-8'))
    offset += bodyBytes + 1
    charCount += body.length
  })

  await writeFile(contentFile(id), Buffer.concat(parts))
  writeIndex(id, { chapters: metas })

  const book = {
    id,
    title: meta.title,
    author: meta.author,
    sourcePath: path,
    encoding: enc,
    chapterCount: metas.length,
    charCount,
    addedAt: new Date().toISOString()
  }
  saveBook(book)

  // 進度檔先建好，Phase 3 的自動書籤直接往上寫
  writeJson(progressFile(id), {
    current: { chapterId: 0, charOffset: 0, updatedAt: new Date().toISOString() },
    history: [],
    bookmarks: [],
    readChapters: []
  })

  report('done', 100)
  return { book, report: splitReport }
}

/** 依索引記錄的位元組範圍讀出單章內文 */
export async function readChapter(id: string, meta: ChapterMeta): Promise<string> {
  const fh = await open(contentFile(id), 'r')
  try {
    const len = meta.byteEnd - meta.byteStart
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, meta.byteStart)
    return buf.toString('utf-8')
  } finally {
    await fh.close()
  }
}
