import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** userData 底下的路徑。所有持久化資料都放這裡，不動使用者的原始小說檔。 */
export function dataPath(...segments: string[]): string {
  return join(app.getPath('userData'), ...segments)
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf-8')) as T
  } catch (err) {
    // 檔案毀損時退回預設值，不要讓整個 app 開不起來
    console.error(`[storage] 讀取失敗，改用預設值: ${file}`, err)
    return fallback
  }
}

/**
 * 先寫暫存檔再 rename 覆蓋。rename 在同一個磁碟區上是原子操作，
 * 所以就算寫到一半斷電，也只會留下 .tmp，原檔案保持完整。
 * 自動書籤會頻繁寫入，沒有這層保護遲早會遇到進度檔毀損。
 */
export function writeJson(file: string, value: unknown): void {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
  renameSync(tmp, file)
}
