import { ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_TTS, type EdgeVoice, type SynthesisPayload, type TtsSettings } from '@shared/types'
import { dataPath, readJson, writeJson } from '../storage/jsonStore'
import { listEdgeVoices, synthesize } from '../tts/edgeTts'

const settingsFile = (): string => dataPath('tts.json')
const cacheDir = (): string => dataPath('tts-cache')

function loadTtsSettings(): TtsSettings {
  return { ...DEFAULT_TTS, ...readJson<Partial<TtsSettings>>(settingsFile(), {}) }
}

/** 線上合成有網路成本，同一段重聽就直接讀快取 */
function cacheKey(text: string, voice: string, rate: number, pitch: number): string {
  return createHash('sha1').update(`${voice}|${rate}|${pitch}|${text}`, 'utf-8').digest('hex')
}

interface CachedMeta {
  boundaries: SynthesisPayload['boundaries']
}

export function registerTtsIpc(): void {
  ipcMain.handle('tts:getSettings', (): TtsSettings => loadTtsSettings())

  ipcMain.handle('tts:setSettings', (_e, patch: Partial<TtsSettings>): TtsSettings => {
    const next = { ...loadTtsSettings(), ...patch }
    writeJson(settingsFile(), next)
    return next
  })

  ipcMain.handle('tts:edgeVoices', (): Promise<EdgeVoice[]> => listEdgeVoices())

  ipcMain.handle(
    'tts:synthesize',
    async (_e, text: string, voice: string, rate: number, pitch: number): Promise<SynthesisPayload> => {
      const key = cacheKey(text, voice, rate, pitch)
      const dir = cacheDir()
      const mp3 = join(dir, `${key}.mp3`)
      const meta = join(dir, `${key}.json`)

      try {
        const [audio, raw] = await Promise.all([readFile(mp3), readFile(meta, 'utf-8')])
        return { audio, boundaries: (JSON.parse(raw) as CachedMeta).boundaries }
      } catch {
        // 沒有快取就去合成
      }

      const result = await synthesize(text, voice, rate, pitch)
      try {
        await mkdir(dir, { recursive: true })
        await Promise.all([
          writeFile(mp3, result.audio),
          writeFile(meta, JSON.stringify({ boundaries: result.boundaries }), 'utf-8')
        ])
      } catch (err) {
        console.warn('[tts] 快取寫入失敗，不影響播放', err)
      }
      return { audio: result.audio, boundaries: result.boundaries }
    }
  )
}
