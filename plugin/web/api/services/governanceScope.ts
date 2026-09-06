import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { LDVH_ROOT, LDVH_WORKSPACE_ROOT } from './pytools.js'

export type WebGovernedProject = {
  id: string
  path: string
  gitCommonDir: string
}

type GovernanceProjectIdentity = {
  project_id: string
  git_worktree_root: string
  git_common_dir: string
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

export function helperExecutable(): string {
  const defaultExecutable = path.join(LDVH_ROOT, 'ldvh')
  const configured = process.env.LDVH_HELPER_EXECUTABLE || defaultExecutable
  const candidate = path.resolve(configured)
  let resolved: string
  try {
    resolved = realpathSync.native(candidate)
    const metadata = statSync(resolved)
    if (!metadata.isFile()) throw new Error('not a regular file')
    if (process.platform !== 'win32' && (metadata.mode & constants.S_IXUSR) === 0) {
      throw new Error('not executable')
    }
  } catch (error) {
    throw new WebGovernanceError(`Configured Helper executable is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  return resolved
}

function helperInvocation(): { executable: string, prefix: string[] } {
  const launcher = helperExecutable()
  if (process.platform !== 'win32') return { executable: launcher, prefix: [] }
  const configuredPython = process.env.LDVH_HELPER_PYTHON
    || path.join(path.dirname(launcher), '.venv', 'Scripts', 'python.exe')
  const python = path.resolve(configuredPython)
  try {
    if (!statSync(realpathSync.native(python)).isFile()) throw new Error('not a regular file')
  } catch (error) {
    throw new WebGovernanceError(`Configured source Python is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { executable: python, prefix: [launcher] }
}

function configuredLocator(): string {
  const raw = process.env.LDVH_WEB_WORKTREE_LOCATOR || LDVH_ROOT
  return path.resolve(raw)
}

function configuredWorkspaceRoot(): string {
  // Use the shared workspace setting first, matching the Project Files and
  // Helper contract. The older Web-specific name remains only as fallback.
  const raw = process.env.LDVH_WORKSPACE_ROOT || process.env.LDVH_WEB_WORKSPACE_ROOT || LDVH_WORKSPACE_ROOT
  return path.resolve(raw)
}

function configurationPath(): string {
  return path.join(configuredWorkspaceRoot(), 'LDVH-GOVERNED-PROJECTS.yaml')
}

async function configurationFingerprint(): Promise<string> {
  const content = await readFile(configurationPath(), 'utf8')
  return createHash('sha256').update(content).digest('hex')
}

function normalizedExistingPath(value: string): string {
  const resolved = path.resolve(value)
  try { return realpathSync.native(resolved) } catch { return resolved }
}

function invokeGovernanceScope(locator: string, workspaceRoot: string): Promise<Record<string, unknown>> {
  const request = JSON.stringify({
    work_object_locators: [locator],
    arguments: { workspace_root: workspaceRoot },
    response_profile: 'compact',
  })
  return new Promise((resolve, reject) => {
    const invocation = helperInvocation()
    const child = execFile(
      invocation.executable,
      [...invocation.prefix, 'call', 'resolve-governance-scope'],
      { cwd: locator, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new WebGovernanceError(`Governance resolver unavailable: ${stderr.trim() || error.message}`))
          return
        }
        try {
          const parsed: unknown = JSON.parse(stdout)
          if (!isRecord(parsed)) throw new Error('response is not an object')
          resolve(parsed)
        } catch (parseError) {
          reject(new WebGovernanceError(`Governance resolver returned invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`))
        }
      },
    )
    // A helper that exits before consuming stdin must reject the invocation
    // rather than surface an uncaught stream EPIPE after its caller finished.
    child.stdin?.on('error', (error) => {
      reject(new WebGovernanceError(`Governance resolver unavailable: ${error instanceof Error ? error.message : String(error)}`))
    })
    child.stdin?.end(request)
  })
}

function verifiedResolution(response: Record<string, unknown>, expectedLocator: string): Record<string, unknown> {
  if (response.outcome !== 'ok' || !isRecord(response.result)) {
    throw new WebGovernanceError(`Governance resolution did not complete: ${String(response.outcome || 'unknown')}`)
  }
  const result = response.result
  if (result.config_status !== 'valid' || result.scope_status !== 'governed_single') {
    throw new WebGovernanceError(`Governance resolution is not verified: config=${String(result.config_status)} scope=${String(result.scope_status)}`)
  }
  if (!Array.isArray(result.object_resolutions) || result.object_resolutions.length !== 1) {
    throw new WebGovernanceError('Governance resolution must contain exactly one requested worktree')
  }
  const resolution = result.object_resolutions[0]
  if (!isRecord(resolution)
    || resolution.status !== 'governed'
    || typeof resolution.governed_project_id !== 'string'
    || !resolution.governed_project_id
    || typeof resolution.git_worktree_root !== 'string'
    || !path.isAbsolute(resolution.git_worktree_root)
    || typeof resolution.git_common_dir !== 'string'
    || !path.isAbsolute(resolution.git_common_dir)) {
    throw new WebGovernanceError('Governance resolution did not verify the requested worktree identity')
  }
  const worktree = normalizedExistingPath(resolution.git_worktree_root)
  const relative = path.relative(worktree, normalizedExistingPath(expectedLocator))
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WebGovernanceError('Resolved locator is outside the verified Git worktree')
  }
  return resolution
}

function projectsFromResolution(current: Record<string, unknown>): WebGovernedProject[] {
  const identities = new Map<string, GovernanceProjectIdentity>()
  if (Array.isArray(current.identity_evidence)) {
    for (const evidence of current.identity_evidence) {
      if (!isRecord(evidence) || evidence.kind !== 'registered_project_git_identity' || !isRecord(evidence.details)) continue
      const details = evidence.details
      if (details.status !== 'git_worktree'
        || typeof details.project_id !== 'string'
        || typeof details.git_worktree_root !== 'string'
        || typeof details.git_common_dir !== 'string'
        || !path.isAbsolute(details.git_worktree_root)
        || !path.isAbsolute(details.git_common_dir)) continue
      identities.set(details.project_id, {
        project_id: details.project_id,
        git_worktree_root: details.git_worktree_root,
        git_common_dir: details.git_common_dir,
      })
    }
  }
  identities.set(String(current.governed_project_id), {
    project_id: String(current.governed_project_id),
    git_worktree_root: String(current.git_worktree_root),
    git_common_dir: String(current.git_common_dir),
  })
  return [...identities.values()]
    .sort((left, right) => left.project_id.localeCompare(right.project_id))
    .map((identity) => ({
      id: identity.project_id,
      path: path.resolve(identity.git_worktree_root),
      gitCommonDir: path.resolve(identity.git_common_dir),
    }))
}

async function refreshVerifiedScope(fingerprint: string): Promise<VerifiedScopeSnapshot> {
  const locator = configuredLocator()
  const resolution = verifiedResolution(await invokeGovernanceScope(locator, configuredWorkspaceRoot()), locator)
  return {
    configurationFingerprint: fingerprint,
    current: {
      id: String(resolution.governed_project_id),
      path: path.resolve(String(resolution.git_worktree_root)),
      gitCommonDir: path.resolve(String(resolution.git_common_dir)),
    },
    projects: projectsFromResolution(resolution),
  }
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
  // Helper availability can recover without a configuration-file change (for
  // example during a local code reload), so only successful observations are
  // reusable. A failed resolution must be tried again by the next request.
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
  const response = await invokeGovernanceScope(configuredWorkspaceRoot(), configuredWorkspaceRoot())
  if (response.outcome !== 'ok' || !isRecord(response.result) || response.result.config_status !== 'valid') {
    const result = isRecord(response.result) ? response.result : {}
    throw new WebGovernanceError(`Governance configuration is not valid: ${String(result.config_status ?? response.outcome ?? 'unknown')}`)
  }
}

/** The sole Web→Helper boundary: resolve a current, single governed worktree. */
export async function resolveCurrentWebProject(): Promise<WebGovernedProject> {
  return (await currentVerifiedScope()).current
}

/** The only project discovery path available to Web file browsing. */
export async function resolveWebGovernedProjects(): Promise<WebGovernedProject[]> {
  return (await currentVerifiedScope()).projects
}
