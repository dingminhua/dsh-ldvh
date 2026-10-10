// Tests for plugin/lib/triggers.js — 04 §8.4 触发段（会话检查点 + 二次空闲确认）.
//
// Authority: specs/04 §8.4 「触发」段：「以**会话检查点**为触发锚（对话回合稳定点
// 之后）……触发后须**二次确认会话确已空闲**方可继续」。
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTurnTriggers } from "../lib/triggers.js";

/** 最小 agent 桩：id + session.header.cwd。 */
function agentStub(id = "agent-1") {
  return { id, session: { header: { id, cwd: "/tmp/project" } } };
}

function makeTriggers({ governed = true, onSessionCheckpoint } = {}) {
  const dispatches = [];
  const activity = { entries: [], record(kind, payload) { this.entries.push({ kind, payload }); } };
  const triggers = createTurnTriggers(agentStub(), {
    getScopeState: () => (governed ? "governed" : "not_governed"),
    turns: undefined, // 用模块内的局部 marker
    activity,
    log: { warn() {} },
    onSessionCheckpoint: onSessionCheckpoint ?? ((info) => { dispatches.push(info); return Promise.resolve(); })
  });
  return { triggers, dispatches, activity };
}

// ---------------------------------------------------------------------------
// 两次触发：缺一不可
// ---------------------------------------------------------------------------

test("§8.4：只有回合停止（检查点）而**未**确认空闲时，不调度", () => {
  const { triggers, dispatches } = makeTriggers();
  triggers.onTurnStopping({ agent: agentStub(), turn: 7 });
  assert.equal(dispatches.length, 0, "checkpoint arrival alone must not dispatch (04 §8.4 二次确认)");
});

test("§8.4：只有空闲而**未**到达检查点时，不调度", () => {
  const { triggers, dispatches } = makeTriggers();
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  assert.equal(dispatches.length, 0, "idle alone is not a session checkpoint");
});

test("§8.4：检查点到达**且**随后确认空闲，才调度一次", () => {
  const { triggers, dispatches } = makeTriggers();
  triggers.onTurnStopping({ agent: agentStub(), turn: 7 });
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].turn, 7);
  assert.equal(dispatches[0].source, "agent/status:idle");
});

test("§8.4：一次检查点最多调度一次——idle 反复迁移不重复派任务", () => {
  const { triggers, dispatches } = makeTriggers();
  triggers.onTurnStopping({ agent: agentStub(), turn: 7 });
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  assert.equal(dispatches.length, 1, "the pending flag is consumed exactly once");
});

test("§8.4：running 迁移被忽略，只有 idle 确认空闲", () => {
  const { triggers, dispatches } = makeTriggers();
  triggers.onTurnStopping({ agent: agentStub(), turn: 3 });
  triggers.onAgentStatus({ agent: agentStub(), status: "running" });
  assert.equal(dispatches.length, 0, "`running` is not an idle confirmation");

  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  assert.equal(dispatches.length, 1);
});

test("§8.4：下一个检查点会重新置位，可再次调度", () => {
  const { triggers, dispatches } = makeTriggers();
  triggers.onTurnStopping({ agent: agentStub(), turn: 1 });
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  triggers.onTurnStopping({ agent: agentStub(), turn: 2 });
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  assert.equal(dispatches.length, 2);
  assert.deepEqual(dispatches.map((d) => d.turn), [1, 2]);
});

// ---------------------------------------------------------------------------
// 管辖门（32 §137：git 层操作要求当前项目受管辖）
// ---------------------------------------------------------------------------

test("§8.4：未受管辖时既不置位也不调度", () => {
  const { triggers, dispatches } = makeTriggers({ governed: false });
  triggers.onTurnStopping({ agent: agentStub(), turn: 5 });
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  assert.equal(dispatches.length, 0, "an ungoverned project must not run auxiliary tasks");
});

test("§8.4：受管辖判定在 idle 时刻复核——检查点后转为未受管辖则不调度", () => {
  let governed = true;
  const dispatches = [];
  const triggers = createTurnTriggers(agentStub(), {
    getScopeState: () => (governed ? "governed" : "not_governed"),
    turns: undefined,
    log: { warn() {} },
    onSessionCheckpoint: (info) => { dispatches.push(info); return Promise.resolve(); }
  });
  triggers.onTurnStopping({ agent: agentStub(), turn: 5 });
  governed = false; // 检查点与空闲之间管辖状态变化
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  assert.equal(dispatches.length, 0, "the gate is re-checked at dispatch time, not only at checkpoint time");
});

// ---------------------------------------------------------------------------
// 其它 agent 的事件必须被隔离
// ---------------------------------------------------------------------------

test("§8.4：其它 agent 的 turn-stopping / status 事件被忽略", () => {
  const { triggers, dispatches } = makeTriggers();
  triggers.onTurnStopping({ agent: { id: "other" }, turn: 9 });
  triggers.onAgentStatus({ agent: { id: "other" }, status: "idle" });
  assert.equal(dispatches.length, 0);
});

// ---------------------------------------------------------------------------
// 调度失败不得逃逸到宿主事件分发（安全侧）
// ---------------------------------------------------------------------------

test("§8.4/§8.3：调度回调抛出的拒绝被收口，不逃逸也不重复调度", async () => {
  const warns = [];
  const dispatches = [];
  const triggers = createTurnTriggers(agentStub(), {
    getScopeState: () => "governed",
    turns: undefined,
    log: { warn(...args) { warns.push(args.join(" ")); } },
    onSessionCheckpoint: () => { dispatches.push(1); return Promise.reject(new Error("编排失败")); }
  });
  triggers.onTurnStopping({ agent: agentStub(), turn: 4 });
  // 同步返回：异常不会从 onAgentStatus 抛出
  triggers.onAgentStatus({ agent: agentStub(), status: "idle" });
  assert.equal(dispatches.length, 1);
  // 等微任务队列排空，确认拒绝被 log 收口
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(warns.length, 1);
  assert.match(warns[0], /编排失败/);
});

test("§8.4：同步抛出的调度回调同样被收口", async () => {
  const warns = [];
  const triggers = createTurnTriggers(agentStub(), {
    getScopeState: () => "governed",
    turns: undefined,
    log: { warn(...args) { warns.push(args.join(" ")); } },
    onSessionCheckpoint: () => { throw new Error("同步失败"); }
  });
  triggers.onTurnStopping({ agent: agentStub(), turn: 4 });
  assert.doesNotThrow(() => triggers.onAgentStatus({ agent: agentStub(), status: "idle" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(warns.length, 1);
});
