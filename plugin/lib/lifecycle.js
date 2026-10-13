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

import { join } from "node:path";

import { resolveGovernanceScope } from "./governance-scope.js";
import { registerLdvhTools } from "./ldvh-tools.js";
import { createAssembleHandler, createPreStepHandler } from "./guidance.js";
import { noticeTextFor, noticeSummaryFor } from "./guidance-text.js";
import { createTurnTriggers } from "./triggers.js";
import { runIdleCheckpoint } from "./idle-checkpoint.js";
import { createDiscoveryProvider } from "./friction-discovery-provider.js";
import { landDiscoveryVerdict, residualFromLandingError } from "./friction-landing.js";
import { landCaptureVerdict, residualFromCaptureError } from "./experience-landing.js";
import { advanceWatermark, readWatermark, readDispatchState, recordDispatch } from "./friction-watermark.js";
import { admitIdleDispatch, pickEnabledAuxTasks } from "./idle-settings.js";
import { recordRun } from "./idle-runlog.js";
import { appendPendingEntry } from "./pending-queue.js";
import { currentRouteValues } from "./session-signature.js";
import { authoritativeSignature } from "./signature-channel.js";
import { createChildInstaller } from "./child.js";
import { AgentLifecycle } from "./agent-lifecycle.js";
import { recordJudgementForGuard } from "./host-seams.js";

export function createLifecycleRegistry(ctx, { dshHomePath, workspaceRoot, sessionScopes, hostSeams, getIdleSettings }) {
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
          // 活体 + 已结束子代理的统一枚举（childRecords）。collect 工具据此
          // 才能查到**已经结束**的子代理——原实现只读活体 Map，而子代理结束
          // 时记录被移入 retiredChildren，导致「只在运行中查得到」（2026-09-26 修）。
          listChildren: childRecords,
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
    // ── 子代理识别的第二判据：parentSession（2026-10-11 补）──────────────
    //
    // **为什么必须有这一条**：上面那条用 `origin`，而本宿主上该字段**不存在**
    // （2026-10-11 实测 48 个会话——44 根 + 4 子代理——`origin` 全部为 `null`）。
    // 于是判据恒为假，子代理**不走 child 路径**，而下一道 `roots()` 关也没能拦住
    // 它（宿主把子代理也算作 root）。后果：子代理被完整 install，挂上 idle 检查点
    // 触发器，于是它**执行时又派生自己的子代理**；同时它用自己的 session id 读写
    // 水位与冷却状态，使节流按会话分家——实测冷却配置 600 秒、实际间隔 1 秒。
    //
    // **判据取自参考实现**：`dsh-auto-memory`（`lib/index.js:4971`）用
    // `header.parentSession` 非空判定子代理，其注释写明目的是「只处理顶层会话…
    // **避免子代理轮次误沉淀**」——同一个失效面。`dsh-mnemon` 用 `origin`，
    // 但它的宿主上该字段可用，故此处不能照抄。
    //
    // **与 `origin` 的关系**：两者**任一为真即走 child 路径**，不互相替代——
    // `origin` 在提供该字段的宿主上是更明确的信号，`parentSession` 是可移植的
    // 兜底。不删 `origin` 那条：删了会在提供 origin 的宿主上退化为只靠兜底。
    const parentSession = agent?.session?.header?.parentSession;
    if (typeof parentSession === "string" && parentSession.trim().length > 0) {
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
      // Turn-level triggers (04 §8.4 触发锚：会话检查点 + 二次空闲确认).
      // 检查点到达由 agent/turn-stopping 标记，真正的调度由 agent/status 的
      // idle 迁移确认之后发生——两步都在 triggers.js 内，此处只注入编排回调。
      const turnTriggers = createTurnTriggers(agent, {
        getScopeState: () => lifecycle.scopeState,
        turns: lifecycle.turns,
        activity: lifecycle.activity,
        log: ctx.logger,
        onSessionCheckpoint: async ({ source, turn }) => {
          // 空闲辅助任务的调度（04 §8.3/§8.4 + 32 §10.2）。**不 await 关闭事件**
          // ——调用方（triggers）已把 promise 的拒绝收口为日志，此处保持同纪律。
          const cwd = agent?.session?.header?.cwd;
          if (typeof cwd !== "string" || cwd.length === 0) return;
          // §8.4「观察范围的切分（水位）」需要两个**位置标识**：会话 id 与轮次号。
          // 轮次号取自宿主 `turn/end` 事件的载荷（triggers 已用它记账），会话 id
          // 取自 agent 的会话头——两者都是宿主既有字段，不是本插件自造判据。
          // 取不到就**不跑**（水位无法界定 → runIdleCheckpoint 会 fail-closed）：
          // 不得退化为「当作全部内容」，那会使同一段内容被反复计入。
          const sessionId = agent?.session?.header?.id;
          const scope = await resolve(cwd);
          // 受管辖是运行前提（32 §137：git 层操作要求当前管辖）。
          if (scope.state !== "governed" || scope.project === undefined || scope.project === null) return;
          // ── 一次派发做多件事（Human 决定 2026-10-11）──────────────────────
          //
          // 原实现按 `rotation % 3` 挑**一个**任务（32 §10.2 候选设计的「按预算
          // 轮换」）。Human 改定：闲时任务的取舍由设置面开关决定，**勾选几个就做
          // 几件事**，一次派发把它们拼进**同一个**子代理的提示词。轮换概念连同
          // 轮换位计数器一并删除（`auxRotation` / `HEALTH_CHECK_PERIOD` /
          // `selectAuxTask` / `pickEnabledAuxTask`）。
          //
          // 该改动同时消除了两个既有缺陷，故此处不再需要它们的处置：
          //   · **轮换位死锁**（2026-10-11 实测）：轮换位只在准入通过后推进，而
          //     `memory-health` 默认停用 → 每次被 `task-disabled` 挡下 → 轮换位
          //     永为 2 → `idle-review` 再也不被跑到。**没有相位就没有死锁**。
          //   · **任务不在任何相位上**：`capacity-maintenance` 从未被选中过
          //     （实测 60 个相位里 0 次）。现在「被选中」= 「被勾选」。
          //
          // 顺序取 `AUX_TASK_ORDER`（规范叙述次序），**不取**设置对象的枚举次序
          // ——后者是 UI 细节，若成判据，同一组勾选在不同展示顺序下会得到不同
          // 提示词（隐藏耦合）。
          const idleSettingsForPick = typeof getIdleSettings === "function" ? getIdleSettings() : undefined;
          const pickedTasks = pickEnabledAuxTasks(idleSettingsForPick);
          // 本次要跑的全部任务；痕迹与提示词都取它。
          const tasksForThisCheckpoint = pickedTasks.tasks;

          // 无可跑任务（总开关关闭、或三个子项全被停用）：**不派发任何任务**。
          //
          // 这是配置的全部含义，**不是失败**——没有校验不可用，只是没有要跑的活，
          // 故不入队、不记 throttled（那会让「Human 关掉了它」看起来像「它出错了」）。
          // 轮换位也**不动**：重开时应从原相位继续。
          if (tasksForThisCheckpoint.length === 0) {
            lifecycle.activity?.record("session/checkpoint/no-enabled-task", {
              reason: pickedTasks.reason ?? "all-tasks-disabled",
            });
            return;
          }

          // ── 闲时辅助的准入闸（设置 + 节流）──────────────────────────────
          //
          // 判据全部落在 `idle-settings.js` 的**纯函数**里（admitIdleDispatch）：
          // 顺序为 总开关 → 子项开关 → 冷却 → 内容量 → 配额。此处只负责取状态
          // 与执行后果。
          //
          // **被挡下时不推进水位**：那段内容并入下一次观察区间——这正是节流
          // 「只延后、不抑制」的机械形态（`idle-checkpoint.js` 对 skipped 已确立
          // 同一纪律）。故被挡下**不是失败**，不进待处置队列。
          const idleSettings = idleSettingsForPick;
          if (idleSettings !== undefined) {
            const dispatchState = await readDispatchState(dshHomePath, { projectRoot: scope.project.path, sessionId });
            const prior = dispatchState.ok ? dispatchState.value : { lastDispatchAt: null, dispatchCount: 0, dispatchTimes: [] };
            // 水位为 null = 首次运行，覆盖全部既有内容；此时内容量门槛无条件解除
            // （否则历史摩擦会因某个区间恰好很短而永不被发现）。冷却仍适用。
            // **按任务读水位**（friction-watermark 的逐任务改造）。本次清单的
            // 首个任务即当前编排的任务键；多任务落地时，各任务须各自读自己的键
            // ——共用一条会使「一件成功、一件失败」互相牵连（成功者被重复落地）。
            const priorWatermark = await readWatermark(dshHomePath, {
              projectRoot: scope.project.path,
              sessionId,
              task: tasksForThisCheckpoint[0],
            });
            const isFirstRun = priorWatermark.ok ? priorWatermark.value.lastTurn === null : false;
            // 材料规模取自累积器给出的区间（判据层不读时钟、不读窗口内容）。
            const ahead = turnTriggers.windowFrom(priorWatermark.ok ? priorWatermark.value.lastTurn : null);
            // 准入判据收在**任务清单**上：先按总开关/任务清单过一遍，再走三类
            // 机械节流。`task` 传清单里的**第一个**任务仅用于「该任务是否被勾选」
            // 这一沿用判据——清单非空即意味着至少一个任务已勾选，故该判定恒真，
            // 真正起作用的只有冷却/内容量/配额三项。
            //
            // 为何不逐个任务分别过闸：三类约束（冷却/内容量/配额）度量的是**这次
            // 派发**的整体代价——一个子代理一次跑完 N 件事，其开销不随 N 线性增长
            // （上下文只解压一次），故按「一次派发」计量才是它真正的粒度。若按任务
            // 分别计量，勾 3 件会让冷却与配额被消耗三次，而实际只派发了一次。
            const admission = admitIdleDispatch({
              settings: idleSettings,
              task: tasksForThisCheckpoint[0],
              now: Date.now(),
              lastDispatchAt: prior.lastDispatchAt,
              dispatched: prior.dispatchCount,
              // 配额按**滑动窗口**计（F2）：传入时刻列表，使窗口滑过后容量恢复。
              dispatchTimes: prior.dispatchTimes,
              material: {
                chars: Array.isArray(ahead?.items)
                  ? ahead.items.reduce((sum, it) => sum + String(it.user ?? "").length + String(it.assistant ?? "").length, 0)
                  : 0,
                turns: Array.isArray(ahead?.items) ? ahead.items.length : 0,
              },
              isFirstRun,
            });
            if (!admission.admit) {
              // 如实记账：被节流挡下与「坏了」必须可区分，否则 Human 从痕迹里
              // 看不出机制是在歇着还是停了（参照 dsh-mnemon 的 stage 可区分纪律）。
              //
              // `tasks` 记下本次**本想**做的全部事项——被挡下时 Human 需要知道
              // 「是哪几件事被推后了」，只记一个任务名会掩盖范围。
              await recordRun(dshHomePath, {
                task: tasksForThisCheckpoint[0],
                tasks: [...tasksForThisCheckpoint],
                stage: "throttled",
                reason: admission.reason,
                // 三类约束**各自**的判定——使「存在但未触发」可与「不存在」区分
                // （04 §8.4「派发准入」段的「各自可被独立观察」要求；复审 D2/D7）。
                evaluated: admission.evaluations,
                at: new Date().toISOString(),
              });
              lifecycle.activity?.record("session/checkpoint/throttled", { task: tasksForThisCheckpoint[0], tasks: [...tasksForThisCheckpoint], reason: admission.reason });
              return;
            }
            // 冷却锚点在**派发之前**写入，故失败也计入——否则一次失败不占冷却窗口，
            // 下一次检查点立刻重跑，外观上正是 §8.3 禁止的「自行重试」。
            // 放行也留一次评估痕迹：某约束若在默认取值下恒不触发，只记「被挡下」
            // 会使它与「根本没实现」完全不可区分（复审 D2/D7）。
            await recordRun(dshHomePath, {
              task: tasksForThisCheckpoint[0],
              tasks: [...tasksForThisCheckpoint],
              stage: "admitted",
              reason: admission.reason,
              evaluated: admission.evaluations,
              at: new Date().toISOString(),
            });
            const recorded = await recordDispatch(dshHomePath, { projectRoot: scope.project.path, sessionId, at: new Date().toISOString(), limits: idleSettings.limits });
            if (!recorded.ok) {
              // 写不进锚点即无法保证节流——按 fail-closed 停止本次（不派发）。
              await recordRun(dshHomePath, {
                task: tasksForThisCheckpoint[0],
                tasks: [...tasksForThisCheckpoint],
                stage: "stopped",
                reason: `派发状态不可写：${recorded.error?.message ?? "unknown"}`,
                at: new Date().toISOString(),
              });
              return;
            }
          }

          // §8.4 第 1 项的执行体：以**零上下文**派生（spawn）一个受管辖隔离子代理，
          // 判断输入由调度侧机械交付（窗口原文材料 + 候选账本投影），取回它的结构化
          // 判断（04 §8.4「执行体与上下文供给」段，Human 决定 2026-10-12）。仅对
          // `idle-review` 需要（其余任务尚未实现，runIdleCheckpoint 会如实报
          // not-implemented）。
          //
          // 依赖缺失时**不传 discover**，使 runIdleCheckpoint 如实报 skipped——
          // 那比"在输入不全时硬派一个子代理冒充判断"诚实得多。
          let discover;
          // 清单里含 `idle-review` 就构造执行体——多任务派发**一次**，故这里不再
          // 判「本次轮到的任务是不是它」，而是判「本次是否要求做它」。
          // 其余两个任务尚未实现，`runIdleCheckpoint` 会按各自的分支如实回报。
          if (tasksForThisCheckpoint.includes("idle-review")) {
            try {
              const subagents = agent?.ctx?.get?.("subagents");
              if (subagents !== undefined && subagents !== null) {
                // 取消信号与发起会话同生共死：会话结束即释放派生。
                const controller = new AbortController();
                lifecycle.turns.discoveryAbort?.abort?.();
                lifecycle.turns.discoveryAbort = controller;
                discover = createDiscoveryProvider({
                  subagents,
                  parent: agent,
                  signal: controller.signal,
                  // D1：把**区间材料**交给执行体——由调度侧（turnTriggers 的
                  // 累积器）给出，不由子代理按坐标自行划定。见 friction-window.js。
                  provideWindow: (watermarkTurn) => turnTriggers.windowFrom(watermarkTurn),
                  onRun: (event) => lifecycle.activity?.record("session/checkpoint/executor", event),
                });
              }
            } catch (error) {
              // 构造提供者失败不退化为"没有执行体"以外的任何东西：如实记录，
              // 让 runIdleCheckpoint 走 skipped（不创建账目、不推进水位）。
              lifecycle.activity?.record("session/checkpoint/executor-unavailable", {
                reason: String(error?.message ?? error),
              });
            }
          }

          // §8.4 闭集第 2–4 项的落地：把子代理的判断写成账目。
          //
          // **这一段曾缺失**（缺陷 D2，由独立复核 030117d3 发现）：此前这里是裸
          // `await runIdleCheckpoint({...})`，返回值被直接丢弃——于是子代理算出的
          // 结论被算完即丢，账本永远不会有新账目，而水位照常推进，看起来像"跑通了"。
          // 现在把返回值接住，并按三态执行闭集动作。
          const checkpoint = await runIdleCheckpoint({
            dshHomePath,
            factSourceRoot: join(scope.project.path, "ldvh-base"),
            // 水位按「项目根 + 会话」分键（跨项目、跨会话各自独立）。
            projectRoot: scope.project.path,
            sessionId,
            currentTurn: turn,
            tasks: [...tasksForThisCheckpoint],
            discover,
          });

          // 运行痕迹用的结局变量（各分支赋值，末尾统一写入环形）。
          let landedAction;
          let landedUid;
          let landedPromoted;
          let advancedTurn;
          let gapRegistered;

          // 只有真正取回了判断才落地（skipped / not-implemented / 失败都没有判断）。
          // **注意层级**：runIdleCheckpoint 把执行体的返回值原样放在 `decision` 下，
          // 而执行体返回 `{ outcome, verdict, watermarkTurn }`——故判断在
          // `checkpoint.value.decision.verdict`。写错这一层会让落地**永不触发**，
          // 而那正是缺陷 D2 的形态（静默不落地），故有回归护栏守着它。
          const verdict = checkpoint?.ok === true ? checkpoint.value?.decision?.verdict : undefined;
          // 经验积累（36 §10）的结论——与摩擦的 verdict **并列**，由各自的落地函数
          // 处理。它取自逐任务结论表而非兼容字段 `verdict`（后者只承载摩擦）。
          const captureVerdict = checkpoint?.ok === true
            ? (checkpoint.value?.decision?.taskVerdicts?.["experience-capture"] ?? null)
            : null;
          // ── 多任务：任务级失败按 §8.3 入队，不落地、不推进水位 ────────────
          //
          // provider 现在**不再**对任务级校验失败抛错（那会使一次可用的运行被整条
          // 丢弃，正是 §10.2 新条款禁止的）；它改为把逐任务成败如实返回。故调用方
          // 必须自己识别该情形：`failedTasks` 非空即本次有任务未得结论，须逐条入队
          // 登记（§8.3 第 1 条），且**不得**拿 null 去落地。
          //
          // 注意 `verdict != null` 这个真值判定：失败时它是 `null`（不是 `undefined`），
          // 而 `null !== undefined` 为真——写成 `!== undefined` 会把失败当成功放行。
          const failedTasks = checkpoint?.ok === true
            ? (checkpoint.value?.decision?.failedTasks ?? [])
            : [];
          if (failedTasks.length > 0) {
            for (const key of failedTasks) {
              const why = checkpoint.value?.decision?.taskResults?.[key]?.error;
              await appendPendingEntry(dshHomePath, {
                task: key,
                reason: `任务「${key}」未取得结论：${why?.message ?? "unknown"}`,
                residual: why?.code ? [String(why.code)] : [],
                at: new Date().toISOString(),
              });
            }
            lifecycle.activity?.record("session/checkpoint/task-failed", {
              tasks: [...failedTasks],
              // 同时报告已成功者：使 Human 能看出「这次几件成了、几件没成」。
              succeeded: tasksForThisCheckpoint.filter((k) => !failedTasks.includes(k)),
            });
            // 失败即不落地、不推进水位（provider 已据此不给出 watermarkTurn）。
            // 落到下面的运行痕迹写入，使「有任务失败」在痕迹里可见。
          }
          // **准入条件是「有任务取得了结论」，不是「摩擦取得了结论」。**
          // 原条件只认 `verdict`（摩擦的兼容字段），于是清单里只有经验积累时
          // 整块落地被跳过——它的结论**算完即丢**，而外观上与「跑通了但没发现」
          // 完全相同（缺陷 D2 的同形）。故此处并列两个任务的结论。
          if (checkpoint?.ok === true && (verdict != null || captureVerdict != null) && failedTasks.length === 0) {
            const ledgerRoot = join(scope.project.path, "ldvh-base");
            // 受控写入需要**权威路由签名**（02 §10.5）。取不到签名时**不落地**
            // ——宁可停在这里，也不写一条签名缺失的账目（那会污染 change_log 的
            // 归属）。取不到即按 §8.3 入队。
            // **裸标识符陷阱（D8）**：此处原写作 `sessionPersistence?.()`，而
            // `sessionPersistence` 在本文件里**只是 `registerLdvhTools` 的实参
            // 属性名**（第 81 行 `sessionPersistence: () => ctx.get(...)`），
            // 从未声明为变量。于是这一行**每次都抛 ReferenceError**，而该异常
            // 沿 onSessionCheckpoint 冒泡后被执行体收口成一条日志（triggers.js
            // 的 dispatchCheckpoint），运行载体上**不留任何痕迹**：账本无、队列
            // 无、水位不动——与「机制没跑」外观完全相同。
            // 正确形态与其它模块一致（adr-tools/friction-tools/ldvh-tools 等）：
            // 经 `ctx.get("sessionPersistence")` 取服务后再可选调用。
            const route = await currentRouteValues(ctx.get("sessionPersistence"), agent);
            if (!route.ok) {
              await appendPendingEntry(dshHomePath, {
                task: tasksForThisCheckpoint,
                reason: `闭集落地缺少权威路由签名：${route.reason ?? "unknown"}`,
                residual: ["账目未写入（缺签名）"],
                at: new Date().toISOString(),
              });
              lifecycle.activity?.record("session/checkpoint/landed", { action: "no-signature" });
              landedAction = "no-signature";
            } else {
              // 签名已取得：**逐任务落地**。每个任务的结论由它自己的落地函数处理
              // ——不得只落地摩擦而把其它任务的结论留在 `decision` 里（那正是
              // 缺陷 D2 的形态：结论算完即丢，且不留痕迹）。
              if (verdict != null) {
                const landed = await landDiscoveryVerdict({
                  factSourceRoot: ledgerRoot,
                  verdict,
                  observationAt: checkpoint.value.at,
                  sessionSignature: authoritativeSignature({
                    provider: route.value.provider,
                    model: route.value.model,
                  }),
                });
                if (!landed.ok) {
                  // §8.3 fail-closed：落地失败按停止处置并登记（不自行重试、不掩盖）。
                  await appendPendingEntry(dshHomePath, {
                    task: "idle-review",
                    reason: `闭集落地失败（${landed.error?.stage ?? "unknown"}）：${landed.error?.message ?? "unknown"}`,
                    // 提炼**完整**诊断（含逐条校验明细），不把 issues 丢掉——
                    // 详见 friction-landing.js 的 residualFromLandingError。
                    residual: residualFromLandingError(landed.error),
                    at: new Date().toISOString(),
                  });
                  // **不推进水位**（复核发现①的修复）：落地失败即本次未产出，窗口
                  // 必须留待下次重覆盖——否则那段内容会被标记为已处理却从未入账，
                  // 且永不复查（宿主只发布事件、不回放）。
                  lifecycle.activity?.record("session/checkpoint/landed", { action: "failed", watermark_advanced: false });
                  landedAction = "failed";
                } else {
                  lifecycle.activity?.record("session/checkpoint/landed", {
                    action: landed.value.action,
                    object_uid: landed.value.object_uid,
                    promoted: landed.value.promoted,
                  });
                  landedAction = landed.value.action;
                  landedUid = landed.value.object_uid;
                  landedPromoted = landed.value.promoted;
                  // 复核发现②③：本次区间里本进程未观察到的轮次须**如实登记**，
                  // 不得静默丢弃。缺口不可恢复（宿主不回放、本模块不读会话日志），
                  // 故处置是「登记 + 越过」，而不是拒不推进（那会永久停摆）。
                  const gap = checkpoint.value?.decision?.unobserved;
                  if (gap && typeof gap === "object") {
                    await appendPendingEntry(dshHomePath, {
                      task: tasksForThisCheckpoint[0],
                      reason: `观察区间存在未覆盖缺口：turn ${gap.from}${gap.to === null || gap.to === undefined ? " 起（上界未知）" : `–${gap.to}`} 未被本进程观察到（宿主不回放事件，缺口不可恢复）`,
                      residual: [`缺口 ${gap.from}..${gap.to ?? "unknown"} 的内容未被观察`, "水位将越过该缺口——此为该区间的已知损失"],
                      at: new Date().toISOString(),
                    });
                    lifecycle.activity?.record("session/checkpoint/window-gap", { from: gap.from, to: gap.to ?? null });
                    gapRegistered = `${gap.from}..${gap.to ?? "?"}`;
                  }
                  // **落地成功之后**才推进水位（顺序纪律）：推进意味着「本区间已处理
                  // 完毕」；只有账目确实写成（或确认为无发现）时才成立。
                  const pendingTurn = checkpoint.value?.pending_watermark_turn;
                  if (Number.isInteger(pendingTurn)) {
                    const advanced = await advanceWatermark(dshHomePath, {
                      projectRoot: scope.project.path,
                      sessionId,
                      // 推进**本任务**的水位——这正是逐任务改造的目的：任务 A 成功
                      // 推进自己的水位，不因任务 B 失败而后退或被重覆盖。
                      //
                      // **显式写 "idle-review" 而非 tasksForThisCheckpoint[0]**：本块
                      // 是摩擦发现的落地分支，故它推进的只能是摩擦发现的水位；用清单
                      // 首项会在「清单只含其它任务」时推出一个不属于本块的键。
                      task: "idle-review",
                      turn: pendingTurn,
                    });
                    if (!advanced.ok) {
                      // 落地已成功、水位未推进：下次会重覆盖同一区间。**重覆盖不会
                      // 重复计数**吗——会。故此处必须入队如实登记，不得静默。
                      await appendPendingEntry(dshHomePath, {
                        task: tasksForThisCheckpoint[0],
                        reason: `水位推进失败（账目已写入，下次将重覆盖同一区间，可能重复计数）：${advanced.error.message}`,
                        residual: [`水位键 ${advanced.error.code}`, `重覆盖区间终点 turn=${pendingTurn}`],
                        at: new Date().toISOString(),
                      });
                      lifecycle.activity?.record("session/checkpoint/watermark", { advanced: false, code: advanced.error.code, turn: pendingTurn });
                    } else {
                      lifecycle.activity?.record("session/checkpoint/watermark", { advanced: true, turn: pendingTurn });
                      advancedTurn = pendingTurn;
                    }
                  }
                }
              }

              // ── 经验积累（36 §10）的落地：机械通道只建 draft 候选 ────────────
              if (captureVerdict != null) {
                const captured = await landCaptureVerdict({
                  factSourceRoot: ledgerRoot,
                  verdict: captureVerdict,
                  observationAt: checkpoint.value.at,
                  sessionSignature: authoritativeSignature({
                    provider: route.value.provider,
                    model: route.value.model,
                  }),
                });
                if (!captured.ok) {
                  // §8.3 fail-closed：落地失败按停止处置并登记（不自行重试、不掩盖）。
                  await appendPendingEntry(dshHomePath, {
                    task: "experience-capture",
                    reason: `经验积累落地失败（${captured.error?.stage ?? "unknown"}）：${captured.error?.message ?? "unknown"}`,
                    // 完整诊断（含逐条 issues），不把明细丢掉。
                    residual: residualFromCaptureError(captured.error),
                    at: new Date().toISOString(),
                  });
                  lifecycle.activity?.record("session/checkpoint/landed", {
                    task: "experience-capture",
                    action: "failed",
                    watermark_advanced: false,
                  });
                  landedAction = "failed";
                } else {
                  lifecycle.activity?.record("session/checkpoint/landed", {
                    task: "experience-capture",
                    action: captured.value.action,
                    object_uid: captured.value.object_uid,
                  });
                  // 运行痕迹取摩擦的动作（若两件都跑，摩擦是主项）；只在摩擦未
                  // 产出动作时用经验积累的动作填充，使「本次做了什么」仍可见。
                  landedAction ??= captured.value.action;
                  landedUid ??= captured.value.object_uid;
                  // **推进经验积累自己的水位**（逐任务水位的意义所在）：它与摩擦
                  // 互不牵连——摩擦失败不会使经验积累被重覆盖，反之亦然。
                  const pendingTurn = checkpoint.value?.pending_watermark_turn;
                  if (Number.isInteger(pendingTurn)) {
                    const advanced = await advanceWatermark(dshHomePath, {
                      projectRoot: scope.project.path,
                      sessionId,
                      task: "experience-capture",
                      turn: pendingTurn,
                    });
                    if (!advanced.ok) {
                      await appendPendingEntry(dshHomePath, {
                        task: "experience-capture",
                        reason: `水位推进失败（候选已写入，下次将重覆盖同一区间，可能重复建候选）：${advanced.error.message}`,
                        residual: [`水位键 ${advanced.error.code}`, `重覆盖区间终点 turn=${pendingTurn}`],
                        at: new Date().toISOString(),
                      });
                      lifecycle.activity?.record("session/checkpoint/watermark", {
                        task: "experience-capture", advanced: false, code: advanced.error.code, turn: pendingTurn,
                      });
                    } else {
                      lifecycle.activity?.record("session/checkpoint/watermark", {
                        task: "experience-capture", advanced: true, turn: pendingTurn,
                      });
                    }
                  }
                }
              }
            }
          } else if (checkpoint?.ok === false) {
            // 调度层已自行入队（recordAndFail），此处只记活动，不重复登记。
            lifecycle.activity?.record("session/checkpoint/stopped", {
              task: tasksForThisCheckpoint[0],
              code: checkpoint.error?.code ?? "unknown",
            });
          }
          // 运行痕迹（固定容量环形）：把本次检查点的**结局**持久化。
          // 理由见 idle-runlog.js 的模块注释——「跑了但没发现」与「根本没跑」从
          // 外部无从分辩，是修复期间反复撞上的盲区。
          // **诊断旁路不得打断机制**：recordRun 自身已保证不抛，此处再加一层，
          // 使任何意外都只影响痕迹的完整度，不影响检查点本身的结果。
          try {
            await recordRun(dshHomePath, {
              at: new Date().toISOString(),
              // `task`（单值）保留：它是既有 reader（Web 与诊断）的字段，改它会使
              // 旧读法失效。`tasks`/`unimplemented` 是**新增**的两个面，使「本次要求
              // 做哪几件、其中哪几件没做」在**持久化**痕迹里可见。
              //
              // 为什么必须持久化（M3）：内存态 activity 随进程退出即消失，而 §10.2
              // 要求「已启用但未实现」须在运行痕迹中如实登记为未执行。只记在
              // activity 里，Human 事后翻 runlog 看不到——等于没登记。
              task: tasksForThisCheckpoint[0],
              tasks: [...tasksForThisCheckpoint],
              unimplemented: checkpoint?.ok === true
                ? [...(checkpoint.value?.unimplemented ?? [])]
                : [],
              stage:
                checkpoint?.ok !== true
                  ? "stopped"
                  : failedTasks.length > 0
                    ? "land-failed"
                    : verdict != null
                      ? (landedAction === "failed" ? "land-failed" : "landed")
                    : (checkpoint.value?.outcome === "not-implemented" ? "not-implemented" : "skipped"),
              code: checkpoint?.ok === false ? (checkpoint.error?.code ?? "unknown") : undefined,
              action: landedAction,
              object_uid: landedUid,
              promoted: landedPromoted,
              watermark: advancedTurn,
              gap: gapRegistered,
            });
          } catch (error) {
            lifecycle.activity?.record("session/checkpoint/runlog-failed", {
              reason: String(error?.message ?? error),
            });
          }

          lifecycle.activity?.record("session/checkpoint", { source, tasks: [...tasksForThisCheckpoint] });
        }
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
        // 04 §8.4「触发后须二次确认会话确已空闲方可继续」的第二步：宿主
        // agent/status 的 `idle`（「no driver remains scheduled or active」）
        // 是权威空闲信号，本插件不自造判断。
        agent.ctx.on("agent/status", (payload) => turnTriggers.onAgentStatus(payload)),
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
      // 换接（2026-10-03）：子代理结论改由宿主的 `subagent/end` 事件承载。
      //
      // 为什么注册在**根 ctx** 而非子代理 ctx：该事件经
      // `carrier(parent)`（= `scopeTarget(this, parent)`）分发，作用域键是
      // **父代理**（宿主源码 packages/subagent/subagent/src/lifecycle.ts:106-112）。
      // 注册在子代理自身的 ctx 上收不到它。
      //
      // 与既有 `session/event` 捕获的关系：两者**并存**，不是替换。理由——
      //   - `subagent/end` 是宿主对「一个 residency epoch 终止」的权威通知，
      //     其 `lastAssistantMessage` 由宿主按本 epoch 的日志后缀切出
      //     （lifecycle.ts 的 createActivationObserver），比手工配对更精确；
      //   - 但它是 emit（fire-and-forget），且在**一次性运行**路径与
      //     **可续 epoch** 路径上的发布时机不同；既有配对路径覆盖的是
      //     assistant/message → turn/end，粒度是「轮」。
      //   两者互为补充：任一路径先到即写入结论槽（后到者覆盖，语义均为「最新」）。
      //   既有路径保留为回退，不因宿主事件缺失而失去结论。
      const disposeSubagentEnd = ctx.on("subagent/end", (info) => {
        try {
          const childId = info?.id;
          if (typeof childId !== "string" || childId === "") return;
          const record = children.get(childId)?.record ?? retiredChildren.get(childId)?.record;
          if (record === undefined) return; // 非本会话的子代理：忽略，不串写
          const message = info?.lastAssistantMessage;
          if (!Array.isArray(message)) return; // 无输出（中止/基础设施拒绝）：不动既有结论
          const text = message
            .filter((block) => block !== null && typeof block === "object" && block.type === "text")
            .map((block) => (typeof block.text === "string" ? block.text : ""))
            .join("");
          record.setConclusion(text);
        } catch (error) {
          // 捕获失败绝不得打断子代理生命周期（与既有路径同纪律）。
          ctx.logger.warn("[dsh-ldvh] subagent/end conclusion capture failed: %s", String(error?.message ?? error));
        }
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
        try { disposeSubagentEnd(); } catch { /* already removed */ }
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
