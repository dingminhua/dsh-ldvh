// dsh-ldvh — per-agent lifecycle registry (framework doc §4 points 1–2, 4–5).
//
// Replaces the old host-level agent/session-start + manual Map bookkeeping:
// the install point is `agent/created` (mnemon lifecycle.ts install() shape,
// dsh-agent emits it synchronously during publish), every per-agent hook
// lives on the agent's own fiber via agent.ctx.effect, and cleanup is
// automatic when that fiber is disposed — no manual agent/disposed sweeps.
//
// Discipline baked in here:
//   - subagent gate (2026-10-11, corrected 2026-10-20): `origin === "subagent"`
//     and, as the second criterion, a non-empty `parentSession` take the CHILD
//     path (child.js: mechanism mounted, content empty — no tools, no pre-step
//     channel, no sessionScopes publication). The 2026-10-20 correction excludes
//     **seeded root sessions** (`isSeeded === true && delegationDepth === 0`):
//     the host writes `parentSession` for a fork-inherited prefix too, so the
//     bare criterion starved those sessions of every LDVH tool. Any
//     remaining non-root agent is skipped. Future task agents MUST be registered
//     before install() runs, or this gate will misjudge them (review seam note,
//     mirrors mnemon taskAgentIds).
//   - child registry durability (2026-10-18): `children` / `retiredChildren` are
//     per-instance Maps, so a plugin rebuild loses every child that had already
//     finished — exactly the one the review channel asks about. start() re-adopts
//     the live roster (agents.list) and `resolveChild` recovers a finished child
//     from its own session record; see child-session-record.js.
//   - tools registration timing (audit A/C): registration happens HERE at
//     install time (assembly.tools are collected BEFORE the waterfall, so
//     registering inside the assemble handler would hide the tools from the
//     first model request). The assemble handler only reconciles on STATE
//     TRANSITIONS through the idempotent guard.
//   - no caching anywhere: every judgement call hits the registration file
//     (07 §5.3, Human gate 2026-09-03).

import { join } from "node:path";

import { resolveGovernanceScope } from "./governance-scope.js";
import { registerLdvhTools } from "./ldvh-tools.js";
import { runReviewStage } from "./experience-review-stage.js";
import { runReviewExclusive } from "./experience-review-trigger.js";
import { resolveArchiveServices } from "./archived-lineage.js";
import { createAssembleHandler, createPreStepHandler } from "./guidance.js";
import { RECALL_SUMMARY, buildRecallInjection } from "./recall-injection.js";
import { recallLimitForBudget } from "./source-recall.js";
import { noticeTextFor, noticeSummaryFor } from "./guidance-text.js";
import { createTurnTriggers } from "./triggers.js";
import { runIdleCheckpoint } from "./idle-checkpoint.js";
import { createDiscoveryProvider } from "./friction-discovery-provider.js";
import { landDiscoveryVerdict, pendingReasonFromLanding, residualFromLandingError } from "./friction-landing.js";
import { landCaptureVerdict, residualFromCaptureError } from "./experience-landing.js";
import { advanceWatermark, recordActivity, admitAndRecordDispatch, releaseDispatch } from "./friction-watermark.js";
import { admitIdleDispatch, pickEnabledAuxTasks } from "./idle-settings.js";
import { recordRun, readRuns } from "./idle-runlog.js";
// stage 的唯一派生点：三处调用同一实现，避免「修一处漏两处」（见 run-stage.js 注释）。
import { deriveStage } from "./run-stage.js";
import { verifyRun as verifyMechanically, NOT_CHECKABLE_ROWS, MECHANICAL_ROWS, DEFERRED_ROWS } from "./verification-run.js";
import { COMPLEXITY_CRITERIA, REVIEW_ASK_ROW_SUMMARY } from "./review-ask.js";



/**
 * 渲染「两处把关询问」的行为提示行。
 *
 * ## 它说什么、不说什么
 *
 * **说**：当前哪个开关开着、这一刻该判什么、判为复杂后要做什么、用哪个入口提请。
 *
 * **不说**：「本次任务就是复杂任务」——那是 AI 的语义判断，注入行不得代判
 * （02 §9.2：注入只给候选，定性由 AI 后续判断；06 §6：弱约束不代为判定）。
 *
 * ## 为什么把判据原文抄进注入行
 *
 * 判据来自 04 §6.1，**不是新造**。但其中两部分性质不同：**三条正面是
 * 条文原文**；**五条排除的取反是据此推导的判据，不是条文原文**（该节只列排除清单，
 * 规范里没有正面规定「什么情况该建工单」——2026-11-13 逐条核对原文后的更正）。
 * 此处抄的是**判据清单**而非规则正文
 * ——10 §5.3 的「不复制第二份规则源」针对的是把规范条文整体搬进引导面形成第二
 * 权威；一份标明出处的判据清单是让 AI 能据此判断的**必要输入**，与召回行列出
 * 「有哪些 Pitfall 候选」同性质。每条都带规范指针，便于回指原文核对。
 */
/**
 * 把关询问提示行的正文。
 *
 * **导出**（2026-11-13 独立审核 MINOR #7 之后）：此前它是模块私有的，于是
 * 「两个开关都关」这一支的显示**没有任何测试覆盖**——而那一支原本是错的
 * （会显示「行动后复核：**已开启**」）。导出后才有一条测试能直接驱动它。
 */
export function buildReviewAskNotice({ preOn, postOn, preKnown = true, postKnown = true }) {
  const criteria = COMPLEXITY_CRITERIA
    .map((item, index) => `  ${index + 1}. ${item.label}（${item.source}）`)
    .join("\n");
  const lines = [
    // 正文首行也**不写插件名**：这一行展开后仍挂在「上下文注入 · dsh-ldvh」之下，
    // 再写一遍就是同一行里第三次重复（折叠标签已去掉，此处同步）。
    "两处提请的开关状态（Human 2026-11-13 决定：取消工单，改为「要不要安排代理」两问）",
  ];
  // 开关状态四态：**已开启 / 关闭（Human 关掉）/ 未设置（取不到，按关处理）**。
  //
  // 「关闭」与「未设置」必须可区分：前者是 Human 的决定，后者是配置面取不到
  // 时的回落——后者不该被陈述成「Human 关掉了」（review-ask.js 的
  // preActionKnown/postWorkKnown 就是为此存在的，此前无消费方）。
  //
  // 2026-11-13 修：**两个开关都关时的分支原本不存在**，原 else 只覆盖
  // 「pre 关、post 开」，于是 both-off 时会显示「行动后复核：**已开启**」——
  // 与事实相反。生产路径因 both-off 直接不注入而侥幸避开，但函数本身是错的，
  // 且被单测直接调用时随时会暴露。
  const stateOf = (on, known) => (on ? "**已开启**" : (known ? "关闭" : "关闭（未设置，按关处理）"));
  lines.push(`- 行动前审查：${stateOf(preOn, preKnown)} ｜ 行动后复核：${stateOf(postOn, postKnown)}`);
  lines.push("", "判据（不新造；specs/04 §6.1 三条正面是条文原文，其排除五条取反是据此推导的判据而非条文）：");
  lines.push(criteria);
  lines.push("");
  if (preOn) {
    lines.push("① 动手前：按上面判据判定本次是否「复杂任务」。判为复杂时，须先询问 Human「是否安排代理审查」，取得明确答复后才动手。");
  }
  if (postOn) {
    lines.push("② 收口前：一件复杂任务做完时，须询问 Human「是否安排代理复核」，取得明确答复后再收口。");
  }
  lines.push("");
  // **不再推荐裸调 ask_user_question**（2026-11-13 独立审核 MINOR #5）。
  //
  // 宿主 `ask_user_question` 不读这两个开关、也不写答复载体：走它等于绕开
  // 「关着就完全不问」，且同一件事会反复问（无留痕）。原句把两条路径并列成
  // 等价入口，而这条路是**本行主动推荐**的——「开关关闭就完全不问」的声明
  // 在那条路径上不成立。
  lines.push("提请入口：`ldvh_review_ask`（读开关、记录答复、同一内容不重复提问）。");
  lines.push("**不要改用宿主 ask_user_question**：它不读这两个开关、也不记录答复——关着也会问、问过还会再问。");
  lines.push("**如实边界**：开关只决定「问不问」；「算不算复杂」由你判断，机械层不判定——判错或没判，本机制不会拦。故这不构成机械保障，只是按开关执行的自律 + 答复留痕。");
  return lines.join("\n");
}

/**
 * 把一次审核运行的结局整理成 §18 逐行核对结论（11 §18「运行完成」）。
 *
 * **这不是第二次判断**：它只把该次运行**已经产生**的事实映射到 §18 的行上——
 * 例如「派发条目的判定完备」看的是 `unsettled` 是否为空。凡该次运行没有采集到
 * 证据的行，一律落 `not-checkable` 并带上原因，**不填 pass**（填 pass 等于把
 * 没核对记成核对通过，那正是本门禁要消除的）。
 *
 * 返回 `null` 表示该次运行没有可核对的结局（如 skipped），此时痕迹里不写
 * `verification` 字段——缺席与空结果是两件事。
 */
import { appendPendingEntry, countPendingEntries } from "./pending-queue.js";
import { adoptFinishedChild, createChildInstaller } from "./child.js";
import { resolveChildFromSessionRecord } from "./child-session-record.js";
// 11 §11「切分依据只能是宿主会话记录中的位置」：重启后从记录里取回最后轮次号
// （`lastTurn` 没有持久化载体，见 session-position.js）。
import { readLastTurn } from "./session-position.js";
import { ActivityLog, AgentLifecycle } from "./agent-lifecycle.js";
import { recordJudgementForGuard } from "./host-seams.js";


/**
 * 落一份「决定路径与预检的配置取值」快照，供 §18「路径约定落实」「无主控预检落实」
 * 两行在运行结束时比对（2026-11-03，Human 选「落配置快照」）。
 *
 * ## 为什么必须在这里取值
 *
 * 这两行核对的是「规范与调度侧**事先**配置了什么」，不是「这次运行做了什么」。
 * 运行结束时配置可能已被改过，事后读只能读到新值——那就成了用当前配置评判过去
 * 的行为。故在派发前取一次，随运行痕迹落盘。
 *
 * ## 取哪些值，以及为什么
 *
 *   - `riskLayer` / `fastPath`：§14 第 1 条要求本任务走第 2 层标准路径、不适用快通道；
 *   - `precheckSource`：§14 第 2 条要求预检由规范与调度侧事先配置（取值恒为
 *     "configured"——本任务不存在「执行体临时裁量」这条路径，故它是对**结构性
 *     事实**的登记，不是可调开关）；
 *   - `semanticGapsDeclared`：§14 第 2 条要求语义判断环节如实登记为 gap。
 *
 * 取不到设置时返回 null → 两行记 not-checkable（条件未出现），**不填 pass**。
 */
/**
 * 探明「§14 结构性实质」——不是读配置，而是**核对实现里是否真的没有可偏离的入口**。
 *
 * ## 为什么不是读配置
 *
 * 「路径约定落实」与「无主控预检落实」两行，前两版我都做错了：第一版写四个硬编码
 * 常量当快照（恒 pass、不可证伪），第二版把它们记成「结构性保证」直接放行（同样
 * 不可证伪）。第三轮复核两次都判为伪造。
 *
 * 真正的问题是我一直在找「配置载体」，而这两行核对的东西**本来就不是配置**：
 *   - §14 第 1 条把层级**直接规定**为标准路径（不适用快通道）——没有「选择层级」
 *     这一动作，所以也没有「层级配错」这种可能；
 *   - §14 第 2 条要求预检**事先配置**、执行体**不作临时裁量**——核对的是
 *     「实现里有没有留裁量入口」。
 *
 * 故正确的采集点是**对实现本身的可复现断言**：检查审核段的导出接口是否接受
 * 风险层／快通道／预检结论等裁量参数。**没有**这种参数，才说明裁量入口不存在。
 * 这是可证伪的：一旦有人给 `runReviewStage` 加上 `tier` 参数，该断言立即失败。
 *
 * @returns {{structural: object}} 逐项探测结论
 */
/**
 * 取函数的**签名区**（从函数关键字到参数列表结束的 `)`）。
 *
 * **为什么只看签名区**：初版对 `String(fn)` 全文搜索，会被**函数体注释或字符串
 * 字面量**里的同名文字误报（例如注释里写「不设 tier 参数」反而判 fail）。
 * 裁量入口只可能出现在形参里，故把搜索范围收窄到签名。
 *
 * **已知边界（如实声明）**：压缩/Minify 之后形参名会被重命名，该探测在压缩产物上
 * 可能失效。故本探测**只在未压缩的源码运行形态下有效**——本仓 `plugin/lib` 以
 * 源码形态加载（见 `plugin/index.js` 的 import），不存在压缩步骤；若将来引入打包，
 * 本探测须改为别的判据（例如导出面清单的静态快照比对），此处不假装它能跨过那一步。
 */
function signatureOf(fn) {
  const src = String(fn);
  const open = src.indexOf("(");
  if (open < 0) return src;
  // 括号配平找到参数列表结尾
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(0, i + 1);
    }
  }
  return src.slice(0, open + 1);
}

/** 会构成「执行体临时裁量」入口的参数名（§14 第 2 条要求这些判断不在执行体侧）。 */
const DISCRETION_NAMES = ["tier", "riskLayer", "fastPath", "precheckResult", "allowFastPath"];

/**
 * 对**任意给定函数**做裁量入口探测（供测试喂入人造函数）。
 *
 * 抽出来是因为第五轮复核用变异证明：「只搜签名区」这一修复没有护栏——
 * 把实现改回全文搜索，全量套件仍全绿（生产代码里恰好没有 "tier" 字样）。
 * 有本入口后，测试可以喂一个「函数体含 tier 注释」的函数，断言不误报。
 */
export function probeFunctionForDiscretion(fn) {
  return probeStructuralFactsWith([["given", fn]]).discretionFound;
}

export function probeStructuralFacts() {


  return probeStructuralFactsWith([["runReviewStage", runReviewStage]], DISCRETION_NAMES);
}

/** 探测逻辑本体（供导出入口与测试共用，避免两套判据）。 */
function probeStructuralFactsWith(targets, names = DISCRETION_NAMES) {
  const found = [];
  for (const [name, fn] of targets) {
    if (typeof fn !== "function") {
      found.push(`${name}::missing`);
      continue;
    }
    const signature = signatureOf(fn);
    for (const d of names) {
      // 按词边界匹配，避免 `fastPathAllowed` 之类子串误判（那是同义入口，仍应命中；
      // 但 `riskLayered` 这类无关词不该命中）。
      const re = new RegExp(`(^|[^A-Za-z0-9_])${d}([^A-Za-z0-9_]|$)`);
      if (re.test(signature)) found.push(`${name}::${d}`);
    }
  }
  return {
    discretionFree: found.length === 0,
    discretionFound: found,
    checked: targets.map(([n]) => n),
    scope: "signature-only",
    at: new Date().toISOString(),
  };
}

/**
 * 取本会话最近的计时器判定记录，作为 §18「延迟的取消」「二次确认空闲」两行的证据。
 *
 * **不是重新判断**：判定发生在 `triggers.js` 的 `trace("silence-expiry", …)` 处——
 * 那一刻才知道「计时是否到期」「回合是否进行中」「quietFor 是否够」。运行结束时
 * 这些事实已过去，唯一能做的是**把当时落下的诊断记录取回来**。
 *
 * 取不到时返回 null：调用方据此把两行记为「本轮无延迟形态计时，该行不适用」，
 * 而**不是**填 pass 说「核对通过」。两者必须分清。
 */
export async function readTimerEvidence(dshHomePath, sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  try {
    const read = await readRuns(dshHomePath, { limit: 200 });
    if (read?.ok !== true) {
      // **载体不可用 ≠ 本轮没有发生计时**（2026-11-03 第六轮自查）。
      // 前者是真实的失败（读不到账），必须让该行阻断；后者才是「条件未出现」。
      // 若两者都返回 null，readTimerEvidence 的 catch 会把「读不到」说成「没有」，
      // 正是本单反复要消除的形态。故用一个显式标记区分。
      return { unavailable: true, reason: read?.error?.code ?? "runlog/unavailable" };
    }
    const runs = Array.isArray(read.value?.runs) ? read.value.runs : [];

    // **两类证据分开找**（2026-11-03）：
    //   - `silence-cleared`：清理后回读（`handleCleared`）→ 供「延迟的取消」；
    //   - `silence-expiry`：到期时的确认判定 → 供「二次确认空闲」。
    // 它们发生在不同时刻，此前只找后者，于是「延迟的取消」永远拿不到自己的证据。
    // **证据必须落在本轮时间窗内**（2026-11-03 第五轮复核指出此前无时间窗：
    // 从最近 200 条里取同会话最后一条，于是 10 小时前的记录仍能让本次判 pass）。
    // 窗口取「本轮开始前 30 分钟」到「现在」：到达期→派发→运行这条真实链路上，
    // 相关诊断必然落在该区间内；更早的记录属于上一轮，不得复用。
    const since = Date.now() - 30 * 60 * 1000;
    const inWindow = (r) => {
      const at = Date.parse(String(r?.at ?? ""));
      return Number.isFinite(at) && at >= since;
    };
    const found = { cleared: null, expiry: null };
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const r = runs[i];
      if (r?.task !== "diagnostic") continue;
      if (r?.session !== sessionId) continue;
      if (!inWindow(r)) continue;
      if (r?.stage === "silence-cleared" && found.cleared === null) found.cleared = r;
      if (r?.stage === "silence-expiry" && found.expiry === null) found.expiry = r;
      if (found.cleared !== null && found.expiry !== null) break;
    }
    if (found.cleared === null && found.expiry === null) return null;
    // 把两类证据合成一个对象，由各行的判定各取所需。
    return {
      handleCleared: found.cleared?.handleCleared,
      hadTimer: found.cleared?.hadTimer,
      clearedAt: found.cleared?.at ?? null,
      clearedReason: found.cleared?.reason ?? null,
      reason: found.expiry?.reason ?? null,
      turn: found.expiry?.turn ?? null,
      expiryAt: found.expiry?.at ?? null,
      // 三项确认的逐项结论（triggers 在 dispatching 时带出）
      confirmedAt: found.expiry?.confirmedAt,
      quietFor: found.expiry?.quietFor,
      idleMs: found.expiry?.idleMs,
      turnInFlightObserved: found.expiry?.turnInFlightObserved,
      confirmNoTurn: found.expiry?.confirmNoTurn,
      confirmQuiet: found.expiry?.confirmQuiet,
      confirmNoOtherTimer: found.expiry?.confirmNoOtherTimer,
    };
  } catch {
    return null;
  }
}

/** 本轮无延迟形态计时时，两行的「不适用」说明（条件未出现，不是没实现）。 */
/** 未取得结构性探测结论时的理由（条件未出现）。 */
const STRUCTURAL_NOT_PROBED = "未取得结构性探测结论；该行核对的是实现里有无裁量入口，探测未执行则无从判定";

const TIMER_NOT_APPLICABLE = "本轮无延迟形态计时（静置未到期），该行的条件未出现；这不是「已核对通过」，也不是「未实现」";

/**
 * 把一次审核运行的结局整理成 §18 逐行核对结论（11 §18「运行完成」）。
 *
 * ## 它做什么，不做什么
 *
 * 只把该次运行**已经产生**的事实映射到 §18 各行上，不做第二次判断。凡该次运行
 * 没有采集到证据的行，**一律落 `not-checkable` 并带原因**——不是跳过不报。
 * 「跳过不报」与「报了 not-checkable」在结论上差别巨大：前者让 `verifyRun` 的
 * 完整性检查把整轮判为 blocked（缺席不等于通过），后者是**如实声明缺口**。
 *
 * ## 2026-11-03 复核修复（第 3 项缺陷）
 *
 * 初版只产出 4 条机械行 + 2 条声明行，其余 17 条机械行**从不报出**——而模块
 * 完整性检查会把缺席判 fail，故运行时恒 blocked。现在改为：**先按 §18 全表
 * 逐行给出结论**，没有采集点的行显式落 not-checkable 并写明「本行需要动作点
 * 采集，运行结束时的痕迹不足以充当证据」。
 *
 * @returns {object|null} null 表示该次运行无可核对结局（skipped），痕迹不写该字段
 */
export function verifyReviewRun(reviewOutcome, timerEvidence = null, structural = null) {
  if (reviewOutcome === null || typeof reviewOutcome !== "object") return null;
  const outcome = reviewOutcome.outcome;
  if (outcome === "skipped" || outcome === undefined) return null;

  const unsettledN = Array.isArray(reviewOutcome.unsettled) ? reviewOutcome.unsettled.length : 0;
  const transferFailedN = Array.isArray(reviewOutcome.transfer_failed) ? reviewOutcome.transfer_failed.length : 0;

  /** 该次运行**真正采集到**证据的行：id → [verdict, evidence]。 */
  const collected = new Map([
    ["派发条目的判定完备", unsettledN > 0
      ? ["fail", `unsettled=${unsettledN} 条未判完`]
      : ["pass", "unsettled 为空，本次派发的每条均有去向"]],
    ["转写条目的合法性", transferFailedN > 0
      ? ["fail", `transfer_failed=${transferFailedN} 条`]
      : ["pass", "本轮无转写失败"]],
    ["fail-closed 处置", outcome === "land-failed"
      ? ["fail", `本次运行失败：${reviewOutcome.action ?? "unknown"}`]
      : ["pass", "本次运行未触发 fail-closed"]],
    ["缓冲条目不可写／不可回读",
      outcome === "land-failed" && /buffer|unreadable/i.test(String(reviewOutcome.action ?? ""))
        ? ["fail", `outcome=${outcome} action=${reviewOutcome.action ?? "null"}`]
        : ["pass", `outcome=${outcome} action=${reviewOutcome.action ?? "null"}`]],
    // **延迟的取消 / 二次确认空闲**（2026-11-03 第三次复核修正）。
    //
    // 第三轮复核指出三处实质缺陷，全部成立：
    //   ① 无 fail 路径——任何 reason 都记 pass，等于不可证伪；
    //   ② 无时间窗——从 limit:200 里取最后一条同会话记录，一次到期后永远 pass；
    //   ③ §18 对本行的可接受依据是「清理后的本地回读（句柄为空）」，而
    //      silence-expiry 诊断里**没有句柄回读**这项证据，`disposed` 反而更像异常现场。
    //
    // 后续（第四、五轮）已在 `triggers.js` 补齐真采集：`clearSilenceTimer` 在清理前
    // 捕获句柄、清理后回读 `_idleTimeout` 是否为 -1（这是区分「被清理」与「自然到期」
    // 的独立观察），到期确认则记录 `quietFor`/`idleMs` 观测值由判定侧复算。
    // 故现在只有**证据缺失**时才记 not-checkable，有证据即给真结论。
    ["延迟的取消", (() => {
      if (timerEvidence?.unavailable === true) {
        // 读不到账是**真实失败**，不是「条件未出现」——不得记缺口放行。
        return ["fail", `计时证据不可读（${timerEvidence.reason}）；无法确认清理是否发生，按 §12 fail-closed 处置`];
      }
      if (timerEvidence === null) return ["not-checkable", TIMER_NOT_APPLICABLE];
      // 唯一可判的情形：诊断记录真的带回了「清理后句柄为空」的回读结果。
      // 确有计时器被清掉：回读须证明状态槽已空。
      if (timerEvidence.hadTimer === true) {
        if (timerEvidence.handleCleared === true) {
          // **不得声称「已独立验证清理成功」**：实测 Node timer API 下，
          // clearTimeout 与自然到期之后的可观察量相同，无法区分两者。本行能确证的
          // 只有「状态槽已空」这一条（清理没生效时槽会非空，那是它唯一可失败的路径）。
          return ["pass", `确有计时器进入清理路径（${timerEvidence.clearedReason ?? "?"}），清理后状态槽已空；`
            + "（能力边界：无法区分「被清理」与「自然到期」，故不外推「清理动作成功」）"];
        }
        return ["fail", `清理后状态槽仍非空（${timerEvidence.clearedReason ?? "?"}）——清理未生效`];
      }
      // 本来就没有计时器：§18 该行是「回合开始即清掉计时」，条件未出现。
      if (timerEvidence.hadTimer === false) {
        return ["pass", `清理时本无计时器（${timerEvidence.clearedReason ?? "?"}），该行条件未出现、无需清理`];
      }
      return ["not-checkable", `诊断记录（${timerEvidence.reason ?? "?"}）未带回「清理后句柄为空」的回读结果；§18 该行的可接受依据正是该回读，本痕迹无法判定`];
    })()],
    ["二次确认空闲", (() => {
      if (timerEvidence?.unavailable === true) {
        return ["fail", `计时证据不可读（${timerEvidence.reason}）；无法确认空闲确认是否成立，按 §12 fail-closed 处置`];
      }
      if (timerEvidence === null) return ["not-checkable", TIMER_NOT_APPLICABLE];
      const r = timerEvidence.reason;
      // 逐项核对三项确认——任何一项为 false 都说明「空闲未被确认」，
      // 而 §18 要求「无法确认时不派发」，故确认为 false 却是 dispatching 即异常。
      // **复算观测值，而不是相信结论布尔**（2026-11-03 第四轮复核修正）。
      //
      // 初版直接读 confirmNoTurn 等布尔——它们是采集侧的常量，恒真，等于把
      // 「采集方说通过」当成证据。现在用带出的**观测值**独立复算：
      //   quietFor 与 idleMs 都在记录里，安静是否达标由本侧重算，不由采集方断言。
      if (r === "dispatching" && timerEvidence.confirmedAt !== undefined) {
        const quietFor = Number(timerEvidence.quietFor);
        const idleMs = Number(timerEvidence.idleMs);
        if (!Number.isFinite(quietFor) || !Number.isFinite(idleMs)) {
          return ["not-checkable", `dispatching 记录未带出 quietFor/idleMs 观测值，无法复算三项确认；不接受采集方的结论布尔`];
        }
        const quiet = quietFor >= idleMs;
        const noTurn = timerEvidence.turnInFlightObserved !== true;
        const noOther = timerEvidence.confirmNoOtherTimer === true;
        if (quiet && noTurn && noOther) {
          return ["pass", `按观测值复算成立：quietFor=${quietFor}ms ≥ idleMs=${idleMs}ms、无进行中回合、无其他待触发计时（confirmedAt=${timerEvidence.confirmedAt}）`];
        }
        return ["fail", `已派发但复算不成立：quietFor=${quietFor} idleMs=${idleMs} 无回合=${noTurn} 无其他计时=${noOther}（§18 要求无法确认时不派发）`];
      }
      if (r === "turn-in-flight") {
        return ["pass", "到期时发现回合进行中，未派发（硬约束生效）"];
      }
      if (r === "not-quiet-enough") {
        return ["pass", "到期时安静时长不足，重新武装（确认机制生效）"];
      }
      return ["not-checkable", `诊断记录（${r ?? "?"}）未带回三项确认的完整证据；该行无法判定`];
    })()],
    // **路径约定落实 / 无主控预检落实**（2026-11-03 第三次重做，Human 选「补真正的采集点」）。
    //
    // 前两版都错在找配置载体：第一版写四个硬编码常量（恒 pass、不可证伪），
    // 第二版记「结构性保证」直接放行（同样不可证伪）。根因是：这两行核对的东西
    // **本来就不是配置**——
    //   - §14 第 1 条把层级**直接规定**为标准路径，本任务没有「选择层级」这个动作；
    //   - §14 第 2 条要求预检事先配置、执行体**不作临时裁量**，核对的是「实现里
    //     有没有留裁量入口」。
    // 故真采集点是**对真实函数对象的可复现断言**：审核段若接受 tier / riskLayer /
    // fastPath / precheckResult 等参数，裁量入口就存在，该行即 fail。可证伪。
    ["路径约定落实", (() => {
      if (structural === null) return ["not-checkable", STRUCTURAL_NOT_PROBED];
      const offending = structural.discretionFound.filter((x) => /tier|riskLayer|fastPath/i.test(x));
      if (offending.length > 0) {
        return ["fail", `审核段出现层级/快通道裁量入口：${offending.join("、")}；§14 第 1 条要求本任务固定走标准路径`];
      }
      // **函数缺失时不得判 pass**（第四轮复核发现：missing 不匹配 tier 正则，
      // 于是「探不到」被读成「没有裁量入口」——一条假 pass 通道）。
      if (!structural.discretionFree) {
        return ["fail", `结构性探测未全部通过：${structural.discretionFound.join("、")}`];
      }
      return ["pass", `审核段导出面（${structural.checked.join("、")}）不含 tier/riskLayer/fastPath 参数，层级无从被降为快通道（§14 第 1、4 条）`];
    })()],
    ["无主控预检落实", (() => {
      if (structural === null) return ["not-checkable", STRUCTURAL_NOT_PROBED];
      const offending = structural.discretionFound.filter((x) => /precheck|allowFastPath/i.test(x));
      if (offending.length > 0) {
        return ["fail", `审核段出现预检/放行裁量入口：${offending.join("、")}；§14 第 2 条要求预检事先配置、执行体不临时裁量`];
      }
      if (structural.discretionFree !== true) {
        return ["fail", `审核段存在裁量入口：${structural.discretionFound.join("、")}`];
      }
      return ["pass", `审核段导出面（${structural.checked.join("、")}）不含预检/放行参数，执行体无临时裁量入口（§14 第 2 条）`];
    })()],

    // **七段完整性**（2026-11-03 第三次复核修正依据）。
    //
    // 第二轮修了「读 item.body 但真实 formed 无该字段」的形状错误。但第三轮复核
    // 指出依据仍不成立：`observation-review.js:1000` **先 push formed，:1007 才
    // readBack**；回读失败时 formed 保留、同时 push unsettled。故「formed 每条都
    // 通过回读」是假陈述。
    //
    // 如实做法：formed 非空只说明「本轮有对象被创建」，**不证明七段齐备**。
    // 该行的真实证据（body_valid 回读结果）没有随 reviewOutcome 带出来，故记
    // not-checkable 并写明缺什么——不拿「formed 非空」冒充「七段已核」。
    // （未成文时同样记 not-checkable：无对象可核 ≠ 核对通过。）
    ["经验对象的七段完整", (() => {
      const formedNow = Array.isArray(reviewOutcome.formed_all)
        ? reviewOutcome.formed_all.length
        : (reviewOutcome.formed === null || reviewOutcome.formed === undefined ? 0 : 1);
      if (formedNow === 0) {
        return ["not-checkable", "本轮未形成经验对象，无对象可核；「不适用」不等于「核对通过」"];
      }
      // formed 元素只有 {entry_id, object_uid, file}，不含 body_valid 回读结果。
      return ["not-checkable", `本轮形成 ${formedNow} 个对象，但 formed 只带 entry_id/object_uid/file，不含 body_valid 回读结果；七段齐备性无法从本痕迹判定`];
    })()],
  ]);

  // **按 §18 全表逐行产出**（机械行 + 已声明不可判行）：没有采集点的行显式落
  // not-checkable，不跳过。这样「本轮核对过哪些行、哪些没核对」在痕迹里读得出。
  const rows = [];
  for (const id of MECHANICAL_ROWS) {
    const hit = collected.get(id);
    if (hit) {
      rows.push({ id, verdict: hit[0], evidence: hit[1] });
    } else {
      // 该行有判定可作，但本轮没有采集点 —— 记入已知缺口（`DEFERRED_ROWS`），
      // 不阻断但随痕迹带出。理由逐行取自缺口清单，不在此处另写一套。
      rows.push({ id, verdict: "not-checkable", evidence: DEFERRED_ROWS[id] ?? "本行本轮无采集点" });
    }
  }
  for (const [id, reason] of Object.entries(NOT_CHECKABLE_ROWS)) {
    rows.push({ id, verdict: "not-checkable", evidence: reason });
  }

  // **注意**：上面「无采集点 → not-checkable」的行并不在 `NOT_CHECKABLE_ROWS` 里，
  // 故会被 `verifyRun` 判为 `undeclared` 而阻断。这是**刻意的**：它们确实没被核对
  // 过，不该被静默当成通过。要让它不阻断，唯一正当途径是把该行的采集点真的实现
  // 出来——而不是放宽声明表。
  // **这四行不再列入缺口表**（它们已有真采集点，见 scope 第 5 条），但本轮若
  // 确实没拿到证据（无计时发生 / 未探测），仍须如实记 not-checkable 而不是 pass。
  // 为使其不被判为「未声明」，把它们作为**本轮条件未出现**单独声明给 verifyRun：
  // 声明的含义是「本轮确实没证据」（值不与 DEFERRED_STRICT 匹配 → 不拦 pass，
  // 因为条件一旦出现本就该给真结论）。
  // **只在本轮确实无从观测时才声明为条件未出现**（2026-11-03 第四轮复核修正）。
  //
  // 初版把「这四行只要 not-checkable」就一律声明为「本轮条件未出现」——那是新的
  // 万能免责：runlog 读失败（catch → null）、到期但 not-governed、以及任何未来的
  // 缺证据情形，全都被说成「条件没发生」，门禁照样 landed。复核实测了这条通道。
  //
  // 现在区分两种 not-checkable：
  //   - **无从观测**（证据源整个不存在：本轮没有计时器也没有到期记录 / 探针未运行）
  //     → 才声明为条件未出现，不阻断；
  //   - **观测到了却证据不全**（有记录但字段缺失、复算不通过）
  //     → **不声明**，让它落 undeclared 并阻断。这是缺陷，不该被免责。
  const CONDITIONAL_ROWS = ["延迟的取消", "二次确认空闲", "路径约定落实", "无主控预检落实"];
  const unobservable = timerEvidence === null && structural === null;
  const conditionallyUnproven = {};
  if (unobservable) {
    for (const id of CONDITIONAL_ROWS) {
      const row = rows.find((r) => r.id === id);
      if (row !== undefined && row.verdict === "not-checkable") {
        conditionallyUnproven[id] = "本轮既无计时记录、也未运行结构性探测，该行无从观测（非「已核对」）";
      }
    }
  }
  // **不需要 else 分支**（2026-11-03 第五轮复核指出原 else 是空操作）：
  // 有证据源却仍有行落 not-checkable 时，不进声明表即可——`verifyRun` 会把它们
  // 判为 undeclared 并阻断。原先那个空转的循环什么也没做，删掉以免误导。
  const verdict = verifyMechanically({ rows, deferred: { ...DEFERRED_ROWS, ...conditionallyUnproven } });
  return {
    stage: verdict.stage,
    deferredRows: verdict.deferredRows ?? [],
    fail: verdict.fail,
    undeclared: verdict.undeclared,
    misreported: verdict.misreported ?? [],
    missing: verdict.missing ?? [],
    rows: verdict.rows,
  };
}

/**
 * 把检查点的失败原因压成一行，供运行痕迹的 `note` 承载（2026-11-03，丙方案）。
 *
 * **为什么需要它**：待处置队列里的 `residual` 是数组（逐项诊断），而运行痕迹的
 * `note` 是一个短字符串（`idle-runlog` 已定义多年、上限 300 字符，此前无生产者）。
 * 两本账的粒度不同，故此处只取**首项 + 项数**：首项通常是错误码，足以回答「这次
 * 是怎么败的」；要看全部细节仍回队列按 `pending_entry_id` 取——这正是补上那个键
 * 的目的（痕迹给索引，队列给细节，不必在痕迹里复制一份）。
 *
 * **只搬运，不解释**（01 §11.4）：不把 stopReason 翻成白话结论，也不推断根因。
 */
function describeStopForRunlog(error) {
  const residual = Array.isArray(error?.residual) ? error.residual : [];
  const head = residual.length > 0 ? String(residual[0]) : "";
  const more = residual.length > 1 ? `（另有 ${residual.length - 1} 项，见待处置队列）` : "";
  const base = typeof error?.stop_reason === "string" && error.stop_reason.length > 0
    ? error.stop_reason
    : String(error?.message ?? "");
  return head.length > 0 ? `${base} — ${head}${more}` : `${base}${more}`;
}

export function createLifecycleRegistry(ctx, { dshHomePath, workspaceRoot, sessionScopes, hostSeams, getIdleSettings, getInjectionBudget, getReviewAskSettings, providerRoster = null }) {
  // 零上下文 provider 的发现名册（宿主 0.2.2-rc.2 删除 ctx.subagents.list() 后的
  // 唯一枚举通道）。由装载方订阅 subagent/provider-added|removed 建立；缺省时
  // 各派发点仍会经 getProvider 现查内置名，故不会因缺名册而完全失效。
  // 变量名刻意区别于下方 adopt 循环里的 `roster`（那是 agents 名册，两回事）。
  const providerRosterRef = providerRoster;
  // Per-agent state lives on the agent fiber, but this plugin owns the single
  // effect it installed there. Keep its disposer so plugin unload can release
  // just that effect without disposing the agent or another plugin's effects.
  const agents = new Map();
  const agentEffects = new Map();
  let stopped = false;
  let stopPromise = null;
  // Keep timers separately as a fallback if an owned effect cannot clean up;
  // plugin unload must not leave a second trigger running for the same session.
  const agentTimers = new Map();
  // Subagent lifecycles: agentId -> { dispose, record } (child.js mechanism).
  // Only LIVE children: the entry is removed when the child's fiber disposes.
  const children = new Map();
  // Finished children: agentId -> { record }. A finished child is exactly the
  // one you want to collect a result from, so deleting its record on dispose
  // made result collection useless — verified live: the tool always reported
  // "Found 0 child record(s)" because the subagent had already ended. Bounded
  // FIFO eviction; this is a collection window, not a durable store.
  const retiredChildren = new Map();
  // Registry-level activity trail (2026-10-18 子代理登记表被清空 修复, 步骤 1):
  // children/retiredChildren 的写入、清空、adopt 三类事件，运行期可回读，不依赖
  // 控制台。与 per-agent AgentLifecycle.activity (roots) 与 DelegatedChildRecord
  // .activity (children) 同形——同一 ActivityLog 类、同一 consumer 形状。
  const registryActivity = new ActivityLog();
  const installChild = createChildInstaller(ctx, {
    agents,
    children,
    sessionScopes,
    retiredChildren,
    onEvent: (hook, detail) => registryActivity.record(hook, detail)
  });

  function agentIdOf(agent) {
    return agent?.id ?? agent?.session?.header?.id;
  }

  function sessionIdOf(agent) {
    return agent?.session?.header?.id;
  }

  async function resolve(cwd) {
    return resolveGovernanceScope(dshHomePath, cwd);
  }

  /** Idempotent tools guard: reconcile registration with the judged state. */
  function syncTools(agent, scope) {
    if (stopped) return;
    const agentId = agentIdOf(agent);
    if (typeof agentId !== "string") return;
    const lifecycle = agents.get(agentId);
    if (lifecycle === undefined || agentEffects.get(agentId)?.agent !== agent) return;
    const shouldRegister = scope.state === "governed" && agent?.ctx !== undefined;
    if (shouldRegister && lifecycle.toolsDisposer === null) {
      try {
        lifecycle.toolsDisposer = registerLdvhTools(agent.ctx, {
          dshHomePath,
          workspaceRoot,
          // 审核设置的取值函数（供 ldvh_probe_host_automation 的 reconcile 诊断读
          // 「当前实际生效的开关/间隔」——那是判断「改了设置有没有生效」的唯一依据）。
          getIdleSettings,
          // 两处把关询问的开关（2026-11-13 Human 决定）：`ldvh_review_ask` 与此处
          // 注入行共用同一个取值函数，故设置页改动对「工具询问」与「行为提示行」
          // 同时生效——两处读同一份配置，不存在一处生效一处不生效的形态。
          getReviewAskSettings,
          sessionPersistence: () => ctx.get("sessionPersistence"),
          // Host goal service (specs/10 §5.8, specs/21 §14 「宿主推进目标」): the
          // getter is passed rather than a resolved value, so a composition
          // without the service yields `undefined` at call time and the
          // WorkCase write points fail closed instead of skipping the goal.
          goals: () => ctx.get("goals"),
          // Delegation chain: the children Map is the data source for
          // ldvh_collect_subagent_results. Without it that tool is skipped by
          // its own guard (ldvh-tools.js: `deps.children !== undefined`) and
          // never registers — found in live verification, not by unit tests.
          children,
          // 活体 + 已结束子代理的统一枚举（childRecords）。collect 工具据此
          // 才能查到**已经结束**的子代理——原实现只读活体 Map，而子代理结束
          // 时记录被移入 retiredChildren，导致「只在运行中查得到」（2026-09-26 修）。
          listChildren: childRecords,
          // 子代理身份的可信来源（源于一次实测）：子代理本身
          // 不注册 ldvh_* 工具（`origin === "subagent"` 走 installChild 后即返回），
          // 故它无法自行记录复核结论。宿主侧的这张登记表持有 Code 亲观测到的
          // 子代理会话身份（`agent.session.header.id`）与其结论，是**调用方不可
          // 设置**的可信事实——工具层据此代其落盘复核条目，使「开启代理做独立
          // 审核」在机械上真正可行。
          lookupChild,
          // 建前审核的自动派生（21 §14 Gate 1 前置，2026-11-04）：create 成功后由
          // 插件直接派生零上下文子代理做审核，而不是等主控自觉。「闸只拒绝、不推动」
          // 是实测到的失效面——主控建完 draft 直接跳到处置，整个审核环节被跳过。
          // 取不到该服务时自动派生的结果为 unavailable，如实报告而非静默降级。
          subagents: (() => {
            try { return agent?.ctx?.get?.("subagents") ?? null; } catch { return null; }
          })(),
          // 同一条发现通道的候选名册（宿主 0.2.2-rc.2 删 list() 后无枚举入口）。
          // 建前审核的 provider 挑选经它定位候选，再由 getProvider 现查确认。
          providerRoster: providerRosterRef,
          // Durable fallback for the same channel (2026-10-18 「子代理登记表被清空」
          // 修复 · 步骤 3): the registry cannot see a child that finished before a
          // plugin rebuild, so a lookup miss asks the child's own session record.
          // Without it, `record_review` stayed structurally unusable after any
          // reload — see child-session-record.js head note.
          resolveChild,
          // 08 §6: the registration entries route their 07 §5.6 Human Gate
          // consent through ctx.userQuestions.ask via this registry.
          hostSeams
        });
        lifecycle.activity.record("tools/registered", { count: 8 });
        ctx.logger.info("[dsh-ldvh] registered LDVH tool batch (agent-scoped) for governed session %s", agentId);
      } catch (error) {
        // Two different failures land here and must not be conflated:
        //   - ReferenceError / TypeError = a wiring defect in OUR code (a
        //     missing import, a renamed export). It is silent today apart
        //     from this line, and it makes tools vanish with no other trace.
        //   - anything else = a genuine host/environment refusal.
        // Keep the fail-soft behaviour (a session must not die because a tool
        // batch failed) but make the defect class unmistakable in the log,
        // and record it on the activity trail so /ldvh/state and the activity
        // reader can see it instead of only a console line.
        const isDefect = error instanceof ReferenceError || error instanceof TypeError;
        const detail = String(error?.message ?? error);
        ctx.logger[isDefect ? "error" : "warn"](
          "[dsh-ldvh] tool registration %s for %s: %s",
          isDefect ? "DEFECT (wiring bug, not an environment refusal)" : "failed",
          agentId,
          detail
        );
        lifecycle.activity.record(isDefect ? "tools/registration-defect" : "tools/registration-failed", {
          state: scope.state,
          detail
        });
      }
    } else if (!shouldRegister && lifecycle.toolsDisposer !== null) {
      try { lifecycle.toolsDisposer(); } catch { /* already removed */ }
      lifecycle.toolsDisposer = null;
      lifecycle.activity.record("tools/unregistered", { state: scope.state });
      ctx.logger.info("[dsh-ldvh] unregistered LDVH tool batch (governance state: %s)", scope.state);
    }
    lifecycle.setScope(scope);
    // Federate the judgement to the synchronous tools.guard (08 §6): the guard
    // cannot await, so it consults the last judgement recorded for the cwd.
    recordJudgementForGuard(agent?.session?.header?.cwd, scope.state);
    // Delegation-chain propagation (2026-09-04): a parent judgement change
    // must reach already-installed children. Without this, a child that
    // installed while the parent was `governed` keeps that stale state after
    // the parent later migrates — the exact R2e counter-example (child.js only
    // refreshed on its own session-start, which for an already-running child
    // never fires again).
    propagateToChildren(scope.state, agentId);
  }

  /**
   * Push a parent judgement change to every live child of that parent.
   * Idempotent: DelegatedChildRecord.applyParentScope ignores no-op values,
   * so repeated propagation does not inflate the activity trail.
   */
  /** Live children first, then finished ones — see children/retiredChildren. */
  function childRecords() {
    const live = [...children.values()].map(({ record }) => record);
    const done = [...retiredChildren.values()]
      .filter(({ record }) => !children.has(record.agentId))
      .map(({ record }) => record);
    return [...live, ...done];
  }

  /** One child by id, live or finished. */
  function lookupChild(childId) {
    return children.get(childId)?.record ?? retiredChildren.get(childId)?.record ?? null;
  }

  /**
   * Resolve a delegated child for the review channel: the in-memory registry
   * first, then the child's own session record.
   *
   * The registry is per-plugin-instance state, and start() can only re-adopt the
   * agents the host still lists as live — so a plugin rebuild loses every child
   * that had ALREADY FINISHED. That is exactly the child the review channel asks
   * about (「复核者跑完了，现在登记它的结论」), which made独立复核 mechanically
   * impossible after any reload: five isolated reviewers lost this way on
   * one observed failure. The durable source is the session record the host itself
   * wrote; identity and lineage rules live in child-session-record.js, and the
   * hydrated record lands in retiredChildren so the next lookup — collect
   * included — is an ordinary registry hit.
   *
   * Reported as a result rather than thrown: the caller turns a
   * miss into a fail-closed refusal that names the reason for Human.
   *
   * @param {string} childId cited agent/session id.
   * @param {{parentSessionId?: string}} [options] the calling session, used to
   *   require that the cited session is one it actually delegated to.
   * @returns {Promise<{ok: true, record: object, source: string}|{ok: false, reason: string}>}
   */
  async function resolveChild(childId, { parentSessionId } = {}) {
    const known = lookupChild(childId);
    if (known !== null) return { ok: true, record: known, source: "registry" };
    const resolved = await resolveChildFromSessionRecord({
      sessionPersistence: ctx.get("sessionPersistence"),
      childId,
      parentSessionId
    });
    if (resolved.ok !== true) {
      registryActivity.record("child/resolve-miss", {
        childId,
        parentSessionId: parentSessionId ?? null,
        reason: resolved.reason
      });
      return { ok: false, reason: resolved.reason };
    }
    const record = adoptFinishedChild({
      retiredChildren,
      header: resolved.header,
      conclusion: resolved.conclusion,
      source: "session-record",
      emit: (hook, detail) => registryActivity.record(hook, detail)
    });
    registryActivity.record("child/hydrated", {
      childId,
      parentId: resolved.header?.parentSession ?? null,
      conclusionChars: resolved.conclusion.length,
      ancestry: resolved.ancestry ?? []
    });
    return { ok: true, record, source: "session-record" };
  }

  function propagateToChildren(state, parentAgentId) {
    for (const [childId, { record }] of children) {
      if (record.parentAgentId !== parentAgentId) continue;
      const changed = record.applyParentScope(state, { source: "parent-propagation" });
      if (changed) {
        ctx.logger.info("[dsh-ldvh] propagated parent governance state %s to child %s (count: %d)",
          state ?? "none", childId, record.propagationCount);
      }
    }
  }

  /**
   * 重新 prime 一个已装 agent 的 pre-step 通道，并刷新它的 session→scope 记录。
   *
   * DSH 0.1.7 起 resume / clear / compact 会以对应 source 重新 announce
   * `agent/created`；install() 对已装 agent 直接去重返回，于是这条路径补上旧实现
   * 由 `agent/session-start` 承担的语义（该事件已删除，语义并入 payload.source——
   * 调研报告 §3.4）。顺带把父级最新判定传播给已记录的子代理：父级可能在子代理
   * 安装之后才完成判定，child 侧的 session-start 安全网同样已随事件消失。
   *
   * @param {string} agentId - 已装 agent 的 id。
   * @param {object} agent - 该 agent（用于读取 cwd 重新判定）。
   */
  function reprimeAgent(agentId, agent) {
    const lifecycle = agents.get(agentId);
    if (stopped || lifecycle === undefined || agentEffects.get(agentId)?.agent !== agent) return;
    // prime：让下一次 step-1 重新评估（mnemon primePending shape）。
    lifecycle.preStep.primePending = true;
    lifecycle.activity.record("session/reprime", { source: "agent-created" });
    void resolve(agent?.session?.header?.cwd).then((scope) => {
      if (stopped || agents.get(agentId) !== lifecycle) return; // disposed or replaced while judging
      const sessionId = sessionIdOf(agent);
      if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
      lifecycle.setScope(scope);
      propagateToChildren(scope?.state ?? null, agentId);
    }).catch((error) => {
      ctx.logger.warn("[dsh-ldvh] re-prime judgement failed for %s: %s", agentId, String(error?.message ?? error));
    });
  }

  function install(agent) {
    if (stopped) return;
    const agentId = agentIdOf(agent);
    if (typeof agentId !== "string") return;
    if (agents.has(agentId)) return;
    const header = agent?.session?.header;
    // Subagents take the child path (mechanism mounted, content empty —
    // see child.js); any other non-root agent is skipped.
    if (header?.origin === "subagent") {
      installChild(agent);
      return;
    }
    // ── 子代理识别的第二判据：parentSession（2026-10-11 补）──────────────
    //
    // **为什么必须有这一条**：上面那条用 `origin`，而本宿主上该字段**不存在**
    // （2026-10-11 实测 48 个会话——44 根 + 4 子代理——`origin` 全部为 `null`）。
    // 于是判据恒为假，子代理**不走 child 路径**，而下一道 `roots()` 关也没能拦住
    // 它（宿主把子代理也算作 root）。后果：子代理被完整 install，挂上 idle 检查点
    // 触发器，于是它**执行时又派生自己的子代理**；同时它用自己的 session id 读写
    // 水位与冷却状态，使节流按会话分家——实测冷却配置 600 秒、实际间隔 1 秒。
    //
    // **判据取自参考实现**：`dsh-auto-memory`（`lib/index.js:4971`）用
    // `header.parentSession` 非空判定子代理，其注释写明目的是「只处理顶层会话…
    // **避免子代理轮次误沉淀**」——同一个失效面。`dsh-mnemon` 用 `origin`，
    // 但它的宿主上该字段可用，故此处不能照抄。
    //
    // **与 `origin` 的关系**：两者**任一为真即走 child 路径**，不互相替代——
    // `origin` 在提供该字段的宿主上是更明确的信号，`parentSession` 是可移植的
    // 兜底。不删 `origin` 那条：删了会在提供 origin 的宿主上退化为只靠兜底。
    //
    // ── 2026-10-20 修正：种子根会话不是子代理 ────────────────────────────
    //
    // 宿主也用 `parentSession` 记录**前缀继承来源**：从既有会话 fork/continue 出来
    // 的**新根会话**同样写入 `parentSession`，同时 `isSeeded: true`、
    // `delegationDepth: 0`（宿主 SessionHeader 的 `isSeeded` 描述逐字为
    // "Whether the Session contains a fork-inherited prefix"）。
    //
    // 只判 `parentSession` 非空会把这类会话误判为子代理，且 `installChild` 的
    // 血缘检查找不到活体父（父常是另一条不并发的会话）→ 返回 false —— 而 `install()`
    // 当时已无条件 `return`，于是该会话**永久没有工具、没有 pre-step、没有
    // sessionScopes**，只有一条 32 项 `tool-removal` 与指引段，无日志、无报错。
    // 实测（该工作区 407 个会话）：4 个种子根会话在某个 turn 后 `ldvh_*` 从 32 掉到 0；
    // 49 个普通根与 350 个真子代理无一例外保持应形态。
    //
    // 判据收敛为：委派 ⟺ `delegationDepth >= 1`；`isSeeded && delegationDepth === 0`
    // 是种子根会话，**必须**走 root 路径。`delegationDepth` 缺失的旧宿主保留原行为
    // （仍按子代理处理），以免在无该字段的宿主上重新引入 2026-10-11 的失效面。
    const parentSession = header?.parentSession;
    if (typeof parentSession === "string" && parentSession.trim().length > 0) {
      const seededRoot = header?.isSeeded === true && header?.delegationDepth === 0;
      if (!seededRoot) {
        installChild(agent);
        return;
      }
    }
    // Roots-only gate: the agents service is read via ctx.get: host
    // compositions always provide it, but a minimal test/fabricated ctx may
    // not — absence means there is no roster to check against, which we
    // treat as "not a root we can verify" (skip, fail-closed).
    //
    // 2026-11-12 修复「新建会话失败：agentsService.roots is not a function」：
    // 宿主 dsh-agent 0.2.2-rc.2 的 AgentRegistry **没有 roots()**（只有 get/list，
    // 且 entry 无 owner 字段），此处却无条件调用 → TypeError 冒泡到
    // `agent/created` 监听器 → agents.create 整体失败 → UI 报 gateway/internal。
    //
    // 修复：`roots()` 缺失时**放行**而非拦截。理由：这道关的唯一作用是把子代理
    // 排除在 root 路径外，而子代理已由上方 parentSession/delegationDepth 判据
    // 独立拦截（installChild 后即 return，压根到不了这里）。因此在缺少 roots()
    // 的宿主上，本关是**冗余**的——用 list() 过滤也拿不到 owner 信息（entry
    // 无 owner 字段），退化为「有 roots() 就用，没有就当根」是唯一不失真的选择。
    // 反向（缺失即 return）会让旧宿主上的**所有**会话都装不上，等于全盘失效。
    const agentsService = ctx.get("agents");
    if (agentsService === undefined) return;
    if (typeof agentsService.roots === "function" && !agentsService.roots().includes(agent)) return;

    const lifecycle = new AgentLifecycle(agent);
    agents.set(agentId, lifecycle);
    const ownedEffect = { agent, dispose: null };
    agentEffects.set(agentId, ownedEffect);

    try {
      ownedEffect.dispose = agent.ctx.effect(() => {
      // Tools at install time (audit A/C): the initial async judgement
      // registers the batch BEFORE the first assemble collects tools, so the
      // first model request already sees them on governed sessions.
      void resolve(agent?.session?.header?.cwd).then((scope) => {
        if (stopped || agents.get(agentId) !== lifecycle) return; // disposed or replaced while judging
        const sessionId = sessionIdOf(agent);
        if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
        // Keep the full resolved scope for the first-turn visible-notice
        // fallback (pre-step runs before the first assemble; see below).
        lifecycle.lastScope = scope;
        syncTools(agent, scope);
      }).catch((error) => {
        ctx.logger.warn("[dsh-ldvh] initial governance judgement failed for %s: %s", agentId, String(error?.message ?? error));
      });

      const onAssemble = createAssembleHandler(agent, {
        resolve,
        syncTools: (scope) => syncTools(agent, scope),
        recordScope: (scope) => {
          if (stopped || agents.get(agentId) !== lifecycle) return;
          const sessionId = sessionIdOf(agent);
          if (typeof sessionId === "string") sessionScopes.set(sessionId, scope);
          // Publish the notice text for the pre-step visible-row injector:
          // the full judgment card, prefixed by the migration line when the
          // state changed (guidance.js owns the shape).
          lifecycle.noticeText = scope.noticeText ?? null;
          lifecycle.lastScope = scope;
        }
      });
      const onPreStep = createPreStepHandler(agent, {
        isGoverned: () => lifecycle.scopeState === "governed",
        channel: lifecycle.preStep,
        // Visible judgment row (Human 2026-09-04 "这里要能看到啊"): the
        // assemble handler updates noticeText on every judgement; the
        // pre-step injects it as a DSH-native context-injection row whenever
        // it differs from the last injected one.
        // First-turn fallback: the pre-step (prepend) runs BEFORE the first
        // assemble, so lifecycle.noticeText is still null on turn 1 — but the
        // install-time judgement already stored the full scope. Build the
        // complete card from it so the very first turn gets its visible row.
        noticeText: () => lifecycle.noticeText ?? (lifecycle.lastScope !== undefined && lifecycle.lastScope !== null ? noticeTextFor(lifecycle.lastScope) : null),
        // **不受辖时不向对话流注入可见行**（Human 2026-11-13，方案 A）。
        //
        // 只关「可见行」；系统提示侧的 `【LDVH 管辖判定】` 照旧注入——那是给
        // 模型的行为约束（不会去调没注册的 ldvh_* 工具），不是给人看的东西。
        // 详见 guidance.js 里 `suppressUngovernedRow` 的说明。
        //
        // 判据取 `scopeState === "governed"`：只有受辖才在对话流里出现判定卡。
        // `unavailable` 一并静默——它在文案上本来就「按不受辖处理」，两处口径一致。
        suppressUngovernedRow: () => lifecycle.scopeState !== "governed",
        // Inline row title (Human 2026-09-04): "上下文注入 · dsh-ldvh · 本会话受 LDVH 管辖"
        noticeSummary: () => noticeSummaryFor(lifecycle.scopeState),
        // 行动前双源召回（10 §5.3「行动前引导入口」）。只在受管辖且项目路径可用时召回；
        // 未受管辖、无项目、或用户消息不足以构成查询时返回 inject:false（02 §9.2 进入条件）。
        recallRow: async ({ userText }) => {
          // **时序陷阱（两道门，2026-10-24 修第二道）**：
          //
          // `lifecycle.scopeState` 与 `lifecycle.lastScope` 都由安装时的异步
          // `resolve()` 在 `.then` 里赋值（`agent-lifecycle.js:42` 初始 `null`、
          // `:75` 才写入）。而 pre-step（prepend）在**首次 assemble 之前**运行，
          // 故第一回合到这里时两者可能都还是初始值。
          //
          // 第 20 轮只兜底了 `project.path`（第二道门），**漏了 `scopeState` 本身
          // （第一道门）**——实测真实接线：`agent/created` 之后立即发 pre-step，
          // 召回返回 `not-governed`、注入行完全不出现。即「第一回合永远不生效」
          // 这个缺陷其实**并未真正修好**，只是被「先 settle 再测」的夹具掩盖了。
          //
          // 现两道门共用同一次 late resolve：仅当 `scopeState` 或 `project.path`
          // 任一缺失时才多这一次调用，正常路径零额外开销。
          const needsLateResolve =
            lifecycle.scopeState !== "governed" ||
            typeof lifecycle.lastScope?.project?.path !== "string" ||
            lifecycle.lastScope.project.path.length === 0;
          if (needsLateResolve) {
            try {
              const cwd = agent?.session?.header?.cwd;
              if (typeof cwd === "string" && cwd.length > 0) {
                const late = await resolve(cwd);
                if (late !== undefined && late !== null) {
                  // 补齐第一道门：判定状态。
                  if (lifecycle.scopeState !== late.state) lifecycle.setScope?.(late);
                  if (lifecycle.lastScope === undefined || lifecycle.lastScope === null) {
                    lifecycle.lastScope = late;
                  }
                }
              }
            } catch (error) {
              agent?.ctx?.logger?.warn?.(`[dsh-ldvh] recall: late scope resolve failed: ${String(error?.message ?? error)}`);
            }
          }
          // 兜底之后仍不受管辖 → 如实返回（此时是真不受辖，不是时序未就绪）。
          if (lifecycle.scopeState !== "governed") return { inject: false, reason: "not-governed" };
          let projectPath = lifecycle.lastScope?.project?.path;
          if (typeof projectPath !== "string" || projectPath.length === 0) {
            try {
              const cwd = agent?.session?.header?.cwd;
              if (typeof cwd === "string" && cwd.length > 0) {
                const late = await resolve(cwd);
                if (late?.project?.path) {
                  projectPath = late.project.path;
                  // 顺手补上，使后续回合走快路径。
                  if (lifecycle.lastScope === undefined || lifecycle.lastScope === null) lifecycle.lastScope = late;
                }
              }
            } catch (error) {
              agent?.ctx?.logger?.warn?.(`[dsh-ldvh] recall: late scope resolve failed: ${String(error?.message ?? error)}`);
            }
          }
          if (typeof projectPath !== "string" || projectPath.length === 0) return { inject: false, reason: "no-project" };
          // **召回面用自己的预算**（2026-10-25，Human 决定改定）：**不与引导面共用
          // 台账**——引导面（管辖判定 + 最小规则引导）是系统固定内容，不随业务变化，
          // 由它自己的固定常量承载；召回面随语料增长，由档位承载。两者各自独立，
          // 互不扣减（这也更合 `34 §3.3`「各规范唯一权威」的分工：注入形式与预算
          // 归属由 `10 §5.3` 统一，但两块面各自的体量各自由其常量决定）。
          // 未登记档位如实记 warn，不静默回落。
          let recallBudget;
          // **条数上限随档位走**（2026-10-27 修，Human 指出）：此前只传字节预算、
          // 不传 `limit`，于是 limit 永久取默认值 3——档位 10 下只列出 6 条、用掉
          // 13% 的预算，87% 闲置。Human 在设置里选档位，本意就是「按这个体量给
          // 结果」；不传条数等于让档位设置空转。依据见 `recallLimitForBudget` 注释
          // （34 §11：条数上限由调用方按当次需要给出，档位即该需要的量化依据）。
          let recallLimit;
          try {
            const resolved = getInjectionBudget?.();
            if (resolved?.ok === false) {
              agent?.ctx?.logger?.warn?.(`[dsh-ldvh] recall: ${resolved.reason}`);
            }
            if (resolved?.bytes > 0) recallBudget = resolved.bytes;
            // **条数由字节预算动态导出**（2026-10-27）：不再有档位→条数的静态表，
            // 预算给多少就按单条实测字节折算多少条（见 recallLimitForBudget）。
            if (recallBudget !== undefined) recallLimit = recallLimitForBudget(recallBudget);
          } catch (error) {
            agent?.ctx?.logger?.warn?.(`[dsh-ldvh] recall: budget resolve failed: ${String(error?.message ?? error)}`);
          }
          return buildRecallInjection({
            userText,
            projectRoot: projectPath,
            ...(recallBudget === undefined ? {} : { budgetBytes: recallBudget }),
            ...(recallLimit === undefined ? {} : { limit: recallLimit }),
          });
        },
        recallSummary: () => RECALL_SUMMARY,
        // 两处把关询问的行为提示行（2026-11-13 Human 决定：取消工单→改问是否
        // 安排代理审查／复核，各由设置开关控制，打开才有）。
        //
        // **它只提示、不代问**：询问本身必须由主控经 `ldvh_review_ask` 发起
        // （或模型面直接调宿主 ask_user_question），因为「这次任务算不算复杂」
        // 是 AI 语义判断，机械层判不了（本行注释与 review-ask.js 头注同一口径）。
        // 本行做的是让主控**在动手前看得见**「开关开着、该判一次复杂度」这件事
        // ——这正是 21 §14 那次「闸只拒绝、不推动」教训的推广：没有提示行，
        // 开关即使打开也会被静默跳过。
        //
        // 开关未开、或取不到项目时返回 inject:false；不产生必停。
        reviewAskRow: async () => {
          try {
            // **管辖判定在前**（2026-11-13 修，Human 指出）。
            //
            // 上一版漏了这一条，于是「本会话不受 LDVH 管辖」与「把关询问」
            // 两行同时出现在同一批上下文注入里——自相矛盾：不受辖就不该有任何
            // LDVH 的其它信息（不是「少给一点」，是不该出现）。
            //
            // 判据与召回行**同一口径**：只认 `governed`。`unavailable` 按不受辖
            // 处理（与 judgmentLineFor 的文案一致：登记不可读按不受辖对待），
            // 不因为「可能受辖」就把开关提示塞给对方。
            //
            // 注意**不等于**跳过管辖判定行：那一行是必须始终告知的（含
            // not_governed 的明示），由 noticeText 独立承载，与此行互不影响。
            // **时序兜底与召回行同源**（2026-11-13）：`scopeState` 由安装时的
            // 异步 resolve 在 .then 里写入，而 pre-step（prepend）在**首次
            // assemble 之前**运行，故第一回合到这里时它可能还是初始值。不做
            // late resolve 的后果是「首回合永远不注入」——召回行当年正是这个
            // 缺陷（第 20 轮只兜了 project.path，漏了 scopeState 本身）。
            //
            // 只在判定不是 governed 时才多这一次调用，正常路径零额外开销。
            if (lifecycle.scopeState !== "governed") {
              try {
                const cwd = agent?.session?.header?.cwd;
                if (typeof cwd === "string" && cwd.length > 0) {
                  const late = await resolve(cwd);
                  if (late !== undefined && late !== null && lifecycle.scopeState !== late.state) {
                    lifecycle.setScope?.(late);
                  }
                }
              } catch (error) {
                agent?.ctx?.logger?.warn?.(`[dsh-ldvh] review-ask: late scope resolve failed: ${String(error?.message ?? error)}`);
              }
            }
            // 兜底之后仍不是 governed → 如实返回（此时是真不受辖，不是时序未就绪）。
            if (lifecycle.scopeState !== "governed") {
              return { inject: false, reason: "not-governed" };
            }
            const settings = typeof getReviewAskSettings === "function" ? getReviewAskSettings() : null;
            if (settings === null) return { inject: false, reason: "settings-unavailable" };
            const preOn = settings.preAction === true;
            const postOn = settings.postWork === true;
            if (!preOn && !postOn) return { inject: false, reason: "both-switches-off" };
            // `settings` 的 known 标记一并传入，用于区分「Human 关掉」与「配置未设置」。
            const text = buildReviewAskNotice({
              preOn,
              postOn,
              preKnown: settings.preActionKnown !== false,
              postKnown: settings.postWorkKnown !== false,
            });
            return { inject: true, text, digest: text };
          } catch (error) {
            agent?.ctx?.logger?.warn?.(`[dsh-ldvh] review-ask row failed: ${String(error?.message ?? error)}`);
            return { inject: false, reason: "error" };
          }
        },
        reviewAskSummary: () => REVIEW_ASK_ROW_SUMMARY
      });
      // 把「会话视图被重置 → 清空注入台账」挂到 lifecycle 记录上，供
      // agent/created（clear / compact / resume）调用。见下方 disposeCreated。
      lifecycle.preStepResetVisibility = () => onPreStep.resetVisibility();
      // Turn-level triggers（11 §6.1 触发判据，2026-10-14 修订；2026-10-24 计时载体回退）。
      // 「会话确已空闲」= 距最后一次会话活动持续不短于安静时长；本块只注入
      // 编排回调与两个注入点（取安静时长、落活动时刻），判据与计时在 triggers.js 内。
      //
      // **计时器在进程内，本块不再装配任何宿主调度服务**（2026-10-24 回退）：
      // 2026-10-22 至 2026-10-24 期间，安静期计时交给宿主定时任务承载（`ctx.schedule`
      // 排期 + `[SCHEDULE REMINDER]` 投递回会话）。该形态在真实宿主上连续多次投递
      // 均未走到派发，且识别与判定环节须靠在每处早退落盘才能归因；Human 决定停用，
      // 改回每个会话各自的进程内计时（见 triggers.js 文件头）。故此处**不再有任何
      // 可选依赖**——triggers 的武装不依赖宿主服务是否存在，也就不存在「服务缺失即
      // 无法武装」的降级路径。
      const turnTriggers = createTurnTriggers(agent, {
        // 诊断痕迹注入点（2026-10-23）：dispatchCheckpoint 的派发/失败/抛错落盘。
        // 此前四次投递 0 运行记录、0 待处置条目，无法区分「没派发」与「派发后
        // 静默 return」。本注入点使 dispatchCheckpoint 的调用可被回读。
        registerDiagnostic: async (entry) => {
          await recordRun(dshHomePath, {
            ...entry,
            task: "diagnostic",
            tasks: ["diagnostic"],
            at: new Date().toISOString(),
          });
        },
        getScopeState: () => lifecycle.scopeState,
        turns: lifecycle.turns,
        activity: lifecycle.activity,
        log: ctx.logger,
        // 取安静时长（11 §6.1）。经 `getIdleSettings` 的注入点读——与准入判据
        // 同源，使设置面的改动对两者同时生效（不各读一份配置）。
        readSilenceMs: () => {
          const s = typeof getIdleSettings === "function" ? getIdleSettings() : undefined;
          return s?.limits?.silenceMs;
        },
        // 落「最后一次会话活动时刻」。**尽力而为**：写入失败只记日志，不阻塞
        // 宿主事件流。**它不再服务「跨热重载的计时连续性」**（2026-10-27 改）——
        // 装载路径不读回这个值、不据此重建计时（11 §6.1「重启使安静期作废」）。
        // 现用途只有一处：留作诊断材料，供事后复算「本次是否满足所声明的时机」。
        // （本条措辞按独立审核 2026-10-27 的发现修正：原文仍写「跨热重载的计时
        // 连续性」，与新纪律直接矛盾；另据同一发现，仓内当前**没有**生产读取面，
        // 故不得据本注释主张「已被诊断页消费」。）
        persistActivityAt: async (ms) => {
          const cwd = agent?.session?.header?.cwd;
          const sid = agent?.session?.header?.id;
          if (typeof cwd !== "string" || cwd.length === 0) return;
          if (typeof sid !== "string" || sid.length === 0) return;
          const scope = await resolve(cwd);
          if (scope.state !== "governed" || scope.project === undefined || scope.project === null) return;
          await recordActivity(dshHomePath, {
            projectRoot: scope.project.path,
            sessionId: sid,
            at: new Date(ms).toISOString(),
          });
        },
        onSessionCheckpoint: async ({ source, turn }) => {
          // 空闲辅助任务的调度（04 §8.3/§8.4 + 32 §10.2）。**不 await 关闭事件**
          // ——调用方（triggers）已把 promise 的拒绝收口为日志，此处保持同纪律。
          const cwd = agent?.session?.header?.cwd;
          if (typeof cwd !== "string" || cwd.length === 0) {
            await recordRun(dshHomePath, {
              task: "diagnostic", tasks: ["diagnostic"], stage: "early-return",
              reason: "cwd-empty", note: `agent?.session?.header?.cwd=${JSON.stringify(cwd)}`,
              at: new Date().toISOString(),
            });
            return;
          }
          // 11 §11「观察范围的切分（水位）」需要两个**位置标识**：会话 id 与轮次号。
          // 会话 id 取自 agent 的会话头；轮次号首选宿主 `turn/end` 载荷（triggers
          // 已用它记账）。**取不到时回落到宿主会话记录**（2026-10-19 修复）：
          // `lastTurn` 只在回合边界事件里赋值、没有持久化载体，故进程重启或插件
          // 热重载之后、该会话尚未开启新回合时它必然是 `undefined`——此时安静期
          // 计时器却已经被启动恢复旁路武装（同批修复），于是**重启后第一次闲时
          // 派发必然 fail-closed**。宿主记录里的轮次号正是 §11 所说的「位置」，
          // 不是推测，也不是「当作全部内容」。
          const sessionId = agent?.session?.header?.id;
          const scope = await resolve(cwd);

          // ── 两条时机形态分流（2026-10-26，Human：两件事分开设置）────────────
          //
          //   `session-silence`（形态 1，一次延迟）→ 摩擦发现 + 经验**捕获**（+ 审核到期则一并）
          //   `experience-review`（形态 2，固定间隔）→ **只**做审核段
          //
          // **2026-10-27 改动**：形态 2 不再由宿主周期任务投递驱动。宿主投递必须绑定
          // 一个会话，而那个「专属会话」是普通对话，会被人当工作对话使用（实测：
          // `session-2827e177` 03:22 被创建为审核落点，03:29 Human 就在里面提问）。
          // 于是审核提醒直接投进 Human 正在工作的对话。
          //
          // 现在形态 2 改由**静置检查点**驱动：静置到期时，若「距上次审核已满一个间隔」
          // 且「没有审核在跑」，就在同一次检查点内单独派发一次零上下文审核执行体。
          // `source === "experience-review"` 这条入口**保留**——它仍然可能被显式投递
          // 触发（例如 Human 手动触发一次），只是不再是常规路径。
          if (source === "experience-review") {
            const reviewScope = await resolve(cwd);
            if (reviewScope.state !== "governed" || reviewScope.project === undefined || reviewScope.project === null) {
              lifecycle.activity?.record("review/skipped", { reason: "not-governed" });
              return;
            }
            const reviewCfg = typeof getIdleSettings === "function" ? getIdleSettings() : undefined;
            if (reviewCfg?.enabled === false || reviewCfg?.review?.enabled !== true) {
              // 开关在运行期被关掉：如实记账，不静默继续跑。
              lifecycle.activity?.record("review/skipped", { reason: "disabled" });
              return;
            }
            const reviewOutcomes = {};
            await runReviewStage({
              subagents: (() => {
                try { return agent?.ctx?.get?.("subagents") ?? null; } catch { return null; }
              })(),
              // 名册是「查谁」的候选清单；可用性仍由 picker 现查 getProvider 判定。
              roster: providerRosterRef,
              parent: agent,
              sessionPersistence: ctx.get("sessionPersistence") ?? null,
              // 归档血缘守卫所需（2026-10-31），与静置检查点路径同一口径。
              ...resolveArchiveServices(ctx),
              scope: reviewScope,
              lifecycle,
              taskOutcomes: reviewOutcomes,
              dshHomePath,
              // 审核执行体的模型（Human 2026-10-26 要求）：null = 沿用宿主默认路由。
            });
            try {
              const reviewOutcome = reviewOutcomes["experience-review"];
              // **落盘 stage 必须由机械审核结论决定**（2026-11-03 复核修复，第 1 项阻断）。
              //
              // 初版把 `verification` 与 `stage` 并列写入，两者互不约束：独立复算证实
              // `transfer_failed` 非空时 `verification.stage` 为 `blocked`，而落盘的
              // `stage` 仍是 `landed`。那正是本单要消除的形态——审核结论躺在旁边，
              // 结论行本身不动。故此处改为：verification 说 blocked，stage 就**不得**是
              // `landed`，降为 `land-failed`（既有闭集内的值，不改闭集）并把阻断项带出。
              const reviewVerification = verifyReviewRun(reviewOutcome, await readTimerEvidence(dshHomePath, sessionId), probeStructuralFacts());
              const baseStage = deriveStage({ taskOutcomes: { "experience-review": reviewOutcome } });
              const reviewStage = reviewVerification !== null && reviewVerification.stage === "blocked" && baseStage === "landed"
                ? "land-failed"
                : baseStage;
              await recordRun(dshHomePath, {
                at: new Date().toISOString(),
                task: "experience-review",
                tasks: ["experience-review"],
                unimplemented: [],
                // stage 派生收敛到 deriveStage（run-stage.js）：此前是三处各自的
                // 三元式，per_task.outcome=partial 会被记成 land-failed（「部分完成」
                // 记成「失败」）。
                stage: reviewStage,
                action: reviewOutcome?.action,
                per_task: reviewOutcomes,
                // **机械审核结论随痕迹带出**（11 §18）：`stage=landed` 此前只证明
                // 「落地被调用了」。现在同时带出逐行核对结果，使「那次运行到底
                // 核对过什么」可从 `idle-checkpoint-runs.json` 回读。
                ...(reviewVerification === null ? {} : { verification: reviewVerification }),
              });
            } catch {
              // 诊断旁路不得打断机制（与安静期路径同一纪律）。
            }
            return;
          }

          // 受管辖是运行前提（32 §137：git 层操作要求当前管辖）。
          if (scope.state !== "governed" || scope.project === undefined || scope.project === null) {
            await recordRun(dshHomePath, {
              task: "diagnostic", tasks: ["diagnostic"], stage: "early-return",
              reason: "not-governed", note: `scope.state=${scope.state} detail=${scope.detail ?? ""}`,
              at: new Date().toISOString(),
            });
            return;
          }
          // 本次派发的占用令牌（2026-10-19）。在准入处取得值，在派发收尾处释放；
          // 未取得时保持 `null`，收尾处的释放因此是一次空操作。
          let dispatchClaimed = null;
          // ── 一次派发做多件事（Human 决定 2026-10-11）──────────────────────
          //
          // 原实现按 `rotation % 3` 挑**一个**任务（32 §10.2 候选设计的「按预算
          // 轮换」）。Human 改定：闲时任务的取舍由设置面开关决定，**勾选几个就做
          // 几件事**，一次派发把它们拼进**同一个**子代理的提示词。轮换概念连同
          // 轮换位计数器一并删除（`auxRotation` / `HEALTH_CHECK_PERIOD` /
          // `selectAuxTask` / `pickEnabledAuxTask`）。
          //
          // 该改动同时消除了两个既有缺陷，故此处不再需要它们的处置：
          //   · **轮换位死锁**（2026-10-11 实测）：轮换位只在准入通过后推进，而
          //     `memory-health` 默认停用 → 每次被 `task-disabled` 挡下 → 轮换位
          //     永为 2 → `friction-discovery` 再也不被跑到。**没有相位就没有死锁**。
          //   · **任务不在任何相位上**：`capacity-maintenance` 从未被选中过
          //     （实测 60 个相位里 0 次）。现在「被选中」= 「被勾选」。
          //
          // 顺序取 `AUX_TASK_ORDER`（规范叙述次序），**不取**设置对象的枚举次序
          // ——后者是 UI 细节，若成判据，同一组勾选在不同展示顺序下会得到不同
          // 提示词（隐藏耦合）。
          const idleSettingsForPick = typeof getIdleSettings === "function" ? getIdleSettings() : undefined;
          // 审核段的现值（每次检查点现读，故设置改动下一个检查点即生效）。
          const reviewEnabledAtCheckpoint = idleSettingsForPick?.review?.enabled === true;
          const reviewScopeState = scope;
          const reviewOutcomesForCheckpoint = {};
          const pickedTasks = pickEnabledAuxTasks(idleSettingsForPick);
          // 本次要跑的全部任务；痕迹与提示词都取它。
          const tasksForThisCheckpoint = pickedTasks.tasks;

          // 无可跑任务（总开关关闭、或三个子项全被停用）：**不派发任何任务**。
          //
          // 这是配置的全部含义，**不是失败**——没有校验不可用，只是没有要跑的活，
          // 故不入队、不记 throttled（那会让「Human 关掉了它」看起来像「它出错了」）。
          // 轮换位也**不动**：重开时应从原相位继续。
          if (tasksForThisCheckpoint.length === 0) {
            lifecycle.activity?.record("session/checkpoint/no-enabled-task", {
              reason: pickedTasks.reason ?? "all-tasks-disabled",
            });
            await recordRun(dshHomePath, {
              task: "diagnostic", tasks: ["diagnostic"], stage: "early-return",
              reason: "no-enabled-task", note: `pickedTasks.reason=${pickedTasks.reason ?? "all-tasks-disabled"}`,
              at: new Date().toISOString(),
            });
            return;
          }

          // ── 闲时辅助的准入闸（仅剩设置面）────────────────────────────
          //
          // **11 §6.2 现不设任何准入约束**（2026-10-14 二次修订）：本节原含三类
          // 准入约束，均已取消。故此处**没有**节流判据可算——`admitIdleDispatch`
          // 只判定两道 Human 的明示开关（总开关、子项开关），其余一律放行。
          //
          // **2026-10-14：本检查点不再读派发状态**（原 `readDispatchState` 调用已
          // 删除）。它此前只为配额判据提供「窗口内的派发时刻列表」；配额取消后
          // 该值无消费方。**派发的记时仍在别处**——`recordDispatch` 在派发成功路径
          // 上照常写入（保留 `dispatchTimes` 供诊断与将来的约束复核）。
          //
          // **为何仍需本闸**：它承载「总开关关闭 / 全部子项未勾选 → 不派发」这两道
          // Human 的明示配置。这与节流不同：前者是「Human 说不要跑」，后者是
          // 「机制自己觉得跑太勤了」。
          //
          // **被挡下时不推进水位**：那段内容并入下一次观察区间——这正是「只延后、
          // 不抑制」的机械形态（`idle-checkpoint.js` 对 skipped 已确立同一纪律）。
          // 故被挡下**不是失败**，不进待处置队列。
          const idleSettings = idleSettingsForPick;
          if (idleSettings !== undefined) {
            // **进入契约不在此处**：11 §6.1 的安静时长由 `triggers.js` 在武装计时器
            // 之前判定（本次检查点能走到这里，说明安静期已满且计时器已到期）。
            const admission = admitIdleDispatch({
              settings: idleSettings,
              task: tasksForThisCheckpoint[0],
            });
            if (!admission.admit) {
              // 如实记账：被挡下与「坏了」必须可区分，否则 Human 从痕迹里看不出
              // 机制是在歇着还是停了（参照 dsh-mnemon 的 stage 可区分纪律）。
              //
              // **2026-10-14：本分支的语义已收窄**。§6.2 现不设准入约束，故此处
              // 记的**不再是「被节流」**，而是「Human 的明示配置要求不派发」——
              // 实际只剩「全部子项未勾选」一种（总开关关闭在上游已 return）。
              // `stage` 仍写 `throttled` 是为保持运行痕迹的**可读连续性**（既有
              // 记录与消费方按该值归组）；其**准确含义**见本注释，不得据该字面
              // 主张「配额仍在起作用」。
              //
              // `tasks` 记下本次**本想**做的全部事项——被挡下时 Human 需要知道
              // 「是哪几件事被推后了」，只记一个任务名会掩盖范围。
              await recordRun(dshHomePath, {
                task: tasksForThisCheckpoint[0],
                tasks: [...tasksForThisCheckpoint],
                stage: "throttled",
                reason: admission.reason,
                // §6.2 现为空集，故 `evaluations` 恒为 `{}`——这正是「本节无约束」
                // 的可观察形态（若将来重新引入约束，各类判定须在此逐项给出）。
                evaluated: admission.evaluations,
                at: new Date().toISOString(),
              });
              lifecycle.activity?.record("session/checkpoint/throttled", { task: tasksForThisCheckpoint[0], tasks: [...tasksForThisCheckpoint], reason: admission.reason });
              return;
            }

            // ── 判定与占用合并为**一个临界区**（2026-10-19 缺陷修复）───────
            //
            // 原实现先判定准入、再 `recordDispatch` 写锚点，两个动作之间没有互斥。
            // 实测（2026-10-19 03:00:17）：四个检查点在 `19:00:17.464Z` 同一毫秒
            // 相继通过准入，随后派出四个任务清单完全相同的 `ldvh-idle` 子代理。
            //
            // 该形态不是「参数调小了」而是**结构性**的：11 §6.2 取消配额的理由是
            // 「§6.1 的安静时长已在结构上界定频率」，该论证隐含「串行」前提，而
            // 并发之下该前提不成立。补回配额同样无效——配额判定也在临界区外。
            // 唯一可靠的形态是把判定与占用写进同一个读-判-写序列，故改用
            // `admitAndRecordDispatch`：读回 `inFlight`、判定、占用、记账一次完成。
            //
            // 占用在本次派发收尾时经 `releaseDispatch` 释放（见下方 finally）。
            const dispatchToken = `dispatch-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const recorded = await admitAndRecordDispatch(dshHomePath, {
              projectRoot: scope.project.path,
              sessionId,
              at: new Date().toISOString(),
              limits: idleSettings.limits,
              token: dispatchToken,
            });
            if (!recorded.ok) {
              // 写不进锚点即无法保证节流——按 fail-closed 停止本次（不派发）。
              await recordRun(dshHomePath, {
                task: tasksForThisCheckpoint[0],
                tasks: [...tasksForThisCheckpoint],
                stage: "stopped",
                reason: `派发状态不可写：${recorded.error?.message ?? "unknown"}`,
                at: new Date().toISOString(),
              });
              return;
            }
            if (recorded.value?.admit !== true) {
              // **在途派发**：上一次派发尚未收尾。这不是失败，也不进待处置队列——
              // 与「被 Human 配置挡下」同属「只延后、不抑制」，故不推进水位。
              // 必须留痕：否则「在途挡下」与「根本没跑」在痕迹里不可区分。
              //
              // `stage` 复用 `throttled` 保持可读连续性（既有消费方按该值归组），
              // 但 `reason` 明确写 `dispatch-in-flight`——读痕迹者据此可知是并发
              // 去重挡下的，不是配置挡下的。
              await recordRun(dshHomePath, {
                task: tasksForThisCheckpoint[0],
                tasks: [...tasksForThisCheckpoint],
                stage: "throttled",
                reason: recorded.value?.reason ?? "dispatch-in-flight",
                evaluated: admission.evaluations,
                at: new Date().toISOString(),
              });
              lifecycle.activity?.record("session/checkpoint/throttled", {
                task: tasksForThisCheckpoint[0],
                tasks: [...tasksForThisCheckpoint],
                reason: recorded.value?.reason ?? "dispatch-in-flight",
              });
              return;
            }
            dispatchClaimed = dispatchToken;
            // 冷却锚点在**派发之前**写入，故失败也计入——否则一次失败不占冷却窗口，
            // 下一次检查点立刻重跑，外观上正是 §8.3 禁止的「自行重试」。
            // 放行也留一次评估痕迹：某约束若在默认取值下恒不触发，只记「被挡下」
            // 会使它与「根本没实现」完全不可区分（复审 D2/D7）。
            await recordRun(dshHomePath, {
              task: tasksForThisCheckpoint[0],
              tasks: [...tasksForThisCheckpoint],
              stage: "admitted",
              reason: recorded.value?.reason ?? admission.reason,
              evaluated: admission.evaluations,
              at: new Date().toISOString(),
            });
          }

          // §8.4 第 1 项的执行体：以**零上下文**派生（spawn）一个受管辖隔离子代理，
          // 判断输入由调度侧机械交付（窗口原文材料 + 候选账本投影），取回它的结构化
          // 判断（11 §7.1「执行体与上下文供给」段，Human 决定 2026-10-12）。仅对
          // `friction-discovery` 需要（其余任务尚未实现，runIdleCheckpoint 会如实报
          // not-implemented）。
          //
          // 依赖缺失时**不传 discover**，使 runIdleCheckpoint 如实报 skipped——
          // 那比"在输入不全时硬派一个子代理冒充判断"诚实得多。
          let discover;
          // 清单里含 `friction-discovery` 就构造执行体——多任务派发**一次**，故这里不再
          // 判「本次轮到的任务是不是它」，而是判「本次是否要求做它」。
          // 其余两个任务尚未实现，`runIdleCheckpoint` 会按各自的分支如实回报。
          if (tasksForThisCheckpoint.includes("friction-discovery")) {
            try {
              const subagents = agent?.ctx?.get?.("subagents");
              if (subagents !== undefined && subagents !== null) {
                // 取消信号与发起会话同生共死：会话结束即释放派生。
                const controller = new AbortController();
                lifecycle.turns.discoveryAbort?.abort?.();
                lifecycle.turns.discoveryAbort = controller;
                discover = createDiscoveryProvider({
                  subagents,
                  roster: providerRosterRef,
                  parent: agent,
                  signal: controller.signal,
                  // 执行体署名的取数通道：provider 在 run.dispose() 之前用它尾读
                  // **执行体自己的**会话记录（09 §5.1「当次实际」）。
                  sessionPersistence: ctx.get("sessionPersistence") ?? null,
                  // D1：把**区间材料**交给执行体——由调度侧（turnTriggers 的
                  // 累积器）给出，不由子代理按坐标自行划定。见 friction-window.js。
                  provideWindow: (watermarkTurn) => turnTriggers.windowFrom(watermarkTurn),
                  onRun: (event) => lifecycle.activity?.record("session/checkpoint/executor", event),
                });
              }
            } catch (error) {
              // 构造提供者失败不退化为"没有执行体"以外的任何东西：如实记录，
              // 让 runIdleCheckpoint 走 skipped（不创建账目、不推进水位）。
              lifecycle.activity?.record("session/checkpoint/executor-unavailable", {
                reason: String(error?.message ?? error),
              });
            }
          }

          // §8.4 闭集第 2–4 项的落地：把子代理的判断写成账目。
          //
          // **这一段曾缺失**（缺陷 D2，由独立复核 030117d3 发现）：此前这里是裸
          // `await runIdleCheckpoint({...})`，返回值被直接丢弃——于是子代理算出的
          // 结论被算完即丢，账本永远不会有新账目，而水位照常推进，看起来像"跑通了"。
          // 现在把返回值接住，并按三态执行闭集动作。
          // 轮次号缺失时从宿主会话记录回填（见 §11 注释）。
          //
          // 位置有三项讲究：
          //   · **在受管辖判定之后**（上面已判定）：非受管辖的会话根本不该为其读日志。
          //   · **在「无启用任务」早退与准入闸之后**：Human 关掉总开关/子项时本检查点
          //     什么都不做，此时读一遍会话日志纯属浪费（大会话可达数十 MB）。
          //   · **在调用之前**：`currentTurn` 是下面这次调用的入参。
          let currentTurn = turn;
          if (!Number.isInteger(currentTurn)) {
            const position = await readLastTurn({
              sessionPersistence: ctx.get("sessionPersistence"),
              sessionId,
            });
            if (position.ok === true) {
              currentTurn = position.turn;
              // 写回触发器：后续派发不必再读一次日志；且 restoreLastTurn 的
              // 「不覆盖已定义值」纪律保证运行时事件给出的更新值不会被这份快照覆盖。
              turnTriggers.restoreLastTurn(position.turn);
              lifecycle.activity?.record("session/checkpoint/position-recovered", {
                source: "session-record",
                turn: position.turn,
                events: position.events,
              });
            } else {
              // 取不到就**不跑**（水位无法界定 → runIdleCheckpoint 会按 11 §12
              // fail-closed 并入待处置队列）：不得退化为「当作全部内容」，那会使
              // 同一段内容被反复计入。如实记下原因，使「为什么这一次没跑」可核对。
              lifecycle.activity?.record("session/checkpoint/position-unavailable", {
                reason: position.reason,
              });
            }
          }

          // ── 审核段（2026-10-27 二次修订：随静置触发，无时间间隔）───────────
          //
          // **在捕获段之前跑**，且**独立于捕获**：审核读的是留观缓冲（已落盘的条目），
          // 不读本次区间材料；捕获段的水位/准入与它无关。
          //
          // **判据只有两个：静置到期（本检查点本身即由静置触发）＋ 当前没有审核在跑。**
          //
          // 曾还有第三道闸「距上次审核满 N 分钟」，2026-10-27 由 Human 去掉：
          // 「==，这个不存在时间了呀，随静置触发」。间隔本是给「每小时往专属会话投一次
          // 提醒」定频用的，落点会话既已废除，就没有东西需要定频。留着它的实测后果是
          // **静置到了、审核该跑，却因「距上次只过了 40 分钟」不跑，而界面上看不出来**
          // ——一个不可见的「应该跑但没跑」状态。故连同 `reviewTiming()` /
          // `markReviewCompleted()` / `isReviewDue()` 一并删除，不是只把值调小。
          if (reviewEnabledAtCheckpoint) {
            // **2026-10-30：互斥改为项目级跨进程文件锁**（11 §6.1「一个项目同一
            // 时间只允许有一个在工作」）。原先的进程内布尔只能挡住本进程，两个宿主
            // 进程同时静置会各自看到「空闲」并并发派发。
            //
            // 锁需要 projectId，故先判管辖：未管辖时没有项目可锁，直接跳过。
            if (reviewScopeState.state !== "governed" || reviewScopeState.project === undefined || reviewScopeState.project === null) {
                lifecycle.activity?.record("review/skipped", { reason: "not-governed" });
              } else {
                const exclusive = await runReviewExclusive({
                  dshHomePath,
                  projectId: reviewScopeState.project.id,
                  sessionId: reviewScopeState.project.path ?? null,
                  fn: async () => runReviewStage({
                  subagents: (() => {
                    try { return agent?.ctx?.get?.("subagents") ?? null; } catch { return null; }
                  })(),
                  roster: providerRosterRef,
                  parent: agent,
                  sessionPersistence: ctx.get("sessionPersistence") ?? null,
                  // 归档血缘守卫所需（2026-10-31）：宿主的 ArchivedSessionGate 无条件
                  // 挂在 agent/pre-step，归档血缘下的执行体必然 blocked。
                  ...resolveArchiveServices(ctx),
                  scope: reviewScopeState,
                  lifecycle,
                  taskOutcomes: reviewOutcomesForCheckpoint,
                  dshHomePath,
                  }),
                });
                if (exclusive.skipped) {
                  lifecycle.activity?.record("review/skipped", { reason: exclusive.reason });
                } else {
                  const reviewOutcome = reviewOutcomesForCheckpoint["experience-review"];
                  lifecycle.activity?.record("review/dispatched", {
                    trigger: "idle-checkpoint",
                    outcome: reviewOutcome?.outcome ?? null,
                    action: reviewOutcome?.action ?? null,
                  });
                  // 与上面那处同一绑定纪律：verification 说 blocked，stage 就不得是 landed。
                  const cpVerification = verifyReviewRun(reviewOutcome, await readTimerEvidence(dshHomePath, sessionId), probeStructuralFacts());
                  const cpBaseStage = deriveStage({ taskOutcomes: { "experience-review": reviewOutcome } });
                  const cpStage = cpVerification !== null && cpVerification.stage === "blocked" && cpBaseStage === "landed"
                    ? "land-failed"
                    : cpBaseStage;
                  try {
                    await recordRun(dshHomePath, {
                      at: new Date().toISOString(),
                      task: "experience-review",
                      tasks: ["experience-review"],
                      unimplemented: [],
                      stage: cpStage,
                      action: reviewOutcome?.action,
                      per_task: reviewOutcomesForCheckpoint,
                      ...(cpVerification === null ? {} : { verification: cpVerification }),
                    });
                  } catch {
                    // 诊断旁路不得打断机制（与安静期路径同一纪律）。
                  }
                }
              }
          }

          const checkpoint = await runIdleCheckpoint({
            dshHomePath,
            factSourceRoot: join(scope.project.path, "ldvh-base"),
            // 水位按「项目根 + 会话」分键（跨项目、跨会话各自独立）。
            projectRoot: scope.project.path,
            // 摩擦观察缓冲按**管辖项目 id** 分区（11 §12bis.1）。它与 projectRoot
            // 不是同一维度（id vs 路径），故显式传入而不靠 basename 兜底。
            projectId: scope.project.id,
            sessionId,
            // 位置标识：优先用 triggers 从回合事件取得的轮次号；重启后尚无回合
            // 时用上面从宿主会话记录读回的值（见 §11 那段注释）。
            currentTurn,
            tasks: [...tasksForThisCheckpoint],
            discover,
          });

          // 运行痕迹用的结局变量（各分支赋值，末尾统一写入环形）。
          let landedAction;
          let landedUid;
          let landedPromoted;
          let advancedTurn;
          let gapRegistered;

          // 只有真正取回了判断才落地（skipped / not-implemented / 失败都没有判断）。
          // **注意层级**：runIdleCheckpoint 把执行体的返回值原样放在 `decision` 下，
          // 而执行体返回 `{ outcome, verdict, watermarkTurn }`——故判断在
          // `checkpoint.value.decision.verdict`。写错这一层会让落地**永不触发**，
          // 而那正是缺陷 D2 的形态（静默不落地），故有回归护栏守着它。
          const verdict = checkpoint?.ok === true ? checkpoint.value?.decision?.verdict : undefined;
          // 经验积累（11 §10）的结论——与摩擦的 verdict **并列**，由各自的落地函数
          // 处理。它取自逐任务结论表而非兼容字段 `verdict`（后者只承载摩擦）。
          const captureVerdict = checkpoint?.ok === true
            ? (checkpoint.value?.decision?.taskVerdicts?.["experience-capture"] ?? null)
            : null;
          // ── 多任务：任务级失败按 §8.3 入队，不落地、不推进水位 ────────────
          //
          // provider 现在**不再**对任务级校验失败抛错（那会使一次可用的运行被整条
          // 丢弃，正是 §10.2 新条款禁止的）；它改为把逐任务成败如实返回。故调用方
          // 必须自己识别该情形：`failedTasks` 非空即本次有任务未得结论，须逐条入队
          // 登记（§8.3 第 1 条），且**不得**拿 null 去落地。
          //
          // 注意 `verdict != null` 这个真值判定：失败时它是 `null`（不是 `undefined`），
          // 而 `null !== undefined` 为真——写成 `!== undefined` 会把失败当成功放行。
          const failedTasks = checkpoint?.ok === true
            ? (checkpoint.value?.decision?.failedTasks ?? [])
            : [];

          // **逐任务结局表**（11 §11 留痕前提「其二」——F-2 子项 3）：整轮粒度的
          // `action`/`watermark` 单字段无法回答「本次**哪个任务**推进到哪」，而
          // 「连续停滞轮次由读取侧推断」正以此为前提（d0b5bee 登记的缺口在此闭合）。
          // 初值把**校验失败**的任务直接标 `rejected`：它们在逐任务落地闸门放开
          // （F-1）后不会走到任何分支，若不预置就会在 per_task 里**缺席**——缺席与
          // 「没跑」无从区分，恰是本表要消灭的形态。
          const taskOutcomes = {};
          for (const key of tasksForThisCheckpoint) {
            if (failedTasks.includes(key)) taskOutcomes[key] = { outcome: "rejected" };
          }
          if (failedTasks.length > 0) {
            for (const key of failedTasks) {
              const why = checkpoint.value?.decision?.taskResults?.[key]?.error;
              await appendPendingEntry(dshHomePath, {
                task: key,
                reason: `任务「${key}」未取得结论：${why?.message ?? "unknown"}`,
                residual: why?.code ? [String(why.code)] : [],
                at: new Date().toISOString(),
              });
            }
            lifecycle.activity?.record("session/checkpoint/task-failed", {
              tasks: [...failedTasks],
              // 同时报告已成功者：使 Human 能看出「这次几件成了、几件没成」。
              succeeded: tasksForThisCheckpoint.filter((k) => !failedTasks.includes(k)),
            });
            // **失败者**不落地、不推进（成功者由下方逐任务分支照常处理——F-1 的
            // 按任务分别）。失败已在上方逐条入队，痕迹的 per_task 由 ① 的预置标
            // rejected。落到下面的运行痕迹写入，使「几件成、几件败」都可见。
          }
          // **准入条件是「有任务取得了结论」，且**按任务分别**判断。
          //
          // 该条件曾有两处错误，都在同一方向上（全有或全无）：
          //   ① 只认 `verdict`（摩擦的兼容字段）→ 清单里只有经验积累时整块落地被
          //      跳过，其结论算完即丢（缺陷 D2 同形）；
          //   ② **仍带 `failedTasks.length === 0`** → 任一任务失败即整块跳过，
          //      **成功任务的结论也一起被丢**，且两个水位都不推进、下轮重覆盖同一
          //      区间使成功者被再落地（`occurrence.count` 虚增）。
          // ②即独立代码审核的 F-1（高危）：按任务分别的**存储**已就位，但**策略**
          // 仍是全有或全无，于是它在唯一需要它的场景（一件成功、一件失败）里不生效。
          // 现改为：只要**本任务自己**取得了结论就落地它，与其它任务的成败无关——
          // 这正是 11 §11「跨任务不混排、各任务独立成轮各持水位」与 §12 第 1 项
          // 「同派发下的任务各自成立、互不牵连」的机械形态。
          if (checkpoint?.ok === true && (verdict != null || captureVerdict != null)) {
            const ledgerRoot = join(scope.project.path, "ldvh-base");
            // 受控写入需要**权威路由签名**（02 §10.5 / 09 §5.1「当次实际」）。
            // 取不到签名时**不落地**——宁可停在这里，也不写一条签名缺失的账目（那会
            // 污染 change_log 的归属）。取不到即按 §8.3 入队。
            //
            // **署名取的是执行体，不是本会话（2026-10-17 修正）**：此前这里用主控
            // 的 `agent` 调 `currentRouteValues`，于是执行体做出的判断被盖上主控的
            // 路由章。实测 2026-10-16T06:17:11Z：主控 `session-36dd0a0a` 为
            // workbuddy/deepseek-v4.1-flash，实际派出的子代理 `147acc26` 为
            // ds-yue/deepseek-v4-flash，而落账对象 `pitfall-2abbbc2f` 记的是主控值。
            // 09 §5.1 要求「当次实际」的 provider/model；当次实际做这个判断的是执行体。
            // 现由 provider 在 dispose 之前从**执行体自己的会话记录**取得署名，随
            // `decision.executorSignature` 上抛，本层只消费不重取。
            //
            // **裸标识符陷阱（D8）的历史告警保留**：此处原写作 `sessionPersistence?.()`，
            // 而 `sessionPersistence` 在本文件里只是 `registerLdvhTools` 的实参属性名，
            // 从未声明为变量，故每次都抛 ReferenceError 且被执行体收口成一条日志
            // （账本无、队列无、水位不动——与「机制没跑」外观相同）。现本层不再取路由，
            // 该陷阱随之消失；`ctx.get("sessionPersistence")` 仍在 provider 构造处使用。
            const executorSignature = checkpoint.value?.decision?.executorSignature ?? null;
            const signatureFailure = checkpoint.value?.decision?.executorSignatureFailure ?? null;
            const skippedBecause = checkpoint.value?.decision?.skipped ?? null;
            // ── 署名门槛**按任务分别**（2026-10-27 二次修订，Human 决定）──────────
            //
            // **曾经的形态（已废止）**：`executorSignature === null` 就在逐任务分支
            // **之前**一刀切——全部任务都不落地，还逐任务往待处置队列写一条
            // 「账目未写入（缺署名）」。这是错的：署名是**事实对象**的 `change_log`
            // 字段要求（02 §10.5 / 09 §5.1），而本次要做的事里有一半**根本不写事实
            // 对象**——摩擦观察写的是 §12bis.1 的缓冲条目、经验捕获写的是 §12bis 的
            // 缓冲条目，二者都是**非事实对象**，`§12bis` 的字段闭集 9 项里没有署名位。
            // 实测后果（2026-10-27T05:43:21Z）：一次 `empty-window` 跳过派生执行体，
            // 于是没有署名，两个任务双双记成 `账目未写入（缺署名）`——而实际上**本来
            // 就没有账目要写**，那是把「不需要署名」误报成了「缺署名失败」。
            // Human 原话：「捕获阶段就不需要署名了，非事实对象不需要署名」。
            //
            // **现形态**：署名只对**会写事实对象的那部分动作**前置。
            //   · `friction-discovery` 的 `same-obstacle`（补充级更新既有账目）与
            //     `same-observation-group`/`new-observation` 达阈值后的**晋升**
            //     ——都写事实源，需要署名；
            //   · 写摩擦观察条目、写经验缓冲条目——**不需要**，永远照常落地。
            //
            // 故这里不再有「全局缺署名分支」：由各落地函数在真正要写事实对象的那一步
            // 自行要求署名（writer 侧的 `requireAuthoritativeSignature` 是既有的机械
            // 闸，缺署名会以 `signature_unavailable` 拒绝，落到下面各自的失败分支）。
            // 本层只负责**把署名原样传下去**，以及**如实登记**取得环节的失败。
            if (executorSignature === null && skippedBecause === null) {
              // 有判断产出却取不到署名：这不是「本次跳过」，而是署名的取得环节失败。
              // 如实登记，但**不阻止**不需要署名的落地。
              lifecycle.activity?.record("session/checkpoint/signature-unavailable", {
                tasks: [...tasksForThisCheckpoint],
                reason: signatureFailure ?? "执行体未给出署名且未说明原因",
              });
            }
            {
              // **逐任务落地**（与署名是否取得无关）：每个任务的结论由它自己的落地
              // 函数处理——不得只落地摩擦而把其它任务的结论留在 `decision` 里（那
              // 正是缺陷 D2 的形态：结论算完即丢，且不留痕迹）。需要署名的动作由各
              // 落地函数/写入器在真正写事实对象那一步自行要求（见上段）。
              if (verdict != null) {
                const landed = await landDiscoveryVerdict({
                  factSourceRoot: ledgerRoot,
                  // 观察层落地需要缓冲载体与分区标识（11 §12bis.1）：账本在事实源内，
                  // 缓冲在事实源之外，二者的通道不同故都要给出。
                  dshHomePath,
                  projectId: scope.project.id,
                  verdict,
                  // `anchor` 是本次观察区间在会话内的位置标识（§12bis.1 `anchor` 行）
                  // ——取区间终点：它使晋升后的账目能回指原始位置。
                  anchor: checkpoint.value.window?.to !== undefined && checkpoint.value.window?.to !== null
                    ? String(checkpoint.value.window.to)
                    : String(currentTurn ?? ""),
                  session: sessionId,
                  observationAt: checkpoint.value.at,
                  sessionSignature: executorSignature,
                });
                if (!landed.ok) {
                  // §8.3 fail-closed：落地失败按停止处置并登记（不自行重试、不掩盖）。
                  await appendPendingEntry(dshHomePath, {
                    task: "friction-discovery",
                    reason: `闭集落地失败（${landed.error?.stage ?? "unknown"}）：${landed.error?.message ?? "unknown"}`,
                    // 提炼**完整**诊断（含逐条校验明细），不把 issues 丢掉——
                    // 详见 friction-landing.js 的 residualFromLandingError。
                    residual: residualFromLandingError(landed.error),
                    at: new Date().toISOString(),
                  });
                  // **不推进水位**（复核发现①的修复）：落地失败即本次未产出，窗口
                  // 必须留待下次重覆盖——否则那段内容会被标记为已处理却从未入账，
                  // 且永不复查（宿主只发布事件、不回放）。
                  lifecycle.activity?.record("session/checkpoint/landed", { action: "failed", watermark_advanced: false });
                  landedAction = "failed";
                  taskOutcomes["friction-discovery"] = { outcome: "land-failed" };
                } else {
                  lifecycle.activity?.record("session/checkpoint/landed", {
                    action: landed.value.action,
                    object_uid: landed.value.object_uid,
                    promoted: landed.value.promoted,
                  });
                  landedAction = landed.value.action;
                  landedUid = landed.value.object_uid;
                  landedPromoted = landed.value.promoted;
                  // 2026-10：命中 `accepted` 时落地侧返回 `action: "silent"` 并带
                  // `residual`——那是「本次观察与某笔已接受账目同源、已按记录一次不再
                  // 报告处理」的登记（11 §9 第 1 项 / §15）。它必须进待处置队列，
                  // 否则「静默」就变成无痕抑制（11 §11 无损保证）。
                  //
                  // **reason 由落地结果派生，不再写死**（2026-11-02 修复）：此前的
                  // 硬编码把**每一条**带 residual 的落地都登记成「命中已接受（accepted）
                  // 账目…静默」。实测 37 条该 reason 的登记里，residual 指向
                  // `supplement-pending`（open 补充）的 37 条、指向 accepted 的 **0 条**
                  // ——即整批登记把「待审核层执行补充级更新」谎报成了「静默」。读队列的
                  // 人据此会以为大量观察已被静默，实际是大量补充级更新在排队。
                  // 派生函数见 friction-landing.js `pendingReasonFromLanding`。
                  if (Array.isArray(landed.value.residual) && landed.value.residual.length > 0) {
                    await appendPendingEntry(dshHomePath, {
                      task: "friction-discovery",
                      reason: pendingReasonFromLanding(landed.value),
                      residual: landed.value.residual,
                      at: new Date().toISOString(),
                    });
                  }
                  taskOutcomes["friction-discovery"] = {
                    outcome: "landed", action: landed.value.action, object_uid: landed.value.object_uid,
                  };
                  // 复核发现②③：本次区间里本进程未观察到的轮次须**如实登记**，
                  // 不得静默丢弃。缺口不可恢复（宿主不回放、本模块不读会话日志），
                  // 故处置是「登记 + 越过」，而不是拒不推进（那会永久停摆）。
                  const gap = checkpoint.value?.decision?.unobserved;
                  if (gap && typeof gap === "object") {
                    await appendPendingEntry(dshHomePath, {
                      task: tasksForThisCheckpoint[0],
                      reason: `观察区间存在未覆盖缺口：turn ${gap.from}${gap.to === null || gap.to === undefined ? " 起（上界未知）" : `–${gap.to}`} 未被本进程观察到（宿主不回放事件，缺口不可恢复）`,
                      residual: [`缺口 ${gap.from}..${gap.to ?? "unknown"} 的内容未被观察`, "水位将越过该缺口——此为该区间的已知损失"],
                      at: new Date().toISOString(),
                    });
                    lifecycle.activity?.record("session/checkpoint/window-gap", { from: gap.from, to: gap.to ?? null });
                    gapRegistered = `${gap.from}..${gap.to ?? "?"}`;
                  }
                  // **落地成功之后**才推进水位（顺序纪律）：推进意味着「本区间已处理
                  // 完毕」；只有账目确实写成（或确认为无发现）时才成立。
                  const pendingTurn = checkpoint.value?.pending_watermark_turn;
                  if (Number.isInteger(pendingTurn)) {
                    const advanced = await advanceWatermark(dshHomePath, {
                      projectRoot: scope.project.path,
                      sessionId,
                      // 推进**本任务**的水位——这正是逐任务改造的目的：任务 A 成功
                      // 推进自己的水位，不因任务 B 失败而后退或被重覆盖。
                      //
                      // **显式写 "friction-discovery" 而非 tasksForThisCheckpoint[0]**：本块
                      // 是摩擦发现的落地分支，故它推进的只能是摩擦发现的水位；用清单
                      // 首项会在「清单只含其它任务」时推出一个不属于本块的键。
                      task: "friction-discovery",
                      turn: pendingTurn,
                    });
                    if (!advanced.ok) {
                      // 落地已成功、水位未推进：下次会重覆盖同一区间。**重覆盖不会
                      // 重复计数**吗——会。故此处必须入队如实登记，不得静默。
                      await appendPendingEntry(dshHomePath, {
                        task: tasksForThisCheckpoint[0],
                        reason: `水位推进失败（账目已写入，下次将重覆盖同一区间，可能重复计数）：${advanced.error.message}`,
                        residual: [`水位键 ${advanced.error.code}`, `重覆盖区间终点 turn=${pendingTurn}`],
                        at: new Date().toISOString(),
                      });
                      lifecycle.activity?.record("session/checkpoint/watermark", { advanced: false, code: advanced.error.code, turn: pendingTurn });
                      if (taskOutcomes["friction-discovery"]) taskOutcomes["friction-discovery"].watermark_advanced = false;
                    } else {
                      lifecycle.activity?.record("session/checkpoint/watermark", { advanced: true, turn: pendingTurn });
                      advancedTurn = pendingTurn;
                      if (taskOutcomes["friction-discovery"]) {
                        taskOutcomes["friction-discovery"].watermark_advanced = true;
                        taskOutcomes["friction-discovery"].watermark_turn = pendingTurn;
                      }
                    }
                  }
                }
              }

              // ── 经验积累（11 §10.1）的落地：机械通道只写**留观缓冲条目** ──────
              //
              // 缓冲条目不是事实对象（§12bis 定性），故这里**不建 Pitfall**、
              // **不需要执行体署名**（§12bis 字段闭集 9 项里没有署名位）——
              // 建 `draft` 候选是审核段的事（§10.2 第 3 项）。
              if (captureVerdict != null) {
                // `anchor` 取 §11 的序键区间（本次观察区间的轮次范围）：它是
                // 机械可得的来源位置，使审核段能回到区间去看原话。具体出处
                // （会话 id + 位置 / 文件:行 / 命令引文）由捕获段写进条目的
                // `evidence` 里（§12bis：evidence 须附来源引用）。
                const anchorFrom = checkpoint.value?.window?.from;
                const anchorTo = checkpoint.value?.window?.to;
                const anchor = `turn ${anchorFrom ?? "?"}..${anchorTo ?? "?"}`;
                const captured = await landCaptureVerdict({
                  dshHomePath,
                  verdict: captureVerdict,
                  observationAt: checkpoint.value.at,
                  sessionId,
                  anchor,
                  // **按管辖项目分载体**（§12bis 载体段 2026-10 修订）：不传会让条目
                  // 写进所有项目共用的旧全局载体，即该修订要纠正的已知缺陷。
                  projectId: scope.project.id,
                });
                if (!captured.ok) {
                  // §8.3 fail-closed：落地失败按停止处置并登记（不自行重试、不掩盖）。
                  await appendPendingEntry(dshHomePath, {
                    task: "experience-capture",
                    reason: `经验积累落地失败（${captured.error?.stage ?? "unknown"}）：${captured.error?.message ?? "unknown"}`,
                    // 完整诊断（含逐条 issues），不把明细丢掉。
                    residual: residualFromCaptureError(captured.error),
                    at: new Date().toISOString(),
                  });
                  lifecycle.activity?.record("session/checkpoint/landed", {
                    task: "experience-capture",
                    action: "failed",
                    watermark_advanced: false,
                  });
                  landedAction ??= "failed";
                  taskOutcomes["experience-capture"] = { outcome: "land-failed" };
                } else {
                  lifecycle.activity?.record("session/checkpoint/landed", {
                    task: "experience-capture",
                    action: captured.value.action,
                    // 缓冲条目不是事实对象，故这里记 `entry_id` 而不是 `object_uid`
                    // （留痕字段名照实：缓冲条目没有 object_uid，写一个不存在的
                    // 标识会让读者以为它进了事实源）。
                    entry_id: captured.value.entry_id,
                  });
                  // 整轮字段取摩擦的动作（若两件都跑，摩擦是主项）；只在摩擦未
                  // 产出动作时用经验积累的动作填充，使「本次做了什么」仍可见。
                  //
                  // **F-5 修复（`??=` 遮蔽）**：原写法在「摩擦也跑出动作」时把
                  // 经验的动作**整个抹掉**——两件任务的处置是不同的，被抹掉后
                  // 持久痕迹只剩摩擦那一个，经验侧做了什么在落盘面上**不可区分**。
                  // 整轮字段仍只有一份（兼容既有 reader），但**真相进 per_task**：
                  // 逐任务结局表把经验的动作一体一记，不再靠遮蔽竞争。
                  //
                  // 2026-10-20 两段式后经验侧的动作只有三种：`buffer-appended`
                  // （写入一条留观缓冲条目）、`none`（本次没有观察到失败现象）、
                  // `failed`（落地失败，见上面的分支）——不再有查重命中或建候选。
                  landedAction ??= captured.value.action;
                  taskOutcomes["experience-capture"] = {
                    outcome: "landed",
                    action: captured.value.action,
                    ...(captured.value.entry_id ? { entry_id: captured.value.entry_id } : {}),
                  };
                  // **推进经验积累自己的水位**（逐任务水位的意义所在）：它与摩擦
                  // 互不牵连——摩擦失败不会使经验积累被重覆盖，反之亦然。
                  const pendingTurn = checkpoint.value?.pending_watermark_turn;
                  if (Number.isInteger(pendingTurn)) {
                    const advanced = await advanceWatermark(dshHomePath, {
                      projectRoot: scope.project.path,
                      sessionId,
                      task: "experience-capture",
                      turn: pendingTurn,
                    });
                    if (!advanced.ok) {
                      await appendPendingEntry(dshHomePath, {
                        task: "experience-capture",
                        reason: `水位推进失败（缓冲条目已写入，下次将重覆盖同一区间，可能再写一条同现象条目）：${advanced.error.message}`,
                        residual: [`水位键 ${advanced.error.code}`, `重覆盖区间终点 turn=${pendingTurn}`],
                        at: new Date().toISOString(),
                      });
                      lifecycle.activity?.record("session/checkpoint/watermark", {
                        task: "experience-capture", advanced: false, code: advanced.error.code, turn: pendingTurn,
                      });
                      if (taskOutcomes["experience-capture"]) taskOutcomes["experience-capture"].watermark_advanced = false;
                    } else {
                      lifecycle.activity?.record("session/checkpoint/watermark", {
                        task: "experience-capture", advanced: true, turn: pendingTurn,
                      });
                      if (taskOutcomes["experience-capture"]) {
                        taskOutcomes["experience-capture"].watermark_advanced = true;
                        taskOutcomes["experience-capture"].watermark_turn = pendingTurn;
                      }
                    }
                  }
                }
              }
            }
          } else if (checkpoint?.ok === false) {
            // 调度层已按 11 §12 处置完毕（入队或不入队），此处只记活动，不重复登记。
            // **2026-11-03 订正**：此前注释写「已自行入队」，那是分流之前的实情。
            // 现在 `idle_checkpoint/executor_failed`（执行体产出失败，11 §11 条件式
            // 不满足 §12 的校验不可用条件）**不入队**，仍记在本痕迹里；而
            // `discovery_provider/unavailable` 等能力/配置类失败照旧入队。故此处
            // 不能再说「一定入过队」，否则读者会以为队列里有对应条目。
            lifecycle.activity?.record("session/checkpoint/stopped", {
              task: tasksForThisCheckpoint[0],
              code: checkpoint.error?.code ?? "unknown",
            });
          }
          // 运行痕迹（固定容量环形）：把本次检查点的**结局**持久化。
          // 理由见 idle-runlog.js 的模块注释——「跑了但没发现」与「根本没跑」从
          // 外部无从分辩，是修复期间反复撞上的盲区。
          // **诊断旁路不得打断机制**：recordRun 自身已保证不抛，此处再加一层，
          // 使任何意外都只影响痕迹的完整度，不影响检查点本身的结果。
          try {
            await recordRun(dshHomePath, {
              at: new Date().toISOString(),
              // `task`（单值）保留：它是既有 reader（Web 与诊断）的字段，改它会使
              // 旧读法失效。`tasks`/`unimplemented` 是**新增**的两个面，使「本次要求
              // 做哪几件、其中哪几件没做」在**持久化**痕迹里可见。
              //
              // 为什么必须持久化（M3）：内存态 activity 随进程退出即消失，而 §10.2
              // 要求「已启用但未实现」须在运行痕迹中如实登记为未执行。只记在
              // activity 里，Human 事后翻 runlog 看不到——等于没登记。
              task: tasksForThisCheckpoint[0],
              tasks: [...tasksForThisCheckpoint],
              unimplemented: checkpoint?.ok === true
                ? [...(checkpoint.value?.unimplemented ?? [])]
                : [],
              // **stage 由逐任务结局派生**（子项 3 的统一口径）：
              //   全部落地成功 → `landed`；无一落地（全被拒/落地失败/缺签名）→
              //   `land-failed`（保持既有 reader 的语义）；有成有败 → `partial`
              //   （**新值**——F-1 后「一件成功一件失败」不能再记成 `land-failed`，
              //   那会把「成功者已落地」与「整块没落地」混同；两者在 per_task 里
              //   本有逐体真相，stage 取「有未成功项」与旧语义之间的诚实中间态）。
              // 与上面两处同一派生（run-stage.js 的 deriveStage）——三处曾各自实现，
              // 导致「两处会把 partial 记成 land-failed、一处已正确」的不一致。
              stage: deriveStage({
                checkpointOk: checkpoint?.ok === true,
                taskOutcomes,
                emptyStage: checkpoint.value?.outcome === "not-implemented" ? "not-implemented" : "skipped",
              }),
              code: checkpoint?.ok === false ? (checkpoint.error?.code ?? "unknown") : undefined,
              // ── 失败的可诊断面进运行痕迹（2026-11-03，丙方案「补下班」）──────
              //
              // 此前失败只写进**待处置队列**，而队列与运行痕迹**没有任何共同键**
              // （队列有 entry_id，痕迹没有对应字段）：同一时间窗里 50 条痕迹对
              // 292 条登记，两本账互不相认，事后想问「昨天那次到底成没成」答不出。
              //
              // `pending_entry_id` 就是那个共同键：有它则「这条痕迹 → 那条登记」可
              // 双向反查；为 null 则说明本次失败**按分流不入队**（不是丢了 id）。
              // `note` 带 `residual` 的摘要——队列里那几十条「stopReason=error」正是
              // 因为痕迹侧没有承载位才只能回队列里翻；`idle-runlog` 的 note 上限
              // 300 字符且已定义多年，此前**没有任何生产者**，这里补上。
              pending_entry_id: checkpoint?.ok === false
                ? (checkpoint.error?.pending_entry_id ?? null)
                : null,
              note: checkpoint?.ok === false ? describeStopForRunlog(checkpoint.error) : undefined,
              action: landedAction,
              object_uid: landedUid,
              promoted: landedPromoted,
              watermark: advancedTurn,
              gap: gapRegistered,
              // **逐任务结局**（§11 留痕前提其二）：每任务各自的动作/对象/水位推进；
              // 校验失败者预置 `rejected`。读取侧据此推断连续停滞轮次，无需新计数器。
              per_task: taskOutcomes,
            });
          } catch (error) {
            lifecycle.activity?.record("session/checkpoint/runlog-failed", {
              reason: String(error?.message ?? error),
            });
          }

          // ── 释放派发占用（2026-10-19）────────────────────────────────────
          //
          // 占用代表「本次派发尚在途」，与成败无关——故在此处**无条件**释放。
          // 位置选在所有可能的提前 `return` 之后：此前各分支（被挡下、写不进锚点、
          // 在途去重）都没有取得占用，`dispatchClaimed` 保持 `null`，这里即空操作。
          //
          // 释放失败只记痕迹、不抛：占用带租约（`DISPATCH_LEASE_MS`），超时会被
          // 下一次判定回收，故释放失败不会使该会话永久停摆。
          if (dispatchClaimed !== null) {
            try {
              await releaseDispatch(dshHomePath, {
                projectRoot: scope.project.path,
                sessionId,
                token: dispatchClaimed,
              });
            } catch (error) {
              lifecycle.activity?.record("session/checkpoint/release-failed", {
                reason: String(error?.message ?? error),
              });
            }
            dispatchClaimed = null;
          }

          lifecycle.activity?.record("session/checkpoint", { source, tasks: [...tasksForThisCheckpoint] });
        }
      });
      // 登记到插件级清单（见 agentTimers 的说明）：per-agent disposer 与插件级
      // disposer 各自都会清，两处都做是为了「哪条路径先到都能收口」。
      agentTimers.set(agentId, turnTriggers);
      // Prime the pre-step channel at install：install 本身发生在 agent/created
      // （= session 的 startup 语义），这一次 prime 取代旧实现里对
      // agent/session-start 的首次响应。resume / clear / compact 的再次 announce
      // 由 start() 的 agent/created 分发路径 re-prime（见 reprimeAgent）。
      onPreStep.prime();
      // ── 装载时**不重建安静期计时**（2026-10-27，Human 决定）──────────────
      //
      // 此前（2026-10-19 起）这里把持久化的活动时刻读回来，交给
      // `turnTriggers.restoreActivityAt()` 恢复锚点并**立即重新武装**计时器。
      // 判据本身没错，但后果是**把已经结束的安静期重新读回内存**：旧锚点的剩余
      // 量恒为 0，于是每一次插件重载、每一次**重新打开一个旧对话**，都会在同一个
      // 早已结束的安静期上再触发一次。实测（2026-10-26 23:44 与 10-27 全天）：
      // 环痕里 quietFor 达 44/46/66/70/153/166 小时，单日派发数十次，而安静时长
      // 只有 5 分钟；被重新唤醒的全是几小时前、甚至几天前就不动的会话。这与
      // 11 §6.1「一次触发完成后……不得在同一目标时刻上反复触发」直接冲突。
      //
      // 现行为：**计时只有一个起点——回合结束**（triggers 的 `turn/end` /
      // `turn-stopping` 之后的 idle）。装载路径**不读活动时刻、不建计时器**，
      // 那段 fire-and-forget 恢复旁路已整体删除。代价如实登记（11 §6.1 不主张
      // 恰好一次）：重启前已开始、尚未到期的安静期作废，该窗口内一次都不会到期；
      // 内容不丢（水位不推进，区间并入下一次），只是延后。
      //
      // **不要为了「重启后接着计时」把恢复加回来**——缺陷会原样复现，且表面症状
      // 是「一激活旧对话就冒出静置执行体」，很难归因到装载路径。
      //
      // ── 经验审核的武装也**不在这里**（2026-10-26 修正，2026-10-27 再改）──
      //
      // 第一版把审核武装写在这个位置（`agent/created` 装载路径上），实测出真缺陷：
      // 改设置**不会**创建 agent，故那段代码在配置变更后根本不重跑——Human 打开
      // 「自动审核经验」，配置确实落盘了，但专属会话与周期任务一个都没出现。
      // 界面上勾了、实际没跑。2026-10-27 起形态 2 改由**静置检查点**驱动，由
      // `onSessionCheckpoint` 内的审核段当场判定，装载路径与此彻底无关。
      const stops = [
        agent.ctx.on("system-prompt/assemble", (assembly, context, next) => onAssemble(assembly, context, next)),
        agent.ctx.on("agent/pre-step", (payload, next) => onPreStep.handler(payload, next), { prepend: true }),
        agent.ctx.on("agent/turn-stopping", (payload) => turnTriggers.onTurnStopping(payload)),
        // 11 §6.1（2026-10-14 修订）：`agent/status` 的 `idle` **不再是触发点**，
        // 只负责武装安静期计时——宿主 idle 说明「此刻没有在跑的驱动」，但**不说明
        // 会话已安静多久**。真正的派发由安静期到期时发出。
        agent.ctx.on("agent/status", (payload) => turnTriggers.onAgentStatus(payload)),
        agent.ctx.on("session/event", (session, event) => turnTriggers.onSessionEvent(session, event))
      ];

      return () => {
        const cleanupErrors = [];
        for (const stop of stops.reverse()) {
          try { stop(); } catch (error) { cleanupErrors.push(error); }
        }
        // Stop the timer synchronously and return its diagnostic drain so
        // Cordis can await it when the agent or this plugin is disposed.
        let timerDrain;
        try {
          timerDrain = turnTriggers.dispose();
          if (agentTimers.get(agentId) === turnTriggers) agentTimers.delete(agentId);
        } catch (error) {
          cleanupErrors.push(error);
          registryActivity.record("timers/dispose-failed", { agentId, message: String(error?.message ?? error), at: new Date().toISOString() });
          try { ctx.logger.warn("[dsh-ldvh] timer disposal failed for %s: %s", agentId, String(error?.message ?? error)); } catch { /* logger is unavailable during unload */ }
        }
        if (lifecycle.toolsDisposer !== null) {
          try { lifecycle.toolsDisposer(); } catch (error) { cleanupErrors.push(error); }
          lifecycle.toolsDisposer = null;
        }
        if (agentEffects.get(agentId) === ownedEffect) {
          agentEffects.delete(agentId);
          const sessionId = sessionIdOf(agent);
          if (typeof sessionId === "string") sessionScopes.delete(sessionId);
        }
        if (agents.get(agentId) === lifecycle) agents.delete(agentId);
        return Promise.resolve(timerDrain).then(() => {
          if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, `LDVH agent cleanup encountered errors: ${agentId}`);
        });
      };
    }, `dsh-ldvh: agent lifecycle ${agentId}`);
    } catch (error) {
      if (agentEffects.get(agentId) === ownedEffect) agentEffects.delete(agentId);
      if (agents.get(agentId) === lifecycle) agents.delete(agentId);
      throw error;
    }
  }

  return {
    start() {
      // agent/created 是 0.1.7 起唯一携带 session-start 语义的入口：
      // payload = { agent, source, signal? }，source ∈ startup|resume|clear|compact
      //（旧事件 agent/session-start 已删除——调研报告 §3.4）。分发规则：
      //   - 未装 → install()（内部含首次 prime）；
      //   - 已装 → 这是 resume / clear / compact 的再次 announce，install() 的
      //     agents.has() 去重会直接返回，因此在这里补做 re-prime。
      //
      // 会话视图重置（friction-41a43496）：clear / compact / resume 会让此前注入的
      // 上下文行从模型可见视图里消失，而 pre-step 的注入台账仍记着它们，指针继续
      // 有效就会永久静默。故这三类 source 必须同时清空台账；`startup` 是一次全新
      // 装配，本就没有台账可言（清空是幂等的 no-op）。权威依据是 payload.source，
      // 不是「本回合批次里没看到行」——后者在每一轮都成立，正是重复注入的成因。
      const clearsView = (source) => source === "clear" || source === "compact" || source === "resume" || source === "startup";
      const disposeCreated = ctx.on("agent/created", (payload) => {
        const agent = payload?.agent;
        const id = agentIdOf(agent);
        if (typeof id === "string" && agents.has(id)) {
          if (clearsView(payload?.source) && typeof agents.get(id)?.preStepResetVisibility === "function") {
            agents.get(id).preStepResetVisibility();
          }
          reprimeAgent(id, agent);
        } else install(agent);
      });
      // 换接（2026-10-03）：子代理结论改由宿主的 `subagent/end` 事件承载。
      //
      // 为什么注册在**根 ctx** 而非子代理 ctx：该事件经
      // `carrier(parent)`（= `scopeTarget(this, parent)`）分发，作用域键是
      // **父代理**（宿主源码 packages/subagent/subagent/src/lifecycle.ts:106-112）。
      // 注册在子代理自身的 ctx 上收不到它。
      //
      // 与既有 `session/event` 捕获的关系：两者**并存**，不是替换。理由——
      //   - `subagent/end` 是宿主对「一个 residency epoch 终止」的权威通知，
      //     其 `lastAssistantMessage` 由宿主按本 epoch 的日志后缀切出
      //     （lifecycle.ts 的 createActivationObserver），比手工配对更精确；
      //   - 但它是 emit（fire-and-forget），且在**一次性运行**路径与
      //     **可续 epoch** 路径上的发布时机不同；既有配对路径覆盖的是
      //     assistant/message → turn/end，粒度是「轮」。
      //   两者互为补充：任一路径先到即写入结论槽（后到者覆盖，语义均为「最新」）。
      //   既有路径保留为回退，不因宿主事件缺失而失去结论。
      const disposeSubagentEnd = ctx.on("subagent/end", (info) => {
        try {
          const childId = info?.id;
          if (typeof childId !== "string" || childId === "") return;
          const record = children.get(childId)?.record ?? retiredChildren.get(childId)?.record;
          if (record === undefined) return; // 非本会话的子代理：忽略，不串写
          const message = info?.lastAssistantMessage;
          if (!Array.isArray(message)) return; // 无输出（中止/基础设施拒绝）：不动既有结论
          const text = message
            .filter((block) => block !== null && typeof block === "object" && block.type === "text")
            .map((block) => (typeof block.text === "string" ? block.text : ""))
            .join("");
          record.setConclusion(text);
        } catch (error) {
          // 捕获失败绝不得打断子代理生命周期（与既有路径同纪律）。
          ctx.logger.warn("[dsh-ldvh] subagent/end conclusion capture failed: %s", String(error?.message ?? error));
        }
      });
      // Adopt agents already alive when the plugin (re)loads (audit A/H):
      // without this, hot-reloaded plugins leave existing sessions hookless
      // and /ldvh/state answers unknown forever for them. The agents service
      // is optional in fabricated contexts (tests) — no roster, no adoption.
      //
      // 2026-10-18 修复「子代理登记表被清空」：本处原先只遍历 `roots()`，
      // 而插件 fiber 重建会先清空 children/retiredChildren（见下方 children/cleared），
      // 随后 start() 只把**根会话**装回来——**已存在的子代理不再入表**。后果是
      // 重建后 ldvh_collect_subagent_results 恒 0 条、record_review 恒判
      // 「not a subagent registered」，独立复核无法收口。
      //
      // 改用 `list()`（"All live agents, in registration order"——含子代理，
      // 且父先于子注册）：子代理经 install() 的 origin/parentSession 判据走
      // installChild()，父记录先装好，子据此继承委派链状态。`list()` 不存在时
      // （旧宿主 / 虚构 ctx）回退到 `roots()`，行为与修复前一致。
      //
      // 2026-11-12：`roots()` 回退同样要做存在性判断——宿主 0.2.2-rc.2 没有该
      // 方法，无保护调用会抛 TypeError 并打断整个 adopt 循环。两者都没有时
      // 按「无可收养对象」处理（空循环），不阻断插件启动。
      const agentsService = ctx.get("agents");
      if (agentsService !== undefined) {
        const roster = typeof agentsService.list === "function"
          ? agentsService.list()
          : typeof agentsService.roots === "function"
            ? agentsService.roots()
            : [];
        for (const agent of roster) {
          const adopted = agentIdOf(agent);
          install(agent);
          registryActivity.record("root/adopt", { agentId: adopted ?? null });
        }
      }
      // ── 会话启动时的队列清点（11 §12 第 4 条，2026-11-02 补）────────────
      //
      // §12 第 4 条把「会话启动时的队列清点」列为待处置队列的**三个读取者之一**，
      // 与「下一个接管的主控」「Human 查阅入口」并列。此前只有后两者落地：Human
      // 查阅入口由 Web 诊断页的 IdlePanel 承载，而清点这一端**在生产路径上零调用**
      // ——`countPendingEntries` 写好后只有测试引用过。后果是第 5 条「核查前受影响
      // 对象不得被当作稳定事实消费」缺少执行时点：新会话开局时没人知道有多少条
      // 未核查的登记，也就不会有人去核查（实测 269 条登记的 resolved_at 全空）。
      //
      // 清点**只报数、不改动**（函数名即契约）：结果写进运行痕迹，使「哪次启动、
      // 清点到多少条」可回读。载体不可用或读失败**不阻断启动**——§12 第 6 条要求
      // 载体不可用时 fail-closed，但那条约束的是「辅助任务不得在失去队列的情况下
      // 继续运行」，不是「插件不得装载」；此处如实记一条读失败痕迹即可。
      void countPendingEntries(dshHomePath).then(async (counted) => {
        if (!counted.ok) {
          await recordRun(dshHomePath, {
            task: "startup-inventory", tasks: ["startup-inventory"], stage: "land-failed",
            reason: `队列清点失败：${counted.error?.message ?? "unknown"}`,
            at: new Date().toISOString()
          });
          return;
        }
        await recordRun(dshHomePath, {
          task: "startup-inventory", tasks: ["startup-inventory"], stage: "landed",
          reason: `会话启动时的队列清点（11 §12 第 4 条）：未核查 ${counted.value.unresolved} 条` +
            `（不可读行 ${counted.value.invalid} 条；载体 ${counted.value.carrier}）`,
          unresolved: counted.value.unresolved,
          invalid: counted.value.invalid,
          carrier: counted.value.carrier,
          at: new Date().toISOString()
        });
      }).catch((error) => {
        ctx.logger.warn("[dsh-ldvh] startup queue inventory failed: %s", String(error?.message ?? error));
      });
      return () => {
        // Invalidate pending governance judgements before any asynchronous
        // disposal can yield; a late resolve must never re-register tools.
        if (stopped) return stopPromise ?? Promise.resolve();
        stopped = true;
        agents.clear();
        const pendingDisposals = [];
        const disposalErrors = [];
        const reportDisposalFailure = (kind, agentId, error) => {
          const message = String(error?.message ?? error);
          disposalErrors.push(error instanceof Error ? error : new Error(message));
          registryActivity.record(`${kind}/dispose-failed`, { agentId, message });
          try { ctx.logger.warn("[dsh-ldvh] %s disposal failed for %s: %s", kind, agentId, message); } catch { /* logger is unavailable during unload */ }
        };
        const observeDisposal = (value, kind, agentId) => {
          if (value && typeof value.then === "function") {
            pendingDisposals.push(Promise.resolve(value).catch((error) => reportDisposalFailure(kind, agentId, error)));
          }
        };
        try { observeDisposal(disposeCreated(), "agent-created-listener", null); } catch (error) { reportDisposalFailure("agent-created-listener", null, error); }
        try { observeDisposal(disposeSubagentEnd(), "subagent-end-listener", null); } catch (error) { reportDisposalFailure("subagent-end-listener", null, error); }
        const clearedChildren = [...children.keys()];
        for (const [childId, { dispose }] of children) {
          try { observeDisposal(dispose(), "child-effect", childId); } catch (error) { reportDisposalFailure("child-effect", childId, error); }
        }
        // 清空前读数：dispose() 会把每个活体子代理经 cleanup 移入 retiredChildren
        // 再 children.delete —— 之后直接 clear 两张表。这里记录清空事件，使
        // 「表何时被清空、被谁清空、清空前有哪些」可回读（步骤 1 观测点）。
        const clearedRetired = [...retiredChildren.keys()];
        children.clear();
        retiredChildren.clear();
        registryActivity.record("children/cleared", {
          clearedLive: clearedChildren,
          clearedRetired,
          at: new Date().toISOString()
        });
        // Dispose only the effects installed by this plugin, not the agent
        // fiber. Each effect removes its own tools, listeners and timer; unlike
        // deleting the bookkeeping map, this releases the actual registrations.
        const timerIds = [...agentTimers.keys()];
        for (const [agentId, ownedEffect] of agentEffects) {
          try {
            if (typeof ownedEffect.dispose === "function") observeDisposal(ownedEffect.dispose(), "agent-effect", agentId);
            else reportDisposalFailure("agent-effect", agentId, new Error("owned effect disposer unavailable"));
          } catch (error) {
            reportDisposalFailure("agent-effect", agentId, error);
          }
        }
        // Defensive fallback for a timer whose owning effect failed to clean up.
        const disposedTimers = timerIds.filter((id) => !agentTimers.has(id));
        for (const [timerAgentId, triggers] of agentTimers) {
          try {
            observeDisposal(triggers.dispose(), "timer-drain", timerAgentId);
            disposedTimers.push(timerAgentId);
          } catch (error) {
            reportDisposalFailure("timer-drain", timerAgentId, error);
          }
        }
        registryActivity.record("timers/cleared", { disposed: disposedTimers, at: new Date().toISOString() });
        agentTimers.clear();
        stopPromise = Promise.all(pendingDisposals).then(() => {
          agentEffects.clear();
          if (disposalErrors.length > 0) throw new AggregateError(disposalErrors, "LDVH lifecycle cleanup encountered errors");
        });
        return stopPromise;
      };
    },
    /** Test/introspection seam. */
    installedAgentIds() {
      return [...agents.keys()];
    },
    /** Per-agent lifecycle snapshots for diagnostics/Web (mnemon parity). */
    snapshots() {
      return [...agents.values()].map((lifecycle) => lifecycle.snapshot());
    },
    snapshotOf(agentId) {
      return agents.get(agentId)?.snapshot();
    },
    /**
     * Delegated child snapshots (2026-09-04). Previously the Web/RPC surface
     * only saw roots, which made the delegation chain invisible at exactly the
     * same time the rules asked for it to be visible. Children are returned
     * with the same consumer shape as roots where the fields overlap.
     */
    childSnapshots() {
      return childRecords().map((record) => record.snapshot());
    },
    /** Full activity trail for one child (entries, not just the count). */
    childActivityOf(childId) {
      return lookupChild(childId)?.activitySnapshot() ?? null;
    },
    /** Registry-first, session-record-fallback resolution (async). The review
     * channel's entry point after a plugin rebuild; see resolveChild above. */
    resolveChild,
    /** The child's captured final text, or null when not yet concluded. */
    childConclusionOf(childId) {
      return lookupChild(childId)?.conclusion ?? null;
    },
    /** Registry-level activity trail (children/retiredChildren write/clear/adopt).
     * Entries: { at, hook, detail } — same shape as per-agent activity. */
    registryActivitySnapshot() {
      return registryActivity.snapshot();
    }
  };
}
