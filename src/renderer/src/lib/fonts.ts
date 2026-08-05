import type { FontOption } from '@shared/types'

/**
 * Windows 常見中文字型的內建清單。
 * 系統字型列舉不可用時的退路，也讓下拉選單一開始就有合理選項可挑。
 * value 用英文名稱：中文字型名在 CSS 裡有時會因為系統語系而對不上。
 */
export const BUILTIN_FONTS: FontOption[] = [
  { label: '系統預設', value: '', fromSystem: false },
  { label: '微軟正黑體', value: "'Microsoft JhengHei UI', 'Microsoft JhengHei'", fromSystem: false },
  { label: '微軟雅黑', value: "'Microsoft YaHei UI', 'Microsoft YaHei'", fromSystem: false },
  { label: '新細明體', value: "'PMingLiU', 'MingLiU'", fromSystem: false },
  { label: '標楷體', value: "'DFKai-SB', 'BiauKai'", fromSystem: false },
  { label: '宋體', value: "'SimSun', 'NSimSun'", fromSystem: false },
  { label: '黑體', value: "'SimHei'", fromSystem: false },
  { label: '思源黑體', value: "'Noto Sans TC', 'Source Han Sans TC', 'Noto Sans CJK TC'", fromSystem: false },
  { label: '思源宋體', value: "'Noto Serif TC', 'Source Han Serif TC', 'Noto Serif CJK TC'", fromSystem: false }
]

interface LocalFontData {
  family: string
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>
  }
}

export interface FontQueryResult {
  fonts: FontOption[]
  error?: string
}

/**
 * 列舉系統字型。
 *
 * 走 Chromium 的 Local Font Access API，需要 local-fonts 權限（主行程已放行）
 * 以及使用者操作觸發，所以只在按下按鈕時呼叫，不在啟動時自動跑。
 * 失敗就沿用內建清單，不影響其他設定。
 */
export async function queryLocalFonts(): Promise<FontQueryResult> {
  if (typeof window.queryLocalFonts !== 'function') {
    return { fonts: [], error: '這個環境不支援系統字型列舉，請從內建清單選擇' }
  }
  try {
    const list = await window.queryLocalFonts()
    const seen = new Set<string>()
    const fonts: FontOption[] = []
    for (const f of list) {
      if (!f.family || seen.has(f.family)) continue
      seen.add(f.family)
      fonts.push({ label: f.family, value: `'${f.family}'`, fromSystem: true })
    }
    fonts.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
    return { fonts }
  } catch (err) {
    return { fonts: [], error: err instanceof Error ? err.message : String(err) }
  }
}
