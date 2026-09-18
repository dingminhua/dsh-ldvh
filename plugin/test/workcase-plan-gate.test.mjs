// 21 §6.1（2026-09-18）：`plan` 不承载 WorkCase 生命周期关口的机械门禁。
//
// 背景：v5 丢失了 v4 §4.3 的「不得把受控提交/独立复核/Gate 写成 item」禁令
// （v4 于 commit 1e7d9584 引入，2026-08-09）。后果是 v5 几乎所有工单的 plan
// 末步都写着「验证三件套与受控提交」。本测试钉住新加的机械承载。
//
// v4 的教训（必须保留在测试意图里）：v4 只补了规范条文，2 天后仍复发
// （f1b44e85 08-06 → workcase-0079 08-08），因为 v4 自认「Code 不判断自然
// 语言是否属于生命周期关口」。故本承载的成败判据**不是**能拒绝多少，而是
// **不误伤**：模式必须只认「执行关口」的谓语形态，放行「实现/调研该机制」
// 这类本单实施工作。下列正向用例与负向用例同等重要。
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateWorkcaseFrontmatter } from "../lib/workcase-writer.js";

function planCase(plan, status = "draft") {
  return {
    fact_type_key: "workcase",
    object_uid: "00000000-0000-4000-8000-000000000000",
    title: "t",
    summary: "s",
    scope: "做什么：x。明确不做什么：y。",
    status,
    created_at: new Date().toISOString(),
    change_log: [{ at: new Date().toISOString(), provider: "p", model: "m", summary: "x" }],
    plan,
  };
}

function gateHit(plan) {
  const r = validateWorkcaseFrontmatter(planCase(plan));
  return (r.issues ?? []).some((i) => /lifecycle gate/.test(i));
}

// --- 正向：真实存量工单的关口形态必须被拒 -------------------------------

const REAL_GATE_STEPS = [
  ["验证三件套与受控提交", "writer 测试全绿、web 测试全绿、tsc 0 错误、eslint 无新增；受控提交且 Git Gate passed"],
  ["验证三件套、dist 重建与受控提交", "tsc 0 错误、web 测试全绿、eslint 无新增、dist 重建且 index.html 引用新 hash、Git Gate passed"],
  ["独立对抗审核、三件套与受控提交", "审核记录入 reviews；规范修订与实现分别独立受控提交且 Git Gate passed"],
  ["受控提交", "Git Gate passed，提交含代码、测试与说明"],
  ["受控提交与全量回归", "规范修订单独成提交且 Git Gate passed；既有测试全绿零回归"],
  ["完成独立结果复核", "复核报告留档"],
  ["主控自查执行记录", "自查完成"],
  ["执行 Gate 2 关闭", "outcome 落盘"],
];

for (const [step, crit] of REAL_GATE_STEPS) {
  test(`plan gate: rejects lifecycle gate step — ${step}`, () => {
    assert.ok(gateHit([{ step, done_criteria: crit }]), `expected rejection for: ${step}`);
  });
}

test("plan gate: rejects a gate step appearing in done_criteria only", () => {
  assert.ok(gateHit([{ step: "收尾", done_criteria: "全部变更经 Git Gate passed 并受控提交" }]));
});

// --- 负向：本单实施工作必须放行（误伤即失败） ---------------------------
// 这些是「实现/调研该制度机制」的步骤。它们在语义上不是关口，但字面含
// 「提交」「复核」「Git Gate」。v4 的死结正是不加建设性动词豁免会误伤它们。

const LEGITIMATE_STEPS = [
  ["实现提交校验逻辑", "提交接口对非法输入返回 400"],
  ["复核模块实现", "复核算法对全部边界用例通过"],
  ["调研 Git Gate 现状", "报告列出全部检查项"],
  ["补 reviews 字段的机械校验", "超限或形状非法即拒绝写入"],
  ["实现受控提交的校验入口", "writer 拒绝不合规 message"],
  ["实现 25 §11 的 goal-changed 级联标记", "serves 受影响的 open WC 被标记"],
  ["契约测试更新", "测试断言 spark 卡包含关联呈现"],
  ["投影器重写为 21 号三态直读", "三态对象全部 resolved"],
  ["统一前后端契约与类型", "tsc 0 错误"],
  ["消除双路径着色", "7 处卡内提示不再硬编码颜色类"],
];

for (const [step, crit] of LEGITIMATE_STEPS) {
  test(`plan gate: admits this work package's own work — ${step}`, () => {
    assert.ok(!gateHit([{ step, done_criteria: crit }]), `unexpected false positive for: ${step} (${crit})`);
  });
}

// --- 边界：§6.1 明文保留「已取得材料」作证据 ---------------------------

test("plan gate: admits test/lint results as evidence inside done_criteria (21 §6.1)", () => {
  assert.ok(!gateHit([{ step: "实现三态投影", done_criteria: "回归测试 250/250 通过；tsc 0 错误；eslint 无新增" }]));
});

test("plan gate: gate check does not fire on a mixed plan when only legit steps exist", () => {
  const plan = [
    { step: "核实现状", done_criteria: "文件:行号可查" },
    { step: "修正实现", done_criteria: "行为测试断言通过" },
  ];
  assert.ok(!gateHit(plan));
});

// --- 一致性：拒绝信息必须指向规范并给出处置 ----------------------------

test("plan gate: rejection message names §6.1 and states the gate is not removed, only relocated", () => {
  const r = validateWorkcaseFrontmatter(planCase([{ step: "受控提交", done_criteria: "Git Gate passed" }]));
  const msg = (r.issues ?? []).find((i) => /lifecycle gate/.test(i)) ?? "";
  assert.match(msg, /21 §6\.1/, `expected §6.1 citation, got: ${msg.slice(0, 200)}`);
  assert.match(msg, /not by a plan step|still happens/i, `expected relocation guidance, got: ${msg.slice(0, 300)}`);
});

// --- 方案 1（Human 裁定 2026-09-18）：门禁只作用于新增/改动的 plan 项 -------
//
// 动机（实测）：存量 5 个 open 工单已执行完毕、正待 Gate 2 关闭，其 plan 末尾的
// 关口步是**已兑现判据的历史记录**。若一律拒绝，则 close 写入也被挡住，而 close
// 是唯一出口且 WorkCase 无删除操作（21 §14）——真实死锁。逐字放行使「历史不可
// 改写」与「未来不可再写」并存。

function withBaseline(plan, baseline) {
  const r = validateWorkcaseFrontmatter(planCase(plan), baseline);
  return (r.issues ?? []).some((i) => /lifecycle gate/.test(i));
}

test("scheme 1: a byte-identical pre-existing gate item passes (historical record)", () => {
  const item = { step: "验证三件套与受控提交", done_criteria: "tsc 0 错误、web 测试全绿；Git Gate passed" };
  assert.ok(!withBaseline([item], [item]), "an unchanged historical gate step must pass");
});

test("scheme 1: modifying a pre-existing gate item re-subjects it to the check", () => {
  const baseline = [{ step: "验证三件套与受控提交", done_criteria: "tsc 0 错误、web 测试全绿；Git Gate passed" }];
  const changed = [{ step: "验证三件套与受控提交", done_criteria: "tsc 0 错误、web 测试全绿；Git Gate passed，且已复跑" }];
  assert.ok(withBaseline(changed, baseline), "any edit must re-subject the item to the gate");
});

test("scheme 1: a single-character edit does not evade the gate (no normalization)", () => {
  const baseline = [{ step: "受控提交", done_criteria: "Git Gate passed" }];
  const sneaky = [{ step: "受控提交 ", done_criteria: "Git Gate passed" }];
  assert.ok(withBaseline(sneaky, baseline), "whitespace-only edit must not evade the gate");
});

test("scheme 1: a newly added gate item is rejected even when a baseline exists", () => {
  const baseline = [{ step: "核实现状", done_criteria: "文件:行号可查" }];
  const plan = [...baseline, { step: "受控提交", done_criteria: "Git Gate passed" }];
  assert.ok(withBaseline(plan, baseline), "newly added gate item must be rejected");
});

test("scheme 1: with no baseline every gate item is checked (create path)", () => {
  assert.ok(withBaseline([{ step: "受控提交", done_criteria: "Git Gate passed" }], null));
});

test("scheme 1: reordering does not let a gate item pass by index luck", () => {
  const baseline = [
    { step: "核实现状", done_criteria: "a" },
    { step: "受控提交", done_criteria: "b" },
  ];
  // 交换位置：位置 0 处出现关口项（基线位置 0 是「核实现状」），应受检并被拒。
  const reordered = [
    { step: "受控提交", done_criteria: "b" },
    { step: "核实现状", done_criteria: "a" },
  ];
  assert.ok(withBaseline(reordered, baseline), "an item moved into a new index must be checked");
});
