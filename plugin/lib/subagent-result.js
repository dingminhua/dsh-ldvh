// LDVH subagent result collection tool (root-session only).
//
// This tool allows the root session to query the lifecycle records of its
// child subagents (installed via child.js) to collect their final status
// and activity history. It does NOT register in subagent sessions, aligning
// with the 'no tools' strategy for children.
//
// Data sources (2026-09-04 — all three now real):
// - lifecycle.js children Map: { dispose, record } per child, where record is
//   a DelegatedChildRecord (agent-lifecycle.js) owning scopeState, an
//   ActivityLog, a captured conclusion and parent-propagation bookkeeping.
// - record.scopeState: the delegated/propagated governance state.
// - record.conclusion: the child's final assistant text, captured when the
//   session-scoped `session/event` signals turn/end (there is no
//   agent/turn-end in DSH; see child.js). null means "no turn has ended yet" —
//   a real state, not a missing feature.
//
// Earlier this tool reported conclusion/activity as "not_available" because
// the child record was a bare `{ scopeState }`. With DelegatedChildRecord the
// data exists, so the gaps list below only names what is genuinely still out
// of scope (per-child tool-level provenance), not these two.

import { resolveGovernanceScope } from "./governance-scope.js";

const OPERATIONS = {
  "collect-subagent-results": {
    toolName: "ldvh_collect_subagent_results",
    summary: "Collect status and lifecycle records of child subagents for the current parent session",
    effect: "read"
  }
};

function envelope(operationKey, outcome, fields) {
  return {
    operation_key: operationKey,
    outcome,
    ...fields
  };
}

function text(body) {
  return [{ type: "text", text: body }];
}

function renderEnvelope(operationKey, value) {
  const env = value?.envelope ?? {};
  const lines = [`LDVH ${env.operation_key ?? operationKey}: ${env.outcome ?? "unknown"}`];
  if (env.result?.children) {
    lines.push(`Found ${env.result.children.length} child record(s)`);
    for (const child of env.result.children) {
      lines.push(`- ${child.agentId}: scope=${child.scopeState}, installed=${child.installedAt}`);
    }
  }
  for (const gap of env.gaps ?? []) lines.push(`gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
  return text(lines.join("\n"));
}

const OUTPUT_SCHEMA = { type: "object", additionalProperties: true };

function parameterSchemaFor(operationKey) {
  switch (operationKey) {
    case "collect-subagent-results":
      return {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Specific child agent ID to query. Omit to list all tracked children." }
        },
        additionalProperties: false
      };
    default:
      return { type: "object", properties: {}, additionalProperties: false };
  }
}

export function registerSubagentResultTool(ctx, deps) {
  // `listChildren` is the host-provided enumeration over BOTH live and retired
  // children (lifecycle.js childRecords). `children` (live-only) remains as a
  // fallback so a caller that has not adopted the seam still gets live results.
  const { dshHomePath, children, listChildren } = deps;
  const operationKey = "collect-subagent-results";
  const operation = OPERATIONS[operationKey];

  return ctx.tools.register({
    name: operation.toolName,
    description: operation.summary,
    parameters: parameterSchemaFor(operationKey),
    timeoutMs: 10000,
    async execute(args, exec) {
      try {
        const cwd = exec?.agent?.session?.header?.cwd;
        const scope = await resolveGovernanceScope(dshHomePath, cwd);

        if (scope.state !== "governed") {
          return {
            envelope: envelope(operationKey, "unavailable", {
              result: null,
              scope: { requested: "children", completed: [], not_completed: ["children"] },
              sources: [],
              gaps: [`governance state is ${scope.state}: subagent collection serves governed sessions only`],
              verification: { checks: ["governance-scope"], passed: false },
              follow_up: []
            })
          };
        }

        const requestedId = typeof args?.agentId === "string" ? args.agentId : null;
        // 活体 + **已结束**子代理都要枚举。
        //
        // 2026-09-26 修复（两处独立缺陷）：
        //  ① 原实现只读活体 `children`，而子代理结束时其记录被移入
        //     `retiredChildren`（child.js 为内存安全这么做，并明文说明
        //     「you collect a result AFTER it ends」）。于是本工具**只在子代理
        //     运行中查得到**——恰好是没人需要的时刻；结束后一律 `Found 0`。
        //     现优先使用宿主提供的 `listChildren`（活体+已结束，lifecycle.js
        //     的 childRecords），无该 seam 时回落到活体 Map 并如实标注。
        //  ② `activity: undefined` 会破坏宿主的 lossless-JSON 校验，使**不指定
        //     agentId 的枚举调用直接报错**（带 agentId 时 includeActivity 为真，
        //     无 undefined，故不报错——这正是该缺陷长期未被发现的原因）。
        //     现按需省略该字段，而不是赋 undefined。
        const listed = typeof listChildren === "function"
          ? listChildren().map((record) => [record.agentId, record])
          : Array.from(children.entries()).map(([id, entry]) => [id, entry.record]);

        let results = listed.map(([id, record]) => {
          const snap = record.snapshot();
          const includeActivity = requestedId === id;
          return {
            agentId: id,
            parentAgentId: snap.parentAgentId,
            scopeState: snap.scopeState,
            startedAt: snap.startedAt,
            // conclusion is null until the child's first turn ends; that is a
            // real state (still running), not a missing capability.
            conclusion: record.conclusion,
            conclusionLength: snap.conclusionLength,
            propagationCount: snap.propagationCount,
            activityCount: snap.activityCount,
            // Only inline the full trail for a single-agent query, so the
            // list-all case stays small by default. OMITTED (not set to
            // `undefined`) when not requested: an explicit undefined breaks the
            // host's lossless-JSON validation and made the list-all call fail
            // outright (2026-09-26 fix, see the note above).
            ...includeActivity ? { activity: record.activitySnapshot() } : {}
          };
        });

        if (requestedId) {
          results = results.filter(r => r.agentId === requestedId);
          if (results.length === 0) {
            return {
              envelope: envelope(operationKey, "rejected", {
                result: null,
                scope: { requested: requestedId, completed: [], not_completed: [requestedId] },
                sources: [],
                gaps: [`no child record found for agentId "${requestedId}"`],
                verification: { checks: ["child-lookup"], passed: false },
                follow_up: ["Omit agentId to list all children"]
              })
            };
          }
        }

        return {
          envelope: envelope(operationKey, "completed", {
            result: { children: results },
            scope: { requested: requestedId ?? "all", completed: results.map(r => r.agentId), not_completed: [] },
            sources: [{ kind: "lifecycle-map", path: "lifecycle.js:children" }],
            gaps: [
              // Honest boundary: we return the child's final TEXT. Which tools
              // it called to get there, and whether it completed successfully,
              // are not reconstructed here — the child registers no LDVH tools
              // and owns no root lifecycle, so per-tool provenance is out of
              // scope for this batch.
              "per-child tool-level provenance is not reconstructed: children register no LDVH tools and own no root lifecycle"
            ],
            verification: { checks: ["scope-check", "lifecycle-map"], passed: true },
            follow_up: []
          })
        };

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
