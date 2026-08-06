import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'

let tray: Tray | null = null
let speaking = false

function iconPath(): string {
  // 打包後 build/ 不會被收進去，改用 resources 底下的副本；開發時直接用專案檔案
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build', 'icon.ico')
}

function buildMenu(win: BrowserWindow): Menu {
  return Menu.buildFromTemplate([
    {
      label: speaking ? '暫停朗讀' : '繼續朗讀',
      click: () => win.webContents.send('tts:command', 'toggle')
    },
    { label: '停止朗讀', click: () => win.webContents.send('tts:command', 'stop') },
    { type: 'separator' },
    {
      label: '顯示視窗',
      click: () => {
        win.show()
        win.focus()
      }
    },
    { label: '結束', click: () => app.quit() }
  ])
}

/**
 * 系統匣圖示。只在朗讀進行中出現 —— 沒在聽書時常駐一個圖示是打擾。
 * 有了它，最小化之後仍能控制播放。
 */
export function setupTray(win: BrowserWindow): void {
  win.on('minimize', () => {
    if (!speaking) return
    // 朗讀中最小化就收進系統匣，讓工作列乾淨一點
    win.hide()
  })

  win.on('close', () => {
    tray?.destroy()
    tray = null
  })
}

export function setSpeaking(win: BrowserWindow, value: boolean): void {
  speaking = value
  if (value) {
    if (!tray) {
      const image = nativeImage.createFromPath(iconPath())
      tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
      tray.setToolTip('Novel Reader')
      tray.on('click', () => {
        if (win.isVisible()) win.hide()
        else {
          win.show()
          win.focus()
        }
      })
    }
    tray.setContextMenu(buildMenu(win))
  } else if (tray) {
    tray.destroy()
    tray = null
  }
}
