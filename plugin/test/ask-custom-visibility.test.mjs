/**
 * 2026-11-14 修复回归：提请卡「自由输入 + 点提交」不再被视为跳过、文字不再丢失。
 *
 * 宿主 QuestionComposer.tsx:385-395 在「单选 + 自由输入」时产出
 *   { id, selected: [], custom: "..." }
 * host-seams.js 的 selectedLabelOf 原先只读 selected，于是 custom 被静默丢弃：
 * decision=null（未决策）、模型一个字都看不到。本文件钉住修复后的行为：
 *   - 文字逐字回到 custom_note / reason / render / follow_up；
 *   - decision 仍守 32 §9.1 的 review|skip 闭集，自由文本不冒充其中任何一个；
 *   - 三处 Human Gate 仍 fail-closed，但拒绝理由里带上文字、不静默丢弃；
 *   - 「点跳过按钮」({selected:[]}) 与「自由输入提交」在 reason 上可区分。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostSeams } from "../lib/host-seams.js";
import { executeReviewAsk } from "../lib/review-ask-tool.js";
import { renderEnvelope } from "../lib/ldvh-tools.js";

const FREE_TEXT = "老丁：请特别核对 X 模块别漏了";
const REVIEW_LABEL = "安排代理";
const SKIP_LABEL = "跳过，直接推进";

function installWith(answer) {
  const home = mkdtempSync(join(tmpdir(), "ldvh-custom-"));
  const seams = createHostSeams();
  let seenRequest = null;
  seams.install({
    get: (k) => (k === "userQuestions"
      ? { ask: async (r) => { seenRequest = r; return answer; } }
      : undefined),
  }, { dshHomePath: (...parts) => join(home, ...parts) });
  return { seams, home, get seenRequest() { return seenRequest; } };
}

function reviewCall(extra = {}) {
  return {
    point: "pre-action",
    task: "修复提请框自由输入丢失",
    enabled: true,
    preAction: true,
    postWork: false,
    silentRun: false,
    ...extra,
  };
}

// ── 主 bug：把关请示 seam ────────────────────────────────────────────────────

test("自由输入提交：custom_note 逐字回传，decision 仍为 null（不冒充答复）", async () => {
  const { seams } = installWith({
    answers: [{ id: "ldvh-review-ask", selected: [], custom: FREE_TEXT }],
  });
  const out = await seams.requestReviewAsk(reviewCall());
  assert.equal(out.custom_note, FREE_TEXT, "文字必须逐字可见");
  assert.equal(out.decision, null, "自由输入不是 review/skip 答复");
  assert.equal(out.asked, true);
  assert.match(out.reason, /free-text answer submitted/);
  assert.match(out.reason, new RegExp(FREE_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("点跳过按钮（无 custom）：与自由输入提交在 reason 上可区分，且不带 custom_note", async () => {
  const { seams } = installWith({
    answers: [{ id: "ldvh-review-ask", selected: [] }],
  });
  const out = await seams.requestReviewAsk(reviewCall());
  assert.equal(out.custom_note, undefined);
  assert.equal(out.decision, null);
  assert.match(out.reason, /skipped \/ no option chosen/);
  assert.doesNotMatch(out.reason, /free-text/);
});

test("点选项：decision 正常，且若同带 custom 也把文字回传（不改写决定）", async () => {
  const { seams } = installWith({
    answers: [{ id: "ldvh-review-ask", selected: [REVIEW_LABEL], custom: FREE_TEXT }],
  });
  const out = await seams.requestReviewAsk(reviewCall());
  assert.equal(out.decision, "review");
  assert.equal(out.custom_note, FREE_TEXT);
});

test("点跳过选项：decision=skip，自由文本不改变它", async () => {
  const { seams } = installWith({
    answers: [{ id: "ldvh-review-ask", selected: [SKIP_LABEL], custom: FREE_TEXT }],
  });
  const out = await seams.requestReviewAsk(reviewCall());
  assert.equal(out.decision, "skip");
  assert.equal(out.custom_note, FREE_TEXT);
});

test("custom 不进留痕载体（载体只记闭集答复）", async () => {
  const { seams, home } = installWith({
    answers: [{ id: "ldvh-review-ask", selected: [REVIEW_LABEL], custom: FREE_TEXT }],
  });
  await seams.requestReviewAsk(reviewCall());
  const { readFileSync, existsSync } = await import("node:fs");
  const carrier = join(home, "ldvh", "review-ask-decisions.json");
  assert.equal(existsSync(carrier), true);
  const raw = readFileSync(carrier, "utf8");
  assert.doesNotMatch(raw, /custom_note/);
  assert.doesNotMatch(raw, new RegExp(FREE_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(raw, /"answer": "review"/);
});

// ── 工具信封 + render（模型唯一可见窗口，03 §9.5）─────────────────────────

test("executeReviewAsk：custom_note 进入 result，且 follow_up 指引主控读它", async () => {
  const { seams } = installWith({
    answers: [{ id: "ldvh-review-ask", selected: [], custom: FREE_TEXT }],
  });
  const env = await executeReviewAsk(reviewCall(), {}, {
    hostSeams: seams,
    getReviewAskSettings: () => ({ preAction: true, postWork: false, silentRun: false, preActionKnown: true, postWorkKnown: true, silentRunKnown: true }),
  });
  assert.equal(env.result.custom_note, FREE_TEXT);
  assert.equal(env.result.decision, null);
  assert.ok(env.follow_up.some((line) => /custom_note/.test(line)), "follow_up 须指引读文字");
});

test("renderEnvelope：custom_note 逐字打给模型，且明说不冒充答复", async () => {
  const { seams } = installWith({
    answers: [{ id: "ldvh-review-ask", selected: [], custom: FREE_TEXT }],
  });
  const env = await executeReviewAsk(reviewCall(), {}, {
    hostSeams: seams,
    getReviewAskSettings: () => ({ preAction: true, postWork: false, silentRun: false, preActionKnown: true, postWorkKnown: true, silentRunKnown: true }),
  });
  const rendered = renderEnvelope("review-ask", { envelope: env });
  const text = JSON.stringify(rendered);
  assert.match(text, new RegExp(FREE_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, /非答复|不冒充/);
});

// ── 三处 Human Gate：同源修复，fail-closed 不变，文字可见 ───────────────────

function gateSeam(answer) {
  const seams = createHostSeams();
  seams.install({
    get: (k) => (k === "userQuestions" ? { ask: async () => answer } : undefined),
  }, { dshHomePath: () => "/tmp/none" });
  return seams;
}

test("Spark Gate：自由输入提交仍拒绝授权，但 custom_note 可见", async () => {
  const seams = gateSeam({
    answers: [{ id: "ldvh-spark-consent", selected: [], custom: FREE_TEXT }],
  });
  const out = await seams.requestSparkConsent({
    action: "create", objectTitle: "示例对象", summary: "查重结论：无重复", agent: { id: "a" },
  });
  assert.equal(out.granted, false, "Gate 不得把自由文本当授权");
  assert.equal(out.custom_note, FREE_TEXT);
  assert.match(out.reason, /自由文本/);
});

test("ADR Gate：自由输入提交仍拒绝授权，但 custom_note 可见", async () => {
  const seams = gateSeam({
    answers: [{ id: "ldvh-adr-consent", selected: [], custom: FREE_TEXT }],
  });
  const out = await seams.requestAdrConsent({
    action: "create", objectTitle: "示例决策", summary: "查重结论：无重复", agent: { id: "a" },
  });
  assert.equal(out.granted, false);
  assert.equal(out.custom_note, FREE_TEXT);
});

test("管辖登记 Gate：自由输入提交仍拒绝授权，但 custom_note 可见", async () => {
  const seams = gateSeam({
    answers: [{ id: "ldvh-registration-consent", selected: [], custom: FREE_TEXT }],
  });
  const out = await seams.requestRegistrationConsent({ agent: { id: "a" }, projectId: "p", path: "/p" });
  assert.equal(out.granted, false);
  assert.equal(out.custom_note, FREE_TEXT);
});

test("Gate 选了确认标签且附带自由文本：授权成立，文字也回传", async () => {
  const seams = gateSeam({
    answers: [{ id: "ldvh-spark-consent", selected: ["确认"], custom: FREE_TEXT }],
  });
  const out = await seams.requestSparkConsent({
    action: "create", objectTitle: "示例对象", summary: "查重结论：无重复", agent: { id: "a" },
  });
  assert.equal(out.granted, true);
  assert.equal(out.custom_note, FREE_TEXT);
});
