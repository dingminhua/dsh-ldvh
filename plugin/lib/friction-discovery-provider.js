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

import { buildDiscoveryPrompt, discoveryOutputSchema, validateDiscoveryVerdict } from "./friction-subagent-contract.js";
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

  return async function discover({ threshold, candidates, sessionSignature, window: windowRange }) {
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

    const picked = selectContextInheritingProvider(subagents);
    if (!picked.ok) {
      const error = new Error(picked.error.message);
      error.code = picked.error.code;
      throw error;
    }

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
    const unobserved = effectiveWindow?.unobserved ?? null;

    const prompt = buildDiscoveryPrompt({ threshold, candidates, window: effectiveWindow });
    const outputSchema = discoveryOutputSchema();

    onRun?.({
      phase: "start",
      provider: picked.value.name,
      window: { from: windowRange?.from ?? null, to: windowRange?.to ?? null, turns: Array.isArray(effectiveWindow?.items) ? effectiveWindow.items.length : 0, truncated: effectiveWindow?.truncated === true },
      candidates: candidates?.length ?? 0,
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

    // 结构化校验（宿主已按 schema 在提交层拦过一次；这里校验**跨态**必填字段，
    // 那是宿主支持的 schema 子集表达不了的，见 friction-subagent-contract.js）。
    const checked = validateDiscoveryVerdict(result?.structured, {
      candidates: candidates ?? [],
      // 提供窗口文本即启用「逐字引证须真在窗口内」的机械核对（D1）。
      windowText,
    });
    if (!checked.ok) {
      const error = new Error(`the subagent's structured verdict failed the landing-side checks: ${checked.error.message}`);
      error.code = checked.error.code;
      throw error;
    }

    const verdict = checked.value;
    onRun?.({
      phase: "verdict",
      provider: picked.value.name,
      verdict: verdict.verdict,
      turns_in_window: Array.isArray(effectiveWindow?.items) ? effectiveWindow.items.length : 0,
    });

    return {
      outcome: verdict.verdict,
      verdict,
      // 本次区间中**本进程未观察到**的轮次（null = 无缺口）。调用方须如实登记，
      // 不得静默丢弃（复核发现②③）。
      unobserved,
      // 水位推进的**唯一**凭据：本次运行成功完成且（闭集第 5 项）回读通过时，
      // 让水位前进到本次区间终点。未给出即不推进（§8.4 水位段）。
      watermarkTurn: Number.isInteger(windowRange?.to) ? windowRange.to : undefined,
    };
  };
}
