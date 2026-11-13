// Direct unit tests for `requestSparkConsent` (plugin/lib/host-seams.js).
//
// Why this file exists: spark-tools.test.mjs injects a FAKE seam, so it proves
// the call site is wired but never exercises the real parse. The 20 §16 Gate
// fails closed only if `requestSparkConsent` itself refuses every answer shape
// other than an exact affirmative — an independent adversarial review
// (2026-09-26) flagged that parse path as untested. These cases pin it.
//
// The host returns `selected` as an ARRAY of labels
// (`{answers:[{id, selected:["确认"]}]}`), which is why a scalar comparison
// silently fails open-or-shut. Each shape below is asserted explicitly.
//
// This file also owns the 200-char `question` bound and the "no detail block"
// rule (Human 2026-11-13: 所有经 LDVH 业务的提请都简洁，title 在 200 字内，
// 没有其它细节信息). The host imposes NO length check, so nothing but these
// assertions holds it in place.
import assert from "node:assert/strict";
import test from "node:test";

import { createHostSeams, ASK_QUESTION_MAX_CHARS } from "../lib/host-seams.js";

/** Install seams against a ctx whose answerer is driven by `ask`. */
function installWith(ask) {
  const seams = createHostSeams();
  const ctx = {
    get: (key) => ({
      tools: { guard: () => () => {} },
      invariants: { register: () => () => {} },
      userQuestions: ask === null ? undefined : { ask },
      fs: { resolve: async (p) => ({ targetKey: `tk:${p}`, displayPath: p }), stat: async () => ({ version: "v", type: "file" }) },
    }[key]),
    on: () => () => {},
    emit: () => {},
    logger: { info() {} },
  };
  const install = seams.install(ctx, { dshHomePath: () => "/tmp/none" });
  return { seams, install };
}

/** The 呈报内容 the caller must supply (20 §16). */
const REPORT = "查重结论：无同题\n调查问题：示例问题？\n调查边界：示例边界。\nserves：SG-1";

const CALL = {
  action: "create",
  objectTitle: "示例对象",
  summary: REPORT,
  agent: undefined,
  signal: undefined,
};

// ---------------------------------------------------------------------------
// Fail-closed: no answerer
// ---------------------------------------------------------------------------

test("spark consent: no answerer installed → refused, and no question is asked", async () => {
  const { seams, install } = installWith(null);
  const out = await seams.requestSparkConsent(CALL);
  assert.equal(out.granted, false);
  assert.match(out.reason, /no human-answerer entry/);
  install.dispose();
});

// ---------------------------------------------------------------------------
// The 呈报内容 requirement — asking without the report is itself a refusal
// ---------------------------------------------------------------------------

test("spark consent: an empty/absent 呈报内容 is refused WITHOUT asking a content-free question", async () => {
  for (const summary of [undefined, null, "", "   "]) {
    let asked = 0;
    const { seams, install } = installWith(async () => { asked += 1; return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] }; });
    const out = await seams.requestSparkConsent({ ...CALL, summary });
    assert.equal(out.granted, false, `summary=${JSON.stringify(summary)} must not grant`);
    assert.match(out.reason, /呈报内容/);
    assert.equal(asked, 0, "no question may be asked when there is nothing to judge");
    install.dispose();
  }
});

// ---------------------------------------------------------------------------
// The affirmative — the exact label the seam offered, as a single-element array
// ---------------------------------------------------------------------------

test("spark consent: the exact affirmative label grants", async () => {
  const { seams, install } = installWith(async () => ({ answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] }));
  const out = await seams.requestSparkConsent(CALL);
  assert.equal(out.granted, true, JSON.stringify(out));
  install.dispose();
});

test("spark consent: a scalar (non-array) selected is still read correctly", async () => {
  const { seams, install } = installWith(async () => ({ answers: [{ id: "ldvh-spark-consent", selected: "确认" }] }));
  const out = await seams.requestSparkConsent(CALL);
  assert.equal(out.granted, true, JSON.stringify(out));
  install.dispose();
});

// ---------------------------------------------------------------------------
// Every other shape must refuse
// ---------------------------------------------------------------------------

test("spark consent: decline / no choice / wrong id / empty answers all refuse", async () => {
  const shapes = [
    ["declined (取消)", { answers: [{ id: "ldvh-spark-consent", selected: ["取消"] }] }],
    ["no selection", { answers: [{ id: "ldvh-spark-consent", selected: [] }] }],
    ["no answers array", {}],
    ["empty answers", { answers: [] }],
    ["a DIFFERENT question's affirmative", { answers: [{ id: "ldvh-registration-consent", selected: ["确认"] }] }],
    ["multi-select", { answers: [{ id: "ldvh-spark-consent", selected: ["确认", "取消"] }] }],
    ["a shape never offered (true)", { answers: [{ id: "ldvh-spark-consent", selected: [true] }] }],
    ["a shape never offered (\"yes\")", { answers: [{ id: "ldvh-spark-consent", selected: ["yes"] }] }],
  ];
  for (const [name, reply] of shapes) {
    const { seams, install } = installWith(async () => reply);
    const out = await seams.requestSparkConsent(CALL);
    assert.equal(out.granted, false, `${name} must NOT grant: ${JSON.stringify(out)}`);
    install.dispose();
  }
});

test("spark consent: a throwing answerer fails closed (ASK_ABORTED is not consent)", async () => {
  const { seams, install } = installWith(async () => { throw new Error("ASK_ABORTED"); });
  const out = await seams.requestSparkConsent(CALL);
  assert.equal(out.granted, false);
  assert.match(out.reason, /spark consent request failed/);
  install.dispose();
});

// ---------------------------------------------------------------------------
// The dialog carries ONE line (Human 2026-11-13)
//
// 决定原文：「所有经过 ldvh 业务的提请，都要求内容简洁，title 字数在 200 字内，
// 没有其它细节信息」。因此本接缝的弹窗只放一行动作标题，**不带 `detail`**；
// 20 §16 的呈报内容改由主控在调用之前写进对话正文。
//
// 两个方向都要钉住，否则「简洁」会一路滑到「空问一句」：
//   - 标题有界、且不带 detail（本组上半）；
//   - 呈报缺失时**仍然拒绝提问**（本组下半）——接缝不再承载呈报，但不接受
//     一个从未产生过呈报的调用。
//
// 代价如实记在这里：机械层**不再证明 Human 看到过完整呈报**，只证明取得过
// 一次明确肯定答复。20 §16 的据实声明段已登记该缺口。
// ---------------------------------------------------------------------------

test("spark consent: the dialog carries one bounded title line and NO detail block", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  await seams.requestSparkConsent(CALL);
  const q = seen.questions[0];
  assert.equal(q.id, "ldvh-spark-consent", "the question id is shared with the parser");
  assert.equal(q.detail, undefined, "卡片上不得再有 detail 块（Human 2026-11-13）");
  assert.ok(
    q.question.length <= ASK_QUESTION_MAX_CHARS,
    `question must stay within the bound, got ${q.question.length}: ${q.question}`
  );
  assert.ok(q.question.includes("示例对象"), "the object title must be shown");
  assert.ok(q.question.includes("创建"), "the verb must be shown");
  // 呈报正文不得再挤进标题——它是对话正文的活，不是弹窗的。
  assert.ok(!q.question.includes(REPORT), "the report must not be pushed into the title");
  assert.ok(!q.question.includes("查重结论"), "no report field may leak into the title");
  // The offered labels are exactly what the parser accepts.
  const labels = q.options.map((o) => o.label);
  assert.deepEqual(labels, ["确认", "取消"]);
  install.dispose();
});

test("spark consent: an OVERSIZED report still yields a bounded, detail-free dialog", async () => {
  // 原失败形态（~3000 字符呈报塞进 question）让 Human 够不到选项。现在的处置
  // 不是「移进 detail」，而是「不进弹窗」——所以这里断言的是**不再有长文本**，
  // 而不是「长文本搬到了哪一格」。
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  const oversized = `${REPORT}\n`.repeat(80); // far beyond the bound
  assert.ok(oversized.length > ASK_QUESTION_MAX_CHARS, "fixture must actually exceed the bound");
  const out = await seams.requestSparkConsent({ ...CALL, summary: oversized });

  assert.equal(out.granted, true, "an oversized report must not break the gate itself");
  const q = seen.questions[0];
  assert.ok(
    q.question.length <= ASK_QUESTION_MAX_CHARS,
    `question must stay within the bound, got ${q.question.length}`
  );
  assert.equal(q.detail, undefined, "no detail block may carry it instead");
  install.dispose();
});

test("spark consent: an over-long object TITLE is clamped, and nothing else grows", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  const title = "标".repeat(ASK_QUESTION_MAX_CHARS * 2);
  const out = await seams.requestSparkConsent({ ...CALL, objectTitle: title, summary: REPORT });
  assert.equal(out.granted, true, JSON.stringify(out));
  const q = seen.questions[0];
  assert.ok(q.question.length <= ASK_QUESTION_MAX_CHARS, `got ${q.question.length}`);
  assert.ok(q.question.endsWith("…"), "an over-long title is cut, not passed through");
  assert.equal(q.detail, undefined);
  install.dispose();
});

test("spark consent: the terminal action says 转入终态 in the title, and the dialog stays detail-free", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  const report = "拟转状态：implemented\ndisposition：已落实。";
  const out = await seams.requestSparkConsent({ ...CALL, action: "terminal", summary: report });
  assert.equal(out.granted, true, JSON.stringify(out));
  const q = seen.questions[0];
  assert.ok(q.question.includes("转入终态"), q.question);
  assert.equal(q.detail, undefined, "disposition goes to the conversation body, not the card");
  install.dispose();
});

test("spark consent: the bound is measured in UTF-16 units, so surrogate pairs cannot smuggle past it", async () => {
  // The bound's own criterion is `.length <= 200`, and the repo's other 200-char
  // cap (GIST_MAX_CHARS) measures `.length` too - NOT code points. Counting code
  // points instead lets an all-emoji title reach `.length = 366` while looking
  // like "exactly 200", i.e. the cap silently fails open on exactly the text a
  // Chinese-language project is most likely to receive.
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  const emoji = "\u{1F600}".repeat(500); // 500 code points = 1000 UTF-16 units
  const out = await seams.requestSparkConsent({ ...CALL, objectTitle: emoji, summary: REPORT });

  assert.equal(out.granted, true, JSON.stringify(out));
  const q = seen.questions[0];
  assert.ok(
    q.question.length <= ASK_QUESTION_MAX_CHARS,
    `the bound must hold in .length units, got ${q.question.length}`
  );
  // Truncation must not split a surrogate pair (half a pair renders as U+FFFD).
  assert.doesNotMatch(q.question, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, "no lone high surrogate may survive the cut");
  assert.doesNotMatch(q.question, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, "no lone low surrogate may survive the cut");
  install.dispose();
});

test("spark consent: the caller's cancellation signal is forwarded to the host", async () => {
  const controller = new AbortController();
  let forwarded = "absent";
  const { seams, install } = installWith(async (request) => {
    forwarded = request.signal;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  await seams.requestSparkConsent({ ...CALL, signal: controller.signal });
  assert.equal(forwarded, controller.signal, "an abandoned prompt is only released if the signal is forwarded");
  install.dispose();
});

