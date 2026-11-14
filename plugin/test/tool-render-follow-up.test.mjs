// 模型可见面的 follow_up 一致性守卫（05 §8 / 03 §9.5）。
//
// **为什么需要这个文件**：每个事实对象工具层的 response envelope 都算出了
// `follow_up`（给出可继续读取、回读、修复、分流或 Human 决定入口），而
// `output.render` 是模型唯一能看见的文本面。但 2026-11-14 核查发现 8 个类型
// 层并不一致：Goal / Norm / SubGoal 与基础批次四处会渲染 follow_up，而
// ADR / Friction / Pitfall / Research / Spark 五处只打 gap:/warning: 行——
// envelope 里算出的提示对模型侧那行文本不可见，与「数据层对了、模型看不见」
// 是同一失效模式（本仓已有 spark-5b0b380e、research list render 两处实测教训）。
//
// 本次补齐那五处渲染后，用本文件把「所有类型层一致」钉成一条机械守卫：
// 新增类型层或改渲染时漏掉 follow_up，会当场转红，而不是等下一次人工核查。
//
// **直接触发用例**（呼应「新增防护无直接用例致变异零检出」）：本文件不依赖
// handler 跑真实业务，而是直接把一个带 follow_up 的 completed envelope 喂给
// `output.render`，逐条断言内容进入文本——正是防护分支本身被直接触发的用例。

import assert from "node:assert/strict";
import test from "node:test";

import * as adr from "../lib/adr-tools.js";
import * as friction from "../lib/friction-tools.js";
import * as pitfall from "../lib/pitfall-tools.js";
import * as research from "../lib/report-tools.js";
import * as spark from "../lib/spark-tools.js";
import * as norm from "../lib/norm-tools.js";
import * as subgoal from "../lib/subgoal-tools.js";
import * as goal from "../lib/goal-tools.js";

// goal-tools.js 未导出 OPERATIONS（其余 7 层均导出）。为保持表驱动单一来源，
// 这里只补它的两个 operationKey；名字与 goal-tools.js:39 的 OPERATIONS 逐字一致。
const GOAL_OPERATIONS = {
  "goal-read-object": { toolName: "ldvh_goal_read" },
  "goal-write-object": { toolName: "ldvh_goal_write" },
};

// 每个类型层取一个代表性 operation（read 类即可：renderEnvelope 是同一函数，
// 与具体 operation 无关）。tuple = [层名, 模块, operationKey, OPERATIONS 中的键]。
const LAYERS = [
  ["adr", adr, "adr-read-object", adr.OPERATIONS],
  ["friction", friction, "friction-read-object", friction.OPERATIONS],
  ["pitfall", pitfall, "pitfall-read-object", pitfall.OPERATIONS],
  ["research", research, "research-read-object", research.OPERATIONS],
  ["spark", spark, "spark-read-object", spark.OPERATIONS],
  ["norm", norm, "norm-read-object", norm.OPERATIONS],
  ["subgoal", subgoal, "subgoal-read-object", subgoal.OPERATIONS],
  ["goal", goal, "goal-read-object", GOAL_OPERATIONS],
];

/** 把 render 返回值归一成模型实际看到的纯文本。 */
function renderedText(descriptor, envelope) {
  const blocks = descriptor.output.render({}, { envelope });
  assert.ok(Array.isArray(blocks), `${descriptor.name}: render 必须返回内容块数组`);
  return blocks.map((b) => (typeof b === "string" ? b : (b?.text ?? ""))).join("\n");
}

const FOLLOW_UP_A = "下一步：用新指纹调用 update（受控提交契约）";
const FOLLOW_UP_B = "STOP further writes and success claims (03 §9.4 item 7)";

function completedEnvelope(operationKey, followUp) {
  return {
    operation_key: operationKey,
    outcome: "completed",
    result: null,
    scope: { requested: null, completed: [], not_completed: [] },
    sources: [],
    gaps: [],
    verification: { checks: [], passed: true },
    follow_up: followUp,
  };
}

test("每个事实对象类型层把 follow_up 渲染进模型可见文本（05 §8 / 03 §9.5 一致性）", () => {
  for (const [name, mod, operationKey, operations] of LAYERS) {
    const operation = operations[operationKey];
    assert.ok(operation, `${name}: OPERATIONS 缺少 ${operationKey}`);
    const descriptor = mod.toolDescriptorFor(operationKey, operation, async () => ({}));

    const text = renderedText(descriptor, completedEnvelope(operationKey, [FOLLOW_UP_A, FOLLOW_UP_B]));
    assert.ok(
      text.includes(FOLLOW_UP_A),
      `${name}: 模型可见文本必须含 follow_up 第一条；实测：\n${text}`,
    );
    assert.ok(
      text.includes(FOLLOW_UP_B),
      `${name}: 模型可见文本必须含 follow_up 第二条；实测：\n${text}`,
    );
  }
});

test("follow_up 为空时不留下残留提示行（不把「无提示」伪装成一个值）", () => {
  for (const [name, mod, operationKey, operations] of LAYERS) {
    const descriptor = mod.toolDescriptorFor(operationKey, operations[operationKey], async () => ({}));
    const text = renderedText(descriptor, completedEnvelope(operationKey, []));
    assert.ok(
      !text.includes(FOLLOW_UP_A) && !text.includes("follow_up:") && !text.includes("follow-up:"),
      `${name}: 空 follow_up 不得渲染出提示前缀；实测：\n${text}`,
    );
  }
});

test("follow_up 成员为结构化记录时按 JSON 呈现，不丢成 [object Object]", () => {
  for (const [name, mod, operationKey, operations] of LAYERS) {
    const descriptor = mod.toolDescriptorFor(operationKey, operations[operationKey], async () => ({}));
    const structured = { action: "re-read", reason: "CAS baseline moved" };
    const text = renderedText(descriptor, completedEnvelope(operationKey, [structured]));
    assert.ok(
      text.includes("re-read") && text.includes("CAS baseline moved"),
      `${name}: 结构化 follow_up 成员须可读；实测：\n${text}`,
    );
    assert.ok(!text.includes("[object Object]"), `${name}: 不得出现 [object Object]`);
  }
});
