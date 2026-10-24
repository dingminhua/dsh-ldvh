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
//   agent/turn-stopping      session activity → reset silence window    [ACTIVE]
//   agent/status             idle → arm silence timer (NOT a trigger)   [ACTIVE]
//   session/event turn/end   turn-close bookkeeping + activity refresh  [ACTIVE]
//   agent/disposed           (fiber-owned cleanup — no hook needed)     [implicit]
//
// 触发判据（11 §6.1）：「会话确已空闲」= **距最后一次会话活动已持续不短于
// 安静时长**。故本模块的形态是：
//   - `agent/turn-stopping` / `session/event turn/end`：**刷新活动时刻并重置**
//     安静期计时（对话在继续就不倒计时）；
//   - `agent/status: idle`：**只负责武装**计时（宿主 idle 说明「此刻没有在跑的
//     驱动」，但**不说明会话已安静多久**，故它本身不是触发的成立点）；
//   - 计时到期且**再次确认确已安静** → 调度辅助任务。
//
// **计时载体：每个会话一个进程内 `setTimeout`（2026-10-24 回退）**——2026-10-22
// 曾把计时改由宿主定时任务承载（`ctx.schedule` 排期，宿主到点把
// `[SCHEDULE REMINDER]` 投递回会话）。该形态在真实宿主上实测连续多次投递均未
// 走到派发、且识别与判定环节要靠在每处早退落盘才能归因；Human 于 2026-10-24
// 决定停用宿主投递，改回本仓 `c7384a9` 之前的进程内计时形态。回退的代价按
// 11 §6.1 如实登记：计时器随宿主重启/插件热重载消失，只能靠**持久化的活动
// 时刻**在装载时按剩余量重建；计时状态不可被第三方从宿主任务表回读，回读面
// 只剩运行痕迹。回退**不放松**判据：安静时长、到期二次确认、一次安静期至多
// 触发一次、不得自行重试，均与承载方式无关。
//
// **回合进行中不存在倒计时**（2026-10-23 定下的纪律，本次随载体一并保留）：
// `turn/start` 清掉计时器，`turn/end` 按「结束时刻 + 安静时长」重新武装。
// 进程内计时器使这条纪律**真正成立**（`clearTimeout` 同步生效、其状态可本地
// 回读），不再有「撤掉未生效」的残留窗口。
//
// `turnInFlight` 仍作为末道防线保留：若到期回调与回合开始交错（事件落盘晚于
// 事实），回调内再判一次，禁止在回合进行中派发。
//
// 一次安静期**至多触发一次**（`silenceFired`）：触发后须有**新的会话活动**才
// 重新计时。这同时是 11 §12「不得自行重试」的机械形态——失败后不得自动再试。
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
 * `onSessionCheckpoint` is invoked when the **silence window has expired**
 * AND the session has been re-confirmed idle (11 §6.1 的两步：活动之后须安静满
 * 一个安静时长). It receives `{ turn, source }` and is expected to return a
 * promise; the hook does not await it (the host event is a synchronous emit)
 * — rejections are logged and never escape into the host's event dispatch.
 *
 * `readSilenceMs()` 取安静时长（毫秒）；`persistActivityAt(ms)` 落持久化活动时刻
 * ——两者由编排层注入，使本模块不直接依赖配置读取与文件写入（可测）。
 *
 * `registerDiagnostic(entry)` 是**诊断痕迹**注入点（2026-10-23，2026-10-24 回退
 * 时保留）：每个到期早退分支与派发调用都落一条，使「到点了却没有派发」可事后
 * 归因。它是尽力而为的旁路——其异常绝不影响判定。
 *
 * 本模块**不持有任何宿主调度依赖**：计时器是进程内的，宿主服务缺失不影响武装
 * ——这正是 2026-10-24 回退要消除的耦合。
 */
export function createTurnTriggers(agent, { getScopeState, turns, activity, log, onSessionCheckpoint, readSilenceMs, persistActivityAt, now, registerDiagnostic }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;

  /**
   * 尽力而为地写一条日志——**日志绝不能影响控制流**。
   *
   * 存在的理由：`armSilenceTimer` 的到期回调在 `setTimeout` 顶层执行，那里一旦
   * 抛异常就会逃逸成未捕获异常（可能带崩进程）。而 logger 是外部注入的，它的
   * 实现未必不抛（参数序列化、被替换成抛错桩等），`log?.info?.()` 只防了「没有
   * log / 没有该方法」，防不住「方法自己抛」。故一律经本函数吞掉日志自身的
   * 异常——留痕是尽力而为，**派发判定不受它牵连**。
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

  /**
   * 落一条诊断痕迹（2026-10-23，尽力而为；2026-10-24 随回退保留在计时器路径上）。
   *
   * **为什么需要它**：到期早退此前只有 logger，而 logger 在 cordis 默认等级下
   * 可能根本不输出；于是「静默期到了却没有派发」事后无从归因（连续四次投递
   * 零运行记录、零待处置条目）。诊断痕迹写进运行记录，使每个分支都可被回读。
   */
  function trace(stage, reason, extra = {}) {
    if (typeof registerDiagnostic !== "function") return;
    try {
      Promise.resolve(registerDiagnostic({
        stage,
        reason,
        turn: state.lastTurn,
        at: new Date().toISOString(),
        ...extra,
      })).catch(() => { /* 诊断旁路不得打断机制 */ });
    } catch {
      // 同上：留痕失败不影响判定。
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
    // 正是被 11 §6.1 判为偏离的形态——宿主在回合刚结束时就报 idle，故那等于
    // 「回合结束即派发」，且待办位一经消费便不再置位，使**沉默越久越不会触发**。
    //
    // `lastActivityAt`：最后一次会话活动时刻（毫秒）。它是«空闲»判据的锚——
    // 与「上次派发时刻」是两个不同的量（前者问人是否停了，后者问机制跑得勤不勤）。
    // 由调度侧经 `persistActivityAt` 落持久化载体：只存内存态会在热重载后归零，
    // 使计时失真（要么刚重载就又触发，要么永远攒不满）。
    lastActivityAt: null,
    // 安静期计时器句柄（进程内 `setTimeout` 的返回值）；null 表示当前没有在计时。
    // **它是唯一的计时载体**（2026-10-24 回退后不再有宿主任务）。
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
    // **本回合是否仍在进行**（2026-10-23）：`turn/start` 置真、`turn/end` 置假。
    // 用途有二——回合开始时清掉计时器（对话进行中不倒计时），以及到期回调内
    // 的末道防线（事件落盘晚于事实时，到期回调仍不得派发）。
    turnInFlight: false,
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

  /** 清掉进程内计时器。**同步生效**——清完之后 `silenceTimer === null` 即可本地回读。 */
  function clearSilenceTimer() {
    if (state.silenceTimer !== null) {
      try {
        clearTimeout(state.silenceTimer);
      } catch {
        // 已失效的句柄：清不掉也没有残留的计时。
      }
      state.silenceTimer = null;
    }
  }

  /**
   * 刷新「最后一次活动时刻」并**重置**安静期（11 §6.1：计时自活动发生时重新开始）。
   *
   * 对话在继续时不得处于倒计时状态——故本函数必先清掉既有计时器。
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
   * 武装安静期计时：到期且**再次确认确已安静**后派发（11 §6.1 二次确认的实现）。
   *
   * **不重复武装已触发过的安静期**：`silenceFired` 为真时直接返回——这使
   * 「一次安静期至多触发一次」成立，并使失败后不会自动重试（§12）。
   *
   * **按「剩余安静时长」而非整段时长武装**（2026-10-19 独立审核）：原实现无条件
   * `setTimeout(fn, idleMs)`，于是恢复一个久远锚点后还要再白等一整个安静时长才
   * 轮到到期判定——而 11 §6.1 的判据是「距最后一次会话活动已持续不短于安静
   * 时长」，该判据当时**已经被满足**。延迟取剩余量即可。
   */
  function armSilenceTimer() {
    // **销毁是终局**：`dispose()` 之后不得再武装。这条检查**可达**——`onAgentStatus`
    // 收到 idle 就会调本函数，而宿主在会话卸载途中仍可能派发状态事件；不拦的话，
    // 已销毁的对象会重新得到计时器，到期后对死对象派发一次。
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
      // 到期时**再确认**一次（11 §6.1 的二次确认）：
      //   ① 回合进行中不得派发——事件落盘可能晚于事实，故此处独立再判；
      //      此处**不重排**：回合结束时会重启计时（§6.3 硬约束）。
      //   ② 期间若有过新活动，计时已被 `touchActivity` 清掉，本回调不会走到这里；
      //      保留 `quietFor` 判定是为兜住时钟与事件交错的残余情形。
      if (state.disposed === true) {
        trace("silence-expiry", "disposed");
        return;
      }
      if (state.turnInFlight === true) {
        note("info", "[dsh-ldvh] silence timer expired during a running turn: refusing to dispatch");
        activity?.record("session/checkpoint/refused-turn-in-flight", { turn: state.lastTurn });
        trace("silence-expiry", "turn-in-flight");
        return;
      }
      const current = state.lastActivityAt;
      if (current === null) {
        note("info", "[dsh-ldvh] silence timer expired but no activity anchor exists: nothing to confirm");
        trace("silence-expiry", "no-activity-anchor");
        return;
      }
      const quietFor = nowMs() - current;
      if (quietFor < idleMs) {
        note("info", "[dsh-ldvh] silence timer expired but NOT quiet enough: quietFor=%dms threshold=%dms — re-arming", quietFor, idleMs);
        trace("silence-expiry", "not-quiet-enough", { quietFor, idleMs });
        armSilenceTimer();
        return;
      }
      if (!governed()) {
        note("warn", "[dsh-ldvh] silence timer expired but the scope is no longer governed: no checkpoint dispatched");
        trace("silence-expiry", "not-governed");
        return;
      }
      state.silenceFired = true; // 先置位：此后除非有新活动，不得再触发
      trace("silence-expiry", "dispatching", { quietFor });
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
    // 诊断痕迹（2026-10-23）：证明 dispatchCheckpoint 被调用过。若只有本条而无
    // 运行记录，真凶在 onSessionCheckpoint 内部的静默 return；若连本条都没有，
    // 真凶在 dispatchCheckpoint 之前。
    trace("dispatch-called", source);
    try {
      Promise.resolve(onSessionCheckpoint({ turn: state.lastTurn, source })).catch((error) => {
        // 调度本身失败不等于辅助任务失败：任务内部的 fail-closed 由执行体与
        // 待处置队列承担（04 §8.3）。这里只保证异常不污染宿主的事件分发。
        log?.warn?.("[dsh-ldvh] idle checkpoint dispatch failed: %s", String(error?.message ?? error));
        trace("dispatch-rejected", source, { error: String(error?.message ?? error) });
      });
    } catch (error) {
      log?.warn?.("[dsh-ldvh] idle checkpoint dispatch threw synchronously: %s", String(error?.message ?? error));
      trace("dispatch-threw", source, { error: String(error?.message ?? error) });
    }
  }

  return {
    /**
     * agent/turn-stopping — 会话活动（触发的**计时起点**）。
     *
     * **2026-10-14 语义变更（11 §6.1 修订）**：本事件不再「置位一次待办」而由
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
      // **只接受真实的轮次号**：没有 `turn` 的载荷不得抹掉已记下的轮次号，
      // 否则「区间上界」与「重启后回填」全部失效。
      if (typeof payload?.turn === "number") state.lastTurn = payload.turn;
      // Gate: 未受管辖时不清点，也不排期——受管辖是 11 §4 运行的前提。
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
     * 现行（11 §6.1）：本事件只负责在受管辖且确有活动的情况下**武装安静期计时**；
     * 真正的派发由计时器到期时发出。故此处不再有 `checkpointPending` 的置位/消费。
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
      if (state.turnInFlight === true) return;   // 回合仍在进行：不得武装（§6.1）
      armSilenceTimer();
    },

    /** session/event — turn boundary bookkeeping. */
    onSessionEvent(session, event) {
      // D1：把区间材料在**调度侧**机械累积（不读会话日志、不用弃用 API——
      // 与 child.js 同模式：只消费已发布事件）。累积先于一切 return，使所有
      // 类型的事件都能被看到。
      try {
        accumulator.observe(session, event, agent?.session);
      } catch (error) {
        log?.warn?.("[dsh-ldvh] window accumulation failed: %s", String(error?.message ?? error));
      }
      // **回合开始 = 暂停计时**（11 §6.1，2026-10-23 纪律，2026-10-24 随载体保留）：
      // 清掉进程内计时器，使对话进行中不存在倒计时。清理是同步的，清完
      // `silenceTimer === null` 可本地回读——不再有「撤掉未生效」的残留窗口。
      if (session === agent?.session && event?.type === "turn/start") {
        state.turnInFlight = true;
        clearSilenceTimer();
        activity?.record("turn/start", { turn: eventTurn(event) ?? state.lastTurn });
        return;
      }
      if (session !== agent?.session || event?.type !== "turn/end") return;
      state.turnEndSeen += 1;
      state.turnInFlight = false;
      state.lastTurn = eventTurn(event) ?? state.lastTurn;
      // **会话活动**（2026-10-14）：`turn/end` 也是活动——它同时是区间材料的
      // 结算点。此处刷新活动时刻（重置安静期），使「对话还在进行」不会被误判为
      // 安静。与 `onTurnStopping` 的刷新**不冲突**：两者都表示「有人在说话」，
      // 任一发生都应重置计时（取最后发生者为准）。
      if (governed()) {
        touchActivity(nowMs());
        // **回合结束 = 重启计时**（11 §6.1）：按「结束时刻 + 安静时长」重新武装。
        // 不依赖 `agent/status:idle` 单独武装——宿主只在 status **变化**时发事件，
        // 一个已 idle 的会话不会再发一次 idle。
        armSilenceTimer();
      }
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
     * 清计时器（会话结束 / 插件卸载时由 lifecycle 的清理函数调用）。
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
     * **恢复后必须重新武装**：回退后宿主侧不存在「随时会到点」的载体，不武装的话
     * 该会话要等下一次真实的回合结束才会重新计入。恢复出来的锚点本就是「最后
     * 一次活动时刻」，安静时长自它起算；到期时点由 `armSilenceTimer` 按**剩余量**
     * 直接算出，故久远锚点会立即到期，随后由到期再确认判为「已足够安静」并派发，
     * 不白等一个完整安静时长。
     *
     * **本函数不写任何宿主侧占位**：唯一的计时载体是进程内计时器。
     *
     * 本函数由 lifecycle 的 **fire-and-forget** 异步旁路调用（该 IIFE 中间有两次
     * `await`，期间会话可能已被销毁或已有新的真实活动）。故必须满足三条：
     *
     * 1. **锚点单调**：只接受比当前更新的时刻。陈旧快照不得覆盖运行时已更新的
     *    锚点——否则「刚活动过的会话」会被以陈旧锚点误判为「已安静很久」并派发。
     * 2. **先清后武装**：`clearSilenceTimer()` 再 `armSilenceTimer()`，保证计时器
     *    与锚点**同源**。
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
      note("info", "[dsh-ldvh] activity anchor restored from %s; silence timer re-armed", new Date(n).toISOString());
    },

    /**
     * 恢复「最后一个已知轮次」（由 lifecycle 在派发时回填，见 onSessionCheckpoint）。
     *
     * **为什么需要它**（2026-10-19）：`lastTurn` 只在回合边界事件里被赋值
     * （`onTurnStopping` 的载荷、`onSessionEvent` 的 `turn/end`），**没有任何
     * 持久化载体**。于是进程重启/插件热重载之后，只要该会话尚未开启新回合，
     * `lastTurn` 就是 `undefined`；安静期到期时派发拿不到区间端点，按 11 §12
     * fail-closed——重启后的第一次闲时派发**必然**失败。
     *
     * 位置来源只能是宿主会话记录（11 §11「切分依据只能是宿主会话记录中的位置」），
     * 由调用方读好后经本函数写回。本函数**不自己读**：triggers 只拿会话事件，
     * 没有持久化依赖，让计时器模块去读日志会把「调度判据」与「材料来源」混在一起。
     *
     * 两条纪律与 `restoreActivityAt` 同构（外加一条前置的类型校验）：
     *
     * 1. **不覆盖已定义值**：`lastTurn` 已有值时一律不动。本函数只服务「重启后
     *    尚无任何回合」这一种情形，不该成为另一条写 `lastTurn` 的通道。
     * 2. **不抛**：调用方是 fire-and-forget 旁路；此处若抛，内部状态已变（半提交）。
     *    非法轮次号一律拒不采纳而非抛错。
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
