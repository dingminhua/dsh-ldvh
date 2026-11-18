
import { defineTool } from "@deepseek-ai/dsh-tools";
import { toParameterSpec } from "./parameter-spec-adapter.js";
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
      lines.push(`- ${child.agentId}: scope=${child.scopeState}, installed=${child.installedAt}`
        + (child.recordSource === "session-record" ? ", record=session-record" : ""));
      const conclusion = typeof child.conclusion === "string" ? child.conclusion.trim() : "";
      if (conclusion.length === 0) {
        lines.push("  conclusion: (none captured yet — the child's first turn has not ended)");
      } else if (child.agentId === env.scope?.requested) {
        lines.push(`  conclusion (${conclusion.length} chars):`);
        lines.push(conclusion);
      } else {
        const firstLine = conclusion.split("\n")[0].trim();
        lines.push(`  conclusion (${conclusion.length} chars): ${firstLine.length > 100 ? `${firstLine.slice(0, 100)}…` : firstLine}`);
      }
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
  const { dshHomePath, children, listChildren, resolveChild } = deps;
  const operationKey = "collect-subagent-results";
  const operation = OPERATIONS[operationKey];

  return ctx.tools.register(defineTool({
    name: operation.toolName,
    description: operation.summary,
    parameters: toParameterSpec(parameterSchemaFor(operationKey)),
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
            conclusion: record.conclusion,
            conclusionLength: snap.conclusionLength,
            recordSource: record.hydrated === true ? "session-record" : "registry",
            propagationCount: snap.propagationCount,
            activityCount: snap.activityCount,
            ...includeActivity ? { activity: record.activitySnapshot() } : {}
          };
        });

        if (requestedId) {
          results = results.filter(r => r.agentId === requestedId);
          let resolveNote = null;
          if (results.length === 0 && typeof resolveChild === "function") {
            const parentSessionId = exec?.agent?.session?.header?.id;
            let resolved = null;
            try {
              resolved = await resolveChild(requestedId, {
                parentSessionId: typeof parentSessionId === "string" && parentSessionId.length > 0 ? parentSessionId : undefined
              });
            } catch (error) {
              resolveNote = `the durable session-record lookup threw: ${String(error?.message ?? error)}`;
            }
            if (resolved?.ok === true && resolved.record !== null && resolved.record !== undefined) {
              const adopted = resolved.record;
              const snap = adopted.snapshot();
              results = [{
                agentId: requestedId,
                parentAgentId: snap.parentAgentId,
                scopeState: snap.scopeState,
                startedAt: snap.startedAt,
                conclusion: adopted.conclusion,
                conclusionLength: snap.conclusionLength,
                recordSource: adopted.hydrated === true ? "session-record" : "registry",
                propagationCount: snap.propagationCount,
                activityCount: snap.activityCount,
                activity: adopted.activitySnapshot()
              }];
            } else if (resolved !== null && resolveNote === null) {
              resolveNote = resolved?.reason ?? "the session record did not resolve to a subagent of this session";
            }
          }
          if (results.length === 0) {
            return {
              envelope: envelope(operationKey, "rejected", {
                result: null,
                scope: { requested: requestedId, completed: [], not_completed: [requestedId] },
                sources: [],
                gaps: [
                  `no child record found for agentId "${requestedId}"`,
                  ...(typeof resolveChild === "function"
                    ? [`the durable session-record lookup was consulted as well${resolveNote === null ? " and found no matching subagent session" : ` and reported: ${resolveNote}`}`]
                    : ["no durable session-record lookup is wired into this instance, so only the in-memory registry was consulted"]),
                ],
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
  }));
}
