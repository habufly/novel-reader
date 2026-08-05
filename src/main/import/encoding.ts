import jschardet from 'jschardet'
import iconv from 'iconv-lite'
import type { EncodingGuess } from '@shared/types'

/** 匯入對話框下拉選單提供的手動選項，順序即常見程度 */
export const SUPPORTED_ENCODINGS = [
  'utf-8',
  'gb18030',
  'big5',
  'utf-16le',
  'utf-16be',
  'shift_jis',
  'euc-kr',
  'windows-1252'
] as const

const BOMS: Array<{ encoding: string; bytes: number[] }> = [
  { encoding: 'utf-8', bytes: [0xef, 0xbb, 0xbf] },
  { encoding: 'utf-16le', bytes: [0xff, 0xfe] },
  { encoding: 'utf-16be', bytes: [0xfe, 0xff] }
]

function matchBom(buf: Buffer): string | null {
  for (const { encoding, bytes } of BOMS) {
    if (buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b)) return encoding
  }
  return null
}

interface Utf8Check {
  valid: boolean
  /** 有幾個多位元組序列。純 ASCII 檔案無從分辨編碼，這個值會是 0 */
  multibyte: number
}

/**
 * 逐位元組驗證是否為合法 UTF-8。
 *
 * 這比統計式偵測可靠得多：Big5／GBK 的位元組流幾乎不可能碰巧滿足
 * UTF-8 的續接位元組規則（每個後續位元組都必須是 10xxxxxx），
 * 一整本小說更是不可能。所以只要驗證通過且含多位元組序列，就可以直接斷定是 UTF-8。
 *
 * 實測也證明有必要：jschardet 對其中一個樣本檔的中段與尾段都回傳 null，
 * 只靠取樣偵測會誤判。
 */
function checkUtf8(buf: Buffer): Utf8Check {
  let i = 0
  let multibyte = 0
  while (i < buf.length) {
    const b = buf[i]!
    if (b < 0x80) {
      i++
      continue
    }
    let len: number
    if ((b & 0xe0) === 0xc0) len = 2
    else if ((b & 0xf0) === 0xe0) len = 3
    else if ((b & 0xf8) === 0xf0) len = 4
    else return { valid: false, multibyte }

    if (i + len > buf.length) break // 檔尾被截斷不算錯
    for (let k = 1; k < len; k++) {
      if ((buf[i + k]! & 0xc0) !== 0x80) return { valid: false, multibyte }
    }
    multibyte++
    i += len
  }
  return { valid: true, multibyte }
}

/** jschardet 的名稱對到 iconv-lite 認得的名稱 */
function normalizeName(name: string | null): string | null {
  if (!name) return null
  const n = name.toLowerCase().replace(/_/g, '-')
  // GB2312/GBK 都是 GB18030 的子集，統一用 GB18030 解碼可以避免缺字
  if (n === 'gb2312' || n === 'gbk' || n === 'gb18030') return 'gb18030'
  if (n === 'big5' || n === 'big5-hkscs') return 'big5'
  if (n === 'ascii') return 'utf-8'
  if (!iconv.encodingExists(n)) return null
  return n
}

export function detectEncoding(buf: Buffer): EncodingGuess {
  const bom = matchBom(buf)
  if (bom) {
    return { encoding: bom, source: 'bom', confidence: 1, candidates: [...SUPPORTED_ENCODINGS] }
  }

  // 全檔驗證而非取樣：11MB 大約 30ms，換來的確定性值得
  const utf8 = checkUtf8(buf)
  if (utf8.valid && utf8.multibyte > 0) {
    return { encoding: 'utf-8', source: 'utf8', confidence: 1, candidates: [...SUPPORTED_ENCODINGS] }
  }

  // 不是 UTF-8，交給統計式偵測。取頭中尾三段投票，降低單點誤判
  const size = buf.length
  const slice = 256 * 1024
  const samples = [
    buf.subarray(0, Math.min(slice, size)),
    buf.subarray(Math.max(0, (size >> 1) - slice / 2), Math.max(0, (size >> 1) + slice / 2)),
    buf.subarray(Math.max(0, size - slice))
  ]

  const votes = new Map<string, number>()
  for (const s of samples) {
    if (s.length === 0) continue
    const d = jschardet.detect(s)
    const name = normalizeName(d?.encoding ?? null)
    if (!name) continue
    votes.set(name, (votes.get(name) ?? 0) + (d.confidence ?? 0))
  }

  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best) {
    // 完全測不出來時，中文環境下 GB18030 覆蓋面最廣，當保底
    return { encoding: 'gb18030', source: 'detected', confidence: 0, candidates: [...SUPPORTED_ENCODINGS] }
  }

  return {
    encoding: best[0],
    source: 'detected',
    confidence: Math.min(1, best[1] / samples.length),
    candidates: [...SUPPORTED_ENCODINGS]
  }
}

export function decode(buf: Buffer, encoding: string): string {
  const text = iconv.decode(buf, encoding)
  // iconv-lite 不會自動去 BOM，留著會變成內文第一個字元
  return text.replace(/^\uFEFF/, '')
}

/** 亂碼比例。解錯編碼時會出現大量 U+FFFD，用來提醒使用者換一個編碼試試 */
export function replacementRatio(text: string): number {
  if (!text.length) return 0
  const bad = text.match(/\uFFFD/g)?.length ?? 0
  return bad / text.length
}
