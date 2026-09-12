/**
 * 全部管辖联邦聚合（全部管辖计划 Step 3）。
 *
 * GET /api/federation/overview —— 跨管辖项目的只读汇总：
 * - 项目卡：每项目的悬置 Spark（open/P1）、进行中 WorkCase、待决定事项计数与最后动态时间；
 * - 跨项目悬置：全部项目 open Spark 按优先级与陈旧度取 Top N；
 * - 逐项目降级：单个项目读取失败时该卡如实带 issues，不影响其它项目（认知中心模块级降级同型）。
 *
 * 数据边界：全部经 Web 字段级直读（facts.ts listObjects 的显式 scope），无第二事实源；
 * 颜色为呈现偏好（governedProjectsSettings 合并后的 color，未显式选择时由前端按 ID 哈希兜底）。
 */
import { Router, type Request, type Response } from 'express'
import { listObjects } from '../services/facts.js'
import { readGovernedProjectsSettings } from '../services/governedProjectsSettings.js'

const router = Router()

/** 联邦项目卡数据。issues 非空时计数字段可能缺失，卡片如实呈现降级。 */
export interface FederationProjectCard {
  id: string
  name: string
  path: string
  color?: string
  isDefault: boolean
  sparkOpen?: number
  activeWorkCases?: number
  pendingDecisions?: number
  lastActivityAt?: string
  issues: string[]
}

export interface FederationCrossSpark {
  projectId: string
  projectName: string
  color?: string
  objectId: string
  title: string
  updatedAt?: string
}

const PENDING_WORKCASE_PHASES = new Set(['human_plan_confirming', 'human_closure_confirming'])
const CROSS_SPARK_LIMIT = 8

function itemsOf(result: unknown): { items: Array<Record<string, unknown>>; error?: string } {
  if (result && typeof result === 'object' && 'ok' in result && (result as { ok: boolean }).ok && 'data' in result) {
    const data = (result as { data: { items?: unknown } }).data
    if (Array.isArray(data.items)) return { items: data.items as Array<Record<string, unknown>> }
  }
  const error = result && typeof result === 'object' && 'error' in result
    ? String((result as { error: unknown }).error)
    : '列表读取失败'
  return { items: [], error }
}

function latestChangeLogAt(items: Array<Record<string, unknown>>): string | undefined {
  let latest: string | undefined
  for (const item of items) {
    const log = item.change_log
    if (!Array.isArray(log)) continue
    for (let index = log.length - 1; index >= 0; index -= 1) {
      const entry = log[index]
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const at = (entry as Record<string, unknown>).at
      if (typeof at === 'string' && at.length > 0 && (!latest || at > latest)) { latest = at; break }
    }
  }
  return latest
}

router.get('/objects', async (req: Request, res: Response): Promise<void> => {
  const type = String(req.query.type ?? '')
  const OBJECT_TYPES = ['workcase', 'adr', 'pitfall', 'spark', 'research', 'friction', 'norm'] as const
  if (!(OBJECT_TYPES as readonly string[]).includes(type)) {
    res.status(400).json({ ok: false, error: `Unsupported object type: ${type || '(missing)'}` })
    return
  }
  const objectType = type as typeof OBJECT_TYPES[number]
  try {
    const settings = await readGovernedProjectsSettings()
    const issues: string[] = []
    const projectOptions = settings.projects.map((project) => ({
      id: project.id,
      name: project.name || project.id,
      ...(project.color ? { color: project.color } : {}),
    }))
    const items = (await Promise.all(settings.projects.map(async (project) => {
      const scope = { worktreeLocator: project.path, governedProjectId: project.id }
      const result = await listObjects(objectType, undefined, undefined, scope)
      const listing = itemsOf(result)
      if (listing.error) issues.push(`${project.name || project.id}: ${listing.error}`)
      return listing.items.map((item): Record<string, unknown> => ({
        ...item,
        federationProject: {
          id: project.id,
          name: project.name || project.id,
          ...(project.color ? { color: project.color } : {}),
        },
      }))
    }))).flat()
    items.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
    res.json({ ok: true, type: objectType, generatedAt: new Date().toISOString(), projects: projectOptions, items, issues })
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

router.get('/overview', async (_req: Request, res: Response): Promise<void> => {
  const generatedAt = new Date().toISOString()
  try {
    const settings = await readGovernedProjectsSettings()
    // 每项目聚合时顺带保留 open Spark 明细，供跨项目 Top N 使用（不重复读取）。
    const openSparksByProject = new Map<string, Array<Record<string, unknown>>>()
    const cards = await Promise.all(settings.projects.map(async (project): Promise<FederationProjectCard> => {
      const card: FederationProjectCard = {
        id: project.id,
        name: project.name || project.id,
        path: project.path,
        ...(project.color ? { color: project.color } : {}),
        isDefault: project.id === settings.defaultProjectId,
        issues: [],
      }
      const scope = { worktreeLocator: project.path, governedProjectId: project.id }
      const [sparkResult, workCaseResult, pitfallResult] = await Promise.all([
        listObjects('spark', undefined, undefined, scope),
        listObjects('workcase', undefined, undefined, scope),
        listObjects('pitfall', undefined, undefined, scope),
      ])
      const sparks = itemsOf(sparkResult)
      const workCases = itemsOf(workCaseResult)
      const pitfalls = itemsOf(pitfallResult)
      for (const [kind, listing] of [['spark', sparks], ['workcase', workCases], ['pitfall', pitfalls]] as const) {
        if (listing.error) card.issues.push(`${kind}: ${listing.error}`)
      }
      let openSparks: Array<Record<string, unknown>> = []
      if (!sparks.error) {
        // 20 §8/§14.2：v5 Spark 无 priority 字段——联邦卡只投影 open 计数。
        openSparks = sparks.items.filter((item) => item.status === 'open')
        card.sparkOpen = openSparks.length
      }
      if (openSparks.length > 0) openSparksByProject.set(project.id, openSparks)
      if (!workCases.error) {
        card.activeWorkCases = workCases.items.filter((item) => item.status === 'open' || item.status === 'blocked').length
        card.pendingDecisions = workCases.items.filter((item) => typeof item.phase === 'string' && PENDING_WORKCASE_PHASES.has(item.phase)).length
      }
      if (!pitfalls.error) {
        card.pendingDecisions = (card.pendingDecisions ?? 0)
          + pitfalls.items.filter((item) => item.status === 'draft').length
      }
      const lastActivityAt = latestChangeLogAt([...sparks.items, ...workCases.items, ...pitfalls.items])
      if (lastActivityAt) card.lastActivityAt = lastActivityAt
      return card
    }))

    const crossProjectSparks: FederationCrossSpark[] = cards
      .flatMap((card) => (openSparksByProject.get(card.id) ?? []).map((item) => ({
        projectId: card.id,
        projectName: card.name,
        ...(card.color ? { color: card.color } : {}),
        objectId: String(item.object_id ?? item.id ?? ''),
        title: String(item.title ?? ''),
        updatedAt: typeof item.updated_at === 'string' ? item.updated_at : undefined,
      })))
      .sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''))
      .slice(0, CROSS_SPARK_LIMIT)

    res.json({ ok: true, generatedAt, defaultProjectId: settings.defaultProjectId, projects: cards, crossProjectSparks })
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

export default router
