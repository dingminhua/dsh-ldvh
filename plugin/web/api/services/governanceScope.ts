import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import yaml from 'js-yaml'
import path from 'node:path'
import { LDVH_ROOT } from './pytools.js'

export type WebGovernedProject = {
  id: string
  path: string
  gitCommonDir: string
}

type VerifiedScopeSnapshot = {
  configurationFingerprint: string
  current: WebGovernedProject
  projects: WebGovernedProject[]
}

let verifiedSnapshot: VerifiedScopeSnapshot | null = null
let verificationInFlight: Promise<VerifiedScopeSnapshot> | null = null

export class WebGovernanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebGovernanceError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function configuredLocator(): string {
  const raw = process.env.LDVH_WEB_WORKTREE_LOCATOR || LDVH_ROOT
  return path.resolve(raw)
}

/**
 * v5 登记模式：LDVH_GOVERNED_PROJECTS_CONFIG 指向 v5 登记载体
 * （~/.dsh/ldvh/governed-projects.yaml，由 DSH 插件安装事务拥有）。
 *
 * 治理验证不经 Python Helper——Node 直接解析载体并逐项目做 git 身份解析
 * （与插件 resolveGitRoot 同语义：路径须为 Git 根、非 bare）。
 *
 * v4 的 Helper 回退路径已随 v4 归档移除：载体路径不存在时如实报配置不可读，
 * 不静默回退到已下线的旧布局。
 */
function v5CarrierPath(): string | null {
  const configured = process.env.LDVH_GOVERNED_PROJECTS_CONFIG
  return configured ? path.resolve(configured) : null
}

function configurationPath(): string {
  const carrier = v5CarrierPath()
  if (carrier === null) {
    throw new WebGovernanceError('Governance configuration is unavailable: LDVH_GOVERNED_PROJECTS_CONFIG is not set')
  }
  return carrier
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'GIT_CONFIG_COUNT' || key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_')
      || ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'].includes(key)) delete env[key]
  }
  return env
}

function gitQuery(worktree: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', worktree, ...args], { env: gitEnvironment(), encoding: 'utf8', timeout: 10_000 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout).trim())
    })
  })
}

/** 单项目 git 身份解析；不可验证（非 Git 根/bare/不存在）返回 null——降级剔除。 */
async function resolveV5ProjectIdentity(projectPath: string): Promise<{ projectRoot: string, gitCommonDir: string } | null> {
  try {
    const requested = await realpath(projectPath)
    const top = await gitQuery(projectPath, ['rev-parse', '--show-toplevel'])
    const common = await gitQuery(projectPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    const canonicalRoot = await realpath(top)
    if (canonicalRoot !== requested) return null
    return { projectRoot: canonicalRoot, gitCommonDir: await realpath(common) }
  } catch {
    return null
  }
}

async function resolveV5CarrierScope(carrierPath: string, fingerprint: string): Promise<VerifiedScopeSnapshot> {
  let content: string
  try { content = await readFile(carrierPath, 'utf8') }
  catch (error) {
    throw new WebGovernanceError(`Governance configuration is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  let document: unknown
  try { document = yaml.load(content) }
  catch (error) {
    throw new WebGovernanceError(`Governance configuration is not valid: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(document) || !Array.isArray(document.projects)) {
    throw new WebGovernanceError('Governance configuration is not valid: v5 carrier must declare a projects list')
  }
  const defaultProjectId = typeof document.default_project_id === 'string' ? document.default_project_id : ''
  const verified: WebGovernedProject[] = []
  for (const entry of document.projects) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()
      || typeof entry.path !== 'string' || !entry.path.trim()) continue
    const identity = await resolveV5ProjectIdentity(entry.path)
    if (identity) verified.push({ id: entry.id, path: identity.projectRoot, gitCommonDir: identity.gitCommonDir })
  }
  if (verified.length === 0) {
    throw new WebGovernanceError('Governance resolution is not verified: no registered project has a verifiable Git worktree')
  }
  const locator = normalizedExistingPath(configuredLocator())
  const current = verified.find((project) => project.path === locator)
    ?? verified.find((project) => project.id === defaultProjectId)
    ?? verified[0]
  return { configurationFingerprint: fingerprint, current, projects: verified }
}

async function configurationFingerprint(): Promise<string> {
  const content = await readFile(configurationPath(), 'utf8')
  return createHash('sha256').update(content).digest('hex')
}

function normalizedExistingPath(value: string): string {
  const resolved = path.resolve(value)
  try { return realpathSync.native(resolved) } catch { return resolved }
}


async function refreshVerifiedScope(fingerprint: string): Promise<VerifiedScopeSnapshot> {
  const carrier = v5CarrierPath()
  if (carrier === null) {
    throw new WebGovernanceError('Governance configuration is unavailable: LDVH_GOVERNED_PROJECTS_CONFIG is not set')
  }
  return resolveV5CarrierScope(carrier, fingerprint)
}

/**
 * Reuse a verified configuration scope while its exact YAML content is unchanged.
 * The cheap fingerprint observation is not a Git validation; it prevents a changed
 * configuration from silently using a previous range snapshot.
 */
async function currentVerifiedScope(force = false): Promise<VerifiedScopeSnapshot> {
  let fingerprint: string
  try {
    fingerprint = await configurationFingerprint()
  } catch (error) {
    throw new WebGovernanceError(`Governance configuration is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!force && verifiedSnapshot?.configurationFingerprint === fingerprint) return verifiedSnapshot
  // A failed resolution must be tried again by the next request: only successful
  // observations are reusable.
  if (verificationInFlight) return verificationInFlight

  verifiedSnapshot = null
  verificationInFlight = refreshVerifiedScope(fingerprint)
    .then((snapshot) => {
      verifiedSnapshot = snapshot
      return snapshot
    })
    .catch((error: unknown) => {
      const normalized = error instanceof WebGovernanceError
        ? error
        : new WebGovernanceError(error instanceof Error ? error.message : String(error))
      throw normalized
    })
    .finally(() => { verificationInFlight = null })
  return verificationInFlight
}

/** Start the one-time validation and expose its completion to lifecycle owners. */
export function primeWebGovernanceScope(): Promise<void> {
  return currentVerifiedScope().then(() => undefined).catch(() => undefined)
}

/** Explicit Human-requested validation or controlled configuration write. */
export async function verifyWebGovernanceConfiguration(): Promise<void> {
  let fingerprint: string
  try {
    fingerprint = await configurationFingerprint()
  } catch (error) {
    throw new WebGovernanceError(`Governance configuration is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  verifiedSnapshot = null
  const carrier = v5CarrierPath()
  if (carrier === null) {
    throw new WebGovernanceError('Governance configuration is unavailable: LDVH_GOVERNED_PROJECTS_CONFIG is not set')
  }
  await resolveV5CarrierScope(carrier, fingerprint)
}

/** Resolve a current, single governed worktree through the v5 registration carrier. */
export async function resolveCurrentWebProject(): Promise<WebGovernedProject> {
  return (await currentVerifiedScope()).current
}

/** The only project discovery path available to Web file browsing. */
export async function resolveWebGovernedProjects(): Promise<WebGovernedProject[]> {
  return (await currentVerifiedScope()).projects
}
