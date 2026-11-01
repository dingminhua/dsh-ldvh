import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  summarizeServingSparkProgress,
  SERVING_SPARK_STATUSES,
} from '../../src/utils/servingSparkProgress.ts';

/**
 * 子目标「火花落实」比值（Human 定案 2026-11-02）。
 *
 * Human 原话：「sg 需要呈现一个进度条件，分母是关联的所有 spark，待处理+已落实，
 * 分子是已落实」。
 *
 * 本组既验**行为**（分母确实只含 open+implemented、discarded 被排除、空集不折算成
 * 0%），也验**形态**（卡面与详情共用同一次派生、条不按可见条数算）。
 *
 * **保证边界**：行为断言只证明这个纯函数对给定输入算出什么；不证明某条真实子目标的
 * 比值「正确」——那取决于下游 Spark 的 `serves` 写得对不对，属语义核对。
 */

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

const spark = (status: string) => ({ type: 'spark', status });
const workcase = (status: string) => ({ type: 'workcase', status });

test('分母只含待处理与已落实，分子是已落实（Human 定案口径）', () => {
  const progress = summarizeServingSparkProgress([
    spark('implemented'), spark('implemented'), spark('implemented'), // 3
    spark('open'), spark('open'), // 2
    spark('discarded'), // 不进分母
  ]);
  assert.equal(progress.kind, 'ratio');
  if (progress.kind !== 'ratio') return;
  assert.equal(progress.implemented, 3, '分子＝已落实');
  assert.equal(progress.open, 2, '待处理单列给读者对账');
  assert.equal(progress.denominator, 5, '分母＝待处理 + 已落实，已废弃不计入');
  assert.equal(progress.sparkTotal, 6, '总火花数仍如实给出（含已废弃）');
});

test('已废弃不进分母：处置掉火花不算进度倒退', () => {
  // 20 §9：discarded = 被合并或拆分，责任已转移或明确放弃——它不表示「该做的事少了
  // 一件」。若算进分母，「废弃一半火花」会显示成进度下降，而那其实是处置进展。
  const before = summarizeServingSparkProgress([spark('open'), spark('open')]);
  const after = summarizeServingSparkProgress([spark('open'), spark('discarded')]);
  assert.equal(before.kind, 'ratio');
  assert.equal(after.kind, 'ratio');
  if (before.kind !== 'ratio' || after.kind !== 'ratio') return;
  // 分母从 2 变 1，但**比值不降**：这正是排除已废弃的目的。
  assert.equal(before.denominator, 2);
  assert.equal(after.denominator, 1, '废弃一条后分母按口径缩小');
  assert.ok(after.implemented / after.denominator >= before.implemented / before.denominator,
    '处置一条火花不应让进度倒退');
});

test('空集不折算成 0%：三种「算不出」各有自己的状态（28 §8.1）', () => {
  // ① 名下没有火花
  assert.equal(summarizeServingSparkProgress([]).kind, 'empty');
  assert.equal(summarizeServingSparkProgress([workcase('closed')]).kind, 'empty',
    '只有工单不算有火花');

  // ② 火花全废弃——不是「没拆解」，是「拆了、都处置掉了」
  assert.equal(summarizeServingSparkProgress([spark('discarded')]).kind, 'allDiscarded');

  // ③ 读不到——不能当作「没有」（00 §5.6）
  const unavailable = summarizeServingSparkProgress([spark('open')], ['spark: read failed']);
  assert.equal(unavailable.kind, 'unavailable');
  if (unavailable.kind === 'unavailable') {
    assert.match(unavailable.reason, /spark/);
  }
});

test('工单不混进火花比值（两个轴）', () => {
  const progress = summarizeServingSparkProgress([
    workcase('closed'), workcase('open'),
    spark('implemented'),
  ]);
  assert.equal(progress.kind, 'ratio');
  if (progress.kind !== 'ratio') return;
  assert.equal(progress.denominator, 1, '工单不参与分母');
  assert.equal(progress.implemented, 1);
});

test('闭集外状态不猜档位、不静默丢弃：单独计数并如实上报', () => {
  const progress = summarizeServingSparkProgress([
    spark('implemented'),
    spark('open'),
    spark('archived'), // 闭集外
  ]);
  assert.equal(progress.kind, 'ratio');
  if (progress.kind !== 'ratio') return;
  assert.equal(progress.denominator, 2, '闭集外状态不进分母');
  assert.equal(progress.unknownStatus, 1, '但必须计数并上报，不能当作没有');
  // 闭集本身也在此登记一次，供其它断言引用而不是各处硬编码。
  assert.deepEqual([...SERVING_SPARK_STATUSES], ['open', 'implemented', 'discarded']);
});

test('已落实不因下游完成而虚增：分子只数 implemented（20 §9「implemented ≠ 下游完成」）', () => {
  // 这条防的是把工单关闭数读成火花落实——20 §9 与 28 §18 红线 3 同向。
  const progress = summarizeServingSparkProgress([
    workcase('closed'), workcase('closed'), workcase('closed'),
    spark('open'),
  ]);
  assert.equal(progress.kind, 'ratio');
  if (progress.kind !== 'ratio') return;
  assert.equal(progress.implemented, 0, '三张工单已关闭不得抬高分子');
  assert.equal(progress.denominator, 1);
});

test('卡面与详情面共用同一次派生，且比值不随展开条数变化', () => {
  const list = read('src/pages/ObjectList.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const bar = read('src/components/ServingSparkProgressBar.tsx');
  const util = read('src/utils/servingSparkProgress.ts');

  // 单点派生：两处都经组件，组件内调 util，不在任一处重算分子分母。
  assert.match(bar, /summarizeServingSparkProgress/);
  assert.match(list, /<ServingSparkProgressBar/);
  assert.match(layouts, /<ServingSparkProgressBar/);
  assert.doesNotMatch(list, /\.filter\(.*status === 'implemented'/, '卡面不得自己算分子');
  assert.doesNotMatch(layouts, /\.filter\(.*status === 'implemented'/, '详情不得自己算分子');

  // **分母读原始行**：`groupServingWorkByType` 会把 ServingWorkItem 投影成
  // FactCardAssociation（status 被换成关联状态轴）。卡面第一版把投影后的行传进来，
  // 结果每张卡都显示「名下没有火花」——实测发现（2026-11-02）。
  assert.match(list, /const sparkRows = rows\.filter\(\(row\) => row\.type === 'spark'\)/,
    '卡面的比值须读原始 serving_work 行');
  assert.match(list, /rows=\{sparkRows\}/, '传给组件的是原始行');
  assert.match(layouts, /rows=\{Array\.isArray\(obj\.serving_work\) \? obj\.serving_work : \[\]\}/,
    '详情同样传原始行');
  assert.doesNotMatch(list, /rows=\{group\.rows/,
    '不得把关联投影当作比值输入（status 已被换轴）');

  // 展开态不参与分母：分母来自全部行，不来自 visible。
  assert.doesNotMatch(bar, /visible/, '比值不得读可见条数');
  assert.match(util, /denominator: open \+ implemented/, '分母口径在此单点定义');
});

test('比值条的文案把三种「算不出」各说各的（不合成一句「暂无」）', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  const zh = UI_LOCALES.zh;
  const en = UI_LOCALES.en;

  // 空集：必须显式否认 0%（28 §8.1 的原话就是「不得以进度 0% 等类推定替代」）。
  assert.match(zh['objectList.subGoalSparkProgressEmpty'], /不是 0%/);
  assert.match(zh['objectList.subGoalSparkProgressEmpty'], /分母为空/);
  assert.match(en['objectList.subGoalSparkProgressEmpty'], /not 0%/);

  // 全废弃：要说明「不计入分母」以及为什么（废弃≠那件事没了）。
  assert.match(zh['objectList.subGoalSparkProgressAllDiscarded'], /已废弃/);
  assert.match(zh['objectList.subGoalSparkProgressAllDiscarded'], /分母/);

  // 读不到：不得当作没有（00 §5.6）。
  assert.match(zh['objectList.subGoalSparkProgressUnavailable'], /读不到不等于没有/);
  assert.match(en['objectList.subGoalSparkProgressUnavailable'], /unreadable is not the same as none/i);

  // 闭集外：带计数占位符。
  assert.match(zh['objectList.subGoalSparkProgressUnknown'], /\{count\}/);
  assert.match(en['objectList.subGoalSparkProgressUnknown'], /\{count\}/);

  // 标题与两档明细标签都存在（构成「条 + 分数」的完整读法）。
  // 标题与空集文案必须是两句话（同一个键兼任会让「分母为空」永远显示成标题）。
  assert.notEqual(
    String(zh['objectList.subGoalSparkProgress']),
    String(zh['objectList.subGoalSparkProgressEmpty']),
  );
});
