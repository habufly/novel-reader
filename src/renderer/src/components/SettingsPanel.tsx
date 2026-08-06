import { useEffect, useMemo, useState } from 'react'
import type { FontOption, ThemeName } from '@shared/types'
import { FONT_MAX, FONT_MIN, useSettings } from '../stores/useSettings'
import { BUILTIN_FONTS, queryLocalFonts } from '../lib/fonts'
import AboutSection from './AboutSection'

interface Props {
  onClose: () => void
}

const THEMES: Array<{ id: ThemeName; label: string; hint: string; bg: string; fg: string }> = [
  { id: 'night', label: '夜間', hint: '預設', bg: '#16161a', fg: '#d7d3cc' },
  { id: 'black', label: '純黑', hint: 'OLED', bg: '#000000', fg: '#c4c1bb' },
  { id: 'sepia', label: '羊皮紙', hint: '護眼', bg: '#f2e8d5', fg: '#4a3f31' },
  { id: 'day', label: '日間', hint: '明亮', bg: '#ffffff', fg: '#2c2c34' }
]

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  format?: (v: number) => string
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, step, suffix, format, onChange }: SliderProps): React.JSX.Element {
  return (
    <label className="set__row">
      <span className="set__label">{label}</span>
      <input
        className="set__slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="set__value">
        {format ? format(value) : value}
        {suffix}
      </span>
    </label>
  )
}

export default function SettingsPanel({ onClose }: Props): React.JSX.Element {
  const s = useSettings()
  const [systemFonts, setSystemFonts] = useState<FontOption[]>([])
  const [fontError, setFontError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [presetName, setPresetName] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // 用捕獲階段，才不會被 Reader 的 Escape（回書櫃）搶先處理
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 面板開啟時讓內容區退開，而不是蓋在上面 ——
  // 調整字型時看不到內文的話，「即時預覽」就沒有意義了
  useEffect(() => {
    document.documentElement.dataset['settings'] = 'open'
    return () => {
      delete document.documentElement.dataset['settings']
    }
  }, [])

  const fonts = useMemo(() => {
    if (!systemFonts.length) return BUILTIN_FONTS
    // 內建清單擺前面：使用者多半要的就是那幾個中文字型
    const builtinValues = new Set(BUILTIN_FONTS.map((f) => f.label))
    return [...BUILTIN_FONTS, ...systemFonts.filter((f) => !builtinValues.has(f.label))]
  }, [systemFonts])

  const scanFonts = async (): Promise<void> => {
    setScanning(true)
    setFontError(null)
    const { fonts: found, error } = await queryLocalFonts()
    setSystemFonts(found)
    setFontError(error ?? (found.length ? null : '沒有取得任何字型'))
    setScanning(false)
  }

  return (
    <div className="set-backdrop">
      <aside className="set">
        <header className="set__head">
          <h2 className="set__title">閱讀設定</h2>
          <button className="set__close" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </header>

        <div className="set__body">
          <section className="set__section">
            <h3 className="set__heading">主題</h3>
            <div className="set__themes">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`swatch ${s.theme === t.id ? 'is-active' : ''}`}
                  style={{ background: t.bg, color: t.fg }}
                  onClick={() => void s.patch({ theme: t.id })}
                >
                  <span className="swatch__label">{t.label}</span>
                  <span className="swatch__hint">{t.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="set__section">
            <h3 className="set__heading">字型</h3>
            <div className="set__row">
              <select
                className="set__select"
                value={s.fontFamily}
                onChange={(e) => void s.patch({ fontFamily: e.target.value })}
              >
                {fonts.map((f) => (
                  <option key={f.label} value={f.value}>
                    {f.label}
                    {f.fromSystem ? '' : ''}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => void scanFonts()} disabled={scanning}>
                {scanning ? '偵測中…' : '偵測系統字型'}
              </button>
            </div>
            {systemFonts.length > 0 && (
              <p className="set__note">已載入 {systemFonts.length} 個系統字型</p>
            )}
            {fontError && <p className="set__note set__note--warn">{fontError}</p>}

            <Slider
              label="字級"
              value={s.fontSize}
              min={FONT_MIN}
              max={FONT_MAX}
              step={1}
              suffix="px"
              onChange={(v) => void s.patch({ fontSize: v })}
            />
            <Slider
              label="行高"
              value={s.lineHeight}
              min={1.2}
              max={2.6}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => void s.patch({ lineHeight: v })}
            />
            <Slider
              label="字距"
              value={s.letterSpacing}
              min={0}
              max={0.3}
              step={0.01}
              suffix="em"
              format={(v) => v.toFixed(2)}
              onChange={(v) => void s.patch({ letterSpacing: v })}
            />
          </section>

          <section className="set__section">
            <h3 className="set__heading">版面</h3>
            <Slider
              label="單行寬度"
              value={s.maxWidth}
              min={20}
              max={60}
              step={1}
              suffix=" 字"
              onChange={(v) => void s.patch({ maxWidth: v })}
            />
            <Slider
              label="段落間距"
              value={s.paragraphSpacing}
              min={0}
              max={2.5}
              step={0.1}
              suffix="em"
              format={(v) => v.toFixed(1)}
              onChange={(v) => void s.patch({ paragraphSpacing: v })}
            />
            <Slider
              label="首行縮排"
              value={s.indent}
              min={0}
              max={4}
              step={1}
              suffix=" 字"
              onChange={(v) => void s.patch({ indent: v })}
            />
            <Slider
              label="左右邊距"
              value={s.pagePadding}
              min={0}
              max={120}
              step={4}
              suffix="px"
              onChange={(v) => void s.patch({ pagePadding: v })}
            />
          </section>

          <section className="set__section">
            <h3 className="set__heading">預設組合</h3>
            {s.presets.length > 0 && (
              <ul className="presets">
                {s.presets.map((p) => (
                  <li key={p.id} className="presets__item">
                    <button className="presets__apply" onClick={() => void s.applyPreset(p.id)}>
                      {p.name}
                    </button>
                    <button
                      className="presets__remove"
                      onClick={() => void s.removePreset(p.id)}
                      aria-label={`刪除 ${p.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="set__row">
              <input
                className="set__input"
                placeholder="組合名稱"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && presetName.trim()) {
                    void s.savePreset(presetName)
                    setPresetName('')
                  }
                }}
              />
              <button
                className="btn"
                disabled={!presetName.trim()}
                onClick={() => {
                  void s.savePreset(presetName)
                  setPresetName('')
                }}
              >
                存為組合
              </button>
            </div>
            <p className="set__note">同名會覆寫。存的是目前所有設定，含主題。</p>
          </section>

          <AboutSection />
        </div>

        <footer className="set__foot">
          <button className="btn" onClick={() => void s.reset()}>
            還原預設值
          </button>
        </footer>
      </aside>
    </div>
  )
}
