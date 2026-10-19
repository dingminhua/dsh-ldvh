// child-session-record.js unit tests (2026-10-18 「子代理登记表被清空」 修复 · 步骤 3).
//
// The module is the durable half of the child registry: it answers「这个 id 是不是
// 本会话派出的隔离子代理，它的结论是什么」from the child's own session record, for
// children the live registry can no longer see (they finished before a plugin
// rebuild). These tests pin the four things the review channel depends on:
//
//   1. identity comes from the header the HOST wrote (origin: "subagent");
//   2. lineage comes from parentSession, walked upward — a session from an
//      unrelated conversation can never be cited as this caller's reviewer;
//   3. the conclusion is the child's OWN last text (a text-less final turn never
//      clears an earlier real product — same rule as child.js live capture);
//   4. every failure is a stated reason, never a weaker substitute (00 §5.6).

import assert from "node:assert/strict";
import test from "node:test";
import { resolveChildFromSessionRecord } from "../lib/child-session-record.js";

/** Host-shaped stub: open(id, "read") → handle with read()/close(). */
function stubPersistence(sessions, opened = []) {
	return {
		async open(id, mode) {
			opened.push({ id, mode });
			if (sessions[id] === undefined) throw new Error(`no such session: ${id}`);
			return {
				read: async () => ({ events: sessions[id] }),
				close: async () => { opened.push({ id, closed: true }); }
			};
		}
	};
}

const subagentHeader = (id, parentSession, extra = {}) => ({
	type: "session", version: 4, id, cwd: "/repo",
	parentSession, origin: "subagent", delegationDepth: 1,
	createdAt: 1792306316104, ...extra
});

const text = (seq, turn, body) => ({
	type: "assistant/message", seq,
	data: { turn, message: { content: [{ type: "text", text: body }] } }
});

const toolOnly = (seq, turn) => ({
	type: "assistant/message", seq,
	data: { turn, message: { content: [{ type: "tool-call", name: "bash" }] } }
});

// A handle shaped the way the REAL host shapes it (measured 2026-10-19 against a
// live reviewer record): the session header lives on the HANDLE — `handle.header` —
// while `handle.read()` returns body events only, with no `type: "session"` line.
// The stub above keeps the older shape on purpose (both must resolve); this one
// pins the actual host, which is the shape that silently broke the review channel.
function hostShapedPersistence(sessions, opened = []) {
	return {
		async open(id, mode) {
			opened.push({ id, mode });
			if (sessions[id] === undefined) throw new Error(`no such session: ${id}`);
			const all = sessions[id];
			const header = all.find((event) => event?.type === "session") ?? null;
			return {
				header,
				read: async () => ({ events: all.filter((event) => event?.type !== "session") }),
				close: async () => { opened.push({ id, closed: true }); }
			};
		}
	};
}

test("resolve: the real host puts the header on the HANDLE, not in the events array", async () => {
	// Regression: the reviewer channel reported every finished child as
	// 「carries no session header」 against the live host, because the header was
	// searched for inside `read()`'s events. It is a handle property.
	const opened = [];
	const sessions = {
		"reviewer-1": [
			subagentHeader("reviewer-1", "session-parent"),
			text(5, 1, "复核结论：needs_revision。")
		]
	};
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: hostShapedPersistence(sessions, opened),
		childId: "reviewer-1",
		parentSessionId: "session-parent"
	});
	assert.equal(resolved.ok, true, JSON.stringify(resolved));
	assert.equal(resolved.header.id, "reviewer-1");
	assert.equal(resolved.header.origin, "subagent");
	assert.equal(resolved.conclusion, "复核结论：needs_revision。");
	assert.deepEqual(resolved.ancestry, ["session-parent"]);
});

test("resolve: a direct subagent resolves with its own last text as the conclusion", async () => {
	const opened = [];
	const sessions = {
		"reviewer-1": [
			subagentHeader("reviewer-1", "session-parent"),
			toolOnly(3, 1),
			text(5, 1, "第一轮的真实产出。"),
			// 最后一轮只有工具调用：空值不得清掉既有结论。
			toolOnly(9, 2)
		]
	};
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence(sessions, opened),
		childId: "reviewer-1",
		parentSessionId: "session-parent"
	});
	assert.equal(resolved.ok, true, JSON.stringify(resolved));
	assert.equal(resolved.header.id, "reviewer-1");
	assert.equal(resolved.conclusion, "第一轮的真实产出。");
	assert.deepEqual(resolved.ancestry, ["session-parent"]);
	assert.equal(opened.every((entry) => entry.mode === "read" || entry.closed === true), true,
		`只读打开且句柄关闭：${JSON.stringify(opened)}`);
});

test("resolve: the conclusion is the highest-seq text even when the backend returns events out of order", async () => {
	const sessions = {
		"reviewer-1": [
			subagentHeader("reviewer-1", "session-parent"),
			text(9, 2, "后一轮。"),
			text(5, 1, "前一轮。")
		]
	};
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence(sessions),
		childId: "reviewer-1"
	});
	assert.equal(resolved.ok, true, JSON.stringify(resolved));
	assert.equal(resolved.conclusion, "后一轮。", "按 seq 取值，不依赖事件顺序");
});

test("resolve: a nested reviewer (delegationDepth ≥ 2) is accepted by walking the lineage", async () => {
	const sessions = {
		"reviewer-deep": [
			subagentHeader("reviewer-deep", "reviewer-mid"),
			text(4, 1, "深层复核结论。")
		],
		"reviewer-mid": [subagentHeader("reviewer-mid", "session-parent")]
	};
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence(sessions),
		childId: "reviewer-deep",
		parentSessionId: "session-parent"
	});
	assert.equal(resolved.ok, true, JSON.stringify(resolved));
	assert.deepEqual(resolved.ancestry, ["reviewer-mid", "session-parent"], "血统链逐步上行");
});

test("resolve: an ordinary (non-subagent) session is refused, naming what the header said", async () => {
	const sessions = { "session-other": [{ type: "session", id: "session-other", cwd: "/repo" }] };
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence(sessions),
		childId: "session-other",
		parentSessionId: "session-parent"
	});
	assert.equal(resolved.ok, false);
	assert.match(resolved.reason, /not created as a subagent/);
	assert.match(resolved.reason, /origin: null/, "原因须如实报告 header 里实际有什么");
});

test("resolve: a subagent of an UNRELATED session is refused with the chain it walked", async () => {
	const sessions = {
		"reviewer-2": [subagentHeader("reviewer-2", "session-unrelated"), text(3, 1, "别人的子代理。")],
		"session-unrelated": [{ type: "session", id: "session-unrelated", cwd: "/repo" }]
	};
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence(sessions),
		childId: "reviewer-2",
		parentSessionId: "session-parent"
	});
	assert.equal(resolved.ok, false, JSON.stringify(resolved));
	assert.match(resolved.reason, /delegation lineage does not reach session-parent/);
	assert.match(resolved.reason, /session-unrelated/, "链上走到哪里要报告出来");
});

test("resolve: lineage is bounded — a chain longer than the hop budget is refused, not walked forever", async () => {
	const sessions = {
		"reviewer-deep": [subagentHeader("reviewer-deep", "mid-1"), text(4, 1, "x")],
		"mid-1": [subagentHeader("mid-1", "mid-2")],
		"mid-2": [subagentHeader("mid-2", "session-parent")]
	};
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence(sessions),
		childId: "reviewer-deep",
		parentSessionId: "session-parent",
		maxAncestors: 1
	});
	assert.equal(resolved.ok, false, JSON.stringify(resolved));
	assert.match(resolved.reason, /within 1 hop/);
});

test("resolve: a backend without open(id,'read') fails closed with a reason, not a weaker source", async () => {
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: { locate: () => null },
		childId: "reviewer-1",
		parentSessionId: "session-parent"
	});
	assert.equal(resolved.ok, false);
	assert.match(resolved.reason, /does not expose open/);
});

test("resolve: an unreadable session and a headerless session are both reported, never invented", async () => {
	const missing = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence({}),
		childId: "reviewer-gone",
		parentSessionId: "session-parent"
	});
	assert.equal(missing.ok, false);
	assert.match(missing.reason, /child session reviewer-gone unreadable/);

	const headerless = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence({ "reviewer-1": [text(1, 1, "无头的事件流")] }),
		childId: "reviewer-1",
		parentSessionId: "session-parent"
	});
	assert.equal(headerless.ok, false);
	assert.match(headerless.reason, /carries no session header/);
});

test("resolve: without a caller session id only「是子代理」is established, not「是谁的」（documented boundary）", async () => {
	const sessions = { "reviewer-2": [subagentHeader("reviewer-2", "session-unrelated"), text(3, 1, "别人的子代理。")] };
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence(sessions),
		childId: "reviewer-2"
	});
	assert.equal(resolved.ok, true, "无调用方 id 时不检查血统——调用方必须给出 id 才能取得该保证");
	assert.deepEqual(resolved.ancestry, [], "未检查血统时 ancestry 为空，不假装检查过");
});

test("resolve: no child id at all is refused before any read", async () => {
	const opened = [];
	const resolved = await resolveChildFromSessionRecord({
		sessionPersistence: stubPersistence({}, opened),
		childId: "   "
	});
	assert.equal(resolved.ok, false);
	assert.match(resolved.reason, /no child session id/);
	assert.deepEqual(opened, [], "空 id 不得触发任何读盘");
});
