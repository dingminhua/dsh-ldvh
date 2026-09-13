// Tests for plugin/lib/commit-validation.js: the single shared validation
// core used by the Git Gate runner and the precheck-git-commit tool
// (specs/09 §6 single-implementation discipline).
//
// Authority: specs/06 §6.1 (message contract), §6.2 (precheck-git-commit
// public operation). Transition header format is per dev-memo decision #15.
import assert from "node:assert/strict";
import test from "node:test";
import {
	HEADER_PATTERN,
	SIGNATURES,
	SOURCE_FINGERPRINT,
	checkKeyChangesAgainstDiff,
	snapshotIdentity,
	validateMessage,
	GATE_RULES,
	newFinding,
	isExemptPath,
	EXEMPT_BASENAMES,
} from "../lib/commit-validation.js";

/** A canonical, fully-legal commit message. */
const validMessage = [
	"chore(code): add ldvh gate",
	"",
	"关键变更:",
	"- wire commit-msg gate into git",
	"",
	"LDVH-Provider: deepseek-harness",
	"LDVH-Model: test",
].join("\n");

// ---------------------------------------------------------------------------
// validateMessage — happy path
// ---------------------------------------------------------------------------

test("validateMessage returns no issues for a fully legal message", () => {
	assert.deepEqual(validateMessage(validMessage), []);
});

test("validateMessage accepts every conventional-commit type", () => {
	for (const type of ["feat", "fix", "docs", "refactor", "test", "chore", "build", "ci", "perf", "style"]) {
		const msg = [
			`${type}: short summary`,
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
		"chore(scope): add gate",
		"",
		"关键变更:",
		"- wire gate",
		"",
		"LDVH-Provider: deepseek-harness",
		"LDVH-Model: test",
	].join("\n");
	assert.deepEqual(validateMessage(msg), []);
});

// ---------------------------------------------------------------------------
// validateMessage — header failures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// validateMessage — 关键变更: section failures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// validateMessage — trailer failures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// validateMessage — CRLF and redaction
// ---------------------------------------------------------------------------

test("validateMessage normalizes CRLF to LF before checking", () => {
	const crlf = validMessage.replace(/\n/g, "\r\n");
	assert.deepEqual(validateMessage(crlf), []);
});

// ---------------------------------------------------------------------------
// snapshotIdentity — determinism
// ---------------------------------------------------------------------------

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
	// (diff, message) and (diff\0message, "") must produce different
	// digests, otherwise the separator is ambiguous.
	const left = snapshotIdentity("diff", "message");
	const right = snapshotIdentity("diff\0message", "");
	assert.notEqual(left, right);
});

// ---------------------------------------------------------------------------
// checkKeyChangesAgainstDiff — happy path
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// checkKeyChangesAgainstDiff — failure modes
// ---------------------------------------------------------------------------

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

test("checkKeyChangesAgainstDiff accepts a diff with no diff lines (no path-level claim)", () => {
	// Empty diff: there is nothing to match against. Every key-change item
	// would be unmatched — the implementation surfaces that as ok:false
	// (it is the gate's job to demand staged work). The precheck handler
	// further appends `git/index_empty` upstream.
	const msg = ["chore: x", "", "关键变更:", "- describe anything", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, "");
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.rule.startsWith("validation/key_change_unmatched")));
});

test("checkKeyChangesAgainstDiff handles a second 关键变更: section by zeroing items (re-collected by validateMessage upstream)", () => {
	// Implementation note: when a second 关键变更: appears, checkKeyChanges
	// zeros the collected list and falls through; validateMessage will
	// already have flagged the duplicate section upstream, so this branch
	// is a "torn message" defensive case.
	const diff = "diff --git a/foo b/foo\n";
	const msg = ["chore: x", "", "关键变更:", "- y", "", "关键变更:", "- z", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	// After zeroing, the items list is empty => the missing-items branch fires.
	assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

test("HEADER_PATTERN is exported as a RegExp", () => {
	assert.ok(HEADER_PATTERN instanceof RegExp);
});

test("SIGNATURES is the canonical two-element list", () => {
	assert.deepEqual(SIGNATURES, ["LDVH-Provider", "LDVH-Model"]);
});

test("SOURCE_FINGERPRINT is a 64-hex string and stable", () => {
	assert.match(SOURCE_FINGERPRINT, /^[0-9a-f]{64}$/);
});


// ---------------------------------------------------------------------------
// K1 rule registry + structured findings
// ---------------------------------------------------------------------------

test("GATE_RULES registers every rule the validator emits, each with severity and description", () => {
	const expected = [
		"validation/header_invalid",
		"validation/key_changes_required",
		"validation/signature_trailer_missing",
		"validation/key_change_unmatched",
		"validation/staged_path_uncovered",
		"validation/signature_provider_mismatch",
		"validation/signature_model_mismatch",
		"git/index_empty",
		"facts/norm_direction_collision",
		"facts/norm_carrier_unparseable",
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

// ---------------------------------------------------------------------------
// Bidirectional coverage (06 §6.1 不得遗漏 half; K1, Human 2026-09-10)
// ---------------------------------------------------------------------------

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
	// The uncovered path plugin/lib/research-session.js shares no segment
	// with the item; the covered path matches via the full explicit path
	// text inside the item (not via a bare directory word).
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

test("isExemptPath matches the registered basenames only", () => {
	assert.equal(isExemptPath("plugin/package-lock.json"), true);
	assert.equal(isExemptPath("package-lock.json"), true);
	assert.equal(isExemptPath("src/package-lock.json"), true);
	assert.equal(isExemptPath("plugin/package.json"), false);
	assert.equal(isExemptPath("plugin/web/pnpm-lock.yaml"), true);
	assert.deepEqual([...EXEMPT_BASENAMES], ["package-lock.json", "pnpm-lock.yaml"]);
});
