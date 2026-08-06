import { create } from 'zustand'
import type {
  Book,
  Bookmark,
  ChapterMeta,
  HistoryEntry,
  ReadingPosition
} from '@shared/types'

/**
 * 同時掛載在 DOM 裡的章節數上限。
 * 太小會在章節交界頻繁增刪造成閃動，太大則讓 DOM 無限膨脹。
 * 一章約 200 個段落，五章一千個元素，瀏覽器處理起來還很輕鬆。
 */
const MOUNT_LIMIT = 5

/** 讀到整章的這個比例就算讀過 */
const READ_THRESHOLD = 0.9

/** 跳轉歷史保留筆數 */
const HISTORY_LIMIT = 20

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

  readChapters: Set<number>
  bookmarks: Bookmark[]
  history: HistoryEntry[]
  /** 上次寫入磁碟的位置，用來略過沒有變動的儲存 */
  savedAt: ReadingPosition | null

  open: (book: Book) => Promise<void>
  close: () => void
  extend: (dir: 1 | -1) => Promise<void>
  jumpTo: (chapterId: number, charOffset?: number, opts?: { recordHistory?: boolean }) => Promise<void>
  goBack: () => Promise<void>
  setCurrent: (pos: ReadingPosition) => void
  clearPendingScroll: () => void

  addBookmark: (note?: string) => Promise<void>
  removeBookmark: (id: string) => Promise<void>
  persist: (opts?: { flush?: boolean; force?: boolean }) => void
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
  readChapters: new Set(),
  bookmarks: [],
  history: [],
  savedAt: null,

  open: async (book) => {
    set({
      book,
      loading: true,
      texts: {},
      mounted: [],
      chapters: [],
      readChapters: new Set(),
      bookmarks: [],
      history: [],
      savedAt: null
    })

    const [{ chapters }, progress] = await Promise.all([
      window.api.book.index(book.id),
      window.api.progress.get(book.id)
    ])

    // 需求 1：開書就回到上次讀到的地方
    const at = progress.current
    const first = Math.min(Math.max(at.chapterId, 0), chapters.length - 1)
    const text = await fetchText(book.id, first)

    set({
      chapters,
      texts: { [first]: text },
      mounted: [first],
      current: { chapterId: first, charOffset: at.charOffset },
      pendingScroll: { chapterId: first, charOffset: at.charOffset },
      readChapters: new Set(progress.readChapters),
      bookmarks: progress.bookmarks,
      history: progress.history,
      savedAt: { chapterId: first, charOffset: at.charOffset },
      loading: false
    })
    void prefetch(book.id, [first - 1, first + 1], chapters.length, set, get)
  },

  close: () => {
    get().persist({ force: true })
    set({
      book: null,
      chapters: [],
      texts: {},
      mounted: [],
      pendingScroll: null,
      readChapters: new Set(),
      bookmarks: [],
      history: []
    })
  },

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

  jumpTo: async (chapterId, charOffset = 0, opts) => {
    const { book, chapters, current, history } = get()
    if (!book) return
    const id = Math.min(Math.max(chapterId, 0), chapters.length - 1)

    // 跳轉前把舊位置壓進歷史，Alt+← 才能回得去。
    // 朗讀自動連播會關掉這個行為，否則歷史很快就被連續章節塞滿。
    const record = opts?.recordHistory !== false
    const entry: HistoryEntry = { ...current, at: new Date().toISOString() }
    const text = get().texts[id] ?? (await fetchText(book.id, id))

    set({
      texts: { ...get().texts, [id]: text },
      mounted: [id],
      current: { chapterId: id, charOffset },
      pendingScroll: { chapterId: id, charOffset },
      history: record ? [entry, ...history].slice(0, HISTORY_LIMIT) : history
    })
    get().persist({ force: true })
    void prefetch(book.id, [id - 1, id + 1], chapters.length, set, get)
  },

  goBack: async () => {
    const { history } = get()
    const prev = history[0]
    if (!prev) return
    set({ history: history.slice(1) })
    // 直接定位，不要再壓一筆歷史進去，否則會在兩點之間來回彈跳
    const { book, chapters } = get()
    if (!book) return
    const id = Math.min(Math.max(prev.chapterId, 0), chapters.length - 1)
    const text = get().texts[id] ?? (await fetchText(book.id, id))
    set({
      texts: { ...get().texts, [id]: text },
      mounted: [id],
      current: { chapterId: id, charOffset: prev.charOffset },
      pendingScroll: { chapterId: id, charOffset: prev.charOffset }
    })
    get().persist({ force: true })
    void prefetch(book.id, [id - 1, id + 1], chapters.length, set, get)
  },

  setCurrent: (pos) => {
    const { chapters, readChapters } = get()
    const meta = chapters[pos.chapterId]
    let read = readChapters
    if (
      meta &&
      meta.charCount > 0 &&
      pos.charOffset >= meta.charCount * READ_THRESHOLD &&
      !readChapters.has(pos.chapterId)
    ) {
      read = new Set(readChapters).add(pos.chapterId)
    }
    set({ current: pos, readChapters: read })
  },

  clearPendingScroll: () => set({ pendingScroll: null }),

  addBookmark: async (note = '') => {
    const { book, current, texts, bookmarks } = get()
    if (!book) return

    // 有選取文字就用選取的，否則取目前位置往後的一小段當摘錄
    const selected = window.getSelection()?.toString().trim()
    const body = texts[current.chapterId] ?? ''
    const excerpt = (selected || body.slice(current.charOffset, current.charOffset + 60))
      .replace(/\s+/g, ' ')
      .trim()

    const mark: Bookmark = {
      id: `bm_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      chapterId: current.chapterId,
      charOffset: current.charOffset,
      excerpt,
      note,
      createdAt: new Date().toISOString()
    }
    const next = [mark, ...bookmarks]
    set({ bookmarks: next })
    await window.api.progress.save(book.id, { bookmarks: next })
  },

  removeBookmark: async (id) => {
    const { book, bookmarks } = get()
    if (!book) return
    const next = bookmarks.filter((b) => b.id !== id)
    set({ bookmarks: next })
    await window.api.progress.save(book.id, { bookmarks: next })
  },

  /**
   * 需求 1 的落地點。呼叫時機由 Reader 決定：捲動停止、換章、
   * 視窗失焦、每 30 秒、關閉前，五個時機都會進到這裡。
   */
  persist: ({ flush = false, force = false } = {}) => {
    const { book, current, savedAt, readChapters, history } = get()
    if (!book) return
    if (
      !force &&
      savedAt &&
      savedAt.chapterId === current.chapterId &&
      savedAt.charOffset === current.charOffset
    ) {
      return // 位置沒動就不用重複寫檔
    }

    const patch = {
      current: { ...current, updatedAt: new Date().toISOString() },
      readChapters: [...readChapters],
      history
    }
    set({ savedAt: current })

    if (flush) window.api.progress.flush(book.id, patch)
    else void window.api.progress.save(book.id, patch)
  }
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
