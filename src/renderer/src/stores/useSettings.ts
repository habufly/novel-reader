import { create } from 'zustand'
import { DEFAULT_SETTINGS, type ReaderSettings } from '@shared/types'

interface SettingsState extends ReaderSettings {
  ready: boolean
  load: () => Promise<void>
  patch: (p: Partial<ReaderSettings>) => Promise<void>
  bumpFontSize: (delta: number) => Promise<void>
}

const FONT_MIN = 12
const FONT_MAX = 48

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  ready: false,

  load: async () => {
    const s = await window.api.settings.get()
    set({ ...s, ready: true })
  },

  patch: async (p) => {
    // 先更新畫面再落地，調整字級才不會有延遲感
    set(p)
    const saved = await window.api.settings.set(p)
    set(saved)
  },

  bumpFontSize: async (delta) => {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, get().fontSize + delta))
    if (next === get().fontSize) return
    await get().patch({ fontSize: next })
  }
}))

/** 把設定轉成閱讀區用的 CSS 變數 */
export function readerStyle(s: ReaderSettings): React.CSSProperties {
  return {
    '--reader-font': s.fontFamily || 'inherit',
    '--reader-size': `${s.fontSize}px`,
    '--reader-leading': String(s.lineHeight),
    '--reader-width': `${s.maxWidth}em`,
    '--reader-gap': `${s.paragraphSpacing}em`,
    '--reader-indent': `${s.indent}em`
  } as React.CSSProperties
}
