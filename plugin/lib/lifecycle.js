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
import { noticeTextFor, noticeSummaryFor } from "./guidance-text.js";
import { createTurnTriggers } from "./triggers.js";
import { createChildInstaller } from "./child.js";
import { AgentLifecycle } from "./agent-lifecycle.js";
import { recordJudgementForGuard } from "./host-seams.js";

export function createLifecycleRegistry(ctx, { dshHomePath, workspaceRoot, sessionScopes, hostSeams }) {
  // Per-agent lifecycle objects (agent-lifecycle.js): single home for all
  // per-agent state + snapshot() diagnostics. The Map is bookkeeping only;
  // hook cleanup rides the agent fiber.
  const agents = new Map();
  // Subagent lifecycles: agentId -> { dispose, record } (child.js mechanism).
  // Only LIVE children: the entry is removed when the child's fiber disposes.
  const children = new Map();
  // Finished children: agentId -> { record }. A finished child is exactly the
  // one you want to collect a result from, so deleting its record on dispose
  // made result collection useless — verified live: the tool always reported
  // "Found 0 child record(s)" because the subagent had already ended. Bounded
  // FIFO eviction; this is a collection window, not a durable store.
  const retiredChildren = new Map();
  const installChild = createChildInstaller(ctx, { agents, children, sessionScopes, retiredChildren });

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
    const lifecycle = agents.get(agentId);
    if (lifecycle === undefined) return;
    const shouldRegister = scope.state === "governed" && agent?.ctx !== undefined;
    if (shouldRegister && lifecycle.toolsDisposer === null) {
      try {
        lifecycle.toolsDisposer = registerLdvhTools(agent.ctx, {
          dshHomePath,
          workspaceRoot,
          sessionPersistence: () => ctx.get("sessionPersistence"),
          // Delegation chain: the children Map is the data source for
          // ldvh_collect_subagent_results. Without it that tool is skipped by
          // its own guard (ldvh-tools.js: `deps.children !== undefined`) and
          // never registers — found in live verification, not by unit tests.
          children,
          // 子代理身份的可信来源（workcase-2be11478 计划步骤 4）：子代理本身
          // 不注册 ldvh_* 工具（`origin === "subagent"` 走 installChild 后即返回），
          // 故它无法自行记录复核结论。宿主侧的这张登记表持有 Code 亲观测到的
          // 子代理会话身份（`agent.session.header.id`）与其结论，是**调用方不可
          // 设置**的可信事实——工具层据此代其落盘复核条目，使「开启代理做独立
          // 审核」在机械上真正可行。
          lookupChild,
          // 08 §6: the registration entries route their 07 §5.6 Human Gate
          // consent through ctx.userQuestions.ask via this registry.
          hostSeams
        });
        lifecycle.activity.record("tools/registered", { count: 8 });
        ctx.logger.info("[dsh-ldvh] registered LDVH tool batch (agent-scoped) for governed session %s", agentId);
      } catch (error) {
        // Two different failures land here and must not be conflated:
        //   - ReferenceError / TypeError = a wiring defect in OUR code (a
        //     missing import, a renamed export). It is silent today apart
        //     from this line, and it makes tools vanish with no other trace.
        //   - anything else = a genuine host/environment refusal.
        // Keep the fail-soft behaviour (a session must not die because a tool
        // batch failed) but make the defect class unmistakable in the log,
        // and record it on the activity trail so /ldvh/state and the activity
        // reader can see it instead of only a console line.
        const isDefect = error instanceof ReferenceError || error instanceof TypeError;
        const detail = String(error?.message ?? error);
        ctx.logger[isDefect ? "error" : "warn"](
          "[dsh-ldvh] tool registration %s for %s: %s",
          isDefect ? "DEFECT (wiring bug, not an environment refusal)" : "failed",
          agentId,
          detail
        );
        lifecycle.activity.record(isDefect ? "tools/registration-defect" : "tools/registration-failed", {
          state: scope.state,
          detail
        });
      }
    } else if (!shouldRegister && lifecycle.toolsDisposer !== null) {
      try { lifecycle.toolsDisposer(); } catch { /* already removed */ }
      lifecycle.toolsDisposer = null;
      lifecycle.activity.record("tools/unregistered", { state: scope.state });
      ctx.logger.info("[dsh-ldvh] unregistered LDVH tool batch (governance state: %s)", scope.state);
    }
    lifecycle.setScope(scope);
    // Federate the judgement to the synchronous tools.guard (08 §6): the guard
    // cannot await, so it consults the last judgement recorded for the cwd.
    recordJudgementForGuard(agent?.session?.header?.cwd, scope.state);
    // Delegation-chain propagation (2026-09-04): a parent judgement change
    // must reach already-installed children. Without this, a child that
    // installed while the parent was `governed` keeps that stale state after
    // the parent later migrates — the exact R2e counter-example (child.js only
    // refreshed on its own session-start, which for an already-running child
    // never fires again).
    propagateToChildren(scope.state, agentId);
  }

  /**
   * Push a parent judgement change to every live child of that parent.
   * Idempotent: DelegatedChildRecord.applyParentScope ignores no-op values,
   * so repeated propagation does not inflate the activity trail.
   */
  /** Live children first, then finished ones — see children/retiredChildren. */
  function childRecords() {
    const live = [...children.values()].map(({ record }) => record);
    const done = [...retiredChildren.values()]
      .filter(({ record }) => !children.has(record.agentId))
      .map(({ record }) => record);
    return [...live, ...done];
  }

  /** One child by id, live or finished. */
  function lookupChild(childId) {
    return children.get(childId)?.record ?? retiredChildren.get(childId)?.record ?? null;
  }

  function propagateToChildren(state, parentAgentId) {
    for (const [childId, { record }] of children) {
      if (record.parentAgentId !== parentAgentId) continue;
      const changed = record.applyParentScope(state, { source: "parent-propagation" });
      if (changed) {
        ctx.logger.info("[dsh-ldvh] propagated parent governance state %s to child %s (count: %d)",
          state ?? "none", childId, record.propagationCount);
      }
    }
  }

  /**
   * 重新 prime 一个已装 agent 的 pre-step 通道，并刷新它的 session→scope 记录。
   *
   * DSH 0.1.7 起 resume / clear / compact 会以对应 source 重新 announce
   * `agent/created`；install() 对已装 agent 直接去重返回，于是这条路径补上旧实现
   * 由 `agent/session-start` 承担的语义（该事件已删除，语义并入 payload.source——
   * 调研报告 §3.4）。顺带把父级最新判定传播给已记录的子代理：父级可能在子代理
   * 安装之后才完成判定，child 侧的 session-start 安全网同样已随事件消失。
   *
   * @param {string} agentId - 已装 agent 的 id。
   * @param {object} agent - 该 agent（用于读取 cwd 重新判定）。
   */
  function reprimeAgent(agentId, agent) {
    const lifecycle = agents.get(agentId);
    if (lifecycle === undefined) return;
    // prime：让下一次 step-1 重新评估（mnemon primePending shape）。
    lifecycle.preStep.primePending = true;
    lifecycle.activity.record("session/reprime", { source: "agent-created" });
    void resolve(agent?.session?.header?.cwd).then((scope) => {
      if (!agents.has(agentId)) return; // disposed while judging
      const sessionId = sessionIdOf(agent);
      if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
      lifecycle.setScope(scope);
      propagateToChildren(scope?.state ?? null, agentId);
    }).catch((error) => {
      ctx.logger.warn("[dsh-ldvh] re-prime judgement failed for %s: %s", agentId, String(error?.message ?? error));
    });
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

    const lifecycle = new AgentLifecycle(agent);
    agents.set(agentId, lifecycle);

    agent.ctx.effect(() => {
      // Tools at install time (audit A/C): the initial async judgement
      // registers the batch BEFORE the first assemble collects tools, so the
      // first model request already sees them on governed sessions.
      void resolve(agent?.session?.header?.cwd).then((scope) => {
        if (!agents.has(agentId)) return; // disposed while judging (audit F)
        const sessionId = sessionIdOf(agent);
        if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
        // Keep the full resolved scope for the first-turn visible-notice
        // fallback (pre-step runs before the first assemble; see below).
        lifecycle.lastScope = scope;
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
          // Publish the notice text for the pre-step visible-row injector:
          // the full judgment card, prefixed by the migration line when the
          // state changed (guidance.js owns the shape).
          lifecycle.noticeText = scope.noticeText ?? null;
          lifecycle.lastScope = scope;
        }
      });
      const onPreStep = createPreStepHandler(agent, {
        isGoverned: () => lifecycle.scopeState === "governed",
        channel: lifecycle.preStep,
        // Visible judgment row (Human 2026-09-04 "这里要能看到啊"): the
        // assemble handler updates noticeText on every judgement; the
        // pre-step injects it as a DSH-native context-injection row whenever
        // it differs from the last injected one.
        // First-turn fallback: the pre-step (prepend) runs BEFORE the first
        // assemble, so lifecycle.noticeText is still null on turn 1 — but the
        // install-time judgement already stored the full scope. Build the
        // complete card from it so the very first turn gets its visible row.
        noticeText: () => lifecycle.noticeText ?? (lifecycle.lastScope !== undefined && lifecycle.lastScope !== null ? noticeTextFor(lifecycle.lastScope) : null),
        // Inline row title (Human 2026-09-04): "上下文注入 · dsh-ldvh · 本会话受 LDVH 管辖"
        noticeSummary: () => noticeSummaryFor(lifecycle.scopeState)
      });
      // Turn-level triggers (turn-stopping reflection seam + turn/end
      // bookkeeping seam): mounted now, content empty (Human strategy
      // 2026-09-03: 先占位后填内容).
      const turnTriggers = createTurnTriggers(agent, {
        getScopeState: () => lifecycle.scopeState,
        turns: lifecycle.turns,
        activity: lifecycle.activity,
        log: ctx.logger
      });
      // Prime the pre-step channel at install：install 本身发生在 agent/created
      // （= session 的 startup 语义），这一次 prime 取代旧实现里对
      // agent/session-start 的首次响应。resume / clear / compact 的再次 announce
      // 由 start() 的 agent/created 分发路径 re-prime（见 reprimeAgent）。
      onPreStep.prime();
      const stops = [
        agent.ctx.on("system-prompt/assemble", (assembly, context, next) => onAssemble(assembly, context, next)),
        agent.ctx.on("agent/pre-step", (payload, next) => onPreStep.handler(payload, next), { prepend: true }),
        agent.ctx.on("agent/turn-stopping", (payload) => turnTriggers.onTurnStopping(payload)),
        agent.ctx.on("session/event", (session, event) => turnTriggers.onSessionEvent(session, event))
      ];

      return () => {
        for (const stop of stops.reverse()) {
          try { stop(); } catch { /* already removed */ }
        }
        if (lifecycle.toolsDisposer !== null) {
          try { lifecycle.toolsDisposer(); } catch { /* already removed */ }
          lifecycle.toolsDisposer = null;
        }
        const sessionId = sessionIdOf(agent);
        if (typeof sessionId === "string") sessionScopes.delete(sessionId);
        agents.delete(agentId);
      };
    }, `dsh-ldvh: agent lifecycle ${agentId}`);
  }

  return {
    start() {
      // agent/created 是 0.1.7 起唯一携带 session-start 语义的入口：
      // payload = { agent, source, signal? }，source ∈ startup|resume|clear|compact
      //（旧事件 agent/session-start 已删除——调研报告 §3.4）。分发规则：
      //   - 未装 → install()（内部含首次 prime）；
      //   - 已装 → 这是 resume / clear / compact 的再次 announce，install() 的
      //     agents.has() 去重会直接返回，因此在这里补做 re-prime。
      const disposeCreated = ctx.on("agent/created", (payload) => {
        const agent = payload?.agent;
        const id = agentIdOf(agent);
        if (typeof id === "string" && agents.has(id)) reprimeAgent(id, agent);
        else install(agent);
      });
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
        retiredChildren.clear();
        for (const agentId of [...agents.keys()]) agents.delete(agentId);
      };
    },
    /** Test/introspection seam. */
    installedAgentIds() {
      return [...agents.keys()];
    },
    /** Per-agent lifecycle snapshots for diagnostics/Web (mnemon parity). */
    snapshots() {
      return [...agents.values()].map((lifecycle) => lifecycle.snapshot());
    },
    snapshotOf(agentId) {
      return agents.get(agentId)?.snapshot();
    },
    /**
     * Delegated child snapshots (2026-09-04). Previously the Web/RPC surface
     * only saw roots, which made the delegation chain invisible at exactly the
     * same time the rules asked for it to be visible. Children are returned
     * with the same consumer shape as roots where the fields overlap.
     */
    childSnapshots() {
      return childRecords().map((record) => record.snapshot());
    },
    /** Full activity trail for one child (entries, not just the count). */
    childActivityOf(childId) {
      return lookupChild(childId)?.activitySnapshot() ?? null;
    },
    /** The child's captured final text, or null when not yet concluded. */
    childConclusionOf(childId) {
      return lookupChild(childId)?.conclusion ?? null;
    }
  };
}
