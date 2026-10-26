/**
 * dsh-ldvh — 「经验审核」的触发时机（2026-10-27 重做，Human 方案）。
 *
 * ## 为什么要重做
 *
 * 原实现按 `specs/11 §6.1` 形态 2 走「宿主周期任务 + 绑定专属会话」：每小时由宿主
 * 投递一条提醒到那个会话，再由会话里的主控执行审核。**实测暴露一个结构性缺陷**：
 *
 * 那个「专属会话」是一个**普通的、出现在侧边栏的对话**。它会被人当成新对话使用——
 * 2026-10-27 实测：`session-2827e177` 在 03:22:51 被本插件创建（标题「LDVH 经验
 * 审核 · dsh-ldvh」），03:29:49 Human 就在里面提问「经验召回是否有作用」。
 *
 * 后果不是「提醒投错」，而是**这个对话同时是 Human 的工作对话和审核落点**：
 * 审核提醒直接投进 Human 正在工作的对话，而 Human 的内容也被当成审核上下文。
 * 只改投递路由治不了——只要落点是一个可用对话，就随时会被占用。
 *
 * ## 现在的做法（Human 2026-10-27 指定）
 *
 * **不再有落点会话。** 审核改为挂在**静置触发**上，并在派发前判断「当前是否已有检查
 * 任务在跑」：
 *
 *   静置到期 → 有检查在跑？ ─有→ 本次不派发（下一周期自然还会到）
 *                          └无→ 派发一次**零上下文**的审核执行体
 *
 * 这样：① 不需要专属会话，占用人类对话的结构性问题消失；② 审核天然跑在「系统没在
 * 忙」的时机，与「闲时辅助」的语义一致；③ 并发由「有没有检查在跑」直接挡住，不再
 * 依赖「某个会话忙不忙」这个间接判据。
 *
 * ## 与 §6.1 两种形态的关系
 *
 * 本模块只负责**形态 2（固定间隔的审核）**的触发判定。形态 1（一次延迟）仍由
 * 会话内安静期计时承载，两者共用同一个静置检查点，但**各自判各自的间隔**——
 * 间隔语义不同（形态 1 是「安静满 N」，形态 2 是「距上次审核满 N」）。
 *
 * ## 为什么「判不了」要选择不派发
 *
 * `list()` 拿不到、`running` 读不出时，本模块一律**不派发**。理由：这是一个周期性
 * 任务，跳过这一次的代价只是「这次不跑，下个周期还会到」；而误判成「没在跑」的代价
 * 是**并发两个审核执行体**，它们会读到同一批 pending 条目、各自成文——直接违反
 * 「每次最多 1 条候选」（§10.2），且事后无法分辨哪份结论属于哪次。故 fail-closed。
 */


/**
 * 进程内「审核是否正在跑」的互斥标志（模块级单例）。
 *
 * ## 为什么用进程内标志，而不是去探测会话运行态
 *
 * 我先写的是「查 `sessionController.list()` 里有没有 running 的审核子代理」——那个
 * 判据**不可靠**，因为：
 *
 *   · `SessionSummary` 不暴露子代理的 `label`，而会话标题是从**提示词首行**生成的
 *     （实测：`ldvh-review ...` 的 label 对应标题却是「你是 LDVH 的…执行体」），
 *     故无法从列表里认出「哪一个是审核」；
 *   · `origin === 'subagent' && running` 会把**任何**子代理算进来（空闲捕获、摩擦
 *     发现、草稿审核……都走子代理），审核于是几乎永远看到「有在跑」而不派发。
 *
 * 而**同一次审核不会跨进程**：审核是一段有界的子代理执行，进程重启时它必然已中断。
 * 故进程内标志足以承担这个互斥，且比任何外部探测都准——它记录的是「我自己发起的
 * 那个审核还没结束」，没有猜测成分。
 *
 * 跨进程（多实例同开一个 profile）时该标志不共享，那种情形下并发保护退化为
 * 「各实例各自最多一个审核」，属实情，不夸大。
 */
let reviewRunning = false;
let reviewStartedAt = null;
/** 上次**完成**一次审核的时刻（毫秒）；null = 本进程内从未跑过。 */
let lastReviewCompletedAtMs = null;

/** 记录一次审核已完成（由派发侧在跑完之后调用）。 */
export function markReviewCompleted(nowMs = Date.now()) {
  lastReviewCompletedAtMs = nowMs;
}

/** 读「距上次审核完成多久」的判定用状态。 */
export function reviewTiming() {
  return { lastCompletedAtMs: lastReviewCompletedAtMs };
}

/** 供派发侧查询：当前是否有本插件发起的审核正在执行。 */
export function isReviewRunning() {
  return { busy: reviewRunning, reason: reviewRunning ? "review-in-flight" : "idle", startedAt: reviewStartedAt };
}

/**
 * 在互斥保护下执行一次审核。已在跑时**不执行**并如实回报，不排队。
 *
 * 为什么选择「跳过」而不是「排队」：审核是周期性任务，下一周期自然会到；排队会让
 * 一个积压的审核在很久之后仍然执行，对着过时的缓冲内容成文。`specs/11 §6.1` 对
 * 这个二选一只要求「不得并发」，并明确「跳过时须如实记账」——本函数返回
 * `{skipped: true}` 交调用方记账。
 */
export async function runReviewExclusive(fn) {
  if (reviewRunning) {
    return { skipped: true, reason: "review-in-flight" };
  }
  reviewRunning = true;
  reviewStartedAt = new Date().toISOString();
  try {
    return { skipped: false, value: await fn() };
  } finally {
    reviewRunning = false;
    reviewStartedAt = null;
  }
}

/**
 * 形态 2 的到期判定：距上次审核是否已满一个间隔。
 *
 * **间隔计的是「距上次审核」而不是「距上次静置」**——后者会让审核频率被对话节奏
 * 绑死（聊得越多审得越勤），那不是 Human 要的语义。
 *
 * @param {object} args
 * @param {number|null} args.lastRunAtMs 上次审核的时刻（毫秒）；null 表示从未跑过
 * @param {number} args.intervalMs 配置的间隔
 * @param {number} args.nowMs 当前时刻
 */
export function isReviewDue({ lastRunAtMs, intervalMs, nowMs }) {
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return { due: false, reason: "interval-invalid" };
  }
  if (lastRunAtMs === null || lastRunAtMs === undefined) {
    // 从未跑过：**立即到期**。首次不该再等一个完整间隔——否则开启后一小时才第一次审核。
    return { due: true, reason: "never-ran" };
  }
  if (typeof lastRunAtMs !== "number" || !Number.isFinite(lastRunAtMs)) {
    return { due: false, reason: "last-run-unreadable" };
  }
  const elapsed = nowMs - lastRunAtMs;
  if (elapsed >= intervalMs) {
    return { due: true, reason: "interval-elapsed", elapsedMs: elapsed };
  }
  return { due: false, reason: "not-yet", remainingMs: intervalMs - elapsed };
}

