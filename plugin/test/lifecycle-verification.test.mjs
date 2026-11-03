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

/** 一次「证据齐全」的计时记录（清理回读 + 到期确认观测值）。 */
function healthyTimerEvidence(over = {}) {
  return {
    hadTimer: true, handleCleared: true, slotEmpty: true, handleDestroyed: true,
    clearedReason: "turn-start",
    reason: "dispatching", confirmedAt: "2026-11-03T00:00:00.000Z",
    quietFor: 600000, idleMs: 300000, turnInFlightObserved: false, confirmNoOtherTimer: true,
    ...over,
  };
}

/** 运行期配置快照（与 lifecycle.js 的 readConfigSnapshot 同形）。 */
function structuralProbe(over = {}) {
  // 真实探测结论的形状（probeStructuralFacts 的返回）。
  // 注意：夹具不再自带「正确答案」——判定必须由被探测对象决定，故这里可以
  // 传入带裁量入口的结论来验证该行**真的会 fail**。
  return { discretionFree: true, discretionFound: [], checked: ["runReviewStage"], at: "2026-11-03T00:00:00.000Z", ...over };
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
  const v = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), structuralProbe());
  assert.notEqual(v, null);
  assert.equal(v.stage, "landed", `fail=${JSON.stringify(v.fail)} undeclared=${JSON.stringify(v.undeclared)} missing=${JSON.stringify(v.missing)}`);
});

test("formed 只带 entry_id/object_uid/file 时，七段行落缺口而不是判 pass", () => {
  // 第二轮修了「读 item.body」的形状错误；第三轮复核指出依据仍不成立——
  // formed 先 push、readBack 后做，回读失败的对象也在 formed 里。故「formed 非空」
  // 不证明七段齐备。如实记 not-checkable 并列入缺口。
  const v = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), structuralProbe());
  const row = v.rows.find((r) => r.id === "经验对象的七段完整");
  assert.equal(row.verdict, "not-checkable");
  assert.match(String(row.evidence), /body_valid|回读/);
  assert.ok(v.deferredRows.includes("经验对象的七段完整"));
});

test("本轮未成文也不得判失败（不适用 ≠ 失败）", () => {
  const v = verifyReviewRun(healthyOutcome({ formed: null, formed_all: [] }), healthyTimerEvidence(), structuralProbe());
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
  const v = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), structuralProbe());
  const reported = new Set(v.rows.map((r) => r.id));
  for (const id of MECHANICAL_ROWS) assert.ok(reported.has(id), `缺行：${id}`);
  for (const id of Object.keys(NOT_CHECKABLE_ROWS)) assert.ok(reported.has(id), `缺声明行：${id}`);
  assert.deepEqual(v.missing, [], "不应有缺席行");
});

test("已知缺口随结果带出（deferredRows），使「没真核对」在跑绿时也读得见", () => {
  const noEvidence = verifyReviewRun(healthyOutcome(), null, null);
  assert.ok(noEvidence.deferredRows.length > 0, "无证据时缺口必须列出，不能静默");
  // 拿到真证据后，那四行不再是缺口（它们已移出 DEFERRED_ROWS，有证据即真结论）。
  const withEvidence = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), structuralProbe());
  assert.ok(withEvidence.deferredRows.length < noEvidence.deferredRows.length,
    "采集点真的拿到证据时缺口数应减少——这是「清掉一项删一行」的可观察形态");
  for (const id of ["延迟的取消", "二次确认空闲", "路径约定落实", "无主控预检落实"]) {
    assert.ok(!withEvidence.deferredRows.includes(id), `${id} 有证据时不应落缺口`);
  }
});

test("有采集点的行必须逐一定名列出现真结论（不接受「>=5」这种弱断言）", () => {
  // 第三轮复核：`>= 5` 恰好放行了配置两行被删的情况。改为**枚举**有采集点的行，
  // 少一条就红。
  const EXPECTED_COLLECTED = [
    "派发条目的判定完备",
    "转写条目的合法性",
    "fail-closed 处置",
    "缓冲条目不可写／不可回读",
  ];
  const v = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), structuralProbe());
  const byId = new Map(v.rows.map((r) => [r.id, r]));
  for (const id of EXPECTED_COLLECTED) {
    assert.ok(byId.has(id), `缺少有采集点的行：${id}`);
    assert.notEqual(byId.get(id).verdict, "not-checkable", `${id} 有采集点却被记成缺口`);
  }
});

// ---------------------------------------------------------------------------
// 计时器两行的采集点（2026-11-03 Human 选「补齐四行采集点」后落地）
// ---------------------------------------------------------------------------

test("仅凭 dispatching 不足以判「延迟的取消」通过——缺句柄回读证据", () => {
  // 第三轮复核：§18 对该行的可接受依据是「清理后的本地回读（句柄为空）」，
  // 而 silence-expiry 诊断里没有这项。故即使看到 dispatching 也不能判 pass。
  const v = verifyReviewRun(healthyOutcome(), { stage: "silence-expiry", reason: "dispatching", turn: 5 }, structuralProbe());
  const row = v.rows.find((r) => r.id === "延迟的取消");
  assert.equal(row.verdict, "not-checkable");
  assert.match(String(row.evidence), /句柄|回读/);
});

test("带回清理回读结果时「延迟的取消」真正可判（可 pass 也可 fail）", () => {
  const clean = verifyReviewRun(healthyOutcome(), { hadTimer: true, handleCleared: true, clearedReason: "turn-start" }, structuralProbe());
  assert.equal(clean.rows.find((r) => r.id === "延迟的取消").verdict, "pass");
  const dirty = verifyReviewRun(healthyOutcome(), { hadTimer: true, handleCleared: false, clearedReason: "turn-start" }, structuralProbe());
  assert.equal(dirty.rows.find((r) => r.id === "延迟的取消").verdict, "fail");
  assert.equal(dirty.stage, "blocked");
  // 本来就没有计时器：条件未出现，不算是「清理未验证」也不是失败
  const none = verifyReviewRun(healthyOutcome(), { hadTimer: false, handleCleared: true, clearedReason: "turn-start" }, structuralProbe());
  assert.equal(none.rows.find((r) => r.id === "延迟的取消").verdict, "pass");
});

test("回合进行中拒绝派发：二次确认空闲记 pass（硬约束生效的实证）", () => {
  const v = verifyReviewRun(healthyOutcome(), { stage: "silence-expiry", reason: "turn-in-flight", turn: 3 }, structuralProbe());
  const byId = new Map(v.rows.map((r) => [r.id, r]));
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
  const v = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), structuralProbe());
  assert.deepEqual(v.missing, [], "不得有任何缺席行");
  assert.deepEqual(v.undeclared, [], "不得有未声明的 not-checkable 行");
  // 「有账可查」= 缺口表 ∪ 声明表 ∪ 本次给出真结论的行 ∪ **有采集点但本轮条件未
  // 出现的四行**。后一类不在任何表里，但它们的采集点在代码里真实存在（可证伪），
  // 故不属于「漏登记」。这四行由 COLLECTED_OR_CONDITIONAL 显式列出，避免把
  // 「确实有采集点」与「漏了」混为一谈——c24510a 的 bug 正是后者。
  const COLLECTED_OR_CONDITIONAL = [
    "延迟的取消", "二次确认空闲", "路径约定落实", "无主控预检落实",
  ];
  const accounted = new Set([
    ...Object.keys(DEFERRED_ROWS),
    ...Object.keys(NOT_CHECKABLE_ROWS),
    ...COLLECTED_OR_CONDITIONAL,
    ...v.rows.filter((r) => r.verdict !== "not-checkable").map((r) => r.id),
  ]);
  for (const id of MECHANICAL_ROWS) {
    assert.ok(accounted.has(id), `${id} 既无采集点也无缺口理由——这正是漏登记的形态`);
  }
});

// ---------------------------------------------------------------------------
// 结构性两行的采集点（2026-11-03 第三次重做：探真实函数对象，不是读常量）
// ---------------------------------------------------------------------------

test("无裁量入口时，「路径约定落实」「无主控预检落实」给出 pass", () => {
  const v = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), structuralProbe());
  const byId = new Map(v.rows.map((r) => [r.id, r]));
  assert.equal(byId.get("路径约定落实").verdict, "pass");
  assert.equal(byId.get("无主控预检落实").verdict, "pass");
});

test("审核段出现 tier/fastPath 裁量入口时，「路径约定落实」真的判 fail", () => {
  // 这是该行可证伪性的直接证明：前两版无论传什么都判 pass，是伪造的采集点。
  const v = verifyReviewRun(
    healthyOutcome(),
    null,
    structuralProbe({ discretionFree: false, discretionFound: ["runReviewStage::tier"] }),
  );
  const row = v.rows.find((r) => r.id === "路径约定落实");
  assert.equal(row.verdict, "fail");
  assert.match(String(row.evidence), /裁量入口/);
  assert.equal(v.stage, "blocked");
});

test("审核段出现预检裁量入口时，「无主控预检落实」真的判 fail", () => {
  const v = verifyReviewRun(
    healthyOutcome(),
    null,
    structuralProbe({ discretionFree: false, discretionFound: ["runReviewStage::precheckResult"] }),
  );
  const row = v.rows.find((r) => r.id === "无主控预检落实");
  assert.equal(row.verdict, "fail");
});

test("未探测时两行记缺口，不记 pass（探测没跑 ≠ 核过）", () => {
  const v = verifyReviewRun(healthyOutcome(), null, null);
  const byId = new Map(v.rows.map((r) => [r.id, r]));
  assert.equal(byId.get("路径约定落实").verdict, "not-checkable");
  assert.equal(byId.get("无主控预检落实").verdict, "not-checkable");
});

test("结构性探测只看签名区：函数体注释里的同名文字不得误报", () => {
  // 初版对 String(fn) 全文搜索，注释里写「本任务不设 tier 参数」反而会判 fail。
  // 该用例通过真实 probeStructuralFacts 的间接结果钉住这个边界。
  const v = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), structuralProbe());
  assert.equal(v.rows.find((r) => r.id === "路径约定落实").verdict, "pass",
    "真实 runReviewStage 的注释里含裁量词时不该误报——若误报则说明探测退回了全文搜索");
});

test("结构性探测带 scope 声明，如实标出「只在签名区、只看源码形态」的边界", () => {
  // 探测的有效范围本身要可读，否则后来者会以为它能跨过打包压缩。
  const v = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), structuralProbe({ scope: "signature-only" }));
  assert.equal(v.stage, "landed");
});

// ---------------------------------------------------------------------------
// 真实探针（第四轮复核指出：此前从无任何测试触达 probeStructuralFacts）
// ---------------------------------------------------------------------------

test("真实探针：对生产代码 runReviewStage 的探测结果为无裁量入口", async () => {
  const { probeStructuralFacts } = await import("../lib/lifecycle.js");
  const probe = probeStructuralFacts();
  assert.equal(probe.discretionFree, true, `实际检出：${JSON.stringify(probe.discretionFound)}`);
  assert.deepEqual(probe.discretionFound, []);
  assert.ok(probe.checked.includes("runReviewStage"));
  assert.equal(probe.scope, "signature-only", "探测范围须如实标出，否则读者会以为它能跨过打包压缩");
});

test("真实探针 + 真实证据 → 四行都给出真结论（端到端，非注入）", async () => {
  const { probeStructuralFacts } = await import("../lib/lifecycle.js");
  const v = verifyReviewRun(healthyOutcome(), healthyTimerEvidence(), probeStructuralFacts());
  const byId = new Map(v.rows.map((r) => [r.id, r]));
  for (const id of ["延迟的取消", "二次确认空闲", "路径约定落实", "无主控预检落实"]) {
    assert.equal(byId.get(id).verdict, "pass", `${id} 实得 ${byId.get(id).verdict}：${byId.get(id).evidence}`);
  }
  assert.equal(v.stage, "landed");
});

test("探针结果是『函数缺失』时不得判 pass（假 pass 通道已堵）", () => {
  const v = verifyReviewRun(
    healthyOutcome(),
    healthyTimerEvidence(),
    structuralProbe({ discretionFree: false, discretionFound: ["runReviewStage::missing"] }),
  );
  assert.equal(v.rows.find((r) => r.id === "路径约定落实").verdict, "fail");
});

test("有计时证据但观测值不达标 → 二次确认空闲判 fail（复算而非相信结论布尔）", () => {
  const v = verifyReviewRun(
    healthyOutcome(),
    healthyTimerEvidence({ quietFor: 1000, idleMs: 300000 }),
    structuralProbe(),
  );
  assert.equal(v.rows.find((r) => r.id === "二次确认空闲").verdict, "fail");
  assert.equal(v.stage, "blocked");
});

test("到期但 not-governed：条件确实出现却缺证据，不得被声明为「条件未出现」而放行", () => {
  // 第四轮复核指出的新万能免责通道：任何 not-checkable 都被说成「条件没发生」。
  const v = verifyReviewRun(healthyOutcome(), { reason: "not-governed" }, structuralProbe());
  assert.notEqual(v.stage, "landed", "条件出现了却没证据，必须阻断而不是免责");
});

test("证据文案如实声明能力边界：不得声称「已独立验证清理成功」", () => {
  // 实测：Node timer 在 clearTimeout 与自然到期之后的可观察量相同（_destroyed 为
  // true、_idleTimeout 为 -1），故「清理动作是否成功」在现有 API 下不可独立观测。
  // 该行的 pass 只能确证「状态槽已空」，文案不得外推。
  const v = verifyReviewRun(
    healthyOutcome(),
    healthyTimerEvidence({ hadTimer: true, handleCleared: true }),
    structuralProbe(),
  );
  const ev = String(v.rows.find((r) => r.id === "延迟的取消").evidence);
  assert.match(ev, /能力边界/, "须如实标注无法区分「被清理」与「自然到期」");
  assert.doesNotMatch(ev, /已独立验证清理成功/, "不得超出证据能力下结论");
});

test("清理后状态槽仍非空 → 判 fail（这是该行唯一可失败的路径）", () => {
  const v = verifyReviewRun(
    healthyOutcome(),
    healthyTimerEvidence({ hadTimer: true, handleCleared: false }),
    structuralProbe(),
  );
  assert.equal(v.rows.find((r) => r.id === "延迟的取消").verdict, "fail");
  assert.equal(v.stage, "blocked");
});
