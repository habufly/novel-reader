import { useEffect, useState } from 'react'
import type { Book, ChapterMeta } from '@shared/types'

interface Props {
  book: Book
  onBack: () => void
}

/**
 * Phase 1 的解析結果檢視：列出切出來的目錄，點章節就把該章內文讀出來。
 * 它驗證的是「索引的位元組範圍能正確取回單章」——真正的閱讀器在 Phase 2。
 */
export default function BookDetail({ book, onBack }: Props): React.JSX.Element {
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [selected, setSelected] = useState(0)
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('')
  const [elapsed, setElapsed] = useState<number | null>(null)

  useEffect(() => {
    void window.api.book.index(book.id).then((i) => setChapters(i.chapters))
  }, [book.id])

  useEffect(() => {
    if (!chapters.length) return
    const t0 = performance.now()
    void window.api.book.chapter(book.id, selected).then((body) => {
      setText(body)
      setElapsed(performance.now() - t0)
    })
  }, [book.id, selected, chapters.length])

  const visible = filter
    ? chapters.filter((c) => c.title.includes(filter))
    : chapters

  return (
    <div className="detail">
      <aside className="detail__toc">
        <div className="detail__tocHead">
          <button className="btn btn--ghost" onClick={onBack}>
            ← 書櫃
          </button>
          <input
            className="detail__search"
            placeholder="搜尋章節"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="detail__tocCount">
            {visible.length} / {chapters.length} 章
          </span>
        </div>
        <ul className="detail__list">
          {visible.map((c) => (
            <li key={c.id}>
              <button
                className={`detail__chapter ${c.id === selected ? 'is-active' : ''}`}
                onClick={() => setSelected(c.id)}
              >
                <span className="detail__chapterTitle">{c.title}</span>
                <span className="detail__chapterSize">{c.charCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="detail__body">
        <header className="detail__bodyHead">
          <h2 className="detail__bookTitle">{book.title}</h2>
          <span className="detail__bodyMeta">
            {chapters[selected]?.title}
            {elapsed !== null && ` · 讀取 ${elapsed.toFixed(0)}ms`}
          </span>
        </header>
        <div className="detail__text">
          {text.split('\n').map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </main>
    </div>
  )
}
