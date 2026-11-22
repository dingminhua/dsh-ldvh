
import { guidanceTextFor, resolveGuidanceMode } from "./guidance-text.js";
import { DelegatedChildRecord } from "./agent-lifecycle.js";

const RETIRED_LIMIT = 50;

export function createChildInstaller(ctx, { agents, children, sessionScopes, retiredChildren, onEvent, experienceArming, registerChildSurface, registerFrictionChildSurface, frictionChildDeps }) {
  const emit = (hook, detail) => {
    if (typeof onEvent === "function") onEvent(hook, detail ?? {});
  };
  return function installChild(agent) {
    const agentId = agent?.id ?? agent?.session?.header?.id;
    if (typeof agentId !== "string" || children.has(agentId)) return false;

    const parentId = agent?.session?.header?.parentSession?.trim();
    const agentsService = ctx.get("agents");
    const parent = parentId === undefined || parentId === "" || agentsService === undefined
      ? undefined
      : agentsService.get(parentId);
    ctx.logger.info(
      "[dsh-ldvh] installChild probe: agent=%s origin=%s parentSession=%s parentLookup=%s ourAgentsHasParent=%s ourAgentsHasSelf=%s",
      agentId,
      agent?.session?.header?.origin ?? "<none>",
      parentId ?? "<none>",
      parent === undefined ? "MISS" : "HIT",
      typeof parentId === "string" ? String(agents.has(parentId)) : "<n/a>",
      agents.has(agentId) ? "yes(should-not-happen)" : "no"
    );
    if (parent === undefined || parent === agent) return false;

    const parentRecord = agents.get(parentId ?? parent?.id ?? parent?.session?.header?.id);

    const record = new DelegatedChildRecord(agent, parentId ?? null);
    record.applyParentScope(parentRecord?.scopeState ?? null, { source: "install" });

    const dispose = agent.ctx.effect(() => {
      const stops = [];
      const cleanup = () => {
        for (const stop of stops.reverse()) {
          try { stop(); } catch {   }
        }
        if (retiredChildren !== undefined) {
          retireChildRecord({ retiredChildren, record, emit, source: "live" });
        }
        emit("child/clear", { agentId });
        children.delete(agentId);
      };
      try {
        stops.push(agent.ctx.on("system-prompt/assemble", async (assembly, context, next) => {
          if (context?.agent === undefined || context.agent.id !== agentId) return next();
          if (context.signal?.aborted === true) return next();

          const mode = await resolveGuidanceMode(parentRecord?.lastScope?.project?.path);
          const text = guidanceTextFor(record.scopeState ?? "not_governed", mode);
          return next().then((assembled) => {
            const sections = (assembled.sections ?? []).filter((section) => section.name !== "ldvh:minimal-guidance");
            if (text !== "") sections.push({ name: "ldvh:minimal-guidance", text });
            return { ...assembled, sections };
          });
        }));
        stops.push(agent.ctx.on("agent/pre-step", (payload, next) => next()));
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
              ctx.logger.warn("[dsh-ldvh] experience surface registration failed for child %s: %s", agentId, String(error?.message ?? error));
              emit("child/experience-arm-failed", { agentId, reason: String(error?.message ?? error) });
            }
          }
        }
        if (typeof registerFrictionChildSurface === "function" && record.scopeState === "governed") {
          try {
            const disposeFriction = registerFrictionChildSurface(agent.ctx, {
              dshHomePath: frictionChildDeps?.dshHomePath,
              resolveProjectId: () => frictionChildDeps?.resolveProjectId?.(agent) ?? null,
              resolveSessionId: () => agentId ?? null,
              sessionPersistence: frictionChildDeps?.sessionPersistence,
              isFrictionDiscoveryEnabled: frictionChildDeps?.isFrictionDiscoveryEnabled
            });
            if (typeof disposeFriction === "function") stops.push(disposeFriction);
          } catch (error) {
            ctx.logger.warn("[dsh-ldvh] friction surface registration failed for child %s: %s", agentId, String(error?.message ?? error));
            emit("child/friction-surface-failed", { agentId, reason: String(error?.message ?? error) });
          }
        }
        const refreshDelegatedState = (source) => {
          record.applyParentScope(
            agents.get(parentId ?? parent?.id ?? parent?.session?.header?.id)?.scopeState ?? null,
            { source }
          );
        };
        refreshDelegatedState("agent-created");
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
            if (pendingTurn !== turn) return;
            record.setConclusion(pendingText ?? "");
            pendingTurn = null;
            pendingText = null;
          } catch (error) {
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
