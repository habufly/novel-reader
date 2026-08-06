import type { TtsSettings, WordBoundary } from '@shared/types'
import type { SpeakHandlers, SpeakOutcome, TtsEngine } from './engine'

/**
 * 線上引擎：微軟 Edge 的神經語音。
 *
 * 合成在主行程完成（回傳 MP3 位元組），這裡只負責播放。因為播放走
 * <audio>，暫停、續播、變速都是原生行為，比離線引擎可靠。
 *
 * 這是非官方介面，合成失敗時 speak() 回傳 'failed'，由控制器降級回
 * 離線引擎 —— 聽書中途絕不能變成無聲。
 */
export class EdgeEngine implements TtsEngine {
  readonly id = 'edge' as const
  readonly canPause = true

  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private raf = 0
  private baseIndex = 0
  private progress = 0

  private cleanup(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.audio) {
      this.audio.pause()
      this.audio.src = ''
      this.audio = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }

  async speak(
    text: string,
    fromIndex: number,
    settings: TtsSettings,
    handlers: SpeakHandlers
  ): Promise<SpeakOutcome> {
    this.cleanup()
    this.baseIndex = fromIndex
    this.progress = fromIndex
    const body = text.slice(fromIndex)
    if (!body) return 'ended'

    let payload: { audio: Uint8Array; boundaries: WordBoundary[] }
    try {
      // 速度交給 playbackRate 即時控制，SSML 這邊只調音高
      payload = await window.api.tts.synthesize(body, settings.edgeVoice, 0, pitchPercent(settings.pitch))
    } catch {
      return 'failed'
    }
    if (!payload.audio?.length) return 'failed'

    // 複製一份到獨立的 ArrayBuffer：IPC 送過來的 view 型別不保證是 Blob 接受的
    const bytes = Uint8Array.from(payload.audio)
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/mpeg' })
    this.objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(this.objectUrl)
    audio.playbackRate = Math.min(4, Math.max(0.25, settings.rate))
    audio.volume = Math.min(1, Math.max(0, settings.volume))
    this.audio = audio

    // 詞邊界只給文字與時間點，要對回原文才知道位移
    const marks = mapBoundaries(body, payload.boundaries)

    return new Promise<SpeakOutcome>((resolve) => {
      let done = false
      const finish = (outcome: SpeakOutcome): void => {
        if (done) return
        done = true
        cancelAnimationFrame(this.raf)
        resolve(outcome)
      }

      audio.addEventListener('ended', () => finish('ended'))
      audio.addEventListener('error', () => finish('failed'))

      let at = 0
      const tick = (): void => {
        if (done) return
        const ms = audio.currentTime * 1000
        while (at < marks.length && marks[at]!.timeMs <= ms) {
          const m = marks[at]!
          this.progress = this.baseIndex + m.charIndex
          handlers.onWord?.(this.progress, m.length)
          at++
        }
        this.raf = requestAnimationFrame(tick)
      }

      void audio.play().then(
        () => {
          this.raf = requestAnimationFrame(tick)
        },
        () => finish('failed')
      )
    })
  }

  stop(): number {
    this.cleanup()
    return this.progress
  }

  pause(): void {
    this.audio?.pause()
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  resume(): void {
    if (!this.audio) return
    void this.audio.play()
  }

  setVolume(volume: number): void {
    if (this.audio) this.audio.volume = Math.min(1, Math.max(0, volume))
  }

  dispose(): void {
    this.cleanup()
  }
}

function pitchPercent(pitch: number): number {
  // 介面用的是 0–2 倍率，SSML 要的是相對半音高的百分比
  return Math.round((pitch - 1) * 50)
}

/**
 * 把詞邊界對回原文位置。
 * 不能直接累加各詞長度 —— 詞與詞之間的標點不會出現在邊界資料裡，
 * 累加下來位移會愈偏愈多。改成依序在原文中往後尋找該詞。
 */
function mapBoundaries(
  text: string,
  boundaries: WordBoundary[]
): Array<{ timeMs: number; charIndex: number; length: number }> {
  const out: Array<{ timeMs: number; charIndex: number; length: number }> = []
  let cursor = 0
  for (const b of boundaries) {
    if (!b.text) continue
    const at = text.indexOf(b.text, cursor)
    if (at === -1) continue // 對不上就跳過，寧可少一次高亮也不要標錯位置
    out.push({ timeMs: b.timeMs, charIndex: at, length: b.text.length })
    cursor = at + b.text.length
  }
  return out
}
