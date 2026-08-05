import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { Book, BookIndex, FilePreview, ImportResult } from '@shared/types'
import { importBook, previewFile, readChapter } from '../import/importBook'
import { listBooks, readIndex, removeBook } from '../storage/library'

export function registerLibraryIpc(): void {
  ipcMain.handle('library:list', (): Book[] => listBooks())

  ipcMain.handle('library:pickFiles', async (e): Promise<string[]> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: '選擇小說檔案',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文字檔', extensions: ['txt'] },
        { name: '所有檔案', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(
    'library:preview',
    (_e, path: string, encoding?: string): Promise<FilePreview> => previewFile(path, encoding)
  )

  ipcMain.handle(
    'library:import',
    async (e, path: string, encoding?: string): Promise<ImportResult> => {
      return importBook(path, encoding, (progress) => {
        if (!e.sender.isDestroyed()) e.sender.send('library:importProgress', progress)
      })
    }
  )

  ipcMain.handle('library:remove', (_e, id: string): Promise<void> => removeBook(id))

  ipcMain.handle('library:revealSource', (_e, path: string): void => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle('book:index', (_e, id: string): BookIndex => readIndex(id))

  ipcMain.handle('book:chapter', async (_e, id: string, chapterId: number): Promise<string> => {
    const meta = readIndex(id).chapters[chapterId]
    if (!meta) throw new Error(`章節不存在: ${id} #${chapterId}`)
    return readChapter(id, meta)
  })
}
