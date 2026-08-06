/**
 * 把章節內文切成適合朗讀的小段。
 *
 * 為什麼要切：整章丟給語音引擎會有兩個問題 —— 開始播放前要等很久，
 * 而且暫停、跳段、進度回報的顆粒度都只能是「整章」。切成句子級別後，
 * 每一段都能單獨定位回原文位置，高亮與書籤才有辦法對齊。
 */

export interface TtsChunk {
  chapterId: number
  /** 章內起始字元位移，與段落的 data-offset 同一套座標 */
  start: number
  text: string
}

/** 一段的字數上限。太長會拖慢起播與暫停反應，太短會破壞語調的連貫 */
const MAX_CHARS = 160

/** 低於這個長度就不切，避免把「他說。」這種短句拆成獨立一段 */
const MIN_CHARS = 40

const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '…', '；', ';'])
const CLOSERS = new Set(['"', "'", '」', '』', '）', ')', '》', '】'])
const SOFT_BREAK = ['，', '、', ',', '：', ':']

interface Piece {
  offset: number
  text: string
}

function splitLine(line: string): Piece[] {
  const pieces: Piece[] = []
  let start = 0
  let i = 0

  const push = (end: number): void => {
    const text = line.slice(start, end)
    if (text.trim()) pieces.push({ offset: start, text })
    start = end
  }

  while (i < line.length) {
    const ch = line[i]!
    i++

    if (SENTENCE_END.has(ch)) {
      // 把緊跟在後的收尾引號一起帶走，不要讓右引號自己變成一段
      while (i < line.length && CLOSERS.has(line[i]!)) i++
      if (i - start >= MIN_CHARS) push(i)
      continue
    }

    if (i - start >= MAX_CHARS) {
      // 一路沒有句號的長句：退而求其次在逗號處斷開
      const seg = line.slice(start, i)
      let cut = -1
      for (const mark of SOFT_BREAK) cut = Math.max(cut, seg.lastIndexOf(mark))
      push(cut >= MIN_CHARS ? start + cut + 1 : i)
    }
  }
  push(line.length)
  return pieces
}

/**
 * body 是章節的正規化內文（段落以 \n 相連），
 * 位移演算法必須與 ChapterFlow 產生 data-offset 的方式完全一致。
 */
export function chunkChapter(chapterId: number, body: string): TtsChunk[] {
  const chunks: TtsChunk[] = []
  let lineStart = 0

  for (const line of body.split('\n')) {
    if (line.trim()) {
      for (const piece of splitLine(line)) {
        chunks.push({ chapterId, start: lineStart + piece.offset, text: piece.text })
      }
    }
    lineStart += line.length + 1 // +1 是被 split 吃掉的換行
  }
  return chunks
}

/** 找出涵蓋指定位移的段落索引，用來從閱讀位置接著唸 */
export function chunkAt(chunks: TtsChunk[], charOffset: number): number {
  let at = 0
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i]!.start <= charOffset) at = i
    else break
  }
  return at
}
