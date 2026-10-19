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
//   agent/turn-stopping      session activity → (re)start silence timer [ACTIVE]
//   agent/status             idle → arm silence timer (NOT a trigger)   [ACTIVE]
//   session/event turn/end   turn-close bookkeeping + activity refresh  [ACTIVE]
//   agent/disposed           (fiber-owned cleanup — no hook needed)     [implicit]
//
// 触发判据（36 §6.1，2026-10-14 修订）：「会话确已空闲」= **距最后一次会话活动
// 已持续不短于安静时长**。故本模块的形态是：
//   - `agent/turn-stopping` / `session/event turn/end`：**刷新活动时刻并重置**
//     安静期计时（对话在继续就不倒计时）；
//   - `agent/status: idle`：**只负责武装**计时器（宿主 idle 说明「此刻没有在跑的
//     驱动」，但**不说明会话已安静多久**，故它本身不是触发的成立点）；
//   - 计时到期且**再次确认确已安静** → 调度辅助任务。
//
// 为什么改掉旧形态（两句都须记住，它们是同一缺陷的两面）：
//   ① 旧实现以 `agent/status:idle` 直接派发 → 宿主在**回合刚结束**时就报 idle，
//      故它等于「回合结束即派发」，切出的增量往往只有一两轮；
//   ② 旧实现在 turn-stopping 置一个「待办位」、由首个 idle 消费 → 该位一经消费
//      便不再置位，而 idle 是**迁移事件**不会在持续空闲期重放，故**沉默越久反而
//      越不会触发**，更长的增量永远不会被观察。
//
// 一次安静期**至多触发一次**（`silenceFired`）：触发后须有**新的会话活动**才
// 重新计时。这同时是 36 §12「不得自行重试」的机械形态——失败后不得自动再试。
//
// Skeleton points evaluate their gate (governance state) and record
// observability markers, but deliberately DO NO work: the content of
// reflection, sedimentation proposals, and turn-close processing belongs
// to their own batches and (where writes are involved) Human intent +
// 03 §9 controlled-write pipelines.

import { resolveGovernanceScope } from "./governance-scope.js";
import { createWindowAccumulator } from "./friction-window.js";

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
 * AND the session has been confirmed idle (36 §6.1 的两步：活动之后须安静满
 * 一个安静时长). It receives `{ turn, source }` and is expected to return a
 * promise; the hook does not await it (the host event is a synchronous emit)
 * — rejections are logged and never escape into the host's event dispatch.
 *
 * `readSilenceMs()` 取安静时长（毫秒）；`persistActivityAt(ms)` 落持久化活动时刻
 * ——两者由编排层注入，使本模块不直接依赖配置读取与文件写入（可测）。
 */
export function createTurnTriggers(agent, { getScopeState, turns, activity, log, onSessionCheckpoint, readSilenceMs, persistActivityAt, now }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;

  /**
   * 尽力而为地写一条日志——**日志绝不能影响控制流**。
   *
   * 存在的理由：`armSilenceTimer` 的到期回调在 `setTimeout` 顶层执行，那里一旦
   * 抛异常就会逃逸成未捕获异常（可能带崩进程）。而 logger 是外部注入的，它的
   * 实现未必不抛（参数序列化、被替换成抛错桩等），`log?.info?.()` 只防了「没有
   * log / 没有该方法」，防不住「方法自己抛」。改动前的静默 `return` 没有这个
   * 风险，故补日志时必须同时补这层保护，否则是「为了可观测性引入了新故障」。
   *
   * 注意：这里吞掉的只是**日志**的异常，**派发判定本身仍走原有 `try/catch`**
   * （见 `dispatchCheckpoint`），两者不可混为一谈。
   */
  function note(level, ...args) {
    try {
      log?.[level]?.(...args);
    } catch {
      // 日志失败即静默放弃：这里再抛就失去意义了。
    }
  }
  const state = turns ?? {
    turnStoppingSeen: 0,
    turnEndSeen: 0,
    lastTurn: undefined,
    lastReflectionGate: undefined,
    // ── 2026-10-14：触发判据由「idle 事件 + 待办位」改为「安静期计时」──────
    //
    // `checkpointPending` 已**删除**：它服务的旧语义（「检查点到达」由 idle 消费）
    // 正是被 36 §6.1 判为偏离的形态——宿主在回合刚结束时就报 idle，故那等于
    // 「回合结束即派发」，且待办位一经消费便不再置位，使**沉默越久越不会触发**。
    //
    // `lastActivityAt`：最后一次会话活动时刻（毫秒）。它是«空闲»判据的锚——
    // 与「上次派发时刻」是两个不同的量（前者问人是否停了，后者问机制跑得勤不勤）。
    // 由调度侧经 `persistActivityAt` 落持久化载体：只存内存态会在热重载后归零，
    // 使计时失真（要么刚重载就又触发，要么永远攒不满）。
    lastActivityAt: null,
    // 安静期计时器句柄；null 表示当前没有在计时（未武装或已消费）。
    silenceTimer: null,
    // **本段安静期是否已触发过**：`false` 表示未触发，触发后置 `true`，直到下一次
    // 出现新的会话活动才复位。这是「一次安静期至多触发一次」的机械形态——
    // 同时是 §12「不得自行重试」的实现：失败后没有新活动就不得自动再试。
    silenceFired: false,
    // **已销毁**：`dispose()` 置真后不得再武装。存在的理由见 `dispose()` 与
    // `restoreActivityAt`：后者由 lifecycle 的 fire-and-forget 旁路在两次 `await`
    // 之后才调用，那时会话可能已经卸载，若无此标记就会为已销毁的对象留下一个
    // 真实计时器，到期后对死对象派发一次。
    disposed: false,
    lastIdleSeen: 0,
    lastCheckpointDispatch: undefined
  };

  // D1（缺陷修复）：区间材料在**调度侧**机械累积。它是本模块的状态而非事实，
  // 随 agent 生命周期存活；区间内容由它给出，不由子代理自行划定。
  const accumulator = createWindowAccumulator();

  function governed() {
    return getScopeState() === "governed";
  }

  /** 当前时刻（毫秒）。**可注入**，使测试能同步推进「假定时器」与「时钟」。 */
  function nowMs() {
    const n = typeof now === "function" ? now() : Date.now();
    return Number.isFinite(n) ? n : Date.now();
  }

  /** 取安静时长（毫秒）。缺省/非法一律回落 300000（5 分钟，与 IDLE_DEFAULTS 同值）——但**保存侧**须已拒绝非法值。 */
  function silenceMs() {
    const raw = typeof readSilenceMs === "function" ? readSilenceMs() : undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 300000;
  }

  function clearSilenceTimer() {
    if (state.silenceTimer !== null) {
      try { clearTimeout(state.silenceTimer); } catch { /* 已失效 */ }
      state.silenceTimer = null;
    }
  }

  /**
   * 刷新「最后一次活动时刻」并**重置**安静期（36 §6.1：计时自活动发生时重新开始）。
   *
   * 对话在继续时不得处于倒计时状态——故本函数必先取消既有计时器。
   */
  function touchActivity(nowMsInput) {
    const at = Number.isFinite(nowMsInput) ? nowMsInput : nowMs();
    state.lastActivityAt = at;
    state.silenceFired = false;
    clearSilenceTimer();
    // 持久化（尽力而为，不阻塞事件流；失败只记日志）。
    if (typeof persistActivityAt === "function") {
      try {
        Promise.resolve(persistActivityAt(at)).catch((error) => {
          log?.warn?.("[dsh-ldvh] activity stamp persist failed: %s", String(error?.message ?? error));
        });
      } catch (error) {
        log?.warn?.("[dsh-ldvh] activity stamp persist threw: %s", String(error?.message ?? error));
      }
    }
  }

  /**
   * 武装安静期计时：到期且**再次确认确已安静**后派发（36 §6.1 二次确认的实现）。
   *
   * **不重复武装已触发过的安静期**：`silenceFired` 为真时直接返回——这使
   * 「一次安静期至多触发一次」成立，并使失败后不会自动重试（§12）。
   *
   * **按「剩余安静时长」而非整段时长武装**（2026-10-19 独立审核）：
   * 原实现无条件 `setTimeout(fn, idleMs)`，于是恢复一个久远锚点后还要再白等
   * 一整个安静时长才轮到到期判定——而 36 §6.1 的判据是「距最后一次活动已
   * 持续不短于安静时长」，该判据当时**已经被满足**。延迟取剩余量即可。
   */
  function armSilenceTimer() {
    // **销毁是终局**：`dispose()` 之后不得再武装。这条检查**可达**——`onAgentStatus`
    // 收到 idle 就会调本函数，而宿主在会话卸载途中仍可能派发状态事件；不拦的话，
    // 已销毁的对象会重新得到计时器，到期后对死对象派发一次（实测：dispose →
    // onTurnStopping → onAgentStatus(idle) → pending 变为 1）。故这里是硬守卫，
    // 不是重复保险；`restoreActivityAt` 的入口检查同样保留（那条路径在武装之前
    // 就返回，避免写坏状态）。
    if (state.disposed === true) return;       // 已销毁：不得再武装
    if (state.silenceFired === true) return;   // 本段安静期已触发，等新活动复位
    if (state.lastActivityAt === null) return; // 无从计时
    if (state.silenceTimer !== null) return;   // 已在计时
    const idleMs = silenceMs();
    const startedAt = state.lastActivityAt;
    // 剩余量取非负：锚点若在未来（时钟回拨等），按「立即到期」处理，由到期
    // 判定里的 `quietFor < idleMs` 早退兜住，不在这里猜。
    const remainingMs = Math.max(0, idleMs - (nowMs() - startedAt));
    state.silenceTimer = setTimeout(() => {
      state.silenceTimer = null;
      // 到期时**再确认**一次：期间若有过新活动，计时已被 `touchActivity` 重置，
      // 此处判据即为假——防「计时器与活动事件竞态」下的误触发。
      //
      // **时钟可注入**（`nowMs`）：生产不传即用 `Date.now()`；测试注入受控时钟，
      // 使「假定时器推进」与「时钟推进」同步——否则假定时器到期时 `Date.now()`
      // 仍是旧值，本判据会把一次合法触发误判为竞态。
      const quietFor = nowMs() - (state.lastActivityAt ?? 0);
      // **到期早退必须留痕**（2026-10-19 独立审核）：此前它们全是静默 `return`，
      // 使「计时器到点了却没有派发」在事后无从归因——2026-10-19 03:24:05 本会话
      // 安静 740 秒（阈值 300 秒）却无派发，两位独立审核者都无法判定走了哪条早退，
      // 因为这里不写任何痕迹。判定语义**不变**，只补可观测性。
      //
      // **一律用 info，不用 debug**：cordis logger 的等级过滤是
      // `(exporter.levels?.default ?? this.level ?? 1) < level` 即丢弃
      // （`@deepseek-ai/cordis/lib/index.js:474`），而 debug 的等级是 3
      // （同文件 `:460`）。默认等级 1 下 **debug 日志根本不输出**——用它留痕
      // 等于没留，恰好废掉本改动的全部目的。
      //
      // **日志本身不得影响控制流**：本回调在 `setTimeout` 顶层执行，日志若抛出
      // 会逃逸成未捕获异常（改动前的静默 `return` 无此风险）。故一律经 `note()`
      // 吞掉日志自身的异常——**留痕是尽力而为，派发判定不受它牵连**。
      //
      // 早退之后若安静期仍可触发，**重武装**：否则计时器被消费而无人重建，
      // 会话会静默到下一次宿主 `agent/status` 变化（而宿主只在 status **变化**
      // 时发事件，一个已经 idle 的会话不会再发）。`armSilenceTimer` 的自身守卫
      // 保证不会重复武装、也不会在 `silenceFired` 后复活。
      if (quietFor < idleMs) {
        note("info", "[dsh-ldvh] silence timer expired but NOT quiet enough: quietFor=%dms threshold=%dms", quietFor, idleMs);
        armSilenceTimer();
        return;
      }
      if (state.lastActivityAt !== startedAt) {
        // 计时起点已变，本次作废
        note("info", "[dsh-ldvh] silence timer expired but the start anchor moved: startedAt=%s lastActivityAt=%s", String(startedAt), String(state.lastActivityAt));
        armSilenceTimer();
        return;
      }
      if (!governed()) {
        note("warn", "[dsh-ldvh] silence timer expired but the scope is no longer governed: no checkpoint dispatched");
        return;
      }
      // 注：此处**没有** `silenceFired === true` 的早退。`armSilenceTimer` 的入口
      // 守卫（`state.silenceFired === true` 即不武装）已保证到期回调执行时它必为
      // 假，故原本那条早退是**不可达的死代码**（2026-10-19 独立审核：穷举 1296 条
      // 公开 API 调用序列，命中 0 次）。删掉它，免得后来者以为这里还护着一支分支。
      state.silenceFired = true; // 先置位：此后除非有新活动，不得再触发
      dispatchCheckpoint("silence:timer");
    }, remainingMs);
    // 不阻止进程退出：计时器纯属后台检修，宿主退出时无须等它。
    if (typeof state.silenceTimer?.unref === "function") state.silenceTimer.unref();
  }

  /** 调度辅助任务；不 await（宿主事件是同步 emit），失败只登记不外抛。 */
  function dispatchCheckpoint(source) {
    if (typeof onSessionCheckpoint !== "function") return;
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
     * agent/turn-stopping — 会话活动（触发的**计时起点**）。
     *
     * **2026-10-14 语义变更（36 §6.1 修订）**：本事件不再「置位一次待办」而由
     * idle 消费，而是**刷新「最后一次会话活动时刻」并（重新）武装安静期计时**。
     * 原实现把它当「检查点已到达」的标记，真正的调度由 `agent/status:idle`
     * 触发——而宿主在**回合刚结束**时即进入 idle，故那等于「回合一结束就可能派发」，
     * 拿到的增量往往只有一两轮（实测 1923–7098 字符）。
     *
     * 现行判据（§6.1）：**距最后一次会话活动已持续不短于安静时长**才可派发。
     * 故本事件的作用是**重置计时**——对话仍在继续则永不触发，这才是
     * 「会话确已空闲」的字面含义（原实现确认的是「宿主当前没有驱动在跑」，
     * 那是另一个量）。
     */
    onTurnStopping(payload) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return;
      state.turnStoppingSeen += 1;
      state.lastTurn = payload?.turn;
      // Gate: 未受管辖时不清点，也不武装——受管辖是 36 §4 运行的前提（git 层
      // 操作要求当前项目受管辖，32 §137）。
      state.lastReflectionGate = governed() ? "open" : "closed";
      if (state.lastReflectionGate === "open") {
        // 受管辖：刷新活动时刻并重置安静期（对话在继续，就不该进入倒计时）。
        touchActivity(nowMs());
      }
      activity?.record("turn/stopping", { turn: state.lastTurn, gate: state.lastReflectionGate });
    },

    /**
     * agent/status — **不再是触发点，只是武装安静期的一个时机**（2026-10-14）。
     *
     * 宿主对 `idle` 的语义是「no driver remains scheduled or active」——它说明
     * **此刻没有在跑的驱动**，但**不说明会话已安静多久**。原实现把该事件直接当作
     * 二次确认的成立点并立即派发，于是「回合刚结束」与「闲置两小时」得到相同的
     * 待遇（都算「已空闲」），而后者反而**永不触发**（原实现的待办位已被首次
     * idle 消费、且 idle 是迁移事件不会重放）。
     *
     * 现行（36 §6.1）：本事件只负责在受管辖且确有活动的情况下**武装安静期计时**；
     * 真正的派发由安静期到期时发出。故此处不再有 `checkpointPending` 的置位/消费。
     */
    onAgentStatus(payload) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return;
      if (payload?.status !== "idle") return;
      if (!governed()) return;
      state.lastIdleSeen += 1;
      // 无活动时刻则无从计时（例如宿主在会话开始前就报了 idle）——此时不武装，
      // 等下一次真实的回合结束再计时。不得以「现在」充作活动时刻：那会把
      // 「从未活动过」读成「刚活动过」。
      if (state.lastActivityAt === null) return;
      armSilenceTimer();
    },

    /** session/event — turn/end bookkeeping seam. Skeleton: marker only. */
    onSessionEvent(session, event) {
      // D1：把区间材料在**调度侧**机械累积（不读会话日志、不用弃用 API——
      // 与 child.js 同模式：只消费已发布事件）。累积先于一切 return，使所有
      // 类型的事件都能被看到。
      try {
        accumulator.observe(session, event, agent?.session);
      } catch (error) {
        log?.warn?.("[dsh-ldvh] window accumulation failed: %s", String(error?.message ?? error));
      }
      if (session !== agent?.session || event?.type !== "turn/end") return;
      state.turnEndSeen += 1;
      state.lastTurn = eventTurn(event) ?? state.lastTurn;
      // **会话活动**（2026-10-14）：`turn/end` 也是活动——它同时是区间材料的
      // 结算点。此处刷新活动时刻（重置安静期），使「对话还在进行」不会被误判为
      // 安静。与 `onTurnStopping` 的刷新**不冲突**：两者都表示「有人在说话」，
      // 任一发生都应重置计时（取最后发生者为准）。
      if (governed()) touchActivity(nowMs());
      activity?.record("turn/end", { turn: state.lastTurn });
      // Content seam (future batch): turn-close settlement — release any
      // pinned per-turn state, reconcile enumeration digests, schedule
      // deferred reflection (mnemon idleReview timing shape, LDVH
      // proposal-only semantics).
    },

    /**
     * D1：取「水位之后」的区间材料（交给子代理的实际内容）。
     * 由编排层在调度前调用——**区间内容由调度侧给出，不由子代理自行划定**。
     */
    windowFrom(watermarkTurn) {
      return accumulator.windowFrom(watermarkTurn);
    },

    /**
     * 清定时器（会话结束 / 插件卸载时由 lifecycle 的清理函数调用）。
     *
     * **不清 `lastActivityAt`**：它是**跨会话持久化**的量（写在水印载体上），
     * 清它会使下次装载从零开始计时；清理只负责不留下「进程已退出仍在计时的
     * 定时器」这一泄漏。`silenceFired` 亦不清——它属于**本段安静期**，
     * 随对象销毁自然消失。
     */
    dispose() {
      state.disposed = true; // 之后的 restoreActivityAt 一律不得再武装
      clearSilenceTimer();
    },

    /**
     * 恢复持久化的活动时刻（装载时由 lifecycle 注入；见 `persistActivityAt`）。
     *
     * **恢复后必须武装计时器**（2026-10-19 独立审核）：此前本函数只写锚点与复位
     * `silenceFired`，**不武装**——于是插件热重载（或进程重启装载）之后，该会话
     * 在「下一次 `agent/status: idle`」到来之前**完全没有计时器在跑**。而宿主的
     * `agent/status` 只在 status **发生变化**时发出（`agent-loop` 的 `setPhase`
     * 判 `status !== previousStatus`），一个已经 idle 的会话不会再发一次 idle
     * ——这不只是「延迟一次」，而是「等到下一次真实的 running→idle 转变」。
     *
     * 恢复出来的锚点本就是「最后一次活动时刻」，安静时长应自它起算；不武装
     * 等于把已经过去的安静时间全部丢弃。到期延迟由 `armSilenceTimer` 按**剩余量**
     * 计算，故久远锚点会立刻进入判定，不白等一个完整安静时长。
     *
     * 本函数由 lifecycle 的 **fire-and-forget** 异步旁路调用（该 IIFE 中间有两次
     * `await`，期间会话可能已被销毁或已有新的真实活动）。故必须满足三条：
     *
     * 1. **锚点单调**：只接受比当前更新的时刻。陈旧快照不得覆盖运行时已更新的
     *    锚点——否则「刚活动过的会话」会被以陈旧锚点误判为「已安静很久」并派发。
     * 2. **先清后武装**：`clearSilenceTimer()` 再 `armSilenceTimer()`，保证计时器
     *    与锚点**同源**。否则旧计时器的闭包仍指向旧 `startedAt`，到期必命中
     *    「起点已变」早退并被消费，使会话静默到下一次宿主状态变化——正是本次
     *    修复要消灭的那类空转。
     * 3. **不抛**：调用方在 `try/catch` 里，但本函数原契约就是「不抛」；且此处
     *    若在写状态/武装之后抛错，调用方会拿到异常而内部状态已变（半提交）。
     */
    restoreActivityAt(ms) {
      const n = Number(ms);
      if (!Number.isFinite(n) || n <= 0) return; // 非法值：忽略，保持既有锚点
      // 超出 `Date` 可表示范围（±8.64e15）的值必须挡在写状态之前：`new Date(n)
      // .toISOString()` 会抛 `RangeError: Invalid time value`，而那时锚点已写、
      // 计时器已武装——调用方拿到异常却留下半提交的状态。本函数原契约是「不抛」，
      // 由 lifecycle 的 fire-and-forget 旁路调用，半提交尤其不可接受。
      if (n > 8_640_000_000_000_000) return;
      if (state.disposed === true) return;       // 已销毁：不得武装（见 dispose）
      const current = state.lastActivityAt ?? 0;
      if (n <= current) return;                  // 陈旧锚点：不覆盖更新的锚点
      state.lastActivityAt = n;
      state.silenceFired = false;
      clearSilenceTimer();                       // 与 touchActivity 对齐：先清后武装
      armSilenceTimer();
      note("info", "[dsh-ldvh] activity anchor restored from %s; silence timer armed", new Date(n).toISOString());
    },

    /**
     * 恢复「最后一个已知轮次」（由 lifecycle 在派发时回填，见 onSessionCheckpoint）。
     *
     * **为什么需要它**（2026-10-19）：`lastTurn` 只在回合边界事件里被赋值
     * （`onTurnStopping` 的载荷、`onSessionEvent` 的 `turn/end`），**没有任何
     * 持久化载体**。于是进程重启/插件热重载之后，只要该会话尚未开启新回合，
     * `lastTurn` 就是 `undefined`；安静期到期时派发拿不到区间端点，按 36 §8.4
     * 第 6 项 fail-closed——重启后的第一次闲时派发**必然**失败。
     *
     * 位置来源只能是宿主会话记录（36 §11「切分依据只能是宿主会话记录中的位置」），
     * 由调用方读好后经本函数写回。本函数**不自己读**：triggers 只拿会话事件，
     * 没有持久化依赖，让计时器模块去读日志会把「调度判据」与「材料来源」混在一起。
     *
     * 三条纪律与 `restoreActivityAt` 同构：
     *
     * 1. **单调**：只接受比当前更新的轮次号。陈旧快照不得覆盖运行时已更新的
     *    `lastTurn`——否则刚跑完第 12 轮的会话会被以陈旧的第 9 轮作水位，
     *    使第 10–12 轮被重复计入（正是水位段要消除的失效面）。
     * 2. **不覆盖已定义值**：`lastTurn` 已有值时一律不动。本函数只服务「重启后
     *    尚无任何回合」这一种情形，不该成为另一条写 `lastTurn` 的通道。
     * 3. **不抛**：调用方是 fire-and-forget 旁路；此处若抛，内部状态已变（半提交）。
     *
     * @param {number} turn 轮次号（非负整数）
     * @returns {boolean} 是否采纳
     */
    restoreLastTurn(turn) {
      if (!Number.isInteger(turn) || turn < 0) return false;
      if (state.disposed === true) return false;
      // 已有值即不覆盖：本函数只补「重启后还没有任何回合」的空白，不是第二条
      // 写通道。运行时事件给的 `lastTurn` 永远比装载期读到的快照新。
      if (state.lastTurn !== undefined) return false;
      state.lastTurn = turn;
      note("info", "[dsh-ldvh] last turn restored from the host session record: turn=%d", turn);
      return true;
    },

    /** Test/diagnostic seam. */
    snapshot() {
      return { ...state };
    }
  };
}

/** Resolve helper re-exported for trigger content seams (uncached, 07 §5.3). */
export { resolveGovernanceScope };
