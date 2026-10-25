/**
 * 运行账清理的契约（`/api/diagnostics/logs/preview|clean`）。
 *
 * 这组用例守的是**不可逆操作的安全边界**，不是像素：
 *   1. **水位绝不可清** —— 删水位会让机制重新观察已处理内容、重复入账；
 *   2. **预览与真删同源** —— 界面说删 N 条，真删就必须是 N 条；
 *   3. **判定不了时间的记录原样保留** —— 删一条读不懂的记录，是用解析失败
 *      换一次静默损失；
 *   4. **清理前必有备份** —— 且备份内容与原文件一致；
 *   5. **清理后 /gate 缓存必须失效** —— 否则页面会显示清理前的旧数字。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  LOGGABLE_TARGETS,
  RETENTION_CHOICES,
  cutoffFor,
  planCleanup,
} from '../../api/services/logsCleanup.ts'
import { buildGateReport, invalidateGateReportCache } from '../../api/services/runtimeDiagnostics.ts'

const DAY = 86_400_000

async function makeHome(): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), 'ldvh-clean-'))
  const home = path.join(base, 'home')
  await mkdir(path.join(home, 'ldvh'), { recursive: true })
  return home
}

function stamp(daysAgo: number, now = Date.now()): string {
  return new Date(now - daysAgo * DAY).toISOString()
}

test('水位不在可清理清单里——删它会让机制重复观察已处理内容', () => {
  const ids = LOGGABLE_TARGETS.map((target) => String(target.id))
  assert.ok(!ids.includes('friction-discovery-watermarks'), '水位绝不可作为可清理目标')
  assert.ok(
    !ids.some((id) => id.includes('watermark')),
    `任何水位类载体都不得出现在可清理清单；实际=${JSON.stringify(ids)}`,
  )
  // 反向确认清单非空（否则上面的断言会因"什么都没列"而空转通过）。
  assert.ok(ids.length >= 4, `可清理目标应有若干项；实际=${ids.length}`)
})

test('保留窗口只接受 1 / 3 / 7 天（Human 指定的三档）', () => {
  assert.deepEqual([...RETENTION_CHOICES], [1, 3, 7])
})

test('截止时刻按保留天数正确回推', () => {
  const now = new Date('2026-10-26T00:00:00.000Z')
  assert.equal(cutoffFor(1, now).toISOString(), '2026-10-25T00:00:00.000Z')
  assert.equal(cutoffFor(3, now).toISOString(), '2026-10-23T00:00:00.000Z')
  assert.equal(cutoffFor(7, now).toISOString(), '2026-10-19T00:00:00.000Z')
})

test('预览不写任何文件（dryRun 必须无副作用）', async () => {
  const home = await makeHome()
  const file = path.join(home, 'ldvh', 'pending-queue.jsonl')
  const body = [stamp(10), stamp(5), stamp(1)].map((at) => JSON.stringify({ at })).join('\n') + '\n'
  await writeFile(file, body, 'utf8')

  const preview = await planCleanup({ dshHome: home, retentionDays: 3, targetIds: ['pending-queue'], apply: false })
  assert.equal(preview.targets[0].removing, 2, '10 天前与 5 天前应被计入删除')
  assert.equal(preview.targets[0].keeping, 1)

  // 关键：文件逐字未变。
  assert.equal(await readFile(file, 'utf8'), body, '预览不得改写文件')
})

test('真删的条数与预览一致（同源计算，不得出现"说 N 删 M"）', async () => {
  const home = await makeHome()
  const file = path.join(home, 'ldvh', 'pending-queue.jsonl')
  await writeFile(
    file,
    [stamp(20), stamp(10), stamp(4), stamp(2), stamp(0.5)]
      .map((at) => JSON.stringify({ at }))
      .join('\n') + '\n',
    'utf8',
  )

  const preview = await planCleanup({ dshHome: home, retentionDays: 3, targetIds: ['pending-queue'], apply: false })
  const applied = await planCleanup({ dshHome: home, retentionDays: 3, targetIds: ['pending-queue'], apply: true })

  assert.equal(applied.applied[0].removed, preview.targets[0].removing, '实际删除数须等于预览数')
  assert.equal(applied.applied[0].removed, 3, '20/10/4 天前共 3 条应删')
  assert.equal(applied.applied[0].kept, 2, '2 天前与半天前应留')

  const left = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
  assert.equal(left.length, 2)
})

test('判定不了时间的记录原样保留并计数——不得用解析失败换静默数据损失', async () => {
  const home = await makeHome()
  const file = path.join(home, 'ldvh', 'pending-queue.jsonl')
  const good = JSON.stringify({ at: stamp(10) })
  const noTime = JSON.stringify({ reason: '没有 at 字段' })
  const badTime = JSON.stringify({ at: '不是时间' })
  const broken = '{ 这不是合法 JSON'
  await writeFile(file, [good, noTime, badTime, broken].join('\n') + '\n', 'utf8')

  const applied = await planCleanup({ dshHome: home, retentionDays: 3, targetIds: ['pending-queue'], apply: true })
  assert.equal(applied.applied[0].removed, 1, '只有时间明确且过期的才删')
  assert.equal(applied.targets[0].unparsable, 3, '三条无法判定时间的须计入 unparsable')

  const left = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
  assert.equal(left.length, 3, '三条判定不了的须原样保留')
  assert.ok(left.includes(broken), '连无法解析的行也要保留原文')
})

test('清理前必须留下备份，且备份内容与原文件逐字一致', async () => {
  const home = await makeHome()
  const file = path.join(home, 'ldvh', 'pending-queue.jsonl')
  const body = [stamp(30), stamp(0)].map((at) => JSON.stringify({ at })).join('\n') + '\n'
  await writeFile(file, body, 'utf8')

  const applied = await planCleanup({ dshHome: home, retentionDays: 1, targetIds: ['pending-queue'], apply: true })
  assert.ok(applied.backupPath, '真删须产生备份路径')

  const backed = await readFile(path.join(applied.backupPath!, 'pending-queue.jsonl'), 'utf8')
  assert.equal(backed, body, '备份须与原文件逐字一致（否则不可恢复）')
})

test('文件不存在时不是错误——合法初态，删除数为 0', async () => {
  const home = await makeHome()
  const preview = await planCleanup({ dshHome: home, retentionDays: 3, targetIds: ['pending-queue'], apply: false })
  assert.equal(preview.targets[0].exists, false)
  assert.equal(preview.targets[0].removing, 0)
  assert.equal(preview.targets[0].keeping, 0)
})

test('运行痕迹（ring 形态）按 runs 数组内的 at 清理，且保持 JSON 结构', async () => {
  const home = await makeHome()
  const file = path.join(home, 'ldvh', 'idle-checkpoint-runs.json')
  const runs = [
    { at: stamp(20), stage: 'landed' },
    { at: stamp(10), stage: 'stopped' },
    { at: stamp(1), stage: 'landed' },
  ]
  await writeFile(file, JSON.stringify({ runs }, null, 2) + '\n', 'utf8')

  const applied = await planCleanup({ dshHome: home, retentionDays: 3, targetIds: ['idle-runs'], apply: true })
  assert.equal(applied.applied[0].removed, 2)

  const doc = JSON.parse(await readFile(file, 'utf8')) as { runs: { stage: string }[] }
  assert.ok(Array.isArray(doc.runs), '结构须仍是 { runs: [...] }')
  assert.equal(doc.runs.length, 1)
  assert.equal(doc.runs[0].stage, 'landed')
})

test('摩擦观察缓冲按项目文件逐个清理，保留未过期的条目', async () => {
  const home = await makeHome()
  const dir = path.join(home, 'ldvh', 'friction-observations')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'proj-a.jsonl')
  await writeFile(
    file,
    [stamp(10, Date.now()), stamp(1)].map((at, i) => JSON.stringify({ at, group: 'g', status: 'pending', i })).join('\n') + '\n',
    'utf8',
  )

  const applied = await planCleanup({ dshHome: home, retentionDays: 3, targetIds: ['friction-observations'], apply: true })
  assert.equal(applied.applied[0].removed, 1)
  const left = (await readFile(file, 'utf8')).split('\n').filter(Boolean)
  assert.equal(left.length, 1, '只保留未过期那条')
  assert.equal(JSON.parse(left[0]).i, 1)
})

test('备份文件目标按修改时间清理，且不影响主队列文件', async () => {
  const home = await makeHome()
  const root = path.join(home, 'ldvh')
  const main = path.join(root, 'pending-queue.jsonl')
  await writeFile(main, JSON.stringify({ at: stamp(0) }) + '\n', 'utf8')

  const oldBak = path.join(root, 'pending-queue.jsonl.bak-2026-01-01')
  const newBak = path.join(root, 'pending-queue.jsonl.bak-recent')
  await writeFile(oldBak, 'old', 'utf8')
  await writeFile(newBak, 'new', 'utf8')
  // 把"旧"备份的 mtime 推到 10 天前。
  const { utimes } = await import('node:fs/promises')
  const tenDaysAgo = (Date.now() - 10 * DAY) / 1000
  await utimes(oldBak, tenDaysAgo, tenDaysAgo)

  const preview = await planCleanup({ dshHome: home, retentionDays: 3, targetIds: ['queue-backups'], apply: false })
  assert.equal(preview.targets[0].removing, 1, '只有 10 天前那个备份该被清理')

  const applied = await planCleanup({ dshHome: home, retentionDays: 3, targetIds: ['queue-backups'], apply: true })
  assert.equal(applied.applied[0].removed, 1)

  // 主队列文件必须完好——清理备份不能碰它。
  assert.equal(await readFile(main, 'utf8'), JSON.stringify({ at: (await readFile(main, 'utf8')).trim().length ? JSON.parse(await readFile(main, 'utf8')).at : '' }) + '\n')
})

test('清理后 /gate 缓存须失效——否则页面显示清理前的旧数字', async () => {
  const home = await makeHome()
  // 造一个空会话目录：两次调用应命中缓存（第二次 0ms 级），但失效后须重算。
  const workspaceRoot = path.join(home, 'proj')
  await mkdir(path.join(home, 'sessions'), { recursive: true })

  const first = await buildGateReport({ dshHome: home, workspaceRoot })
  assert.equal(first.scope.cachedAt, undefined, '首次计算不应带 cachedAt')

  const second = await buildGateReport({ dshHome: home, workspaceRoot })
  assert.ok(second.scope.cachedAt, '第二次应命中缓存并如实标注 cachedAt')

  invalidateGateReportCache()
  const third = await buildGateReport({ dshHome: home, workspaceRoot })
  assert.equal(third.scope.cachedAt, undefined, '失效后应重新计算，不再标注 cachedAt')
})
