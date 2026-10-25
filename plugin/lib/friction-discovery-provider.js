/**
 * dsh-ldvh — 摩擦发现的执行体派生 (specs/11 §9 第 1 项，§8.2).
 *
 * 本模块把「派一个受管辖隔离子代理去做语义查重、取回它的结构化判断」这件事
 * 封成一个**注入给 `runIdleCheckpoint` 的 `discover` 提供者**。它是 §8.4 那句
 * 「由受管辖隔离子代理作出语义判断」与宿主 `subagents` 服务之间的唯一接缝。
 *
 * ## 为什么是 `startActivation` 而不是 `startContinuable`（实测依据）
 *
 * 宿主 0.2.1-rc.1 起 `start` / `startContinuable` 均已移除，派发只剩
 * `startActivation(spec)`；它返回 `SubagentActivation`
 * （`{ childId, messageId?, result, dispose() }`），`await activation.result`
 * 仍是取结构化判断 `SubagentResult.structured` 的通道，`outputSchema` 经
 * `spec.request.outputSchema` 传入。本机制**不需要可续能力**（每次检查点独立
 * 派生、跑完即结束），但**需要**结构化判断——故取 `startActivation`。
 * （2026-10-11 第三次 C2 重批选定 `start`；2026-10-17 随宿主契约迁移。）
 *
 * ## provider 的选择：必须 `inheritsParentContext === false`（2026-10-12 规范修订）
 *
 * 11 §7.1「执行体与上下文供给」段（Human 决定 2026-10-12）规定：执行体以**零
 * 上下文**派生（spawn），判断所需输入全部由调度侧**机械交付**（窗口原文材料 +
 * 候选账本投影）；**禁止全量交付**——含以「继承主控上下文」为通道的交付：全量
 * 可见使水位切分只剩提示词约束，且执行体输入随会话增长单调扩大（实测 fork 全量
 * seed 在约 1.1 万事件会话达 37–46 万字符，执行体以 error/max-tokens 失败）。
 * 实测：`spawn` 的 `inheritsParentContext = false`（源码注释「zero parent
 * context」），`fork` 为 `true`（以父会话日志最后一个 `turn/end` 之前的全部事件为
 * seed）。故本模块**按能力挑选 provider**（挑零上下文者），而不是硬编码名字——
 * 名字可能随宿主配置变化（`Config.providerName` 可覆盖），而能力是语义要求。
 *
 * ## 边界（§8.2 第 2/4 条）
 *
 * 子代理的产出**不取得授权或完成效力**，不得产生需要 Human 决定的结论；本模块
 * 只把它取回并交给闭集落地，**不解释其语义**。子代理也**不得**代表本机制作出
 * 「值不值得修」这类判断（提示词已写明）。
 */

// 只导入**实际**用到的：提示词的任务段与公共段由本模块拼接（见下方
// buildCompositePrompt 的调用）。单任务入口 buildDiscoveryPrompt、单任务 schema、
// 逐任务校验器都改由登记表分派——本模块不再直接调用，故不再导入（否则是「导入了
// 却从不使用」的死引用：lint 会拦，读者也会误以为这里有直连）。
// 任务段（buildDiscoveryPromptSection）由**登记表**分派（见下方 sections 的构造），
// 本模块不再直接调用它；只保留公共段的构造。
import { buildSharedPromptSection } from "./friction-subagent-contract.js";
import { AUX_TASK_REGISTRY, buildCompositePrompt, compositeOutputSchema, splitRunnableTasks, validateCompositeOutput } from "./aux-task-registry.js";
import { windowBody } from "./friction-window.js";
import { currentRouteValuesForSession } from "./session-signature.js";
import { authoritativeSignature } from "./signature-channel.js";

/** 服务不可用时的失败（由调用方按 §8.3 入队，不静默降级）。 */
function unavailable(reason) {
  return { ok: false, error: { code: "discovery_provider/unavailable", message: reason } };
}

/**
 * 取得**执行体自身**的权威路由署名（specs/09 机械签名「当次实际 provider/model」）。
 *
 * ## 为什么必须取执行体的，而不是主控的
 *
 * 闲时落账曾以**主控会话**的 `agent` 调 `currentRouteValues`，于是执行体作出的判断
 * 被盖上主控的路由章——实测 2026-10-16T06:17:11Z：主控 `session-36dd0a0a` 为
 * `workbuddy/deepseek-v4.1-flash`，实际派出的子代理 `147acc26` 为
 * `ds-yue/deepseek-v4-flash`，而落账对象 `pitfall-2abbbc2f` 记的是**主控值**。
 * 09 §5.1 要求取「当次实际」的 provider/model；当次实际跑这个判断的是执行体。
 *
 * ## 时序（宿主源码核实，2026-10-17 随 rc.1 迁移重写）
 *
 * 旧实现依赖 `SubagentRun.localAgent` 取子 agent 再读路由。rc.1 的
 * `SubagentActivation` **没有** `localAgent`（甚至没有 `id`），只剩 `childId`；
 * 且 `activation.result` 由 `finishDisposal` 内部结算，结算**之前**宿主已
 * `resident.delete(childId)`——等 result 返回时 `agents.get(childId)` 也取不到。
 *
 * 故改按**会话标识**读权威记录：子会话在结算前已被 `flushFinalState` 刷盘，
 * 此刻记录完整。这条路径既不依赖 agent 对象，也不与结算时序赛跑。
 *
 * ## 取不到时的处置（Human 裁定 2026-10-17：「不存在没有署名的情况」）
 *
 * 实测 132 个子代理会话，无 routing 事件的 3 个全部为 `turn/end reason=blocked`
 * 且无任何 assistant 消息——即从未产出判断，本就走不到落地。故「产出判断 ⇒ 该会话
 * 必有 routing 事件」成立，取不到只可能是实现缺陷或宿主契约被破坏：**如实返回失败
 * 结果，绝不回落到主控路由冒签**。
 */
async function resolveExecutorSignature(sessionPersistence, childId) {
  if (typeof childId !== "string" || childId.length === 0) {
    return {
      ok: false,
      reason: "the activation exposes no childId — the executor's own session cannot be identified, so "
        + "09 §5.1's provider/model cannot be read from its own record.",
    };
  }
  // 只认会话标识：宿主正规入口 open(id,'read') 自行定位日志；子会话在结算前
  // 已被 flushFinalState 刷盘，故此刻可读（见 currentRouteValuesForSession 说明）。
  const route = await currentRouteValuesForSession(sessionPersistence, { id: childId });
  if (!route.ok) return { ok: false, reason: `executor route unavailable: ${route.reason}` };
  const carrier = authoritativeSignature({ provider: route.value.provider, model: route.value.model });
  if (carrier === null) return { ok: false, reason: "the executor route resolved but could not be branded" };
  return { ok: true, value: carrier, route: route.value };
}

/**
 * 在已注册的 provider 中挑选**零上下文**的那一个（2026-10-12 规范修订）。
 *
 * 顺序：优先 `spawn`（本宿主实测名），否则取第一个 `inheritsParentContext === false`
 * 的。**没有零上下文 provider 即不可用**——11 §7.1「禁止全量交付」：不得以「继承
 * 主控上下文」为通道向执行体交付未经水位切分的全量会话历史，故此时**不得**退回
 * `fork`（它会把父会话最后一个 turn/end 之前的全部事件作为 seed 交付执行体）。
 */
export function selectZeroContextProvider(subagents) {
  let names;
  try {
    names = subagents.list();
  } catch (error) {
    return unavailable(`cannot list subagent providers: ${String(error?.message ?? error)}`);
  }
  if (!Array.isArray(names) || names.length === 0) {
    return unavailable("no subagent provider is registered");
  }

  const zeroContext = [];
  for (const name of names) {
    let provider;
    try {
      provider = subagents.getProvider(name);
    } catch {
      continue;
    }
    if (provider?.inheritsParentContext === false) zeroContext.push({ name, provider });
  }
  if (zeroContext.length === 0) {
    return unavailable(
      `no registered subagent provider is zero-context (candidates: ${names.join(", ")}) — 11 §9 (Human 2026-10-12) requires zero-context spawn with scheduler-delivered bounded material; refusing to fall back to a context-inheriting provider (全量交付禁止)`,
    );
  }
  // 能力面：需要 outputSchema 才能把判断结果升为机械校验。
  const withSchema = zeroContext.filter((entry) => entry.provider?.capabilities?.outputSchema !== false);
  const chosen = withSchema.find((entry) => entry.name === "spawn") ?? withSchema[0] ?? zeroContext[0];
  return { ok: true, value: { name: chosen.name, provider: chosen.provider } };
}

/**
 * 组装一个 `discover` 提供者（给 `runIdleCheckpoint` 用）。
 *
 * 依赖注入（便于测试与显式化依赖）：
 *   - `subagents`：宿主 subagents 服务（`list`/`getProvider`/`start`）；
 *   - `parent`：发起会话的 Agent（`start` 要求 `request.parent`）；
 *   - `signal`：调用方取消信号（`start` 要求 `request.signal`）；
 *   - `onRun`（可选）：观察钩子，用于活动记账与实跑取证。
 *
 * 返回的函数签名与 `runIdleCheckpoint` 的 `discover` 契约一致：
 * `({ threshold, candidates, window, tasks })`，返回
 * `{ outcome, verdict, watermarkTurn? }` 或抛错（由调用方按 §8.3 入队）。
 *
 * `existingPitfalls` **不再是入参**（2026-10-20 清退）：它曾为「经验积累」的查重
 * 提供既有 Pitfall 列表。两段式之后查重属于审核段（11 §10.2 第 2 项），捕获段
 * 明令不判重复（§10.1「捕获段不得做的事」），生产方 `idle-checkpoint` 也不再读取
 * 该列表——形参留着只会恒为 undefined，读者却会以为查重走这条路。审核段自己经
 * `collectExistingPitfalls` 取对照集。
 *
 * `sessionSignature` **不再是入参**（2026-10-17 清退）：它曾由 `runIdleCheckpoint`
 * 透传，而 `lifecycle` 调用时从不传入，故恒为 undefined——形参存在但永远读不到值，
 * 读者会误以为署名走这条路。真正的署名由本模块在派发后自行从**执行体会话记录**
 * 取得（见 `resolveExecutorSignature`），并随返回值的 `executorSignature` 上抛。
 */
export function createDiscoveryProvider({ subagents, parent, signal, onRun, provideWindow, registry = AUX_TASK_REGISTRY, sessionPersistence = null } = {}) {
  if (subagents === undefined || subagents === null) {
    throw new Error("createDiscoveryProvider requires the host `subagents` service");
  }
  if (parent === undefined || parent === null) {
    throw new Error("createDiscoveryProvider requires the initiating `parent` Agent (startActivation requires spec.request.parent — the governed-isolation linkage, not context inheritance)");
  }
  if (signal === undefined || signal === null) {
    throw new Error("createDiscoveryProvider requires an AbortSignal (startActivation requires spec.signal, which the host no longer uses for cancellation — see the dispatch site)");
  }

  return async function discover({ threshold, candidates, observationGroups, window: windowRange, tasks: requestedTasks }) {
    // 本次要跑的**全部**任务（有序）。未给出时退回单任务 `idle-review`——保持既有
    // 调用方（测试与诊断路径）无需改造，且它与「只勾选 idle-review」等价。
    //
    // 「已启用」与「已实现」是两件事：设置面可以把三个都勾上，而
    // `capacity-maintenance`/`memory-health` 的**能力本体没有代码**。故这里先按
    // `implemented` 分派——只把已实现的拼进提示词，未实现的交给调用方如实记一条
    // 痕迹（`unimplementedTasks` 随返回值上抛，04 §8.5 条件式要求：不得主张空闲
    // 维护已运行，但也不得静默剔除使 Human 看不出它没做）。
    const wanted = Array.isArray(requestedTasks) && requestedTasks.length > 0 ? requestedTasks : ["friction-discovery"];
    const { runnable, unimplemented } = splitRunnableTasks(wanted, registry);
    // D1：区间材料由**调度侧**提供（provideWindow 读累积器），而不是让子代理
    // 按坐标自行划定。调用方（idle-checkpoint）传的 window 只含端点，故这里以
    // provideWindow 的结果为准。
    const effectiveWindow = typeof provideWindow === "function"
      ? (provideWindow(windowRange?.from) ?? { items: [], truncated: false })
      : windowRange;

    // 把窗口**内容**拼成可核对的文本，交给落地校验做逐字引证核对。
    // 注意：判空与取用必须是**同一个对象**（`effectiveWindow`）。曾误写为
    // 「判 `effectiveWindow` 而 map `windowRange`」——当 provideWindow 返回
    // undefined 时 `windowRange.items` 不存在即抛 TypeError，而该异常会让整次
    // 运行按 §8.3 入队（机制静默不产出）。由第二次独立复核的探针发现。
    // 用**被核对的正文**（windowBody：与提示词那份同源，仅去掉边界标记）。
    // 单一来源的理由见 friction-window.js 的 renderWindowText 注释：核对是
    // `includes` 字符串比对，两处漂移会使所有引证无故被拒。
    //
    // 刻意**不含**边界标记：核对只判「引文是否在材料正文里」；若把标记也纳入
    // 被核对文本，执行体引标记本身（无意义）反而会通过。
    const windowText = windowBody(effectiveWindow?.items);

    // 缺陷 D6 + 复核发现②③：区间缺口（水位要求覆盖的起点与「本进程实际见过
    // 的最小轮次」之间的空洞，或因缓冲淘汰产生的空洞）。
    //
    // **处置取舍（重要）**：缺口是**不可恢复**的——宿主只发布事件、不回放，而本
    // 模块按 §8.4 纪律不读会话日志，故那段内容确实永远拿不回来了。此时：
    //
    //   ✗ 一律 fail-closed 不动水位 → 缺口永远在 → 机制**永久停摆**，且每次检查点
    //     都往待处置队列塞一条，比原问题更糟。
    //   ✗ 静默跳过 → 内容丢失而不留痕（正是要防的）。
    //   ✓ 如实登记缺口，并把水位推过缺口后在可观察部分正常继续。
    //
    // 故这里**不抛错**，而是把缺口交给调用方登记，并让本次照常运行（子代理只看
    // 得到它真正拿到的材料）。水位推进由调用方在落地成功之后执行，且推进终值为
    // 本次区间终点——越过缺口是**已知并已登记**的损失，而非静默遗漏。
    //
    // 本声明**上移到短路判定之前**：短路的准入条件之一就是「无缺口」，故判定
    // 短路时必须已经知道缺口为何。
    const unobserved = effectiveWindow?.unobserved ?? null;

    // ── 空区间的短路（2026-10-11）────────────────────────────────────────
    //
    // 区间内**没有任何新增内容**、且**没有缺口**时，本就没有观察对象：11 §9
    // 把观察对象定义为「自上次运行以来新增的会话内容」，没有新增即无从观察。
    //
    // 此前会照常 fork 一个**继承主控完整上下文**的子代理（实测主控会话解压
    // 21.7 MB），只为让它回答「材料为空 → no-discovery」——提示词已写死该情形下
    // 只能这样答，故这次派发**不可能**产出别的结论。代价与收益完全不相称。
    //
    // **不是「跳过检查」**，而是一次**记账层面的 no-op**：返回一个与
    // 「子代理报 no-discovery」**完全同形**的结果，使调用方的落地路径一字不改
    // ——它仍走同一处阈值判定、同一处水位推进。差别仅在**不派生、不烧上下文**。
    //
    // ⚠️ **有缺口时绝不短路**（`unobserved !== null` 即走原路径）。缺口意味着
    // 内容**真实丢失过**，那正是必须被登记的对象；短路会把「本进程没看到任何
    // 事件」这种最严重的情形（`unobserved = { from, to: null }`）一并吞掉，
    // 使缺口既不入队也不上报——那是把「如实登记」换成「看起来没事」。
    // 无任何**已实现**的任务可跑：不派生执行体。
    //
    // 这与「任务被停用」不同——那是配置，调用方根本不会派发到这里；这里说的是
    // 「勾了，但能力没有代码」。此时派生一个子代理没有任何意义（提示词里没有
    // 任何要求作答的事项），故与空窗口同样短路，但**理由必须可区分**：痕迹里
    // 记 `no-runnable-task` 并带上未实现者的名单。
    if (runnable.length === 0) {
      onRun?.({
        phase: "skipped",
        reason: "no-runnable-task",
        note: "本次没有任何已实现的任务可跑；已启用但未实现者已随返回值上抛，须由调用方如实登记（04 §8.5）",
        unimplemented,
      });
      return {
        outcome: "no-discovery",
        verdict: { verdict: "no-discovery", quote: "", reason: `本次没有已实现的任务可跑（未实现：${unimplemented.join(", ") || "无"}）`, impact: "light" },
        unobserved,
        watermarkTurn: Number.isInteger(windowRange?.to) ? windowRange.to : undefined,
        skipped: "no-runnable-task",
        unimplementedTasks: unimplemented,
        taskResults: {},
        // 短路：未派生执行体，故无判断产出、无执行体可署名。落地侧见 null 且
        // skipped 非空时**不落地任何对象**，因此不会走到盖章处（不是「缺署名」）。
        executorSignature: null,
        executorSignatureFailure: null,
      };
    }

    const emptyWindow = Array.isArray(effectiveWindow?.items)
      && effectiveWindow.items.length === 0
      && windowText === "";
    if (emptyWindow && unobserved === null) {
      onRun?.({
        phase: "skipped",
        reason: "empty-window",
        // 说清短路的确切条件，使痕迹本身可核对（而非只报一个字符串）。
        note: "本次区间无任何新增内容且无缺口——依 11 §11「观察对象=新增内容」无观察对象，未派生执行体",
        window: { from: windowRange?.from ?? null, to: windowRange?.to ?? null, turns: 0, truncated: false },
      });
      // 返回值须与「真跑了子代理且它报 no-discovery」**完全同形**——调用方
      // （idle-checkpoint）按 `outcome` / `verdict` / `unobserved` / `watermarkTurn`
      // 四处消费，缺一处就会走出不同的分支（曾误写成 `{ok:true,value:{...}}`，
      // 那是本模块**入参**的 envelope 形状，不是返回形状）。
      //
      // `verdict.verdict` 这个双层名字是落地侧的既有契约（`friction-landing.js`
      // 读 `verdict.verdict`），不是笔误，照它写。
      return {
        outcome: "no-discovery",
        verdict: { verdict: "no-discovery", quote: "", reason: "本次区间无任何新增内容（11 §11：观察对象=自上次运行以来新增的会话内容），故未派生执行体", impact: "light" },
        unobserved: null,
        // 与正常路径一致：水位推进到本次区间终点。**这不是「凭空推进」**——
        // 区间内确实没有内容可丢，推进语义与「子代理看了空材料报 no-discovery」
        // 相同；真正会丢内容的缺口情形已被上面的 `unobserved === null` 排除。
        watermarkTurn: Number.isInteger(windowRange?.to) ? windowRange.to : undefined,
        skipped: "empty-window",
        // 与正常路径**同形**：多任务字段也在（空窗口下每件都只会报「无发现」，
        // 故 taskResults 为空、unimplemented 照实带上）。
        unimplementedTasks: unimplemented,
        taskResults: {},
        // 短路：未派生执行体，无判断产出、无执行体可署名（同 no-runnable-task）。
        executorSignature: null,
        executorSignatureFailure: null,
      };
    }

    const picked = selectZeroContextProvider(subagents);
    if (!picked.ok) {
      const error = new Error(picked.error.message);
      error.code = picked.error.code;
      throw error;
    }

    // ── 拼接：公共段一次 + 各任务段依次（Human 决定 2026-10-11）────────────
    //
    // 材料（`effectiveWindow`）与边界声明对全部任务**只有一份**：每任务各拼一遍
    // 会随任务数线性膨胀（材料实测可达 10 万+ 字符），且同一段规则出现两次就可能
    // 有两种措辞——引证核对按材料正文做字符串比对，措辞漂移直接使引证被拒。
    const sections = {};
    for (const key of runnable) {
      // 任务段的构造**一律走登记表**（不再对 idle-review 特判）：特判会使「登记表
      // 说它已实现」与「派发时真的能给它拼出一段」两件事脱钩，而后者才是判据。
      const build = registry[key]?.promptSection;
      if (typeof build !== "function") {
        // 登记不完整：抛错而不静默跳过——静默跳过会使该任务「被启用、却从未被
        // 要求作答」，而输出里它仍占一个字段（恒为空），与「它答了没发现」无从区分。
        const error = new Error(`aux task "${key}" is marked implemented but has no prompt section builder`);
        error.code = "discovery_provider/incomplete_registry";
        throw error;
      }
      // **各任务的机械前提一并传入，由各段构造器自取所需、忽略其余。**
      //
      // 为什么把全部前提都传（而不是按任务分派前提）：段构造器由登记表引用，
      // 本层不知道各任务需要什么。若只传其中一组，需要其它前提的任务会**静默**
      // 拿到默认空值，而该失效不影响任何字段的形状，故从输出上看不出异常。
      // 传全量前提使新任务无需改动本层。
      sections[key] = build({ threshold, candidates, observationGroups: observationGroups ?? [] });
    }
    const prompt = buildCompositePrompt({
      tasks: runnable,
      sections,
      shared: buildSharedPromptSection({ window: effectiveWindow, taskCount: runnable.length }),
    });
    const outputSchema = compositeOutputSchema(runnable, registry);

    onRun?.({
      phase: "start",
      provider: picked.value.name,
      window: { from: windowRange?.from ?? null, to: windowRange?.to ?? null, turns: Array.isArray(effectiveWindow?.items) ? effectiveWindow.items.length : 0, truncated: effectiveWindow?.truncated === true },
      candidates: candidates?.length ?? 0,
      // 观察组的数量也进痕迹：否则「缓冲里有几组攒到几分」在运行记录上看不出来，
      // 而它正是阈值判定能否发生的前提（11 §9 第 3 项）。
      observation_groups: observationGroups?.length ?? 0,
      // 本次要求作答的任务清单——使「派了几件」与「收了几件」可在痕迹里核对。
      tasks: [...runnable],
      unimplemented_tasks: [...unimplemented],
    });

    // `label` 的形态（Human 决定 2026-10-14）：**只标身份与派发时刻，不列举本次
    // 做哪几件事**。
    //
    //   ① **不列举任务**：label 是给人一眼认出「这是闲时辅助派出来的」的标签，
    //      不是工作记录。本次要求作答的任务清单本来就在运行痕迹里逐条可查
    //      （`onRun({phase:"start"})` 的 `tasks`／`unimplemented_tasks`，以及
    //      逐任务的 `per_task`）。在 label 里再抄一遍是**重复承载**，而任务数
    //      本就是开放集（勾几件做几件），列举会随任务数线性变长——「同时做 N 件
    //      就要写 N 个名字」显然不成立，故取中性名 `ldvh-idle`。
    //      意义：原字面量 `ldvh-friction-discovery` 是 2026-10-11 单任务时期留下的，
    //      多任务改造后**名实不符**（写一个任务名、实际做多件）。
    //   ② **带派发时刻**：同一次会话有多个检查点，同名派生在列表里分不出先后，
    //      带时刻即可排序。
    //   ③ **时刻由代码取，不写死、不由 AI 提供**：取进程时钟 `new Date()`——
    //      与 `lifecycle.js` 既有各处的 `new Date().toISOString()` 同一口径
    //      （不另取宿主事件时间戳：那会使同一次检查点的痕迹里出现两种时间源）。
    //      截到**秒**（去掉毫秒）：本 label 供人扫读排序，秒级足够，毫秒是噪声。
    //      边界：本时刻是**派发时刻**，与运行痕迹里那条 `at` 不逐字相等（二者
    //      分别在 `start` 之前与之后打点），同源同口径，不构成判读歧义。
    const dispatchedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    // 宿主 0.2.1-rc.1 起 `start` 已移除，改由 `startActivation` 派发。
    //
    // spec 的必填项是 provider / label / request / signal / delivery；`childId`
    // 可选且**本机制不传**——传入等于「指定复用既有子会话」，会触发
    // DUPLICATE_CHILD 语义门槛。原 `start` 的 label/signal/outputSchema 分工随之
    // 改变：label 与 signal 升到 spec 顶层，其余三个留在 `request` 内层。
    //
    // `delivery: 'caller'`（非默认的 'parent'）：本次派发的结论由**调用方**
    // 取回并落地，不需要宿主建立 catalog 子项、也不需要结算通知——'parent'
    // 会走 requirePersistence() 并要求 sessionPersistence 参与 catalog 生命
    // 周期，与闲时辅助「独立派发、跑完即取」的形态不符。
    const activation = await subagents.startActivation({
      provider: picked.value.name,
      label: `ldvh-idle ${dispatchedAt}`,
      request: {
        prompt: [{ type: "text", text: prompt }],
        parent,
        outputSchema,
      },
      signal,
      delivery: "caller",
    });

    const childId = activation?.childId;
    onRun?.({ phase: "started", provider: picked.value.name, runId: childId });

    // ── 取执行体自身的署名 ────────────────────────────────────────────────
    //
    // 时序依据（宿主源码核实，2026-10-17）：`activation.result` 由
    // `finishDisposal` 内部结算，而在结算**之前**宿主已执行
    // `flushFinalState`（子会话日志刷盘）并 `resident.delete(childId)`。
    // 故等 result 返回时子 Agent 已不在注册表，`agents.get(childId)` 取不到；
    // 而会话**记录**此刻恰恰是完整的——署名只认记录，不依赖 agent 对象。
    //
    // 不调用 `activation.dispose()`：`dispose()` 恒为 `finishDisposal(stop=true)`，
    // 会无条件 cancel 子 Agent 并把一次正常收束判成父级取消；而
    // `watchLocalSettlement` 已负责自然收尾并结算 result。主动 dispose 既
    // 多余又有害（见 2026-10-17 建前审核第二轮结论）。
    let result;
    let executorSignature = null;
    let signatureFailure = null;
    try {
      result = await activation.result;
      // 只有真正产出结论（completed）的运行才有可署名的判断。非 completed 的
      // 运行后面会按 §8.3 抛错入队，不落地、也就不需要署名——此时不去读它，
      // 免得为一个不会被记录的结论制造一条「找不到署名」的噪声。
      if (result?.stopReason === "completed") {
        const resolved = await resolveExecutorSignature(sessionPersistence, childId);
        if (resolved.ok) {
          executorSignature = resolved.value;
          onRun?.({ phase: "executor-signature", provider: resolved.route.provider, model: resolved.route.model, runId: childId });
        } else {
          signatureFailure = resolved.reason;
          onRun?.({ phase: "executor-signature-unavailable", reason: resolved.reason, runId: childId });
        }
      }
    } catch (error) {
      onRun?.({ phase: "result-failed", provider: picked.value.name, runId: childId, reason: String(error?.message ?? error) });
      throw error;
    }

    onRun?.({ phase: "result", provider: picked.value.name, runId: childId, stopReason: result?.stopReason });

    // 非正常收束：把 stopReason 如实上抛，由调用方按 §8.3 入队（不伪造结论）。
    if (result?.stopReason !== "completed") {
      // 消息保持既有形态（下游与既有测试按 `stopReason=` 解析），另外把**可诊断
      // 的字段挂到 error 上**——由 idle-checkpoint 的 describeExecutorFailure 搬运
      // 进待处置队列（2026-10-26：此前这些信息全部丢失，135 条失败只剩一句
      // `stopReason=error`，三处载体都查不出根因）。
      //
      // `runId` 最要紧：子会话目录以它命名，是「这条失败」连回「那次实际发生了
      // 什么」的**唯一**线索。`stopReason` 与 provider 名同样带上，便于按 provider
      // 聚合（本仓 pitfall 已登记过「子代理审核因 provider 超时连续零产出」）。
      const error = new Error(`subagent run did not complete (stopReason=${String(result?.stopReason)}${result?.diagnostic ? `, diagnostic=${result.diagnostic}` : ""})`);
      error.code = "discovery_provider/incomplete_run";
      error.runId = childId;
      error.stopReason = result?.stopReason;
      error.provider = picked.value.name;
      if (result?.diagnostic !== undefined && result?.diagnostic !== null) {
        error.diagnostic = result.diagnostic;
      }
      throw error;
    }

    // ── 逐任务校验（本设计的核心承诺：一件不过不掀掉其余件）──────────────
    //
    // 宿主已按复合 schema 在**提交层**拦过一次（保证每个任务字段都存在、形状对）；
    // 这里校验**跨字段**约束（same-obstacle 必须带 target_uid 且 uid 在候选内、
    // 引证须真在窗口内等）——那是宿主支持的 JSON Schema 子集表达不了的，见
    // friction-subagent-contract.js。
    //
    // **为什么逐任务收口**：11 §9 的闭集动作按任务分别成立——`idle-review` 的
    // 引证不成立不影响「容量维护该压缩哪些条目」这类结论。整体失败会使一次可用的
    // 运行被整条丢弃，而那正是「一次做多件」最该避免的损失。
    const checkedByTask = validateCompositeOutput(result?.structured, {
      tasks: runnable,
      registry,
      contexts: Object.fromEntries(
        runnable.map((key) => [key, { candidates: candidates ?? [], observationGroups: observationGroups ?? [], windowText }]),
      ),
    });

    // 各任务的结论分别上抛（`taskResults` 保留每个任务的成功值与失败因）。
    // 失败者**不在此抛错**——由调用方按各自的性质处置（`idle-review` 的校验
    // 失败要入待处置队列；其余任务在此基础上另有各自的落地路径）。
    const taskResults = {};
    for (const key of runnable) {
      const outcome = checkedByTask.results[key];
      taskResults[key] = outcome?.ok === true
        ? { ok: true, value: outcome.value }
        : { ok: false, error: outcome?.error ?? { code: "aux_task/unknown_failure", message: "no validation outcome" } };
    }

    // ── 任务级失败**不抛错**，如实返回（这是 §10.2「不使其余任务失效」的实现）──
    //
    // 原实现在这里对 `idle-review` 的校验失败 `throw`，并把其余任务的成功结论挂到
    // `error.partialTaskResults` 上——但**全仓无人消费**该字段（grep 仅一处赋值），
    // 故那句承诺在实现上是空的：调用方拿到异常后只能整条丢弃。
    //
    // 现在改为：基础设施失败（无可用 provider、执行体未正常收束）仍抛错——那是
    // 「整次派发没跑成」；**判断本身不成立**（引证不在材料里、跨字段约束不满足）
    // 属任务级结果，逐任务如实返回，由调用方按任务分别处置。
    const failedTasks = runnable.filter((key) => taskResults[key]?.ok !== true);
    const primary = taskResults["friction-discovery"];

    onRun?.({
      phase: "verdict",
      // `verdict` 仅在 idle-review 成功时给出——失败时如实为 null，**不得**用
      // 其它任务的值冒充（那会让落地侧把一份异质结论当成摩擦判断）。
      verdict: primary?.ok === true ? primary.value.verdict : null,
      turns_in_window: Array.isArray(effectiveWindow?.items) ? effectiveWindow.items.length : 0,
      tasks: [...runnable],
      task_ok: Object.fromEntries(Object.entries(taskResults).map(([k, r]) => [k, r.ok === true])),
      failed_tasks: failedTasks,
    });

    // 全部任务都失败时**仍不抛错**：`taskResults` 已如实载明每件为何失败，调用方
    // 据此逐条入队（比抛一个笼统异常更能说清范围）。这与 §8.3 不矛盾——§8.3 要求
    // 停止并登记，而停止的对象是**失败的那些任务**，不是整次运行。
    return {
      // 执行体自身的权威署名（品牌载体）：落地侧必须用它盖 change_log，不得改用
      // 主控会话的路由（09 §5.1「当次实际」）。为 null 时落地侧须停止并登记，
      // 不得回落——见 signatureFailure 的失败因。
      executorSignature,
      executorSignatureFailure: signatureFailure,
      // 兼容形态：`outcome` 取 idle-review 的结论（成功时）；失败时为 `null`，
      // 使调用方无法把它误当「已产出一条摩擦结论」。
      outcome: primary?.ok === true ? primary.value.verdict : null,
      // 兼容形态：`verdict` 同上。`verdict.verdict` 的双层名是落地侧的既有契约
      // （friction-landing.js 读 `verdict.verdict`），不是笔误。
      verdict: primary?.ok === true ? primary.value : null,
      // **逐任务的成功结论**（键为该任务在登记表里的键）。调用方据此逐任务落地：
      // 摩擦走 friction-landing，经验积累走 experience-landing。**不得**从
      // `verdict` 取非 idle-review 的结论——那是兼容形态，只承载摩擦。
      // 失败的任务不在本表内（其失败因在 `taskResults` 里，调用方按 §8.3 入队）。
      taskVerdicts: Object.fromEntries(
        Object.entries(taskResults)
          .filter(([, r]) => r?.ok === true)
          .map(([k, r]) => [k, r.value]),
      ),
      // 本次区间中**本进程未观察到**的轮次（null = 无缺口）。调用方须如实登记，
      // 不得静默丢弃（复核发现②③）。
      unobserved,
      // 水位推进的**唯一**凭据：本次运行成功完成且（闭集第 5 项）回读通过时，
      // 让水位前进到本次区间终点。未给出即不推进（§8.4 水位段）。
      //
      // **本字段是「本次区间的上界」，其是否被采用由调用方按任务分别决定**——
      // 它**不再**以「本次是否全部任务成功」为条件（那正是缺陷 F-1：见下）。
      //
      // 机械形态：**成功者的水位推进到本上界，失败者的水位不动**。故：
      //   - 给出的条件只是「区间上界可定」（`windowRange.to` 是整数）；
      //   - 调用方对**每个任务**分别判断：该任务本次成功 → 推进到本上界；
      //     该任务失败 → 不推进（那段内容留待下次重覆盖，永不复查的相反面）；
      //   - 各任务写各自的键（`friction-watermark.js` 的按任务水位），互不牵连。
      //
      // ⚠️ **原登记「已解决」曾被轻描淡写（2026-10-14 独立代码审核 F-1，高危）**：
      // 本条原先写「任一任务失败即不推进」，并在下方注释里声称该风险「已由按任务
      // 分别的水位解决」。**那是错的**——存储层确实按任务分了键，但**策略层是全有
      // 或全无**：本字段当时仍以 `failedTasks.length === 0` 为条件，而调用方的落地
      // 闸门同样以它为条件，于是「一件成功、一件失败」时：
      //   ① 成功者的结论**算完即丢**（正是 lifecycle 自己批判的缺陷 D2 形态）；
      //   ② 两个水位**都不推进** → 下轮重覆盖同一区间 → 成功者被再落地一次
      //      （`occurrence.count` 虚增，而它是阈值流转的唯一输入源）。
      // 即：**该修复在唯一需要它的场景里不生效**。现改为上界无条件给出、由调用方
      // 逐任务决定是否采用，并在 lifecycle 侧把落地闸门改为按任务分别判断。
      watermarkTurn: Number.isInteger(windowRange?.to) ? windowRange.to : undefined,
      // 逐任务的结论与失败（多任务派发的产出面）。
      taskResults,
      failedTasks,
      // 已启用但未实现者——调用方须如实登记（04 §8.5）。
      unimplementedTasks: unimplemented,
    };
  };
}
