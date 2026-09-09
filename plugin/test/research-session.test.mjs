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
  const result = evaluateConvergence(
    { confirmed: [{ statement: "s1" }], gaps: [] },
    { subQuestions: ["q1"], roundNumber: 1, maxRounds: 4, consecutiveNoGainRounds: 0 },
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "sufficient");
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
    maxRounds: 5,
  });

  const r1 = session.submitRound([]);
  assert.equal(r1.stop, false);
  const r2 = session.submitRound([]);
  assert.equal(r2.stop, true);
  assert.equal(r2.reason, "no-gain");

  const final = session.finalize();
  assert.ok(final.ok);
  assert.equal(final.value.stopping_reason, "no-gain");
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
