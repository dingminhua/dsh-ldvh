import assert from "node:assert/strict";
import test from "node:test";

import {
	buildDevelopmentSpecCorpus,
	createSpecNamespaceView,
	parseCarryAnchor,
	resolveCarryAnchor,
	resolveSpecReference,
	RUNTIME_CARRIER_FIELDS,
	RUNTIME_CARRIER_GUIDANCE_PHRASES,
	RUNTIME_CARRIER_LIMITS,
	RUNTIME_CARRIER_NAMESPACES,
	RUNTIME_CARRIER_REQUIRED_FIELDS,
	RUNTIME_CARRIER_WEAK_WORDING,
	validateRuntimeCarrier,
	validateRuntimeCarrierCorpus,
} from "../lib/runtime-carrier-validator.js";

const DEV_PATH = "specs/77-开发目标.md";
const DEV_TEXT = [
	"---",
	"ldvh_spec:",
	'  spec_key: "dev-target"',
	'  spec_kind: "spec"',
	'  spec_id: "77"',
	'  title: "开发目标"',
	`  canonical_path: "${DEV_PATH}"`,
	'  positioning: "p"',
	'  scope: "s"',
	"---",
	"",
	"# 开发目标",
	"",
	"## 1. 目标",
	"",
	"正文。",
	"",
	"### 1.1 子目标",
	"",
	"子正文。",
	"",
	"## 2. 空节",
	"",
	"### 2.1 只有子节",
	"",
	"子正文。",
	"",
	"## 3. 建议事项",
	"",
	"正文。",
	""
].join("\n");
const DEV_SPEC = { specKey: "dev-target", canonicalPath: DEV_PATH, title: "开发目标", text: DEV_TEXT, path: DEV_PATH };
const DEV_SPECS = [DEV_SPEC];

const DUP_PATH = "specs/78-重复目标.md";
const DUP_TEXT = [
	"---",
	"ldvh_spec:",
	'  spec_key: "dev-dup"',
	'  spec_kind: "spec"',
	'  spec_id: "78"',
	'  title: "重复目标"',
	`  canonical_path: "${DUP_PATH}"`,
	'  positioning: "p"',
	'  scope: "s"',
	"---",
	"",
	"# 重复目标",
	"",
	"## 1. 重名",
	"",
	"正文。",
	"",
	"## 1. 重名",
	"",
	"正文。",
	""
].join("\n");
const DUP_SPEC = { specKey: "dev-dup", canonicalPath: DUP_PATH, title: "重复目标", text: DUP_TEXT, path: DUP_PATH };

const ATTACHMENT_PATH = "specs/attachments/77.Att.01-附件样例.md";
const ATTACHMENT_TEXT = [
	"---",
	"ldvh_attachment:",
	'  attachment_key: "demo-att"',
	'  attachment_id: "77.Att.01"',
	'  title: "附件样例"',
	`  canonical_path: "${ATTACHMENT_PATH}"`,
	'  positioning: "p"',
	"---",
	"",
	"# 附件样例",
	"",
	"## 1. 目标",
	"",
	"正文。",
	""
].join("\n");
const ATTACHMENT_DOC = { text: ATTACHMENT_TEXT, path: ATTACHMENT_PATH };

function carrierText(options = {}) {
	const {
		specKey = "demo-carrier",
		specKind = "spec",
		title = "示例载体",
		canonicalPath = `plugin-specs/${specKey}.yaml`,
		positioning = "管示例领域。",
		scope = "在示例场景查阅。",
		carries,
		carriesRaw,
		role,
		omit = [],
		extra = [],
		rootExtra = [],
		requirements = [{ id: "one", title: "第一条", text: "正文一。" }],
		requirementsRaw
	} = options;
	const fields = [
		["spec_key", JSON.stringify(specKey)],
		["spec_kind", JSON.stringify(specKind)],
		["title", JSON.stringify(title)],
		["canonical_path", JSON.stringify(canonicalPath)],
		["positioning", JSON.stringify(positioning)],
		["scope", JSON.stringify(scope)]
	].filter(([name]) => !omit.includes(name));
	const lines = ["ldvh_spec:", ...fields.map(([name, value]) => `  ${name}: ${value}`)];
	if (carriesRaw !== undefined) {
		lines.push(carriesRaw);
	} else if (carries !== undefined) {
		if (carries.length === 0) {
			lines.push("  carries: []");
		} else {
			lines.push("  carries:", ...carries.map((anchor) => `    - ${JSON.stringify(anchor)}`));
		}
	}
	if (role !== undefined) lines.push(`  role: ${JSON.stringify(role)}`);
	lines.push(...extra);
	if (requirementsRaw !== undefined) {
		lines.push(requirementsRaw);
	} else if (requirements === null) {
		lines.push("  requirements: []");
	} else {
		lines.push("  requirements:");
		for (const entry of requirements) {
			lines.push(
				`    - id: ${JSON.stringify(entry.id)}`,
				`      title: ${JSON.stringify(entry.title)}`,
				`      text: ${JSON.stringify(entry.text)}`
			);
		}
	}
	lines.push(...rootExtra);
	return lines.join("\n");
}

function validate(text, options = {}) {
	return validateRuntimeCarrier({
		text,
		actualPath: options.actualPath ?? "plugin-specs/demo-carrier.yaml",
		carrierCatalog: options.carrierCatalog ?? [],
		developmentSpecs: options.developmentSpecs ?? DEV_SPECS
	});
}

function codes(result) {
	return result.findings.map((finding) => finding.code).sort();
}

function findingsOf(result, code) {
	return result.findings.filter((finding) => finding.code === code);
}

function shape(result, code, keys) {
	return findingsOf(result, code).map((finding) => {
		const output = { code: finding.code };
		for (const key of keys) output[key] = finding[key];
		return output;
	});
}

function weakRequirement(text, extra = {}) {
	return carrierText({ carries: ["dev-target::1. 目标"], requirements: [{ id: "one", title: "第一条", text }], ...extra });
}

const BASE_CARRIES = ["dev-target::1. 目标"];
const OTHER_CATALOG = [{ specKey: "other-key", canonicalPath: "plugin-specs/other-key.yaml" }];

test("weak wording closed set matches the contract", () => {
	assert.deepEqual([...RUNTIME_CARRIER_WEAK_WORDING], ["应当", "应该", "建议", "尽量"]);
});

test("guidance phrase closed set matches the contract", () => {
	assert.deepEqual([...RUNTIME_CARRIER_GUIDANCE_PHRASES], [
		"见上",
		"见前",
		"见下",
		"如前所述",
		"如上所述",
		"参照前文",
		"上面那几条",
		"参见前文",
		"另见",
		"详见",
		"参见",
		"见《"
	]);
});

test("volume limits match the contract", () => {
	assert.deepEqual({ ...RUNTIME_CARRIER_LIMITS }, {
		minRequirements: 1,
		maxRequirements: 30,
		maxRequirementTextCodePoints: 600,
		maxDocumentBytes: 20480
	});
});

test("runtime carrier namespace mapping matches the contract", () => {
	assert.deepEqual({ ...RUNTIME_CARRIER_NAMESPACES }, { RUNTIME: "plugin-specs", DEVELOPMENT: "specs" });
});

test("the identity field closed sets match the contract", () => {
	assert.deepEqual({
		fields: [...RUNTIME_CARRIER_FIELDS],
		required: [...RUNTIME_CARRIER_REQUIRED_FIELDS]
	}, {
		fields: ["spec_key", "spec_kind", "title", "canonical_path", "positioning", "scope", "carries", "role", "requirements"],
		required: ["spec_key", "spec_kind", "title", "canonical_path", "positioning", "scope"]
	});
});

test("a fully conforming carrier yields no findings", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES }));
	assert.deepEqual(result.findings, []);
});

test("a fully conforming carrier is reported as passing", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES }));
	assert.deepEqual({ verdict: result.verdict, ok: result.ok }, { verdict: "pass", ok: true });
});

test("a carrier with an error finding is reported as failing", () => {
	const result = validate(weakRequirement("应当逐条核对。"));
	assert.deepEqual({ verdict: result.verdict, ok: result.ok }, { verdict: "fail", ok: false });
});

test("a second top-level mapping is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, rootExtra: ["ldvh_attachment:", '  attachment_key: "x"'] }));
	assert.deepEqual(codes(result), ["structure/attachment_form", "structure/top_level_mapping"]);
});

test("a duplicate ldvh_spec key is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, rootExtra: ["ldvh_spec:", '  spec_key: "second-key"'] }));
	assert.deepEqual(codes(result), [
		"structure/duplicate_key",
		"structure/top_level_mapping",
		"structure/top_level_mapping"
	]);
});

test("a non-mapping document root is rejected", () => {
	const result = validate("just a scalar");
	assert.deepEqual(codes(result), ["structure/top_level_mapping"]);
});

test("an empty document is rejected", () => {
	const result = validate("");
	assert.deepEqual(codes(result), ["structure/top_level_document_count"]);
});

test("two YAML documents are rejected", () => {
	const text = `${carrierText({ carries: BASE_CARRIES })}\n---\nldvh_spec:\n  spec_key: "second-key"\n`;
	const result = validate(text);
	assert.deepEqual(codes(result), ["structure/top_level_document_count"]);
});

test("spec_id is rejected with a dedicated finding", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, extra: ['  spec_id: "99"'] }));
	assert.deepEqual(codes(result), ["structure/spec_id", "structure/unknown_field"]);
});

test("supersedes is rejected as a relation field", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, extra: ['  supersedes: "old-one"'] }));
	assert.deepEqual(codes(result), ["structure/relation_field", "structure/unknown_field"]);
});

test("parent_spec is rejected as a relation field", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, extra: ['  parent_spec: "parent-one"'] }));
	assert.deepEqual(codes(result), ["structure/relation_field", "structure/unknown_field"]);
});

test("relation is rejected as a relation field", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, extra: ['  relation: "replaces"'] }));
	assert.deepEqual(codes(result), ["structure/relation_field", "structure/unknown_field"]);
});

test("related_specs is rejected as a relation field", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, extra: ['  related_specs: ["other-one"]'] }));
	assert.deepEqual(codes(result), ["structure/relation_field", "structure/unknown_field"]);
});

test("an unrelated field outside the closed set is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, extra: ['  notes: "说明"'] }));
	assert.deepEqual(codes(result), ["structure/unknown_field"]);
});

test("each missing identity field is reported", () => {
	for (const field of ["spec_key", "spec_kind", "title", "canonical_path", "positioning", "scope"]) {
		const result = validate(carrierText({ carries: BASE_CARRIES, omit: [field] }));
		assert.deepEqual(shape(result, "structure/identity_missing", ["fieldPath"]), [
			{ code: "structure/identity_missing", fieldPath: `ldvh_spec.${field}` }
		]);
	}
});

test("an invalid spec_key is rejected", () => {
	const result = validate(carrierText({ specKey: "Demo", carries: BASE_CARRIES }), { actualPath: "plugin-specs/Demo.yaml" });
	assert.deepEqual(shape(result, "structure/identity_invalid", ["fieldPath"]), [
		{ code: "structure/identity_invalid", fieldPath: "ldvh_spec.spec_key" }
	]);
});

test("a spec_kind other than spec is rejected", () => {
	const result = validate(carrierText({ specKind: "attachment", carries: BASE_CARRIES }));
	assert.deepEqual(shape(result, "structure/identity_invalid", ["fieldPath"]), [
		{ code: "structure/identity_invalid", fieldPath: "ldvh_spec.spec_kind" }
	]);
});

test("a title with a path separator is rejected", () => {
	const result = validate(carrierText({ title: "a/b", carries: BASE_CARRIES }));
	assert.deepEqual(shape(result, "structure/identity_invalid", ["fieldPath"]), [
		{ code: "structure/identity_invalid", fieldPath: "ldvh_spec.title" }
	]);
});

test("a title with a control character is rejected", () => {
	const result = validate(carrierText({ title: "a\tb", carries: BASE_CARRIES }));
	assert.deepEqual(shape(result, "structure/identity_invalid", ["fieldPath"]), [
		{ code: "structure/identity_invalid", fieldPath: "ldvh_spec.title" }
	]);
});

test("a title with surrounding whitespace is rejected", () => {
	const result = validate(carrierText({ title: " 示例载体 ", carries: BASE_CARRIES }));
	assert.deepEqual(shape(result, "structure/identity_invalid", ["fieldPath"]), [
		{ code: "structure/identity_invalid", fieldPath: "ldvh_spec.title" }
	]);
});

test("empty positioning is rejected", () => {
	const result = validate(carrierText({ positioning: "", carries: BASE_CARRIES }));
	assert.deepEqual(shape(result, "structure/identity_invalid", ["fieldPath"]), [
		{ code: "structure/identity_invalid", fieldPath: "ldvh_spec.positioning" }
	]);
});

test("empty scope is rejected", () => {
	const result = validate(carrierText({ scope: "  ", carries: BASE_CARRIES }));
	assert.deepEqual(shape(result, "structure/identity_invalid", ["fieldPath"]), [
		{ code: "structure/identity_invalid", fieldPath: "ldvh_spec.scope" }
	]);
});

test("canonical_path must match the actual path", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES }), { actualPath: "plugin-specs/elsewhere.yaml" });
	assert.deepEqual(shape(result, "structure/path_mismatch", ["fieldPath", "actualPath"]), [
		{ code: "structure/path_mismatch", fieldPath: "ldvh_spec.canonical_path", actualPath: "plugin-specs/elsewhere.yaml" }
	]);
});

test("canonical_path must equal plugin-specs/<spec_key>.yaml", () => {
	const result = validate(carrierText({ canonicalPath: "plugin-specs/not-demo.yaml", carries: BASE_CARRIES }));
	assert.deepEqual(shape(result, "structure/identity_invalid", ["fieldPath", "expected"]), [
		{ code: "structure/identity_invalid", fieldPath: "ldvh_spec.canonical_path", expected: "plugin-specs/demo-carrier.yaml" }
	]);
});

test("a spec_key already used by another path is ambiguous", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES }), {
		carrierCatalog: [{ specKey: "demo-carrier", canonicalPath: "plugin-specs/demo-carrier-other.yaml" }]
	});
	assert.deepEqual(shape(result, "structure/ident_ambiguous", ["fieldPath"]), [
		{ code: "structure/ident_ambiguous", fieldPath: "ldvh_spec.spec_key" }
	]);
});

test("carries written as an empty list is rejected", () => {
	const result = validate(carrierText({ carries: [] }));
	assert.deepEqual(shape(result, "structure/optional_field_empty", ["fieldPath"]), [
		{ code: "structure/optional_field_empty", fieldPath: "ldvh_spec.carries" }
	]);
});

test("carries written as a scalar is rejected", () => {
	const result = validate(carrierText({ carriesRaw: '  carries: "dev-target::1. 目标"' }));
	assert.deepEqual(shape(result, "structure/optional_field_invalid", ["fieldPath"]), [
		{ code: "structure/optional_field_invalid", fieldPath: "ldvh_spec.carries" }
	]);
});

test("role with an empty string is rejected", () => {
	const result = validate(carrierText({ role: "", carries: BASE_CARRIES }));
	assert.deepEqual(shape(result, "structure/optional_field_empty", ["fieldPath"]), [
		{ code: "structure/optional_field_empty", fieldPath: "ldvh_spec.role" }
	]);
});

test("role other than router is rejected", () => {
	const result = validate(carrierText({ role: "index", carries: BASE_CARRIES }));
	assert.deepEqual(shape(result, "structure/role_invalid", ["fieldPath"]), [
		{ code: "structure/role_invalid", fieldPath: "ldvh_spec.role" }
	]);
});

test("requirements missing is rejected", () => {
	const text = carrierText({ carries: BASE_CARRIES }).replace(/ {2}requirements:\n(?: {4}.*\n?)+/, "");
	const result = validate(text);
	assert.deepEqual(shape(result, "structure/requirements_missing", ["fieldPath"]), [
		{ code: "structure/requirements_missing", fieldPath: "ldvh_spec.requirements" }
	]);
});

test("requirements as a mapping is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, requirementsRaw: '  requirements: {"one": "x"}' }));
	assert.deepEqual(shape(result, "structure/requirements_invalid", ["fieldPath"]), [
		{ code: "structure/requirements_invalid", fieldPath: "ldvh_spec.requirements" }
	]);
});

test("a non-mapping requirement entry is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, requirementsRaw: '  requirements:\n    - "just a string"' }));
	assert.deepEqual(shape(result, "structure/requirements_invalid", ["fieldPath"]), [
		{ code: "structure/requirements_invalid", fieldPath: "ldvh_spec.requirements[0]" }
	]);
});

test("each missing requirement field is reported", () => {
	const entries = {
		id: "  requirements:\n    - title: \"第一条\"\n      text: \"正文。\"",
		title: "  requirements:\n    - id: \"one\"\n      text: \"正文。\"",
		text: "  requirements:\n    - id: \"one\"\n      title: \"第一条\""
	};
	for (const field of ["id", "title", "text"]) {
		const result = validate(carrierText({ carries: BASE_CARRIES, requirementsRaw: entries[field] }));
		assert.deepEqual(shape(result, "structure/requirement_field_missing", ["fieldPath"]), [
			{ code: "structure/requirement_field_missing", fieldPath: `ldvh_spec.requirements[0].${field}` }
		]);
	}
});

test("a requirement source field is rejected", () => {
	const text = carrierText({ carries: BASE_CARRIES }).replace('    - id: "one"\n', '    - id: "one"\n      source: "somewhere"\n');
	const result = validate(text);
	assert.deepEqual(shape(result, "structure/requirement_unknown_field", ["fieldPath"]), [
		{ code: "structure/requirement_unknown_field", fieldPath: "ldvh_spec.requirements[0].source" }
	]);
});

test("a second requirement container is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, extra: ['  rules:', '    - id: "x"', '      text: "y"'] }));
	assert.deepEqual(codes(result), ["structure/requirement_container", "structure/unknown_field"]);
});

test("a duplicated requirement id is rejected", () => {
	const result = validate(carrierText({
		carries: BASE_CARRIES,
		requirements: [
			{ id: "one", title: "第一条", text: "正文一。" },
			{ id: "one", title: "第二条", text: "正文二。" }
		]
	}));
	assert.deepEqual(shape(result, "structure/requirement_id_duplicate", ["fieldPath"]), [
		{ code: "structure/requirement_id_duplicate", fieldPath: "ldvh_spec.requirements[1].id" }
	]);
});

test("a non-kebab requirement id is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, requirements: [{ id: "One", title: "第一条", text: "正文。" }] }));
	assert.deepEqual(shape(result, "structure/requirement_id_invalid", ["fieldPath"]), [
		{ code: "structure/requirement_id_invalid", fieldPath: "ldvh_spec.requirements[0].id" }
	]);
});

test("an empty requirement title is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, requirements: [{ id: "one", title: " ", text: "正文。" }] }));
	assert.deepEqual(shape(result, "structure/requirement_value_invalid", ["fieldPath"]), [
		{ code: "structure/requirement_value_invalid", fieldPath: "ldvh_spec.requirements[0].title" }
	]);
});

test("an empty requirement text is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, requirements: [{ id: "one", title: "第一条", text: "  " }] }));
	assert.deepEqual(shape(result, "structure/requirement_value_invalid", ["fieldPath"]), [
		{ code: "structure/requirement_value_invalid", fieldPath: "ldvh_spec.requirements[0].text" }
	]);
});

test("another carrier spec_key reference is reported", () => {
	const result = validate(weakRequirement("另读 other-key 的内容。"), { carrierCatalog: OTHER_CATALOG });
	assert.deepEqual(shape(result, "prohibited/other_runtime_carrier", ["item", "level", "fieldPath", "matched", "matchedForm"]), [
		{
			code: "prohibited/other_runtime_carrier",
			item: 1,
			level: "error",
			fieldPath: "ldvh_spec.requirements[0].text",
			matched: "other-key",
			matchedForm: "spec_key"
		}
	]);
});

test("another carrier filename reference is reported", () => {
	const result = validate(weakRequirement("另读 other-key.yaml 的内容。"), { carrierCatalog: OTHER_CATALOG });
	assert.deepEqual(shape(result, "prohibited/other_runtime_carrier", ["matched", "matchedForm"]), [
		{ code: "prohibited/other_runtime_carrier", matched: "other-key.yaml", matchedForm: "filename" }
	]);
});

test("another carrier canonical_path reference is reported", () => {
	const result = validate(weakRequirement("另读 plugin-specs/other-key.yaml 的内容。"), { carrierCatalog: OTHER_CATALOG });
	assert.deepEqual(shape(result, "prohibited/other_runtime_carrier", ["matched", "matchedForm"]), [
		{ code: "prohibited/other_runtime_carrier", matched: "plugin-specs/other-key.yaml", matchedForm: "canonical_path" }
	]);
});

test("references outside the identifier boundary are not reported", () => {
	const result = validate(weakRequirement("另读 subgoal-fact-type 的内容。"), {
		carrierCatalog: [{ specKey: "goal-fact-type", canonicalPath: "plugin-specs/goal-fact-type.yaml" }]
	});
	assert.deepEqual(result.findings, []);
});

test("the carrier's own identity is not reported as a reference", () => {
	const result = validate(weakRequirement("本文件 plugin-specs/demo-carrier.yaml 与 demo-carrier 都指自身。"), {
		carrierCatalog: [{ specKey: "alias-key", canonicalPath: "plugin-specs/demo-carrier.yaml" }]
	});
	assert.deepEqual(result.findings, []);
});

test("the carrier's own spec_key is not a development spec reference", () => {
	const result = validate(carrierText({
		specKey: "dev-target",
		carries: ["dev-target::1. 目标"],
		requirements: [{ id: "one", title: "第一条", text: "本载体 dev-target 不指向开发规范。" }]
	}), { actualPath: "plugin-specs/dev-target.yaml" });
	assert.deepEqual(result.findings, []);
});

test("a development spec path segment is reported", () => {
	const result = validate(weakRequirement("读 specs/ 下的条目。"));
	assert.deepEqual(shape(result, "prohibited/development_spec", ["item", "referenceKind", "matched"]), [
		{ code: "prohibited/development_spec", item: 2, referenceKind: "path_segment", matched: "specs/" }
	]);
});

test("a development spec filename is reported", () => {
	const result = validate(weakRequirement("读 77-开发目标.md 的条款。"));
	assert.deepEqual(shape(result, "prohibited/development_spec", ["referenceKind", "matched"]), [
		{ code: "prohibited/development_spec", referenceKind: "filename", matched: "77-开发目标.md" }
	]);
});

test("a development spec spec_key is reported", () => {
	const result = validate(weakRequirement("读 dev-target 的条款。"));
	assert.deepEqual(shape(result, "prohibited/development_spec", ["referenceKind", "matched"]), [
		{ code: "prohibited/development_spec", referenceKind: "spec_key", matched: "dev-target" }
	]);
});

test("plugin-specs is not a development spec path segment", () => {
	const result = validate(weakRequirement("读 plugin-specs/target-x.yaml 的内容。"));
	assert.deepEqual(result.findings, []);
});

test("section and clause designations are reported", () => {
	const result = validate(weakRequirement("见§5、第12章、第3节与第4条。"));
	assert.deepEqual(findingsOf(result, "prohibited/section_reference").map((finding) => finding.matched), [
		"§",
		"第12章",
		"第3节",
		"第4条"
	]);
});

test("a clause reference without digits is not reported", () => {
	const result = validate(weakRequirement("第三条规定的内容，第二次复核。"));
	assert.deepEqual(result.findings, []);
});

test("spaced clause designations are reported", () => {
	const result = validate(weakRequirement("第 12 章与第 3 条都需要重写。"));
	assert.deepEqual(findingsOf(result, "prohibited/section_reference").map((finding) => finding.matched), [
		"第 12 章",
		"第 3 条"
	]);
});

test("GFM table rows are reported", () => {
	const result = validate(weakRequirement("| a | b |\n| - | - |"));
	assert.deepEqual(findingsOf(result, "prohibited/gfm_table").map((finding) => finding.matched), [
		"| a | b |",
		"| - | - |"
	]);
});

test("a line with fewer than two pipes is not a table row", () => {
	const result = validate(weakRequirement("| a"));
	assert.deepEqual(result.findings, []);
});

test("a line not starting with a pipe is not a table row", () => {
	const result = validate(weakRequirement("not | a | b |"));
	assert.deepEqual(result.findings, []);
});

test("each weak wording phrase is reported", () => {
	const result = validate(weakRequirement("应当 应该 建议 尽量"));
	assert.deepEqual(findingsOf(result, "prohibited/weak_wording").map((finding) => finding.matched), [
		"应当",
		"应该",
		"建议",
		"尽量"
	]);
});

test("weak wording is counted once per occurrence", () => {
	const result = validate(weakRequirement("应当再应当"));
	assert.deepEqual(findingsOf(result, "prohibited/weak_wording").map((finding) => finding.matched), [
		"应当",
		"应当"
	]);
});

test("strong modality wording is not reported", () => {
	const result = validate(weakRequirement("必须提交，不得跳过，可以复核，须核对。"));
	assert.deepEqual(result.findings, []);
});

test("guidance phrases are matched longest first", () => {
	const result = validate(weakRequirement("参见前文，另见，见《某规范》，如上所述。"));
	assert.deepEqual(findingsOf(result, "prohibited/guidance_phrase").map((finding) => finding.matched), [
		"参见前文",
		"另见",
		"见《",
		"如上所述"
	]);
});

test("text without guidance phrases is not reported", () => {
	const result = validate(weakRequirement("逐条写明要求与判据。"));
	assert.deepEqual(result.findings, []);
});

test("load-bearing markers are reported as hints only", () => {
	const result = validate(weakRequirement("满足条件后可以用。【承重声明】**恢复条件**：某件事完成。"));
	assert.deepEqual(shape(result, "hint/load_bearing_claim", ["item", "level", "matched"]), [
		{ code: "hint/load_bearing_claim", item: "5.5-乙类8", level: "hint", matched: "【承重声明】" },
		{ code: "hint/load_bearing_claim", item: "5.5-乙类8", level: "hint", matched: "**恢复条件**：" }
	]);
});

test("load-bearing markers do not fail the carrier", () => {
	const result = validate(weakRequirement("满足条件后可以用。【承重声明】"));
	assert.equal(result.ok, true);
});

test("comments are outside the scanned field values", () => {
	const result = validate(carrierText({ extra: ["  # 应当 详见 §5 specs/ 见上 【承重声明】"] }));
	assert.deepEqual(codes(result), ["hint/source_missing"]);
});

test("the carries registration is outside the scanned field values", () => {
	const result = validate(carrierText({ carries: ["dev-target::3. 建议事项"] }));
	assert.deepEqual(result.findings, []);
});

test("a carrier with zero requirements is rejected", () => {
	const result = validate(carrierText({ carries: BASE_CARRIES, requirements: null }));
	assert.deepEqual(shape(result, "volume/requirement_count", ["item", "level", "fieldPath", "measured", "limit"]), [
		{
			code: "volume/requirement_count",
			item: 8,
			level: "error",
			fieldPath: "ldvh_spec.requirements",
			measured: 0,
			limit: [1, 30]
		}
	]);
});

test("31 requirements are rejected", () => {
	const requirements = Array.from({ length: 31 }, (_, index) => ({
		id: `req-${index + 1}`,
		title: `条目${index + 1}`,
		text: "正文。"
	}));
	const result = validate(carrierText({ carries: BASE_CARRIES, requirements }));
	assert.deepEqual(shape(result, "volume/requirement_count", ["measured", "limit"]), [
		{ code: "volume/requirement_count", measured: 31, limit: [1, 30] }
	]);
});

test("the remaining requirement budget turns negative beyond the limit", () => {
	const requirements = Array.from({ length: 31 }, (_, index) => ({
		id: `req-${index + 1}`,
		title: `条目${index + 1}`,
		text: "正文。"
	}));
	const result = validate(carrierText({ carries: BASE_CARRIES, requirements }));
	assert.equal(result.measurements.requirementCountRemaining, -1);
});

test("30 requirements are accepted", () => {
	const requirements = Array.from({ length: 30 }, (_, index) => ({
		id: `req-${index + 1}`,
		title: `条目${index + 1}`,
		text: "正文。"
	}));
	const result = validate(carrierText({ carries: BASE_CARRIES, requirements }));
	assert.deepEqual(result.findings, []);
});

test("600 code points are accepted", () => {
	const result = validate(weakRequirement("甲".repeat(600)));
	assert.deepEqual(result.findings, []);
});

test("600 code points are reported as the measured maximum", () => {
	const result = validate(weakRequirement("甲".repeat(600)));
	assert.equal(result.measurements.maxTextCodePoints, 600);
});

test("601 code points are rejected", () => {
	const result = validate(weakRequirement("甲".repeat(601)));
	assert.deepEqual(shape(result, "volume/text_too_long", ["item", "level", "fieldPath", "measured", "limit", "remaining"]), [
		{
			code: "volume/text_too_long",
			item: 8,
			level: "error",
			fieldPath: "ldvh_spec.requirements[0].text",
			measured: 601,
			limit: 600,
			remaining: -1
		}
	]);
});

test("code point counting is not UTF-16 unit counting", () => {
	const result = validate(weakRequirement("😀".repeat(600)));
	assert.equal(result.measurements.maxTextCodePoints, 600);
});

test("an oversized carrier without carries is rejected", () => {
	const fixture = oversizedCarrier({ padding: 3800, carriers: 40 });
	const result = validate(fixture.text, { developmentSpecs: fixture.developmentSpecs });
	assert.deepEqual(shape(result, "volume/document_bytes", ["item", "level", "fieldPath", "limit"]), [
		{ code: "volume/document_bytes", item: 8, level: "error", fieldPath: "ldvh_spec", limit: 20480 }
	]);
});

test("a carrier over the byte limit only with carries is a scope gap", () => {
	const fixture = oversizedCarrier({ padding: 2600, carriers: 40 });
	const result = validate(fixture.text, { developmentSpecs: fixture.developmentSpecs });
	assert.deepEqual(shape(result, "volume/document_bytes_scope_gap", ["item", "level", "fieldPath", "limit"]), [
		{ code: "volume/document_bytes_scope_gap", item: 8, level: "gap", fieldPath: "ldvh_spec", limit: 20480 }
	]);
});

test("the scope gap does not issue an error finding", () => {
	const fixture = oversizedCarrier({ padding: 2600, carriers: 40 });
	const result = validate(fixture.text, { developmentSpecs: fixture.developmentSpecs });
	assert.deepEqual(result.findings.filter((finding) => finding.level === "error"), []);
});

test("the scope gap verdicts undetermined and is not ok", () => {
	const fixture = oversizedCarrier({ padding: 2600, carriers: 40 });
	const result = validate(fixture.text, { developmentSpecs: fixture.developmentSpecs });
	assert.deepEqual({ verdict: result.verdict, ok: result.ok }, { verdict: "undetermined", ok: false });
});

test("the corpus carried by a scope gap verdicts undetermined", () => {
	const fixture = oversizedCarrier({ padding: 2600, carriers: 40 });
	const corpus = validateRuntimeCarrierCorpus({
		carriers: [{ text: fixture.text, actualPath: "plugin-specs/demo-carrier.yaml" }],
		developmentSpecs: fixture.developmentSpecs
	});
	assert.deepEqual({
		verdict: corpus.verdict,
		ok: corpus.ok,
		summaryVerdict: corpus.summary.verdict,
		gapCount: corpus.summary.gapCount
	}, { verdict: "undetermined", ok: false, summaryVerdict: "undetermined", gapCount: 1 });
});

function oversizedCarrier({ padding, carriers }) {
	const anchors = Array.from({ length: carriers }, (_, index) => `padding-target::段落 ${String(index + 1).padStart(2, "0")}`);
	const headings = Array.from({ length: carriers }, (_, index) => `## 段落 ${String(index + 1).padStart(2, "0")}\n\n正文。`);
	const specText = [
		"---",
		"ldvh_spec:",
		'  spec_key: "padding-target"',
		'  spec_kind: "spec"',
		'  spec_id: "79"',
		'  title: "排版目标"',
		'  canonical_path: "specs/79-排版目标.md"',
		'  positioning: "p"',
		'  scope: "s"',
		"---",
		"",
		"# 排版目标",
		"",
		...headings,
		""
	].join("\n");
	const requirements = Array.from({ length: 30 }, (_, index) => ({
		id: `req-${index + 1}`,
		title: `条目${index + 1}`,
		text: "a".repeat(500)
	}));
	const text = carrierText({
		positioning: "a".repeat(padding),
		carries: anchors,
		requirements
	});
	return { text, developmentSpecs: [{ specKey: "padding-target", canonicalPath: "specs/79-排版目标.md", title: "排版目标", text: specText, path: "specs/79-排版目标.md" }] };
}

test("parseCarryAnchor accepts an H2 heading path", () => {
	assert.deepEqual(parseCarryAnchor("dev-target::1. 目标"), {
		ok: true,
		value: { specKey: "dev-target", headingPath: "1. 目标", segments: ["1. 目标"] }
	});
});

test("parseCarryAnchor accepts an H2/H3 heading path", () => {
	assert.deepEqual(parseCarryAnchor("dev-target::1. 目标/1.1 子目标"), {
		ok: true,
		value: { specKey: "dev-target", headingPath: "1. 目标/1.1 子目标", segments: ["1. 目标", "1.1 子目标"] }
	});
});

const MALFORMED_ANCHORS = [
	["empty", ""],
	["without a separator", "dev-target"],
	["with an empty heading path", "dev-target::"],
	["with whitespace before the spec_key", " dev-target::1. 目标"],
	["with whitespace inside the heading path", "dev-target:: 1. 目标"],
	["with a trailing separator", "dev-target::1. 目标/"],
	["with three heading segments", "dev-target::1. 目标/1.1 子目标/2.2 孙目标"],
	["with an uppercase spec_key", "Dev::x"],
	["with an underscore in the spec_key", "dev_target::1. 目标"],
	["with a line break", "dev-target::1. 目标\n更多"]
];

for (const [label, anchor] of MALFORMED_ANCHORS) {
	test(`parseCarryAnchor rejects an anchor ${label}`, () => {
		const parsed = parseCarryAnchor(anchor);
		assert.deepEqual({ ok: parsed.ok, code: parsed.error?.code }, { ok: false, code: "anchor/form_invalid" });
	});
}

test("resolveCarryAnchor returns the resolved target", () => {
	assert.deepEqual(resolveCarryAnchor("dev-target::1. 目标/1.1 子目标", DEV_SPECS), {
		ok: true,
		value: {
			specKey: "dev-target",
			canonicalPath: DEV_PATH,
			headingPath: "1. 目标/1.1 子目标",
			startLine: 18,
			endLine: 21
		}
	});
});

test("resolveCarryAnchor rejects an unknown target", () => {
	const result = resolveCarryAnchor("ghost-target::1. 目标", DEV_SPECS);
	assert.equal(result.error.code, "anchor/target_unknown");
});

test("resolveCarryAnchor rejects a missing heading", () => {
	const result = resolveCarryAnchor("dev-target::9. 不存在", DEV_SPECS);
	assert.equal(result.error.code, "anchor/heading_not_found");
});

test("resolveCarryAnchor rejects an ambiguous heading", () => {
	const result = resolveCarryAnchor("dev-dup::1. 重名", [DUP_SPEC]);
	assert.equal(result.error.code, "anchor/heading_ambiguous");
});

test("resolveCarryAnchor rejects an empty locator", () => {
	const result = resolveCarryAnchor("dev-target::2. 空节", DEV_SPECS);
	assert.equal(result.error.code, "anchor/empty_locator");
});

test("resolveCarryAnchor rejects an unreadable target", () => {
	const result = resolveCarryAnchor("dev-target::1. 目标", [{ specKey: "dev-target" }]);
	assert.equal(result.error.code, "anchor/target_unreadable");
});

test("a malformed anchor is reported at its field path", () => {
	const result = validate(carrierText({ carries: ["nope"] }));
	assert.deepEqual(shape(result, "anchor/form_invalid", ["item", "level", "fieldPath", "anchor"]), [
		{ code: "anchor/form_invalid", item: "6.2", level: "error", fieldPath: "ldvh_spec.carries[0]", anchor: "nope" }
	]);
});

test("an unknown anchor target is reported", () => {
	const result = validate(carrierText({ carries: ["ghost-target::1. 目标"] }));
	assert.deepEqual(shape(result, "anchor/target_unknown", ["fieldPath", "anchor"]), [
		{ code: "anchor/target_unknown", fieldPath: "ldvh_spec.carries[0]", anchor: "ghost-target::1. 目标" }
	]);
});

test("a missing anchor heading path is reported", () => {
	const result = validate(carrierText({ carries: ["dev-target::9. 不存在"] }));
	assert.deepEqual(shape(result, "anchor/heading_not_found", ["fieldPath"]), [
		{ code: "anchor/heading_not_found", fieldPath: "ldvh_spec.carries[0]" }
	]);
});

test("an ambiguous anchor heading is reported", () => {
	const result = validate(carrierText({ carries: ["dev-dup::1. 重名"] }), { developmentSpecs: [DUP_SPEC] });
	assert.deepEqual(shape(result, "anchor/heading_ambiguous", ["fieldPath"]), [
		{ code: "anchor/heading_ambiguous", fieldPath: "ldvh_spec.carries[0]" }
	]);
});

test("a duplicated anchor is reported at the duplicate index", () => {
	const result = validate(carrierText({ carries: ["dev-target::1. 目标", "dev-target::1. 目标"] }));
	assert.deepEqual(shape(result, "anchor/duplicate", ["fieldPath"]), [
		{ code: "anchor/duplicate", fieldPath: "ldvh_spec.carries[1]" }
	]);
});

test("an anchor pointing at an empty locator is reported", () => {
	const result = validate(carrierText({ carries: ["dev-target::2. 空节"] }));
	assert.deepEqual(shape(result, "anchor/empty_locator", ["fieldPath"]), [
		{ code: "anchor/empty_locator", fieldPath: "ldvh_spec.carries[0]" }
	]);
});

test("a non-string carries member is rejected", () => {
	const result = validate(carrierText({ carriesRaw: '  carries:\n    - "dev-target::1. 目标"\n    - 7' }));
	assert.deepEqual(shape(result, "structure/optional_field_invalid", ["fieldPath"]), [
		{ code: "structure/optional_field_invalid", fieldPath: "ldvh_spec.carries[1]" }
	]);
});

test("a missing carries registration is a hint, not a failure", () => {
	const result = validate(carrierText({}));
	assert.deepEqual(shape(result, "hint/source_missing", ["item", "level", "fieldPath"]), [
		{ code: "hint/source_missing", item: "6.2", level: "hint", fieldPath: "ldvh_spec.carries" }
	]);
});

test("a source-missing hint does not fail the carrier", () => {
	const result = validate(carrierText({}));
	assert.equal(result.ok, true);
});

test("a router without carries does not report source missing", () => {
	const result = validate(carrierText({
		specKey: "router-one",
		role: "router",
		requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/target-one.yaml。" }]
	}), { actualPath: "plugin-specs/router-one.yaml", carrierCatalog: [{ specKey: "target-one", canonicalPath: "plugin-specs/target-one.yaml" }] });
	assert.deepEqual(result.findings, []);
});

test("a router entry with one existing target path is clean", () => {
	const result = validate(carrierText({
		specKey: "router-one",
		role: "router",
		carries: BASE_CARRIES,
		requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/target-one.yaml。" }]
	}), { actualPath: "plugin-specs/router-one.yaml", carrierCatalog: [{ specKey: "target-one", canonicalPath: "plugin-specs/target-one.yaml" }] });
	assert.deepEqual(result.findings, []);
});

test("a router entry with two target paths is rejected", () => {
	const result = validate(carrierText({
		specKey: "router-one",
		role: "router",
		carries: BASE_CARRIES,
		requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/target-one.yaml 或 plugin-specs/target-two.yaml。" }]
	}), {
		actualPath: "plugin-specs/router-one.yaml",
		carrierCatalog: [
			{ specKey: "target-one", canonicalPath: "plugin-specs/target-one.yaml" },
			{ specKey: "target-two", canonicalPath: "plugin-specs/target-two.yaml" }
		]
	});
	assert.deepEqual(codes(result), [
		"prohibited/other_runtime_carrier",
		"prohibited/other_runtime_carrier",
		"structure/router_target_count"
	]);
});

test("a router entry mentioning a target spec_key loses the exemption", () => {
	const result = validate(carrierText({
		specKey: "router-one",
		role: "router",
		carries: BASE_CARRIES,
		requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/target-one.yaml，目标标识 target-one。" }]
	}), { actualPath: "plugin-specs/router-one.yaml", carrierCatalog: [{ specKey: "target-one", canonicalPath: "plugin-specs/target-one.yaml" }] });
	assert.deepEqual(codes(result), ["prohibited/other_runtime_carrier", "prohibited/other_runtime_carrier"]);
});

test("an unresolved router target is rejected", () => {
	const result = validate(carrierText({
		specKey: "router-one",
		role: "router",
		carries: BASE_CARRIES,
		requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/ghost.yaml。" }]
	}), { actualPath: "plugin-specs/router-one.yaml" });
	assert.deepEqual(shape(result, "structure/router_target_unresolved", ["fieldPath", "matched"]), [
		{ code: "structure/router_target_unresolved", fieldPath: "ldvh_spec.requirements[0].text", matched: "plugin-specs/ghost.yaml" }
	]);
});

test("a router pointing at itself is rejected", () => {
	const result = validate(carrierText({
		specKey: "router-one",
		role: "router",
		carries: BASE_CARRIES,
		requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/router-one.yaml。" }]
	}), { actualPath: "plugin-specs/router-one.yaml" });
	assert.deepEqual(shape(result, "structure/router_target_self", ["fieldPath"]), [
		{ code: "structure/router_target_self", fieldPath: "ldvh_spec.requirements[0].text" }
	]);
});

test("a router pointing at another router is rejected", () => {
	const result = validate(carrierText({
		specKey: "router-one",
		role: "router",
		carries: BASE_CARRIES,
		requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/router-two.yaml。" }]
	}), {
		actualPath: "plugin-specs/router-one.yaml",
		carrierCatalog: [{ specKey: "router-two", canonicalPath: "plugin-specs/router-two.yaml", role: "router" }]
	});
	assert.deepEqual(shape(result, "structure/router_target_router", ["fieldPath"]), [
		{ code: "structure/router_target_router", fieldPath: "ldvh_spec.requirements[0].text" }
	]);
});

test("two routers in one corpus are rejected", () => {
	const corpus = validateRuntimeCarrierCorpus({
		carriers: [
			{ text: carrierText({ specKey: "target-one" }), actualPath: "plugin-specs/target-one.yaml" },
			{
				text: carrierText({
					specKey: "router-one",
					role: "router",
					requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/target-one.yaml。" }]
				}),
				actualPath: "plugin-specs/router-one.yaml"
			},
			{
				text: carrierText({
					specKey: "router-two",
					role: "router",
					requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/target-one.yaml。" }]
				}),
				actualPath: "plugin-specs/router-two.yaml"
			}
		]
	});
	assert.deepEqual(shape(corpus, "structure/router_multiple", ["level", "fieldPath", "carriers"]), [
		{
			code: "structure/router_multiple",
			level: "error",
			fieldPath: "ldvh_spec.role",
			carriers: ["plugin-specs/router-one.yaml", "plugin-specs/router-two.yaml"]
		}
	]);
});

test("a corpus with two routers fails as a whole", () => {
	const corpus = validateRuntimeCarrierCorpus({
		carriers: [
			{
				text: carrierText({
					specKey: "router-one",
					role: "router",
					requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/target-one.yaml。" }]
				}),
				actualPath: "plugin-specs/router-one.yaml"
			},
			{
				text: carrierText({
					specKey: "router-two",
					role: "router",
					requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/target-one.yaml。" }]
				}),
				actualPath: "plugin-specs/router-two.yaml"
			},
			{ text: carrierText({ specKey: "target-one" }), actualPath: "plugin-specs/target-one.yaml" }
		]
	});
	assert.deepEqual({ verdict: corpus.verdict, ok: corpus.ok }, { verdict: "fail", ok: false });
});

test("one router in a corpus is counted once", () => {
	const corpus = validateRuntimeCarrierCorpus({
		carriers: [
			{ text: carrierText({ specKey: "target-one" }), actualPath: "plugin-specs/target-one.yaml" },
			{
				text: carrierText({
					specKey: "router-one",
					role: "router",
					requirements: [{ id: "go", title: "去目标", text: "读 plugin-specs/target-one.yaml。" }]
				}),
				actualPath: "plugin-specs/router-one.yaml"
			}
		]
	});
	assert.deepEqual(corpus.summary, { carrierCount: 2, verdict: "pass", errorCount: 0, hintCount: 1, gapCount: 0, routerCount: 1 });
});

test("a two-namespace view lists both namespaces as a set", () => {
	const view = createSpecNamespaceView({
		runtimeCarriers: [{ specKey: "ldvh-root", canonicalPath: "plugin-specs/ldvh-root.yaml" }],
		developmentSpecs: [{ specKey: "ldvh-root", canonicalPath: "specs/00-理念与构成.md" }]
	});
	assert.deepEqual([...view.namespaces].sort(), ["plugin-specs", "specs"]);
});

test("identifier-only resolution across both namespaces is rejected", () => {
	const view = createSpecNamespaceView({
		runtimeCarriers: [{ specKey: "ldvh-root", canonicalPath: "plugin-specs/ldvh-root.yaml" }],
		developmentSpecs: [{ specKey: "ldvh-root", canonicalPath: "specs/00-理念与构成.md" }]
	});
	assert.equal(resolveSpecReference(view, { specKey: "ldvh-root" }).error.code, "namespace/ambiguous_identifier");
});

test("namespace-qualified resolution selects each side", () => {
	const view = createSpecNamespaceView({
		runtimeCarriers: [{ specKey: "ldvh-root", canonicalPath: "plugin-specs/ldvh-root.yaml" }],
		developmentSpecs: [{ specKey: "ldvh-root", canonicalPath: "specs/00-理念与构成.md" }]
	});
	const runtime = resolveSpecReference(view, { specKey: "ldvh-root", namespace: "plugin-specs" });
	const development = resolveSpecReference(view, { specKey: "ldvh-root", namespace: "specs" });
	assert.deepEqual([runtime.value.namespace, development.value.namespace], ["plugin-specs", "specs"]);
});

test("path resolution selects the owning side", () => {
	const view = createSpecNamespaceView({
		runtimeCarriers: [{ specKey: "ldvh-root", canonicalPath: "plugin-specs/ldvh-root.yaml" }],
		developmentSpecs: [{ specKey: "ldvh-root", canonicalPath: "specs/00-理念与构成.md" }]
	});
	const runtime = resolveSpecReference(view, { canonicalPath: "plugin-specs/ldvh-root.yaml" });
	const development = resolveSpecReference(view, { canonicalPath: "specs/00-理念与构成.md" });
	assert.deepEqual([runtime.value.namespace, development.value.namespace], ["plugin-specs", "specs"]);
});

test("a path resolved under the wrong namespace is rejected", () => {
	const view = createSpecNamespaceView({
		runtimeCarriers: [{ specKey: "ldvh-root", canonicalPath: "plugin-specs/ldvh-root.yaml" }],
		developmentSpecs: [{ specKey: "ldvh-root", canonicalPath: "specs/00-理念与构成.md" }]
	});
	assert.equal(
		resolveSpecReference(view, { canonicalPath: "plugin-specs/ldvh-root.yaml", namespace: "specs" }).error.code,
		"namespace/path_mismatch"
	);
});

test("an unknown path is rejected", () => {
	const view = createSpecNamespaceView({ runtimeCarriers: [{ specKey: "one", canonicalPath: "plugin-specs/one.yaml" }] });
	assert.equal(resolveSpecReference(view, { canonicalPath: "plugin-specs/ghost.yaml" }).error.code, "namespace/path_not_found");
});

test("a request with both key and path is rejected", () => {
	const view = createSpecNamespaceView({ runtimeCarriers: [{ specKey: "one", canonicalPath: "plugin-specs/one.yaml" }] });
	assert.equal(
		resolveSpecReference(view, { specKey: "one", canonicalPath: "plugin-specs/one.yaml" }).error.code,
		"namespace/request_invalid"
	);
});

test("a request with neither key nor path is rejected", () => {
	const view = createSpecNamespaceView({ runtimeCarriers: [{ specKey: "one", canonicalPath: "plugin-specs/one.yaml" }] });
	assert.equal(resolveSpecReference(view, {}).error.code, "namespace/request_invalid");
});

test("a duplicated key inside one namespace is rejected", () => {
	const view = createSpecNamespaceView({
		runtimeCarriers: [
			{ specKey: "one", canonicalPath: "plugin-specs/one.yaml" },
			{ specKey: "one", canonicalPath: "plugin-specs/one-copy.yaml" }
		]
	});
	assert.equal(resolveSpecReference(view, { specKey: "one" }).error.code, "namespace/ambiguous_identifier");
});

test("a duplicated path is rejected", () => {
	const view = createSpecNamespaceView({
		runtimeCarriers: [{ specKey: "one", canonicalPath: "specs/shared.md" }],
		developmentSpecs: [{ specKey: "two", canonicalPath: "specs/shared.md" }]
	});
	assert.equal(resolveSpecReference(view, { canonicalPath: "specs/shared.md" }).error.code, "namespace/path_ambiguous");
});

test("an uncovered namespace is rejected", () => {
	const view = createSpecNamespaceView({ runtimeCarriers: [{ specKey: "one", canonicalPath: "plugin-specs/one.yaml" }] });
	assert.equal(resolveSpecReference(view, { specKey: "one", namespace: "specs" }).error.code, "namespace/not_covered");
});

test("a single-namespace view resolves identifiers", () => {
	const view = createSpecNamespaceView({ runtimeCarriers: [{ specKey: "one", canonicalPath: "plugin-specs/one.yaml" }] });
	assert.deepEqual(resolveSpecReference(view, { specKey: "one" }).value, {
		namespace: "plugin-specs",
		specKey: "one",
		canonicalPath: "plugin-specs/one.yaml"
	});
});

test("an empty view resolves no identifier", () => {
	const view = createSpecNamespaceView({});
	assert.equal(resolveSpecReference(view, { specKey: "one" }).error.code, "namespace/not_covered");
});

test("a key missing from the namespace is rejected", () => {
	const view = createSpecNamespaceView({ runtimeCarriers: [{ specKey: "one", canonicalPath: "plugin-specs/one.yaml" }] });
	assert.equal(resolveSpecReference(view, { specKey: "absent" }).error.code, "namespace/not_found");
});

test("the namespace view is frozen", () => {
	const view = createSpecNamespaceView({ runtimeCarriers: [{ specKey: "one", canonicalPath: "plugin-specs/one.yaml" }] });
	assert.equal(Object.isFrozen(view) && Object.isFrozen(view.namespaces) && Object.isFrozen(view.entries), true);
});

test("buildDevelopmentSpecCorpus admits only development specs", () => {
	const corpus = buildDevelopmentSpecCorpus([
		{ text: DEV_TEXT, path: DEV_PATH },
		ATTACHMENT_DOC,
		{ text: "not a spec", path: "specs/bad.md" }
	]);
	assert.deepEqual({
		specKeys: corpus.specs.map((spec) => spec.specKey),
		canonicalPaths: corpus.specs.map((spec) => spec.canonicalPath),
		accepted: corpus.counts.accepted
	}, {
		specKeys: ["dev-target"],
		canonicalPaths: [DEV_PATH],
		accepted: 1
	});
});

test("buildDevelopmentSpecCorpus counts accepted, parse-failed and kind-mismatch documents", () => {
	const corpus = buildDevelopmentSpecCorpus([
		{ text: DEV_TEXT, path: DEV_PATH },
		ATTACHMENT_DOC,
		{ text: "not a spec", path: "specs/bad.md" }
	]);
	assert.deepEqual(corpus.counts, { accepted: 1, parseFailed: 1, kindMismatch: 1 });
});

test("buildDevelopmentSpecCorpus separates parse failures from kind mismatches", () => {
	const corpus = buildDevelopmentSpecCorpus([
		{ text: DEV_TEXT, path: DEV_PATH },
		ATTACHMENT_DOC,
		{ text: "not a spec", path: "specs/bad.md" }
	]);
	assert.deepEqual({
		parseFailures: corpus.parseFailures.map((entry) => ({ path: entry.path, reason: entry.reason, code: entry.error.code })),
		kindMismatches: corpus.kindMismatches.map((entry) => ({ path: entry.path, reason: entry.reason, kind: entry.kind })),
		rejectedReasons: corpus.rejected.map((entry) => entry.reason).sort()
	}, {
		parseFailures: [{ path: "specs/bad.md", reason: "parse_failed", code: "identity/fence_missing" }],
		kindMismatches: [{ path: ATTACHMENT_PATH, reason: "kind_mismatch", kind: "ldvh_attachment" }],
		rejectedReasons: ["kind_mismatch", "parse_failed"]
	});
});

test("an empty corpus summary is zeroed", () => {
	assert.deepEqual(validateRuntimeCarrierCorpus({}).summary, {
		carrierCount: 0,
		verdict: "pass",
		errorCount: 0,
		hintCount: 0,
		gapCount: 0,
		routerCount: 0
	});
});

test("the corpus summary counts errors and hints", () => {
	const corpus = validateRuntimeCarrierCorpus({
		carriers: [
			{ text: carrierText({}), actualPath: "plugin-specs/demo-carrier.yaml" },
			{ text: carrierText({ carries: ["nope"] }), actualPath: "plugin-specs/demo-carrier.yaml" }
		],
		developmentSpecs: DEV_SPECS
	});
	assert.deepEqual({
		errors: corpus.summary.errorCount,
		hints: corpus.summary.hintCount,
		verdict: corpus.verdict,
		summaryVerdict: corpus.summary.verdict,
		ok: corpus.ok
	}, { errors: 1, hints: 1, verdict: "fail", summaryVerdict: "fail", ok: false });
});
