/**
 * 把章節內文切成適合朗讀的小段。
 *
 * 為什麼要切：整章丟給語音引擎會有兩個問題 —— 開始播放前要等很久，
 * 而且暫停、跳段、進度回報的顆粒度都只能是「整章」。切成段落級別後，
 * 每一段都能單獨定位回原文位置，高亮與書籤才有辦法對齊。
 *
 * 為什麼是這個長度：實測 Windows 語音每換一段都有約 700ms 的固定間隔，
 * 而且這個間隔不隨段落長短改變。45 字的段落等於每 6 秒卡一次（佔 11%
 * 的時間），250 字則是每 32 秒才卡一次（佔 2.3%）。所以段落要盡量長，
 * 只在句號處斷，並且允許跨越段落換行 —— 否則對話密集的地方
 * （「好。」「嗯。」各自一行）會變成每兩秒就卡一次。
 */

export interface TtsChunk {
  chapterId: number
  /** 章內起始字元位移，與段落的 data-offset 同一套座標 */
  start: number
  text: string
}

/** 一段的字數上限。再長下去暫停與跳段的反應會變遲鈍 */
const MAX_CHARS = 280

/** 累積到這個長度之前不切，讓短句與短段落合併成一段唸完 */
const MIN_CHARS = 110

const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '…', '；', ';'])
const CLOSERS = new Set(['"', "'", '」', '』', '）', ')', '》', '】'])
const SOFT_BREAK = ['，', '、', ',', '：', ':']

/**
 * body 是章節的正規化內文（段落以 \n 相連）。
 * 位移演算法必須與 ChapterFlow 產生 data-offset 的方式完全一致：
 * 直接在整份內文上切，段落換行只是眾多斷點之一。
 */
export function chunkChapter(chapterId: number, body: string): TtsChunk[] {
  const chunks: TtsChunk[] = []
  let start = 0
  let i = 0

  const emit = (end: number): void => {
    const text = body.slice(start, end)
    if (text.trim()) chunks.push({ chapterId, start, text })
    start = end
  }

  while (i < body.length) {
    const ch = body[i]!
    i++

    if (ch === '\n' || SENTENCE_END.has(ch)) {
      // 把緊跟在後的收尾引號一起帶走，不要讓右引號自己變成一段
      if (ch !== '\n') {
        while (i < body.length && CLOSERS.has(body[i]!)) i++
      }
      if (i - start >= MIN_CHARS) emit(i)
      continue
    }

    if (i - start >= MAX_CHARS) {
      // 一路沒有句號的長句：退而求其次在逗號處斷開
      const seg = body.slice(start, i)
      let cut = -1
      for (const mark of SOFT_BREAK) cut = Math.max(cut, seg.lastIndexOf(mark))
      emit(cut >= MIN_CHARS ? start + cut + 1 : i)
    }
  }
  emit(body.length)
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
