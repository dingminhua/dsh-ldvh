// Tests for plugin/lib/triggers.js — 11 §6.1 触发段（会话活动 → 安静期 → 一次触发）.
//
// Authority: specs/11 §6.1：「会话确已空闲」= **距最后一次会话活动已持续不短于
// 一个「安静时长」**；安静期**自活动发生时重新开始**，触发后**不再自动重新武装**
// （须有新活动）——故一次安静期至多触发一次。
//
// ## 计时载体（2026-10-24 回退）
//
// 2026-10-22–2026-10-24 期间，计时交给宿主定时任务承载（排期 + `[SCHEDULE
// REMINDER]` 投递回会话）。该形态在真实宿主上连续多次投递均未走到派发，Human
// 决定停用，改回**每个会话各自的进程内 `setTimeout`**。本文件因此改回**假定时器
// 驱动**（替换 `globalThis.setTimeout`），测的仍是判据本身：排期算得对不对、
// 到期再确认做没做、重置/撤销有没有发生。
//
// 与 2026-10-23 纪律的衔接：`turn/start` 清掉计时器、`turn/end` 重新武装——
// 进程内计时器使这条纪律**真正成立**（`clearTimeout` 同步生效、状态可本地回读）。
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
 * （取消、重置、到期）正是本模块的全部可错之处，**不得**用「直接调用 dispatch」绕过。
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
    return id;   // 裸数字 id：实现里的 `state.silenceTimer` 即它
  };
  globalThis.clearTimeout = (id) => { pending.delete(id); };
  const api = {
    pending,
    /** 当前待触发的计时器数量。 */
    size: () => pending.size,
    /**
     * 注入给 `createTurnTriggers` 的时钟——**与 fireAll 同步推进**。
     *
     * 为什么必须注入：到期回调会用「现在 − 活动时刻」再确认一次确已安静。
     * 若时钟仍停在活动那一刻，该判据会把一次合法触发误判为竞态。
     */
    now: () => clock,
    /** 推进虚拟时钟但不触发回调（用于「时间过去了但计时器未到期」的断言）。 */
    advance(ms) { clock += ms; },
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

function makeTriggers({ governed = true, onSessionCheckpoint, silenceMs = 300_000, seedActivityAt, now, registerDiagnostic } = {}) {
  const dispatches = [];
  const activity = { entries: [], record(kind, payload) { this.entries.push({ kind, payload }); } };
  const persisted = [];
  const diagnostics = [];
  const agent = agentStub();
  const triggers = createTurnTriggers(agent, {
    getScopeState: () => (governed ? "governed" : "not_governed"),
    turns: undefined, // 用模块内的局部 marker
    activity,
    log: { info() {}, warn() {} },
    readSilenceMs: () => silenceMs,
    now: now ?? globalThis.__ldvhTestClock,
    persistActivityAt: (ms) => { persisted.push(ms); return Promise.resolve(); },
    registerDiagnostic: registerDiagnostic ?? ((entry) => { diagnostics.push(entry); return Promise.resolve(); }),
    onSessionCheckpoint: onSessionCheckpoint ?? ((info) => { dispatches.push(info); return Promise.resolve(); })
  });
  if (seedActivityAt !== undefined) triggers.restoreActivityAt(seedActivityAt);
  return { triggers, dispatches, activity, persisted, diagnostics, agent, session: agent.session };
}

/** 让在途的 Promise（诊断旁路等）落定。 */
async function settle() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// 核心语义：活动 → 安静满 → 触发一次
// ---------------------------------------------------------------------------

test("11 §6.1：仅有活动而无安静期满 → 不派发（对话仍在继续）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 7 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(dispatches.length, 0, "武装了计时器但未到期，不得派发");
    assert.equal(timers.size(), 1, "此时应恰好有一个待触发的计时器");
  } finally { timers.restore(); }
});

test("11 §6.1：活动 → 安静期满 → 派发一次，且 source 标明是安静期到期", () => {
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

test("11 §6.1：只有 idle 而**从未有过活动** → 不武装、不派发", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(dispatches.length, 0);
    assert.equal(timers.size(), 0, "无从计时（lastActivityAt 为空）时不得武装");
  } finally { timers.restore(); }
});

test("11 §6.1：**新活动重置**安静期——对话不停止永不触发", () => {
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

test("11 §6.1：**一次安静期至多触发一次**——计时器不重复派发", () => {
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

test("11 §12：派发失败后**不自动重新武装**——须有新活动才再计时（不得自行重试）", () => {
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
    assert.equal(timers.size(), 0, "失败后不得自动重新武装（11 §12 不得自行重试）");
    // 有新活动才重新计时
    triggers.onTurnStopping({ agent: agentStub(), turn: 5 });
    assert.equal(timers.size(), 0, "活动本身只重置，须等 idle 才武装");
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1, "新活动之后可重新计时");
  } finally { timers.restore(); }
});

test("11 §6.1：到期时**再次确认**确已安静——期间有过新活动则作废", () => {
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
// 回合边界（2026-10-23 纪律，2026-10-24 随载体保留）
// ---------------------------------------------------------------------------

test("11 §6.1：`turn/start` 清掉计时器——对话进行中不存在倒计时", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches, session, agent } = makeTriggers();
    triggers.onTurnStopping({ agent, turn: 1 });
    triggers.onAgentStatus({ agent, status: "idle" });
    assert.equal(timers.size(), 1, "先武装");
    triggers.onSessionEvent(session, { type: "turn/start", data: { turn: 2 } });
    assert.equal(timers.size(), 0, "回合开始须同步清掉计时器");
    assert.equal(triggers.snapshot().silenceTimer, null, "句柄须可本地回读为已清");
    assert.equal(dispatches.length, 0);
  } finally { timers.restore(); }
});

test("11 §6.1：`turn/end` 按「结束时刻 + 安静时长」重新武装，且到期派发一次", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches, session } = makeTriggers();
    triggers.onSessionEvent(session, { type: "turn/start", data: { turn: 1 } });
    triggers.onSessionEvent(session, { type: "turn/end", data: { turn: 1 } });
    const armed = [...timers.pending.values()][0];
    assert.equal(armed.ms, 300_000, "剩余量 = 安静时长（回合结束即活动时刻）");
    timers.fireAll();
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].source, "silence:timer");
  } finally { timers.restore(); }
});

test("11 §6.3：回合进行中到期 → 拒绝派发（事件落盘晚于事实的末道防线）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches, activity, session, agent } = makeTriggers();
    triggers.onTurnStopping({ agent, turn: 1 });
    triggers.onAgentStatus({ agent, status: "idle" });
    // 捕获回调后模拟：回合已开始（但 turn/start 已到达，计时器已被清掉）；
    // 此处直接调用已捕获的回调，模拟「事件到达顺序与计时器到期交错」。
    const armed = [...timers.pending.values()][0];
    triggers.onSessionEvent(session, { type: "turn/start", data: { turn: 2 } });
    armed.fn();
    assert.equal(dispatches.length, 0, "回合进行中不得派发");
    assert.ok(
      activity.entries.some((e) => e.kind === "session/checkpoint/refused-turn-in-flight"),
      "拒绝须留痕"
    );
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 多会话隔离
// ---------------------------------------------------------------------------

test("11 §6.1：其它 agent 的活动与 idle 事件被忽略（不武装、不派发）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: { id: "other" }, turn: 9 });
    triggers.onAgentStatus({ agent: { id: "other" }, status: "idle" });
    assert.equal(timers.size(), 0, "其它会话不得武装本会话的计时器");
    assert.equal(dispatches.length, 0);
  } finally { timers.restore(); }
});

test("11 §6.1：`running` 迁移不武装（只有 idle 才武装计时）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "running" });
    assert.equal(timers.size(), 0, "running 不武装");
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1, "idle 才武装");
    assert.equal(dispatches.length, 0);
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 管辖闸
// ---------------------------------------------------------------------------

test("11 §6.1：未受管辖时既不计时也不派发", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers({ governed: false });
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 0);
    timers.fireAll();
    assert.equal(dispatches.length, 0);
  } finally { timers.restore(); }
});

test("11 §6.1：受管辖判定在**到期时刻**复核——期间转为未受管辖则不派发", () => {
  const timers = makeFakeTimers();
  try {
    let state = "governed";
    const dispatches = [];
    const triggers = createTurnTriggers(agentStub(), {
      getScopeState: () => state,
      turns: undefined,
      activity: { entries: [], record() {} },
      log: { info() {}, warn() {} },
      readSilenceMs: () => 300_000,
      now: globalThis.__ldvhTestClock,
      persistActivityAt: () => Promise.resolve(),
      onSessionCheckpoint: (info) => { dispatches.push(info); return Promise.resolve(); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    state = "not_governed";   // 期间失去管辖
    timers.fireAll();
    assert.equal(dispatches.length, 0, "到期时已不受管辖 → 不派发");
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

test("11 §6.1：`dispose()` 清计时器——会话结束/插件卸载不得留下待触发的计时器", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1);
    triggers.dispose();
    assert.equal(timers.size(), 0, "dispose 须清掉计时器");
  } finally { timers.restore(); }
});

test("11 §6.1：定时器带 unref（不拖住进程退出）", () => {
  const timers = makeFakeTimers();
  try {
    const realSetTimeout = globalThis.setTimeout;
    let unrefCalled = 0;
    globalThis.setTimeout = () => {
      return { ref() {}, unref() { unrefCalled += 1; return this; } };
    };
    const { triggers } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(unrefCalled, 1, "武装后须对句柄调用 unref");
    globalThis.setTimeout = realSetTimeout;
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 持久化与恢复
// ---------------------------------------------------------------------------

test("11 §6.1：活动时刻经 `persistActivityAt` 落盘（热重载后计时不失真）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, persisted } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    assert.equal(persisted.length, 1, "活动须落一次持久化锚点");
    assert.equal(persisted[0], timers.now());
  } finally { timers.restore(); }
});

test("11 §6.1：`restoreActivityAt` 恢复后可直接计时（无须等新活动）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers({ seedActivityAt: 1_000_000_000_000 });
    assert.equal(timers.size(), 1, "恢复锚点后须立即武装");
    timers.fireAll();
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].source, "silence:timer");
  } finally { timers.restore(); }
});

test("11 §6.1：`restoreActivityAt` 拒绝非法值（不得把未知读成「刚活动过」）", () => {
  const timers = makeFakeTimers();
  try {
    for (const bad of [NaN, undefined, null, 0, -5, "abc", {}]) {
      const { triggers } = makeTriggers();
      triggers.restoreActivityAt(bad);
      assert.equal(timers.size(), 0, `非法值 ${String(bad)} 不得武装`);
      triggers.dispose();
    }
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 派发失败收口
// ---------------------------------------------------------------------------

test("11 §6.1/§12：调度回调抛出的拒绝被收口，不逃逸也不重复调度", async () => {
  const timers = makeFakeTimers();
  try {
    let calls = 0;
    const { triggers } = makeTriggers({
      onSessionCheckpoint: () => { calls += 1; return Promise.reject(new Error("boom")); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();
    await settle();
    assert.equal(calls, 1, "只调度一次");
  } finally { timers.restore(); }
});

test("11 §6.1：同步抛出的调度回调同样被收口", async () => {
  const timers = makeFakeTimers();
  try {
    let calls = 0;
    const { triggers } = makeTriggers({
      onSessionCheckpoint: () => { calls += 1; throw new Error("sync boom"); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();
    await settle();
    assert.equal(calls, 1);
  } finally { timers.restore(); }
});

test("11 §6.1：安静时长读取非法时回落 5 分钟（读取侧容错，写入侧另拦）", () => {
  const timers = makeFakeTimers();
  try {
    for (const bad of [undefined, 0, -1, NaN, "x"]) {
      const { triggers } = makeTriggers({ silenceMs: bad });
      triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
      triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
      const armed = [...timers.pending.values()][0];
      assert.equal(armed.ms, 300_000, `非法安静时长 ${String(bad)} 须回落 5 分钟`);
      timers.pending.clear();
      triggers.dispose();
    }
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 诊断痕迹（2026-10-23 加入，2026-10-24 随回退保留在计时器路径上）
// ---------------------------------------------------------------------------

test("可观测性：到期派发须落 silence-expiry/dispatching 与 dispatch-called 两条诊断痕迹", async () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, diagnostics } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 3 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();
    await settle();
    const stages = diagnostics.map((d) => `${d.stage}:${d.reason}`);
    assert.ok(stages.includes("silence-expiry:dispatching"), `实际痕迹：${stages.join(",")}`);
    assert.ok(stages.includes("dispatch-called:silence:timer"), `实际痕迹：${stages.join(",")}`);
  } finally { timers.restore(); }
});

test("可观测性：到期早退分支逐一落痕迹（便于事后归因），且早退后重武装", async () => {
  const timers = makeFakeTimers();
  try {
    // 「不安静」早退：时钟未推进即触发回调（quietFor < idleMs）
    const { triggers, diagnostics } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    const armed = [...timers.pending.values()][0];
    timers.pending.clear();   // 把已捕获的回调从待触发集合里摘掉，模拟「它已到期」
    armed.fn();
    await settle();
    assert.ok(
      diagnostics.some((d) => d.reason === "not-quiet-enough"),
      "安静不足的早退须留痕"
    );
    // 且早退后须重新武装（不得把计时器消费成永久空转）
    assert.equal(timers.size(), 1, "早退后须重武装");
  } finally { timers.restore(); }
});

test("可观测性：派发被拒时落 dispatch-rejected 痕迹", async () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, diagnostics } = makeTriggers({
      onSessionCheckpoint: () => Promise.reject(new Error("landing failed"))
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 2 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();
    await settle();
    assert.ok(
      diagnostics.some((d) => d.stage === "dispatch-rejected"),
      "派发被拒须留痕"
    );
  } finally { timers.restore(); }
});

test("可观测性：诊断旁路自身抛错不得影响派发判定", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers({
      registerDiagnostic: () => { throw new Error("diagnostic down"); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.doesNotThrow(() => timers.fireAll());
    assert.equal(dispatches.length, 1, "诊断挂掉不影响派发");
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 恢复计时（热重载）
// ---------------------------------------------------------------------------

test("恢复计时：久远锚点按**剩余量**武装（延迟接近 0，不白等一个完整安静时长）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggers({ seedActivityAt: 1_000_000_000_000 - 290_000 });
    const armed = [...timers.pending.values()][0];
    assert.ok(armed.ms <= 10_000, `剩余量应接近 10s，实际 ${armed.ms}ms`);
    triggers.dispose();
  } finally { timers.restore(); }
});

test("恢复计时：已武装时恢复**更新**的锚点 → 计时器与锚点同源，到期仍会派发", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.advance(1000);
    triggers.restoreActivityAt(timers.now());
    assert.equal(timers.size(), 1, "仍只有一个计时器（先清后武装）");
    timers.fireAll();
    assert.equal(dispatches.length, 1, "到期仍会派发（不得空转）");
  } finally { timers.restore(); }
});

test("恢复计时：陈旧锚点不得覆盖更新的锚点（异步旁路的陈旧快照）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    const anchor = triggers.snapshot().lastActivityAt;
    triggers.restoreActivityAt(anchor - 60_000);
    assert.equal(triggers.snapshot().lastActivityAt, anchor, "陈旧锚点不得覆盖");
  } finally { timers.restore(); }
});

test("恢复计时：超出 Date 可表示范围的值不得抛错，也不得留下半提交状态", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    const before = triggers.snapshot();
    assert.doesNotThrow(() => triggers.restoreActivityAt(9_000_000_000_000_000));
    assert.equal(triggers.snapshot().lastActivityAt, before.lastActivityAt, "不得半提交");
  } finally { timers.restore(); }
});

test("恢复计时：`dispose()` 之后不得再武装、不得对已销毁对象派发", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    triggers.dispose();
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    triggers.onTurnStopping({ agent: agentStub(), turn: 2 });
    triggers.restoreActivityAt(1_000_000_000_000 + 1000);
    assert.equal(timers.size(), 0, "销毁是终局");
    timers.fireAll();
    assert.equal(dispatches.length, 0);
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 轮次恢复
// ---------------------------------------------------------------------------

test("轮次恢复：重启后尚无回合时，回填的轮次随派发上抛（此前必为 undefined）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers({ seedActivityAt: 1_000_000_000_000 });
    assert.equal(triggers.snapshot().lastTurn, undefined);
    assert.equal(triggers.restoreLastTurn(42), true);
    timers.fireAll();
    assert.equal(dispatches[0].turn, 42, "回填的轮次须随派发上抛");
  } finally { timers.restore(); }
});

test("轮次恢复：已有轮次时不得覆盖（本函数不是第二条写 lastTurn 的通道）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 7 });
    assert.equal(triggers.restoreLastTurn(3), false);
    assert.equal(triggers.snapshot().lastTurn, 7);
  } finally { timers.restore(); }
});

test("轮次恢复：非法值一律拒不采纳且不半提交", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggers();
    for (const bad of [-1, 1.5, NaN, "3", null, undefined]) {
      assert.equal(triggers.restoreLastTurn(bad), false, `非法值 ${String(bad)} 须拒绝`);
    }
    assert.equal(triggers.snapshot().lastTurn, undefined, "不得半提交");
  } finally { timers.restore(); }
});

test("轮次恢复：已销毁后拒不采纳（disposed 守卫须独立成立）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggers();
    triggers.dispose();
    assert.equal(triggers.restoreLastTurn(5), false);
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 日志抛错不得污染控制流
// ---------------------------------------------------------------------------

test("可观测性：日志调用抛错不得影响控制流，且不得逃逸出回调", () => {
  const timers = makeFakeTimers();
  try {
    let persistedOnce = false;
    const triggers = createTurnTriggers(agentStub(), {
      getScopeState: () => "governed",
      turns: undefined,
      activity: { entries: [], record() {} },
      log: { info() { throw new Error("log down"); }, warn() { throw new Error("log down"); } },
      readSilenceMs: () => 300_000,
      now: globalThis.__ldvhTestClock,
      persistActivityAt: () => { persistedOnce = true; return Promise.resolve(); },
      onSessionCheckpoint: () => Promise.resolve()
    });
    assert.doesNotThrow(() => triggers.onTurnStopping({ agent: agentStub(), turn: 1 }));
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.doesNotThrow(() => timers.fireAll());
    assert.equal(persistedOnce, true, "日志抛错不影响活动落盘");
  } finally { timers.restore(); }
});
