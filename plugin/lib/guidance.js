// dsh-ldvh — guidance surface: per-agent system-prompt/assemble injection and
// the agent/pre-step channel skeleton.
//
// Authority: specs/10 §5.3 (guidance surface — two injection entries, content
// single-authority / no verbatim rule text / size as a fixed constant),
// specs/01 §10.4 (minimal guidance 00 anchors — SIX items, not seven: 身份块/
// §2/§3/§4/§5（含 §5.6–§5.8）/§6), specs/10 §7.6 (protected-text registration).
//
// 2026-10-23 修正：本注释原写「specs/08 §5.3 (guidance surface)」与
// 「seven-anchor」。二者皆错——08 §5.3 的标题是「判定方式」（同级规范全文无
// 「引导」二字），01 §10.4 列的是六项。同一错误也存在于 guidance-text.js:8 与
// :47 的受保护文本中，那两处须经 Human 逐段同意方可改（00 §3.3），此处只修
// 本文件的注疏，不改受保护文本。
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

import { buildGuidance, guidanceSizeAlerts, reportGuidanceSize } from "./guidance-budget.js";
import { currentUserText } from "./recall-injection.js";
import { GUIDANCE_SECTION_NAME, migrationLineFor, noticeTextFor } from "./guidance-text.js";
import { REVIEW_ASK_ROW_SUMMARY } from "./review-ask.js";

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
    // 体量核对（10 §5.3「体量以固定常量承载」）。超预算按 10 §10.1 第 3 项的
    // 必停语义处理：不注入超预算的引导，但也不阻断整个装配——注入是能力承载，
    // 其缺失不应让会话无法开始；此处如实降级为「不注入 + 记录原因」。
    const guided = buildGuidance(scope.state);
    let text = guided.ok ? guided.text : "";
    if (!guided.ok) {
      // 超预算时不静默注入半截文本，而是交还「未注入及原因」（10 §10.1-3）。
      scope.guidanceBudgetExceeded = guided.error.message;
    }
    // **体量体检与漂移报警**（2026-11-03，friction-f9a66474 的处置）：实测体量与
    // `GUIDANCE_MEASURED_LENGTH` 记录值不一致时如实报出——**不阻断**注入。
    //
    // 为什么是报警而不是断言：若把实测体量写成测试断言的期望值，则「改动受保护
    // 文本」与「同步该期望值」必然落在两个提交里，与 `00 §3.3`「受保护文档须形成
    // 只含该文档的独立提交」互斥（friction-f9a66474）。拆开之后，受保护文本的
    // 合法改动可以独立成一个提交且全绿；记录值落后期间由本报警如实显示差异，
    // 记录值的同步是随后的普通提交。
    //
    // `guidanceSizeReport` **总是**挂上（不只在漂移时），这样「漂移报警这段代码
    // 还在不在」是可被正向断言的：字段缺席即转红，而不是「没漂移所以看不出」。
    const sizeReport = reportGuidanceSize(scope.state);
    scope.guidanceSizeReport = {
      state: sizeReport.state,
      length: sizeReport.length,
      budget: sizeReport.budget,
      ok: sizeReport.ok,
      withinEarlyWarning: sizeReport.withinEarlyWarning ?? null,
      drifted: sizeReport.drift.drifted,
      recorded: sizeReport.drift.recorded,
      delta: sizeReport.drift.delta,
    };
    // 两类告警（漂移／逼近上限）**都不阻断注入**，只如实报出。
    const alerts = guidanceSizeAlerts(sizeReport);
    if (alerts.drift !== undefined) {
      scope.guidanceLengthDrift = alerts.drift;
      agent?.ctx?.logger?.warn?.(`ldvh: ${alerts.drift.message}`);
    }
    if (alerts.nearBudget !== undefined) {
      scope.guidanceNearBudget = alerts.nearBudget;
      agent?.ctx?.logger?.warn?.(`ldvh: ${alerts.nearBudget.message}`);
    }
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

/**
 * 判定一条我方消息**是不是召回行**（而不是管辖判定行）。
 *
 * 为什么需要：两种行都由 `createPluginMessage` 产出，`isOwnMessage` 只能分辨
 * 「是不是我方消息」，分不出是哪一种。此前想给召回行补「旧行仍在则刷新」的分支时，
 * 就是因为分不出而**会覆盖掉判定行**，改动只能作废。
 *
 * 判别依据是 `source.summary`——两条路径写入的 summary 值互不相同且稳定：
 *   · 管辖判定行：`noticeSummaryFor(scopeState)` → "本会话受 LDVH 管辖" 等；
 *   · 召回行：`RECALL_SUMMARY` → "双源召回 · dsh-ldvh · 行动前候选"。
 * 它是**已存在的字段**，故判别不需要改生产端、不改变消息形状。
 */
function isRecallMessage(message, recallSummary) {  if (!isOwnMessage(message)) return false;
  const summary = message?.source?.summary;
  if (typeof summary !== "string" || typeof recallSummary !== "string") return false;
  return summary === recallSummary;
}

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

export function createPreStepHandler(agent, { isGoverned, channel, noticeText, noticeSummary, suppressUngovernedRow, onTurnStart, recallRow, recallSummary, reviewAskRow, reviewAskSummary } = {}) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  // Channel state lives on the AgentLifecycle object (single per-agent
  // home); fall back to a local state for direct/test usage without one.
  const state = channel ?? { primePending: false, lastDigest: null };
  // noticeText(): the current judgment notice (set by lifecycle.js from the
  // assemble handler's recordScope). Injected as a visible row when it
  // differs from the last injected digest.
  const getNoticeText = typeof noticeText === "function" ? noticeText : () => null;
  // suppressUngovernedRow(): 是否**不向对话流注入**「不受辖」的可见行（Human 2026-11-13，方案 A）。
  //
  // ## 为什么需要这个开关
  //
  // 不受辖时对话流里会出现 `上下文注入 · dsh-ldvh · 本会话不受 LDVH 管辖` 一行。
  // Human 的诉求是「不受管辖就不该有任何 LDVH 的其他信息」——在一个根本没用
  // LDVH 的项目里，每开一个会话都看到 LDVH 的痕迹，属噪声。
  //
  // ## 为什么不是「彻底不注入」（那不是本开关）
  //
  // 系统提示侧的判定（`system-prompt/assemble` 注入的 `【LDVH 管辖判定】`
  // 那一行）**照旧**——它是给模型的行为约束，不是给人看的信息。删了会让模型
  // 在不受辖项目里仍可能尝试调 LDVH 工具（工具确实没注册，但会浪费一轮）。
  // 本开关只关掉**对话流里的可见行**。
  //
  // ## 与 2026-09-04 决定的区别（不得混读）
  //
  // 那次 Human 否决的是「完全返回空字符串」——连系统提示侧也不给，导致模型
  // 无从判断、Human 也看不出判定结果。方案 A 保留系统侧，只撤可见行，
  // **不推翻那次决定**。
  const shouldSuppressRow = typeof suppressUngovernedRow === "function" ? suppressUngovernedRow : () => false;
  // onTurnStart(): **环境性**检查，每回合第一次 step 跑一次、受管辖时（21 §14
  // 「以及该会话续接本对象」）。它不产出任何上下文行，也不得影响本回合的进行：
  // 抛错只记日志——「会话继续干活」不该被环境检查拦住。
  const runOnTurnStart = typeof onTurnStart === "function" ? onTurnStart : null;
  // recallRow(): 行动前双源召回（10 §5.3「行动前引导入口」）。返回
  // {inject:false, reason} 或 {inject:true, text, digest}。它**不产出必停**：
  // 召回是输入侧，失败只记日志，不拦回合（与 runOnTurnStart 同一纪律）。
  const getRecallRow = typeof recallRow === "function" ? recallRow : null;
  const recallLabel = typeof recallSummary === "function" ? recallSummary : () => recallSummary;
  // reviewAskRow(): 两处把关询问的**行为提示行**（2026-11-13 Human 决定）。
  //
  // 它做的事与召回行同类但方向相反：召回行给出「有哪些事实可参考」，本行给出
  // 「此刻是否该向 Human 提请一次」。返回 `{inject:false, reason}` 或
  // `{inject:true, text, digest}`——与召回行同一形态，不新增机制。
  //
  // **为什么走这一面而不写进引导文本**：`plugin/lib/guidance-text.js` 是
  // 00 §3.3 的受保护文本（specs/10 §7.6 逐字登记为「插件 AI 面向语义文本」），
  // 改它须先展示候选、经独立审核并取得 Human 逐段同意。开关是行为面的可配置项，
  // 不属规则语义，走 pre-step 注入面既不触碰受保护文本，也能随开关热改。
  const getReviewAskRow = typeof reviewAskRow === "function" ? reviewAskRow : null;
  const reviewAskLabel = typeof reviewAskSummary === "function" ? reviewAskSummary : () => reviewAskSummary;
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
      state.lastRecallDigest = null;
      // 把关询问行同属「会随会话视图重置而消失」的注入行，其 digest 台账须一并
      // 清空——否则 rewind 后旧 digest 仍匹配，行政行永久静默（与召回行同一失效）。
      state.lastReviewAskDigest = null;
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
      // **不得因「判定文本尚未就绪」而连召回一起跳过**（2026-10-24 修）。
      //
      // 实测缺陷（真实接线复现）：`getNoticeText()` 返回 null（首回合 `lastScope`
      // 尚未由异步 resolve 写入）时，这里**直接 return**，而召回代码在其后——
      // 于是召回头一回合完全不执行。即「召回接好了但首回合不生效」这个缺陷
      // 的第**三**道门（前两道分别是 `scopeState` 与 `project.path`）。
      //
      // 正确形状：管辖判定行与召回行是**两个独立注入面**（下文注释亦如此声明），
      // 前者未就绪不应连坐后者。故这里不再提前返回，而是用一个「空判定」继续
      // 走流程，仅跳过判定行的注入。
      // 不受辖（not_governed / unavailable）且配置要求静默时，**不注入可见行**：
      // 把 noticeReady 直接判否，后续两个分支都不触发，但召回/把关行的独立
      // 判定不受影响（它们各自另有 governed 门）。
      //
      // 用 `null` 清掉 lastDigest：状态从 governed 切到 ungoverned 时，
      // 残留的旧 digest 会让下次切回 governed 被判为「没变化」而不重发。
      const suppressRow = shouldSuppressRow() === true;
      const noticeReady = currentNotice !== null && currentNotice !== "" && !suppressRow;
      if (suppressRow) state.lastDigest = null;
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
      // **判定行只能认「本行」，不能认「第一条我方消息」**（2026-10-27 修）。
      //
      // 实测缺陷：`batch.find(isOwnMessage)` 取的是**批次里第一条我方消息**，
      // 而当本回合只注入了召回行、判定行尚未注入（或已被裁剪）时，第一条就是
      // 召回行——于是下面那个「原地刷新」分支把**召回行的正文改写成判定文本**，
      // 而它的 `source.summary` 仍是「双源召回」，标签与正文串位。
      // 全工作区 65 条召回注入行里 14 条正文其实是管辖判定，即此机制。
      //
      // 判据与 `isRecallMessage` 同源：判定行 = 我方消息中**不是**召回行的那些。
      const currentRecallLabel = recallLabel() ?? "双源召回 · 行动前候选";
      // **把关询问行也必须被排除在「判定行」之外**（2026-11-13）：判定行的判据是
      // 「我方消息中不是召回行的那些」，若把关行也算进来，下面的原地刷新分支会把
      // 把关行的正文改写成管辖判定文本——与 2026-10-27 召回行那次串位同一形态。
      const currentReviewAskLabel = reviewAskLabel() ?? REVIEW_ASK_ROW_SUMMARY;
      const isNoticeMessage = (message) => isOwnMessage(message)
        && !isRecallMessage(message, currentRecallLabel)
        && (message?.source?.summary ?? null) !== currentReviewAskLabel;
      const inBatch = batch.find(isNoticeMessage);
      noteOwnMessages(state, batch);
      const everInjected = state.injectedIds !== undefined && state.injectedIds.size > 0;
      const changed = noticeReady && currentNotice !== state.lastDigest;
      const extras = [];
      // **同批次去重**（2026-10-27 修「同一 step 注入多条相同行」）：插件被装载
      // 多个实例时（配置重载、HMR、profile 里重复挂载），每个实例各挂一个
      // pre-step 监听器，于是同一批次被注入 N 条完全相同的行。实测：装 1 个实例
      // → 1 条；装 3 个 → 3 条；真实会话里 ad027a9f 有 9 个回合、75bb2718 有
      // 7 个回合出现 2 条，本会话 turn 1 出现 3 条。
      //
      // 判据用**内容相同**而不是「有没有我方行」：`next()` 的返回值已含**更内层
      // 监听器**追加的行（本处理器 prepend，故是最外层），所以最外层能看到其余
      // 实例的产物并据此收口；而内容不同的行（语料变了）仍照常注入。
      const alreadyHas = (text, summary) => batch.some((message) => {
        if (!isOwnMessage(message)) return false;
        if ((message?.source?.summary ?? null) !== summary) return false;
        const existing = Array.isArray(message.content)
          ? message.content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("")
          : "";
        return existing === text;
      });
      const noticeSummaryText = (typeof noticeSummary === "function" ? noticeSummary() : noticeSummary) ?? "LDVH 管辖判定";
      if (noticeReady && (!everInjected || changed)) {
        // Row never injected (first turn), or the notice changed: inject one
        // fresh row. A row that is still live in an earlier turn does NOT
        // trigger this branch — that was the duplicate-injection defect.
        state.lastDigest = currentNotice;
        if (!alreadyHas(currentNotice, noticeSummaryText)) {
          extras.push(createPluginMessage(currentNotice, noticeSummaryText));
        }
      } else if (noticeReady && inBatch !== undefined) {
        // Row present and notice unchanged: refresh the text in place so a
        // stale row never lingers after the judgment moved on between turns.
        inBatch.content = [{ type: "text", text: currentNotice }];
      }
      // 行动前双源召回（10 §5.3）：**独立于**管辖判定行，自带 digest 去重。
      // 它不因管辖判定行未变化而被跳过——两者是不同注入面。
      if (getRecallRow !== null) {
        let recall = null;
        try {
          // 本回合用户消息由本模块提取（它已持有 isOwnMessage 与批次），
          // 回调只负责「给定查询 → 召回 → 渲染」。这样召回侧不必认识
          // 本插件的消息形状，耦合只在一个方向上。
          recall = await getRecallRow({ userText: currentUserText(batch, isOwnMessage) });
        } catch (error) {
          // 召回失败不拦回合；如实记日志，不假装「无相关」。
          agent?.ctx?.logger?.warn?.(`ldvh: recall injection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (recall !== null && recall?.inject === true && typeof recall.text === "string" && recall.text !== "") {
          const label = recallLabel() ?? "双源召回 · 行动前候选";
          // **同批次去重**（与上方判定行同一纪律、同一 2026-10-27 实测依据）：
          // 插件装载多个实例时，每个实例的监听器都会走到这里并各追加一条内容
          // 完全相同的召回行（装 3 个实例 → 3 条）。批次里已有同内容同行标签的
          // 行就不再追加，但**不**据此跳过刷新：刷新语义仍由下面的 digest 分支管。
          const recallAlreadyInBatch = batch.some((message) => {
            if (!isOwnMessage(message)) return false;
            if ((message?.source?.summary ?? null) !== label) return false;
            const existing = Array.isArray(message.content)
              ? message.content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("")
              : "";
            return existing === recall.text;
          });
          if (recall.digest !== state.lastRecallDigest) {
            state.lastRecallDigest = recall.digest;
            if (!recallAlreadyInBatch) {
              extras.push(createPluginMessage(recall.text, label));
            }
          } else {
            // **旧召回行仍在时须刷新内容**（2026-10-24 修）。
            //
            // 此前只比 digest、相同就什么都不做——但 digest 相同**不代表内容仍
            // 最新**：语料可能已变（事实对象被更新、规范被修订）。同一句查询两次
            // 算出相同 digest（digest 就是渲染文本），旧行不刷新就会继续显示过时内容。
            //
            // 与管辖判定行同一形态（上方 `changed` 分支的 `inBatch.content = ...`），
            // 召回行此前**缺这一步**。
            //
            // **安全性**：只刷新**确认是召回行**的那条（`isRecallMessage` 按
            // `source.summary` 判别）。不能用 `inBatch`——它是「批次里第一条我方
            // 消息」，可能是管辖判定行，直接覆盖会把判定行内容改掉（上轮因此作废）。
            const priorRecall = batch.find((m) => isRecallMessage(m, label));
            if (priorRecall !== undefined) {
              priorRecall.content = [{ type: "text", text: recall.text }];
            }
          }
        }
      }
      // 两处把关询问的行为提示行（2026-11-13 Human 决定）。
      //
      // **形态与召回行完全同类**（独立注入面 + 自带 digest 去重 + 同批次去重），
      // 因为它解决的是同一类问题：**让「此刻该做什么」对模型可见**。区别只在
      // 内容方向——召回行给事实候选，本行给一次待发的提请。
      //
      // 它**不产生必停**：开关未开、主控判为不复杂、或读不到开关时都返回
      // inject:false，回合照常进行（与召回行同一纪律——注入是输入侧，失败不拦）。
      if (getReviewAskRow !== null) {
        let askRow = null;
        try {
          askRow = await getReviewAskRow({ userText: currentUserText(batch, isOwnMessage) });
        } catch (error) {
          agent?.ctx?.logger?.warn?.(`ldvh: review-ask injection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (askRow !== null && askRow?.inject === true && typeof askRow.text === "string" && askRow.text !== "") {
          const label = reviewAskLabel() ?? REVIEW_ASK_ROW_SUMMARY;
          const askAlreadyInBatch = batch.some((message) => {
            if (!isOwnMessage(message)) return false;
            if ((message?.source?.summary ?? null) !== label) return false;
            const existing = Array.isArray(message.content)
              ? message.content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("")
              : "";
            return existing === askRow.text;
          });
          // **只用 digest 去重，不做「行丢失」检测**（2026-11-13 独立审核 MAJOR-1）。
          //
          // 上一版我加了 `askRowLost`（digest 未变但本回合批次里没有该行 ⇒ 判定
          // 行丢失 ⇒ 重发）。**那是错的**：`resetVisibility` 上方那段注释已经把这个
          // 坑记下来了——「**不用**『本回合批次里没看见行』推断 rewind：批次永远
          // 看不到历史行，那样推断会把每一次正常轮次都当成 rewind，就是本摩擦的
          // 成因」（friction-41a43496）。
          //
          // 本机探针实测（修复前）：把关行 每回合行数 [1,1,1]（每回合都重复注入）；
          // 修复后 [1,0,0]（每个内容版本一次）。**正确的先例是上方那条判定行**
          // ——内容稳定 → 每个内容版本注一次；不是召回行（召回行在生产里内容随
          // 当次提问变化，几乎每回合都注入一次，[1,0,0] 只是恒定内容探针的产物）。
          //
          // **据实声明（00 §4.6）——本条不兜住的情形**：
          // ① `resetVisibility()` 的权威信号是 `agent/created` 的
          //    `payload.source ∈ startup|resume|clear|compact`，**rewind 不在这个
          //    集合里**，故「会话被 rewind 到该行之前」**没有权威信号可依据**——
          //    本仓规范与宿主能力里都查不到 rewind 这个概念。原 MINOR #6 想防的
          //    「行为指令静默消失」在当前证据下**无信号可判**，不是已解决。
          // ② **插件重载会再注一行**：注入台账是进程内状态，重载即清空 → 重载后
          //    首回合再注一条。真机证据：会话 `session-72aa14f9-f7c1-4a6a-9f79-bb59e4f81d56`
          //    （25 回合）里判定行出现 7 次、内容逐字相同，且该会话 `agent/created`
          //    事件数 = 0 ⇒ 重复不是 resetVisibility 造成的，而是重载/状态丢失。
          //    修复后同一现象仍会发生（只是不再每回合都发生）。
          // 代价：重载后的重复注入是可见噪声，不是失效——内容相同，Human 多看
          // 一眼。**故接受，不假装已解决。**
          if (askRow.digest !== state.lastReviewAskDigest) {
            state.lastReviewAskDigest = askRow.digest;
            if (!askAlreadyInBatch) {
              extras.push(createPluginMessage(askRow.text, label));
            }
          } else {
            // 旧行仍在时刷新内容（与召回行同一形态、同一理由：语料可能已变）。
            const prior = batch.find((m) => isOwnMessage(m) && (m?.source?.summary ?? null) === label);
            if (prior !== undefined) {
              prior.content = [{ type: "text", text: askRow.text }];
            }
          }
        }
      }
      if (extras.length > 0) {
        noteOwnMessages(state, extras);
        return { kind: "enter", messages: [...batch, ...extras] };
      }
      return decision;
    }
  };
}
