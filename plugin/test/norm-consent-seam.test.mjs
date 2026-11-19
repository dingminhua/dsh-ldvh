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

const QUESTION_ID = "ldvh-norm-consent";

const REPORT = "查重结论：与既有 active 方向键无同名\n决定陈述：示例方向规范。\n适用范围：示例管辖范围。";

const AGENT = { marker: "live-agent" };

const CALL = {
  action: "create",
  objectTitle: "示例 Norm",
  summary: REPORT,
  agent: AGENT,
  signal: undefined,
};


test("norm consent: no answerer installed → refused, and no question is asked", async () => {
  const { seams, install } = installWith(null);
  const out = await seams.requestNormConsent(CALL);
  assert.equal(out.granted, false);
  assert.match(out.reason, /no human-answerer entry/);
  install.dispose();
});


test("norm consent: an empty/absent 呈报内容 is refused WITHOUT asking a content-free question", async () => {
  for (const summary of [undefined, null, "", "   "]) {
    let asked = 0;
    const { seams, install } = installWith(async () => { asked += 1; return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] }; });
    const out = await seams.requestNormConsent({ ...CALL, summary });
    assert.equal(out.granted, false, `summary=${JSON.stringify(summary)} must not grant`);
    assert.match(out.reason, /呈报内容/);
    assert.equal(asked, 0, "no question may be asked when there is nothing to judge");
    install.dispose();
  }
});


test("norm consent: the exact affirmative label grants", async () => {
  const { seams, install } = installWith(async () => ({ answers: [{ id: QUESTION_ID, selected: ["确认"] }] }));
  const out = await seams.requestNormConsent(CALL);
  assert.equal(out.granted, true, JSON.stringify(out));
  install.dispose();
});

test("norm consent: decline / no choice / wrong id / empty answers all refuse", async () => {
  const shapes = [
    ["declined (取消)", { answers: [{ id: QUESTION_ID, selected: ["取消"] }] }],
    ["no selection", { answers: [{ id: QUESTION_ID, selected: [] }] }],
    ["no answers array", {}],
    ["empty answers", { answers: [] }],
    ["a DIFFERENT question's affirmative (same label)", { answers: [{ id: "ldvh-registration-consent", selected: ["确认"] }] }],
    ["multi-select", { answers: [{ id: QUESTION_ID, selected: ["确认", "取消"] }] }],
    ["a shape never offered (true)", { answers: [{ id: QUESTION_ID, selected: [true] }] }],
    ["a shape never offered (\"yes\")", { answers: [{ id: QUESTION_ID, selected: ["yes"] }] }],
  ];
  for (const [name, reply] of shapes) {
    const { seams, install } = installWith(async () => reply);
    const out = await seams.requestNormConsent(CALL);
    assert.equal(out.granted, false, `${name} must NOT grant: ${JSON.stringify(out)}`);
    install.dispose();
  }
});

test("norm consent: an affirmative given to ANOTHER question in the same batch does not grant", async () => {
  const { seams, install } = installWith(async () => ({
    answers: [
      { id: "ldvh-registration-consent", selected: ["确认"] },
      { id: QUESTION_ID, selected: [] },
    ],
  }));
  const out = await seams.requestNormConsent(CALL);
  assert.equal(out.granted, false, `must not inherit another question's affirmative: ${JSON.stringify(out)}`);
  install.dispose();
});

test("norm consent: a throwing answerer fails closed (ASK_ABORTED is not consent)", async () => {
  const { seams, install } = installWith(async () => { throw new Error("ASK_ABORTED"); });
  const out = await seams.requestNormConsent(CALL);
  assert.equal(out.granted, false);
  assert.match(out.reason, /failed/);
  install.dispose();
});


test("norm consent: the live agent is forwarded (without it the host declines with NO_PROVIDER)", async () => {
  let seen = "absent";
  const { seams, install } = installWith(async (request) => {
    seen = request.agent ?? "absent";
    return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
  });
  const out = await seams.requestNormConsent(CALL);
  assert.equal(out.granted, true, JSON.stringify(out));
  assert.equal(seen, AGENT, "the ask only reaches the browser answerer when it carries the live agent");
  install.dispose();
});

test("norm consent: the cancellation signal is forwarded (sole release for an abandoned prompt)", async () => {
  const controller = new AbortController();
  let forwarded = "absent";
  const { seams, install } = installWith(async (request) => {
    forwarded = request.signal;
    return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
  });
  await seams.requestNormConsent({ ...CALL, signal: controller.signal });
  assert.equal(forwarded, controller.signal, "the tool declares no wall-clock deadline, so the signal is the only release");
  install.dispose();
});


test("norm consent: a very long 呈报内容 still yields a bounded, detail-free dialog", async () => {
  const longReport = Array.from({ length: 80 }, (_, i) => `第${i}行为退休据实说明的一部分，内容用于撑长呈报。`).join("\n\n");
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request.questions[0];
    return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
  });
  await seams.requestNormConsent({ ...CALL, action: "retire", summary: longReport });
  assert.ok(seen.question.length <= 200, `question must stay within the 200-char bound, got ${seen.question.length}`);
  assert.equal(seen.detail, undefined, "呈报不随弹窗下发（Human 2026-11-13）");
  assert.ok(!seen.question.includes("第0行为"), "the report must not be pushed into the title");
  assert.ok(seen.question.includes("Norm"), "the shell still names the Gate so the Human knows what is being asked");
  install.dispose();
});

test("norm consent: an over-long shell is actually clamped (the bound must BIND, not merely cap)", async () => {
  const hugeTitle = "超长标题".repeat(200);
  let seen = null;
  const { seams, install } = installWith(async (request) => {
    seen = request.questions[0];
    return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
  });
  await seams.requestNormConsent({ ...CALL, objectTitle: hugeTitle, summary: REPORT });
  assert.ok(seen.question.length <= 200, `the shell must be clamped to 200, got ${seen.question.length}`);
  assert.ok(seen.question.length > 100, `the shell must not be over-truncated, got ${seen.question.length}`);
  assert.ok(!seen.question.includes(hugeTitle), "an over-long title must be cut, not passed through whole");
  install.dispose();
});

test("norm consent: create and retire asks name their action in the shell", async () => {
  for (const [action, needle] of [["create", "创建"], ["retire", "转入终态"]]) {
    let seen = null;
    const { seams, install } = installWith(async (request) => {
      seen = request.questions[0];
      return { answers: [{ id: QUESTION_ID, selected: ["确认"] }] };
    });
    await seams.requestNormConsent({ ...CALL, action });
    assert.ok(seen.question.includes(needle), `${action} shell must say ${needle}: ${seen.question}`);
    install.dispose();
  }
});
