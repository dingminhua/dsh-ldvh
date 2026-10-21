// dsh-ldvh — host schedule adapter (11 §6.1「实现侧不得自行维护计时器」).
//
// **为什么需要这一层**：`triggers.js` 只应知道「我要在某时点被叫回来」与
// 「把这条任务撤掉」两件事。宿主调度服务的真实形状（`ctx.schedule.create/
// update/delete/list`、`{ title, prompt, at: { date, time, time_zone } }` 之类的
// 请求结构、错误码、会话绑定语义）属于实现细节，不应渗进判据代码——否则
// 换一个宿主版本就要改一遍判定逻辑，而判定逻辑是规范的东西、不该跟着实现漂。
//
// 本适配器把宿主的形状收敛成三个方法：
//   `schedule({ dueAt, onDue }) -> id`   在 dueAt 叫回我
//   `remove(id) -> void`                 撤掉
//   `available`                         宿主服务是否可用（不可用时 triggers 如实
//                                       登记为未兑现范围，**不回落自建计时器**）
//
// **一个会话至多一条本插件任务**：靠 prompt 内的绑定标签识别（`LDVH_SILENCE_TAG`），
// 创建前先 `list` 一次按标签查重。宿主任务表里残留的旧任务（例如上次卸载前的）
// 会被识别并复用或清理，不会累积。

/** 本插件安静期任务在宿主任务表中的识别标签。 */
const SILENCE_TAG = "dsh-ldvh:session-silence";

/** 任务标题（宿主要求非空、≤ 120 字符，且不得从指令派生）。 */
const SILENCE_TITLE = "LDVH 安静期辅助任务";

/**
 * 把毫秒时刻拆成宿主 `at` 选择器要求的形状：本地日期 + 本地时间 + IANA 时区。
 *
 * 宿主也接受显式的 RFC3339 字符串，但拆成三段可以避免「字符串被宿主按不同精度
 * 解析」这类跨版本差异；时区取宿主的本地时区，与「安静时长」这一本地时长的语义
 * 一致（DST 边界上的偏差由 `onSilenceDue` 的再确认兜住——它只认实际经过的时间）。
 */
function atSelector(dueMs) {
  const d = new Date(dueMs);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  let timeZone;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return timeZone === undefined ? { date, time } : { date, time, time_zone: timeZone };
}

/** 本插件任务的可执行内容：绑定标签 + 给模型看的一句话（宿主会把它投递回来）。 */
function promptFor(sessionId) {
  return [
    `[${SILENCE_TAG}] session=${sessionId}`,
    "",
    "LDVH 安静期已到：本会话距最后一次活动已持续不短于配置的安静时长。",
    "这是宿主定时投递，**不是**用户的新指令。如果此后已有新的会话活动，本次安静期作废（判据在 triggers.js 的到期再确认里）。"
  ].join("\n");
}

/**
 * 构造宿主调度适配器。
 *
 * **投递是「消息」而不是「回调」**：宿主把到期的任务渲染成一条
 * `[SCHEDULE REMINDER]` 消息投进本会话的收件箱，它会成为下一回合的用户消息。
 * 故本适配器**不提供 onDue 回调**——到期判定发生在触发器侧：它在
 * `turn/stopping` 时看到一个以 `LDVH_SILENCE_FRAMING` 开头的新回合，就知道
 * 「安静期任务投递回来了」。适配器只负责排期与撤销两件事。
 *
 * @param ctx       宿主上下文（读取 `ctx.schedule` 与 `ctx.logger`）
 * @param sessionId 绑定会话 id（宿主调度任务只投递给创建它的会话）
 */
export function createHostScheduler(ctx, sessionId) {
  const log = ctx?.logger;
  // Cordis 里服务既可按属性访问（`ctx.schedule`），也可按名查找
  // （`ctx.get("schedule")`）。两种都试：前者是常规写法，后者在「属性尚未
  // 展开」或测试桩上更可靠。
  let service = ctx?.schedule;
  if (service === undefined && typeof ctx?.get === "function") {
    try {
      service = ctx.get("schedule");
    } catch {
      service = undefined;
    }
  }

  /** 尽力而为记日志：日志异常绝不进入控制流。 */
  function note(level, ...args) {
    try {
      log?.[level]?.(...args);
    } catch {
      // 日志失败即放弃。
    }
  }

  const available = Boolean(
    service !== undefined
    && service !== null
    && typeof service.create === "function"
    && typeof service.list === "function"
    && typeof service.delete === "function"
    // §6.1 明文要求所选形态**可原地更新**：不具备 `update` 的服务不得用于承载，
    // 因为「删后重建」两步之间不具原子性，中断即丢失任务（规范直接禁止该路径）。
    && typeof service.update === "function"
  );

  if (!available) {
    note("warn", "[dsh-ldvh] host schedule service is not mounted or cannot update in place (ctx.schedule unavailable/incomplete): idle assistance cannot be armed through the host mechanism");
  }

  /** 按标签在本会话里找出本插件那条任务（宿主侧至多一条）。 */
  async function findOwn(sessionId) {
    const rows = await service.list({ sessionId });
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row?.prompt === "string" && row.prompt.startsWith(`[${SILENCE_TAG}]`)) return row;
    }
    return undefined;
  }

  return {
    get available() {
      return available;
    },

    /**
     * **同步取代异步的观察点**：宿主删除是异步的，但「我方已决定撤掉这条」是同步
     * 事实。发起删除时立即记入本集合，使撤销**不必等宿主 I/O 完成**即可被观察到。
     */
    cancelled: new Set(),

    /**
     * 把本会话的安静期任务**锚定到 `dueAt`**（毫秒）。
     *
     * **已有任务时一律走原地更新，不删后重建**（§6.1「不得以删后重建替代原地
     * 更新」）：`schedule_update` 只改绝对时刻，任务本身全程存在，因此不存在
     * 「两步之间中断即丢失」的窗口。只有本会话**尚无**本插件任务时才 `create`。
     *
     * @returns 任务 id
     */
    async schedule({ dueAt }) {
      if (!available) throw new Error("host schedule service unavailable");
      const at = atSelector(dueAt);
      // 列举失败时直接上抛，**不**假定「没有旧任务」就创建第二条：那会让宿主侧
      // 出现多条同一会话的任务、各自投递一次（§6.1 边界第 2 项：不得声称恰好一次，
      // 但也不得自造重复）。由触发器按 §12 登记该次失败。
      const existing = await findOwn(sessionId);
      if (existing === undefined) {
        const record = await service.create(sessionId, {
          title: SILENCE_TITLE,
          prompt: promptFor(sessionId),
          at
        });
        const id = record?.id ?? record;
        if (id === undefined || id === null) throw new Error("host schedule create returned no id");
        return id;
      }
      // 原地更新：只改目标时刻。标题与 prompt 不动——改它们会产生一次新的
      // 「变更」，而本条要表达的只是「推迟到期时刻」。
      const updated = await service.update({ id: existing.id, at });
      return updated?.id ?? existing.id;
    },

    /** 撤掉本会话的安静期任务（仅在会话销毁等终局路径使用，不在活动时使用）。 */
    async remove(id) {
      this.cancelled.add(id);
      if (!available) return;
      try {
        await service.delete({ id });
      } catch (error) {
        note("warn", "[dsh-ldvh] silence task delete failed (id=%s): %s", String(id), String(error?.message ?? error));
      }
    }
  };
}

export { SILENCE_TAG, SILENCE_TITLE };
