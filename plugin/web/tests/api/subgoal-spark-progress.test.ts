import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  summarizeServingSparkProgress,
  SERVING_SPARK_STATUSES,
} from '../../src/utils/servingSparkProgress.ts';


function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

const spark = (status: string) => ({ type: 'spark', status });
const otherType = (status: string) => ({ type: 'pitfall', status });

test('分母只含待处理与已落实，分子是已落实（Human 定案口径）', () => {
  const progress = summarizeServingSparkProgress([
    spark('implemented'), spark('implemented'), spark('implemented'),
    spark('open'), spark('open'),
    spark('discarded'),
  ]);
  assert.equal(progress.kind, 'ratio');
  if (progress.kind !== 'ratio') return;
  assert.equal(progress.implemented, 3, '分子＝已落实');
  assert.equal(progress.open, 2, '待处理单列给读者对账');
  assert.equal(progress.denominator, 5, '分母＝待处理 + 已落实，已废弃不计入');
  assert.equal(progress.sparkTotal, 6, '总火花数仍如实给出（含已废弃）');
});

test('已废弃不进分母：处置掉火花不算进度倒退', () => {
  const before = summarizeServingSparkProgress([spark('open'), spark('open')]);
  const after = summarizeServingSparkProgress([spark('open'), spark('discarded')]);
  assert.equal(before.kind, 'ratio');
  assert.equal(after.kind, 'ratio');
  if (before.kind !== 'ratio' || after.kind !== 'ratio') return;
  assert.equal(before.denominator, 2);
  assert.equal(after.denominator, 1, '废弃一条后分母按口径缩小');
  assert.ok(after.implemented / after.denominator >= before.implemented / before.denominator,
    '处置一条火花不应让进度倒退');
});

test('空集不折算成 0%：三种「算不出」各有自己的状态（28 §8.1）', () => {
  assert.equal(summarizeServingSparkProgress([]).kind, 'empty');
  assert.equal(summarizeServingSparkProgress([otherType('retired')]).kind, 'empty',
    '只有非火花类型不算有火花');

  assert.equal(summarizeServingSparkProgress([spark('discarded')]).kind, 'allDiscarded');

  const unavailable = summarizeServingSparkProgress([spark('open')], ['spark: read failed']);
  assert.equal(unavailable.kind, 'unavailable');
  if (unavailable.kind === 'unavailable') {
    assert.match(unavailable.reason, /spark/);
  }
});

test('非火花类型不混进火花比值（两个轴）', () => {
  const progress = summarizeServingSparkProgress([
    otherType('retired'), otherType('active'),
    spark('implemented'),
  ]);
  assert.equal(progress.kind, 'ratio');
  if (progress.kind !== 'ratio') return;
  assert.equal(progress.denominator, 1, '非火花类型不参与分母');
  assert.equal(progress.implemented, 1);
});

test('闭集外状态不猜档位、不静默丢弃：单独计数并如实上报', () => {
  const progress = summarizeServingSparkProgress([
    spark('implemented'),
    spark('open'),
    spark('archived'),
  ]);
  assert.equal(progress.kind, 'ratio');
  if (progress.kind !== 'ratio') return;
  assert.equal(progress.denominator, 2, '闭集外状态不进分母');
  assert.equal(progress.unknownStatus, 1, '但必须计数并上报，不能当作没有');
  assert.deepEqual([...SERVING_SPARK_STATUSES], ['open', 'implemented', 'discarded']);
});

test('已落实不因下游完成而虚增：分子只数 implemented（20 §9「implemented ≠ 下游完成」）', () => {
  const progress = summarizeServingSparkProgress([
    otherType('retired'), otherType('retired'), otherType('retired'),
    spark('open'),
  ]);
  assert.equal(progress.kind, 'ratio');
  if (progress.kind !== 'ratio') return;
  assert.equal(progress.implemented, 0, '其它对象的完成数不得抬高分子');
  assert.equal(progress.denominator, 1);
});

test('卡面与详情面共用同一次派生，且比值不随展开条数变化', () => {
  const list = read('src/components/SubGoalCardParts.tsx')
    + read('src/components/FactAssociationRows.tsx');
  const layouts = read('src/pages/object-detail/FactReadingLayouts.tsx');
  const bar = read('src/components/ServingSparkProgressBar.tsx');
  const util = read('src/utils/servingSparkProgress.ts');

  assert.match(bar, /summarizeServingSparkProgress/);
  assert.match(list, /<ServingSparkProgressBar/);
  assert.match(layouts, /<ServingSparkProgressBar/);
  assert.doesNotMatch(list, /\.filter\(.*status === 'implemented'/, '卡面不得自己算分子');
  assert.doesNotMatch(layouts, /\.filter\(.*status === 'implemented'/, '详情不得自己算分子');

  assert.match(list, /const sparkRows = rows\.filter\(\(row\) => row\.type === 'spark'\)/,
    '卡面的比值须读原始 serving_work 行');
  assert.match(list, /rows=\{sparkRows\}/, '传给组件的是原始行');
  assert.match(layouts, /rows=\{Array\.isArray\(obj\.serving_work\) \? obj\.serving_work : \[\]\}/,
    '详情同样传原始行');
  assert.doesNotMatch(list, /rows=\{group\.rows/,
    '不得把关联投影当作比值输入（status 已被换轴）');

  assert.doesNotMatch(bar, /visible/, '比值不得读可见条数');
  assert.match(util, /denominator: open \+ implemented/, '分母口径在此单点定义');
});

test('比值条的文案把三种「算不出」各说各的（不合成一句「暂无」）', async () => {
  const { UI_LOCALES } = await import('../../src/i18n/locales.ts');
  const zh = UI_LOCALES.zh;
  const en = UI_LOCALES.en;

  assert.match(zh['objectList.subGoalSparkProgressEmpty'], /不是 0%/);
  assert.match(zh['objectList.subGoalSparkProgressEmpty'], /分母为空/);
  assert.match(en['objectList.subGoalSparkProgressEmpty'], /not 0%/);

  assert.match(zh['objectList.subGoalSparkProgressAllDiscarded'], /已废弃/);
  assert.match(zh['objectList.subGoalSparkProgressAllDiscarded'], /分母/);

  assert.match(zh['objectList.subGoalSparkProgressUnavailable'], /读不到不等于没有/);
  assert.match(en['objectList.subGoalSparkProgressUnavailable'], /unreadable is not the same as none/i);

  assert.match(zh['objectList.subGoalSparkProgressUnknown'], /\{count\}/);
  assert.match(en['objectList.subGoalSparkProgressUnknown'], /\{count\}/);

  assert.notEqual(
    String(zh['objectList.subGoalSparkProgress']),
    String(zh['objectList.subGoalSparkProgressEmpty']),
  );
});
