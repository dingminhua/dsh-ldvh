import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import * as ldvhPlugin from "../lib/index.js";

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

async function createHarness({ withSchedule }) {
	const home = await mkdtemp(join(tmpdir(), "ldvh-act-"));
	const project = await mkdtemp(join(tmpdir(), "ldvh-act-proj-"));
	await mkdir(join(home, "ldvh"), { recursive: true });
	await mkdir(join(project, "ldvh-base", "frictions"), { recursive: true });
	await writeFile(
		join(home, "ldvh", "governed-projects.yaml"),
		`schema_version: 1\ngovernance_instance_name: t\nproduct_description: t\nprojects:\n  - id: test\n    path: ${project}\n    name: test\ndefault_project_id: test\n`,
		"utf8",
	);

	const root = new Context();
	const calls = [];

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
	const roots = [];
	root.provide("agents", { roots: () => roots, list: () => roots });
	if (withSchedule) root.provide("schedule", scheduleService);

	await root[Symbol.for("cordis.init")]?.();
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
			await new Promise((resolve) => setTimeout(resolve, 50));
			await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
			await rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
		},
	};
}

const settle = (ms = 400) => new Promise((done) => setTimeout(done, ms));


test("activation: the plugin activates on a REAL cordis ctx where ctx.schedule throws", async () => {
	const harness = await createHarness({ withSchedule: false });
	try {
		const pluginCtx = harness.fiber.ctx;
		assert.throws(
			() => pluginCtx.schedule,
			/cannot get property "schedule" without inject/,
			"真实插件 fiber 上下文对未 inject 的服务属性访问必须抛错",
		);

		assert.doesNotThrow(
			() => harness.root.emit("agent/created", { agent: harness.agent, source: "startup" }),
			"agent/created 不得抛错（曾经在这里抛出 cannot get property schedule without inject）",
		);
		await settle();

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

		harness.root.emit("agent/turn-stopping", { agent: harness.agent, turn: 3 });
		harness.root.emit("agent/status", { agent: harness.agent, status: "idle" });
		await settle();

		assert.deepEqual(
			harness.calls.map((call) => call.method),
			[],
			"回退后不得再向宿主排期（出现任何 schedule 调用 = 宿主投递机制又接回来了）",
		);
	} finally {
		await harness.dispose();
	}
});
