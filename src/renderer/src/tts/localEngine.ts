import type { TtsSettings } from '@shared/types'
import type { SpeakHandlers, SpeakOutcome, TtsEngine } from './engine'

/**
 * 離線引擎：Web Speech API，底層是 Windows 內建語音。
 *
 * canPause 是 false —— 實測 speechSynthesis.pause() 在 Windows 上
 * 會回報 paused=true，聲音卻繼續播（boundary 的 charIndex 在「暫停」
 * 期間仍持續前進）。所以暫停一律由控制器改用「取消 + 記住位置」，
 * 續讀時從記住的那個詞重新開始。
 */
export class LocalEngine implements TtsEngine {
  readonly id = 'local' as const
  readonly canPause = false

  private utterance: SpeechSynthesisUtterance | null = null
  private progress = 0

  speak(
    text: string,
    fromIndex: number,
    settings: TtsSettings,
    handlers: SpeakHandlers
  ): Promise<SpeakOutcome> {
    return new Promise((resolve) => {
      this.progress = fromIndex
      const body = text.slice(fromIndex)
      if (!body) {
        resolve('ended')
        return
      }

      const u = new SpeechSynthesisUtterance(body)
      const voice = speechSynthesis.getVoices().find((v) => v.name === settings.localVoice)
      if (voice) u.voice = voice
      u.lang = voice?.lang ?? 'zh-TW'
      // Web Speech 的 rate 上限是 10，但超過 3 幾乎聽不懂，界面本來就限制在 3
      u.rate = Math.min(10, Math.max(0.1, settings.rate))
      u.pitch = Math.min(2, Math.max(0, settings.pitch))
      u.volume = Math.min(1, Math.max(0, settings.volume))

      u.addEventListener('boundary', (e) => {
        // sentence 邊界的 charLength 是 0，只取 word
        if (e.name && e.name !== 'word') return
        this.progress = fromIndex + e.charIndex
        handlers.onWord?.(this.progress, e.charLength || 1)
      })

      u.addEventListener('end', () => {
        this.utterance = null
        resolve('ended')
      })

      u.addEventListener('error', (e) => {
        this.utterance = null
        // cancel() 造成的 interrupted 是正常流程，不是錯誤
        resolve(e.error === 'interrupted' || e.error === 'canceled' ? 'stopped' : 'failed')
      })

      this.utterance = u
      speechSynthesis.speak(u)
    })
  }

  stop(): number {
    if (this.utterance) {
      this.utterance = null
      speechSynthesis.cancel()
    }
    return this.progress
  }

  pause(): void {
    this.stop()
  }

  resume(): void {
    // 續讀由控制器重新呼叫 speak 處理
  }

  setVolume(): void {
    // 音量寫在 utterance 上，下一段才會套用
  }

  dispose(): void {
    speechSynthesis.cancel()
  }
}
