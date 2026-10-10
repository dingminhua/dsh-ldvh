/**
 * dsh-ldvh — 摩擦发现的观察水位 (specs/04 §8.4「观察范围的切分（水位）」).
 *
 * 权威：specs/04 §8.4。该段要求「第 1 项的观察对象是**自上次运行以来新增的会话
 * 内容**」，并定下四条纪律，本模块逐条落地：
 *
 *   1. **切分依据只能是宿主会话记录中的位置**——不得以「AI 认为哪些是新的」为
 *      依据。本模块用**会话内的轮次号（turn）**作位置标识：它是宿主在 `session/
 *      event` 的 `turn/end` 载荷里发布的既有字段（`triggers.js` 已在用它记账），
 *      不是本插件自造的判据。
 *   2. **成功才推进**——仅当该次运行成功完成（含闭集第 5 项精确回读）时，水位
 *      推进到本次处理区间的终点。
 *   3. **失败不推进**——派生失败、判断失败、回读不符或 §8.3 fail-closed 停止时，
 *      水位保持不动，使下次运行重新覆盖同一区间（避免遗漏）。
 *   4. **重复覆盖不重复计数**——第 2 项的递增以本次运行区间为界；重覆盖同一区间
 *      时，那些观察已属「上一次已处理」的区间，不再计入。
 *
 * ## 为什么不用 `session.snapshotEvents()`
 *
 * 宿主 `@deepseek-ai/dsh-agent` 的会话读取方法（`snapshotEvents()` / `ownEvents()`
 * / `eventAt()`）**均已弃用**，其 README.zh.md 明文写「现有逻辑可以暂不迁移，但
 * **禁止新增生产调用**」（本仓 `plugin/lib/child.js` 已就此记过一次教训：首版修复
 * 曾改用 `snapshotEvents()`，被独立复核指出违反该禁令）。故本模块**只消费已发布
 * 的事件**（`turn/end` 载荷里的 `turn`），不触碰任何弃用读取入口。
 *
 * ## 水位是运行状态，不是事实
 *
 * §8.4 明文：水位**不进入 Friction 账目**（26 §19 第 1 项：不设无消费方装饰字段），
 * 不构成事实对象，也不适用 02 号的事实类型契约与受控写入流程。故本模块把水位存在
 * **DSH home 下的宿主侧运行载体**（与 §8.3 待处置队列同一性质），键为「受管辖项目
 * 根 + 会话 id」，值为上一次成功处理到的轮次号。
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** DSH home 下的相对位置（与 governed-projects / pending-queue 同层）。 */
const WATERMARK_RELATIVE_PATH = ["ldvh", "friction-discovery-watermarks.json"];

function watermarkPath(dshHomePath) {
  return dshHomePath(...WATERMARK_RELATIVE_PATH);
}

function success(value) {
  return { ok: true, value };
}

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/** 水位键：受管辖项目根 + 会话 id。跨项目、跨会话各自独立。 */
function watermarkKey(projectRoot, sessionId) {
  return `${projectRoot}::${sessionId}`;
}

async function readAll(dshHomePath) {
  const path = watermarkPath(dshHomePath);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return failure("watermark/carrier_malformed", "the watermark carrier is not a JSON object");
    }
    return success(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return success({}); // 首次运行：空水位是合法初始态
    return failure("watermark/unreadable", `cannot read the watermark carrier: ${String(error?.message ?? error)}`);
  }
}

async function writeAll(dshHomePath, doc) {
  const path = watermarkPath(dshHomePath);
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, JSON.stringify(doc, null, 2), "utf8");
    await rename(temp, path);
  } catch (error) {
    return failure("watermark/unavailable", `cannot write the watermark carrier: ${String(error?.message ?? error)}`);
  }
  return success({ path });
}

/**
 * 读当前水位（§8.4「边界」：本次运行的区间起点 = 上一次成功运行处理到的位置）。
 *
 * 返回 `{ ok: true, value: { lastTurn } }`；从未成功运行过时 `lastTurn` 为
 * `null`——**这不是失败**，而是「本次区间是全部已有内容」（首次运行本就该覆盖
 * 既有内容，否则机制永远不会发现历史上的反复阻碍）。
 */
export async function readWatermark(dshHomePath, { projectRoot, sessionId } = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return failure("watermark/invalid_project_root", "projectRoot is required");
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return failure("watermark/invalid_session_id", "sessionId is required");
  }
  const doc = await readAll(dshHomePath);
  if (!doc.ok) return doc;
  const entry = doc.value[watermarkKey(projectRoot, sessionId)];
  const lastTurn = entry?.lastTurn;
  return success({
    lastTurn: Number.isInteger(lastTurn) ? lastTurn : null,
    key: watermarkKey(projectRoot, sessionId),
    carrier: entry === undefined ? "absent" : "present",
  });
}

/**
 * 推进水位（§8.4「推进与不推进」：**仅当该次运行成功完成时**）。
 *
 * 调用方只应在「闭集第 5 项精确回读通过」之后调用本函数。失败路径**不调用**
 * ——那是「不推进」的机械形态：没有推进调用，水位就不可能前进。
 *
 * 单调性：新水位**不得低于**既有水位。若传入更小的值（例如宿主轮次号回绕或
 * 传参错误），拒绝而非静默倒退——倒退会让已处理区间被再次计入，正是 §8.4 要
 * 消除的失效面。
 */
export async function advanceWatermark(dshHomePath, { projectRoot, sessionId, turn } = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return failure("watermark/invalid_project_root", "projectRoot is required");
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return failure("watermark/invalid_session_id", "sessionId is required");
  }
  if (!Number.isInteger(turn) || turn < 0) {
    return failure("watermark/invalid_turn", `turn must be a non-negative integer (got ${JSON.stringify(turn)})`);
  }

  const doc = await readAll(dshHomePath);
  if (!doc.ok) return doc;
  const key = watermarkKey(projectRoot, sessionId);
  const existing = doc.value[key]?.lastTurn;
  if (Number.isInteger(existing) && turn < existing) {
    return failure(
      "watermark/non_monotonic",
      `refusing to move the watermark backwards: existing lastTurn=${existing}, requested ${turn} (§8.4 水位段：倒退会使已处理区间被重复计入)`,
    );
  }

  const next = { ...doc.value, [key]: { lastTurn: turn, advancedAt: new Date().toISOString() } };
  const written = await writeAll(dshHomePath, next);
  if (!written.ok) return written;

  // 精确回读（§8.4 第 5 项同源纪律：写入后须回读核对）。
  const readBack = await readWatermark(dshHomePath, { projectRoot, sessionId });
  if (!readBack.ok) {
    return failure("watermark/read_back_failed", `advance reported success but the read-back failed: ${readBack.error.message}`);
  }
  if (readBack.value.lastTurn !== turn) {
    return failure("watermark/read_back_mismatch", `expected lastTurn=${turn} after advance, got ${readBack.value.lastTurn}`);
  }
  return success({ key, lastTurn: turn });
}

/**
 * 本次运行的观察区间（§8.4 水位段：自上次成功运行以来新增的内容）。
 *
 * `from` 为 `null` 表示「首次运行，覆盖全部既有内容」；`to` 为本次检查点所在的
 * 轮次。两者都只是**位置标识**，不是「AI 认为哪些是新的」的判断结果。
 */
export function describeWindow(watermark, currentTurn) {
  return {
    from: watermark?.lastTurn ?? null,
    to: Number.isInteger(currentTurn) ? currentTurn : null,
  };
}

export { WATERMARK_RELATIVE_PATH };
