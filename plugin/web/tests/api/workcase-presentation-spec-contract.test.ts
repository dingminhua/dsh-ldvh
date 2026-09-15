// WorkCase 呈现契约（v5，21 号三态直读）——代码模块自洽断言。
//
// 本文件断言 WorkCase 呈现层的 v5 语义（specs/21 §9/§13 + WC-0002 呈现契约）：
//   1. 派生分组闭集与五档筛选词汇的唯一强来源是 shared/workcaseLifecycle.ts；
//   2. 「待批准关闭」派生判据 = open ∧ 正文含 H2「## 结果」节（ATX 容错、围栏忽略）；
//   3. ?progress= 废弃指向 ?lifecycle=；cancelled 不映射 v4 的 discarded 组；
//   4. v4 残留词汇（progress_group 五值/phase 八值/生成契约）不再存在于呈现链；
//   5. 词条（objectList.workcaseGroup.* / objectDetail.workcaseOutcome.*）中英齐备；
//   6. 事实投影不提供应用级刷新控件。
// 测试断言规格本身，不弱化断言凑绿；v4 五值组/四步轨迹断言已随 v4 投影器一起退役。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const WEB_DIR = path.resolve(import.meta.dirname, '../..');

function readWebSource(relativePath: string): string {
  const clean = relativePath.startsWith('web/') ? relativePath.slice('web/'.length) : relativePath;
  return fs.readFileSync(path.join(WEB_DIR, clean), 'utf8');
}

/** 从 workcaseLifecycle.ts 提取 as const 闭集（唯一强来源；单行或多行声明均可）。 */
function closedSetFrom(source: string, declaration: string): readonly string[] {
  const block = source.match(new RegExp(`${declaration} = \\[[\\s\\S]*?\\] as const`));
  assert.ok(block, `workcaseLifecycle.ts must declare ${declaration}`);
  return (block[0].match(/'([^']+)'/g) ?? []).map((token) => token.replace(/'/g, ''));
}

test('v5 statuses/outcomes/filter values are closed sets declared once in workcaseLifecycle.ts', () => {
  const lifecycle = readWebSource('shared/workcaseLifecycle.ts');
  assert.deepEqual(closedSetFrom(lifecycle, 'WORKCASE_V5_STATUSES'), ['draft', 'open', 'closed']);
  assert.deepEqual(closedSetFrom(lifecycle, 'WORKCASE_V5_OUTCOMES'), ['completed', 'partial', 'not-achieved', 'cancelled']);
  // 五档筛选（Human 2026-09-15 定案）：待批准执行/执行中/待批准关闭/已关闭/全部。
  assert.deepEqual(closedSetFrom(lifecycle, 'WORKCASE_V5_FILTER_VALUES'), ['pending_gate1', 'executing', 'awaiting_gate2', 'closed', 'all']);
  // 派生组 = 五档去 all 的四值（同文件声明；不再有独立五值 progress_group）。
  assert.match(lifecycle, /export type WorkCaseV5Group = 'pending_gate1' \| 'executing' \| 'awaiting_gate2' \| 'closed'/);
});

test('awaiting_gate2 derives from open ∧ body ## 结果 section — fences and deeper levels do not count', async () => {
  const lifecycle = await import('../../shared/workcaseLifecycle.ts');
  const fingerprint = 'a'.repeat(64);

  // open 无结果节 → executing
  assert.equal(lifecycle.deriveWorkCaseV5View('open', undefined, '## 摘要\n\n内容\n\n## 执行\n\n- 步骤\n', fingerprint).group, 'executing');
  // open ∧ 正文含 ## 结果 → awaiting_gate2（ATX 容错：缩进 ≤3、行尾空白）
  assert.equal(lifecycle.deriveWorkCaseV5View('open', undefined, '## 摘要\n\n## 结果\n\n- 草稿\n', fingerprint).group, 'awaiting_gate2');
  assert.equal(lifecycle.deriveWorkCaseV5View('open', undefined, '## 摘要\n\n   ## 结果 \t\n', fingerprint).group, 'awaiting_gate2');
  // 代码围栏内的 ## 结果不算（同类围栏才闭合）
  assert.equal(
    lifecycle.deriveWorkCaseV5View('open', undefined, '## 摘要\n\n```\n## 结果\n```\n', fingerprint).group,
    'executing',
  );
  // 更深层级（###）不算
  assert.equal(lifecycle.deriveWorkCaseV5View('open', undefined, '### 结果\n', fingerprint).group, 'executing');
  // draft/closed 不做结果节派生；C2 重批回 draft 同属 pending_gate1（都在等 Gate 1）
  assert.equal(lifecycle.deriveWorkCaseV5View('draft', undefined, '## 结果\n', fingerprint).group, 'pending_gate1');
  assert.equal(lifecycle.deriveWorkCaseV5View('closed', 'completed', '## 结果\n', fingerprint).group, 'closed');
  // 非法状态 unresolved（v4 blocked 亦然）；非法指纹降级 null 不影响 resolution
  assert.equal(lifecycle.deriveWorkCaseV5View('blocked', undefined, '', fingerprint).resolution, 'unresolved');
  const badFp = lifecycle.deriveWorkCaseV5View('open', undefined, '', 'not-hex');
  assert.equal(badFp.fingerprint, null);
  assert.equal(badFp.resolution, 'resolved');
});

test('?progress= is retired with a pointer to ?lifecycle=; cancelled never maps to discarded', () => {
  const objects = readWebSource('api/routes/objects.ts');
  // 废弃词汇直接 400 并指向新参数——不静默忽略。
  assert.match(objects, /\?progress=[\s\S]{0,80}?lifecycle=/);
  assert.match(objects, /lifecycleOptions/);
  assert.doesNotMatch(objects, /progressOptions/);
  // 三态直读列表组：不再有 cancelled→discarded 压缩（21 号无 discarded 组）。
  assert.doesNotMatch(objects, /=== 'cancelled'\) return 'discarded'/);
  assert.doesNotMatch(objects, /progress_group === 'termination_cleanup'/);
});

test('v4 projection vocabulary no longer exists in the WorkCase presentation chain', () => {
  assert.equal(fs.existsSync(path.join(WEB_DIR, 'shared/workcaseStatus.ts')), false, 'v4 投影器必须删除');
  assert.equal(fs.existsSync(path.join(WEB_DIR, 'shared/workcasePresentationContract.generated.ts')), false, 'v4 生成契约必须删除');
  for (const consumer of ['api/routes/objects.ts', 'api/routes/cognition.ts', 'api/services/facts.ts']) {
    const source = readWebSource(consumer);
    assert.doesNotMatch(source, /WORKCASE_PROGRESS_GROUP_ORDER|deriveWorkCasePresentationProjection|human_plan_confirming|closure_preparing/, `${consumer} 不再消费 v4 状态机`);
  }
});

test('workcaseGroup and workcaseOutcome labels exist in both locales', () => {
  const locales = readWebSource('src/i18n/locales.ts');
  for (const group of ['pending_gate1', 'executing', 'awaiting_gate2', 'closed', 'unknown']) {
    assert.match(locales, new RegExp(`'objectList\\.workcaseGroup\\.${group}'`), `missing group label ${group}`);
  }
  for (const outcome of ['completed', 'partial', 'not-achieved', 'cancelled']) {
    assert.match(locales, new RegExp(`'objectList\\.workcaseOutcome\\.${outcome}'`), `missing outcome label ${outcome}`);
    const detailKey = outcome === 'not-achieved' ? 'notAchieved' : outcome;
    assert.match(locales, new RegExp(`'objectDetail\\.workcaseOutcome\\.${detailKey}'`), `missing detail outcome label ${outcome}`);
  }
});

test('Fact projections provide no application-level refresh controls', () => {
  const objectList = readWebSource('src/pages/ObjectList.tsx');
  const objectDetail = readWebSource('src/pages/ObjectDetail.tsx');
  const cognitionCenter = readWebSource('src/pages/CognitionCenter.tsx');
  const panelContent = readWebSource('src/components/reading-panel/PanelContent.tsx');
  const refreshableSources = [objectList, objectDetail, cognitionCenter, panelContent].join('\n');
  assert.doesNotMatch(refreshableSources, /useManualFactRefresh|refreshFacts|RefreshCw|setInterval|visibilitychange|FACT_REFRESH_INTERVAL_MS/);
});
