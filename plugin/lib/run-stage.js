/**
 * dsh-ldvh — 运行痕迹 stage 的**唯一派生点**（specs/11 §18 配套）。
 *
 * ## 为什么必须收敛成一处
 *
 * stage 派生此前散在三处（`lifecycle.js` 的 :700、:1028、:1445），形态还不同：
 * 前两处是**单任务三元式** `landed / skipped / else land-failed`，第三处是多任务
 * 的 IIFE（`landedN === 0 → land-failed`，但有 `return "partial"`）。
 *
 * 后果是 `per_task.outcome = "partial"` 一旦出现，前两处会把它记成 `land-failed`
 * ——**「部分完成」被记成「失败」**。修一处漏两处是这种散落的必然结局，所以本模块
 * 存在的理由不是「抽个函数好看」，而是让「新增第四处调用点」不再需要各自实现。
 *
 * ## 派生规则
 *
 * | 输入 | stage |
 * |---|---|
 * | 无任务结局 | `skipped`（或 `not-implemented`，由调用方的 checkpoint 决定） |
 * | checkpoint 失败 | `stopped` |
 * | 全部 landed | `landed` |
 * | 全部未 landed（无一成功） | `land-failed` |
 * | 有成有败（含 partial） | `partial` |
 *
 * **`partial` 必须显式识别**，不能让它掉进 `landedN === 0` 那个分支：单任务
 * outcome=partial 时 `landedN` 就是 0，不加判断就会被记成失败。
 */

/** `per_task.outcome` 的闭集（与 `idle-runlog.js:135` 的说明一致）。 */
export const TASK_OUTCOMES = Object.freeze(["landed", "skipped", "rejected", "land-failed", "partial"]);

/** `stage` 的闭集（与 `idle-runlog.js:121-123` 的枚举一致，含 partial）。 */
export const RUN_STAGES = Object.freeze([
  "skipped",
  "not-implemented",
  "throttled",
  "stopped",
  "landed",
  "land-failed",
  "partial",
]);

/**
 * 由逐任务结局派生整轮 stage。
 *
 * @param {object} args
 * @param {boolean} [args.checkpointOk=true] - checkpoint 是否成功；false → `stopped`
 * @param {object} [args.taskOutcomes] - `{任务键: {outcome}}`
 * @param {string} [args.emptyStage] - 无任务结局时的 stage（`skipped` / `not-implemented`）
 * @returns {string} stage（必属 `RUN_STAGES`）
 */
export function deriveStage({ checkpointOk = true, taskOutcomes = {}, emptyStage = "skipped" } = {}) {
  if (checkpointOk !== true) return "stopped";
  const outcomes = Object.values(taskOutcomes ?? {}).map((o) => o?.outcome).filter(Boolean);
  if (outcomes.length === 0) return emptyStage === "not-implemented" ? "not-implemented" : "skipped";

  const landedN = outcomes.filter((o) => o === "landed").length;
  if (landedN === outcomes.length) return "landed";

  // **partial 必须先于「全未落地」判断**：单任务 outcome=partial 时 landedN 为 0，
  // 若先判 landedN === 0，就会把「部分完成」记成「失败」——那正是本模块要消除的。
  const partialN = outcomes.filter((o) => o === "partial").length;
  if (partialN > 0) return "partial";

  if (landedN === 0) return "land-failed";
  return "partial";
}
