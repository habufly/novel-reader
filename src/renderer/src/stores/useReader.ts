import { create } from 'zustand'
import type { Book, ChapterMeta, ReadingPosition } from '@shared/types'

/**
 * 同時掛載在 DOM 裡的章節數上限。
 * 太小會在章節交界頻繁增刪造成閃動，太大則讓 DOM 無限膨脹。
 * 一章約 200 個段落，五章一千個元素，瀏覽器處理起來還很輕鬆。
 */
const MOUNT_LIMIT = 5

interface ReaderState {
  book: Book | null
  chapters: ChapterMeta[]
  /** 章節內文快取。整本約 8MB，直接全留不做淘汰 */
  texts: Record<number, string>
  /** 目前掛載的章節編號，必定連續 */
  mounted: number[]
  current: ReadingPosition
  /** 待套用的捲動目標；ChapterFlow 定位完成後清掉 */
  pendingScroll: ReadingPosition | null
  loading: boolean
  /** 防止捲動事件連續觸發重複載入 */
  extending: boolean

  open: (book: Book, start?: ReadingPosition) => Promise<void>
  close: () => void
  extend: (dir: 1 | -1) => Promise<void>
  jumpTo: (chapterId: number) => Promise<void>
  setCurrent: (pos: ReadingPosition) => void
  clearPendingScroll: () => void
}

async function fetchText(bookId: string, id: number): Promise<string> {
  return window.api.book.chapter(bookId, id)
}

export const useReader = create<ReaderState>((set, get) => ({
  book: null,
  chapters: [],
  texts: {},
  mounted: [],
  current: { chapterId: 0, charOffset: 0 },
  pendingScroll: null,
  loading: false,
  extending: false,

  open: async (book, start) => {
    set({ book, loading: true, texts: {}, mounted: [], chapters: [] })
    const { chapters } = await window.api.book.index(book.id)
    const at = start ?? { chapterId: 0, charOffset: 0 }
    const first = Math.min(Math.max(at.chapterId, 0), chapters.length - 1)
    const text = await fetchText(book.id, first)
    set({
      chapters,
      texts: { [first]: text },
      mounted: [first],
      current: { chapterId: first, charOffset: at.charOffset },
      pendingScroll: { chapterId: first, charOffset: at.charOffset },
      loading: false
    })
    // 先把相鄰章拉進快取，捲到交界時才不用等 IPC
    void prefetch(book.id, [first - 1, first + 1], chapters.length, set, get)
  },

  close: () => set({ book: null, chapters: [], texts: {}, mounted: [], pendingScroll: null }),

  extend: async (dir) => {
    const { book, chapters, mounted, texts, extending } = get()
    if (!book || extending || mounted.length === 0) return

    const next = dir === 1 ? mounted[mounted.length - 1]! + 1 : mounted[0]! - 1
    if (next < 0 || next >= chapters.length) return

    set({ extending: true })
    try {
      const text = texts[next] ?? (await fetchText(book.id, next))
      const now = get().mounted
      // 等待 IPC 期間可能已經跳章，掛載清單變了就放棄這次結果
      if (dir === 1 ? now[now.length - 1] !== next - 1 : now[0] !== next + 1) return

      let list = dir === 1 ? [...now, next] : [next, ...now]
      // 超出上限就從遠端那頭砍掉，維持連續且有界
      if (list.length > MOUNT_LIMIT) list = dir === 1 ? list.slice(1) : list.slice(0, -1)

      set({ texts: { ...get().texts, [next]: text }, mounted: list })
      void prefetch(book.id, [list[0]! - 1, list[list.length - 1]! + 1], chapters.length, set, get)
    } finally {
      set({ extending: false })
    }
  },

  jumpTo: async (chapterId) => {
    const { book, chapters } = get()
    if (!book) return
    const id = Math.min(Math.max(chapterId, 0), chapters.length - 1)
    const text = get().texts[id] ?? (await fetchText(book.id, id))
    set({
      texts: { ...get().texts, [id]: text },
      mounted: [id],
      current: { chapterId: id, charOffset: 0 },
      pendingScroll: { chapterId: id, charOffset: 0 }
    })
    void prefetch(book.id, [id - 1, id + 1], chapters.length, set, get)
  },

  setCurrent: (pos) => set({ current: pos }),
  clearPendingScroll: () => set({ pendingScroll: null })
}))

/** 背景把相鄰章塞進快取，不影響掛載狀態 */
async function prefetch(
  bookId: string,
  ids: number[],
  total: number,
  set: (partial: Partial<ReaderState>) => void,
  get: () => ReaderState
): Promise<void> {
  for (const id of ids) {
    if (id < 0 || id >= total || get().texts[id] !== undefined) continue
    try {
      const text = await fetchText(bookId, id)
      if (get().book?.id !== bookId) return // 已經換書了
      set({ texts: { ...get().texts, [id]: text } })
    } catch {
      // 預取失敗不影響閱讀，真正需要時 extend 會再抓一次
    }
  }
}
