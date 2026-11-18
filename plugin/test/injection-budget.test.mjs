
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import {
	DEFAULT_INJECTION_BUDGET_TIER,
	INJECTION_BUDGET_TIERS,
	resolveInjectionBudget,
} from "../lib/source-recall.js";
import { buildRecallInjection, RECALL_BYTE_BUDGET } from "../lib/recall-injection.js";

const ROOT = join(import.meta.dirname, "..", "..");

test("档位集合须为 Human 决定的 10/20/30/40/50 K（受控常量，非任意数）", () => {
	assert.deepEqual(
		Object.keys(INJECTION_BUDGET_TIERS).map(Number).sort((a, b) => a - b),
		[10, 20, 30, 40, 50],
		"档位集合是 Human 决定（2026-10-25）的量化档，不得增删而不经决定",
	);
	assert.equal(INJECTION_BUDGET_TIERS[10], 10 * 1024);
	assert.equal(INJECTION_BUDGET_TIERS[50], 50 * 1024);
});

test("未登记档位须如实拒绝，不得静默回落（10 §9.1 精神）", () => {
	const bad = resolveInjectionBudget(15);
	assert.equal(bad.ok, false);
	assert.match(bad.reason, /未登记的预算档位/);
	assert.match(bad.reason, /10\/20\/30\/40\/50/, "拒绝信息须列出可用档位");
	assert.equal(bad.bytes, INJECTION_BUDGET_TIERS[DEFAULT_INJECTION_BUDGET_TIER]);
});

test("缺省与字符串档位须正确解析", () => {
	assert.equal(resolveInjectionBudget(undefined).ok, true);
	assert.equal(resolveInjectionBudget(undefined).tier, DEFAULT_INJECTION_BUDGET_TIER);
	assert.equal(resolveInjectionBudget(null).bytes, INJECTION_BUDGET_TIERS[DEFAULT_INJECTION_BUDGET_TIER]);
	assert.equal(resolveInjectionBudget("20").bytes, INJECTION_BUDGET_TIERS[20], "字符串档位（表单可能给字符串）须可解析");
});

test("默认档位须显著大于旧常量（否则「数值偏小」未解决）", () => {
	const def = resolveInjectionBudget(undefined).bytes;
	assert.ok(
		def > RECALL_BYTE_BUDGET * 2,
		`默认档 ${def} 字节须明显大于旧常量 ${RECALL_BYTE_BUDGET}（Human 判定数值偏小）`,
	);
});

test("10K 档下召回面须足以容纳实测最大注入（不裁任何候选）", async () => {
	const budget = resolveInjectionBudget(DEFAULT_INJECTION_BUDGET_TIER).bytes;
	const queries = [
		"把 34 号规范改名成双源召回",
		"页面白屏了",
		"把这个接口改成幂等的",
		"提交这批改动",
		"优化性能",
	];
	let dropped = 0;
	let candidates = 0;
	for (const userText of queries) {
		const r = await buildRecallInjection({ userText, projectRoot: ROOT, limit: 3, budgetBytes: budget });
		if (!r.inject) continue;
		dropped += Number((r.text.match(/裁去 (\d+) 条候选/) || [])[1] ?? 0);
		candidates += (r.text.match(/^- /gm) || []).length;
	}
	assert.equal(dropped, 0, `10K 档（${budget} 字节）下不得再裁候选，实测裁 ${dropped} 条`);
	assert.ok(candidates > 0, "须确有候选返回（前提成立）");
});

test("档位提高不得改变召回结果内容（只影响是否裁断，不影响候选质量）", async () => {
	const at10 = resolveInjectionBudget(10).bytes;
	const at50 = resolveInjectionBudget(50).bytes;
	const r10 = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 3, budgetBytes: at10 });
	const r50 = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 3, budgetBytes: at50 });
	assert.equal(r10.inject, r50.inject);
	const titles10 = (r10.text.match(/^- .*$/gm) || []).join("\n");
	const titles50 = (r50.text.match(/^- .*$/gm) || []).join("\n");
	assert.equal(titles10, titles50, "候选内容应相同（档位不改变召回质量，只改变是否裁断）");
});

test("Config 字段 injectionBudgetTier 须有约束且默认 10（Major-1/Major-4）", async () => {
	const { Config } = await import("../lib/index.js");
	assert.ok(Config, "须导出 Config");
	const parsed = Config({});
	const tier = parsed?.injectionBudgetTier;
	const value = tier && typeof tier.get === "function" ? tier.get() : tier;
	assert.equal(value, 10, "缺省档位须为 10（默认档）");
});

test("非法档位须在消费点如实拒绝，且非数值不得静默兜底（Major-1/D3）", async () => {
	const { resolveInjectionBudget } = await import("../lib/source-recall.js");
	const nanResult = resolveInjectionBudget(Number.NaN);
	assert.equal(nanResult.ok, false, "NaN 须被拒绝，不得静默回落默认档");
	for (const bad of [15, -1, 10.5, 1e3]) {
		const r = resolveInjectionBudget(bad);
		assert.equal(r.ok, false, `档位 ${bad} 须被拒绝`);
		assert.match(r.reason, /10\/20\/30\/40\/50/);
	}
});

test("档位解析须与 lifecycle 接线同源（getInjectionBudget → buildRecallInjection）", async () => {
	const { resolveInjectionBudget } = await import("../lib/source-recall.js");
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	const bytes = resolveInjectionBudget(10).bytes;
	const r = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 3, budgetBytes: bytes });
	assert.equal(r.inject, true);
	assert.equal(r.result.budget.limitBytes, bytes, "档位字节数须作为 budgetBytes 生效");
	assert.ok(Buffer.byteLength(r.text, "utf8") <= bytes, "实际注入须 ≤ 档位预算");
});
