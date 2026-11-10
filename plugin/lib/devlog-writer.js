/**
 * dsh-ldvh — DevLog fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/29 (DevLog-开发日志) §13 受控操作,
 * §14.1 类型特有验证, and the shared read-back/CAS contract from specs/02 §10:
 *
 *  - create:  flat single-file carrier (ldvh-base/devlogs/devlog-<uid>.md) with
 *             YAML frontmatter + markdown body. Code assigns object_uid +
 *             created_at and generates the H1 from title.
 *  - read:    frontmatter + body + file-level content fingerprint (SHA-256).
 *  - update:  CAS — two lanes (29 §9.2):
 *               * active→active = 补充级更新 (29 §9.3): status held fixed;
 *                 `summary` may be refined (§9.3 细化档) — the mechanical
 *                 layer does NOT judge 细化 vs 替换, it only observes that
 *                 exactly one change_log entry was appended.
 *               * active→absorbed / superseded / dropped = terminal
 *                 transitions (29 §9.1). All three are Human Gate outcomes.
 *             absorbed/superseded/dropped are read-only afterwards
 *             (29 §9.2 三个终态均不可重开).
 *
 * Red lines honoured (29 §18): no `urls`, no resolvable pointer to a
 * plain-document path (§10.2 载体自足), no merge edge, no business number.
 *
 * `refs` was adopted on 2026-11-02 (29 §8/§11/§12.3bis; the adopting-surface
 * decision is Human's, per 02 §8.2 采用面扩展): the entry declares which fact
 * objects its conclusion is based on / related to. It is a REFERENCE carrier,
 * not a lifecycle relation — 承接/推翻 stay in `relations` (29 §11).
 */

import { createHash, randomUUID } from "node:crypto";
import { detectDigestStaleness, digestStaleMessage } from "./digest-staleness.js";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter } from "./after-integrity.js";
import { sectionContent } from "./markdown-structure.js";
import { parseObjectIdentifier, resolveShortId } from "./object-identifier.js";
import { carrierCoherenceMessage } from "./coherence-report.js";

// ---------------------------------------------------------------------------
// Constants (specs/29 §7, §8, §9, §10, §11, §13)
// ---------------------------------------------------------------------------

const DEVLOG_TYPE_KEY = "devlog";

/** Directory under the fact-source root that carries DevLog objects (29 §7). */
export const DEVLOG_DIRECTORY = "devlogs";

/**
 * A syntactically valid UUID that never represents a real object: it exists only
 * so the closed-set validator (which requires a canonical `object_uid`) can run
 * on a precheck candidate without minting an identity (29 §13 不生成对象标识).
 * Never returned to a caller, never written.
 */
const PRECHECK_PLACEHOLDER_UID = "00000000-0000-4000-8000-000000000000";

/** Fixed body H2 sections, active form (29 §8) — all five required, in order. */
const BODY_H2_ACTIVE = ["背景", "做法", "实测", "结论与边界", "去向"];

/** Compressed form for `absorbed` (29 §9.1): exactly these two, in order. */
const BODY_H2_ABSORBED = ["结论与边界", "去向"];

/** Status closed set (29 §9): active → absorbed | superseded | dropped. */
const STATUSES = new Set(["active", "absorbed", "superseded", "dropped"]);

/** Terminal states (29 §9.2: 终态不可重开). */
const TERMINAL_STATUSES = new Set(["absorbed", "superseded", "dropped"]);

/** Title cap (29 §8: ≤ 40 字; same UTF-16 code-unit counting as 20 §9.1). */
const MAX_TITLE_LENGTH = 40;

/** Relation closed set (29 §11): exactly two terminal edges. */
export const DEVLOG_RELATION_KEYS = new Set(["absorbed-into", "superseded-by"]);

/**
 * `absorbed-into` valid target types (29 §11): the object types that can absorb
 * a conclusion. A DevLog is deliberately NOT in this set — absorbing into
 * another DevLog would mean the other entry carries the same conclusion, which
 * is 29 §18 red line 3 (两处权威).
 */
export const ABSORBING_TYPES = new Set(["adr", "workcase", "norm", "pitfall"]);

/** 40-hex commit hash (02 §8.1 commit 形态; short hashes and refs refused). */
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

/** UUID format check (02 §7.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Closed set of frontmatter keys (29 §8: unknown fields are rejected). */
export const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "status", "occurred_at", "summary",
  "recall_digest",
  "serves", "refs", "disposition", "relations", "created_at", "change_log",
]);

/**
 * refs entry cap (29 §8: 上限 10 项). Same number and same reason as 20 §8:
 * the field exists so a Human can scan "what is this entry related to" on the
 * list card; an unbounded list would defeat its own purpose (02 §16 第 9 条:
 * 关联数量不构成价值声明).
 */
const MAX_REFS_ENTRIES = 10;

/**
 * 可经 frontmatter_removals 删除的字段（specs/02 §10.5 实现对齐）。
 *
 * 口径：该类型 §8 的**条件字段**中**非「终态伴随」**者。`disposition` 是
 * `dropped` 专属、`relations` 是终态伴随，二者在 update 路径不可达（终态
 * 只读，而 active 期两者都必须缺席），故都不列。
 *
 * `serves` 与 `refs` 是可显式删除的字段：二者都是可选引用，条目在创建时
 * 可能尚无对应子目标／关联对象，后来建立或确认无关时都需要「撤销声明」。
 * 没有删除通道，02 §10.5 的「省略即保留」会让它一旦写入就永久无法撤回。
 */
export const DEVLOG_REMOVABLE_FIELDS = new Set(["serves", "refs"]);

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
// Validation (the mechanical slice of specs/29 §8, §9, §11, §14.1)
// ---------------------------------------------------------------------------

/**
 * Frontmatter mechanical checks.
 *
 * The mechanical layer decides exactly what 29 §14.1 registers as decidable:
 * closed set, title cap, occurred_at shape+order, status closed set,
 * disposition mutual exclusion, status/relations 同变, relation shape.
 *
 * It does NOT decide whether `summary` is really a conclusion rather than a
 * narrative, whether it is still true, whether the absorbing target really
 * covers it, or whether `occurred_at` is really the work's time — those are
 * 29 §14.1's semantic rows, judged by AI self-check + Human.
 */
export function validateDevLogFrontmatter(frontmatter, options = {}) {
  const issues = [];

  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 29 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || !UUID_PATTERN.test(frontmatter.object_uid)) {
    issues.push("object_uid: must be a canonical UUIDv4 (02 §7.1)");
  }
  if (frontmatter.fact_type_key !== DEVLOG_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${DEVLOG_TYPE_KEY}" (29 §7)`);
  }

  if (typeof frontmatter.title !== "string" || frontmatter.title.trim().length === 0) {
    issues.push("title: required and non-empty (29 §8)");
  } else if (frontmatter.title.trim().length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (29 §8, same counting as 20 §9.1)`);
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of active/absorbed/superseded/dropped (29 §9), got ${JSON.stringify(frontmatter.status)}`);
  }

  // occurred_at (29 §8 / §10.4): required, legal RFC3339, and never later than
  // created_at. The mechanical layer can only check the ORDER — it cannot check
  // that the timestamp is really when the work happened (29 §10.5).
  const occurredAt = frontmatter.occurred_at;
  if (typeof occurredAt !== "string" || occurredAt.length === 0) {
    issues.push("occurred_at: required RFC3339 (29 §8 — 该工作发生的时间，非录入时间)");
  } else if (Number.isNaN(Date.parse(occurredAt))) {
    issues.push(`occurred_at: must be a legal RFC3339 timestamp (29 §8), got ${JSON.stringify(occurredAt)}`);
  } else if (typeof frontmatter.created_at === "string" && frontmatter.created_at.length > 0
    && !Number.isNaN(Date.parse(frontmatter.created_at))
    && Date.parse(occurredAt) > Date.parse(frontmatter.created_at)) {
    issues.push(`occurred_at: must not be later than created_at (29 §8 字段间不变量 2), got occurred_at=${occurredAt} > created_at=${frontmatter.created_at}`);
  }

  // summary (29 §8 / §9.3): required, non-empty. The "is it a conclusion and
  // not an action sequence" judgement is semantic (29 §14.1) — never checked here.
  if (typeof frontmatter.summary !== "string" || frontmatter.summary.trim().length === 0) {
    issues.push("summary: required and non-empty (29 §8 — 当前语义快照：结论与适用边界)");
  }
  // **不设 200 字符上限**（Human 2026-11-04 裁定乙，workcase-5eec3197）。
  // DevLog 的 summary 是「结论与边界」的完整快照（29 §8），与 Spark 的索引层
  // 定位不同：它要回答「结论是什么、在什么条件下成立、哪些已确认不成立」，
  // 200 字装不下这些。实测本仓 11 条 DevLog 中位 174 字、最大 243 字，
  // 本就接近该量级，硬上限收益低而切断表达的风险高。

  // serves (29 §8): optional object reference; resolution needs the SubGoal
  // index, so it is checked by the caller (resolveDevLogServes), not here.
  if (frontmatter.serves !== undefined) {
    if (typeof frontmatter.serves !== "string" || !UUID_PATTERN.test(frontmatter.serves)) {
      issues.push(`serves: must be a SubGoal object_uid (canonical UUIDv4, 29 §8), got ${JSON.stringify(frontmatter.serves)}`);
    }
  }

  // refs (29 §8 / §12.3bis): optional association references (02 §8.2 关联引用型
  // 形态). Shape is checked here; target resolution is the caller's job
  // (resolveDevLogRefsTargets) because it needs the fact-source index.
  if (frontmatter.refs !== undefined) {
    if (!Array.isArray(frontmatter.refs)) {
      issues.push("refs: must be an array of {object_uid}");
    } else if (frontmatter.refs.length === 0) {
      issues.push("refs: must be omitted when there is no association — an empty array fabricates a conditional field (03 §6.1)");
    } else {
      if (frontmatter.refs.length > MAX_REFS_ENTRIES) {
        issues.push(`refs: exceeds the ${MAX_REFS_ENTRIES}-entry cap (29 §8)`);
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
        if (typeof target !== "string" || !UUID_PATTERN.test(target)) {
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

  // 29 §8 字段间不变量 3: disposition appears ⇔ status = dropped.
  if (frontmatter.status === "dropped") {
    if (typeof frontmatter.disposition !== "string" || frontmatter.disposition.trim().length === 0) {
      issues.push("disposition: required when status=dropped (29 §8: 原位退出的理由与消失的前提)");
    }
  } else if (frontmatter.disposition !== undefined) {
    issues.push(`disposition: forbidden unless status=dropped (29 §8), got status=${frontmatter.status}`);
  }

  const relCheck = validateDevLogRelations(frontmatter);
  issues.push(...relCheck.issues);

  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required (Code-assigned at creation)");
  }
  if (!Array.isArray(frontmatter.change_log) || frontmatter.change_log.length === 0) {
    issues.push("change_log: exactly one entry is appended per actual modification; at least one required");
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Relation contract (29 §11) + 字段间不变量 4 (状态与关系同变).
 *
 * Two edges only, both terminal-only:
 *   - `absorbed-into` → ADR/WorkCase/Norm/Pitfall object_uid, or commit form;
 *                      exactly 1 iff status=absorbed, forbidden otherwise.
 *   - `superseded-by` → DevLog object_uid ONLY (commit form refused: "the
 *                      overturning conclusion must be a DevLog object, else
 *                      「新结论在哪里」has no readable carrier");
 *                      exactly 1 iff status=superseded, forbidden otherwise.
 *
 * Target RESOLUTION is the caller's job (it needs the fact source); this
 * function validates shape + cardinality + the status gating.
 */
export function validateDevLogRelations(frontmatter, selfUid = null) {
  const issues = [];
  const relations = frontmatter.relations;
  const status = frontmatter.status;

  const expectedKey = status === "absorbed" ? "absorbed-into"
    : status === "superseded" ? "superseded-by"
      : null;

  if (relations === undefined) {
    if (expectedKey !== null) {
      issues.push(`relations: status=${status} requires exactly one ${expectedKey} edge (29 §8 字段间不变量 4)`);
    }
    return { ok: issues.length === 0, issues };
  }
  if (!Array.isArray(relations)) {
    issues.push("relations: must be an array (02 §8.2)");
    return { ok: false, issues };
  }
  if (relations.length === 0) {
    issues.push("relations: when present must be non-empty (29 §11)");
    return { ok: false, issues };
  }

  const counts = new Map();
  const seen = new Set();

  for (const rel of relations) {
    if (typeof rel !== "object" || rel === null) {
      issues.push("relations[]: members must be objects");
      continue;
    }
    // 02 §8.2 公共形状: relation_key + target only.
    const relExtra = Object.keys(rel).filter((k) => k !== "relation_key" && k !== "target");
    if (relExtra.length > 0) {
      issues.push(`relations[]: entry carries fields beyond relation_key/target (${relExtra.join(", ")}) — 02 §8.2 公共形状`);
    }

    const key = rel.relation_key;
    if (typeof key !== "string" || !DEVLOG_RELATION_KEYS.has(key)) {
      issues.push(`relations[]: relation_key ${JSON.stringify(key)} not in closed set {absorbed-into, superseded-by} (29 §11)`);
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);

    // Both edges are terminal-only (29 §11: 均只用于终态).
    if (status === "active" || status === "dropped") {
      issues.push(`relations[]: ${key} may only appear on status=absorbed/superseded, got status=${JSON.stringify(status)} (29 §11) — active/dropped must carry neither edge`);
    } else if (status === "absorbed" && key !== "absorbed-into") {
      issues.push(`relations[]: status=absorbed must carry absorbed-into, not ${key} (29 §8 字段间不变量 4)`);
    } else if (status === "superseded" && key !== "superseded-by") {
      issues.push(`relations[]: status=superseded must carry superseded-by, not ${key} (29 §8 字段间不变量 4)`);
    }

    const target = rel.target;
    if (typeof target !== "object" || target === null) {
      issues.push("relations[]: target must be an object (02 §8.2)");
      continue;
    }
    const targetKeys = Object.keys(target);
    const hasUid = typeof target.object_uid === "string";
    const hasCommit = typeof target.commit === "string";
    if (hasUid && hasCommit) {
      issues.push("relations[]: target carries both object_uid and commit — the two forms are mutually exclusive (02 §8.1 commit 形态)");
      continue;
    }
    if (hasCommit && key === "superseded-by") {
      issues.push("relations[]: superseded-by target must be a DevLog object_uid — a commit cannot answer 「新结论在哪里」(29 §11)");
      continue;
    }
    if (!hasUid && !hasCommit) {
      issues.push(`relations[]: target must carry object_uid or commit (02 §8.2); got ${JSON.stringify(target)}`);
      continue;
    }
    if (hasCommit) {
      if (!COMMIT_PATTERN.test(target.commit)) {
        issues.push(`relations[]: target.commit must be a 40-hex commit hash (02 §8.1); got ${JSON.stringify(target.commit)}`);
      }
      const extraWithCommit = targetKeys.filter((k) => k !== "commit");
      if (extraWithCommit.length > 0) {
        issues.push(`relations[]: a commit-form target carries fields beyond commit (${extraWithCommit.join(", ")}) — 02 §8.2`);
      }
      const dedupe = `${key}::commit:${target.commit}`;
      if (seen.has(dedupe)) issues.push(`relations[]: duplicate relation ${dedupe}`);
      seen.add(dedupe);
      continue;
    }
    const targetExtra = targetKeys.filter((k) => k !== "object_uid");
    if (targetExtra.length > 0) {
      issues.push(`relations[]: target carries fields beyond object_uid (${targetExtra.join(", ")}) — 02 §8.2`);
    }
    if (!UUID_PATTERN.test(target.object_uid)) {
      issues.push(`relations[]: target.object_uid must be a canonical UUID (02 §8.2); got ${JSON.stringify(target.object_uid)}`);
      continue;
    }
    if (selfUid !== null && target.object_uid === selfUid) {
      issues.push(`relations[]: ${key} target must not be the object itself (29 §11)`);
    }
    const dedupe = `${key}::${target.object_uid}`;
    if (seen.has(dedupe)) issues.push(`relations[]: duplicate relation ${key} → ${target.object_uid}`);
    seen.add(dedupe);
  }

  // Cardinality (29 §11: 恰 1).
  for (const [key, count] of counts) {
    if (count > 1) {
      issues.push(`relations[]: ${key} has cardinality 1, got ${count} (29 §11)`);
    }
  }
  if (expectedKey !== null && (counts.get(expectedKey) ?? 0) !== 1) {
    issues.push(`relations: status=${status} requires exactly one ${expectedKey} edge, got ${counts.get(expectedKey) ?? 0} (29 §8 字段间不变量 4)`);
  }
  for (const key of DEVLOG_RELATION_KEYS) {
    if (key !== expectedKey && (counts.get(key) ?? 0) > 0) {
      issues.push(`relations[]: ${key} is forbidden while status=${JSON.stringify(status)} (29 §11 均只用于终态)`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Body structure (29 §8, §9.1).
 *
 * `active` requires all five fixed H2 sections in order, each non-empty.
 * `absorbed` is COMPRESSED: exactly 结论与边界 + 去向 (29 §9.1). The other two
 * terminal states keep the full form (29 §9.1: superseded/dropped 全文保留).
 */
export function validateDevLogBodyStructure(body, title, status = "active") {
  const issues = [];
  const text = typeof body === "string" ? body : "";
  const expected = status === "absorbed" ? BODY_H2_ABSORBED : BODY_H2_ACTIVE;

  const h1s = [...text.matchAll(/^ {0,3}#(?!#)[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1].trim());
  if (h1s.length !== 1) {
    issues.push(`body: exactly one H1 is required, got ${h1s.length} (29 §8: H1 由 Code 从 title 生成)`);
  } else if (title && h1s[0] !== title) {
    issues.push(`body: H1 must equal title (29 §8: the H1 is generated from title), got ${JSON.stringify(h1s[0])}`);
  }

  const headings = [...text.matchAll(/^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1].trim());
  if (headings.length !== expected.length || headings.some((h, i) => h !== expected[i])) {
    issues.push(
      status === "absorbed"
        ? `body: status=absorbed must carry exactly ${expected.map((h) => `"${h}"`).join(" then ")} in order, got ${JSON.stringify(headings)} (29 §9.1 压缩形态)`
        : `body: H2 sections must be exactly ${expected.map((h) => `"${h}"`).join(" then ")} in order, got ${JSON.stringify(headings)} (29 §8)`,
    );
  }

  for (const heading of expected) {
    const content = sectionContent(text, heading);
    if (content === null) {
      issues.push(`body: "${heading}" section must be present (29 §8)`);
    } else if (content.trim().length === 0) {
      issues.push(`body: "${heading}" section must be non-empty (29 §8)`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (29 §8 字段间不变量 1): `summary` must appear VERBATIM in
 * the 结论与边界 section. frontmatter is the single authoritative text; the
 * body only expands it.
 *
 * Exact string comparison, no normalization (29 §14.1 载体内聚 row).
 * This invariant survives compression: 29 §9.1 keeps 结论与边界 precisely so
 * the conclusion never disappears with the evidence.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const summary = typeof frontmatter.summary === "string" ? frontmatter.summary.trim() : "";
  if (summary.length === 0) return { ok: true, issues };
  const content = sectionContent(body, "结论与边界");
  if (content === null) return { ok: true, issues }; // section-presence is another check
  if (!content.includes(summary)) {
    issues.push(carrierCoherenceMessage({
      section: "结论与边界", field: "summary", declared: summary, actual: content,
      clause: "29 §8 字段间不变量 1",
    }));
  }
  return { ok: issues.length === 0, issues };
}

export function devlogFileName(uid) { return `devlog-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, DEVLOG_DIRECTORY, devlogFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/**
 * Deterministic display order (semantic block first, change_log last).
 * 29 §8 reading order: title, status, occurred_at (扫读入口与时序), then the
 * semantic block, then relations, then identity, then the flow log.
 */
const FRONTMATTER_FIELD_ORDER = [
  "title", "status", "occurred_at", "summary", "serves", "refs", "disposition",
  "relations", "object_uid", "fact_type_key", "created_at", "change_log",
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

function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { ok: false, reason: "missing YAML frontmatter fence" };
  try {
    const frontmatter = parseYaml(match[1]);
    if (typeof frontmatter !== "object" || frontmatter === null) {
      return { ok: false, reason: "frontmatter is not a mapping" };
    }
    return { ok: true, frontmatter, body: raw.slice(match[0].length) };
  } catch (error) {
    return { ok: false, reason: `YAML parse failed: ${String(error?.message || error)}` };
  }
}

// ---------------------------------------------------------------------------
// Index scan (F0/F1 discovery + identity uniqueness)
// ---------------------------------------------------------------------------

/**
 * Scan ldvh-base/devlogs/ and return every object's index entry.
 *
 * All statuses are scanned: `superseded-by` targets and absorb-reverse lookups
 * need terminal entries too, and 29 §17 第 5 项 (两处权威) is only detectable
 * across the full set.
 */
export async function listDevLogIndex(factSourceRoot) {
  const dir = join(factSourceRoot, DEVLOG_DIRECTORY);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return success({ items: [], unreadable: [] });
    return failure("devlog/scan_failed", String(error?.message || error));
  }
  const items = [];
  const unreadable = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^devlog-.*\.md$/.test(entry.name)) continue;
    let raw;
    try {
      raw = await readFile(join(dir, entry.name), "utf8");
    } catch (error) {
      unreadable.push({ file: entry.name, reason: String(error?.message || error) });
      continue;
    }
    const parsed = splitFrontmatter(raw);
    if (!parsed.ok) {
      unreadable.push({ file: entry.name, reason: parsed.reason });
      continue;
    }
    const fm = parsed.frontmatter;
    items.push({
      object_uid: fm.object_uid,
      fact_type_key: fm.fact_type_key,
      title: fm.title,
      status: fm.status,
      occurred_at: fm.occurred_at,
      summary: fm.summary,
      serves: fm.serves,
      refs: fm.refs,
      disposition: fm.disposition,
      relations: fm.relations,
      created_at: fm.created_at,
      file: entry.name,
    });
  }
  return success({ items, unreadable });
}

/** Identity uniqueness (29 §17 第 5 项): one object_uid ↔ one carrier. */
async function checkUidExclusive(factSourceRoot, objectUid) {
  const listed = await listDevLogIndex(factSourceRoot);
  if (!listed.ok) return failure("devlog/scan_failed", listed.value?.reason ?? "cannot scan devlogs/");
  const same = listed.value.items.filter((entry) => entry.object_uid === objectUid);
  if (same.length > 1) {
    return failure(
      "devlog/identity_duplicated",
      `object_uid ${objectUid} resolves to ${same.length} DevLog carriers — 两处权威 (29 §17 第 5 项)`,
      { conflicts: same },
    );
  }
  return success({ conflicts: same });
}

// ---------------------------------------------------------------------------
// Relation target resolution (29 §11) — needs the fact source
// ---------------------------------------------------------------------------

/**
 * Resolve an `absorbed-into` target (29 §11).
 *
 * Object form: must resolve to an ADR / WorkCase / Norm / Pitfall object. A
 * DevLog target is refused on purpose — absorbing one conclusion into another
 * entry creates two authorities for the same conclusion (29 §18 red line 3).
 *
 * Commit form: must be a real commit in the governed repository. The caller
 * injects `gitCommitResolver` (writer does not shell out).
 */
export async function resolveAbsorbedIntoTarget({ factSourceRoot, target, gitCommitResolver = null }) {
  if (typeof target !== "object" || target === null) {
    return failure("devlog/absorbed_into_unresolvable", "absorbed-into target must be an object (02 §8.2)");
  }
  if (typeof target.commit === "string") {
    if (!COMMIT_PATTERN.test(target.commit)) {
      return failure("devlog/absorbed_into_unresolvable", `absorbed-into commit must be a 40-hex hash (02 §8.1), got ${JSON.stringify(target.commit)}`);
    }
    if (typeof gitCommitResolver !== "function") {
      return failure("devlog/absorbed_into_unverifiable", "a commit-form absorbed-into target cannot be verified without a commit resolver — the write must not record an unverified hash (02 §8.1 第 ② 条)");
    }
    const exists = await gitCommitResolver(target.commit);
    if (!exists) {
      return failure("devlog/absorbed_into_unresolvable", `commit ${target.commit} does not resolve in this repository (02 §8.1 第 ② 条: 不可解析即 fail closed)`);
    }
    return success({ kind: "commit", commit: target.commit });
  }
  const uid = target.object_uid;
  if (typeof uid !== "string" || !UUID_PATTERN.test(uid)) {
    return failure("devlog/absorbed_into_unresolvable", `absorbed-into target carries no usable object_uid (02 §8.2), got ${JSON.stringify(target)}`);
  }
  const found = await locateFactObject(factSourceRoot, uid);
  if (!found.ok) return found;
  if (!ABSORBING_TYPES.has(found.value.fact_type_key)) {
    return failure(
      "devlog/absorbed_into_unresolvable",
      `absorbed-into must point at an ADR/WorkCase/Norm/Pitfall object, got ${JSON.stringify(found.value.fact_type_key)} (29 §11) — a DevLog cannot absorb into another DevLog (29 §18 红线 3)`,
      { resolved_type: found.value.fact_type_key },
    );
  }
  return success({ kind: "object", fact_type_key: found.value.fact_type_key, object_uid: uid });
}

/**
 * Resolve a `superseded-by` target (29 §11): must be a DevLog object_uid.
 * The commit form is refused by the shape validator already; this checks
 * existence and type to fail closed before writing.
 */
export async function resolveSupersededByTarget({ factSourceRoot, target }) {
  if (typeof target !== "object" || target === null || typeof target.object_uid !== "string") {
    return failure("devlog/superseded_by_unresolvable", "superseded-by target must carry an object_uid (29 §11)");
  }
  const uid = target.object_uid;
  if (!UUID_PATTERN.test(uid)) {
    return failure("devlog/superseded_by_unresolvable", `superseded-by object_uid must be a canonical UUID (02 §8.2), got ${JSON.stringify(uid)}`);
  }
  const found = await locateFactObject(factSourceRoot, uid);
  if (!found.ok) return found;
  if (found.value.fact_type_key !== DEVLOG_TYPE_KEY) {
    return failure(
      "devlog/superseded_by_unresolvable",
      `superseded-by must point at a DevLog object, got ${JSON.stringify(found.value.fact_type_key)} (29 §11)`,
      { resolved_type: found.value.fact_type_key },
    );
  }
  return success({ kind: "object", fact_type_key: DEVLOG_TYPE_KEY, object_uid: uid });
}

/**
 * Locate a fact object by object_uid across the known type directories.
 *
 * Deliberately does NOT use a per-type list projection: every type's projection
 * applies its own status filter, and a relation target must resolve regardless
 * of status ("this conclusion was absorbed into that ADR" survives the ADR
 * being superseded). Only the identity is read.
 */
export async function locateFactObject(factSourceRoot, uid) {
  const dirs = ["adrs", "workcases", "norms", "pitfalls", "devlogs", "researches", "sparks", "frictions", "subgoals"];
  for (const dir of dirs) {
    const full = join(factSourceRoot, dir);
    let entries;
    try {
      entries = await readdir(full, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      return failure("devlog/lookup_failed", `cannot scan ${dir}/: ${String(error?.message || error)}`);
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      let raw;
      try {
        raw = await readFile(join(full, entry.name), "utf8");
      } catch {
        continue;
      }
      const parsed = splitFrontmatter(raw);
      if (!parsed.ok) continue;
      if (parsed.frontmatter.object_uid === uid) {
        return success({
          fact_type_key: parsed.frontmatter.fact_type_key,
          status: parsed.frontmatter.status,
          file: join(full, entry.name),
        });
      }
    }
  }
  return failure("devlog/target_not_found", `no fact object with object_uid ${uid} in this fact source`);
}

/** Resolve every relation target; returns the first failure (zero-write). */
async function validateRelationTargets({ factSourceRoot, frontmatter, gitCommitResolver }) {
  const relations = Array.isArray(frontmatter.relations) ? frontmatter.relations : [];
  for (const rel of relations) {
    if (rel?.relation_key === "absorbed-into") {
      const resolved = await resolveAbsorbedIntoTarget({ factSourceRoot, target: rel.target, gitCommitResolver });
      if (!resolved.ok) return resolved;
    } else if (rel?.relation_key === "superseded-by") {
      const resolved = await resolveSupersededByTarget({ factSourceRoot, target: rel.target });
      if (!resolved.ok) return resolved;
    }
  }
  return success({ ok: true });
}

/**
 * Resolve every `refs` target (29 §8 / §12.3bis; 02 §8.2).
 *
 * The target must EXIST and be READABLE in this project. Its STATUS is never
 * checked: an association is a historical fact, and the target closing does not
 * invalidate it (same reading as 20 §8). A missing target fails closed — the
 * entry is NOT silently degraded to an empty array (02 §8.2 机械校验边界).
 */
async function validateRefsTargets({ factSourceRoot, frontmatter }) {
  const refs = Array.isArray(frontmatter.refs) ? frontmatter.refs : [];
  if (refs.length === 0) return success({ ok: true });

  const missing = [];
  for (const entry of refs) {
    const uid = typeof entry === "string" ? entry : entry?.object_uid;
    if (typeof uid !== "string") continue;
    const located = await locateFactObject(factSourceRoot, uid);
    if (!located.ok) missing.push(uid);
  }

  if (missing.length > 0) {
    return failure(
      "devlog/refs_unresolvable",
      `refs target(s) not resolvable in this project: ${missing.join(", ")} (02 §8.2 — targets must be existing, readable, same-project fact objects; 29 §12.3bis)`,
      { missing },
    );
  }
  return success({ ok: true });
}

// ---------------------------------------------------------------------------
// Create (specs/29 §13 + specs/02 §10)
// ---------------------------------------------------------------------------

/**
 * Evaluate a create candidate WITHOUT touching the filesystem.
 *
 * Shared by `precheckDevLogCreate` and `createDevLogObject` so the two entries
 * run the SAME validator — a precheck verdict that could differ from the write
 * would be worthless (29 §13 双入口一致性).
 */
async function evaluateCreateCandidate({
  factSourceRoot,
  frontmatterDraft,
  bodyMarkdown,
  signature,
  objectUid,
  gitCommitResolver,
}) {
  if (typeof frontmatterDraft !== "object" || frontmatterDraft === null) {
    return failure("devlog/frontmatter_invalid", "frontmatterDraft must be an object (29 §8)");
  }
  const now = new Date().toISOString();
  const draft = { ...frontmatterDraft };
  delete draft.change_summary;

  // Code-owned fields are stamped here, never accepted from the caller
  // (02 §7.2 第 3 条).
  const frontmatter = {
    ...draft,
    object_uid: objectUid,
    fact_type_key: DEVLOG_TYPE_KEY,
    created_at: now,
    change_log: [{
      at: now,
      ...signature,
      summary: typeof frontmatterDraft.change_summary === "string" && frontmatterDraft.change_summary.trim().length > 0
        ? frontmatterDraft.change_summary
        : "受控创建 DevLog 对象",
    }],
  };

  // 29 §9.2: the only legal initial state.
  if (frontmatter.status === undefined) frontmatter.status = "active";
  if (frontmatter.status !== "active") {
    return failure(
      "devlog/initial_state_violation",
      `create must yield status=active (29 §9.2 — 只有一个合法初态), got ${JSON.stringify(frontmatter.status)}`,
    );
  }

  const fmCheck = validateDevLogFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("devlog/frontmatter_invalid", "create candidate failed mechanical checks", { issues: fmCheck.issues });
  }

  // 载体内聚已降为警告层（Human 2026-11-10，`spark-f0ba9997`）：不计算、不阻断。

  const bodyCheck = validateDevLogBodyStructure(assembleBody(frontmatter.title, bodyMarkdown), frontmatter.title, frontmatter.status);
  if (!bodyCheck.ok) {
    return failure("devlog/body_invalid", "body structure failed", { issues: bodyCheck.issues });
  }

  // serves resolution (29 §8 / §12.3): must reach an active|achieved SubGoal.
  if (frontmatter.serves !== undefined) {
    const { resolveSubGoal } = await import("./subgoal-writer.js");
    const resolved = await resolveSubGoal(factSourceRoot, frontmatter.serves);
    if (!resolved.ok) {
      return failure("devlog/serves_unresolvable", `${resolved.error.code}: ${resolved.error.message}`);
    }
  }

  // Relation targets (only reachable if status is terminal, which create forbids;
  // kept for the shared path so the two entries stay identical).
  if (frontmatter.relations !== undefined) {
    const targets = await validateRelationTargets({ factSourceRoot, frontmatter, gitCommitResolver });
    if (!targets.ok) return targets;
  }

  // refs targets (29 §8 / §12.3bis): must exist and be readable in this project.
  if (frontmatter.refs !== undefined) {
    const targets = await validateRefsTargets({ factSourceRoot, frontmatter });
    if (!targets.ok) return targets;
  }

  return success({
    frontmatter,
    body: assembleBody(frontmatter.title, bodyMarkdown),
  });
}

export async function createDevLogObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null, expectedCandidateFingerprint = null, gitCommitResolver = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 背景'; the H1 is generated from title)");
  }

  const uid = randomUUID();
  const evaluated = await evaluateCreateCandidate({
    factSourceRoot,
    frontmatterDraft,
    bodyMarkdown,
    signature: sig.signature,
    objectUid: uid,
    gitCommitResolver,
  });
  if (!evaluated.ok) return evaluated;

  // 29 §13: the precheck verdict belongs to the content it ran against.
  if (typeof expectedCandidateFingerprint === "string" && expectedCandidateFingerprint.length > 0) {
    const actual = computeDevLogCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown);
    if (actual !== expectedCandidateFingerprint) {
      return failure(
        "devlog/candidate_changed",
        "the candidate content changed between precheck and write; the precheck verdict does not carry over (29 §13) — re-run the precheck on the current content",
        { expected_candidate_fingerprint: expectedCandidateFingerprint, actual_candidate_fingerprint: actual },
      );
    }
  }

  const { frontmatter, body } = evaluated.value;
  const typeDir = join(factSourceRoot, DEVLOG_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  return success({ object_uid: uid, file: filePath, fingerprint: fileFingerprint(content) });
}

/** Deterministic fingerprint of a create candidate (29 §13 双入口一致性). */
export function computeDevLogCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown) {
  const canonical = stableStringify(frontmatterDraft ?? null) + "\u0000" + String(bodyMarkdown ?? "");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Read-only mechanical precheck for a DevLog create candidate (29 §13 提请前
 * 机械预检). Touches nothing; mints no identity; runs the SAME validator the
 * write path runs.
 */
export async function precheckDevLogCreate({ factSourceRoot, frontmatterDraft, bodyMarkdown, gitCommitResolver = null }) {
  const evaluated = await evaluateCreateCandidate({
    factSourceRoot,
    frontmatterDraft,
    bodyMarkdown,
    signature: { provider: "(precheck)", model: "(precheck)" },
    objectUid: PRECHECK_PLACEHOLDER_UID,
    gitCommitResolver,
  });
  const candidateFingerprint = computeDevLogCreateCandidateFingerprint(frontmatterDraft, bodyMarkdown);
  if (!evaluated.ok) {
    return success({
      mechanical_outcome: evaluated.error.code === "devlog/frontmatter_invalid"
        || evaluated.error.code === "devlog/body_invalid"
        || evaluated.error.code === "devlog/coherence_invalid"
        || evaluated.error.code === "devlog/initial_state_violation"
        || evaluated.error.code === "devlog/serves_unresolvable"
        || evaluated.error.code === "devlog/absorbed_into_unresolvable"
        || evaluated.error.code === "devlog/superseded_by_unresolvable"
        || evaluated.error.code === "devlog/target_not_found"
        ? "failed"
        : "unverifiable",
      candidate_fingerprint: candidateFingerprint,
      issues: evaluated.error.details?.issues ?? [evaluated.error.message],
      error_code: evaluated.error.code,
      error_message: evaluated.error.message,
    });
  }
  return success({
    mechanical_outcome: "passed",
    candidate_fingerprint: candidateFingerprint,
    issues: [],
    normalized: {
      title: evaluated.value.frontmatter.title,
      status: evaluated.value.frontmatter.status,
      occurred_at: evaluated.value.frontmatter.occurred_at,
      summary_length: evaluated.value.frontmatter.summary.length,
      serves: evaluated.value.frontmatter.serves ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Read (specs/02 §9.2 precise read-back)
// ---------------------------------------------------------------------------

/**
 * 把模型面可能给出的四种书写形态归一为 canonical `object_uid`（workcase-410750b0）。
 *
 * 纯形态解析不读文件；只有短标识形态才触发载体反查。失败时按 `devlog/invalid_uid`
 * 报告具体原因——「形态写错」「类型未登记」「短标识不存在／碰撞」「项目前缀不是
 * 本项目」「类型前缀与本入口不符」五种要分开，否则调用方不知道该怎么改。
 */
async function resolveDevLogObjectUid(factSourceRoot, input, currentProjectId = null) {
  const parsed = parseObjectIdentifier(input);
  if (!parsed.ok) {
    return { ok: false, error: failure("devlog/invalid_uid", `${parsed.error.code}: ${parsed.error.message}`) };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  // 项目前缀只在本层能判：解析器不知道当前会话属于哪个项目，故由调用方传入。
  if (projectId !== undefined && currentProjectId !== null && projectId !== currentProjectId) {
    return { ok: false, error: failure("devlog/invalid_uid", `foreign_project: identifier targets project "${projectId}", but this session is governed by "${currentProjectId}" — cross-project reads are not supported by this entry`) };
  }
  if (objectUid !== undefined) {
    if (declaredType !== undefined && declaredType !== "devlog") {
      return { ok: false, error: failure("devlog/invalid_uid", `type_prefix_mismatch: identifier declares type "${declaredType}", but this entry reads "devlog" objects`) };
    }
    return { ok: true, objectUid };
  }
  const resolved = await resolveShortId({ factSourceRoot, shortId, declaredType: declaredType ?? "devlog" });
  if (!resolved.ok) {
    const extra = resolved.error.candidates === undefined ? "" : `; candidates: ${resolved.error.candidates.join(", ")}`;
    return { ok: false, error: failure("devlog/invalid_uid", `${resolved.error.code}: ${resolved.error.message}${extra}`) };
  }
  if (resolved.value.factTypeKey !== "devlog") {
    return { ok: false, error: failure("devlog/invalid_uid", `type_prefix_mismatch: short id "${shortId}" resolves to a ${resolved.value.factTypeKey} object, but this entry reads "devlog" objects`) };
  }
  return { ok: true, objectUid: resolved.value.objectUid };
}

export async function readDevLogObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, currentProjectId = null } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  const uidResolution = await resolveDevLogObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
  const filePath = objectFilePath(factSourceRoot, objectUid);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return failure("devlog/not_found", `no DevLog carrier at ${filePath}`);
    return failure("devlog/read_failed", String(error?.message || error));
  }
  const parsed = splitFrontmatter(raw);
  if (!parsed.ok) return failure("devlog/carrier_invalid", `${filePath}: ${parsed.reason}`);
  const fmCheck = validateDevLogFrontmatter(parsed.frontmatter);
  const bodyCheck = validateDevLogBodyStructure(parsed.body, parsed.frontmatter.title, parsed.frontmatter.status);
  const coherenceCheck = validateCarrierCoherence(parsed.frontmatter, parsed.body);
  return success({
    object_uid: objectUid,
    file: filePath,
    fingerprint: fileFingerprint(raw),
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    mechanical_issues: [...fmCheck.issues, ...bodyCheck.issues, ...coherenceCheck.issues],
    body_valid: bodyCheck.ok,
  });
}

// ---------------------------------------------------------------------------
// Update (specs/02 §10.5 — CAS + 完整目标 after；+ specs/29 §9, §13)
// ---------------------------------------------------------------------------

export async function updateDevLogObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint, frontmatterAfter, frontmatterRemovals = null,
    bodyMarkdownAfter, changeSummary, sessionSignature = null, gitCommitResolver = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!assertValidUid(objectUid)) {
    return failure("devlog/invalid_uid", `objectUid must be a canonical UUIDv4, got ${JSON.stringify(objectUid)}`);
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("devlog/change_summary_required", "changeSummary is required for update (02 §10.5: exactly one change_log entry per actual modification)");
  }

  const filePath = objectFilePath(factSourceRoot, objectUid);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return failure("devlog/not_found", `no DevLog carrier at ${filePath}`);
    return failure("devlog/read_failed", String(error?.message || error));
  }

  const baselineFingerprint = fileFingerprint(raw);
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return failure("devlog/fingerprint_required", "expectedFingerprint is required (02 §10.5 CAS baseline)");
  }
  if (expectedFingerprint !== baselineFingerprint) {
    return failure("devlog/fingerprint_mismatch", `CAS baseline mismatch: expected ${expectedFingerprint}, current ${baselineFingerprint}`, { current_fingerprint: baselineFingerprint });
  }

  const parsed = splitFrontmatter(raw);
  if (!parsed.ok) return failure("devlog/carrier_invalid", `${filePath}: ${parsed.reason}`);
  const before = parsed.frontmatter;

  // 29 §9.2 终态不可重开: absorbed/superseded/dropped are read-only.
  if (TERMINAL_STATUSES.has(before.status)) {
    return failure(
      "devlog/terminal_readonly",
      `object is status=${before.status}; 29 §9.2 forbids any transition out of a terminal state — if the conclusion carries weight again, create a NEW entry that says so (§9.2 不存在的转换)`,
    );
  }

  if (frontmatterAfter !== null && frontmatterAfter !== undefined && typeof frontmatterAfter !== "object") {
    return failure("invalid_request", "frontmatterAfter must be an object when provided");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter (complete target body markdown) is required for update");
  }

  const now = new Date().toISOString();
  const built = buildUpdateFrontmatter({
    currentFrontmatter: before,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: DEVLOG_REMOVABLE_FIELDS,
    typeLabel: "devlog",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const next = built.value;

  // Identity fields are Code-owned and immutable across updates.
  next.object_uid = before.object_uid;
  next.fact_type_key = DEVLOG_TYPE_KEY;
  next.created_at = before.created_at;

  const targetStatus = next.status ?? before.status;
  if (!STATUSES.has(targetStatus)) {
    return failure("devlog/frontmatter_invalid", `status: must be one of active/absorbed/superseded/dropped (29 §9), got ${JSON.stringify(targetStatus)}`);
  }
  next.status = targetStatus;

  let transition = "supplement";
  if (before.status === "active" && targetStatus === "active") {
    transition = "supplement";
  } else if (before.status === "active" && targetStatus === "absorbed") {
    transition = "absorb";
    // 29 §9.1: absorbed requires a resolvable absorbed-into edge AND a semantic
    // judgement that the absorbing carrier really covers the conclusion. The
    // mechanical layer can only refuse an edge that does not resolve.
    if (typeof next.summary !== "string" || next.summary.trim().length === 0) {
      return failure("devlog/summary_required", "absorbed requires a non-empty summary to survive compression (29 §9.1 — 结论本身永不随压缩消失)");
    }
  } else if (before.status === "active" && targetStatus === "superseded") {
    transition = "supersede";
  } else if (before.status === "active" && targetStatus === "dropped") {
    transition = "drop";
    if (typeof next.disposition !== "string" || next.disposition.trim().length === 0) {
      return failure("devlog/disposition_required", "dropped requires a non-empty disposition (29 §8/§9.1: 不再承重且没有可指向的承接物)");
    }
  } else {
    return failure(
      "devlog/transition_invalid",
      `illegal transition ${before.status} → ${targetStatus} (29 §9.2: only active→active, active→absorbed, active→superseded and active→dropped exist; 终态不可重开)`,
    );
  }

  next.change_log = [...(before.change_log ?? []), { at: now, ...sig.signature, summary: changeSummary }];

  const fmCheck = validateDevLogFrontmatter(next);
  if (!fmCheck.ok) {
    return failure("devlog/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  // serves must resolve on update **only when newly set or changed**（28 §12.3 第 3 条，
  // Human 2026-11-10）：「既有 `serves` 保留原值不改写历史引用」——解析是写入那一刻
  // 的准入条件，不是每次更新的持续不变量。旧实现在更新时无条件重解，使 4 个 DevLog
  // （serves 指向已 retired 的子目标）任何内容更新都被拒。
  if (next.serves !== undefined && next.serves !== before.serves) {
    const { resolveSubGoal } = await import("./subgoal-writer.js");
    const resolved = await resolveSubGoal(factSourceRoot, next.serves);
    if (!resolved.ok) {
      return failure("devlog/serves_unresolvable", `${resolved.error.code}: ${resolved.error.message}`);
    }
  }

  // Relation targets must resolve before anything lands (02 §8.2 第 5 条).
  if (next.relations !== undefined) {
    const targets = await validateRelationTargets({ factSourceRoot, frontmatter: next, gitCommitResolver });
    if (!targets.ok) return targets;
  }

  // refs targets must resolve too (29 §12.3bis / 02 §8.2 机械校验边界).
  if (next.refs !== undefined) {
    const targets = await validateRefsTargets({ factSourceRoot, frontmatter: next });
    if (!targets.ok) return targets;
  }

  const exclusivity = await checkUidExclusive(factSourceRoot, objectUid);
  if (!exclusivity.ok) return exclusivity;

  // `bodyMarkdownAfter` is the COMPLETE target body (already carrying the H1).
  const body = bodyMarkdownAfter.trim();
  const bodyCheck = validateDevLogBodyStructure(body, next.title, next.status);
  if (!bodyCheck.ok) {
    return failure("devlog/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  // 载体内聚已降为警告层（Human 2026-11-10，`spark-f0ba9997`）：不计算、不阻断。

  const content = buildFileContent(next, body);
  await atomicWriteFile(filePath, content);

  const staleness = detectDigestStaleness({
    type: "devlog", baseline: before, next,
  });
  const warnings = staleness.stale
    ? [digestStaleMessage({ type: "devlog", changedFields: staleness.changedFields })]
    : undefined;
  return success({ object_uid: objectUid, file: filePath, fingerprint: fileFingerprint(content), transition, warnings });
}

// ---------------------------------------------------------------------------
// List (F0/F1 discovery, specs/02 §9.1 + specs/29 §12)
// ---------------------------------------------------------------------------

/**
 * Enumerate DevLog carriers. Default is active-only: 29 §12.4 registers
 * `active` as the default candidate status; terminal entries surface only on
 * precise reference, historical tracing or absorb-reverse lookup.
 */
export async function listDevLogObjects(args) {
  const { factSourceRoot, status = "active", limit = 200 } = args;
  const listed = await listDevLogIndex(factSourceRoot);
  if (!listed.ok) return listed;
  const wanted = status === "all" ? null : new Set(String(status).split(",").map((s) => s.trim()));
  const items = listed.value.items
    .filter((entry) => wanted === null || wanted.has(entry.status))
    .sort((a, b) => {
      const ao = typeof a.occurred_at === "string" ? a.occurred_at : "";
      const bo = typeof b.occurred_at === "string" ? b.occurred_at : "";
      if (ao !== bo) return ao < bo ? 1 : -1; // newest first: a timeline reads backwards
      return String(a.object_uid).localeCompare(String(b.object_uid));
    });
  const total = items.length;
  return success({ total, items: items.slice(0, limit), unreadable: listed.value.unreadable });
}

export { DEVLOG_TYPE_KEY, BODY_H2_ACTIVE, BODY_H2_ABSORBED, STATUSES, MAX_TITLE_LENGTH, COMMIT_PATTERN };
