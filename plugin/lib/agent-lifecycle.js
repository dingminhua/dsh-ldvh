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
    // Turn-trigger markers (reflection/bookkeeping seams).
    this.turns = { turnStoppingSeen: 0, turnEndSeen: 0, lastTurn: undefined, lastReflectionGate: undefined };
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
