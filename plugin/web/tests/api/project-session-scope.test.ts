import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PROJECT_URL_PARAM, resolveInitialProjectId } from '../../src/utils/projectSessionScope.ts'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const REGISTERED = ['alpha', 'beta', 'gamma']

test('参数命中登记列表时，会话项目压过记忆与默认', () => {
  assert.equal(
    resolveInitialProjectId({
      urlProjectId: 'beta',
      currentProjectId: 'alpha',
      defaultProjectId: 'gamma',
      registeredProjectIds: REGISTERED,
    }),
    'beta',
  )
})

test('参数是未登记 id 时逐字回退既有链，不给空页', () => {
  assert.equal(
    resolveInitialProjectId({
      urlProjectId: 'vanished',
      currentProjectId: 'alpha',
      defaultProjectId: 'gamma',
      registeredProjectIds: REGISTERED,
    }),
    'alpha',
    '非法参数不得清空选择，须落回记忆中的项目',
  )
  assert.equal(
    resolveInitialProjectId({
      urlProjectId: 'vanished',
      currentProjectId: '',
      defaultProjectId: 'gamma',
      registeredProjectIds: REGISTERED,
    }),
    'gamma',
    '无记忆时落回登记默认值',
  )
})

test('无参数时的选择链与改造前逐字同形（记忆 > 默认 > 首个）', () => {
  assert.equal(
    resolveInitialProjectId({ urlProjectId: '', currentProjectId: 'gamma', defaultProjectId: 'alpha', registeredProjectIds: REGISTERED }),
    'gamma',
  )
  assert.equal(
    resolveInitialProjectId({ urlProjectId: '', currentProjectId: 'deregistered', defaultProjectId: 'alpha', registeredProjectIds: REGISTERED }),
    'alpha',
  )
  assert.equal(
    resolveInitialProjectId({ urlProjectId: '', currentProjectId: '', defaultProjectId: '', registeredProjectIds: REGISTERED }),
    'alpha',
    '既无记忆也无默认时取首个登记项目',
  )
  assert.equal(
    resolveInitialProjectId({ urlProjectId: 'alpha', currentProjectId: '', defaultProjectId: '', registeredProjectIds: [] }),
    '',
  )
})

test('参数名与宿主插件半同源', () => {
  assert.equal(PROJECT_URL_PARAM, 'ldvhProject')
})

test('承载点确实接入：provider 读参数并交纯函数判定', () => {
  const context = read('src/utils/projectContext.tsx')
  assert.match(context, /resolveInitialProjectId\(/, 'provider 必须交纯函数判定，不再内联一条回退链')
  assert.match(context, /urlProjectId: seededId/, '参数值必须进入判定入参')
  assert.match(context, /urlSeedPending\.current/, '参数须由「只在首个载入」的记账闸把守')
  const app = read('src/App.tsx')
  assert.match(app, /projectId: selectedProjectId \|\| null/, '位置上报必须带路径归属项目')
})
