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
// This file also owns the 200-char `question` bound (ADR 7ceaf7fc). The host
// imposes NO length check, so nothing but these assertions holds it in place.
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
// The 200-char bound (ADR 7ceaf7fc) — the report is carried in `detail`
//
// The defect this pins: `question` renders in the card's non-shrinkable title
// area (no clamp, no scroll), while `detail` and the options share the
// SCROLLABLE body. An unbounded report in `question` therefore pushes the
// options out of reach — measured three Spark create confirms that ended
// fail-closed because the Human could not answer. The host imposes NO length
// check of its own, so the bound can only hold if this seam holds it.
// ---------------------------------------------------------------------------

test("spark consent: the report reaches the Human verbatim via detail, and question stays within the bound", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  await seams.requestSparkConsent(CALL);
  const q = seen.questions[0];
  assert.equal(q.id, "ldvh-spark-consent", "the question id is shared with the parser");
  assert.equal(q.detail, REPORT, `the report must reach the Human verbatim: ${q.detail}`);
  assert.ok(
    q.question.length <= ASK_QUESTION_MAX_CHARS,
    `question must stay within the bound, got ${q.question.length}: ${q.question}`
  );
  assert.ok(q.question.includes("示例对象"), "the object title must be shown");
  assert.ok(q.question.includes("创建"), "the verb must be shown");
  // The report is carried in `detail`; repeating it in `question` would defeat
  // the bound as soon as the report grows past it.
  assert.ok(!q.question.includes(REPORT), "the report must not be duplicated into the bounded question");
  // The offered labels are exactly what the parser accepts.
  const labels = q.options.map((o) => o.label);
  assert.deepEqual(labels, ["确认", "取消"]);
  install.dispose();
});

test("spark consent: an OVERSIZED report stays wholly in detail — question is bounded and nothing is lost", async () => {
  // The real failure mode (ADR 7ceaf7fc §决策背景): ~3000 chars of 呈报 in
  // `question` left the Human unable to reach the options. This asserts both
  // halves of the disposition — the title area is bounded, AND the content
  // moved rather than being truncated away.
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
  assert.equal(q.detail, oversized.trim(), "the whole report must be carried verbatim in detail");
  install.dispose();
});

test("spark consent: an over-long object TITLE is bounded in question while the report survives", async () => {
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
  assert.equal(q.detail, REPORT, "the report must be carried verbatim regardless of title length");
  install.dispose();
});

test("spark consent: the terminal action says 转入终态 and still requires the report", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  const report = "拟转状态：implemented\ndisposition：已落实。";
  const out = await seams.requestSparkConsent({ ...CALL, action: "terminal", summary: report });
  assert.equal(out.granted, true, JSON.stringify(out));
  assert.ok(seen.questions[0].question.includes("转入终态"), seen.questions[0].question);
  assert.ok(seen.questions[0].detail.includes("disposition：已落实。"), "the disposition must reach the Human");
  install.dispose();
});

test("spark consent: the bound is measured in UTF-16 units, so surrogate pairs cannot smuggle past it", async () => {
  // The bound's own criterion is `.length ≤ 200`, and the repo's other 200-char
  // cap (GIST_MAX_CHARS) measures `.length` too — NOT code points. Counting code
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
  assert.equal(q.detail, REPORT, "the report is untouched by the bound");
  install.dispose();
});

test("spark consent: the terminal gate's bounded question still fits a 200-char disposition (the case compression cannot fix)", async () => {
  // ADR 7ceaf7fc §备选与理由: the shell costs 53 chars and 20 §8 caps
  // `disposition` at 200, so the assembled `question` was ≥227 chars even at
  // the maximum legal input — no amount of compression could have worked. The
  // disposition must therefore reach the Human through `detail`.
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  const report = `拟转状态：implemented\ndisposition：${"据".repeat(200)}`;
  const out = await seams.requestSparkConsent({ ...CALL, action: "terminal", summary: report });
  assert.equal(out.granted, true, JSON.stringify(out));
  const q = seen.questions[0];
  assert.ok(q.question.length <= ASK_QUESTION_MAX_CHARS, `got ${q.question.length}: ${q.question}`);
  assert.ok(q.detail.includes("据".repeat(200)), "the full disposition must reach the Human");
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

// ---------------------------------------------------------------------------
// The routing seam's presentation (21 §6.3)
//
// The seam used to carry the AI's §6.3 lean reasons ("倾向建工单的理由" /
// "倾向直接执行的理由") in `question.detail`, which rendered as a long
// argument transcript above the two options. Human ruled (2026-10) that this
// text must not appear: it is unverifiable AI self-report, and 21 §6.3 never
// required presenting it. The routing question is a triage between two
// dispositions, not a justification the Human is asked to weigh.
//
// The 200-char bound (ADR 7ceaf7fc) still applies to `question`, and the
// Human's own words must still survive verbatim — hence the `detail` fallback
// for an over-long `request`.
// ---------------------------------------------------------------------------

const ROUTE_CALL = {
  request: "把 WC 卡片的 scope 补上",
  rationale: { forWorkcase: ["涉及前后端两处改动", "需要独立复核"], forDirect: ["改动范围小，单文件"] },
  agent: undefined,
  signal: undefined,
};

/** Answer a routing ask affirmatively, capturing the request. */
function routingCapture() {
  const state = { seen: null };
  return {
    state,
    ask: async (request) => {
      state.seen = request;
      return { answers: [{ id: "ldvh-workcase-route", selected: ["建工单走流程"] }] };
    },
  };
}

test("routing: the AI's lean rationale is NOT presented, and question stays bounded", async () => {
  const cap = routingCapture();
  const { seams, install } = installWith(cap.ask);
  const out = await seams.requestWorkcaseRouting(ROUTE_CALL);

  assert.equal(out.granted, true, JSON.stringify(out));
  const q = cap.state.seen.questions[0];
  assert.equal(q.id, "ldvh-workcase-route", "the question id is shared with the parser");
  assert.ok(q.question.length <= ASK_QUESTION_MAX_CHARS, `got ${q.question.length}: ${q.question}`);
  assert.ok(q.question.includes(ROUTE_CALL.request), "the Human's own request must reach them");
  assert.equal(q.detail, undefined, "an ordinary routing prompt carries no detail body at all");
  // Nothing of the AI's own reasoning may appear anywhere in the prompt.
  for (const item of [...ROUTE_CALL.rationale.forWorkcase, ...ROUTE_CALL.rationale.forDirect]) {
    assert.ok(!q.question.includes(item), `a lean reason must not reach the prompt: ${item}`);
    assert.equal(q.detail, undefined, `a lean reason must not reach the prompt: ${item}`);
  }
  assert.ok(!q.question.includes("取舍边界"), "the self-assessment framing must not reach the prompt");
  // The offered labels are exactly what the parser accepts.
  assert.deepEqual(q.options.map((o) => o.label), ["建工单走流程", "直接执行"]);
  install.dispose();
});

test("routing: MANY long rationale items still produce a bounded, reason-free prompt", async () => {
  const cap = routingCapture();
  const { seams, install } = installWith(cap.ask);
  const rationale = {
    forWorkcase: Array.from({ length: 30 }, (_, i) => `建工单理由 ${i}：${"据".repeat(40)}`),
    forDirect: Array.from({ length: 30 }, (_, i) => `直接理由 ${i}：${"反".repeat(40)}`),
  };
  const out = await seams.requestWorkcaseRouting({ ...ROUTE_CALL, rationale });

  assert.equal(out.granted, true, JSON.stringify(out));
  const q = cap.state.seen.questions[0];
  assert.ok(q.question.length <= ASK_QUESTION_MAX_CHARS, `got ${q.question.length}`);
  assert.equal(q.detail, undefined, "a reason list must not reappear as a detail body");
  install.dispose();
});

test("routing: an over-long request survives verbatim in the scrollable detail", async () => {
  const cap = routingCapture();
  const { seams, install } = installWith(cap.ask);
  const request = "改".repeat(ASK_QUESTION_MAX_CHARS * 2);
  const out = await seams.requestWorkcaseRouting({ ...ROUTE_CALL, request });

  assert.equal(out.granted, true, JSON.stringify(out));
  const q = cap.state.seen.questions[0];
  assert.ok(q.question.length <= ASK_QUESTION_MAX_CHARS, `got ${q.question.length}`);
  assert.ok(q.detail.includes(request), "the request must survive verbatim in detail");
  install.dispose();
});

test("routing: the cancellation signal is still forwarded under the bounded assembly", async () => {
  // The bound changes text assembly only. The cancellation contract is what
  // releases an abandoned prompt (ASK_ABORTED → fail closed instead of hanging),
  // so it must survive the refactor unchanged.
  const controller = new AbortController();
  let forwarded = "absent";
  const { seams, install } = installWith(async (request) => {
    forwarded = request.signal;
    return { answers: [{ id: "ldvh-workcase-route", selected: ["直接执行"] }] };
  });
  const out = await seams.requestWorkcaseRouting({ ...ROUTE_CALL, signal: controller.signal });
  assert.equal(out.granted, false);
  assert.equal(out.routedTo, "direct");
  assert.equal(forwarded, controller.signal, "an abandoned prompt is only released if the signal is forwarded");
  install.dispose();
});

test("routing: a throwing answerer still fails closed under the bounded assembly", async () => {
  const { seams, install } = installWith(async () => { throw new Error("ASK_ABORTED"); });
  const out = await seams.requestWorkcaseRouting(ROUTE_CALL);
  assert.equal(out.granted, false);
  assert.match(out.reason, /routing request failed/);
  install.dispose();
});
