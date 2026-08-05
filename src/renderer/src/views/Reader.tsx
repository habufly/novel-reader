import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book } from '@shared/types'
import { useReader } from '../stores/useReader'
import { useSettings } from '../stores/useSettings'
import ChapterFlow, { type ChapterFlowHandle } from '../components/ChapterFlow'
import TocSidebar from '../components/TocSidebar'

interface Props {
  book: Book
  onBack: () => void
}

export default function Reader({ book, onBack }: Props): React.JSX.Element {
  // 逐項訂閱，不要整包取出 —— 捲動時 current 每換一段就更新一次，
  // 訂閱整個 store 會讓整棵樹（含虛擬目錄）跟著重繪
  const open = useReader((s) => s.open)
  const close = useReader((s) => s.close)
  const jumpTo = useReader((s) => s.jumpTo)
  const chapters = useReader((s) => s.chapters)
  const current = useReader((s) => s.current)
  const loading = useReader((s) => s.loading)
  const fontSize = useSettings((s) => s.fontSize)
  const bumpFontSize = useSettings((s) => s.bumpFontSize)

  const [tocOpen, setTocOpen] = useState(true)
  const flowRef = useRef<ChapterFlowHandle | null>(null)

  useEffect(() => {
    void open(book)
    return close
  }, [book, open, close])

  const onFlowReady = useCallback((h: ChapterFlowHandle) => {
    flowRef.current = h
  }, [])

  /** 每章起點的累計字數，用來換算整本進度 */
  const cumulative = useMemo(() => {
    const out: number[] = []
    let sum = 0
    for (const c of chapters) {
      out.push(sum)
      sum += c.charCount
    }
    return { starts: out, total: sum }
  }, [chapters])

  const percent = useMemo(() => {
    if (!cumulative.total) return 0
    const base = cumulative.starts[current.chapterId] ?? 0
    return Math.min(100, ((base + current.charOffset) / cumulative.total) * 100)
  }, [cumulative, current])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 焦點在輸入框時不攔截
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const flow = flowRef.current
      if (e.ctrlKey) {
        switch (e.key) {
          case '=':
          case '+':
            e.preventDefault()
            void bumpFontSize(1)
            return
          case '-':
            e.preventDefault()
            void bumpFontSize(-1)
            return
          case 't':
          case 'T':
            e.preventDefault()
            setTocOpen((v) => !v)
            return
          default:
            return
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          flow?.scrollBy(120)
          break
        case 'ArrowUp':
          e.preventDefault()
          flow?.scrollBy(-120)
          break
        case 'PageDown':
          e.preventDefault()
          flow?.pageDown()
          break
        case 'PageUp':
          e.preventDefault()
          flow?.pageUp()
          break
        case ' ':
          // Phase 5 接上語音後，空白鍵會改成播放／暫停朗讀
          e.preventDefault()
          if (e.shiftKey) flow?.pageUp()
          else flow?.pageDown()
          break
        case 'ArrowRight':
          e.preventDefault()
          void jumpTo(current.chapterId + 1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          void jumpTo(current.chapterId - 1)
          break
        case 'F11':
          e.preventDefault()
          void window.api.window.toggleFullscreen()
          break
        case 'Escape':
          onBack()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bumpFontSize, jumpTo, current.chapterId, onBack])

  return (
    <div className={`reader ${tocOpen ? '' : 'reader--noToc'}`}>
      {tocOpen && (
        <aside className="reader__side">
          <div className="reader__sideHead">
            <button className="btn btn--ghost" onClick={onBack}>
              ← 書櫃
            </button>
            <span className="reader__sideCount">{chapters.length} 章</span>
          </div>
          <TocSidebar
            chapters={chapters}
            currentId={current.chapterId}
            onJump={(id) => void jumpTo(id)}
          />
        </aside>
      )}

      <div className="reader__main">
        {loading ? (
          <div className="reader__loading">載入中…</div>
        ) : (
          <ChapterFlow onReady={onFlowReady} />
        )}

        <footer className="statusbar">
          <button
            className="btn btn--ghost"
            onClick={() => setTocOpen((v) => !v)}
            title="Ctrl+T"
          >
            {tocOpen ? '隱藏目錄' : '顯示目錄'}
          </button>
          <span className="statusbar__title">{chapters[current.chapterId]?.title ?? ''}</span>
          <div className="statusbar__spacer" />
          <span className="statusbar__hint">
            ← → 換章 · 空白鍵翻頁 · Ctrl± 字級 {fontSize}px · F11 全螢幕
          </span>
          <span className="statusbar__progress">
            {current.chapterId + 1}/{chapters.length} · {percent.toFixed(1)}%
          </span>
        </footer>
        <div className="statusbar__bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
