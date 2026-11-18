
import { resolveGovernanceScope } from "./governance-scope.js";
import { createWindowAccumulator } from "./turn-accumulator.js";

function eventTurn(event) {
  const turn = event?.data?.turn;
  return typeof turn === "number" ? turn : undefined;
}



export function createTurnTriggers(agent, { getScopeState, turns, activity, log, readSilenceMs, now, registerDiagnostic }) {
  const agentId = agent?.id ?? agent?.session?.header?.id;

  function note(level, ...args) {
    try {
      log?.[level]?.(...args);
    } catch {
    }
  }

  const pendingDiagnostics = new Set();

  function trace(stage, reason, extra = {}) {
    if (typeof registerDiagnostic !== "function") return;
    try {
      const p = Promise.resolve(registerDiagnostic({
        stage,
        reason,
        session: typeof agentId === "string" && agentId.length > 0 ? agentId : null,
        turn: state.lastTurn,
        at: new Date().toISOString(),
        ...extra,
      })).catch(() => {   });
      pendingDiagnostics.add(p);
      Promise.resolve(p).finally(() => pendingDiagnostics.delete(p));
    } catch {
    }
  }

  const state = turns ?? {
    turnStoppingSeen: 0,
    turnEndSeen: 0,
    lastTurn: undefined,
    lastReflectionGate: undefined,
    lastActivityAt: null,
    silenceTimer: null,
    disposed: false,
    turnInFlight: false,
    lastIdleSeen: 0
  };

  const accumulator = createWindowAccumulator();

  function governed() {
    return getScopeState() === "governed";
  }

  function nowMs() {
    const n = typeof now === "function" ? now() : Date.now();
    return Number.isFinite(n) ? n : Date.now();
  }


  function clearSilenceTimer(reason) {
    state.silenceTimer = null;
    trace("silence-cleared", reason ?? "cleared", { timerPresent: false });
  }

  function touchActivity(nowMsInput) {
    const at = Number.isFinite(nowMsInput) ? nowMsInput : nowMs();
    state.lastActivityAt = at;
    clearSilenceTimer("activity");
  }

  function armSilenceTimer() {
  }


  return {
    onTurnStopping(payload) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return;
      state.turnStoppingSeen += 1;
      if (typeof payload?.turn === "number") state.lastTurn = payload.turn;
      state.lastReflectionGate = governed() ? "open" : "closed";


      if (state.lastReflectionGate === "open") {
        touchActivity(nowMs());
      }
      activity?.record("turn/stopping", { turn: state.lastTurn, gate: state.lastReflectionGate });
    },

    onAgentStatus(payload) {
      if (payload?.agent !== undefined && agentId !== undefined && payload.agent.id !== agentId) return;
      if (payload?.status !== "idle") return;
      if (!governed()) return;
      state.lastIdleSeen += 1;
      if (state.lastActivityAt === null) return;
      if (state.turnInFlight === true) return;
      armSilenceTimer();
    },

    onSessionEvent(session, event) {
      try {
        accumulator.observe(session, event, agent?.session);
      } catch (error) {
        log?.warn?.("[dsh-ldvh] window accumulation failed: %s", String(error?.message ?? error));
      }
      if (session === agent?.session && event?.type === "turn/start") {
        state.turnInFlight = true;
        clearSilenceTimer("turn-start");
        activity?.record("turn/start", { turn: eventTurn(event) ?? state.lastTurn });
        return;
      }
      if (session !== agent?.session || event?.type !== "turn/end") return;
      state.turnEndSeen += 1;
      state.turnInFlight = false;
      state.lastTurn = eventTurn(event) ?? state.lastTurn;
      if (governed()) {
        touchActivity(nowMs());
        armSilenceTimer();
      }
      activity?.record("turn/end", { turn: state.lastTurn });
    },

    currentTurnText(turn) {
      const target = Number.isInteger(turn) ? turn : accumulator.highestTurn();
      if (target === null || target === undefined) {
        return {
          ok: false, turn: null, assistant: "", truncated: false,
          reason: "this process has not observed any assistant message yet, so the current turn's text is unavailable (the live event stream has not reached this session)",
        };
      }
      const window = accumulator.windowFrom(target - 1);
      const item = window.items.find((entry) => entry.turn === target);
      return {
        ok: true,
        turn: target,
        assistant: typeof item?.assistant === "string" ? item.assistant : "",
        truncated: item?.truncated === true,
      };
    },

    clearSilenceTimerForTest(reason = "test") {
      return clearSilenceTimer(reason);
    },

    dispose() {
      state.disposed = true;
      clearSilenceTimer("dispose");
      return Promise.allSettled([...pendingDiagnostics]);
    },


    restoreLastTurn(turn) {
      if (!Number.isInteger(turn) || turn < 0) return false;
      if (state.disposed === true) return false;
      if (state.lastTurn !== undefined) return false;
      state.lastTurn = turn;
      note("info", "[dsh-ldvh] last turn restored from the host session record: turn=%d", turn);
      return true;
    },

    snapshot() {
      return { ...state };
    }
  };
}

export { resolveGovernanceScope };
