// Tests for plugin/lib/triggers.js — 36 §6.1 触发段（会话活动 → 安静期 → 一次触发）.
//
// Authority: specs/36 §6.1（2026-10-14 修订）：「会话确已空闲」的判据是**距最后一次
// 会话活动已持续不短于一个「安静时长」**；安静期**自活动发生时重新开始**，触发后
// **不再自动重新武装**（须有新活动）——故一次安静期至多触发一次。
//
// ## 迁移说明（2026-10-14，workcase-88f3e568）
//
// 本文件原以 `onAgentStatus({status:"idle"})` 驱动派发（15 处），对应旧语义「宿主
// 报 idle 即二次确认成立」。**该语义已被判为偏离**：宿主在回合刚结束时就报 idle，
// 故它等于「回合结束即派发」；且旧实现的待办位一经消费便不再置位，使**沉默越久
// 反而越不会触发**。现改为：活动刷新计时 → idle 只负责武装 → 计时到期才派发。
//
// 测试用**假定时器**驱动（`globalThis.setTimeout` 被替换），从而不真等 10 分钟。
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTurnTriggers } from "../lib/triggers.js";

/** 最小 agent 桩：id + session.header.cwd。 */
function agentStub(id = "agent-1") {
  return { id, session: { header: { id, cwd: "/tmp/project" } } };
}

/**
 * 假定时器：记录待触发的回调，由测试显式「推进时间」。
 *
 * 为什么必须用假定时器：真实安静时长是分钟级，测试不能真等；而定时器行为
 * （取消、重置、到期）正是本次改动的核心，**不得**用「直接调用 dispatch」绕过。
 */
function makeFakeTimers() {
  let seq = 0;
  let clock = 1_000_000_000_000; // 虚拟「现在」（毫秒）
  const pending = new Map();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => {
    const id = ++seq;
    pending.set(id, { fn, ms });
    return id;
  };
  globalThis.clearTimeout = (id) => { pending.delete(id); };
  const api = {
    pending,
    /** 当前待触发的计时器数量。 */
    size: () => pending.size,
    /**
     * 注入给 `createTurnTriggers` 的时钟——**与 fireAll 同步推进**。
     *
     * 为什么必须注入：`armSilenceTimer` 的到期回调会用「现在 − 活动时刻」再确认
     * 一次确已安静。若时钟仍停在活动那一刻，该判据会把一次合法触发误判为竞态。
     */
    now: () => clock,
    /** 触发全部到期的计时器，并把虚拟时钟推进到该计时器到期之时。 */
    fireAll() {
      const snapshot = [...pending.entries()];
      pending.clear();
      for (const [, entry] of snapshot) {
        clock += entry.ms;   // 时间流逝到该计时器到期
        entry.fn();
      }
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      globalThis.__ldvhTestClock = undefined;
    }
  };
  globalThis.__ldvhTestClock = api.now;
  return api;
}

function makeTriggers({ governed = true, onSessionCheckpoint, silenceMs = 600_000, seedActivityAt, now } = {}) {
  const dispatches = [];
  const activity = { entries: [], record(kind, payload) { this.entries.push({ kind, payload }); } };
  const persisted = [];
  const triggers = createTurnTriggers(agentStub(), {
    getScopeState: () => (governed ? "governed" : "not_governed"),
    turns: undefined, // 用模块内的局部 marker
    activity,
    log: { warn() {} },
    readSilenceMs: () => silenceMs,
    now: now ?? globalThis.__ldvhTestClock,
    persistActivityAt: (ms) => { persisted.push(ms); return Promise.resolve(); },
    onSessionCheckpoint: onSessionCheckpoint ?? ((info) => { dispatches.push(info); return Promise.resolve(); })
  });
  if (seedActivityAt !== undefined) triggers.restoreActivityAt(seedActivityAt);
  return { triggers, dispatches, activity, persisted };
}

// ---------------------------------------------------------------------------
// 核心语义：活动 → 安静满 → 触发一次
// ---------------------------------------------------------------------------

test("36 §6.1：仅有活动而无安静期满 → 不派发（对话仍在继续）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 7 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(dispatches.length, 0, "武装了计时器但未到期，不得派发");
    assert.equal(timers.size(), 1, "此时应恰好有一个待触发的计时器");
  } finally { timers.restore(); }
});

test("36 §6.1：活动 → 安静期满 → 派发一次，且 source 标明是安静期到期", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 7 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].turn, 7);
    assert.equal(dispatches[0].source, "silence:timer", "触发源须是安静期到期，不再是 idle 事件");
  } finally { timers.restore(); }
});

test("36 §6.1：只有 idle 而**从未有过活动** → 不武装、不派发", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(dispatches.length, 0);
    assert.equal(timers.size(), 0, "无从计时（lastActivityAt 为空）时不得武装");
  } finally { timers.restore(); }
});

test("36 §6.1：**新活动重置**安静期——对话不停止永不触发", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1, "第一次武装");
    // 对话继续：新回合到来
    triggers.onTurnStopping({ agent: agentStub(), turn: 2 });
    assert.equal(timers.size(), 0, "新活动须取消既有计时（重置）");
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1, "重新武装");
    assert.equal(dispatches.length, 0, "过程之中不得派发");
  } finally { timers.restore(); }
});

test("36 §6.1：**一次安静期至多触发一次**——计时器不重复派发", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 3 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();
    assert.equal(dispatches.length, 1);
    // 再报一次 idle（宿主可能重复发布）：不得第二次派发
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 0, "已触发过的安静期不得重新武装（silenceFired）");
    timers.fireAll();
    assert.equal(dispatches.length, 1, "仍只有一次");
  } finally { timers.restore(); }
});

test("36 §12：派发失败后**不自动重新武装**——须有新活动才再计时（不得自行重试）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers({
      onSessionCheckpoint: () => { dispatches.push(1); return Promise.reject(new Error("落地失败")); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 4 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();
    assert.equal(dispatches.length, 1);
    // 失败之后：无新活动，不得再武装、不得重试
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 0, "失败后不得自动重新武装（36 §12 不得自行重试）");
    // 有新活动才重新计时
    triggers.onTurnStopping({ agent: agentStub(), turn: 5 });
    assert.equal(timers.size(), 0, "活动本身只重置，须等 idle 才武装");
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1, "新活动之后可重新计时");
  } finally { timers.restore(); }
});

test("36 §6.1：到期时**再次确认**确已安静——期间有过新活动则作废", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    // 取得已武装的那个 callback，模拟「时间到了但期间又有活动」的竞态
    const armed = [...timers.pending.values()][0];
    triggers.onTurnStopping({ agent: agentStub(), turn: 2 }); // 期间发生新活动
    armed.fn(); // 直接调用已捕获的回调，模拟竞态
    assert.equal(dispatches.length, 0, "计时起点已变 → 本次作废，不得派发");
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 多会话隔离
// ---------------------------------------------------------------------------

test("36 §6.1：其它 agent 的活动与 idle 事件被忽略（不武装、不派发）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: { id: "other" }, turn: 9 });
    triggers.onAgentStatus({ agent: { id: "other" }, status: "idle" });
    assert.equal(timers.size(), 0, "其它会话不得武装本会话的计时器");
    assert.equal(dispatches.length, 0);
  } finally { timers.restore(); }
});

test("36 §6.1：`running` 迁移不武装（只有 idle 才武装计时）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 3 });
    triggers.onAgentStatus({ agent: agentStub(), status: "running" });
    assert.equal(timers.size(), 0, "`running` 不是武装时机");
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1);
    timers.fireAll();
    assert.equal(dispatches.length, 1);
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 管辖门（32 §137：git 层操作要求当前项目受管辖）
// ---------------------------------------------------------------------------

test("36 §6.1：未受管辖时既不计时也不派发", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers({ governed: false });
    triggers.onTurnStopping({ agent: agentStub(), turn: 5 });
    assert.equal(timers.size(), 0, "未受管辖不武装");
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 0);
    timers.fireAll();
    assert.equal(dispatches.length, 0);
  } finally { timers.restore(); }
});

test("36 §6.1：受管辖判定在**到期时刻**复核——期间转为未受管辖则不派发", () => {
  const timers = makeFakeTimers();
  try {
    let governed = true;
    const dispatches = [];
    const triggers = createTurnTriggers(agentStub(), {
      getScopeState: () => (governed ? "governed" : "not_governed"),
      turns: undefined,
      log: { warn() {} },
      readSilenceMs: () => 600_000,
      now: globalThis.__ldvhTestClock,
      onSessionCheckpoint: (info) => { dispatches.push(info); return Promise.resolve(); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 5 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    governed = false; // 武装之后、到期之前管辖状态变化
    timers.fireAll();
    assert.equal(dispatches.length, 0, "到期时必须复核管辖门");
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 定时器生命周期（36 §6.1：不得留下仍在计时的定时器）
// ---------------------------------------------------------------------------

test("36 §6.1：`dispose()` 清定时器——会话结束/插件卸载不得留下待触发的计时器", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1);
    triggers.dispose();
    assert.equal(timers.size(), 0, "dispose 须清掉计时器");
    assert.equal(dispatches.length, 0, "dispose 本身不派发");
  } finally { timers.restore(); }
});

test("36 §6.1：定时器带 unref（不拖住进程退出）", () => {
  const timers = makeFakeTimers();
  try {
    // 假 setTimeout 返回数字 id（无 unref）——真实环境返回 Timeout 对象。
    // 本测试确认「有 unref 就调用它」这条防御不抛错。
    const { triggers } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    assert.doesNotThrow(() => triggers.onAgentStatus({ agent: agentStub(), status: "idle" }));
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 活动时刻的持久化与恢复（36 §6.1：不得只存内存态）
// ---------------------------------------------------------------------------

test("36 §6.1：活动时刻经 `persistActivityAt` 落盘（热重载后计时不失真）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, persisted } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    assert.equal(persisted.length, 1, "活动发生即须持久化活动时刻");
    assert.ok(Number.isFinite(persisted[0]), "持久化的是毫秒时间戳");
  } finally { timers.restore(); }
});

test("36 §6.1：`restoreActivityAt` 恢复后可直接计时（无须等新活动）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers({ seedActivityAt: 1_000_000_000_000 - 1000 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1, "恢复的活动时刻使 idle 即可武装");
    timers.fireAll();
    assert.equal(dispatches.length, 1);
  } finally { timers.restore(); }
});

test("36 §6.1：`restoreActivityAt` 拒绝非法值（不得把未知读成「刚活动过」）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggers();
    triggers.restoreActivityAt(NaN);
    triggers.restoreActivityAt(0);
    triggers.restoreActivityAt(-1);
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 0, "非法恢复值须被忽略，保持「无从计时」");
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 调度失败不得逃逸到宿主事件分发（安全侧）
// ---------------------------------------------------------------------------

test("36 §6.1/§12：调度回调抛出的拒绝被收口，不逃逸也不重复调度", async () => {
  const timers = makeFakeTimers();
  try {
    const warns = [];
    const dispatches = [];
    const triggers = createTurnTriggers(agentStub(), {
      getScopeState: () => "governed",
      turns: undefined,
      log: { warn(...args) { warns.push(args.join(" ")); } },
      readSilenceMs: () => 600_000,
      now: globalThis.__ldvhTestClock,
      onSessionCheckpoint: () => { dispatches.push(1); return Promise.reject(new Error("编排失败")); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 4 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    // 同步返回：异常不会从计时器回调抛出
    assert.doesNotThrow(() => timers.fireAll());
    assert.equal(dispatches.length, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(warns.length, 1);
    assert.match(warns[0], /编排失败/);
  } finally { timers.restore(); }
});

test("36 §6.1：同步抛出的调度回调同样被收口", async () => {
  const timers = makeFakeTimers();
  try {
    const warns = [];
    const triggers = createTurnTriggers(agentStub(), {
      getScopeState: () => "governed",
      turns: undefined,
      log: { warn(...args) { warns.push(args.join(" ")); } },
      readSilenceMs: () => 600_000,
      now: globalThis.__ldvhTestClock,
      onSessionCheckpoint: () => { throw new Error("同步失败"); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 4 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.doesNotThrow(() => timers.fireAll());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(warns.length, 1);
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 安静时长的读取（含非法值回落）
// ---------------------------------------------------------------------------

test("36 §6.1：安静时长读取非法时回落 10 分钟（读取侧容错，写入侧另拦）", () => {
  const timers = makeFakeTimers();
  try {
    for (const bad of [0, -1, NaN, undefined, "abc"]) {
      const { triggers, dispatches } = makeTriggers({ silenceMs: bad });
      triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
      triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
      const armed = [...timers.pending.values()][0];
      assert.equal(armed.ms, 600_000, `安静时长 ${String(bad)} 须回落 600000`);
      timers.fireAll();
      assert.equal(dispatches.length, 1);
    }
  } finally { timers.restore(); }
});
