// LDVH mechanical session-signature tail-read.
//
// Decision #29 (dev-memo 2026-09-02): commit trailers LDVH-Provider /
// LDVH-Model take their values verbatim from the LAST `model/selection` or
// `request/context` routing event of the current session's authoritative
// JSONL stream. Zero-cleaning is a hard rule: no stripping of `-vision`
// style routing-variant suffixes, no filtering for "the real current text
// route", no switching sources because a value looks stale. The last event
// IS the answer; treating a mechanical value as an anomaly to filter is AI
// semantic judgment overriding the mechanical record.
//
// Host access path (verified against DSH source, see
// docs/p0-implementation-plan.md §0): a tool execution's `exec.agent` is the
// Agent object; `ctx.get("sessionPersistence").locate(agent.session.header)`
// returns `{ kind, path }` for the jsonl backend — the same source the
// dsh-shell-env `session-persistence` contributor uses to inject
// DSH_SESSION_JSONL into shell tool executions. Reading it directly from the
// Host process avoids depending on the shell environment.

import { decompressZstdStream } from "./zstd-compat.js";
import { readFile } from "node:fs/promises";

const ROUTING_EVENT_TYPES = new Set(["model/selection", "request/context"]);

/**
 * Pure: walk parsed JSONL lines from the END and return the last routing
 * event's provider/model pair verbatim. Lines that fail to parse are skipped
 * (a torn tail write must not fabricate a signature). Returns an
 * unavailable result when no routing event exists — never a guess.
 */
export function extractRouteValuesFromLines(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof event !== "object" || event === null) continue;
    const type = event.type;
    if (typeof type !== "string" || !ROUTING_EVENT_TYPES.has(type)) continue;
    const data = event.data;
    if (typeof data !== "object" || data === null) return { ok: false, reason: `routing event "${type}" carries no data object` };
    const provider = data.provider;
    const model = data.model;
    if (typeof provider !== "string" || provider.length === 0 || typeof model !== "string" || model.length === 0) {
      return { ok: false, reason: `routing event "${type}" lacks a provider/model pair` };
    }
    return { ok: true, value: { provider, model, eventType: type } };
  }
  return { ok: false, reason: "session has no model/selection or request/context routing events" };
}

/**
 * Pure: split decompressed JSONL text into lines. The final line may be a
 * partial write in flight; a trailing fragment without a newline that fails
 * JSON.parse is naturally skipped by the extractor.
 */
export function splitJsonlLines(text) {
  return text.split("\n");
}

/**
 * Read the authoritative session log for an agent and extract the mechanical
 * signature pair. `sessionPersistence` is the DSH service (obtained via
 * ctx.get); `agent` is the tool-execution/assembly-context Agent object.
 * The path resolution is pure computation in the backend (no fs touch), so a
 * missing log surfaces as an unavailable result with the exact reason.
 */
export async function currentRouteValues(sessionPersistence, agent) {
  if (sessionPersistence === undefined || sessionPersistence === null) return { ok: false, reason: "sessionPersistence service is unavailable" };
  if (agent === undefined || agent?.session?.header === undefined) return { ok: false, reason: "caller session identity is unavailable" };
  const location = sessionPersistence.locate?.(agent.session.header);
  if (location === undefined || location === null) return { ok: false, reason: "persistence backend has no log location for this session" };
  if (location.kind !== "jsonl") return { ok: false, reason: `persistence backend "${location.kind}" is not the jsonl authority` };
  let raw;
  try {
    raw = await readFile(location.path);
  } catch (error) {
    return { ok: false, reason: `session log unreadable: ${String(error?.message ?? error)}` };
  }
  let text;
  try {
    // Session logs are multi-frame zstd streams (one frame per appended
    // event batch); decompressZstdStream walks every frame boundary and
    // reproduces `zstd -dc` output byte-for-byte.
    text = (await decompressZstdStream(raw)).toString("utf8");
  } catch {
    // An uncompressed log is also a legitimate persistence configuration.
    text = raw.toString("utf8");
  }
  return extractRouteValuesFromLines(splitJsonlLines(text));
}
