import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book } from '@shared/types'
import { useReader } from '../stores/useReader'
import { useSettings } from '../stores/useSettings'
import ChapterFlow, { type ChapterFlowHandle } from '../components/ChapterFlow'
import TocSidebar from '../components/TocSidebar'
import BookmarkList from '../components/BookmarkList'
import TtsBar from '../components/TtsBar'
import { useTts } from '../stores/useTts'

interface Props {
  book: Book
  onBack: () => void
  onOpenSettings: () => void
}

/** 定期存檔間隔。使用者盯著同一頁不動時的保險，其餘時機都是事件觸發 */
const AUTOSAVE_MS = 30_000

/** 捲動停止多久之後寫入。太短會頻繁寫檔，太長則關窗時可能少記一段 */
const IDLE_SAVE_MS = 500

type Tab = 'toc' | 'marks'

export default function Reader({ book, onBack, onOpenSettings }: Props): React.JSX.Element {
  // 逐項訂閱，不要整包取出 —— 捲動時 current 每換一段就更新一次，
  // 訂閱整個 store 會讓整棵樹（含虛擬目錄）跟著重繪
  const open = useReader((s) => s.open)
  const close = useReader((s) => s.close)
  const jumpTo = useReader((s) => s.jumpTo)
  const goBack = useReader((s) => s.goBack)
  const persist = useReader((s) => s.persist)
  const addBookmark = useReader((s) => s.addBookmark)
  const removeBookmark = useReader((s) => s.removeBookmark)
  const chapters = useReader((s) => s.chapters)
  const current = useReader((s) => s.current)
  const loading = useReader((s) => s.loading)
  const readChapters = useReader((s) => s.readChapters)
  const bookmarks = useReader((s) => s.bookmarks)
  const hasHistory = useReader((s) => s.history.length > 0)
  const ttsInit = useTts((s) => s.init)
  const ttsStart = useTts((s) => s.start)
  const ttsToggle = useTts((s) => s.toggle)
  const ttsStop = useTts((s) => s.stop)
  const ttsSkip = useTts((s) => s.skip)
  const ttsOpen = useTts((s) => s.open)
  const ttsPlaying = useTts((s) => s.playing)
  const fontSize = useSettings((s) => s.fontSize)
  const bumpFontSize = useSettings((s) => s.bumpFontSize)

  const [tocOpen, setTocOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('toc')
  const [toast, setToast] = useState<string | null>(null)
  const flowRef = useRef<ChapterFlowHandle | null>(null)

  useEffect(() => {
    void open(book)
    return close
  }, [book, open, close])

  const onFlowReady = useCallback((h: ChapterFlowHandle) => {
    flowRef.current = h
  }, [])

  useEffect(() => {
    void ttsInit()
    return ttsStop
  }, [ttsInit, ttsStop])

  // 系統匣選單與鍵盤媒體鍵送來的指令
  useEffect(() => {
    return window.api.tts.onCommand((cmd) => {
      if (cmd === 'toggle') void ttsToggle()
      else if (cmd === 'stop') ttsStop()
      else if (cmd === 'next') void ttsSkip(1)
      else if (cmd === 'prev') void ttsSkip(-1)
    })
  }, [ttsToggle, ttsStop, ttsSkip])

  // 主行程據此決定要不要顯示系統匣圖示
  useEffect(() => {
    window.api.tts.reportSpeaking(ttsPlaying)
  }, [ttsPlaying])

  const toggleSpeech = useCallback(() => {
    if (ttsOpen) void ttsToggle()
    else void ttsStart()
  }, [ttsOpen, ttsToggle, ttsStart])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 1800)
  }, [])

  // --- 需求 1：自動書籤的五個寫入時機 ---

  // 1) 捲動停止 500ms，2) 換章（current 變動同時涵蓋這兩種）
  useEffect(() => {
    const t = window.setTimeout(() => persist(), IDLE_SAVE_MS)
    return () => window.clearTimeout(t)
  }, [current, persist])

  // 3) 視窗失焦，4) 每 30 秒，5) 關閉前
  useEffect(() => {
    const onBlur = (): void => persist()
    const onUnload = (): void => persist({ flush: true, force: true })
    const timer = window.setInterval(() => persist(), AUTOSAVE_MS)

    window.addEventListener('blur', onBlur)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('beforeunload', onUnload)
      persist({ force: true })
    }
  }, [persist])

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
      // 焦點在輸入框時不攔截，否則打不了搜尋關鍵字
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const flow = flowRef.current

      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        void goBack()
        return
      }

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
          case 'd':
          case 'D':
            e.preventDefault()
            void addBookmark().then(() => flash('已加入書籤'))
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
          e.preventDefault()
          // 需求 6：空白鍵播放／暫停朗讀。翻頁仍可用 PgUp/PgDn
          if (e.shiftKey) flow?.pageUp()
          else toggleSpeech()
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
  }, [bumpFontSize, jumpTo, goBack, addBookmark, flash, toggleSpeech, current.chapterId, onBack])

  return (
    <div className={`reader ${tocOpen ? '' : 'reader--noToc'}`}>
      {tocOpen && (
        <aside className="reader__side">
          <div className="reader__sideHead">
            <button className="btn btn--ghost" onClick={onBack}>
              ← 書櫃
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => void goBack()}
              disabled={!hasHistory}
              title="Alt+←　回到跳轉前的位置"
            >
              ↩ 返回
            </button>
          </div>

          <div className="reader__tabs">
            <button
              className={`reader__tab ${tab === 'toc' ? 'is-active' : ''}`}
              onClick={() => setTab('toc')}
            >
              目錄 {chapters.length}
            </button>
            <button
              className={`reader__tab ${tab === 'marks' ? 'is-active' : ''}`}
              onClick={() => setTab('marks')}
            >
              書籤 {bookmarks.length}
            </button>
          </div>

          {tab === 'toc' ? (
            <TocSidebar
              chapters={chapters}
              currentId={current.chapterId}
              readChapters={readChapters}
              onJump={(id) => void jumpTo(id)}
            />
          ) : (
            <BookmarkList
              bookmarks={bookmarks}
              chapters={chapters}
              onJump={(c, o) => void jumpTo(c, o)}
              onRemove={(id) => void removeBookmark(id)}
            />
          )}
        </aside>
      )}

      <div className="reader__main">
        {loading ? (
          <div className="reader__loading">載入中…</div>
        ) : (
          <ChapterFlow onReady={onFlowReady} />
        )}

        {toast && <div className="toast">{toast}</div>}

        <TtsBar />

        <footer className="statusbar">
          <button className="btn btn--ghost" onClick={() => setTocOpen((v) => !v)} title="Ctrl+T">
            {tocOpen ? '隱藏目錄' : '顯示目錄'}
          </button>
          <button
            className={`btn btn--ghost ${ttsPlaying ? 'is-on' : ''}`}
            onClick={toggleSpeech}
            title="空白鍵　朗讀"
          >
            {ttsPlaying ? '朗讀中' : '朗讀'}
          </button>
          <button className="btn btn--ghost" onClick={onOpenSettings} title="Ctrl+,">
            設定
          </button>
          <span className="statusbar__title">{chapters[current.chapterId]?.title ?? ''}</span>
          <div className="statusbar__spacer" />
          <span className="statusbar__hint">
            空白鍵朗讀 · ← → 換章 · Ctrl+D 書籤 · Alt+← 返回 · Ctrl± {fontSize}px · F11 全螢幕
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
