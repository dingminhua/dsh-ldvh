// dsh-ldvh — runtime configuration with validate+swap (mnemon live-runtime
// shape, content minimal).
//
// mnemon's pattern: on settings validate, build a COMPLETE candidate graph
// off to the side; on commit, swap it in atomically — a failed candidate
// never disturbs the live one. LDVH has one switch today (webEnabled), so the
// "graph" is small, but the PATTERN is mounted now so future settings
// (injection budgets, enumeration caps, reflection toggles) land in an
// already-working swap mechanism instead of hand-written partial syncs.

export function createRuntimeConfig(initial = {}) {
  let live = Object.freeze({ webEnabled: true, ...initial });
  const listeners = new Set();

  return {
    /** Current immutable config. */
    current() {
      return live;
    },
    /**
     * Validate-and-stage: build the candidate fully. Throws on invalid input
     * (the live config is untouched — validate never disturbs live).
     */
    stage(candidate) {
      if (candidate === null || typeof candidate !== "object") throw new Error("config candidate must be an object");
      const staged = Object.freeze({ ...live, ...candidate });
      return staged;
    },
    /** Commit a staged candidate atomically; notifies listeners after swap. */
    commit(staged) {
      live = staged;
      for (const listener of listeners) listener(live);
    },
    /** Validate + commit in one step (settings onChange path). */
    update(candidate) {
      this.commit(this.stage(candidate));
    },
    onSwap(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
