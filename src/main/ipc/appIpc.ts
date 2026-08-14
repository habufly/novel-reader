import { app, ipcMain } from 'electron'
import type { AppInfo } from '@shared/types'

/** 由 electron.vite.config.ts 在編譯期注入 */
declare const __APP_VERSION__: string

export function registerAppIpc(): void {
  ipcMain.handle('app:info', (): AppInfo => {
    return {
      name: app.getName(),
      version: __APP_VERSION__,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      dataDir: app.getPath('userData'),
      packaged: app.isPackaged
    }
  })
}
