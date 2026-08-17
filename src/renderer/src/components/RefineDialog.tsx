import { useEffect, useState } from 'react'
import type { Book, RefineCategory, RefineResult, RefineScan } from '@shared/types'

interface Props {
  book: Book
  onClose: () => void
  onApplied: () => void
}

export default function RefineDialog({ book, onClose, onApplied }: Props): React.JSX.Element {
  const [scan, setScan] = useState<RefineScan | null>(null)
  const [picked, setPicked] = useState<Set<RefineCategory>>(new Set())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RefineResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.refine
      .scan(book.id)
      .then((s) => {
        setScan(s)
        // 有命中的類別預設勾選，沒命中的不用管
        setPicked(new Set(s.categories.filter((c) => c.count > 0).map((c) => c.id)))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [book.id])

  const toggle = (id: RefineCategory): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setResult(await window.api.refine.apply(book.id, [...picked]))
      onApplied()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  const revert = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.refine.revert(book.id)
      onApplied()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  const total = scan?.categories.reduce((n, c) => (picked.has(c.id) ? n + c.count : n), 0) ?? 0

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h2 className="modal__title">精校</h2>
          <span className="modal__sub">{book.title}</span>
        </header>

        <div className="refine">
          {error && <p className="import__error">{error}</p>}

          {!scan && !error && <p className="set__note">掃描中…</p>}

          {result ? (
            <div className="refine__done">
              <h3 className="refine__doneTitle">精校完成</h3>
              <p>
                移除 {result.removedLines} 個段落
                {result.strippedFragments > 0 && `、清掉 ${result.strippedFragments} 處行內廣告`}
                {result.cleanedTitles > 0 && `、整理 ${result.cleanedTitles} 個章節標題`}，
                共 {result.removedChars.toLocaleString()} 字。
              </p>
              <p className="set__note">
                閱讀位置與 {result.remappedBookmarks} 個書籤都已重新對應到新的位置，
                指向的仍是精校前的同一句話。原始內容已備份，隨時可以還原。
              </p>
            </div>
          ) : (
            scan && (
              <>
                <p className="set__note">
                  精校只動內文，不會修改你的原始 TXT 檔。套用前請看一眼各類別的樣本，
                  規則若有誤判會當場看出來。
                </p>

                <ul className="refine__list">
                  {scan.categories.map((c) => (
                    <li key={c.id} className={`refine__item ${c.count === 0 ? 'is-empty' : ''}`}>
                      <label className="refine__head">
                        <input
                          type="checkbox"
                          checked={picked.has(c.id)}
                          disabled={c.count === 0 || busy}
                          onChange={() => toggle(c.id)}
                        />
                        <span className="refine__label">{c.label}</span>
                        <span className="refine__count">
                          {c.count === 0 ? '沒有命中' : `${c.count} 處`}
                        </span>
                        <span className="refine__mode">
                          {c.mode === 'line' ? '整段移除' : c.mode === 'title' ? '只清標題附註' : '只移除行內片段'}
                        </span>
                      </label>
                      <p className="refine__hint">{c.hint}</p>
                      {c.samples.length > 0 && (
                        <ul className="refine__samples">
                          {c.samples.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
        </div>

        <footer className="modal__foot">
          {scan?.refined && !result && (
            <button className="btn" onClick={() => void revert()} disabled={busy}>
              還原成精校前
            </button>
          )}
          <div className="statusbar__spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {result ? '關閉' : '取消'}
          </button>
          {!result && (
            <button
              className="btn btn--primary"
              onClick={() => void apply()}
              disabled={busy || total === 0}
            >
              {busy ? '套用中…' : `套用（${total} 處）`}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
