// 21 §6.3 路由询问的「先读后问」回归（plugin/lib/workcase-route-ledger.js +
// host-seams.js 的 requestWorkcaseRouting）。
//
// 为什么需要这个文件：答复原先只在内存里被 create 消费一次，不留载体。由此有两个
// 实测失效（2026-10-17 本仓实测）：
//   ① 预检通过、人已作答、写入随后失败 → 重试 create 无处可读答复 → **再问一遍**；
//   ② 宿主 §6.3 提问不写会话事件流 → 事后无法回读 → 主控误判「没问过」并补问。
// 本文件把「同一候选不再重问」与「空答复不算决定」两条钉成机械断言。
//
// 每条用例都断言的是**行为**（提问入口被调用几次），不是「有代码写了这段逻辑」。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHostSeams } from "../lib/host-seams.js";
import { findRouteDecision, recordRouteDecision } from "../lib/workcase-route-ledger.js";

const ROUTE_ID = "ldvh-workcase-route";
const WORKCASE_LABEL = "建工单走流程";
const DIRECT_LABEL = "直接执行";

/** Install seams against a temp DSH home; `ask` records every call it receives. */
async function installWith(ask) {
  const home = await mkdtemp(join(tmpdir(), "ldvh-route-"));
  const calls = [];
  const seams = createHostSeams();
  const ctx = {
    get: (key) => ({
      tools: { guard: () => () => {} },
      invariants: { register: () => () => {} },
      userQuestions: ask === null
        ? undefined
        : { ask: async (request, agent) => { calls.push({ request, agent }); return ask(request, agent); } },
      fs: { resolve: async (p) => ({ displayPath: p }), stat: async () => ({ version: "v", type: "file" }) },
    }[key]),
    on: () => () => {},
    emit: () => {},
    logger: { info() {} },
  };
  const install = seams.install(ctx, { dshHomePath: (...names) => join(home, ...names) });
  return {
    seams,
    calls,
    home,
    async cleanup() {
      install.dispose();
      await rm(home, { recursive: true, force: true });
    },
  };
}

const ANSWER_WORKCASE = async () => ({ answers: [{ id: ROUTE_ID, selected: [WORKCASE_LABEL] }] });

// ---------------------------------------------------------------------------
// 载体本身
// ---------------------------------------------------------------------------

test("route ledger: an unknown candidate resolves to null (never asked), not a fabricated answer", async () => {
  const home = await mkdtemp(join(tmpdir(), "ldvh-route-"));
  try {
    const resolved = await findRouteDecision((...n) => join(home, ...n), "f".repeat(64));
    assert.equal(resolved.ok, true);
    assert.equal(resolved.value, null, "无记录必须是 null —— 不得伪造一个答复");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("route ledger: an EMPTY answer is refused — 'not decided' is not a decision", async () => {
  const home = await mkdtemp(join(tmpdir(), "ldvh-route-"));
  try {
    const recorded = await recordRouteDecision((...n) => join(home, ...n), {
      candidate_fingerprint: "a".repeat(64),
      answer: "",
      routed_to: "workcase",
    });
    assert.equal(recorded.ok, false, "空答复不得入载体：否则下次 create 会复用一个不存在的决定");
    assert.match(recorded.error.code, /invalid_entry/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("route ledger: a malformed carrier fails closed instead of reading as 'never asked'", async () => {
  const home = await mkdtemp(join(tmpdir(), "ldvh-route-"));
  try {
    const path = join(home, "ldvh", "workcase-route-decisions.json");
    await rm(join(home, "ldvh"), { recursive: true, force: true });
    await (await import("node:fs/promises")).mkdir(join(home, "ldvh"), { recursive: true });
    await writeFile(path, "{ not json", "utf8");
    const resolved = await findRouteDecision((...n) => join(home, ...n), "b".repeat(64));
    assert.equal(resolved.ok, false, "载体损坏不得被当成「没问过」——那会导致重复提问");
    assert.match(resolved.error.code, /malformed/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 核心：同一候选不重问
// ---------------------------------------------------------------------------

test("routing: the SAME candidate is asked ONCE — a second create reuses the recorded answer", async () => {
  const { seams, calls, cleanup } = await installWith(ANSWER_WORKCASE);
  try {
    const key = "c".repeat(64);
    const first = await seams.requestWorkcaseRouting({ request: "把 X 改掉", candidateKey: key });
    assert.equal(first.granted, true);
    assert.equal(calls.length, 1, "第一次必须提问");

    // 同一候选（内容指纹相同）再来一次：模拟「写入失败后重试 create」。
    const second = await seams.requestWorkcaseRouting({ request: "把 X 改掉", candidateKey: key });
    assert.equal(second.granted, true, "复用既有答复，结论不变");
    assert.equal(second.reused, true, "必须标明这是复用而非重新提问");
    assert.equal(calls.length, 1, `同一候选不得被问第二次（实际提问 ${calls.length} 次）`);
  } finally {
    await cleanup();
  }
});

test("routing: a DIFFERENT candidate IS asked again — a changed plan is a new question", async () => {
  const { seams, calls, cleanup } = await installWith(ANSWER_WORKCASE);
  try {
    await seams.requestWorkcaseRouting({ request: "把 X 改掉", candidateKey: "d".repeat(64) });
    await seams.requestWorkcaseRouting({ request: "把 X 改掉", candidateKey: "e".repeat(64) });
    assert.equal(calls.length, 2, "内容变了就是新问题，必须重问——不得把旧答案套到新候选上");
  } finally {
    await cleanup();
  }
});

test("routing: 直接执行 is recorded too, so a retry does not re-ask a decision already made", async () => {
  const { seams, calls, cleanup } = await installWith(async () => ({ answers: [{ id: ROUTE_ID, selected: [DIRECT_LABEL] }] }));
  try {
    const key = "f".repeat(64);
    const first = await seams.requestWorkcaseRouting({ request: "看看现状", candidateKey: key });
    assert.equal(first.granted, false);
    assert.equal(first.routedTo, "direct");
    const second = await seams.requestWorkcaseRouting({ request: "看看现状", candidateKey: key });
    assert.equal(second.routedTo, "direct");
    assert.equal(second.reused, true);
    assert.equal(calls.length, 1, "「直接执行」的答复同样要复用，不能因为它是拒绝就不记");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 空答复
// ---------------------------------------------------------------------------

test("routing: an EMPTY answer (selected: []) is 'not decided' — refused and NOT recorded", async () => {
  const calls = [];
  const { seams, cleanup } = await installWith(async () => ({ answers: [{ id: ROUTE_ID, selected: [] }] }));
  try {
    const key = "1".repeat(64);
    const result = await seams.requestWorkcaseRouting({ request: "要不要建单", candidateKey: key });
    assert.equal(result.granted, false, "空答复不得放行 create（21 §6.3：静默不等于同意）");
    assert.equal(result.routedTo, null);
    assert.match(result.reason, /did not choose/);

    // 关键：空答复**不入载体**。若入了，下一次 create 会复用一个不存在的决定。
    const stored = await findRouteDecision(seams.dshHomePath, key);
    assert.equal(stored.ok, true);
    assert.equal(stored.value, null, "空答复不得入载体");
    void calls;
  } finally {
    await cleanup();
  }
});

test("routing: without a candidateKey the seam keeps the old behaviour (asks, records nothing)", async () => {
  const { seams, calls, cleanup } = await installWith(ANSWER_WORKCASE);
  try {
    await seams.requestWorkcaseRouting({ request: "要不要建单" });
    await seams.requestWorkcaseRouting({ request: "要不要建单" });
    assert.equal(calls.length, 2, "候选身份缺席时宁可问两次，也不算错复用");
  } finally {
    await cleanup();
  }
});

test("routing: an unreadable carrier fails closed rather than assuming 'never asked'", async () => {
  const { seams, calls, home, cleanup } = await installWith(ANSWER_WORKCASE);
  try {
    const dir = join(home, "ldvh");
    await (await import("node:fs/promises")).mkdir(dir, { recursive: true });
    await writeFile(join(dir, "workcase-route-decisions.json"), "][", "utf8");
    const result = await seams.requestWorkcaseRouting({ request: "要不要建单", candidateKey: "2".repeat(64) });
    assert.equal(result.granted, false, "载体不可读时不得放行，也不得当成没问过");
    assert.equal(calls.length, 0, "载体不可读时不得提问——否则会重复打扰且结果无从落痕");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 载体不进入事实源
// ---------------------------------------------------------------------------

test("route ledger: the carrier lives under DSH home, not in the fact source", async () => {
  const { seams, home, cleanup } = await installWith(ANSWER_WORKCASE);
  try {
    await seams.requestWorkcaseRouting({ request: "要不要建单", candidateKey: "3".repeat(64) });
    const raw = await readFile(join(home, "ldvh", "workcase-route-decisions.json"), "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(Array.isArray(parsed.decisions), true);
    assert.equal(parsed.decisions.length, 1);
    assert.equal(parsed.decisions[0].routed_to, "workcase");
    assert.equal(parsed.decisions[0].answer, WORKCASE_LABEL);
    assert.match(parsed.decisions[0].candidate_fingerprint, /^3{64}$/);
  } finally {
    await cleanup();
  }
});
