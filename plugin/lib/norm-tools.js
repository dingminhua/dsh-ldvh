// LDVH norm mechanical layer — runtime wiring.
//
// This module connects the Norm writer (norm-writer.js, specs/27 §11 +
// specs/03 §9) to the governed tool surface so the main controller can
// drive it from a live session:
//
//   - norm-read-object  (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - norm-list-objects (effect: read)             — F0/F1 discovery:
//     dedup-relevant projection (title/direction_key/status), active-only
//     by default (27 §10: retired stays out of ordinary candidates).
//     Also carries uniqueness layer 3 (27 §11 item 3): on a direction
//     collision every colliding active Norm is WITHHELD and reported as
//     `direction_collision` (fail-closed, 01 §9.1) instead of being served.
//   - norm-write-object (effect: may_change_state) — controlled create
//     (after Human-confirmed proposal) and CAS update
//     with change_log: active→active is 勘误/受控更新 with direction_key
//     held fixed (27 §13.2 mechanically decidable half), active→retired is
//     the terminal transition. Carries uniqueness layer 1 (27 §11 item 1):
//     ERR_DIRECTION_ALREADY_EXISTS before any write.
//
// Authorities: specs/05 §6 (operation declaration + common envelope), §9.3
// (may_change_state), specs/03 §9 (controlled read/create/update, write-back
// read-back), specs/27 §11/§13 (type-specific mechanical checks + the
// uniqueness three-layer contract), specs/27 §15 (Human Gate: creation and
// retirement are Human decisions — this tool is the mechanical carrier, not
// the decision).
//
// UNIQUENESS THREE-LAYER STATUS (27 §11): all three layers are now present —
//   1. pre-write refusal  — norm-writer.js / this module (ERR_DIRECTION_ALREADY_EXISTS)
//   2. Git Gate interception — commit-validation.js checkNormDirectionUniqueness,
//      driven by git-gate-runner.js collectNormCarriers (covers hand-edited and
//      shell-written carriers the writer never sees)
//   3. consumption fail-closed — the list handler withholds every colliding
//      active Norm and reports direction_collision
// The gate's carrier parser normalises CRLF before reading fields; without that
// a CRLF-checked-out carrier was silently skipped and layer 2 failed OPEN.
// Dedup semantic comparison (27 §6.2, 同义异名) remains AI work recorded in the
// creation proposal — the list tool only supplies the deterministic inputs.

import {
  createNormObject,
  readNormObject,
  updateNormObject,
  listNormObjects,
  ERR_DIRECTION_ALREADY_EXISTS,
} from "./norm-writer.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { toParameterSpec } from "./parameter-spec-adapter.js";
import { objectRef, objectRefOf } from "./object-reference.js";
import { currentRouteValues } from "./session-signature.js";
import { FRONTMATTER_AFTER_DESCRIPTION, FRONTMATTER_REMOVALS_DESCRIPTION } from "./after-integrity.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";
import { sectionContent } from "./markdown-structure.js";

const OPERATIONS = {
  "norm-read-object": {
    toolName: "ldvh_norm_read",
    summary: "Precise read of one Norm fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/03 §9.2, specs/27 §11)",
    effect: "read"
  },
  "norm-list-objects": {
    toolName: "ldvh_norm_list",
    summary: "Enumerate Norm fact objects (F0/F1 discovery): direction_key/title/status AND a bounded 方向定位与适用范围 excerpt (positioning) per Norm, so the consumer can decide which Norm governs the current matter before opening it with ldvh_norm_read; active-only by default; a collision on one direction_key withholds every colliding Norm and reports direction_collision (fail-closed, specs/27 §11 item 3 / §10)",
    effect: "read"
  },
  "norm-write-object": {
    toolName: "ldvh_norm_write",
    writeShaped: true,
    // **在真实组合里会阻塞在人上**（2026-11-15）：create 与 active→retired 现在
    // 经 `requestNormConsent` 走 27 §15 第 1/2 项；其余更新不提问但共用同一描述符。
    // 超时预算**逐工具**，故整个工具不声明墙钟期限——否则每次 CAS 更新都要为
    // Human 的等待买单，而迟到的答复会被 30s 超时丢弃，门禁在真实组合里形同虚设。
    // 与 `adr-tools.js`（22 §16）同一纪律与同一已知代价。
    awaitsHumanDecision: true,
    summary: "Controlled write of Norm fact objects: create (requires an explicit Human confirmation per 27 §15 item 1 and a recorded dedup conclusion; requires a direction_key with no existing active Norm, else ERR_DIRECTION_ALREADY_EXISTS) and CAS update with change_log; active→active holds direction_key fixed (27 §13.2), active→retired requires a Human confirmation per 27 §15 item 2 and is terminal (specs/03 §9.4–§9.5, specs/27 §11). IMPORTANT: the 呈报内容 (dedup conclusion, title, direction_key, and the 方向定位与适用范围 points) MUST be written into the conversation body BEFORE calling — the dialog carries only the action line, so the Human judges from what you wrote there (27 §15.2)",
    effect: "may_change_state"
  }
};

const FACT_SOURCE_ROOT_DIR = "ldvh-base";

// ---------------------------------------------------------------------------
// Envelope helpers (05 §8 common response semantics)
// ---------------------------------------------------------------------------

function envelope(operationKey, outcome, fields) {
  return { operation_key: operationKey, outcome, ...fields };
}

function invalidRequest(operationKey, gap, requested) {
  return envelope(operationKey, "invalid_request", {
    result: null,
    scope: { requested: requested ?? null, completed: [], not_completed: [requested ?? operationKey] },
    sources: [],
    gaps: [gap],
    verification: { checks: [], passed: false },
    follow_up: []
  });
}

async function governedProject(dshHomePath, exec) {
  const cwd = exec?.agent?.session?.header?.cwd;
  const scope = await resolveGovernanceScope(dshHomePath, cwd);
  if (scope.state !== "governed") {
    return { ok: false, scope };
  }
  return { ok: true, scope, project: scope.project };
}

/** The change_log signature fields, from the authoritative session record. */
async function signatureFor(deps, exec) {
  const route = await currentRouteValues(deps.sessionPersistence?.(), exec?.agent);
  if (!route.ok) return { ok: false, reason: route.reason };
  return { ok: true, value: authoritativeSignature({ provider: route.value.provider, model: route.value.model }) };
}

// ---------------------------------------------------------------------------
// norm-read-object / norm-list-objects / norm-write-object handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("norm-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "norm-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("norm-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readNormObject({ factSourceRoot, objectUid, currentProjectId: governed.project.id });
  if (!read.ok) {
    // Distinguish "not found / bad uid shape" (rejected) from carrier-level
    // defects (unavailable — the object exists but cannot be consumed).
    const rejectedCodes = new Set(["norm/invalid_uid", "norm/not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("norm-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "norms") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;
  return envelope("norm-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      status: fm.status,
      direction_key: typeof fm.direction_key === "string" ? fm.direction_key : undefined,
      retirement_reason: typeof fm.retirement_reason === "string" ? fm.retirement_reason : undefined,
      retired_at: typeof fm.retired_at === "string" ? fm.retired_at : undefined,
      body_valid: value.body_valid,
      mechanical_issues: value.mechanical_issues,
      frontmatter: fm,
      body: value.body,
    },
    scope: { requested: objectUid, completed: [objectUid], not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see mechanical_issues)"] },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: value.mechanical_issues,
    verification: { checks: ["frontmatter-parse", "body-structure", "closed-set"], passed: value.mechanical_issues.length === 0 },
    follow_up: [
      "27 §6.2 dedup and 27 §13.2 管辖边界 comparison are AI semantic work over this content, not tool output",
      "norm-write-object action=update with the observed fingerprint when a controlled change is needed",
    ]
  });
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("norm-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object discovery serves governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const includeTerminal = args?.status === "all";
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const listed = await listNormObjects({ factSourceRoot, status: includeTerminal ? "all" : "active", limit: args?.limit });
  if (!listed.ok) {
    return envelope("norm-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "norms") }],
      gaps: [`${listed.error.code}: ${listed.error.message}`],
      verification: { checks: ["directory-scan"], passed: false },
      follow_up: []
    });
  }
  const value = listed.value;
  const gaps = value.unreadable.map((entry) => `invalid carrier ${entry.file}: ${entry.reason}`);
  // Uniqueness layer 3 (27 §11 item 3): a direction collision is a DEFECT that
  // must surface, not a filter to hide behind — the colliding objects are
  // withheld from the ordinary result above and reported here.
  for (const collision of value.gaps) {
    gaps.push(`direction_collision on "${collision.direction_key}": ${collision.objects.length} active Norms share this direction_key — all withheld from the served set (27 §11 item 3 fail-closed); resolve by retiring one before consuming either`);
  }
  if (value.truncated) {
    gaps.push(`projection truncated at limit of ${value.items.length} of ${value.total} matching objects — narrow the filter or raise the limit; do not treat this page as the full set (03 §8.1)`);
  }
  return envelope("norm-list-objects", value.gaps.length > 0 ? "partial" : "completed", {
    result: {
      count: value.items.length,
      total: value.total,
      filter: includeTerminal ? "all" : "active",
      withheld_count: value.withheld_count,
      items: value.items,
      direction_collisions: value.gaps,
    },
    scope: {
      requested: "list",
      completed: ["list"],
      not_completed: value.gaps.length > 0 ? [`${value.withheld_count} Norm(s) withheld pending direction-collision resolution`] : [],
    },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "norms") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse", "direction-key-uniqueness"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (27 §6.2) is a semantic comparison over direction_key/title — performed by the AI on this projection, never by the tool",
      "norm-read-object for the F3 full content of any candidate",
    ]
  });
}

/**
 * Route the two mechanically-carried 27 §15 Gates through the host question
 * entry. Fail-closed on every path that is not an explicit affirmative: no
 * answerer, a failed ask, or a declined/unchosen answer.
 *
 * 与 `adr-tools.js` 的 `requestAdrGate`（22 §16）同形。27 §15 第 3 项（方向清单
 * 增减）属对 27 号自身的修改、第 4 项（类型取消或合并）无实现入口，二者**刻意
 * 不在此**——本函数不承载它们，也不得据其存在声称已获承载。
 */
async function requestNormGate(deps, exec, { action, objectTitle, summary }) {
  const gate = deps?.hostSeams;
  if (gate === undefined || typeof gate.requestNormConsent !== "function") {
    return {
      ok: false,
      envelope: envelope("norm-write-object", "unavailable", {
        result: null,
        scope: { requested: action, completed: [], not_completed: [action] },
        sources: [],
        gaps: ["ctx.userQuestions.ask is not wired into this composition, so the 27 §15 Human Gate "
          + "cannot be obtained. 27 §7/§15 require an explicit Human decision before this action; "
          + "REPORT TO HUMAN — an unconfirmed Norm write must not silently become a stable direction."],
        verification: { checks: ["governance-scope", "human-confirmation"], passed: false },
        follow_up: ["human must confirm this Norm action through a session that provides an answerer, then retry"]
      })
    };
  }
  const consent = await gate.requestNormConsent({
    action,
    objectTitle,
    summary,
    // The host forwarder reaches the browser answerer only when the request
    // carries the live agent — without it the waterfall exhausts to NO_PROVIDER.
    agent: exec?.agent,
    // This ask has no wall-clock deadline (`awaitsHumanDecision` in OPERATIONS):
    // the caller's signal is the only release for an abandoned prompt.
    signal: exec?.signal,
  });
  if (consent?.granted === true) return { ok: true };
  return {
    ok: false,
    envelope: envelope("norm-write-object", "rejected", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`27 §15 requires an explicit Human confirmation for this action: ${consent?.reason ?? "no confirmation obtained"}`],
      verification: { checks: ["governance-scope", "human-confirmation"], passed: false },
      follow_up: ["obtain the Human's explicit confirmation, then retry — do not proceed on an assumed consent"]
    })
  };
}

/**
 * 安全取「方向定位与适用范围」段——`sectionContent` **找不到该 H2 时返回 `null`**，
 * 直接 `.trim()` 会抛 `TypeError`，把一条本该是「缺段，请补」的清晰拒绝变成一条
 * 内部 JS 错误（独立复核 MAJOR-1 实测：父提交报 `norm/body_invalid` + 点名缺失的
 * 段名，本次一度报 `Cannot read properties of null`）。缺段是**常规输入错误**，
 * 必须走 gaps 报出来，不能变成异常。
 */
function positioningOf(args) {
  const body = typeof args?.body_markdown === "string" ? args.body_markdown : "";
  if (body.length === 0) return "";
  const section = sectionContent(body, "方向定位与适用范围");
  return typeof section === "string" ? section.trim() : "";
}

/**
 * 呈报内容（27 §15.2）：创建给查重结论 + 方向定位；退役给理由与据实说明。
 *
 * **为什么创建侧读正文而不是 frontmatter**（2026-11-15 独立审查 MAJOR-1）：我第一版
 * 照抄 `adrCreateReport`，读了 `draft.scope`——但 **Norm 的 frontmatter 闭集里没有
 * `scope`**（27 §8；`VALID_FM_KEYS` 实测报 closed-set violation）。那一行是死代码：
 * 真实组合里宿主 schema 先拒，Human 永远看不到「这份 Norm 管什么」。
 *
 * 本类型与之对应的不是任何 frontmatter 标量，而是正文「方向定位与适用范围」段
 * （27 §7 载体内聚：规则散文整体住正文，frontmatter 只承载机器索引）。故从
 * `body_markdown` 取该段，这才是 Human 判断方向划分所需的材料。
 *
 * 与 `adrCreateReport` 同的占位纪律：缺项输出「（缺失）」而不是静默省略——省略会让
 * 报告看起来完整，而 Human 无从知道他少看了什么。
 */
function normReportFor(action, args) {
  const lines = [];
  if (action === "create") {
    const draft = args?.frontmatter_draft ?? {};
    const dedup = typeof args?.dedup_result === "string" ? args.dedup_result.trim() : "";
    // 查重结论是 27 §6.2/§14 的创建提案必备项，缺失即不可提请（与 adr-tools 同）。
    lines.push(`查重结论：${dedup.length > 0 ? dedup : "（缺失）"}`);
    const title = typeof draft.title === "string" ? draft.title.trim() : "";
    lines.push(`标题：${title.length > 0 ? title : "（缺失）"}`);
    const directionKey = typeof draft.direction_key === "string" ? draft.direction_key.trim() : "";
    lines.push(`方向键：${directionKey.length > 0 ? directionKey : "（缺失）"}`);
    // 方向定位与适用范围：本类型的「scope」在正文首段，不在 frontmatter。
    const positioning = positioningOf(args);
    const flat = positioning.replace(/\s+/g, " ").trim();
    lines.push(`方向定位与适用范围：${flat.length > 0 ? flat : "（缺失）"}`);
  } else {
    if (typeof args?.change_summary === "string" && args.change_summary.trim().length > 0) {
      lines.push(`据实说明：${args.change_summary.trim()}`);
    }
    const fm = args?.frontmatter_after;
    if (fm !== null && typeof fm === "object") {
      if (fm.status === "retired") lines.push("拟转状态：retired");
      if (typeof fm.retirement_reason === "string") lines.push(`retirement_reason：${fm.retirement_reason}`);
    }
  }
  // 空行分段（与 `adrCreateReport` 同形）：宿主按 Markdown 渲染，单个 \n 不产生段落。
  return lines.join("\n\n");
}

/**
 * 呈报里**真正必须由调用方提供**的部分（缺了就不该提请）。
 *
 * 与 `normReportFor` 分开：后者总是返回一段可渲染文本（含「（缺失）」占位），
 * 故「报告是否为空」永远判不出问题。判「能不能问」要看这一份。
 */
function normReportGaps(action, args) {
  const gaps = [];
  if (action === "create") {
    const draft = args?.frontmatter_draft ?? {};
    if (typeof args?.dedup_result !== "string" || args.dedup_result.trim().length === 0) {
      gaps.push("dedup_result（27 §6.2/§14 的创建提案必备项：对既有 active Norm 的语义查重结论）");
    }
    if (typeof draft.title !== "string" || draft.title.trim().length === 0) gaps.push("frontmatter_draft.title");
    if (typeof draft.direction_key !== "string" || draft.direction_key.trim().length === 0) gaps.push("frontmatter_draft.direction_key");
    if (positioningOf(args).trim().length === 0) {
      gaps.push("body_markdown 的「方向定位与适用范围」段（本类型的适用范围在正文，不在 frontmatter）");
    }
  } else {
    if (typeof args?.change_summary !== "string" || args.change_summary.trim().length === 0) gaps.push("change_summary（27 §15.2 要求的据实说明）");
    const fm = args?.frontmatter_after;
    if (fm === null || typeof fm !== "object" || typeof fm.retirement_reason !== "string" || fm.retirement_reason.trim().length === 0) {
      gaps.push("frontmatter_after.retirement_reason");
    }
  }
  return gaps;
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update") {
    return invalidRequest("norm-write-object", `action must be create|update; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("norm-write-object", "unavailable", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: controlled writes serve governed projects only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const sig = await signatureFor(deps, exec);
  // 03 §6.1 + 09 机械签名: a change_log entry is signed BY CODE and may not be
  // written unsigned. Without a branded carrier the write is REFUSED and
  // reported, rather than recorded as an unsigned stable fact.
  if (!sig.ok) {
    return envelope("norm-write-object", "unavailable", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`authoritative signature unavailable (${sig.reason}): refusing to write an unsigned change_log entry (specs/09)`],
      verification: { checks: ["session-signature"], passed: false },
      follow_up: ["report to Human: this write cannot be signed, so it must not be recorded as a stable fact"]
    });
  }

  if (action === "create") {
    const draft = args?.frontmatter_draft;
    const bodyMarkdown = args?.body_markdown;
    if (typeof draft !== "object" || draft === null || typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
      return invalidRequest("norm-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 方向定位与适用范围') are required for action=create", "create");
    }
    // 27 §15 第 1 项：创建须经 Human 决定。**在落盘之前**取得，未取得即零写入。
    //
    // **呈报为空时在调用端就不问**（2026-11-15）：接缝内部也有这道拒绝，但把检查
    // 放在调用端，是因为「不想问」和「问了被拒」在痕迹上不同——前者不惊动 Human，
    // 后者会在 Human 侧弹一次空问题。27 §15.2 要求 Human 看到的是他要判断的东西。
    // 27 §15.2 + 27 §6.2/§14：呈报缺项即不得提请。**查重结论缺失硬拒**——照
    // `adr-tools.js` 的 22 §14.1 处置：语义查重本身不可机械判定，但「有没有记录」
    // 可判定，未记录即不得提请（27 §17 同向）。此处若不硬拒，`title`+`direction_key`
    // 就足以让报告非空，于是「查重没做」这件事在链条上完全不可见（独立审查实测）。
    const createGaps = normReportGaps("create", args);
    if (createGaps.length > 0) {
      return invalidRequest("norm-write-object",
        `27 §15.2 requires the 呈报内容 before the Human confirmation can be asked; missing: ${createGaps.join("、")}`,
        "create");
    }
    const createReport = normReportFor("create", args);
    const gate = await requestNormGate(deps, exec, {
      action: "create",
      objectTitle: typeof draft.title === "string" ? draft.title : "",
      summary: createReport,
    });
    if (!gate.ok) return gate.envelope;
    const created = await createNormObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.value,
    });
    if (!created.ok) {
      return writeRejected("norm-write-object", created, factSourceRoot, "create");
    }
    const readBack = await readNormObject({ factSourceRoot, objectUid: created.value.object_uid });
    return envelope("norm-write-object", "completed", {
      result: {
        action: "create",
        object_uid: created.value.object_uid,
        file: created.value.file,
        fingerprint: created.value.fingerprint,
        read_back: readBack.ok ? "ok" : `failed: ${readBack.error.message}`,
      },
      scope: { requested: "create", completed: ["create", "read-back"], not_completed: [] },
      sources: [{ kind: "fact-object", path: created.value.file, content_fingerprint: created.value.fingerprint }],
      gaps: readBack.ok ? [] : [readBack.error.message],
      verification: { checks: ["frontmatter-closed-set", "direction-key-format", "direction-key-uniqueness-layer-1", "body-skeleton", "write-read-back"], passed: readBack.ok },
      follow_up: [
        "27 §11 items 2–3 (Git Gate assertion, consumption fail-closed) are NOT both present in this build — do not report the direction_key uniqueness constraint as mechanically guaranteed",
        "norm-write-object action=update with the read-back fingerprint for further controlled change",
      ]
    });
  }

  const objectUid = args?.object_uid;
  const expectedFingerprint = args?.expected_fingerprint;
  const frontmatterAfter = args?.frontmatter_after;
  // 显式删除声明（specs/02 §10.5）：未在通道内重述即继承基线，删除须显式声明。
  const frontmatterRemovals = Array.isArray(args?.frontmatter_removals) ? args.frontmatter_removals : null;
  const bodyMarkdownAfter = args?.body_markdown_after;
  const changeSummary = args?.change_summary;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("norm-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("norm-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  // 缺什么报什么：`frontmatter_after` 与正文是两个独立通道（02 §10.5），合成一句
  // 「两者都必填」会让调用方看不出究竟缺哪一项——实测本窗口有 5 次失败其实是正文
  // 已给、`frontmatter_after` 未给，却被读成「要重抄全文」。`frontmatter_after` 传
  // 空对象 `{}` 合法（各类型入口参数面均标「须携带，可为空对象」）。
  if (frontmatterAfter === undefined || frontmatterAfter === null || typeof frontmatterAfter !== "object") {
    return invalidRequest("norm-write-object", "frontmatter_after is required for action=update (an EMPTY OBJECT {} is legal and means 'no field changes')", "update");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("norm-write-object", "body_markdown_after is required for action=update — the COMPLETE target body INCLUDING the H1 line (pass back what a precise read returned); a partial body, or a body without its H1, is refused. (create 路径的 H1 才由 title 生成)", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("norm-write-object", "change_summary is required for action=update (03 §9.5: exactly one change_log entry per actual modification)", "update");
  }
  // 27 §15 第 2 项：active → retired 是终态决定，须经 Human 决定。**只有这一种
  // 迁移**要问——同状态更新（勘误级、补充级）不改变方向是否仍在生效，属 02 §10.5
  // 的受控更新，不问。这也与 22 §16 把 Gate 限定在 create/retire 的形态一致。
  if (frontmatterAfter.status === "retired") {
    // **先读当前载体再决定问不问**（与 `adr-tools.js` 的 retire 分支同形，2026-11-15
    // 独立复核 MINOR-2）：不读就会让 Human 为一次注定失败的写入点头——已过期 CAS
    // 指纹、或对象已 retired 的情形，writer 随后照样拒绝，可那道「确认」已经发生、
    // 已经落进会话记录，读起来却像一次失败的决定。故：
    //   ① 指纹不符 → 直接拒，不消耗 Human 的一次确认；
    //   ② 对象已不是 active → 不是本 Gate 的对象，交给 writer 以 terminal_readonly 拒；
    //   ③ 询问外壳用**载体上的** title，不用请求里的（请求可带任意 title）。
    const current = await readNormObject({ factSourceRoot, objectUid });
    if (!current.ok) {
      return writeRejected("norm-write-object", current, factSourceRoot, "update");
    }
    if (current.value.fingerprint !== expectedFingerprint) {
      return invalidRequest("norm-write-object",
        `expected_fingerprint does not match the current carrier (CAS baseline, 02 §10.5): re-read the object and retry — no Human confirmation was requested for this attempt`,
        "update");
    }
    if (current.value.frontmatter?.status === "active") {
      const retireGaps = normReportGaps("update", args);
      if (retireGaps.length > 0) {
        return invalidRequest("norm-write-object",
          `27 §15.2 requires the 呈报内容 before the Human confirmation can be asked; missing: ${retireGaps.join("、")}`,
          "update");
      }
      const currentTitle = typeof current.value.frontmatter?.title === "string"
        ? current.value.frontmatter.title
        : undefined;
      const gate = await requestNormGate(deps, exec, {
        action: "retire",
        objectTitle: currentTitle,
        summary: normReportFor("update", args),
      });
      if (!gate.ok) return gate.envelope;
    }
  }
  const updated = await updateNormObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    frontmatterRemovals,
    bodyMarkdownAfter,
    changeSummary,
    sessionSignature: sig.value,
  });
  if (!updated.ok) {
    return writeRejected("norm-write-object", updated, factSourceRoot, "update");
  }
  const readBack = await readNormObject({ factSourceRoot, objectUid });
  return envelope("norm-write-object", "completed", {
    result: {
      action: "update",
      transition: updated.value.transition,
      object_uid: updated.value.object_uid,
      file: updated.value.file,
      fingerprint: updated.value.fingerprint,
      read_back: readBack.ok ? "ok" : `failed: ${readBack.error.message}`,
      // 写入侧的警告（如载体内聚差异），不阻断。
      ...(Array.isArray(updated.value.warnings) && updated.value.warnings.length > 0
        ? { warnings: updated.value.warnings }
        : {})
    },
    scope: { requested: "update", completed: ["update", "read-back"], not_completed: [] },
    sources: [{ kind: "fact-object", path: updated.value.file, content_fingerprint: updated.value.fingerprint }],
    gaps: readBack.ok ? [] : [readBack.error.message],
    verification: { checks: ["cas-fingerprint", "transition-legality", "closed-set", "body-skeleton", "write-read-back"], passed: readBack.ok },
    follow_up: [
      updated.value.transition === "retire"
        ? "retired is the only terminal state and is read-only afterwards (27 §8.1) — restarting the direction requires a NEW Norm with a new object_uid (direction_key may be reused)"
        : "27 §13.2: the mechanically checked half is direction_key stability; whether the 方向定位与适用范围 管辖边界 changed materially is AI/Human semantic scope and is NOT mechanically enforced here",
    ]
  });
}

/**
 * 27 §11 item 1 的拒绝携带**结构化**载荷（`{direction_key, conflicts}`）。05 §8 的
 * envelope 里 `gaps` 是字符串列表，故占用者必须被**渲染**出来，而不能随对象一起
 * 落空——旧写法 `...(Array.isArray(details) ? details : [])` 对对象型 details 恒为
 * 假，调用方只拿到一个错误码，不知道方向键被谁占着（friction cccb379f）。
 *
 * 导出是为了让测试把**写入器的真实错误载荷**喂进来：这样「载荷带 title/status」
 * 与「工具层把它渲染给调用方」两半被同一条测试锁住，不会各自漂移。
 */
export function renderDirectionConflictGaps(details) {
  const conflicts = Array.isArray(details?.conflicts) ? details.conflicts : [];
  if (conflicts.length === 0) return [];
  const key = typeof details.direction_key === "string" ? details.direction_key : "(未提供)";
  return [
    `direction_key "${key}" 已被 ${conflicts.length} 条现行 Norm 占用（27 §11：同方向键至多一条 active）——走该对象的受控更新路径，或先废止再新建`,
    ...conflicts.map((entry) => `占用者：${entry?.title ?? "(无标题)"}｜object=${objectRef({ object_uid: entry?.object_uid, fact_type_key: entry?.fact_type_key ?? "norm" }) || "(未知)"}｜status=${entry?.status ?? "active"}｜文件=${entry?.file ?? "(未知)"}`)
  ];
}

/**
 * Map a writer failure onto the 05 §8 envelope. The uniqueness refusal has its
 * own spec-mandated code (27 §11 item 1) and is a REJECTION of the request, not
 * an unavailable capability — the tool works, the direction is already taken.
 */
export function writeRejected(operationKey, result, factSourceRoot, action) {
  const code = result.error.code;
  const isRejection = code === ERR_DIRECTION_ALREADY_EXISTS
    || code.startsWith("norm/frontmatter")
    || code.startsWith("norm/body")
    || code.startsWith("norm/coherence")
    || code.startsWith("norm/relations")
    || code.startsWith("norm/fingerprint")
    || code === "norm/transition_invalid"
    || code === "norm/terminal_readonly"
    || code === "norm/direction_key_immutable"
    || code === "norm/initial_state_violation"
    || code === "norm/superseded_unresolvable"
    || code === "norm/invalid_uid"
    || code === "norm/not_found"
    || code === "invalid_request"
    || code === "norm/change_summary_required";
  const outcome = isRejection ? "rejected" : "unavailable";
  const details = result.error.details?.issues ?? result.error.details ?? {};
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: action, completed: [], not_completed: [action] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "norms") }],
    gaps: [
      `${code}: ${result.error.message}`,
      ...(Array.isArray(details) ? details : []),
      ...renderDirectionConflictGaps(result.error.details)
    ],
    verification: { checks: ["mechanical-checks"], passed: false },
    follow_up: code === ERR_DIRECTION_ALREADY_EXISTS
      ? ["the direction is already carried by another active Norm — take the controlled-update path on that object, or retire it and create a new one (27 §11)"]
      : []
  });
}

// ---------------------------------------------------------------------------
// Rendering (05 §8 human-readable envelope)
// ---------------------------------------------------------------------------

/**
 * The single choke point for tool output (the `text()` idiom ldvh-tools.js
 * uses for all of its tools).
 *
 * output.render MUST return an ARRAY of content blocks. dsh-tools feeds the
 * return through `result.content.some((block) => block.type === "image")`, so
 * a bare string throws `content.some is not a function` and the result never
 * reaches the model — a silent total failure of every Norm tool call that no
 * handler-level test can catch.
 */
function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? value ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  if (env.result) {
    // 02 §9.3 指称形态: the result JSON carries a raw object_uid wherever a
    // reader needs to point at an object. Rewrite those references to the
    // typed form `<type>-<8hex>` before serialising — a bare 8-hex uid tells
    // the reader nothing about what kind of object it points at. The carrier
    // is untouched (this is a rendering projection, 03 §7.2 invariant 4), and
    // a type outside the known vocabulary degrades to the bare short id
    // rather than guessing a type that was never asserted.
    lines.push(JSON.stringify(projectResultRefs(env.result, envelopeFactTypeKey(env)), null, 2));
  }
  if (Array.isArray(env.gaps) && env.gaps.length > 0) {
    // Gaps may be structured records (05 §8 traceability), so stringify them
    // rather than interpolating them as [object Object].
    lines.push("gaps:", ...env.gaps.map((gap) => `  - ${typeof gap === "string" ? gap : JSON.stringify(gap)}`));
  }  // **warnings 必须进模型可见文本**（同 gaps 的理由：只留在 envelope 里等于没给）。
  const __warnings = Array.isArray(env.result?.warnings) ? env.result.warnings : (Array.isArray(env.warnings) ? env.warnings : []);
  if (__warnings.length > 0) {
    lines.push("warnings:", ...__warnings.map((w) => `  - ${typeof w === "string" ? w : JSON.stringify(w)}`));
  }

  if (Array.isArray(env.follow_up) && env.follow_up.length > 0) {
    lines.push("follow-up:", ...env.follow_up.map((item) => `  - ${typeof item === "string" ? item : JSON.stringify(item)}`));
  }
  return text(lines.join("\n"));
}

/**
 * The fact type an envelope describes, used as the fallback when a projected
 * record omits its own `fact_type_key`. Derived from the operation key
 * (`norm-read-object` / `norm-list-objects` → `norm`) rather than assumed: an
 * operation key outside the known fact-type vocabulary yields "" and the
 * renderer then leaves uids untouched instead of guessing.
 */
function envelopeFactTypeKey(env) {
  const operationKey = typeof env.operation_key === "string" ? env.operation_key : "";
  const factType = operationKey.split("-")[0];
  // The value vocabulary stays in object-reference.js (single source): an
  // unknown type already degrades to the bare short id inside objectRefOf, so
  // this only guarantees the envelope actually describes a NORM operation.
  return factType === "norm" ? factType : "";
}

/**
 * Deep-replace raw `object_uid` values with a typed reference for rendering.
 *
 * Rules (02 §9.3):
 * - a record carrying `object_uid` renders it as `<type>-<8hex>`, using its own
 *   `fact_type_key` when present and otherwise inheriting the enclosing type;
 * - the enclosing type is the type of the object being described, which the
 *   caller supplies because it is always known at the envelope level;
 * - a uid with no attributable type is left untouched: this function never
 *   invents a type for a uid it cannot attribute (objectRefOf degrades to the
 *   bare short id on an unknown/empty type).
 */
function projectResultRefs(value, factTypeKey) {
  if (Array.isArray(value)) return value.map((entry) => projectResultRefs(entry, factTypeKey));
  if (!value || typeof value !== "object") return value;
  const ownType = typeof value.fact_type_key === "string" && value.fact_type_key !== "" ? value.fact_type_key : factTypeKey;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === "object_uid" && typeof raw === "string" && raw !== "") {
      out[key] = objectRefOf(raw, ownType ?? "") || raw;
      continue;
    }
    out[key] = projectResultRefs(raw, ownType);
  }
  return out;
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  // Every Norm data object declares its shape explicitly (mirrors 27 §8 field
  // contract) — models mis-shape objects when additionalProperties:true is
  // shown with no declared properties.
  const normFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/retired_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 40 characters; direction-spec short title for locating and Human scanning (27 §8)" },
      status: { type: "string", enum: ["active", "retired"], description: "create must be active (27 §8.1 — the only legal initial state); update may transition active→retired (terminal, read-only afterwards)" },
      direction_key: { type: "string", description: "lowercase kebab-case direction key matching ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$ (01.Att.02 §2 identifier format); at most one ACTIVE Norm per direction_key (27 §11). Immutable across updates — direction drift is a retire+create path, not an update. Carrier coherence (27 §7): this type's body is rule prose, not a projection of any frontmatter scalar, so the body is NOT required to reproduce direction_key verbatim. The only mechanical coherence check is the converse — if the body declares a direction_key in text, it must match this field; a mismatch is rejected" },
      retirement_reason: { type: "string", enum: ["superseded", "outdated", "out-of-scope"], description: "required iff status=retired, forbidden while active (27 §8/§8.1)" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "direction_key"],
    additionalProperties: false
  };
  const normFrontmatterAfter = (() => {
    const { required: _r, ...rest } = normFrontmatter;
    return { ...rest, description: FRONTMATTER_AFTER_DESCRIPTION };
  })();

  if (operationKey === "norm-read-object") {
    return {
      type: "object",
      properties: { object_uid: { type: "string", description: "Canonical object_uid of the Norm object to read — accepts five written forms and normalizes them to the canonical id: (1) bare canonical UUIDv4; (2) `<type>-<uuid>`; (3) `<type>-<8hex>` (02 §9.3 指称形态) 或裸 `<8hex>`（第五种：无类型前缀，反查时跨类型目录，命中即回填真实类型）; (4) `<projectId>@<any of those>` (what the Web 「复制对象引用」 button produces). A type prefix must match the entry being called; a short id is resolved against this project's carriers and rejected if it matches more than one (02 §9.3 第 4 条). Cross-project prefixes are rejected." } },
      required: ["object_uid"],
      additionalProperties: false
    };
  }
  if (operationKey === "norm-list-objects") {
    return {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "all"], description: "active = default (current effective rule set, 27 §10); all = include retired for historical tracing" },
        limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)" }
      },
      additionalProperties: false
    };
  }
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "update"], description: "create: new Norm in status=active (Human decision required, 27 §15); update: CAS write against an existing object" },
      frontmatter_draft: normFrontmatter,
      body_markdown: { type: "string", description: "create: the body markdown starting with '## 方向定位与适用范围' (H2 sections 方向定位与适用范围/核心规则体系/约束与反模式/验证与遵从性检查, all four required and non-empty; the H1 is generated from title)" },
      object_uid: { type: "string", description: "update: target object" },
      expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
      frontmatter_after: normFrontmatterAfter,
      frontmatter_removals: { type: "array", items: { type: "string" }, description: FRONTMATTER_REMOVALS_DESCRIPTION },
      body_markdown_after: { type: "string", description: "update: the complete target body markdown (same shape as body_markdown, INCLUDING the H1 line — pass back what a precise read returned)" },
      change_summary: { type: "string", description: "update: one short semantic summary for the change_log entry" },
      // **create 必填**（27 §6.2/§14/§15.2）：create 的 Human 确认必须让 Human 看到
      // 查重结论，否则那个「确认」是对一个没人核过重的方向点头。本工具不做语义查重
      // （27 §6.2 明禁机械相似度判定），故结论只能由调用方给；但「有没有记录」可判定，
      // 未记录即硬拒、不发出提问（与 `adr-tools.js` 的 22 §14.1 同一处置）。
      dedup_result: { type: "string", description: "create (REQUIRED): the semantic dedup conclusion against existing active Norms (27 §6.2/§14.1/§15.2) — state it as e.g. \"no same-topic Norm found\" or \"overlaps <uid> but the direction is materially different\". Dedup is not mechanically decidable, but an unrecorded one refuses the write and the Human ask is not sent." }
    },
    required: ["action"],
    additionalProperties: false
  };
}

export function toolDescriptorFor(operationKey, operation, handler) {
  // Register through defineTool so the DSH argument check actually runs: the
  // bare-descriptor path only asserts output/timeoutMs shape and stores the
  // schema verbatim, leaving `parameters` unenforced (spark-5b0b380e).
  return defineTool({
    name: operation.toolName,
    description: operation.summary,
    parameters: toParameterSpec(parameterSchemaFor(operationKey)),
    // **本字段是真接线，不是装饰**（2026-11-15）：`norm-write-object` 的 create 与
    // active→retired 现在会阻塞在人的答复上（27 §15.2），而超时预算**逐工具**。
    // 若照抄一个恒定 `timeoutMs: 30000`，Human 想两分钟就要被 30s 砍掉——那时
    // 门禁在真实组合里等于不存在：答复迟到即被丢弃，写入被拒，而人以为自己答过。
    // 与 `adr-tools.js:759`、`spark-tools.js:1025` 同一接线方式。
    ...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 },
    async execute(args, exec) {
      try {
        const result = await handler(args, exec);
        // Prune undefined values (JSON round-trip): the harness lossless-JSON
        // validation rejects them, and conditional fields legitimately produce
        // undefined on objects where they are absent.
        return { envelope: JSON.parse(JSON.stringify(result)) };
      } catch (error) {
        return {
          envelope: envelope(operationKey, "execution_error", {
            result: null,
            scope: { requested: null, completed: [], not_completed: [operationKey] },
            sources: [],
            gaps: [String(error?.message ?? error)],
            verification: { checks: [], passed: false },
            follow_up: []
          })
        };
      }
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => renderEnvelope(operationKey, value)
    }
  });
}

export function registerNormTools(ctx, deps) {
  const handlers = {
    "norm-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "norm-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "norm-write-object": (args, exec) => executeWriteObject(args, exec, deps),
  };
  const disposers = [];
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
    // Coverage is registered from the declaration itself, so the guard's target
    // set always matches the tools this build really exposes (a hardcoded list
    // drifts into phantom or stale entries).
    if (operation.writeShaped === true) registerWriteShapedTool(operation.toolName);
    disposers.push(ctx.tools.register(toolDescriptorFor(operationKey, operation, handlers[operationKey])));
  }
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* already removed */ }
    }
  };
}

export { OPERATIONS };
