import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import type { ReaderPreset, ReaderSettings } from '@shared/types'
import { loadSettings, saveSettings } from '../storage/settings'
import { listPresets, removePreset, savePreset } from '../storage/presets'

/** 淺色主題時也要讓原生元件（捲軸、右鍵選單）跟著換，否則只有內容區變亮 */
function syncNativeTheme(theme: ReaderSettings['theme']): void {
  nativeTheme.themeSource = theme === 'sepia' || theme === 'day' ? 'light' : 'dark'
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (): ReaderSettings => {
    const s = loadSettings()
    syncNativeTheme(s.theme)
    return s
  })

  ipcMain.handle('settings:set', (_e, patch: Partial<ReaderSettings>): ReaderSettings => {
    const next = saveSettings(patch)
    if (patch.theme) syncNativeTheme(next.theme)
    return next
  })

  ipcMain.handle('presets:list', (): ReaderPreset[] => listPresets())

  ipcMain.handle(
    'presets:save',
    (_e, name: string, settings: ReaderSettings): ReaderPreset[] => savePreset(name, settings)
  )

  ipcMain.handle('presets:remove', (_e, id: string): ReaderPreset[] => removePreset(id))

  ipcMain.handle('window:toggleFullscreen', (e): boolean => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return false
    const next = !win.isFullScreen()
    win.setFullScreen(next)
    return next
  })
}
