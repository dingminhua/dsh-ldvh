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

// ============================================================================
// 执行期阶段（10 §5.5「执行期阶段」登记）
// ============================================================================
//
// `executing` 组内部的四个阶段，**呈现层派生、不写回对象、不进筛选与收件箱**
// （筛选仍为五档）。判据依 10 §5.5，两条口径必须遵守：
//
//   ① 一律按 `change_log` 的**数组序**判定，**不得**使用 `reviews[].at` 或
//      `change_log[].at` 的相对先后——写入函数在一次写入中把同批条目刷成同一
//      时刻（workcase-writer.js 的 stampReviewEntries 注释已登记该既有边界），
//      时间因此不承载相对先后。
//   ②「本对象的条目」指摘要中**未**提及他对象 `workcase-XXXXXXXX` 的条目；
//      提及他对象的条目（如替他单执行的迁移）不参与本对象的阶段判定。
//   ③「格式治理：」前缀的条目（21 §8「格式治理」记账纪律）不参与判定——它们是
//      跨对象的批量格式操作（如 a988046 的摘要分块），语义逐字未变，不构成该对象
//      的「修订」。存量 12 条由 Human 授权的直接改写补上前缀（2026-09-23）。

export const WORKCASE_EXEC_PHASES = ['executing', 'reviewing', 'revising', 'closing'] as const
export type WorkCaseExecPhase = (typeof WORKCASE_EXEC_PHASES)[number]

/**
 * 「复核发起条目」判定（21 §8「复核发起」记账纪律，10 §5.5）。
 *
 * 判据：摘要**同时含「复核」与「发起」二词**。这一步承认既有写法
 * （「复核已发起」「独立复核已发起」），**不要求特定句式**。
 *
 * 为什么是这个形态：21 §8 已把「复核」明文列为非计划步骤的执行事项，
 * 「## 执行」节即其正文承载，故该写入是**真实的内容修改**（03 §9.5 应记之列），
 * 不是过程日志或 no-op。识别依赖措辞——写成「开始独立审核」等不含二词的形式
 * 即不可检出；该纪律本身即非机械门禁（21 §8 已声明）。
 *
 * 可靠性分布（10 §5.5 已登记）：**完成一侧是机械的**（`record_review` 由 Code
 * 盖戳写入 `reviews` 并在 change_log 留 `[review recorded by session …]`）；
 * **发起一侧依赖本判据**。故「复核中」是组合判据。
 */
const REVIEW_WORD = '复核'
const START_WORD = '发起'

function isReviewStartEntry(entry: ChangeLogEntryLike): boolean {
  if (typeof entry?.summary !== 'string') return false
  return entry.summary.includes(REVIEW_WORD) && entry.summary.includes(START_WORD)
}

/** 格式治理条目的形式标记（21 §8「格式治理」记账纪律）——不参与阶段判定。 */
const FORMAT_GOVERNANCE_MARKER = '格式治理：'

/** 他对象引用：摘要中出现 `WorkCase <uid8>` / `workcase-<uid8>` 且非本对象时，该条目不参与判定。 */
const OTHER_OBJECT_REF = /workcase[\s-]+([0-9a-f]{8})/gi

interface ChangeLogEntryLike {
  summary?: unknown
}

/** 该条目是否提及**他**对象（口径 ②）。 */
function mentionsOtherObject(summary: string, selfUid: string | null): boolean {
  const refs = [...summary.matchAll(OTHER_OBJECT_REF)]
  if (refs.length === 0) return false
  // 未提供本对象 uid 时无法区分自指与他指，保守判为不排除（宁可多算，不误排除）。
  if (selfUid === null) return false
  const self = selfUid.replace(/^workcase-/i, '').slice(0, 8).toLowerCase()
  return refs.every((m) => m[1].toLowerCase() !== self)
}

/** 「格式治理：」前缀的条目（口径 ③）——跨对象批量格式操作，不参与阶段判定。 */
function isFormatGovernanceEntry(entry: ChangeLogEntryLike): boolean {
  return typeof entry?.summary === 'string' && entry.summary.startsWith(FORMAT_GOVERNANCE_MARKER)
}

/** 摘要是否为本对象条目（未提及他对象，且非格式治理）。 */
function isOwnEntry(entry: ChangeLogEntryLike, selfUid: string | null): boolean {
  if (isFormatGovernanceEntry(entry)) return false
  const summary = typeof entry?.summary === 'string' ? entry.summary : ''
  return !mentionsOtherObject(summary, selfUid)
}

/**
 * 「复核类条目」判定：摘要含「复核」二字。
 *
 * 与 `lastReviewAt` 的既有口径一致；此处单列以便测试与变异验证直接命中断言。
 */
function isReviewEntry(entry: ChangeLogEntryLike): boolean {
  return typeof entry?.summary === 'string' && entry.summary.includes('复核')
}

// ============================================================================
// 变更流水的行动标记（10 §5.5「执行期阶段」的呈现代替品，Human 2026-09-23）
// ============================================================================
//
// 卡片主体呈现「变更流水」时，关键行动用两个字标出：「复核」「修订」。
// **不呈现阶段标签**（Human 2026-09-23：「其实就变成了一直是执行中」——状态显示
// 恒为 21 号状态机的真实值，不被本标记影响）。
//
// 标记口径复用上面已登记的三条：② 他对象条目排除；③ 格式治理条目排除；
// 数组序（不使用任何时间字段）。

export const WORKCASE_FLOW_MARKS = ['review', 'revise'] as const
export type WorkCaseFlowMark = (typeof WORKCASE_FLOW_MARKS)[number]

/**
 * 单条日志的行动标记。返回 null 表示「执行」（无标记）。
 *
 * - `review`：「复核」——机械标记 `[review recorded by session` 优先（`record_review`
 *   由 Code 盖戳写入，不依赖作者）；措辞兜底为摘要同含「复核」+「发起」（21 §8）。
 * - `revise`：「修订」——位于**最后一条复核条目之后**的本对象条目（数组序）。
 *
 * `lastReviewIndex` 为该对象 `ownChangeLog` 中最后一条复核条目的下标（-1 表示无）；
 * 由 `markWorkCaseFlow` 统一算出后传入，避免逐条重算。
 */
function markOfEntry(
  entry: ChangeLogEntryLike,
  index: number,
  lastReviewIndex: number,
  hasReviews: boolean,
): WorkCaseFlowMark | null {
  const s = typeof entry?.summary === 'string' ? entry.summary : ''
  if (s.includes('review recorded by session')) return 'review'
  if (s.includes(REVIEW_WORD) && s.includes(START_WORD)) return 'review'
  if (hasReviews && lastReviewIndex >= 0) {
    if (index === lastReviewIndex) return 'review'
    if (index > lastReviewIndex) return 'revise'
  }
  return null
}

/**
 * 为一份 `change_log` 派生流水标记。
 *
 * 返回与输入**逐项对应**的数组（长度相同，无标记处为 null），调用方据此渲染，
 * 不必自行判断归属或数组序。`reviews` 非空表示复核已完成（`21 §8`），
 * 是「修订」标记成立的前提——未复核就谈不上复核后修订。
 */
export function markWorkCaseFlow(
  reviews: unknown,
  changeLog: unknown,
  selfUid: string | null,
): (WorkCaseFlowMark | null)[] {
  const all: ChangeLogEntryLike[] = Array.isArray(changeLog) ? (changeLog as ChangeLogEntryLike[]) : []
  const hasReviews = Array.isArray(reviews) && reviews.length > 0
  // 只在**本对象**条目上定位复核，与阶段判定同一口径（他对象条目、格式治理条目排除）。
  const ownIndexes: number[] = []
  let lastReviewIndex = -1
  all.forEach((e, i) => {
    if (!isOwnEntry(e, selfUid)) return
    ownIndexes.push(i)
    if (isReviewEntry(e)) lastReviewIndex = ownIndexes.length - 1
  })
  const ownPosition = new Map<number, number>()
  ownIndexes.forEach((realIdx, ownIdx) => ownPosition.set(realIdx, ownIdx))

  return all.map((e, i) => {
    const ownIdx = ownPosition.get(i)
    if (ownIdx === undefined) return null // 他对象条目 / 格式治理条目：不参与，也不标记
    return markOfEntry(e, ownIdx, lastReviewIndex, hasReviews)
  })
}

/**
 * 取「本对象」的日志条目及原始下标（流水渲染用）。
 *
 * 与 `markWorkCaseFlow` 同口径：排除他对象条目（口径②）与格式治理条目（口径③）。
 */
export function ownChangeLogEntries(
  changeLog: unknown,
  selfUid: string | null,
): { index: number; entry: ChangeLogEntryLike }[] {
  const all: ChangeLogEntryLike[] = Array.isArray(changeLog) ? (changeLog as ChangeLogEntryLike[]) : []
  return all
    .map((entry, index) => ({ index, entry }))
    .filter(({ entry }) => isOwnEntry(entry, selfUid))
}

/**
 * 派生执行期阶段。**只在 group=executing 时有意义**；其余分组返回 null。
 *
 * | 阶段 | 判据 |
 * |---|---|
 * | 执行中（executing） | `reviews` 不存在，且 `change_log` 中无复核发起条目 |
 * | 复核中（reviewing） | `change_log` 中存在复核发起条目，且 `reviews` 不存在 |
 * | 修订中（revising）   | `reviews` 存在，且其后仍有**本对象**的 `change_log` 条目 |
 * | 结项中（closing）    | `reviews` 存在，且其后无本对象的 `change_log` 条目 |
 *
 * 「复核中」的两侧可靠性不同（10 §5.5 已登记）：**完成一侧是机械的**——
 * `record_review` 由 Code 盖戳写入 `reviews`，不依赖作者；**发起一侧依赖措辞**
 * （见 `isReviewStartEntry`）——未按含「复核」+「发起」二词的形式记录时不可判，
 * 会停留在「执行中」。该纪律本身即非机械门禁（21 §8 已声明）。
 */
export function deriveWorkCaseExecPhase(
  group: WorkCaseV5Group | null,
  reviews: unknown,
  changeLog: unknown,
  selfUid: string | null,
): WorkCaseExecPhase | null {
  if (group !== 'executing') return null
  const entries: ChangeLogEntryLike[] = Array.isArray(changeLog)
    ? (changeLog as ChangeLogEntryLike[])
    : []
  const hasReviews = Array.isArray(reviews) && reviews.length > 0
  if (!hasReviews) {
    const started = entries.some((e) => isReviewStartEntry(e))
    return started ? 'reviewing' : 'executing'
  }
  // 复核已录入：数组序上，最后一条「复核类」条目之后是否仍有本对象条目。
  // 「复核类条目」= 摘要含「复核」二字者；这是 §5.5 口径 ① 所要求的数组序判定。
  let lastReviewAt = -1
  entries.forEach((e, i) => {
    if (isReviewEntry(e)) lastReviewAt = i
  })
  const after = lastReviewAt >= 0 ? entries.slice(lastReviewAt + 1) : []
  const ownAfter = after.filter((e) => isOwnEntry(e, selfUid))
  return ownAfter.length > 0 ? 'revising' : 'closing'
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

/**
 * 相对时间（天级标签）：「今天」或「N天前」。
 *
 * 与 `api/services/time.ts` 的 `getRelativeTime` 同口径（天级切片），但该函数住在
 * `api/` 层、前端组件无法直接消费，故在此单列一份供卡片使用。未来时间不作负数
 * （按「今天」兜底）——写入函数会把同批条目刷成同一时刻，时钟与数据的偏差不应
 * 显示成「-1天前」。
 */
export function relativeDayLabel(date: Date, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (days <= 0) return '今天'
  return `${days}天前`
}
