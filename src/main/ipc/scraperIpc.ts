import { app, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { ScraperEngine } from 'novel-scraper-core'
import type { CrawlOptions, CrawlStatus, SiteProfile } from 'novel-scraper-core'
import { importBook } from '../import/importBook'
import { BrowserPageLoader } from '../scraper/browserLoader'

export function registerScraperIpc(): void {
  const browser = new BrowserPageLoader()
  const engine = new ScraperEngine(join(app.getPath('userData'), 'downloads'), {
    browserLoader: (url, context) => browser.load(url, context)
  })
  let controller: AbortController | undefined
  let busy = false
  const optionsFor = (value: CrawlOptions): CrawlOptions => ({
    url: value.url, profileId: value.profileId, cleaning: value.cleaning,
    exactLines: value.exactLines, limit: value.limit
  })
  const outputFor = async (id: string, version: 'raw' | 'cleaned'): Promise<string> => {
    if (!['raw', 'cleaned'].includes(version)) throw new Error('未知版本')
    const job = (await engine.jobs()).find(j => j.id === id)
    const target = version === 'raw' ? job?.rawOutput : job?.cleanedOutput
    if (!target) throw new Error('此版本尚未輸出')
    if (job?.state !== 'complete') throw new Error('請先完成全書下載，再匯入或開啟成品')
    return target
  }
  ipcMain.handle('scraper:profiles', () => engine.profiles())
  ipcMain.handle('scraper:saveProfile', (_e, profile: SiteProfile) => {
    if (busy) throw new Error('下載期間不可修改網站設定')
    return engine.saveProfile(profile)
  })
  ipcMain.handle('scraper:jobs', () => engine.jobs())
  ipcMain.handle('scraper:preview', async (_e, value: CrawlOptions) => {
    if (busy) throw new Error('請先暫停下載再預覽')
    busy = true
    const abort = new AbortController()
    controller = abort
    try { return await engine.preview(optionsFor(value), { signal: abort.signal }) }
    finally { busy = false; controller = undefined }
  })
  ipcMain.handle('scraper:start', (e, value: CrawlOptions) => {
    if (busy) throw new Error('已有任務執行中')
    busy = true
    const abort = new AbortController()
    controller = abort
    const send = (state: CrawlStatus): void => {
      if (!e.sender.isDestroyed()) e.sender.send('scraper:progress', state)
    }
    void engine.run(optionsFor(value), { signal: abort.signal, onProgress: send })
      .catch(error => {
        if (!e.sender.isDestroyed()) e.sender.send('scraper:error', error instanceof Error ? error.message : String(error))
      }).finally(() => { busy = false; controller = undefined })
  })
  ipcMain.handle('scraper:pause', () => controller?.abort())
  ipcMain.handle('scraper:recover', (_e, id: string) => engine.recover(id))
  ipcMain.handle('scraper:reveal', async (_e, id: string, version: 'raw' | 'cleaned') => shell.showItemInFolder(await outputFor(id, version)))
  ipcMain.handle('scraper:import', async (e, id: string, version: 'raw' | 'cleaned') => {
    const target = await outputFor(id, version)
    return importBook(target, 'utf-8', p => {
      if (!e.sender.isDestroyed()) e.sender.send('library:importProgress', p)
    })
  })
  app.on('before-quit', () => { controller?.abort(); browser.dispose() })
}
