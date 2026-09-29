// 卡头的 `outcome` 徽标（10 §5.5，Human 裁定 2026-09-30：放卡头、不做展开）。
//
// 三条要钉住的：
//   ① 卡头把它挂在**状态徽标之后**（`statusTrailingBadges`），且只在 workcase 上传；
//   ② 徽标组件本身**不承载展开**（无按钮/无 onToggle/无详情体）；
//   ③ 卡体里**没有** outcome 元素（结论行不得回归）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

test('卡头：outcome 徽标位于徽标序列·修改次数之后，且只对 workcase 传', () => {
  // 10 §5.5（Human 裁定 2026-09-30）：徽标序列 = 类型 → 优先级 → SG → 修改次数 → outcome；
  // 不与状态徽标并排。
  const objectList = read('src/pages/ObjectList.tsx');
  assert.match(objectList, /WorkCaseOutcomeBadge/);
  const activityIdx = objectList.indexOf("title={t('cognition.recent.activityCount'");
  const badgeIdx = objectList.indexOf("{obj.type === 'workcase' && <WorkCaseOutcomeBadge source={obj} />}");
  assert.ok(activityIdx >= 0 && badgeIdx > activityIdx, 'outcome 徽标须在修改次数徽标之后');
  const statusIdx = objectList.indexOf('<ObjectIdentityActions');
  assert.ok(statusIdx > badgeIdx, 'outcome 徽标须在状态徽标（ObjectIdentityActions）之前——与状态徽标不并排');
});

test('卡头的 outcome 徽标用共享 chip class，尺寸圆角不自定（与邻居一致）', () => {
  // Human 2026-09-30：「样式与其他的不一致，要保持一致」——尺寸/圆角/字号/内距一律由
  // 共享 class `ldvh-chip-sm` 给出，组件**不得**自定这些（否则与 SG／修改次数徽标并排时高低不一）。
  const raw = read('src/components/WorkCaseOutcomeBadge.tsx');
  const badge = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('/*') && !line.trim().startsWith('*'))
    .join('\n');
  assert.match(badge, /ldvh-chip-sm/, '须使用共享 chip class');
  for (const forbidden of ['text-[11px]', 'leading-[18px]', 'font-semibold', 'rounded border', 'px-1.5']) {
    assert.ok(!badge.includes(forbidden), `不得自定 ${forbidden}（应由 ldvh-chip-sm 统一给出）`);
  }
  // 四档配色须与邻居同尺度：边框 /30、底色 /10。
  for (const key of ['completed', 'partial', 'not-achieved']) {
    const line = badge.split('\n').find((l) => l.includes(`${key}:`) || l.includes(`'${key}':`));
    assert.ok(line && /\/30/.test(line) && /\/10/.test(line), `${key} 须用 /30 边框与 /10 底色（与邻居同尺度）`);
  }
});

test('卡头的 outcome 徽标不承载展开（10 §5.5：不做展开）', () => {
  const raw = read('src/components/WorkCaseOutcomeBadge.tsx');
  // 只看**代码**：注释里必然要提到"达成范围/残留不上卡"这条边界，不能因此判红。
  const badge = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('/*') && !line.trim().startsWith('*'))
    .join('\n');
  assert.doesNotMatch(badge, /onClick|onToggle|useState|aria-expanded/, '徽标不得有展开交互');
  assert.doesNotMatch(badge, /achieved_scope|residual|criteria_checks/, '达成范围／残留／证据不得经徽标上卡');
  assert.match(badge, /data-workcase-outcome=\{outcome\}/);
  // 四档配色沿用既有四档（绿／琥珀／红／中性），不新造色。
  for (const k of ['completed', 'partial', 'not-achieved', 'cancelled']) {
    assert.ok(badge.includes(`${k}:`) || badge.includes(`'${k}':`), `配色表须含 ${k}`);
  }
});

test('卡体不得再出现 outcome 元素（结论行不得回归）', () => {
  const closedCard = read('src/components/WorkCaseClosedSummary.tsx');
  assert.doesNotMatch(closedCard, /data-workcase-outcome|data-workcase-check-tally/);
});
