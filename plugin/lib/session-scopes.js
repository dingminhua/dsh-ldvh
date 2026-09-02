// dsh-ldvh — sessionId → governance scope table.
//
// Single owner for the mapping the /ldvh/state/governance endpoint and the
// Client governance indicator read from. The endpoint answers "what is this
// session's governance state?" from this table instead of re-deriving it,
// because the Client dock Slot only receives a sessionId (the session's cwd
// lives in the Client's own sessions list, which that Slot does not get).
//
// Population rules (fail-closed):
//   - Entries are written from per-agent lifecycle events (session-start and
//     the assemble waterfall). An UNKNOWN sessionId answers `unknown` — never
//     guessed into governed/not_governed (a false green mark is worse than no
//     mark).
//   - Entries are removed when the owning agent's fiber is disposed (the
//     per-agent ctx.effect cleanup), and the whole table is cleared when the
//     plugin unloads.
//
// Concurrency note (audit F/new-4): the session-start path is async — the
// agent may be disposed while the judgement is in flight. Callers must check
// `has(agentId)` (the per-agent registration map, owned by lifecycle.js)
// after every await and skip `set` when the agent is gone, so a disposed
// session can never be resurrected into the table.

export function createSessionScopes() {
  const scopes = new Map(); // sessionId -> { state, project?, detail? }

  return {
    get(sessionId) {
      return scopes.get(sessionId);
    },
    set(sessionId, scope) {
      scopes.set(sessionId, scope);
    },
    delete(sessionId) {
      scopes.delete(sessionId);
    },
    clear() {
      scopes.clear();
    },
    get size() {
      return scopes.size;
    }
  };
}
