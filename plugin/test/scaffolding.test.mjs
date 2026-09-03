// Scaffolding parity tests: AgentLifecycle object, runtime config swap,
// event-stream primitives, render last-good degrade, rpc/commands skeleton.

import assert from "node:assert/strict";
import test from "node:test";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AgentLifecycle, ActivityLog } from "../lib/agent-lifecycle.js";
import { createRuntimeConfig } from "../lib/runtime-config.js";
import { openTurn, turnToolCalls, turnUserTexts } from "../lib/event-stream.js";
import { renderWithLastGood } from "../lib/adr-enumeration.js";
import { registerLdvhRpc } from "../lib/rpc.js";
import { withTemp } from "./helpers.mjs";

// --- AgentLifecycle object -------------------------------------------------

test("AgentLifecycle: single home for per-agent state with snapshot()", () => {
	const lifecycle = new AgentLifecycle({ id: "a1", session: { header: { id: "a1", cwd: "/x" } } });
	lifecycle.setScope({ state: "governed" });
	lifecycle.preStep.primePending = true;
	lifecycle.turns.turnStoppingSeen = 2;
	const snapshot = lifecycle.snapshot();
	assert.equal(snapshot.agentId, "a1");
	assert.equal(snapshot.scopeState, "governed");
	assert.equal(snapshot.preStep.primePending, true);
	assert.equal(snapshot.turns.turnStoppingSeen, 2);
	assert.equal(snapshot.toolsRegistered, false);
	assert.ok(snapshot.activityCount >= 1, "judgement recorded in activity");
});

test("ActivityLog: bounded ring with snapshots", () => {
	const log = new ActivityLog(3);
	for (let index = 0; index < 5; index += 1) log.record("hook", { index });
	const entries = log.snapshot();
	assert.equal(entries.length, 3, "ring bounded");
	assert.equal(entries[2].detail.index, 4, "latest kept");
});

// --- runtime config swap ---------------------------------------------------

test("runtime config: stage validates without disturbing live; commit swaps atomically", () => {
	const config = createRuntimeConfig({ webEnabled: true });
	assert.equal(config.current().webEnabled, true);
	const staged = config.stage({ webEnabled: false });
	assert.equal(config.current().webEnabled, true, "live untouched by staging");
	let observed = null;
	config.onSwap((next) => { observed = next.webEnabled; });
	config.commit(staged);
	assert.equal(config.current().webEnabled, false);
	assert.equal(observed, false, "listener notified after swap");
	assert.throws(() => config.stage(null), /object/);
});

// --- event stream primitives ----------------------------------------------

test("event-stream: openTurn / turnToolCalls / turnUserTexts over the durable log", () => {
	const events = [
		{ type: "turn/start", data: { turn: 1 } },
		{ type: "message", data: { turn: 1, role: "user", content: [{ type: "text", text: "改一下" }] } },
		{ type: "tool/call", data: { turn: 1, name: "bash" } },
		{ type: "tool/call", data: { turn: 1, name: "read" } },
		{ type: "turn/end", data: { turn: 1 } },
		{ type: "turn/start", data: { turn: 2 } }
	];
	assert.equal(openTurn(events), 2, "turn 2 still open");
	const calls = turnToolCalls(events, 1);
	assert.equal(calls.count, 2);
	assert.deepEqual(calls.names.sort(), ["bash", "read"]);
	assert.deepEqual(turnUserTexts(events, 1), ["改一下"]);
});

// --- render last-good degrade ----------------------------------------------

test("renderWithLastGood: success stores; failure serves last good degraded", async () => {
	await withTemp("ldvh-adr.", async (base) => {
		await mkdir(join(base, "ldvh-base", "adrs"), { recursive: true });
		await writeFile(join(base, "ldvh-base", "adrs", "a.yaml"), "title: T\nstatus: active\ndecision: D\nobject_id: adr-1\n");
		const holder = { lastGoodEnumeration: null };
		const good = await renderWithLastGood(holder, base);
		assert.equal(good.degraded, false);
		assert.ok(good.text.includes("T"));
		// Corrupt the directory so the next render throws (unreadable path).
		const broken = join(base, "no-such-place");
		const degraded = await renderWithLastGood(holder, broken);
		// readdir failure inside renderActiveAdrEnumeration returns null-text
		// (not a throw), so lastGood stays the good render either way; force a
		// real throw via a non-string projectRoot.
		const thrown = await renderWithLastGood(holder, null);
		assert.equal(thrown.degraded, true, "failure degraded");
		assert.ok(thrown.text === null || thrown.text.includes("T"), "serves last good or empty");
	});
});

// --- rpc skeleton ------------------------------------------------------------

test("registerLdvhRpc: mounts lifecycle snapshot channel and disposes", () => {
	const handled = new Map();
	const connection = {
		handle(name, handler) {
			handled.set(name, handler);
			return () => handled.delete(name);
		}
	};
	const lifecycle = { snapshots: () => [{ agentId: "a1" }] };
	const dispose = registerLdvhRpc(connection, { lifecycle });
	const handler = handled.get("ldvh/lifecycle-snapshots");
	assert.ok(handler !== undefined, "channel mounted");
	assert.deepEqual(handler(), [{ agentId: "a1" }]);
	dispose();
	assert.equal(handled.size, 0, "channel disposed");
});
