import { app, BrowserWindow } from 'electron'
import type { UpdateStatus } from '@shared/types'

/**
 * 自動更新。發佈管道是 GitHub Releases（倉庫是公開的，不需要權杖）。
 *
 * 刻意不做「背景自動安裝」：閱讀到一半被強制重啟很惱人。這裡只負責
 * 檢查、下載、告知，實際安裝要等使用者按下按鈕，或下次結束程式時進行。
 */

let status: UpdateStatus = { stage: 'idle' }
let win: BrowserWindow | null = null

function emit(next: UpdateStatus): void {
  status = next
  if (win && !win.isDestroyed()) win.webContents.send('update:status', next)
}

export function currentUpdateStatus(): UpdateStatus {
  return status
}

/** electron-updater 只在打包後有意義，開發模式直接停用 */
function usable(): boolean {
  return app.isPackaged
}

/** electron-updater 的錯誤訊息是英文技術用語，轉成使用者看得懂的說法 */
function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/No published versions/i.test(raw)) return 'GitHub 上還沒有發佈任何版本'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN/i.test(raw)) {
    return '無法連線到更新伺服器，請檢查網路'
  }
  if (/app-update\.yml/i.test(raw)) return '此組建不支援自動更新（請使用安裝版）'
  if (/HttpError:\s*404|status code 404/i.test(raw)) return '找不到更新資訊'
  return raw
}

type Updater = typeof import('electron-updater').autoUpdater

let cached: Updater | null = null

async function getUpdater(): Promise<Updater | null> {
  if (!usable()) return null
  if (cached) return cached

  // electron-updater 是 CJS。打包成 CJS 後動態 import 的具名匯出可能
  // 落在 default 底下（cjs-module-lexer 認不出 getter 形式的匯出），
  // 兩種形狀都要接住，否則會拿到 undefined。
  const mod = (await import('electron-updater')) as unknown as {
    autoUpdater?: Updater
    default?: { autoUpdater?: Updater }
  }
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
  if (!autoUpdater) {
    emit({ stage: 'error', message: '更新模組載入失敗' })
    return null
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit({ stage: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    emit({ stage: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => emit({ stage: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    emit({ stage: 'downloading', percent: Math.round(p.percent), version: status.version })
  )
  autoUpdater.on('update-downloaded', (info) =>
    emit({ stage: 'ready', version: info.version })
  )
  autoUpdater.on('error', (err) =>
    emit({ stage: 'error', message: friendlyError(err) })
  )

  cached = autoUpdater
  return autoUpdater
}

export function bindUpdaterWindow(target: BrowserWindow): void {
  win = target
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const updater = await getUpdater()
  if (!updater) {
    emit({ stage: 'unsupported', message: '開發模式不檢查更新，請用安裝版。' })
    return status
  }
  try {
    await updater.checkForUpdates()
  } catch (err) {
    emit({ stage: 'error', message: friendlyError(err) })
  }
  return status
}

export async function downloadUpdate(): Promise<void> {
  const updater = await getUpdater()
  if (!updater) return
  try {
    await updater.downloadUpdate()
  } catch (err) {
    emit({ stage: 'error', message: friendlyError(err) })
  }
}

export async function installUpdate(): Promise<void> {
  const updater = await getUpdater()
  if (!updater || status.stage !== 'ready') return
  // 第二個參數 true：安裝完自動重新啟動
  updater.quitAndInstall(false, true)
}
