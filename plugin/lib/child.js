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

import { guidanceTextFor } from "./guidance-text.js";

export function createChildInstaller(ctx, { agents, children, sessionScopes }) {
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
    if (parent === undefined || parent === agent) return false; // orphan: no authority

    // Delegation: inherit the parent's governed chain. The parent's lifecycle
    // record holds its current judged state; an ungoverned parent produces a
    // child that stays equally quiet (zero-interference along the chain).
    const parentRecord = agents.get(parentId ?? parent?.id ?? parent?.session?.header?.id);
    const delegatedScopeState = parentRecord?.scopeState ?? null;

    const record = { scopeState: delegatedScopeState };

    const dispose = agent.ctx.effect(() => {
      const stops = [];
      const cleanup = () => {
        for (const stop of stops.reverse()) {
          try { stop(); } catch { /* already removed */ }
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
        stops.push(agent.ctx.on("agent/session-start", () => {
          // Refresh the delegated state if the parent's judgement moved.
          record.scopeState = agents.get(parentId ?? parent?.id ?? parent?.session?.header?.id)?.scopeState ?? record.scopeState;
        }));
      } catch (error) {
        cleanup();
        throw error;
      }
      return cleanup;
    }, `dsh-ldvh: child lifecycle ${agentId}`);

    children.set(agentId, { dispose, record });
    ctx.logger.info("[dsh-ldvh] installed child lifecycle for subagent %s (delegated state: %s)", agentId, delegatedScopeState ?? "none");
    return true;
  };
}
