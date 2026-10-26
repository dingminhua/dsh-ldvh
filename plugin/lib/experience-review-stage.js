// dsh-ldvh — 经验审核段的**派发与落盘**（11 §10.2，2026-10-26）。
//
// ## 这个文件补的是什么
//
// `observation-review.js` 已经有 `reviewPendingEntries`：它负责读缓冲、校验提案、
// 建 draft、结算条目——**全部机械部分**。缺的是「谁来做那个语义判断」，即：
//
//   派生一个零上下文执行体 → 把缓冲投影交给它 → 收它的结构化提案 → 交给
//   `reviewPendingEntries` 落盘
//
// 本文件就是这一段。它**不做判断**，也不碰事实对象：判断在执行体，落盘在
// `reviewPendingEntries`。这样「谁写了什么」在代码结构上就是分开的。
//
// ## 三条硬纪律
//
// 1. **零上下文派生**（§7.1 / §10.2 第 1 项）：执行体以 spawn 形态派生，判断所需
//    输入全部由本模块**机械交付**（§11 切分要求）。故挑选 provider 时只接受
//    `inheritsParentContext === false`——**拒绝**退化为继承父上下文（那等于全量交付，
//    且执行体输入随会话增长单调扩大）。
// 2. **审核段不读实时对话**（§10.2 第 1 项）：本模块交给执行体的**只有缓冲投影与
//    既有账本投影**，不传区间材料、不传会话正文。这是结构性的——它拿不到的东西
//    它就偷不走。
// 3. **一次运行至多 1 条候选**（§10.2）：配额由 `reviewPendingEntries` 强制，本模块
//    不放大它（不传 quota 类参数，因为该函数不接受）。
//
// ## 失败即 fail-closed（§12）
//
// 任一步失败都如实返回，**不降级**为「跳过审核」或「只记日志」。原因：审核段是
// 机械通道的一部分（§10.2 第 3 项创建 draft），静默跳过会让「缓冲里有材料但从不
// 被审」与「缓冲为空」外观相同。
import { reviewPendingEntries, collectExistingPitfalls } from "./observation-review.js";

/** 一次派发最多交付多少条 pending 条目（防提示词无界增长）。 */
export const MAX_ENTRIES_PER_REVIEW_DISPATCH = 12;

function failure(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

/**
 * 组装审核段给执行体的提示词。
 *
 * **只含缓冲投影与既有对象投影**，不含：会话正文、区间材料、水位、任何 evidence
 * 之外的原文。`evidence` **必须**交付（审核段要据它判「够不够成文」，且 draft 正文
 * 须复制逐字引证——§12bis「证据不留在缓冲」）。
 */
export function buildReviewPrompt({ entries, existingPitfalls, projectId }) {
  const lines = [];
  lines.push("# 经验审核（11 §10.2）");
  lines.push("");
  lines.push(`项目：${projectId}`);
  lines.push("");
  lines.push("## 你要做的事");
  lines.push("");
  lines.push("留观缓冲里有一批**待审核的经验材料**。逐条判断它是否已构成一条可成文的经验");
  lines.push("（即「某个失败机制 + 它为何发生 + 怎么解决/规避」三条都已可写）。");
  lines.push("");
  lines.push("**一次至多形成 1 条候选**。其余条目原样留 pending，不要为了「多写几条」而凑。");
  lines.push("");
  lines.push("## 待审材料");
  lines.push("");
  if (entries.length === 0) {
    lines.push("（无待审条目）");
  } else {
    for (const entry of entries) {
      lines.push(`### 条目 ${entry.id}`);
      lines.push("");
      lines.push(`- 现象：${entry.phenomenon}`);
      lines.push(`- 来源：${entry.anchor}（会话 ${entry.session}）`);
      lines.push(`- 待审问题：${entry.candidate_question}`);
      lines.push("- 逐字引证：");
      lines.push("");
      lines.push("```");
      lines.push(entry.evidence);
      lines.push("```");
      lines.push("");
    }
  }
  lines.push("## 既有对照集（查重必用，23 §6.2）");
  lines.push("");
  if (existingPitfalls.length === 0) {
    lines.push("（当前没有任何 active 或 draft 的 Pitfall）");
  } else {
    for (const item of existingPitfalls) {
      lines.push(`- ${item.object_uid} ｜ ${item.status} ｜ ${item.title}`);
    }
  }
  lines.push("");
  lines.push("## 输出要求");
  lines.push("");
  lines.push("对**每一条**待审材料给出结论：");
  lines.push("");
  lines.push("- `formed`：可成文。须给 `title`／`scope`／`body`（七段正文），且正文里");
  lines.push("  **必须复制该条的逐字引证**（不得只写「见缓冲」——缓冲可淘汰，draft 须长期可核）；");
  lines.push("  还须给 `dedupe`：你对查重做了没有、比对了哪些对象、结论是什么。");
  lines.push("- `duplicate`：与既有对象重复。须给 `dedupe.duplicate_of`（上面清单里的 object_uid）。");
  lines.push("- `discarded`：不足以成文。须给理由，且理由里**带上该条的引证片段**（可追溯的处置）。");
  lines.push("");
  lines.push("**未给出结论的条目**原样留在缓冲（缺省即不形成候选）——不得以省略代替判断。");
  return lines.join("\n");
}

/** 执行体必须返回的结构（`outputSchema` 的最小形状）。 */
export function reviewOutputSchema() {
  return {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            entry_id: { type: "string" },
            conclusion: { type: "string", enum: ["formed", "duplicate", "discarded"] },
            title: { type: "string" },
            scope: { type: "string" },
            body: { type: "string" },
            reason: { type: "string" },
            dedupe: {
              type: "object",
              properties: {
                checked: { type: "boolean" },
                compared: { type: "array", items: { type: "string" } },
                conclusion: { type: "string", enum: ["no-duplicate", "duplicate"] },
                duplicate_of: { type: "string" },
              },
              required: ["checked", "compared", "conclusion"],
            },
          },
          required: ["entry_id", "conclusion"],
        },
      },
    },
    required: ["proposals"],
  };
}

/** 挑选零上下文 provider；没有就 fail-closed（不得退化为继承父上下文）。 */
function pickZeroContextProvider(subagents) {
  let names = [];
  try {
    names = subagents.list();
  } catch (error) {
    return failure("review_stage/provider_list_failed", `cannot list subagent providers: ${String(error?.message ?? error)}`);
  }
  if (!Array.isArray(names) || names.length === 0) {
    return failure("review_stage/no_subagent_provider", "no subagent provider is registered");
  }
  const candidates = [];
  for (const name of names) {
    let provider;
    try {
      provider = subagents.getProvider(name);
    } catch {
      continue;
    }
    if (provider?.inheritsParentContext === false) candidates.push({ name, provider });
  }
  if (candidates.length === 0) {
    return failure(
      "review_stage/no_zero_context_provider",
      `no registered subagent provider is zero-context (candidates: ${names.join(", ")}) — 11 §10.2 第 1 项 requires zero-context spawn with scheduler-delivered bounded material; refusing to fall back to a context-inheriting provider`,
    );
  }
  return { ok: true, value: candidates.find((c) => c.provider?.capabilities?.outputSchema !== false) ?? candidates[0] };
}

/** 从执行体结果取结构化判断。 */
function structuredOf(result) {
  if (result === undefined || result === null) return null;
  if (typeof result.structured === "object" && result.structured !== null) return result.structured;
  return null;
}

/**
 * 跑一次审核段。
 *
 * @param {object} args
 * @param {object} args.subagents - 宿主 subagents 服务
 * @param {object} args.parent - 发起会话的 Agent
 * @param {object} args.scope - 治理范围（须 governed）
 * @param {object} args.lifecycle - 用于取 activity 记账
 * @param {object} [args.taskOutcomes] - 结果写入处（`experience-review` 键）
 * @param {Function} [args.dshHomePath] - 缓冲载体路径拼接器
 * @returns {Promise<{ok:true,value:object}|{ok:false,error:object}>}
 */
export async function runReviewStage({
  subagents, parent, scope, lifecycle, taskOutcomes = {}, dshHomePath, sessionPersistence = null,
  model = null,
}) {
  const activity = lifecycle?.activity;
  const record = (outcome, extra = {}) => {
    const value = { outcome, ...extra };
    taskOutcomes["experience-review"] = value;
    activity?.record("review/stage", value);
    return value;
  };

  if (scope?.state !== "governed" || scope?.project === undefined || scope?.project === null) {
    return failure("review_stage/not_governed", "the review stage runs only in a governed project (11 §10.2 第 1 项)");
  }
  if (dshHomePath === undefined || typeof dshHomePath !== "function") {
    record("skipped", { reason: "no buffer home wired" });
    return failure("review_stage/no_home", "dshHomePath is required to read the observation buffer");
  }

  // ── 1. 取待审条目与对照集 ──────────────────────────────────────────────
  let existing;
  try {
    existing = await collectExistingPitfalls({ factSourceRoot: scope.project.path });
  } catch (error) {
    record("land-failed", { action: "dedupe-baseline-failed", reason: String(error?.message ?? error) });
    return failure("review_stage/dedupe_baseline_failed", `cannot collect the dedupe baseline: ${String(error?.message ?? error)}`);
  }
  const pitfalls = Array.isArray(existing?.items) ? existing.items : [];

  // 派发前先看有没有活可干——没有就不派生执行体（省成本，且「空跑」会留下
  // 一条没有任何判断产出的运行记录，读数时反而像出错）。
  const { readBufferEntries } = await import("./observation-buffer.js");
  const peek = await readBufferEntries(dshHomePath, { status: "pending", projectId: scope.project.id });
  if (!peek.ok) {
    // §12bis 纪律 4：缓冲不可读即 fail-closed，不得降级为空集合。
    record("land-failed", { action: "buffer-unreadable", reason: peek.error?.code ?? "unknown" });
    return failure("review_stage/buffer_unreadable", `the observation buffer cannot be read: ${peek.error?.message ?? "unknown"}`);
  }
  const pending = peek.value.items;
  if (pending.length === 0) {
    record("skipped", { action: "empty-buffer", pending: 0 });
    return { ok: true, value: { outcome: "skipped", formed: null, pending: 0 } };
  }

  // ── 2. 挑 provider（零上下文）────────────────────────────────────────
  const picked = pickZeroContextProvider(subagents);
  if (!picked.ok) {
    record("land-failed", { action: "no-provider", reason: picked.error.code });
    return picked;
  }

  // ── 3. 派生执行体 ───────────────────────────────────────────────────
  const batch = pending.slice(0, MAX_ENTRIES_PER_REVIEW_DISPATCH);
  const prompt = buildReviewPrompt({
    entries: batch,
    existingPitfalls: pitfalls.map((item) => ({
      object_uid: item.object_uid,
      title: item.title,
      status: item.status,
    })),
    projectId: scope.project.id,
  });
  const controller = new AbortController();
  // **模型指定**（2026-10-26 Human 要求）：`request.agentOptions` 是宿主给子代理
  // 指定路由的**唯一**入口（`AgentOptions = { provider?, model?, reasoningEffort?,
  // maxTokens? }`）。不传则继承主控会话的模型。
  //
  // **只在 provider 明确支持时传**（`capabilities.agentOptions`）：有的 provider
  // 不认这个字段，硬传会被它忽略或报错——忽略更危险，因为设置面上会显示「已指定
  // 某模型」而实际仍跑默认。故先查能力，不支持就**如实登记并未生效**。
  let agentOptions;
  let modelApplied = null;
  if (model !== null && model !== undefined) {
    const supported = picked.value.provider?.capabilities?.agentOptions === true;
    if (supported) {
      agentOptions = { provider: model.provider, model: model.model };
      // 推理强度：可选（`AgentOptions.reasoningEffort`）。只在用户显式选了才带，
      // 否则交给模型自身的默认档——凭空调成 high/low 会改变结果而不易察觉。
      if (typeof model.reasoningEffort === "string" && model.reasoningEffort.length > 0) {
        agentOptions.reasoningEffort = model.reasoningEffort;
      }
      modelApplied = typeof model.reasoningEffort === "string" && model.reasoningEffort.length > 0
        ? `${model.provider}/${model.model}#${model.reasoningEffort}`
        : `${model.provider}/${model.model}`;
    } else {
      activity?.record("review/model-unsupported", {
        requested: `${model.provider}/${model.model}`,
        provider: picked.value.name,
        reason: "provider does not accept agentOptions, so the requested model would be ignored",
      });
    }
  }
  let activation;
  try {
    activation = await subagents.startActivation({
      provider: picked.value.name,
      label: `ldvh-review ${new Date().toISOString()}`,
      request: {
        prompt: [{ type: "text", text: prompt }],
        parent,
        outputSchema: reviewOutputSchema(),
        ...(agentOptions === undefined ? {} : { agentOptions }),
      },
      signal: controller.signal,
      delivery: "caller",
    });
  } catch (error) {
    record("land-failed", { action: "dispatch-threw", reason: String(error?.message ?? error) });
    return failure("review_stage/dispatch_failed", `the review executor could not be started: ${String(error?.message ?? error)}`);
  }

  let result;
  try {
    result = await activation?.result;
  } catch (error) {
    record("land-failed", { action: "executor-error", reason: String(error?.message ?? error) });
    return failure("review_stage/executor_error", `the review executor failed: ${String(error?.message ?? error)}`);
  }

  // ── 4. 取结构化提案 ─────────────────────────────────────────────────
  const structured = structuredOf(result);
  const proposals = Array.isArray(structured?.proposals) ? structured.proposals : null;
  if (proposals === null) {
    // 执行体没给可解析的提案就**不落盘**——缺省不得代替材料判断（§10.2 第 5 项）。
    record("land-failed", { action: "no-proposals", stopReason: result?.stopReason ?? null });
    return failure(
      "review_stage/no_proposals",
      `the review executor returned no structured proposals (stopReason=${JSON.stringify(result?.stopReason ?? null)}); nothing was written and every entry stays pending`,
    );
  }

  // ── 5. 交给 reviewPendingEntries 落盘（机械部分）─────────────────────
  const signature = await resolveSignature(sessionPersistence, activation?.childId);
  const reviewed = await reviewPendingEntries({
    dshHomePath,
    factSourceRoot: scope.project.path,
    existingPitfalls: pitfalls,
    proposals,
    sessionSignature: signature,
    projectId: scope.project.id,
  });
  if (!reviewed.ok) {
    record("land-failed", {
      action: reviewed.error?.code ?? "review-failed",
      reason: reviewed.error?.message ?? "unknown",
    });
    return reviewed;
  }
  const value = reviewed.value;
  const outcome = value.formed !== null ? "landed" : (value.discarded.length > 0 ? "landed" : "skipped");
  record(outcome, {
    action: value.formed !== null ? "formed-draft" : (value.discarded.length > 0 ? "discarded-entries" : "no-candidate"),
    formed: value.formed,
    duplicate: value.duplicate,
    discarded: value.discarded,
    remaining_pending: value.remaining_pending,
    // 用了哪个模型：事后核对「设置的那个模型到底有没有生效」全靠这一项。
    model: modelApplied,
  });
  return { ok: true, value };
}

/**
 * 取执行体署名（provider/model）。
 *
 * **取不到就返回 null，不臆造**：署名进 `draft` 的 `change_log`，编一个比没有更糟。
 * `sessionPersistence` 未装配时直接返回 null 并如实登记。
 */
async function resolveSignature(sessionPersistence, childId) {
  if (sessionPersistence === null || sessionPersistence === undefined) return null;
  if (typeof childId !== "string" || childId.length === 0) return null;
  try {
    const record = await sessionPersistence.read?.(childId);
    const provider = record?.header?.provider ?? record?.provider;
    const model = record?.header?.model ?? record?.model;
    if (typeof provider === "string" && typeof model === "string") return { provider, model };
    return null;
  } catch {
    return null;
  }
}
