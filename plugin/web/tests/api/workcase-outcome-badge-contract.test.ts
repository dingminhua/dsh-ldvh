// 卡头的**合并徽标**：状态词 + 中心圆点 + 结论词（10 §5.5，Human 裁定 2026-09-30）。
//
// 沿革（必读，否则会把已删除的旧形态当成缺陷）：本组守卫原先钉的是**两处分列**的形态——
// 右侧一枚状态徽标（`已关闭`）、左侧徽标序列末位一枚 `outcome` 徽标（`WorkCaseOutcomeBadge`），
// 并**反向**断言「outcome 徽标须在状态徽标之前——与状态徽标不并排」。Human 2026-09-30
// 二次裁定把两者**合并成一枚、放右侧、以中心圆点连接、配色由结论决定**，故本组守卫按新
// 形态重写；旧形态的锚点（`WorkCaseOutcomeBadge` 组件与左侧那枚徽标）**不得回归**。
//
// 本组要钉住的：
//   ① 合并徽标只在**右侧**（`ObjectIdentityActions` 的 `statusBadge`）出现，且左侧序列
//      不再有第二枚 outcome 徽标（同一件事说两遍）；
//   ② 只作用于 **workcase 的「已关闭」卡**（其余类型/状态仍走默认 `StatusBadge`）；
//   ③ 四值**各显其真**——`partial`／`not-achieved` 不得被写成「完成」；
//   ④ 徽标**不承载展开**，且卡体里没有 outcome 元素。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

/** 剥掉 JSX 花括号块注释与逐行注释，只留代码。
 *  （本行不写出块注释的开闭记号：把它们写进本注释会把本注释自身提前闭合。） */
function codeOnly(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');
}

test('合并徽标只出现在右侧（ObjectIdentityActions 的 statusBadge），左侧不再有第二枚', () => {
  const objectList = codeOnly(read('src/pages/ObjectList.tsx'));
  // ① 右侧：经 `statusBadge` 传合并徽标。
  assert.match(objectList, /statusBadge=\{/, '合并徽标须经 ObjectIdentityActions 的 statusBadge 传');
  assert.match(objectList, /WorkCaseClosedStatusBadge/, '右侧须用合并徽标组件');
  // ② 左侧序列不再有 outcome 徽标（旧形态的锚点不得回归）。
  assert.doesNotMatch(objectList, /WorkCaseOutcomeBadge/, '左侧 outcome 徽标（旧形态）不得回归');
  // ③ 合并徽标与默认状态徽标**互斥**：命中合并时 `status` 须传空，否则两者并排。
  assert.match(
    objectList,
    /status=\{isWorkCaseClosed \? undefined : presentedStatus\}/,
    '合并徽标命中时须传空 status——两者互斥，不得并排',
  );
});

test('合并徽标只作用于 workcase 的已关闭卡（其余一律走默认 StatusBadge）', () => {
  const objectList = codeOnly(read('src/pages/ObjectList.tsx'));
  // 判据须三条件齐备：类型 + 状态 + 结论值存在（缺结论则无从合并）。
  assert.match(objectList, /const isWorkCaseClosed =/, '须有单点判据');
  assert.match(objectList, /obj\.type === 'workcase'/, '判据须限定类型');
  assert.match(objectList, /presentedStatus === 'closed'/, '判据须限定状态');
  assert.match(objectList, /typeof obj\.outcome === 'string'/, '缺结论值时须回落到默认状态徽标');
  // 替代口是**只替换不叠加**：ObjectIdentityActions 里两个分支互斥。
  const actions = codeOnly(read('src/components/ObjectIdentityActions.tsx'));
  assert.match(actions, /statusBadge \?\? \(status &&/, 'statusBadge 与 status 须互斥（?? 短路）');
  assert.match(actions, /<StatusBadge/, '默认状态徽标仍须保留给其余类型/状态');
});

test('合并徽标四值各显其真：partial／not-achieved 不得写成「完成」', () => {
  // Human 2026-09-30 在「统一写完成」与「保持四值」之间**选择了后者**——本条即该裁定的
  // 机械落点。若有人把 partial／not-achieved 的词改成「完成」（那是卡头对载体的一句否认：
  // 21 §9.3 的 partial ＝ 部分判据达成、其余有明确未达成范围），此例即变红。
  const locales = read('src/i18n/locales.ts');
  const zh = (key: string) => locales.match(new RegExp(`'${key}': '([^']*)'`))?.[1];
  assert.equal(zh('objectList.workcaseClosedOutcome.completed'), '完成');
  assert.equal(zh('objectList.workcaseClosedOutcome.partial'), '部分完成', 'partial 须自显其真，不得写成「完成」');
  assert.equal(zh('objectList.workcaseClosedOutcome.not-achieved'), '未完成', 'not-achieved 须自显其真，不得写成「完成」');
  assert.equal(zh('objectList.workcaseClosedOutcome.cancelled'), '取消');
  // 四值互不相同（写成同一个词即失去区分力）。
  const values = ['completed', 'partial', 'not-achieved', 'cancelled'].map((k) =>
    zh(`objectList.workcaseClosedOutcome.${k}`),
  );
  assert.equal(new Set(values).size, 4, `四值文案必须互不相同，实际：${JSON.stringify(values)}`);
});

test('合并徽标用共享 chip class，尺寸圆角不自定；四档配色与邻居同尺度', () => {
  // Human 2026-09-30：「样式与其他的不一致，要保持一致」——尺寸/圆角/字号/内距一律由
  // 共享 class `ldvh-chip-sm` 给出，组件**不得**自定这些（否则与 SG／修改次数徽标并排时高低不一）。
  const badge = codeOnly(read('src/components/WorkCaseClosedStatusBadge.tsx'));
  assert.match(badge, /ldvh-chip-sm/, '须使用共享 chip class');
  for (const forbidden of ['text-[11px]', 'leading-[18px]', 'font-semibold', 'rounded border', 'px-1.5']) {
    assert.ok(!badge.includes(forbidden), `不得自定 ${forbidden}（应由 ldvh-chip-sm 统一给出）`);
  }
  // 四档配色须与邻居同尺度：边框 /30、底色 /10。
  for (const key of ['completed', 'partial', 'not-achieved']) {
    const line = badge.split('\n').find((l) => l.includes(`${key}:`) || l.includes(`'${key}':`));
    assert.ok(line && /\/30/.test(line) && /\/10/.test(line), `${key} 须用 /30 边框与 /10 底色（与邻居同尺度）`);
  }
  // 中心圆点：状态词与结论词之间须有分隔符（Human：「中心圆点」）。
  assert.match(badge, /WORKCASE_CLOSED_STATUS_SEPARATOR = ' · '/, '须有中心圆点常量');
  assert.match(badge, /data-workcase-closed-status=\{outcome\}/, '须有渲染锚点供核验');
});

test('合并徽标不承载展开（10 §5.5：不做展开）', () => {
  const badge = codeOnly(read('src/components/WorkCaseClosedStatusBadge.tsx'));
  assert.doesNotMatch(badge, /onClick|onToggle|useState|aria-expanded/, '徽标不得有展开交互');
  assert.doesNotMatch(badge, /achieved_scope|residual|criteria_checks/, '达成范围／残留／证据不得经徽标上卡');
  // 四档配色沿用既有四档（绿／琥珀／红／中性），不新造色。
  for (const k of ['completed', 'partial', 'not-achieved', 'cancelled']) {
    assert.ok(badge.includes(`${k}:`) || badge.includes(`'${k}':`), `配色表须含 ${k}`);
  }
});

test('状态词不在合并徽标内另取一份（单一来源，改一处必漂移）', () => {
  // 状态词由调用方经 `getObjectStatusLocale` 取得后**传入**；组件内不得再调一次取词函数。
  const badge = codeOnly(read('src/components/WorkCaseClosedStatusBadge.tsx'));
  assert.doesNotMatch(badge, /getObjectStatusLocale/, '状态词须由调用方传入，不在组件内另取');
  assert.match(badge, /statusLabel/, '组件须接收状态词');
});

test('卡体不得再出现 outcome 元素（结论行不得回归）', () => {
  const closedCard = read('src/components/WorkCaseClosedSummary.tsx');
  assert.doesNotMatch(closedCard, /data-workcase-outcome|data-workcase-check-tally/);
});

test('已关闭卡不再呈现「逐条核对」块（10 §5.5，Human 裁定 2026-09-30）', () => {
  // 该块原为 `[达成／未达成／未记录] plan[N].step` 四行；去掉的理由是**计划步骤名与
  // 「计划」重复、状态已由卡头合并徽标与去向块表达**。核对结果与证据仍在语义详情。
  // 本条钉住「不得回归」——若有人把该块加回，此例即变红。
  const closedCard = read('src/components/WorkCaseClosedSummary.tsx');
  const code = codeOnly(closedCard);
  assert.doesNotMatch(code, /data-workcase-check-status/, '逐条核对块不得回归（其渲染锚点须不存在）');
  assert.doesNotMatch(code, /workCaseResultCheckRows/, '不得再消费核对行渲染器');
  assert.doesNotMatch(code, /criteria_checks/, '不得再读取 criteria_checks 用于卡面渲染');
});
