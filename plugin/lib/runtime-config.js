
export function createRuntimeConfig(initial = {}) {
  let live = Object.freeze({ webEnabled: true, ...initial });
  const listeners = new Set();

  return {
    current() {
      return live;
    },
    stage(candidate) {
      if (candidate === null || typeof candidate !== "object") throw new Error("config candidate must be an object");
      const staged = Object.freeze({ ...live, ...candidate });
      return staged;
    },
    commit(staged) {
      live = staged;
      for (const listener of listeners) listener(live);
    },
    update(candidate) {
      this.commit(this.stage(candidate));
    },
    onSwap(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
