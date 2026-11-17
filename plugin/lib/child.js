// dsh-ldvh — subagent lifecycle (installChild mechanism, content empty).
//
// Mechanism mirrors mnemon's installChild (lifecycle.ts) with LDVH semantics:
//   1. identity: origin === 'subagent' takes the child path;
//   2. lineage check: parentSession id must resolve to a LIVE parent agent we
//      installed — an orphan (string lineage alone) gets NOTHING, because a
//      lineage claim is not authority (mnemon's rule);
//   3. delegation: the child INHERITS the parent's governance scope (管辖沿
//      委派链传递, 00 §4 委派不转责) — the child does not re-judge from its
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
 *
 * 2026-10-18: the window stays small precisely because it no longer has to be
 * durable — a record evicted (or lost to a plugin rebuild) is recoverable from
 * the child's own session record via adoptFinishedChild, so eviction costs a
 * re-read instead of the evidence. See child-session-record.js.
 */
const RETIRED_LIMIT = 50;

/**
 * @param {(hook: string, detail?: object) => void} [onEvent] optional
 *   registry-level observability sink: receipts for install/retire events so
 *   the "when was the table touched" question is answerable at runtime
 *   without the console (2026-10-18 子代理登记表被清空 修复, 步骤 1).
 */
/**
 * @param {object} ctx
 * @param {object} deps
 * @param {Function} [deps.registerChildSurface] - 经验面（开工授权绑定成功后才调）。
 * @param {Function} [deps.registerFrictionChildSurface] - 摩擦面（受辖分身一律调，
 *   不需要授权——它是主控的一次性交派动作，见下方注册处的边界注释）。
 * @param {object} [deps.frictionChildDeps] - 摩擦面的依赖：`{ dshHomePath,
 *   resolveProjectId(agent), isFrictionDiscoveryEnabled() }`。由 lifecycle 注入，
 *   本文件不认识治理解析模块。`isFrictionDiscoveryEnabled` 每次现读设置面开关。
 */
export function createChildInstaller(ctx, { agents, children, sessionScopes, retiredChildren, onEvent, experienceArming, registerChildSurface, registerFrictionChildSurface, frictionChildDeps }) {
  const emit = (hook, detail) => {
    if (typeof onEvent === "function") onEvent(hook, detail ?? {});
  };
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
        if (retiredChildren !== undefined) {
          retireChildRecord({ retiredChildren, record, emit, source: "live" });
        }
        emit("child/clear", { agentId });
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
        // ── 经验记录分身的能力面（Human 决定 2026-11-16，23 §13 代理记录通道）────
        //
        // 「委派链上的子代理不注册任何工具」这条例外**只在一条路径上**开：该分身
        // 被一条开工授权绑定上了。授权必须来自受管辖的根会话（`ldvh_pitfall_arm_delegate`
        // 侧拒绝分身自记），且绑定时判**父会话 + 项目**两项一致（审核 B5：注册按父级
        // 继承判定、写入按子级 cwd 自判，不核对项目就会把经验写进另一个受辖项目）。
        //
        // 三条机械纪律在此的落点：
        //   · 一次性 —— bindForChild 命中即占用，同父的下一个分身不再命中；
        //   · 会过期 —— 授权账按 ttl 判过期；工具虽仍在该分身会话内，写入侧
        //     （executeWriteObject）每次调用都复核，过期即拒；
        //   · 落盘 —— 绑定结果写授权账，插件重建后同一分身可复原，别的不能。
        //
        // 注册挂在**子代理自己的 ctx.effect** 上（stops 内），故其 fiber 释放即撤销，
        // 不残留在其他会话面上。若图省事注册到插件根 ctx，才是真泄漏（全局注册不随
        // 任何子会话结束而撤销）。
        if (experienceArming !== undefined && typeof registerChildSurface === "function") {
          const parentProjectPath = parentRecord?.lastScope?.project?.path;
          const binding = experienceArming.bindForChild({
            parentSessionId: parentId,
            childSessionId: agentId,
            ...(typeof parentProjectPath === "string" && parentProjectPath.length > 0 ? { projectPath: parentProjectPath } : {})
          });
          if (binding.ok) {
            try {
              const disposeSurface = registerChildSurface(agent);
              if (typeof disposeSurface === "function") stops.push(disposeSurface);
              emit("child/experience-armed", {
                agentId,
                parentId: parentId ?? null,
                armingId: binding.value.arming.arming_id,
                rebinding: binding.value.rebinding === true
              });
              ctx.logger.info("[dsh-ldvh] experience delegate armed for child %s (arming %s%s)",
                agentId, binding.value.arming.arming_id, binding.value.rebinding ? ", rebinding after plugin reload" : "");
            } catch (error) {
              // 注册失败必须留痕且**不回滚授权**：授权账上这条已绑定，分身会带着
              // 工具面缺失的状态跑完一次。静默吞掉会让「为什么这次没写进去」变成
              // 无解问题（friction-277d7479 同一失效族：提示与真实能力不一致）。
              ctx.logger.warn("[dsh-ldvh] experience surface registration failed for child %s: %s", agentId, String(error?.message ?? error));
              emit("child/experience-arm-failed", { agentId, reason: String(error?.message ?? error) });
            }
          }
        }
        // ── 摩擦记录分身的能力面（2026-11-17，00 §4.5 代理辅助任务）──────────
        //
        // **第二个例外，与上面那条不同源**：经验侧靠「开工授权」把工具面交给分身，
        // 摩擦侧**不需要授权**——它不是长期可用的记录权，而是一次性的交派动作：
        // 主控当次发现了阻碍，派一个分身去写一条观察，写完即结束。
        //
        // 为什么不复用授权机制：授权账的语义是「这个分身被允许记录经验」（可过期、
        // 一次性、落盘）。摩擦观察是**主控交派的即时动作**，没有「以后还能不能用」
        // 这个维度；套上授权只会让主控每记一次摩擦都要先记一笔授权，成本与收益倒挂。
        //
        // 边界（不能放松）：
        //   · 只给 `ldvh_friction_record_observation` 一个工具，**不给账目读写**——
        //     账目写入要 Human 确认且绕过阈值（26 §16 第 1 项），分身绝不能有；
        //   · 不写 Pitfall、不读事实源其它对象（各面的注册互相独立）；
        //   · 该面**只在本分身受管辖时**注册（`record.scopeState === "governed"`）——
        //     非受辖项目的分身记摩擦没有意义（缓冲按项目分区，没有分区就无处落）。
        if (typeof registerFrictionChildSurface === "function" && record.scopeState === "governed") {
          try {
            const disposeFriction = registerFrictionChildSurface(agent.ctx, {
              dshHomePath: frictionChildDeps?.dshHomePath,
              resolveProjectId: () => frictionChildDeps?.resolveProjectId?.(agent) ?? null,
              resolveSessionId: () => agentId ?? null,
              // 晋升建账要署名（11 §9 第 3／4 项的机械收尾）。取宿主会话持久化服务，
              // 与根面同一来源；缺失时晋升侧按 signature-unavailable 如实登记，不伪造。
              sessionPersistence: frictionChildDeps?.sessionPersistence,
              // 设置面「发现摩擦」开关：每次现读（传函数不传值），关闭时工具在
              // 写缓冲前即拒绝。缺省不传时工具按启用处理。
              isFrictionDiscoveryEnabled: frictionChildDeps?.isFrictionDiscoveryEnabled
            });
            if (typeof disposeFriction === "function") stops.push(disposeFriction);
          } catch (error) {
            // 与经验面同一纪律：注册失败留痕、不回滚。静默吞掉会让「为什么这次没
            // 写进去」变成无解问题（friction-277d7479 同一失效族）。
            ctx.logger.warn("[dsh-ldvh] friction surface registration failed for child %s: %s", agentId, String(error?.message ?? error));
            emit("child/friction-surface-failed", { agentId, reason: String(error?.message ?? error) });
          }
        }
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
        // which is what triggers.js already uses.
        //
        // 实现方式（2026-09-26 第二次修订）：**在事件回调内累积**，不读会话日志。
        //  - 遇 `assistant/message` → 记下 { turn, text }
        //  - 遇 `turn/end`          → 若记下的 turn 与之相符，以其文本作结论
        //
        // 为什么不回读会话日志：DSH 的 Session **没有 `events` 属性**（原实现读它，
        // 故恒为 undefined、结论从未被捕获）；而它提供的读取方法
        // `snapshotEvents()`/`ownEvents()`/`eventAt()` **均已弃用**，其
        // README.zh.md「读取日志」节明文写「现有逻辑可以暂不迁移，但**禁止新增
        // 生产调用**」。首版修复曾改用 `snapshotEvents()`（使缺陷停止），但那是
        // 一个**新增生产调用**，违反该禁令——由独立复核实测指出。本版改为监听
        // 已发布的事件流，不触碰任何弃用读取入口。
        //
        // 依赖与时序（如实声明）：
        //  - 依赖「同轮的 `assistant/message` 先于 `turn/end` 发布」。已用真实子
        //    代理会话日志核实（每轮 turn/end 之前均已有同轮 assistant/message）。
        //  - 本监听器在 installChild（`agent/created`）时注册，即子代理生命周期
        //    起点；注册前的事件不会到达。与「回读历史快照」相比这是**范围收窄**：
        //    只捕获本监听器注册之后发布的轮次。对本用途（子代理创建即安装）覆盖
        //    其全部轮次；若未来在已运行会话上事后安装，则更早的轮次不可见。
        //  - 只保留**最近一轮**的文本：更早轮次不得覆盖更新的结论。
        let pendingTurn = null;
        let pendingText = null;
        stops.push(agent.ctx.on("session/event", (session, event) => {
          if (session !== agent?.session) return;
          try {
            if (event?.type === "assistant/message") {
              const turn = event?.data?.turn;
              if (turn === undefined || turn === null) return;
              const blocks = event?.data?.message?.content;
              if (!Array.isArray(blocks)) return;
              pendingTurn = turn;
              pendingText = blocks
                .filter((block) => block !== null && typeof block === "object" && block.type === "text")
                .map((block) => (typeof block.text === "string" ? block.text : ""))
                .join("");
              return;
            }
            if (event?.type !== "turn/end") return;
            const turn = event?.data?.turn;
            if (turn === undefined || turn === null) return;
            // 没有对应轮的 assistant/message（例如仅工具调用的轮次）→ 不更新，
            // 保留上一次的真实结论；不得用空值清掉既有数据。
            if (pendingTurn !== turn) return;
            record.setConclusion(pendingText ?? "");
            pendingTurn = null;
            pendingText = null;
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
    emit("child/register", { agentId, parentId: parentId ?? null, scopeState: record.scopeState ?? null });
    ctx.logger.info("[dsh-ldvh] installed child lifecycle for subagent %s (delegated state: %s)", agentId, record.scopeState ?? "none");
    return true;
  };
}

/**
 * Move one finished child record into the bounded retired window.
 *
 * Shared policy by construction (2026-10-18 「子代理登记表被清空」 修复 · 步骤 3):
 * the live dispose path (above) and the durable hydration path
 * (`adoptFinishedChild`) must land records in the SAME window, under the same
 * FIFO bound and with the same receipts — otherwise a child recovered from its
 * own session record would behave differently from one observed live.
 *
 * Never overwrites: an id already in the window keeps the record that got there
 * first (the live observation is the stronger evidence).
 *
 * @returns {boolean} true when this call retired the record.
 */
export function retireChildRecord({ retiredChildren, record, emit, source = "live" }) {
  if (retiredChildren === undefined || record === null || typeof record !== "object") return false;
  const agentId = record.agentId;
  if (typeof agentId !== "string" || agentId.length === 0) return false;
  if (retiredChildren.has(agentId)) return false;
  record.retiredAt = new Date().toISOString();
  record.retired = true;
  record.retiredSource = source;
  retiredChildren.set(agentId, { record });
  emit("child/retire", { agentId, retiredAt: record.retiredAt, source });
  while (retiredChildren.size > RETIRED_LIMIT) {
    const oldest = retiredChildren.keys().next().value;
    retiredChildren.delete(oldest);
    emit("child/evict", { agentId: oldest });
  }
  return true;
}

/**
 * Rebuild a finished child's record from its authoritative session header
 * (lib/child-session-record.js did the reading and the lineage check).
 *
 * The record is marked `hydrated` so a consumer can tell「宿主亲观测到的子代理」
 * from「登记表重建后按其会话记录复原的子代理」 — the identity and the conclusion
 * both come from the host's own log, but they were read after the fact rather
 * than captured live. `startedAt` is back-dated to the header's `createdAt` so a
 * hydrated record does not claim to have started at hydration time.
 *
 * @returns {object|null} the record now in the retired window, or null.
 */
export function adoptFinishedChild({ retiredChildren, header, conclusion, emit = () => {}, source = "session-record" }) {
  const sessionId = typeof header?.id === "string" ? header.id : null;
  if (sessionId === null) return null;
  const record = new DelegatedChildRecord({ id: sessionId, session: { header } }, header?.parentSession ?? null);
  if (typeof header?.createdAt === "number") {
    const startedAt = new Date(header.createdAt);
    if (!Number.isNaN(startedAt.getTime())) record.startedAt = startedAt.toISOString();
  }
  record.retired = true;
  record.retiredSource = source;
  record.hydrated = true;
  record.hydratedAt = new Date().toISOString();
  if (typeof conclusion === "string" && conclusion.length > 0) record.setConclusion(conclusion);
  retireChildRecord({ retiredChildren, record, emit, source });
  return retiredChildren.get(sessionId)?.record ?? null;
}
