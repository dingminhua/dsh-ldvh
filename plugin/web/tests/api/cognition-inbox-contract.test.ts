/**
 * 项目认知中心：GET /api/cognition 收件箱与近期动态契约测试。
 *
 * 以当前治理范围解析出的受管辖工作树（事实源）运行，断言 02 §8 当前已交付字段
 * （generatedAt / scope / inbox / activeWorkCases / recentActivity / sparkHealth / recentHotspots / issues）、待决与推进中收录及排序、命名纪律
 * （WorkCase 的两个 Human-position progress_group、blocked_resolution，加上 Pitfall 的 draft 待确认）、
 * 内联对象卡片依据、条件 canonical_path，以及近期动态的窗口与时间标记。
 *
 * 断言以“不依赖具体对象身份的不变式”为主：无论事实源是本仓库还是预览工作树，
 * 收录 / 排序 / 命名 / 投影规则都必须确定性成立。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { projectRecentHotspotFact, type RecentHotspotBuildItem } from '../../api/routes/cognition.ts'
import { compareTimestamps } from '../../api/services/time.ts'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')

let server: Server
let baseUrl = ''

before(async () => {
  const { default: app } = await import('../../api/app.ts')
  server = app.listen(0)
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

async function cognition(locale = 'zh', window = '1d', projectId?: string) {
  const projectQuery = projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''
  const response = await fetch(`${baseUrl}/api/cognition?locale=${locale}&window=${window}${projectQuery}`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  return (await response.json()) as Record<string, unknown>
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/

function priorityRank(priority: unknown): number {
  if (typeof priority !== 'string') return 4
  const match = /^P([0-3])$/.exec(priority)
  return match ? Number(match[1]) : 4
}

/** 复制路由排序规则，用于校验收件箱顺序的确定性。 */
function compareSort(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const ra = priorityRank(a.priority)
  const rb = priorityRank(b.priority)
  if (ra !== rb) return ra - rb
  const ua = typeof a.updatedAt === 'string' ? a.updatedAt : ''
  const ub = typeof b.updatedAt === 'string' ? b.updatedAt : ''
  const ha = ua !== ''
  const hb = ub !== ''
  if (ha && hb) {
    const timeDelta = compareTimestamps(ua, ub)
    if (timeDelta !== 0) return timeDelta
    return String(a.id).localeCompare(String(b.id))
  }
  if (ha && !hb) return -1
  if (!ha && hb) return 1
  return String(a.id).localeCompare(String(b.id))
}

/** WorkCase 模块归属来自 progress_group；blocked Human-position 改用非 Gate 呈现。 */
function expectedInboxKind(item: Record<string, unknown>): string | null {
  if (item.isBlocked === true) return 'blocked_resolution'
  const pg = item.progress_group
  if (pg === 'plan_confirmation') return 'plan_confirmation'
  if (pg === 'closure_confirmation') return 'closure_confirmation'
  return null
}

test('recent activity rows display localized type labels while preserving full ids for actions', () => {
  const source = readFileSync(path.resolve(repositoryRoot, 'src/pages/CognitionCenter.tsx'), 'utf8')
  const recentActivityRow = source.slice(source.indexOf('function RecentActivityRow'), source.indexOf('function RecentActivityUsageBars'))
  assert.match(recentActivityRow, /getTypeLabel\(item\.type, locale\)/)
  assert.match(recentActivityRow, /const typeColor = CATEGORY_COLORS\[item\.type\] \|\| CATEGORY_COLORS\.other/)
  assert.match(recentActivityRow, /style=\{\{ backgroundColor: `\$\{typeColor\}18`, borderColor: `\$\{typeColor\}55`, color: typeColor \}\}/)
  assert.match(recentActivityRow, /<StatusBadge status=\{status\}[\s\S]*size="xs" variant="compact" \/>/)
  assert.match(source, /\(item\.object_uid !== undefined \? \{ object_uid: item\.object_uid \} : \{\}\)/)
  assert.match(source, /openPanel\(\{ type: 'object', title, objectType: item\.type, objectId: item\.id \}\)/)
  assert.match(source, /<ObjectReferenceCopyButton projectId=\{selectedProjectId\} objectId=\{item\.id\} \/>/)
  const detailSource = readFileSync(path.resolve(repositoryRoot, 'src/pages/ObjectDetail.tsx'), 'utf8')
  assert.match(detailSource, /projectId=\{selectedProjectId\}/)
})

test('all five AI module summaries use human-readable type and title without machine locators', () => {
  const source = readFileSync(path.resolve(repositoryRoot, 'src/pages/CognitionCenter.tsx'), 'utf8')
  assert.match(source, /return `\$\{getTypeLabel\(type, locale\)\}《\$\{title\}》`/)

  const summaryNames = [
    'buildModuleSummary',
    'buildRecentActivitySummary',
    'buildActiveWorkCaseSummary',
    'buildSparkHealthSummary',
    'buildRecentHotspotSummary',
  ]
  for (const [index, name] of summaryNames.entries()) {
    const start = source.indexOf(`function ${name}`)
    const nextName = summaryNames[index + 1]
    const end = nextName ? source.indexOf(`function ${nextName}`, start) : source.indexOf('/** 读取问题', start)
    const body = source.slice(start, end)
    assert.ok(start >= 0 && end > start, `${name} must remain independently inspectable`)
    assert.match(body, /formatHumanObjectReference\(/, `${name} must use 类型《当前 Title》`)
    assert.doesNotMatch(body, /formatObjectReference|projectId|@\$\{/, `${name} must not expose a machine locator`)
  }
})

test('cognition endpoint returns inbox, fact activity, Spark health, and fact hotspot contract shapes with observation time', async () => {
  const body = await cognition('zh')

  assert.match(String(body.generatedAt), RFC3339)
  assert.ok(body.scope && typeof body.scope === 'object')
  assert.equal(typeof (body.scope as Record<string, unknown>).governedProjectId, 'string')
  assert.ok(((body.scope as Record<string, unknown>).governedProjectId as string).length > 0)
  assert.ok(body.inbox && typeof body.inbox === 'object')
  const inbox = body.inbox as Record<string, unknown>
  assert.ok(Array.isArray(inbox.items))
  assert.equal(typeof inbox.total, 'number')
  assert.ok(body.activeWorkCases && typeof body.activeWorkCases === 'object')
  const activeWorkCases = body.activeWorkCases as Record<string, unknown>
  assert.ok(Array.isArray(activeWorkCases.items))
  assert.equal(activeWorkCases.total, (activeWorkCases.items as unknown[]).length)
  assert.ok(body.recentActivity && typeof body.recentActivity === 'object')
  const recent = body.recentActivity as Record<string, unknown>
  assert.equal(recent.window, '1d')
  assert.match(String(recent.windowStart), RFC3339)
  assert.ok(Array.isArray(recent.items))
  assert.equal(recent.total, (recent.items as unknown[]).length)
  assert.equal(typeof recent.eventTotal, 'number')
  assert.ok(Number(recent.eventTotal) >= Number(recent.total))
  assert.ok(Array.isArray(recent.modelUsage))
  assert.ok(Array.isArray(recent.environmentUsage))
  assert.ok(body.sparkHealth && typeof body.sparkHealth === 'object')
  const sparkHealth = body.sparkHealth as Record<string, unknown>
  for (const key of ['total', 'openTotal', 'terminalTotal', 'silentThresholdDays', 'silentCount']) {
    assert.equal(typeof sparkHealth[key], 'number')
  }
  assert.ok(sparkHealth.terminalByStatus && typeof sparkHealth.terminalByStatus === 'object')
  assert.ok(sparkHealth.openByPriority && typeof sparkHealth.openByPriority === 'object')
  assert.ok(Array.isArray(sparkHealth.openItems))
  assert.ok(Array.isArray(sparkHealth.silentItems))
  assert.ok(body.recentHotspots && typeof body.recentHotspots === 'object')
  const hotspots = body.recentHotspots as Record<string, unknown>
  assert.equal(hotspots.window, '7d')
  for (const key of ['totalEvents', 'hotspotTotal', 'relationTotal']) {
    assert.equal(typeof hotspots[key], 'number')
  }
  assert.ok(Array.isArray(hotspots.clusters))
  assert.equal('independentHotspots' in hotspots, false)
  // 其余尚未建设的模块仍整体省略。
  for (const moduleKey of ['whileAway', 'timeline', 'direction']) {
    assert.equal(moduleKey in body, false, `not-yet-built module must omit ${moduleKey}`)
  }
})

test('recent hotspots preserve only fact activity and one-hop formal relation shape', async () => {
  const body = await cognition('zh', '1d')
  const hotspots = body.recentHotspots as Record<string, unknown>
  assert.equal(hotspots.window, '7d')
  const clusters = hotspots.clusters as Array<Record<string, unknown>>
  const primaryKeys = new Set<string>()
  const assertNode = (node: Record<string, unknown>) => {
    assert.ok(['workcase', 'adr', 'pitfall', 'spark', 'study'].includes(String(node.type)))
    assert.match(String(node.id), /^(workcase|adr|pitfall|spark|study)-(?:\d{4,}|[0-7][0-9A-HJKMNP-TV-Z]{25})$/)
    assert.equal(typeof node.title, 'string')
    assert.equal(typeof node.typeColor, 'string')
    assert.ok(Array.isArray(node.activityRefs))
    const refs = node.activityRefs as Array<Record<string, unknown>>
    for (const ref of refs) {
      assert.match(String(ref.occurred_at), RFC3339)
      assert.ok(['created', 'updated'].includes(String(ref.activity)))
    }
  }

  const uniqueRelations = new Set<string>()
  let previousPrimaryActivityTotal = Number.POSITIVE_INFINITY
  for (const cluster of clusters) {
    assert.ok(cluster.primary && typeof cluster.primary === 'object')
    const primary = cluster.primary as Record<string, unknown>
    assertNode(primary)
    const primaryKey = `${primary.type}:${primary.id}`
    assert.equal(primaryKeys.has(primaryKey), false, `duplicate primary hotspot: ${primaryKey}`)
    primaryKeys.add(primaryKey)
    const primaryActivityTotal = (primary.activityRefs as unknown[]).length
    assert.ok(primaryActivityTotal > 0, 'each cluster must have exactly one fact-activity primary hotspot')
    assert.ok(primaryActivityTotal <= previousPrimaryActivityTotal, 'clusters must be ordered by fact activity')
    previousPrimaryActivityTotal = primaryActivityTotal
    assert.ok(Array.isArray(cluster.relations))
    assert.ok((cluster.relations as unknown[]).length > 0)
    for (const relation of cluster.relations as Array<Record<string, unknown>>) {
      assert.ok(relation.direction === 'outgoing' || relation.direction === 'incoming')
      assert.equal(typeof relation.relationKey, 'string')
      assert.ok(String(relation.relationKey).length > 0)
      assert.ok(relation.node && typeof relation.node === 'object')
      const node = relation.node as Record<string, unknown>
      assertNode(node)
      const nodeKey = `${node.type}:${node.id}`
      assert.notEqual(primaryKey, nodeKey)
      const source = relation.direction === 'outgoing' ? primaryKey : nodeKey
      const target = relation.direction === 'outgoing' ? nodeKey : primaryKey
      uniqueRelations.add(`${source}\u0000${target}\u0000${relation.relationKey}`)
    }
  }
  assert.equal(primaryKeys.size, hotspots.hotspotTotal)
  assert.equal(uniqueRelations.size, hotspots.relationTotal)
})

test('recent hotspot builder does not absorb transitive peers and rejects invalid relation semantics', async () => {
  const { buildRecentHotspots } = await import('../../api/routes/cognition.ts')
  const target = (fact_type_key: string, object_id: string) => ({ governed_project_id: 'demo', fact_type_key, object_id })
  const fact = (
    type: RecentHotspotBuildItem['type'],
    object_id: string,
    status: string,
    relations: unknown = undefined,
  ): RecentHotspotBuildItem => ({
    type,
    object_id,
    title: object_id,
    status,
    ...(type === 'workcase' ? { progress_group: status === 'closed' ? 'closed' : 'progressing' } : {}),
    read_status: 'readable',
    relations,
  })
  const facts: RecentHotspotBuildItem[] = [
    fact('spark', 'spark-0001', 'open', [
      { relation_key: 'related-to', target: target('spark', 'spark-0002') },
    ]),
    fact('spark', 'spark-0002', 'open', [
      { relation_key: 'related-to', target: target('spark', 'spark-0003') },
    ]),
    fact('spark', 'spark-0003', 'open'),
    fact('study', 'study-0001', 'active', [
      { relation_key: 'informs', target: target('spark', 'spark-0001') },
    ]),
    fact('workcase', 'workcase-0001', 'open', [
      { relation_key: 'contributed-to', target: target('workcase', 'workcase-0002') },
    ]),
    fact('workcase', 'workcase-0002', 'open'),
  ]
  const activityByFact = new Map([
    ['spark:spark-0001', [{ occurred_at: '2026-08-01T00:00:00Z', activity: 'updated' as const }]],
  ])
  const result = buildRecentHotspots(facts, activityByFact, 'demo')
  assert.equal(result.hotspotTotal, 1)
  assert.equal(result.relationTotal, 2)
  assert.equal(result.clusters.length, 1)
  assert.equal(result.clusters[0].primary.id, 'spark-0001')
  assert.deepEqual(
    result.clusters[0].relations.map((relation) => `${relation.direction}:${relation.relationKey}:${relation.node.id}`),
    ['outgoing:related-to:spark-0002', 'incoming:informs:study-0001'],
  )
  assert.equal(result.clusters[0].relations.some((relation) => relation.node.id === 'spark-0003'), false)
  assert.equal(result.clusters[0].relations.some((relation) => relation.node.id === 'workcase-0002'), false)
})

test('recent hotspots use UID identity, preserve UID activity, and reject mixed targets', async () => {
  const { buildRecentHotspots } = await import('../../api/routes/cognition.ts')
  const firstUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abc'
  const secondUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abd'
  const facts: RecentHotspotBuildItem[] = [
    {
      type: 'spark', object_id: 'spark-0001', object_uid: firstUid,
      title: 'First UID object', status: 'open', read_status: 'readable',
      relations: [
        { relation_key: 'related-to', target: { object_uid: secondUid } },
        {
          relation_key: 'informs',
          target: { object_uid: secondUid, governed_project_id: 'demo', fact_type_key: 'spark', object_id: 'spark-0001' },
        },
      ],
    },
    {
      type: 'spark', object_id: 'spark-0001', object_uid: secondUid,
      title: 'Second UID object', status: 'open', read_status: 'readable', relations: [],
    },
  ]
  const uidActivity = new Map([
    [`uid:${firstUid}`, [{ occurred_at: '2026-08-01T00:00:00Z', activity: 'updated' as const }]],
  ])

  const result = buildRecentHotspots(facts, uidActivity, 'demo')
  assert.equal(result.hotspotTotal, 1)
  assert.equal(result.relationTotal, 1)
  assert.equal(result.clusters[0].primary.object_uid, firstUid)
  assert.equal(result.clusters[0].primary.activityRefs.length, 1)
  assert.equal(result.clusters[0].relations[0].node.object_uid, secondUid)

  const ambiguousLegacyActivity = new Map([
    ['spark:spark-0001', [{ occurred_at: '2026-08-01T00:00:00Z', activity: 'updated' as const }]],
  ])
  assert.equal(buildRecentHotspots(facts, ambiguousLegacyActivity, 'demo').hotspotTotal, 0)
})

test('recent hotspots do not project a legacy Spark routed-to edge as a current responsibility', async () => {
  const { buildRecentHotspots } = await import('../../api/routes/cognition.ts')
  const target = (fact_type_key: string, object_id: string) => ({ governed_project_id: 'demo', fact_type_key, object_id })
  const facts: RecentHotspotBuildItem[] = [
    {
      type: 'spark',
      object_id: 'spark-0101',
      title: '源议题',
      status: 'routed',
      read_status: 'readable',
      relations: [{ relation_key: 'routed-to', target: target('spark', 'spark-0102') }],
    },
    {
      type: 'spark',
      object_id: 'spark-0102',
      title: '残余议题',
      status: 'open',
      read_status: 'readable',
      relations: [],
    },
  ]
  const activityByFact = new Map([
    ['spark:spark-0101', [{ occurred_at: '2026-08-01T00:00:00Z', activity: 'updated' as const }]],
  ])

  const result = buildRecentHotspots(facts, activityByFact, 'demo')
  assert.equal(result.relationTotal, 0)
  assert.equal(result.clusters.length, 0)
})

test('recent hotspot projection preserves full UID identity for readable nodes', () => {
  const item = {
    object_ref: { governed_project_id: 'demo', fact_type_key: 'spark', object_id: 'spark-0103' },
    canonical_path: 'ldvh-base/sparks/spark-0103.yaml',
    absolute_path: '/tmp/spark-0103.yaml',
    carrier: 'yaml' as const,
    read_status: 'readable' as const,
    source_content_fingerprint: null,
    fact_object: {
      object_id: 'spark-0103',
      object_uid: '019ffb52-ebb5-7812-9630-8e7aad44da3d',
      title: '可读热点',
      status: 'open',
      relations: [],
    },
    field_issues: [],
    unparsed_structures: [],
    issues: [],
  }
  assert.deepEqual(
    projectRecentHotspotFact(item, 'spark'),
    {
      type: 'spark',
      object_id: 'spark-0103',
      object_uid: '019ffb52-ebb5-7812-9630-8e7aad44da3d',
      title: '可读热点',
      status: 'open',
      read_status: 'readable',
      relations: [],
    },
  )
})

test('recent hotspot projection omits facts without a readable title instead of falling back to objectId', () => {
  const item = {
    object_ref: { governed_project_id: 'demo', fact_type_key: 'spark', object_id: 'spark-0103' },
    canonical_path: 'ldvh-base/sparks/spark-0103.yaml',
    absolute_path: '/tmp/spark-0103.yaml',
    carrier: 'yaml' as const,
    read_status: 'readable' as const,
    source_content_fingerprint: null,
    fact_object: { object_id: 'spark-0103', status: 'open' },
    field_issues: [],
    unparsed_structures: [],
    issues: [],
  }
  assert.equal(projectRecentHotspotFact(item, 'spark'), null)
  assert.equal(
    projectRecentHotspotFact({ ...item, fact_object: { ...item.fact_object, title: '  ' } }, 'spark'),
    null,
  )
})

test('Spark health splits the current pool into terminal and open items, with silent items as a thresholded subset', async () => {
  const body = await cognition('zh')
  const health = body.sparkHealth as Record<string, unknown>
  const terminalByStatus = health.terminalByStatus as Record<string, unknown>
  const terminalTotal = Number(terminalByStatus.implemented) + Number(terminalByStatus.discarded)

  assert.equal(Number(health.total), Number(health.openTotal) + terminalTotal)
  assert.equal(Number(health.terminalTotal), terminalTotal)
  assert.ok(Number(health.silentThresholdDays) > 0)
  const openItems = health.openItems as Array<Record<string, unknown>>
  assert.ok(openItems.length <= Number(health.openTotal))
  for (let index = 0; index < openItems.length; index += 1) {
    const item = openItems[index]
    assert.equal(item.type, 'spark')
    assert.equal(typeof item.id, 'string')
    assert.ok(Number(item.activityCount) >= 0)
    assert.ok(Number(item.silentDays) >= 0)
    assert.equal(typeof item.updatedAt, 'string')
    if (index > 0) assert.ok(Number(openItems[index - 1].silentDays) >= Number(item.silentDays))
  }
  const silentItems = health.silentItems as Array<Record<string, unknown>>
  assert.equal(Number(health.silentCount), silentItems.length)
  for (let index = 0; index < silentItems.length; index += 1) {
    const item = silentItems[index]
    assert.equal(item.type, 'spark')
    assert.equal(typeof item.id, 'string')
    assert.ok(Number(item.activityCount) >= 0)
    assert.ok(Number(item.silentDays) >= Number(health.silentThresholdDays))
    assert.ok(openItems.some((openItem) => openItem.id === item.id))
    assert.equal(typeof item.updatedAt, 'string')
    if (index > 0) assert.ok(Number(silentItems[index - 1].silentDays) >= Number(item.silentDays))
  }
})

test('recent activity accepts only explicit windows and groups fact change-log events by stable object', async () => {
  for (const window of ['1d', '3d', '7d']) {
    const body = await cognition('zh', window)
    const recent = body.recentActivity as Record<string, unknown>
    assert.equal(recent.window, window)
    const items = recent.items as Array<Record<string, unknown>>
    const expected = items.slice().sort((a, b) => {
      const at = String(a.occurredAt)
      const bt = String(b.occurredAt)
      const timeDelta = compareTimestamps(bt, at)
      if (timeDelta !== 0) return timeDelta
      if (a.activity !== b.activity) return a.activity === 'updated' ? -1 : 1
      return `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)
    })
    assert.deepEqual(items.map((item) => `${item.activity}:${item.type}:${item.id}:${item.occurredAt}`), expected.map((item) => `${item.activity}:${item.type}:${item.id}:${item.occurredAt}`))
    assert.equal(new Set(items.map((item) => `${item.type}:${item.id}`)).size, items.length)
    assert.equal(Number(recent.total), items.length)
    assert.ok(Number(recent.eventTotal) >= items.length)
    for (const item of items) {
      assert.ok(['workcase', 'adr', 'pitfall', 'spark', 'study'].includes(String(item.type)))
      assert.ok(['created', 'updated'].includes(String(item.activity)))
      assert.match(String(item.occurredAt), RFC3339)
      if (item.signature !== undefined) {
        const signature = item.signature as Record<string, unknown>
        const presentValues = [signature.productName, signature.modelName]
          .filter((value) => value !== undefined)
        assert.ok(presentValues.length > 0)
        for (const value of presentValues) assert.equal(typeof value, 'string')
      }
      assert.ok(Number(item.activityCount) >= 1)
      assert.equal(typeof item.relativeTime, 'string')
      assert.equal(typeof item.typeColor, 'string')
      if (item.type === 'workcase') {
        assert.equal('status' in item, false)
      } else {
        assert.equal(typeof item.status, 'string')
        assert.equal('progress_group' in item, false)
      }
    }
  }

  const response = await fetch(`${baseUrl}/api/cognition?locale=zh&window=30d`)
  assert.equal(response.status, 400)
})

test('recent activity aggregation retains the newest fact event and counts complete signature usage', async () => {
  const { buildRecentActivityView } = await import('../../api/routes/cognition.ts')
  const view = buildRecentActivityView([
    {
      type: 'spark', object_id: 'spark-0001', title: 'A', activity: 'created', occurred_at: '2026-08-01T00:00:00Z',
      status: 'open', read_status: 'readable', field_issues: [], unparsed_structures: [],
      signature: { productName: 'cindy', modelName: 'gpt-5.6-luna' },
    },
    {
      type: 'spark', object_id: 'spark-0001', title: 'A', activity: 'updated', occurred_at: '2026-08-01T02:00:00Z',
      status: 'open', read_status: 'readable', field_issues: [], unparsed_structures: [],
      signature: { productName: 'cindy', modelName: 'gpt-5.6-luna' },
    },
    {
      type: 'adr', object_id: 'adr-0001', title: 'B', activity: 'updated', occurred_at: '2026-08-01T01:00:00Z',
      status: 'active', read_status: 'readable', field_issues: [], unparsed_structures: [],
      signature: { productName: 'ci', modelName: 'reviewer-model' },
    },
  ])
  assert.deepEqual(view.items.map((item) => `${item.object_id}:${item.activity_count}:${item.occurred_at}`), [
    'spark-0001:2:2026-08-01T02:00:00Z',
    'adr-0001:1:2026-08-01T01:00:00Z',
  ])
  assert.deepEqual(view.modelUsage, [{ value: 'gpt-5.6-luna', count: 2 }, { value: 'reviewer-model', count: 1 }])
  assert.deepEqual(view.environmentUsage, [{ value: 'Cindy', count: 2 }, { value: 'Ci', count: 1 }])
})

test('recent activity environment usage applies platform signature normalization', async () => {
  const { buildRecentActivityView } = await import('../../api/routes/cognition.ts')
  const base = {
    type: 'spark' as const, title: 'Normalized platform', activity: 'updated' as const,
    status: 'open', read_status: 'readable', field_issues: [], unparsed_structures: [],
  }
  const view = buildRecentActivityView([
    { ...base, object_id: 'spark-deepseek', occurred_at: '2026-08-01T00:00:00Z', signature: { productName: 'DeepSeek Harness' } },
    { ...base, object_id: 'spark-trae', occurred_at: '2026-08-01T01:00:00Z', signature: { productName: 'Trae Code' } },
  ])
  assert.deepEqual(view.environmentUsage, [{ value: 'DeepSeek Harness', count: 1 }, { value: 'Trae', count: 1 }])
})

test('recent activity environment usage normalizes a runtime-only DeepSeek Harness signature', async () => {
  const { buildRecentActivityView } = await import('../../api/routes/cognition.ts')
  const view = buildRecentActivityView([{
    type: 'spark' as const, object_id: 'spark-deepseek-runtime-only', title: 'Runtime-only platform',
    activity: 'updated' as const, occurred_at: '2026-08-01T00:00:00Z', status: 'open',
    read_status: 'readable', field_issues: [], unparsed_structures: [],
    signature: { productName: 'deepseek-harness' },
  }])
  assert.deepEqual(view.environmentUsage, [{ value: 'DeepSeek Harness', count: 1 }])
})

test('recent activity environment usage merges Codex Desktop and Codex into one server statistic', async () => {
  const { buildRecentActivityView } = await import('../../api/routes/cognition.ts')
  const common = {
    type: 'spark' as const, title: 'Codex platform', activity: 'updated' as const,
    status: 'open', read_status: 'readable', field_issues: [], unparsed_structures: [],
  }
  const view = buildRecentActivityView([
    {
      ...common, object_id: 'spark-codex-desktop', occurred_at: '2026-08-01T00:00:00Z',
      signature: { productName: 'codex-desktop', agentRuntimeName: 'codex' } as any,
    },
    {
      ...common, object_id: 'spark-codex', occurred_at: '2026-08-01T01:00:00Z',
      signature: { agentRuntimeName: 'codex' } as any,
    },
  ])
  assert.deepEqual(view.environmentUsage, [{ value: 'Codex', count: 1 }])
})

test('duplicate object UIDs never merge distinct activity objects', async () => {
  const { buildRecentActivityView } = await import('../../api/routes/cognition.ts')
  const duplicateUid = '0198f1c7-8a2b-7c3d-9e4f-123456789abc'
  const common = {
    type: 'spark' as const, title: 'Duplicate UID', activity: 'updated' as const,
    status: 'open', read_status: 'readable', field_issues: [], unparsed_structures: [],
    object_uid: duplicateUid,
  }
  const view = buildRecentActivityView([
    { ...common, object_id: 'spark-0001', occurred_at: '2026-08-01T00:00:00Z' },
    { ...common, object_id: 'spark-0002', occurred_at: '2026-08-01T01:00:00Z' },
  ])

  assert.deepEqual(view.items.map((item) => item.object_id).sort(), ['spark-0001', 'spark-0002'])
})

test('recent activity aggregates trailing model bracket annotations with the canonical model name', async () => {
  const { buildRecentActivityView } = await import('../../api/routes/cognition.ts')
  const common = {
    type: 'spark' as const, title: 'Signature normalization', activity: 'updated' as const,
    status: 'open', read_status: 'readable', field_issues: [], unparsed_structures: [],
  }
  const view = buildRecentActivityView([
    {
      ...common, object_id: 'spark-0101', occurred_at: '2026-08-01T00:00:00Z',
      signature: { modelName: 'deepseek-v4-flash' },
    },
    {
      ...common, object_id: 'spark-0102', occurred_at: '2026-08-01T01:00:00Z',
      signature: { modelName: 'deepseek/deepseek-v4-flash[1m]' },
    },
  ])

  assert.deepEqual(view.modelUsage, [{ value: 'deepseek-v4-flash', count: 2 }])
})

test('recent activity accepts current change-log signatures and ignores legacy fields', async () => {
  const { buildFactActivityItems, buildRecentActivityView } = await import('../../api/routes/cognition.ts')
  const raw = {
    object_id: 'spark-0002', title: 'Canonical signature', status: 'open',
    change_log: [{
      signature: { model_id: 'legacy-model', agent_workbench: 'legacy-runtime' },
      session_id: 'legacy-session', at: '2026-07-31T00:00:00Z', summary: 'Legacy',
    }, {
      signature: { product_name: 'cindy', model_name: 'chatgpt/gpt-5.6-terra', agent_runtime_name: 'codex-cli' },
      session_id: 'current-session', at: '2026-08-01T00:00:00Z', summary: 'Created',
    }],
  }
  const builds = buildFactActivityItems(raw, 'spark', Date.parse('2026-07-31T00:00:00Z'), Date.parse('2026-08-02T00:00:00Z'))
  assert.deepEqual(builds.find((build) => build.occurred_at === '2026-08-01T00:00:00Z')?.signature, { productName: 'Cindy', modelName: 'gpt-5.6-terra' })

  const view = buildRecentActivityView(builds)
  assert.deepEqual(view.modelUsage, [{ value: 'gpt-5.6-terra', count: 1 }])
  assert.deepEqual(view.environmentUsage, [{ value: 'Cindy', count: 1 }])
})

test('recent activity retains a current partial signature without inventing a model name', async () => {
  const { buildFactActivityItems, buildRecentActivityView } = await import('../../api/routes/cognition.ts')
  const raw = {
    object_id: 'spark-0003', title: 'Partial signature', status: 'open',
    change_log: [{
      signature: { product_name: 'Cindy', model_name: null, agent_runtime_name: 'Codex' },
      at: '2026-08-01T00:00:00Z', summary: 'Created',
    }],
  }
  const builds = buildFactActivityItems(raw, 'spark', Date.parse('2026-07-31T00:00:00Z'), Date.parse('2026-08-02T00:00:00Z'))
  assert.deepEqual(builds[0]?.signature, { productName: 'Cindy' })

  const view = buildRecentActivityView(builds)
  assert.deepEqual(view.modelUsage, [])
  assert.deepEqual(view.environmentUsage, [{ value: 'Cindy', count: 1 }])
})

test('Spark health reuses the newest complete change-log signature for its card-equivalent attribution', async () => {
  const { buildSparkHealth } = await import('../../api/routes/cognition.ts')
  const health = buildSparkHealth([{
    object_id: 'spark-0003', title: 'Spark attribution', status: 'open', priority: 'P1',
    updated_at: '2026-08-01T03:00:00Z', read_status: 'readable',
    change_log: [
      { at: '2026-08-01T01:00:00Z', signature: { model_id: 'legacy-model', agent_workbench: 'legacy-runtime' } },
      { at: '2026-08-01T02:00:00Z', signature: { model_id: 'partial' } },
      { at: '2026-08-01T03:00:00Z', signature: { product_name: 'Cindy', model_name: 'gpt-5.6-luna', agent_runtime_name: 'codex-cli' } },
    ],
  }], Date.parse('2026-08-08T00:00:00Z'))
  assert.deepEqual(health.openItems[0]?.signature, { productName: 'Cindy', modelName: 'gpt-5.6-luna' })
  assert.equal(health.openItems[0]?.activity_count, 3)
})

test('fact activity builder reads change_log first and only falls back for legacy facts without usable entries', async () => {
  const { buildFactActivityItems } = await import('../../api/routes/cognition.ts')
  const raw = {
    object_id: 'spark-0999',
    title: '流水驱动的热点',
    status: 'open',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T04:00:00Z',
    change_log: [
      { at: '2026-08-01T01:00:00Z', summary: '创建' },
      { at: '2026-08-01T03:00:00Z', summary: '更新' },
    ],
  }
  const activities = buildFactActivityItems(raw, 'spark', Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-08-01T03:30:00Z'))
  assert.deepEqual(activities.map((item) => `${item.activity}:${item.occurred_at}`), [
    'created:2026-08-01T01:00:00Z',
    'updated:2026-08-01T03:00:00Z',
  ])

  const legacy = buildFactActivityItems(
    { ...raw, change_log: [{ at: 'invalid' }] },
    'spark',
    Date.parse('2026-08-01T00:00:00Z'),
    Date.parse('2026-08-01T04:30:00Z'),
  )
  assert.deepEqual(legacy.map((item) => `${item.activity}:${item.occurred_at}`), [
    'created:2026-08-01T00:00:00Z',
    'updated:2026-08-01T04:00:00Z',
  ])
})

test('inbox collects only decision-baseline items with a deterministic sort order', async () => {
  const body = await cognition('zh')
  const inbox = body.inbox as Record<string, unknown>
  const items = inbox.items as Array<Record<string, unknown>>

  assert.equal(inbox.total, items.length)
  // 当前项目可以没有待决定事项；空态也是受支持的完整投影。
  if (items.length === 0) return

  // 排序确定性：实际顺序必须等于按路由规则重排的顺序。
  const expected = items.slice().sort(compareSort)
  const actualIds = items.map((i) => String(i.id))
  const expectedIds = expected.map((i) => String(i.id))
  assert.deepEqual(actualIds, expectedIds)

  // 优先级最小者排在最前（P0 > P1 > …）；缺失/非法优先级排最后。
  const ranks = items.map((i) => priorityRank(i.priority))
  const minRank = Math.min(...ranks)
  assert.equal(priorityRank(items[0].priority), minRank)
  // 缺失优先级项必须排在所有合法 P0-P3 之后（Q8）；非法优先级同为 rank 4 也归入末尾。
  const validIndices = items
    .map((i, idx) => ({ i, idx }))
    .filter(({ i }) => typeof i.priority === 'string' && /^P[0-3]$/.test(String(i.priority)))
    .map(({ idx }) => idx)
  const lastValidIndex = validIndices.length > 0 ? Math.max(...validIndices) : -1
  items.forEach((i, idx) => {
    if (!('priority' in i)) {
      assert.ok(idx > lastValidIndex, 'missing-priority item must come after all valid P0-P3 items')
    }
  })
})

test('active WorkCases contain ordinary progress or termination cleanup and reuse the list Card projection', async () => {
  const body = await cognition('zh')
  const active = body.activeWorkCases as Record<string, unknown>
  const items = active.items as Array<Record<string, unknown>>
  const inboxIds = new Set(
    ((body.inbox as Record<string, unknown>).items as Array<Record<string, unknown>>)
      .map((item) => String(item.id)),
  )

  assert.equal(active.total, items.length)
  assert.deepEqual(items.map((item) => String(item.id)), items.slice().sort(compareSort).map((item) => String(item.id)))
  for (const item of items) {
    assert.equal(item.type, 'workcase')
    assert.ok(['progressing', 'termination_cleanup'].includes(String(item.progress_group)))
    assert.equal(typeof item.lifecycle_position, 'string')
    assert.equal('phase' in item, false)
    assert.equal(typeof item.isBlocked, 'boolean')
    assert.equal('status' in item, false)
    assert.equal('inboxKind' in item, false)
    assert.equal(inboxIds.has(String(item.id)), false, 'active item must not duplicate a Human Gate item')
    assert.ok(item.card && typeof item.card === 'object')
    const card = item.card as Record<string, unknown>
    assert.equal(typeof card.goal, 'string')
    assert.equal('object_id' in card, false)
    assert.equal('status' in card, false)
    assert.equal('phase' in card, false)
    if ('progress_step' in item) {
      assert.ok(['item_execution', 'controller_self_check', 'independent_review', 'controller_synthesis'].includes(String(item.progress_step)))
    }
  }
})

test('inbox keeps WorkCase Human positions separate from Pitfall draft confirmation', async () => {
  const body = await cognition('zh')
  const items = (body.inbox as Record<string, unknown>).items as Array<Record<string, unknown>>

  const kinds = new Set<string>()
  let workCaseCount = 0
  let pitfallCount = 0
  for (const item of items) {
    if (item.type === 'workcase') {
      workCaseCount += 1
      assert.ok(['plan_confirmation', 'closure_confirmation'].includes(String(item.progress_group)))
      assert.ok(['plan_confirmation', 'closure_confirmation', 'blocked_resolution'].includes(String(item.inboxKind)))
      assert.equal(typeof item.lifecycle_position, 'string')
      assert.equal(typeof item.isBlocked, 'boolean')
      // WorkCase 条目只携带 progress_group；不得把来源 status 放在名为 status 的字段（02 §7.3）。
      assert.equal('status' in item, false)
      assert.equal(item.inboxKind, expectedInboxKind(item))
    } else if (item.type === 'pitfall') {
      pitfallCount += 1
      assert.equal(item.status, 'draft')
      assert.equal(item.inboxKind, 'pitfall_confirmation')
      assert.equal('progress_group' in item, false)
    } else {
      assert.fail(`unexpected inbox object type: ${String(item.type)}`)
    }
    assert.equal(typeof item.relativeTime, 'string')
    assert.equal(typeof item.typeColor, 'string')
    assert.equal('source_status' in item, false)
    kinds.add(String(item.inboxKind))
  }
  assert.equal(workCaseCount + pitfallCount, items.length)
  // 当前事实源不保证每次读取都包含全部待决对象；只校验实际出现对象的投影契约。
  for (const kind of kinds) {
    assert.ok(['plan_confirmation', 'closure_confirmation', 'blocked_resolution', 'pitfall_confirmation'].includes(kind))
  }
})

test('cognition rejects a project outside the verified configuration', async () => {
  const response = await fetch(`${baseUrl}/api/cognition?locale=zh&window=1d&projectId=ldvh-closure-preview`)
  assert.equal(response.status, 400)
  assert.match(String((await response.json() as Record<string, unknown>).error), /Unknown governed project/)
})

test('current inbox preserves complete shared Card fields for every available draft Pitfall', async () => {
  const body = await cognition('zh', '1d')
  const items = (body.inbox as Record<string, unknown>).items as Array<Record<string, unknown>>
  for (const pitfall of items.filter((item) => item.type === 'pitfall')) {
    assert.equal(pitfall.status, 'draft')
    assert.equal(pitfall.inboxKind, 'pitfall_confirmation')
    const card = pitfall.card as Record<string, unknown>
    for (const field of ['symptoms', 'trigger_conditions', 'resolution', 'avoidance', 'validation_summary', 'applicability']) {
      assert.equal(typeof card[field], 'string', `${field} remains readable in the ordinary Pitfall Card projection`)
      assert.ok(String(card[field]).trim().length > 0)
    }
  }
})

test('priority signal is shown only for valid P0-P3 and omitted for missing/invalid', async () => {
  const body = await cognition('zh')
  const items = (body.inbox as Record<string, unknown>).items as Array<Record<string, unknown>>

  for (const item of items) {
    if ('priority' in item) {
      assert.match(String(item.priority), /^P[0-3]$/)
    }
  }
  // 若存在缺失/非法优先级的条目，它们必须排在所有合法 P0-P3 之后（Q8）。
  const missing = items.filter((i) => !('priority' in i))
  if (missing.length > 0) {
    const lastLegalIndex = items.length - missing.length - 1
    for (let i = 0; i < items.length; i++) {
      if (!('priority' in items[i])) assert.ok(i > lastLegalIndex)
    }
  }
})

test('decision basis is inlined via each source object card projection (Q3)', async () => {
  const body = await cognition('zh')
  const items = (body.inbox as Record<string, unknown>).items as Array<Record<string, unknown>>

  for (const item of items) {
    assert.ok('card' in item)
    const card = item.card as Record<string, unknown>
    if (item.type === 'workcase') {
      assert.equal(typeof card.goal, 'string')
      if (item.inboxKind === 'plan_confirmation') {
        assert.ok(Array.isArray(card.successCriteria), 'plan item carries successCriteria array')
        for (const field of ['scope', 'success_criterion_definitions', 'work_items', 'creation_reviews', 'execution_authorization']) {
          if (field in card) assert.notEqual(card[field], undefined, `${field} preserves its source value`)
        }
      }
    } else {
      assert.equal(item.type, 'pitfall')
      for (const field of ['symptoms', 'trigger_conditions', 'applicability', 'root_cause', 'resolution', 'avoidance', 'validation_summary']) {
        if (field in card) assert.notEqual(card[field], undefined, `${field} preserves its source value`)
      }
    }
    // 身份字段不重复收入 card。
    assert.equal('object_id' in card, false)
    assert.equal('status' in card, false)
    assert.equal('progress_group' in card, false)
  }
})

test('readable items carry canonical_path for conditional copy (Q4); time omission when missing', async () => {
  const body = await cognition('zh')
  const items = (body.inbox as Record<string, unknown>).items as Array<Record<string, unknown>>

  if (items.length === 0) return
  for (const item of items) {
    // 字段级直读 readable 时携带 canonical_path，供条件显示“复制对象路径”。
    const collection = item.type === 'workcase' ? 'workcases' : 'pitfalls'
    assert.equal(item.canonical_path, `ldvh-base/${collection}/${String(item.id)}.yaml`)
    // updated_at 缺失排最后并省略时间显示（Q8）：有则带 updatedAt 字符串。
    if (item.read_status === 'readable' && typeof item.updatedAt !== 'string') {
      // 缺失时该条目应处于排序末尾（上方排序测试已覆盖），此处仅记录形状。
      assert.equal(typeof item.updatedAt, 'undefined')
    }
  }
})

test('observation time and inbox survive locale switch without leaking raw status/enum', async () => {
  const zh = await cognition('zh')
  const en = await cognition('en')

  assert.match(String(zh.generatedAt), RFC3339)
  assert.match(String(en.generatedAt), RFC3339)
  // 同一观察窗口下，收件箱对象集合与排序与语言无关（locale 仅影响 relativeTime 文案）。
  const zhIds = ((zh.inbox as Record<string, unknown>).items as Array<Record<string, unknown>> | undefined)?.map((i) => String(i.id))
  const enIds = ((en.inbox as Record<string, unknown>).items as Array<Record<string, unknown>> | undefined)?.map((i) => String(i.id))
  assert.deepEqual(zhIds, enIds)
})

test('module-level degradation is surfaced via issues without breaking the contract', async () => {
  const body = await cognition('zh')
  // 当前事实源无模块级降级：issues 省略（仅在存在时返回数组）。
  if ('issues' in body) {
    assert.ok(Array.isArray(body.issues))
  }
})

test('Cognition resets Spark health age filter from each successful snapshot', async () => {
  const cognition = readFileSync(path.join(repositoryRoot, 'src/pages/CognitionCenter.tsx'), 'utf8')
  const filter = readFileSync(path.join(repositoryRoot, 'src/utils/cognitionSparkHealth.ts'), 'utf8')
  assert.match(cognition, /getDefaultSparkHealthAgeFilter, type SparkHealthAgeFilter/)
  assert.match(filter, /silentDays >= 7/)
  assert.match(filter, /silentDays >= 3/)
  assert.match(cognition, /setSparkHealthAgeFilter\(getDefaultSparkHealthAgeFilter\(next\.sparkHealth\?\.openItems \?\? \[\]\)\)/)
  assert.match(cognition, /if \(!cancelled\) \{[\s\S]*setData\(next\);[\s\S]*setSparkHealthAgeFilter\(/)
})
