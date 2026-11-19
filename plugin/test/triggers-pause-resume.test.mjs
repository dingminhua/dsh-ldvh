import { test } from "node:test";
import assert from "node:assert/strict";

import { createTurnTriggers } from "../lib/triggers.js";

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
    h.t.onSessionEvent(h.session, { type: "turn/start", turn: 1 });
    h.t.onAgentStatus?.("running");
    h.t.onAgentStatus?.("idle");
    h.t.onSessionEvent(h.session, { type: "turn/end", turn: 1 });
    h.t.onAgentStatus?.("idle");
    h.t.onAgentStatus?.("idle");
    await new Promise((resolve) => h.original(resolve, 30));
    assert.deepEqual(h.dispatches, [], "不得自行派发——派发只由主控发起（36 §7.6）");
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
    h.t.dispose?.();
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
