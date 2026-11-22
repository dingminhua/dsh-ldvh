import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAskText,
  askTextDenial,
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


test("纯校验器：5000 字符的长 question 通过形状校验（长度不再受限）", () => {
  const q = "字".repeat(5000);
  const r = validateAskText(validQuestion({ question: q }));
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("纯校验器：长 question ＋ detail 仍被字段闭集拒绝（去长度不去形状）", () => {
  const req = validQuestion({ question: "字".repeat(5000) });
  req.questions[0].detail = "这是一大段呈报细节";
  const r = validateAskText(req);
  assert.equal(r.ok, false);
  assert.match(r.reason, /detail/);
  assert.match(r.reason, /未允许的字段/);
});

test("纯校验器：超长全 emoji 标题通过（不再按 UTF-16 码元计量判拒）", () => {
  const q = "\u{1F600}".repeat(2000);
  assert.equal(q.length, 4000);
  assert.equal(validateAskText(validQuestion({ question: q })).ok, true);
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

test("tools.guard：管辖会话里超长标题放行（长度不再受限）", () => {
  const guard = guardOf(createHostSeams());
  assert.equal(guard(execAt("/p", validQuestion({ question: "字".repeat(5000) }))), undefined);
});

test("tools.guard：管辖会话里长标题带 detail 仍被拒（形状约束未被长度放开波及）", () => {
  const guard = guardOf(createHostSeams());
  const denial = guard(execAt("/p", validQuestion({ question: "字".repeat(5000), detail: "x" })));
  assert.equal(typeof denial, "string");
  assert.match(denial, /detail/);
});

test("tools.guard：格式良好的短提问放行（不误伤）", () => {
  const guard = guardOf(createHostSeams());
  assert.equal(guard(execAt("/p", validQuestion())), undefined);
});

test("tools.guard：判定未就绪（cwd 无 judgement）仍过校验，不是 fail-open", () => {
  const guard = guardOf(createHostSeams());
  const denial = guard(execAt("/never-recorded", validQuestion({ detail: "x" })));
  assert.equal(typeof denial, "string", "未就绪不得放行畸形提请");
});

test("tools.guard：明确不受辖会话放行（不约束非管辖会话）", () => {
  const seams = createHostSeams();
  const guard = guardOf(seams);
  return import("../lib/host-seams.js").then(({ recordJudgementForGuard }) => {
    recordJudgementForGuard("/not-gov", "not_governed");
    assert.equal(guard(execAt("/not-gov", validQuestion({ detail: "x" }))), undefined);
  });
});

test("tools.guard：非 ask_user_question 工具不受本校验影响", () => {
  const guard = guardOf(createHostSeams());
  assert.equal(guard({ name: "bash", arguments: {}, agent: { session: { header: { cwd: "/p" } } } }), undefined);
});


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
  assert.throws(
    () => seams.ask(validQuestion({ detail: "x" })),
    /ask-text guard \(service seam\) refused/,
  );
  assert.equal(called, 0, "fail-closed：不得先把畸形提请发给宿主");
});

test("seams.ask：超长标题原样送达宿主（不拒绝、不截断、不改写）", async () => {
  const q = "字".repeat(5000);
  let seen = null;
  const seams = serviceSeam(async (r) => { seen = r; return { answers: [] }; });
  await seams.ask(validQuestion({ question: q }));
  assert.ok(seen !== null, "长标题不得被接缝拦下");
  assert.equal(seen.questions[0].question, q, "不得截断或改写");
});

test("seams.ask：超长标题＋detail 仍被拒且宿主未被调用（形状约束保留）", () => {
  let called = 0;
  const seams = serviceSeam(async () => { called += 1; return { answers: [] }; });
  assert.throws(
    () => seams.ask(validQuestion({ question: "字".repeat(5000), detail: "x" })),
    /detail/,
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
