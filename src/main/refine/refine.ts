import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type {
  BookProgress,
  ChapterMeta,
  RefineCategory,
  RefineResult,
  RefineScan
} from '@shared/types'
import { bookDir, contentFile, getBook, indexFile, readIndex, saveBook, writeIndex } from '../storage/library'
import { loadProgress, saveProgress } from '../storage/progress'
import { readJson, writeJson } from '../storage/jsonStore'
import { RULES, decide } from './rules'

const SAMPLE_LIMIT = 5

const originalContent = (id: string): string => `${bookDir(id)}/content.original.txt`
const originalIndex = (id: string): string => `${bookDir(id)}/index.original.json`
const logFile = (id: string): string => `${bookDir(id)}/refine.json`

/** 每章被移除的區段，記在「精校前」的座標系，用來雙向換算位置 */
type Removal = { start: number; length: number }

interface RefineLog {
  appliedAt: string
  categories: RefineCategory[]
  removals: Record<number, Removal[]>
}

async function readChapters(id: string, chapters: ChapterMeta[]): Promise<string[]> {
  const buf = await readFile(contentFile(id))
  return chapters.map((c) => buf.subarray(c.byteStart, c.byteEnd).toString('utf-8'))
}

// ---------------------------------------------------------------- 掃描

export async function scanBook(id: string): Promise<RefineScan> {
  const { chapters } = readIndex(id)
  const bodies = await readChapters(id, chapters)

  const counts = new Map<RefineCategory, number>()
  const samples = new Map<RefineCategory, string[]>()

  for (const body of bodies) {
    for (const line of body.split('\n')) {
      if (!line) continue
      for (const rule of RULES) {
        const d = decide(line, new Set([rule.id]))
        if (!d.drop && !d.rewritten) continue
        counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1)
        const list = samples.get(rule.id) ?? []
        if (list.length < SAMPLE_LIMIT) {
          list.push(line.length > 70 ? `${line.slice(0, 70)}…` : line)
          samples.set(rule.id, list)
        }
      }
    }
  }

  return {
    bookId: id,
    refined: existsSync(originalContent(id)),
    categories: RULES.map((r) => ({
      id: r.id,
      label: r.label,
      hint: r.hint,
      mode: r.mode,
      count: counts.get(r.id) ?? 0,
      samples: samples.get(r.id) ?? []
    }))
  }
}

// ---------------------------------------------------------------- 位置換算

/** 精校前的位移 → 精校後的位移 */
function mapForward(offset: number, removals: Removal[]): number {
  let shift = 0
  for (const r of removals) {
    if (r.start + r.length <= offset) shift += r.length
    // 位置正好落在被移除的段落裡，退到該段落的起點
    else if (r.start <= offset) return Math.max(0, r.start - shift)
    else break
  }
  return Math.max(0, offset - shift)
}

/** 精校後的位移 → 精校前的位移，還原時用 */
function mapBackward(offset: number, removals: Removal[]): number {
  let shift = 0
  for (const r of removals) {
    if (offset >= r.start - shift) shift += r.length
    else break
  }
  return offset + shift
}

/**
 * 把閱讀進度與所有書籤搬到新座標。
 *
 * 這是整個精校最容易出事的地方：content.txt 是章節位元組範圍、閱讀進度、
 * 書籤三者共同的基準，少換算任何一個都會讓使用者的位置默默指到別的地方，
 * 而且不像 Phase 3 的漂移會慢慢累積 —— 這種是一次就錯到底。
 */
function remapProgress(
  id: string,
  removals: Record<number, Removal[]>,
  direction: 'forward' | 'backward'
): number {
  const progress = loadProgress(id)
  const move = direction === 'forward' ? mapForward : mapBackward
  const at = (chapterId: number, offset: number): number =>
    move(offset, removals[chapterId] ?? [])

  const next: Partial<BookProgress> = {
    current: {
      ...progress.current,
      charOffset: at(progress.current.chapterId, progress.current.charOffset)
    },
    bookmarks: progress.bookmarks.map((b) => ({
      ...b,
      charOffset: at(b.chapterId, b.charOffset)
    })),
    history: progress.history.map((h) => ({
      ...h,
      charOffset: at(h.chapterId, h.charOffset)
    }))
  }
  saveProgress(id, next)
  return progress.bookmarks.length
}

// ---------------------------------------------------------------- 套用

export async function refineBook(id: string, categories: RefineCategory[]): Promise<RefineResult> {
  const enabled = new Set(categories)
  if (enabled.size === 0) {
    return { removedLines: 0, strippedFragments: 0, removedChars: 0, remappedBookmarks: 0 }
  }

  const index = readIndex(id)
  const bodies = await readChapters(id, index.chapters)

  // 第一次精校前先備份，之後才有得還原
  if (!existsSync(originalContent(id))) {
    await copyFile(contentFile(id), originalContent(id))
    await copyFile(indexFile(id), originalIndex(id))
  }

  const removals: Record<number, Removal[]> = {}
  const newBodies: string[] = []
  let removedLines = 0
  let strippedFragments = 0
  let removedChars = 0

  bodies.forEach((body, chapterId) => {
    const lines = body.split('\n')
    const kept: string[] = []
    const list: Removal[] = []
    let oldPos = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const start = oldPos
      // 每行在內文裡佔 line.length 個字，後面接一個換行
      oldPos += line.length + 1

      const d = decide(line, enabled)

      if (d.drop) {
        // 整章都符合規則時至少留最後一行，不要產生空章
        const lastStanding = kept.length === 0 && i === lines.length - 1
        if (!lastStanding) {
          list.push({ start, length: line.length + 1 })
          removedLines++
          removedChars += line.length
          continue
        }
      }

      if (d.rewritten !== undefined) {
        // 片段位置逐一追蹤成本高，記在行尾即可 —— 誤差不超過該行本身
        list.push({ start: start + d.rewritten.length, length: line.length - d.rewritten.length })
        strippedFragments++
        removedChars += line.length - d.rewritten.length
        kept.push(d.rewritten)
        continue
      }

      kept.push(line)
    }

    if (list.length) removals[chapterId] = list
    newBodies.push(kept.join('\n'))
  })

  // 重建 content.txt 與章節位元組範圍
  const parts: Buffer[] = []
  const metas: ChapterMeta[] = []
  let offset = 0
  let charCount = 0

  newBodies.forEach((body, chapterId) => {
    const bytes = Buffer.byteLength(body, 'utf-8')
    metas.push({
      id: chapterId,
      title: index.chapters[chapterId]!.title,
      charCount: body.length,
      byteStart: offset,
      byteEnd: offset + bytes
    })
    parts.push(Buffer.from(`${body}\n`, 'utf-8'))
    offset += bytes + 1
    charCount += body.length
  })

  await writeFile(contentFile(id), Buffer.concat(parts))
  writeIndex(id, { chapters: metas })

  const remappedBookmarks = remapProgress(id, removals, 'forward')

  // 精校記錄同時是還原時的換算依據
  writeJson(logFile(id), {
    appliedAt: new Date().toISOString(),
    categories,
    removals
  } satisfies RefineLog)

  const book = getBook(id)
  if (book) saveBook({ ...book, charCount })

  return { removedLines, strippedFragments, removedChars, remappedBookmarks }
}

// ---------------------------------------------------------------- 還原

export async function revertRefine(id: string): Promise<boolean> {
  if (!existsSync(originalContent(id))) return false

  const log = readJson<RefineLog | null>(logFile(id), null)
  if (log) remapProgress(id, log.removals, 'backward')

  await copyFile(originalContent(id), contentFile(id))
  await copyFile(originalIndex(id), indexFile(id))
  await rm(originalContent(id), { force: true })
  await rm(originalIndex(id), { force: true })
  await rm(logFile(id), { force: true })

  const book = getBook(id)
  if (book) {
    const restored = readIndex(id)
    saveBook({ ...book, charCount: restored.chapters.reduce((n, c) => n + c.charCount, 0) })
  }
  return true
}
