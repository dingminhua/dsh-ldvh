import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { LDVH_WORKSPACE_ROOT } from './pytools.js'
import { verifyWebGovernanceConfiguration } from './governanceScope.js'

export type GovernedProjectSetting = { id: string; path: string; name?: string }
type Configuration = { governance_instance_name: string; product_description: string; projects: Array<Record<string, unknown>>; default_project_id?: string }

const ROOT_FIELDS = new Set(['governance_instance_name', 'product_description', 'projects', 'default_project_id'])

function configPath(): string { return path.join(LDVH_WORKSPACE_ROOT, 'LDVH-GOVERNED-PROJECTS.yaml') }
function fingerprint(content: string): string { return createHash('sha256').update(content).digest('hex') }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }

function parse(content: string): Configuration {
  const value = yaml.load(content)
  if (!isRecord(value) || Object.keys(value).some((key) => !ROOT_FIELDS.has(key)) || typeof value.governance_instance_name !== 'string' || !value.governance_instance_name.trim() || typeof value.product_description !== 'string' || !value.product_description.trim() || !Array.isArray(value.projects) || (value.default_project_id !== undefined && typeof value.default_project_id !== 'string')) {
    throw new Error('管辖项目配置缺少必填根字段，无法在设置页修改')
  }
  return value as Configuration
}

function projectSettings(projects: Array<Record<string, unknown>>): GovernedProjectSetting[] {
  return projects.map((project) => ({
    id: typeof project.id === 'string' ? project.id : '',
    path: typeof project.path === 'string' ? project.path : '',
    ...(typeof project.name === 'string' && project.name ? { name: project.name } : {}),
  }))
}

function normalizeProjects(input: unknown): GovernedProjectSetting[] {
  if (!Array.isArray(input)) throw new Error('projects 必须是项目列表')
  return input.map((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.path !== 'string') {
      throw new Error(`第 ${index + 1} 个项目必须包含字符串 ID 和本地路径`)
    }
    if (value.name !== undefined && typeof value.name !== 'string') {
      throw new Error(`第 ${index + 1} 个项目的简称必须是字符串`)
    }
    return { id: value.id, path: value.path, ...(typeof value.name === 'string' ? { name: value.name } : {}) }
  })
}

function validateProjects(projects: GovernedProjectSetting[]): void {
  const ids = new Set<string>()
  for (const project of projects) {
    if (!project.id.trim() || !project.path.trim()) throw new Error('每个项目都必须有稳定 ID 和本地路径')
    if (ids.has(project.id)) throw new Error(`项目 ID 重复：${project.id}`)
    ids.add(project.id)
    if (project.name !== undefined && !project.name.trim()) throw new Error('简称不能是空白文本')
  }
}

function resolvedDefaultProjectId(config: Configuration, projects: GovernedProjectSetting[]): string {
  if (typeof config.default_project_id === 'string' && config.default_project_id) return config.default_project_id
  return projects[0]?.id ?? ''
}

function normalizeDefaultProjectId(input: unknown, projects: GovernedProjectSetting[], fallback: string): string {
  const value = input === undefined ? fallback : input
  if (typeof value !== 'string') throw new Error('默认项目必须是项目 ID')
  if (!projects.length) {
    if (value) throw new Error('没有管辖项目时不能设置默认项目')
    return ''
  }
  if (!value || !projects.some((project) => project.id === value)) throw new Error('默认项目必须引用当前登记的项目 ID')
  return value
}

function header(content: string): string {
  const match = /^(.*?)(?=^governance_instance_name:)/ms.exec(content)
  return match?.[1] ?? ''
}

export async function readGovernedProjectsSettings() {
  const filePath = configPath()
  let content: string
  try { content = await readFile(filePath, 'utf8') }
  catch (error) { throw new Error(`管辖项目配置不可读取：${error instanceof Error ? error.message : String(error)}`) }
  const config = parse(content)
  const projects = projectSettings(config.projects)
  return {
    workspaceRoot: LDVH_WORKSPACE_ROOT,
    configPath: filePath,
    fingerprint: fingerprint(content),
    defaultProjectId: resolvedDefaultProjectId(config, projects),
    hasExplicitDefault: typeof config.default_project_id === 'string',
    projects,
  }
}

export async function updateGovernedProjectsSettings(input: unknown, expectedFingerprint: string, requestedDefaultProjectId?: unknown) {
  const projects = normalizeProjects(input)
  validateProjects(projects)
  const filePath = configPath()
  const original = await readFile(filePath, 'utf8')
  if (fingerprint(original) !== expectedFingerprint) throw new Error('配置已被其它操作修改，请重新读取后再保存')
  const config = parse(original)
  const existingDefaultProjectId = resolvedDefaultProjectId(config, projectSettings(config.projects))
  const fallbackDefaultProjectId = projects.some((project) => project.id === existingDefaultProjectId)
    ? existingDefaultProjectId
    : (projects[0]?.id ?? '')
  const defaultProjectId = normalizeDefaultProjectId(requestedDefaultProjectId, projects, fallbackDefaultProjectId)
  const existing = new Map(config.projects.filter(isRecord).map((project) => [String(project.id), project]))
  config.projects = projects.map((project) => {
    const previous = existing.get(project.id)
    const next: Record<string, unknown> = {
      ...(previous ?? {}),
      id: project.id.trim(),
      path: project.path.trim(),
    }
    if (project.name?.trim()) next.name = project.name.trim()
    else delete next.name
    return next
  })
  if (defaultProjectId) config.default_project_id = defaultProjectId
  else delete config.default_project_id
  const next = `${header(original)}${yaml.dump(config, { lineWidth: 120, noRefs: true })}`
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, next, 'utf8')
  await rename(temporaryPath, filePath)
  try {
    await verifyWebGovernanceConfiguration()
  } catch (error) {
    await writeFile(temporaryPath, original, 'utf8')
    await rename(temporaryPath, filePath)
    throw error
  }
  return readGovernedProjectsSettings()
}
