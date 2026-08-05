import { screen, type BrowserWindow } from 'electron'
import { dataPath, readJson, writeJson } from './jsonStore'

export interface WindowState {
  bounds: { x?: number; y?: number; width: number; height: number }
  maximized: boolean
}

const DEFAULT_STATE: WindowState = {
  bounds: { width: 1120, height: 820 },
  maximized: false
}

const file = (): string => dataPath('window-state.json')

/** 記住的座標可能因為外接螢幕拔掉而落在畫面外，那就退回預設置中。 */
function isOnSomeDisplay(bounds: WindowState['bounds']): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return true
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapsX = bounds.x! < a.x + a.width && bounds.x! + bounds.width > a.x
    const overlapsY = bounds.y! < a.y + a.height && bounds.y! + bounds.height > a.y
    return overlapsX && overlapsY
  })
}

/** 小螢幕（或高 DPI 縮放後）工作區可能比預設尺寸還小，先收進去免得一開就被系統裁切 */
function fitToWorkArea(bounds: WindowState['bounds']): WindowState['bounds'] {
  const { width: aw, height: ah } = screen.getPrimaryDisplay().workArea
  return {
    ...bounds,
    width: Math.min(bounds.width, aw),
    height: Math.min(bounds.height, ah)
  }
}

export function loadWindowState(): WindowState {
  const state = readJson(file(), DEFAULT_STATE)
  if (!isOnSomeDisplay(state.bounds)) {
    return { ...DEFAULT_STATE, bounds: fitToWorkArea(DEFAULT_STATE.bounds) }
  }
  return { ...state, bounds: fitToWorkArea(state.bounds) }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined

  // getNormalBounds() 回傳的永遠是還原後的尺寸，最大化時也不會被覆蓋掉
  const snapshot = (): WindowState => ({
    bounds: win.getNormalBounds(),
    maximized: win.isMaximized()
  })

  const save = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!win.isDestroyed()) writeJson(file(), snapshot())
    }, 300)
  }

  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', () => {
    clearTimeout(timer)
    writeJson(file(), snapshot())
  })
}
