
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	FACT_TYPE_BY_SPEC_ID,
	RECALL_CRITERIA_COLUMNS,
	RECALL_CRITERIA_ITEMS,
	RECALL_CRITERIA_VERSION,
	allTypeKeyDerivedWords,
	loadRecallCriteria,
	parseRecallCriteriaTable,
} from "../lib/recall-criteria.js";

const ROOT = join(import.meta.dirname, "..", "..");

const HEADER = `| ${RECALL_CRITERIA_COLUMNS.join(" | ")} |`;
const SEPARATOR = "|---|---|---|---|";

const DEFAULT_MACHINE = {
	召回时机: "",
	默认候选状态: "active",
	核心语义字段: "decision, scope",
	类型词别名: "决策记录",
	关系展开: "superseded-by->adr",
	"F3/F4 展开": "",
	条数上限归属: "",
};

function buildTable(overrides = {}, shape = {}) {
	const header = shape.header ?? HEADER;
	const separator = shape.separator ?? SEPARATOR;
	const items = shape.items ?? [...RECALL_CRITERIA_ITEMS];
	const lines = [header, separator];
	for (const item of items) {
		if ((shape.omit ?? []).includes(item)) continue;
		const machine = Object.hasOwn(overrides, item) ? overrides[item] : (DEFAULT_MACHINE[item] ?? "");
		lines.push(`| ${item} | 规则：${item} | ${machine} | 依据：${item} |`);
	}
	return `${lines.join("\n")}\n`;
}

function expectFailure(text, code) {
	const result = parseRecallCriteriaTable(text, { file: "specs/99-Test.md", specId: "99", type: "adr" });
	assert.equal(result.ok, false, `期望解析失败，实得 ok=true（代码 ${code}）`);
	assert.equal(Object.hasOwn(result, "values"), false, "失败结果不得携带任何机械值");
	assert.ok(Array.isArray(result.errors) && result.errors.length > 0, "失败结果必须给出结构化错误");
	const codes = result.errors.map((e) => e.code);
	assert.ok(codes.includes(code), `期望错误码 ${code}，实得 ${codes.join(",")}`);
	for (const error of result.errors) {
		assert.equal(typeof error.message, "string");
		assert.notEqual(error.message.trim(), "", "错误必须说明缺什么");
	}
	return codes;
}

test("合法判据表：四列、七项、四类机械值全部解析", () => {
	const result = parseRecallCriteriaTable(buildTable({
		关系展开: "superseded-by->adr, absorbed-into->norm",
	}), { file: "specs/99-ADR-决策.md", specId: "99", type: "adr" });

	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.equal(result.version, RECALL_CRITERIA_VERSION);
	assert.equal(result.specId, "99");
	assert.equal(result.type, "adr");
	assert.deepEqual(result.values.defaultStatuses, ["active"]);
	assert.deepEqual(result.values.coreFields, ["decision", "scope"]);
	assert.deepEqual(result.values.typeAliases, ["决策记录"]);
	assert.deepEqual(result.values.relations, [
		{ relationKey: "superseded-by", targets: ["adr"] },
		{ relationKey: "absorbed-into", targets: ["norm"] },
	]);
	assert.deepEqual(result.values.notApplicable, {
		默认候选状态: false,
		核心语义字段: false,
		类型词别名: false,
		关系展开: false,
	});
});

test("explain: 表头版本锚必须逐字出现，且七项不得省行", () => {
	const result = parseRecallCriteriaTable(buildTable(), {});
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	const headerLine = buildTable().split("\n")[0];
	assert.ok(headerLine.includes(RECALL_CRITERIA_VERSION));
});

test("缺版本标记 → fail-closed（不得当作无表而静默通过）", () => {
	expectFailure(
		buildTable({}, { header: `| ${RECALL_CRITERIA_COLUMNS[0].replace("（recall-criteria/v1）", "")} | 本类型规则 | 机械值 | 依据/理由 |` }),
		"recall-criteria/missing_version_marker",
	);
});

test("版本不识别 → fail-closed", () => {
	expectFailure(
		buildTable({}, { header: `| 判据项（recall-criteria/v9） | 本类型规则 | 机械值 | 依据/理由 |` }),
		"recall-criteria/unknown_version",
	);
});

test("缺表 → fail-closed", () => {
	const result = parseRecallCriteriaTable("# 无表格的载体\n\n正文。\n", { file: "specs/99-Test.md", specId: "99", type: "adr" });
	assert.equal(result.ok, false);
	assert.equal(result.errors[0].code, "recall-criteria/missing_table");
	assert.equal(Object.hasOwn(result, "values"), false);
});

test("列名列序不符 → fail-closed", () => {
	expectFailure(
		buildTable({}, { header: `| 本类型规则 | 判据项（recall-criteria/v1） | 机械值 | 依据/理由 |` }),
		"recall-criteria/bad_columns",
	);
});

test("列数不符 → fail-closed", () => {
	expectFailure(
		buildTable({}, { header: `| 判据项（recall-criteria/v1） | 本类型规则 | 机械值 |` }),
		"recall-criteria/bad_columns",
	);
});

test("缺分隔行 → fail-closed", () => {
	expectFailure(buildTable({}, { separator: "| 不是分隔行 | | | |" }), "recall-criteria/missing_separator");
});

test("判据项不在闭集 / 重复 / 缺项 → fail-closed", () => {
	expectFailure(
		buildTable({}, { items: [...RECALL_CRITERIA_ITEMS, "新发明判据"] }),
		"recall-criteria/bad_item",
	);
	expectFailure(
		buildTable({}, { items: [...RECALL_CRITERIA_ITEMS, "召回时机"] }),
		"recall-criteria/duplicate_item",
	);
	const missing = expectFailure(buildTable({}, { omit: ["关系展开"] }), "recall-criteria/missing_item");
	assert.ok(missing.includes("recall-criteria/missing_item"));
});

test("必填机械值缺失（留空而非「不采用」）→ fail-closed，不猜默认值", () => {
	expectFailure(buildTable({ 核心语义字段: "" }), "recall-criteria/missing_machine_value");
	expectFailure(buildTable({ 关系展开: "" }), "recall-criteria/missing_machine_value");
});

test("默认候选状态形态非法（非 status 词 / 重复）→ fail-closed", () => {
	expectFailure(buildTable({ 默认候选状态: "active，open" }), "recall-criteria/bad_machine_value");
	expectFailure(buildTable({ 默认候选状态: "active, active" }), "recall-criteria/bad_machine_value");
	expectFailure(buildTable({ 默认候选状态: "Active" }), "recall-criteria/bad_machine_value");
});

test("核心语义字段形态非法（含空白 / 重复）→ fail-closed", () => {
	expectFailure(buildTable({ 核心语义字段: "decision, scope, decision" }), "recall-criteria/bad_machine_value");
	expectFailure(buildTable({ 核心语义字段: "decision scope" }), "recall-criteria/bad_machine_value");
});

test("类型词别名：成员唯一、不得与 fact_type_key 派生词冲突", () => {
	expectFailure(buildTable({ 类型词别名: "决策记录,决策记录" }), "recall-criteria/bad_machine_value");
	const derived = [...allTypeKeyDerivedWords()];
	assert.ok(derived.includes("norm") && derived.includes("norms"));
	expectFailure(buildTable({ 类型词别名: "norm" }), "recall-criteria/bad_machine_value");
	assert.equal(parseRecallCriteriaTable(buildTable({ 类型词别名: "决策记录" }), {}).ok, true);
});

test("关系展开：`\\|` 转义的多目标被还原成 `|` 分隔的目标表", () => {
	const result = parseRecallCriteriaTable(
		buildTable({ 关系展开: "inspired-by->spark\\|adr\\|subgoal, informs->adr\\|pitfall" }),
		{},
	);
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.deepEqual(result.values.relations, [
		{ relationKey: "inspired-by", targets: ["spark", "adr", "subgoal"] },
		{ relationKey: "informs", targets: ["adr", "pitfall"] },
	]);
	assert.equal(RECALL_CRITERIA_COLUMNS.length, 4);
});

test("关系展开形态非法（无 -> / 目标空 / relation_key 重复）→ fail-closed", () => {
	expectFailure(buildTable({ 关系展开: "superseded-by adr" }), "recall-criteria/bad_machine_value");
	expectFailure(buildTable({ 关系展开: "superseded-by->" }), "recall-criteria/bad_machine_value");
	expectFailure(buildTable({ 关系展开: "Superseded->adr" }), "recall-criteria/bad_machine_value");
	expectFailure(buildTable({ 关系展开: "superseded-by->adr, superseded-by->norm" }), "recall-criteria/bad_machine_value");
});

test("非机械项机械值必须留空或「不采用」", () => {
	expectFailure(buildTable({ 召回时机: "always" }), "recall-criteria/bad_machine_value");
	assert.equal(parseRecallCriteriaTable(buildTable({ 召回时机: "不采用" }), {}).ok, true);
});

test("「不采用」显式登记被记录，不产生机械值", () => {
	const result = parseRecallCriteriaTable(
		buildTable({ 关系展开: "不采用", 类型词别名: "不采用", 核心语义字段: "不采用", 默认候选状态: "不采用" }),
		{},
	);
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.deepEqual(result.values.notApplicable, {
		默认候选状态: true,
		核心语义字段: true,
		类型词别名: true,
		关系展开: true,
	});
	assert.deepEqual(result.values.relations, []);
	assert.deepEqual(result.values.typeAliases, []);
});

test("loadRecallCriteria：跨类型别名冲突使冲突类型停用并报错", async () => {
	const dir = await mkdtemp(join(tmpdir(), "recall-criteria-"));
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "26-Friction-摩擦账本.md"), buildTable({ 关系展开: "不采用" }), "utf8");
	await writeFile(join(dir, "25-Pitfall-踩坑经验.md"), buildTable({ 类型词别名: "决策记录", 关系展开: "不采用" }), "utf8");
	const result = await loadRecallCriteria(dir);
	assert.equal(result.ok, false);
	const conflict = result.errors.find((e) => e.code === "recall-criteria/alias_conflict");
	assert.ok(conflict !== undefined, "必须报别名冲突");
	assert.ok(conflict.message.includes("决策记录"));
	assert.equal(result.byType.has(conflict.type), false, "冲突类型必须从 byType 移除（停用机器判据）");
});


test("快照：真实 specs 七张判据表全部可解析（含 friction 六类型关系展开）", async () => {
	const result = await loadRecallCriteria(join(ROOT, "specs"));
	assert.equal(result.unreadable, false);
	assert.equal(result.ok, true, `七张表须全部可解析，errors=${JSON.stringify(result.errors)}`);
	assert.equal(result.byType.size, 7, `期望 7 个已解析类型，实得 ${result.byType.size}`);
	for (const [specId, typeKey] of Object.entries(FACT_TYPE_BY_SPEC_ID)) {
		assert.ok(result.byType.has(typeKey), `spec ${specId}（${typeKey}）的判据表未解析成功`);
	}
	for (const table of result.tables) {
		assert.equal(table.ok, true, `${table.file}: ${JSON.stringify(table.errors)}`);
	}
	const friction = result.byType.get("friction");
	assert.deepEqual(friction.values.relations, [
		{ relationKey: "informs", targets: ["spark", "norm", "pitfall", "report", "friction", "subgoal"] },
		{ relationKey: "paired-with", targets: ["pitfall"] },
	]);
});

test("快照：各类型别名集合恰为规范所载（20 goal 为「不采用」）", async () => {
	const result = await loadRecallCriteria(join(ROOT, "specs"));
	const aliasesOf = (type) => {
		const table = result.byType.get(type);
		assert.ok(table !== undefined, `类型 ${type} 未解析成功`);
		assert.equal(table.values.notApplicable["类型词别名"], false, `${type} 的别名不应是「不采用」`);
		return new Set(table.values.typeAliases);
	};
	assert.deepEqual(aliasesOf("spark"), new Set(["火花"]));
	assert.deepEqual(aliasesOf("pitfall"), new Set(["踩坑经验"]));
	assert.deepEqual(aliasesOf("report"), new Set(["报告", "调研报告", "总结报告", "审核报告", "行动报告", "参考报告"]));
	assert.deepEqual(aliasesOf("friction"), new Set(["摩擦账本", "摩擦"]));
	assert.deepEqual(aliasesOf("norm"), new Set(["事实规范"]));
	assert.deepEqual(aliasesOf("subgoal"), new Set(["子目标"]));

	const goal = result.byType.get("goal");
	assert.ok(goal !== undefined);
	assert.equal(goal.values.notApplicable["类型词别名"], true, "goal 的别名须显式登记「不采用」");
	assert.deepEqual(goal.values.typeAliases, []);
});

test("快照：别名集合不含主题词，且与类型键派生词、相互之间不冲突", async () => {
	const result = await loadRecallCriteria(join(ROOT, "specs"));
	const derived = allTypeKeyDerivedWords();
	const seen = new Map();
	for (const [type, table] of result.byType) {
		const aliases = table.values.typeAliases;
		assert.equal(new Set(aliases).size, aliases.length, `${type} 的别名成员必须唯一`);
		for (const alias of aliases) {
			assert.equal(derived.has(alias.toLowerCase()), false, `${type} 的别名「${alias}」与 fact_type_key 派生词冲突`);
			assert.equal(seen.has(alias), false, `别名「${alias}」同时出现在 ${seen.get(alias)} 与 ${type}`);
			seen.set(alias, type);
		}
	}
});

test("快照：20–26 的默认候选状态与核心语义字段与规范机械值一致", async () => {
	const result = await loadRecallCriteria(join(ROOT, "specs"));
	const valuesOf = (type) => result.byType.get(type).values;
	assert.deepEqual(valuesOf("spark").defaultStatuses, ["open"]);
	assert.deepEqual(valuesOf("spark").coreFields, ["question", "summary"]);
	assert.deepEqual(valuesOf("pitfall").coreFields, ["title", "scope"]);
	assert.equal(valuesOf("pitfall").notApplicable["关系展开"], true);
	assert.deepEqual(valuesOf("report").coreFields, ["title", "report_form", "research_question", "research_purpose"]);
	assert.deepEqual(valuesOf("report").relations.find((r) => r.relationKey === "inspired-by").targets, ["spark", "norm", "pitfall", "report", "friction", "subgoal"]);
	assert.deepEqual(valuesOf("friction").defaultStatuses, ["open", "accepted"]);
	assert.deepEqual(valuesOf("friction").coreFields, ["title", "phenomenon", "attribution"]);
	assert.deepEqual(valuesOf("friction").relations.find((r) => r.relationKey === "informs").targets,
		["spark", "norm", "pitfall", "report", "friction", "subgoal"]);
	assert.deepEqual(valuesOf("norm").coreFields, ["direction_key", "title"]);
	assert.equal(valuesOf("norm").notApplicable["关系展开"], true);
	assert.deepEqual(valuesOf("subgoal").defaultStatuses, ["active"]);
	assert.deepEqual(valuesOf("subgoal").coreFields, ["title", "criterion"]);
	assert.equal(valuesOf("subgoal").notApplicable["关系展开"], true);
});
