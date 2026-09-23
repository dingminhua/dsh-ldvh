// 「## 结果」节解析：把关闭提案的正文承载转成卡片可呈现的结构。
//
// 依据 `21 §8`：`result` 字段出现 ⇔ `status = closed`。故「待批准关闭」期
// （`status = open`）的**核对结论与建议只在正文「## 结果」节里**，卡片从字段读不到。
// 本模块只做**形态解析**，不做语义判断：
//
//   · 核对状态只认 `21 §8` 登记的三词（达成 / 部分达成 / 未达成）；无法判定时记
//     `null`（呈现为「未记录」），**不猜**、不把同义词静默归一。
//   · 建议只认 `21 §8` 登记的 `- advice:` 段与闭集去向词（另立工单 / 补录 /
//     更正 / 接受现状 / 改进）；去向词不在闭集内记 `null`（呈现为「未归类」）。
//
// 解析依赖书写形态。格式不符时条目落空而不是被猜出来——这是有意的：标准形态由
// `21 §8` 登记，偏离时应暴露而非掩盖。
//
// 曾有一条过渡通道（从 `residual` 条目正文里按「建议…」关键词抽子句），随 2026-09-23
// 把 5 份存量对象的建议回填为 `- advice:` 段而**删除**：该通道实测丢出处 3/8、截断
// 1/8，并误判 1 例（正文含「另立」二字即判为「另立工单」，实际去向是「补录」）。
// 规范既已登记唯一承载，认知之外的第二条识别路径只会让「未登记即不可检出」失效。

export const WORKCASE_CHECK_STATUSES = ['achieved', 'partial', 'not-achieved'] as const
export type WorkCaseCheckStatus = (typeof WORKCASE_CHECK_STATUSES)[number]

/** `21 §8` 登记的三词 → 内部状态。顺序敏感：先长词后短词（「达成」是「未达成」的子串）。 */
const CHECK_WORDS: readonly (readonly [string, WorkCaseCheckStatus])[] = [
  ['未达成', 'not-achieved'],
  ['部分达成', 'partial'],
  ['达成', 'achieved'],
]

/** 建议去向（`21 §8`）。判不出时记 null，呈现为「未归类」。 */
export const WORKCASE_ADVICE_KINDS = ['另立工单', '补录', '更正', '接受现状', '改进'] as const
export type WorkCaseAdviceKind = (typeof WORKCASE_ADVICE_KINDS)[number]

/** 建议段标记：`- advice:` 或 `- 建议：`（`21 §8`）。 */
const ADVICE_BLOCK = /^(advice|建议)\s*[:：]?$/
/** 建议条目形态：去向词以 `**` 包裹并位于行首，后接 `：`（`21 §8`）。 */
const ADVICE_TITLED = /^\*\*(.+?)\*\*\s*[:：]?\s*([\s\S]*)$/
/** 可选尾注：`出自「…」`，紧接建议正文的句末标点之后、不带句号（`21 §8`）。 */
const ADVICE_FROM = /出自「([^」]+)」\s*$/

export interface WorkCaseDraftCheck {
  /** 对应 `plan` 的 0-based 下标；-1 表示未能与该结果节条目配对。 */
  planIndex: number
  status: WorkCaseCheckStatus | null
}

export interface WorkCaseDraftAdvice {
  kind: WorkCaseAdviceKind | null
  text: string
  /** `出自「…」` 尾注里所回应的 residual 条目；未写尾注时为 null。 */
  from: string | null
}

export interface WorkCaseResultDraft {
  checks: WorkCaseDraftCheck[]
  advice: WorkCaseDraftAdvice[]
}

function statusOf(text: string): WorkCaseCheckStatus | null {
  for (const [word, status] of CHECK_WORDS) {
    if (text.includes(word)) return status
  }
  return null
}

function adviceKindOf(word: string): WorkCaseAdviceKind | null {
  for (const kind of WORKCASE_ADVICE_KINDS) {
    if (word === kind) return kind
  }
  return null
}

/**
 * 取正文里的「## 结果」节原文（不含标题行）。
 *
 * 与 `bodyHasResultSection` 同一 ATX 语义：忽略代码围栏内的行、容许 ≤3 空格缩进。
 * 找不到时返回空串。
 */
export function resultSectionOf(body: unknown): string {
  if (typeof body !== 'string' || body.length === 0) return ''
  const lines = body.split(/\r?\n/)
  const out: string[] = []
  let inFence = false
  let fenceMarker = ''
  let collecting = false
  for (const line of lines) {
    const fence = /^ {0,3}(```|~~~)/.exec(line)
    if (fence) {
      const marker = fence[1]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      if (collecting) out.push(line)
      continue
    }
    if (!inFence && /^ {0,3}##\s+\S/.test(line)) {
      // 任何 H2 都是节的边界：进入「结果」或离开它
      if (/^ {0,3}##\s+结果\s*$/.test(line)) {
        collecting = true
        continue
      }
      if (collecting) break
    }
    if (collecting) out.push(line)
  }
  return out.join('\n').trim()
}

interface PlanStepLike {
  step?: unknown
}

/**
 * 解析「## 结果」节为卡片可呈现的草稿。
 *
 * 配对方式（三种实测形态，均按 `plan` 下标对齐）：
 *   ① `- 步骤 N 判据「…」：<词>——证据：…`  → 按 N
 *   ② `- 步骤 N–M：<词>——证据：…`          → 按区间 N..M
 *   ③ `- <名称>：<词>——证据：…`            → 按 `plan[i].step` 逐字/前缀匹配
 * 配对不上的步不产出条目（调用方按「无对应条目」呈现）。
 *
 * 建议段（`21 §8`）：`- advice:` 之下每条 `- **<去向词>**：<正文>出自「…」`。
 * 去向词不在闭集内记 `kind: null`；`出自「…」` 未写记 `from: null`。
 */
export function parseWorkCaseResultDraft(body: unknown, plan: unknown): WorkCaseResultDraft {
  const section = resultSectionOf(body)
  const result: WorkCaseResultDraft = { checks: [], advice: [] }
  if (!section) return result

  const steps: PlanStepLike[] = Array.isArray(plan) ? (plan as PlanStepLike[]) : []
  const stepTexts = steps.map((s) => (typeof s?.step === 'string' ? s.step.trim() : ''))
  const byIndex = new Map<number, WorkCaseCheckStatus | null>()

  let mode: 'checks' | 'residual' | 'advice' | null = null
  let modeIndent = 0

  for (const rawLine of section.split('\n')) {
    const bullet = /^(\s*)-\s+(.*)$/.exec(rawLine)
    if (!bullet) continue
    const indent = bullet[1].length
    const item = bullet[2].trim()

    // ── 块切换 ──
    if (/^criteria_checks\s*:?$/.test(item) || /^判据逐条核对\s*[:：]?$/.test(item)) {
      mode = 'checks'; modeIndent = indent; continue
    }
    if (/^residual\s*:?$/.test(item) || /^残留责任\s*[:：]?$/.test(item)) {
      mode = 'residual'; modeIndent = indent; continue
    }
    if (ADVICE_BLOCK.test(item)) {
      mode = 'advice'; modeIndent = indent; continue
    }
    if (/^(achieved_scope|已证实范围)\s*[:：]/.test(item)) { mode = null; continue }

    const isTopLevel = indent <= modeIndent

    // ── `- advice:` 段内 ──
    if (mode === 'advice') {
      const titled = ADVICE_TITLED.exec(item)
      const kindText = titled ? titled[1].trim() : ''
      let body = titled ? titled[2].trim() : item
      const fromMatch = ADVICE_FROM.exec(body)
      const from = fromMatch ? fromMatch[1].trim() : null
      if (fromMatch) body = body.slice(0, fromMatch.index).trim()
      result.advice.push({ kind: adviceKindOf(kindText), text: body || item, from })
      continue
    }

    // ── 顶层「步骤 …」形态（含 ①②）──
    if (mode === null || isTopLevel) {
      const range = /^步骤\s*(\d+)\s*[–\-~]\s*(\d+)\s*[:：]\s*(.+)$/s.exec(item)
      if (range) {
        const a = Number(range[1]); const b = Number(range[2]); const st = statusOf(range[3])
        for (let n = a; n <= b; n += 1) if (!byIndex.has(n - 1)) byIndex.set(n - 1, st)
        continue
      }
      const single = /^步骤\s*(\d+)\s*[:：]\s*(.+)$/s.exec(item)
      if (single) {
        const i = Number(single[1]) - 1
        if (!byIndex.has(i)) byIndex.set(i, statusOf(single[2]))
        continue
      }
    }

    // ── checks 段内 ──
    if (mode === 'checks') {
      const crit = /^步骤\s*(\d+)\s*判据「.*?」\s*[:：]\s*(.+)$/s.exec(item)
      if (crit) {
        const i = Number(crit[1]) - 1
        if (!byIndex.has(i)) byIndex.set(i, statusOf(crit[2]))
        continue
      }
      // ③ 名称形态：按 plan.step 匹配（取最长命中，避免短名误配）
      const named = /^(.*?)\s*[:：]\s*(.+)$/s.exec(item)
      if (named && stepTexts.length > 0) {
        const name = named[1].trim()
        let best = -1
        for (let i = 0; i < stepTexts.length; i += 1) {
          const st = stepTexts[i]
          if (!st) continue
          if (st === name || st.startsWith(name) || name.startsWith(st)) {
            if (best === -1 || st.length > stepTexts[best].length) best = i
          }
        }
        if (best >= 0 && !byIndex.has(best)) byIndex.set(best, statusOf(named[2]))
      }
      continue
    }

    // ── residual 段内：`21 §8` 规定此处不得再写「建议…」子句，故不产出条目 ──
    if (mode === 'residual') continue
  }

  result.checks = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([planIndex, status]) => ({ planIndex, status }))

  return result
}
