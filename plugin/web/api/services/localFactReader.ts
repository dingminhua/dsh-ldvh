/**
 * Web-owned field-level reader for current fact carriers.
 *
 * It deliberately does not call the Core validator: readable source fields,
 * field problems, and unconsumed source structure must remain distinguishable.
 */
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { FACT_FIELD_CONTRACT, type FactType, type FieldExpectation } from './factFieldContract.js'

export const FACT_TYPE_DIRS = {
  workcase: 'workcases',
  adr: 'adrs',
  pitfall: 'pitfalls',
  spark: 'sparks',
  study: 'studies',
} as const

export const FACT_TYPE_CARRIERS = {
  workcase: '.yaml',
  adr: '.yaml',
  pitfall: '.yaml',
  spark: '.yaml',
  study: '.md',
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

function baseDirOf(scope: LocalFactScope, type: LocalFactType): string {
  return path.join(scope.worktreeLocator, 'ldvh-base', FACT_TYPE_DIRS[type])
}

function expectedFileName(type: LocalFactType, objectId: string): string {
  return `${objectId}${FACT_TYPE_CARRIERS[type]}`
}

function carrierFor(type: LocalFactType): LocalFactCarrier {
  return type === 'study' ? 'markdown' : 'yaml'
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
  return new RegExp(`^${type}-(?:\\d{4,}|[0-7][0-9A-HJKMNP-TV-Z]{25})${extension}$`).test(fileName)
}

function expectedManifestPath(metadata: LocalFactMetadata): string {
  return metadata.absolute_path
}

function looksLikeFactCarrier(fileName: string): boolean {
  return /\.(?:yaml|yml|md)$/i.test(fileName)
}

function parseMarkdownWithFrontmatter(content: string): { metadata: Record<string, unknown> | null; body: string; issues: LocalFactIssue[] } {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { metadata: null, body: '', issues: [{ code: 'frontmatter_missing', message: 'Markdown 缺少 frontmatter' }] }
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end === -1) {
    return { metadata: null, body: '', issues: [{ code: 'frontmatter_unclosed', message: 'frontmatter 未闭合' }] }
  }
  try {
    const value = yaml.load(lines.slice(1, end).join('\n'))
    if (!isRecord(value)) {
      return { metadata: null, body: '', issues: [{ code: 'frontmatter_parse_failed', message: 'frontmatter 顶层不是键值映射' }] }
    }
    return { metadata: value, body: lines.slice(end + 1).join('\n').replace(/^\s*\n/, ''), issues: [] }
  } catch (error) {
    return { metadata: null, body: '', issues: [{ code: 'frontmatter_parse_failed', message: `frontmatter YAML 解析失败：${error instanceof Error ? error.message : String(error)}` }] }
  }
}

function matchesExpectation(value: unknown, expected: FieldExpectation): boolean {
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'object') return isRecord(value)
  return typeof value === expected
}

const RECORD_ARRAY_FIELDS: Partial<Record<LocalFactType, ReadonlySet<string>>> = {
  workcase: new Set([
    'success_criterion_definitions', 'success_criterion_results', 'work_items',
    'creation_reviews', 'result_reviews', 'residual_responsibilities', 'relations', 'change_log',
  ]),
  spark: new Set(['evolution', 'relations', 'change_log']),
  adr: new Set(['change_log']),
  pitfall: new Set(['change_log']),
  study: new Set(['change_log']),
}

function isConsumableRecordMember(type: LocalFactType, field: string, member: Record<string, unknown>): boolean {
  if (field === 'change_log') {
    return typeof member.at === 'string' && member.at.trim().length > 0
      && typeof member.summary === 'string' && member.summary.trim().length > 0
      && isConsumableChangeLogSignature(member.signature)
  }
  if (type !== 'spark' || field !== 'evolution') return true
  return typeof member.at === 'string' && member.at.trim().length > 0
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
  for (const [field, contract] of Object.entries(expected)) {
    const { expected: kind } = contract
    const value = all[field]
    if (value === undefined || value === null) {
      if (contract.required) fieldIssues.push({ path: field, reason: 'missing', expected: kind })
      continue
    }
    if (!matchesExpectation(value, kind)) {
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
  if (all.object_uid !== undefined && (typeof all.object_uid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(all.object_uid))) {
    fieldIssues.push({
      path: 'object_uid',
      reason: 'identity_mismatch',
      expected: 'canonical lowercase UUIDv7',
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
): LocalFactItem {
  const objectUid = projected.fact_object?.object_uid
  return {
    ...metadata,
    ...(typeof objectUid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(objectUid)
      ? { authority_ref: { object_uid: objectUid } }
      : {}),
    read_status: 'readable',
    source_content_fingerprint: sourceContentFingerprint,
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
  return readable(metadata, sourceContentFingerprint, projectFields(type, objectId, parsed, {}))
}

function directoryStatus(scope: LocalFactScope, type: LocalFactType): LocalFactList | null {
  if (existsSync(baseDirOf(scope, type))) return null
  return { status: 'type_not_integrated', items: [], issues: [{ code: 'read_failed', message: `该类型尚未接入：缺少正式对象目录 ${path.posix.join('ldvh-base', FACT_TYPE_DIRS[type])}` }] }
}

export async function listLocalFacts(type: LocalFactType, scope: LocalFactScope): Promise<LocalFactList> {
  const missing = directoryStatus(scope, type)
  if (missing) return missing
  const entries = await readdir(baseDirOf(scope, type), { withFileTypes: true })
  const carriers = entries.filter((entry) => entry.isFile() && looksLikeFactCarrier(entry.name))
  const fileNames = carriers.filter((entry) => isExpectedCarrierName(type, entry.name)).map((entry) => entry.name).sort((left, right) => left.localeCompare(right))
  const issues = carriers.filter((entry) => !isExpectedCarrierName(type, entry.name)).map((entry) => ({
    code: 'unexpected_fact_carrier' as const,
    message: `${type} 正式载体必须是 ${type}-NNNN${FACT_TYPE_CARRIERS[type]}，已忽略错载体 ${entry.name}`,
    path: path.posix.join('ldvh-base', FACT_TYPE_DIRS[type], entry.name),
  }))
  return { status: 'complete', items: await Promise.all(fileNames.map((fileName) => readItemFile(scope, type, fileName))), issues }
}

const FACT_OBJECT_ID_PATTERN = /^(workcase|adr|pitfall|spark|study)-(?:\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$/

export async function readLocalFact(type: LocalFactType, objectId: string, scope: LocalFactScope): Promise<{ status: 'ok'; item: LocalFactItem } | { status: 'not_found' | 'type_not_integrated'; metadata: LocalFactMetadata; issues: LocalFactIssue[] }> {
  const metadata = metadataFor(scope, type, objectId)
  const missing = directoryStatus(scope, type)
  if (missing) return { status: 'type_not_integrated', metadata, issues: missing.issues }
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
