import { DEFAULT_SETTINGS, type ReaderSettings } from '@shared/types'
import { dataPath, readJson, writeJson } from './jsonStore'

const file = (): string => dataPath('settings.json')

export function loadSettings(): ReaderSettings {
  // 與預設值合併，這樣新版本加欄位時舊設定檔不會缺鍵
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<ReaderSettings>>(file(), {}) }
}

export function saveSettings(patch: Partial<ReaderSettings>): ReaderSettings {
  const next = { ...loadSettings(), ...patch }
  writeJson(file(), next)
  return next
}
