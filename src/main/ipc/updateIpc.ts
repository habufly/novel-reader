import { ipcMain } from 'electron'
import type { AppPreferences, UpdateStatus } from '@shared/types'
import { checkForUpdates, currentUpdateStatus, downloadUpdate, installUpdate } from '../updater'
import { effectivePreferences, savePreferences } from '../storage/preferences'

export function registerUpdateIpc(): void {
  ipcMain.handle('update:status', (): UpdateStatus => currentUpdateStatus())
  ipcMain.handle('update:check', (): Promise<UpdateStatus> => checkForUpdates())
  ipcMain.handle('update:download', (): Promise<void> => downloadUpdate())
  ipcMain.handle('update:install', (): Promise<void> => installUpdate())

  ipcMain.handle('prefs:get', (): AppPreferences => effectivePreferences())
  ipcMain.handle(
    'prefs:set',
    (_e, patch: Partial<AppPreferences>): AppPreferences => savePreferences(patch)
  )
}
