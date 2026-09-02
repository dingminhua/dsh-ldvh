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
 * Batch-1 pre-step channel skeleton (audit A/E): prepend makes this the
 * outermost participant so it observes the fully assembled batch; pass
 * through on reject / aborted signal / step !== 1. No message is ever
 * appended in this batch. `ownRequestStub` is a placeholder returning false
 * so the future real injection point has a named seam (review suggestion:
 * do not pre-build judgement logic here).
 */
export function createPreStepHandler(agent, { isGoverned }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  const ownRequestStub = () => false;
  return async function onPreStep(payload, next) {
    if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return next();
    const decision = await next();
    if (decision.kind === "reject" || payload.signal?.aborted === true) return decision;
    if (payload.step !== 1) return decision;
    // Skeleton only: governance gate evaluated (keeps the channel honest and
    // covered by tests), ownRequest seam reserved, no injection this batch.
    void isGoverned();
    void ownRequestStub;
    return decision;
  };
}
