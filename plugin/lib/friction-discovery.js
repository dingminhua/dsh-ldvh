/**
 * dsh-ldvh — 摩擦发现执行体的**机械部分** (specs/04 §8.4 自动动作闭集).
 *
 * 权威：specs/04 §8.4。本模块只实现该节「自动动作闭集」中**可由 Code 确定性地
 * 执行**的那部分，并严格守住 §8.2 的边界。逐项对应：
 *
 *   第 1 项 读取 open/observing 账本 + 语义查重
 *           → 读取由本模块做（listFrictionObjects）；**语义查重不做**——它是
 *             §8.4 明文登记的 gap（「本环节属语义判断，其正确性不由机械校验
 *             保障」），只能由派生出的子代理（LLM）完成。本模块因此只**提供**
 *             候选清单，并把「哪条是同一阻碍」的判断留给调用方（子代理）。
 *   第 2 项 补充级更新（count 递增 1、last_at 更新、status 不变）
 *           → 本模块实现，且把「递增」与「现象段扩展」放在**同一次** update 内
 *             （26 §9.3 要求二者同一次完成）。
 *   第 3 项 创建 observing 账目（count=1）
 *           → 本模块实现。
 *   第 4 项 observing → open（count ≥ 3 ∧ human_return_at 为空）
 *           → 本模块实现。N = 3 由 04 §8.4 固定内嵌，**不设配置载体**（故此处
 *             是常量而非可注入参数——把它做成可配置即违反 §8.4 的「不可配置」）。
 *   第 5 项 精确回读
 *           → 每次写入后立即回读并比对，回读不符即视为失败（§8.4 第 6 项）。
 *   第 6 项 任一校验不可用/未通过/回读不完整 → §8.3 fail-closed
 *           → 本模块所有失败路径都返回结构化失败，**由调用方**按 §8.3 停止并
 *             登记待处置队列（本模块不自行入队：入队是整任务级的处置，属调用方
 *             的编排职责，见 discovery-runner 的使用方式）。
 *
 * 边界（§8.2）：本模块**不**做价值判断、不产生需要 Human 决定的结论、不扩张
 * 机械通道（§8.4 明文「仅限第 3 项与第 4 项」）。第 2 项是补充级更新，按 26
 * §7 属「补充级更新」通道而非机械通道的扩张。
 */

import { createHash } from "node:crypto";

import {
  listFrictionObjects,
  readFrictionObject,
  createFrictionObject,
  updateFrictionObject,
} from "./friction-writer.js";

/**
 * 阈值 N = 3（specs/04 §8.4「阈值 N」段：由本规范固定内嵌，不可配置）。
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
 * 读取 `open` 与 `observing` 账本，作为**语义查重**的输入（§8.4 第 1 项）。
 *
 * 只读，不改动。终态（resolved/voided）不在候选内——26 §12 明确 voided
 * 「不参与查重范围」。
 *
 * 返回 `{ ok, value: { candidates: [...], invalid: [...] } }`。**`invalid` 非空
 * 时必须按 §8.3 处理**：读不出的账目意味着查重输入不完整，而「查重不可靠」会
 * 直接导致误判递增（§8.4 第 2 项的反向护栏）——调用方应据此停止，而不是在
 * 不完整的账本上做判断。
 */
export async function loadDedupCandidates(factSourceRoot) {
  const listed = await listFrictionObjects({ factSourceRoot, includeResolved: false, limit: 200 });
  if (!listed.ok) return listed;
  const candidates = listed.value.items.filter((item) => item.status === "open" || item.status === "observing");
  return success({
    candidates,
    invalid: listed.value.invalid,
    complete: listed.value.complete,
    total: listed.value.total,
  });
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
  if (status !== "observing" && status !== "open") {
    return failure("friction/status_terminal", `status=${status} is terminal; occurrence counting is frozen (26 §9.3). A recurring obstacle goes through a NEW ledger entry.`);
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
    changeSummary: `补充观察：count ${occurrence.count} → ${occurrence.count + 1}（04 §8.4 第 2 项）`,
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
// 第 3 项：创建 observing 账目
// ---------------------------------------------------------------------------

/**
 * 创建 `observing` 账目（§8.4 第 3 项：初态 `count=1`、`first_at`=本次观察时间）。
 *
 * 入账三条件（26 §7）中，「重复出现」一项**仅适用于 open 及以上状态**——创建
 * 不受「≥3 次」约束（留观的语义正是「已看见但尚未攒够」）。故本函数的门槛是
 * 「该观察是否可归因 + 修了会更好」等语义判断，**由子代理做出**；本函数只做
 * 机械落地与校验。
 *
 * 机械通道**不得扩张**（§8.4）：本函数不创建 open，只创建 observing。
 */
export async function createObserving({
  factSourceRoot,
  title,
  phenomenon,
  impact,
  basis,
  attribution,
  observationAt,
  sessionSignature,
}) {
  if (!isNonEmptyString(phenomenon)) return failure("invalid_request", "phenomenon is required (a single-sentence phenomenon statement)");
  if (!isNonEmptyString(basis)) return failure("invalid_request", "basis is required (the 入账依据 paragraph)");

  const now = isNonEmptyString(observationAt) ? observationAt : new Date().toISOString();
  const frontmatterDraft = {
    title: title.trim(),
    phenomenon: phenomenon.trim(),
    impact,
    // 26 §8：occurrence 必填，创建初值 count=1、human_return_at=null。
    occurrence: { count: 1, first_at: now, last_at: now, human_return_at: null },
    ...(isNonEmptyString(attribution) ? { attribution: attribution.trim() } : {}),
    change_summary: "摩擦发现机械通道创建（04 §8.4 第 3 项）",
  };
  // 正文固定序（26 §8）：现象 / 入账依据；创建为 observing 故无「处置」段。
  const bodyMarkdown = `## 现象\n${phenomenon.trim()}\n\n## 入账依据\n${basis.trim()}`;

  const created = await createFrictionObject({
    factSourceRoot,
    frontmatterDraft,
    bodyMarkdown,
    sessionSignature,
  });
  if (!created.ok) return created;

  const uid = created.value?.object_uid ?? created.value?.uid;
  // §8.4 第 5 项：精确回读。
  const readBack = await readFrictionObject({ factSourceRoot, objectUid: uid });
  if (!readBack.ok) {
    return failure("friction/read_back_failed", `create reported success but the read-back failed: ${readBack.error.message}`);
  }
  if (readBack.value.frontmatter.status !== "observing" || readBack.value.frontmatter.occurrence?.count !== 1) {
    return failure(
      "friction/read_back_mismatch",
      `§8.4 第 3 项 requires initial status=observing and count=1; read back status=${readBack.value.frontmatter.status} count=${readBack.value.frontmatter.occurrence?.count}`,
    );
  }

  return success({
    action: "create",
    object_uid: uid,
    status: "observing",
    count: 1,
    fingerprint: readBack.value.fingerprint,
  });
}

// ---------------------------------------------------------------------------
// 第 4 项：observing → open（阈值流转）
// ---------------------------------------------------------------------------

/**
 * 判定某账目是否满足阈值流转条件（§8.4 第 4 项），**纯函数，不做副作用**。
 *
 * 触发条件是**电平条件**（三者全中即流转，不要求「恰好跨过 3」）：
 *   1. `status === "observing"`；
 *   2. `occurrence.count >= 3`；
 *   3. `occurrence.human_return_at` 为空。
 *
 * 第 3 条是 Human 决定的护栏（26 §9.2）：Human 主动「放回留观」会写入
 * `human_return_at`，机械通道**不得**据 count 把该决定翻回来。
 */
export function meetsThreshold(frontmatter) {
  const status = frontmatter?.status;
  const occurrence = frontmatter?.occurrence;
  if (status !== "observing") return false;
  if (typeof occurrence !== "object" || occurrence === null) return false;
  if (!Number.isInteger(occurrence.count)) return false;
  if (occurrence.count < FRICTION_THRESHOLD_N) return false;
  if (occurrence.human_return_at !== null && occurrence.human_return_at !== undefined) return false;
  return true;
}

/**
 * 执行阈值流转（§8.4 第 4 项）。
 *
 * 幂等：已是 open 者不匹配（`meetsThreshold` 要求 status=observing），故重复运行
 * 无副作用。**不做存量遍历**——只作用于调用方传进来的这一条（§8.4 明文）。
 */
export async function promoteIfThresholdMet({
  factSourceRoot,
  objectUid,
  sessionSignature,
}) {
  if (!isNonEmptyString(objectUid)) return failure("invalid_request", "objectUid is required");

  const current = await readFrictionObject({ factSourceRoot, objectUid });
  if (!current.ok) return current;
  if (!meetsThreshold(current.value.frontmatter)) {
    // 不满足即**不是失败**——这是正常的不匹配，调用方据此跳过。
    return success({ action: "threshold-skip", object_uid: objectUid, status: current.value.frontmatter.status, promoted: false });
  }

  const fm = current.value.frontmatter;
  const updated = await updateFrictionObject({
    factSourceRoot,
    objectUid,
    expectedFingerprint: current.value.fingerprint,
    frontmatterAfter: { ...fm, status: "open" },
    // 读-写契约不对称，同补充级更新——见 stripLeadingH1 的说明。此处若直接回传
    // `current.value.body`（含生成的 H1），写入侧会再前置一次，阈值流转即损坏载体。
    bodyMarkdownAfter: stripLeadingH1(current.value.body),
    changeSummary: `阈值流转 observing → open（count ${fm.occurrence.count} ≥ 3，04 §8.4 第 4 项）`,
    sessionSignature,
  });
  if (!updated.ok) return updated;

  // §8.4 第 5 项：精确回读。
  const readBack = await readFrictionObject({ factSourceRoot, objectUid });
  if (!readBack.ok) {
    return failure("friction/read_back_failed", `threshold transition reported success but the read-back failed: ${readBack.error.message}`);
  }
  if (readBack.value.frontmatter.status !== "open") {
    return failure("friction/read_back_mismatch", `expected status=open after the threshold transition, got ${readBack.value.frontmatter.status}`);
  }

  return success({
    action: "threshold-promote",
    object_uid: objectUid,
    count: fm.occurrence.count,
    status: "open",
    promoted: true,
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
      `the fixed threshold N is not a positive integer (got ${JSON.stringify(n)}); 04 §8.4 pins N = 3 and §8.3 requires the whole run to stop rather than proceed`,
    );
  }
  return success({ threshold: n });
}

export { fingerprintText };
