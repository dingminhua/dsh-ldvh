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
  assert.match(filter, /study: \['active', 'retired'\]/)
  assert.match(filter, /if \(!\(type in FALLBACK_STATUSES_BY_TYPE\)\) return sortedOptions;/)
  assert.match(filter, /if \(displayOptions\.length <= 1 && !\(type in FALLBACK_STATUSES_BY_TYPE\)\) return null;/)
})

test('retired has an explicit lifecycle status label', () => {
  const locales = source('src/i18n/locales.ts')
  const colors = source('src/utils/statusColors.ts')

  assert.match(locales, /retired: \{ zh: '已废弃', en: 'Retired' \}/)
  assert.match(locales, /implemented: \{ zh: '已关闭', en: 'Implemented' \}/)
  assert.match(colors, /implemented: \{ light: '#64748b', dark: '#94a3b8' \}/)
  assert.match(colors, /closed: \{ light: '#64748b', dark: '#94a3b8' \}/)
  assert.match(locales, /pitfall: \{[\s\S]*draft: \{ zh: '待确认', en: 'Pending confirmation' \}/)
  assert.match(locales, /pitfall: \{[\s\S]*active: \{ zh: '活跃', en: 'Active' \}/)
})

test('Spark list exposes lifecycle and priority as separate navigation dimensions', () => {
  const list = source('src/pages/ObjectList.tsx')
  const priorityFilter = source('src/components/ObjectPriorityFilter.tsx')
  const route = source('api/routes/objects.ts')

  assert.match(list, /objectList\.lifecycleFilter/)
  assert.match(list, /ObjectPriorityFilter/)
  assert.match(list, /fetchObjects\(currentType, activeStatus \?\? undefined, activePriority \?\? undefined, activeProgressGroup \?\? undefined\)/)
  assert.doesNotMatch(list, /const fetchStatus = currentType === 'spark'/)
  assert.ok(list.indexOf('<ObjectPriorityFilter') < list.indexOf("t('objectList.lifecycleFilter')"))
  assert.match(priorityFilter, /const SPARK_PRIORITY_ORDER = \['P0', 'P1', 'P2', 'P3'\]/)
  assert.match(priorityFilter, /import PriorityIcon from '@\/components\/PriorityIcon'/)
  assert.match(priorityFilter, /<PriorityIcon source=\{\{ priority \}\} type="spark" locale=\{locale\} size="xs" \/>/)
  assert.match(route, /function getPriorityOptions/)
  assert.match(route, /matchesSparkListFilter/)
})

test('filtered lifecycle counts reuse the request fact scope', () => {
  const route = source('api/routes/objects.ts')

  assert.match(route, /async function listObjectSummaries\(type: ObjectType, scope: LocalFactScope\)/)
  assert.match(route, /listObjects\(type, undefined, undefined, scope\)/)
  assert.match(route, /status \? await listObjectSummaries\(type, factScope\) : items/)
})
