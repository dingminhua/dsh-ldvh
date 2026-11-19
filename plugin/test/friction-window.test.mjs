import { test } from "node:test";
import assert from "node:assert/strict";

import { createWindowAccumulator } from "../lib/turn-accumulator.js";

function assistantEvent(turn, blocks) {
  return { type: "assistant/message", data: { turn, step: 1, message: { content: blocks }, stream: [] } };
}

function userEvent(blocks) {
  return { type: "user/message", data: { id: "m1", content: blocks, source: { kind: "user" } } };
}

function turnStart(turn) {
  return { type: "turn/start", data: { turn } };
}


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
  assert.deepEqual(acc.snapshot(), { turns: 0, pendingUser: false, firstObservedTurn: null });
});




test("D6：重启后在水位与首见轮次之间检出未观察缺口", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(21, [{ type: "text", text: "装载后的第一段。" }]));
  const w = acc.windowFrom(10);
  assert.deepEqual(w.unobserved, { from: 11, to: 20 }, "缺口须被如实标出，而不是当作区间已覆盖");
  assert.equal(acc.firstObservedTurn(), 21);
});

test("D6：无缺口时 unobserved 为 null（正常连续场景不得误报）", () => {
  const acc = createWindowAccumulator();
  for (let t = 11; t <= 14; t += 1) acc.observe(null, assistantEvent(t, [{ type: "text", text: `${t}` }]));
  const w = acc.windowFrom(10);
  assert.equal(w.unobserved, null, "连续覆盖时不得报缺口");
});

test("D6：首次运行（floor=null）无缺口可言——那正是「覆盖全部既有内容」的语义", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(50, [{ type: "text", text: "第一次运行看到的内容。" }]));
  const w = acc.windowFrom(null);
  assert.equal(w.unobserved, null, "首次运行不设缺口");
});

test("D6：缺口起点恰为首见轮次时不算缺口（紧邻）", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(11, [{ type: "text", text: "紧邻水位之后。" }]));
  assert.equal(acc.windowFrom(10).unobserved, null);
});

test("D6：reset 后首见轮次一并清零（会话切换不得沿用旧缺口基准）", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(9, [{ type: "text", text: "旧会话。" }]));
  acc.reset();
  assert.equal(acc.firstObservedTurn(), null);
  acc.observe(null, assistantEvent(30, [{ type: "text", text: "新会话。" }]));
  assert.equal(acc.firstObservedTurn(), 30);
});

test("D6：容量淘汰不改变「最小已见轮次」这一事实", () => {
  const acc = createWindowAccumulator({ maxTurns: 2 });
  for (let t = 1; t <= 5; t += 1) acc.observe(null, assistantEvent(t, [{ type: "text", text: `${t}` }]));
  assert.equal(acc.firstObservedTurn(), 1, "见过 turn 1 是历史事实，不因缓冲淘汰而改变");
  assert.deepEqual(acc.windowFrom(null).items.map((i) => i.turn), [4, 5]);
});

test("发现②护栏：累积器从未收到任何事件时，缺口必须被报出（上界未知）", () => {
  const acc = createWindowAccumulator();
  const w = acc.windowFrom(31);
  assert.deepEqual(
    w.unobserved,
    { from: 32, to: null },
    "空累积器 + 非空水位 = 整段未观察。不得报 null（那会让空窗口的 no-discovery 推进水位，使内容永不复查）",
  );
  assert.equal(w.items.length, 0);
});

test("发现②护栏：上述情形下不得被当作『区间已完整覆盖且无发现』", () => {
  const acc = createWindowAccumulator();
  const w = acc.windowFrom(31);
  assert.ok(w.unobserved !== null, "有水位却无任何材料，必然存在缺口——判据是『水位 > 0 且未见过任何轮次』");
});


test("一轮内多条 assistant/message 须**累积**，不得只留最后一条", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, turnStart(7));
  acc.observe(null, assistantEvent(7, [{ type: "text", text: "第一步：查了代码。" }]));
  acc.observe(null, assistantEvent(7, [{ type: "text", text: "第二步：改了实现。" }]));
  acc.observe(null, assistantEvent(7, [{ type: "text", text: "第三步：提交完成。" }]));
  const w = acc.windowFrom(-1);
  assert.equal(w.items.length, 1, "同一轮仍只占一个条目");
  const a = w.items[0].assistant;
  assert.ok(a.includes("第一步"), `不得丢掉第一步（实际：${JSON.stringify(a)}）`);
  assert.ok(a.includes("第二步"), "不得丢掉第二步");
  assert.ok(a.includes("第三步"), "最后一步当然也要在");
  assert.ok(a.indexOf("第一步") < a.indexOf("第二步"), "须保持发生顺序");
  assert.ok(a.indexOf("第二步") < a.indexOf("第三步"), "须保持发生顺序");
});

test("空文本的 assistant/message（纯工具调用）**不得抹掉**本轮已有内容", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, turnStart(9));
  acc.observe(null, assistantEvent(9, [{ type: "text", text: "有价值的分析结论。" }]));
  acc.observe(null, assistantEvent(9, [{ type: "tool_use", name: "bash", input: { command: "ls" } }]));
  const w = acc.windowFrom(-1);
  assert.equal(w.items[0].assistant, "有价值的分析结论。", "空消息不得抹掉已有文本");
  assert.notEqual(w.items[0].assistant, "", "不得被清空");
});

test("空消息**在前**、有文本在后：文本仍须入账（两个方向都验）", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, turnStart(11));
  acc.observe(null, assistantEvent(11, [{ type: "tool_use", name: "bash", input: {} }]));
  acc.observe(null, assistantEvent(11, [{ type: "text", text: "迟到的正文。" }]));
  const w = acc.windowFrom(-1);
  assert.equal(w.items[0].assistant, "迟到的正文。");
});

test("累积后仍受单轮上限约束，且**截取前缀**（确定性规则，不做语义取舍）", () => {
  const acc = createWindowAccumulator({ maxCharsPerTurn: 10 });
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "0123456789" }]));
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "ABCDEFGHIJ" }]));
  const w = acc.windowFrom(-1);
  assert.equal(w.items[0].assistant, "0123456789", "须截取前缀（先发生的先留）");
  assert.equal(w.items[0].truncated, true, "须标记截断（提示词据此提醒执行体）");
});

test("截断标记在后续消息到来后仍然为 true（合并只会更满，不会回退）", () => {
  const acc = createWindowAccumulator({ maxCharsPerTurn: 10 });
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "0123456789ABCDEF" }]));
  assert.equal(acc.windowFrom(-1).items[0].truncated, true, "先置起");
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "短" }]));
  const item = acc.windowFrom(-1).items[0];
  assert.equal(item.truncated, true, "截断事实须保留");
  assert.equal(item.assistant, "0123456789", "且仍截取前缀");
});

test("真实形状回归：单轮 25 条消息、其中含空消息，须全部累积且不被清空", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, turnStart(55));
  for (let i = 1; i <= 22; i += 1) {
    acc.observe(null, assistantEvent(55, [{ type: "text", text: `第 ${i} 步的正文。` }]));
  }
  for (let i = 0; i < 3; i += 1) {
    acc.observe(null, assistantEvent(55, [{ type: "tool_use", name: "bash", input: {} }]));
  }
  const a = acc.windowFrom(-1).items[0].assistant;
  assert.notEqual(a, "", "不得被末尾的空消息清空");
  assert.ok(a.includes("第 1 步"), "须含最早的消息");
  assert.ok(a.includes("第 22 步"), "须含最后一条有文本的消息");
});


function blockOfLength(n) {
  return "x".repeat(n);
}

test("默认上限 20000：超过 2000 字的回复完整保留、不标记截断（旧值 2000 会砍掉）", () => {
  const text = blockOfLength(3278);
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(1, [{ type: "text", text }]));
  const w = acc.windowFrom(null);
  assert.equal(w.items[0].assistant.length, 3278, "P50 长度的回复必须逐字完整保留");
  assert.equal(w.items[0].truncated, false, "未超上限不得标记截断");
  assert.equal(w.truncated, false, "窗口级同样不得标记");
});

test("默认上限 20000：接近上限（15772 字，实测最大单轮）仍完整保留", () => {
  const text = blockOfLength(15772);
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(1, [{ type: "text", text }]));
  const w = acc.windowFrom(null);
  assert.equal(w.items[0].assistant.length, 15772, "实测最大值必须完整保留");
  assert.equal(w.items[0].truncated, false);
});

test("默认上限 20000：恰在上限处不截断，超一字符即截断并如实标记", () => {
  const atLimit = createWindowAccumulator();
  atLimit.observe(null, assistantEvent(1, [{ type: "text", text: blockOfLength(20000) }]));
  const at = atLimit.windowFrom(null);
  assert.equal(at.items[0].assistant.length, 20000, "恰好 20000 字完整保留");
  assert.equal(at.items[0].truncated, false, "恰在上限不得标记截断");

  const overLimit = createWindowAccumulator();
  overLimit.observe(null, assistantEvent(1, [{ type: "text", text: blockOfLength(20001) }]));
  const over = overLimit.windowFrom(null);
  assert.equal(over.items[0].assistant.length, 20000, "超出时取前 20000 字");
  assert.equal(over.items[0].truncated, true, "超出 20000 时须如实标记 truncated");
  assert.equal(over.truncated, true, "窗口级也须标记，供调用方如实登记");
});

test("默认上限 20000 不是零损失：超长单轮仍被砍且如实标记（防「等价于全文」的旧结论复发）", () => {
  const overlong = 28048;
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(1, [{ type: "text", text: blockOfLength(overlong) }]));
  const w = acc.windowFrom(null);
  assert.equal(w.items[0].assistant.length, 20000, "超过 20000 的单轮只能保留前 20000 字");
  assert.ok(w.items[0].assistant.length < overlong, "**确实发生了损失**——不得声称上限 20000 等价于全文");
  assert.equal(w.items[0].truncated, true, "损失必须如实标记，不得静默");
});
