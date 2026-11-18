
export const FRICTION_FAILURE_TASKS = Object.freeze({
  transfer: "experience-review",
  supplement: "experience-review",
});

export async function registerFrictionFailure(dshHomePath, failureItem, {
  kind,
  reasonPrefix,
  residualText,
  now,
} = {}) {
  if (failureItem === null || typeof failureItem !== "object") return;
  const task = FRICTION_FAILURE_TASKS[kind];
  if (task === undefined) {
    failureItem.unregistered = "failure_registration/unknown_kind";
    failureItem.unregistered_message = `registerFrictionFailure got unknown kind ${JSON.stringify(kind)}`;
    return;
  }
  try {
    const { recordRun } = await import("./idle-runlog.js");
    const queued = await recordRun(dshHomePath, {
      task,
      stage: "failure-registration",
      reason: `${reasonPrefix}（${failureItem.code ?? "unknown"}）：${failureItem.message ?? "unknown"}`,
      residual: [residualText ?? "材料未完成处理"],
      at: now instanceof Date ? now.toISOString() : undefined,
    });
    if (!queued.ok) {
      failureItem.unregistered = queued.error?.code ?? "runlog/unavailable";
      failureItem.unregistered_message = queued.error?.message ?? "unknown";
    }
  } catch (error) {
    failureItem.unregistered = "failure_registration/threw";
    failureItem.unregistered_message = String(error?.message ?? error);
  }
}

export async function registerTransferFailure(dshHomePath, failureItem, now) {
  await registerFrictionFailure(dshHomePath, failureItem, {
    kind: "transfer",
    reasonPrefix: "转写未完成",
    residualText: `经验缓冲条目 ${failureItem?.entry_id ?? "?"} 已结算为 discarded，其材料未能转写到摩擦观察缓冲`,
    now,
  });
}

export async function registerSupplementFailure(dshHomePath, failureItem, now) {
  await registerFrictionFailure(dshHomePath, failureItem, {
    kind: "supplement",
    reasonPrefix: "补充未完成",
    residualText: `摩擦缓冲条目 ${failureItem?.entry_id ?? "?"} 的目标账目 `
      + `${failureItem?.target_uid ?? "?"} 未能补充（材料仍在缓冲中，下次运行将重试）`,
    now,
  });
}
