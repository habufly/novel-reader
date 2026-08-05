/**
 * 把來源檔清成「一行一段、無前導空白」的乾淨文字。
 *
 * 為什麼要去掉段首空白：實測兩個樣本檔有 99.3%～99.4% 的行本來就帶了全形空白縮排。
 * 閱讀器的縮排是用 CSS text-indent 控制的（要能跟著字級調整），
 * 如果保留來源的空白就會變成雙重縮排，而且字級一改就歪掉。
 */

export interface CleanupResult {
  lines: string[]
  junkLines: number
}

/** 站點廣告與轉檔殘留。只砍明確可辨識的樣式，寧可漏砍也不要誤砍正文 */
const JUNK_PATTERNS: RegExp[] = [
  // 含網址的行（樣本檔的「爱下电子书…https://ixdzs8.com」）
  /https?:\/\/\S/i,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i,
  // 「------章节内容开始-------」這類轉檔標記
  /^[-—─=＝*＊※_]{3,}.{0,20}(内容|內容|正文|全文|章节|章節)(开始|開始|结束|結束).{0,20}[-—─=＝*＊※_]{3,}$/,
  // 純符號分隔線
  /^[-—─=＝*＊※_~～]{4,}$/,
  // 電子書網站的頁尾宣傳
  /(电子书|電子書|下载全本|下載全本|txt下载|txt下載|更多好书|更多好書).{0,40}(访问|訪問|下载|下載|分享)/i
]

/** 段首縮排：全形空白 U+3000、半形空白、Tab、以及 NBSP */
const LEADING_INDENT = /^[　 \s]+/
const TRAILING_WS = /[　 \s]+$/

export function cleanup(text: string): CleanupResult {
  // 統一換行：CRLF / CR 都轉成 LF
  const normalized = text.replace(/\r\n?/g, '\n')

  const lines: string[] = []
  let junkLines = 0

  for (const raw of normalized.split('\n')) {
    const line = raw.replace(LEADING_INDENT, '').replace(TRAILING_WS, '')
    if (!line) continue // 空行不保留，一行就是一段

    if (JUNK_PATTERNS.some((re) => re.test(line))) {
      junkLines++
      continue
    }
    lines.push(line)
  }

  return { lines, junkLines }
}
