// Tests for 11 §6.1（2026-10-23 修订）：**回合开始暂停计时、回合结束重启计时**。
//
// 被取代的旧纪律：「取消的含义限于推迟」「不得以删后重建替代原地更新」。
// 新模型下，定时任务**只在等待窗内存在**——对话进行中宿主侧没有本任务的倒计时。
//
// 本文件只测三处可错点：
//   1. 回合开始有没有真的把任务撤掉；
//   2. 撤掉失败（宿主拒绝）时，任务可能在回合中到期——**不得派发**，且须登记；
//   3. 回合结束有没有按「结束时刻 + 安静时长」重新登记。
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTurnTriggers } from "../lib/triggers.js";

const SILENCE_MS = 300_000;

async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/**
 * 最小测试台：真实触发器 + 假宿主调度器 + 注入的时钟。
 *
 * `removeThrows` 用来模拟「宿主拒绝撤掉」——这是新模型里唯一会产生危险残留的
 * 路径，必须单独覆盖，否则「撤掉」写成「发起撤掉」也照样测得过。
 */
function makeHarness({ removeThrows = false } = {}) {
  const agent = { id: "agent-1", session: { header: { id: "agent-1", cwd: "/tmp/project" } } };
  let seq = 0;
  let clock = 1_000_000_000_000;
  let singleId = null;
  const pending = new Map();   // id -> { dueAt, onDue }
  const removed = [];
  const scheduler = {
    available: true,
    cancelled: new Set(),
    async schedule({ dueAt, onDue }) {
      if (singleId !== null && pending.has(singleId)) {
        pending.set(singleId, { dueAt, onDue });
        return singleId;
      }
      singleId = `sched-${++seq}`;
      pending.set(singleId, { dueAt, onDue });
      return singleId;
    },
    async remove(id) {
      removed.push(id);
      if (removeThrows) throw new Error("remove refused by host");
      pending.delete(id);
    },
  };
  const dispatches = [];
  const pendings = [];
  const activity = { entries: [], record(kind, payload) { this.entries.push({ kind, payload }); } };
  const triggers = createTurnTriggers(agent, {
    getScopeState: () => "governed",
    turns: undefined,
    activity,
    log: { info() {}, warn() {} },
    readSilenceMs: () => SILENCE_MS,
    now: () => clock,
    persistActivityAt: () => Promise.resolve(),
    onSessionCheckpoint: (info) => { dispatches.push(info); return Promise.resolve(); },
    scheduler,
    registerPending: (entry) => { pendings.push(entry); return Promise.resolve(); },
  });
  return {
    agent, triggers, dispatches, pendings, activity, pending, removed,
    now: () => clock,
    advance(ms) { clock += ms; },
    fireDue() {
      const ids = [...pending.keys()];
      for (const id of ids) {
        const entry = pending.get(id);
        pending.delete(id);
        entry.onDue();
      }
    },
  };
}

/** 走一遍「有活动 → 安静期武装」，得到一条挂着的宿主任务。 */
async function arm(h, turn = 7) {
  h.triggers.onTurnStopping({ agent: h.agent, turn });
  h.triggers.onAgentStatus({ agent: h.agent, status: "idle" });
  await settle();   // 排期是异步的：生产里任务先落到宿主，回合才可能开始
}

// ---------------------------------------------------------------------------
// 1. 回合开始 = 撤掉
// ---------------------------------------------------------------------------

test("§6.1：回合开始后，宿主侧不再有本任务（撤掉真的发生过）", async () => {
  const h = makeHarness();
  await arm(h);
  assert.equal(h.pending.size, 1, "前提：安静期已被武装");

  h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });
  await settle();

  assert.equal(h.pending.size, 0, "回合开始后不得再有计时器");
  assert.equal(h.removed.length, 1, "撤掉须真的发出删除，而不是只在内存里标记");
});

test("§6.1：回合开始后，回合进行中不得武装（idle 事件不得把计时器加回来）", async () => {
  const h = makeHarness();
  await arm(h);
  h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });
  await settle();

  h.triggers.onAgentStatus({ agent: h.agent, status: "idle" });
  await settle();
  assert.equal(h.pending.size, 0, "回合进行中的 idle 不得重新武装");
});

// ---------------------------------------------------------------------------
// 2. 撤掉失败：残留任务在回合中到期 → 不派发 + 登记
// ---------------------------------------------------------------------------

test("§6.1/§6.3：撤掉失败时任务可能在回合中到期——拒绝派发，且按 §12 登记", async () => {
  const h = makeHarness({ removeThrows: true });
  await arm(h);
  h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });
  await settle();

  assert.equal(h.pending.size, 1, "前提：宿主拒绝了撤掉，任务仍残留");
  assert.equal(h.pendings.length, 1, "撤掉失败须进入待处置登记，不得静默");
  assert.match(h.pendings[0].reason, /撤掉失败/);

  h.advance(SILENCE_MS);
  h.fireDue();
  await settle();

  assert.equal(h.dispatches.length, 0, "回合进行中到期也不得派发");
  assert.ok(
    h.activity.entries.some((e) => e.kind === "session/checkpoint/refused-turn-in-flight"),
    "拒绝派发须留痕",
  );
});

test("§6.1：撤掉成功的路径不得登记（避免把正常路径写成缺口）", async () => {
  const h = makeHarness();
  await arm(h);
  h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });
  await settle();
  assert.equal(h.pendings.length, 0, "撤掉成功时不应有待处置登记");
});

// ---------------------------------------------------------------------------
// 3. 回合结束 = 重启，且重新起算
// ---------------------------------------------------------------------------

test("§6.1：回合结束后重新登记，目标时刻 = 回合结束时刻 + 安静时长", async () => {
  const h = makeHarness();
  await arm(h);
  h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });
  await settle();
  assert.equal(h.pending.size, 0);

  h.advance(90_000); // 回合进行了一段不短于零的时间
  const endedAt = h.now();
  h.triggers.onSessionEvent(h.agent.session, { type: "turn/end" });
  await settle();

  assert.equal(h.pending.size, 1, "回合结束须重新登记");
  const entry = [...h.pending.values()][0];
  assert.equal(entry.dueAt, endedAt + SILENCE_MS, "计时须自回合结束起重新起算，不是接着旧的走");
});

test("§6.1：回合结束后到期 → 派发一次", async () => {
  const h = makeHarness();
  await arm(h);
  h.triggers.onSessionEvent(h.agent.session, { type: "turn/start" });
  await settle();
  h.triggers.onSessionEvent(h.agent.session, { type: "turn/end" });
  await settle();

  h.advance(SILENCE_MS);
  h.fireDue();
  await settle();
  assert.equal(h.dispatches.length, 1, "安静期满须派发一次");
});
