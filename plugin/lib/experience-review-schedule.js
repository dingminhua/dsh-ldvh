// dsh-ldvh — 经验审核的**宿主周期任务适配器**（2026-10-26）。
//
// 本文件承接 11 §6.1 形态 2（固定间隔）的**承载与落点**：
//
// > **承载**：由宿主自动化任务的周期调度承载；该形态**须**绑定一个所服务的会话作为
// > 投递落点。**落点解析顺序**：先按**固定标题**查找已存在的专属会话，找到则复用之；
// > 找不到则**创建一个固定标题的专属会话**并以其为落点。**该创建须发生在该形态所服务
// > 的管辖项目之内**——不得跨项目创建，且一个管辖项目至多一个专属会话。
// > **不得并发开两个审核回合**：若投递到达时落点会话已有回合在运行，本次投递
// > **可跳过或排队**——二者择一由实现侧承接，跳过时须如实记账。
//
// ## 为什么单独立一层，不复用「安静期」那套
//
// 形态 1 与形态 2 的**承载性质相反**：
//
// | | 形态 1（一次延迟） | 形态 2（固定间隔） |
// |---|---|---|
// | 触发锚 | 会话活动 + 空窗 | 宿主周期到达 |
// | 会话没了 | 就该停 | **必须还能跑**（审核不该跟着某个对话的生死走） |
// | 承载 | 实现侧每会话计时器 | 宿主自动化任务 |
//
// 故 §6.1 第 1 段对形态 1 的禁令（不得用宿主定时任务）**不适用于**本形态——规范
// 原文是「该形态下实现侧不得……」，本次修订把它限定到了形态 1。
//
// ## 本适配器的纪律
//
// 1. **不自行维护计时器**：周期完全由宿主调度持有。本文件里没有 `setTimeout`/
//    `setInterval`——有一个源码级测试守着（§6.1「实现侧不得自行维护计时器」对
//    形态 2 同样成立：这里的「不得自建」不是禁令的重申，而是**没有理由自建**——
//    宿主已经提供了周期调度）。
// 2. **原地更新，不删后重建**：间隔变了走 `schedule.update`，任务全程存在。
// 3. **非法间隔在写入时拒绝**：取 0／负数会让「到点」恒成立。
// 4. **失败如实登记，不假装已武装**。

/** 专属会话标题前缀。完整标题 = `<前缀> · <projectId>`。 */
export const REVIEW_SESSION_TITLE_PREFIX = "LDVH 经验审核";

/** 周期任务在宿主任务表中的识别标签（写进 prompt 首行，用于查重）。 */
export const REVIEW_SCHEDULE_TAG = "dsh-ldvh:experience-review";

/** 周期任务标题（宿主要求非空、≤ 120 字符，且不得从指令派生）。 */
export const REVIEW_SCHEDULE_TITLE = "LDVH 经验审核周期任务";

/** 专属会话标题：`LDVH 经验审核 · <projectId>`。 */
export function reviewSessionTitle(projectId) {
  return `${REVIEW_SESSION_TITLE_PREFIX} · ${projectId}`;
}

/**
 * 周期任务的投递内容。
 *
 * 措辞刻意与安静期那条**不同**：这条到点时**不判空窗**（§6.1 形态 2 没有二次确认），
 * 只做审核。首行的标签用于查重（同一会话至多一条本插件周期任务）。
 */
function reviewPrompt(projectId) {
  return [
    `[${REVIEW_SCHEDULE_TAG}] project=${projectId}`,
    "",
    "LDVH 经验审核到点：检查留观缓冲里是否有可以成文的经验候选。",
    "这是宿主定时投递，**不是**用户的新指令；投递到达不等于已执行（11 §6.1 边界第 1 项）。",
  ].join("\n");
}

/**
 * 取宿主服务；未装配时返回 `undefined`（不抛——可选依赖不得掀翻调用方）。
 *
 * **只能走 `ctx.get`**：`schedule` 不在本插件的 `inject` 里（硬注入会让未装配它的
 * 组合整插件失活），而 cordis 的 Proxy 对「未 inject 且无 provide」的属性访问**直接
 * 抛错**。这是 2026-10-22 在本宿主上实测踩到的形态，不是预防性顾虑。
 */
function serviceOf(ctx, name) {
  try {
    return ctx.get(name);
  } catch {
    return undefined;
  }
}

/**
 * 解析项目根对应的 workspace id（侧边栏分组）。
 *
 * **拿不到就返回 null，不猜**：返回 null 时会话仍会建在正确的 cwd 下，只是可能落在
 * 「未分组」——那比编一个 id 好（编 id 会让宿主拒绝创建，连会话都没有）。
 *
 * 注意 `resolveByPath` 在目录不存在时会 reject；`create` 则要求路径是已存在的目录。
 * 两者都不吞异常到「当作没有 workspace」——那会让一个真问题伪装成「未分组」。
 */
async function resolveWorkspaceId(ctx, projectRoot) {
  const registry = serviceOf(ctx, "workspaceRegistry");
  if (registry === undefined) return null;
  try {
    if (typeof registry.resolveByPath === "function") {
      const existing = await registry.resolveByPath(projectRoot);
      if (existing?.id !== undefined && existing.id !== null) return existing.id;
    }
    if (typeof registry.create === "function") {
      const made = await registry.create(projectRoot);
      if (made?.id !== undefined && made.id !== null) return made.id;
    }
    return null;
  } catch {
    // 目录不存在或解析失败：如实退回「不指定分组」，会话仍建在 cwd 下。
    return null;
  }
}

/**
 * 按固定标题查找专属会话。
 *
 * **标题不在 `SessionSummary` 顶层**，而在 `projections.values.title`——这一点若搞错，
 * 就会永远找不到、然后每次都不停地新建（规范已把「可能产生第二个专属会话」登记为
 * 已知代价，但那是标题被人工改动的情形，不是我们自己的读取错误）。
 *
 * @returns {Promise<{ok:true, sessionId:string|null, candidates:number}|{ok:false,error:object}>}
 */
/**
 * 读出**已归档的会话 id 集合**（2026-10-26，Human 要求：归档视为删除）。
 *
 * ## 为什么必须自己读
 *
 * `sessionController.list()` **不过滤归档**——实测证据：本项目 113 条已归档会话
 * 仍在 list 的返回里。故「按固定标题查找落点会话」会把**已被用户归档的会话**
 * 当成有效落点继续复用，表现为「审核不断回到一个用户已经收起来的对话里」。
 *
 * ## 取数通道
 *
 * 走宿主的 `workspaceController.follow()` 读一次 baseline 就断开：它的
 * `WorkspaceBaseline.archivedSessionIds` 正是权威集合。不直接读
 * `~/.dsh/storages/workspace.json`——那是宿主的持久化实现细节，格式由它自己决定，
 * 跨版本会变；读它等于把宿主内部结构当成契约。
 *
 * 读不到时返回 `null`（**未知**），由调用方决定策略——不返回空集合，因为空集合
 * 的含义是「确认没有任何归档」，与「没读到」是两件事。
 *
 * @returns {Promise<Set<string>|null>}
 */
async function readArchivedSessionIds(ctx) {
  const controller = serviceOf(ctx, "workspaceController");
  if (controller === undefined || typeof controller.follow !== "function") return null;
  let iterator;
  try {
    iterator = controller.follow(new AbortController().signal);
  } catch {
    return null;
  }
  try {
    // 只要第一帧（baseline）就够了；拿到就断开，不长期占用流。
    for await (const frame of iterator) {
      if (frame?.type === "baseline" && Array.isArray(frame.value?.archivedSessionIds)) {
        return new Set(frame.value.archivedSessionIds);
      }
      // 第一帧若不是 baseline（理论上不会），继续等一帧再放弃。
      break;
    }
    return null;
  } catch {
    return null;
  } finally {
    // 显式关闭流：`follow` 是长连接，不关会泄漏一个订阅。
    try { await iterator?.return?.(); } catch { /* 关闭失败不影响结论 */ }
  }
}

export async function findReviewSession(ctx, { projectId }) {
  const controller = serviceOf(ctx, "sessionController");
  if (controller === undefined || typeof controller.list !== "function") {
    return { ok: false, error: { code: "review_session/service_unavailable", message: "sessionController.list is not wired into this composition" } };
  }
  const archived = await readArchivedSessionIds(ctx);
  const title = reviewSessionTitle(projectId);
  let listed;
  try {
    // list 需要一个 AbortSignal；不给信号就没有取消能力，故给一个不走超时的控制器。
    listed = await controller.list({}, new AbortController().signal);
  } catch (error) {
    return { ok: false, error: { code: "review_session/list_failed", message: String(error?.message ?? error) } };
  }
  const items = Array.isArray(listed?.items) ? listed.items : [];
  const matching = items.filter((item) => {
    const itemTitle = item?.projections?.values?.title;
    if (typeof itemTitle !== "string" || itemTitle !== title) return false;
    // **归档视为删除**（Human 2026-10-26）：用户把对话收起来，就是不要它了。
    // 继续往归档会话里投递，会让审核在一个「已经不存在的对话」里跑——用户既看不到
    // 也管不了。故已归档的不算命中，交给「找不到则新建」那条路。
    if (archived !== null && archived.has(item?.sessionId)) return false;
    return true;
  });
  // **一个项目至多一个**：若有多条同标题（标题被人工改过又改回、或历史遗留），取
  // 最近活动的一条并如实报出候选数——不静默挑一个假装只有一条。
  if (matching.length === 0) return { ok: true, sessionId: null, candidates: 0 };
  const sorted = matching.slice().sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0));
  return { ok: true, sessionId: sorted[0]?.sessionId ?? null, candidates: matching.length };
}

/**
 * 确保存在专属会话：先查、找不到则**在该管辖项目内**创建。
 *
 * @returns {Promise<{ok:true, sessionId:string, created:boolean, duplicates:number}|{ok:false,error:object}>}
 */
export async function ensureReviewSession(ctx, { projectId, projectRoot, activity }) {
  const found = await findReviewSession(ctx, { projectId });
  if (!found.ok) return found;
  if (found.sessionId !== null) {
    if (found.candidates > 1) {
      // 如实记录：规范已登记「可能产生第二个专属会话」，要求它**运行痕迹可见**。
      activity?.record?.("review/session-duplicate", { projectId, candidates: found.candidates });
    }
    return { ok: true, sessionId: found.sessionId, created: false, duplicates: found.candidates };
  }
  const controller = serviceOf(ctx, "sessionController");
  if (controller === undefined || typeof controller.create !== "function") {
    return { ok: false, error: { code: "review_session/service_unavailable", message: "sessionController.create is not wired into this composition" } };
  }
  try {
    // **分组与落点是两件事**（2026-10-26 实测修正）：
    //
    //   · `cwd` 决定会话的**工作目录**（它在哪里读写文件）；
    //   · `workspaceId` 决定会话在侧边栏归到**哪个分组**。
    //
    // 第一版只传了 `cwd`，于是会话建在了正确的目录下，却归进了「未分组」——
    // Human 从截图里一眼看出来。分组是 workspace 的事，不给就进未分组，这与
    // 「只在本项目内创建」看起来像但**不是同一件事**：前者关乎目录，后者关乎归属。
    //
    // 解析顺序：先按项目根查已存在的 workspace，查到就用它的 id；查不到就为这个
    // 目录建一个（`create(path, title)` 对同路径是幂等的：已存在则原样返回）。
    const workspaceId = await resolveWorkspaceId(ctx, projectRoot);
    // **`cwd` 与 `workspaceId` 互斥**（2026-10-27 实测报错原文：
    //   "session.create accepts workspaceId or cwd, not both"）。
    //
    // 我第一版两个都传，以为「双保险」更稳——实际宿主直接拒绝，于是**每次建会话都
    // 失败**，而失败点排在「协调是否跑起来」之后，前四轮排查都没看到它。
    //
    // 为什么给 `workspaceId` 就不必给 `cwd`：workspace 本身绑定一个目录，会话经由它
    // 就落在那个目录下。**两者不是「目录 + 分组」，而是「分组」或「裸目录」二选一**——
    // 我先前把 workspaceId 理解成「附加的分组标签」，那个理解是错的。
    //
    // 故：能解析到 workspace 就给 workspaceId（顺带把分组定好），解析不到才退回 cwd。
    const created = await controller.create(
      workspaceId === null ? { cwd: projectRoot } : { workspaceId },
    );
    const sessionId = created?.sessionId ?? null;
    if (sessionId === null) {
      return { ok: false, error: { code: "review_session/create_no_id", message: "sessionController.create returned no sessionId" } };
    }
    // 宿主侧把标题作为投影；我们通过 rename 设置它（创建时没有 title 字段）。
    if (typeof controller.rename === "function") {
      try {
        await controller.rename({ sessionId, title: reviewSessionTitle(projectId) });
      } catch (error) {
        // 标题设不上就**无法按固定标题找回**——下一次会再建一个。这是真实缺陷，
        // 必须如实报出而不是静默继续。
        return {
          ok: false,
          error: {
            code: "review_session/title_not_set",
            message: `the review session ${sessionId} was created but its title could not be set (${String(error?.message ?? error)}); without the fixed title the next run cannot find it and will create another`,
          },
        };
      }
    }
    return { ok: true, sessionId, created: true, duplicates: 0 };
  } catch (error) {
    return { ok: false, error: { code: "review_session/create_failed", message: String(error?.message ?? error) } };
  }
}

/**
 * 在指定会话上查找本插件的周期任务。
 *
 * **两道判据，缺一不可**：
 *   ① `row.sessionId === sessionId`——**自己再判一次会话归属**，不假设宿主的
 *      `list({sessionId})` 一定按参过滤；
 *   ② `prompt` 首部的本插件标签——同一会话可能还有别的任务，标题又可能被人工改，
 *      标签是唯一稳定的识别物（**不用标题**）。
 *
 * 第 ① 条是**实测教训**：多项目测试里两个项目只建出一条任务，根因就是这里原先只信
 * 宿主的过滤。若宿主的 filter 与实现有偏差（或某个实现直接返回全表），两个项目就会
 * 抢同一个任务行——后一个项目把自己当成「已有任务」，于是永不新建；而这个错误在单
 * 项目场景下**完全看不出来**。
 */
async function findOwnSchedules(schedule, sessionId) {
  const rows = await schedule.list({ sessionId });
  const mine = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    // ① 会话归属：自己判，不外包给宿主的过滤参数。
    if (row?.sessionId !== undefined && row.sessionId !== sessionId) continue;
    // ② 本插件标签。
    if (typeof row?.prompt === "string" && row.prompt.startsWith(`[${REVIEW_SCHEDULE_TAG}]`)) mine.push(row);
  }
  return mine;
}

async function findOwnSchedule(schedule, sessionId) {
  return (await findOwnSchedules(schedule, sessionId))[0];
}

/**
 * **自愈**：同一会话上若有多条本插件的周期任务，删掉多余的，保留最早创建的那条。
 *
 * ## 为什么要有（实测依据）
 *
 * 2026-10-26 收敛缺陷导致同一会话上出现了两条任务（相隔 25 毫秒），表现为
 * 「审核频率悄悄翻倍」——而界面上只是**看起来有两条一样的条目**，不显眼。Human
 * 靠截图才发现。并发缺陷已在协调层用串行队列修掉，但**已经产生的重复不会自己消失**，
 * 且未来的其它路径（比如两个进程、或手工建的一条）也可能造出重复。故此处的策略是：
 * **协调时顺手收敛**，而不是只依赖「不产生新的」。
 *
 * 保留**最早**那条（`scheduledAt` 升序取第一条）：它有最长的历史与最早的投递锚，
 * 删它反而会丢记录。
 *
 * @returns {Promise<{ok:true, kept:string|null, removed:string[], duplicates:number}>}
 */
export async function dedupeReviewSchedules(ctx, { sessionId, activity }) {
  const schedule = serviceOf(ctx, "schedule");
  if (schedule === undefined || typeof schedule.list !== "function" || typeof schedule.delete !== "function") {
    return { ok: false, error: { code: "review_schedule/service_unavailable", message: "schedule list/delete is not wired into this composition" } };
  }
  let rows;
  try {
    rows = await findOwnSchedules(schedule, sessionId);
  } catch (error) {
    return { ok: false, error: { code: "review_schedule/list_failed", message: String(error?.message ?? error) } };
  }
  if (rows.length <= 1) {
    return { ok: true, kept: rows[0]?.id ?? null, removed: [], duplicates: rows.length };
  }
  // 按 scheduledAt 升序（取不到时间的排后面，不因缺字段而误删最早那条）。
  const ordered = rows.slice().sort((a, b) => {
    const ta = typeof a.scheduledAt === "string" ? Date.parse(a.scheduledAt) : Number.POSITIVE_INFINITY;
    const tb = typeof b.scheduledAt === "string" ? Date.parse(b.scheduledAt) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
  const kept = ordered[0];
  const removed = [];
  for (const row of ordered.slice(1)) {
    try {
      await schedule.delete({ sessionId, id: row.id });
      removed.push(row.id);
    } catch (error) {
      // 删不掉就登记，不抛——收敛是尽力而为，删不动不该让整个协调失败。
      activity?.record?.("review/dedupe-delete-failed", { sessionId, id: row.id, reason: String(error?.message ?? error) });
    }
  }
  if (removed.length > 0) {
    activity?.record?.("review/dedupe", { sessionId, kept: kept.id, removed, duplicates: rows.length });
  }
  return { ok: true, kept: kept.id, removed, duplicates: rows.length };
}

/**
 * 确保周期任务存在且间隔正确。
 *
 * **原地更新**：已有任务只改间隔，不删后重建——删建之间有丢失窗口（§6.1 反对）。
 *
 * @returns {Promise<{ok:true, scheduleId:string, everySeconds:number, created:boolean}|{ok:false,error:object}>}
 */
export async function ensureReviewSchedule(ctx, { projectId, sessionId, intervalMs }) {
  const schedule = serviceOf(ctx, "schedule");
  if (schedule === undefined || typeof schedule.create !== "function") {
    return { ok: false, error: { code: "review_schedule/service_unavailable", message: "schedule is not wired into this composition" } };
  }
  // **非法间隔在写入时拒绝**（§6.1）：取 0／负数会让「到点」恒成立。
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    return {
      ok: false,
      error: {
        code: "review_schedule/invalid_interval",
        message: `review interval must be a positive integer of milliseconds (got ${JSON.stringify(intervalMs)}) — 11 §6.1 forbids 0/negative: they would make "due" always true`,
      },
    };
  }
  const everySeconds = Math.floor(intervalMs / 1000);
  if (everySeconds < 1) {
    return {
      ok: false,
      error: {
        code: "review_schedule/interval_too_small",
        message: `review interval must be at least 1000 ms (got ${intervalMs}) — a period that rounds to zero would make "due" always true`,
      },
    };
  }

  let existing;
  try {
    existing = await findOwnSchedule(schedule, sessionId);
  } catch (error) {
    // 列举失败时**不上抛也不假定「没有旧任务」**：假定没有就会创建第二条，于是
    // 同一会话出现两条周期任务、各自投递（§6.1 边界第 2 项：不声称恰好一次，
    // 但也不自造重复）。故如实失败。
    return { ok: false, error: { code: "review_schedule/list_failed", message: String(error?.message ?? error) } };
  }

  if (existing === undefined) {
    try {
      const record = await schedule.create(sessionId, {
        title: REVIEW_SCHEDULE_TITLE,
        prompt: reviewPrompt(projectId),
        every_seconds: everySeconds,
      });
      const id = record?.id ?? null;
      if (id === null) {
        return { ok: false, error: { code: "review_schedule/create_no_id", message: "schedule.create returned no id" } };
      }
      // **判别式核对**：宿主应回 `kind: 'every'`。若它静默存成了 `at`，那就是「接受了
      // 请求但行为不同」——审核只会跑一次而永不重复，而表面一切正常。必须报错。
      if (record.kind !== undefined && record.kind !== "every") {
        return {
          ok: false,
          error: {
            code: "review_schedule/kind_not_every",
            message: `schedule.create returned kind=${JSON.stringify(record.kind)} instead of 'every' — a periodic review stored as a one-shot would never run again`,
          },
        };
      }
      return { ok: true, scheduleId: id, everySeconds, created: true };
    } catch (error) {
      return { ok: false, error: { code: "review_schedule/create_failed", message: String(error?.message ?? error) } };
    }
  }

  // 已有任务：间隔相同则不动（避免无谓的冲突），不同则原地改。
  if (existing.everySeconds === everySeconds) {
    return { ok: true, scheduleId: existing.id, everySeconds, created: false };
  }
  try {
    const updated = await schedule.update({
      sessionId,
      id: existing.id,
      expected: existing,
      change: { kind: "every", every_seconds: everySeconds },
    });
    if (updated !== null && typeof updated === "object" && updated.updated === false) {
      return {
        ok: false,
        error: {
          code: "review_schedule/update_not_applied",
          message: `schedule.update was not applied: ${String(updated.code ?? "unknown")}`,
        },
      };
    }
    return { ok: true, scheduleId: updated?.id ?? existing.id, everySeconds, created: false };
  } catch (error) {
    return { ok: false, error: { code: "review_schedule/update_failed", message: String(error?.message ?? error) } };
  }
}

/** 撤掉周期任务（审核关闭时）。删不掉只登记，不抛。 */
export async function removeReviewSchedule(ctx, { sessionId, scheduleId, activity }) {
  const schedule = serviceOf(ctx, "schedule");
  if (schedule === undefined || typeof schedule.delete !== "function") {
    activity?.record?.("review/schedule-retire-skipped", { reason: "schedule service unavailable" });
    return { ok: false, error: { code: "review_schedule/service_unavailable", message: "schedule.delete is not wired into this composition" } };
  }
  try {
    const result = await schedule.delete({ sessionId, id: scheduleId });
    return { ok: true, deleted: result?.deleted === true };
  } catch (error) {
    activity?.record?.("review/schedule-retire-failed", { reason: String(error?.message ?? error) });
    return { ok: false, error: { code: "review_schedule/delete_failed", message: String(error?.message ?? error) } };
  }
}

/**
 * 落点会话是否正在跑回合（§6.1「不得并发开两个审核回合」的判据）。
 *
 * **判据是宿主的 `running` 投影**，不是我们自己的记账：宿主知道它有没有在跑驱动，
 * 而我们的进程内状态在重载后会丢。`SessionSummary.running` 正是这个事实。
 *
 * @returns {Promise<boolean>} true = 有回合在跑，本次投递应跳过。
 */
export async function isReviewSessionBusy(ctx, { sessionId }) {
  const controller = serviceOf(ctx, "sessionController");
  if (controller === undefined || typeof controller.list !== "function") {
    // 判不了就不放行：宁可跳过本次（下一周期自然会到），也不冒并发开两个审核的风险。
    return true;
  }
  try {
    const listed = await controller.list({}, new AbortController().signal);
    const item = (Array.isArray(listed?.items) ? listed.items : []).find((row) => row?.sessionId === sessionId);
    return item?.running === true;
  } catch {
    return true;
  }
}

/**
 * 一次完整的「确保已武装」：会话 + 周期任务。
 *
 * 这是 lifecycle 唯一需要调用的入口——它把「查会话 / 建会话 / 查任务 / 建任务」
 * 的顺序与失败处理收在一处，调用方不必知道细节。
 *
 * @returns {Promise<{ok:true, sessionId:string, scheduleId:string, sessionCreated:boolean, scheduleCreated:boolean, everySeconds:number}|{ok:false,error:object, stage:string}>}
 */
export async function armReviewAutomation(ctx, { projectId, projectRoot, intervalMs, activity }) {
  const session = await ensureReviewSession(ctx, { projectId, projectRoot, activity });
  if (!session.ok) return { ...session, stage: "session" };
  const schedule = await ensureReviewSchedule(ctx, {
    projectId,
    sessionId: session.sessionId,
    intervalMs,
  });
  if (!schedule.ok) return { ...schedule, stage: "schedule" };
  return {
    ok: true,
    sessionId: session.sessionId,
    scheduleId: schedule.scheduleId,
    sessionCreated: session.created,
    scheduleCreated: schedule.created,
    everySeconds: schedule.everySeconds,
  };
}
