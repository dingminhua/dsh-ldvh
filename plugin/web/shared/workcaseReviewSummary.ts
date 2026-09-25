// 复核记录 summary 的七要素解析（`21 §8` + `02 §15`）。
//
// 依据 `21 §8`：`reviews[].summary` 是「**结构化概要**，至少含 `02 §15` 判据
// **七要素**（对象／基线／方法／覆盖／未覆盖／发现／保证边界）」，且每项 ≤ 600 字符。
//
// 为什么需要解析：该字段**本身是结构化的**（作者按七要素逐项书写），但详情面此前把
// 它当一个 `<p>` 整段渲染——实测 12 条记录里 **11 条超过 400 字**（中位 519、最长 596），
// 七个要素被埋在一段话里，读者无法定位任何一项（Human 2026-09-24：「复核记录需要
// 格式化，当前无法阅读」）。本模块把七要素拆出来，交由呈现层分块显示。
//
// **写法约定（实测两种并存，解析须同时接受）**：
//   · 全角冒号：`对象：WC-1c6afa19 … 基线：HEAD 102719a。方法：…`（12 条中 10 条）
//   · 半角等号：`对象=WorkCase 18fcee2c … 方法=冷读独立复核：…`（12 条中 2 条）
// 故识别式同时接受 `:` / `：` / `=` / `＝`。**不按其中一种归一**——归一化会改写来源
// 文本的书写形态，而本模块只做「切分」，不做「改写」。
//
// 边界（如实声明）：本模块只**按登记的七要素标签切分**，不判断内容是否成立、不校验
// 「发现是否得到处置」（那是 `02 §15` 的语义判据，归 AI 层与 Human 层）。标签之前的
// 引导语**原样保留在 `rest`**，标签之外的文字不会被丢弃。

/** `02 §15` 判据七要素，按规范原文顺序（`21 §8` 逐字列出同一顺序）。 */
export const REVIEW_ELEMENTS = [
  '对象',
  '基线',
  '方法',
  '覆盖',
  '未覆盖',
  '发现',
  '保证边界',
] as const

export type ReviewElement = (typeof REVIEW_ELEMENTS)[number]

export interface ReviewElementItem {
  /** 要素名（`02 §15` 七要素之一）。 */
  key: ReviewElement
  /** 该项的内容（已去除首尾句读与空白）。空串表示标签存在但内容为空。 */
  value: string
}

export interface ParsedReviewSummary {
  /** 按**标签在原文中的出现顺序**给出。不按 `REVIEW_ELEMENTS` 重排——
   *  作者的行文顺序本身是信息，重排会掩盖「他先说什么」。 */
  items: ReviewElementItem[]
  /** 第一个要素标签之前的引导语（通常为空）。保持原文，不丢弃。 */
  rest: string
  /** 是否七要素齐全——**如实报告**，供呈现层决定是否降级为整段。 */
  complete: boolean
}

/**
 * 标签边界：串首或紧跟在**句读/冒号**之后（`。；;.：:` 或换行），容许其间空白。
 * 含冒号是因为实测有记录以引导语开头（例：「独立复核（…，21 §9.1/§8 + 32 §12）：对象=…」），
 * 紧随引导语冒号的第一个标签也须被识别。
 *
 * 为什么要这个边界：七要素的名称都是普通词（如「发现」「覆盖」「方法」），若不加边界，
 * 正文里顺带提到它们的地方（例：某条的「发现」项内写着「未覆盖项所述范围」）会被误判
 * 为新项的开头，把一个要素切成两段。
 */
const BOUNDARY = '(?:^|[。；;.：:\\n])\\s*'

/** 一个要素标签的出现位置：`at` 为标签首字下标，`contentAt` 为其后内容的起点。 */
interface TagHit {
  key: ReviewElement
  at: number
  contentAt: number
}

/** 找出 `from` 之后**最早出现**的要素标签（并列时取规范顺序靠前者）。 */
function findFirstTag(text: string, from: number): TagHit | null {
  let best: TagHit | null = null
  for (const key of REVIEW_ELEMENTS) {
    const re = new RegExp(`${BOUNDARY}(${key})\\s*[:：=＝]`, 'g')
    re.lastIndex = from
    const m = re.exec(text)
    if (m === null) continue
    const at = m.index + m[0].indexOf(m[1])
    const contentAt = m.index + m[0].length
    if (best === null || at < best.at) best = { key, at, contentAt }
  }
  return best
}

/** 去除首尾的句读与空白——**不改写文字内容**。 */
function trimValue(value: string): string {
  return value
    .replace(/^[\s。；;.、]+/, '')
    .replace(/[\s。；;、]+$/, '')
    .trim()
}

/**
 * 解析一条复核记录的 `summary`。
 *
 * 算法：反复取「下一个标签」，每项的取值区间为「本标签内容起点 → 下一标签起点」。
 * 这样每个要素**恰好**包含它自己的文字，不会把下一个标签吞进来。
 */
export function parseReviewSummary(summary: unknown): ParsedReviewSummary {
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    return { items: [], rest: '', complete: false }
  }
  const text = summary
  const hits: TagHit[] = []
  let cursor = 0
  for (;;) {
    const hit = findFirstTag(text, cursor)
    if (hit === null) break
    hits.push(hit)
    cursor = hit.contentAt
  }
  if (hits.length === 0) return { items: [], rest: text.trim(), complete: false }

  const items: ReviewElementItem[] = hits.map((hit, index) => {
    const to = index + 1 < hits.length ? hits[index + 1].at : text.length
    return { key: hit.key, value: trimValue(text.slice(hit.contentAt, to)) }
  })
  return {
    items,
    rest: hits[0].at > 0 ? text.slice(0, hits[0].at).trim() : '',
    complete: new Set(items.map((i) => i.key)).size === REVIEW_ELEMENTS.length,
  }
}
