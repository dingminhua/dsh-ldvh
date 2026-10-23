// 召回质量基准（benchmark）
//
// ## 为什么要有这个文件
//
// 前面几轮的改进（动作性质判定、DF 过滤、正文层修复、编号层、minHits）
// 都是靠「看一眼返回结果，觉得好了」判断的。那不是证据。
//
// 本文件把「召回该给出什么」写成可复算的断言，每个用例同时声明：
//   - `must`：必须出现在结果里的（**召回率**，recall）
//   - `mustNot`：不得出现在结果里的（**精确度**，precision 的反面）
//   - `maxResults`：结果条数上限（防止「全给一遍」冒充高召回率）
//
// 基准**不是**规范要求。`34 §6`/§13 与 `02 §9` 都没有规定召回质量标准——
// 它们只规定「候选不是结论」「不得静默截断」。故这里守的是**工程可用性**：
// 召回若把半个语料库都给出来，AI 无法从中取用，功能等于没做。
//
// 阈值是**当前实测水平**，不是理想值。任何一项变差都应视为回归。

import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { recallForAction } from "../lib/source-recall.js";

const ROOT = join(import.meta.dirname, "..", "..");

/**
 * 基准用例。每条都应能在不查文档的情况下读懂「为什么这几个必须命中」。
 */
const BENCH = Object.freeze([
	{
		q: "把 34 号规范改名成双源召回，走独立审核",
		why: "点名编号 + 点名审核；34 号必须靠编号层直接命中",
		must: ["规则遵守系统规范"],
		mustNot: [],
		maxSpecs: 5,
	},
	{
		q: "改 guidance-text.js 的引导文本",
		why: "该文件由 10 号规定为受保护文本，只在 10 与 00 的正文里出现",
		must: ["环境接入"],
		mustNot: [],
		maxSpecs: 5,
	},
	{
		q: "受保护内容怎么改",
		why: "受保护内容的规定在 00 §4.3，必须命中 00",
		must: ["理念与构成"],
		mustNot: [],
		maxSpecs: 5,
	},
	{
		q: "写一个 ADR 记录这个取舍",
		why: "ADR 类型的规范必须命中；采坑经验不该因为 scope 提到 ADR 就排前面",
		must: ["ADR-决策"],
		mustNot: [],
		maxSpecs: 5,
	},
	{
		q: "这条经验该记成 Pitfall 吗",
		why: "Pitfall 类型规范 + 经验积累系统规范都应命中",
		must: ["Pitfall-踩坑经验"],
		mustNot: [],
		maxSpecs: 5,
	},
	{
		q: "给 Web 页面加一个新面板",
		why: "SPA 白屏是真实踩过的坑，必须召回",
		must: [],
		mustNot: [],
		maxSpecs: 5,
		maxFacts: 5,
	},
	{
		q: "提交前跑一下机械校验",
		why: "Git Gate 相关教训必须召回",
		must: [],
		mustNot: [],
		maxSpecs: 5,
		maxFacts: 5,
	},
]);

/** 不得命中的领域词：这些查询与它们无关，若命中说明匹配退化。 */
const IRRELEVANT = Object.freeze([
	{ q: "给 Web 页面加一个新面板", mustNotSpec: ["天气", "语料打包"] },
]);

async function recall(q, opts = {}) {
	return recallForAction({ action: q, root: ROOT, limit: 10, budgetBytes: 40000, ...opts });
}

test("基准：每条用例的 must 必须命中（召回率）", async () => {
	let total = 0;
	let hit = 0;
	const misses = [];
	for (const c of BENCH) {
		if (c.must.length === 0) continue;
		const r = await recall(c.q);
		const titles = r.specs.map((s) => s.title);
		for (const want of c.must) {
			total += 1;
			if (titles.some((t) => t.includes(want))) hit += 1;
			else misses.push(`「${c.q}」缺 ${want}（实际：${titles.join(" / ")}）`);
		}
	}
	assert.deepEqual(misses, [], `召回率 ${hit}/${total}`);
	assert.equal(hit, total, "所有 must 都必须命中");
});

test("基准：结果条数不得失控（高召回率不能靠「全给一遍」换来）", async () => {
	for (const c of BENCH) {
		const r = await recall(c.q, { limit: c.maxSpecs ?? 5 });
		assert.ok(
			r.specs.length <= (c.maxSpecs ?? 5),
			`「${c.q}」返回 ${r.specs.length} 份规范，上限 ${c.maxSpecs ?? 5}`,
		);
		if (c.maxFacts !== undefined) {
			assert.ok(r.facts.length <= c.maxFacts, `「${c.q}」事实超上限`);
		}
	}
});

test("基准：编号点名必须排第一（编号层是最高精度的信号）", async () => {
	const r = await recall("把 34 号规范改名成双源召回");
	assert.equal(r.specs[0].tier, 0, "34 号应以编号层（tier 0）居首");
	assert.match(r.specs[0].hitReason, /规范编号命中/);
});

test("基准：无关查询不得命中（防止匹配退化到「什么都中」）", async () => {
	for (const c of IRRELEVANT) {
		const r = await recall(c.q);
		const titles = r.specs.map((s) => s.title);
		for (const bad of c.mustNotSpec) {
			assert.ok(!titles.some((t) => t.includes(bad)), `「${c.q}」不该命中「${bad}」`);
		}
	}
});

test("基准：纯读取不触发召回（34 §6 排除条件）", async () => {
	const { shouldRecall } = await import("../lib/recall-injection.js");
	for (const q of ["看看 34 号规范有哪几节", "列出所有 ADR 的标题", "查一下有哪些 Pitfall"]) {
		assert.equal(shouldRecall(q), false, `「${q}」是纯读取，不应召回`);
	}
});

test("基准：事实源侧必须能召回真实踩过的教训（不是只有规范）", async () => {
	// 这三条是本项目真实发生过的事故，应在相应查询下被召回。
	const cases = [
		{ q: "Web 页面白屏了", want: "白屏" },
		{ q: "提交被 Git Gate 拦了", want: null }, // 只要求有事实命中
	];
	for (const c of cases) {
		const r = await recall(c.q);
		assert.ok(r.facts.length > 0, `「${c.q}」应召回事实`);
		if (c.want !== null) {
			assert.ok(
				r.facts.some((f) => f.title.includes(c.want)),
				`「${c.q}」应命中含「${c.want}」的教训，实际：${r.facts.map((f) => f.title).join(" / ")}`,
			);
		}
	}
});
