/**
 * dsh-ldvh — 空闲辅助任务的调度与 fail-closed 编排.
 *
 * 权威：specs/04 §8.4（摩擦发现的触发、执行体、闭集与上限）与 §8.3（fail-closed
 * 与待处置队列）；specs/32 §10.2（三任务共用触发点、按预算轮换）。
 *
 * 本模块是**编排层**，只做三件 Code 能确定性完成的事：
 *
 *   1. **预算轮换**（32 §10.2）：一次检查点只跑一个辅助任务，按「评审优先、容量
 *      次之、体检周期性」轮换，任一轮尽则顺延，**不堆积**。
 *   2. **调度摩擦发现**：调用闭集执行体（friction-discovery.js）。本模块**不**
 *      代替子代理做语义查重——那一步是 §8.4 明文登记的 gap，只能由派生出的
 *      LLM 子代理完成。因此本模块在无子代理结果时**不创建账目**（见下）。
 *   3. **fail-closed 与待处置登记**（§8.3）：任何一步失败即停止该次任务，把停止
 *      原因与残留范围**追加**进待处置队列，**不重试、不部分完成、不静默**。
 *
 * **为什么本模块不自己「发现摩擦」**：§8.4 的执行体是「宿主派生一个受管辖隔离
 * 子代理……继承发起会话的主控上下文——用于判断某现象是否构成系统性阻碍」。该判断
 * 是语义判断（§8.2 第 1 条后半句明文不由机械校验保障）。Code 无法替代它，也不
 * 得伪造一个「机械查重」冒充它。故本模块的角色是：**为子代理准备好机械前提
 * （阈值可用、账本可读、队列可写），并把子代理的判断结果机械落地**。
 *
 * 本模块**不主张机制已运行**（§8.5）：它是否具备属实现现状，由读取时的观察取得。
 */

import { appendPendingEntry } from "./pending-queue.js";
// advanceWatermark 于本次改动前就已是未使用的导入（它在 `git show HEAD` 里也只
// 出现在这一行）——水位推进由调用方（lifecycle）在落地成功后执行，本模块已不自行
// 推进（见下方「水位推进必须以落地成功为前提」的说明）。故一并删除。
import { readWatermark, describeWindow } from "./friction-watermark.js";
import {
  verifyThresholdAvailable,
  loadDedupCandidates,
  FRICTION_THRESHOLD_N,
} from "./friction-discovery.js";

/**
 * 辅助任务标识（§8.3 第 2 条 `task` 字段的取值）。
 *
 * **单一来源**是 `aux-task-registry.js` 的 `AUX_TASK_ORDER`——此处只做改名导出，
 * 不另定义一份清单。两份清单会漂移，而「哪些任务在册」是登记表的事实。
 */
export { AUX_TASK_ORDER as AUX_TASKS } from "./aux-task-registry.js";

// 本模块**不再**承担任务轮换：Human 于 2026-10-11 删除轮换概念（一次派发做
// 全部已启用的事，见 `idle-settings.js` 的 `pickEnabledAuxTasks`）。
//
// 原 `selectAuxTask(rotation)` 与 `HEALTH_CHECK_PERIOD = 3` 已删——它们的依据是
// `specs/32 §10.2`（候选设计）的「按预算轮换」，该条文的调度效力已随本次改案
// 移除。删除同时消除了两个既有缺陷：轮换位死锁（停用任务占住相位不放）与
// 「某任务不在任何相位上」（`capacity-maintenance` 实测 60 个相位里被选中 0 次）。

function failure(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

function success(value) {
  return { ok: true, value };
}

/**
 * 跑一次空闲检查点（§8.3 fail-closed 的唯一收口处）。
 *
 * 参数：
 *   - `dshHomePath`：待处置队列的宿主位置（§8.3 第 1 条）。
 *   - `factSourceRoot`：受管辖项目的事实源根（`<project>/ldvh-base`）。
 *   - `tasks`：本次要做的**全部**任务（有序；取自 `pickEnabledAuxTasks`）。
 *     Human 2026-10-11 改定「一次派发做多件事」，故这里是清单而非单个任务。
 *     兼容：仍接受 `task`（单个字符串）以保持既有调用方与测试不需改造。
 *   - `discover`：可选的**子代理结果提供者**——一个 async 函数，接收机械前提
 *     （阈值、候选账本），返回子代理关于「哪条候选同题 / 是否为新阻碍」的判断。
 *     **缺席时本模块不创建任何账目**：没有语义判断就没有入账依据（§8.4 第 1 项
 *     是不可跳过的前置），此时如实报告 skipped 而非假装跑过。
 *
 * 返回 `{ ok, value }` 或 `{ ok: false, error }`。**失败已入队**——调用方据此向
 * 主控/Human 声明，不得自行重试（§8.3 第 3 项）。
 */
export async function runIdleCheckpoint({
  dshHomePath,
  factSourceRoot,
  task,
  tasks,
  discover,
  sessionSignature,
  now,
  // §8.4 水位段所需：本次检查点所在的会话与轮次（位置标识，取自宿主事件载荷）。
  // `sessionId` 与 `currentTurn` 缺席时水位无法界定 —— 见下方校验。
  sessionId,
  currentTurn,
  // 水位按「项目根 + 会话」分键。项目根缺省时退回 factSourceRoot（同属该项目的
  // 稳定标识），但调用方应显式给出 projectRoot 以免两处语义漂移。
  projectRoot,
} = {}) {
  const at = typeof now === "string" ? now : new Date().toISOString();
  // 任务清单（兼容单个字符串 `task`——既有调用方与测试走这条）。
  const requested = Array.isArray(tasks) && tasks.length > 0
    ? tasks
    : (typeof task === "string" && task.length > 0 ? [task] : ["idle-review"]);
  const taskId = requested[0];

  // 本模块只编排摩擦发现（`idle-review`）；其余两个任务（容量/体检）能力本体
  // 尚未实现——**如实报告**而不是假装跑过（§8.5 条件式要求：不得主张空闲维护
  // 已运行）。
  //
  // 逐任务分派而非只看第一个：清单里可以既有已实现的又有未实现的，此时已实现的
  // 那件必须照常跑（否则「勾了三件」会因一件没实现而整批不跑，而 Human 从痕迹
  // 里看不出为什么）。
  const runnable = requested.filter((key) => key === "idle-review");
  const unimplemented = requested.filter((key) => key !== "idle-review");
  if (runnable.length === 0) {
    return success({ task: taskId, tasks: [...requested], outcome: "not-implemented", unimplemented, at });
  }
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("idle_checkpoint/no_fact_source", "factSourceRoot is required to read the friction ledger");
  }
  // §8.4 水位段：区间端点取自宿主会话记录的位置标识。两者缺席时**无法界定区间**，
  // 于是也就无法保证「只对新增内容作观察」——按 §8.4 第 6 项整任务停（fail-closed）。
  // **不得**退化为「没有位置就当作全部内容」：那会把同一段内容反复计入，正是水位
  // 段要消除的失效面。
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return failure("idle_checkpoint/no_session_id", "sessionId is required to key the observation watermark (04 §8.4 水位段) — 不得以「无位置」退化为覆盖全部内容");
  }
  if (!Number.isInteger(currentTurn)) {
    return failure("idle_checkpoint/no_current_turn", "currentTurn (the turn published by the host event payload) is required to bound this run's window (04 §8.4 水位段)");
  }

  // §8.4 第 6 项：任一校验不可用即整任务停——阈值是第一道。
  const threshold = verifyThresholdAvailable();
  if (!threshold.ok) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `阈值求值校验不可用：${threshold.error.message}`,
      residual: [],
      at,
    });
  }

  // §8.4 第 1 项（读取部分）。
  const candidates = await loadDedupCandidates(factSourceRoot);
  if (!candidates.ok) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `账本不可读，查重输入不完整：${candidates.error.message}`,
      residual: [],
      at,
    });
  }
  // 读不出的账目会使查重输入不完整（§8.4 第 2 项的反向护栏：误判递增会虚增
  // count），故按 §8.3 停止而不是在残缺账本上判断。
  if (Array.isArray(candidates.value.invalid) && candidates.value.invalid.length > 0) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `账本存在不可读载体，查重输入不完整（${candidates.value.invalid.length} 条）`,
      residual: candidates.value.invalid.map((item) => `${item.file ?? item.line}: ${item.reason}`),
      at,
    });
  }

  // §8.4「观察范围的切分（水位）」：本次运行只看**自上次成功运行以来**新增的内容。
  // 区间端点取自宿主会话记录的轮次号（`currentTurn`），不是「AI 认为哪些是新的」。
  const watermark = await readWatermark(dshHomePath, { projectRoot: projectRoot ?? factSourceRoot, sessionId });
  if (!watermark.ok) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `水位不可读，无法界定本次观察区间：${watermark.error.message}`,
      residual: [],
      at,
    });
  }
  const windowRange = describeWindow(watermark.value, currentTurn);

  // 语义查重属子代理职责（§8.4 第 1 项是登记为 gap 的语义判断）。无提供者时
  // 不创建、不递增——如实报告 skipped。
  if (typeof discover !== "function") {
    return success({
      task: taskId,
      // 任务清单与未实现者**在每条返回路径上都要带**——否则调用方在 skipped 路径
      // 上拿不到「本次要求做几件、其中几件没实现」，痕迹就只记了半截（§8.5 要求
      // 「勾了但没做」必须可见，而 skipped 恰恰是最需要说清范围的路径）。
      tasks: [...requested],
      unimplemented: [...unimplemented],
      outcome: "skipped",
      reason: "no semantic-judgement provider: 04 §8.4 第 1 项的语义查重是登记为 gap 的语义判断，机械层不得代为判断，故本次不入账",
      threshold: FRICTION_THRESHOLD_N,
      candidates: candidates.value.candidates.length,
      window: windowRange,
      at,
      // 注意：skipped **不推进水位**——本次并未处理该区间，推进会使区间内的内容
      // 永远失去被观察的机会（§8.4 水位段：失败不推进，避免遗漏）。
      watermark_advanced: false,
    });
  }

  let decision;
  try {
    decision = await discover({
      threshold: FRICTION_THRESHOLD_N,
      candidates: candidates.value.candidates,
      sessionSignature,
      // 区间与提示词一并交给执行体（提示词由 friction-subagent-contract.js 依
      // 这些机械前提组装；执行体不得自行界定区间）。
      window: windowRange,
      // 本次要做的全部事项——执行体据此拼接提示词与复合 schema（一次派发多件）。
      tasks: [...requested],
    });
  } catch (error) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `执行体（受管辖隔离子代理）失败：${String(error?.message ?? error)}`,
      residual: [],
      at,
      // 派生/判断失败：水位**不推进**（§8.4 水位段），下次重覆盖同一区间。
      watermarkAdvanced: false,
    });
  }

  // §8.4 水位段「推进与不推进」：仅当本次运行**成功完成**时才推进。
  //
  // **顺序纪律（复核发现①的修复）**：水位推进必须以「落地已成功」为前提——
  // 早先的实现把推进放在本层、而落地由调用方在**更晚**执行，于是落地失败时
  // 水位已前进、账目却从未写入：那段窗口被标记为已处理，内容**永远不会再被
  // 观察**（宿主只发布事件、不回放；本模块按 §8.4 纪律不读会话日志）。这与
  // 缺陷 D2 同形态（看起来在跑、实质无产出），且更隐蔽。
  //
  // 故本层**不再自行推进**，而是把「可推进的轮次」交给调用方，由调用方在
  // **落地成功之后**推进。判定权仍在本层（何时可推进），只是执行时机后移。
  const pendingWatermarkTurn = Number.isInteger(decision?.watermarkTurn) ? decision.watermarkTurn : null;

  // 子代理的判断结果由调用方（发现子代理）机械落地——本层不解释其语义，
  // 只要求它是结构化结果并如实上抛。
  return success({
    task: taskId,
    // 本次要求做的全部事项，与其中能力本体未实现者——使调用方能把「勾了三件、
    // 实做一件」如实记进痕迹（04 §8.5：不得主张空闲维护已运行）。
    tasks: [...requested],
    unimplemented: [...new Set([...unimplemented, ...(decision?.unimplementedTasks ?? [])])],
    outcome: decision?.outcome ?? "reported",
    decision,
    // 调用方在**落地成功后**据此推进水位（本层已判定其可推进）。
    pending_watermark_turn: pendingWatermarkTurn,
    watermark_advanced: false,
    threshold: FRICTION_THRESHOLD_N,
    candidates: candidates.value.candidates.length,
    window: windowRange,
    at,
  });
}

/**
 * §8.3 fail-closed 收口：入队 + 停止。
 *
 * **队列本身不可用时**：§8.3 第 6 条要求不得降级登记、也不得继续。此时返回的失败
 * 里带上 `queue_unavailable`，使调用方**无法**把这次失败当作已登记（这正是
 * 「不得据『已尝试登记』主张登记已完成」的机械形态）。
 */
async function recordAndFail(dshHomePath, { task, reason, residual, at }) {
  const queued = await appendPendingEntry(dshHomePath, { task, reason, residual, at });
  if (!queued.ok) {
    return failure("idle_checkpoint/queue_unavailable", `${reason}（且待处置队列不可写：${queued.error.message}——04 §8.3 第 6 条禁止降级登记，故本次未登记）`, {
      stop_reason: reason,
      residual,
      queue_unavailable: true,
    });
  }
  return failure("idle_checkpoint/stopped", reason, {
    stop_reason: reason,
    residual,
    pending_entry_id: queued.value.entry_id,
  });
}

export { failure as __failure, success as __success };
