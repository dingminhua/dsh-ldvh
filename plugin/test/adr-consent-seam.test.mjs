// Direct unit tests for `requestAdrConsent` (plugin/lib/host-seams.js).
//
// Why this file exists: adr-tools.test.mjs injects a FAKE seam, so it proves the
// call sites are wired but never exercises the seam's own parse. An independent
// review of workcase-3e0ad5ca measured that gap concretely — changing the parse
// to fall back to `answers[0]` and dropping the `agent` forwarding left ALL 27
// adr-tools cases green. The 22 §16 Gate fails closed only if this function
// itself refuses every answer shape other than an exact affirmative AND carries
// the live agent (without it the host forwarder declines → NO_PROVIDER).
//
// This file also owns the 200-char `question` bound (ADR 7ceaf7fc) for ADR asks:
// the host imposes no length check, so nothing but these assertions holds it.
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

const QUESTION_ID = "ldvh-adr-consent";

/** The 呈报内容 the caller must supply (22 §16). */
const REPORT = "查重结论：与既有 active ADR 无同题\n决定陈述：示例决定。\n适用范围：示例范围。";

/** A live-looking agent carrier: the forwarder matches on identity. */
const AGENT = { marker: "live-agent" };

const CALL = {
  action: "create",
  objectTitle: "示例 ADR",
  summary: REPORT,
  agent: AGENT,
  signal: undefined,
};

// ---------------------------------------------------------------------------
// Fail-closed: no answerer
// ---------------------------------------------------------------------------

test("adr consent: no answerer installed → refused, and no question is asked", async () => {
  const { seams, install } = installWith(null);
  const out = await seams.requestAdrConsent(CALL);
  assert.equal(out.granted, false);
  assert.match(out.reason, /no human-answerer entry/);
  install.dispose();
});

// ---------------------------------------------------------------------------
// The 呈报内容 requirement — asking without the report is itself a refusal
// ---------------------------------------------------------------------------

test("adr consent: an empty/absent 呈报内容 is refused WITHOUT asking a content-free question", async () => {
  for (const summary of [undefined, null, "", "   "]) {
    let asked = 0;
    const { seams, install } = installWith(async () => { asked += 1; return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] }; });
    const out = await seams.requestAdrConsent({ ...CALL, summary });
    assert.equal(out.granted, false, `summary=${JSON.stringify(summary)} must not grant`);
    assert.match(out.reason, /呈报内容/);
    assert.equal(asked, 0, "no question may be asked when there is nothing to judge");
    install.dispose();
  }
});

// ---------------------------------------------------------------------------
// The exact affirmative grants; every other shape refuses
// ---------------------------------------------------------------------------

test("adr consent: the exact affirmative label grants", async () => {
  const { seams, install } = installWith(async () => ({ answers: [{ id: QUESTION_ID, selected: ["确认"] }] }));
  const out = await seams.requestAdrConsent(CALL);
  assert.equal(out.granted, true, JSON.stringify(out));
  install.dispose();
});

test("adr consent: decline / no choice / wrong id / empty answers all refuse", async () => {
  const shapes = [
    ["declined (取消)", { answers: [{ id: QUESTION_ID, selected: ["取消"] }] }],
    ["no selection", { answers: [{ id: QUESTION_ID, selected: [] }] }],
    ["no answers array", {}],
    ["empty answers", { answers: [] }],
    ["a DIFFERENT question's affirmative (same label)", { answers: [{ id: "ldvh-spark-consent", selected: ["确认"] }] }],
    ["multi-select", { answers: [{ id: QUESTION_ID, selected: ["确认", "取消"] }] }],
    ["a shape never offered (true)", { answers: [{ id: QUESTION_ID, selected: [true] }] }],
    ["a shape never offered (\"yes\")", { answers: [{ id: QUESTION_ID, selected: ["yes"] }] }],
  ];
  for (const [name, reply] of shapes) {
    const { seams, install } = installWith(async () => reply);
    const out = await seams.requestAdrConsent(CALL);
    assert.equal(out.granted, false, `${name} must NOT grant: ${JSON.stringify(out)}`);
    install.dispose();
  }
});

test("adr consent: an affirmative given to ANOTHER question in the same batch does not grant", async () => {
  // The exact defect an independent review proved was untested: falling back to
  // `answers[0]` would grant ADR consent from a "yes" given to a different
  // question. The affirmative here comes FIRST, so a first-entry fallback grants.
  const { seams, install } = installWith(async () => ({
    answers: [
      { id: "ldvh-spark-consent", selected: ["确认"] },
      { id: QUESTION_ID, selected: [] },
    ],
  }));
  const out = await seams.requestAdrConsent(CALL);
  assert.equal(out.granted, false, `must not inherit another question's affirmative: ${JSON.stringify(out)}`);
  install.dispose();
});

test("adr consent: a throwing answerer fails closed (ASK_ABORTED is not consent)", async () => {
  const { seams, install } = installWith(async () => { throw new Error("ASK_ABORTED"); });
  const out = await seams.requestAdrConsent(CALL);
  assert.equal(out.granted, false);
  assert.match(out.reason, /failed/);
  install.dispose();
});

// ---------------------------------------------------------------------------
// Transport: agent + signal forwarding (both are load-bearing)
// ---------------------------------------------------------------------------

test("adr consent: the live agent is forwarded (without it the host declines with NO_PROVIDER)", async () => {
  let seen = "absent";
  const { seams, install } = installWith(async (request) => {
    seen = request.agent ?? "absent";
    return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
  });
  const out = await seams.requestAdrConsent(CALL);
  assert.equal(out.granted, true, JSON.stringify(out));
  assert.equal(seen, AGENT, "the ask only reaches the browser answerer when it carries the live agent");
  install.dispose();
});

test("adr consent: the cancellation signal is forwarded (sole release for an abandoned prompt)", async () => {
  const controller = new AbortController();
  let forwarded = "absent";
  const { seams, install } = installWith(async (request) => {
    forwarded = request.signal;
    return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
  });
  await seams.requestAdrConsent({ ...CALL, signal: controller.signal });
  assert.equal(forwarded, controller.signal, "the tool declares no wall-clock deadline, so the signal is the only release");
  install.dispose();
});

// ---------------------------------------------------------------------------
// Bounded assembly (ADR 7ceaf7fc) and the 呈报 carrier
// ---------------------------------------------------------------------------

test("adr consent: a very long 呈报内容 keeps question ≤ 200 chars and moves the full report into detail", async () => {
  const longReport = Array.from({ length: 80 }, (_, i) => `第${i}行为退休据实说明的一部分，内容用于撑长呈报。`).join("\n\n");
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request.questions[0];
    return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
  });
  await seams.requestAdrConsent({ ...CALL, action: "retire", summary: longReport });
  // 断言用**字面值 200**，刻意不引用 ASK_QUESTION_MAX_CHARS：与实现共用同一常量
  // 等于拿实现验实现——把常量改成 5000 时用例仍全绿（实测，friction-661831ae 同型）。
  // ADR 7ceaf7fc 定的是 200 这个数，就该由断言独立持有它。
  assert.ok(seen.question.length <= 200, `question must stay within the 200-char bound, got ${seen.question.length}`);
  assert.equal(seen.detail, longReport, "the full 呈报内容 must reach the Human verbatim in the scrollable area");
  assert.ok(seen.question.includes("ADR"), "the shell still names the Gate so the Human knows what is being asked");
  install.dispose();
});

test("adr consent: an over-long shell is actually clamped (the bound must BIND, not merely cap)", async () => {
  // 前一个用例的外壳约 30 字，clamp 从不触发，故它只证明「不超」，不证明「会截」。
  // 这里用超长 objectTitle 把外壳顶过 200，逼 clamp 真的动手：断言必须**达到**
  // 上界附近且被截断，而不是原样放过。否则把 bound 改成 5000 也不会红。
  const hugeTitle = "超长标题".repeat(200);
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request.questions[0];
    return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
  });
  await seams.requestAdrConsent({ ...CALL, objectTitle: hugeTitle, summary: REPORT });
  assert.ok(seen.question.length <= 200, `the shell must be clamped to 200, got ${seen.question.length}`);
  assert.ok(seen.question.length > 100, `the shell must not be over-truncated, got ${seen.question.length}`);
  assert.ok(!seen.question.includes(hugeTitle), "an over-long title must be cut, not passed through whole");
  install.dispose();
});

test("adr consent: create and retire asks name their action in the shell", async () => {
  for (const [action, needle] of [["create", "创建"], ["retire", "转入终态"]]) {
    let seen = null;
    const { seams, install } = installWith(async (request) => {
      seen = request.questions[0];
      return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
    });
    await seams.requestAdrConsent({ ...CALL, action });
    assert.ok(seen.question.includes(needle), `${action} shell must say ${needle}: ${seen.question}`);
    install.dispose();
  }
});
