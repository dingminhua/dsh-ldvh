import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listObjects, showObject } from '../../api/services/facts.ts';
import type { LocalFactScope } from '../../api/services/localFactReader.ts';

/**
 * 子目标卡「名下的工作」关联区（Human 决定 2026-11-02）。
 *
 * 该区学习的不是 Spark 卡的**样式细节**，而是它的**判据链**：关联一律由
 * `refs`/`serves` 这类**已声明的引用**派生、以统一关联行呈现。故本组既验行为
 * （投影真的按 uid 归组、空集与读不到分列），也验形态（分层、先展 3 条、可展开）。
 *
 * **保证边界**：行为断言只证明投影的**输出形状**；源码文本断言只证明**形态当前
 * 存在**，不证明交互在浏览器里成立（那属真实 UI 验收，`specs/10` §8）。
 */

const SUB_GOAL_UID = '11111111-1111-4111-8111-111111111111';
const OTHER_SUB_GOAL_UID = '22222222-2222-4222-8222-222222222222';
/** 名下确实没有任何 `serves` 指向的子目标——空集歧义那一态。 */
const EMPTY_SUB_GOAL_UID = '33333333-3333-4333-8333-333333333333';

function subGoalCarrier(uid: string, title: string): string {
  return `---
title: ${title}
status: active
parent_goal: project-goal
criterion: 判据一句话。
criterion_kind: executable-check
alignment: 对齐说明一句话。
object_uid: ${uid}
fact_type_key: subgoal
created_at: 2026-11-01T00:00:00.000Z
change_log:
  - at: 2026-11-01T00:00:00.000Z
    summary: 夹具
---

# ${title}

## 达成条件

判据一句话。

## 对齐说明

对齐说明一句话。
`;
}

function sparkCarrier(uid: string, title: string, status: string, serves: string): string {
  return `---
title: ${title}
status: ${status}
question: 问句？
scope_boundary: 边界。
intent: 意图。
summary: 当前理解一句话。
serves: ${serves}
object_uid: ${uid}
fact_type_key: spark
created_at: 2026-10-01T00:00:00.000Z
change_log:
  - at: 2026-10-01T00:00:00.000Z
    summary: 夹具
---

# ${title}

## 当前理解

当前理解一句话。
`;
}

function workCaseCarrier(uid: string, title: string, status: string, serves: string): string {
  const gates = status === 'closed'
    ? `outcome: completed
result:
  criteria_checks:
    - satisfied: true
      evidence: 夹具证据。
  achieved_scope: 夹具范围。
`
    : '';
  return `---
title: ${title}
status: ${status}
gist: 夹具要点。
summary: 要做的事。
scope: 做什么：夹具。
plan:
  - step: 步骤一
    done_criteria: 判据一
serves: ${serves}
${gates}object_uid: ${uid}
fact_type_key: workcase
created_at: 2026-10-01T00:00:00.000Z
change_log:
  - at: 2026-10-01T00:00:00.000Z
    summary: 夹具
---

# ${title}
`;
}

async function writeFixture(root: string) {
  const dirs = ['subgoals', 'sparks', 'workcases'] as const;
  for (const dir of dirs) await mkdir(path.join(root, 'ldvh-base', dir), { recursive: true });
  await writeFile(
    path.join(root, 'ldvh-base', 'subgoals', `subgoal-${SUB_GOAL_UID}.md`),
    subGoalCarrier(SUB_GOAL_UID, '夹具子目标'),
    'utf8',
  );
  await writeFile(
    path.join(root, 'ldvh-base', 'subgoals', `subgoal-${OTHER_SUB_GOAL_UID}.md`),
    subGoalCarrier(OTHER_SUB_GOAL_UID, '只有一条火花的子目标'),
    'utf8',
  );
  await writeFile(
    path.join(root, 'ldvh-base', 'subgoals', `subgoal-${EMPTY_SUB_GOAL_UID}.md`),
    subGoalCarrier(EMPTY_SUB_GOAL_UID, '名下空空的子目标'),
    'utf8',
  );
  await writeFile(
    path.join(root, 'ldvh-base', 'sparks', 'spark-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.md'),
    sparkCarrier('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '火花一', 'open', SUB_GOAL_UID),
    'utf8',
  );
  await writeFile(
    path.join(root, 'ldvh-base', 'sparks', 'spark-bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb.md'),
    sparkCarrier('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', '火花二', 'implemented', SUB_GOAL_UID),
    'utf8',
  );
  await writeFile(
    path.join(root, 'ldvh-base', 'workcases', 'workcase-cccccccc-1111-4111-8111-cccccccccccc.md'),
    workCaseCarrier('cccccccc-1111-4111-8111-cccccccccccc', '工单一', 'open', SUB_GOAL_UID),
    'utf8',
  );
  // 指向另一条子目标的火花：不得串到本条子目标名下。
  await writeFile(
    path.join(root, 'ldvh-base', 'sparks', 'spark-dddddddd-1111-4111-8111-dddddddddddd.md'),
    sparkCarrier('dddddddd-1111-4111-8111-dddddddddddd', '火花三', 'open', OTHER_SUB_GOAL_UID),
    'utf8',
  );
}

test('子目标列表项携带名下工作，并按 object_uid 精确归组（28 §8.1 + §12.3）', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-subgoal-serving-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    await writeFixture(root);
    const listed = await listObjects('subgoal', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    const items = (listed.data as { items: Array<Record<string, unknown>> }).items;

    const target = items.find((item) => item.object_uid === SUB_GOAL_UID);
    assert.ok(target, '子目标应出现在列表里');
    const serving = target.serving_work as Array<Record<string, unknown>>;
    assert.equal(Array.isArray(serving), true);

    // 精确相等归组：只收 serves === 本 uid 的两条火花 + 一条工单。
    assert.deepEqual(
      serving.map((row) => row.type).sort(),
      ['spark', 'spark', 'workcase'],
      '只收 serves 指向本条子目标的条目',
    );
    // 另一条子目标的对象不得串入。
    assert.equal(serving.some((row) => row.title === '火花三'), false, '不得串到其它子目标的名下');

    // workcase 行携带 21 号派生分组（呈现层据此判行末状态图标，不重算）。
    const workCaseRow = serving.find((row) => row.type === 'workcase');
    assert.ok(workCaseRow, '应有一行工单');
    assert.equal(workCaseRow.group, 'executing', 'open 且无结果节的工单派生为 executing');

    // 列表携带行但**不携带正文**：载荷纪律不因新增派生视图而破。
    assert.equal('report_body' in target, false, '列表项不得携带 report_body');

    // 空集是可区分的一态，不是 0 条静默。
    const empty = items.find((item) => item.object_uid === EMPTY_SUB_GOAL_UID);
    assert.ok(empty, '另一条子目标也应列出');
    assert.deepEqual(empty.serving_work, []);
    assert.equal(empty.serving_empty, true, '空集须显式标记（28 §8.1）');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('列表与详情得到同一份名下工作（两层阅读器同一判据）', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-subgoal-serving-parity-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    await writeFixture(root);
    const listed = await listObjects('subgoal', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    const item = (listed.data as { items: Array<Record<string, unknown>> }).items
      .find((entry) => entry.object_uid === SUB_GOAL_UID);
    assert.ok(item, '子目标应出现在列表里');

    const detail = await showObject(`subgoal-${SUB_GOAL_UID}`, scope);
    if (!detail.ok) throw new Error(detail.error);
    const detailRows = detail.data.serving_work as Array<Record<string, unknown>>;

    // 两层必须给出同一批行（顺序不计——派生源相同即集合相同）。
    const key = (row: Record<string, unknown>) => `${row.type}:${row.id}`;
    assert.deepEqual(
      [...(item.serving_work as Array<Record<string, unknown>>)].map(key).sort(),
      detailRows.map(key).sort(),
      '列表与详情的名下工作必须是同一集合（同一判据，不得两处各算一套）',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('卡面：按类型分层、每层先展固定条数、其余可展开（Human 决定 2026-11-02）', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');

  // 分层与预算：两个常量都必须存在且被真实消费（不是只声明）。
  assert.match(source, /export const SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT = 3;/, '每层先展 3 条须为具名常量');
  assert.match(source, /SUB_GOAL_SERVING_TYPE_ORDER: readonly string\[\] = \['workcase', 'spark'\]/);
  assert.match(source, /group\.rows\.slice\(0, SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT\)/, '折叠态按预算截取');
  assert.match(source, /const visible = expanded \? group\.rows :/, '展开态给全量（不是另一批）');
  assert.match(source, /Math\.max\(0, group\.rows\.length - SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT\)/, '其余条数由总数减预算得出');

  // 行式与区域形态复用既有单点，不得自建第二套（10 §5.5）。
  assert.match(source, /function SubGoalServingWorkCardZone/);
  assert.match(source, /<FactAssociationCardRow/);
  assert.match(source, /FACT_ASSOCIATION_ROWS_ZONE_CLASS/);
  assert.match(source, /FACT_ASSOCIATION_ROWS_LIST_CLASS/);
  assert.doesNotMatch(source, /function SubGoalServingWorkRow/, '不得自建第二套关联行');

  // **不设层名**（Human 定案 2026-11-02 圈掉「火花 2」「工单 25」两行）：行由行首类型
  // 图标自描述，再写一遍类型名是同一信息的第二次呈现。分组仍在（各有 divide-y 与各自
  // 展开按钮），只是不给块起名——`docs/03` §3.2「不设类型分组标题」由此保持成立。
  assert.match(source, /data-subgoal-serving-type=\{group\.type\}/, '分组承载仍须存在');
  const zoneSource = source.slice(
    source.indexOf('function SubGoalServingWorkCardZone'),
    source.indexOf('export function SubGoalCardContent'),
  );
  assert.doesNotMatch(zoneSource, /getTypeLabel\(group\.type/, '本区不得再渲染类型名（层名已撤）');
  assert.doesNotMatch(zoneSource, /<ObjectTypeIcon type=\{group\.type\}/, '本区不得再渲染层名的类型图标');

  // 三条语义边界：空集歧义、读不到单列、达成不由工单推出（28 §8.1 / §18 红线 3）。
  assert.match(source, /objectList\.subGoalServingEmpty/);
  assert.match(source, /objectList\.subGoalServingUnreadable/);
  assert.match(source, /objectList\.subGoalAchievedNote/);
});

test('空集文案点明「不是进度 0%」（28 §8.1 的歧义不可折算）', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  const zh = UI_LOCALES.zh['objectList.subGoalServingEmpty'];
  const en = UI_LOCALES.en['objectList.subGoalServingEmpty'];
  assert.match(zh, /未声明或未拆解/);
  assert.match(zh, /不是进度 0%/);
  assert.match(en, /Not declared or not decomposed/);
  assert.match(en, /not 0% progress/);
});

test('展开/收起是按钮而非死文本（键盘可达、状态可读）', () => {
  const source = fs.readFileSync(path.resolve('src/pages/ObjectList.tsx'), 'utf8');
  const zone = source.slice(
    source.indexOf('function SubGoalServingWorkCardZone'),
    source.indexOf('export function SubGoalCardContent'),
  );
  assert.ok(zone.length > 0, '应能定位到关联区源码段');
  assert.match(zone, /<button/, '展开/收起须是按钮');
  assert.match(zone, /aria-expanded=\{expanded\}/, '展开态须对读屏可读');
  assert.match(zone, /type="button"/, '不得隐式提交');
});
