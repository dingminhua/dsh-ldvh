// **召回的真实宿主接线验证**（2026-10-24，第 61 轮）。
//
// ## 这条测试补的是「目标第（1）项的最后一步」
//
// 目标要求「recallForAction 在恰当时机**自动运行**并把命中注入上下文」。
// 既有的 recall-injection／source-recall 测试都是**直接调用** buildRecallInjection，
// 从未验证「宿主触发 pre-step 时，它会不会真的被调用、注入行会不会真的产生」。
//
// 本文件走真实路径：真实 `@deepseek-ai/cordis` Context → 真实 `apply()` →
// 真实 `agent/created` → 真实 `agent/pre-step` waterfall → 观察注入。
//
// **为什么不能用普通对象 ctx**：见 activation-real-cordis.test.mjs 的说明——
// 真实 cordis ctx 是 Proxy，对未 inject 的服务属性访问直接抛错；普通对象只返回
// undefined，于是「线上抛错、测试安静通过」的缺陷出逃。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import * as ldvhPlugin from "../lib/index.js";

class MemoryTools {
	constructor() { this.registered = []; }
	register(definition) { this.registered.push(definition); return () => {}; }
}
class MemorySystemPrompt {
	constructor() { this.sections = []; }
	register(section) { this.sections.push(section); return () => {}; }
}

const settle = (ms = 400) => new Promise((done) => setTimeout(done, ms));

async function createHarness() {
	const home = await mkdtemp(join(tmpdir(), "ldvh-recall-"));
	const project = await mkdtemp(join(tmpdir(), "ldvh-recall-proj-"));
	await mkdir(join(home, "ldvh"), { recursive: true });
	// 受管辖登记 + 一个最小事实载体，使召回有东西可返回。
	await writeFile(
		join(home, "ldvh", "governed-projects.yaml"),
		`schema_version: 1\ngovernance_instance_name: t\nproduct_description: t\nprojects:\n  - id: test\n    path: ${project}\n    name: test\ndefault_project_id: test\n`,
		"utf8",
	);
	await mkdir(join(project, "specs"), { recursive: true });
	await mkdir(join(project, "ldvh-base", "pitfalls"), { recursive: true });
	// 一份规范载体（让规范侧也能召回）。
	await writeFile(
		join(project, "specs", "99-测试载体规范.md"),
		`---\nldvh_spec:\n  spec_key: "test-carrier"\n  spec_id: "99"\n  spec_kind: "spec"\n  title: "测试载体规范"\n  canonical_path: "specs/99-测试载体规范.md"\n  scope: "适用于改动字段与提交校验的测试场景"\n---\n\n# 测试载体规范\n\n## 1. 内容\n\n字段改动须经提交校验。\n`,
		"utf8",
	);
	// 一个 Pitfall 载体。
	await writeFile(
		join(project, "ldvh-base", "pitfalls", "pitfall-11111111-1111-4111-8111-111111111111.md"),
		`---\ntitle: 字段改动未同步校验致提交被拒\nstatus: active\nscope: 适用于改动字段后未同步校验逻辑的场景\nobject_uid: 11111111-1111-4111-8111-111111111111\nfact_type_key: pitfall\n---\n\n# 字段改动未同步校验致提交被拒\n\n## 症状\n\n改动字段后提交被机械校验拒绝，提示契约不一致。\n`,
		"utf8",
	);

	const root = new Context();
	const roots = [];
	root.provide("tools", new MemoryTools());
	root.provide("systemPrompt", new MemorySystemPrompt());
	root.provide("dshHomePath", (...segments) => join(home, ...segments));
	root.provide("agents", { roots: () => roots, list: () => roots });
	await root[Symbol.for("cordis.init")]?.();

	const fiber = root.registry.plugin(ldvhPlugin, { webEnabled: false });
	await fiber;

	const agentId = "session-recall";
	const agent = {
		id: agentId,
		session: { header: { id: agentId, cwd: project, origin: "user" } },
		ctx: root.extend({}),
	};
	roots.push(agent);

	return {
		root, agent, project,
		async dispose() {
			await fiber.dispose();
			await root.fiber.dispose();
			await rm(home, { recursive: true, force: true });
			await rm(project, { recursive: true, force: true });
		},
	};
}

/** 走真实的 pre-step waterfall，返回注入后的消息数组。 */
async function runPreStep(harness, userText, step = 1) {
	const batch = [{ id: "u1", role: "user", content: [{ type: "text", text: userText }] }];
	const decision = await harness.root.waterfall(
		"agent/pre-step",
		{ agent: harness.agent, messages: batch, turn: 1, step },
		async () => ({ kind: "continue", messages: batch }),
	);
	return decision;
}

// ---------------------------------------------------------------------------

test("召回：真实 pre-step 触发后，注入行须真的出现（目标第(1)项的最后一步）", async () => {
	const harness = await createHarness();
	try {
		harness.root.emit("agent/created", { agent: harness.agent, source: "startup" });
		await settle();

		const decision = await runPreStep(harness, "改一下字段然后提交校验");
		// 注：`kind` 为 "enter" 是**正常返回**（带注入消息时用它），
		// 不是拦截；拦截是 "reject"。此处置信与 `guidance.js:370` 同源。
		assert.notEqual(decision.kind, "reject", "pre-step 不得拦截回合");
		assert.equal(decision.kind, "enter", "有注入时返回 enter");

		// 关键：注入的消息里须有召回行。
		const messages = Array.isArray(decision.messages) ? decision.messages : [];
		const recallRows = messages.filter((m) => {
			const text = (m.content ?? []).map((c) => c.text ?? "").join("");
			return /双源召回/.test(text);
		});
		assert.ok(
			recallRows.length > 0,
			`真实 pre-step 后应出现召回注入行；实际消息 ${messages.length} 条：${messages.map((m) => (m.content ?? []).map((c) => (c.text ?? "").slice(0, 20)).join("")).join(" | ")}`,
		);
		// 注入行须含候选（而非只有标题）。
		const recallText = recallRows[0].content.map((c) => c.text ?? "").join("");
		assert.match(recallText, /规范源|事实源/, "召回行须列出候选来源");
		// 且须真的召回到本仓储的载体（不是空行）。
		assert.match(recallText, /测试载体规范|字段改动未同步校验/, `召回行须含实际候选，实际内容：${recallText.slice(0, 300)}`);
	} finally {
		await harness.dispose();
	}
});

test("召回：仅在 step===1 注入（不得每步重复）", async () => {
	const harness = await createHarness();
	try {
		harness.root.emit("agent/created", { agent: harness.agent, source: "startup" });
		await settle();

		const first = await runPreStep(harness, "改一下字段然后提交校验", 1);
		const firstRows = (first.messages ?? []).filter((m) =>
			/双源召回/.test((m.content ?? []).map((c) => c.text ?? "").join("")),
		);
		assert.ok(firstRows.length > 0, "step 1 应有召回行");

		const later = await runPreStep(harness, "改一下字段然后提交校验", 2);
		const laterRows = (later.messages ?? []).filter((m) =>
			/双源召回/.test((m.content ?? []).map((c) => c.text ?? "").join("")),
		);
		assert.equal(laterRows.length, 0, "step 2 不得再注入召回行");
	} finally {
		await harness.dispose();
	}
});
