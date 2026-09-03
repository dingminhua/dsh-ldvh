// dsh-ldvh — per-agent lifecycle registry (framework doc §4 points 1–2, 4–5).
//
// Replaces the old host-level agent/session-start + manual Map bookkeeping:
// the install point is `agent/created` (mnemon lifecycle.ts install() shape,
// dsh-agent emits it synchronously during publish), every per-agent hook
// lives on the agent's own fiber via agent.ctx.effect, and cleanup is
// automatic when that fiber is disposed — no manual agent/disposed sweeps.
//
// Discipline baked in here:
//   - roots-only gate: non-root agents (subagents) are skipped this batch
//     (Human pending item; zero-interference). Future task agents MUST be
//     registered before install() runs, or the roots-only gate will misjudge
//     them (review seam note, mirrors mnemon taskAgentIds).
//   - tools registration timing (audit A/C): registration happens HERE at
//     install time (assembly.tools are collected BEFORE the waterfall, so
//     registering inside the assemble handler would hide the tools from the
//     first model request). The assemble handler only reconciles on STATE
//     TRANSITIONS through the idempotent guard.
//   - no caching anywhere: every judgement call hits the registration file
//     (07 §5.3, Human gate 2026-09-03).

import { resolveGovernanceScope } from "./governance-scope.js";
import { registerLdvhTools } from "./ldvh-tools.js";
import { createAssembleHandler, createPreStepHandler } from "./guidance.js";
import { createTurnTriggers } from "./triggers.js";
import { createChildInstaller } from "./child.js";

export function createLifecycleRegistry(ctx, { dshHomePath, workspaceRoot, sessionScopes }) {
  // Per-agent runtime records: agentId -> { toolsDisposer, scopeState }.
  // The Map is bookkeeping only; hook cleanup rides the agent fiber.
  const agents = new Map();
  // Subagent lifecycles: agentId -> { dispose, record } (child.js mechanism).
  const children = new Map();
  const installChild = createChildInstaller(ctx, { agents, children, sessionScopes });

  function agentIdOf(agent) {
    return agent?.id ?? agent?.session?.header?.id;
  }

  function sessionIdOf(agent) {
    return agent?.session?.header?.id;
  }

  async function resolve(cwd) {
    return resolveGovernanceScope(dshHomePath, cwd);
  }

  /** Idempotent tools guard: reconcile registration with the judged state. */
  function syncTools(agent, scope) {
    const agentId = agentIdOf(agent);
    if (typeof agentId !== "string") return;
    const record = agents.get(agentId);
    if (record === undefined) return;
    const shouldRegister = scope.state === "governed" && agent?.ctx !== undefined;
    if (shouldRegister && record.toolsDisposer === null) {
      try {
        record.toolsDisposer = registerLdvhTools(agent.ctx, {
          dshHomePath,
          workspaceRoot,
          sessionPersistence: () => ctx.get("sessionPersistence")
        });
        ctx.logger.info("[dsh-ldvh] registered LDVH tool batch (agent-scoped) for governed session %s", agentId);
      } catch (error) {
        ctx.logger.warn("[dsh-ldvh] tool registration failed for %s: %s", agentId, String(error?.message ?? error));
      }
    } else if (!shouldRegister && record.toolsDisposer !== null) {
      try { record.toolsDisposer(); } catch { /* already removed */ }
      record.toolsDisposer = null;
      ctx.logger.info("[dsh-ldvh] unregistered LDVH tool batch (governance state: %s)", scope.state);
    }
    record.scopeState = scope.state;
  }

  function install(agent) {
    const agentId = agentIdOf(agent);
    if (typeof agentId !== "string") return;
    if (agents.has(agentId)) return;
    // Subagents take the child path (mechanism mounted, content empty —
    // see child.js); any other non-root agent is skipped.
    if (agent?.session?.header?.origin === "subagent") {
      installChild(agent);
      return;
    }
    // Roots-only gate: the agents service is read via ctx.get: host
    // compositions always provide it, but a minimal test/fabricated ctx may
    // not — absence means there is no roster to check against, which we
    // treat as "not a root we can verify" (skip, fail-closed).
    const agentsService = ctx.get("agents");
    if (agentsService === undefined || !agentsService.roots().includes(agent)) return;

    const record = { toolsDisposer: null, scopeState: null };
    agents.set(agentId, record);

    agent.ctx.effect(() => {
      // Tools at install time (audit A/C): the initial async judgement
      // registers the batch BEFORE the first assemble collects tools, so the
      // first model request already sees them on governed sessions.
      void resolve(agent?.session?.header?.cwd).then((scope) => {
        if (!agents.has(agentId)) return; // disposed while judging (audit F)
        const sessionId = sessionIdOf(agent);
        if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
        syncTools(agent, scope);
      }).catch((error) => {
        ctx.logger.warn("[dsh-ldvh] initial governance judgement failed for %s: %s", agentId, String(error?.message ?? error));
      });

      const onAssemble = createAssembleHandler(agent, {
        resolve,
        syncTools: (scope) => syncTools(agent, scope),
        recordScope: (scope) => {
          const sessionId = sessionIdOf(agent);
          if (typeof sessionId === "string" && agents.has(agentId)) sessionScopes.set(sessionId, scope);
        }
      });
      const onPreStep = createPreStepHandler(agent, {
        isGoverned: () => record.scopeState === "governed"
      });
      // Turn-level triggers (turn-stopping reflection seam + turn/end
      // bookkeeping seam): mounted now, content empty (Human strategy
      // 2026-09-03: 先占位后填内容).
      const turnTriggers = createTurnTriggers(agent, {
        getScopeState: () => record.scopeState,
        log: ctx.logger
      });
      const stops = [
        agent.ctx.on("system-prompt/assemble", (assembly, context, next) => onAssemble(assembly, context, next)),
        agent.ctx.on("agent/pre-step", (payload, next) => onPreStep.handler(payload, next), { prepend: true }),
        agent.ctx.on("agent/turn-stopping", (payload) => turnTriggers.onTurnStopping(payload)),
        agent.ctx.on("session/event", (session, event) => turnTriggers.onSessionEvent(session, event)),
        agent.ctx.on("agent/session-start", () => {
          // Prime the pre-step channel (every session-start source: startup /
          // resume / clear / compact) so the next step-1 is evaluated fresh
          // (mnemon primePending shape). Then state record + warm-start.
          onPreStep.prime();
          void resolve(agent?.session?.header?.cwd).then((scope) => {
            if (!agents.has(agentId)) return; // disposed while judging
            const sessionId = sessionIdOf(agent);
            if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
          }).catch(() => { /* judgement failure recorded by assemble path */ });
        })
      ];

      return () => {
        for (const stop of stops.reverse()) {
          try { stop(); } catch { /* already removed */ }
        }
        if (record.toolsDisposer !== null) {
          try { record.toolsDisposer(); } catch { /* already removed */ }
          record.toolsDisposer = null;
        }
        const sessionId = sessionIdOf(agent);
        if (typeof sessionId === "string") sessionScopes.delete(sessionId);
        agents.delete(agentId);
      };
    }, `dsh-ldvh: agent lifecycle ${agentId}`);
  }

  return {
    start() {
      const disposeCreated = ctx.on("agent/created", ({ agent }) => install(agent));
      // Adopt agents already alive when the plugin (re)loads (audit A/H):
      // without this, hot-reloaded plugins leave existing sessions hookless
      // and /ldvh/state answers unknown forever for them. The agents service
      // is optional in fabricated contexts (tests) — no roster, no adoption.
      const agentsService = ctx.get("agents");
      if (agentsService !== undefined) {
        for (const agent of agentsService.roots()) install(agent);
      }
      return () => {
        try { disposeCreated(); } catch { /* already removed */ }
        for (const { dispose } of children.values()) {
          try { dispose(); } catch { /* already removed */ }
        }
        children.clear();
        for (const agentId of [...agents.keys()]) agents.delete(agentId);
      };
    },
    /** Test/introspection seam. */
    installedAgentIds() {
      return [...agents.keys()];
    }
  };
}
