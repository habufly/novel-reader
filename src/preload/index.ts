import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  Book,
  BookIndex,
  BookProgress,
  FilePreview,
  ImportProgress,
  ImportResult,
  ReaderSettings
} from '@shared/types'

/**
 * renderer 唯一能碰到主行程的入口。這裡只暴露明確列出的方法，
 * 不把 ipcRenderer 整個丟出去 —— 否則 contextIsolation 等於白開。
 */
const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

  library: {
    list: (): Promise<Book[]> => ipcRenderer.invoke('library:list'),
    pickFiles: (): Promise<string[]> => ipcRenderer.invoke('library:pickFiles'),
    preview: (path: string, encoding?: string): Promise<FilePreview> =>
      ipcRenderer.invoke('library:preview', path, encoding),
    import: (path: string, encoding?: string): Promise<ImportResult> =>
      ipcRenderer.invoke('library:import', path, encoding),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('library:remove', id),
    revealSource: (path: string): Promise<void> =>
      ipcRenderer.invoke('library:revealSource', path),

    /** 回傳取消訂閱函式，元件卸載時務必呼叫，否則重複掛載會累積監聽器 */
    onImportProgress: (fn: (p: ImportProgress) => void): (() => void) => {
      const handler = (_e: unknown, p: ImportProgress): void => fn(p)
      ipcRenderer.on('library:importProgress', handler)
      return () => ipcRenderer.off('library:importProgress', handler)
    }
  },

  book: {
    index: (id: string): Promise<BookIndex> => ipcRenderer.invoke('book:index', id),
    chapter: (id: string, chapterId: number): Promise<string> =>
      ipcRenderer.invoke('book:chapter', id, chapterId)
  },

  progress: {
    get: (bookId: string): Promise<BookProgress> => ipcRenderer.invoke('progress:get', bookId),
    save: (bookId: string, patch: Partial<BookProgress>): Promise<BookProgress> =>
      ipcRenderer.invoke('progress:save', bookId, patch),
    /** 關閉前的最後一次寫入，不等回應 */
    flush: (bookId: string, patch: Partial<BookProgress>): void =>
      ipcRenderer.send('progress:flush', bookId, patch)
  },

  settings: {
    get: (): Promise<ReaderSettings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<ReaderSettings>): Promise<ReaderSettings> =>
      ipcRenderer.invoke('settings:set', patch)
  },

  window: {
    toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggleFullscreen')
  }
}

export type Api = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // 理論上不會走到這，留著是為了在誤關 contextIsolation 時仍能啟動
  Object.defineProperty(window, 'api', { value: api })
}
