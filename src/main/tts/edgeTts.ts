import { createHash, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { EdgeVoice, WordBoundary } from '@shared/types'

/**
 * 微軟 Edge 瀏覽器「大聲朗讀」所用的線上神經語音。
 *
 * 這是非官方介面，隨時可能改動或失效，所以呼叫端一律要準備好降級回
 * 離線引擎。合成結果會快取，重聽同一段不必再連線。
 */

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud'
const GEC_VERSION = '1-131.0.2903.99'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'

/**
 * 服務端要求的防濫用權杖：把 Windows FILETIME 刻度無條件捨去到 5 分鐘，
 * 接上共用字串後取 SHA-256。時鐘偏差超過 5 分鐘就會被拒絕。
 */
function secMsGec(): string {
  const unixTicks = BigInt(Math.floor(Date.now() / 1000) + 11_644_473_600) * 10_000_000n
  const rounded = unixTicks - (unixTicks % 3_000_000_000n)
  return createHash('sha256')
    .update(`${rounded}${TRUSTED_TOKEN}`, 'ascii')
    .digest('hex')
    .toUpperCase()
}

function commonQuery(): string {
  return `TrustedClientToken=${TRUSTED_TOKEN}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${GEC_VERSION}`
}

const HEADERS = {
  'User-Agent': UA,
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  'Accept-Language': 'zh-TW,zh;q=0.9'
}

export async function listEdgeVoices(): Promise<EdgeVoice[]> {
  const url = `https://${BASE}/voices/list?${commonQuery()}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`語音清單取得失敗：HTTP ${res.status}`)
  const raw = (await res.json()) as Array<{
    Name: string
    ShortName: string
    Gender: string
    Locale: string
    FriendlyName: string
  }>
  return raw.map((v) => ({
    shortName: v.ShortName,
    locale: v.Locale,
    gender: v.Gender,
    label: v.FriendlyName.replace(/^Microsoft\s+/, '').replace(/\s+Online.*$/, '')
  }))
}

export interface SynthesisResult {
  /** MP3 位元組 */
  audio: Buffer
  boundaries: WordBoundary[]
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** rate/pitch 以百分比表示，0 為原速 */
function ssml(text: string, voice: string, ratePct: number, pitchPct: number): string {
  const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`)
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-TW'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${sign(ratePct)}%' pitch='${sign(pitchPct)}Hz'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`
  )
}

/** 訊息以 \r\n 分隔標頭與內容，這裡只取出需要的標頭值 */
function headerValue(block: string, key: string): string | undefined {
  return block.match(new RegExp(`${key}:(.*?)\r\n`))?.[1]
}

export function synthesize(
  text: string,
  voice: string,
  ratePct: number,
  pitchPct: number,
  timeoutMs = 20_000
): Promise<SynthesisResult> {
  return new Promise((resolve, reject) => {
    const url = `wss://${BASE}/edge/v1?${commonQuery()}`
    const ws = new WebSocket(url, { headers: HEADERS })

    const chunks: Buffer[] = []
    const boundaries: WordBoundary[] = []
    let settled = false

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* 已經斷線就算了 */
      }
      if (err) reject(err)
      else resolve({ audio: Buffer.concat(chunks), boundaries })
    }

    const timer = setTimeout(() => finish(new Error('線上語音合成逾時')), timeoutMs)

    ws.on('open', () => {
      const stamp = new Date().toISOString()
      ws.send(
        `X-Timestamp:${stamp}\r\nContent-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
                }
              }
            }
          })
      )
      ws.send(
        `X-RequestId:${randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${stamp}Z\r\nPath:ssml\r\n\r\n${ssml(text, voice, ratePct, pitchPct)}`
      )
    })

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // 二進位訊框：前兩個位元組是標頭長度，之後才是音訊
        const headerLen = data.readUInt16BE(0)
        chunks.push(data.subarray(2 + headerLen))
        return
      }
      const msg = data.toString('utf-8')
      const path = headerValue(msg, 'Path')?.trim()
      if (path === 'audio.metadata') {
        const body = msg.slice(msg.indexOf('\r\n\r\n') + 4)
        try {
          const meta = JSON.parse(body) as {
            Metadata: Array<{
              Type: string
              Data: { Offset: number; Duration: number; text: { Text: string; Length: number } }
            }>
          }
          for (const m of meta.Metadata) {
            if (m.Type !== 'WordBoundary') continue
            boundaries.push({
              // Offset 單位是 100 奈秒，換算成毫秒才好對上 <audio>.currentTime
              timeMs: m.Data.Offset / 10_000,
              text: m.Data.text.Text,
              length: m.Data.text.Length
            })
          }
        } catch {
          // metadata 解析失敗只影響高亮，音訊照樣可以播
        }
      } else if (path === 'turn.end') {
        finish()
      }
    })

    ws.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))))
    ws.on('close', (code) => {
      if (!settled) finish(new Error(`連線中斷（code ${code}）`))
    })
  })
}
