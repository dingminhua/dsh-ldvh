// dsh-ldvh — durable resolution of a delegated child from the host's session record.
//
// Why this module exists (2026-10-18 「子代理登记表被清空」 修复 · 步骤 3):
//
// lib/lifecycle.js keeps live children in `children` and finished ones in
// `retiredChildren`. Both are per-plugin-instance Maps: a plugin rebuild
// (dispose → start) builds new ones, and start() can only re-adopt what the host
// still lists as live agents. A child that has ALREADY FINISHED is gone from the
// host's agent service, so the rebuilt registry cannot see it at all — and that
// is precisely the state the review channel needs ("the reviewer finished its
// turn, now record its conclusion": workcase-tools record_review / record_audit).
// Measured live on workcase-996e207a: five isolated reviewers (4dfcc7e9 /
// 7b598299 / 47ef943e / 230fe389 / 61ae6b21) each ended in "is not a subagent
// registered under this session", while ldvh_collect_subagent_results reported
// zero records.
//
// The durable reader is the authority the rest of this plugin already trusts for
// Code-observed session identity (lib/session-signature.js head note): the
// child's OWN session record. Nothing here is inferred or fabricated —
//
//   * the header the host wrote (`origin: "subagent"`) establishes that this
//     session was created as a delegated subagent, not an ordinary session;
//   * `parentSession` + `delegationDepth` establish the delegation lineage, so a
//     session from an unrelated conversation cannot be cited as this caller's
//     reviewer;
//   * the child's own last text-bearing assistant message is its conclusion,
//     under the same rule the live capture uses (lib/child.js session/event
//     handling: a text-less turn never clears an earlier real product).
//
// Disclosure boundary: this module reports「读不到」as a reason, never as a
// silent fallback to something weaker (00 §5.6 据实声明). The RegExp-free,
// host-handle-only read keeps `session-signature.js`'s 入口优先级 discipline:
// the host's own `open(id, "read")` is the authority; a backend that does not
// expose it fails closed with a reason the caller can report to Human.

/** How many parent hops to walk when establishing the delegation lineage. */
const MAX_ANCESTOR_HOPS = 4;

/**
 * Resolve one delegated child from its authoritative session record.
 *
 * @param {object} input
 * @param {object} input.sessionPersistence DSH service (ctx.get("sessionPersistence")).
 * @param {string} input.childId the cited agent/session id.
 * @param {string} [input.parentSessionId] the calling session id. When given, the
 *   cited session must be a descendant of it (any depth up to MAX_ANCESTOR_HOPS);
 *   when omitted, only「是子代理」is established, not「是谁的子代理」.
 * @param {number} [input.maxAncestors] lineage depth bound (tests inject small values).
 * @returns {Promise<{ok: true, header: object, conclusion: string, ancestry: string[]}
 *   | {ok: false, reason: string}>}
 */
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
  const header = cited.events.find((event) => event?.type === "session") ?? null;
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

/**
 * Read one session's events through the host's own read entry.
 * Mirrors session-signature.js readRouteEventsViaHandle: a real failure is
 * reported, never swallowed into a weaker source.
 */
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
    return { ok: true, events };
  } catch (error) {
    return { ok: false, reason: `host read() failed: ${String(error?.message ?? error)}` };
  } finally {
    try {
      await handle?.close?.();
    } catch {
      /* 句柄关闭失败不影响已读出的事件 */
    }
  }
}

/**
 * Walk `parentSession` upward until the caller's session id is found.
 *
 * A direct child (delegationDepth 1) matches on the first hop. Deeper nesting is
 * legal — a reviewer may itself have delegated — so the chain is walked rather
 * than compared once; each ancestor costs one session read, which is why the
 * walk is bounded and only ever runs on the miss path.
 */
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

/**
 * The child's own final prose.
 *
 * Same rule as the live capture in child.js: only `assistant/message` events
 * carrying a real turn count, and a text-less message never clears an earlier
 * real product (「不得用空值清掉既有数据」). Ordering uses the log's own `seq`
 * when present so the result does not depend on the backend's event ordering.
 */
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
