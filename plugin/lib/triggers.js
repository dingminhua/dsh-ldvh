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
//   agent/turn-stopping      session activity + turn bookkeeping        [ACTIVE]
//   agent/status             idle → observation counter (NOT a trigger) [ACTIVE]
//   session/event turn/end   turn-close bookkeeping + activity refresh  [ACTIVE]
//   agent/disposed           (fiber-owned cleanup — no hook needed)     [implicit]
//
// 触发判据（11 §6.1，**2026-11-17 修订**）：**触发锚是主控发起**。主控在当次
// 行动中判定出现阻碍现象时，整理材料并经 `requestCheckpoint()` 交派一个执行体；
// 本模块**不再有任何计时器、安静时长、到期二次确认或周期调度**。
//
// 故本模块现在的形态是：
//   - `agent/turn-stopping` / `session/event turn/end`：刷新活动时刻、记账轮次
//     与区间材料（**不再武装任何计时**）；
//   - `agent/status: idle`：只记一次观察计数，**不派发**；
//   - `requestCheckpoint(source)`：**唯一的派发入口**，由主控显式调用。
//
// **为什么计时器整体删除、而不是留作退路**（11 §6.1）：计时器的语义是「没人盯着
// 时也要跑」，主控发起的语义是「主控在干活时顺带发现」。两者并存会产生**第二套
// 观察来源**——同一阻碍被两侧各记一次，而两侧的观察区间与 group 键互不知情，
// 于是同源阻碍被拆成两组、阈值永远凑不满。11 §19.1 第 3 项禁止恢复任何周期触发
// 形态（含计时器、静置检查点、宿主定时任务或任何等效结构）；**保留一个恒不触发
// 的计时器同样不算合规**，那会让「机制还在、只是不起作用」成为表面事实。
//
// **随之删除的四套纪律**（其规范对象已不存在，不是被放宽）：安静时长取值、到期
// 二次确认、一次安静期至多触发一次、重启使安静期作废。原「重启后按旧锚点重建
// 计时」曾导致每次插件重载/重开旧对话都在同一早已结束的安静期上再触发一次
// （实测 quietFor 达 44–166 小时）；该缺陷随计时器删除而整体消失。
//
// **本形态的代价如实登记**：观察频次由主控的行动密度决定，不再由时间决定；主控
// 当次未判定出的阻碍**当次不被记录**，且不存在事后补扫通道。攒不够 N=3 即留在
// 缓冲，不构成失败（11 §6.1 发起侧纪律第 4 条）。
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

// 2026-11-17：原「审核周期任务投递识别」（`HOST_REMINDER_FRAMING` /
// `REVIEW_DELIVERY_TAG` / `isReviewDelivery` / `textOfMessageContent`）已整体删除。
//
// 它识别的是宿主把到期任务渲染成 `[SCHEDULE REMINDER]` 投进会话的那条投递，
// 用于让该回合走「审核路径」而不是安静期路径。两个前提都已不存在：审核层整层
// 删除（2026-11-16），计时器与静置检查点删除（2026-11-17）。留着它会让读者以为
// 仍有一条「宿主定时投递 → 审核」的通道。

/**
 * Create the turn-level trigger set for one agent.
 * `getScopeState()` reads the lifecycle's current judged state; `turns` is
 * the marker object owned by the AgentLifecycle (single per-agent home —
 * falls back to a local one for direct/test usage); `activity` optionally
 * receives hook-action entries. `log` is the host logger.
 *
 * `onSessionCheckpoint` 由 **`requestCheckpoint()`** 调用——即主控在当次行动中
 * 发现阻碍时显式发起（11 §6.1「触发锚是主控发起」，2026-11-17）。它收到
 * `{ turn, source }` 并返回 promise；本模块不 await（宿主事件是同步 emit），
 * 拒绝被收口为日志，绝不逃逸进宿主的事件分发。
 *
 * `persistActivityAt(ms)` 落持久化活动时刻（留作事后复算的材料，**不被读回重建
 * 计时**）；由编排层注入，使本模块不直接依赖文件写入（可测）。
 * **`readSilenceMs` 已不再被消费**：没有计时器就没有安静时长可取；该形参若仍被
 * 传入也不产生任何效果（triggers-idle.test.mjs 钉住这一点）。
 *
 * `registerDiagnostic(entry)` 是**诊断痕迹**注入点（2026-10-23，2026-10-24 回退
 * 时保留）：每个到期早退分支与派发调用都落一条，使「到点了却没有派发」可事后
 * 归因。它是尽力而为的旁路——其异常绝不影响判定。
 *
 * 本模块**不持有任何宿主调度依赖**：计时器是进程内的，宿主服务缺失不影响武装
 * ——这正是 2026-10-24 回退要消除的耦合。
 */
/**
 * 判定一次计时器清理是否成立——**纯函数，便于用失败输入钉住它**。
 *
 * 抽取自 `clearSilenceTimer`（2026-11-03 第五轮复核后）：此前该判定写在闭包里，
 * 外部只能观察成功路径，于是「把结论硬编码为 true」这种退化解无法被测试发现
 * （实测变异 A 全绿）。抽成纯函数后可以喂入失败输入，护栏才有意义。
 *
 * @param {object} a
 * @param {boolean} a.hadTimer 清理时是否真有计时器
 * @param {boolean} a.slotEmpty 清理后状态槽是否为空
 * @param {number|null} a.handleIdleTimeout 句柄的 `_idleTimeout`（取消后为 -1）
 * @param {boolean|null} a.handleDestroyed 句柄的 `_destroyed`
 * @returns {{handleCleared: boolean, idleCancelled: boolean}}
 */
// 2026-11-17：`judgeClear` 已删除。
//
// 它的全部语义是「判断安静期计时器的句柄是否真被清理」（三重观察：状态槽已空、
// `_idleTimeout === -1`、`_destroyed !== false`）。计时器随触发锚改为主控发起而
// 删除后，没有句柄可观察，该判定失去输入。
//
// **不得保留一个恒返回 `{handleCleared: true}` 的空壳**：那会让 §18 的「延迟的
// 取消」一行看起来仍被机械采集，而实际上没有任何东西可失败——这正是本仓反复
// 记载的「空壳机制」失效形态。

export function createTurnTriggers(agent, { getScopeState, turns, activity, log, onSessionCheckpoint, readSilenceMs, persistActivityAt, now, registerDiagnostic }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;

  /**
   * 尽力而为地写一条日志——**日志绝不能影响控制流**。
   *
   * 存在的理由：诊断与派发路径上有若干 fire-and-forget 的回调，那里一旦
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
  /** 在飞的诊断写入（供 `dispose()` 排空，见下）。 */
  const pendingDiagnostics = new Set();

  function trace(stage, reason, extra = {}) {
    if (typeof registerDiagnostic !== "function") return;
    try {
      const p = Promise.resolve(registerDiagnostic({
        stage,
        reason,
        // **会话位置标识**（2026-11-03 补）：此前 trace 只写 stage/reason/turn/at，
        // 运行记录里没有会话标识，于是「同一时点出现两份 dispatching」无法归因到
        // 具体会话——是同一会话装了两套触发器，还是两个会话各自到期？前者违
        // 11 §6.1「不得在同一目标时刻上反复触发」，后者是正常并发，两者在痕迹上
        // 完全同形（实测 2026-11-02 的 50 条记录即卡在这里）。补上 agent_id 后该
        // 歧义可事后分辨。**它是诊断材料，不参与任何判定**（§6.1 的判据仍只有
        // 静置到期与无同类检查在执行两项）。
        session: typeof agentId === "string" && agentId.length > 0 ? agentId : null,
        turn: state.lastTurn,
        at: new Date().toISOString(),
        ...extra,
      })).catch(() => { /* 诊断旁路不得打断机制 */ });
      // **登记在飞写入**（2026-11-03 第四轮复核修正）。
      //
      // 诊断本是 fire-and-forget，但测试与宿主退出会紧跟一次目录清理；
      // 写入尚未落盘就开始 `rm -r` 会撞出 ENOTEMPTY（实测：新增 silence-cleared
      // 记录后，recall/activation 两组测试各挂 1–2 项，且只在有计时清理时复现）。
      // 这不改「不打断机制」的性质：写入失败仍只吞掉，`dispose` 只等它**结束**。
      pendingDiagnostics.add(p);
      Promise.resolve(p).finally(() => pendingDiagnostics.delete(p));
    } catch {
      // 同上：留痕失败不影响判定。
    }
  }

  const state = turns ?? {
    turnStoppingSeen: 0,
    turnEndSeen: 0,
    lastTurn: undefined,
    lastReflectionGate: undefined,
    // ── 触发判据沿革：idle+待办位 → 安静期计时 → **主控发起**（2026-11-17）──
    //
    // `checkpointPending` 已**删除**：它服务的旧语义（「检查点到达」由 idle 消费）
    // 正是被 11 §6.1 判为偏离的形态——宿主在回合刚结束时就报 idle，故那等于
    // 「回合结束即派发」，且待办位一经消费便不再置位，使**沉默越久越不会触发**。
    //
    // `lastActivityAt`：最后一次会话活动时刻（毫秒）。它是«空闲»判据的锚——
    // 与「上次派发时刻」是两个不同的量（前者问人是否停了，后者问机制跑得勤不勤）。
    // **只在内存**（2026-10-27，Human 决定）：不再由装载路径恢复。持久化写入仍在
    // （`persistActivityAt` 落水印载体，留作事后复算「本次是否满足所声明的时机」的
    // 材料——注意：截至 2026-10-27 仓内没有它的生产读取面，不得据此声称诊断页已消费），
    // 但**不再被读回来重建计时**——理由见文件头「重启使安静期作废」段。
    lastActivityAt: null,
    // 原安静期计时器句柄位。**恒为 null**（2026-11-17 计时器已删除）；保留该键
    // 只为让既有清理路径与快照读法不至于读到 undefined，不得再被写入句柄。
    silenceTimer: null,
    // **已销毁**：`dispose()` 置真后不得再武装。存在的理由见 `dispose()`：宿主在
    // 会话卸载途中仍可能派发状态事件，若无此标记，已销毁的对象会重新得到计时器，
    // 到期后对死对象派发一次。
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

  // 2026-11-17：`silenceMs()` 已删除——没有计时器，就没有「安静时长」可取。

  /**
   * 清掉进程内计时器。**同步生效**——清完之后 `silenceTimer === null` 即可本地回读。
   *
   * ## 为什么要在这里落一条回读记录（2026-11-03）
   *
   * 11 §18「延迟的取消（回合开始即清掉计时）」的可接受依据，原文写的就是
   * **「清理后的本地回读（句柄为空）」**。该回读此前**只存在于这个函数里的
   * 一行赋值**，没有任何载体把它带出运行期——于是审核运行结束时无从判定该行，
   * 只能记「缺证据」。回读本身一直在做，缺的只是把结论登记下来。
   *
   * 故清理后**立刻回读** `state.silenceTimer === null`，并把结果作为
   * `handleCleared` 随诊断记录带出。这不是新增判据，而是给已有的回读结果一个载体。
   */
  /**
   * 原「清理安静期计时器并采集清理证据」已随计时器删除（2026-11-17）。
   *
   * **为什么保留这个空壳**：`touchActivity`、`turn/start`、`dispose` 三处仍调用它
   * （共 4 个调用点）。计时器不再武装，故这里无事可做——`state.silenceTimer`
   * 恒为 null，没有句柄可清、也没有「清理是否生效」可采集。
   *
   * **为什么不留 `judgeClear`**：那个函数的全部语义是「判断计时器句柄是否真被
   * 清理」。没有计时器，它无从判断；留一个恒真实现会让读者以为清理仍被采集，
   * 这正是本仓反复记载的「空壳机制」失效形态（friction-277d7479 同族）。
   */
  function clearSilenceTimer(reason) {
    // 计时器已不再武装（见 armSilenceTimer），无句柄可清。
    state.silenceTimer = null;
    // **仍留一条诊断**：`dispose()` 需要一条「排空期内在飞的落盘写入」，否则
    // 「stop 会等待写入落盘」这件事无从观测，调用方（含测试）在 dispose 后立刻
    // 清目录就会撞 ENOTEMPTY。它记录的是「清理动作被要求过」这一事实，**不是**
    // 「计时器被清掉了」——后者随计时器一并消失，不得在这条记录里暗示。
    trace("silence-cleared", reason ?? "cleared", { timerPresent: false });
  }

  /**
   * 刷新「最后一次活动时刻」（11 §6.1）。
   *
   * **不再重置任何计时**（2026-11-17 计时器已删除）：本函数只记活动时刻并落
   * 持久化戳，供事后复算材料时机；`clearSilenceTimer` 的调用是空转清理。
   */
  function touchActivity(nowMsInput) {
    const at = Number.isFinite(nowMsInput) ? nowMsInput : nowMs();
    state.lastActivityAt = at;
    clearSilenceTimer("activity");
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
   * 原「武装安静期计时器」已整体删除（2026-11-17，11 §6.1「触发锚是主控发起」）。
   *
   * **为什么连函数体一起删、而不留一个早退的空壳**：空壳会让「计时机制还在、只是
   * 不起作用」成为表面事实，而 11 §6.1 明文「保留一个恒不触发的计时器不算合规」。
   * 计时器与主控发起是**语义互斥**的两种形态：并存会产生第二套观察来源，同一阻碍
   * 被两侧各记一次、而两侧的 group 键可能不同，于是同源阻碍被拆成两组、阈值永远
   * 凑不满。11 §19.1 第 3 项禁止恢复任何周期触发形态（含计时器、静置检查点、宿主
   * 定时任务或任何等效结构）。
   *
   * **函数名保留为空操作**：`onAgentStatus` / `onSessionEvent` 仍在调用它。保留一个
   * 明确标注「无计时器可武装」的空函数，比让调用点指向 undefined 安全；它**不做任何
   * 事**，也不得被重新填回计时逻辑（triggers-idle.test.mjs 的守卫会失败）。
   */
  function armSilenceTimer() {
    // 无计时器可武装：派发只由主控经 requestCheckpoint 发起。
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
     * idle 消费，而是**刷新「最后一次会话活动时刻」**（2026-11-17 起不再武装计时）。
     * 原实现把它当「检查点已到达」的标记，真正的调度由 `agent/status:idle`
     * 触发——而宿主在**回合刚结束**时即进入 idle，故那等于「回合一结束就可能派发」，
     * 拿到的增量往往只有一两轮（实测 1923–7098 字符）。
     *
     * 现行判据（§6.1，2026-11-17）：**触发锚是主控发起**。本事件只刷新活动时刻
     * 与轮次记账，**不派发、不武装任何计时**。
     */
    onTurnStopping(payload) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return;
      state.turnStoppingSeen += 1;
      // **只接受真实的轮次号**：没有 `turn` 的载荷不得抹掉已记下的轮次号，
      // 否则「区间上界」与「重启后回填」全部失效。
      if (typeof payload?.turn === "number") state.lastTurn = payload.turn;
      // Gate: 未受管辖时不清点，也不排期——受管辖是 11 §4 运行的前提。
      state.lastReflectionGate = governed() ? "open" : "closed";

      // 2026-11-17：原「审核投递回合 → 走审核路径」分支已删除（审核层与计时器均已不存在）。

      if (state.lastReflectionGate === "open") {
        // 受管辖：刷新活动时刻（仅记账；不再重置任何计时）。
        touchActivity(nowMs());
      }
      activity?.record("turn/stopping", { turn: state.lastTurn, gate: state.lastReflectionGate });
    },

    /**
     * agent/status — **不是触发点**（2026-11-17：连「武装计时的时机」也不是了）。
     *
     * 宿主对 `idle` 的语义是「no driver remains scheduled or active」——它说明
     * **此刻没有在跑的驱动**，但**不说明会话已安静多久**。原实现把该事件直接当作
     * 二次确认的成立点并立即派发，于是「回合刚结束」与「闲置两小时」得到相同的
     * 待遇（都算「已空闲」），而后者反而**永不触发**（原实现的待办位已被首次
     * idle 消费、且 idle 是迁移事件不会重放）。
     *
     * 现行（11 §6.1，2026-11-17）：本事件只记一次 idle 观察计数。真正的派发由
     * 主控经 `requestCheckpoint()` 发起。故此处既无 `checkpointPending`，也无计时。
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
        // 11 §18「延迟的取消（回合开始即清掉计时）」——这条路径正是该行所指。
        clearSilenceTimer("turn-start");
        activity?.record("turn/start", { turn: eventTurn(event) ?? state.lastTurn });
        return;
      }
      if (session !== agent?.session || event?.type !== "turn/end") return;
      state.turnEndSeen += 1;
      state.turnInFlight = false;
      state.lastTurn = eventTurn(event) ?? state.lastTurn;
      // **会话活动**（2026-10-14）：`turn/end` 也是活动——它同时是区间材料的
      // 结算点。此处刷新活动时刻（仅记账）。与 `onTurnStopping` 的刷新**不冲突**：
      // 两者都表示「有人在说话」，取最后发生者为准。
      if (governed()) {
        touchActivity(nowMs());
        // 2026-11-17：原「回合结束 = 重启计时」已删除——没有计时可重启。
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
     * 取**当前轮**已累积的 assistant 正文（弱约束的判断依据，specs/06 §6）。
     *
     * 为什么需要它：`ldvh_review_ask` 的行动前那处，其前置时点是「方案已有候选、
     * 尚未产生副作用」（32 §6.1）。此前这道约束只有提示文本，实测两次复发——
     * 2026-11-14 修过一次（commit cfff33a3 加的正是「尚无候选方案时不得发起」），
     * 之后仍然违反。
     *
     * **为什么不是机械闸**：`06 §5` 规定「被区分对象在形式上不可分时（同一字形
     * 承载不同语义），不得以机械校验强制执行；此时改用弱约束」。实测语料 53 次
     * pre-action 调用、52 次带 claims，claims 逐字出现在同轮正文的为 **0 次**；
     * 整轮正文为空 **0 次**（最小 119 字）。即：任何「正文里必须有候选」的闸都会
     * 100% 误拒合法询问，而对真正的空问 0 拦截力（模型空问时正文照样长篇）。
     * 因此本入口只**交还依据**，不判定对错（06 §6 末句）。
     *
     * **为什么不读会话日志**：宿主活事件先进 200ms 批处理缓冲
     * （`dsh-session-persistence-jsonl/storage.ts` 的
     * `LIVE_WRITE_BATCH_MAX_DELAY_MS`），而工具执行发生在 `assistant/message`
     * append 后数毫秒内——磁盘上通常还没有本步正文。本累积器消费的是
     * `session/event` 活事件（零延迟），故此刻读得到。
     *
     * @param {number} [turn] 轮次；省略则取缓冲里已知的最大轮次
     * @returns {{ok: boolean, turn: number|null, assistant: string, truncated: boolean, reason?: string}}
     */
    currentTurnText(turn) {
      const target = Number.isInteger(turn) ? turn : accumulator.highestTurn();
      if (target === null || target === undefined) {
        return {
          ok: false, turn: null, assistant: "", truncated: false,
          reason: "this process has not observed any assistant message yet, so the current turn's text is unavailable (the live event stream has not reached this session)",
        };
      }
      // `windowFrom(target - 1)` 恰好只返回 target 这一轮（`filter(turn > floor)`）。
      const window = accumulator.windowFrom(target - 1);
      const item = window.items.find((entry) => entry.turn === target);
      return {
        ok: true,
        turn: target,
        assistant: typeof item?.assistant === "string" ? item.assistant : "",
        truncated: item?.truncated === true,
      };
    },

    /**
     * 清计时器（会话结束 / 插件卸载时由 lifecycle 的清理函数调用）。
     *
     * **不清 `lastActivityAt`**：它是事后复算的材料，不随轮次边界清空。（原
     * `silenceFired` 的说明随计时器删除而失效——该键现已无消费方。
     * 随对象销毁自然消失。清理只负责不留下「进程已退出仍在计时的定时器」这一
     * 泄漏，不对任何已发生的派发构成撤回（11 §6.1）。
     */
    /**
     * 测试缝：直接触发一次计时器清理并返回回读结论。
     *
     * 该函数此前**没有任何测试触达**，于是第五轮复核用变异证明：把
     * `handleCleared` 改成不看 `slotEmpty`、或删掉句柄观察，全量套件仍全绿——
     * 本轮头号修复「采集侧不再自证」没有任何回归护栏。本缝就是为补上它而开。
     * 生产代码不调用它。
     */
    clearSilenceTimerForTest(reason = "test") {
      return clearSilenceTimer(reason);
    },

    dispose() {
      state.disposed = true; // 之后的 idle 事件一律不得再武装
      clearSilenceTimer("dispose");
      // **排空在飞的诊断写入**：调用方（含测试）常在 dispose 后立刻清理目录，
      // 不等这些写入落盘就会撞出 ENOTEMPTY。返回 Promise 使 await dispose()
      // 真正意味着「连同诊断在内都结束了」；不 await 的调用方行为不变。
      return Promise.allSettled([...pendingDiagnostics]);
    },

    // **`restoreActivityAt` 已删除（2026-10-27，Human 决定）**。
    //
    // 它原名 `restoreActivityAt(ms)`：装载时由 lifecycle 把持久化的活动时刻读回来，
    // 写入 `lastActivityAt`、复位 `silenceFired`、再「先清后武装」。删除的理由不是
    // 「恢复锚点」这件事本身，而是它**同时恢复了计时**：旧锚点的剩余量恒为 0，于是
    // 每装载一次就在同一个早已结束的安静期上再触发一次——而 11 §6.1 明文规定
    // 「一次触发完成后该形态的本次计时即告结束……不得在同一目标时刻上反复触发」。
    //
    // **不再提供「装载时恢复锚点」的替代入口**：计时起点只剩一个——**回合结束**。
    // 持久化的活动时刻仍由 `persistActivityAt` 写入（留作事后复算时机的材料；仓内
    // 当前无生产读取面，见 state 处的同一条说明），但不被读回内存。**不要为了「重启后接着计时」把它加回来**：那会把已经花掉的
    // 安静期重新变成待触发的，缺陷原样复现，且表面症状是「打开旧对话就派发」。

    /**
     * 恢复「最后一个已知轮次」（由 lifecycle 在派发时回填，见 onSessionCheckpoint）。
     *
     * **为什么需要它**（2026-10-19）：`lastTurn` 只在回合边界事件里被赋值
     * （`onTurnStopping` 的载荷、`onSessionEvent` 的 `turn/end`），**没有任何
     * 持久化载体**。于是进程重启/插件热重载之后，只要该会话尚未开启新回合，
     * `lastTurn` 就是 `undefined`；主控发起派发时拿不到区间端点，按 11 §12
     * fail-closed——重启后的第一次闲时派发**必然**失败。
     *
     * 位置来源只能是宿主会话记录（11 §11「切分依据只能是宿主会话记录中的位置」），
     * 由调用方读好后经本函数写回。本函数**不自己读**：triggers 只拿会话事件，
     * 没有持久化依赖，让计时器模块去读日志会把「调度判据」与「材料来源」混在一起。
     *
     * 两条纪律（外加一条前置的类型校验）：
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

    /**
     * **主控发起一次检查点**（2026-11-17，11 §6.1「触发锚是主控发起」）。
     *
     * 这是计时器删除后**唯一的派发入口**：主控在当次行动中发现阻碍或已查明验证的
     * 失败机制时，调本方法把材料交给检查点，由它派代理去处理。
     *
     * 参数 `source` 只用于留痕与事后归因，**不参与任何判据**——不存在「某些 source
     * 才允许派发」的白名单，也不存在基于时间的节流（11 §6.2 现为空集）。调用方
     * 给什么就记什么，使痕迹能回答「这一次是谁发起的」。
     *
     * **本方法不判定「值不值得记」**：那是主控的判断（00 §4.5 代理辅助任务），
     * 机械层不判定。此处只做「把请求送进检查点」这一件事，并把异常收口为日志
     * ——与 dispatchCheckpoint 同一纪律，不使调度失败污染调用方。
     *
     * @param {string} [source] 发起来源标签（缺省 `"controller"`）
     * @returns {boolean} 是否真的送进了检查点（无回调时 false）
     */
    requestCheckpoint(source = "controller") {
      if (state.disposed === true) return false;
      if (typeof onSessionCheckpoint !== "function") return false;
      dispatchCheckpoint(source);
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
