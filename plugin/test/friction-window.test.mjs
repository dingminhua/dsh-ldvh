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
  assert.deepEqual(acc.snapshot(), { turns: 0, pendingUser: false, firstObservedTurn: null });
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

// ---------------------------------------------------------------------------
// 缺陷 D6：水位跨进程持久化，而累积器随进程存活 → 重启后区间可能有缺口
//
// 形态：宿主重启后累积器从空开始，水位仍是从前那次的值。若放行，该次运行的
// 「no-discovery」会让水位推进越过**本进程从未观察**的那段，使其永久不被观察
// （宿主只发布事件、不回放；本模块按 §8.4 纪律不读会话日志）。
// ---------------------------------------------------------------------------

test("D6：重启后在水位与首见轮次之间检出未观察缺口", () => {
  const acc = createWindowAccumulator();
  // 模拟：进程重启后只看到 turn 21 起的内容，而水位说应从 turn 11 起覆盖
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
  // 本进程什么都没看到，而水位要求从 32 起覆盖 —— 这正是「刚重启/事件流未达」
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

// ---------------------------------------------------------------------------
// 一轮之内有多条 assistant/message（2026-10-11 修复）
// ---------------------------------------------------------------------------
//
// 宿主把**每一次** assistant 输出都发成一条 `assistant/message`——一轮里有多少个
// assistant 步骤就有多少条，步间还夹着工具调用。用真实会话实测：1411 条分布在
// 55 轮，单轮最多 147 条。
//
// 修复前每条**覆盖**前一条，于是整轮只剩最后一条。两个后果都实测到过（见下两条
// 测试各自的注释）。这两条是**同一根因**的两面：把「一条消息」当成了「整轮正文」。

test("一轮内多条 assistant/message 须**累积**，不得只留最后一条", () => {
  const acc = createWindowAccumulator();
  acc.observe(null, turnStart(7));
  acc.observe(null, assistantEvent(7, [{ type: "text", text: "第一步：查了代码。" }]));
  acc.observe(null, assistantEvent(7, [{ type: "text", text: "第二步：改了实现。" }]));
  acc.observe(null, assistantEvent(7, [{ type: "text", text: "第三步：提交完成。" }]));
  const w = acc.windowFrom(-1);
  assert.equal(w.items.length, 1, "同一轮仍只占一个条目");
  // 三条**都在**（修复前只剩「第三步」一条）。
  const a = w.items[0].assistant;
  assert.ok(a.includes("第一步"), `不得丢掉第一步（实际：${JSON.stringify(a)}）`);
  assert.ok(a.includes("第二步"), "不得丢掉第二步");
  assert.ok(a.includes("第三步"), "最后一步当然也要在");
  // 顺序须是发生序（它决定 clamp 截取哪一段前缀）。
  assert.ok(a.indexOf("第一步") < a.indexOf("第二步"), "须保持发生顺序");
  assert.ok(a.indexOf("第二步") < a.indexOf("第三步"), "须保持发生顺序");
});

test("空文本的 assistant/message（纯工具调用）**不得抹掉**本轮已有内容", () => {
  // 实测：22% 的 assistant/message 没有 text 块（纯工具调用）。修复前轮到这类
  // 消息时 `clipped` 为空串，写入即把该轮已累积的 assistant 文本清空——本会话
  // 的 turn 55 因此变空（25 条消息、1531 字可用，最后剩 31 字，且被清成空）。
  const acc = createWindowAccumulator();
  acc.observe(null, turnStart(9));
  acc.observe(null, assistantEvent(9, [{ type: "text", text: "有价值的分析结论。" }]));
  // 纯工具调用：content 里没有 text 块。
  acc.observe(null, assistantEvent(9, [{ type: "tool_use", name: "bash", input: { command: "ls" } }]));
  const w = acc.windowFrom(-1);
  assert.equal(w.items[0].assistant, "有价值的分析结论。", "空消息不得抹掉已有文本");
  // 且不得因此把条目变成空的。
  assert.notEqual(w.items[0].assistant, "", "不得被清空");
});

test("空消息**在前**、有文本在后：文本仍须入账（两个方向都验）", () => {
  // 上面那条验的是「有文本 → 空消息」。这条验反序「空消息 → 有文本」，
  // 确保修复不是靠「只在非空时写」这种碰巧成立。
  const acc = createWindowAccumulator();
  acc.observe(null, turnStart(11));
  acc.observe(null, assistantEvent(11, [{ type: "tool_use", name: "bash", input: {} }]));
  acc.observe(null, assistantEvent(11, [{ type: "text", text: "迟到的正文。" }]));
  const w = acc.windowFrom(-1);
  assert.equal(w.items[0].assistant, "迟到的正文。");
});

test("累积后仍受单轮上限约束，且**截取前缀**（确定性规则，不做语义取舍）", () => {
  // 04 §8.4 禁止让切分依据落在 AI 判断上，故「保留哪一段」必须是**确定性**规则。
  // 这里取前缀（按发生顺序），与 clamp 既有语义 `slice(0, max)` 一致。
  const acc = createWindowAccumulator({ maxCharsPerTurn: 10 });
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "0123456789" }]));
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "ABCDEFGHIJ" }]));
  const w = acc.windowFrom(-1);
  assert.equal(w.items[0].assistant, "0123456789", "须截取前缀（先发生的先留）");
  assert.equal(w.items[0].truncated, true, "须标记截断（提示词据此提醒执行体）");
});

test("截断标记在后续消息到来后仍然为 true（合并只会更满，不会回退）", () => {
  // 注：此测试**不是**在守护「只升不降」那种防御——累积语义下合并文本只增不减，
  // `clamp` 是 `slice(0, max)`，故 truncated 不可能由 true 翻回 false（曾写过一个
  // `|| previous.truncated` 的保护，实测**无法用任何测试区分**，属不可达代码，
  // 已删除）。本测试守的是更弱但真实的一条：**截断事实不得丢失**——材料被截过就
  // 必须一直标着，否则提示词里的截断提醒不再出现，执行体会以为看全了。
  const acc = createWindowAccumulator({ maxCharsPerTurn: 10 });
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "0123456789ABCDEF" }]));  // 触发截断
  assert.equal(acc.windowFrom(-1).items[0].truncated, true, "先置起");
  acc.observe(null, assistantEvent(1, [{ type: "text", text: "短" }]));                 // 后续消息
  const item = acc.windowFrom(-1).items[0];
  assert.equal(item.truncated, true, "截断事实须保留");
  assert.equal(item.assistant, "0123456789", "且仍截取前缀");
});

test("跨消息引证可被核对（拼接分隔符须已被 normalize 折叠）", () => {
  // 消息之间以空行相隔。`verifyQuotation` 的 normalize 把连续空白折成单个空格，
  // 故跨消息的引文仍可核对——这个性质必须成立，否则「累积」会让引证更容易被拒。
  const acc = createWindowAccumulator();
  acc.observe(null, assistantEvent(3, [{ type: "text", text: "前半句，" }]));
  acc.observe(null, assistantEvent(3, [{ type: "text", text: "后半句。" }]));
  const w = acc.windowFrom(-1);
  const body = w.items.map((i) => i.assistant).join("\n");
  // 跨两条消息的引证（含拼接处的换行）。
  const r = verifyQuotation("前半句， 后半句。", body);
  assert.equal(r.ok, true, `跨消息引证应可核对（实际：${JSON.stringify(r.error)}）`);
});

test("真实形状回归：单轮 25 条消息、其中含空消息，须全部累积且不被清空", () => {
  // 复现本会话 turn 55 的形状（25 条、末几条为空文本的纯工具调用）。
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
