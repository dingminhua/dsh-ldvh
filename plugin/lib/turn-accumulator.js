
const MAX_CHARS_PER_TURN = 20000;

const MAX_TURNS_RETAINED = 200;

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block !== null && typeof block === "object" && block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("")
    .trim();
}

export function createWindowAccumulator({ maxCharsPerTurn = MAX_CHARS_PER_TURN, maxTurns = MAX_TURNS_RETAINED } = {}) {
  const turns = new Map();
  let pendingUser = null;
  let firstObservedTurn = null;

  function record(turn, patch) {
    const existing = turns.get(turn) ?? { turn, user: "", assistant: "", truncated: false };
    const merged = { ...existing, ...patch };
    turns.set(turn, merged);
    if (firstObservedTurn === null || turn < firstObservedTurn) firstObservedTurn = turn;
    while (turns.size > maxTurns) {
      const oldest = turns.keys().next().value;
      turns.delete(oldest);
    }
  }

  function clamp(text) {
    if (typeof text !== "string") return { text: "", truncated: false };
    if (text.length <= maxCharsPerTurn) return { text, truncated: false };
    return { text: text.slice(0, maxCharsPerTurn), truncated: true };
  }

  return {
    observe(session, event, expectedSession) {
      if (expectedSession !== undefined && session !== expectedSession) return;
      const type = event?.type;
      const turn = event?.data?.turn;

      if (type === "user/message") {
        pendingUser = textOfBlocks(event?.data?.content);
        return;
      }

      if (type === "assistant/message") {
        if (turn === undefined || turn === null) return;

        const text = textOfBlocks(event?.data?.message?.content);
        const previous = turns.get(turn)?.assistant ?? "";
        const merged = text.length === 0
          ? previous
          : previous.length === 0
            ? text
            : `${previous}\n\n${text}`;
        const { text: clipped, truncated } = clamp(merged);

        const patch = { assistant: clipped, truncated };
        if (pendingUser !== null) {
          const userPart = clamp(pendingUser);
          patch.user = userPart.text;
          patch.truncated = patch.truncated || userPart.truncated;
          pendingUser = null;
        }
        record(turn, patch);
        return;
      }

      if (type === "turn/start") {
        if (turn === undefined || turn === null) return;
        if (pendingUser !== null) {
          const { text: clipped, truncated } = clamp(pendingUser);
          record(turn, { user: clipped, truncated });
          pendingUser = null;
        }
        return;
      }

    },

    windowFrom(afterTurn) {
      const floor = Number.isInteger(afterTurn) ? afterTurn : -1;
      const items = [...turns.values()]
        .filter((entry) => entry.turn > floor)
        .sort((a, b) => a.turn - b.turn);

      const gapStart = floor >= 0 ? floor + 1 : null;
      let unobserved = null;
      if (gapStart !== null) {
        if (firstObservedTurn === null) {
          unobserved = { from: gapStart, to: null };
        } else if (gapStart < firstObservedTurn) {
          unobserved = { from: gapStart, to: firstObservedTurn - 1 };
        }
      }
      if (gapStart !== null && items.length > 0 && unobserved === null) {
        const lowestInItems = items[0].turn;
        if (gapStart < lowestInItems) unobserved = { from: gapStart, to: lowestInItems - 1 };
      }

      return {
        items,
        truncated: items.some((entry) => entry.truncated === true),
        unobserved,
      };
    },

    firstObservedTurn() {
      return firstObservedTurn;
    },

    highestTurn() {
      let max = null;
      for (const turn of turns.keys()) if (max === null || turn > max) max = turn;
      return max;
    },

    reset() {
      turns.clear();
      pendingUser = null;
      firstObservedTurn = null;
    },

    snapshot() {
      return { turns: turns.size, pendingUser: pendingUser !== null, firstObservedTurn };
    },
  };
}
