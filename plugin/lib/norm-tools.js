
import {
  createNormObject,
  readNormObject,
  updateNormObject,
  resolveNormObjectUid,
  listNormObjects,
  ERR_DIRECTION_ALREADY_EXISTS,
  validateNormFrontmatter,
  validateNormBodyStructure,
  listActiveDirectionKeys,
  NORM_TYPE_KEY,
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
    summary: "Precise read of one Norm fact object by object_uid: frontmatter, body, mechanical issues and file fingerprint (载体：fact-model-common 的 read-path-kinds 条目；norm-fact-type 的 body-sections 条目)",
    effect: "read"
  },
  "norm-list-objects": {
    toolName: "ldvh_norm_list",
    summary: "Enumerate Norm fact objects (F0/F1 discovery): direction_key/title/status AND the two bounded 方向定位与适用范围 sentences per Norm (positioning = 管什么, when_to_read = 何时查阅), so the consumer can decide which Norm governs the current matter before opening it with ldvh_norm_read; either sentence breaking the writing contract withholds BOTH and reports positioning_status=unavailable (never a truncated half-sentence); active-only by default; a collision on one direction_key withholds every colliding Norm and reports direction_collision (载体：norm-fact-type 的 positioning-two-lines 与 collision 条目)",
    effect: "read"
  },
  "norm-write-object": {
    toolName: "ldvh_norm_write",
    writeShaped: true,
    awaitsHumanDecision: true,
    summary: "Controlled write of Norm fact objects: create (requires an explicit Human confirmation and a recorded dedup conclusion; requires a direction_key with no existing active Norm, else ERR_DIRECTION_ALREADY_EXISTS) and CAS update with change_log; active→active holds direction_key fixed, active→retired requires a Human confirmation and is terminal (载体：norm-fact-type 的 create-needs-human、retire-needs-human、revise-active 与 terminal 条目；fact-model-common 的 fingerprint-baseline 与 change-log-once 条目). IMPORTANT: the 呈报内容 (dedup conclusion, title, direction_key, and the 方向定位与适用范围 points) MUST be written into the conversation body BEFORE calling — the dialog carries only the action line, so the Human judges from what you wrote there",
    effect: "may_change_state"
  }
};

const FACT_SOURCE_ROOT_DIR = "ldvh-base";


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

async function signatureFor(deps, exec) {
  const route = await currentRouteValues(deps.sessionPersistence?.(), exec?.agent);
  if (!route.ok) return { ok: false, reason: route.reason };
  return { ok: true, value: authoritativeSignature({ provider: route.value.provider, model: route.value.model }) };
}


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
      "23 §6.2 dedup and 23 §13.2 管辖边界 comparison are AI semantic work over this content, not tool output",
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
  for (const collision of value.gaps) {
    gaps.push(`direction_collision on "${collision.direction_key}": ${collision.objects.length} active Norms share this direction_key — all withheld from the served set (23 §11 item 3 fail-closed); resolve by retiring one before consuming either`);
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
      "dedup (23 §6.2) is a semantic comparison over direction_key/title — performed by the AI on this projection, never by the tool",
      "norm-read-object for the F3 full content of any candidate",
    ]
  });
}

async function requestNormGate(deps, exec, { action, objectTitle, summary }) {
  const gate = deps?.hostSeams;
  if (gate === undefined || typeof gate.requestNormConsent !== "function") {
    return {
      ok: false,
      envelope: envelope("norm-write-object", "unavailable", {
        result: null,
        scope: { requested: action, completed: [], not_completed: [action] },
        sources: [],
        gaps: ["ctx.userQuestions.ask is not wired into this composition, so the 23 §15 Human Gate "
          + "cannot be obtained. 23 §7/§15 require an explicit Human decision before this action; "
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
    agent: exec?.agent,
    signal: exec?.signal,
  });
  if (consent?.granted === true) return { ok: true };
  return {
    ok: false,
    envelope: envelope("norm-write-object", "rejected", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`23 §15 requires an explicit Human confirmation for this action: ${consent?.reason ?? "no confirmation obtained"}`],
      verification: { checks: ["governance-scope", "human-confirmation"], passed: false },
      follow_up: ["obtain the Human's explicit confirmation, then retry — do not proceed on an assumed consent"]
    })
  };
}

async function precheckNormCreate({ factSourceRoot, draft, bodyMarkdown }) {
  const { change_summary: _strippedSummary, ...draftFields } = draft ?? {};
  const probe = {
    ...draftFields,
    object_uid: "00000000-0000-4000-8000-000000000000",
    fact_type_key: NORM_TYPE_KEY,
    created_at: new Date(0).toISOString(),
  };
  if (probe.status !== undefined && probe.status !== "active") {
    return { ok: false, error_code: "norm/initial_state_violation",
      reason: `create must initialise as status=active; got ${JSON.stringify(probe.status)} (23 §8.1 — 合法初态唯一)`,
      issues: [] };
  }
  probe.status = "active";
  if (probe.retirement_reason !== undefined || probe.retired_at !== undefined) {
    return { ok: false, error_code: "norm/frontmatter_invalid",
      reason: "create must not carry retirement_reason/retired_at (23 §8: terminal fields accompany status=retired only)",
      issues: [] };
  }
  const fm = validateNormFrontmatter(probe);
  if (!fm.ok) {
    return { ok: false, error_code: "norm/frontmatter_invalid",
      reason: "frontmatter 未过 23 §8 机械校验（此时提问只会让你为一次注定失败的写入点头）", issues: fm.issues };
  }
  const listed = await listActiveDirectionKeys(factSourceRoot);
  if (!listed.ok) {
    return { ok: false, error_code: "norm/scan_failed",
      reason: `无法扫描 ${"norms"}/ 以核对 direction_key 唯一性：${listed.reason}`, issues: [] };
  }
  const occupied = listed.active.filter((e) => e.direction_key === draft?.direction_key);
  if (occupied.length > 0) {
    return {
      ok: false,
      reason: `direction_key "${draft?.direction_key}" 已被另一份 active Norm 占用（23 §11 唯一性）；请走对既有对象的受控更新，或先退役它再新建`,
      issues: occupied.map((e) => `占用者：${e.object_uid ?? e.file}（${e.title ?? ""}）`),
      error_code: ERR_DIRECTION_ALREADY_EXISTS,
    };
  }
  const assembled = `# ${draft?.title ?? ""}\n\n${String(bodyMarkdown).trim()}`;
  const bod = validateNormBodyStructure(assembled, draft?.title ?? "");
  if (!bod.ok) {
    return { ok: false, error_code: "norm/body_invalid",
      reason: "正文未过 23 §8 四段骨架校验（此时提问只会让你为一次注定失败的写入点头）", issues: bod.issues };
  }
  return { ok: true };
}

function positioningOf(args) {
  const body = typeof args?.body_markdown === "string" ? args.body_markdown : "";
  if (body.length === 0) return "";
  const section = sectionContent(body, "方向定位与适用范围");
  return typeof section === "string" ? section.trim() : "";
}

function normReportFor(action, args) {
  const lines = [];
  if (action === "create") {
    const draft = args?.frontmatter_draft ?? {};
    const dedup = typeof args?.dedup_result === "string" ? args.dedup_result.trim() : "";
    lines.push(`查重结论：${dedup.length > 0 ? dedup : "（缺失）"}`);
    const title = typeof draft.title === "string" ? draft.title.trim() : "";
    lines.push(`标题：${title.length > 0 ? title : "（缺失）"}`);
    const directionKey = typeof draft.direction_key === "string" ? draft.direction_key.trim() : "";
    lines.push(`方向键：${directionKey.length > 0 ? directionKey : "（缺失）"}`);
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
  return lines.join("\n\n");
}

function normReportGaps(action, args) {
  const gaps = [];
  if (action === "create") {
    const draft = args?.frontmatter_draft ?? {};
    if (typeof args?.dedup_result !== "string" || args.dedup_result.trim().length === 0) {
      gaps.push("dedup_result（23 §6.2/§14 的创建提案必备项：对既有 active Norm 的语义查重结论）");
    }
    if (typeof draft.title !== "string" || draft.title.trim().length === 0) gaps.push("frontmatter_draft.title");
    if (typeof draft.direction_key !== "string" || draft.direction_key.trim().length === 0) gaps.push("frontmatter_draft.direction_key");
    if (positioningOf(args).trim().length === 0) {
      gaps.push("body_markdown 的「方向定位与适用范围」段（本类型的适用范围在正文，不在 frontmatter）");
    }
  } else {
    if (typeof args?.change_summary !== "string" || args.change_summary.trim().length === 0) gaps.push("change_summary（23 §15.2 要求的据实说明）");
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
  if (!sig.ok) {
    return envelope("norm-write-object", "unavailable", {
      result: null,
      scope: { requested: action, completed: [], not_completed: [action] },
      sources: [],
      gaps: [`authoritative signature unavailable (${sig.reason}): refusing to write an unsigned change_log entry (见 controlled-commit 的 message-trailer 条目)`],
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
    const createGaps = normReportGaps("create", args);
    if (createGaps.length > 0) {
      return invalidRequest("norm-write-object",
        `23 §15.2 requires the 呈报内容 before the Human confirmation can be asked; missing: ${createGaps.join("、")}`,
        "create");
    }
    const pre = await precheckNormCreate({ factSourceRoot, draft, bodyMarkdown });
    if (!pre.ok) {
      return writeRejected(
        "norm-write-object",
        { ok: false, error: { code: pre.error_code ?? "norm/precheck_failed", message: pre.reason, details: { issues: pre.issues } } },
        factSourceRoot,
        "create",
      );
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
        ...(created.value.assurance !== undefined ? { assurance: created.value.assurance } : {}),
      },
      scope: { requested: "create", completed: ["create", "read-back"], not_completed: [] },
      sources: [{ kind: "fact-object", path: created.value.file, content_fingerprint: created.value.fingerprint }],
      gaps: readBack.ok ? [] : [readBack.error.message],
      verification: { checks: ["frontmatter-closed-set", "direction-key-format", "direction-key-uniqueness-layer-1", "body-skeleton", "write-read-back"], passed: readBack.ok },
      follow_up: [
        "23 §11 items 2–3 (Git Gate assertion, consumption fail-closed) are NOT both present in this build — do not report the direction_key uniqueness constraint as mechanically guaranteed",
        "norm-write-object action=update with the read-back fingerprint for further controlled change",
      ]
    });
  }

  const objectUidInput = args?.object_uid;
  if (typeof objectUidInput !== "string" || objectUidInput.length === 0) {
    return invalidRequest("norm-write-object", "object_uid is required for action=update", "update");
  }
  const uidResolution = await resolveNormObjectUid(factSourceRoot, objectUidInput, governed.project.id);
  if (!uidResolution.ok) {
    return writeRejected("norm-write-object", uidResolution, factSourceRoot, "update");
  }
  const objectUid = uidResolution.objectUid;
  const expectedFingerprint = args?.expected_fingerprint;
  const frontmatterAfter = args?.frontmatter_after;
  const frontmatterRemovals = Array.isArray(args?.frontmatter_removals) ? args.frontmatter_removals : null;
  const bodyMarkdownAfter = args?.body_markdown_after;
  const changeSummary = args?.change_summary;
  if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
    return invalidRequest("norm-write-object", "expected_fingerprint is required for action=update (CAS baseline — from your last precise read)", "update");
  }
  if (frontmatterAfter === undefined || frontmatterAfter === null || typeof frontmatterAfter !== "object") {
    return invalidRequest("norm-write-object", "frontmatter_after is required for action=update (an EMPTY OBJECT {} is legal and means 'no field changes')", "update");
  }
  if (typeof bodyMarkdownAfter !== "string" || bodyMarkdownAfter.length === 0) {
    return invalidRequest("norm-write-object", "body_markdown_after is required for action=update — the COMPLETE target body INCLUDING the H1 line (pass back what a precise read returned); a partial body, or a body without its H1, is refused. (create 路径的 H1 才由 title 生成)", "update");
  }
  if (typeof changeSummary !== "string" || changeSummary.length === 0) {
    return invalidRequest("norm-write-object", "change_summary is required for action=update (03 §9.5: exactly one change_log entry per actual modification)", "update");
  }
  if (frontmatterAfter.status === "retired") {
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
          `23 §15.2 requires the 呈报内容 before the Human confirmation can be asked; missing: ${retireGaps.join("、")}`,
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
    currentProjectId: governed.project.id,
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
        ...(updated.value.assurance !== undefined ? { assurance: updated.value.assurance } : {}),
      read_back: readBack.ok ? "ok" : `failed: ${readBack.error.message}`,
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
        ? "retired is the only terminal state and is read-only afterwards (23 §8.1) — restarting the direction requires a NEW Norm with a new object_uid (direction_key may be reused)"
        : "23 §13.2: the mechanically checked half is direction_key stability; whether the 方向定位与适用范围 管辖边界 changed materially is AI/Human semantic scope and is NOT mechanically enforced here",
    ]
  });
}

export function renderDirectionConflictGaps(details) {
  const conflicts = Array.isArray(details?.conflicts) ? details.conflicts : [];
  if (conflicts.length === 0) return [];
  const key = typeof details.direction_key === "string" ? details.direction_key : "(未提供)";
  return [
    `direction_key "${key}" 已被 ${conflicts.length} 条现行 Norm 占用（23 §11：同方向键至多一条 active）——走该对象的受控更新路径，或先废止再新建`,
    ...conflicts.map((entry) => `占用者：${entry?.title ?? "(无标题)"}｜object=${objectRef({ object_uid: entry?.object_uid, fact_type_key: entry?.fact_type_key ?? "norm" }) || "(未知)"}｜status=${entry?.status ?? "active"}｜文件=${entry?.file ?? "(未知)"}`)
  ];
}

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
      ? ["the direction is already carried by another active Norm — take the controlled-update path on that object, or retire it and create a new one (23 §11)"]
      : []
  });
}


function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? value ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  if (env.result) {
    lines.push(JSON.stringify(projectResultRefs(env.result, envelopeFactTypeKey(env)), null, 2));
  }
  if (Array.isArray(env.gaps) && env.gaps.length > 0) {
    lines.push("gaps:", ...env.gaps.map((gap) => `  - ${typeof gap === "string" ? gap : JSON.stringify(gap)}`));
  }
  const __warnings = Array.isArray(env.result?.warnings) ? env.result.warnings : (Array.isArray(env.warnings) ? env.warnings : []);
  if (__warnings.length > 0) {
    lines.push("warnings:", ...__warnings.map((w) => `  - ${typeof w === "string" ? w : JSON.stringify(w)}`));
  }
  const __assurance = env.result?.assurance ?? null;
  if (__assurance !== null && typeof __assurance === "object") {
    lines.push(`assurance: declared=${__assurance.declared} invalid=${__assurance.invalid.length} noneMarks=${__assurance.noneMarks} hasAtLeastOne=${__assurance.hasAtLeastOne}`);
    for (const bad of __assurance.invalid ?? []) {
      lines.push(`  - 假声明（只披露，不阻断）：line ${bad.line} ${bad.face} —— ${bad.reason}`);
    }
    if (__assurance.hasAtLeastOne === false) {
      lines.push("  - 未满足：该方向尚无强制面/保证面声明（23 §13.1 只披露不阻断）");
    }
    if (typeof __assurance.note === "string") lines.push(`  - ${__assurance.note}`);
  }

  if (Array.isArray(env.follow_up) && env.follow_up.length > 0) {
    lines.push("follow-up:", ...env.follow_up.map((item) => `  - ${typeof item === "string" ? item : JSON.stringify(item)}`));
  }
  return text(lines.join("\n"));
}

function envelopeFactTypeKey(env) {
  const operationKey = typeof env.operation_key === "string" ? env.operation_key : "";
  const factType = operationKey.split("-")[0];
  return factType === "norm" ? factType : "";
}

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
  const normFrontmatter = {
    type: "object",
    description: "AI-supplied type fields; Code assigns object_uid/fact_type_key/created_at/retired_at/change_log and generates the H1 from title",
    properties: {
      title: { type: "string", description: "≤ 40 characters; direction-spec short title for locating and Human scanning (23 §8)" },
      status: { type: "string", enum: ["active", "retired"], description: "create must be active (23 §8.1 — the only legal initial state); update may transition active→retired (terminal, read-only afterwards)" },
      direction_key: { type: "string", description: "lowercase kebab-case direction key matching ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$ (01.Att.02 §2 identifier format); at most one ACTIVE Norm per direction_key (23 §11). Immutable across updates — direction drift is a retire+create path, not an update. Carrier coherence (23 §7): this type's body is rule prose, not a projection of any frontmatter scalar, so the body is NOT required to reproduce direction_key verbatim. The only mechanical coherence check is the converse — if the body declares a direction_key in text, it must match this field; a mismatch is rejected" },
      retirement_reason: { type: "string", enum: ["superseded", "outdated", "out-of-scope"], description: "required iff status=retired, forbidden while active (23 §8/§8.1)" },
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
        status: { type: "string", enum: ["active", "all"], description: "active = default (current effective rule set, 23 §10); all = include retired for historical tracing" },
        limit: { type: "number", description: "max items returned (default 200; exceeding the cap returns a partial page with the true total — never a silent truncation, 03 §8.1)" }
      },
      additionalProperties: false
    };
  }
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "update"], description: "create: new Norm in status=active (Human decision required, 23 §15); update: CAS write against an existing object" },
      frontmatter_draft: normFrontmatter,
      body_markdown: { type: "string", description: "create: the body markdown starting with '## 方向定位与适用范围' (H2 sections 方向定位与适用范围/核心规则体系/约束与反模式/验证与遵从性检查, all four required and non-empty; the H1 is generated from title)" },
      object_uid: { type: "string", description: "update target: canonical UUIDv4, <type>-<uuid>, <type>-<8hex>, <projectId>@…, or a bare 8-hex id resolved within this type; a cross-project prefix is rejected" },
      expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
      frontmatter_after: normFrontmatterAfter,
      frontmatter_removals: { type: "array", items: { type: "string" }, description: FRONTMATTER_REMOVALS_DESCRIPTION },
      body_markdown_after: { type: "string", description: "update: the complete target body markdown (same shape as body_markdown, INCLUDING the H1 line — pass back what a precise read returned)" },
      change_summary: { type: "string", description: "update: one short semantic summary for the change_log entry" },
      dedup_result: { type: "string", description: "create (REQUIRED): the semantic dedup conclusion against existing active Norms (23 §6.2/§14.1/§15.2) — state it as e.g. \"no same-topic Norm found\" or \"overlaps <uid> but the direction is materially different\". Dedup is not mechanically decidable, but an unrecorded one refuses the write and the Human ask is not sent." }
    },
    required: ["action"],
    additionalProperties: false
  };
}

export function toolDescriptorFor(operationKey, operation, handler) {
  return defineTool({
    name: operation.toolName,
    description: operation.summary,
    parameters: toParameterSpec(parameterSchemaFor(operationKey)),
    ...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 },
    async execute(args, exec) {
      try {
        const result = await handler(args, exec);
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
    if (operation.writeShaped === true) registerWriteShapedTool(operation.toolName);
    disposers.push(ctx.tools.register(toolDescriptorFor(operationKey, operation, handlers[operationKey])));
  }
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch {   }
    }
  };
}

export { OPERATIONS };
