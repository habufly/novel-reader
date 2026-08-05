// 產生 build/icon.ico：深色書本外框 + 金色書籤緞帶，與 UI 的 placeholder__mark 同一個造型。
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const OUT = resolve(process.argv[2] ?? 'build/icon.ico')
const SIZES = [256, 128, 64, 48, 32, 16]

const BG = [0x1e, 0x1e, 0x24]
const ACCENT = [0xc9, 0xa2, 0x27]

// ---------- PNG ----------
const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1)
    raw[at] = 0 // filter: none
    rgba.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- 造型 ----------
/** 圓角矩形的帶號距離場：< 0 在內部 */
function roundRectSdf(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hx = (x1 - x0) / 2 - r
  const hy = (y1 - y0) / 2 - r
  const dx = Math.abs(px - cx) - hx
  const dy = Math.abs(py - cy) - hy
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - r
}

/** 以 1000x1000 的設計座標取樣，回傳 [r,g,b,a] */
function sample(x, y) {
  const card = roundRectSdf(x, y, 155, 110, 845, 890, 62)
  const strokeW = 62

  // 書籤緞帶：底部收出一個 V 形缺口
  const rx0 = 585
  const rx1 = 700
  const ry0 = 110
  const ry1 = 460
  const notch = 110
  const halfW = (rx1 - rx0) / 2
  const cx = (rx0 + rx1) / 2
  const ribbonBottom = ry1 - notch * (1 - Math.abs(x - cx) / halfW)
  const inRibbon = x >= rx0 && x <= rx1 && y >= ry0 && y <= ribbonBottom

  // 書脊
  const inSpine = x >= 268 && x <= 322 && y >= 110 && y <= 890

  if (inRibbon) return [...ACCENT, 255]
  if (Math.abs(card) <= strokeW / 2) return [...ACCENT, 255]
  if (inSpine && card < 0) return [...ACCENT, 255]
  if (card < 0) return [...BG, 255]
  return [0, 0, 0, 0]
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4)
  const SS = 4 // 超取樣倍率，用來做反鋸齒
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 1000
          const y = ((py + (sy + 0.5) / SS) / size) * 1000
          const [sr, sg, sb, sa] = sample(x, y)
          const w = sa / 255
          r += sr * w
          g += sg * w
          b += sb * w
          a += sa
        }
      }
      const n = SS * SS
      const alpha = a / n
      const at = (py * size + px) * 4
      // 以覆蓋率為權重取平均，避免透明邊緣帶出黑邊
      const wsum = a / 255 || 1
      buf[at] = Math.round(r / wsum)
      buf[at + 1] = Math.round(g / wsum)
      buf[at + 2] = Math.round(b / wsum)
      buf[at + 3] = Math.round(alpha)
    }
  }
  return buf
}

// ---------- ICO ----------
const images = SIZES.map((size) => ({ size, png: encodePng(size, size, render(size)) }))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(images.length, 4)

let offset = 6 + images.length * 16
const entries = []
for (const { size, png } of images) {
  const e = Buffer.alloc(16)
  e[0] = size >= 256 ? 0 : size // 0 代表 256
  e[1] = size >= 256 ? 0 : size
  e[2] = 0 // 調色盤色數
  e[3] = 0 // reserved
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(png.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += png.length
  entries.push(e)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, Buffer.concat([header, ...entries, ...images.map((i) => i.png)]))
console.log(`寫入 ${OUT}（${SIZES.join(', ')}，共 ${offset} bytes）`)
