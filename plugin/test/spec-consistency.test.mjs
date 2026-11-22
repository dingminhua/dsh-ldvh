import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
	codeAssignedFields,
	fieldContractIssues,
	guidanceAnchorIssues,
	headingNumbers,
	specFieldRows,
	specSectionText,
} from "../lib/spec-consistency.js";
import { guidanceTextFor } from "../lib/guidance-text.js";
import { parameterSchemaFor } from "../lib/spark-tools.js";
import { validateSparkFrontmatter } from "../lib/spark-writer.js";

const ROOT = join(import.meta.dirname, "..", "..");
const SPECS = join(ROOT, "specs");
const SPARK_SPEC = "22-Spark-火花.md";
const ANCHOR_SPEC = "00-理念与构成.md";
const REQUIRED_ANCHORS_SPEC = "01-规范源与规范模型基础规范.md";
const ANCHOR_BLOCK_START = "本会话工作锚点";
const ANCHOR_BLOCK_END = "规则读取：";
const REQUIRED_ANCHORS_MARKER = "至少提供下列 00 锚点：";
const ANCHOR_SPEC_NUMBER = "00";
const OBJECT_UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SUBGOAL_UID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

async function readSpecs() {
	const byNumber = {};
	for (const name of await readdir(SPECS)) {
		if (!/^\d{2}-.+\.md$/.test(name)) continue;
		byNumber[name.slice(0, 2)] = await readFile(join(SPECS, name), "utf8");
	}
	return byNumber;
}

const specsByNumber = await readSpecs();
const sparkSpec = specsByNumber["22"];
const anchorSpec = specsByNumber[ANCHOR_SPEC_NUMBER];
const requiredAnchorsSpec = specsByNumber["01"];
const requiredAnchorsText = specSectionText(requiredAnchorsSpec, "### 10.4");
const guidedText = guidanceTextFor("governed", "dev");
const sparkSchema = parameterSchemaFor("spark-write-object").properties.frontmatter_draft;

function anchorIssues(guidance) {
	return guidanceAnchorIssues({
		guidance,
		anchorBlockStart: ANCHOR_BLOCK_START,
		anchorBlockEnd: ANCHOR_BLOCK_END,
		anchorSpecNumber: ANCHOR_SPEC_NUMBER,
		anchorSpecText: anchorSpec,
		requiredAnchorsText,
		requiredAnchorsMarker: REQUIRED_ANCHORS_MARKER,
		specsByNumber,
	});
}

function contractIssues({ specText, schema, inputOnlyFields = ["change_summary"] }) {
	return fieldContractIssues({ specText, schema, inputOnlyFields });
}

function issuesOf(result) {
	return Array.isArray(result) ? result : result.issues;
}

function validFrontmatter(overrides = {}) {
	return {
		object_uid: OBJECT_UID,
		fact_type_key: "spark",
		title: "字段契约测试",
		created_at: "2026-01-01T00:00:00Z",
		status: "open",
		question: "这条测试在验证什么？",
		scope_boundary: "当字段契约校验通过时停止。",
		intent: "保留字段契约与写入口一致。",
		summary: "当前理解。",
		priority: "P2",
		serves: SUBGOAL_UID,
		...overrides,
	};
}

test("specSectionText：取标题后到下一个 H2 的正文，未命中返回空串", () => {
	const markdown = "## 8. 字段契约\n行一\n| `title` | string | 必填 |\n## 9. 状态\n行二\n";
	assert.equal(specSectionText(markdown, "## 8."), "行一\n| `title` | string | 必填 |");
	assert.equal(specSectionText(markdown, "## 9."), "行二\n");
	assert.equal(specSectionText(markdown, "## 99."), "");
});

test("specFieldRows：解析字段名与必填性列，非字段行被忽略", () => {
	const markdown = [
		"| 字段 | 类型 | 必填性 | 语义 | 约束 |",
		"|---|---|---|---|---|",
		"| `title` | string | 必填 | 标题 | 无 |",
		"| `refs` | array | 条件 | 引用 | 无 |",
		"| 普通行 | 不解析 |  |  |  |",
	].join("\n");
	assert.deepEqual(specFieldRows(markdown), [
		{ field: "title", requiredCell: "必填" },
		{ field: "refs", requiredCell: "条件" },
	]);
	assert.deepEqual(specFieldRows(""), []);
});

test("headingNumbers：只收 H2/H3 编号，去掉尾部句点", () => {
	const markdown = "# 1. 一级\n## 2. 二级\n### 2.1 小节\n#### 3. 四级\n## 无空格4.9\n## 4.9 小节\n";
	assert.deepEqual([...headingNumbers(markdown)].sort(), ["2", "2.1", "4.9"]);
	assert.deepEqual([...headingNumbers("")], []);
});

test("codeAssignedFields：从 schema 描述解析 Code 托管字段，无声明返回空", () => {
	const description = "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log";
	assert.deepEqual(codeAssignedFields(description), ["object_uid", "fact_type_key", "created_at", "change_log"]);
	assert.deepEqual(codeAssignedFields("no assignment here"), []);
	assert.deepEqual(codeAssignedFields(""), []);
});

test("字段契约：真实 22 号规范与真实写入口 schema 一致（基线 issues 为空）", () => {
	const result = contractIssues({ specText: sparkSpec, schema: sparkSchema });
	assert.deepEqual(result.issues, []);
	assert.ok(Array.isArray(result.unconditionallyRequired));
	const codeAssigned = new Set(codeAssignedFields(sparkSchema.description ?? ""));
	const expected = specFieldRows(specSectionText(sparkSpec, "## 8. 字段契约"))
		.map((row) => row.field)
		.filter((field) => !codeAssigned.has(field));
	expected.push("change_summary");
	assert.deepEqual(Object.keys(sparkSchema.properties).sort(), expected.sort());
});

test("字段契约：schema 多出规范表没有的字段须被发现", () => {
	const schema = {
		...sparkSchema,
		properties: { ...sparkSchema.properties, bogus_field: { type: "string" } },
	};
	const result = contractIssues({ specText: sparkSpec, schema });
	assert.ok(result.issues.length > 0, "schema 多字段时 issues 不得为空");
	assert.ok(result.issues.some((issue) => issue.includes("bogus_field")), "issues 须点名 bogus_field");
});

test("字段契约：规范表缺字段须被发现", () => {
	const mutatedSpec = sparkSpec.replace(/^\| `intent` \|.*$/m, "");
	assert.notEqual(mutatedSpec, sparkSpec, "变异须实际生效");
	const result = contractIssues({ specText: mutatedSpec, schema: sparkSchema });
	assert.ok(
		result.issues.includes("写入口 schema 有 intent，规范字段表无此字段"),
		"须报出 schema 多出 intent（规范表缺字段的反向差异）",
	);
});

test("字段契约：规范必填但 schema.required 缺失的字段仍由写入器强制（serves）", () => {
	const required = sparkSchema.required.filter((field) => field !== "serves");
	const schema = { ...sparkSchema, required };
	const result = contractIssues({ specText: sparkSpec, schema });
	assert.ok(result.unconditionallyRequired.includes("serves"), "serves 须被识别为规范必填");
	assert.ok(!result.unconditionalInSchema.includes("serves"), "serves 不得落在 schema.required");
	for (const field of ["scope_boundary", "intent", "summary", "serves"]) {
		const frontmatter = validFrontmatter();
		delete frontmatter[field];
		const check = validateSparkFrontmatter(frontmatter);
		assert.equal(check.ok, false, `写入器须拒绝缺 ${field} 的 frontmatter`);
		assert.ok(
			check.issues.some((issue) => issue.startsWith(`${field}:`)),
			`写入器须返回 ${field} 的 issue`,
		);
	}
});

test("字段契约：status 的 draft 层豁免有规范依据（create 通道由 Code 钉死为 open）", () => {
	assert.ok(sparkSpec.includes("Code 钉死"), "specs/22 须保留「Code 钉死」依据");
	assert.ok(sparkSchema.required.includes("title"));
	assert.ok(!sparkSchema.required.includes("status"), "status 不得进入 frontmatter_draft 的 required");
	const open = validateSparkFrontmatter(validFrontmatter());
	assert.deepEqual(open.issues, []);
	const bogus = validateSparkFrontmatter(validFrontmatter({ status: "bogus" }));
	assert.equal(bogus.ok, false, "status 闭集仍须被写入器校验");
	assert.ok(bogus.issues.some((issue) => issue.startsWith("status:")));
});

test("锚点：真实引导文本与真实 00/01 及全语料一致（基线 issues 为空）", () => {
	assert.deepEqual(anchorIssues(guidedText), []);
});

test("锚点：引导引用不存在的节须被发现", () => {
	const mutated = guidedText.replace("§1 核心价值", "§1.1 核心价值");
	assert.notEqual(mutated, guidedText, "变异须实际生效");
	const issues = anchorIssues(mutated);
	assert.ok(
		issues.some((issue) => issue.includes("00 §1.1") && issue.includes("不存在")),
		"须报出 00 §1.1 不存在",
	);
});

test("锚点：01 §10.4 要求的锚点缺失须被发现", () => {
	const mutated = guidedText.replaceAll("§4.6", "");
	assert.notEqual(mutated, guidedText, "变异须实际生效");
	const issues = anchorIssues(mutated);
	assert.ok(
		issues.includes("01 §10.4 要求的锚点 00 §4.6 未出现在引导文本中"),
		"须报出 01 §10.4 要求的锚点 00 §4.6 缺失",
	);
});

test("锚点：续写继承前缀的判据（36 §7.6／§8.9 的第二段须沿用 36）", () => {
	const fixture = `${ANCHOR_BLOCK_START}\n1. §1 核心价值（36 §7.6／§8.9）\n${ANCHOR_BLOCK_END}`;
	const issues = anchorIssues(fixture);
	assert.ok(
		issues.some((issue) => issue.includes("36 §8.9") && issue.includes("不存在")),
		"须按 36 号规范报出 §8.9 不存在",
	);
});

test("边界：空输入不得抛未捕获异常，须返回可读 issues", () => {
	const contract = issuesOf(contractIssues({ specText: "", schema: {} }));
	assert.ok(contract.includes("字段契约表未解析到任何字段行"));

	const emptyGuidance = guidanceAnchorIssues({ guidance: "" });
	assert.deepEqual(emptyGuidance, ["引导文本中未找到工作锚点块起始标记"]);

	const noEnd = guidanceAnchorIssues({
		guidance: ANCHOR_BLOCK_START,
		anchorBlockStart: ANCHOR_BLOCK_START,
		anchorBlockEnd: ANCHOR_BLOCK_END,
	});
	assert.deepEqual(noEnd, ["引导文本中未找到工作锚点块结束标记"]);

	const noMarker = issuesOf(
		guidanceAnchorIssues({
			guidance: guidedText,
			anchorBlockStart: ANCHOR_BLOCK_START,
			anchorBlockEnd: ANCHOR_BLOCK_END,
			anchorSpecNumber: ANCHOR_SPEC_NUMBER,
			anchorSpecText: anchorSpec,
			requiredAnchorsText: "",
			requiredAnchorsMarker: REQUIRED_ANCHORS_MARKER,
			specsByNumber,
		}),
	);
	assert.deepEqual(noMarker, ["规范中未找到最小规则引导的锚点清单标记"]);

	const emptyMap = issuesOf(
		guidanceAnchorIssues({
			guidance: guidedText,
			anchorBlockStart: ANCHOR_BLOCK_START,
			anchorBlockEnd: ANCHOR_BLOCK_END,
			anchorSpecNumber: ANCHOR_SPEC_NUMBER,
			anchorSpecText: anchorSpec,
			requiredAnchorsText,
			requiredAnchorsMarker: REQUIRED_ANCHORS_MARKER,
			specsByNumber: {},
		}),
	);
	assert.ok(Array.isArray(emptyMap));
	assert.ok(emptyMap.length > 0);
});
