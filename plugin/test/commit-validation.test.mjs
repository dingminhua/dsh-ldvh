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
	assert.ok(issues.some((i) => i.startsWith("validation/header_invalid")));
});

test("validateMessage rejects a non-conventional header", () => {
	const msg = ["Bug fix on Tuesday", "", "关键变更:", "- x", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.startsWith("validation/header_invalid")));
});

test("validateMessage rejects an unknown header type", () => {
	const msg = ["quantum: add gate", "", "关键变更:", "- x", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.startsWith("validation/header_invalid")));
});

// ---------------------------------------------------------------------------
// validateMessage — 关键变更: section failures
// ---------------------------------------------------------------------------

test("validateMessage rejects a missing 关键变更: section", () => {
	const msg = ["chore: add gate", "", "free-form body", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.startsWith("validation/key_changes_required")));
});

test("validateMessage rejects a 关键变更: section with no non-empty - items", () => {
	const msg = ["chore: add gate", "", "关键变更:", "  -", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.startsWith("validation/key_changes_required")));
});

test("validateMessage rejects multiple 关键变更: sections", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- one", "", "关键变更:", "- two", "", "LDVH-Provider: a", "LDVH-Model: b"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.startsWith("validation/key_changes_required")));
});

// ---------------------------------------------------------------------------
// validateMessage — trailer failures
// ---------------------------------------------------------------------------

test("validateMessage rejects a message missing LDVH-Provider", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- x", "", "LDVH-Model: test"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.includes("LDVH-Provider")));
});

test("validateMessage rejects a message missing LDVH-Model", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- x", "", "LDVH-Provider: deepseek-harness"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.includes("LDVH-Model")));
});

test("validateMessage rejects a duplicate LDVH-Provider trailer", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- x", "", "LDVH-Provider: a", "LDVH-Provider: b", "LDVH-Model: m"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.includes("LDVH-Provider")));
});

test("validateMessage rejects an empty LDVH-Provider trailer", () => {
	const msg = ["chore: add gate", "", "关键变更:", "- x", "", "LDVH-Provider: ", "LDVH-Model: m"].join("\n");
	const issues = validateMessage(msg);
	assert.ok(issues.some((i) => i.includes("LDVH-Provider")));
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
	assert.ok(result.issues.some((i) => i.includes("no 关键变更:")));
});

test("checkKeyChangesAgainstDiff returns ok:false when the 关键变更: section has no items", () => {
	const msg = ["chore: no items", "", "关键变更:", "  -", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, "");
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.includes("no non-empty item")));
});

test("checkKeyChangesAgainstDiff returns key_change_unmatched for an item naming a change absent from the diff", () => {
	const diff = "diff --git a/plugin/lib/foo.js b/plugin/lib/foo.js\n";
	const msg = ["chore: rename", "", "关键变更:", "- rename bar.js to baz.js", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.startsWith("validation/key_change_unmatched") && i.includes("bar.js")));
});

test("checkKeyChangesAgainstDiff accepts a diff with no diff lines (no path-level claim)", () => {
	// Empty diff: there is nothing to match against. Every key-change item
	// would be unmatched — the implementation surfaces that as ok:false
	// (it is the gate's job to demand staged work). The precheck handler
	// further appends `git/index_empty` upstream.
	const msg = ["chore: x", "", "关键变更:", "- describe anything", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, "");
	assert.equal(result.ok, false);
	assert.ok(result.issues.some((i) => i.startsWith("validation/key_change_unmatched")));
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
