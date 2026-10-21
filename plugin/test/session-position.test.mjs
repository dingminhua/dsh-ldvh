// Tests for plugin/lib/session-position.js — 从宿主会话记录取「最后轮次号」.
//
// Authority: specs/11 §11（水位切分依据只能是宿主会话记录中的位置）。
//
// 这个模块存在的原因是一条确定性失效路径（2026-10-19 实测）：`lastTurn` 只在回合
// 边界事件里赋值、无持久化载体，故进程重启后安静期计时器一旦武装（同一批修复），
// 第一次闲时派发必然因 `no_current_turn` fail-closed。宿主记录里的轮次号是唯一
// 合规的来源，本模块只取位置、不重建材料。
import { test } from "node:test";
import assert from "node:assert/strict";

import { maxTurnFromEvents, readLastTurn } from "../lib/session-position.js";

// ---------------------------------------------------------------------------
// 事件解析：只认轮次边界事件
// ---------------------------------------------------------------------------

test("取最大轮次号：turn/start 与 turn/end 都算，取单调最大值", () => {
  const events = [
    { type: "session", seq: 0, data: {} },
    { type: "turn/start", seq: 1, data: { turn: 1 } },
    { type: "turn/end", seq: 2, data: { turn: 1 } },
    { type: "turn/start", seq: 3, data: { turn: 2 } },
    { type: "turn/end", seq: 4, data: { turn: 2 } },
  ];
  assert.equal(maxTurnFromEvents(events), 2);
});

test("取最大轮次号：只开了没结束的轮次也算（位置已前移）", () => {
  const events = [
    { type: "turn/start", seq: 1, data: { turn: 1 } },
    { type: "turn/end", seq: 2, data: { turn: 1 } },
    { type: "turn/start", seq: 3, data: { turn: 2 } },
  ];
  assert.equal(maxTurnFromEvents(events), 2, "本轮已开始即说明前一轮已处理完");
});

test("取最大轮次号：非轮次边界事件的 data.turn 不参与（材料事件的 turn 不构成位置）", () => {
  const events = [
    { type: "turn/start", seq: 1, data: { turn: 3 } },
    { type: "assistant/message", seq: 2, data: { turn: 99 } },
    { type: "user/message", seq: 3, data: { turn: 42 } },
  ];
  assert.equal(maxTurnFromEvents(events), 3, "只有轮次边界定义位置，材料里的 turn 不算");
});

test("取最大轮次号：无轮次事件时返回 null（不得返回 0 冒充「第 0 轮」）", () => {
  assert.equal(maxTurnFromEvents([{ type: "session", seq: 0, data: {} }]), null);
  assert.equal(maxTurnFromEvents([]), null);
  assert.equal(maxTurnFromEvents(undefined), null);
  assert.equal(maxTurnFromEvents("not an array"), null);
});

test("取最大轮次号：非法载荷被跳过（不抛、不猜）", () => {
  const events = [
    { type: "turn/start", seq: 1, data: { turn: "3" } },
    { type: "turn/end", seq: 2, data: { turn: -1 } },
    { type: "turn/start", seq: 3, data: { turn: 1.5 } },
    { type: "turn/end", seq: 4, data: null },
    { type: "turn/start", seq: 5 },
    null,
    "garbage",
    { type: "turn/end", seq: 6, data: { turn: 4 } },
  ];
  assert.equal(maxTurnFromEvents(events), 4);
});

// ---------------------------------------------------------------------------
// 读通道：如实成功 / 如实失败，绝不退回更弱的来源
// ---------------------------------------------------------------------------

/** 一个最简的宿主持久化桩：把 events 交给 handle.read()。 */
function persistenceStub(events, { throwOnOpen = false, throwOnRead = false, noRead = false, throwOnClose = false } = {}) {
  const calls = { open: [], closed: 0 };
  return {
    calls,
    open: async (id, access) => {
      calls.open.push([id, access]);
      if (throwOnOpen) throw new Error("no such session");
      return {
        read: noRead
          ? undefined
          : async () => {
            if (throwOnRead) throw new Error("log unreadable");
            return { eventState: "attached", events };
          },
        close: async () => {
          calls.closed += 1;
          if (throwOnClose) throw new Error("close failed");
        },
      };
    },
  };
}

test("读取成功：用纯读句柄打开会话（不取写租约），并关闭句柄", async () => {
  const persistence = persistenceStub([
    { type: "turn/start", seq: 1, data: { turn: 1 } },
    { type: "turn/end", seq: 2, data: { turn: 1 } },
    { type: "turn/start", seq: 3, data: { turn: 2 } },
  ]);
  const result = await readLastTurn({ sessionPersistence: persistence, sessionId: "session-a" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.turn, 2);
  assert.equal(result.events, 3, "读到的条数一并带出，供痕迹核对「读的确实是全部历史」");
  assert.deepEqual(persistence.calls.open, [["session-a", "read"]], "必须是 read 访问级别");
  assert.equal(persistence.calls.closed, 1, "句柄必须关闭（宿主 teardown 会统一回收，但不关就是泄漏）");
});

test("读取失败：open 抛错时如实返回原因，不猜轮次", async () => {
  const persistence = persistenceStub([], { throwOnOpen: true });
  const result = await readLastTurn({ sessionPersistence: persistence, sessionId: "session-a" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /host open\(\) failed: no such session/);
});

test("读取失败：read 抛错时如实返回原因", async () => {
  const persistence = persistenceStub([], { throwOnRead: true });
  const result = await readLastTurn({ sessionPersistence: persistence, sessionId: "session-a" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /host read\(\) failed: log unreadable/);
  assert.equal(persistence.calls.closed, 1, "读取失败时句柄仍须关闭");
});

test("关闭失败：已取到的位置照常返回（关闭失败不抹掉位置，也不抛出）", async () => {
  // 宿主 teardown 会统一回收句柄；close() 本身幂等。关闭失败不影响已读到的
  // 位置——若因此把整个读取判成失败，等于让「清理异常」冒充「位置不可得」。
  const persistence = persistenceStub(
    [
      { type: "turn/start", seq: 1, data: { turn: 3 } },
      { type: "turn/end", seq: 2, data: { turn: 3 } },
    ],
    { throwOnClose: true },
  );
  const result = await readLastTurn({ sessionPersistence: persistence, sessionId: "session-a" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.turn, 3, "位置仍须可取");
  assert.equal(persistence.calls.closed, 1, "关闭仍被尝试执行");
});

test("读取失败：read 缺失或没有 events 数组时如实返回原因（不得当作空历史）", async () => {
  const noRead = await readLastTurn({ sessionPersistence: persistenceStub([], { noRead: true }), sessionId: "s" });
  assert.equal(noRead.ok, false);
  assert.match(noRead.reason, /no events array/);

  const notArray = await readLastTurn({
    sessionPersistence: { open: async () => ({ read: async () => ({ events: "nope" }), close: async () => {} }) },
    sessionId: "s",
  });
  assert.equal(notArray.ok, false);
  assert.match(notArray.reason, /no events array/);
});

test("读取失败：日志里没有任何回合时如实返回原因（不得退化为「覆盖全部内容」）", async () => {
  const result = await readLastTurn({
    sessionPersistence: persistenceStub([{ type: "session", seq: 0, data: {} }]),
    sessionId: "session-a",
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /carries no turn\/start or turn\/end event/);
});

test("服务不可用/未实现：如实返回原因（不抛、不猜）", async () => {
  for (const [persistence, pattern] of [
    [undefined, /sessionPersistence service is unavailable/],
    [null, /sessionPersistence service is unavailable/],
    [{}, /does not expose open\(id, "read"\)/],
  ]) {
    const result = await readLastTurn({ sessionPersistence: persistence, sessionId: "session-a" });
    assert.equal(result.ok, false, `expected failure for ${JSON.stringify(persistence)}`);
    assert.match(result.reason, pattern);
  }
});

test("缺 sessionId：如实返回原因，不去 open 任何会话", async () => {
  const persistence = persistenceStub([]);
  for (const sessionId of [undefined, "", null, 42]) {
    const result = await readLastTurn({ sessionPersistence: persistence, sessionId });
    assert.equal(result.ok, false);
    assert.match(result.reason, /sessionId is required/);
  }
  assert.equal(persistence.calls.open.length, 0);
});
