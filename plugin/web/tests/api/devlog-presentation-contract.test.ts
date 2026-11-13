import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { listObjects, showObject, ACTIVE_OBJECT_TYPES } from '../../api/services/facts.ts';
import {
  FACT_FIELD_CONTRACT,
  FACT_LIST_FIELD_NAMES,
  FACT_TERMINAL_STATUSES,
  FACT_TYPE_DIR_NAMES,
  FACT_TYPES,
} from '../../api/services/factFieldContract.ts';
import { FACT_TYPE_CARRIERS, FACT_TYPE_DIRS } from '../../api/services/localFactReader.ts';
import type { LocalFactScope } from '../../api/services/localFactReader.ts';

/**
 * DevLog（29 号）Web 接入契约（2026-11-02）。
 *
 * 本组既验**行为**（直读真的能读出 devlog 对象、压缩形态真的只带两段、正文不进
 * 列表载荷），也验**形态**（类型面登记齐、卡面读 `summary`、详情按阅读次序分节、
 * 侧栏排在对象族末位）。
 *
 * **保证边界**：行为断言只证明投影的**输出形状**；源码文本断言只证明**形态当前
 * 存在**，不证明交互在浏览器里成立（那属真实 UI 验收，`specs/10` §8）。本文件
 * 不证明一条 DevLog 的结论**正确**——那属语义核对（29 §14.1 已如实登记）。
 */

const UID = '44444444-4444-4444-8444-444444444444';
const ABSORBED_UID = '55555555-5555-4555-8555-555555555555';
const SUB_GOAL_UID = '66666666-6666-4666-8666-666666666666';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

/** active 形态：五段齐备（29 §8）。`summary` 逐字出现在「结论与边界」段（§8 不变量 1）。 */
function activeCarrier(uid: string, title: string, summary: string, serves?: string): string {
  return `---
title: ${title}
status: active
occurred_at: 2026-10-20T03:00:00.000Z
summary: ${summary}
${serves ? `serves: ${serves}\n` : ''}object_uid: ${uid}
fact_type_key: devlog
created_at: 2026-11-01T00:00:00.000Z
change_log:
  - at: 2026-11-01T00:00:00.000Z
    summary: 夹具
---

# ${title}

## 背景

夹具背景。

## 做法

夹具做法。

## 实测

夹具实测口径与数字。

## 结论与边界

${summary}

## 去向

未承接，仍承重。
`;
}

/** absorbed 压缩形态：仅「结论与边界」+「去向」两段（29 §9.1）。 */
function absorbedCarrier(uid: string, title: string, summary: string, commit: string): string {
  return `---
title: ${title}
status: absorbed
occurred_at: 2026-10-10T03:00:00.000Z
summary: ${summary}
relations:
  - relation_key: absorbed-into
    target:
      commit: ${commit}
object_uid: ${uid}
fact_type_key: devlog
created_at: 2026-11-01T00:00:00.000Z
change_log:
  - at: 2026-11-01T00:00:00.000Z
    summary: 夹具
---

# ${title}

## 结论与边界

${summary}

## 去向

已被受控提交承接。
`;
}

function subGoalCarrier(uid: string): string {
  return `---
title: 夹具子目标
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

# 夹具子目标

## 达成条件

判据一句话。

## 对齐说明

对齐说明一句话。
`;
}

async function writeFixture(root: string) {
  const dirs = ['devlogs', 'subgoals'] as const;
  for (const dir of dirs) await mkdir(path.join(root, 'ldvh-base', dir), { recursive: true });
  await writeFile(
    path.join(root, 'ldvh-base', 'devlogs', `devlog-${UID}.md`),
    activeCarrier(UID, '夹具日志一', '夹具结论一句话：在 A 条件下成立。', SUB_GOAL_UID),
    'utf8',
  );
  await writeFile(
    path.join(root, 'ldvh-base', 'devlogs', `devlog-${ABSORBED_UID}.md`),
    absorbedCarrier(ABSORBED_UID, '夹具日志二', '夹具结论二：已被提交承接。', 'a'.repeat(40)),
    'utf8',
  );
  await writeFile(
    path.join(root, 'ldvh-base', 'subgoals', `subgoal-${SUB_GOAL_UID}.md`),
    subGoalCarrier(SUB_GOAL_UID),
    'utf8',
  );
}

test('devlog 是第九个活跃事实类型，字段面与载体目录均已登记（29 §7/§8）', () => {
  assert.ok((ACTIVE_OBJECT_TYPES as readonly string[]).includes('devlog'), 'ACTIVE_OBJECT_TYPES 应含 devlog');
  assert.match(FACT_TYPES.join(','), /devlog/, 'FACT_TYPES 应含 devlog');

  // 载体：29 §7 明文 ldvh-base/devlogs/devlog-<uid>.md。
  assert.equal(FACT_TYPE_DIRS.devlog, 'devlogs', 'FACT_TYPE_DIRS 应登记 devlog → devlogs');
  assert.equal(FACT_TYPE_CARRIERS.devlog, '.md', 'FACT_TYPE_CARRIERS 应登记 devlog → .md');
  assert.equal(FACT_TYPE_DIR_NAMES.devlog, 'devlogs', 'FACT_TYPE_DIR_NAMES 应登记 devlog → devlogs');

  // 字段闭集（29 §8）：occurred_at / summary 必填，serves / disposition 条件出现，
  // 正文 report_body 由读取层承载。不采用 urls（§8）。
  // `refs` 于 2026-11-02 经 Human 决定并入 02 §8.2 采用面（29 §8/§11/§12.3bis）：
  // 条目侧登记自己与哪些事实对象有内容关联——两侧各自声明、互不复制反向边。
  const contract = FACT_FIELD_CONTRACT.devlog;
  for (const field of ['occurred_at', 'summary', 'serves', 'disposition', 'relations', 'refs']) {
    assert.ok(field in contract, `devlog 契约应登记 ${field}`);
  }
  assert.equal(contract.occurred_at.required, true, 'occurred_at 必填（29 §8）');
  assert.equal(contract.summary.required, true, 'summary 必填（29 §8）');
  assert.equal(contract.serves.required, false, 'serves 可选（29 §8）');
  assert.equal(contract.disposition.required, false, 'disposition 仅 dropped 必填（§8 不变量 3）');
  assert.equal('urls' in contract, false, '29 §8 明文不采用 urls');
  assert.equal(contract.refs.required, false, 'refs 可选（29 §8：没有关联时省略，空数组会伪造条件字段）');
  assert.equal(contract.refs.expected, 'array', 'refs 是 {object_uid} 数组（02 §8.2 关联引用型形态）');

  // 列表投影不携带正文（同其余 markdown 类型纪律）。
  assert.ok(!FACT_LIST_FIELD_NAMES.devlog.includes('report_body'), '列表不得携带 report_body');
  assert.ok(FACT_LIST_FIELD_NAMES.devlog.includes('summary'), '列表须携带 summary（卡面结论）');

  // 终态闭集（29 §9.2）：三值，均不可重开。
  assert.deepEqual([...FACT_TERMINAL_STATUSES.devlog].sort(), ['absorbed', 'dropped', 'superseded']);
});

test('devlog 可经 Web 字段级直读，压缩形态的正文只剩两段（29 §9.1）', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ldvh-devlog-'));
  const scope: LocalFactScope = { worktreeLocator: root, governedProjectId: 'fixture' };
  try {
    await writeFixture(root);

    const listed = await listObjects('devlog', undefined, undefined, scope);
    if (!listed.ok) throw new Error(listed.error);
    const items = (listed.data as { items: Array<Record<string, unknown>> }).items;
    assert.equal(items.length, 2, '两条夹具都应出现在列表里');

    const active = items.find((item) => item.object_uid === UID);
    assert.ok(active, 'active 条目应出现在列表里');
    assert.equal(active.occurred_at, '2026-10-20T03:00:00.000Z', '列表须携带 occurred_at（29 §10.4）');
    assert.equal(active.summary, '夹具结论一句话：在 A 条件下成立。', '列表须携带 summary');
    assert.equal(active.serves, SUB_GOAL_UID, '列表须携带 serves');
    // 载荷纪律：列表不带正文（否则列表会拖上整篇日志）。
    assert.equal('report_body' in active, false, '列表不得携带 report_body');

    const detail = await showObject(`devlog-${UID}`, scope);
    if (!detail.ok) throw new Error(detail.error);
    const body = (detail.data as { report_body?: string }).report_body ?? '';
    assert.match(body, /## 背景/, '详情应携带正文五段之一');
    assert.match(body, /## 结论与边界/, '详情应携带结论段');

    // 压缩形态：absorbed 只有两段（§9.1 机械可核形态）。
    const absorbedDetail = await showObject(`devlog-${ABSORBED_UID}`, scope);
    if (!absorbedDetail.ok) throw new Error(absorbedDetail.error);
    const absorbedBody = (absorbedDetail.data as { report_body?: string }).report_body ?? '';
    const absorbedHeadings = absorbedBody.match(/^##\s+(.+)$/gm) ?? [];
    assert.deepEqual(
      absorbedHeadings.map((line) => line.replace(/^##\s+/, '').trim()),
      ['结论与边界', '去向'],
      'absorbed 条目正文须只剩「结论与边界」与「去向」两段（29 §9.1）',
    );
    // 承接边是 commit 形态（§11），由既有 commit 投影呈现——不新写解析。
    const absorbedRelations = (absorbedDetail.data as { relations?: Array<Record<string, unknown>> }).relations ?? [];
    assert.equal(absorbedRelations.length, 1, 'absorbed 须恰有一条承接边');
    assert.equal(absorbedRelations[0].relation_key, 'absorbed-into');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('devlog 有独立的图标与类型色，前后端同值，且不与既有类型撞色', async () => {
  const icons = read('src/components/SemanticIcon.tsx');
  const colors = read('src/utils/categoryColors.ts');
  const typeColors = read('api/services/typeColors.ts');

  // 图标：NotebookPen——「已做过的事的记录」，不是「待处理」也不是「责任」。
  assert.match(icons, /devlog: NotebookPen,/);
  // 类型色两侧同值（漂移会让同一条日志在列表与联邦视图里换色）。
  assert.match(colors, /devlog: '#2c9e43'/);
  assert.match(typeColors, /devlog: '#2c9e43'/);

  // 不与既有**事实类型**撞色：色相距离是「读者能否靠颜色分辨类型」的机械代理。
  // 作用域刻意只取事实类型九类——`CATEGORY_COLORS` 里还混着 conventional commit
  // 的 scope 色与 Study 报告类型色，它们不同屏竞争同一判断，把它们算进来
  // 会得到一条与实际阅读无关的约束。
  const FACT_TYPE_COLORS = ['adr', 'pitfall', 'spark', 'research', 'friction', 'norm', 'goal', 'subgoal', 'devlog'];
  const { CATEGORY_COLORS } = await import('../../src/utils/categoryColors.ts');
  const toHue = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const devlogHue = toHue(CATEGORY_COLORS.devlog as string);
  for (const type of FACT_TYPE_COLORS) {
    if (type === 'devlog') continue;
    const hex = CATEGORY_COLORS[type];
    assert.ok(hex, `类型 ${type} 应有类型色`);
    const delta = Math.min(
      Math.abs(toHue(hex as string) - devlogHue),
      360 - Math.abs(toHue(hex as string) - devlogHue),
    );
    assert.ok(delta >= 20, `devlog 色相与 ${type} 相距仅 ${delta}°，读者无法靠颜色分辨`);
  }
});

test('侧栏把 devlog 排在全部事实对象之后（Human 定案 2026-11-02）', () => {
  const sidebar = read('src/components/Sidebar.tsx');

  // 单项目导航：devlog 在 norm 之后、project-files 之前。
  const navBlock = sidebar.slice(sidebar.indexOf('const NAV_ITEMS'), sidebar.indexOf('/** 联邦作用域导航'));
  const normIndex = navBlock.indexOf("labelKey: 'nav.norms'");
  const devlogIndex = navBlock.indexOf("labelKey: 'nav.devlogs'");
  const filesIndex = navBlock.indexOf("labelKey: 'nav.projectFiles'");
  assert.ok(normIndex > 0 && devlogIndex > 0 && filesIndex > 0, '三类入口都应存在');
  assert.ok(normIndex < devlogIndex, 'devlog 应排在 norm 之后');
  assert.ok(devlogIndex < filesIndex, 'devlog 应排在目录页之前（对象族之内）');
  // 它是对象族的**最后一项**：其后不得再有 /objects/ 入口。
  const afterDevlog = navBlock.slice(devlogIndex);
  assert.doesNotMatch(afterDevlog, /'\/objects\//, 'devlog 之后不得再有对象族入口');

  // 联邦导航同序（两处次序漂移会让同一入口在两个作用域里换位置）。
  const fedBlock = sidebar.slice(sidebar.indexOf('const FEDERATION_NAV_ITEMS'));
  const fedDevlogIndex = fedBlock.indexOf("labelKey: 'nav.devlogs'");
  assert.ok(fedDevlogIndex > 0, '联邦导航应含 devlog');
  assert.doesNotMatch(fedBlock.slice(fedDevlogIndex, fedBlock.indexOf("/project-files")), /'\/federation\/objects\//,
    '联邦导航里 devlog 也应是对象族最后一项');
});

test('卡面读 summary 而非标题（29 §8 明文 title 不承载结论）', () => {
  const objectList = read('src/pages/ObjectList.tsx');
  const card = objectList.slice(
    objectList.indexOf('export function DevLogCardContent'),
    objectList.indexOf('/** 29 号 §8 `summary`（当前语义快照）的卡面承载', objectList.indexOf('export function DevLogCardContent')) > 0
      ? objectList.indexOf('const SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT')
      : objectList.length,
  );
  assert.ok(card.length > 0, '应能定位 DevLogCardContent 源码段');
  assert.match(card, /obj\.summary/, '卡面须读 summary——title 不承载结论（29 §8）');
  assert.match(card, /<SummaryText/, '长结论按既有组件折叠，不自造截断');
  assert.doesNotMatch(card, /obj\.report_body/, '卡面不得读正文（正文属详情）');

  // 卡头：occurred_at 那枚 chip 已于 2026-11-02 二次定案撤除（Human 定案）。
  // 29 §10.4 同步订正：`occurred_at` 的回查职责由**按 `occurred_at` 排序的条目
  // 清单**承担（§12.1「时间线回查」），单个条目不必在自己的卡面上重复给出它
  // 已经记下的时间。守卫改向：断言「不再出现」而非「出现且排位正确」。
  assert.doesNotMatch(
    objectList,
    /DevLogOccurredBadge|obj\.type === 'devlog' && <DevLogOccurredBadge/,
    'devlog 卡头不得再出现 occurred_at 时间 chip（29 §10.4，2026-11-02 二次定案）',
  );
  assert.equal(
    fs.existsSync(path.resolve('src/components/DevLogOccurredBadge.tsx')),
    false,
    '徽章组件随其唯一消费方一起退场，不留无人消费的壳',
  );
  // 卡头段的右界取到「修改次数」那枚 chip 之后：只切到它的 `title=` 属性会把
  // 它自己排除在段外，`historyChip` 于是恒为 -1，断言变成一句永真的废话。
  const head = objectList.slice(
    objectList.indexOf('<PriorityIcon source={obj}'),
    objectList.indexOf('obj.sourceBranch &&'),
  );
  const historyChip = head.indexOf("title={t('cognition.recent.activityCount'");
  assert.ok(historyChip > 0, '卡头段应能定位到修改次数 chip');
  assert.doesNotMatch(head, /occurred_at/, '卡头段不得再读 occurred_at');

  // 列表分派与联邦分派都要有，否则该类型在任一视图里落成空卡。
  assert.match(objectList, /currentType === 'devlog'[\s\S]{0,200}<DevLogCardContent/);
  assert.match(read('src/pages/FederationObjects.tsx'), /currentType === 'devlog'\) return <DevLogCardContent/);
});

test('详情按阅读次序分节，且不再并排呈现两个时间（2026-11-02 定案）', () => {
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const layout = layouts.slice(layouts.indexOf('export function DevLogReadingLayout'));
  assert.ok(layout.length > 0, '应存在 DevLogReadingLayout');

  // 阅读次序：结论 → 去向 → 背景 → 做法 → 实测（书写次序仍是规范那五段）。
  const conclusionIndex = layout.indexOf("devlog_conclusion");
  const destinationIndex = layout.indexOf("devlog_destination");
  const backgroundIndex = layout.indexOf("devlog_background");
  const approachIndex = layout.indexOf("devlog_approach");
  const measurementsIndex = layout.indexOf("devlog_measurements");
  for (const [name, index] of Object.entries({
    conclusion: conclusionIndex,
    destination: destinationIndex,
    background: backgroundIndex,
    approach: approachIndex,
    measurements: measurementsIndex,
  })) {
    assert.ok(index > 0, `${name} 节点应存在`);
  }
  assert.ok(conclusionIndex < destinationIndex, '结论应排在去向之前');
  assert.ok(destinationIndex < backgroundIndex, '去向应排在背景之前（阅读次序，非书写次序）');
  assert.ok(backgroundIndex < approachIndex && approachIndex < measurementsIndex, '依据三段保持书写次序');

  // **2026-11-02 Human 定案「圈出来的部分不用显示」**：详情页的「时间轴节点」
  // 整块撤除，此守卫随之**改向**（不是删除）——从「断言两时间并排呈现」改为
  // 「断言并排呈现不得回归」，与 `parent_goal` 撤呈现的处置同一纪律：撤呈现必须
  // 留下挡回潮的守卫，否则下一次改动可以无声地把它加回来。
  //
  // 撤除的**不是**字段：29 §10.4 的语义分工仍成立（不得用 `created_at` 冒充
  // 发生时间），`occurred_at` 仍在**列表卡头**呈现（`DevLogOccurredBadge`，见本
  // 文件上一条 test），`created_at` 仍由 change_log 条目与底部 YAML 原文承载。
  assert.doesNotMatch(layout, /devlog_occurred_at/, '字段标签词条已删除，布局不得再取用');
  assert.doesNotMatch(layout, /devlog_created_at/, '字段标签词条已删除，布局不得再取用');
  assert.doesNotMatch(layout, /objectList\.devlogNoTopic/, '空集提示已删除，布局不得再取用');
  // 整块撤除后 `DECISION_DETAIL_NEUTRAL_SHELL_CLASS` 与 `DECISION_TITLE_HUE_CLASS.lime`
  // 双双失去最后消费方，故该文件**不得再导入** decisionBlocks（否则是留着的死壳）。
  assert.doesNotMatch(layout, /DECISION_DETAIL_NEUTRAL_SHELL_CLASS/);
  assert.doesNotMatch(layout, /DECISION_TITLE_HUE_CLASS/);
  assert.doesNotMatch(
    layouts,
    /from '@\/utils\/decisionBlocks'/,
    'FactReadingLayouts 已无 decisionBlocks 消费方，不得保留导入',
  );

  // 压缩形态显式说明，不静默少三段（§9.1）——仍须保留。
  assert.match(layout, /objectList\.devlogCompressedBody/);
  // 承接/推翻边经关联区呈现（§11）——不自建第二套解析。
  assert.match(layout, /<FactAssociationsSection/, '承接边须经既有关系区呈现');

  // 详情分派仍要走专属布局。
  assert.match(read('src/pages/ObjectDetail.tsx'), /objType === 'devlog'[\s\S]{0,120}<DevLogReadingLayout/);
  // 兜底字段排序表**不得**再把两个时间登记为「有呈现面」的字段。
  const model = read('src/pages/object-detail/model.ts');
  const devlogStart = model.indexOf('devlog: [');
  const devlogTable = model.slice(devlogStart, model.indexOf(']', devlogStart));
  assert.ok(devlogStart > 0 && devlogTable.length > 0, '应存在 devlog 兜底排序表');
  assert.doesNotMatch(devlogTable, /'occurred_at'/, 'occurred_at 不再登记（详情不呈现，卡头另走徽章）');
  assert.doesNotMatch(devlogTable, /'created_at'/, 'created_at 不再登记（由 change_log 与 YAML 原文承载）');
});

test('压缩形态的文案把话说完整，已撤除的空集文案不得回归', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  // §9.1：压缩说明必须点出「两段」这个具体形态。
  assert.match(UI_LOCALES.zh['objectList.devlogCompressedBody'], /结论与边界/);
  assert.match(UI_LOCALES.zh['objectList.devlogCompressedBody'], /去向/);
  // 2026-11-02 定案：空集提示与两时间行整块撤除，其词条不得回潮。
  // 撤除依据见 29 §8.1/§14.1 的同步修订——不是「文案不好」，而是 `serves` 自
  // 2026-11-01 起已不在本类型任何呈现面出现（§12.1），空集提示成了对一个不呈现
  // 字段的推断。**`serves` 字段本身未撤销**，非呈现消费方照旧。
  // 2026-11-02 二次定案：列表卡头的 occurred_at 徽章也撤除，其两条文案随之
  // 无消费方——`occurred_at` 的回查职责改由**按 `occurred_at` 排序的条目清单**
  // 承担（29 §12.1「时间线回查」），词条不得回潮。
  for (const key of [
    'objectList.devlogNoTopic',
    'devlog_occurred_at',
    'devlog_created_at',
    'objectList.devlogOccurredLabel',
    'objectList.devlogOccurredAbsent',
  ]) {
    assert.ok(
      !(key in UI_LOCALES.zh) && !(key in UI_LOCALES.en),
      `${key} 已随详情时间轴块与卡头徽章的撤除而删除，不得回潮`,
    );
  }
});
