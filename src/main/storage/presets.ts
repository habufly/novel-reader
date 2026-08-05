import { randomUUID } from 'node:crypto'
import type { ReaderPreset, ReaderSettings } from '@shared/types'
import { dataPath, readJson, writeJson } from './jsonStore'

interface PresetFile {
  presets: ReaderPreset[]
}

const file = (): string => dataPath('presets.json')

export function listPresets(): ReaderPreset[] {
  return readJson<PresetFile>(file(), { presets: [] }).presets
}

/** 同名就覆寫，避免使用者反覆存檔時堆出一堆重複項目 */
export function savePreset(name: string, settings: ReaderSettings): ReaderPreset[] {
  const trimmed = name.trim() || '未命名'
  const presets = listPresets()
  const at = presets.findIndex((p) => p.name === trimmed)
  const preset: ReaderPreset = {
    id: at >= 0 ? presets[at]!.id : `ps_${randomUUID().slice(0, 8)}`,
    name: trimmed,
    settings
  }
  if (at >= 0) presets[at] = preset
  else presets.push(preset)
  writeJson(file(), { presets })
  return presets
}

export function removePreset(id: string): ReaderPreset[] {
  const presets = listPresets().filter((p) => p.id !== id)
  writeJson(file(), { presets })
  return presets
}
