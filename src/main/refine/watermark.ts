/**
 * 盜版站浮水印字偵測。
 *
 * 有些來源會在段落結尾插一個與內容無關的罕用字當追蹤標記，例如
 * 「陆尧看向像素世界的三花猫。阑」。七本樣本裡兩本中標，
 * 神明模拟器用了「阑」「膑」「餫」三個字輪替，灭运图录用「纟」。
 *
 * 字元清單不能寫死 —— 每個來源用的字不同，換一本書就換一組。
 * 改用統計判定，理由是這種字的分佈有明確的物理特徵：
 *
 *   一行約 30 字，所以任何「正常」的字出現在行中的次數，
 *   本來就會是它出現在行尾的 20～40 倍（實測：亿 22.0、万 40.6）。
 *   浮水印字沒有語法上的理由出現在句子中間，比值趨近 0
 *   （實測：膑 0.0、餫 0.0、纟 0.0、阑 0.037）。
 *
 * 兩群之間隔了三個數量級，門檻取 0.5 —— 比最低的正常字低 40 倍，
 * 比最高的浮水印字高 13 倍，兩邊都不必貼著邊界。
 */

/** 行尾至少要出現這麼多次才考慮，避免把偶發的東西當成標記 */
const MIN_END = 5

/** 行中次數 ÷ 行尾次數，超過就判定是正常用字 */
const MAX_MID_RATIO = 0.5

const HAN = /\p{Script=Han}/u

/**
 * 從整本書的內文找出浮水印字。
 *
 * 只看漢字：標點與省略號本來就常在行尾，不列入考慮。
 */
export function detectWatermarks(bodies: string[]): string[] {
  const end = new Map<string, number>()
  const mid = new Map<string, number>()

  for (const body of bodies) {
    for (const line of body.split('\n')) {
      if (!line) continue
      const chars = [...line]
      const last = chars[chars.length - 1]!
      if (HAN.test(last)) end.set(last, (end.get(last) ?? 0) + 1)
      for (let i = 0; i < chars.length - 1; i++) {
        const ch = chars[i]!
        if (HAN.test(ch)) mid.set(ch, (mid.get(ch) ?? 0) + 1)
      }
    }
  }

  const found: string[] = []
  for (const [ch, n] of end) {
    if (n < MIN_END) continue
    if ((mid.get(ch) ?? 0) > n * MAX_MID_RATIO) continue
    found.push(ch)
  }
  // 命中多的排前面，樣本才會先顯示最有代表性的
  return found.sort((a, b) => (end.get(b) ?? 0) - (end.get(a) ?? 0))
}

/**
 * 把行尾的浮水印字拿掉。
 *
 * 只動行尾：同一個字出現在句子中間時是真的用字（「意兴阑珊」在
 * 神明模拟器裡出現三次），不能碰。連續拿是為了保險，實測沒看過疊兩個。
 */
export function stripWatermark(line: string, marks: Set<string>): string {
  let out = line
  while (out.length > 0) {
    const chars = [...out]
    const last = chars[chars.length - 1]!
    if (!marks.has(last)) break
    out = chars.slice(0, -1).join('')
  }
  return out
}
