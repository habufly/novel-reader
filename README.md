# Novel Reader

Windows 桌面小說閱讀器：自動書籤、章節目錄、夜間模式、字型調節、語音聽書。

開發計畫與各階段驗收條件見 [PLAN.md](PLAN.md)。

## 目前進度

- **Phase 0 骨架與打包驗證：完成** — 可打包成 Windows 安裝檔與免安裝執行檔，夜間主題為預設值且無啟動白閃
- **Phase 1 匯入與解析：完成** — TXT 匯入、編碼偵測、章節切分、書櫃
- **Phase 2 閱讀器核心：完成** — 跨章連續捲動、虛擬化目錄、位置追蹤、快捷鍵
- **Phase 3 自動書籤：完成** — 位置自動存續、手動書籤、跳轉歷史、章節搜尋、已讀標記
- Phase 4 主題與字型：未開始

以兩本各約 11MB／380 萬字的小說實測：匯入 0.2–2.5 秒，跳章 2.3–6ms，連翻 200 頁後 DOM 仍維持 700 個節點，強制終止後重開位置零誤差。

## 快捷鍵

| 按鍵 | 動作 |
|---|---|
| `↑` `↓` | 捲動 |
| `PgUp` `PgDn`／`空白鍵` | 翻頁 |
| `←` `→` | 上一章／下一章 |
| `Ctrl` `+` `-` | 調整字級 |
| `Ctrl+D` | 在目前位置加書籤（有選取文字則存下選取內容） |
| `Alt+←` | 回到跳轉前的位置 |
| `Ctrl+T` | 顯示／隱藏目錄 |
| `F11` | 全螢幕 |
| `Esc` | 回書櫃 |

## 環境需求

- Node.js 20 以上（開發時使用 v24.11）
- Windows 10/11 x64

## 指令

```bash
npm install       # 安裝相依套件
npm run dev       # 開發模式，支援 HMR
npm run typecheck # 型別檢查
npm run build     # 編譯到 out/
npm run build:win # 型別檢查 + 編譯 + 打包成 exe，輸出到 dist/
npm run icon      # 重新產生 build/icon.ico
npm run selftest  # 用 docs/*.txt 跑匯入管線的煙霧測試
```

`selftest` 會完整跑一次編碼偵測 → 章節切分 → 寫檔 → 位元組範圍回讀，並驗證索引一致性與字元完整性，跑完自動清除測試資料。解析規則很吃真實檔案的樣貌，改動切分邏輯後跑這支可以立刻看出有沒有退步。指定檔案：

```bash
npm run selftest -- "D:\novels\某本小說.txt"
```

加 `--keep` 可保留匯入結果，用來把測試資料灌進書櫃。

`npm run build:win` 會在 `dist/` 產出兩個檔案：

- `Novel Reader-0.1.0-Setup.exe` — NSIS 安裝檔，可選安裝路徑
- `Novel Reader-0.1.0-Portable.exe` — 免安裝版

兩者皆未經程式碼簽章，首次執行會出現 Windows SmartScreen 警告，選「其他資訊 → 仍要執行」即可。

## 專案結構

```
src/
├─ main/        Electron 主行程：視窗、IPC、檔案處理、持久化
├─ preload/     contextBridge 白名單 API，renderer 唯一的對外入口
├─ renderer/    React UI
└─ shared/      main 與 renderer 共用的型別（IPC 契約）
```

安全性設定：`contextIsolation` 開啟、`nodeIntegration` 關閉，正式版套用 CSP 標頭。

## 資料存放位置

`%APPDATA%\novel-reader\`

小說原始檔不會被移動或修改；匯入時會在此目錄建立正規化後的章節副本與閱讀進度。
