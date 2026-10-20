/**
 * dsh-ldvh — Friction fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/26 §13 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:  flat single-file carrier
 *             (ldvh-base/frictions/friction-<uid>.md) with YAML frontmatter
 *             + markdown body. Code assigns object_uid + created_at and
 *             generates the H1 from title; creation validates the
 *             type-specific mechanical checks (closed sets, phenomenon
 *             single-sentence, impact closure, fixed H2 sections incl.
 *             conditional 处置, carrier coherence).
 *  - read:    returns frontmatter + body + file-level content
 *             fingerprint (SHA-256).
 *  - update:  CAS — two guarded lanes (26 §9):
 *               * status-preserving = 补充级: status must be field-identical
 *                 to the CAS baseline (攒账计数/现象补充/归因后补；变了就
 *                 拒绝——状态变化走流转).
 *               * state transitions (Human-gated upstream): observing→open
 *                 (threshold) / open→observing (放回留观) / observing→resolved
 *                 / →voided follow §9.2; resolved requires 1..n informs
 *                 relations with resolvable targets; resolved & voided are
 *                 terminal & read-only.
 *
 * Carrier coherence (26 §8): frontmatter phenomenon is the single
 * authoritative text — the 现象 body section must contain it verbatim.
 *
 * Red lines honoured (26 §18): no urls field, no decorative fields beyond
 * the impact closure (its consumers are anchored in §12), three body
 * sections only (ledger-light).
 */

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter } from "./after-integrity.js";
import { h2Titles, sectionContent } from "./markdown-structure.js";

// ---------------------------------------------------------------------------
// Constants (specs/26 §7, §8, §9, §11)
// ---------------------------------------------------------------------------

const FRICTION_TYPE_KEY = "friction";

/** Directory under the fact-source root that carries Friction objects. */
export const FRICTION_DIRECTORY = "frictions";

/** Fixed body H2 sections (26 §8); 处置 is conditional on resolved/voided. */
const BODY_H2_REQUIRED = ["现象", "入账依据"];
const BODY_H2_DISPOSITION = "处置";

const STATUSES = new Set(["observing", "open", "resolved", "voided"]);
const IMPACT_VALUES = new Set(["light", "medium", "heavy"]);

// 26 §13：`correct` 的补填通道只接受**新进入闭集**的字段。闭集扩张时在此登记
// （首个用例：occurrence——§8 于 2026-11 新增必填）。不在此集合内的字段一律拒绝：
// 补填本就在闭集里的字段属受控更新，不得走终态更正入口。
const CORRECT_ADDABLE_FIELDS = new Set(["occurrence", "disposition"]);

// 26 §13：`correct` 的删除通道只接受两类字段——已退出闭集者，或存在即违反 §8
// 条件约束者。闭集收缩或条件约束建立时在此登记。
const CORRECT_REMOVABLE_FIELDS = new Set(["serves", "occurrence"]);

/** Relation keys allowed for Friction (26 §11 — closed set of exactly one). */
const FRICTION_RELATION_KEYS = new Set(["informs"]);

/** informs targets resolve inside the ADR and WorkCase directories (26 §11). */
const INFORMS_TARGET_DIRS = ["adrs", "workcases"];

/** Title cap (26 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/** UUID format check (03 §6.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** 40 位 commit hash（26 §9.2 commit 例外的目标形态；短 hash 与 ref 名不接受）。 */
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

/** Closed set of frontmatter keys (26 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "phenomenon", "attribution", "attribution_ref", "impact", "relations",
  "occurrence", "disposition", "change_log",
]);

/**
 * 可经 frontmatter_removals 删除的字段（specs/02 §10.5 实现对齐；21 §14 计划步骤 1）。
 *
 * 口径：白名单 = 该类型 §8 的**条件字段**中**非「终态伴随」**者。
 * 终态伴随字段（disposition/relations/retirement_reason/retired_at）在 update 路径不可达
 * （终态只读），故不列。
 */
export const FRICTION_REMOVABLE_FIELDS = new Set(["attribution", "attribution_ref"]);

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}

/**
 * 26 §8/§11（2026-10 订正）：attribution_ref 的规范形态是对象 { object_uid }
 * （锚点型）。列表/详情投影时把两种合法承载归一到对象形态：裸 string 为存量
 * 兼容（历史载体写法），提升为 { object_uid: <string> }；对象形态取其
 * object_uid。形状不合法者返回 undefined —— 不把坏数据投影出去
 * （workcase-54d4d176 回归点：原 `typeof === 'string'` 判定把对象形态静默丢弃）。
 *
 * 这是投影归一的**唯一**权威：friction-tools.js 直接 import 本函数，不再内联
 * 副本（2026-10 复核发现 7——两份逐字等价的 copy 一旦漂移，就会出现「详情归一
 * 了、列表没归一」这类只在某一种读法上暴露的分叉）。
 */
export function normalizeAttributionRef(value) {
  if (typeof value === "string" && value.length > 0) {
    return { object_uid: value };
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.object_uid === "string" &&
    value.object_uid.length > 0
  ) {
    return { object_uid: value.object_uid };
  }
  return undefined;
}

/** Fact-type directories scanned when resolving an anchor reference. */
const ATTRIBUTION_REF_DIRS = [
  ["spark", "sparks"],
  ["workcase", "workcases"],
  ["adr", "adrs"],
  ["pitfall", "pitfalls"],
  ["research", "researches"],
  ["friction", "frictions"],
  ["norm", "norms"],
];

/**
 * 26 §8/§11 可解析性：`attribution_ref` 出现时，Code 必须核验其 object_uid 指向
 * 同项目某**已存在**的事实对象；不可解析即拒绝入账（零写）。
 *
 * 为什么必须在写流程里做、而不是只做形态校验：26 §8 的承诺是「出现时由 Code
 * 机械核验可解析」。只校验形态（uuid 长得像）等于允许一个指向空气的锚点通过，
 * 而 §12 按归因机械聚合会把这条账算到一个不存在的对象头上——形态合法但语义
 * 悬空，正是 workcase-54d4d176 那类静默错误的上游形态。
 *
 * 返回 { ok:true } 或 { ok:false, code, message }。裸 string 与对象形态都按
 * 存量兼容接受（归一后取 object_uid），形状问题由 validateFrictionFrontmatter
 * 在更早的关口拦下，这里只负责「指向的对象在不在」。
 */
async function verifyAttributionRefResolves(factSourceRoot, frontmatter) {
  const uid = normalizeAttributionRef(frontmatter.attribution_ref)?.object_uid;
  if (typeof uid !== "string" || uid.length === 0) return { ok: true }; // 未出现 = 不经此核验（26 §8：出现不强制）
  const target = uid.toLowerCase();
  for (const [, dir] of ATTRIBUTION_REF_DIRS) {
    const abs = join(factSourceRoot, dir);
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      continue; // 目录缺失 = 该类型未在本项目落地，继续扫其余类型
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(md|yaml|yml)$/.test(entry.name)) continue;
      const raw = await readFile(join(abs, entry.name), "utf8").catch(() => null);
      if (raw === null) continue;
      // 行首锚定 + 不带 \s* 前缀：只认顶层 object_uid 声明行。带 `^\s*` 会把
      // relations 成员或正文里的缩进 uid 也当成「本载体声明的身份」，那会让
      // 「引用别处出现过的 uid」被误判为可解析（fail-open 方向，2026-10 复核发现 6）。
      // 捕获值再走 UUID_PATTERN：本函数只在 writer 内部使用，直接复用同一格式常量，
      // 不让「可解析」与「合法 uid」分裂成两套判定。
      const uidMatch = raw.match(/^object_uid:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m);
      if (uidMatch && UUID_PATTERN.test(uidMatch[1]) && uidMatch[1].toLowerCase() === target) return { ok: true };
    }
  }
  return {
    ok: false,
    code: "friction/attribution_ref_unresolvable",
    message: `attribution_ref.object_uid "${uid}" does not resolve to any same-project fact object (26 §8/§11 锚点型：出现时 Code 机械核验可解析，不可解析即拒绝入账)`,
  };
}

// ---------------------------------------------------------------------------
// Validation (the mechanical slice of specs/26 §8, §9, §13, §14.1)
// ---------------------------------------------------------------------------

/**
 * phenomenon 单句陈述 (26 §8, same mechanical shape as 20/22 号):
 * at most one sentence-terminal character (。？！) and, when present,
 * it must end the string. "现象非结论" is AI review scope.
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

export function validateFrictionFrontmatter(frontmatter) {
  const issues = [];

  // Closed-set check (26 §8): unknown fields reject the object
  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 26 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || frontmatter.object_uid.length === 0) {
    issues.push("object_uid: required non-empty string");
  }
  if (frontmatter.fact_type_key !== FRICTION_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${FRICTION_TYPE_KEY}"`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (26 §8), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }

  if (typeof frontmatter.phenomenon !== "string" || frontmatter.phenomenon.length === 0) {
    issues.push("phenomenon: required non-empty string");
  } else if (!isSingleSentence(frontmatter.phenomenon)) {
    issues.push("phenomenon: must be a single readable sentence — at most one terminal (。？！) and it must end the string (26 §8)");
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")}`);
  }

  if (!IMPACT_VALUES.has(frontmatter.impact)) {
    issues.push(`impact: must be one of ${[...IMPACT_VALUES].join("/")} (26 §8)`);
  }

  // attribution (26 §8): conditional — present means non-empty (后补 via supplement).
  if (frontmatter.attribution !== undefined) {
    if (typeof frontmatter.attribution !== "string" || frontmatter.attribution.length === 0) {
      issues.push("attribution: when present must be a non-empty string (03 §6.1 — omit when not yet attributable)");
    }
  }

  // attribution_ref (26 §8/§11 锚点型, 2026-10 订正): conditional — when present
  // it must be the object form { object_uid } with a syntactically valid uuid.
  // A bare string is lifted (存量兼容) so legacy carriers keep validating; any
  // other shape rejects the frontmatter. 语义可解析性（object_uid 指向的载体
  // 真实存在）由 create/update/correct 流程核验 —— 它们握有 factSourceRoot。
  if (frontmatter.attribution_ref !== undefined) {
    const ref = frontmatter.attribution_ref;
    if (typeof ref === "string") {
      // 存量裸字符串：提升后仍须是合法 uuid（空串/乱形状拒）
      if (ref.length === 0 || !UUID_PATTERN.test(ref)) {
        issues.push("attribution_ref: bare string must be a valid object_uid uuid (26 §8/§11 锚点型)");
      }
    } else if (ref !== null && typeof ref === "object" && !Array.isArray(ref)) {
      if (typeof ref.object_uid !== "string" || ref.object_uid.length === 0 || !UUID_PATTERN.test(ref.object_uid)) {
        issues.push("attribution_ref: must be { object_uid } with a valid uuid (26 §8/§11 — 对象形态, 2026-10 订正)");
      }
    } else {
      issues.push("attribution_ref: must be { object_uid } object form (26 §8/§11)");
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Validate the relations contract (26 §11 + 02 §8.2).
 *
 * Mechanical scope: key closed set (informs only), status gating (only
 * resolved), cardinality 1..n, minimal entry/target shape, no duplicates,
 * no self-reference. Target resolvability is checked by the create/update
 * flows (they need the fact source root).
 */
export function validateFrictionRelations(frontmatter, selfUid = null) {
  const issues = [];
  const relations = frontmatter.relations;
  if (relations === undefined) return { ok: true, issues };
  if (!Array.isArray(relations)) {
    issues.push("relations: must be an array (02 §8.2)");
    return { ok: false, issues };
  }
  if (relations.length === 0) {
    issues.push("relations: when present must be non-empty (26 §11)");
    return { ok: false, issues };
  }

  // Status gating (26 §11): informs only on resolved frictions
  if (frontmatter.status !== "resolved") {
    issues.push(`relations: informs may only appear on status=resolved, got status=${JSON.stringify(frontmatter.status)} (26 §11)`);
  }

  const seen = new Set();
  for (const rel of relations) {
    if (typeof rel !== "object" || rel === null) {
      issues.push("relations[]: members must be objects");
      continue;
    }
    // 02 §8.2 公共形状: relation_key + target only
    const relExtra = Object.keys(rel).filter((k) => k !== "relation_key" && k !== "target" && k !== "evidence_locator");
    if (relExtra.length > 0) {
      issues.push(`relations[]: entry carries fields beyond relation_key/target/evidence_locator (${relExtra.join(", ")}) — 02 §8.2 公共形状`);
    }

    const key = rel.relation_key;
    if (typeof key !== "string" || !FRICTION_RELATION_KEYS.has(key)) {
      issues.push(`relations[]: relation_key ${JSON.stringify(key)} not in closed set {informs} (26 §11)`);
      continue;
    }

    const target = rel.target;
    if (typeof target !== "object" || target === null) {
      issues.push(`relations[]: target must be an object (02 §8.2)`);
      continue;
    }
    // target 的两种合法形态（02 §8.2）：`{object_uid}` 或 `{commit}`——**互斥**。
    // commit 形态是唯一允许 target 不带 object_uid 的情形：解药本身是一次受控提交、
    // 没有任何对象身份（02 §8.1 commit 形态 / 26 §9.2 commit 例外）。
    const targetKeys = Object.keys(target);
    const hasUid = typeof target.object_uid === "string";
    const hasCommit = typeof target.commit === "string";
    if (hasUid && hasCommit) {
      issues.push("relations[]: target carries both object_uid and commit — the two forms are mutually exclusive (02 §8.1 commit 形态)");
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
      // commit 形态下 evidence_locator 不得并存（后者附加在 object_uid 上）
      if (rel.evidence_locator !== undefined && rel.evidence_locator !== null) {
        issues.push("relations[]: a commit-form target must not carry evidence_locator — the two mechanisms are not mixed (02 §8.1)");
      }
      const commitDedupe = `${key}::commit:${target.commit}`;
      if (seen.has(commitDedupe)) issues.push(`relations[]: duplicate relation ${commitDedupe}`);
      seen.add(commitDedupe);
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

    // evidence_locator：公共闭集当前只有 commit 一形（02 §8.1），附加在 object_uid 上。
    const locator = rel.evidence_locator;
    if (locator !== undefined && locator !== null) {
      if (typeof locator !== "object" || locator === null) {
        issues.push(`relations[]: evidence_locator must be an object when present (02 §8.1)`);
      } else {
        const locExtra = Object.keys(locator).filter((k) => k !== "commit");
        if (locExtra.length > 0) {
          issues.push(`relations[]: evidence_locator carries unsupported key(s) ${locExtra.join(", ")} (02 §8.1 公共闭集当前只有 commit)`);
        } else if (typeof locator.commit !== "string" || !COMMIT_PATTERN.test(locator.commit)) {
          issues.push(`relations[]: evidence_locator.commit must be a 40-hex commit hash (02 §8.1); got ${JSON.stringify(locator.commit)}`);
        }
      }
    }

    if (selfUid !== null && target.object_uid === selfUid) {
      issues.push("relations[]: informs target must not be the object itself (26 §11)");
    }

    const dedupe = `${key}::${target.object_uid}`;
    if (seen.has(dedupe)) issues.push(`relations[]: duplicate relation ${key} → ${target.object_uid}`);
    seen.add(dedupe);
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Body structure + carrier coherence
// ---------------------------------------------------------------------------

/**
 * 入参 `bodyMarkdown` / `bodyMarkdownAfter` 的**形态前置**：不得自带 H1。
 *
 * 本函数的写入侧契约是「正文自 H2 起、H1 由 `assembleBody` 从 title 生成」——
 * 该契约此前**只写在错误文案里，代码从不校验**（实测 `typeof … !== "string"` 一条
 * 即为全部检查）。后果是一次真实的累积性数据损坏（2026-10-12 定位）：
 * `readFrictionObject().body` 是**含**生成式 H1 的整份正文，而调用方把它直接回传给
 * 更新入口，于是每写一次就多一个 H1。真实账本实测 3 条中招（`3048937d` H1=3、
 * `545cca82` H1=2、`bf73fad4` H1=2；其余 21 条为 1——只有被这些路径写过的才中招）。
 *
 * **为什么此前无人发现**：`validateFrictionBodyStructure` 只比对「首个非空行是否为
 * `# <title>`」、H2 序列与各段非空，**不数 H1 的个数**，故重复 H1 恰好绕过全部结构校验；
 * 而 §8.4 第 5 项的精确回读只比对 `count`/`last_at`。两条通道都给绿灯，损坏因此静默。
 *
 * 修法取「拒绝 + 指明去处」而非「静默剥离」：`bodyMarkdown*` 是调用方显式提供的
 * **完整目标正文**，静默改写它会掩盖调用方的误解（本次缺陷正是一个被掩盖的误解）；
 * 且 §8.4 要求 fail-closed。真正的剥离责任在调用方——本模块导出 `stripLeadingH1`
 * 供其使用，读-改-写路径必须先剥再传。
 *
 * @returns {{ok: true} | {ok: false, message: string}}
 */
function requireBodyWithoutH1(bodyMarkdown, fieldName) {
  // 只查**开头**的 H1：正文里作为字面内容出现的 `# ` 行（例如引用的规范片段）不受限。
  if (/^\s*#\s+\S/.test(bodyMarkdown)) {
    return {
      ok: false,
      message: `${fieldName} must NOT carry the generated H1 — the body starts at "## 现象" and the H1 is generated from title (26 §8). `
        + "The value looks like it came straight from readFrictionObject().body, which DOES include the H1; "
        + "strip it first (import { stripLeadingH1 } from \"./friction-discovery.js\") before passing it back — "
        + "otherwise every write appends one more H1 to the carrier.",
    };
  }
  return { ok: true };
}



/**
 * Validate the assembled body structure. The body passed here is the full
 * file body starting with the generated `# ${title}` H1 (26 §8).
 * 处置 section presence ⇔ status resolved/voided (26 §8 conditional).
 * Returns { ok, issues }.
 */
export function validateFrictionBodyStructure(body, title, status) {
  const issues = [];
  const expectDisposition = status === "resolved" || status === "voided";
  const expectedH2 = [...BODY_H2_REQUIRED];
  if (expectDisposition) expectedH2.push(BODY_H2_DISPOSITION);

  const lines = body.split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  if (firstNonEmpty !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 26 §8)`);
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

  // 处置 H2 presence ⇔ resolved/voided (26 §8 conditional)
  const hasDispositionH2 = h2.includes(BODY_H2_DISPOSITION);
  if (hasDispositionH2 !== expectDisposition) {
    issues.push(`body: "## 处置" section presence (${hasDispositionH2}) must match status resolved/voided (${expectDisposition}) — 26 §8 条件出现`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (26 §8): frontmatter phenomenon is the single
 * authoritative text — the 现象 body section must contain it verbatim.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const text = typeof frontmatter.phenomenon === "string" ? frontmatter.phenomenon.trim() : "";
  if (text.length === 0) return { ok: true, issues }; // presence checked in validateFrictionFrontmatter
  const content = sectionContent(body, "现象");
  if (content === null) return { ok: true, issues }; // section presence checked in body structure
  if (!content.includes(text)) {
    issues.push(`carrier coherence: 现象 section must contain phenomenon verbatim (frontmatter is the single authoritative text): "${text.slice(0, 40)}…"`);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export function frictionFileName(uid) { return `friction-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, FRICTION_DIRECTORY, frictionFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/**
 * 展示层输出序（同 spark/adr/pitfall writer 约定）：语义块在前
 * （标题/状态/现象/归因/影响/信号归属/处置），引用与身份居后，
 * change_log 沉底。只重排键序，不新增、不删除、不改值。
 */
const FRONTMATTER_FIELD_ORDER = [
  "title", "status",
  "phenomenon", "attribution", "impact",
  "relations",
  "object_uid", "fact_type_key", "created_at",
  "change_log",
];

function orderFrontmatterFields(frontmatter) {
  const ordered = {};
  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (key in frontmatter) ordered[key] = frontmatter[key];
  }
  // 闭集校验已保证无表外字段；防御性保留任何遗漏键（原序跟在表后）。
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

/** Validate objectUid format (path-injection guard). */
function assertValidUid(objectUid) {
  return typeof objectUid === "string" && UUID_PATTERN.test(objectUid);
}

/** Assemble the file body: generated H1 + caller-provided markdown. */
function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.trim()}`;
}

// ---------------------------------------------------------------------------
// Create (specs/03 §9.4 + specs/26 §13)
// ---------------------------------------------------------------------------

export async function createFrictionObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null } = args;
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
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 现象'; the H1 is generated from title)");
  }
  const createH1 = requireBodyWithoutH1(bodyMarkdown, "bodyMarkdown");
  if (!createH1.ok) return failure("invalid_request", createH1.message);

  // Code-assigned identity (03 §6.2)
  const uid = randomUUID();
  const now = new Date().toISOString();
  // Strip caller-only params (change_summary is a call argument, not object metadata)
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = FRICTION_TYPE_KEY;
  frontmatter.created_at = now;
  // 26 §9: 初态 observing — create must never enter resolved/voided
  if (frontmatter.status !== undefined && frontmatter.status !== "observing") {
    return failure("friction/initial_state_violation", `create must initialise as status=observing; got ${JSON.stringify(frontmatter.status)} (26 §9 — 销账/废弃是流转，不是初态)`);
  }
  frontmatter.status = "observing";
  // 26 §8：disposition 是终态伴随字段——创建必为 observing，故一律不得带。
  if (frontmatter.disposition !== undefined) {
    return failure("friction/frontmatter_invalid", "create must not carry disposition (26 §8: 出现 ⇔ status ∈ {resolved, voided}；初态为 observing)");
  }
  // 26 §8: occurrence 必填——创建时初值 count=1、first_at=last_at=now、
  // human_return_at=null。除 §14.2 的闭集收缩改判外，occurrence 不可缺。
  if (frontmatter.occurrence === undefined) {
    return failure("friction/frontmatter_invalid", "create must carry occurrence { count, first_at, last_at, human_return_at } (26 §8 必填)");
  }
  // 26 §11: informs relations cannot exist at creation (open)
  if (frontmatter.relations !== undefined) {
    return failure("friction/frontmatter_invalid", "create must not carry relations (26 §11: informs only attaches to a resolved transition)");
  }
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Friction 对象",
  }];

  // Validate
  const fmCheck = validateFrictionFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("friction/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateFrictionRelations(frontmatter, uid);
  if (!relCheck.ok) {
    return failure("friction/relations_invalid", "relations failed mechanical checks", { issues: relCheck.issues });
  }
  // 26 §8/§11：attribution_ref 出现时核验 object_uid 指向已存在的事实对象（零写拒绝）。
  const attrCheck = await verifyAttributionRefResolves(factSourceRoot, frontmatter);
  if (!attrCheck.ok) return failure(attrCheck.code, attrCheck.message);

  // Body structure + carrier coherence (26 §8, §14.1)
  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validateFrictionBodyStructure(body, frontmatter.title, frontmatter.status);
  if (!bodyCheck.ok) {
    return failure("friction/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("friction/coherence_invalid", "carrier coherence failed", { issues: coherenceCheck.issues });
  }

  // Write (single flat file, atomic)
  const typeDir = join(factSourceRoot, FRICTION_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);

  const fingerprint = fileFingerprint(content);
  return success({ object_uid: uid, file: filePath, fingerprint });
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2 precise read-back)
// ---------------------------------------------------------------------------

export async function readFrictionObject(args) {
  const { factSourceRoot, objectUid } = args;
  if (!assertValidUid(objectUid)) {
    return failure("friction/invalid_uid", "objectUid must be a valid UUID");
  }
  const filePath = objectFilePath(factSourceRoot, objectUid);

  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    return failure("friction/object_not_found", `cannot read object file: ${error.message}`);
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("friction/object_invalid", "file has no YAML frontmatter block");
  }

  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("friction/object_invalid", `frontmatter parse error: ${error.message}`);
  }

  const body = content.slice(fmMatch[0].length).trim();
  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const structure = validateFrictionBodyStructure(body, title, frontmatter.status);

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
// Update via CAS (specs/02 §10.5 — 完整目标 after + content_fingerprint 绑定，:333；+ specs/26 §9, §13)
// ---------------------------------------------------------------------------

export async function updateFrictionObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, frontmatterRemovals = null, bodyMarkdownAfter, changeSummary, sessionSignature = null,
    // commit 例外（26 §9.2）需要核验目标 commit 在本仓真实存在。resolver 由调用方
    // 注入（writer 不自行执行 git）；未注入时该核验 fail-closed，不静默放行。
    gitCommitResolver = null,
  } = args;
  // Human requirement 2026-09-12 + 03 §6.1 / 09 机械签名: a change_log entry is
  // signed BY CODE and may not be written unsigned. Without a branded carrier the
  // write is REFUSED; the caller reports it for Human handling (09 requires a
  // definite unavailable outcome for blank/historical sessions).
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("friction/change_summary_required", "changeSummary is required for update");
  }
  if (!assertValidUid(objectUid)) {
    return failure("friction/invalid_uid", "objectUid must be a valid UUID");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 现象')");
  }
  const updateH1 = requireBodyWithoutH1(bodyMarkdownAfter, "bodyMarkdownAfter");
  if (!updateH1.ok) return failure("invalid_request", updateH1.message);

  const current = await readFrictionObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("friction/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  // 26 §9.2: resolved 与 voided 均为终态（终态不重开；销错/记错的账按 05 事实更正修正）。
  // voided 于 2026-11 进入闭集——此前本守卫只判 resolved，新终态漏网（本单修正）。
  const prevStatus = current.value.frontmatter.status;
  if (prevStatus === "resolved" || prevStatus === "voided") {
    return failure("friction/status_terminal", `status=${prevStatus} is terminal and the object is read-only (26 §9.2); a recurring obstacle goes through a NEW ledger entry referencing this uid`);
  }

  // Build updated frontmatter; strip the call-only param
  // Build updated frontmatter — 「磁盘基线 + 显式声明变更 + 显式删除通道」
  // （specs/02 §10.5 实现对齐）：漏传的字段**继承磁盘**，不再被静默删除。
  // 需要删除必须经 frontmatter_removals 声明（限 FRICTION_REMOVABLE_FIELDS）。
  const built = buildUpdateFrontmatter({
    currentFrontmatter: current.value.frontmatter,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: FRICTION_REMOVABLE_FIELDS,
    typeLabel: "friction",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const fm = built.value;
  // ④ Code 重设托管字段
  fm.object_uid = objectUid;
  fm.fact_type_key = FRICTION_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("friction/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (observing/open/resolved/voided, 26 §9)`);
  }

  // 26 §9.3 补充边界：status 保持不变的更新是补充级（攒账计数/现象补充/
  // 归因后补）——status 与 CAS 基线逐字段一致（变了走流转，本入口即流转）。
  const isTransition = nextStatus !== prevStatus;
  // 26 §13：闭集校验只施加于目标状态，历史源状态不因闭集收缩而被拒绝。
  if (!isTransition && (prevStatus === "observing" || prevStatus === "open")) {
    if (fm.relations !== undefined) {
      return failure("friction/relations_invalid", "supplement-level update must not carry relations (26 §11: informs only attaches to a resolved transition)");
    }
  }

  // 26 §9.2 transition guards:
  if (isTransition) {
    // observing→open / open→observing：两条激活路径都不带关系（26 §9.2）
    if ((prevStatus === "observing" && nextStatus === "open") ||
        (prevStatus === "open" && nextStatus === "observing")) {
      if (fm.relations !== undefined) {
        return failure("friction/relations_invalid", `${prevStatus}→${nextStatus} must not carry relations (26 §9.2)`);
      }
    }
    // open→observing（放回留观）：须写入 human_return_at，使机械通道的
    // 阈值触发跳过该账目（26 §9.2 / 36 §9 第 4 项）
    if (prevStatus === "open" && nextStatus === "observing") {
      if (!fm.occurrence || typeof fm.occurrence !== "object" || !fm.occurrence.human_return_at) {
        return failure("friction/frontmatter_invalid", "open→observing (放回留观) must stamp occurrence.human_return_at (26 §9.2 — 机械通道须据此跳过该账目)");
      }
    }
    // observing→open（Human 主动提前排期）：须清除 human_return_at
    if (prevStatus === "observing" && nextStatus === "open" && fm.occurrence?.human_return_at) {
      return failure("friction/frontmatter_invalid", "observing→open must clear occurrence.human_return_at (26 §9.2)");
    }
    if (nextStatus === "resolved") {
      // observing/open→resolved：informs 1..n 在销账流转写入
      if (!Array.isArray(fm.relations) || fm.relations.length === 0) {
        return failure("friction/relations_invalid", "resolving requires 1..n informs relations pointing at the remedy objects (26 §9.2/§11)");
      }
    }
    // 26 §8：disposition 出现 ⇔ status=voided——废弃须带，其余状态须清。
    // resolved 不设该字段：其去向已由 informs 机械承载，另设会造出第二个来源。
    if (nextStatus === "voided") {
      if (typeof fm.disposition !== "string" || fm.disposition.trim().length === 0) {
        return failure("friction/frontmatter_invalid", "transition into voided must carry a non-empty disposition (26 §8: 废弃去向说明) — 列表卡据此呈现废弃理由");
      }
    } else if (fm.disposition !== undefined) {
      return failure("friction/frontmatter_invalid", `disposition must appear only on a voided record (26 §8: 出现 ⇔ status=voided); transition into ${nextStatus} must clear it`);
    }
    if (nextStatus === "voided") {
      // →voided：不得带关系（26 §9.1/§13）
      if (fm.relations !== undefined && Array.isArray(fm.relations) && fm.relations.length > 0) {
        return failure("friction/relations_invalid", "voided must not carry relations (26 §9.1)");
      }
    }
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  // Validate
  const fmCheck = validateFrictionFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("friction/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const relCheck = validateFrictionRelations(fm, objectUid);
  if (!relCheck.ok) {
    return failure("friction/relations_invalid", "updated relations failed mechanical checks", { issues: relCheck.issues });
  }
  // 26 §8/§11：归因锚点出现（含「归因后补」的补充级更新）时核验可解析（零写拒绝）。
  const attrCheck = await verifyAttributionRefResolves(factSourceRoot, fm);
  if (!attrCheck.ok) return failure(attrCheck.code, attrCheck.message);

  // informs targets must resolve to existing ADR/WorkCase objects (26 §11;
  // ADR 任状态可解析；WorkCase 关闭状态是审核义务，机械只查存在可解析)。
  // commit 例外（Human 裁定 2026-10-09；26 §9.2/§11）：目标为 commit 时解析走
  // `git cat-file -e <hash>^{commit}`——**要求该 commit 在本仓真实存在**，否则一样 fail-closed。
  for (const rel of fm.relations ?? []) {
    const target = rel?.target;
    if (target === null || typeof target !== "object") continue;
    // commit 须在受控仓库真实可解析——两处来源都要查：`target.commit`（02 §8.1
    // commit 形态，解药本身是一次提交）与 `evidence_locator.commit`（附加在 object_uid
    // 上的证据定位）。无 resolver 时 fail-closed——无法核验即不通过。
    for (const commitHash of [target?.commit, rel?.evidence_locator?.commit]) {
      if (typeof commitHash !== "string") continue;
      if (typeof gitCommitResolver === "function") {
        if (!(await gitCommitResolver(commitHash))) {
          return failure("friction/relation_target_unresolvable", `commit ${commitHash} does not resolve to an existing commit in this repository (02 §8.1 commit 形态)`);
        }
      } else {
        return failure("friction/relation_target_unresolvable", `commit ${commitHash} cannot be verified: this writer has no git commit resolver (fail-closed, 02 §8.1)`);
      }
    }
    const targetUid = target?.object_uid;
    if (typeof targetUid !== "string" || targetUid === objectUid) continue;
    let resolvedTarget = false;
    for (const dir of INFORMS_TARGET_DIRS) {
      for (const ext of [".md", ".yaml"]) {
        try {
          await access(join(factSourceRoot, dir, `${dir === "adrs" ? "adr" : "workcase"}-${targetUid}${ext}`));
          resolvedTarget = true;
          break;
        } catch { /* try next */ }
      }
      if (resolvedTarget) break;
    }
    if (!resolvedTarget) {
      return failure("friction/relation_target_unresolvable", `informs target ${targetUid} does not resolve to an existing ADR/WorkCase object in ${INFORMS_TARGET_DIRS.join("/")}`);
    }
  }

  // Body structure + carrier coherence on the updated object
  const body = assembleBody(fm.title, bodyMarkdownAfter);
  const bodyCheck = validateFrictionBodyStructure(body, fm.title, fm.status);
  if (!bodyCheck.ok) {
    return failure("friction/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(fm, body);
  if (!coherenceCheck.ok) {
    return failure("friction/coherence_invalid", "carrier coherence failed on update", { issues: coherenceCheck.issues });
  }

  // Atomic single-file write
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  return success({ fingerprint: fileFingerprint(content) });
}

/**
 * 终态事实更正（`correct`；26 §13，Human 决定 2026-10-09）。
 *
 * 存在理由：§9.2 要求「销错的账按 05 事实更正修正」，而本类型此前只有补充级更新
 * （机械拒绝改 status）与状态流转（终态不重开）——销错的 resolved 账无路可改。
 *
 * 可改范围：**正文（含处置段）与 relations**——恰是销账时写错的两处（02:386 事实
 * 更正与关系变更是不同动作，本入口覆盖两者）。逐字不变：status/title/phenomenon/
 * impact/attribution/created_at/change_log（Code 追加一条）。
 *
 * 与 WorkCase 的 correct 的关键差异：那里 `next` 是落盘对象的克隆、调用方**完全
 * 无法触及任何 frontmatter 字段**（只改正文）；这里 relations 是销账动作写入的产物，
 * 写错时必须能改，故显式接收 `relationsAfter` 并对其重新跑全套关系校验与解析。
 */
export async function correctFrictionObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    relationsAfter = null, bodyMarkdownAfter, changeSummary, humanAuthorization,
    // 2026-10（Human 裁定）：correct 入口可**显式删除**一个已从类型闭集移除的
    // frontmatter 字段（首个用例：serves——26 §8 于 2026-10 删除该字段，9 份
    // 存量中 1 份为 resolved 终态，无法经受控更新删除）。删除是显式声明而非
    // 隐式克隆：调用方不声明则该字段逐字继承，声明则只允许「删除」这一个动作。
    // 不得用于新增或改值——那会把终态更正变成受控更新。
    frontmatterRemovals = [],
    // 2026-11（Human 裁定）：与 frontmatterRemovals 对称的**补填**通道。闭集扩张
    // 时（新必填字段进入 §8，首个用例：occurrence），既有终态对象无法经受控更新
    // 触及，本是唯一受控补填途径。约束同 removals：只允许补填**新进入闭集的
    // 字段**、不得改已有字段的值、不得编造不可据实推得的值。
    frontmatterAdditions = null,
    sessionSignature = null, gitCommitResolver = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required (03 §10.5: 每次实际修改恰好一条 change_log)");
  }
  // 更正与其它受控更新同权限（26 §13 / 02 §10.5）；无授权记录的更正请求 fail-closed。
  if (typeof humanAuthorization !== "string" || humanAuthorization.trim().length === 0) {
    return failure("invalid_request", "humanAuthorization is required for a terminal fact correction (26 §13 终态事实更正；Human 确认；无授权记录的更正请求 fail-closed)");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body starting with '## 现象')");
  }
  const correctH1 = requireBodyWithoutH1(bodyMarkdownAfter, "bodyMarkdownAfter");
  if (!correctH1.ok) return failure("invalid_request", correctH1.message);

  const current = await readFrictionObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;
  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("friction/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }
  const fm = current.value.frontmatter;
  // 26 §13：correct 适用于 resolved 与 voided 两个终态，分两支校验。
  if (fm.status !== "resolved" && fm.status !== "voided") {
    return failure(
      "friction/correction_requires_terminal",
      `terminal fact correction applies to a RESOLVED or VOIDED record only (26 §13: 适用于 resolved 与 voided 两个终态); got status=${JSON.stringify(fm.status)} — observing/open 内容修正走补充级更新或状态流转，本入口不得承载（否则等于把更正伪装成状态转换，02 §10.5）`,
    );
  }
  if (fm.status === "voided") {
    // voided 支：relations 必须为空（informs 校验不适用，26 §13）
    const rel = fm.relations;
    if (rel !== undefined && (!Array.isArray(rel) || rel.length > 0)) {
      return failure("friction/relations_invalid", "voided correct branch: relations must be absent or empty (26 §13)");
    }
  }

  if (!Array.isArray(frontmatterRemovals)) {
    return failure("invalid_request", "frontmatterRemovals must be an array when provided (26 §13)");
  }
  // 终态判定的逐字继承：除 relations 与显式声明的字段删除外，一切取自落盘对象，
  // 调用方无法触及。
  const next = structuredClone(fm);
  const removedFields = [];
  for (const field of frontmatterRemovals) {
    // 26 §13：可删两类字段。① 已退出闭集者（serves——§8 于 2026-10 删除）；
    // ② 存在即违反 §8 条件约束者（occurrence——§14.2 豁免 `voided` 对象携带该
    // 字段，即「本不该有」；2026-11 扩围，首个实例是 3048937d 被误回填）。
    // 缺失即 no-op 的一部分（下方 body/relations/removals/additions 全未变才判
    // no-op），故此处不单独拒绝「字段本就不存在」。
    if (CORRECT_REMOVABLE_FIELDS.has(field)) {
      if (Object.prototype.hasOwnProperty.call(next, field)) {
        delete next[field];
        removedFields.push(field);
      }
      continue;
    }
    return failure(
      "friction/correction_removal_not_permitted",
      `correct may only remove fields retired from the type's closed set; got ${JSON.stringify(field)} (26 §13: 终态事实更正不得新增或改值 frontmatter)`,
    );
  }
  // 26 §13 对称的补填动作：闭集扩张时补填新进入闭集的字段。
  const addedFields = [];
  if (frontmatterAdditions !== null) {
    if (typeof frontmatterAdditions !== "object" || Array.isArray(frontmatterAdditions)) {
      return failure("invalid_request", "frontmatterAdditions must be an object when provided (26 §13)");
    }
    for (const [field, value] of Object.entries(frontmatterAdditions)) {
      // ① 只允许补填「新进入闭集」的字段——当前唯一实例是 occurrence（§8 于 2026-11
      // 新增必填）。补填本就在闭集里的字段属受控更新，不得走本入口。
      if (!CORRECT_ADDABLE_FIELDS.has(field)) {
        return failure(
          "friction/correction_addition_not_permitted",
          `correct may only add fields newly admitted to the type's closed set; got ${JSON.stringify(field)} `
          + "(26 §13: 本动作不构成「correct 可改 frontmatter 值」的先例——可补的是「字段之无」，不是「字段的值」)",
        );
      }
      // ② 已存在即拒绝：补填不用于改值（改值属受控更新或状态流转）。
      if (Object.prototype.hasOwnProperty.call(next, field)) {
        return failure(
          "friction/correction_addition_exists",
          `field ${JSON.stringify(field)} already exists on the record — frontmatterAdditions only fills a MISSING `
          + "field; changing an existing value is not this channel's business (26 §13)",
        );
      }
      // ③ 值的形状须满足 §8 的契约（object 且含 count/first_at/last_at）。
      if (field === "disposition") {
        // §8：该字段只属于 voided。补填到非 voided 对象一律拒绝。
        if (next.status !== "voided") {
          return failure("friction/frontmatter_invalid", `disposition may only be filled on a voided record (26 §8: 出现 ⇔ status=voided); got status=${JSON.stringify(next.status)}`);
        }
        if (typeof value !== "string" || value.trim().length === 0) {
          return failure("friction/frontmatter_invalid", "disposition must be a non-empty string (26 §8: 一句话废弃去向)");
        }
      }
      if (field === "occurrence") {
        if (typeof value !== "object" || value === null || Array.isArray(value)
          || !Number.isInteger(value.count) || value.count < 1
          || typeof value.first_at !== "string" || typeof value.last_at !== "string") {
          return failure(
            "friction/occurrence_invalid",
            "occurrence must be { count: integer >= 1, first_at: RFC3339, last_at: RFC3339 } (26 §8)",
          );
        }
      }
      next[field] = structuredClone(value);
      addedFields.push(field);
    }
  }
  if (relationsAfter !== null) {
    if (!Array.isArray(relationsAfter)) {
      return failure("friction/relations_invalid", "relationsAfter must be an array when provided (26 §13)");
    }
    if (fm.status === "voided") {
      // 26 §13 voided 支：relations 必须为空（informs 校验不适用）
      if (relationsAfter.length > 0) {
        return failure("friction/relations_invalid", `voided correct branch: relations must be empty (26 §13); got ${relationsAfter.length}`);
      }
    } else {
      // resolved 必有 informs（26 §11）；更正后仍须满足。
      const informsCount = relationsAfter.filter((r) => r !== null && typeof r === "object" && r.relation_key === "informs").length;
      if (informsCount === 0) {
        return failure("friction/relations_invalid", `a resolved friction must carry at least one informs relation (26 §11); got ${informsCount}`);
      }
    }
    next.relations = structuredClone(relationsAfter);
  }

  const relCheck = validateFrictionRelations(next, objectUid);
  if (!relCheck.ok) {
    return failure("friction/relations_invalid", "corrected relations failed mechanical checks", { issues: relCheck.issues });
  }
  // 26 §8/§11：correct 继承落盘 frontmatter，attribution_ref 若存在同样须可解析
  // （受控更正是唯一改终态记录的入口，不能成为绕过锚点核验的后门）。
  const attrCheck = await verifyAttributionRefResolves(factSourceRoot, next);
  if (!attrCheck.ok) return failure(attrCheck.code, attrCheck.message);

  // 关系目标解析（含 commit locator），与 update 路径同口径。
  for (const rel of next.relations ?? []) {
    // commit 两处来源都查：target.commit（解药形态）与 evidence_locator.commit（附加定位）
    for (const commitHash of [rel?.target?.commit, rel?.evidence_locator?.commit]) {
      if (typeof commitHash !== "string") continue;
      if (typeof gitCommitResolver !== "function") {
        return failure("friction/relation_target_unresolvable", `commit ${commitHash} cannot be verified: this writer has no git commit resolver (fail-closed, 02 §8.1)`);
      }
      if (!(await gitCommitResolver(commitHash))) {
        return failure("friction/relation_target_unresolvable", `commit ${commitHash} does not resolve to an existing commit in this repository (02 §8.1 commit 形态)`);
      }
    }
    const targetUid = rel?.target?.object_uid;
    if (typeof targetUid !== "string" || targetUid === objectUid) continue;
    let resolvedTarget = false;
    for (const dir of INFORMS_TARGET_DIRS) {
      for (const ext of [".md", ".yaml"]) {
        try {
          await access(join(factSourceRoot, dir, `${dir === "adrs" ? "adr" : "workcase"}-${targetUid}${ext}`));
          resolvedTarget = true;
          break;
        } catch { /* try next */ }
      }
      if (resolvedTarget) break;
    }
    if (!resolvedTarget) {
      return failure("friction/relation_target_unresolvable", `informs target ${targetUid} does not resolve to an existing ADR/WorkCase object in ${INFORMS_TARGET_DIRS.join("/")}`);
    }
  }

  // 正文结构 + 载体内聚（26 §13；resolved 的处置段必在）。
  const body = assembleBody(next.title, bodyMarkdownAfter);
  const bodyCheck = validateFrictionBodyStructure(body, next.title, next.status);
  if (!bodyCheck.ok) {
    return failure("friction/body_invalid", "corrected body failed structural checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(next, body);
  if (!coherenceCheck.ok) {
    return failure("friction/coherence_invalid", "carrier coherence failed on correction", { issues: coherenceCheck.issues });
  }

  // no-op 拒绝（审核发现⑤）：正文与 relations 均未变时不得追加一条声称更正过的
  // change_log——那会让账目历史出现「改过但其实没改」的假记录（02 §10.5 不记录 no-op）。
  // 正文比对去尾随空白：落盘时末尾恒有一个换行，直接比对会把每次调用都当成「有改动」。
  const trimEnd = (text) => text.replace(/\s+$/, "");
  const bodyUnchanged = trimEnd(assembleBody(fm.title, bodyMarkdownAfter)) === trimEnd(current.value.body);
  // relations 比对必须**键序无关**（审核复审发现 A）：JSON.stringify 对键序敏感，
  // 而 relations 经 YAML 落盘后键序由序列化器决定。调用方以等价键序重传会被误判为
  // 「有变更」，从而追加一条声称更正过的 change_log——恰是本条要防的假记录形态。
  // 故按 schema 规范化（每条关系固定取 relation_key / target.object_uid /
  // evidence_locator.commit）后逐字段比较。
  //
  // **与 `validateFrictionRelations` 的闭集是两处独立字面量**（第三轮复审遗留建议）：
  // 扩 relations schema（02 §8.2 公共形状）时**两处必须同步更新**。当前假 no-op 风险
  // 被 validate 的前置校验封闭（extra 字段在到达这里之前已被拒），故不可达；但若先放宽
  // validate 而忘了这里，新字段会被本函数**静默丢弃**——两个仅在该字段上不同的 relations
  // 会被判「无变更」，从而漏掉一次真实更正。
  const normalizeRelations = (rels) => {
    const list = Array.isArray(rels) ? rels : [];
    return list.map((rel) => {
      const source = rel !== null && typeof rel === "object" ? rel : {};
      return {
        relation_key: source.relation_key ?? null,
        object_uid: source.target?.object_uid ?? null,
        // 两处 commit 来源都要投影：target.commit（02 §8.1 解药形态）与
        // evidence_locator.commit（附加定位）。只投影其一会让「仅改另一处 commit」
        // 的真实变更被判成无变更。
        target_commit: source.target?.commit ?? null,
        locator_commit: source.evidence_locator?.commit ?? null,
      };
    });
  };
  const relationsUnchanged = JSON.stringify(normalizeRelations(next.relations))
    === JSON.stringify(normalizeRelations(fm.relations));
  if (bodyUnchanged && relationsUnchanged && removedFields.length === 0 && addedFields.length === 0) {
    return failure("friction/no_op", "correction would change neither the body, the relations, the removed fields nor the added fields — 02 §10.5 不记录 no-op；refusing to append a change_log entry that claims a correction happened");
  }

  // 变更摘要内嵌授权文本（审核发现②：授权须逐字留痕，不能只「必填」后丢弃）。
  // 措辞对齐 21 号 correct，便于读者识别这是「终态事实更正」而非一次状态推进。
  next.change_log = [...(fm.change_log ?? []), {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: `事实更正（非状态转换）——${changeSummary}。终态判定未变：status/title/phenomenon/impact/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter 值（两处例外，均为「字段之有无」而非「字段之值」：① 2026-10 起可显式删除已退出类型闭集的字段，本次删除：${removedFields.length > 0 ? removedFields.join("、") : "无"}；② 2026-11 起可补填新进入类型闭集的字段，本次补填：${addedFields.length > 0 ? addedFields.join("、") : "无"}），不得改值；其余可改范围为正文与 relations（26 §13）。经 Human 授权：${humanAuthorization.trim()}`,
  }];
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(next, body);
  await atomicWriteFile(filePath, content);
  return success({ fingerprint: fileFingerprint(content) });
}

// ---------------------------------------------------------------------------
// List / F0–F1 discovery (specs/03 §8, specs/26 §12)
// ---------------------------------------------------------------------------

/**
 * Enumerate Friction objects (F0/F1: deterministic filter + minimal
 * projection). Default status filter: open + observing (26 §12: observing 是
 * 活账——攒够待修的候选源；resolved 与 voided 均为终态，仅精确引用/历史追溯
 * 时展开)；includeResolved（历史命名，语义为「含全部终态」）includes all.
 * Files that fail to parse are reported in `invalid` — never skipped silently.
 */
export async function listFrictionObjects(args) {
  const { factSourceRoot, includeResolved = false, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }

  const typeDir = join(factSourceRoot, FRICTION_DIRECTORY);
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return success({ items: [], total: 0, complete: true, invalid: [] });
    }
    return failure("friction/directory_unavailable", `cannot read frictions directory: ${error.message}`);
  }

  const invalid = [];
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const nameMatch = entry.name.match(/^friction-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i);
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
    // 26 §12：默认候选含 open 与 observing；resolved 与 voided 为终态，仅在
    // 「精确引用/历史追溯」时展开。参数名 includeResolved 沿用历史命名，其实际
    // 语义是「包含全部终态」（resolved + voided）——两个终态一并由此开关控制。
    if (!includeResolved && (status === "resolved" || status === "voided")) continue;
    items.push({
      object_uid: uid,
      // 02 §9.3（候选条款）：类型短名进投影，使渲染层能直接给出「类型短名 + 短标识」
      // 的指称形态，而不必在渲染点硬编码类型短名（那会形成第二权威）。
      fact_type_key: typeof frontmatter.fact_type_key === "string" ? frontmatter.fact_type_key : "",
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      impact: typeof frontmatter.impact === "string" ? frontmatter.impact : "",
      attribution: typeof frontmatter.attribution === "string" ? frontmatter.attribution : undefined,
      // 26 §8/§11（2026-10 订正）：attribution_ref 是对象形态 { object_uid }
      // （锚点型）。原 `typeof === 'string'` 判定把真实载体的对象形态静默丢弃
      // （workcase-54d4d176）。裸 string 为存量兼容，归一为对象形态后投影。
      attribution_ref: normalizeAttributionRef(frontmatter.attribution_ref),
      // 26 §8 两条 UI 消费字段：occurrence 是「攒到什么程度」的直接依据（留观/待修
      // 的判断输入），disposition 是 voided 的废弃理由（列表卡终态框直读，不必进
      // 详情页）。二者都在 F1 投影内——不投影则卡面无从呈现。
      occurrence: frontmatter.occurrence && typeof frontmatter.occurrence === "object" ? frontmatter.occurrence : undefined,
      disposition: typeof frontmatter.disposition === "string" ? frontmatter.disposition : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }

  // Newest first — the natural order for dedup scans and resumption.
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  const projected = complete ? items : items.slice(0, limit);
  return success({ items: projected, total: items.length, complete, invalid });
}

// Exported for the schema/writer agreement guard (test/schema-writer-agreement.test.mjs):
// the tool-plane JSON Schema must admit every field this closed set accepts, and a
// field added here without a matching schema entry is unreachable via the tools.
export { VALID_FM_KEYS };
// 导出状态闭集供类型契约测试断言（test/friction-four-state.test.mjs）：闭集是
// 26 §9 的机械口径，测试必须对着它而非复制一份字面量，否则规范与代码同时漂移。
export { STATUSES as STATUSES_EXPORT_FOR_TEST };
// 导出补填通道的白名单供契约测试断言（test/friction-four-state.test.mjs 的姊妹
// 断言）：26 §13 只允许补填「新进入闭集」的字段，当前唯一实例是 occurrence。
export { CORRECT_ADDABLE_FIELDS as CORRECT_ADDABLE_FIELDS_FOR_TEST };
export { CORRECT_REMOVABLE_FIELDS as CORRECT_REMOVABLE_FIELDS_FOR_TEST };
