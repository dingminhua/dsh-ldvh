/**
 * dsh-ldvh — 摩擦发现的执行体派生 (specs/04 §8.4 第 1 项，§8.2).
 *
 * 本模块把「派一个受管辖隔离子代理去做语义查重、取回它的结构化判断」这件事
 * 封成一个**注入给 `runIdleCheckpoint` 的 `discover` 提供者**。它是 §8.4 那句
 * 「由受管辖隔离子代理作出语义判断」与宿主 `subagents` 服务之间的唯一接缝。
 *
 * ## 为什么是 `start` 而不是 `startContinuable`（实测依据）
 *
 * `ContinuableStartSpec.request` 的类型是
 * `Omit<SubagentStartRequest, 'label' | 'signal' | 'outputSchema'>`——**`outputSchema`
 * 被列名显式排除**，`startContinuable` 也只返回 `{ childId, messageId }`。而
 * `start(name, request)` 接受 `outputSchema`，且 `await run.result` 返回
 * `SubagentResult.structured`。本机制**不需要可续能力**（每次检查点独立派生、
 * 跑完即结束），但**需要**结构化判断——故取 `start`（2026-10-11 第三次 C2 重批）。
 *
 * ## provider 的选择：必须 `inheritsParentContext === true`（实测依据）
 *
 * §8.4 要求执行体「继承发起会话的主控上下文——用于判断某现象是否构成系统性阻碍」。
 * 实测：`spawn` 的 `inheritsParentContext = false`（源码注释「zero parent
 * context」），`fork` 为 `true`（以父会话日志最后一个 `turn/end` 之前的全部事件为
 * seed）。故本模块**按能力挑选 provider**，而不是硬编码名字——名字可能随宿主
 * 配置变化（`Config.providerName` 可覆盖），而能力是语义要求。
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
import { buildDiscoveryPromptSection, buildSharedPromptSection } from "./friction-subagent-contract.js";
import { buildCompositePrompt, compositeOutputSchema, splitRunnableTasks, validateCompositeOutput } from "./aux-task-registry.js";
import { windowBody } from "./friction-window.js";

/** 服务不可用时的失败（由调用方按 §8.3 入队，不静默降级）。 */
function unavailable(reason) {
  return { ok: false, error: { code: "discovery_provider/unavailable", message: reason } };
}

/**
 * 在已注册的 provider 中挑选**继承父上下文**的那一个。
 *
 * 顺序：优先 `fork`（本宿主实测名），否则取第一个 `inheritsParentContext === true`
 * 的。**没有任何继承上下文的 provider 即不可用**——那会使 §8.4 的输入侧要求落空，
 * 此时**不得**退回 `spawn`（它会得到零上下文的子代理，无从判断「系统性阻碍」）。
 */
export function selectContextInheritingProvider(subagents) {
  let names;
  try {
    names = subagents.list();
  } catch (error) {
    return unavailable(`cannot list subagent providers: ${String(error?.message ?? error)}`);
  }
  if (!Array.isArray(names) || names.length === 0) {
    return unavailable("no subagent provider is registered");
  }

  const inherited = [];
  for (const name of names) {
    let provider;
    try {
      provider = subagents.getProvider(name);
    } catch {
      continue;
    }
    if (provider?.inheritsParentContext === true) inherited.push({ name, provider });
  }
  if (inherited.length === 0) {
    return unavailable(
      `no registered subagent provider inherits the parent context (candidates: ${names.join(", ")}) — 04 §8.4 requires the executor to inherit the initiating context; refusing to fall back to a zero-context provider`,
    );
  }
  // 能力面：需要 outputSchema 才能把判断结果升为机械校验。
  const withSchema = inherited.filter((entry) => entry.provider?.capabilities?.outputSchema !== false);
  const chosen = withSchema.find((entry) => entry.name === "fork") ?? withSchema[0] ?? inherited[0];
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
 * `({ threshold, candidates, sessionSignature, window })`，返回
 * `{ outcome, verdict, watermarkTurn? }` 或抛错（由调用方按 §8.3 入队）。
 */
export function createDiscoveryProvider({ subagents, parent, signal, onRun, provideWindow } = {}) {
  if (subagents === undefined || subagents === null) {
    throw new Error("createDiscoveryProvider requires the host `subagents` service");
  }
  if (parent === undefined || parent === null) {
    throw new Error("createDiscoveryProvider requires the initiating `parent` Agent (04 §8.4: the executor inherits it)");
  }
  if (signal === undefined || signal === null) {
    throw new Error("createDiscoveryProvider requires an AbortSignal (subagents.start requires request.signal)");
  }

  return async function discover({ threshold, candidates, sessionSignature, window: windowRange, tasks: requestedTasks }) {
    // 本次要跑的**全部**任务（有序）。未给出时退回单任务 `idle-review`——保持既有
    // 调用方（测试与诊断路径）无需改造，且它与「只勾选 idle-review」等价。
    //
    // 「已启用」与「已实现」是两件事：设置面可以把三个都勾上，而
    // `capacity-maintenance`/`memory-health` 的**能力本体没有代码**。故这里先按
    // `implemented` 分派——只把已实现的拼进提示词，未实现的交给调用方如实记一条
    // 痕迹（`unimplementedTasks` 随返回值上抛，04 §8.5 条件式要求：不得主张空闲
    // 维护已运行，但也不得静默剔除使 Human 看不出它没做）。
    const wanted = Array.isArray(requestedTasks) && requestedTasks.length > 0 ? requestedTasks : ["idle-review"];
    const { runnable, unimplemented } = splitRunnableTasks(wanted);
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
    // 区间内**没有任何新增内容**、且**没有缺口**时，本就没有观察对象：04 §8.4
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
        note: "本次区间无任何新增内容且无缺口——依 04 §8.4「观察对象=新增内容」无观察对象，未派生执行体",
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
        verdict: { verdict: "no-discovery", quote: "", reason: "本次区间无任何新增内容（04 §8.4：观察对象=自上次运行以来新增的会话内容），故未派生执行体", impact: "light" },
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
      };
    }

    const picked = selectContextInheritingProvider(subagents);
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
      if (key === "idle-review") {
        sections[key] = buildDiscoveryPromptSection({ threshold, candidates });
      } else {
        // 走到这里说明登记表说它「已实现」却没有任务段构造器——登记不完整。
        // 抛错而不静默跳过：静默跳过会使该任务「被启用、却从未被要求作答」，
        // 而输出里它仍占一个字段（恒为空），与「它答了没有发现」无从区分。
        const error = new Error(`aux task "${key}" is marked implemented but has no prompt section builder`);
        error.code = "discovery_provider/incomplete_registry";
        throw error;
      }
    }
    const prompt = buildCompositePrompt({
      tasks: runnable,
      sections,
      shared: buildSharedPromptSection({ window: effectiveWindow, taskCount: runnable.length }),
    });
    const outputSchema = compositeOutputSchema(runnable);

    onRun?.({
      phase: "start",
      provider: picked.value.name,
      window: { from: windowRange?.from ?? null, to: windowRange?.to ?? null, turns: Array.isArray(effectiveWindow?.items) ? effectiveWindow.items.length : 0, truncated: effectiveWindow?.truncated === true },
      candidates: candidates?.length ?? 0,
      // 本次要求作答的任务清单——使「派了几件」与「收了几件」可在痕迹里核对。
      tasks: [...runnable],
      unimplemented_tasks: [...unimplemented],
    });

    // `start` 的失败（能力不符、provider 缺失、语义检查不过）会直接 reject，且
    // 不留 run 供释放——故这里不 try/finally dispose，按返回的 run 处理。
    const run = await subagents.start(picked.value.name, {
      label: "ldvh-friction-discovery",
      prompt: [{ type: "text", text: prompt }],
      parent,
      signal,
      outputSchema,
    });

    onRun?.({ phase: "started", provider: picked.value.name, runId: run?.id });

    let result;
    try {
      result = await run.result;
    } finally {
      // run 由持有者负责释放（服务文档：holder-owned）。释放失败不掩盖结果。
      try {
        await run.dispose?.();
      } catch {
        /* dispose 失败不影响已取回的结果；下一次运行会重新派生。 */
      }
    }

    onRun?.({ phase: "result", provider: picked.value.name, runId: run?.id, stopReason: result?.stopReason });

    // 非正常收束：把 stopReason 如实上抛，由调用方按 §8.3 入队（不伪造结论）。
    if (result?.stopReason !== "completed") {
      const error = new Error(`subagent run did not complete (stopReason=${String(result?.stopReason)}${result?.diagnostic ? `, diagnostic=${result.diagnostic}` : ""})`);
      error.code = "discovery_provider/incomplete_run";
      throw error;
    }

    // ── 逐任务校验（本设计的核心承诺：一件不过不掀掉其余件）──────────────
    //
    // 宿主已按复合 schema 在**提交层**拦过一次（保证每个任务字段都存在、形状对）；
    // 这里校验**跨字段**约束（same-obstacle 必须带 target_uid 且 uid 在候选内、
    // 引证须真在窗口内等）——那是宿主支持的 JSON Schema 子集表达不了的，见
    // friction-subagent-contract.js。
    //
    // **为什么逐任务收口**：04 §8.4 的闭集动作按任务分别成立——`idle-review` 的
    // 引证不成立不影响「容量维护该压缩哪些条目」这类结论。整体失败会使一次可用的
    // 运行被整条丢弃，而那正是「一次做多件」最该避免的损失。
    const checkedByTask = validateCompositeOutput(result?.structured, {
      tasks: runnable,
      contexts: Object.fromEntries(
        runnable.map((key) => [key, { candidates: candidates ?? [], windowText }]),
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
    const primary = taskResults["idle-review"];

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
      // 兼容形态：`outcome` 取 idle-review 的结论（成功时）；失败时为 `null`，
      // 使调用方无法把它误当「已产出一条摩擦结论」。
      outcome: primary?.ok === true ? primary.value.verdict : null,
      // 兼容形态：`verdict` 同上。`verdict.verdict` 的双层名是落地侧的既有契约
      // （friction-landing.js 读 `verdict.verdict`），不是笔误。
      verdict: primary?.ok === true ? primary.value : null,
      // 本次区间中**本进程未观察到**的轮次（null = 无缺口）。调用方须如实登记，
      // 不得静默丢弃（复核发现②③）。
      unobserved,
      // 水位推进的**唯一**凭据：本次运行成功完成且（闭集第 5 项）回读通过时，
      // 让水位前进到本次区间终点。未给出即不推进（§8.4 水位段）。
      //
      // **任一任务失败即不推进**——沿用既有的水位纪律（「落地失败即本次未产出，
      // 窗口必须留待下次重覆盖」，见 idle-checkpoint 的说明）。宁可下次重覆盖，
      // 也不把未入账的内容标记为已处理（后者使那段内容**永不复查**，而宿主只
      // 发布事件、不回放）。
      //
      // ⚠️ **已知残留风险（如实登记）**：多任务下若「一件成功、一件失败」，不推进
      // 会使下次重覆盖同一区间，于是**已成功那件会被再落地一次**（`occurrence.count`
      // 被虚增，而它是阈值流转的唯一输入源）。该情形**当前不可达**——只有
      // `idle-review` 已实现，`runnable` 恒为单元素。落地第二个任务时必须一并
      // 解决（可行方向：按任务分别记录已处理区间，使重覆盖只针对失败者）。
      // 不在此处静默取「推进」：那会用一个错误换另一个错误，且更难察觉。
      watermarkTurn: failedTasks.length === 0 && Number.isInteger(windowRange?.to)
        ? windowRange.to
        : undefined,
      // 逐任务的结论与失败（多任务派发的产出面）。
      taskResults,
      failedTasks,
      // 已启用但未实现者——调用方须如实登记（04 §8.5）。
      unimplementedTasks: unimplemented,
    };
  };
}
