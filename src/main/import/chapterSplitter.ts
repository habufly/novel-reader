import type { SplitReport, SplitStrategy } from '@shared/types'

export interface SplitChapter {
  title: string
  /** 段落陣列，不含標題本身 */
  paragraphs: string[]
}

export interface SplitResult {
  chapters: SplitChapter[]
  report: SplitReport
}

// ---------------------------------------------------------------- 中文數字

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9
}
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

/** 支援「一千二百三十四」與阿拉伯數字混用；解析不出來回傳 NaN */
export function parseNumber(s: string): number {
  const t = s.trim()
  if (/^\d+$/.test(t)) return Number(t)

  let total = 0
  let section = 0
  let digit = 0
  let seen = false

  for (const ch of t) {
    if (CN_DIGIT[ch] !== undefined) {
      digit = CN_DIGIT[ch]!
      seen = true
    } else if (CN_UNIT[ch] !== undefined) {
      // 「十五」的十前面沒有數字，視為一
      section += (digit || 1) * CN_UNIT[ch]!
      digit = 0
      seen = true
    } else if (ch === '萬' || ch === '万') {
      total += (section + digit) * 10000
      section = 0
      digit = 0
      seen = true
    } else {
      return NaN
    }
  }
  return seen ? total + section + digit : NaN
}

// ---------------------------------------------------------------- 候選比對

const UNITS = '章節节回卷折篇集部幕'
const NUM_CHARS = '零〇一二三四五六七八九十百千萬万兩两0-9０-９'

/**
 * 「第N章」＋可選標題。標題與編號之間可有可無空白 ——
 * 樣本檔一個是「第1章 系統來早了」，另一個是「第1章重回LSPL」，兩種都要吃。
 */
const NUMBERED_RE = new RegExp(`^第\\s*([${NUM_CHARS}]{1,12})\\s*([${UNITS}])\\s*(.*)$`)

/** 有些來源在標題前面加了流水號，例如「10.第10章常态」 */
const LEADING_INDEX_RE = /^\d{1,4}\s*[.、,]\s*(?=第)/

/**
 * 標題被黏在前一段句尾的情況。
 *
 * 《全职高手》有 433 章長這樣 ——「“看比赛，开始了。”叶修平静第94章关键时候掉链子」，
 * 原站每章結尾的換行在轉檔時掉了，標題就直接接在正文後面。行首錨點完全抓不到，
 * 結果是連續幾十章合併成一章（實測有一章 9 萬字）。
 *
 * 界線只有三條：編號必須是阿拉伯數字（中文小說引用章節幾乎都寫中文數字）、
 * 標題長度 2–24 字、且標題必須位於行尾。
 *
 * 不能再加「標題不含句讀」這種條件 —— Phase 1 就是這樣誤殺過真標題，
 * 這裡同樣有「第413章嘉世，就这样了」「第684章这情况不对！」這些帶標點的真標題。
 *
 * 真正的保險在後面：命中之後只是「候選」，要通過序列驗證才會真的剖行，
 * 落選的原樣保留，不會動到內文。
 */
const GLUED_RE = new RegExp(`^(.*[^\\s])(第\\s*(\\d{1,4})\\s*([${UNITS}])(.{2,24}))$`)

/** 無編號的特殊章節。這類行必須短且不帶句讀，否則會誤收正文句子 */
const SPECIAL_RE =
  /^(番外篇|番外|外傳|外传|楔子|序章|序幕|自序|引子|尾聲|尾声|終章|终章|後記|后记|完本感言|作者的話|作者的话)(\s*[:：、.。·\-—]?\s*(.*))?$/

const SPECIAL_MAX_LEN = 24
const TITLE_MAX_LEN = 40

/** 編號體例。同一本書可能兩套並行，必須分開驗證 */
type NumberStyle = 'arabic' | 'chinese'

interface Candidate {
  line: number
  title: string
  unit: string
  style: NumberStyle
  num: number
  /**
   * 大於 0 表示標題黏在這一行的尾巴，前面 splitAt 個字是上一段的內文。
   * 只有通過序列驗證的候選才會真的把該行剖開，落選的原樣保留。
   */
  splitAt: number
}

interface SpecialCandidate {
  line: number
  title: string
}

/** 全形數字轉半形，讓「第１章」也能解析 */
function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

// ---------------------------------------------------------------- 序列驗證

/**
 * 最長嚴格遞增子序列，回傳被選中的索引。
 *
 * 真實章節的編號會構成又長又連續的遞增序列；正文裡碰巧命中的句子則是雜訊。
 * 實測樣本檔中「第一節課」「第二節晚自習」這類校園日常敘述命中了 186 次，
 * 但它們的編號在 1～4 之間反覆跳動，遞增子序列極短，用這個方法可以濾乾淨。
 */
function longestIncreasingSubsequence(nums: number[]): number[] {
  if (nums.length === 0) return []

  // tails[k] = 長度 k+1 的遞增序列中，結尾最小的那個在 nums 裡的索引
  const tails: number[] = []
  const prev = new Array<number>(nums.length).fill(-1)

  for (let i = 0; i < nums.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (nums[tails[mid]!]! < nums[i]!) lo = mid + 1
      else hi = mid
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1
    tails[lo] = i
  }

  const out: number[] = []
  let k = tails[tails.length - 1]!
  while (k !== -1) {
    out.push(k)
    k = prev[k]!
  }
  return out.reverse()
}

/** 一個「卷」至少要有這麼多章才算數，否則視為正文誤判 */
const MIN_RUN = 5

/**
 * 分段式序列驗證。
 *
 * 單純求全域遞增子序列在「每卷重新編號」的書上會崩潰：《灭运图录》的
 * 編號是 1..57、1..52、1..78… 重來八次，全域 LIS 只保得住最長的一段，
 * 914 個真章節裡有 674 個被當成雜訊丟掉，結果就是 62 萬字擠在同一章。
 *
 * 改成先在編號下降處切段（那就是換卷），段內各自求 LIS，段夠長才採用。
 * 正文誤判形成的碎段長度只有一兩個，過不了 MIN_RUN 這關。
 */
function segmentedSequence(nums: number[]): { keep: number[]; runs: number } {
  const bounds: Array<[number, number]> = []
  let start = 0
  for (let i = 1; i < nums.length; i++) {
    if (nums[i]! < nums[i - 1]!) {
      bounds.push([start, i])
      start = i
    }
  }
  bounds.push([start, nums.length])

  const keep: number[] = []
  let runs = 0
  for (const [a, b] of bounds) {
    const idx = longestIncreasingSubsequence(nums.slice(a, b)).map((x) => x + a)
    if (idx.length >= MIN_RUN) {
      keep.push(...idx)
      runs++
    }
  }
  return { keep, runs }
}

// ---------------------------------------------------------------- 主流程

const FIXED_CHUNK_CHARS = 3000
const MIN_CHAPTERS = 5

export function splitChapters(lines: string[], junkLines: number): SplitResult {
  const candidates: Candidate[] = []
  const specials: SpecialCandidate[] = []

  lines.forEach((line, index) => {
    const head = line.replace(LEADING_INDEX_RE, '')

    if (head.length <= TITLE_MAX_LEN) {
      const m = NUMBERED_RE.exec(head)
      if (m) {
        const raw = toHalfWidth(m[1]!)
        const num = parseNumber(raw)
        if (Number.isFinite(num)) {
          candidates.push({
            line: index,
            title: head,
            unit: m[2]!,
            style: /^\d+$/.test(raw) ? 'arabic' : 'chinese',
            num,
            splitAt: 0
          })
        }
        return
      }

      if (head.length <= SPECIAL_MAX_LEN && !/[。，、；]/.test(head)) {
        if (SPECIAL_RE.test(head)) specials.push({ line: index, title: head })
        return
      }
    }

    // 行首抓不到就看看標題是不是黏在句尾
    const g = GLUED_RE.exec(line)
    if (g) {
      const num = parseNumber(g[3]!)
      if (Number.isFinite(num)) {
        candidates.push({
          line: index,
          title: g[2]!,
          unit: g[4]!,
          style: 'arabic',
          num,
          splitAt: g[1]!.length
        })
      }
    }
  })

  /**
   * 依「單位＋編號體例」分組驗證。
   *
   * 為什麼體例要分開：《赤心巡天》同一章有兩套標題並存 ——
   * 「第一百三十一章风景未看尽」緊接著「第1867章风景未看尽」。兩套交錯後
   * 編號序列變成 131, 1867, 132, 1868…，每一對都是一次下降，會被切成
   * 上百個長度一兩個的碎段而全數落選。分流之後兩套各自都是單調遞增的。
   */
  const groups = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const key = `${c.unit}/${c.style}`
    const list = groups.get(key) ?? []
    list.push(c)
    groups.set(key, list)
  }

  const acceptedByUnit = new Map<string, Candidate[]>()
  const runsByUnit = new Map<string, number>()
  for (const [key, items] of groups) {
    const unit = key.split('/')[0]!
    const { keep, runs } = segmentedSequence(items.map((c) => c.num))
    const list = acceptedByUnit.get(unit) ?? []
    list.push(...keep.map((i) => items[i]!))
    acceptedByUnit.set(unit, list)
    runsByUnit.set(unit, (runsByUnit.get(unit) ?? 0) + runs)
  }

  const candidatesByUnit = new Map<string, number>()
  for (const c of candidates) {
    candidatesByUnit.set(c.unit, (candidatesByUnit.get(c.unit) ?? 0) + 1)
  }

  const unitScores: SplitReport['unitScores'] = []
  let winner: { unit: string; accepted: Candidate[] } | null = null
  for (const [unit, accepted] of acceptedByUnit) {
    unitScores.push({
      unit,
      candidates: candidatesByUnit.get(unit) ?? 0,
      accepted: accepted.length
    })
    if (!winner || accepted.length > winner.accepted.length) winner = { unit, accepted }
  }
  unitScores.sort((a, b) => b.accepted - a.accepted)

  if (!winner || winner.accepted.length < MIN_CHAPTERS) {
    return fixedSizeSplit(lines, junkLines, candidates.length, unitScores, specials.length)
  }

  // 兩套體例可能標到同一行，去重後依行號排序
  const marks: Array<{ line: number; title: string; splitAt: number }> = []
  const seen = new Set<number>()
  for (const c of winner.accepted) {
    if (seen.has(c.line)) continue
    seen.add(c.line)
    marks.push({ line: c.line, title: c.title, splitAt: c.splitAt })
  }
  for (const s of specials) {
    if (seen.has(s.line)) continue
    seen.add(s.line)
    marks.push({ line: s.line, title: s.title, splitAt: 0 })
  }
  marks.sort((a, b) => a.line - b.line)

  /** 標題黏在行尾時，該行前半段屬於上一章，要補回去 */
  const leadingPart = (mark: { line: number; splitAt: number }): string[] =>
    mark.splitAt > 0 ? [lines[mark.line]!.slice(0, mark.splitAt)] : []

  const chapters: SplitChapter[] = []

  // 第一章之前的內容（書名、作者、簡介）自成一章，不能丟掉
  const first = marks[0]!
  const preface = [...lines.slice(0, first.line), ...leadingPart(first)]
  if (preface.length > 0) {
    chapters.push({ title: '書籍資訊', paragraphs: preface })
  }

  for (let k = 0; k < marks.length; k++) {
    const next = marks[k + 1]
    const end = next ? next.line : lines.length
    const paragraphs = lines.slice(marks[k]!.line + 1, end)
    if (next) paragraphs.push(...leadingPart(next))
    // 只有標題沒有內文的行是卷名分隔，或是兩套編號標到同一章時多出來的那個標題
    if (paragraphs.length === 0) continue
    chapters.push({ title: marks[k]!.title, paragraphs })
  }

  return {
    chapters,
    report: {
      strategy: 'numbered',
      unit: winner.unit,
      candidates: candidates.length,
      accepted: winner.accepted.length,
      rejectedOutOfOrder: candidates.length - winner.accepted.length,
      specials: specials.length,
      junkLines,
      volumes: runsByUnit.get(winner.unit) ?? 1,
      unitScores
    }
  }
}

/** 抓不到章節結構時的保底：固定字數硬切，至少讓目錄可用 */
function fixedSizeSplit(
  lines: string[],
  junkLines: number,
  candidates: number,
  unitScores: SplitReport['unitScores'],
  specials: number
): SplitResult {
  const chapters: SplitChapter[] = []
  let buffer: string[] = []
  let chars = 0

  const flush = (): void => {
    if (!buffer.length) return
    chapters.push({ title: `第 ${chapters.length + 1} 節`, paragraphs: buffer })
    buffer = []
    chars = 0
  }

  for (const line of lines) {
    buffer.push(line)
    chars += line.length
    if (chars >= FIXED_CHUNK_CHARS) flush()
  }
  flush()

  const strategy: SplitStrategy = 'fixed-size'
  return {
    chapters,
    report: {
      strategy,
      candidates,
      accepted: 0,
      rejectedOutOfOrder: candidates,
      specials,
      junkLines,
      volumes: 0,
      unitScores
    }
  }
}
