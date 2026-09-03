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

import { GUIDANCE_SECTION_NAME, guidanceTextFor, judgmentLineFor, migrationLineFor, noticeTextFor, noticeSummaryFor } from "./guidance-text.js";

/**
 * Build the assemble-waterfall handler for ONE agent. `resolve(cwd)` must be
 * the real, uncached judgement (governance-gate discipline); `syncTools` is
 * the lifecycle-owned idempotent tools guard; `recordScope` mirrors the
 * resolved scope into the session-scopes table for /ldvh/state.
 *
 * State-change notice (Human 2026-09-04, the "已切换到" event pattern): when
 * the judgment differs from the previous assemble's judgment, a migration
 * line is prepended so the AI knows its earlier context may be stale. The
 * first judgement of a session emits no migration line (nothing to migrate
 * from); it just carries the judgment line.
 */
export function createAssembleHandler(agent, { resolve, syncTools, recordScope }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  let lastState = null;
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
    // Compute the notice BEFORE recordScope/syncTools: recordScope copies
    // scope.noticeText onto the AgentLifecycle, so it must already be set
    // when the callback reads it (order bug found by live reproduction —
    // the copy always read null because the assignment came after).
    let text = guidanceTextFor(scope.state);
    let noticeText = noticeTextFor(scope);
    if (lastState !== null && lastState !== scope.state) {
      const migrationLine = migrationLineFor(lastState, scope.state);
      text = `${migrationLine}\n${text}`;
      noticeText = `${migrationLine}\n${noticeText}`;
    }
    if (lastState === null) lastState = scope.state;
    else if (lastState !== scope.state) lastState = scope.state;
    // Publish the notice for the pre-step visible-row injector (lifecycle.js
    // recordScope copies it onto the AgentLifecycle). One string, two
    // audiences: the model reads it as the injected message text, the Human
    // sees it as a "上下文注入 · dsh-ldvh" row in the conversation flow.
    scope.noticeText = noticeText;

    recordScope(scope);
    syncTools(scope);

    const assembled = await next();
    // Splice on the RESULT of next() (audit A/B): other listeners further
    // down the chain may already have returned a fresh object; only the
    // returned assembly is authoritative. Replace our section when present,
    // push when absent. Since every state now carries text (including
    // not_governed, Human 2026-09-04), the stale-section filter below is the
    // single replace path — a governed->not_governed transition now REPLACES
    // the guidance instead of removing it.
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

/**
 * Create one DSH-native context-injection message (Human 2026-09-04: "这里要
 * 能看到啊" — the judgment must be VISIBLE in the conversation flow, exactly
 * like dsh-mnemon's "上下文注入 · dsh-mnemon" row).
 *
 * Mechanism (source-verified): a user/message whose source is
 * { kind: "plugin", plugin, form, summary } renders in the chat flow as a
 * "上下文注入 · <plugin> · <summary>" disclosure row (dsh-client-ui-chat
 * ContextInjectionRow, contextProvenance case "plugin"). mnemon uses the
 * same shape from its pre-step (createPluginMessage, lib/index.js 8046).
 *
 * `text` is what the MODEL sees (the full notice); `summary` is what the
 * HUMAN sees collapsed next to the row label.
 */
function createPluginMessage(text, summary) {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: {
      kind: "plugin",
      plugin: LDVH_PLUGIN_SOURCE,
      // form "notice" (not "instructions"): the ONLY form whose summary
      // renders inline on the collapsed row (dsh-client-ui-chat contextBody
      // case "notice" -> noticeSummary -> data-context-summary). This is
      // what makes the row read "上下文注入 · dsh-ldvh · 本会话受 LDVH 管辖"
      // without expanding (Human 2026-09-04 external-title requirement).
      form: "notice",
      summary
    }
  };
}

export function createPreStepHandler(agent, { isGoverned, channel, noticeText, noticeSummary } = {}) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  // Channel state lives on the AgentLifecycle object (single per-agent
  // home); fall back to a local state for direct/test usage without one.
  const state = channel ?? { primePending: false, lastDigest: null };
  // noticeText(): the current judgment notice (set by lifecycle.js from the
  // assemble handler's recordScope). Injected as a visible row when it
  // differs from the last injected digest.
  const getNoticeText = typeof noticeText === "function" ? noticeText : () => null;
  return {
    /** session-start hook: prime the channel (mnemon primePending shape). */
    prime() { state.primePending = true; },
    /**
     * Judgment notice injection (2026-09-04): at the first step of every
     * turn where the judgment changed (or the session was just primed), one
     * visible context-injection row carries the judgment to BOTH audiences:
     * the model (message text) and the Human (conversation-flow row).
     *
     * Gates (all inherited from the batch-1 skeleton, now doing real work):
     *   - ownRequest: a turn already carrying our message is left alone
     *     (rewind/replay safe — replays see their own injected row);
     *   - digest: only inject when the notice text differs from the last
     *     injected one (steady state = quiet, changes/migrations = one row);
     *   - the system-prompt section (assemble) keeps carrying the judgment
     *     every turn — the row is the visible event, the section is the
     *     standing state.
     */
    async handler(payload, next) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return next();
      const decision = await next();
      if (decision.kind === "reject" || payload.signal?.aborted === true) return decision;
      if (payload.step !== 1) return decision;
      const currentNotice = getNoticeText();
      state.primePending = false;
      if (currentNotice === null || currentNotice === "") return decision;
      // Loss detection (re-review finding, 2026-09-04): the digest gate alone
      // meant a rewind to before our row, or a cleared conversation, silently
      // lost the visible notice forever (lastDigest still matched, no
      // re-injection). The real cue-visibility check: a row is "visible" only
      // when it is still in THIS turn's message batch. If it is gone, treat
      // the notice as changed and re-inject — the rewind/clear edge cases
      // recover automatically (mnemon cueAlreadyVisible shape).
      const ownMessage = decision.messages.find(isOwnMessage);
      const changed = currentNotice !== state.lastDigest;
      if (ownMessage === undefined || changed) {
        // Row absent (first turn, rewind, or cleared conversation) or the
        // notice changed: inject one fresh row. This is the loss-recovery
        // path the digest gate alone could not cover (re-review finding).
        state.lastDigest = currentNotice;
        return {
          kind: "enter",
          messages: [...decision.messages, createPluginMessage(currentNotice, (typeof noticeSummary === "function" ? noticeSummary() : noticeSummary) ?? "LDVH 管辖判定")]
        };
      }
      // Row present and notice unchanged: refresh the text in place so a
      // stale row never lingers after the judgment moved on between turns.
      ownMessage.content = [{ type: "text", text: currentNotice }];
      return decision;
    }
  };
}
