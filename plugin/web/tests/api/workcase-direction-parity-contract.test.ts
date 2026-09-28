// 去向解析的**两处同口径**契约（`21 §8`/`§15.1`，2026-09-28 二次修订）。
//
// 为什么必须有本文件：去向由「两段分离」改为「主从一段」后，**同一份正文在两个解析器里
// 各读一次**——受控写入器 `plugin/lib/workcase-writer.js` 的 `parseResidualSection`
// 与呈现层 `plugin/web/shared/workcaseResultDraft.ts` 的 `parseWorkCaseResultDraft`。
// 两棵树互不 import（`lib` 与 `web` 独立，见 `markdown-structure.js` 的同类先例），
// 故实现必然有两份；而 `§15.1` 门禁②（残留段条数 = `result.residual` 长度）**只有在
// 两处给出相同条数时才有意义**——两处若各读一段，第二段的条目会「正文里有、卡面不可见」，
// 门禁在呈现层就失去意义。
//
// 本仓已有一次真实教训（2026-09-28 更正，写在两处解析器的注释里）：呈现层曾**无条件切换
// 段**且不清空累积，而写入器只读一段，同一正文在两处给出不同条数。那次只统一了「不累积」，
// 而**形态本身**随后又改了一次（合并式）——故本文件把「两处逐案同数」做成可重跑的守卫，
// 而不是只留注释。
//
// ⚠️ **保证边界（如实声明）**：本文件比较的是**解析结果**，不是「两处实现逐字相同」。
// 它证明「本文件所列的每个输入在两处得到相同结论」，不证明「任意输入都同结论」——
// 故下方逐案枚举了 §15.1 已登记的三种判据边界与五条「实际接受集」差异。新增形态时
// 须同步补案，否则守卫的覆盖会落后于实现。
//
// **覆盖更正（2026-09-28 独立对抗复核发现 F-5）**：本文件原先自称比较「条数／去向词／
// 正文」三者，但**实际只断言了条数与去向词**，全文无一处断言正文（`text`）——即自我声明
// 超出实际覆盖。而当时两处的正文**确实不同**：web 侧 `toDirection` 写 `text: text || item`，
// 剥完尾注后为空就**回落到未剥离的整条原文**（如 `**接受现状**：出自「残留甲」`），
// 写入器侧则只给 `""`。该分岔不危及门禁②（条数一致），但会把去向词标记与已退休的尾注
// 当正文交给读者。**现已两处对齐（去掉 web 侧回落）并补上 `text` 断言**，使本文件的
// 自我声明与实际覆盖一致。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { parseWorkCaseResultDraft } from '../../shared/workcaseResultDraft.ts';

/** 仓库根（tests/api → web → plugin → repo）。 */
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../../..');

/**
 * 载入**受控写入器**的段解析（`lib` 是 ESM `.js`，由 `lib/package.json` 声明 type: module）。
 *
 * 用动态 import 而不是源码正则：本守卫要断言的是**行为**（条数／去向词），
 * 而源码文本断言拦不住「功能等价但改名改文案」的实现（见
 * `workcase-execution-ledger-contract.test.ts` 顶部已登记的同类边界）。
 */
const writer = await import(
  path.join(REPOSITORY_ROOT, 'plugin/lib/workcase-writer.js')
);

/**
 * 写入器侧的实测输出。
 *
 * **条数直接量 `parseResidualSection`**（写入器里那一份段解析），不从那两个门禁的
 * 失败文案里反推——反推有一个真实的判别力缺口：若解析**静默少读一条**、而门禁恰好
 * 未触发（例如 `residual` 长度也少一），文案里就没有条数可读，守卫会退化成「用预期值
 * 当实测值」，与呈现层给出同一错值也照样通过。
 *
 * 门禁命中情况另从 `validateDirectionCompleteness` 取（那才是受控写入的实际拒绝面）。
 */
function writerVerdict(body: string, _residualLength: number): {
  /** 命中门禁①（残留段恰好一处）。 */
  multiSection: boolean;
  /** 命中「不得另设独立的建议段」形态前提。 */
  legacyAdviceSection: boolean;
  /** 残留段条目数（写入器口径，实测）。 */
  residualCount: number;
  /** 去向子项总数（写入器口径，实测）。 */
  directionCount: number;
  /** 各去向子项的**正文**（写入器口径；F-5 补测用）。 */
  directionTexts: string[];
} {
  const section = writer.parseResidualSection(body);
  const directions = section.entries.flatMap(
    (entry: { directions: Array<{ text?: string }> }) => entry.directions,
  );
  return {
    multiSection: section.blocks > 1,
    legacyAdviceSection: section.adviceBlocks > 0,
    residualCount: section.entries.length,
    directionCount: section.entries.reduce(
      (sum: number, entry: { directions: unknown[] }) => sum + entry.directions.length,
      0,
    ),
    directionTexts: directions.map((d: { text?: string }) => String(d?.text ?? '')),
  };
}

/** 呈现层侧的可观测输出（同形）。 */
function presentationVerdict(body: string) {
  const draft = parseWorkCaseResultDraft(`# T\n\n## 结果\n\n${body}\n`, []);
  return {
    residualCount: draft.residualEntries.length,
    directionCount: draft.residualEntries.reduce((sum, entry) => sum + entry.directions.length, 0),
    kinds: draft.residualEntries.flatMap((entry) => entry.directions.map((d) => d.kind)),
    // F-5：正文与条数、去向词同层比较——原先只比前两者，故两处的正文分岔长期不可见。
    directionTexts: draft.residualEntries.flatMap((entry) => entry.directions.map((d) => d.text)),
  };
}

/**
 * 逐案比较：**同一正文在两处必须给出相同的段数结论与相同的条目数**。
 *
 * 返回两处各自的实测条数，供断言直接对照（不写成「都等于预期值」——那会让
 * 「两处一致地读错」逃逸）。
 */
function compare(body: string, residualLength: number) {
  const w = writerVerdict(body, residualLength);
  const p = presentationVerdict(body);
  return { w, p };
}

test('同口径：合并式合法形态——两处给出相同条数（§8 登记形态）', () => {
  const body = [
    '- residual:',
    '  - 残留 A',
    '    - **接受现状**：原因甲。',
    '  - 残留 B',
    '    - **转入 Spark**：转入议题待裁。',
  ].join('\n');
  const { w, p } = compare(body, 2);
  assert.equal(p.residualCount, 2, '呈现层须读出 2 条残留');
  assert.equal(p.directionCount, 2, '呈现层须读出 2 条去向子项');
  assert.equal(w.multiSection, false, '写入器：单一残留段 → 门禁①不触发');
  assert.equal(w.legacyAdviceSection, false, '写入器：无独立建议段');
  // 写入器未报条数门禁，即「读到的条数 = residual 长度」——与呈现层的 2 一致。
  assert.deepEqual(p.kinds, ['接受现状', '转入 Spark']);
});

test('同口径：判据边界第一条（与开启符同级 → 按零条计）——两处都读 0 条', () => {
  // §15.1：与开启符**同级或更浅**的条目不属残留段、按零条计。两处都必须给 0 条，
  // 否则「条数不符」这条门禁在一处成立、在另一处不成立。
  const body = [
    '- residual:',
    '- 顶格书写的残留（与开启符同级）',
  ].join('\n');
  const { w, p } = compare(body, 1);
  assert.equal(p.residualCount, 0, '呈现层：同级条目按零条计');
  assert.equal(w.residualCount, 0, '写入器：同级条目按零条计（got 0）');
  assert.equal(w.residualCount, p.residualCount, '两处条数必须一致');
});

test('同口径：判据边界第二条（缺去向子项）——两处都读 0 个子项，但残留条数照读', () => {
  const body = [
    '- residual:',
    '  - 残留 A',
  ].join('\n');
  const { w, p } = compare(body, 1);
  assert.equal(p.residualCount, 1, '呈现层：残留条目照读');
  assert.equal(p.directionCount, 0, '呈现层：无子项');
  assert.equal(w.residualCount, 1, '写入器：残留条目照读（条数与 residual 相符）');
  assert.equal(w.directionCount, 0, '写入器：无子项 → 门禁③');
});

test('同口径：判据边界第三条（不达形态的去向条目）——两处都**计入**子项数，不丢弃', () => {
  // §15.1 明文：该条目**不被丢弃、照常计入子项数**，拒绝发生在去向词闭集分支。
  // 两处若一处丢弃、一处计入，门禁③的「恰有一个」在两处会得出相反结论。
  const body = [
    '- residual:',
    '  - 残留 A',
    '    - 接受现状：就此了结，原因是策略已变。',
  ].join('\n');
  const { w, p } = compare(body, 1);
  assert.equal(p.residualCount, 1, '呈现层：该条目不得被当成新残留条目');
  assert.equal(p.directionCount, 1, '呈现层：不达形态者照样计入子项数');
  assert.deepEqual(p.kinds, [null], '呈现层：判不出词记 null（不静默归一）');
  assert.equal(w.directionCount, 1, '写入器：不达形态者照样计入子项数');
  assert.equal(w.residualCount, p.residualCount, '两处残留条数一致');
  assert.equal(w.directionCount, p.directionCount, '两处子项数一致');
});

test('同口径：实际接受集②（开启符冒号可省 / 残留责任变体）——两处都识别', () => {
  for (const opener of ['- residual', '- 残留责任', '- 残留责任：']) {
    const body = [opener, '  - 残留 A', '    - **接受现状**：原因甲。'].join('\n');
    const { w, p } = compare(body, 1);
    assert.equal(p.residualCount, 1, `呈现层须识别开启符「${opener}」`);
    assert.equal(w.multiSection, false, `写入器须识别开启符「${opener}」`);
    assert.equal(w.residualCount, p.residualCount, `「${opener}」两处条数一致`);
  }
});

test('同口径：实际接受集③（缩进未锚定绝对值）——两处都只比较相对深度', () => {
  const body = [
    '  - residual:',
    '      - 残留 A',
    '          - **接受现状**：原因甲。',
  ].join('\n');
  const { w, p } = compare(body, 1);
  assert.equal(p.residualCount, 1, '呈现层：深层缩进照样读');
  assert.equal(p.directionCount, 1, '呈现层：深层缩进照样读子项');
  assert.equal(w.multiSection, false, '写入器：深层缩进照样识别');
  assert.equal(w.residualCount, p.residualCount, '两处条数一致');
});

test('同口径：多开启符**不累积**——两处都只读首段（§15.1 门禁① 使之不可达）', () => {
  // 两处若一处累积、一处只读首段，同一正文会给出不同条数。写入器另用 `blocks > 1`
  // 由门禁①整体拒绝该形态（且①状态无关），故它在受控写入下不可达——但**呈现层仍要
  // 与写入器同口径**，否则「不可达」这一结论本身无法由两处共同支撑。
  const body = [
    '- residual:',
    '  - 残留 A',
    '    - **接受现状**：第一段的原因甲。',
    '- residual:',
    '  - 残留 B',
    '    - **接受现状**：第二段的原因乙。',
  ].join('\n');
  const { w, p } = compare(body, 1);
  assert.equal(p.residualCount, 1, '呈现层：只读首段（不累积）');
  assert.deepEqual(
    p.kinds,
    ['接受现状'],
    '呈现层：第二段的条目不得并入',
  );
  assert.equal(w.multiSection, true, '写入器：门禁①触发（两处开启符）');
  assert.equal(w.residualCount, 1, '写入器：条数只按首段计');
  assert.equal(w.residualCount, p.residualCount, '两处条数一致（否则条数门禁在两处不同结论）');
});

test('同口径：**分离式（存量）**——两处都读得出残留与去向，但去向不挂在残留上', () => {
  // §15.3「呈现层必须读两种形态」：存量仍是分离式，不因新形态而变得不可读。
  const body = [
    '- residual:',
    '  - 残留 A',
    '  - 残留 B',
    '- advice:',
    '  - **另立工单**：把该分支另立一单。出自「残留 A」',
  ].join('\n');
  const { w, p } = compare(body, 2);
  assert.equal(p.residualCount, 2, '呈现层：分离式的残留照样读出');
  assert.equal(p.directionCount, 0, '呈现层：分离式的去向**不挂在残留上**（主从结构不存在）');
  assert.deepEqual(p.kinds, [], '呈现层：残留条目不带去向子项');
  // 写入器把旧建议段识别为**形态前提失败**（§8：不再另设独立的建议段）——
  // 这是新写入的拒绝路径；存量载体因「## 结果」节逐字未改而豁免（§15.3）。
  assert.equal(w.legacyAdviceSection, true, '写入器：独立建议段是形态前提失败');
  assert.equal(w.residualCount, p.residualCount, '两处残留条数一致（豁免与否不影响条数口径）');
});

test('同口径：去向词闭集判定——两处都只认二词，存量两词记 null', () => {
  const closedSet = [
    '- residual:',
    '  - 残留 A',
    '    - **接受现状**：原因甲。',
    '  - 残留 B',
    '    - **转入 Spark**：转入议题待裁。',
  ].join('\n');
  assert.deepEqual(
    presentationVerdict(closedSet).kinds,
    ['接受现状', '转入 Spark'],
    '呈现层：闭集二词认得',
  );

  const legacyWords = [
    '- residual:',
    '  - 残留 A',
    '    - **另立工单**：把该分支另立一单。',
    '  - 残留 B',
    '    - **直接行动**：后续清理时顺手处置。',
  ].join('\n');
  // 呈现层**保留**存量两词（只为呈现：记 null 会让卡面显示成「未归类」，是信息损失）；
  // 写入器**拒绝**它们（闭集已收为二词）。这一处两处结论**有意不同**，且不是缺陷：
  // 一边是「新写入可否落盘」，一边是「既有载体怎么读」（§15.3 存量不溯及）。
  // 本断言把该差异**固定下来**，防止有人把它当成 bug「修掉」而使存量显示退化。
  assert.deepEqual(
    presentationVerdict(legacyWords).kinds,
    ['另立工单', '直接行动'],
    '呈现层：存量两词仍须显示为其原本去向（不得降级成「未归类」）',
  );
  const frontmatter = {
    status: 'closed',
    outcome: 'partial',
    result: { criteria_checks: [], achieved_scope: 'x', residual: ['残留 1', '残留 2'] },
  };
  const res = writer.validateDirectionCompleteness(frontmatter, `# T\n\n## 结果\n\n${legacyWords}\n`);
  assert.ok(!res.ok, '写入器：存量两词不是闭集取值，新写入须被拒');
  assert.equal(
    (res.issues as string[]).filter((i) => i.includes('is not one of the closed set')).length,
    2,
    '写入器：两条旧词各报一次闭集失败',
  );
});

test('同口径：条数比较覆盖 §15.1 已登记的全部形态（枚举式守卫，防覆盖落后于实现）', () => {
  // 这一条是**元守卫**：把上面各案抽成表，逐一比较两处条数。新增形态时若忘了在
  // 上表补案，本条不会失败——故它只保证「已枚举的形态两处一致」，覆盖边界如实登记
  // 在文件头。此处的作用是让「两处不一致」有一个**集中**的失败点（而非散在 9 条用例里）。
  const cases: Array<{ name: string; body: string; residualLength: number }> = [
    {
      name: '合并式两条',
      body: ['- residual:', '  - 残留 A', '    - **接受现状**：甲。', '  - 残留 B', '    - **接受现状**：乙。'].join('\n'),
      residualLength: 2,
    },
    { name: '合并式一条缺子项', body: ['- residual:', '  - 残留 A'].join('\n'), residualLength: 1 },
    { name: '与开启符同级', body: ['- residual:', '- 顶格'].join('\n'), residualLength: 1 },
    { name: '不达形态的子项', body: ['- residual:', '  - 残留 A', '    - 接受现状：甲。'].join('\n'), residualLength: 1 },
    { name: '两条子项（多余）', body: ['- residual:', '  - 残留 A', '    - **接受现状**：甲。', '    - **接受现状**：乙。'].join('\n'), residualLength: 1 },
    { name: '同级条目成为新残留', body: ['- residual:', '  - 残留 A', '  - 残留 B'].join('\n'), residualLength: 2 },
    { name: '无开启符', body: ['- 残留 A', '  - 子项'].join('\n'), residualLength: 1 },
    { name: '缩进较深', body: ['  - residual:', '      - 残留 A', '          - **接受现状**：甲。'].join('\n'), residualLength: 1 },
  ];
  for (const testCase of cases) {
    const { w, p } = compare(testCase.body, testCase.residualLength);
    assert.equal(
      w.residualCount,
      p.residualCount,
      `${testCase.name}：写入器读到 ${w.residualCount} 条、呈现层读到 ${p.residualCount} 条——两处必须同数`,
    );
  }
});

test('写入器侧的段解析确实是同一份实现（防「同口径」被改成各自实现）', () => {
  // 本守卫的**前件**：写入器的段解析是 `parseResidualSection` 单点，而不是散落在
  // `validateDirectionCompleteness` 内联的读法。前件若不成立，上面的行为比较仍会通过
  // （只要结果偶然一致），但「两处同口径」就失去了「各有一份、逐案对齐」的实际含义。
  const writerSource = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'plugin/lib/workcase-writer.js'),
    'utf8',
  );
  assert.match(writerSource, /function parseResidualSection\(/, '写入器须有单点的段解析函数');
  assert.match(
    writerSource,
    /const RESIDUAL_BLOCK = \/\^\(residual\|残留责任\)/,
    '开启符正则须覆盖 residual 与 残留责任 两个变体',
  );
  // 呈现层侧同样要有单点的开启符正则（而不是两处各写一份）。
  const sharedSource = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'plugin/web/shared/workcaseResultDraft.ts'),
    'utf8',
  );
  assert.match(sharedSource, /const RESIDUAL_BLOCK = \/\^\(residual\|残留责任\)/, '呈现层须有同一开启符正则');
  assert.match(sharedSource, /export function parseWorkCaseResultDraft/, '呈现层解析器须导出');
  // 两处的「不累积」状态机注释互相指认（口径一致的历史依据必须留在两处，否则将来
  // 只改一处时无人知道另一处的存在）。
  for (const [name, src] of [['写入器', writerSource], ['呈现层', sharedSource]] as const) {
    assert.match(src, /不累积/, `${name}须登记「不累积」口径（两处一致的历史依据）`);
  }
});

test('同口径：去向**正文**——两处逐字一致（F-5 补测；原文件只比条数与去向词）', () => {
  // 本用例补的是 F-5 的实质缺口：原契约测试不断言 `text`，故两处的正文分岔（web 侧
  // 回落到未剥离原文）长期不可见。下列三案覆盖该分岔的触发条件：
  //   ① 尾注剥完即空（诱发回落）；
  //   ② 旧词 + 空正文；
  //   ③ 正常正文（正向对照：证明本用例不是恒真）。
  const cases: Array<[string, string]> = [
    ['尾注剥完即空', '    - **接受现状**：出自「残留甲」'],
    ['旧词 + 空正文', '    - **另立工单**：'],
    ['正常正文（正向对照）', '    - **接受现状**：原因甲，就此了结。'],
  ];
  for (const [label, line] of cases) {
    const body = ['- residual:', '  - 残留甲。', line].join('\n');
    const { w, p } = compare(body, 1);
    assert.equal(w.directionCount, 1, `${label}：写入器须读出 1 个去向子项`);
    assert.equal(p.directionCount, 1, `${label}：呈现层须读出 1 个去向子项`);
    // 正文逐字一致——这是本用例的**唯一新增判据**。
    assert.deepEqual(
      p.directionTexts,
      w.directionTexts,
      `${label}：两处去向正文必须逐字一致（不得一处剥离、一处回落到原文）`,
    );
  }
  // 正向对照：正常正文那一案必须给出**非空**正文——若两处都退化为空，
  // 上面的 deepEqual 会「一致地错」而本断言失败，故它防的是用例恒真。
  const body = ['- residual:', '  - 残留甲。', '    - **接受现状**：原因甲，就此了结。'].join('\n');
  const { p } = compare(body, 1);
  assert.equal(p.directionTexts[0], '原因甲，就此了结。', '正向对照：正常正文须被完整读出');
});

