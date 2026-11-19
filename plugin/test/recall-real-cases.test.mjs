
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
	assert.equal(isRealCaseRelated("双源召回系统规范", ["双源召回系统规范"]), true);
	assert.equal(isRealCaseRelated("双源召回系统规范", []), false);
	assert.equal(isRealCaseRelated("双源召回系统规范（补编）", ["双源召回系统规"]), true);
	assert.equal(isRealCaseRelated("无关条目", ["双源召回系统规范"]), false);
});

test("报告口径：须能算对象级召回，不得只报 any-of 命中", () => {
	const relate = isRealCaseRelated("Code 实践与测试规范", ["Code 实践与测试规范"]);
	assert.equal(relate, true, "单对象判定须可用");
	assert.equal(isRealCaseRelated("别的标题", ["Code 实践与测试规范"]), false, "不相关须为 false");
	assert.equal(isRealCaseRelated("任意标题", []), false, "空 want 不算命中");
});

test("判据：类型名标注须靠候选的 type 字段匹配，不得从标题里找字符串", () => {
	assert.equal(
		isRealCaseRelated("只推 dev，main 发布线不含事实对象", ["Pitfall-踩坑经验"], "pitfall"),
		true,
		"类型名标注须能命中该类型的对象",
	);
	assert.equal(
		isRealCaseRelated("某条经验标题", ["Pitfall-踩坑经验"], "norm"),
		false,
		"别的类型的对象不得被判为命中——否则类型判据会过度宽松",
	);
	assert.equal(
		isRealCaseRelated("只推 dev，main 发布线不含事实对象", ["Pitfall-踩坑经验"], undefined),
		false,
		"未传 type 时类型名标注不得命中（否则漏传 type 的调用方会得到虚高读数）",
	);
	assert.equal(isRealCaseRelated("双源召回系统规范", ["双源召回系统规范"], "spec"), true);
	assert.equal(isRealCaseRelated("别的规范", ["双源召回系统规范"], "spec"), false);
});
