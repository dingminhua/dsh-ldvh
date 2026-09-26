// dsh-ldvh — subagent lifecycle (installChild mechanism, content empty).
//
// Mechanism mirrors mnemon's installChild (lifecycle.ts) with LDVH semantics:
//   1. identity: origin === 'subagent' takes the child path;
//   2. lineage check: parentSession id must resolve to a LIVE parent agent we
//      installed — an orphan (string lineage alone) gets NOTHING, because a
//      lineage claim is not authority (mnemon's rule);
//   3. delegation: the child INHERITS the parent's governance scope (管辖沿
//      委派链传递, 00 §5 委派不转责) — the child does not re-judge from its
//      own cwd, it receives the parent's judged state as delegation;
//   4. independent per-agent lifecycle on the child fiber with the same
//      cleanup discipline (effect stops reversed, children Map swept);
//   5. CONTENT EMPTY (Human strategy): what the child actually DOES (its
//      tools, its guidance, its triggered task) is left as named seams —
//      the mechanism only guarantees a governed child is recognized,
//      parented, scoped, hooked, and cleaned up.
//
// Children are deliberately LIGHTER than roots: no tools registration, no
// sessionScopes publication (the mark belongs to the human-facing root
// conversation), no pre-step channel. The hooks exist so future content
// lands in an already-mounted place.
//
// 2026-09-04 (delegation-chain visibility): the previous record was a bare
// `{ scopeState }`, which made the delegation chain invisible. Children now
// own a DelegatedChildRecord — still lighter than roots, but with an activity
// trail, a conclusion slot and explicit parent-state propagation. See
// agent-lifecycle.js for why this is NOT an AgentLifecycle.

import { guidanceTextFor } from "./guidance-text.js";
import { DelegatedChildRecord } from "./agent-lifecycle.js";

/**
 * Bound on retained finished-child records. Map insertion order gives us
 * FIFO eviction for free. Deliberately small: this is a result-collection
 * window, not a durable store (durability belongs to the fact source / 06).
 */
const RETIRED_LIMIT = 50;

/**
 * Read a session's committed events, or `null` when the session offers no
 * readable log.
 *
 * 2026-09-26: `session.events` DOES NOT EXIST on a DSH `Session` — the object
 * exposes `snapshotEvents()` (and `ownEvents()`), which is what the framework's
 * own consumers call (`dsh-agent-loop`'s `eventsNewestFirst()` is literally
 * `session.snapshotEvents().toReversed()`). Reading a non-existent property
 * yielded `undefined` forever, so the conclusion capture below returned early
 * on EVERY turn and no delegated child ever produced a conclusion.
 *
 * The `events` array form is kept as a fallback so existing fixtures (which
 * assign `session.events = [...]`) stay meaningful; it is NOT a real DSH shape
 * and must not be treated as one. Returning `null` (rather than `[]`) keeps
 * "no readable log" distinguishable from "a turn with no assistant text",
 * which the caller treats as a real outcome (`""`) — collapsing the two would
 * make an unreadable session look like a completed textless turn.
 */
function readCommittedEvents(session) {
  if (session === null || session === undefined) return null;
  if (typeof session.snapshotEvents === "function") {
    try {
      const events = session.snapshotEvents();
      if (Array.isArray(events)) return events;
    } catch {
      // Fall through: a throwing reader is "no readable log", not a crash —
      // this runs inside a child's turn-end path and must never break the turn.
    }
  }
  return Array.isArray(session.events) ? session.events : null;
}

export function createChildInstaller(ctx, { agents, children, sessionScopes, retiredChildren }) {
  /**
   * Install the child lifecycle for one subagent. Returns true when the
   * child was installed (parent found and governed chain established).
   */
  return function installChild(agent) {
    const agentId = agent?.id ?? agent?.session?.header?.id;
    if (typeof agentId !== "string" || children.has(agentId)) return false;

    // Lineage check: the parentSession id must resolve to a live parent.
    const parentId = agent?.session?.header?.parentSession?.trim();
    const agentsService = ctx.get("agents");
    const parent = parentId === undefined || parentId === "" || agentsService === undefined
      ? undefined
      : agentsService.get(parentId);
    // Live verification diagnostics (2026-09-04): the delegation chain reported
    // "Found 0 child record(s)" on a real governed session. These lines answer
    // exactly WHERE the chain breaks — origin flag, lineage key, parent lookup —
    // without guessing. Keep them at info level; they fire once per subagent.
    ctx.logger.info(
      "[dsh-ldvh] installChild probe: agent=%s origin=%s parentSession=%s parentLookup=%s ourAgentsHasParent=%s ourAgentsHasSelf=%s",
      agentId,
      agent?.session?.header?.origin ?? "<none>",
      parentId ?? "<none>",
      parent === undefined ? "MISS" : "HIT",
      typeof parentId === "string" ? String(agents.has(parentId)) : "<n/a>",
      agents.has(agentId) ? "yes(should-not-happen)" : "no"
    );
    if (parent === undefined || parent === agent) return false; // orphan: no authority

    // Delegation: inherit the parent's governed chain. The parent's lifecycle
    // record holds its current judged state; an ungoverned parent produces a
    // child that stays equally quiet (zero-interference along the chain).
    const parentRecord = agents.get(parentId ?? parent?.id ?? parent?.session?.header?.id);

    const record = new DelegatedChildRecord(agent, parentId ?? null);
    record.applyParentScope(parentRecord?.scopeState ?? null, { source: "install" });

    const dispose = agent.ctx.effect(() => {
      const stops = [];
      const cleanup = () => {
        for (const stop of stops.reverse()) {
          try { stop(); } catch { /* already removed */ }
        }
        // Live children are removed on dispose (memory safety), but the record
        // survives in retiredChildren so the root can still collect the result
        // of a child that already finished. Without this, result collection
        // only ever saw children that were still running — which is exactly
        // the case nobody needs, since you collect a result AFTER it ends.
        if (retiredChildren !== undefined && !retiredChildren.has(agentId)) {
          record.retiredAt = new Date().toISOString();
          record.retired = true;
          retiredChildren.set(agentId, { record });
          while (retiredChildren.size > RETIRED_LIMIT) {
            const oldest = retiredChildren.keys().next().value;
            retiredChildren.delete(oldest);
          }
        }
        children.delete(agentId);
      };
      try {
        // Guidance seam (content active but minimal): a governed-chain child
        // receives the same three-state guidance section through its own
        // assemble waterfall, so a delegated worker knows the project is
        // governed. Tools, pre-step channel, and sessionScopes publication
        // stay OFF — those belong to the root conversation.
        stops.push(agent.ctx.on("system-prompt/assemble", (assembly, context, next) => {
          if (context?.agent === undefined || context.agent.id !== agentId) return next();
          if (context.signal?.aborted === true) return next();
          const text = guidanceTextFor(record.scopeState ?? "not_governed");
          return next().then((assembled) => {
            const sections = (assembled.sections ?? []).filter((section) => section.name !== "ldvh:minimal-guidance");
            if (text !== "") sections.push({ name: "ldvh:minimal-guidance", text });
            return { ...assembled, sections };
          });
        }));
        // Task seam (CONTENT EMPTY): the future "child is triggered to do one
        // thing" hook — pre-step observed so the trigger point is mounted;
        // what the task IS remains a named, empty seam.
        stops.push(agent.ctx.on("agent/pre-step", (payload, next) => next()));
        // 委派状态刷新（原 `agent/session-start` 安全网）：0.1.7 起该事件已删除，
        // 语义并入 `agent/created` 的 payload.source（调研报告 §3.4）。子代理安装
        // 本身就发生在 agent/created 时，所以这里直接执行一次；父级此后的判定变化
        // 由 lifecycle 的 propagateToChildren 覆盖（见 reprimeAgent）。
        const refreshDelegatedState = (source) => {
          record.applyParentScope(
            agents.get(parentId ?? parent?.id ?? parent?.session?.header?.id)?.scopeState ?? null,
            { source }
          );
        };
        refreshDelegatedState("agent-created");
        // Conclusion seam: capture the child's final assistant text so the
        // root can collect it.
        //
        // Event choice (2026-09-04, verified against DSH 2.0.4): there is NO
        // `agent/turn-end` event — the real agent-scoped events are
        // agent/{created,disposed,error,pre-step,request,request-error,
        // session-start,status,turn-stopping}. `agent/turn-stopping` fires
        // with payload { turn, signal } only (no message content). The turn
        // close signal that carries a turn number is the session-scoped
        // `session/event` with type "turn/end" (payload { turn, reason }),
        // which is what triggers.js already uses. So we take the turn number
        // there and walk back through the session's committed events for that
        // turn's assistant/message.
        //
        // 2026-09-26 修复：原实现读 `session.events`，而 DSH 的 Session 上
        // **没有 `events` 属性**——它只有 `snapshotEvents()` 方法。故该表达式
        // 恒为 undefined，`!Array.isArray` 立即返回，**结论从未被捕获过**
        // （record_review 因之报「no captured conclusion」）。本仓自 3670929
        // 引入起即如此，实测由父会话以已结束子代理 id 走 record_review 复现：
        // 报的是「no captured conclusion」而非「not registered」，两条分支
        // 的差异把「注册断」与「捕获断」分开，定位到此行。
        //
        // 读路径与 dsh-agent-loop 自身的用法一致：dsh-agent-loop/lib/index.js
        // 的 eventsNewestFirst() 即 `session.snapshotEvents().toReversed()`。
        // （原注释称「session.events.findLast(...)」，该写法在 DSH 中不存在，
        // 是引入时的失实依据；此处一并更正为实际存在的 API。）
        //
        // 弃用边界（如实声明）：`snapshotEvents()` 与 `ownEvents()` 在
        // dsh-session 中均标注 @deprecated（「new calls are prohibited」），
        // 官方消费方（dsh-agent-loop / dsh-api-session-controller）当前仍在
        // 使用它。本处取读快照而非迁往异步通道，是因为子代理的结论捕获发生在
        // turn/end 同步回调内、且只读已提交事件；若上游移除该方法，此处须按
        // 彼时的替代入口迁移。该边界不改变本次修复的事实：原写法**从未生效**。
        stops.push(agent.ctx.on("session/event", (session, event) => {
          if (session !== agent?.session) return;
          if (event?.type !== "turn/end") return;
          try {
            const turn = event?.data?.turn;
            if (turn === undefined || turn === null) return;
            const events = readCommittedEvents(agent.session);
            if (!Array.isArray(events)) return;
            // Walk back from the end to the most recent assistant/message
            // belonging to this exact turn. Earlier turns are irrelevant and
            // must not overwrite a later conclusion with a stale one.
            for (let index = events.length - 1; index >= 0; index -= 1) {
              const entry = events[index];
              if (entry?.type !== "assistant/message") continue;
              if (entry?.data?.turn !== turn) continue;
              const blocks = entry?.data?.message?.content;
              if (!Array.isArray(blocks)) return;
              const text = blocks
                .filter((block) => block !== null && typeof block === "object" && block.type === "text")
                .map((block) => (typeof block.text === "string" ? block.text : ""))
                .join("");
              record.setConclusion(text);
              return;
            }
          } catch (error) {
            // A conclusion capture failure must never break the child turn.
            ctx.logger.warn("[dsh-ldvh] child conclusion capture failed for %s: %s", agentId, String(error?.message ?? error));
          }
        }));
      } catch (error) {
        cleanup();
        throw error;
      }
      return cleanup;
    }, `dsh-ldvh: child lifecycle ${agentId}`);

    children.set(agentId, { dispose, record });
    ctx.logger.info("[dsh-ldvh] installed child lifecycle for subagent %s (delegated state: %s)", agentId, record.scopeState ?? "none");
    return true;
  };
}
