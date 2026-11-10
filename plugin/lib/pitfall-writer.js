/**
 * dsh-ldvh — Pitfall fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/23 §13 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:  flat single-file carrier
 *             (ldvh-base/pitfalls/pitfall-<uid>.md) with YAML frontmatter +
 *             markdown body. Code assigns object_uid + created_at and
 *             generates the H1 from title; creation validates the
 *             type-specific mechanical checks (closed sets, fixed H2
 *             sections incl. conditional 证据, carrier coherence,
 *             urls⇒证据 presence).
 *  - read:    returns frontmatter + body + file-level content
 *             fingerprint (SHA-256).
 *  - update:  CAS — two guarded lanes (23 §9):
 *               * same-status updates (active→active, and the
 *                 terminal discarded→discarded errata) = 勘误与补充级:
 *                 scope must be field-identical to the CAS baseline (机械比对；
 *                 变了就拒绝——影响范围实质变化走新对象)。The supplement/
 *                 revision boundary of the other sections is AI review scope
 *                 (root-cause compatibility judgement, 23 §9.3).
 *               * active→discarded = terminal transition: disposition
 *                 (non-empty) required.
 *             Terminal objects are read-only (23 §9.2 终态不重开).
 *
 * Carrier coherence (23 §8): frontmatter scope is the single
 * authoritative text — the 影响与适用范围 body section must contain it
 * verbatim and expand around it.
 *
 * Red lines honoured (23 §18): no draft state, no six-field frontmatter
 * (analysis lives in the body), no relations edges, no severity/priority.
 */

import { createHash, randomUUID } from "node:crypto";
import { detectDigestStaleness, digestStaleMessage } from "./digest-staleness.js";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature } from "./signature-channel.js";
import { buildUpdateFrontmatter } from "./after-integrity.js";
import { scanCarrierDirectory } from "./carrier-scan.js";
import { h2Titles, countAtxHeadings, sectionContent } from "./markdown-structure.js";
import { parseObjectIdentifier, resolveShortId } from "./object-identifier.js";
import { carrierCoherenceMessage } from "./coherence-report.js";

// ---------------------------------------------------------------------------
// Constants (specs/23 §7, §8, §9)
// ---------------------------------------------------------------------------

const PITFALL_TYPE_KEY = "pitfall";

/** Directory under the fact-source root that carries Pitfall objects. */
export const PITFALL_DIRECTORY = "pitfalls";

/** Fixed body H2 sections (23 §8); 证据 is conditional on urls. */
const BODY_H2_REQUIRED = ["症状", "触发条件", "根因", "解决", "规避", "验证", "影响与适用范围"];
const BODY_H2_EVIDENCE = "证据";

// 23 §9：状态闭集两值——active（经验可信可复用，两条通道的初态）／discarded
// （经验不再适用，终态）。**2026-11-03 Human 决定取消 `draft` 待确认态**：机械
// 通道（11 §10.2 第 3 项）创建即落 active，不再有「候选等待入档」这一档；
// active → discarded 仍是唯一转换，且属 23 §16 的 Human Gate。
const STATUSES = new Set(["active", "discarded"]);

/** Title cap (23 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/** Terminal-reason cap (23 §8/§9.1: disposition ≤ 200 字符). */
const MAX_DISPOSITION_LENGTH = 200;

/** UUID format check (03 §6.1 canonical UUIDv4, version nibble 4). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Closed set of frontmatter keys (23 §8: unknown fields are rejected). */
const VALID_FM_KEYS = new Set([
  "object_uid", "fact_type_key", "title", "created_at", "status",
  "scope", "trigger_signal", "urls", "disposition", "change_log", "recall_digest",
]);

/**
 * 可经 frontmatter_removals 删除的字段（specs/02 §10.5 实现对齐；21 §14 计划步骤 1）。
 *
 * 口径：白名单 = 该类型 §8 的**条件字段**中**非「终态伴随」**者。
 * 终态伴随字段（disposition/relations/retirement_reason/retired_at）在 update 路径不可达
 * （终态只读），故不列。
 */
export const PITFALL_REMOVABLE_FIELDS = new Set(["urls", "trigger_signal"]);

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
// Validation (the mechanical slice of specs/23 §8, §9, §13, §14.1)
// ---------------------------------------------------------------------------

export function validatePitfallFrontmatter(frontmatter) {
  const issues = [];

  // Closed-set check (23 §8): unknown fields reject the object
  for (const k of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(k)) {
      issues.push(`frontmatter: unexpected field "${k}" (closed-set violation, 23 §8)`);
    }
  }

  if (typeof frontmatter.object_uid !== "string" || frontmatter.object_uid.length === 0) {
    issues.push("object_uid: required non-empty string");
  }
  if (frontmatter.fact_type_key !== PITFALL_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${PITFALL_TYPE_KEY}"`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.length === 0) {
    issues.push("title: required non-empty string");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} characters (23 §8), got ${frontmatter.title.length}`);
  }
  if (typeof frontmatter.created_at !== "string" || frontmatter.created_at.length === 0) {
    issues.push("created_at: required non-empty string (Code-assigned)");
  }

  if (typeof frontmatter.scope !== "string" || frontmatter.scope.length === 0) {
    issues.push("scope: required non-empty string");
  }

  // trigger_signal (23 §8): conditional — present means non-empty.
  if (frontmatter.trigger_signal !== undefined) {
    if (typeof frontmatter.trigger_signal !== "string" || frontmatter.trigger_signal.length === 0) {
      issues.push("trigger_signal: when present must be a non-empty string (03 §6.1 — omit when not applicable)");
    }
  }

  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")}`);
  }

  // urls (23 §8/§10): conditional, non-empty when present, HTTP(S) refs;
  // source-traceability semantics follow 06 §5.
  if (frontmatter.urls !== undefined) {
    if (!Array.isArray(frontmatter.urls) || frontmatter.urls.length === 0) {
      issues.push("urls: when present must be a non-empty array (03 §6.1 — omit when not applicable)");
    } else {
      const refs = new Set();
      for (const u of frontmatter.urls) {
        if (typeof u !== "object" || u === null) {
          issues.push("urls[]: must be objects");
          continue;
        }
        if (typeof u.ref !== "string" || !u.ref.startsWith("http")) {
          issues.push(`urls[].ref: must be an absolute HTTP(S) URL, got ${JSON.stringify(u.ref)}`);
        }
        if (refs.has(u.ref)) issues.push(`urls[].ref: duplicate ref ${u.ref}`);
        refs.add(u.ref);
      }
    }
  }

  // disposition ⇔ discarded (23 §8: 出现 ⇔ discarded)。
  // 非终态（只剩 active，2026-11-03 取消 draft 后）一律禁现 disposition；
  // 此处按状态值分支而非按「是否终态」分支，故新增非终态档时须同步加分支。
  if (frontmatter.status === "discarded") {
    if (typeof frontmatter.disposition !== "string" || frontmatter.disposition.length === 0) {
      issues.push("disposition: required non-empty when status=discarded (23 §8)");
    } else if (frontmatter.disposition.length > MAX_DISPOSITION_LENGTH) {
      // 23 §9.1: the terminal reason is a scannable locator, not the full
      // disposal record. Reject rather than truncate.
      issues.push(`disposition: must be ≤ ${MAX_DISPOSITION_LENGTH} characters (23 §9.1), got ${frontmatter.disposition.length}`);
    }
  } else if (frontmatter.disposition !== undefined) {
    issues.push(`disposition: must not be present when status=${frontmatter.status} (23 §8: disposition ⇔ discarded)`);
  }

  return { ok: issues.length === 0, issues };
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
 * file body starting with the generated `# ${title}` H1 (23 §8).
 * 证据 section presence ⇔ urls non-empty (23 §8 conditional). Returns
 * { ok, issues }.
 */
export function validatePitfallBodyStructure(body, title, urlsCount) {
  const issues = [];
  const expectEvidence = urlsCount > 0;
  const expectedH2 = [...BODY_H2_REQUIRED];
  if (expectEvidence) expectedH2.push(BODY_H2_EVIDENCE);

  const lines = body.split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  // Compare against the generated heading tolerating the CommonMark-legal
  // spellings of the same ATX heading (indentation, tab separator, trailing
  // spaces) — otherwise a valid carrier with trailing spaces is rejected.
  if (firstNonEmpty.trimEnd().replace(/^ {0,3}/, "").replace(/(?<=^#+)[ \t]+/, " ") !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 23 §8)`);
  }
  // Exactly one H1: the title heading is the only level-1 heading, and the body
  // starts at H2. Checking the first line alone would let an extra `# <title>`
  // further down slip through. The scan follows CommonMark ATX semantics
  // (≤3 leading spaces, space/tab after the hashes, trailing spaces allowed)
  // and skips fenced code blocks, where a `#` is literal text, not a heading.
  const h1Count = countAtxHeadings(body, 1);
  if (h1Count !== 1) {
    issues.push(`body: expected exactly 1 H1 heading, found ${h1Count} (23 §8: H1 由 Code 从 title 生成，正文自 H2 起)`);
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

  // 证据 H2 presence ⇔ non-empty urls (23 §8 conditional)
  const hasEvidenceH2 = h2.includes(BODY_H2_EVIDENCE);
  if (hasEvidenceH2 !== expectEvidence) {
    issues.push(`body: "## 证据" section presence (${hasEvidenceH2}) must match non-empty urls (${expectEvidence}) — 23 §8 条件出现`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (23 §8): frontmatter scope is the single authoritative
 * text — the 影响与适用范围 body section must contain it verbatim.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const text = typeof frontmatter.scope === "string" ? frontmatter.scope.trim() : "";
  if (text.length === 0) return { ok: true, issues }; // presence checked in validatePitfallFrontmatter
  const content = sectionContent(body, "影响与适用范围");
  if (content === null) return { ok: true, issues }; // section presence checked in body structure
  if (!content.includes(text)) {
    // 判据不变（仍要求逐字包含），但报错必须**可据以修正**：只给截断到 40 字的
    // scope 前缀时，调用方看不出「差在哪」。实测 2026-10-17 的两次失败分别是
    // 「scope 以 `。` 收尾，正文用 `；` 续写了半句」与「正文段开头多写了
    // `适用范围：`、并给术语补了反引号」——两者都与 scope 高度相似，前缀无从
    // 区分。故此处给出 scope 全文与正文该段全文（段落过长时才截断），
    // 让差异在报错里直接可见。
    // 2026-11-04（workcase-5c0b8c2e）：本处原自带一份 clipped 实现且不带章节号。
    // 改为与其余八类共用 coherence-report.js，并补上 23 §8 的条款依据——此前的
    // 「无条款号」使复核无法据报错定位规则来源，而它是本单推广面之外的样板，
    // 措辞不统一会让读报错的人以为不同类别的拒绝依据不同。
    issues.push(carrierCoherenceMessage({
      section: "影响与适用范围", field: "scope", declared: text, actual: content,
      clause: "23 §8, §14.1",
    }));
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export function pitfallFileName(uid) { return `pitfall-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, PITFALL_DIRECTORY, pitfallFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  return `---\n${stringifyYaml(orderFrontmatterFields(frontmatter), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/**
 * 展示层输出序（同 spark/adr writer 约定）：语义块在前
 * （标题/状态/范围/信号/终态去向），引用与身份居后，change_log 沉底。
 * 只重排键序，不新增、不删除、不改值。
 */
const FRONTMATTER_FIELD_ORDER = [
  "title", "status",
  "scope", "trigger_signal",
  "disposition",
  "urls",
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

/** Count urls entries (0 when absent). */
function urlsCount(frontmatter) {
  return Array.isArray(frontmatter.urls) ? frontmatter.urls.length : 0;
}

// ---------------------------------------------------------------------------
// Create (specs/03 §9.4 + specs/23 §13)
// ---------------------------------------------------------------------------

export async function createPitfallObject(args) {
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
    return failure("invalid_request", "bodyMarkdown is required (the markdown body starting with '## 症状'; the H1 is generated from title)");
  }

  // Code-assigned identity (03 §6.2)
  const uid = randomUUID();
  const now = new Date().toISOString();
  // Strip caller-only params (change_summary is a call argument, not object metadata)
  const { change_summary: _stripped, ...draftFields } = frontmatterDraft;
  const frontmatter = { ...draftFields };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = PITFALL_TYPE_KEY;
  frontmatter.created_at = now;
  // 23 §13：创建分两条通道，初态依通道而异——
  //   机械通道（11 §10 经验积累）与 Human 入口都直接创建 `active`——2026-11-03
  //     Human 决定取消 `draft` 待确认态后，**创建与入档是同一个决定**，两条通道
  //     的差别只剩「谁提出」，不再是「落什么状态」。废止（active→discarded）仍属
  //     23 §16 的 Human Gate，且是事后动作，不在创建段。
  // 无论哪条通道，都不得以 create 进入终态 discarded。
  //
  // **status 仍必须由调用方显式给出（2026-10-20）**：省略时拒绝，不替调用方猜。
  // 保留这条硬要求是因为「省略」会把「谁决定创建」这件事一起省掉——它本身就是
  // 23 §16 需要看见的信息，即便现在唯一的合法值只有 active。
  const requestedStatus = frontmatter.status;
  if (requestedStatus === undefined || requestedStatus === null) {
    return failure("pitfall/status_required", "create must state status explicitly: status=active (23 §13 — both the Human entry and the 11 §10.2 mechanical channel create active; the draft candidate state was cancelled 2026-11-03). Omission is refused: there is no default, because the caller must state which decision this creation carries (23 §8/§13/§16)");
  }
  if (requestedStatus !== "active") {
    return failure("pitfall/initial_state_violation", `create must initialise as status=active; got ${JSON.stringify(requestedStatus)} (23 §9/§13: active is the only initial state — the draft candidate state was cancelled 2026-11-03)`);
  }
  frontmatter.status = requestedStatus;
  // 23 §8: disposition cannot exist at creation
  if (frontmatter.disposition !== undefined) {
    return failure("pitfall/frontmatter_invalid", "create must not carry disposition (23 §8: disposition ⇔ discarded)");
  }
  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft.change_summary ?? "受控创建 Pitfall 对象",
  }];

  // Validate
  const fmCheck = validatePitfallFrontmatter(frontmatter);
  if (!fmCheck.ok) {
    return failure("pitfall/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  // Body structure + carrier coherence (23 §8, §14.1)
  const body = assembleBody(frontmatter.title, bodyMarkdown);
  const bodyCheck = validatePitfallBodyStructure(body, frontmatter.title, urlsCount(frontmatter));
  if (!bodyCheck.ok) {
    return failure("pitfall/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  // 载体内聚已降为警告层（Human 2026-11-10，`spark-f0ba9997`）：不再计算、不再阻断。
  // 需要差异报告时调用 validateCarrierCoherence，它仍是导出的纯函数。

  // Write (single flat file, atomic)
  const typeDir = join(factSourceRoot, PITFALL_DIRECTORY);
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

/**
 * 把模型面可能给出的四种书写形态归一为 canonical `object_uid`（workcase-410750b0）。
 *
 * 纯形态解析不读文件；只有短标识形态才触发载体反查。失败时按 `pitfall/invalid_uid`
 * 报告具体原因——「形态写错」「类型未登记」「短标识不存在／碰撞」「项目前缀不是
 * 本项目」「类型前缀与本入口不符」五种要分开，否则调用方不知道该怎么改。
 */
async function resolvePitfallObjectUid(factSourceRoot, input, currentProjectId = null) {
  const parsed = parseObjectIdentifier(input);
  if (!parsed.ok) {
    return { ok: false, error: failure("pitfall/invalid_uid", `${parsed.error.code}: ${parsed.error.message}`) };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  // 项目前缀只在本层能判：解析器不知道当前会话属于哪个项目，故由调用方传入。
  if (projectId !== undefined && currentProjectId !== null && projectId !== currentProjectId) {
    return { ok: false, error: failure("pitfall/invalid_uid", `foreign_project: identifier targets project "${projectId}", but this session is governed by "${currentProjectId}" — cross-project reads are not supported by this entry`) };
  }
  if (objectUid !== undefined) {
    if (declaredType !== undefined && declaredType !== "pitfall") {
      return { ok: false, error: failure("pitfall/invalid_uid", `type_prefix_mismatch: identifier declares type "${declaredType}", but this entry reads "pitfall" objects`) };
    }
    return { ok: true, objectUid };
  }
  const resolved = await resolveShortId({ factSourceRoot, shortId, declaredType: declaredType ?? "pitfall" });
  if (!resolved.ok) {
    const extra = resolved.error.candidates === undefined ? "" : `; candidates: ${resolved.error.candidates.join(", ")}`;
    return { ok: false, error: failure("pitfall/invalid_uid", `${resolved.error.code}: ${resolved.error.message}${extra}`) };
  }
  if (resolved.value.factTypeKey !== "pitfall") {
    return { ok: false, error: failure("pitfall/invalid_uid", `type_prefix_mismatch: short id "${shortId}" resolves to a ${resolved.value.factTypeKey} object, but this entry reads "pitfall" objects`) };
  }
  return { ok: true, objectUid: resolved.value.objectUid };
}

export async function readPitfallObject(args) {
  const { factSourceRoot, objectUid: objectUidInput, currentProjectId = null } = args;
  const uidResolution = await resolvePitfallObjectUid(factSourceRoot, objectUidInput, currentProjectId);
  if (!uidResolution.ok) return uidResolution.error;
  const objectUid = uidResolution.objectUid;
  const filePath = objectFilePath(factSourceRoot, objectUid);

  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    return failure("pitfall/object_not_found", `cannot read object file: ${error.message}`);
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("pitfall/object_invalid", "file has no YAML frontmatter block");
  }

  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("pitfall/object_invalid", `frontmatter parse error: ${error.message}`);
  }

  const body = content.slice(fmMatch[0].length).trim();
  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const structure = validatePitfallBodyStructure(body, title, urlsCount(frontmatter));

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
// Update via CAS (specs/02 §10.5 — 完整目标 after + content_fingerprint 绑定，:333；+ specs/23 §9, §13)
// ---------------------------------------------------------------------------

export async function updatePitfallObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, frontmatterRemovals = null, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;
  // Human requirement 2026-09-12 + 03 §6.1 / 09 机械签名: a change_log entry is
  // signed BY CODE and may not be written unsigned. Without a branded carrier the
  // write is REFUSED; the caller reports it for Human handling (09 requires a
  // definite unavailable outcome for blank/historical sessions).
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);

  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("pitfall/change_summary_required", "changeSummary is required for update");
  }
  if (!assertValidUid(objectUid)) {
    return failure("pitfall/invalid_uid", "objectUid must be a valid UUID");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the complete target body starting with '## 症状')");
  }

  const current = await readPitfallObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;

  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("pitfall/cas_conflict", `fingerprint mismatch: expected ${expectedFingerprint}, actual ${current.value.fingerprint}`);
  }

  // 23 §9.2: a terminal state must NOT be reopened (status may not change),
  // but the object's content stays correctable via §9.3 勘误与补充级更新 — a
  // wrong or over-long terminal record is fixed in place with a change_log
  // entry, never by faking a status transition.
  const prevStatus = current.value.frontmatter.status;
  if (prevStatus === "discarded") {
    const requested = frontmatterAfter?.status;
    if (requested !== undefined && requested !== prevStatus) {
      return failure("pitfall/status_terminal", `status=discarded is terminal; reopen (status=${requested}) is forbidden (23 §9.2) — content correction via §9.3 is allowed, status reversal is not; a substantively changed mechanism goes through a NEW Pitfall object`);
    }
  }

  // Build updated frontmatter; strip the call-only param
  // Build updated frontmatter — 「磁盘基线 + 显式声明变更 + 显式删除通道」
  // （specs/02 §10.5 实现对齐）：漏传的字段**继承磁盘**，不再被静默删除。
  // 需要删除必须经 frontmatter_removals 声明（限 PITFALL_REMOVABLE_FIELDS）。
  const built = buildUpdateFrontmatter({
    currentFrontmatter: current.value.frontmatter,
    frontmatterAfter,
    frontmatterRemovals,
    removableFields: PITFALL_REMOVABLE_FIELDS,
    typeLabel: "pitfall",
    validFields: VALID_FM_KEYS,
  });
  if (!built.ok) return failure(built.error.code, built.error.message);
  const fm = built.value;
  // ④ Code 重设托管字段
  fm.object_uid = objectUid;
  fm.fact_type_key = PITFALL_TYPE_KEY;
  fm.created_at = current.value.frontmatter.created_at;

  const nextStatus = fm.status;
  if (nextStatus === undefined || !STATUSES.has(nextStatus)) {
    return failure("pitfall/status_transition_invalid", `target status ${JSON.stringify(nextStatus)} is not in the closed set (active/discarded, 23 §9)`);
  }

  // 23 §9.2：唯一的正常转换是 active→discarded（废止）。2026-11-03 取消 `draft`
  // 待确认态后，「入档」这一刻不再存在——创建即 active，故 draft→active 与
  // draft→discarded 两条随该档一并消失。此处校验目标状态是否可达，并给出不合法
  // 转换的精确原因（闭合路径，不留含糊）。
  if (prevStatus !== nextStatus) {
    const legal = prevStatus === "active" && nextStatus === "discarded";
    if (!legal) {
      return failure("pitfall/status_transition_invalid", `illegal status transition ${prevStatus} → ${nextStatus} (23 §9.2: the only legal transition is active→discarded)`);
    }
  }

  // 23 §9.1：active 不得带 disposition（disposition ⇔ discarded）。
  // （2026-11-03 取消 `draft` 后本项只剩 active 一侧；原 draft→active 的入档
  // 复现校验随该档一并消失——不是挪到别处，是不再有那一刻，见 23 §16.1。）
  if (nextStatus === "active") {
    if (fm.disposition !== undefined) {
      return failure("pitfall/frontmatter_invalid", `disposition must not be present while status=${nextStatus} (23 §8: disposition ⇔ discarded)`);
    }
  }

  // 23 §9.3 / §15 补充边界：**同态更新**（active→active 与终态的
  // discarded→discarded 勘误）都是勘误与补充级——scope 必须与 CAS 基线逐字段一致
  // （变了就不是补充：影响范围实质变化走新对象路径）。
  //
  // 判据是「状态是否变化」而不是「状态是不是 active」（2026-11-03 修正）：原实现把
  // 守恒条件写成 `nextStatus === "active"`，于是非 active 的同态更新整条漏检——
  // 一条候选可以在等待入档期间把 scope 的适用条件换掉而不留机械信号，而独立复现
  // 核对的是换之前的适用范围。终态勘误同理。取消 `draft` 后仍剩 discarded 一侧，
  // 故判据必须保持「状态未变」这一形态，不得改回绑状态值。
  //
  // 状态转换（active→discarded）不是补充更新，不受本行约束
  // （§13 对终态流转另列其检查项，不含 scope 比对）。
  if (nextStatus === prevStatus) {
    if ((fm.scope ?? "") !== (current.value.frontmatter.scope ?? "")) {
      return failure(
        "pitfall/supplement_boundary",
        `scope changed on a same-status update (${prevStatus}→${nextStatus}) — that is a real impact-range change, not an errata/supplement: create a NEW Pitfall object (23 §9.3)`,
      );
    }
  }

  const prevLog = Array.isArray(current.value.frontmatter.change_log) ? current.value.frontmatter.change_log : [];
  fm.change_log = [...prevLog, {
    at: new Date().toISOString(),
    ...sig.signature,
    summary: changeSummary,
  }];

  // Validate
  const fmCheck = validatePitfallFrontmatter(fm);
  if (!fmCheck.ok) {
    return failure("pitfall/frontmatter_invalid", "updated frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }

  // Body structure + carrier coherence on the updated object
  const body = assembleBody(fm.title, bodyMarkdownAfter);
  const bodyCheck = validatePitfallBodyStructure(body, fm.title, urlsCount(fm));
  if (!bodyCheck.ok) {
    return failure("pitfall/body_invalid", "updated body failed structure checks", { issues: bodyCheck.issues });
  }
  // 载体内聚已降为警告层（Human 2026-11-10）：更新路径同上。

  // Atomic single-file write
  const filePath = objectFilePath(factSourceRoot, objectUid);
  const content = buildFileContent(fm, body);
  await atomicWriteFile(filePath, content);

  const staleness = detectDigestStaleness({
    type: "pitfall", baseline: current.value.frontmatter, next: fm,
  });
  const warnings = staleness.stale
    ? [digestStaleMessage({ type: "pitfall", changedFields: staleness.changedFields })]
    : undefined;
  return success({ fingerprint: fileFingerprint(content), warnings });
}

// ---------------------------------------------------------------------------
// List / F0–F1 discovery (specs/03 §8, specs/23 §12)
// ---------------------------------------------------------------------------

/**
 * Enumerate Pitfall objects (F0/F1: deterministic filter + minimal
 * projection). Default status filter: active only (23 §12: discarded stays
 * out of ordinary candidates); includeTerminal includes all. Files that
 * fail to parse are reported in `invalid` — never skipped silently.
 */
export async function listPitfallObjects(args) {
  const { factSourceRoot, includeTerminal = false, statusFilter, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  // 23 §12：默认候选只含 active（2026-11-03 起 Pitfall 无待确认档，故「候选」
  // 与「已入档」是同一批对象）。statusFilter 仍是精确查询的机械入口——它现在
  // 服务的是「按状态取子集」（如只取 discarded 做历史追溯），不是候选队列。
  if (statusFilter !== undefined) {
    const wanted = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
    if (wanted.length === 0 || !wanted.every((s) => STATUSES.has(s))) {
      return failure("invalid_request", `statusFilter must be a non-empty subset of the closed set (active/discarded, 23 §9); got ${JSON.stringify(statusFilter)}`);
    }
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }

  const typeDir = join(factSourceRoot, PITFALL_DIRECTORY);
  let scanned;
  try {
    scanned = await scanCarrierDirectory(typeDir, "pitfall");
  } catch (error) {
    return failure("pitfall/directory_unavailable", `cannot read pitfalls directory: ${error.message}`);
  }
  if (scanned.missing) {
    return success({ items: [], total: 0, complete: true, invalid: [] });
  }

  const invalid = [...scanned.invalid];
  const items = [];
  for (const carrier of scanned.carriers) {
    // 身份取载体自己声明的 object_uid（02 §7.1）；文件名只参与「是否不符」的
    // 判定，该判定与记录在 `carrier-scan.js`（单点）。
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
    // statusFilter（专门查询）优先于默认候选规则。
    if (statusFilter !== undefined) {
      const wanted = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
      if (!wanted.includes(status)) continue;
    } else if (!includeTerminal && status !== "active") {
      continue;
    }
    items.push({
      object_uid: uid,
      // 02 §8 / §9 F1：F1 卡片须自证类型（同 spark 列表，此前三处一并漏掉）。
      fact_type_key: typeof frontmatter.fact_type_key === "string" ? frontmatter.fact_type_key : PITFALL_TYPE_KEY,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      scope: typeof frontmatter.scope === "string" ? frontmatter.scope : "",
      trigger_signal: typeof frontmatter.trigger_signal === "string" ? frontmatter.trigger_signal : undefined,
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
