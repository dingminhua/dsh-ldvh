// Tests for plugin/lib/spec-registry.js: identity-block parsing, heading-path
// resolution and L0–L4 projection.
//
// Authority: specs/01 §6 (identity block contract, elaborated by 01.Att.02
// field tables) and 01.Att.03 §4 (L0–L4 disclosure levels).
//
// Real-corpus assertion: the real specs/01–10 and the three attachments must
// all parse as `ok: true` — that is the v5 self-consistency check. specs/00
// is the documented exception (its `code_consumption` values use snake_case
// instead of the responsibility-identifier kebab-case pattern), so it is
// intentionally NOT part of the bulk parse and is asserted separately as
// the known contract violation.
import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	contentFingerprint,
	extractHeadings,
	parseIdentityBlock,
	parseSpecDocument,
	projectLayer,
	resolveHeadingPath,
	splitIdentityBlock,
} from "../lib/spec-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const specsRoot = join(__dirname, "..", "..", "specs");

/** Build a minimal YAML identity block string for the given { ldvh_spec: {...} } object. */
function identityBlock(yamlObject) {
	const rootKey = Object.keys(yamlObject)[0];
	const fields = yamlObject[rootKey];
	const lines = [`${rootKey}:`];
	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value)) {
			const items = value.map((v) => JSON.stringify(v)).join(", ");
			lines.push(`  ${key}: [${items}]`);
		} else {
			lines.push(`  ${key}: ${JSON.stringify(value)}`);
		}
	}
	return lines.join("\n");
}

/** Wrap h1 + identity block + optional body in a full spec document. */
function specDoc(h1, yamlObject, body = "## 1. Demo\n\n正文。") {
	return `# ${h1}\n\n\`\`\`yaml\n${identityBlock(yamlObject)}\n\`\`\`\n\n${body}`;
}

// ---------------------------------------------------------------------------
// splitIdentityBlock
// ---------------------------------------------------------------------------

test("splitIdentityBlock accepts the canonical file-head formation", () => {
	const text = specDoc("示例规范", { ldvh_spec: { spec_key: "demo", spec_id: "99", spec_kind: "spec", title: "示例规范", canonical_path: "specs/99-示例.md", parent_spec: "", relation: "", positioning: "p", scope: "s" } });
	const result = splitIdentityBlock(text);
	assert.equal(result.ok, true);
	assert.equal(result.value.h1, "示例规范");
	assert.equal(result.value.yamlLine, 3);
	assert.equal(result.value.totalLines, text.split("\n").length);
});

test("splitIdentityBlock rejects an empty file", () => {
	const result = splitIdentityBlock("");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/h1_missing");
});

test("splitIdentityBlock rejects a missing H1", () => {
	const result = splitIdentityBlock("```yaml\nfoo: 1\n```\n");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/h1_missing");
});

test("splitIdentityBlock rejects multiple H1 headings", () => {
	const text = "# 一级\n\n```yaml\nx: 1\n```\n\n# 又一个\n";
	const result = splitIdentityBlock(text);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/h1_missing");
});

test("splitIdentityBlock rejects H1 followed by a non-blank line", () => {
	const text = "# 一级\n文本\n```yaml\nx: 1\n```\n";
	const result = splitIdentityBlock(text);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/block_position");
});

test("splitIdentityBlock rejects when the fence is not on line 3", () => {
	const text = "# 一级\n\nnot a fence\n```yaml\nx: 1\n```\n";
	const result = splitIdentityBlock(text);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/fence_missing");
});

test("splitIdentityBlock rejects an unclosed fence", () => {
	const text = "# 一级\n\n```yaml\nx: 1\n";
	const result = splitIdentityBlock(text);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/fence_unclosed");
});

test("splitIdentityBlock ignores a later yaml example fence inside the body", () => {
	const body = "## 1. 示例\n\n正文：\n\n```yaml\nexample: true\n```\n\n后续正文。";
	const text = specDoc("示例", { ldvh_spec: { spec_key: "demo", spec_id: "99", spec_kind: "spec", title: "示例", canonical_path: "specs/99-示例.md", parent_spec: "", relation: "", positioning: "p", scope: "s" } }, body);
	const result = splitIdentityBlock(text);
	assert.equal(result.ok, true);
	// identity block yamlText must contain only the identity's own fields
	assert.ok(!result.value.yamlText.includes("example:"));
});

// ---------------------------------------------------------------------------
// parseIdentityBlock: scalar quoting and flow sequences
// ---------------------------------------------------------------------------

test("parseIdentityBlock accepts a double-quoted scalar", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, true, result.error?.message);
	assert.equal(result.value.responsibilityKey, "demo");
	assert.equal(result.value.kind, "ldvh_spec");
});

test("parseIdentityBlock accepts a flow sequence with quoted members", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
  basis: ["ldvh-root"]
  authorized_attachments: ["demo-att"]
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, true, result.error?.message);
	assert.deepEqual(result.value.basis, ["ldvh-root"]);
	assert.deepEqual(result.value.authorizedAttachments, ["demo-att"]);
});

test("parseIdentityBlock accepts an empty flow sequence", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
  basis: []
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, true, result.error?.message);
	assert.deepEqual(result.value.basis, []);
});

test("parseIdentityBlock rejects an unquoted scalar string", () => {
	const yaml = `ldvh_spec:
  spec_key: demo
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects a duplicate top-level key", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  spec_key: "duplicated"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/duplicate_key");
});

test("parseIdentityBlock rejects an unknown spec field", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
  unknown_field: "x"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/unknown_field");
});

test("parseIdentityBlock rejects an unknown identity root", () => {
	const yaml = `ldvh_other:
  x: "1"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/top_level");
});

test("parseIdentityBlock rejects two top-level keys", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
ldvh_attachment:
  attachment_key: "x"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/top_level");
});

test("parseIdentityBlock rejects a flow mapping value", () => {
	const yaml = `ldvh_spec:
  spec_key: {a: "b"}
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

// ---------------------------------------------------------------------------
// parseIdentityBlock: responsibility identifier and spec id patterns
// ---------------------------------------------------------------------------

test("parseIdentityBlock rejects a spec_key that starts with a digit", () => {
	const yaml = `ldvh_spec:
  spec_key: "9demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects an uppercase spec_key", () => {
	const yaml = `ldvh_spec:
  spec_key: "Demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock accepts a kebab-case spec_key", () => {
	const yaml = `ldvh_spec:
  spec_key: "kebab-case-id"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, true, result.error?.message);
});

test("parseIdentityBlock rejects a single-digit spec_id", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "9"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/9-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects a non-spec spec_kind", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "specification"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects an attachment_id that misses the Att segment", () => {
	const yaml = `ldvh_attachment:
  attachment_key: "demo-att"
  attachment_id: "01.02"
  title: "示例附件"
  canonical_path: "specs/attachments/01.02-示例附件.md"
  positioning: "x"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

// ---------------------------------------------------------------------------
// parseIdentityBlock: parent_spec / relation pairing
// ---------------------------------------------------------------------------

test("parseIdentityBlock accepts parent_spec+relation both empty (parentless)", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, true, result.error?.message);
});

test("parseIdentityBlock accepts parent_spec+relation both non-empty (refines)", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: "ldvh-root"
  relation: "refines"
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, true, result.error?.message);
});

test("parseIdentityBlock rejects parent_spec set but relation empty", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: "ldvh-root"
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects relation with an out-of-set value", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: "ldvh-root"
  relation: "supersedes"
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects parent_spec pointing at the document itself", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: "demo"
  relation: "refines"
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

// ---------------------------------------------------------------------------
// parseIdentityBlock: basis / supersedes / related_specs self-reference
// ---------------------------------------------------------------------------

test("parseIdentityBlock rejects basis that names the document's own key", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
  basis: ["demo"]
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects basis that duplicates a non-empty parent_spec", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: "ldvh-root"
  relation: "refines"
  positioning: "p"
  scope: "s"
  basis: ["ldvh-root"]
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects related_specs that names the document itself", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
  related_specs: ["demo"]
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects dimensions with an out-of-set value", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
  dimensions: ["read", "magic"]
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

// ---------------------------------------------------------------------------
// parseIdentityBlock: title and canonical_path
// ---------------------------------------------------------------------------

test("parseIdentityBlock rejects an empty title", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: ""
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_missing");
});

test("parseIdentityBlock rejects a title that contains a slash", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例/含斜杠"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects a malformed canonical_path", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "wrong/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

// ---------------------------------------------------------------------------
// parseIdentityBlock: root profile
// ---------------------------------------------------------------------------

const rootYaml = `ldvh_spec:
  spec_key: "ldvh-root"
  spec_id: "00"
  spec_kind: "spec"
  title: "理念与构成"
  authority: "active"
  canonical_path: "specs/00-理念与构成.md"
  parent_spec: ""
  relation: ""
  positioning: "根定位"
  scope: "根范围"
  basis: []
  related_specs: ["specification-model-foundation"]
  dimensions: ["read", "write", "comply", "deliberate", "review", "execute", "reflect", "consolidate"]
  code_consumption: ["ldvh-root", "specification-model-foundation", "eight-dimension-work-model", "fact-model-foundation", "action-template-foundation", "helper-service-boundary", "fact-source-traceability", "work-object-and-governance", "dsh-environment-binding", "code-practice-and-test", "web-presentation-and-interaction"]
`;

test("parseIdentityBlock accepts a fully legal root profile", () => {
	const result = parseIdentityBlock(rootYaml);
	assert.equal(result.ok, true, result.error?.message);
	assert.equal(result.value.responsibilityKey, "ldvh-root");
	assert.equal(result.value.authority, "active");
	assert.equal(result.value.dimensions.length, 8);
});

test("parseIdentityBlock accepts a root profile with an empty related_specs list (per 01.Att.02 §3 table)", () => {
	// The 01.Att.02 §3 root-profile table explicitly allows `related_specs: []`
	// (必填；允许空列表). The current implementation rejects it with
	// `related_specs must not be empty` — see the "疑似实现缺陷" note in the
	// test report. This test documents the contract: a constructed root
	// profile with related_specs: [] is legal per 01.Att.02 §3; if the
	// implementation evolves to honour the table, the test starts passing.
	const yaml = `ldvh_spec:
  spec_key: "ldvh-root"
  spec_id: "00"
  spec_kind: "spec"
  title: "理念与构成"
  authority: "active"
  canonical_path: "specs/00-理念与构成.md"
  parent_spec: ""
  relation: ""
  positioning: "根定位"
  scope: "根范围"
  basis: []
  related_specs: []
  dimensions: ["read", "write", "comply", "deliberate", "review", "execute", "reflect", "consolidate"]
  code_consumption: ["specification-model-foundation"]
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, true, `contract says related_specs: [] is legal on the root profile; got ${result.error?.code} ${result.error?.message}`);
});

test("parseIdentityBlock rejects a root profile whose dimensions order is not canonical", () => {
	const tampered = rootYaml.replace(
		'dimensions: ["read", "write", "comply", "deliberate", "review", "execute", "reflect", "consolidate"]',
		'dimensions: ["write", "read", "comply", "deliberate", "review", "execute", "reflect", "consolidate"]',
	);
	const result = parseIdentityBlock(tampered);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects a root profile whose code_consumption uses snake_case (responsibility-identifier contract)", () => {
	// This is the contract-violation that the real specs/00 exhibits: its
	// code_consumption values use underscores (spec_identity_block) instead
	// of the responsibility-identifier pattern (kebab-case). The contract
	// says reject; the implementation rejects. Real specs/00 therefore
	// fails to parse, which is the test that the contract is alive.
	const tampered = rootYaml.replace(
		'code_consumption: ["ldvh-root", "specification-model-foundation", "eight-dimension-work-model", "fact-model-foundation", "action-template-foundation", "helper-service-boundary", "fact-source-traceability", "work-object-and-governance", "dsh-environment-binding", "code-practice-and-test", "web-presentation-and-interaction"]',
		'code_consumption: ["spec_identity_block", "spec_read_contract"]',
	);
	const result = parseIdentityBlock(tampered);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/field_invalid");
});

test("parseIdentityBlock rejects authority on a non-root spec", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
  authority: "active"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/unknown_field");
});

test("parseIdentityBlock rejects code_consumption on a non-root spec", () => {
	const yaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
  code_consumption: ["x"]
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/unknown_field");
});

// ---------------------------------------------------------------------------
// parseIdentityBlock: attachment profile
// ---------------------------------------------------------------------------

test("parseIdentityBlock accepts a minimal attachment", () => {
	const yaml = `ldvh_attachment:
  attachment_key: "demo-att"
  attachment_id: "01.Att.99"
  title: "示例附件"
  canonical_path: "specs/attachments/01.Att.99-示例附件.md"
  positioning: "示例附件定位"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, true, result.error?.message);
	assert.equal(result.value.kind, "ldvh_attachment");
});

test("parseIdentityBlock rejects an attachment that declares scope", () => {
	const yaml = `ldvh_attachment:
  attachment_key: "demo-att"
  attachment_id: "01.Att.99"
  title: "示例附件"
  canonical_path: "specs/attachments/01.Att.99-示例附件.md"
  positioning: "示例附件定位"
  scope: "forbidden"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/unknown_field");
});

test("parseIdentityBlock rejects an attachment that declares basis", () => {
	const yaml = `ldvh_attachment:
  attachment_key: "demo-att"
  attachment_id: "01.Att.99"
  title: "示例附件"
  canonical_path: "specs/attachments/01.Att.99-示例附件.md"
  positioning: "示例附件定位"
  basis: ["ldvh-root"]
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/unknown_field");
});

test("parseIdentityBlock rejects an attachment that declares parent_spec", () => {
	const yaml = `ldvh_attachment:
  attachment_key: "demo-att"
  attachment_id: "01.Att.99"
  title: "示例附件"
  canonical_path: "specs/attachments/01.Att.99-示例附件.md"
  positioning: "示例附件定位"
  parent_spec: "ldvh-root"
`;
	const result = parseIdentityBlock(yaml);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/unknown_field");
});

// ---------------------------------------------------------------------------
// parseSpecDocument: cross-checks H1 and canonical_path
// ---------------------------------------------------------------------------

test("parseSpecDocument accepts a document with matching H1, title and canonical_path", () => {
	const text = specDoc("示例", { ldvh_spec: { spec_key: "demo", spec_id: "99", spec_kind: "spec", title: "示例", canonical_path: "specs/99-示例.md", parent_spec: "", relation: "", positioning: "p", scope: "s" } });
	const result = parseSpecDocument(text, "specs/99-示例.md");
	assert.equal(result.ok, true, result.error?.message);
	assert.equal(result.value.h1, "示例");
	assert.equal(result.value.identity.responsibilityKey, "demo");
});

test("parseSpecDocument rejects when the H1 does not match the title field", () => {
	const text = specDoc("不一样的 H1", { ldvh_spec: { spec_key: "demo", spec_id: "99", spec_kind: "spec", title: "示例", canonical_path: "specs/99-示例.md", parent_spec: "", relation: "", positioning: "p", scope: "s" } });
	const result = parseSpecDocument(text, "specs/99-示例.md");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/title_mismatch");
});

test("parseSpecDocument rejects when the canonical_path does not match the actual path", () => {
	const text = specDoc("示例", { ldvh_spec: { spec_key: "demo", spec_id: "99", spec_kind: "spec", title: "示例", canonical_path: "specs/99-示例.md", parent_spec: "", relation: "", positioning: "p", scope: "s" } });
	const result = parseSpecDocument(text, "specs/other.md");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "identity/path_mismatch");
});

test("parseSpecDocument skips the canonical_path check when no actualPath is supplied", () => {
	const text = specDoc("示例", { ldvh_spec: { spec_key: "demo", spec_id: "99", spec_kind: "spec", title: "示例", canonical_path: "specs/99-示例.md", parent_spec: "", relation: "", positioning: "p", scope: "s" } });
	const result = parseSpecDocument(text);
	assert.equal(result.ok, true, result.error?.message);
});

// ---------------------------------------------------------------------------
// extractHeadings and resolveHeadingPath
// ---------------------------------------------------------------------------

test("extractHeadings records H2 and H3 with 1-based line numbers", () => {
	const text = "# 一级\n\n```yaml\nx: 1\n```\n\n## 一\n\n段落\n\n### 一.一\n\n细节\n\n## 二";
	const headings = extractHeadings(text);
	assert.equal(headings.length, 3);
	assert.equal(headings[0].level, 2);
	assert.equal(headings[0].text, "一");
	assert.equal(headings[0].line, 7);
	assert.equal(headings[1].level, 3);
	assert.equal(headings[1].text, "一.一");
	assert.equal(headings[1].line, 11);
	assert.equal(headings[2].level, 2);
	assert.equal(headings[2].text, "二");
});

// resolveHeadingPath tests: use body text WITHOUT a trailing newline so that
// endLine calculations are predictable and do not count phantom lines.
test("resolveHeadingPath returns the H2 slice when the heading has no following same-or-higher heading", () => {
	// Line 1: ## 唯一小节
	// Line 2: (blank)
	// Line 3: 正文 A
	// Line 4: (blank)
	// Line 5: ## 第二节
	const text = "## 唯一小节\n\n正文 A\n\n## 第二节";
	const result = resolveHeadingPath(text, "唯一小节");
	assert.equal(result.ok, true, result.error?.message);
	assert.equal(result.value.startLine, 1);
	// sectionEnd finds the next H2 ("第二节") at line 5; endLine = 5 - 1 = 4
	assert.equal(result.value.endLine, 4);
});

test("resolveHeadingPath returns the file end when the H2 has no following same-or-higher heading", () => {
	// Line 1: ## 唯一一节
	// Line 2: (blank)
	// Line 3: 正文
	// (no further ## or ### at any level)
	const text = "## 唯一一节\n\n正文";
	const result = resolveHeadingPath(text, "唯一一节");
	assert.equal(result.ok, true, result.error?.message);
	assert.equal(result.value.startLine, 1);
	assert.equal(result.value.endLine, text.split("\n").length);
});

test("resolveHeadingPath resolves an H2/H3 path with a same-level boundary", () => {
	// Line 1: ## 父节
	// Line 2: (blank)
	// Line 3: ### 子节 A
	// Line 4: (blank)
	// Line 5: A 正文
	// Line 6: (blank)
	// Line 7: ### 子节 B
	// Line 8: (blank)
	// Line 9: B 正文
	// Line 10: (blank)
	// Line 11: ## 下个父节
	const text = "## 父节\n\n### 子节 A\n\nA 正文\n\n### 子节 B\n\nB 正文\n\n## 下个父节";
	const result = resolveHeadingPath(text, "父节/子节 A");
	assert.equal(result.ok, true, result.error?.message);
	assert.equal(result.value.startLine, 3);
});

test("resolveHeadingPath rejects an empty heading_path", () => {
	assert.equal(resolveHeadingPath("## x\n", "").ok, false);
});

test("resolveHeadingPath rejects a path with more than 2 segments", () => {
	const result = resolveHeadingPath("## x\n\n### y\n", "x/y/z");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "content/heading_path_invalid");
});

test("resolveHeadingPath rejects a path with an empty segment", () => {
	const result = resolveHeadingPath("## x\n", "x/");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "content/heading_path_invalid");
});

test("resolveHeadingPath rejects an unknown H2 with heading_not_found", () => {
	const result = resolveHeadingPath("## 存在的\n", "不存在的");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "content/heading_not_found");
});

test("resolveHeadingPath rejects an H2 that appears multiple times with heading_ambiguous", () => {
	const text = "## 重复\n\nA\n\n## 其它\n\nB\n\n## 重复\n\nC";
	const result = resolveHeadingPath(text, "重复");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "content/heading_ambiguous");
});

test("resolveHeadingPath rejects an H3 that appears multiple times inside its H2 with heading_ambiguous", () => {
	const text = "## 父节\n\n### 重复\n\nA\n\n### 重复\n\nB\n\n## 下一节";
	const result = resolveHeadingPath(text, "父节/重复");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "content/heading_ambiguous");
});

test("resolveHeadingPath strips the numeric H2 prefix that real specs use", () => {
	// The real spec H2 lines look like "## 3. 职责边界" — the path argument
	// must match the heading's exact text after the regex strips the "## " prefix.
	const text = "## 3. 职责边界\n\n正文\n\n## 4. 其它";
	const result = resolveHeadingPath(text, "3. 职责边界");
	assert.equal(result.ok, true, result.error?.message);
	assert.equal(result.value.startLine, 1);
});

// ---------------------------------------------------------------------------
// contentFingerprint
// ---------------------------------------------------------------------------

test("contentFingerprint is sha256 hex and stable", () => {
	const a = contentFingerprint("hello\n");
	const b = contentFingerprint("hello\n");
	const c = contentFingerprint("hello");
	assert.match(a, /^[0-9a-f]{64}$/);
	assert.equal(a, b);
	assert.notEqual(a, c);
});

// ---------------------------------------------------------------------------
// projectLayer
// ---------------------------------------------------------------------------

// A plain spec identity with no parent so basis can include ldvh-root freely.
const plainSpecYaml = `ldvh_spec:
  spec_key: "demo"
  spec_id: "99"
  spec_kind: "spec"
  title: "示例"
  canonical_path: "specs/99-示例.md"
  parent_spec: ""
  relation: ""
  positioning: "p"
  scope: "s"
  basis: ["ldvh-root"]
  authorized_attachments: []
  related_specs: ["eight-dimension-work-model"]
  dimensions: ["read", "write"]
`;

/** Parse plainSpecYaml once for all projectLayer tests. */
const plainSpecIdentity = parseIdentityBlock(plainSpecYaml).value;

test("projectLayer L0 contains only the five identity anchors", () => {
	const out = projectLayer(plainSpecIdentity, "L0");
	assert.equal(out.layer, "L0");
	assert.equal(out.responsibility_key, "demo");
	assert.equal(out.spec_id, "99");
	assert.equal(out.title, "示例");
	assert.equal(out.canonical_path, "specs/99-示例.md");
	assert.equal(out.carrier_kind, "ldvh_spec");
	// scope and positioning are L1+ only
	assert.equal(out.scope, undefined);
	assert.equal(out.positioning, undefined);
	assert.equal(out.basis, undefined);
});

test("projectLayer L1 adds positioning and scope", () => {
	const out = projectLayer(plainSpecIdentity, "L1");
	assert.equal(out.layer, "L1");
	assert.equal(out.positioning, "p");
	assert.equal(out.scope, "s");
	assert.equal(out.basis, undefined);
});

test("projectLayer L2 adds relation fields but not authority/code_consumption", () => {
	const out = projectLayer(plainSpecIdentity, "L2");
	assert.equal(out.layer, "L2");
	assert.equal(out.positioning, "p");
	assert.equal(out.scope, "s");
	assert.deepEqual(out.basis, ["ldvh-root"]);
	assert.equal(out.parent_spec, "");
	assert.equal(out.relation, "");
	assert.deepEqual(out.authorized_attachments, []);
	assert.deepEqual(out.related_specs, ["eight-dimension-work-model"]);
	assert.deepEqual(out.dimensions, ["read", "write"]);
	assert.equal(out.authority, undefined);
	assert.equal(out.code_consumption, undefined);
});

test("projectLayer L2 includes section_outline when supplied", () => {
	const outline = [{ level: 2, text: "x", line: 1 }];
	const out = projectLayer(plainSpecIdentity, "L2", outline);
	assert.deepEqual(out.section_outline, outline);
});

test("projectLayer on an attachment omits spec-only fields at L2", () => {
	const attYaml = `ldvh_attachment:
  attachment_key: "demo-att"
  attachment_id: "01.Att.99"
  title: "示例附件"
  canonical_path: "specs/attachments/01.Att.99-示例附件.md"
  positioning: "示例附件定位"
`;
	const identity = parseIdentityBlock(attYaml).value;
	const l1 = projectLayer(identity, "L1");
	assert.equal(l1.layer, "L1");
	assert.equal(l1.scope, undefined); // attachments don't carry scope
	const l2 = projectLayer(identity, "L2");
	assert.equal(l2.layer, "L2");
	assert.equal(l2.basis, undefined);
	assert.equal(l2.parent_spec, undefined);
	assert.equal(l2.relation, undefined);
	assert.equal(l2.authorized_attachments, undefined);
});

// ---------------------------------------------------------------------------
// Real-corpus self-consistency
// ---------------------------------------------------------------------------

test("parseSpecDocument parses every real specs/01..10 and the three attachments without error", async () => {
	const expected = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];
	for (const id of expected) {
		const allFiles = await readdir(specsRoot);
		const match = allFiles.find((name) => new RegExp(`^${id}-[^/]+\\.md$`).test(name));
		assert.ok(match, `expected to find specs/${id}-*.md on disk`);
		const text = await readFile(join(specsRoot, match), "utf8");
		const result = parseSpecDocument(text, `specs/${match}`);
		assert.equal(result.ok, true, `specs/${match} failed: ${result.error?.code} ${result.error?.message}`);
	}
	const attachments = (await readdir(join(specsRoot, "attachments"))).filter((name) => /\.md$/.test(name));
	assert.ok(attachments.length >= 3, `expected at least 3 attachments, found ${attachments.length}`);
	for (const name of attachments) {
		const text = await readFile(join(specsRoot, "attachments", name), "utf8");
		const result = parseSpecDocument(text, `specs/attachments/${name}`);
		assert.equal(result.ok, true, `attachment ${name} failed: ${result.error?.code} ${result.error?.message}`);
	}
});

test("parseSpecDocument rejects the real specs/00 because of the documented code_consumption contract violation", async () => {
	const text = await readFile(join(specsRoot, "00-理念与构成.md"), "utf8");
	const result = parseSpecDocument(text, "specs/00-理念与构成.md");
	// The contract says code_consumption members must match the
	// responsibility-identifier regex `[a-z][a-z0-9]*(?:-[a-z0-9]+)*`;
	// specs/00 uses snake_case values like spec_identity_block, which the
	// implementation correctly rejects as `identity/field_invalid`.
	assert.equal(result.ok, false, "specs/00 should be rejected per the responsibility-identifier contract");
	assert.equal(result.error.code, "identity/field_invalid");
});
