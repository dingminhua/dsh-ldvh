// Tests for plugin/lib/triggers.js — 11 §6.1 触发段（会话活动 → 安静期 → 一次触发）.
//
// Authority: specs/11 §6.1（2026-10-14 修订）：「会话确已空闲」的判据是**距最后一次
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
// 测试用**假定时器**驱动（`globalThis.setTimeout` 被替换），从而不真等 5 分钟。
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

function makeTriggers({ governed = true, onSessionCheckpoint, silenceMs = 300_000, seedActivityAt, now } = {}) {
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

test("11 §6.1：未受管辖时既不计时也不派发", () => {
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

test("11 §6.1：受管辖判定在**到期时刻**复核——期间转为未受管辖则不派发", () => {
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
// 定时器生命周期（11 §6.1：不得留下仍在计时的定时器）
// ---------------------------------------------------------------------------

test("11 §6.1：`dispose()` 清定时器——会话结束/插件卸载不得留下待触发的计时器", () => {
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

test("11 §6.1：定时器带 unref（不拖住进程退出）", () => {
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
// 活动时刻的持久化与恢复（11 §6.1：不得只存内存态）
// ---------------------------------------------------------------------------

test("11 §6.1：活动时刻经 `persistActivityAt` 落盘（热重载后计时不失真）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, persisted } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    assert.equal(persisted.length, 1, "活动发生即须持久化活动时刻");
    assert.ok(Number.isFinite(persisted[0]), "持久化的是毫秒时间戳");
  } finally { timers.restore(); }
});

test("11 §6.1：`restoreActivityAt` 恢复后可直接计时（无须等新活动）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers({ seedActivityAt: 1_000_000_000_000 - 1000 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1, "恢复的活动时刻使 idle 即可武装");
    timers.fireAll();
    assert.equal(dispatches.length, 1);
  } finally { timers.restore(); }
});

test("11 §6.1：`restoreActivityAt` 拒绝非法值（不得把未知读成「刚活动过」）", () => {
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

test("11 §6.1/§12：调度回调抛出的拒绝被收口，不逃逸也不重复调度", async () => {
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

test("11 §6.1：同步抛出的调度回调同样被收口", async () => {
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

test("11 §6.1：安静时长读取非法时回落 5 分钟（读取侧容错，写入侧另拦）", () => {
  const timers = makeFakeTimers();
  try {
    for (const bad of [0, -1, NaN, undefined, "abc"]) {
      const { triggers, dispatches } = makeTriggers({ silenceMs: bad });
      triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
      triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
      const armed = [...timers.pending.values()][0];
      assert.equal(armed.ms, 300_000, `安静时长 ${String(bad)} 须回落 300000`);
      timers.fireAll();
      assert.equal(dispatches.length, 1);
    }
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 可观测性与恢复到计时（2026-10-19 独立审核后重写）
//
// 本组用例在首版基础上按两份独立审核报告重写。首版有两条是**虚假保障**：
//   · 「安静期已触发过」那条：两次到期都走正常派发路径，`silenceFired` 早退
//     一次都没进；且该早退本身是不可达死代码（已从实现中删除）。它守的是空气。
//   · 「恢复久远时刻不白等」那条：`fireAll()` 会把时钟推进满整个延迟，于是
//     「立即到期」与「等满 idleMs」两种实现都能通过——它证伪不了自己声称的回归。
// 重写版对每条都做了变异验证：删掉被守护的那行代码，本用例必须变红。
// ---------------------------------------------------------------------------

/** 带日志捕获的构造器（info/warn/debug 全捕获）。 */
function makeTriggersWithLogs(opts = {}) {
  const logs = [];
  const dispatches = [];
  const triggers = createTurnTriggers(agentStub(), {
    getScopeState: () => (opts.governed === false ? "not_governed" : "governed"),
    turns: undefined,
    log: {
      info(...a) { logs.push({ level: "info", text: a.join(" ") }); },
      warn(...a) { logs.push({ level: "warn", text: a.join(" ") }); },
      debug(...a) { logs.push({ level: "debug", text: a.join(" ") }); }
    },
    readSilenceMs: () => opts.silenceMs ?? 300_000,
    now: opts.now ?? globalThis.__ldvhTestClock,
    onSessionCheckpoint: (info) => { dispatches.push(info); return Promise.resolve(); }
  });
  return { triggers, dispatches, logs };
}

test("可观测性：到期时安静不足须留痕，且留痕级别须为 info（debug 在默认等级下不输出）", () => {
  // 制造 `quietFor < idleMs` 的干净办法：让到期时**时钟不推进**（时钟可独立拨动，
  // 不随 fireAll 推进）。生产中对应「系统时钟回拨」：`Date.now()` 非单调，而
  // `setTimeout` 走 libuv 单调时钟，两者脱钩时合法到期会被判成「不够安静」。
  const timers = makeFakeTimers();
  try {
    let fakeClock = 1_000_000_000_000;
    const { triggers, dispatches, logs } = makeTriggersWithLogs({ now: () => fakeClock });
    triggers.onTurnStopping({ agent: agentStub(), turn: 4 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1, "计时器已武装");
    timers.fireAll();               // 内部时钟推进，但 now() 读的是 fakeClock，仍为 0
    assert.equal(dispatches.length, 0, "安静不足不得派发");
    const quiet = logs.filter((l) => /NOT quiet enough/.test(l.text));
    assert.equal(quiet.length, 1, "静默丢弃不可接受：须恰好留一条痕迹");
    assert.equal(quiet[0].level, "info", "**级别必须是 info**：debug 的等级是 3，默认等级 1 下被丢弃（cordis:474/:460），用它留痕等于没留");
  } finally { timers.restore(); }
});

test("可观测性：到期时管辖状态已变须留痕（warn 级，该派发却未派发）", () => {
  const timers = makeFakeTimers();
  try {
    let governed = true;
    const logs = [];
    const dispatches = [];
    const triggers = createTurnTriggers(agentStub(), {
      getScopeState: () => (governed ? "governed" : "not_governed"),
      turns: undefined,
      log: {
        info(...a) { logs.push({ level: "info", text: a.join(" ") }); },
        warn(...a) { logs.push({ level: "warn", text: a.join(" ") }); },
        debug(...a) { logs.push({ level: "debug", text: a.join(" ") }); }
      },
      readSilenceMs: () => 300_000,
      now: globalThis.__ldvhTestClock,
      onSessionCheckpoint: (info) => { dispatches.push(info); return Promise.resolve(); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 4 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    governed = false;              // 到期前脱离管辖
    timers.fireAll();
    assert.equal(dispatches.length, 0);
    assert.equal(logs.length, 1, "恰好一条痕迹");
    assert.equal(logs[0].level, "warn", "「该派发却因管辖状态未派发」是异常路径，用 warn");
    assert.match(logs[0].text, /no longer governed/);
  } finally { timers.restore(); }
});

test("可观测性：到期时计时起点已变须留痕（补上首版零覆盖的那条早退）", () => {
  // 这条早退（`state.lastActivityAt !== startedAt`）在首版中零覆盖，且有一个旧
  // 用例冒充在测它——那个用例没推进时钟，实际先命中「安静不足」早退。
  //
  // 构造要点（两处都不显然）：
  // 1. 不能用 `restoreActivityAt` 前移锚点：锚点单调性会拒绝更旧的值。
  // 2. 只让锚点变化还不够——本早退排在「安静不足」之后，若时钟没走够，
  //    会先被 `quietFor < idleMs` 拦下。故必须让时钟先跳到足够远的位置，
  //    再由一次新活动把锚点写近，最后再推进一点使 quietFor 达标。
  //    只有这样才能同时满足「起点变了」与「确已安静」两个前提。
  const timers = makeFakeTimers();
  try {
    let fakeClock = 1_000_000_000_000;
    const { triggers, dispatches, logs } = makeTriggersWithLogs({ now: () => fakeClock });
    triggers.onTurnStopping({ agent: agentStub(), turn: 4 });   // startedAt = 1e12
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    const id = [...timers.pending.keys()][0];
    const staleCallback = timers.pending.get(id).fn;
    timers.pending.delete(id);              // 只从表里移除，回调仍在手里
    fakeClock += 900_000;                   // 时钟跳远
    triggers.onTurnStopping({ agent: agentStub(), turn: 5 });   // 锚点被新活动改写
    fakeClock += 400_000;                   // 再走一点，使 quietFor 达标
    staleCallback();                        // 旧计时器到期：起点已变
    const moved = logs.filter((l) => /start anchor moved/.test(l.text));
    assert.equal(moved.length, 1, "计时起点已变必须留痕");
    assert.equal(moved[0].level, "info");
    assert.equal(dispatches.length, 0, "起点已变时本次作废，不得派发");
  } finally { timers.restore(); }
});

test("可观测性：日志调用抛错不得影响控制流，且不得逃逸出回调", () => {
  // 存在理由：日志在 `setTimeout` 顶层执行，logger 是外部注入的，其实现未必
  // 不抛。`log?.info?.()` 只防「没有 log / 没有该方法」，防不住「方法自己抛」。
  //
  // **注意本用例的边界**：`makeFakeTimers` 把 `setTimeout` 换成同步调用，故异常
  // 是同步冒泡出 `fireAll()`，而非异步的 uncaughtException。这里断言的是
  // 「不抛到调用方」+「判定不被反转」；异步场景由下面那条真定时器用例覆盖。
  const timers = makeFakeTimers();
  try {
    let dispatched = 0;
    const boom = () => { throw new Error("logger boom"); };
    let governed = true;
    const triggers = createTurnTriggers(agentStub(), {
      getScopeState: () => (governed ? "governed" : "not_governed"),
      turns: undefined,
      log: { info: boom, warn: boom, debug: boom },
      readSilenceMs: () => 300_000,
      now: globalThis.__ldvhTestClock,
      onSessionCheckpoint: () => { dispatched++; return Promise.resolve(); }
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    governed = false;
    assert.doesNotThrow(() => timers.fireAll(), "日志抛错不得冒泡出到期回调");
    assert.equal(dispatched, 0, "早退不得因日志抛错被反转成派发");
  } finally { timers.restore(); }
});

test("可观测性：真定时器下日志抛错不得逃逸为 uncaughtException（异步场景）", async () => {
  // 上面那条是同步冒泡，覆盖不到真正的 uncaughtException 场景。本用例用真实
  // `setTimeout`（极短安静时长）让回调在异步上下文里执行。
  const seen = [];
  const onUncaught = (e) => { seen.push(e); };
  process.on("uncaughtException", onUncaught);
  try {
    let governed = true;
    const triggers = createTurnTriggers(agentStub(), {
      getScopeState: () => (governed ? "governed" : "not_governed"),
      turns: undefined,
      log: { info() { throw new Error("boom-info"); }, warn() { throw new Error("boom-warn"); }, debug() { throw new Error("boom-debug"); } },
      readSilenceMs: () => 10,           // 10ms 后到期
      onSessionCheckpoint: () => Promise.resolve()
    });
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    governed = false;                     // 走 warn 分支，而 warn 抛错
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(seen, [], "日志抛错不得在异步上下文里逃逸成 uncaughtException");
  } finally {
    process.removeListener("uncaughtException", onUncaught);
  }
});

test("恢复计时：`restoreActivityAt` 后立即武装（热重载后不得无计时器空转）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggersWithLogs();
    assert.equal(timers.size(), 0, "尚未恢复时无计时器");
    triggers.restoreActivityAt(globalThis.__ldvhTestClock() - 1000);
    assert.equal(timers.size(), 1, "恢复活动时刻后必须立刻武装");
    timers.fireAll();
    assert.equal(dispatches.length, 1, "恢复后到期应正常派发");
  } finally { timers.restore(); }
});

test("恢复计时：久远锚点按**剩余量**武装（延迟接近 0，不白等一个完整安静时长）", () => {
  // 首版这条用「fireAll 之后派发数」断言，而 fireAll 会把时钟推进满整个延迟，
  // 于是「立即到期」与「等满 idleMs」两种实现都能通过——证伪不了它声称的回归。
  // 改为直接断言**计时器的延迟参数**，这才是「等多久」的可观测点。
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggersWithLogs();
    triggers.restoreActivityAt(globalThis.__ldvhTestClock() - 24 * 3600 * 1000); // 24 小时前
    const [entry] = [...timers.pending.values()];
    assert.ok(entry, "应已武装");
    assert.equal(entry.ms, 0, `久远锚点应立刻到期（剩余量 0），实际延迟 ${entry.ms}ms`);
  } finally { timers.restore(); }
});

test("恢复计时：已武装时恢复**更新**的锚点 → 计时器与锚点同源，到期仍会派发（不得空转）", () => {
  // 首版缺这条，而它正是改动第一次尝试时被引入的真实缺陷：restore 只改锚点、
  // 不清旧计时器，旧计时器到期必命中「起点已变」早退并被消费，此后无人重建，
  // 会话静默到下一次宿主状态变化——而宿主只在 status 变化时发事件。
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggersWithLogs();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 1);
    triggers.restoreActivityAt(globalThis.__ldvhTestClock() + 1000); // 更新的锚点
    assert.equal(timers.size(), 1, "仍只有一个计时器（先清后武装，不得并存）");
    timers.fireAll();
    assert.equal(dispatches.length, 1, "旧计时器不得被消费成空转");
  } finally { timers.restore(); }
});

test("恢复计时：陈旧锚点不得覆盖更新的锚点（异步旁路的陈旧快照）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggersWithLogs();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });   // 锚点 = now
    const before = triggers.snapshot().lastActivityAt;
    triggers.restoreActivityAt(globalThis.__ldvhTestClock() - 299_000); // 陈旧
    assert.equal(triggers.snapshot().lastActivityAt, before, "陈旧锚点不得覆盖更新的锚点");
    triggers.restoreActivityAt(before);                        // 相等亦不覆盖
    assert.equal(triggers.snapshot().lastActivityAt, before);
  } finally { timers.restore(); }
});

test("恢复计时：`dispose()` 之后不得再武装、不得对已销毁对象派发", () => {
  // lifecycle 的恢复旁路是 fire-and-forget，中间两次 await 期间会话可能已卸载。
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggersWithLogs();
    triggers.dispose();
    const anchorBefore = triggers.snapshot().lastActivityAt;
    // 用一个**更新的**锚点：否则锚点单调性会先拒绝，测不到 disposed 检查本身。
    triggers.restoreActivityAt(globalThis.__ldvhTestClock() + 5000);
    assert.equal(timers.size(), 0, "已销毁后不得武装计时器");
    // 关键：销毁后的恢复必须**整体**不生效，不能只靠 `armSilenceTimer` 那层拦住
    // 武装而把锚点写坏（半提交）。这条断言把 `restoreActivityAt` 入口的 disposed
    // 检查与「只靠下游守卫」区分开。
    assert.equal(triggers.snapshot().lastActivityAt, anchorBefore, "已销毁后不得写坏锚点（半提交）");
    timers.fireAll();
    assert.equal(dispatches.length, 0, "不得对已销毁对象派发");
  } finally { timers.restore(); }
});

test("恢复计时：超出 Date 可表示范围的值不得抛错，也不得留下半提交状态", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers } = makeTriggersWithLogs();
    const before = triggers.snapshot().lastActivityAt;
    assert.doesNotThrow(() => triggers.restoreActivityAt(1e18), "`new Date(1e18).toISOString()` 会抛 RangeError，须挡在写状态之前");
    assert.equal(timers.size(), 0, "不得留下已武装的计时器");
    assert.equal(triggers.snapshot().lastActivityAt, before, "不得写坏锚点");
  } finally { timers.restore(); }
});

test("恢复计时：非法值不得武装（NaN/0/负数/非数字）", () => {
  const timers = makeFakeTimers();
  try {
    for (const bad of [NaN, 0, -1, "abc", undefined, null]) {
      const { triggers } = makeTriggersWithLogs();
      triggers.restoreActivityAt(bad);
      assert.equal(timers.size(), 0, `非法值 ${String(bad)} 不得武装`);
      triggers.dispose();
    }
  } finally { timers.restore(); }
});

test("恢复计时：`dispose()` 之后新活动与 idle 也不得再武装（销毁是终局）", () => {
  // `dispose()` 的语义是「本对象不再工作」。此前的实现只清计时器而**不记销毁**，
  // 于是 lifecycle 的 fire-and-forget 恢复旁路在两次 await 之后仍会为已销毁的
  // 对象武装计时器，到期后对死对象派发一次。
  // 注：`armSilenceTimer` 内部**没有** disposed 检查（已证实不可达，见源码注释）；
  // 保护在 `restoreActivityAt` 的入口，以及这里验证的「销毁后 onTurnStopping /
  // onAgentStatus 不再产生计时器」这条整体性质。
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggersWithLogs();
    triggers.dispose();
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    assert.equal(timers.size(), 0, "已销毁对象不得因新活动/状态事件武装计时器");
    timers.fireAll();
    assert.equal(dispatches.length, 0, "不得对已销毁对象派发");
  } finally { timers.restore(); }
});

test("到期早退后须重武装：安静不足的早退不得把计时器消费成永久空转", () => {
  // 变异 M10 存活暴露的缺口：删掉「安静不足」早退后的 `armSilenceTimer()`，
  // 测试仍全绿——因为原用例只断言了「没派发」和「留了痕」，没检查计时器还在不在。
  // 真实后果：系统时钟回拨一次，会话就永久失去计时器（宿主只在 status 变化时
  // 发事件，已 idle 的会话不会再发 idle）。
  const timers = makeFakeTimers();
  try {
    let fakeClock = 1_000_000_000_000;
    const { triggers, dispatches } = makeTriggersWithLogs({ now: () => fakeClock });
    triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();               // 到期：quietFor=0 < idleMs，走「安静不足」早退
    assert.equal(dispatches.length, 0, "安静不足不得派发");
    assert.equal(timers.size(), 1, "早退后必须重武装，否则计时器被消费成永久空转");
    // 时钟回拨恢复后，下一次到期应能正常派发（证明重武装的是真计时器，不是空壳）
    fakeClock += 400_000;
    timers.fireAll();
    assert.equal(dispatches.length, 1, "重武装的计时器到期后应正常派发");
  } finally { timers.restore(); }
});

// ---------------------------------------------------------------------------
// 轮次恢复（2026-10-19）：重启后尚无回合时，从宿主会话记录回填位置
// ---------------------------------------------------------------------------
//
// 失效路径（实测）：`lastTurn` 只在回合边界事件里赋值、无持久化载体。进程重启
// 后若该会话尚未开启新回合，`lastTurn` 就是 undefined；此时安静期计时器已被
// 启动恢复旁路武装（同批修复），到期派发拿不到区间端点 → `no_current_turn`
// fail-closed。故必须能从宿主记录回填，且**不得**覆盖运行时已更新的值。

test("轮次恢复：重启后尚无回合时，回填的轮次随派发上抛（此前必为 undefined）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    // 只有活动锚点，从未收到任何 turn 事件——重启后的真实形态。
    triggers.restoreActivityAt(globalThis.__ldvhTestClock() - 1000);
    assert.equal(triggers.snapshot().lastTurn, undefined, "恢复活动时刻不会顺带恢复轮次");
    assert.equal(triggers.restoreLastTurn(9), true);
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].turn, 9, "派发必须带上从宿主记录读回的轮次号");
  } finally { timers.restore(); }
});

test("轮次恢复：已有轮次时不得覆盖（本函数不是第二条写 lastTurn 的通道）", () => {
  const timers = makeFakeTimers();
  try {
    const { triggers, dispatches } = makeTriggers();
    triggers.onTurnStopping({ agent: agentStub(), turn: 12 });
    assert.equal(triggers.restoreLastTurn(9), false, "已有更新值时拒不采纳");
    assert.equal(triggers.snapshot().lastTurn, 12);
    triggers.restoreActivityAt(globalThis.__ldvhTestClock() - 1000);
    triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
    timers.fireAll();
    assert.equal(dispatches[0].turn, 12, "陈旧快照不得把水位推回去（否则 10–12 轮会被重复计入）");
  } finally { timers.restore(); }
});

test("轮次恢复：非法值一律拒不采纳且不半提交", () => {
  const { triggers } = makeTriggers();
  for (const bad of [undefined, null, -1, 1.5, "3", Number.NaN]) {
    assert.equal(triggers.restoreLastTurn(bad), false, `非法值 ${String(bad)} 不得采纳`);
  }
  assert.equal(triggers.snapshot().lastTurn, undefined, "被拒的值不得留下任何状态");
});

test("轮次恢复：已销毁后拒不采纳（disposed 守卫须独立成立）", () => {
  // ⚠️ 首版把这条与「非法值」合在一起，于是它靠 `restoreLastTurn(0)` 先写下的
  // `lastTurn=0`、由**「不覆盖已定义值」**那条纪律代为挡下——删掉 disposed 守卫
  // 用例照样全绿（2026-10-19 变异测试 M8，0/36 命中）。此处不预置任何值，使
  // 「销毁后写入」成为唯一可能的拒绝理由，守卫才是真的被验证。
  const { triggers } = makeTriggers();
  assert.equal(triggers.snapshot().lastTurn, undefined, "前提：销毁前尚无轮次（否则被测的是另一条纪律）");
  triggers.dispose();
  assert.equal(triggers.restoreLastTurn(5), false, "已销毁：不得再写状态");
  assert.equal(triggers.snapshot().lastTurn, undefined, "销毁后回填不得改动状态");
  // 第 0 轮同样不得被写入——校验顺序不得让合法值绕开 disposed 检查。
  assert.equal(triggers.restoreLastTurn(0), false, "合法值同样须被 disposed 守卫挡下");
  assert.equal(triggers.snapshot().lastTurn, undefined);
});
