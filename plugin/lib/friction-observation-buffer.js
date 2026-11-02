/**
 * dsh-ldvh — 摩擦观察缓冲（第二类留观缓冲）（specs/11 §12bis.1）。
 *
 * 权威来源（本模块是它的实现，不复述其规范效力）：
 *   - `specs/11-宿主辅助任务规范.md` §12bis.1「摩擦观察缓冲（第二类缓冲）」——**载体
 *     契约的唯一权威**：字段闭集、容量上限、保留期、状态闭集、写入与读取纪律、
 *     以及「晋升时证据必须复制进账目」；
 *   - 同规范 §9 第 2／3／4 项——写入者（摩擦发现）、晋升判据（同源 `group` 的
 *     `pending` 条目数 ≥ N=3）、对既有账目的补充级更新；
 *   - 同规范 §18 三行——条目写入合法、到期淘汰须登记、按项目分区与 `governed` 准入；
 *   - 同规范 §20.1 第 11 项——`pending` 条目因容量或保留期淘汰时**必须先登记**
 *     其未晋升事实（静默丢弃一个已达 2/3 的组，等于丢掉一笔差一次就该成立的账）；
 *   - `specs/02-事实源与事实模型基础规范.md` §6.1 末三条边界与 §6.1 第 2 条
 *     「每个中间载体必须由某个规范指明唯一消费者」。
 *
 * ## 与经验缓冲（observation-buffer.js）的关系：两个载体，不是一套
 *
 * §12bis 的经验缓冲唯一消费者是经验审核段；本缓冲唯一消费者是 §9 的摩擦发现
 * （查重、聚合与晋升判定）。**02 §6.1 第 2 条**要求每个中间载体有唯一且被写明的
 * 消费者——把两类材料塞进一个载体即违反该条。故二者**必须是两个文件**，共用的是
 * 同一套契约形状（非事实、有界、可淘汰、追加 + 状态结算），不是同一个载体。
 *
 * ## 本模块的纪律边界（照 §12bis.1 定性）
 *
 * 1. **不是事实对象**：不写事实源、不产生 `object_uid`、不适用事实类型契约、不参与
 *    受控写入与 CAS、不被 F0–F4 召回检索、不承载关系、不取得任何授权或结论效力。
 *    条目的存在、数量与 `status` 变化**均不构成任何 Friction 账目的证据**，也**不推动
 *    任何账目状态流转**（账目的状态推进只有 Human Gate）。
 * 2. **按管辖项目分载体**（§12bis 载体段 + §12bis.1）：载体路径含项目 id
 *    （`~/.dsh/ldvh/friction-observations/<projectId>.jsonl`），且条目自带 `project`
 *    字段——分区是载体层、`project` 是条目层，二者须自洽。**不得**把多个项目的观察
 *    混装在一个无项目维度的载体里（这正是本项目此前的缺陷，已入账 `11f4eb8f`）。
 * 3. **保留期不得沿用经验缓冲的 30 天口径**（§12bis.1 差异第 3 条）：「攒够 3 次」可能
 *    跨越数周，30 天会使某些组**永远攒不够**。故 `pending` 保留期取 **90 天**。
 * 4. **不可写即 fail-closed**：载体不可写或不可回读时一律返回失败码，调用方据此按
 *    §12 停止；**不得**降级为「只记在内存」或「只写日志」。
 * 5. **晋升时证据必须复制进账目**：本模块只提供聚合读数（`group` 计数），**不代替**
 *    §9 第 3 项做那次复制。若账目正文只写 `buffer:<id>`，缓冲一淘汰账目即成无法核对的
 *    转述（02 §6.1 第 3 条）——该复制由晋升调用方负责，本模块的 `settle` 不检查它。
 * 6. **机械层不判断同源**：`group` 值由 §9 第 1 项的语义判定给出，本模块**只做相等
 *    比较**，不判断两个 `group` 是否指向同一阻碍。该判断的正确性不由机械校验保障
 *    （§18「阈值晋升」行的可证明范围）。
 *
 * ## 容量口径
 *
 * 与经验缓冲同一取舍：「条目数上限 200」指**在管条目**（`status ≠ evicted`），被淘汰
 * 条目 `status=evicted` 并**保留记录**（否则淘汰记录本身即越过上限，两条要求不可同真）。
 * 上限按**项目独立计算**（§12bis.1 容量段）。
 *
 * ## 保留期的结算时机
 *
 * 与经验缓冲同一形态：**读时惰性结算**。`pending` 超 90 天转 `evicted`（落盘），终态超
 * 90 天整条移除（落盘）。惰性回写失败不使整次读失败——失败进入 `invalid` 并把
 * `complete` 置 false，读本身仍返回可用结果。
 *
 * **淘汰须登记，且登记在淘汰之前**（§20.1 第 11 项、§18 表「摩擦观察条目到期淘汰的
 * 登记」行）：该行把失败处置定为「**不得淘汰**；该次淘汰无效并如实报告」——即登记
 * 与淘汰的**先后**是硬要求，登记不成立时淘汰必须整体不发生。这个先后只有把两者放在
 * 同一处才能保证，故**本模块自己写待处置队列**，不委托调用方。
 *
 * **这是一处实现缺陷的修复记录（2026-11-01，如实登记）**：此前本模块把被淘汰条目放进
 * 返回值的 `evicted_pending` 就结束，注释写「调用方须据此登记」，而**全仓没有任何调用方
 * 登记过**（`friction-landing.js` 只把它塞进返回值，`experience-review-stage.js` 与
 * `friction-review-promotion.js` 都不读它）。于是保留期淘汰一直是**静默**的，直接违反
 * §20.1 第 11 项与 §18 该行。根因是「职责分离」被当成了免责：把义务写进注释、没有
 * 任何一方真做，等于没有义务。登记挪进本模块后，`evicted_pending` 仍随返回值带出，
 * 但它的性质从「需要别人处理的待办」变为「已经处理完的事实回执」。
 */

import { readFile, mkdir, appendFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { appendPendingEntry, readPendingQueue, resolvePendingEntry } from "./pending-queue.js";

/** DSH home 下摩擦观察缓冲的目录（**不在事实源内**，与经验缓冲分开）。 */
export const FRICTION_OBSERVATION_DIR = Object.freeze(["ldvh", "friction-observations"]);

/** 条目状态闭集（§12bis.1 字段表 `status` 行）。 */
export const FRICTION_OBSERVATION_STATUSES = Object.freeze([
  "pending",
  "promoted",
  "discarded",
  "evicted",
]);

/** 每个项目的在管条目数上限（§12bis.1 容量段）。 */
export const FRICTION_OBSERVATION_CAPACITY = 200;

/**
 * `pending` 条目的保留期（天）。
 *
 * **与经验缓冲的 30 天不同**（§12bis.1 差异第 3 条）：摩擦的「攒够 3 次」可能跨越
 * 数周甚至数月，30 天保留期会使某些组永远攒不够。
 */
export const FRICTION_OBSERVATION_PENDING_TTL_DAYS = 90;

/** 终态条目的保留期（天）：自状态变更起整条移除。 */
export const FRICTION_OBSERVATION_SETTLED_TTL_DAYS = 90;

/** 晋升阈值 N（§9「阈值 N」段：固定内嵌为 3，不可配置）。 */
export const FRICTION_OBSERVATION_THRESHOLD_N = 3;

/**
 * §12bis.1 的字段闭集。
 *
 * **2026-10-30 新增 `title`/`basis`/`attribution`/`impact` 四项（Human 决定）**：
 * 晋升从发现层搬到审核层后，晋升所需的这几项必须由缓冲承载——它们原本只存在于
 * 发现层当次运行的结构化 `verdict` 里，审核层在下一次运行时已无从取得，跨运行
 * 晋升会因缺字段而无法建账（`promoteReadyGroup` 缺 `title`/`basis` 即失败）。
 * （原为四项，含 `impact`；**2026-11-02 该字段随 26 §8 的字段删除一并撤销**——
 * Human 定案「摩擦取消 中 轻 重 这种分级制度」，闭集 15 → 14 项。）
 *
 * 这几项在 `same-observation-group` / `new-observation` 两态必填（由子代理的
 * verdict 产出）；`same-obstacle` 与 `no-discovery` 两态不写缓冲，故不涉及。
 * 存量条目已在 2026-10-30 一并清零（Human 决定），不存在缺字段的历史条目。
 */
export const FRICTION_OBSERVATION_FIELDS = Object.freeze([
  "id",
  "at",
  "project",
  "session",
  "anchor",
  "phenomenon",
  "evidence",
  "group",
  "target_uid",
  "title",
  "basis",
  "attribution",
  "status",
  "promoted_to",
]);

/** 实现侧附加记账字段（不在 §12bis.1 的闭集内）：保留期计算所需。 */
export const FRICTION_OBSERVATION_SETTLED_AT_FIELD = "settled_at";

/** `phenomenon` 长度上限——「一句话」的机械上限。 */
export const FRICTION_OBSERVATION_MAX_PHENOMENON_LENGTH = 400;

/**
 * `evidence` 长度上限。
 *
 * 晋升时全部条目的 `evidence` 会被复制进一笔账目的正文，故单条上限不宜过大；
 * 4000 与经验缓冲同口径（§12bis.1 只说「逐字片段」，不设数值，此为实现的粗粒度护栏）。
 */
export const FRICTION_OBSERVATION_MAX_EVIDENCE_LENGTH = 4000;

/** `session` / `anchor` / `group` / `project` 长度上限：都是标识，不是内容。 */
export const FRICTION_OBSERVATION_MAX_REFERENCE_LENGTH = 256;

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = FRICTION_OBSERVATION_PENDING_TTL_DAYS * DAY_MS;
const SETTLED_TTL_MS = FRICTION_OBSERVATION_SETTLED_TTL_DAYS * DAY_MS;

/** 追加入口接受的入参字段闭集——`id`/`status`/`promoted_to` 由实现赋值。 */
const APPEND_INPUT_FIELDS = new Set([
  "at",
  "project",
  "session",
  "anchor",
  "phenomenon",
  "evidence",
  "group",
  "target_uid",
  "title",
  "basis",
  "attribution",
]);

/** 存量条目允许出现的字段（§12bis.1 闭集 + 实现侧附加记账字段）。 */
const STORED_FIELDS = new Set([
  ...FRICTION_OBSERVATION_FIELDS,
  FRICTION_OBSERVATION_SETTLED_AT_FIELD,
]);

const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** 纯指代词表：只写「见上／同上」这类不含来源信息的 `evidence`。 */
const PURE_REFERENCE_EVIDENCE = new Set([
  "见上",
  "见上文",
  "见上所述",
  "见以上",
  "见前",
  "见前文",
  "如上",
  "同上",
  "同上所述",
  "以上",
  "以上所述",
  "上述",
  "上面",
  "asabove",
  "sameasabove",
  "same",
  "ditto",
  "seeabove",
]);

function normalizeReference(text) {
  return text
    .toLowerCase()
    .replace(/[\s\u3000]/g, "")
    .replace(/[，。；：、！？,.;:!?"'`（）()【】[\]…—-]/g, "");
}

function success(value) {
  return { ok: true, value };
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 淘汰登记的幂等键前缀（2026-11-01 第四轮审核 F1 修）。
 *
 * 保留期淘汰是**读时惰性结算**：同一批超期条目在每次读取时都会被重新判定为「该淘汰」。
 * 若上一次登记写进了队列、而载体回写失败（只读挂载、权限、崩溃窗口），下次读取就会
 * 再次进入登记——届时队列里那条登记还没被销账，于是同一事实被重复登记、且永远不销账。
 *
 * 故登记前先按这个键查未完成项去重。键由「原因类 + 被淘汰条目 id 全集（排序）」构成：
 * 同一批条目重复判定时键相同，不同批次（哪怕原因相同）键不同。
 */
const EVICTION_KEY_PREFIX = "登记键：";

function evictionRegistrationKey(ids, reason) {
  return `${EVICTION_KEY_PREFIX}${reason}|${[...ids].sort().join(",")}`;
}

/**
 * 把一批「即将被淘汰的 `pending` 条目」登记进待处置队列（§20.1 第 11 项 / §18 该行）。
 *
 * **必须在淘汰落盘之前调用，且必须整体成功**：§18 的失败处置是「不得淘汰；该次淘汰
 * 无效并如实报告」。故本函数返回失败时，调用方**不得**继续淘汰——半登记半淘汰会让
 * 「已淘汰但无登记」这种最坏形态恰好发生在登记失败时。
 *
 * 登记粒度是**组**而不是条目：一条被淘汰的观察单独看没有意义，有意义的是一句
 * 「这一组攒到 N 条就差一步，但它超期了」。同组的多条同时到期时合并成一条登记。
 *
 * @param {(...parts: string[]) => string} dshHomePath - DSH home 路径拼接器
 * @param {Array<{id:string, group:string, pending_count_at_eviction:number, threshold:number}>} evicted
 * @param {string} reason - 触发原因（保留期到期 / 容量淘汰），写进登记正文
 * @returns {Promise<{ok:true, value:{registered:string[]}} | {ok:false, error:object}>}
 */
async function registerEvictedPending(dshHomePath, evicted, reason) {
  if (!Array.isArray(evicted) || evicted.length === 0) {
    return success({ registered: [], reused: [] });
  }

  // 按组归并：同组多条只登记一次，但要把被淘汰的条目 id 全列出来。
  const byGroup = new Map();
  for (const item of evicted) {
    const key = typeof item.group === "string" && item.group.length > 0 ? item.group : "(无 group)";
    if (!byGroup.has(key)) byGroup.set(key, { ids: [], count: item.pending_count_at_eviction, threshold: item.threshold });
    const bucket = byGroup.get(key);
    bucket.ids.push(item.id);
    // 同组多条时取**淘汰前**的最大计数（几条同时淘汰时，任一条的 count 都是同一批量）。
    bucket.count = Math.max(bucket.count, item.pending_count_at_eviction);
  }

  // **登记前查重（第四轮审核 F1）**：读不到队列就不能确认「这条淘汰事实是否已登记过」，
  // 也就无法保证不重复登记——按 §18 同一失败处置 fail-closed，拒绝淘汰。
  const existing = await readPendingQueue(dshHomePath);
  if (!existing.ok) {
    return failure(
      "friction_observation/eviction_unregistered",
      `refusing to evict: the pending queue cannot be read to check for an existing registration `
      + `(${existing.error?.code ?? "unknown"}: ${existing.error?.message ?? "unknown"}). `
      + `§18 该行的失败处置是「不得淘汰」——the eviction was aborted in full, no entry was removed.`,
    );
  }
  const liveKeys = new Map();
  for (const item of existing.value.items) {
    for (const line of item.residual) {
      if (typeof line === "string" && line.startsWith(EVICTION_KEY_PREFIX)) {
        liveKeys.set(line, item.entry_id);
      }
    }
  }

  const registered = [];
  const reused = [];
  for (const [group, bucket] of byGroup) {
    // **措辞须随实情变化（2026-11-01 自查修正）**：不能一律说「未达阈值即被淘汰」。
    // 容量淘汰可能只淘汰同组的一部分条目，其余仍在攒——此时「未达阈值」这句是假的；
    // 而「淘汰前已达阈值」是更严重的情形（该组本可晋升，却先被容量清掉了），
    // 说明审核层的晋升节奏跟不上写入节奏，必须单独说出来而不是含糊带过。
    const survivors = Math.max(0, bucket.count - bucket.ids.length);
    const head = bucket.count >= bucket.threshold
      ? `组 ${group} 淘汰前已达晋升阈值（${bucket.count}/${bucket.threshold}）却仍未晋升就被淘汰`
      : `组 ${group} 未达晋升阈值（${bucket.count}/${bucket.threshold}）即被淘汰，距成立为待修账目只差 ${bucket.threshold - bucket.count} 次观察`;
    const key = evictionRegistrationKey(bucket.ids, reason);
    if (liveKeys.has(key)) {
      // 同一条淘汰事实已登记且尚未销账——不重复登记，沿用既有那条（回写失败时它同样要被销账）。
      reused.push(liveKeys.get(key));
      continue;
    }
    const queued = await appendPendingEntry(dshHomePath, {
      task: "friction-discovery",
      reason: `摩擦观察条目的淘汰：${head}（本次${reason}，淘汰 ${bucket.ids.length} 条，剩 ${survivors} 条）`,
      residual: [
        head,
        `被淘汰条目 id：${bucket.ids.join("、")}`,
        survivors > 0
          ? `该组仍有 ${survivors} 条 pending 条目在攒，仍可正常晋升；被淘汰的 ${bucket.ids.length} 条不再计入聚合`
          : "该组已无 pending 条目，聚合归零；若该阻碍再次出现将从 0 重新攒起",
        "如认为该组仍需跟踪，须由主控或 Human 核查后决定是否以 Human 入口重新入账（26 §10 的 Human 入口不受阈值硬前置约束）",
        key,
      ],
      at: new Date().toISOString(),
    });
    if (!queued.ok) {
      return failure(
        "friction_observation/eviction_unregistered",
        `refusing to evict: the §20.1 第 11 项 registration could not be written to the pending queue `
        + `(${queued.error?.code ?? "unknown"}: ${queued.error?.message ?? "unknown"}). `
        + `§18 该行的失败处置是「不得淘汰」——the eviction was aborted in full, no entry was removed.`,
      );
    }
    registered.push(queued.value?.entry_id ?? null);
  }
  return success({ registered, reused });
}

/**
 * 项目 id 的合法形态。
 *
 * 载体路径由项目 id 拼出，故必须拒绝路径分隔符与相对路径段——否则一个构造出来的
 * `project` 值可以把文件写到任意位置。只允许 `[A-Za-z0-9._-]`，且不得为 `.`／`..`。
 */
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validateProjectId(projectId) {
  if (!isNonEmptyString(projectId)) {
    return failure(
      "friction_observation/invalid_project",
      "project is required and must be a non-empty string (§12bis.1：按管辖项目分载体)",
    );
  }
  const trimmed = projectId.trim();
  if (!PROJECT_ID_PATTERN.test(trimmed) || trimmed === "." || trimmed === "..") {
    return failure(
      "friction_observation/invalid_project",
      `project must match ${PROJECT_ID_PATTERN} (got ${JSON.stringify(projectId)}) — it becomes a path segment`,
    );
  }
  return success(trimmed);
}

/**
 * 载体路径：`<dshHome>/ldvh/friction-observations/<projectId>.jsonl`。
 *
 * **按项目分文件**（§12bis.1 载体段）。多项目共用一个无项目维度的载体是已知缺陷
 * （friction `11f4eb8f`），本函数是它的纠正形态。
 *
 * @param {(...parts: string[]) => string} dshHomePath - DSH home 路径拼接器
 * @param {string} projectId - 管辖项目 id（须已通过 `validateProjectId`）
 */
export function frictionObservationPath(dshHomePath, projectId) {
  const validated = validateProjectId(projectId);
  const id = validated.ok ? validated.value : "__invalid_project__";
  return dshHomePath(...FRICTION_OBSERVATION_DIR, `${id}.jsonl`);
}

function resolveCapacity(value) {
  if (value === undefined || value === null) {
    return success(FRICTION_OBSERVATION_CAPACITY);
  }
  if (!Number.isInteger(value) || value <= 0) {
    return failure(
      "friction_observation/invalid_capacity",
      `capacity must be a positive integer (got ${JSON.stringify(value)})`,
    );
  }
  if (value > FRICTION_OBSERVATION_CAPACITY) {
    return failure(
      "friction_observation/capacity_above_spec",
      `capacity must not exceed ${FRICTION_OBSERVATION_CAPACITY} (§12bis.1：实现侧不得调高)`,
    );
  }
  return success(value);
}

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * 校验一个待写入条目（§12bis.1 字段闭集 + `pending` 初态）。
 *
 * `group` 是聚合键：**机械层不判断它的语义**，只要求非空——判错同源是 §9 第 1 项
 * 的语义风险，不是本模块能拦的。
 */
function validateAppendInput(input, projectId) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return failure("friction_observation/invalid_entry", "the observation entry must be an object");
  }
  for (const key of Object.keys(input)) {
    if (!APPEND_INPUT_FIELDS.has(key)) {
      return failure(
        "friction_observation/unexpected_field",
        `field "${key}" is outside the §12bis.1 field set (accepted: ${[...APPEND_INPUT_FIELDS].join(", ")}; id/status/promoted_to are assigned by the implementation)`,
      );
    }
  }
  for (const field of ["session", "anchor", "phenomenon", "evidence", "group", "title", "basis", "attribution"]) {
    if (!isNonEmptyString(input[field])) {
      return failure(
        `friction_observation/missing_${field}`,
        `${field} is required and must be a non-empty string (§12bis.1 字段闭集；title/basis/attribution 是审核层跨运行晋升所需的承载，缺任一项晋升即无法建账)`,
      );
    }
  }
  // project：入参若给了，须与载体分区一致（条目层与载体层自洽）。
  if (input.project !== undefined && input.project !== null) {
    if (input.project.trim() !== projectId) {
      return failure(
        "friction_observation/project_mismatch",
        `entry project ${JSON.stringify(input.project)} does not match the carrier partition ${JSON.stringify(projectId)} (§12bis.1：分区是载体层，project 是条目层，二者须自洽)`,
      );
    }
  }
  for (const field of ["session", "anchor", "group"]) {
    if (input[field].trim().length > FRICTION_OBSERVATION_MAX_REFERENCE_LENGTH) {
      return failure(
        `friction_observation/invalid_${field}`,
        `${field} must be ≤ ${FRICTION_OBSERVATION_MAX_REFERENCE_LENGTH} characters (it is a marker, not content)`,
      );
    }
  }
  if (input.phenomenon.trim().length > FRICTION_OBSERVATION_MAX_PHENOMENON_LENGTH) {
    return failure(
      "friction_observation/phenomenon_too_long",
      `phenomenon must be ≤ ${FRICTION_OBSERVATION_MAX_PHENOMENON_LENGTH} characters — it is one sentence describing what was seen, not an essay`,
    );
  }
  if (input.evidence.trim().length > FRICTION_OBSERVATION_MAX_EVIDENCE_LENGTH) {
    return failure(
      "friction_observation/evidence_too_long",
      `evidence must be ≤ ${FRICTION_OBSERVATION_MAX_EVIDENCE_LENGTH} characters — only the minimal verbatim span that supports the phenomenon`,
    );
  }
  if (PURE_REFERENCE_EVIDENCE.has(normalizeReference(input.evidence))) {
    return failure(
      "friction_observation/evidence_not_verbatim",
      "evidence must be the verbatim fragment of the source material together with a source reference — a bare pointer such as 「见上」/「同上」 carries neither (§12bis.1)",
    );
  }
  let at = new Date().toISOString();
  if (input.at !== undefined && input.at !== null) {
    if (
      !isNonEmptyString(input.at) ||
      !RFC3339_PATTERN.test(input.at.trim()) ||
      !Number.isFinite(Date.parse(input.at.trim()))
    ) {
      return failure(
        "friction_observation/invalid_at",
        `at must be an RFC3339 timestamp (got ${JSON.stringify(input.at)})`,
      );
    }
    at = input.at.trim();
  }
  return success({
    id: randomUUID(),
    at,
    project: projectId,
    session: input.session.trim(),
    anchor: input.anchor.trim(),
    phenomenon: input.phenomenon.trim(),
    // **逐字保留**：`evidence` 是来源材料的逐字片段，连 trim 都可能改写它。
    evidence: input.evidence,
    group: input.group.trim(),
    // 2026-10-30：审核层跨运行晋升所需的承载（§12bis.1 字段闭集）。
    target_uid: isNonEmptyString(input.target_uid) ? input.target_uid.trim() : null,
    title: input.title.trim(),
    basis: input.basis.trim(),
    attribution: input.attribution.trim(),
    status: "pending",
    promoted_to: null,
  });
}

/** 存量条目校验：闭集之外的字段即越界，单列进 `invalid` 而非静默接受。 */
export function validateStoredEntry(record) {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return "entry is not an object";
  }
  for (const key of Object.keys(record)) {
    if (!STORED_FIELDS.has(key)) {
      return `field "${key}" is outside the §12bis.1 field set`;
    }
  }
  for (const field of FRICTION_OBSERVATION_FIELDS) {
    // `target_uid` 是**可空**字段：只有 `same-obstacle` 态的观察带它（指向要补充的
    // 既有账目），其余态为 null。其余字段一律必须存在。
    if (field === "target_uid") {
      if (!(field in record)) return `missing field "${field}"`;
      if (record[field] !== null && !isNonEmptyString(record[field])) {
        return `field "target_uid" must be null or a non-empty string`;
      }
      continue;
    }
    if (!(field in record)) {
      return `missing field "${field}"`;
    }
  }
  if (!FRICTION_OBSERVATION_STATUSES.includes(record.status)) {
    return `status ${JSON.stringify(record.status)} is not in the closed set`;
  }
  if (!RFC3339_PATTERN.test(String(record.at))) {
    return `at ${JSON.stringify(record.at)} is not RFC3339`;
  }
  if (record.status === "promoted" && !isNonEmptyString(record.promoted_to)) {
    return "status=promoted requires a non-empty promoted_to";
  }
  if (record.status !== "promoted" && record.promoted_to !== null) {
    return "promoted_to must be null unless status=promoted";
  }
  return null;
}

function parseCarrierText(text, projectId) {
  const invalid = [];
  const records = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      invalid.push({
        line: index + 1,
        reason: `not valid JSON: ${String(error?.message ?? error)}`,
        excerpt: line.slice(0, 80),
      });
      continue;
    }
    const issue = validateStoredEntry(parsed);
    if (issue !== null) {
      invalid.push({ line: index + 1, reason: issue, excerpt: line.slice(0, 80) });
      continue;
    }
    if (parsed.project !== projectId) {
      invalid.push({
        line: index + 1,
        reason: `entry project ${JSON.stringify(parsed.project)} is not the carrier partition ${JSON.stringify(projectId)}`,
        excerpt: line.slice(0, 80),
      });
      continue;
    }
    records.push({ index, record: parsed });
  }
  return { lines, records, invalid };
}

async function readCarrierRecords(dshHomePath, projectId) {
  const path = frictionObservationPath(dshHomePath, projectId);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return success({ lines: [], records: [], invalid: [], carrier: path });
    }
    return failure(
      "friction_observation/unavailable",
      `cannot read the friction observation carrier: ${String(error?.message ?? error)}`,
    );
  }
  const parsed = parseCarrierText(text, projectId);
  return success({ ...parsed, carrier: path });
}

/** 改写载体：读全文 → 只替换目标行 → 临时文件 + rename（读者不见半截文件）。 */
async function rewriteCarrier(dshHomePath, projectId, lines) {
  const path = frictionObservationPath(dshHomePath, projectId);
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    const body = lines.join("\n");
    await writeFile(tempPath, body, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    return failure(
      "friction_observation/unavailable",
      `cannot rewrite the friction observation carrier: ${String(error?.message ?? error)}`,
    );
  }
  return success({ carrier: path });
}

/**
 * 容量整理：在管条目数超过容量时，按 `at` 最旧优先淘汰。
 *
 * 被淘汰的 `pending` 条目**记录其未晋升事实**（§20.1 第 11 项）：其 `group`、该组
 * 当时已有条目数、以及被淘汰条目 id 一并进入返回值的 `evicted_pending`。登记**由本模块
 * 自己写**（见 `registerEvictedPending`），且先于落盘；登记失败时整批淘汰放弃。
 */
async function enforceCapacity(dshHomePath, projectId, capacity, { excludeId = null, now = new Date() } = {}) {
  const read = await readCarrierRecords(dshHomePath, projectId);
  if (!read.ok) return read;
  const { lines, records } = read.value;

  const live = records.filter((item) => item.record.status !== "evicted");
  const overflow = live.length - capacity;
  if (overflow <= 0) return success({ evicted_pending: [] });

  const ordered = [...live].sort((a, b) => {
    const atA = Date.parse(a.record.at);
    const atB = Date.parse(b.record.at);
    if (atA !== atB) return atA - atB;
    return a.index - b.index;
  });
  const victims = ordered.slice(0, overflow);
  const stamp = new Date(now).toISOString();
  const evictedPending = [];
  const replacements = new Map();
  for (const victim of victims) {
    const record = victim.record;
    if (record.status === "pending") {
      const sameGroup = records.filter(
        (item) => item.record.status === "pending" && item.record.group === record.group,
      );
      evictedPending.push({
        id: record.id,
        group: record.group,
        pending_count_at_eviction: sameGroup.length,
        threshold: FRICTION_OBSERVATION_THRESHOLD_N,
      });
    }
    replacements.set(victim.index, {
      ...record,
      status: "evicted",
      promoted_to: null,
      [FRICTION_OBSERVATION_SETTLED_AT_FIELD]: stamp,
    });
  }

  // §18「不得淘汰」：登记必须**先于**落盘，且失败即整体放弃。
  const registered = await registerEvictedPending(dshHomePath, evictedPending, "因容量上限被淘汰");
  if (!registered.ok) return registered;

  const nextLines = lines.map((line, index) => {
    if (!replacements.has(index)) return line;
    return JSON.stringify(replacements.get(index));
  });
  const rewritten = await rewriteCarrier(dshHomePath, projectId, nextLines);
  if (!rewritten.ok) {
    // **登记已写、载体却没改**（第四轮审核 F1 的容量路径同形）：登记描述的是「已淘汰」，
    // 而条目其实还在——假记录。销账并写明未生效，下一轮可重新登记。
    const pendingIds = [...(registered.value.registered ?? []), ...(registered.value.reused ?? [])]
      .filter((value) => typeof value === "string" && value.length > 0);
    const unresolved = [];
    for (const registrationId of pendingIds) {
      const resolved = await resolvePendingEntry(dshHomePath, registrationId, {
        note: "登记未生效：载体回写失败，被淘汰条目仍在缓冲中，下次写入会重新判定",
      });
      if (!resolved.ok && resolved.error?.code !== "pending_queue/already_resolved") {
        unresolved.push(`${registrationId}: ${resolved.error?.code ?? "unknown"}`);
      }
    }
    return failure(
      "friction_observation/eviction_writeback_failed",
      `the §20.1 第 11 项 registration was written but the carrier rewrite failed `
      + `(${rewritten.error?.code ?? "unknown"}: ${rewritten.error?.message ?? "unknown"}); `
      + `no entry was evicted, so ${pendingIds.length} registration(s) were resolved with a `
      + `"did not take effect" note`
      + (unresolved.length === 0
        ? ". The observation itself WAS written and is in the carrier — do not write it again."
        : `; however ${unresolved.length} registration(s) could not be resolved: ${unresolved.join("; ")}. `
          + "The observation itself WAS written and is in the carrier — do not write it again."),
    );
  }
  return success({
    evicted_pending: evictedPending,
    eviction_registrations: registered.value.registered,
    eviction_registrations_reused: registered.value.reused ?? [],
  });
}

/**
 * 追加一条摩擦观察条目（§9 第 2 项 / §12bis.1 写入纪律第 1 条）。
 *
 * @param {(...parts: string[]) => string} dshHomePath
 * @param {object} entry - `{ project, session, anchor, phenomenon, evidence, group, at? }`
 * @param {{capacity?: number, now?: Date}} [options]
 * @returns {Promise<{ok:true,value:{entry_id:string,group:string,group_pending_count:number,promotion_ready:boolean,evicted_pending:Array}}|{ok:false,error:{code:string,message:string}}>}
 */
export async function appendFrictionObservation(dshHomePath, entry = {}, options = {}) {
  if (typeof entry !== "object" || entry === null) {
    return failure("friction_observation/invalid_entry", "the observation entry must be an object");
  }
  const projectResult = validateProjectId(entry.project);
  if (!projectResult.ok) return projectResult;
  const projectId = projectResult.value;

  const capacity = resolveCapacity(options?.capacity);
  if (!capacity.ok) return capacity;

  const validated = validateAppendInput(entry, projectId);
  if (!validated.ok) return validated;
  const record = validated.value;

  const path = frictionObservationPath(dshHomePath, projectId);
  try {
    await mkdir(dirname(path), { recursive: true });
    // JSONL 追加：O_APPEND 语义使并发写入不互相覆盖，与「追加型」契约一致。
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    // §12 纪律：不得降级为内存或日志——原样上报，由调用方 fail-closed。
    return failure(
      "friction_observation/unavailable",
      `cannot append to the friction observation carrier: ${String(error?.message ?? error)}`,
    );
  }

  const evicted = await enforceCapacity(dshHomePath, projectId, capacity.value, {
    excludeId: record.id,
    now: options?.now ?? new Date(),
  });
  if (!evicted.ok) {
    // **观察已经落盘了，失败的是淘汰**（2026-11-01 第四轮审核 F2 修）。
    //
    // 原实现直接把 `enforceCapacity` 的失败原样返回，而那条错误的文本是
    // 「the eviction was aborted in full, no entry was removed」——它只说淘汰没做，
    // 一个字的没提本次观察已经写进载体。调用方据此按 §12 fail-closed 处理，水位不推进，
    // 同一区间会被重放；而发现层写入路径**没有**转写路径那样的证据幂等闸，
    // 重放 N−1 次就能把一条真实观察凑到阈值、建出一笔本不该成立的账目。
    //
    // 故在这里重写错误：明说「观察已写入（id …），仅淘汰未执行」，让调用方能据
    // `written: true` 自行决定推进水位或至少不重复写入。
    return {
      ok: false,
      error: {
        code: evicted.error?.code ?? "friction_observation/eviction_failed",
        message: `the observation was written (id ${record.id}, group ${record.group}) but the `
          + `capacity eviction did not run: ${evicted.error?.message ?? "unknown"}. `
          + `The entry IS in the carrier — do not write it again. §11 水位是否推进由调用方按 `
          + `§12 决定，但重放会重复计入同一现象。`,
        written: true,
        entry_id: record.id,
        evicted_code: evicted.error?.code ?? "unknown",
      },
    };
  }

  // 精确回读（§18「摩擦观察条目的写入合法」行）。
  const readBack = await readCarrierRecords(dshHomePath, projectId);
  if (!readBack.ok) {
    return failure(
      "friction_observation/read_back_failed",
      `the entry was written but the read-back failed: ${readBack.error.message}`,
    );
  }
  const found = readBack.value.records.find((item) => item.record.id === record.id);
  if (!found) {
    return failure(
      "friction_observation/read_back_mismatch",
      `the entry was written but the read-back did not find id ${record.id}`,
    );
  }
  const observed = found.record;
  for (const field of FRICTION_OBSERVATION_FIELDS) {
    if (observed[field] !== record[field]) {
      return failure(
        "friction_observation/read_back_mismatch",
        `the read-back of ${field} does not match what was written (expected ${JSON.stringify(record[field])}, got ${JSON.stringify(observed[field])})`,
      );
    }
  }

  // 本组当前 pending 条目数（含刚写入这条）与是否已达晋升阈值。
  const sameGroup = readBack.value.records.filter(
    (item) => item.record.status === "pending" && item.record.group === record.group,
  );
  return success({
    entry_id: record.id,
    group: record.group,
    group_pending_count: sameGroup.length,
    promotion_ready: sameGroup.length >= FRICTION_OBSERVATION_THRESHOLD_N,
    evicted_pending: evicted.value.evicted_pending,
    // 容量淘汰的登记回执（§20.1 第 11 项）。空数组 = 本次没有条目被淘汰。
    eviction_registrations: evicted.value.eviction_registrations ?? [],
  });
}

/**
 * 读取摩擦观察条目（§12bis.1 读取纪律第 2 条）。
 *
 * @param {(...parts: string[]) => string} dshHomePath
 * @param {string} projectId
 * @param {{status?: string|null, group?: string|null, limit?: number|null, now?: Date, capacity?: number}} [options]
 */
export async function readFrictionObservations(dshHomePath, projectId, options = {}) {
  const projectResult = validateProjectId(projectId);
  if (!projectResult.ok) return projectResult;
  const id = projectResult.value;

  const { status = null, group = null, limit = null, now = new Date(), capacity } = options;
  if (status !== null && status !== undefined && !FRICTION_OBSERVATION_STATUSES.includes(status)) {
    return failure(
      "friction_observation/invalid_status",
      `status must be one of ${JSON.stringify([...FRICTION_OBSERVATION_STATUSES])} (got ${JSON.stringify(status)})`,
    );
  }
  if (limit !== null && limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return failure(
      "friction_observation/invalid_limit",
      `limit must be a positive integer (got ${JSON.stringify(limit)})`,
    );
  }
  const resolvedCapacity = resolveCapacity(capacity);
  if (!resolvedCapacity.ok) return resolvedCapacity;
  const nowMs = toTimestamp(now);
  if (nowMs === null) {
    return failure(
      "friction_observation/invalid_now",
      "now must be a Date, a millisecond timestamp or an RFC3339 string",
    );
  }

  const read = await readCarrierRecords(dshHomePath, id);
  if (!read.ok) return read;
  const { lines, records, invalid, carrier } = read.value;

  // ── 保留期：读时惰性结算 ─────────────────────────────────────────
  const stamp = new Date(nowMs).toISOString();
  const settledByIndex = new Map();
  const removedIndexes = new Set();
  const evictedPending = [];
  for (const item of records) {
    const record = item.record;
    if (record.status === "pending") {
      const age = nowMs - Date.parse(record.at);
      if (Number.isFinite(age) && age > PENDING_TTL_MS) {
        const sameGroup = records.filter(
          (other) => other.record.status === "pending" && other.record.group === record.group,
        );
        evictedPending.push({
          id: record.id,
          group: record.group,
          pending_count_at_eviction: sameGroup.length,
          threshold: FRICTION_OBSERVATION_THRESHOLD_N,
        });
        settledByIndex.set(item.index, {
          ...record,
          status: "evicted",
          promoted_to: null,
          [FRICTION_OBSERVATION_SETTLED_AT_FIELD]: stamp,
        });
      }
      continue;
    }
    const reference =
      typeof record[FRICTION_OBSERVATION_SETTLED_AT_FIELD] === "string"
        ? record[FRICTION_OBSERVATION_SETTLED_AT_FIELD]
        : record.at;
    const age = nowMs - Date.parse(reference);
    if (Number.isFinite(age) && age > SETTLED_TTL_MS) {
      removedIndexes.add(item.index);
    }
  }

  // §20.1 第 11 项 / §18「不得淘汰」：保留期淘汰 `pending` 条目**必须先登记**。
  // 登记失败时**整体放弃本次淘汰**（不改写载体），读仍返回未结算视图并把
  // `complete` 置 false——读者须知道「有一批该淘汰的条目因登记失败而仍在」。
  let evictionRegistrations = [];
  let evictionReusedRegistrations = [];
  let evictionRegistrationFailed = null;
  if (evictedPending.length > 0) {
    const registered = await registerEvictedPending(dshHomePath, evictedPending, "因保留期到期被淘汰");
    if (!registered.ok) {
      evictionRegistrationFailed = {
        code: registered.error?.code ?? "friction_observation/eviction_unregistered",
        message: registered.error?.message ?? "unknown",
      };
      // 放弃本次淘汰：撤掉待结算集合，使载体保持原样。
      settledByIndex.clear();
      evictedPending.length = 0;
    } else {
      evictionRegistrations = registered.value.registered;
      // 查重命中而沿用的既有登记也要纳入「回写失败时须销账」的集合（第四轮审核 F1）。
      evictionReusedRegistrations = registered.value.reused ?? [];
    }
  }

  // 惰性回写：失败不使整次读失败，但 complete 置 false（读者须知道「不完整」）。
  let complete = true;
  if (settledByIndex.size > 0 || removedIndexes.size > 0) {
    const keptIndexes = new Set(records.map((item) => item.index));
    const nextLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!keptIndexes.has(index)) {
        nextLines.push(lines[index]);
        continue;
      }
      if (removedIndexes.has(index)) continue;
      const replacement = settledByIndex.get(index);
      nextLines.push(replacement ? JSON.stringify(replacement) : lines[index]);
    }
    const rewritten = await rewriteCarrier(dshHomePath, id, nextLines);
    if (!rewritten.ok) {
      complete = false;
      // **登记已写、载体却没改**（第四轮审核 F1）：队列里那条「该组已被淘汰」的登记此刻
      // 描述的是一个**没有发生**的事实，而下一轮读取会再次判定同一批条目该淘汰、再次
      // 进入登记。若不处置，队列会长期挂着假记录且每次重读都追加一条。
      //
      // 处置：把本批登记**销账**并写明「未生效」。销账后下一轮可重新登记（此时是真的
      // 要淘汰了），既不重复也不失真。销账本身失败必须说出来——否则又变回无痕。
      const pendingIds = [...evictionRegistrations, ...evictionReusedRegistrations].filter(
        (value) => typeof value === "string" && value.length > 0,
      );
      const unresolved = [];
      for (const registrationId of pendingIds) {
        const resolved = await resolvePendingEntry(dshHomePath, registrationId, {
          note: "登记未生效：载体回写失败，被淘汰条目仍在缓冲中，下次读取会重新判定",
        });
        if (!resolved.ok && resolved.error?.code !== "pending_queue/already_resolved") {
          unresolved.push(`${registrationId}: ${resolved.error?.code ?? "unknown"}`);
        }
      }
      evictionRegistrationFailed = {
        code: "friction_observation/eviction_writeback_failed",
        message: `the §20.1 第 11 项 registration was written but the carrier rewrite failed `
          + `(${rewritten.error?.code ?? "unknown"}: ${rewritten.error?.message ?? "unknown"}); `
          + `the entries were NOT evicted, so ${pendingIds.length} registration(s) were resolved with a `
          + `"did not take effect" note`
          + (unresolved.length === 0
            ? "."
            : `; however ${unresolved.length} registration(s) could not be resolved: ${unresolved.join("; ")}`),
      };
    }
  }

  // 结算后的有效视图（写盘成功与否都按结算后语义返回，避免读者看到过期 pending）。
  let effective = records
    .filter((item) => !removedIndexes.has(item.index))
    .map((item) => settledByIndex.get(item.index) ?? item.record);
  if (status !== null && status !== undefined) {
    effective = effective.filter((record) => record.status === status);
  }
  if (group !== null && group !== undefined) {
    effective = effective.filter((record) => record.group === group);
  }
  const total = effective.length;
  const limited = limit !== null && limit !== undefined ? effective.slice(0, limit) : effective;

  const all = records
    .filter((item) => !removedIndexes.has(item.index))
    .map((item) => settledByIndex.get(item.index) ?? item.record);
  const byStatus = {};
  for (const record of all) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
  }
  const liveTotal = all.filter((record) => record.status !== "evicted").length;

  return success({
    items: limited,
    total,
    by_status: byStatus,
    at_capacity: liveTotal >= resolvedCapacity.value,
    live_total: liveTotal,
    capacity: resolvedCapacity.value,
    invalid,
    // 登记失败也是「不完整」：该淘汰的条目仍在，读者不能据此认为保留期已生效。
    complete: complete && evictionRegistrationFailed === null,
    carrier,
    evicted_pending: evictedPending,
    eviction_registrations: evictionRegistrations,
    // 非空即「本批该淘汰的条目因 §20.1 第 11 项登记失败而未被淘汰」——
    // 这是一个须被读者看见的失败，不得静默。
    eviction_registration_error: evictionRegistrationFailed,
  });
}

/**
 * 按 `group` 聚合出「已达晋升阈值、待在待晋升」的组（§9 第 3 项的输入）。
 *
 * **只做相等比较**——不判断两个 `group` 是否指向同一阻碍（那是语义判断，
 * §18「阈值晋升」行的可证明范围已声明）。
 *
 * **`target_uid` 非空的条目不计入晋升组（2026-11-01 修，潜伏缺陷）**：
 * 这类条目是 §9 第 4 项的「待补充」观察——它们指向一笔**已存在**的 `open` 账目，
 * 由审核层按 `target_uid` 走补充路径，不该再参与「攒够 N 条就建一笔新账」的聚合。
 * 原实现不看该字段，于是同一阻碍的 3 次补充观察会让 `group` 凑满阈值、**另建一笔
 * 重复账目**（`same-obstacle` 态的 `group` 取被命中账目的 `object_uid` 作占位键，
 * 那笔账目的 3 次复观正好凑成一组）。
 *
 * 该缺陷此前未触发，只是因为存量 `target_uid` 全为 null（扩字段是 2026-10-30 的事，
 * 且补充成功后条目即被移除，很少累积）。闸门在数据上没被踩到，不等于逻辑成立。
 *
 * @returns {Promise<{ok:true,value:{ready:Array<{group:string,pending_count:number,entries:Array}>}}|{ok:false,error:object}>}
 */
export async function readPromotionReadyGroups(dshHomePath, projectId, options = {}) {
  const read = await readFrictionObservations(dshHomePath, projectId, {
    status: "pending",
    ...options,
  });
  if (!read.ok) return read;
  const groups = new Map();
  for (const record of read.value.items) {
    // 待补充条目走 §9 第 4 项，不参与第 3 项的阈值聚合（见函数头）。
    if (typeof record.target_uid === "string" && record.target_uid.length > 0) continue;
    if (!groups.has(record.group)) groups.set(record.group, []);
    groups.get(record.group).push(record);
  }
  const ready = [];
  for (const [group, entries] of groups) {
    if (entries.length >= FRICTION_OBSERVATION_THRESHOLD_N) {
      const ordered = [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      ready.push({ group, pending_count: entries.length, entries: ordered });
    }
  }
  return success({ ready, invalid: read.value.invalid, complete: read.value.complete });
}

/**
 * 结算一组条目为 `promoted`，并写入所晋升账目的 `object_uid`（§9 第 3 项）。
 *
 * **本函数不校验账目正文是否已复制证据**——该复制由晋升调用方在受控创建时完成，
 * 二者的先后由调用方保证（先建账目拿到 uid，再结算条目）。若账目建好而结算失败，
 * 条目仍为 `pending`，下次运行会再次尝试晋升（可能产生重复账目）——故调用方须在
 * 结算失败时按 §12 fail-closed 并登记，不得静默放过。
 *
 * @param {string[]} entryIds - 该组待结算的条目 id
 * @param {string} promotedTo - 新建账目的 `object_uid`
 */
export async function settleGroupPromoted(dshHomePath, projectId, entryIds, promotedTo, options = {}) {
  const projectResult = validateProjectId(projectId);
  if (!projectResult.ok) return projectResult;
  const id = projectResult.value;
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return failure(
      "friction_observation/invalid_entry_ids",
      "entryIds must be a non-empty array of buffer entry ids",
    );
  }
  if (!isNonEmptyString(promotedTo)) {
    return failure(
      "friction_observation/invalid_promoted_to",
      "promotedTo must be a non-empty object_uid (§12bis.1 `promoted_to` 行)",
    );
  }
  const read = await readCarrierRecords(dshHomePath, id);
  if (!read.ok) return read;
  const { lines, records } = read.value;
  const stamp = new Date(options?.now ?? new Date()).toISOString();
  const wanted = new Set(entryIds);
  const replacements = new Map();
  const settled = [];
  for (const item of records) {
    if (!wanted.has(item.record.id)) continue;
    if (item.record.status !== "pending") {
      return failure(
        "friction_observation/not_pending",
        `entry ${item.record.id} is ${item.record.status}, not pending — promotion is not idempotent across statuses`,
      );
    }
    replacements.set(item.index, {
      ...item.record,
      status: "promoted",
      promoted_to: promotedTo.trim(),
      [FRICTION_OBSERVATION_SETTLED_AT_FIELD]: stamp,
    });
    settled.push(item.record.id);
  }
  const missing = [...wanted].filter((entryId) => !settled.includes(entryId));
  if (missing.length > 0) {
    return failure(
      "friction_observation/unknown_entry",
      `entries not found in the carrier: ${missing.join(", ")}`,
    );
  }
  const nextLines = lines.map((line, index) =>
    replacements.has(index) ? JSON.stringify(replacements.get(index)) : line,
  );
  const rewritten = await rewriteCarrier(dshHomePath, id, nextLines);
  if (!rewritten.ok) return rewritten;
  return success({ settled, promoted_to: promotedTo.trim() });
}

/**
 * 结算条目为 `discarded`（判定不构成阻碍；§12bis.1 `status` 行）。
 */
export async function settleObservationDiscarded(dshHomePath, projectId, entryId, options = {}) {
  const projectResult = validateProjectId(projectId);
  if (!projectResult.ok) return projectResult;
  const id = projectResult.value;
  if (!isNonEmptyString(entryId)) {
    return failure("friction_observation/invalid_entry_id", "entryId must be a non-empty string");
  }
  const read = await readCarrierRecords(dshHomePath, id);
  if (!read.ok) return read;
  const { lines, records } = read.value;
  const stamp = new Date(options?.now ?? new Date()).toISOString();
  let found = false;
  const nextLines = lines.map((line, index) => {
    const item = records.find((entry) => entry.index === index);
    if (!item || item.record.id !== entryId) return line;
    found = true;
    if (item.record.status !== "pending") return line;
    return JSON.stringify({
      ...item.record,
      status: "discarded",
      promoted_to: null,
      [FRICTION_OBSERVATION_SETTLED_AT_FIELD]: stamp,
    });
  });
  if (!found) {
    return failure(
      "friction_observation/unknown_entry",
      `entry ${entryId} not found in the carrier`,
    );
  }
  const rewritten = await rewriteCarrier(dshHomePath, id, lines.length === nextLines.length ? nextLines : lines);
  if (!rewritten.ok) return rewritten;
  return success({ entry_id: entryId, status: "discarded" });
}
