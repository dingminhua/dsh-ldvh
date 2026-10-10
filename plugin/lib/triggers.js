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
//   agent/turn-stopping      session checkpoint anchor (04 §8.4)         [ACTIVE: idle-review schedule]
//   agent/status             idle confirmation (04 §8.4 二次确认)        [ACTIVE: friction discovery]
//   session/event turn/end   turn-close bookkeeping (release, settle)   [SKELETON]
//   agent/disposed           (fiber-owned cleanup — no hook needed)     [implicit]
//
// 04 §8.4 「触发」段以**会话检查点**为触发锚并要求「触发后须二次确认会话确已空闲
// 方可继续」。本模块把该两步落成两个钩子：
//   - 检查点到达到 `agent/turn-stopping` 时**标记**「有一个待办的检查点」；
//   - 真正空闲由宿主 `agent/status` 的 `idle` 迁移确认（「no driver remains
//     scheduled or active」是宿主给出的权威语义），此时才调度辅助任务。
// 二者缺一不可：只在 turn-stopping 就动作会在用户正打字时跑后台任务；只等 idle
// 则拿不到「回合稳定」这个检查点语义。
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
 *
 * `onSessionCheckpoint` is invoked when a **session checkpoint** has arrived
 * AND the session has been confirmed idle (04 §8.4 触发段的两步). It receives
 * `{ turn, source }` and is expected to return a promise; the hook does not
 * await it (the host event is a synchronous emit) — rejections are logged and
 * never escape into the host's event dispatch.
 */
export function createTurnTriggers(agent, { getScopeState, turns, activity, log, onSessionCheckpoint }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;
  const state = turns ?? {
    turnStoppingSeen: 0,
    turnEndSeen: 0,
    lastTurn: undefined,
    lastReflectionGate: undefined,
    // 检查点到达后置位，由 idle 确认消费——这是 04 §8.4「触发后须二次确认
    // 会话确已空闲」的两步里的第一步。**不清空重来、不重复消费**：一次检查点
    // 最多调度一次辅助任务（否则 idle 的反复迁移会给同一次稳定点重复派任务）。
    checkpointPending: false,
    lastIdleSeen: 0,
    lastCheckpointDispatch: undefined
  };

  function governed() {
    return getScopeState() === "governed";
  }

  /** 调度辅助任务；不 await（宿主事件是同步 emit），失败只登记不外抛。 */
  function dispatchCheckpoint(source) {
    if (typeof onSessionCheckpoint !== "function") return;
    state.checkpointPending = false;
    state.lastCheckpointDispatch = { turn: state.lastTurn, source };
    activity?.record("session/checkpoint", { turn: state.lastTurn, source });
    try {
      Promise.resolve(onSessionCheckpoint({ turn: state.lastTurn, source })).catch((error) => {
        // 调度本身失败不等于辅助任务失败：任务内部的 fail-closed 由执行体与
        // 待处置队列承担（04 §8.3）。这里只保证异常不污染宿主的事件分发。
        log?.warn?.("[dsh-ldvh] idle checkpoint dispatch failed: %s", String(error?.message ?? error));
      });
    } catch (error) {
      log?.warn?.("[dsh-ldvh] idle checkpoint dispatch threw synchronously: %s", String(error?.message ?? error));
    }
  }

  return {
    /**
     * agent/turn-stopping — 会话检查点（04 §8.4 触发锚的第一步）。
     *
     * **只标记，不动作**：真正的触发在 idle 确认之后（第二步）。这正是规范
     * 要求的「触发后须二次确认会话确已空闲」——回合刚要结束的那一刻，用户很可能
     * 正在输入下一句。
     */
    onTurnStopping(payload) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return;
      state.turnStoppingSeen += 1;
      state.lastTurn = payload?.turn;
      // Gate: 未受管辖时不清点，也不置位——受管辖是 04 §8.4 运行的前提（git 层
      // 操作要求当前项目受管辖，32 §137）。
      state.lastReflectionGate = governed() ? "open" : "closed";
      if (state.lastReflectionGate === "open") state.checkpointPending = true;
      activity?.record("turn/stopping", { turn: state.lastTurn, gate: state.lastReflectionGate });
    },

    /**
     * agent/status — 空闲确认（04 §8.4 触发的第二步）。
     *
     * 宿主对 `idle` 的语义是「no driver remains scheduled or active」，故它是
     * 「会话确已空闲」的权威信号，本模块不自造判断（§14 第 6 条：不在规范里复制
     * 宿主事件实现，实现侧按宿主语义承接）。
     *
     * 只有「检查点待办 ∧ 迁入 idle」才调度；`running` 迁移忽略。
     */
    onAgentStatus(payload) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return;
      if (payload?.status !== "idle") return;
      if (!governed()) return;
      // 二次确认：检查点已到达（第一步），且此刻确实空闲（第二步）。
      if (state.checkpointPending !== true) return;
      state.lastIdleSeen += 1;
      dispatchCheckpoint("agent/status:idle");
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
