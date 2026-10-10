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
import { runIdleCheckpoint, selectAuxTask } from "./idle-checkpoint.js";
import { createDiscoveryProvider } from "./friction-discovery-provider.js";
import { landDiscoveryVerdict } from "./friction-landing.js";
import { advanceWatermark } from "./friction-watermark.js";
import { recordRun } from "./idle-runlog.js";
import { appendPendingEntry } from "./pending-queue.js";
import { currentRouteValues } from "./session-signature.js";
import { authoritativeSignature } from "./signature-channel.js";
import { createChildInstaller } from "./child.js";
import { AgentLifecycle } from "./agent-lifecycle.js";
import { recordJudgementForGuard } from "./host-seams.js";

export function createLifecycleRegistry(ctx, { dshHomePath, workspaceRoot, sessionScopes, hostSeams }) {
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
          // 预算轮换：一次检查点只跑一个任务（32 §10.2），计数器随 lifecycle 存活。
          const rotation = lifecycle.turns.auxRotation ?? 0;
          lifecycle.turns.auxRotation = rotation + 1;
          const taskForThisCheckpoint = selectAuxTask(rotation);

          // §8.4 第 1 项的执行体：派一个**继承主控上下文**的受管辖隔离子代理去做
          // 语义查重，并取回它的结构化判断。仅对 `idle-review` 需要（其余任务尚未
          // 实现，runIdleCheckpoint 会如实报 not-implemented）。
          //
          // 依赖缺失时**不传 discover**，使 runIdleCheckpoint 如实报 skipped——
          // 那比"派一个零上下文的子代理冒充判断"诚实得多（§8.4 要求继承上下文）。
          let discover;
          if (taskForThisCheckpoint === "idle-review") {
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
            task: taskForThisCheckpoint,
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
          if (checkpoint?.ok === true && verdict !== undefined) {
            const ledgerRoot = join(scope.project.path, "ldvh-base");
            // 受控写入需要**权威路由签名**（02 §10.5）。取不到签名时**不落地**
            // ——宁可停在这里，也不写一条签名缺失的账目（那会污染 change_log 的
            // 归属）。取不到即按 §8.3 入队。
            const route = await currentRouteValues(sessionPersistence?.(), agent);
            if (!route.ok) {
              await appendPendingEntry(dshHomePath, {
                task: taskForThisCheckpoint,
                reason: `闭集落地缺少权威路由签名：${route.reason ?? "unknown"}`,
                residual: ["账目未写入（缺签名）"],
                at: new Date().toISOString(),
              });
              lifecycle.activity?.record("session/checkpoint/landed", { action: "no-signature" });
              landedAction = "no-signature";
            } else {
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
                  task: taskForThisCheckpoint,
                  reason: `闭集落地失败（${landed.error?.stage ?? "unknown"}）：${landed.error?.message ?? "unknown"}`,
                  residual: landed.error?.cause ? [String(landed.error.cause.message ?? landed.error.cause)] : [],
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
                    task: taskForThisCheckpoint,
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
                    turn: pendingTurn,
                  });
                  if (!advanced.ok) {
                    // 落地已成功、水位未推进：下次会重覆盖同一区间。**重覆盖不会
                    // 重复计数**吗——会。故此处必须入队如实登记，不得静默。
                    await appendPendingEntry(dshHomePath, {
                      task: taskForThisCheckpoint,
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
          } else if (checkpoint?.ok === false) {
            // 调度层已自行入队（recordAndFail），此处只记活动，不重复登记。
            lifecycle.activity?.record("session/checkpoint/stopped", {
              task: taskForThisCheckpoint,
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
              task: taskForThisCheckpoint,
              stage:
                checkpoint?.ok !== true
                  ? "stopped"
                  : verdict !== undefined
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

          lifecycle.activity?.record("session/checkpoint", { source, task: selectAuxTask(rotation) });
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
