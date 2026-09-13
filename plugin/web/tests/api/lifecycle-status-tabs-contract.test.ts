import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const webRoot = path.resolve(import.meta.dirname, '../..')

function source(relativePath: string): string {
  return fs.readFileSync(path.join(webRoot, relativePath), 'utf8')
}

test('V4 fact lists keep every declared lifecycle status tab even when its count is zero', () => {
  const filter = source('src/components/ObjectStatusFilter.tsx')

  assert.match(filter, /adr: \['active', 'retired'\]/)
  assert.match(filter, /pitfall: \['draft', 'active', 'discarded'\]/)
  assert.match(filter, /research: \['active', 'retired'\]/)
  // 20 §9 状态闭集：Spark 三态 tab 常驻（open/implemented/discarded）。
  assert.match(filter, /spark: \['open', 'implemented', 'discarded'\]/)
  assert.doesNotMatch(filter, /settled|unclosed/)
  assert.match(filter, /if \(!\(type in FALLBACK_STATUSES_BY_TYPE\)\) return sortedOptions;/)
  assert.match(filter, /if \(displayOptions\.length <= 1 && !\(type in FALLBACK_STATUSES_BY_TYPE\)\) return null;/)
})

test('retired has an explicit lifecycle status label', () => {
  const locales = source('src/i18n/locales.ts')
  const colors = source('src/utils/statusColors.ts')

  assert.match(locales, /retired: \{ zh: '已废弃', en: 'Retired' \}/)
  assert.match(locales, /implemented: \{ zh: '已关闭', en: 'Implemented' \}/)
  // 20 §9：spark implemented（落实/交接）正向达成绿（Human 定案 2026-09-13
  // 取代中性灰——落实是正结果）。
  assert.match(colors, /implemented: \{ light: '#059669', dark: '#00d4aa' \}/)
  assert.match(colors, /closed: \{ light: '#64748b', dark: '#94a3b8' \}/)
  assert.match(locales, /pitfall: \{[\s\S]*draft: \{ zh: '待确认', en: 'Pending confirmation' \}/)
  assert.match(locales, /pitfall: \{[\s\S]*active: \{ zh: '活跃', en: 'Active' \}/)
})

test('Spark list carries three filters (priority/serves/lifecycle); WorkCase has no priority', () => {
  const list = source('src/pages/ObjectList.tsx')
  const route = source('api/routes/objects.ts')

  assert.match(list, /objectList\.lifecycleFilter/)
  // 20 §8（2026-09-13 Human 裁定）：Spark 有 priority，列表提供三联过滤
  // （priority + serves + 生命周期）。WorkCase 维持无此字段（21 §160 闭集）。
  assert.match(list, /ObjectPriorityFilter/)
  assert.match(list, /const supportsPriorityNavigation = currentType === 'spark'/)
  assert.match(list, /activePriority/)
  assert.match(route, /function getSparkPriorityOptions/)
  assert.match(route, /priorityOptions/)
  // priority 参数仅对 spark 生效（workcase 走 progress）。
  assert.match(route, /const priority = type === 'spark' && typeof req\.query\.priority === 'string'/)
  // WorkCase 列表分组按 21 §160 三态收敛，且无 priority 投影。
  assert.match(route, /const WORKCASE_LIST_STATUS_ORDER = \['draft', 'open', 'closed'\] as const/)
  assert.match(
    list,
    /fetchObjects\(currentType, activeStatus \?\? undefined, activeProgressGroup \?\? undefined, activePriority \?\? undefined\)/,
  )
  assert.doesNotMatch(list, /const fetchStatus = currentType === 'spark'/)
  // Spark 状态闭集（open/implemented/discarded，20 §9）与通用类型同路径过滤；
  // v4 的 settled/unclosed 展示拆桶与 spark 专属过滤函数已移除。
  assert.doesNotMatch(route, /matchesSparkListFilter|getSparkStatusOptions|getSparkImplementedPresentationStatus/)
})

test('filtered lifecycle counts reuse the request fact scope', () => {
  const route = source('api/routes/objects.ts')

  assert.match(route, /async function listObjectSummaries\(type: ObjectType, scope: LocalFactScope\)/)
  assert.match(route, /listObjects\(type, undefined, undefined, scope\)/)
  assert.match(route, /status \? await listObjectSummaries\(type, factScope\) : items/)
})
