// Shared commit-candidate validation core.
//
// Authority: specs/06 §6.1 (message contract) and §6.2 (precheck-git-commit
// public operation). specs/09 §6 requires the Git commit-msg gate and the
// Helper precheck to call THE SAME validation entry — this module is that
// single entry. The Git Gate runner (git-gate-runner.js) and the
// precheck-git-commit tool both consume it; no second implementation is
// permitted.
//
// v4 absorption record (P0 implementation plan §2; that plan was removed with
// the temporary documentation tree in ec19ba6): the body-structure
// and trailer checks are extracted-and-adapted from v4
// code/ldvh/commits/validation.py `_body_structure_issues` /
// `_footer_trailers` (~120 lines of its 1049); v4's platform-affected,
// fact-layer, human-gate-trailer checks are deliberately NOT migrated (v5
// removed them — dev-memo decision #29).

import { createHash } from "node:crypto";

/**
 * Ambient Git override variables must never leak into an LDVH Git invocation
 * (a surrounding shell's GIT_DIR / GIT_INDEX_FILE would silently redirect the
 * diff being validated). Shared by the Gate runner and the precheck handler
 * so both invoke Git with the same environment (specs/09 §6 single
 * implementation discipline).
 */
export function cleanGitEnvironment(extra = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  // Strip ambient Git overrides FIRST, then let the caller's explicit values
  // win: a preflight deliberately passes its own GIT_INDEX_FILE and must not
  // have it stripped, while an inherited shell GIT_DIR must never leak in.
  for (const key of Object.keys(env)) {
    if (["GIT_COMMON_DIR", "GIT_CONFIG_COUNT", "GIT_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_WORK_TREE"].includes(key) || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key];
  }
  // `core.quotepath=false` is REQUIRED for every LDVH Git read, not a cosmetic
  // preference. With the default (`true`) Git C-quotes a non-ASCII pathname —
  // the diff header becomes `diff --git "a/specs/13-\346\211\277..." ...`.
  // Two checks parse pathnames out of that output:
  //   - extractDiffPaths' `/^diff --git a\/(.+) b\/(.+)$/` matches no quoted
  //     line, so `changedPaths` came back EMPTY and every 关键变更 item was
  //     reported unmatched (false blocking verdict);
  //   - `git show :<path>` on a quoted spelling dies with "path does not exist",
  //     so a readable §7.2 / declaration carrier read as unreadable.
  // Observed on Windows against this repository's own Chinese spec filenames.
  // Set here — the one shared Git invocation boundary (09 §6) — so the Git Gate
  // and the Helper precheck can never diverge on it.
  const quotepath = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.quotepath", GIT_CONFIG_VALUE_0: "false" };
  return { ...env, ...quotepath, ...extra };
}

export const HEADER_PATTERN = /^(feat|fix|docs|refactor|test|chore|build|ci|perf|style)(?:\([a-z0-9-]+\))?: .+/;
/** The description half of a header: everything after `type(scope): `.
 *  The header-language check judges this half only — the conventional prefix
 *  is Latin by definition and must not count as "having a description". */
export const HEADER_DESCRIPTION_PATTERN = /^(?:feat|fix|docs|refactor|test|chore|build|ci|perf|style)(?:\([a-z0-9-]+\))?: (.+)$/;
/** 中文（CJK 统一表意文字）判定，供 header 描述的语言检查使用。 */
export const CJK_CHARACTER_PATTERN = /[\u4e00-\u9fff]/;
/** 实现层登记的历史豁免（与 EXEMPT_BASENAMES 同体例）：本规则生效之前
 *  已经落入历史的两笔非中文 header。豁免按完整 header 文本逐字匹配，
 *  不改变规范层语义边界，也不放行任何新提交。 */
export const HEADER_LANGUAGE_EXEMPTIONS = Object.freeze([
	"fix(injection): stop re-injecting the governance block on adjacent turns",
	"fix(client): ctx.get→ctx.inject for betterSidebar tab registration",
]);
export const SIGNATURES = ["LDVH-Provider", "LDVH-Model"];
export const SOURCE_FINGERPRINT = createHash("sha256").update("dsh-ldvh-git-gate-v1", "utf8").digest("hex");

// ---------------------------------------------------------------------------
// K1 rule registry — the single authority for every mechanical finding the
// validator can emit (anchor doc §8.1 K1: stable rule IDs so findings are
// referenceable {rule, severity, line}). Emitting an unregistered rule throws
// (fail-loud registry discipline); adding a rule means adding it here first.
// ---------------------------------------------------------------------------

export const GATE_RULES = Object.freeze({
  "validation/header_invalid": Object.freeze({ severity: "blocking", description: "first line must be a conventional commit header" }),
  "validation/header_not_chinese": Object.freeze({ severity: "blocking", description: "header description must use Chinese: 09 §5.1 states the message contract in Chinese and requires the 关键变更: literal verbatim, so the description half carries the same language requirement (implementation gap 2026-10-19; two pre-existing Latin headers are registered as exemptions in HEADER_LANGUAGE_EXEMPTIONS)" }),
  "validation/key_changes_required": Object.freeze({ severity: "blocking", description: "body must contain exactly one 关键变更: section with non-empty items" }),
  "validation/signature_trailer_missing": Object.freeze({ severity: "blocking", description: "footer requires exactly one LDVH-Provider: and one LDVH-Model: line" }),
  "validation/key_change_unmatched": Object.freeze({ severity: "blocking", description: "a 关键变更 item names no staged change (06 §6.1: no items absent from the diff)" }),
  "validation/staged_path_uncovered": Object.freeze({ severity: "blocking", description: "a staged diff path is covered by no 关键变更 item (06 §6.1: no diff change may be omitted; K1 bidirectional, Human 2026-09-10)" }),
  "validation/signature_provider_mismatch": Object.freeze({ severity: "blocking", description: "trailer LDVH-Provider does not match the authoritative session record" }),
  "validation/signature_model_mismatch": Object.freeze({ severity: "blocking", description: "trailer LDVH-Model does not match the authoritative session record" }),
  "git/index_empty": Object.freeze({ severity: "blocking", description: "candidate Index is empty" }),
  "facts/norm_direction_collision": Object.freeze({ severity: "blocking", description: "two or more ACTIVE Norm objects in ldvh-base/norms/ share one direction_key (27 §11 uniqueness second layer: the Git Gate traverses the index and refuses the commit)" }),
  "facts/norm_carrier_unparseable": Object.freeze({ severity: "blocking", description: "a staged ldvh-base/norms/norm-*.md carrier cannot be parsed for the direction_key uniqueness assertion — an unreadable carrier cannot be proven conflict-free, so the gate fails closed rather than passing it" }),
  "validation/docs_reference_dangling": Object.freeze({ severity: "blocking", description: "a newly added or modified non-docs carrier references a docs/ path that does not exist in the candidate tree (09 §5.3 item 5, Human 2026-10-12: docs/ holds temporary documents only and must not be relied on as an authority)" }),
  "validation/load_bearing_declaration_removed": Object.freeze({ severity: "blocking", description: "a load-bearing declaration present at HEAD is absent from the candidate and no 关键变更 item carries a resolvable independent-review reference (01 §7 末段; 09 §5.3 item 6, Human 2026-10-15)" }),
  "validation/load_bearing_resolution_missing": Object.freeze({ severity: "blocking", description: "a load-bearing declaration kept its marker but lost its 恢复条件 sub-element, and no 关键变更 item carries a resolvable independent-review reference (01 §7 末段; 09 §5.3 item 6)" }),
  "validation/load_bearing_baseline_unreadable": Object.freeze({ severity: "blocking", description: "a carrier's HEAD baseline could not be read, so the load-bearing declaration comparison cannot decide — fails closed rather than passing (09 §5.3 item 6)" }),
  "validation/removal_basis_unquotable": Object.freeze({ severity: "blocking", description: "a 关键变更 item declares a §7.2 removal basis whose quoted sentence does not appear verbatim in the current §7.2 text" }),
  "validation/removal_basis_empty": Object.freeze({ severity: "blocking", description: "a §7.2 依据： declaration carries no quoted sentence" }),
  "validation/removal_basis_section_unreadable": Object.freeze({ severity: "blocking", description: "the candidate tree's §7.2 text could not be read, so a declared removal basis cannot be verified (fails closed)" }),
  "git/friction_commit_unresolvable": Object.freeze({ severity: "blocking", description: "a staged friction carrier's informs target names a commit that does not resolve in this repository (26 §11: 目标必须存在且可解析; commit 例外形态同口径) — re-asserted at the commit seam because the writer is bypassable by a direct file write" }),
  "git/friction_commit_malformed": Object.freeze({ severity: "blocking", description: "a staged friction carrier's informs target is not a 40-hex commit hash (02 §8.1 commit 形态)" }),
  "git/friction_commit_unverifiable": Object.freeze({ severity: "blocking", description: "friction commit targets could not be verified because no commit resolver was supplied — fails closed rather than passing an unverified carrier (26 §11)" }),
});

/** Mechanical-artifact exemption for the bidirectional coverage check
 *  (06 §6.2 item 3 reverse half): basenames listed here are generated
 *  artifacts that a 关键变更 item is not expected to name. First batch:
 *  package-lock.json (Human 2026-09-10). Extending this list is an
 *  implementation-registry change; the exemption CATEGORY is spec-level. */
export const EXEMPT_BASENAMES = Object.freeze(["package-lock.json", "pnpm-lock.yaml"]);

export function isExemptPath(path) {
  const base = path.split("/").pop() ?? path;
  return EXEMPT_BASENAMES.includes(base);
}

/** True when a header's description carries no CJK character and the header is
 *  not a registered historical exemption. A non-conventional header is not
 *  judged here — `validation/header_invalid` already rejects it, and stacking a
 *  second finding on the same defect would blur which rule fired. */
export function isHeaderDescriptionNonChinese(header) {
	const match = HEADER_DESCRIPTION_PATTERN.exec(header ?? "");
	if (match === null) return false;
	if (HEADER_LANGUAGE_EXEMPTIONS.includes(header)) return false;
	return !CJK_CHARACTER_PATTERN.test(match[1]);
}

/** Build one structured finding; `rule` must be registered. */
export function newFinding(rule, message, line = null) {
  const entry = GATE_RULES[rule];
  if (entry === undefined) throw new Error(`unregistered gate rule: ${rule}`);
  return { rule, severity: entry.severity, message, line };
}

/**
 * Validate a commit message against the v5 contract (06 §6.1, transition
 * header format per decision #15): conventional header, exactly one
 * `关键变更:` section with at least one non-empty `- ` item, and exactly one
 * non-empty trailer line for each signature. Returns structured findings
 * {rule, severity, message, line} (empty = valid).
 */
export function validateMessage(message) {
  const issues = [];
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  if (!HEADER_PATTERN.test(lines[0] ?? "")) issues.push(newFinding("validation/header_invalid", "first line must be a conventional commit header", 1));
  // 09 §5.1 的 message 契约以中文表述，并要求 `关键变更:` 这一中文字面量
  // 逐字存在；header 描述承载同一语言要求。此前只有 `关键变更:` 受机械
  // 校验，header 与正文散文不受，故一条全拉丁 header 可以完整通过两个入口
  // （实例：2c476bd8，其 `关键变更:` 六项为中文、header 为英文）。
  if (isHeaderDescriptionNonChinese(lines[0])) issues.push(newFinding("validation/header_not_chinese", "header description must contain at least one Chinese (CJK) character", 1));
  const keyIndexes = lines.flatMap((line, index) => (line === "关键变更:" ? [index] : []));
  if (keyIndexes.length !== 1 || !lines.slice(keyIndexes[0] + 1).some((line) => line.startsWith("- ") && line.slice(2).trim().length > 0)) {
    issues.push(newFinding("validation/key_changes_required", "body must contain one 关键变更: section with a non-empty - item", keyIndexes.length === 1 ? keyIndexes[0] + 1 : null));
  }
  for (const name of SIGNATURES) {
    const matches = lines.filter((line) => line.startsWith(`${name}:`) && line.slice(name.length + 1).trim().length > 0);
    if (matches.length !== 1) issues.push(newFinding("validation/signature_trailer_missing", `footer requires exactly one ${name}:`, null));
  }
  return issues;
}

/** Deterministic snapshot identity over (staged diff, message) — 06 §6.2. */
export function snapshotIdentity(diff, message) {
  return createHash("sha256").update(diff, "utf8").update("\0").update(message, "utf8").digest("hex");
}

/**
 * Check the `关键变更:` items against the staged diff, BOTH directions
 * (06 §6.1: "每个 - 列表项必须与本次提交的 diff 逐条对应——不得列出 diff
 * 中不存在的变更项，也不得遗漏 diff 中实际存在的变更项").
 *
 * Forward: every non-empty item must match a changed path (the v5-built
 * half — items naming absent changes are rejected).
 * Reverse (K1 bidirectional, Human 2026-09-10): every non-exempt changed
 * path must be covered by at least one item. This is the tripwire that turns
 * silent staged-content pollution (e.g. a parallel session's `git add`
 * landing in a shared Index) into a loud rejection. The correspondence is
 * the same deliberately loose mechanical slice as the forward direction
 * (itemMatchesPath below); known limitation: a same-directory pollution
 * where some item happens to contain a shared directory word (e.g.
 * "plugin") is not caught — the mechanically decidable slice accepts
 * diffstat-style area naming.
 */
export function checkKeyChangesAgainstDiff(message, diff) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const keyIndex = lines.findIndex((line) => line === "关键变更:");
  if (keyIndex === -1) return { ok: false, issues: [newFinding("validation/key_changes_required", "no 关键变更: section", null)] };
  const items = [];
  for (const [offset, line] of lines.slice(keyIndex + 1).entries()) {
    if (line === "关键变更:") { items.length = 0; break; } // second section: caught by validateMessage
    if (line.startsWith("- ")) {
      const text = line.slice(2).trim();
      if (text.length > 0) items.push({ text, line: keyIndex + 1 + offset });
    }
  }
  if (items.length === 0) return { ok: false, issues: [newFinding("validation/key_changes_required", "关键变更: has no non-empty item", keyIndex + 1)] };
  const changedPaths = extractDiffPaths(diff);
  // friction-1a1f2d8f「块结构规则无权威源致预检反复打回」：这条规则是**双向**的，
  // 而预检过去在第一个失配处就 return，只回显一条局部要求——使用者无从得知还有
  // 反向半边，也无从得知匹配依据是「文件路径」，于是逐轮改写逐轮被打回。
  //
  // 修法不是放宽规则，而是**把同一条规则的完整约束一次说清**：两个方向一起算、
  // 一起报，并在诊断文本里带上可操作的匹配口径。判定逻辑本身一个字没动。
  const unmatched = [];
  for (const item of items) {
    if (!changedPaths.some((path) => itemMatchesPath(item.text, path))) unmatched.push(item);
  }
  // Reverse half: every non-exempt staged path must be covered by some item.
  const uncovered = changedPaths.filter((path) => !isExemptPath(path) && !items.some((item) => itemMatchesPath(item.text, path)));
  if (unmatched.length > 0 || uncovered.length > 0) {
    const issues = [];
    // 方向一：正文提到的东西必须真的被改了。
    for (const item of unmatched) {
      // 给出该项**实际能命中什么**的线索：已改路径里与该文本最接近的那个。
      const nearest = changedPaths.length > 0 ? ` 已改路径：${changedPaths.map((p) => `"${p}"`).join("、")}` : " 本次提交没有任何已改路径";
      issues.push(newFinding("validation/key_change_unmatched", `关键变更 item "${item.text}" 未命中任何已改路径（该方向要求：item 须点名它对应的改动，匹配依据是**文件路径**——完整路径、文件名、去扩展名的词干（≥3 字符）或目录段，任一出现在 item 文本中即算命中）。${nearest}`, item.line));
    }
    // 方向二：改了的东西必须被正文覆盖。
    for (const path of uncovered) {
      issues.push(newFinding("validation/staged_path_uncovered", `已改路径 "${path}" 没有任何 关键变更 item 覆盖它（该方向要求：每个非豁免的已暂存改动都须在 关键变更 中被点名，否则等于漏报改动）。补一条点名 "${path}" 的 item 即可。`, null));
    }
    // 两个方向同时存在时，额外给一条整体说明——「规则是双向的」这件事过去
    // 只存在于实现里，使用者只能靠反复失败反推。
    if (unmatched.length > 0 && uncovered.length > 0) {
      issues.push(newFinding("validation/key_changes_required", `关键变更 与已暂存改动是**双向一一对应**关系（06 §6.1 K1）：每个 item 须命中一个已改路径，每个已改路径须被一个 item 命中。本次同时有 ${unmatched.length} 个 item 无对应改动、${uncovered.length} 个改动无对应 item——请一并修正后再提交，不必逐轮试探。`, null));
    }
    return { ok: false, issues };
  }
  return { ok: true, changedPaths };
}

function extractDiffPaths(diff) {
  const paths = new Set();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (match === null) continue;
    paths.add(match[1]);
    paths.add(match[2]);
  }
  return [...paths];
}

/**
 * Mechanical item-to-path correspondence: the item mentions the changed path
 * (or its basename without extension when the item uses a natural-language
 * name). This is the deliberately narrow decidable slice — semantic review
 * of the DESCRIPTION quality stays with human/independent review, not here.
 */
function itemMatchesPath(item, path) {
  if (item.includes(path)) return true;
  const base = path.split("/").pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, "");
  if (stem.length > 2 && (item.includes(stem) || item.includes(base))) return true;
  // Diffstat-style summaries name the touched area; accept directory words.
  const segments = path.split("/").filter((segment) => segment.length > 2 && !/\d/.test(segment));
  return segments.some((segment) => item.includes(segment));
}

// ---------------------------------------------------------------------------
// docs/ reference check (09 §5.3 item 5, Human 2026-10-12)
// ---------------------------------------------------------------------------
//
// docs/ holds temporary documents only: it is neither a specification source
// nor a fact source, so no carrier may cite it as an authority. This check
// blocks NEW dangling references; it deliberately does not chase existing ones
// (the spec says pre-existing references are cleaned up gradually and must not
// block commits in the meantime).
//
// Decidable slice, deliberately narrow:
//   - Only carriers that this commit ADDS or MODIFIES are scanned.
//   - The scan is limited to SPEC and FACT carriers (specs/**, ldvh-base/**,
//     and the repository-root README.md) — the class the rule is about.
//     Implementation carriers (code, tests, build scripts) are excluded: their
//     mentions of docs/ are code comments and test fixtures, not authority
//     claims; including them would also make the rule self-defeating, since
//     the rule's own tests must name docs/ paths and the change could then
//     never land.
//   - Carriers inside docs/ itself are skipped: intra-docs cross-links are
//     fine, that directory is temporary by definition.
//   - A reference blocks only when it is NEWLY INTRODUCED by this commit AND
//     its target is ABSENT from the candidate tree. Both halves are required:
//     the Human's instruction is to clean up EXISTING references gradually,
//     so editing a carrier that merely still carries an old reference must
//     not block — otherwise "gradually" would be impossible to honour, every
//     later edit to that carrier would be frozen until the cleanup lands.
//     The caller supplies the baseline text to make the "newly introduced"
//     half decidable; with no baseline every current reference counts as new
//     (an added file has no prior text, which is exactly right).
//   - `plugin/web/docs/` is a DIFFERENT directory (Web design docs, owned by
//     07) and is never matched: the pattern is anchored so that `docs/` must
//     begin a path segment.
//
// `carriers` is supplied as { path, content, baseline? } so this stays pure
// and testable; the runner gathers content from the Index (staged content is
// authoritative for what the commit would land) and the baseline from HEAD.
export const DOCS_REFERENCE_PATTERN = /(?:^|[^A-Za-z0-9._/-])(docs\/[A-Za-z0-9._/-]*[A-Za-z0-9_-])/g;

/** True when a repo-relative path is under the top-level temporary docs/ tree. */
export function isTemporaryDocsPath(path) {
  return path === "docs" || path.startsWith("docs/");
}

/**
 * True when a path is a spec or fact carrier — the class of file the docs/
 * reference rule governs (09 §5.3 item 5, whose wording is "规范或事实载体").
 * Implementation carriers (code, tests, scripts) are out of scope by that
 * same wording: they do not cite docs/ as an authority.
 */
export function isSpecOrFactCarrierPath(path) {
  if (path === "README.md") return true;
  return path.startsWith("specs/") || path.startsWith("ldvh-base/");
}

/**
 * Extract the distinct docs/ references a carrier text makes.
 * Trailing punctuation is trimmed so `docs/x.md`（…）and `docs/x.md`,
 * both yield the bare path.
 */
export function extractDocsReferences(text) {
  const found = new Set();
  for (const match of text.matchAll(DOCS_REFERENCE_PATTERN)) {
    const ref = match[1].replace(/[.,;:]+$/, "");
    if (ref.length > "docs/".length) found.add(ref);
  }
  return [...found];
}

export function checkDocsReferences(carriers, { exists } = {}) {
  const issues = [];
  const resolveExists = typeof exists === "function" ? exists : () => false;
  for (const carrier of carriers) {
    // Only spec/fact carriers are governed; docs/ carriers may cross-link
    // freely among themselves, and implementation carriers are out of scope.
    if (!isSpecOrFactCarrierPath(carrier.path)) continue;
    if (typeof carrier.content !== "string" || carrier.content.length === 0) continue;
    const preexisting = new Set(
      typeof carrier.baseline === "string" ? extractDocsReferences(carrier.baseline) : []
    );
    for (const ref of extractDocsReferences(carrier.content)) {
      if (preexisting.has(ref)) continue; // old reference: cleaned up gradually
      if (resolveExists(ref)) continue;   // live target: not a violation
      issues.push(newFinding(
        "validation/docs_reference_dangling",
        `${carrier.path} references "${ref}", which does not exist in the candidate tree (09 §5.3 item 5: docs/ is temporary-only and must not be relied on; remove the reference or re-home the content as a fact object)`,
        null
      ));
    }
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Fact-object uniqueness assertion (specs/27 §11 second layer — Git Gate)
// ---------------------------------------------------------------------------

/** Directory (under the repo root) that carries Norm fact-object carriers. */
export const NORM_FACT_DIRECTORY = "ldvh-base/norms";

/**
 * Uniqueness formula from 27 §11:  Count(direction_key = d ∧ status = "active") ≤ 1
 *
 * The writer refuses such a write up front (layer 1) and the consuming side
 * fails closed (layer 3), but neither covers a carrier written by hand or by a
 * shell redirect. This is layer 2: at commit time, read every Norm carrier that
 * the candidate tree would contain and refuse the commit when two ACTIVE ones
 * share a direction_key.
 *
 * `carriers` is supplied by the caller as { path, content } pairs so this
 * function stays pure and testable; the runner gathers them from the Index and
 * the working tree (a staged carrier plus an unstaged sibling both land in the
 * committed tree).
 *
 * Scope honesty: this asserts the uniqueness constraint over the carriers it is
 * given. It does NOT validate rule quality, and per 27 §17 red line 5 it makes
 * no claim about whether a Norm is genuinely "systematic".
 */
export function checkNormDirectionUniqueness(carriers) {
  const issues = [];
  const active = [];
  for (const carrier of carriers) {
    const parsed = parseNormCarrierFrontmatter(carrier.content);
    if (!parsed.ok) {
      issues.push(newFinding("facts/norm_carrier_unparseable", `${carrier.path}: ${parsed.reason} — cannot prove this carrier conflict-free (27 §11 second layer fails closed)`, null));
      continue;
    }
    const { status, direction_key: directionKey } = parsed.frontmatter;
    if (status === "active" && typeof directionKey === "string" && directionKey.length > 0) {
      active.push({ path: carrier.path, direction_key: directionKey });
    }
  }

  const byDirection = new Map();
  for (const entry of active) {
    const list = byDirection.get(entry.direction_key) ?? [];
    list.push(entry);
    byDirection.set(entry.direction_key, list);
  }
  for (const [directionKey, group] of byDirection) {
    if (group.length > 1) {
      issues.push(newFinding(
        "facts/norm_direction_collision",
        `${group.length} active Norm objects share direction_key "${directionKey}" (27 §11: Count(direction_key=d ∧ status=active) ≤ 1) — ${group.map((g) => g.path).join(", ")}; retire all but one before committing`,
        null
      ));
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Parse just enough YAML frontmatter to read status + direction_key. Kept local
 * (rather than importing the Norm writer) so the Git Gate runner stays free of
 * the writer's heavier dependency surface — the hook runs on every commit.
 */
function parseNormCarrierFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, reason: "missing YAML frontmatter fence" };
  const frontmatter = {};
  // Normalise CRLF -> LF BEFORE splitting. The fence regex above deliberately
  // accepts CRLF, so splitting on "\n" alone leaves a trailing "\r" on every
  // line. That "\r" is swallowed by the regex's `\s*` and then makes `(.*)$`
  // unmatchable, so such lines are dropped entirely — including `status`. The
  // carrier is then silently skipped and a duplicate direction_key commits
  // unchallenged: a FAIL-OPEN in the very layer 27 §11 declares fail-closed.
  // Normalising first mirrors validateMessage/checkKeyChangesAgainstDiff, which
  // already apply this same "\r\n" -> "\n" step in this file.
  for (const line of match[1].replace(/\r\n/g, "\n").split("\n")) {
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (field === null) continue;
    let value = field[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[field[1]] = value;
  }
  return { ok: true, frontmatter };
}

/** True when a repo-relative path is a Norm carrier this gate must inspect. */
// ---------------------------------------------------------------------------
// Load-bearing declaration protection
// (specs/01 §7 末段「承重声明的撤除条件」 + specs/09 §5.3 item 6)
//
// The rule this implements: a declaration that states some scope is not yet
// fulfilled — carrying a 「不得声称」-shaped prohibition as its requirement and
// a resolution condition as its release — must not be removed or stripped of
// its resolution element without the commit carrying a resolvable reference to
// an independent review conclusion.
//
// HONEST BOUNDARY (stated here because the check's green result must not be
// read as more than it is): this proves that the commit carried a resolvable
// reference. It does NOT prove the reference is honest, and it does NOT prove
// the declaration's scope is actually closed. A statement weakened while
// keeping both the marker and the anchor is not caught here at all.
// ---------------------------------------------------------------------------

/** Fixed marker a load-bearing declaration carries at the head of its unit. */
export const LOAD_BEARING_MARKER = "【承重声明】";

/** Fixed label of the release sub-element a load-bearing declaration carries. */
export const LOAD_BEARING_RESOLUTION_LABEL = "**恢复条件**：";

export const LOAD_BEARING_RULES = Object.freeze({
  removed: "validation/load_bearing_declaration_removed",
  resolutionMissing: "validation/load_bearing_resolution_missing",
  baselineUnreadable: "validation/load_bearing_baseline_unreadable"
});

/** The check's scope is spec carriers (09 §5.3 item 6: `specs/**`). */
export function isSpecCarrierPath(path) {
  return typeof path === "string" && path.startsWith("specs/");
}

/**
 * Extract load-bearing units from one carrier text.
 *
 * The unit is one physical line: a table row is one line, and a paragraph
 * declaration puts the marker at the head of its opening line. The unit key is
 * what follows the marker up to the first structural delimiter — the
 * declaration's own anchor (dependency name / clause subject), which is
 * expected to survive editorial changes inside the declaration text.
 */
export function extractLoadBearingUnits(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const units = [];
  for (const line of text.split("\n")) {
    const uses = literalUsesOutsideCodeSpans(line, LOAD_BEARING_MARKER);
    if (uses.length === 0) continue; // a mention is not a declaration
    const rest = line.slice(uses[0] + LOAD_BEARING_MARKER.length).trim();
    const cut = rest.search(/[|｜：:]/);
    const anchor = (cut >= 0 ? rest.slice(0, cut) : rest).replace(/\*\*|\s+/g, " ").trim().slice(0, 40);
    if (anchor.length === 0) continue;
    units.push({ anchor, hasResolution: literalUsesOutsideCodeSpans(line, LOAD_BEARING_RESOLUTION_LABEL).length > 0 });
  }
  return units;
}

/**
 * Offsets where a literal is USED rather than merely MENTIONED.
 *
 * Both the marker and the resolution label have to be NAMED by the very rules
 * that define them, and those rules write them inside code spans —
 * `【承重声明】`, `**恢复条件**：…`. Counting a code-span occurrence would make
 * the rule's own paragraph a protected unit, and (for the label) would accept a
 * declaration whose label is only quoted rather than carried. A literal inside
 * a code span (an odd number of backticks before it on the same line) is a
 * mention; everything else is a use. Both checks go through this one helper so
 * the marker side and the label side cannot drift apart.
 */
function literalUsesOutsideCodeSpans(line, literal) {
  const offsets = [];
  let from = 0;
  for (;;) {
    const at = line.indexOf(literal, from);
    if (at < 0) return offsets;
    const backticks = (line.slice(0, at).match(/`/g) ?? []).length;
    if (backticks % 2 === 0) offsets.push(at);
    from = at + literal.length;
  }
}

const REFERENCE_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const REFERENCE_COMMIT_PATTERN = /(?<![0-9a-f])[0-9a-f]{7,40}(?![0-9a-f])/g;

/**
 * Collect the reference tokens a message's 关键变更 items offer as the
 * independent-review reference. Extraction is pure; resolution is the
 * caller's (it needs git and the fact store) — same split as the docs/ check's
 * injected `exists`.
 */
export function collectDeclarationReferenceTokens(message) {
  const lines = String(message ?? "").replace(/\r\n/g, "\n").split("\n");
  const keyIndex = lines.findIndex((line) => line === "关键变更:");
  if (keyIndex === -1) return [];
  const tokens = new Set();
  for (const line of lines.slice(keyIndex + 1)) {
    if (line === "关键变更:") break; // a second section is validateMessage's business
    if (!line.startsWith("- ")) continue;
    const text = line.slice(2);
    // UUID spans first, then bare hashes OUTSIDE those spans: a UUID contains
    // hyphen-separated hex runs, and a hash pattern alone would read its
    // fragments ("0ac049b5", "f5e647c249b9") as separate references.
    const spans = [];
    for (const match of text.matchAll(REFERENCE_UUID_PATTERN)) {
      tokens.add(match[0]);
      spans.push([match.index, match.index + match[0].length]);
    }
    for (const match of text.matchAll(REFERENCE_COMMIT_PATTERN)) {
      const start = match.index;
      const end = start + match[0].length;
      if (spans.some(([from, to]) => start < to && end > from)) continue;
      tokens.add(match[0]);
    }
  }
  return [...tokens];
}

/**
 * specs/09 §5.3 item 6. `carriers` are `{path, content, baseline}` where
 * `baseline` is the declaration source at HEAD and `content` the candidate
 * bytes; `unreadable` lists paths whose baseline could not be read (they fail
 * closed); `resolvable` is a Set of reference tokens the caller confirmed
 * resolvable (or a sync predicate).
 */
export function checkLoadBearingDeclarations(carriers, { message, resolvable, unreadable } = {}) {
  const issues = [];
  for (const path of Array.isArray(unreadable) ? unreadable : []) {
    issues.push(newFinding(
      LOAD_BEARING_RULES.baselineUnreadable,
      `baseline unreadable for ${path}: the load-bearing declaration check cannot decide, and fails closed (09 §5.3 item 6)`,
      null
    ));
  }
  const isResolvable = typeof resolvable === "function"
    ? resolvable
    : (token) => resolvable instanceof Set && resolvable.has(token);
  const exemption = collectDeclarationReferenceTokens(message).find((token) => isResolvable(token)) ?? null;
  if (exemption !== null) return { ok: issues.length === 0, issues, exemption };
  for (const carrier of Array.isArray(carriers) ? carriers : []) {
    if (!isSpecCarrierPath(carrier?.path)) continue;
    const base = extractLoadBearingUnits(carrier.baseline);
    if (base.length === 0) continue;
    const byAnchor = new Map(extractLoadBearingUnits(carrier.content).map((unit) => [unit.anchor, unit]));
    for (const unit of base) {
      const found = byAnchor.get(unit.anchor);
      if (found === undefined) {
        issues.push(newFinding(
          LOAD_BEARING_RULES.removed,
          `${carrier.path}: 承重声明「${unit.anchor}」 is present at HEAD but absent from the candidate — removing or rewriting a load-bearing declaration requires a resolvable independent-review reference in a 关键变更 item (01 §7 末段; 09 §5.3 item 6)`,
          null
        ));
      } else if (!found.hasResolution) {
        issues.push(newFinding(
          LOAD_BEARING_RULES.resolutionMissing,
          `${carrier.path}: 承重声明「${unit.anchor}」 lost its ${LOAD_BEARING_RESOLUTION_LABEL} sub-element — same requirement as removal (01 §7 末段; 09 §5.3 item 6)`,
          null
        ));
      }
    }
  }
  return { ok: issues.length === 0, issues, exemption: null };
}

/**
 * 09 §5.3 第 7 项（Human 决定 2026-10-15）：以「§7.2 违规」为由删除规范内容时，
 * 提交消息须携带**逐字引用 §7.2 原文**的声明，且该引用须在当次 §7.2 文本中逐字存在。
 *
 * 来历：主控曾为判定「哪类表述该删」自拟一条规范外的判据（并另造了一个 §7.2 中并不
 * 存在的违规类「布局自指计数」），据此批量删除；同一判据在同一批内对结构同类项给出
 * 互斥结果（账目 ba4afa96）。该轮复审给出的可修方向即本项：**无原文即不得删**。
 *
 * 强度边界（如实声明，不主张闭环）：本项**只在消息自愿申报依据时**生效——不申报而删
 * 的情形看不见（那仍属独立复核与 Human 阅读范围）；它挡的是**凭印象引规范**，即
 * 引一句 §7.2 里并不存在的话。故本项是加固，不是闭环。
 */
export const REMOVAL_BASIS_LABEL = "§7.2 依据：";
export const REMOVAL_BASIS_RULES = Object.freeze({
  unquotable: "validation/removal_basis_unquotable",
  empty: "validation/removal_basis_empty",
  sectionUnreadable: "validation/removal_basis_section_unreadable",
});

/** 取出消息中每一处 `§7.2 依据：` 后随的引用文本（不含行首列表符）。 */
export function collectRemovalBasisDeclarations(message) {
  const out = [];
  for (const raw of String(message ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    // **提及 vs 使用**：标签若落在代码跨度内，则这一行是在**描述**该机制（如规范正文或
    // 提交消息举例），不是申报依据——与承重标记一侧同口径（literalUsesOutsideCodeSpans）。
    const uses = literalUsesOutsideCodeSpans(line, REMOVAL_BASIS_LABEL);
    if (uses.length === 0) continue;
    const at = uses[0] + REMOVAL_BASIS_LABEL.length;
    out.push(line.slice(at).trim());
  }
  return out;
}

/** 从规范载体全文取出 §7.2 一节（`### 7.2` 起，至下一个 `###`／`## ` 前）。 */
export function extractSectionText(specText, sectionHeading = "### 7.2") {
  const text = String(specText ?? "").replace(/\r\n/g, "\n");
  const start = text.indexOf(sectionHeading);
  if (start === -1) return null;
  const rest = text.slice(start + sectionHeading.length);
  const next = rest.search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * `sectionText === null` 表示当次 §7.2 文本取不到（fail-closed）；`undefined`
 * 表示调用方未提供该信息，此时只做「声明非空」这一半。
 */
export function checkRemovalBasisDeclarations({ message, sectionText, sectionTexts } = {}) {
  const declared = collectRemovalBasisDeclarations(message);
  if (declared.length === 0) return { ok: true, issues: [], declarations: 0 };
  const issues = [];
  // 比对范围是 **HEAD 与候选两版的 §7.2 并集**：本次提交可能正是要删掉被引的那句
  // （那样它当然不在候选里），而本项要抓的是**编造判据**——历史上那条「布局自指计数」
  // 在两版里都不存在。任一版含该句即算引用成立。
  const raw = Array.isArray(sectionTexts) ? sectionTexts : [sectionText];
  const known = raw.filter((text) => typeof text === "string").map((text) => text.replace(/\s+/g, " ").trim());
  const unreadable = raw.length > 0 && known.length === 0;
  const normalized = known.length === 0 ? null : known;
  for (const quote of declared) {
    if (quote.length === 0) {
      issues.push(newFinding(REMOVAL_BASIS_RULES.empty, `${REMOVAL_BASIS_LABEL} must carry the quoted §7.2 sentence (09 §5.3 item 7)`, null));
      continue;
    }
    if (unreadable) {
      issues.push(newFinding(REMOVAL_BASIS_RULES.sectionUnreadable, `§7.2 text is unreadable in both HEAD and the candidate tree, so the declared basis cannot be verified: ${quote.slice(0, 60)} (09 §5.3 item 7, fails closed)`, null));
      continue;
    }
    const needle = quote.replace(/\s+/g, " ").trim();
    if (normalized !== null && !normalized.some((text) => text.includes(needle))) {
      issues.push(newFinding(REMOVAL_BASIS_RULES.unquotable, `${REMOVAL_BASIS_LABEL} quotes a sentence absent from the current §7.2 text: ${quote.slice(0, 60)} (09 §5.3 item 7 — 无原文即不得删)`, null));
    }
  }
  return { ok: issues.length === 0, issues, declarations: declared.length };
}

export function isNormCarrierPath(path) {
  return path.startsWith(`${NORM_FACT_DIRECTORY}/`) && /\/norm-[^/]+\.md$/.test(path);
}

// ── 摩擦 relations 的 commit 目标：提交层的兜底校验 ──────────────────────
//
// 26 §11 要求 `informs` 的目标「存在且可解析」，commit 例外形态同样如此
// （「机械层只核 hash 真实可解析」）。这条校验写在 friction-writer 里，覆盖
// create/update/correct 三条受控路径——**但它覆盖不到不经 writer 的直接落盘**。
//
// 实测事故（2026-10-19 发现）：friction-ed844630 以 `git add` + `commit` 直接
// 落盘（git 记录为 new file、42 行纯新增，status 一上来就是 resolved、relations
// 一上来就带着两条 informs），完全绕过 writer，于是两个**从未存在过**的 commit
// 标识堂而皇之地进了账目，Web 端渲染成死链接。writer 里的 fail-closed 再严密，
// 对「不经过 writer」的写入也毫无作用。
//
// 提交缝是所有写入路径的唯一汇聚点，故在此再兜一层：校验的对象是 **Index 里
// 暂存的内容**（即将进仓的那一版），而不是工作树上的副本——否则一笔提交可能
// 携带一个尚未落盘的正确版本通过校验。
//
// 判定口径与 writer 一致（`git cat-file -e <hash>^{commit}`），差别只在失败
// 处理的时机：writer 是在写之前拒绝，这里是在提交之前拒绝。
const FRICTION_FACT_DIRECTORY = "ldvh-base/frictions";
const COMMIT_HASH_PATTERN = /^[0-9a-f]{40}$/i;

export function isFrictionCarrierPath(path) {
  return path.startsWith(`${FRICTION_FACT_DIRECTORY}/`) && /\/friction-[^/]+\.md$/.test(path);
}

/**
 * 从摩擦载体的 frontmatter 中取出所有 commit 形态的目标。
 *
 * 只做窄解析：本函数不承担 YAML 全集的正确性，它的输入是**已经过了 writer
 * 校验或结构校验**的载体；这里要抓的是「标识是否真实存在于仓库」。因此只认
 * `relations:` 块里 `target:` 下的 `commit:` 行，以及 `evidence_locator:` 下的
 * `commit:` 行——两种形态在 02 §8.1 中并列，都必须真实可解析。
 *
 * 找不到 `relations:` 块返回空数组（绝大多数摩擦没有关系边，这是常态）。
 */
export function extractFrictionCommitTargets(content) {
  const targets = [];
  const lines = String(content ?? "").split(/\r?\n/);
  // 只在 frontmatter 围栏内找：从首行 `---` 到下一个 `---`。
  const start = lines.findIndex((line) => line.trim() === "---");
  if (start === -1) return targets;
  const end = lines.findIndex((line, index) => index > start && line.trim() === "---");
  if (end === -1) return targets;

  let inRelations = false;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    // 顶层键（无缩进）决定是否已离开 relations 块。
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
      inRelations = /^relations\s*:/.test(line);
      continue;
    }
    if (!inRelations) continue;
    const match = /^\s+commit\s*:\s*(.+?)\s*$/.exec(line);
    if (match) targets.push(match[1].replace(/^["']|["']$/g, ""));
  }
  return targets;
}

/**
 * 校验摩擦载体里的 commit 目标是否真实可解析。
 *
 * `resolves(hash)` 由调用方注入（gate runner 用 `git cat-file -e`），保持本模块
 * 不直接触碰 git。**无 resolver 时 fail-closed**：无法核验即不通过——这正是
 * writer 侧已经确立的口径，此处不因为「只是在提交时查一下」而放松。
 */
export async function checkFrictionCommitTargets(carriers, { resolves } = {}) {
  const issues = [];
  if (typeof resolves !== "function") {
    return {
      ok: false,
      issues: [newFinding("git/friction_commit_unverifiable", "cannot verify friction commit targets: no commit resolver was supplied (26 §11, fails closed)", null)],
      checked: 0,
    };
  }
  let checked = 0;
  for (const carrier of carriers ?? []) {
    for (const hash of extractFrictionCommitTargets(carrier.content)) {
      checked += 1;
      if (!COMMIT_HASH_PATTERN.test(hash)) {
        issues.push(newFinding("git/friction_commit_malformed", `${carrier.path}: relations target must be a 40-hex commit hash, got ${JSON.stringify(hash)} (02 §8.1 commit 形态)`, null));
        continue;
      }
      if (!(await resolves(hash))) {
        issues.push(newFinding("git/friction_commit_unresolvable", `${carrier.path}: commit ${hash} does not resolve to an existing commit in this repository (26 §11 — 目标必须存在且可解析)`, null));
      }
    }
  }
  return { ok: issues.length === 0, issues, checked };
}
