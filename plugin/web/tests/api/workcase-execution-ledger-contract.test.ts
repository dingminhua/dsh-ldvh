// 「执行」节记账纪律的前置保障契约（21 §8，WC-1c6afa19）。
//
// 背景：WorkCase 的执行记录曾自创序号并与 plan 的位置序号混同——把「处置复核发现」
// 「收尾验证」等非计划动作续编为计划步骤，而 plan 只有 6 步，读者按 plan 逐条核对
// 必然对不上。根因之一是规范对「执行」节无任何记账格式约定，AI 只能自创。
//
// 本单原拟以**机械校验**兜底（越界即拒绝），但该方案经实测证伪，故已按 21 §18 回退：
//   - 它只识别显式形式「计划步骤 N」，而原始错误用的是纯「步骤 N」——**交集为空**，
//     抓不到目标错误；
//   - 它会把「如实引述该编号的记述」判为违规（本单自身工单的摘要即被误判），
//     等于惩罚诚实描述；
//   - 因此它会诱使作者「不写编号以规避检查」，反而降低执行记录的可核对性。
//
// 保留的防护是**弱约束**（无机械强制）：①§8 记账纪律给出唯一合法写法；
// ②工具层前置提示，使写正文时眼下即有权威编号。本文件为 ② 的机械守卫。
//
// ⚠️ 本文件守卫的**保证边界**（2026-09-18 由独立对抗审核实证，已复现）：
// 全部 6 项都是**源码文本断言**（readFileSync + 正则/includes），因此它们
// **只拦形态、不拦语义**——一个功能等价、但改名改文案的越界拒绝门禁可以在本
// 文件 6/6 全绿的情况下被引入（审核者的变异 ⑥ 与本人的独立复现均已证实：
// 注入 `checkLedgerNumbers` 并接入 writeValidated、实测确实拒绝写入，守卫仍全绿）。
// 故本文件的真实作用是「防止已知形态被误删/被随手复原」，**不是**「保证 ③ 不会
// 以任何形式复活」。不得据本文件的全绿声明「该纪律已获机械保障」。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/** 仓库根（tests/api → web → plugin → repo）。 */
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

const SPEC_PATH = 'specs/21-WorkCase-工单.md';
const WRITER_PATH = 'plugin/lib/workcase-writer.js';
const TOOLS_PATH = 'plugin/lib/workcase-tools.js';

test('§8 给出「执行」节记账纪律：显式形式为唯一合法引用，且非计划动作不得编入计划序号', () => {
  const spec = readSource(SPEC_PATH);

  // 纪律文本存在，并覆盖三项要点：唯一合法形式、非计划动作的处置、重批后的处置。
  assert.match(spec, /「执行」节的记账纪律/, '21 §8 必须含执行节记账纪律');
  assert.match(spec, /唯一的计划步骤编号体系/, '须写明 plan 位置序号是唯一编号体系');
  assert.match(spec, /计划步骤 N/, '须给出显式形式「计划步骤 N」');
  assert.match(spec, /非计划步骤的执行事项[\s\S]{0,80}独立描述/, '须写明非计划动作独立描述');
  assert.match(spec, /局部重批/, '须覆盖重批后旧序号的处置');
});

test('§8 记账纪律不含任何拒绝规则——它是写法约定，不是强制门禁', () => {
  const spec = readSource(SPEC_PATH);
  const discipline = spec.slice(
    spec.indexOf('「执行」节的记账纪律'),
    spec.indexOf('字段间不变量：'),
  );
  assert.ok(discipline.length > 0, '必须能定位记账纪律段落');

  // 关键：纪律段不得含「拒绝写入」「不得写入」一类强制语。本单的教训是——
  // 给不可机械判定的东西加强制门禁，只会误伤诚实记述并诱发规避。
  for (const banned of ['拒绝写入', '不得写入', '拒绝并报告']) {
    assert.ok(
      !discipline.includes(banned),
      `记账纪律段不得含强制语「${banned}」——该段是写法约定而非门禁（原机械校验已实测证伪）`,
    );
  }
});

test('§15.1 不得保留「计划步骤引用越界」校验项——该方案已证伪并回退', () => {
  const spec = readSource(SPEC_PATH);
  // 防复活：若日后有人重新加入该项，本守卫失败并指向证伪理由。
  assert.ok(
    !spec.includes('计划步骤引用越界'),
    '「计划步骤引用越界」校验已实测证伪（抓不到纯「步骤 N」形态的原错误，且拒绝如实引述）不得复活；'
    + '若确需重启该方向，须先解决「本对象引用 vs 引述他对象」在字形上不可区分的问题',
  );
});

test('approve 返回携带 plan_step_reference 权威清单（写入前可见）', () => {
  const writer = readSource(WRITER_PATH);

  // 返回结构：规则说明 + plan 长度 + 逐条 {n, step}（由共享 helper 构造）。
  assert.match(writer, /plan_step_reference/, '成功返回须含 plan_step_reference');
  assert.match(writer, /function planStepReference\(plan\)/, '清单须由单一 helper 构造，防两处漂移');
  assert.match(writer, /plan_length: list\.length/, '须带 plan 长度');
  assert.match(
    writer,
    /steps: list\.map\(\(item, index\) => \(\{ n: index \+ 1, step: item\.step \}\)\)/,
    '须逐条给出 序号+step 文本',
  );

  // approve（授权时点）与 execute（实际写正文时点）**两处都要给**——跨会话接力时
  // 执行者未必持有 approve 的返回值，只在 approve 给会让前置提示价值衰减。
  const callSites = [...writer.matchAll(/planStepReference\(next\.plan\)/g)];
  assert.ok(
    callSites.length >= 2,
    `plan 清单须在 approve 与 execute 两处返回（实际 ${callSites.length} 处）——跨会话接力只靠 approve 会衰减`,
  );

  // 前置提示必须是**告知**而非门禁：返回段不得引入拒绝分支。
  const hint = writer.slice(
    writer.indexOf('21 §8「执行」节记账纪律的前置提示'),
    writer.indexOf('plan_step_reference'),
  );
  assert.ok(hint.length > 0, '必须能定位前置提示段');
  assert.doesNotMatch(
    hint,
    /issues\.push|failure\(/,
    '前置提示不得含校验或拒绝分支——它只把权威编号摆在写入之前',
  );
});

test('工具描述在写入面给出记账纪律指引（无需回查 frontmatter 即可知道写法）', () => {
  const tools = readSource(TOOLS_PATH);

  // body_markdown_after 的参数描述须直接写明显式形式与边界。
  assert.match(tools, /「执行」节记账纪律/, '写入参数描述须含记账纪律');
  assert.match(tools, /「计划步骤 N」/, '须写明显式形式');
  assert.match(tools, /plan_step_reference/, '须指向 approve 返回的权威清单');

  // 工具 summary 亦须可发现（调用方读工具卡时即可见）。
  assert.match(tools, /plan_step_reference — the authoritative/, '工具 summary 须提及该清单');
});

test('记账纪律的防护是弱约束：不得在 writer 中新增针对该编号的机械拒绝', () => {
  const writer = readSource(WRITER_PATH);
  // 防复活：证伪的校验若被重新引入，通常会带同名符号。
  assert.ok(
    !writer.includes('validatePlanStepReferences'),
    '针对「计划步骤 N」的机械校验函数不得复活（已证伪：抓不到原错误、误伤如实引述）',
  );
  assert.ok(
    !writer.includes('超出当前 plan 长度'),
    '越界拒绝的错误文案不得复活',
  );
});

test('本守卫如实声明其保证边界：只拦形态、不拦语义', () => {
  const self = fs.readFileSync(new URL(import.meta.url), 'utf8');

  // 边界声明必须留在文件头部注释里——否则后来者会把「6/6 全绿」误读为
  // 「该纪律已获机械保障」，形成新的自欺面（这是本单自身的教训所指向的同一类风险）。
  assert.match(self, /保证边界/, '必须如实声明本守卫的保证边界');
  assert.match(self, /只拦形态、不拦语义/, '必须写明「只拦形态、不拦语义」');
  assert.match(self, /源码文本断言/, '必须写明这些断言是源码文本断言');

  // 并且必须写明：不得据本文件的全绿声明该纪律已获机械保障。
  assert.match(
    self,
    /不得据本文件的全绿声明/,
    '必须写明不得据本文件全绿声明「已获机械保障」',
  );

  // 注：此处**不**再对「已获机械保障」一类短语做否定断言——该短语必然出现在
  // 本文件的边界声明与其断言消息里（声明正是在引用它来禁止它），任何全文或剥注释
  // 匹配都会自指。上列四项正向断言（要求声明存在且措辞明确）已足以承载意图；
  // 强行加一条自指断言只会产生一个永远失败或永远空转的守卫。
});
