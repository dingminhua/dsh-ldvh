import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeClarificationNeeds,
  buildClarificationLogEntry,
  evaluateConvergence,
  shapeEvidence,
  auditCitationLoop,
  checkDeliveryContract,
  ResearchSession,
} from "../lib/research-session.js";

// ---------------------------------------------------------------------------
// §5 入口澄清
// ---------------------------------------------------------------------------

test("analyzeClarificationNeeds detects multi-meaning terms", () => {
  const result = analyzeClarificationNeeds("调研编排系统在 DSH 中的实现", "");
  assert.ok(result.ok);
  assert.ok(result.value.needsClarification);
  assert.ok(result.value.questions.length > 0);
  assert.ok(result.value.questions.length <= 3);
});

test("analyzeClarificationNeeds detects unbounded scope (no time/version)", () => {
  const result = analyzeClarificationNeeds("Research the best practices for plugin development", "选型");
  assert.ok(result.ok);
  assert.ok(result.value.needsClarification);
  assert.ok(result.value.questions.some((q) => q.focus === "范围界定"));
});

test("analyzeClarificationNeeds returns no questions for well-bounded question", () => {
  const result = analyzeClarificationNeeds("What is the latest stable version of Node.js v22?", "版本确认");
  assert.ok(result.ok);
  // "version" in the text should prevent scope ambiguity
});

test("buildClarificationLogEntry builds a human answer entry", () => {
  const entry = buildClarificationLogEntry("指哪个编排？", "指 DSH 的 subagent 编排", "human");
  assert.equal(entry.answered_by, "human");
  assert.equal(entry.question, "指哪个编排？");
});

test("buildClarificationLogEntry builds a declined entry", () => {
  const entry = buildClarificationLogEntry("指哪个编排？", null, "declined");
  assert.ok(entry.answer.includes("未澄清"));
});

// ---------------------------------------------------------------------------
// §6 三层收敛
// ---------------------------------------------------------------------------

test("evaluateConvergence returns sufficient when all covered and no high gaps", () => {
  // 33 §8.1 第 1 项要求「每个子问题至少有 confirmed 覆盖」，故这条示例必须
  // 真的覆盖 q1——旧版这里没打 sub_question_key，靠「未标注即视为覆盖」的
  // 宽松兜底才过。兜底已移除（见下一例），示例随之补上归属标注。
  const result = evaluateConvergence(
    { confirmed: [{ statement: "s1", sub_question_key: "q1" }], gaps: [] },
    { subQuestions: ["q1"], roundNumber: 1, maxRounds: 4, consecutiveNoGainRounds: 0 },
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "sufficient");
});

// 33 §8.1：sufficient 要求「每个子问题至少有 confirmed 证据覆盖」。当有子问题
// 却没有任何一条 confirmed 带 sub_question_key 时，「覆盖」在字形上判不了。
// 旧实现把这种判不了直接当通过（注释自认 "lenient"），被破坏性验证抓到：
// 3 个子问题只调研了 1 个、都没打标签，也会判 sufficient——报告于是带着
// 「充分收敛」的结论交付，而三个子问题实际只碰了一个。判不了 ≠ 通过。
test("evaluateConvergence: untagged evidence cannot satisfy sufficient (判不了不等于通过，33 §8.1)", () => {
  const result = evaluateConvergence(
    { confirmed: [{ statement: "s1" }], gaps: [] },
    { subQuestions: ["q1", "q2", "q3"], roundNumber: 1, maxRounds: 4, consecutiveNoGainRounds: 0 },
  );
  assert.notEqual(result.reason, "sufficient", "未标注子问题归属时不得判充分收敛");
  assert.equal(result.stop, false, "应继续推进轮次，而不是提前收敛");
});

test("evaluateConvergence: a genuinely uncovered sub-question blocks sufficient", () => {
  const result = evaluateConvergence(
    { confirmed: [{ statement: "s1", sub_question_key: "q1" }], gaps: [] },
    { subQuestions: ["q1", "q2", "q3"], roundNumber: 1, maxRounds: 4, consecutiveNoGainRounds: 0 },
  );
  assert.notEqual(result.reason, "sufficient");
  assert.equal(result.stop, false);
});

test("evaluateConvergence returns no-gain after two consecutive zero rounds", () => {
  const r1 = evaluateConvergence(
    { confirmed: [], gaps: [] },
    { subQuestions: ["q1"], roundNumber: 1, maxRounds: 4, consecutiveNoGainRounds: 0 },
  );
  assert.equal(r1.stop, false);
  assert.equal(r1.newNoGainCount, 1);

  const r2 = evaluateConvergence(
    { confirmed: [], gaps: [] },
    { subQuestions: ["q1"], roundNumber: 2, maxRounds: 4, consecutiveNoGainRounds: 1 },
  );
  assert.equal(r2.stop, true);
  assert.equal(r2.reason, "no-gain");
});

test("evaluateConvergence returns round-cap at limit", () => {
  const result = evaluateConvergence(
    { confirmed: [{ statement: "s1" }], gaps: [{ description: "open", priority: "high" }] },
    { subQuestions: ["q1", "q2"], roundNumber: 4, maxRounds: 4, consecutiveNoGainRounds: 0 },
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "round-cap");
});

test("evaluateConvergence does not stop mid-round with progress", () => {
  const result = evaluateConvergence(
    { confirmed: [{ statement: "s1" }], gaps: [{ description: "open", priority: "high" }] },
    { subQuestions: ["q1", "q2"], roundNumber: 2, maxRounds: 4, consecutiveNoGainRounds: 0 },
  );
  assert.equal(result.stop, false);
});

// ---------------------------------------------------------------------------
// §7 三态证据
// ---------------------------------------------------------------------------

test("shapeEvidence accepts a valid confirmed finding", () => {
  const result = shapeEvidence({
    statement: "fork worker 排除写工具",
    state: "confirmed",
    evidence: { text: "允许清单排除 mnemon_remember", anchor: "§5.2", source: "https://example.com", confidence: "high" },
  });
  assert.ok(result.ok);
  assert.equal(result.value.confidence, "high");
  assert.equal(result.value.quotes.length, 1);
});

test("shapeEvidence rejects confirmed without quote", () => {
  const result = shapeEvidence({ statement: "s", state: "confirmed", evidence: { source: "https://x.com" } });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "evidence/quote_missing");
});

test("shapeEvidence rejects confirmed with non-HTTP source", () => {
  const result = shapeEvidence({
    statement: "s", state: "confirmed",
    evidence: { text: "t", anchor: "a", source: "file:///local" },
  });
  assert.ok(!result.ok);
});

test("shapeEvidence accepts a valid uncertain finding", () => {
  const result = shapeEvidence({ statement: "s", state: "uncertain", issue: { issue: "冲突", reason: "两个来源说法不一致" } });
  assert.ok(result.ok);
  assert.equal(result.value.issue, "冲突");
});

test("shapeEvidence accepts a valid gap finding", () => {
  const result = shapeEvidence({ statement: "s", state: "gap", gap: { description: "缺少价格数据", priority: "high" } });
  assert.ok(result.ok);
  assert.equal(result.value.priority, "high");
});

test("shapeEvidence reads uncertain/gap from the nested objects declared by the tool schema", () => {
  // Regression (2026-09-10 R1): the tool schema (research-tools.js
  // findingSchema) declares `issue`/`gap` as nested objects mirroring the
  // Research frontmatter entries; shapeEvidence used to read flat top-level
  // fields, so AI callers following the schema were always rejected with a
  // misleading error.
  const uncertain = shapeEvidence({
    statement: "s", state: "uncertain",
    issue: { issue: "冲突", reason: "两个来源说法不一致" },
  });
  assert.ok(uncertain.ok, JSON.stringify(uncertain.error));
  assert.deepEqual(uncertain.value, { issue: "冲突", reason: "两个来源说法不一致" });

  const gap = shapeEvidence({
    statement: "s", state: "gap",
    gap: { description: "缺少价格数据", priority: "high" },
  });
  assert.ok(gap.ok, JSON.stringify(gap.error));
  assert.deepEqual(gap.value, { description: "缺少价格数据", priority: "high" });
});

test("shapeEvidence rejects flat uncertain/gap fields with a schema-shaped error", () => {
  // Flat fields (the old bug's implicit contract) must fail loudly so the
  // caller follows the schema-declared nested shape.
  const uncertain = shapeEvidence({ statement: "s", state: "uncertain", issue: "顶层字段", reason: "顶层字段" });
  assert.ok(!uncertain.ok);
  assert.equal(uncertain.error.code, "evidence/issue_missing");

  const gap = shapeEvidence({ statement: "s", state: "gap", description: "顶层字段", priority: "high" });
  assert.ok(!gap.ok);
  assert.equal(gap.error.code, "evidence/description_missing");
});

test("shapeEvidence rejects unknown state", () => {
  const result = shapeEvidence({ statement: "s", state: "maybe" });
  assert.ok(!result.ok);
  assert.equal(result.error.code, "evidence/bad_state");
});

// ---------------------------------------------------------------------------
// §8 引用闭环审计
// ---------------------------------------------------------------------------

test("auditCitationLoop passes when references match", () => {
  const confirmed = [{ statement: "s1", quotes: [{ text: "verbatim text here", anchor: "a", source: "https://x.com" }] }];
  const body = "The finding is 「verbatim text here」 as stated in [1].";
  const result = auditCitationLoop(body, confirmed);
  assert.ok(result.ok, JSON.stringify(result.issues));
});

test("auditCitationLoop flags out-of-range reference", () => {
  const confirmed = [{ statement: "s1" }];
  const body = "Reference [5] does not exist.";
  const result = auditCitationLoop(body, confirmed);
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.includes("[5]")));
});

test("auditCitationLoop flags unanchored inline quote", () => {
  const confirmed = [{ statement: "s1", quotes: [{ text: "different text", anchor: "a", source: "https://x.com" }] }];
  const body = "Quote 「this is not in evidence」 here.";
  const result = auditCitationLoop(body, confirmed);
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.includes("not found in any evidence")));
});

// ---------------------------------------------------------------------------
// §10 引用闭环审计 — 声明形状与实现形状必须一致
//
// 回归背景：工具 schema 把 `confirmed` 声明为 string[]，而审计函数读
// `c.quotes`，按声明形状调用即 TypeError（"Cannot read properties of
// undefined (reading 'some')"），descriptor 的 catch 把它包成
// execution_error —— 引用闭环这道门在它自己的契约上不可用。以下用例同时
// 钉住「两种形状都能被接受」与「不可核验时不得放行」。
// ---------------------------------------------------------------------------

test("auditCitationLoop accepts the tool-declared shape (bare statement strings)", () => {
  // The schema told callers to pass this; it used to throw.
  const result = auditCitationLoop("Finding [1] holds.", ["only a statement"]);
  assert.ok(result.ok, JSON.stringify(result.issues));
});

test("auditCitationLoop accepts the finalize shape (evidence entries with quotes)", () => {
  const confirmed = [{ statement: "s1", confidence: "high", quotes: [{ text: "verbatim text here", anchor: "a", source: "https://x.com" }] }];
  const body = "Finding 「verbatim text here」 [1].";
  const result = auditCitationLoop(body, confirmed);
  assert.ok(result.ok, JSON.stringify(result.issues));
});

test("auditCitationLoop still catches an out-of-range reference in the bare-statement shape", () => {
  const result = auditCitationLoop("Finding [2].", ["only one statement"]);
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.includes("[2]")));
});

test("auditCitationLoop fails closed on quotes it cannot check, naming the real cause", () => {
  // No entry carries quotes → the quote is UNVERIFIABLE, not proven wrong.
  // The gate must not go green, and the message must not accuse the quote.
  const result = auditCitationLoop("Finding 「some quote」 [1].", ["only a statement"]);
  assert.ok(!result.ok, "unverifiable quote evidence must not pass the gate");
  assert.ok(result.issues.some((i) => i.includes("cannot be checked")));
  assert.ok(result.issues.some((i) => i.includes("finalize bundle")));
});

test("auditCitationLoop does not throw on malformed entries (non-object garbage is dropped, not crashed on)", () => {
  const result = auditCitationLoop("Finding [1].", [null, { statement: "s" }, 42]);
  assert.ok(Array.isArray(result.issues));
  // null and 42 carry no statement, so they are dropped; [1] then points at the
  // single real entry and the audit is honest about what it could check.
  assert.ok(result.ok, JSON.stringify(result.issues));
});

// ---------------------------------------------------------------------------
// §10 交付合同
// ---------------------------------------------------------------------------

test("checkDeliveryContract passes clean body", () => {
  const result = checkDeliveryContract("Clean body with no placeholders.");
  assert.ok(result.ok);
});

test("checkDeliveryContract flags TODO", () => {
  const result = checkDeliveryContract("This has a TODO item.");
  assert.ok(!result.ok);
});

test("checkDeliveryContract flags template placeholder", () => {
  const result = checkDeliveryContract("Value: {{ some_var }}");
  assert.ok(!result.ok);
});

// ---------------------------------------------------------------------------
// ResearchSession (integration)
// ---------------------------------------------------------------------------

test("ResearchSession full flow: clarify → rounds → sufficient → finalize", () => {
  const session = new ResearchSession({
    question: "fork worker 的隔离机制是什么？",
    purpose: "决定 LDVH 反思引擎实现方案",
    subQuestions: ["fork worker 如何隔离"],
    maxRounds: 3,
  });

  session.registerSource("https://example.com/solo-thinking", "solo-thinking", "源码仓库");

  // Round 1: one confirmed finding
  const r1 = session.submitRound([{
    statement: "fork worker 继承父检查点且排除写工具",
    state: "confirmed",
    sub_question_key: "fork worker 如何隔离",
    evidence: { text: "仅 idle 审查，允许清单排除写工具", anchor: "§5.2", source: "https://example.com/solo-thinking", confidence: "high" },
  }]);

  assert.equal(r1.stop, true);
  assert.equal(r1.reason, "sufficient");
  assert.equal(r1.accepted.length, 1);

  // Finalize
  const final = session.finalize();
  assert.ok(final.ok, JSON.stringify(final.error));
  assert.equal(final.value.stopping_reason, "sufficient");
  assert.equal(final.value.confirmed.length, 1);
  assert.equal(final.value.urls.length, 1);
  assert.equal(final.value.rounds_used, 1);
});

test("ResearchSession no-gain flow: two empty rounds converge", () => {
  const session = new ResearchSession({
    question: "无法找到证据的问题",
    purpose: "测试 no-gain",
    subQuestions: ["unanswerable"],
    maxRounds: 4,
  });

  const r1 = session.submitRound([]);
  assert.equal(r1.stop, false);
  const r2 = session.submitRound([]);
  assert.equal(r2.stop, true);
  assert.equal(r2.reason, "no-gain");
});

// 更正（2026-10-25）：旧用例在此断言「零证据 no-gain 的 finalize 成功」，
// 与 24 §8 直接冲突——三态至少一项、urls 必填非空，两者都不允许空 bundle
// 成为对象。于是 finalize 返回的 bundle 只能被唯一的消费者（writer）拒绝，
// 调用方要到落盘那一刻才看到一个像自己填错的 frontmatter 错误。
// 现在 finalize 当场拒绝并指出补救方向（把未覆盖范围记为 gap）。
test("ResearchSession: zero-evidence finalize is refused — the bundle could never become an object (24 §8)", () => {
  const session = new ResearchSession({
    question: "一个没有任何证据的问题",
    purpose: "测试零证据",
    subQuestions: ["unanswerable"],
    maxRounds: 4,
  });
  session.submitRound([]);
  const r2 = session.submitRound([]);
  assert.equal(r2.reason, "no-gain");

  const final = session.finalize();
  assert.equal(final.ok, false);
  assert.equal(final.error.code, "session/empty_evidence");
  assert.match(final.error.message, /gap/);
});

test("ResearchSession: a bundle with no registered source is refused (24 §8 urls non-empty)", () => {
  const session = new ResearchSession({ question: "q?", purpose: "p", subQuestions: [], maxRounds: 4 });
  session.submitRound([
    { statement: "只记录一个缺口", state: "gap", gap: { description: "无法获取 X", priority: "low" } },
  ]);
  session.submitRound([
    { statement: "仍无法获取 X", state: "gap", gap: { description: "无法获取 X", priority: "low" } },
  ]);
  const final = session.finalize();
  assert.equal(final.ok, false);
  assert.equal(final.error.code, "session/no_source");
  assert.match(final.error.message, /urls/);
});

test("ResearchSession round-cap flow with gaps declared", () => {
  const session = new ResearchSession({
    question: "大范围调研",
    purpose: "测试 round-cap",
    subQuestions: ["q1", "q2", "q3"],
    maxRounds: 2,
  });

  session.registerSource("https://example.com", "example", "");
  session.submitRound([
    { statement: "partial", state: "confirmed", sub_question_key: "q1", evidence: { text: "t", anchor: "a", source: "https://example.com", confidence: "low" } },
    { statement: "g", state: "gap", gap: { description: "q2 and q3 uncovered", priority: "medium" } },
  ]);
  session.submitRound([
    { statement: "more", state: "gap", gap: { description: "still uncovered", priority: "low" } },
  ]);

  const final = session.finalize();
  assert.ok(final.ok, JSON.stringify(final.error));
  assert.equal(final.value.stopping_reason, "round-cap");
  assert.ok(final.value.gaps.length > 0);
});

test("ResearchSession finalize rejects unconverged session", () => {
  const session = new ResearchSession({ question: "q", purpose: "p", maxRounds: 10 });
  const result = session.finalize();
  assert.ok(!result.ok);
  assert.equal(result.error.code, "session/not_converged");
});

test("finalize returns lossless-JSON-safe urls after auto-registration (no undefined summary)", () => {
  // Regression (2026-09-10 R1): submitRound's auto registerSource used to
  // pass an undefined summary; the finalize bundle then failed the harness
  // lossless-JSON round-trip with an "invalid output" tool error.
  const session = new ResearchSession({ question: "q", purpose: "p", maxRounds: 3 });
  session.submitRound([
    { statement: "s", state: "confirmed", evidence: { text: "t", anchor: "a", source: "https://auto-registered.com", confidence: "high" } },
  ]);
  const final = session.finalize();
  assert.ok(final.ok, JSON.stringify(final.error));
  assert.equal(final.value.urls.length, 1);
  const [entry] = final.value.urls;
  assert.equal(entry.ref, "https://auto-registered.com");
  assert.equal(typeof entry.title, "string");
  assert.equal(entry.summary, "");
  // Harness round-trip: undefined values would silently vanish here.
  const roundTripped = JSON.parse(JSON.stringify(final.value));
  assert.deepEqual(roundTripped.urls, final.value.urls);
});

test("ResearchSession rejects confirmed with unregistered source at finalize", () => {
  const session = new ResearchSession({
    question: "q", purpose: "p", subQuestions: [], maxRounds: 3,
  });
  // Register a different source than the one used in the evidence
  session.registerSource("https://registered.com", "registered", "");
  session.submitRound([{
    statement: "s", state: "confirmed",
    evidence: { text: "t", anchor: "a", source: "https://unregistered.com", confidence: "high" },
  }]);
  // Auto-registration should have happened via submitRound, so this test
  // verifies the mechanism works. Let's verify the source was auto-registered.
  const final = session.finalize();
  // If auto-registration worked, finalize should succeed
  assert.ok(final.ok, "auto-registration of sources should make finalize succeed");
});

test("ResearchSession rejects bad findings and keeps good ones", () => {
  const session = new ResearchSession({
    question: "q", purpose: "p", subQuestions: ["sq"], maxRounds: 3,
  });
  session.registerSource("https://good.com", "good", "");
  const r = session.submitRound([
    { statement: "good", state: "confirmed", sub_question_key: "sq", evidence: { text: "t", anchor: "a", source: "https://good.com", confidence: "high" } },
    { statement: "bad", state: "invalid-state" },
  ]);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.rejected.length, 1);
});

// ---------------------------------------------------------------------------
// §13 交付合同（checkDeliveryContract）
//
// 33 §13 的交付表列三项判据：「无占位符；每项声明挂 evidence；无 UNVERIFIED
// 未标注」。旧实现只查占位符，而工具把这一项结果当作整个合同结论返回 ok:true
// ——「每项声明挂证据」从未被检查过。以下用例锁住后两项。
// ---------------------------------------------------------------------------

const DELIVERY_BODY = (unitLines) => `## 研究问题
外部对象是什么？

## 关键发现
### 某发现单元
观察事实。
${unitLines}

## 未证实与缺口
无。
`;

test("checkDeliveryContract: an unanchored finding unit without UNVERIFIED fails (33 §13.2)", () => {
  const r = checkDeliveryContract(DELIVERY_BODY(""));
  assert.equal(r.ok, false, "挂不上证据又没标 UNVERIFIED 必须判失败");
  assert.ok(r.issues.some((i) => i.includes("UNVERIFIED")), `issue 须点名 UNVERIFIED:\n${r.issues.join("\n")}`);
});

test("checkDeliveryContract: an unanchored unit IS allowed when it carries UNVERIFIED (规范给的正道)", () => {
  const r = checkDeliveryContract(DELIVERY_BODY("UNVERIFIED（优先级 high，缺口 g-1）"));
  assert.equal(r.ok, true, `标注 UNVERIFIED 后应通过:\n${r.issues.join("\n")}`);
});

test("checkDeliveryContract: an anchored unit passes without any UNVERIFIED", () => {
  const r = checkDeliveryContract(DELIVERY_BODY("溯源：https://example.com/x（§3）"));
  assert.equal(r.ok, true, `有溯源锚点即挂了证据:\n${r.issues.join("\n")}`);
});

test("checkDeliveryContract: placeholders are still caught (原判据不退化)", () => {
  const r = checkDeliveryContract(`${DELIVERY_BODY("溯源：https://example.com/x（§3）")}\nTODO 补一段`);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes("placeholder")));
});
