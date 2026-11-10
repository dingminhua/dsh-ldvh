// 真实任务评测集的结构守护（2026-11-11）
//
// 本文件**不测召回质量**（那是 `scripts/recall-real-eval.mjs` 的读数），只测
// 评测集本身是否还是一份可用的评测集。理由：这类数据文件最容易烂的方式不是
// 「数值变差」，而是**标注悄悄失真**——答案对象被废止、`context` 被改写成
// 与真实对话不符、`kind` 分类被随手改，而这些都不会让任何断言转红。
//
// 四条约束，逐条对应一种已识别的腐烂方式：
//   1. 每条都要有 `basis`——没有依据的标注等于把评测集变成主观印象；
//   2. `ellipsis` 必须有 `context`——否则它退化成「测注入多少噪音」，
//      而不是「测有没有找回正确话题」（这正是初版的错）；
//   3. `ref` 的答案必须为空——Spark/终态 WorkCase 不进默认候选，标注非空
//      等于要求实现越界；
//   4. `kind` 不得越界，且四类都要有样本——某一类被悄悄删空会让报表少一行，
//      而少一行不会有人注意。
//
// 判据都是**结构性的**，不断言具体数值：数值随语料漂移，属读数不属契约。

import assert from "node:assert/strict";
import test from "node:test";

import { REAL_CASES, REAL_CASE_KINDS, isRealCaseRelated } from "./recall-real-cases.mjs";

test("评测集：每条须有标注依据，且依据不得是空话", () => {
	const missing = REAL_CASES.filter((c) => typeof c.basis !== "string" || c.basis.trim().length < 10);
	assert.deepEqual(
		missing.map((c) => c.q),
		[],
		"每条都必须写清「为什么这是应得答案」（≥10 字），否则标注无法复核",
	);
});

test("评测集：ellipsis 类必须带真实上文", () => {
	// 初版把 ellipsis 的 want 标成空数组、且没有 context，后果是：任何「并入
	// 上文」的改法在它上面都测不出收益（分母恒为 0），实验会「证明」所有改法
	// 都没用。context 是这一类可用的前提，不是可选装饰。
	const bad = REAL_CASES.filter(
		(c) => c.kind === "ellipsis" && (typeof c.context !== "string" || c.context.trim() === ""),
	);
	assert.deepEqual(
		bad.map((c) => c.q),
		[],
		"ellipsis 条目的语义全在上文，缺 context 则该条无法测「有没有找回正确话题」",
	);
});

test("评测集：ref 类不得标注应得答案", () => {
	// 真实引用里绝大多数目标是 spark（20 §12.1／31 §10 不进自动注入），
	// 少数是已 closed 的 WorkCase（21 §13 默认候选只含 draft+open）。
	// 给它们标非空答案，等于要求注入路径越界交付——那是把边界测试写反了。
	const bad = REAL_CASES.filter((c) => c.kind === "ref" && c.want.length > 0);
	assert.deepEqual(
		bad.map((c) => c.q),
		[],
		"ref 类应为空标注：目标类型按规范本就不进默认注入路径",
	);
});

test("评测集：kind 闭集且四类都有样本", () => {
	const seen = new Set(REAL_CASES.map((c) => c.kind));
	for (const kind of seen) {
		assert.ok(
			REAL_CASE_KINDS.includes(kind),
			`未知 kind「${kind}」——新类别须先在 REAL_CASE_KINDS 登记，否则报表不单独成行`,
		);
	}
	for (const kind of REAL_CASE_KINDS) {
		const n = REAL_CASES.filter((c) => c.kind === kind).length;
		assert.ok(n > 0, `类别「${kind}」样本为空——某一类被悄悄删空会让报表少一行且无人注意`);
	}
});

test("评测集：判定函数与人工编集同口径", () => {
	// 两套集子的「命中」必须是同一件事，否则两侧读数不可比。
	assert.equal(isRealCaseRelated("双源召回系统规范", ["双源召回系统规范"]), true);
	assert.equal(isRealCaseRelated("双源召回系统规范", []), false);
	// 前 6 字前缀匹配：与 recall-quality-cases 的 isRelated 同形。
	assert.equal(isRealCaseRelated("双源召回系统规范（补编）", ["双源召回系统规"]), true);
	assert.equal(isRealCaseRelated("无关条目", ["双源召回系统规范"]), false);
});
