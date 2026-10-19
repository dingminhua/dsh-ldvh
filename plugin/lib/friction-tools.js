// LDVH friction mechanical layer — runtime wiring.
//
// This module connects the Friction writer (friction-writer.js, specs/23 §13 +
// specs/03 §9) to the governed tool surface so the main controller can
// drive it from a live session:
//
//   - friction-read-object  (effect: read)             — precise F3 read by
//     object_uid: frontmatter, body, mechanical issues and fingerprint.
//   - friction-list-objects (effect: read)             — F0/F1 discovery:
//     ledger-relevant projection (title/phenomenon/status/impact/attribution),
//     open+observing by default (26 §12: resolved stays out of ordinary
//     candidates until historical tracing).
//   - friction-write-object (effect: may_change_state) — controlled create
//     (after Human-confirmed proposal incl. dedup result) and CAS update
//     with change_log: status-preserving updates are supplement-level
//     (26 §9.3); transitions follow 26 §9.2 (observing reversible, resolved/voided terminal).
//
// Authorities: specs/05 §6 (operation declaration + common envelope),
// §9.3 (may_change_state), specs/03 §9 (controlled read/create/update,
// write-back read-back), specs/23 §13 (type-specific mechanical checks).
// Dedup semantic comparison (23 §6.2) is AI work recorded in the creation
// proposal — the list tool only supplies the deterministic inputs.

import {
  createFrictionObject,
  readFrictionObject,
  updateFrictionObject,
  correctFrictionObject,
  listFrictionObjects,
} from "./friction-writer.js";
import { objectRef, objectRefOf } from "./object-reference.js";
import { currentRouteValues } from "./session-signature.js";
import { FRONTMATTER_AFTER_DESCRIPTION } from "./after-integrity.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { registerWriteShapedTool } from "./host-seams.js";

const OPERATIONS = {
  "friction-read-object": {
    toolName: "ldvh_friction_read",
    summary: "Precise read of one Friction fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (specs/03 §9.2, specs/23 §13)",
    effect: "read"
  },
  "friction-list-objects": {
    toolName: "ldvh_friction_list",
    summary: "Enumerate Friction fact objects (F0/F1 discovery): ledger projection (title/phenomenon/status/impact/attribution/attribution_ref/occurrence) for the governed project; observing+open by default, resolved/voided only with status=all (specs/03 §8, specs/26 §12)",
    effect: "read"
  },
  "friction-write-object": {
    toolName: "ldvh_friction_write",
    writeShaped: true,
    summary: "Controlled write of Friction fact objects: create (after Human-confirmed proposal incl. dedup result) and CAS update with change_log; status-preserving updates are supplement-level, transitions per 26 §9.2 (observing→open threshold / Human 提前排期; open→observing 放回留观 reversible; →resolved needs informs 1..n; →voided no relations; resolved & voided terminal) (specs/03 §9.4–§9.5, specs/26 §13)",
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
// friction-read-object / friction-list-objects / friction-write-object handlers
// ---------------------------------------------------------------------------

async function executeReadObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("friction-read-object", "unavailable", {
      result: null,
      scope: { requested: args?.object_uid ?? null, completed: [], not_completed: [args?.object_uid ?? "friction-read-object"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const objectUid = args?.object_uid;
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return invalidRequest("friction-read-object", "object_uid is required", null);
  }
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const read = await readFrictionObject({ factSourceRoot, objectUid });
  if (!read.ok) {
    // Distinguish "not found / bad uid shape" (rejected) from carrier-level
    // defects (unavailable — the object exists but cannot be consumed).
    const rejectedCodes = new Set(["friction/invalid_uid", "friction/object_not_found"]);
    const outcome = rejectedCodes.has(read.error.code) ? "rejected" : "unavailable";
    return envelope("friction-read-object", outcome, {
      result: null,
      scope: { requested: objectUid, completed: [], not_completed: [objectUid] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "frictions") }],
      gaps: [`${read.error.code}: ${read.error.message}`],
      verification: { checks: ["precise-read"], passed: false },
      follow_up: []
    });
  }
  const value = read.value;
  const fm = value.frontmatter;
  return envelope("friction-read-object", "completed", {
    result: {
      object_uid: value.object_uid,
      file: value.file,
      fingerprint: value.fingerprint,
      title: typeof fm.title === "string" ? fm.title : undefined,
      status: fm.status,
      phenomenon: typeof fm.phenomenon === "string" ? fm.phenomenon : undefined,
      attribution: typeof fm.attribution === "string" ? fm.attribution : undefined,
      attribution_ref: typeof fm.attribution_ref === "string" ? fm.attribution_ref : undefined,
      impact: typeof fm.impact === "string" ? fm.impact : undefined,
      occurrence: fm.occurrence && typeof fm.occurrence === "object" ? fm.occurrence : undefined,
      disposition: typeof fm.disposition === "string" ? fm.disposition : undefined,
      body_valid: value.body_valid,
      body_issues: value.body_issues,
      frontmatter: fm,
      body: value.body,
    },
    scope: { requested: objectUid, completed: [objectUid], not_completed: value.body_valid ? [] : ["body-structure (mechanical issues present — see body_issues)"] },
    sources: [{ kind: "fact-object", path: value.file, content_fingerprint: value.fingerprint }],
    gaps: value.body_valid ? [] : value.body_issues,
    verification: { checks: ["frontmatter-parse", "body-structure"], passed: value.body_valid },
    follow_up: ["friction-write-object action=update with the observed fingerprint when a controlled change is needed"]
  });
}

async function executeListObject(args, exec, deps) {
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("friction-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [],
      gaps: [`governance state is ${governed.scope.state}: fact-object discovery serves governed sessions only`],
      verification: { checks: ["governance-scope"], passed: false },
      follow_up: []
    });
  }
  const includeResolved = args?.status === "all";
  const limit = typeof args?.limit === "number" && Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 200;
  const factSourceRoot = join(governed.project.path, FACT_SOURCE_ROOT_DIR);
  const listed = await listFrictionObjects({ factSourceRoot, includeResolved, limit });
  if (!listed.ok) {
    return envelope("friction-list-objects", "unavailable", {
      result: null,
      scope: { requested: "list", completed: [], not_completed: ["list"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "frictions") }],
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
  return envelope("friction-list-objects", value.complete ? "completed" : "partial", {
    result: {
      count: value.items.length,
      total: value.complete ? value.items.length : value.total,
      filter: includeResolved ? "all" : "open+observing",
      items: value.items,
    },
    scope: {
      requested: "list",
      completed: value.complete ? ["list"] : [`first ${value.items.length} of ${value.total}`],
      not_completed: value.complete ? [] : [`${value.total - value.items.length} objects beyond the limit`],
    },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "frictions") }],
    gaps,
    verification: { checks: ["directory-scan", "frontmatter-parse"], passed: gaps.length === 0 },
    follow_up: [
      "dedup (26 §6.2) is a semantic comparison over title/phenomenon — performed by the AI on this projection, never by the tool",
      "friction-read-object for the F3 full content of any candidate",
    ]
  });
}

async function executeWriteObject(args, exec, deps) {
  const action = args?.action;
  if (action !== "create" && action !== "update" && action !== "correct") {
    return invalidRequest("friction-write-object", `action must be create|update|correct; got ${JSON.stringify(action)}`, action ?? null);
  }
  const governed = await governedProject(deps.dshHomePath, exec);
  if (!governed.ok) {
    return envelope("friction-write-object", "unavailable", {
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
    return envelope("friction-write-object", "unavailable", {
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
      return invalidRequest("friction-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 现象') are required for action=create", "create");
    }
    const created = await createFrictionObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown,
      sessionSignature: sig.ok ? sig.value : null,
    });
    if (!created.ok) {
      return writeRejected("friction-write-object", created, factSourceRoot);
    }
    // 03 §9.4 item 5: precise read-back of the current file after create.
    const readBack = await readFrictionObject({ factSourceRoot, objectUid: created.value.object_uid });
    if (!readBack.ok || readBack.value.fingerprint !== created.value.fingerprint) {
      return envelope("friction-write-object", "partial", {
        result: { object_uid: created.value.object_uid, file: created.value.file, fingerprint: created.value.fingerprint, read_back: "failed" },
        scope: { requested: "create", completed: ["create"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
        sources: [{ kind: "fact-object", path: created.value.file }],
        gaps: [`created but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
        verification: { checks: ["create"], passed: false },
        follow_up: ["STOP further writes and success claims (03 §9.4 item 7); re-read and verify the file state before anything else"]
      });
    }
    return envelope("friction-write-object", "completed", {
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
      verification: { checks: ["frontmatter-closed-set", "body-structure", "carrier-coherence", "atomic-write", "read-back"], passed: true },
      follow_up: ["the object is created and read back; committing it to Git goes through the controlled-commit contract (specs/06)"]
    });
  }

  // action === "correct"（26 §13 终态事实更正；Human Gate）
  if (action === "correct") {
    if (typeof args?.object_uid !== "string" || args.object_uid.length === 0) {
      return invalidRequest("friction-write-object", "object_uid is required for action=correct", "correct");
    }
    if (typeof args?.expected_fingerprint !== "string" || args.expected_fingerprint.length === 0) {
      return invalidRequest("friction-write-object", "expected_fingerprint is required for action=correct (CAS baseline — from your last precise read)", "correct");
    }
    if (typeof args?.body_markdown_after !== "string" || args.body_markdown_after.length === 0) {
      return invalidRequest("friction-write-object", "body_markdown_after (markdown) is required for action=correct (the complete target body starting with '## 现象')", "correct");
    }
    if (typeof args?.change_summary !== "string" || args.change_summary.length === 0) {
      return invalidRequest("friction-write-object", "change_summary (one short semantic summary for the change_log) is required for action=correct", "correct");
    }
    // Human 授权记录必填（26 §13）：更正与其它受控更新同权限，缺之 fail-closed。
    const auth = args?.human_authorization;
    if (typeof auth !== "string" || auth.trim().length === 0) {
      return invalidRequest("friction-write-object", "human_authorization is required for action=correct (26 §13 终态事实更正：Human 确认；无授权记录的更正请求 fail-closed)", "correct");
    }
    const corrected = await correctFrictionObject({
      factSourceRoot,
      objectUid: args.object_uid,
      expectedFingerprint: args.expected_fingerprint,
      // 省略即不动 relations（只改正文）；显式给数组则整体替换并重跑全套关系校验。
      relationsAfter: Array.isArray(args?.relations_after) ? args.relations_after : null,
      // 2026-10：correct 入口新增的唯一 frontmatter 动作——显式删除已退出类型
      // 闭集的字段（首个用例 serves，26 §8）。省略即逐字继承落盘对象。
      frontmatterRemovals: Array.isArray(args?.frontmatter_removals) ? args.frontmatter_removals : [],
      bodyMarkdownAfter: args.body_markdown_after,
      changeSummary: args.change_summary,
      humanAuthorization: auth,
      sessionSignature: sig.ok ? sig.value : null,
      gitCommitResolver: async (hash) => {
        if (typeof hash !== "string" || !/^[0-9a-f]{40}$/i.test(hash)) return false;
        return new Promise((resolve) => {
          execFile("git", ["cat-file", "-e", `${hash}^{commit}`], { cwd: factSourceRoot }, (err) => {
            resolve(!err);
          });
        });
      },
    });
    if (!corrected.ok) {
      return writeRejected("friction-write-object", corrected, factSourceRoot);
    }
    // 写后回读（26 §13「回读同其它动作」）
    const back = await readFrictionObject({ factSourceRoot, objectUid: args.object_uid });
    if (!back.ok || back.value.fingerprint !== corrected.value.fingerprint) {
      return envelope("friction-write-object", "partial", {
        result: { object_uid: args.object_uid, fingerprint: corrected.value.fingerprint, read_back: "failed" },
        scope: { requested: "correct", completed: ["correct"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
        sources: [{ kind: "fact-object", path: join(factSourceRoot, "frictions") }],
        gaps: [`corrected but read-back failed: ${back.ok ? "fingerprint mismatch" : back.error.message}`],
        verification: { checks: ["correct"], passed: false },
        follow_up: ["STOP further writes and success claims (03 §9.7); re-read the object before anything else"]
      });
    }
    return envelope("friction-write-object", "completed", {
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
      verification: { checks: ["cas-baseline", "resolved-required", "relations-contract", "body-structure", "carrier-coherence", "no-op-rejection", "atomic-write", "read-back"], passed: true },
      follow_up: ["the object stays in its terminal status (resolved or voided) — a correction never reopens a terminal record (26 §13)"]
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
    return invalidRequest("friction-write-object", "object_uid is required for action=update", "update");
  }
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("friction-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("friction-write-object", "frontmatter_after (object) and body_markdown_after (markdown) are required for action=update", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("friction-write-object", "change_summary (one short semantic summary for the change_log) is required for action=update", "update");
  }
  const updated = await updateFrictionObject({
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
    // commit 例外（26 §9.2）：核验 informs 的 commit 目标在本仓真实存在。writer 不自行
    // 执行 git，故由本层注入——用 execFile 而非 shell，避免命令注入面。
    gitCommitResolver: async (hash) => {
      if (typeof hash !== "string" || !/^[0-9a-f]{40}$/i.test(hash)) return false;
      return new Promise((resolve) => {
        execFile("git", ["cat-file", "-e", `${hash}^{commit}`], { cwd: factSourceRoot }, (err) => {
          resolve(!err);
        });
      });
    },
  });
  if (!updated.ok) {
    return writeRejected("friction-write-object", updated, factSourceRoot);
  }
  const readBack = await readFrictionObject({ factSourceRoot, objectUid });
  if (!readBack.ok || readBack.value.fingerprint !== updated.value.fingerprint) {
    return envelope("friction-write-object", "partial", {
      result: { object_uid: objectUid, fingerprint: updated.value.fingerprint, read_back: "failed" },
      scope: { requested: "update", completed: ["update"], not_completed: ["read-back"], residual_risks: ["write landed but is unverified — file state unknown until re-read"] },
      sources: [{ kind: "fact-object", path: join(factSourceRoot, "frictions") }],
      gaps: [`updated but read-back failed: ${readBack.ok ? "fingerprint mismatch" : readBack.error.message}`],
      verification: { checks: ["update"], passed: false },
      follow_up: ["STOP further writes and success claims (03 §9.7); re-read the object before anything else"]
    });
  }
  return envelope("friction-write-object", "completed", {
    result: {
      action: "update",
      object_uid: objectUid,
      fingerprint: updated.value.fingerprint,
      read_back: { ok: true, fingerprint: readBack.value.fingerprint, body_valid: readBack.value.body_valid },
      changes: [{ object_uid: objectUid, change: "updated", summary: changeSummary }]
    },
    scope: { requested: "update", completed: ["update", "read-back"], not_completed: [] },
    sources: [{ kind: "fact-object", path: readBack.value.file, content_fingerprint: updated.value.fingerprint }],
    gaps: sig.ok ? [] : [`change_log entry carries no provider/model: ${sig.reason}`],
    verification: { checks: ["cas-baseline", "frontmatter-closed-set", "phenomenon-single-sentence", "body-structure", "carrier-coherence", "occurrence-contract", "relations-contract", "transition-guards", "atomic-write", "read-back"], passed: true },
    follow_up: ["use the NEW fingerprint from this result for the next update; committing goes through the controlled-commit contract (specs/06)"]
  });
}

function writeRejected(operationKey, failureResult, factSourceRoot) {
  const code = failureResult.error.code;
  // Mechanical rejections (source-defined conditions refusing the write) vs
  // availability failures (carrier/IO-level problems). Both are zero-write.
  const mechanicalCodes = new Set([
    "friction/frontmatter_invalid", "friction/body_invalid", "friction/coherence_invalid",
    "friction/initial_state_violation", "friction/status_transition_invalid", "friction/status_terminal",
    "friction/relations_invalid", "friction/relation_target_unresolvable", "friction/occurrence_invalid",
    "friction/cas_conflict", "friction/change_summary_required", "friction/invalid_uid",
    "invalid_request",
  ]);
  const outcome = mechanicalCodes.has(code) ? "rejected" : "unavailable";
  const issues = Array.isArray(failureResult.error.details?.issues) ? failureResult.error.details.issues : [];
  return envelope(operationKey, outcome, {
    result: null,
    scope: { requested: "write", completed: [], not_completed: ["write"] },
    sources: [{ kind: "fact-object", path: join(factSourceRoot, "frictions") }],
    gaps: [`${code}: ${failureResult.error.message}`, ...issues],
    verification: { checks: [], passed: false },
    follow_up: code === "friction/cas_conflict"
      ? ["re-read the object (friction-read-object), reconcile the concurrent change, and retry with the fresh fingerprint"]
      : code === "friction/status_terminal"
        ? ["resolved Frictions are read-only (26 §9.2); a recurring obstacle goes through a NEW ledger entry referencing this uid"]
        : code === "friction/relations_invalid"
          ? ["informs 1..n with resolvable ADR/WorkCase targets is required on the resolving transition (26 §11); reactivation carries no relations"]
          : ["fix the reported mechanical issues and retry; zero write has occurred"]
  });
}

// ---------------------------------------------------------------------------
// Registration (same shape as adr-tools.js — mounted from
// registerLdvhTools, so tools land only in governed sessions)
// ---------------------------------------------------------------------------

function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  const result = env.result;
  if (result?.object_uid !== undefined) lines.push(`object: ${objectRef({ object_uid: result.object_uid, fact_type_key: result.fact_type_key ?? "friction" })}`);
  if (result?.title !== undefined) lines.push(`title: ${result.title}`);
  if (result?.status !== undefined) lines.push(`status: ${result.status}`);
  if (result?.scope !== undefined) lines.push(`scope: ${result.scope}`);
  if (result?.trigger_signal !== undefined) lines.push(`trigger_signal: ${result.trigger_signal}`);
  if (result?.disposition !== undefined) lines.push(`disposition: ${result.disposition}`);
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
  if (Array.isArray(result?.changes)) for (const change of result.changes) lines.push(`change: ${change.change} ${objectRefOf(change.object_uid, change.fact_type_key ?? "friction")}`);
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  // Models mis-shape open objects when they see additionalProperties:true
  // with no declared properties — every Friction data object declares its
  // shape explicitly (mirrors 26 §8 field contract).
  const frictionFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 30 characters; obstacle short title for locating and Human scanning" },
      status: { type: "string", enum: ["observing", "open", "resolved", "voided"], description: "create must be observing; transitions: observing→open (threshold / Human 提前排期), open→observing (放回留观, stamps occurrence.human_return_at), →resolved (informs 1..n), →voided (no relations); resolved & voided terminal & read-only (26 §9)" },
      phenomenon: { type: "string", description: "single-sentence phenomenon statement (non-conclusion, e.g. 「CI 平均 8 分钟」 not 「CI 太慢」); must appear verbatim in the 现象 body section" },
      attribution: { type: "string", description: "which subsystem/spec/process the obstacle roots in; free text — the root is often a spec/tool/process with no object identity; omit when not yet attributable (backfill via supplement update)" },
      attribution_ref: { type: "string", description: "precise reference to an existing same-project fact object_uid for the root; optional — when present Code verifies it resolves (26 §8); enables mechanical aggregation by attribution" },
      occurrence: { type: "object", properties: { count: { type: "integer" }, first_at: { type: "string" }, last_at: { type: "string" }, human_return_at: { type: "string" } }, required: ["count", "first_at", "last_at"], additionalProperties: false, description: "REQUIRED on create with count=1, first_at=last_at=now, human_return_at=null; count increments by 1 per supplement update (same update as the 现象 extension); frozen once resolved/voided; human_return_at is stamped by open→observing (放回留观) and makes the threshold transition skip this record (26 §8/§9.2, 36 §9 item 4)" },
      impact: { type: "string", enum: ["light", "medium", "heavy"], description: "impact rating; consumers anchored in 26 §12 (F1 projection, metric aggregation) and the heavy-bypasses-buffer birth path" },

      disposition: { type: "string", description: "why this entry was voided; REQUIRED iff status=voided, forbidden otherwise (26 §8) — the list card renders it so Human can read the reason without opening the detail page. resolved carries no such field: its outcome is already carried by the informs relation" },
      relations: { type: "array", items: { type: "object", properties: { relation_key: { type: "string", enum: ["informs"] }, target: { type: "object", properties: { object_uid: { type: "string" } }, required: ["object_uid"], additionalProperties: false } }, required: ["relation_key", "target"], additionalProperties: false }, description: "informs 1..n pointing at remedy objects (ADR/WorkCase uids); only on resolved (26 §11)" },
      change_summary: { type: "string", description: "one-line summary for the initial change_log entry" }
    },
    required: ["title", "phenomenon", "impact", "occurrence"],
    additionalProperties: false
  };
  switch (operationKey) {
    case "friction-read-object":
      return {
        type: "object",
        properties: {
          object_uid: { type: "string", description: "Canonical object_uid of the Friction object to read" }
        },
        required: ["object_uid"],
        additionalProperties: false
      };
    case "friction-list-objects":
      return {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "all"], description: "open = default (open+observing live ledger, 26 §12); all = include resolved for historical tracing" },
          limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)" }
        },
        additionalProperties: false
      };
    case "friction-write-object":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update", "correct"] },
          frontmatter_draft: frictionFrontmatter,
          body_markdown: { type: "string", description: "create: the body markdown starting with '## 现象' (H2 sections 现象/入账依据, plus 处置 iff status resolved/voided; the H1 is generated from title)" },
          object_uid: { type: "string", description: "update/correct: target object" },
          expected_fingerprint: { type: "string", description: "update/correct: CAS baseline fingerprint from your last precise read" },
          frontmatter_after: (() => { const { required: _r, ...rest } = frictionFrontmatter; return { ...rest, description: FRONTMATTER_AFTER_DESCRIPTION }; })(),
          body_markdown_after: { type: "string", description: "update/correct: the complete target body markdown (same shape as body_markdown)" },
          change_summary: { type: "string", description: "update/correct: one short semantic summary for the change_log entry" },
          relations_after: { type: "array", description: "correct ONLY: replaces the whole relations array (26 §13; every other field is inherited byte-identically unless explicitly removed). Omit to correct the body alone. Each entry {relation_key, target:{object_uid}, evidence_locator?:{commit}}; the whole array is re-validated and its targets re-resolved.", items: { type: "object" } },
          frontmatter_additions: { type: "object", description: "correct ONLY (2026-11): FILL a field newly admitted to the closed set (symmetric to frontmatter_removals). Only for a MISSING field — never to change an existing value; the value must be derivable from existing carriers, never fabricated (26 §13). Currently admits occurrence only.", additionalProperties: true },
          frontmatter_removals: { type: "array", description: "update/correct: explicit deletion declarations. For update (specs/02 §10.5 三向声明): fields to DELETE; only attribution/attribution_ref are accepted for update, anything else is refused with zero writes; omitting a field no longer deletes it (省略即保留). For correct (2026-10): explicitly REMOVE frontmatter fields already retired from the type's closed set — currently only [\"serves\"], dropped from 26 §8 in 2026-10. Removal is the only permitted frontmatter action: you cannot add or change a value, and omitting a field inherits it byte-identically. Needed because 受控更新 is read-only on resolved records (§9.2), so a terminal object cannot otherwise shed a field the spec no longer defines. Naming a field that is absent counts as no-op (02 §10.5).", items: { type: "string", enum: ["serves","attribution","attribution_ref"] } },
          human_authorization: { type: "string", description: "correct ONLY, REQUIRED: the Human's authorization record (who/when/what it covers) for amending a terminal record. It is written verbatim into the change_log summary; a correction request without it fails closed (26 §13). NOTE: this field is a self-report — its presence and content are NOT proof that Human actually consented (the same boundary as 21 §14 correct); the mechanical gate only guarantees the record was supplied." }
        },
        required: ["action"],
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

export function toolDescriptorFor(operationKey, operation, handler) {
  return {
    name: operation.toolName,
    description: operation.summary,
    parameters: parameterSchemaFor(operationKey),
    timeoutMs: 30000,
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
  };
}

export function registerFrictionTools(ctx, deps) {
  const handlers = {
    "friction-read-object": (args, exec) => executeReadObject(args, exec, deps),
    "friction-list-objects": (args, exec) => executeListObject(args, exec, deps),
    "friction-write-object": (args, exec) => executeWriteObject(args, exec, deps),
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
