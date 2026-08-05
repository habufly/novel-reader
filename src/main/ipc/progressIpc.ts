import { ipcMain } from 'electron'
import type { BookProgress } from '@shared/types'
import { loadProgress, saveProgress } from '../storage/progress'

export function registerProgressIpc(): void {
  ipcMain.handle('progress:get', (_e, bookId: string): BookProgress => loadProgress(bookId))

  ipcMain.handle(
    'progress:save',
    (_e, bookId: string, patch: Partial<BookProgress>): BookProgress =>
      saveProgress(bookId, patch)
  )

  /**
   * 關閉視窗前的最後一次寫入。用 send 而非 invoke ——
   * beforeunload 期間等不到回應，但訊息已經排進主行程佇列，
   * 會在行程結束前處理掉。
   */
  ipcMain.on('progress:flush', (_e, bookId: string, patch: Partial<BookProgress>): void => {
    try {
      saveProgress(bookId, patch)
    } catch (err) {
      console.error('[progress] 關閉前寫入失敗', err)
    }
  })
}
