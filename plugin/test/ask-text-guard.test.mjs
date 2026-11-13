/**
 * 提请文本机械校验（Human 2026-11-14 决定）。
 *
 * 只校验「提请发出去的那段字」：只有一行动作标题（≤200 UTF-16 码元）、
 * 无 detail、无其它呈报细节；不合格 fail-closed 拒绝、不截断、不改写。
 * 与「何时提请」完全正交——本文件不读开关、不读留痕、不解析答复。
 *
 * 两个提交通道都必须覆盖：tools.guard（管辖会话所有 ask_user_question 工具调用）
 * 与 seams.ask（所有 ctx.userQuestions.ask 服务提请）。只挂一个即
 * pitfall-a5c34ca3「约束绑单入口致漏检」的同构复发。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAskText,
  askTextDenial,
  ASK_TEXT_MAX_CHARS,
} from "../lib/ask-text-guard.js";
import { createHostSeams } from "../lib/host-seams.js";

function validQuestion(overrides = {}) {
  return {
    questions: [{
      id: "q1",
      question: "是否安排代理审查？",
      header: "审查",
      options: [
        { label: "安排", description: "派独立子代理挑错" },
        { label: "跳过" },
      ],
      ...overrides,
    }],
  };
}

// ── 判据本身 ────────────────────────────────────────────────────────────────

test("纯校验器：恰好 200 字符通过（边界包含）", () => {
  const q = "字".repeat(ASK_TEXT_MAX_CHARS);
  assert.equal(validateAskText(validQuestion({ question: q })).ok, true);
});

test("纯校验器：201 字符被拒，且不截断不改写", () => {
  const q = "字".repeat(ASK_TEXT_MAX_CHARS + 1);
  const r = validateAskText(validQuestion({ question: q }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /201/);
  assert.match(r.reason, /不会截断|不截断|重发/);
});

test("纯校验器：UTF-16 码元计量，全 emoji 标题按 .length 超限必拒", () => {
  // 200 个 emoji 按码点看是 200，按 .length 是 400；用码点计会静默失效。
  const q = "\u{1F600}".repeat(200);
  assert.equal(q.length, 400);
  assert.equal(validateAskText(validQuestion({ question: q })).ok, false);
});

test("纯校验器：题内出现 detail 字段被拒（宿主会静默丢弃，审核必须拦）", () => {
  const req = validQuestion();
  req.questions[0].detail = "这是一大段呈报细节";
  const r = validateAskText(req);
  assert.equal(r.ok, false);
  assert.match(r.reason, /detail/);
});

test("纯校验器：题内任意未允许字段被拒（字段闭集，不是只查 detail）", () => {
  for (const key of ["report", "summary", "criteria", "background", "context"]) {
    const req = validQuestion();
    req.questions[0][key] = "x";
    assert.equal(validateAskText(req).ok, false, `字段 ${key} 须拒绝`);
  }
});

test("纯校验器：根层出现细节字段被拒", () => {
  const req = validQuestion();
  req.detail = "x";
  assert.equal(validateAskText(req).ok, false);
});

test("纯校验器：question 缺失/空/非字符串被拒", () => {
  for (const q of [undefined, "", "   ", 42, null]) {
    assert.equal(validateAskText(validQuestion({ question: q })).ok, false);
  }
});

test("纯校验器：questions 缺失/空数组/非数组被拒", () => {
  for (const questions of [undefined, [], "x", null]) {
    assert.equal(validateAskText({ questions }).ok, false);
  }
});

test("纯校验器：options 形状错误/选项夹带未允许字段被拒", () => {
  assert.equal(validateAskText(validQuestion({ options: "x" })).ok, false);
  const req = validQuestion();
  req.questions[0].options[0].intent = "x";
  assert.equal(validateAskText(req).ok, false);
});

test("纯校验器：多题中任一题不合格即整份拒绝", () => {
  const req = validQuestion();
  req.questions.push({ id: "q2", question: "第二题" });
  req.questions.push({ id: "q3", question: "第三题", detail: "细节" });
  assert.equal(validateAskText(req).ok, false);
});

test("askTextDenial：合格返回 undefined（放行），不合格返回拒绝原因字符串", () => {
  assert.equal(askTextDenial(validQuestion()), undefined);
  const denial = askTextDenial(validQuestion({ detail: "x" }));
  assert.equal(typeof denial, "string");
  assert.match(denial, /fail-closed/);
});

// ── 挂载点 ①：tools.guard（管辖会话里所有 ask_user_question 工具调用）──────

function guardOf(seams, ctx = {}) {
  let guardFn = null;
  seams.install({
    get: (k) => (k === "tools" ? { guard: (fn) => { guardFn = fn; return () => {}; } } : undefined),
    ...ctx,
  }, { dshHomePath: () => "/tmp/none" });
  return guardFn;
}

function execAt(cwd, args) {
  return { name: "ask_user_question", arguments: args, agent: { session: { header: { cwd } } } };
}

test("tools.guard：管辖会话里畸形提请被拒（返回字符串）", () => {
  const guard = guardOf(createHostSeams());
  const denial = guard(execAt("/p", validQuestion({ detail: "x" })));
  assert.equal(typeof denial, "string");
  assert.match(denial, /fail-closed/);
});

test("tools.guard：管辖会话里超长标题被拒", () => {
  const guard = guardOf(createHostSeams());
  assert.match(guard(execAt("/p", validQuestion({ question: "字".repeat(201) }))), /200/);
});

test("tools.guard：格式良好的短提问放行（不误伤）", () => {
  const guard = guardOf(createHostSeams());
  assert.equal(guard(execAt("/p", validQuestion())), undefined);
});

test("tools.guard：判定未就绪（cwd 无 judgement）仍过校验，不是 fail-open", () => {
  // 首回合 resolve 尚未写入 LATEST_JUDGEMENT 的同款时序缺口。
  const guard = guardOf(createHostSeams());
  const denial = guard(execAt("/never-recorded", validQuestion({ detail: "x" })));
  assert.equal(typeof denial, "string", "未就绪不得放行畸形提请");
});

test("tools.guard：明确不受辖会话放行（不约束非管辖会话）", () => {
  const seams = createHostSeams();
  const guard = guardOf(seams);
  // 直接复用 host-seams 的 judgement 记录器（生产里由 lifecycle 调用）。
  return import("../lib/host-seams.js").then(({ recordJudgementForGuard }) => {
    recordJudgementForGuard("/not-gov", "not_governed");
    assert.equal(guard(execAt("/not-gov", validQuestion({ detail: "x" }))), undefined);
  });
});

test("tools.guard：非 ask_user_question 工具不受本校验影响", () => {
  const guard = guardOf(createHostSeams());
  assert.equal(guard({ name: "bash", arguments: {}, agent: { session: { header: { cwd: "/p" } } } }), undefined);
});

// ── 挂载点 ②：seams.ask（所有 ctx.userQuestions.ask 服务提请）─────────────

function serviceSeam(askImpl) {
  const seams = createHostSeams();
  seams.install({
    get: (k) => (k === "userQuestions" ? { ask: askImpl } : undefined),
  }, { dshHomePath: () => "/tmp/none" });
  return seams;
}

test("seams.ask：畸形服务提请被拒绝，宿主 ask 根本没被调用", () => {
  let called = 0;
  const seams = serviceSeam(async () => { called += 1; return { answers: [] }; });
  // 同步抛错＝fail-closed 的本意：宿主服务连一次都没被调用。所有消费者都在
  // try/catch 里 `await ask(...)`，同步 throw 会被同一 catch 接住。
  assert.throws(
    () => seams.ask(validQuestion({ detail: "x" })),
    /ask-text guard \(service seam\) refused/,
  );
  assert.equal(called, 0, "fail-closed：不得先把畸形提请发给宿主");
});

test("seams.ask：超长标题被拒绝且宿主未被调用", () => {
  let called = 0;
  const seams = serviceSeam(async () => { called += 1; return { answers: [] }; });
  assert.throws(
    () => seams.ask(validQuestion({ question: "字".repeat(201) })),
    /200/,
  );
  assert.equal(called, 0);
});

test("seams.ask：格式良好的提请放行并送达宿主", async () => {
  let seen = null;
  const seams = serviceSeam(async (r) => { seen = r; return { answers: [] }; });
  await seams.ask(validQuestion());
  assert.ok(seen !== null);
  assert.equal(seen.questions[0].question, "是否安排代理审查？");
});

test("seams.ask：带 agent 的调用（三处 Human Gate 走此路径）同样被拦", () => {
  let called = 0;
  const seams = serviceSeam(async () => { called += 1; return { answers: [] }; });
  assert.throws(
    () => seams.ask(validQuestion({ detail: "x" }), { id: "live-agent" }),
    /refused/,
  );
  assert.equal(called, 0);
});

// ── 两个通道用同一判据（防漂移）────────────────────────────────────────────

test("两个挂载点对同一份畸形提请给出同因拒绝", async () => {
  const bad = validQuestion({ detail: "x" });
  const guard = guardOf(createHostSeams());
  const guardDenial = guard(execAt("/p", bad));
  let called = 0;
  const seams = serviceSeam(async () => { called += 1; return { answers: [] }; });
  let serviceError = "";
  try { seams.ask(bad); } catch (e) { serviceError = String(e.message); }
  assert.match(guardDenial, /detail/);
  assert.match(serviceError, /detail/);
  assert.equal(called, 0);
});
