
import { reviewDispatchTemplate } from "./review-dispatch-template.js";
import { GATE_POINT_EXCLUSIONS, askEnabledFor, reviewAskMode, silentRunNotice } from "./review-ask.js";
import { normalizeQuotationText } from "./quotation-text.js";

function envelope(operationKey, outcome, fields) {
  return { operation_key: operationKey, outcome, ...fields };
}

export const REVIEW_ASK_OPERATION = Object.freeze({
  toolName: "ldvh_review_ask",
  summary:
    "两处把关询问（2026-11-13 Human 决定：改为「要不要安排代理审查／复核」两问）。"
    + "\n\nWHEN TO CALL: 仅当对应开关打开、你判定当次任务属「复杂任务」、**该次工作未命中点位排除**、**且该处的前置时点已到**时。行动前那处的前置时点是「方案已形成候选、尚未产生副作用」（不是「任务的第一个动作之前」）；收口前那处是「工作已做完、尚未形成完成声明」。"
    + "两步判据都不新造：**第一步** specs/04 §6.1 三条正面是**条文原文**（建立或修改结构性事物／存在多个可选路径的选型／方向可能与既定决策冲突），其排除清单取反是**据此推导的判据，不是条文原文**（该节只列排除清单，规范里没有正面规定「什么情况算复杂任务」）；"
    + `**第二步** specs/32 §4.2 的**点位排除**（Human 2026-11-14 决定；2026-11-15 随 ADR 事实类型撤除删除第 4 类）：判为复杂之后，当次工作**整件**属于下列任一类别时，该处**不问**，也不派代理——\n`
    + GATE_POINT_EXCLUSIONS.map((item) => `  · ${item.label}`).join("\n")
    + "\n\n两步不得混读（specs/32 §19 第 5 项）：点位排除**不改动也不重新解释** 04 §6.1 的判据，命中排除**不等于**「这不算复杂任务」；它只免除本文定义的两处征询，**不免除** 04 §6.1 的方案收敛自查与主控自查，**不免除**任何 Human Gate 的提请（新建事实对象、改变既有对象的决策与适用范围语义），**也不免除** 00 §2.5 独立审核的适用范围（受保护内容修改、下位规范建立或实质修改、进入事实源的事实规范候选）。"
    + "\n\n命中排除时的交付义务（32 §6.3 第 2 项、§13、§16）：在交付说明里写一行「点位排除（32 §4.2）：命中〔哪一类〕｜当次整体范围〔…〕｜判定理由〔…〕」；不写这行按未请示处理。"
    + "\n\npoint=pre-action：**方案已形成候选、尚未产生副作用时**问「是否安排代理审查」；point=post-work：**一件复杂任务做完、尚未形成完成声明时**问「是否安排代理复核」。（静默执行开着时这两句变为**不问、直接给派发模板**，见下。）"
    + "\n\n**时点与效力（两条都别读错，2026-11-14 Human 指出后修正）**："
    + "① **没有候选就没有可核对的对象**——行动前那处只在方案已成形时发起；尚无候选时发起是空问，specs/32 §6.4 明禁「为规避判断而一律请示（那会使机制退化为噪音）」。读规范、查事实、收敛方案本身不产生副作用，都在适用面内；"
    + "② **答复不构成动手前提**——specs/00 §2.5 原文「请示本身不是行动放行的前提，也不使行动在取得答复前暂停」，specs/32 §3.4 明禁把「未取得答复」处置为「必须暂停」。请示未获答复时按既有路径继续并如实说明。"
    + "\n\nRETURNS decision: \"review\"（安排代理）| \"skip\"（不安排，明确答复）| \"silent\"（静默执行开着：没问，直接给你派发模板）| null（未取得答复）。"
    + "倒计时开关打开时，请示卡片显示 10/30/60s 倒计时；到点未选则返回 decision=null 且 result.timed_out=true，按「未取得答复、直接推进」处理——这不是 Human 的 skip/review 决定，不写答复留痕（32 §9.1）。"
    + "**switch_off 时不会提问**，直接返回 decision=null 并说明原因——那是设计，不是失败。"
    + "\nsilent 是**配置决定的自动安排**，不是 Human 的答复：拿到它就去派代理，并把 result.notice 原样写进交付说明（静默不等于无痕）。"
    + "\n\nNOT A GATE: skip 是合法答复，不阻断任何后续动作；本工具不返回 granted。"
    + "\n\nBOUNDARY: 它不判定「算不算复杂」，也不检查你是否真的调用了它——故这不构成机械保障（00 §4.6）。"
    + "它同样**不判定「方案是否已有候选」**：那个条件在形式上不可分（敷衍的「候选：按 A 做」与真候选字形相同），按 specs/06 §5 不得以机械校验强制，故只在发问时点把判断依据（result.candidate_basis）交还给你，**不拦你、也不替你判**。因此本工具对「空问」没有拦截力，过去没有、现在也没有——不要因为看到了 candidate_basis 就认为这一步已被机制保证。",
  effect: "may_change_state",
  awaitsHumanDecision: true,
});

export function reviewAskParameterSchema() {
  return {
    type: "object",
    properties: {
      point: {
        type: "string",
        enum: ["pre-action", "post-work"],
        description: "pre-action = 行动前的审查询问（时点是「方案已有候选、尚未产生副作用」，不是「任务的第一个动作之前」）；post-work = 收口前的复核询问",
      },
      task: {
        type: "string",
        description: "一句话说明当次任务是什么（供 Human 认出「问的是哪件事」；参与内容指纹，同一任务重试不重问）",
      },
      claims: {
        type: "array",
        items: { type: "string" },
        description: "决定「安排代理」时要交给代理核对的对象描述：post-work 传「这项工作声称做到的事」逐条列出（最容易被漏、也最决定复核质量的一块）；pre-action 传「方案打算怎么做」的关键主张。不给则模板里明确说缺，不虚构。\n\n**pre-action 的额外用途（弱约束，specs/06 §5／§6）**：本工具会把「你这一轮正文里是否已经写出候选」作为判断依据一并交还（见返回的 candidate_basis）。它**不拦你**——形式不可分，机械层无法判断一段文字是不是合格候选；拦与不拦由你自己判。",
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

function buildCandidateBasis(args, exec, deps) {
  const claims = Array.isArray(args?.claims)
    ? args.claims.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
  const reader = deps?.readCurrentTurnText;
  if (typeof reader !== "function") {
    return {
      available: false,
      reason: "the live turn-text reader is not wired in this composition, so whether a candidate was already written cannot be read back here — judge it yourself from what you wrote before this call (specs/06 §6: the implementation owes you the basis, and it is reporting that it cannot supply it rather than implying the basis is empty)",
      claims_present: claims.length > 0,
      claims_count: claims.length,
    };
  }
  let turn = null;
  try {
    turn = reader(exec?.agent);
  } catch (error) {
    return {
      available: false,
      reason: `the live turn-text reader threw (${String(error?.message ?? error)}), so the basis is unavailable — do not read this as "no candidate was written"`,
      claims_present: claims.length > 0,
      claims_count: claims.length,
    };
  }
  if (turn === null || turn === undefined || turn.ok !== true) {
    return {
      available: false,
      reason: typeof turn?.reason === "string" && turn.reason.length > 0
        ? turn.reason
        : "the current turn's text is not readable in this composition",
      claims_present: claims.length > 0,
      claims_count: claims.length,
    };
  }
  const turnText = typeof turn.assistant === "string" ? turn.assistant : "";
  const normalizedTurn = normalizeQuotationText(turnText);
  const inText = claims.map((claim) => normalizedTurn.includes(normalizeQuotationText(claim)));
  return {
    available: true,
    turn: turn.turn ?? null,
    turn_text_chars: normalizedTurn.length,
    turn_text_empty: normalizedTurn.length === 0,
    truncated: turn.truncated === true,
    claims_present: claims.length > 0,
    claims_count: claims.length,
    claims_in_turn_text: inText,
    claims_in_turn_text_count: inText.filter(Boolean).length,
    note: "claims_in_turn_text 只说明「你写下的主张在你本轮正文里也能找到」，**不说明它是合格候选**——一份敷衍的「候选：按 A 做」照样能让它为真。判断「是否已有候选」由你做（specs/06 §5：形式不可分，故本层不判定对错）。",
  };
}

export async function executeReviewAsk(args, exec, deps) {
  const point = args?.point;
  if (point !== "pre-action" && point !== "post-work") {
    return envelope("review-ask", "rejected", {
      result: null,
      scope: { requested: point ?? null, completed: [], not_completed: [point ?? "(missing)"] },
      sources: [],
      gaps: [`point must be "pre-action" or "post-work", got ${JSON.stringify(point ?? null)}`],
      verification: { checks: ["point-closed-set"], passed: false },
      follow_up: ["pass point=\"pre-action\" (行动前的审查，时点是方案已有候选、尚未产生副作用) or point=\"post-work\" (收口前的复核)"],
    });
  }
  const task = typeof args?.task === "string" && args.task.trim().length > 0 ? args.task.trim() : null;

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
      gaps: [settingsGap, "no prompt was issued because the switch state could not be determined — report this to Human (00 §4.6 据实声明; this is not a 00 §4.7 stop, since the two review asks are 征询 outside any Human Gate per 00 §2.5); do not treat it as a configured skip"],
      verification: { checks: ["point-closed-set", "switch-read"], passed: false },
      follow_up: ["report the unavailable switch state to Human; do not claim the review was skipped by configuration; do NOT pause the work over this — 00 §2.5 says the ask neither grants nor suspends"],
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
        "the switch state is not set in the configuration — it is **not** the same as the switch being off, so no prompt was issued; report this to Human (00 §4.6 据实声明; not a 00 §4.7 stop — the two review asks are 征询 outside any Human Gate per 00 §2.5)",
      ],
      verification: { checks: ["point-closed-set", "switch-read"], passed: false },
      follow_up: ["report the unset switch state to Human; do not claim the review was skipped by configuration; do NOT pause the work over this — 00 §2.5 says the ask neither grants nor suspends"],
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
        "用 `subagent` 派生一个**零上下文**子代理（不要用 subagent_fork——它会继承你的全部上下文，独立性即不成立），把 review_template.prompt 填好内容后作为 prompt 传给它（受管辖隔离，04 §7.3）",
        "**在交付说明里原样引用 result.notice 那一行**：静默指的是不问，不是不留痕——不写这一行，Human 事后无从判断这轮到底派没派代理（00 §4.6）",
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
      gaps: ["the host question seam (requestReviewAsk) is not available in this composition, so no prompt could be issued — report to Human (00 §4.7); do not substitute a self-asserted answer"],
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
        "本次不安排独立把关：直接推进，主控自查仍在（04 §6.1）。若你想启用，请在 LDVH 设置里打开对应的把关询问开关。",
      ],
    });
  }

  const outcome = await seam.requestReviewAsk({
    point,
    task,
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
    gaps.push("the silent-run switch could not be read, so the question was asked as usual instead of being skipped by silence — this is a fallback, not a Human decision (00 §4.6)");
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
      ...(decision === "review" ? { review_template: reviewDispatchTemplate(point, {
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
    follow_up: decision === "review"
      ? [
        "用 `subagent` 派生一个**零上下文**子代理（不要用 subagent_fork——它会继承你的全部上下文，独立性即不成立），把 review_template.prompt 填好内容后作为 prompt 传给它（受管辖隔离，04 §7.3）",
        "模板已随本结果的 review_template 返回：五块结构（对象描述／声称做到的事逐条／重点查的面／硬性约束／输出格式）。**「声称做到的事」是最关键的一块——漏写它，复核体只能猜，也就无从核对**",
        "拿到结论后先自己核一遍再采纳：复核体也可能错，但它给的是证据而非结论",
      ]
      : decision === "skip"
        ? ["Human 明确选择不安排独立把关；直接推进，主控自查仍在（04 §6.1）"]
        : outcome?.timed_out === true
          ? [
            `倒计时 ${outcome.timeout_seconds}s 到点，未取得答复——这不是 Human 的 skip 或 review 决定，未写入答复留痕（specs/32 §9.1）；按既有路径直接推进，主控自查仍在（00 §2.5、32 §3.4）`,
            "在交付说明中如实写明「该处倒计时到点、未取得答复、已直接推进」；不得把超时当作 Human 的明确答复，也不得据此停下整件工作",
            "同内容下次仍会问（未取得答复不是答复）；若 Human 事后在残留卡片上点了选项，因 LDVH 自有工具的晚到答复不在宿主投影内，可能投递不到——如需明确决定请重新提请",
          ]
          : outcome?.custom_note !== undefined
            ? [
              "未取得答复（32 §9.1：答复只表明「被问过并给出安排／不安排」，没有答复即没有决定，不得读成 skip）；但 Human 在自由输入框写了字，见 result.custom_note —— 逐字读它并纳入本轮判断，不要当成跳过",
              "该自由文本不是 review/skip 答复，不改变 decision=null；如需明确决定请重新提请",
              "未取得答复**不放行也不暂停**（00 §2.5、32 §3.4、32 §9.1）：按既有路径继续，并在交付说明中如实写明「未取得该处答复」；不得把沉默当作 skip，也不得据此停下整件工作",
            ]
          : ["未取得答复：按 32 §9.1 不得把沉默当作 skip（没有答复即没有决定）；也**不得据此暂停**——两处请示是 00 §2.5 明定的 Human Gate 之外征询，答复不是行动放行的前提；按既有路径继续，并在交付说明中如实写明「未取得该处答复」"],
  });
}
