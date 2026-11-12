// LDVH adr mechanical layer — runtime wiring.
//
// This module connects the ADR writer (adr-writer.js, specs/22 §13 +
// specs/03 §9) to the governed tool surface so the main controller can
// drive it from a live session:
//
//   - adr-read-object  (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - adr-list-objects (effect: read)             — F0/F1 discovery:
//     dedup-relevant projection (title/decision/status/trigger_signal),
//     active-only by default (22 §12: retired stays out of ordinary
//     candidates).
//   - adr-write-object (effect: may_change_state) — controlled create
//     (after Human-confirmed proposal incl. dedup result), CAS update
//     with change_log: active→active is errata-only (mechanically gated,
//     22 §9.3), active→retired is the terminal transition; and `correct`
//     (22 §13), the terminal-record fact correction that fixes a wrong
//     retired body without touching any frontmatter field.
//
// Authorities: specs/05 §6 (operation declaration + common envelope),
// §9.3 (may_change_state), specs/03 §9 (controlled read/create/update,
// write-back read-back), specs/22 §13 (type-specific mechanical checks).
// Dedup semantic comparison (22 §6.2) is AI work recorded in the creation
// proposal — the list tool only supplies the deterministic inputs.

import {
  createAdrObject,
  readAdrObject,
  updateAdrObject,
  correctAdrObject,
  listAdrObjects,
} from "./adr-writer.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { toParameterSpec } from "./parameter-spec-adapter.js";
import { objectRef, objectRefOf } from "./object-reference.js";
import { currentRouteValues } from "./session-signature.js";
import { FRONTMATTER_AFTER_DESCRIPTION, FRONTMATTER_REMOVALS_DESCRIPTION } from "./after-integrity.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { registerWriteShapedTool } from "./host-seams.js";

const OPERATIONS = {
  "adr-read-object": {
    toolName: "ldvh_adr_read",
    summary: "Precise read of one ADR fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/03 §9.2, specs/22 §13)",
    effect: "read"
  },
  "adr-list-objects": {
    toolName: "ldvh_adr_list",
    summary: "Enumerate ADR fact objects (F0/F1 discovery): dedup-relevant projection (title/decision/status/trigger_signal) for the governed project; active-only by default (specs/03 §8, specs/22 §12)",
    effect: "read"
  },
  "adr-write-object": {
    toolName: "ldvh_adr_write",
    writeShaped: true,
    // `create` and the terminal transition (active → retired) are the two 22 §16
    // Human Gates carried by a host question (requestAdrConsent), so this tool
    // can block on a person. The timeout budget is PER TOOL, not per action, so
    // the whole tool must declare no wall-clock deadline — otherwise every CAS
    // update silently pays for the Human wait and a late answer is DISCARDED by
    // a 30s timeout, leaving the gate unenforced in real compositions. See
    // `spark-tools.js` for the identical discipline and the descriptor factory
    // for how the flag is consumed.
    //
    // Known cost, registered in workcase-3e0ad5ca: the same flag removes the
    // deadline from `correct` and from `active → active` errata updates too,
    // because one descriptor carries all three actions.
    awaitsHumanDecision: true,
    summary: "Controlled write of ADR fact objects: create (after Human-confirmed proposal incl. dedup result), CAS update with change_log (active→active is errata-only — decision/scope field-identical, 22 §9.3; active→retired is terminal, specs/03 §9.4–§9.5), and correct — the 22 §13 terminal-record fact correction that rewrites a retired ADR's body while every frontmatter field (decision/scope/status/retirement_reason/relations/retired_at) is inherited verbatim; correct takes no frontmatter input at all, requires Human authorization and rejects no-op writes",
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
  // Return the BRANDED carrier, not a plain object: the writers only accept
  // the branded form, and returning a plain object here is what let the
  // update paths silently drop the signature (found 2026-09-12). Branding
  // at the source makes it impossible for a caller to pass the wrong one.
  return { ok: true, value: authoritativeSignature({ provider: route.value.provider, model: route.value.model }) };
}

// ---------------------------------------------------------------------------
// adr-read-object / adr-list-objects / adr-write-object handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("adr-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "adr-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("adr-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readAdrObject({ factSourceRoot, objectUid, currentProjectId: governed.project.id });
  if (!read.ok) {
    // Distinguish "not found / bad uid shape" (rejected) from carrier-level
    // defects (unavailable — the object exists but cannot be consumed).
    const rejectedCodes = new Set(["adr/invalid_uid", "adr/object_not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("adr-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;
  return envelope("adr-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      status: fm.status,
      decision: typeof fm.decision === "string" ? fm.decision : undefined,
      scope: typeof fm.scope === "string" ? fm.scope : undefined,
      trigger_signal: typeof fm.trigger_signal === "string" ? fm.trigger_signal : undefined,
      retirement_reason: typeof fm.retirement_reason === "string" ? fm.retirement_reason : undefined,
      body_valid: value.body_valid,
      body_issues: value.body_issues,
      frontmatter: fm,
      body: value.body,
    },
    scope: { requested: objectUid, completed: [objectUid], not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see body_issues)"] },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: value.body_valid ? [] : value.body_issues,
    verification: { checks: ["frontmatter-parse", "body-structure"], passed: value.body_valid },
    follow_up: ["adr-write-object action=update with the observed fingerprint when a controlled change is needed"]
  });
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("adr-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object discovery serves governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const includeTerminal = args?.status === "all";
  const limit = typeof args?.limit === "number" && Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 200;
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const listed = await listAdrObjects({ factSourceRoot, includeTerminal, limit });
  if (!listed.ok) {
    return envelope("adr-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
      gaps: [`${listed.error.code}: ${listed.error.message}`],
      verification: { checks: ["directory-scan"], passed: false },
      follow_up: []
    });
  }
  const value = listed.value;
  const gaps = value.invalid.map((entry) => `invalid carrier ${entry.file}: ${entry.reason}`);
  if (!value.complete) {
    gaps.push(`projection truncated at limit=${limit} of ${value.total} matching objects — narrow the filter or raise the limit; do not treat this page as the full set (03 §8.1)`);
  }
  return envelope("adr-list-objects", value.complete ? "completed" : "partial", {
    result: {
      count: value.items.length,
      total: value.complete ? value.items.length : value.total,
      filter: includeTerminal ? "all" : "active",
      items: value.items,
    },
    scope: {
      requested: "list",
      completed: value.complete ? ["list"] : [`first ${value.items.length} of ${value.total}`],
      not_completed: value.complete ? [] : [`${value.total - value.items.length} objects beyond the limit`],
    },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (22 §6.2) is a semantic comparison over title/decision — performed by the AI on this projection, never by the tool",
      "adr-read-object for the F3 full content of any candidate",
    ]
  });
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update" && action !== "correct") {
    return invalidRequest("adr-write-object", `action must be create|update|correct; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("adr-write-object", "unavailable", {
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
  // Human requirement 2026-09-12: "changelog 和提交都要机械署名，不能署名的
  // 要报告 human". The commit half is already enforced by the Git Gate
  // trailer rules; this is the object half. When the authoritative
  // signature cannot be obtained the write is REFUSED and reported here,
  // rather than recorded as an unsigned stable fact (03 §6.1 says Code
  // fills the signature; 09 requires a definite unavailable outcome for
  // blank/historical sessions and model switches).
  if (!sig.ok) {
    return envelope("adr-write-object", "unavailable", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`signature_unavailable: the authoritative provider/model could not be read from the DSH session record (${sig.reason}). `
        + "REFUSE to write an unsigned change_log entry; REPORT TO HUMAN — this write cannot be signed and must not be recorded as a stable fact."],
      verification: { checks: ["governance-scope", "signature-source"], passed: false },
      follow_up: ["human must resolve the session signature source, then retry"]
    });
  }

  if (action === "create") {
    const draft = args?.frontmatter_draft;
    const bodyMarkdown = args?.body_markdown;
    if (typeof draft !== "object" || draft === null || typeof bodyMarkdown !== "string" || bodyMarkdown.length === 0) {
      return invalidRequest("adr-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 决策背景') are required for action=create", "create");
    }
    // 22 §14.1「查重已执行」：创建提案必含查重结论。语义判断属 AI（02 §9.2 禁止
    // 机械相似度裁决），但「有没有记录」是可判定的——未记录即不得提请（22 §17 第 1 项）。
    const dedupResult = args?.dedup_result;
    if (typeof dedupResult !== "string" || dedupResult.trim().length === 0) {
      return invalidRequest("adr-write-object", "dedup_result is required for action=create (22 §6.2/§14.1): state the semantic dedup conclusion against existing active ADRs (e.g. \"no same-topic ADR found\" / \"overlaps <uid> but the decision is materially different\"). Dedup is not mechanically decidable, but an unrecorded one is a Stop Condition.", "create");
    }
    // 22 §16 第 1 项（创建是 Human Gate）：写入前取得 Human 的明确确认。
    const gate = await requestAdrGate(deps, exec, {
      action: "create",
      objectTitle: typeof draft.title === "string" ? draft.title : undefined,
      summary: adrCreateReport(draft, dedupResult),
    });
    if (!gate.ok) return gate.envelope;
    const created = await createAdrObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.ok ? sig.value : null,
    });
    if (!created.ok) {
      return writeRejected("adr-write-object", created, factSourceRoot);
    }
    // 03 §9.4 item 5: precise read-back of the current file after create.
    const readBack = await readAdrObject({ factSourceRoot, objectUid: created.value.object_uid });
    if (!readBack.ok || readBack.value.fingerprint !== created.value.fingerprint) {
      return envelope("adr-write-object", "partial", {
        result: { object_uid: created.value.object_uid, file: created.value.file, fingerprint: created.value.fingerprint, read_back: "failed" },
        scope: { requested: "create", completed: ["create"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
        sources: [{ kind: "fact-object", path: created.value.file }],
        gaps: [`created but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
        verification: { checks: ["create"], passed: false },
        follow_up: ["STOP further writes and success claims (03 §9.4 item 7); re-read and verify the file state before anything else"]
      });
    }
    return envelope("adr-write-object", "completed", {
      result: {
        action: "create",
        object_uid: created.value.object_uid,
        actual_ref: created.value.file,
        fingerprint: created.value.fingerprint,
        read_back: { ok: true, fingerprint: readBack.value.fingerprint, body_valid: readBack.value.body_valid },
        changes: [{ object_uid: created.value.object_uid, change: "created", carrier: created.value.file }]
      },
      scope: { requested: "create", completed: ["create", "read-back"], not_completed: [] },
      sources: [{ kind: "fact-object", path: created.value.file, content_fingerprint: created.value.fingerprint }],
      gaps: sig.ok ? [] : [`change_log entry carries no provider/model: ${sig.reason}`],
      verification: { checks: ["frontmatter-closed-set", "decision-single-sentence", "body-structure", "carrier-coherence", "atomic-write", "read-back"], passed: true },
      follow_up: ["the object is created and read back; committing it to Git goes through the controlled-commit contract (specs/06)"]
    });
  }

  if (action === "correct") {
    // 22 §13 终态事实更正。**本分支刻意不读 frontmatter_after / frontmatter_removals**：
    // 该入口结构性不接收 frontmatter 输入，decision/scope/status/retirement_reason/
    // relations/retired_at 由 writer 从句盘对象逐字继承（22:171「ADR 不原地改写决策」）。
    // 调用方传入这些参数不会有任何效果——不是「校验后拒绝」，是无路可达。
    if (typeof args?.object_uid !== "string" || args.object_uid.length === 0) {
      return invalidRequest("adr-write-object", "object_uid is required for action=correct", "correct");
    }
    if (typeof args?.expected_fingerprint !== "string" || args.expected_fingerprint.length === 0) {
      return invalidRequest("adr-write-object", "expected_fingerprint is required for action=correct (CAS baseline — from your last precise read)", "correct");
    }
    if (typeof args?.body_markdown_after !== "string" || args.body_markdown_after.length === 0) {
      return invalidRequest("adr-write-object", "body_markdown_after (the complete target body starting with '## 决策背景') is required for action=correct", "correct");
    }
    if (typeof args?.change_summary !== "string" || args.change_summary.length === 0) {
      return invalidRequest("adr-write-object", "change_summary (one short semantic summary for the change_log) is required for action=correct", "correct");
    }
    const auth = args?.human_authorization;
    if (typeof auth !== "string" || auth.trim().length === 0) {
      return invalidRequest("adr-write-object", "human_authorization is required for action=correct (22 §13 终态事实更正：Human 确认；无授权记录的更正请求 fail-closed)", "correct");
    }
    // 22 §13 说 correct「不接收 frontmatter_after / frontmatter_removals」。schema 仍列出这两个
    // 参数（update 需要它们，参数表按 operation 合并），因此必须**显式拒绝**而不是静默忽略：
    // 忽略会让调用方以为字段改成了、实际被吞掉——那是「看起来生效其实没生效」，比直接报错危险。
    for (const rejected of ["frontmatter_after", "frontmatter_removals"]) {
      if (args?.[rejected] !== undefined) {
        return invalidRequest(
          "adr-write-object",
          `${rejected} is not accepted by action=correct — 22 §13：终态事实更正结构性不接收任何 frontmatter 输入（decision/scope/status/retirement_reason/relations/retired_at 逐字继承落盘对象）。要改内容用 action=update；要改决策用新 ADR + superseded-by`,
          "correct",
        );
      }
    }
    const corrected = await correctAdrObject({
      factSourceRoot,
      objectUid: args.object_uid,
      expectedFingerprint: args.expected_fingerprint,
      bodyMarkdownAfter: args.body_markdown_after,
      changeSummary: args.change_summary,
      humanAuthorization: auth,
      sessionSignature: sig.ok ? sig.value : null,
    });
    if (!corrected.ok) {
      return writeRejected("adr-write-object", corrected, factSourceRoot);
    }
    // 03 §9.4 item 5 / 22 §13：写后精确回读，与 create/update 同规格。
    const back = await readAdrObject({ factSourceRoot, objectUid: args.object_uid });
    if (!back.ok || back.value.fingerprint !== corrected.value.fingerprint) {
      return envelope("adr-write-object", "partial", {
        result: { object_uid: args.object_uid, fingerprint: corrected.value.fingerprint, read_back: "failed" },
        scope: { requested: "correct", completed: ["correct"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
        sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
        gaps: [`corrected but read-back failed: ${back.ok ? "fingerprint mismatch" : back.error.message}`],
        verification: { checks: ["correct"], passed: false },
        follow_up: ["STOP further writes and success claims (03 §9.7); re-read the object before anything else"]
      });
    }
    return envelope("adr-write-object", "completed", {
      result: {
        action: "correct",
        object_uid: args.object_uid,
        fingerprint: corrected.value.fingerprint,
        read_back: { ok: true, fingerprint: back.value.fingerprint, body_valid: back.value.body_valid },
        changes: [{ object_uid: args.object_uid, change: "corrected", summary: args.change_summary }]
      },
      scope: { requested: "correct", completed: ["correct", "read-back"], not_completed: [] },
      sources: [{ kind: "fact-object", path: back.value.file, content_fingerprint: corrected.value.fingerprint }],
      gaps: sig.ok ? [] : [`change_log entry carries no provider/model: ${sig.reason}`],
      verification: { checks: ["cas-baseline", "retired-required", "body-structure", "carrier-coherence", "no-op-rejection", "atomic-write", "read-back"], passed: true },
      follow_up: ["the object stays retired — a correction never reopens a terminal record (22 §9.2); a decision change is still a NEW ADR + superseded-by"]
    });
  }

  // action === "update"
  const objectUid = args?.object_uid;
  const expectedFingerprint = args?.expected_fingerprint;
  const frontmatterAfter = args?.frontmatter_after;
  // 显式删除声明（specs/02 §10.5 三向声明）：省略即保留，删除须显式声明。
  const frontmatterRemovals = Array.isArray(args?.frontmatter_removals) ? args.frontmatter_removals : null;
  const bodyMarkdownAfter = args?.body_markdown_after;
  const changeSummary = args?.change_summary;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("adr-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("adr-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("adr-write-object", "frontmatter_after (object) and body_markdown_after (markdown) are required for action=update", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("adr-write-object", "change_summary is required for action=update (the change_log summary; for a retirement it carries the 22 §10 evidence statement)", "update");
  }
  // 22 §16 第 2 项（终态决定 retired 是 Human Gate）：`active → retired` 的写入
  // 前取得 Human 确认。只在真正进入终态时提问——`active → active` 勘误更新是
  // 22 §9.3 的受控更新，不是本 Gate 的对象，故不打断它。
  if (frontmatterAfter.status === "retired") {
    // 读当前对象只为两件事：确认它此刻是 active（否则不是本 Gate 的对象，交给
    // writer 以 status_terminal 拒绝），以及取 title 用于询问外壳。
    const current = await readAdrObject({ factSourceRoot, objectUid });
    const currentTitle = current.ok && typeof current.value.frontmatter?.title === "string"
      ? current.value.frontmatter.title
      : undefined;
    if (current.ok && current.value.frontmatter?.status === "active") {
      const gate = await requestAdrGate(deps, exec, {
        action: "retire",
        objectTitle: currentTitle,
        summary: adrRetireReport(frontmatterAfter, changeSummary),
      });
      if (!gate.ok) return gate.envelope;
    }
  }
  const updated = await updateAdrObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint,
    frontmatterAfter,
    frontmatterRemovals,
    bodyMarkdownAfter,
    changeSummary,
    // Update path MUST brand the carrier exactly like the create path: a plain
    // {provider,model} object is rejected by resolveAuthoritativeSignature(), so
    // passing sig.value here silently wrote an unsigned change_log entry while
    // the envelope still reported sig.ok === true (no gap). Found 2026-09-12.
    sessionSignature: sig.ok ? sig.value : null,
  });
  if (!updated.ok) {
    return writeRejected("adr-write-object", updated, factSourceRoot);
  }
  const readBack = await readAdrObject({ factSourceRoot, objectUid });
  if (!readBack.ok || readBack.value.fingerprint !== updated.value.fingerprint) {
    return envelope("adr-write-object", "partial", {
      result: { object_uid: objectUid, fingerprint: updated.value.fingerprint, read_back: "failed" },
      scope: { requested: "update", completed: ["update"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
      gaps: [`updated but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
      verification: { checks: ["update"], passed: false },
      follow_up: ["STOP further writes and success claims (03 §9.7); re-read the object before anything else"]
    });
  }
  return envelope("adr-write-object", "completed", {
    result: {
      action: "update",
      object_uid: objectUid,
      fingerprint: updated.value.fingerprint,
      read_back: { ok: true, fingerprint: readBack.value.fingerprint, body_valid: readBack.value.body_valid },
      changes: [{ object_uid: objectUid, change: "updated", summary: changeSummary }],
      // 写入侧的警告（如载体内聚差异；21 §263「只报告不阻断」）。放进 result 才能被
      // renderEnvelope 渲染成 `warning:` 行——只留在 envelope 里模型侧看不见。
      ...(Array.isArray(updated.value.warnings) && updated.value.warnings.length > 0
        ? { warnings: updated.value.warnings }
        : {})
    },
    scope: { requested: "update", completed: ["update", "read-back"], not_completed: [] },
    sources: [{ kind: "fact-object", path: readBack.value.file, content_fingerprint: updated.value.fingerprint }],
    gaps: sig.ok ? [] : [`change_log entry carries no provider/model: ${sig.reason}`],
    verification: { checks: ["cas-baseline", "frontmatter-closed-set", "decision-single-sentence", "errata-boundary", "body-structure", "carrier-coherence", "relations-contract", "terminal-state-guard", "atomic-write", "read-back"], passed: true },
    follow_up: ["use the NEW fingerprint from this result for the next update; committing goes through the controlled-commit contract (specs/06)"]
  });
}

/**
 * 22 §16 呈报内容 for create — what the Human needs to judge before confirming.
 *
 * 22 §13 要求「AI 产出提案对象（含查重结论）」，22 §14.1 把「创建提案含查重
 * 结论」列为验证行。20:377 对同一类 Gate 的要求是「取得时须向 Human 呈报下列
 * 内容」——本条按该形态给出 ADR 的判断材料：查重结论 + decision + scope。
 *
 * 空行分段（与 sparkCreateReport 同形）：宿主把呈报按 Markdown 渲染，单个 `\n`
 * 不产生段落，四个字段会塌成一段，字段名与值齐平被误读为上一行续行。
 */
function adrCreateReport(draft, dedupResult) {
  const lines = [];
  lines.push(`查重结论：${String(dedupResult).trim()}`);
  const decision = typeof draft?.decision === "string" ? draft.decision.trim() : "";
  lines.push(`决定陈述：${decision.length > 0 ? decision : "（缺失）"}`);
  const scope = typeof draft?.scope === "string" ? draft.scope.trim() : "";
  lines.push(`适用范围：${scope.length > 0 ? scope : "（缺失）"}`);
  return lines.join("\n\n");
}

/**
 * 22 §16 呈报内容 for the terminal transition (retired).
 *
 * 22 §10 requires the retirement_reason to be substantiated: superseded 指明替代
 * 者与变化实质；absorbed 指明承接的 Norm 方向；outdated / out-of-scope 说明哪个
 * 前提变了；abolished 指明 Human 的作用范围与既有承载。那段据实说明落在本次
 * 流转的 `change_log.summary` 上（22 §13），故这里把它**全文**呈报给 Human。
 *
 * 本函数**不判断**那段说明是否成立——「承载列得出列不出」是 §10/§9.2 的语义判定，
 * 归 Human；机械层只保证「Human 看到了它」。
 */
function adrRetireReport(frontmatterAfter, changeSummary) {
  const lines = [];
  const reason = typeof frontmatterAfter?.retirement_reason === "string" ? frontmatterAfter.retirement_reason.trim() : "";
  lines.push(`拟转状态：retired（理由：${reason.length > 0 ? reason : "（缺失）"}）`);
  const relations = Array.isArray(frontmatterAfter?.relations) ? frontmatterAfter.relations : [];
  if (relations.length > 0) {
    const targets = relations
      .map((r) => {
        const uid = typeof r?.target?.object_uid === "string" ? r.target.object_uid : "";
        return `${String(r?.relation_key ?? "?")} → ${uid.length > 0 ? objectRef({ object_uid: uid }) : "?"}`;
      })
      .join("；");
    lines.push(`关系目标：${targets}`);
  }
  lines.push(`据实说明（change_log.summary 全文）：${String(changeSummary).trim()}`);
  return lines.join("\n\n");
}

/**
 * Route one of the two mechanically-carried 22 §16 Gates through the host
 * question entry. Fail-closed on every path that is not an explicit
 * affirmative: no answerer, a failed ask, or a declined/unchosen answer.
 *
 * 与 `requestSparkGate`（spark-tools.js:337）同形。22 §16 第 3 项（ADR 类型
 * 取消或合并）**刻意不在此**——该动作无实现入口，本 seam 不承载它，也不得据
 * 其存在声称第 3 项已获承载。
 */
async function requestAdrGate(deps, exec, { action, objectTitle, summary }) {
  const gate = deps?.hostSeams;
  if (gate === undefined || typeof gate.requestAdrConsent !== "function") {
    return {
      ok: false,
      envelope: envelope("adr-write-object", "unavailable", {
        result: null,
        scope: { requested: action, completed: [], not_completed: [action] },
        sources: [],
        gaps: ["ctx.userQuestions.ask is not wired into this composition, so the 22 §16 Human Gate "
          + "cannot be obtained. 22 §13/§16 require an explicit Human confirmation before this action; "
          + "REPORT TO HUMAN — an unconfirmed ADR write must not silently become a stable decision."],
        verification: { checks: ["governance-scope", "human-confirmation"], passed: false },
        follow_up: ["human must confirm this ADR action through a session that provides an answerer, then retry"]
      })
    };
  }
  const consent = await gate.requestAdrConsent({
    action,
    objectTitle,
    summary,
    // The host forwarder reaches the browser answerer only when the request
    // carries the live agent — without it the waterfall exhausts to NO_PROVIDER.
    agent: exec?.agent,
    // This ask has no wall-clock deadline (`awaitsHumanDecision` in OPERATIONS):
    // the caller's signal is the only release for an abandoned prompt, and
    // forwarding it makes the ask abort (ASK_ABORTED) rather than hang.
    signal: exec?.signal,
  });
  if (consent?.granted === true) return { ok: true };
  return {
    ok: false,
    envelope: envelope("adr-write-object", "rejected", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`22 §16 requires an explicit Human confirmation for this action: ${consent?.reason ?? "no confirmation obtained"}`],
      verification: { checks: ["governance-scope", "human-confirmation"], passed: false },
      follow_up: ["obtain the Human's explicit confirmation, then retry — do not proceed on an assumed consent"]
    })
  };
}

function writeRejected(operationKey, failureResult, factSourceRoot) {
  const code = failureResult.error.code;
  // Mechanical rejections (source-defined conditions refusing the write) vs
  // availability failures (carrier/IO-level problems). Both are zero-write.
  const mechanicalCodes = new Set([
    "adr/frontmatter_invalid", "adr/body_invalid", "adr/coherence_invalid",
    "adr/relations_invalid", "adr/relation_target_unresolvable",
    "adr/initial_state_violation", "adr/status_transition_invalid", "adr/status_terminal",
    "adr/errata_boundary", "adr/cas_conflict", "adr/change_summary_required", "adr/invalid_uid",
    "adr/human_authorization_required", "adr/correction_requires_retired", "adr/no_op",
    "invalid_request",
  ]);
  const outcome = mechanicalCodes.has(code) ? "rejected" : "unavailable";
  const issues = Array.isArray(failureResult.error.details?.issues) ? failureResult.error.details.issues : [];
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: "write", completed: [], not_completed: ["write"] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "adrs") }],
    gaps: [`${code}: ${failureResult.error.message}`, ...issues],
    verification: { checks: [], passed: false },
    follow_up: code === "adr/cas_conflict"
      ? ["re-read the object (adr-read-object), reconcile the concurrent change, and retry with the fresh fingerprint"]
      : code === "adr/status_terminal"
        ? ["retired ADRs are read-only for update (22 §9.2); a wrong retired body goes through action=correct (22 §13); a decision change goes through a NEW ADR + superseded-by (or an absorbed-into edge when a Norm now carries the rule)"]
        : code === "adr/correction_requires_retired"
          ? ["action=correct applies only to status=retired; for an active ADR use action=update — its active→active lane is the errata channel (22 §9.3)"]
          : code === "adr/human_authorization_required"
            ? ["ask Human for the correction authorization, then retry with human_authorization carrying who/when/what it covers (22 §13)"]
            : code === "adr/no_op"
              ? ["the submitted body is identical to the stored one — nothing to correct; do not re-submit the same body"]
              : code === "adr/errata_boundary"
                ? ["decision/scope semantics changed — create a NEW ADR carrying the revision and retire this one via superseded-by (22 §9.3)"]
                : ["fix the reported mechanical issues and retry; zero write has occurred"]
  });
}

// ---------------------------------------------------------------------------
// Registration (same shape as spark-tools.js — mounted from
// registerLdvhTools, so tools land only in governed sessions)
// ---------------------------------------------------------------------------

function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  const result = env.result;
  if (result?.object_uid !== undefined) lines.push(`object: ${objectRef({ object_uid: result.object_uid, fact_type_key: result.fact_type_key ?? "adr" })}`);
  if (result?.title !== undefined) lines.push(`title: ${result.title}`);
  if (result?.status !== undefined) lines.push(`status: ${result.status}`);
  if (result?.decision !== undefined) lines.push(`decision: ${result.decision}`);
  if (result?.scope !== undefined) lines.push(`scope: ${result.scope}`);
  if (result?.trigger_signal !== undefined) lines.push(`trigger_signal: ${result.trigger_signal}`);
  if (result?.retirement_reason !== undefined) lines.push(`retirement_reason: ${result.retirement_reason}`);
  // Full fingerprint, never truncated (03 §9.5): the render output is the
  // model's only window on the tool result — a truncated fingerprint makes
  // the CAS baseline unobtainable and blocks every controlled update.
  if (result?.fingerprint !== undefined) lines.push(`fingerprint: ${result.fingerprint}`);
  if (result?.body_valid !== undefined) lines.push(`body_valid: ${result.body_valid}`);
  if (result?.read_back?.ok !== undefined) lines.push(`read_back: ${result.read_back.ok ? "ok" : "FAILED"}`);
  if (result?.actual_ref !== undefined) lines.push(`file: ${result.actual_ref}`);
  if (result?.count !== undefined) lines.push(`count: ${result.count}${result.total !== undefined && result.total !== result.count ? ` (of ${result.total})` : ""}`);
  if (Array.isArray(result?.items)) {
    for (const item of result.items) {
      lines.push(`- ${objectRef(item)} [${item.status}] ${item.title}${item.trigger_signal ? ` (信号: ${item.trigger_signal})` : ""}`);
    }
  }
  if (Array.isArray(result?.changes)) for (const change of result.changes) lines.push(`change: ${change.change} ${objectRefOf(change.object_uid, change.fact_type_key ?? "adr")}`);
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  // **warnings 必须进模型可见文本**：只留在 envelope 里等于没给（与
  // `mechanical_issues` 此前「写入路径算出来了、投影与呈现两侧各 0 处命中」
  // 同一失效模式）。与 gaps 同层渲染，用 `warning:` 前缀区分——gap 是缺口
  // 披露，warning 是不阻断的提示。
  const __warnings = Array.isArray(env.result?.warnings) ? env.result.warnings : (Array.isArray(env.warnings) ? env.warnings : []);
  for (const w of __warnings) lines.push(`warning: ${typeof w === "string" ? w : JSON.stringify(w)}`);
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  // Models mis-shape open objects when they see additionalProperties:true
  // with no declared properties — every ADR data object declares its
  // shape explicitly (mirrors 22 §8 field contract).
  const relationEntry = {
    type: "object",
    properties: {
      relation_key: { type: "string", enum: ["superseded-by", "absorbed-into"] },
      target: { type: "object", properties: { object_uid: { type: "string" } }, required: ["object_uid"], additionalProperties: false }
    },
    required: ["relation_key", "target"],
    additionalProperties: false
  };
  const adrFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 30 characters; decision-direction title for locating and Human scanning" },
      status: { type: "string", enum: ["active", "retired"], description: "create must be active; update may transition active→retired (terminal, read-only afterwards — 22 §9)" },
      decision: { type: "string", description: "single readable sentence (at most one terminal 。？！ ending the string); must appear verbatim in the 决定 body section (carrier coherence, 22 §8, §14.1; frontmatter is the single authoritative text — the body only expands it)" },
      scope: { type: "string", description: "applicability statement; must appear verbatim in the 适用范围 body section (carrier coherence, 22 §8, §14.1; frontmatter is the single authoritative text — the body only expands it)" },
      trigger_signal: { type: "string", description: "when to revisit this decision (e.g. 「当 X 出现时重审」); omit when no real signal exists (03 §6.1 — no placeholder fabrications)" },
      urls: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, title: { type: "string" }, summary: { type: "string" } }, required: ["ref"], additionalProperties: false }, description: "external evidence supporting the decision; when non-empty the body must carry a 证据 section" },
      relations: { type: "array", items: relationEntry, description: "relation target of the retirement; each key has cardinality 1 and must match the reason: superseded→superseded-by (target resolves to an ADR), absorbed→absorbed-into (target resolves to a Norm); only on retired, forbidden on active/outdated/out-of-scope/abolished (22 §9.1, §11)" },
      retirement_reason: { type: "string", enum: ["superseded", "absorbed", "outdated", "out-of-scope", "abolished"], description: "required iff status=retired, forbidden while active (22 §9.2); superseded/absorbed each require the matching relation key; abolished = Human abolished the record (no successor/absorbing norm, no premise changed) — the effects it already produced are retained; only when the retirement statement can name how the constraint continues to be honoured (22 §10); if no such carrier exists, use superseded/absorbed/outdated/out-of-scope instead" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "decision", "scope"],
    additionalProperties: false
  };
  switch (operationKey) {
    case "adr-read-object":
      return {
        type: "object",
        properties: {
          object_uid: { type: "string", description: "Canonical object_uid of the ADR object to read — accepts five written forms and normalizes them to the canonical id: (1) bare canonical UUIDv4; (2) `<type>-<uuid>`; (3) `<type>-<8hex>` (02 §9.3 指称形态) 或裸 `<8hex>`（第五种：无类型前缀，反查时跨类型目录，命中即回填真实类型）; (4) `<projectId>@<any of those>` (what the Web 「复制对象引用」 button produces). A type prefix must match the entry being called; a short id is resolved against this project's carriers and rejected if it matches more than one (02 §9.3 第 4 条). Cross-project prefixes are rejected." }
        },
        required: ["object_uid"],
        additionalProperties: false
      };
    case "adr-list-objects":
      return {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "all"], description: "active = default (current decision baseline, 22 §12); all = include retired for historical tracing" },
          limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)" }
        },
        additionalProperties: false
      };
    case "adr-write-object":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update", "correct"] },
          frontmatter_draft: adrFrontmatter,
          dedup_result: { type: "string", description: "create (required): the semantic dedup conclusion against existing active ADRs (22 §6.2/§14.1 — 02 §9.2 forbids a mechanical similarity verdict, so the conclusion stays with you, but it is required and is presented to the Human at the 22 §16 Gate). An unrecorded dedup is a Stop Condition (22 §17 item 1)." },
          body_markdown: { type: "string", description: "create: the body markdown starting with '## 决策背景' (H2 sections 决策背景/决定/备选与理由/后果/适用范围, plus 证据 iff urls non-empty; the H1 is generated from title)" },
          object_uid: { type: "string", description: "update/correct: target object" },
          expected_fingerprint: { type: "string", description: "update/correct: CAS baseline fingerprint from your last precise read" },
          frontmatter_after: (() => { const { required: _r, ...rest } = adrFrontmatter; return { ...rest, description: `update ONLY — action=correct REFUSES this parameter outright (22 §13: the correction entry structurally takes no frontmatter input, so every field is inherited verbatim from the on-disk object; passing it is an error, not a silent no-op). ${FRONTMATTER_AFTER_DESCRIPTION}` }; })(),
          frontmatter_removals: { type: "array", items: { type: "string" }, description: `update ONLY — action=correct REFUSES this parameter outright (22 §13: 终态事实更正不接收也不删除任何 frontmatter 字段；传入即报错，不静默忽略). ${FRONTMATTER_REMOVALS_DESCRIPTION}` },
          body_markdown_after: { type: "string", description: "update/correct: the complete target body markdown (same shape as body_markdown)" },
          change_summary: { type: "string", description: "update/correct: the semantic summary for the change_log entry. For a retirement it carries the 22 §10 evidence statement and may run to several sentences; for other updates and for corrections one or two sentences suffice. It remains a summary — never a copy of the object body." },
          human_authorization: { type: "string", description: "correct ONLY, REQUIRED: the Human's authorization record (who/when/what it covers) for amending a retired record. It is written verbatim into the change_log summary; a correction request without it fails closed (22 §13). NOTE: this field is a self-report — its presence and content are NOT proof that Human actually consented (the same boundary as 21 §14 and 26 §13 correct); the mechanical gate only guarantees the record was supplied." }
        },
        required: ["action"],
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

export function toolDescriptorFor(operationKey, operation, handler) {
  // Register through defineTool so the DSH argument check actually runs: the
  // bare-descriptor path only asserts output/timeoutMs shape and stores the
  // schema verbatim, leaving `parameters` unenforced (spark-5b0b380e).
  return defineTool({
    name: operation.toolName,
    description: operation.summary,
    parameters: toParameterSpec(parameterSchemaFor(operationKey)),
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

export function registerAdrTools(ctx, deps) {
  const handlers = {
    "adr-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "adr-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "adr-write-object": (args, exec) => executeWriteObject(args, exec, deps),
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
