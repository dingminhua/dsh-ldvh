
import { reviewDispatchTemplate, selfReviewDispatchTemplate } from "./review-dispatch-template.js";
import { REVIEW_ASK_POINTS, REVIEW_ASK_ANSWERS, GATE_POINT_EXCLUSIONS, REVIEW_ASK_CARRIER_ENTRIES, CANDIDATE_SUMMARY_MAX_CHARS, validateCandidateSummary, askEnabledFor, carrierEntrySource, reviewAskMode, silentRunNotice } from "./review-ask.js";
import { executeResearchConsult } from "./research-consult-tools.js";

import { normalizeQuotationText } from "./quotation-text.js";

const COMPLEXITY_CRITERIA_SOURCE = carrierEntrySource(REVIEW_ASK_CARRIER_ENTRIES.complexTask);
const POINT_EXCLUSIONS_SOURCE = carrierEntrySource(REVIEW_ASK_CARRIER_ENTRIES.pointExclusions);

function envelope(operationKey, outcome, fields) {
  return { operation_key: operationKey, outcome, ...fields };
}

export const REVIEW_ASK_OPERATION = Object.freeze({
  toolName: "ldvh_review_ask",
  summary:
    "三处把关询问统一入口（行动前审查／收口前复核／第三处联网调查提请）。"
    + "\n\nWHEN TO CALL: 仅当对应开关打开、你判定当次任务属「复杂任务」、**该次工作未命中点位排除**、**且该处的前置时点已到**时。行动前那处的前置时点是「方案已形成候选、尚未产生副作用」（不是「任务的第一个动作之前」）；收口前那处是「工作已做完、尚未形成完成声明」。第三处 point=research 走内部查找＋提请，不受复杂任务判据与点位排除约束、受自身开关约束（research-entry）。"
    + `两步判据都不新造，两步各自只按其载体条目判断。**第一步**看 ${COMPLEXITY_CRITERIA_SOURCE}：该条目列出三条正面形状（建立或修改结构性事物／存在多个可选路径的选型／方向可能与既定决策冲突）与一份排除清单；条目只有排除清单、没有正面规定「什么情况算复杂任务」，故正面三条是条目原文，而「排除清单取反」是据此推导的判据、不是条目原文。`
    + `**第二步**看 ${POINT_EXCLUSIONS_SOURCE}：判为复杂之后，当次工作**整件**属于该条目列出的三类之一时，该处**不问**，也不派代理——\n`
    + GATE_POINT_EXCLUSIONS.map((item) => `  · ${item.label}`).join("\n")
    + "\n\n两步不得混读：点位排除**不改动也不重新解释**复杂任务的判据，命中排除**不等于**「这不算复杂任务」；它只免除本文定义的两处征询，**不免除**主控自查与方案收敛自查（`ldvh-root` 的 `required-checks` 条目），**不免除**任何须人决定事项的提请（新建事实对象、改变既有对象的决策与适用范围语义），**也不免除**独立审核的适用范围（受保护内容修改、下位规范建立或实质修改、进入事实源的事实规范候选），见 `ldvh-root` 的 `proxy-review-arrangement` 条目。"
    + "\n\n命中排除时的交付义务（见 point-exclusions 条目）：在交付说明里写一行「点位排除：命中〔哪一类〕｜当次整体范围〔…〕｜判定理由〔…〕」；不写这行按未请示处理。"
    + "\n\npoint=pre-action：**方案已形成候选、尚未产生副作用时**问「安排代理审查／主控自审／不审查直接推进」三选一；point=post-work：**一件复杂任务做完、尚未形成完成声明时**问「安排代理复核／主控自查／不复核直接收口」三选一；point=research 问「联网调查／主控自调查／先不查」三选一。（静默执行开着时前两处变为**不问、直接给派发模板**，见下。）"
    + "\n\n**时点与效力（两条都别读错，2026-11-14 Human 指出后修正）**："
    + "① **没有候选就没有可核对的对象**——行动前那处只在方案已成形时发起；尚无候选时发起是空问，载体明禁「为回避判断而一律请示」（见 gate-consult-system-foundation 的 uncertain 条目）。读规则、查事实、收敛方案本身不产生副作用，都在适用面内。**调用须带去除首尾空白后 1–200 个字符的 `candidate_summary`（方案摘要，计数按字符串长度，段内换行与空白照常计入）；它会写入 ask 题面供人自足作答，并参与答复复用指纹。缺摘要或超限会被机械拒绝（rejected），不发问、不派代理、不进静默模板——这是 Human 2026-11-25 改裁。先把方案压缩成摘要，不要先发问再让代理或主控凑方案。**机械层只判断摘要存在与字符数，不判候选内容是否合格；"
    + "② **答复不构成动手前提**——载体写明「请示不是行动放行的前提，也不使行动在取得答复前暂停」，也明禁把「未取得答复」处置为「必须暂停」（见 gate-consult-system-foundation 的 answer-means 条目）。请示未获答复时按既有路径继续并如实说明。"
    + "\n\nRETURNS decision: \"review\"（安排代理）| \"self-review\"（主控自己做：返回 self_review_template，主控按同一份任务要求实做一遍并在交付写明核了什么与依据，不得称独立核对结论）| \"skip\"（这次核对不做，直接推进）| \"silent\"（静默执行开着：没问，直接给你派发模板）| null（未取得答复）。"
    + "倒计时开关打开时，请示卡片显示 10/30/60s 倒计时；到点未选则返回 decision=null 且 result.timed_out=true，按「未取得答复、直接推进」处理——这不是 Human 的 skip/review 决定，不写答复留痕（answer-means 条目：没有答复即没有决定）。"
    + "**switch_off 时不会提问**，直接返回 decision=null 并说明原因——那是设计，不是失败。"
    + "\nsilent 是**配置决定的自动安排**，不是 Human 的答复：拿到它就去派代理，并把 result.notice 原样写进交付说明（静默不等于无痕）。"
    + "\n\nNOT A GATE: skip 是合法答复，不阻断任何后续动作；本工具不返回 granted。"
    + "\n\nBOUNDARY: 它不判定「算不算复杂」，也不检查你是否真的调用了它——故这不构成机械保障；须据实声明（见 `ldvh-root` 的 `claim-bound` 条目）。"
    + "**关于「候选」的机械边界（2026-11-25 Human 改裁）**：pre-action 现在有机械闸——`candidate_summary` 必填、去除首尾空白后 1–200 个字符（按字符串长度计，段内换行与空白照常计入），缺或超限直接 rejected，不发问、不派代理、不进静默模板；摘要写入 ask 题面并参与指纹（变了重新请示）。但机械层**只判断摘要存在与字符数**，仍**不判定候选内容是否真是方案或是否合格**（形式不可分）。`candidate_basis` 交还的正文逐字命中只作参考，不再是「有无候选」的权威判据——不要因为看到候选摘要字段就认为候选质量已被机制保证。",
  effect: "may_change_state",
  awaitsHumanDecision: true,
});

export function reviewAskParameterSchema() {
  return {
    type: "object",
    properties: {
      point: {
        type: "string",
        enum: ["pre-action", "post-work", "research"],
        description: "pre-action = 行动前的审查询问（时点是「方案已有候选、尚未产生副作用」，不是「任务的第一个动作之前」）；post-work = 收口前的复核询问；research = 第三处联网调查提请（主控自查发现依赖外部信息且自己不掌握时，先查内部事实源、未命中才提请）——本处内部先查，故需 need 等参数",
      },
      need: {
        type: "string",
        description: "仅 point=research 用：要查清什么（一句话），写主控自己不掌握、依赖外部对象信息的那一点"
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "仅 point=research 用：内部查找的检索词，多写几个同义说法"
      },
      scope: {
        type: "string",
        description: "仅 point=research 用：范围限定（时间、版本、适用场景）"
      },
      purpose: {
        type: "string",
        description: "仅 point=research 用：这次查证服务于哪个判断"
      },
      sub_questions: {
        type: "array",
        items: { type: "string" },
        description: "仅 point=research 用：子问题，交给调研会话做覆盖检查"
      },
      internal_gap: {
        type: "string",
        description: "仅 point=research 用：「内部已有 X 仍缺 Y」，提供则即使内部有命中也继续提请"
      },
      limit: {
        type: "number",
        description: "仅 point=research 用：内部查找返回条数上限"
      },
      task: {
        type: "string",
        description: "一句话说明当次任务是什么（供 Human 认出「问的是哪件事」；参与内容指纹，同一任务重试不重问）",
      },
      candidate_summary: {
        type: "string",
        description: `行动前（point=pre-action）必填：候选方案的摘要，去除首尾空白后 1–${CANDIDATE_SUMMARY_MAX_CHARS} 个字符（按字符串长度计，段内换行与空白照常计入）。摘要会写入 ask 题面供 Human 自足作答，并参与内容指纹（摘要变了即重新请示）。机械层只判断「摘要存在与字符数」，不判定方案是否合格。post-work／research 不得传。`,
      },
      claims: {
        type: "array",
        items: { type: "string" },
        description: "决定「安排代理」时要交给代理核对的对象描述：post-work 传「这项工作声称做到的事」逐条列出（最容易被漏、也最决定复核质量的一块）；pre-action 传「方案打算怎么做」的关键主张。不给则模板里明确说缺，不虚构。注意这与必填的 candidate_summary 不同：candidate_summary 是去除首尾空白后不超过 200 个字符（按字符串长度计）、进 ask 题面的候选摘要；claims 是进派发模板、供代理逐条核对的主张。",
      },
      evidence: {
        type: "string",
        description: "决定「安排代理」时给代理的证据入口：仓库路径、该跑什么命令（如 `git diff` / 测试命令）、相关规范条目。不给则代理只能自己找。",
      },
    },
    required: ["point"],
    additionalProperties: false,
  };
}

const CANDIDATE_STATUS = Object.freeze({
  EVIDENCE: "evidence-present",
  NONE: "no-evidence",
  UNAVAILABLE: "unavailable",
});

const CANDIDATE_NO_EVIDENCE_NOTE = "**参考提示（非权威）：本轮正文里没有逐字定位到 claims**。行动前是否有候选，现以必填的 `candidate_summary`（去除首尾空白后 1–200 个字符，按字符串长度计，进 ask 题面）为准（Human 2026-11-25 改裁）；本提示只反映 claims 与正文的逐字命中情况，不判定候选存在与否、也不判定其内容是否合格。若 claims 写了却没落在正文里，代理派发模板会缺可核对的逐条主张，建议补齐。";

function unavailableBasis(reason, claims) {
  return {
    available: false,
    candidate_status: CANDIDATE_STATUS.UNAVAILABLE,
    reason,
    claims_present: claims.length > 0,
    claims_count: claims.length,
    note: "取不到本轮正文只影响「claims 是否落在正文里」这一参考读数，**不说明候选摘要是否存在**；候选有无以必填的 candidate_summary 为准（Human 2026-11-25 改裁）。",
  };
}

function buildCandidateBasis(args, exec, deps) {
  const claims = Array.isArray(args?.claims)
    ? args.claims.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
  const reader = deps?.readCurrentTurnText;
  if (typeof reader !== "function") {
    return unavailableBasis("the live turn-text reader is not wired in this composition, so whether a candidate was already written cannot be read back here — judge it yourself from what you wrote before this call (the implementation owes you the basis and is reporting that it cannot supply it, rather than implying the basis is empty)", claims);
  }
  let turn = null;
  try {
    turn = reader(exec?.agent);
  } catch (error) {
    return unavailableBasis(`the live turn-text reader threw (${String(error?.message ?? error)}), so the basis is unavailable — do not read this as "no candidate was written"`, claims);
  }
  if (turn === null || turn === undefined || turn.ok !== true) {
    return unavailableBasis(typeof turn?.reason === "string" && turn.reason.length > 0
      ? turn.reason
      : "the current turn's text is not readable in this composition", claims);
  }
  const turnText = typeof turn.assistant === "string" ? turn.assistant : "";
  const normalizedTurn = normalizeQuotationText(turnText);
  const inText = claims.map((claim) => normalizedTurn.includes(normalizeQuotationText(claim)));
  const matched = inText.filter(Boolean).length;
  const status = matched > 0 ? CANDIDATE_STATUS.EVIDENCE : CANDIDATE_STATUS.NONE;
  const basis = {
    available: true,
    candidate_status: status,
    turn: turn.turn ?? null,
    turn_text_chars: normalizedTurn.length,
    turn_text_empty: normalizedTurn.length === 0,
    truncated: turn.truncated === true,
    claims_present: claims.length > 0,
    claims_count: claims.length,
    claims_in_turn_text: inText,
    claims_in_turn_text_count: matched,
    note: "claims_in_turn_text 只说明「你写下的主张在你本轮正文里也能找到」，**不说明它是合格候选，也不是「有无候选」的判据**（候选以必填的 candidate_summary 为准，Human 2026-11-25 改裁）；它只影响派发模板里 claims 是否有正文支撑。",
  };
  if (status === CANDIDATE_STATUS.NONE) {
    basis.warning = normalizedTurn.length === 0
      ? `${CANDIDATE_NO_EVIDENCE_NOTE}（本轮正文一个字都没写。）`
      : (claims.length === 0
        ? `${CANDIDATE_NO_EVIDENCE_NOTE}（本轮未带 claims，机器无法定位候选主张。）`
        : `${CANDIDATE_NO_EVIDENCE_NOTE}（带了 ${claims.length} 条 claims，但没有一条逐字出现在本轮正文；若它们是候选，请把原文写进正文后再发问。）`);
  }
  return basis;
}

export async function executeReviewAsk(args, exec, deps) {
  const point = args?.point;
  if (point !== "pre-action" && point !== "post-work" && point !== "research") {
    return envelope("review-ask", "rejected", {
      result: null,
      scope: { requested: point ?? null, completed: [], not_completed: [point ?? "(missing)"] },
      sources: [],
      gaps: [`point must be "pre-action", "post-work" or "research", got ${JSON.stringify(point ?? null)}`],
      verification: { checks: ["point-closed-set"], passed: false },
      follow_up: ["pass point=\"pre-action\" (行动前的审查) / point=\"post-work\" (收口前的复核) / point=\"research\" (第三处联网调查提请)"],
    });
  }

  const task = typeof args?.task === "string" && args.task.trim().length > 0 ? args.task.trim() : null;

  if (point === REVIEW_ASK_POINTS.RESEARCH) {
    const research = await executeResearchConsult(args, exec, deps);
    return { ...research, operation_key: "review-ask" };
  }

  let candidateSummary = null;
  if (point === REVIEW_ASK_POINTS.PRE_ACTION) {
    const checked = validateCandidateSummary(args?.candidate_summary);
    if (!checked.ok) {
      return envelope("review-ask", "rejected", {
        result: { point, task, decision: null, asked: false, candidate_summary_valid: false },
        scope: { requested: point, completed: [], not_completed: [point] },
        sources: [],
        gaps: [checked.reason, "机械闸：缺候选摘要或超限时**不发起询问、不派代理、不进静默模板**（Human 2026-11-25 决定：候选摘要写入 ask，机械判断存在与字符数）。候选内容是否合格仍由主控与 Human 判断。"],
        verification: { checks: ["point-closed-set", "candidate-summary-required"], passed: false },
        follow_up: ["先把候选方案压缩成一段去除首尾空白后不超过 200 个字符的摘要（按字符串长度计），再以 candidate_summary 传入本工具；不要把完整方案塞进 ask"],
      });
    }
    candidateSummary = checked.value;
  }

  const candidateBasis = point === "pre-action" ? buildCandidateBasis(args, exec, deps) : null;

  let settings = null;
  let settingsGap = null;
  let settingsUnavailable = false;
  if (typeof deps?.getReviewAskSettings !== "function") {
    settingsUnavailable = true;
    settingsGap = "the review-ask switch reader is not wired in this composition, so the switch state is unavailable (this is NOT the same as the switch being off)";
  } else {
    try {
      settings = deps.getReviewAskSettings();
    } catch (error) {
      settingsUnavailable = true;
      settingsGap = `switch read failed: ${String(error?.message ?? error)}`;
    }
  }
  if (settingsUnavailable) {
    return envelope("review-ask", "unavailable", {
      result: { point, task, decision: null, asked: false, switch_enabled: null },
      scope: { requested: point, completed: [], not_completed: [point] },
      sources: [],
      gaps: [settingsGap, "no prompt was issued because the switch state could not be determined — report this to Human (据实声明 · ldvh-root 的 claim-bound 条目; this is not a stop condition, since the two review asks are 征询 outside any Human Gate — gate-consult-system-foundation 的 answer-means 条目); do not treat it as a configured skip"],
      verification: { checks: ["point-closed-set", "switch-read"], passed: false },
      follow_up: ["report the unavailable switch state to Human; do not claim the review was skipped by configuration; do NOT pause the work over this — gate-consult-system-foundation 的 answer-means 条目 says the ask neither grants nor suspends"],
    });
  }
  const enabled = askEnabledFor(settings, point);
  const known = point === "pre-action"
    ? settings?.preActionKnown !== false
    : settings?.postWorkKnown !== false;
  if (!enabled && (!known || settings === null)) {
    return envelope("review-ask", "unavailable", {
      result: { point, task, decision: null, asked: false, switch_enabled: null },
      scope: { requested: point, completed: [], not_completed: [point] },
      sources: [],
      gaps: [
        ...(settingsGap === null ? [] : [settingsGap]),
        "the switch state is not set in the configuration — it is **not** the same as the switch being off, so no prompt was issued; report this to Human (据实声明 · ldvh-root 的 claim-bound 条目; not a stop condition — the two review asks are 征询 outside any Human Gate, gate-consult-system-foundation 的 answer-means 条目)",
      ],
      verification: { checks: ["point-closed-set", "switch-read"], passed: false },
      follow_up: ["report the unset switch state to Human; do not claim the review was skipped by configuration; do NOT pause the work over this — gate-consult-system-foundation 的 answer-means 条目 says the ask neither grants nor suspends"],
    });
  }

  const mode = reviewAskMode(settings, point);
  if (mode.mode === "silent") {
    return envelope("review-ask", "completed", {
      result: {
        point,
        task,
        decision: "silent",
        asked: false,
        switch_enabled: true,
        silent_run: true,
        review_template: reviewDispatchTemplate(point, {
          task,
          claims: args?.claims,
          evidence: args?.evidence,
        }),
        notice: silentRunNotice({ point, task }),
        ...(candidateBasis === null ? {} : { candidate_basis: candidateBasis }),
      },
      scope: { requested: point, completed: [point], not_completed: [] },
      sources: [],
      gaps: [],
      verification: {
        checks: ["point-closed-set", "switch-read"],
        passed: true,
      },
      follow_up: [
        "用 `subagent` 派生一个**零上下文**子代理（不要用 subagent_fork——它会继承你的全部上下文，独立性即不成立），把 review_template.prompt 填好内容后作为 prompt 传给它（受管辖隔离，见 `ldvh-root` 的 `review-modes` 条目）",
        "**在交付说明里原样引用 result.notice 那一行**：静默指的是不问，不是不留痕——不写这一行，Human 事后无从判断这轮到底派没派代理（据实声明 · `ldvh-root` 的 `claim-bound` 条目）",
        "拿到结论后先自己核一遍再采纳：复核体也可能错，但它给的是证据而非结论",
      ],
    });
  }

  const seam = deps?.hostSeams;
  if (typeof seam?.requestReviewAsk !== "function") {
    return envelope("review-ask", "unavailable", {
      result: { point, decision: null, asked: false },
      scope: { requested: point, completed: [], not_completed: [point] },
      sources: [],
      gaps: ["the host question seam (requestReviewAsk) is not available in this composition, so no prompt could be issued — report to Human (`ldvh-root` 的 `stop-conditions` 条目); do not substitute a self-asserted answer"],
      verification: { checks: ["seam-availability"], passed: false },
      follow_up: ["report the unavailable seam to Human; do not claim the review was arranged or skipped"],
    });
  }

  if (enabled !== true) {
    return envelope("review-ask", "completed", {
      result: {
        point, task, decision: null, asked: false, switch_enabled: false,
        ...(candidateBasis === null ? {} : { candidate_basis: candidateBasis }),
      },
      scope: { requested: point, completed: [], not_completed: [] },
      sources: [],
      gaps: [
        ...(settingsGap === null ? [] : [settingsGap]),
        "switch_off: the corresponding setting is closed, so no prompt was issued by design (打开才有). No review is arranged — that is the configured behaviour, not a failure.",
      ],
      verification: { checks: ["point-closed-set", "switch-read"], passed: true },
      follow_up: [
        "本次不安排独立把关：直接推进，主控自查仍在（`ldvh-root` 的 `required-checks` 条目）。若你想启用，请在 LDVH 设置里打开对应的把关询问开关。",
      ],
    });
  }

  const outcome = await seam.requestReviewAsk({
    point,
    task,
    candidate_summary: candidateSummary,
    enabled,
    agent: exec?.agent,
    signal: exec?.signal,
    callId: exec?.callId,
    timeoutEnabled: settings?.timeoutEnabled === true,
    timeoutSeconds: settings?.timeoutSeconds,
  });

  const asked = outcome?.asked === true;
  const decision = outcome?.decision ?? null;
  const gaps = [];
  if (settingsGap !== null) gaps.push(settingsGap);
  if (mode.silentUnknown) {
    gaps.push("the silent-run switch could not be read, so the question was asked as usual instead of being skipped by silence — this is a fallback, not a Human decision (据实声明 · `ldvh-root` 的 `claim-bound` 条目)");
  }
  if (outcome?.recordError !== undefined) gaps.push(`the answer could not be recorded (${outcome.recordError}) — a retry will ask again`);
  if (outcome?.reason !== undefined && decision === null) gaps.push(outcome.reason);

  return envelope("review-ask", decision === null ? "partial" : "completed", {
    result: {
      point,
      task,
      decision,
      asked,
      reused: outcome?.reused === true,
      ...(outcome?.timed_out === true ? { timed_out: true, timeout_seconds: outcome.timeout_seconds } : {}),
      ...(outcome?.custom_note === undefined ? {} : { custom_note: outcome.custom_note }),
      ...(outcome?.fingerprint === undefined ? {} : { fingerprint: outcome.fingerprint }),
      switch_enabled: enabled,
      ...(candidateBasis === null ? {} : { candidate_basis: candidateBasis }),
      ...(decision === REVIEW_ASK_ANSWERS.REVIEW ? { review_template: reviewDispatchTemplate(point, {
        task,
        claims: args?.claims,
        evidence: args?.evidence,
      }) } : {}),
      ...(decision === REVIEW_ASK_ANSWERS.SELF ? { self_review_template: selfReviewDispatchTemplate(point, {
        task,
        claims: args?.claims,
        evidence: args?.evidence,
      }) } : {}),
      ...(outcome?.at === undefined ? {} : { recorded_at: outcome.at }),
    },
    scope: {
      requested: point,
      completed: decision === null ? [] : [point],
      not_completed: decision === null ? [point] : [],
    },
    sources: [{ kind: "host-service", path: "userQuestions" }],
    gaps,
    verification: {
      checks: ["point-closed-set", "switch-read", "answer-distinguishable"],
      passed: decision !== null,
    },
    follow_up: decision === REVIEW_ASK_ANSWERS.REVIEW
      ? [
        "用 `subagent` 派生一个**零上下文**子代理（不要用 subagent_fork——它会继承你的全部上下文，独立性即不成立），把 review_template.prompt 填好内容后作为 prompt 传给它（受管辖隔离，见 `ldvh-root` 的 `review-modes` 条目）",
        "模板已随本结果的 review_template 返回：五块结构（对象描述／声称做到的事逐条／重点查的面／硬性约束／输出格式）。**「声称做到的事」是最关键的一块——漏写它，复核体只能猜，也就无从核对**",
        "拿到结论后先自己核一遍再采纳：复核体也可能错，但它给的是证据而非结论",
      ]
      : decision === REVIEW_ASK_ANSWERS.SELF
        ? [
          "Human 选择主控自己做这次核对：self_review_template 已返回（与代理那份同任务要求，措辞去掉「独立」）。主控亲自按它的重点面实做一遍，不派 subagent",
          "这是硬要求：在交付里逐条写明核对了什么、依据落在哪个文件:行号或规范条目、结论与残留风险；不得以「已自查」一句带过",
          "如实标注少了独立性这一层：措辞用「主控自审／自查」，不得写成「独立审查/独立复核结论」；这是用独立性换一次子代理往返的取舍",
        ]
        : decision === REVIEW_ASK_ANSWERS.SKIP
        ? ["Human 明确选择不安排独立把关；直接推进，主控自查仍在（`ldvh-root` 的 `required-checks` 条目）"]
        : outcome?.timed_out === true
          ? [
            `倒计时 ${outcome.timeout_seconds}s 到点，未取得答复——这不是 Human 的 skip 或 review 决定，未写入答复留痕（gate-consult-system-foundation 的 answer-means 条目）；按既有路径直接推进，主控自查仍在`,
            "在交付说明中如实写明「该处倒计时到点、未取得答复、已直接推进」；不得把超时当作 Human 的明确答复，也不得据此停下整件工作",
            "同内容下次仍会问（未取得答复不是答复）；若 Human 事后在残留卡片上点了选项，因 LDVH 自有工具的晚到答复不在宿主投影内，可能投递不到——如需明确决定请重新提请",
          ]
          : outcome?.custom_note !== undefined
            ? [
              "未取得答复（answer-means 条目：答复只表明「被问过并给出三档中的哪一档」，没有答复即没有决定，不得读成 skip）；但 Human 在自由输入框写了字，见 result.custom_note —— 逐字读它并纳入本轮判断，不要当成跳过",
              "该自由文本不是 review/self-review/skip 答复，不改变 decision=null；如需明确决定请重新提请",
              "未取得答复**不放行也不暂停**（gate-consult-system-foundation 的 answer-means 条目）：按既有路径继续，并在交付说明中如实写明「未取得该处答复」；不得把沉默当作 skip，也不得据此停下整件工作",
            ]
          : ["未取得答复：按 answer-means 条目不得把沉默当作 skip（没有答复即没有决定）；也**不得据此暂停**——两处请示是须人决定事项之外的征询，答复不是行动放行的前提；按既有路径继续，并在交付说明中如实写明「未取得该处答复」"],
  });
}
