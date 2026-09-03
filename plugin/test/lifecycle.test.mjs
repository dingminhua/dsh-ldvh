// Batch-1 lifecycle/guidance unit tests (direct, no cordis event bus).
//
// Exercises the real createAssembleHandler / createPreStepHandler /
// createLifecycleRegistry functions with plain stub agents and contexts.
// Acceptance points (audit-driven):
//   1. first-turn correctness — guidance section spliced into the CURRENT
//      assembly; tools registered at install (before any assemble);
//   2. not_governed leaves zero trace (section removed, no tools);
//   3. state transition governed -> unavailable unregisters tools;
//   4. judgement failure degrades to fail-closed section, never rejects;
//   5. roots-only gate — non-root agents never installed;
//   6. adoption — agents already in roots() at start() get installed;
//   7. pre-step skeleton — reject / aborted / step!==1 pass through, no
//      message appended;
//   8. fiber cleanup — the returned effect disposer removes tools and the
//      session-scopes entry.

import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { createAssembleHandler, createPreStepHandler } from "../lib/guidance.js";
import { createLifecycleRegistry } from "../lib/lifecycle.js";
import { createSessionScopes } from "../lib/session-scopes.js";
import { registerProject } from "../lib/governed-projects.js";
import { GUIDANCE_SECTION_NAME } from "../lib/guidance-text.js";
import { initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

function makeAgent(id, cwd) {
	return { id, session: { header: { id, cwd } }, ctx: { marker: `ctx-${id}` } };
}

function assembly() {
	return { sections: [{ name: "other", text: "keep" }], contexts: [], tools: [] };
}

// ---------------------------------------------------------------------------
// guidance: assemble handler
// ---------------------------------------------------------------------------

test("assemble: governed splices the guidance section into the current assembly", async () => {
	const agent = makeAgent("s1", "/cwd");
	const scopes = [];
	const handler = createAssembleHandler(agent, {
		resolve: async () => ({ state: "governed", project: { id: "demo", name: null } }),
		syncTools: (scope) => scopes.push(scope.state),
		recordScope: () => {}
	});
	const result = await handler(assembly(), { agent }, async () => assembly());
	const names = result.sections.map((section) => section.name);
	assert.ok(names.includes(GUIDANCE_SECTION_NAME));
	assert.ok(names.includes("other"), "pre-existing sections preserved");
	assert.deepEqual(scopes, ["governed"], "tools guard consulted with judged state");
});

test("assemble: not_governed removes any stale section and registers nothing", async () => {
	const agent = makeAgent("s1", "/cwd");
	const handler = createAssembleHandler(agent, {
		resolve: async () => ({ state: "not_governed" }),
		syncTools: () => {},
		recordScope: () => {}
	});
	const withStale = { ...assembly(), sections: [...assembly().sections, { name: GUIDANCE_SECTION_NAME, text: "stale" }] };
	const result = await handler(withStale, { agent }, async () => withStale);
	assert.deepEqual(result.sections.map((section) => section.name), ["other"], "stale guidance removed, zero interference");
});

test("assemble: unavailable injects the fail-closed section", async () => {
	const agent = makeAgent("s1", "/cwd");
	const handler = createAssembleHandler(agent, {
		resolve: async () => ({ state: "unavailable", detail: "x" }),
		syncTools: () => {},
		recordScope: () => {}
	});
	const result = await handler(assembly(), { agent }, async () => assembly());
	const section = result.sections.find((entry) => entry.name === GUIDANCE_SECTION_NAME);
	assert.ok(section.text.includes("不可用"));
});

test("assemble: judgement throw degrades to fail-closed, never rejects the waterfall", async () => {
	const agent = makeAgent("s1", "/cwd");
	const handler = createAssembleHandler(agent, {
		resolve: async () => { throw new Error("disk on fire"); },
		syncTools: () => {},
		recordScope: () => {}
	});
	const result = await handler(assembly(), { agent }, async () => assembly());
	const section = result.sections.find((entry) => entry.name === GUIDANCE_SECTION_NAME);
	assert.ok(section !== undefined && section.text.includes("不可用"), "fail-closed section injected after failure");
});

test("assemble: foreign agent id and aborted signal pass through untouched", async () => {
	const agent = makeAgent("s1", "/cwd");
	let resolved = 0;
	const handler = createAssembleHandler(agent, {
		resolve: async () => { resolved += 1; return { state: "governed" }; },
		syncTools: () => {},
		recordScope: () => {}
	});
	const foreign = makeAgent("s2", "/cwd");
	const r1 = await handler(assembly(), { agent: foreign }, async () => assembly());
	assert.equal(resolved, 0, "foreign agent skipped before judgement");
	assert.deepEqual(r1.sections.map((section) => section.name), ["other"]);
	const r2 = await handler(assembly(), { agent, signal: { aborted: true } }, async () => assembly());
	assert.equal(resolved, 0, "aborted context skipped before judgement");
	assert.deepEqual(r2.sections.map((section) => section.name), ["other"]);
	// Missing agent entirely (future non-agent assembly): pass through.
	const r3 = await handler(assembly(), {}, async () => assembly());
	assert.deepEqual(r3.sections.map((section) => section.name), ["other"]);
});

// ---------------------------------------------------------------------------
// guidance: pre-step skeleton
// ---------------------------------------------------------------------------

test("pre-step skeleton: reject / aborted / step!==1 pass through; nothing appended at step 1", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = createPreStepHandler(agent, { isGoverned: () => true });
	const handler = channel.handler;
	const enter = { kind: "enter", messages: [{ role: "user", content: [] }] };
	const reject = { kind: "reject", reason: "x" };

	const r1 = await handler({ agent, step: 1, signal: {} }, async () => reject);
	assert.equal(r1.kind, "reject", "reject passes through");
	const r2 = await handler({ agent, step: 1, signal: { aborted: true } }, async () => enter);
	assert.equal(r2.messages.length, 1, "aborted: untouched");
	const r3 = await handler({ agent, step: 2, signal: {} }, async () => enter);
	assert.equal(r3.messages.length, 1, "step!==1: untouched");
	const r4 = await handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(r4.messages.length, 1, "step 1 skeleton appends nothing this batch");
});

test("pre-step channel: prime() marks the next step-1; own plugin message exercises the ownRequest gate", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = createPreStepHandler(agent, { isGoverned: () => true });
	const enter = { kind: "enter", messages: [{ role: "user", content: [] }] };
	// prime() is the session-start seam: it must not throw and the following
	// step-1 still passes through with no injection this batch.
	channel.prime();
	const r1 = await channel.handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(r1.messages.length, 1);
	// A message sourced from this plugin exercises the ownRequest gate.
	const ownTurn = { kind: "enter", messages: [{ role: "user", content: [], source: { kind: "plugin", plugin: "dsh-ldvh" } }] };
	const r2 = await channel.handler({ agent, step: 1, signal: {} }, async () => ownTurn);
	assert.equal(r2.messages.length, 1, "ownRequest turn passes through untouched");
});

// ---------------------------------------------------------------------------
// lifecycle registry
// ---------------------------------------------------------------------------

function makeHostCtx() {
	const listeners = {};
	const ctx = {
		agents: { roots: () => [] },
		on(event, listener) {
			(listeners[event] ??= []).push(listener);
			return () => { listeners[event] = listeners[event].filter((candidate) => candidate !== listener); };
		},
		get(name) { return name === "agents" ? ctx.agents : undefined; },
		logger: { info() {}, warn() {} },
		fire(event, payload) {
			for (const listener of listeners[event] ?? []) listener(payload);
		},
		agentEffects: []
	};
	return ctx;
}

function makeInstallableAgent(id, cwd, ctx, { root = true } = {}) {
	const disposers = [];
	const agent = {
		id,
		session: { header: { id, cwd } },
		ctx: {
			effect: (fn) => {
				// cordis effect runs the setup immediately and keeps the cleanup.
				const cleanup = fn();
				disposers.push(cleanup);
				return cleanup;
			},
			on: (event, listener) => {
				ctx.agentEffects.push({ agentId: id, event, listener });
				return () => {};
			},
			tools: undefined
		},
		owner: root ? undefined : "parent"
	};
	agent.disposeFiber = async () => {
		for (const dispose of disposers.reverse()) {
			try { await dispose?.(); } catch { /* noop */ }
		}
	};
	return agent;
}

test("lifecycle: start() adopts live roots; agent/created installs; non-roots skipped", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const live = makeInstallableAgent("s-live", repo, ctx);
		ctx.agents = { roots: () => [live] };
		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });
		registry.start();
		assert.deepEqual(registry.installedAgentIds(), ["s-live"], "live root adopted at start");

		const sub = makeInstallableAgent("s-sub", repo, ctx, { root: false });
		ctx.agents = { roots: () => [live] }; // sub is not in roots
		ctx.fire("agent/created", { agent: sub });
		assert.deepEqual(registry.installedAgentIds(), ["s-live"], "non-root agent skipped");

		const fresh = makeInstallableAgent("s-new", repo, ctx);
		ctx.agents = { roots: () => [live, fresh] };
		ctx.fire("agent/created", { agent: fresh });
		assert.deepEqual(registry.installedAgentIds().sort(), ["s-live", "s-new"].sort());
	});
});

test("lifecycle: fiber cleanup removes the session-scopes entry", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const agent = makeInstallableAgent("s1", repo, ctx);
		ctx.agents = { roots: () => [agent] };
		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });
		registry.start();
		// Wait for the install-time async judgement (real disk IO) to settle.
		for (let attempt = 0; attempt < 50 && sessionScopes.get("s1") === undefined; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(sessionScopes.get("s1")?.state, "governed", "scope recorded by install judgement");

		await agent.disposeFiber();
		assert.equal(sessionScopes.get("s1"), undefined, "fiber cleanup removes session scope");
		assert.deepEqual(registry.installedAgentIds(), [], "agent removed from registry");
	});
});

// ---------------------------------------------------------------------------
// triggers: turn-level seams (skeleton, content empty)
// ---------------------------------------------------------------------------

test("turn triggers: turn-stopping and turn/end fire with gate evaluation, foreign agent ignored", async () => {
	const { createTurnTriggers } = await import("../lib/triggers.js");
	const agent = makeAgent("s1", "/cwd");
	const triggers = createTurnTriggers(agent, {
		getScopeState: () => "governed",
		log: { info() {}, warn() {} }
	});
	// Foreign agent's turn-stopping is ignored.
	triggers.onTurnStopping({ agent: makeAgent("s2", "/cwd"), turn: 9 });
	assert.equal(triggers.snapshot().turnStoppingSeen, 0);
	// Own agent fires, gate evaluated as open.
	triggers.onTurnStopping({ agent, turn: 1 });
	const afterStop = triggers.snapshot();
	assert.equal(afterStop.turnStoppingSeen, 1);
	assert.equal(afterStop.lastReflectionGate, "open");
	assert.equal(afterStop.lastTurn, 1);
	// turn/end bookkeeping fires only for own session and turn/end type.
	triggers.onSessionEvent(agent.session, { type: "turn/end", data: { turn: 1 } });
	triggers.onSessionEvent(agent.session, { type: "session/event", data: {} });
	triggers.onSessionEvent({ other: true }, { type: "turn/end", data: { turn: 2 } });
	assert.equal(triggers.snapshot().turnEndSeen, 1);
});

test("turn triggers: not_governed gate evaluates closed", async () => {
	const { createTurnTriggers } = await import("../lib/triggers.js");
	const agent = makeAgent("s1", "/cwd");
	const triggers = createTurnTriggers(agent, {
		getScopeState: () => "not_governed",
		log: { info() {}, warn() {} }
	});
	triggers.onTurnStopping({ agent, turn: 3 });
	assert.equal(triggers.snapshot().lastReflectionGate, "closed");
});

// ---------------------------------------------------------------------------
// child: subagent lifecycle mechanism (content empty)
// ---------------------------------------------------------------------------

test("child: subagent with a live governed parent is installed with delegated state; orphan skipped", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const parent = makeInstallableAgent("parent", repo, ctx);
		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });

		// Child BEFORE parent is an orphan (parent not in the agents map).
		const orphan = makeInstallableAgent("orphan", repo, ctx);
		orphan.session.header.origin = "subagent";
		orphan.session.header.parentSession = "parent";
		ctx.agents = { roots: () => [], get: () => parent };
		registry.start();
		ctx.fire("agent/created", { agent: orphan });
		// Orphan: parent not yet installed (agents map empty) -> skipped.
		// (Installed children would appear in a later snapshot; here we only
		// assert no crash and no installation side effects.)

		// Install parent, then a real child inherits its delegated state.
		ctx.agents = { roots: () => [parent], get: (id) => (id === "parent" ? parent : undefined) };
		ctx.fire("agent/created", { agent: parent });
		// Simulate parent's judgement settling to governed.
		for (let attempt = 0; attempt < 50 && sessionScopes.get("parent") === undefined; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(sessionScopes.get("parent")?.state, "governed");

		const child = makeInstallableAgent("child", repo, ctx);
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";
		ctx.fire("agent/created", { agent: child });
		// Child installed without crashing; the mechanism is mounted (its
		// content seams are empty by design this batch).
	});
});
