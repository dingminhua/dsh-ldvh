// LDVH Goal mechanical layer — runtime wiring.
//
// Connects the Goal writer (goal-writer.js, specs/25 §11 + specs/03 §9) to the
// governed tool surface so the main controller can drive the singleton from a
// live session:
//
//   - goal-read-object  (effect: read)             — precise read of the
//     singleton: frontmatter, body, parsed sub-goal anchors and fingerprint.
//     A missing goal.md returns `unavailable` with the 25 §10 reason (项目未
//     initialized) — reads are NOT blocked, because exploring is how a goal
//     gets formed.
//   - goal-write-object (effect: may_change_state) — controlled create (project
//     init conversation) and CAS update (statement refinement, sub-goal
//     refinement/obsoletion, achieved transition).
//
// Authorities: specs/05 §6 (operation declaration + common envelope), §9.3
// (may_change_state), specs/03 §9 (controlled read/create/update + read-back),
// specs/25 §11 §12 §13 (type-specific checks, singleton fail-closed, Human
// Gate on every revision and on the achieved transition).
//
// The singleton is deliberately NOT part of F0–F2 candidate discovery
// (25 §10 单例三免): consumers know the path, so there is no list operation.

import {
  createGoalObject,
  readGoalObject,
  updateGoalObject,
} from "./goal-writer.js";
import { currentRouteValues } from "./session-signature.js";
import { authoritativeSignature } from "./signature-channel.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { registerWriteShapedTool } from "./host-seams.js";

const OPERATIONS = {
  "goal-read-object": {
    toolName: "ldvh_goal_read",
    summary: "Precise read of the singleton Goal object (ldvh-base/goal.md): frontmatter, body, sub-goal anchors and file fingerprint (specs/25 §12, specs/03 §9.2)",
    effect: "read"
  },
  "goal-write-object": {
    toolName: "ldvh_goal_write",
    summary: "Controlled create (project init conversation) or CAS update of the singleton Goal object; create is refused when goal.md exists and every revision requires Human confirmation (specs/25 §11, §13)",
    effect: "may_change_state",
    writeShaped: true
  }
};

function envelope(operationKey, outcome, fields) {
  return { operation_key: operationKey, outcome, ...fields };
}

function invalidRequest(operationKey, message, action) {
  return envelope(operationKey, "invalid_request", {
    result: null,
    scope: { requested: action ?? null, completed: [], not_completed: [action ?? operationKey] },
    sources: [],
    gaps: [message],
    verification: { checks: [], passed: false },
    follow_up: []
  });
}

async function signatureFor(deps, exec) {
  const route = await currentRouteValues(deps.sessionPersistence?.(), exec?.agent);
  if (!route.ok) return { ok: false, reason: route.reason };
  // Branded carrier only: the writers refuse anything else (03 §6.1 / 09).
  return { ok: true, value: authoritativeSignature({ provider: route.value.provider, model: route.value.model }) };
}

async function governedProject(dshHomePath, exec) {
  const cwd = exec?.agent?.session?.header?.cwd;
  const scope = await resolveGovernanceScope(dshHomePath, cwd);
  if (scope.state !== "governed") return { ok: false, scope };
  return { ok: true, scope, path: scope.project.path };
}

export function makeExecute(deps) {
  const { dshHomePath } = deps;

  async function executeReadObject(args, exec) {
    const governed = await governedProject(dshHomePath, exec);
    if (!governed.ok) {
      return envelope("goal-read-object", "unavailable", {
        result: null,
        scope: { requested: "goal", completed: [], not_completed: ["goal"] },
        sources: [],
        gaps: [`governance state is ${governed.scope.state}: fact-object reads serve governed sessions only`],
        verification: { checks: ["governance-scope"], passed: false },
        follow_up: []
      });
    }
    const read = await readGoalObject({ factSourceRoot: `${governed.path}/ldvh-base` });
    if (!read.ok) {
      // 25 §10: a missing goal.md is a legitimate state — Gate 1 is then
      // architecturally fail-closed, and exploration is not blocked.
      const outcome = read.error.code === "goal/not_initialised" ? "unavailable" : "rejected";
      return envelope("goal-read-object", outcome, {
        result: null,
        scope: { requested: "goal", completed: [], not_completed: ["goal"] },
        sources: [{ kind: "fact-object", path: `${governed.path}/ldvh-base/goal.md` }],
        gaps: [`${read.error.code}: ${read.error.message}`],
        verification: { checks: ["carrier-present"], passed: false },
        follow_up: read.error.code === "goal/not_initialised" ? ["run the project init conversation to create the goal"] : []
      });
    }
    return envelope("goal-read-object", "completed", {
      result: {
        status: read.value.frontmatter.status,
        title: read.value.frontmatter.title,
        sub_goals: read.value.sub_goals,
        frontmatter: read.value.frontmatter,
        body: read.value.body,
        body_valid: read.value.body_valid,
        body_issues: read.value.body_issues,
        file: read.value.file,
        fingerprint: read.value.fingerprint
      },
      scope: { requested: "goal", completed: ["goal"], not_completed: [] },
      sources: [{ kind: "fact-object", path: read.value.file, content_fingerprint: read.value.fingerprint }],
      gaps: read.value.body_issues,
      verification: { checks: ["carrier-present", "frontmatter-closed-set", "body-structure", "sub-goal-parse"], passed: read.value.body_valid },
      follow_up: ["goal-write-object action=update with the observed fingerprint when a revision is needed"]
    });
  }

  async function executeWriteObject(args, exec) {
    const action = args?.action;
    if (action !== "create" && action !== "update") {
      return invalidRequest("goal-write-object", `action must be create|update; got ${JSON.stringify(action)}`, action ?? null);
    }
    const governed = await governedProject(dshHomePath, exec);
    if (!governed.ok) {
      return envelope("goal-write-object", "unavailable", {
        result: null,
        scope: { requested: action, completed: [], not_completed: [action] },
        sources: [],
        gaps: [`governance state is ${governed.scope.state}: controlled writes serve governed projects only`],
        verification: { checks: ["governance-scope"], passed: false },
        follow_up: []
      });
    }
    const factSourceRoot = `${governed.path}/ldvh-base`;
    const sig = await signatureFor(deps, exec);
    // Human requirement 2026-09-12: an unsigned change_log entry is refused,
    // and the refusal is reported for Human handling.
    if (!sig.ok) {
      return envelope("goal-write-object", "unavailable", {
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
        return invalidRequest("goal-write-object", "frontmatter_draft (object) and body_markdown (markdown starting with '## 目标陈述') are required for action=create", "create");
      }
      const created = await createGoalObject({ factSourceRoot, frontmatterDraft: draft, bodyMarkdown, sessionSignature: sig.value });
      if (!created.ok) {
        return envelope("goal-write-object", "rejected", {
          result: null,
          scope: { requested: "create", completed: [], not_completed: ["create"] },
          sources: [{ kind: "fact-object", path: `${factSourceRoot}/goal.md` }],
          gaps: [`${created.error.code}: ${created.error.message}`],
          verification: { checks: ["singleton-absent", "frontmatter-closed-set", "body-structure", "atomic-write"], passed: false },
          follow_up: created.error.code === "goal/already_exists"
            ? ["the goal already exists — revise it through action=update instead of re-creating"]
            : ["fix the reported issue and retry"]
        });
      }
      return envelope("goal-write-object", "completed", {
        result: { action: "create", file: created.value.file, fingerprint: created.value.fingerprint, read_back: created.value.read_back_fingerprint },
        scope: { requested: "create", completed: ["create", "read-back"], not_completed: [] },
        sources: [{ kind: "fact-object", path: created.value.file, content_fingerprint: created.value.fingerprint }],
        gaps: [],
        verification: { checks: ["singleton-absent", "goal-key", "status-active", "statement-present", "atomic-write", "read-back"], passed: true },
        follow_up: ["sub-goal refinement is a later controlled update (25 §7) — statement-only creation is a legal intermediate state"]
      });
    }

    // action === "update"
    const expectedFingerprint = args?.expected_fingerprint;
    if (typeof expectedFingerprint !== "string" || expectedFingerprint.length === 0) {
      return invalidRequest("goal-write-object", "expected_fingerprint is required for action=update (CAS baseline)", "update");
    }
    const frontmatterAfter = args?.frontmatter_after;
    const bodyMarkdownAfter = args?.body_markdown_after;
    const changeSummary = args?.change_summary;
    if (typeof frontmatterAfter !== "object" || frontmatterAfter === null || typeof bodyMarkdownAfter !== "string") {
      return invalidRequest("goal-write-object", "frontmatter_after (object) and body_markdown_after (markdown) are required for action=update", "update");
    }
    if (typeof changeSummary !== "string" || changeSummary.length === 0) {
      return invalidRequest("goal-write-object", "change_summary is required for action=update (25 §6: 每条必含修订理由)", "update");
    }
    const updated = await updateGoalObject({
      factSourceRoot, expectedFingerprint, frontmatterAfter, bodyMarkdownAfter, changeSummary,
      sessionSignature: sig.value,
    });
    if (!updated.ok) {
      return envelope("goal-write-object", "rejected", {
        result: null,
        scope: { requested: "update", completed: [], not_completed: ["update"] },
        sources: [{ kind: "fact-object", path: `${factSourceRoot}/goal.md` }],
        gaps: [`${updated.error.code}: ${updated.error.message}`],
        verification: { checks: ["cas-baseline", "anchor-stability", "frontmatter-closed-set", "body-structure"], passed: false },
        follow_up: updated.error.code === "goal/cas_conflict"
          ? ["re-read the goal, then retry with the new fingerprint"]
          : ["fix the reported issue and retry; do not bypass the guard"]
      });
    }
    return envelope("goal-write-object", "completed", {
      result: { action: "update", file: updated.value.file, fingerprint: updated.value.fingerprint, revised_anchors: updated.value.revised_anchors },
      scope: { requested: "update", completed: ["update", "read-back"], not_completed: [] },
      sources: [{ kind: "fact-object", path: updated.value.file, content_fingerprint: updated.value.fingerprint }],
      gaps: [],
      verification: { checks: ["cas-baseline", "anchor-stability", "frontmatter-closed-set", "body-structure", "atomic-write", "read-back"], passed: true },
      // 25 §11: the cascade is a MARK, not Goal-side state — the caller runs
      // the `serves` scan over the reported anchors.
      follow_up: ["run the goal revision cascade over revised_anchors (21 §C2 semantics); Goal stores no downstream state"]
    });
  }

  const handlers = {
    "goal-read-object": executeReadObject,
    "goal-write-object": executeWriteObject
  };
  return { handlers, OPERATIONS };
}

/** The block array shape every LDVH tool returns for the model-visible text. */
function text(body) {
  return [{ type: "text", text: body }];
}

/**
 * 模型可见的渲染形态 + 输出 schema。
 *
 * DSH 0.1.7 要求每个工具声明 `output: { schema, render }`；缺了它
 * `ctx.tools.register` 直接抛错（真机日志：`tool "ldvh_goal_read" must declare
 * output { schema, render, presentationMeta? }`）。而注册中途抛错会让
 * lifecycle 的幂等守卫（`syncTools` 里 `toolsDisposer === null`）永远无法落地，
 * 于是每次 assemble 都重试并刷「already registered」警告。本文件此前是唯一
 * 没有 output 声明的工具层（2026-09-25 desktop profile 真机验证发现）。
 */
const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? value ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  if (env.result) lines.push(JSON.stringify(env.result, null, 2));
  if (Array.isArray(env.gaps) && env.gaps.length > 0) {
    // Gaps may be structured records (05 §8 traceability), so stringify them
    // rather than interpolating them as [object Object].
    lines.push("gaps:", ...env.gaps.map((gap) => `  - ${typeof gap === "string" ? gap : JSON.stringify(gap)}`));
  }
  if (Array.isArray(env.follow_up) && env.follow_up.length > 0) {
    lines.push("follow-up:", ...env.follow_up.map((item) => `  - ${typeof item === "string" ? item : JSON.stringify(item)}`));
  }
  return text(lines.join("\n"));
}

export function toolDescriptorFor(operationKey, operation, handler) {
  return {
    name: operation.toolName,
    description: operation.summary,
    parameters: parameterSchemaFor(operationKey),
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => renderEnvelope(operationKey, value)
    },
    timeoutMs: 30000,
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
    }
  };
}

function parameterSchemaFor(operationKey) {
  switch (operationKey) {
    case "goal-read-object":
      return { type: "object", properties: {}, additionalProperties: false };
    case "goal-write-object":
      return {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "update"], description: "create (project init conversation; refused when goal.md exists) or update (CAS revision)" },
          frontmatter_draft: { type: "object", description: "create: draft frontmatter; goal_key/created_at/change_log are Code-assigned (title carries the ≤40-char short title)", additionalProperties: true },
          body_markdown: { type: "string", description: "create: the markdown body starting with '## 目标陈述' (H1 is generated)" },
          expected_fingerprint: { type: "string", description: "update: CAS baseline fingerprint from your last precise read" },
          frontmatter_after: { type: "object", description: "update: the complete target frontmatter (Code re-assigns goal_key/created_at and appends change_log)", additionalProperties: true },
          body_markdown_after: { type: "string", description: "update: the complete target body (existing SG-n anchors must survive unchanged)" },
          change_summary: { type: "string", description: "update: one reason line — must independently answer 'what changed + why' (25 §6)" }
        },
        required: ["action"],
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

/**
 * Register the Goal tool batch. Called from registerLdvhTools for governed
 * sessions only, on the same registration surface as the other type layers.
 */
export function registerGoalTools(ctx, deps) {
  const { handlers } = makeExecute(deps);
  const disposers = [];
  for (const [operationKey, operation] of Object.entries(OPERATIONS)) {
    if (operation.writeShaped === true) registerWriteShapedTool(operation.toolName);
    disposers.push(ctx.tools.register(toolDescriptorFor(operationKey, operation, handlers[operationKey])));
  }
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* already removed */ }
    }
  };
}
