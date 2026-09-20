/**
 * dsh-ldvh — WorkCase fact-object writer (minimal controlled writer).
 *
 * Implements the mechanical slice of specs/21 §14 (受控操作) and the
 * shared read-back/CAS contract from specs/03 §9:
 *
 *  - create:   flat single-file carrier
 *              (ldvh-base/workcases/workcase-<uid>.md) with YAML
 *              frontmatter + markdown body. Code assigns object_uid +
 *              created_at and generates the H1 from title; creation
 *              validates the type-specific mechanical checks (closed
 *              sets, plan[].done_criteria non-empty, carrier coherence,
 *              serves ⇔ goal.md SG-n resolution).
 *  - read:     returns frontmatter + body + file-level content
 *              fingerprint (SHA-256).
 *  - approve (Gate 1): draft → open. Human Gate on the flow level; the
 *              writer stamps `gate_1` (approved_at + approver supplied by
 *              the flow, authorization_fingerprint computed BY CODE over
 *              the current plan+scope, scope_snapshot copied from the
 *              current scope) and allocates the first attempt token.
 *  - execute: open-period updates — attempt heartbeat / takeover /
 *              reallocation, body progress, result drafts in the body,
 *              relations changes. plan/scope are frozen by C2: any
 *              substantive change is refused here and must go through
 *              rebatch (21 §10.3).
 *  - close (Gate 2): open → closed. Human Gate on the flow level; the
 *              writer stamps result + outcome, retracts the attempt
 *              token (收口) and validates the criteria_checks ⇔ plan
 *              correspondence.
 *  - rebatch:  open → draft (C2 局部重批). attempt voided, result /
 *              outcome cleared (invariant: result ⇔ closed), gate_1
 *              dropped (draft must not carry it); the prior evidence
 *              snapshot goes into the change_log entry (21 §9.2).
 *  - cancel:   draft → closed with outcome=cancelled (21 §9.2: 计划未
 *              经执行即被取消 — Human Gate on the flow level).
 *  - revise:   draft → draft controlled revision (plan/scope may still
 *              evolve before Gate 1; each revision = exactly one
 *              change_log entry).
 *  - list:     F0/F1 discovery projection (draft+open by default,
 *              21 §13: closed 只在精确引用、证据链反查或历史追溯时展开).
 *
 * Authorization pinning (C2, 21 §10.3): the fingerprint binds
 * gate_1.authorization_fingerprint to the content of plan+scope.
 * While status=open, every writer flow verifies the fingerprint still
 * matches; a mismatch is a C2 invalidation and the only legal path is
 * rebatch, never a silent in-place edit.
 *
 * attempt tokens (21 §10.4): monotonic, at most one active, allocated
 * by Code only. attempt_id derives from the change_log history the
 * writer itself produced (each allocation/void is recorded there), so
 * re-entry after an interruption gets a strictly higher id. The token
 * carries NO authorization — authorization only comes from Gate 1.
 *
 * Known spec tension (recorded, deliberately resolved wide at the
 * mechanical layer): 21 §8 states `gate_1 出现 ⇔ status ∈ {open,
 * closed}` while §9.2 defines a draft → closed(cancelled) path whose
 * closed state carries no Gate 1 approval. The writer enforces
 * gate_1 presence for status=open (per §9.1) and validates shape
 * whenever gate_1 is present, but does not require gate_1 on every
 * closed object — the draft-cancelled path would otherwise be
 * unrepresentable. The tension is left for the 32 号 system spec to
 * close; do not "fix" it silently here.
 *
 * Red lines honoured (21 §19): no urls field, no priority, no
 * process-log fields, no WC-to-WC relations (contributed-to → Pitfall
 * only), no multi-attempt reservation, no requirement-review state.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { requireAuthoritativeSignature, resolveAuthoritativeSessionIdentity } from "./signature-channel.js";
import { h2Titles, countAtxHeadings, sectionContent } from "./markdown-structure.js";
import { readGoalAnchors as readGoalAnchorsFromGoal } from "./goal-writer.js";

// ---------------------------------------------------------------------------
// Constants (specs/21 §7, §8, §9)
// ---------------------------------------------------------------------------

const WORKCASE_TYPE_KEY = "workcase";

/** Directory under the fact-source root that carries WorkCase objects. */
export const WORKCASE_DIRECTORY = "workcases";

/** Status closed set (21 §9): draft → open → closed. */
const STATUSES = new Set(["draft", "open", "closed"]);

/** Outcome closed set (21 §9.3): four terminal values. */
const OUTCOMES = new Set(["completed", "partial", "not-achieved", "cancelled"]);

/** Outcomes that require a non-empty residual[]. */
const RESIDUAL_REQUIRED_OUTCOMES = new Set(["partial", "not-achieved"]);

/** Body H2 sections (21 §8). 摘要/授权范围/计划 always present; 执行 and
 * 结果 are conditional (执行 ⇔ execution has happened i.e. status=open or
 * closed-with-gate_1; 结果 ⇔ closed, optional as a draft while open). */
const BODY_H2_CORE = ["摘要", "授权范围", "计划"];
const BODY_H2_EXECUTION = "执行";
const BODY_H2_RESULT = "结果";

/** Title cap (21 §8: ≤ 30 字). */
const MAX_TITLE_LENGTH = 30;

/** Relations contract (21 §12): contributed-to → Pitfall only. */
const ALLOWED_RELATION_KEYS = new Set(["contributed-to"]);
const PITFALL_DIRECTORY = "pitfalls";

const OBJECT_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SG_ANCHOR_PATTERN = /^SG-\d+$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/** Frontmatter closed set (21 §8). Anything beyond this is rejected. */
export const VALID_FM_KEYS = new Set([
  "fact_type_key", "object_uid", "title", "status",
  "gist", "serves", "summary", "scope", "plan",
  "gate_1", "attempt", "reviews", "result", "outcome",
  "relations", "created_at", "change_log",
]);

/**
 * 21 §8: `gist`（要点）的字符上限 —— 给 Human 扫读的一句话要点。
 *
 * 判定单位与 `title` 的同名上限一致（UTF-16 码元，按 `.length`），
 * 与 20 §8 / 23 §8 的 `disposition` 上限同形：上限是**扫读上限**而非表达上限，
 * 超限拒绝写入，不得截断后写入（完整叙述属 summary/正文/change_log）。
 */
export const GIST_MAX_CHARS = 200;

/** 21 §8: `reviews` 单条 `summary` 的字符上限（Human 裁定 2026-09-16）。 */
export const REVIEW_SUMMARY_MAX_CHARS = 600;

/** 21 §8: `reviews` 的条数上限（起草者按 Human「其他按你推荐」授权定为 20，比照 20 §8 evolution）。 */
export const REVIEW_ENTRIES_MAX = 20;

// ---------------------------------------------------------------------------
// Small helpers (shared conventions with the pitfall/spark writers)
// ---------------------------------------------------------------------------

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}

function success(value) {
  return { ok: true, value };
}

/**
 * 21 §8「执行」节记账纪律的**前置提示**载荷。
 *
 * 属纯告知：把当前 plan 的权威编号清单随写入响应一并交给调用方，使「计划步骤 N」
 * 的 N 有据可依，而不必回查 frontmatter。**不含任何校验或拒绝规则**——同类机械
 * 校验已被实测证伪（它抓不到纯「步骤 N」形态的原错误，却会拒绝如实引述该编号的
 * 记述，并诱使作者不写编号以规避检查）。
 *
 * 在 approve 与 execute 两处返回：approve 是授权时点、execute 是实际写正文的
 * 时点；跨会话接力时执行者未必持有 approve 的返回值，故两处都要给。
 */
function planStepReference(plan) {
  const list = Array.isArray(plan) ? plan : [];
  return {
    rule: "正文引用计划步骤时使用「计划步骤 N」，N 以本清单为界；非计划步骤的执行事项（复核、补充验证、收尾等）独立描述，不得编入计划序号（21 §8）",
    plan_length: list.length,
    steps: list.map((item, index) => ({ n: index + 1, step: item.step })),
  };
}

// h2Titles / countAtxHeadings / sectionContent 已收敛到 markdown-structure.js
// （单一权威实现）。收敛动因：同一结构判定曾在 6 个 writer 中各自实现且语义
// 分叉——本文件的实现原本跳代码围栏，而其余 5 份不跳，同一仓库内两份语义并存
// （pitfall e8cadde1 的同构复发）。各 writer 不得再各自实现结构解析。

export function workcaseFileName(uid) { return `workcase-${uid}.md`; }

function objectFilePath(factSourceRoot, uid) {
  return join(factSourceRoot, WORKCASE_DIRECTORY, workcaseFileName(uid));
}

function fileFingerprint(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildFileContent(frontmatter, body) {
  const ordered = orderFrontmatterFields(frontmatter);
  return `---\n${stringifyYaml(ordered)}---\n\n${body}\n`;
}

function orderFrontmatterFields(frontmatter) {
  const order = [
    "fact_type_key", "object_uid", "title", "status",
    "serves", "summary", "scope", "plan",
    "gate_1", "attempt", "result", "outcome",
    "relations", "created_at", "change_log",
  ];
  const out = {};
  for (const key of order) if (key in frontmatter) out[key] = frontmatter[key];
  for (const key of Object.keys(frontmatter)) if (!order.includes(key)) out[key] = frontmatter[key];
  return out;
}

async function atomicWriteFile(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}

function assertValidUid(objectUid) {
  if (typeof objectUid !== "string" || !OBJECT_UID_PATTERN.test(objectUid)) {
    return failure("workcase/invalid_uid", `object_uid must be a canonical UUIDv4, got ${JSON.stringify(objectUid)}`);
  }
  return null;
}

function assembleBody(title, bodyMarkdown) {
  return `# ${title}\n\n${bodyMarkdown.replace(/\s+$/, "")}\n`;
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stableStringify(value) {
  // Deterministic JSON (fixed key order, sorted for nested maps) so the
  // authorization fingerprint only changes with content, not ordering.
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** C2 content fingerprint over the authorized pair: plan + scope (21 §10.1). */
export function computeAuthorizationFingerprint(plan, scope) {
  const canonical = stableStringify({ plan, scope });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Frontmatter validation (specs/21 §8 + §15.1)
// ---------------------------------------------------------------------------

/**
 * 21 §6.1（2026-09-18）：`plan` 只承载本工作包特有的实施工作，不承载 WorkCase
 * 自身的生命周期关口。受控提交、独立复核、主控自查、Gate 批准及其收尾动作由
 * 06 / 02 §15 与本文 §9、§14 承接，不得被写成 plan 的步骤或 done_criteria。
 *
 * 设计理由（见 §6.1）：关口与计划互为前置会形成循环——独立复核须待计划步骤
 * 全部终止后执行，而关闭又须待复核完成；把关口写进 plan 会使该步骤既是「待复核
 * 的对象」又是「复核本身」。
 *
 * v4 的教训（specs/21 前身 §4.3，commit 1e7d9584）：只写条文不管用——v4 补了
 * 明文禁令后 2 天仍出现 item-gate-commit「受控提交」；且 v4 自认「Code 不判断
 * 自然语言是否属于生命周期关口」。故本条**必须**配机械承载，且承载形态必须
 * 窄到不误伤：只匹配**关口动词作谓语**的形态，不匹配「测试/检查」这类可作证据
 * 的技术状态（§6.1 明文保留后者）。
 *
 * 边界（§6.1 末段）：只约束 plan 的内容，不约束正文叙述，不新增状态/字段/阶段；
 * 不得据此增加其它校验。
 */
// 关口形态：谓词性动词 + 其对象。刻意要求**动词+对象**同现，避免把
// 「提交前检查」「复核发现的问题」这类叙述中的名词用法误判为关口步骤。
// 关口形态（§6.1）。刻意的窄化设计——只匹配「**执行**该关口」的谓语形态，
// 不匹配「实现/开发该关口的机制」「调研该关口」这类**本单实施工作**。
//
// 依据（实测，2026-09-18）：宽泛匹配会把「实现提交校验逻辑」「复核模块实现」
// 「调研 Git Gate 现状」误判为关口，那正是 v4 §4.3 的死结（「Code 不判断自然
// 语言是否属于生命周期关口」）。故本条**只认谓语的形态**，不接受名词联想。
//
// 具体地：模式必须体现「对本次工作对象施加关口动作」，因此
//   ① 裸名词（「提交校验」「复核模块」「Git Gate」）不算；
//   ② 有「实现/开发/新增/补/修复/重构/调研/测试」等**建设性动词**在前时不算；
//   ③ 仅当动词是**关口执行本身**（提交/复核/自查/提请/关闭/Gate 批准）时才命中。
const GATE_EXECUTION_VERBS = "(提交|复核|审核|自查|提请|关闭|批准|审批|裁决|终审)";
// 建设性动词前缀：出现即视为「在做这个机制的工作」，而非「在做这个关口」。
const CONSTRUCTION_PREFIX = "(实现|开发|新增|添加|补|补齐|修复|修|重构|改造|调研|研究|设计|测试|验证|登记|记录|落档|梳理|审计|排查|核对现状|落盘|写|编写)";

// ① 受控提交（06 §6.7）——口诀：动词必须是「提交」且不是「提交机制/提交逻辑」。
const GATE_STEP_PATTERNS = [
  // 「受控提交」「本地提交」「隔离提交」作谓语；前置建设性动词时豁免
  new RegExp(`(?<!${CONSTRUCTION_PREFIX})(受控|本地|隔离)\\s*提交`),
  new RegExp(`(?<!${CONSTRUCTION_PREFIX})提交\\s*(并|且|与|和|、|及)\\s*(回读|同步|推送|落档)`),
  // ② Git Gate 作为**动作**（passed/passed 判定作为判据）——排除建设性语境
  new RegExp(`(?<!${CONSTRUCTION_PREFIX})(Git\\s*Gate\\s*(passed|通过)|经\\s*Git\\s*Gate)`),
  // ③ 独立复核 / 主控自查作为**执行**；「完成独立结果复核」命中
  new RegExp(`完成[^，。;；]{0,12}(独立|对抗|就绪)?\\s*(结果)?\\s*复核`),
  new RegExp(`(?<!${CONSTRUCTION_PREFIX})(独立|对抗)\\s*(结果)?\\s*复核(?!\\s*(模块|算法|机制|字段|逻辑|实现|入口|校验))`),
  new RegExp(`完成\\s*独立\\s*(结果)?\\s*审核`),
  /主控\s*自查/,
  // ④ Gate 批准本身作为**执行**（「执行 Gate 2 关闭」「提请 Human 批准」）
  new RegExp(`(执行|进行|完成|发起|提请)\\s*Gate\\s*[12]`, "i"),
  new RegExp(`${GATE_EXECUTION_VERBS}\\s*(Human\\s*)?(批准|审批|裁决|终审)`),
  /(受控|完成)?\s*关闭提案/,
  // ⑤ 三件套的收尾并列形态（v5 现存写法，本身即制度收尾）
  /(验证|跑|过)?\s*三件套/,
];

/** 命中的关口模式（返回描述性标签，供拒绝信息使用）。 */
function detectLifecycleGate(step, doneCriteria) {
  const haystack = `${step ?? ""}\n${doneCriteria ?? ""}`;
  const hits = [];
  for (const pattern of GATE_STEP_PATTERNS) {
    const m = pattern.exec(haystack);
    if (m && m[0].trim().length > 0) hits.push(m[0].trim());
  }
  return [...new Set(hits)];
}

/**
 * 21 §6.1 关口门禁的适用范围判定（2026-09-18，Human 裁定方案 1）。
 *
 * 门禁针对的是「把关口**写成**计划」这一**面向未来**的行为，不是惩罚
 * **已经写在计划里的历史记录**。故只在 plan 相对基线的**新增或改动**项上生效：
 *
 *   - 基线缺失（create / 无既有对象）：全部 plan 项皆为新，全部受检；
 *   - 有基线：仅 `baselinePlan[i]` 不存在（新增项）或内容不等（改动项）时受检；
 *     **逐字未改的既有项放行**。
 *
 * 理由（实测，2026-09-18）：存量 open 工单中 5 个已执行完毕、正待 Gate 2 关闭，
 * 其 plan 末尾的关口步是**已兑现判据的历史记录**。若一律拒绝，则 `close` 写入
 * 也被挡住 —— 而 close 是唯一出口，且 WorkCase 无删除操作（21 §14），会造成真实
 * 死锁。逐字放行使「保留历史原样」与「门禁生效」不再冲突：历史不可改写，未来
 * 不可再写。
 *
 * 注意这不构成豁免：任何**改动**既有项（哪怕只改一字）都会使它重新受检。
 * 同位置的内容比对按 step+done_criteria 的精确字符串，不做归一化——归一化会
 * 制造「一个空格」式的绕过面。
 */
function planItemNeedsGateCheck(item, baselineItem) {
  if (baselineItem === undefined) return true;                  // 新增项
  return !(item.step === baselineItem.step && item.done_criteria === baselineItem.done_criteria);
}

function validatePlanShape(frontmatter, issues, baselinePlan = null) {
  if (!Array.isArray(frontmatter.plan) || frontmatter.plan.length === 0) {
    issues.push("plan: must be a non-empty array of {step, done_criteria} (21 §8)");
    return;
  }
  const baseline = Array.isArray(baselinePlan) ? baselinePlan : null;
  frontmatter.plan.forEach((item, i) => {
    if (!isPlainObject(item)) {
      issues.push(`plan[${i}]: must be an object of shape {step, done_criteria}`);
      return;
    }
    const extra = Object.keys(item).filter((k) => k !== "step" && k !== "done_criteria");
    if (extra.length > 0) issues.push(`plan[${i}]: unexpected field(s) ${extra.join(", ")} (only step/done_criteria, 21 §8)`);
    if (typeof item.step !== "string" || item.step.trim().length === 0) {
      issues.push(`plan[${i}].step: required non-empty`);
    }
    if (typeof item.done_criteria !== "string" || item.done_criteria.trim().length === 0) {
      issues.push(`plan[${i}].done_criteria: required non-empty and evidence-decidable (21 §6.1/§8)`);
    }
    // 21 §6.1：plan 不得承载生命周期关口（机械门禁，2026-09-18）。
    // 只查 plan 内容；不查正文（§6.1 末段明文）。
    // 只查新增/改动的项；逐字未改的既有项是历史记录，放行（见上方说明）。
    if (!planItemNeedsGateCheck(item, baseline?.[i])) return;
    const gates = detectLifecycleGate(item.step, item.done_criteria);
    if (gates.length > 0) {
      issues.push(
        `plan[${i}]: step/done_criteria reads as a WorkCase lifecycle gate (${gates.join(" / ")}) — `
        + "plan carries only this work package's own implementation work; 受控提交/独立复核/主控自查/Gate 批准 "
        + "are carried by 06, 02 §15 and the status transitions (21 §6.1/§9/§14), NOT by a plan step. "
        + "Remove it from plan: the gate still happens, it just is not a plan step. "
        + "Note 21 §6.1 keeps test/lint/scan RESULTS admissible inside done_criteria and "
        + "result.criteria_checks[].evidence — only the gate-as-a-step is rejected. "
        + "(This check applies to new or modified plan items only; an item left byte-identical "
        + "to the existing object is an unrewritable historical record and passes.)",
      );
    }
  });
}

function validateGate1(frontmatter, issues) {
  const g = frontmatter.gate_1;
  if (!isPlainObject(g)) {
    issues.push("gate_1: must be an object {approved_at, approver, authorization_fingerprint, scope_snapshot} (21 §8)");
    return;
  }
  const extra = Object.keys(g).filter((k) => !["approved_at", "approver", "authorization_fingerprint", "scope_snapshot"].includes(k));
  if (extra.length > 0) issues.push(`gate_1: unexpected field(s) ${extra.join(", ")}`);
  if (typeof g.approved_at !== "string" || !RFC3339_PATTERN.test(g.approved_at)) {
    issues.push("gate_1.approved_at: required RFC3339");
  }
  if (typeof g.approver !== "string" || g.approver.length === 0) {
    issues.push("gate_1.approver: required non-empty (the approving Human identity)");
  }
  if (typeof g.authorization_fingerprint !== "string" || !FINGERPRINT_PATTERN.test(g.authorization_fingerprint)) {
    issues.push("gate_1.authorization_fingerprint: required 64-hex SHA-256 content fingerprint over plan+scope (Code-computed, 21 §10.1)");
  }
  if (typeof g.scope_snapshot !== "string" || g.scope_snapshot.length === 0) {
    issues.push("gate_1.scope_snapshot: required non-empty snapshot of the approved scope (21 §10.1)");
  }
}

function validateAttempt(frontmatter, issues) {
  const a = frontmatter.attempt;
  if (!isPlainObject(a)) {
    issues.push("attempt: must be an object {attempt_id, started_at, controller, heartbeat_at, session_id} (21 §8)");
    return;
  }
  const extra = Object.keys(a).filter((k) => !["attempt_id", "started_at", "controller", "heartbeat_at", "session_id", "session_source"].includes(k));
  if (extra.length > 0) issues.push(`attempt: unexpected field(s) ${extra.join(", ")}`);
  if (!Number.isInteger(a.attempt_id) || a.attempt_id < 1) {
    issues.push("attempt.attempt_id: required positive integer (Code-allocated, monotonic, 21 §10.4)");
  }
  if (typeof a.started_at !== "string" || !RFC3339_PATTERN.test(a.started_at)) {
    issues.push("attempt.started_at: required RFC3339");
  }
  if (typeof a.controller !== "string" || a.controller.length === 0) {
    issues.push("attempt.controller: required non-empty (the current executing controller identity)");
  }
  if (typeof a.heartbeat_at !== "string" || !RFC3339_PATTERN.test(a.heartbeat_at)) {
    issues.push("attempt.heartbeat_at: required RFC3339 (refreshed at execution entry)");
  }
  // `session_id` is Code-managed and OPTIONAL in shape (21 §8): objects created
  // before workcase-2be11478 carry attempts without it, and adding a hard shape
  // requirement would make every existing object fail mechanical checks on
  // read. It is stamped at every approve/execute; the CLOSE gate is what
  // requires it to be present (fail-closed with an actionable reason).
  if (a.session_id !== undefined && (typeof a.session_id !== "string" || a.session_id.length === 0)) {
    issues.push("attempt.session_id: when present must be a non-empty string (Code-managed session identity, workcase-2be11478)");
  }
}

/**
 * 21 §8: `reviews` — 复核节点概要流水。
 *
 * 每项 `{at, provider, model, summary}`；`at`/署名由 Code 托管（此处只校验
 * 形状与存在性），`summary` 非空且 ≤ 600 字符，条数 ≤ 20。
 * 达上限 fail-closed：拒绝写入而非截断或压缩既有条目（防静默丢历史）。
 * 只读复核不产生条目，故本字段缺失是合法状态（条件字段，03 §6.1）。
 */
function validateReviews(frontmatter, issues) {
  const list = frontmatter.reviews;
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    issues.push("reviews: must be an array of {at, provider, model, summary} (21 §8)");
    return;
  }
  if (list.length === 0) {
    issues.push("reviews: must be omitted when there are no review entries — an empty array fabricates a conditional field (03 §6.1)");
    return;
  }
  if (list.length > REVIEW_ENTRIES_MAX) {
    issues.push(`reviews: exceeds the ${REVIEW_ENTRIES_MAX}-entry cap (21 §8); refuse rather than truncate or compress existing entries`);
  }
  list.forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      issues.push(`reviews[${i}]: must be an object {at, provider, model, summary, session_id}`);
      return;
    }
    const extra = Object.keys(entry).filter((k) => !["at", "provider", "model", "summary", "session_id", "session_source", "implementer_session_id", "implementer_session_source"].includes(k));
    if (extra.length > 0) issues.push(`reviews[${i}]: unexpected field(s) ${extra.join(", ")} (only at/provider/model/summary/session_id/session_source/implementer_session_id/implementer_session_source)`);
    if (typeof entry.at !== "string" || !RFC3339_PATTERN.test(entry.at)) {
      issues.push(`reviews[${i}].at: required RFC3339 (Code-managed)`);
    }
    if (typeof entry.provider !== "string" || entry.provider.length === 0) {
      issues.push(`reviews[${i}].provider: required non-empty (Code-managed authoritative signature)`);
    }
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      issues.push(`reviews[${i}].model: required non-empty (Code-managed authoritative signature)`);
    }
    // `session_id` is Code-managed and OPTIONAL in shape (21 §8): entries
    // written before workcase-2be11478 carry no identity, and a hard shape
    // requirement would make existing objects fail mechanical checks on read.
    // The CLOSE gate requires at least ONE entry to carry it (not every entry).
    if (entry.session_id !== undefined && (typeof entry.session_id !== "string" || entry.session_id.length === 0)) {
      issues.push(`reviews[${i}].session_id: when present must be a non-empty string (Code-managed session identity, workcase-2be11478)`);
    }
    if (entry.implementer_session_id !== undefined && (typeof entry.implementer_session_id !== "string" || entry.implementer_session_id.length === 0)) {
      issues.push(`reviews[${i}].implementer_session_id: when present must be a non-empty string (Code-managed; records who was executing when this review was written)`);
    }
    if (typeof entry.summary !== "string" || entry.summary.trim().length === 0) {
      issues.push(`reviews[${i}].summary: required non-empty (复核节点概要)`);
    } else if (entry.summary.length > REVIEW_SUMMARY_MAX_CHARS) {
      issues.push(`reviews[${i}].summary: ${entry.summary.length} chars exceeds the ${REVIEW_SUMMARY_MAX_CHARS}-char cap (21 §8)`);
    }
  });
}

function validateResult(frontmatter, issues) {
  const r = frontmatter.result;
  if (!isPlainObject(r)) {
    issues.push("result: must be an object {criteria_checks[], achieved_scope, residual[]} (21 §8)");
    return;
  }
  const extra = Object.keys(r).filter((k) => !["criteria_checks", "achieved_scope", "residual"].includes(k));
  if (extra.length > 0) issues.push(`result: unexpected field(s) ${extra.join(", ")}`);
  if (typeof r.achieved_scope !== "string" || r.achieved_scope.length === 0) {
    issues.push("result.achieved_scope: required non-empty (已证实范围的核对结论)");
  }
  const isCancelled = frontmatter.outcome === "cancelled";
  if (r.criteria_checks !== undefined) {
    if (!Array.isArray(r.criteria_checks)) {
      issues.push("result.criteria_checks: must be an array");
    } else {
      // 逐条对应 plan[].done_criteria — length must match (21 §8 invariant).
      // cancelled may omit the array entirely (nothing was executed).
      if (!isCancelled && r.criteria_checks.length !== frontmatter.plan.length) {
        issues.push(`result.criteria_checks: length ${r.criteria_checks.length} must match plan length ${frontmatter.plan.length} (逐条对应, 21 §8)`);
      }
      r.criteria_checks.forEach((c, i) => {
        if (!isPlainObject(c)) {
          issues.push(`result.criteria_checks[${i}]: must be an object {satisfied, evidence}`);
          return;
        }
        const cExtra = Object.keys(c).filter((k) => k !== "satisfied" && k !== "evidence");
        if (cExtra.length > 0) issues.push(`result.criteria_checks[${i}]: unexpected field(s) ${cExtra.join(", ")}`);
        if (typeof c.satisfied !== "boolean") issues.push(`result.criteria_checks[${i}].satisfied: required boolean`);
        if (typeof c.evidence !== "string" || c.evidence.trim().length === 0) {
          issues.push(`result.criteria_checks[${i}].evidence: required non-empty (核对依据)`);
        }
      });
    }
  } else if (!isCancelled) {
    issues.push("result.criteria_checks: required (one entry per plan step) unless outcome=cancelled (21 §9.3)");
  }
  if (r.residual !== undefined) {
    if (!Array.isArray(r.residual)) {
      issues.push("result.residual: must be an array of strings");
    } else {
      if (r.residual.length === 0 && RESIDUAL_REQUIRED_OUTCOMES.has(frontmatter.outcome)) {
        issues.push(`result.residual: must be non-empty when outcome=${frontmatter.outcome} (21 §9.3)`);
      }
      r.residual.forEach((x, i) => {
        if (typeof x !== "string" || x.trim().length === 0) issues.push(`result.residual[${i}]: required non-empty string`);
      });
    }
  } else if (RESIDUAL_REQUIRED_OUTCOMES.has(frontmatter.outcome)) {
    issues.push(`result.residual: required when outcome=${frontmatter.outcome} (21 §9.3)`);
  }
}

/**
 * Mechanical frontmatter validation (21 §8 closed set + field invariants +
 * §15.1 type-specific checks). serves ⇔ goal.md resolution and relations
 * target resolution need the fact-source root and happen in the flows.
 *
 * `baselinePlan`（可选）：既有对象的当前 plan。用于 §6.1 关口门禁的适用范围
 * 判定——只有相对基线**新增或改动**的项受检，逐字未改的既有项是历史记录，
 * 放行（见 validatePlanShape 的说明）。create 与无既有对象时省略（全量受检）。
 */
export function validateWorkcaseFrontmatter(frontmatter, baselinePlan = null) {
  const issues = [];

  for (const key of Object.keys(frontmatter)) {
    if (!VALID_FM_KEYS.has(key)) {
      issues.push(`frontmatter: unknown field "${key}" — closed set is ${[...VALID_FM_KEYS].join("/")} (21 §8); unknown fields never enter the canonical object (03 §6.1)`);
    }
  }

  if (frontmatter.fact_type_key !== WORKCASE_TYPE_KEY) {
    issues.push(`fact_type_key: must be "${WORKCASE_TYPE_KEY}", got ${JSON.stringify(frontmatter.fact_type_key)}`);
  }
  if (typeof frontmatter.title !== "string" || frontmatter.title.trim().length === 0) {
    issues.push("title: required non-empty");
  } else if (frontmatter.title.length > MAX_TITLE_LENGTH) {
    issues.push(`title: must be ≤ ${MAX_TITLE_LENGTH} 字 (21 §8), got ${frontmatter.title.length}`);
  }
  if (!STATUSES.has(frontmatter.status)) {
    issues.push(`status: must be one of ${[...STATUSES].join("/")} (21 §9)`);
  }
  if (typeof frontmatter.summary !== "string" || frontmatter.summary.trim().length === 0) {
    issues.push("summary: required non-empty (21 §8 — 使未读原计划的后续执行者可独立执行)");
  }
  // 21 §8: `gist` 按状态分层必填 —— draft/open 必填且 ≤ 200 字符；
  // closed 条件（终态只读、无受控入口可补写，缺失合法，见 §8 分层必填的理由）。
  // 该分层不是豁免：新建对象在 draft 期即必填，随对象延续到 closed。
  if (frontmatter.gist !== undefined) {
    if (typeof frontmatter.gist !== "string" || frontmatter.gist.trim().length === 0) {
      issues.push("gist: must be a non-empty string (21 §8 — 给 Human 扫读的一句话要点)");
    } else if (frontmatter.gist.length > GIST_MAX_CHARS) {
      issues.push(`gist: ${frontmatter.gist.length} chars exceeds the ${GIST_MAX_CHARS}-char cap (21 §8 扫读上限); 完整叙述属 summary/正文，不得截断后写入`);
    }
  } else if (frontmatter.status === "draft" || frontmatter.status === "open") {
    issues.push(`gist: required when status=${frontmatter.status} (21 §8 — draft/open 必填；closed 时条件，终态只读无入口可补写)`);
  }
  if (typeof frontmatter.scope !== "string" || frontmatter.scope.trim().length === 0) {
    issues.push("scope: required non-empty (21 §8 — 授权范围与边界, 越权拒绝的比对基准)");
  }
  validatePlanShape(frontmatter, issues, baselinePlan);

  if (frontmatter.serves !== undefined) {
    if (typeof frontmatter.serves !== "string" || !SG_ANCHOR_PATTERN.test(frontmatter.serves)) {
      issues.push(`serves: must match SG-n (e.g. SG-3), got ${JSON.stringify(frontmatter.serves)}`);
    }
  }

  // ---- Field invariants (21 §8) ----
  const status = frontmatter.status;
  // gate_1 出现 ⇒ status ≠ draft；status=open ⇒ gate_1 必填 (§9.1)
  if (frontmatter.gate_1 !== undefined) {
    if (status === "draft") {
      issues.push("gate_1: must not be present while status=draft (21 §9.1)");
    } else {
      validateGate1(frontmatter, issues);
    }
  } else if (status === "open") {
    issues.push("gate_1: required when status=open (21 §9.1)");
  }
  // attempt 出现 ⇔ status=open (§8)；closed 时 attempt 已收口 (§9.1)
  if (frontmatter.attempt !== undefined) {
    if (status !== "open") {
      issues.push(`attempt: may appear only while status=open (21 §8 出现 ⇔ open), got status=${JSON.stringify(status)}`);
    } else {
      validateAttempt(frontmatter, issues);
    }
  } else if (status === "open") {
    issues.push("attempt: required when status=open (21 §9.1)");
  }
  // reviews（21 §8）：条件字段，draft 期不得出现（复核只在执行期发生）；
  // open/closed 均可携带。**重批回退时不保留**——旧复核针对旧 plan/scope，重批使
  // 授权失效，故 rebatchWorkcaseObject 显式 `delete next.reviews`，并把作废要点记入
  // change_log（21 §9.2，2026-09-17 修订：原文「不在清空之列、保留原值」与本节
  // 「draft 不得携带 reviews」不可调和，已改为「作废 + 要点留痕」）。
  if (frontmatter.reviews !== undefined) {
    if (status === "draft") {
      issues.push("reviews: must not be present while status=draft — 复核 occurs during execution, not before Gate 1 (21 §8/§9.1)");
    } else {
      validateReviews(frontmatter, issues);
    }
  }
  // result/outcome 出现 ⇔ status=closed (§8)
  if (frontmatter.result !== undefined || frontmatter.outcome !== undefined) {
    if (status !== "closed") {
      issues.push(`result/outcome: may appear only when status=closed (21 §8), got status=${JSON.stringify(status)}`);
    }
  }
  if (status === "closed") {
    if (typeof frontmatter.outcome !== "string" || !OUTCOMES.has(frontmatter.outcome)) {
      issues.push(`outcome: required one of ${[...OUTCOMES].join("/")} when status=closed (21 §8)`);
    }
    if (frontmatter.result === undefined) {
      issues.push("result: required when status=closed (21 §9.1)");
    }
  }
  if (frontmatter.outcome !== undefined && OUTCOMES.has(frontmatter.outcome)) {
    if (frontmatter.result !== undefined) validateResult(frontmatter, issues);
    if (frontmatter.outcome === "completed" && Array.isArray(frontmatter.result?.criteria_checks)) {
      const unmet = frontmatter.result.criteria_checks.filter((c) => isPlainObject(c) && c.satisfied !== true);
      if (unmet.length > 0) {
        issues.push(`outcome=completed requires every criteria_checks entry satisfied, found ${unmet.length} unmet (21 §9.3/§15.1)`);
      }
    }
  }

  // relations: contributed-to → Pitfall only (21 §12)
  if (frontmatter.relations !== undefined) {
    if (!Array.isArray(frontmatter.relations) || frontmatter.relations.length === 0) {
      issues.push("relations: must be a non-empty array of {relation_key: contributed-to, target: {object_uid}} — omit when there is none (03 §6.1)");
    } else {
      const seen = new Set();
      for (const entry of frontmatter.relations) {
        if (!isPlainObject(entry)) { issues.push("relations[]: members must be objects"); continue; }
        if (!ALLOWED_RELATION_KEYS.has(entry.relation_key)) {
          issues.push(`relations[].relation_key: must be "contributed-to" (21 §12 关系闭集), got ${JSON.stringify(entry.relation_key)} — fail closed`);
        }
        const target = entry.target?.object_uid;
        if (typeof target !== "string" || !OBJECT_UID_PATTERN.test(target)) {
          issues.push(`relations[].target.object_uid: must be a canonical UUIDv4 (Pitfall target, 21 §12), got ${JSON.stringify(target)}`);
        } else if (seen.has(target)) {
          issues.push(`relations[]: duplicate target ${target} (03 §7.2 invariant 3)`);
        }
        seen.add(target);
      }
    }
  }

  if (typeof frontmatter.created_at !== "string" || !RFC3339_PATTERN.test(frontmatter.created_at)) {
    issues.push("created_at: required RFC3339 (Code-assigned; AI must not fill it, 21 §7)");
  }
  if (!Array.isArray(frontmatter.change_log) || frontmatter.change_log.length === 0) {
    issues.push("change_log: required array (create writes the first entry)");
  } else {
    frontmatter.change_log.forEach((e, i) => {
      if (!isPlainObject(e) || typeof e.summary !== "string" || e.summary.length === 0) {
        issues.push(`change_log[${i}]: required {at, summary} with non-empty summary`);
      }
    });
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Body validation + carrier coherence (21 §8 正文承载)
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {boolean} opts.hasExecution — status=open, or closed with gate_1
 *   (i.e. execution actually happened). draft never carries 执行.
 * @param {boolean} opts.requireResult — status=closed requires 结果;
 *   open may carry it as a Gate 2 draft (21 §8 条件出现), draft may not.
 */
export function validateWorkcaseBodyStructure(body, title, opts) {
  const issues = [];
  const { hasExecution, requireResult } = opts;
  // 执行/结果 are conditional (21 §8):
  //   - 执行 appears iff execution happened (status=open, or closed with gate_1);
  //   - 结果 is REQUIRED when closed, but MAY appear while open as the Gate 2
  //     draft — the very shape the v5 three-state view reads as `awaiting_gate2`
  //     (deriveWorkCaseV5View). Treating 结果 as expected-only-when-closed made
  //     that state unreachable (Friction bf73fad4).
  const expected = [...BODY_H2_CORE];
  if (hasExecution) expected.push(BODY_H2_EXECUTION);
  expected.push(BODY_H2_RESULT);

  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";
  if (firstNonEmpty.trimEnd().replace(/^ {0,3}/, "").replace(/(?<=^#+)[ \t]+/, " ") !== `# ${title}`) {
    issues.push(`body: first heading must be "# ${title}" (H1 generated from title, 21 §8)`);
  }
  const h1Count = countAtxHeadings(body, 1);
  if (h1Count !== 1) {
    issues.push(`body: expected exactly 1 H1 heading, found ${h1Count} (21 §8: 正文自 H2 起)`);
  }

  const h2 = h2Titles(body);
  // 执行 requires that execution actually happened (status=open, or closed with
  // gate_1) — a pure draft never carries it.
  if (!hasExecution && h2.includes(BODY_H2_EXECUTION)) {
    issues.push(`body: "## 执行" must not be present before Gate 1 (draft carries no execution, 21 §8)`);
  }
  // 结果 is NOT gated on execution: 21 §9.2 defines a legal `draft → closed
  // (outcome=cancelled)` transition in which `result` records the cancellation
  // reason and the range that never happened — so a draft being closed DOES
  // carry 结果. Both open (Gate 2 draft) and that closed path may therefore
  // present 结果. What remains forbidden is the reverse: a draft that is NOT
  // being closed must not carry it. That is already enforced by requireResult
  // below and by the caller's status pairing; no extra guard is added here.
  if (requireResult && !h2.includes(BODY_H2_RESULT)) {
    issues.push(`body: "## 结果" required when status=closed (21 §8)`);
  }
  // Order check over the sections that ACTUALLY appear: the present set must be
  // a prefix-preserving subsequence of [core..., 执行, 结果]. 结果 may legitimately
  // be absent while open (Gate 2 draft not yet written) — comparing against the
  // full expected list unconditionally is what broke awaiting_gate2.
  const present = expected.filter((t) => h2.includes(t));
  const filtered = h2.filter((t) => expected.includes(t));
  if (filtered.length !== present.length) {
    issues.push(`body: expected H2 sections (${present.join(" / ")}), found ${filtered.join(" / ") || "none"}`);
  } else {
    for (let i = 0; i < present.length; i++) {
      if (filtered[i] !== present[i]) {
        issues.push(`body: H2 #${i + 1} expected "${present[i]}", found "${filtered[i]}"`);
      }
    }
  }
  // Non-empty core sections
  for (const sec of BODY_H2_CORE) {
    const content = sectionContent(body, sec);
    if (content === null || content.length === 0) issues.push(`body: section "${sec}" is missing or empty`);
  }
  if (hasExecution) {
    const content = sectionContent(body, BODY_H2_EXECUTION);
    if (content === null || content.length === 0) issues.push(`body: section "${BODY_H2_EXECUTION}" is missing or empty`);
  }
  if (h2.includes(BODY_H2_RESULT)) {
    const content = sectionContent(body, BODY_H2_RESULT);
    if (content === null || content.length === 0) issues.push(`body: section "${BODY_H2_RESULT}" is present but empty`);
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Carrier coherence (03 载体内聚, pitfall/spark precedent): frontmatter
 * summary / scope are the single authoritative texts — their body sections
 * must contain them verbatim. plan[].step must appear in order in the
 * 计划 section so the plan body cannot drift from the authoritative array.
 */
export function validateCarrierCoherence(frontmatter, body) {
  const issues = [];
  const pairs = [
    ["summary", "摘要"],
    ["scope", "授权范围"],
  ];
  for (const [field, section] of pairs) {
    const text = typeof frontmatter[field] === "string" ? frontmatter[field].trim() : "";
    if (text.length === 0) continue;
    const content = sectionContent(body, section);
    if (content === null) continue;
    if (!content.includes(text)) {
      issues.push(`carrier coherence: frontmatter ${field} must appear verbatim in "## ${section}" (03 §6.1 单一权威)`);
    }
  }
  const planContent = sectionContent(body, "计划");
  if (planContent !== null && Array.isArray(frontmatter.plan)) {
    let cursor = -1;
    frontmatter.plan.forEach((item, i) => {
      if (typeof item?.step !== "string" || item.step.length === 0) return;
      const idx = planContent.indexOf(item.step, cursor + 1);
      if (idx === -1) {
        issues.push(`carrier coherence: plan[${i}].step not found (in order) in "## 计划" — the body plan may not drift from the authoritative array`);
      } else {
        cursor = idx;
      }
    });
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// attempt allocation (21 §10.4: Code-allocated, monotonic)
// ---------------------------------------------------------------------------

/**
 * Derive the next attempt_id from the change_log history the writer itself
 * produced (every allocation/void is recorded as "attempt <n>") plus the
 * current active attempt. Purely mechanical; never reused.
 */
export function nextAttemptId(frontmatter) {
  let max = 0;
  if (Number.isInteger(frontmatter.attempt?.attempt_id)) max = Math.max(max, frontmatter.attempt.attempt_id);
  for (const entry of frontmatter.change_log ?? []) {
    if (typeof entry?.summary !== "string") continue;
    for (const m of entry.summary.matchAll(/attempt (\d+)/g)) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

// ---------------------------------------------------------------------------
// Read (specs/03 §9.2)
// ---------------------------------------------------------------------------

export async function readWorkcaseObject(args) {
  const { factSourceRoot, objectUid } = args;
  const uidCheck = assertValidUid(objectUid);
  if (uidCheck) return uidCheck;
  let content;
  try {
    content = await readFile(objectFilePath(factSourceRoot, objectUid), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return failure("workcase/object_not_found", `cannot read object file: ${error.message}`);
    }
    return failure("workcase/object_unreadable", `cannot read object file: ${error.message}`);
  }
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return failure("workcase/carrier_invalid", "no YAML frontmatter block");
  }
  let frontmatter;
  try {
    frontmatter = parseYaml(fmMatch[1]);
  } catch (error) {
    return failure("workcase/carrier_invalid", `frontmatter parse error: ${error.message}`);
  }
  const body = content.slice(fmMatch[0].length).replace(/^\s+/, "");
  const fmCheck = validateWorkcaseFrontmatter(frontmatter);
  return success({
    frontmatter,
    body,
    mechanical_issues: fmCheck.ok ? [] : fmCheck.issues,
    fingerprint: fileFingerprint(content),
    file: objectFilePath(factSourceRoot, objectUid),
  });
}

// ---------------------------------------------------------------------------
// Shared write path: validate + atomic write + read-back
// ---------------------------------------------------------------------------

/**
 * 全部 7 个 action 的唯一落盘汇聚点。
 *
 * `baselinePlan`（可选）：既有对象的当前 plan，供 §6.1 关口门禁判定「新增/改动」
 * 与否。create 不传（全部为新）；其余 action 一律传调用方已读到的 `fm.plan`——
 * 这是 CAS 之外的第二道「不能靠改写既有内容绕过」的保障：baseline 来自**落盘前
 * 读到的对象**，而非调用方 payload。
 */
async function writeValidated(factSourceRoot, frontmatter, body, baselinePlan = null) {
  const fmCheck = validateWorkcaseFrontmatter(frontmatter, baselinePlan);
  if (!fmCheck.ok) {
    return failure("workcase/frontmatter_invalid", "frontmatter failed mechanical checks", { issues: fmCheck.issues });
  }
  const hasExecution = frontmatter.status === "open" || (frontmatter.status === "closed" && frontmatter.gate_1 !== undefined);
  const requireResult = frontmatter.status === "closed";
  const bodyCheck = validateWorkcaseBodyStructure(body, frontmatter.title, { hasExecution, requireResult });
  if (!bodyCheck.ok) {
    return failure("workcase/body_invalid", "body failed structure checks", { issues: bodyCheck.issues });
  }
  const coherenceCheck = validateCarrierCoherence(frontmatter, body);
  if (!coherenceCheck.ok) {
    return failure("workcase/coherence_invalid", "carrier coherence failed", { issues: coherenceCheck.issues });
  }
  const typeDir = join(factSourceRoot, WORKCASE_DIRECTORY);
  await mkdir(typeDir, { recursive: true });
  const filePath = objectFilePath(factSourceRoot, frontmatter.object_uid);
  const content = buildFileContent(frontmatter, body);
  await atomicWriteFile(filePath, content);
  // 写后精确回读 (03 §9)
  const readBack = await readWorkcaseObject({ factSourceRoot, objectUid: frontmatter.object_uid });
  if (!readBack.ok) {
    return failure("workcase/read_back_failed", readBack.error.message);
  }
  return success({
    object_uid: frontmatter.object_uid,
    file: filePath,
    fingerprint: readBack.value.fingerprint,
    read_back: "ok",
  });
}

async function resolveServes(factSourceRoot, serves) {
  if (serves === undefined) return null;
  const goal = await readGoalAnchorsFromGoal({ factSourceRoot });
  if (!goal.ok) {
    return failure("workcase/serves_unresolvable", `serves declared (${serves}) but goal.md is not readable: ${goal.error?.message ?? "unknown"} (21 §10.1: Gate 1 无法受理 without an anchor — fail closed)`);
  }
  if (!goal.value.anchors.includes(serves)) {
    return failure("workcase/serves_unresolvable", `serves ${serves} does not match any SG-n in goal.md 子目标 (available: ${goal.value.anchors.join(", ") || "none"})`);
  }
  return null;
}

async function resolveRelationsTargets(factSourceRoot, relations) {
  if (!Array.isArray(relations) || relations.length === 0) return null;
  const missing = [];
  for (const entry of relations) {
    const target = entry?.target?.object_uid;
    if (typeof target !== "string") continue;
    try {
      await readFile(join(factSourceRoot, PITFALL_DIRECTORY, `pitfall-${target}.md`), "utf8");
    } catch {
      missing.push(target);
    }
  }
  if (missing.length > 0) {
    return failure("workcase/relations_unresolvable", `contributed-to target(s) not found as Pitfall objects: ${missing.join(", ")} (21 §12: target must resolve to a same-project Pitfall)`, { missing });
  }
  return null;
}

function stripCallerOnlyFields(draft) {
  const { change_summary: _s, ...rest } = draft ?? {};
  return rest;
}

// ---------------------------------------------------------------------------
// create — draft (21 §14 C1 提案对象模式; 初态 draft)
// ---------------------------------------------------------------------------

export async function createWorkcaseObject(args) {
  const { factSourceRoot, frontmatterDraft, bodyMarkdown, sessionSignature = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
    return failure("invalid_request", "bodyMarkdown is required (starting with '## 摘要'; the H1 is generated from title)");
  }

  const uid = randomUUID();
  const now = new Date().toISOString();
  const frontmatter = { ...stripCallerOnlyFields(frontmatterDraft) };
  frontmatter.object_uid = uid;
  frontmatter.fact_type_key = WORKCASE_TYPE_KEY;
  frontmatter.created_at = now;
  // 21 §9: create always initialises as draft — Gate 1 is the only way to open.
  if (frontmatter.status !== undefined && frontmatter.status !== "draft") {
    return failure("workcase/initial_state_violation", `create must initialise as status=draft; got ${JSON.stringify(frontmatter.status)} (21 §9)`);
  }
  frontmatter.status = "draft";
  // Gate/attempt/result/outcome never exist at creation (they attach to the
  // respective transitions, which create never performs).
  if (frontmatter.gate_1 !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry gate_1 (only Gate 1 approval stamps it, 21 §14)");
  if (frontmatter.attempt !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry attempt (only approve allocates it, 21 §10.4)");
  if (frontmatter.result !== undefined || frontmatter.outcome !== undefined) return failure("workcase/frontmatter_invalid", "create must not carry result/outcome (only Gate 2 closure stamps them, 21 §14)");

  frontmatter.change_log = [{
    at: now,
    ...sig.signature,
    summary: frontmatterDraft?.change_summary ?? "受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）",
  }];

  const servesCheck = await resolveServes(factSourceRoot, frontmatter.serves);
  if (servesCheck) return servesCheck;
  const relCheck = await resolveRelationsTargets(factSourceRoot, frontmatter.relations);
  if (relCheck) return relCheck;

  const body = assembleBody(frontmatter.title, bodyMarkdown);
  return writeValidated(factSourceRoot, frontmatter, body);
}

// ---------------------------------------------------------------------------
// CAS update primitive (03 §9.5) — shared by every transition flow
// ---------------------------------------------------------------------------

async function loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint) {
  if (typeof expectedFingerprint !== "string" || !FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    return failure("invalid_request", "expectedFingerprint is required for CAS (64-hex SHA-256 from your last precise read)");
  }
  const current = await readWorkcaseObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;
  if (current.value.fingerprint !== expectedFingerprint) {
    return failure("workcase/cas_conflict", `fingerprint mismatch — the object changed since your last read (expected ${expectedFingerprint.slice(0, 8)}…, found ${current.value.fingerprint.slice(0, 8)}…); re-read and retry (03 §9.5 CAS)`);
  }
  return current;
}

/**
 * 只接受**宿主执行上下文**来源的会话身份（source="host"）。
 *
 * 独立对抗复核实测（2026-09-19）：shell 通道逐字采信 `DSH_SESSION_JSONL` /
 * `DSH_HOME`+`DSH_SESSION_ID`，而两者对调用者（AI 的一次 bash 调用）可设置——
 * 一行环境变量即可铸出任意身份的**真品牌**载体。故 shell 来源身份**可被实施者伪造**，
 * 不能作为独立性判据；本函数把「不可信来源」解析为 null，使各写入路径按缺身份
 * fail-closed，而不是接受一个可被伪造的基准。
 */
function hostSessionIdentity(carrier) {
  const identity = resolveAuthoritativeSessionIdentity(carrier);
  if (identity === null || identity.source !== "host") return null;
  return identity;
}

/** 当前实施者会话身份（落盘 attempt 的 Code 托管字段，含来源）。取不到返回 null。 */
function implementerSessionOf(frontmatter) {
  const value = frontmatter?.attempt?.session_id;
  if (typeof value !== "string" || value.length === 0) return null;
  const source = frontmatter?.attempt?.session_source;
  return { sessionId: value, source: typeof source === "string" && source.length > 0 ? source : null };
}

function appendChangeLog(frontmatter, sig, summary) {
  frontmatter.change_log = [
    ...(frontmatter.change_log ?? []),
    { at: new Date().toISOString(), ...sig.signature, summary },
  ];
}

/**
 * 21 §8：`reviews` 的 `at`、署名与 `session_id` 由 Code 托管，**AI 不得自填**。
 *
 * `validateReviews` 要求每项 `{at, provider, model, summary}` 三项非空，但在此之
 * 前没有任何写路径为其盖戳——调用方被迫自填 at/provider/model，与 §8 的「AI 不得
 * 自填」直接冲突（三重矛盾：规范说 Code 管、schema 标 Code-managed、实现却要求
 * 调用方传值）。本函数补上缺失的盖戳路径，与 `appendChangeLog` 同一纪律：
 * `at` 取 Code 时钟、`provider`/`model` 取权威会话记录（`sig.signature`）、
 * `session_id` 取会话身份（`identity`，workcase-2be11478 计划步骤 2）。
 *
 * 只接受调用方提供的 `summary`；其余四项一律覆盖，调用方传什么都会被丢弃
 * （防自欺：署名与身份不可由被署名的一方提供）。
 *
 * **身份按索引继承，不得被后续写入抹掉**（本单自审发现并修正）：若基线对象在同一
 * 索引上已有 Code 盖戳的 `session_id`，则该身份**原样保留**，不被当前调用方的身份
 * 覆盖。理由：复核会话记录的身份正是关闭门禁所依赖的证据；实施者在复核之后做一次
 * 普通心跳（execute heartbeat）若把所有条目重盖成自己的身份，会把独立复核的证据
 * 抹掉——门禁随之 fail-closed，机制沦为不可用。被继承的身份来自**落盘对象**
 * （baselineReviews），不是调用方 payload，故不可据此伪造。
 *
 * 注意既有边界：本函数在一次写入中把**所有**条目的 `at` 刷成同一时刻。这是既有
 * 行为，本单不改（不引入无法验证的时序推断）；关闭侧的时序判据因此只依赖
 * attempt 的 started_at/heartbeat_at，不依赖 reviews[].at 的相对先后。
 *
 * 传入非数组（含 undefined）时原样返回，不虚构字段（03 §6.1）。
 */
function stampReviewEntries(reviews, sig, identity = null, baselineReviews = null, implementer = null) {
  const implementerSessionId = implementer === null ? null : implementer.sessionId;
  const implementerSource = implementer === null ? null : implementer.source;
  const sessionSource = identity === null ? null : identity.source;
  if (!Array.isArray(reviews)) return reviews;
  const at = new Date().toISOString();
  const sessionId = identity === null ? null : identity.sessionId;
  const baseline = Array.isArray(baselineReviews) ? baselineReviews : [];
  return reviews.map((entry, index) => {
    const stored = baseline[index];
    const storedSessionId = isPlainObject(stored) && typeof stored.session_id === "string" && stored.session_id.length > 0
      ? stored.session_id
      : null;
    const effectiveSessionId = storedSessionId ?? sessionId;
    // 记录「写这条时谁是实施者」——这是独立性判据的真正基准（见 close 门禁说明）。
    // 同样按索引继承：已记录条目的当时基准不得被后续 attempt 轮换改写，否则
    // 「先自查、再 takeover、然后关闭」就能把自查当成独立证据（独立复核实测发现，
    // 2026-09-19）。
    const storedImplementer = isPlainObject(stored) && typeof stored.implementer_session_id === "string"
      && stored.implementer_session_id.length > 0
      ? stored.implementer_session_id
      : null;
    const effectiveImplementer = storedImplementer ?? implementerSessionId;
    // 来源**不作继承性补齐**（本单实测发现并修正，2026-09-19）：
    // 若对既有条目用当前写入者的来源去填补它缺失的来源，则任何一条**没有来源**的
    // 旧条目（或经旧路径写入、或直接改文件注入的条目）都会被随后一次宿主写入「洗白」
    // 成 source="host"，从而计入独立性判据——这正是「shell 身份可伪造」那个缺口
    // 换了一道后门回来（实测：注入一条无来源条目 → 攻击者做一次宿主写入 → 该条目
    // 变成 session_source="host" 并被门禁采纳）。
    //
    // 故来源只对**本次新写入的条目**盖戳；既有条目一律保留它当初被记录的原值，
    // 缺失就是缺失（判据要求两端来源俱为 "host"，缺失即不计入，fail-closed）。
    const isExistingEntry = isPlainObject(stored);
    const storedSource = isExistingEntry && typeof stored.session_source === "string" ? stored.session_source : null;
    const effectiveSource = isExistingEntry ? storedSource : sessionSource;
    const storedImplSource = isExistingEntry && typeof stored.implementer_session_source === "string"
      ? stored.implementer_session_source
      : null;
    const effectiveImplSource = isExistingEntry ? storedImplSource : implementerSource;
    return {
      at,
      ...sig.signature,
      // Code-managed session identity (workcase-2be11478 计划步骤 2): the caller
      // cannot supply or override it. When the identity is unavailable the key is
      // OMITTED rather than fabricated — the close gate then fails closed.
      ...(effectiveSessionId === null ? {} : { session_id: effectiveSessionId }),
      // 来源仅在**已知**时写出：缺失就让它缺失（写入 null 会看起来像「记录过、值不明」，
      // 而真实语义是「这条记录发生在来源字段存在之前」——省略比 null 更准确）。
      ...(effectiveSource === null || effectiveSource === undefined ? {} : { session_source: effectiveSource }),
      ...(effectiveImplementer === null ? {} : { implementer_session_id: effectiveImplementer }),
      ...(effectiveImplSource === null || effectiveImplSource === undefined ? {} : { implementer_session_source: effectiveImplSource }),
      summary: isPlainObject(entry) && typeof entry.summary === "string" ? entry.summary : "",
    };
  });
}

/**
 * 复核条目一旦被 Code 盖戳了会话身份，即是**历史记录**：其它会话不得改写其概要。
 *
 * 为什么必需（本单自审发现并修正）：`stampReviewEntries` 的身份按索引继承，故若
 * 允许调用方在保留索引的同时把概要换成自己的自查文本，实施者就能把独立会话
 * （S2）的真实复核条目**改造**成自己的内容而仍然携带 S2 的身份——关闭门禁会被
 * 这样「借壳」通过。这与本单 scope (D) 列明的「复用旧条目」伪装路径同类，必须以
 * 同一门禁拒绝。
 *
 * 判据故意取「概要逐字相同」这一机械可比项：内容语义是否正确仍归 AI/Human
 * （02 §15），本函数只保证「谁记的、记了什么」不被他人改写。
 */
function assertReviewHistoryNotRewritten(beforeReviews, afterReviews, issuesRef) {
  const before = Array.isArray(beforeReviews) ? beforeReviews : [];
  const after = Array.isArray(afterReviews) ? afterReviews : [];
  after.forEach((entry, index) => {
    const stored = before[index];
    if (!isPlainObject(stored)) return;
    const storedSessionId = typeof stored.session_id === "string" && stored.session_id.length > 0 ? stored.session_id : null;
    if (storedSessionId === null) return;
    const incomingSummary = isPlainObject(entry) && typeof entry.summary === "string" ? entry.summary : "";
    const storedSummary = typeof stored.summary === "string" ? stored.summary : "";
    if (incomingSummary !== storedSummary) {
      issuesRef.push(
        `reviews[${index}]: this entry was recorded by session ${storedSessionId} and its summary may not be `
        + "rewritten by another session (workcase-2be11478). A recorded review is a historical fact: to change "
        + "what a review concluded, record a NEW entry instead of editing this one. Rewriting it would let a "
        + "different session keep another session's identity while substituting its own content.",
      );
    }
  });
}

/** C2 guard: while open, plan and scope are frozen (21 §10.3). */
function assertAuthorizedPairFrozen(before, after, issuesRef) {
  const fpBefore = computeAuthorizationFingerprint(before.plan, before.scope);
  const fpAfter = computeAuthorizationFingerprint(after.plan, after.scope);
  if (fpBefore !== fpAfter) {
    issuesRef.push("plan/scope are frozen while status=open — the C2 authorization fingerprint no longer matches; the only legal path is rebatch (open → draft, 局部重批), never an in-place edit (21 §10.3)");
  }
}

// ---------------------------------------------------------------------------
// approve — Gate 1: draft → open (21 §14, §10.1)
// ---------------------------------------------------------------------------

export async function approveWorkcaseObject(args) {
  const { factSourceRoot, objectUid, expectedFingerprint, approver, controller, changeSummary, sessionSignature = null, sessionIdentity = null } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof approver !== "string" || approver.length === 0) {
    return failure("invalid_request", "approver is required (the approving Human identity, 21 §10.1)");
  }
  if (typeof controller !== "string" || controller.length === 0) {
    return failure("invalid_request", "controller is required (the current executing controller identity, 21 §10.4)");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required (one-line semantic summary for the change_log entry)");
  }
  // 会话身份（workcase-2be11478 计划步骤 2）：只能来自 Code 托管的品牌载体。
  // 非品牌载体（AI 自填的字符串/普通对象）解析为 null —— 此时仍允许批准，但
  // attempt.session_id 缺席会使关闭门禁 fail-closed（不静默放行）。
  const identity = hostSessionIdentity(sessionIdentity);
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure("workcase/transition_invalid", `Gate 1 approval requires status=draft, got ${JSON.stringify(fm.status)} (21 §9.2)`);
  }

  const now = new Date().toISOString();
  const next = structuredClone(fm);
  next.status = "open";
  next.gate_1 = {
    approved_at: now,
    approver,
    authorization_fingerprint: computeAuthorizationFingerprint(fm.plan, fm.scope),
    scope_snapshot: fm.scope,
  };
  const attemptId = nextAttemptId(fm);
  next.attempt = {
    attempt_id: attemptId,
    started_at: now,
    controller,
    heartbeat_at: now,
    // Code-managed: the implementing session's authoritative identity. This is
    // the baseline the close gate compares a reviewer against. `session_source`
    // records provenance — only "host" (host execution context) is admissible
    // as evidence; "shell" is forgeable via env and never counts.
    ...(identity === null ? {} : { session_id: identity.sessionId, session_source: identity.source }),
  };
  appendChangeLog(next, sig, `${changeSummary} [gate_1 approved by ${approver}; attempt ${attemptId} allocated to ${controller}]`);

  // Body: ensure the 执行 section exists (writer-stamped entry line).
  let body = current.value.body;
  if (!h2Titles(body).includes(BODY_H2_EXECUTION)) {
    body = `${body.replace(/\s+$/, "")}\n\n## 执行\n\n- attempt ${attemptId} started at ${now} (controller: ${controller})；Gate 1 授权范围见 gate_1.scope_snapshot。\n`;
  } else {
    const content = sectionContent(body, BODY_H2_EXECUTION) ?? "";
    body = replaceSection(body, BODY_H2_EXECUTION, `${content}\n- attempt ${attemptId} started at ${now} (controller: ${controller})；Gate 1 授权范围见 gate_1.scope_snapshot。`);
  }
  const written = await writeValidated(factSourceRoot, next, body, fm.plan);
  // 21 §8「执行」节记账纪律的前置提示：授权是执行期写正文的**最早**时点，此处把当前
  // plan 的权威编号清单直接交给调用方，使「计划步骤 N」的 N 有据可依，不必回查
  // frontmatter。属**前置告知**，不含任何校验或拒绝规则——同类机械校验已被实测证伪
  // （它抓不到纯「步骤 N」形态的原错误，却会拒绝如实引述该编号的记述）。此处只把
  // 事实摆在写入之前。
  if (!written.ok) return written;
  return success({
    ...written.value,
    plan_step_reference: planStepReference(next.plan),
  });
}

function replaceSection(body, h2Title, newContent) {
  const re = new RegExp(`(^|\\n)(## ${h2Title}\\n)([\\s\\S]*?)(?=\\n## |\\s*$)`, "m");
  return body.replace(re, `$1$2\n${newContent}\n`);
}

// ---------------------------------------------------------------------------
// execute — open-period update (21 §14 执行期更新)
// ---------------------------------------------------------------------------

/**
 * Open-period controlled update. Allowed payloads: body progress (incl.
 * result drafts in the body), relations, summary refresh; attempt
 * operations: heartbeat (default) | takeover (new controller, new
 * attempt id) | reallocate (void + new id, 冷恢复 path).
 * plan/scope frozen by C2 — substantive change must go through rebatch.
 */
export async function executeWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary,
    attemptOperation = "heartbeat", newController = null,
    sessionSignature = null, sessionIdentity = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body starting with '## 摘要')");
  }
  if (!["heartbeat", "takeover", "reallocate"].includes(attemptOperation)) {
    return failure("invalid_request", `attemptOperation must be heartbeat|takeover|reallocate, got ${JSON.stringify(attemptOperation)}`);
  }
  // 会话身份（workcase-2be11478 计划步骤 2/4）：品牌载体，AI 不可自填。
  // 复核会话经 execute 落盘其结论时，其身份即由此进入 reviews[].session_id ——
  // 这正是「独立会话记录复核」的机械证据来源。
  const identity = hostSessionIdentity(sessionIdentity);
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `execute updates require status=open, got ${JSON.stringify(fm.status)} (21 §14)`);
  }

  const next = structuredClone(stripCallerOnlyFields(frontmatterAfter));
  // Code-managed fields: identity, gate, attempt, change_log never come
  // from the caller payload.
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "open";
  next.gate_1 = fm.gate_1;
  next.change_log = fm.change_log;
  // 21 §8：`reviews` 每项的 `at`、署名与 `session_id` 同样由 Code 托管——AI 只提供
  // `summary`。与 change_log 的 `appendChangeLog(fm, sig, …)` 同一纪律（署名与身份
  // 来自权威会话记录，不可由调用方填写）。见下方 stampReviewEntries 的说明。
  // baseline 取自**落盘对象**（fm.reviews），不是调用方 payload——故已记录的身份
  // 不可被本次调用的身份覆盖（防实施者在复核后抹掉独立复核的证据）。
  next.reviews = stampReviewEntries(next.reviews, sig, identity, fm.reviews, implementerSessionOf(fm));

  // 已盖戳身份的复核条目是历史记录：不得由其它会话改写其概要（防「借壳」——保留
  // 独立会话的身份却换成自己的内容，从而骗过关闭门禁）。
  const reviewHistoryIssues = [];
  assertReviewHistoryNotRewritten(fm.reviews, next.reviews, reviewHistoryIssues);
  if (reviewHistoryIssues.length > 0) {
    return failure("workcase/review_history_rewritten", reviewHistoryIssues[0]);
  }

  // C2 guard (21 §10.3): plan/scope frozen while open.
  const c2Issues = [];
  assertAuthorizedPairFrozen(fm, next, c2Issues);
  if (c2Issues.length > 0) {
    return failure("workcase/c2_fingerprint_invalidated", c2Issues[0]);
  }
  // attempt is Code-managed here.
  const now = new Date().toISOString();
  let attemptNote;
  if (attemptOperation === "heartbeat") {
    // Heartbeat preserves the attempt's own identity: the attempt belongs to the
    // implementer, and a REVIEWER session records its conclusion through
    // `record_review` (which never touches `attempt`) — so a heartbeat must not
    // overwrite the implementing baseline, or the close gate would end up
    // comparing the reviewer against itself.
    //
    // EXCEPTION — legacy backfill: an attempt allocated before this anchor
    // existed carries no session_id, and without a way to fill it such an object
    // could never be closed (the gate fails closed with
    // `review_independence_unverifiable`). Since heartbeats during execution are
    // issued by the executing session, backfilling the missing baseline from the
    // current session is exactly what the field means. If a reviewer wrongly
    // performs this backfill, the direction is still safe: the gate then sees
    // implementer == reviewer and refuses to close (fail-closed), rather than
    // accepting a self-check.
    const hasBaseline = typeof fm.attempt?.session_id === "string" && fm.attempt.session_id.length > 0;
    const baseline = hasBaseline
      ? fm.attempt.session_id
      : (identity === null ? null : identity.sessionId);
    // 存量补齐：本锚点之前建立的 attempt 有 session_id 却无 session_source，而关闭
    // 门禁要求条目两端来源俱为 "host"，故这类对象无法产生「可比对」条目、关不掉。
    //
    // 补齐**只由该身份本人**触发：仅当调用方（宿主来源、故不可伪造）所带的 id 正是
    // 所记录的实施者时，用其自身来源补上。
    //
    // **诚实边界**：这是身份的**自证**，不是对「当初那次写入本身来自宿主路径」的证明
    // —— 存量值的原始来源在写入时未被记录，无法事后追溯。它成立的依据是：主张该 id 的
    // 会话确实就是该会话，且它此刻的宿主来源不可伪造。若需一个**无此含糊**的基线，正确
    // 做法是换一次 attempt（takeover/reallocate），由新执行者写入带来源的完整基线。
    const storedSource = typeof fm.attempt?.session_source === "string" ? fm.attempt.session_source : null;
    const baselineSource = hasBaseline
      ? (storedSource ?? (identity !== null && identity.sessionId === fm.attempt.session_id ? identity.source : null))
      : (identity === null ? null : identity.source);
    next.attempt = {
      ...fm.attempt,
      heartbeat_at: now,
      ...(baseline === null ? {} : { session_id: baseline }),
      ...(baselineSource === null ? {} : { session_source: baselineSource }),
    };
    attemptNote = `attempt ${fm.attempt.attempt_id} heartbeat refreshed`;
  } else {
    const controller = typeof newController === "string" && newController.length > 0 ? newController : fm.attempt.controller;
    const newId = nextAttemptId(fm);
    // A new attempt means a new executing session (21 §10.4: takeover 换执行者,
    // reallocate 冷恢复后重新分配). The independence baseline moves with it: the
    // new attempt's session_id is the CURRENT session's identity. When the
    // identity is unavailable the key is omitted — the close gate then fails
    // closed rather than comparing future reviewers against a stale baseline.
    next.attempt = {
      attempt_id: newId,
      started_at: now,
      controller,
      heartbeat_at: now,
      ...(identity === null ? {} : { session_id: identity.sessionId, session_source: identity.source }),
    };
    attemptNote = attemptOperation === "takeover"
      ? `attempt ${fm.attempt.attempt_id} taken over → attempt ${newId} (controller: ${controller})`
      : `attempt ${fm.attempt.attempt_id} voided → attempt ${newId} reallocated (controller: ${controller})`;
  }
  appendChangeLog(next, sig, `${changeSummary} [${attemptNote}]`);

  const relCheck = await resolveRelationsTargets(factSourceRoot, next.relations);
  if (relCheck) return relCheck;

  const body = assembleBody(next.title, bodyMarkdownAfter);
  // 跨会话接力时执行者未必持有 approve 的返回值，故 execute 亦带前置提示（纯告知）。
  const written = await writeValidated(factSourceRoot, next, body, fm.plan);
  if (!written.ok) return written;
  return success({ ...written.value, plan_step_reference: planStepReference(next.plan) });
}

// ---------------------------------------------------------------------------
// recordReview — the narrow identity-channel write (workcase-2be11478 计划步骤 4)
// ---------------------------------------------------------------------------

/**
 * 复核结论回传通道：把**一条**复核结论追加为该工单的 `reviews` 条目。
 *
 * 为什么单列一个窄函数而不是复用 `executeWorkcaseObject`：`execute` 接受整个
 * `frontmatterAfter`，等于把工单的普通写能力交给调用方。隔离执行体（子代理会话）
 * 只需要「记录我复核过了、结论是什么」这一件事——授予它 `execute` 会顺带给出改写
 * 摘要、范围、计划的能力，远超其职责。本函数只做追加，其余字段一律取自落盘对象，
 * 从而满足本单 scope (C) 的「该通道不因此赋予其其它受控写能力」。
 *
 * 调用方只能提供 `summary`（复核结论概要，≤600 字符，含 02 §15 七要素）。`at`、
 * `provider`/`model`、`session_id` 全部由 Code 盖戳——其中 `session_id` 取自**调用
 * 会话自己的**权威身份，故记录者无法声称自己是别的会话；实施者若自行调用本函数，
 * 得到的条目携带实施者身份，关闭门禁照样拒绝（这正是本机制抗伪造的落点）。
 *
 * `attempt` 一概不动：复核不是执行，不改 attempt 的所有权与身份基线。
 */
export async function recordWorkcaseReview(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint, summary,
    changeSummary = null, sessionSignature = null, sessionIdentity = null,
    reviewerNote = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof summary !== "string" || summary.trim().length === 0) {
    return failure("invalid_request", "summary is required (the review conclusion, ≤600 chars, carrying the 02 §15 seven elements)");
  }
  if (summary.length > REVIEW_SUMMARY_MAX_CHARS) {
    return failure("invalid_request", `summary: ${summary.length} chars exceeds the ${REVIEW_SUMMARY_MAX_CHARS}-char cap (21 §8)`);
  }
  // 身份不可得即拒绝：本通道的**全部价值**在于「谁记的」由 Code 证明。若允许无身份
  // 写入，等于给出一个可被实施者冒用的通道，比没有通道更危险。
  const identity = hostSessionIdentity(sessionIdentity);
  if (identity !== null && identity.source === "shell") {
    // shell 来源身份取自环境变量 + 日志文件，而两者对调用者可设置 → 可伪造。
    // 接受它等于把门禁的判据交给被判方（独立对抗复核实测：一行 DSH_SESSION_JSONL
    // 即可铸出任意身份）。故复核身份只接受宿主执行上下文（source="host"）。
    return failure(
      "workcase/review_identity_untrusted",
      "refusing to record a review with a shell-sourced session identity: that channel reads "
      + "DSH_SESSION_JSONL / DSH_HOME+DSH_SESSION_ID, and BOTH are settable by the caller (a single bash "
      + "invocation can mint any identity) — so it cannot evidence independence (workcase-2be11478, "
      + "independent adversarial review 2026-09-19). Record the review through the governed tool surface "
      + "of a session whose identity comes from the host execution context (ldvh_workcase_write "
      + "action=record_review), which stamps source=\"host\".",
    );
  }
  if (identity === null) {
    return failure(
      "workcase/review_identity_unavailable",
      "refusing to record a review without the caller's authoritative session identity: the identity must come "
      + "from the DSH session record via the branded carrier (workcase-2be11478). Resolve it with "
      + "shellAuthoritativeSessionIdentity() from a DSH shell, or sessionIdentityFor() from the tools layer. "
      + "An unsigned-identity review would be indistinguishable from a self-check recorded by the implementer.",
    );
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure(
      "workcase/transition_invalid",
      `review recording requires status=open, got ${JSON.stringify(fm.status)} (21 §9.2: reviews 属执行期受控更新；draft 不得携带 reviews，closed 为终态)`,
    );
  }
  const existing = Array.isArray(fm.reviews) ? fm.reviews : [];
  if (existing.length >= REVIEW_ENTRIES_MAX) {
    return failure(
      "workcase/review_entries_exhausted",
      `reviews already holds ${existing.length} entries (cap ${REVIEW_ENTRIES_MAX}, 21 §8): refuses to truncate or compress `
      + "existing entries. Report to Human — this object needs a decision (rebatch or close), not a dropped history.",
    );
  }

  const next = structuredClone(fm);
  // 只追加，不触碰：plan/scope/gate_1/attempt/result/outcome 全部沿用落盘对象。
  next.reviews = stampReviewEntries([...existing, { summary }], sig, identity, fm.reviews, implementerSessionOf(fm));
  const historyIssues = [];
  assertReviewHistoryNotRewritten(fm.reviews, next.reviews, historyIssues);
  if (historyIssues.length > 0) {
    return failure("workcase/review_history_rewritten", historyIssues[0]);
  }
  appendChangeLog(
    next, sig,
    (typeof changeSummary === "string" && changeSummary.length > 0 ? changeSummary : "记录一条复核结论")
      + ` [review recorded by session ${identity.sessionId}; reviews entries: ${fm.reviews === undefined ? 1 : existing.length + 1}`
      + `${typeof reviewerNote === "string" && reviewerNote.length > 0 ? `; ${reviewerNote}` : ""}]`,
  );

  const body = assembleBody(next.title, current.value.body.replace(/^#\s+.*\n+/, ""));
  const written = await writeValidated(factSourceRoot, next, body, fm.plan);
  if (!written.ok) return written;
  return success({ ...written.value, review_session_id: identity.sessionId });
}

// ---------------------------------------------------------------------------
// close — Gate 2: open → closed (21 §14, §10.2)
// ---------------------------------------------------------------------------

export async function closeWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    outcome, result, changeSummary, bodyMarkdownAfter, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body including the 结果 section)");
  }
  if (!OUTCOMES.has(outcome)) {
    return failure("invalid_request", `outcome must be one of ${[...OUTCOMES].join("/")} (21 §9.3)`);
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `Gate 2 closure requires status=open, got ${JSON.stringify(fm.status)} (21 §9.2)`);
  }
  // Gate 2 前置条件（21 §9.1/§8/§14，Human 裁定 2026-09-17）：关闭前须已存在至少一条
  // `reviews`（独立复核记录）。WorkCase 准入（§6 对象边界）已排除「当次行动可直接处理
  // 的低风险改动」，故凡进入 WorkCase 者独立复核为必经环节，**不设低风险豁免**。
  //
  // 缺失时一律拒绝关闭——不得以正文自述或对话声明替代；无法执行独立复核时按 §18
  // 停止条件处置（保持 open 并交还 Human），不得以 partial/cancelled 等终态掩盖。
  //
  // 注意隐含前置：`reviews` 只能在 status=open 时经 execute 落盘（close 不接受
  // frontmatterAfter，stampReviewEntries 的唯一调用点在 executeWorkcaseObject），
  // 故关闭时无法补写——复核须在执行期完成。
  if (!Array.isArray(fm.reviews) || fm.reviews.length === 0) {
    return failure(
      "workcase/review_required",
      "Gate 2 closure requires at least one reviews entry (independent review) before closing "
      + "(21 §9.1/§8/§14, Human 裁定 2026-09-17). reviews is absent or empty — record the independent "
      + "review via execute (status=open) first; if an independent review cannot be performed, do NOT "
      + "close: hold the workcase open and hand back to Human (21 §18). "
      + "The 结果 body section or a conversational statement does not substitute for a reviews entry.",
    );
  }

  // Gate 2 前置条件之二（21 §14，Human 裁定 2026-09-19 / workcase-2be11478）：
  // 至少一条 reviews 必须由**独立于实施者的会话**记录，低风险工单不豁免。
  //
  // 判据是会话身份（attempt.session_id vs reviews[].session_id，两者均由 Code 从
  // DSH 会话记录取得并盖戳），**不是** provider/model 署名——署名取自会话路由值，
  // 同 provider/model 的两个不同会话会盖出完全相同的署名（实测：workcase-4005b67b
  // 与 workcase-2be11478 的署名同为 workbuddy/deepseek-v4.1-flash），故署名无法
  // 区分复核者与实施者。
  //
  // 三条 fail-closed 路径，各有可操作的原因（不静默放行、不猜）：
  //   (a) attempt.session_id 缺失/不可得 → 无法建立比对基准；
  //   (b) 无任何 reviews 条目携带 session_id → 无候选复核会话；
  //   (c) 全部候选的 session_id 与实施会话相同 → 同一会话自评，冒充独立复核。
  //
  // 诚实边界：这只能证明「记录该结论的会话 ≠ 记录该实施尝试的会话」，**不证明**
  // 视角实质独立、内容正确或结论成立（02 §15 语义判断仍归 AI/Human）；同一主控
  // 编排出的隔离子会话在机械上满足本判据，这不是缺陷而是本判据被明确声明的范围。
  // 判据（独立复核发现后收紧，2026-09-19）：每一条 reviews 都要与**它自己写入时的**
  // 实施者身份比对，而不是与「当前」attempt 比对。
  //
  // 为什么必须按条目判：门禁原先只比对当前 attempt，而 reviews 跨 attempt 保留
  // （身份按索引继承，见 stampReviewEntries）。于是「实施者写一条自查 → takeover 把
  // attempt 换成另一会话 → 关闭」就能让自查被当成独立证据——独立对抗复核实测复现
  // （`probe-attempt-rot`：close ok=true）。故每条记录在写入时被盖上一个
  // `implementer_session_id`（当时的实施者，Code 托管），关闭时逐条比对两者是否不同。
  //
  // 三条 fail-closed 路径（不静默放行、不猜）：
  //   (a) 无任何条目携带可比对的双方身份 → 无从建立独立性；
  //   (b) 所有可比对条目都是「记录者 == 当时的实施者」→ 全部是同会话自评；
  //   (c) 身份不可读（attempt 或条目缺身份）不视为独立。
  // 只有两端身份**都来自宿主执行上下文**（source === "host"）才构成判据：
  // shell 来源可被一行环境变量伪造（独立对抗复核实测），故不计入。
  const comparable = (fm.reviews ?? []).filter((entry) => (
    isPlainObject(entry)
    && typeof entry.session_id === "string" && entry.session_id.length > 0
    && entry.session_source === "host"
    && typeof entry.implementer_session_id === "string" && entry.implementer_session_id.length > 0
    && entry.implementer_session_source === "host"
  ));
  if (comparable.length === 0) {
    return failure(
      "workcase/review_independence_unverifiable",
      "Gate 2 closure requires a mechanical independent-review check, but no reviews entry carries BOTH "
      + "the reviewer's session identity and the implementer identity in force when it was written "
      + "(workcase-2be11478, Human 裁定 2026-09-19). Entries written before the anchor existed have no "
      + "identity, and an unknown must not be treated as independent. Record a fresh review via "
      + "record_review (status=open) so the entry is stamped with the reviewer's authoritative session "
      + "identity and the then-current implementer, then close. If no independent session can review, do "
      + "NOT close — hold open and hand back to Human (21 §18).",
    );
  }
  const independentEntries = comparable.filter((entry) => entry.session_id !== entry.implementer_session_id);
  if (independentEntries.length === 0) {
    const selfSession = comparable[0].session_id;
    return failure(
      "workcase/review_independence_missing",
      "Gate 2 closure requires at least one reviews entry recorded by a session OTHER than the one "
      + `executing the work at the time it was recorded: every comparable entry was written by its own `
      + `implementer (session_id "${selfSession}" == implementer_session_id). A self-check is a legitimate `
      + `主控自查 but it is NOT an independent review and must not be recorded as one (02 §15: the three `
      + `review forms are not interchangeable). Note that rotating the attempt (takeover/reallocate) does `
      + `NOT turn an earlier self-check into an independent review — each entry is judged against the `
      + `implementer in force when it was written. Have a session other than the implementer's record the `
      + `review (a delegated subagent session or another governed root session both satisfy this; 32 §12: `
      + `独立子代理为默认优先形态), then close. If no independent session can review, do NOT close — `
      + `hold open and hand back to Human (21 §18).`,
    );
  }

  const next = structuredClone(fm);
  next.status = "closed";
  next.outcome = outcome;
  next.result = stripCallerOnlyFields(result);
  // attempt 收口: the token is retracted; its history stays in change_log.
  const closedAttempt = fm.attempt?.attempt_id;
  delete next.attempt;
  appendChangeLog(next, sig, `${changeSummary} [gate_2 closed with outcome=${outcome}; attempt ${closedAttempt ?? "none"} retracted]`);

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body, fm.plan);
}

// ---------------------------------------------------------------------------
// rebatch — open → draft (C2 局部重批, 21 §9.2/§10.3/§14)
// ---------------------------------------------------------------------------

export async function rebatchWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required (must carry 重批原因 + 当时已完成的 criteria_checks 快照结论, 21 §9.2)");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the revised draft body: 摘要/授权范围/计划)");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "open") {
    return failure("workcase/transition_invalid", `rebatch requires status=open (C2 invalidation happens while executing), got ${JSON.stringify(fm.status)} (21 §10.3)`);
  }

  const next = structuredClone(stripCallerOnlyFields(frontmatterAfter));
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "draft";
  // §9.2: attempt 作废（不续跑）；result/outcome 一并清空；gate_1 回落（draft
  // 不得携带）——已取得的核对证据写入 change_log 语义摘要（调用方职责）。
  const voidedAttempt = fm.attempt?.attempt_id;
  delete next.attempt;
  delete next.result;
  delete next.outcome;
  delete next.gate_1;
  // Code 托管字段锁定（03 §9.5 / 21 §8）：`change_log` 是「每次实际修改恰好一条」的
  // 权威流水，只能由 Code 追加。`next` 来自调用方 payload，故必须显式回落为
  // `fm.change_log`——否则调用方可在 `frontmatter_after` 里注入伪造条目，把对象的
  // 全部审计历史整体替换（起草者实测：传一条伪造条目即清空 2 条真实历史）。
  // `execute`/`revise`/`cancel` 均已如此锁定，`rebatch` 此前漏做。
  next.change_log = fm.change_log;
  // `reviews` 处置（21 §9.2/§176）：重批使 `plan`/`scope` 实质变化，旧复核针对的是
  // **旧授权范围**，故不得延续为当前授权下的复核记录。但 21:176 又要求「不丢历史」。
  // 二者以 §9.2 对 `criteria_checks` 的既有处置范式调和：**作废字段值 + 要点入
  // change_log**（复核概要的条目数/署名/时间以语义摘要形式留痕），既守住
  // 「draft 不得携带 reviews」的既有不变量（writer:472），又不丢历史。
  const voidedReviews = Array.isArray(fm.reviews) ? fm.reviews.length : 0;
  delete next.reviews;
  appendChangeLog(
    next,
    sig,
    `${changeSummary} [C2 局部重批 open→draft; attempt ${voidedAttempt ?? "none"} voided, gate_1 dropped`
    + `${voidedReviews > 0 ? `, ${voidedReviews} 条 reviews 随授权失效作废（旧复核针对旧 plan/scope；概要要点见本条语义摘要）` : ""}`
    + ` — 重新组织后重走 Gate 1]`,
  );

  const servesCheck = await resolveServes(factSourceRoot, next.serves);
  if (servesCheck) return servesCheck;
  const relCheck = await resolveRelationsTargets(factSourceRoot, next.relations);
  if (relCheck) return relCheck;

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body, fm.plan);
}

// ---------------------------------------------------------------------------
// cancel — draft → closed, outcome=cancelled (21 §9.2)
// ---------------------------------------------------------------------------

export async function cancelWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    result, changeSummary, bodyMarkdownAfter, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required (the full next body including the 结果 section with the cancellation record)");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure("workcase/transition_invalid", `cancel (draft→closed) requires status=draft; an approved workcase must go through Gate 2 instead, got ${JSON.stringify(fm.status)} (21 §9.2)`);
  }

  const next = structuredClone(fm);
  next.status = "closed";
  next.outcome = "cancelled";
  next.result = stripCallerOnlyFields(result);
  appendChangeLog(next, sig, `${changeSummary} [cancelled before execution; no Gate 1 approval existed]`);

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body, fm.plan);
}

// ---------------------------------------------------------------------------
// revise — draft → draft controlled revision (03 §9.5, 21 §14)
// ---------------------------------------------------------------------------

export async function reviseWorkcaseObject(args) {
  const {
    factSourceRoot, objectUid, expectedFingerprint,
    frontmatterAfter, bodyMarkdownAfter, changeSummary, sessionSignature = null,
  } = args;
  const sig = requireAuthoritativeSignature(sessionSignature);
  if (!sig.ok) return failure(sig.code, sig.message);
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return failure("invalid_request", "changeSummary is required");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return failure("invalid_request", "bodyMarkdownAfter is required");
  }
  const current = await loadAndCheckFingerprint(factSourceRoot, objectUid, expectedFingerprint);
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  if (fm.status !== "draft") {
    return failure("workcase/transition_invalid", `revise requires status=draft (pre-Gate-1 evolution); once open, substantive change goes through rebatch, got ${JSON.stringify(fm.status)}`);
  }

  const next = structuredClone(stripCallerOnlyFields(frontmatterAfter));
  next.object_uid = fm.object_uid;
  next.fact_type_key = WORKCASE_TYPE_KEY;
  next.created_at = fm.created_at;
  next.status = "draft";
  next.change_log = fm.change_log;
  appendChangeLog(next, sig, changeSummary);

  const servesCheck = await resolveServes(factSourceRoot, next.serves);
  if (servesCheck) return servesCheck;
  const relCheck = await resolveRelationsTargets(factSourceRoot, next.relations);
  if (relCheck) return relCheck;

  const body = assembleBody(next.title, bodyMarkdownAfter);
  return writeValidated(factSourceRoot, next, body, fm.plan);
}

// ---------------------------------------------------------------------------
// list — F0/F1 discovery (21 §13)
// ---------------------------------------------------------------------------

export async function listWorkcaseObjects(args) {
  const { factSourceRoot, includeClosed = false, limit = 200 } = args;
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return failure("invalid_request", "limit must be a positive integer");
  }
  const typeDir = join(factSourceRoot, WORKCASE_DIRECTORY);
  let entries;
  try {
    entries = await readdir(typeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return success({ items: [], total: 0, complete: true, invalid: [] });
    return failure("workcase/directory_unavailable", `cannot read workcases directory: ${error.message}`);
  }

  const invalid = [];
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const nameMatch = entry.name.match(/^workcase-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/i);
    if (!nameMatch) continue;
    const uid = nameMatch[1].toLowerCase();
    let content;
    try {
      content = await readFile(join(typeDir, entry.name), "utf8");
    } catch (error) {
      invalid.push({ file: entry.name, reason: `unreadable: ${error.message}` });
      continue;
    }
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) { invalid.push({ file: entry.name, reason: "no YAML frontmatter block" }); continue; }
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
    // F1 default candidates: draft + open (21 §13: closed 只在精确引用、
    // 证据链反查或历史追溯时展开).
    if (!includeClosed && status === "closed") continue;
    items.push({
      object_uid: uid,
      title: typeof frontmatter.title === "string" ? frontmatter.title : "",
      status,
      serves: typeof frontmatter.serves === "string" ? frontmatter.serves : undefined,
      outcome: status === "closed" && typeof frontmatter.outcome === "string" ? frontmatter.outcome : undefined,
      created_at: typeof frontmatter.created_at === "string" ? frontmatter.created_at : "",
    });
  }
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const complete = items.length <= limit;
  return success({ items: complete ? items : items.slice(0, limit), total: items.length, complete, invalid });
}
