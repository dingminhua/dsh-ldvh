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

import { GUIDANCE_SECTION_NAME, guidanceTextFor, migrationLineFor, noticeTextFor } from "./guidance-text.js";

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
  // 0.1.7 起本插件写入端用自有 producer kind（"dsh-ldvh"）；旧会话里可能还残留
  // 已退役的 "plugin" 包装（v4 迁移准入拒绝它），读取端两种都认，保证对历史
  // 行的判断不因写入端改名而失效。
  return source?.plugin === LDVH_PLUGIN_SOURCE
    && (source?.kind === LDVH_PLUGIN_SOURCE || source?.kind === "plugin");
}

/**
 * 会话内已注入行的可见性台账（friction-41a43496）。
 *
 * **为什么不能只看 `decision.messages`**：该数组是**本回合装配出来的批次**，
 * 不是会话的完整历史。上一回合 step-1 注入的行不会出现在下一回合的批次里，
 * 于是「行不在批次中」被误判成「行已丢失（rewind/清空）」→ 走 loss-recovery
 * 路径再注入一条。实测后果：同一管辖判定块在相邻轮次被重复注入。
 *
 * 判据因此分层，两种情形都要兼顾：
 *   - **仍在视图**：本批次里能直接看到 → 刷新文本即可，不新增行；
 *   - **落在历史里**：本回合批次看不到，但**上一回合的批次**里见过它
 *     （`seen` 记录的是「该 id 曾在某次装配结果中出现过」，而装配结果会进入
 *     模型可见的上下文）→ 也不新增行；
 *   - **真的丢了**：rewind 到注入点之前、或会话被清空 → 既不在本批次、也没在
 *     上一回合批次里见过 → 才走 loss-recovery 重新注入。
 *
 * 这个台账替代了原先「stub 成 true」的 cueVisible() 预留位：预留位之所以一直
 * 没接上，正是因为当时无法从批次单点判断「跨回合可见」，只能靠跨回合记账补齐。
 */
function noteOwnMessages(state, messages) {
  if (state.injectedIds === undefined) state.injectedIds = new Set();
  for (const message of messages) {
    if (isOwnMessage(message)) state.injectedIds.add(message.id);
  }
}

/**
 * Create one DSH-native context-injection message (Human 2026-09-04: "这里要
 * 能看到啊" — the judgment must be VISIBLE in the conversation flow, exactly
 * like dsh-mnemon's "上下文注入 · dsh-mnemon" row).
 *
 * Mechanism: a user/message whose source carries a producer `kind` plus a
 * context `form`/`summary` renders in the chat flow as a "上下文注入 · …"
 * disclosure row. mnemon uses the same shape from its pre-step.
 *
 * **DSH 0.1.7 变更（必须遵守）**：共享的 `kind: "plugin"` 是「已退役的插件包装」——
 * v3→v4 迁移的原生 source 准入**显式拒绝这个字面量**
 * （`session-format-v3-to-v4/src/message-sources.ts`：`value['kind'] === 'plugin'`
 * → `SessionFormatError: format v4 message requires a producer-owned source kind`），
 * 因为它把归属从生产者名下收进了一个共享 catch-all。新契约要求**每个生产者声明
 * 自己的 kind**，未知 kind 的归属被原样保留、由消费者兜底。故这里用本插件自己的
 * producer kind。
 *
 * 代价（如实记录）：0.1.7 的 ui-chat 已删除 `case "plugin"`，自定义 kind 会落进
 * 未知来源的兜底渲染——行的可见性保住，但「上下文注入 · dsh-ldvh · <summary>」这类
 * 专属标签需要随渲染侧契约再对齐。这与"整个 turn 报错"是关键区别。
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
      // 本插件的 producer kind —— 不是共享的 "plugin"（0.1.7 起被迁移准入拒绝）。
      kind: LDVH_PLUGIN_SOURCE,
      plugin: LDVH_PLUGIN_SOURCE,
      // form "notice" (not "instructions"): the form whose summary renders
      // inline on a collapsed context row (contextBody case "notice" ->
      // noticeSummary -> data-context-summary).
      form: "notice",
      summary
    }
  };
}

export function createPreStepHandler(agent, { isGoverned, channel, noticeText, noticeSummary, onTurnStart } = {}) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  // Channel state lives on the AgentLifecycle object (single per-agent
  // home); fall back to a local state for direct/test usage without one.
  const state = channel ?? { primePending: false, lastDigest: null };
  // noticeText(): the current judgment notice (set by lifecycle.js from the
  // assemble handler's recordScope). Injected as a visible row when it
  // differs from the last injected digest.
  const getNoticeText = typeof noticeText === "function" ? noticeText : () => null;
  // onTurnStart(): **环境性**检查，每回合第一次 step 跑一次、受管辖时（21 §14
  // 「以及该会话续接本对象」）。它不产出任何上下文行，也不得影响本回合的进行：
  // 抛错只记日志——「会话继续干活」不该被环境检查拦住。
  const runOnTurnStart = typeof onTurnStart === "function" ? onTurnStart : null;
  return {
    /** session-start hook: prime the channel (mnemon primePending shape). */
    prime() { state.primePending = true; },
    /**
     * 会话视图被重置时清空注入台账（friction-41a43496 的 rewind 恢复路径）。
     *
     * 台账记的是「某行曾在某次装配结果中出现过」，而装配结果进入模型可见上下文；
     * 一旦会话被 **clear / compact**（或 resume 到一个更早的点），那些行就从视图里
     * 消失了，指针继续有效就会永久静默——这正是原 rewind 恢复要防的情形。
     *
     * 权威信号是 `agent/created` 的 `payload.source ∈ startup|resume|clear|compact`
     * （0.1.7 起携带 session-start 语义的唯一入口，见 lifecycle.js）。**不用**
     * 「本回合批次里没看见行」推断 rewind：批次永远看不到历史行，那样推断会把
     * 每一次正常轮次都当成 rewind，就是本摩擦的成因。
     */
    resetVisibility() {
      state.injectedIds = new Set();
      state.lastDigest = null;
    },
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
      // 环境性检查（每回合一次，先于通知行——它与可见行无关，也不依赖判定文本）。
      if (runOnTurnStart !== null && isGoverned?.() === true) {
        try {
          await runOnTurnStart();
        } catch (error) {
          // 不让它拦住回合；如实记日志而不是静默吞掉。
          agent?.ctx?.logger?.warn?.(`ldvh: turn-start check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const currentNotice = getNoticeText();
      state.primePending = false;
      if (currentNotice === null || currentNotice === "") return decision;
      // Loss detection (re-review finding, 2026-09-04; **rewritten 2026-10-19**
      // for friction-41a43496). The digest gate alone meant a rewind to before
      // our row, or a cleared conversation, silently lost the visible notice
      // forever (lastDigest still matched, no re-injection). The first repair
      // checked `decision.messages` only — but that array is THIS turn's
      // assembled batch, not the session history, so a row injected last turn
      // was always judged "gone" and re-injected every turn. Correct shape:
      // a row is lost only when it is neither in this batch NOR recorded from a
      // previous batch (see noteOwnMessages).
      const batch = Array.isArray(decision.messages) ? decision.messages : [];
      const inBatch = batch.find(isOwnMessage);
      noteOwnMessages(state, batch);
      const everInjected = state.injectedIds !== undefined && state.injectedIds.size > 0;
      const changed = currentNotice !== state.lastDigest;
      if (!everInjected || changed) {
        // Row never injected (first turn), or the notice changed: inject one
        // fresh row. A row that is still live in an earlier turn does NOT
        // trigger this branch — that was the duplicate-injection defect.
        state.lastDigest = currentNotice;
        const fresh = createPluginMessage(currentNotice, (typeof noticeSummary === "function" ? noticeSummary() : noticeSummary) ?? "LDVH 管辖判定");
        noteOwnMessages(state, [fresh]);
        return {
          kind: "enter",
          messages: [...batch, fresh]
        };
      }
      // Row present and notice unchanged: refresh the text in place so a
      // stale row never lingers after the judgment moved on between turns.
      // When the row is not in this batch (it lives in an earlier turn) there
      // is nothing to refresh here — the standing state stays with the
      // system-prompt section, which carries the judgment every turn.
      if (inBatch !== undefined) inBatch.content = [{ type: "text", text: currentNotice }];
      return decision;
    }
  };
}
