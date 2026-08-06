import { create } from 'zustand'
import { DEFAULT_TTS, type EdgeVoice, type TtsEngineId, type TtsSettings } from '@shared/types'
import { chunkAt, chunkChapter, type TtsChunk } from '../tts/chunker'
import { loadLocalVoices, type TtsEngine } from '../tts/engine'
import { LocalEngine } from '../tts/localEngine'
import { EdgeEngine } from '../tts/edgeEngine'
import { clearHighlights, highlightChunk, highlightWord, scrollToSpoken } from '../tts/highlight'
import { useReader } from './useReader'

export type SleepMode = 'off' | '15' | '30' | '60' | 'chapter'

interface TtsState {
  /** 控制列是否顯示 */
  open: boolean
  playing: boolean
  /** 引擎沒有真正的暫停能力時，這裡記著續讀點 */
  paused: boolean

  chunks: TtsChunk[]
  index: number
  /** 目前這段已經唸到的字元位移（段內相對值） */
  resumeAt: number

  settings: TtsSettings
  localVoices: Array<{ name: string; lang: string }>
  edgeVoices: EdgeVoice[]
  /** 降級或錯誤提示，顯示在控制列上 */
  notice: string | null

  sleepMode: SleepMode
  sleepUntil: number | null

  init: () => Promise<void>
  start: () => Promise<void>
  toggle: () => Promise<void>
  stop: () => void
  skip: (delta: number) => Promise<void>
  patch: (p: Partial<TtsSettings>) => Promise<void>
  setSleep: (mode: SleepMode) => void
  setOpen: (open: boolean) => void
  loadEdgeVoices: () => Promise<void>
}

let engine: TtsEngine | null = null
/** 遞增的世代編號：停止或跳段後，舊的播放迴圈靠它自我了結 */
let generation = 0

function makeEngine(id: TtsEngineId): TtsEngine {
  return id === 'edge' ? new EdgeEngine() : new LocalEngine()
}

export const useTts = create<TtsState>((set, get) => ({
  open: false,
  playing: false,
  paused: false,
  chunks: [],
  index: 0,
  resumeAt: 0,
  settings: DEFAULT_TTS,
  localVoices: [],
  edgeVoices: [],
  notice: null,
  sleepMode: 'off',
  sleepUntil: null,

  init: async () => {
    const settings = await window.api.tts.getSettings()
    const voices = await loadLocalVoices()
    const list = voices.map((v) => ({ name: v.name, lang: v.lang }))
    const zh = list.filter((v) => /^zh/i.test(v.lang))

    // 沒選過語音就自動挑一個中文的，使用者不必先進設定才能用
    let localVoice = settings.localVoice
    if (!localVoice || !list.some((v) => v.name === localVoice)) {
      localVoice = zh[0]?.name ?? list[0]?.name ?? ''
    }

    set({
      settings: { ...settings, localVoice },
      localVoices: list,
      notice: zh.length
        ? null
        : '系統沒有安裝中文語音。請到 Windows 設定 → 時間與語言 → 語音 → 新增語音，安裝中文語音套件。'
    })
    if (localVoice !== settings.localVoice) await window.api.tts.setSettings({ localVoice })
  },

  loadEdgeVoices: async () => {
    try {
      const voices = await window.api.tts.edgeVoices()
      set({ edgeVoices: voices.filter((v) => v.locale.startsWith('zh')) })
    } catch (err) {
      set({ notice: `線上語音清單取得失敗：${err instanceof Error ? err.message : String(err)}` })
    }
  },

  start: async () => {
    const reader = useReader.getState()
    const { book, chapters, current, texts } = reader
    if (!book || !chapters.length) return

    const body = texts[current.chapterId] ?? (await window.api.book.chapter(book.id, current.chapterId))
    const chunks = chunkChapter(current.chapterId, body)
    if (!chunks.length) return

    set({
      chunks,
      index: chunkAt(chunks, current.charOffset),
      resumeAt: 0,
      playing: true,
      paused: false,
      open: true
    })
    void runLoop(++generation, set, get)
  },

  toggle: async () => {
    const { playing, chunks } = get()
    if (playing) {
      // 離線引擎沒有可靠的暫停，一律停下來並記住續讀點
      const at = engine?.stop() ?? 0
      generation++
      set({ playing: false, paused: true, resumeAt: at })
      return
    }
    if (!chunks.length) {
      await get().start()
      return
    }
    set({ playing: true, paused: false })
    void runLoop(++generation, set, get)
  },

  stop: () => {
    generation++
    engine?.stop()
    engine?.dispose()
    engine = null
    clearHighlights()
    set({ playing: false, paused: false, chunks: [], index: 0, resumeAt: 0, sleepUntil: null, sleepMode: 'off' })
  },

  skip: async (delta) => {
    const { chunks, index, playing } = get()
    if (!chunks.length) return
    const next = Math.min(chunks.length - 1, Math.max(0, index + delta))
    engine?.stop()
    generation++
    set({ index: next, resumeAt: 0 })
    if (playing) void runLoop(++generation, set, get)
    else {
      const c = chunks[next]!
      highlightChunk({ chapterId: c.chapterId, start: c.start, length: c.text.length })
    }
  },

  patch: async (p) => {
    const settings = { ...get().settings, ...p }
    set({ settings })
    await window.api.tts.setSettings(p)

    if (p.volume !== undefined) engine?.setVolume(p.volume)

    // 換引擎或改速度都必須重新開始這一段：Web Speech 的語速無法中途調整
    const needsRestart =
      p.engine !== undefined || p.rate !== undefined || p.pitch !== undefined || p.localVoice !== undefined || p.edgeVoice !== undefined
    if (needsRestart && get().playing) {
      const at = engine?.stop() ?? 0
      if (p.engine !== undefined) {
        engine?.dispose()
        engine = null
      }
      generation++
      set({ resumeAt: at })
      void runLoop(++generation, set, get)
    }
  },

  setSleep: (mode) => {
    const minutes = mode === '15' ? 15 : mode === '30' ? 30 : mode === '60' ? 60 : 0
    set({ sleepMode: mode, sleepUntil: minutes ? Date.now() + minutes * 60_000 : null })
  },

  setOpen: (open) => set({ open })
}))

type Setter = (partial: Partial<TtsState>) => void

/**
 * 播放主迴圈。
 *
 * 每唸完一段就檢查一次世代編號 —— 使用者按下暫停、跳段或換引擎時會遞增它，
 * 舊迴圈發現編號對不上就自行結束，避免兩個迴圈同時搶著唸。
 */
async function runLoop(gen: number, set: Setter, get: () => TtsState): Promise<void> {
  while (gen === generation && get().playing) {
    const state = get()
    const { chunks, index, settings } = state

    if (index >= chunks.length) {
      const advanced = await advanceChapter(set, get)
      if (!advanced) break
      continue
    }

    const chunk = chunks[index]!
    if (!engine || engine.id !== settings.engine) {
      engine?.dispose()
      engine = makeEngine(settings.engine)
    }

    // 朗讀位置就是閱讀位置，自動書籤才會跟著唸到哪停到哪
    useReader.getState().setCurrent({ chapterId: chunk.chapterId, charOffset: chunk.start })

    const el = highlightChunk({
      chapterId: chunk.chapterId,
      start: chunk.start,
      length: chunk.text.length
    })
    if (el && settings.autoScroll) scrollToSpoken(el)

    const outcome = await engine.speak(chunk.text, get().resumeAt, settings, {
      onWord: (charIndex, length) => {
        if (gen !== generation || !get().settings.highlightWords) return
        highlightWord({ chapterId: chunk.chapterId, start: chunk.start + charIndex, length })
      }
    })

    if (gen !== generation) return
    if (outcome === 'stopped') return

    if (outcome === 'failed') {
      // 線上引擎掛掉就自動降級，絕不讓聽書變成無聲
      if (settings.engine === 'edge') {
        engine?.dispose()
        engine = null
        set({
          settings: { ...get().settings, engine: 'local' },
          notice: '線上語音無法使用，已自動切回離線語音。'
        })
        await window.api.tts.setSettings({ engine: 'local' })
        continue
      }
      set({ playing: false, notice: '語音引擎發生錯誤，朗讀已停止。' })
      return
    }

    set({ index: get().index + 1, resumeAt: 0 })

    const s = get()
    if (s.sleepUntil && Date.now() >= s.sleepUntil) {
      stopFromTimer(set, '睡眠計時時間到，朗讀已停止。')
      return
    }
  }
}

/** 目前章節唸完後接續下一章 */
async function advanceChapter(set: Setter, get: () => TtsState): Promise<boolean> {
  const reader = useReader.getState()
  const last = get().chunks.at(-1)
  const nextId = (last?.chapterId ?? reader.current.chapterId) + 1

  if (get().sleepMode === 'chapter') {
    stopFromTimer(set, '本章結束，朗讀已停止。')
    return false
  }
  if (!reader.book || nextId >= reader.chapters.length) {
    stopFromTimer(set, '已經是最後一章。')
    return false
  }

  // 讓畫面跟著換章；不記入跳轉歷史，否則連播會把歷史塞滿
  await reader.jumpTo(nextId, 0, { recordHistory: false })
  const body =
    useReader.getState().texts[nextId] ?? (await window.api.book.chapter(reader.book.id, nextId))
  const chunks = chunkChapter(nextId, body)
  if (!chunks.length) return false

  set({ chunks, index: 0, resumeAt: 0 })
  return true
}

function stopFromTimer(set: Setter, notice: string): void {
  generation++
  engine?.stop()
  clearHighlights()
  set({ playing: false, paused: false, notice, sleepUntil: null, sleepMode: 'off' })
}
