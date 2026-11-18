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
