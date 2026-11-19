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

  assert.match(filter, /pitfall: \['active', 'discarded'\]/)
  assert.match(filter, /research: \['active', 'retired'\]/)
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
  assert.match(colors, /implemented: \{ light: '#059669', dark: '#00d4aa' \}/)
  assert.match(colors, /closed: \{ light: '#64748b', dark: '#94a3b8' \}/)
  assert.match(locales, /pitfall: \{[\s\S]*active: \{ zh: '活跃', en: 'Active' \}/)
})

test('Spark list carries priority and serves filters', () => {
  const list = source('src/pages/ObjectList.tsx')
  const route = source('api/routes/objects.ts')

  assert.doesNotMatch(list, /objectList\.lifecycleFilter/)
  assert.match(list, /ObjectPriorityFilter/)
  assert.match(list, /ObjectServesFilter/)
  assert.match(list, /const supportsPriorityNavigation = currentType === 'spark'/)
  assert.match(list, /const supportsServesNavigation = currentType === 'spark'/)
  assert.match(list, /activePriority/)
  assert.match(list, /activeServes/)
  assert.match(route, /function getSparkPriorityOptions/)
  assert.match(route, /function getSparkServesOptions/)
  assert.match(route, /servesOptions/)
  assert.match(route, /const priority = type === 'spark' && typeof req\.query\.priority === 'string'/)
  assert.match(route, /const serves = type === 'spark' && typeof req\.query\.serves === 'string'/)
  assert.match(
    list,
    /fetchObjects\(currentType, activeStatus \?\? undefined, undefined, activePriority \?\? undefined, activeForm \?\? undefined, activeServes \?\? undefined\)/,
  )
  assert.doesNotMatch(list, /const fetchStatus = currentType === 'spark'/)
  assert.doesNotMatch(route, /matchesSparkListFilter|getSparkStatusOptions|getSparkImplementedPresentationStatus/)
})

test('filtered lifecycle counts reuse the request fact scope', () => {
  const route = source('api/routes/objects.ts')

  assert.match(route, /async function listObjectSummaries\(type: ObjectType, scope: LocalFactScope\)/)
  assert.match(route, /listObjects\(type, undefined, undefined, scope\)/)
  assert.match(route, /status \? await listObjectSummaries\(type, factScope\) : items/)
})
