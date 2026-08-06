import type { TtsEngineId, TtsSettings } from '@shared/types'

export type SpeakOutcome = 'ended' | 'stopped' | 'failed'

export interface SpeakHandlers {
  /** charIndex 相對於整段 text 的起點，不是這次朗讀的起點 */
  onWord?: (charIndex: number, length: number) => void
}

export interface TtsEngine {
  readonly id: TtsEngineId
  /** 引擎能否自行暫停。做不到的話由控制器改用「停止 + 記住位置」 */
  readonly canPause: boolean

  /** 從 text 的 fromIndex 開始朗讀，唸完或被中斷才 resolve */
  speak(
    text: string,
    fromIndex: number,
    settings: TtsSettings,
    handlers: SpeakHandlers
  ): Promise<SpeakOutcome>

  /** 停止朗讀，回傳已經唸到的字元位移，供續讀使用 */
  stop(): number

  pause(): void
  resume(): void
  setVolume(volume: number): void
  dispose(): void
}

/**
 * 等待語音清單就緒。
 *
 * 不能只信 voiceschanged：實測它會在平台列舉完成前就先觸發一次，
 * 當下 getVoices() 仍是空陣列，要再等數秒才會填好。所以改用輪詢。
 */
export async function loadLocalVoices(timeoutMs = 10_000): Promise<SpeechSynthesisVoice[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const voices = speechSynthesis.getVoices()
    if (voices.length) return voices
    await new Promise((r) => setTimeout(r, 250))
  }
  return speechSynthesis.getVoices()
}

export function isChineseVoice(v: SpeechSynthesisVoice): boolean {
  return /^zh/i.test(v.lang)
}
