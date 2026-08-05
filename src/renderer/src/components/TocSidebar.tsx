import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChapterMeta } from '@shared/types'

interface Props {
  chapters: ChapterMeta[]
  currentId: number
  onJump: (id: number) => void
}

const ROW_HEIGHT = 30

/**
 * 章節目錄。用虛擬捲動是必要的 —— 樣本書就有 982 章，
 * 長篇連載三千章以上很常見，全部塞進 DOM 會讓開啟目錄卡住。
 */
export default function TocSidebar({ chapters, currentId, onJump }: Props): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: chapters.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  // 換章時把目錄捲到對應項目，免得使用者還要自己找
  useEffect(() => {
    if (currentId >= 0 && currentId < chapters.length) {
      virtualizer.scrollToIndex(currentId, { align: 'center' })
    }
    // 只在章節真的變動時捲動，virtualizer 每次 render 都是新物件不能進相依
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, chapters.length])

  return (
    <div className="toc" ref={parentRef}>
      <div className="toc__sizer" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const c = chapters[row.index]!
          return (
            <button
              key={row.key}
              className={`toc__row ${row.index === currentId ? 'is-active' : ''}`}
              style={{ height: row.size, transform: `translateY(${row.start}px)` }}
              onClick={() => onJump(row.index)}
              title={c.title}
            >
              <span className="toc__rowTitle">{c.title}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
