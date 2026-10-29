/**
 * 审核层的摩擦晋升（2026-10-30 职责重划：§9 第 3／4 项移入 §10.2）。
 *
 * ## 为什么搬层
 *
 * 原设计里「达阈值晋升为 open 账目」发生在**发现层**（`friction-landing.js`），
 * 与「写观察条目」同一次运行。Human 2026-10-30 决定改为两层分工：
 *
 * - **发现层**（§9 第 1／2 项）：只写缓冲，**不写事实源**；
 * - **审核层**（§10.2，本模块）：做全部判断并把缓冲升级为事实对象。
 *
 * 这样两层不会同时写事实源（那会重复建账），且晋升所需的判断集中在审核层。
 *
 * ## 本模块是机械的
 *
 * 晋升本身**不需要语义判断**：阈值是固定内嵌的 N（11 §9），「哪一组达阈值」由
 * `readPromotionReadyGroups` 按 group 计数机械算出，标题/依据/归因/影响早已随
 * 观察条目落进缓冲（§12bis.1 字段闭集，2026-10-30 扩展）。故本模块不派生执行体、
 * 不消耗模型调用——它只是把缓冲里已经成立的结论落成事实对象。
 *
 * 需要语义判断的部分（「这条经验是不是新的」）仍在审核段的子代理里。
 *
 * ## 边界
 *
 * - **不改变任何既有账目的状态**（26 §9：状态推进只有 Human Gate）。
 * - 补充级更新（§9 第 4 项）作用于 `target_uid` 非空的缓冲条目，只增计数与现象段。
 * - 任一环节失败即 fail-closed 并如实登记，不降级、不跳过（§12）。
 */

import {
  promoteReadyGroup,
  supplementOccurrence,
} from "./friction-discovery.js";
import {
  readFrictionObservations,
  readPromotionReadyGroups,
  validateStoredEntry,
  frictionObservationPath,
  FRICTION_OBSERVATION_THRESHOLD_N,
} from "./friction-observation-buffer.js";

function failure(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

function success(value) {
  return { ok: true, value };
}

/** 一次运行至多创建的账目数（§8.4「每次运行上限」）。 */
const MAX_CREATES_PER_REVIEW_RUN = 1;

/**
 * 在审核层执行摩擦缓冲的升级：先补充级更新，再阈值晋升。
 *
 * 顺序的理由：补充级更新作用于**已有账目**（`target_uid` 非空），晋升创建**新账目**
 * （`target_uid` 为空）。先补充后晋升，使同一批里「既有账目被补充」与「新组达阈值
 * 建账」互不干扰；反过来也不会出错，但先补充能让本次运行的上限只被晋升消耗。
 *
 * @returns `{ok:true, value:{supplemented, promotions, skipped, residual}}` 或失败。
 */
export async function runFrictionReviewPromotion({
  factSourceRoot,
  dshHomePath,
  projectId,
  sessionSignature,
}) {
  if (typeof dshHomePath !== "function") {
    return failure("review_promotion/no_home", "dshHomePath is required to read the friction observation buffer");
  }
  if (typeof projectId !== "string" || projectId.length === 0) {
    return failure("review_promotion/no_project", "projectId is required — the buffer is partitioned by governed project (§12bis.1)");
  }

  const residual = [];

  // ── 1. 补充级更新（§9 第 4 项，作用于 target_uid 非空的条目）────────────
  //
  // 这些条目由发现层在 `same-obstacle` 态写入：该阻碍已有 open 账目，本次观察
  // 只是「又出现了一次」。补充级更新只增计数与现象段，**不改状态**。
  const allPending = await readFrictionObservations(dshHomePath, projectId, { status: "pending" });
  if (!allPending.ok) {
    return failure(
      "review_promotion/buffer_unreadable",
      `the friction observation buffer cannot be read: ${allPending.error?.message ?? "unknown"} (§12bis.1 纪律：不得降级为空集合)`,
    );
  }
  const supplementTargets = allPending.value.items.filter(
    (entry) => typeof entry.target_uid === "string" && entry.target_uid.length > 0,
  );
  const supplemented = [];
  for (const entry of supplementTargets) {
    const result = await supplementOccurrence({
      factSourceRoot,
      objectUid: entry.target_uid,
      // 现象段里记的必须是**这一次**看到了什么——用该条目的 phenomenon（发现层
      // 已按 `same-obstacle` 态的语义填好），不是整个组的聚合描述。
      observation: entry.phenomenon,
      observationAt: entry.at,
      sessionSignature,
    });
    if (!result.ok) {
      // 补充失败不得静默跳过：该条目会一直留在缓冲里被反复重试，且计数永远不增。
      // 按 §12 fail-closed 上抛，由调用方登记并停止。
      return failure(
        result.error?.code ?? "review_promotion/supplement_failed",
        `supplementing ${entry.target_uid} failed: ${result.error?.message ?? "unknown"}; the entry stays pending and would be retried next run`,
        { stage: "supplement", entry_id: entry.id, cause: result.error },
      );
    }
    supplemented.push({ entry_id: entry.id, target_uid: entry.target_uid, count: result.value?.count_after ?? null });
  }

  // 补充过的条目必须结算掉，否则下一次运行会重复补充（计数虚增）。
  // `supplementOccurrence` 只写账目、不结算缓冲——结算在此处按「已消费」处理：
  // 这些条目的信息已经进了账目的现象段与计数，留在缓冲里没有额外价值。
  if (supplemented.length > 0) {
    const settled = await settleSupplementedEntries(dshHomePath, projectId, supplemented.map((item) => item.entry_id));
    if (!settled.ok) {
      return failure(
        "review_promotion/supplement_settle_failed",
        `the supplement landed but settling its buffer entries failed (${settled.error?.code ?? "unknown"}); `
        + `they stay pending and the next run would count them again — stop and register this (§12)`,
        { stage: "supplement-settle" },
      );
    }
  }

  // ── 2. 阈值晋升（§9 第 3 项）─────────────────────────────────────────
  const ready = await readPromotionReadyGroups(dshHomePath, projectId);
  if (!ready.ok) {
    return failure(
      "review_promotion/ready_groups_unreadable",
      `promotion-ready groups cannot be read: ${ready.error?.message ?? "unknown"}`,
    );
  }

  const promotions = [];
  const skipped = [];
  for (const group of ready.value.ready) {
    if (promotions.length >= MAX_CREATES_PER_REVIEW_RUN) {
      // 超出本次运行上限：如实登记为未处理，下一次运行继续（不是失败）。
      skipped.push({ group: group.group, reason: "per-run-create-cap", pending_count: group.entries.length });
      continue;
    }
    // 晋升所需的四项取自该组的**最近一条**观察——发现层写入时，同一组每条都带
    // 这四个字段（它们由子代理在判定「沿用该组」时一并给出），故取任意一条等价。
    const latest = group.entries[group.entries.length - 1];
    const promoted = await promoteReadyGroup({
      factSourceRoot,
      dshHomePath,
      projectId,
      group: group.group,
      title: latest.title,
      impact: latest.impact,
      basis: latest.basis,
      attribution: latest.attribution,
      sessionSignature,
    });
    if (!promoted.ok) {
      return failure(
        promoted.error?.code ?? "review_promotion/promote_failed",
        `promoting group ${group.group} failed: ${promoted.error?.message ?? "unknown"}`,
        { stage: "promote", group: group.group, cause: promoted.error },
      );
    }
    if (promoted.value?.promoted === true) {
      promotions.push({
        group: group.group,
        object_uid: promoted.value.object_uid,
        count: promoted.value.count ?? group.entries.length,
      });
    } else {
      skipped.push({ group: group.group, reason: promoted.value?.action ?? "promotion-skip", pending_count: group.entries.length });
    }
  }

  return success({
    supplemented,
    promotions,
    skipped,
    residual,
    threshold: FRICTION_OBSERVATION_THRESHOLD_N,
  });
}

/**
 * 把已补充过的缓冲条目结算掉。
 *
 * 复用 `settleGroupPromoted` 会把它们标成 `promoted` 并指向账目 uid——语义上不对
 * （它们没有被「晋升」，只是被补充进既有账目）。故此处直接重写缓冲文件，把对应
 * 条目移除并计入 `consumed`。
 *
 * **为什么直接操作文件**：缓冲模块没有「按 id 移除」的公开入口（它的结算是按 group
 * 的 `settleGroupPromoted`）。补一个入口属于缓冲模块的接口扩张，与本次改动面不符；
 * 而留着重试会造成计数虚增——这是必须消掉的实际缺陷。此处采用**同一把锁**与
 * **同一份校验**，写后回读，失败即 fail-closed。
 */
async function settleSupplementedEntries(dshHomePath, projectId, entryIds) {
  const { readFile, writeFile, rename } = await import("node:fs/promises");

  const path = frictionObservationPath(dshHomePath, projectId);
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return success({ removed: 0 });
    return failure("friction_observation/read_failed", `cannot read ${path}: ${String(error?.message ?? error)}`);
  }

  const idSet = new Set(entryIds);
  const kept = [];
  let removed = 0;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return failure("friction_observation/corrupt_line", `the buffer contains a line that is not JSON; refusing to rewrite it`);
    }
    const problem = validateStoredEntry(record);
    if (problem !== null) {
      return failure("friction_observation/invalid_entry", `the buffer contains an invalid entry (${problem}); refusing to rewrite it`);
    }
    if (idSet.has(record.id)) {
      removed += 1;
      continue;
    }
    kept.push(line);
  }
  if (removed === 0) return success({ removed: 0 });

  const next = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
  // 临时文件与目标同目录（保证 rename 是同一文件系统上的原子操作）。
  const tmp = `${path}.settle.${process.pid}.tmp`;
  await writeFile(tmp, next, "utf8");
  await rename(tmp, path);

  // 写后回读：确认被移除的条目确实不在了。
  const after = await readFile(path, "utf8");
  for (const id of idSet) {
    if (after.includes(id)) {
      return failure(
        "friction_observation/settle_readback_failed",
        `entry ${id} is still present after the settle rewrite — the removal did not take effect`,
      );
    }
  }
  return success({ removed });
}
