// Tests for lifecycle.js 的 verifyReviewRun —— 运行期 §18 逐行核对映射。
//
// ## 为什么必须单独测它
//
// 2026-11-03 第二轮复核抓到的核心教训：`verification-run.test.mjs` 与
// `run-stage.test.mjs` 全绿（39 例），而**运行时门禁恒 blocked**——因为没有任何
// 测试触达 `verifyReviewRun`。模块层单测全绿与集成层恒失败可以同时成立，这正是
// 本单要消除的「自述与实测不符」的镜像。
//
// 故本文件的夹具**按生产者的真实输出形状**构造：
//   - `formed` 的元素是 `{entry_id, object_uid, file}`（见
//     `observation-review.js` 里 push 的那三行），**没有 body / title**；
//   - `unsettled`、`transfer_failed` 是数组。
// 用想象的形状（如给 formed 塞 body）写夹具，会让「成文」这条最重要的成功路径
// 被误判为失败——那正是第一版犯的错。
import { test } from "node:test";
import assert from "node:assert/strict";

import { verifyReviewRun } from "../lib/lifecycle.js";
import { MECHANICAL_ROWS, NOT_CHECKABLE_ROWS, DEFERRED_ROWS } from "../lib/verification-run.js";

/** 生产者真实形状的 formed 元素（无 body / title）。 */
function realFormed(uid = "pitfall-0000-0000-0000-000000000001") {
  return { entry_id: "entry-1", object_uid: uid, file: `/tmp/${uid}.md` };
}

/** 一次「全部正常、本轮成文」的审核结局。 */
function healthyOutcome(over = {}) {
  return {
    outcome: "landed",
    formed: realFormed(),
    formed_all: [realFormed()],
    duplicate: null,
    duplicates_all: [],
    discarded: [],
    unsettled: [],
    transferred: [],
    transfer_failed: [],
    remaining_pending: 0,
    action: "create",
    ...over,
  };
}

test("healthy 运行（成文、无未判、无转写失败）→ verification landed", () => {
  const v = verifyReviewRun(healthyOutcome());
  assert.notEqual(v, null);
  assert.equal(v.stage, "landed", `fail=${JSON.stringify(v.fail)} undeclared=${JSON.stringify(v.undeclared)} missing=${JSON.stringify(v.missing)}`);
});

test("成文但 formed 元素只有 entry_id/object_uid/file 时不得被判「缺七段」", () => {
  // 第二轮回核 A 项的直接回归：初版读 item.body，真实形状没有 body，
  // 于是任何成文运行都被判 fail「缺七段」。
  const v = verifyReviewRun(healthyOutcome());
  assert.deepEqual(v.fail, []);
  assert.equal(v.misreported.length, 0);
});

test("本轮未成文也不得判失败（不适用 ≠ 失败）", () => {
  const v = verifyReviewRun(healthyOutcome({ formed: null, formed_all: [] }));
  assert.equal(v.stage, "landed");
});

test("transfer_failed 非空 → blocked，且带出该行 id", () => {
  const v = verifyReviewRun(healthyOutcome({ transfer_failed: [{ entry_id: "e1" }] }));
  assert.equal(v.stage, "blocked");
  assert.ok(v.fail.includes("转写条目的合法性"), `实际 fail=${JSON.stringify(v.fail)}`);
});

test("unsettled 非空 → blocked（派发条目的判定完备）", () => {
  const v = verifyReviewRun(healthyOutcome({ unsettled: [{ entry_id: "e1", code: "x" }] }));
  assert.equal(v.stage, "blocked");
  assert.ok(v.fail.includes("派发条目的判定完备"));
});

test("skipped 运行不产出 verification（无可核对结局）", () => {
  assert.equal(verifyReviewRun({ outcome: "skipped" }), null);
  assert.equal(verifyReviewRun(null), null);
});

test("null / 非对象输入返回 null 而不是抛错", () => {
  assert.equal(verifyReviewRun(undefined), null);
  assert.equal(verifyReviewRun(42), null);
});

test("产出覆盖 §18 全表：每一条 mechanical / 声明 / 缺口行都出现", () => {
  const v = verifyReviewRun(healthyOutcome());
  const reported = new Set(v.rows.map((r) => r.id));
  for (const id of MECHANICAL_ROWS) assert.ok(reported.has(id), `缺行：${id}`);
  for (const id of Object.keys(NOT_CHECKABLE_ROWS)) assert.ok(reported.has(id), `缺声明行：${id}`);
  assert.deepEqual(v.missing, [], "不应有缺席行");
});

test("已知缺口随结果带出（deferredRows 非空），使「没真核对」在跑绿时也读得见", () => {
  const v = verifyReviewRun(healthyOutcome());
  assert.ok(v.deferredRows.length > 0);
  assert.equal(v.deferredRows.length, Object.keys(DEFERRED_ROWS).length);
});

test("不得把有采集点的行错报成 not-checkable（否则等于自废核对）", () => {
  const v = verifyReviewRun(healthyOutcome());
  const collected = v.rows.filter((r) => r.verdict !== "not-checkable");
  assert.ok(collected.length >= 5, `至少应有 5 条有采集点的行给出真结论，实际 ${collected.length}`);
});
