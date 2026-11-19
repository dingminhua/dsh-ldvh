
import assert from "node:assert/strict";
import test from "node:test";

import * as friction from "../lib/friction-tools.js";
import * as pitfall from "../lib/pitfall-tools.js";
import * as research from "../lib/report-tools.js";
import * as spark from "../lib/spark-tools.js";
import * as norm from "../lib/norm-tools.js";
import * as subgoal from "../lib/subgoal-tools.js";
import * as goal from "../lib/goal-tools.js";

const GOAL_OPERATIONS = {
  "goal-read-object": { toolName: "ldvh_goal_read" },
  "goal-write-object": { toolName: "ldvh_goal_write" },
};

const LAYERS = [
  ["friction", friction, "friction-read-object", friction.OPERATIONS],
  ["pitfall", pitfall, "pitfall-read-object", pitfall.OPERATIONS],
  ["research", research, "report-read-object", research.OPERATIONS],
  ["spark", spark, "spark-read-object", spark.OPERATIONS],
  ["norm", norm, "norm-read-object", norm.OPERATIONS],
  ["subgoal", subgoal, "subgoal-read-object", subgoal.OPERATIONS],
  ["goal", goal, "goal-read-object", GOAL_OPERATIONS],
];

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
