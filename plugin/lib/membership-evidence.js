
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { contentFingerprint } from "./spec-registry.js";

const execFileAsync = promisify(execFile);

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
    semantic_remainder: "signature presence does not prove the commit was authorised, reviewed or Human-approved (01 §9.2 items 8/9)"
  };
}

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

function checkRecordPresence(kind, records, repoPath, responsibilityKey) {
  const matched = (Array.isArray(records) ? records : []).filter((record) =>
    record !== null && typeof record === "object" && Array.isArray(record.carriers) &&
    (record.carriers.includes(repoPath) || record.carriers.includes(responsibilityKey))
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
      "8": checkRecordPresence("review", reviews, repoPath, responsibilityKey),
      "9": checkRecordPresence("decision", decisions, repoPath, responsibilityKey),
      "11": await checkControlledCommit(projectRoot, repoPath),
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
      membership_proven: false
    });
  }
  return {
    spec: "01 §9.2",
    applicable: true,
    items_covered: ["8", "9", "11", "12"],
    carriers,
    gaps,
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

export function notApplicableEvidence(source) {
  return {
    spec: "01 §9.2",
    applicable: false,
    reason:
      `spec corpus was answered by the ${source.kind} fallback (${source.corpus_root}); `
      + "the governed project does not author these carriers, so per-project git/review/decision evidence does not exist (01 §10.3). "
      + "The corpus's own membership conditions belong to its source repository.",
    items_covered: [],
    carriers: [],
    gaps: [],
    guarantee: "Not applicable is a scoping conclusion, not a pass: no §9.2 item was checked for this corpus in this project.",
    semantic_remainder: [
      "items 8/9/11/12: not checked here — membership evidence for this corpus must be obtained in its source repository"
    ]
  };
}
