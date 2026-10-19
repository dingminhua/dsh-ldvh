/**
 * 会话位置读取（36 §11「水位」）：从宿主会话记录里取**最后一个轮次号**。
 *
 * ## 为什么需要这条入口（2026-10-19）
 *
 * 36 §11 规定水位切分「依据只能是宿主会话记录中的位置」。此前本插件把这条纪律
 * 实现为「取 `turn/end` 事件的载荷」——它只存在于**内存里的触发器状态**
 * （`triggers.js` 的 `state.lastTurn`），**没有任何持久化载体**。
 *
 * 于是进程重启 / 插件热重载后出现一个必现的失效面：
 *
 *   1. lifecycle 的启动恢复旁路把「最后一次活动时刻」写回触发器并**武装**安静期
 *      计时器（2026-10-19 修复；此前根本不武装，故这条路径不可达）；
 *   2. 该会话在重启后**没有新的回合**，于是 `triggers.onTurnStopping` /
 *      `onSessionEvent` 都不会被调用，`state.lastTurn` 保持 `undefined`；
 *   3. 安静期到期 → `onSessionCheckpoint({ turn: undefined })` →
 *      `runIdleCheckpoint` 按 36 §12 fail-closed（`no_current_turn`）。
 *
 * 结果是：**重启后第一次闲时派发必然失败**。这不是「偶发竞态」，而是
 * 「重启必定进入」的确定性路径——修复前它只是被「不武装计时器」这个更早的缺陷
 * 掩盖着。
 *
 * ## 边界（不得越界）
 *
 * 本模块**只取位置**，不重建、不提取区间材料。区间材料由调度侧的事件累积器给出
 * （`friction-window.js`；宿主只发布事件、不回放，故重启前的材料确实不可恢复——
 * 这一点已在 `friction-discovery-provider.js` 的缺口处置里如实登记）。把「读会话
 * 记录」误用成「从日志重建材料」会绕过 §11 的水位切分，正是 36 §7.1/§11 明令禁止的
 * 「全量交付」。
 *
 * ## 取不到时的处置（00 §5.6 据实声明）
 *
 * 如实返回失败原因，**绝不**推测、绝不用更弱的来源掩盖：轮次号是水位端点，
 * 猜一个等于把「不知道」写成「知道」。调用方拿到失败后应维持 fail-closed
 * （`idle-checkpoint` 会入待处置队列），而不是当作「没有位置就覆盖全部内容」。
 *
 * ## 宿主契约（据 asar 内 dsh-session-persistence-jsonl 核实，2026-10-19）
 *
 * - `sessionPersistence.open(id, "read")` 是**纯读**，不取写租约/所有权，故对
 *   运行中的会话也可安全调用；会话尚未落盘（内存态）时同样返回可读句柄。
 * - `handle.read()` 返回 `{ eventState, events }`，`events` 是**正序**（seq 升序）
 *   的逻辑日志切片。
 * - 轮次号出现在**很多**事件的 `data.turn` 里（实测一条真实会话记录：`tool/call`
 *   1091、`tool/result` 1090、`step/start` 999、`step/end` 998、`assistant/message`
 *   995、`turn/start` 25、`turn/end` 24，另有 `assistant/attempt`/`llm/retry`/
 *   `workspace/changes`/`system/message`/`developer/message` 等）。本模块**只认
 *   轮次边界事件**（`turn/start` 与 `turn/end`）：其余事件里的 `data.turn` 表示
 *   「这一轮内发生了什么」，不是「位置前进到哪」，混用会让位置口径漂移。
 * - 该取舍与宿主自身的位置定义**等价**：宿主 `turnBoundary` 投影只在
 *   `turn/start` 上写 `lastTurn`，`turn/end` 不改（`dsh-agent-loop`）。因轮次号
 *   单调，`max(turn/start ∪ turn/end) == max(turn/start)`。
 * - 会话 header 与 Session 对象均不暴露轮次计数。
 */

/**
 * 从事件数组里取最大的轮次号。
 *
 * 取**最大**而非「最后一条事件的 turn」：日志尾部可能还有 `turn/end` 之后的事件
 * （如 `assistant/message` 的收尾、`request/context`），它们的 `data.turn` 未必
 * 存在；而轮次号本身是单调的，最大值就是「最后一个已开始的轮次」。
 *
 * @param {Array<object>} events 正序会话事件
 * @returns {number|null} 最大轮次号；事件里没有任何轮次号时返回 null
 */
export function maxTurnFromEvents(events) {
  if (!Array.isArray(events)) return null;
  let max = null;
  for (const event of events) {
    if (event === null || typeof event !== "object") continue;
    const type = event.type;
    // 只认轮次边界事件：其它事件的 data.turn 是「这一轮里发生的事」，语义上不构成
    // 位置定义；而轮次边界才是 §11 所说的「会话记录中的位置」。
    if (type !== "turn/start" && type !== "turn/end") continue;
    const turn = event?.data?.turn;
    if (!Number.isInteger(turn) || turn < 0) continue;
    if (max === null || turn > max) max = turn;
  }
  return max;
}

/**
 * 读取某会话的最后一个轮次号。
 *
 * @param {object} options
 * @param {object} options.sessionPersistence 宿主持久化服务（需有 `open(id,"read")`）
 * @param {string} options.sessionId 会话标识
 * @returns {Promise<{ok: true, turn: number, events: number} | {ok: false, reason: string}>}
 *   `events` 是读到的日志条数（供痕迹核对「读到的确实是全部历史」）。
 */
export async function readLastTurn({ sessionPersistence, sessionId } = {}) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { ok: false, reason: "sessionId is required to read the session position" };
  }
  if (sessionPersistence === undefined || sessionPersistence === null) {
    return { ok: false, reason: "sessionPersistence service is unavailable" };
  }
  if (typeof sessionPersistence.open !== "function") {
    return {
      ok: false,
      reason: 'the host persistence backend does not expose open(id, "read") — session position is unavailable',
    };
  }

  let handle;
  try {
    handle = await sessionPersistence.open(sessionId, "read");
  } catch (error) {
    return { ok: false, reason: `host open() failed: ${String(error?.message ?? error)}` };
  }
  try {
    const result = await handle?.read?.();
    const events = result?.events;
    if (!Array.isArray(events)) {
      return { ok: false, reason: "host read() returned no events array" };
    }
    const turn = maxTurnFromEvents(events);
    if (turn === null) {
      return {
        ok: false,
        reason: "the session record carries no turn/start or turn/end event — the position cannot be defined",
      };
    }
    return { ok: true, turn, events: events.length };
  } catch (error) {
    return { ok: false, reason: `host read() failed: ${String(error?.message ?? error)}` };
  } finally {
    try {
      await handle?.close?.();
    } catch {
      /* 句柄关闭失败不影响已取得的位置 */
    }
  }
}
