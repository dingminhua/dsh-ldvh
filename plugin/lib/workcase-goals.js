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

/**
 * The controlled write points this module serves.
 *
 * `execute` has **two** outcomes that differ in what the goal must say
 * afterwards, and the split is decided on the object side (whether the newly
 * written body carries 「## 結果」), not here:
 *
 * - while the case is still在推进（no 結果 section）→ `execute`：设置点，保持武装；
 * - the update that FIRST落盘 the 結果 section puts the case into 「待批准关闭」
 *   (awaiting_gate2) → `propose_close`：**收口点之暂停**，目标 disarm。
 *
 * Why the third point exists (2026-10-19, Friction fa304c6d): until this point
 * the host goal kept driving toward Gate 2 during the whole closure-proposal
 * window. Because the write points and the driver have no notion of 「等 Human
 * 判定」, the same automatic run that proposed closure also closed it — the
 * awaiting_gate2 state existed on disk for minutes (measured 2m43s,
 * workcase-996e207a) and never surfaced to the Human as a decision point.
 *
 * 边界（不得作过度声明）：暂停只移除**宿主侧**的自动续轮动力；它不撤销
 * 「Human 批过 Gate 1」这一授权，也不证明 Human 看过提案。若调用方随后仍连调
 * `close`，机械层拦不住（同 `result_proposal_required` 的自认边界）。
 */
export const GOAL_WRITE_POINTS = Object.freeze(["approve", "execute", "propose_close", "close", "cancel", "rebatch"]);

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
  //   设置点（批准／执行期更新）——服务不可用、会话身份取不到、目标指向他对象，一律拒绝写入。
  //   收口点（关闭／取消／重批／提请关闭）——上述情形一律**不做任何事**并如实报告，**不拒绝**写入：
  //     拿不到目标服务，或目标早已指向别处，都不该成为收口（关单／取消／交还 Human）的拦路石。
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
      //
      // propose_close: 落盘关闭提案（待批准关闭期）——**同一撤销**：推进目标在
      // 那一刻起不再是「推进到 Gate 2」（那正是自动续轮把工单直接关掉的动力），
      // 而是「等 Human 判定」。宿主只有 paused／blocked 两种停法，paused 是
      // 「可恢复地停下」，与 Human 批准后可续接的语义一致（不用 blocked：它不是
      // 故障，也不该触发「报告阻塞并结束自主运行」的收尾文案）。
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

/**
 * 该会话的**当前目标是否承载某个工单**？返回其 object_uid，或 null。
 *
 * 目标文本是唯一承载对象标识之处（形如 `推进 workcase-<uid> 到 Gate 2（<title>）`），
 * 故这条解析是「本会话在办哪一单」的读取口径——不靠另立登记表（01 §7.2：不建第二账本）。
 */
export function workcaseUidFromObjective(objective) {
  if (typeof objective !== "string") return null;
  const match = objective.match(/workcase-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
  return match === null ? null : match[1];
}

/**
 * 从既有目标文本里取回工单标题（`推进 workcase-<uid> 到 Gate 2（<title>）`）。
 *
 * 重建目标时若调用方没给 title，用它保持新目标与旧目标同一措辞——否则重建出来的
 * 目标会丢掉标题，Human 看到的又是一条读不出是哪个工单的文本。解析失败返回空串
 * （与 `goalObjectiveFor(uid, "")` 的既有行为一致，不抛）。
 */
export function objectiveTitleOf(objective) {
  if (typeof objective !== "string") return "";
  const match = objective.match(/到 Gate 2（(.*)）\s*$/);
  return match === null ? "" : match[1];
}

/**
 * 接手侧的环境检查（`21 §14`「以及该会话续接本对象」）——**在会话继续干活时**把
 * 已在办工单的宿主目标恢复到武装状态。
 *
 * 与 `syncWorkcaseGoal` 的分工：后者是**受控写入当次**的机械副作用（写之前判定、
 * 失败即拒绝写入）；本函数是**环境性**的——它不由任何一次写入触发，也**不拒绝
 * 任何动作**（会话继续干活不该因为宿主目标服务不可用而被拦住）。故：
 *
 * - 服务不可用、会话身份取不到、目标读不到 → **什么都不做**并如实回报原因
 *   （不是失败：本函数没有可拒绝的对象——它不拦截会话的任何动作）；
 * - 当前目标不承载工单、或所承载的工单**不在执行期**（`draft`／`closed`）→ 什么都不做。
 *   后者是必须的：局部重批把执行期对象退回 `draft` 并**暂停**其目标，此时「续接」
 *   若一律重新武装，就等于无声撤销了那次暂停；
 * - 工单在执行期但**已进入「待批准关闭」期**（正文含「## 结果」节）→ 什么都不做。
 *   这是同一撤销风险的第二种形态（2026-10-19）：`propose_close` 暂停了目标，而对象
 *   的 `status` 仍是 `open`——若此处只看 status，每回合接手都会把它重新武装，暂停
 *   当场失效。判据与呈现层 `awaiting_gate2` 同源（21 §8：`status=open` ∧ 正文含结果节）；
 * - 目标属于**执行期（`open`）**工单且已武装 → `kept`，不做写操作；
 * - 目标属于执行期工单但**已 complete** → `create` 重建为同一措辞的新目标
 *   （`recreated`）。宿主 resume 的相位闭集不含 complete，这曾是本函数的死角：
 *   它会退化成每回合一次的 GOAL_INVALID_TRANSITION，见函数体内注释；
 * - 目标属于执行期工单但解除武装／暂停／受阻 → `resume`（`rearmed`）。
 *
 * **失败可见性**：重建与 resume 失败返回 `{ok:false, code:GOALS_FAILED}` 而不是
 * 「`ok:true` + action:none」。`ok:false` 在这里**不拦任何动作**（本函数无拦截权），
 * 它的唯一作用是把「对象在执行期却没有武装目标」这一实态交给调用方记录。
 */
export async function rearmInFlightWorkcaseGoal({ ctx, agent, readWorkcaseStatus, readAwaitingGate2 }) {
  const service = resolveGoalsService(ctx);
  if (!service.ok) return { ok: true, action: "none", detail: { reason: service.message } };
  if (agent === null || agent === undefined) {
    return { ok: true, action: "none", detail: { reason: "the calling session's agent could not be resolved" } };
  }
  let current;
  try {
    current = service.value.get(agent);
  } catch (error) {
    return { ok: true, action: "none", detail: { reason: `the host goals service call failed: ${error instanceof Error ? error.message : String(error)}` } };
  }
  if (current === null || current === undefined) return { ok: true, action: "none", detail: { reason: "no current goal" } };
  const objectUid = workcaseUidFromObjective(current.objective);
  if (objectUid === null) return { ok: true, action: "none", detail: { reason: "the current goal does not carry a WorkCase" } };

  let status;
  try {
    status = await readWorkcaseStatus(objectUid);
  } catch {
    status = null;
  }
  if (status !== "open") {
    return { ok: true, action: "none", detail: { reason: `workcase-${objectUid} is not in its execution period (${JSON.stringify(status)})`, object_uid: objectUid } };
  }
  // 待批准关闭期（21 §8）：status 仍是 open，但推进已交还 Human——重新武装目标
  // 等于撤销 propose_close 的那次暂停。判据由调用方从落盘对象读出（正文含「## 结果」节），
  // 缺省（未传该依赖）时按「未进入待批准关闭」处理：本函数无拒绝权，且旧的调用点
  // 若不传，行为与本次引入该依赖之前完全一致。
  let awaitingGate2 = false;
  if (typeof readAwaitingGate2 === "function") {
    try {
      awaitingGate2 = (await readAwaitingGate2(objectUid)) === true;
    } catch {
      awaitingGate2 = false;
    }
  }
  if (awaitingGate2) {
    return {
      ok: true,
      action: "none",
      detail: {
        reason: `workcase-${objectUid} is awaiting Gate 2 (the closure proposal has been persisted; 21 §8 「待批准关闭」期) — the host goal stays disarmed until the Human rules on the proposal`,
        object_uid: objectUid,
        awaiting_gate2: true,
      },
    };
  }
  if (current.phase === "active" && current.activation === "armed") {
    return { ok: true, action: "kept", detail: { object_uid: objectUid } };
  }
  // `complete` 是一条**独立分支**，不得落到下面的 resume（2026-10-19 修复）。
  // 宿主 resume 的可接受相位闭集是 {active, paused, blocked}，对 complete 必抛
  // GOAL_INVALID_TRANSITION；若与普通失败共用一个 catch 就会返回
  // `{ok:true, action:"none"}`——看起来像「没事可做」，实际是「每个回合都在失败」
  // （workcase-996e207a 自 2026-10-18 07:08:47 起正是如此）。目标已完成而对象仍在
  // 执行期，意味推进被提前弃守——唯一能恢复的通道是 create 替换（宿主契约：
  // complete 的目标可被 create 替换；与 syncWorkcaseGoal 设置点的同款处理一致）。
  if (current.phase === "complete") {
    try {
      const objective = objectiveTitleOf(current.objective) === ""
        ? goalObjectiveFor(objectUid, "")
        : goalObjectiveFor(objectUid, objectiveTitleOf(current.objective));
      const view = service.value.create(agent, { objective });
      return {
        ok: true,
        action: "recreated",
        detail: { object_uid: objectUid, previous_phase: "complete", objective, phase: view?.phase ?? null, activation: view?.activation ?? null, revision: view?.revision ?? null },
      };
    } catch (error) {
      // 这里**不吞**：对象仍在执行期而目标已被完成，是「推进被弃守」的实态，
      // 必须让调用方看得见，否则同一个不可见缺陷会重演。
      return {
        ok: false,
        code: GOALS_FAILED,
        action: "none",
        message: `workcase-${objectUid} is still in its execution period but its host goal is complete, and replacing it failed: ${error instanceof Error ? error.message : String(error)}`,
        detail: { object_uid: objectUid, previous_phase: "complete" },
      };
    }
  }
  try {
    const view = service.value.resume(agent, { id: current.id, revision: current.revision });
    return { ok: true, action: "rearmed", detail: { object_uid: objectUid, phase: view?.phase ?? null, activation: view?.activation ?? null } };
  } catch (error) {
    // 同上：resume 失败不是「没事可做」——目标未武装而对象在执行期，必须可见。
    return {
      ok: false,
      code: GOALS_FAILED,
      action: "none",
      message: `workcase-${objectUid} is in its execution period but its host goal (phase=${JSON.stringify(current.phase)}, activation=${JSON.stringify(current.activation)}) could not be resumed: ${error instanceof Error ? error.message : String(error)}`,
      detail: { object_uid: objectUid, phase: current.phase, activation: current.activation },
    };
  }
}
