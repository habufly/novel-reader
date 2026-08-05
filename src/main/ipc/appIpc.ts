import { app, ipcMain } from 'electron'
import type { AppInfo } from '@shared/types'

export function registerAppIpc(): void {
  ipcMain.handle('app:info', (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      dataDir: app.getPath('userData'),
      packaged: app.isPackaged
    }
  })
}
