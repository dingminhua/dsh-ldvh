// 决定 A 与条件豁免的**呈现层**契约（`10 §5.5`，Human 裁定 2026-09-28）。
//
// 本节登记 2026-09-28 二次修订在呈现层的落点，分两部分：
//
//  ① **纯函数**（`@/utils/workcaseCheckState`）——把「解析结果 → 渲染行」这一步抽成
//     可断言的行为。为什么必须抽出来：组件的 JSX **不在 `node:test` 的可达范围内**
//     （本仓已有先例注释：枚举→状态的映射曾内联在组件里，把枚举误喂给按中文词判定的
//     入口时整卡落成「未记录」，而 340 项测试全绿）。故凡是能影响读者看到什么的映射，
//     都必须有一个能被直接调用的入口。
//
//  ② **源码形态断言**（组件/布局文件）——组件层能测的只有形态。本仓既有大量同类守卫
//     （`workcase-design-language-contract.test.ts`），其已登记的边界同样适用于本文件：
//     **只拦形态、不拦语义**——一个功能等价但改名改文案的越界实现可以在本文件全绿时
//     被引入。故本文件的真实作用是「防止已知形态被误删/被随手复原」，不是「保证 A 与
//     豁免在任意实现下都成立」。
//
// 判据的权威：`10 §5.5`（呈现契约）与 `21 §8`/`§10.2`/`§15.3`（类型语义）。本节不
// 重定义任何语义，只固定呈现接线。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  WORKCASE_COLLAPSED_RESIDUAL,
  WORKCASE_DIRECTION_ROW_CLASS,
  groupDirectionRows,
  workCaseDirectionRows,
  workCaseResidualRows,
} from '../../src/utils/workcaseCheckState.ts';

/**
 * 源码根（`tests/api` → `web/tests/api` → `web/tests` → `web` → `plugin`）。
 *
 * 与 `workcase-design-language-contract.test.ts` 同一取法：根取到 **`plugin/`**，
 * 故路径一律以 `web/...` 起头（例如 `web/src/utils/workcaseCheckState.ts`）。
 */
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

const CLOSED_CARD = 'web/src/components/WorkCaseClosedSummary.tsx';
const DRAFT_CARD = 'web/src/components/WorkCaseResultDraft.tsx';
const DETAIL_LAYOUT = 'web/src/pages/object-detail/WorkCaseReadingLayout.tsx';
const STATE_MODULE = 'web/src/utils/workcaseCheckState.ts';

// ─────────────────────────────────────────────────────────────────────────────
// ① 纯函数：渲染行
// ─────────────────────────────────────────────────────────────────────────────

test('workCaseResidualRows：合并式按主从结构产出，去向挂在各自残留上', () => {
  const rows = workCaseResidualRows(
    [
      { text: '残留 A', directions: [{ kind: '接受现状', text: '原因甲。' }] },
      { text: '残留 B', directions: [{ kind: '转入 Spark', text: '转入议题待裁。' }] },
    ],
    undefined,
  );
  assert.deepEqual(rows, [
    { text: '残留 A', directions: [{ kind: '接受现状', text: '原因甲。' }] },
    { text: '残留 B', directions: [{ kind: '转入 Spark', text: '转入议题待裁。' }] },
  ]);
});

test('workCaseResidualRows：合并式缺席时回落到平铺文本（分离式/字段权威），不拼接', () => {
  // 「已关闭」期传 `result.residual` 字段（残留正文的权威）+ 正文解析出的 entries
  // （用来给每条挂上去向）。同一对象只有一种形态（§15.3），故**不得拼接**——
  // 拼接会制造同一条残留的两处出现。
  const rows = workCaseResidualRows(undefined, ['字段残留一', '字段残留二']);
  assert.deepEqual(rows, [
    { text: '字段残留一', directions: [] },
    { text: '字段残留二', directions: [] },
  ]);

  // 合并式在场时**忽略**平铺文本（不叠加）。
  const both = workCaseResidualRows(
    [{ text: '合并式残留', directions: [] }],
    ['字段残留'],
  );
  assert.deepEqual(both, [{ text: '合并式残留', directions: [] }], '合并式在场时不得再叠加字段文本');
});

test('workCaseResidualRows / workCaseDirectionRows：非数组、空值、空文本一律不产出伪条目', () => {
  for (const input of [undefined, null, 'x', 42, {}] as unknown[]) {
    assert.deepEqual(workCaseResidualRows(input, input), [], `${JSON.stringify(input)} 不得产出条目`);
    assert.deepEqual(workCaseDirectionRows(input), [], `${JSON.stringify(input)} 不得产出条目`);
  }
  // 空文本条目被跳过（不产出空行——空行在卡上是「无信息的行」，比缺失更差）。
  assert.deepEqual(workCaseDirectionRows([{ kind: '接受现状', text: '' }]), []);
  assert.deepEqual(workCaseResidualRows([{ text: '', directions: [] }], []), []);
  // 判不出词的条目**照样产出**（kind: null → 呈现为「未归类」）——这是
  // `21 §15.1` 判据边界第三条「不静默丢弃」在呈现层的落点。
  assert.deepEqual(workCaseDirectionRows([{ kind: null, text: '正文' }]), [{ kind: null, text: '正文' }]);
});

// ─────────────────────────────────────────────────────────────────────────────
// ①' 纯函数：去向分区（2026-09-30，Human：「接受现状提出来变成一个 title，下面不再
//     重复」+「接受现状和转入 Spark 要 2 个区域」——已关闭卡的去向按去向词分区）
// ─────────────────────────────────────────────────────────────────────────────

test('groupDirectionRows：按词稳定分区，组按首次出现顺序、组内保持原顺序', () => {
  const rows = workCaseDirectionRows([
    { kind: '接受现状', text: '一' },
    { kind: '转入 Spark', text: '二' },
    { kind: '接受现状', text: '三' },
    { kind: '接受现状', text: '四' },
    { kind: null, text: '五' },
    { kind: '转入 Spark', text: '六' },
  ]);
  const groups = groupDirectionRows(rows);
  // 组按首次出现顺序（不是闭集顺序）：第一组是「接受现状」（首条出现的词），
  // 「未归类」自成一组且不并入任何已知词——`21 §15.1` 呈现层不替作者修正形态。
  assert.deepEqual(
    groups.map((g) => [g.kind, g.rows.map((r) => r.text)]),
    [
      ['接受现状', ['一', '三', '四']],
      ['转入 Spark', ['二', '六']],
      [null, ['五']],
    ],
  );
  // 条目数守恒：分区只是去重「词的重复」，不丢条目（信息未增未减的机械面）。
  assert.equal(groups.reduce((sum, g) => sum + g.rows.length, 0), 6);
});

test('groupDirectionRows：空输入与空行产出零组；判不出词者保持独立组', () => {
  assert.deepEqual(groupDirectionRows([]), []);
  // 全部条目判不出词 → 一个 `null` 组（呈现为「未归类」分区，不静默丢弃）。
  assert.deepEqual(groupDirectionRows([{ kind: null, text: 'A' }, { kind: null, text: 'B' }]), [
    { kind: null, rows: [{ kind: null, text: 'A' }, { kind: null, text: 'B' }] },
  ]);
});

test('单一来源：去向分区的形态常量都在共享模块登记（分区行/分区标题/分区块）', () => {
  // 分区形态的四个常量（行/标题/块底/块底色表）只允许在共享模块出现一次；
  // 卡组件不得自抄字面量——否则与折叠阈值、从属行样式同理，必然分岔。
  const stateModule = readSource(STATE_MODULE);
  for (const constant of [
    'WORKCASE_DIRECTION_GROUP_ROW_CLASS',
    'WORKCASE_DIRECTION_TITLE_ROW_CLASS',
    'WORKCASE_DIRECTION_TITLE_CLASS',
    'WORKCASE_DIRECTION_BLOCK_BASE_CLASS',
    'WORKCASE_DIRECTION_BLOCK_BG_CLASS',
  ]) {
    assert.match(stateModule, new RegExp(`export const ${constant}`), `${constant} 须在共享模块登记`);
  }
});

test('已关闭卡：去向按去向词分区渲染（块级锚点 + 组内条目不带重复词）', () => {
  const closed = readSource(CLOSED_CARD);
  const code = closed
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');

  // ① 接线：分区由共享纯函数给出，块级锚点随分区渲染（每个去向词一个块）。
  assert.match(code, /groupDirectionRows\(advice\)/, '分区须由共享纯函数给出（JSX 外可断言）');
  assert.match(code, /data-workcase-advice-group=/, '分区块须带 data-workcase-advice-group 锚点');
  // ② 组内条目**不带去向词标记**（词已提到块首，组内不再重复）。
  //    判据：逐条渲染处不再调 workCaseAdviceTagClass（只剩块首标题调它一次）。
  const tagCalls = (code.match(/workCaseAdviceTagClass\(/g) ?? []).length;
  assert.equal(tagCalls, 1, `去向标记只在分区标题取色一次，实际 ${tagCalls} 次（组内不得重复带词）`);
  // ③ **不写字数/条数**（Human 2026-09-30「总数不用写」）：分区标题行不带计数插值。
  assert.doesNotMatch(code, /group\.rows\.length/, '分区标题不得报条数（Human：总数不用写）');
  // ④ 组内条目行首有项目符号（Human 2026-09-30「每一条缺少一个点号」→「位置调整一下」）。
  //    **2026-09-30 修订**：符号的形态类与摆放类都收敛到共享常量（间距/垂直位置各由一处
  //    决定，避免「gap 与 margin 叠加」「符号偏高」两个实测偏差复发），故此处断言
  //    **组件消费共享常量**，而不是断言组件内联类名（后者会逼实现把样式抄回组件）。
  assert.match(code, /WORKCASE_DIRECTION_ROW_BULLET_CLASS/, '组内条目行首须用共享的项目符号类');
  assert.match(code, /WORKCASE_DIRECTION_ROW_INSET_CLASS/, '项目符号的容器留白须用共享常量');
  assert.match(code, /aria-hidden="true"/, '项目符号是纯装饰，须 aria-hidden');
  const stateModuleForBullet = readSource(STATE_MODULE);
  assert.match(
    stateModuleForBullet,
    /export const WORKCASE_DIRECTION_ROW_BULLET_CLASS/,
    '项目符号类须在共享模块登记',
  );
  const bulletClass = stateModuleForBullet.slice(
    stateModuleForBullet.indexOf('export const WORKCASE_DIRECTION_ROW_BULLET_CLASS'),
    stateModuleForBullet.indexOf('export const WORKCASE_DIRECTION_ROW_INSET_CLASS'),
  );
  assert.match(bulletClass, /rounded-full/, '符号须为圆点（Human 裁定「点号」）');
  assert.match(bulletClass, /absolute/, '符号须绝对定位（间距与垂直位置各由一处决定）');
  assert.match(
    stateModuleForBullet,
    /export const WORKCASE_DIRECTION_ROW_INSET_CLASS\s*=\s*'relative pl-3'/,
    '容器须为绝对定位的符号留出左侧空间（relative pl-3，单点登记）',
  );

  // ⑤ 去向正文用**次级色**（Human 2026-09-30：「字的颜色也调整的淡一点」）。
  //    判据取自 `ldvh-caption`（其自身即 `text-ldvh-text-secondary`）——本行**不得**
  //    再叠 `text-ldvh-text-primary` 把正文压回最深档。
  //
  //    为什么必须钉住：本条是纯视觉偏好，2026-09-30 实测「把 primary 叠回去」这一
  //    变异**全套 428 用例无一变红**（守卫缺口实测发现）。去向正文是说明性文字、
  //    与块首标题同级重会削弱分组层次，故按 Human 裁定登记为形态要求。
  const groupRowClass = stateModuleForBullet.slice(
    stateModuleForBullet.indexOf('export const WORKCASE_DIRECTION_GROUP_ROW_CLASS'),
    stateModuleForBullet.indexOf('export const WORKCASE_DIRECTION_ROW_BULLET_CLASS'),
  );
  assert.match(groupRowClass, /ldvh-caption/, '正文行须沿用 caption 的次级字色基准');
  assert.doesNotMatch(
    groupRowClass,
    /text-ldvh-text-primary/,
    '去向正文不得叠最深档字色（Human 裁定「淡一点」；叠回即变红）',
  );
});

test('单一来源：折叠阈值只有一处登记（两期卡共用，不得各自重写）', () => {
  // `10 §5.5`「单一来源纪律」（2026-09-28 二次修订）：两期卡虽不再同构，但去向条目与
  // 残留条目的**类名、标记与折叠阈值仍须只有一处来源**。此前两处各写了一个同值的
  // `COLLAPSED_RESIDUAL = 2`——同值不等于同源：改动其一时另一处静默分岔。
  assert.equal(typeof WORKCASE_COLLAPSED_RESIDUAL, 'number', '阈值须在共享模块导出为常量');
  assert.ok(WORKCASE_COLLAPSED_RESIDUAL > 0, '阈值须为正数');

  const stateModule = readSource(STATE_MODULE);
  assert.match(stateModule, /export const WORKCASE_COLLAPSED_RESIDUAL/, '阈值须在共享模块登记');
  // 反向：两个卡组件**不得**再各写一份同值字面量。
  for (const [name, src] of [['WorkCaseClosedSummary', readSource(CLOSED_CARD)], ['WorkCaseResultDraft', readSource(DRAFT_CARD)]] as const) {
    assert.doesNotMatch(
      src,
      /const COLLAPSED_RESIDUAL\s*=/,
      `${name} 不得再自定义折叠阈值（须经 WORKCASE_COLLAPSED_RESIDUAL 单点取得）`,
    );
    assert.match(src, /WORKCASE_COLLAPSED_RESIDUAL/, `${name} 须消费共享阈值`);
  }
});

test('单一来源：去向从属行的缩进样式只有一处登记（开放期用，关闭期不用）', () => {
  // `10 §5.5`「块序与逐条标记」：去向子项在**待批准关闭**期**缩进一行**显示于所属残留
  // 之下；在**已关闭**期因残留一侧不再呈现，去向条**提升为平级行**。故该样式只用于
  // 开放期的从属行——两期若各自写一份缩进，形态必然漂移。
  assert.equal(typeof WORKCASE_DIRECTION_ROW_CLASS, 'string');
  assert.match(WORKCASE_DIRECTION_ROW_CLASS, /pl-4/, '从属行须有缩进');
  assert.match(WORKCASE_DIRECTION_ROW_CLASS, /border-t/, '从属行须与其余条目行同为带分割线的行');

  const stateModule = readSource(STATE_MODULE);
  assert.match(stateModule, /export const WORKCASE_DIRECTION_ROW_CLASS/, '样式须在共享模块登记');
  const draft = readSource(DRAFT_CARD);
  assert.match(draft, /WORKCASE_DIRECTION_ROW_CLASS/, '待批准关闭卡须消费该样式');
  // 已关闭卡**不得**用它（去向在关闭期是平级行）。
  assert.doesNotMatch(
    readSource(CLOSED_CARD),
    /WORKCASE_DIRECTION_ROW_CLASS/,
    '已关闭卡的去向条须是平级行，不得用开放期的从属行样式（10 §5.5）',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 源码形态：决定 A 的收窄与条件豁免
// ─────────────────────────────────────────────────────────────────────────────

test('已关闭卡：按决定 A 不再呈现残留一侧，且结论行去掉「残留 K 条」', () => {
  const closed = readSource(CLOSED_CARD);

  // ① 残留块由**条件豁免**门控：不满足前提时如实保留（`21 §15.3` 明文禁止静默消失）。
  assert.match(
    closed,
    /!narrowsResidual && residual\.length > 0 &&/,
    '残留块须由条件豁免门控（不满足前提时保留）',
  );
  assert.match(
    closed,
    /closure_narrows_residual === true/,
    '判据须读投影层的单一值，不得自行解析正文（10 §5.5：判据与卡面同源）',
  );

  // ② **结论行整块已删**（10 §5.5，Human 裁定 2026-09-29 去结论行 / 2026-09-30 定 outcome 归卡头）。
  //    此前这条只断言"结论行里不再出现残留计数"——那在结论行整块删除后是**空转**
  //    （没有该块，自然没有它的计数）。现改为断言**该块的两个锚点都不存在**：
  //    它若被加回（无论带不带残留计数）本条即变红。
  assert.doesNotMatch(
    closed,
    /data-workcase-outcome|data-workcase-check-tally|workcaseResidualTally|workcaseResidualNone/,
    '结论行整块不得回归：卡面 outcome 只由卡头徽标承载（10 §5.5），核对计数不单列',
  );

  // ③ 去向块仍在场，且去向是平级行（用共享模块登记的分区行样式）。
  //
  // **2026-09-30 修订**（Human：「接受现状提出来变成一个 title，下面不再重复」+「接受现状
  // 和转入 Spark 要 2 个区域」）：去向条由「统一条目行」（`WORKCASE_ITEM_ROW_CLASS`）
  // 改为**分区行**（`WORKCASE_DIRECTION_GROUP_ROW_CLASS`）——分区行仍带分割线、仍不缩进
  // （平级），只是行首多了项目符号、并与分区标题同块。原断言「必须用 WORKCASE_ITEM_ROW_CLASS」
  // 若保留，会**逼实现把不用的常量留在 import 里**来骗过守卫——那是空转，不是守卫。
  // 故改为断言新形态的共享常量，并同时钉住「不得用开放期的缩进从属行」。
  assert.match(
    closed,
    /WORKCASE_DIRECTION_GROUP_ROW_CLASS/,
    '去向条须用共享模块登记的分区平级行样式（带分割线、不缩进）',
  );
  const groupRowSource = readSource(STATE_MODULE);
  assert.match(
    groupRowSource,
    /export const WORKCASE_DIRECTION_GROUP_ROW_CLASS/,
    '分区行样式须在共享模块登记（单一来源）',
  );
  assert.doesNotMatch(
    closed,
    /WORKCASE_DIRECTION_ROW_CLASS/,
    '已关闭卡的去向条不得用开放期的缩进从属行样式（10 §5.5）',
  );
  assert.match(closed, /workCaseAdviceTagClass/, '去向标记须经共享色表取色');
});

test('已关闭卡：「转入 Spark」项就地渲染为目标关联行（10 §5.5 已关闭卡表）', () => {
  const closed = readSource(CLOSED_CARD);
  // 只断言**代码**（注释里会提到被删掉的旧组件名作沿革）。
  // 先剥 `{/* ... */}` JSX 块注释，再做逐行 `//`/`*` 过滤——只做后者时，块注释的
  // **续行**（不以 `*` 开头）会把沿革里的旧组件名漏进「代码」造成误红。
  const code = closed
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');

  // 表里写明：「转入 Spark」项**就地渲染为目标关联行**（图标 + 标题 + 目标状态，可点开面板）。
  //
  // **2026-09-30 修订**（去向分区后）：判定从「逐条的 `item.kind`」改为**分区级**的
  // `group.kind === '转入 Spark'`——同一词的条目已合入一个分区，目标行挂在分区内
  // 各条正文之下（`routedTo[index]` 按序配对），配对纪律不变（写法约定、非机械事实）。
  assert.match(code, /group\.kind === '转入 Spark'/, '仅「转入 Spark」分区须就地渲染目标行');
  assert.match(code, /routedTo\[index\]/, '目标须按分区内条目序与 routed-to 候选配对');
  assert.match(code, /relationKey === 'routed-to'/, '目标须取 relations.routed-to（指向的唯一承载，21 §12）');
  // **2026-09-30 修订**：目标行改由**统一关联行**给出（10 §5.5「同类信息只有一处行式」）——
  // 自建的 `WorkCaseRoutedToRow` 已删除。故不再断言"存在某自建组件"，而是断言：
  // ① 该处用的是统一关联行；② 图标/标题/状态三项由统一行提供（在 ObjectList 单点实现）。
  assert.match(code, /<FactAssociationCardRow/, '目标行须用统一关联行（不得自建第二套）');
  assert.doesNotMatch(code, /WorkCaseRoutedToRow/, '自建目标行不得回归');

  const sharedRow = readSource('web/src/pages/ObjectList.tsx');
  assert.match(sharedRow, /export function FactAssociationCardRow/, '统一关联行须单点给出');
  assert.match(sharedRow, /<ObjectTypeIcon/, '统一行须有类型图标');
  assert.match(sharedRow, /getLocalizedObjectTitle/, '统一行须有标题');
  assert.match(sharedRow, /FactAssociationStateIcon/, '统一行须有行末状态图标（状态不写文字）');
  assert.match(sharedRow, /openPanel/, '统一行须可点开面板');
  // 显示期接受终态目标（`§13`：目标其后转终态不使该边失效，且消费方**必须**标注已终结）
  // ——故不得按状态过滤掉终态目标（判据随行式一同移到统一行）。
  assert.doesNotMatch(
    sharedRow,
    /status\s*===\s*'open'\s*\)\s*return null|filter\([^)]*status/,
    '目标行不得按状态过滤（过滤会让「已终结的目标」静默消失，违反 21 §13）',
  );
});

test('待批准关闭卡：两块（逐条核对 + 残留（含去向）），去向缩进于所属残留之下', () => {
  const draft = readSource(DRAFT_CARD);

  // ① 主从：去向子项在残留条目**之内**渲染（`10 §5.5`：缩进一行显示于所属残留之下）。
  assert.match(draft, /workCaseResidualRows\(residualEntries, residual\)/, '残留行须由共享纯函数给出');
  assert.match(draft, /item\.directions\.map\(/, '去向子项须逐条渲染在所属残留之下');
  assert.match(draft, /WORKCASE_DIRECTION_ROW_CLASS/, '从属行须用共享缩进样式');
  // 主从必须落在同一个块容器内（否则「缩进在所属残留之下」失去视觉含义）。
  //
  // 判据取 **JSX 使用点**（`className={...}`），不取 `indexOf(常量名)`——后者会命中文件
  // 顶部的 **import 语句**（其位置恒定），故「顺序颠倒」时会**逃逸**。本仓既有守卫
  // （`workcase-design-language-contract.test.ts`）已实测踩过该坑，此处按同一纪律办。
  const residualBlockAt = draft.indexOf('className={WORKCASE_RESIDUAL_BLOCK_CLASS}');
  const directionRowAt = draft.indexOf('className={WORKCASE_DIRECTION_ROW_CLASS}');
  assert.ok(residualBlockAt >= 0, '未找到残留块使用点（判据须匹配 JSX 使用，而非 import）');
  assert.ok(directionRowAt >= 0, '未找到从属行使用点（判据须匹配 JSX 使用，而非 import）');
  assert.ok(
    residualBlockAt < directionRowAt,
    '去向子项须在残留块容器之内渲染（主从关系可见）',
  );

  // ② 存量分离式仍如实呈现独立去向块——**不得**因为合并式而把它删掉，
  //    否则存量对象的去向会从该期卡面消失（§15.3 存量不溯及）。
  assert.match(draft, /showLooseDirections/, '须保留存量分离式的独立去向块');
  assert.match(
    draft,
    /looseDirections\.length > 0 && !residualCarriesDirections/,
    '独立去向块只在该期去向未挂在残留之下时呈现（否则同一条去向出现两遍）',
  );

  // ③ 不再有「去向」独立块与「残留（含去向）」并列呈现的旧三块形态：
  //    合并式下每条去向都已在其残留之下，平铺块会让同一信息占两行
  //    （`21 §8` 缺陷③正是这个）。
  assert.doesNotMatch(
    draft,
    /advices\.length > 0/,
    '不得再无条件渲染平铺去向块（合并式下会与残留块内的子项重复）',
  );
});

test('详情面：按决定 A 收窄，且只在条件豁免允许时（10 §5.3 窄例外已登记）', () => {
  // 本用例的判据与 2026-09-28 的中间态（暂停消费）**相反**，因为规范已在同日进一步修订：
  //
  // 经过一轮独立对抗复核（\`b57780cb\`）判定「§5.3 与 A 不冲突」的辨析为文字游戏后，
  // 处置方式由「暂停消费」改为**如实路径**——\`10 §5.3\` 首条之下新增**已登记的窄例外**
  // （授权原文即 Human 的指示：「在关闭页面就不应该有残留信息了，要删除掉，规范里也要
  // 明确一下」；追问「1，要删」确认详情页亦同），并明文限定其只作用于 WorkCase 终态对象
  // 的 \`result.residual\` 一个字段、不得扩张。
  //
  // 故详情面**消费** \`closure_narrows_residual\` 是合规的；但**条件豁免必须保留**——
  // 不满足前提的存量对象若被收窄，那 22 条当年无去向的残留会从详情面静默消失。
  const layout = readSource(DETAIL_LAYOUT);
  const layoutCode = layout
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // ① 残留节点**消费**判据收窄，且判据缺失按 false（fail closed）。
  assert.match(
    layoutCode,
    /obj\.closure_narrows_residual === true/,
    '详情面须消费 closure_narrows_residual（10 §5.5 决定 A + §5.3 窄例外）',
  );
  assert.match(
    layoutCode,
    /if \(narrowsResidual\) return null;/,
    '判据为真时收窄（不渲染残留一侧）',
  );
  assert.match(
    layoutCode,
    /const residual = Array\.isArray\(obj\.result\?\.residual\) \? obj\.result\.residual : \[\];/,
    '残留数据仍从字段读（收窄与否不改变数据源）',
  );

  // ② 收窄的**依据**须留在实现里（窄例外 + 不扩张限定）。
  assert.match(layout, /§5\.3/, '实现须登记窄例外所在（10 §5.3）');
  assert.match(layout, /不得扩张/, '实现须登记该例外不得扩张');
  assert.match(layout, /b57780cb|独立对抗复核/, '实现须登记该更正的复核来源');

  // ③ 条件豁免的依据须写明（存量的 22 条残留靠它保护）。
  assert.match(layout, /条件豁免/, '实现须登记条件豁免');
  assert.match(layout, /存量/, '实现须登记存量不溯及（21 §15.3）');

  // ④ 去向节点存在，且在**两期**都是读者读到去向的那一侧（不由 result 字段门控）。
  assert.match(layout, /function DirectionsNode/, '须有去向节点');
  assert.match(layout, /workCaseDirectionRows\(obj\.advice\)/, '去向节点须消费共享纯函数');
  const mountAt = layout.indexOf('<DirectionsNode');
  assert.ok(mountAt > 0, '未找到去向节点挂载点');
  const beforeDirections = layout.slice(layout.indexOf('{hasResult ? ('), mountAt);
  assert.ok(
    !beforeDirections.includes('<DirectionsNode'),
    '去向节点不得挂在 hasResult 分支内（去向不由 result 字段承载，21 §10.2）',
  );

  // ⑤ 中性表述（\`21 §10.2\`：去向不因关闭而被批准，不得用暗示已批准的措辞）。
  assert.doesNotMatch(
    layoutCode,
    /后续去向/,
    '不得写成「后续去向」一类暗示已批准的措辞（21 §8/§10.2）',
  );
});

test('规范侧：详情面收窄态与实现一致（防实现与规范原文漂移）', () => {
  // 本用例把「规范怎么写的」与「实现怎么做的」钉在一起。详情面的正确形态在
  // 2026-09-28 当天**变过两次**：先按 A 收窄 → 经独立对抗复核 \`b57780cb\` 后暂停消费
  // → 同日进一步修订为「按 A 收窄 + §5.3 已登记的窄例外」。若无本守卫，任一方向的
  // 漂移都会静默：规范撤回收窄而实现仍收窄、或实现收窄而规范未登记该例外。
  const spec10 = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '..', 'specs/10-Web呈现与交互规范.md'),
    'utf8',
  );

  // ① §5.3 须登记该窄例外，且带授权原文与不扩张条款。
  assert.match(spec10, /已登记的窄例外（Human 授权 2026-09-28）/, '§5.3 须登记窄例外');
  assert.match(spec10, /规范里也要明确一下/, '§5.3 须留 Human 授权原文');
  assert.match(spec10, /该例外不扩张/, '§5.3 须登记该例外不扩张');
  assert.match(spec10, /WorkCase 终态对象的 \`result\.residual\` 这\*\*一个字段\*\*/, '§5.3 须限定作用对象为单一字段');

  // ② §5.5 须保留「辨析已撤回」的登记（它是被判定为文字游戏的旧说法，不得复活）。
  assert.match(spec10, /该辨析不成立，已撤回/, '§5.5 须保留「辨析已撤回」的登记');
  assert.match(spec10, /已登记的窄例外/, '§5.5 须指向 §5.3 的窄例外');

  // ③ 卡面与详情**同源**：两处都按条件豁免执行。
  assert.match(spec10, /条件豁免/, '§5.5 须登记条件豁免');

  // ④ 实现侧与之一致：详情面收窄、卡面收窄，两处读同一个判据值。
  const layoutCode = readSource(DETAIL_LAYOUT)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(layoutCode, /closure_narrows_residual/, '详情面须与规范一致：消费该判据收窄');
  assert.match(
    readSource(CLOSED_CARD),
    /closure_narrows_residual === true/,
    '卡面须与规范一致：按条件豁免收窄',
  );

  // ⑤ 正向对照（防空转）：若规范撤回收窄，本守卫须失败——故上面 ①② 的判据
  // 指向的是「已登记例外」的正向文本，而非「不存在某表述」的否定式。
  assert.ok(
    spec10.includes('已登记的窄例外（Human 授权 2026-09-28）')
    && spec10.includes('该例外不扩张'),
    '正向对照：窄例外的两项要件须同时在位，缺一即失败',
  );
});

test('单一来源：豁免判据的实现只在共享解析器里有一处', () => {
  const shared = readSource('web/shared/workcaseResultDraft.ts');
  assert.match(shared, /export function workCaseClosureNarrowsResidual/, '判据须在共享模块单点导出');
  assert.match(
    shared,
    /entries\.every\(\(entry\) => Array\.isArray\(entry\?\.directions\) && entry\.directions\.length > 0\)/,
    '判据须是「每条残留都带有去向子项」（与 21 §15.1 门禁③同口径）',
  );

  // 判据由**服务端投影层**算一次后送出（`10 §5.5` 要求两处同源）。
  const facts = readSource('web/api/services/facts.ts');
  assert.match(facts, /workCaseClosureNarrowsResidual\(closedDraft\.residualEntries\)/, '投影层须调用共享判据');
  assert.match(facts, /projected\.closure_narrows_residual\s*=/, '投影层须把判据结果送出');
  // 两个呈现面只读该值。
  for (const [name, src] of [
    ['WorkCaseClosedSummary', readSource(CLOSED_CARD)],
    ['WorkCaseReadingLayout', readSource(DETAIL_LAYOUT)],
  ] as const) {
    assert.match(src, /closure_narrows_residual/, `${name} 须读投影值`);
  }
});

test('不得过度声明：只实现前提①（结构），不得声称 A 的适用条件已获机械保障（21 §15.2）', () => {
  // `21 §15.2` 新增两行「依赖项未满足时不得声称」，其中一行直接针对本机制：
  //
  //   「**决定 A 的前提『去向正文自足』**（21 §8、10 §5.5）| 不得声称该前提**已取得
  //     证据**；不得声称关闭后『只呈现去向』在现存的任何对象上**已可如实执行** |
  //     **无**——实测 18 份 closed 的 56 条去向条目中，迁移前全部带 `出自「…」` 尾注，
  //     新形态下的自足去向正文从无一份实例；2026-09-30 迁移 8 份后余 25 条仍带尾注，
  //     但「无尾注」不等于「自足」，自足性归 AI/Human 语义判断、**无机械判据**（§15.1 软约束）。」
  //
  // 本守卫固定「实现只碰结构面」这一边界，防止将来把语义前提写成结构保证。
  const shared = readSource('web/shared/workcaseResultDraft.ts');
  const closed = readSource(CLOSED_CARD);

  // ① 判据实现须登记「只实现前提①」与「前提②归 AI/Human」。
  assert.match(shared, /只实现前提 ①（结构面），不实现前提 ②（语义面）/, '判据须登记只实现结构面');
  assert.match(shared, /机械层不判定/, '判据须登记自足性不由机械层判定');
  assert.match(shared, /零样本|从无一份实例/, '判据须登记前提② 无证据（零样本）');
  assert.match(shared, /同源但不等价/, '判据须登记与门禁③ 的关系（都带有 ≠ 恰有一个）');

  // ② 不得出现被 §15.2 禁止的**声明**。
  //
  // 判据取**剥注释后的代码**：实现注释里正写着这些禁令本身（「不得声称…」「那会把语义
  // 前提偷换为结构前提」），那是**记录禁令**、不是**作出声明**。若按全文匹配，登记禁令
  // 的行为反而会被判为违规——本条首版即如此（实测被自己的注释绊倒）。
  for (const [name, src] of [['共享判据', shared], ['已关闭卡', closed]] as const) {
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'A 的适用条件已获机械保障',
      '自足性已获机械保障',
      '已可如实执行',
      '去向已被验证正确',
    ]) {
      assert.ok(
        !code.includes(forbidden),
        `${name} 不得出现被 21 §15.2 禁止的声明：${forbidden}`,
      );
    }
  }
  // 正向对照（防空转）：登记禁令的注释确实存在——证明上面那条不是因为「文件里什么都
  // 没有」而通过。
  assert.ok(
    shared.includes('不得据本函数声称'),
    '共享判据须在注释里登记该禁令（上面的剥注释断言才有意义）',
  );

  // ③ 卡面注释须显式登记该禁令本身（否则读者会把结构实现误读为 A 已落地）。
  assert.match(closed, /不得声称本收窄的前提已全部满足/, '卡面须登记该禁令');
  assert.match(closed, /21 §15\.2/, '卡面须指向 §15.2 的缺口登记');

  // ④ 规范侧该行须仍在（防被静默删除）。
  const spec21 = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '..', 'specs/21-WorkCase-工单.md'),
    'utf8',
  );
  assert.match(spec21, /决定 A 的前提「去向正文自足」/, '21 §15.2 须仍登记该缺口行');
  // 证据列须仍判「无」：该行不得因 2026-09-30 的存量迁移（8 份去向正文不再带
  // 「出自「…」」尾注）而把「无尾注」读成「自足」——规范 2026-09-30 更正后已不再使用
  // 「零样本前提」四字，故断言改钉其等价的载荷句（证据为空 + 自足性无机械判据）。
  //
  // 三条断言都**限定在该表格行内**（先取出那一行再匹配）：早前版本对整份规范做
  // `/无机械判据/`，而该词在 §15.1 等其它段落亦出现，于是删掉本行的这个词测试仍全绿
  // ——断言无判别力（2026-09-30 独立对抗复核 F-3）。行内匹配后，删本行任一载荷句都会红。
  const evidenceRow = spec21
    .split('\n')
    .find((line) => line.includes('决定 A 的前提「去向正文自足」'));
  assert.ok(evidenceRow, '21 §15.2 须仍登记该缺口行（表格行）');
  assert.match(
    evidenceRow,
    /\| \*\*无\*\*——实测/,
    '该行证据列须仍为「无」，不得因存量迁移而改写为「已取得证据」',
  );
  assert.match(
    evidenceRow,
    /但「无尾注」不等于「自足」/,
    '该行须显式声明「无尾注 ≠ 自足」，防止把尾注清零误读为证据成立',
  );
  assert.match(evidenceRow, /无机械判据/, '该行须仍声明自足性无机械判据');
});

test('接线：两处卡调用点都传主从结构（否则「残留（含去向）」只有平铺文本）', () => {
  // `10 §5.5` 的「待批准关闭」卡表要求呈现「其下**缩进一行** `[<去向词>] <去向正文>`」——
  // 该主从关系只能由 `residualEntries` 承载，平铺的 `result_residual` 给不出。
  // 列表卡与聚焦收件箱**共用同一组件**（Human 2026-09-24），故两处都要传。
  for (const [name, relativePath] of [
    ['ObjectList', 'web/src/pages/ObjectList.tsx'],
    ['CognitionCenter', 'web/src/pages/CognitionCenter.tsx'],
  ] as const) {
    const src = readSource(relativePath);
    assert.match(src, /<WorkCaseResultDraft/, `${name} 须复用待批准关闭卡组件`);
    assert.match(
      src,
      /residualEntries=\{(?:obj|item\.card)\.result_residual_entries\}/,
      `${name} 须传 result_residual_entries（否则去向子项无处挂载）`,
    );
  }
});

test('卡面纯文本：去向与残留正文渲染前都剥 Markdown 标记（10 §5.5）', () => {
  // 「不解析」不等于「不显示标记」——纯文本插值会把 `**加粗**` 的星号显示给读者。
  // 本项在 2026-09-28 二次修订后依然适用：去向子项的正文同样须剥（§8 同纪律）。
  const closed = readSource(CLOSED_CARD);
  const draft = readSource(DRAFT_CARD);

  // 逐**渲染点**断言，不写成「文件里出现过 `stripCardMarkdown` 即通过」——后者会在
  // 「残留块改回直接插值、而去向块仍在用」时逃逸（本仓既有守卫的注释已登记该实测）。
  //
  // 两期的循环变量名不同（合并式的从属行用 `direction`，关闭期的平级行用 `item`），
  // 故逐文件给出期望形态，而不是套同一个正则。
  assert.match(closed, /stripCardMarkdown\(item\.text\)/, 'WorkCaseClosedSummary 的去向正文须剥标记');
  assert.match(closed, /stripCardMarkdown\(typeof item === 'string'/, 'WorkCaseClosedSummary 的残留正文须剥标记');
  assert.match(draft, /stripCardMarkdown\(direction\.text\)/, 'WorkCaseResultDraft 的去向子项正文须剥标记');
  assert.match(draft, /stripCardMarkdown\(item\.text\)/, 'WorkCaseResultDraft 的残留正文须剥标记');
  // 反向：两个文件都不得出现未经剥标记的原始正文插值。
  for (const [name, src] of [['WorkCaseClosedSummary', closed], ['WorkCaseResultDraft', draft]] as const) {
    assert.doesNotMatch(
      src,
      /<span>\{(?:item|direction)\.text\}<\/span>/,
      `${name} 有未经剥标记的原始正文插值`,
    );
  }
});
