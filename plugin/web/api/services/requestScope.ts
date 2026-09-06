/**
 * Resolve the governed project a request is scoped to.
 *
 * The selected project id travels as the `projectId` query parameter (the same
 * convention as the project-files routes). It is NEVER trusted as a path: it is
 * matched against the verified governed-projects allow-list via getProject().
 * An unknown id is rejected, so a caller cannot inject an arbitrary worktree
 * locator or git cwd. When the parameter is absent we fall back to the server's
 * current governed project, preserving the pre-existing single-project behaviour.
 */
import type { Request } from 'express'
import { getProject } from './projectFiles.js'
import { resolveCurrentWebProject } from './governanceScope.js'
import { resolveGovernedProjectWorktree } from './workspaceWorktrees.js'
import type { LocalFactScope } from './localFactReader.js'

export type RequestProject = { id: string; path: string }

export class ProjectScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectScopeError'
  }
}

function projectIdFromRequest(req: Request): string | undefined {
  const raw = req.query.projectId
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value || undefined
}

function worktreePathFromRequest(req: Request): string | undefined {
  const raw = req.query.worktreePath
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value || undefined
}

export async function requestProject(req: Request): Promise<RequestProject> {
  const id = projectIdFromRequest(req)
  if (id) {
    const project = await getProject(id)
    if (!project) throw new ProjectScopeError(`Unknown governed project: ${id}`)
    const requestedWorktree = worktreePathFromRequest(req)
    if (!requestedWorktree) return { id: project.id, path: project.path }
    const verifiedWorktree = await resolveGovernedProjectWorktree(project, requestedWorktree)
    if (!verifiedWorktree) throw new ProjectScopeError(`Unknown worktree for governed project ${id}`)
    return { id: project.id, path: verifiedWorktree }
  }
  const current = await resolveCurrentWebProject()
  return { id: current.id, path: current.path }
}

export async function requestFactScope(req: Request): Promise<LocalFactScope> {
  const project = await requestProject(req)
  return { worktreeLocator: project.path, governedProjectId: project.id }
}
