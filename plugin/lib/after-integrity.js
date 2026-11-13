/**
 * dsh-ldvh — 受控更新 after 完整性共享助手（specs/02 §10.5 / 21 §14 实现对齐）
 *
 * 背景：7 个 per-type writer 的 update 路径原以「从调用方 payload 整体构建
 * frontmatter」实现——调用方漏传某字段，该字段即被**静默删除**，无任何完整性
 * 校验。而 specs/02 :335-:344 已要求写入入口在实际写前确认「after 保留全部
 * 未变更且仍有消费价值的字段」，且「after 不完整 → 零写入并报告拒绝」。
 * `02 §15.1` 第 4 项更把「after 不完整」列为 `00 §4.7` 必停情形。
 *
 * 本模块把该义务从调用方收回服务侧，提供：
 *
 *   buildUpdateFrontmatter —— 「磁盘基线 + 显式声明变更 + 显式删除通道」
 *   四步形态（与 correct 路径同构）：
 *     ① 以 structuredClone(当前磁盘 frontmatter) 为基线、全字段先继承；
 *     ② 应用调用方**显式携带**的字段变更（判据 Object.hasOwn）；
 *     ③ 按 frontmatterRemovals 声明的键删除，仅限该类型白名单；
 *     ④ 由 writer 重设 Code 托管字段（本模块只做前三步，托管字段另行覆盖）。
 *
 *   声明集判据：调用方在 frontmatterAfter 中**实际携带的键**即声明集。
 *     - after 带该键          → 覆盖；
 *     - 不带且不在 removals    → **继承磁盘**；
 *     - 需要删除必须经 removals 显式声明，**不得靠「after 不带该键」表达**。
 *
 * 契约反转的如实声明：本改动把 update 语义从「省略即删除」反转为「省略即保留」。
 * 依赖旧语义的调用方必须改用 frontmatterRemovals，否则表现为「字段未按预期删除」
 * 而非静默数据丢失——这正是本改动要的方向（误操作应显式失败/可见，而非静默错误）。
 *
 * specs/02 :333 禁止的是**未定义的**差量 merge；本形态的声明集由 Object.hasOwn
 * 精确定义，其产物即「完整目标 after」，不在禁令之列。
 *
 * 本模块另提供**一处** uid 拒绝诊断助手（`uidRejectionHint`）：九个 writer 的
 * 写路径 uid 门口径相同（只接受 canonical UUIDv4），拒绝信息若只说「不是
 * UUID」，调用方拿不到「照抄什么就能过」。诊断文案与形态判定由本模块统一
 * 计算，schema 与 writer 不可能漂移。
 */

import { parseObjectIdentifier } from "./object-identifier.js";

/**
 * Code 托管字段：永远由 writer 重设，既不得经 after 覆盖、也不得经 removals 删除。
 * （`object_uid`/`fact_type_key` 是对象身份，`created_at` 是创建时刻，
 *   `change_log` 由 writer 追加恰好一条，见 02 §8.2 第 7 条。）
 */
const CODE_MANAGED_FIELDS = new Set(["object_uid", "fact_type_key", "created_at", "change_log"]);

/**
 * 构造受控更新的目标 frontmatter。
 *
 * @param {object} params
 * @param {object} params.currentFrontmatter 磁盘当前 frontmatter（CAS 基线对象）
 * @param {object|null} params.frontmatterAfter 调用方提供的「显式声明集」（可只含要改的键）
 * @param {string[]|null} params.frontmatterRemovals 显式删除声明（键名数组）
 * @param {Set<string>} params.removableFields 该类型的可删白名单
 * @param {string} params.typeLabel 用于错误信息（如 "friction"）
 * @param {Set<string>} [params.validFields] 该类型 VALID_FM_KEYS，用于拒绝未知键
 * @returns {{ok:true, value:object} | {ok:false, error:{code:string, message:string}}}
 */
export function buildUpdateFrontmatter({
  currentFrontmatter,
  frontmatterAfter,
  frontmatterRemovals,
  removableFields,
  typeLabel,
  validFields,
}) {
  const fail = (code, message) => ({ ok: false, error: { code, message } });

  if (currentFrontmatter === null || typeof currentFrontmatter !== "object") {
    return fail(`${typeLabel}/after_integrity_invalid`, "currentFrontmatter must be a disk baseline object (02 §10.5)");
  }
  if (frontmatterAfter !== null && frontmatterAfter !== undefined && typeof frontmatterAfter !== "object") {
    return fail(`${typeLabel}/after_integrity_invalid`, "frontmatterAfter must be an object when provided");
  }

  // ---- 显式删除声明的形状校验（先于任何合并，保证零写入）----
  let removals = [];
  if (frontmatterRemovals !== null && frontmatterRemovals !== undefined) {
    if (!Array.isArray(frontmatterRemovals)) {
      return fail(`${typeLabel}/removals_invalid`, "frontmatter_removals must be an array of field names");
    }
    const seen = new Set();
    for (const key of frontmatterRemovals) {
      if (typeof key !== "string" || key.length === 0) {
        return fail(`${typeLabel}/removals_invalid`, `frontmatter_removals entries must be non-empty strings, got ${JSON.stringify(key)}`);
      }
      if (seen.has(key)) {
        return fail(`${typeLabel}/removals_invalid`, `frontmatter_removals declares ${JSON.stringify(key)} more than once`);
      }
      seen.add(key);
      removals.push(key);
    }
  }

  // 白名单校验：白名单外字段一律拒绝（fail-closed，不静默忽略）
  for (const key of removals) {
    if (CODE_MANAGED_FIELDS.has(key)) {
      return fail(
        `${typeLabel}/removal_forbidden`,
        `frontmatter_removals may not delete Code-managed field ${JSON.stringify(key)} (writer re-stamps it; 02 §8.2)`,
      );
    }
    if (!removableFields.has(key)) {
      const allowed = [...removableFields].sort();
      return fail(
        `${typeLabel}/removal_not_allowed`,
        `frontmatter_removals may not delete ${JSON.stringify(key)} — not in this type's removable set (${allowed.length === 0 ? "empty" : allowed.join(", ")})`,
      );
    }
  }

  // 同一键既声明覆盖又声明删除 → 声明集自相矛盾，拒绝（不猜调用方意图）
  for (const key of removals) {
    if (frontmatterAfter !== null && frontmatterAfter !== undefined && Object.hasOwn(frontmatterAfter, key)) {
      return fail(
        `${typeLabel}/removals_conflict`,
        `field ${JSON.stringify(key)} is both carried in frontmatter_after and listed in frontmatter_removals — declare one or the other`,
      );
    }
  }

  // ① 磁盘基线：全字段先继承（深拷贝，避免污染 CAS 基线对象）
  const next = structuredClone(currentFrontmatter);

  // ② 应用显式声明的变更（判据：Object.hasOwn —— 只认实际携带的键）
  if (frontmatterAfter !== null && frontmatterAfter !== undefined) {
    for (const key of Object.keys(frontmatterAfter)) {
      if (key === "change_summary") continue; // 调用期参数，非字段（各 writer 原有剥离行为）
      if (CODE_MANAGED_FIELDS.has(key)) continue; // 托管字段不接受调用方覆盖，由 writer 重设
      if (validFields instanceof Set && !validFields.has(key)) {
        return fail(
          `${typeLabel}/frontmatter_invalid`,
          `frontmatter_after carries unexpected field ${JSON.stringify(key)} (closed-set violation)`,
        );
      }
      next[key] = structuredClone(frontmatterAfter[key]);
    }
  }

  // ③ 显式删除（仅限白名单内、且已在上面校验过）
  for (const key of removals) {
    delete next[key];
  }

  return { ok: true, value: next };
}

/**
 * 更新路径的 schema 描述口径（继承基线 / 显式删除通道），供各 per-type tools 复用，
 * 避免 7 处文案各自漂移。
 *
 * **口径说明**：本模块实现的形态是「磁盘基线 + 显式声明变更 + 显式删除通道」三路
 * ——未在通道内重述的字段**继承基线**，需要删除的字段**只经 `frontmatter_removals`
 * 显式声明**。「省略即删除」不是本模块的语义。
 */
export const FRONTMATTER_AFTER_DESCRIPTION =
  "update: the fields to CHANGE (specs/02 §10.5 实现对齐). "
  + "Declare ONLY the fields you are changing — every field you omit is INHERITED from the on-disk baseline, "
  + "not deleted (省略即保留). To delete a field, list it in `frontmatter_removals` instead — "
  + "「after 不带该键」不再表示删除（省略即删除的旧语义已反转）. "
  + "Code-managed fields (object_uid/fact_type_key/created_at/change_log) are re-stamped by Code and ignored here.";

export const FRONTMATTER_REMOVALS_DESCRIPTION =
  "update: explicit deletion declarations (显式删除通道 / specs/02 §10.5). "
  + "Array of field names to DELETE from the target frontmatter. Only fields this type declares as removable "
  + "are accepted — anything else is refused with zero writes (fail-closed). "
  + "A field may not appear in both `frontmatter_after` and `frontmatter_removals`.";

export { CODE_MANAGED_FIELDS };

// ---------------------------------------------------------------------------
// 写路径 uid 严格门的拒绝诊断（只增诊断，不改判定）
// ---------------------------------------------------------------------------

/**
 * 写路径 uid 严格门拒绝时，给出「照抄什么就能过」的可操作诊断。
 *
 * **门禁判定不变**：本函数不参与放行/拒绝判定，只产出 details 与 message 后缀。
 * 写路径只接受 canonical UUIDv4（既定边界，不放宽）；但调用方常传
 * `<type>-<uuid>` 这类形态，被拒时只得到一句「不是 UUID」——不知道该传什么，
 * 于是反复试（实测受控写入 47% 硬失败，最大一类即此）。
 *
 * **只做纯形态解析**（`parseObjectIdentifier`）：不读文件、不做载体反查。
 * 因此短标识形态（`<type>-<8hex>` 等）无法给出 canonical uid——反查要触事实源，
 * 属额外 IO，故**不回带**，只在 message 里提示改用完整 canonical UUIDv4。
 *
 * @param {string} rawInput 调用方原始输入（未经归一）。
 * @returns {{details: {canonical_object_uid?: string, identifier_form?: string},
 *            messageSuffix: string}}
 */
export function uidRejectionHint(rawInput) {
  const parsed = parseObjectIdentifier(rawInput);
  if (!parsed.ok) {
    // 形态都认不出 → 无据可依，维持原 message 不变（不猜）。
    return { details: {}, messageSuffix: "" };
  }
  const { objectUid, shortId, declaredType, projectId } = parsed.value;
  if (objectUid !== undefined) {
    // 形态 1（裸 UUID）/ 形态 2（`<type>-<uuid>`）/ 形态 4（`<projectId>@…`）：
    // uuid 部分本身就是 canonical，可直接照抄。
    const identifier_form = projectId !== undefined
      ? (declaredType !== undefined ? "project_scoped_type_prefixed_uuid" : "project_scoped_uuid")
      : (declaredType !== undefined ? "type_prefixed_uuid" : "bare_uuid");
    return {
      details: { canonical_object_uid: objectUid, identifier_form },
      messageSuffix: ` — the canonical object_uid for this identifier is "${objectUid}"; pass that value verbatim as object_uid`,
    };
  }
  // 短标识形态：canonical uid 需载体反查才能确定（额外 IO），故不回带。
  return {
    details: {},
    messageSuffix: ` — "${shortId}" is a short identifier; the write path requires the FULL canonical UUIDv4 — read the object first and pass its object_uid`,
  };
}
