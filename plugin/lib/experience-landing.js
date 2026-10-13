/**
 * dsh-ldvh — 闲时辅助「积累经验」任务的**落地侧**（36 §10 经验积累）.
 *
 * 权威：specs/36 §10（含「机械通道的边界」）与 specs/23（Pitfall 事实类型）。
 *
 * ## 本模块的动作面被规范**收窄**为一件
 *
 * 36 §10 明文：机械通道**仅限创建 `draft` 候选**——不得创建 `active`、不得升格、
 * 不得废止。故本模块对 `new-experience` 只做一件事：调 `createPitfallObject` 建
 * 一条 `draft`。**入档（`draft → active`）不在本模块**：它以另一主体的独立复现
 * 验证为前置（23 §16.1），且属 Human Gate。
 *
 * ## 与摩擦落地的结构差异
 *
 * 摩擦落地有两种动作（补充级更新 + 阈值流转），因为它们服务「同一阻碍反复出现」
 * 的计数语义。**经验积累没有计数**：Pitfall 的准入是四前提齐（23 §5），不是
 * 「重复够多」。故本模块只有「建一条 draft」与「无事可做」两种结果，
 * **没有**对应的补充/升格分支。
 *
 * ## 查重命中时做什么：什么都不做
 *
 * 36 §10 规定：查重命中的如实登记，不计入「每次运行至多形成 1 条候选」的上限。
 * 而 23 §6.3 的补充级更新是**Friction 侧的机制**——Pitfall 侧「同一机制已存在」
 * 时的正确动作是**不新建**（既有对象已承载该经验），并如实登记一次「命中了谁」。
 * 故本模块返回 `action: "duplicate-registered"`，由调用方登记。
 */

import { createPitfallObject } from "./pitfall-writer.js";

function success(value) {
  return { ok: true, value };
}

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, ...details } };
}

/**
 * 落地一条经验积累的判断。
 *
 * @param {object} args
 * @param {string} args.factSourceRoot - 受管辖事实源根（Pitfall 目录在其下）。
 * @param {object} args.verdict - **已经过** `validateCaptureVerdict` 的结论切片。
 * @param {string} args.observationAt - 本次观察时刻（ISO 串）。
 * @param {*} args.sessionSignature - 品牌化署名载体（03 §6.1 / 09：change_log 由
 *   Code 签名，不得无签名写入；缺载体即拒绝并交由 Human 处置）。
 * @returns {{ok: true, value: {action: string, object_uid: string|null}}|{ok: false, error: object}}
 */
export async function landCaptureVerdict({
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

  if (verdict.verdict === "no-capture") {
    // 没有候选就没有动作：**不建、不推进、不记账**。若原因是「同一机制已存在」，
    // 如实登记命中了谁（36 §10：查重命中的登记不计入产出上限）。
    const duplicateOf = typeof verdict.duplicateOf === "string" && verdict.duplicateOf.length > 0
      ? verdict.duplicateOf
      : null;
    return success({
      action: duplicateOf === null ? "none" : "duplicate-registered",
      object_uid: duplicateOf,
    });
  }

  // verdict === "new-experience"：机械通道的**唯一**动作——建一条 draft。
  //
  // **为什么初态是 draft 而不是 active**：36 §10「机械通道的边界」明文机械通道
  // 仅限创建 draft 候选；入档须经 Human Gate 且以另一主体独立复现验证为前置
  // （23 §16.1）。写成 active 会**绕过该闸门**——那正是「没有机制能阻止跳过它」
  // 的形态，且它会在外观上与正常入档无从区分。
  const created = await createPitfallObject({
    factSourceRoot,
    frontmatterDraft: {
      title: verdict.title,
      scope: verdict.scope,
      status: "draft",
      change_summary: `闲时辅助经验积累（机械通道）于 ${at} 形成候选`,
    },
    bodyMarkdown: verdict.body,
    sessionSignature,
  });
  if (!created.ok) {
    return failure(
      created.error?.code ?? "capture/create_failed",
      `36 §10（形成 draft 候选）失败：${created.error?.message ?? "unknown"}`,
      { stage: "create", cause: created.error },
    );
  }

  return success({ action: "candidate-created", object_uid: created.value.object_uid });
}

/**
 * 把落地失败提炼成**完整**诊断（形制同 `friction-landing.js` 的
 * `residualFromLandingError`）。
 *
 * **为什么不能只留 message**：`pitfall-writer` 的失败常带 `issues` 明细（逐条
 * 结构缺陷），只取 message 会使「为什么被拒」在待处置队列里不可见——而那条
 * 明细正是 Human 处置时唯一可据的线索。
 */
export function residualFromCaptureError(error) {
  if (error === null || typeof error !== "object") return ["（无诊断信息）"];
  const out = [];
  if (typeof error.code === "string" && error.code.length > 0) out.push(`错误码 ${error.code}`);
  if (typeof error.message === "string" && error.message.length > 0) out.push(error.message);
  const issues = error.cause?.details?.issues ?? error.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    for (const issue of issues) out.push(`· ${typeof issue === "string" ? issue : JSON.stringify(issue)}`);
  }
  return out.length > 0 ? out : ["（无诊断信息）"];
}
