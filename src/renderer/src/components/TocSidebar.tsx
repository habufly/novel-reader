import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChapterMeta } from '@shared/types'

interface Props {
  chapters: ChapterMeta[]
  currentId: number
  readChapters: Set<number>
  onJump: (id: number) => void
}

const ROW_HEIGHT = 30

/**
 * 章節目錄。用虛擬捲動是必要的 —— 樣本書就有 982 章，
 * 長篇連載三千章以上很常見，全部塞進 DOM 會讓開啟目錄卡住。
 */
export default function TocSidebar({
  chapters,
  currentId,
  readChapters,
  onJump
}: Props): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim()
    if (!q) return chapters
    return chapters.filter((c) => c.title.includes(q))
  }, [chapters, query])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  // 篩選後索引會位移，要用章節編號反查目前這一列在哪
  const activeRow = useMemo(() => rows.findIndex((c) => c.id === currentId), [rows, currentId])

  // 換章時把目錄捲到對應項目，免得使用者還要自己找
  useEffect(() => {
    if (activeRow >= 0) virtualizer.scrollToIndex(activeRow, { align: 'center' })
    // virtualizer 每次 render 都是新物件，不能放進相依陣列
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow])

  return (
    <div className="toc">
      <div className="toc__search">
        <input
          className="toc__input"
          placeholder="搜尋章節"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <span className="toc__hits">
            {rows.length} / {chapters.length}
          </span>
        )}
      </div>

      <div className="toc__scroll" ref={parentRef}>
        <div className="toc__sizer" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const c = rows[row.index]!
            const isRead = readChapters.has(c.id)
            return (
              <button
                key={row.key}
                className={`toc__row ${c.id === currentId ? 'is-active' : ''} ${
                  isRead ? 'is-read' : ''
                }`}
                style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                onClick={() => onJump(c.id)}
                title={c.title}
              >
                <span className="toc__dot" aria-hidden />
                <span className="toc__rowTitle">{c.title}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
