/**
 * dsh-ldvh — 空闲辅助任务的调度与 fail-closed 编排.
 *
 * 权威：specs/11 §9（摩擦发现的触发、执行体、闭集与上限）与 §8.3（fail-closed
 * 与待处置队列）；specs/32 §10.2（三任务共用触发点、**不设轮换**——一次派发做全部
 * 已启用任务）。
 *
 * 本模块是**编排层**，只做三件 Code 能确定性完成的事：
 *
 *   1. **一次派发做全部已启用任务**（32 §10.2）：本检查点取全部已启用任务，提示词
 *      一次拼接、逐任务独立收口；**不设轮换、不设派发预算**（轮换概念已于
 *      2026-10-11 删除，见下「本模块不再承担任务轮换」）。
 *   2. **调度摩擦发现**：调用闭集执行体（friction-discovery.js）。本模块**不**
 *      代替子代理做语义查重——那一步是 §8.4 明文登记的 gap，只能由派生出的
 *      LLM 子代理完成。因此本模块在无子代理结果时**不创建账目**（见下）。
 *   3. **fail-closed 与待处置登记**（§8.3）：任何一步失败即停止该次任务，把停止
 *      原因与残留范围**追加**进待处置队列，**不重试、不部分完成、不静默**。
 *
 * **为什么本模块不自己「发现摩擦」**：§8.4 的执行体是「宿主派生一个受管辖隔离
 * 子代理」（以零上下文派生、判断输入由调度侧机械交付——11 §7.1「执行体与上下文供给」
 * 供给」段，Human 决定 2026-10-12）。该判断
 * 是语义判断（§8.2 第 1 条后半句明文不由机械校验保障）。Code 无法替代它，也不
 * 得伪造一个「机械查重」冒充它。故本模块的角色是：**为子代理准备好机械前提
 * （阈值可用、账本可读、队列可写），并把子代理的判断结果机械落地**。
 *
 * 本模块**不主张机制已运行**（§8.5）：它是否具备属实现现状，由读取时的观察取得。
 */

import { appendPendingEntry } from "./pending-queue.js";
// advanceWatermark 于本次改动前就已是未使用的导入（它在 `git show HEAD` 里也只
// 出现在这一行）——水位推进由调用方（lifecycle）在落地成功后执行，本模块已不自行
// 推进（见下方「水位推进必须以落地成功为前提」的说明）。故一并删除。
import { readWatermark, describeWindow } from "./friction-watermark.js";
import { splitRunnableTasks } from "./aux-task-registry.js";
import {
  verifyThresholdAvailable,
  loadDedupCandidates,
  loadObservationDedupCandidates,
  loadCrossTypeDedupCandidates,
  FRICTION_THRESHOLD_N,
} from "./friction-discovery.js";

/**
 * 辅助任务标识（§8.3 第 2 条 `task` 字段的取值）。
 *
 * **单一来源**是 `aux-task-registry.js` 的 `AUX_TASK_ORDER`——此处只做改名导出，
 * 不另定义一份清单。两份清单会漂移，而「哪些任务在册」是登记表的事实。
 */
export { AUX_TASK_ORDER as AUX_TASKS } from "./aux-task-registry.js";

// 本模块**不再**承担任务轮换：Human 于 2026-10-11 删除轮换概念（一次派发做
// 全部已启用的事，见 `idle-settings.js` 的 `pickEnabledAuxTasks`）。
//
// 原 `selectAuxTask(rotation)` 与 `HEALTH_CHECK_PERIOD = 3` 已删——它们的依据是
// `specs/32 §10.2`（候选设计）的「按预算轮换」，该条文的调度效力已随本次改案
// 移除。删除同时消除了两个既有缺陷：轮换位死锁（停用任务占住相位不放）与
// 「某任务不在任何相位上」（`capacity-maintenance` 实测 60 个相位里被选中 0 次）。

function failure(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

function success(value) {
  return { ok: true, value };
}

/**
 * 跑一次空闲检查点（§8.3 fail-closed 的唯一收口处）。
 *
 * 参数：
 *   - `dshHomePath`：待处置队列的宿主位置（§8.3 第 1 条）。
 *   - `factSourceRoot`：受管辖项目的事实源根（`<project>/ldvh-base`）。
 *   - `tasks`：本次要做的**全部**任务（有序；取自 `pickEnabledAuxTasks`）。
 *     Human 2026-10-11 改定「一次派发做多件事」，故这里是清单而非单个任务。
 *     兼容：仍接受 `task`（单个字符串）以保持既有调用方与测试不需改造。
 *   - `discover`：可选的**子代理结果提供者**——一个 async 函数，接收机械前提
 *     （阈值、候选账本），返回子代理关于「哪条候选同题 / 是否为新阻碍」的判断。
 *     **缺席时本模块不创建任何账目**：没有语义判断就没有入账依据（§8.4 第 1 项
 *     是不可跳过的前置），此时如实报告 skipped 而非假装跑过。
 *
 * 返回 `{ ok, value }` 或 `{ ok: false, error }`。**失败已入队**——调用方据此向
 * 主控/Human 声明，不得自行重试（§8.3 第 3 项）。
 */
export async function runIdleCheckpoint({
  dshHomePath,
  factSourceRoot,
  task,
  tasks,
  discover,
  now,
  // §8.4 水位段所需：本次检查点所在的会话与轮次（位置标识，取自宿主事件载荷）。
  // `sessionId` 与 `currentTurn` 缺席时水位无法界定 —— 见下方校验。
  sessionId,
  currentTurn,
  // 水位按「项目根 + 会话」分键。项目根缺省时退回 factSourceRoot（同属该项目的
  // 稳定标识），但调用方应显式给出 projectRoot 以免两处语义漂移。
  projectRoot,
  // 摩擦观察缓冲按**管辖项目 id** 分区（11 §12bis.1），与本文件的 projectRoot
  // （路径）不是同一维度：前者是登记 id，后者是文件系统路径。缺省时退回 projectRoot
  // 的 basename 是一种**兜底**，调用方应显式给出。
  projectId,
} = {}) {
  const at = typeof now === "string" ? now : new Date().toISOString();
  // 任务清单（兼容单个字符串 `task`——既有调用方与测试走这条）。
  const requested = Array.isArray(tasks) && tasks.length > 0
    ? tasks
    : (typeof task === "string" && task.length > 0 ? [task] : ["friction-discovery"]);
  const taskId = requested[0];

  // 逐任务分派**走登记表**，不再硬编码单个任务名。理由：硬编码使登记表里新增的
  // 任务在本层被静默剔除——登记为已实现却在派发时不被调用，而痕迹里看不出为什么
  // （§8.5：不得主张空闲维护已运行）。
  //
  // 逐任务分派而非只看第一个：清单里可以既有已实现的又有未实现的，此时已实现的
  // 那件必须照常跑（否则「勾了三件」会因一件没实现而整批不跑，而 Human 从痕迹
  // 里看不出为什么）。
  const { runnable: registeredRunnable, unimplemented } = splitRunnableTasks(requested);
  // 本模块实际**编排**（构造执行体并落地）的任务：见上方说明——登记为已实现、
  // 但本层尚未编排其执行体与落地路径的任务，不得算作本次已跑。
  //
  // **2026-10-30：`experience-capture` 接入**。此前它登记为已实现、也作为搭车任务
  // 被派发（`tasks: [...requested]` 全量传 provider），但 `ORCHESTRATED` 只列了
  // `friction-discovery`——于是「只开经验捕获（摩擦关）」时会被过滤成
  // `not-implemented`，而它的落地路径其实早已存在（`lifecycle.js` 的 capture 分支）。
  // 两层重构后两者同属发现层、同一个开关、同一次派发，故一并编排。
  const ORCHESTRATED = ["friction-discovery", "experience-capture"];
  const runnable = registeredRunnable.filter((key) => ORCHESTRATED.includes(key));
  const notOrchestrated = registeredRunnable.filter((key) => !ORCHESTRATED.includes(key));
  if (runnable.length === 0) {
    // 两类合并如实回报：**未实现**（能力本体没有代码）与**未编排**（在册且标为
    // 已实现，但本层尚无其执行体/落地路径）。对 Human 而言二者同义——本次没跑；
    // 分开列出是为了让人能分辨原因。
    return success({ task: taskId, tasks: [...requested], outcome: "not-implemented", unimplemented: [...unimplemented, ...notOrchestrated], at });
  }
  if (typeof factSourceRoot !== "string" || factSourceRoot.length === 0) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: "factSourceRoot is required to read the friction ledger",
      residual: [],
      at,
      code: "idle_checkpoint/no_fact_source",
    });
  }
  // §8.4 水位段：区间端点取自宿主会话记录的位置标识。两者缺席时**无法界定区间**，
  // 于是也就无法保证「只对新增内容作观察」——按 §8.4 第 6 项整任务停（fail-closed）。
  // **不得**退化为「没有位置就当作全部内容」：那会把同一段内容反复计入，正是水位
  // 段要消除的失效面。
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: "sessionId is required to key the observation watermark (11 §11 水位段) — 不得以「无位置」退化为覆盖全部内容",
      residual: ["本次未运行（缺少会话位置标识）"],
      at,
      code: "idle_checkpoint/no_session_id",
    });
  }
  if (!Number.isInteger(currentTurn)) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: "currentTurn (the turn published by the host event payload) is required to bound this run's window (11 §11 水位段)",
      residual: ["本次未运行（缺少轮次位置标识）"],
      at,
      code: "idle_checkpoint/no_current_turn",
    });
  }

  // §8.4 第 6 项：任一校验不可用即整任务停——阈值是第一道。
  const threshold = verifyThresholdAvailable();
  if (!threshold.ok) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `阈值求值校验不可用：${threshold.error.message}`,
      residual: [],
      at,
    });
  }

  // §8.4 第 1 项（读取部分）。
  const candidates = await loadDedupCandidates(factSourceRoot);
  if (!candidates.ok) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `账本不可读，查重输入不完整：${candidates.error.message}`,
      residual: [],
      at,
    });
  }
  // 读不出的账目会使查重输入不完整（§8.4 第 2 项的反向护栏：误判递增会虚增
  // count），故按 §8.3 停止而不是在残缺账本上判断。
  if (Array.isArray(candidates.value.invalid) && candidates.value.invalid.length > 0) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `账本存在不可读载体，查重输入不完整（${candidates.value.invalid.length} 条）`,
      residual: candidates.value.invalid.map((item) => `${item.file ?? item.line}: ${item.reason}`),
      at,
    });
  }

  // §9 第 1 项的第二层（2026-10 修订）：**观察缓冲也是查重输入**。
  //
  // 只查账本不足以判定归属——同一阻碍在缓冲里可能已有 1、2 条，若本次不并入那个
  // 组，它就永远攒不到 N（11 §9 第 3 项），账目永远不会成立。故必须把既有的
  // `pending` 组一并交给执行体。缓冲不可读同样不得继续——在不完整的输入上做
  // 归属判断，与在残缺账本上做查重是同一类失效。
  // `projectId` 缺省时退回 projectRoot 的 basename——这是**兜底**，不是等价语义：
  // 分区键应当来自管辖登记的 id（`governed-projects.yaml`），basename 在重命名或
  // 同名目录下会漂移。调用方（lifecycle）已显式传入，此处只防单点漏传。
  const observationProjectId = typeof projectId === "string" && projectId.length > 0
    ? projectId
    : (typeof projectRoot === "string" && projectRoot.length > 0
        ? projectRoot.split(/[\\/]/).filter(Boolean).pop()
        : null);
  if (observationProjectId === null || observationProjectId === undefined) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: "无法确定管辖项目标识，摩擦观察缓冲无法定位（11 §12bis.1 按项目分载体）：projectId 与 projectRoot 均未给出",
      residual: [],
      at,
    });
  }
  const observationInput = await loadObservationDedupCandidates(dshHomePath, observationProjectId);
  if (!observationInput.ok) {
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `观察缓冲不可读或残缺，查重输入不完整：${observationInput.error.message}`,
      residual: [],
      at,
    });
  }

  // §9 第 1 项的**第三层**（2026-10-28）：Pitfall 侧的 `active` + `draft`。
  //
  // 26 §6.2／23 §6.2 的查重锚都是「归因落点 + 机制模式」，并各自要求「跨类型同源
  // 不并入但必须互链」。执行体若只拿到 Friction 两侧，同源的 Pitfall 不在输入里，
  // `paired-with` 永远建不起来——这是输入缺层，不是执行体判错。
  //
  // **处置口径与账本/缓冲两层不同（须写明）**：账本或缓冲不可读 → 直接 fail-closed
  // （它们的残缺会污染归属判定与计数）；Pitfall 侧不可读 → **登记缺口后继续**，
  // 因为该层只影响「跨类型同源是否被发现」，不影响本次观察该不该入缓冲。若也
  // fail-closed，摩擦发现通道会因一个与本次判断无关的读失败而永久停摆
  // （2026-10-28 复核指出的正是这一形态）。缺口进 residual 与 gaps，且**不得**
  // 据此主张跨类型重复已排除（11 §9 第 1 项）。
  const crossTypeInput = await loadCrossTypeDedupCandidates(factSourceRoot);
  // **交付条数上限（2026-10-28 复核 #3：成本）**：实测 26 条 Pitfall 使提示词从
  // 4516 涨到 9667 字符（+114%），且随语料线性增长（list 上限 200 时将达 7 倍）。
  // 11 §7.1 的「有界材料交付」要求交付**有界**，故此处对第三层设独立更紧上限。
  //
  // **截断方向不是「取最新 N」（2026-10-28 终审 note 订正）**：list 的排序是
  // created_at 倒序，直接 slice(0,N) 会使**较老**的 Pitfall 系统性不可见——而跨类型
  // 同源恰恰最可能命中「早就记下、反复复现」的旧经验，那批正是最先被挤掉的。
  // 故按**稳定键**（object_uid 字典序）取样：它对 created_at 与写入顺序都无偏，
  // 语料增长时被挤掉的是随机子集而非某个时间断面，且同一语料每次取样一致
  // （不会今天看见这条、明天看不见——那会使「已查过」不可复现）。
  // **仍不静默丢弃**：超出即记入 crossTypeGap（下条），使截断可见。
  const CROSS_TYPE_DELIVERY_CAP = 40;
  const crossTypeAll = crossTypeInput.ok ? (crossTypeInput.value.items ?? []) : [];
  const crossTypeSample = [...crossTypeAll].sort((a, b) =>
    String(a.object_uid).localeCompare(String(b.object_uid)));
  const crossTypeItems = crossTypeSample.slice(0, CROSS_TYPE_DELIVERY_CAP);
  const crossTypeTruncated = crossTypeSample.length > crossTypeItems.length;
  const crossTypeGap = crossTypeInput.ok
    ? (Array.isArray(crossTypeInput.value.invalid) && crossTypeInput.value.invalid.length > 0
        ? `Pitfall 侧存在不可读载体（${crossTypeInput.value.invalid.length} 条），跨类型查重不完整`
        : (crossTypeInput.value.complete === false || crossTypeTruncated
            ? `Pitfall 侧候选超过交付上限，跨类型查重不完整（已交付 ${crossTypeItems.length} / ${crossTypeInput.value.total}）`
            : null))
    : `Pitfall 侧不可读，跨类型查重本层缺失：${crossTypeInput.error.message}`;

  // §8.4「观察范围的切分（水位）」：本次运行只看**自上次成功运行以来**新增的内容。
  // 区间端点取自宿主会话记录的轮次号（`currentTurn`），不是「AI 认为哪些是新的」。
  //
  // **2026-10-30：按任务分别读水位，取最早的作为窗口下界**。
  //
  // 此前只读 `requested[0]` 的水位（注释自陈「多任务落地时各任务须各自传自己的键」），
  // 于是第二个任务（`experience-capture`）的窗口取自摩擦的水位，而它自己的键
  // **只写不读**——它没看过的内容会被直接越过并永久丢失。
  //
  // 两个任务共用**一份材料窗口**（同一次派发的提示词只有一段材料），但各有自己的
  // 水位。下界的唯一安全选择是**取两者中最早的那个**：
  //   - 取较晚的 → 较晚者之前的材料永远不被较早者看到（漏看，不可恢复）；
  //   - 取最早的 → 某个任务可能重复看到它已处理过的内容。重复的代价是它可能重复
  //     写一条同现象观察（审核层按 group 去重、达阈值才建账），漏看则**永久丢失**。
  // 故取最早者，并把「本次窗口因迁就另一个任务而回退」如实记进痕迹。
  const watermarkReads = [];
  for (const key of runnable) {
    const read = await readWatermark(dshHomePath, {
      projectRoot: projectRoot ?? factSourceRoot,
      sessionId,
      task: key,
    });
    if (!read.ok) {
      return recordAndFail(dshHomePath, {
        task: taskId,
        reason: `水位不可读（任务 ${key}），无法界定本次观察区间：${read.error.message}`,
        residual: [],
        at,
      });
    }
    watermarkReads.push({ task: key, watermark: read.value });
  }
  // 取 earliest：`lastTurn` 最小者。`describeWindow` 只看 `lastTurn` 一个字段，
  // 故把最早那条原样交给它，其余任务的水位另行记进痕迹。
  const earliest = watermarkReads.reduce(
    (acc, item) => (acc === null || (item.watermark?.lastTurn ?? -1) < (acc.watermark?.lastTurn ?? -1) ? item : acc),
    null,
  );
  const watermarkLagging = watermarkReads.filter((item) => item.task !== earliest?.task).map((item) => ({
    task: item.task,
    lastTurn: item.watermark?.lastTurn ?? null,
  }));
  const watermark = { ok: true, value: earliest.watermark };
  const windowRange = describeWindow(watermark.value, currentTurn);

  // 语义查重属子代理职责（§8.4 第 1 项是登记为 gap 的语义判断）。无提供者时
  // 不创建、不递增——如实报告 skipped。
  if (typeof discover !== "function") {
    return success({
      task: taskId,
      // 任务清单与未实现者**在每条返回路径上都要带**——否则调用方在 skipped 路径
      // 上拿不到「本次要求做几件、其中几件没实现」，痕迹就只记了半截（§8.5 要求
      // 「勾了但没做」必须可见，而 skipped 恰恰是最需要说清范围的路径）。
      tasks: [...requested],
      unimplemented: [...unimplemented],
      outcome: "skipped",
      reason: "no semantic-judgement provider: 11 §9 第 1 项的语义查重是登记为 gap 的语义判断，机械层不得代为判断，故本次不入账",
      threshold: FRICTION_THRESHOLD_N,
      candidates: candidates.value.candidates.length,
      window: windowRange,
      at,
      // 注意：skipped **不推进水位**——本次并未处理该区间，推进会使区间内的内容
      // 永远失去被观察的机会（§8.4 水位段：失败不推进，避免遗漏）。
      watermark_advanced: false,
    });
  }

  // **既有 Pitfall 列表的读取口径（2026-10-28 修订，须与 2026-10-20 的口径区分）**：
  // 2026-10-20 的结论是「**捕获段**（§10.1）不读既有对象」——那条仍然成立，捕获段
  // 只判「有没有失败发生过」，失效方向是漏记而非重复建档，读既有对象会把
  // 「Pitfall 不可读」变成它的伪前提。
  // 但**摩擦发现（§9）是另一件事**：它的查重是**跨类型**的（26 §6.2 要求对照
  // Pitfall 的 active/draft），故必须读——读侧由 `loadCrossTypeDedupCandidates`
  // 承担（只读、不写）。两者不矛盾：**同一份 Pitfall 列表，捕获段不读，查重读。**

  let decision;
  try {
    decision = await discover({
      threshold: FRICTION_THRESHOLD_N,
      candidates: candidates.value.candidates,
      // 观察层：既有 pending 组（供子代理判断「并入哪个组」）+ 组键与现象摘要。
      // 只传 `group`/`phenomenon`/`pending_count`——把 `evidence` 全文塞进提示词会
      // 使提示词随缓冲增长单调膨胀，而归属判断只需现象与键。
      observationGroups: (observationInput.value.by_group ?? []).map((g) => ({
        group: g.group,
        pending_count: g.pending_count,
        phenomenon: g.entries[g.entries.length - 1]?.phenomenon ?? "",
      })),
      // 第三层（2026-10-28）：Pitfall 侧 `active` + `draft` 的薄投影——跨类型同源
      // 判定的唯一输入。缺它则 `paired-with` 永远建不起来（26 §6.2／23 §6.2）。
      crossTypeCandidates: crossTypeItems,
      // 该层不完整时如实传下去，由提示词与交还一并披露（不得静默按「无同源」处理）。
      crossTypeGap,
      // 署名**不由本层传入**：执行体做出判断后，由 provider 从执行体自己的会话记录
      // 取得并随返回值上抛（executorSignature）。此前这里透传一个 `sessionSignature`
      // 形参，而 lifecycle 调用时从不传入，故该形参恒为 undefined——形参存在却永远
      // 读不到值，读者会误以为署名走这条路（2026-10-17 清退）。
      // 区间与提示词一并交给执行体（提示词由 friction-subagent-contract.js 依
      // 这些机械前提组装；执行体不得自行界定区间）。
      window: windowRange,
      // 本次要做的全部事项——执行体据此拼接提示词与复合 schema（一次派发多件）。
      tasks: [...requested],
    });
  } catch (error) {
    // ── 失败原因须可诊断（2026-10-26 补）────────────────────────────────
    //
    // 此前 `residual` 是**硬编码的空数组**，于是队列里 135 条失败**全部只留下
    // 一句 `stopReason=error`**：知道「失败了」，但查不出「为什么」。这不是
    // 「没登记」——登记了，登记得不足以诊断。实测代价：本轮排查这 135 条时，
    // 队列、运行痕迹、活动日志三处都取不到任何超出 stopReason 的信息。
    //
    // 故把**当下确实拿得到**的诊断项逐项写进 `residual`，并**明确标注哪一项
    // 宿主未提供**——「未提供」本身是结论（它说明该信息缺口在宿主侧，不在本
    // 模块），比静默留空有用。
    //
    // 边界：只搬运，不解释。不猜测 error 的根因、不把 stopReason 翻译成白话
    // 结论（那会变成第二规则源），也不因补了诊断就改变「不推进水位」的处置。
    return recordAndFail(dshHomePath, {
      task: taskId,
      reason: `执行体（受管辖隔离子代理）失败：${String(error?.message ?? error)}`,
      residual: describeExecutorFailure(error),
      at,
      // 派生/判断失败：水位**不推进**（§8.4 水位段），下次重覆盖同一区间。
      watermarkAdvanced: false,
    });
  }

  // §8.4 水位段「推进与不推进」：仅当本次运行**成功完成**时才推进。
  //
  // **顺序纪律（复核发现①的修复）**：水位推进必须以「落地已成功」为前提——
  // 早先的实现把推进放在本层、而落地由调用方在**更晚**执行，于是落地失败时
  // 水位已前进、账目却从未写入：那段窗口被标记为已处理，内容**永远不会再被
  // 观察**（宿主只发布事件、不回放；本模块按 §8.4 纪律不读会话日志）。这与
  // 缺陷 D2 同形态（看起来在跑、实质无产出），且更隐蔽。
  //
  // 故本层**不再自行推进**，而是把「可推进的轮次」交给调用方，由调用方在
  // **落地成功之后**推进。判定权仍在本层（何时可推进），只是执行时机后移。
  const pendingWatermarkTurn = Number.isInteger(decision?.watermarkTurn) ? decision.watermarkTurn : null;

  // 子代理的判断结果由调用方（发现子代理）机械落地——本层不解释其语义，
  // 只要求它是结构化结果并如实上抛。
  return success({
    task: taskId,
    // 本次要求做的全部事项，与其中能力本体未实现者——使调用方能把「勾了三件、
    // 实做一件」如实记进痕迹（04 §8.5：不得主张空闲维护已运行）。
    tasks: [...requested],
    unimplemented: [...new Set([...unimplemented, ...(decision?.unimplementedTasks ?? [])])],
    outcome: decision?.outcome ?? "reported",
    decision,
    // 调用方在**落地成功后**据此推进水位（本层已判定其可推进）。
    // **逐任务推进**：两个任务共用一份窗口，但各有自己的水位键——全部推到本次
    // 窗口的终点，否则落后者的键永远停在旧值、下次又取它当窗口下界（无限回退）。
    pending_watermark_turns: Object.fromEntries(runnable.map((key) => [key, pendingWatermarkTurn])),
    pending_watermark_turn: pendingWatermarkTurn,
    watermark_advanced: false,
    threshold: FRICTION_THRESHOLD_N,
    candidates: candidates.value.candidates.length,
    window: windowRange,
    // 本次窗口为迁就较早的水位而回退时，如实登记（否则「重复看到已处理内容」
    // 在痕迹里看不出原因）。
    ...(watermarkLagging.length === 0 ? {} : { window_lagging_tasks: watermarkLagging }),
    // 第三层缺失时**机械承载**，不只在提示词字符串里（2026-10-28 复核 #2：
    // 原注释称「缺口进 residual 与 gaps」，但成功路径 envelope 无该字段，
    // 披露全靠执行体照写 reason——那与 11 §17 的条件式要求不符）。
    ...(crossTypeGap === null ? {} : { residual: [crossTypeGap], cross_type_dedup: "incomplete" }),
    at,
  });
}

/**
 * §8.3 fail-closed 收口：入队 + 停止。
 *
 * **队列本身不可用时**：§8.3 第 6 条要求不得降级登记、也不得继续。此时返回的失败
 * 里带上 `queue_unavailable`，使调用方**无法**把这次失败当作已登记（这正是
 * 「不得据『已尝试登记』主张登记已完成」的机械形态）。
 *
 * `code`（可选）：沿用调用方给出的**具体**错误码。前置校验（缺账本根、缺会话/轮次
 * 位置标识）各有专用的码，调用方与测试据它区分「为什么没跑」；若一律收口成
 * `idle_checkpoint/stopped`，这个区分就丢了。缺省仍是 `idle_checkpoint/stopped`。
 */
/**
 * 把执行体失败的可诊断信息整理成 `residual` 条目。
 *
 * **只搬运当场拿得到的东西**：不推断根因、不把 `stopReason` 翻译成结论式白话
 * （那会变成第二个规则源，01 §11.4）。缺什么就**明说缺什么**——「宿主未提供
 * X」是可行动的结论（缺口在宿主侧），静默留空则不可行动。
 *
 * 已知的三个来源：
 *   · `error.message` —— 已含 `stopReason=`（provider 拼的），是全队唯一稳定的项；
 *   · `error.code` —— 本插件自己的错误码（如 `discovery_provider/incomplete_run`）；
 *   · `error.diagnostic` / `error.runId` / `error.stack` —— **有没有取决于上游**，
 *     有就带、没有就标注。
 *
 * 为什么 `runId` 值得带：同一个 runId 能在宿主侧的会话记录里反查这次派发的子
 * 会话（子会话目录以 runId 命名），这是目前**唯一**能把「这条失败」连到「那次
 * 实际发生了什么」的线索。
 */
function describeExecutorFailure(error) {
  const residual = [];
  const code = error?.code;
  if (typeof code === "string" && code.length > 0) {
    residual.push(`错误码：${code}`);
  }
  if (error?.diagnostic !== undefined && error?.diagnostic !== null) {
    residual.push(`宿主诊断：${String(error.diagnostic)}`);
  }
  if (typeof error?.runId === "string" && error.runId.length > 0) {
    residual.push(`子代理运行标识（可据此反查宿主的子会话记录）：${error.runId}`);
  }
  if (typeof error?.stack === "string" && error.stack.length > 0) {
    // 只留首帧：栈能指出「失败抛在哪个模块」，全量栈对队列读者是噪声。
    const firstFrame = error.stack.split("\n").find((line) => line.trim().startsWith("at "));
    if (firstFrame) residual.push(`抛出位置：${firstFrame.trim()}`);
  }
  if (typeof error?.diagnostic === "undefined" || error?.diagnostic === null) {
    // 如实标注缺失：这一项若在，85 条 `stopReason=error` 本该由此说清根因。
    residual.push("宿主未提供 diagnostic —— 失败根因在宿主侧不可得，本模块只能记录 stopReason");
  }
  return residual;
}

async function recordAndFail(dshHomePath, { task, reason, residual, at, code }) {
  const queued = await appendPendingEntry(dshHomePath, { task, reason, residual, at });
  if (!queued.ok) {
    return failure("idle_checkpoint/queue_unavailable", `${reason}（且待处置队列不可写：${queued.error.message}——04 §8.3 第 6 条禁止降级登记，故本次未登记）`, {
      stop_reason: reason,
      residual,
      queue_unavailable: true,
    });
  }
  return failure(code ?? "idle_checkpoint/stopped", reason, {
    stop_reason: reason,
    residual,
    pending_entry_id: queued.value.entry_id,
  });
}

export { failure as __failure, success as __success };
