// dsh-ldvh — RPC and command surface (mnemon rpc.ts/commands.ts shape;
// SKELETON, handlers are placeholders).
//
// Mounted through ctx.inject(["connection"]) so it exists only in Web
// compositions (like the webServer soft mount). The surface is where future
// Web panels (LDVH view, lifecycle snapshots, enumeration display) and slash
// commands will hang — the channels are registered now, content handlers
// deliberately return "not implemented" markers.
//
// mnemon parity notes:
//   - registerRpc on the connection channel (Web client <-> Host);
//   - registerCommands for slash commands (ctx.commands service).

export function registerLdvhRpc(connection, { lifecycle }) {
  if (typeof connection?.handle !== "function") return () => {};
  const disposers = [];
  // Lifecycle snapshot channel (REAL, read-only): the Web side can already
  // inspect per-agent LDVH state once a view exists.
  if (typeof connection.handle === "function") {
    disposers.push(connection.handle("ldvh/lifecycle-snapshots", () => lifecycle.snapshots()));
  }
  // Delegated child channels (2026-09-04, REAL, read-only): the root-only
  // snapshots() above cannot see children (children live in a separate Map),
  // so the delegation chain needs its own channels. Guarded by typeof checks
  // because older lifecycle seams/tests may not expose them yet.
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
      try { dispose?.(); } catch { /* already removed */ }
    }
  };
}

export function registerLdvhCommands(commands) {
  if (typeof commands?.register !== "function") return () => {};
  // Slash-command seam (placeholder): no commands registered this batch —
  // the registry call shape is verified by tests, content lands with the
  // command batch.
  return () => {};
}
