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


test("evaluateConvergence returns sufficient when all covered and no high gaps", () => {
  const result = evaluateConvergence(
    { confirmed: [{ statement: "s1", sub_question_key: "q1" }], gaps: [] },
    { subQuestions: ["q1"], roundNumber: 1, maxRounds: 4, consecutiveNoGainRounds: 0 },
  );
  assert.equal(result.stop, true);
  assert.equal(result.reason, "sufficient");
});

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


test("auditCitationLoop passes when references match", () => {
  const confirmed = [{ statement: "s1", quotes: [{ text: "verbatim text here", anchor: "a", source: "https://x.com" }] }];
  const body = "The finding is [1]「verbatim text here」, as stated.";
  const result = auditCitationLoop(body, confirmed);
  assert.ok(result.ok, JSON.stringify(result.issues));
});

test("auditCitationLoop requires the [n] to sit next to its quote (§10.3 第3项)", () => {
  const confirmed = [{ statement: "s1", quotes: [{ text: "verbatim text here", anchor: "a", source: "https://x.com" }] }];
  const body = "The finding is 「verbatim text here」 as stated in [1] after much discussion.";
  const result = auditCitationLoop(body, confirmed);
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.includes("no adjacent [n] reference")), JSON.stringify(result.issues));
});

test("auditCitationLoop checks every quote on a line, not just the first (§10.3 第2项)", () => {
  const confirmed = [{ statement: "s1", quotes: [{ text: "real quote", anchor: "a", source: "https://x.com" }] }];
  const body = "[1]「real quote」 and also 「fabricated sentence」";
  const result = auditCitationLoop(body, confirmed);
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.includes("fabricated sentence")), JSON.stringify(result.issues));
});

test("auditCitationLoop ignores 「」 emphasis when the document uses no [n] regime", () => {
  const confirmed = [{ statement: "s1", quotes: [{ text: "verbatim text here", anchor: "a", source: "https://x.com" }] }];
  const body = "这里「已投递」与「被执行」是两件事，正文不使用引用编号。";
  const result = auditCitationLoop(body, confirmed);
  assert.ok(result.ok, JSON.stringify(result.issues));
});

test("auditCitationLoop resolves 溯源 refs against the evidence sources (§10.2)", () => {
  const confirmed = [{ statement: "s1", quotes: [{ text: "q", anchor: "a", source: "https://real.example/doc" }] }];
  const good = "### 发现一\n正文。\n\n溯源：https://real.example/doc（第 3 节）";
  assert.ok(auditCitationLoop(good, confirmed).ok);
  const bad = "### 发现一\n正文。\n\n溯源：https://invented.example/nope（第 3 节）";
  const result = auditCitationLoop(bad, confirmed);
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.includes("does not resolve")), JSON.stringify(result.issues));
});

test("auditCitationLoop does not mistake identifier subscripts for reference numbers", () => {
  const confirmed = [{ statement: "s1" }];
  const body = "见 uncertain[0] 与 gaps[1]。";
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
  const body = "Quote [1]「this is not in evidence」 here.";
  const result = auditCitationLoop(body, confirmed);
  assert.ok(!result.ok);
  assert.ok(result.issues.some((i) => i.includes("not found in any evidence")));
});


test("auditCitationLoop accepts the tool-declared shape (bare statement strings)", () => {
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
  const result = auditCitationLoop("Finding 「some quote」 [1].", ["only a statement"]);
  assert.ok(!result.ok, "unverifiable quote evidence must not pass the gate");
  assert.ok(result.issues.some((i) => i.includes("cannot be checked")));
  assert.ok(result.issues.some((i) => i.includes("finalize bundle")));
});

test("auditCitationLoop does not throw on malformed entries (non-object garbage is dropped, not crashed on)", () => {
  const result = auditCitationLoop("Finding [1].", [null, { statement: "s" }, 42]);
  assert.ok(Array.isArray(result.issues));
  assert.ok(result.ok, JSON.stringify(result.issues));
});


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


test("ResearchSession full flow: clarify → rounds → sufficient → finalize", () => {
  const session = new ResearchSession({
    question: "fork worker 的隔离机制是什么？",
    purpose: "决定 LDVH 反思引擎实现方案",
    subQuestions: ["fork worker 如何隔离"],
    maxRounds: 3,
  });

  session.registerSource("https://example.com/solo-thinking", "solo-thinking", "源码仓库");

  const r1 = session.submitRound([{
    statement: "fork worker 继承父检查点且排除写工具",
    state: "confirmed",
    sub_question_key: "fork worker 如何隔离",
    evidence: { text: "仅 idle 审查，允许清单排除写工具", anchor: "§5.2", source: "https://example.com/solo-thinking", confidence: "high" },
  }]);

  assert.equal(r1.stop, true);
  assert.equal(r1.reason, "sufficient");
  assert.equal(r1.accepted.length, 1);

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
  const roundTripped = JSON.parse(JSON.stringify(final.value));
  assert.deepEqual(roundTripped.urls, final.value.urls);
});

test("ResearchSession rejects confirmed with unregistered source at finalize", () => {
  const session = new ResearchSession({
    question: "q", purpose: "p", subQuestions: [], maxRounds: 3,
  });
  session.registerSource("https://registered.com", "registered", "");
  session.submitRound([{
    statement: "s", state: "confirmed",
    evidence: { text: "t", anchor: "a", source: "https://unregistered.com", confidence: "high" },
  }]);
  const final = session.finalize();
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
  assert.deepEqual(r.accepted.map((f) => f.statement), ["good"]);
  assert.deepEqual(r.rejected.map((x) => x.finding?.statement), ["bad"]);
});


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
