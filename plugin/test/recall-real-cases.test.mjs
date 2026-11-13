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
//   3. `ref` 的答案必须为空——关后对象不进默认候选，标注非空
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
	// 少数是已关闭的对象（默认候选只含活跃态）。
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

test("报告口径：须能算对象级召回，不得只报 any-of 命中", () => {
	// **独立复核（2026-11-11）指出**：原实现只报「多条 want 里命中任一条即算不漏」
	// （any-of）。复核实测：同一批 topic 用例，any-of 下 10/10，all-of 下仅 5/10，
	// 对象级只有 12/17 —— 「有主题的不漏」这句结论建立在最宽松的那个口径上。
	//
	// 三种口径各有用途，**并列披露**才诚实：
	//   · any-of  ：有进展就记（宽松，会掩盖缺口）
	//   · all-of  ：全部答案都在才记（严格，会掩盖部分进展）
	//   · 对象级  ：按对象逐个记（唯一能回答「该看到的看到了几成」）
	//
	// 本守卫钉住「判据函数支持按单个对象判定」这一点——没有它，对象级口径
	// 就算不出来，上面那句话也就无法被证伪。
	const relate = isRealCaseRelated("Code 实践与测试规范", ["Code 实践与测试规范"]);
	assert.equal(relate, true, "单对象判定须可用");
	assert.equal(isRealCaseRelated("别的标题", ["Code 实践与测试规范"]), false, "不相关须为 false");
	// want 为空时不构成命中（否则对象级分母会被污染）。
	assert.equal(isRealCaseRelated("任意标题", []), false, "空 want 不算命中");
});

test("判据：类型名标注须靠候选的 type 字段匹配，不得从标题里找字符串", () => {
	// **这里修的是一个让「事实侧精确率」恒接近 0 的度量 bug**（2026-11-11）。
	// `want` 里同时装了两类标注：
	//   · 规范名（34 条）：如「双源召回系统规范」，与标题直接可比；
	//   · 类型名（11 条）：如「ADR-决策」「Pitfall-踩坑经验」，**不是对象名**。
	//
	// 初版用同一条前缀匹配处理，于是任何具体对象标题（「只推 dev，main 发布线
	// 不含事实对象」）都匹配不上「ADR-决策」这六个字，判为无关。
	// 实测后果：topic 事实侧读数 2/113 = 1.8%，看着像「注入的全是无关经验」，
	// 实际是**判据与期望不同构导致的恒定假**（与「期望值与实际值同经归一化
	// 致断言恒真」同源的反面）。
	assert.equal(
		isRealCaseRelated("只推 dev，main 发布线不含事实对象", ["ADR-决策"], "adr"),
		true,
		"类型名标注须能命中该类型的对象",
	);
	assert.equal(
		isRealCaseRelated("某条经验标题", ["ADR-决策"], "pitfall"),
		false,
		"别的类型的对象不得被判为命中——否则类型判据会过度宽松",
	);
	// **缺 type 时不得静默判真**：调用方漏传就该得到 false 而非幸运命中。
	assert.equal(
		isRealCaseRelated("只推 dev，main 发布线不含事实对象", ["ADR-决策"], undefined),
		false,
		"未传 type 时类型名标注不得命中（否则漏传 type 的调用方会得到虚高读数）",
	);
	// 规范名仍走前缀匹配，不受影响。
	assert.equal(isRealCaseRelated("双源召回系统规范", ["双源召回系统规范"], "spec"), true);
	assert.equal(isRealCaseRelated("别的规范", ["双源召回系统规范"], "spec"), false);
});
