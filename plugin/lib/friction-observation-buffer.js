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
 * **淘汰须登记**（§20.1 第 11 项）：本模块在淘汰 `pending` 条目时，把被淘汰组的
 * `group`／已有条目数／被淘汰条目 id 一并放进返回值的 `evicted_pending`，**调用方**须
 * 据此写待处置队列登记。本模块不自己写队列（那是 §12 的载体，职责分离）。
 */

import { readFile, mkdir, appendFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

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

/** §12bis.1 的字段闭集（10 项）。 */
export const FRICTION_OBSERVATION_FIELDS = Object.freeze([
  "id",
  "at",
  "project",
  "session",
  "anchor",
  "phenomenon",
  "evidence",
  "group",
  "status",
  "promoted_to",
]);

/** 实现侧附加记账字段（不在 §12bis.1 的 10 项闭集内）：保留期计算所需。 */
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
]);

/** 存量条目允许出现的字段（10 项闭集 + 实现侧附加记账字段）。 */
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
  for (const field of ["session", "anchor", "phenomenon", "evidence", "group"]) {
    if (!isNonEmptyString(input[field])) {
      return failure(
        `friction_observation/missing_${field}`,
        `${field} is required and must be a non-empty string (§12bis.1 字段闭集)`,
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
    status: "pending",
    promoted_to: null,
  });
}

/** 存量条目校验：闭集之外的字段即越界，单列进 `invalid` 而非静默接受。 */
function validateStoredEntry(record) {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return "entry is not an object";
  }
  for (const key of Object.keys(record)) {
    if (!STORED_FIELDS.has(key)) {
      return `field "${key}" is outside the §12bis.1 field set`;
    }
  }
  for (const field of FRICTION_OBSERVATION_FIELDS) {
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
 * 当时已有条目数、以及被淘汰条目 id 一并进入返回值的 `evicted_pending`，**由调用方**
 * 写待处置队列登记。本模块不自行写队列（载体职责分离）。
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

  const nextLines = lines.map((line, index) => {
    if (!replacements.has(index)) return line;
    return JSON.stringify(replacements.get(index));
  });
  const rewritten = await rewriteCarrier(dshHomePath, projectId, nextLines);
  if (!rewritten.ok) return rewritten;
  return success({ evicted_pending: evictedPending });
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
  if (!evicted.ok) return evicted;

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
    if (!rewritten.ok) complete = false;
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
    complete,
    carrier,
    evicted_pending: evictedPending,
  });
}

/**
 * 按 `group` 聚合出「已达晋升阈值、待在待晋升」的组（§9 第 3 项的输入）。
 *
 * **只做相等比较**——不判断两个 `group` 是否指向同一阻碍（那是语义判断，
 * §18「阈值晋升」行的可证明范围已声明）。
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
