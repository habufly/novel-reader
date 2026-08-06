/** main 與 renderer 共用的型別。IPC 契約都定義在這裡，兩邊各自 import。 */

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: NodeJS.Platform
  /** userData 目錄，設定與書庫資料都放這裡 */
  dataDir: string
  packaged: boolean
}

export type ThemeName = 'night' | 'black' | 'sepia' | 'day'

// ---------------------------------------------------------------- 編碼偵測

export type EncodingSource = 'bom' | 'utf8' | 'detected' | 'manual'

export interface EncodingGuess {
  /** iconv-lite 認得的編碼名稱 */
  encoding: string
  source: EncodingSource
  confidence: number
  /** 供匯入對話框下拉選單使用的其他候選 */
  candidates: string[]
}

export interface FilePreview {
  path: string
  fileName: string
  bytes: number
  guess: EncodingGuess
  /** 以 guess.encoding 解碼的開頭片段 */
  sample: string
  /** 替換字元（U+FFFD）比例，用來判斷是否亂碼 */
  replacementRatio: number
}

// ---------------------------------------------------------------- 書籍

export interface Book {
  id: string
  title: string
  author?: string
  /** 使用者原始檔案位置，僅供顯示與重新匯入，程式不會修改它 */
  sourcePath: string
  encoding: string
  chapterCount: number
  charCount: number
  addedAt: string
  lastReadAt?: string
  /** 整本閱讀進度百分比，存進書櫃索引讓書卡不必逐本載入進度檔 */
  progressPercent?: number
}

export interface ChapterMeta {
  /** 0-based，同時是閱讀位置座標的一部分 */
  id: number
  title: string
  charCount: number
  /** 在 content.txt 中的位元組範圍，讀取單章時直接 seek */
  byteStart: number
  byteEnd: number
}

export interface BookIndex {
  chapters: ChapterMeta[]
}

// ---------------------------------------------------------------- 匯入

export type SplitStrategy = 'numbered' | 'fixed-size'

export interface SplitReport {
  strategy: SplitStrategy
  /** 勝出的章節單位（章／回／卷…） */
  unit?: string
  /** 正規表示式命中的候選數 */
  candidates: number
  /** 通過序列驗證、真正採用的編號章節數 */
  accepted: number
  /** 因編號亂序被剔除（多半是正文誤判，例如「第二節晚自習」） */
  rejectedOutOfOrder: number
  /** 番外、楔子、序章之類無編號章節 */
  specials: number
  /** 被清掉的廣告／分隔線行數 */
  junkLines: number
  /** 各單位的競爭結果，方便使用者理解為何這樣切 */
  unitScores: Array<{ unit: string; candidates: number; longestRun: number }>
}

export interface ImportResult {
  book: Book
  report: SplitReport
}

export interface ImportProgress {
  fileName: string
  stage: 'reading' | 'decoding' | 'cleaning' | 'splitting' | 'writing' | 'done'
  percent: number
}

// ---------------------------------------------------------------- 閱讀

/**
 * 閱讀位置座標。
 *
 * 用「章節 + 章內字元位移」而不是捲動百分比：章節在匯入後就固定不再變動，
 * 所以這組座標不受字級、視窗寬度、主題影響。改用百分比的話，
 * 使用者一調字級位置就會跑掉，跟「字型可調」這個需求直接衝突。
 */
export interface ReadingPosition {
  chapterId: number
  charOffset: number
}

export interface Bookmark {
  id: string
  chapterId: number
  charOffset: number
  /** 加入書籤當下的內文片段，讓書籤清單不用載入整章就能顯示 */
  excerpt: string
  note: string
  createdAt: string
}

export interface HistoryEntry extends ReadingPosition {
  at: string
}

export interface BookProgress {
  current: ReadingPosition & { updatedAt: string }
  /** 跳轉前的位置，最新的在最前面 */
  history: HistoryEntry[]
  bookmarks: Bookmark[]
  /** 已讀章節編號 */
  readChapters: number[]
}

export interface ReaderSettings {
  theme: ThemeName
  /** CSS font-family 值；空字串代表沿用系統預設 */
  fontFamily: string
  fontSize: number
  lineHeight: number
  /** 字距，單位 em。中文適度加寬會好讀，但過大會破壞詞的視覺結塊 */
  letterSpacing: number
  /** 單行最大寬度，單位 em。中文一行 30–40 字最好讀 */
  maxWidth: number
  /** 段落間距，單位 em */
  paragraphSpacing: number
  /** 首行縮排字數，中文習慣 2 */
  indent: number
  /** 內文區左右邊距，單位 px */
  pagePadding: number
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'night',
  fontFamily: '',
  fontSize: 18,
  lineHeight: 1.9,
  letterSpacing: 0,
  maxWidth: 36,
  paragraphSpacing: 0.9,
  indent: 2,
  pagePadding: 32
}

// ---------------------------------------------------------------- 更新

export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'none'
  | 'error'
  | 'unsupported'

export interface UpdateStatus {
  stage: UpdateStage
  /** 可更新到的版本 */
  version?: string
  /** 下載進度百分比 */
  percent?: number
  message?: string
}

export interface AppPreferences {
  /** 開機時自動啟動 */
  launchAtLogin: boolean
  /** 啟動時自動檢查更新 */
  autoCheckUpdates: boolean
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  launchAtLogin: false,
  autoCheckUpdates: true
}

// ---------------------------------------------------------------- 語音

export type TtsEngineId = 'local' | 'edge'

export interface EdgeVoice {
  shortName: string
  locale: string
  gender: string
  label: string
}

export interface WordBoundary {
  /** 相對於這段音訊起點的毫秒數 */
  timeMs: number
  text: string
  length: number
}

export interface SynthesisPayload {
  /** MP3 位元組，經 IPC 傳給 renderer 組成 blob 播放 */
  audio: Uint8Array
  boundaries: WordBoundary[]
}

export interface TtsSettings {
  engine: TtsEngineId
  /** 離線引擎使用的 SpeechSynthesisVoice.name */
  localVoice: string
  /** 線上引擎使用的 Edge 語音短名，例如 zh-TW-HsiaoChenNeural */
  edgeVoice: string
  rate: number
  pitch: number
  volume: number
  /** 高亮到詞。關掉就只標整句，某些語音的邊界資料不準時可以關 */
  highlightWords: boolean
  /** 朗讀時自動捲動跟上 */
  autoScroll: boolean
}

export const DEFAULT_TTS: TtsSettings = {
  engine: 'local',
  localVoice: '',
  edgeVoice: 'zh-TW-HsiaoChenNeural',
  rate: 1,
  pitch: 1,
  volume: 1,
  highlightWords: true,
  autoScroll: true
}

export interface ReaderPreset {
  id: string
  name: string
  settings: ReaderSettings
}

export interface FontOption {
  /** 顯示用名稱 */
  label: string
  /** 實際寫進 CSS font-family 的值 */
  value: string
  /** 是否來自系統字型列舉（而非內建清單） */
  fromSystem: boolean
}
