/**
 * dsh-ldvh — 摩擦发现执行体的**机械部分** (specs/11 §9 自动动作闭集).
 *
 * 权威：specs/11 §9。本模块只实现该节「自动动作闭集」中**可由 Code 确定性地
 * 执行**的那部分，并严格守住 §8.2 的边界。逐项对应：
 *
 * **2026-10 修订（Human 决定：观察不进事实源）**：`observing` 已退出 26 §9 的
 * 状态闭集，观察材料改由 §12bis.1 的摩擦观察缓冲承载（非事实对象）。闭集因此
 * 变为**两层**——缓冲（观察）与账本（已晋升的待修账目）。逐项对应：
 *
 *   第 1 项 读取 open 账本 + 读观察缓冲 + 语义查重
 *           → 两层读取由本模块做（`loadDedupCandidates` 读账本、
 *             `loadObservationDedupCandidates` 读缓冲）；**语义查重不做**——它是
 *             §8.4 明文登记的 gap（「本环节属语义判断，其正确性不由机械校验
 *             保障」），只能由派生出的子代理（LLM）完成。本模块因此只**提供**
 *             两层候选清单，并把「哪条是同一阻碍」的判断留给调用方（子代理）。
 *   第 2 项 写入观察缓冲条目（§9 第 2 项）
 *           → `recordObservation`（本模块）→ `appendFrictionObservation`
 *             （friction-observation-buffer.js）。**不写事实源。**
 *   第 3 项 达阈值晋升为 open 账目（§9 第 3 项）
 *           → `promoteReadyGroup`：把该组全部 `evidence` 一次性复制进新建账目正文
 *             （02 §6.1 第 3 条硬要求），再结算缓冲条目为 `promoted`。
 *   第 4 项 对既有 open 账目的补充级更新（count 递增、last_at 更新、status 不变）
 *           → `supplementOccurrence`。**不参与任何阈值判定**（账目状态推进只有
 *             Human Gate）。
 *   第 5 项 精确回读 → 每次写入后立即回读并比对。
 *   第 6 项 任一校验不可用/未通过/回读不完整 → §12 fail-closed（由调用方执行）。
 *
 * 边界：本模块**不**做价值判断、不产生需要 Human 决定的结论、不扩张机械通道
 * （§9 明文「仅限第 2／3／4 项」）。**机械通道不改变任何既有账目的状态**。
 * N = 3 由 11 §9 固定内嵌，**不设配置载体**。
 */

import { createHash } from "node:crypto";

import {
  listFrictionObjects,
  readFrictionObject,
  createFrictionObject,
  updateFrictionObject,
} from "./friction-writer.js";
import { listPitfallObjects } from "./pitfall-writer.js";
import {
  appendFrictionObservation,
  readFrictionObservations,
  readPromotionReadyGroups,
  settleGroupPromoted,
  FRICTION_OBSERVATION_THRESHOLD_N,
} from "./friction-observation-buffer.js";

/**
 * 阈值 N = 3（specs/11 §9「阈值 N」段：由本规范固定内嵌，不可配置）。
 *
 * **刻意不做成参数或配置项**：§8.4 明确「N 不设取值规范的外部承载、不设配置
 * 载体、不设读取者……不得由配置、默认值、环境变量或实现侧常量另行给定」，且变更
 * N 必须经 §12.1 第 3 项修订规范正文。把它做成可注入参数会使「不可配置」在实现
 * 层形同虚设——那正是本节反对的能力假象。
 */
export const FRICTION_THRESHOLD_N = 3;

/** 一次运行至多创建 1 条账目（§8.4「每次运行上限」）。 */
export const MAX_CREATES_PER_RUN = 1;

function success(value) {
  return { ok: true, value };
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 正文全文指纹（回读比对用；与 writer 的 fingerprint 同源语义）。 */
function fingerprintText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 剥掉正文开头的生成式 H1，返回可直接交给写入侧的 markdown。
 *
 * 存在的理由是一对**不对称契约**：`readFrictionObject().body` 含写入侧生成的
 * `# <title>`，而 `updateFrictionObject({bodyMarkdownAfter})` 要的是不含 H1 的正文
 * （写入侧 `assembleBody` 会再前置一次）。把前者直接喂给后者即每次写入叠加一个 H1。
 *
 * 与 `workcase-writer.js` 的同名处置取同一形态（`body.replace(/^#\s+.*\n+/, "")`），
 * 但放宽两点以适应既有载体的实际形态：① H1 前允许任意空白行与前导空白；
 * ② 只剥**第一个** H1，其后正文逐字保留（`/m` 不加 `g`，故不误伤正文里作为
 * 字面内容出现的 `# ` 行）。
 *
 * 边界：若正文根本没有 H1（写入侧尚未组装过），原样返回——本函数只做减法，
 * 不替调用方编造 H1，也不因缺失而失败。
 */
export function stripLeadingH1(body) {
  if (typeof body !== "string") return "";
  return body.replace(/^\s*#\s+.*(\n+|$)/, "").replace(/^\s+/, "");
}

// ---------------------------------------------------------------------------
// 第 1 项（读取部分）：账本候选
// ---------------------------------------------------------------------------

/**
 * 读取 `open` 与 `accepted` 账本，作为**语义查重**的账本侧输入（§9 第 1 项；
 * 2026-10 修订后 `observing` 已退出 26 §9 的闭集；2026-10 新增 `accepted`）。
 *
 * 只读，不改动。`resolved` 与 `voided` 不在候选内——26 §12 明确 voided
 * 「不参与查重范围」（记错了，同类现象若真实存在应重新入账）。**`accepted` 相反：
 * 必须参与查重、命中即静默**（26 §9.1 accepted 行 / 36 §8.2 第 6 项）——它是
 * 「已记录、不再报告」的结论；若把 `accepted` 排除在查重之外，同一阻碍会被反复
 * 重新入账，「记录一次、不再报告」就不成立。调用方须按 `status` 区分二者：
 * 命中 `open` 走补充级更新/并入组；命中 `accepted` 则不写缓冲、不晋升、不计数，
 * 并在交还 `residual` 中登记命中事实（11 §9 第 1 项 / §15）。
 *
 * **缓冲侧的查重输入见 `loadObservationDedupCandidates`**——两层都要查（§9 第 1 项），
 * 只查本函数构成漏查重。
 *
 * 返回 `{ ok, value: { candidates: [...], invalid: [...] } }`。**`invalid` 非空
 * 时必须按 §8.3 处理**：读不出的账目意味着查重输入不完整，而「查重不可靠」会
 * 直接导致误判递增（§8.4 第 2 项的反向护栏）——调用方应据此停止，而不是在
 * 不完整的账本上做判断。
 */
export async function loadDedupCandidates(factSourceRoot) {
  const listed = await listFrictionObjects({ factSourceRoot, includeResolved: true, limit: 200 });
  if (!listed.ok) return listed;
  // 2026-10：账本侧查重对象 = `open` + `accepted`（`observing` 已退出 26 §9 的闭集）。
  // `accepted` 的投影**只用于命中静默判定**，不参与晋升——命中时该次观察不写缓冲、
  // 不晋升、不补充计数（11 §9 第 1 项）。**本函数不是查重的全部**：11 §9 第 1 项
  // 要求同时读观察缓冲（`loadObservationDedupCandidates`），只查账本会把同一阻碍
  // 在缓冲里拆成互不相干的条目，使聚合永远到不了 N。
  const candidates = listed.value.items.filter((item) => item.status === "open" || item.status === "accepted");
  return success({
    candidates,
    invalid: listed.value.invalid,
    complete: listed.value.complete,
    total: listed.value.total,
  });
}

/**
 * 读 **Pitfall 侧**的查重输入（11 §9 第 1 项的**第三层**；2026-10-28 增）。
 *
 * 为什么必须交付这一层：26 §6.2 与 23 §6.2 都把查重锚定为「归因落点 + 机制模式」，
 * 并各自规定「跨类型同源不并入但必须互链」。执行体若只拿到 Friction 侧的两层，
 * **同源的那个 Pitfall 根本不在它的输入里**——它只能把「同源跨角色」判成两笔无关
 * 记录，`paired-with` 永远建不起来。这不是执行体判错，是输入缺层的机械后果。
 *
 * 只读：返回 `active` 与 `draft` 的薄投影（23 §12 的 F1 投影集 + 判同源所需的
 * `scope`/`trigger_signal`）。**本函数不写 Pitfall**——11 §9 的机械通道写入权
 * 只覆盖摩擦观察缓冲与账目，此处仅扩充读侧。
 *
 * 返回 `{ ok, value: { items, invalid, complete } }`。**`invalid` 非空时调用方须
 * 按 §12 fail-closed 之外的口径处理**：Pitfall 侧不可读使第三层缺失，按 11 §9
 * 该层「不得在缺一层的情况下主张查重完成」——调用方应停止，或在**如实登记未覆盖
 * 范围**后继续（登记后不得主张跨类型重复已排除）。两种处置由调用方按 §17 选择，
 * 本函数只保证「缺层是可见的」，不替它选。
 */
export async function loadCrossTypeDedupCandidates(factSourceRoot) {
  const listed = await listPitfallObjects({ factSourceRoot, statusFilter: ["active", "draft"], limit: 200 });
  if (!listed.ok) return listed;
  const items = (listed.value.items ?? []).map((item) => ({
    object_uid: item.object_uid,
    // **不硬编码类型键**（2026-10-28 复核 note）：投影值须来自载体实际声明。
    // listPitfallObjects 只扫 pitfalls/ 目录，与 Friction 侧「目录不是类型证据」
    // 的处理不完全对称；此处把载体里的值原样带出，缺值即如实缺失（不补猜）。
    fact_type_key: item.fact_type_key,
    title: item.title,
    status: item.status,
    scope: item.scope,
    trigger_signal: item.trigger_signal,
  }));
  return success({
    items,
    invalid: listed.value.invalid ?? [],
    complete: listed.value.complete,
    total: listed.value.total,
  });
}

/**
 * 读观察缓冲侧的查重输入（11 §9 第 1 项的第二层；§12bis.1）。
 *
 * 返回该项目的 `pending` 条目与「已就绪待晋升」的组——**二者都是查重输入**：
 * 前者用来判断本次观察该并入哪个 `group`，后者用来判断是否该触发晋升。
 *
 * 与 `loadDedupCandidates` 分开的理由：账本在事实源内、缓冲在事实源外，二者的
 * 读取通道与失败语义不同（缓冲不可读同样须 fail-closed，但它是宿主侧载体）。
 */
export async function loadObservationDedupCandidates(dshHomePath, projectId, options = {}) {
  const read = await readFrictionObservations(dshHomePath, projectId, {
    status: "pending",
    ...options,
  });
  if (!read.ok) return read;
  if (read.value.invalid.length > 0) {
    // 读不出的条目意味着查重输入不完整——与账本侧同一纪律：不可在不完整输入上判断。
    return failure(
      "friction_observation/dedup_input_incomplete",
      `${read.value.invalid.length} buffer entr(ies) could not be parsed; dedup input is incomplete (11 §9 第 1 项)`,
    );
  }
  return success({
    entries: read.value.items,
    by_group: groupEntries(read.value.items),
    complete: read.value.complete,
    total: read.value.total,
    evicted_pending: read.value.evicted_pending,
  });
}

/** 把条目按 `group` 归并（**只做相等比较**，不判断两个 group 是否同一阻碍）。 */
function groupEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  const result = [];
  for (const [group, items] of groups) {
    const ordered = [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    result.push({ group, pending_count: ordered.length, entries: ordered });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 第 2 项：补充级更新（count 递增 + 现象段扩展，同一次更新）
// ---------------------------------------------------------------------------

/**
 * 对既有账目做补充级更新（§8.4 第 2 项）。
 *
 * 契约要点（26 §9.3 + §8.4 第 2 项）：
 *   - `count` 递增 1、`last_at` 更新为本次观察时间、`status` **不变**；
 *   - 现象段扩展与计数**必须在同一次 update 内**完成（「只增叙述不增 count 会
 *     使阈值判定失去输入」，反之亦然）；
 *   - 仅非终态可更新（终态计数冻结，由 writer 兜底拒绝）。
 *
 * `observation` 是要追加到现象段的一次观察描述（人类可读）。它**不是**判断该
 * 观察是否属于同一阻碍——那个判断由子代理做出后传进来。
 */
export async function supplementOccurrence({
  factSourceRoot,
  objectUid,
  observation,
  observationAt,
  sessionSignature,
}) {
  if (!isNonEmptyString(objectUid)) return failure("invalid_request", "objectUid is required");
  if (!isNonEmptyString(observation)) {
    return failure("invalid_request", "observation is required (the one-line human-readable record of this sighting)");
  }

  const current = await readFrictionObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;
  const fm = current.value.frontmatter;
  const status = fm.status;
  // 2026-10 修订：只有 `open` 可做补充级更新（`observing` 已不在闭集内）。
  if (status !== "open") {
    return failure("friction/status_terminal", `status=${status} is not open; occurrence counting only applies to an existing open ledger entry (26 §9.3: 仅非终态 open 时可执行). A new obstacle goes through the observation buffer instead (11 §12bis.1).`);
  }
  const occurrence = fm.occurrence;
  if (typeof occurrence !== "object" || occurrence === null || !Number.isInteger(occurrence.count)) {
    return failure("friction/occurrence_missing", "the record carries no usable occurrence field; refusing to invent one (26 §8 必填)");
  }

  const now = isNonEmptyString(observationAt) ? observationAt : new Date().toISOString();
  // 现象段扩展：追加本次观察来源。26 §8 要求 occurrence 载体内聚——正文现象段
  // 须含首次观察来源；此处扩展的是重复观察的记录，保留既有内容不动。
  //
  // **读-写契约的不对称**（实测缺陷，2026-10-12 修）：
  //   `readFrictionObject().body` 是**整份文件正文，含生成的 `# <title>` H1**；
  //   而 `updateFrictionObject({bodyMarkdownAfter})` 要的是**不含 H1 的 markdown**
  //   （写入侧 `assembleBody` 会再前置一次 H1）。二者直接相接，每跑一次补充级更新
  //   就多一个 H1——实测在临时源上连跑 3 次得到 H1 数 1/2/3，且**每次写入都返回成功**：
  //   `validateFrictionBodyStructure` 只比对首个非空行是否为 `# <title>`、H2 序列与
  //   各段非空，**不数 H1 的个数**，故结构校验对重复 H1 完全无感；§8.4 第 5 项的精确
  //   回读也只比对 `count`/`last_at`。真实账本已有 3 条中招（3048937d H1=3、
  //   545cca82 H1=2、bf73fad4 H1=2，其余 21 条为 1——只有被本路径写过的才中招）。
  // 修法取 `workcase-writer.js` 的既有范式（同一读-写不对称，该类型早已按此处置）。
  const nextBody = `${stripLeadingH1(current.value.body)}\n\n补充观察（${now}）：${observation.trim()}`;

  const frontmatterAfter = {
    ...fm,
    occurrence: { ...occurrence, count: occurrence.count + 1, last_at: now },
    // status 逐字保持——补充级更新不改变状态（§8.4 第 2 项）。
    status,
  };

  const updated = await updateFrictionObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint: current.value.fingerprint,
    frontmatterAfter,
    bodyMarkdownAfter: nextBody,
    changeSummary: `补充观察：count ${occurrence.count} → ${occurrence.count + 1}（11 §9 第 2 项）`,
    sessionSignature,
  });
  if (!updated.ok) return updated;

  // §8.4 第 5 项：精确回读。
  const readBack = await readFrictionObject({ factSourceRoot, objectUid });
  if (!readBack.ok) {
    return failure("friction/read_back_failed", `the update reported success but the read-back failed: ${readBack.error.message}`);
  }
  const got = readBack.value.frontmatter.occurrence;
  if (got?.count !== occurrence.count + 1 || got?.last_at !== now) {
    return failure(
      "friction/read_back_mismatch",
      `read-back does not match the intended write: expected count=${occurrence.count + 1} last_at=${now}, got count=${got?.count} last_at=${got?.last_at}`,
    );
  }
  if (readBack.value.frontmatter.status !== status) {
    return failure(
      "friction/read_back_mismatch",
      `supplement-level update must not change status: expected ${status}, got ${readBack.value.frontmatter.status}`,
    );
  }

  // §8.4 第 5 项「精确回读」的**结构**一半。
  //
  // 只比对 count/last_at 是不够的：实测缺陷中写入路径每次叠加一个 H1，而
  // `validateFrictionBodyStructure` 不数 H1 个数、回读又不看结构，于是**每一次写入都
  // 返回成功**、账目静默损坏（3048937d 累积到 3 个 H1，且已提交进历史）。
  // 这与本账目 545cca82 自身的主题同形：机械信号（写入成功、count 相符）不构成
  // 「载体结构正确」的证据。
  //
  // 比对的判据取「H1 恰好一个且等于 `# <title>`」——与 26 §8「H1 恰好一个且与 title
  // 一致」逐字同源，比直接复用 `body_valid` 更严格（后者对该缺陷恒为 true）。
  const readBackBody = readBack.value.body ?? "";
  const h1Count = (readBackBody.match(/^ {0,3}#(?!#)[ \t]+\S.*$/gm) ?? []).length;
  if (h1Count !== 1) {
    return failure(
      "friction/read_back_structure_invalid",
      `read-back found ${h1Count} H1 heading(s) in the body; 26 §8 requires exactly one (generated from title). `
      + "This write path must not duplicate the generated H1 — see stripLeadingH1 in this module.",
    );
  }

  return success({
    action: "supplement",
    object_uid: objectUid,
    count_before: occurrence.count,
    count_after: got.count,
    status,
    fingerprint: readBack.value.fingerprint,
  });
}

// ---------------------------------------------------------------------------
// 第 2 项：写入摩擦观察条目（§9 第 2 项，非事实源）
// ---------------------------------------------------------------------------

/**
 * 把一次观察写入摩擦观察缓冲（§9 第 2 项 / §12bis.1）。
 *
 * **本函数不写事实源、不产生 object_uid**——观察材料在达到阈值前不是账目。
 * 「这条与哪条同源」的判断（`group`）由子代理做出后传入；本函数只做机械落地
 * 与校验，**不判断同源**（那是 §9 第 1 项的语义工作）。
 *
 * @returns {Promise<{ok:true,value:{entry_id:string,group:string,group_pending_count:number,promotion_ready:boolean,evicted_pending:Array}}|{ok:false,error:object}>}
 */
export async function recordObservation({
  dshHomePath,
  projectId,
  session,
  anchor,
  phenomenon,
  evidence,
  group,
  target_uid,
  title,
  basis,
  attribution,
  impact,
  observationAt,
}) {
  if (!isNonEmptyString(phenomenon)) {
    return failure("invalid_request", "phenomenon is required (a single-sentence description of what was seen)");
  }
  if (!isNonEmptyString(evidence)) {
    return failure("invalid_request", "evidence is required (the verbatim fragment plus its source reference)");
  }
  if (!isNonEmptyString(group)) {
    return failure(
      "invalid_request",
      "group is required — it is the aggregation key the semantic dedup step decided; without it the threshold can never be computed (11 §9 第 3 项)",
    );
  }
  // 2026-10-30：晋升搬到审核层后，晋升所需的四项必须随条目落进缓冲——它们只在
  // 本次运行的 verdict 里存在，审核层下一次运行时已无从取得（§12bis.1 字段闭集）。
  for (const [field, value] of [["title", title], ["basis", basis], ["attribution", attribution]]) {
    if (!isNonEmptyString(value)) {
      return failure(
        "invalid_request",
        `${field} is required — it is carried into the buffer so the review layer can promote this entry in a later run (§12bis.1)`,
      );
    }
  }
  if (!["light", "medium", "heavy"].includes(impact)) {
    return failure("invalid_request", 'impact is required and must be one of light, medium, heavy (§12bis.1)');
  }
  return appendFrictionObservation(dshHomePath, {
    project: projectId,
    session,
    anchor,
    phenomenon,
    evidence,
    group,
    title,
    basis,
    attribution,
    impact,
    ...(isNonEmptyString(target_uid) ? { target_uid } : {}),
    ...(isNonEmptyString(observationAt) ? { at: observationAt } : {}),
  });
}

// ---------------------------------------------------------------------------
// 第 3 项：达阈值晋升为 open 账目（§9 第 3 项）
// ---------------------------------------------------------------------------

/**
 * 判定某组是否达晋升阈值（§9 第 3 项），**纯函数，不做副作用**。
 *
 * 判据只有一条：该组 **`pending` 条目数 ≥ N**。没有「Human 放回」的护栏字段了
 * ——`human_return_at` 随 `open → observing` 流转一并删除，因为机械通道已不再按
 * `count` 翻任何**既有账目**的状态（阈值判定只发生在缓冲侧，且只作用于
 * 尚未成为账目的材料）。
 */
export function meetsPromotionThreshold(pendingCount) {
  return Number.isInteger(pendingCount) && pendingCount >= FRICTION_OBSERVATION_THRESHOLD_N;
}

/**
 * 把一个已达阈值的组晋升为一条新的 `open` 账目（§9 第 3 项）。
 *
 * **三条硬要求**（缺一即失败）：
 *   1. 该组 `pending` 条目数 ≥ N；
 *   2. 新建账目正文**写入该组全部条目的逐字引证与来源**——02 §6.1 第 3 条：权威
 *      对象必须自身完整承载证据，缓冲可淘汰，**只写 `buffer:<id>` 等于留下一条
 *      无法核对的转述**；
 *   3. 晋升后该组条目结算为 `promoted` 并指向新账目 uid。**幂等**——已 `promoted`
 *      的条目不参与再次计数，故同一组不会被晋升两次。
 *
 * `occurrence` 取该组的真实观察统计（count = 条目数、first_at/last_at = 该组最早
 * 与最近观察时间）——这是「该账目成立时已确认的观察次数」，不是凭空写的 1。
 *
 * 建账目与结算缓冲**不是原子操作**：账目建好而结算失败时，条目仍为 `pending`，
 * 下次运行会**再次晋升**同一条（产生重复账目）。故结算失败一律返回失败，由调用方
 * 按 §12 fail-closed 并登记——**不得**静默放过。
 */
export async function promoteReadyGroup({
  factSourceRoot,
  dshHomePath,
  projectId,
  group,
  title,
  impact,
  basis,
  attribution,
  sessionSignature,
}) {
  if (!isNonEmptyString(group)) return failure("invalid_request", "group is required");
  if (!isNonEmptyString(title)) {
    return failure("invalid_request", "title is required — the promoted ledger entry needs a short title (26 §8 ≤ 30 字)");
  }
  if (!isNonEmptyString(basis)) {
    return failure("invalid_request", "basis is required — the 入账依据 paragraph answering the three conditions");
  }

  const ready = await readPromotionReadyGroups(dshHomePath, projectId);
  if (!ready.ok) return ready;
  const target = ready.value.ready.find((item) => item.group === group);
  if (!target) {
    // 不满足即**不是失败**——正常的不匹配，调用方据此跳过。
    const read = await readFrictionObservations(dshHomePath, projectId, { status: "pending", group });
    const count = read.ok ? read.value.total : 0;
    return success({
      action: "promotion-skip",
      group,
      pending_count: count,
      threshold: FRICTION_OBSERVATION_THRESHOLD_N,
      promoted: false,
    });
  }

  const entries = target.entries;
  const count = entries.length;
  const firstAt = entries[0].at;
  const lastAt = entries[entries.length - 1].at;

  // 现象段：逐条列出该组的观察与来源——这些逐字引证**必须**进账目正文。
  const phenomenonLines = entries
    .map((entry, index) => `${index + 1}. （${entry.at}，${entry.session} @ ${entry.anchor}）${entry.evidence}`)
    .join("\n");
  const phenomenon = entries[entries.length - 1].phenomenon;
  const bodyMarkdown = `## 现象\n${phenomenon}\n\n### 该阻碍的历次观察（${count} 次，逐字引证）\n${phenomenonLines}\n\n## 入账依据\n${basis.trim()}`;

  const frontmatterDraft = {
    title: title.trim(),
    phenomenon: phenomenon.trim(),
    impact,
    // 26 §8：occurrence 必填；count 取该组真实条目数（不是 1——账目成立的判据正是
    // 「观察到了这么多次」），first_at/last_at 取该组最早与最近观察时间。
    occurrence: { count, first_at: firstAt, last_at: lastAt },
    ...(isNonEmptyString(attribution) ? { attribution: attribution.trim() } : {}),
    change_summary: `摩擦发现阈值晋升（观察缓冲同源条目 ${count} 条 ≥ ${FRICTION_OBSERVATION_THRESHOLD_N}，11 §9 第 3 项）`,
  };

  const created = await createFrictionObject({
    factSourceRoot,
    frontmatterDraft,
    bodyMarkdown,
    sessionSignature,
  });
  if (!created.ok) return created;

  const uid = created.value?.object_uid ?? created.value?.uid;

  // §8.4 第 5 项：精确回读（含证据是否真的进了正文）。
  const readBack = await readFrictionObject({ factSourceRoot, objectUid: uid });
  if (!readBack.ok) {
    return failure("friction/read_back_failed", `create reported success but the read-back failed: ${readBack.error.message}`);
  }
  const fm = readBack.value.frontmatter;
  if (fm.status !== "open" || fm.occurrence?.count !== count) {
    return failure(
      "friction/read_back_mismatch",
      `promotion requires initial status=open and count=${count}; read back status=${fm.status} count=${fm.occurrence?.count}`,
    );
  }
  // 证据复制核对：该组每一条 evidence 都须逐字出现在正文里。
  const body = readBack.value.body ?? "";
  for (const entry of entries) {
    if (!body.includes(entry.evidence)) {
      return failure(
        "friction/evidence_not_carried",
        `the promoted entry body does not contain buffer entry ${entry.id}'s verbatim evidence — 02 §6.1 第 3 条 forbids leaving the evidence chain in an evictable carrier`,
      );
    }
  }

  // 结算缓冲条目。失败即 fail-closed（否则下次运行会重复晋升）。
  const settled = await settleGroupPromoted(dshHomePath, projectId, entries.map((entry) => entry.id), uid);
  if (!settled.ok) {
    return failure(
      "friction_observation/promotion_settle_failed",
      `the ledger entry ${uid} was created but settling the buffer entries failed (${settled.error.code}: ${settled.error.message}); `
      + `the group's entries are still pending and the next run would promote them again — stop and register this (§12), do not continue`,
    );
  }

  return success({
    action: "promotion",
    object_uid: uid,
    group,
    count,
    first_at: firstAt,
    last_at: lastAt,
    status: "open",
    // `promoted` 与 `pending_count` 与「跳过」分支同形（同一函数两个分支的返回值
    // 须可被判据统一消费，否则调用方要按 action 分别判断）。
    promoted: true,
    pending_count: count,
    threshold: FRICTION_OBSERVATION_THRESHOLD_N,
    settled_entries: settled.value.settled,
    fingerprint: readBack.value.fingerprint,
  });
}

// ---------------------------------------------------------------------------
// 运行级校验：N 的求值可用性（§8.4「阈值 N」+ §8.3）
// ---------------------------------------------------------------------------

/**
 * 确认本次运行的**阈值求值这一校验可用**（§8.4 第 4 项的前置）。
 *
 * N 由规范固定为 3、不经外部载体读取，故「不可用」在正常情况下不会发生。但
 * §8.4 第 6 项要求「任一校验不可用即 fail-closed」——本函数把该判定做成显式
 * 的一步，使调用方**不能**在 N 意外不可用时静默继续（例如常量被改动或模块被
 * 替换成返回非整数的实现）。
 *
 * 返回 `{ ok: true }` 或 `{ ok: false, error }`。
 */
export function verifyThresholdAvailable() {
  const n = FRICTION_THRESHOLD_N;
  if (!Number.isInteger(n) || n < 1) {
    return failure(
      "friction/threshold_unavailable",
      `the fixed threshold N is not a positive integer (got ${JSON.stringify(n)}); 11 §9 pins N = 3 and §8.3 requires the whole run to stop rather than proceed`,
    );
  }
  return success({ threshold: n });
}

export { fingerprintText };
