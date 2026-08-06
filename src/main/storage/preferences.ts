import { app } from 'electron'
import { DEFAULT_PREFERENCES, type AppPreferences } from '@shared/types'
import { dataPath, readJson, writeJson } from './jsonStore'

const file = (): string => dataPath('preferences.json')

export function loadPreferences(): AppPreferences {
  return { ...DEFAULT_PREFERENCES, ...readJson<Partial<AppPreferences>>(file(), {}) }
}

/**
 * 開機自啟由 Windows 登錄檔管理，設定檔只是我們這邊的紀錄。
 * 兩邊可能不同步（使用者直接從工作管理員停用），所以以系統實際狀態為準。
 */
export function syncLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return // 開發模式註冊會指向 electron.exe，沒有意義
  app.setLoginItemSettings({ openAtLogin: enabled, args: [] })
}

export function savePreferences(patch: Partial<AppPreferences>): AppPreferences {
  const next = { ...loadPreferences(), ...patch }
  writeJson(file(), next)
  if (patch.launchAtLogin !== undefined) syncLoginItem(next.launchAtLogin)
  return next
}

export function effectivePreferences(): AppPreferences {
  const stored = loadPreferences()
  if (!app.isPackaged) return stored
  return { ...stored, launchAtLogin: app.getLoginItemSettings().openAtLogin }
}
