// Tests for plugin/lib/host-schedule.js — the host schedule adapter (11 §6.1).
//
// ## 为什么必须有这个文件（缺陷出逃的根因）
//
// 2026-10-22 实机激活失败：
//
//     启用失败：dsh: warning: 1 entry did not activate dsh-ldvh (dsh-ldvh):
//     Error: cannot get property "schedule" without inject
//
// 适配器原以 `ctx?.schedule` **裸取属性**。普通对象桩上属性缺失返回 `undefined`
// （不抛），于是所有既有测试都通过了；而真实 cordis 上下文是 Proxy，对
// 「未 inject 且未 provide」的属性访问**直接抛错**（cordis `src/reflect.ts`
// 的 `handler.get`）。`schedule` 被本插件当作**可选**依赖（硬注入会让未装配
// schedule 的组合整插件失活），故这一取法在每个 agent 安装时必然抛出，
// `createHostScheduler` 抛 → `install()` 中断 → 整条目激活失败。
//
// 结论：**只用普通对象桩永远测不出这一类缺陷**。本文件因此以真实
// `@deepseek-ai/cordis` `Context` 为夹具，让 Proxy 语义参与判定。
//
// ## 第二层（更深的）错位：调用的形状不是宿主契约的形状
//
// 激活修好之后，适配器仍然**从未成功排期过一次**——它对 `update`／`delete`
// 传的参数不在宿主 `ScheduleUpdateRequest`／`ScheduleDeleteRequest` 里：
//   - `update({ id, at })`：宿主契约是 `{ sessionId, id, expected, change }`，
//     且 `expected` 是**完整记录**（乐观并发比对）。缺 `expected` 即
//     `schedule_conflict`，于是每次推迟都失败。
//   - `delete({ id })`：宿主契约是 `{ sessionId, id }`，缺会话绑定即
//     `schedule_not_found`，于是会话销毁后任务永不清理。
// 两条都只留一条 warn 日志，外部看不出差别。本文件按宿主真实签名断言**入参与
// 返回判定**，而不只断言「调用发生过」。

import { test } from "node:test";
import assert from "node:assert/strict";

import { Context } from "@deepseek-ai/cordis";
import { createHostScheduler, SILENCE_TAG, SILENCE_TITLE } from "../lib/host-schedule.js";

/**
 * 建一个**真实 cordis 上下文**，并（可选地）提供 schedule 服务桩。
 *
 * 关键在于 ctx 是 Proxy：这正是既有普通对象桩漏掉的那一层。`provide` 的时机
 * 可延后（`deferService`），用于覆盖「服务晚于插件就绪」的真实装配次序。
 */
/**
 * 建一个**真实 cordis 上下文**，并（可选地）提供 schedule 服务桩。
 *
 * 关键在于拿到的是**插件 fiber 的 ctx**，而不是根 ctx：只有 fiber 上下文才走
 * Proxy 的服务解析（根 ctx 的 `fiber.runtime` 为 null，属性缺失退化为
 * `reflect.get(prop, false)` 返回 undefined，**不抛**）。既有测试桩全是普通
 * 对象，正因如此漏掉了整条缺陷——所以夹具必须复现插件真实的 ctx 形态。
 */
async function cordisContext({ provideService = true } = {}) {
	const root = new Context();
	const calls = [];

	/** 宿主 `schedule` 服务桩：按真实签名记录入参，返回真实形状的结果。 */
	const service = {
		calls,
		async create(sessionId, request) {
			calls.push({ method: "create", sessionId, request });
			return { id: "schedule-1", kind: "at", ...request, scheduledAt: "2026-10-22T00:00:00.000Z" };
		},
		async list(request) {
			calls.push({ method: "list", request });
			return service.rows ?? [];
		},
		async update(request) {
			calls.push({ method: "update", request });
			return { id: request.id, updated: true, record: { id: request.id, ...request.change } };
		},
		async delete(request) {
			calls.push({ method: "delete", request });
			return { id: request.id, deleted: true };
		},
	};
	if (provideService) root.provide("schedule", service);

	// 复现本插件的 fiber：`schedule` **不在** inject 里（它是可选依赖）。
	let captured;
	class Probe {
		static inject = ["probe"];
		constructor(ctx) { captured = ctx; }
		apply() {}
	}
	root.provide("probe", {});
	const fiber = root.plugin(Probe);
	await fiber;

	return { root, ctx: captured, service, calls, fiber };
}

// ---------------------------------------------------------------------------
// 激活：裸取属性必须在真实 Proxy 上下文上抛错，适配器必须不抛
// ---------------------------------------------------------------------------

test("activation: a real cordis ctx throws on ctx.schedule — the adapter must NOT", async () => {
	const { ctx } = await cordisContext({ provideService: false });

	// 先固定住缺陷机制本身：这正是线上那条报错。若宿主某天改成不抛，
	// 这条断言会失败并提醒我们重新评估（它不是「测试桩的假设」）。
	assert.throws(
		() => ctx.schedule,
		/cannot get property "schedule" without inject/,
		"真实 cordis 上下文对未 inject 的服务属性访问必须抛错（线上报错原文）"
	);

	// 适配器在同一上下文下不得抛——构造它曾是整插件激活失败的起点。
	let scheduler;
	assert.doesNotThrow(() => { scheduler = createHostScheduler(ctx, "session-1"); });
	assert.equal(scheduler.available, false, "服务缺失时如实报不可用，而不是抛错");
});

test("activation: the adapter works when the service is provided", async () => {
	const { ctx, calls } = await cordisContext();
	const scheduler = createHostScheduler(ctx, "session-1");
	assert.equal(scheduler.available, true);

	await scheduler.schedule({ dueAt: Date.now() + 60_000 });
	assert.equal(calls[0].method, "list", "先列举查重，不直接创建");
	assert.equal(calls[1].method, "create");
	assert.equal(calls[1].sessionId, "session-1", "create 的会话 id 是**位置参数**，不是请求字段");
	assert.equal(calls[1].request.title, SILENCE_TITLE);
	assert.ok(calls[1].request.prompt.startsWith(`[${SILENCE_TAG}]`));
});

// ---------------------------------------------------------------------------
// 服务晚于插件就绪：可用性必须现读，不得在构造时冻结
// ---------------------------------------------------------------------------

test("availability is re-read per call, so a late-mounted service is picked up", async () => {
	const { root, ctx } = await cordisContext({ provideService: false });
	const scheduler = createHostScheduler(ctx, "session-1");
	assert.equal(scheduler.available, false, "构造时服务尚未挂载");

	// 宿主随后挂载（真实装配次序里 schedule 可能后于本插件）
	root.provide("schedule", {
		async create() { return { id: "schedule-late" }; },
		async list() { return []; },
		async update() { return { updated: true }; },
		async delete() { return { deleted: true }; },
	});

	assert.equal(scheduler.available, true, "服务到位后必须立即被视为可用（构造期缓存会让它永久不可用）");
	const id = await scheduler.schedule({ dueAt: Date.now() + 60_000 });
	assert.equal(id, "schedule-late");
});

// ---------------------------------------------------------------------------
// 原地更新：入参必须是宿主的 ScheduleUpdateRequest 形状
// ---------------------------------------------------------------------------

test("update uses the host ScheduleUpdateRequest shape (sessionId + expected + change)", async () => {
	const { ctx, service, calls } = await cordisContext();
	const existing = {
		id: "schedule-7",
		kind: "at",
		title: SILENCE_TITLE,
		prompt: `[${SILENCE_TAG}] session=session-1`,
		scheduledAt: "2026-10-22T00:00:00.000Z"
	};
	service.rows = [existing];

	const scheduler = createHostScheduler(ctx, "session-1");
	const id = await scheduler.schedule({ dueAt: Date.now() + 300_000 });

	assert.equal(id, "schedule-7", "已有任务时复用同一条 id，不新建");
	assert.equal(calls.filter((call) => call.method === "create").length, 0, "不得 create 第二条（宿主侧至多一条）");

	const update = calls.find((call) => call.method === "update");
	assert.ok(update !== undefined, "必须走原地更新");
	assert.equal(update.request.sessionId, "session-1", "会话绑定是查找键的一部分");
	assert.equal(update.request.id, "schedule-7");
	// expected 必须是**完整记录**：宿主的乐观并发逐字比对它。
	assert.deepEqual(update.request.expected, existing, "expected 必须是查到的完整记录，否则宿主判 schedule_conflict");
	// change 是带判别式的定时变更，不是裸 at。
	assert.equal(update.request.change.kind, "at", "定时变更必须带判别式 kind");
	assert.equal(typeof update.request.change.at, "object");
	assert.equal(update.request.change.at.time_zone !== undefined, true, "time_zone 必须存在（宿主要求恰好三个键）");
});

test("update rejects when the host reports a non-mutating result instead of claiming success", async () => {
	const { ctx, service } = await cordisContext();
	service.rows = [{ id: "schedule-9", kind: "at", title: SILENCE_TITLE, prompt: `[${SILENCE_TAG}] x`, scheduledAt: "2026-10-22T00:00:00.000Z" }];
	// 宿主用结果对象表达冲突，而不是抛。
	service.update = async () => ({ id: "schedule-9", updated: false, code: "schedule_conflict" });

	const scheduler = createHostScheduler(ctx, "session-1");
	await assert.rejects(
		() => scheduler.schedule({ dueAt: Date.now() + 60_000 }),
		/schedule_conflict/,
		"宿主判冲突时必须抛出，不得把未生效当成已生效"
	);
});

// ---------------------------------------------------------------------------
// 撤销：入参必须是宿主的 ScheduleDeleteRequest 形状
// ---------------------------------------------------------------------------

test("delete uses the host ScheduleDeleteRequest shape (sessionId included)", async () => {
	const { ctx, calls } = await cordisContext();
	const scheduler = createHostScheduler(ctx, "session-1");
	await scheduler.remove("schedule-3");

	const del = calls.find((call) => call.method === "delete");
	assert.ok(del !== undefined, "必须真的调用宿主删除");
	assert.deepEqual(del.request, { sessionId: "session-1", id: "schedule-3" });
	assert.equal(scheduler.cancelled.has("schedule-3"), true, "撤销意图须同步可观察");
});

// ---------------------------------------------------------------------------
// at 选择器：宿主 LocalAtInput 要求恰好 date / time / time_zone 三个键
// ---------------------------------------------------------------------------

test("at selector always carries time_zone (the host rejects a two-key local at)", async () => {
	const { ctx, calls } = await cordisContext();
	const scheduler = createHostScheduler(ctx, "session-1");
	await scheduler.schedule({ dueAt: Date.now() + 60_000 });

	const at = calls.find((call) => call.method === "create").request.at;
	assert.deepEqual(Object.keys(at).sort(), ["date", "time", "time_zone"], "缺键即 invalid_rule");
	assert.match(at.date, /^\d{4}-\d{2}-\d{2}$/);
	assert.match(at.time, /^\d{2}:\d{2}:\d{2}$/);
	assert.equal(typeof at.time_zone, "string");
	assert.ok(at.time_zone.length > 0);
});

// ---------------------------------------------------------------------------
// 服务缺失：fail-closed，不回落到自建计时器
// ---------------------------------------------------------------------------

test("missing service fails closed instead of falling back to a self-built timer", async () => {
	const { ctx } = await cordisContext({ provideService: false });
	const scheduler = createHostScheduler(ctx, "session-1");

	await assert.rejects(
		() => scheduler.schedule({ dueAt: Date.now() + 60_000 }),
		/host schedule service unavailable/,
		"11 §6.1 禁止自建计时器：服务缺失时只能如实失败"
	);
	// remove 是终局路径的尽力而为：服务缺失时静默返回，不抛。
	await assert.doesNotReject(() => scheduler.remove("whatever"));
});

test("a partial service (no update) is not used: 11 §6.1 requires in-place update", async () => {
	const { root, ctx } = await cordisContext({ provideService: false });
	root.provide("schedule", {
		async create() { return { id: "x" }; },
		async list() { return []; },
		async delete() { return { deleted: true }; },
		// 无 update：删后重建不具原子性，规范直接禁止该路径。
	});
	const scheduler = createHostScheduler(ctx, "session-1");
	assert.equal(scheduler.available, false, "缺 update 的服务不得用于承载");
});
