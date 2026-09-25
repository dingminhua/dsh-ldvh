// `scope` / `summary` 的**书写结构**校验（`21 §8`）。
//
// **为什么 web 侧需要自己实现一份**：本仓是两层结构——`plugin/lib/`（Host 侧写入与
// 校验，写入口在落盘前就做这些检查）与 `plugin/web/`（呈现侧），两侧**互不 import**
// （既有先例：`markdown-structure.js` 只在 lib 侧，web 侧另有等价实现）。故呈现侧要
// 显示「这个字段不合规」时，必须按同一套规则自行判定。
//
// **本文件的规则逐条对齐 `plugin/lib/workcase-writer.js` 的 `validateStructuredText`
// 与 `validateScopeLabelSections`**。两侧若有分歧，以 `specs/21 §8` 原文为准。
//
// 解决什么问题（Human 2026-09-24：「这种授权范围还是没法读取，我的要求是，当前我
// 看到的都要规范化，可检查，确保之后都要保持一样」）：
//   写入口**已经**算出了这些违规，但它们只留在写入路径上——`mechanical_issues` 在
//   服务端投影与前端呈现**各 0 处命中**，于是读者看到的是「读不了」，而不是
//   「这里不合规、原因是 X」。呈现层因此**看不出来**问题在哪。
//
// 边界（如实声明）：本模块只校验**书写形态**（有无标签行、有无空行分块、块首是否
// 合法），不校验内容是否名副其实（写 `### 现状核实` 而内容其实是边界，机械判不出来）。
// 与机械层同一保证边界。

/** 长文本分块阈值（`21 §8`：与机械层同值，见 writer 的 `STRUCTURED_TEXT_MIN_CHARS`）。 */
export const STRUCTURED_TEXT_MIN_CHARS = 200

/** `summary` 的块首固定骨架：**只有 H3**（Human 裁定 2026-09-22）。 */
const SUMMARY_BLOCK_HEAD = /^###[ \t]+\S/

/** `scope` 语义所必需的两个标签行（**闭集**，非任意的 `XX：`）。 */
const SCOPE_BLOCK_HEADS = new Set(['做什么', '明确不做什么'])

export type StructuredTextIssueKind =
  | 'scope_missing_what_line'
  | 'scope_missing_not_line'
  | 'scope_long_single_block'
  | 'summary_long_single_block'
  | 'struct_block_head_invalid'

export interface StructuredTextIssue {
  /** 违规所在的字段名：`scope` / `summary`。 */
  field: 'scope' | 'summary'
  kind: StructuredTextIssueKind
  /** 面向读者的说明（与机械层的判据同义，措辞面向阅读而非日志）。 */
  message: string
}

function isSummaryBlockHead(line: string): boolean {
  return SUMMARY_BLOCK_HEAD.test(line.trim())
}

function isScopeBlockHead(line: string): boolean {
  const trimmed = line.trim()
  if (SUMMARY_BLOCK_HEAD.test(trimmed)) return true
  const m = /^([^\n：:]+)[：:][ \t]*$/.exec(trimmed)
  return m !== null && SCOPE_BLOCK_HEADS.has(m[1].trim())
}

/** 空行分块（与正文节的分块语义一致）。 */
function structuredTextBlocks(text: string): string[] {
  return text
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
}

/**
 * 校验 `scope`：两个标签行**各须独占一行**（行内串联不合规——语义答了、形态没答）。
 *
 * 判定用 `^...$` 而非「包含子串」：`做什么：A；B。明确不做什么：C。` 两个标签都在，
 * 但读起来仍是一整段。这正是要判为不合规的形态。
 */
function validateScopeLabelLines(scope: string, issues: StructuredTextIssue[]): void {
  const lines = scope.split('\n').map((l) => l.trim())
  const sections = [
    { name: '做什么', re: /^做什么[：:]\s*$/, kind: 'scope_missing_what_line' as const },
    { name: '明确不做什么', re: /^明确不做什么[：:]\s*$/, kind: 'scope_missing_not_line' as const },
  ]
  for (const section of sections) {
    const index = lines.findIndex((line) => section.re.test(line))
    if (index === -1) {
      issues.push({
        field: 'scope',
        kind: section.kind,
        message: `缺少独占一行的「${section.name}：」标签（21 §8：须各占一行成段，不得行内串联）`,
      })
      continue
    }
    // 标签下到下一个标签（或结尾）之间须有内容
    let next = lines.length
    for (let i = index + 1; i < lines.length; i += 1) {
      if (sections.some((s) => s.re.test(lines[i]))) {
        next = i
        break
      }
    }
    if (lines.slice(index + 1, next).join('').trim().length === 0) {
      issues.push({
        field: 'scope',
        kind: section.kind,
        message: `「${section.name}：」标签下没有内容（21 §8：两段各须带内容）`,
      })
    }
  }
}

/**
 * 校验长文本的分块形态：超过阈值时须用空行分块，且**首块之外的每块**首行须是
 * 合法块首（`summary` 只有 H3；`scope` 另认两个已登记的标签行）。
 */
function validateStructuredBlocks(
  text: string,
  field: 'scope' | 'summary',
  issues: StructuredTextIssue[],
): void {
  if (text.length <= STRUCTURED_TEXT_MIN_CHARS) return
  const blocks = structuredTextBlocks(text)
  const isHead = field === 'summary' ? isSummaryBlockHead : isScopeBlockHead
  if (blocks.length <= 1) {
    issues.push({
      field,
      kind: field === 'scope' ? 'scope_long_single_block' : 'summary_long_single_block',
      message: `${text.length} 字符且未分块（21 §8：超过 ${STRUCTURED_TEXT_MIN_CHARS} 字符须用空行分块，且首块之外的每块以块首开头）`,
    })
    return
  }
  for (let i = 1; i < blocks.length; i += 1) {
    const firstLine = blocks[i].split('\n')[0] ?? ''
    if (!isHead(firstLine)) {
      issues.push({
        field,
        kind: 'struct_block_head_invalid',
        message: `第 ${i + 1} 块的首行不是合法块首（${
          field === 'summary' ? '须为 `### 标题`' : '须为 `### 标题` 或「做什么：」「明确不做什么：」'
        }）`,
      })
      break
    }
  }
}

/**
 * 对一个 WorkCase 的 `scope` / `summary` 做书写结构校验。
 *
 * 返回的每条都带 `field`，供呈现层**在对应字段位置就地显示**（与既有
 * `FieldProblem` 的就地原则一致：不升级为整对象读取失败）。
 */
export function validateWorkcaseStructuredText(obj: Record<string, unknown>): StructuredTextIssue[] {
  const issues: StructuredTextIssue[] = []
  const scope = typeof obj.scope === 'string' ? obj.scope : null
  const summary = typeof obj.summary === 'string' ? obj.summary : null
  if (scope !== null && scope.trim().length > 0) {
    validateScopeLabelLines(scope, issues)
    validateStructuredBlocks(scope, 'scope', issues)
  }
  if (summary !== null && summary.trim().length > 0) {
    validateStructuredBlocks(summary, 'summary', issues)
  }
  return issues
}
