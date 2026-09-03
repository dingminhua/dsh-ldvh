// dsh-ldvh — session event-stream consumption (mnemon openAgentTurn /
// recordTurnMessages shape; SKELETON, content for the reflection batch).
//
// mnemon treats the durable session event log as a data SOURCE: it scans
// turn/start→turn/end to find the open turn, archives messages per turn, and
// counts tool calls from tool/call events. LDVH's reflection dimension
// (八维·反思) will need exactly these primitives ("user corrected the AI"
// is a message-pattern recognition over turn events). The primitives are
// mounted now so the reflection batch reads from here instead of re-learning
// the event shapes.

/** The currently open turn id, or undefined (mnemon openAgentTurn shape). */
export function openTurn(events) {
  let open;
  for (const event of events ?? []) {
    const turn = typeof event?.data?.turn === "number" ? event.data.turn : undefined;
    if (event.type === "turn/start" && turn !== undefined) open = turn;
    else if (event.type === "turn/end" && turn === open) open = undefined;
  }
  return open;
}

/** Count tool/call events within one turn (reflection signal input). */
export function turnToolCalls(events, turn) {
  let count = 0;
  const names = new Set();
  for (const event of events ?? []) {
    if (event?.type !== "tool/call") continue;
    if (turn !== undefined && event?.data?.turn !== turn) continue;
    count += 1;
    const name = event?.data?.name ?? event?.data?.tool;
    if (typeof name === "string") names.add(name);
  }
  return { count, names: [...names] };
}

/** Extract plain text of user messages within one turn (reflection signal). */
export function turnUserTexts(events, turn) {
  const texts = [];
  for (const event of events ?? []) {
    if (event?.type !== "message" || event?.data?.role !== "user") continue;
    if (turn !== undefined && event?.data?.turn !== turn) continue;
    const parts = event?.data?.content;
    if (!Array.isArray(parts)) continue;
    const text = parts.filter((part) => part?.type === "text").map((part) => part.text).join("\n").trim();
    if (text !== "") texts.push(text);
  }
  return texts;
}
