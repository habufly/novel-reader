import { useEffect, useState } from 'react'
import { useTts, type SleepMode } from '../stores/useTts'

const SLEEP_LABELS: Array<{ id: SleepMode; label: string }> = [
  { id: 'off', label: '不設定' },
  { id: '15', label: '15 分鐘' },
  { id: '30', label: '30 分鐘' },
  { id: '60', label: '60 分鐘' },
  { id: 'chapter', label: '本章結束' }
]

function remaining(until: number | null): string {
  if (!until) return ''
  const sec = Math.max(0, Math.round((until - Date.now()) / 1000))
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

export default function TtsBar(): React.JSX.Element | null {
  const t = useTts()
  const [, forceTick] = useState(0)
  const [expanded, setExpanded] = useState(false)

  // 睡眠倒數要每秒重畫
  useEffect(() => {
    if (!t.sleepUntil) return
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [t.sleepUntil])

  useEffect(() => {
    if (t.settings.engine === 'edge' && t.edgeVoices.length === 0) void t.loadEdgeVoices()
    // 只在切到線上引擎時抓一次清單
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.settings.engine])

  if (!t.open) return null

  const zhLocal = t.localVoices.filter((v) => /^zh/i.test(v.lang))
  const voiceList = zhLocal.length ? zhLocal : t.localVoices
  const progress = t.chunks.length ? ((t.index + 1) / t.chunks.length) * 100 : 0

  return (
    <div className="tts">
      <div className="tts__progress" style={{ width: `${progress}%` }} />

      <div className="tts__main">
        <button className="tts__play" onClick={() => void t.toggle()} title="空白鍵">
          {t.playing ? '⏸' : '▶'}
        </button>
        <button className="tts__btn" onClick={() => void t.skip(-1)} title="上一段">
          ⏮
        </button>
        <button className="tts__btn" onClick={() => void t.skip(1)} title="下一段">
          ⏭
        </button>

        <span className="tts__pos">
          {t.chunks.length ? `${t.index + 1} / ${t.chunks.length} 段` : '尚未開始'}
        </span>

        <label className="tts__inline">
          速度
          <input
            className="tts__slider"
            type="range"
            min={0.5}
            max={4}
            step={0.1}
            value={t.settings.rate}
            onChange={(e) => void t.patch({ rate: Number(e.target.value) })}
          />
          <span className="tts__num">{t.settings.rate.toFixed(1)}×</span>
        </label>

        {t.sleepUntil && <span className="tts__sleep">⏱ {remaining(t.sleepUntil)}</span>}
        {t.sleepMode === 'chapter' && <span className="tts__sleep">⏱ 本章結束</span>}

        <div className="tts__spacer" />

        <button className="tts__btn" onClick={() => setExpanded((v) => !v)} title="更多設定">
          {expanded ? '▾' : '▴'}
        </button>
        <button
          className="tts__btn"
          onClick={() => {
            t.stop()
            t.setOpen(false)
          }}
          title="關閉朗讀"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="tts__panel">
          <label className="tts__field">
            <span>引擎</span>
            <select
              value={t.settings.engine}
              onChange={(e) => void t.patch({ engine: e.target.value as 'local' | 'edge' })}
            >
              <option value="local">離線（Windows 內建語音）</option>
              <option value="edge">線上（Edge 神經語音）</option>
            </select>
          </label>

          {t.settings.engine === 'local' ? (
            <label className="tts__field">
              <span>語音</span>
              <select
                value={t.settings.localVoice}
                onChange={(e) => void t.patch({ localVoice: e.target.value })}
              >
                {voiceList.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name.replace(/^Microsoft\s+/, '')}（{v.lang}）
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="tts__field">
              <span>語音</span>
              <select
                value={t.settings.edgeVoice}
                onChange={(e) => void t.patch({ edgeVoice: e.target.value })}
              >
                {t.edgeVoices.map((v) => (
                  <option key={v.shortName} value={v.shortName}>
                    {v.label}（{v.locale}）
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="tts__field">
            <span>音調</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={t.settings.pitch}
              onChange={(e) => void t.patch({ pitch: Number(e.target.value) })}
            />
            <span className="tts__num">{t.settings.pitch.toFixed(2)}</span>
          </label>

          <label className="tts__field">
            <span>音量</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={t.settings.volume}
              onChange={(e) => void t.patch({ volume: Number(e.target.value) })}
            />
            <span className="tts__num">{Math.round(t.settings.volume * 100)}%</span>
          </label>

          <label className="tts__field">
            <span>睡眠</span>
            <select value={t.sleepMode} onChange={(e) => t.setSleep(e.target.value as SleepMode)}>
              {SLEEP_LABELS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="tts__check">
            <input
              type="checkbox"
              checked={t.settings.highlightWords}
              onChange={(e) => void t.patch({ highlightWords: e.target.checked })}
            />
            逐詞高亮
          </label>

          <label className="tts__check">
            <input
              type="checkbox"
              checked={t.settings.autoScroll}
              onChange={(e) => void t.patch({ autoScroll: e.target.checked })}
            />
            自動捲動跟隨
          </label>
        </div>
      )}

      {t.notice && (
        <div className="tts__notice">
          {t.notice}
          <button className="tts__noticeClose" onClick={() => useTts.setState({ notice: null })}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}
