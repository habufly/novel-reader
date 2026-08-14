import { ipcMain } from 'electron'
import type { RefineCategory, RefineResult, RefineScan } from '@shared/types'
import { refineBook, revertRefine, scanBook } from '../refine/refine'

export function registerRefineIpc(): void {
  ipcMain.handle('refine:scan', (_e, bookId: string): Promise<RefineScan> => scanBook(bookId))

  ipcMain.handle(
    'refine:apply',
    (_e, bookId: string, categories: RefineCategory[]): Promise<RefineResult> =>
      refineBook(bookId, categories)
  )

  ipcMain.handle('refine:revert', (_e, bookId: string): Promise<boolean> => revertRefine(bookId))
}
