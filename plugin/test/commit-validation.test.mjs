import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
	HEADER_PATTERN,
	isHeaderDescriptionNonChinese,
	HEADER_LANGUAGE_EXEMPTIONS,
	SIGNATURES,
	SOURCE_FINGERPRINT,
	checkKeyChangesAgainstDiff,
	snapshotIdentity,
	validateMessage,
	GATE_RULES,
	newFinding,
	isExemptPath,
	EXEMPT_BASENAMES,
	checkNormDirectionUniqueness,
	checkFactCarrierIdentity,
	factCarrierType,
	isNormCarrierPath,
	checkDocsReferences,
	extractDocsReferences,
	stripChangeLogFromFrontmatter,
	DOCS_REFERENCE_PATTERN,
	isTemporaryDocsPath,
	isSpecOrFactCarrierPath,
	isGovernedCommitPath,
	checkFrictionCommitTargets, extractFrictionCommitTargets, isFrictionCarrierPath
} from "../lib/commit-validation.js";

const validMessage = [
	"chore(code): 接入 ldvh 提交校验",
	"",
	"关键变更:",
	"- wire commit-msg gate into git",
	"",
	"LDVH-Provider: deepseek-harness",
	"LDVH-Model: test",
].join("\n");


test("validateMessage returns no issues for a fully legal message", () => {
	assert.deepEqual(validateMessage(validMessage), []);
});

test("validateMessage accepts every conventional-commit type", () => {
	for (const type of ["feat", "fix", "docs", "refactor", "test", "chore", "build", "ci", "perf", "style"]) {
		const msg = [
			`${type}: 简短描述`,
			"",
			"关键变更:",
			"- item",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		const issues = validateMessage(msg);
		assert.deepEqual(issues, [], `${type} header should validate`);
	}
});

test("validateMessage accepts the transition-period scoped header (e.g. chore(code): ...)", () => {
	const msg = [
		"chore(scope): 接入校验",
		"",
		"关键变更:",
		"- wire gate",
		"",
		"LDVH-Provider: deepseek-harness",
		"LDVH-Model: test",
	].join("\n");
	assert.deepEqual(validateMessage(msg), []);
});


test("validateMessage rejects a missing header", () => {
	const msg = ["关键变更:", "- x", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.rule.startsWith("validation/header_invalid")));
});

test("validateMessage rejects a non-conventional header", () => {
	const msg = ["Bug fix on Tuesday", "", "关键变更:", "- x", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.rule.startsWith("validation/header_invalid")));
});

test("validateMessage rejects an unknown header type", () => {
	const msg = ["quantum: add gate", "", "关键变更:", "- x", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.rule.startsWith("validation/header_invalid")));
});


test("validateMessage rejects a header whose description has no Chinese character", () => {
	const msg = ["fix(injection): stop re-injecting the governance block on adjacent turns", "", "关键变更:", "- x", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg.replace("fix(injection): stop re-injecting the governance block on adjacent turns", "fix(injection): stop the duplicate injection"));
	assert.ok(issues.some((i) => i.rule === "validation/header_not_chinese"));
});

test("validateMessage accepts a Chinese description that keeps a Latin technical identifier", () => {
	const msg = ["fix(guidance): 注入台账改用 state.injectedIds 取代本回合批次判据", "", "关键变更:", "- plugin/lib/guidance.js: 注入台账", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	assert.deepEqual(validateMessage(msg), []);
});

test("validateMessage accepts a description that is Chinese only", () => {
	const msg = ["chore: 增加提交校验", "", "关键变更:", "- 增加校验", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	assert.deepEqual(validateMessage(msg), []);
});

test("validateMessage exempts the two registered historical Latin headers", () => {
	for (const header of HEADER_LANGUAGE_EXEMPTIONS) {
		assert.equal(isHeaderDescriptionNonChinese(header), false, `expected exemption for: ${header}`);
	}
});

test("isHeaderDescriptionNonChinese does not judge a non-conventional header", () => {
	assert.equal(isHeaderDescriptionNonChinese("Bug fix on Tuesday"), false);
	assert.equal(isHeaderDescriptionNonChinese(""), false);
});

test("isHeaderDescriptionNonChinese flags a fresh Latin description", () => {
	assert.equal(isHeaderDescriptionNonChinese("feat(gate): add language check"), true);
	assert.equal(isHeaderDescriptionNonChinese("docs: update the readme"), true);
});


test("validateMessage rejects a missing 关键变更: section", () => {
	const msg = ["chore: add gate", "", "free-form body", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.rule.startsWith("validation/key_changes_required")));
});

test("validateMessage rejects a 关键变更: section with no non-empty - items", () => {
	const msg = ["chore: add gate", "", "关键变更:", "  -", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.rule.startsWith("validation/key_changes_required")));
});

test("validateMessage rejects multiple 关键变更: sections", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- one", "", "关键变更:", "- two", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.rule.startsWith("validation/key_changes_required")));
});


test("validateMessage rejects a message missing LDVH-Provider", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- x", "", "LDVH-Model: test"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.message.includes("LDVH-Provider")));
});

test("validateMessage rejects a message missing LDVH-Model", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- x", "", "LDVH-Provider: deepseek-harness"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.message.includes("LDVH-Model")));
});

test("validateMessage rejects a duplicate LDVH-Provider trailer", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- x", "", "LDVH-Provider: a", "LDVH-Provider: b", "LDVH-Model: m"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.message.includes("LDVH-Provider")));
});

test("validateMessage rejects an empty LDVH-Provider trailer", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- x", "", "LDVH-Provider: ", "LDVH-Model: m"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.message.includes("LDVH-Provider")));
});


test("validateMessage normalizes CRLF to LF before checking", () => {
	const crlf = validMessage.replace(/\n/g, "\r\n");
	assert.deepEqual(validateMessage(crlf), []);
});


test("snapshotIdentity is sha256 hex and stable over (diff, message)", () => {
	const a = snapshotIdentity("diff", "msg");
	const b = snapshotIdentity("diff", "msg");
	assert.match(a, /^[0-9a-f]{64}$/);
	assert.equal(a, b);
});

test("snapshotIdentity is sensitive to a one-byte diff change", () => {
	const a = snapshotIdentity("diff-A", "msg");
	const b = snapshotIdentity("diff-B", "msg");
	assert.notEqual(a, b);
});

test("snapshotIdentity is sensitive to a one-byte message change", () => {
	const a = snapshotIdentity("diff", "msg-A");
	const b = snapshotIdentity("diff", "msg-B");
	assert.notEqual(a, b);
});

test("snapshotIdentity is sensitive to the NUL separator boundary", () => {
	const left = snapshotIdentity("diff", "message");
	const right = snapshotIdentity("diff\0message", "");
	assert.notEqual(left, right);
});

test("snapshotIdentity ignores trailing-newline formatting, so both entrypoints agree", () => {
	const base = "fix(plugin): 示例\n\n关键变更:\n- plugin/lib/x.js：改动\n\nLDVH-Provider: workbuddy\nLDVH-Model: deepseek-v4.1-flash";
	assert.equal(snapshotIdentity("d", base), snapshotIdentity("d", `${base}\n`));
	assert.equal(snapshotIdentity("d", base), snapshotIdentity("d", `${base}\n\n\n`));
	assert.equal(snapshotIdentity("d", base), snapshotIdentity("d", base.replace(/\n/g, "\r\n")));
});

test("snapshotIdentity still separates messages that differ only INSIDE the body", () => {
	const a = "subject\n\n关键变更:\n- A";
	const b = "subject\n\n关键变更:\n- B";
	assert.notEqual(snapshotIdentity("d", a), snapshotIdentity("d", b));
	assert.notEqual(snapshotIdentity("d", a), snapshotIdentity("d", "subject\n\n关键变更:\n- A "));
});


test("checkKeyChangesAgainstDiff returns ok when every item matches a changed path", () => {
	const diff = [
		"diff --git a/plugin/lib/foo.js b/plugin/lib/foo.js",
		"index 0000001..0000002 100644",
		"--- a/plugin/lib/foo.js",
		"+++ b/plugin/lib/foo.js",
		"@@ -0,0 +1 @@",
		"+// new",
	].join("\n");
	const msg = [
		"chore: add foo",
		"",
		"关键变更:",
		"- create plugin/lib/foo.js with the new function",
		"",
		"LDVH-Provider: deepseek-harness",
		"LDVH-Model: test",
	].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, true);
	assert.ok(result.changedPaths.includes("plugin/lib/foo.js"));
});

test("checkKeyChangesAgainstDiff accepts a single item that names a parent directory segment", () => {
	const diff = "diff --git a/src/auth/login.ts b/src/auth/login.ts\nindex 0000001..0000002 100644\n";
	const msg = ["chore: login", "", "关键变更:", "- add the auth login flow", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, true);
});


test("checkKeyChangesAgainstDiff returns ok:false when the 关键变更: section is missing", () => {
	const msg = ["chore: no items", "", "free body", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, "");
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.message.includes("no 关键变更:")));
});

test("checkKeyChangesAgainstDiff returns ok:false when the 关键变更: section has no items", () => {
	const msg = ["chore: no items", "", "关键变更:", "  -", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, "");
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.message.includes("no non-empty item")));
});

test("checkKeyChangesAgainstDiff returns key_change_unmatched for an item naming a change absent from the diff", () => {
	const diff = "diff --git a/plugin/lib/foo.js b/plugin/lib/foo.js\n";
	const msg = ["chore: rename", "", "关键变更:", "- rename bar.js to baz.js", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.rule.startsWith("validation/key_change_unmatched") && i.message.includes("bar.js")));
});

test("checkKeyChangesAgainstDiff 同时报出两个方向的失配，并在失配项里带上匹配口径（friction-1a1f2d8f）", () => {
	const diff = "diff --git a/plugin/lib/foo.js b/plugin/lib/foo.js\ndiff --git a/plugin/lib/zap.js b/plugin/lib/zap.js\n";
	const msg = ["chore: mixed", "", "关键变更:", "- add foo.js", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.rule.startsWith("validation/staged_path_uncovered") && i.message.includes("zap.js")), "uncovered path must be reported");
	const msg2 = ["chore: mixed", "", "关键变更:", "- add foo.js", "- rewrite entirely-unrelated-thing", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result2 = checkKeyChangesAgainstDiff(msg2, diff);
	assert.equal(result2.ok, false);
	const unmatchedIssue = result2.issues.find((i) => i.rule.startsWith("validation/key_change_unmatched"));
	assert.ok(unmatchedIssue, "unmatched item must be reported");
	assert.ok(unmatchedIssue.message.includes("匹配依据是") && unmatchedIssue.message.includes("文件路径"), "diagnostic must state the matching basis");
	assert.ok(unmatchedIssue.message.includes("plugin/lib/foo.js"), "changed paths must be echoed");
	assert.ok(result2.issues.some((i) => i.message.includes("双向一一对应")), "when both directions fail, explain the bidirectional rule once");
});

test("checkKeyChangesAgainstDiff accepts a diff with no diff lines (no path-level claim)", () => {
	const msg = ["chore: x", "", "关键变更:", "- describe anything", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, "");
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.rule.startsWith("validation/key_change_unmatched")));
});

test("checkKeyChangesAgainstDiff handles a second 关键变更: section by zeroing items (re-collected by validateMessage upstream)", () => {
	const diff = "diff --git a/foo b/foo\n";
	const msg = ["chore: x", "", "关键变更:", "- y", "", "关键变更:", "- z", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, false);
});


function normCarrier(frontmatter) {
	return `---\ntitle: T\n${frontmatter}\n---\n\n# T\n`;
}

const NORM_A = "ldvh-base/norms/norm-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md";
const NORM_B = "ldvh-base/norms/norm-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.md";

test("norm uniqueness: two ACTIVE carriers on one direction_key are blocked (27 §11)", () => {
	const result = checkNormDirectionUniqueness([
		{ path: NORM_A, content: normCarrier("status: active\ndirection_key: code-style") },
		{ path: NORM_B, content: normCarrier("status: active\ndirection_key: code-style") },
	]);
	assert.equal(result.ok, false);
	const collision = result.issues.find((issue) => issue.rule === "facts/norm_direction_collision");
	assert.ok(collision, "a shared active direction_key must raise norm_direction_collision");
	assert.ok(collision.message.includes(NORM_A));
	assert.ok(collision.message.includes(NORM_B));
});

test("norm uniqueness: a CRLF carrier is parsed, not silently skipped (fail-open regression)", () => {
	const crlf = (frontmatter) => normCarrier(frontmatter).replace(/\n/g, "\r\n");
	const result = checkNormDirectionUniqueness([
		{ path: NORM_A, content: crlf("status: active\ndirection_key: code-style") },
		{ path: NORM_B, content: crlf("status: active\ndirection_key: code-style") },
	]);
	assert.equal(result.ok, false, "a CRLF duplicate must still be blocked");
	assert.ok(result.issues.some((issue) => issue.rule === "facts/norm_direction_collision"));
});

test("norm uniqueness: retired carriers do not occupy a direction (27 §11 counts active only)", () => {
	const result = checkNormDirectionUniqueness([
		{ path: NORM_A, content: normCarrier("status: active\ndirection_key: code-style") },
		{ path: NORM_B, content: normCarrier("status: retired\ndirection_key: code-style") },
	]);
	assert.equal(result.ok, true, "reusing a direction after retirement is legal");
});

test("norm uniqueness: distinct direction_keys coexist", () => {
	const result = checkNormDirectionUniqueness([
		{ path: NORM_A, content: normCarrier("status: active\ndirection_key: code-style") },
		{ path: NORM_B, content: normCarrier("status: active\ndirection_key: error-handling") },
	]);
	assert.equal(result.ok, true);
});

test("norm uniqueness: an unparseable carrier fails closed, never counts as clean", () => {
	const result = checkNormDirectionUniqueness([{ path: NORM_A, content: "no frontmatter at all" }]);
	assert.equal(result.ok, false, "an unreadable carrier cannot be proven conflict-free");
	assert.ok(result.issues.some((issue) => issue.rule === "facts/norm_carrier_unparseable"));
});

test("norm uniqueness: an empty carrier set is trivially clean", () => {
	assert.equal(checkNormDirectionUniqueness([]).ok, true);
});

test("isNormCarrierPath recognises only norms/ carriers", () => {
	assert.equal(isNormCarrierPath(NORM_A), true);
	assert.equal(isNormCarrierPath("ldvh-base/norms/readme.md"), false);
	assert.equal(isNormCarrierPath("ldvh-base/sparks/spark-x.md"), false);
});


test("HEADER_PATTERN is exported as a RegExp", () => {
	assert.ok(HEADER_PATTERN instanceof RegExp);
});

test("SIGNATURES is the canonical two-element list", () => {
	assert.deepEqual(SIGNATURES, ["LDVH-Provider", "LDVH-Model"]);
});

test("SOURCE_FINGERPRINT is a 64-hex string and stable", () => {
	assert.match(SOURCE_FINGERPRINT, /^[0-9a-f]{64}$/);
});



test("GATE_RULES registers every rule the validator emits, each with severity and description", () => {
	const expected = [
		"validation/header_invalid",
		"validation/header_not_chinese",
		"validation/key_changes_required",
		"validation/signature_trailer_missing",
		"validation/key_change_unmatched",
		"validation/staged_path_uncovered",
		"validation/signature_provider_mismatch",
		"validation/signature_model_mismatch",
		"validation/signature_source_unverifiable",
		"git/index_empty",
		"facts/norm_direction_collision",
		"facts/norm_carrier_unparseable",
		"git/friction_commit_malformed",
		"git/friction_commit_unresolvable",
		"git/friction_commit_unverifiable",
		"validation/docs_reference_dangling",
		"validation/lint_failed",
		"facts/carrier_uid_filename_mismatch",
		"facts/carrier_uid_duplicate",
		"facts/carrier_uid_unverifiable",
	];
	assert.deepEqual(Object.keys(GATE_RULES).sort(), expected.sort());
	for (const entry of Object.values(GATE_RULES)) {
		assert.equal(typeof entry.severity, "string");
		assert.equal(typeof entry.description, "string");
		assert.ok(entry.description.length > 0);
	}
});

test("newFinding builds a structured finding for a registered rule and throws for an unknown one", () => {
	const finding = newFinding("validation/header_invalid", "first line must be a conventional commit header", 1);
	assert.equal(finding.rule, "validation/header_invalid");
	assert.equal(finding.severity, "blocking");
	assert.equal(finding.line, 1);
	assert.equal(finding.message, "first line must be a conventional commit header");
	assert.throws(() => newFinding("validation/not_a_rule", "x"), /unregistered gate rule/);
});

test("validateMessage returns structured findings with rule/severity/message fields", () => {
	const issues = validateMessage("not a header\n\n关键变更:\n- x\n\nLDVH-Provider: a\n");
	assert.ok(issues.length > 0);
	for (const issue of issues) {
		assert.ok(typeof issue === "object" && issue !== null);
		assert.ok(GATE_RULES[issue.rule] !== undefined, `unregistered rule emitted: ${issue.rule}`);
		assert.equal(issue.severity, GATE_RULES[issue.rule].severity);
		assert.ok(typeof issue.message === "string");
	}
});


test("checkKeyChangesAgainstDiff rejects a staged path covered by no item (bidirectional)", () => {
	const diff = [
		"diff --git a/specs/08-x.md b/specs/08-x.md",
		"diff --git a/plugin/lib/research-session.js b/plugin/lib/research-session.js",
		"",
	].join("\n");
	const msg = [
		"chore: only specs",
		"",
		"关键变更:",
		"- specs/08 回填",
		"",
		"LDVH-Provider: a",
		"LDVH-Model: m",
	].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, false);
	const uncovered = result.issues.find((i) => i.rule === "validation/staged_path_uncovered");
	assert.ok(uncovered !== undefined);
	assert.ok(uncovered.message.includes("research-session.js"));
});

test("checkKeyChangesAgainstDiff passes when items cover every staged path (grouping via directory word)", () => {
	const diff = [
		"diff --git a/plugin/lib/spark-tools.js b/plugin/lib/spark-tools.js",
		"diff --git a/plugin/lib/spark-writer.js b/plugin/lib/spark-writer.js",
		"",
	].join("\n");
	const msg = [
		"feat(spark): 机械层",
		"",
		"关键变更:",
		"- plugin/lib Spark 机械层（spark-tools 接线与 spark-writer 写入）",
		"",
		"LDVH-Provider: a",
		"LDVH-Model: m",
	].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, true);
	assert.deepEqual(result.changedPaths.sort(), ["plugin/lib/spark-tools.js", "plugin/lib/spark-writer.js"].sort());
});

test("checkKeyChangesAgainstDiff exempts registered mechanical artifacts from the reverse half", () => {
	const diff = [
		"diff --git a/plugin/package.json b/plugin/package.json",
		"diff --git a/plugin/package-lock.json b/plugin/package-lock.json",
		"",
	].join("\n");
	const msg = [
		"chore(deps): bump",
		"",
		"关键变更:",
		"- package.json 新增依赖",
		"",
		"LDVH-Provider: a",
		"LDVH-Model: m",
	].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, true);
});

test("checkKeyChangesAgainstDiff reverse half distinguishes precise-path coverage from area-word coverage", () => {
	const diff = [
		"diff --git a/specs/08-x.md b/specs/08-x.md",
		"diff --git a/plugin/lib/research-session.js b/plugin/lib/research-session.js",
		"",
	].join("\n");
	const msg = [
		"chore: only specs",
		"",
		"关键变更:",
		"- specs/08-x.md 回填",
		"",
		"LDVH-Provider: a",
		"LDVH-Model: m",
	].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.rule === "validation/staged_path_uncovered" && i.message.includes("research-session.js")));
});

test("checkKeyChangesAgainstDiff rejects a bare directory word in the reverse half (spark-c48af9e6)", () => {
	const diff = ["diff --git a/plugin/web/src/App.tsx b/plugin/web/src/App.tsx", ""].join("\n");
	const msgFor = (item) =>
		["chore: x", "", "关键变更:", `- ${item}`, "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");

	for (const item of ["plugin 目录改动", "web 改动"]) {
		const result = checkKeyChangesAgainstDiff(msgFor(item), diff);
		assert.equal(result.ok, false, `single segment "${item}" must not cover a subtree`);
		assert.ok(result.issues.some((i) => i.rule === "validation/staged_path_uncovered"));
	}
	for (const item of ["plugin/web 改动", "plugin/web/src/App.tsx 改动"]) {
		const result = checkKeyChangesAgainstDiff(msgFor(item), diff);
		assert.equal(result.ok, true, `two-level prefix "${item}" must still cover`);
	}
});

test("checkKeyChangesAgainstDiff keeps the numeric-prefix carrier convention working", () => {
	const diff = ["diff --git a/specs/08-x.md b/specs/08-x.md", ""].join("\n");
	const msg = ["chore: x", "", "关键变更:", "- specs/08 回填", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, true);
});

test("numeric-prefix matching is bounded: no digit-suffix or root-level bleed", () => {
	const msgFor = (item) => ["chore: x", "", "关键变更:", `- ${item}`, "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const diff08 = ["diff --git a/specs/08-x.md b/specs/08-x.md", ""].join("\n");
	assert.equal(checkKeyChangesAgainstDiff(msgFor("specs/080 条"), diff08).ok, false);
	const diffRoot = ["diff --git a/08-x.md b/08-x.md", ""].join("\n");
	assert.equal(checkKeyChangesAgainstDiff(msgFor("会议 08:30 开始"), diffRoot).ok, false);
	const diffNested = ["diff --git a/b/12-y.md a/b/12-y.md", ""].join("\n");
	assert.equal(checkKeyChangesAgainstDiff(msgFor("b/12 改了"), diffNested).ok, false);
});

test("directory-prefix matching is boundary-bounded (no glued siblings)", () => {
	const msgFor = (item) => ["chore: x", "", "关键变更:", `- ${item}`, "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const diff = ["diff --git a/plugin/lib/x.js b/plugin/lib/x.js", ""].join("\n");
	assert.equal(checkKeyChangesAgainstDiff(msgFor("plugin/library 说明"), diff).ok, false);
	assert.equal(checkKeyChangesAgainstDiff(msgFor("plugin/lib-old 说明"), diff).ok, false);
});

test("dotfiles and short filenames still match by basename alone", () => {
	const msgFor = (item) => ["chore: x", "", "关键变更:", `- ${item}`, "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const diffDot = ["diff --git a/.gitignore b/.gitignore", ""].join("\n");
	assert.equal(checkKeyChangesAgainstDiff(msgFor("补 .gitignore 条目"), diffDot).ok, true);
	const diffCi = ["diff --git a/ci.yml b/ci.yml", ""].join("\n");
	assert.equal(checkKeyChangesAgainstDiff(msgFor("调整 ci.yml 配置"), diffCi).ok, true);
	const diffNested = ["diff --git a/config/ci.yml b/config/ci.yml", ""].join("\n");
	assert.equal(checkKeyChangesAgainstDiff(msgFor("调整 ci.yml 配置"), diffNested).ok, true);
});

test("isExemptPath matches the registered basenames only", () => {
	assert.equal(isExemptPath("plugin/package-lock.json"), true);
	assert.equal(isExemptPath("package-lock.json"), true);
	assert.equal(isExemptPath("src/package-lock.json"), true);
	assert.equal(isExemptPath("plugin/package.json"), false);
	assert.equal(isExemptPath("plugin/web/pnpm-lock.yaml"), true);
	assert.deepEqual([...EXEMPT_BASENAMES], ["package-lock.json", "pnpm-lock.yaml"]);
});


test("extractDocsReferences finds bare docs/ paths and trims trailing punctuation", () => {
	assert.deepEqual(extractDocsReferences("见 `docs/a.md`（注）"), ["docs/a.md"]);
	assert.deepEqual(extractDocsReferences("见 docs/archive/b.md，与 docs/c.md。"), ["docs/archive/b.md", "docs/c.md"]);
	assert.deepEqual(extractDocsReferences("（`docs/x/y/z.md`）"), ["docs/x/y/z.md"]);
});

test("extractDocsReferences does NOT match plugin/web/docs (a different directory)", () => {
	assert.deepEqual(extractDocsReferences("见 `plugin/web/docs/10-baseline.md` §5"), []);
	assert.deepEqual(extractDocsReferences("见 plugin/web/docs/10 §5"), []);
	assert.deepEqual(extractDocsReferences("见 docs/real.md"), ["docs/real.md"]);
});

test("extractDocsReferences ignores the bare directory token without a path", () => {
	assert.deepEqual(extractDocsReferences("文档一律位于 docs/ 目录"), []);
});

test("extractDocsReferences extracts a CJK filename segment to its full extent", () => {
	assert.deepEqual(
		extractDocsReferences("产出：`docs/指称形态候选-2026-10-18.md` §1"),
		["docs/指称形态候选-2026-10-18.md"],
	);
	assert.deepEqual(
		extractDocsReferences("见 docs/a-中文.md 与 docs/b-二.md。"),
		["docs/a-中文.md", "docs/b-二.md"],
	);
	assert.deepEqual(extractDocsReferences("（`docs/候选/x.md`）"), ["docs/候选/x.md"]);
});

// --- 09 §5.3 第 5 项边界：流水条目里的路径提及不构成「引用」（Human 2026-11-22 决定） ---

test("stripChangeLogFromFrontmatter removes the change_log block and keeps the rest", () => {
	const carrier = [
		"---",
		"title: 测试载体",
		"change_log:",
		"  - at: 2026-11-22",
		"    summary: 提到 docs/gone.md 这个路径",
		"object_uid: 11111111-2222-3333-4444-555555555555",
		"---",
		"",
		"正文里也有 docs/gone.md。",
	].join("\n");
	const stripped = stripChangeLogFromFrontmatter(carrier);
	assert.ok(!stripped.includes("summary: 提到 docs/gone.md"), "change_log 块被移除");
	assert.ok(stripped.includes("title: 测试载体"), "其它 frontmatter 字段保留");
	assert.ok(stripped.includes("object_uid: 11111111"), "change_log 之后的顶层字段保留");
	assert.ok(stripped.includes("正文里也有 docs/gone.md。"), "正文不受影响");
});

test("stripChangeLogFromFrontmatter leaves carriers without change_log untouched", () => {
	const carrier = "---\ntitle: 无流水\n---\n\n正文 docs/a.md\n";
	assert.equal(stripChangeLogFromFrontmatter(carrier), carrier);
});

test("checkDocsReferences ignores a dangling docs path that only appears in change_log", () => {
	const carrier = [
		"---",
		"title: 测试载体",
		"change_log:",
		"  - at: 2026-11-22",
		"    summary: 修正悬空 docs/gone.md 引用",
		"---",
		"",
		"正文没有指向临时文档。",
	].join("\n");
	const res = checkDocsReferences(
		[{ path: "ldvh-base/sparks/spark-test.md", content: carrier, baseline: undefined }],
		{ exists: () => false },
	);
	assert.equal(res.ok, true, `不该判未通过：${JSON.stringify(res.issues)}`);
});

test("checkDocsReferences still blocks a dangling docs path in the body", () => {
	const carrier = [
		"---",
		"title: 测试载体",
		"change_log:",
		"  - at: 2026-11-22",
		"    summary: 一次无关的流水",
		"---",
		"",
		"正文引用了 docs/gone.md。",
	].join("\n");
	const res = checkDocsReferences(
		[{ path: "ldvh-base/sparks/spark-test.md", content: carrier, baseline: undefined }],
		{ exists: () => false },
	);
	assert.equal(res.ok, false, "正文里的悬空引用仍须被拦");
	assert.equal(res.issues.length, 1);
	assert.equal(res.issues[0].rule, "validation/docs_reference_dangling");
});

test("DOCS_REFERENCE_PATTERN source keeps the u flag when rebuilt with new RegExp", () => {
	const rebuilt = new RegExp(DOCS_REFERENCE_PATTERN.source, "gu");
	const found = [];
	for (const match of "见 docs/real.md 与 `docs/x.md`。".matchAll(rebuilt)) found.push(match[1]);
	assert.deepEqual(found, ["docs/real.md", "docs/x.md"]);
	const withoutU = new RegExp(DOCS_REFERENCE_PATTERN.source, "g");
	const degraded = [..."见 docs/real.md".matchAll(withoutU)].map((match) => match[1]);
	assert.deepEqual(degraded, ["docs/r"], "without u the class degrades to a literal char set — the extractor sees docs/r, never docs/real.md");
});

test("isTemporaryDocsPath distinguishes top-level docs/ from plugin/web/docs/", () => {
	assert.equal(isTemporaryDocsPath("docs/a.md"), true);
	assert.equal(isTemporaryDocsPath("docs/archive/b.md"), true);
	assert.equal(isTemporaryDocsPath("docs"), true);
	assert.equal(isTemporaryDocsPath("plugin/web/docs/10.md"), false);
	assert.equal(isTemporaryDocsPath("specs/00.md"), false);
	assert.equal(isTemporaryDocsPath("docsy/x.md"), false);
});

test("checkDocsReferences flags a NEWLY INTRODUCED dangling docs/ reference", () => {
	const result = checkDocsReferences(
		[{ path: "plugin-specs/27-x.md", content: "只作设计输入（`docs/archive/gone.md`）。", baseline: "只作设计输入。" }],
		{ exists: () => false }
	);
	assert.equal(result.ok, false);
	assert.equal(result.issues[0].rule, "validation/docs_reference_dangling");
	assert.ok(result.issues[0].message.includes("docs/archive/gone.md"));
});

test("checkDocsReferences does NOT flag a PRE-EXISTING dangling reference (gradual cleanup)", () => {
	const text = "只作设计输入（`docs/archive/gone.md`），并新增一句无关说明。";
	const result = checkDocsReferences(
		[{ path: "plugin-specs/27-x.md", content: text, baseline: "只作设计输入（`docs/archive/gone.md`）。" }],
		{ exists: () => false }
	);
	assert.deepEqual(result.issues, []);
	assert.equal(result.ok, true);
});

test("checkDocsReferences does NOT flag a PRE-EXISTING reference on a RENAMED carrier (baseline by lineage)", () => {
	const text = "`docs/persistence-schema.json` 的 ±1,600 行不代表格式升级。";
	const result = checkDocsReferences(
		[{ path: "ldvh-base/reports/report-x.md", content: text, baseline: text }],
		{ exists: () => false }
	);
	assert.deepEqual(result.issues, []);
	assert.equal(result.ok, true);
});

test("checkDocsReferences still flags a genuinely NEW reference added during a rename", () => {
	const result = checkDocsReferences(
		[{
			path: "ldvh-base/reports/report-x.md",
			content: "存量 `docs/old.md`，新增 `docs/brand-new.md`。",
			baseline: "存量 `docs/old.md`。",
		}],
		{ exists: () => false }
	);
	assert.equal(result.ok, false);
	assert.equal(result.issues.length, 1, "only the new reference may be flagged");
	assert.ok(result.issues[0].message.includes("docs/brand-new.md"));
	assert.ok(!result.issues[0].message.includes("docs/old.md"));
});

test("checkDocsReferences FAILS CLOSED when a renamed carrier's baseline is unreadable", () => {
	const text = "`docs/whatever.md` 的描述。";
	const result = checkDocsReferences(
		[{ path: "ldvh-base/reports/report-x.md", content: text, baseline: null }],
		{ exists: () => false }
	);
	assert.equal(result.ok, false);
	assert.equal(result.issues.length, 1);
	assert.ok(result.issues[0].message.includes("baseline could not be read"));
});

test("checkDocsReferences does NOT flag a NEW reference whose target exists", () => {
	const result = checkDocsReferences(
		[{ path: "plugin-specs/27-x.md", content: "见 `docs/live.md`。", baseline: "" }],
		{ exists: (p) => p === "docs/live.md" }
	);
	assert.equal(result.ok, true);
});

test("checkDocsReferences treats an added carrier (no baseline) as all-new", () => {
	const result = checkDocsReferences(
		[{ path: "plugin-specs/99-new.md", content: "见 `docs/nope.md`。" }],
		{ exists: () => false }
	);
	assert.equal(result.ok, false);
	assert.equal(result.issues[0].rule, "validation/docs_reference_dangling");
});

test("checkDocsReferences exempts carriers inside docs/ itself", () => {
	const result = checkDocsReferences(
		[{ path: "docs/a.md", content: "见 `docs/b.md`。", baseline: "" }],
		{ exists: () => false }
	);
	assert.equal(result.ok, true);
});

test("checkDocsReferences does not flag plugin/web/docs references", () => {
	const result = checkDocsReferences(
		[{ path: "plugin-specs/07-x.md", content: "呈现契约由 `plugin/web/docs/10-Web开发现状与设计语言基线.md` §5 承载。", baseline: "" }],
		{ exists: () => false }
	);
	assert.equal(result.ok, true);
});

test("checkDocsReferences exempts a token quoted as the rule's own truncation report", () => {
	const content = "报出的 token 是被截断的 ASCII 前缀（如 `docs/指称形态候选-2026-10-18.md` 被截成 `docs/`）。";
	const result = checkDocsReferences(
		[{ path: "ldvh-base/pitfalls/pitfall-430bef13-3984-4b67-92e8-2dc5ab4c07cf.md", content }],
		{ exists: (p) => p === "docs/指称形态候选-2026-10-18.md" }
	);
	assert.equal(result.ok, true);
});

test("checkDocsReferences still blocks the real path when only the quoted prefix appears", () => {
	const result = checkDocsReferences(
		[{ path: "plugin-specs/99-new.md", content: "见 `docs/missing-指称候选.md`（其截断形为 `docs/missing-`）。" }],
		{ exists: () => false }
	);
	assert.equal(result.ok, false);
	assert.equal(result.issues[0].rule, "validation/docs_reference_dangling");
});

test("checkDocsReferences does not waive a dangling prefix for a fabricated longer token", () => {
	const content = "见 `docs/totally-nonexistent-abcd-efgh-ijkl-mnop.md` 与其截断形 `docs/totally-nonexistent-`。";
	const result = checkDocsReferences(
		[{ path: "plugin-specs/99-new.md", content }],
		{ exists: () => false }
	);
	assert.equal(result.ok, false, "a fabricated longer token must not launder the dangling prefix");
	const flagged = result.issues.map((issue) => issue.message).join("\n");
	assert.ok(flagged.includes("docs/totally-nonexistent-"), "the truncated token itself must be reported");
	assert.ok(flagged.includes("docs/totally-nonexistent-abcd-efgh-ijkl-mnop.md"), "the fabricated token must be reported too");
});

test("checkDocsReferences waives the prefix only when the longer token really exists", () => {
	const content = "见 `docs/totally-nonexistent-abcd-efgh-ijkl-mnop.md` 与其截断形 `docs/totally-nonexistent-`。";
	const result = checkDocsReferences(
		[{ path: "plugin-specs/99-new.md", content }],
		{ exists: (p) => p === "docs/totally-nonexistent-abcd-efgh-ijkl-mnop.md" }
	);
	assert.equal(result.ok, true);
});

test("isSpecOrFactCarrierPath limits the rule to spec carriers, fact carriers and both protected READMEs", () => {
	assert.equal(isSpecOrFactCarrierPath("plugin-specs/controlled-commit.yaml"), true);
	assert.equal(isSpecOrFactCarrierPath("ldvh-base/frictions/f.md"), true);
	assert.equal(isSpecOrFactCarrierPath("README.md"), true);
	assert.equal(isSpecOrFactCarrierPath("plugin/README.md"), true);
	assert.equal(isSpecOrFactCarrierPath("plugin/README.en.md"), false);
	assert.equal(isSpecOrFactCarrierPath("plugin/lib/commit-validation.js"), false);
	assert.equal(isSpecOrFactCarrierPath("plugin/test/commit-validation.test.mjs"), false);
	assert.equal(isSpecOrFactCarrierPath("plugin/web/docs/10.md"), false);
	assert.equal(isSpecOrFactCarrierPath("scripts/x.sh"), false);
});

test("第 5 项范围已去掉 specs/：specs/ 引用 docs/ 不再被拦，plugin-specs/ 仍被拦", () => {
	assert.equal(isSpecOrFactCarrierPath("specs/00-x.md"), false);
	assert.equal(isSpecOrFactCarrierPath("specs/attachments/a.md"), false);
	const spec = checkDocsReferences(
		[{ path: "specs/27-x.md", content: "见 `docs/gone.md`。", baseline: "" }],
		{ exists: () => false }
	);
	assert.equal(spec.ok, true, `specs/ 已在第 5 项范围之外：${JSON.stringify(spec.issues)}`);
	assert.deepEqual(spec.issues, []);
	const carrier = checkDocsReferences(
		[{ path: "plugin-specs/controlled-commit.yaml", content: "见 `docs/gone.md`。", baseline: "" }],
		{ exists: () => false }
	);
	assert.equal(carrier.ok, false, "plugin-specs/ 仍在第 5 项范围之内");
	assert.equal(carrier.issues[0].rule, "validation/docs_reference_dangling");
});

test("Git Gate 的分派面不变：specs/ 提交仍走受控提交契约", () => {
	assert.equal(isGovernedCommitPath("specs/00-x.md"), true);
	assert.equal(isGovernedCommitPath("plugin-specs/controlled-commit.yaml"), true);
	assert.equal(isGovernedCommitPath("ldvh-base/sparks/spark-x.md"), true);
	assert.equal(isGovernedCommitPath("plugin/lib/commit-validation.js"), false);
	assert.equal(isGovernedCommitPath("plugin/test/commit-validation.test.mjs"), false);
});

test("checkDocsReferences flags a dangling docs/ reference newly added to plugin/README.md", () => {
	const result = checkDocsReferences(
		[{ path: "plugin/README.md", content: "见 docs/governed-project-lifecycle-verification.md", baseline: "" }],
		{ exists: () => false }
	);
	assert.equal(result.ok, false);
	assert.equal(result.issues[0].rule, "validation/docs_reference_dangling");
});

test("checkDocsReferences ignores docs/ references in implementation carriers", () => {
	const result = checkDocsReferences(
		[{ path: "plugin/test/x.test.mjs", content: 'extract("见 docs/nope.md")', baseline: "" }],
		{ exists: () => false }
	);
	assert.equal(result.ok, true);
});

test("docs_reference_dangling is registered in the K1 rule registry", () => {
	assert.equal(GATE_RULES["validation/docs_reference_dangling"].severity, "blocking");
});


const FRICTION_OK = `---
title: 示例摩擦
status: resolved
relations:
  - relation_key: informs
    target:
      commit: ${"a".repeat(40)}
object_uid: 11111111-2222-3333-4444-555555555555
---
## 现象
单句现象。
`;

test("摩擦载体：提取 commit 形态目标（含 evidence_locator）", () => {
	const content = `---
title: t
status: resolved
relations:
  - relation_key: informs
    target:
      commit: ${"b".repeat(40)}
  - relation_key: informs
    target:
      object_uid: 99999999-8888-7777-6666-555555555555
    evidence_locator:
      commit: ${"c".repeat(40)}
object_uid: 11111111-2222-3333-4444-555555555555
---
## 现象
x
`;
	assert.deepEqual(extractFrictionCommitTargets(content), ["b".repeat(40), "c".repeat(40)]);
	assert.deepEqual(extractFrictionCommitTargets("---\ntitle: t\nstatus: observing\n---\n## 现象\nx\n"), []);
	assert.deepEqual(extractFrictionCommitTargets(FRICTION_OK.replace("commit:", "object_uid:")), []);
});

test("摩擦载体：commit 目标不可解析即拦下（事故形态复现）", async () => {
	const missing = await checkFrictionCommitTargets(
		[{ path: "ldvh-base/frictions/friction-x.md", content: FRICTION_OK }],
		{ resolves: async () => false }
	);
	assert.equal(missing.ok, false);
	assert.deepEqual(missing.issues.map((i) => i.rule), ["git/friction_commit_unresolvable"]);

	const present = await checkFrictionCommitTargets(
		[{ path: "ldvh-base/frictions/friction-x.md", content: FRICTION_OK }],
		{ resolves: async (hash) => hash === "a".repeat(40) }
	);
	assert.equal(present.ok, true);
	assert.equal(present.checked, 1);
});

test("摩擦载体：格式不合法的 commit 单独报错，不混同为不可解析", async () => {
	const bad = FRICTION_OK.replace("a".repeat(40), "1f1b276");
	const outcome = await checkFrictionCommitTargets(
		[{ path: "ldvh-base/frictions/friction-x.md", content: bad }],
		{ resolves: async () => true }
	);
	assert.equal(outcome.ok, false);
	assert.deepEqual(outcome.issues.map((i) => i.rule), ["git/friction_commit_malformed"]);
});

test("摩擦载体：无 resolver 时 fail-closed（不能因「只是提交时查一下」而放松）", async () => {
	const outcome = await checkFrictionCommitTargets(
		[{ path: "ldvh-base/frictions/friction-x.md", content: FRICTION_OK }],
		{}
	);
	assert.equal(outcome.ok, false);
	assert.deepEqual(outcome.issues.map((i) => i.rule), ["git/friction_commit_unverifiable"]);
});

test("摩擦载体路径判定只认 frictions/ 下的 friction-*.md", () => {
	assert.equal(isFrictionCarrierPath("ldvh-base/frictions/friction-abc.md"), true);
	assert.equal(isFrictionCarrierPath("ldvh-base/frictions/notes.md"), false);
	assert.equal(isFrictionCarrierPath("ldvh-base/pitfalls/pitfall-abc.md"), false);
});


const UID_A = "11111111-1111-4111-8111-111111111111";
const UID_B = "22222222-2222-4222-8222-222222222222";

const carrierText = (uid) => `---\nobject_uid: ${uid}\ntitle: t\nstatus: open\n---\n\nbody\n`;

test("carrier identity: a clean staged carrier produces no finding", () => {
	const result = checkFactCarrierIdentity([
		{ path: `ldvh-base/sparks/spark-${UID_A}.md`, content: carrierText(UID_A) },
	]);
	assert.equal(result.ok, true, JSON.stringify(result.issues));
	assert.deepEqual(result.issues, []);
});

test("carrier identity: filename/declaration mismatch is refused (真实错误写法)", () => {
	const result = checkFactCarrierIdentity([
		{ path: `ldvh-base/norms/norm-${UID_A}.md`, content: carrierText(UID_B) },
	]);
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues.map((i) => i.rule), ["facts/carrier_uid_filename_mismatch"]);
	assert.ok(result.issues[0].message.includes(UID_A), result.issues[0].message);
	assert.ok(result.issues[0].message.includes(UID_B), result.issues[0].message);
});

test("carrier identity: two carriers declaring one uid are refused (02 §5 item 6)", () => {
	const result = checkFactCarrierIdentity([
		{ path: `ldvh-base/pitfalls/pitfall-${UID_A}.md`, content: carrierText(UID_A) },
		{ path: `ldvh-base/pitfalls/pitfall-${UID_B}.md`, content: carrierText(UID_A) },
	]);
	const rules = result.issues.map((i) => i.rule);
	assert.ok(rules.includes("facts/carrier_uid_duplicate"), JSON.stringify(rules));
	const duplicate = result.issues.find((i) => i.rule === "facts/carrier_uid_duplicate");
	assert.ok(duplicate.message.includes(UID_A), duplicate.message);
	assert.ok(duplicate.message.includes(UID_B), duplicate.message);
});

test("carrier identity: an unreadable carrier fails closed rather than passing unverified", () => {
	const result = checkFactCarrierIdentity([
		{ path: `ldvh-base/reports/research-${UID_A}.md`, content: "" },
	]);
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues.map((i) => i.rule), ["facts/carrier_uid_unverifiable"]);
});

test("carrier identity: a frontmatter without the declaration fails closed", () => {
	const result = checkFactCarrierIdentity([
		{ path: `ldvh-base/sparks/spark-${UID_A}.md`, content: "---\ntitle: t\n---\n\nbody\n" },
	]);
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues.map((i) => i.rule), ["facts/carrier_uid_unverifiable"]);
});

test("carrier identity: a carrier whose filename encodes no identity is NOT refused", () => {
	const result = checkFactCarrierIdentity([
		{ path: "ldvh-base/norms/unnamed-carrier.md", content: carrierText(UID_A) },
	]);
	assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("carrier identity: non-carrier paths under ldvh-base are out of scope", () => {
	for (const path of [
		"ldvh-base/README.md",
		"ldvh-base/sparks/notes.txt",
		"specs/20-Spark-火花.md",
		"plugin/lib/spark-writer.js",
	]) {
		assert.equal(factCarrierType(path), null, path);
	}
	assert.deepEqual(factCarrierType(`ldvh-base/sparks/spark-${UID_A}.md`), {
		directory: "ldvh-base/sparks",
		prefix: "spark",
		base: `spark-${UID_A}.md`,
	});
});

test("carrier identity: identity comparison is case-insensitive (uppercase declaration)", () => {
	const result = checkFactCarrierIdentity([
		{ path: `ldvh-base/sparks/spark-${UID_A}.md`, content: carrierText(UID_A.toUpperCase()) },
	]);
	assert.equal(result.ok, true, JSON.stringify(result.issues));
});





const SPEC00 = readFileSync(new URL("../../specs/00-理念与构成.md", import.meta.url), "utf8");




