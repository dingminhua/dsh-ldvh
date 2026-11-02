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
import { isUnderArchivedLineage } from "./archived-lineage.js";
import { FRICTION_OBSERVATION_THRESHOLD_N } from "./friction-observation-buffer.js";

/** 一次派发最多交付多少条 pending 条目（防提示词无界增长）。 */
export const MAX_ENTRIES_PER_REVIEW_DISPATCH = 12;

/**
 * 执行体结算的等待上限（毫秒）。
 *
 * **为什么需要它**（2026-10-31，C 的第二半）：外层 `runReviewExclusive` 的 `finally`
 * 要等 `fn()` 返回才释放文件锁，而 `fn()` 里 `await activation.result` 会一直等到
 * 执行体结算。实测有一次执行体被宿主的归档门禁 `blocked`（`stopReason: refusal`），
 * 结算仍要等宿主自己收口——锁就被一个「必然失败」的派发占着，下一次静置撞锁跳过，
 * 界面上看起来是「审核正在运行」。
 *
 * 超时**不假装成功**：抛出的错误如实走 `executor-error` 分支，锁随即释放，下一次
 * 静置可以重试。取值 10 分钟——正常审核实测在 1 分钟内完成（12 条条目、单次派发），
 * 留足一个数量级的余量，又不至于让锁被占用到 `LOCK_STALE_MS`（30 分钟）过期。
 */
export const EXECUTOR_SETTLEMENT_TIMEOUT_MS = 10 * 60 * 1000;

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
export function buildReviewPrompt({ entries, existingPitfalls, projectId, frictionGroups = [], frictionLedger = [], frictionProjectionGap = null }) {
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
  lines.push("## 摩擦侧对照集（转写必用，11 §9 第 1 项 / §10.2 第 5 项）");
  lines.push("");
  lines.push("判 `transfer` 时，`group` 要尽量并入既有组（否则同一阻碍会在缓冲里被拆成两条");
  lines.push("互不相干的记录，永远攒不到阈值）。下面两层投影与经验对照集**同一次机械交付**。");
  lines.push("");
  if (frictionProjectionGap !== null) {
    // **交付面缺口必须让执行体知道**（2026-11-01 审核 N7 修）：否则「投影缺失」与
    // 「确实没有组」在它那侧外观相同，它会安心新起 group 键——正是要防的形态。
    lines.push(`> **提示：本次摩擦侧投影不完整**（${frictionProjectionGap}）。下面列出的组与账目`);
    lines.push("> **可能不是全部**。此时**仍应给出 `transfer`**（材料不该因此消失），但请把");
    lines.push("> 「投影不完整、group 归属无法比对」如实写进该条的结论理由里。");
    lines.push("");
  }
  lines.push("### 摩擦观察缓冲里已有的组（`group` ｜ 条数 ｜ 状态 ｜ 现象）");
  lines.push("");
  lines.push("**这里列的是全部 pending 组，含只有 1~2 条、还没攒够阈值的组。**");
  lines.push("它们正是最该被并入的对象：同一条阻碍若各起新组，谁也不到阈值，永远不成账。");
  lines.push("");
  lines.push("`状态` 三种：`已达阈值`（本轮即可晋升为账目）、`未达阈值`（普通聚合组，");
  lines.push("并入即可让它接近阈值）、`待补充`（该组的条目都指向同一笔既有账目，不会晋升——");
  lines.push("若要并入它，须同时给 `transfer.target_uid` 指向那笔账目）。");
  lines.push("");
  if (frictionGroups.length === 0) {
    lines.push("（当前缓冲里没有任何 pending 组）");
  } else {
    for (const g of frictionGroups) {
      const mark = g.kind === "supplement"
        ? `待补充（目标账目 ${g.target_uid ?? "?"}）`
        : (g.at_threshold === true ? "已达阈值" : "未达阈值")
          // 混合组：状态说聚合面向，另注一句待补充面向，避免「2 条聚合／1 条待补充 ｜
          // 未达阈值」被读成「这三条都不够」。第 16 条。
          + (g.supplement_count > 0 && g.target_uid !== null
            ? `（其中 ${g.supplement_count} 条待补充指向 ${g.target_uid}）`
            : "");
      // **条数要说得清是哪种条数**（自查 P1）：`pending_count` 只数聚合条目，
      // 待补充条目另计。混合组直接印一个裸数字会让执行体误读「2 条」的含义。
      const counts = g.supplement_count > 0
        ? `${g.pending_count} 条聚合／${g.supplement_count} 条待补充`
        : `${g.pending_count} 条`;
      lines.push(`- \`${g.group}\` ｜ ${counts} ｜ ${mark} ｜ ${g.phenomenon}`);
    }
  }
  lines.push("");
  lines.push("### 既有摩擦账目（`object_uid` ｜ 状态 ｜ 归因 ｜ 归因锚点 ｜ 标题 ｜ 现象）");
  lines.push("");
  if (frictionLedger.length === 0) {
    lines.push("（当前没有任何 open 或 accepted 的摩擦账目）");
  } else {
    for (const f of frictionLedger) {
      lines.push(`- ${f.object_uid} ｜ ${f.status} ｜ ${f.attribution || "（无）"} ｜ ${f.attribution_ref ?? "（无）"} ｜ ${f.title} ｜ ${f.phenomenon || "（无）"}`);
    }
  }
  lines.push("");
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
  lines.push("");
  lines.push("  **`dedupe` 三个字段的口径**（23 §6.2；2026-10-27 明确，避免与校验器错位）：");
  lines.push("  - `checked`：布尔。`true` 表示你**确实**做了一次语义查重；");
  lines.push("  - `compared`：数组，填**你实际逐项比对过的**那几个既有对象的 `object_uid`");
  lines.push("    （取自上面清单）。**不需要**枚举清单里全部对象——填你真正读过并据以判断的那几个；");
  lines.push("    但凡填进数组的，必须是真的取自上面清单的 uid，**不得编造**。");
  lines.push("    注意：`draft` 状态的既有对象同样在查重范围内，不要只比 `active`；");
  lines.push("  - `conclusion`：`no-duplicate`（无同机制）或 `duplicate`（有同机制，此时另须");
  lines.push("    给 `duplicate_of` = 那个对象的 `object_uid`）。");
  lines.push("");
  lines.push("  **判断口径**：查重看的是**失败机制**是否同一（症状、根因），不是标题字面");
  lines.push("  是否相似。同一机制的新表现/新触发样例不算新对象，应判 `duplicate` 并指向既有对象；");
  lines.push("  症状相似但根因不同的，判 `no-duplicate`。");
  lines.push("- `duplicate`：与既有对象重复。须给 `dedupe.duplicate_of`（上面清单里的 object_uid）。");
  lines.push("- `discarded`：不足以成文。须给理由，且理由里**带上该条的引证片段**（可追溯的处置）。");
  lines.push("");
  lines.push("  **其中一类 `discarded` 还要给出 `transfer`**（11 §10.2 第 5 项，2026-11-01 新增）：");
  lines.push("  如果这条材料**已能说清「有一个失败发生过」且「它的机制是什么」，唯独写不出「解决」");
  lines.push("  「验证」两段**（也就是**还没修好，而不是没看懂**），它不该就此消失——请同时给出一个");
  lines.push("  `transfer` 对象，把材料搬到摩擦观察缓冲去继续攒阈值。字段：");
  lines.push("");
  lines.push("  - `title`：≤ 30 字，这笔阻碍的短标题（晋升成账目时用它）；");
  lines.push("  - `basis`：入账依据段落，回答「为什么这构成系统性阻碍」；");
  lines.push("  - `attribution`：归因落点——根在哪个子系统／规范／流程；**不得写「暂缺」**；");
  lines.push("  - `group`：聚合键。属于上面「摩擦观察缓冲里已有的组」清单里某一组的，**原样填那个 `group`**");
  lines.push("    （它会并入该组继续计数）；不属于任何一组的，另起一个稳定的 kebab-case 键");
  lines.push("    （今后同一阻碍的观察都用它）——**优先并入已列出的组**，尤其那些标「未达阈值」的：");
  lines.push("    同一条阻碍各起新组就永远攒不到阈值，这正是本入口要解决的问题；");
  lines.push("  - `target_uid`（可选）：若这条复现的是清单里某笔**已存在的 open 账目**，填它的");
  lines.push("    `object_uid`，则该条走「补充级更新」而不是攒新组。**若并入的是标「待补充」的组，");
  lines.push("    必须同时给 `target_uid`**（该组的组键就是那笔账目的 uid，只给 `group` 不给");
  lines.push("    `target_uid` 会落成一条永不晋升的孤立条目）。");
  lines.push("");
  lines.push("  **只有「机制已清楚、只是还没解决」才转**。材料连「失败是否真的发生」都不足");
  lines.push("  （纯噪音、单次卡顿、未收敛的调试过程）**不要转**——那会把噪音塞进摩擦缓冲，");
  lines.push("  占容量，还可能凑出不该有的账目。**已能写成完整候选的也不要转**（那不是 `discarded`）。");
  lines.push("  不转时不给 `transfer`，只给理由即可。");
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
            transfer: {
              type: "object",
              properties: {
                title: { type: "string" },
                basis: { type: "string" },
                attribution: { type: "string" },
                group: { type: "string" },
                target_uid: { type: "string" },
              },
              required: ["title", "basis", "attribution", "group"],
            },
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
      // **`transfer` 必须跟着走**（2026-11-01 B 方案）：它是 `discarded` 之外的**第二件事**
      // ——把材料搬到摩擦观察缓冲继续攒阈值。`insufficient` 只承载「不成候选」这个判定，
      // 丢掉 transfer 等于让「出了错、还没修」的材料照旧在 90 天后被删。
      const transfer = proposal.transfer !== null && typeof proposal.transfer === "object"
        ? { transfer: proposal.transfer }
        : {};
      // 已经是 insufficient 形态就原样保留（调用方可能直接给了机械形态）。
      if (proposal.insufficient !== undefined && proposal.insufficient !== null) {
        return { ...proposal, ...transfer };
      }
      return { entry_id: proposal.entry_id, insufficient: { reason: proposal.reason ?? "" }, ...transfer };
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
  workspaceRegistry = null, sessions = null,
}) {
  const activity = lifecycle?.activity;
  // **跨阶段保留的残余失败**（2026-10-31）：摩擦晋升的单条失败不再让整函数返回，
  // 它记进 `residual` 由本段如实登记。而 `record()` 是**覆盖**语义（同一键写多次只
  // 留最后一次），故残余若只随某一次 `record` 传出，会被后续的 `landed`/`skipped`
  // 覆盖掉——那等于静默跳过（§12）。这里让它随**每一次** record 带出。
  let promotionResidual = [];
  // 摩擦署名的取数原因（2026-10-31）。它必须随 record 带出：`activity.record` 只进
  // 内存环形缓冲（ActivityLog 上限 200 条、重启即失），而这里的诊断要能**事后**从
  // `idle-checkpoint-runs.json` 读到——否则又是一轮「只能靠猜」。
  let frictionSignatureReason = null;
  const record = (outcome, extra = {}) => {
    const value = {
      outcome,
      ...extra,
      ...promotionResidual.length > 0 ? { friction_residual: promotionResidual } : {},
      ...frictionSignatureReason !== null ? { friction_signature: frictionSignatureReason } : {},
    };
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

  // ── 1bis. 摩擦缓冲的升级（2026-10-30 职责重划：§9 第 3／4 项移入 §10.2）────
  //
  // **必须在经验审核之前、且不受经验缓冲是否为空的影响**：摩擦晋升是纯机械的
  // （阈值固定内嵌，标题/依据/归因/影响已随观察条目落进缓冲），不需要派生执行体；
  // 而经验审核需要。若把晋升放在「经验缓冲非空」之后，一个只在摩擦侧有活的运行
  // 会永远晋升不了——那正是「发现层只写缓冲、审核层做全部升级」这条分工的断点。
  //
  // 失败即 fail-closed 并登记，不降级跳过（§12）。但**不阻断经验审核**：两者处理
  // 的是不同缓冲，一件失败不应使另一件也停摆；失败已如实登记，读数时可见。
  let frictionPromotion = null;
  const frictionSignature = await resolveSignatureDetailed(
    sessionPersistence,
    parent?.session?.header?.id ?? null,
  );
  try {
    const { runFrictionReviewPromotion } = await import("./friction-review-promotion.js");
    frictionPromotion = await runFrictionReviewPromotion({
      factSourceRoot,
      dshHomePath,
      projectId: scope.project.id,
      // **署名取主控会话，不取执行体**（2026-10-31 修，实测缺陷）。
      //
      // 摩擦晋升在本函数**派发执行体之前**执行，此刻 `activation.childId` 还不存在，
      // 原实现写的是 `resolveSignature(sessionPersistence, null)`——而该函数在
      // `childId` 为空时**恒返回 null**。于是每一次摩擦晋升/补充都以
      // `signature_unavailable` 被拒，界面上「5/3 可晋升」永远不动。
      //
      // 为什么取主控是对的：这次晋升的**发起者与责任主体**是主控（11 §4：主控发起的
      // 行动由主控最终负责），执行体那时还没被派生，它也没有参与任何摩擦判断。
      // 09 §5.1 要的是「当次实际做出这个判断的那一方」的 provider/model——摩擦晋升
      // 由主控触发、在宿主进程内完成，主控会话记录就是它的权威出处。
      sessionSignature: frictionSignature.ok ? frictionSignature.value : null,
    });
    // 署名取不到时把**具体原因**记下来（不是只留一个 signature_unavailable）。
    // 2026-10-31：正是缺这一步，使「服务缺失／id 为空／open 抛错／无 routing 事件」
    // 四种原因混成一个 null，排查只能靠猜——实测为此连猜两轮都没定位。
    if (!frictionSignature.ok) {
      frictionSignatureReason = frictionSignature.reason;
      activity?.record("review/friction-signature-unavailable", {
        reason: frictionSignature.reason,
        sessionId: parent?.session?.header?.id ?? null,
      });
    }
  } catch (error) {
    frictionPromotion = failure("review_stage/friction_promotion_threw", String(error?.message ?? error));
  }
  if (frictionPromotion?.ok) {
    const promotedCount = frictionPromotion.value.promotions.length;
    const supplementedCount = frictionPromotion.value.supplemented.length;
    const residual = Array.isArray(frictionPromotion.value.residual) ? frictionPromotion.value.residual : [];
    if (promotedCount > 0 || supplementedCount > 0) {
      activity?.record("review/friction-promotion", {
        promoted: frictionPromotion.value.promotions,
        supplemented: frictionPromotion.value.supplemented,
        skipped: frictionPromotion.value.skipped,
      });
    }
    // **单条失败不再整函数返回**（2026-10-31），故它出现在 `ok:true` 的 `residual` 里。
    // §12 要求如实登记——不登记即静默跳过。这条记录同时是界面上「可晋升却一直没
    // 晋升」的第一手诊断依据。用 `promotionResidual` 而非此处直接 `record`：后者的
    // 覆盖语义会让它被随后的 `landed`/`skipped` 抹掉。
    promotionResidual = residual;
  } else {
    record("land-failed", {
      action: frictionPromotion?.error?.code ?? "friction-promotion-failed",
      reason: frictionPromotion?.error?.message ?? "unknown",
    });
  }

  // ── 1ter. 摩擦侧投影（转写要用；2026-11-01 B 方案）─────────────────────
  //
  // 审核段判 `transfer` 时必须知道「摩擦缓冲里已有哪些组」「账本里已有哪些 open /
  // accepted 账目」，否则它给的 `group` 会是新键而不是并入既有组——同一阻碍就在
  // 缓冲里被拆成两条互不相干的记录，永远攒不到阈值（11 §7.1「审核段执行体的交付面」）。
  //
  // **两层投影都只读、只用于 `group` 归属与查重**，不产生对摩擦账本的任何写入。
  // 取不到时**不阻断**：转写的 `group` 少了参照，最坏结果是新起一组（不是写错账），
  // 而经验审核本身与摩擦侧无关。故失败如实登记后继续，投影退化为空。
  let frictionGroups = [];
  let frictionLedger = [];
  // **投影不可得要能被看见**（2026-11-01 审核 N7 修）：早先只记 activity 事件（内存
  // 环形缓冲，重启即失），执行体照常派发并拿到空列表——「交付面缺失」与「确实没有组」
  // 在它那侧不可区分，于是它会新起 group 键，正是本次要防的形态。故把缺失原因带进
  // 提示词与返回体两处。
  // **缺口用数组收集，不用单个字符串**（2026-11-01 第三轮审核第 15 条）：三条读取
  // 路径（缓冲组 / 账本 / 截断）可能同时出问题，last-wins 会只留最后一条，前面那些
  // 恰好是更需要被看见的（比如缓冲读失败）。对外仍以 `" | "` 拼成一条字符串返回，
  // 保持既有消费面不变。
  const frictionProjectionGaps = [];
  // 本次账本/缓冲的**读取范围**（交还第 2 项）。与 `frictionProjectionGap` 分开：
  // 前者是「读到了多少」（总是有值），后者是「哪里没读全」（仅在异常时非 null）——
  // 二者若合并，正常运行时「读到了多少」就没处放。
  const frictionProjectionScope = { groups_total: null, open_total: null, all_total: null, ledger_limit_starved: false };
  try {
    // **交付全量 pending 组，不是「已达阈值的组」**（2026-11-01 审核 F1 修）。
    //
    // 早先交付的是 `readPromotionReadyGroups(...).ready`——那里面只有 `pending_count >= N`
    // 的组（`friction-observation-buffer.js` 的 ready 过滤）。可转写最该做的事恰恰是
    // **并入一个还没攒够的组**：转写的整个理由就是「同一阻碍被两条尺子拆开、谁也不
    // 到阈值」，若只把已达阈值的组给执行体看，它就永远看不见那些 count=1/2 的组，
    // 只能给新 `group` 键——于是每个转写都新起一组，谁也不再合并，改动主张落空。
    //
    // 故读 `loadObservationDedupCandidates` 的 `by_group`（与发现层 §7.1(b) 同源的
    // 全量 pending 组投影），并另附 `at_threshold` 标记让执行体知道哪些已可晋升。
    const { loadObservationDedupCandidates } = await import("./friction-discovery.js");
    const groups = await loadObservationDedupCandidates(dshHomePath, scope.project.id);
    if (groups.ok) {
      frictionProjectionScope.groups_total = groups.value.by_group.length;
      frictionGroups = groups.value.by_group.map((group) => {
        // **区分「待补充组」与「聚合组」**（自查补，2026-11-01）：`by_group` 把带
        // `target_uid` 的待补充条目也算成一个组（它的 `group` 键是被命中账目的
        // `object_uid` 占位）。这类组**永远不会晋升**——审核层按 `target_uid` 走 §9
        // 第 4 项的补充路径，`readPromotionReadyGroups` 已显式跳过它们。若投影里不
        // 区分，`at_threshold` 会对它们算出一个错误信号（比如「2 条、未达」），
        // 而执行体据以并入的将是一个不存在「攒够即成账」语义的键。
        const supplements = group.entries.filter((entry) => (
          typeof entry.target_uid === "string" && entry.target_uid.length > 0
        ));
        const aggregates = group.entries.filter((entry) => (
          !(typeof entry.target_uid === "string" && entry.target_uid.length > 0)
        ));
        return {
          group: group.group,
          // **`pending_count` 与 `at_threshold` 用同一个分母**（2026-11-01 审核 N6 修）：
          // 早先前者含待补充条目、后者只数聚合条目，混合组会印「5 条｜已达阈值」而
          // 真实聚合条目数不是 5。现在两者都按聚合条目计。
          pending_count: aggregates.length,
          supplement_count: supplements.length,
          // 该组最近一条的现象——给执行体一个「已有组是讲什么」的可读摘要。
          phenomenon: group.entries[group.entries.length - 1]?.phenomenon ?? "",
          // `aggregate` = 按 group 攒阈值的普通组；`supplement` = 全部条目都指向
          // 同一笔既有账目（不会晋升，只会被补充级更新）。
          kind: aggregates.length === 0 ? "supplement" : "aggregate",
          // **混合组也要带出待补充条目的目标账目**（2026-11-01 第三轮审核第 16 条）：
          // 早先只在「全部是待补充条目」时给 target_uid，混合组则丢掉——执行体看不出
          // 该组里那些复观指向哪笔账，只能看到状态标记。取最近一条待补充条目的目标。
          target_uid: supplements.length > 0
            ? (supplements[supplements.length - 1]?.target_uid ?? null)
            : null,
          // 只有聚合组才有「达阈值即可晋升」这个语义。
          at_threshold: aggregates.length > 0
            && aggregates.length >= FRICTION_OBSERVATION_THRESHOLD_N,
        };
      });
      // **缓冲侧的不完整要进缺口**（第四轮审核 F4）：`complete=false` 表示有一批该淘汰的
      // 条目因登记失败仍在缓冲里，`eviction_registration_error` 表示登记写了但回写失败。
      // 两者都让「下面列出的组」不等于全部，执行体必须知道。
      if (groups.value.complete === false) {
        frictionProjectionGaps.push("groups: buffer read reported complete=false");
      }
      if (groups.value.eviction_registration_error) {
        const evictionError = groups.value.eviction_registration_error;
        frictionProjectionGaps.push(
          `groups: eviction registration ${evictionError.code ?? "unknown"}`,
        );
        activity?.record("review/friction-eviction-unregistered", {
          layer: "groups",
          code: evictionError.code ?? "unknown",
        });
      }
    } else {
      frictionProjectionGaps.push(`groups: ${groups.error?.code ?? "unknown"}`);
      activity?.record("review/friction-projection-unavailable", { layer: "groups", reason: groups.error?.code ?? "unknown" });
    }
    const { listFrictionObjects } = await import("./friction-writer.js");
    // `includeResolved: false` 即「只取 open」——accepted 也要，故另取一次再合并。
    // 26 §12：默认候选只含 open；accepted 用于「命中静默」判定，两层都要看得见。
    const opened = await listFrictionObjects({ factSourceRoot, limit: 200 });
    const accepted = await listFrictionObjects({ factSourceRoot, includeResolved: true, limit: 200 });
    // **账本侧读失败与截断都必须报出来**（2026-11-01 审核 N7/N9 修）：失败时静默按
    // 空账本继续，执行体就会以为「没有任何既有账目」并新起组；截断时它看到的是一份
    // 不完整的对照集，判「是不是同一笔账」会漏。两者都写进同一个缺口字段。
    if (!opened.ok || !accepted.ok) {
      frictionProjectionGaps.push(`ledger: ${(opened.ok ? accepted : opened).error?.code ?? "unknown"}`);
      activity?.record("review/friction-projection-unavailable", {
        layer: "ledger",
        reason: (opened.ok ? accepted : opened).error?.code ?? "unknown",
      });
    } else if (opened.value.complete === false || accepted.value.complete === false) {
      frictionProjectionGaps.push(`ledger: truncated at limit=200 (open=${opened.value.total}, all=${accepted.value.total})`);
      frictionProjectionScope.ledger_limit_starved = true;
      activity?.record("review/friction-projection-truncated", {
        layer: "ledger",
        open_total: opened.value.total,
        all_total: accepted.value.total,
      });
    }
    // **账本读取范围是交还第 2 项「读取到的账目范围」的直接来源**（2026-11-01
    // 第三轮审核第 12 条）：只在提示词里说「可能不是全部」不够——Human 面看不到
    // 本次究竟读到了多少，就无法判断「未证实范围」有多大。
    if (opened.ok) frictionProjectionScope.open_total = opened.value.total ?? null;
    if (accepted.ok) frictionProjectionScope.all_total = accepted.value.total ?? null;
    const merged = new Map();
    for (const item of [...(opened.ok ? opened.value.items : []), ...(accepted.ok ? accepted.value.items : [])]) {
      if (item.status === "open" || item.status === "accepted") merged.set(item.object_uid, item);
    }
    frictionLedger = [...merged.values()].map((item) => ({
      object_uid: item.object_uid,
      status: item.status,
      attribution: item.attribution ?? "",
      // §7.1(b) 的账本侧投影含 `attribution_ref`（26 §6.2 的查重锚是「归因 + 机制
      // 模式」；缺锚点则按根源查重在机制上不可执行）。转写要判「是不是同一笔账的
      // 同源复观」，这个锚就是判据面之一（2026-11-01 审核 F1 修）。
      attribution_ref: item.attribution_ref?.object_uid ?? null,
      title: item.title ?? "",
      // **`phenomenon` 也在 §7.1 的交付面里**（2026-11-01 审核 N1 修）：判「同一笔账
      // 的同源复观」要靠现象句，只给提炼过的标题判不出来。取不到时留空并在提示词
      // 行里显式打「（无）」，使「该账目没有现象段」与「投影漏了这个字段」可区分。
      phenomenon: item.phenomenon ?? "",
    }));
  } catch (error) {
    frictionProjectionGaps.push(`threw: ${String(error?.message ?? error)}`);
    activity?.record("review/friction-projection-threw", { reason: String(error?.message ?? error) });
  }

  // **多因并列成一条对外字符串**（供提示词与返回体共用，见上面收集处的理由）。
  const frictionProjectionGap = frictionProjectionGaps.length === 0
    ? null
    : frictionProjectionGaps.join(" | ");

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
    // 经验缓冲为空**不等于本次没干活**：摩擦晋升可能已经落了一笔账目。
    const promoted = frictionPromotion?.ok ? frictionPromotion.value.promotions.length : 0;
    const supplemented = frictionPromotion?.ok ? frictionPromotion.value.supplemented.length : 0;
    record(promoted > 0 || supplemented > 0 ? "landed" : "skipped", {
      action: promoted > 0 ? "friction-promoted" : supplemented > 0 ? "friction-supplemented" : "empty-buffer",
      pending: 0,
      friction_promoted: promoted,
      friction_supplemented: supplemented,
    });
    return {
      ok: true,
      value: {
        outcome: "skipped",
        formed: null,
        pending: 0,
        frictionPromotion: frictionPromotion?.value ?? null,
        friction_projection_gap: frictionProjectionGap,
        friction_projection_scope: frictionProjectionScope,
      },
    };
  }

  // ── 2. 挑 provider（零上下文）────────────────────────────────────────
  const picked = pickZeroContextProvider(subagents);
  if (!picked.ok) {
    record("land-failed", { action: "no-provider", reason: picked.error.code });
    return picked;
  }

  // ── 3. 派生执行体 ───────────────────────────────────────────────────
  //
  // **派发前先判归档血缘**（2026-10-31，实测根因）。宿主的 `ArchivedSessionGate`
  // 无条件挂载在 `agent/pre-step`，只要父会话在归档集合里，执行体每一步都被 reject、
  // 19 毫秒内 `turn/end {kind:"blocked"}`、一条 assistant 消息都没有，`stopReason`
  // 被映射为 `refusal`。那种派发**必然白跑**，且把外层锁拖到过期（`finally` 要等
  // `activation.result` 结算），于是下一次静置撞锁跳过——「审核从没成功」被伪装成
  // 「审核正在运行」。
  //
  // 探测不到（服务缺失、会话头读不到）时**不阻断**：把「探不到」当「被归档」会让
  // 审核永久停摆，那是另一种不可见失效。探测失败按未归档处理并把原因登记下来。
  const lineage = isUnderArchivedLineage({
    workspaceRegistry,
    sessions,
    sessionId: parent?.session?.header?.id ?? null,
  });
  if (lineage.checked && lineage.archived) {
    record("skipped", {
      action: "archived-lineage",
      reason: "the parent session is under the host's archived-session gate (agent/pre-step rejects every step of an archived lineage), so a dispatched executor would be blocked without producing any judgement",
      via: lineage.via,
    });
    return {
      ok: true,
      value: {
        skipped: true,
        reason: "archived-lineage",
        dispatched: false,
        friction_promoted: 0,
        friction_supplemented: 0,
        friction_projection_gap: frictionProjectionGap,
        friction_projection_scope: frictionProjectionScope,
      },
    };
  }
  if (!lineage.checked) {
    // 如实登记「这次没判出来」，但照常派发。
    activity?.record("review/lineage-unchecked", { reason: lineage.reason });
  }

  const batch = pending.slice(0, MAX_ENTRIES_PER_REVIEW_DISPATCH);
  const prompt = buildReviewPrompt({
    entries: batch,
    existingPitfalls: pitfalls.map((item) => ({
      object_uid: item.object_uid,
      title: item.title,
      status: item.status,
    })),
    projectId: scope.project.id,
    frictionGroups,
    frictionLedger,
    frictionProjectionGap,
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
  let timer;
  try {
    // **结算等待有上限**（见 `EXECUTOR_SETTLEMENT_TIMEOUT_MS` 的说明）。超时不静默：
    // 走 `executor-error` 如实登记，锁随 `fn()` 返回而释放，下一次静置可重试。
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`the review executor did not settle within ${EXECUTOR_SETTLEMENT_TIMEOUT_MS} ms`)),
        EXECUTOR_SETTLEMENT_TIMEOUT_MS,
      );
    });
    result = await Promise.race([activation?.result, timeout]);
  } catch (error) {
    record("land-failed", { action: "executor-error", reason: String(error?.message ?? error) });
    return failure("review_stage/executor_error", `the review executor failed: ${String(error?.message ?? error)}`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  // ── 4. 取结构化提案 ─────────────────────────────────────────────────
  const structured = structuredOf(result);
  const proposals = Array.isArray(structured?.proposals) ? structured.proposals : null;
  if (proposals === null) {
    // **先分辨「执行体被拒」与「执行体没给提案」**（2026-10-31）。两者都落到「没有
    // 提案」，但根因完全不同：前者是宿主门禁/中止把它拦在外面（`stopReason` 为
    // `refusal`/`aborted`/`max-tokens`），后者是它跑完了却没按契约产出。混在一起
    // 记成 `no-proposals` 会让「审核从来没跑起来」看起来像「审核跑了但没结论」。
    const stopReason = result?.stopReason ?? null;
    if (stopReason === "refusal" || stopReason === "aborted" || stopReason === "max-tokens") {
      record("land-failed", { action: "executor-not-run", stopReason });
      return failure(
        "review_stage/executor_not_run",
        `the review executor produced no output at all (stopReason=${JSON.stringify(stopReason)}); nothing was written and every entry stays pending`,
        { stopReason },
      );
    }
    // 执行体没给可解析的提案就**不落盘**——缺省不得代替材料判断（§10.2 第 5 项）。
    record("land-failed", { action: "no-proposals", stopReason });
    return failure(
      "review_stage/no_proposals",
      `the review executor returned no structured proposals (stopReason=${JSON.stringify(stopReason)}); nothing was written and every entry stays pending`,
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
    // 转写的两条并行账（11 §10.2 第 5 项，2026-11-01 B 方案）：已转（含幂等跳过）
    // 与想转没转成。它们都**不影响** discarded 的结算，但都必须可见（§17）。
    transferred: value.transferred,
    transfer_failed: value.transfer_failed,
    remaining_pending: value.remaining_pending,
    // 用了哪个模型：事后核对「设置的那个模型到底有没有生效」全靠这一项。
    model: modelApplied,
  });
  // **投影缺口与读取范围随返回体带出**（2026-11-01 第三轮审核第 12 条）：只在提示词
  // 里声明缺口是不够的——那次声明只对执行体可见，Human 面看到的是「一切正常」。
  // 11 §15 的交还第 2 项（读取到的账目范围）与第 4 项（未证实范围）在宿主辅助任务
  // 里没有别的承载者，故必须搭这条返回体出去。
  return {
    ok: true,
    value: {
      ...value,
      friction_projection_gap: frictionProjectionGap,
      friction_projection_scope: frictionProjectionScope,
    },
  };
}

/**
 * 取**某个会话**的署名（provider/model → 品牌化载体）。
 *
 * **取不到就返回 null，不臆造**：署名进 `change_log`，编一个比没有更糟。
 *
 * ## 两处用途，主体不同（2026-10-31 补）
 *
 *   - 经验审核的落盘（`:519`）：取**执行体**（`activation.childId`）。那份判断是
 *     执行体做的，盖主控的章就是把别人的判断记成自己的（2026-10-16 修掉的缺陷）。
 *   - 摩擦晋升与补充（`:348`）：取**主控**（`parent.session.header.id`）。它发生在
 *     派发执行体之前，执行体还没被派生、也没参与任何摩擦判断；这次晋升由主控触发、
 *     在宿主进程内完成，主控会话记录就是它的权威出处（11 §4 主控最终负责）。
 *
 * 两处的共同纪律是「取**当次实际做出这个判断的那一方**」（09 §5.1）。原实现在摩擦
 * 晋升处传的是 `null`——而本函数在 id 为空时恒返回 null，于是每一次晋升都以
 * `signature_unavailable` 被拒，界面上「5/3 可晋升」永远不动。
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
 * 取不到时仍返回 null，**不隐式回落**到某个默认会话——那会把一方的判断盖上另一
 * 方的章。调用方必须显式指明取谁的会话（见上「两处用途」）。
 */
async function resolveSignature(sessionPersistence, childId) {
  const out = await resolveSignatureDetailed(sessionPersistence, childId);
  return out.ok ? out.value : null;
}

/**
 * 带原因的署名取数（2026-10-31）。
 *
 * **为什么要把原因带出来**：`resolveSignature` 取不到时只返回 null，调用方看到的
 * 一律是 `signature_unavailable`。但「没有 persistence 服务」「会话 id 为空」
 * 「宿主 open 抛错」「日志里没有 routing 事件」「有值但品牌化失败」是五件不同的事，
 * 混成一个 null 使排查只能靠猜——实测为此连猜了两轮都没定位。
 *
 * 原因**只进活动记录与返回值**，不进任何事实对象：它是诊断，不是结论。
 *
 * @returns {{ok: true, value: string} | {ok: false, reason: string}}
 */
export async function resolveSignatureDetailed(sessionPersistence, childId) {
  if (sessionPersistence === null || sessionPersistence === undefined) {
    return { ok: false, reason: "sessionPersistence-unavailable" };
  }
  if (typeof childId !== "string" || childId.length === 0) {
    return { ok: false, reason: "session-id-empty" };
  }
  try {
    // 只认会话标识：宿主正规入口 open(id,'read') 自行定位日志；执行体在结算前
    // 已被 flushFinalState 刷盘，故此刻可读（见 currentRouteValuesForSession 说明）。
    const route = await currentRouteValuesForSession(sessionPersistence, { id: childId });
    if (!route.ok) return { ok: false, reason: `route-unavailable:${route.reason ?? "unknown"}` };
    const carrier = authoritativeSignature({ provider: route.value.provider, model: route.value.model });
    if (carrier === null) {
      return {
        ok: false,
        reason: `unbrandable:provider=${String(route.value.provider)}:model=${String(route.value.model)}`,
      };
    }
    return { ok: true, value: carrier };
  } catch (error) {
    // 取数通道自身抛错：仍然拒绝（宁可拒写也不臆造），但把原因带出去。
    return { ok: false, reason: `threw:${String(error?.message ?? error)}` };
  }
}
