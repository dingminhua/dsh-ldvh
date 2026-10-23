// 守卫：本模块硬编码的闭集常量必须与规范原文逐字一致
//
// 权威：specs/01 §11.4「来源先行闭环」——「不得因现有实现方便而反向改变规范语义，
// 也不得在规范尚未成立时由 Code、测试、索引或页面先行制造事实上的第二规则源。」
//
// 本文件守的正是这条：`plugin/lib/precheck-record.js` 把 34 号与 03 号的若干闭集
// （进入信号、偏离形态、风险层、快通道五要素、§8.3 三判据…）写成了常量。这些常量
// 一旦与规范原文漂移，代码就成了**事实上的第二规则源**——规范说一套、代码判一套，
// 而且不会有任何测试报错。
//
// 故本文件逐条把常量回指到规范原文：**原文里必须还能逐字找到那个字符串**。
// 找不到就是漂移，测试失败。
//
// ## 本文件**不能**证明什么
//
// - 它不证明常量**完整**（原文某条新增了、代码没跟上，本文件查不出——只查「代码
//   里的每个值在原文中存在」，不查「原文里的每个值在代码中存在」）。这个不对称是
//   刻意的：完整性判定需要解析规范结构，那已越过机械层的边界（01 §10.3 渐进披露
//   的职责在 LVdH CLI，不在测试）。
// - 它不证明语义正确（措辞在原文中存在，不等于代码用它用对了）。
// - 它依赖 `specs/` 在同一仓库内可读。发布包内若无语料，测试会明确报「语料不可读」
//   而非静默通过（01 §10.1 三级来源回退的如实披露口径）。

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	CONDITIONAL_SECTIONS,
	DEVIATION_FIELDS,
	DEVIATION_FORMS,
	ENTRY_SIGNALS,
	EXCLUDED_ACTION_KINDS,
	FAILURE_ROUTES,
	FAST_PATH_REQUIREMENTS,
	HUMAN_GATE_ITEMS,
	NON_EQUIVALENCES,
	RECALL_MARKS,
	REQUIRED_SECTIONS,
	RETURN_ITEMS,
	REUSE_CONDITIONS,
	RISK_TIERS,
	STAGE_MINIMUM_TIER,
	THREE_WAY_ITEMS,
	APPLICATION_CRITERIA,
	GAP_FIELDS,
	CONFLICT_TIERS,
	DEVIATION_FORMS as FORMS,
} from "../lib/precheck-record.js";

const SPECS_DIR = join(import.meta.dirname, "..", "..", "specs");

async function readSpec(fileName) {
	try {
		return await readFile(join(SPECS_DIR, fileName), "utf8");
	} catch (error) {
		return null;
	}
}

/** 断言：每个字符串都能在原文里逐字找到；找不到即列出全部漂移项。 */
function assertVerbatim(specText, specLabel, groupLabel, values) {
	const drifted = values.filter((value) => !specText.includes(value));
	assert.deepEqual(
		drifted,
		[],
		`${specLabel} 的${groupLabel}与原文漂移（01 §11.4 禁第二规则源）：${drifted.join(" / ")}`,
	);
}

test("specs 语料可读（不可读须显式失败，不得静默通过）", async () => {
	const spec34 = await readSpec("34-规则遵守系统规范.md");
	const spec03 = await readSpec("03-业务系统基础规范.md");
	assert.ok(spec34 !== null, `语料不可读：${SPECS_DIR}/34-规则遵守系统规范.md（发布包内无语料时须如实失败）`);
	assert.ok(spec03 !== null, `语料不可读：${SPECS_DIR}/03-业务系统基础规范.md`);
});

test("34 §6 进入信号与排除条件：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	assertVerbatim(spec, "34 号", "进入信号", ENTRY_SIGNALS);
	assertVerbatim(spec, "34 号", "排除动作类型", EXCLUDED_ACTION_KINDS);
});

test("34 §8 失败分流四条：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	assertVerbatim(spec, "34 号", "失败去向", FAILURE_ROUTES);
	// 三段判断的三项在 §8 与 §12 中均以「生效／适用／行动允许」出现。
	assertVerbatim(spec, "34 号", "三段判断项", THREE_WAY_ITEMS.map((item) => item.label));
});

test("34 §8.3 三判据：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	assertVerbatim(spec, "34 号", "落实三判据", APPLICATION_CRITERIA.map((item) => item.label));
});

test("34 §9.1 偏离形态闭集：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	assertVerbatim(spec, "34 号", "偏离形态", DEVIATION_FORMS);
	assert.equal(FORMS.length, 4, "§9.1 恰四类，多一类或少一类都是漂移");
});

test("34 §12 交还七项：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	assertVerbatim(spec, "34 号", "交还项", RETURN_ITEMS.map((item) => item.label));
});

test("34 §15.1 Human Gate 四事项：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	assertVerbatim(spec, "34 号", "Gate 事项", HUMAN_GATE_ITEMS.map((item) => item.label));
});

test("34 §13/§14 禁止等式的九个词：须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	for (const item of NON_EQUIVALENCES) {
		assert.ok(spec.includes(item.left), `「${item.left}」不在 34 号原文中`);
		assert.ok(spec.includes(item.doesNotImply), `「${item.doesNotImply}」不在 34 号原文中`);
	}
});

test("34 §7.5 层级来源段：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	for (const tier of CONFLICT_TIERS) {
		assert.ok(spec.includes(tier.source), `层级来源「${tier.source}」不在原文中`);
	}
});

test("03 §6.1 风险三层：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("03-业务系统基础规范.md");
	assertVerbatim(spec, "03 号", "风险层", RISK_TIERS);
	// 34 §17 第 4 项禁增设 03 §6.1 之外的中间风险层——层数须恰为三。
	assert.equal(RISK_TIERS.length, 3, "34 §17 第 4 项禁止增设中间风险层");
});

test("03 §7.2 段名与条件条目：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("03-业务系统基础规范.md");
	assertVerbatim(spec, "03 号", "必需段名", REQUIRED_SECTIONS.map((s) => s.label));
	assertVerbatim(spec, "03 号", "条件条目名", CONDITIONAL_SECTIONS.map((s) => s.label));
});

test("03 §7.2 末句的两个召回标记：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("03-业务系统基础规范.md");
	// 「未声明」是本模块引入的第三个取值（缺省时如实留白），不要求原文存在。
	for (const mark of RECALL_MARKS.filter((m) => m !== "未声明")) {
		assert.ok(spec.includes(mark), `召回标记「${mark}」不在 03 §7.2 原文中`);
	}
	assert.ok(spec.includes("不得把未遍历写成已核对"), "§7.2 末句的禁止表述应仍在原文中");
});

test("03 §6.2 快通道五要素：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("03-业务系统基础规范.md");
	assertVerbatim(spec, "03 号", "快通道要素", FAST_PATH_REQUIREMENTS.map((item) => item.label));
});

test("34 §7.3 复用条件：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	const spec03 = await readSpec("03-业务系统基础规范.md");
	// 复用条件在 03 §7.3 定义、34 号引用；两个载体都应能对上措辞片段。
	for (const condition of REUSE_CONDITIONS) {
		const inThree = spec.includes(condition.label) || spec03.includes(condition.label);
		assert.ok(inThree, `复用条件「${condition.label}」不在 03 §7.3 或 34 号原文中`);
	}
});

test("34 §9.2 偏离登记四项：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	assertVerbatim(spec, "34 号", "偏离登记项", DEVIATION_FIELDS.map((item) => item.label));
});

test("34 §14 缺口登记：§14 该行未逐字列出三项名，故不得伪装成原文措辞", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	// 34 §14「未识别缺口的登记」行的成立条件是「未识别到的来源已被登记为缺口，
	// 而非静默略过」；它没有逐字列出「未识别的来源／影响的范围／缺口状态」三项名。
	// 故 GAP_FIELDS 的 label 是本模块按该行语义拆出的机械字段，已标 verbatim:false。
	// 本测试守的是：不得把自造字段名冒充成原文措辞。
	for (const field of GAP_FIELDS) {
		assert.equal(field.verbatim, false, `${field.label} 不是原文措辞，须标 verbatim:false`);
	}
	// 但原文的成立条件与禁止表述必须仍在——它们才是这一行的权威。
	assert.ok(spec.includes("未识别到的来源已被登记为缺口，而非静默略过"));
	assert.ok(spec.includes("不得以「已尽力」替代缺口登记"));
	// 同时确认三个 label 确实不在原文中（若日后 34 号明列，须把 verbatim 改真）。
	for (const field of GAP_FIELDS) {
		assert.ok(
			!spec.includes(field.label),
			`若 34 号已明列「${field.label}」，须把 GAP_FIELDS 的 verbatim 改为 true 并让其参与逐字守卫`,
		);
	}
});

test("34 §11 环节级声明：每个环节名须逐字来自原文", async () => {
	const spec = await readSpec("34-规则遵守系统规范.md");
	for (const stage of Object.keys(STAGE_MINIMUM_TIER)) {
		assert.ok(spec.includes(stage), `环节「${stage}」不在 34 §11 原文中`);
	}
});
