// Host goal synchronization for WorkCase controlled writes (specs/21 §14
// 「宿主推进目标」, specs/10 §5.8 接入形态).
//
// Why this exists: Gate 1 approval starts an execution that is supposed to
// carry the WorkCase to Gate 2. The host goal is what makes that advance
// *visible* to the host (automatic continuation, backlog visibility), and the
// WorkCase's own state machine says nothing about it — so a case could sit
// open forever while the session that opened it believes it is progressing.
//
// The service is `ctx.get("goals")` (optional dependency, undefined check
// required). It is backed exclusively by the owning session log, so it is NOT
// a fact source and NOT read back as evidence about the object: this module
// only keeps the two consistent at the moment of a controlled write.
//
// Failure policy is fail-closed (21 §14): when the service is unavailable, or
// the agent cannot be resolved, the controlled write is REFUSED rather than
// silently performed without a goal. A silent skip is exactly how "the case
// has no goal" would go unnoticed.

/** Objective form carrying the object identity (21 §14). */
export function goalObjectiveFor(objectUid, title) {
  return `推进 workcase-${objectUid} 到 Gate 2（${title}）`;
}

/** Does this objective carry the given object's identity? */
export function goalCarriesObject(objective, objectUid) {
  return typeof objective === "string" && objective.includes(`workcase-${objectUid}`);
}

/** The five controlled write points this module serves. */
export const GOAL_WRITE_POINTS = Object.freeze(["approve", "execute", "close", "cancel", "rebatch"]);

export const GOALS_UNAVAILABLE = "workcase/goals_unavailable";
export const GOALS_CONFLICT = "workcase/goals_conflict";
export const GOALS_FAILED = "workcase/goals_failed";

function unavailable(detail) {
  return {
    ok: false,
    code: GOALS_UNAVAILABLE,
    message: `the host goals service is unavailable (${detail}); the controlled write is refused rather than performed without a goal (21 §14, 10 §5.8)`,
  };
}

function conflict(current, objectUid) {
  return {
    ok: false,
    code: GOALS_CONFLICT,
    message: `the session's current goal points at another object (${JSON.stringify(current.objective)}), not workcase-${objectUid}; refusing the write instead of clearing or overwriting another object's goal (21 §14)`,
  };
}

function failed(error) {
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, code: GOALS_FAILED, message: `the host goals service call failed: ${detail}` };
}

/**
 * Resolve the goals service, failing closed.
 *
 * Returns `{ok:true, goals}` or `{ok:false, code, message}`. `undefined` from
 * `ctx.get` is a real state (the plugin runs without that host service), and
 * it must refuse rather than degrade — see the header.
 */
export function resolveGoalsService(ctx) {
  if (ctx === null || ctx === undefined || typeof ctx.get !== "function") return unavailable("no service context");
  let goals;
  try {
    goals = ctx.get("goals");
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
  if (goals === null || goals === undefined || typeof goals.get !== "function") return unavailable("ctx.get(\"goals\") is undefined");
  return { ok: true, value: goals };
}

/**
 * Apply the goal side of one controlled write.
 *
 * `point` is one of {@link GOAL_WRITE_POINTS}. Returns
 * `{ok:true, action, detail}` where action is one of
 * `created | recreated | resumed | edited | kept | completed | cleared |
 * paused | none`, or `{ok:false, code, message}`.
 *
 * `none` is a real outcome: there is no goal to收口 (close/cancel/rebatch) —
 * not a failure, because a goal may have been cleared by a Human, and refusing
 * the object write then would be wrong. A goal belonging to ANOTHER object is
 * a different matter and is always refused.
 */
export async function syncWorkcaseGoal({ ctx, agent, point, objectUid, title }) {
  if (!GOAL_WRITE_POINTS.includes(point)) {
    return { ok: false, code: GOALS_FAILED, message: `unknown goal write point ${JSON.stringify(point)}` };
  }
  if (typeof objectUid !== "string" || objectUid.length === 0) {
    return { ok: false, code: GOALS_FAILED, message: "objectUid is required to keep the host goal consistent" };
  }
  // 设置点与收口点的失败面**不同**（Human 2026-10-15 裁定 D1/D3）：
  //   设置点（批准／接手）——服务不可用、会话身份取不到、目标指向他对象，一律拒绝写入。
  //   收口点（关闭／取消／重批）——上述情形一律**不做任何事**并如实报告，**不拒绝**写入：
  //     拿不到目标服务，或目标早已指向别处，都不该成为收口（关单／取消）的拦路石。
  const settingPoint = point === "approve" || point === "execute";
  const degrade = (reason) => ({ ok: true, action: "none", detail: { degraded: true, reason } });

  const service = resolveGoalsService(ctx);
  if (!service.ok) return settingPoint ? service : degrade(service.message);
  if (agent === null || agent === undefined) {
    const reason = "the calling session's agent could not be resolved";
    return settingPoint ? unavailable(reason) : degrade(`the host goals service is unusable (${reason})`);
  }
  const goals = service.value;

  const objective = goalObjectiveFor(objectUid, title ?? "");
  let current;
  try {
    current = goals.get(agent);
  } catch (error) {
    return settingPoint ? failed(error) : degrade(`the host goals service call failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    if (!settingPoint) {
      // 收口三点：只处理**属于本对象**的当前目标；其余情形无事可做（D1/D2）。
      if (current === undefined || current === null) {
        return { ok: true, action: "none", detail: { reason: "no current goal to close out" } };
      }
      if (!goalCarriesObject(current.objective, objectUid)) {
        return {
          ok: true,
          action: "none",
          detail: { reason: "the session's current goal belongs to another object; nothing to close out here (it is not cleared or overwritten)" },
        };
      }
      const ref = { id: current.id, revision: current.revision };
      if (point === "close") {
        if (current.phase === "complete") return { ok: true, action: "none", detail: { reason: "already complete" } };
        const view = goals.complete(agent, ref);
        return { ok: true, action: "completed", detail: { phase: view?.phase ?? null } };
      }
      if (point === "cancel") {
        const tombstone = goals.clear(agent, ref);
        return { ok: true, action: "cleared", detail: { revision: tombstone?.revision ?? null } };
      }
      // rebatch: open → draft，推进被暂停，不是被放弃。
      if (current.phase === "paused") return { ok: true, action: "none", detail: { reason: "already paused" } };
      const view = goals.pause(agent, ref);
      return { ok: true, action: "paused", detail: { phase: view?.phase ?? null } };
    }

    // 设置点：无目标即建，同对象即复用／重新武装，他对象即拒绝。
    if (current === undefined || current === null) {
        const view = goals.create(agent, { objective });
        return { ok: true, action: "created", detail: { objective, revision: view?.revision ?? null } };
      }
      if (!goalCarriesObject(current.objective, objectUid)) return conflict(current, objectUid);
      // A completed goal may be replaced; every other phase must be cleared or
      // resumed instead (goals.create contract) — so re-approval recreates
      // rather than edits.
      if (current.phase === "complete") {
        const view = goals.create(agent, { objective });
        return { ok: true, action: "recreated", detail: { objective, revision: view?.revision ?? null } };
      }
      if (current.activation === "disarmed" || current.phase === "paused" || current.phase === "blocked") {
        const view = goals.resume(agent, { id: current.id, revision: current.revision });
        return { ok: true, action: "resumed", detail: { phase: view?.phase ?? null, activation: view?.activation ?? null } };
      }
      if (current.objective !== objective) {
        const view = goals.edit(agent, { id: current.id, revision: current.revision }, { objective });
        return { ok: true, action: "edited", detail: { objective: view?.objective ?? objective } };
      }
      return { ok: true, action: "kept", detail: { objective: current.objective } };
  } catch (error) {
    return settingPoint ? failed(error) : degrade(`the host goals service call failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
