// 21 号三态直读 + 派生分组（v5）。本文件是 WorkCase 呈现的唯一派生权威：
// 筛选器与认知中心收件箱共用同一派生函数，一处定义两处消费（防口径漂移）。
//
// 派生判据（10 号呈现契约将登记的规则）：
//   - status 闭集 draft / open / closed（21 §8 状态闭集三值）；其余值一律 unresolved。
//   - closed 配 outcome 四值 completed / partial / not-achieved / cancelled（21 §8）。
//   - 「待批准关闭」= status=open ∧ 正文（report_body）含 H2「## 结果」节。
//     注意 ATX 语义：容许 ≤3 空格缩进、行尾空白；忽略代码围栏（``` 或 ~~~）内的行。
//   - 派生分组（五档筛选 / cognition 收件语义）全部由本函数给出，不写回对象文件。

export const WORKCASE_V5_STATUSES = ['draft', 'open', 'closed'] as const
export type WorkCaseV5Status = (typeof WORKCASE_V5_STATUSES)[number]

export const WORKCASE_V5_OUTCOMES = ['completed', 'partial', 'not-achieved', 'cancelled'] as const
export type WorkCaseV5Outcome = (typeof WORKCASE_V5_OUTCOMES)[number]

// 筛选五档（Human 2026-09-15 定案）：待批准执行/执行中/待批准关闭/已关闭/全部。
export const WORKCASE_V5_FILTER_VALUES = ['pending_gate1', 'executing', 'awaiting_gate2', 'closed', 'all'] as const
export type WorkCaseV5Filter = (typeof WORKCASE_V5_FILTER_VALUES)[number]

export type WorkCaseV5Group = 'pending_gate1' | 'executing' | 'awaiting_gate2' | 'closed'

export interface WorkCaseV5View {
  resolution: 'resolved' | 'unresolved'
  reason: string | null
  fingerprint: string | null
  status: WorkCaseV5Status | null
  group: WorkCaseV5Group | null
  outcome: WorkCaseV5Outcome | null
  has_result_draft: boolean
}

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/

/**
 * 判断正文是否含有 H2「## 结果」节。
 *
 * - ATX 容许 ≤3 空格缩进与行尾空白；
 * - 忽略代码围栏（``` 或 ~~~）内的所有行（含其中出现的「## 结果」）；
 * - 只认 H2（`##`）层级，更深层级不算；标题文本须为「结果」（已 trim）。
 */
export function bodyHasResultSection(body: unknown): boolean {
  if (typeof body !== 'string' || body.length === 0) return false
  const lines = body.split(/\r?\n/)
  let inFence = false
  let fenceMarker = ''
  for (const line of lines) {
    const fenceMatch = /^ {0,3}(```|~~~)/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }
    if (inFence) continue
    if (/^ {0,3}##\s+结果\s*$/.test(line)) return true
  }
  return false
}

/** 归一化 fingerprint：64-hex 或 null（非规整值降级为 null，但不影响 resolution）。 */
function normalizeFingerprint(fingerprint: unknown): string | null {
  return typeof fingerprint === 'string' && FINGERPRINT_PATTERN.test(fingerprint) ? fingerprint : null
}

/**
 * 由 status / outcome / report_body / fingerprint 派生 21 号三态直读视图。
 *
 * - status 非 draft/open/closed → unresolved('unsupported_status')；
 * - draft → group=pending_gate1（含 C2 局部重批回 draft 的对象——同在等 Gate 1）；
 * - open ∧ 正文含「## 结果」节 → group=awaiting_gate2，has_result_draft=true；
 * - open → group=executing；
 * - closed → group=closed，outcome 四值校验（非法值降级为 null）。
 */
export function deriveWorkCaseV5View(
  status: unknown,
  outcome: unknown,
  reportBody: unknown,
  fingerprint: unknown,
): WorkCaseV5View {
  const normalizedFingerprint = normalizeFingerprint(fingerprint)
  if (!WORKCASE_V5_STATUSES.includes(status as WorkCaseV5Status)) {
    return {
      resolution: 'unresolved',
      reason: 'unsupported_status',
      fingerprint: normalizedFingerprint,
      status: null,
      group: null,
      outcome: null,
      has_result_draft: false,
    }
  }
  const validStatus = status as WorkCaseV5Status
  if (validStatus === 'draft') {
    return {
      resolution: 'resolved',
      reason: null,
      fingerprint: normalizedFingerprint,
      status: 'draft',
      group: 'pending_gate1',
      outcome: null,
      has_result_draft: false,
    }
  }
  if (validStatus === 'open') {
    const hasResultDraft = bodyHasResultSection(reportBody)
    return {
      resolution: 'resolved',
      reason: null,
      fingerprint: normalizedFingerprint,
      status: 'open',
      group: hasResultDraft ? 'awaiting_gate2' : 'executing',
      outcome: null,
      has_result_draft: hasResultDraft,
    }
  }
  // closed
  const validOutcome = WORKCASE_V5_OUTCOMES.includes(outcome as WorkCaseV5Outcome)
    ? (outcome as WorkCaseV5Outcome)
    : null
  return {
    resolution: 'resolved',
    reason: null,
    fingerprint: normalizedFingerprint,
    status: 'closed',
    group: 'closed',
    outcome: validOutcome,
    has_result_draft: false,
  }
}
