/**
 * dsh-ldvh — 摩擦发现的子代理契约：提示词与结构化输出 schema
 *   (specs/04 §8.4 第 1 项的语义判断，经宿主 outputSchema 承载).
 *
 * 权威与边界：specs/04 §8.4、§8.2。本模块**只承载两样东西**——
 *
 *   1. 交给派生出的受管辖隔离子代理的**提示词**（它继承发起会话的主控上下文，
 *      据此判断某现象是否构成系统性阻碍）；
 *   2. 它的**结构化输出 schema**（由宿主在提交层强制，见下）。
 *
 * 本模块**不做判断、不碰账本、不写文件**：判断由子代理（LLM）做出，落地由
 * friction-discovery.js 的闭集完成，本模块在两者之间只提供契约文本。
 *
 * ## 为什么用 outputSchema
 *
 * specs/04 §8.4 第 1 项的语义查重按 §8.2 第 1 条后半句**不由机械校验保障**——
 * 它是登记为 gap 的语义判断。但「子代理按结构提交」这件事**可以**升为机械校验：
 * 宿主 `outputSchema` 在**提交层**强制（实测 2026-10-11：越界的枚举值、多余字段
 * 都交不出来；不合规对象根本到不了调用方）。故本 schema 把三态与各态必填字段
 * 做成机械可判，使「子代理说了什么」至少形状可信。
 *
 * **本 schema 不保证判断正确**：它只管字段名、枚举、必填性与类型。把
 * `verdict` 填成 `same-obstacle` 而实际是另一件阻碍，schema 一律放行——那是
 * 语义误判，属 §8.4 第 2 项「反向护栏」登记的已知失效面（处置为按 26 §17 第 6
 * 项撤销误判递增）。**不得据本 schema 的通过主张判断内容可靠。**
 */

/** 三态判断的闭集（schema 的 `enum` 与下方校验共用同一来源，防二者漂移）。 */
export const VERDICTS = Object.freeze(["same-obstacle", "new-obstacle", "no-discovery"]);

/**
 * 给子代理的结构化输出 schema。
 *
 * 形状为 object root，只用宿主支持的 JSON Schema 子集（type / properties /
 * required / additionalProperties / items / enum / description）——JSON Schema
 * 扩展（oneOf 跨态约束、$ref 等）不在此列，故三态**各自的必填字段**用
 * `description` 说明 + 落地侧校验承载，而不是靠条件 schema（那些不被支持）。
 */
export function discoveryOutputSchema() {
  return {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: [...VERDICTS],
        description:
          "三态之一：same-obstacle=本次观察与既有某条账目是同一阻碍；new-obstacle=构成本账本尚未记录的阻碍；no-discovery=本次新增内容中没有构成系统性阻碍的现象。",
      },
      target_uid: {
        type: "string",
        description:
          "verdict=same-obstacle 时必填：被命中的既有账目 object_uid（UUIDv4）。其余两态填空字符串。",
      },
      title: {
        type: "string",
        description:
          "verdict=new-obstacle 时必填：阻碍的短标题（≤30 字）。其余两态填空字符串。",
      },
      phenomenon: {
        type: "string",
        description:
          "verdict=new-obstacle 时必填：单句现象陈述（非结论，如「CI 平均 8 分钟」而非「CI 太慢」）。其余两态填空字符串。",
      },
      basis: {
        type: "string",
        description:
          "verdict=new-obstacle 时必填：入账依据（可归因性 + 修了会更好的预期）。其余两态填空字符串。",
      },
      impact: {
        type: "string",
        enum: ["light", "medium", "heavy"],
        description:
          "verdict=new-obstacle 时必填：影响评级。其余两态填 \"light\"（占位，落地侧按 verdict 忽略）。",
      },
      reason: {
        type: "string",
        description:
          "必填：判定理由——你依据本次区间的哪些内容得出该 verdict。必须指回本次区间，不得泛泛而谈。",
      },
    },
    required: ["verdict", "target_uid", "title", "phenomenon", "basis", "impact", "reason"],
    additionalProperties: false,
  };
}

/**
 * 组装交给子代理的提示词（§8.4 执行体：继承主控上下文作出判断）。
 *
 * 参数（全部为**机械前提**，由调度方提供，不得由子代理自行取得）：
 *   - `threshold`：固定阈值 N（04 §8.4 内嵌为 3）；
 *   - `candidates`：既有 `open`/`observing` 账目的候选投影（uid/title/phenomenon/status）；
 *   - `window`：本次运行的**水位区间**（自上次成功运行以来新增的会话内容范围）。
 *     其取值只来自宿主会话记录的位置标识（§8.4「观察范围的切分」）——
 *     **不由子代理判断哪些是新的**，它只在该区间内作判断。
 *
 * 提示词明确三件约束，逐条对应规范：
 *   ① 只判断区间内的内容（§8.4 水位段：防同一段内容被反复计数）；
 *   ② 不做价值判断、不决定修不修（§8.4「必须外送 Human 的判断项」+ §8.2 第 2 条）；
 *   ③ 产出经结构化工具提交（宿主 outputSchema 强制，非文本约定）。
 */
export function buildDiscoveryPrompt({ threshold, candidates = [], window: windowRange } = {}) {
  const list = candidates.length === 0
      ? "（本账本当前没有 open/observing 账目——任何新发现的阻碍都只能是 new-obstacle）"
      : candidates
          .map((c) => `- uid=${c.object_uid} [${c.status}] ${c.title}｜现象：${c.phenomenon ?? "（未投影）"}`)
          .join("\n");

  const windowText = windowRange === undefined || windowRange === null
      ? "（本次运行区间由调度方给出；若未给出，按你可见的最近一轮为界，并在 reason 中声明你采用的边界）"
      : typeof windowRange === "string"
          ? windowRange
          : `自 ${windowRange.from ?? "上次成功运行"} 至 ${windowRange.to ?? "本次检查点"}`;

  return [
    "你是 LDVH 的**摩擦发现执行体**（specs/04 §8.4 派生的受管辖隔离子代理）。",
    "你继承发起会话的主控上下文，据此判断：本次区间内出现的内容中，是否存在**系统性阻碍**（即会反复出现、值得记进摩擦账本的工作流障碍）。",
    "",
    "## 你只能做判断，不能做决定",
    "本机制**没有主控**，你的产出**不取得授权或完成效力**（04 §8.2 第 4 条），也不得产生需要 Human 决定的结论（§8.2 第 2 条）。",
    "具体地：你**不得**判断某笔摩擦「值不值得修」「要不要销账」「要不要废弃」，也不得改影响评级——那些是必须外送 Human 的判断项（§8.4）。",
    "你只回答一个问题：**本次区间内的内容，与下面这张既有账本比对，属于三态中的哪一态。**",
    "",
    "## 你必须遵守的区间边界",
    `本次运行的观察区间是：${windowText}`,
    "**你只对该区间内的新增内容作判断。**区间之外的内容即使包含明显阻碍，也不得据此入账——它要么已由上一次运行处理过，要么属于更早的历史（04 §8.4「观察范围的切分（水位）」段）。",
    "若你无法确定区间边界，**在 reason 中如实声明**你采用的边界，不要默默扩大范围。",
    "",
    "## 既有账本（查重比对对象）",
    list,
    "",
    `## 阈值与三态`,
    `本账本的阈值固定为 N=${threshold}：某条账目 occurrence.count 达到该值时才会由机械通道从 observing 转为 open。**你不需要也不得自己数 count**——计数与流转由机械层完成。`,
    "判定的三态：",
    "- `same-obstacle`：本次区间的内容与**既有某条账目**是同一阻碍 → 必填 `target_uid`（该账目的 uid）。",
    "- `new-obstacle`：本次区间的内容构成一个**账本尚未记录**的阻碍 → 必填 `title`/`phenomenon`/`basis`/`impact`。",
    "- `no-discovery`：本次区间内**没有**构成系统性阻碍的现象 → 其余字段填空字符串（`impact` 填 \"light\" 占位）。",
    "",
    "## 产出方式",
    "用结构化输出工具提交你的结论。**不要用纯文本作答**——只有工具提交算数。",
    "字段必须符合给定 schema：三态各自的必填字段见字段说明；不合规的对象**交不出来**（宿主在提交层拦截）。",
    "`reason` 必须指回本次区间：说明你依据区间内的哪些内容得出该 verdict。",
  ].join("\n");
}

/**
 * 对子代理的结构化结论做**落地前校验**（§8.4 第 6 项：未通过即 fail-closed）。
 *
 * 为什么宿主已有 schema 校验、这里还要再校验一遍：schema 保证的是**形状**，
 * 而「三态各自的必填字段」是**跨字段的语义约束**（例如 same-obstacle 必须带
 * target_uid 且该 uid 应在候选内），宿主支持的 schema 子集里没有条件约束
 * （无 oneOf/if-then 的可用面），故这一层只能由落地侧承担。
 *
 * 返回 `{ ok: true, value }` 或 `{ ok: false, error }`。
 */
export function validateDiscoveryVerdict(structured, { candidates = [] } = {}) {
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  if (typeof structured !== "object" || structured === null) {
    return failure("discovery/verdict_malformed", `structured output is not an object (got ${JSON.stringify(structured)})`);
  }
  const { verdict, target_uid: targetUid, title, phenomenon, basis, impact, reason } = structured;

  if (!VERDICTS.includes(verdict)) {
    return failure("discovery/verdict_out_of_set", `verdict ${JSON.stringify(verdict)} is not in the closed set ${JSON.stringify([...VERDICTS])}`);
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return failure("discovery/reason_missing", "reason is required and must be non-empty (it must point back to this run's window)");
  }

  if (verdict === "same-obstacle") {
    if (typeof targetUid !== "string" || targetUid.trim().length === 0) {
      return failure("discovery/target_uid_missing", "verdict=same-obstacle requires a non-empty target_uid");
    }
    // 命中的目标必须在**本次交给它的候选**之内：防它凭空指向一条本次没见的账目
    // （那会使落地侧无从核对，且绕开「只作用于本次运行读取到的账目」的边界）。
    const known = candidates.some((c) => c.object_uid === targetUid.trim());
    if (!known) {
      return failure(
        "discovery/target_uid_unknown",
        `target_uid ${JSON.stringify(targetUid)} is not among the candidates supplied this run (${candidates.length} supplied) — a verdict may only point at a ledger entry it was shown`,
      );
    }
  }

  if (verdict === "new-obstacle") {
    for (const [field, value] of [["title", title], ["phenomenon", phenomenon], ["basis", basis]]) {
      if (typeof value !== "string" || value.trim().length === 0) {
        return failure(`discovery/${field}_missing`, `verdict=new-obstacle requires a non-empty ${field}`);
      }
    }
    if (!["light", "medium", "heavy"].includes(impact)) {
      return failure("discovery/impact_out_of_set", `verdict=new-obstacle requires impact in light/medium/heavy (got ${JSON.stringify(impact)})`);
    }
    if (title.trim().length > 30) {
      return failure("discovery/title_too_long", `title must be ≤ 30 characters (got ${title.trim().length}) — 26 §8`);
    }
  }

  return { ok: true, value: { verdict, target_uid: targetUid?.trim?.() ?? "", title: title?.trim?.() ?? "", phenomenon: phenomenon?.trim?.() ?? "", basis: basis?.trim?.() ?? "", impact, reason: reason.trim() } };
}
