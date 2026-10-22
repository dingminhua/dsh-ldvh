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
 *
 * **`time_zone` 必须始终存在**：宿主的 `LocalAtInput` 校验要求恰好三个键
 * （`date`／`time`／`time_zone`，见 domain.ts 的 `parseAtInput`），缺一个即
 * `invalid_rule`。原实现在取不到时区时省略该键，等于保证那条调用必然失败；
 * 取不到时退到 UTC 是**如实**的降级（时刻不变，只是不加本地偏移）。
 */
function atSelector(dueMs) {
  const d = new Date(dueMs);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  let timeZone = "UTC";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    timeZone = "UTC";
  }
  return { date, time, time_zone: timeZone };
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
 * @param ctx       宿主上下文（读取宿主调度服务与 `ctx.logger`）
 * @param sessionId 绑定会话 id（宿主调度任务只投递给创建它的会话）
 */
export function createHostScheduler(ctx, sessionId) {
  const log = ctx?.logger;
  // ── 取服务：**只能走 `ctx.get`，不得裸取属性**（2026-10-22 激活失败修复）──
  //
  // 原实现先试 `ctx.schedule`、失败再试 `ctx.get("schedule")`，注释理由是
  // 「前者是常规写法」。该前提在本宿主上**不成立**：`schedule` 不在本插件的
  // `inject` 里（它是**可选**依赖，硬注入会让未装配 schedule 的组合整插件失活），
  // 而 cordis 的 Proxy 对「未 inject 且无 provide」的属性访问**直接抛错**
  // （`cannot get property "schedule" without inject`，见 cordis
  // `src/reflect.ts` 的 `handler.get`）。于是本函数在**每一个 agent 安装时**
  // 抛出，`install()` 当场中断，宿主把它记成
  // `1 entry did not activate dsh-ldvh` —— 插件的设置面、注入面、工具批全部
  // 不生效。单元测试无一覆盖到它：所有测试桩的 ctx 都是普通对象（属性缺失
  // 返回 undefined，不抛），而真实 ctx 是 Proxy。
  //
  // 正确读法只有一种：`ctx.get(name)` —— 它按服务表查找，**未提供即返回
  // undefined**，从不抛。只有拿不到 `get` 的极端桩才退化到属性访问，且同样
  // 包在 try 里。
  //
  // **每次现读，不在构造时冻结**（2026-10-22）：适配器按 agent 构造，而 agent
  // 可能早于 `schedule` 服务就绪（宿主按加载次序装配）。构造时读一次并把结果
  // 判成 `available`，会让「晚一步挂载的服务」被永久记为不可用——本插件随后
  // **再也不排期**，而日志里只有一条建造期的 warn，事后无从归因。故服务引用与
  // 可用性一律在调用点求值。
  function resolveService() {
    let found;
    if (typeof ctx?.get === "function") {
      try {
        found = ctx.get("schedule");
      } catch {
        found = undefined;
      }
    }
    if (found === undefined) {
      try {
        found = ctx?.schedule;
      } catch {
        found = undefined;
      }
    }
    return found ?? undefined;
  }

  /** 尽力而为记日志：日志异常绝不进入控制流。 */
  function note(level, ...args) {
    try {
      log?.[level]?.(...args);
    } catch {
      // 日志失败即放弃。
    }
  }

  /** §6.1 明文要求所选形态**可原地更新**：不具备 `update` 的服务不得用于承载，
   * 因为「删后重建」两步之间不具原子性，中断即丢失任务（规范直接禁止该路径）。 */
  function usable(service) {
    return Boolean(
      service !== null
      && typeof service === "object"
      && typeof service.create === "function"
      && typeof service.list === "function"
      && typeof service.delete === "function"
      && typeof service.update === "function"
    );
  }

  /** 取一个可用服务；不可用时返回 undefined（调用方据此 fail-closed）。 */
  function serviceOrUndefined() {
    const service = resolveService();
    return usable(service) ? service : undefined;
  }

  if (serviceOrUndefined() === undefined) {
    note("warn", "[dsh-ldvh] host schedule service is not mounted or cannot update in place (ctx.get(\"schedule\") unavailable/incomplete): idle assistance cannot be armed through the host mechanism");
  }

  /** 按标签在本会话里找出本插件那条任务（宿主侧至多一条）。 */
  async function findOwn(service, sessionId) {
    const rows = await service.list({ sessionId });
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row?.prompt === "string" && row.prompt.startsWith(`[${SILENCE_TAG}]`)) return row;
    }
    return undefined;
  }

  return {
    get available() {
      return serviceOrUndefined() !== undefined;
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
      const service = serviceOrUndefined();
      if (service === undefined) throw new Error("host schedule service unavailable");
      const at = atSelector(dueAt);
      // 列举失败时直接上抛，**不**假定「没有旧任务」就创建第二条：那会让宿主侧
      // 出现多条同一会话的任务、各自投递一次（§6.1 边界第 2 项：不得声称恰好一次，
      // 但也不得自造重复）。由触发器按 §12 登记该次失败。
      const existing = await findOwn(service, sessionId);
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
      //
      // **请求形状按宿主真实契约**（Service `schedule`，`ScheduleUpdateRequest`）：
      // `{ sessionId, id, expected, change }`——`expected` 是**完整记录**（乐观
      // 并发：宿主逐字比对，不符即 `schedule_conflict`），`change` 是带判别式的
      // 定时变更（`{ kind: "at", at }`）。原实现传 `{ id, at }`：`id`／`at` 都
      // 不在顶层契约里，`expected` 缺失使宿主必然判为冲突，于是「原地更新」
      // 从未成功过一次——安静期只会被推迟到 `create` 那一次，之后每次活动都
      // 更新失败（只有一条 warn 日志），到期投递仍按旧时刻发生。
      const change = { kind: "at", at };
      const updated = await service.update({
        sessionId,
        id: existing.id,
        expected: existing,
        change
      });
      // 宿主用**结果对象**表达失败，不总是抛：`{ updated: false, code }` 是
      // 输入错误／查找失败／冲突／拒绝的正常返回。把它当成功会让「没改成功」
      // 长成「已改成功」，故此处显式读取判定，失败即抛出交给触发器登记。
      if (updated !== null && typeof updated === "object" && updated.updated === false) {
        const code = typeof updated.code === "string" ? updated.code : "update_rejected";
        throw new Error(`host schedule update not applied: ${code}`);
      }
      return updated?.id ?? existing.id;
    },

    /** 撤掉本会话的安静期任务（仅在会话销毁等终局路径使用，不在活动时使用）。 */
    async remove(id) {
      this.cancelled.add(id);
      const service = serviceOrUndefined();
      if (service === undefined) return;
      try {
        // `ScheduleDeleteRequest` = `{ sessionId, id }`：会话绑定是查找键的一部分，
        // 缺它即 `schedule_not_found`（原实现只传 `{ id }`，删除从未生效——
        // 于是会话销毁后宿主任务表里会长期留着本插件的那条任务）。
        await service.delete({ sessionId, id });
      } catch (error) {
        note("warn", "[dsh-ldvh] silence task delete failed (id=%s): %s", String(id), String(error?.message ?? error));
      }
    }
  };
}

export { SILENCE_TAG, SILENCE_TITLE };
