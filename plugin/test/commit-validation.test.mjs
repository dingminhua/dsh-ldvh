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
	isNormCarrierPath,
	checkDocsReferences,
	extractDocsReferences,
	isTemporaryDocsPath,
	isSpecOrFactCarrierPath,
	checkLoadBearingDeclarations,
	collectDeclarationReferenceTokens,
	extractLoadBearingUnits,
	isSpecCarrierPath,
	LOAD_BEARING_MARKER,
	LOAD_BEARING_RESOLUTION_LABEL,
	LOAD_BEARING_RULES, checkRemovalBasisDeclarations, collectRemovalBasisDeclarations, extractSectionText,
	checkFrictionCommitTargets, extractFrictionCommitTargets, isFrictionCarrierPath} from "../lib/commit-validation.js";

/** A canonical, fully-legal commit message. */
const validMessage = [
	"chore(code): 接入 ldvh 提交校验",
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
// validateMessage — header 描述语言（09 §5.1 中文契约的 header 半边）
// ---------------------------------------------------------------------------

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
	// 该形态已由 validation/header_invalid 拒绝；本规则不叠加第二个 finding。
	assert.equal(isHeaderDescriptionNonChinese("Bug fix on Tuesday"), false);
	assert.equal(isHeaderDescriptionNonChinese(""), false);
});

test("isHeaderDescriptionNonChinese flags a fresh Latin description", () => {
	assert.equal(isHeaderDescriptionNonChinese("feat(gate): add language check"), true);
	assert.equal(isHeaderDescriptionNonChinese("docs: update the readme"), true);
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

// friction-1a1f2d8f「块结构规则无权威源致预检反复打回」：这条规则是双向的，而预检
// 过去在第一个失配处就 return——使用者只看到单条局部要求，无从得知还有反向半边，
// 也无从得知匹配依据是「文件路径」，于是逐轮改写逐轮被打回。修法是把同一规则的
// 完整约束一次说清（判定逻辑不动，只改回显的形状）。
test("checkKeyChangesAgainstDiff 同时报出两个方向的失配，并在失配项里带上匹配口径（friction-1a1f2d8f）", () => {
	// 一个 item 无对应改动（方向一），一个改动无对应 item（方向二）。
	const diff = "diff --git a/plugin/lib/foo.js b/plugin/lib/foo.js\ndiff --git a/plugin/lib/zap.js b/plugin/lib/zap.js\n";
	const msg = ["chore: mixed", "", "关键变更:", "- add foo.js", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result = checkKeyChangesAgainstDiff(msg, diff);
	assert.equal(result.ok, false);
	// 方向二：zap.js 没被任何 item 覆盖。
	assert.ok(result.issues.some((i) => i.rule.startsWith("validation/staged_path_uncovered") && i.message.includes("zap.js")), "uncovered path must be reported");
	// 方向一：item 文本本身能命中 foo.js（stem 匹配），故此处不产生 unmatched；
	// 换一个真正无对应的 item 验证方向一与匹配口径说明。
	const msg2 = ["chore: mixed", "", "关键变更:", "- add foo.js", "- rewrite entirely-unrelated-thing", "", "LDVH-Provider: a", "LDVH-Model: m"].join("\n");
	const result2 = checkKeyChangesAgainstDiff(msg2, diff);
	assert.equal(result2.ok, false);
	const unmatchedIssue = result2.issues.find((i) => i.rule.startsWith("validation/key_change_unmatched"));
	assert.ok(unmatchedIssue, "unmatched item must be reported");
	// 匹配口径必须出现在诊断里——这是本条摩擦的核心：使用者过去只能靠反复失败反推。
	assert.ok(unmatchedIssue.message.includes("匹配依据是") && unmatchedIssue.message.includes("文件路径"), "diagnostic must state the matching basis");
	// 已改路径必须一并回显，使用者不必自己去翻 diff。
	assert.ok(unmatchedIssue.message.includes("plugin/lib/foo.js"), "changed paths must be echoed");
	// 两个方向同时存在时，须给一条整体说明（规则是双向的）。
	assert.ok(result2.issues.some((i) => i.message.includes("双向一一对应")), "when both directions fail, explain the bidirectional rule once");
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
// Norm direction_key uniqueness — 27 §11 second layer (Git Gate)
//
// This layer is the ONLY one that sees a hand-edited or shell-written carrier
// (layer 1 is bypassed when the writer is not used, layer 3 only fails closed
// at read time), so a silent skip here is a real uniqueness hole.
// ---------------------------------------------------------------------------

/** A minimal Norm carrier with the fields the gate's parser reads. */
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
	// The finding must name both carriers so the Human can act on it directly.
	assert.ok(collision.message.includes(NORM_A));
	assert.ok(collision.message.includes(NORM_B));
});

test("norm uniqueness: a CRLF carrier is parsed, not silently skipped (fail-open regression)", () => {
	// Regression: the fence regex accepts CRLF but the field loop split on "\n"
	// alone, so every line kept a trailing "\r". `\s*` swallowed it and `(.*)$`
	// then matched nothing, dropping the whole line — including `status`. Both
	// carriers were skipped and the duplicate direction_key committed
	// unchallenged. CRLF is ordinary on Windows checkouts, so this was a
	// realistic bypass of the layer 27 §11 declares fail-closed.
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
		"validation/header_not_chinese",
		"validation/key_changes_required",
		"validation/signature_trailer_missing",
		"validation/key_change_unmatched",
		"validation/staged_path_uncovered",
		"validation/signature_provider_mismatch",
		"validation/signature_model_mismatch",
		"git/index_empty",
		"facts/norm_direction_collision",
		"facts/norm_carrier_unparseable",
		"git/friction_commit_malformed",
		"git/friction_commit_unresolvable",
		"git/friction_commit_unverifiable",
		"validation/docs_reference_dangling",
		"validation/load_bearing_declaration_removed",
		"validation/load_bearing_resolution_missing",
		"validation/load_bearing_baseline_unreadable",
		"validation/removal_basis_empty",
		"validation/removal_basis_section_unreadable",
		"validation/removal_basis_unquotable",
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

// ---------------------------------------------------------------------------
// docs/ reference check — 09 §5.3 item 5 (Human 2026-10-12)
//
// docs/ holds temporary documents only; no carrier may newly cite a docs/ path
// that does not exist. Pre-existing references are cleaned up gradually and
// must NOT block a commit, so the check compares against the baseline text.
// ---------------------------------------------------------------------------

test("extractDocsReferences finds bare docs/ paths and trims trailing punctuation", () => {
	assert.deepEqual(extractDocsReferences("见 `docs/a.md`（注）"), ["docs/a.md"]);
	assert.deepEqual(extractDocsReferences("见 docs/archive/b.md，与 docs/c.md。"), ["docs/archive/b.md", "docs/c.md"]);
	assert.deepEqual(extractDocsReferences("（`docs/x/y/z.md`）"), ["docs/x/y/z.md"]);
});

test("extractDocsReferences does NOT match plugin/web/docs (a different directory)", () => {
	assert.deepEqual(extractDocsReferences("见 `plugin/web/docs/10-baseline.md` §5"), []);
	assert.deepEqual(extractDocsReferences("见 plugin/web/docs/10 §5"), []);
	// The top-level docs/ still matches when it is a real path segment.
	assert.deepEqual(extractDocsReferences("见 docs/real.md"), ["docs/real.md"]);
});

test("extractDocsReferences ignores the bare directory token without a path", () => {
	assert.deepEqual(extractDocsReferences("文档一律位于 docs/ 目录"), []);
});

// A docs/ filename may carry a CJK segment. An ASCII-only tail class stops the
// match at the first CJK run and existence-checks the truncated token — a
// false `docs_reference_dangling` on a reference that resolves. The prefix
// class stays ASCII-punctuated so `见docs/…` (no boundary) and CJK-before-docs
// rules are unaffected.
test("extractDocsReferences extracts a CJK filename segment to its full extent", () => {
	assert.deepEqual(
		extractDocsReferences("产出：`docs/workcase-996e207a-指称形态候选-2026-10-18.md` §1"),
		["docs/workcase-996e207a-指称形态候选-2026-10-18.md"],
	);
	// Two such paths in one sentence are both taken whole.
	assert.deepEqual(
		extractDocsReferences("见 docs/a-中文.md 与 docs/b-二.md。"),
		["docs/a-中文.md", "docs/b-二.md"],
	);
	// A CJK run in the middle, with an ASCII tail, is still one path.
	assert.deepEqual(extractDocsReferences("（`docs/候选/x.md`）"), ["docs/候选/x.md"]);
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
		[{ path: "specs/27-x.md", content: "只作设计输入（`docs/archive/gone.md`）。", baseline: "只作设计输入。" }],
		{ exists: () => false }
	);
	assert.equal(result.ok, false);
	assert.equal(result.issues[0].rule, "validation/docs_reference_dangling");
	assert.ok(result.issues[0].message.includes("docs/archive/gone.md"));
});

test("checkDocsReferences does NOT flag a PRE-EXISTING dangling reference (gradual cleanup)", () => {
	const text = "只作设计输入（`docs/archive/gone.md`），并新增一句无关说明。";
	const result = checkDocsReferences(
		[{ path: "specs/27-x.md", content: text, baseline: "只作设计输入（`docs/archive/gone.md`）。" }],
		{ exists: () => false }
	);
	assert.deepEqual(result.issues, []);
	assert.equal(result.ok, true);
});

test("checkDocsReferences does NOT flag a NEW reference whose target exists", () => {
	const result = checkDocsReferences(
		[{ path: "specs/27-x.md", content: "见 `docs/live.md`。", baseline: "" }],
		{ exists: (p) => p === "docs/live.md" }
	);
	assert.equal(result.ok, true);
});

test("checkDocsReferences treats an added carrier (no baseline) as all-new", () => {
	const result = checkDocsReferences(
		[{ path: "specs/99-new.md", content: "见 `docs/nope.md`。" }],
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
		[{ path: "specs/07-x.md", content: "呈现契约由 `plugin/web/docs/10-Web开发现状与设计语言基线.md` §5 承载。", baseline: "" }],
		{ exists: () => false }
	);
	assert.equal(result.ok, true);
});

test("isSpecOrFactCarrierPath limits the rule to spec/fact carriers", () => {
	assert.equal(isSpecOrFactCarrierPath("specs/00-x.md"), true);
	assert.equal(isSpecOrFactCarrierPath("specs/attachments/a.md"), true);
	assert.equal(isSpecOrFactCarrierPath("ldvh-base/frictions/f.md"), true);
	assert.equal(isSpecOrFactCarrierPath("README.md"), true);
	// Implementation carriers are out of scope: their mentions are comments and
	// fixtures, and including them would make the rule self-defeating (its own
	// tests must name docs/ paths).
	assert.equal(isSpecOrFactCarrierPath("plugin/lib/commit-validation.js"), false);
	assert.equal(isSpecOrFactCarrierPath("plugin/test/commit-validation.test.mjs"), false);
	assert.equal(isSpecOrFactCarrierPath("plugin/web/docs/10.md"), false);
	assert.equal(isSpecOrFactCarrierPath("scripts/x.sh"), false);
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

// ---------------------------------------------------------------------------
// Load-bearing declaration protection (01 §7 末段; 09 §5.3 item 6)
//
// The five classes the workcase's scope names, one test each, plus the
// boundary assertions the rule states about itself. Class 2 replays the
// incident this implements: the declaration kept its marker and its
// prohibition but lost its 恢复条件 sub-element, and the removal went
// undetected.
// ---------------------------------------------------------------------------

const declarationUnit = (subject, resolution) =>
	`| ${LOAD_BEARING_MARKER} ${subject} | 不得声称本文已完成对齐 | ${resolution ?? "**无**——须按判据逐处核对"} |`;

const specCarrier = (content, baseline) => [{ path: "specs/21-WorkCase 工单.md", content, baseline }];

const messageWith = (items) =>
	["docs(x): y", "", "关键变更:", ...items.map((item) => `- ${item}`), "", "LDVH-Provider: p", "LDVH-Model: m"].join("\n");

const SUBJECT = "本文正文对 §7.2 状态禁令的对齐";
const WITH_RESOLUTION = declarationUnit(SUBJECT, `${LOAD_BEARING_RESOLUTION_LABEL}完成后删除本行`);

test("class 1: a declaration present at HEAD but absent from the candidate is refused", () => {
	const result = checkLoadBearingDeclarations(specCarrier("| 本文正文对 §7.2 的对齐 | 已完成 |\n", WITH_RESOLUTION), {
		message: messageWith(["specs/21-WorkCase 工单.md: 调整表格行"]),
	});
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues.map((issue) => issue.rule), [LOAD_BEARING_RULES.removed]);
});

test("class 2: dropping the 恢复条件 sub-element is refused (the incident's own shape)", () => {
	const result = checkLoadBearingDeclarations(specCarrier(declarationUnit(SUBJECT, undefined), WITH_RESOLUTION), {
		message: messageWith(["specs/21-WorkCase 工单.md: 调整列表述"]),
	});
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues.map((issue) => issue.rule), [LOAD_BEARING_RULES.resolutionMissing]);
});

test("class 3: a resolvable independent-review reference lets the change through", () => {
	const reference = "0ac049b5-68e2-4873-a545-f5e647c249b9";
	const result = checkLoadBearingDeclarations(specCarrier(declarationUnit(SUBJECT, undefined), WITH_RESOLUTION), {
		message: messageWith([`specs/21-WorkCase 工单.md: 调整列表述，独立复核 ${reference}`]),
		resolvable: new Set([reference]),
	});
	assert.equal(result.ok, true);
	assert.equal(result.exemption, reference);
});

test("class 4: an unresolvable reference exempts nothing", () => {
	const result = checkLoadBearingDeclarations(specCarrier(declarationUnit(SUBJECT, undefined), WITH_RESOLUTION), {
		message: messageWith(["specs/21-WorkCase 工单.md: 调整列表述，独立复核 deadbeefdeadbeef"]),
		resolvable: new Set(),
	});
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues.map((issue) => issue.rule), [LOAD_BEARING_RULES.resolutionMissing]);
});

test("class 5: an undecidable baseline fails closed rather than passing", () => {
	const result = checkLoadBearingDeclarations([], {
		message: messageWith(["specs/21-WorkCase 工单.md: 调整表格行"]),
		unreadable: ["specs/21-WorkCase 工单.md"],
	});
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues.map((issue) => issue.rule), [LOAD_BEARING_RULES.baselineUnreadable]);
});

test("scope: only specs/ carriers are governed; implementation carriers are out of scope", () => {
	const carrier = [{ path: "plugin/lib/x.js", content: "// 【承重声明】 x\n", baseline: WITH_RESOLUTION }];
	const result = checkLoadBearingDeclarations(carrier, { message: messageWith(["plugin/lib/x.js: 新增脚本"]) });
	assert.equal(result.ok, true);
	assert.equal(isSpecCarrierPath("plugin/lib/x.js"), false);
	assert.equal(isSpecCarrierPath("specs/01-x.md"), true);
});

test("units: the anchor survives edits inside a declaration and marker-only lines carry no unit", () => {
	const units = extractLoadBearingUnits(`${WITH_RESOLUTION}\n| ${LOAD_BEARING_MARKER} |\n`);
	assert.equal(units.length, 1);
	assert.equal(units[0].anchor, SUBJECT);
	assert.equal(units[0].hasResolution, true);
});

test("references: only tokens inside 关键变更 items count, and both forms are collected", () => {
	const tokens = collectDeclarationReferenceTokens(
		["docs(x): y", "", "关键变更:", "- specs/01.md: 改，复核 0ac049b5-68e2-4873-a545-f5e647c249b9", "- specs/02.md: 见 abc1234", "", "正文外的 0badc0de 不算", "LDVH-Provider: p"].join("\n")
	);
	assert.deepEqual(tokens.sort(), ["0ac049b5-68e2-4873-a545-f5e647c249b9", "abc1234"].sort());
});

test("BOUNDARY: weakening a declaration while keeping marker and resolution is NOT caught here", () => {
	// The rule's own stated limit, asserted so a green suite cannot be read as
	// "load-bearing declarations are semantically protected": the mechanical
	// check proves only that a resolvable reference was carried.
	const weakened = `| ${LOAD_BEARING_MARKER} ${SUBJECT} | 尽量不对齐 | ${LOAD_BEARING_RESOLUTION_LABEL}也许某天 |`;
	const result = checkLoadBearingDeclarations(specCarrier(weakened, WITH_RESOLUTION), {
		message: messageWith(["specs/21-WorkCase 工单.md: 弱化表述"]),
	});
	assert.equal(result.ok, true);
});

test("registered: every load-bearing rule is in the K1 registry as blocking", () => {
	for (const rule of Object.values(LOAD_BEARING_RULES)) {
		assert.equal(GATE_RULES[rule].severity, "blocking");
	}
});

test("mention vs use: a marker inside a code span is a mention, not a declaration", () => {
	// The rule texts themselves write the marker inside backticks while
	// defining it. Counting those as declarations would make the rule's own
	// paragraph a protected unit and demand a review reference for every later
	// wording fix — so a code-span marker must not open a unit.
	const BT = String.fromCharCode(96);
	const ruleText = `承重声明**须**以固定标记 ${BT}${LOAD_BEARING_MARKER}${BT} 标识，并以固定标签的恢复条件子件 ${BT}${LOAD_BEARING_RESOLUTION_LABEL}…${BT} 承载其解除要件；`;
	assert.deepEqual(extractLoadBearingUnits(ruleText), []);
	// The same marker OUTSIDE a code span is a use: it opens the unit.
	assert.equal(extractLoadBearingUnits(`${LOAD_BEARING_MARKER} 本文正文对 §7.2 的对齐 | 不得声称… | ${LOAD_BEARING_RESOLUTION_LABEL}完成后删除本行 |`).length, 1);
	assert.equal(extractLoadBearingUnits(`| ${LOAD_BEARING_MARKER} 授权包 | 不得声称… | ${LOAD_BEARING_RESOLUTION_LABEL}来源回填 |`).length, 1);
});

test("one unit per line, and a mention stays a mention regardless of where it sits", () => {
	// Two mentions of the marker on one line describe ONE declaration (a table
	// row whose text also names the marker): the unit count must not double.
	const BT = String.fromCharCode(96);
	const twoOnOneLine = `| ${LOAD_BEARING_MARKER} 授权包 | 见 ${LOAD_BEARING_MARKER} 的约定 | ${LOAD_BEARING_RESOLUTION_LABEL}来源回填 |`;
	assert.equal(extractLoadBearingUnits(twoOnOneLine).length, 1);
	// A code-span marker yields no unit, wherever in the line it appears.
	assert.deepEqual(extractLoadBearingUnits(`见 ${BT}${LOAD_BEARING_MARKER} 的约定${BT}`), []);
	assert.deepEqual(extractLoadBearingUnits(`${BT}${LOAD_BEARING_MARKER}${BT} 标识`), []);
});

test("the resolution label must be CARRIED, not merely quoted in a code span", () => {
	// Review finding F3: the marker side already ignored code spans while the
	// label side used a plain substring test, so a declaration whose release
	// element was only quoted satisfied the shape check. Both sides now share
	// one use/mention helper.
	const BT = String.fromCharCode(96);
	const quoted = `| ${LOAD_BEARING_MARKER} 本文正文对 §7.2 的对齐 | 不得声称已完成 | 见 ${BT}${LOAD_BEARING_RESOLUTION_LABEL}…${BT} 的约定 |`;
	const carried = `| ${LOAD_BEARING_MARKER} 本文正文对 §7.2 的对齐 | 不得声称已完成 | ${LOAD_BEARING_RESOLUTION_LABEL}完成后删除本行 |`;
	assert.equal(extractLoadBearingUnits(quoted)[0].hasResolution, false);
	assert.equal(extractLoadBearingUnits(carried)[0].hasResolution, true);
	const result = checkLoadBearingDeclarations(specCarrier(quoted, carried), {
		message: messageWith(["specs/21-WorkCase 工单.md: 把要件改成引用形式"]),
	});
	assert.equal(result.ok, false);
	assert.deepEqual(result.issues.map((issue) => issue.rule), [LOAD_BEARING_RULES.resolutionMissing]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 09 §5.3 第 7 项：以「§7.2 违规」为由删除时，消息中的逐字引用须在 §7.2 文本中存在。
// ─────────────────────────────────────────────────────────────────────────────

test("collectRemovalBasisDeclarations: 只认声明标签之后的引用文本", () => {
	assert.deepEqual(collectRemovalBasisDeclarations("无声明"), []);
	assert.deepEqual(collectRemovalBasisDeclarations("- 关键变更项\n§7.2 依据：某个句子"), ["某个句子"]);
	assert.deepEqual(collectRemovalBasisDeclarations("§7.2 依据："), [""]);
	assert.deepEqual(
		collectRemovalBasisDeclarations("§7.2 依据：甲\n§7.2 依据：乙"),
		["甲", "乙"],
		"两处声明各自核对"
	);
});

test("extractSectionText: 取到 §7.2 一节，止于下一个同级或更高级标题", () => {
	const text = "### 7.2 甲\n甲的内容\n### 7.3 乙\n乙的内容";
	const sec = extractSectionText(text);
	assert.match(sec, /甲的内容/);
	assert.doesNotMatch(sec, /乙的内容/, "不得越界到下一节");
	assert.equal(extractSectionText("没有这一节"), null);
});

test("checkRemovalBasisDeclarations: 编造引用被拒、真实引用放行、两版并集、fail-closed", () => {
	const section = "禁止的状态有三类：1. 实现状态；2. 下位文档的存在状态；3. 过程与进度。";
	const rules = (message, sectionTexts) => checkRemovalBasisDeclarations({ message, sectionTexts }).issues.map((issue) => issue.rule);

	// 无声明即不检查（窄版设计：只在自愿申报时生效）
	assert.deepEqual(rules("无声明", [section]), []);
	// 空声明
	assert.deepEqual(rules("§7.2 依据：", [section]), ["validation/removal_basis_empty"]);
	// 引真句
	assert.deepEqual(rules("§7.2 依据：禁止的状态有三类：", [section]), []);
	// 编造判据（历史事故的形态：「布局自指计数」在 §7.2 中并不存在）
	assert.deepEqual(rules("§7.2 依据：布局自指计数", [section]), ["validation/removal_basis_unquotable"]);
	// 两版并集：仅 HEAD 版含该句也算成立（本次提交可能正要删掉它）
	assert.deepEqual(rules("§7.2 依据：禁止的状态有三类：", [null, section]), []);
	// 两版都取不到 → fail-closed
	assert.deepEqual(rules("§7.2 依据：实现状态", [null, null]), ["validation/removal_basis_section_unreadable"]);
	// 空白差异不影响逐字判定
	assert.deepEqual(rules("§7.2 依据：禁止的状态有三类：", [section.replace("：", "：  ")]), []);
});

test("标签落在代码跨度内属提及、不构成依据申报（本轮实测踩到的误报）", () => {
	// 首次落盘本项时，提交消息的 关键变更 里写了 `§7.2 依据：<引用>` 来**描述**该机制，
	// 新门禁据此要求逐字引用并拒绝了该提交——即「提及」被当成「使用」。与承重标记一侧
	// 同口径：代码跨度内的标签不构成申报。
	assert.deepEqual(
		collectRemovalBasisDeclarations("关键变更:\n- 声明 `§7.2 依据：<引用>` 的机制"),
		[]
	);
	assert.deepEqual(collectRemovalBasisDeclarations("§7.2 依据：某句原文"), ["某句原文"]);
	// 同一行里既有提及又有裸写：仍须申报（裸写那处要核对）
	const both = collectRemovalBasisDeclarations("§7.2 依据：甲 与 `§7.2 依据：乙`");
	assert.deepEqual(both, ["甲 与 `§7.2 依据：乙`"], "以第一个**裸写**标签为锚，其余留在引用文本内");
});

// ── 摩擦 informs 的 commit 目标：提交层兜底（26 §11）───────────────────────
//
// 这一层的存在理由是一次实测事故：friction-ed844630 由 `git add` + `commit`
// 直接落盘（git 记录为 new file、42 行纯新增、status 一上来就是 resolved），
// 完全绕过 friction-writer，于是两个从未存在过的 commit 标识进了账目，Web 端
// 渲染成死链接。writer 的 fail-closed 再严密，也管不到不经 writer 的写入。

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
    evidence_locator:
      commit: ${"c".repeat(40)}
  - relation_key: informs
    target:
      object_uid: 99999999-8888-7777-6666-555555555555
object_uid: 11111111-2222-3333-4444-555555555555
---
## 现象
x
`;
	assert.deepEqual(extractFrictionCommitTargets(content), ["b".repeat(40), "c".repeat(40)]);
	// 无 relations 的摩擦是常态，不得误报
	assert.deepEqual(extractFrictionCommitTargets("---\ntitle: t\nstatus: observing\n---\n## 现象\nx\n"), []);
	// object_uid 形态不参与 commit 校验
	assert.deepEqual(extractFrictionCommitTargets(FRICTION_OK.replace("commit:", "object_uid:")), []);
});

test("摩擦载体：commit 目标不可解析即拦下（事故形态复现）", async () => {
	// 场景一：标识不在仓库中——正是 friction-ed844630 的形态
	const missing = await checkFrictionCommitTargets(
		[{ path: "ldvh-base/frictions/friction-x.md", content: FRICTION_OK }],
		{ resolves: async () => false }
	);
	assert.equal(missing.ok, false);
	assert.deepEqual(missing.issues.map((i) => i.rule), ["git/friction_commit_unresolvable"]);

	// 场景二：标识可解析——放行
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
