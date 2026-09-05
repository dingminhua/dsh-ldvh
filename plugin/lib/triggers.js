// dsh-ldvh — lifecycle trigger registry: every hook point LDVH will ever
// act on, mounted once per agent, governed-gated, content left empty.
//
// Strategy (Human 2026-09-03): "先把位置占了，内容留空" — mount ALL trigger
// points now so the lifecycle skeleton is complete; each point carries its
// own gate and a named content seam, and future batches only fill content
// into seams without touching the mount wiring again.
//
// Trigger inventory (DSH host events, audit-verified existence):
//   agent/created            install (lifecycle.js)                     [ACTIVE]
//   system-prompt/assemble   guidance injection + tools guard           [ACTIVE]
//   agent/pre-step           resident-enumeration channel               [SKELETON: gates live, no content]
//   agent/session-start      priming + session-scope record             [ACTIVE]
//   agent/turn-stopping      reflection seam (memory-system reflection sub-mechanism)                 [SKELETON]
//   session/event turn/end   turn-close bookkeeping (release, settle)   [SKELETON]
//   agent/disposed           (fiber-owned cleanup — no hook needed)     [implicit]
//
// Skeleton points evaluate their gate (governance state) and record
// observability markers, but deliberately DO NO work: the content of
// reflection, sedimentation proposals, and turn-close processing belongs
// to their own batches and (where writes are involved) Human intent +
// 03 §9 controlled-write pipelines.

import { resolveGovernanceScope } from "./governance-scope.js";

/** turn number from a session/event payload, mnemon eventTurn shape. */
function eventTurn(event) {
  const turn = event?.data?.turn;
  return typeof turn === "number" ? turn : undefined;
}

/**
 * Create the turn-level trigger set for one agent.
 * `getScopeState()` reads the lifecycle's current judged state; `turns` is
 * the marker object owned by the AgentLifecycle (single per-agent home —
 * falls back to a local one for direct/test usage); `activity` optionally
 * receives hook-action entries. `log` is the host logger.
 */
export function createTurnTriggers(agent, { getScopeState, turns, activity, log }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  const state = turns ?? {
    turnStoppingSeen: 0,
    turnEndSeen: 0,
    lastTurn: undefined,
    lastReflectionGate: undefined
  };

  function governed() {
    return getScopeState() === "governed";
  }

  return {
    /** agent/turn-stopping — 反思维 seam. Skeleton: gate + marker only. */
    onTurnStopping(payload) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return;
      state.turnStoppingSeen += 1;
      state.lastTurn = payload?.turn;
      // Content seam (future batch): reflection candidate recognition
      // ("user corrected the AI", "same pitfall reappeared", "reusable
      // decision made") → sedimentation PROPOSAL (never an automatic
      // write). Skeleton only records that the point fired and whether the
      // gate was open.
      state.lastReflectionGate = governed() ? "open" : "closed";
      activity?.record("turn/stopping", { turn: state.lastTurn, gate: state.lastReflectionGate });
    },

    /** session/event — turn/end bookkeeping seam. Skeleton: marker only. */
    onSessionEvent(session, event) {
      if (session !== agent?.session || event?.type !== "turn/end") return;
      state.turnEndSeen += 1;
      state.lastTurn = eventTurn(event) ?? state.lastTurn;
      activity?.record("turn/end", { turn: state.lastTurn });
      // Content seam (future batch): turn-close settlement — release any
      // pinned per-turn state, reconcile enumeration digests, schedule
      // deferred reflection (mnemon idleReview timing shape, LDVH
      // proposal-only semantics).
    },

    /** Test/diagnostic seam. */
    snapshot() {
      return { ...state };
    }
  };
}

/** Resolve helper re-exported for trigger content seams (uncached, 07 §5.3). */
export { resolveGovernanceScope };
