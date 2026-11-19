
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { listResolvableSubGoals } from "./subgoal-writer.js";
import { buildUpdateFrontmatter } from "./after-integrity.js";


const GOAL_KEY = "project-goal";

export const GOAL_RELATIVE_PATH = "goal.md";

const STATUSES = new Set(["active", "achieved"]);

const MAX_TITLE_LENGTH = 40;

export const MAX_STATEMENT_LENGTH = 200;

const BODY_H2 = ["目标陈述"];
const LEGACY_BODY_H2 = ["目标陈述", "子目标"];

const SG_ANCHOR_PATTERN = /^SG-[1-9]\d*$/;

const VALID_FM_KEYS = new Set([
  "goal_key", "title", "status", "created_at", "change_log",
]);

export const GOAL_REMOVABLE_FIELDS = new Set([]);


function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}


export function goalFilePath(factSourceRoot) {
  return join(factSourceRoot, GOAL_RELATIVE_PATH);
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

const FRONTMATTER_FIELD_ORDER = [
  "goal_key", "title", "status", "created_at", "change_log",
];

function orderFrontmatterFields(frontmatter) {
  const ordered = {};
  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (frontmatter[key] !== undefined) ordered[key] = frontmatter[key];
  }
  for (const key of Object.keys(frontmatter)) {
    if (!(key in ordered)) ordered[key] = frontmatter[key];
  }
  return ordered;
}

async function atomicWriteFile(filePath, content) {
  const tmp = `${filePath}.${process.hrtime.bigint().toString(36)}.tmp`;
  await writeFile(tmp, content, "utf8");
  const written = await readFile(tmp, "utf8");
  if (written !== content) {
    await unlink(tmp).catch(() => {});
    throw new Error("atomic write verification failed: written content does not match");
  }
  await rename(tmp, filePath);
}

function stripLeadingH1(text) {
  return typeof text === "string" ? text.replace(/^\s*#\s+[^\n]*\n?/, "") : text;
}

function assembleBody(title, bodyMarkdown) {
  return `# 项目目标\n\n${stripLeadingH1(bodyMarkdown).trim()}`;
}


export function splitBodySections(body) {
  const lines = body.split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^## (.+)$/);
    if (m !== null) {
      if (current !== null) sections.push(current);
      current = { heading: m[1].trim(), lines: [] };
      continue;
    }
    if (current !== null) current.lines.push(line);
  }
  if (current !== null) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() }));
}

export function parseSubGoals(sectionText) {
  const entries = [];
  for (const raw of sectionText.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const withoutMarker = line.replace(/^([-*+]|\d+\.)\s+/, "");
    const m = withoutMarker.match(/^(SG-\d+)\s+(.*)$/);
    if (m !== null) {
      const valid = SG_ANCHOR_PATTERN.test(m[1]);
      entries.push({
        anchor: m[1],
        text: m[2].trim(),
        malformed: !valid,
        ...(valid ? {} : { reason: `anchor ${m[1]} is not in the canonical SG-n form (25 §6 requires SG-<positive integer>)` }),
      });
      continue;
    }
    const looksLikeAnchor = /^SG/i.test(withoutMarker);
    entries.push({
      anchor: null,
      text: line,
      malformed: true,
      ...(looksLikeAnchor ? { reason: `line looks like a sub-goal anchor but does not match "SG-n <判据>": ${JSON.stringify(line)}` } : {}),
    });
  }
  return entries;
}

export function validateGoalFrontmatter(frontmatter) {
  const issues = [];

  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 25 §6)`);
    }
  }

  for (const forbidden of ["object_uid", "fact_type_key", "urls", "relations"]) {
    if (frontmatter[forbidden] !== undefined) {
      issues.push(`frontmatter: "${forbidden}" must not be present (25 §5/§9 declares it not adopted for the singleton type)`);
    }
  }

  if (frontmatter.goal_key !== GOAL_KEY) {
    issues.push(`goal_key: must be "${GOAL_KEY}" (25 §6 — the only legal value)`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (25 §6), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned, 25 §6)");
  }
  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")} (25 §7 — no third state)`);
  }
  if (!Array.isArray(frontmatter.change_log) || frontmatter.change_log.length === 0) {
    issues.push("change_log: required non-empty array (25 §6: 首修后必有; create writes the first entry)");
  } else {
    for (const [i, entry] of frontmatter.change_log.entries()) {
      if (typeof entry !== "object" || entry === null) { issues.push(`change_log[${i}]: must be an object`); continue; }
      if (typeof entry.at !== "string" || entry.at.length === 0) issues.push(`change_log[${i}].at: required (Code-assigned)`);
      if (typeof entry.summary !== "string" || entry.summary.length === 0) issues.push(`change_log[${i}].summary: required non-empty`);
    }
  }

  return { ok: issues.length === 0, issues };
}

export function validateGoalBodyStructure(body) {
  const issues = [];
  if (!/^# 项目目标\s*$/m.test(body)) {
    issues.push("body: must contain the H1 \"# 项目目标\" (25 §7)");
  }
  const h1Count = (body.match(/^#\s+\S/gm) ?? []).length;
  if (h1Count > 1) {
    issues.push(`body: must contain exactly one H1, found ${h1Count} (25 §7)`);
  }
  const sections = splitBodySections(body);
  const headings = sections.map((s) => s.heading);
  const isCurrent = headings.length === BODY_H2.length && headings.every((h, i) => h === BODY_H2[i]);
  const isLegacy = headings.length === LEGACY_BODY_H2.length && headings.every((h, i) => h === LEGACY_BODY_H2[i]);
  if (!isCurrent && !isLegacy) {
    issues.push(`body: H2 sections must be exactly ${BODY_H2.map((h) => `"${h}"`).join(" then ")}, got ${JSON.stringify(headings)} (25 §7; 方法与规划 已移除；子目标 已移出本载体，见 28 号)`);
  }
  const target = sections.find((s) => s.heading === "目标陈述");
  if (target === undefined || target.text.length === 0) {
    issues.push("body: 目标陈述 section must be present and non-empty (25 §12 创建检查)");
  } else if (target.text.length > MAX_STATEMENT_LENGTH) {
    issues.push(
      `body: 目标陈述 must be ≤ ${MAX_STATEMENT_LENGTH} characters (25 §7), got ${target.text.length} — `
      + "move implementation detail / acceptance criteria to the downstream object that owns it "
      + "(SubGoal criterion, plan) instead of truncating",
    );
  }
  return { ok: issues.length === 0, issues };
}

export function hasLegacySubGoalSection(body) {
  return splitBodySections(body).some((s) => s.heading === "子目标");
}

export function validateAnchorStability(previousAnchors, nextAnchors) {
  const issues = [];
  const next = new Set(nextAnchors);
  for (const anchor of previousAnchors) {
    if (!next.has(anchor)) {
      issues.push(`sub-goal anchor ${anchor} disappeared — existing SG-n may not be deleted (only marked obsolete in place, 25 §7/§12)`);
    }
  }
  const prevCommon = previousAnchors.filter((a) => next.has(a));
  const nextCommon = nextAnchors.filter((a) => previousAnchors.includes(a));
  if (prevCommon.join(",") !== nextCommon.join(",")) {
    issues.push(`sub-goal anchors reordered (25 §12: 既有 SG-n 不重排): before ${JSON.stringify(prevCommon)}, after ${JSON.stringify(nextCommon)}`);
  }
  const seen = new Set();
  for (const anchor of nextAnchors) {
    if (seen.has(anchor)) issues.push(`sub-goal anchor ${anchor} appears twice (anchors are unique)`);
    seen.add(anchor);
  }
  return { ok: issues.length === 0, issues };
}


export async function readGoalObject({ factSourceRoot }) {
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  const filePath = goalFilePath(factSourceRoot);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return failure("goal/not_initialised", "goal.md does not exist (25 §10: 项目未初始化 — authorisation cannot be accepted, reads are not blocked)");
    }
    throw error;
  }
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (m === null) return failure("goal/frontmatter_invalid", "file must start with a YAML frontmatter block followed by the body");
  let frontmatter;
  try {
    frontmatter = parseYaml(m[1]);
  } catch (error) {
    return failure("goal/frontmatter_invalid", `frontmatter is not parsable YAML: ${String(error?.message ?? error)}`);
  }
  if (typeof frontmatter !== "object" || frontmatter === null) {
    return failure("goal/frontmatter_invalid", "frontmatter must be a mapping");
  }
  const body = m[2];
  const fmCheck = validateGoalFrontmatter(frontmatter);
  const bodyCheck = validateGoalBodyStructure(body);
  const subGoals = parseSubGoals(splitBodySections(body).find((s) => s.heading === "子目标")?.text ?? "");
  return success({
    file: filePath,
    fingerprint: fileFingerprint(content),
    frontmatter,
    body,
    sub_goals: subGoals,
    body_valid: bodyCheck.ok,
    body_issues: bodyCheck.issues,
    frontmatter_issues: fmCheck.issues,
  });
}


export async function createGoalObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (starting with '## 目标陈述')");
  }

  const filePath = goalFilePath(factSourceRoot);
  try {
    await readFile(filePath, "utf8");
    return failure("goal/already_exists", `goal.md already exists at ${filePath}; the Goal type is a singleton and create is refused (25 §11 单例 fail-closed). Revise the existing goal through the update entry instead.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const now = new Date().toISOString();
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft ?? {};
  const frontmatter = { ...draftFields };
  frontmatter.goal_key = GOAL_KEY;
  frontmatter.created_at = now;
  if (frontmatter.status !== undefined && frontmatter.status !== "active") {
    return failure("goal/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(frontmatter.status)} (25 §7)`);
  }
  frontmatter.status = "active";
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft?.change_summary ?? "受控创建 Goal 对象（项目初始化对话）",
  }];

  const fmCheck = validateGoalFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("goal/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const body = assembleBody(frontmatter.title, bodyMarkdown);
  if (hasLegacySubGoalSection(body)) {
    return failure(
      "goal/legacy_subgoal_reintroduced",
      "goal.md no longer carries a 子目标 section (25 §7, 2026-11): sub-goals are SubGoal objects (28). Create them under ldvh-base/subgoals/ and reference this goal via parent_goal",
    );
  }
  const bodyCheck = validateGoalBodyStructure(body);
  if (!bodyCheck.ok) {
    return failure("goal/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }

  await mkdir(factSourceRoot, { recursive: true });
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  const readBack = await readGoalObject({ factSourceRoot });
  if (!readBack.ok) {
    return failure("goal/read_back_failed", `written but not readable: ${readBack.error.message}`);
  }
  return success({ file: filePath, fingerprint: fileFingerprint(content), read_back_fingerprint: readBack.value.fingerprint });
}


export async function updateGoalObject(args) {
  const {
    factSourceRoot, expectedFingerprint, frontmatterAfter, frontmatterRemovals = null, bodyMarkdownAfter, changeSummary,
    sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("goal/change_summary_required", "changeSummary is required for update (25 §6: 每条必含修订理由)");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 目标陈述')");
  }

  const current = await readGoalObject({ factSourceRoot });
  if (!current.ok) return current;
  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("goal/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }
  if (current.value.frontmatter.status === "achieved") {
    return failure("goal/status_terminal", "status=achieved is terminal and the file is frozen as a historical record (25 §7); a fundamentally overturned goal is a controlled REVISION before achievement, not a reopen");
  }

  const built = buildUpdateFrontmatter({
    currentFrontmatter: current.value.frontmatter,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: GOAL_REMOVABLE_FIELDS,
    typeLabel: "goal",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const fm = built.value;
  fm.goal_key = GOAL_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("goal/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (active/achieved, 25 §7)`);
  }

  const nextBody = assembleBody(fm.title, bodyMarkdownAfter);
  const prevLegacy = current.value.sub_goals.filter((s) => s.anchor !== null);
  let droppedLegacy = [];
  const nextHasLegacy = hasLegacySubGoalSection(nextBody);
  const prevHasLegacy = hasLegacySubGoalSection(current.value.body);

  if (prevHasLegacy && nextHasLegacy) {
    const nextParsed = parseSubGoals(splitBodySections(nextBody).find((s) => s.heading === "子目标")?.text ?? "");
    const badAnchors = nextParsed
      .filter((s) => (s.anchor === null && s.reason !== undefined) || (s.anchor !== null && s.malformed))
      .map((s) => s.reason ?? `anchor ${s.anchor} is not canonical`);
    if (badAnchors.length > 0) {
      return failure("goal/legacy_subgoal_unparsable", "the legacy 子目标 section carries an anchor that does not parse; refusing so an anchor cannot silently disappear from a frozen record (25 §7)", { issues: badAnchors });
    }
    const nextAnchors = nextParsed.filter((s) => s.anchor !== null).map((s) => s.anchor);
    const prevAnchors = prevLegacy.map((s) => s.anchor);
    const changed = prevAnchors.length !== nextAnchors.length
      || prevAnchors.some((a, i) => a !== nextAnchors[i]);
    if (changed) {
      return failure(
        "goal/legacy_subgoal_immutable",
        "the legacy 子目标 section in goal.md cannot be edited any more (25 §7, 2026-11): sub-goals are SubGoal objects now (28). Migrate each anchor to ldvh-base/subgoals/ first, then delete this section in one update — do not add, renumber or rewrite entries here",
        { existing_anchors: prevAnchors, attempted_anchors: nextAnchors },
      );
    }
  } else if (prevHasLegacy && !nextHasLegacy) {
    droppedLegacy = prevLegacy.map((s) => `${s.anchor ?? "?"} ${s.text ?? ""}`.trim());
  } else if (!prevHasLegacy && nextHasLegacy) {
    return failure(
      "goal/legacy_subgoal_reintroduced",
      "the 子目标 section was removed from goal.md (25 §7, 2026-11) and may not be reintroduced: sub-goals are SubGoal objects (28). Create them under ldvh-base/subgoals/ instead",
    );
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  const fmCheck = validateGoalFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("goal/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const bodyCheck = validateGoalBodyStructure(nextBody);
  if (!bodyCheck.ok) {
    return failure("goal/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }

  const filePath = goalFilePath(factSourceRoot);
  const content = buildFileContent(fm, nextBody);
  await atomicWriteFile(filePath, content);

  const readBack = await readGoalObject({ factSourceRoot });
  if (!readBack.ok || readBack.value.fingerprint !== fileFingerprint(content)) {
    return failure("goal/read_back_failed", "updated but read-back did not match; STOP further writes (03 §9.7)");
  }
  return success({
    file: filePath,
    fingerprint: fileFingerprint(content),
    legacy_subgoal_section: hasLegacySubGoalSection(nextBody),
    legacy_sub_goals_dropped: droppedLegacy,
  });
}

export async function readServableSubGoals({ factSourceRoot }) {
  const goal = await readGoalObject({ factSourceRoot });
  if (!goal.ok) return goal;
  const listed = await listResolvableSubGoals(factSourceRoot);
  if (!listed.ok) return failure(listed.error.code, listed.error.message);
  return success({
    sub_goals: listed.value.items,
    status: goal.value.frontmatter.status,
    file: goal.value.file,
  });
}
