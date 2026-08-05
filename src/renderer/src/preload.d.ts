import type { Api } from '../../preload/index'

/**
 * 把 preload 暴露出來的 API 掛到 window 型別上。
 * 這個檔案不能放在 src/preload/index.d.ts —— 與同目錄的 index.ts 撞名時，
 * TypeScript 會把它誤認成編譯產生的宣告檔而整個忽略。
 */
declare global {
  interface Window {
    api: Api
  }
}

export {}
