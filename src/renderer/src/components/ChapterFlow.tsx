import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReadingPosition } from '@shared/types'
import { useReader } from '../stores/useReader'
import { useSettings, readerStyle } from '../stores/useSettings'

/** 距離上下邊界多少像素就開始接下一章。抓大一點，讓載入在使用者看到之前完成 */
const EDGE_PX = 1600

/** 判定「正在讀哪裡」的基準線：視窗頂端往下 25% 處 */
const READ_LINE_RATIO = 0.25

interface Section {
  id: number
  title: string
  paragraphs: Array<{ offset: number; text: string }>
}

export interface ChapterFlowHandle {
  pageDown: () => void
  pageUp: () => void
}

/**
 * 取出元素內每一行的行框，座標換算成捲動容器的內容座標。
 *
 * 行不是獨立的 DOM 元素，但把 Range 圈住整個文字節點後，
 * getClientRects() 會逐行回傳矩形，這是拿到行邊界的唯一辦法。
 */
function lineBoxes(el: HTMLElement, scroller: HTMLElement): Array<{ top: number; bottom: number }> {
  const node = el.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return [{ top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight }]
  }
  const range = document.createRange()
  range.selectNodeContents(node)
  // getClientRects 給的是視窗座標，要換回內容座標才能拿來設 scrollTop
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  return Array.from(range.getClientRects(), (r) => ({ top: r.top - base, bottom: r.bottom - base }))
}

/**
 * 把捲動位置吸附到行的起點：找出第一個「底部越過目標線」的行，回傳它的頂端。
 *
 * 這條規則同時滿足兩件事 —— 已經完整看過的行不會重複出現在下一頁頂端，
 * 而被頁尾切到一半、還沒讀完的那一行會成為下一頁的第一行，不會被跳過。
 */
function snapToLine(scroller: HTMLElement, target: number): number {
  const blocks = Array.from(scroller.querySelectorAll<HTMLElement>('.chapter__title, .chapter__p'))
  if (!blocks.length) return target

  // 元素依文件順序排列，用二分搜尋跳到目標附近，不要每次翻頁都掃過上千個段落
  let lo = 0
  let hi = blocks.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const el = blocks[mid]!
    if (el.offsetTop + el.offsetHeight > target) hi = mid
    else lo = mid + 1
  }

  for (let i = lo; i < blocks.length && i < lo + 4; i++) {
    const el = blocks[i]!
    const lines = lineBoxes(el, scroller)
    // 目標落在段落之間的空白處，就對齊下一個段落的第一行。
    // 這裡也要用行框而不是 el.offsetTop —— 兩者差一個半行距，
    // 混用會讓每一頁的對齊基準忽上忽下。
    if (el.offsetTop > target) return lines[0]?.top ?? el.offsetTop
    for (const line of lines) {
      if (line.bottom > target + 1) return line.top
    }
  }
  return target
}

interface Props {
  onReady?: (handle: ChapterFlowHandle) => void
}

export default function ChapterFlow({ onReady }: Props): React.JSX.Element {
  const chapters = useReader((s) => s.chapters)
  const texts = useReader((s) => s.texts)
  const mounted = useReader((s) => s.mounted)
  const pendingScroll = useReader((s) => s.pendingScroll)
  const extend = useReader((s) => s.extend)
  const setCurrent = useReader((s) => s.setCurrent)
  const clearPendingScroll = useReader((s) => s.clearPendingScroll)
  const settings = useSettings()

  const scrollerRef = useRef<HTMLDivElement>(null)
  /** 掛載清單變動前記下的錨點，用來還原捲動位置 */
  const anchorRef = useRef<{ el: HTMLElement; delta: number } | null>(null)
  const rafRef = useRef(0)
  const lastPosRef = useRef<ReadingPosition>({ chapterId: -1, charOffset: -1 })

  const sections = useMemo<Section[]>(() => {
    return mounted
      .filter((id) => texts[id] !== undefined)
      .map((id) => {
        const body = texts[id]!
        const paragraphs: Section['paragraphs'] = []
        let offset = 0
        for (const text of body.split('\n')) {
          paragraphs.push({ offset, text })
          offset += text.length + 1 // +1 是被 split 吃掉的換行
        }
        return { id, title: chapters[id]?.title ?? `第 ${id} 章`, paragraphs }
      })
  }, [mounted, texts, chapters])

  /**
   * 掛載清單變動後還原捲動位置。
   *
   * 往前插入章節會把後面的內容整個推下去，不補償的話畫面會突然跳走。
   * 這裡用錨點元素而不是比較 scrollHeight：錨點在增刪前後都還在 DOM 裡，
   * 用它的 offsetTop 反推是精確的，不受同時發生的裁切影響。
   */
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    anchorRef.current = null
    const scroller = scrollerRef.current
    if (!anchor || !scroller || !anchor.el.isConnected) return
    scroller.scrollTop = anchor.el.offsetTop + anchor.delta
  }, [sections])

  /** 開書或跳章後定位到指定位移 */
  useLayoutEffect(() => {
    if (!pendingScroll) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const sec = scroller.querySelector<HTMLElement>(`[data-chapter="${pendingScroll.chapterId}"]`)
    if (!sec) return // 該章還沒掛上，等下次 render

    let top = sec.offsetTop
    if (pendingScroll.charOffset > 0) {
      const paras = sec.querySelectorAll<HTMLElement>('[data-offset]')
      for (const p of paras) {
        if (Number(p.dataset.offset) > pendingScroll.charOffset) break
        top = p.offsetTop
      }
      // 存檔記的是基準線上的段落，還原就要讓它回到基準線的高度。
      // 若直接對齊視窗頂端，重新量測會得到往後 25% 視窗高度的段落，
      // 每關一次書就往前漂移一段，累積下來會跳過內容。
      top -= scroller.clientHeight * READ_LINE_RATIO
    }
    scroller.scrollTop = Math.max(0, top)
    clearPendingScroll()
  }, [pendingScroll, sections, clearPendingScroll])

  /** 記下目前第一個可見章節，作為捲動補償的參考點 */
  const captureAnchor = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const secs = scroller.querySelectorAll<HTMLElement>('[data-chapter]')
    for (const el of secs) {
      if (el.offsetTop + el.offsetHeight > scroller.scrollTop) {
        anchorRef.current = { el, delta: scroller.scrollTop - el.offsetTop }
        return
      }
    }
  }, [])

  const onScroll = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const scroller = scrollerRef.current
      if (!scroller) return

      // --- 目前讀到哪 ---
      const line = scroller.scrollTop + scroller.clientHeight * READ_LINE_RATIO
      let sec: HTMLElement | null = null
      for (const el of scroller.querySelectorAll<HTMLElement>('[data-chapter]')) {
        if (el.offsetTop <= line) sec = el
        else break
      }
      if (sec) {
        let charOffset = 0
        for (const p of sec.querySelectorAll<HTMLElement>('[data-offset]')) {
          if (p.offsetTop > line) break
          charOffset = Number(p.dataset.offset)
        }
        const chapterId = Number(sec.dataset.chapter)
        const last = lastPosRef.current
        // 只在真的換段落時才寫回 store，避免每一幀都觸發重新算繪
        if (last.chapterId !== chapterId || last.charOffset !== charOffset) {
          lastPosRef.current = { chapterId, charOffset }
          setCurrent({ chapterId, charOffset })
        }
      }

      // --- 需要接上下一章嗎 ---
      const toBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      if (toBottom < EDGE_PX) {
        captureAnchor()
        void extend(1)
      } else if (scroller.scrollTop < EDGE_PX) {
        captureAnchor()
        void extend(-1)
      }
    })
  }, [extend, setCurrent, captureAnchor])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // 內容變動後主動檢查一次：章節太短時可能一掛上就已經接近底部
  useEffect(() => {
    onScroll()
  }, [sections, onScroll])

  useEffect(() => {
    if (!onReady) return

    /**
     * 翻頁。捲動距離不是固定的一個視窗高度，而是先算出理想位置，
     * 再吸附到最近的行起點 —— 直接捲一整個視窗高度的話，頁首會出現
     * 被切掉一半的那一行，比留重疊更難看。
     */
    const turn = (dir: 1 | -1): void => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const height = scroller.clientHeight
      const target = scroller.scrollTop + dir * height
      let next = snapToLine(scroller, target)

      // 吸附後若原地不動（例如整頁只有一行超長段落），至少要前進一頁
      if (dir === 1 && next <= scroller.scrollTop + 1) next = scroller.scrollTop + height
      if (dir === -1 && next >= scroller.scrollTop - 1) next = scroller.scrollTop - height

      scroller.scrollTo({ top: Math.max(0, next), behavior: 'auto' })
    }

    onReady({ pageDown: () => turn(1), pageUp: () => turn(-1) })
  }, [onReady])

  return (
    <div className="flow" ref={scrollerRef} onScroll={onScroll} style={readerStyle(settings)}>
      <div className="flow__inner">
        {sections.map((sec) => (
          <section key={sec.id} className="chapter" data-chapter={sec.id}>
            <h2 className="chapter__title">{sec.title}</h2>
            {sec.paragraphs.map((p) => (
              <p key={p.offset} className="chapter__p" data-offset={p.offset}>
                {p.text}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
