
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaptureNotice,
  captureNoticeDigest,
  resolveCaptureSwitches,
  CAPTURE_NOTICE_SUMMARY,
  CAPTURE_ENTRY_POINTS,
} from "../lib/capture-notice.js";
import { createPreStepHandler } from "../lib/guidance.js";

function makeAgent(id, cwd) {
  return { id, session: { header: { id, cwd } }, ctx: { logger: { warn: () => {} } } };
}

test("CAPTURE_NOTICE_SUMMARY 不含插件名，宿主面包屑不会重复 dsh-ldvh", () => {
  assert.doesNotMatch(CAPTURE_NOTICE_SUMMARY, /dsh-ldvh/);
  assert.match(CAPTURE_NOTICE_SUMMARY, /经验/);
  assert.match(CAPTURE_NOTICE_SUMMARY, /摩擦/);
});

test("buildCaptureNotice：两开关都关时返回空串", () => {
  assert.equal(buildCaptureNotice({ experienceEnabled: false, frictionEnabled: false }), "");
  assert.equal(buildCaptureNotice(), "");
});

test("buildCaptureNotice：只开经验时只含经验判据，不含摩擦动作", () => {
  const text = buildCaptureNotice({ experienceEnabled: true, frictionEnabled: false });
  assert.match(text, /失败机制/);
  assert.match(text, /context-supply/);
  assert.doesNotMatch(text, /派隔离子代理跑发现动作/);
  assert.doesNotMatch(text, /discovery-trigger/);
});

test("buildCaptureNotice：只开摩擦时只含摩擦判据，不含经验动作", () => {
  const text = buildCaptureNotice({ experienceEnabled: false, frictionEnabled: true });
  assert.match(text, /discovery-trigger/);
  assert.match(text, /隔离子代理/);
  assert.doesNotMatch(text, /派生零上下文代理起草/);
  assert.doesNotMatch(text, /context-supply/);
});

test("buildCaptureNotice：只摆判据，不触发记录、不派发、不设周期或静置检查点", () => {
  const text = buildCaptureNotice({ experienceEnabled: true, frictionEnabled: true });
  assert.match(text, /本行只把/);
  assert.match(text, /不触发记录/);
  assert.match(text, /不派发代理/);
  assert.match(text, /不设周期或静置检查点/);
  assert.match(text, /自行判定/);
  assert.match(text, /fail-closed/);
  const entryIds = Object.values(CAPTURE_ENTRY_POINTS).flatMap((ref) =>
    ref.split("、").map((part) => part.trim().split(/\s*的\s*/).pop()),
  );
  for (const id of entryIds) assert.ok(text.includes(id), `正文须点到 ${id}`);
});

test("resolveCaptureSwitches：总开关关时两项都关；缺省 tasks 未开不注入", () => {
  assert.deepEqual(
    resolveCaptureSwitches({ enabled: false, tasks: { "experience-accumulation": true, "friction-discovery": true } }),
    { experienceEnabled: false, frictionEnabled: false },
  );
  assert.deepEqual(resolveCaptureSwitches({ enabled: true, tasks: {} }), { experienceEnabled: false, frictionEnabled: false });
  assert.deepEqual(resolveCaptureSwitches(null), { experienceEnabled: false, frictionEnabled: false });
});

test("resolveCaptureSwitches：两项分别由各自开关决定，互不连带", () => {
  assert.deepEqual(
    resolveCaptureSwitches({ enabled: true, tasks: { "experience-accumulation": true, "friction-discovery": false } }),
    { experienceEnabled: true, frictionEnabled: false },
  );
  assert.deepEqual(
    resolveCaptureSwitches({ enabled: true, tasks: { "experience-accumulation": false, "friction-discovery": true } }),
    { experienceEnabled: false, frictionEnabled: true },
  );
});

test("captureNoticeDigest：文本相同则指纹相同，空串稳定", () => {
  const text = buildCaptureNotice({ experienceEnabled: true });
  assert.equal(captureNoticeDigest(text), text);
  assert.equal(captureNoticeDigest(""), "");
});

test("pre-step：经验/摩擦提示行按 digest 只注一次（连跑三回合）", async () => {
  const agent = makeAgent("s-capture-dedup", "/cwd");
  const channel = { primePending: true, lastDigest: null, lastReviewAskDigest: null, lastCaptureDigest: null };
  const text = buildCaptureNotice({ experienceEnabled: true, frictionEnabled: true });
  const handler = createPreStepHandler(agent, {
    isGoverned: () => true,
    channel,
    noticeText: () => null,
    noticeSummary: () => "",
    captureRow: async () => ({ inject: true, text, digest: captureNoticeDigest(text) }),
    captureSummary: () => CAPTURE_NOTICE_SUMMARY,
  });
  const base = () => [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }];
  const count = (messages) => messages.filter((m) => (m?.source?.summary ?? "") === CAPTURE_NOTICE_SUMMARY).length;
  const counts = [];
  for (let turn = 1; turn <= 3; turn += 1) {
    const out = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: base() }));
    counts.push(count(out.messages));
  }
  assert.deepEqual(counts, [1, 0, 0], "与把关行/召回行同形：按 digest 只注一次");
});

test("pre-step：captureRow inject:false 时不注入，开关全关由调用方决定", async () => {
  const agent = makeAgent("s-capture-off", "/cwd");
  const handler = createPreStepHandler(agent, {
    isGoverned: () => true,
    channel: { primePending: true, lastDigest: null, lastCaptureDigest: null },
    noticeText: () => null,
    noticeSummary: () => "",
    captureRow: async () => ({ inject: false, reason: "all-switches-off" }),
    captureSummary: () => CAPTURE_NOTICE_SUMMARY,
  });
  const out = await handler.handler({ agent, step: 1, signal: {} }, async () => ({
    kind: "enter",
    messages: [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }],
  }));
  assert.equal(out.messages.filter((m) => (m?.source?.summary ?? "") === CAPTURE_NOTICE_SUMMARY).length, 0);
});
