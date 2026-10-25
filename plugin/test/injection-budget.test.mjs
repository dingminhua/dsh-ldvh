// tests for plugin/lib/injection-budget.js —— 注入上下文总预算的协调层
//
// 权威：specs/10 §5.3（注入形式与预算由 10 定义、体量以固定常量承载）、
// specs/10 §9.1 第 2 项（改变引导面注入形式或预算边界须 Human 决定）、
// specs/34 §15.1 第 5 项（提高召回的字节预算常量须 Human 决定）、
// specs/02 §9.1（超预算必须分页/缩小/partial，不得静默截断）。
//
// 本文件守的是「协调纪律」：两块注入面共享一个档位预算，引导面先取、
// 召回面取剩余但不少于原下限；未登记档位如实拒绝。

import assert from "node:assert/strict";
import test from "node:test";

import {
	allocateInjectionBudget,
	guidanceByteCeiling,
} from "../lib/injection-budget.js";
import {
	DEFAULT_INJECTION_BUDGET_TIER,
	INJECTION_BUDGET_TIERS,
	resolveInjectionBudget,
} from "../lib/source-recall.js";
import { RECALL_BYTE_BUDGET } from "../lib/recall-injection.js";
import { GUIDANCE_CHAR_BUDGET } from "../lib/guidance-budget.js";

test("档位集合须为 Human 决定的 10/20/30/40/50 K（受控常量，非任意数）", () => {
	assert.deepEqual(
		Object.keys(INJECTION_BUDGET_TIERS).map(Number).sort((a, b) => a - b),
		[10, 20, 30, 40, 50],
		"档位集合是 Human 决定（2026-10-25）的量化档，不得增删而不经决定",
	);
	// 单位是 K 字节（1024），不是 1000——与字节计量统一，避免「10K 到底是多少」含糊。
	assert.equal(INJECTION_BUDGET_TIERS[10], 10 * 1024);
	assert.equal(INJECTION_BUDGET_TIERS[50], 50 * 1024);
});

test("未登记档位须如实拒绝，不得静默回落（10 §9.1 精神）", () => {
	// 静默回落会让 Human 以为自己选了 30K 而实际生效 10K——那正是「配置不可见」。
	const bad = resolveInjectionBudget(15);
	assert.equal(bad.ok, false);
	assert.match(bad.reason, /未登记的预算档位/);
	assert.match(bad.reason, /10\/20\/30\/40\/50/, "拒绝信息须列出可用档位");
	// 非法值仍给出一个可用字节数（供调用方继续工作），但 ok=false 使调用方可见。
	assert.equal(bad.bytes, INJECTION_BUDGET_TIERS[DEFAULT_INJECTION_BUDGET_TIER]);
});

test("缺省与字符串档位须正确解析", () => {
	assert.equal(resolveInjectionBudget(undefined).ok, true);
	assert.equal(resolveInjectionBudget(undefined).tier, DEFAULT_INJECTION_BUDGET_TIER);
	assert.equal(resolveInjectionBudget(null).bytes, INJECTION_BUDGET_TIERS[DEFAULT_INJECTION_BUDGET_TIER]);
	assert.equal(resolveInjectionBudget("20").bytes, INJECTION_BUDGET_TIERS[20], "字符串档位（表单可能给字符串）须可解析");
});

test("引导面字节上限须按状态折算，且不得低于其字符预算（防折算不足）", () => {
	for (const state of ["governed", "unavailable", "not_governed"]) {
		const bytes = guidanceByteCeiling(state);
		const chars = GUIDANCE_CHAR_BUDGET[state];
		assert.ok(bytes >= chars, `状态 ${state}：字节上限 ${bytes} 须 ≥ 字符预算 ${chars}（中文一字 3 字节）`);
	}
	// governed 实测 1288 字符 → 上限 1500 字符 → 折算 4500 字节。
	assert.equal(guidanceByteCeiling("governed"), GUIDANCE_CHAR_BUDGET.governed * 3);
});

test("分配：引导面先取、召回面取剩余但不少于原下限（档位只应让召回面变大）", () => {
	for (const tier of [10, 20, 30, 40, 50]) {
		const total = INJECTION_BUDGET_TIERS[tier];
		const alloc = allocateInjectionBudget(total, "governed");
		assert.equal(alloc.ok, true, `${tier}K 须可分配`);
		assert.equal(alloc.guidanceBytes, guidanceByteCeiling("governed"), "引导面取其上限");
		assert.ok(
			alloc.recallBytes >= RECALL_BYTE_BUDGET,
			`${tier}K：召回额度 ${alloc.recallBytes} 不得低于原下限 ${RECALL_BYTE_BUDGET}` +
				"（否则调高档位反而更糟）",
		);
	}
});

test("分配：总预算不足以容纳引导面时须如实拒绝（引导面不可裁）", () => {
	// 引导面是身份与规则入口，10 §10.1 第 3 项把「引导体量超预算」列为必停情形。
	const tiny = allocateInjectionBudget(1000, "governed");
	assert.equal(tiny.ok, false);
	assert.match(tiny.reason, /不足以容纳引导面/);
	assert.equal(tiny.recallBytes, 0);
});

test("分配：召回面额度须随档位单调不减（10K → 20K 只增不减）", () => {
	let prev = 0;
	for (const tier of [10, 20, 30, 40, 50]) {
		const alloc = allocateInjectionBudget(INJECTION_BUDGET_TIERS[tier], "governed");
		assert.ok(alloc.recallBytes >= prev, `${tier}K 的召回额度不得小于上一档`);
		prev = alloc.recallBytes;
	}
});

test("10K 档下召回面须足以容纳实测最大注入（不裁任何候选）", async () => {
	// 实测 2026-10-25：5 个 query 在 2400 下合计裁 2 条；在 10K 档额度下应 0 裁。
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	const { join } = await import("node:path");
	const ROOT = join(import.meta.dirname, "..", "..");
	const alloc = allocateInjectionBudget(INJECTION_BUDGET_TIERS[10], "governed");
	const queries = [
		"把 34 号规范改名成双源召回",
		"页面白屏了",
		"把这个接口改成幂等的",
		"提交这批改动",
		"优化性能",
	];
	let dropped = 0;
	for (const userText of queries) {
		const r = await buildRecallInjection({
			userText,
			projectRoot: ROOT,
			limit: 3,
			budgetBytes: alloc.recallBytes,
		});
		if (!r.inject) continue;
		dropped += Number((r.text.match(/裁去 (\d+) 条候选/) || [])[1] ?? 0);
	}
	assert.equal(dropped, 0, `10K 档（召回额度 ${alloc.recallBytes}）下不得再裁候选，实测裁 ${dropped} 条`);
});
