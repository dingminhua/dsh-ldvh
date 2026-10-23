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

function makeHostCtx(services = {}) {
	const listeners = {};
	const ctx = {
		agents: { roots: () => [] },
		on(event, listener) {
			(listeners[event] ??= []).push(listener);
			return () => { listeners[event] = listeners[event].filter((candidate) => candidate !== listener); };
		},
		// `services` carries every host service beyond `agents` (e.g.
		// sessionPersistence, for the durable child-resolution path).
		get(name) { return name === "agents" ? ctx.agents : services[name]; },
		logger: { info() {}, warn() {} },
		fire(event, payload) {
			for (const listener of listeners[event] ?? []) listener(payload);
		},
		agentEffects: [],
		registeredTools: [],
		// 按工具名索引真实 descriptor，供需要驱动工具执行的用例使用
		registeredDescriptors: new Map()
	};
	return ctx;
}

function makeInstallableAgent(id, cwd, ctx, { root = true, origin, parentSession, isSeeded, delegationDepth } = {}) {
	const disposers = [];
	// `origin` / `parentSession` 按宿主真实会话头的形状注入（可缺省＝字段不存在）。
	// 二者是本插件识别子代理的两条判据，故测试必须能分别构造——早期 helper 只造
	// `{id, cwd}`，使「子代理识别」在测试里**无法表达**，这正是缺陷长期未被发现的原因。
	// `isSeeded` / `delegationDepth` 同理（2026-10-20 补）：宿主用这两个字段区分
	// 「委派」与「前缀继承」（isSeeded = fork-inherited prefix），判据收敛需要它们可构造。
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
					if (descriptor?.name !== undefined) ctx.registeredDescriptors.set(descriptor.name, descriptor);
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

test("lifecycle: 子代理按 parentSession 识别——origin 缺失的宿主上仍须走 child 路径", async () => {
	// ## 缺陷经过（2026-10-11 实测）
	//
	// `install()` 原先只用 `origin === "subagent"` 识别子代理。本宿主上该字段
	// **不存在**（实测 48 个会话——44 根 + 4 子代理——`origin` 全为 `null`），判据
	// 恒为假；而下一道 `roots()` 关也没拦住（宿主把子代理也算作 root）。后果：
	// 子代理被完整 install、挂上 idle 检查点触发器，于是**执行时又派生自己的子代理**，
	// 并用自己的 session id 读写水位与冷却状态，使节流按会话分家——实测冷却配置
	// 600 秒而实际间隔 1 秒。
	//
	// 修法是补 `parentSession` 判据（取自 dsh-auto-memory lib/index.js:4971，其注释
	// 写明目的是「避免子代理轮次误沉淀」——同一失效面）。
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

		// ★ 核心：origin 缺失、但有 parentSession —— 必须走 child 路径，不得 install。
		// 关键在**同时**把它放进 roots()：那正是实测中绕过第二道关的条件。
		const sub = makeInstallableAgent("s-sub-ps", repo, ctx, { parentSession: "s-live" });
		ctx.agents = { roots: () => [live, sub], get: () => live };
		ctx.fire("agent/created", { agent: sub });
		assert.deepEqual(
			registry.installedAgentIds(),
			["s-live"],
			"有 parentSession 者即使被算作 root，也不得被 install（否则它会挂上 idle 检查点并再派生）",
		);
		// childSnapshots 是登记面暴露的读取口（不是另加 accessor）。
		assert.deepEqual(
			registry.childSnapshots().map((c) => c.agentId),
			["s-sub-ps"],
			"而应走 child 路径",
		);

		// 对照：origin 形态（提供该字段的宿主）仍然生效，两条判据不互相替代。
		const subByOrigin = makeInstallableAgent("s-sub-origin", repo, ctx, { origin: "subagent" });
		ctx.agents = { roots: () => [live, subByOrigin], get: () => live };
		ctx.fire("agent/created", { agent: subByOrigin });
		assert.deepEqual(registry.installedAgentIds(), ["s-live"], "origin 判据仍单独生效");

		// 边界：空串 / 纯空白**不算**子代理（不得因字段存在就一律当子代理，
		// 那会把根会话误拦——根会话的该字段实测为 null，但空串也应同样处理）。
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
	// ## 缺陷经过（2026-10-20 实测）
	//
	// 上一用例补的 `parentSession` 判据把**前缀继承**也当成了委派：宿主从既有会话
	// fork/continue 出新会话时，同样写 `parentSession`（SessionHeader 的 `isSeeded`
	// 描述逐字为 "Whether the Session contains a fork-inherited prefix"），但不写
	// `origin`，且 `delegationDepth` 为 0。
	//
	// 后果链：`install()` 走 child → `installChild()` 的血缘检查要求父会话是活体
	// agent，而父通常不是 → 返回 false → 而 install() 早已无条件 return。该会话
	// 于是**永久没有 ldvh_* 工具、没有 pre-step、没有 sessionScopes**，只剩一条
	// 32 项 tool-removal 与指引段，无日志无报错。实测全库 407 个会话中 4 个种子根
	// 会话的 ldvh_* 从 32 掉到 0，49 个普通根与 350 个真子代理无一例外。
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

		// ★ 核心：parentSession 非空 + isSeeded + delegationDepth=0 —— 种子根会话，
		// 必须 install（工具/通道全在 install 之后的路径上）。
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

		// 对照 A：isSeeded 但 delegationDepth=1 —— 子代理的种子副本，仍须走 child。
		const seededChild = makeInstallableAgent("s-seeded-child", repo, ctx, {
			parentSession: "s-live",
			isSeeded: true,
			delegationDepth: 1,
		});
		ctx.agents = { roots: () => [live, seededRoot, seededChild], get: () => live };
		ctx.fire("agent/created", { agent: seededChild });
		assert.deepEqual(registry.childSnapshots().map((c) => c.agentId), ["s-seeded-child"], "depth≥1 仍走 child");

		// 对照 B：没有 isSeeded / delegationDepth 的旧宿主 —— 保留原行为（按子代理）。
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

		// 2026-09-26 语义迁移：捕获改为**在事件流上累积**（不再回读会话日志）。
		// 故须按真实发布顺序投递两个事件：同轮的 assistant/message，然后 turn/end。
		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 1, message: { content: [{ type: "text", text: "done: 3 files" }] } }
		});
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
		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 3, message: { content: [{ type: "tool_use", name: "x" }] } }
		});
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 3, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "", "textless turn is an empty conclusion, not null");

		// Events from a different session are ignored.
		onSessionEvent({ events: [] }, { type: "turn/end", data: { turn: 4, reason: { kind: "completed" } } });
		onSessionEvent({ events: [] }, { type: "assistant/message", data: { turn: 4, message: { content: [{ type: "text", text: "外来" }] } } });
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

		// The child does its work and its turn ends（事件流上累积，见 child.js 注释）。
		const onSessionEvent = childListener(ctx, "child", "session/event");
		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 1, message: { content: [{ type: "text", text: "all done" }] } }
		});
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
	//
	// **2026-10-19（friction-41a43496）**：这里原先靠「批次里没有行」来推断
	// rewind，但宿主**每一轮**的批次都不含历史行——那条推断在真实形状下把每个
	// 正常轮次都当成 rewind，就是重复注入的成因。rewind/clear 的真实信号是
	// `agent/created` 的 `payload.source ∈ clear|compact|resume`，它会把注入台账
	// 清空；故这里显式清台账，而不是让批次缺席冒充 rewind。
	handler.resetVisibility();
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

// friction-41a43496 回归：管辖判定块**不得**在相邻轮次重复注入。
//
// 缺陷事实（2026-10-19 查明）：原先的丢失去重读的是 `decision.messages`——
// 那是**本回合装配出来的批次**，不是会话历史。上一回合 step-1 注入的行不会
// 出现在下一回合的批次里，于是每回合都被判成「行已丢失（rewind/清空）」，
// 走 loss-recovery 路径再注入一条，肉眼可见同一判定块在相邻轮次重复出现。
//
// 上面那条 2026-09-04 用例为什么抓不到：它把上一回合的 `injected` 手工塞回
// 下一回合的 `decision.messages`（`[...baseMessages, injected]`），造出了一个
// 真实宿主不提供的形状——正是这条用例自身在替缺陷兜底。
// 本用例按**真实形状**推进：每回合只给本回合自己的批次，历史行不进批次。
// 按 09 §5 的变异检验口径，它正是那个能杀掉「只读本批次」写法的用例。
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
	// 每回合宿主都只装配本回合的用户消息——历史注入行**不在**其中。
	const baseMessages = [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }], source: { kind: "user" } }];

	// 第 1 回合：首注，一行。
	const turn1 = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(turn1.messages.length, baseMessages.length + 1, "第 1 回合注入一行");

	// 第 2 回合：判定未变；宿主批次里看不到上一回合那行（真实形状）。
	// 必须**不新增**——这正是缺陷点。
	const turn2 = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(turn2.messages.length, baseMessages.length, "第 2 回合不得重复注入（判定未变且行仍在会话历史中）");

	// 第 3 回合：同上，连续多轮都必须静默。
	const turn3 = await handler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(turn3.messages.length, baseMessages.length, "第 3 回合仍不得重复注入");

	// 判定变化：仍然必须注入新行（不能因为「见过行」就把变化吞掉）。
	const changedHandler = createPreStepHandler(agent, {
		isGoverned: () => false,
		channel,
		noticeText: () => "【LDVH 管辖状态变更】governed → unavailable\n【LDVH 管辖判定】unavailable —— 登记不可读，按不受辖处理。",
		noticeSummary: () => "LDVH 管辖判定"
	});
	const turn4 = await changedHandler.handler({ agent, step: 1, signal: {} }, async () => ({ kind: "enter", messages: [...baseMessages] }));
	assert.equal(turn4.messages.length, baseMessages.length + 1, "判定变化必须注入新行");
	assert.match(turn4.messages[turn4.messages.length - 1].content[0].text, /管辖状态变更/);

	// rewind 恢复路径：台账被清空（rewind 到注入点之前 / 会话被清空）后，
	// 下一回合必须重新注入，不能因为 lastDigest 仍匹配就永久静默。
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

// ---------------------------------------------------------------------------
// 2026-09-26 回归：结论捕获必须走 DSH 真实 API（session.snapshotEvents()）
// ---------------------------------------------------------------------------
//
// 缺陷事实：`child.js` 原读 `agent.session?.events`，而 DSH 的 Session 上**没有
// `events` 属性**——它只有 `snapshotEvents()` 方法。故该表达式恒为 undefined，
// `!Array.isArray(events)` 立即返回，**结论从未被捕获过**。
//
// 为什么既有用例抓不到它：上面那条用例自行赋值 `child.session.events = [...]`，
// 造出了一个真实 Session 上不存在的属性，于是测试通过而产品失效。本用例改用
// **真实形状**（提供 `snapshotEvents()`，不提供 `events`）——按 09 §5 的变异
// 检验口径，它正是那个能杀掉「读不存在属性」写法的用例。
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

		// 真实形状：Session 只有弃用的读取方法、**没有 events 属性**。本用例
		// 进一步断言：捕获**不依赖任何读取入口**——把弃用方法替换为会抛错的桩，
		// 只要事件照常发布，捕获就必须成功。这杀掉「回读会话日志」的全部变体
		// （无论是 `.events` 还是 `snapshotEvents()`，后者属新增生产调用、被
		// DSH README 明文禁止）。
		child.session.snapshotEvents = () => { throw new Error("deprecated read must not be called"); };
		child.session.ownEvents = () => { throw new Error("deprecated read must not be called"); };
		child.session.eventAt = () => { throw new Error("deprecated read must not be called"); };
		assert.equal("events" in child.session, false, "真实 Session 没有 events 属性");

		const onSessionEvent = childListener(ctx, "child", "session/event");
		assert.ok(onSessionEvent, "child registered a session/event seam");
		assert.equal(registry.childConclusionOf("child"), null, "尚未结束任何轮次：conclusion 为 null");

		// 同轮 assistant/message → turn/end，结论取自事件流。
		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 1, message: { content: [{ type: "text", text: "复核结论：可关闭" }] } }
		});
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "复核结论：可关闭", "结论必须经事件累积被捕获");

		// 无对应 assistant/message 的轮次结束 → 不清空既有结论。
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 9, reason: { kind: "completed" } } });
		assert.equal(registry.childConclusionOf("child"), "复核结论：可关闭", "无匹配轮次不得清空既有结论");

		// 更早轮次的文本不得覆盖更新轮次已定的结论。
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

		// 工具注册是**异步**的（install → 判定管辖 → 注册），须轮询等待，
		// 否则取不到 descriptor —— 这正是既有用例 518 行采用的做法。
		for (let attempt = 0; attempt < 50 && !ctx.registeredDescriptors.has("ldvh_collect_subagent_results"); attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}

		const child = makeInstallableAgent("child", repo, ctx, { root: false });
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";
		ctx.fire("agent/created", { agent: child });

		// 子代理工作结束（事件流上累积；不依赖任何弃用的会话读取入口）。
		const onSessionEvent = childListener(ctx, "child", "session/event");
		onSessionEvent(child.session, {
			type: "assistant/message",
			data: { turn: 1, message: { content: [{ type: "text", text: "复核完成" }] } }
		});
		onSessionEvent(child.session, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });

		// 关键：fiber 销毁 = 原实现丢失它的那一刻。
		await child.disposeFiber();

		// 走**真实注册路径**：registry 安装父代理时会把工具批量注册到
		// parent.ctx.tools —— 直接取真实 descriptor，而不是自造 seam。
		const descriptor = ctx.registeredDescriptors.get("ldvh_collect_subagent_results");
		assert.ok(descriptor, `collect tool must be registered through the real path; got ${[...ctx.registeredDescriptors.keys()].join(",")}`);

		// ① 枚举调用（不指定 agentId）——原实现在此**直接抛错**（undefined 字段）。
		const exec = { agent: { session: { header: { cwd: repo } } } };
		const all = await descriptor.execute({}, exec);
		const env = all.envelope ?? all;
		assert.equal(env.outcome, "completed", `枚举必须成功而非报错：${JSON.stringify(env).slice(0, 220)}`);
		const ids = env.result.children.map((c) => c.agentId);
		assert.ok(ids.includes("child"), `已结束的子代理必须仍被枚举到，实得 ${JSON.stringify(ids)}`);

		// ② 枚举结果**不得携带值为 undefined 的属性**。
		//
		// 断言必须直接检视属性存在性：`JSON.stringify` 会把 undefined 属性**静默
		// 丢弃**，故对 JSON 文本做子串匹配是无效断言（首版测试即因此漏检，变异
		// 未被捕获）。而宿主的 lossless-JSON 校验看的正是「属性是否存在且不可表
		// 达」——`activity: undefined` 因此在真实调用中报错。
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

// ---------------------------------------------------------------------------
// 换接（2026-10-03）：结论改由宿主的 subagent/end 事件承载
// ---------------------------------------------------------------------------
//
// 为什么加这条守卫：LDVH 原先把子代理结论靠**自己扫 `session/event`** 配对
// （assistant/message + turn/end）来捕获（child.js），而宿主在 0.2.0-rc.2 已
// 直接提供 `subagent/end` 事件，其载荷携带 `lastAssistantMessage` —— 与本机制
// 手工实现的是**同一事实**，且由宿主保证「只取本 epoch 自身的输出」。
//
// 关键作用域事实（源码核验，`packages/subagent/subagent/src/lifecycle.ts:106-112`）：
// `subagent/start`/`subagent/end` 经 `carrier(parent)`（= `scopeTarget(this, parent)`）
// 分发，即**作用域键是父代理**。故监听器必须注册在**根会话的 ctx** 上，注册在
// 子代理自身的 ctx 上收不到。本用例即锁定该注册位置与 id 匹配行为。
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

		// 宿主在子代理一个 epoch 终止时发布 subagent/end，载荷带 lastAssistantMessage。
		// 注意这是**根 ctx** 上的事件（见上文作用域说明），不是子代理 ctx 上的。
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

		// 另一个子代理的 end 事件不得写入本子代理的结论槽。
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
	// 接线守卫：21 §14「以及该会话续接本对象」要求「会话继续干活」时把在办工单的目标
	// 恢复武装。该义务只能挂在这个缝上——此前它只写在规范里、代码不做（2026-10-15 发现）。
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

// ---------------------------------------------------------------------------
// 2026-10-18 registry observability（子代理登记表被清空 修复 · 步骤 1）
// ---------------------------------------------------------------------------
//
// 缺陷（workcase 复核无法收口）：插件 fiber 重建（dispose → start）后，
// `children` / `retiredChildren` 被清空，且 start() 只 adopt roots() —— 已存在
// 的子代理不再入表，导致 collect 恒 0 条、record_review 恒「not a subagent
// registered」。本用例钉住**观测面**：三类事件（写 children／清空／adopt）必须
// 有运行期可回读的轨迹（registryActivitySnapshot），不依赖控制台。

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

		// 根会话 adopt 被记录在 registry 轨迹上。
		const adopted = registry.registryActivitySnapshot().filter((e) => e.hook === "root/adopt");
		assert.equal(adopted.length >= 1, true, "root adopt recorded");
		assert.ok(adopted.some((e) => e.detail.agentId === "parent"), "adopt names the agent");

		// 子代理注册被记录。
		const child = makeInstallableAgent("child", repo, ctx, { root: false });
		child.session.header.origin = "subagent";
		child.session.header.parentSession = "parent";
		ctx.fire("agent/created", { agent: child });
		const regs = registry.registryActivitySnapshot().filter((e) => e.hook === "child/register");
		assert.equal(regs.some((e) => e.detail.agentId === "child"), true, "child/register recorded");
		assert.equal(regs[regs.length - 1].detail.parentId, "parent");

		// 子代理 fiber 销毁 → 移入 retired（child/retire）+ 从 live 删除（child/clear）。
		await child.disposeFiber();
		const trail = registry.registryActivitySnapshot();
		assert.equal(trail.some((e) => e.hook === "child/retire" && e.detail.agentId === "child"), true, "child/retire recorded");
		assert.equal(trail.some((e) => e.hook === "child/clear" && e.detail.agentId === "child"), true, "child/clear recorded");

		// 插件 fiber 销毁（registry 的 start() 反安装函数被调用）→ 两张表被清空，
		// 且 children/cleared 事件带清空前读数。
		stopRegistry();
		const cleared = registry.registryActivitySnapshot().filter((e) => e.hook === "children/cleared");
		assert.equal(cleared.length >= 1, true, "children/cleared recorded on plugin dispose");
		assert.ok(Array.isArray(cleared[cleared.length - 1].detail.clearedLive), "clearedLive captured");
		assert.ok(Array.isArray(cleared[cleared.length - 1].detail.clearedRetired), "clearedRetired captured");
	});
});

// ---------------------------------------------------------------------------
// 2026-10-18 缺陷复现：插件 fiber 重建后子代理登记表丢失
// ---------------------------------------------------------------------------
//
// 复现条件（真实宿主具备，虚构 ctx 未必）：
//   1. 父会话 + 子代理同时存活，registry.start() 把二人都 adopt 进来；
//   2. 插件 fiber 重建 = registry 的 start() 反安装函数被调用（dispose），紧接着
//      再 start() 一次（宿主重载插件时就是这个序列）；
//   3. 重建前 children 表里有子代理 —— 重建后它必须仍在表里（可被 collect /
//      record_review 查到），否则独立复核无法收口。
//
// 修复前：start() 只遍历 roots()，子代理（非 root）永不重新入表 → 该断言失败。
// 修复后：start() 遍历 agentsService.list()（含子代理），子代理经 install() 的
// origin/parentSession 判据重新走 installChild()。

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

		// 宿主 agents 服务：roots() 只含父；list() 含父与子（真实宿主形状）。
		const roster = [parent, child];
		const hostAgents = {
			roots: () => [parent],
			list: () => roster.slice(),
			get: (id) => roster.find((a) => a.id === id)
		};

		// 两轮 registry 各自持有同一组 agent 与同一个 ctx（模拟插件重载：
		// 进程不重启，宿主服务不变，只有插件自己的 fiber 被销毁再建）。
		ctx.agents = hostAgents;
		const sessionScopes = createSessionScopes();

		const registry1 = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });
		const stop1 = registry1.start();
		// 首次加载：父与子都在（父子都经 list() adopt）。
		assert.equal(registry1.installedAgentIds().includes("parent"), true, "parent adopted on first load");
		assert.notEqual(registry1.childActivityOf("child-rebuild"), null, "child registered on first load");
		stop1();

		// 插件 fiber 重建：新的 registry 实例用同一批仍存活的 agent 重新 start()。
		const registry2 = createLifecycleRegistry(ctx, { dshHomePath: dshHome(home), workspaceRoot: base, sessionScopes });
		const stop2 = registry2.start();
		// 缺陷点：重建后子代理必须仍在登记表里（修复前这里是 null）。
		assert.notEqual(
			registry2.childActivityOf("child-rebuild"),
			null,
			"live subagent re-adopted after fiber rebuild (was lost before the fix)"
		);
		stop2();
	});
});

// ---------------------------------------------------------------------------
// 2026-10-18 缺陷修复（步骤 3）：已结束子代理的**持久**复原
// ---------------------------------------------------------------------------
//
// 复现条件：子代理在**插件重建之前**就已经结束。此时
//   ① `children` 里没有它（fiber 已 dispose）；
//   ② 重建后的 `retiredChildren` 也没有它（新实例、空表）；
//   ③ `start()` 只 adopt 宿主仍列为活体的 agent —— 已结束的子代理不在其中。
// 于是登记表**结构性地**看不到它，而复核通道问的恰好是这种子代理
// （「复核者跑完了，现在登记它的结论」）。
//
// 修复：登记表未命中时回落到**子代理自己的会话记录**（宿主写的 header 证明它是
// 子代理、parentSession 证明血统；结论取它自己最后的正文），复原结果落进
// retiredChildren —— 后续 lookup / collect 照常命中。

test("fiber rebuild: a child that finished before the rebuild resolves from its own session record", async () => {
	await withTemp("ldvh-lc.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base);
		await registerProject(dshHome(home), { id: "demo", path: repo });

		// 宿主会话记录桩：形状与真实日志一致（首行 session header + 事件流）。
		// reviewer-1 是本会话的子代理；reviewer-2 属于**另一个**会话。
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
				// 最后一轮只有工具调用：不得用空值清掉既有结论（与 child.js 同规则）。
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

		// 前提：这个子代理**不在**登记表里（它早已结束，宿主不再把它列为活体）。
		assert.equal(registry.childConclusionOf("reviewer-1"), null, "前提：登记表看不到已结束的子代理");

		// ① 未命中 → 回落到子代理自己的会话记录。
		const resolved = await registry.resolveChild("reviewer-1", { parentSessionId: "session-parent" });
		assert.equal(resolved.ok, true, `必须能从会话记录复原：${JSON.stringify(resolved)}`);
		assert.equal(resolved.source, "session-record");
		assert.equal(resolved.record.parentAgentId, "session-parent");
		assert.equal(resolved.record.hydrated, true);
		assert.match(resolved.record.conclusion, /对象恰当性：符合/, "结论取子代理自己最后的正文");
		assert.equal(resolved.record.startedAt, new Date(1792306316104).toISOString(), "startedAt 回填到会话实际创建时刻");

		// ② 复原落地后就是普通登记表命中（第二次复核 / collect 不再读盘）。
		const again = await registry.resolveChild("reviewer-1");
		assert.equal(again.source, "registry");
		assert.equal(again.record, resolved.record, "同一份记录，不重复建");
		assert.equal(registry.childConclusionOf("reviewer-1"), resolved.record.conclusion);

		// ③ 轨迹可回读：hydrate + retire 都留痕。
		const trail = registry.registryActivitySnapshot();
		assert.equal(
			trail.some((e) => e.hook === "child/hydrated" && e.detail.childId === "reviewer-1"),
			true, "child/hydrated recorded"
		);
		assert.equal(
			trail.some((e) => e.hook === "child/retire" && e.detail.agentId === "reviewer-1" && e.detail.source === "session-record"),
			true, "复原记录进入同一个 retired 窗口（带来源）"
		);

		// ④ 走宿主的正规读取入口，且只读。
		assert.equal(opened.length >= 1, true);
		assert.equal(opened.every((o) => o.mode === "read"), true, `必须以只读模式读取：${JSON.stringify(opened)}`);

		// ⑤ 血统不符者仍被拒：登记表重建不能让任意会话冒充本会话的复核者。
		const foreign = await registry.resolveChild("reviewer-2", { parentSessionId: "session-parent" });
		assert.equal(foreign.ok, false, `别的会话的子代理不得被采纳：${JSON.stringify(foreign)}`);
		assert.match(foreign.reason, /lineage|血统/i);
		assert.equal(registry.childConclusionOf("reviewer-2"), null, "被拒的记录不得落表");
		assert.equal(
			registry.registryActivitySnapshot().some((e) => e.hook === "child/resolve-miss" && e.detail.childId === "reviewer-2"),
			true, "拒绝也留痕"
		);

		// ⑥ 真重建（新 registry 实例，同一批仍存活的宿主 agent）：复原能力必须在，
		//    且不依赖上一个实例遗留的内存。
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

// ---------------------------------------------------------------------------
// pre-step: 行动前双源召回注入（10 §5.3 行动前引导入口）
// ---------------------------------------------------------------------------

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
	// 两块都进：管辖判定 + 召回，是不同注入面。
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
	// 第二次：被注入的行已被记入台账，digest 未变 → 不再追加召回行。
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
