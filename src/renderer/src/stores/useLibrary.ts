import { create } from 'zustand'
import type { Book } from '@shared/types'

interface LibraryState {
  books: Book[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useLibrary = create<LibraryState>((set, get) => ({
  books: [],
  loading: true,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const books = await window.api.library.list()
      // 最近讀過的排前面，沒讀過的依加入時間
      books.sort((a, b) => (b.lastReadAt ?? b.addedAt).localeCompare(a.lastReadAt ?? a.addedAt))
      set({ books, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  remove: async (id) => {
    await window.api.library.remove(id)
    await get().refresh()
  }
}))
