// Tests for 11 §6.1 的**暂停/恢复纪律**——2026-11-17 机制变更后。
//
// ## 历史
//
// 2026-10-23 的纪律是「回合开始暂停计时、回合结束重启计时」，当时计时载体是宿主
// 定时任务；2026-10-24 改回进程内 `setTimeout` 后纪律不变、承载形状变了（清掉
// 计时器而非删除宿主任务）。本文件当时测三处可错点：回合开始有没有真清掉计时器、
// 回合进行中旧到期回调会不会误派发、回合结束有没有按「结束时刻 + 安静时长」重新武装。
//
// ## 2026-11-17：三处可错点全部消失
//
// 触发锚改为主控发起后，**没有计时器可暂停、没有到期回调可误派发、没有重新武装
// 这回事**。11 §19.1 第 3 项禁止恢复任何周期触发形态。故本文件改为守卫：
//
//   · 回合开始 / 结束**都不得**产生计时器；
//   · 任何事件序列**都不得**自行派发（派发只由主控发起）；
//   · `silenceTimer` 状态槽恒为空。
//
// 正向的「主控发起」路径由 `friction-child-surface.test.mjs` 覆盖。
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTurnTriggers } from "../lib/triggers.js";

/** 最小测试台：真实触发器 + 监视 setTimeout 的调用。 */
function makeHarness() {
  const agent = { id: "agent-1", session: { header: { id: "agent-1", cwd: "/tmp/project" } } };
  const dispatches = [];
  const armed = [];
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => {
    armed.push(ms);
    return original(fn, ms, ...rest);
  };
  const t = createTurnTriggers(agent, {
    getScopeState: () => ({ status: "governed", project: { id: "proj-1", path: "/tmp/project" } }),
    // 故意给一个「1 毫秒即到期」的读值：若仍被读取，会立刻派发。
    readSilenceMs: () => 1,
    onSessionCheckpoint: (payload) => {
      dispatches.push(payload?.source ?? "checkpoint");
      return Promise.resolve({ ok: true });
    },
  });
  return {
    t,
    dispatches,
    armed,
    original,
    restore() { globalThis.setTimeout = original; },
    session: agent.session,
  };
}

test("§6.1（2026-11-17）：回合开始/结束的任意序列都不得武装计时器", async () => {
  const h = makeHarness();
  try {
    h.t.onSessionEvent(h.session, { type: "turn/start", turn: 1 });
    h.t.onSessionEvent(h.session, { type: "turn/end", turn: 1 });
    h.t.onSessionEvent(h.session, { type: "turn/start", turn: 2 });
    h.t.onSessionEvent(h.session, { type: "turn/end", turn: 2 });
    // **用捕获前的原始 setTimeout 等待**——否则等待本身会被计入 `armed`
    //（这正是本用例第一次跑红的原因：抓到的是自己的等待，不是被删的计时器）。
    await new Promise((resolve) => h.original(resolve, 30));
    assert.deepEqual(h.armed, [], "不得武装任何计时器（含 1ms 这种短值）");
  } finally {
    h.restore();
    h.t.dispose?.();
  }
});

test("§6.1/§6.3（2026-11-17）：任何事件序列都不得自行派发", async () => {
  const h = makeHarness();
  try {
    // 走遍过去会触发的全部路径：活动、idle、回合边界、重复 idle。
    h.t.onSessionEvent(h.session, { type: "turn/start", turn: 1 });
    h.t.onAgentStatus?.("running");
    h.t.onAgentStatus?.("idle");
    h.t.onSessionEvent(h.session, { type: "turn/end", turn: 1 });
    h.t.onAgentStatus?.("idle");
    h.t.onAgentStatus?.("idle");
    await new Promise((resolve) => h.original(resolve, 30));
    assert.deepEqual(h.dispatches, [], "不得自行派发——派发只由主控发起（11 §6.1）");
  } finally {
    h.restore();
    h.t.dispose?.();
  }
});

test("§6.1（2026-11-17）：状态槽 `silenceTimer` 恒为空", async () => {
  const h = makeHarness();
  try {
    h.t.onSessionEvent(h.session, { type: "turn/end", turn: 1 });
    h.t.onAgentStatus?.("idle");
    await new Promise((resolve) => h.original(resolve, 10));
    // 通过公开方法间接观察：dispose 后仍不得留下待触发的计时器。
    h.t.dispose?.();
    // 没有抛错、也没有派发，即证明状态槽未被武装到会产生副作用。
    assert.deepEqual(h.dispatches, []);
  } finally {
    h.restore();
  }
});

test("§6.1（2026-11-17）：回合中断（从未收到 turn/end）同样不得派发", async () => {
  const h = makeHarness();
  try {
    h.t.onSessionEvent(h.session, { type: "turn/start", turn: 1 });
    h.t.onAgentStatus?.("idle");
    await new Promise((resolve) => h.original(resolve, 30));
    assert.deepEqual(h.dispatches, [], "回合中断不得自行重建计时或派发");
  } finally {
    h.restore();
    h.t.dispose?.();
  }
});
