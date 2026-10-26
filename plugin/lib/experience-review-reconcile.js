// dsh-ldvh — 设置变更时**当场重新协调**审核周期任务（2026-10-26）。
//
// ## 为什么需要这个文件（实测出来的缺陷）
//
// 第一版的武装写在 `agent/created` 的处理里。实测症状：Human 在设置面打开「自动
// 审核经验」并把间隔改成 2 分钟，**界面上勾了、配置也落盘了**
// （`cordis.patch.yml` 里 `experienceReviewEnabled: true` / `...IntervalMs: 120000`），
// 但系统里既没有专属会话、也没有周期任务。
//
// 根因两条，缺一不可：
//
// 1. **武装时机错**：`agent/created` 只在**新建 agent** 时触发。改设置不会创建
//    agent，所以那段代码根本不会重跑。
// 2. **没有监听配置热更新**：本插件此前完全没订阅 `app-boot/config-reload`。
//    宿主是有这个能力的——它的语义正是「Profile patches 已协调进运行中的 Loader
//    树」，**不携带 diff，监听者自行重读**。我们不重读，就永远停在装载那一刻的旧值。
//
// 于是「打开开关 → 重启才生效」。这在设置面上是**不可接受的**：一个勾了却毫无反应
// 的开关，比没有这个开关更糟——它让人以为已经在工作。
//
// ## 本文件的做法
//
// 订阅 `app-boot/config-reload`（以及设置文档变更，两者覆盖面互补）：重读设置 →
// 按三种情形收敛：
//
//   · 应当武装（开关开）且当前未武装 / 运行参数与设置不符 → 武装（原地改间隔）
//   · 应当撤除（开关关）且当前已武装 → 撤除周期任务
//   · 状态已一致 → 不动（不做无谓的宿主调用）
//
// **不删专属会话**：撤除只撤周期任务。会话里可能有历次审核的运行痕迹，删了不可逆，
// 且 Human 可能还想翻看。故「关掉审核」= 不再自动跑，不是「把历史抹掉」。
//
// ## 为什么按项目逐个处理
//
// 审核的落点**按管辖项目唯一**（§6.1：一个项目至多一个专属会话，不得跨项目）。
// 故协调必须遍历全部已登记项目，而不是只处理当前会话所属的那个——否则在 A 项目里
// 改设置，B 项目的周期任务永远不会被同步。
import { armReviewAutomation, dedupeReviewSchedules, ensureReviewSchedule, findReviewSession, removeReviewSchedule } from "./experience-review-schedule.js";

/**
 * 协调一个项目的审核周期任务。
 *
 * @param {object} args
 * @param {object} args.ctx - 宿主上下文（须能取 schedule / sessionController）
 * @param {object} args.project - `{ id, path }`
 * @param {object} args.settings - `resolveIdleSettings` 的结果
 * @param {object} [args.activity] - 活动轨迹（记账用）
 * @returns {Promise<{action:string, ok:boolean, detail?:object}>}
 */
/**
 * 取宿主服务；未装配时返回 `undefined`（不抛）。
 *
 * **只能走 `ctx.get`**：这些服务不在本插件的 `inject` 里，而 cordis 的 Proxy 对
 * 「未 inject 且无 provide」的属性访问**直接抛错**（2026-10-22 实测）。
 * 本文件与 experience-review-schedule.js 各有一份同名实现——两处都只有三行，
 * 抽成共享模块会让「谁依赖谁」变复杂，而这里没有第二个消费者。
 */
function serviceOf(ctx, name) {
  try {
    return ctx.get(name);
  } catch {
    return undefined;
  }
}

export async function reconcileProjectReview(args) {
  // **串行化下沉到这一层**（2026-10-26 修正）：第一版把队列放在
  // `reconcileAllProjects` 上，结果测试直接调本函数时绕过了队列——并发建出 3 个
  // 会话。防护必须放在**真正做写入的那一层**，而不是它的调用者之一；否则任何新的
  // 调用路径都会绕过它。这正是「防护位置选在用法上而非性质上」的典型错误。
  return enqueueReconcile(() => reconcileProjectReviewNow(args));
}

async function reconcileProjectReviewNow({ ctx, project, settings, activity }) {
  const wanted = settings?.review?.enabled === true;
  const intervalMs = settings?.review?.intervalMs;
  const projectId = project?.id;
  const projectRoot = project?.path;
  if (typeof projectId !== "string" || projectId.length === 0) {
    return { action: "skipped", ok: false, detail: { reason: "project id missing" } };
  }

  // 先看当前有没有专属会话与周期任务——决定「武装 / 改间隔 / 撤除 / 不动」。
  const found = await findReviewSession(ctx, { projectId });
  if (!found.ok) {
    return { action: "failed", ok: false, detail: { stage: "find-session", error: found.error } };
  }

  if (!wanted) {
    // 应当撤除。没有会话 = 从来没有武装过，什么都不用做。
    if (found.sessionId === null) return { action: "noop", ok: true, detail: { reason: "disabled and never armed" } };
    const schedule = await findProjectSchedule(ctx, { sessionId: found.sessionId });
    if (!schedule.ok) {
      return { action: "failed", ok: false, detail: { stage: "find-schedule", error: schedule.error } };
    }
    if (schedule.value === null) {
      return { action: "noop", ok: true, detail: { reason: "disabled and no schedule present" } };
    }
    const removed = await removeReviewSchedule(ctx, { sessionId: found.sessionId, scheduleId: schedule.value, activity });
    if (!removed.ok) {
      return { action: "failed", ok: false, detail: { stage: "remove", error: removed.error } };
    }
    activity?.record?.("review/disarmed", { projectId, scheduleId: schedule.value });
    return { action: "disarmed", ok: true, detail: { projectId, scheduleId: schedule.value } };
  }

  // 应当武装。**先收敛重复**：同一会话若已有多条本插件任务（历史并发缺陷、或别的
  // 路径造成），先删多余的，再按「已有则改间隔」处理。不先收敛的话，后面
  // ensureReviewSchedule 只会改第一条，其余继续按自己的间隔投递——审核频率翻倍。
  if (found.sessionId !== null) {
    const deduped = await dedupeReviewSchedules(ctx, { sessionId: found.sessionId, activity });
    if (deduped.ok && deduped.removed.length > 0) {
      activity?.record?.("review/reconcile-deduped", {
        projectId,
        kept: deduped.kept,
        removed: deduped.removed,
        duplicates: deduped.duplicates,
      });
    }
  }
  if (found.sessionId !== null) {
    const schedule = await findProjectSchedule(ctx, { sessionId: found.sessionId });
    if (!schedule.ok) {
      return { action: "failed", ok: false, detail: { stage: "find-schedule", error: schedule.error } };
    }
    if (schedule.value !== null) {
      const updated = await ensureReviewSchedule(ctx, { projectId, sessionId: found.sessionId, intervalMs });
      if (!updated.ok) {
        return { action: "failed", ok: false, detail: { stage: "update-schedule", error: updated.error } };
      }
      const action = updated.created ? "armed" : "interval-synced";
      activity?.record?.(`review/${action}`, { projectId, everySeconds: updated.everySeconds });
      return { action, ok: true, detail: { projectId, scheduleId: updated.scheduleId, everySeconds: updated.everySeconds } };
    }
    // 会话在、任务不在：补建任务（不重建会话）。
    const created = await ensureReviewSchedule(ctx, { projectId, sessionId: found.sessionId, intervalMs });
    if (!created.ok) {
      return { action: "failed", ok: false, detail: { stage: "create-schedule", error: created.error } };
    }
    activity?.record?.("review/armed", { projectId, scheduleId: created.scheduleId, everySeconds: created.everySeconds, sessionCreated: false });
    return { action: "armed", ok: true, detail: { projectId, scheduleId: created.scheduleId, everySeconds: created.everySeconds } };
  }

  // **归档会话上的孤儿任务**（2026-10-26）：落点会话被归档后，`findReviewSession`
  // 不再把它当命中，本节会新建一个会话；但**旧会话上那条周期任务还在**，会继续按
  // 自己的间隔往一个已归档（用户已收起）的对话里投递——看不见、也停不下来。
  // 故新建前先把归档会话上的本插件任务撤掉。
  //
  // 判据：本插件任务所绑的会话**已归档**。不靠「会话不在 list 里」推断——会话可能
  // 只是没被 list 返回，那与「被归档」是两件事。
  try {
    const orphans = await retireArchivedSessionSchedules(ctx, { activity });
    if (orphans.removed.length > 0) {
      activity?.record?.("review/orphans-retired", { removed: orphans.removed });
    }
  } catch (error) {
    // 清孤儿是尽力而为：清不掉不该阻断新会话的建立（那样审核就完全不跑了）。
    activity?.record?.("review/orphan-cleanup-failed", { reason: String(error?.message ?? error) });
  }

  const armed = await armReviewAutomation(ctx, { projectId, projectRoot, intervalMs, activity });
  if (!armed.ok) {
    return { action: "failed", ok: false, detail: { stage: armed.stage, error: armed.error } };
  }
  activity?.record?.("review/armed", {
    projectId,
    sessionId: armed.sessionId,
    scheduleId: armed.scheduleId,
    everySeconds: armed.everySeconds,
    sessionCreated: armed.sessionCreated,
  });
  return {
    action: "armed",
    ok: true,
    detail: { projectId, sessionId: armed.sessionId, scheduleId: armed.scheduleId, everySeconds: armed.everySeconds },
  };
}

/**
 * 撤掉**绑在已归档会话上**的本插件周期任务。
 *
 * 见调用处的注释：归档会话不再是落点，但它上面若还挂着任务，就会继续往一个用户
 * 已经收起的对话里投递。这类任务在新代码下不会再被创建（`findReviewSession` 已
 * 排除归档），故这里是**收历史遗留**，不是常规路径。
 */
async function retireArchivedSessionSchedules(ctx, { activity }) {
  const schedule = serviceOf(ctx, "schedule");
  if (schedule === undefined || typeof schedule.list !== "function" || typeof schedule.delete !== "function") {
    return { removed: [] };
  }
  // 归档集合：经 workspaceController 读（与 findReviewSession 同源）。
  const controller = serviceOf(ctx, "workspaceController");
  if (controller === undefined || typeof controller.follow !== "function") return { removed: [] };
  let archived;
  try {
    const iterator = controller.follow(new AbortController().signal);
    try {
      for await (const frame of iterator) {
        if (frame?.type === "baseline" && Array.isArray(frame.value?.archivedSessionIds)) {
          archived = new Set(frame.value.archivedSessionIds);
        }
        break;
      }
    } finally {
      try { await iterator?.return?.(); } catch { /* 关闭失败不影响结论 */ }
    }
  } catch {
    return { removed: [] };
  }
  if (archived === undefined) return { removed: [] };

  // 全表扫描本插件任务：schedule.list 需要一个 sessionId，故先取全部会话 id
  // 会出现「不知道往哪查」的问题。改用 catalog（不绑会话、返回全部任务）。
  let rows;
  try {
    rows = typeof schedule.catalog === "function" ? await schedule.catalog() : [];
  } catch {
    return { removed: [] };
  }
  const removed = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const rec = row?.record ?? row;
    const sessionId = row?.sessionId ?? rec?.sessionId;
    const prompt = typeof rec?.prompt === "string" ? rec.prompt : "";
    if (!prompt.startsWith("[dsh-ldvh:experience-review]")) continue;
    if (sessionId === undefined || !archived.has(sessionId)) continue;
    try {
      await schedule.delete({ sessionId, id: rec?.id ?? row?.id });
      removed.push(rec?.id ?? row?.id);
    } catch (error) {
      activity?.record?.("review/orphan-delete-failed", { sessionId, reason: String(error?.message ?? error) });
    }
  }
  return { removed };
}

/** 在专属会话上找本插件的周期任务，返回其 id 或 null。 */
async function findProjectSchedule(ctx, { sessionId }) {
  let schedule;
  try {
    schedule = ctx.get("schedule");
  } catch {
    schedule = undefined;
  }
  if (schedule === undefined || typeof schedule.list !== "function") {
    return { ok: false, error: { code: "review_schedule/service_unavailable", message: "schedule is not wired into this composition" } };
  }
  try {
    const rows = await schedule.list({ sessionId });
    const own = (Array.isArray(rows) ? rows : []).find(
      (row) => typeof row?.prompt === "string" && row.prompt.startsWith("[dsh-ldvh:experience-review]"),
    );
    return { ok: true, value: own?.id ?? null };
  } catch (error) {
    return { ok: false, error: { code: "review_schedule/list_failed", message: String(error?.message ?? error) } };
  }
}

/**
 * 对**全部已登记项目**重新协调。
 *
 * 单个项目失败**不阻断**其余项目：A 项目的会话建不出来（比如磁盘问题）不该让
 * B 项目也停摆。每个项目的结果都收进返回值，调用方如实记账。
 *
 * @returns {Promise<{results:Array<{projectId:string, action:string, ok:boolean, detail?:object}>}>}
 */
/**
 * 进程内**串行队列**：所有协调按到达顺序一条一条跑（2026-10-26 并发缺陷修复）。
 *
 * ## 为什么必须有（实测依据）
 *
 * 症状：Human 打开审核后，**同一个专属会话上出现了两条周期任务**，
 * `scheduledAt` 相差 **25 毫秒**（15:14:50.619 / .644）。
 *
 * 根因：本插件订阅了两个事件（`app-boot/config-reload` 与
 * `settings/document-updated`）。改一次设置两个都触发，两次协调几乎同时进入
 * `ensureReviewSchedule`——它**先查后建**，两次都读到「没有任务」，于是各建一条。
 *
 * 我原以为「序号守卫 + 状态一致则不动」能吸收重复触发。**这个判断是错的**：
 * 序号守卫只保证最后一次的结论不被旧结果覆盖，不阻止两次都真的去创建。
 *
 * ## 为什么是队列而不是锁
 *
 * 协调是**幂等**的（查→对齐→不动或补建），故不需要「拒绝第二个」；只需要让第二个
 * 在第一个**做完之后**再看一次状态——那时它就会看到任务已存在，于是不动。队列正好
 * 给出这个语义，且不必处理「锁超时」「锁泄漏」。
 *
 * 队列按模块实例持有：同一进程内所有协调共享。跨进程不共享——但协调只在宿主主
 * 进程内被这些事件触发，没有第二个写入者。
 */
const reconcileQueue = [];
let reconcileRunning = false;

function enqueueReconcile(task) {
  return new Promise((resolve, reject) => {
    reconcileQueue.push({ task, resolve, reject });
    drainReconcileQueue();
  });
}

function drainReconcileQueue() {
  if (reconcileRunning) return;
  const next = reconcileQueue.shift();
  if (next === undefined) return;
  reconcileRunning = true;
  Promise.resolve()
    .then(() => next.task())
    .then(
      (value) => { reconcileRunning = false; next.resolve(value); drainReconcileQueue(); },
      (error) => { reconcileRunning = false; next.reject(error); drainReconcileQueue(); },
    );
}

/** 供测试断言：队列是否已排空（不等待，只读）。 */
export function reconcileQueueIdle() {
  return reconcileRunning === false && reconcileQueue.length === 0;
}

/**
 * 重新协调**全部已登记项目**。
 *
 * **经串行队列执行**：调用方可以并发调用任意多次，实际协调永远是串行的——
 * 于是「先查后建」的中间窗口不再可能被两次调用同时穿过。
 */
export async function reconcileAllProjects({ ctx, projects, settings, activity }) {
  // **不再自己入队**：串行化已下沉到 `reconcileProjectReview`（真正写入的那层）。
  // 若这里也入队，内层再入队就会自我等待——第一个任务占着 `reconcileRunning`
  // 等自己的子任务，而死锁。故本函数只做遍历，逐项调用已串行化的下层。
  return reconcileAllProjectsNow({ ctx, projects, settings, activity });
}

async function reconcileAllProjectsNow({ ctx, projects, settings, activity }) {
  const results = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    // 只处理**可解析**的项目（inspectCandidate 失败的项目路径可能已不存在）。
    if (project?.status?.error !== undefined) {
      results.push({ projectId: project?.id ?? "(unknown)", action: "skipped", ok: false, detail: { reason: "project path unresolved", error: project.status.error } });
      continue;
    }
    try {
      const one = await reconcileProjectReview({ ctx, project, settings, activity });
      results.push({ projectId: project?.id ?? "(unknown)", ...one });
    } catch (error) {
      results.push({ projectId: project?.id ?? "(unknown)", action: "failed", ok: false, detail: { reason: String(error?.message ?? error) } });
    }
  }
  return { results };
}
