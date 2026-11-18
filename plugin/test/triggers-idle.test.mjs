import { test } from "node:test";
import assert from "node:assert/strict";

import * as triggers from "../lib/triggers.js";

function agentStub(id = "agent-1") {
  return { id, session: { header: { id, cwd: "/tmp/project" } } };
}


test("36 §7.6（2026-11-17）：`armSilenceTimer` 不得再武装任何计时器", () => {
  const original = globalThis.setTimeout;
  let armed = 0;
  globalThis.setTimeout = (...args) => {
    armed += 1;
    return original(...args);
  };
  try {
    const dispatches = [];
    const t = triggers.createTurnTriggers(agentStub(), {
      getScopeState: () => ({ status: "governed", project: { id: "proj-1", path: "/tmp/project" } }),
      onSessionCheckpoint: (payload) => { dispatches.push(payload?.source ?? "checkpoint"); return Promise.resolve({ ok: true }); },
    });
    t.onSessionEvent(agentStub().session, { type: "turn/end", turn: 1 });
    t.onAgentStatus?.("idle");
    assert.equal(armed, 0, "不得武装任何计时器——触发锚已改为主控发起");
    assert.deepEqual(dispatches, [], "不得自行派发——派发由主控发起");
    t.dispose?.();
  } finally {
    globalThis.setTimeout = original;
  }
});

test("36 §7.6（2026-11-17）：`createTurnTriggers` 不再接受或读取安静时长配置", async () => {
  const original = globalThis.setTimeout;
  let armed = 0;
  globalThis.setTimeout = (...args) => { armed += 1; return original(...args); };
  try {
    const dispatches = [];
    const t = triggers.createTurnTriggers(agentStub(), {
      getScopeState: () => ({ status: "governed", project: { id: "proj-1", path: "/tmp/project" } }),
      readSilenceMs: () => 1,
      onSessionCheckpoint: (payload) => { dispatches.push(payload?.source ?? "checkpoint"); return Promise.resolve({ ok: true }); },
    });
    t.onSessionEvent(agentStub().session, { type: "turn/end", turn: 1 });
    t.onAgentStatus?.("idle");
    await new Promise((resolve) => original(resolve, 20));
    assert.equal(armed, 0, "readSilenceMs 不得再产生计时器");
    assert.deepEqual(dispatches, [], "readSilenceMs 不得再产生派发");
    t.dispose?.();
  } finally {
    globalThis.setTimeout = original;
  }
});

test("36 §15.1 第 3 项：`triggers.js` 不得导出任何安静期判定辅助", () => {
  for (const gone of ["silenceMs", "armSilenceTimer", "clearSilenceTimer", "isSilenceExpired"]) {
    assert.equal(
      triggers[gone],
      undefined,
      `${gone} 不得再作为导出存在——36 §15.1 第 3 项禁止恢复任何周期触发形态`,
    );
  }
});

test("36 §15.1 第 3 项：模块源码不得含计时器武装语句", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/triggers.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /dispatchCheckpoint\(\s*["']silence:timer["']\s*\)/,
    "不得再有 silence:timer 派发（计时器已删除）",
  );
});


test("机制删除不得连带删掉触发器本体——它仍承载会话观察与窗口累积", () => {
  const t = triggers.createTurnTriggers(agentStub(), {
    getScopeState: () => ({ status: "governed", project: { id: "proj-1", path: "/tmp/project" } }),
    onSessionCheckpoint: () => Promise.resolve({ ok: true }),
  });
  assert.equal(typeof t.onSessionEvent, "function", "会话事件观察须仍在");
  assert.equal(typeof t.dispose, "function", "须仍可释放");
  assert.doesNotThrow(() => {
    t.onSessionEvent(agentStub().session, { type: "turn/start", turn: 1 });
    t.onSessionEvent(agentStub().session, { type: "turn/end", turn: 1 });
  });
  t.dispose?.();
});
