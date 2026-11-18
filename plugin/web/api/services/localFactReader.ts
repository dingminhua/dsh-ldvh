import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { FACT_FIELD_CONTRACT, type FactType, type FieldExpectation, type ObjectShape } from './factFieldContract.js'
import { canonicalUid } from '../../shared/factIdentity.js'

export const FACT_TYPE_DIRS = {
  pitfall: 'pitfalls',
  spark: 'sparks',
  report: 'reports',
  friction: 'frictions',
  norm: 'norms',
  subgoal: 'subgoals',
} as const

export const FACT_TYPE_CARRIERS = {
  pitfall: '.md',
  spark: '.md',
  report: '.md',
  friction: '.md',
  norm: '.md',
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

interface ListCacheEntry {
  signature: string
  list: LocalFactList
}

const listCache = new Map<string, ListCacheEntry>()
const LIST_CACHE_LIMIT = 64

function cacheKeyOf(scope: LocalFactScope, type: LocalFactType): string {
  return `${scope.governedProjectId}\u0000${scope.worktreeLocator}\u0000${type}`
}

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

const MARKDOWN_CARRIER_TYPES: ReadonlySet<LocalFactType> = new Set<LocalFactType>([
  'report', 'spark', 'pitfall', 'friction', 'norm', 'subgoal',
])

function carrierFor(type: LocalFactType): LocalFactCarrier {
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

const TIMESTAMP_FIELDS: ReadonlySet<string> = new Set([
  'created_at', 'updated_at', 'retired_at', 'occurred_at', 'resolved_at', 'closed_at',
])

function isTimestampField(field: string): boolean {
  return TIMESTAMP_FIELDS.has(field)
}

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
  spark: new Set(['evolution', 'relations', 'change_log']),
  pitfall: new Set(['change_log']),
  report: new Set(['uncertain', 'gaps', 'implications', 'clarification_log', 'change_log']),
}

function isConsumableRecordMember(type: LocalFactType, field: string, member: Record<string, unknown>): boolean {
  if (field === 'change_log') {
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
  const hasCurrentShape = Object.keys(value).every((key) => key === 'product_name' || key === 'model_name')
    && Object.keys(value).length === 2
    && Object.entries(value).every(([key, entry]) => (
      ['product_name', 'model_name'].includes(key)
        ? entry === null || (typeof entry === 'string' && entry.trim().length > 0)
        : false
    ))
    && Object.values(value).some((entry) => typeof entry === 'string' && entry.trim().length > 0)
  if (hasCurrentShape) return true

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
  if (all.object_id === undefined && objectId) all.object_id = objectId
  for (const [field, contract] of Object.entries(expected)) {
    const { expected: kind } = contract
    const value0 = all[field]
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
  if (typeof all.fact_type_key === 'string' && all.fact_type_key !== type) {
    fieldIssues.push({ path: 'fact_type_key', reason: 'identity_mismatch', expected: type, raw_value: all.fact_type_key })
  }
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
  return readable(metadata, sourceContentFingerprint, projectFields(type, objectId, parsed, {}), content)
}

function emptyTypeDirectory(): LocalFactList {
  return { status: 'complete', items: [], issues: [] }
}

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

const FACT_OBJECT_ID_PATTERN = /^(pitfall|spark|report|friction|norm|subgoal)-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$/

export async function readLocalFact(type: LocalFactType, objectId: string, scope: LocalFactScope): Promise<{ status: 'ok'; item: LocalFactItem } | { status: 'not_found'; metadata: LocalFactMetadata; issues: LocalFactIssue[] }> {
  const metadata = metadataFor(scope, type, objectId)
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
