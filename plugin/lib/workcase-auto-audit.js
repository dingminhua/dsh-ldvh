/**
 * dsh-ldvh — WorkCase 建前独立审核的**自动派生**（create 之后立刻派审核体）。
 *
 * ## 为什么需要它（Human 2026-11-04 的决定）
 *
 * 21 §14 把「Gate 1 前必审」写成无条件要求，机械层也把它落成了两道闸（时序闸 +
 * 覆盖闸）。但**闸只会拒绝，不会推动**：create 成功之后，没有任何一步提醒主控
 * 「你还没做建前审核」。实测后果（2026-11-04）：
 *
 *   - 主控建完 draft 直接对 Human 说「判据已达成，要关闭还是取消」，跳过了整个
 *     审核环节与 Gate 1；
 *   - 引导段里明明写着相关规则，**照样被跳过**——Human 的判词是「没有机械辅助，
 *     AI 执行力很差」，这是对当前形态的准确描述，不是对某一次疏忽的评价。
 *
 * 故本模块把「组织审核」从**主控自觉**改为**机械执行**：create 成功后由插件直接
 * 派生一个零上下文子代理做建前审核，并把它的结论经 `record_audit` 落盘。
 *
 * ## 边界（如实声明，不越权）
 *
 * **它不代替 Human 的任何决定**：
 *   - 不批准 Gate 1（`approve` 仍只由 Human 经提请触发）；
 *   - 不判定候选该不该做（审核体只报证据性错漏，21 §14 明文禁止它输出「该不该做」）；
 *   - 审核结论为 `needs_revision` 时，本模块**只落盘结论并交还**，不自行改候选、
 *     不自行推进状态。
 *
 * **它改变的是「谁发起」**：审核由插件发起而非主控。21 §14 要求的
 * `auditor_origin = "subagent"`（覆盖闸的机械凭据）依然成立——审核体仍是受管辖
 * 隔离子代理、仍由 Code 从宿主登记表取身份与结论。变化的是**发起者**，本模块不
 * 隐藏这一点：调用方在结果里能读到 `auto_audit.initiated_by = "plugin"`。
 *
 * **失败一律 fail-closed 且不静默**：派生不出子代理、宿主没有零上下文 provider、
 * 审核体超时或零产出，都返回明确的 failure，由 create 结果如实带出——绝不因为
 * 「自动的」就降级成「当作审过了」。
 */

import { selectZeroContextProvider } from "./subagent-providers.js";

/** 审核体结算等待上限。建前审核是一次有界的阅读+判断，不该无限挂起。 */
const AUDIT_SETTLEMENT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 挑一个**零上下文** provider。
 *
 * 挑选已收口到 `subagent-providers.js`：宿主 0.2.2-rc.2 删除了
 * `ctx.subagents.list()`，本处与摩擦发现、经验审核共用同一条发现通道（注册期
 * 事件名册 + `getProvider` 现查）。封装保留是为了让本模块对外的错误码形状
 * （`auto_audit/*`）与历史调用点不变。
 *
 * `inheritsParentContext === false` 是硬条件：继承父上下文的审核者已经读过候选
 * 的形成过程，独立性不成立（21 §14）。没有这样的 provider 时 fail-closed，
 * **不退化**为「随便挑一个凑一次」。
 */
function pickZeroContextProvider(subagents, roster) {
  const picked = selectZeroContextProvider(subagents, roster);
  if (picked.ok) return picked;
  return {
    ok: false,
    error: {
      code: "auto_audit/no_zero_context_provider",
      message: picked.error.message,
    },
  };
}

/** 三维结论的结构化 schema（21 §14 最低档要求）。 */
function auditOutputSchema() {
  return {
    type: "object",
    properties: {
      object_appropriateness: { type: "string", description: "对象恰当性：符合/不符 + 证据" },
      plan_feasibility: { type: "string", description: "方案可行性：符合/不符 + 证据" },
      scope_clarity: { type: "string", description: "scope 清晰度：符合/不符 + 证据" },
      verdict: { type: "string", enum: ["pass", "needs_revision"] },
      summary: { type: "string", description: "≤600 字符的三维结论概要（供 pre_reviews 落盘）" },
    },
    required: ["object_appropriateness", "plan_feasibility", "scope_clarity", "verdict", "summary"],
    additionalProperties: false,
  };
}

/** 审核体的任务提示：只读、只报证据性错漏、不输出需求裁夺。 */
function auditPrompt({ title, gist, summary, scope, plan, body }) {
  const planLines = (Array.isArray(plan) ? plan : [])
    .map((item, index) => `${index + 1}. 步骤：${item?.step ?? ""}\n   完成判据：${item?.done_criteria ?? ""}`)
    .join("\n");
  return `你是 LDVH 的**独立建前审核者**（21 §14「Gate 1 前置·建前独立审核」）。

你未参与这份候选的形成，故你的独立判断有意义。请只读地审核下面这份 WorkCase 候选，**不要修改任何文件、不要调用任何写工具**。

## 候选内容

标题：${title ?? "（缺）"}

gist：${gist ?? "（缺）"}

summary：
${summary ?? "（缺）"}

scope：
${scope ?? "（缺）"}

plan：
${planLines || "（缺）"}

正文：
${body ?? "（缺）"}

## 你必须回答的三维

1. **对象恰当性**：这份候选是否该存在？是否落在 21 §6.1 的对象边界内、未落入 §6.3 的排除清单（方向未定的议题→Spark；当次行动可直接处理的低风险改动→不对象化；已定决策→ADR；系统性阻碍→Friction）？是否与既有工单重复？
2. **方案可行性**：plan 每一步能否由单一执行者在一次连续执行中完成？每条 done_criteria 能否被证据判定？是否把流程关口（受控提交／独立复核／Gate 批准）错写成 plan 步骤（§6.1 明文禁止）？
3. **scope 清晰度**：scope 是否同时明确「做什么」与「明确不做什么」，且能充当越权拒绝的比对基准？两段之间是否互相矛盾？

## 硬性约束

- **只报证据性错漏，不输出「该不该做／做什么」的需求裁夺结论**（需求裁夺归 Human）。
- 每维必须给出「符合／不符 + 具体证据」，**不接受「已审无问题」这类空结论**。
- 三维全部符合才可给 \`verdict: "pass"\`；任一维不符即 \`needs_revision\`。
- \`summary\` 必须是覆盖三维的结论概要，≤600 字符。`;
}

/**
 * 派生审核体做一次建前审核，并把结论交回调用方。
 *
 * 本函数**不写对象**——落盘由调用方（workcase-tools）经 `record_audit` 完成，
 * 因为那里才有 CAS 基线与信封装配。这样职责单一：本模块只负责「拿到一份可信的
 * 子代理结论」。
 *
 * @param {object} args
 * @param {object} args.subagents 宿主 subagents 服务
 * @param {object} args.parent 发起会话的 Agent（审核体挂在它下面）
 * @param {object} args.candidate 候选内容（title/gist/summary/scope/plan/body）
 * @param {AbortSignal} [args.signal] 调用方的取消信号
 * @returns {Promise<{ok:true,value:{agentId,sessionId,verdict,summary,structured}}|{ok:false,error:{code,message}}>}
 */
export async function runAutoPreGate1Audit({ subagents, parent, candidate, signal, roster = null }) {
  if (subagents === undefined || subagents === null || typeof subagents.startActivation !== "function") {
    return {
      ok: false,
      error: {
        code: "auto_audit/unavailable",
        message: "the host subagents service is not wired into this composition, so the pre-Gate-1 audit "
          + "cannot be dispatched. 21 §14 requires it before Gate 1; REPORT TO HUMAN — do not substitute "
          + "a self-written audit for a delegated one.",
      },
    };
  }
  if (parent === undefined || parent === null) {
    return {
      ok: false,
      error: {
        code: "auto_audit/no_parent_agent",
        message: "the calling agent is unavailable, so a subagent cannot be parented to it — the audit must be "
          + "delegated under the implementing session (21 §14 独立性：审核体未参与候选形成).",
      },
    };
  }

  // 名册缺省时退化为空名册：picker 仍会试已知内置名（spawn），故装配方漏传
  // 不会让审核整体失效，只是看不到自定义 provider。
  const picked = pickZeroContextProvider(subagents, roster ?? null);
  if (!picked.ok) {
    // 零上下文是规范要求：继承父上下文的审核者已经读过候选的形成过程，独立性无从
    // 成立。故这里 fail-closed，不退化为「用继承上下文的 provider 凑一次」。
    return {
      ok: false,
      error: {
        code: "auto_audit/no_zero_context_provider",
        message: `${picked.error.code}: ${picked.error.message} — 建前审核须由零上下文子代理承担，`
          + "否则它已读过候选的形成过程，独立性不成立（21 §14）。",
      },
    };
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal !== undefined && signal !== null) {
    if (signal.aborted === true) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  let activation;
  try {
    activation = await subagents.startActivation({
      provider: picked.value.name,
      label: `ldvh-pregate1-audit ${new Date().toISOString()}`,
      request: {
        prompt: [{ type: "text", text: auditPrompt(candidate) }],
        parent,
        outputSchema: auditOutputSchema(),
      },
      signal: controller.signal,
      delivery: "caller",
    });
  } catch (error) {
    if (signal !== undefined && signal !== null) signal.removeEventListener("abort", onAbort);
    return {
      ok: false,
      error: {
        code: "auto_audit/dispatch_failed",
        message: `the pre-Gate-1 audit executor could not be started: ${String(error?.message ?? error)}`,
      },
    };
  }

  let timer = null;
  let result;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`the audit executor did not settle within ${AUDIT_SETTLEMENT_TIMEOUT_MS} ms`)),
        AUDIT_SETTLEMENT_TIMEOUT_MS,
      );
    });
    result = await Promise.race([activation?.result, timeout]);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "auto_audit/settlement_failed",
        message: `the pre-Gate-1 audit did not produce a usable conclusion: ${String(error?.message ?? error)}. `
          + "The object stays in draft — an un-audited candidate must not proceed to Gate 1 (21 §14).",
      },
    };
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (signal !== undefined && signal !== null) signal.removeEventListener("abort", onAbort);
  }

  // 审核体的产出形态由宿主决定：优先取结构化结果，退回最终文本。两者都取不到即
  // 视为零产出——**不把「没有结论」当成「审核通过」**。
  const structured = typeof result?.structured === "object" && result?.structured !== null
    ? result.structured
    : null;
  const agentId = activation?.childId ?? activation?.sessionId ?? null;
  const sessionId = activation?.childId ?? activation?.sessionId ?? null;

  if (structured === null) {
    return {
      ok: false,
      error: {
        code: "auto_audit/no_structured_conclusion",
        message: "the pre-Gate-1 audit executor returned no structured conclusion; refusing to treat an empty "
          + "result as a pass (21 §14：不接受「已审无问题」空结论). The object stays in draft.",
      },
    };
  }
  const verdict = structured.verdict === "pass" ? "pass" : "needs_revision";
  const summary = typeof structured.summary === "string" ? structured.summary.trim() : "";
  if (summary.length === 0) {
    return {
      ok: false,
      error: {
        code: "auto_audit/empty_summary",
        message: "the audit conclusion carries no summary, so it cannot be recorded as a pre_reviews entry "
          + "(21 §8 requires the three-dimension conclusion). The object stays in draft.",
      },
    };
  }

  return {
    ok: true,
    value: { agentId, sessionId, verdict, summary, structured },
  };
}
