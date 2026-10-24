// Tests for 11 §6.1（2026-10-23 纪律，2026-10-24 回退后仍成立）：
// **回合开始暂停计时、回合结束重启计时**。
//
// 2026-10-23 把这条纪律写成「回合开始撤掉宿主定时任务、回合结束重新登记」。2026-10-24
// 计时载体改回进程内 `setTimeout` 后，纪律本身不变，但承载形状变了：**清掉计时器**
// 而不是删除宿主任务，且清理同步生效、状态可本地回读——因此「撤掉未生效」这一危险
// 残留窗口在进程内载体下不再存在（宿主形态下它曾需要单独的登记路径）。
//
// 本文件测三处可错点：
//   1. 回合开始有没有真的把计时器清掉（且 `silenceTimer` 立刻回读为 null）；
//   2. 回合进行中即使有旧的到期回调到达，也**不得派发**；
//   3. 回合结束有没有按「结束时刻 + 安静时长」重新武装（剩余量恰为安静时长）。
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTurnTriggers } from "../lib/triggers.js";

const SILENCE_MS = 300_000;

/**
 * 最小测试台：真实触发器 + 假定时器 + 注入的时钟。
 *
 * 假定时器提供「让已武装的回调到期」与「把它摘掉」两种手法，使到期与清理
 * 都能被显式驱动——本文件测的正是这两者的时序关系。
 */
function makeHarness() {
  const agent = { id: "agent-1", session: { header: { id: "agent-1", cwd: "/tmp/project" } } };
  let seq = 0;
  let clock = 1_000_000_000_000;
  const pending = new Map();   // id -> { fn, ms }
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => {
    const id = ++seq;
    pending.set(id, { fn, ms });
    return id;
  };
  globalThis.clearTimeout = (id) => { pending.delete(id); };

  const dispatches = [];
  const activity = { entries: [], record(kind, payload) { this.entries.push({ kind, payload }); } };
  const diagnostics = [];
  const triggers = createTurnTriggers(agent, {
    getScopeState: () => "governed",
    turns: undefined,
    activity,
    log: { info() {}, warn() {} },
    readSilenceMs: () => SILENCE_MS,
    now: () => clock,
    persistActivityAt: () => Promise.resolve(),
    registerDiagnostic: (entry) => { diagnostics.push(entry); return Promise.resolve(); },
    onSessionCheckpoint: (info) => { dispatches.push(info); return Promise.resolve(); },
  });

  return {
    agent, triggers, dispatches, activity, diagnostics, pending,
    size: () => pending.size,
    now: () => clock,
    advance(ms) { clock += ms; },
    /** 取得已武装回调的快照，并从待触发集合里摘掉（模拟它已到期）。 */
    takeArmed() {
      const entry = [...pending.entries()].pop();
      if (entry === undefined) return undefined;
      pending.delete(entry[0]);
      return entry[1];
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

/** 走一遍「有活动 → 安静期武装」，得到一条挂着的计时器。 */
function arm(h, turn = 7) {
  h.triggers.onTurnStopping({ agent: h.agent, turn });
  h.triggers.onAgentStatus({ agent: h.agent, status: "idle" });
}

// ---------------------------------------------------------------------------
// 1. 回合开始 = 清掉计时器
// ---------------------------------------------------------------------------

test("§6.1：回合开始后，计时器被清掉且句柄可本地回读为 null", () => {
  const h = makeHarness();
  try {
    arm(h);
    assert.equal(h.size(), 1, "前提：安静期已被武装");

    h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });

    assert.equal(h.size(), 0, "回合开始后不得再有计时器");
    assert.equal(h.triggers.snapshot().silenceTimer, null, "清理须可本地回读");
  } finally { h.restore(); }
});

test("§6.1：回合开始后，回合进行中不得武装（idle 事件不得把计时器加回来）", () => {
  const h = makeHarness();
  try {
    arm(h);
    h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });

    h.triggers.onAgentStatus({ agent: h.agent, status: "idle" });
    assert.equal(h.size(), 0, "回合进行中的 idle 不得重新武装");
  } finally { h.restore(); }
});

// ---------------------------------------------------------------------------
// 2. 回合进行中到达的到期回调：拒绝派发
// ---------------------------------------------------------------------------

test("§6.1/§6.3：回合进行中到达的到期回调——拒绝派发，且留痕", () => {
  const h = makeHarness();
  try {
    arm(h);
    const armed = h.takeArmed();          // 已到期的回调（在清理之前捕获）
    h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });

    armed.fn();

    assert.equal(h.dispatches.length, 0, "回合进行中到期也不得派发");
    assert.ok(
      h.activity.entries.some((e) => e.kind === "session/checkpoint/refused-turn-in-flight"),
      "拒绝派发须留痕",
    );
    assert.ok(
      h.diagnostics.some((d) => d.reason === "turn-in-flight"),
      "诊断痕迹须可回读为 turn-in-flight",
    );
  } finally { h.restore(); }
});

// ---------------------------------------------------------------------------
// 3. 回合结束 = 重启，且重新起算
// ---------------------------------------------------------------------------

test("§6.1：回合结束后重新武装，剩余量 = 安静时长（自回合结束起重新起算）", () => {
  const h = makeHarness();
  try {
    arm(h);
    h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });
    assert.equal(h.size(), 0);

    h.advance(90_000); // 回合进行了一段不短于零的时间
    h.triggers.onSessionEvent(h.agent.session, { type: "turn/end" });

    assert.equal(h.size(), 1, "回合结束须重新武装");
    const entry = [...h.pending.values()][0];
    assert.equal(entry.ms, SILENCE_MS, "计时须自回合结束起重新起算，不是接着旧的走");
  } finally { h.restore(); }
});

test("§6.1：回合结束后到期 → 派发一次", () => {
  const h = makeHarness();
  try {
    arm(h);
    h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });
    h.triggers.onSessionEvent(h.agent.session, { type: "turn/end" });

    const armed = h.takeArmed();
    h.advance(SILENCE_MS);
    armed.fn();

    assert.equal(h.dispatches.length, 1, "安静期满须派发一次");
    assert.equal(h.dispatches[0].source, "silence:timer");
  } finally { h.restore(); }
});

test("§6.1：回合进行中中断（从未收到 turn/end）→ 不得派发，也不得自行重建", () => {
  const h = makeHarness();
  try {
    arm(h);
    h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });
    h.advance(SILENCE_MS * 3);

    assert.equal(h.size(), 0, "没有 turn/end 就没有重启：不得自行重建计时");
    assert.equal(h.dispatches.length, 0);
  } finally { h.restore(); }
});
