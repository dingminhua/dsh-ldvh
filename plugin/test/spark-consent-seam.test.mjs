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
import assert from "node:assert/strict";
import test from "node:test";

import { createHostSeams } from "../lib/host-seams.js";

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
// What the Human actually receives
// ---------------------------------------------------------------------------

test("spark consent: the question carries the report verbatim and the object title", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  await seams.requestSparkConsent(CALL);
  const q = seen.questions[0];
  assert.equal(q.id, "ldvh-spark-consent", "the question id is shared with the parser");
  assert.ok(q.question.includes(REPORT), `the report must reach the Human verbatim: ${q.question}`);
  assert.ok(q.question.includes("示例对象"), "the object title must be shown");
  assert.ok(q.question.includes("创建"), "the verb must be shown");
  // The offered labels are exactly what the parser accepts.
  const labels = q.options.map((o) => o.label);
  assert.deepEqual(labels, ["确认", "取消"]);
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
  assert.ok(seen.questions[0].question.includes("disposition：已落实。"), "the disposition must reach the Human");
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
