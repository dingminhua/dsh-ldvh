
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { createAssembleHandler, createPreStepHandler } from "../lib/guidance.js";
import { createLifecycleRegistry } from "../lib/lifecycle.js";
import { createSessionScopes } from "../lib/session-scopes.js";
import { registerProject } from "../lib/governed-projects.js";
import { registerSubagentResultTool } from "../lib/subagent-result.js";
import { GUIDANCE_SECTION_NAME } from "../lib/guidance-text.js";
import { initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

function makeAgent(id, cwd) {
	return { id, session: { header: { id, cwd } }, ctx: { marker: `ctx-${id}` } };
}

function assembly() {
	return { sections: [{ name: "other", text: "keep" }], contexts: [], tools: [] };
}


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
	const first = await handler(assembly(), { agent }, async () => assembly());
	const firstSection = first.sections.find((entry) => entry.name === GUIDANCE_SECTION_NAME);
	assert.ok(!firstSection.text.includes("管辖状态变更"), "first judgement has no migration line");
	assert.match(firstSection.text, /【LDVH 管辖判定】governed/);

	const second = await handler(assembly(), { agent }, async () => assembly());
	assert.ok(!second.sections.find((entry) => entry.name === GUIDANCE_SECTION_NAME).text.includes("管辖状态变更"));

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
	const r3 = await handler(assembly(), {}, async () => assembly());
	assert.deepEqual(r3.sections.map((section) => section.name), ["other"]);
});


test("assemble: 每次装配都挂上体量体检报告（漂移不阻断，但报告恒在场）", async () => {
	const agent = makeAgent("s1", "/cwd");
	const scopes = [];
	const handler = createAssembleHandler(agent, {
		resolve: async () => ({ state: "governed" }),
		syncTools: () => {},
		recordScope: (scope) => scopes.push(scope)
	});
	const result = await handler(assembly(), { agent }, async () => assembly());
	assert.equal(scopes.length, 1, "scope 被记录一次");
	const scope = scopes[0];
	assert.ok(scope.guidanceSizeReport !== undefined, "体量体检报告须恒在场");
	assert.equal(scope.guidanceSizeReport.state, "governed");
	assert.equal(scope.guidanceSizeReport.ok, true);
	assert.ok(scope.guidanceSizeReport.budget > 0, "预算须为正");
	assert.equal(typeof scope.guidanceSizeReport.drifted, "boolean");
	assert.equal(typeof scope.guidanceSizeReport.withinEarlyWarning, "boolean");
	assert.ok(result.sections.some((section) => section.name === GUIDANCE_SECTION_NAME));
});

test("assemble: 体量体检报告与注入文本同源（不另算一份长度）", async () => {
	const agent = makeAgent("s1", "/cwd");
	const scopes = [];
	const handler = createAssembleHandler(agent, {
		resolve: async () => ({ state: "governed" }),
		syncTools: () => {},
		recordScope: (scope) => scopes.push(scope)
	});
	const result = await handler(assembly(), { agent }, async () => assembly());
	const section = result.sections.find((entry) => entry.name === GUIDANCE_SECTION_NAME);
	assert.equal(scopes[0].guidanceSizeReport.length, section.text.length, "报告长度须等于实际注入文本长度");
});


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
	channel.prime();
	const r1 = await channel.handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(r1.messages.length, 1);
	const ownTurn = { kind: "enter", messages: [{ role: "user", content: [], source: { kind: "plugin", plugin: "dsh-ldvh" } }] };
	const r2 = await channel.handler({ agent, step: 1, signal: {} }, async () => ownTurn);
	assert.equal(r2.messages.length, 1, "ownRequest turn passes through untouched");
});


function makeHostCtx(services = {}) {
	const listeners = {};
	const ctx = {
		agents: { roots: () => [] },
		on(event, listener) {
			(listeners[event] ??= []).push(listener);
			return () => { listeners[event] = listeners[event].filter((candidate) => candidate !== listener); };
		},
		get(name) { return name === "agents" ? ctx.agents : services[name]; },
		logger: { info() {}, warn() {} },
		fire(event, payload) {
			for (const listener of listeners[event] ?? []) listener(payload);
		},
		agentEffects: [],
		registeredTools: [],
		registeredDescriptors: new Map()
	};
	return ctx;
}

function makeInstallableAgent(id, cwd, ctx, { root = true, origin, parentSession, isSeeded, delegationDepth } = {}) {
	const disposers = [];
	const header = { id, cwd };
	if (origin !== undefined) header.origin = origin;
	if (parentSession !== undefined) header.parentSession = parentSession;
	if (isSeeded !== undefined) header.isSeeded = isSeeded;
	if (delegationDepth !== undefined) header.delegationDepth = delegationDepth;
	const agent = {
		id,
		session: { header },
		ctx: {
			effect: (fn) => {
				const cleanup = fn();
				disposers.push(cleanup);
				return cleanup;
			},
			on: (event, listener) => {
				ctx.agentEffects.push({ agentId: id, event, listener });
				return () => {};
			},
			tools: {
				register: (descriptor) => {
					ctx.registeredTools.push(descriptor?.name ?? "unknown");
					if (descriptor?.name !== undefined) ctx.registeredDescriptors.set(descriptor.name, descriptor);
					return () => {};
				}
			}
		},
		owner: root ? undefined : "parent"
	};
	agent.disposeFiber = async () => {
		for (const dispose of disposers.reverse()) {
			try { await dispose?.(); } catch {   }
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
		ctx.agents = { roots: () => [live] };
		ctx.fire("agent/created", { agent: sub });
		assert.deepEqual(registry.installedAgentIds(), ["s-live"], "non-root agent skipped");

		const fresh = makeInstallableAgent("s-new", repo, ctx);
		ctx.agents = { roots: () => [live, fresh] };
		ctx.fire("agent/created", { agent: fresh });
		assert.deepEqual(registry.installedAgentIds().sort(), ["s-live", "s-new"].sort());
	});
});

test("lifecycle: 子代理按 parentSession 识别——origin 缺失的宿主上仍须走 child 路径", async () => {
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
		assert.deepEqual(registry.installedAgentIds(), ["s-live"], "根会话照常 install 在前");

		const sub = makeInstallableAgent("s-sub-ps", repo, ctx, { parentSession: "s-live" });
		ctx.agents = { roots: () => [live, sub], get: () => live };
		ctx.fire("agent/created", { agent: sub });
		assert.deepEqual(
			registry.installedAgentIds(),
			["s-live"],
			"有 parentSession 者即使被算作 root，也不得被 install（否则它会挂上 idle 检查点并再派生）",
		);
		assert.deepEqual(
			registry.childSnapshots().map((c) => c.agentId),
			["s-sub-ps"],
			"而应走 child 路径",
		);

		const subByOrigin = makeInstallableAgent("s-sub-origin", repo, ctx, { origin: "subagent" });
		ctx.agents = { roots: () => [live, subByOrigin], get: () => live };
		ctx.fire("agent/created", { agent: subByOrigin });
		assert.deepEqual(registry.installedAgentIds(), ["s-live"], "origin 判据仍单独生效");

		const blank = makeInstallableAgent("s-blank", repo, ctx, { parentSession: "   " });
		ctx.agents = { roots: () => [live, blank] };
		ctx.fire("agent/created", { agent: blank });
		assert.ok(
			registry.installedAgentIds().includes("s-blank"),
			"纯空白的 parentSession 不得被当作子代理（否则根会话会被误拦）",
		);
	});
});

test("lifecycle: 种子根会话（fork/continue）带 parentSession 仍须走 root 路径", async () => {
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
		assert.deepEqual(registry.installedAgentIds(), ["s-live"], "根会话照常 install 在前");

		const seededRoot = makeInstallableAgent("s-seeded-root", repo, ctx, {
			parentSession: "s-a-previous-session-not-live",
			isSeeded: true,
			delegationDepth: 0,
		});
		ctx.agents = { roots: () => [live, seededRoot], get: () => undefined };
		ctx.fire("agent/created", { agent: seededRoot });
		assert.ok(
			registry.installedAgentIds().includes("s-seeded-root"),
			"种子根会话必须被 install——否则它永久没有 ldvh_* 工具",
		);
		assert.deepEqual(registry.childSnapshots().map((c) => c.agentId), [], "且不得被登记为子代理");

		const seededChild = makeInstallableAgent("s-seeded-child", repo, ctx, {
			parentSession: "s-live",
			isSeeded: true,
			delegationDepth: 1,
		});
		ctx.agents = { roots: () => [live, seededRoot, seededChild], get: () => live };
		ctx.fire("agent/created", { agent: seededChild });
		assert.deepEqual(registry.childSnapshots().map((c) => c.agentId), ["s-seeded-child"], "depth≥1 仍走 child");

		const legacy = makeInstallableAgent("s-legacy-ps", repo, ctx, { parentSession: "s-live" });
		ctx.agents = { roots: () => [live, seededRoot, legacy], get: () => live };
		ctx.fire("agent/created", { agent: legacy });
		assert.ok(
			registry.childSnapshots().map((c) => c.agentId).includes("s-legacy-ps"),
			"缺 delegationDepth 的旧宿主上不得回退为 install（会重引 2026-10-11 子代理自派生）",
		);
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
		for (let attempt = 0; attempt < 50 && sessionScopes.get("s1") === undefined; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(sessionScopes.get("s1")?.state, "governed", "scope recorded by install judgement");

		await agent.disposeFiber();
		assert.equal(sessionScopes.get("s1"), undefined, "fiber cleanup removes session scope");
		assert.deepEqual(registry.installedAgentIds(), [], "agent removed from registry");
	});
});


test("turn triggers: turn-stopping and turn/end fire with gate evaluation, foreign agent ignored", async () => {
	const { createTurnTriggers } = await import("../lib/triggers.js");
	const agent = makeAgent("s1", "/cwd");
	const triggers = createTurnTriggers(agent, {
		getScopeState: () => "governed",
		log: { info() {}, warn() {} }
	});
	triggers.onTurnStopping({ agent: makeAgent("s2", "/cwd"), turn: 9 });
	assert.equal(triggers.snapshot().turnStoppingSeen, 0);
	triggers.onTurnStopping({ agent, turn: 1 });
	const afterStop = triggers.snapshot();
	assert.equal(afterStop.turnStoppingSeen, 1);
	assert.equal(afterStop.lastReflectionGate, "open");
	assert.equal(afterStop.lastTurn, 1);
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


test("child: subagent with a live governed parent is installed with delegated state; orphan skipped", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const parent = makeInstallableAgent("parent", repo, ctx);
		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });

		const orphan = makeInstallableAgent("orphan", repo, ctx);
		orphan.session.header.origin = "subagent";
		orphan.session.header.parentSession = "parent";
		ctx.agents = { roots: () => [], get: () => parent };
		registry.start();
		ctx.fire("agent/created", { agent: orphan });

		ctx.agents = { roots: () => [parent], get: (id) => (id === "parent" ? parent : undefined) };
		ctx.fire("agent/created", { agent: parent });
		for (let attempt = 0; attempt < 50 && sessionScopes.get("parent") === undefined; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(sessionScopes.get("parent")?.state, "governed");

		const child = makeInstallableAgent("child", repo, ctx);
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";
		ctx.fire("agent/created", { agent: child });
	});
});


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

		const parentLifecycle = registry.snapshotOf("parent");
		assert.equal(parentLifecycle.scopeState, "governed");
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

		const onSessionEvent = childListener(ctx, "child", "session/event");
		assert.ok(onSessionEvent, "child registered a session/event seam");

		assert.equal(registry.childConclusionOf("child"), null);
		assert.equal(registry.childSnapshots()[0].hasConclusion, false);

		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 1, message: { content: [{ type: "text", text: "done: 3 files" }] } }
		});
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });

		assert.equal(registry.childConclusionOf("child"), "done: 3 files");
		const snap = registry.childSnapshots()[0];
		assert.equal(snap.hasConclusion, true);
		assert.equal(snap.conclusionLength, "done: 3 files".length);

		onSessionEvent(child.session, { type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "done: 3 files", "unmatched turn does not clobber");

		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 3, message: { content: [{ type: "tool_use", name: "x" }] } }
		});
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 3, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "", "textless turn is an empty conclusion, not null");

		onSessionEvent({ events: [] }, { type: "turn/end", data: { turn: 4, reason: { kind: "completed" } } });
		onSessionEvent({ events: [] }, { type: "assistant/message", data: { turn: 4, message: { content: [{ type: "text", text: "外来" }] } } });
		assert.equal(registry.childConclusionOf("child"), "", "foreign session ignored");

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

		const onSessionEvent = childListener(ctx, "child", "session/event");
		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 1, message: { content: [{ type: "text", text: "all done" }] } }
		});
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "all done", "conclusion captured while live");

		await child.disposeFiber();

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

	const second = await handler.handler(
		{ agent, step: 1, signal: {} },
		async () => ({ kind: "enter", messages: [...baseMessages, injected] })
	);
	assert.equal(second.messages.length, baseMessages.length + 1, "unchanged judgment does not re-inject");

	handler.resetVisibility();
	const afterRewind = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(afterRewind.messages.length, baseMessages.length + 1, "lost row is re-injected after rewind/clear");
	assert.match(afterRewind.messages[afterRewind.messages.length - 1].content[0].text, /【LDVH 管辖判定】governed/);

	const third = await handler.handler(
		{ agent, step: 1, signal: {} },
		async () => ({ kind: "enter", messages: [...baseMessages] }),
		undefined,
		undefined
	).catch(() => null);
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

	const withOwn = [...baseMessages, injected];
	const fourth = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: withOwn }));
	assert.equal(fourth.messages.length, withOwn.length, "own message suppresses re-injection");
});

test("pre-step: 相邻轮次不重复注入管辖判定块（真实宿主批次形状，friction-41a43496）", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = { primePending: true, lastDigest: null };
	const notice = "【LDVH 管辖判定】governed —— 本会话受 LDVH 管辖。";
	const handler = createPreStepHandler(agent, {
		isGoverned: () => true,
		channel,
		noticeText: () => notice,
		noticeSummary: () => "本会话受 LDVH 管辖"
	});
	const baseMessages = [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }];

	const turn1 = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(turn1.messages.length, baseMessages.length + 1, "第 1 回合注入一行");

	const turn2 = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(turn2.messages.length, baseMessages.length, "第 2 回合不得重复注入（判定未变且行仍在会话历史中）");

	const turn3 = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(turn3.messages.length, baseMessages.length, "第 3 回合仍不得重复注入");

	const changedHandler = createPreStepHandler(agent, {
		isGoverned: () => false,
		channel,
		noticeText: () => "【LDVH 管辖状态变更】governed → unavailable\n【LDVH 管辖判定】unavailable —— 登记不可读，按不受辖处理。",
		noticeSummary: () => "LDVH 管辖判定"
	});
	const turn4 = await changedHandler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(turn4.messages.length, baseMessages.length + 1, "判定变化必须注入新行");
	assert.match(turn4.messages[turn4.messages.length - 1].content[0].text, /管辖状态变更/);

	const rewoundChannel = { primePending: true, lastDigest: notice };
	const rewoundHandler = createPreStepHandler(agent, {
		isGoverned: () => true,
		channel: rewoundChannel,
		noticeText: () => notice,
		noticeSummary: () => "本会话受 LDVH 管辖"
	});
	const afterRewind = await rewoundHandler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(afterRewind.messages.length, baseMessages.length + 1, "rewind/清空后行确实丢失，必须重新注入");
	assert.match(afterRewind.messages[afterRewind.messages.length - 1].content[0].text, /【LDVH 管辖判定】governed/);
});

test("child: conclusion capture accumulates from the event stream and uses NO deprecated session reads", async () => {
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

		child.session.snapshotEvents = () => { throw new Error("deprecated read must not be called"); };
		child.session.ownEvents = () => { throw new Error("deprecated read must not be called"); };
		child.session.eventAt = () => { throw new Error("deprecated read must not be called"); };
		assert.equal("events" in child.session, false, "真实 Session 没有 events 属性");

		const onSessionEvent = childListener(ctx, "child", "session/event");
		assert.ok(onSessionEvent, "child registered a session/event seam");
		assert.equal(registry.childConclusionOf("child"), null, "尚未结束任何轮次：conclusion 为 null");

		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 1, message: { content: [{ type: "text", text: "复核结论：可关闭" }] } }
		});
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "复核结论：可关闭", "结论必须经事件累积被捕获");

		onSessionEvent(child.session, { type: "turn/end", data: { turn: 9, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "复核结论：可关闭", "无匹配轮次不得清空既有结论");

		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 2, message: { content: [{ type: "text", text: "第二轮" }] } }
		});
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "第二轮", "新轮次覆盖旧结论");
	});
});

test("collect tool: enumerates a FINISHED child and does not emit `undefined` fields", async () => {
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

		for (let attempt = 0; attempt < 50 && !ctx.registeredDescriptors.has("ldvh_collect_subagent_results"); attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		const child = makeInstallableAgent("child", repo, ctx, { root: false });
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";
		ctx.fire("agent/created", { agent: child });

		const onSessionEvent = childListener(ctx, "child", "session/event");
		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 1, message: { content: [{ type: "text", text: "复核完成" }] } }
		});
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });

		await child.disposeFiber();

		const descriptor = ctx.registeredDescriptors.get("ldvh_collect_subagent_results");
		assert.ok(descriptor, `collect tool must be registered through the real path; got ${[...ctx.registeredDescriptors.keys()].join(",")}`);

		const exec = { agent: { session: { header: { cwd: repo } } } };
		const all = await descriptor.execute({}, exec);
		const env = all.envelope ?? all;
		assert.equal(env.outcome, "completed", `枚举必须成功而非报错：${JSON.stringify(env).slice(0, 220)}`);
		const ids = env.result.children.map((c) => c.agentId);
		assert.ok(ids.includes("child"), `已结束的子代理必须仍被枚举到，实得 ${JSON.stringify(ids)}`);

		for (const item of env.result.children) {
			assert.equal(
				Object.prototype.hasOwnProperty.call(item, "activity"),
				false,
				`枚举项不得携带 activity 属性（值为 undefined 时须省略而非赋值）：${JSON.stringify(Object.keys(item))}`
			);
		}

		const one = await descriptor.execute({ agentId: "child" }, exec);
		const oneEnv = one.envelope ?? one;
		assert.equal(oneEnv.outcome, "completed", JSON.stringify(oneEnv).slice(0, 220));
		const entry = oneEnv.result.children.find((c) => c.agentId === "child");
		assert.equal(entry.conclusion, "复核完成", "已结束子代理的结论可回读");
		assert.ok(Array.isArray(entry.activity) && entry.activity.length > 0, "单查带回活动轨迹");
	});
});

test("child: conclusion is also captured from the host's subagent/end event (replacement seam)", async () => {
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

		assert.equal(registry.childConclusionOf("child"), null, "起始无结论");

		ctx.fire("subagent/end", {
			runId: "run-1",
			provider: "spawn",
			id: "child",
			local: true,
			stopReason: "completed",
			lastAssistantMessage: [{ type: "text", text: "宿主事件带来的结论" }]
		});

		assert.equal(
			registry.childConclusionOf("child"),
			"宿主事件带来的结论",
			"subagent/end 携带的 lastAssistantMessage 必须被采纳为结论"
		);
	});
});

test("child: subagent/end for an unknown id is ignored (no cross-child contamination)", async () => {
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

		ctx.fire("subagent/end", {
			runId: "run-x",
			provider: "spawn",
			id: "someone-else",
			local: true,
			stopReason: "completed",
			lastAssistantMessage: [{ type: "text", text: "别人的结论" }]
		});

		assert.equal(registry.childConclusionOf("child"), null, "非本子代理的 end 事件必须被忽略");
	});
});

test("pre-step onTurnStart：每回合第一次 step 跑一次、受管辖时；非受管辖不跑", async () => {
	const agent = makeAgent("s1", "/cwd");
	const enter = { kind: "enter", messages: [{ role: "user", content: [] }] };
	let calls = 0;
	const channel = createPreStepHandler(agent, { isGoverned: () => true, onTurnStart: async () => { calls += 1; } });

	await channel.handler({ agent, step: 2, signal: {} }, async () => enter);
	assert.equal(calls, 0, "非第一步不跑");
	await channel.handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(calls, 1, "第一步跑一次");
	await channel.handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(calls, 2, "下一回合的第一步再跑一次（每回合一次）");

	let governedCalls = 0;
	const ungoverned = createPreStepHandler(makeAgent("s2", "/cwd"), { isGoverned: () => false, onTurnStart: async () => { governedCalls += 1; } });
	await ungoverned.handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(governedCalls, 0, "非受管辖不跑（环境检查只服务受管辖会话）");
});

test("pre-step onTurnStart：抛错不得拦住回合，也不得静默吞掉", async () => {
	const agent = makeAgent("s1", "/cwd");
	const enter = { kind: "enter", messages: [{ role: "user", content: [] }] };
	const warned = [];
	agent.ctx = { logger: { warn: (line) => warned.push(line) } };
	const channel = createPreStepHandler(agent, {
		isGoverned: () => true,
		onTurnStart: async () => { throw new Error("goals service exploded"); },
	});
	const decision = await channel.handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(decision.kind, "enter", "回合照常进行");
	assert.equal(warned.length, 1, "失败须留下日志，不是无声吞掉");
	assert.match(warned[0], /goals service exploded/);
});


test("registry activity trail: child register/retire/clear and root adopt are readable at runtime", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const parent = makeInstallableAgent("parent", repo, ctx);
		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });

		ctx.agents = { roots: () => [parent], get: (id) => (id === "parent" ? parent : undefined) };
		const stopRegistry = registry.start();
		ctx.fire("agent/created", { agent: parent });

		const adopted = registry.registryActivitySnapshot().filter((e) => e.hook === "root/adopt");
		assert.equal(adopted.length >= 1, true, "root adopt recorded");
		assert.ok(adopted.some((e) => e.detail.agentId === "parent"), "adopt names the agent");

		const child = makeInstallableAgent("child", repo, ctx, { root: false });
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";
		ctx.fire("agent/created", { agent: child });
		const regs = registry.registryActivitySnapshot().filter((e) => e.hook === "child/register");
		assert.equal(regs.some((e) => e.detail.agentId === "child"), true, "child/register recorded");
		assert.equal(regs[regs.length - 1].detail.parentId, "parent");

		await child.disposeFiber();
		const trail = registry.registryActivitySnapshot();
		assert.equal(trail.some((e) => e.hook === "child/retire" && e.detail.agentId === "child"), true, "child/retire recorded");
		assert.equal(trail.some((e) => e.hook === "child/clear" && e.detail.agentId === "child"), true, "child/clear recorded");

		stopRegistry();
		const cleared = registry.registryActivitySnapshot().filter((e) => e.hook === "children/cleared");
		assert.equal(cleared.length >= 1, true, "children/cleared recorded on plugin dispose");
		assert.ok(Array.isArray(cleared[cleared.length - 1].detail.clearedLive), "clearedLive captured");
		assert.ok(Array.isArray(cleared[cleared.length - 1].detail.clearedRetired), "clearedRetired captured");
	});
});


test("fiber rebuild: a live subagent is re-adopted after the plugin registry restarts", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const ctx = makeHostCtx();
		const parent = makeInstallableAgent("parent", repo, ctx);
		const child = makeInstallableAgent("child-rebuild", repo, ctx, { root: false });
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";

		const roster = [parent, child];
		const hostAgents = {
			roots: () => [parent],
			list: () => roster.slice(),
			get: (id) => roster.find((a) => a.id === id)
		};

		ctx.agents = hostAgents;
		const sessionScopes = createSessionScopes();

		const registry1 = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });
		const stop1 = registry1.start();
		assert.equal(registry1.installedAgentIds().includes("parent"), true, "parent adopted on first load");
		assert.notEqual(registry1.childActivityOf("child-rebuild"), null, "child registered on first load");
		stop1();

		const registry2 = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });
		const stop2 = registry2.start();
		assert.notEqual(
			registry2.childActivityOf("child-rebuild"),
			null,
			"live subagent re-adopted after fiber rebuild (was lost before the fix)"
		);
		stop2();
	});
});


test("fiber rebuild: a child that finished before the rebuild resolves from its own session record", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		const sessions = {
			"session-parent": [{ type: "session", id: "session-parent", cwd: repo }],
			"session-unrelated": [{ type: "session", id: "session-unrelated", cwd: repo }],
			"reviewer-1": [
				{
					type: "session", version: 4, id: "reviewer-1", cwd: repo,
					parentSession: "session-parent", origin: "subagent", delegationDepth: 1,
					createdAt: 1792306316104
				},
				{ type: "assistant/message", seq: 5, data: { turn: 1, message: { content: [{ type: "tool-call", name: "bash" }] } } },
				{ type: "assistant/message", seq: 7, data: { turn: 1, message: { content: [{ type: "text", text: "对象恰当性：符合（候选与已生效对象无重叠）。" }] } } },
				{ type: "assistant/message", seq: 9, data: { turn: 2, message: { content: [{ type: "tool-call", name: "bash" }] } } }
			],
			"reviewer-2": [
				{
					type: "session", version: 4, id: "reviewer-2", cwd: repo,
					parentSession: "session-unrelated", origin: "subagent", delegationDepth: 1
				},
				{ type: "assistant/message", seq: 3, data: { turn: 1, message: { content: [{ type: "text", text: "别人的子代理。" }] } } }
			]
		};
		const opened = [];
		const sessionPersistence = {
			async open(id, mode) {
				opened.push({ id, mode });
				if (sessions[id] === undefined) throw new Error(`no such session: ${id}`);
				return { read: async () => ({ events: sessions[id] }), close: async () => {} };
			}
		};

		const ctx = makeHostCtx({ sessionPersistence });
		const parent = makeInstallableAgent("session-parent", repo, ctx);
		ctx.agents = {
			roots: () => [parent],
			list: () => [parent],
			get: (id) => (id === "session-parent" ? parent : undefined)
		};

		const sessionScopes = createSessionScopes();
		const registry = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });
		const stop = registry.start();
		ctx.fire("agent/created", { agent: parent });

		assert.equal(registry.childConclusionOf("reviewer-1"), null, "前提：登记表看不到已结束的子代理");

		const resolved = await registry.resolveChild("reviewer-1", { parentSessionId: "session-parent" });
		assert.equal(resolved.ok, true, `必须能从会话记录复原：${JSON.stringify(resolved)}`);
		assert.equal(resolved.source, "session-record");
		assert.equal(resolved.record.parentAgentId, "session-parent");
		assert.equal(resolved.record.hydrated, true);
		assert.match(resolved.record.conclusion, /对象恰当性：符合/, "结论取子代理自己最后的正文");
		assert.equal(resolved.record.startedAt, new Date(1792306316104).toISOString(), "startedAt 回填到会话实际创建时刻");

		const again = await registry.resolveChild("reviewer-1");
		assert.equal(again.source, "registry");
		assert.equal(again.record, resolved.record, "同一份记录，不重复建");
		assert.equal(registry.childConclusionOf("reviewer-1"), resolved.record.conclusion);

		const trail = registry.registryActivitySnapshot();
		assert.equal(
			trail.some((e) => e.hook === "child/hydrated" && e.detail.childId === "reviewer-1"),
			true, "child/hydrated recorded"
		);
		assert.equal(
			trail.some((e) => e.hook === "child/retire" && e.detail.agentId === "reviewer-1" && e.detail.source === "session-record"),
			true, "复原记录进入同一个 retired 窗口（带来源）"
		);

		assert.equal(opened.length >= 1, true);
		assert.equal(opened.every((o) => o.mode === "read"), true, `必须以只读模式读取：${JSON.stringify(opened)}`);

		const foreign = await registry.resolveChild("reviewer-2", { parentSessionId: "session-parent" });
		assert.equal(foreign.ok, false, `别的会话的子代理不得被采纳：${JSON.stringify(foreign)}`);
		assert.match(foreign.reason, /lineage|血统/i);
		assert.equal(registry.childConclusionOf("reviewer-2"), null, "被拒的记录不得落表");
		assert.equal(
			registry.registryActivitySnapshot().some((e) => e.hook === "child/resolve-miss" && e.detail.childId === "reviewer-2"),
			true, "拒绝也留痕"
		);

		stop();
		const registry2 = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });
		const stop2 = registry2.start();
		assert.equal(registry2.childConclusionOf("reviewer-1"), null, "重建后登记表确实是空的（这正是缺陷场景）");
		const rebuilt = await registry2.resolveChild("reviewer-1", { parentSessionId: "session-parent" });
		assert.equal(rebuilt.ok, true, `重建后仍须可收口：${JSON.stringify(rebuilt)}`);
		assert.match(rebuilt.record.conclusion, /对象恰当性：符合/);
		stop2();
	});
});


test("pre-step recall: 有命中时追加召回行，且与管辖判定行互不替代", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = createPreStepHandler(agent, {
		isGoverned: () => true,
		noticeText: () => "管辖判定块",
		noticeSummary: () => "本会话受 LDVH 管辖",
		recallRow: async () => ({ inject: true, text: "【双源召回】候选…", digest: "d1" }),
		recallSummary: () => "双源召回 · 行动前候选"
	});
	const enter = { kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "改点什么" }] }] };
	const r = await channel.handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(r.messages.length, 3, `应为 原批次+判定+召回 = 3，实际 ${r.messages.length}`);
	const texts = r.messages.map((m) => m.content?.[0]?.text ?? "");
	assert.ok(texts.includes("管辖判定块"), "管辖判定行应在");
	assert.ok(texts.some((t) => t.includes("双源召回")), "召回行应在");
});

test("pre-step recall: digest 未变时不重复注入", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = createPreStepHandler(agent, {
		isGoverned: () => true,
		noticeText: () => "管辖判定块",
		noticeSummary: () => "n",
		recallRow: async () => ({ inject: true, text: "【双源召回】候选…", digest: "same" }),
		recallSummary: () => "r"
	});
	const mk = () => ({ kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "改点什么" }] }] });
	const r1 = await channel.handler({ agent, step: 1, signal: {} }, async () => mk());
	const n1 = r1.messages.length;
	const r2 = await channel.handler({ agent, step: 1, signal: {} }, async () => mk());
	assert.ok(r2.messages.length <= n1, `digest 未变不得增加注入行：${n1} → ${r2.messages.length}`);
});

test("pre-step recall: inject:false 时不追加召回行（02 §9.2 进入条件）", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = createPreStepHandler(agent, {
		isGoverned: () => true,
		noticeText: () => "管辖判定块",
		noticeSummary: () => "n",
		recallRow: async () => ({ inject: false, reason: "no-fact-consumption" }),
		recallSummary: () => "r"
	});
	const enter = { kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "好" }] }] };
	const r = await channel.handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(r.messages.length, 2, "只有 原批次+判定，无召回行");
	assert.ok(!r.messages.some((m) => (m.content?.[0]?.text ?? "").includes("双源召回")));
});

test("pre-step recall: recallRow 抛错不拦回合（召回是输入侧，不是闸门）", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = createPreStepHandler(agent, {
		isGoverned: () => true,
		noticeText: () => "管辖判定块",
		noticeSummary: () => "n",
		recallRow: async () => { throw new Error("召回炸了"); },
		recallSummary: () => "r"
	});
	const enter = { kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "改点什么" }] }] };
	const r = await channel.handler({ agent, step: 1, signal: {} }, async () => enter);
	assert.equal(r.messages.length, 2, "召回失败仍应注入管辖判定行，回合不被拦");
	assert.ok(r.messages.some((m) => (m.content?.[0]?.text ?? "") === "管辖判定块"));
});

test("pre-step recall: resetVisibility 清空召回 digest，使 rewind 后能重新注入", async () => {
	const agent = makeAgent("s1", "/cwd");
	let text = "【双源召回】A";
	const channel = createPreStepHandler(agent, {
		isGoverned: () => true,
		noticeText: () => "管辖判定块",
		noticeSummary: () => "n",
		recallRow: async () => ({ inject: true, text, digest: text }),
		recallSummary: () => "r"
	});
	const mk = () => ({ kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "改点什么" }] }] });
	await channel.handler({ agent, step: 1, signal: {} }, async () => mk());
	channel.resetVisibility();
	text = "【双源召回】B";
	const r = await channel.handler({ agent, step: 1, signal: {} }, async () => mk());
	assert.ok(r.messages.some((m) => (m.content?.[0]?.text ?? "").includes("双源召回")), "reset 后应能重新注入");
});

test("旧召回行仍在时须刷新，且不得覆盖管辖判定行", async () => {
	const { createPreStepHandler } = await import("../lib/guidance.js");
	const RECALL = "双源召回 · dsh-ldvh · 行动前候选";
	const NOTICE = "本会话受 LDVH 管辖";
	const mk = (text, summary) => ({
		id: Math.random().toString(36),
		role: "user",
		content: [{ type: "text", text }],
		source: { kind: "dsh-ldvh", plugin: "dsh-ldvh", form: "notice", summary },
	});
	const agent = { id: "a1", ctx: { logger: { warn: () => {} } } };
	let calls = 0;
	const handler = createPreStepHandler(agent, {
		isGoverned: () => true,
		channel: undefined,
		noticeText: () => "【LDVH 管辖判定】governed",
		noticeSummary: () => NOTICE,
		recallRow: async () => {
			calls += 1;
			return { inject: true, text: `召回内容 v${calls}`, digest: "same-digest" };
		},
		recallSummary: () => RECALL,
	});
	const step = (batch) =>
		handler.handler({ agent, step: 1, messages: batch }, async () => ({ kind: "continue", messages: batch }));

	await step([]);
	const notice = mk("判定旧内容", NOTICE);
	const recall = mk("召回旧内容", RECALL);
	await step([notice, recall]);

	assert.notEqual(notice.content[0].text, "召回内容 v2", "管辖判定行**不得**被召回内容覆盖");
	assert.equal(notice.content[0].text, "【LDVH 管辖判定】governed", "判定行须保持自身内容");
	assert.equal(recall.content[0].text, "召回内容 v2", "旧召回行须被刷新为最新内容");
});

test("pre-step: 同一批次已有同内容召回行时不再追加（多实例装载的重复注入）", async () => {
	const RECALL = "双源召回 · dsh-ldvh · 行动前候选";
	const NOTICE = "本会话受 LDVH 管辖";
	const mk = (text, summary) => ({
		id: Math.random().toString(36),
		role: "user",
		content: [{ type: "text", text }],
		source: { kind: "dsh-ldvh", plugin: "dsh-ldvh", form: "notice", summary },
	});
	const agent = { id: "a-dup", ctx: { logger: { warn: () => {} } } };
	const handler = createPreStepHandler(agent, {
		isGoverned: () => true,
		channel: undefined,
		noticeText: () => "【LDVH 管辖判定】governed",
		noticeSummary: () => NOTICE,
		recallRow: async () => ({ inject: true, text: "【双源召回】同一内容", digest: "d" }),
		recallSummary: () => RECALL,
	});
	const innerBatch = [mk("【LDVH 管辖判定】governed", NOTICE), mk("【双源召回】同一内容", RECALL)];
	const r = await handler.handler({ agent, step: 1, messages: innerBatch }, async () => ({
		kind: "continue",
		messages: [...innerBatch],
	}));
	const recalls = r.messages.filter((m) => m.source?.summary === RECALL);
	const notices = r.messages.filter((m) => m.source?.summary === NOTICE);
	assert.equal(recalls.length, 1, `同内容召回行不得重复，实际 ${recalls.length} 条`);
	assert.equal(notices.length, 1, `同内容判定行不得重复，实际 ${notices.length} 条`);
});

test("pre-step: 召回行不得被判定文本覆写（summary 与正文须一致）", async () => {
	const RECALL = "双源召回 · dsh-ldvh · 行动前候选";
	const NOTICE = "本会话受 LDVH 管辖";
	const recallRow = {
		id: "r1",
		role: "user",
		content: [{ type: "text", text: "【双源召回】候选内容" }],
		source: { kind: "dsh-ldvh", plugin: "dsh-ldvh", form: "notice", summary: RECALL },
	};
	const agent = { id: "a-mis", ctx: { logger: { warn: () => {} } } };
	let recallCalls = 0;
	const handler = createPreStepHandler(agent, {
		isGoverned: () => true,
		channel: undefined,
		noticeText: () => "【LDVH 管辖判定】governed",
		noticeSummary: () => NOTICE,
		recallRow: async () => {
			recallCalls += 1;
			return recallCalls === 1
				? { inject: true, text: "【双源召回】候选内容", digest: "d" }
				: { inject: false, reason: "no-hits" };
		},
		recallSummary: () => RECALL,
	});
	await handler.handler({ agent, step: 1, messages: [recallRow] }, async () => ({
		kind: "continue",
		messages: [recallRow],
	}));
	const r = await handler.handler({ agent, step: 1, messages: [recallRow] }, async () => ({
		kind: "continue",
		messages: [recallRow],
	}));
	for (const message of r.messages) {
		if (message.source?.summary === RECALL) {
			assert.ok(
				message.content[0].text.startsWith("【双源召回"),
				`summary 标为召回的行，正文必须是召回内容；实际：${message.content[0].text.slice(0, 40)}`,
			);
		}
		if (message.source?.summary === NOTICE) {
			assert.ok(
				message.content[0].text.startsWith("【LDVH 管辖判定"),
				"summary 标为管辖判定的行，正文必须是判定内容",
			);
		}
	}
});


test("pre-step: suppressUngovernedRow 为真时不注入可见行，但系统侧判定不受影响", async () => {
	const agent = makeAgent("s-ungov", "/cwd");
	const channel = { primePending: true, lastDigest: null };
	const handler = createPreStepHandler(agent, {
		isGoverned: () => false,
		channel,
		noticeText: () => "【LDVH 管辖判定】not_governed —— 本会话不受 LDVH 管辖，LDVH 工具不注册。",
		noticeSummary: () => "本会话不受 LDVH 管辖",
		suppressUngovernedRow: () => true,
	});
	const baseMessages = [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }];
	const out = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(out.kind, "enter");
	assert.equal(out.messages.length, baseMessages.length, "no visible LDVH row may appear in a non-governed session");
	assert.equal(out.messages.filter((m) => m.source?.kind === "dsh-ldvh").length, 0);
	assert.equal(channel.lastDigest, null, "stale digest must be cleared so a later governed switch re-injects");
});

test("pre-step: 受辖时 suppressUngovernedRow 为假，判定行照常注入", async () => {
	const agent = makeAgent("s-gov", "/cwd");
	const channel = { primePending: true, lastDigest: null };
	const handler = createPreStepHandler(agent, {
		isGoverned: () => true,
		channel,
		noticeText: () => "【LDVH 管辖判定】governed —— 本会话受 LDVH 管辖。",
		noticeSummary: () => "本会话受 LDVH 管辖",
		suppressUngovernedRow: () => false,
	});
	const baseMessages = [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }];
	const out = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(out.messages.length, baseMessages.length + 1, "a governed session must still see its judgment row");
	assert.match(out.messages[out.messages.length - 1].content[0].text, /governed/);
});

test("pre-step: 不传 suppressUngovernedRow 时行为不变（向后兼容）", async () => {
	const agent = makeAgent("s-compat", "/cwd");
	const channel = { primePending: true, lastDigest: null };
	const handler = createPreStepHandler(agent, {
		isGoverned: () => false,
		channel,
		noticeText: () => "【LDVH 管辖判定】not_governed",
		noticeSummary: () => "本会话不受 LDVH 管辖",
	});
	const baseMessages = [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }];
	const out = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(out.messages.length, baseMessages.length + 1);
});


test("pre-step: 把关行按 digest 只注一次（真实批次形状，连跑三回合）", async () => {
	const agent = makeAgent("s-ask-dedup", "/cwd");
	const ASK_SUMMARY = "把关询问 · 待你决定是否安排代理";
	const channel = { primePending: true, lastDigest: null, lastReviewAskDigest: null };
	const handler = createPreStepHandler(agent, {
		isGoverned: () => true,
		channel,
		noticeText: () => null,
		noticeSummary: () => "",
		reviewAskRow: async () => ({ inject: true, text: "两处提请的开关状态…（内容稳定）", digest: "d1" }),
		reviewAskSummary: () => ASK_SUMMARY,
	});
	const base = () => [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }];
	const countAsk = (messages) => messages.filter((m) => (m?.source?.summary ?? "") === ASK_SUMMARY).length;

	const counts = [];
	for (let turn = 1; turn <= 3; turn += 1) {
		const out = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: base() }));
		counts.push(countAsk(out.messages));
	}
	assert.deepEqual(counts, [1, 0, 0], "把关行按 digest 只注一次（与召回行同形），不得每回合重复注入");
});


test("pre-step: 把关行在不受辖时 inject:false（真实 handler，不是源码 grep）", async () => {
	const agent = makeAgent("s-gate", "/cwd");
	const base = () => [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }];
	const ASK_SUMMARY = "把关询问 · 待你决定是否安排代理";

	{
		const channel = { primePending: true, lastDigest: null, lastReviewAskDigest: null };
		const handler = createPreStepHandler(agent, {
			isGoverned: () => false, channel,
			noticeText: () => null, noticeSummary: () => "",
			reviewAskRow: async () => ({ inject: false, reason: "not-governed" }),
			reviewAskSummary: () => ASK_SUMMARY,
		});
		const out = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: base() }));
		assert.equal(out.messages.filter((m) => (m?.source?.summary ?? "") === ASK_SUMMARY).length, 0, "不受辖时不得出现把关行");
	}
	{
		const channel = { primePending: true, lastDigest: null, lastReviewAskDigest: null };
		const handler = createPreStepHandler(agent, {
			isGoverned: () => true, channel,
			noticeText: () => null, noticeSummary: () => "",
			reviewAskRow: async () => ({ inject: true, text: "开关状态…", digest: "g1" }),
			reviewAskSummary: () => ASK_SUMMARY,
		});
		const out = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: base() }));
		assert.equal(out.messages.filter((m) => (m?.source?.summary ?? "") === ASK_SUMMARY).length, 1, "受辖且开启时须出现把关行");
	}
});


test("把关提示行：两个开关都关时不得显示成「行动后复核已开启」", async () => {
	const { buildReviewAskNotice } = await import("../lib/lifecycle.js");
	const bothOff = buildReviewAskNotice({ preOn: false, postOn: false });
	assert.doesNotMatch(bothOff, /已开启/, `两个开关都关时不得出现「已开启」：\n${bothOff}`);

	const off = buildReviewAskNotice({ preOn: false, postOn: true, preKnown: true, postKnown: true });
	assert.match(off, /行动前审查：关闭/);
	assert.match(off, /行动后复核：\*\*已开启\*\*/);

	const unknown = buildReviewAskNotice({ preOn: false, postOn: true, preKnown: false, postKnown: true });
	assert.match(unknown, /行动前审查：关闭（未设置，按关处理）/, "「未设置」不得被陈述成「Human 关掉了」");
	assert.match(unknown, /行动后复核：\*\*已开启\*\*/);
});


test("把关提示行：静默执行开着时，两处由「须询问」改为「不要问」", async () => {
	const { buildReviewAskNotice } = await import("../lib/lifecycle.js");
	const silent = buildReviewAskNotice({ preOn: true, postOn: true, silentOn: true });
	assert.match(silent, /静默执行：\*\*已开启\*\*/);
	assert.match(silent, /① 行动前[\s\S]*?不要问/, "行动前那一支须改为「不要问」");
	assert.match(silent, /② 收口前[\s\S]*?不要问/, "收口前那一支须改为「不要问」");
	const asked = buildReviewAskNotice({ preOn: true, postOn: true, silentOn: false });
	assert.doesNotMatch(asked, /不要问/, "静默关着时仍须照旧询问");
	assert.match(asked, /询问 Human「是否安排代理审查」/);
	const noSubject = buildReviewAskNotice({ preOn: false, postOn: false, silentOn: true });
	assert.doesNotMatch(noSubject, /不要问/);
});

test("把关提示行：第三处开关的取值也注入，「未设置」不得说成已关", async () => {
	const { buildReviewAskNotice } = await import("../lib/lifecycle.js");
	const on = buildReviewAskNotice({ preOn: false, postOn: false, consultOn: true });
	assert.match(on, /遇难题：联网调查提请：\*\*已开启\*\*/, "第三处开着时须在提示行里看得见");
	const off = buildReviewAskNotice({ preOn: false, postOn: false, consultOn: false, consultKnown: true });
	assert.match(off, /遇难题：联网调查提请：关闭/);
	const unknown = buildReviewAskNotice({ preOn: false, postOn: false, consultOn: false, consultKnown: false });
	assert.match(unknown, /遇难题：联网调查提请：关闭（未设置/, "「未设置」不得被陈述成「Human 关掉了」");
	assert.doesNotMatch(unknown, /遇难题：联网调查提请：\*\*已开启\*\*/);
});

test("把关提示行：静默开关取不到时不得出现自相矛盾的「已开启（按关闭处理）」", async () => {
	const { buildReviewAskNotice } = await import("../lib/lifecycle.js");
	const text = buildReviewAskNotice({ preOn: true, postOn: true, silentOn: false });
	assert.doesNotMatch(text, /静默执行/, "取不到静默开关时不得声称静默已开启");
	const on = buildReviewAskNotice({ preOn: true, postOn: true, silentOn: true });
	assert.match(on, /静默执行：\*\*已开启\*\*/);
	assert.doesNotMatch(on, /按关闭处理/, "已开启与按关闭处理不可能同时成立");
});

test("把关提示行：点位排除渲染在判据之后，且带交付义务与不免除清单", async () => {
	const { buildReviewAskNotice } = await import("../lib/lifecycle.js");
	const { GATE_POINT_EXCLUSIONS, COMPLEXITY_CRITERIA } = await import("../lib/review-ask.js");
	const text = buildReviewAskNotice({ preOn: true, postOn: true, silentOn: false });

	for (const item of GATE_POINT_EXCLUSIONS) {
		assert.ok(text.includes(item.label), `点位排除「${item.key}」未进入注入行`);
		assert.ok(text.includes(item.carried), `「${item.key}」的承接面未渲染——只剩结论没有依据`);
		assert.ok(text.includes(item.notExcluded), `「${item.key}」的不适用边界未渲染——排除会被过度解释`);
	}

	const criteriaEnd = text.lastIndexOf(COMPLEXITY_CRITERIA[COMPLEXITY_CRITERIA.length - 1].label);
	const exclusionHead = text.indexOf("点位排除");
	const actionHead = text.indexOf("① 行动前");
	assert.ok(criteriaEnd !== -1 && exclusionHead !== -1 && actionHead !== -1);
	assert.ok(exclusionHead > criteriaEnd, "点位排除不得渲染在判据之前——它是判为复杂之后的第二道");
	assert.ok(exclusionHead < actionHead, "点位排除须先于行为指令渲染，否则 ①② 两句里的「未命中排除」无所指");

	assert.match(text, /整件/, "须写明按当次工作整体判定，不按动作切分");
	assert.match(text, /方案收敛自查/, "须写明排除不免复杂任务判据要求的自查");
	assert.match(text, /须人决定事项的提请照提/, "须写明排除不免任何须人决定事项的提请");
	assert.match(text, /点位排除：命中/, "须给出那行交付声明的模板");
	assert.doesNotMatch(text, /§|specs\//, "注入文本不得再引规范章节号或开发规范路径（运行期规则只来自载体）");
	assert.match(text, /不写这行按未请示处理/, "交付声明缺写时的后果须当场说出");

	assert.doesNotMatch(text, /点位排除[^\n]*不算复杂任务/, "排除不得被表述为对复杂任务判定的改写");
});

test("把关提示行：行为指令须以「未命中排除」为条件（否则排除在指令层不生效）", async () => {
	const { buildReviewAskNotice } = await import("../lib/lifecycle.js");
	const asked = buildReviewAskNotice({ preOn: true, postOn: true, silentOn: false });
	assert.match(asked, /① 行动前[\s\S]*?未命中排除[\s\S]*?询问 Human/, "行动前指令须把排除作为前置条件");
	assert.match(asked, /② 收口前[\s\S]*?未命中[\s\S]*?询问 Human/, "收口前指令须把排除作为前置条件");

	const silent = buildReviewAskNotice({ preOn: true, postOn: true, silentOn: true });
	assert.match(silent, /① 行动前[\s\S]*?未命中排除[\s\S]*?不要问/, "静默档同样须先看排除");
	assert.match(silent, /② 收口前[\s\S]*?未命中[\s\S]*?不要问/);
});


test("把关提示行：行动前那处须带「方案已有候选」这个时点条件", async () => {
	const { buildReviewAskNotice } = await import("../lib/lifecycle.js");
	for (const silentOn of [false, true]) {
		const text = buildReviewAskNotice({ preOn: true, postOn: true, silentOn });
		assert.match(text, /① 行动前（方案已有候选/, "行动前指令须在标题处写明时点条件");
		assert.match(text, /尚无候选方案时不得发起该处请示/, "须明说无候选时不发起（否则空问仍会发生）");
		assert.match(text, /尚未产生副作用/, "须写明 32 §6.1 的进入信号是「尚未产生副作用」而非「尚未做任何事」");
	}
});

test("把关提示行：答复不构成动手／收口前提（不得把请示写成暂停）", async () => {
	const { buildReviewAskNotice } = await import("../lib/lifecycle.js");
	for (const silentOn of [false, true]) {
		const text = buildReviewAskNotice({ preOn: true, postOn: true, silentOn });
		assert.doesNotMatch(text, /取得明确答复后才动手/, "不得把请示写成动手的前提（00 §2.5）");
		assert.doesNotMatch(text, /取得明确答复后再收口/, "不得把请示写成收口的前提（00 §2.5）");
	}
	const asked = buildReviewAskNotice({ preOn: true, postOn: true, silentOn: false });
	assert.match(asked, /\*\*答复不构成动手前提\*\*/, "须明说答复不构成动手前提");
	assert.match(asked, /未取得答复时按既有路径继续/, "须给出未取得答复时的处置方向");
	assert.match(asked, /\*\*答复不构成收口前提\*\*/, "收口处同理");
});


test("pre-step 规范目录: 独立成一行注入（标签「事实规范目录」），不混进召回行", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = createPreStepHandler(agent, {
		isGoverned: () => true,
		noticeText: () => "管辖判定块",
		noticeSummary: () => "本会话受 LDVH 管辖",
		recallRow: async () => ({ inject: true, text: "【双源召回】候选…", digest: "d1" }),
		recallSummary: () => "双源召回 · 行动前候选",
		normDirectoryRow: async () => ({
			inject: true,
			text: "【事实规范目录 · active Norm（27 §10）】\n· 合成方向甲（fixture-direction-alpha）",
			digest: "nd1",
		}),
	});
	const enter = { kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "改点什么" }] }] };
	const r = await channel.handler({ agent, step: 1, signal: {} }, async () => enter);
	const labels = r.messages.map((m) => m.source?.summary ?? null);
	assert.ok(labels.includes("事实规范目录"), "目录须独立成一行（有自己的标签）");
	const texts = r.messages.map((m) => m.content?.[0]?.text ?? "");
	assert.ok(texts.some((t) => t.includes("【事实规范目录")), "目录正文须在场");
	assert.ok(!texts.some((t) => t.includes("双源召回") && t.includes("事实规范目录")), "目录不得混进召回行");
});

test("pre-step 规范目录: 每回合都注一行（内容稳定也照注），内容变了由下一行反映", async () => {
	const agent = makeAgent("s1", "/cwd");
	let digest = "nd-same";
	let text = "【事实规范目录 · active Norm（27 §10）】\n· 甲（a）";
	const channel = createPreStepHandler(agent, {
		isGoverned: () => true,
		normDirectoryRow: async () => ({ inject: true, text, digest }),
	});
	const mk = () => ({ kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "改点什么" }] }] });
	const r1 = await channel.handler({ agent, step: 1, signal: {} }, async () => mk());
	const rows1 = r1.messages.filter((m) => (m?.source?.summary ?? null) === "事实规范目录");
	assert.equal(rows1.length, 1, "首回合须有一行目录");
	const r2 = await channel.handler({ agent, step: 1, signal: {} }, async () => mk());
	const rows2 = r2.messages.filter((m) => (m?.source?.summary ?? null) === "事实规范目录");
	assert.equal(rows2.length, 1, "每回合都要有一行目录（内容稳定也照注）");
	digest = "nd-next";
	text = "【事实规范目录 · active Norm（27 §10）】\n· 甲（a）\n· 乙（b）";
	const r3 = await channel.handler({ agent, step: 1, signal: {} }, async () => mk());
	const rows3 = r3.messages.filter((m) => (m?.source?.summary ?? null) === "事实规范目录");
	assert.equal(rows3.length, 1, "同批次内不得出现两份目录");
	assert.ok((rows3[0].content?.[0]?.text ?? "").includes("乙（b）"), "新一行须反映最新内容");
});

test("pre-step 规范目录: 同批次内已有同内容目录行时不再重复追加（多实例去重）", async () => {
	const agent = makeAgent("s1", "/cwd");
	const channel = createPreStepHandler(agent, {
		isGoverned: () => true,
		normDirectoryRow: async () => ({ inject: true, text: "【事实规范目录】同一份", digest: "d" }),
	});
	const mk = () => ({ kind: "enter", messages: [{ role: "user", content: [{ type: "text", text: "改点什么" }] }] });
	const r1 = await channel.handler({ agent, step: 1, signal: {} }, async () => mk());
	const rows1 = r1.messages.filter((m) => (m?.source?.summary ?? null) === "事实规范目录");
	assert.equal(rows1.length, 1, "同批次内只应有一份同内容目录行");
});
