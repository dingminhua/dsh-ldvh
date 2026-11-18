
function archivedSet(workspaceRegistry) {
  try {
    const ids = workspaceRegistry?.archivedSessionIds;
    if (!Array.isArray(ids)) return null;
    return new Set(ids);
  } catch {
    return null;
  }
}

function lineageArchived({ sessions, archived, sessionId }) {
  let id = sessionId;
  const visited = new Set();
  let via = null;
  while (typeof id === "string" && id.length > 0 && !visited.has(id)) {
    if (archived.has(id)) return { archived: true, via };
    visited.add(id);
    let header;
    try {
      header = sessions?.get?.(id)?.header;
    } catch {
      header = undefined;
    }
    if (header === undefined || header === null) {
      return { archived: false, via };
    }
    if (header.origin !== "subagent" || header.parentSession === undefined) {
      return { archived: false, via };
    }
    via = header.parentSession;
    id = header.parentSession;
  }
  return { archived: false, via };
}

export function isUnderArchivedLineage({ workspaceRegistry, sessions, sessionId }) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { archived: false, checked: false, reason: "session-id-unavailable", via: null };
  }
  const archived = archivedSet(workspaceRegistry);
  if (archived === null) {
    return { archived: false, checked: false, reason: "archive-set-unavailable", via: null };
  }
  const result = lineageArchived({ sessions, archived, sessionId });
  return { archived: result.archived, checked: true, reason: null, via: result.via };
}

export function resolveArchiveServices(ctx) {
  const pick = (name) => {
    try {
      return ctx?.get?.(name) ?? null;
    } catch {
      return null;
    }
  };
  return { workspaceRegistry: pick("workspaceRegistry"), sessions: pick("sessions") };
}
