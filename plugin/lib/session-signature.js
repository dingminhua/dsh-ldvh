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
// Two source paths read the SAME authoritative record (specs/09 机械签名:
// 值必须由 Code 从 DSH 权威会话记录取得，不允许 AI 自填或调用方覆盖):
//
//   - Host path `currentRouteValues(sessionPersistence, agent)`: used by the
//     ldvh_* tools layer inside the DSH host process. The sessionPersistence
//     service resolves the log via ctx.get("sessionPersistence")
//     .locate(agent.session.header) — verified against DSH source, see
//     docs/p0-implementation-plan.md §0.
//
//   - Shell path `currentRouteValuesFromShellEnvironment()` /
//     `shellAuthoritativeSignature()`: used by scripts spawned from DSH
//     shell tool executions (the bash an agent runs). DSH injects
//     DSH_SESSION_ID/DSH_HOME (and, in deployments with the dsh-shell-env
//     session-persistence contributor, DSH_SESSION_JSONL) into the child
//     environment, so a script can locate ITS OWN session's authoritative
//     log without any agent relay: env → log → tail-read → branded carrier.
//     shellAuthoritativeSignature() returns the signature-channel branded
//     carrier the fact-object writers accept — the sanctioned way for a
//     direct writer call to land a mechanically-correct signature instead
//     of an unsigned entry. Valid ONLY in DSH shell-child processes; the
//     host process env does not identify the calling session, so the tools
//     layer must keep using the host path.

import { decompressZstdStream } from "./zstd-compat.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "./signature-channel.js";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROUTING_EVENT_TYPES = new Set(["model/selection", "request/context"]);

/**
 * Pure: read the FIRST `session` record of a session log and return its
 * identity fields. This is the authoritative "which session is this" fact:
 * DSH writes it as the log's opening record, before any turn runs.
 *
 * Returns an unavailable result (never a guess) when the record is missing or
 * carries no usable id — the caller must then treat the identity as
 * unobtainable rather than substituting a placeholder value.
 *
 * Fields read (all observed on real DSH logs, 2026-09-19):
 *   id                — the session's own identifier
 *   origin            — "subagent" on delegated sessions
 *   parentSession     — the delegating session's id (subagents only)
 *   delegationDepth   — 0 for roots, 1+ for delegated sessions
 */
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

/**
 * Read the authoritative session identity for an agent (host path), same
 * log-location contract as `currentRouteValues`. `agent` is the tool-execution
 * /assembly-context Agent object whose `session.header` identifies the log.
 */
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
 * Read one session-log file into text. Session logs are multi-frame zstd
 * streams (one frame per appended event batch); decompressZstdStream walks
 * every frame boundary and reproduces `zstd -dc` output byte-for-byte. An
 * uncompressed log is also a legitimate persistence configuration.
 */
async function readSessionLogText(path) {
  const raw = await readFile(path);
  try {
    return (await decompressZstdStream(raw)).toString("utf8");
  } catch {
    return raw.toString("utf8");
  }
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
  let text;
  try {
    text = await readSessionLogText(location.path);
  } catch (error) {
    return { ok: false, reason: `session log unreadable: ${String(error?.message ?? error)}` };
  }
  return extractRouteValuesFromLines(splitJsonlLines(text));
}

// ---------------------------------------------------------------------------
// Shell-environment source (specs/09 机械签名: the Code channel for direct
// writer calls made by scripts spawned from DSH shell tool executions)
// ---------------------------------------------------------------------------

/** The authoritative log file name inside a session directory on disk. */
const SHELL_SESSION_LOG_BASENAME = "session.v3.jsonl.zstd";

/**
 * Resolve THIS shell's authoritative session-log path from the DSH-injected
 * environment. Resolution order:
 *   1. DSH_SESSION_JSONL — the dsh-shell-env session-persistence contributor
 *      injects it directly in deployments that run it.
 *   2. On-disk layout — $DSH_HOME/sessions/<encoded-cwd>/<DSH_SESSION_ID>/
 *      session.v3.jsonl.zstd, located by scanning the sessions directory for
 *      the (UUID-unique) session id. Exactly one match is required; zero or
 *      several matches resolve to an unavailable result — never a guess.
 * Fails closed (unavailable result) when the environment carries no DSH
 * shell identity, so plain CI/dev shells never fabricate a signature.
 */
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
    const candidate = join(home, "sessions", entry.name, sessionId, SHELL_SESSION_LOG_BASENAME);
    try {
      await access(candidate);
      matches.push(candidate);
    } catch {
      // No log for this session under this cwd encoding — keep scanning.
    }
  }
  if (matches.length === 1) return { ok: true, value: matches[0] };
  if (matches.length === 0) return { ok: false, reason: `no session log for ${sessionId} under ${home}/sessions` };
  return { ok: false, reason: `ambiguous session logs for ${sessionId}: ${matches.length} matches` };
}

/**
 * Read the calling shell's own authoritative session log (DSH shell-child
 * processes only — the host process env does not identify the calling
 * session) and extract the mechanical signature pair, same tail-read
 * semantics as currentRouteValues.
 */
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

/**
 * The sanctioned signature source for DIRECT writer calls made by scripts:
 * resolves this shell's authoritative route and wraps it into the
 * signature-channel branded carrier the fact-object writers stamp into
 * change_log entries. Returns null when the authoritative record is
 * unavailable (plain/CI shells, missing log, no routing event) — the caller
 * then passes null and the entry renders unsigned. The agent never touches
 * the value: env → session log → tail-read → brand, all inside Code.
 */
export async function shellAuthoritativeSignature() {
  const route = await currentRouteValuesFromShellEnvironment();
  return route.ok ? authoritativeSignature(route.value) : null;
}

/**
 * The sanctioned SESSION-IDENTITY source for direct writer calls made by
 * scripts: resolves THIS shell's authoritative session identity via the
 * DSH-injected environment and wraps it into the branded carrier the WorkCase
 * writer accepts. Returns null when the identity is unavailable (plain/CI
 * shells, missing log, no leading session record) — the caller then passes
 * null and the WorkCase close gate fails closed rather than guessing.
 *
 * 值全程 Code→Code：env → session log → leading session record → brand，
 * 代理不经手。这是受管辖子代理（不注册 ldvh_* 工具）回传其会话身份的正规
 * 通道（workcase-2be11478 计划步骤 4）。
 */
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
  // source: "shell" —— 身份来自环境变量 + 日志文件，而两者对调用者**可设置**，
  // 故该来源**可被伪造**，不构成独立性证据（独立对抗复核实测，2026-09-19）。
  // 该标记使写入器能机械拒收 shell 来源的复核身份。
  return identity.ok ? authoritativeSessionIdentity({ ...identity.value, source: "shell" }) : null;
}
