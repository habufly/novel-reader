import { useEffect, useState } from 'react'
import type { CrawlOptions, CrawlPreview, CrawlStatus, SiteProfile } from 'novel-scraper-core'

interface Props { onClose: () => void; onImported: () => void }
const labels: Record<CrawlStatus['state'], string> = {
  running: '下載中', interrupted: '上次意外中止', paused: '已暫停', failed: '失敗',
  incomplete: '部分章節失敗', sample_complete: '試抓完成', complete: '下載完成'
}
const template = {
  id: 'my-site', name: '我的網站', hosts: ['example.com'],
  bookTitle: 'h1', chapterLinks: '.chapter-list a[href]', chapterTitle: 'h1',
  chapterBody: '#content', minBodyLength: 100
}

export default function DownloadDialog({ onClose, onImported }: Props): React.JSX.Element {
  const [profiles, setProfiles] = useState<SiteProfile[]>([])
  const [jobs, setJobs] = useState<CrawlStatus[]>([])
  const [url, setUrl] = useState('')
  const [profileId, setProfileId] = useState('')
  const [cleaning, setCleaning] = useState<'none' | 'conservative'>('none')
  const [exact, setExact] = useState('')
  const [limit, setLimit] = useState('')
  const [preview, setPreview] = useState<{ key: string; value: CrawlPreview } | null>(null)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editor, setEditor] = useState(false)
  const [profileJson, setProfileJson] = useState(JSON.stringify(template, null, 2))
  const options: CrawlOptions = {
    url: url.trim(), profileId: profileId || undefined, cleaning,
    exactLines: exact.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    limit: limit ? Number(limit) : undefined
  }
  const key = JSON.stringify(options)
  const currentPreview = preview?.key === key ? preview.value : null
  const needsBrowser = profiles.some(profile => {
    if (profileId) return profile.id === profileId && profile.transport === 'browser'
    try { return profile.hosts.includes(new URL(url).hostname) && profile.transport === 'browser' } catch { return false }
  })

  useEffect(() => {
    void Promise.all([window.api.scraper.profiles(), window.api.scraper.jobs()])
      .then(([p, j]) => { setProfiles(p); setJobs(j); setRunning(j.some(s => s.state === 'running')) })
      .catch(e => setError(String(e)))
    const offProgress = window.api.scraper.onProgress(s => {
      setJobs(prev => [s, ...prev.filter(j => j.id !== s.id)])
      setRunning(s.state === 'running')
    })
    const offError = window.api.scraper.onError(message => { setError(message); setRunning(false) })
    return () => { offProgress(); offError() }
  }, [])

  const action = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(null); setNotice(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const start = async (value: CrawlOptions): Promise<void> => {
    setRunning(true)
    try { await window.api.scraper.start(value) }
    catch (e) { setRunning(false); throw e }
  }
  const importVersion = async (job: CrawlStatus, version: 'raw' | 'cleaned'): Promise<void> => {
    const result = await window.api.scraper.import(job.id, version)
    setNotice(`已匯入「${result.book.title}」${version === 'raw' ? '原文' : '清理版'}；未套用閱讀器精校。`)
    onImported()
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal download" onClick={e => e.stopPropagation()}>
        <header className="modal__head">
          <h2 className="modal__title">網址下載</h2>
          <span className="modal__sub">下載與閱讀器精校分開處理</span>
        </header>
        <div className="download__body">
          {error && <p role="alert" className="import__error">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {needsBrowser && <p className="set__note">此網站透過獨立瀏覽器載入。若出現 Cloudflare 驗證，請在網站視窗親自完成，程式會在正文出現後繼續；不會讀取 Chrome 的 Cookie 或自動解驗證。</p>}
          {busy && !running && <button className="btn" onClick={() => void window.api.scraper.pause()}>取消等待</button>}
          <fieldset disabled={busy || running} className="download__fields">
            <label>小說目錄網址<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://tw.zhswx.com/chapter/65891.html" /></label>
            <div className="download__row">
              <label>網站設定<select value={profileId} onChange={e => setProfileId(e.target.value)}>
                <option value="">依網域自動選擇</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.transport === 'browser' ? '（瀏覽器載入）' : ''}</option>)}
              </select></label>
              <label>章節上限（留空下載全書）<input type="number" min="1" step="1" value={limit} onChange={e => setLimit(e.target.value)} placeholder="全部" /></label>
            </div>
            <label>輸出方式<select value={cleaning} onChange={e => setCleaning(e.target.value as typeof cleaning)}>
              <option value="none">只輸出原文，不刪除正文文字</option>
              <option value="conservative">保留原文，另產生清理版</option>
            </select></label>
            {cleaning === 'conservative' && <>
              <p className="set__note">清理版會移除章首重複章號／標題、「本章完」及已知網站提示。作者附言與正文網址保留，不使用閱讀器的浮水印或作者留言推測規則。</p>
              <label>額外刪除的完整字句（一行一條，全行相同才刪除）<textarea rows={3} value={exact} onChange={e => setExact(e.target.value)} /></label>
            </>}
            <div className="download__row">
              <button className="btn" disabled={!url.trim()} onClick={() => void action(async () => setPreview({ key, value: await window.api.scraper.preview(options) }))}>試抓第一章</button>
              <button className="btn btn--primary" disabled={!currentPreview} onClick={() => void action(() => start(options))}>開始下載</button>
              <button className="btn" onClick={() => setEditor(!editor)}>新增網站設定</button>
            </div>
          </fieldset>

          {editor && <section className="download__section">
            <h3>網站設定 JSON</h3>
            <p className="set__note">適用 HTML 已含正文的網站。CSS 選擇器需符合該站結構；不支援自動破解驗證或動態分頁。網站 ID 請另取名稱。</p>
            <textarea aria-label="網站設定 JSON" rows={11} value={profileJson} disabled={busy || running} onChange={e => setProfileJson(e.target.value)} />
            <button className="btn" disabled={busy || running} onClick={() => void action(async () => {
              const saved = await window.api.scraper.saveProfile(JSON.parse(profileJson) as SiteProfile)
              setProfiles(await window.api.scraper.profiles()); setProfileId(saved.id); setPreview(null); setEditor(false)
            })}>儲存網站設定</button>
          </section>}

          {currentPreview && <section className="download__section">
            <h3>{currentPreview.title} · {currentPreview.total} 章</h3>
            {currentPreview.gaps.length > 0 && <p className="import__warn">目錄有跳號：{currentPreview.gaps.map(g => `${g.before} → ${g.after}`).join('、')}。下載不會自行補造缺章。</p>}
            <p className="set__note">{currentPreview.chapterTitle}；只預覽第一章，不能代表其他章節的所有清理結果。</p>
            <div className="download__preview">
              <div><h4>原文</h4><pre>{currentPreview.before}</pre></div>
              {cleaning === 'conservative' && <div><h4>清理版 · 移除 {currentPreview.removed.length} 處</h4><pre>{currentPreview.after}</pre></div>}
            </div>
          </section>}

          <section className="download__section">
            <h3>下載任務</h3>
            {!jobs.length && <p className="set__note">尚無任務。先試抓確認正文，再開始下載。</p>}
            {jobs.map(job => <article className="download__job" key={job.id}>
              <strong>{job.title || job.url}</strong>
              <p>{labels[job.state]} · {job.completed}/{job.selected || job.total || '?'} 章{job.failures.length > 0 && ` · ${job.failures.length} 章失敗`}</p>
              <progress max={Math.max(job.selected, 1)} value={job.completed} aria-label="下載進度" />
              {job.error && <p className="import__error">{job.error}</p>}
              {job.gaps.length > 0 && <p className="set__note">網站目錄跳號：{job.gaps.map(g => `${g.before} → ${g.after}`).join('、')}</p>}
              {job.removedItems !== undefined && <p className="set__note">清理版共移除 {job.removedItems} 處，原文與刪除紀錄分開保存。</p>}
              <div className="download__row">
                {job.state === 'running' && <button className="btn" disabled={busy} onClick={() => void action(() => window.api.scraper.pause())}>暫停</button>}
                {job.state !== 'running' && job.state !== 'complete' && <button className="btn" disabled={busy || running} onClick={() => void action(async () => {
                  await window.api.scraper.recover(job.id)
                  await start({ url: job.url, profileId: job.profileId, ...job.options, limit: null })
                })}>續傳全書</button>}
                {job.state === 'complete' && <>
                  <button className="btn" disabled={busy} onClick={() => void action(() => importVersion(job, 'raw'))}>匯入原文</button>
                  <button className="btn" disabled={busy} onClick={() => void action(() => window.api.scraper.reveal(job.id, 'raw'))}>顯示原文檔</button>
                  {job.cleanedOutput && <>
                    <button className="btn" disabled={busy} onClick={() => void action(() => importVersion(job, 'cleaned'))}>匯入清理版</button>
                    <button className="btn" disabled={busy} onClick={() => void action(() => window.api.scraper.reveal(job.id, 'cleaned'))}>顯示清理版</button>
                  </>}
                </>}
              </div>
            </article>)}
          </section>
        </div>
        <footer className="modal__foot"><span className="set__note">關閉此視窗後下載繼續；退出應用後可重新續傳。</span><div className="statusbar__spacer" /><button className="btn" disabled={busy} onClick={onClose}>關閉</button></footer>
      </div>
    </div>
  )
}
