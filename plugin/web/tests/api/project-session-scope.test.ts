// 会话跟随的项目选择（07 §7，Human 裁定 2026-10-29）。
//
// 起因：LDVH 页面选中的项目只看 localStorage 与登记默认值，与「当前会话属于哪个
// 项目」无关。多项目并行时人在 A 项目的会话里打开页面，看到的却是上次停留的 B
// 项目——要来回手切，且切错就读到别的项目的事实。
//
// 治本把判据收成一个无 DOM 的纯函数（resolveInitialProjectId），宿主插件半经
// 管辖判定的唯一入口取回项目 id 后以 ?ldvhProject= 带进 iframe 地址。本工件钉两件事：
//   ① 该纯函数的逐态判定（参数命中 / 未命中回退 / 无参数沿用既有链）；
//   ② 各承载点**确实在用它**（源码级断言）——只测行为不测调用链，漏接一处仍全绿。
// iframe 地址拼装那一侧（同项目不换页、跨项目回首页）见 plugin/test/
// client-session-follow.test.mjs，那里在 vm 里真实执行组件并断言渲染出的 src。
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
  // 项目取消登记、参数被手改坏都属此态：回落顺序与改造前一致。
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
  // 一个都没登记：回空串，由页面既有空态承接（不是新增行为）。
  assert.equal(
    resolveInitialProjectId({ urlProjectId: 'alpha', currentProjectId: '', defaultProjectId: '', registeredProjectIds: [] }),
    '',
  )
})

test('参数名与宿主插件半同源', () => {
  // 两处各写一份字面量就会漂移：宿主拼的地址 Web 读不到，跟随静默失效。
  // 本侧只钉住自己的常量；对侧（宿主拼地址那一侧）由 plugin/test/
  // client-session-follow.test.mjs 的「同源」用例钉住——那一侧才是 URL 的组装方。
  assert.equal(PROJECT_URL_PARAM, 'ldvhProject')
})

test('承载点确实接入：provider 读参数并交纯函数判定', () => {
  const context = read('src/utils/projectContext.tsx')
  assert.match(context, /resolveInitialProjectId\(/, 'provider 必须交纯函数判定，不再内联一条回退链')
  assert.match(context, /urlProjectId: seededId/, '参数值必须进入判定入参')
  // 只在首个载入读参数：否则每次刷新都把用户刚手选的项目压回去。
  assert.match(context, /urlSeedPending\.current/, '参数须由「只在首个载入」的记账闸把守')
  // 路径归属要上报给宿主（否则跨项目时会带着旧项目的深链接开新项目，落进「对象不存在」）。
  const app = read('src/App.tsx')
  assert.match(app, /projectId: selectedProjectId \|\| null/, '位置上报必须带路径归属项目')
})
