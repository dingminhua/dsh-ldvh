
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
const CARRIERS_DIR = join(import.meta.dirname, "..", "..", "plugin-specs");

async function readSpec(fileName) {
	try {
		return await readFile(join(SPECS_DIR, fileName), "utf8");
	} catch (error) {
		return null;
	}
}

async function readCarrier(specKey) {
	const text = await readFile(join(CARRIERS_DIR, `${specKey}.yaml`), "utf8");
	const block = text.slice(text.indexOf("ldvh_spec:"));
	const requirements = [];
	const entryPattern = /^\s{4}- id: (\S+)\n\s{6}title: (.+)$/gm;
	const positions = [];
	for (const match of block.matchAll(entryPattern)) positions.push({ id: match[1], title: match[2], at: match.index });
	for (let index = 0; index < positions.length; index += 1) {
		const start = positions[index].at;
		const end = index + 1 < positions.length ? positions[index + 1].at : block.length;
		const chunk = block.slice(start, end);
		const textMatch = /\n\s{6}text: \|\n([\s\S]*)$/.exec(chunk);
		requirements.push({
			id: positions[index].id,
			title: positions[index].title,
			text: textMatch === null ? "" : textMatch[1].replace(/^\s{8}/gm, "").trimEnd(),
		});
	}
	return { specKey, requirements };
}

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

test("34 §12 交还十一项：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "交还项", RETURN_ITEMS.map((item) => item.label));
});

test("34 §15.1 Human Gate 五事项：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "Gate 事项", HUMAN_GATE_ITEMS.map((item) => item.label));
});

test("34 §15.1 五项：代码常量条数须等于原文条数（防「规范加条、代码不加」）", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	const section = spec.slice(spec.indexOf("### 15.1"));
	const gateSection = section.slice(0, section.indexOf("### 15.2"));
	const itemsInSpec = (gateSection.match(/^\d+\. /gm) ?? []).length;
	assert.equal(
		itemsInSpec,
		5,
		`§15.1 原文应为 5 条；若规范改了条数，本断言会提示同步 HUMAN_GATE_ITEMS（当前 ${HUMAN_GATE_ITEMS.length} 条）`,
	);
	assert.equal(
		HUMAN_GATE_ITEMS.length,
		itemsInSpec,
		"代码常量条数须等于原文条数——少即漏承接（机械门禁面窄于规范），多即凭空增项",
	);
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
	assert.equal(RISK_TIERS.length, 3, "34 §17 第 4 项禁止增设中间风险层");
});

test("03 §7.2 段名与条件条目：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("03-业务系统基础规范.md");
	assertVerbatim(spec, "03 号", "必需段名", REQUIRED_SECTIONS.map((s) => s.label));
	assertVerbatim(spec, "03 号", "条件条目名", CONDITIONAL_SECTIONS.map((s) => s.label));
});

test("03 §7.2 末句的两个召回标记：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("03-业务系统基础规范.md");
	for (const mark of RECALL_MARKS.filter((m) => m !== "未声明")) {
		assert.ok(spec.includes(mark), `召回标记「${mark}」不在 03 §7.2 原文中`);
	}
	assert.ok(spec.includes("不得把未遍历写成已核对"), "§7.2 末句的禁止表述应仍在原文中");
});

test("03 §6.2 快通道五要素：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("03-业务系统基础规范.md");
	assertVerbatim(spec, "03 号", "快通道要素", FAST_PATH_REQUIREMENTS.map((item) => item.label));
});

test("03 §7.3 复用条件：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	const spec03 = await readSpec("03-业务系统基础规范.md");
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
	for (const field of GAP_FIELDS) {
		assert.equal(field.verbatim, false, `${field.label} 不是原文措辞，须标 verbatim:false`);
	}
	assert.ok(spec.includes("未识别到的来源已被登记为缺口，而非静默略过"));
	assert.ok(spec.includes("不得以「已尽力」替代缺口登记"));
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

const SECTION_17_LEADINGS = [
	"不建立持久搜索索引",
	"不把预检变仪式",
	"不为本系统新建事实类型、状态字段或专属存储",
	"不自行增设 03 §6.1 之外的中间风险层",
	"不把双源召回系统扩张为「规则解释者」",
	"不以本系统的横切性为由要求其它规范重复其判据",
	"不为「未来可能的规则冲突分析」预设冲突图或优先级表",
	"不用相似度、embedding、关键词权重或 AI 输出自动裁决相关性、适用性或事实结论",
	"不把召回质量当作可自动验收的指标",
];

test("34 §17 的九条红线：条数与身份都须与原文一致（序数引用才有依据）", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	const start = spec.indexOf("## 17. 反过度设计红线");
	assert.ok(start >= 0, "34 §17 标题已改：「反过度设计红线」不在原文中");
	const section = spec.slice(start);
	const items = [...section.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({
		ordinal: Number(m[1]),
		text: m[2].replace(/\*\*/g, ""),
	}));

	assert.deepEqual(
		items.map((i) => i.ordinal),
		items.map((_, idx) => idx + 1),
		"§17 的序号须从 1 连续编号；否则 lib 里的「第 N 项」引用整体指错条文",
	);
	assert.equal(items.length, SECTION_17_LEADINGS.length, "§17 条数与已核对的身份清单不符");
	const mismatched = items
		.map((item, idx) => (item.text.startsWith(SECTION_17_LEADINGS[idx]) ? null : `第 ${item.ordinal} 项开头不是「${SECTION_17_LEADINGS[idx]}」，实为「${item.text.slice(0, 24)}…」`))
		.filter(Boolean);
	assert.deepEqual(mismatched, [], `§17 条目身份漂移：${mismatched.join("；")}`);
});

test("§17 第 5 条（不得扩张为规则解释者）：代码中无解释执行路径", async () => {
	const source = await readFile(join(import.meta.dirname, "..", "lib", "precheck-record.js"), "utf8");
	assert.ok(!/\binterpret(Rule|Regulation|Clause)\s*\(/.test(source), "不得出现解释规则含义的函数");
	const spec = await readSpec("34-双源召回系统规范.md");
	assert.ok(spec.includes("不把双源召回系统扩张为「规则解释者」"));
});

test("§17 第 7 条（不预设冲突图）：CONFLICT_TIERS 逐行来自 §7.5 原文，不是预建结构", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	for (const tier of CONFLICT_TIERS) {
		assert.ok(spec.includes(tier.source), `层级来源「${tier.source}」不在原文 §7.5 中，疑为预建结构`);
	}
});

test("§17 第 6 条（不以横切性为由复制判据）：模块只在本文件定义一次闭集", async () => {
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

test("六条必停：每条的依据须逐字可回指载体原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	const section = spec.slice(spec.indexOf("### 16.1"));
	const stopSection = section.slice(0, section.indexOf("### 16.2"));
	assert.equal(STOP_RULES.length, 6, "本切片承接必停情形的第 1–6 条");
	for (const rule of STOP_RULES) {
		const anchor = rule.specRef.match(/第 (\d) 条/)[1];
		assert.equal(Number(anchor), rule.index, `specRef 的条次须与 index 一致（第 ${anchor} 条 vs index ${rule.index}）`);
	}

	const itemsInSpec = (stopSection.match(/^\d+\. /gm) ?? []).length;
	assert.equal(
		itemsInSpec,
		9,
		`§16.1 原文应为 9 条（第四次审核 B-1：第 7 项收窄为未完成召回、第 9 项新增零命中未如实声明）；若规范改了条数，本断言会提示复核本切片的承接范围（当前承接第 1–6 项）`,
	);
	assert.ok(
		STOP_RULES.length <= itemsInSpec,
		`本切片承接数（${STOP_RULES.length}）不得超过原文条数（${itemsInSpec}）`,
	);


	const carrier = await readCarrier("rule-compliance-verification");
	const stopEntry = carrier.requirements.find((entry) => entry.id === "stop");
	assert.ok(stopEntry !== undefined, "rule-compliance-verification 载体须有 stop 条目");
	const carrierItems = (stopEntry.text.match(/^\s*-\s+/gm) ?? []).length;
	assert.equal(
		carrierItems,
		itemsInSpec,
		`载体 stop 条目的必停情形条数（${carrierItems}）须与原文 §16.1 的条数（${itemsInSpec}）一致`,
	);
	for (const rule of STOP_RULES) {
		const anchor = Number(rule.specRef.match(/第 (\d) 条/)[1]);
		const bullet = (stopEntry.text.match(/^\s*-\s+(.*)$/gm) ?? [])[anchor - 1] ?? "";
		assert.ok(bullet.length > 0, `载体 stop 条目第 ${anchor} 条须有内容`);
		assert.ok(
			rule.specRef.includes("rule-compliance-verification 的 stop 条目"),
			`第 ${anchor} 条的依据须指向 rule-compliance-verification 的 stop 条目`,
		);
	}
});

test("34 §16.2 四种允许动作与 §16.3 恢复要求：代码常量须逐字来自原文", async () => {
	const spec = await readSpec("34-双源召回系统规范.md");
	assertVerbatim(spec, "34 号", "暂停期间允许动作", SUSPENSION_ALLOWED_ACTIONS.map((a) => a.label));
	assert.ok(spec.includes("恢复须与触发原因对应"));
	assert.ok(spec.includes("补齐后的识别不追溯性地使偏离消失"));
	assert.ok(spec.includes("同一停止条件恢复后"));
});

