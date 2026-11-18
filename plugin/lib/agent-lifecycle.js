
import { createHash } from "node:crypto";

export class ActivityLog {
  constructor(limit = 200) {
    this.limit = limit;
    this.entries = [];
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

    this.scopeState = null;
    this.scopeDetail = null;
    this.toolsDisposer = null;
    this.preStep = { primePending: false, lastDigest: null };
    this.turns = {
      turnStoppingSeen: 0,
      turnEndSeen: 0,
      lastTurn: undefined,
      lastReflectionGate: undefined,
      lastIdleSeen: 0
    };
    this.activity = new ActivityLog();
    this.lastGoodEnumeration = null;
  }

  setScope(scope) {
    this.scopeState = scope?.state ?? null;
    this.scopeDetail = scope?.detail ?? null;
    this.activity.record("governance/judged", { state: this.scopeState });
  }

  static digestOf(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }

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

export class DelegatedChildRecord {
  constructor(agent, parentAgentId) {
    this.agentId = agent?.id ?? agent?.session?.header?.id ?? null;
    this.sessionId = agent?.session?.header?.id ?? null;
    this.parentAgentId = parentAgentId ?? null;
    this.startedAt = new Date().toISOString();
    this.scopeState = null;
    this.activity = new ActivityLog();
    this.conclusion = null;
    this.conclusionAt = null;
    this.parentScopeState = null;
    this.lastPropagatedAt = null;
    this.propagationCount = 0;
  }

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

  setConclusion(text) {
    this.conclusion = typeof text === "string" ? text : null;
    this.conclusionAt = new Date().toISOString();
    this.activity.record("child/conclusion", {
      length: this.conclusion === null ? 0 : this.conclusion.length
    });
  }

  snapshot() {
    return {
      agentId: this.agentId,
      sessionId: this.sessionId,
      parentAgentId: this.parentAgentId,
      startedAt: this.startedAt,
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

  activitySnapshot() {
    return this.activity.snapshot();
  }
}
