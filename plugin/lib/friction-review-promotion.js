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
 * `readPromotionReadyGroups` 按 group 计数机械算出，标题/依据/归因早已随
 * 观察条目落进缓冲（§12bis.1 字段闭集，2026-10-30 扩展）。故本模块不派生执行体、
 * 不消耗模型调用——它只是把缓冲里已经成立的结论落成事实对象。
 * （**2026-11-02 订正**：原列含 `impact`，该字段已随 26 §8 的字段删除撤销——
 * Human 定案「摩擦取消 中 轻 重 这种分级制度」。）
 *
 * 需要语义判断的部分（「这条经验是不是新的」）仍在审核段的子代理里。
 *
 * ## 边界
 *
 * - **不改变任何既有账目的状态**（26 §9：状态推进只有 Human Gate）。
 * - 补充级更新（§9 第 4 项）作用于 `target_uid` 非空的缓冲条目，只增计数与现象段。
 * - **单条失败不阻断其余**（2026-10-31 修）：补充与晋升各自把失败记进 `residual`，
 *   继续处理后面的条目／组，由调用方如实登记。缓冲不可读、就绪组不可读这两类
 *   **整批性**失败仍 fail-closed（那时「其余」也无从谈起）。
 *   此前的「任一失败即整函数返回」造成过实测的队首阻塞：4 条待补充条目指向的账目
 *   带着已删除字段，使 9 条达阈值条目在界面上显示「可晋升」却永远晋升不了。
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
      // **逐字引证必须一并写入账目**（2026-11-01 修，证据链缺陷）。
      //
      // 原实现只传 observation，于是账目正文只多一句「补充观察（时间）：<现象>」；
      // 而本函数随后会把该缓冲条目**整条移除**（见下方 `settleSupplementedEntries`）
      // ——这条观察引了什么原文就再也查不回来。02 §6.1 第 3 条要求权威对象的证据自足；
      // 11 §12bis.1 第 3 条自 2026-11-01 起把该要求从晋升路径扩到补充路径。
      //
      // 条目的 `evidence` 字段是「逐字片段 + 来源引用」的合成串（见 `recordObservation`），
      // 原样传入即可——它就是发现层写进缓冲的那份，不需要二次加工。
      evidence: typeof entry.evidence === "string" && entry.evidence.length > 0 ? entry.evidence : null,
      observationAt: entry.at,
      sessionSignature,
    });
    if (!result.ok) {
      // **补充失败不阻断晋升**（2026-10-31 修，实测缺陷）。
      //
      // 原实现在此 `return failure`，于是「一条补充失败」会让整个函数返回——
      // 而晋升（下一节）**根本执行不到**。实测后果：缓冲里 `over-escalation-to-
      // human-arbitration`(5 条) 与 `corpus-coupled-test-assertions`(4 条) 早已达阈值、
      // 界面上一直显示「可晋升」，却永远不晋升；原因是 10 条待补充条目里有 4 条指向
      // 的既有账目带着 2026-10 已删除的 `human_return_at` 字段，校验一拒即整函数返回。
      //
      // 两件事本无依赖：补充作用于 `target_uid` 非空的条目，晋升作用于整组
      // `target_uid` 为空的条目（实测两组零重叠）。故补充失败记入 `residual` 并**继续**，
      // 由调用方如实登记（§12：不静默跳过）。该条目仍留在缓冲里，下次运行重试。
      residual.push({
        stage: "supplement",
        entry_id: entry.id,
        target_uid: entry.target_uid,
        code: result.error?.code ?? "review_promotion/supplement_failed",
        message: result.error?.message ?? "unknown",
      });
      continue;
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
    // 晋升所需的几项取自该组的**最近一条**观察——发现层写入时，同一组每条都带
    // 这几项（它们由子代理在判定「沿用该组」时一并给出），故取任意一条等价。
    const latest = group.entries[group.entries.length - 1];
    const promoted = await promoteReadyGroup({
      factSourceRoot,
      dshHomePath,
      projectId,
      group: group.group,
      title: latest.title,
      basis: latest.basis,
      attribution: latest.attribution,
      sessionSignature,
    });
    if (!promoted.ok) {
      // 同一类问题的另一半（2026-10-31）：晋升失败也不得让**后续组**永远轮不到。
      // `MAX_CREATES_PER_REVIEW_RUN` 是 1，故迭代顺序里第一组若持续失败，第二组
      // 在旧实现下永远执行不到——与补充阶段堵住晋升是同一个「队首阻塞」形态。
      // 记入 `residual` 并继续，由调用方如实登记。
      residual.push({
        stage: "promote",
        group: group.group,
        code: promoted.error?.code ?? "review_promotion/promote_failed",
        message: promoted.error?.message ?? "unknown",
      });
      continue;
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
