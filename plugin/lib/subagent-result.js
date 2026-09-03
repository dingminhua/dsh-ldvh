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
  const { dshHomePath, children } = deps;
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
        const childEntries = Array.from(children.entries());

        let results = childEntries.map(([id, { record }]) => {
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
            // list-all case stays small by default.
            activity: includeActivity ? record.activitySnapshot() : undefined
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
