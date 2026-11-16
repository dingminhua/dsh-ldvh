// Tests for plugin/lib/triggers.js — 11 §6.1 触发段（**2026-11-17 机制变更后**）.
//
// Authority: specs/11 §6.1「触发锚是**主控发起**」——主控在当次行动中发现阻碍时，
// 把材料交给一个代理去记录；**没有任何进程内计时器、没有安静时长、没有到期判定**。
//
// ## 本文件为什么从 36 个用例缩为守卫用例
//
// 2026-11-17 之前，本文件用假定时器驱动 `triggers.js`，验证「距最后一次会话活动
// 持续满安静时长 → 派发一次」这一整条判据：排期算得对不对、到期再确认做没做、
// 新活动有没有重置、`turn/start` 有没有清掉计时器……
//
// 机制改为主控发起后，**这些判据一个都不存在了**——不是「仍然存在但不再触发」，
// 而是判据本身被删除（11 §6.1）。继续保留那些用例只有两种可能：让它们失败（噪声），
// 或让它们通过（那就意味着计时器还在，机制没改）。两者都不可接受。
//
// 故本文件改为**负向守卫**：断言那些符号与行为**不存在**。若有人日后悄悄把计时器
// 加回来，下列用例会立刻失败——这正是 11 §19.1 第 3 项「不得恢复任何周期触发形态
// （含计时器、静置检查点、宿主定时任务或任何等效结构）」的可执行形态。
//
// 正向行为（主控发起 → 交派代理 → 代理写缓冲）由 `friction-child-surface.test.mjs`
// 与 `friction-observation-buffer.test.mjs` 覆盖。
import { test } from "node:test";
import assert from "node:assert/strict";

import * as triggers from "../lib/triggers.js";

/** 最小 agent 桩：id + session.header.cwd。 */
function agentStub(id = "agent-1") {
  return { id, session: { header: { id, cwd: "/tmp/project" } } };
}

// ---------------------------------------------------------------------------
// 负向守卫：计时载体整体不存在
// ---------------------------------------------------------------------------

test("11 §6.1（2026-11-17）：`armSilenceTimer` 不得再武装任何计时器", () => {
  // 该函数作为外壳仍存在（多处清理路径调用它），但**必须立即早退**。
  //
  // 判据不看源码文本，而是**行为**：给它一个本会武装计时器的状态，然后确认
  // 宿主 `setTimeout` 没有被调用。源码文本可以被注释骗过，行为不能。
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
    // 走一遍「活动 → idle」这条过去会武装计时器的路径。
    t.onSessionEvent(agentStub().session, { type: "turn/end", turn: 1 });
    t.onAgentStatus?.("idle");
    assert.equal(armed, 0, "不得武装任何计时器——触发锚已改为主控发起");
    assert.deepEqual(dispatches, [], "不得自行派发——派发由主控发起");
    t.dispose?.();
  } finally {
    globalThis.setTimeout = original;
  }
});

test("11 §6.1（2026-11-17）：`createTurnTriggers` 不再接受或读取安静时长配置", async () => {
  // 过去 `createTurnTriggers({ readSilenceMs })` 是注入安静时长读值的入口。
  // 现在传进去也必须**不产生任何效果**——否则「配置里还能设安静时长」会成为
  // 表面事实（设置面已无该输入框，改了也不生效）。
  const original = globalThis.setTimeout;
  let armed = 0;
  globalThis.setTimeout = (...args) => { armed += 1; return original(...args); };
  try {
    const dispatches = [];
    const t = triggers.createTurnTriggers(agentStub(), {
      getScopeState: () => ({ status: "governed", project: { id: "proj-1", path: "/tmp/project" } }),
      // 故意传一个「1 毫秒就到期」的读值：若仍被读取，下面几乎立刻会派发。
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

test("11 §19.1 第 3 项：`triggers.js` 不得导出任何安静期判定辅助", () => {
  // 这些名字若重新出现，意味着「安静期」这套判据被悄悄恢复。
  for (const gone of ["silenceMs", "armSilenceTimer", "clearSilenceTimer", "isSilenceExpired"]) {
    assert.equal(
      triggers[gone],
      undefined,
      `${gone} 不得再作为导出存在——11 §19.1 第 3 项禁止恢复任何周期触发形态`,
    );
  }
});

test("11 §19.1 第 3 项：模块源码不得含计时器武装语句", async () => {
  // 行为守卫之外再加一道**文本守卫**：即使某条路径没被上面的用例覆盖到，
  // 「文件里根本没有 setTimeout 武装计时器」这一事实也能被钉住。
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/triggers.js", import.meta.url), "utf8");
  // 允许 `unref` 等清理语句，但不得有「到期后 dispatchCheckpoint」这类武装。
  assert.doesNotMatch(
    source,
    /dispatchCheckpoint\(\s*["']silence:timer["']\s*\)/,
    "不得再有 silence:timer 派发（计时器已删除）",
  );
});

// ---------------------------------------------------------------------------
// 正向：仍须存在的能力
// ---------------------------------------------------------------------------

test("机制删除不得连带删掉触发器本体——它仍承载会话观察与窗口累积", () => {
  // 计时器是 triggers.js 的**一部分**职责，不是全部。删掉计时器不等于删掉
  // 「会话事件观察」「窗口累积」「轮次记录」这些仍在用的能力——若有人顺手
  // 把整个模块清空，本用例会失败。
  const t = triggers.createTurnTriggers(agentStub(), {
    getScopeState: () => ({ status: "governed", project: { id: "proj-1", path: "/tmp/project" } }),
    onSessionCheckpoint: () => Promise.resolve({ ok: true }),
  });
  assert.equal(typeof t.onSessionEvent, "function", "会话事件观察须仍在");
  assert.equal(typeof t.dispose, "function", "须仍可释放");
  // 不抛错即证明事件处理链完整。
  assert.doesNotThrow(() => {
    t.onSessionEvent(agentStub().session, { type: "turn/start", turn: 1 });
    t.onSessionEvent(agentStub().session, { type: "turn/end", turn: 1 });
  });
  t.dispose?.();
});
