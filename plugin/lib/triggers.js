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
// 触发判据（11 §6.1）：「会话确已空闲」= **距最后一次会话活动已持续不短于
// 安静时长**。故本模块的形态是：
//   - `agent/turn-stopping` / `session/event turn/end`：**刷新活动时刻并重置**
//     安静期计时（对话在继续就不倒计时）；
//   - `agent/status: idle`：**只负责武装**计时（宿主 idle 说明「此刻没有在跑的
//     驱动」，但**不说明会话已安静多久**，故它本身不是触发的成立点）；
//   - 计时到期且**再次确认确已安静** → 调度辅助任务。
//
// **计时由宿主承载，本模块不自建计时器**（2026-10-22，11 §6.1 「实现侧不得自行
// 维护计时器」）。原先用 `setTimeout` + `silenceTimer` 自建状态机，三处固有缺陷
// 无法在进程内修掉：
//   ① **宿主重启即丢**：内存计时器随进程消失，而「安静了多少」是跨重启的事实；
//   ② **热重载即断**：插件重载后计时归零，只能靠 `restoreActivityAt` 旁路补救，
//      而该旁路本身受 fire-and-forget 时序影响（历史上就因此空转过）。
//   ③ **与宿主定时器并存**：进程内多一个不受宿主调度排序、不受宿主取消语义管辖
//      的计时源，其到期时刻与宿主的「到期成员重新核对」互不知情。
// 现改为：把「活动时刻 + 安静时长」换算成一个**绝对时点**交给宿主调度服务
// （`ctx.schedule`），到期由宿主经 `followup()` 投递回本会话；届时**仍再确认一次
// 确已安静**（宿主的定时器不保证精确到点，也不保证不与新活动交错）。
//
// `at` 是唯一可选的选择器：它的语义是「严格未来的绝对时点」，且**可原地更新**
// （`after_seconds` 只能创建、不可更新，用它做「每次活动就顺延」等于每次新建一条，
// 必然在宿主任务表里留下垃圾）；绝对时点同时天然跨重启存活。
//
// 为什么改掉旧形态（两句都须记住，它们是同一缺陷的两面）：
//   ① 旧实现以 `agent/status:idle` 直接派发 → 宿主在**回合刚结束**时就报 idle，
//      故它等于「回合结束即派发」，切出的增量往往只有一两轮；
//   ② 旧实现在 turn-stopping 置一个「待办位」、由首个 idle 消费 → 该位一经消费
//      便不再置位，而 idle 是**迁移事件**不会在持续空闲期重放，故**沉默越久反而
//      越不会触发**，更长的增量永远不会被观察。
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
 * 本次回合的用户消息**是否就是本插件投放的安静期任务**。
 *
 * **为什么必须识别**：宿主把到期任务渲染成 `[SCHEDULE REMINDER]` 投进收件箱，
 * 它随即开启一个新回合（`turn/start`）。若不识别，这个新回合会被算作「会话
 * 活动」，把刚到期的那段安静期重置掉——于是「安静期满 → 宿主投递 → 又被判为
 * 有人说话 → 作废 → 重新静默」，永远触发不了。这是把计时交给宿主之后必然
 * 出现的新问题，且它**只在真实宿主上出现**（单元测试里没有收件箱）。
 *
 * **判据只是「标记 + 本插件标签」**：宿主框架是稳定的
 * （`renderReminderFraming` 的第一行是字面量 `[SCHEDULE REMINDER]`），用户自
 * 己写的消息也可能以它开头——所以还要求正文里带着本插件独有的 `LDVH_SILENCE_TAG`。
 * 两者同时成立才认作本插件投放，避免把用户真正发来的长消息误判为投递。
 */
const HOST_REMINDER_FRAMING = "[SCHEDULE REMINDER]";
const SILENCE_TAG_MARK = "dsh-ldvh:session-silence";

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block !== null && typeof block === "object" && block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
}

function isOwnSilenceDelivery(userMessage) {
  if (userMessage === null || userMessage === undefined) return false;
  const text = textOfContent(userMessage.content ?? userMessage);
  return text.startsWith(HOST_REMINDER_FRAMING) && text.includes(SILENCE_TAG_MARK);
}

/**
 * Create the turn-level trigger set for one agent.
 * `getScopeState()` reads the lifecycle's current judged state; `turns` is
 * the marker object owned by the AgentLifecycle (single per-agent home —
 * falls back to a local one for direct/test usage); `activity` optionally
 * receives hook-action entries. `log` is the host logger.
 *
 * `onSessionCheckpoint` is invoked when a **session checkpoint** has arrived
 * AND the session has been confirmed idle (11 §6.1 的两步：活动之后须安静满
 * 一个安静时长). It receives `{ turn, source }` and is expected to return a
 * promise; the hook does not await it (the host event is a synchronous emit)
 * — rejections are logged and never escape into the host's event dispatch.
 *
 * `readSilenceMs()` 取安静时长（毫秒）；`persistActivityAt(ms)` 落持久化活动时刻
 * ——两者由编排层注入，使本模块不直接依赖配置读取与文件写入（可测）。
 *
 * `scheduler` 是**宿主调度服务的适配器**（形态见 `createHostScheduler`），由编排层
 * 注入 `ctx.schedule` 后构造。本模块只通过它把「安静期的到期时点」交给宿主，不持有
 * 任何进程内计时器（11 §6.1）。未注入或宿主服务不可用时按 §12 fail-closed——不派发、
 * 只如实登记「宿主调度不可用」，**不得回落到自建计时器**。
 */
export function createTurnTriggers(agent, { getScopeState, turns, activity, log, onSessionCheckpoint, readSilenceMs, persistActivityAt, now, scheduler }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;

  /**
   * 尽力而为地写一条日志——**日志绝不能影响控制流**。
   *
   * 存在的理由：`onSilenceDue` 由宿主的投递回调驱动，那里一旦抛异常就会逃逸成
   * 未捕获异常（可能带崩进程）。而 logger 是外部注入的，它的实现未必不抛（参数
   * 序列化、被替换成抛错桩等），`log?.info?.()` 只防了「没有 log / 没有该方法」，
   * 防不住「方法自己抛」。故一律经本函数吞掉日志自身的异常——留痕是尽力而为，
   * **派发判定不受它牵连**。
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
    // 正是被 11 §6.1 判为偏离的形态——宿主在回合刚结束时就报 idle，故那等于
    // 「回合结束即派发」，且待办位一经消费便不再置位，使**沉默越久越不会触发**。
    //
    // `lastActivityAt`：最后一次会话活动时刻（毫秒）。它是«空闲»判据的锚——
    // 与「上次派发时刻」是两个不同的量（前者问人是否停了，后者问机制跑得勤不勤）。
    // 由调度侧经 `persistActivityAt` 落持久化载体：只存内存态会在热重载后归零，
    // 使计时失真（要么刚重载就又触发，要么永远攒不满）。
    lastActivityAt: null,
    // 交给宿主调度的任务 id（`ctx.schedule.create` 的返回值）；null 表示当前没有
    // 在宿主侧挂着的安静期任务。**它是唯一的计时载体**——本模块不再持有任何
    // 进程内计时器（见文件头注释）。
    scheduleId: null,
    // **本回合是否为本插件自投递的回合**：`turn/stopping` 认出自投递时置真，
    // 该回合的 `turn/end` 据此不刷新活动时刻（见 onSessionEvent）。一个回合一次。
    ownDeliveryTurn: false,
    // **排期代际**：每发起一次排期就自增。`scheduleId` 的回流是异步的，若期间
    // 已有新活动（`deferSilenceTask`），回流的排期结果必须被丢弃——否则登记会
    // 表里会留下一条「我方以为已撤销、实际仍在」的任务。用代际号而非「比较
    // `scheduledAt`」来判：后者在「活动 → 排期 → 又回到同一绝对时点」时会误判为
    // 同一次排期（例如时钟回拨）。
    scheduleEpoch: 0,
    // 已交给宿主的**到期时点**（毫秒）。用于判断「本次活动后是否需要重新排期」：
    // 若既有任务的到期时点与新的到期时点一致，就不去碰宿主任务（避免每次活动
    // 都写一次宿主存储，也避免无意义的 `schedule_conflict` 竞争）。
    scheduledAt: null,
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

  /**
   * **会话活动时的处置：不删任务，只让下一次排期把它延后**。
   *
   * §6.1 的核心纪律是「等待期间出现新会话活动，该次延迟即被取消」，但同节又把
   * 「取消」的含义**限定为推迟**，并明文禁止「删后重建」：
   *
   * > 「取消」的含义限于推迟……更新后任务仍在，只是目标时刻被推迟。实现侧
   * > **不得**把「取消」实现为删除任务后不再重建……**不得以「删后重建」替代
   * > 原地更新**。
   *
   * 故本函数**只清本地的排期登记**，让随后的 `armSilenceTask` 按新锚点算出新
   * 到期时刻，由适配器走 `schedule_update` 原地更新。宿主侧的任务自始至终存在。
   *
   * （原先本函数名为 `cancelSilenceTask` 并调用 `scheduler.remove`——那是
   * 「删后重建」路径，直接违反 §6.1。删除只保留给会话销毁这一终局路径。）
   */
  function deferSilenceTask() {
    state.scheduledAt = null;
    // **递增代际**：在途的排期结果随代际失配被丢弃（见 `armSilenceTask` 的 then）。
    state.scheduleEpoch = (state.scheduleEpoch ?? 0) + 1;
  }

  /**
   * 刷新「最后一次活动时刻」并**重置**安静期（11 §6.1：计时自活动发生时重新开始）。
   *
   * 对话在继续时不得处于倒计时状态——故本函数必先取消既有宿主任务。
   */
  function touchActivity(nowMsInput) {
    const at = Number.isFinite(nowMsInput) ? nowMsInput : nowMs();
    state.lastActivityAt = at;
    state.silenceFired = false;
    deferSilenceTask();
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
   * **把安静期的到期时点交给宿主**（不建任何进程内计时器）。
   *
   * 到期时点 = 最后一次活动时刻 + 安静时长。取绝对值而非「剩余多久」是因为宿主的
   * `at` 选择器要求严格未来的绝对时点，且它能跨宿主重启存活——正是 `setTimeout`
   * 做不到的那件事。
   *
   * **一次安静期至多派发一次**：`silenceFired` 为真时不再排期（§12「不得自行重试」
   * 的机械形态）。
   *
   * **不重复排期**：既有任务的到期时点与本次算出的相同即直接返回——避免每次活动
   * 都写一次宿主存储。
   *
   * **原子意图，失败即登记**：排期是异步的（宿主服务调用），本函数不 await（宿主
   * 事件是同步 emit）。失败按 §12 fail-closed 处理——**只记日志、不回落到自建计时器**，
   * 因为「回落到自建计时器」正是本次要消灭的形态：它会让「有的会话走宿主、有的走
   * 进程内」这种不一致长期潜伏。
   */
  function armSilenceTask() {
    // **销毁是终局**：`dispose()` 之后不得再排期。这条检查**可达**——`onAgentStatus`
    // 收到 idle 就会调本函数，而宿主在会话卸载途中仍可能派发状态事件。
    if (state.disposed === true) return;
    if (state.silenceFired === true) return;
    if (state.lastActivityAt === null) return;
    const idleMs = silenceMs();
    const dueAt = state.lastActivityAt + idleMs;
    if (state.scheduledAt === dueAt) return;   // 到期时点未变：不动宿主任务
    if (typeof scheduler?.schedule !== "function") {
      // 宿主服务缺失：**不得**回落到 setTimeout。如实登记为未兑现范围。
      note("warn", "[dsh-ldvh] host schedule service unavailable: the silence period cannot be armed (11 §6.1 forbids a self-built timer); no checkpoint will be dispatched for this period");
      return;
    }
    const startedAt = state.lastActivityAt;
    const previousId = state.scheduleId;
    // **代际只在取消时递增，排期时只读取**。若在这里自增，先前一次排期的
    // `.then` 会因代际失配而把 `scheduledAt` 清空——于是下一次 `armSilenceTask`
    // 看到的是 `null`，判定「时点未变」失效，重复排期，且每次都清掉上一次的
    // 登记。这正是反复排期却永不生效的成因。
    const epoch = state.scheduleEpoch ?? 0;
    state.scheduledAt = dueAt;
    let pending;
    try {
      pending = Promise.resolve(
        scheduler.schedule({
          dueAt,
          /* 到期回调**只在宿主投递回来时**才执行；它不假设调用时的任何状态成立。 */
          onDue: () => onSilenceDue({ startedAt, idleMs })
        })
      );
    } catch (error) {
      state.scheduledAt = null;
      note("warn", "[dsh-ldvh] arming the host silence task threw: %s", String(error?.message ?? error));
      return;
    }
    pending.then((id) => {
      // 排期期间可能已销毁、已被新活动取消、或已另排一条——此时丢弃本次结果，
      // 并把刚建出来的那条删掉（否则宿主任务表里会留下一条无人认领的任务）。
      if (state.disposed === true || state.silenceFired === true || state.scheduleEpoch !== epoch) {
        if (id !== undefined && id !== null && typeof scheduler?.remove === "function") {
          Promise.resolve(scheduler.remove(id)).catch(() => { /* 已在保护路径内 */ });
        }
        return;
      }
      state.scheduleId = id ?? null;
      // 旧任务若还在（活动 ↔ 排期的交错），此时删掉它，保证宿主侧至多一条。
      if (previousId !== null && previousId !== id && typeof scheduler?.remove === "function") {
        Promise.resolve(scheduler.remove(previousId)).catch(() => { /* 同上 */ });
      }
      note("info", "[dsh-ldvh] silence task armed at %s (id=%s, threshold=%dms)", new Date(dueAt).toISOString(), String(id), idleMs);
    }).catch((error) => {
      if (state.scheduleEpoch === epoch) state.scheduledAt = null;
      note("warn", "[dsh-ldvh] arming the host silence task failed: %s", String(error?.message ?? error));
    });
  }

  /**
   * **宿主把安静期任务投递回来时的判定**（11 §6.1 的二次确认）。
   *
   * 宿主的定时器**不保证精确到点**（它按自己的驱动节奏读取实际时间），也不保证
   * 不与新活动交错；故到期时**必须再算一次**「距最后一次活动已有多久」，判据不足
   * 则重新排期。这条再确认不依赖任何内存计时器，只依赖两个可持久化的量：
   * 活动时刻与安静时长。
   */
  function onSilenceDue({ startedAt, idleMs }) {
    state.scheduleId = null;
    state.scheduledAt = null;
    if (state.disposed === true) return;
    if (state.silenceFired === true) return;   // 本段安静期已派发过
    const current = state.lastActivityAt;
    // **到期早退必须留痕**：此前它们是静默 `return`，使「到点了却没有派发」在事后
    // 无从归因。判定语义不变，只补可观测性。一律用 info——cordis 默认等级 1 下
    // debug 根本不输出，用它留痕等于没留。经 `note()` 吞掉日志自身的异常。
    if (current === null) {
      note("info", "[dsh-ldvh] silence task delivered but no activity anchor exists: nothing to confirm");
      return;
    }
    const quietFor = nowMs() - current;
    if (quietFor < idleMs) {
      note("info", "[dsh-ldvh] silence task delivered but NOT quiet enough: quietFor=%dms threshold=%dms — re-arming", quietFor, idleMs);
      armSilenceTask();
      return;
    }
    // **锚点移动不影响本次成立**：`quietFor >= idleMs` 已经证明「距最后一次活动
    // 已满安静时长」，而这正是 11 §6.1 的全部判据。锚点变化（`current !== startedAt`）
    // 只说明排期之后又有过活动——但那段活动之后**同样**已安静满一个时长，判据仍成立。
    //
    // 旧实现在此重排，而重排算出的到期时点是 `current + idleMs`，它**必在过去**
    // （因为 `quietFor >= idleMs` 等价于 `now >= current + idleMs`）。于是宿主立即
    // 再次投递，又一次走到这里——形成投递 ↔ 重排的紧循环，`silenceFired` 永不置位，
    // 检查点一次也跑不起来。这是把计时交给宿主之后特有的失效形态（`setTimeout`
    // 的剩余量天然非负，不会出现），故此处直接派发，不再重排。
    if (!governed()) {
      note("warn", "[dsh-ldvh] silence task delivered but the scope is no longer governed: no checkpoint dispatched");
      return;
    }
    state.silenceFired = true; // 先置位：此后除非有新活动，不得再触发
    dispatchCheckpoint("silence:host-schedule");
  }

  /**
   * **真正删除宿主任务**——只用于会话销毁等终局路径。
   *
   * 与 `deferSilenceTask` 的分工是本节最容易滑过去的地方：会话活动时**不得删除**
   * （那会走成 §6.1 禁止的删后重建），只有「这个会话不会再跑了」时才删。
   */
  function clearSilenceTask() {
    const id = state.scheduleId;
    state.scheduleId = null;
    state.scheduledAt = null;
    state.scheduleEpoch = (state.scheduleEpoch ?? 0) + 1;
    if (id === null || typeof scheduler?.remove !== "function") return;
    try {
      Promise.resolve(scheduler.remove(id)).catch((error) => {
        note("warn", "[dsh-ldvh] silence task removal failed (id=%s): %s", String(id), String(error?.message ?? error));
      });
    } catch (error) {
      note("warn", "[dsh-ldvh] silence task removal threw (id=%s): %s", String(id), String(error?.message ?? error));
    }
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
      // **只接受真实的轮次号**：到期投递不对应新回合，其 `turn-stopping` 载荷
      // 里没有 `turn`（或与已记值相同）。若在这里无条件赋值，一次投递就会把
      // 已记下的轮次号抹成 `undefined`，随后「区间上界」与「重启后回填」全部失效
      // ——这正是被落实到的下游症状。
      if (typeof payload?.turn === "number") state.lastTurn = payload.turn;
      // Gate: 未受管辖时不清点，也不排期——受管辖是 11 §4 运行的前提。
      state.lastReflectionGate = governed() ? "open" : "closed";

      // **本回合是否由本插件投放的安静期任务开启**——标记在 `user/message`
      // 到达时就已置位（见 `onSessionEvent`）。此处只消费它。
      //
      // 注意 `agent/turn-stopping` 的载荷**只有 `{ turn, signal }`，不含用户消息**
      // （`dsh-agent-loop` 的 `this.dispatch.serial("agent/turn-stopping", { turn, signal })`）
      // ——所以识别**不能**在这里做。这一点是从宿主源码确认的，不是推测。
      if (state.ownDeliveryTurn === true) {
        activity?.record("turn/stopping", { turn: state.lastTurn, gate: state.lastReflectionGate, ownDelivery: true });
        if (state.lastReflectionGate !== "open") {
          note("warn", "[dsh-ldvh] silence delivery arrived but the scope is no longer governed: no checkpoint dispatched");
          return;
        }
        // 宿主侧那条任务已经消费掉了（一次性 `at` 记录投递后即 inactive）。
        state.scheduleId = null;
        state.scheduledAt = null;
        // **不刷新活动时刻**——这正是关键：刷新会把刚满的安静期作废，于是
        // 「安静期满 → 投递 → 又被算作有人说话 → 作废 → 重新静默」永不触发。
        onSilenceDue({ startedAt: state.lastActivityAt, idleMs: silenceMs() });
        return;
      }

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
      armSilenceTask();
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
      // **本插件投放的安静期任务到达**：它是一条用户消息（宿主把它 append 成
      // `user/message`），会开启一个新回合。此处置标记，使该回合的
      // `turn/stopping` / `turn/end` 都不把「机制自己的回音」当成人的活动。
      if (session === agent?.session && event?.type === "user/message" && isOwnSilenceDelivery(event?.data)) {
        state.ownDeliveryTurn = true;
        activity?.record("session/own-delivery", { turn: state.lastTurn });
        return;
      }
      if (session !== agent?.session || event?.type !== "turn/end") return;
      state.turnEndSeen += 1;
      state.lastTurn = eventTurn(event) ?? state.lastTurn;
      // **会话活动**（2026-10-14）：`turn/end` 也是活动——它同时是区间材料的
      // 结算点。此处刷新活动时刻（重置安静期），使「对话还在进行」不会被误判为
      // 安静。与 `onTurnStopping` 的刷新**不冲突**：两者都表示「有人在说话」，
      // 任一发生都应重置计时（取最后发生者为准）。
      // **本插件投放的回合结束时也不刷新活动时刻**：`turn/stopping` 已在
      // 投递到达时完成判定；若此处再把「现在」写成活动时刻，下一段安静期会从
      // 辅助任务跑完的时刻起算——那是对的，但**不能**发生在本回合：本回合的
      // 结束是机制自己造成的，不是人的活动。判据与 `turn/stopping` 一致。
      if (!state.ownDeliveryTurn) {
        if (governed()) touchActivity(nowMs());
      } else {
        // 本回合是自投递：标记随回合结束清除（一个回合一次）。
        state.ownDeliveryTurn = false;
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
     * 清定时器（会话结束 / 插件卸载时由 lifecycle 的清理函数调用）。
     *
     * **不清 `lastActivityAt`**：它是**跨会话持久化**的量（写在水印载体上），
     * 清它会使下次装载从零开始计时；清理只负责不留下「进程已退出仍在计时的
     * 定时器」这一泄漏。`silenceFired` 亦不清——它属于**本段安静期**，
     * 随对象销毁自然消失。
     */
    dispose() {
      state.disposed = true; // 之后的 restoreActivityAt 一律不得再武装
      clearSilenceTask();
    },

    /**
     * 恢复持久化的活动时刻（装载时由 lifecycle 注入；见 `persistActivityAt`）。
     *
     * **恢复后必须重新排期**：宿主的 `agent/status` 只在 status **发生变化**时发出
     * （`agent-loop` 的 `setPhase` 判 `status !== previousStatus`），一个已经 idle 的
     * 会话不会再发一次 idle；若装载后不排期，该会话要等到下一次真实的
     * running→idle 转变才可能被观察到。
     *
     * 恢复出来的锚点本就是「最后一次活动时刻」，安静时长自它起算；到期时点由
     * `armSilenceTask` 直接算成**绝对值**（锚点 + 安静时长），故久远锚点算出的
     * 时点可能已在过去——此时宿主会立即投递，随后由 `onSilenceDue` 的再确认判为
     * 「已足够安静」并派发，不白等一个完整安静时长。
     *
     * **本函数不写任何进程内计时器**：唯一的计时载体是宿主任务（`armSilenceTask`）。
     *
     * 本函数由 lifecycle 的 **fire-and-forget** 异步旁路调用（该 IIFE 中间有两次
     * `await`，期间会话可能已被销毁或已有新的真实活动）。故必须满足三条：
     *
     * 1. **锚点单调**：只接受比当前更新的时刻。陈旧快照不得覆盖运行时已更新的
     *    锚点——否则「刚活动过的会话」会被以陈旧锚点误判为「已安静很久」并派发。
     * 2. **先清登记后排期**：`deferSilenceTask()` 再 `armSilenceTask()`，保证宿主任务
     *    与锚点**同源**。否则旧任务的闭包仍指向旧 `startedAt`，到期必命中
     *    「起点已变」早退并被重新排期，使会话静默到下一次宿主状态变化。
     * 3. **不抛**：调用方在 `try/catch` 里，但本函数原契约就是「不抛」；且此处
     *    若在写状态/排期之后抛错，调用方会拿到异常而内部状态已变（半提交）。
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
      deferSilenceTask();                        // 与 touchActivity 对齐：先清登记后排期
      armSilenceTask();
      note("info", "[dsh-ldvh] activity anchor restored from %s; silence task re-armed", new Date(n).toISOString());
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
     *    这条同时**蕴含**了「不回退」：本宿主里轮次号跨重启单调（`agent-loop`
     *    在构造时从 `turnBoundary` 持久化投影恢复 `lastTurn`，且只做
     *    `turn = phase.turn + 1`），故重启后出现的新回合事件其 turn 必然不小于
     *    记录里的最大值——「已有值」即意味着「该值不旧于任何可回填的快照」。
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
