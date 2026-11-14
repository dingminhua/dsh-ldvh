/**
 * Web-owned field-level reader for current fact carriers.
 *
 * It deliberately does not call the Core validator: readable source fields,
 * field problems, and unconsumed source structure must remain distinguishable.
 */
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { FACT_FIELD_CONTRACT, type FactType, type FieldExpectation, type ObjectShape } from './factFieldContract.js'
import { canonicalUid } from '../../shared/factIdentity.js'

export const FACT_TYPE_DIRS = {
  adr: 'adrs',
  pitfall: 'pitfalls',
  spark: 'sparks',
  report: 'reports',
  friction: 'frictions',
  // v5 Norm（27 号 §7）：事实规范落 ldvh-base/norms/（目录名 = 类型短名复数，
  // 与既有五类同惯例）。注意不与仓库根 specs/（元规范）混同。
  norm: 'norms',
  // v5 SubGoal（28 号 §7）：子目标落 ldvh-base/subgoals/。
  subgoal: 'subgoals',
} as const

export const FACT_TYPE_CARRIERS = {
  // 载体为 frontmatter（机器权威）+ markdown 正文（
  // ## 执行 等节由读取层按 H2 解析；正文经 extra 通道投影为 report_body）。
  // v5 ADR（22 §7）：YAML frontmatter（机器权威）+ markdown 正文，同 spark/research 形态。
  adr: '.md',
  // v5 Pitfall（23 §7）：同上，frontmatter + markdown。
  pitfall: '.md',
  // v5 Spark（20 §7）：YAML frontmatter（机器权威）+ markdown 正文，同 research 形态。
  spark: '.md',
  report: '.md',
  // v5 Friction（26 §7）：同上，frontmatter + markdown。
  friction: '.md',
  // v5 Norm（27 号 §7）：同上，frontmatter（机器权威）+ markdown 正文。
  norm: '.md',
  // v5 SubGoal（28 号 §8）：同上，frontmatter + 正文两块固定 H2。
  subgoal: '.md',
} as const

export type LocalFactType = FactType
export type LocalFactCarrier = 'yaml' | 'markdown'
export type LocalFactReadStatus = 'readable' | 'unreadable'

export type LocalFactIssue = {
  code: 'read_failed' | 'yaml_parse_failed' | 'frontmatter_missing' | 'frontmatter_unclosed' | 'frontmatter_parse_failed' | 'unexpected_fact_carrier'
  message: string
  path?: string
}

export type FieldIssue = {
  path: string
  reason: 'missing' | 'type_mismatch' | 'identity_mismatch'
  expected: string
  raw_value?: unknown
}

export type UnparsedStructure = {
  path: string
  reason: 'unconsumed_field' | 'unparseable_member'
  raw_value?: unknown
}

export type LocalFactMetadata = {
  object_ref: {
    governed_project_id: string
    fact_type_key: string
    object_id: string
  }
  authority_ref?: { object_uid: string }
  canonical_path: string
  absolute_path: string
  carrier: LocalFactCarrier
}

export type LocalFactItem = LocalFactMetadata & {
  read_status: LocalFactReadStatus
  source_content_fingerprint: string | null
  /** 文件中 YAML 部分的逐字原文（markdown 载体=两 --- 标记之间；yaml 载体=整个文件）。
   *  供 YAML 源视图直显——有什么就显示什么，未经过解析、过滤或重排。 */
  yaml_source?: string | null
  fact_object: Record<string, unknown> | null
  field_issues: FieldIssue[]
  unparsed_structures: UnparsedStructure[]
  issues: LocalFactIssue[]
}

export type LocalFactList = {
  status: 'complete' | 'type_not_integrated'
  items: LocalFactItem[]
  issues: LocalFactIssue[]
}

export interface LocalFactScope {
  worktreeLocator: string
  governedProjectId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/**
 * 读取层缓存：事实载体是磁盘上的只读文件，Web API 进程不写它们（写入走 LDVH
 * CLI 独立进程）。因此以「目录 + 每个载体的 (mtimeMs, size)」作为失效指纹——
 * 外部写入必然改变其中至少一项，缓存随即自愈，不会读到陈旧内容。
 *
 * 代价：一次指纹只花 stat（320 个载体约 11ms），远低于重读全文（约 86ms）；
 * 而 listObjects 每次调用都要重建全部 7 类索引两遍，指纹摊薄后收益成倍放大。
 */
interface ListCacheEntry {
  signature: string
  list: LocalFactList
}

const listCache = new Map<string, ListCacheEntry>()
const LIST_CACHE_LIMIT = 64

function cacheKeyOf(scope: LocalFactScope, type: LocalFactType): string {
  return `${scope.governedProjectId}\u0000${scope.worktreeLocator}\u0000${type}`
}

/** 目录内容指纹：文件名 + mtime + size。任一载体新增/删除/改写都会改变它。 */
async function carrierSignature(dir: string): Promise<string | null> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const parts: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    try {
      const info = await stat(path.join(dir, entry.name))
      parts.push(`${entry.name}:${info.mtimeMs}:${info.size}`)
    } catch {
      // 读指纹期间文件被删：本轮指纹按缺失处理，交给下次重建。
      parts.push(`${entry.name}:missing`)
    }
  }
  parts.sort()
  return parts.join('|')
}

function rememberList(key: string, entry: ListCacheEntry): void {
  if (listCache.size >= LIST_CACHE_LIMIT && !listCache.has(key)) {
    const oldest = listCache.keys().next().value
    if (oldest !== undefined) listCache.delete(oldest)
  }
  listCache.set(key, entry)
}

function baseDirOf(scope: LocalFactScope, type: LocalFactType): string {
  return path.join(scope.worktreeLocator, 'ldvh-base', FACT_TYPE_DIRS[type])
}

function expectedFileName(type: LocalFactType, objectId: string): string {
  return `${objectId}${FACT_TYPE_CARRIERS[type]}`
}

/**
 * v5 markdown 载体类型（frontmatter 机器权威 + 正文）。
 *
 * 这四处判断原先各写一遍类型枚举，
 * 新增一类就要在四处同时补——漏一处的后果不是报错，而是该类型被当成 YAML
 * 载体读取并静默读空。收敛为一个集合，使「加一类」只有一处要改。
 *
 * 20 §7 / 22 §7 / 23 §7 / 24 §7 / 26 §7 / 27 §7 / 28 §8。
 * （29 号 DevLog 已于 2026-11-14 撤除，随之退出本集合。）
 */
const MARKDOWN_CARRIER_TYPES: ReadonlySet<LocalFactType> = new Set<LocalFactType>([
  'report', 'spark', 'adr', 'pitfall', 'friction', 'norm', 'subgoal',
])

function carrierFor(type: LocalFactType): LocalFactCarrier {
  // v5 markdown 载体类型：frontmatter（机器权威）+ 正文（20 §7 / 21 §7 / 22 §7 /
  // 23 §7 / 24 §7 / 26 §7 / 27 §7，正文经 extra 通道投影为 report_body）。
  return MARKDOWN_CARRIER_TYPES.has(type) ? 'markdown' : 'yaml'
}

function metadataFor(scope: LocalFactScope, type: LocalFactType, objectId: string): LocalFactMetadata {
  const fileName = expectedFileName(type, objectId)
  return {
    object_ref: { governed_project_id: scope.governedProjectId, fact_type_key: type, object_id: objectId },
    canonical_path: path.posix.join('ldvh-base', FACT_TYPE_DIRS[type], fileName),
    absolute_path: path.join(baseDirOf(scope, type), fileName),
    carrier: carrierFor(type),
  }
}

function isExpectedCarrierName(type: LocalFactType, fileName: string): boolean {
  const extension = FACT_TYPE_CARRIERS[type].replace('.', '\\.')
  // v5 markdown 载体类型（spark/research/adr/pitfall/friction/norm）：object_uid
  // 为 UUIDv4（21 §7 / 20 §7 / 22 §7 / 23 §7 / 24 §7 / 26 §7 / 27 §7，文件名编码 UID）；
  // 纯序号/ULID25 段保留兼容读取。其余类型维持 v4 形态（纯序号或 ULID25）。
  const idSegment = MARKDOWN_CARRIER_TYPES.has(type)
    ? '(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\\d{4,}|[0-7][0-9A-HJKMNP-TV-Z]{25})'
    : '(?:\\d{4,}|[0-7][0-9A-HJKMNP-TV-Z]{25})'
  return new RegExp(`^${type}-${idSegment}${extension}$`).test(fileName)
}

function expectedManifestPath(metadata: LocalFactMetadata): string {
  return metadata.absolute_path
}

function looksLikeFactCarrier(fileName: string): boolean {
  return /\.(?:yaml|yml|md)$/i.test(fileName)
}

function parseMarkdownWithFrontmatter(content: string): { metadata: Record<string, unknown> | null; frontmatterSource: string; body: string; issues: LocalFactIssue[] } {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { metadata: null, frontmatterSource: '', body: '', issues: [{ code: 'frontmatter_missing', message: 'Markdown 缺少 frontmatter' }] }
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end === -1) {
    return { metadata: null, frontmatterSource: '', body: '', issues: [{ code: 'frontmatter_unclosed', message: 'frontmatter 未闭合' }] }
  }
  // frontmatterSource 是喂给 yaml.load 的同一份原始文本（两标记之间的逐字内容，
  // 含注释、原顺序、原引号风格）——yaml_source 直显用它，保证「有什么显示什么」。
  const frontmatterSource = lines.slice(1, end).join('\n')
  try {
    const value = yaml.load(frontmatterSource)
    if (!isRecord(value)) {
      return { metadata: null, frontmatterSource, body: '', issues: [{ code: 'frontmatter_parse_failed', message: 'frontmatter 顶层不是键值映射' }] }
    }
    return { metadata: value, frontmatterSource, body: lines.slice(end + 1).join('\n').replace(/^\s*\n/, ''), issues: [] }
  } catch (error) {
    return { metadata: null, frontmatterSource, body: '', issues: [{ code: 'frontmatter_parse_failed', message: `frontmatter YAML 解析失败：${error instanceof Error ? error.message : String(error)}` }] }
  }
}

/** 契约中以 string 承载、且 YAML 可能解析为 Date 的时间字段。 */
const TIMESTAMP_FIELDS: ReadonlySet<string> = new Set([
  'created_at', 'updated_at', 'retired_at', 'occurred_at', 'resolved_at', 'closed_at',
])

function isTimestampField(field: string): boolean {
  return TIMESTAMP_FIELDS.has(field)
}

/**
 * 契约对象的承载完整性判定（一次复核发现 3）。
 *
 * 只做 `isRecord` 时，`{}` 与 `{ garbage_key: 1 }` 都会被当成合法的
 * `expected: 'object'` 承载原样投影，而 CLI 侧 `normalizeAttributionRef` 对
 * 同样输入返回 undefined——同一载体两套读法，web 那套是静默放行。故契约可以
 * 声明 `objectShape`（必备身份键 + 非空键），这里按声明核验；未声明形状的
 * object 字段维持既有宽松行为（不在本次扩围）。
 */
function matchesObjectShape(value: Record<string, unknown>, shape: ObjectShape | undefined): boolean {
  if (!shape) return true
  for (const key of shape.requiredKeys ?? []) {
    if (!(key in value)) return false
  }
  for (const key of shape.nonEmptyKeys ?? []) {
    const member = value[key]
    if (typeof member !== 'string' || member.trim().length === 0) return false
  }
  return true
}

function matchesExpectation(value: unknown, expected: FieldExpectation, shape?: ObjectShape): boolean {
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'object') return isRecord(value) && matchesObjectShape(value as Record<string, unknown>, shape)
  return typeof value === expected
}

const RECORD_ARRAY_FIELDS: Partial<Record<LocalFactType, ReadonlySet<string>>> = {
  // v5 Spark：evolution 成员 {at, summary}（20 §8），relations 仅 merged-into/
  // split-into（03 §7.2 公共形状），不进值级展开。
  spark: new Set(['evolution', 'relations', 'change_log']),
  adr: new Set(['change_log']),
  pitfall: new Set(['change_log']),
  // confirmed_statements 是字符串数组（声明句索引，24 §8），不进记录成员检查。
  report: new Set(['uncertain', 'gaps', 'implications', 'clarification_log', 'change_log']),
}

function isConsumableRecordMember(type: LocalFactType, field: string, member: Record<string, unknown>): boolean {
  if (field === 'change_log') {
    // 签名不是流水条目的准入条件：只读取对应事实流水的完整署名（cognition.ts 同款纪律），
    // 缺失或不识别的形态不补造也不误判——at + summary 成立即可消费，
    // 否则无 signature 的历史/工具流水会被误报为 unparseable_member。
    // at 同样可能是 YAML 解析出的 Date（未加引号的 ISO 时间戳），按文本归一化后判定。
    const at = member.at instanceof Date ? member.at.toISOString() : member.at
    return typeof at === 'string' && at.trim().length > 0
      && typeof member.summary === 'string' && member.summary.trim().length > 0
      && (member.signature === undefined || isConsumableChangeLogSignature(member.signature))
  }
  if (type !== 'spark' || field !== 'evolution') return true
  const evolutionAt = member.at instanceof Date ? member.at.toISOString() : member.at
  return typeof evolutionAt === 'string' && evolutionAt.trim().length > 0
    && typeof member.summary === 'string' && member.summary.trim().length > 0
}

function isConsumableChangeLogSignature(value: unknown): boolean {
  if (!isRecord(value)) return false
  // Current two-field shape (agent_runtime_name retired from the contract).
  const hasCurrentShape = Object.keys(value).every((key) => key === 'product_name' || key === 'model_name')
    && Object.keys(value).length === 2
    && Object.entries(value).every(([key, entry]) => (
      ['product_name', 'model_name'].includes(key)
        ? entry === null || (typeof entry === 'string' && entry.trim().length > 0)
        : false
    ))
    && Object.values(value).some((entry) => typeof entry === 'string' && entry.trim().length > 0)
  if (hasCurrentShape) return true

  // Historical three-field shape (agent_runtime_name retired); readable for legacy data.
  const hasLegacyThreeFieldShape = Object.keys(value).every((key) => key === 'product_name' || key === 'model_name' || key === 'agent_runtime_name')
    && Object.keys(value).length === 3
    && Object.entries(value).every(([key, entry]) => (
      ['product_name', 'model_name', 'agent_runtime_name'].includes(key)
        ? entry === null || (typeof entry === 'string' && entry.trim().length > 0)
        : false
    ))
    && Object.values(value).some((entry) => typeof entry === 'string' && entry.trim().length > 0)
  if (hasLegacyThreeFieldShape) return true

  const hasCanonicalShape = Object.keys(value).every((key) => key === 'model_id' || key === 'agent_workbench')
    && typeof value.model_id === 'string'
    && value.model_id.trim().length > 0
    && typeof value.agent_workbench === 'string'
    && value.agent_workbench.trim().length > 0
  if (hasCanonicalShape) return true

  const hasHostEnvironmentLegacy = Object.keys(value).every((key) => key === 'agent_id' || key === 'host_environment')
    && typeof value.agent_id === 'string'
    && value.agent_id.trim().length > 0
    && typeof value.host_environment === 'string'
    && value.host_environment.trim().length > 0
  if (hasHostEnvironmentLegacy) return true

  // Historical intermediate shape (model_id + host_name), readable only.
  return Object.keys(value).every((key) => key === 'model_id' || key === 'host_name')
    && typeof value.model_id === 'string'
    && value.model_id.trim().length > 0
    && typeof value.host_name === 'string'
    && value.host_name.trim().length > 0
}

function projectFields(type: LocalFactType, objectId: string, parsed: Record<string, unknown>, extra: Record<string, unknown>): Pick<LocalFactItem, 'fact_object' | 'field_issues' | 'unparsed_structures'> {
  const all = { ...parsed, ...extra }
  const expected = FACT_FIELD_CONTRACT[type]
  const factObject: Record<string, unknown> = {}
  const fieldIssues: FieldIssue[] = []
  const unparsedStructures: UnparsedStructure[] = []
  // v5 身份语义：research 对象的 object_id 由文件名承载（writer 不写进 frontmatter）。
  // 读取时以文件名推导值注入 all，供 object-id 契约字段消费；显式写入且不一致
  // 的仍走下方 identity_mismatch 校验。
  if (all.object_id === undefined && objectId) all.object_id = objectId
  for (const [field, contract] of Object.entries(expected)) {
    const { expected: kind } = contract
    const value0 = all[field]
    // YAML 会把未加引号的 ISO 时间戳解析为 Date 对象，而契约要求 string——
    // 时间字段按 ISO 8601 归一化后再判定，避免合规值被误报 type_mismatch。
    const value = kind === 'string' && isTimestampField(field) && value0 instanceof Date
      ? value0.toISOString()
      : value0
    if (value === undefined || value === null) {
      if (contract.required) fieldIssues.push({ path: field, reason: 'missing', expected: kind })
      continue
    }
    if (!matchesExpectation(value, kind, contract.objectShape)) {
      fieldIssues.push({ path: field, reason: 'type_mismatch', expected: kind, raw_value: value })
      continue
    }
    factObject[field] = value
    if (kind === 'array' && Array.isArray(value) && RECORD_ARRAY_FIELDS[type]?.has(field)) {
      value.forEach((member, index) => {
        if (!isRecord(member) || !isConsumableRecordMember(type, field, member)) {
          unparsedStructures.push({ path: `${field}[${index}]`, reason: 'unparseable_member', raw_value: member })
        }
      })
    }
  }
  if (typeof all.object_id === 'string' && all.object_id !== objectId) {
    fieldIssues.push({ path: 'object_id', reason: 'identity_mismatch', expected: objectId, raw_value: all.object_id })
  }
  // 03 §6.1：fact_type_key 载体值为类型短名（各类型规范「身份与载体」登记的
  // 值域；spec_key 是规范文档层标识，不作为字段值）。严格闭集校验——出现
  // 其它形态（含 spec_key 形态的 `<type>-fact-type`）如实报告 identity_mismatch，
  // 不静默归一，防止规范族值域漂移被展示层吞掉。
  if (typeof all.fact_type_key === 'string' && all.fact_type_key !== type) {
    fieldIssues.push({ path: 'fact_type_key', reason: 'identity_mismatch', expected: type, raw_value: all.fact_type_key })
  }
  // 03 §6.1：object_uid 为 canonical UUIDv4（版本位 4）。时间语义由 created_at 与
  // change_log[].at 承担，不由身份字段编码——不校验时间戳有序形态（UUIDv7）。
  if (all.object_uid !== undefined && !canonicalUid(all.object_uid)) {
    fieldIssues.push({
      path: 'object_uid',
      reason: 'identity_mismatch',
      expected: 'canonical lowercase UUIDv4',
      raw_value: all.object_uid,
    })
  }
  unparsedStructures.push(...Object.entries(all)
    .filter(([field]) => !(field in expected))
    .map(([field, value]) => ({ path: field, reason: 'unconsumed_field' as const, raw_value: value })))
  return { fact_object: factObject, field_issues: fieldIssues, unparsed_structures: unparsedStructures }
}

function unreadable(metadata: LocalFactMetadata, issues: LocalFactIssue[]): LocalFactItem {
  return { ...metadata, read_status: 'unreadable', source_content_fingerprint: null, fact_object: null, field_issues: [], unparsed_structures: [], issues: issues.map((issue) => ({ ...issue, path: issue.path ?? metadata.canonical_path })) }
}

function readable(
  metadata: LocalFactMetadata,
  sourceContentFingerprint: string,
  projected: Pick<LocalFactItem, 'fact_object' | 'field_issues' | 'unparsed_structures'>,
  yamlSource?: string,
): LocalFactItem {
  const objectUid = projected.fact_object?.object_uid
  return {
    ...metadata,
    ...(canonicalUid(objectUid) ? { authority_ref: { object_uid: objectUid } } : {}),
    read_status: 'readable',
    source_content_fingerprint: sourceContentFingerprint,
    ...(yamlSource !== undefined ? { yaml_source: yamlSource } : {}),
    ...projected,
    issues: [],
  }
}

async function readItemFile(scope: LocalFactScope, type: LocalFactType, fileName: string): Promise<LocalFactItem> {
  const objectId = fileName.replace(/\.(yaml|yml|md)$/i, '')
  const metadata = metadataFor(scope, type, objectId)
  let content: string
  let sourceContentFingerprint: string
  try {
    const carrierBytes = await readFile(expectedManifestPath(metadata))
    content = carrierBytes.toString('utf-8')
    sourceContentFingerprint = createHash('sha256').update(carrierBytes).digest('hex')
  } catch (error) {
    return unreadable(metadata, [{ code: 'read_failed', message: `文件读取失败：${error instanceof Error ? error.message : String(error)}` }])
  }
  if (metadata.carrier === 'markdown') {
    const parsed = parseMarkdownWithFrontmatter(content)
    if (parsed.metadata === null) return unreadable(metadata, parsed.issues)
    return readable(
      metadata,
      sourceContentFingerprint,
      projectFields(type, objectId, parsed.metadata, { report_body: parsed.body }),
      parsed.frontmatterSource,
    )
  }
  let parsed: unknown
  try {
    parsed = yaml.load(content)
  } catch (error) {
    return unreadable(metadata, [{ code: 'yaml_parse_failed', message: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}` }])
  }
  if (!isRecord(parsed)) {
    return unreadable(metadata, [{ code: 'yaml_parse_failed', message: 'YAML 顶层不是键值映射' }])
  }
  // yaml 载体整个文件即 YAML：yaml_source 为全文逐字原文。
  return readable(metadata, sourceContentFingerprint, projectFields(type, objectId, parsed, {}), content)
}

/**
 * 对象目录**缺失**时的读取结果。
 *
 * ## 2026-11-02（Human 定案）：目录缺失不再等于「类型未接入」
 *
 * 旧口径：目录不存在⇒ `status: 'type_not_integrated'`，Web 上显示「该事实类型尚未接入」。
 * 那条口径把一个**实现细节**（写入器首次落盘才 `mkdir`，见 `plugin/lib/devlog-writer.js`
 * 的 `DEVLOG_DIRECTORY` 落在写入路径上）泄漏成了读者面前的**结论**。同一件事——本项目
 * 还没有这一类型的任何对象——在界面上因此有两种说法：
 *
 * - `ldvh-base/devlogs/` 不存在（类型已完整接入、只是零对象）→「该事实类型尚未接入」；
 * - `ldvh-base/norms/` 存在但筛选后为空 →「未找到 norm 对象」。
 *
 * 实测证据：临时 `mkdir ldvh-base/devlogs` 后同一个请求的 `coverage_status` 立刻从
 * `type_not_integrated` 变成 `complete`、`items: []`——判据是**目录在不在**，不是有没有数据。
 *
 * 现口径：**目录缺失 = 零对象**（`status: 'complete'`, `items: []`, `issues: []`）。
 * 理由有三条，按强度排列：
 *
 * 1. 「未接入」是一个**关于代码**的断言（这个类型在读取层/投影层/呈现层有没有支持），
 *    而目录存在性只能回答**关于数据**的问题（这个项目有没有落过这个类型的对象）。
 *    用一个数据事实去报告一个代码事实，两个都答错了：对已接入的类型是假话，对真未接入的
 *    类型又是漏报（它同时也可能一条数据都没有）。
 * 2. 类型接入是**编译期事实**：`LocalFactType` 的成员、`FACT_TYPE_DIRS` / `FACT_TYPE_CARRIERS`
 *    的登记都在源码里，缺登记根本进不了本函数。故本函数已不可能看到「未接入」的类型——
 *    这个状态在运行期永远不会是**正确**答案。
 * 3. 目录由写入器按需创建，是**可恢复的瞬时状态**，不是配置错误。把它报成阻塞级结论，
 *    等于要求 Human 每次都先手动建目录才能看到「还没有对象」这句真话。
 *
 * **撤的是这条判定，不是这个状态值**：`LocalFactList.status` 的 `'type_not_integrated'`
 * 成员保留（下游 `facts.ts` / 前端 `FactCoverageStatus` 仍消费它，且未来真出现「有目录
 * 契约但无读取支持」的类型时它就是正确答案），只是本函数不再产出它。
 *
 * 附带后果（如实登记）：目录不存在时，**空目录**与**目录缺失**在 Web 上给出同一句话。
 * 这是有意的——对读者而言两者是同一件事，区分它们只会把实现细节再泄漏一次。
 */
function emptyTypeDirectory(): LocalFactList {
  return { status: 'complete', items: [], issues: [] }
}

/** 目录是否存在；不存在时按零对象处理（见上方 `emptyTypeDirectory` 的口径说明）。 */
function directoryMissing(scope: LocalFactScope, type: LocalFactType): boolean {
  return !existsSync(baseDirOf(scope, type))
}

export async function listLocalFacts(type: LocalFactType, scope: LocalFactScope): Promise<LocalFactList> {
  if (directoryMissing(scope, type)) return emptyTypeDirectory()
  const dir = baseDirOf(scope, type)
  const key = cacheKeyOf(scope, type)
  const signature = await carrierSignature(dir)
  if (signature !== null) {
    const cached = listCache.get(key)
    if (cached && cached.signature === signature) return cached.list
  }
  const entries = await readdir(dir, { withFileTypes: true })
  const carriers = entries.filter((entry) => entry.isFile() && looksLikeFactCarrier(entry.name))
  const fileNames = carriers.filter((entry) => isExpectedCarrierName(type, entry.name)).map((entry) => entry.name).sort((left, right) => left.localeCompare(right))
  // v5 markdown 类型（spark/research/adr/pitfall/friction/norm）文件名编码 UID；其余类型维持 NNNN/ULID。
  const v5UidCarrier = MARKDOWN_CARRIER_TYPES.has(type)
  const issues = carriers.filter((entry) => !isExpectedCarrierName(type, entry.name)).map((entry) => ({
    code: 'unexpected_fact_carrier' as const,
    message: v5UidCarrier
      ? `${type} 正式载体必须是 ${type}-<uid>${FACT_TYPE_CARRIERS[type]}，已忽略错载体 ${entry.name}`
      : `${type} 正式载体必须是 ${type}-NNNN${FACT_TYPE_CARRIERS[type]}，已忽略错载体 ${entry.name}`,
    path: path.posix.join('ldvh-base', FACT_TYPE_DIRS[type], entry.name),
  }))
  const list: LocalFactList = { status: 'complete', items: await Promise.all(fileNames.map((fileName) => readItemFile(scope, type, fileName))), issues }
  if (signature !== null) rememberList(key, { signature, list })
  return list
}

// v5 markdown 载体类型（spark/research/adr/pitfall/friction/norm/subgoal）
// 对象 ID 为 UUID（writer randomUUID 带 8-4-4-4-12 连字符段，22 §7 与
// 20/24/26/27/28 同形态）；其余类型保留 v4 形态（纯序号或 ULID25）。
// 29 号 DevLog 已于 2026-11-14 撤除：devlog-<uid> 形式不再可解析。
const FACT_OBJECT_ID_PATTERN = /^(adr|pitfall|spark|report|friction|norm|subgoal)-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$/

export async function readLocalFact(type: LocalFactType, objectId: string, scope: LocalFactScope): Promise<{ status: 'ok'; item: LocalFactItem } | { status: 'not_found'; metadata: LocalFactMetadata; issues: LocalFactIssue[] }> {
  const metadata = metadataFor(scope, type, objectId)
  // 目录缺失不再单独报「类型未接入」（口径见 `emptyTypeDirectory` 上方）：精确读取一个
  // 目录不存在的类型的某个 id，正确答案就是「没有这个对象」——`not_found` 已经把
  // `canonical_path` 一并带回，读者据此能看出目录还没建过。
  if (!FACT_OBJECT_ID_PATTERN.test(objectId)) {
    return { status: 'not_found', metadata, issues: [{ code: 'read_failed', message: `未找到预期事实对象 ${objectId}`, path: metadata.canonical_path }] }
  }
  const expectedName = expectedFileName(type, objectId)
  const filePath = path.join(baseDirOf(scope, type), expectedName)
  try {
    const lstatResult = await lstat(filePath)
    if (!lstatResult.isFile() || lstatResult.isSymbolicLink()) {
      return { status: 'not_found', metadata, issues: [{ code: 'read_failed', message: `未找到预期事实对象 ${expectedName}`, path: metadata.canonical_path }] }
    }
  } catch {
    return { status: 'not_found', metadata, issues: [{ code: 'read_failed', message: `未找到预期事实对象 ${expectedName}`, path: metadata.canonical_path }] }
  }
  return { status: 'ok', item: await readItemFile(scope, type, expectedName) }
}
