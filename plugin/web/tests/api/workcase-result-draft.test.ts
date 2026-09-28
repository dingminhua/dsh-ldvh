// 「## 结果」节解析的契约测试（`shared/workcaseResultDraft`）。
//
// 判据是 21 §8 登记的三词（达成 / 部分达成 / 未达成）与**去向的两种形态**：
//   · **合并式**（2026-09-28 二次修订后的新写入）：去向**长在每条残留里面**
//     ——`- residual:` 段下每条残留条目自带一个更深一层的去向子项；
//   · **分离式**（存量，`§15.3` 存量不溯及）：`- residual:` 段与 `- advice:` 段各自独立。
// `§15.3` 明文「呈现层必须读两种形态」——这是「不溯及」在消费侧的必要条件。
//
// 解析器只认形态、不猜语义——所以这里既断言「认得了」，也断言「认不出时落空」。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WORKCASE_CHECK_STATUSES,
  WORKCASE_ADVICE_KINDS,
  WORKCASE_ADVICE_LEGACY_KINDS,
  parseWorkCaseResultDraft,
  parseWorkCaseCancellation,
  resultSectionOf,
  workCaseClosureNarrowsResidual,
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
  // 去向闭集（21 §8）：2026-09-28 由四词收为二词——四词里「另立工单」「直接行动」
  // 都不产生可回指的稳定标识，去向有无归宿只能靠读散文判断。
  assert.deepEqual([...WORKCASE_ADVICE_KINDS], ['接受现状', '转入 Spark']);
  // 存量词（2026-09-28 前登记的闭集）：不再是闭集取值，只为呈现保留——
  // 既有载体里还写着它们，记 null 会让卡面显示成「未归类」，是信息损失。
  assert.deepEqual([...WORKCASE_ADVICE_LEGACY_KINDS], ['另立工单', '直接行动']);
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

// **分离式（存量）**：`- advice:` 段独立存在（`§15.3` 存量不溯及）。新写入不再产生
// 该形态（21 §8：不再另设独立的建议段），但既有 16 份 closed 载体都是它，必须可读。
test('存量分离式：`- advice:` 段内每条给去向与内容', () => {
  const body = bodyOf([
    '- advice:',
    '  - **接受现状**：弹窗行为不再跟踪，理由是该期无宿主可验。',
    '  - **转入 Spark**：把级联信号拆成独立议题。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice, [
    { kind: '接受现状', text: '弹窗行为不再跟踪，理由是该期无宿主可验。' },
    { kind: '转入 Spark', text: '把级联信号拆成独立议题。' },
  ]);
});

test('存量分离式：存量词仍认得（只作呈现），但已不是闭集取值', () => {
  const body = bodyOf([
    '- advice:',
    '  - **另立工单**：另立一单实现级联信号。',
    '  - **直接行动**：把该分支改为 fail-closed。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  // 存量载体里还写着这两词（§15.3 存量不溯及）。记 null 会让卡面显示成「未归类」，
  // 而它们在当时的词表里有明确含义——呈现层保留其原本去向是信息更全的做法。
  // 写入侧另有独立门禁（validateDirectionCompleteness 只认二词），不受此处影响。
  assert.deepEqual(d.advice.map((a) => a.kind), ['另立工单', '直接行动']);
});

// 存量尾注（`21 §8` 2026-09-28 前登记的形态）：新形态靠**按序配对**与
// `result.residual` 对应，尾注不再是任何字段的来源。但存量载体里它还在，
// 若原样留在正文里就会混进卡面，把「某条残留」这类元信息当成去向正文显示。
test('存量分离式：存量的 `出自「…」` 尾注被剥离，且不产出任何字段', () => {
  const body = bodyOf([
    '- advice:',
    '  - **接受现状**：以同一手法普查其余六类。出自「同型缺陷未普查其余六类」',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice, [{ kind: '接受现状', text: '以同一手法普查其余六类。' }]);
  assert.ok(
    !('from' in d.advice[0]),
    '尾注已不是字段来源（21 §8 已删该项），不得再产出 from',
  );
});

test('存量分离式：未登记的去向词记 null（不静默归一到近似词）', () => {
  const body = bodyOf([
    '- advice:',
    '  - **修复**：把该分支改为 fail-closed。',
    '  - **观察**：下一轮再看。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice.map((a) => a.kind), [null, null]);
});

// 段收束（`21 §10.2`）：Gate 2 提请有两个不同层的东西——「剩余责任的去向」
// （**逐条**，落在建议段，缩进 2）与「关闭后的后续方向」（**整单一条**，是正文里
// 另一个顶层 bullet，缩进 0）。后者不应被吞入建议段。
//
// 实测来源（2026-09-27，workcase-63700bd2）：缺收束时该行走同一 push 分支，产出一条
// `kind: null` 的伪条目——卡面因此多出一条空分类的「去向」，与 §10.2 的分层相悖。
// 同款收束早已存在于 `residual` 段（见下方残留测试），本段是遗漏的一处。
test('存量分离式：同级或更浅的 bullet 结束本段，不吞入「关闭后的后续方向」', () => {
  const body = bodyOf([
    '- advice:',
    '  - **另立工单**：补 goal 路由的 yaml_source 投影。',
    '  - **接受现状**：dist 的生产部署不在本单验证范围。',
    '- 关闭后的后续方向（整单一条）：本单关闭后这条线不再有待办。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  // 只应产出建议段内的 2 条；整单那一条既不入 advice，也不得产生 kind=null 的伪条目。
  assert.deepEqual(d.advice.map((a) => a.kind), ['另立工单', '接受现状']);
  assert.equal(
    d.advice.length,
    2,
    '「关闭后的后续方向」是 §10.2 的整单一条、与逐条去向不同层，不得并入 advice',
  );
  // 且它不得被误收进其它段。
  assert.deepEqual(d.residual, []);
});

// 多建议段（2026-09-28 更正）：此前本解析器对每个 `- advice:` 开启符都**无条件切换**
// 且不清空 `result.advice`，于是多段形态下**累积**读取全部段；而受控写入器只读一段。
// 同一正文在两处给出不同条数，使「建议段条数 = result.residual 长度」这条硬门禁在
// 呈现层失去意义。现两处同口径（第二个开启符即闭合并跳过，不累积）；多开启符形态
// 另由写入器硬门禁⑤整体拒绝（21 §8/§15.1），且⑤**状态无关**，故它在任何状态都不可达。
// 本处只需保证：万一读到，两处也不得给出不同条数。
test('存量分离式：多处开启符不累积，与写入器同口径（21 §8/§15.1）', () => {
  const body = bodyOf([
    '- advice:',
    '  - **接受现状**：第一段的原因甲。',
    '  - **接受现状**：第一段的原因乙。',
    '- advice:',
    '  - **接受现状**：第二段的原因丙。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice, [
    { kind: '接受现状', text: '第一段的原因甲。' },
    { kind: '接受现状', text: '第一段的原因乙。' },
  ]);
  assert.equal(
    d.advice.length,
    2,
    '建议段不累积——累积会把第二段的 1 条并入，与写入器的条数判定分歧（旧实现读 3 条）',
  );

  // 对照（避免上一条因「整段解析全失效」而空转）：单段三照样读满。
  const single = bodyOf([
    '- advice:',
    '  - **接受现状**：原因甲。',
    '  - **接受现状**：原因乙。',
  ]);
  assert.deepEqual(parseWorkCaseResultDraft(single, PLAN).advice.length, 2);

  // 首段为空、次段有条目 → 0 条：第二个开启符已闭合首段，其后的条目不再计入
  // （而不是「跳过空首段取次段」）。
  const emptyFirst = bodyOf([
    '- advice:',
    '- advice:',
    '  - **接受现状**：只在第二段里。',
  ]);
  assert.deepEqual(
    parseWorkCaseResultDraft(emptyFirst, PLAN).advice,
    [],
    '首段为空时不得顺延到次段——写入器同样不累积（第二个开启符即闭合首段，两处须逐案同数）',
  );
});

test('residual 里的「建议…」子句不再产出条目（21 §8：去向只有一处承载）', () => {
  const body = bodyOf([
    '- residual:',
    '  - **缺口 A 未修复**：无法机械判定。建议另立一单，其前置为先实现级联信号。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice, []);
});

// 残留条目本身要产出（2026-09-24 补抽取）：此前该段「只识别、不抽取」，因为当期的卡
// 不显示残留。卡面新增残留块后，本段是该期残留的**唯一数据源**（无 result 字段可读）。
test('residual 段产出条目（待批准关闭卡的唯一数据源）', () => {
  const body = bodyOf([
    '- residual:',
    '  - **缺口 A 未修复**：无法机械判定。',
    '  - 存量对象未迁移，不在本单范围。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.residual, [
    '**缺口 A 未修复**：无法机械判定。',
    '存量对象未迁移，不在本单范围。',
  ]);
  // 不剥标记：剥标记是呈现层的事（@/utils/cardText），解析层逐条忠实给出
  assert.ok(d.residual[0].includes('**'), '解析层不得剥离 Markdown（呈现层负责）');
  // `residual` 是 `residualEntries[].text` 的**投影**（同一次解析的同一份数据）——
  // 两者不可能漂移，故此处直接断言该恒等关系。
  assert.deepEqual(d.residualEntries.map((entry) => entry.text), d.residual);
  // 无去向子项时 `directions` 为空数组（不是缺失、也不是 null）。
  assert.deepEqual(d.residualEntries.map((entry) => entry.directions), [[], []]);
});

// ── 合并式（2026-09-28 二次修订后的新写入形态，21 §8）──────────────────────────
//
// 去向不再是独立的一段，而是**长在每条残留里面**：残留条目比开启符更深（登记形态为
// 缩进 2），去向子项又比残留条目更深（再缩进 2）。「第 k 条去向 ↔ 第 k 条残留」的对应
// **由结构本身承载**（不再是需要核验的写法约定）。
test('合并式：残留条目 → 其去向子项（子项挂在该条残留上）', () => {
  const body = bodyOf([
    '- residual:',
    '  - 残留 A：第二条判据的关闭路径用例尚未覆盖。',
    '    - **接受现状**：该分支已被后续工作覆盖，继续跟踪无增量。',
    '  - 残留 B：跨会话的残留去向尚未验证。',
    '    - **转入 Spark**：边界情形需跨行动推进，转入议题待裁。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.residualEntries, [
    {
      text: '残留 A：第二条判据的关闭路径用例尚未覆盖。',
      directions: [{ kind: '接受现状', text: '该分支已被后续工作覆盖，继续跟踪无增量。' }],
    },
    {
      text: '残留 B：跨会话的残留去向尚未验证。',
      directions: [{ kind: '转入 Spark', text: '边界情形需跨行动推进，转入议题待裁。' }],
    },
  ]);
  // 平铺视图（关闭期去向条提升为平级行，10 §5.5）与主从视图**同源同序**。
  assert.deepEqual(
    d.advice,
    d.residualEntries.flatMap((entry) => entry.directions),
    '平铺去向须与主从结构同源——两处若各自解析会漂移',
  );
});

test('合并式：判别靠缩进，不靠加粗形态——不达形态者照样计入该残留的子项（kind: null）', () => {
  // §15.1 判据边界第三条明文：去向条目深度正确、但不达 `- **<去向词>**：<正文>` 形态
  // （如缺 `**` 包裹）时，**该条目不被丢弃、照常计入子项数**；拒绝发生在**去向词闭集
  // 分支**（写入侧门禁⑥），**不是**条数不符。呈现层同样不得丢弃它——否则同一正文在
  // 写入器与呈现层给出不同条数，条数门禁在呈现层失去意义。
  const body = bodyOf([
    '- residual:',
    '  - 残留 A',
    '    - 接受现状：就此了结，原因是策略已变。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.equal(d.residualEntries.length, 1, '不达形态的子项不得被当成新残留条目');
  assert.deepEqual(d.residualEntries[0].directions, [
    { kind: null, text: '接受现状：就此了结，原因是策略已变。' },
  ]);
});

test('合并式：与残留条目同级或更浅的去向条目不构成子项，自己成为新残留条目', () => {
  // §8「登记形态包含缩进」：去向子项须比残留条目**更深**；与残留条目同级或更浅者
  // 不构成该残留的子项（按零条计），此时它自己成为一条新残留条目。
  const body = bodyOf([
    '- residual:',
    '  - 残留 A',
    '  - **接受现状**：与残留条目同级，故不是子项而是新残留条目。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.equal(d.residualEntries.length, 2, '同级条目计为新残留条目');
  assert.deepEqual(d.residualEntries.map((entry) => entry.directions), [[], []]);
  assert.deepEqual(d.advice, [], '同级条目不是去向，不得进入平铺去向');
});

test('合并式：去向子项不累积到别的残留——只挂其上方的最近一条', () => {
  const body = bodyOf([
    '- residual:',
    '  - 残留 A',
    '    - **接受现状**：原因甲。',
    '  - 残留 B',
    '    - **接受现状**：原因乙。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(
    d.residualEntries.map((entry) => entry.directions.length),
    [1, 1],
    '每条去向只挂其上方的最近一条残留',
  );
});

test('合并式：多开启符不累积，与写入器同口径（21 §8/§15.1 硬门禁①）', () => {
  // 写入器用「第二个开启符即闭合并跳过」的同一状态机；多开启符形态另由门禁①在受控
  // 写入层**整体拒绝**（且①状态无关）。本处只需保证：万一读到，两处也不得给出不同条数。
  const body = bodyOf([
    '- residual:',
    '  - 残留 A',
    '    - **接受现状**：第一段的原因甲。',
    '- residual:',
    '  - 残留 B',
    '    - **接受现状**：第二段的原因乙。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.residual, ['残留 A'], '残留段不累积——第二个开启符即闭合首段');
  assert.deepEqual(d.residualEntries.map((entry) => entry.directions.length), [1]);

  // 对照（避免上一条因「整段解析全失效」而空转）：单段两条照样读满。
  const single = bodyOf([
    '- residual:',
    '  - 残留 A',
    '    - **接受现状**：原因甲。',
    '  - 残留 B',
    '    - **接受现状**：原因乙。',
  ]);
  assert.equal(parseWorkCaseResultDraft(single, PLAN).residualEntries.length, 2);
});

// ── 条件豁免判据（决定 A，10 §5.5 / 21 §15.3）────────────────────────────────
//
// 判据「该对象每条残留都带有去向子项」是**机械可判**的（10 §5.5 明文：与 21 §15.1
// 门禁③同口径），且由本模块**单点给出**——卡面与详情两处消费同一个值，不得各写一套。
test('条件豁免判据：每条残留都带去向子项 → 收窄；否则如实保留残留', () => {
  const combined = bodyOf([
    '- residual:',
    '  - 残留 A',
    '    - **接受现状**：原因甲。',
    '  - 残留 B',
    '    - **转入 Spark**：转入议题待裁。',
  ]);
  const d1 = parseWorkCaseResultDraft(combined, PLAN);
  assert.equal(workCaseClosureNarrowsResidual(d1.residualEntries), true, '合并式（每条都带去向下）应收窄');

  // 缺一条去向 → 不收窄（这正是存量 6 份的形态：22 条残留当年就没有去向）。
  const partial = bodyOf([
    '- residual:',
    '  - 残留 A',
    '    - **接受现状**：原因甲。',
    '  - 残留 B',
  ]);
  const d2 = parseWorkCaseResultDraft(partial, PLAN);
  assert.equal(workCaseClosureNarrowsResidual(d2.residualEntries), false, '有残留缺去向 → 不得收窄');

  // 分离式（去向在另一段，不挂在残留上）→ 不收窄。这是存量 16/17 份的实际形态。
  const separated = bodyOf([
    '- residual:',
    '  - 残留 A',
    '  - 残留 B',
    '- advice:',
    '  - **接受现状**：原因甲。',
  ]);
  const d3 = parseWorkCaseResultDraft(separated, PLAN);
  assert.equal(d3.residual.length, 2, '分离式的残留照样读出');
  assert.equal(d3.advice.length, 1, '分离式的去向照样读出');
  assert.equal(workCaseClosureNarrowsResidual(d3.residualEntries), false, '分离式 → 不得收窄');

  // 边界：空数组、无残留、非数组输入一律**不收窄**（fail closed：未知不等于满足前提）。
  for (const input of [[], undefined, null, 'x'] as unknown[]) {
    assert.equal(
      workCaseClosureNarrowsResidual(input as never),
      false,
      `${JSON.stringify(input)} 不得被判为「满足前提」`,
    );
  }
});

test('residual 段在遇到同级/更浅的 bullet 时正确收束', () => {
  const body = bodyOf([
    '- residual:',
    '  - 第一条残留。',
    '  - 第二条残留。',
  ]) + '\n- 段外条目不应被吞入。\n';
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.residual, ['第一条残留。', '第二条残留。']);
});

test('未配对/无结果节：返回空草稿而不是抛错', () => {
  const EMPTY = { checks: [], advice: [], residual: [], residualEntries: [], adviceNote: null };
  assert.deepEqual(parseWorkCaseResultDraft('## 执行\n无结果节', PLAN), EMPTY);
  assert.deepEqual(parseWorkCaseResultDraft(undefined, PLAN), EMPTY);
  assert.deepEqual(parseWorkCaseResultDraft('## 结果\n- 无有效条目', undefined), EMPTY);
});

test('存量分离式判别力：去向词必须在行首加粗，否则记未归类', () => {
  const body = bodyOf([
    '- advice:',
    '  - 建议另立工单补该路由的投影。',
    '  - **接受现状**：弹窗行为不再跟踪。',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.deepEqual(d.advice, [
    // 无加粗行首 → 判不出去向（旧实现按关键词猜成「另立工单」，已按 21 §8 收紧）
    { kind: null, text: '建议另立工单补该路由的投影。' },
    { kind: '接受现状', text: '弹窗行为不再跟踪。' },
  ]);
});

// 取消记录（21 §8，仅 outcome=cancelled）：`- cancellation:` 下两行均必填。
// 该承载的引入理由：本仓唯一一份 cancelled 对象曾把「取消理由」与「未发生的范围」
// 合并写进 `achieved_scope`（语义为「已证实范围」，即做成了什么）——而取消恰恰意味着
// 什么都没做；机械层对该字段只校验非空，故「本工单取消」四字同样通过，呈现层取不到。
test('取消记录：两行齐备时解析出理由与未发生的范围', () => {
  const body = bodyOf([
    '- cancellation:',
    '  - **理由**：方向调整，本工单不再需要。',
    '  - **未发生的范围**：三步全未执行，无任何工程改动。',
  ]);
  assert.deepEqual(parseWorkCaseCancellation(body), {
    reason: '方向调整，本工单不再需要。',
    unstartedScope: '三步全未执行，无任何工程改动。',
  });
});

test('取消记录：缺任一行时对应字段记空串（不猜、不填占位）', () => {
  const onlyReason = bodyOf(['- cancellation:', '  - **理由**：方向调整。']);
  assert.deepEqual(parseWorkCaseCancellation(onlyReason), { reason: '方向调整。', unstartedScope: '' });
  const onlyScope = bodyOf(['- cancellation:', '  - **未发生的范围**：三步全未执行。']);
  assert.deepEqual(parseWorkCaseCancellation(onlyScope), { reason: '', unstartedScope: '三步全未执行。' });
  // 空值行与缺失行同等对待（都记空串），不把空白当内容。
  const blank = bodyOf(['- cancellation:', '  - **理由**：   ', '  - **未发生的范围**：三步全未执行。']);
  assert.equal(parseWorkCaseCancellation(blank)?.reason, '');
});

test('取消记录：无该段时返回 null（非取消对象不产出）', () => {
  assert.equal(parseWorkCaseCancellation(bodyOf(['- criteria_checks:', '  - 步骤 1：达成。'])), null);
  assert.equal(parseWorkCaseCancellation('## 执行\n无结果节'), null);
  assert.equal(parseWorkCaseCancellation(undefined), null);
});

test('取消记录：段后接其它 bullet 时正确收束（不被 residual 吞并）', () => {
  const body = bodyOf([
    '- cancellation:',
    '  - **理由**：方向调整。',
    '  - **未发生的范围**：三步全未执行。',
    '- residual:',
    '  - 弹窗行为仍未验证。',
  ]);
  assert.deepEqual(parseWorkCaseCancellation(body), {
    reason: '方向调整。',
    unstartedScope: '三步全未执行。',
  });
});

// 事后补记声明（`21 §8`）：为建议段登记前已关闭的对象补写去向时，段前须声明
// 「本条为事后补记，非关闭当时的 Gate 2 提请内容」。该声明**必须带上卡面**——
// 否则卡面读者仍会以为这段去向当初被提请过，声明就失去意义。
test('建议段前的事后补记声明被识别并带上（21 §8）', () => {
  const body = bodyOf([
    '**本条为 2026-09-24 事后补记，非关闭当时的 Gate 2 提请内容。**',
    '',
    '- advice:',
    '  - **直接行动**：更正该文档的列举。出自「某条残留」',
  ]);
  const d = parseWorkCaseResultDraft(body, PLAN);
  assert.equal(d.adviceNote, '**本条为 2026-09-24 事后补记，非关闭当时的 Gate 2 提请内容。**');
  assert.equal(d.advice.length, 1);
});

// 负向：**不得**把任意前文当声明。本条首版用「建议段前的段落」这种宽判据，实测
// 把标题（`### Gate 2 提请`）、清单行（`1. workcase tab …`）、正文段落都抓了进来——
// 那会把噪音送上卡面。故改为按固定写法精确匹配。
test('建议段前的一般段落不被误当补记声明', () => {
  for (const prefix of [
    '### Gate 2 提请',
    '1. workcase tab 出现 SG 筛选且选项源跟随 goal 子目标。',
    '2. 记录结果并按 Human 选择处置本工单。',
    '一句普通说明。',
  ]) {
    const body = bodyOf([prefix, '', '- advice:', '  - **接受现状**：无需跟踪。']);
    const d = parseWorkCaseResultDraft(body, PLAN);
    assert.equal(d.adviceNote, null, `「${prefix}」不应被当作补记声明`);
    assert.equal(d.advice.length, 1);
  }
});

// 未补写的对象不应有该行（避免给存量对象凭空加声明）
test('无补记声明时 adviceNote 为 null', () => {
  const body = bodyOf(['- advice:', '  - **直接行动**：X。']);
  assert.equal(parseWorkCaseResultDraft(body, PLAN).adviceNote, null);
});
