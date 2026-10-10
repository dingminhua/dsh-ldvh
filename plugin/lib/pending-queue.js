/**
 * dsh-ldvh — 待处置队列 (specs/04 §8.3 「队列载体」).
 *
 * 权威：specs/04 §8.3。该节定义本模块实现的六条契约，此处不再复述其规范效力，
 * 只在需要时以章节号回指：
 *
 *   1. 载体形态 — 宿主的持久化登记（跨会话留存），**不进入事实源**：本模块的
 *      载体位于 DSH home 之下，不写项目仓库的 ldvh-base/，故队列登记不是事实
 *      对象，也不走 02 号的受控写入流程。
 *   2. 登记字段 — at / task / reason / residual / resolved_at（未完成时为 null）。
 *   3. 写入者 — 执行辅助任务的执行体，**仅追加，不修改既有登记**。
 *   4. 读取者 — 接管受影响对象的主控、Human 查阅入口、会话启动时的队列清点。
 *   5. 核查与解除 — 由接管的主控或 Human 核查后写入 resolved_at。
 *   6. 载体不可用时 fail-closed — 队列本身不可写/不可回读时，辅助任务不得继续，
 *      且**不得**降级为「只登记于内存」或「只写日志」；调用方须按 §8.3 停止并把
 *      「队列不可用」作为停止原因交由主控在下次交还时如实声明。
 *
 * 为什么「仅追加」是机械的而非自觉的：本模块只提供 append 与 read，**不提供**
 * 任何修改既有条目的入口；解除核查只写 resolved_at，且按 entry 身份定位——没有
 * 删除、没有重写 reason/residual 的路径。这样第 3 条不靠调用方自觉。
 *
 * 与事实源的关系（§8.3 第 1 条）：队列**不构成事实**，其登记内容不取得事实或
 * 授权效力。因此本模块不参与 03 §9 的受控写入，也不需要 change_log 署名。
 */

import { readFile, mkdir, appendFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** DSH home 下的相对位置（与 governed-projects 的 ["ldvh", ...] 同层）。 */
const QUEUE_RELATIVE_PATH = ["ldvh", "pending-queue.jsonl"];

/** 登记字段闭集（§8.3 第 2 条：至少含这五项）。 */
const REQUIRED_FIELDS = ["at", "task", "reason", "residual", "resolved_at"];

function queuePath(dshHomePath) {
  return dshHomePath(...QUEUE_RELATIVE_PATH);
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

/** 一条登记在机械上是否成形成立（读取时按此过滤，不完整者单列）。 */
function validateEntry(entry) {
  if (typeof entry !== "object" || entry === null) return "not an object";
  for (const field of REQUIRED_FIELDS) {
    if (!(field in entry)) return `missing field "${field}"`;
  }
  if (!isNonEmptyString(entry.at)) return "at must be a non-empty RFC3339 string";
  if (!isNonEmptyString(entry.task)) return "task must be a non-empty string";
  if (!isNonEmptyString(entry.reason)) return "reason must be a non-empty string";
  if (!Array.isArray(entry.residual)) return "residual must be an array";
  if (entry.resolved_at !== null && !isNonEmptyString(entry.resolved_at)) {
    return "resolved_at must be null or a non-empty RFC3339 string";
  }
  return null;
}

/**
 * 追加一条登记（§8.3 第 3 条：仅追加）。
 *
 * `residual` 是残留范围——**必须显式给出**（可以是空数组，表示「已核实无残留」），
 * 因为 §8.3 第 2 条把「保留已发生的副作用并如实登记」列为停止动作之一，留空与
 * 「未登记」在机械上不可区分，故不接受缺省。
 *
 * 返回 `{ ok: true, value: { entry_id } }` 或 `{ ok: false, error }`。**调用方必须
 * 处理失败**：§8.3 第 6 条规定队列不可用时辅助任务不得继续，也不得降级登记。
 */
export async function appendPendingEntry(dshHomePath, { task, reason, residual, at } = {}) {
  if (!isNonEmptyString(task)) return failure("pending_queue/invalid_task", "task is required (the auxiliary-task identifier)");
  if (!isNonEmptyString(reason)) return failure("pending_queue/invalid_reason", "reason is required (why the task stopped)");
  if (!Array.isArray(residual)) return failure("pending_queue/invalid_residual", "residual is required and must be an array (use [] only when the side-effect scope was verified empty)");

  const entry = {
    entry_id: randomUUID(),
    at: isNonEmptyString(at) ? at : new Date().toISOString(),
    task: task.trim(),
    reason: reason.trim(),
    residual: residual.map((item) => String(item)),
    resolved_at: null,
  };
  const violation = validateEntry(entry);
  if (violation !== null) return failure("pending_queue/invalid_entry", `refusing to append a malformed entry: ${violation}`);

  const path = queuePath(dshHomePath);
  try {
    await mkdir(dirname(path), { recursive: true });
    // JSONL 追加：一行一条。appendFile 的 O_APPEND 语义使并发写入不会互相覆盖，
    // 这与「仅追加」的契约天然一致。
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    // §8.3 第 6 条：不得降级为内存或日志登记——原样上报，由调用方 fail-closed。
    return failure("pending_queue/unavailable", `cannot append to the pending queue: ${String(error?.message ?? error)}`);
  }
  return success({ entry_id: entry.entry_id });
}

/**
 * 读取队列（§8.3 第 4 条）。
 *
 * - `includeResolved = false`（默认）：只返回未核查的登记——这正是「下一个主控
 *   接管时必然可见」所要求的集合。
 * - `includeResolved = true`：历史追溯（含已解除者）。
 *
 * 残缺或不成形的行**单列在 `invalid` 中，绝不静默跳过**（`03 §8.1` 的部分结果
 * 不静默截断纪律）：一条读不出的登记若被当作「没有」，等于让副作用消失。
 * 载体不存在时返回空队列（合法的初始状态），而不是失败。
 */
export async function readPendingQueue(dshHomePath, { includeResolved = false } = {}) {
  const path = queuePath(dshHomePath);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return success({ items: [], total: 0, unresolved: 0, invalid: [], complete: true, carrier: "absent" });
    }
    return failure("pending_queue/unreadable", `cannot read the pending queue: ${String(error?.message ?? error)}`);
  }

  const invalid = [];
  const all = [];
  const lines = raw.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      invalid.push({ line: index + 1, reason: `unparseable JSON: ${String(error?.message ?? error)}` });
      continue;
    }
    const violation = validateEntry(parsed);
    if (violation !== null) {
      invalid.push({ line: index + 1, reason: violation });
      continue;
    }
    all.push(parsed);
  }
  const unresolved = all.filter((entry) => entry.resolved_at === null).length;
  const items = includeResolved ? all : all.filter((entry) => entry.resolved_at === null);
  // 不成形的行存在时 complete=false——读取方据此知道「看到的不等于全部」。
  return success({ items, total: all.length, unresolved, invalid, complete: invalid.length === 0, carrier: "present" });
}

/**
 * 核查后写入 resolved_at（§8.3 第 5 条）。
 *
 * 这是本模块**唯一**的修改既有登记的入口，且只写 resolved_at 一个字段——其余
 * 字段逐字保留，所以第 3 条「不修改既有登记」在语义上仍成立（解除核查不是改写
 * 登记内容，而是记录核查已完成这一新事实）。
 *
 * 未知 entry_id、已解除者重复解除，均**拒绝而非静默成功**。
 *
 * 实现走「读全文 → 只替换目标行 → 原子改名写回」。JSONL 的追加语义在这里不适用
 * （解除是既有行的状态更新），故用临时文件 + rename 保证读者不会看到半截文件。
 */
export async function resolvePendingEntry(dshHomePath, entryId, { resolvedAt, note } = {}) {
  if (!isNonEmptyString(entryId)) return failure("pending_queue/invalid_entry_id", "entryId is required");
  const path = queuePath(dshHomePath);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return failure("pending_queue/unreadable", `cannot read the pending queue: ${String(error?.message ?? error)}`);
  }

  const stamp = isNonEmptyString(resolvedAt) ? resolvedAt : new Date().toISOString();
  const lines = raw.split("\n");
  let found = false;
  let alreadyResolved = false;
  const next = lines.map((line) => {
    if (line.trim().length === 0) return line;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return line; // 残缺行原样保留——读取侧已单列，不在写入侧丢弃
    }
    if (parsed?.entry_id !== entryId) return line;
    if (parsed.resolved_at !== null) {
      alreadyResolved = true;
      return line;
    }
    found = true;
    const updated = { ...parsed, resolved_at: stamp };
    if (isNonEmptyString(note)) updated.resolution_note = note.trim();
    return JSON.stringify(updated);
  });

  if (alreadyResolved) return failure("pending_queue/already_resolved", `entry ${entryId} was already resolved`);
  if (!found) return failure("pending_queue/entry_not_found", `no pending entry with id ${entryId}`);

  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, next.join("\n"), "utf8");
    await rename(temp, path);
  } catch (error) {
    return failure("pending_queue/unavailable", `cannot resolve the pending entry: ${String(error?.message ?? error)}`);
  }
  return success({ entry_id: entryId, resolved_at: stamp });
}

/** 会话启动时的队列清点（§8.3 第 4 条 / 32 §10.2 第 2 项）：只报数，不改动。 */
export async function countPendingEntries(dshHomePath) {
  const read = await readPendingQueue(dshHomePath, { includeResolved: false });
  if (!read.ok) return read;
  return success({
    unresolved: read.value.unresolved,
    invalid: read.value.invalid.length,
    carrier: read.value.carrier,
  });
}

export { QUEUE_RELATIVE_PATH, REQUIRED_FIELDS as PENDING_REQUIRED_FIELDS };
