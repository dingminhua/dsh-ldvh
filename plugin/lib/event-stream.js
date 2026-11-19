
export function openTurn(events) {
  let open;
  for (const event of events ?? []) {
    const turn = typeof event?.data?.turn === "number" ? event.data.turn : undefined;
    if (event.type === "turn/start" && turn !== undefined) open = turn;
    else if (event.type === "turn/end" && turn === open) open = undefined;
  }
  return open;
}

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
