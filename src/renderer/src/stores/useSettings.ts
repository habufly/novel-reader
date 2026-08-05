import { create } from 'zustand'
import { DEFAULT_SETTINGS, type ReaderPreset, type ReaderSettings } from '@shared/types'

interface SettingsState extends ReaderSettings {
  ready: boolean
  presets: ReaderPreset[]

  load: () => Promise<void>
  patch: (p: Partial<ReaderSettings>) => Promise<void>
  bumpFontSize: (delta: number) => Promise<void>
  reset: () => Promise<void>

  savePreset: (name: string) => Promise<void>
  applyPreset: (id: string) => Promise<void>
  removePreset: (id: string) => Promise<void>
}

export const FONT_MIN = 12
export const FONT_MAX = 48

function pick(s: SettingsState): ReaderSettings {
  return {
    theme: s.theme,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    maxWidth: s.maxWidth,
    paragraphSpacing: s.paragraphSpacing,
    indent: s.indent,
    pagePadding: s.pagePadding
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  ready: false,
  presets: [],

  load: async () => {
    const [s, presets] = await Promise.all([
      window.api.settings.get(),
      window.api.settings.listPresets()
    ])
    set({ ...s, presets, ready: true })
  },

  patch: async (p) => {
    // 先更新畫面再落地，拖動滑桿時才不會有延遲感
    set(p)
    const saved = await window.api.settings.set(p)
    set(saved)
  },

  bumpFontSize: async (delta) => {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, get().fontSize + delta))
    if (next === get().fontSize) return
    await get().patch({ fontSize: next })
  },

  reset: async () => {
    await get().patch({ ...DEFAULT_SETTINGS })
  },

  savePreset: async (name) => {
    const presets = await window.api.settings.savePreset(name, pick(get()))
    set({ presets })
  },

  applyPreset: async (id) => {
    const preset = get().presets.find((p) => p.id === id)
    if (!preset) return
    await get().patch(preset.settings)
  },

  removePreset: async (id) => {
    const presets = await window.api.settings.removePreset(id)
    set({ presets })
  }
}))

/** 把設定轉成閱讀區用的 CSS 變數 */
export function readerStyle(s: ReaderSettings): React.CSSProperties {
  return {
    '--reader-font': s.fontFamily || 'inherit',
    '--reader-size': `${s.fontSize}px`,
    '--reader-leading': String(s.lineHeight),
    '--reader-tracking': `${s.letterSpacing}em`,
    '--reader-width': `${s.maxWidth}em`,
    '--reader-gap': `${s.paragraphSpacing}em`,
    '--reader-indent': `${s.indent}em`,
    '--reader-pad': `${s.pagePadding}px`
  } as React.CSSProperties
}
