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

import { resolveGovernanceScope } from "./governance-scope.js";
import { buildNormDirectoryForRoot, normDirectoryDigest, NORM_DIRECTORY_BUDGET_CHARS, NORM_DIRECTORY_SECTION_NAME } from "./norm-directory.js";
import { registerLdvhTools } from "./ldvh-tools.js";
import { createAssembleHandler, createPreStepHandler } from "./guidance.js";
import { RECALL_SUMMARY, buildRecallInjection } from "./recall-injection.js";
import { recallLimitForBudget } from "./source-recall.js";
import { noticeTextFor, noticeSummaryFor } from "./guidance-text.js";
import { createTurnTriggers } from "./triggers.js";
import { recordRun } from "./idle-runlog.js";
import { COMPLEXITY_CRITERIA, GATE_POINT_EXCLUSIONS, REVIEW_ASK_ROW_SUMMARY } from "./review-ask.js";



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
 * 条文原文**；**排除清单的取反是据此推导的判据，不是条文原文**（该节只列排除清单，
 * 规范里没有正面规定「什么情况算复杂任务」——2026-11-13 逐条核对原文后的更正）。
 * 判据之后另渲染一道**点位排除**（32 §4.2，2026-11-14 Human 决定）：它管「已判为
 * 复杂任务的这一处要不要去问 Human」，不属 04 的判据，故单独成块、不得并入编号列表。
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
export function buildReviewAskNotice({ preOn, postOn, preKnown = true, postKnown = true, silentOn = false }) {
  const criteria = COMPLEXITY_CRITERIA
    .map((item, index) => `  ${index + 1}. ${item.label}（${item.source}）`)
    .join("\n");
  const lines = [
    // 正文首行也**不写插件名**：这一行展开后仍挂在「上下文注入 · dsh-ldvh」之下，
    // 再写一遍就是同一行里第三次重复（折叠标签已去掉，此处同步）。
    "两处提请的开关状态（Human 2026-11-13 决定：改为「要不要安排代理」两问）",
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
  // 静默执行**单独一行**，不并进上面那行：它不是一个开关的状态，而是那两个
  // 开关的**执行档位**。混在一行里会让读者以为「静默」是第三处独立把关。
  if (silentOn) {
    // **不写「已开启（取不到，按关闭处理）」**（独立复核 MAJOR-4）：那是自相矛盾的
    // 文案——「已开启」与「按关闭处理」不可能同时成立。取不到时 silentOn 本就
    // 不该为 true（调用点按 `settings.silentRun === true` 取值，取不到即 false）。
    // **不接收 silentKnown**（同日同上）：它的语义（这个值有没有被配置写明）
    // 由 `reviewAskMode` 在工具侧如实报告，本行只表达「开着会怎样」。
    // 收下一个不用的参数，等于给下一位读者留一个「它应该有用」的假信号。
    lines.push("- 静默执行：**已开启** —— 判为复杂任务且**未命中点位排除**时**不问**，直接自动安排那次代理核对；每次须在交付里原样引用该次结果的 notice 一行（静默不等于无痕）。命中点位排除时该处不问**也不派发**——排除管的是那一次核对要不要发生，它优先于档位（32 §6.3 末段）。");
  }
  lines.push("", "判据（不新造；specs/04 §6.1 三条正面是条文原文，其排除清单取反是据此推导的判据而非条文）：");
  lines.push(criteria);
  // ── 点位排除（2026-11-14 Human 决定，specs/32 §4.2）────────────────────
  //
  // **渲染在判据之后**，因为它是一道后置判断：先判「算不算复杂任务」（04 §6.1），
  // 再判「这一处要不要去问 Human」（32 §4.2）。把它并进上面的编号列表，就是把
  // 两张清单压成一张——32 §19 第 5 项明禁互相顶替，而压进同一个列表后主控只会
  // 读出一句「这些不算复杂任务」，那既改了 04 的语义（本文无权），也顺手把
  // 方案收敛自查一起免掉了（32 §4.2「不免除清单」禁止的正是这个读法）。
  //
  // 条目取自 GATE_POINT_EXCLUSIONS 常量，不在此另写散文：注入行与工具描述两处
  // 都渲染同一份数据，改一处即两处同步（单一来源，同 REVIEW_ASK_ROW_SUMMARY 的理由）。
  const exclusionLines = GATE_POINT_EXCLUSIONS.map((item) => `  - ${item.label}｜承接：${item.carried}｜不适用：${item.notExcluded}`).join("\n");
  lines.push(
    "",
    "点位排除（specs/32 §4.2，判为复杂任务**之后**才看；命中则该处**不问**）：",
    exclusionLines,
    "  命中要件：**当次工作整件**只属上述一类——混合任务照旧请示，本文不按动作切分。",
    "  命中不免三件事：`04 §6.1` 的方案收敛自查与主控自查照做；任何 Human Gate 的提请照提（`00 §3.2` 根决定事项、`00 §3.3` 受保护内容同意、管辖登记、各事实类型的创建与终态确认）；`00 §2.5` 独立审核的适用范围照做（受保护内容修改、下位规范建立或实质修改、进入事实源的事实规范候选）。",
    "  命中即须交付一行：`点位排除（32 §4.2）：命中〔哪一类〕｜当次整体范围〔…〕｜判定理由〔…〕`——不写这行按未请示处理（32 §16）。",
  );
  lines.push("");
  // ── 时点条件（2026-11-14 修，Human 指出「主控还没有自己意见的时候，怎么会有
  //    审查这个说法？说明审查的提示时机有问题」）────────────────────────────
  //
  // **原来的两句各写错了两处，两处都改在此处，不再散落在行文里**：
  //
  // 1. **时点写成「动手前」= 任务第一秒**。规范里的进入信号是 `32 §6.1`
  //    「尚未开始产生副作用」，不是「尚未做任何事」——读规范、查事实、收敛方案
  //    都不产生副作用，都在这处请示的适用面内；它管的是**方案已成形、还没落地**
  //    那一刻。`32 §7.2` 又把「方案关键主张」列为行动前的可选输入、`§8.1` 说
  //    问的是「对**候选**的独立核对」——**没有候选，就没有被核对的对象**，
  //    此时发问是空问，`32 §6.4` 明禁「为规避判断而一律请示（那会使机制退化为
  //    噪音）」。故本行现在把前置条件写成「方案已有候选」。
  //
  // 2. **「取得明确答复后才动手」是规范明禁的暂停**。`00 §2.5` 原文：「请示本身
  //    不是行动放行的前提，**也不使行动在取得答复前暂停**」；`32 §3.4` 原话：
  //    「本文的一切规则不得收紧或放宽这一根边界——**尤其不得把「未取得答复」
  //    处置为「必须暂停」**」。旧行文与受保护文本 `guidance-text.js` 里那句
  //    「也不使行动在取得答复前暂停」在同一批上下文里互相矛盾，而受保护文本才是
  //    权威。改为「答复不构成动手前提」。
  if (preOn && silentOn) {
    lines.push("① 行动前（方案已有候选、尚未产生副作用时）：按上面判据判定本次是否「复杂任务」，再看是否命中点位排除。判为复杂**且未命中排除**时，**不要问**——调 `ldvh_review_ask` 会直接返回派发模板，按它派零上下文子代理核对候选，结论回来后再落地。**尚无候选方案时不得发起该处请示**（没有对象可核对，32 §6.4）；该处核对免的是征询，不是核对本身。");
  } else if (preOn) {
    lines.push("① 行动前（方案已有候选、尚未产生副作用时）：按上面判据判定本次是否「复杂任务」，再看是否命中点位排除。判为复杂**且未命中排除**时，询问 Human「是否安排代理审查」。**尚无候选方案时不得发起该处请示**——没有对象可核对，此时发问是空问（32 §6.4）。**答复不构成动手前提**：请示不使行动暂停，未取得答复时按既有路径继续（00 §2.5、32 §3.4）。");
  }
  // 收口前那处的时点本无歧义（「一件复杂任务做完时」），故本次只补同一条效力边界：
  // 旧行文写「取得明确答复后再收口」，同样把 00 §2.5 的「不使行动在取得答复前
  // 暂停」写反了——收口不因请示未获答复而停下，它的对象是**已经发生**的工作，
  // 请示只是决定要不要再核对一遍。
  if (postOn && silentOn) {
    lines.push("② 收口前（一件复杂任务做完、尚未形成完成声明时）：先看是否命中点位排除；**未命中**则**不要问**——调 `ldvh_review_ask` 直接取派发模板，派零上下文子代理逐条核对后再收口。");
  } else if (postOn) {
    lines.push("② 收口前（一件复杂任务做完、尚未形成完成声明时）：先看是否命中点位排除；**未命中**则询问 Human「是否安排代理复核」。**答复不构成收口前提**：请示不使收口暂停，未取得答复时按既有路径继续并如实说明（00 §2.5、32 §3.4）。");
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
// 2026-11-17：待处置队列已删除（Human 决定，11 §12）。失败留痕改走 recordRun。
import { adoptFinishedChild, createChildInstaller } from "./child.js";
import { resolveChildFromSessionRecord } from "./child-session-record.js";
import { ActivityLog, AgentLifecycle } from "./agent-lifecycle.js";
import { recordJudgementForGuard } from "./host-seams.js";
// 经验记录分身（23 §13 代理记录通道，Human 决定 2026-11-16）：授权账与分身工具面。
import { createExperienceArming } from "./experience-arming.js";
import { registerPitfallTools } from "./pitfall-tools.js";
import { registerFrictionChildSurface } from "./friction-tools.js";


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
 * 这是可证伪的：一旦有人给该入口加上 `tier` 参数，该断言立即失败。（原针对
 * `runReviewStage`；该模块已随 review 层整层删除，2026-11-16。）
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


  // review 层已整层删除（2026-11-16），故此处不再有可探测的审核入口。
  return probeStructuralFactsWith([], DISCRETION_NAMES);
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

// 2026-11-17：`readTimerEvidence` 已删除——它取的是计时器判定记录，而计时器与
// 静置检查点已整体删除，没有可取的证据（取回来只会是一份恒空的痕迹）。
//
// **2026-11-16**：`verifyReviewRun` 已删除——它是审核段的 §18 逐行核对映射，
// 而审核段已整层取消。摩擦侧的运行证据由 runlog 的逐任务字段承载，不再经此函数。

export function createLifecycleRegistry(ctx, { dshHomePath, workspaceRoot, sessionScopes, hostSeams, getIdleSettings, getInjectionBudget, getReviewAskSettings }) {
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
  // ── 经验记录分身的开工授权账（Human 决定 2026-11-16，23 §13 代理记录通道）──
  //
  // 一次实例、两处消费：根会话经 `ldvh_pitfall_arm_delegate` 记授权，子代理安装时
  // 按「父会话 + 项目」绑定并决定给不给工具面，写入时再复核一次（过期/错位即拒）。
  // 装载提前做——`installChild` 在宿主 `agent/created` 的同步路径上，那里不能 await。
  const experienceArming = createExperienceArming({ dshHomePath, logger: ctx.logger });
  // 读回失败按「无授权」处理（fail-closed）：宁可让已开工的分身丢能力并留下日志，
  // 也不给无据的会话工具面。装载是幂等的，各入口再各自 await。
  void experienceArming.load().catch((error) => {
    ctx.logger.warn("[dsh-ldvh] experience arming load failed: %s", String(error?.message ?? error));
  });
  const installChild = createChildInstaller(ctx, {
    agents,
    children,
    sessionScopes,
    retiredChildren,
    experienceArming,
    // 分身的能力面注册在授权绑定成功后进行，注册函数由本文件注入——child.js 不认识
    // 工具模块，只认「绑定成了，调这个」，避免委派机制与具体业务面互相纠缠。
    registerChildSurface: (agent) => registerPitfallTools(agent.ctx, {
      dshHomePath,
      workspaceRoot,
      sessionPersistence: () => ctx.get("sessionPersistence"),
      // 写入侧的复核靠它：过期、项目错位、未绑定一律拒（见 pitfall-tools.js）。
      experienceArming
    }, { surface: "child" }),
    // ── 摩擦记录面（2026-11-17，00 §4.5 代理辅助任务）─────────────────────
    //
    // **不受授权约束**：经验面要等开工授权绑定成功才注册（`registerChildSurface`
    // 在 bindForChild 成功后调），摩擦面只要分身受管辖就注册。理由是两者语义不同：
    // 经验授权是「这个分身以后也能记录经验」的长期凭证；摩擦记录是主控当次交派的
    // 一次性动作，没有「以后」这个维度。
    //
    // `resolveProjectId` 走与根会话同一套治理解析（`resolveGovernanceScope`），
    // 而不是从父级继承——审核 B5 的教训：注册按父级继承判定、写入按子级 cwd 自判，
    // 不核对项目就会把观察写进另一个受辖项目。
    registerFrictionChildSurface,
    frictionChildDeps: {
      dshHomePath,
      // 晋升建账的署名来源（与根面同一入口，见 :415）。用 getter 而非取值：
      // 服务可能在插件装配后才注册，取值会永久拿到 undefined。
      sessionPersistence: () => ctx.get("sessionPersistence"),
      // **返回 {id, path} 而不只是 id**（2026-11-17）：代理记录完观察后要顺带做
      // 阈值晋升（11 §9 第 3／4 项，同一次派发内的机械收尾），而建账需要事实源根
      // 目录 `path`。只给 id 会让晋升侧再解析一次管辖——两次解析可能落在不同项目
      // 上（cwd 在两次调用之间变化），那正是审核 B5 的失效形态。
      resolveProjectId: async (agent) => {
        const cwd = agent?.session?.header?.cwd;
        if (typeof cwd !== "string" || cwd.length === 0) return null;
        try {
          const scope = await resolveGovernanceScope(dshHomePath, cwd);
          if (scope?.project?.id === undefined) return null;
          return { id: scope.project.id, path: scope.project.path };
        } catch {
          return null;
        }
      },
      // 设置面开关（2026-11-18，D3）：子代理工具在写缓冲前**每次现读**——传函数
      // 不传值。配置是 volatile 字段，装配时取快照会让「之后关掉开关」不生效，
      // 出现「设置面关了、分身照写」的失效。
      //
      // 总开关或「发现摩擦」子项任一关闭即拒绝写入。`getIdleSettings` 缺席
      // （旧组合/直接测试）时按启用处理，与改动前行为一致。
      isFrictionDiscoveryEnabled: () => {
        const s = getIdleSettings?.();
        return s ? s.enabled !== false && s.tasks?.["friction-discovery"] !== false : true;
      }
    },
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
          // Write points fail closed instead of skipping the goal.
          goals: () => ctx.get("goals"),
          // 行动前那处的判断依据（弱约束，06 §5／§6）：读本 agent 的**活事件
          // 累积器**里当前轮已写出的正文。
          //
          // **为什么用 getter 而不是传值**：`turnTriggers` 在 1041 行才创建，而
          // `syncTools`（本函数的调用方）在其后由 `agent/created` 分发路径触发，
          // 故调用时该 Map 已填好；传值则会在装配时取到 undefined。
          //
          // **为什么取不到要如实报**：读不到 ≠ 没写过候选。取不到时工具侧返回
          // `available: false` 并说明原因，不把空串当依据（见 review-ask-tool.js）。
          readCurrentTurnText: (agent) => {
            const id = agentIdOf(agent);
            if (typeof id !== "string") return { ok: false, reason: "the calling agent exposes no id, so its live turn text cannot be located" };
            const timers = agentTimers.get(id);
            if (timers === undefined) return { ok: false, reason: "this agent has no live turn accumulator in the current process, so its current-turn text is unavailable (the session/event stream has not been wired for it yet)" };
            if (typeof timers.currentTurnText !== "function") return { ok: false, reason: "the live turn accumulator in this composition does not expose currentTurnText" };
            return timers.currentTurnText();
          },
          // 根会话侧也要拿到授权账：`ldvh_pitfall_arm_delegate` 靠它记授权。
          // 取不到时该工具按 unavailable 拒绝（pitfall-tools.js fail-closed 分支），
          // 不会退化成「记了但没人能核验」。
          experienceArming,
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
          // 建前审核的自动派生（行动前请示前置，2026-11-04）：create 成功后由
          // 插件直接派生零上下文子代理做审核，而不是等主控自觉。「闸只拒绝、不推动」
          // 是实测到的失效面——主控建完 draft 直接跳到处置，整个审核环节被跳过。
          // 取不到该服务时自动派生的结果为 unavailable，如实报告而非静默降级。
          subagents: (() => {
            try { return agent?.ctx?.get?.("subagents") ?? null; } catch { return null; }
          })(),
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
        // 两处把关询问的行为提示行（2026-11-13 Human 决定：改问是否
        // 安排代理审查／复核，各由设置开关控制，打开才有）。
        //
        // **它只提示、不代问**：询问本身必须由主控经 `ldvh_review_ask` 发起
        // （或模型面直接调宿主 ask_user_question），因为「这次任务算不算复杂」
        // 是 AI 语义判断，机械层判不了（本行注释与 review-ask.js 头注同一口径）。
        // 本行做的是让主控**在形成方案的那一步**看得见「开关开着、该判一次
        // 复杂度」这件事
        // ——这正是 21 §14 那次「闸只拒绝、不推动」教训的推广：没有提示行，
        // 开关即使打开也会被静默跳过。
        //
        // 开关未开、或取不到项目时返回 inject:false；不产生必停。
        // **事实规范目录行**（2026-11-15，Human 决定）：独立成一行注入，不在召回块内。
        // 目录来源仍是既有枚举权威（norm-directory.js → l0EnumerationOf），此处只负责
        // 取项目根、算体量与内容指纹。
        normDirectoryRow: async () => {
          const projectPath = lifecycle.lastScope?.project?.path ?? agent?.session?.header?.cwd;
          if (typeof projectPath !== "string" || projectPath === "") return null;
          const directory = await buildNormDirectoryForRoot({
            root: projectPath,
            budgetChars: NORM_DIRECTORY_BUDGET_CHARS,
          });
          if (directory.text === "") return null;
          return { inject: true, text: directory.text, digest: normDirectoryDigest(directory.text) };
        },
        normDirectorySummary: NORM_DIRECTORY_SECTION_NAME,
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
              // 静默执行（2026-11-13 晚）：它只改**怎么执行**，不改注入条件——
              // 两枚询问开关都关时整行仍不注入（此时静默没有作用对象）。
              silentOn: settings.silentRun === true,
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
      // Turn-level triggers（11 §6.1 触发判据，2026-11-17 修订）。
      // 本块只注入**仍被 triggers 消费**的通用依赖：状态读取、轮次/活动记账、
      // 日志、诊断痕迹。计时器、安静时长与检查点派发回调均不属于本注入面——
      // 计时器与静置检查点已删除，摩擦记录改由主控经 child-only 工具发起
      // （见 triggers.js 文件头与 friction-tools.js）。
      //
      // **本块不装配任何宿主调度服务**：triggers 不依赖宿主定时任务是否存在，
      // 因而不存在「服务缺失即无法工作」的降级路径。
      const turnTriggers = createTurnTriggers(agent, {
        // 诊断痕迹注入点（2026-10-23）：清理动作与失败分支落盘，使「做过什么、
        // 在哪早退」可事后归因。
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
      });
      // 登记到插件级清单（见 agentTimers 的说明）：per-agent disposer 与插件级
      // disposer 各自都会清，两处都做是为了「哪条路径先到都能收口」。
      agentTimers.set(agentId, turnTriggers);
      // Prime the pre-step channel at install：install 本身发生在 agent/created
      // （= session 的 startup 语义），这一次 prime 取代旧实现里对
      // agent/session-start 的首次响应。resume / clear / compact 的再次 announce
      // 由 start() 的 agent/created 分发路径 re-prime（见 reprimeAgent）。
      onPreStep.prime();
      // ── 装载路径不重建任何计时或检查点（2026-10-27，2026-11-17 收口）──
      //
      // 静置检查点与计时器已整体删除（11 §6.1 触发锚是主控发起）：装载路径既不读
      // 活动时刻、也不建计时器，更不武装任何周期任务。摩擦记录改由主控在当次行动
      // 中经 child-only 工具派发代理（见 friction-tools.js），与本装载路径无关。
      //
      // **不要为了「重启后接着跑」把恢复加回来**：那会把已经结束的安静期重新变成
      // 待触发的，缺陷原样复现，且表面症状是「一激活旧对话就冒出静置执行体」，
      // 很难归因到装载路径。
      const stops = [
        agent.ctx.on("system-prompt/assemble", (assembly, context, next) => onAssemble(assembly, context, next)),
        agent.ctx.on("agent/pre-step", (payload, next) => onPreStep.handler(payload, next), { prepend: true }),
        agent.ctx.on("agent/turn-stopping", (payload) => turnTriggers.onTurnStopping(payload)),
        // 11 §6.1（2026-11-17 最终形态）：`agent/status` 的 `idle` **不是派发点**，
        // 只记一次观察计数——宿主 idle 说明「此刻没有在跑的驱动」，但**不说明
        // 会话已安静多久**；派发由主控经 child-only 工具发起，不存在安静期判定。
        agent.ctx.on("agent/status", (payload) => turnTriggers.onAgentStatus(payload)),
        agent.ctx.on("session/event", (session, event) => turnTriggers.onSessionEvent(session, event))
      ];

      return () => {
        const cleanupErrors = [];
        for (const stop of stops.reverse()) {
          try { stop(); } catch (error) { cleanupErrors.push(error); }
        }
        // Stop the triggers synchronously and return the in-flight diagnostic
        // drain so Cordis can await it when the agent or this plugin is disposed.
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
      // 2026-11-17：会话启动时的队列清点已随待处置队列删除（Human 决定，11 §12）。
      // 失败可见性由当次回执 + 运行痕迹承载，不再需要开局报数。
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
