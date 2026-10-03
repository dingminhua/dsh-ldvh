/**
 * dsh-ldvh — Spark fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/20 §13 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:  flat single-file carrier
 *             (ldvh-base/sparks/spark-<uid>.md) with YAML frontmatter +
 *             markdown body. Code assigns object_uid + created_at and
 *             generates the H1 from title; creation validates the
 *             type-specific mechanical checks (closed sets, question
 *             single-sentence, scope_boundary presence, fixed H2 sections,
 *             serves ↔ goal.md SG-n, carrier coherence).
 *  - read:    returns frontmatter + body + file-level content
 *             fingerprint (SHA-256).
 *  - update:  CAS — the caller must supply the fingerprint observed at
 *             the last read; the whole file is replaced atomically;
 *             a change_log entry is appended. Terminal states
 *             (implemented/discarded) do NOT change status (20 §9.2: 终态不可重开),
 *             but their CONTENT remains correctable — a wrong or over-long
 *             terminal record is fixed in place, never by faking a transition.
 *
 *             （2026-09-27 更正：本行原写「Terminal states are read-only」，
 *             与 20 §9.2「终态不可重开，但内容可更正」（Human 决定 2026-09-13）
 *             及本文件的实现都不一致——`updateSparkObject` 只在 status 被改动时
 *             拒绝，其余字段照常可更正。原文是 §9.2 修订前的旧语义残留。）
 *
 * Status model (20 §9): open → implemented | discarded only; create
 * always initialises open. disposition ⇔ terminal status. Relations
 * (merged-into / split-into) only on discarded, targets must resolve to
 * existing *open* sparks (20 §11).
 *
 * Carrier coherence (writer-level convention, 24 §8 invariant-10
 * precedent): frontmatter question / scope_boundary / summary are the
 * single authoritative texts — the 调查问题 / 调查边界 / 当前理解 body
 * sections must contain them verbatim and expand around them.
 *
 * Red lines honoured (20 §18): no second fact authority, no spark
 * index/copy — change_log lives inside the file's frontmatter.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { h2Titles, countAtxHeadings, sectionContent } from "./markdown-structure.js";
import { readGoalAnchors as readGoalAnchorsFromGoal } from "./goal-writer.js";

// ---------------------------------------------------------------------------
// Constants (specs/20 §7, §8, §9, §11)
// ---------------------------------------------------------------------------

const SPARK_TYPE_KEY = "spark";

/** Directory under the fact-source root that carries Spark objects. */
export const SPARK_DIRECTORY = "sparks";

/** Fixed body H2 sections (20 §8); 演变 is conditional on evolution. */
const BODY_H2_REQUIRED = ["当前理解", "调查问题", "调查边界"];
const BODY_H2_EVOLUTION = "演变";

const STATUSES = new Set(["open", "implemented", "discarded"]);

/** Relation keys allowed for Spark (20 §11 — closed set of exactly two). */
const SPARK_RELATION_KEYS = new Set(["merged-into", "split-into"]);

/** serves anchor shape (25 §6: SG-n, frozen, never renumbered). */
const SG_ANCHOR_PATTERN = /^SG-[1-9]\d*$/;

/**
 * refs entry cap (20 §8). Bounds the F1 card projection — the field exists so
 * a Human can scan "what is this spark related to" on the list card, so an
 * unbounded list would defeat its own purpose (03 §15 item 9: no value
 * self-declaration through association volume).
 */
const MAX_REFS_ENTRIES = 10;

/** object_uid shape accepted in refs targets (03 §6.1: canonical UUIDv4). */
const OBJECT_UID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Closed set of frontmatter keys (20 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "question", "scope_boundary", "intent", "summary",
  "evolution", "serves", "refs", "priority", "disposition", "relations", "change_log",
]);

/** priority closed set (20 §8: P0–P3; AI 出初值，Human 可调整). */
const PRIORITY_VALUES = new Set(["P0", "P1", "P2", "P3"]);

/** Evolution cap (20 §8: 上限 20 项). */
const MAX_EVOLUTION_ENTRIES = 20;

/** Title cap (20 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/** Terminal-reason cap (20 §8/§9.1: disposition ≤ 200 字符). */
const MAX_DISPOSITION_LENGTH = 200;

/** UUID format check (03 §6.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Validation (the mechanical slice of specs/20 §8, §13, §14.1)
// ---------------------------------------------------------------------------

/**
 * question 单句可读 (20 §8/§13): at most one sentence-terminal character
 * (。？！) and, when present, it must end the string. Purely mechanical —
 * semantic readability stays in AI/Human review scope.
 */
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

export function validateSparkFrontmatter(frontmatter) {
  const issues = [];

  // Closed-set check (20 §8): unknown fields reject the object
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

  // serves shape; goal.md resolution happens in the create/update flows
  // (needs the fact source root; 20 §13: 若声明，匹配 goal.md 存在的 SG-n).
  if (frontmatter.serves !== undefined) {
    if (typeof frontmatter.serves !== "string" || !SG_ANCHOR_PATTERN.test(frontmatter.serves)) {
      issues.push(`serves: must match SG-n (e.g. SG-4), got ${JSON.stringify(frontmatter.serves)}`);
    }
  }

  // refs (20 §8, 03 §7.2 关联引用型): array of {object_uid} targets. Shape is
  // checked here; target *resolution* (exists / readable / same project)
  // needs the fact-source root and happens in the create/update flows, same
  // split as serves ↔ goal.md. 03 §6.1: an empty array fabricates a
  // conditional field and is rejected.
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
        // 03 §7.2 minimal shape: target reference only. No title copies.
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

  // refs is state-neutral (20 §8): terminal sparks keep their historical
  // references — an association is a fact about the past and does not expire
  // when the spark closes. No status gate is applied here.

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")}`);
  }

  // priority closed set + state exclusivity (20 §8 字段间不变量):
  //   闭集 P0–P3；仅 status=open 时允许出现，终态必须省略；允许缺失（未分档）。
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

  // evolution (20 §8): array of {at, summary}, cap 20. 03 §6.1: a conditional
  // field must be omitted when not applicable — an empty array is rejected.
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

  // disposition ⇔ terminal status (20 §8 invariant, §14.1 终态处置完整性)
  if (frontmatter.status === "open") {
    if (frontmatter.disposition !== undefined) {
      issues.push("disposition: must not be present when status=open (20 §8: 出现 ⇔ 终态)");
    }
  } else {
    if (typeof frontmatter.disposition !== "string" || frontmatter.disposition.length === 0) {
      issues.push("disposition: required non-empty when status is implemented/discarded (20 §8/§14.1)");
    } else if (frontmatter.disposition.length > MAX_DISPOSITION_LENGTH) {
      // 20 §9.1: the terminal reason is a scannable locator, not the full
      // disposal record. Reject rather than truncate.
      issues.push(`disposition: must be ≤ ${MAX_DISPOSITION_LENGTH} characters (20 §9.1), got ${frontmatter.disposition.length}`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Validate the relations contract (20 §11 + 03 §7.2).
 *
 * Mechanical scope (20 §14.1): key closed set, minimal entry/target shape,
 * status gating (only discarded), merged-into cardinality exactly 1,
 * split-into cardinality 1..n, no key mixing, no duplicates, no
 * self-reference. Target *resolvability and open-ness* are checked by the
 * create/update flows (they need the fact source root).
 */
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

  // Status gating (20 §11): merge/split relations only on discarded sparks
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
    // 03 §7.2 minimal shape: relation_key + target only
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

  // Cardinality (20 §11): merged-into 1, split-into 1..n; never mixed
  if (keysSeen.has("merged-into") && keysSeen.has("split-into")) {
    issues.push("relations[]: merged-into and split-into must not be mixed on one object (20 §9.3 — a spark is either merged or split)");
  }
  if (keysSeen.has("merged-into") && mergedCount !== 1) {
    issues.push(`relations[]: merged-into has cardinality 1 (20 §11), got ${mergedCount}`);
  }

  return { ok: issues.length === 0, issues };
}

/** Extract the relation target uids (for flow-level resolvability checks). */
function relationTargetUids(frontmatter, selfUid) {
  const uids = [];
  for (const rel of frontmatter.relations ?? []) {
    const uid = rel?.target?.object_uid;
    if (typeof uid === "string" && uid !== selfUid) uids.push(uid);
  }
  return uids;
}

// ---------------------------------------------------------------------------
// goal.md anchor reading (20 §13: serves 必须匹配 goal.md 存在的 SG-n)
// ---------------------------------------------------------------------------

/**
 * Read the SG-n anchors from the governed project's goal.md (## 子目标
 * section). Returns { ok, anchors:Set } or { ok:false, reason } when
 * goal.md is missing/unreadable (20 §17.1: declaring serves with no
 * resolvable goal.md is a stop condition → reject at the flow level).
 */
export async function readGoalAnchors(factSourceRoot) {
  // Single authority for goal.md parsing (25 §6/§12): delegate to the Goal
  // writer rather than re-implementing the 子目标 scan here. Two copies used to
  // exist (spark + friction) and could drift from the type's own contract.
  const goal = await readGoalAnchorsFromGoal({ factSourceRoot });
  if (!goal.ok) return { ok: false, reason: goal.error?.message ?? "cannot read goal.md" };
  return { ok: true, anchors: new Set(goal.value.anchors) };
}

/**
 * Resolve `refs` targets against the fact source (03 §7.2 关联引用型, 20 §8).
 *
 * Mechanical boundary (03 §7.2): only existence, readability and same-project
 * membership are checked. Semantic relevance, target status and association
 * value stay in AI/Human judgement and are explicitly NOT decided here.
 *
 * Returns { ok:true, resolved:Map<uid,{type,title}> } or
 *         { ok:false, missing:[uid], reason }.
 *
 * Note the deliberate asymmetry with `relations`: a missing refs target is a
 * *zero-write rejection* (03 §7.2 mechanical boundary), not a silent drop —
 * dropping would make the carrier claim fewer associations than were declared.
 */
export async function resolveRefsTargets(factSourceRoot, refs) {
  if (!Array.isArray(refs) || refs.length === 0) return { ok: true, resolved: new Map() };

  const dirs = [
    ["spark", SPARK_DIRECTORY],
    ["workcase", "workcases"],
    ["adr", "adrs"],
    ["pitfall", "pitfalls"],
    ["research", "researches"],
    ["friction", "frictions"],
    ["norm", "norms"],
  ];

  // Build an index of uid -> {type, title} by scanning the same-project fact
  // directories once. Files are small and this runs only on write paths that
  // already touch the fact source.
  const index = new Map();
  for (const [type, dir] of dirs) {
    const abs = join(factSourceRoot, dir);
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      continue; // directory absent = type not integrated in this project
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
    const uid = typeof entry === "string" ? entry : entry?.object_uid;
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

// ---------------------------------------------------------------------------
// Body structure + carrier coherence
// ---------------------------------------------------------------------------

// h2Titles / countAtxHeadings / sectionContent 已收敛到 markdown-structure.js
// （单一权威实现）。收敛动因：同一结构判定曾在 6 个 writer 中各自实现且语义
// 分叉——围栏内的「## 假标题」在部分实现中被当成真 H2（pitfall e8cadde1 的
// 同构复发）。各 writer 不得再各自实现结构解析。

/**
 * Validate the assembled body structure. The body passed here is the full
 * file body starting with the generated `# ${title}` H1 (20 §8 template).
 * Returns { ok, issues }.
 */
export function validateSparkBodyStructure(body, title, evolutionCount) {
  const issues = [];
  const expectedH2 = [...BODY_H2_REQUIRED];
  const expectEvolution = evolutionCount > 0;
  if (expectEvolution) expectedH2.push(BODY_H2_EVOLUTION);

  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  // Compare against the generated heading tolerating the CommonMark-legal
  // spellings of the same ATX heading (indentation, tab separator, trailing
  // spaces) — otherwise a valid carrier with trailing spaces is rejected.
  if (firstNonEmpty.trimEnd().replace(/^ {0,3}/, "").replace(/(?<=^#+)[ \t]+/, " ") !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 20 §8)`);
  }
  // Exactly one H1: the title heading is the only level-1 heading, and the body
  // starts at H2. Checking the first line alone would let an extra `# <title>`
  // further down slip through. The scan follows CommonMark ATX semantics
  // (≤3 leading spaces, space/tab after the hashes, trailing spaces allowed)
  // and skips fenced code blocks, where a `#` is literal text, not a heading.
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

  // Non-empty check for every H2 section
  const sections = body.split(/^## /m).slice(1);
  for (const sec of sections) {
    const secTitle = sec.split("\n")[0].trim();
    const content = sec.slice(sec.indexOf("\n") + 1).trim();
    if (content.length === 0) issues.push(`body: section "${secTitle}" is empty`);
  }

  // 演变 H2 presence ⇔ non-empty evolution (20 §8: 条件出现)
  const hasEvolutionH2 = h2.includes(BODY_H2_EVOLUTION);
  if (hasEvolutionH2 !== expectEvolution) {
    issues.push(`body: "## 演变" section presence (${hasEvolutionH2}) must match a non-empty evolution array (${expectEvolution}) — 20 §8 条件出现`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (writer-level convention, 24 §8 invariant-10 precedent):
 * frontmatter question / scope_boundary / summary are the single
 * authoritative texts — their body sections must contain them verbatim.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const pairs = [
    ["question", "调查问题"],
    ["scope_boundary", "调查边界"],
    ["summary", "当前理解"],
  ];
  for (const [field, section] of pairs) {
    const text = typeof frontmatter[field] === "string" ? frontmatter[field].trim() : "";
    if (text.length === 0) continue; // presence checked in validateSparkFrontmatter
    const content = sectionContent(body, section);
    if (content === null) continue; // section presence checked in body structure
    if (!content.includes(text)) {
      issues.push(`carrier coherence: ${section} section must contain ${field} verbatim (frontmatter is the single authoritative text): "${text.slice(0, 40)}…"`);
    }
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

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

/**
 * 展示层输出序（同 research-writer FRONTMATTER_FIELD_ORDER 约定）：语义块
 * 在前（标题/状态/悬置四要素/演变/归属/终态去向），引用与身份居后，
 * change_log 沉底。规范不强制书写顺序——本函数只是参考写入端的确定性
 * 输出格式：只重排键序，不新增、不删除、不改值。
 */
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
  // 闭集校验已保证无表外字段；防御性保留任何遗漏键（原序跟在表后），
  // 避免未来字段准入与书写序登记不同步时静默丢字段。
  for (const key of Object.keys(frontmatter)) {
    if (!(key in ordered)) ordered[key] = frontmatter[key];
  }
  return ordered;
}

async function atomicWriteFile(filePath, content) {
  // Random tmp suffix (F8): a deterministic `${filePath}.tmp` would let two
  // concurrent writers on the same path clobber each other's staging file.
  const tmp = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, content, "utf8");
  // Write verification: read back and compare before rename —
  // catches partial writes (disk-full at flush time, etc.)
  const written = await readFile(tmp, "utf8");
  if (written !== content) {
    await unlink(tmp).catch(() => {});
    throw new Error("atomic write verification failed: written content does not match");
  }
  await rename(tmp, filePath);
}

/**
 * 写入事实对象的载体文件 —— **优先经宿主的 fs 链路，缺入口时回退自建原子写**。
 *
 * 为什么必须走宿主（2026-10-03 实测，见 docs/experiment-a1-fs-feasibility-2026-10-03.md）：
 * 宿主的文件写入是一条**有状态的链路**——`ctx.fs.resolve` → `fs/write-intent` 门禁
 * （未观察过 ⇒ `createIfAbsent`；已观察过 ⇒ `replaceIfVersion(version)`）→
 * `ctx.fs.writeText`（每目标锁 + 原子发布）→ **由写入方 `emit('fs/observed')`
 * 更新宿主的观察记录**。
 *
 * 若绕过该链路（自建 `node:fs` 直写），宿主的观察记录**不会随 LDVH 的写入更新**：
 * 此后 agent 再用宿主 fs 工具写同一文件，会拿一个陈旧版本做 `replaceIfVersion`，
 * 表现为 `FS_STALE_VERSION` 拒绝——即「莫名写不进去」，根因是 LDVH 与宿主状态机**不合拍**。
 *
 * 与 CAS 基准的关系（重要，勿混淆）：本函数只换**写盘通道**。
 * `content_fingerprint`（SHA-256，绑定完整内容，`specs/03:143` 要求）**仍由 LDVH
 * 在内容生成后自行计算**，与用哪个 API 写盘无关——宿主 `FsVersion` 是 opaque 的
 * 过期检测令牌，**不能**冒充内容指纹。
 *
 * @param filePath - 目标载体绝对路径。
 * @param content - 完整文件内容。
 * @param fsPort - **可选**宿主 fs 端口 `{resolve, writeIntent, writeText}`；缺席时回退自建路径。
 */
async function writeFactFile(filePath, content, fsPort) {
  if (fsPort !== undefined && fsPort !== null) {
    const target = await fsPort.resolve(filePath);
    const intent = await fsPort.writeIntent(target);
    await fsPort.writeText(target, content, intent);
    return;
  }
  await atomicWriteFile(filePath, content);
}

/** Validate objectUid format (path-injection guard). */
function assertValidUid(objectUid) {
  return typeof objectUid === "string" && UUID_PATTERN.test(objectUid);
}

/** Assemble the file body: generated H1 + caller-provided markdown. */
function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.trim()}`;
}

// ---------------------------------------------------------------------------
// Create (specs/03 §9.4 + specs/20 §13)
// ---------------------------------------------------------------------------

/**
 * `dryRun` runs EVERY mechanical check (closed sets, single-sentence question,
 * carrier coherence, body structure, serves/refs resolution) and returns the
 * same failures, but stops before touching the filesystem.
 *
 * It exists so a caller can prove a write is mechanically possible BEFORE
 * asking the Human to authorise it. Asking first would spend the Human's
 * attention on a candidate the writer is certain to refuse (20 §16 requires an
 * explicit confirmation, and a confirmation for a doomed write is a wasted
 * one). The returned `object_uid` is the identity that a real create would
 * assign; a dry run allocates no file and leaves no trace.
 */
export async function createSparkObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null, dryRun = false, fsPort = null } = args;
  // Human requirement 2026-09-12 + 03 §6.1 / 09 机械签名: a change_log entry is
  // signed BY CODE and may not be written unsigned. Without a branded carrier the
  // write is REFUSED; the caller reports it for Human handling (09 requires a
  // definite unavailable outcome for blank/historical sessions).
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 当前理解'; the H1 is generated from title)");
  }

  // Code-assigned identity (03 §6.2)
  const uid = randomUUID();
  const now = new Date().toISOString();
  // Strip caller-only params (change_summary is a call argument, not object metadata)
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = SPARK_TYPE_KEY;
  frontmatter.created_at = now;
  // 20 §9: 初态 open — create must never enter a terminal state
  if (frontmatter.status !== undefined && frontmatter.status !== "open") {
    return failure("spark/initial_state_violation", `create must initialise as status=open; got ${JSON.stringify(frontmatter.status)} (20 §9)`);
  }
  frontmatter.status = "open";
  // 20 §8/§11: merge/split relations and disposition cannot exist at creation
  // (they only attach to a terminal transition, which create never performs)
  if (frontmatter.disposition !== undefined) {
    return failure("spark/frontmatter_invalid", "create must not carry disposition (20 §8: disposition ⇔ terminal status; create is always open)");
  }
  if (frontmatter.relations !== undefined) {
    return failure("spark/frontmatter_invalid", "create must not carry relations (20 §11: merged-into/split-into only attach to a discarded transition)");
  }
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Spark 对象",
  }];

  // Validate
  const fmCheck = validateSparkFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("spark/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateSparkRelations(frontmatter, uid);
  if (!relCheck.ok) {
    return failure("spark/relations_invalid", "relations failed mechanical checks", { issues: relCheck.issues });
  }

  // serves resolution (20 §13): declared → must match a goal.md SG-n
  if (frontmatter.serves !== undefined) {
    const goal = await readGoalAnchors(factSourceRoot);
    if (!goal.ok) {
      return failure("spark/serves_unresolvable", `serves declared (${frontmatter.serves}) but goal.md is not readable: ${goal.reason} (20 §17.1)`);
    }
    if (!goal.anchors.has(frontmatter.serves)) {
      return failure("spark/serves_unresolvable", `serves ${frontmatter.serves} does not match any SG-n in goal.md 子目标 (available: ${[...goal.anchors].join(", ") || "none"})`);
    }
  }

  // refs target resolution (03 §7.2, 20 §8): declared → every target must be
  // an existing, readable, same-project fact object. Zero-write rejection.
  if (frontmatter.refs !== undefined) {
    const refsCheck = await resolveRefsTargets(factSourceRoot, frontmatter.refs);
    if (!refsCheck.ok) {
      return failure("spark/refs_unresolvable", refsCheck.reason, { missing: refsCheck.missing });
    }
  }

  // Body structure + carrier coherence
  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const evolutionCount = Array.isArray(frontmatter.evolution) ? frontmatter.evolution.length : 0;
  const bodyCheck = validateSparkBodyStructure(body, frontmatter.title, evolutionCount);
  if (!bodyCheck.ok) {
    return failure("spark/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("spark/coherence_invalid", "carrier coherence failed", { issues: coherenceCheck.issues });
  }

  // Dry run stops here: every mechanical check above has passed, so the caller
  // can now ask the Human knowing the write would land. Nothing has been
  // created — no directory, no staging file, no rename.
  if (dryRun === true) {
    const filePath = objectFilePath(factSourceRoot, uid);
    return success({ object_uid: uid, file: filePath, dry_run: true });
  }

  // Write (single flat file, atomic)
  const typeDir = join(factSourceRoot, SPARK_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await writeFactFile(filePath, content, fsPort);

  const fingerprint = fileFingerprint(content);
  return success({ object_uid: uid, file: filePath, fingerprint });
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2 precise read-back)
// ---------------------------------------------------------------------------

export async function readSparkObject(args) {
  const { factSourceRoot, objectUid } = args;
  if (!assertValidUid(objectUid)) {
    return failure("spark/invalid_uid", "objectUid must be a valid UUID");
  }
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

// ---------------------------------------------------------------------------
// List / F0–F1 discovery (specs/03 §8, specs/20 §12)
// ---------------------------------------------------------------------------
//
// Merge/split sequencing memo (gap 2 of the 2026-09 review).
//
// 2026-09-27 更正（据 Human 决定 D-7 复核本段）：
//  原先写作「Human-ratified deferral…the safe order is SOURCE-FIRST」，两处失准——
//   ① 「deferral（延期）」不准确：被延期的**不是规则**。20 §9.4 已由 Human 决定
//      D-7（2026-09-12，见 docs/audit/human-decisions-2026-09-12-segment.md）
//      定义**三情形**次序：既存目标 SOURCE-FIRST、新建目标 CREATE-FIRST、混合
//      目标先建后结。规则齐备，缺的是**实现**。
//   ② 「the safe order is SOURCE-FIRST」把三情形之一说成了唯一次序。
//  故本段的准确状态是：**实现只覆盖三情形中的一种（情形一 SOURCE-FIRST）；
//  情形二（CREATE-FIRST）与情形三（先建后结）尚未实装**——本模块的受控原语
//  只有 create/update 两个单对象操作，不承载跨对象的次序编排，该编排当前由
//  调用方按 §9.4 执行。该实现差距已登记为对象（见下）。
//
// 已实装的那一种（情形一）仍是安全的：先写源对象（discarded + relations），
// 再往目标 change_log 追加合并来源备注。失败时至多留下「目标缺一条 additive
// 流水」（可幂等重补），**不会**出现「目标已声明来源而原对象仍为 open」这一假陈述。
//
// 未实装范围的证据与影响：见 open Spark `46bf4c66-cd2a-4e45-ac88-53f9065ed876`
// （「Spark 合并拆分次序实现缺口」；本注释不复制其内容，缺口状态与裁定以该对象为准）。

/**
 * Enumerate Spark objects (F0/F1: deterministic filter + minimal projection).
 *
 * - Reads every `spark-<uid>.md` in the sparks directory and projects the
 *   dedup-relevant fields (title + question are the semantic comparison
 *   inputs per 20 §6.2).
 * - Default status filter: open only (20 §12: implemented/discarded stay out
 *   of ordinary unresolved candidates); `includeTerminal: true` includes all.
 * - `limit` caps the returned items (03 §8.1: no silent truncation — a cap
 *   hit returns `complete: false` plus the unfiltered total).
 * - Files that fail to parse are reported in `invalid` — never skipped
 *   silently (03 §8.1 F0 includes the invalid/unavailable object list).
 * - A missing sparks directory is a valid empty state, not an error.
 */
export async function listSparkObjects(args) {
  const { factSourceRoot, includeTerminal = false, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }

  const typeDir = join(factSourceRoot, SPARK_DIRECTORY);
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return success({ items: [], total: 0, complete: true, invalid: [] });
    }
    return failure("spark/directory_unavailable", `cannot read sparks directory: ${error.message}`);
  }

  const invalid = [];
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const nameMatch = entry.name.match(/^spark-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i);
    if (!nameMatch) continue; // non-carrier files (e.g. tmp staging) are not objects
    const uid = nameMatch[1].toLowerCase();
    let content;
    try {
      content = await readFile(join(typeDir, entry.name), "utf8");
    } catch (error) {
      invalid.push({ file: entry.name, reason: `unreadable: ${error.message}` });
      continue;
    }
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) {
      invalid.push({ file: entry.name, reason: "no YAML frontmatter block" });
      continue;
    }
    let frontmatter;
    try {
      frontmatter = parseYaml(fmMatch[1]);
    } catch (error) {
      invalid.push({ file: entry.name, reason: `frontmatter parse error: ${error.message}` });
      continue;
    }
    const status = frontmatter.status;
    if (!STATUSES.has(status)) {
      invalid.push({ file: entry.name, reason: `status ${JSON.stringify(status)} outside the closed set` });
      continue;
    }
    if (!includeTerminal && status !== "open") continue;
    items.push({
      object_uid: uid,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      question: typeof frontmatter.question === "string" ? frontmatter.question : "",
      serves: typeof frontmatter.serves === "string" ? frontmatter.serves : undefined,
      // refs (20 §8/§12): carried into F1 so the Human list card can show what
      // this spark is related to. Targets are enriched with type/title for
      // readability only — this is a derived projection, never written back
      // (03 §7.2 invariant 4: no second authority).
      refs: Array.isArray(frontmatter.refs) && frontmatter.refs.length > 0
        ? frontmatter.refs.map((entry) => ({ object_uid: entry?.object_uid })).filter((entry) => typeof entry.object_uid === "string")
        : undefined,
      priority: typeof frontmatter.priority === "string" ? frontmatter.priority : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  // Newest first — the natural order for dedup scans and resumption.
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({ items: projected, total: items.length, complete, invalid });
}

// ---------------------------------------------------------------------------
// Update via CAS (specs/03 §9.5 + specs/20 §13)
// ---------------------------------------------------------------------------

/**
 * `dryRun`（2026-09-26，来自 26be321 独立复核的 P1）跑完全部机械校验并返回同样的
 * 失败，但在触盘之前返回——与 `createSparkObject` 的 dry run 对称。
 *
 * 为什么需要它：20 §16 的终态转换 Gate 由工具层提问，而**提问一旦发出就无法收回**。
 * 没有本选项时，一个注定失败的终态更新（非法 relation_key、disposition 超长、
 * serves 无法解析）仍会先消耗一次 Human 提问，然后才被 writer 拒绝——实测三种
 * 情形各烧掉恰好一次提问。创建路径本已把「便宜的拒绝」排在提问之前，本项使更新
 * 路径与之一致。
 */
export async function updateSparkObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
    dryRun = false, fsPort = null,
  } = args;
  // Human requirement 2026-09-12 + 03 §6.1 / 09 机械签名: a change_log entry is
  // signed BY CODE and may not be written unsigned. Without a branded carrier the
  // write is REFUSED; the caller reports it for Human handling (09 requires a
  // definite unavailable outcome for blank/historical sessions).
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("spark/change_summary_required", "changeSummary is required for update");
  }
  if (!assertValidUid(objectUid)) {
    return failure("spark/invalid_uid", "objectUid must be a valid UUID");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 当前理解')");
  }

  const current = await readSparkObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("spark/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  // 20 §9.2: a terminal state must NOT be reopened (status may not change),
  // but the object's content stays correctable — a terminal record that is
  // wrong, over-long or stale is fixed in place with a change_log entry,
  // never by faking a status transition.
  const prevStatus = current.value.frontmatter.status;
  const prevTerminal = prevStatus === "implemented" || prevStatus === "discarded";
  if (prevTerminal) {
    const requested = frontmatterAfter?.status;
    if (requested !== undefined && requested !== prevStatus) {
      return failure("spark/status_terminal", `status=${prevStatus} is terminal; reopen (status=${requested}) is forbidden (20 §9.2) — content correction is allowed, status reversal is not; later unresolved info belongs to a NEW open Spark`);
    }
  }

  // Build updated frontmatter; strip the call-only param
  const { change_summary: _stripped, ...afterFields } = frontmatterAfter;
  const fm = { ...afterFields };
  fm.object_uid = objectUid;
  fm.fact_type_key = SPARK_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("spark/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (open/implemented/discarded, 20 §9)`);
  }
  // open → {open, implemented, discarded} are the only legal transitions from
  // the only non-terminal state, so no further transition check is needed.

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  // Validate
  const fmCheck = validateSparkFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("spark/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateSparkRelations(fm, objectUid);
  if (!relCheck.ok) {
    return failure("spark/relations_invalid", "updated relations failed mechanical checks", { issues: relCheck.issues });
  }

  // serves resolution on the updated object (20 §13)
  if (fm.serves !== undefined) {
    const goal = await readGoalAnchors(factSourceRoot);
    if (!goal.ok) {
      return failure("spark/serves_unresolvable", `serves declared (${fm.serves}) but goal.md is not readable: ${goal.reason} (20 §17.1)`);
    }
    if (!goal.anchors.has(fm.serves)) {
      return failure("spark/serves_unresolvable", `serves ${fm.serves} does not match any SG-n in goal.md 子目标 (available: ${[...goal.anchors].join(", ") || "none"})`);
    }
  }

  // refs target resolution on the updated object (03 §7.2, 20 §8)
  if (fm.refs !== undefined) {
    const refsCheck = await resolveRefsTargets(factSourceRoot, fm.refs);
    if (!refsCheck.ok) {
      return failure("spark/refs_unresolvable", refsCheck.reason, { missing: refsCheck.missing });
    }
  }

  // Relation targets must resolve to existing sparks, and must be OPEN *at
  // write time* (20 §11 / §14.1 — 合并/拆分去向校验).
  //
  // Human 裁定 2026-10-05（解法 C）：`open` 是**写入前置条件**，不是持久不变量。
  // 目标 Spark 日后依法走到终态（§9.2）不溯及既往地使既有关系失效——那是正常
  // 生命周期内必然发生的事（§11 已相应移除对应的 Stop Condition）。故本校验只
  // 作用于**本次写入新引入**的关系目标；既有的、目标已事后转终态的关系不
  // 在此重新裁决。
  //
  // 若不加此区分（每次写入都复查全部关系），任何子议题已终态的父对象都会被永久
  // 锁死：§13 禁止删除该关系、§9.2 禁止把子对象改回 open，于是此后每一次更新
  // ——连同与之无关的内容更正——都将被无限期拒绝。本次裁定正是消除该死锁。
  const prevRelUids = new Set(relationTargetUids(current.value.frontmatter, objectUid));
  for (const targetUid of relationTargetUids(fm, objectUid)) {
    if (prevRelUids.has(targetUid)) continue; // 未被本次写入触及的既有关系
    const targetRead = await readSparkObject({ factSourceRoot, objectUid: targetUid });
    if (!targetRead.ok) {
      return failure("spark/relation_target_unresolvable", `${targetUid} does not resolve to an existing Spark object: ${targetRead.error.message}`);
    }
    if (targetRead.value.frontmatter.status !== "open") {
      return failure("spark/relation_target_unresolvable", `${targetUid} is status=${targetRead.value.frontmatter.status}, not open — merge/split targets must be open at write time (20 §11 write-precondition)`);
    }
  }

  // Body structure + carrier coherence on the updated object
  const body = assembleBody(fm.title, bodyMarkdownAfter);
  const evolutionCount = Array.isArray(fm.evolution) ? fm.evolution.length : 0;
  const bodyCheck = validateSparkBodyStructure(body, fm.title, evolutionCount);
  if (!bodyCheck.ok) {
    return failure("spark/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(fm, body);
  if (!coherenceCheck.ok) {
    return failure("spark/coherence_invalid", "carrier coherence failed on update", { issues: coherenceCheck.issues });
  }

  // Dry run stops here: every mechanical check above has passed, so the caller
  // can ask the Human knowing the write would land. Nothing was written.
  if (dryRun === true) {
    return success({ object_uid: objectUid, dry_run: true });
  }

  // Atomic single-file write
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await writeFactFile(filePath, content, fsPort);

  return success({ fingerprint: fileFingerprint(content) });
}

// Exported for the schema/writer agreement guard (test/schema-writer-agreement.test.mjs):
// the tool-plane JSON Schema must admit every field this closed set accepts, and a
// field added here without a matching schema entry is unreachable via the tools.
export { VALID_FM_KEYS };
