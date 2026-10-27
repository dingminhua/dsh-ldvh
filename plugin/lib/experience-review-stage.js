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
// 3. **一次派发逐条判定**（§10.2，2026-10-27 修订）：交出的每一条都必须有结论——
//    可成文则建 `draft`，不足则结算为 `discarded`。这条**不在配额上设上限**，因为
//    「每轮只许写 1 条」正是让待审队列永远清不完的原因（Human：「完成一个处理一个，
//    否则很容易变成永远结束不了的任务」）。`MAX_ENTRIES_PER_REVIEW_DISPATCH` 只是
//    一次派发的**交付条数上限**（防提示词无界增长），超出部分留到下一次派发。
//
// ## 失败即 fail-closed（§12）
//
// 任一步失败都如实返回，**不降级**为「跳过审核」或「只记日志」。原因：审核段是
// 机械通道的一部分（§10.2 第 3 项创建 draft），静默跳过会让「缓冲里有材料但从不
// 被审」与「缓冲为空」外观相同。
import { join } from "node:path";

import { reviewPendingEntries, collectExistingPitfalls } from "./observation-review.js";
import { currentRouteValuesForSession } from "./session-signature.js";
import { authoritativeSignature } from "./signature-channel.js";

/** 一次派发最多交付多少条 pending 条目（防提示词无界增长）。 */
export const MAX_ENTRIES_PER_REVIEW_DISPATCH = 12;

/** 事实源根 = 管辖项目根下的 `ldvh-base`（与 lifecycle.js 的落地调用同一约定）。 */
function joinScopeFactSource(projectPath) {
  // 用 path.join 而非模板拼接：Windows 分隔符与重复斜杠都由它处理，手写正则在
  // win32 上会产生 `C:\repo/ldvh-base` 这种混合形态。
  return join(projectPath, "ldvh-base");
}

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
  lines.push("**每一条都必须给出结论**（2026-10-27 修订）：判为可成文就成形为 `draft` 候选，");
  lines.push("判为不足就写成 `insufficient` 并给出带引证的理由（该条会被结算为 `discarded`，");
  lines.push("不入事实对象）。");
  lines.push("");
  lines.push("**不得留下未判的条目**：交出却没给结论的条目会让这一轮直接 fail-closed，");
  lines.push("一条都不会落地——「攒着下次再说」是把待审队列变成永远结束不了的任务。");
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
  lines.push("**每一条待审材料都要有一条结论**。缺任何一条，这一轮整体 fail-closed（一条都不落地）；");
  lines.push("不得以省略代替判断。");
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

/**
 * 把执行体返回的「结论式」提案翻译成 `reviewPendingEntries` 认的**机械形态**。
 *
 * ## 为什么必须有这一步（不是可有可无的兼容层）
 *
 * 提示词要求执行体给的是**三分结论**（`formed` / `duplicate` / `discarded`）——那是它
 * 真正做的判断。而 `reviewPendingEntries` 收的是可以逐项机械校验的字段：`insufficient`
 * （→ discarded）、`dedupe`＋`title/scope/body`（→ 建 draft）。两者形状不同，若不翻译，
 * 执行体每给一条 `discarded` 都会被当成「查重未登记」而 fail-closed——**逐条判定会
 * 因此永远落不了地**，而症状看起来像执行体不守 schema（实测过一次）。
 *
 * 同时把 `dedupe.conclusion` 的 `no-duplicate` 归一为模块内使用的 `new`：前者是对外
 * 措辞，后者是 23 §6.2 的闭集值。
 */
function normalizeProposals(proposals) {
  return proposals.map((proposal) => {
    if (proposal === null || typeof proposal !== "object") return proposal;
    const conclusion = proposal.conclusion;
    const dedupe = proposal.dedupe !== null && typeof proposal.dedupe === "object"
      ? {
          ...proposal.dedupe,
          ...(proposal.dedupe.conclusion === "no-duplicate" ? { conclusion: "new" } : {}),
        }
      : proposal.dedupe;
    if (conclusion === "discarded") {
      // 已经是 insufficient 形态就原样保留（调用方可能直接给了机械形态）。
      if (proposal.insufficient !== undefined && proposal.insufficient !== null) return proposal;
      return { entry_id: proposal.entry_id, insufficient: { reason: proposal.reason ?? "" } };
    }
    if (conclusion === "formed" || conclusion === "duplicate") {
      return { ...proposal, ...(dedupe === undefined ? {} : { dedupe }) };
    }
    return { ...proposal, ...(dedupe === undefined ? {} : { dedupe }) };
  });
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
  //
  // **根必须是 `ldvh-base`，不是项目根**（2026-10-27 修）。`collectExistingPitfalls`
  // 与 `createPitfallObject` 都把 `factSourceRoot` 当**事实源根**用（在它下面直接找
  // `pitfalls/`），而 `scope.project.path` 是**仓库根**。写在仓库根上时目录不存在，
  // `listPitfallObjects` 对 ENOENT 会 `success({items:[]})`——不报错，只是空。
  //
  // 实测（2026-10-27）：错根 items=0，正确根 items=40。后果不是「查重变慢」，而是
  // **查重基线恒为空**：审核段会把每一条都判成「无重复」并成文，§10.2 第 2 项的
  // 查重覆盖（23 §6.2）在结构上等于不存在——而且它**看起来一切正常**（没有报错、
  // 没有缺口记录），正是本仓反复登记的那类「以产物缺席作否定判据」的失效形态。
  // 与 `lifecycle.js` 的两处调用（`join(scope.project.path, "ldvh-base")`）保持一致。
  const factSourceRoot = joinScopeFactSource(scope.project.path);
  let existing;
  try {
    existing = await collectExistingPitfalls({ factSourceRoot });
  } catch (error) {
    record("land-failed", { action: "dedupe-baseline-failed", reason: String(error?.message ?? error) });
    return failure("review_stage/dedupe_baseline_failed", `cannot collect the dedupe baseline: ${String(error?.message ?? error)}`);
  }
  // **读的是 `existing.value.items`，不是 `existing.items`**（2026-10-27 修，第二层缺陷）。
  //
  // `collectExistingPitfalls` 与 `listPitfallObjects` 一样返回 `{ok:true, value:{items}}`
  // ——这是本仓写入/读取模块的统一 envelope。而此处原读 `existing?.items`，恒为
  // `undefined`，于是 `pitfalls` **恒为空数组**：即便事实源根传对了、40 条 Pitfall
  // 全都读到了，对照集在派发前仍被这一步清空。查重覆盖因此**两层各失效一次**，
  // 任何一层单独修好都不会显出效果——这也是它此前没被发现的原因。
  //
  // 该读取形状有测试守着（`experience-review-stage.test.mjs` 的「查重对照集必须从
  // 事实源根读」一例）：断言派发出去的提示词里出现那条既有 Pitfall 的标题，而不是
  // 断言「函数没报错」——错形状与错根都**不报错**。
  const pitfalls = Array.isArray(existing?.value?.items) ? existing.value.items : [];

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
  // **不指定模型**（2026-10-27 Human 要求：去掉「审核模型」设置）。
  //
  // 该设置从未真正生效：`experienceReviewModel` 在设置面能填、能存，但审核执行体
  // 一直按默认路由跑（诊断长期显示 `model: (default route)`）。一个「设了不生效」的
  // 选项比没有更糟——它会让人以为审核用的是自己挑的模型。故整块去掉，审核固定
  // 跟随宿主默认路由，不再有「设了却没作用」的可能。
  //
  // 若将来真要按模型分流，须先解决「哪个模型产生了这个结果」的可核对性——
  // 那正是当初只允许单路由、不做多路由/失败切换的理由。
  const modelApplied = null;
  let activation;
  try {
    activation = await subagents.startActivation({
      provider: picked.value.name,
      label: `ldvh-review ${new Date().toISOString()}`,
      request: {
        prompt: [{ type: "text", text: prompt }],
        parent,
        outputSchema: reviewOutputSchema(),
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
    factSourceRoot,
    existingPitfalls: pitfalls,
    proposals: normalizeProposals(proposals),
    // **本次派发交出的那一批**：批内每条都要判定，批外条目留到下一次派发。
    entryIds: batch.map((entry) => entry.id),
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
  const formedCount = Array.isArray(value.formed_all) ? value.formed_all.length : (value.formed === null ? 0 : 1);
  const outcome = formedCount > 0 || value.discarded.length > 0 ? "landed" : "skipped";
  record(outcome, {
    // 一次派发可能同时成文与废弃——动作名按**两者都发生**的形态如实写，不择一。
    action: formedCount > 0 && value.discarded.length > 0
      ? "judged-all"
      : formedCount > 0
        ? "formed-draft"
        : value.discarded.length > 0
          ? "discarded-entries"
          : "no-entry",
    formed: value.formed,
    formed_all: value.formed_all,
    duplicate: value.duplicate,
    duplicates_all: value.duplicates_all,
    discarded: value.discarded,
    remaining_pending: value.remaining_pending,
    // 用了哪个模型：事后核对「设置的那个模型到底有没有生效」全靠这一项。
    model: modelApplied,
  });
  return { ok: true, value };
}

/**
 * 取执行体署名（provider/model → 品牌化载体）。
 *
 * **取不到就返回 null，不臆造**：署名进 `draft` 的 `change_log`，编一个比没有更糟。
 *
 * ## 2026-10-27 修复：此前恒返回 null
 *
 * 原实现写的是 `sessionPersistence.read?.(childId)`。但宿主的 `sessionPersistence`
 * 服务**没有 `read()` 方法**——它的接口是 `locate(header)` 与 `open(id, "read")`
 * 两步，事件由 `open()` 返回的 handle 的 `read()` 给出。故可选链恒为 `undefined`，
 * 本函数**每次**都返回 null，审核段因此在「第一条要成文的条目」处恒被判
 * `signature_unavailable` 并整体 fail-closed。
 *
 * 实测证据（2026-10-27）：环形痕迹里 `experience-review` 只有两次记录，两次都是
 * 同一条目 651d53aa 的同一失败；经验观察缓冲 23 条**全部**停在 pending，一条都
 * 没被处理。失败看似偶发（时间上像是某次改动之后），实为恒真缺陷。
 *
 * ## 现在的取数通道
 *
 * 复用 `currentRouteValuesForSession(persistence, { id })`——它与
 * `friction-discovery-provider.js` 取**同类**执行体署名走的是同一条通道与同一套
 * 取值纪律（09 §5.1「当次实际」、零清洗）。不在这里另写一套 open/read：
 * 那条纪律只应有一处实现，否则两处会出现「同一执行体两个署名」。
 *
 * 取不到时仍返回 null（不回落主控路由）——那会把执行体的判断盖上主控的章，
 * 恰是 2026-10-16 修掉的缺陷形态。
 */
async function resolveSignature(sessionPersistence, childId) {
  if (sessionPersistence === null || sessionPersistence === undefined) return null;
  if (typeof childId !== "string" || childId.length === 0) return null;
  try {
    // 只认会话标识：宿主正规入口 open(id,'read') 自行定位日志；执行体在结算前
    // 已被 flushFinalState 刷盘，故此刻可读（见 currentRouteValuesForSession 说明）。
    const route = await currentRouteValuesForSession(sessionPersistence, { id: childId });
    if (!route.ok) return null;
    const carrier = authoritativeSignature({ provider: route.value.provider, model: route.value.model });
    if (carrier === null) return null;
    return carrier;
  } catch {
    // 取数通道自身抛错：仍然返回 null（宁可拒写也不臆造），由审核段按其既有
    // fail-closed 路径如实上报。
    return null;
  }
}
