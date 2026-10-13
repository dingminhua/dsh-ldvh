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
 * 根 + 会话 id」，其下**按任务分别**记录各自「上一次成功处理到的轮次号」。
 *
 * ## 为什么水位必须按任务分别（2026-10-14）
 *
 * 本模块原先只有**一条**水位，被全部闲时任务共用。该形态在只有单任务时工作正常，
 * 但它使「一件成功、一件失败」必然导致**重复落地**：§11 要求任一任务失败即不推进，
 * 于是下一轮重覆盖同一区间——而**成功那件的写入已经发生**，重覆盖会把它再落地
 * 一次（`occurrence.count` 被虚增，而它是阈值流转的唯一输入源，会把不该转 `open`
 * 的账目推过阈值 N）。该缺陷由 `friction-discovery-provider.js` 登记为「首个多任务
 * 落地时必须一并解决」的残留风险；本模块的改造即其解决。
 *
 * 分工（与派发状态的关系不变）：
 *   - **水位**：按任务分别——各任务各自记录「本任务成功处理到哪」，互不牵连；
 *   - **派发状态**（`lastDispatchAt`/`dispatchCount`/`dispatchTimes`）：**仍按会话共用**
 *     ——节流度量的是「这次派发」的整体代价（一个子代理一次跑完 N 件事，上下文只
 *     解压一次），故它本就是派发级的量，不随任务数分家。二者同处一个载体、两轴各走。
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 存量单条水位的归属任务。
 *
 * 该常量**不是**「默认任务」——它只用于把**改造之前**写下的旧形态水位解释为
 * 某个任务的水位。改造前只有摩擦发现这一个任务已实现并写过水位，故存量的
 * `lastTurn` 只可能是它写的；这是唯一自洽的读法。
 */
const LEGACY_WATERMARK_OWNER = "friction-discovery";

/**
 * 任务**改名**映射：现行键 → 它曾用过的键（读时回落用）。
 *
 * 摩擦发现原名 `idle-review`，后改为 `friction-discovery`（名实相符：它做的是
 * 摩擦发现，不是泛指的「空闲评审」——后者在本仓规范里**从未有过定义**）。
 * 改名必须同时迁移**已落盘的数据**，否则后果是静默的数据损坏而非报错：
 *
 * `tasks: { "idle-review": { lastTurn: N } }` 在改名后按新键读**读不到** → 返回
 * `null` → 被判为「首次运行」→ **整个区间被重新覆盖** → 重复计数（而 `count`
 * 是阈值流转的唯一输入源）。真实载体里**已经存在**这样一条记录（改名前的 P1
 * 改造所写），故该回落不是预防性的，而是必需的。
 *
 * **写时只用现行键**，不写旧键——旧键仅作读时回落，使回落面随时间自然消失。
 */
const TASK_RENAMES = Object.freeze({ "friction-discovery": "idle-review" });

/**
 * 取某任务的**现行键**与它可能用过的**旧键**。
 *
 * @returns {{current: string, former: string|null}}
 */
function taskAliases(task) {
  return { current: task, former: TASK_RENAMES[task] ?? null };
}

/** DSH home 下的相对位置（与 governed-projects / pending-queue 同层）。 */
const WATERMARK_RELATIVE_PATH = ["ldvh", "friction-discovery-watermarks.json"];

/**
 * 按 key 串行化（缺陷 D3 的修复；形制借鉴参考实现 `dsh-agent-teams` 的
 * `withTeamLock`（`src/state.ts:63`）与 `serializeMember`（`scheduler.ts:273`））。
 *
 * **为什么必须有**：读-改-写不是原子的。两个检查点重叠时（会话重启、快速连续
 * 回合、或同会话多个 driver），两个 `advanceWatermark` 会各自读到同一份旧文档、
 * 各自写回——后写的覆盖先写的。已实测复现：并发推进 turn 5 与 turn 9 时，较小的
 * 那次触发 `watermark/read_back_mismatch`（读回值与期望不符），即**两个检查点
 * 重叠时水位推进不可靠**，且该失败会按 §8.3 入队产生误报。
 *
 * 以「载体路径」为键：同一载体的读-改-写整体排队，不同载体互不阻塞。
 */
const watermarkQueues = new Map();

/**
 * 派发时刻列表的**保留上限**（有界，见 recordDispatch 的说明）。
 *
 * ## 为什么是推导出来的，而不是写死一个数（2026-10-11 复审 D8）
 *
 * 原先写死 64，理由是「按 10 分钟间隔，1 小时窗口内最多 6 次」。那个理由**依赖
 * 最小间隔的取值**——若间隔被设为 1 秒，1 小时窗口内可发生 3600 次，列表截断会
 * 使窗口内计数被**低估**，配额因而偏松（方向上不会造成永久终止，故属建议级）。
 *
 * 故此处按**配额窗口与最小间隔的比值**推导：截断位置必须容纳窗口内一切可能的
 * 派发次数。取不到这两个配置时回落到一个保守下限。
 *
 * **上限的意义**：它是运行状态的体量上界（04 §14 第 5 条禁止无界账本）。推导
 * 只在两者都有界时给出有限值；若调用方给出荒谬的小间隔（如 0），
 * `numberOfWindowSlots` 会给 0 并回落到 `FALLBACK_MAX_DISPATCH_TIMES`。
 */
export const FALLBACK_MAX_DISPATCH_TIMES = 64;

/**
 * 按「配额窗口 ÷ 最小间隔」推导窗口内可能的最大派发次数（即时刻列表的容量下界）。
 *
 * @param {{quotaWindowMs?: number, minIntervalMs?: number}} limits - 当前配置。
 * @returns {number} 容量下界；配置无效时返回 0（调用方据此回落）。
 */
export function numberOfWindowSlots(limits) {
  const windowMs = Number(limits?.quotaWindowMs);
  const intervalMs = Number(limits?.minIntervalMs);
  if (!Number.isFinite(windowMs) || windowMs <= 0) return 0;
  // 间隔为 0 表示「不冷却」——此时窗口内次数无上界，故容量不可推导。
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  // +2 吸收边界：窗口两端各可能多计一次（`countWithinWindow` 用闭区间）。
  return Math.ceil(windowMs / intervalMs) + 2;
}

function serialize(key, operation) {
  const previous = watermarkQueues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  watermarkQueues.set(key, tail);
  return previous
    .then(operation)
    .finally(() => {
      release();
      // 后继若已占位则保留其槽位（同参考实现的清理纪律）。
      if (watermarkQueues.get(key) === tail) watermarkQueues.delete(key);
    });
}

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

/**
 * 校验任务键。**必须显式给出**——没有「默认任务」这一说。
 *
 * 为什么不留默认值：水位的**全部意义**是「这个任务成功处理到哪」。若允许省略，
 * 调用方漏传时会静默退回某个默认任务的水位，于是**两个任务读写同一条水位**——
 * 正是本次改造要消除的失效面，且它会以「看上去工作正常」的形态存在。故缺参即
 * 失败（fail-closed），迫使调用方明确自己代表哪个任务。
 */
function resolveTaskKey(task) {
  if (typeof task !== "string" || task.length === 0) {
    return failure(
      "watermark/invalid_task",
      "task is required: each auxiliary task keeps its own watermark (a missing task would silently share another task's watermark)",
    );
  }
  return success(task);
}

/**
 * 从一条会话记录项里取**某任务**的水位；兼容旧形态。
 *
 * 载体形态演进（向后兼容是硬要求——既有安装的水位不能让它在升级后失效，
 * 那会使「已处理区间」被重新覆盖而重复计数）：
 *   - **旧**：`{ lastTurn, lastDispatchAt, dispatchCount, dispatchTimes }`——单条水位，
 *     全部任务共用。存量记录一律归属**首个任务**（`friction-discovery`），因为
 *     在本次改造之前**只有它已实现**、只有它写过水位（`capacity-maintenance` 与
 *     `memory-health` 均未实现，从不写水位）。该归属是**唯一自洽的读法**。
 *   - **新**：`{ tasks: { [task]: { lastTurn, advancedAt } }, lastDispatchAt, ... }`
 *     ——水位按任务分开，派发状态仍按会话共用（后者本就是派发级的量）。
 *
 * 新旧共存时**以新形态为准**（`tasks` 存在即按它读）；旧字段保留不删，使回落
 * 到旧版本代码时仍有可读值。读函数**不写回**（读路径不改载体，避免读操作产生
 * 副作用）。
 */
function taskWatermark(entry, task) {
  if (entry === undefined || entry === null) return null;
  const { current, former } = taskAliases(task);
  const perTask = entry.tasks;
  if (perTask !== undefined && perTask !== null && typeof perTask === "object" && !Array.isArray(perTask)) {
    // 先按现行键读；读不到时回落**改名前的键**（见 TASK_RENAMES 的说明：不回落
    // 会使既有水位被判为「首次运行」，整个区间被重覆盖而重复计数）。
    for (const key of former === null ? [current] : [current, former]) {
      const own = perTask[key];
      if (Number.isInteger(own?.lastTurn)) return own.lastTurn;
    }
    return null;
  }
  // 最早形态：单条水位归摩擦发现（那时只有它写过）。
  if (task === LEGACY_WATERMARK_OWNER && Number.isInteger(entry.lastTurn)) return entry.lastTurn;
  return null;
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
export async function readWatermark(dshHomePath, { projectRoot, sessionId, task } = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return failure("watermark/invalid_project_root", "projectRoot is required");
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return failure("watermark/invalid_session_id", "sessionId is required");
  }
  const resolved = resolveTaskKey(task);
  if (!resolved.ok) return resolved;
  const doc = await readAll(dshHomePath);
  if (!doc.ok) return doc;
  const key = watermarkKey(projectRoot, sessionId);
  const entry = doc.value[key];
  const lastTurn = taskWatermark(entry, resolved.value);
  return success({
    lastTurn: Number.isInteger(lastTurn) ? lastTurn : null,
    // 缺失（含从未运行过、以及新任务首次运行）一律为 null——那是「首次运行，
    // 本次区间覆盖全部既有内容」的合法初始态，不是失败（§11 水位为空时不受
    // 内容量约束）。
    key,
    task: resolved.value,
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
export async function advanceWatermark(dshHomePath, { projectRoot, sessionId, task, turn } = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return failure("watermark/invalid_project_root", "projectRoot is required");
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return failure("watermark/invalid_session_id", "sessionId is required");
  }
  const resolved = resolveTaskKey(task);
  if (!resolved.ok) return resolved;
  if (!Number.isInteger(turn) || turn < 0) {
    return failure("watermark/invalid_turn", `turn must be a non-negative integer (got ${JSON.stringify(turn)})`);
  }

  // D3：读-改-写整体串行化——并发的两个检查点各自读到同一份旧文档时，后写者
  // 会覆盖先写者，且较小的那次会因读回不符而误报失败（已实测复现）。
  return serialize(watermarkPath(dshHomePath), async () => {
    const doc = await readAll(dshHomePath);
    if (!doc.ok) return doc;
    const key = watermarkKey(projectRoot, sessionId);
    const existing = taskWatermark(doc.value[key], resolved.value);
    if (Number.isInteger(existing) && turn < existing) {
      return failure(
        "watermark/non_monotonic",
        `refusing to move the watermark backwards: task=${resolved.value} existing lastTurn=${existing}, requested ${turn} (§8.4 水位段：倒退会使已处理区间被重复计入)`,
      );
    }

    // **合并**而非重建该项：同一 key 下还住着**派发状态**（lastDispatchAt /
    // dispatchCount，见 readDispatchState）。重建会把它们悄悄清掉——实测踩过：
    // 先 recordDispatch 两次、再 advanceWatermark 一次，派发计数即被抹回 0/0，
    // 冷却与配额随即失效。水位与派发状态是**两轴**，同处一个载体就不得互相覆盖。
    const prior = doc.value[key] ?? {};
    const next = {
      ...doc.value,
      [key]: {
        ...prior,
        // **按任务写入，不动其它任务的水位**：这正是本改造的目的——任务 A 成功
        // 推进自己的水位，不因任务 B 失败而后退或被重覆盖。
        tasks: { ...(prior.tasks ?? {}), [resolved.value]: { lastTurn: turn, advancedAt: new Date().toISOString() } },
      },
    };
    const written = await writeAll(dshHomePath, next);
    if (!written.ok) return written;

    // 精确回读（§8.4 第 5 项同源纪律：写入后须回读核对）。仍在同一临界区内，
    // 故读回的必是本临界区写入的值。
    const readBack = await readAll(dshHomePath);
    if (!readBack.ok) {
      return failure("watermark/read_back_failed", `advance reported success but the read-back failed: ${readBack.error.message}`);
    }
    const observed = taskWatermark(readBack.value[key], resolved.value);
    if (observed !== turn) {
      return failure("watermark/read_back_mismatch", `expected lastTurn=${turn} for task=${resolved.value} after advance, got ${observed}`);
    }
    return success({ key, task: resolved.value, lastTurn: turn });
  });
}

/**
 * 读**派发状态**（闲时辅助的节流锚点与配额计数），与水位**共用同一个载体**。
 *
 * ## 为什么不新建一个文件（specs/04 §14 第 5 条）
 *
 * 该条禁止「为证明检查已执行而保存完整消息、思考链、运行日志或**第二状态账本**」。
 * 节流需要的两个量（上次派发时刻、本会话已派发次数）与水位同属「辅助机制的运行
 * 状态」，且**同一个键**（受管辖项目根 + 会话 id）刚好就是它们各自要的作用域
 * ——水位按会话独立，配额也按会话独立。故并入既有载体，而不是新起一个文件。
 *
 * ## 与水位的关系：**两轴，不混谈**
 *
 * - **水位**（`lastTurn`）：管「内容看到哪儿了」。它**只在该次运行成功后**推进。
 * - **派发状态**（`lastDispatchAt` / `dispatchCount`）：管「跑了多少次、隔了多久」。
 *   它在**派发之前**写入，故**失败也计入**——若等结果再写，一次失败就不占冷却
 *   窗口，下一次检查点立刻重跑，外观上正是 §8.3 禁止的「自行重试」。
 *
 * 两者因此可以在同一对象里各走各的，不构成一致性问题：`lastTurn` 落后于
 * `dispatchCount` 是**正常态**（派发了但落地失败，下次重覆盖同一区间）。
 *
 * 从未派发过时 `lastDispatchAt` 为 `null`、`dispatchCount` 为 `0`——那使首次运行
 * 不冷却、配额从零起算。
 */
export async function readDispatchState(dshHomePath, { projectRoot, sessionId } = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return failure("watermark/invalid_project_root", "projectRoot is required");
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return failure("watermark/invalid_session_id", "sessionId is required");
  }
  const doc = await readAll(dshHomePath);
  if (!doc.ok) return doc;
  const entry = doc.value[watermarkKey(projectRoot, sessionId)];
  const at = entry?.lastDispatchAt;
  const count = entry?.dispatchCount;
  // `dispatchTimes` 是**配额按滑动窗口计**所需的输入（2026-10-11 独立审核 F2）。
  // 原先只存累计计数，配额因而只能按会话生命周期计——那会耗尽即永久停。
  // 保留 `dispatchCount` 作兼容与诊断（它是**无界累计**，不等于窗口内次数）。
  const times = Array.isArray(entry?.dispatchTimes)
    ? entry.dispatchTimes.filter((v) => typeof v === "string" && v.length > 0)
    : [];
  return success({
    lastDispatchAt: typeof at === "string" && at.length > 0 ? at : null,
    dispatchCount: Number.isInteger(count) && count >= 0 ? count : 0,
    dispatchTimes: times,
  });
}

/**
 * 记一次派发（**在派发之前**调用；失败也计入，见 readDispatchState 的说明）。
 *
 * 与 `advanceWatermark` **共用同一临界区**（同一个载体路径作键的 `serialize`），
 * 故并发调用不会互相覆盖：两者都是「读整份文档 → 改自己那一项 → 写回」。
 *
 * 返回 `{ ok: true, value: { lastDispatchAt, dispatchCount } }`（写入后的值）。
 */
export async function recordDispatch(dshHomePath, { projectRoot, sessionId, at, limits } = {}) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return failure("watermark/invalid_project_root", "projectRoot is required");
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return failure("watermark/invalid_session_id", "sessionId is required");
  }
  const stamp = typeof at === "string" && at.length > 0 ? at : new Date().toISOString();

  return serialize(watermarkPath(dshHomePath), async () => {
    const doc = await readAll(dshHomePath);
    if (!doc.ok) return doc;
    const key = watermarkKey(projectRoot, sessionId);
    const entry = doc.value[key] ?? {};
    const prevCount = Number.isInteger(entry.dispatchCount) && entry.dispatchCount >= 0 ? entry.dispatchCount : 0;
    const nextCount = prevCount + 1;
    // 时刻列表**有界**（容量按下面推导）。它是运行状态、不是账目，
    // 按 04 §14 第 5 条不得无界增长；而配额窗口是有限的，故旧于窗口的时刻无消费方。
    const prevTimes = Array.isArray(entry.dispatchTimes)
      ? entry.dispatchTimes.filter((v) => typeof v === "string" && v.length > 0)
      : [];
    // 容量按调用方给的配置推导（D8）；未给则回落保守下限。
    const derived = numberOfWindowSlots(limits);
    const capacity = Math.max(FALLBACK_MAX_DISPATCH_TIMES, derived);
    const nextTimes = [...prevTimes, stamp].slice(-capacity);
    const next = { ...doc.value, [key]: { ...entry, lastDispatchAt: stamp, dispatchCount: nextCount, dispatchTimes: nextTimes } };
    const written = await writeAll(dshHomePath, next);
    if (!written.ok) return written;

    // 写后回读（与 advanceWatermark 同一纪律）：读回不符即失败，不静默。
    const readBack = await readAll(dshHomePath);
    if (!readBack.ok) {
      return failure("watermark/read_back_failed", `recordDispatch reported success but the read-back failed: ${readBack.error.message}`);
    }
    const observed = readBack.value[key];
    if (observed?.lastDispatchAt !== stamp || observed?.dispatchCount !== nextCount
      || !Array.isArray(observed?.dispatchTimes) || observed.dispatchTimes.length !== nextTimes.length) {
      return failure(
        "watermark/read_back_mismatch",
        `expected lastDispatchAt=${stamp} dispatchCount=${nextCount} dispatchTimes=${nextTimes.length} after recordDispatch, got lastDispatchAt=${observed?.lastDispatchAt} dispatchCount=${observed?.dispatchCount} dispatchTimes=${Array.isArray(observed?.dispatchTimes) ? observed.dispatchTimes.length : "absent"}`,
      );
    }
    return success({ lastDispatchAt: stamp, dispatchCount: nextCount, dispatchTimes: nextTimes });
  });
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
