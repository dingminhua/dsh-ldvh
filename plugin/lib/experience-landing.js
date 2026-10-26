/**
 * dsh-ldvh — 闲时辅助「积累经验」**捕获段的落地**（11 §10.1 第 2 项）.
 *
 * ## 本模块只做一件事：把捕获段的判断写成**一条留观缓冲条目**
 *
 * 缓冲条目**不是事实对象**（11 §12bis 定性）：它不适用事实类型契约、不参与
 * 受控写入、不进 `ldvh-base/`、不取得授权或结论效力、不需要 `change_log` 署名。
 * 故本模块**不调用** `createPitfallObject`——建 Pitfall `draft` 是审核段的事
 * （`observation-review.js`，11 §10.2 第 3 项）。
 *
 * ## 为什么这里没有「查重」与「无候选」的处置
 *
 * 2026-10-20 两段式改造后：
 *
 * - 查重移入审核段（§10.2 第 2 项，23 §6.2）——捕获段拿到既有对象只会诱使它
 *   做「这是不是重复」的判断，而 §10.1 明文禁止该判断；
 * - 捕获段的「无失败」态不产出任何对象，故本模块返回 `{action:"none"}`——
 *   它是**如实登记的「本次没有观察到失败」**，不是「确认没有失败机制」。
 *
 * ## 署名
 *
 * 缓冲条目无署名（不是事实对象，`change_log` 是事实类型的载体字段）。执行体
 * 身份仍由编排层从 DSH 权威会话取得并记进运行日志（lifecycle 的
 * `executorSignature`），只是**不写进缓冲条目**——§12bis 的字段闭集只有 9 项，
 * 多写一项即越界。
 */

import { appendBufferEntry } from "./observation-buffer.js";

const success = (value) => ({ ok: true, value });
const failure = (code, message, details = {}) => ({ ok: false, error: { code, message, ...details } });

/**
 * 把捕获段的判断落地。
 *
 * @param {object} args
 * @param {Function} args.dshHomePath - 宿主侧持久化根的路径解析器
 *   （`(...segments) => path`，与 `pending-queue.js` / `observation-buffer.js` 同形；
 *   缓冲载体在其下的 `ldvh/` 内）
 * @param {object} args.verdict - 捕获段经 `validateCaptureVerdict` 通过的 `value`
 * @param {string} [args.observationAt] - 观察时间（区间终点时刻），缺省取当前时间
 * @param {string} [args.sessionId] - 来源会话标识（§12bis 的 `session` 字段）
 * @param {string} [args.anchor] - 来源位置（§12bis 的 `anchor` 字段，§11 序键）
 * @returns {Promise<{ok:true, value:{action:string, entry_id?:string}}|{ok:false, error:object}>}
 */
export async function landCaptureVerdict({
  dshHomePath, verdict, observationAt, sessionId, anchor, projectId,
} = {}) {
  if (typeof dshHomePath !== "function") {
    return failure("capture/home_missing", "dshHomePath resolver is required to locate the observation buffer (11 §12bis)");
  }
  // **按管辖项目分载体**（§12bis 载体段，2026-10 修订，Human 决定）：缺 projectId 会
  // 写进所有项目共用的旧全局载体，正是该修订要纠正的已知缺陷。代码选择拒绝而不是
  // 落到旧位置——静默回落会让「忘了传」看起来完全正常。
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    return failure(
      "capture/project_missing",
      "projectId is required — the observation buffer is partitioned per governed project (11 §12bis 载体段 2026-10 修订); writing to the shared legacy carrier would mix this project's material with every other project's",
    );
  }
  if (typeof verdict !== "object" || verdict === null) {
    return failure("capture/verdict_missing", "verdict must be the validated capture verdict object");
  }

  const at = typeof observationAt === "string" && observationAt.length > 0
    ? observationAt
    : new Date().toISOString();

  // no-failure：本次没有观察到失败现象——不产出任何对象（§10.1「无失败」态）。
  if (verdict.verdict === "no-failure") {
    return success({ action: "none" });
  }
  if (verdict.verdict !== "failure-observed" || typeof verdict.entry !== "object" || verdict.entry === null) {
    return failure(
      "capture/verdict_unusable",
      `verdict ${JSON.stringify(verdict.verdict)} carries no buffer entry — only a verdict that passed validateCaptureVerdict can be landed`,
    );
  }

  // `session` / `anchor` 是 §12bis 的必填字段（回指来源）。取不到时**不臆造**：
  // 写入一条无法回指的条目会使审核段无从核对证据，故如实失败。
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return failure("capture/session_missing", "session is required for a buffer entry (11 §12bis field `session`; it must not be fabricated)");
  }
  if (typeof anchor !== "string" || anchor.trim().length === 0) {
    return failure("capture/anchor_missing", "anchor is required for a buffer entry (11 §12bis field `anchor`; it must point at the source position)");
  }

  const appended = await appendBufferEntry(dshHomePath, {
    session: sessionId,
    anchor,
    phenomenon: verdict.entry.phenomenon,
    evidence: verdict.entry.evidence,
    candidate_question: verdict.entry.candidate_question,
    at,
  }, { projectId });
  if (!appended.ok) {
    // §12 fail-closed：缓冲不可写/回读不通过时不得降级为内存或日志（§12bis 纪律 4）。
    return failure(
      appended.error?.code ?? "capture/buffer_write_failed",
      `11 §12bis（写留观缓冲条目）失败：${appended.error?.message ?? "unknown"}`,
      { stage: "buffer-append", cause: appended.error },
    );
  }

  return success({ action: "buffer-appended", entry_id: appended.value.entry_id });
}

/**
 * 把落地错误转成待处置队列的 `residual` 条目（§12 的登记纪律：诊断不丢）。
 *
 * @param {object} error - `landCaptureVerdict` 返回的 `error` 对象
 * @returns {string[]}
 */
export function residualFromCaptureError(error) {
  if (typeof error !== "object" || error === null) return ["（无诊断信息）"];
  const lines = [];
  if (typeof error.code === "string" && error.code.length > 0) lines.push(`错误码 ${error.code}`);
  if (typeof error.message === "string" && error.message.length > 0) lines.push(error.message);
  const issues = error.cause?.details?.issues ?? error.issues;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      lines.push(`· ${typeof issue === "string" ? issue : JSON.stringify(issue)}`);
    }
  }
  return lines.length > 0 ? lines : ["（无诊断信息）"];
}
