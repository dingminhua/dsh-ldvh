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
	STOP_CONDITIONS,
	STOP_RULES,
	SUSPENSION_ALLOWED_ACTIONS,
	THREE_WAY_ITEMS,
	APPLICATION_CRITERIA,
	GAP_FIELDS,
	HANDOVER_LAYERS,
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
	const spec34 = await readSpec("34-双源召回系统规范.md");
	const spec03 = await readSpec("03-业务系统基础规范.md");
	assert.ok(spec34 !== null, `语料不可读：${SPECS_DIR}/34-双源召回系统规范.md（发布包内无语料时须如实失败）`);
	assert.ok(spec03 !== null, `语料不可读：${SPECS_DIR}/03-业务系统基础规范.md`);
});

test("34 §6 进入信号与排除条件：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "进入信号", ENTRY_SIGNALS);
	assertVerbatim(spec, "34 号", "排除动作类型", EXCLUDED_ACTION_KINDS);
});

test("34 §8 失败分流四条：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "失败去向", FAILURE_ROUTES);
	// 三段判断的三项在 §8 与 §12 中均以「生效／适用／行动允许」出现。
	assertVerbatim(spec, "34 号", "三段判断项", THREE_WAY_ITEMS.map((item) => item.label));
});

test("34 §8.3 三判据：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "落实三判据", APPLICATION_CRITERIA.map((item) => item.label));
});

test("34 §9.1 偏离形态闭集：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "偏离形态", DEVIATION_FORMS);
	assert.equal(FORMS.length, 4, "§9.1 恰四类，多一类或少一类都是漂移");
});

test("34 §12 交还七项：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "交还项", RETURN_ITEMS.map((item) => item.label));
});

test("34 §15.1 Human Gate 四事项：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "Gate 事项", HUMAN_GATE_ITEMS.map((item) => item.label));
});

test("34 §13/§14 禁止等式的九个词：须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	for (const item of NON_EQUIVALENCES) {
		assert.ok(spec.includes(item.left), `「${item.left}」不在 34 号原文中`);
		assert.ok(spec.includes(item.doesNotImply), `「${item.doesNotImply}」不在 34 号原文中`);
	}
});

test("34 §7.5 层级来源段：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
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
	const spec = await readSpec("34-双源召回系统规范.md");
	const spec03 = await readSpec("03-业务系统基础规范.md");
	// 复用条件在 03 §7.3 定义、34 号引用；两个载体都应能对上措辞片段。
	for (const condition of REUSE_CONDITIONS) {
		const inThree = spec.includes(condition.label) || spec03.includes(condition.label);
		assert.ok(inThree, `复用条件「${condition.label}」不在 03 §7.3 或 34 号原文中`);
	}
});

test("34 §9.2 偏离登记四项：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "偏离登记项", DEVIATION_FIELDS.map((item) => item.label));
});

test("34 §14 缺口登记：§14 该行未逐字列出三项名，故不得伪装成原文措辞", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
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
	const spec = await readSpec("34-双源召回系统规范.md");
	for (const stage of Object.keys(STAGE_MINIMUM_TIER)) {
		assert.ok(spec.includes(stage), `环节「${stage}」不在 34 §11 原文中`);
	}
});

// ---------------------------------------------------------------------------
// 34 §17 反过度设计红线（实为 7 条，非 4 条——2026-10-23 核对纠正）
// ---------------------------------------------------------------------------

test("34 §17 恰为 9 条红线（原 7 条 + 召回侧 2 条，第 1 条已合并原第 8 条）", async () => {
	// 2026-10-25 34 号改名：原 7 条中第 1 条吸收「不建持久搜索索引」（原拟作第 8 条，
	// 因与第 1 条同义重复而合并，01 §7.2 要求同一语义元素只完整展开一次），
	// 另新增「不用相似度裁决」与「不把召回质量当验收指标」两条 → 共 9 条。
	// 若将来再改条数，本断言会再次提示复核。
	const spec = await readSpec("34-双源召回系统规范.md");
	const section = spec.slice(spec.indexOf("## 17. 反过度设计红线"));
	const items = section.match(/^\d+\. /gm) ?? [];
	assert.equal(items.length, 9, "§17 实为 9 条；若规范改了条数，本断言会提示复核");
});

test("§17 第 5 条（不得扩张为规则解释者）：代码中无解释执行路径", async () => {
	const source = await readFile(join(import.meta.dirname, "..", "lib", "precheck-record.js"), "utf8");
	// 只禁止「执行解释」这类实现形态，不禁止注释里提到该词（本文件正解释了为何不做）。
	assert.ok(!/\binterpret(Rule|Regulation|Clause)\s*\(/.test(source), "不得出现解释规则含义的函数");
	// §17 第 5 条原文须仍在（守卫依据）。
	const spec = await readSpec("34-双源召回系统规范.md");
	assert.ok(spec.includes("不把双源召回系统扩张为「规则解释者」"));
});

test("§17 第 7 条（不预设冲突图）：CONFLICT_TIERS 逐行来自 §7.5 原文，不是预建结构", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	// 每一行的来源名都必须在 §7.5 原文中存在——承载原文，而非预造。
	for (const tier of CONFLICT_TIERS) {
		assert.ok(spec.includes(tier.source), `层级来源「${tier.source}」不在原文 §7.5 中，疑为预建结构`);
	}
});

test("§17 第 6 条（不以横切性为由复制判据）：模块只在本文件定义一次闭集", async () => {
	// 本模块不向其它规范或模块复制规则文本；此断言仅核对 §17 第 6 条原文仍在。
	const spec = await readSpec("34-双源召回系统规范.md");
	assert.ok(spec.includes("不以本系统的横切性为由要求其它规范重复其判据"));
});

test("03 §5.5 三层交还：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("03-业务系统基础规范.md");
	assertVerbatim(spec, "03 号", "交还层名", HANDOVER_LAYERS.map((l) => l.label));
});

test("34 §6 退出条件与停止情形：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "停止情形", STOP_CONDITIONS.map((c) => c.label));
	assert.ok(spec.includes("三段判断完成并生成预检落实记录后退出"));
	assert.ok(spec.includes("不得以「上次已确认」代替本次判断"));
});

test("34 §16.1 六条必停：每条的依据须逐字可回指原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	const section = spec.slice(spec.indexOf("### 16.1"));
	const stopSection = section.slice(0, section.indexOf("### 16.2"));
	// **本切片承接第 1–6 项**（不是「§16.1 恰六条」——2026-10-25 34 号改名后
	// §16.1 已增为 8 条，第 7、8 项属召回侧，不在本切片判据函数的覆盖范围内）。
	assert.equal(STOP_RULES.length, 6, "本切片承接 §16.1 第 1–6 项");
	for (const rule of STOP_RULES) {
		// 每条的依据片段须在 §16.1 原文中存在（防漂移）。
		const anchor = rule.specRef.match(/第 (\d) 项/)[1];
		assert.ok(stopSection.includes(`${anchor}.`), `§16.1 第 ${anchor} 项须在原文中`);
	}

	// **独立断言：从规范原文数 §16.1 的条目总数**。
	// 没有这一条时，「规范加条、代码不加」这种漂移完全不可见——上一版只断言
	// STOP_RULES.length===6 且逐项 anchor 存在，而 anchor 只在 1–6 里找，
	// 规范加到 8 条也照样通过（属空守护，2026-10-25 复审发现）。
	const itemsInSpec = (stopSection.match(/^\d+\. /gm) ?? []).length;
	assert.equal(
		itemsInSpec,
		8,
		`§16.1 原文应为 8 条；若规范改了条数，本断言会提示复核本切片的承接范围（当前承接第 1–6 项）`,
	);
	assert.ok(
		STOP_RULES.length <= itemsInSpec,
		`本切片承接数（${STOP_RULES.length}）不得超过原文条数（${itemsInSpec}）`,
	);
});

test("34 §16.2 四种允许动作与 §16.3 恢复要求：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "暂停期间允许动作", SUSPENSION_ALLOWED_ACTIONS.map((a) => a.label));
	assert.ok(spec.includes("恢复须与触发原因对应"));
	assert.ok(spec.includes("补齐后的识别不追溯性地使偏离消失"));
	assert.ok(spec.includes("同一停止条件恢复后"));
});
