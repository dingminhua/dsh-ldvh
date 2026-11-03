/**
 * 摩擦侧两处失败面的**统一登记通道**（11 §12bis.1，2026-11-04）。
 *
 * ## 为什么有这个模块
 *
 * 摩擦缓冲有两条会失败的处理路径：
 *
 * - **转写失败**（经验侧 discarded 条目的材料没能搬进摩擦缓冲）；
 * - **补充失败**（缓冲条目的 `target_uid` 指向的账目读不出来，补充写不进去）。
 *
 * 在此之前，两者只有一个登记通道：`registerTransferFailure` 写在
 * `observation-review.js` 里、是**模块私有**的，且硬编码 `task:
 * "experience-review"`。于是：
 *
 * - 转写失败 → 进待处置队列（下一轮仍可见，有人会处理）；
 * - 补充失败 → 只 `residual.push` 后 `continue`，**不登记**。
 *
 * `friction-review-promotion.js` 的 import 列表里没有任何 pending-queue 导入，
 * 它是结构上**不可能**登记的。后果是同一个失败面的一半有账、另一半只有一次
 * 返回体（返回体只在当拍有效，下一拍谁也不知道漏了什么）。
 *
 * ## 为什么单独一个模块而不是塞进 pending-queue.js
 *
 * 本模块只依赖 Node 内置（经 `pending-queue.js` 间接）。摩擦侧的
 * `friction-review-promotion.js` 需要 import 它，而 `pending-queue.js` 是被
 * 两侧共同依赖的底层文件——若把登记逻辑塞进 `pending-queue.js`，它就要反过来
 * 知道「摩擦侧的失败长什么样」（task 名、residual 措辞），形成方向错误的知识下沉。
 * 单独一个薄模块使依赖方向保持：摩擦侧 → 登记 → 队列。
 *
 * ## 登记失败不得吞掉
 *
 * 队列不可用时把原因写进**同一条失败项**（`unregistered` / `unregistered_message`），
 * 使「连登记都没做成」本身可见，而不是变成静默。这是转写侧原有的纪律，本模块
 * 把它扩到两个失败面共用。
 */

/** 两类失败各自的队列归属。 */
export const FRICTION_FAILURE_TASKS = Object.freeze({
  /** 转写失败：经验缓冲条目已 discarded，材料没搬进摩擦缓冲。 */
  transfer: "experience-review",
  /** 补充失败：缓冲条目的 target_uid 账目读不出，补充写不进去。 */
  supplement: "experience-review",
});

/**
 * 把一条磨擦侧失败登记进待处置队列。
 *
 * 失败项（`failureItem`）会被**就地**补上三种字段之一：
 * - `pending_entry_id` —— 登记成功，给出队列条目 id；
 * - `unregistered` + `unregistered_message` —— 登记失败，写明原因。
 *
 * 本函数**不抛错**：登记是旁路，它自己失败也不能把调用方的处理流程打断
 * （调用方那时正在处理另一件已经失败的事）。
 *
 * @param {Function} dshHomePath - 路径拼接器（`pending-queue.js` 同一约定）
 * @param {object} failureItem - 失败项；会被就地补字段，并由调用方带出
 * @param {object} options
 * @param {"transfer"|"supplement"} options.kind - 哪个失败面
 * @param {string} options.reasonPrefix - 队列条目的 reason 前缀（人类可读）
 * @param {string} options.residualText - 队列条目的 residual 正文（要能独立读懂）
 * @param {Date} [options.now]
 * @returns {Promise<void>}
 */
export async function registerFrictionFailure(dshHomePath, failureItem, {
  kind,
  reasonPrefix,
  residualText,
  now,
} = {}) {
  if (failureItem === null || typeof failureItem !== "object") return;
  const task = FRICTION_FAILURE_TASKS[kind];
  if (task === undefined) {
    // 未知 kind 是调用方的编程错误，但同样不得抛错——记为未登记并说明原因。
    failureItem.unregistered = "pending_queue/unknown_kind";
    failureItem.unregistered_message = `registerFrictionFailure got unknown kind ${JSON.stringify(kind)}`;
    return;
  }
  try {
    const { appendPendingEntry } = await import("./pending-queue.js");
    const queued = await appendPendingEntry(dshHomePath, {
      task,
      reason: `${reasonPrefix}（${failureItem.code ?? "unknown"}）：${failureItem.message ?? "unknown"}`,
      residual: [residualText ?? "材料未完成处理"],
      at: now instanceof Date ? now.toISOString() : undefined,
    });
    if (!queued.ok) {
      failureItem.unregistered = queued.error?.code ?? "pending_queue/unavailable";
      failureItem.unregistered_message = queued.error?.message ?? "unknown";
    } else {
      failureItem.pending_entry_id = queued.value.entry_id;
    }
  } catch (error) {
    failureItem.unregistered = "pending_queue/threw";
    failureItem.unregistered_message = String(error?.message ?? error);
  }
}

/**
 * 转写失败的登记（保持原有措辞与 task，行为等价于原私有实现）。
 *
 * 保留这个薄包装而不是让调用方各自拼 reason/residual，是为了让**既有语料**
 * （已落盘的队列条目）与新写入的条目在措辞上一致——改变既有措辞会让
 * 「同一失败不同写法」污染队列的可检索性。
 */
export async function registerTransferFailure(dshHomePath, failureItem, now) {
  await registerFrictionFailure(dshHomePath, failureItem, {
    kind: "transfer",
    reasonPrefix: "转写未完成",
    residualText: `经验缓冲条目 ${failureItem?.entry_id ?? "?"} 已结算为 discarded，其材料未能转写到摩擦观察缓冲`,
    now,
  });
}

/**
 * 补充失败的登记（本单新增，2026-11-04）。
 *
 * 此前补充失败只进 `residual`、不进队列——下一拍就再也看不到它。这与转写失败
 * 是**同一性质**的欠账（材料该进账目却没进去），待遇应当一致。
 */
export async function registerSupplementFailure(dshHomePath, failureItem, now) {
  await registerFrictionFailure(dshHomePath, failureItem, {
    kind: "supplement",
    reasonPrefix: "补充未完成",
    residualText: `摩擦缓冲条目 ${failureItem?.entry_id ?? "?"} 的目标账目 `
      + `${failureItem?.target_uid ?? "?"} 未能补充（材料仍在缓冲中，下次运行将重试）`,
    now,
  });
}
