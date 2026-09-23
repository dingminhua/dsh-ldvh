// 「## 结果」节解析的契约测试（`shared/workcaseResultDraft`）。
//
// 判据是 21 §8 登记的三词（达成 / 部分达成 / 未达成）与 `- advice:` 段结构；
// 解析器只认形态、不猜语义——所以这里既断言「认得了」，也断言「认不出时落空」。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WORKCASE_CHECK_STATUSES,
  WORKCASE_ADVICE_KINDS,
  parseWorkCaseResultDraft,
  resultSectionOf,
} from '../../shared/workcaseResultDraft.ts';

const PLAN = [
  { step: '核实范围与适用路径' },
  { step: '补校验并处置失效路径' },
  { step: '消解字段冲突' },
  { step: '验证三件套与受控提交' },
];

function bodyOf(resultLines: string[]): string {
  return ['# 标题', '', '## 摘要', '', '正文', '', '## 结果', '', ...resultLines, ''].join('\n');
}

test('闭集常量', () => {
  assert.deepEqual([...WORKCASE_CHECK_STATUSES], ['achieved', 'partial', 'not-achieved']);
  assert.deepEqual(
    [...WORKCASE_ADVICE_KINDS],
    ['另立工单', '补录', '更正', '接受现状', '改进'],
  );
});

test('resultSectionOf：取「## 结果」节，遇下一个 H2 停止', () => {
  const body = ['## 执行', '执行正文', '## 结果', '结果正文', '## 附录', '附录正文'].join('\n');
  assert.equal(resultSectionOf(body), '结果正文');
});

test('resultSectionOf：无结果节返回空串', () => {
  assert.equal(resultSectionOf('## 执行\n只有执行'), '');
});

test('形态①：步骤 N 判据「…」：<词>——证据：…', () => {
  const body = bodyOf([
    '- criteria_checks:',
    '  - 步骤 1 判据「列出全部 7 个 action」：达成——证据：穷举确认。',
    '  - 步骤 2 判据「存在可机械判定的校验」：未达成。所实现判据判定不成立。',
    '  - 步骤 3 判据「两者均有行为测试」：部分达成——证据：writer 全绿。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.checks, [
    { planIndex: 0, status: 'achieved' },
    { planIndex: 1, status: 'not-achieved' },
    { planIndex: 2, status: 'partial' },
  ]);
});

test('形态②：步骤 N–M：<词>——证据：…（区间展开到每步）', () => {
  const body = bodyOf([
    '- 步骤 1–2：达成——证据：两处都落地。',
    '- 步骤 3：达成——证据：已消解。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.checks, [
    { planIndex: 0, status: 'achieved' },
    { planIndex: 1, status: 'achieved' },
    { planIndex: 2, status: 'achieved' },
  ]);
});

test('形态③：名称形态按 plan.step 匹配', () => {
  const body = bodyOf([
    '- 判据逐条核对：',
    '  - 核实范围与适用路径：达成——证据：机械比对。',
    '  - 消解字段冲突：达成——证据：有对照证据。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.checks, [
    { planIndex: 0, status: 'achieved' },
    { planIndex: 2, status: 'achieved' },
  ]);
});

test('只认登记三词：其它写法落为 null（不猜、不静默归一）', () => {
  const body = bodyOf([
    '- criteria_checks:',
    '  - 步骤 1 判据「x」：已满足——证据：旧写法。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.checks, [{ planIndex: 0, status: null }]);
});

test('advice 段：`- advice:` 内每条给去向与内容', () => {
  const body = bodyOf([
    '- advice:',
    '  - **另立工单**：另立一单实现级联信号。',
    '  - **改进**：建议改为 fail-closed。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice, [
    { kind: '另立工单', text: '另立一单实现级联信号。', from: null },
    { kind: '改进', text: '建议改为 fail-closed。', from: null },
  ]);
});

test('advice 段：`出自「…」`尾注拆成 from，正文不含尾注', () => {
  const body = bodyOf([
    '- advice:',
    '  - **另立工单**：以同一手法普查其余六类。出自「同型缺陷未普查其余六类」',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice, [
    { kind: '另立工单', text: '以同一手法普查其余六类。', from: '同型缺陷未普查其余六类' },
  ]);
});

test('advice 段：未登记的去向词记 null（不静默归一到近似词）', () => {
  const body = bodyOf([
    '- advice:',
    '  - **修复**：把该分支改为 fail-closed。',
    '  - **观察**：下一轮再看。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice.map((a) => a.kind), [null, null]);
});

test('residual 里的「建议…」子句不再产出条目（21 §8：建议只有一处承载）', () => {
  const body = bodyOf([
    '- residual:',
    '  - **缺口 A 未修复**：无法机械判定。建议另立一单，其前置为先实现级联信号。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice, []);
});

test('未配对/无结果节：返回空草稿而不是抛错', () => {
  assert.deepEqual(parseWorkCaseResultDraft('## 执行\n无结果节', PLAN), { checks: [], advice: [] });
  assert.deepEqual(parseWorkCaseResultDraft(undefined, PLAN), { checks: [], advice: [] });
  assert.deepEqual(parseWorkCaseResultDraft('## 结果\n- 无有效条目', undefined), {
    checks: [],
    advice: [],
  });
});

test('advice 段判别力：去向词必须在行首加粗，否则记未归类', () => {
  const body = bodyOf([
    '- advice:',
    '  - 建议另立工单补该路由的投影。',
    '  - **改进**：建议改为 fail-closed。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice, [
    // 无加粗行首 → 判不出去向（旧实现按关键词猜成「另立工单」，已按 21 §8 收紧）
    { kind: null, text: '建议另立工单补该路由的投影。', from: null },
    { kind: '改进', text: '建议改为 fail-closed。', from: null },
  ]);
});
