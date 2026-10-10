// Tests for plugin/lib/friction-window.js —
// 缺陷 D1 的修复：把观察区间的内容**在调度侧机械累积**，并要求子代理逐字引证、
// 由落地侧机械核对（04 §8.4 水位段：切分依据不得是「AI 认为哪些是新的」）。
import { test } from "node:test";
import assert from "node:assert/strict";

import { createWindowAccumulator, verifyQuotation } from "../lib/friction-window.js";

/** 造一个 assistant/message 事件（形状取自宿主 SessionEventMap）。 */
function assistantEvent(turn, blocks) {
  return { type: "assistant/message", data: { turn, step: 1, message: { content: blocks }, stream: [] } };
}

/** 造一个 user/message 事件（载荷是消息体本身，**无 turn 字段**）。 */
function userEvent(blocks) {
  return { type: "user/message", data: { id: "m1", content: blocks, source: { kind: "user" } } };
}

function turnStart(turn) {
  return { type: "turn/start", data: { turn } };
}

// ---------------------------------------------------------------------------
// 累积（只消费已发布事件，不读会话日志）
// ---------------------------------------------------------------------------

test("累积：助手文本按轮次摘出（只取 text 块，与 child.js 同口径）", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(1, [
    { type: "text", text: "第一轮的内容。" },
    { type: "tool-call", id: "c1", name: "bash", arguments: "{}" },
    { type: "text", text: "补充。" },
  ]));
  const w = acc.windowFrom(null);
  assert.equal(w.items.length, 1);
  assert.equal(w.items[0].turn, 1);
  assert.equal(w.items[0].assistant, "第一轮的内容。补充。", "只取 text 块，其余类型不计入");
});

test("累积：用户消息挂到下一轮（user/message 载荷无 turn 字段，是宿主形状）", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, userEvent([{ type: "text", text: "用户的提问" }]));
  acc.observe(null, turnStart(2));
  acc.observe(null, assistantEvent(2, [{ type: "text", text: "助手的回答" }]));

  const w = acc.windowFrom(null);
  const turn2 = w.items.find((i) => i.turn === 2);
  assert.ok(turn2, "第 2 轮须在窗口内");
  assert.equal(turn2.user, "用户的提问");
  assert.equal(turn2.assistant, "助手的回答");
});

test("累积：非预期会话的事件被忽略（多会话共存时不串线）", () => {
  const acc = createWindowAccumulator();
  const other = { id: "other-session" };
  const mine = { id: "mine" };
  acc.observe(other, assistantEvent(1, [{ type: "text", text: "别的会话" }]), mine);
  acc.observe(mine, assistantEvent(2, [{ type: "text", text: "我的会话" }]), mine);

  const w = acc.windowFrom(null);
  assert.equal(w.items.length, 1);
  assert.equal(w.items[0].turn, 2);
  assert.equal(w.items[0].assistant, "我的会话");
});

// ---------------------------------------------------------------------------
// 切分：区间内容由调度侧给出（D1 的核心）
// ---------------------------------------------------------------------------

test("切分：水位之后的内容才进窗口（首次为 null = 覆盖全部既有内容）", () => {
  const acc = createWindowAccumulator();
  for (let t = 1; t <= 5; t += 1) {
    acc.observe(null, assistantEvent(t, [{ type: "text", text: `第 ${t} 轮` }]));
  }
  const first = acc.windowFrom(null);
  assert.deepEqual(first.items.map((i) => i.turn), [1, 2, 3, 4, 5], "首次运行覆盖全部既有内容（否则历史上的反复阻碍永不被发现）");

  const later = acc.windowFrom(3);
  assert.deepEqual(later.items.map((i) => i.turn), [4, 5], "水位之后才算新增");
});

test("切分：返回的是**内容本身**而非坐标（子代理无须自行解释区间）", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(9, [{ type: "text", text: "可被引证的原文。" }]));
  const w = acc.windowFrom(8);
  assert.equal(w.items[0].assistant, "可被引证的原文。");
  assert.ok(!("from" in w) && !("to" in w), "窗口不含区间坐标——它给的是材料，不是让子代理按坐标去猜");
});

test("切分：窗口按轮次升序（引证核对需要稳定的文本序）", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(7, [{ type: "text", text: "七" }]));
  acc.observe(null, assistantEvent(3, [{ type: "text", text: "三" }]));
  acc.observe(null, assistantEvent(5, [{ type: "text", text: "五" }]));
  assert.deepEqual(acc.windowFrom(null).items.map((i) => i.turn), [3, 5, 7]);
});

test("切分：超长轮次被截断并如实标记（截断是有损的，不得静默）", () => {
  const acc = createWindowAccumulator({ maxCharsPerTurn: 10 });
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "0123456789ABCDEF" }]));
  const w = acc.windowFrom(null);
  assert.equal(w.items[0].assistant, "0123456789");
  assert.equal(w.items[0].truncated, true);
  assert.equal(w.truncated, true, "窗口级也须标记，供调用方如实登记");
});

test("切分：容量有界（丢最旧，不无限增长）", () => {
  const acc = createWindowAccumulator({ maxTurns: 3 });
  for (let t = 1; t <= 6; t += 1) acc.observe(null, assistantEvent(t, [{ type: "text", text: `${t}` }]));
  const turns = acc.windowFrom(null).items.map((i) => i.turn);
  assert.deepEqual(turns, [4, 5, 6], "只保留最近 maxTurns 轮");
  assert.equal(acc.highestTurn(), 6);
});

test("累积：reset 清空（会话切换）", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "x" }]));
  acc.reset();
  assert.equal(acc.windowFrom(null).items.length, 0);
  assert.deepEqual(acc.snapshot(), { turns: 0, pendingUser: false });
});

// ---------------------------------------------------------------------------
// 引证核对（D1 的机械判定）
// ---------------------------------------------------------------------------

function windowTextOf(items) {
  return items.map((i) => `[turn ${i.turn}] user: ${i.user}\nassistant: ${i.assistant}`).join("\n\n");
}

test("核对：窗口内的逐字引证通过", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(4, [{ type: "text", text: "这次构建在链接阶段失败了。" }]));
  const w = acc.windowFrom(3);
  const r = verifyQuotation("这次构建在链接阶段失败了。", windowTextOf(w.items));
  assert.ok(r.ok, JSON.stringify(r.error));
});

test("核对：**窗口外的引证被拒**——这是 D1 的机械判定点", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(4, [{ type: "text", text: "仅在窗口内的内容。" }]));
  const w = acc.windowFrom(3);
  // 子代理声称依据某段其实不在本次窗口里的原文（模拟它按自己的理解扩大范围）
  const r = verifyQuotation("这段内容其实发生在很早以前，不在本次区间内。", windowTextOf(w.items));
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/quote_not_in_window");
  assert.match(r.error.message, /outside the observation window/);
});

test("核对：空白差异被归一（换行/多空格不算不同文本）", () => {
  const text = "第一行\n  第二行   有空格";
  const r = verifyQuotation("第一行 第二行 有空格", text);
  assert.ok(r.ok, JSON.stringify(r.error));
});

test("核对：空引证被拒（无引证即无从机械核对）", () => {
  for (const empty of ["", "   ", "\n"]) {
    const r = verifyQuotation(empty, "some window text");
    assert.ok(!r.ok);
    assert.equal(r.error.code, "discovery/quote_missing");
  }
});

test("核对：过短引证被拒（太短不足以确立来源）", () => {
  const r = verifyQuotation("好的", "好的，我这就去做。");
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/quote_too_short");
});

test("核对：不做模糊匹配（相似但不相同即拒——相似度会把它变回语义判断）", () => {
  const r = verifyQuotation("这次构建在链接阶段失败了", "这次构建在链接阶段成功了。");
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/quote_not_in_window");
});

test("核对：空窗口下任何引证都被拒（没给材料就不能有依据）", () => {
  const r = verifyQuotation("我依据某段内容判断", "");
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/quote_not_in_window");
});
