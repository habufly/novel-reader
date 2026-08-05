import { useCallback, useEffect, useState } from 'react'
import type { FilePreview, ImportProgress, ImportResult } from '@shared/types'

interface Props {
  paths: string[]
  onDone: (results: ImportResult[]) => void
  onCancel: () => void
}

interface Entry {
  path: string
  preview?: FilePreview
  /** 使用者手動指定的編碼，未指定則沿用偵測結果 */
  encoding?: string
  error?: string
}

const ENCODING_LABELS: Record<string, string> = {
  'utf-8': 'UTF-8',
  gb18030: 'GB18030（簡體）',
  big5: 'Big5（繁體）',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  shift_jis: 'Shift-JIS（日文）',
  'euc-kr': 'EUC-KR（韓文）',
  'windows-1252': 'Windows-1252'
}

const SOURCE_LABELS: Record<string, string> = {
  bom: '由 BOM 確定',
  utf8: '經 UTF-8 驗證確定',
  detected: '統計偵測推測',
  manual: '手動指定'
}

export default function ImportDialog({ paths, onDone, onCancel }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<Entry[]>(() => paths.map((path) => ({ path })))
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)

  const loadPreview = useCallback(async (index: number, encoding?: string) => {
    const path = paths[index]
    if (!path) return
    try {
      const preview = await window.api.library.preview(path, encoding)
      setEntries((prev) =>
        prev.map((e, i) => (i === index ? { ...e, preview, encoding, error: undefined } : e))
      )
    } catch (err) {
      setEntries((prev) =>
        prev.map((e, i) =>
          i === index ? { ...e, error: err instanceof Error ? err.message : String(err) } : e
        )
      )
    }
  }, [paths])

  // 先把每個檔案的編碼偵測跑完，使用者才能一眼看出哪個檔案有問題
  useEffect(() => {
    paths.forEach((_, i) => void loadPreview(i))
  }, [paths, loadPreview])

  useEffect(() => window.api.library.onImportProgress(setProgress), [])

  const current = entries[active]

  const runImport = async (): Promise<void> => {
    setBusy(true)
    const results: ImportResult[] = []
    for (const entry of entries) {
      try {
        results.push(await window.api.library.import(entry.path, entry.encoding))
      } catch (err) {
        setEntries((prev) =>
          prev.map((e) =>
            e.path === entry.path
              ? { ...e, error: err instanceof Error ? err.message : String(err) }
              : e
          )
        )
      }
    }
    setBusy(false)
    onDone(results)
  }

  const garbled = (current?.preview?.replacementRatio ?? 0) > 0.001

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h2 className="modal__title">匯入小說</h2>
          <span className="modal__sub">{paths.length} 個檔案</span>
        </header>

        <div className="import">
          <ul className="import__files">
            {entries.map((e, i) => (
              <li key={e.path}>
                <button
                  className={`import__file ${i === active ? 'is-active' : ''}`}
                  onClick={() => setActive(i)}
                  disabled={busy}
                >
                  <span className="import__fileName">{e.preview?.fileName ?? e.path}</span>
                  <span className="import__fileMeta">
                    {e.error
                      ? '讀取失敗'
                      : e.preview
                        ? `${(e.preview.bytes / 1024 / 1024).toFixed(1)} MB · ${e.preview.guess.encoding}`
                        : '偵測中…'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="import__detail">
            {current?.error && <p className="import__error">{current.error}</p>}

            {current?.preview && (
              <>
                <div className="import__row">
                  <label className="import__label" htmlFor="enc">
                    文字編碼
                  </label>
                  <select
                    id="enc"
                    className="import__select"
                    value={current.encoding ?? current.preview.guess.encoding}
                    disabled={busy}
                    onChange={(ev) => void loadPreview(active, ev.target.value)}
                  >
                    {current.preview.guess.candidates.map((c) => (
                      <option key={c} value={c}>
                        {ENCODING_LABELS[c] ?? c}
                      </option>
                    ))}
                  </select>
                  <span className="import__source">
                    {SOURCE_LABELS[current.preview.guess.source] ?? current.preview.guess.source}
                  </span>
                </div>

                {garbled && (
                  <p className="import__warn">
                    這個編碼解出了 {(current.preview.replacementRatio * 100).toFixed(1)}% 的亂碼字元，
                    請改選其他編碼。
                  </p>
                )}

                <p className="import__hint">
                  確認下方文字沒有亂碼再匯入。原始檔案不會被修改或移動。
                </p>
                <pre className="import__sample">{current.preview.sample}</pre>
              </>
            )}
          </div>
        </div>

        <footer className="modal__foot">
          {busy && progress && (
            <span className="import__progress">
              {progress.fileName} · {progress.stage} {progress.percent}%
            </span>
          )}
          <button className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="btn btn--primary"
            onClick={() => void runImport()}
            disabled={busy || entries.every((e) => !e.preview)}
          >
            {busy ? '匯入中…' : `匯入 ${paths.length} 本`}
          </button>
        </footer>
      </div>
    </div>
  )
}
