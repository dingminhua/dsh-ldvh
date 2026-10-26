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
import { armReviewAutomation, ensureReviewSchedule, findReviewSession, removeReviewSchedule } from "./experience-review-schedule.js";

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
export async function reconcileProjectReview({ ctx, project, settings, activity }) {
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

  // 应当武装。已有会话则只同步间隔（原地改），没有则完整武装（含建会话）。
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
export async function reconcileAllProjects({ ctx, projects, settings, activity }) {
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
