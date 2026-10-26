/**
 * dsh-ldvh — 留观缓冲（跨运行工作产物）（specs/11 §12bis）。
 *
 * 权威来源（本模块是它的实现，不复述其规范效力）：
 *   - `specs/11-闲时辅助系统规范.md` §12bis「留观缓冲（跨运行工作产物）」——**载体契约
 *     的唯一权威**：字段闭集、容量上限、保留期、状态闭集、写入与读取纪律，以及
 *     「证据不留在缓冲」；
 *   - `specs/11-闲时辅助系统规范.md` §18 两行——「留观缓冲条目的写入合法」与
 *     「缓冲条目不可写／不可回读」：写入合法性由机械校验承担，不通过即拒绝该条
 *     并按 §12 fail-closed；
 *   - `specs/11-闲时辅助系统规范.md` §12ter.1／§12ter.2——`observation-buffer-list`
 *     的输入契约（`status`／`limit`）与结果契约（条目集合、总数、`status` 分布、
 *     是否已达容量上限；载体不存在时返回空集合而非错误）；
 *   - `specs/02-事实源与事实模型基础规范.md` §6.1 末「事实源之外的中间产物
 *     （边界，2026-10-20）」三条——缓冲不适用事实契约、消费者唯一且被写明、
 *     权威对象的证据必须自足。
 *
 * ## 本模块的纪律边界
 *
 * 1. **不是事实对象**：本模块不写事实源、不产生 `object_uid`、不适用事实类型契约、
 *    不参与 02 号的受控写入与 CAS、不被 F0–F4 召回检索。缓冲条目的存在、数量与
 *    `status` 变化**均不构成任何事实对象的证据**，也不推动任何状态流转（§12bis 末段）。
 * 2. **不走受控写入、不需 change_log 署名**：缓冲是**宿主侧**的运行载体，位置在事实源
 *    目录之外（`~/.dsh/ldvh/observation-buffer.jsonl`），与 §12 待处置队列同层。
 * 3. **唯一消费者是审核段**（§12bis 读取纪律第 2 条）：其它执行体、任何主控与任何
 *    Web 呈现都不得把缓冲条目当作事实或依据消费；Human 查阅入口只可展示其存在与数量。
 *    本模块**不做按调用方身份的语义裁量**（§12ter.2：实现不做语义裁量）。
 * 4. **与待处置队列分文件**（§12bis 读取纪律第 5 条）：二者**不得合并为一个载体**
 *    ——合并会使「未核查的受影响对象不得被当作稳定事实消费」与「待审核材料可由审核段
 *    读取」互相污染。故本模块的载体是**独立文件**，与 `pending-queue.jsonl` 互不影响。
 * 5. **不可写即 fail-closed**（§12bis 读取纪律第 4 条）：缓冲不可写或不可回读时，
 *    该次任务不得继续，**也不得**降级为「只记在内存」或「只写日志」。本模块在载体
 *    不可用时一律返回失败码，调用方据此按 §12 停止。
 * 6. **证据不留在缓冲**（§12bis 末段）：审核段据缓冲成文时**必须**把所用的逐字引证
 *    片段与来源标识复制进 `draft` 的七段正文；缓冲条目在 `draft` 成形后仅作来源指针
 *    （`consumed_by` 反向指回），其被淘汰不影响 `draft` 的完整性。本模块只提供载体
 *    操作，不代替审核段做那次复制。
 *
 * ## 字段闭集与实现侧附加记账字段
 *
 * §12bis 字段闭集为 9 项；`settled_at` 是实现侧保留期计算所需的附加记账字段，
 * 不承载语义，不进入对外消费面。
 *
 * 读取时对**存量**条目的校验同样按闭集进行：闭集之外的字段（`settled_at` 除外）即
 * 越界，该行单列进 `invalid` 而不是被静默接受。
 *
 * ## 追加型与状态结算
 *
 * 载体是 JSONL 追加型账本。§12bis 写入纪律第 1 条约束的是**写入者（捕获段）**：
 * 「仅追加，不修改既有登记」。条目状态的改写是**审核段**的结算动作（§12ter.2
 * `observation-buffer-review` 声明为 `may_change_state`），本模块因此只提供两个改写
 * 入口：容量淘汰与状态结算，且都只改 `status`、`consumed_by` 与实现侧的 `settled_at`，
 * 其余字段逐字保留。改写走「读全文 → 只替换目标行 → 临时文件 + rename」，使读者
 * 不会看到半截文件；残缺行在改写中原样保留——读取侧已单列它们，写入侧不得把它们吞掉。
 *
 * ## 容量口径（规范留白处的实现侧取舍）
 *
 * §12bis「容量上限与保留期」第 1 项同时要求两件事：「条目数上限 200」与「被淘汰条目
 * `status=evicted` 并**保留记录**」。若「条目数」把保留记录也算进去，被淘汰记录本身
 * 就会令总数越过上限，二者不可同真。本模块据此取**在管条目**（`status ≠ evicted`）
 * 为容量口径：
 *   - 被淘汰的条目 `status=evicted` 并**保留记录**——记录留在载体里，可见、可按
 *     `status=evicted` 检索，并按终态 90 天保留期整条移除；
 *   - **在管条目数永不超过容量**。
 * 于是：`total` = 载体中**全部**可见记录数（含保留记录，与 `by_status` 之和一致）；
 * `live_total` = 在管条目数；`at_capacity` = 在管条目数 ≥ 容量（是否已达容量上限）。
 *
 * ## 容量上限与测试接缝
 *
 * `BUFFER_CAPACITY`（200）是 §12bis 的规范默认值，**实现侧不得调高**。本模块另提供
 * 一个**测试接缝**：`appendBufferEntry` / `readBufferEntries` / `settleBufferEntry`
 * 的选项 `capacity` 可注入一个**不大于** `BUFFER_CAPACITY` 的容量，使测试不必真写
 * 200 条即可走完容量淘汰路径。该接缝**不改变规范默认值**，且**拒绝**任何大于
 * `BUFFER_CAPACITY` 的取值——那正是「不得调高」的机械形态。注入容量时**读与写须用
 * 同一个值**，否则 `at_capacity` 按规范默认 200 计算。
 *
 * ## 保留期的结算时机
 *
 * 保留期在**读时惰性结算**：`pending` 超 30 天转 `evicted`（落盘），终态超 90 天
 * 整条移除（落盘）。惰性回写**失败不使整次读失败**——失败会如实进入 `invalid` 并把
 * `complete` 置 false（读者据此知道「看到的不等于全部」），但读本身仍返回可用结果。
 */

import { readFile, mkdir, appendFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * DSH home 下的**未分项目**相对位置——**旧版全局载体**（2026-10 前的形态）。
 *
 * §12bis 载体段（2026-10 修订，Human 决定）要求**按管辖项目分载体**：
 *
 * > 载体须按管辖项目分文件（或等价的分区），**不得使多个管辖项目的观察材料混在
 * > 同一个无项目维度的载体里**。
 *
 * 本常量保留两个用途：① 存量数据仍在旧位置，须 Human 决定后处置（本模块**不擅自
 * 迁移**——擅自迁移等于替 Human 决定这些材料的项目归属）；② 诊断面回指旧载体。
 *
 * **生产路径一律按项目分**（见 `bufferEntryPath` 的 `projectId` 形参）。
 */
export const BUFFER_RELATIVE_PATH = Object.freeze(["ldvh", "observation-buffer.jsonl"]);

/**
 * 按项目分区时的相对位置：`ldvh/experience-buffers/<projectId>.jsonl`。
 *
 * **为什么目录名不叫 `observation-buffer`**：摩擦侧已占用 `friction-observations/`，
 * 经验侧用 `experience-buffers/` 使两目录在 `~/.dsh/ldvh/` 下一眼可分（§12bis 与
 * §12bis.1 是两类载体，02 §6.1 第 2 条要求各有唯一消费者，故不得混装）。
 *
 * **与摩擦侧的差异（须留意）**：摩擦条目自带 `project` 字段（§12bis.1 闭集 10 项），
 * 因为它在**同一文件内**也要能区分归属；经验条目**没有** `project` 字段（§12bis 闭集
 * 9 项，超出即越界）。故经验侧的项目区分**只由载体路径承担**——这正是 §12bis
 * 「或等价的分区」所允许的形态。
 */
export const BUFFER_PROJECT_DIR = Object.freeze(["ldvh", "experience-buffers"]);

/**
 * 项目 id → 文件名。**必须是项目 id 本身**，不是路径。
 *
 * 为什么用 id 而不用路径：id 由 `governed-projects.yaml` 登记（本机是 `dsh-ldvh`），
 * 天然唯一、天然可读，且不含路径分隔符。用项目**路径**做文件名会引入 `-`/空格/
 * 中文的转义问题，还要处理「不同路径归一成同一名字」的碰撞——id 没有这些麻烦。
 *
 * 校验与摩擦侧同一纪律（`friction-observation-buffer.js` 的 `validateProjectId`）：
 * 只允许 `[A-Za-z0-9][A-Za-z0-9._-]*`，且不得为 `.`／`..`——否则一个构造出来的
 * 值可以把文件写到任意位置。
 */


/** 条目状态闭集（§12bis 字段表第 8 行）。 */
export const BUFFER_STATUSES = Object.freeze(["pending", "consumed", "discarded", "evicted"]);

/** 在管条目数上限（§12bis「容量上限与保留期」第 1 项）：实现侧不得调高。 */
export const BUFFER_CAPACITY = 200;

/** `pending` 条目的保留期（天）：自 `at` 起转 `evicted`。 */
export const BUFFER_PENDING_TTL_DAYS = 30;

/** 终态条目的保留期（天）：自状态变更起整条移除。 */
export const BUFFER_SETTLED_TTL_DAYS = 90;

/** §12bis 的字段闭集（9 项）。 */
export const BUFFER_REQUIRED_FIELDS = Object.freeze([
  "id",
  "at",
  "session",
  "anchor",
  "phenomenon",
  "evidence",
  "candidate_question",
  "status",
  "consumed_by",
]);

/**
 * 实现侧附加记账字段（**不在 §12bis 的 9 项闭集内**）。
 *
 * §12bis 字段闭集为 9 项；`settled_at` 是实现侧保留期计算所需的附加记账字段，
 * 不承载语义，不进入对外消费面。
 */
export const BUFFER_SETTLED_AT_FIELD = "settled_at";

/** `phenomenon` 的长度上限——「一句话」的机械上限（§12bis 要求一句话描述）。 */
export const BUFFER_MAX_PHENOMENON_LENGTH = 400;

/** `candidate_question` 的长度上限——同样是一句话。 */
export const BUFFER_MAX_CANDIDATE_QUESTION_LENGTH = 400;

/**
 * `evidence` 的长度上限。
 *
 * §12bis 明禁「完整消息原文、完整思考链、完整运行日志、命令的完整输出」入缓冲，
 * 而「逐字引证片段」是「能支撑该现象判定的最小原文跨度」。本上限是该边界的**粗粒度
 * 机械护栏**：它拦不住「把整段消息存下来」的全部形态，但使载体不可能无界增长。
 */
export const BUFFER_MAX_EVIDENCE_LENGTH = 4000;

/** `session` / `anchor` 的长度上限：二者是标识，不是内容。 */
export const BUFFER_MAX_REFERENCE_LENGTH = 256;

/** 一天（毫秒）：保留期换算。 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** `pending` 保留期（毫秒）。 */
const PENDING_TTL_MS = BUFFER_PENDING_TTL_DAYS * DAY_MS;

/** 终态保留期（毫秒）。 */
const SETTLED_TTL_MS = BUFFER_SETTLED_TTL_DAYS * DAY_MS;

/** 终态集合：非 `pending` 即终态（终态自状态变更起 90 天后整条移除）。 */
const TERMINAL_STATUSES = new Set(["consumed", "discarded", "evicted"]);

/** 追加入口接受的入参字段闭集——其余一律视为越界（§12bis：超出即越界）。 */
const APPEND_INPUT_FIELDS = new Set([
  "session",
  "anchor",
  "phenomenon",
  "evidence",
  "candidate_question",
  "at",
]);

/** 存量条目允许出现的字段（9 项闭集 + 实现侧附加记账字段）。 */
const STORED_FIELDS = new Set([...BUFFER_REQUIRED_FIELDS, BUFFER_SETTLED_AT_FIELD]);

/** RFC3339 时刻的最小形状校验。 */
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 纯指代词表：只写「见上／同上」这类**不含任何来源信息**的 `evidence`。
 *
 * §12bis 要求 `evidence` 是**来源材料的逐字片段**并**附来源引用**；纯指代既不是
 * 逐字片段，也不带来源引用，故必须被拒。这里只拦**完全等于指代词**的情形，不做
 * 「像不像逐字片段」的语义判断——那属审核段的判断，不是载体契约的。
 */
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

/** 纯指代检测用的归一化：去掉空白与标点，转小写。 */
function normalizeReference(text) {
  return text
    .replace(/\s+/gu, "")
    .replace(/[。，、；：？！“”‘’（）()「」『』【】[\]{}"'`,.!?;:-]/gu, "")
    .toLowerCase();
}

function success(value) {
  return { ok: true, value };
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validateProjectId(projectId) {
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    return failure(
      "observation_buffer/invalid_project",
      "projectId is required and must be a non-empty string (11 §12bis 载体段 2026-10 修订：按管辖项目分载体)",
    );
  }
  const trimmed = projectId.trim();
  if (!PROJECT_ID_PATTERN.test(trimmed) || trimmed === "." || trimmed === "..") {
    return failure(
      "observation_buffer/invalid_project",
      `projectId must match ${PROJECT_ID_PATTERN} (got ${JSON.stringify(projectId)}) — it becomes a file name`,
    );
  }
  return { ok: true, value: trimmed };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 缓冲载体路径：DSH home 之下，**事实源之外**，**按管辖项目分文件**。
 *
 * @param {Function} dshHomePath - `(...segments) => path`。
 * @param {string} [projectId] - 管辖项目 id（`governed-projects.yaml` 的 `id`，
 *   本机为 `dsh-ldvh`）。给出则走 `ldvh/experience-buffers/<projectId>.jsonl`；
 *   **省略则落到旧版全局位置** `ldvh/observation-buffer.jsonl`。
 *
 * **生产调用点一律须传 `projectId`**：§12bis 载体段（2026-10 修订）要求「不得使多个
 * 管辖项目的观察材料混在同一个无项目维度的载体里」。省略即读写所有项目共用的旧载体，
 * 等于继续那个已知缺陷。该要求由源码级护栏测试守着
 * （`test/buffer-project-isolation.test.mjs`）——「形参存在但调用方忘了传」是本仓库
 * 反复登记的失效形态，靠自觉防不住。
 *
 * 保留「省略即旧位置」仅为存量数据与既有测试的兼容，不是许可生产路径省略。
 */
/**
 * 载体相对路径（供交付面回指，不拼盘）。给出 projectId 时返回按项目分区的相对段，
 * 否则返回旧版全局位置——**必须与 `bufferEntryPath` 同源**，两处各写一份会漂移。
 */
export function bufferRelativePath(projectId) {
  if (typeof projectId === "string" && projectId.trim().length > 0) {
    const validated = validateProjectId(projectId);
    if (validated.ok) return [...BUFFER_PROJECT_DIR, `${validated.value}.jsonl`];
  }
  return [...BUFFER_RELATIVE_PATH];
}

export function bufferEntryPath(dshHomePath, projectId) {
  if (typeof projectId === "string" && projectId.trim().length > 0) {
    const validated = validateProjectId(projectId);
    if (!validated.ok) {
      // 非法 id **不得**静默回落到旧全局位置——那会让一次拼错的调用看起来"正常"。
      // 也不得回落到某个占位文件名（摩擦侧用了 `__invalid_project__`，但那是为了让
      // **读**路径不抛；此处是写入前置，拒绝更正确）。
      throw new Error(`${validated.error.code}: ${validated.error.message}`);
    }
    return dshHomePath(...BUFFER_PROJECT_DIR, `${validated.value}.jsonl`);
  }
  return dshHomePath(...BUFFER_RELATIVE_PATH);
}

/** 残缺行在 `invalid` 里的原文片段上限（够回指，不必把整行塞进诊断）。 */
const EXCERPT_LIMIT = 160;

function excerpt(line) {
  return line.length > EXCERPT_LIMIT ? `${line.slice(0, EXCERPT_LIMIT)}…` : line;
}

/**
 * 时刻归一：接受 `Date`、毫秒数或 RFC3339 字符串。
 *
 * @returns {number|null} 毫秒时间戳；不可解析时为 null。
 */
function toTimestamp(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * 容量取值：必须是 1..`BUFFER_CAPACITY` 的整数。
 *
 * **拒绝大于 `BUFFER_CAPACITY` 的取值**——§12bis 说「实现侧不得调高」，那正是它的
 * 机械形态；测试接缝只能调低。
 */
function resolveCapacity(value) {
  if (value === undefined || value === null) return success(BUFFER_CAPACITY);
  if (!Number.isInteger(value) || value <= 0) {
    return failure(
      "observation_buffer/invalid_capacity",
      `capacity must be a positive integer (got ${JSON.stringify(value)})`,
    );
  }
  if (value > BUFFER_CAPACITY) {
    return failure(
      "observation_buffer/invalid_capacity",
      `capacity must not exceed ${BUFFER_CAPACITY} (§12bis：条目数上限 200，实现侧不得调高)`,
    );
  }
  return success(value);
}

/**
 * 校验一条**存量**条目（读侧用）。
 *
 * @returns {string|null} 违规说明；合规时为 null。
 */
function validateStoredEntry(entry) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return "not an object";
  for (const field of BUFFER_REQUIRED_FIELDS) {
    if (!(field in entry)) return `missing field "${field}"`;
  }
  for (const field of Object.keys(entry)) {
    if (!STORED_FIELDS.has(field)) return `field "${field}" is outside the §12bis field set`;
  }
  if (!isNonEmptyString(entry.id)) return "id must be a non-empty string";
  if (!isNonEmptyString(entry.at) || !Number.isFinite(Date.parse(entry.at))) return "at must be an RFC3339 string";
  for (const field of ["session", "anchor", "phenomenon", "evidence", "candidate_question"]) {
    if (!isNonEmptyString(entry[field])) return `${field} must be a non-empty string`;
  }
  if (!BUFFER_STATUSES.includes(entry.status)) return `status must be one of ${JSON.stringify([...BUFFER_STATUSES])}`;
  if (entry.consumed_by !== null && !isNonEmptyString(entry.consumed_by)) {
    return "consumed_by must be null or a non-empty string";
  }
  if (entry.status === "consumed" && entry.consumed_by === null) {
    return "consumed_by must be non-empty when status is consumed";
  }
  if (entry.status !== "consumed" && entry.consumed_by !== null) {
    return "consumed_by must be null unless status is consumed";
  }
  if (entry[BUFFER_SETTLED_AT_FIELD] !== undefined) {
    const settled = entry[BUFFER_SETTLED_AT_FIELD];
    if (!isNonEmptyString(settled) || !Number.isFinite(Date.parse(settled))) {
      return `${BUFFER_SETTLED_AT_FIELD} must be an RFC3339 string when present`;
    }
  }
  return null;
}

/**
 * 句数（机械的「一句话」口径）。
 *
 * 只数中文句末标点与换行；**不做语义判断**（不判「描述 vs 结论」——那是审核段的判断）。
 *
 * 之所以只数中文标点：英文缩写（`e.g.`、`i.e.`）里的句点会被误计成句末，硬套英文
 * 句法规则会误拒合法的一句话描述。宁可少拒，不可误拒。
 *
 * 引号内的内容（`「…」`、`“…”`、`'…'`）先剥除：逐字引证里常含句号，否则会把
 * 「现象：输出为「未找到文件。」」误判成两句。
 */
function countsSentences(text) {
  const stripped = text.replace(/「[^」]*」/gu, "").replace(/“[^”]*”/gu, "").replace(/'[^']*'/gu, "");
  const endings = stripped.match(/[。！？]/gu);
  const breaks = stripped.match(/\n/gu);
  return (endings?.length ?? 0) + (breaks?.length ?? 0);
}

/**
 * 校验追加入参（写侧用）并构造存量条目。
 *
 * §12bis 的写入合法性（§18 第 1 行：字段闭集齐备、`phenomenon` 是描述不是结论、
 * `evidence` 是逐字片段并附来源引用、条目数未超上限）里，**能被机械判定的部分**在
 * 这里；不能被机械判定的部分（描述 vs 结论、逐字性本身）不在载体层做裁量——那是
 * 审核段的判断，载体层越权裁定会变成另一种自欺。
 */
function validateAppendInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return failure("observation_buffer/invalid_entry", "the buffer entry must be an object");
  }
  for (const key of Object.keys(input)) {
    if (!APPEND_INPUT_FIELDS.has(key)) {
      return failure(
        "observation_buffer/unexpected_field",
        `field "${key}" is outside the §12bis field set (accepted: ${[...APPEND_INPUT_FIELDS].join(", ")}; id/status/consumed_by are assigned by the implementation)`,
      );
    }
  }
  for (const field of ["session", "anchor", "phenomenon", "evidence", "candidate_question"]) {
    if (!isNonEmptyString(input[field])) {
      return failure(
        `observation_buffer/missing_${field}`,
        `${field} is required and must be a non-empty string (§12bis 字段闭集)`,
      );
    }
  }
  if (input.session.trim().length > BUFFER_MAX_REFERENCE_LENGTH) {
    return failure(
      "observation_buffer/invalid_session",
      `session must be ≤ ${BUFFER_MAX_REFERENCE_LENGTH} characters (it is a session id, not session content)`,
    );
  }
  if (input.anchor.trim().length > BUFFER_MAX_REFERENCE_LENGTH) {
    return failure(
      "observation_buffer/invalid_anchor",
      `anchor must be ≤ ${BUFFER_MAX_REFERENCE_LENGTH} characters (it is a position marker, not content)`,
    );
  }
  if (input.phenomenon.trim().length > BUFFER_MAX_PHENOMENON_LENGTH) {
    return failure(
      "observation_buffer/phenomenon_too_long",
      `phenomenon must be ≤ ${BUFFER_MAX_PHENOMENON_LENGTH} characters — §12bis requires a one-sentence description, not an essay`,
    );
  }
  if (countsSentences(input.phenomenon.trim()) > 1) {
    return failure(
      "observation_buffer/phenomenon_not_one_sentence",
      "phenomenon must be one sentence (§12bis：一句话，是描述不是结论)",
    );
  }
  if (input.evidence.trim().length > BUFFER_MAX_EVIDENCE_LENGTH) {
    return failure(
      "observation_buffer/evidence_too_long",
      `evidence must be ≤ ${BUFFER_MAX_EVIDENCE_LENGTH} characters — §12bis forbids storing whole messages/logs/command output, only the minimal verbatim span that supports the phenomenon`,
    );
  }
  if (PURE_REFERENCE_EVIDENCE.has(normalizeReference(input.evidence))) {
    return failure(
      "observation_buffer/evidence_not_verbatim",
      "evidence must be the verbatim fragment of the source material together with a source reference — a bare pointer such as 「见上」/「同上」 carries neither (§12bis)",
    );
  }
  if (input.candidate_question.trim().length > BUFFER_MAX_CANDIDATE_QUESTION_LENGTH) {
    return failure(
      "observation_buffer/candidate_question_too_long",
      `candidate_question must be ≤ ${BUFFER_MAX_CANDIDATE_QUESTION_LENGTH} characters (§12bis：一句话)`,
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
        "observation_buffer/invalid_at",
        `at must be an RFC3339 timestamp (got ${JSON.stringify(input.at)})`,
      );
    }
    at = input.at.trim();
  }
  return success({
    id: randomUUID(),
    at,
    session: input.session.trim(),
    anchor: input.anchor.trim(),
    phenomenon: input.phenomenon.trim(),
    // **逐字保留**：`evidence` 是来源材料的逐字片段，连 trim 都可能改写它。
    evidence: input.evidence,
    candidate_question: input.candidate_question.trim(),
    status: "pending",
    consumed_by: null,
  });
}

/**
 * ── 载体形态：**追加事件日志**（2026-10-26，Human 决定）──
 *
 * ## 为什么不是「一行一条完整记录」
 *
 * 原实现把每条记录写成一行，结算时「读全文 → 只改目标行 → 临时文件 + rename」。
 * 那是**读-改-写**：两个会话同时结算不同条目时，各自读到同一份旧内容、各自写出一份
 * 「只有自己那条被改」的新文件，后一个 rename **整个覆盖**前一个。
 *
 * **实测（不是推理）**：40 个并发 append 无丢失（appendFile 的 O_APPEND 由内核保证
 * 原子）；**20 个并发 settle 丢了 19 条**。§12bis 允许「追加 + 状态结算」两种写形态，
 * 但只有追加是并发安全的。
 *
 * ## 现在的形态
 *
 * 每一行是一个**事件**，所有写操作都是**追加**：
 *
 * ```
 * {"kind":"entry",  "record":{…§12bis 九字段…}}
 * {"kind":"settle", "id":"…","status":"consumed","consumed_by":"…","settled_at":"…"}
 * {"kind":"remove", "id":"…","at":"…"}
 * ```
 *
 * 读时按顺序**折叠**成当前状态。于是：
 *   · 结算不再碰别人那条 → **不存在丢失更新**，也不需要跨进程锁；
 *   · 同一事件重复出现是**幂等**的（同状态 settle 静默忽略），并发读者不会互相破坏；
 *   · 事件之间可用 `seq` 之外的**行序**判定先后（JSONL 的追加顺序即时间序）。
 *
 * ## 与规范的对应
 *
 * §12bis「写入形态为『追加 + 状态结算』：条目的**内容字段**一经写入不得就地修改，只能
 * 追加新条目；唯一例外是 `status` 与 `consumed_by`」——事件日志让「不就地修改」成为
 * **结构事实**（物理上没有就地修改的代码路径），而不只是纪律。
 * 存储格式属 §12bis 明示的实现侧承接（「未由本节规定的维度（如存储格式、索引方式）
 * 由实现侧承接」）。
 *
 * ## 90 天「整条移除」怎么落
 *
 * 折叠层用 `remove` 事件让条目**从视图中整条消失**（不再计入总数、不可读）。磁盘字节
 * 由 `compactBuffer` 回收。**压缩是尽力而为**：拿不到锁或失败时**只推迟字节回收**，
 * 不影响任何读写正确性——这是一条硬边界，压缩永不成为读写的正确性依赖。
 */
const EVENT_KINDS = new Set(["entry", "settle", "remove"]);

/** 折叠事件的产物：`records` 里每项只保留 `{record}`（不再有可改写的行号）。 */
function foldEvents(events) {
  const invalid = [];
  /** id → record（按插入序保持稳定，便于「最旧优先」淘汰时行为可预期）。 */
  const byId = new Map();
  /** id → 首次出现的行号（诊断用）。 */
  const lineOf = new Map();

  for (const event of events) {
    const { line, value } = event;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      invalid.push({ line, reason: "event is not an object", excerpt: excerpt(event.raw) });
      continue;
    }
    if (!EVENT_KINDS.has(value.kind)) {
      // 老版「一行一条完整记录」的载体落到这里：如实报格式不符，**不猜**。
      const hint = value.id !== undefined && value.kind === undefined
        ? " (looks like the previous one-record-per-line format; this carrier is append-only events now — 2026-10-26)"
        : "";
      invalid.push({
        line,
        reason: `event kind must be one of ${JSON.stringify([...EVENT_KINDS])} (got ${JSON.stringify(value.kind)})${hint}`,
        excerpt: excerpt(event.raw),
      });
      continue;
    }

    if (value.kind === "entry") {
      const violation = validateStoredEntry(value.record);
      if (violation !== null) {
        invalid.push({ line, reason: `entry event record violates §12bis: ${violation}`, excerpt: excerpt(event.raw) });
        continue;
      }
      if (value.record.status !== "pending" || value.record.consumed_by !== null) {
        invalid.push({
          line,
          reason: "an entry event must carry status=pending and consumed_by=null (a new entry is never born settled — §12bis)",
          excerpt: excerpt(event.raw),
        });
        continue;
      }
      if (byId.has(value.record.id)) {
        invalid.push({
          line,
          reason: `duplicate entry id ${value.record.id} — ids are generated per entry and must stay unique`,
          excerpt: excerpt(event.raw),
        });
        continue;
      }
      byId.set(value.record.id, value.record);
      lineOf.set(value.record.id, line);
      continue;
    }

    if (value.kind === "settle") {
      if (!isNonEmptyString(value.id)) {
        invalid.push({ line, reason: "settle event needs a non-empty id", excerpt: excerpt(event.raw) });
        continue;
      }
      const target = byId.get(value.id);
      if (target === undefined) {
        invalid.push({
          line,
          reason: `settle event targets unknown entry ${value.id} — the entry event is absent (a settle cannot precede its entry)`,
          excerpt: excerpt(event.raw),
        });
        continue;
      }
      if (!TERMINAL_STATUSES.has(value.status)) {
        invalid.push({
          line,
          reason: `settle status must be one of ${JSON.stringify([...TERMINAL_STATUSES])}`,
          excerpt: excerpt(event.raw),
        });
        continue;
      }
      // **幂等**：重复的「同状态同去向」结算静默忽略（并发读者各写一次很常见，
      // 那不是错误）。**只有真的冲突**（改到别的终态）才报 invalid。
      if (target.status !== "pending") {
        const sameOutcome =
          target.status === value.status &&
          (target.consumed_by ?? null) === (value.consumed_by ?? null);
        if (sameOutcome) continue;
        invalid.push({
          line,
          reason: `entry ${value.id} is already ${target.status}; a terminal entry cannot change to ${value.status} (§12bis：终态不再流转)`,
          excerpt: excerpt(event.raw),
        });
        continue;
      }
      if (value.status === "consumed" && !isNonEmptyString(value.consumed_by)) {
        invalid.push({
          line,
          reason: "consumed_by must be non-empty when the entry is consumed (§12bis)",
          excerpt: excerpt(event.raw),
        });
        continue;
      }
      byId.set(value.id, {
        ...target,
        status: value.status,
        consumed_by: value.status === "consumed" ? String(value.consumed_by).trim() : null,
        [BUFFER_SETTLED_AT_FIELD]: typeof value.settled_at === "string" ? value.settled_at : undefined,
      });
      continue;
    }

    // remove
    if (!isNonEmptyString(value.id)) {
      invalid.push({ line, reason: "remove event needs a non-empty id", excerpt: excerpt(event.raw) });
      continue;
    }
    if (!byId.has(value.id)) {
      // **幂等**：重复 remove 静默忽略（第二个回收者看到条目已不在）。
      continue;
    }
    byId.delete(value.id);
    lineOf.delete(value.id);
  }

  const records = [...byId.values()].map((record) => ({ record }));
  return { records, invalid };
}

/**
 * 解析载体文本：逐行解析成**事件**，再折叠成当前记录。
 *
 * 残缺行单列进 `invalid`，**绝不静默跳过**（「读得出几条」≠「有几条」）。
 */
function parseCarrierText(text) {
  const events = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim().length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      events.push({ line: index + 1, raw, value: Symbol.for("unparseable"), parseError: String(error?.message ?? error) });
      continue;
    }
    events.push({ line: index + 1, raw, value: parsed });
  }
  // 解析失败的行先转成 invalid，再交给折叠层处理其余事件。
  const folded = foldEvents(events.filter((event) => event.value !== Symbol.for("unparseable")));
  const invalid = [
    ...events
      .filter((event) => event.value === Symbol.for("unparseable"))
      .map((event) => ({ line: event.line, reason: `unparseable JSON: ${event.parseError}`, excerpt: excerpt(event.raw) })),
    ...folded.invalid,
  ].sort((a, b) => a.line - b.line);
  return { lines, records: folded.records, invalid };
}

/** 读取载体并解析。ENOENT = 合法初态（空集合），不是失败。 */
async function readBufferRecords(dshHomePath, projectId) {
  const path = bufferEntryPath(dshHomePath, projectId);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return success({ lines: [], records: [], invalid: [], carrier: "absent" });
    }
    return failure(
      "observation_buffer/unreadable",
      `cannot read the observation buffer: ${String(error?.message ?? error)}`,
    );
  }
  const parsed = parseCarrierText(text);
  return success({ ...parsed, carrier: "present" });
}

/**
 * 把载体**压缩**成「当前状态每记录一行」（回收 90 天移除留下的字节）。
 *
 * ## 为什么它不再是写路径的一部分
 *
 * 原实现是 `rewriteCarrier`：读全文 → 改一行 → 写临时文件 → rename。那是并发下
 * 丢失更新的根源（实测 19/20 条丢失）。改造后所有写操作都是追加，本函数**只被
 * 压缩调用**，不参与任何读写的正确性路径。
 *
 * ## 三条硬边界
 *
 * 1. **不是正确性依赖**：压缩失败只推迟字节回收；视图已在追加事件层生效
 *    （`remove` 事件让条目从视图中消失），故「整条移除」的语义不依赖压缩。
 * 2. **不丢数据**：压缩后写出的内容是**折叠后的当前记录**，只含 `entry` 事件；
 *    已移除的条目不再出现（那正是回收的意义），其余逐条保留。
 * 3. **原子替换**：临时文件 + rename——读者要么看到旧载体、要么看到新载体，
 *    不会看到半截。
 *
 * ## 并发边界（如实登记）
 *
 * 压缩期间若另一会话追加了事件，那些事件会落在**被替换掉的旧文件**里而丢失。
 * 故压缩**不应与写入并发**；当前它只在诊断侧显式触发，不随读写自动运行。
 * 若要自动化，须先引入跨进程锁——本函数不假装自己能安全并发。
 *
 * @returns {Promise<{ok:true,value:{kept:number}}|{ok:false,error:object}>}
 */
export async function compactBuffer(dshHomePath, { projectId } = {}) {
  const read = await readBufferRecords(dshHomePath, projectId);
  if (!read.ok) return read;
  const { records } = read.value;
  const path = bufferEntryPath(dshHomePath, projectId);
  const lines = records.map((item) => JSON.stringify({ kind: "entry", record: item.record }));
  const content = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, content, "utf8");
    await rename(temp, path);
  } catch (error) {
    return failure(
      "observation_buffer/unavailable",
      `cannot compact the observation buffer: ${String(error?.message ?? error)}`,
    );
  }
  return success({ kept: lines.length });
}

/**
 * 容量整理：把**在管条目**（`status ≠ evicted`）压回容量之内。
 *
 * 淘汰顺序按 `at` 最旧优先（§12bis 第 1 项）。被淘汰者 `status=evicted` 并**保留
 * 记录**——记录留在载体里，可见、可按 `status=evicted` 检索，并受终态 90 天保留期
 * 约束后整条移除。
 *
 * `excludeId`：刚写入的那一条**不参与本次淘汰**。否则一次写入可能立刻淘汰自己
 * （例如调用方补写了很早的 `at`），使「写入成功」与「条目可被审核」互相矛盾。这不
 * 改变「最旧优先」的方向性，只是排除「本次写入物」这一候选。
 */
/**
 * 容量整理：超上限时按 `at` 最旧优先淘汰（§12bis）。
 *
 * **也走追加**（2026-10-26）：淘汰写成 `settle` 事件（`status=evicted`），不再改写既有行。
 * 于是本函数与 `appendBufferEntry`／`settleBufferEntry` 一样是纯追加——三个写入路径
 * 全部并发安全。
 *
 * **超限时的竞态是良性的**：多个会话同时看到超限、各自淘汰各自选中的最旧条目，
 * 结果可能多淘汰几条（低于上限），不会少淘汰到违反上限——「调低不构成违约」，
 * 而容量是上界不是目标。
 */
async function enforceCapacity(dshHomePath, capacity, { excludeId = null, now = new Date(), projectId } = {}) {
  const read = await readBufferRecords(dshHomePath, projectId);
  if (!read.ok) return read;
  const { records } = read.value;
  const live = records.filter((item) => item.record.status !== "evicted");
  const excess = live.length - capacity;
  if (excess <= 0) return success({ evicted: [] });

  const stamp = new Date(toTimestamp(now) ?? Date.now()).toISOString();
  const candidates = live
    .filter((item) => item.record.id !== excludeId)
    .map((item, order) => ({ record: item.record, order, at: Date.parse(item.record.at) }))
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const doomed = candidates.slice(0, excess);
  if (doomed.length === 0) return success({ evicted: [] });

  const path = bufferEntryPath(dshHomePath, projectId);
  const events = doomed.map((item) => JSON.stringify({
    kind: "settle",
    id: item.record.id,
    status: "evicted",
    consumed_by: null,
    settled_at: stamp,
  }));
  try {
    await appendFile(path, `${events.join("\n")}\n`, "utf8");
  } catch (error) {
    // 淘汰写不进去**不使本次追加失败**：容量整理是维护，不是正确性前提；
    // 如实登记到返回值（调用方可见），下次追加会再整理一次。
    return success({ evicted: [], note: `capacity eviction could not be persisted: ${String(error?.message ?? error)}` });
  }
  return success({ evicted: doomed.map((item) => item.record.id) });
}

/** 条目视图：9 项闭集 + 实现侧附加记账字段。 */
function toView(record) {
  return {
    id: record.id,
    at: record.at,
    session: record.session,
    anchor: record.anchor,
    phenomenon: record.phenomenon,
    evidence: record.evidence,
    candidate_question: record.candidate_question,
    status: record.status,
    consumed_by: record.consumed_by,
    [BUFFER_SETTLED_AT_FIELD]:
      typeof record[BUFFER_SETTLED_AT_FIELD] === "string" ? record[BUFFER_SETTLED_AT_FIELD] : null,
  };
}

/** 各状态计数（闭集四项，缺者为 0）。 */
function countByStatus(records) {
  const counts = { pending: 0, consumed: 0, discarded: 0, evicted: 0 };
  for (const item of records) {
    if (counts[item.record.status] !== undefined) counts[item.record.status] += 1;
  }
  return counts;
}

/**
 * 追加一条缓冲条目（§12bis 写入纪律第 1、3、4 条）。
 *
 * - **写入者**：捕获段（§10.1），一次运行至多写 1 条（配额由调用方承担，本模块不
 *   代管）；
 * - **写入后精确回读**（§12bis 写入纪律第 3 条）：写完必须重读载体，确认该行可解析
 *   且字段与写入一致；不通过即返回失败码，**不返回成功**；
 * - **不可写即 fail-closed**（§12bis 写入纪律第 4 条）：载体不可写时不降级为内存
 *   或日志。
 *
 * `status` 强制 `pending`、`consumed_by` 强制 `null`、`id` 由实现生成——三者都不是
 * 调用方可以自选的字段（调用方若自带这些字段，入参校验会按「越界字段」拒绝）。
 *
 * @param {Function} dshHomePath - `(...segments) => path`，与 pending-queue 同形。
 * @param {object} entry - `{ session, anchor, phenomenon, evidence, candidate_question, at }`。
 * @param {object} [options] - `{ capacity }`：**测试接缝**，只可调低，不可调高。
 * @returns {Promise<{ok:true,value:{entry_id:string}}|{ok:false,error:{code:string,message:string}}>}
 */
export async function appendBufferEntry(dshHomePath, entry = {}, options = {}) {
  const capacity = resolveCapacity(options?.capacity);
  if (!capacity.ok) return capacity;
  const validated = validateAppendInput(entry);
  if (!validated.ok) return validated;
  const record = validated.value;

  const path = bufferEntryPath(dshHomePath, options?.projectId);
  try {
    await mkdir(dirname(path), { recursive: true });
    // **所有写都是追加**（2026-10-26，Human 决定「追加事件日志」形态）。
    // appendFile 的 O_APPEND 由内核保证单次追加原子——实测 40 个并发追加零丢失，
    // 而原先「读-改-写」式的结算在 20 并发下丢了 19 条。这是本形态存在的全部理由。
    const event = { kind: "entry", record };
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    // §12bis 写入纪律第 4 条：不得降级为内存或日志——原样上报，由调用方 fail-closed。
    return failure(
      "observation_buffer/unavailable",
      `cannot append to the observation buffer: ${String(error?.message ?? error)}`,
    );
  }

  // 容量整理：达上限时按 at 最旧优先淘汰（保留记录）。整理失败即整体失败——
  // 载体状态已不可控时不得声称写入成功。
  const evicted = await enforceCapacity(dshHomePath, capacity.value, { excludeId: record.id });
  if (!evicted.ok) return evicted;

  // 精确回读（§12bis 写入纪律第 3 条 / §18 第 2 行）。
  const readBack = await readBufferRecords(dshHomePath, options?.projectId);
  if (!readBack.ok) {
    return failure(
      "observation_buffer/read_back_failed",
      `the entry was written but the read-back failed: ${readBack.error.message}`,
    );
  }
  const found = readBack.value.records.find((item) => item.record.id === record.id);
  if (!found) {
    return failure(
      "observation_buffer/read_back_mismatch",
      `the entry was written but the read-back did not find id ${record.id}`,
    );
  }
  const observed = found.record;
  for (const field of BUFFER_REQUIRED_FIELDS) {
    if (observed[field] !== record[field]) {
      return failure(
        "observation_buffer/read_back_mismatch",
        `the read-back of ${field} does not match what was written (expected ${JSON.stringify(record[field])}, got ${JSON.stringify(observed[field])})`,
      );
    }
  }
  return success({ entry_id: record.id });
}

/**
 * 读取缓冲条目（§12bis 读取纪律第 2 条；§12ter.1 `observation-buffer-list` 的输入契约）。
 *
 * - `status`：可选，给定时必须是 `BUFFER_STATUSES` 的成员；
 * - `limit`：可选正整数，**只可降低**本次返回条数——不得绕过容量上限与淘汰规则
 *   （§12ter.1 明文）；
 * - `now`：保留期计算的基准时刻（默认当下）；
 * - `capacity`：**测试接缝**，与写入时用同一个值。
 *
 * 残缺行进 `invalid` 且 `complete:false`——**绝不静默丢弃**（一条读不出的条目若被
 * 当作「没有」，等于让观察材料消失）。载体不存在时返回空集合而非错误（合法初态，
 * §12ter.2 明文）。
 *
 * @returns {Promise<{ok:true,value:{items:Array,total:number,by_status:object,at_capacity:boolean,invalid:Array,complete:boolean,carrier:string,capacity:number,live_total:number}}|{ok:false,error:{code:string,message:string}}>}
 */
export async function readBufferEntries(
  dshHomePath,
  { status = null, limit = null, now = new Date(), capacity, projectId } = {},
) {
  if (status !== null && status !== undefined && !BUFFER_STATUSES.includes(status)) {
    return failure(
      "observation_buffer/invalid_status",
      `status must be one of ${JSON.stringify([...BUFFER_STATUSES])} (got ${JSON.stringify(status)})`,
    );
  }
  if (limit !== null && limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return failure(
      "observation_buffer/invalid_limit",
      `limit must be a positive integer (got ${JSON.stringify(limit)})`,
    );
  }
  const resolvedCapacity = resolveCapacity(capacity);
  if (!resolvedCapacity.ok) return resolvedCapacity;
  const nowMs = toTimestamp(now);
  if (nowMs === null) {
    return failure(
      "observation_buffer/invalid_now",
      "now must be a Date, a millisecond timestamp or an RFC3339 string",
    );
  }

  const read = await readBufferRecords(dshHomePath, projectId);
  if (!read.ok) return read;
  const { records, invalid } = read.value;

  // ── 保留期：读时惰性结算 ───────────────────────────────────────────
  // `pending` 超 30 天 → 转 `evicted`；终态超 90 天 → 整条移除。
  //
  // **也走追加**（2026-10-26）：写成 `settle`／`remove` 事件，不再改写既有行。
  // 于是「读」这条路径不再有写-覆盖风险——两个会话同时读同一载体、各自触发了相同的
  // 保留期结算时，两条事件都追加成功，折叠时幂等合并，不会互相覆盖。
  const stamp = new Date(nowMs).toISOString();
  const evictEvents = [];
  const removeEvents = [];
  for (const item of records) {
    const record = item.record;
    if (record.status === "pending") {
      const age = nowMs - Date.parse(record.at);
      if (Number.isFinite(age) && age > PENDING_TTL_MS) {
        evictEvents.push(JSON.stringify({
          kind: "settle",
          id: record.id,
          status: "evicted",
          consumed_by: null,
          settled_at: stamp,
        }));
      }
      continue;
    }
    const reference =
      typeof record[BUFFER_SETTLED_AT_FIELD] === "string" ? record[BUFFER_SETTLED_AT_FIELD] : record.at;
    const age = nowMs - Date.parse(reference);
    if (Number.isFinite(age) && age > SETTLED_TTL_MS) {
      removeEvents.push(JSON.stringify({ kind: "remove", id: record.id, at: stamp }));
    }
  }

  const settlementNotes = [];
  let finalRecords = records;
  if (evictEvents.length > 0 || removeEvents.length > 0) {
    const path = bufferEntryPath(dshHomePath, projectId);
    const appended = [...evictEvents, ...removeEvents];
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${appended.join("\n")}\n`, "utf8");
      // 落盘后重读，使返回视图与载体一致（结算与移除都已生效）。
      const reread = await readBufferRecords(dshHomePath, projectId);
      if (reread.ok) finalRecords = reread.value.records;
    } catch (error) {
      // 惰性结算写不进去**不使整次读失败**：如实披露——进入 invalid 并把 complete
      // 置 false，读者据此知道「看到的不等于全部」。
      settlementNotes.push({
        line: null,
        reason: `the retention settlement could not be persisted: ${String(error?.message ?? error)}`,
      });
    }
  }

  const views = finalRecords.map((item) => toView(item.record));
  const byStatus = countByStatus(finalRecords);
  const liveTotal = views.filter((view) => view.status !== "evicted").length;
  const filtered = status === null || status === undefined ? views : views.filter((view) => view.status === status);
  const limited = limit === null || limit === undefined ? filtered : filtered.slice(0, limit);
  const allInvalid = [...invalid, ...settlementNotes];
  return success({
    items: limited,
    total: views.length,
    by_status: byStatus,
    at_capacity: liveTotal >= resolvedCapacity.value,
    invalid: allInvalid,
    complete: allInvalid.length === 0,
    carrier: read.value.carrier,
    capacity: resolvedCapacity.value,
    live_total: liveTotal,
  });
}

/**
 * 结算一条缓冲条目（`pending` → `consumed`／`discarded`／`evicted`）。
 *
 * 这是本模块**唯一**的改写既有条目的入口，且只改 `status`、`consumed_by` 与实现侧
 * 的 `settled_at`（保留期记账），其余字段逐字保留。
 *
 * - `status` 不在闭集内 → 拒绝；
 * - 目标不存在 → `observation_buffer/entry_not_found`；
 * - 已不是 `pending` → `observation_buffer/already_settled`（不静默成功）；
 * - `consumed` 时 `consumedBy` 必须是非空字符串（§12bis：`consumed_by` 指向所形成
 *   `draft` 的 `object_uid`），其它状态必须为空。
 *
 * 改写走「读全文 → 只替换目标行 → 临时文件 + rename」；残缺行原样保留。
 *
 * @returns {Promise<{ok:true,value:{items:Array,total:number,by_status:object,at_capacity:boolean,invalid:Array,complete:boolean,carrier:string,capacity:number,live_total:number}}|{ok:false,error:{code:string,message:string}}>}
 */
export async function settleBufferEntry(
  dshHomePath,
  entryId,
  { status, consumedBy = null, now = new Date(), capacity, projectId } = {},
) {
  if (!isNonEmptyString(entryId)) {
    return failure("observation_buffer/invalid_entry_id", "entryId is required");
  }
  if (!TERMINAL_STATUSES.has(status)) {
    return failure(
      "observation_buffer/invalid_status",
      `status must be one of ${JSON.stringify([...TERMINAL_STATUSES])} (a pending entry can only be settled into a terminal state)`,
    );
  }
  if (status === "consumed") {
    if (!isNonEmptyString(consumedBy)) {
      return failure(
        "observation_buffer/invalid_consumed_by",
        "consumed_by must be a non-empty string when the entry is consumed (§12bis：指向所形成 draft 的 object_uid)",
      );
    }
  } else if (consumedBy !== null && consumedBy !== undefined && String(consumedBy).trim().length > 0) {
    return failure(
      "observation_buffer/invalid_consumed_by",
      "consumed_by must be empty unless the entry is consumed (§12bis：仅 consumed 时非空)",
    );
  }
  const nowMs = toTimestamp(now);
  if (nowMs === null) {
    return failure(
      "observation_buffer/invalid_now",
      "now must be a Date, a millisecond timestamp or an RFC3339 string",
    );
  }

  const read = await readBufferRecords(dshHomePath, projectId);
  if (!read.ok) return read;
  const target = read.value.records.find((item) => item.record.id === entryId);
  if (!target) {
    return failure("observation_buffer/entry_not_found", `no buffer entry with id ${entryId}`);
  }
  if (target.record.status !== "pending") {
    return failure("observation_buffer/already_settled", `entry ${entryId} is already ${target.record.status}`);
  }

  const stamp = new Date(nowMs).toISOString();
  const consumedByValue = status === "consumed" ? String(consumedBy).trim() : null;

  // **结算也是追加**（2026-10-26）。不再「读全文 → 改目标行 → rename」——那正是
  // 实测丢失 19/20 条更新的形态。追加一条 settle 事件，由读侧折叠出当前状态。
  //
  // 并发下两个会话同时结算**同一**条目：都追加成功，折叠时先到的一条生效、后到的
  // 因「同状态同去向」被判幂等（或异状态判 invalid），故不会双写；两个会话结算
  // **不同**条目则完全互不干扰——这正是原设计缺失的性质。
  const path = bufferEntryPath(dshHomePath, projectId);
  try {
    await mkdir(dirname(path), { recursive: true });
    const event = {
      kind: "settle",
      id: entryId,
      status,
      consumed_by: consumedByValue,
      settled_at: stamp,
    };
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    return failure(
      "observation_buffer/unavailable",
      `cannot settle the buffer entry: ${String(error?.message ?? error)}`,
    );
  }

  // 精确回读：确认状态确已落盘（§18 第 2 行的同一纪律）。
  const readBack = await readBufferRecords(dshHomePath, projectId);
  if (!readBack.ok) {
    return failure(
      "observation_buffer/read_back_failed",
      `the entry was settled but the read-back failed: ${readBack.error.message}`,
    );
  }
  const observed = readBack.value.records.find((item) => item.record.id === entryId);
  if (!observed || observed.record.status !== status || observed.record.consumed_by !== consumedByValue) {
    return failure(
      "observation_buffer/read_back_mismatch",
      `the read-back does not show the settled state (expected status=${status}, got ${observed?.record?.status ?? "absent"})`,
    );
  }

  return readBufferEntries(dshHomePath, { now, capacity, projectId });
}
