import type { RefineCategory } from '@shared/types'
import { stripWatermark } from './watermark'

/**
 * 精校規則。
 *
 * 每一條都對著七本樣本校準過，寧可漏砍也不要誤砍 —— 使用者不會發現少了一段，
 * 但一定會發現讀到一半語意斷掉。掃描結果會附樣本，就是為了讓誤判當場現形。
 *
 * 掃描與套用都作用在已經切分完成的 content.txt 上，所以章節標題不在其中，
 * 不必擔心把「第326章 你別欺負我了（求月票）」這種標題誤刪。
 */

/**
 * 章節標題尾端（或中間）的拉票／打賞附註。
 *
 * 只清明確的宣傳文字，結構性註記一律保留 ——「（補一）」「（第三更）」
 * 「（二合一8k）」是章節本身的資訊，「（比心）」是作者的表情。
 * 全書櫃 9613 個標題裡有 933 個帶這類附註，佔了近一成，目錄會很吵。
 *
 * 標題不存在 content.txt 裡（只存在 index.json），所以改標題不會動到任何
 * 字元位移 —— 這一類不需要位置重映射。
 */
export const TITLE_PROMO =
  /[（(][^）)]{0,30}(求[^）)]{0,6}票|求订阅|求訂閱|求首订|求首訂|求收藏|求支持|求点击|求點擊|感谢|感謝|打赏|打賞|盟主|舵主|白银盟|白銀盟|上推了|月票|推荐票|推薦票)[^）)]{0,30}[）)]/g

export function cleanTitle(title: string): string {
  TITLE_PROMO.lastIndex = 0
  return title.replace(TITLE_PROMO, '').replace(/\s{2,}/g, ' ').trim()
}

export interface RuleSpec {
  id: RefineCategory
  label: string
  hint: string
  mode: 'line' | 'inline' | 'title' | 'char'
  /** line 模式：整行符合就移除 */
  line?: RegExp
  /** line 模式的例外，符合就保留 */
  keep?: RegExp
  /** inline 模式：只把命中的片段從行內拿掉 */
  fragment?: RegExp
}

export const RULES: RuleSpec[] = [
  {
    id: 'authorNote',
    label: '作者留言與打賞感謝',
    hint: '「ps：」開頭的作者註解、「感謝書友XX打賞」、更新進度說明。這些穿插在正文裡，朗讀時也會被唸出來。',
    mode: 'line',
    line: new RegExp(
      [
        // ps：開頭的作者註解
        '^(ps|PS|Ps|pS)\\s*[:：]',
        // 感謝……打賞／月票／書友／盟主
        '^(感谢|感謝)[^。！？]{0,40}(打赏|打賞|月票|推荐票|推薦票|盟主|舵主|书友|書友|礼物|禮物|起点币|起點幣)',
        // 更新進度公告
        '^第[一二三四五六七八九十\\d]{1,3}更[到，。！\\s]',
        '^(今日更新|今天更新|更新时间|更新時間|本章说|本章說)'
      ].join('|')
    ),
    /**
     * 這些書的正文本身就有【系統訊息】之類的框，框內出現「ps：」是角色寫的，
     * 不是作者留言。以收尾括號判斷，寧可漏砍。
     */
    keep: /[】\]』」]\s*$/
  },
  {
    id: 'voteBeg',
    label: '求票與求訂閱',
    hint: '「求月票」「求推薦票」「求收藏」這類拉票文字。只清整行都在講這件事的段落，夾在劇情裡的不動。',
    mode: 'line',
    // 整行只有一個子句在講求票，才算數；夾在長段落裡的不碰
    line: /^[^。！？]{0,24}(求月票|求推荐票|求推薦票|求订阅|求訂閱|求打赏|求打賞|求收藏|投推荐票|投推薦票|求点击|求點擊)[^。！？]{0,24}[。！～~]?$/
  },
  {
    id: 'titleNote',
    label: '章節標題的拉票附註',
    hint: '「（求月票）」「（感謝XX打賞的盟主）」這類掛在標題上的宣傳。只清宣傳文字，標題本體保留；「（補一）」「（第三更）」「（二合一8k）」這類章節資訊不動。',
    mode: 'title'
  },
  {
    id: 'siteAd',
    label: '站點廣告與網址',
    hint: '轉檔殘留的書站宣傳。廣告夾在段落中間時只拿掉那一段文字，不會刪掉整段正文。',
    mode: 'inline',
    fragment: new RegExp(
      [
        // 「无弹窗豆腐小说www.ddff.cc」這種夾在正文中間的
        '[^，。！？；]{0,20}(https?://[^\\s，。！？]+|www\\.[a-z0-9-]+\\.[a-z]{2,}[^\\s，。！？]*)',
        // 站名 + 動作的宣傳語
        '(爱下电子书|愛下電子書|更多电子书|更多電子書)[^，。！？]{0,40}(访问|訪問|下载|下載|分享)[^，。！？]{0,40}'
      ].join('|'),
      'gi'
    )
  },
  {
    id: 'marker',
    label: '殘留分隔標記',
    hint: '整行都是符號的分隔線、以及「------章节内容开始-------」這類轉檔標記。',
    mode: 'line',
    // 整行都是符號才算，「---是夢嗎？」這種有正文的不碰
    line: /^([-—─=＝*＊※_~～]{3,}|[-—─=＝*＊※_]{2,}.{0,20}(内容|內容|正文|全文|章节|章節)(开始|開始|结束|結束).{0,20}[-—─=＝*＊※_]{2,})$/
  },
  {
    id: 'watermark',
    label: '盜版站浮水印字',
    hint: '有些來源會在段落結尾插一個與內容無關的罕用字當追蹤標記，像「三花猫。阑」。字元清單是逐本統計出來的，只拿掉行尾那一個字，同一個字出現在句子中間時（例如「意兴阑珊」）不會被動到。',
    mode: 'char'
  }
]

export function ruleOf(id: RefineCategory): RuleSpec | undefined {
  return RULES.find((r) => r.id === id)
}

export interface LineDecision {
  /** 整行移除 */
  drop: boolean
  /** 保留但內容改寫（行內移除廣告後的結果） */
  rewritten?: string
  category?: RefineCategory
}

/**
 * 對單一行套用選定的規則，回傳該行的處置方式。
 *
 * marks 是這本書偵測到的浮水印字。浮水印一定先剝 —— 其他規則有好幾條
 * 用行尾錨點判斷（例如 authorNote 的 keep 用「】」收尾來認出正文裡的
 * 系統框），行尾多掛一個「阑」會讓那些錨點對不上，保護就失效了。
 */
export function decide(
  line: string,
  enabled: Set<RefineCategory>,
  marks: Set<string> = new Set()
): LineDecision {
  let text = line
  let category: RefineCategory | undefined

  if (enabled.has('watermark') && marks.size > 0) {
    const stripped = stripWatermark(text, marks)
    if (stripped !== text) {
      text = stripped
      category = 'watermark'
    }
  }

  for (const rule of RULES) {
    if (!enabled.has(rule.id)) continue

    if (rule.mode === 'line') {
      if (rule.keep?.test(text)) continue
      if (rule.line?.test(text)) return { drop: true, category: rule.id }
      continue
    }

    if (rule.fragment) {
      rule.fragment.lastIndex = 0
      const nextText = text.replace(rule.fragment, '')
      if (nextText !== text) {
        text = nextText
        category = rule.id
      }
    }
  }

  if (category && text !== line) {
    // 整行都是廣告的話直接移除，不要留下空段落
    if (!text.trim()) return { drop: true, category }
    return { drop: false, rewritten: text, category }
  }
  return { drop: false }
}
