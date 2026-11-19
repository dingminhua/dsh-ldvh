
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { compareTimestamps } from '../../api/services/time.ts'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')

let server: Server
let baseUrl = ''

before(async () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'ldvh-cognition-workspace-'))
  const projectRoot = path.join(workspaceRoot, 'demo')
  mkdirSync(path.join(projectRoot, 'ldvh-base', 'sparks'), { recursive: true })
  execFileSync('git', ['-C', projectRoot, 'init', '-q'])
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'tests@example.com'])
  execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'LDVH Tests'])

  const governanceConfig = path.join(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml')
  writeFileSync(governanceConfig, [
    'governance_instance_name: Cognition Contract Tests',
    'product_description: |',
    '  cognition-inbox-contract 自建工作区。',
    'projects:',
    '  - id: demo',
    `    path: ${projectRoot}`,
    '    name: Demo',
    '    description: Temp governed project for the cognition contract.',
    'default_project_id: demo',
    '',
  ].join('\n'))

  process.env.LDVH_GOVERNED_PROJECTS_CONFIG = governanceConfig
  process.env.LDVH_WORKSPACE_ROOT = workspaceRoot
  process.env.LDVH_WEB_WORKTREE_LOCATOR = projectRoot

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

test('AI module summaries use human-readable type and title without machine locators', () => {
  const source = readFileSync(path.resolve(repositoryRoot, 'src/pages/CognitionCenter.tsx'), 'utf8')
  assert.match(source, /return `\$\{getTypeLabel\(type, locale\)\}《\$\{title\}》`/)

  const summaryNames = [
    'buildModuleSummary',
    'buildRecentActivitySummary',
    'buildSparkHealthSummary',
  ]
  for (const [index, name] of summaryNames.entries()) {
    const start = source.indexOf(`function ${name}`)
    const nextName = summaryNames[index + 1]
    const end = nextName ? source.indexOf(`function ${nextName}`, start) : source.indexOf('function InboxItemReadNotes', start)
    const body = source.slice(start, end)
    assert.ok(start >= 0 && end > start, `${name} must remain independently inspectable`)
    assert.match(body, /formatHumanObjectReference\(/, `${name} must use 类型《当前 Title》`)
    assert.doesNotMatch(body, /formatObjectReference|projectId|@\$\{/, `${name} must not expose a machine locator`)
  }
})

test('cognition endpoint returns inbox, fact activity, and Spark health contract shapes with observation time', async () => {
  const body = await cognition('zh')

  assert.match(String(body.generatedAt), RFC3339)
  assert.ok(body.scope && typeof body.scope === 'object')
  assert.equal(typeof (body.scope as Record<string, unknown>).governedProjectId, 'string')
  assert.ok(((body.scope as Record<string, unknown>).governedProjectId as string).length > 0)
  assert.ok(body.inbox && typeof body.inbox === 'object')
  const inbox = body.inbox as Record<string, unknown>
  assert.ok(Array.isArray(inbox.items))
  assert.equal(typeof inbox.total, 'number')
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
  for (const key of ['total', 'openTotal', 'terminalTotal']) {
    assert.equal(typeof sparkHealth[key], 'number')
  }
  assert.ok(sparkHealth.terminalByStatus && typeof sparkHealth.terminalByStatus === 'object')
  assert.ok(sparkHealth.openByPriority && typeof sparkHealth.openByPriority === 'object')
  assert.ok(Array.isArray(sparkHealth.openItems))
  assert.equal('silentItems' in sparkHealth, false)
  assert.equal('silentThresholdDays' in sparkHealth, false)
  assert.equal('silentCount' in sparkHealth, false)
  assert.equal('recentHotspots' in body, false, 'removed hotspot module must not be projected')
  for (const moduleKey of ['whileAway', 'timeline', 'direction']) {
    assert.equal(moduleKey in body, false, `not-yet-built module must omit ${moduleKey}`)
  }
})

test('Spark health splits the current pool into terminal and open items, ordered by days-since-update (no silent threshold)', async () => {
  const body = await cognition('zh')
  const health = body.sparkHealth as Record<string, unknown>
  const terminalByStatus = health.terminalByStatus as Record<string, unknown>
  const terminalTotal = Number(terminalByStatus.implemented) + Number(terminalByStatus.discarded)

  assert.equal(Number(health.total), Number(health.openTotal) + terminalTotal)
  assert.equal(Number(health.terminalTotal), terminalTotal)
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
  assert.equal('silentItems' in health, false)
  assert.equal('silentThresholdDays' in health, false)
  assert.equal('silentCount' in health, false)
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
      assert.ok(['pitfall', 'spark', 'report', 'goal'].includes(String(item.type)))
      assert.ok(['created', 'updated'].includes(String(item.activity)))
      assert.match(String(item.occurredAt), RFC3339)
      if (item.signature !== undefined) {
        const signature = item.signature as Record<string, unknown>
        const presentValues = [signature.provider, signature.model, signature.productName, signature.modelName]
          .filter((value) => value !== undefined)
        assert.ok(presentValues.length > 0, 'signature 必须携带至少一个署名值')
        for (const value of presentValues) assert.equal(typeof value, 'string')
      }
      assert.ok(Number(item.activityCount) >= 1)
      assert.equal(typeof item.relativeTime, 'string')
      assert.equal(typeof item.typeColor, 'string')
      assert.equal(typeof item.status, 'string')
      assert.equal('progress_group' in item, false)
    }
  }

  const response = await fetch(`${baseUrl}/api/cognition?locale=zh&window=30d`)
  assert.equal(response.status, 400)
  for (const inherited of ['toString', 'constructor', 'valueOf']) {
    const inheritedResponse = await fetch(`${baseUrl}/api/cognition?locale=zh&window=${inherited}`)
    assert.equal(inheritedResponse.status, 400, `window=${inherited} must be rejected, not treated as a valid window`)
  }
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
      type: 'norm', object_id: 'norm-0001', title: 'B', activity: 'updated', occurred_at: '2026-08-01T01:00:00Z',
      status: 'active', read_status: 'readable', field_issues: [], unparsed_structures: [],
      signature: { productName: 'ci', modelName: 'reviewer-model' },
    },
  ])
  assert.deepEqual(view.items.map((item) => `${item.object_id}:${item.activity_count}:${item.occurred_at}`), [
    'spark-0001:2:2026-08-01T02:00:00Z',
    'norm-0001:1:2026-08-01T01:00:00Z',
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
  const legacyCodexDesktopSignature: Record<string, unknown> = { productName: 'codex-desktop', agentRuntimeName: 'codex' };
  const legacyCodexSignature: Record<string, unknown> = { agentRuntimeName: 'codex' };
  const view = buildRecentActivityView([
    {
      ...common, object_id: 'spark-codex-desktop', occurred_at: '2026-08-01T00:00:00Z',
      signature: legacyCodexDesktopSignature,
    },
    {
      ...common, object_id: 'spark-codex', occurred_at: '2026-08-01T01:00:00Z',
      signature: legacyCodexSignature,
    },
  ])
  assert.deepEqual(view.environmentUsage, [{ value: 'Codex', count: 1 }])
})

test('duplicate object UIDs never merge distinct activity objects', async () => {
  const { buildRecentActivityView } = await import('../../api/routes/cognition.ts')
  const duplicateUid = '0198f1c7-8a2b-4c3d-9e4f-123456789abc'
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

test('recent activity reads the v5 flat provider/model change_log shape with Date instances (specs/03 §6.1, 09)', async () => {
  const { buildFactActivityItems, buildRecentActivityView, buildSparkHealth } = await import('../../api/routes/cognition.ts')
  const raw = {
    object_id: 'research-0001', title: 'Flat attribution', status: 'active',
    change_log: [
      { at: new Date('2026-09-06T07:48:23.255Z'), provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' },
      { at: new Date('2026-09-07T18:53:00.235Z'), provider: 'zzztoken-glm', model: 'glm-5.3', summary: '更新' },
    ],
  }
  const builds = buildFactActivityItems(raw, 'report', Date.parse('2026-09-06T00:00:00Z'), Date.parse('2026-09-08T00:00:00Z'))
  assert.deepEqual(builds.map((build) => `${build.activity}:${build.occurred_at}`), [
    'created:2026-09-06T07:48:23.255Z',
    'updated:2026-09-07T18:53:00.235Z',
  ])
  assert.deepEqual(builds[builds.length - 1]?.signature, { provider: 'zzztoken-glm', model: 'glm-5.3' })

  const view = buildRecentActivityView(builds)
  assert.deepEqual(view.modelUsage, [{ value: 'glm-5.3', count: 2 }])
  assert.deepEqual(view.environmentUsage, [{ value: 'zzztoken-glm', count: 2 }])

  const health = buildSparkHealth([{
    object_id: 'spark-0009', title: 'Flat spark', status: 'open',
    change_log: [
      { at: new Date('2026-09-06T07:48:23.255Z'), provider: 'zzztoken-glm', model: 'glm-5.3', summary: '受控创建' },
    ],
  }], Date.parse('2026-09-08T00:00:00Z'))
  const openItem = health.openItems[0]
  assert.equal(openItem?.updated_at, '2026-09-06T07:48:23.255Z')
  assert.equal(openItem?.activity_count, 1)
  assert.deepEqual(openItem?.signature, { provider: 'zzztoken-glm', model: 'glm-5.3' })
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
  ])
})

test('inbox collects only decision-baseline items with a deterministic sort order', async () => {
  const body = await cognition('zh')
  const inbox = body.inbox as Record<string, unknown>
  const items = inbox.items as Array<Record<string, unknown>>

  assert.equal(inbox.total, items.length)
  if (items.length === 0) return

  const expected = items.slice().sort(compareSort)
  const actualIds = items.map((i) => String(i.id))
  const expectedIds = expected.map((i) => String(i.id))
  assert.deepEqual(actualIds, expectedIds)

  const ranks = items.map((i) => priorityRank(i.priority))
  const minRank = Math.min(...ranks)
  assert.equal(priorityRank(items[0].priority), minRank)
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

test('inbox collects friction repairs with the projection contract (26 §12)', async () => {
  const body = await cognition('zh')
  const items = (body.inbox as Record<string, unknown>).items as Array<Record<string, unknown>>

  for (const item of items) {
    assert.equal(item.type, 'friction', `unexpected inbox object type: ${String(item.type)}`)
    assert.equal(item.status, 'open')
    assert.equal(item.inboxKind, 'friction_repair')
    assert.equal('progress_group' in item, false)
    assert.equal(typeof item.relativeTime, 'string')
    assert.equal(typeof item.typeColor, 'string')
    assert.equal('source_status' in item, false)
  }
})

test('cognition rejects a project outside the verified configuration', async () => {
  const response = await fetch(`${baseUrl}/api/cognition?locale=zh&window=1d&projectId=ldvh-closure-preview`)
  assert.equal(response.status, 400)
  assert.match(String((await response.json() as Record<string, unknown>).error), /Unknown governed project/)
})

test('priority signal is shown only for valid P0-P3 and omitted for missing/invalid', async () => {
  const body = await cognition('zh')
  const items = (body.inbox as Record<string, unknown>).items as Array<Record<string, unknown>>

  for (const item of items) {
    if ('priority' in item) {
      assert.match(String(item.priority), /^P[0-3]$/)
    }
  }
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
    assert.equal(item.type, 'friction')
    for (const field of ['phenomenon', 'attribution', 'disposition', 'occurrence', 'status']) {
      if (field in card) assert.notEqual(card[field], undefined, `${field} preserves its source value`)
    }
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
    const collection = 'frictions'
    assert.equal(item.canonical_path, `ldvh-base/${collection}/${String(item.id)}.yaml`)
    if (item.read_status === 'readable' && typeof item.updatedAt !== 'string') {
      assert.equal(typeof item.updatedAt, 'undefined')
    }
  }
})

test('observation time and inbox survive locale switch without leaking raw status/enum', async () => {
  const zh = await cognition('zh')
  const en = await cognition('en')

  assert.match(String(zh.generatedAt), RFC3339)
  assert.match(String(en.generatedAt), RFC3339)
  const zhIds = ((zh.inbox as Record<string, unknown>).items as Array<Record<string, unknown>> | undefined)?.map((i) => String(i.id))
  const enIds = ((en.inbox as Record<string, unknown>).items as Array<Record<string, unknown>> | undefined)?.map((i) => String(i.id))
  assert.deepEqual(zhIds, enIds)
})

test('module-level degradation is surfaced via issues without breaking the contract', async () => {
  const body = await cognition('zh')
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

test('近期动态覆盖全部活跃事实类型（26/27 号加入 OBJECT_TYPES 后不得遗漏）', async () => {
  const cognition = readFileSync(path.resolve(repositoryRoot, 'api/routes/cognition.ts'), 'utf8')
  const facts = readFileSync(path.resolve(repositoryRoot, 'api/services/facts.ts'), 'utf8')

  const activeMatch = facts.match(/export const ACTIVE_OBJECT_TYPES = \[([^\]]+)\]/)
  assert.ok(activeMatch, 'ACTIVE_OBJECT_TYPES 必须可解析')
  const activeTypes = activeMatch[1]
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  assert.ok(activeTypes.length >= 6, `活跃类型数应覆盖现存六类：实际 ${activeTypes.length}`)

  const sourcesMatch = cognition.match(/const recentSources[\s\S]*?\]\n/)
  assert.ok(sourcesMatch, '近期动态的类型源表必须可解析')
  const sourcesBlock = sourcesMatch[0]
  const missing = activeTypes.filter((type) => !sourcesBlock.includes(`['${type}'`))
  assert.deepEqual(missing, [], `以下活跃类型未进近期动态：${missing.join('、')}`)

  for (const type of activeTypes) {
    if (type === 'goal') continue
    assert.ok(cognition.includes(`listObjects('${type}'`), `${type} 须有读取调用`)
  }
})

test('近期动态行对摩擦显示重复观察标签，紧跟优先级、在修改次数之前', () => {
  const cognition = readFileSync(path.resolve(repositoryRoot, 'src/pages/CognitionCenter.tsx'), 'utf8')
  const row = cognition.slice(
    cognition.indexOf('function RecentActivityRow'),
    cognition.indexOf('function RecentActivityUsageBars'),
  )

  assert.match(row, /<PriorityIcon source=\{item\} type=\{item\.type\}[\s\S]{0,400}?<FrictionOccurrenceBadge value=\{item\.occurrence\}/,
    '重复观察紧跟优先级，在修改次数之前')
  assert.match(row, /item\.type === 'friction' && <FrictionOccurrenceBadge/, '按类型分派');
  assert.doesNotMatch(row, /ServesSgBadge/, 'serves chip 不得回到近期动态行（2026-11-01 撤除）');
  assert.doesNotMatch(row, /FrictionImpactBadge|FRICTION_IMPACT_CHIP_CLASS/,
    '退役的 impact 徽标不得回到近期动态行（26 §8，2026-11-02）');
})

test('近期动态投影携带 friction 的 occurrence（API 链路不丢字段）', () => {
  const cognition = readFileSync(path.resolve(repositoryRoot, 'api/routes/cognition.ts'), 'utf8')
  const api = readFileSync(path.resolve(repositoryRoot, 'src/utils/api.ts'), 'utf8')

  assert.match(cognition, /serves\?: string[\s\S]{0,1200}?occurrence\?: \{[\s\S]{0,200}?refs\?:/, '① BuildItem 结构声明 occurrence')
  assert.match(cognition, /type === 'friction' && typeof raw\.occurrence === 'object'/, '② 从原始对象取 occurrence')
  assert.match(cognition, /build\.occurrence !== undefined \? \{ occurrence: build\.occurrence \}/, '③ 投影给前端')
  assert.match(api, /occurrence\?: Record<string, unknown>;/, '④ 前端类型声明 occurrence')
})


test('待决定事项收录 open 摩擦：闭集外取值与终态一律不进（26 §12）', () => {
  const route = readFileSync(path.resolve(repositoryRoot, 'api/routes/cognition.ts'), 'utf8')

  assert.match(route, /for \(const raw of data\.items\) \{\s*if \(raw\.status !== 'open'\) continue/,
    '只收 open 账目');
  assert.match(route, /type: 'friction', inboxKind: 'friction_repair'/, '摩擦走独立 inboxKind');
  assert.doesNotMatch(route, /'observing'[^\n]*friction_repair|friction_repair[^\n]*'observing'/,
    'observing（闭集外）不得进入待修收件');
  assert.match(route, /code: 'friction_list_unavailable'/, 'friction 读取失败须进 issues');
})

test('摩擦收件项把 occurrence 平铺到条目根（卡头徽标读对象根）', () => {
  const route = readFileSync(path.resolve(repositoryRoot, 'api/routes/cognition.ts'), 'utf8')
  const api = readFileSync(path.resolve(repositoryRoot, 'src/utils/api.ts'), 'utf8')
  const page = readFileSync(path.resolve(repositoryRoot, 'src/pages/CognitionCenter.tsx'), 'utf8')

  assert.match(route, /function projectFrictionOccurrence/, '② 重复观察投影函数');
  assert.match(route, /Object\.assign\(entry, projectFrictionOccurrence\(build\.projection\)\)/,
    '③ entry 层显式平铺（不依赖客户端翻 card）');
  assert.match(api, /occurrence\?: Record<string, unknown>;/, '④ 前端条目类型声明');
  assert.match(page, /if \(item\.type === 'friction'\) return <FrictionCardContent obj=\{toObjectCard\(item\)\} \/>;/,
    '⑤ 复用 FrictionCardContent');
  assert.match(page, /friction_repair: 'cognition\.kind\.friction_repair'/, '⑥ 模块摘要标签');
})

test('摩擦条目的 canonical_path 指向 frictions 目录而非 pitfalls 回落', () => {
  const route = readFileSync(path.resolve(repositoryRoot, 'api/routes/cognition.ts'), 'utf8')
  const fn = route.slice(route.indexOf('function canonicalPath'), route.indexOf('function factKey'))
  assert.match(fn, /friction: 'frictions'/, '① friction 有显式目录');
  assert.match(fn, /throw new Error/, '② 未知类型失败而非回落');
  assert.doesNotMatch(fn, /type === '\w+' \? '\w+' : 'pitfalls'/, '③ 不得保留二元回落');
})


test('accepted 的度量单列：API 计数、响应体承载、客户端类型与呈现（26 §12 / §18 第 7 条）', () => {
  const route = readFileSync(path.resolve(repositoryRoot, 'api/routes/cognition.ts'), 'utf8')
  const api = readFileSync(path.resolve(repositoryRoot, 'src/utils/api.ts'), 'utf8')
  const page = readFileSync(path.resolve(repositoryRoot, 'src/pages/CognitionCenter.tsx'), 'utf8')
  const locales = readFileSync(path.resolve(repositoryRoot, 'src/i18n/locales.ts'), 'utf8')

  assert.match(route, /if \(raw\.status === 'accepted'\) acceptedFrictionCount \+= 1/, '① accepted 单独计数');
  assert.match(route, /if \(raw\.status !== 'open'\) continue/, '① inbox 仍只收 open（字面判定）');
  assert.match(route, /frictionLedger: \{ acceptedCount: acceptedFrictionCount \}/, '② 响应体 frictionLedger.acceptedCount');
  assert.match(api, /frictionLedger\?: \{ acceptedCount: number \}/, '③ 客户端类型声明');
  assert.match(page, /data\.frictionLedger\.acceptedCount/, '③ UI 读取该计数');
  assert.match(locales, /'cognition\.frictionLedger\.accepted'/, '③ 中英词条存在');
  assert.doesNotMatch(page, /counts\.friction_repair \+= data\.frictionLedger/, '④ 不得混入 inbox 计数');
})
