/**
 * dsh-ldvh — 空闲检查点的运行痕迹（**固定容量环形**，非日志）。
 *
 * ## 为什么需要它
 *
 * 修复缺陷期间反复撞上同一个盲区：**从外部看不出「机制跑了但没发现东西」与
 * 「机制根本没跑」的区别。**
 *
 * - 水位推进会同时发生在两种情形下（旧版落地未接通时水位照样推进），故水位
 *   **不足以**作为「落地被调用过」的证据。
 * - `activity` 日志只存内存（`agent-lifecycle.js` 的 `ActivityLog`），进程重启
 *   即失——而验证修复恰恰要跨重启。
 *
 * 结果：每次验证都只能猜。本模块补上那一环——把每次检查点的**结局**持久化。
 *
 * ## 为什么是环形而不是 append-only（用户的关切）
 *
 * 待处置队列（`pending-queue.js`）是 append-only JSONL——那是对的，因为队列登记
 * 的是**异常**：罕见、且须逐条核查到解除。
 *
 * 而本模块记录的是**每轮都有的正常结局**，性质不同：若照搬 append-only，一天
 * 就是几百条、永不清理。故本模块用**固定容量环形**（保留最近 `MAX_ENTRIES` 条，
 * 超出即丢最旧），使**文件大小有硬上界**（约 N × 单条字节数）。这与
 * `friction-window.js` 的 `maxTurns` 环形同形——历史久远的运行结局本无诊断意义。
 *
 * ## 它不是事实、不是账本
 *
 * 与水位、待处置队列同属**辅助机制的运行状态**（11 §12「载体」段的理由）：
 * 位于 DSH home 之下，**不进入事实源**，不构成事实对象，不走 02 号的受控写入。
 * 它只服务诊断：回答「最近几次检查点各自落到了哪一步」。
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** DSH home 下的相对位置（与水位、待处置队列同层）。 */
const RUNLOG_RELATIVE_PATH = ["ldvh", "idle-checkpoint-runs.json"];

/**
 * 环形容量。取 50：足以看清最近的运行规律（成功/失败/无发现的分布），
 * 文件大小约十几 KB 封顶。**改这个值不影响正确性**——它只是诊断窗口的宽窄。
 */
const MAX_ENTRIES = 50;

/**
 * 解析载体路径。`dshHomePath` 是宿主注入的 `(...names) => join(home, ...names)`
 * 形态（`plugin/lib/index.js:305` 取自 `ctx.get("dshHomePath")`，同文件 222 行亦
 * 以 `typeof === "function"` 校验）。形态不符时返回 null——由调用方转成 failure，
 * **不抛**（见 `recordRun` 的「不得抛错」纪律）。
 */
function runLogPath(dshHomePath) {
  if (typeof dshHomePath !== "function") return null;
  try {
    const resolved = dshHomePath(...RUNLOG_RELATIVE_PATH);
    return typeof resolved === "string" && resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

function success(value) {
  return { ok: true, value };
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/** 与水位同样的按路径串行化（读-改-写非原子；见 friction-watermark.js 的 D3）。 */
const runLogQueues = new Map();

function serialize(key, operation) {
  const previous = runLogQueues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  runLogQueues.set(key, tail);
  return previous
    .then(operation)
    .finally(() => {
      release();
      if (runLogQueues.get(key) === tail) runLogQueues.delete(key);
    });
}

async function readAll(dshHomePath) {
  const path = runLogPath(dshHomePath);
  if (path === null) {
    return failure("runlog/unavailable", "dshHomePath is not a callable home resolver (cannot locate the run-log carrier)");
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return failure("runlog/carrier_malformed", "the run-log carrier is not a JSON object");
    }
    if (!Array.isArray(parsed.runs)) {
      return failure("runlog/carrier_malformed", "the run-log carrier carries no `runs` array");
    }
    return success(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return success({ runs: [] }); // 首次：空环形是合法初始态
    return failure("runlog/unreadable", `cannot read the run-log carrier: ${String(error?.message ?? error)}`);
  }
}

/**
 * 追加一条运行结局。
 *
 * `entry` 形状（字段都对诊断有用，故都留）：
 *   - `at`（RFC3339）：本次检查点时刻；
 *   - `task`（兼容旧读取方）：本次派发的**首个**任务；范围以 `tasks` 为准；
 *   - `tasks`：本次**本想**做的全部事项清单（一次派发做全部已启用任务，32 §10.2
 *     不设轮换）——被挡下时 Human 需要知道「是哪几件事被推后了」，只记一个任务名
 *     会掩盖范围；
 *   - `unimplemented`（可选）：已勾选但**无实现者**——须与「被挡下」区分（04 §8.5
 *     要求「勾了但没做」必须可见）；
 *   - `stage`：**落到哪一步**——`skipped`（无执行体） / `not-implemented`（任务未实现）
 *     / `throttled`（被闲时辅助的准入闸挡下——**不是失败**，内容不丢、水位不推进）
 *     / `stopped`（fail-closed 停止） / `landed`（落地已调用） / `land-failed`；
 *
 *     `throttled` 与 `stopped` **必须可区分**：前者是机制按配置歇着（下次仍会看），
 *     后者是坏了。混同会使 Human 从痕迹里读不出机制到底在干什么。
 *   - `evaluated`（可选）：三类准入约束**各自**的判定与当时的规模。放行
 *     （`admitted`）与挡下（`throttled`）**都记**——某约束若在默认取值下恒不触发，
 *     只记「被挡下」会使它与「根本没实现」不可区分，而 11 §6.2「派发准入」段
 *     要求三类约束「各自可被独立观察」。
 *   - `action`（可选）：整轮**代表**动作（`create`/`supplement`/`none`）；部分失败
 *     而成功者已落地时整轮 `stage` 为 `partial`，单一 `action` 只是主项动作——
 *     **真相在 `per_task`**；
 *   - `per_task`（可选，F-2 子项 3）：逐任务结局映射
 *     `{任务键: {outcome: landed|rejected|land-failed|no-signature, action?,
 *     object_uid?, watermark_advanced?, watermark_turn?}}`——11 §11 留痕前提
 *     「其二」的载体：连续停滞轮次由读取侧比对历次**逐任务**停点得出，不新建
 *     计数器（§11「读出来而非记出来」）；
 *   - `object_uid`（可选）：涉及账目；
 *   - `promoted`（可选）：是否发生阈值流转；
 *   - `watermark`（可选）：推进到的轮次（未推进则 absent）；
 *   - `note`（可选）：失败原因等短说明。
 *
 * **只追加、不修改**；超出容量即丢最旧（环形语义）。
 */
export async function recordRun(dshHomePath, entry = {}) {
  try {
    return await recordRunInner(dshHomePath, entry);
  } catch (error) {
    // **不得抛错**：本模块是**诊断旁路**，不是 §8.4 闭集里的机械校验。它若抛错，
    // 会打断检查点路径——那等于为了「可观测性」反而让机制本身变脆，与目的相反。
    // 形态问题一律转成 failure 由调用方如实记录（调用方亦不得因它中断）。
    return failure("runlog/unavailable", `run-log recording threw: ${String(error?.message ?? error)}`);
  }
}

async function recordRunInner(dshHomePath, entry = {}) {
  const at = typeof entry.at === "string" && entry.at.length > 0 ? entry.at : new Date().toISOString();
  // `at` 落在展开**之后**：调用方传来的 `at` 不得覆盖上面归一化过的值（这是原
  // `{ at, ...entry, at }` 的语义；重复键只是写法冗余，eslint no-dupe-keys 报错）。
  const record = { ...entry, at };
  // 单条只留有用字段，且截断自由文本，避免单条把文件撑大。
  if (typeof record.note === "string" && record.note.length > 300) {
    record.note = `${record.note.slice(0, 300)}…`;
  }

  const path = runLogPath(dshHomePath);
  if (path === null) {
    return failure("runlog/unavailable", "dshHomePath is not a callable home resolver (cannot locate the run-log carrier)");
  }

  return serialize(path, async () => {
    const doc = await readAll(dshHomePath);
    if (!doc.ok) return doc;
    const runs = [...doc.value.runs, record].slice(-MAX_ENTRIES);
    const temp = `${path}.tmp-${randomUUID()}`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, JSON.stringify({ runs }, null, 2), "utf8");
      await rename(temp, path);
    } catch (error) {
      return failure("runlog/unavailable", `cannot write the run-log carrier: ${String(error?.message ?? error)}`);
    }
    return success({ recorded: record, size: runs.length });
  });
}

/**
 * 读最近的运行记录（诊断用）。
 *
 * `limit` 取最近 N 条；`latest` 为 true 时只回最后一条（便于「刚才那次跑到哪了」）。
 */
export async function readRuns(dshHomePath, { limit, latest = false } = {}) {
  try {
    return await readRunsInner(dshHomePath, { limit, latest });
  } catch (error) {
    return failure("runlog/unavailable", `run-log read threw: ${String(error?.message ?? error)}`);
  }
}

async function readRunsInner(dshHomePath, { limit, latest = false } = {}) {
  const doc = await readAll(dshHomePath);
  if (!doc.ok) return doc;
  const runs = doc.value.runs;
  if (latest) return success({ total: runs.length, run: runs.length > 0 ? runs[runs.length - 1] : null });
  const n = Number.isInteger(limit) && limit > 0 ? limit : runs.length;
  return success({ total: runs.length, runs: runs.slice(-n) });
}

export { RUNLOG_RELATIVE_PATH, MAX_ENTRIES };
