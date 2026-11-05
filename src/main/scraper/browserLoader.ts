import { BrowserWindow, session } from 'electron'
import { setTimeout as delay } from 'node:timers/promises'
import type { SiteProfile } from 'novel-scraper-core'

interface Context { profile: SiteProfile; signal?: AbortSignal; kind: 'catalog' | 'chapter' }

/** A normal isolated browser session. Verification is performed by the user. */
export class BrowserPageLoader {
  private window: BrowserWindow | undefined
  private active = false
  private allowedHosts: string[] = []
  constructor(private readonly options: { partition?: string; timeoutMs?: number; showVerification?: boolean } = {}) {}

  dispose(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
  }

  async load(url: string, { profile, signal, kind }: Context): Promise<string> {
    if (this.active) throw new Error('網站瀏覽器正在載入另一個頁面')
    const allowed = (target: string): boolean => {
      try {
        const u = new URL(target)
        return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && profile.hosts.includes(u.hostname)
      } catch { return false }
    }
    if (!allowed(url)) throw new Error('網站瀏覽器網址不符合網站設定')
    signal?.throwIfAborted()
    this.active = true
    this.allowedHosts = profile.hosts
    try {
      if (!this.window || this.window.isDestroyed()) {
        const isolatedSession = session.fromPartition(this.options.partition ?? 'persist:novel-download-browser')
        isolatedSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
        isolatedSession.setPermissionCheckHandler(() => false)
        const win = new BrowserWindow({
          width: 1080, height: 780, show: false, autoHideMenuBar: true,
          webPreferences: { session: isolatedSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
        })
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        win.webContents.on('will-attach-webview', event => event.preventDefault())
        const guard = (event: Electron.Event, target: string): void => {
          try {
            const next = new URL(target)
            if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password || !this.allowedHosts.includes(next.hostname)) event.preventDefault()
          } catch { event.preventDefault() }
        }
        win.webContents.on('will-navigate', guard)
        win.webContents.on('will-redirect', guard)
        this.window = win
      }
      const win = this.window
      const wc = win.webContents
      const keepTitle = (event: Electron.Event): void => {
        event.preventDefault()
        if (!win.isDestroyed()) win.setTitle(`網站驗證與下載 — ${url}`)
      }
      const cancelNavigation = (): void => {
        if (!win.isDestroyed()) { wc.stop(); win.hide() }
      }
      let navigationError: Error | undefined
      let closed = false
      const onClosed = (): void => { closed = true }
      win.on('closed', onClosed)
      wc.on('page-title-updated', keepTitle)
      signal?.addEventListener('abort', cancelNavigation, { once: true })
      try {
        win.setTitle(`網站驗證與下載 — ${url}`)
        // Clear the prior document so a repeated URL cannot return stale HTML.
        await win.loadURL('about:blank')
        signal?.throwIfAborted()
        // Use Chromium's normal navigation and cookies. Never spoof a fingerprint,
        // disable certificate validation, copy Chrome cookies, or solve challenges.
        void win.loadURL(url).catch(error => { navigationError = error })
        const isCatalog = kind === 'catalog'
        const inspect = `(() => {
          const title = document.querySelector(${JSON.stringify(isCatalog ? profile.bookTitle : profile.chapterTitle)});
          const bodies = document.querySelectorAll(${JSON.stringify(isCatalog ? profile.chapterLinks : profile.chapterBody)});
          const body = bodies[0];
          // DOM readiness is separate from text-length validation. A fully loaded
          // short announcement must not be mistaken for a verification page.
          const ready = document.readyState !== 'loading' && !!title?.textContent?.trim() && ${isCatalog ? 'bodies.length > 0' : "bodies.length === 1 && !!body?.textContent?.trim()"};
          return { ready, href: location.href, title: document.title, html: ready ? document.documentElement.outerHTML : '' };
        })()`
        const started = Date.now()
        while (Date.now() - started < (this.options.timeoutMs ?? 180000)) {
          signal?.throwIfAborted()
          if (closed || win.isDestroyed()) throw new Error('網站視窗已關閉，下載已停止；可重新試抓或續傳')
          let state: { ready: boolean; href: string; title: string; html: string } | undefined
          try { state = await wc.executeJavaScript(inspect) } catch { /* Navigation can replace the execution context. */ }
          if (state?.ready && allowed(state.href) && new URL(state.href).pathname.replace(/\/$/, '') === new URL(url).pathname.replace(/\/$/, '')) {
            signal?.throwIfAborted()
            win.hide()
            return state.html
          }
          if (this.options.showVerification !== false && !win.isVisible() && (Date.now() - started > 2500 || /just a moment|cloudflare|驗證|验证/i.test(state?.title ?? ''))) win.show()
          if (navigationError && !wc.isLoading() && !/ERR_ABORTED|ERR_HTTP_RESPONSE_CODE_FAILURE/.test(navigationError.message)) {
            throw new Error(`網站載入失敗：${navigationError.message}`)
          }
          await delay(500, undefined, { signal })
        }
        throw new Error('網站尚未提供可讀取的目錄或正文。請在網站視窗完成驗證後重新試抓；未擷取任何驗證頁作為正文。')
      } finally {
        signal?.removeEventListener('abort', cancelNavigation)
        if (!win.isDestroyed()) {
          wc.removeListener('page-title-updated', keepTitle)
        }
        win.removeListener('closed', onClosed)
      }
    } catch (error) {
      // A closed/blocked verification window must stop the job, rather than
      // reopening it for every remaining chapter.
      if (error instanceof Error) Object.assign(error, { fatal: true })
      throw error
    } finally { this.active = false }
  }
}
