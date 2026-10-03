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
import { readdir, readFile } from "node:fs/promises";
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
  const events = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      continue; // 残缺尾行：跳过，不得据以构造签名
    }
  }
  return extractRouteValuesFromEvents(events);
}

/**
 * Pure: walk **already-parsed** events from the newest backwards and return the
 * last routing event's provider/model pair verbatim.
 *
 * 与 `extractRouteValuesFromLines` **共用同一条取值纪律**（同一函数体），差别只在
 * 输入形态——本函数服务于宿主的正规读取入口（`handle.read()` 返回已解析事件）；
 * 后者服务于文件链路（自行解压后切行解析）。**两条入口必须给出同一取值**，故取值
 * 逻辑只此一处（零清洗：不剥离 `-vision` 之类的路由后缀、不过滤、不替换）。
 *
 * @param events - 已解析事件，**由新到旧**（调用方负责倒序）。
 */
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
 *
 * 入口选择（2026-10-03 换接）：优先用宿主的**正规读取入口**
 * `open(id, 'read')` → `handle.read()`，它返回**已解压、已解析**的
 * SessionEvent 数组，并自带两条契约——「a torn physical tail is never
 * returned」「repeated reads never observe an older state」。回退路径才是
 * 旧的 `locate()` 物理文件链路（自行读文件 + 自造多帧 zstd 解压 + 切行）。
 *
 * 为何换：`locate` 是 jsonl 后端的 **private** 方法（无公开契约，宿主改实现即
 * 静默失效）；而 `model/selection` 与 `request/context` 都是标准 SessionEvent
 * 类型，`read()` 直接返回，无需任何解压或切行。
 *
 * 回退保留的理由：**shell 路径**（无 ctx 的普通脚本）仍必须走文件链路，
 * 且换接初期须保留一条可用的旧路径，避免入口异常导致签名整体不可得。
 */
export async function currentRouteValues(sessionPersistence, agent) {
  if (sessionPersistence === undefined || sessionPersistence === null) return { ok: false, reason: "sessionPersistence service is unavailable" };
  if (agent === undefined || agent?.session?.header === undefined) return { ok: false, reason: "caller session identity is unavailable" };
  // ① 正规入口：open(id,'read').read() 取已解析事件。
  const viaHandle = await readRouteEventsViaHandle(sessionPersistence, agent.session.header);
  if (viaHandle !== undefined) return viaHandle;
  // ② 回退：旧的物理文件链路（locate + 自读 + 自解压 + 切行）。
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

/**
 * 宿主正规入口：返回签名结果，或在「该入口不可用」时返回 undefined
 * （由调用方回退到文件链路）。**不在此处吞掉真实错误**——入口可用但读取
 * 失败时，如实返回失败结果，不回退（避免用一个更弱的来源掩盖失败）。
 */
async function readRouteEventsViaHandle(sessionPersistence, header) {
  const sessionId = header?.id;
  if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
  if (typeof sessionPersistence.open !== "function") return undefined;
  let handle;
  try {
    handle = await sessionPersistence.open(sessionId, "read");
  } catch {
    // open 不可用（如后端无该会话或未实现）→ 交给回退链路给出精确原因。
    return undefined;
  }
  try {
    const result = await handle.read();
    const events = result?.events;
    if (!Array.isArray(events)) return undefined;
    // 复用同一取值纪律：走**从末尾回看**的最后一条 routing 事件，零清洗。
    // 注意方向：host 的 read() 返回**正序**事件，而取值器要求由新到旧——
    // 漏掉这一步会静默取到**最旧**的 routing 事件（值错而不报错）。
    return extractRouteValuesFromEvents([...events].reverse());
  } catch (error) {
    return { ok: false, reason: `session log unreadable via host handle: ${String(error?.message ?? error)}` };
  } finally {
    try {
      await handle.close?.();
    } catch {
      /* 句柄关闭失败不影响已取得的值 */
    }
  }
}


// ---------------------------------------------------------------------------
// Shell-environment source (specs/09 机械签名: the Code channel for direct
// writer calls made by scripts spawned from DSH shell tool executions)
// ---------------------------------------------------------------------------

/**
 * The authoritative log file name inside a session directory on disk. DSH names
 * the log after the session-record schema version it writes
 * (`session.v<version>.jsonl`, compressed on disk as
 * `session.v<version>.jsonl.zstd`; observed v3 up to 2026-09-20 and v4 from
 * 2026-09-25, matching the `version` field of the log's opening record). The
 * version is part of the host's naming, so ANY pinned basename breaks on the
 * next host schema bump — match the shape and take the version from the name.
 */
const SHELL_SESSION_LOG_PATTERN = /^session\.v(\d+)\.jsonl(\.zstd)?$/;

/**
 * Resolve THIS shell's authoritative session-log path from the DSH-injected
 * environment. Resolution order:
 *   1. DSH_SESSION_JSONL — the dsh-shell-env session-persistence contributor
 *      injects it directly in deployments that run it.
 *   2. On-disk layout — $DSH_HOME/sessions/<encoded-cwd>/<DSH_SESSION_ID>/
 *      session.v<version>.jsonl[.zstd], located by scanning the sessions
 *      directory for the (UUID-unique) session id. Exactly one session
 *      directory must match; zero or several resolve to an unavailable result
 *      — never a guess. Inside one session directory, a session that outlived a
 *      host schema bump carries one log per version: the HIGHEST version is the
 *      stream the current host appends to (the older file is frozen), and the
 *      compressed form wins over the uncompressed persistence configuration.
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
    const dir = join(home, "sessions", entry.name, sessionId);
    let names;
    try {
      names = await readdir(dir);
    } catch {
      // No session directory for this session under this cwd encoding.
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
  // 故该来源**可被伪造**，不构成独立性证据（独立审核实测，2026-09-19）。
  // 该标记使写入器能机械拒收 shell 来源的复核身份。
  return identity.ok ? authoritativeSessionIdentity({ ...identity.value, source: "shell" }) : null;
}
