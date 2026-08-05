import { app, shell, session, nativeTheme, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { loadWindowState, trackWindowState } from './storage/windowState'
import { registerAppIpc } from './ipc/appIpc'
import { registerLibraryIpc } from './ipc/libraryIpc'
import { registerSettingsIpc } from './ipc/settingsIpc'
import { registerProgressIpc } from './ipc/progressIpc'

/**
 * 明確指定應用程式名稱，userData 目錄才會固定。
 *
 * 不設的話，直接以 `electron out/main/index.js` 啟動時 Electron 解析不到
 * 套件目錄，app.getName() 會退回 "Electron"，資料就寫到 %APPDATA%\Electron，
 * 與打包後的 %APPDATA%\novel-reader 分家 —— 等於開發與正式版各有一個書櫃。
 * 必須在任何 getPath('userData') 之前呼叫。
 */
app.setName('novel-reader')

/** 夜間模式的底色。視窗底色、CSS 變數 --bg 兩邊必須一致，否則啟動或縮放時會露出白邊。 */
const NIGHT_BG = '#16161a'

const isDev = !app.isPackaged

// 閱讀器開兩份會讓書籤互相覆蓋，直接鎖成單一實例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function applyContentSecurityPolicy(): void {
  // 開發模式下 Vite 需要注入 inline script 做 HMR，套 CSP 會直接壞掉，
  // 所以只在打包後的正式版套用。
  if (isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            // Phase 5 線上語音會用 blob: 播放合成出來的音訊
            "media-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'"
          ].join('; ')
        ]
      }
    })
  })
}

function createWindow(): BrowserWindow {
  const state = loadWindowState()

  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: 520,
    minHeight: 420,
    // show:false + backgroundColor + ready-to-show 三件套，
    // 少了任何一個啟動時都會閃一下白畫面，夜間閱讀特別刺眼
    show: false,
    backgroundColor: NIGHT_BG,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  if (state.maximized) win.maximize()
  trackWindowState(win)

  win.once('ready-to-show', () => win.show())

  // 站外連結交給系統瀏覽器，不在 app 內開新視窗
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

void app.whenReady().then(async () => {
  // 無頭模式：只跑匯入管線的煙霧測試然後退出，不開視窗
  const selfTestAt = process.argv.indexOf('--self-test')
  if (selfTestAt !== -1) {
    const { runSelfTest } = await import('./selfTest')
    const paths = process.argv.slice(selfTestAt + 1).filter((a) => !a.startsWith('--'))
    process.exitCode = await runSelfTest(paths, { keep: process.argv.includes('--keep') })
    app.quit()
    return
  }

  // 需求 3：夜間模式是預設值，連原生元件（選單、右鍵選單、捲軸）都要跟著暗
  nativeTheme.themeSource = 'dark'

  applyContentSecurityPolicy()
  registerAppIpc()
  registerLibraryIpc()
  registerSettingsIpc()
  registerProgressIpc()

  const win = createWindow()

  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
