/**
 * dsh-ldvh — 闭集落地：把子代理的结构化判断写成账目（specs/11 §9 第 2–4 项）.
 *
 * ## 本模块为什么存在（缺陷 D2 的修复）
 *
 * §9 的闭集共六项，其中第 2–4 项是**机械动作**（写观察条目 / 阈值晋升 /
 * 对既有账目的补充级更新）。`friction-discovery.js` 早已实现这些动作，但**没有任何
 * 生产调用方**——`lifecycle.js` 曾把 `runIdleCheckpoint` 的返回值直接丢弃。后果：
 * 子代理判断出来的结论被算完即丢，账本永远不会有新账目。该缺陷由独立复核
 * （隔离子代理 030117d3）发现：
 *
 *   「`supplementOccurrence` / `createObserving` / `promoteIfThresholdMet` 在
 *    `lib/` 与生产路径中零调用方；`lifecycle.js:321` 直接丢弃返回值，故那次真实
 *    运行只推进了水位、从未执行第 2–4 项。」
 *
 * （上引原文里的 `createObserving` / `promoteIfThresholdMet` 已被本次修订改名为
 * `recordObservation` / `promoteReadyGroup`——保留原引文是为了不改写历史记录。）
 *
 * 本模块就是那条缺失的接缝：**输入**是子代理已经过落地校验的结构化判断，
 * **输出**是账目变更。它自己**不做任何语义判断**——「这条候选是否同题」由子代理
 * 决定（§8.4 第 1 项，登记为 gap），本模块只按判断结果的**三态**执行对应的机械动作。
 *
 * ## 四态 → 机械动作的映射（严格照 §9 闭集；2026-10 修订）
 *
 * | 判断 | 动作 | 依据 |
 * |---|---|---|
 * | `same-obstacle` | 第 4 项：对既有 `open` 账目做补充级更新（`count` +1、`last_at` 更新、`status` 不变） | §9 第 4 项 |
 * | `same-observation-group` | 第 2 项：把本次观察追加进该 `group`；**若该组 pending 条目达 N**，第 3 项：晋升为一条新的 `open` 账目 | §9 第 2、3 项 |
 * | `new-observation` | 第 2 项：以该 `group` 开一个新的观察组（count 1，留在缓冲） | §9 第 2 项 |
 * | `no-discovery` | 无动作 | — |
 *
 * **与原三态的差别**：原 `new-obstacle` 会直接创建 `observing` 账目；现在**任何观察
 * 都不写事实源**，一律先进缓冲，只有攒够 N 条才晋升。故观察层没有「创建账目」这个
 * 动作，只有「追加观察」与「晋升」。
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
  recordObservation,
  promoteReadyGroup,
  MAX_CREATES_PER_RUN,
  FRICTION_THRESHOLD_N,
} from "./friction-discovery.js";
import { readFrictionObject } from "./friction-writer.js";

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
 *   - `action`：实际执行的机械动作（`supplement` / `observe` / `none`）；
 *   - `object_uid`：涉及的账目 uid（`no-discovery`/`observe` 未晋升时为 `null`）；
 *   - `promoted`：本次是否**晋升**出一条新的 `open` 账目（即缓冲中同源条目达 N，
 *     11 §9 第 3 项）——**不是** `observing → open` 流转，那条流转已随观察态退出闭集而删除；
 *   - `count`：更新后的计数（`supplement` 时）。
 *
 * **任一环节失败即返回失败**——调用方按 §8.3 fail-closed 入队，**不得**继续执行
 * 后续项（§8.4 第 6 项）。
 */
export async function landDiscoveryVerdict({
  factSourceRoot,
  dshHomePath,
  projectId,
  verdict,
  anchor,
  session,
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
    // §9 闭集：没有发现就没有动作。**不推进、不写入、不记账**。
    return success({ action: "none", object_uid: null, promoted: false });
  }

  if (verdict.verdict === "same-obstacle") {
    // 第 4 项：对既有 open 账目做补充级更新（计数与现象段扩展须在同一次更新内，
    // 由 supplementOccurrence 内部保证）。observation 用本次观察的人类可读描述
    // ——它来自子代理的 reason（已校验非空），而不是本模块自造。
    //
    // **本项不再触发任何状态流转**（2026-10 修订）：账目的状态推进只有 Human Gate
    // （销账/废弃/接受）。观察累积到阈值这件事发生在缓冲侧，与既有账目无关。
    //
    // **命中 accepted 时静默（2026-10 新增）**：`accepted` 是「已记录、不再报告」
    // 的终态，命中它**不写缓冲、不晋升、不补充计数**（11 §9 第 1 项 / 36 §8.2 第 6 项）。
    // 命中事实须在交还 `residual` 中登记，使复审有入口、不构成无痕抑制（11 §15）。
    const hit = await readFrictionObject({ factSourceRoot, objectUid: verdict.target_uid });
    if (!hit.ok) {
      // 账目读不出来即无法判定命中哪一态——归入 supplement 阶段（与补充级更新
      // 同一阶段：二者都是「对既有账目做第 4 项」这条路径上的失败），并保留诊断。
      return failure(hit.error?.code ?? "friction/read_failed", `11 §9 第 4 项（命中账目读取）失败：${hit.error?.message ?? "unknown"}`, {
        stage: "supplement",
        cause: hit.error,
      });
    }
    if (hit.value.frontmatter.status === "accepted") {
      return success({
        action: "silent",
        object_uid: verdict.target_uid,
        promoted: false,
        status: "accepted",
        residual: [`命中已接受账目 ${verdict.target_uid}：本次观察与它同源，按「记录一次、不再报告」静默（不写缓冲、不晋升、不补充计数；26 §9.1 / 11 §9 第 1 项）`],
      });
    }
    const supplemented = await supplementOccurrence({
      factSourceRoot,
      objectUid: verdict.target_uid,
      observation: verdict.reason,
      observationAt: at,
      sessionSignature,
    });
    if (!supplemented.ok) {
      return failure(supplemented.error?.code ?? "friction/supplement_failed", `11 §9 第 4 项（补充级更新）失败：${supplemented.error?.message ?? "unknown"}`, {
        stage: "supplement",
        cause: supplemented.error,
      });
    }

    return success({
      action: "supplement",
      object_uid: verdict.target_uid,
      count: supplemented.value?.count_after ?? null,
      count_before: supplemented.value?.count_before ?? null,
      promoted: false,
      status: supplemented.value?.status ?? null,
    });
  }

  if (verdict.verdict === "same-observation-group" || verdict.verdict === "new-observation") {
    // 第 2 项：写一条观察条目（**不写事实源**）。`group` 由子代理判定：
    // same-observation-group 沿用既有组键，new-observation 由它新起一个键。
    if (typeof dshHomePath !== "function") {
      return failure("invalid_request", "dshHomePath is required for the observation buffer (11 §12bis.1)");
    }
    if (typeof projectId !== "string" || projectId.length === 0) {
      return failure("invalid_request", "projectId is required — the observation buffer is partitioned by governed project (11 §12bis.1)");
    }
    if (typeof anchor !== "string" || anchor.length === 0) {
      return failure("invalid_request", "anchor is required — it is the in-session position the entry points back to (11 §12bis.1)");
    }
    const recorded = await recordObservation({
      dshHomePath,
      projectId,
      session: typeof session === "string" && session.length > 0 ? session : "unknown",
      anchor,
      phenomenon: verdict.phenomenon,
      // 逐字引证进缓冲（§12bis.1 `evidence` 行）——注意用 `quote` 而不是 `reason`：
      // evidence 必须是来源材料的逐字片段，reason 是解释，不能冒充引证。
      evidence: `${verdict.quote}\n（来源：${anchor}）`,
      group: verdict.group,
      observationAt: at,
    });
    if (!recorded.ok) {
      return failure(recorded.error?.code ?? "friction/record_observation_failed", `11 §9 第 2 项（写观察条目）失败：${recorded.error?.message ?? "unknown"}`, {
        stage: "record-observation",
        cause: recorded.error,
      });
    }

    // 第 3 项：该组是否已达阈值、需要晋升。**只有达阈值才晋升**；
    // 未达即正常留在缓冲（不是失败）。
    let promotion = null;
    if (recorded.value?.promotion_ready === true) {
      if (MAX_CREATES_PER_RUN !== 1) {
        return failure("friction/create_cap_changed", `§9「每次运行上限」假定至多 1 条；现有界为 ${MAX_CREATES_PER_RUN}，落地逻辑须相应调整`);
      }
      const promoted = await promoteReadyGroup({
        factSourceRoot,
        dshHomePath,
        projectId,
        group: verdict.group,
        title: verdict.title,
        impact: verdict.impact,
        basis: verdict.basis,
        attribution: verdict.attribution,
        sessionSignature,
      });
      if (!promoted.ok) {
        return failure(promoted.error?.code ?? "friction/promote_failed", `11 §9 第 3 项（阈值晋升）失败：${promoted.error?.message ?? "unknown"}`, {
          stage: "promote",
          cause: promoted.error,
        });
      }
      promotion = promoted.value;
    }

    return success({
      action: "observe",
      object_uid: promotion?.object_uid ?? null,
      entry_id: recorded.value?.entry_id ?? null,
      group: verdict.group,
      group_pending_count: recorded.value?.group_pending_count ?? null,
      threshold: FRICTION_THRESHOLD_N,
      promotion_ready: recorded.value?.promotion_ready === true,
      promoted: promotion?.promoted === true,
      evicted_pending: recorded.value?.evicted_pending ?? [],
    });
  }

  // 四态是闭集；走到这里说明调用方没先过 validateDiscoveryVerdict。
  return failure("friction/verdict_out_of_set", `refusing to land an unknown verdict ${JSON.stringify(verdict.verdict)}; the closed set is same-obstacle/same-observation-group/new-observation/no-discovery (11 §9 四态)`);
}
