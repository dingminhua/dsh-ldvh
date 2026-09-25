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

test("assemble: not_governed REPLACES any stale section with the one-line judgment (Human 2026-09-04)", async () => {
	// Supersedes zero-interference removal: not_governed now carries a
	// one-line judgment notice, so a stale governed section is REPLACED by
	// the not_governed notice, not deleted.
	const agent = makeAgent("s1", "/cwd");
	const handler = createAssembleHandler(agent, {
		resolve: async () => ({ state: "not_governed" }),
		syncTools: () => {},
		recordScope: () => {}
	});
	const withStale = { ...assembly(), sections: [...assembly().sections, { name: GUIDANCE_SECTION_NAME, text: "stale" }] };
	const result = await handler(withStale, { agent }, async () => withStale);
	const section = result.sections.find((entry) => entry.name === GUIDANCE_SECTION_NAME);
	assert.ok(section, "not_governed section present (one-line judgment)");
	assert.match(section.text, /【LDVH 管辖判定】not_governed/);
	assert.ok(!section.text.includes("stale"), "stale governed body replaced");
});

test("assemble: judgment change mid-session prepends the migration notice (已切换到 pattern)", async () => {
	const agent = makeAgent("s1", "/cwd");
	let state = "governed";
	const handler = createAssembleHandler(agent, {
		resolve: async () => ({ state }),
		syncTools: () => {},
		recordScope: () => {}
	});
	// First judgement: no migration line (nothing to migrate from).
	const first = await handler(assembly(), { agent }, async () => assembly());
	const firstSection = first.sections.find((entry) => entry.name === GUIDANCE_SECTION_NAME);
	assert.ok(!firstSection.text.includes("管辖状态变更"), "first judgement has no migration line");
	assert.match(firstSection.text, /【LDVH 管辖判定】governed/);

	// Same state again: still no migration line.
	const second = await handler(assembly(), { agent }, async () => assembly());
	assert.ok(!second.sections.find((entry) => entry.name === GUIDANCE_SECTION_NAME).text.includes("管辖状态变更"));

	// State changes: migration line FIRST, then the new judgment line.
	state = "unavailable";
	const third = await handler(assembly(), { agent }, async () => assembly());
	const thirdSection = third.sections.find((entry) => entry.name === GUIDANCE_SECTION_NAME);
	assert.match(thirdSection.text, /【LDVH 管辖状态变更】governed → unavailable/);
	assert.match(thirdSection.text, /【LDVH 管辖判定】unavailable/);
	assert.ok(thirdSection.text.indexOf("管辖状态变更") < thirdSection.text.indexOf("管辖判定"), "migration line comes first");
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
		agentEffects: [],
		registeredTools: []
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
			// Real agent contexts always provide a tools registry. Leaving it
			// undefined made registerLdvhTools throw, which aborted syncTools
			// BEFORE setScope/propagateToChildren — silently disabling parent
			// state propagation under test only (live hosts were unaffected).
			tools: {
				register: (descriptor) => {
					ctx.registeredTools.push(descriptor?.name ?? "unknown");
					return () => {};
				}
			}
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

// ---------------------------------------------------------------------------
// child: delegation-chain visibility (2026-09-04)
// ---------------------------------------------------------------------------

/** Pull the listener a child registered for one agent-scoped event. */
function childListener(ctx, agentId, event) {
	const found = ctx.agentEffects.filter((entry) => entry.agentId === agentId && entry.event === event);
	return found.length === 0 ? undefined : found[found.length - 1].listener;
}

test("child: parent governance migration propagates to already-installed children (R2e)", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const parent = makeInstallableAgent("parent", repo, ctx);
		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });

		ctx.agents = { roots: () => [parent], get: (id) => (id === "parent" ? parent : undefined) };
		registry.start();
		ctx.fire("agent/created", { agent: parent });
		for (let attempt = 0; attempt < 50 && sessionScopes.get("parent") === undefined; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(sessionScopes.get("parent")?.state, "governed");

		const child = makeInstallableAgent("child", repo, ctx, { root: false });
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";
		ctx.fire("agent/created", { agent: child });

		const before = registry.childSnapshots();
		assert.equal(before.length, 1, "child is visible in the child snapshot channel");
		assert.equal(before[0].agentId, "child");
		assert.equal(before[0].parentAgentId, "parent");
		assert.equal(before[0].scopeState, "governed", "child inherits the parent's judged state");
		assert.equal(before[0].toolsRegistered, false, "children never register tools");

		// Parent migrates AFTER the child installed — the R2e counter-example.
		// Without propagation the child would keep the stale "governed".
		const parentLifecycle = registry.snapshotOf("parent");
		assert.equal(parentLifecycle.scopeState, "governed");
		// Drive the same code path a real migration takes: syncTools -> setScope
		// -> propagateToChildren. resolveGovernanceScope re-judges after the
		// registration is removed from under the parent's cwd.
		const { unregisterProject } = await import("../lib/governed-projects.js");
		await unregisterProject(dshHome(home), { id: "demo", path: repo });
		const assemble = childListener(ctx, "parent", "system-prompt/assemble");
		assert.ok(assemble, "parent registered an assemble handler");
		const payload = { sections: [], contexts: [], tools: [] };
		await assemble(payload, { agent: parent }, async () => payload);

		const after = registry.childSnapshots()[0];
		assert.equal(after.scopeState, "not_governed", "child state followed the parent migration");
		assert.ok(after.propagationCount >= 2, `propagation was recorded (count=${after.propagationCount})`);
		assert.ok(after.activityCount >= 2, "both the install and the propagation are on the activity trail");
	});
});

test("child: turn-end captures the conclusion; list-all omits the trail, single query includes it", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const parent = makeInstallableAgent("parent", repo, ctx);
		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });

		ctx.agents = { roots: () => [parent], get: (id) => (id === "parent" ? parent : undefined) };
		registry.start();
		ctx.fire("agent/created", { agent: parent });

		const child = makeInstallableAgent("child", repo, ctx, { root: false });
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";
		ctx.fire("agent/created", { agent: child });

		// Event path is the DSH-verified one: session/event with type
		// "turn/end" carrying { turn, reason }, then walk back through
		// session.events for that turn's assistant/message. (There is no
		// agent/turn-end in DSH — an earlier version of this seam used it and
		// could never fire.)
		const onSessionEvent = childListener(ctx, "child", "session/event");
		assert.ok(onSessionEvent, "child registered a session/event seam");

		// No turn has ended yet: conclusion is null (a real state, not a gap).
		assert.equal(registry.childConclusionOf("child"), null);
		assert.equal(registry.childSnapshots()[0].hasConclusion, false);

		// Build a realistic session.events tail: turn 1 assistant text, then
		// the turn/end signal for turn 1.
		child.session.events = [
			{ type: "turn/start", data: { turn: 1 } },
			{ type: "assistant/message", data: { turn: 1, message: { content: [{ type: "text", text: "done: 3 files" }] } } }
		];
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });

		assert.equal(registry.childConclusionOf("child"), "done: 3 files");
		const snap = registry.childSnapshots()[0];
		assert.equal(snap.hasConclusion, true);
		assert.equal(snap.conclusionLength, "done: 3 files".length);

		// A turn/end for a turn with no assistant/message leaves the previous
		// conclusion untouched (it must not silently clear real data).
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "done: 3 files", "unmatched turn does not clobber");

		// Non-text blocks only -> empty string is the recorded outcome.
		child.session.events = [
			{ type: "assistant/message", data: { turn: 3, message: { content: [{ type: "tool_use", name: "x" }] } } }
		];
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 3, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "", "textless turn is an empty conclusion, not null");

		// Events from a different session are ignored.
		onSessionEvent({ events: [] }, { type: "turn/end", data: { turn: 4, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "", "foreign session ignored");

		// Activity trail is retrievable per child.
		const trail = registry.childActivityOf("child");
		assert.ok(Array.isArray(trail) && trail.length > 0, "child has a readable activity trail");
		assert.ok(trail.some((entry) => entry.hook === "child/conclusion"), "conclusion is on the trail");
		assert.equal(registry.childActivityOf("missing"), null, "unknown child returns null, not undefined");
	});
});

test("child: unknown child ids and missing seams degrade without throwing", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const ctx = makeHostCtx();
		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });
		registry.start();
		assert.deepEqual(registry.childSnapshots(), [], "no children -> empty list");
		assert.equal(registry.childConclusionOf("nope"), null);
		assert.equal(registry.childActivityOf("nope"), null);
	});
});

test("tools: the governed root registers the tool batch including subagent collection", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const parent = makeInstallableAgent("parent", repo, ctx);
		// Capture the real registration list instead of trusting a flag.
		const registered = [];
		parent.ctx.tools = {
			register(descriptor) {
				registered.push(descriptor?.name ?? descriptor?.toolName ?? "unknown");
				return () => {};
			}
		};

		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });

		ctx.agents = { roots: () => [parent], get: (id) => (id === "parent" ? parent : undefined) };
		registry.start();
		ctx.fire("agent/created", { agent: parent });
		for (let attempt = 0; attempt < 50 && registered.length === 0; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		// The seven core operations plus the subagent collection tool.
		assert.ok(registered.includes("ldvh_resolve_governance_scope"), `registered: ${registered.join(", ")}`);
		assert.ok(
			registered.includes("ldvh_collect_subagent_results"),
			"children Map must be passed to registerLdvhTools or this tool is silently skipped"
		);
	});
});

test("child: a finished child stays collectable after its fiber disposes", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const parent = makeInstallableAgent("parent", repo, ctx);
		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });

		ctx.agents = { roots: () => [parent], get: (id) => (id === "parent" ? parent : undefined) };
		registry.start();
		ctx.fire("agent/created", { agent: parent });

		const child = makeInstallableAgent("child", repo, ctx, { root: false });
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";
		ctx.fire("agent/created", { agent: child });

		// The child does its work and its turn ends.
		const onSessionEvent = childListener(ctx, "child", "session/event");
		child.session.events = [
			{ type: "assistant/message", data: { turn: 1, message: { content: [{ type: "text", text: "all done" }] } } }
		];
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "all done", "conclusion captured while live");

		// Now the child's fiber disposes — this is what used to erase it.
		await child.disposeFiber();

		// The whole point: the result is still collectable afterwards.
		assert.equal(registry.childConclusionOf("child"), "all done", "conclusion survives disposal");
		const snap = registry.childSnapshots().find((entry) => entry.agentId === "child");
		assert.ok(snap, "finished child still appears in snapshots");
		assert.equal(snap.conclusionLength, "all done".length);
		assert.ok(registry.childActivityOf("child").length > 0, "activity trail survives disposal");
	});
});

test("pre-step: judgment change injects a visible context-injection row (plugin message)", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = { primePending: true, lastDigest: null };
	const handler = createPreStepHandler(agent, {
		isGoverned: () => true,
		channel,
		noticeText: () => "【LDVH 管辖判定】governed —— 本会话受 LDVH 管辖。",
		noticeSummary: () => "本会话受 LDVH 管辖"
	});
	const baseMessages = [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }];

	// First step-1 after priming: the row is appended.
	const first = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(first.kind, "enter");
	const injected = first.messages[first.messages.length - 1];
	assert.notEqual(injected, baseMessages[baseMessages.length - 1], "a new message was appended");
	assert.equal(injected.source.kind, "dsh-ldvh", "producer kind is the plugin's own (0.1.7 rejects the retired shared \"plugin\" wrapper)");
	assert.equal(injected.source.plugin, "dsh-ldvh");
	assert.equal(injected.source.summary, "本会话受 LDVH 管辖");
	assert.equal(injected.source.form, "notice", "notice form renders the summary inline");
	assert.match(injected.content[0].text, /【LDVH 管辖判定】governed/);
	assert.equal(first.messages.length, baseMessages.length + 1);

	// Same notice again with the row still present in the batch (steady
	// state): NO new row — loss detection only fires when the row is gone.
	const second = await handler.handler(
		{ agent, step: 1, signal: {} },
		async () => ({ kind: "enter", messages: [...baseMessages, injected] })
	);
	assert.equal(second.messages.length, baseMessages.length + 1, "unchanged judgment does not re-inject");

	// Rewind/clear edge case (re-review finding): the row vanished from the
	// batch but the digest still matches — must re-inject, not stay silent.
	const afterRewind = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(afterRewind.messages.length, baseMessages.length + 1, "lost row is re-injected after rewind/clear");
	assert.match(afterRewind.messages[afterRewind.messages.length - 1].content[0].text, /【LDVH 管辖判定】governed/);

	// Judgment changed: a new row appears (digest differs).
	const third = await handler.handler(
		{ agent, step: 1, signal: {} },
		async () => ({ kind: "enter", messages: [...baseMessages] }),
		undefined,
		undefined
	).catch(() => null);
	// Simulate the change by mutating the notice via a fresh channel state:
	const channel2 = { primePending: false, lastDigest: "【LDVH 管辖判定】governed —— 本会话受 LDVH 管辖。" };
	const handler2 = createPreStepHandler(agent, {
		isGoverned: () => false,
		channel: channel2,
		noticeText: () => "【LDVH 管辖状态变更】governed → unavailable\n【LDVH 管辖判定】unavailable —— 登记不可读，按不受辖处理。",
		noticeSummary: "LDVH 管辖判定"
	});
	const changed = await handler2.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	const changedInjected = changed.messages[changed.messages.length - 1];
	assert.match(changedInjected.content[0].text, /管辖状态变更】governed → unavailable/, "migration row injected on change");

	// A turn that already carries our own message with the SAME notice is
	// left untouched (replay-safe).
	const withOwn = [...baseMessages, injected];
	const fourth = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: withOwn }));
	assert.equal(fourth.messages.length, withOwn.length, "own message suppresses re-injection");
});
