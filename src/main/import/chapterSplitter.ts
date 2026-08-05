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

/** 無編號的特殊章節。這類行必須短且不帶句讀，否則會誤收正文句子 */
const SPECIAL_RE =
  /^(番外篇|番外|外傳|外传|楔子|序章|序幕|自序|引子|尾聲|尾声|終章|终章|後記|后记|完本感言|作者的話|作者的话)(\s*[:：、.。·\-—]?\s*(.*))?$/

const SPECIAL_MAX_LEN = 24
const TITLE_MAX_LEN = 40

interface Candidate {
  line: number
  title: string
  unit: string
  num: number
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
 * 這是整個切分器的核心。真實章節的編號必然構成一條又長又連續的遞增序列；
 * 正文裡碰巧命中的句子則是雜訊。實測樣本檔中「第一節課」「第二節晚自習」
 * 這類校園日常敘述命中了 186 次，但它們的編號在 1～4 之間反覆跳動，
 * 遞增子序列極短，用這個方法可以一次濾乾淨。
 *
 * 同一編號重複出現時（轉檔殘留或重複張貼），嚴格遞增只會保留第一個。
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

// ---------------------------------------------------------------- 主流程

const FIXED_CHUNK_CHARS = 3000
const MIN_CHAPTERS = 5

export function splitChapters(lines: string[], junkLines: number): SplitResult {
  const byUnit = new Map<string, Candidate[]>()
  const specials: SpecialCandidate[] = []

  lines.forEach((line, index) => {
    if (line.length > TITLE_MAX_LEN) return

    const m = NUMBERED_RE.exec(line)
    if (m) {
      const num = parseNumber(toHalfWidth(m[1]!))
      if (Number.isFinite(num)) {
        const unit = m[2]!
        const list = byUnit.get(unit) ?? []
        list.push({ line: index, title: line, unit, num })
        byUnit.set(unit, list)
      }
      return
    }

    if (line.length <= SPECIAL_MAX_LEN && !/[。，、；]/.test(line)) {
      const s = SPECIAL_RE.exec(line)
      if (s) specials.push({ line: index, title: line })
    }
  })

  // 各單位比賽，遞增子序列最長的才是真正的章節單位
  const unitScores: SplitReport['unitScores'] = []
  let winner: { unit: string; items: Candidate[]; keep: number[] } | null = null

  for (const [unit, items] of byUnit) {
    const keep = longestIncreasingSubsequence(items.map((c) => c.num))
    unitScores.push({ unit, candidates: items.length, longestRun: keep.length })
    if (!winner || keep.length > winner.keep.length) winner = { unit, items, keep }
  }
  unitScores.sort((a, b) => b.longestRun - a.longestRun)

  const totalCandidates = [...byUnit.values()].reduce((n, l) => n + l.length, 0)

  if (!winner || winner.keep.length < MIN_CHAPTERS) {
    return fixedSizeSplit(lines, junkLines, totalCandidates, unitScores, specials.length)
  }

  // 採用的標題行 → 章節起點
  const marks: Array<{ line: number; title: string }> = winner.keep.map((i) => ({
    line: winner!.items[i]!.line,
    title: winner!.items[i]!.title
  }))

  // 番外、序章之類併進來，依行號排序
  for (const s of specials) marks.push({ line: s.line, title: s.title })
  marks.sort((a, b) => a.line - b.line)

  const chapters: SplitChapter[] = []

  // 第一章之前的內容（書名、作者、簡介）自成一章，不能丟掉
  const firstLine = marks[0]!.line
  if (firstLine > 0) {
    chapters.push({ title: '書籍資訊', paragraphs: lines.slice(0, firstLine) })
  }

  for (let k = 0; k < marks.length; k++) {
    const start = marks[k]!.line
    const end = k + 1 < marks.length ? marks[k + 1]!.line : lines.length
    const paragraphs = lines.slice(start + 1, end)
    // 只有標題沒有內文的行是卷名分隔（例如樣本檔尾端單獨一行的「番外」），跳過
    if (paragraphs.length === 0) continue
    chapters.push({ title: marks[k]!.title, paragraphs })
  }

  return {
    chapters,
    report: {
      strategy: 'numbered',
      unit: winner.unit,
      candidates: totalCandidates,
      accepted: winner.keep.length,
      rejectedOutOfOrder: totalCandidates - winner.keep.length,
      specials: specials.length,
      junkLines,
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
      unitScores
    }
  }
}
