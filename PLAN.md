# Novel Reader — 開發計畫

Windows 桌面小說閱讀器。單人開發，預估 **10–12 個工作天**完成 v1.0。

## 目標功能（v1.0）

| # | 功能 | 範圍 |
|---|------|------|
| 1 | 自動書籤 | 關掉再開回到原位；含手動書籤與跳轉歷史 |
| 2 | 目錄 | 依章節自動切分，側欄可搜尋、可跳轉、顯示已讀狀態 |
| 3 | 夜間模式 | 預設即為夜間；另備純黑 / 羊皮紙 / 日間 |
| 4 | 字型可調 | 字體、字級、行高、字距、段距、行寬、邊距、縮排 |
| 5 | 獨立應用程式 | Electron 打包成 NSIS 安裝檔 + 免安裝 portable exe |
| 6 | 語音聽書 | 離線 Windows 語音為主，線上 Edge 神經語音為輔 |

**格式範圍：v1 只做 TXT。** EPUB 列在 v1.1，PDF 不做（固定版面與「字型可調」「朗讀取文」根本衝突）。

---

## 技術棧

| 層 | 選型 | 理由 |
|---|------|------|
| 殼層 | Electron + electron-vite | Node 環境已就緒，檔案處理與 TTS 的坑最少 |
| UI | React 19 + TypeScript | |
| 狀態 | Zustand | 比 Redux 輕，這規模夠用 |
| 樣式 | CSS Variables + CSS Modules | 主題切換只要換一組變數，不需要 CSS-in-JS |
| 虛擬捲動 | @tanstack/react-virtual | 單章上萬字仍要虛擬化 |
| 編碼偵測 | jschardet + iconv-lite | Big5 / GB18030 / UTF-8 / UTF-16 |
| 持久化 | JSON（userData 目錄） | 資料量小；全文搜尋若要做再上 SQLite |
| 打包 | electron-builder | NSIS + portable，一行指令 |

代價：安裝檔約 80–150MB。以個人用閱讀器來說可以接受，換來的是開發速度。

---

## 專案結構

```
novel-reader/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ src/
│  ├─ main/                      # 主行程
│  │  ├─ index.ts                # 視窗建立、生命週期、主題
│  │  ├─ ipc/                    # IPC handler 註冊（白名單）
│  │  ├─ import/                 # 編碼偵測、章節切分、正規化寫檔
│  │  ├─ storage/                # 書櫃、進度、設定
│  │  └─ tts/edgeTts.ts          # Edge 神經語音 WebSocket 合成
│  ├─ preload/index.ts           # contextBridge 暴露的 API
│  └─ renderer/src/
│     ├─ views/                  # Library / Reader / Settings
│     ├─ components/             # TocSidebar / ReaderView / TtsBar / FontPanel
│     ├─ stores/                 # useLibrary / useReader / useSettings / useTts
│     ├─ tts/                    # engine 介面 + local / edge 兩種實作 + chunker
│     └─ styles/themes.css
└─ resources/
```

`contextIsolation: true`、`nodeIntegration: false`，renderer 一律走 preload 白名單 API。

---

## 資料模型

存放於 `app.getPath('userData')`。

```jsonc
// books.json — 書櫃索引
{ "books": [{
    "id": "b_1a2b3c",
    "title": "劍來",
    "sourcePath": "D:/novels/jianlai.txt",
    "encoding": "Big5",
    "chapterCount": 1243,
    "charCount": 2340112,
    "addedAt": "2026-08-05T07:00:00Z",
    "lastReadAt": "2026-08-05T09:12:00Z"
}]}

// books/b_1a2b3c/index.json — 章節索引
{ "chapters": [
    { "id": 0, "title": "第一章 驚蟄", "charCount": 3204, "file": "0000.txt" }
]}

// books/b_1a2b3c/progress.json — 進度（自動書籤的核心）
{ "current":   { "chapterId": 87, "charOffset": 1520, "updatedAt": "..." },
  "history":   [ /* 最近 20 次跳轉前的位置，供「返回」 */ ],
  "bookmarks": [{ "id": "bm_x", "chapterId": 12, "charOffset": 300,
                  "note": "", "excerpt": "…", "createdAt": "…" }],
  "readChapters": [0, 1, 2] }
```

**位置模型 = `{ chapterId, charOffset }`**（章內字元位移）。因為章節在匯入時就固定不再變動，這個座標永遠有效——不受字級、視窗寬度、主題影響。用捲動百分比會在改字級後跑位，用位元組位移會因編碼轉換失效，都不行。

---

## 分階段實作

### Phase 0 — 骨架與打包驗證（0.5 天）· 完成

`npm create @quick-start/electron` 建立 Electron + Vite + React + TS 專案，接上 electron-builder，**第一天就先跑出一個能安裝的 exe**。打包問題留到最後才發現是常見的翻車點。

同時處理啟動白閃：`BrowserWindow` 設 `backgroundColor: '#16161a'`、`show: false`，等 `ready-to-show` 才顯示，並設 `nativeTheme.themeSource = 'dark'`。夜間模式的第一印象就是「不能有一瞬間的白畫面」。

**驗收**：雙擊產出的 exe 能開出深色空視窗。

### Phase 1 — 匯入與解析（2 天）· 完成

實作前先拿兩本真實小說（各約 11MB、370–390 萬字）做資料分析，結果推翻了原本的兩個假設，設計因此調整。

**1. 編碼偵測 —— 驗證優先於統計猜測**

原訂做法是直接信 jschardet。實測發現它對其中一個樣本檔的中段與尾段都回傳 `null`，只靠取樣偵測會誤判。改成三層：

1. BOM 比對（樣本檔之一就是 UTF-8 with BOM）
2. **全檔逐位元組驗證 UTF-8**。Big5／GBK 的位元組流幾乎不可能滿足 UTF-8 的續接位元組規則，一整本小說更不可能，所以驗證通過即可斷定。11MB 只花約 12ms。
3. 都不成立才交給 jschardet，取頭中尾三段投票

匯入對話框仍提供預覽 + 手動切換編碼，並顯示亂碼字元比例——Big5／GB18030 互相誤判在其他來源仍會發生。

**2. 章節切分 —— 用序列驗證取代單純的正規表示式比對**

原訂規則是「命中正規表示式 + 行長 < 40 字」。實測直接打臉：

- 其中一本設定在高中，正文裡「第一節課」「第二節晚自習」滿天飛，**186 行全部誤判成章節**
- 想用「標題不含句讀」過濾也不行——「第6章 竹馬開竅了？」「第316章 你怎麼知道的？不說。」都是真標題
- 兩本的標題格式還不一致：一本是「第1章 系統來早了」，另一本是「第1章重回LSPL」，編號後沒有空格

最後採用的做法是**把候選標題當數列驗證**：

1. 依單位（章／節／回／卷…）分組收集候選
2. 每組算**最長嚴格遞增子序列（LIS）**
3. LIS 最長的單位勝出，LIS 以外的候選全部剔除

真章節必然構成又長又連續的遞增序列，正文誤判不會。實測「章」的 LIS 是 970/971，「節」只有 4/186，一刀切乾淨。嚴格遞增同時順手解決了重複章節（另一本有 8 個轉檔產生的重複標題）。

無編號的番外／楔子／序章另外用白名單比對，要求行長 ≤ 24 字且不含句讀，再依行號併入序列。

**保底**：LIS < 5 時改用每 ~3000 字硬切，確保目錄永遠可用。

**3. 文字清理**

- 段首縮排必須去掉：兩個樣本檔有 99.3% 的行本來就帶全形空白。閱讀器的縮排交給 CSS `text-indent`（要能跟著字級調整），保留來源空白會變成雙重縮排
- 清除站點廣告（含網址的行）與轉檔殘留（`------章节内容开始-------`）
- 一行一段，空行不保留

**4. 正規化寫檔**

原訂「一章一個檔」改成**單一 `content.txt` + 索引記位元組範圍**。近千章就近千個小檔，不如寫成一個檔用 seek 讀取——實測單章讀取 7ms。

```
%APPDATA%\novel-reader\
├─ books.json              書櫃索引
└─ books\<id>\
   ├─ content.txt          正規化後全文（UTF-8, LF）
   ├─ index.json           章節標題與位元組範圍
   └─ progress.json        閱讀進度（Phase 3 使用）
```

**驗收結果**

| | 樣本 A | 樣本 B |
|---|---|---|
| 檔案 | 11.08 MB | 10.99 MB |
| 編碼偵測 | utf-8（驗證） | utf-8（BOM） |
| 章節候選 → 採用 | 1157 → 970 | 755 → 746 |
| 誤判剔除 | 187（含 186 個「第N節」） | 9（重複標題） |
| 番外 | 11 | 0 |
| 最終章數 | 982 | 747 |
| 匯入耗時 | 2.5s | 0.2s |
| 單章讀取 | 7ms | 7ms |

`npm run selftest` 可重跑整條管線並驗證索引一致性、位元組範圍不重疊、回讀字數相符、無替換字元。

### Phase 2 — 閱讀器核心（2–3 天）· 完成

**滑動視窗式的連續捲動**

跨章要無縫，但內容不能無限往 DOM 堆。做法是同時只掛載 5 章：捲到接近底部就接上下一章，接近頂部就補上前一章，超過上限就從遠離視線的那一端砍掉。

往前插入章節會把後面的內容整個推下去，不補償的話畫面會突然跳走。補償用**錨點元素**而不是比較 `scrollHeight`：增刪前記下第一個可見章節的 `offsetTop` 與 `scrollTop` 的差值，DOM 更新後用同一個元素反推還原。錨點在增刪前後都還在 DOM 裡，所以即使同時發生裁切也算得準。

有個容易踩到的細節：章節的上方留白要放在 `section` 的 `padding` 而不是標題的 `margin`。margin 會因為邊界合併從 section 逃逸出去，讓 `offsetTop` 落在標題正上方，跳章時標題會緊貼視窗頂端。

**位置追蹤**

以視窗頂端往下 25% 處為基準線，找出跨過基準線的章節與段落，得出 `{chapterId, charOffset}`。每個段落都帶 `data-offset`，Phase 3 的書籤定位與 Phase 5 的朗讀高亮共用同一組標記。

捲動處理走 `requestAnimationFrame` 節流，且只在真的換段落時才寫回 store，否則每一幀都會觸發整棵樹重繪。目錄用虛擬捲動——982 章只渲染約 38 列。

**快捷鍵**：`↑↓` 捲動、`PgUp/PgDn`／`空白鍵` 翻頁、`← →` 上下章、`Ctrl+T` 目錄、`Ctrl±` 字級、`F11` 全螢幕、`Esc` 回書櫃。（`空白鍵` 在 Phase 5 會改成播放／暫停朗讀）

**順手修掉的資料目錄分家問題**

以 `electron out/main/index.js` 啟動時，Electron 解析不到套件目錄，`app.getName()` 會退回 `"Electron"`，資料寫進 `%APPDATA%\Electron`，與打包後的 `%APPDATA%\novel-reader` 分家——開發與正式版各有一個書櫃。在 main 進入點明確呼叫 `app.setName()` 固定下來。

**驗收結果**（982 章、380 萬字的書）

| 項目 | 目標 | 實測 |
|---|---|---|
| 任意跳章 | < 200ms | 冷讀取 2.8–6ms，熱讀取 2.3–3.8ms |
| 載入整份目錄 | — | 3.2ms |
| 同時掛載章節 | 有上限 | 5 章 |
| DOM 節點總數 | 不隨閱讀成長 | 連翻 200 頁後仍為 700 |
| 目錄渲染列數 | 虛擬化 | 38 / 982 |
| 前插後畫面位移 | 0 | 基準線上的段落文字前後一致，補償量 8009px |

### Phase 3 — 自動書籤與目錄（1 天）

**自動書籤**：捲動停止 500ms（debounce）、換章、視窗失焦、`before-quit`、每 30 秒——五個時機寫入 `progress.json`。開書時讀 `current`，找到含該 offset 的段落並捲到定位。跳轉前把舊位置推入 `history`，`Alt+←` 可返回。

**目錄側欄**：虛擬化清單（3000+ 章要能開得動）、標題搜尋、當前章高亮、已讀章節標記。

**手動書籤**：選取文字後 `Ctrl+D` 加書籤並存下摘錄，可加註記。

**驗收**：讀到第 500 章第 3 段 → 直接關掉程式 → 重開 → 回到同一段。

### Phase 4 — 主題與字型（1–1.5 天）

四套主題以 CSS 變數定義：**夜間（預設）**、純黑（OLED）、羊皮紙、日間。

可調項目：字體、字級 12–48px、行高 1.2–2.6、字距、段距、單行最大寬度（以 `ch` 為單位，中文一行建議 30–40 字）、左右邊距、首行縮排（中文預設 2 字元）。設定可存成具名 preset。

系統字型列舉：優先用 Chromium 的 `queryLocalFonts()`（在主行程 `setPermissionRequestHandler` 自動核准 `local-fonts` 權限），失敗則退回內建常用中文字型清單（微軟正黑體、新細明體、標楷體、思源黑體／宋體）+ 自訂輸入框。

**驗收**：所有調整即時預覽，重開程式後設定與閱讀位置都保持。

### Phase 5 — 語音聽書（2.5–3 天）

定義統一的 `TtsEngine` 介面（`speak(chunks)` / `pause` / `resume` / `stop` / `setRate` / `onChunkStart`），兩種實作可熱切換。

**文字切塊器（兩種引擎共用）**：以 `。！？；\n` 斷句，每塊 100–200 字。這是必要的——SAPI 對超長 utterance 有明顯延遲，且 pause/resume 會出錯。用 `onend` 推進佇列。

**離線引擎（預設）** — Web Speech API：
- `getVoices()` 首次呼叫回傳空陣列，必須監聽 `voiceschanged` 事件。
- **高亮策略：句級，不用 `boundary` 事件。** Windows SAPI 的 boundary 事件對中文經常不觸發或位移不準，依賴它會做出一個時好時壞的功能。改成「播到第幾個句塊就高亮該塊並自動捲動」，行為穩定。
- 若偵測到系統沒有中文語音，直接在 UI 給出引導：設定 → 時間與語言 → 語音 → 新增語音。這是使用者最容易卡住的地方，不能只丟一句「無可用語音」。

**線上引擎（選用）** — Edge 神經語音（`zh-TW-HsiaoChenNeural` 等）：
- 在主行程走 WebSocket 合成 mp3，傳回 renderer 以 `<audio>` 播放；預取後 2–3 塊避免銜接卡頓；合成結果快取到 userData。
- 回傳的 WordBoundary metadata 讓線上模式可以做到**逐詞高亮**，比離線模式細緻。
- 非官方 API，有失效風險：連線失敗自動降級回離線引擎並提示，絕不讓聽書中斷成無聲。

**播放功能**：跨章連播、倍速 0.5–3.0、音調音量、睡眠計時器（15/30/60 分鐘 / 本章結束）、朗讀位置與閱讀進度同步（唸到哪書籤就存到哪）、最小化到系統匣繼續播放、媒體鍵控制（線上模式用 `navigator.mediaSession`，離線模式用 `globalShortcut`）。

**驗收**：從第 100 章開始朗讀，能自動跨章連播 30 分鐘不中斷，高亮與語音同步，中途關窗後書籤停在唸到的位置。

### Phase 6 — 打包與發佈（1 天）

electron-builder 產 x64 的 NSIS 安裝檔與 portable exe。記住視窗大小位置、開機自啟（選用）、系統匣圖示。

搭配 electron-updater + GitHub Releases 做自動更新（repo 已在 GitHub，直接可用）。

**簽章問題**：未簽章的 exe 會觸發 SmartScreen 警告。選項是買 OV/EV 憑證（年費約 US$200–400）或接受警告——自用的話接受警告即可，這裡先不投入。

---

## 主要風險

| 風險 | 影響 | 對策 |
|---|---|---|
| 中文 TXT 編碼誤判 | 開書全是亂碼 | ~~已處理~~ BOM → 全檔 UTF-8 驗證 → jschardet 三層，另有預覽與手動切換 |
| 正文誤判成章節標題 | 目錄被雜訊塞爆 | ~~已處理~~ LIS 序列驗證，實測濾掉 186/186 個誤判 |
| 百萬字大檔卡死 | 開書即當機 | ~~已處理~~ 匯入時正規化成單檔 + 位元組索引，單章讀取 7ms |
| SAPI boundary 事件不可靠 | 高亮亂跳 | 改用句級高亮，不依賴 boundary |
| 系統無中文語音 | 聽書完全不能用 | 啟動時偵測並給出安裝指引 |
| Edge TTS 非官方 API 失效 | 線上語音掛掉 | 自動降級回離線引擎 |
| 章節正規表示式不通用 | 目錄切錯 | 保底固定字數切分 + 可自訂規則重切 |
| 未簽章觸發 SmartScreen | 安裝被擋 | v1 接受警告，日後視需要買憑證 |

---

## v1.1 以後

EPUB 支援（epub.js，可直接用內建目錄）、全文搜尋（SQLite FTS5）、跨裝置進度同步、繁簡轉換（OpenCC）、閱讀統計、批次匯入資料夾、自訂朗讀讀音字典（人名／專有名詞糾音）。
