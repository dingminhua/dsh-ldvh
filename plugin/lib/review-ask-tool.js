/**
 * dsh-ldvh — `ldvh_review_ask`：两处把关询问的工具面入口。
 *
 * ## 为什么需要一个专门工具（而不是让主控裸调 ask_user_question）
 *
 * 三个原因，每条都对应一个实测过的失效面：
 *
 * 1. **留痕**：宿主 `ctx.userQuestions.ask` 走 waterfall，**不进入会话事件流**
 *    （`workcase-route-ledger.js` 头注记录的实测）。裸调之后，事后无法从任何
 *    权威记录回答「问过没有、答了什么」——本仓已经因此发生过一次主控误判
 *    「询问未发生」并补问了一遍。
 * 2. **不重问**：同一内容指纹问过就有答复可复用。裸调没有这层，重试必重问。
 * 3. **开关**：本工具自己读开关，关闭时**不问**——这样「打开才有」由一处实现
 *    保证，而不是要求主控每次都记得先查配置。
 *
 * ## 它不是 Gate（与 ldvh_workcase_write 的 approve 根本不同）
 *
 * Human 选「跳过」是**合法答复**，不是拒绝，不阻断任何后续动作。故本工具
 * 返回 `decision: "review" | "skip" | "silent" | null`，**不返回 granted**——用
 * `granted` 会诱导调用方把它当成授权闸门，那与它的性质相反。
 *
 * `silent` 不是 Human 的答复，是**配置决定的自动安排**（见 index.js 的
 * `reviewAskSilentRunEnabled`）：它使这个枚举多了一个来源，故消费方
 * **不得**把 `silent` 读成「Human 同意了」——它只说明「这一处没问，照配置做了」。
 *
 * ## 如实声明边界（00 §4.6）
 *
 * 本工具**不判定「这次任务算不算复杂」**，也不检查主控是否真的来调用。它保障的
 * 只有：开关关闭时不问、问过的不重问、答复可回读。**「该问而没问」机械层不知道**
 * ——故不得据本工具的存在声称审查/复核已获机械保障。
 */

import { reviewDispatchTemplate } from "./review-dispatch-template.js";
import { askEnabledFor, reviewAskMode, silentRunNotice } from "./review-ask.js";

/** 05 §8 公共响应信封（与各 tool 模块同一形状）。 */
function envelope(operationKey, outcome, fields) {
  return { operation_key: operationKey, outcome, ...fields };
}

export const REVIEW_ASK_OPERATION = Object.freeze({
  toolName: "ldvh_review_ask",
  summary:
    "两处把关询问（2026-11-13 Human 决定：取消工单后改为「要不要安排代理审查／复核」两问）。"
    + "\n\nWHEN TO CALL: 仅当对应开关打开、且你判定当次任务属「复杂任务」时。"
    + "判据不是新造的：specs/04 §6.1 三条是**条文原文**（建立或修改结构性事物／存在多个可选路径的选型／方向可能与既定决策冲突）；"
    + "specs/04 §6.1 的排除五条取反是**据此推导的判据，不是条文原文**（该节只列排除清单，规范里没有正面规定「什么情况算复杂任务」）。"
    + "\n\npoint=pre-action：动手前问「是否安排代理审查」；point=post-work：收口前问「是否安排代理复核」。（静默执行开着时这两句变为**不问、直接给派发模板**，见下。）"
    + "\n\nRETURNS decision: \"review\"（安排代理）| \"skip\"（不安排，明确答复）| \"silent\"（静默执行开着：没问，直接给你派发模板）| null（未取得答复）。"
    + "**switch_off 时不会提问**，直接返回 decision=null 并说明原因——那是设计，不是失败。"
    + "\nsilent 是**配置决定的自动安排**，不是 Human 的答复：拿到它就去派代理，并把 result.notice 原样写进交付说明（静默不等于无痕）。"
    + "\n\nNOT A GATE: skip 是合法答复，不阻断任何后续动作；本工具不返回 granted。"
    + "\n\nBOUNDARY: 它不判定「算不算复杂」，也不检查你是否真的调用了它——故这不构成机械保障（00 §4.6）。",
  // **effect 改为 may_change_state**（2026-11-13 独立审核 MINOR #7）。
  //
  // 原值 "read" **是错的**：本工具会把答复写进载体
  // （~/.dsh/ldvh/review-ask-decisions.json），那是状态变更，不是只读。
  // 该字段当时无人消费，错值没造成实际后果——但留着会让将来读它的人（或工具）
  // 以为它不落盘。**错误但无人消费的声明仍然是错的**。
  effect: "may_change_state",
  // 询问会阻塞在人身上，故整个工具不声明墙钟期限（与 ldvh_workcase_write 同理：
  // 期限是逐工具的，声明一个会让所有调用都付 Human 等待的代价）。
  //
  // **该字段此前是死的**（本工具走 defineTool 直注册，不经 toolDescriptor，
  // 而消费点 `operation.awaitsHumanDecision` 在 toolDescriptor 里）。现已**接线**：
  // 见 ldvh-tools.js 的注册处——同一套语义（等 Human → 不设期限）。
  awaitsHumanDecision: true,
});

/**
 * 工具参数 schema。`point` 必填（闭集）；`task` 是给人看的一句话任务描述，
 * 参与内容指纹——同一任务重试时指纹相同、不重问。
 */
export function reviewAskParameterSchema() {
  return {
    type: "object",
    properties: {
      point: {
        type: "string",
        enum: ["pre-action", "post-work"],
        description: "pre-action = 动手前的审查询问；post-work = 收口前的复核询问",
      },
      task: {
        type: "string",
        description: "一句话说明当次任务是什么（供 Human 认出「问的是哪件事」；参与内容指纹，同一任务重试不重问）",
      },
      claims: {
        type: "array",
        items: { type: "string" },
        description: "决定「安排代理」时要交给代理核对的对象描述：post-work 传「这项工作声称做到的事」逐条列出（最容易被漏、也最决定复核质量的一块）；pre-action 传「方案打算怎么做」的关键主张。不给则模板里明确说缺，不虚构。",
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

/**
 * 处理一次把关询问。
 *
 * @param {object} args
 * @param {string} args.point - "pre-action" | "post-work"
 * @param {string} [args.task] - 一句话任务描述
 * @param {object} deps - 装配侧依赖
 * @param {() => object} deps.getReviewAskSettings - 每次现读的开关解析
 * @param {object} deps.hostSeams - 见 host-seams.js（用其 requestReviewAsk）
 * @param {object} exec - 工具执行上下文（含 agent 与 signal）
 */
export async function executeReviewAsk(args, exec, deps) {
  const point = args?.point;
  if (point !== "pre-action" && point !== "post-work") {
    return envelope("review-ask", "rejected", {
      result: null,
      scope: { requested: point ?? null, completed: [], not_completed: [point ?? "(missing)"] },
      sources: [],
      gaps: [`point must be "pre-action" or "post-work", got ${JSON.stringify(point ?? null)}`],
      verification: { checks: ["point-closed-set"], passed: false },
      follow_up: ["pass point=\"pre-action\" (动手前的审查) or point=\"post-work\" (收口前的复核)"],
    });
  }
  const task = typeof args?.task === "string" && args.task.trim().length > 0 ? args.task.trim() : null;

  // 开关**每次现读**（volatile 字段无变更通知）。
  //
  // **读不到 ≠ 关着**（2026-11-13 独立审核 MAJOR #3）。原实现把 getter 抛错与
  // getter 缺失都并进 `settings = null`，随后 `enabled !== true` 走「开关关闭」
  // 分支，返回 `completed` + `verification.passed: true`。后果：Human 明明开着
  // 开关却永远收不到提问，而我这边看到的是「completed / 开关关着 / 直接推进」，
  // 不会去报告——日志里只当一次正常关闭。
  //
  // 这与 review-ask.js 自己那段注释的警告直接矛盾（「静默兜底会让『Human 显式
  // 关掉』与『配置没读到』不可区分」），也是本仓「不得让读数不可判读」的同类。
  //
  // 现在分三种情况，各自如实申报：
  //   * getter 缺失（装配漏传）  → unavailable，明说取不到开关状态
  //   * getter 抛错              → unavailable，带错误消息
  //   * 读到了但为假             → 这才是「Human 关掉了」，completed
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
      gaps: [settingsGap, "no prompt was issued because the switch state could not be determined — report this to Human (00 §4.7); do not treat it as a configured skip"],
      verification: { checks: ["point-closed-set", "switch-read"], passed: false },
      follow_up: ["report the unavailable switch state to Human; do not claim the review was skipped by configuration"],
    });
  }
  // 开关分派**走 askEnabledFor**（2026-11-13 独立审核 MINOR #7）：此前此处另写
  // 一遍 `point === "pre-action" ? … : …`，与 review-ask.js 的同款分派**是两处
  // 副本**——改一处漏一处，两边对「未知位置怎么办」的处置就可能不一致。
  const enabled = askEnabledFor(settings, point);
  // **known 标记必须被消费**（2026-11-13 独立审核 MINOR-1）。
  //
  // `resolveReviewAskSettings` 专门用 `preActionKnown/postWorkKnown` 区分
  // 「Human 关掉了」与「配置面取不到」，而此前这里只读布尔值——known 为 false
  // 时仍报 `completed` + `switch_off` + `passed:true`，与 review-ask.js 的注释
  // （「后者应如实报告，不假装是关」）正好相反。
  //
  // 后果：配置面取不到时，界面上看不出「这不是 Human 的决定」，而工具回报说
  // 「开关是关的」——两处都把「取不到」说成了「关掉」。
  const known = point === "pre-action"
    ? settings?.preActionKnown !== false
    : settings?.postWorkKnown !== false;
  // `settings === null`（读取器返回空）与 `known === false`（读取器说「这个值
  // 没设置」）**同属「取不到」**，都不是「Human 关掉了」——后者只有读到 `false`
  // 才成立（2026-11-13 独立审核 MINOR-1 提级：行路径已按 known 口径处理，工具
  // 路径此前把两者都报成「开关关闭，是配置的结果」，属不实声明）。
  if (!enabled && (!known || settings === null)) {
    return envelope("review-ask", "unavailable", {
      result: { point, task, decision: null, asked: false, switch_enabled: null },
      scope: { requested: point, completed: [], not_completed: [point] },
      sources: [],
      gaps: [
        ...(settingsGap === null ? [] : [settingsGap]),
        "the switch state is not set in the configuration — it is **not** the same as the switch being off, so no prompt was issued; report this to Human (00 §4.7)",
      ],
      verification: { checks: ["point-closed-set", "switch-read"], passed: false },
      follow_up: ["report the unset switch state to Human; do not claim the review was skipped by configuration"],
    });
  }

  // ── 静默执行（2026-11-13 晚 Human 确认 A1）──────────────────────────────
  //
  // 开关开着时**不问、直接给派发模板**：免掉的是那次询问，不是那次核对。
  //
  // **为什么这个分支放在「问签可用性」检查之前**：静默执行不需要询问通道。
  // 把它排在 seam 检查之后，会让「宿主没有 userQuestions 服务」这一情形把静默
  // 执行一并判成 unavailable——而静默的全部意义正是绕开那个人工接缝。
  //
  // **为什么它不能越过询问开关**：`reviewAskMode` 已把「询问开关关着」判成
  // `off`，本分支只在 `silent` 时进入。关掉询问开关的语义是「这一处不必有人
  // 盯着」，静默若越过它，关开关就失去了「省掉这次核对」的意思。
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
        // 静默执行同样给模板——它与「安排」给的**是同一份**，因为要做的
        // 是同一件事。区别只在「谁决定的」：那边是 Human 刚选的，这边是配置。
        review_template: reviewDispatchTemplate(point, {
          task,
          claims: args?.claims,
          evidence: args?.evidence,
        }),
        // **痕迹行**：交付说明里须原样引用它，否则「静默」就成了「无痕」。
        notice: silentRunNotice({ point, task }),
      },
      scope: { requested: point, completed: [point], not_completed: [] },
      // **没有 sources**：这一支没有经过任何宿主服务，如实留空比填一个
      // `userQuestions` 更诚实（那一面根本没被调用）。
      sources: [],
      // `silent` 分支的 `silentUnknown` 恒为 false（取不到时 reviewAskMode
      // 返回 `ask`，不进本分支）；「取不到 → 照旧询问并如实报告」由下面的
      // ask 路径承担。此处**不写死一个永不成立的条件**（独立复核 MAJOR-4）。
      gaps: [],
      // **不写 `silent-run-no-prompt` 这类自证标签**（独立复核 MINOR-9）：
      // 它不是一次实际检查，`passed: true` 会凭空成立。本分支能机械保证的
      // 只有两件——`point` 在闭集内、开关被读到且为开。派发是否真的发生，
      // 机械层不知道（见本文件头注的如实边界）。
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

  // **开关在这里短路，不委托给 seam**（2026-11-13，由单测抓出）。
  //
  // 原实现把 `enabled` 传给 seam 由它决定问不问。那使「打开才有」这条语义
  // **取决于每个 seam 实现的自觉**——本插件自己的 seam 会照做，但任何替换实现
  // （测试桩、将来重构）都可能照问不误，而调用方看不出来。开关是本工具的核心
  // 语义，必须在**唯一入口**处生效：这里短路，则无论 seam 怎么写都不会问。
  if (enabled !== true) {
    return envelope("review-ask", "completed", {
      result: { point, task, decision: null, asked: false, switch_enabled: false },
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
  });

  const asked = outcome?.asked === true;
  const decision = outcome?.decision ?? null;
  const gaps = [];
  if (settingsGap !== null) gaps.push(settingsGap);
  // 「静默开关取不到 → 照旧询问」须**如实报告**（独立复核 MAJOR-4）。
  //
  // 这条路径是真实存在的那条：配置里没有静默键时 `silentRunKnown === false`，
  // `reviewAskMode` 保守地退回询问。退回本身是对的（不知道就别擅自免掉询问），
  // 但**不回读就报**会让「配了静默却不生效」与「我本来就没开静默」不可区分——
  // 那正是本仓反复处理的那类失效。
  if (mode.silentUnknown) {
    gaps.push("the silent-run switch could not be read, so the question was asked as usual instead of being skipped by silence — this is a fallback, not a Human decision (00 §4.6)");
  }
  if (outcome?.recordError !== undefined) gaps.push(`the answer could not be recorded (${outcome.recordError}) — a retry will ask again`);
  if (outcome?.reason !== undefined && decision === null) gaps.push(outcome.reason);
  // 此处原有一个 `decision === null && asked === false && enabled === false` 的分支，
  // 追加同样的 switch_off 说明。**它不可达**——`enabled !== true` 时上面已提前
  // return，走到这里时 enabled 必为 true。留着它的害处不是多几行，而是让读者
  // 以为「开关关闭」还有第二条申报路径，从而误判开关语义的覆盖范围。

  return envelope("review-ask", decision === null ? "partial" : "completed", {
    result: {
      point,
      task,
      decision,
      asked,
      reused: outcome?.reused === true,
      ...(outcome?.fingerprint === undefined ? {} : { fingerprint: outcome.fingerprint }),
      switch_enabled: enabled,
      // 「安排」时才给模板——「跳过」时给模板是噪声，也会诱导主控照派。
      ...(decision === "review" ? { review_template: reviewDispatchTemplate(point, {
        // 不传 subject：主控只用 task 一句时，模板会把它作为对象描述呈现；
        // 硬塞 subject=task 会让同一句话在模板里出现两次。
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
        : ["未取得明确答复：按 00 §4.7 不得把沉默当作许可；向 Human 报告并等待"],
  });
}
