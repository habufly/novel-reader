import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { ExportResult } from '@shared/types'
import { exportBookText, safeFileName } from '../export/exportBook'
import { getBook } from '../storage/library'

export function registerExportIpc(): void {
  /** 回傳 null 表示使用者取消了存檔對話框 */
  ipcMain.handle(
    'export:book',
    async (e, bookId: string): Promise<ExportResult | null> => {
      const book = getBook(bookId)
      if (!book) throw new Error('找不到這本書')

      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showSaveDialog(win ?? undefined!, {
        title: '匯出為 UTF-8 文字檔',
        defaultPath: join(book.sourcePath, '..', safeFileName(book.title)),
        filters: [{ name: '文字檔', extensions: ['txt'] }]
      })
      if (result.canceled || !result.filePath) return null

      return exportBookText(bookId, result.filePath)
    }
  )

  ipcMain.handle('export:reveal', (_e, path: string): void => {
    shell.showItemInFolder(path)
  })
}
