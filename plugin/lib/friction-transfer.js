/**
 * dsh-ldvh — 审核段的**转写入口**：把「失败已发生、机制已清楚、只是还没解决」的
 * 经验缓冲条目转写为摩擦观察条目（specs/11 §10.2 第 5 项、§9 第 2 项「审核层转写」段，
 * 2026-11-01 B 方案）。
 *
 * ## 这个模块补的是什么
 *
 * 经验缓冲里有一类材料：**能说清「有一个失败发生过」且「它的机制是什么」，唯独写不出
 * 「解决」「验证」两段**——也就是**还没修好，而不是没看懂**。它们此前走到
 * `discarded`，然后 90 天后随保留期删除；而摩擦侧只把同一现象算作**1 次**观察
 * （捕获段写缓冲时不会同时写摩擦观察），未达 N=3 也不进账本。于是「两把尺子各判一遍」
 * 的接缝处**两边都不收**，事情就此消失，而两边都没记错。
 *
 * 实测（2026-11-01）：折叠后 19 条 `discarded` **全部**属于这一类。这条带隙本身已被
 * 观察为摩擦条目 `experience-capture-review-band-gap`。
 *
 * 本模块只做那一件事：**把材料搬到另一个载体去继续走它该走的路**——摩擦观察缓冲。
 * 转写不是晋升：落下的是一条 `pending` 条目，仍须攒够 N 才成账。
 *
 * ## 不属于本模块的判断
 *
 * - **「这条该不该转」是语义判断**（机制是否已清楚、是否真的只是没解决），由审核段
 *   执行体给出 `transfer` 提案，本模块只做机械校验；
 * - `group`（聚合键）、`title`/`basis`/`attribution`/`impact`（晋升后账目的正文与评级
 *   来源）也由执行体给出。**机械侧不代填**：`group` 代填等于替执行体做了同源判定，
 *   那四项代填等于把「未解决的失败」直接写成账目。
 *
 * ## 三道机械闸（§18「转写条目的合法性」行）
 *
 * 1. **来源条目确已置 `discarded`**——转写不改变它的结算状态，也不得先删它腾位；
 * 2. **证据不走样**——`phenomenon`/`evidence`/`session`/`anchor` 逐字取自来源条目，
 *    `evidence` 是捕获段已校验过的区间材料逐字片段，任何改写/截断/重拼都使该证据
 *    在缓冲淘汰后无从复核（02 §6.1 第 3 条）；
 * 3. **逐字幂等**——同一**引证主体**（`evidence` 去掉尾部署名行，见 `evidenceSubject`）
 *    已在摩擦缓冲里（**任何状态**，含已 `promoted`）即跳过。这条防的是**双重计数**：
 *    同一现象既被发现层记过、又被转写一次，该组会虚增到阈值并建出本不该有的账目。
 *    **比对键是主体不是整串**（2026-11-01 审核 F3 修）：两条路径的来源行形态不同
 *    （发现层 `（来源：turn 12..18）`、转写 `来源：session …`），逐字比对永不相等。
 *
 * 幂等是**跳过而非失败**：它说明「该观察已记过」，正是期望的结果。失败只留给
 * 「想转但转不成」（字段不全、写入失败、回读不符）。
 */

import {
  appendFrictionObservation,
  readFrictionObservations,
  FRICTION_OBSERVATION_IMPACTS,
} from "./friction-observation-buffer.js";

function success(value) {
  return { ok: true, value };
}

function failure(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 转写提案必须给出的五项（都属语义判断，机械侧不代填）。 */
export const TRANSFER_REQUIRED_FIELDS = Object.freeze([
  "title",
  "basis",
  "attribution",
  "impact",
  "group",
]);

/**
 * 取出 `evidence` 的**引证主体**——去掉尾部的来源行，只留逐字引证本身。
 *
 * **为什么必须归一化**（2026-11-01 审核 F3 修）：两条路径写下的 `evidence` 形态不同，
 * 而它们指的可能**正是同一次观察**：
 *
 *   - 发现层：`` `${quote}\n（来源：${anchor}）` ``（全角括号 + `anchor` 形如 `turn 12..18`）；
 *   - 转写：  经验捕获段写下的 `` `${quote}\n来源：${session} …` ``（无括号 + 会话标识）。
 *
 * 逐字比对两串**永不相等**，于是最该被挡住的那个场景——「发现层已经记过这条，转写
 * 又记一次」——恰好挡不住，同一 `group` 里出现两条不同 `evidence`，`count` 虚增到
 * 阈值并建出本不该有的账目。
 *
 * 归一化只去掉**尾部的来源行**（以及尾随空行），引证主体一字不动——「证据不走样」
 * 仍由闸 2 保证。
 *
 * **已知代价（如实登记）**：两次真正独立、但引用同一段原文的观察会被并成一次，
 * `count` 少记一次、阈值推迟。这是刻意选的失效方向——少记可以靠后续观察补齐，
 * 多记会直接建出重复账目且无法自动撤销。
 */
export function evidenceSubject(evidence) {
  if (typeof evidence !== "string") return "";
  const lines = evidence.split("\n");
  // 只剥**尾部**的来源行：引证主体内部若恰好有以「来源：」开头的行，不该被误删。
  for (;;) {
    if (lines.length === 0) break;
    const last = lines[lines.length - 1].trim();
    if (last === "") {
      lines.pop();
      continue;
    }
    if (/^[（(]?\s*来源\s*[：:]/.test(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}

/**
 * 校验一份转写提案的**形状**（不含语义判断）。
 *
 * @returns {{ok:true,value:object}|{ok:false,error:object}}
 */
export function validateTransferProposal(transfer) {
  if (transfer === null || typeof transfer !== "object" || Array.isArray(transfer)) {
    return failure("friction_transfer/invalid_proposal", "the transfer proposal must be an object");
  }
  for (const field of TRANSFER_REQUIRED_FIELDS) {
    const value = transfer[field];
    if (!isNonEmptyString(value)) {
      return failure(
        "friction_transfer/proposal_incomplete",
        `the transfer proposal must carry ${field} — it is the review executor's semantic judgement and the mechanical side must not invent it (11 §9 第 2 项「审核层转写」段)`,
      );
    }
  }
  if (!FRICTION_OBSERVATION_IMPACTS.includes(transfer.impact)) {
    return failure(
      "friction_transfer/invalid_impact",
      `impact must be one of ${JSON.stringify([...FRICTION_OBSERVATION_IMPACTS])} (got ${JSON.stringify(transfer.impact)})`,
    );
  }
  return success({
    title: transfer.title.trim(),
    basis: transfer.basis.trim(),
    attribution: transfer.attribution.trim(),
    impact: transfer.impact,
    group: transfer.group.trim(),
    // 可选的目标账目：转写时若判明它属于某笔**已存在**的 open 账目的同源复观，
    // 带上 target_uid 即走 §9 第 4 项的补充路径（审核层下一拍处理），而不是攒新组。
    target_uid: isNonEmptyString(transfer.target_uid) ? transfer.target_uid.trim() : null,
  });
}

/**
 * 把一条经验缓冲条目转写为摩擦观察条目。
 *
 * @param {object} args
 * @param {Function} args.dshHomePath - 路径拼接器（`observation-buffer.js` 同一约定）
 * @param {string} args.projectId - 管辖项目
 * @param {object} args.entry - 来源经验缓冲条目（须已 `discarded`）
 * @param {object} args.transfer - 执行体给出的五项 + 可选 `target_uid`
 * @param {Date} [args.now]
 * @returns {Promise<{ok:true,value:{written:boolean,reason?:string,entry_id?:string}}|{ok:false,error:object}>}
 */
export async function transferDiscardedEntryToFriction({
  dshHomePath,
  projectId,
  entry,
  transfer,
  now = new Date(),
} = {}) {
  if (typeof dshHomePath !== "function") {
    return failure("friction_transfer/invalid_request", "dshHomePath must be the path-joining function of the buffer modules");
  }
  if (!isNonEmptyString(projectId)) {
    return failure("friction_transfer/invalid_request", "projectId is required (the friction carrier is partitioned per governed project, 11 §12bis.1)");
  }
  if (entry === null || typeof entry !== "object") {
    return failure("friction_transfer/invalid_request", "the source experience entry is required");
  }

  // ── 闸 1：来源条目确已 discarded ─────────────────────────────────────
  //
  // 调用方在**结算之后**才调本函数，故这里看到的已是终态。若状态不是 discarded，
  // 说明调用顺序被打乱（或有人想借转写顺手清掉一条 pending）——拒绝，不猜。
  // 该判定同时钉住「转写不改变来源条目的结算状态」：本函数**没有**回写经验缓冲的
  // 任何代码路径（它只 import 了摩擦侧模块），这一点是结构性的。
  if (entry.status !== "discarded") {
    return failure(
      "friction_transfer/source_not_discarded",
      `entry ${String(entry.id)} has status ${JSON.stringify(entry.status ?? null)}; only an entry already settled as discarded may be transferred (11 §18「转写条目的合法性」)`,
    );
  }

  // ── 闸 2：证据不走样 ────────────────────────────────────────────────
  //
  // 这里的「逐字」不是靠比较两个字符串是否相等（转写本来就要**复制**它们），而是
  // 靠**只从来源条目取值**：本函数不接收 phenomenon/evidence/session/anchor 的任何
  // 外部输入，故「改写」在结构上不可能。这条纪律写在函数签名上，不写在注释里。
  for (const field of ["phenomenon", "evidence", "session", "anchor"]) {
    if (!isNonEmptyString(entry[field])) {
      return failure(
        "friction_transfer/source_field_missing",
        `the source entry has no ${field}; a transfer must copy phenomenon/evidence/session/anchor verbatim from it (11 §18「转写条目的合法性」)`,
      );
    }
  }

  const proposal = validateTransferProposal(transfer);
  if (!proposal.ok) return proposal;

  // ── 闸 3：逐字幂等（任何状态）────────────────────────────────────────
  //
  // 只查 pending 不够：晋升后的条目虽已退出 pending，其证据已复制进账目；再转写
  // 一次等于给同一阻碍虚增一次观察，该组会凑满阈值并建出重复账目。
  const existing = await readFrictionObservations(dshHomePath, projectId, { now });
  if (!existing.ok) {
    return failure(
      existing.error?.code ?? "friction_transfer/buffer_unreadable",
      `cannot read the friction observation buffer for the idempotency check: ${existing.error?.message ?? "unknown"} (11 §12 fail-closed, never degrade to memory or a log)`,
    );
  }
  const evidence = entry.evidence;
  // 比对键是**引证主体**而非整串 `evidence`：两条路径的来源行形态不同（发现层
  // `（来源：turn 12..18）`、转写 `来源：session …`），逐字比对永不相等（F3）。
  // 主体为空时退回逐字比对——那时没有可归一的依据，宁可漏挡也不误挡。
  const subject = evidenceSubject(evidence);
  const duplicate = existing.value.items.find((item) => (
    subject.length > 0
      ? evidenceSubject(item.evidence) === subject
      : item.evidence === evidence
  ));
  if (duplicate !== undefined) {
    // **跳过不是失败**：该观察已记过，正是期望的结果。如实带出被跳过的事实与原因。
    return success({
      written: false,
      reason: "already-recorded",
      existing_id: duplicate.id,
      existing_status: duplicate.status,
      existing_group: duplicate.group,
    });
  }

  // ── 追加 ───────────────────────────────────────────────────────────
  //
  // `anchor` 用来源条目的（形如 `turn 12..18`，或发现层的区间终点）。它指向该现象
  // 被观察到的位置，与摩擦发现自己写的 `anchor` 语义相同，故可共用同一字段。
  const appended = await appendFrictionObservation(dshHomePath, {
    project: projectId,
    session: entry.session,
    anchor: entry.anchor,
    phenomenon: entry.phenomenon,
    evidence: entry.evidence,
    group: proposal.value.group,
    title: proposal.value.title,
    basis: proposal.value.basis,
    attribution: proposal.value.attribution,
    impact: proposal.value.impact,
    ...(proposal.value.target_uid === null ? {} : { target_uid: proposal.value.target_uid }),
  }, { now });
  if (!appended.ok) {
    // **分区两种失败**（2026-11-01 第五轮审核发现 ①）：
    //
    // `appendFrictionObservation` 的失败不都是「没写进去」。容量淘汰失败时它返回
    // `error.written === true`——观察**已经落盘**，没做的是淘汰。若这里统一包成
    // 「could not be appended」，消息会自相矛盾（前半句「没能追加」、后半句「已经在
    // 载体里」），而调用方据「失败」写下的登记会与事实相反：「材料未能转写到摩擦
    // 观察缓冲」——材料其实就在里面。
    //
    // 故 `written === true` 时如实报「已落地、淘汰未生效」，并带出 entry_id，使调用方
    // 能按「转写已成功」处置、而不是报成未转写。
    if (appended.error?.written === true) {
      return failure(
        "friction_transfer/appended_with_eviction_pending",
        `the transfer entry WAS appended (id ${String(appended.error.entry_id)}), but the `
        + `subsequent capacity eviction did not run: ${appended.error?.message ?? "unknown"} `
        + `(11 §12 — the write took effect; register the eviction side, not a failed transfer)`,
        { written: true, entry_id: appended.error.entry_id },
      );
    }
    return failure(
      appended.error?.code ?? "friction_transfer/append_failed",
      `the transfer entry could not be appended: ${appended.error?.message ?? "unknown"} (11 §12 fail-closed — do not record it in memory or a log instead)`,
    );
  }

  // ── 写后精确回读（§9 第 5 项 / §12bis.1 纪律 4）─────────────────────
  const readBack = await readFrictionObservations(dshHomePath, projectId, { now });
  if (!readBack.ok) {
    return failure(
      readBack.error?.code ?? "friction_transfer/read_back_failed",
      `the transfer entry was appended but the buffer cannot be re-read: ${readBack.error?.message ?? "unknown"} (11 §9 第 5 项 — fail-closed, keep the side effect and register it)`,
      { written_entry_id: appended.value.entry_id },
    );
  }
  const found = readBack.value.items.find((item) => item.id === appended.value.entry_id);
  if (found === undefined) {
    return failure(
      "friction_transfer/read_back_incomplete",
      `the transfer entry ${appended.value.entry_id} was appended but is not present on read-back (11 §9 第 5 项 — the append did not take effect; fail-closed, never report a success shape)`,
      { written_entry_id: appended.value.entry_id },
    );
  }
  if (found.evidence !== evidence || found.phenomenon !== entry.phenomenon || found.group !== proposal.value.group) {
    return failure(
      "friction_transfer/read_back_mismatch",
      `the transfer entry ${appended.value.entry_id} read back with different evidence/phenomenon/group than written (11 §9 第 5 项 — the carrier did not preserve the copied evidence verbatim)`,
      { written_entry_id: appended.value.entry_id },
    );
  }

  return success({ written: true, entry_id: appended.value.entry_id });
}
