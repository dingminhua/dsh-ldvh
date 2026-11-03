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

/** 运行期配置快照（与 lifecycle.js 的 readConfigSnapshot 同形）。 */
function configSnapshot(over = {}) {
  return {
    riskLayer: 2,
    fastPath: false,
    precheckSource: "configured",
    semanticGapsDeclared: true,
    silenceMs: 900000,
    at: "2026-11-03T00:00:00.000Z",
    ...over,
  };
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
  const v = verifyReviewRun(healthyOutcome(), null, configSnapshot());
  assert.notEqual(v, null);
  assert.equal(v.stage, "landed", `fail=${JSON.stringify(v.fail)} undeclared=${JSON.stringify(v.undeclared)} missing=${JSON.stringify(v.missing)}`);
});

test("成文但 formed 元素只有 entry_id/object_uid/file 时不得被判「缺七段」", () => {
  // 第二轮回核 A 项的直接回归：初版读 item.body，真实形状没有 body，
  // 于是任何成文运行都被判 fail「缺七段」。
  const v = verifyReviewRun(healthyOutcome(), null, configSnapshot());
  assert.deepEqual(v.fail, []);
  assert.equal(v.misreported.length, 0);
});

test("本轮未成文也不得判失败（不适用 ≠ 失败）", () => {
  const v = verifyReviewRun(healthyOutcome({ formed: null, formed_all: [] }), null, configSnapshot());
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
  const v = verifyReviewRun(healthyOutcome(), null, configSnapshot());
  const reported = new Set(v.rows.map((r) => r.id));
  for (const id of MECHANICAL_ROWS) assert.ok(reported.has(id), `缺行：${id}`);
  for (const id of Object.keys(NOT_CHECKABLE_ROWS)) assert.ok(reported.has(id), `缺声明行：${id}`);
  assert.deepEqual(v.missing, [], "不应有缺席行");
});

test("已知缺口随结果带出（deferredRows），使「没真核对」在跑绿时也读得见", () => {
  // 无计时/配置证据时，那些「条件式」行落缺口并被列出；有证据时应缩短。
  const noEvidence = verifyReviewRun(healthyOutcome(), null, null);
  assert.ok(noEvidence.deferredRows.length > 0, "无条件证据时必须列出缺口，不能静默");
  const withEvidence = verifyReviewRun(healthyOutcome(), { stage: "silence-expiry", reason: "dispatching" }, configSnapshot());
  assert.ok(withEvidence.deferredRows.length < noEvidence.deferredRows.length,
    "补上采集点后缺口数应减少——这正是「清掉一项删一行」的可观察形态");
});

test("不得把有采集点的行错报成 not-checkable（否则等于自废核对）", () => {
  const v = verifyReviewRun(healthyOutcome(), null, configSnapshot());
  const collected = v.rows.filter((r) => r.verdict !== "not-checkable");
  assert.ok(collected.length >= 5, `至少应有 5 条有采集点的行给出真结论，实际 ${collected.length}`);
});

// ---------------------------------------------------------------------------
// 计时器两行的采集点（2026-11-03 Human 选「补齐四行采集点」后落地）
// ---------------------------------------------------------------------------

test("有计时判定证据时，「延迟的取消」「二次确认空闲」给出真结论而非 not-checkable", () => {
  const v = verifyReviewRun(healthyOutcome(), { stage: "silence-expiry", reason: "dispatching", turn: 5 });
  const byId = new Map(v.rows.map((r) => [r.id, r]));
  for (const id of ["延迟的取消", "二次确认空闲"]) {
    assert.notEqual(byId.get(id).verdict, "not-checkable", `${id} 有证据时不应落缺口`);
    assert.equal(byId.get(id).verdict, "pass");
  }
  assert.ok(!v.deferredRows.includes("延迟的取消"));
  assert.ok(!v.deferredRows.includes("二次确认空闲"));
});

test("回合进行中拒绝派发是硬约束生效，记 pass 而非 fail", () => {
  const v = verifyReviewRun(healthyOutcome(), { stage: "silence-expiry", reason: "turn-in-flight", turn: 3 });
  const byId = new Map(v.rows.map((r) => [r.id, r]));
  assert.equal(byId.get("延迟的取消").verdict, "pass");
  assert.equal(byId.get("二次确认空闲").verdict, "pass");
  assert.deepEqual(v.fail, []);
});

test("无计时证据时记 not-checkable 并说明成因，不得声称核对通过", () => {
  // 「没有计时发生」不等于「清理已验证过」。记 pass 就是第三种「默认通过」。
  const v = verifyReviewRun(healthyOutcome(), null);
  const byId = new Map(v.rows.map((r) => [r.id, r]));
  for (const id of ["延迟的取消", "二次确认空闲"]) {
    assert.equal(byId.get(id).verdict, "not-checkable", `${id} 无证据时不得记 pass`);
    assert.match(String(byId.get(id).evidence), /条件未出现|该行的条件/);
  }
  // 但它们属「条件式不适用」，已声明，故不阻断本轮。
  assert.equal(v.stage, "landed");
});

test("不变量：每条机械行必须有采集点或缺口理由（防漏登记）", async () => {
  // 这条钉住 c24510a 那个 bug：某行既不在 collected 也不在 DEFERRED，
  // 会落成「未声明 not-checkable」使门禁恒 blocked。
  const { MECHANICAL_ROWS, DEFERRED_ROWS, NOT_CHECKABLE_ROWS } = await import("../lib/verification-run.js");
  const v = verifyReviewRun(healthyOutcome(), { stage: "silence-expiry", reason: "dispatching" });
  assert.deepEqual(v.missing, [], "不得有任何缺席行");
  assert.deepEqual(v.undeclared, [], "不得有未声明的 not-checkable 行");
  const accounted = new Set([
    ...Object.keys(DEFERRED_ROWS),
    ...Object.keys(NOT_CHECKABLE_ROWS),
    ...v.rows.filter((r) => r.verdict !== "not-checkable").map((r) => r.id),
  ]);
  for (const id of MECHANICAL_ROWS) {
    assert.ok(accounted.has(id), `${id} 既无采集点也无缺口理由——这正是漏登记的形态`);
  }
});
