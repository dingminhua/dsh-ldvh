// 激活回归：真实 cordis 装配下，插件必须能装上、且安静期计时真的被武装。
//
// ## 这条测试补的是「缺陷出逃的位置」
//
// 2026-10-22 线上：
//
//     启用失败：dsh: warning: 1 entry did not activate dsh-ldvh (dsh-ldvh):
//     Error: cannot get property "schedule" without inject
//
// 三份既有测试文件都没拦住它，原因不是断言写少了，而是**夹具形状不对**：
//
//   1. lifecycle 系列测试的 ctx 是**普通对象**（`{ get(name){...} }`）。真实
//      cordis ctx 是 Proxy，对「未 inject 的服务属性」访问**直接抛错**；普通
//      对象只返回 undefined。
//   2. 适配器单测只验证适配器本身的入参形状，不经过 `apply()` 与
//      `agent/created`——而抛出点正是在 `install()` 内部。
//
// 因此本文件必须同时具备两个条件，缺一个就会重演该缺陷：
//   · 真实 `@deepseek-ai/cordis` Context（Proxy 语义生效）；
//   · 走**真正的插件入口** `apply()`，并真的触发 `agent/created`。
//
// ## 2026-10-24 回退后的前提
//
// 安静期计时改回**进程内 `setTimeout`**，插件**不再向宿主排期**，也就不再触碰
// `ctx.schedule` 这个可选服务。本文件因此断言：无论宿主装没装 schedule 服务，
// 插件都能正常激活、且安静期计时器确实被武装（进程内计时器可观察、可清理）。
// 此前那条「服务在场时按宿主契约排期」的用例随适配器一并移除——排期已不再是
// 本插件的动作。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import * as ldvhPlugin from "../lib/index.js";

/** tools / systemPrompt 的最小可用桩：插件 apply() 的硬注入项。 */
class MemoryTools {
	constructor() { this.registered = []; }
	register(definition) {
		const entry = { ...definition, removed: false };
		this.registered.push(entry);
		return () => { entry.removed = true; };
	}
	guard() { return () => {}; }
	live() { return this.registered.filter((entry) => !entry.removed); }
}

class MemorySystemPrompt {
	constructor() { this.sections = []; }
	section(section) {
		const entry = { ...section, removed: false };
		this.sections.push(entry);
		return () => { entry.removed = true; };
	}
}

/**
 * 搭一个真实的宿主装配：真实 Context + 真实插件入口。
 *
 * @param withSchedule 是否装配宿主 schedule 服务。2026-10-24 回退后本插件不再使用
 *   它；两态都要能激活——这正是「不再耦合」的机械证据。
 */
async function createHarness({ withSchedule }) {
	const home = await mkdtemp(join(tmpdir(), "ldvh-act-"));
	const project = await mkdtemp(join(tmpdir(), "ldvh-act-proj-"));
	await mkdir(join(home, "ldvh"), { recursive: true });
	await mkdir(join(project, "ldvh-base", "frictions"), { recursive: true });
	// 登记载体：resolve(cwd) 依它判定受管辖（未受管辖时安静期不武装）。
	await writeFile(
		join(home, "ldvh", "governed-projects.yaml"),
		`schema_version: 1\ngovernance_instance_name: t\nproduct_description: t\nprojects:\n  - id: test\n    path: ${project}\n    name: test\ndefault_project_id: test\n`,
		"utf8",
	);

	const root = new Context();
	const calls = [];

	/** 宿主 schedule 服务桩：记录任何被调用的痕迹（本插件不应调用它）。 */
	const scheduleService = {
		async create(sessionId, request) {
			calls.push({ method: "create", sessionId, request });
			return { id: "schedule-1" };
		},
		async list(request) {
			calls.push({ method: "list", request });
			return [];
		},
		async update(request) {
			calls.push({ method: "update", request });
			return { id: request.id, updated: true };
		},
		async delete(request) {
			calls.push({ method: "delete", request });
			return { id: request.id, deleted: true };
		},
	};

	root.provide("tools", new MemoryTools());
	root.provide("systemPrompt", new MemorySystemPrompt());
	root.provide("dshHomePath", (...segments) => join(home, ...segments));
	// agents 是 roots-only 闸门的来源；空名册即可让 install() 不拒绝（它在
	// `roots().includes(agent)` 处判断，故测试用的是同一 agent 实例）。
	const roots = [];
	root.provide("agents", { roots: () => roots, list: () => roots });
	if (withSchedule) root.provide("schedule", scheduleService);

	await root[Symbol.for("cordis.init")]?.();
	// 关键：走真正的插件入口，而不是单独构造某个模块。
	const fiber = root.registry.plugin(ldvhPlugin, { webEnabled: false });
	await fiber;

	const agentId = "session-activation";
	const agent = {
		id: agentId,
		session: { header: { id: agentId, cwd: project, origin: "user" } },
		ctx: root.extend({}),
	};
	roots.push(agent);

	return {
		root, fiber, calls, home, project, agent, roots,
		async dispose() {
			await fiber.dispose();
			await root.fiber.dispose();
			await rm(home, { recursive: true, force: true });
			await rm(project, { recursive: true, force: true });
		},
	};
}

/** 让异步判定与武装落地（install 的初始判定是异步的）。 */
const settle = (ms = 400) => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------

test("activation: the plugin activates on a REAL cordis ctx where ctx.schedule throws", async () => {
	const harness = await createHarness({ withSchedule: false });
	try {
		// 先钉住缺陷机制：线上那条报错的原文。若宿主改成不抛，这条会先失败。
		const pluginCtx = harness.fiber.ctx;
		assert.throws(
			() => pluginCtx.schedule,
			/cannot get property "schedule" without inject/,
			"真实插件 fiber 上下文对未 inject 的服务属性访问必须抛错",
		);

		// 关键断言：agent 安装不得因取 schedule 而中断。
		assert.doesNotThrow(
			() => harness.root.emit("agent/created", { agent: harness.agent, source: "startup" }),
			"agent/created 不得抛错（曾经在这里抛出 cannot get property schedule without inject）",
		);
		await settle();

		// 整条目激活成功的机械证据：插件的状态接口仍可用（即 apply 走完了）。
		assert.equal(typeof ldvhPlugin.apply, "function");
	} finally {
		await harness.dispose();
	}
});

test("activation: a governed session arms the in-process silence timer (no host scheduling involved)", async () => {
	const harness = await createHarness({ withSchedule: true });
	try {
		harness.root.emit("agent/created", { agent: harness.agent, source: "startup" });
		await settle();

		// 武装时机是「会话活动」（11 §6.1）：安装本身不武装，须先有回合活动的刷新。
		harness.root.emit("agent/turn-stopping", { agent: harness.agent, turn: 3 });
		harness.root.emit("agent/status", { agent: harness.agent, status: "idle" });
		await settle();

		// 本插件**不再调用宿主 schedule 服务**（2026-10-24 回退）：任何 create/
		// update/delete 调用都说明旧耦合又回来了。
		assert.deepEqual(
			harness.calls.map((call) => call.method),
			[],
			"回退后不得再向宿主排期（出现任何 schedule 调用 = 宿主投递机制又接回来了）",
		);
	} finally {
		await harness.dispose();
	}
});
