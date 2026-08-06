import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  Book,
  BookIndex,
  BookProgress,
  FilePreview,
  ImportProgress,
  ImportResult,
  ReaderPreset,
  ReaderSettings,
  EdgeVoice,
  SynthesisPayload,
  TtsSettings,
  UpdateStatus,
  AppPreferences
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
      ipcRenderer.invoke('settings:set', patch),
    listPresets: (): Promise<ReaderPreset[]> => ipcRenderer.invoke('presets:list'),
    savePreset: (name: string, settings: ReaderSettings): Promise<ReaderPreset[]> =>
      ipcRenderer.invoke('presets:save', name, settings),
    removePreset: (id: string): Promise<ReaderPreset[]> => ipcRenderer.invoke('presets:remove', id)
  },

  window: {
    toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggleFullscreen')
  },

  tts: {
    getSettings: (): Promise<TtsSettings> => ipcRenderer.invoke('tts:getSettings'),
    setSettings: (patch: Partial<TtsSettings>): Promise<TtsSettings> =>
      ipcRenderer.invoke('tts:setSettings', patch),
    edgeVoices: (): Promise<EdgeVoice[]> => ipcRenderer.invoke('tts:edgeVoices'),
    synthesize: (
      text: string,
      voice: string,
      rate: number,
      pitch: number
    ): Promise<SynthesisPayload> => ipcRenderer.invoke('tts:synthesize', text, voice, rate, pitch),

    /** 告知主行程目前是否在朗讀，用來決定要不要顯示系統匣圖示 */
    reportSpeaking: (value: boolean): void => ipcRenderer.send('tts:speaking', value),

    /** 系統匣選單與媒體鍵送來的指令 */
    onCommand: (fn: (cmd: string) => void): (() => void) => {
      const handler = (_e: unknown, cmd: string): void => fn(cmd)
      ipcRenderer.on('tts:command', handler)
      return () => ipcRenderer.off('tts:command', handler)
    }
  },

  update: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
    download: (): Promise<void> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onStatus: (fn: (s: UpdateStatus) => void): (() => void) => {
      const handler = (_e: unknown, s: UpdateStatus): void => fn(s)
      ipcRenderer.on('update:status', handler)
      return () => ipcRenderer.off('update:status', handler)
    }
  },

  prefs: {
    get: (): Promise<AppPreferences> => ipcRenderer.invoke('prefs:get'),
    set: (patch: Partial<AppPreferences>): Promise<AppPreferences> =>
      ipcRenderer.invoke('prefs:set', patch)
  }
}

export type Api = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // 理論上不會走到這，留著是為了在誤關 contextIsolation 時仍能啟動
  Object.defineProperty(window, 'api', { value: api })
}
