import { useEffect, useState } from 'react'
import type { AppInfo, AppPreferences, UpdateStatus } from '@shared/types'

const STAGE_TEXT: Record<UpdateStatus['stage'], string> = {
  idle: '',
  checking: '檢查中…',
  available: '有新版本',
  downloading: '下載中',
  ready: '已下載完成，重新啟動即可套用',
  none: '已是最新版本',
  error: '檢查失敗',
  unsupported: '開發模式不檢查更新'
}

export default function AboutSection(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [prefs, setPrefs] = useState<AppPreferences | null>(null)
  const [update, setUpdate] = useState<UpdateStatus>({ stage: 'idle' })

  useEffect(() => {
    void window.api.getAppInfo().then(setInfo)
    void window.api.prefs.get().then(setPrefs)
    void window.api.update.status().then(setUpdate)
    return window.api.update.onStatus(setUpdate)
  }, [])

  const patchPrefs = async (p: Partial<AppPreferences>): Promise<void> => {
    setPrefs(await window.api.prefs.set(p))
  }

  const label = STAGE_TEXT[update.stage]

  return (
    <section className="set__section">
      <h3 className="set__heading">關於與更新</h3>

      <div className="about__row">
        <span className="about__key">版本</span>
        <span className="about__value">{info?.version ?? '—'}</span>
      </div>
      <div className="about__row">
        <span className="about__key">資料目錄</span>
        <span className="about__value about__value--path">{info?.dataDir ?? '—'}</span>
      </div>

      <label className="tts__check">
        <input
          type="checkbox"
          checked={prefs?.launchAtLogin ?? false}
          onChange={(e) => void patchPrefs({ launchAtLogin: e.target.checked })}
        />
        開機時自動啟動
      </label>

      <label className="tts__check">
        <input
          type="checkbox"
          checked={prefs?.autoCheckUpdates ?? true}
          onChange={(e) => void patchPrefs({ autoCheckUpdates: e.target.checked })}
        />
        啟動時檢查更新
      </label>

      <div className="set__row about__actions">
        <button
          className="btn"
          disabled={update.stage === 'checking' || update.stage === 'downloading'}
          onClick={() => void window.api.update.check()}
        >
          檢查更新
        </button>

        {update.stage === 'available' && (
          <button className="btn btn--primary" onClick={() => void window.api.update.download()}>
            下載 {update.version}
          </button>
        )}
        {update.stage === 'ready' && (
          <button className="btn btn--primary" onClick={() => void window.api.update.install()}>
            重新啟動並更新
          </button>
        )}
      </div>

      {label && (
        <p className={`set__note ${update.stage === 'error' ? 'set__note--warn' : ''}`}>
          {label}
          {update.stage === 'downloading' && ` ${update.percent ?? 0}%`}
          {update.stage === 'available' && ` ${update.version}`}
          {update.message ? `：${update.message}` : ''}
        </p>
      )}

      <p className="set__note">
        安裝檔未經程式碼簽章，首次執行時 Windows SmartScreen 會出現警告，
        選「其他資訊 → 仍要執行」即可。
      </p>
    </section>
  )
}
