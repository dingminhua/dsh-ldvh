
export function createSessionScopes() {
  const scopes = new Map();

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
