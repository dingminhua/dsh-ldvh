
import { decompressZstdStream } from "./zstd-compat.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "./signature-channel.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROUTING_EVENT_TYPES = new Set(["model/selection", "request/context"]);

export function extractSessionIdentityFromLines(lines) {
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof event !== "object" || event === null) continue;
    if (event.type !== "session") continue;
    const sessionId = event.id;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return { ok: false, reason: "the session record carries no usable id" };
    }
    return {
      ok: true,
      value: {
        sessionId,
        origin: typeof event.origin === "string" ? event.origin : null,
        parentSession: typeof event.parentSession === "string" ? event.parentSession : null,
        delegationDepth: Number.isInteger(event.delegationDepth) ? event.delegationDepth : null
      }
    };
  }
  return { ok: false, reason: "session log carries no leading session record" };
}

export async function currentSessionIdentity(sessionPersistence, agent) {
  if (sessionPersistence === undefined || sessionPersistence === null) return { ok: false, reason: "sessionPersistence service is unavailable" };
  if (agent === undefined || agent?.session?.header === undefined) return { ok: false, reason: "caller session identity is unavailable" };
  const location = sessionPersistence.locate?.(agent.session.header);
  if (location === undefined || location === null) return { ok: false, reason: "persistence backend has no log location for this session" };
  if (location.kind !== "jsonl") return { ok: false, reason: `persistence backend "${location.kind}" is not the jsonl authority` };
  let text;
  try {
    text = await readSessionLogText(location.path);
  } catch (error) {
    return { ok: false, reason: `session log unreadable: ${String(error?.message ?? error)}` };
  }
  return extractSessionIdentityFromLines(splitJsonlLines(text));
}

export function extractRouteValuesFromLines(lines) {
  const events = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return extractRouteValuesFromEvents(events);
}

export function extractRouteValuesFromEvents(events) {
  for (const event of events) {
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

export function splitJsonlLines(text) {
  return text.split("\n");
}

async function readSessionLogText(path) {
  const raw = await readFile(path);
  try {
    return (await decompressZstdStream(raw)).toString("utf8");
  } catch {
    return raw.toString("utf8");
  }
}

export async function currentRouteValues(sessionPersistence, agent) {
  if (agent === undefined || agent?.session?.header === undefined) return { ok: false, reason: "caller session identity is unavailable" };
  return currentRouteValuesForSession(sessionPersistence, agent.session.header);
}

export async function currentRouteValuesForSession(sessionPersistence, session) {
  if (sessionPersistence === undefined || sessionPersistence === null) return { ok: false, reason: "sessionPersistence service is unavailable" };
  if (session === undefined || session === null) return { ok: false, reason: "session identity is unavailable" };
  const agent = { session: { header: session } };
  const viaHandle = await readRouteEventsViaHandle(sessionPersistence, agent.session.header);
  if (viaHandle !== undefined) return viaHandle;
  const location = sessionPersistence.locate?.(agent.session.header);
  if (location === undefined || location === null) return { ok: false, reason: "persistence backend has no log location for this session" };
  if (location.kind !== "jsonl") return { ok: false, reason: `persistence backend "${location.kind}" is not the jsonl authority` };
  let text;
  try {
    text = await readSessionLogText(location.path);
  } catch (error) {
    return { ok: false, reason: `session log unreadable: ${String(error?.message ?? error)}` };
  }
  return extractRouteValuesFromLines(splitJsonlLines(text));
}

async function readRouteEventsViaHandle(sessionPersistence, header) {
  const sessionId = header?.id;
  if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
  if (typeof sessionPersistence.open !== "function") return undefined;
  let handle;
  try {
    handle = await sessionPersistence.open(sessionId, "read");
  } catch {
    return undefined;
  }
  try {
    const result = await handle.read();
    const events = result?.events;
    if (!Array.isArray(events)) return undefined;
    return extractRouteValuesFromEvents([...events].reverse());
  } catch (error) {
    return { ok: false, reason: `session log unreadable via host handle: ${String(error?.message ?? error)}` };
  } finally {
    try {
      await handle.close?.();
    } catch {
    }
  }
}



const SHELL_SESSION_LOG_PATTERN = /^session\.v(\d+)\.jsonl(\.zstd)?$/;

async function shellSessionLogPath() {
  const direct = process.env.DSH_SESSION_JSONL;
  if (typeof direct === "string" && direct.length > 0) return { ok: true, value: direct };
  const home = process.env.DSH_HOME;
  const sessionId = process.env.DSH_SESSION_ID;
  if (typeof home !== "string" || home.length === 0) return { ok: false, reason: "shell environment carries no DSH_HOME" };
  if (typeof sessionId !== "string" || sessionId.length === 0) return { ok: false, reason: "shell environment carries no DSH_SESSION_ID" };
  if (/[/\\]|\.\./.test(sessionId)) return { ok: false, reason: "DSH_SESSION_ID is not a safe path segment" };
  let entries;
  try {
    entries = await readdir(join(home, "sessions"), { withFileTypes: true });
  } catch {
    return { ok: false, reason: `sessions directory unreadable under ${home}` };
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(home, "sessions", entry.name, sessionId);
    let names;
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    const candidates = [];
    for (const name of names) {
      const match = SHELL_SESSION_LOG_PATTERN.exec(name);
      if (match === null) continue;
      candidates.push({ name, version: Number(match[1]), compressed: name.endsWith(".zstd") });
    }
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => (b.version - a.version) || (Number(b.compressed) - Number(a.compressed)));
    matches.push(join(dir, candidates[0].name));
  }
  if (matches.length === 1) return { ok: true, value: matches[0] };
  if (matches.length === 0) return { ok: false, reason: `no session log for ${sessionId} under ${home}/sessions` };
  return { ok: false, reason: `ambiguous session logs for ${sessionId}: ${matches.length} matches` };
}

export async function currentRouteValuesFromShellEnvironment() {
  const located = await shellSessionLogPath();
  if (!located.ok) return { ok: false, reason: located.reason };
  let text;
  try {
    text = await readSessionLogText(located.value);
  } catch (error) {
    return { ok: false, reason: `session log unreadable: ${String(error?.message ?? error)}` };
  }
  return extractRouteValuesFromLines(splitJsonlLines(text));
}

export async function shellAuthoritativeSignature() {
  const route = await currentRouteValuesFromShellEnvironment();
  return route.ok ? authoritativeSignature(route.value) : null;
}

export async function shellAuthoritativeSessionIdentity() {
  const located = await shellSessionLogPath();
  if (!located.ok) return null;
  let text;
  try {
    text = await readSessionLogText(located.value);
  } catch {
    return null;
  }
  const identity = extractSessionIdentityFromLines(splitJsonlLines(text));
  return identity.ok ? authoritativeSessionIdentity({ ...identity.value, source: "shell" }) : null;
}

export async function resolveSignatureDetailed(sessionPersistence, sessionId) {
  if (sessionPersistence === null || sessionPersistence === undefined) {
    return { ok: false, reason: "sessionPersistence-unavailable" };
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return { ok: false, reason: "session-id-empty" };
  }
  try {
    const route = await currentRouteValuesForSession(sessionPersistence, { id: sessionId });
    if (!route.ok) return { ok: false, reason: `route-unavailable:${route.reason ?? "unknown"}` };
    const carrier = authoritativeSignature({ provider: route.value.provider, model: route.value.model });
    if (carrier === null) {
      return {
        ok: false,
        reason: `unbrandable:provider=${String(route.value.provider)}:model=${String(route.value.model)}`,
      };
    }
    return { ok: true, value: carrier };
  } catch (error) {
    return { ok: false, reason: `signature-threw:${String(error?.message ?? error)}` };
  }
}
