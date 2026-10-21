// dsh-ldvh — per-agent lifecycle object (mnemon MnemonAgentLifecycle shape).
//
// Until now an agent's runtime state was scattered across three closures
// (lifecycle record, guidance pre-step state, triggers counters). This object
// is the single home: one AgentLifecycle per agent, owning all turn-scoped
// and session-scoped state, and answering snapshot() for diagnostics/Web.
//
// Contents today (all real): tools registration state, judged scope state,
// pre-step channel state (prime/digest), turn-trigger markers, and the
// activity log (item 2 of the mnemon-parity build-out). The object does NOT
// do work itself — handlers in guidance.js/triggers.js write into it.

import { createHash } from "node:crypto";

/**
 * Turn activity projection (activity.ts parity, content minimal): every LDVH
 * hook action appends one entry, so a later Web view / diagnostic can answer
 * "what did LDVH do in this turn/session" without reading logs.
 */
export class ActivityLog {
  constructor(limit = 200) {
    this.limit = limit;
    this.entries = []; // { at, hook, detail }
  }
  record(hook, detail = {}) {
    this.entries.push({ at: new Date().toISOString(), hook, detail });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }
  snapshot() {
    return [...this.entries];
  }
}

export class AgentLifecycle {
  constructor(agent) {
    this.agentId = agent?.id ?? agent?.session?.header?.id ?? null;
    this.sessionId = agent?.session?.header?.id ?? null;
    this.cwd = agent?.session?.header?.cwd ?? null;
    this.startedAt = new Date().toISOString();

    // Judged governance state (null = not yet judged this install).
    this.scopeState = null;
    this.scopeDetail = null;
    // Tools registration (disposer owned here; lifecycle.js calls guard).
    this.toolsDisposer = null;
    // Pre-step channel state (prime/digest — content seams for batch 3).
    this.preStep = { primePending: false, lastDigest: null };
    // Turn-trigger markers (session-checkpoint / idle-confirmation seams).
    // `checkpointPending` 是 11 §6.1 两步触发的第一步标记（检查点已到达），
    // 由 agent/status 的 idle 迁移消费。
    //
    // 曾有一个 `auxRotation` 计数器（32 §10.2 三任务预算轮换）。Human 于
    // 2026-10-11 删除轮换概念（一次派发做全部已启用的事），该计数器随之删除——
    // **没有相位，就没有相位死锁**。
    this.turns = {
      turnStoppingSeen: 0,
      turnEndSeen: 0,
      lastTurn: undefined,
      lastReflectionGate: undefined,
      checkpointPending: false,
      lastIdleSeen: 0,
      lastCheckpointDispatch: undefined,
      // 11 §7.1 执行体的取消信号（每次检查点派生时替换，旧的先 abort——避免
      // 多轮检查点的派生堆积）。会话销毁时由 dispose 路径收口。
      discoveryAbort: undefined
    };
    // Activity projection (every hook action).
    this.activity = new ActivityLog();
    // Last-good rendered enumeration (item 5: render degrade seam).
    this.lastGoodEnumeration = null;
  }

  /** Record a judgement outcome uniformly. */
  setScope(scope) {
    this.scopeState = scope?.state ?? null;
    this.scopeDetail = scope?.detail ?? null;
    this.activity.record("governance/judged", { state: this.scopeState });
  }

  /** Digest helper for future content renderers (deterministic, no cache). */
  static digestOf(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }

  /** Diagnostic/Web snapshot (mnemon lifecycle.snapshot() parity). */
  snapshot() {
    return {
      agentId: this.agentId,
      sessionId: this.sessionId,
      cwd: this.cwd,
      startedAt: this.startedAt,
      scopeState: this.scopeState,
      scopeDetail: this.scopeDetail,
      toolsRegistered: this.toolsDisposer !== null,
      preStep: { ...this.preStep },
      turns: { ...this.turns },
      activityCount: this.activity.entries.length,
      hasEnumeration: this.lastGoodEnumeration !== null
    };
  }
}

/**
 * Delegated subagent record (child.js mechanism).
 *
 * Children stay lighter than roots by design (child.js head note): they get
 * NO tools, NO sessionScopes publication and NO pre-step channel. But the
 * earlier record was a bare `{ scopeState }`, which made the delegation chain
 * invisible — no activity trail, no conclusion, and no way for a parent state
 * change to reach an already-installed child.
 *
 * This object adds exactly the three things the delegation chain needs, and
 * nothing more: an ActivityLog (same shape as roots, so the same consumers
 * can read it), a conclusion slot captured at turn end, and an explicit
 * parent-state propagation entry point. It is deliberately NOT an
 * AgentLifecycle — children must not grow root privileges by accident.
 */
export class DelegatedChildRecord {
  constructor(agent, parentAgentId) {
    this.agentId = agent?.id ?? agent?.session?.header?.id ?? null;
    this.sessionId = agent?.session?.header?.id ?? null;
    this.parentAgentId = parentAgentId ?? null;
    this.startedAt = new Date().toISOString();
    // Delegated governance state (null = parent not yet judged).
    this.scopeState = null;
    // Activity trail (same class as roots: uniform consumer shape).
    this.activity = new ActivityLog();
    // Conclusion slot: the child's final assistant text, captured at turn end.
    // null until a turn actually ends with text; empty string means "ended
    // with no text", which is a real outcome, not an absence.
    this.conclusion = null;
    this.conclusionAt = null;
    // Parent-state propagation bookkeeping (R2e): which parent judgement we
    // have already applied, so propagation is idempotent and traceable.
    this.parentScopeState = null;
    this.lastPropagatedAt = null;
    this.propagationCount = 0;
  }

  /** Apply a delegated or propagated parent judgement (idempotent). */
  applyParentScope(state, { source } = {}) {
    const next = state ?? null;
    if (next === this.parentScopeState) return false;
    const previous = this.parentScopeState;
    this.parentScopeState = next;
    this.scopeState = next;
    this.propagationCount += 1;
    this.lastPropagatedAt = new Date().toISOString();
    this.activity.record("governance/delegated", {
      state: next,
      previous: previous,
      source: source ?? "unknown",
      count: this.propagationCount
    });
    return true;
  }

  /** Capture the child's final assistant text (turn-end seam). */
  setConclusion(text) {
    this.conclusion = typeof text === "string" ? text : null;
    this.conclusionAt = new Date().toISOString();
    this.activity.record("child/conclusion", {
      length: this.conclusion === null ? 0 : this.conclusion.length
    });
  }

  /** Diagnostic/Web snapshot — same consumer shape as roots where possible. */
  snapshot() {
    return {
      agentId: this.agentId,
      sessionId: this.sessionId,
      parentAgentId: this.parentAgentId,
      startedAt: this.startedAt,
      // Delegated children never register tools or publish sessionScopes;
      // these stay constant so consumers can rely on the shape.
      toolsRegistered: false,
      scopeState: this.scopeState,
      parentScopeState: this.parentScopeState,
      propagationCount: this.propagationCount,
      lastPropagatedAt: this.lastPropagatedAt,
      hasConclusion: this.conclusion !== null,
      conclusionLength: this.conclusion === null ? 0 : this.conclusion.length,
      activityCount: this.activity.entries.length
    };
  }

  /** Full activity trail (entries, not just the count). */
  activitySnapshot() {
    return this.activity.snapshot();
  }
}
