
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter, uidRejectionHint } from "./after-integrity.js";
import { scanCarrierDirectory } from "./carrier-scan.js";
import { h2Titles, countAtxHeadings, sectionContent } from "./markdown-structure.js";
import { listResolvableSubGoals, resolveSubGoal } from "./subgoal-writer.js";
import { parseObjectIdentifier, resolveShortId } from "./object-identifier.js";
import { carrierCoherenceMessage } from "./coherence-report.js";
import { summaryLimitIssue } from "./summary-limit.js";


const SPARK_TYPE_KEY = "spark";

export const SPARK_DIRECTORY = "sparks";

const BODY_H2_REQUIRED = ["当前理解", "调查问题", "调查边界"];
const BODY_H2_EVOLUTION = "演变";

const STATUSES = new Set(["open", "implemented", "discarded"]);

const SPARK_RELATION_KEYS = new Set(["merged-into", "split-into"]);

const MAX_REFS_ENTRIES = 10;

const OBJECT_UID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "question", "scope_boundary", "intent", "summary",
  "evolution", "serves", "refs", "priority", "disposition", "relations", "change_log",
]);

const PRIORITY_VALUES = new Set(["P0", "P1", "P2", "P3"]);

export const SPARK_REMOVABLE_FIELDS = new Set(["priority", "refs", "serves"]);

const MAX_EVOLUTION_ENTRIES = 20;

const MAX_TITLE_LENGTH = 30;

const MAX_DISPOSITION_LENGTH = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function failureFromChecks(checks) {
  const failed = checks.filter((check) => check !== null && check.ok === false);
  if (failed.length === 0) return null;
  const [first] = failed;
  if (failed.length === 1) return first;
  const issues = failed.flatMap((check) => {
    const own = Array.isArray(check.error.details?.issues) ? check.error.details.issues : [];
    return own.length > 0 ? own : [`${check.error.code}: ${check.error.message}`];
  });
  return {
    ok: false,
    error: {
      code: first.error.code,
      message: failed.length === 1
        ? first.error.message
        : `${first.error.message} (and ${failed.length - 1} other check(s) also failed — all reported below so one retry can fix them together)`,
      details: { ...first.error.details, issues, failed_codes: failed.map((check) => check.error.code) },
    },
  };
}

function success(value) {
  return { ok: true, value };
}


export function isSingleSentence(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  const terminals = text.match(/[。？！]/g) ?? [];
  if (terminals.length > 1) return false;
  if (terminals.length === 1) {
    const trimmed = text.trimEnd();
    if (!trimmed.endsWith(terminals[0])) return false;
  }
  return true;
}

export function validateSparkFrontmatter(frontmatter, options = {}) {
  const issues = [];

  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 20 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || frontmatter.object_uid.length === 0) {
    issues.push("object_uid: required non-empty string");
  }
  if (frontmatter.fact_type_key !== SPARK_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${SPARK_TYPE_KEY}"`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (20 §8), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }

  if (typeof frontmatter.question !== "string" || frontmatter.question.length === 0) {
    issues.push("question: required non-empty string");
  } else if (!isSingleSentence(frontmatter.question)) {
    issues.push("question: must be a single readable sentence — at most one terminal (。？！) and it must end the string (20 §8/§13)");
  }

  for (const field of ["scope_boundary", "intent", "summary"]) {
    if (typeof frontmatter[field] !== "string" || frontmatter[field].length === 0) {
      issues.push(`${field}: required non-empty string`);
    }
  }

  if (typeof frontmatter.summary === "string" && frontmatter.summary.length > 0) {
    const limitIssue = summaryLimitIssue(frontmatter.summary, { clause: "20 §8" });
    if (limitIssue !== null && options?.skipSummaryLimit !== true) issues.push(limitIssue);
  }

  if (frontmatter.serves !== undefined) {
    if (typeof frontmatter.serves !== "string" || !UUID_PATTERN.test(frontmatter.serves)) {
      issues.push(`serves: must be a SubGoal object_uid (canonical UUIDv4, 28 §12.3), got ${JSON.stringify(frontmatter.serves)}`);
    }
  }

  if (frontmatter.refs !== undefined) {
    if (!Array.isArray(frontmatter.refs)) {
      issues.push("refs: must be an array of {object_uid}");
    } else if (frontmatter.refs.length === 0) {
      issues.push("refs: must be omitted when there is no association — an empty array fabricates a conditional field (03 §6.1)");
    } else {
      if (frontmatter.refs.length > MAX_REFS_ENTRIES) {
        issues.push(`refs: exceeds the ${MAX_REFS_ENTRIES}-entry cap (20 §8)`);
      }
      const seenTargets = new Set();
      for (const entry of frontmatter.refs) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          issues.push("refs[]: members must be objects of shape {object_uid}");
          continue;
        }
        const extra = Object.keys(entry).filter((k) => k !== "object_uid");
        if (extra.length > 0) {
          issues.push(`refs[]: entry carries fields beyond object_uid (${extra.join(", ")}) — 03 §7.2 keeps target title/explanation out of the carrier`);
        }
        const target = entry.object_uid;
        if (typeof target !== "string" || !OBJECT_UID_PATTERN.test(target)) {
          issues.push(`refs[].object_uid: must be a canonical UUIDv4 object_uid, got ${JSON.stringify(target)}`);
          continue;
        }
        if (seenTargets.has(target)) {
          issues.push(`refs[]: duplicate target ${target} (03 §7.2 invariant 3 — no synonymous duplicates)`);
        }
        seenTargets.add(target);
      }
    }
  }


  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")}`);
  }

  if (frontmatter.status === "open" && frontmatter.priority === undefined) {
    issues.push(
      "priority: required when status=open (20 §8 — 悬置必须带处置档位；AI 出初值, Human 可调整)",
    );
  }
  if (frontmatter.priority !== undefined) {
    if (
      typeof frontmatter.priority !== "string" ||
      !PRIORITY_VALUES.has(frontmatter.priority)
    ) {
      issues.push(
        `priority: must be one of ${[...PRIORITY_VALUES].join("/")}, got ${JSON.stringify(frontmatter.priority)}`,
      );
    }
    if (frontmatter.status !== "open") {
      issues.push(
        `priority: may appear only while status=open (20 §8 — 终态必须省略), got status=${JSON.stringify(frontmatter.status)}`,
      );
    }
  }

  if (frontmatter.evolution !== undefined) {
    if (!Array.isArray(frontmatter.evolution)) {
      issues.push("evolution: must be an array of {at, summary}");
    } else {
      if (frontmatter.evolution.length === 0) {
        issues.push("evolution: must be omitted when there are no pivot entries — an empty array fabricates a conditional field (03 §6.1)");
      }
      if (frontmatter.evolution.length > MAX_EVOLUTION_ENTRIES) {
        issues.push(`evolution: exceeds the ${MAX_EVOLUTION_ENTRIES}-entry cap (20 §8)`);
      }
      for (const e of frontmatter.evolution) {
        if (typeof e !== "object" || e === null) {
          issues.push("evolution[]: members must be objects");
          continue;
        }
        const extra = Object.keys(e).filter((k) => k !== "at" && k !== "summary");
        if (extra.length > 0) issues.push(`evolution[]: unexpected field(s) ${extra.join(", ")} (only at/summary, 20 §8)`);
        if (typeof e.at !== "string" || e.at.length === 0) issues.push("evolution[].at: required non-empty");
        if (typeof e.summary !== "string" || e.summary.length === 0) issues.push("evolution[].summary: required non-empty");
      }
    }
  }

  if (frontmatter.status === "open") {
    if (frontmatter.disposition !== undefined) {
      issues.push("disposition: must not be present when status=open (20 §8: 出现 ⇔ 终态)");
    }
  } else {
    if (typeof frontmatter.disposition !== "string" || frontmatter.disposition.length === 0) {
      issues.push("disposition: required non-empty when status is implemented/discarded (20 §8/§14.1)");
    } else if (frontmatter.disposition.length > MAX_DISPOSITION_LENGTH) {
      issues.push(`disposition: must be ≤ ${MAX_DISPOSITION_LENGTH} characters (20 §9.1), got ${frontmatter.disposition.length}`);
    }
  }

  if (Array.isArray(frontmatter.change_log)) {
    for (const [i, entry] of frontmatter.change_log.entries()) {
      if (typeof entry !== "object" || entry === null) continue;
      if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
        issues.push(`change_log[${i}].summary: required non-empty (02 §10.5: 摘要缺失或为空时，写入不成立)`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

export function validateSparkRelations(frontmatter, selfUid = null) {
  const issues = [];
  const relations = frontmatter.relations;
  if (relations === undefined) return { ok: true, issues };
  if (!Array.isArray(relations)) {
    issues.push("relations: must be an array (03 §7.2)");
    return { ok: false, issues };
  }
  if (relations.length === 0) {
    issues.push("relations: when present must be non-empty (20 §11)");
    return { ok: false, issues };
  }

  if (frontmatter.status !== "discarded") {
    issues.push(`relations: merged-into/split-into may only appear on status=discarded, got status=${JSON.stringify(frontmatter.status)} (20 §11)`);
  }

  const seen = new Set();
  const keysSeen = new Set();
  let mergedCount = 0;
  for (const rel of relations) {
    if (typeof rel !== "object" || rel === null) {
      issues.push("relations[]: members must be objects");
      continue;
    }
    const relExtra = Object.keys(rel).filter((k) => k !== "relation_key" && k !== "target");
    if (relExtra.length > 0) {
      issues.push(`relations[]: entry carries fields beyond relation_key/target (${relExtra.join(", ")}) — 03 §7.2 minimal shape`);
    }

    const key = rel.relation_key;
    if (typeof key !== "string" || !SPARK_RELATION_KEYS.has(key)) {
      issues.push(`relations[]: relation_key ${JSON.stringify(key)} not in closed set {merged-into, split-into} (20 §11)`);
      continue;
    }
    keysSeen.add(key);

    const target = rel.target;
    if (typeof target !== "object" || target === null || typeof target.object_uid !== "string" || !UUID_PATTERN.test(target.object_uid)) {
      issues.push(`relations[]: target.object_uid must be a canonical UUID (03 §7.2); got ${JSON.stringify(target?.object_uid)}`);
      continue;
    }
    const targetExtra = Object.keys(target).filter((k) => k !== "object_uid");
    if (targetExtra.length > 0) {
      issues.push(`relations[]: target carries fields beyond object_uid (${targetExtra.join(", ")}) — 03 §7.2 minimal shape`);
    }

    if (selfUid !== null && target.object_uid === selfUid) {
      issues.push(`relations[]: ${key} target must not be the object itself (20 §11)`);
    }

    if (key === "merged-into") mergedCount += 1;

    const dedupe = `${key}::${target.object_uid}`;
    if (seen.has(dedupe)) issues.push(`relations[]: duplicate relation ${key} → ${target.object_uid}`);
    seen.add(dedupe);
  }

  if (keysSeen.has("merged-into") && keysSeen.has("split-into")) {
    issues.push("relations[]: merged-into and split-into must not be mixed on one object (20 §9.3 — a spark is either merged or split)");
  }
  if (keysSeen.has("merged-into") && mergedCount !== 1) {
    issues.push(`relations[]: merged-into has cardinality 1 (20 §11), got ${mergedCount}`);
  }

  return { ok: issues.length === 0, issues };
}

function relationTargetUids(frontmatter, selfUid) {
  const uids = [];
  for (const rel of frontmatter.relations ?? []) {
    const uid = rel?.target?.object_uid;
    if (typeof uid === "string" && uid !== selfUid) uids.push(uid);
  }
  return uids;
}


export async function readServableSubGoals(factSourceRoot) {
  const listed = await listResolvableSubGoals(factSourceRoot);
  if (!listed.ok) return { ok: false, reason: listed.error?.message ?? "cannot read subgoal carriers" };
  return { ok: true, subGoals: listed.value.items };
}

export async function resolveRefsTargets(factSourceRoot, refs) {
  if (!Array.isArray(refs) || refs.length === 0) return { ok: true, resolved: new Map() };

  const dirs = [
    ["spark", SPARK_DIRECTORY],
    ["pitfall", "pitfalls"],
    ["report", "reports"],
    ["friction", "frictions"],
    ["norm", "norms"],
    ["subgoal", "subgoals"],
  ];

  const index = new Map();
  for (const [type, dir] of dirs) {
    const abs = join(factSourceRoot, dir);
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(md|yaml|yml)$/.test(entry.name)) continue;
      const raw = await readFile(join(abs, entry.name), "utf8").catch(() => null);
      if (raw === null) continue;
      const uidMatch = raw.match(/^object_uid:\s*["']?([0-9a-fA-F-]{36})["']?\s*$/m);
      if (!uidMatch) continue;
      const titleMatch = raw.match(/^title:\s*["']?(.*?)["']?\s*$/m);
      index.set(uidMatch[1].toLowerCase(), {
        type,
        title: titleMatch ? titleMatch[1] : undefined,
      });
    }
  }

  const resolved = new Map();
  const missing = [];
  for (const entry of refs) {
    const uid = typeof entry === "string"
      ? entry
      : (entry?.object_uid ?? entry?.target?.object_uid);
    if (typeof uid !== "string") continue;
    const hit = index.get(uid.toLowerCase());
    if (hit === undefined) missing.push(uid);
    else resolved.set(uid, hit);
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason: `refs target(s) not resolvable in this project: ${missing.join(", ")} (03 §7.2 — targets must be existing, readable, same-project fact objects)`,
    };
  }
  return { ok: true, resolved };
}



export function validateSparkBodyStructure(body, title, evolutionCount) {
  const issues = [];
  const expectedH2 = [...BODY_H2_REQUIRED];
  const expectEvolution = evolutionCount > 0;
  if (expectEvolution) expectedH2.push(BODY_H2_EVOLUTION);

  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  if (firstNonEmpty.trimEnd().replace(/^ {0,3}/, "").replace(/(?<=^#+)[ \t]+/, " ") !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 20 §8)`);
  }
  const h1Count = countAtxHeadings(body, 1);
  if (h1Count !== 1) {
    issues.push(`body: expected exactly 1 H1 heading, found ${h1Count} (20 §8: H1 由 Code 从 title 生成，正文自 H2 起)`);
  }

  const h2 = h2Titles(body);
  if (h2.length !== expectedH2.length) {
    issues.push(`body: expected ${expectedH2.length} H2 sections (${expectedH2.join(" / ")}), found ${h2.length} (${h2.join(" / ")})`);
  } else {
    for (let i = 0; i < expectedH2.length; i++) {
      if (h2[i] !== expectedH2[i]) {
        issues.push(`body: H2 #${i + 1} expected "${expectedH2[i]}", found "${h2[i]}"`);
      }
    }
  }

  const sections = body.split(/^## /m).slice(1);
  for (const sec of sections) {
    const secTitle = sec.split("\n")[0].trim();
    const content = sec.slice(sec.indexOf("\n") + 1).trim();
    if (content.length === 0) issues.push(`body: section "${secTitle}" is empty`);
  }

  const hasEvolutionH2 = h2.includes(BODY_H2_EVOLUTION);
  if (hasEvolutionH2 !== expectEvolution) {
    issues.push(`body: "## 演变" section presence (${hasEvolutionH2}) must match a non-empty evolution array (${expectEvolution}) — 20 §8 条件出现`);
  }

  return { ok: issues.length === 0, issues };
}

export function validateCarrierCoherence(frontmatter, body) {
  const warnings = [];
  const pairs = [
    ["question", "调查问题"],
    ["scope_boundary", "调查边界"],
    ["summary", "当前理解"],
  ];
  for (const [field, section] of pairs) {
    const text = typeof frontmatter[field] === "string" ? frontmatter[field].trim() : "";
    if (text.length === 0) continue;
    const content = sectionContent(body, section);
    if (content === null) continue;
    if (!content.includes(text)) {
      warnings.push(carrierCoherenceMessage({
        section, field, declared: text, actual: content, clause: "20 §14.1",
      }));
    }
  }
  return { ok: true, issues: [], warnings };
}


export function sparkFileName(uid) { return `spark-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, SPARK_DIRECTORY, sparkFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

const FRONTMATTER_FIELD_ORDER = [
  "title", "status",
  "question", "scope_boundary", "intent", "summary",
  "evolution", "serves", "priority",
  "disposition", "relations",
  "object_uid", "fact_type_key", "created_at",
  "change_log",
];

function orderFrontmatterFields(frontmatter) {
  const ordered = {};
  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (key in frontmatter) ordered[key] = frontmatter[key];
  }
  for (const key of Object.keys(frontmatter)) {
    if (!(key in ordered)) ordered[key] = frontmatter[key];
  }
  return ordered;
}

async function atomicWriteFile(filePath, content) {
  const tmp = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, content, "utf8");
  const written = await readFile(tmp, "utf8");
  if (written !== content) {
    await unlink(tmp).catch(() => {});
    throw new Error("atomic write verification failed: written content does not match");
  }
  await rename(tmp, filePath);
}

function assertValidUid(objectUid) {
  return typeof objectUid === "string" && UUID_PATTERN.test(objectUid);
}

function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.trim()}`;
}



const PRECHECK_PLACEHOLDER_UID = "00000000-0000-4000-8000-000000000000";

export function computeSparkCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown) {
  const { status: _statusStripped, ...draftFields } = frontmatterDraft ?? {};
  const candidate = {
    frontmatter_draft: draftFields,
    body_markdown: typeof bodyMarkdown === "string" ? bodyMarkdown : null,
  };
  return createHash("sha256").update(stableStringify(candidate), "utf8").digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export async function precheckSparkCreate({ factSourceRoot, frontmatterDraft, bodyMarkdown, dedupResult }) {
  const candidateFingerprint = computeSparkCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown);
  if (typeof dedupResult !== "string" || dedupResult.trim().length === 0) {
    return success({
      mechanical_outcome: "unverifiable",
      candidate_fingerprint: candidateFingerprint,
      issues: ["dedup_result is required for a Spark create precheck (20 §13: 预检须包含 create 入口对 dedup_result 的必填检查)"],
      error_code: "spark/dedup_result_required",
      error_message: "dedup_result is required for a Spark create precheck",
    });
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return success({
      mechanical_outcome: "unverifiable",
      candidate_fingerprint: candidateFingerprint,
      issues: ["body_markdown is required (starting with '## 当前理解'; the H1 is generated from title)"],
      error_code: "invalid_request",
      error_message: "bodyMarkdown is required",
    });
  }
  const evaluated = await evaluateSparkCreateCandidate({
    factSourceRoot,
    frontmatterDraft,
    bodyMarkdown,
    signature: { provider: "(precheck)", model: "(precheck)" },
    objectUid: PRECHECK_PLACEHOLDER_UID,
    createdAt: new Date(0).toISOString(),
  });
  if (!evaluated.ok) {
    const code = evaluated.error.code;
    const issues = Array.isArray(evaluated.error.details?.issues) ? evaluated.error.details.issues : [];
    return success({
      mechanical_outcome: code === "invalid_request" ? "unverifiable" : "failed",
      candidate_fingerprint: candidateFingerprint,
      error_code: code,
      error_message: evaluated.error.message,
      issues: issues.length > 0 ? issues : [evaluated.error.message],
    });
  }
  return success({
    mechanical_outcome: "passed",
    candidate_fingerprint: candidateFingerprint,
    issues: [],
    object_uid: null,
  });
}

async function evaluateSparkCreateCandidate({
  factSourceRoot, frontmatterDraft, bodyMarkdown, signature, objectUid, createdAt,
}) {
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = objectUid;
  frontmatter.fact_type_key = SPARK_TYPE_KEY;
  frontmatter.created_at = createdAt;
  if (frontmatter.status !== undefined && frontmatter.status !== "open") {
    return failure("spark/initial_state_violation", `create must initialise as status=open; got ${JSON.stringify(frontmatter.status)} (20 §9)`);
  }
  frontmatter.status = "open";
  if (frontmatter.disposition !== undefined) {
    return failure("spark/frontmatter_invalid", "create must not carry disposition (20 §8: disposition ⇔ terminal status; create is always open)");
  }
  if (frontmatter.relations !== undefined) {
    return failure("spark/frontmatter_invalid", "create must not carry relations (20 §11: merged-into/split-into only attach to a discarded transition)");
  }
  frontmatter.change_log = [{
    at: createdAt,
    ...signature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Spark 对象",
  }];

  const fmCheck = validateSparkFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("spark/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateSparkRelations(frontmatter, objectUid);
  if (!relCheck.ok) {
    return failure("spark/relations_invalid", "relations failed mechanical checks", { issues: relCheck.issues });
  }

  if (frontmatter.serves !== undefined) {
    const resolved = await resolveSubGoal(factSourceRoot, frontmatter.serves);
    if (!resolved.ok) {
      return failure("spark/serves_unresolvable", resolved.error?.message ?? `serves ${frontmatter.serves} cannot be resolved (28 §12.3)`);
    }
  }

  if (frontmatter.refs !== undefined) {
    const refsCheck = await resolveRefsTargets(factSourceRoot, frontmatter.refs);
    if (!refsCheck.ok) {
      return failure("spark/refs_unresolvable", refsCheck.reason, { missing: refsCheck.missing });
    }
  }

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const evolutionCount = Array.isArray(frontmatter.evolution) ? frontmatter.evolution.length : 0;
  const bodyCheck = validateSparkBodyStructure(body, frontmatter.title, evolutionCount);
  if (!bodyCheck.ok) {
    return failure("spark/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }

  return success({ frontmatter, body });
}

export async function createSparkObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null, dryRun = false,
    expectedCandidateFingerprint = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 当前理解'; the H1 is generated from title)");
  }

  const uid = dryRun === true ? PRECHECK_PLACEHOLDER_UID : randomUUID();
  const now = dryRun === true ? new Date(0).toISOString() : new Date().toISOString();
  if (dryRun !== true) {
    if (typeof expectedCandidateFingerprint !== "string" || expectedCandidateFingerprint.length === 0) {
      return failure(
        "spark/candidate_fingerprint_required",
        "expected_candidate_fingerprint is required for create (20 §13: 未携带时按「同一性未确认」零写入) — "
          + "run ldvh_spark_precheck_create on this candidate first and pass the candidate_fingerprint it returns",
      );
    }
    const actualCandidateFingerprint = computeSparkCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown);
    if (actualCandidateFingerprint !== expectedCandidateFingerprint) {
      return failure(
        "spark/candidate_changed",
        "the candidate content changed between precheck and write; the precheck verdict does not carry over (20 §13) — re-run the precheck on the current content",
        { expected_candidate_fingerprint: expectedCandidateFingerprint, actual_candidate_fingerprint: actualCandidateFingerprint },
      );
    }
  }

  const evaluated = await evaluateSparkCreateCandidate({
    factSourceRoot,
    frontmatterDraft,
    bodyMarkdown,
    signature: sig.signature,
    objectUid: uid,
    createdAt: now,
  });
  if (!evaluated.ok) return evaluated;

  const { frontmatter, body } = evaluated.value;

  if (dryRun === true) {
    return success({ dry_run: true, body });
  }

  const typeDir = join(factSourceRoot, SPARK_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  const fingerprint = fileFingerprint(content);
  return success({ object_uid: uid, file: filePath, fingerprint });
}


async function resolveSparkObjectUid(factSourceRoot, input, currentProjectId = null) {
  const parsed = parseObjectIdentifier(input);
  if (!parsed.ok) {
    return { ok: false, error: failure("spark/invalid_uid", `${parsed.error.code}: ${parsed.error.message}`) };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  if (projectId !== undefined && currentProjectId !== null && projectId !== currentProjectId) {
    return { ok: false, error: failure("spark/invalid_uid", `foreign_project: identifier targets project "${projectId}", but this session is governed by "${currentProjectId}" — cross-project reads are not supported by this entry`) };
  }
  if (objectUid !== undefined) {
    if (declaredType !== undefined && declaredType !== "spark") {
      return { ok: false, error: failure("spark/invalid_uid", `type_prefix_mismatch: identifier declares type "${declaredType}", but this entry reads "spark" objects`) };
    }
    return { ok: true, objectUid };
  }
  const resolved = await resolveShortId({ factSourceRoot, shortId, declaredType: declaredType ?? "spark" });
  if (!resolved.ok) {
    const extra = resolved.error.candidates === undefined ? "" : `; candidates: ${resolved.error.candidates.join(", ")}`;
    return { ok: false, error: failure("spark/invalid_uid", `${resolved.error.code}: ${resolved.error.message}${extra}`) };
  }
  if (resolved.value.factTypeKey !== "spark") {
    return { ok: false, error: failure("spark/invalid_uid", `type_prefix_mismatch: short id "${shortId}" resolves to a ${resolved.value.factTypeKey} object, but this entry reads "spark" objects`) };
  }
  return { ok: true, objectUid: resolved.value.objectUid };
}

export async function readSparkObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, currentProjectId = null } = args;
  const uidResolution = await resolveSparkObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
  const filePath = objectFilePath(factSourceRoot, objectUid);

  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    return failure("spark/object_not_found", `cannot read object file: ${error.message}`);
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("spark/object_invalid", "file has no YAML frontmatter block");
  }

  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("spark/object_invalid", `frontmatter parse error: ${error.message}`);
  }

  const body = content.slice(fmMatch[0].length).trim();
  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const evolutionCount = Array.isArray(frontmatter.evolution) ? frontmatter.evolution.length : 0;
  const structure = validateSparkBodyStructure(body, title, evolutionCount);

  return success({
    object_uid: objectUid,
    file: filePath,
    frontmatter,
    body,
    body_valid: structure.ok,
    body_issues: structure.issues,
    fingerprint: fileFingerprint(content),
  });
}


export async function listSparkObjects(args) {
  const { factSourceRoot, includeTerminal = false, limit = 200, keyword = null, priorities = null, serves = null } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }
  if (keyword !== null && (typeof keyword !== "string" || keyword.trim().length === 0)) {
    return failure("invalid_request", "keyword must be a non-empty string when provided");
  }
  const needle = keyword === null ? null : keyword.trim().toLowerCase();
  if (priorities !== null) {
    if (!Array.isArray(priorities) || priorities.length === 0) {
      return failure("invalid_request", "priorities must be a non-empty array when provided");
    }
    for (const value of priorities) {
      if (!PRIORITY_VALUES.has(value)) {
        return failure("invalid_request", `priorities: must be among ${[...PRIORITY_VALUES].join("/")}, got ${JSON.stringify(value)}`);
      }
    }
  }
  const prioritySet = priorities === null ? null : new Set(priorities);
  if (serves !== null && (typeof serves !== "string" || serves.trim().length === 0)) {
    return failure("invalid_request", "serves must be a non-empty string when provided");
  }
  const servesNeedle = serves === null ? null : serves.trim();

  const typeDir = join(factSourceRoot, SPARK_DIRECTORY);
  let scanned;
  try {
    scanned = await scanCarrierDirectory(typeDir, "spark");
  } catch (error) {
    return failure("spark/directory_unavailable", `cannot read sparks directory: ${error.message}`);
  }
  if (scanned.missing) {
    return success({
      items: [],
      total: 0,
      complete: true,
      invalid: [],
      filters: {
        status: includeTerminal ? "all" : "open",
        keyword: needle === null ? null : keyword.trim(),
        priorities: priorities === null ? null : [...priorities],
        serves: servesNeedle,
      },
    });
  }

  const invalid = [...scanned.invalid];
  const items = [];
  for (const carrier of scanned.carriers) {
    const uid = carrier.uid;
    const content = carrier.content;
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) {
      invalid.push({ file: carrier.file, reason: "no YAML frontmatter block" });
      continue;
    }
    let frontmatter;
    try {
      frontmatter = parseYaml(fmMatch[1]);
    } catch (error) {
      invalid.push({ file: carrier.file, reason: `frontmatter parse error: ${error.message}` });
      continue;
    }
    const status = frontmatter.status;
    if (!STATUSES.has(status)) {
      invalid.push({ file: carrier.file, reason: `status ${JSON.stringify(status)} outside the closed set` });
      continue;
    }
    if (!includeTerminal && status !== "open") continue;
    const hitParts = [];
    if (prioritySet !== null) {
      if (!prioritySet.has(frontmatter.priority)) continue;
      hitParts.push(`priority=${frontmatter.priority}`);
    }
    if (servesNeedle !== null) {
      if (frontmatter.serves !== servesNeedle) continue;
      hitParts.push(`serves=${servesNeedle}`);
    }
    if (needle !== null) {
      const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
      const question = typeof frontmatter.question === "string" ? frontmatter.question : "";
      const inTitle = title.toLowerCase().includes(needle);
      const inQuestion = question.toLowerCase().includes(needle);
      if (!inTitle && !inQuestion) continue;
      const where = [
        inTitle ? "title" : null,
        inQuestion ? "question" : null,
      ].filter((part) => part !== null).join("+");
      hitParts.push(`keyword=${JSON.stringify(keyword.trim())}@${where}`);
    }
    const hitReason = hitParts.length > 0 ? hitParts.join(" · ") : undefined;
    const refsProjection = Array.isArray(frontmatter.refs) && frontmatter.refs.length > 0
      ? await (async () => {
        const check = await resolveRefsTargets(factSourceRoot, frontmatter.refs);
        return frontmatter.refs
          .map((entry) => {
            const refUid = typeof entry === "string" ? entry : entry?.object_uid;
            if (typeof refUid !== "string") return null;
            const hit = check.resolved?.get(refUid);
            return hit ? { object_uid: refUid, fact_type_key: hit.type } : { object_uid: refUid };
          })
          .filter((entry) => entry !== null);
      })()
      : undefined;
    items.push({
      object_uid: uid,
      fact_type_key: typeof frontmatter.fact_type_key === "string" ? frontmatter.fact_type_key : SPARK_TYPE_KEY,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      question: typeof frontmatter.question === "string" ? frontmatter.question : "",
      serves: typeof frontmatter.serves === "string" ? frontmatter.serves : undefined,
      refs: refsProjection,
      priority: typeof frontmatter.priority === "string" ? frontmatter.priority : undefined,
      hitReason,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({
    items: projected,
    total: items.length,
    complete,
    invalid,
    filters: {
      status: includeTerminal ? "all" : "open",
      keyword: keyword === null ? null : keyword.trim(),
      priorities: priorities === null ? null : [...priorities],
      serves: servesNeedle,
    },
  });
}


export async function updateSparkObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, frontmatterRemovals = null, bodyMarkdownAfter, changeSummary, sessionSignature = null,
    dryRun = false,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("spark/change_summary_required", "changeSummary is required for update");
  }
  if (!assertValidUid(objectUid)) {
    const hint = uidRejectionHint(objectUid);
    return failure("spark/invalid_uid", `objectUid must be a valid UUID${hint.messageSuffix}`, hint.details);
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 当前理解')");
  }

  const current = await readSparkObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("spark/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  const prevStatus = current.value.frontmatter.status;
  const prevTerminal = prevStatus === "implemented" || prevStatus === "discarded";
  if (prevTerminal) {
    const requested = frontmatterAfter?.status;
    if (requested !== undefined && requested !== prevStatus) {
      return failure("spark/status_terminal", `status=${prevStatus} is terminal; reopen (status=${requested}) is forbidden (20 §9.2) — content correction is allowed, status reversal is not; later unresolved info belongs to a NEW open Spark`);
    }
  }

  const built = buildUpdateFrontmatter({
    currentFrontmatter: current.value.frontmatter,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: SPARK_REMOVABLE_FIELDS,
    typeLabel: "spark",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const fm = built.value;
  fm.object_uid = objectUid;
  fm.fact_type_key = SPARK_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("spark/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (open/implemented/discarded, 20 §9)`);
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  const summaryUnchanged = typeof fm.summary === "string"
    && typeof current.value.frontmatter.summary === "string"
    && fm.summary === current.value.frontmatter.summary;
  const fmCheck = validateSparkFrontmatter(fm, { skipSummaryLimit: summaryUnchanged });
  const relCheck = validateSparkRelations(fm, objectUid);

  const servesCheck = (fm.serves !== undefined && fm.serves !== current.value.frontmatter.serves)
    ? await resolveSubGoal(factSourceRoot, fm.serves).then((resolved) => (resolved.ok
      ? null
      : failure("spark/serves_unresolvable", resolved.error?.message ?? `serves ${fm.serves} cannot be resolved (28 §12.3)`)))
    : null;

  const refsCheck = fm.refs !== undefined
    ? await resolveRefsTargets(factSourceRoot, fm.refs)
      .then((checked) => (checked.ok ? null : failure("spark/refs_unresolvable", checked.reason, { missing: checked.missing })))
    : null;

  const validationFailure = failureFromChecks([
    fmCheck.ok ? null : failure("spark/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues }),
    relCheck.ok ? null : failure("spark/relations_invalid", "updated relations failed mechanical checks", { issues: relCheck.issues }),
    servesCheck,
    refsCheck,
  ]);
  if (validationFailure !== null) return validationFailure;

  const prevRelUids = new Set(relationTargetUids(current.value.frontmatter, objectUid));
  for (const targetUid of relationTargetUids(fm, objectUid)) {
    if (prevRelUids.has(targetUid)) continue;
    const targetRead = await readSparkObject({ factSourceRoot, objectUid: targetUid });
    if (!targetRead.ok) {
      return failure("spark/relation_target_unresolvable", `${targetUid} does not resolve to an existing Spark object: ${targetRead.error.message}`);
    }
    if (targetRead.value.frontmatter.status !== "open") {
      return failure("spark/relation_target_unresolvable", `${targetUid} is status=${targetRead.value.frontmatter.status}, not open — merge/split targets must be open at write time (20 §11 write-precondition)`);
    }
  }

  const body = assembleBody(fm.title, bodyMarkdownAfter);
  const evolutionCount = Array.isArray(fm.evolution) ? fm.evolution.length : 0;
  const bodyCheck = validateSparkBodyStructure(body, fm.title, evolutionCount);
  if (!bodyCheck.ok) {
    return failure("spark/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }

  if (dryRun === true) {
    return success({ object_uid: objectUid, dry_run: true });
  }

  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}

export { VALID_FM_KEYS };
