// dsh-ldvh — guidance surface: per-agent system-prompt/assemble injection and
// the agent/pre-step channel skeleton.
//
// Authority: specs/08 §5.3 (guidance surface), specs/01 §10.4 (seven-anchor
// minimal guidance content), framework doc §4 (startup six-point plan).
//
// Two channels, both per-agent (installed from lifecycle.js):
//
//   1. system-prompt/assemble waterfall — the ONLY guidance injection point
//      (the former global systemPrompt.section was removed by Human decision
//      2026-09-03: assemble is only ever called from preStep with
//      context.agent always present, so one injection path suffices and two
//      would drift). The handler awaits the governance judgement, asks the
//      tools guard to reconcile registration on state transitions, then
//      splices the guidance section into the assembled sections for the
//      CURRENT assembly — first-turn-correct by construction (audit B:
//      sections materialize before the waterfall and renderPrompt consumes
//      the transformed array).
//
//   2. agent/pre-step — channel SKELETON only (batch 1): mounted, gated,
//      audited, and passing through. Real fact-candidate injection belongs
//      to a later batch and requires a specs/03 §8 amendment (Human Gate).
//      The skeleton exists so the mount point, prepend semantics, step-1
//      gate, reject/abort pass-through and ownRequest stub are all in place
//      and tested before content ever flows.

import { GUIDANCE_SECTION_NAME, guidanceTextFor } from "./guidance-text.js";

/**
 * Build the assemble-waterfall handler for ONE agent. `resolve(cwd)` must be
 * the real, uncached judgement (governance-gate discipline); `syncTools` is
 * the lifecycle-owned idempotent tools guard; `recordScope` mirrors the
 * resolved scope into the session-scopes table for /ldvh/state.
 */
export function createAssembleHandler(agent, { resolve, syncTools, recordScope }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  return async function onAssemble(assembly, context, next) {
    // Defensive guard (review suggestion): a future DSH may add non-agent
    // assembly paths; never inject without an agent identity.
    if (context?.agent === undefined || context.agent.id !== agentId) return next();
    // Aborted turns: skip the judgement read entirely and pass through.
    if (context.signal?.aborted === true) return next();

    const cwd = agent?.session?.header?.cwd;
    let scope;
    try {
      scope = await resolve(cwd);
    } catch (error) {
      // Never reject the waterfall: judgement failure degrades to
      // unavailable (fail-closed), assembly continues with the fail-closed
      // section instead of aborting the whole turn.
      scope = { state: "unavailable", detail: String(error?.message ?? error) };
    }
    recordScope(scope);
    syncTools(scope);

    const text = guidanceTextFor(scope.state);
    const assembled = await next();
    // Splice on the RESULT of next() (audit A/B): other listeners further
    // down the chain may already have returned a fresh object; only the
    // returned assembly is authoritative. Replace our section when present,
    // push when absent, and when the text is "" (not_governed) REMOVE any
    // stale copy so a governed->not_governed transition leaves zero trace.
    const sections = assembled.sections.filter((section) => section.name !== GUIDANCE_SECTION_NAME);
    if (text !== "") sections.push({ name: GUIDANCE_SECTION_NAME, text });
    return { ...assembled, sections };
  };
}

/**
 * Pre-step channel (batch-1 skeleton + batch-3-ready mechanics).
 *
 * Mount/discipline (audit A/E): prepend makes this the outermost participant
 * so it observes the fully assembled batch; pass through on reject / aborted
 * signal / step !== 1. The mechanics mirror mnemon's proven injection layer
 * (lifecycle.ts preStep), adapted to LDVH's no-content-yet stage:
 *
 *   - primePending: set on agent/session-start (any source), consumed on the
 *     next step-1 — guarantees the first turn of every session is evaluated.
 *   - ownRequest: a REAL check now (a message whose source is this plugin
 *     suppresses re-injection this turn) — needed the moment content flows.
 *   - digest state: a per-agent slot records the last injected digest; the
 *     batch-3 content renderer will compare before re-injecting.
 *   - surface visibility seam: cueVisible() checks whether a previously
 *     injected plugin message is still in the model's view (rewind-safe,
 *     mnemon cueAlreadyVisible shape); used by batch 3, stubbed true now.
 *
 * NO message is appended in this batch: fact-candidate injection requires
 * the specs/03 §8.2 "resident F1 enumeration" amendment (Human Gate).
 */
const LDVH_PLUGIN_SOURCE = "dsh-ldvh";

function isOwnMessage(message) {
  const source = message?.source;
  return source?.kind === "plugin" && source?.plugin === LDVH_PLUGIN_SOURCE;
}

export function createPreStepHandler(agent, { isGoverned, channel } = {}) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  // Channel state lives on the AgentLifecycle object (single per-agent
  // home); fall back to a local state for direct/test usage without one.
  const state = channel ?? { primePending: false, lastDigest: null };
  const cueVisible = () => true; // batch-3 seam: real surface scan lands with content
  return {
    /** session-start hook: prime the channel (mnemon primePending shape). */
    prime() { state.primePending = true; },
    async handler(payload, next) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return next();
      const decision = await next();
      if (decision.kind === "reject" || payload.signal?.aborted === true) return decision;
      if (payload.step !== 1) return decision;
      // Channel evaluation only — no injection this batch. The gates below
      // are the exact seams batch 3 will fill (governance, ownRequest,
      // prime consumption, digest, visibility); exercising them now keeps
      // the channel honest and covered by tests.
      const governed = isGoverned();
      const ownRequest = decision.messages.some(isOwnMessage);
      const primed = state.primePending;
      state.primePending = false;
      void (governed && !ownRequest && (primed || cueVisible()) && state.lastDigest);
      return decision;
    }
  };
}
