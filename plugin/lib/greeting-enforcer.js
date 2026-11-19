
import { GREETING_TEXT } from "./greeting-text.js";

export const GREETING_PREFIX_ENFORCER_ID = "greeting-prefix";

const DECIDE_AFTER_CHARS = GREETING_TEXT.length + 4;

export function createGreetingEnforcer({ sessionScopes, projectCarriesNorm, logger = null } = {}) {
  const stats = { mounted: false, streamsSeen: 0, injected: 0, skipped: {} };
  const noteSkip = (reason) => { stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1; };
  const turnDone = new Map();

  function install(ctx) {
    const stops = [];
    stops.push(ctx.on("agent/inbox/inserted", (payload) => {
      const sessionId = payload?.agent?.session?.header?.id;
      if (typeof sessionId === "string") turnDone.delete(sessionId);
    }));

    stops.push(ctx.on("llm/stream", function streamGuard(options, next) {
      return wrapStream(this, options, next);
    }));
    stats.mounted = true;
    return () => { for (const stop of stops) { try { stop(); } catch {   } } stats.mounted = false; };

    async function* wrapStream(runtime, options, next) {
      stats.streamsSeen += 1;
      const sessionId = options?.sessionId;
      if (typeof sessionId !== "string") { noteSkip("no-session-id"); yield* await next(); return; }
      const scope = sessionScopes?.get(sessionId);
      if (scope?.state !== "governed") { noteSkip("not-governed"); yield* await next(); return; }
      const projectPath = scope?.project?.path;
      if (typeof projectPath !== "string" || !(await projectCarriesNorm(projectPath))) {
        noteSkip("project-lacks-norm"); yield* await next(); return;
      }
      if (turnDone.get(sessionId) === true) { noteSkip("turn-already-assured"); yield* await next(); return; }
      if (options?.purpose !== undefined && options?.purpose !== null) { noteSkip("aux-purpose"); yield* await next(); return; }

      let upstream;
      try { upstream = await next(); } catch (error) { noteSkip("upstream-threw"); throw error; }

      let textIndex = null;
      let acc = "";
      let decided = false;
      let injecting = false;
      let blockEndRewritten = false;
      const buffered = [];

      const flushBuffered = function* () {
        for (const chunk of buffered) yield chunk;
        buffered.length = 0;
      };
      const beginInjection = function* () {
        decided = true; injecting = true;
        turnDone.set(sessionId, true);
        stats.injected += 1;
        logger?.info?.(`ldvh: greeting pre-injected (session ${sessionId.slice(0, 8)}…)`);
        if (buffered.length > 0 && buffered[0].type === "block-start") yield buffered.shift();
        yield { type: "text-delta", index: textIndex, text: `${GREETING_TEXT}\n\n` };
        yield* flushBuffered();
      };

      try {
        for await (const chunk of upstream) {
          if (decided) {
            if (injecting && !blockEndRewritten && chunk?.type === "block-end" && chunk.index === textIndex) {
              blockEndRewritten = true;
              yield { ...chunk, block: { ...chunk.block, text: `${GREETING_TEXT}\n\n${chunk.block?.text ?? acc}` } };
              continue;
            }
            yield chunk;
            continue;
          }
          if (chunk?.type === "block-start" && chunk.blockType === "text" && textIndex === null) {
            textIndex = chunk.index;
            buffered.push(chunk);
            continue;
          }
          if (textIndex !== null && chunk?.index === textIndex) {
            if (chunk.type === "text-delta") {
              acc += chunk.text ?? "";
              buffered.push(chunk);
              if (acc.trimStart().startsWith(GREETING_TEXT)) {
                decided = true;
                turnDone.set(sessionId, true);
                yield* flushBuffered();
                continue;
              }
              if (acc.length >= DECIDE_AFTER_CHARS || acc.includes("\n")) {
                yield* beginInjection();
              }
              continue;
            }
            if (chunk.type === "block-end") {
              if (acc.trimStart().startsWith(GREETING_TEXT)) {
                decided = true;
                turnDone.set(sessionId, true);
                yield* flushBuffered();
                yield chunk;
                continue;
              }
              yield* beginInjection();
              yield { ...chunk, block: { ...chunk.block, text: `${GREETING_TEXT}\n\n${chunk.block?.text ?? acc}` } };
              blockEndRewritten = true;
              continue;
            }
          }
          yield chunk;
        }
      } catch (error) {
        if (!decided) yield* flushBuffered();
        throw error;
      }
      if (!decided) yield* flushBuffered();
    }

  }

  return {
    install,
    snapshot: () => ({ mounted: stats.mounted, ...stats, greeting: GREETING_TEXT }),
  };
}
