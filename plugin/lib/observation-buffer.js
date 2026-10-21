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

/** DSH home 下的相对位置（与 pending-queue 同层，**不在事实源内**）。 */
export const BUFFER_RELATIVE_PATH = Object.freeze(["ldvh", "observation-buffer.jsonl"]);

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

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 缓冲载体路径：DSH home 之下，**事实源之外**。 */
export function bufferEntryPath(dshHomePath) {
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

/** 解析载体文本：逐行解析，残缺行单列，绝不静默跳过。 */
function parseCarrierText(text) {
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
        reason: `unparseable JSON: ${String(error?.message ?? error)}`,
        excerpt: excerpt(line),
      });
      continue;
    }
    const violation = validateStoredEntry(parsed);
    if (violation !== null) {
      invalid.push({ line: index + 1, reason: violation, excerpt: excerpt(line) });
      continue;
    }
    records.push({ line: index + 1, index, record: parsed });
  }
  return { lines, records, invalid };
}

/** 读取载体并解析。ENOENT = 合法初态（空集合），不是失败。 */
async function readBufferRecords(dshHomePath) {
  const path = bufferEntryPath(dshHomePath);
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
 * 原子写回：临时文件 + rename（读者不会看到半截文件）。
 *
 * 写出的内容**必须以换行结尾**——JSONL 的追加语义依赖「最后一行之后有换行」，否则
 * 下一次 `appendFile` 会接在残缺行尾上，把两条记录黏成一行。
 */
async function rewriteCarrier(dshHomePath, lines) {
  const path = bufferEntryPath(dshHomePath);
  const body = lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  const content = body.length > 0 ? `${body.join("\n")}\n` : "";
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, content, "utf8");
    await rename(temp, path);
  } catch (error) {
    return failure(
      "observation_buffer/unavailable",
      `cannot write the observation buffer: ${String(error?.message ?? error)}`,
    );
  }
  return success({});
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
async function enforceCapacity(dshHomePath, capacity, { excludeId = null, now = new Date() } = {}) {
  const read = await readBufferRecords(dshHomePath);
  if (!read.ok) return read;
  const { lines, records } = read.value;
  const live = records.filter((item) => item.record.status !== "evicted");
  const excess = live.length - capacity;
  if (excess <= 0) return success({ evicted: [] });

  const stamp = new Date(toTimestamp(now) ?? Date.now()).toISOString();
  const candidates = live
    .filter((item) => item.record.id !== excludeId)
    .map((item, order) => ({ ...item, order, at: Date.parse(item.record.at) }))
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const doomed = candidates.slice(0, excess);
  if (doomed.length === 0) return success({ evicted: [] });

  const doomedByIndex = new Map(doomed.map((item) => [item.index, item.record]));
  const next = lines.map((line, index) => {
    const original = doomedByIndex.get(index);
    if (!original) return line;
    return JSON.stringify({
      ...original,
      status: "evicted",
      consumed_by: null,
      [BUFFER_SETTLED_AT_FIELD]: stamp,
    });
  });
  const written = await rewriteCarrier(dshHomePath, next);
  if (!written.ok) return written;
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

  const path = bufferEntryPath(dshHomePath);
  try {
    await mkdir(dirname(path), { recursive: true });
    // JSONL 追加：一行一条。appendFile 的 O_APPEND 语义使并发写入不互相覆盖，
    // 与「追加型」契约天然一致。
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
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
  const readBack = await readBufferRecords(dshHomePath);
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
  { status = null, limit = null, now = new Date(), capacity } = {},
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

  const read = await readBufferRecords(dshHomePath);
  if (!read.ok) return read;
  const { lines, records, invalid } = read.value;

  // ── 保留期：读时惰性结算 ───────────────────────────────────────────
  // `pending` 超 30 天 → 转 `evicted`（落盘）；终态超 90 天 → 整条移除（落盘）。
  const stamp = new Date(nowMs).toISOString();
  const settledByIndex = new Map();
  const removedIndexes = new Set();
  for (const item of records) {
    const record = item.record;
    if (record.status === "pending") {
      const age = nowMs - Date.parse(record.at);
      if (Number.isFinite(age) && age > PENDING_TTL_MS) {
        settledByIndex.set(item.index, {
          ...record,
          status: "evicted",
          consumed_by: null,
          [BUFFER_SETTLED_AT_FIELD]: stamp,
        });
      }
      continue;
    }
    const reference =
      typeof record[BUFFER_SETTLED_AT_FIELD] === "string" ? record[BUFFER_SETTLED_AT_FIELD] : record.at;
    const age = nowMs - Date.parse(reference);
    if (Number.isFinite(age) && age > SETTLED_TTL_MS) {
      removedIndexes.add(item.index);
    }
  }

  const settlementNotes = [];
  let finalRecords = records;
  if (settledByIndex.size > 0 || removedIndexes.size > 0) {
    // 逐行改写：被结算的行替换内容，被移除的行删掉，其余逐字保留（残缺行不丢）。
    const rewritten = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (removedIndexes.has(index)) continue;
      const settled = settledByIndex.get(index);
      rewritten.push(settled ? JSON.stringify(settled) : lines[index]);
    }
    const written = await rewriteCarrier(dshHomePath, rewritten);
    if (!written.ok) {
      // 惰性回写失败**不使整次读失败**：如实披露——进入 invalid 并把 complete 置 false，
      // 读者据此知道「看到的不等于全部」。
      settlementNotes.push({
        line: null,
        reason: `the retention settlement could not be persisted: ${written.error.message}`,
      });
    } else {
      // 落盘后重读，使返回视图与载体一致（结算与移除都已生效）。
      const reread = await readBufferRecords(dshHomePath);
      if (reread.ok) finalRecords = reread.value.records;
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
  { status, consumedBy = null, now = new Date(), capacity } = {},
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

  const path = bufferEntryPath(dshHomePath);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return failure("observation_buffer/entry_not_found", `no buffer entry with id ${entryId}`);
    }
    return failure(
      "observation_buffer/unreadable",
      `cannot read the observation buffer: ${String(error?.message ?? error)}`,
    );
  }

  const { lines, records } = parseCarrierText(raw);
  const target = records.find((item) => item.record.id === entryId);
  if (!target) {
    return failure("observation_buffer/entry_not_found", `no buffer entry with id ${entryId}`);
  }
  if (target.record.status !== "pending") {
    return failure("observation_buffer/already_settled", `entry ${entryId} is already ${target.record.status}`);
  }

  const stamp = new Date(nowMs).toISOString();
  const updated = {
    ...target.record,
    status,
    consumed_by: status === "consumed" ? String(consumedBy).trim() : null,
    [BUFFER_SETTLED_AT_FIELD]: stamp,
  };
  const next = lines.map((line, index) => (index === target.index ? JSON.stringify(updated) : line));
  const written = await rewriteCarrier(dshHomePath, next);
  if (!written.ok) return written;

  // 精确回读：确认状态确已落盘（§18 第 2 行的同一纪律）。
  const readBack = await readBufferRecords(dshHomePath);
  if (!readBack.ok) {
    return failure(
      "observation_buffer/read_back_failed",
      `the entry was settled but the read-back failed: ${readBack.error.message}`,
    );
  }
  const observed = readBack.value.records.find((item) => item.record.id === entryId);
  if (!observed || observed.record.status !== status || observed.record.consumed_by !== updated.consumed_by) {
    return failure(
      "observation_buffer/read_back_mismatch",
      `the read-back does not show the settled state (expected status=${status}, got ${observed?.record?.status ?? "absent"})`,
    );
  }

  return readBufferEntries(dshHomePath, { now, capacity });
}
