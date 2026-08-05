import type { BookProgress, ReadingPosition } from '@shared/types'
import { getBook, progressFile, readIndex, saveBook } from './library'
import { readJson, writeJson } from './jsonStore'

function emptyProgress(): BookProgress {
  return {
    current: { chapterId: 0, charOffset: 0, updatedAt: new Date().toISOString() },
    history: [],
    bookmarks: [],
    readChapters: []
  }
}

export function loadProgress(bookId: string): BookProgress {
  return { ...emptyProgress(), ...readJson<Partial<BookProgress>>(progressFile(bookId), {}) }
}

/**
 * 換算整本進度百分比。
 * 在主行程算是因為這裡才拿得到章節索引，算完直接寫進書櫃索引，
 * 書櫃畫面就不必為了顯示一條進度條而逐本開啟進度檔。
 */
function overallPercent(bookId: string, pos: ReadingPosition): number {
  const { chapters } = readIndex(bookId)
  if (!chapters.length) return 0
  let before = 0
  for (let i = 0; i < pos.chapterId && i < chapters.length; i++) before += chapters[i]!.charCount
  const total = chapters.reduce((n, c) => n + c.charCount, 0)
  if (!total) return 0
  return Math.min(100, ((before + pos.charOffset) / total) * 100)
}

export function saveProgress(bookId: string, patch: Partial<BookProgress>): BookProgress {
  const next = { ...loadProgress(bookId), ...patch }
  writeJson(progressFile(bookId), next)

  const book = getBook(bookId)
  if (book) {
    saveBook({
      ...book,
      lastReadAt: new Date().toISOString(),
      progressPercent: overallPercent(bookId, next.current)
    })
  }
  return next
}
