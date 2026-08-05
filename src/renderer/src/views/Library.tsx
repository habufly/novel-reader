import { useEffect, useState } from 'react'
import type { Book, ImportResult } from '@shared/types'
import { useLibrary } from '../stores/useLibrary'
import ImportDialog from '../components/ImportDialog'

interface Props {
  onOpenBook: (book: Book) => void
  onOpenSettings: () => void
}

function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 萬字`
  return `${n} 字`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

export default function Library({ onOpenBook, onOpenSettings }: Props): React.JSX.Element {
  const { books, loading, error, refresh, remove } = useLibrary()
  const [pending, setPending] = useState<string[] | null>(null)
  const [lastImport, setLastImport] = useState<ImportResult[] | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const pick = async (): Promise<void> => {
    const paths = await window.api.library.pickFiles()
    if (paths.length) setPending(paths)
  }

  return (
    <div className="library">
      <header className="library__bar">
        <h2 className="library__heading">書櫃</h2>
        <span className="library__count">{books.length} 本</span>
        <div className="library__spacer" />
        <button className="btn" onClick={onOpenSettings} title="Ctrl+,">
          設定
        </button>
        <button className="btn btn--primary" onClick={() => void pick()}>
          匯入小說
        </button>
      </header>

      {error && <p className="library__error">讀取書櫃失敗：{error}</p>}

      {lastImport && lastImport.length > 0 && (
        <div className="report">
          <button className="report__close" onClick={() => setLastImport(null)} aria-label="關閉">
            ×
          </button>
          <h3 className="report__title">匯入完成</h3>
          {lastImport.map(({ book, report }) => (
            <div key={book.id} className="report__item">
              <strong>{book.title}</strong>
              <span className="report__line">
                {report.strategy === 'numbered'
                  ? `依「${report.unit}」切出 ${report.accepted} 章`
                  : `未偵測到章節結構，改用固定字數切成 ${book.chapterCount} 節`}
                {report.specials > 0 && `，另含 ${report.specials} 個番外／序章`}
              </span>
              {report.rejectedOutOfOrder > 0 && (
                <span className="report__line report__line--dim">
                  剔除 {report.rejectedOutOfOrder} 個編號不連續的誤判標題
                  {report.unitScores.length > 1 &&
                    `（落選單位：${report.unitScores
                      .slice(1)
                      .map((u) => `${u.unit} ${u.candidates} 個`)
                      .join('、')}）`}
                </span>
              )}
              {report.junkLines > 0 && (
                <span className="report__line report__line--dim">
                  清除 {report.junkLines} 行廣告／分隔線
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="library__empty">載入中…</p>
      ) : books.length === 0 ? (
        <div className="library__empty">
          <p>書櫃是空的。</p>
          <p className="library__emptyHint">
            支援 TXT，會自動偵測編碼並依章節切分目錄。原始檔案不會被修改。
          </p>
        </div>
      ) : (
        <ul className="books">
          {books.map((book) => (
            <li key={book.id} className="book">
              <button className="book__main" onClick={() => onOpenBook(book)}>
                <span className="book__title">{book.title}</span>
                {book.author && <span className="book__author">{book.author}</span>}
                <span className="book__meta">
                  {book.chapterCount} 章 · {formatChars(book.charCount)}
                </span>
                <span className="book__date">
                  {book.lastReadAt ? `上次閱讀 ${formatDate(book.lastReadAt)}` : `加入於 ${formatDate(book.addedAt)}`}
                </span>
                {book.progressPercent !== undefined && book.progressPercent > 0 && (
                  <span className="book__progress">
                    <span className="book__progressBar">
                      <span
                        className="book__progressFill"
                        style={{ width: `${book.progressPercent}%` }}
                      />
                    </span>
                    <span className="book__progressText">{book.progressPercent.toFixed(1)}%</span>
                  </span>
                )}
              </button>
              <div className="book__actions">
                <button
                  className="btn btn--ghost"
                  title={book.sourcePath}
                  onClick={() => void window.api.library.revealSource(book.sourcePath)}
                >
                  原始檔
                </button>
                <button
                  className="btn btn--ghost btn--danger"
                  onClick={() => void remove(book.id)}
                >
                  移除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <ImportDialog
          paths={pending}
          onCancel={() => setPending(null)}
          onDone={(results) => {
            setPending(null)
            setLastImport(results)
            void refresh()
          }}
        />
      )}
    </div>
  )
}
