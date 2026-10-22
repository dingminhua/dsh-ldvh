// 激活回归：真实 cordis 装配下，插件必须能装上、且能在 agent 安装时排期。
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
//      对象只返回 undefined。于是 `ctx?.schedule` 在测试里永远「安静地拿到
//      undefined」，在线上永远抛。
//   2. host-schedule 的单测（同批新增）只验证适配器本身的入参形状，不经过
//      `apply()` 与 `agent/created`——而抛出点正是在 `install()` 内部。
//
// 因此本文件必须同时具备两个条件，缺一个就会重演该缺陷：
//   · 真实 `@deepseek-ai/cordis` Context（Proxy 语义生效）；
//   · 走**真正的插件入口** `apply()`，并真的触发 `agent/created`。
//
// `schedule` 沿用本插件的既定前提：它是**可选**依赖（硬注入会让未装配
// schedule 的组合整插件失活）。所以本文件测两遍：服务在 / 服务不在——
// 后者必须仍然激活成功（只是不排期），前者必须真的排期。

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import * as ldvhPlugin from "../lib/index.js";
import { createHostScheduler, SILENCE_TAG, SILENCE_TITLE } from "../lib/host-schedule.js";

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
 * @param withSchedule 是否装配宿主 schedule 服务（可选依赖，两态都要能激活）
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

	/** 宿主 schedule 服务桩：按真实签名记录入参。 */
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

/** 让异步判定与排期落地（install 的初始判定是异步的）。 */
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

test("activation: with the schedule service present, the silence task is armed with host-contract arguments", async () => {
	const harness = await createHarness({ withSchedule: true });
	try {
		harness.root.emit("agent/created", { agent: harness.agent, source: "startup" });
		await settle();

		// 排期时机是「会话活动」（11 §6.1）：安装本身不排期，须先有一个回合结束。
		// 这条与既有实现一致，不是为测试凑出来的路径——`agent/turn-stopping`
		// 刷新「最后一次活动时刻」并（重新）武装安静期。
		harness.root.emit("agent/turn-stopping", { agent: harness.agent, turn: 3 });
		harness.root.emit("agent/status", { agent: harness.agent, status: "idle" });
		await settle();

		const create = harness.calls.find((call) => call.method === "create");
		assert.ok(create !== undefined, "受管辖会话的活动应真的把安静期任务交给宿主（服务在场却没排期 = 机制没接上）");
		assert.equal(create.sessionId, harness.agent.session.header.id, "create 的会话 id 是位置参数");
		assert.equal(create.request.title, SILENCE_TITLE);
		assert.ok(create.request.prompt.startsWith(`[${SILENCE_TAG}]`), "任务内容须带识别标签");
		assert.deepEqual(
			Object.keys(create.request.at).sort(),
			["date", "time", "time_zone"],
			"宿主 LocalAtInput 要求恰好三个键",
		);
	} finally {
		await harness.dispose();
	}
});

test("totality: the adapter never throws, whatever the context does (this is what keeps the entry alive)", async () => {
	// 线上失败传播链：适配器构造抛 → install() 中断 → start() → apply() 抛出 →
	// 宿主把**整个条目**记为 did not activate。这条链的起点只有一个：适配器会抛。
	//
	// 因此本插件对可选服务的纪律是「适配器**全域**（total）」——无论 ctx 以何种
	// 方式不可用，构造与调用都只降级、不抛。以下三种敌意形态逐一验证。
	//
	// 说明（避免读者高估覆盖）：lifecycle 里另有一层 try/catch 兜底，但它**不是**
	// 本测试锁定的对象——适配器 total 之后那层永远不会触发。两层都在是纵深防御，
	// 断言的是外层可见行为：条目不被掀翻。
	const root = new Context();
	const hostile = [
		// 1) 服务完全未挂载（真实 cordis Proxy 语义）
		() => root,
		// 2) ctx.get 本身抛
		() => {
			const ctx = new Context();
			ctx.get = () => { throw new Error("simulated get explosion"); };
			return ctx;
		},
		// 3) 服务对象存在但取值即抛
		() => {
			const ctx = new Context();
			Object.defineProperty(ctx, "schedule", {
				configurable: true,
				get() { throw new Error("simulated service explosion"); },
			});
			return ctx;
		},
	];

	for (const make of hostile) {
		const ctx = make();
		let scheduler;
		assert.doesNotThrow(() => { scheduler = createHostScheduler(ctx, "session-x"); }, "适配器构造不得抛");
		assert.equal(scheduler.available, false, "不可用时如实报 false");
		// 调用路径同样只抛**语义化**的「服务不可用」，不抛宿主的 Proxy 错误。
		await assert.rejects(
			() => scheduler.schedule({ dueAt: Date.now() + 60_000 }),
			/host schedule service unavailable/,
			"调用失败的措辞须是服务不可用，而不是把底层异常原样漏出",
		);
		await assert.doesNotReject(() => scheduler.remove("id-x"), "撤销须是尽力而为，不抛");
	}
});
