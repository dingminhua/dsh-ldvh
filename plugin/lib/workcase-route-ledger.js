/**
 * dsh-ldvh — 21 §6.3 路由询问的持久载体（**询问结果的可回读记录**）。
 *
 * ## 为什么需要它
 *
 * `requestWorkcaseRouting` 拿到 Human 的答复后，答复只在内存里被 create 消费一次，
 * 不留任何载体。由此产生两个实测到的失效（2026-10-17）：
 *
 *   1. **重试必重问**：预检通过、人已答「建工单」，随后写入因 CAS 或宿主目标冲突
 *      失败时，重试 create 无处可读答复，只能**再问一次**。同一件事问两遍，而
 *      21 §6.3 的提问是分诊提问——重复提问本身就在消耗 Human 的注意力预算。
 *
 *   2. **事实不可回读**：宿主 §6.3 提问走 `ctx.userQuestions.ask` 的 waterfall，
 *      **不进入会话事件流**。故事后无法从任何权威记录回答「问过没有、答了什么」。
 *      实测：主控因事件流里看不到提问记录，误判「询问未发生」，又在工具之外用
 *      `ask_user_question` 补问了一次——这正是本载体要消灭的误判面。
 *
 * ## 它记录什么、不记录什么
 *
 * 记录：候选内容指纹（与该 candidate_fingerprint 同源）、Human 的选择、时刻、
 * 以及提问所用的 `request` 原话（便于 Human 事后认出「当时问的是哪件事」）。
 *
 * **不记录**：不记录 AI 的倾向理由（`rationale` 从不呈报，也不入载体）。
 *
 * ## 它不是事实、不是授权凭据
 *
 * 与水位、待处置队列、运行痕迹同属**辅助机制的运行状态**：位于 DSH home 之下，
 * **不进入事实源**，不构成事实对象，不走 02 号受控写入。
 *
 * **它不是授权**：本载体只回答「这件事问过没有、答了什么」，**不构成** 21 §14 C1
 * 所要求的授权凭据，也不替代 Gate 1 批准。它的价值在于**让重复提问不再发生**，
 * 以及让「问过没有」可回读——而不是让 `create` 免于 Human 决定。
 *
 * ## fail-closed 的方向
 *
 * 载体不可读或不可写时**不得**降级为「未问过」（那会导致重复提问），也**不得**
 * 降级为「已获授权」（那会免去 Human 决定）。两侧都是错的，故一律返回 failure，
 * 由调用方如实报告并停止本次 create（00 §5.7）。
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

/** DSH home 下的相对位置（与水位、待处置队列、运行痕迹同层）。 */
const LEDGER_RELATIVE_PATH = ["ldvh", "workcase-route-decisions.json"];

/**
 * 保留的答复条数上限（环形，保留最近 N 条）。
 *
 * 取 50 与 idle-runlog 同量级：询问是低频事件（每次建单一次），50 条足以覆盖
 * 近期重试窗口，文件大小有硬上界。**改这个值不影响正确性**——它只是历史窗口
 * 的宽窄。
 */
const MAX_ENTRIES = 50;

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function success(value) {
  return { ok: true, value };
}

/** 解析载体路径；形态不符返回 null（调用方转成 failure，不抛）。 */
function ledgerPath(dshHomePath) {
  if (typeof dshHomePath !== "function") return null;
  try {
    const resolved = dshHomePath(...LEDGER_RELATIVE_PATH);
    return typeof resolved === "string" && resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * 读全部已记录的答复。
 *
 * 载体不存在（ENOENT）是**合法初始态**：尚未问过任何事。
 */
async function readAll(dshHomePath) {
  const path = ledgerPath(dshHomePath);
  if (path === null) {
    return failure("route-ledger/unavailable", "dshHomePath is not a callable home resolver (cannot locate the route-decision carrier)");
  }
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return success({ decisions: [] });
    return failure("route-ledger/unreadable", `cannot read the route-decision carrier: ${String(error?.message ?? error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // 载体损坏**不按空处理**：把「读不出来」当成「没问过」会导致重复提问，
    // 那正是本模块要消灭的形态。
    return failure("route-ledger/malformed", `the route-decision carrier is not valid JSON: ${String(error?.message ?? error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return failure("route-ledger/malformed", "the route-decision carrier is not a JSON object");
  }
  if (!Array.isArray(parsed.decisions)) {
    return failure("route-ledger/malformed", "the route-decision carrier carries no `decisions` array");
  }
  return success(parsed);
}

/**
 * 按候选内容指纹查既有答复。
 *
 * 返回 `{ ok, value: entry | null }`：
 *   - `value` 为对象即「这件事问过，且这是当时的答复」——调用方应**直接复用**，
 *     不得再次提问；
 *   - `value` 为 null 即「从未问过」——调用方才提请。
 *
 * **只读**：不修改载体。读失败返回 failure（不得当成 null）。
 */
export async function findRouteDecision(dshHomePath, candidateFingerprint) {
  if (typeof candidateFingerprint !== "string" || candidateFingerprint.length === 0) {
    return failure("route-ledger/invalid_key", "candidateFingerprint is required to look up a routing decision");
  }
  const doc = await readAll(dshHomePath);
  if (!doc.ok) return doc;
  // 取**最后一条**同指纹记录：同一候选若被问过多次（历史上已经发生过的形态），
  // 以最近一次答复为准——那才是 Human 最新的意思。
  let found = null;
  for (const entry of doc.value.decisions) {
    if (typeof entry !== "object" || entry === null) continue;
    if (entry.candidate_fingerprint === candidateFingerprint) found = entry;
  }
  return success(found);
}

/** 同一载体的写串行化（同 idle-runlog 的纪律：读-改-写不得交错）。 */
const ledgerQueues = new Map();

function serialize(key, task) {
  const previous = ledgerQueues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => {});
  ledgerQueues.set(key, tail);
  tail.then(() => {
    if (ledgerQueues.get(key) === tail) ledgerQueues.delete(key);
  });
  return run;
}

/**
 * 记录一条答复。
 *
 * `entry` 形状：
 *   - `candidate_fingerprint`（必填）：候选内容指纹（与 create 的候选指纹同源）；
 *   - `answer`（必填）：Human 选中的标签（闭集由 host-seams 的常量定义）；
 *   - `routed_to`（必填）：`"workcase"` | `"direct"`；
 *   - `request`（可选）：Human 原话，逐字保留，供事后认出「当时问的是哪件事」；
 *   - `at`（可选）：缺省取当前时刻。
 *
 * **只有已确定的答复才允许入载体**：`answer` 为空或 `routed_to` 不在闭集时报
 * failure。空答复（`selected: []`）是「未决策」，不是「答了」——把它写成记录会
 * 让下一次 create 误以为问过了而直接复用一个不存在的决定。
 */
export async function recordRouteDecision(dshHomePath, entry = {}) {
  try {
    return await recordRouteDecisionInner(dshHomePath, entry);
  } catch (error) {
    return failure("route-ledger/unavailable", `route-decision recording threw: ${String(error?.message ?? error)}`);
  }
}

async function recordRouteDecisionInner(dshHomePath, entry) {
  const fingerprint = entry?.candidate_fingerprint;
  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    return failure("route-ledger/invalid_entry", "candidate_fingerprint is required to record a routing decision");
  }
  const answer = entry?.answer;
  if (typeof answer !== "string" || answer.length === 0) {
    return failure("route-ledger/invalid_entry", "answer must be the non-empty label the Human selected — an empty answer is 'not decided', not a decision");
  }
  const routedTo = entry?.routed_to;
  if (routedTo !== "workcase" && routedTo !== "direct") {
    return failure("route-ledger/invalid_entry", `routed_to must be "workcase" or "direct", got ${JSON.stringify(routedTo ?? null)}`);
  }
  const path = ledgerPath(dshHomePath);
  if (path === null) {
    return failure("route-ledger/unavailable", "dshHomePath is not a callable home resolver (cannot locate the route-decision carrier)");
  }
  const at = typeof entry.at === "string" && entry.at.length > 0 ? entry.at : new Date().toISOString();
  const record = { candidate_fingerprint: fingerprint, answer, routed_to: routedTo, at };
  // 原话逐字保留（它是 Human 的，不是 AI 的），但截断到 500 字符避免单条撑大载体：
  // 超出部分对「认出问的是哪件事」已无增益，完整原话仍在该次会话记录里。
  if (typeof entry.request === "string" && entry.request.trim().length > 0) {
    const text = entry.request.trim();
    record.request = text.length > 500 ? `${text.slice(0, 500)}…` : text;
  }

  await mkdir(dirname(path), { recursive: true });
  return serialize(path, async () => {
    const doc = await readAll(dshHomePath);
    if (!doc.ok) return doc;
    const decisions = [...doc.value.decisions, record].slice(-MAX_ENTRIES);
    const tmp = join(dirname(path), `.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
    await writeFile(tmp, `${JSON.stringify({ decisions }, null, 2)}\n`, "utf8");
    await rename(tmp, path);
    return success(record);
  });
}
