
export function registerLdvhRpc(connection, { lifecycle }) {
  if (typeof connection?.handle !== "function") return () => {};
  const disposers = [];
  if (typeof connection.handle === "function") {
    disposers.push(connection.handle("ldvh/lifecycle-snapshots", () => lifecycle.snapshots()));
  }
  if (typeof connection.handle === "function" && typeof lifecycle.childSnapshots === "function") {
    disposers.push(connection.handle("ldvh/child-snapshots", () => lifecycle.childSnapshots()));
  }
  if (typeof connection.handle === "function" && typeof lifecycle.childActivityOf === "function") {
    disposers.push(connection.handle("ldvh/child-activity", (childId) => lifecycle.childActivityOf(childId) ?? null));
  }
  if (typeof connection.handle === "function" && typeof lifecycle.childConclusionOf === "function") {
    disposers.push(connection.handle("ldvh/child-conclusion", (childId) => lifecycle.childConclusionOf(childId)));
  }
  return () => {
    for (const dispose of disposers.reverse()) {
      try { dispose?.(); } catch {   }
    }
  };
}

export function registerLdvhCommands(commands) {
  if (typeof commands?.register !== "function") return () => {};
  return () => {};
}
