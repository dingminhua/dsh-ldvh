import assert from "node:assert/strict";
import test from "node:test";

import { createHostSeams } from "../lib/host-seams.js";

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

const REPORT = "查重结论：无同题\n调查问题：示例问题？\n调查边界：示例边界。\nserves：SG-1";

const CALL = {
  action: "create",
  objectTitle: "示例对象",
  summary: REPORT,
  agent: undefined,
  signal: undefined,
};


test("spark consent: no answerer installed → refused, and no question is asked", async () => {
  const { seams, install } = installWith(null);
  const out = await seams.requestSparkConsent(CALL);
  assert.equal(out.granted, false);
  assert.match(out.reason, /no human-answerer entry/);
  install.dispose();
});


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


test("spark consent: the dialog carries one title line and NO detail block", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  await seams.requestSparkConsent(CALL);
  const q = seen.questions[0];
  assert.equal(q.id, "ldvh-spark-consent", "the question id is shared with the parser");
  assert.equal(q.detail, undefined, "卡片上不得再有 detail 块（Human 2026-11-13）");
  assert.ok(q.question.includes("示例对象"), "the object title must be shown");
  assert.ok(q.question.includes("创建"), "the verb must be shown");
  assert.ok(!q.question.includes(REPORT), "the report must not be pushed into the title");
  assert.ok(!q.question.includes("查重结论"), "no report field may leak into the title");
  const labels = q.options.map((o) => o.label);
  assert.deepEqual(labels, ["确认", "取消"]);
  install.dispose();
});

test("spark consent: an OVERSIZED report still yields a detail-free dialog", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  const oversized = `${REPORT}\n`.repeat(80);
  assert.ok(oversized.length > 200, "fixture must actually exceed the bound");
  const out = await seams.requestSparkConsent({ ...CALL, summary: oversized });

  assert.equal(out.granted, true, "an oversized report must not break the gate itself");
  const q = seen.questions[0];
  assert.equal(q.detail, undefined, "no detail block may carry it instead");
  install.dispose();
});

test("spark consent: an over-long object TITLE is passed through whole (no 200-char clamp)", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  const title = "标".repeat(400);
  const out = await seams.requestSparkConsent({ ...CALL, objectTitle: title, summary: REPORT });
  assert.equal(out.granted, true, JSON.stringify(out));
  const q = seen.questions[0];
  assert.ok(q.question.includes(title), "an over-long title must not be cut");
  assert.ok(q.question.length > 200, `no length bound applies any more, got ${q.question.length}`);
  assert.ok(!q.question.endsWith("…"), "nothing may be elided");
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

test("spark consent: an over-long emoji title is passed through whole, with no broken surrogate", async () => {
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request;
    return { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] };
  });
  const emoji = "\u{1F600}".repeat(500);
  const out = await seams.requestSparkConsent({ ...CALL, objectTitle: emoji, summary: REPORT });

  assert.equal(out.granted, true, JSON.stringify(out));
  const q = seen.questions[0];
  assert.ok(q.question.includes(emoji), "the emoji title must not be cut");
  assert.ok(q.question.length > 200, `no length bound applies any more, got ${q.question.length}`);
  assert.doesNotMatch(q.question, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, "no lone high surrogate may appear");
  assert.doesNotMatch(q.question, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, "no lone low surrogate may appear");
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

