
const MAX_ANCESTOR_HOPS = 4;

export async function resolveChildFromSessionRecord({
  sessionPersistence,
  childId,
  parentSessionId,
  maxAncestors = MAX_ANCESTOR_HOPS
} = {}) {
  if (typeof childId !== "string" || childId.trim().length === 0) {
    return { ok: false, reason: "no child session id was supplied" };
  }
  if (sessionPersistence === undefined || sessionPersistence === null
      || typeof sessionPersistence.open !== "function") {
    return {
      ok: false,
      reason: "the host persistence backend does not expose open(id, \"read\"), so the child's session record "
        + "cannot be read; the child registry is the only available source for this deployment"
    };
  }
  const cited = await readSessionEvents(sessionPersistence, childId);
  if (cited.ok !== true) {
    return { ok: false, reason: `child session ${childId} unreadable: ${cited.reason}` };
  }
  const header = cited.header
    ?? cited.events.find((event) => event?.type === "session")
    ?? null;
  if (header === null) {
    return { ok: false, reason: `child session ${childId} carries no session header` };
  }
  if (header.origin !== "subagent") {
    return {
      ok: false,
      reason: `session ${childId} was not created as a subagent (origin: ${JSON.stringify(header.origin ?? null)}) — `
        + "独立复核只承认受管辖隔离子代理（04 §7.3），一个普通会话不能充当复核者"
    };
  }
  let ancestry = [];
  if (typeof parentSessionId === "string" && parentSessionId.trim().length > 0) {
    const lineage = await isDescendantOf({
      sessionPersistence,
      header,
      ancestorId: parentSessionId.trim(),
      maxAncestors
    });
    if (lineage.ok !== true) return { ok: false, reason: lineage.reason };
    ancestry = lineage.chain;
  }
  return { ok: true, header, conclusion: lastChildText(cited.events), ancestry };
}

async function readSessionEvents(sessionPersistence, sessionId) {
  let handle;
  try {
    handle = await sessionPersistence.open(sessionId, "read");
  } catch (error) {
    return { ok: false, reason: `host open() failed: ${String(error?.message ?? error)}` };
  }
  try {
    const result = await handle?.read?.();
    const events = result?.events;
    if (!Array.isArray(events)) return { ok: false, reason: "host read() returned no events array" };
    const header = handle?.header !== null && typeof handle?.header === "object" ? handle.header : null;
    return { ok: true, events, header };
  } catch (error) {
    return { ok: false, reason: `host read() failed: ${String(error?.message ?? error)}` };
  } finally {
    try {
      await handle?.close?.();
    } catch {
    }
  }
}

async function isDescendantOf({ sessionPersistence, header, ancestorId, maxAncestors }) {
  const chain = [];
  let current = header;
  const hops = Number.isInteger(maxAncestors) && maxAncestors >= 1 ? maxAncestors : MAX_ANCESTOR_HOPS;
  for (let hop = 0; hop < hops; hop += 1) {
    const parentId = typeof current?.parentSession === "string" ? current.parentSession.trim() : "";
    if (parentId.length === 0) {
      return {
        ok: false,
        reason: `delegation lineage does not reach ${ancestorId}: session ${JSON.stringify(current?.id ?? null)} `
          + `has no parentSession${chain.length > 0 ? ` (chain: ${chain.join(" → ")})` : ""}`
      };
    }
    chain.push(parentId);
    if (parentId === ancestorId) return { ok: true, chain };
    const parentRead = await readSessionEvents(sessionPersistence, parentId);
    if (parentRead.ok !== true) {
      return {
        ok: false,
        reason: `delegation lineage does not reach ${ancestorId}: ancestor ${parentId} unreadable `
          + `(${parentRead.reason}; chain: ${chain.join(" → ")})`
      };
    }
    current = parentRead.events.find((event) => event?.type === "session") ?? null;
    if (current === null) {
      return {
        ok: false,
        reason: `delegation lineage does not reach ${ancestorId}: ancestor ${parentId} carries no session header `
          + `(chain: ${chain.join(" → ")})`
      };
    }
  }
  return {
    ok: false,
    reason: `delegation lineage does not reach ${ancestorId} within ${hops} hop(s) (chain: ${chain.join(" → ")})`
  };
}

function lastChildText(events) {
  let best = null;
  events.forEach((event, index) => {
    if (event?.type !== "assistant/message") return;
    const data = event?.data;
    if (data?.turn === undefined || data?.turn === null) return;
    const blocks = data?.message?.content;
    if (!Array.isArray(blocks)) return;
    const text = blocks
      .filter((block) => block !== null && typeof block === "object" && block.type === "text")
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("");
    if (text.trim().length === 0) return;
    const order = typeof event.seq === "number" ? event.seq : index;
    if (best === null || order > best.order) best = { order, text };
  });
  return best === null ? "" : best.text;
}
