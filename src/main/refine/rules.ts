import type { RefineCategory } from '@shared/types'

/**
 * 精校規則。
 *
 * 每一條都對著七本樣本校準過，寧可漏砍也不要誤砍 —— 使用者不會發現少了一段，
 * 但一定會發現讀到一半語意斷掉。掃描結果會附樣本，就是為了讓誤判當場現形。
 *
 * 掃描與套用都作用在已經切分完成的 content.txt 上，所以章節標題不在其中，
 * 不必擔心把「第326章 你別欺負我了（求月票）」這種標題誤刪。
 */

export interface RuleSpec {
  id: RefineCategory
  label: string
  hint: string
  mode: 'line' | 'inline'
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

/** 對單一行套用選定的規則，回傳該行的處置方式 */
export function decide(line: string, enabled: Set<RefineCategory>): LineDecision {
  let text = line
  let category: RefineCategory | undefined

  for (const rule of RULES) {
    if (!enabled.has(rule.id)) continue

    if (rule.mode === 'line') {
      if (rule.keep?.test(text)) continue
      if (rule.line?.test(text)) return { drop: true, category: rule.id }
      continue
    }

    if (rule.fragment) {
      rule.fragment.lastIndex = 0
      const next = text.replace(rule.fragment, '')
      if (next !== text) {
        text = next
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
