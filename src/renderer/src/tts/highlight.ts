/**
 * 朗讀高亮。
 *
 * 用 CSS Custom Highlight API 而不是把段落拆成 <span>：
 * 逐詞高亮每秒要更新好幾次，若每次都改動 DOM，React 得重新算繪整個段落，
 * 使用者選取中的文字也會被打斷。Highlight API 只是在既有文字節點上疊一層
 * 樣式，不動 DOM 結構，成本極低。
 *
 * 不支援時退回整段標記（加 class），功能降級但不會壞掉。
 */

const WORD = 'tts-word'
const CHUNK = 'tts-chunk'

interface HighlightRegistry {
  set(name: string, value: unknown): void
  delete(name: string): void
}

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  return css?.highlights ?? null
}

export const supportsHighlightApi = (): boolean =>
  registry() !== null && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function'

/** 找出涵蓋指定章內位移的段落元素 */
function paragraphAt(chapterId: number, charOffset: number): HTMLElement | null {
  const sec = document.querySelector<HTMLElement>(`[data-chapter="${chapterId}"]`)
  if (!sec) return null
  let found: HTMLElement | null = null
  for (const p of sec.querySelectorAll<HTMLElement>('[data-offset]')) {
    if (Number(p.dataset['offset']) <= charOffset) found = p
    else break
  }
  return found
}

function makeRange(el: HTMLElement, from: number, to: number): Range | null {
  const node = el.firstChild
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const len = node.textContent?.length ?? 0
  const start = Math.max(0, Math.min(from, len))
  const end = Math.max(start, Math.min(to, len))
  if (start === end) return null
  const range = new Range()
  range.setStart(node, start)
  range.setEnd(node, end)
  return range
}

function apply(name: string, range: Range | null): void {
  const reg = registry()
  if (!reg) return
  if (!range) {
    reg.delete(name)
    return
  }
  const Ctor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!Ctor) return
  reg.set(name, new Ctor(range))
}

export interface HighlightTarget {
  chapterId: number
  /** 章內字元位移 */
  start: number
  length: number
}

function markSpeaking(el: HTMLElement | null): void {
  document
    .querySelectorAll('.chapter__p.is-speaking')
    .forEach((e) => e !== el && e.classList.remove('is-speaking'))
  el?.classList.add('is-speaking')
}

/**
 * 標出正在唸的詞，並回傳該詞所在的段落。
 *
 * 一個朗讀段落可能跨越好幾個 <p>（短對話會被合併成一段唸），
 * 所以「正在朗讀」的段落標記要跟著詞走，不能固定在朗讀段落的起點。
 */
export function highlightWord(target: HighlightTarget | null): HTMLElement | null {
  if (!target) {
    apply(WORD, null)
    return null
  }
  const el = paragraphAt(target.chapterId, target.start)
  if (!el) {
    apply(WORD, null)
    return null
  }
  const base = Number(el.dataset['offset'])
  apply(WORD, makeRange(el, target.start - base, target.start - base + target.length))
  markSpeaking(el)
  return el
}

/** 標出正在唸的整段句子，並回傳該段落元素供捲動使用 */
export function highlightChunk(target: HighlightTarget | null): HTMLElement | null {
  if (!target) {
    apply(CHUNK, null)
    document.querySelectorAll('.chapter__p.is-speaking').forEach((e) => e.classList.remove('is-speaking'))
    return null
  }
  const el = paragraphAt(target.chapterId, target.start)
  if (!el) {
    apply(CHUNK, null)
    return null
  }
  const base = Number(el.dataset['offset'])
  apply(CHUNK, makeRange(el, target.start - base, target.start - base + target.length))
  markSpeaking(el)
  return el
}

export function clearHighlights(): void {
  highlightWord(null)
  highlightChunk(null)
}

/**
 * 捲動讓朗讀中的段落停在閱讀基準線上。
 *
 * 刻意對齊到 25% 的位置而不是置中：閱讀位置的量測也用同一條基準線，
 * 兩邊一致，朗讀時自動存下的書籤才不會跟畫面對不上。
 */
export function scrollToSpoken(el: HTMLElement, ratio = 0.25): void {
  const scroller = document.querySelector<HTMLElement>('.flow')
  if (!scroller) return
  const target = el.offsetTop - scroller.clientHeight * ratio
  const delta = Math.abs(scroller.scrollTop - target)
  // 差距很小就不要動，免得每個詞都在微調造成畫面抖動
  if (delta < 24) return
  scroller.scrollTo({ top: Math.max(0, target), behavior: delta > 1200 ? 'auto' : 'smooth' })
}
