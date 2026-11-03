// Tests for plugin/lib/run-stage.js —
// stage 的唯一派生点。核心承诺：单任务 outcome=partial 不得被记成 land-failed。
// 该缺陷此前散在三处（lifecycle.js:700、:1028、:1445），前两处是三元素式，会把
// partial 掉进 `land-failed`；第三处已正确。收敛成一处正是为了让第四处不再重犯。
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveStage, TASK_OUTCOMES, RUN_STAGES } from "../lib/run-stage.js";

test("checkpoint 失败 → stopped（先于任何结局判断）", () => {
  assert.equal(deriveStage({ checkpointOk: false, taskOutcomes: { a: { outcome: "landed" } } }), "stopped");
});

test("无任务结局 → skipped", () => {
  assert.equal(deriveStage({ taskOutcomes: {} }), "skipped");
});

test("无任务结局且声明 not-implemented → not-implemented", () => {
  assert.equal(deriveStage({ taskOutcomes: {}, emptyStage: "not-implemented" }), "not-implemented");
});

test("全部 landed → landed", () => {
  assert.equal(deriveStage({ taskOutcomes: { a: { outcome: "landed" }, b: { outcome: "landed" } } }), "landed");
});

test("全部未落地 → land-failed", () => {
  assert.equal(
    deriveStage({ taskOutcomes: { a: { outcome: "rejected" }, b: { outcome: "land-failed" } } }),
    "land-failed",
  );
});

test("有成有败 → partial", () => {
  assert.equal(
    deriveStage({ taskOutcomes: { a: { outcome: "landed" }, b: { outcome: "land-failed" } } }),
    "partial",
  );
});

test("**单任务 outcome=partial → partial（不得记成 land-failed）**", () => {
  // 这是本模块存在的核心理由：三元素式的 `else → land-failed` 会在此把它记成失败。
  assert.equal(deriveStage({ taskOutcomes: { "experience-review": { outcome: "partial" } } }), "partial");
});

test("partial 与其他结局混合仍为 partial", () => {
  assert.equal(
    deriveStage({ taskOutcomes: { a: { outcome: "landed" }, b: { outcome: "partial" } } }),
    "partial",
  );
  assert.equal(
    deriveStage({ taskOutcomes: { a: { outcome: "rejected" }, b: { outcome: "partial" } } }),
    "partial",
  );
});

test("单任务 skipped 记 skipped，不记失败（skipped 不是失败）", () => {
  // 复核第二轮 B 项：`skipped` 在 idle-runlog 的枚举里是「无执行体」，
  // 既不是成功也不是失败。把「本轮没有可判条目」记成 land-failed 会使
  // 运行痕迹系统性失真。
  assert.equal(deriveStage({ taskOutcomes: { a: { outcome: "skipped" } } }), "skipped");
});

test("skipped 与失败混合时记 land-failed（有真失败就不是单纯没跑）", () => {
  assert.equal(
    deriveStage({ taskOutcomes: { a: { outcome: "skipped" }, b: { outcome: "land-failed" } } }),
    "land-failed",
  );
  assert.equal(
    deriveStage({ taskOutcomes: { a: { outcome: "skipped" }, b: { outcome: "rejected" } } }),
    "land-failed",
  );
});

test("派生结果必属 stage 闭集", () => {
  const cases = [
    { taskOutcomes: {} },
    { checkpointOk: false, taskOutcomes: {} },
    { taskOutcomes: { a: { outcome: "landed" } } },
    { taskOutcomes: { a: { outcome: "partial" } } },
    { taskOutcomes: { a: { outcome: "landed" }, b: { outcome: "rejected" } } },
  ];
  for (const c of cases) {
    assert.ok(RUN_STAGES.includes(deriveStage(c)), `stage 越界：${deriveStage(c)}`);
  }
});

test("partial 同时出现在两个闭集里（此前 stage 枚举行漏登）", () => {
  assert.ok(RUN_STAGES.includes("partial"), "stage 闭集必须含 partial");
  assert.ok(TASK_OUTCOMES.includes("partial"), "per_task.outcome 闭集必须含 partial");
});
