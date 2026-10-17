/**
 * dsh-ldvh — 闭集落地：把子代理的结构化判断写成账目（specs/36 §9 第 2–4 项）.
 *
 * ## 本模块为什么存在（缺陷 D2 的修复）
 *
 * §8.4 的闭集共六项，其中第 2–4 项是**机械动作**（补充级更新 / 创建 observing /
 * 阈值流转）。`friction-discovery.js` 早已实现这三个动作，但**没有任何生产调用方**
 * ——`lifecycle.js` 曾把 `runIdleCheckpoint` 的返回值直接丢弃。后果：子代理判断出来
 * 的结论被算完即丢，账本永远不会有新账目。该缺陷由独立复核（隔离子代理 030117d3）
 * 发现：
 *
 *   「`supplementOccurrence` / `createObserving` / `promoteIfThresholdMet` 在
 *    `lib/` 与生产路径中零调用方；`lifecycle.js:321` 直接丢弃返回值，故那次真实
 *    运行只推进了水位、从未执行第 2–4 项。」
 *
 * 本模块就是那条缺失的接缝：**输入**是子代理已经过落地校验的结构化判断，
 * **输出**是账目变更。它自己**不做任何语义判断**——「这条候选是否同题」由子代理
 * 决定（§8.4 第 1 项，登记为 gap），本模块只按判断结果的**三态**执行对应的机械动作。
 *
 * ## 三态 → 机械动作的映射（严格照 §8.4 闭集）
 *
 * | 判断 | 动作 | 依据 |
 * |---|---|---|
 * | `same-obstacle` | 第 2 项：补充级更新（`count` +1、`last_at` 更新、`status` 不变），随后第 4 项：若 `count ≥ N` 且状态仍为 `observing` 则流转 `open` | §8.4 第 2、4 项 |
 * | `new-obstacle` | 第 3 项：创建 `observing` 账目（初值 `count=1`） | §8.4 第 3 项 |
 * | `no-discovery` | 无动作 | — |
 *
 * ## 两条不许越界的纪律
 *
 * 1. **第 4 项只在第 2 项之后、且只作用于本次涉及的那条账目**（§8.4 第 4 项：
 *    「不做存量遍历——只作用于本次运行读取到的账目」）。故本模块**不**扫描账本。
 * 2. **每次运行至多创建 1 条账目**（§8.4「每次运行上限」）；补充级更新不计入该上限。
 *    本模块对 `new-obstacle` 每次运行只执行一次，故上限天然满足；若将来允许一次运行
 *    多条判断，须在此处显式计数。
 */

import {
  supplementOccurrence,
  createObserving,
  promoteIfThresholdMet,
  MAX_CREATES_PER_RUN,
  FRICTION_THRESHOLD_N,
} from "./friction-discovery.js";

function success(value) {
  return { ok: true, value };
}

function failure(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

/**
 * 把一次落地失败的**完整**诊断信息摊成待处置队列的 `residual` 行。
 *
 * ## 为什么需要它（2026-10-11 实测缺陷）
 *
 * 各 writer 的失败对象形状是 `{ code, message, details }`，其中 `details.issues`
 * 承载**逐条校验明细**（例如「title 须 ≤ 30 字」「occurrence.count 初值须为 1」）。
 * 而队列此前只取 `cause.message`——即那句恒定的「frontmatter failed mechanical
 * checks」。后果：一条真实的落账失败在队列里**只留下无信息的套话**，Human 拿到
 * 它无法判断该改什么；本模块的四处 `cause`（第 2/3/4 项及新账目流转）全都如此。
 *
 * 实测样本：条目 `f333ef12`（2026-10-11T05:56:34Z）的 `residual` 只有
 * `["frontmatter failed mechanical checks"]`——**校验明细在传递链上被丢弃**。
 * 这与机制自建的账目「以产物缺席作否定判据致连续错判」同属一类：**信息在接缝
 * 处丢失，使下游基于不完整材料判断**。
 *
 * ## 纪律
 *
 * - **只做提取，不做解释**：明细原样带出，不翻译、不归纳（§14 第 6 条：不复制
 *   宿主/下位实现语义）。
 * - **尽可能无损**：明细缺失时才退回 `message`；两者都没有才给兜底串。
 * - **有界**：明细条数可能很多，截到 `MAX_RESIDUAL_ISSUES` 并显式标注截断——
 *   静默丢弃与静默膨胀都不行。
 */
export const MAX_RESIDUAL_ISSUES = 12;

export function residualFromLandingError(error) {
  if (error === undefined || error === null) return [];
  const cause = error.cause;
  const lines = [];
  // ① 逐条校验明细（`details.issues`）——最要紧的部分，此前被完整丢弃。
  const issues = cause?.details?.issues;
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      if (lines.length >= MAX_RESIDUAL_ISSUES) break;
      const text = String(issue ?? "").trim();
      if (text.length > 0) lines.push(text);
    }
    if (issues.length > MAX_RESIDUAL_ISSUES) {
      lines.push(`（另有 ${issues.length - MAX_RESIDUAL_ISSUES} 条明细未列出）`);
    }
  }
  // ② 明细为空时才退回 message——它至少给出错误类别。
  if (lines.length === 0) {
    const message = cause?.message ?? cause;
    if (message !== undefined && message !== null && String(message).trim().length > 0) {
      lines.push(String(message));
    }
  }
  // ③ 连 cause 都没有：退到本次 failure 自己的 message（调用方已带在 reason 里，
  //    但 residual 为空会让队列读者看不出「有没有残留」）。
  if (lines.length === 0 && typeof error.message === "string" && error.message.trim().length > 0) {
    lines.push(error.message);
  }
  return lines;
}

/**
 * 把一个已通过落地校验的 verdict 写成账目（§8.4 第 2–4 项）。
 *
 * 参数：
 *   - `factSourceRoot`：项目事实源根（账本所在）；
 *   - `verdict`：`validateDiscoveryVerdict` 通过后的规范形态（见 friction-subagent-contract.js）；
 *   - `observationAt`：本次观察时间（RFC3339）；用于 `last_at` 与 `first_at`；
 *   - `sessionSignature`：受控写入签名（02 §10.5）。
 *
 * 返回 `{ ok: true, value }`，其中：
 *   - `action`：实际执行的机械动作（`supplement` / `create` / `none`）；
 *   - `object_uid`：涉及的账目 uid（`no-discovery` 时为 `null`）；
 *   - `promoted`：第 4 项是否发生了 `observing → open` 流转；
 *   - `count`：更新后的计数（`supplement` 时）。
 *
 * **任一环节失败即返回失败**——调用方按 §8.3 fail-closed 入队，**不得**继续执行
 * 后续项（§8.4 第 6 项）。
 */
export async function landDiscoveryVerdict({
  factSourceRoot,
  verdict,
  observationAt,
  sessionSignature,
} = {}) {
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return failure("invalid_request", "factSourceRoot is required");
  }
  if (typeof verdict !== "object" || verdict === null) {
    return failure("invalid_request", "verdict is required (the landing runs on an already-validated structured verdict)");
  }

  const at = typeof observationAt === "string" && observationAt.length > 0 ? observationAt : new Date().toISOString();

  if (verdict.verdict === "no-discovery") {
    // §8.4 闭集：没有发现就没有动作。**不推进、不创建、不记账**。
    return success({ action: "none", object_uid: null, promoted: false });
  }

  if (verdict.verdict === "same-obstacle") {
    // 第 2 项：补充级更新（计数与现象段扩展必须在同一次更新内完成，由
    // supplementOccurrence 内部保证）。observation 用本次观察的人类可读描述
    // ——它来自子代理的 reason（已校验非空），而不是本模块自造。
    const supplemented = await supplementOccurrence({
      factSourceRoot,
      objectUid: verdict.target_uid,
      observation: verdict.reason,
      observationAt: at,
      sessionSignature,
    });
    if (!supplemented.ok) {
      return failure(supplemented.error?.code ?? "friction/supplement_failed", `36 §9 第 2 项（补充级更新）失败：${supplemented.error?.message ?? "unknown"}`, {
        stage: "supplement",
        cause: supplemented.error,
      });
    }

    // 第 4 项：阈值流转。仅在**本次涉及的那条账目**上判定（不做存量遍历）。
    // 不满足阈值时 promoteIfThresholdMet 返回 promoted:false——那是正常跳过，不是失败。
    const promoted = await promoteIfThresholdMet({
      factSourceRoot,
      objectUid: verdict.target_uid,
      sessionSignature,
    });
    if (!promoted.ok) {
      return failure(promoted.error?.code ?? "friction/promote_failed", `36 §9 第 4 项（阈值流转）失败：${promoted.error?.message ?? "unknown"}`, {
        stage: "promote",
        cause: promoted.error,
      });
    }

    return success({
      action: "supplement",
      object_uid: verdict.target_uid,
      count: supplemented.value?.count_after ?? null,
      count_before: supplemented.value?.count_before ?? null,
      promoted: promoted.value?.promoted === true,
      status: promoted.value?.status ?? null,
    });
  }

  if (verdict.verdict === "new-obstacle") {
    // 第 3 项：创建 observing 账目。每次运行至多 1 条（§8.4「每次运行上限」），
    // 而本函数每次运行只被调用一次，故天然满足；此处仍显式引用该常量，使
    // 上限的存在在代码里可见而非依赖「反正只调一次」。
    if (MAX_CREATES_PER_RUN !== 1) {
      return failure("friction/create_cap_changed", `§8.4「每次运行上限」假定至多 1 条；现有界为 ${MAX_CREATES_PER_RUN}，落地逻辑须相应调整`);
    }
    const created = await createObserving({
      factSourceRoot,
      title: verdict.title,
      phenomenon: verdict.phenomenon,
      impact: verdict.impact,
      basis: verdict.basis,
      observationAt: at,
      sessionSignature,
    });
    if (!created.ok) {
      return failure(created.error?.code ?? "friction/create_failed", `36 §9 第 3 项（创建 observing 账目）失败：${created.error?.message ?? "unknown"}`, {
        stage: "create",
        cause: created.error,
      });
    }

    // 新建账目 count=1 < N，第 4 项不会触发——但为保持「计数变化后即判定阈值」
    // 的一致语义，仍走一次（它会在不满足时正常返回 promoted:false）。这样若将来
    // N 被修订为 1，本路径无需改动。
    const promoteAfterCreate = await promoteIfThresholdMet({
      factSourceRoot,
      objectUid: created.value?.object_uid,
      sessionSignature,
    });
    if (!promoteAfterCreate.ok) {
      return failure(promoteAfterCreate.error?.code ?? "friction/promote_failed", `36 §9 第 4 项（新账目的阈值判定）失败：${promoteAfterCreate.error?.message ?? "unknown"}`, {
        stage: "promote-after-create",
        cause: promoteAfterCreate.error,
      });
    }

    return success({
      action: "create",
      object_uid: created.value?.object_uid ?? null,
      count: 1,
      promoted: promoteAfterCreate.value?.promoted === true,
      threshold: FRICTION_THRESHOLD_N,
    });
  }

  // 三态是闭集；走到这里说明调用方没先过 validateDiscoveryVerdict。
  return failure("friction/verdict_out_of_set", `refusing to land an unknown verdict ${JSON.stringify(verdict.verdict)}; the closed set is same-obstacle/new-obstacle/no-discovery (36 §9 三态)`);
}
