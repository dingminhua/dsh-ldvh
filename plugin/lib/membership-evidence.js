// dsh-ldvh — mechanical evidence binding for specs/01 §9.2 items 8/9/11/12.
//
// Authority: specs/01 §9.2 「条件分类与核对方式」. Items 8 (independent review),
// 9 (Human decision), 11 (controlled commit) and 12 (fingerprint binding) are
// SEMANTIC/EVIDENCE items: the spec is explicit that code cannot judge whether
// a review record is真实、充分或有效 — that stays with AI semantic review and
// the Human decision. What the spec DOES require is that each item's
// **mechanically checkable sub-part** must be concluded by machine:
//
//   代码可以核对记录是否存在、提交是否形成、签名与候选指纹是否一致
//   （这些部分已有机械载体）
//
// and that anything not actually verified must enter `gaps` rather than be
// silently dropped. This module produces exactly that: per-item, per-carrier
// mechanical conclusions, with the semantic remainder explicitly left open so
// no caller can mistake "mechanically checkable part passed" for "membership
// proven".
//
// It never claims membership. Every result carries semantic_remainder naming
// what a human/AI reviewer still owes.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { contentFingerprint } from "./spec-registry.js";

const execFileAsync = promisify(execFile);

/** Run git read-only; returns null when git or the repo is unavailable. */
async function git(projectRoot, args) {
  try {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    for (const key of Object.keys(env)) {
      if (key === "GIT_CONFIG_COUNT" || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")
        || ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"].includes(key)) delete env[key];
    }
    const result = await execFileAsync("git", ["-C", projectRoot, ...args], { env, encoding: "utf8", timeout: 10000 });
    return result.stdout;
  } catch {
    return null;
  }
}

/**
 * Item 11 (controlled commit): did a commit exist that touched this carrier,
 * and does its message carry the controlled-commit signature? The spec's
 * mechanically checkable sub-part is "提交是否形成、签名与候选指纹是否一致";
 * whether the commit was PROPERLY AUTHORISED is the semantic remainder.
 */
async function checkControlledCommit(projectRoot, repoPath) {
  const log = await git(projectRoot, ["log", "-1", "--format=%H%n%s%n%b", "--", repoPath]);
  if (log === null) return { concluded: false, reason: "git history unavailable for this work tree" };
  const trimmed = log.trim();
  if (trimmed.length === 0) {
    return {
      concluded: true,
      satisfied: false,
      detail: "no commit in history touches this carrier",
      semantic_remainder: "a carrier not yet committed cannot have satisfied the controlled-commit route"
    };
  }
  const [sha, subject, ...bodyLines] = trimmed.split("\n");
  const body = bodyLines.join("\n");
  const hasProvider = /^LDVH-Provider:\s*\S+/m.test(body);
  const hasModel = /^LDVH-Model:\s*\S+/m.test(body);
  return {
    concluded: true,
    satisfied: hasProvider && hasModel,
    detail: `latest commit ${sha.slice(0, 12)} (${subject}); signature ${hasProvider && hasModel ? "present" : "incomplete"}`,
    evidence: { commit: sha, subject, signature: { provider: hasProvider, model: hasModel } },
    // The spec is explicit: signature presence is NOT authorisation.
    semantic_remainder: "signature presence does not prove the commit was authorised, reviewed or Human-approved (01 §9.2 items 8/9)"
  };
}

/**
 * Item 12 (fingerprint binding): does the carrier's CURRENT content fingerprint
 * still equal what the Human decision / review / commit were bound to? The
 * mechanically checkable sub-part is exactly this comparison; whether the bound
 * decision was REAL and still APPLICABLE is the semantic remainder.
 *
 * A `bindings` record supplies the expected fingerprint per carrier, as
 * recorded at decision time. When no expectation exists we conclude nothing
 * and say so — absence of an expectation is not a pass.
 */
function checkFingerprintBinding(repoPath, currentFingerprint, bindings) {
  const expected = bindings?.[repoPath];
  if (typeof expected !== "string" || expected.length === 0) {
    return {
      concluded: false,
      reason: "no recorded fingerprint binding for this carrier",
      semantic_remainder: "without a recorded expectation the binding cannot be checked; this is a gap, not a pass"
    };
  }
  const matches = expected === currentFingerprint;
  return {
    concluded: true,
    satisfied: matches,
    detail: matches
      ? "current content fingerprint matches the recorded binding"
      : `content changed since the binding was recorded (expected ${expected.slice(0, 12)}…, current ${currentFingerprint.slice(0, 12)}…)`,
    evidence: { expected_fingerprint: expected, current_fingerprint: currentFingerprint },
    semantic_remainder: "a matching fingerprint proves the text is unchanged, not that the bound decision is真实、充分或仍然适用"
  };
}

/**
 * Item 8 (independent review) + item 9 (Human decision): the only mechanical
 * sub-part available is whether a record EXISTS and is REFERENCED. The spec
 * forbids concluding more. We report existence/absence honestly and always
 * name the semantic remainder.
 */
function checkRecordPresence(kind, records, repoPath, responsibilityKey) {
  const matched = (records ?? []).filter((record) =>
    record?.carriers === undefined || record.carriers.includes(repoPath) || record.carriers.includes(responsibilityKey)
  );
  if (matched.length === 0) {
    return {
      concluded: true,
      satisfied: false,
      detail: `no ${kind} record references this carrier`,
      semantic_remainder: `the absence of a ${kind} record is a mechanical conclusion; its necessity is judged semantically`
    };
  }
  return {
    concluded: true,
    satisfied: true,
    detail: `${matched.length} ${kind} record(s) reference this carrier`,
    evidence: { records: matched.map((r) => ({ ref: r.ref ?? null, date: r.date ?? null })) },
    semantic_remainder: `a ${kind} record EXISTING does not prove it is真实、充分或有效 — that judgement is not mechanical (01 §9.2)`
  };
}

/**
 * Build the §9.2 evidence report for one snapshot.
 *
 * @param projectRoot   governed project root (Git work tree)
 * @param members       admissible candidates from the same scan snapshot
 * @param options       { bindings, reviews, decisions }
 * @returns per-carrier mechanical conclusions + an explicit gap list
 */
export async function bindMembershipEvidence(projectRoot, members, options = {}) {
  const { bindings = {}, reviews = [], decisions = [] } = options;
  const carriers = [];
  const gaps = [];
  for (const member of members) {
    const repoPath = member.repoPath;
    const identity = member.identity ?? {};
    const responsibilityKey = identity.spec_key ?? identity.attachment_key ?? null;
    const currentFingerprint = contentFingerprint(member.markdownText);
    const items = {
      // Item 8 — independent adversarial review (existence only).
      "8": checkRecordPresence("review", reviews, repoPath, responsibilityKey),
      // Item 9 — Human decision (existence only).
      "9": checkRecordPresence("decision", decisions, repoPath, responsibilityKey),
      // Item 11 — controlled commit formed, with signature.
      "11": await checkControlledCommit(projectRoot, repoPath),
      // Item 12 — fingerprint still bound.
      "12": checkFingerprintBinding(repoPath, currentFingerprint, bindings)
    };
    for (const [item, outcome] of Object.entries(items)) {
      if (outcome.concluded !== true) {
        gaps.push({
          canonical_path: repoPath,
          responsibility_key: responsibilityKey,
          item,
          reason: outcome.reason ?? "not concluded",
          note: outcome.semantic_remainder ?? null
        });
      } else if (outcome.satisfied === false) {
        gaps.push({
          canonical_path: repoPath,
          responsibility_key: responsibilityKey,
          item,
          reason: outcome.detail,
          note: outcome.semantic_remainder ?? null
        });
      }
    }
    carriers.push({
      canonical_path: repoPath,
      responsibility_key: responsibilityKey,
      content_fingerprint: currentFingerprint,
      items,
      // The single sentence a caller must not lose:
      membership_proven: false
    });
  }
  return {
    spec: "01 §9.2",
    items_covered: ["8", "9", "11", "12"],
    carriers,
    gaps,
    // Restated at the top level so no consumer can read the item table as a
    // membership verdict.
    guarantee:
      "Mechanical conclusions cover only record existence, commit formation/签名 and fingerprint equality. "
      + "Whether a review or decision is真实、充分或有效 is NOT mechanically decidable (01 §9.2) and remains with AI semantic review and the Human decision.",
    semantic_remainder: [
      "item 8: whether the independent review actually attacked the real risks, and whether it was independent enough (01 §12.2)",
      "item 9: whether the Human decision was准确、充分 and still覆盖 the current candidate",
      "item 11: whether the controlled commit was properly authorised (signature presence ≠ authorisation)",
      "item 12: whether the bound decision remains applicable to the current candidate"
    ]
  };
}
