// dsh-ldvh — LD Vibe Harness host-plane plugin.
//
// Registers the `dsh-ldvh` settings section (LDVH Web presentation mount
// control) and, when the host `webServer` service is loaded,
// serves the LDVH Web under two prefix routes:
//
//   /ldvh/api  — the migrated backend (business services from v4 web/api)
//   /ldvh      — the migrated frontend SPA (built dist, static + index fallback)
//
// The web routes are registered/unregistered against the live `webEnabled`
// setting: turning the switch off removes the routes; turning it on registers
// them and the Client automatically probes availability. Lifecycle is otherwise
// owned by ctx.effect: disabling the plugin
// removes the routes and releases every resource. The webServer service is a
// declared injection, so the plugin activates only in compositions that
// actually provide it (DSH Desktop / web profiles); headless compositions
// without a webServer never activate this plugin.

import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRegistrationCarrier, readGovernedProjects } from "./governed-projects.js";
import { createGovernanceHandler } from "./host-api.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { registerLdvhTools } from "./ldvh-tools.js";
import { GUIDANCE_SECTION_NAME, GUIDANCE_SECTION_ORDER, guidanceTextFor } from "./guidance-text.js";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GATE_RUNNER_PATH = fileURLToPath(new URL("./git-gate-runner.js", import.meta.url));

export const name = "dsh-ldvh";
export const inject = ["webServer", "tools", "systemPrompt"];

const LDVH_SETTINGS_NAMESPACE = settingsNamespace("dsh-ldvh");

const LDVH_SETTINGS_SCHEMA = z.object({
  // Whether LDVH mounts its own /ldvh + /ldvh/api routes onto the host
  // webServer at startup (and on toggle). The host webServer itself always
  // runs — this switch only governs LDVH's routes, not the web service.
  webEnabled: z.boolean().default(true),
}).default({});

const API_PREFIX = "/ldvh/api";
const SPA_PREFIX = "/ldvh";
// Always-on governance-state endpoint for the Client indicator. Separate from
// /ldvh/api so the indicator survives the Web-presentation switch.
const STATE_PREFIX = "/ldvh/state";

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** True when a request method should be served for static/SPA content. */
function isSafeMethod(method) {
  return method === "GET" || method === "HEAD";
}

/**
 * Minimal SPA static server used until the v4 frontend dist is wired in.
 * Serves the plugin's own index placeholder; replaced by the migrated v4
 * `web/dist` handler in the web migration step.
 */
function spaHandler(req, res) {
  if (!isSafeMethod(req.method)) {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.end("method not allowed");
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>LDVH</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#101114;color:#e6e6e6}
main{max-width:640px;padding:24px;text-align:center}h1{font-size:20px}p{color:#b8b8b8;line-height:1.6}
code{background:#202126;padding:2px 6px;border-radius:6px}</style>
<main><h1>LDVH Web</h1><p>这是 dsh-ldvh 插件的占位页面。<br>v4 Web 迁入并构建后，此页面将由 LDVH 信息呈现界面替换。</p>
<p>后端健康检查：<code>/ldvh/api/health</code></p></main></html>`);
}

/** LDVH API handler: health plus governed-project lifecycle operations. */
function createApiHandler(dshHomePath) {
  const governance = createGovernanceHandler({ dshHomePath, runnerPath: GATE_RUNNER_PATH, workspaceRoot: PACKAGE_ROOT });
  return async function apiHandler(req, res) {
    const rawPath = new URL(req.url ?? "/", "http://ldvh.local").pathname;
    const path = rawPath === API_PREFIX ? "/" : (rawPath.startsWith(`${API_PREFIX}/`) ? rawPath.slice(API_PREFIX.length) : rawPath);
    if ((path === "/health" || path === "/health/") && (req.method === "GET" || req.method === "HEAD")) {
      json(res, 200, { ok: true, service: "dsh-ldvh", status: "ok", prefix: API_PREFIX });
      return;
    }
    const handled = await governance(req, res);
    if (handled !== false) return;
    if (!["GET", "HEAD", "POST"].includes(req.method)) {
      res.setHeader("allow", "GET, HEAD, POST");
      json(res, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED" } });
      return;
    }
    json(res, 404, { ok: false, error: { code: "NOT_FOUND" }, path });
  };
}

/** Read the live web-enabled switch from the settings source. Absent = default enabled. */
function webEnabled(state) {
  const section = state.settingsSource?.();
  return section === void 0 || section === null ? true : section.webEnabled !== false;
}

/** Register both web routes; returns a single disposer removing both. */
function registerWebRoutes(webServer, dshHomePath) {
  const apiDisposer = webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    handler: typeof dshHomePath === "function" ? createApiHandler(dshHomePath) : createApiHandler(() => { throw new Error("DSH user configuration root is unavailable"); })
  });
  const spaDisposer = webServer.register({
    kind: "prefix",
    path: SPA_PREFIX,
    handler: spaHandler
  });
  return () => {
    try { apiDisposer(); } catch { /* already removed */ }
    try { spaDisposer(); } catch { /* already removed */ }
  };
}

/**
 * Register the always-on governance-state endpoint for the Client indicator.
 *
 * Deliberately separate from `registerWebRoutes`: /ldvh/api is gated on the
 * `webEnabled` setting, but "is this session governed?" is a governance
 * signal, not a Web-panel feature — the indicator must keep working when the
 * Web mount is switched off.
 *
 * The Client supplies its own session cwd, so the Host stays a pure lookup
 * over the SAME cached judgement the tools and the guidance section use (one
 * authority, no second judgement path). Only identity is returned: no paths,
 * no settings — this is a status indicator, not a settings surface.
 */
function registerStateRoute(webServer, resolveScope) {
  return webServer.register({
    kind: "prefix",
    path: STATE_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://ldvh.local");
      const path = url.pathname === STATE_PREFIX ? "/" : url.pathname.slice(STATE_PREFIX.length);
      if ((path === "/governance" || path === "/governance/") && (req.method === "GET" || req.method === "HEAD")) {
        const cwd = url.searchParams.get("cwd");
        if (typeof cwd !== "string" || cwd.length === 0) {
          json(res, 400, { ok: false, error: { code: "MISSING_CWD" } });
          return;
        }
        try {
          const scope = await resolveScope(cwd);
          json(res, 200, {
            ok: true,
            state: scope.state,
            project: scope.project === undefined ? null : { id: scope.project.id, name: scope.project.name ?? null }
          });
        } catch (error) {
          json(res, 200, { ok: false, state: "unavailable", detail: String(error?.message ?? error) });
        }
        return;
      }
      json(res, 404, { ok: false, error: { code: "NOT_FOUND" } });
    }
  });
}

export function apply(ctx) {
  const state = { settingsSource: void 0, disposeRoutes: null, disposeStateRoute: null };

  // The webServer service is a declared injection (see `inject` above): the
  // plugin activates only once the service is up. This removes the historic
  // race where `ctx.get("webServer")` snapshotted the service during plugin
  // tree loading (before dsh-host-webserver had provided it), silently
  // skipping route registration forever — "absent at apply time" used to be
  // mistaken for the steady-state headless case.
  const webServer = ctx.webServer;
  const dshHomePath = ctx.get("dshHomePath");

  // Sync the web route registration with the live setting:
  //   webEnabled on  → register (mount) the /ldvh routes;
  //   webEnabled off → unregister (unmount) them.
  function syncRoutes() {
    if (webServer === void 0) {
      ctx.logger.warn("[dsh-ldvh] webServer service lost before route sync; routes are unmounted");
      return;
    }
    const enabled = webEnabled(state);

    if (enabled) {
      if (state.disposeRoutes === null) {
        state.disposeRoutes = registerWebRoutes(webServer, dshHomePath);
        ctx.logger.info("[dsh-ldvh] web routes registered under %s / %s", SPA_PREFIX, API_PREFIX);
      }
    } else if (state.disposeRoutes !== null) {
      state.disposeRoutes();
      state.disposeRoutes = null;
      ctx.logger.info("[dsh-ldvh] web routes unmounted by setting");
    }
  }

  // The governance-state route is NOT part of syncRoutes: it must stay
  // mounted while the plugin runs, regardless of the Web-presentation switch.
  // `cachedGovernanceScope` is a hoisted function declaration defined below.
  if (webServer !== undefined) {
    state.disposeStateRoute = registerStateRoute(webServer, cachedGovernanceScope);
    ctx.logger.info("[dsh-ldvh] governance-state route registered under %s", STATE_PREFIX);
  }

  // The settings seam owns its injected lifecycle and provides a live source
  // thunk plus change notifications. It declares its own `settings` injection
  // internally, so the settings row appears once the settings service is up
  // (independent of when our own fiber activated on webServer).
  installSettingsSection(ctx, LDVH_SETTINGS_NAMESPACE, LDVH_SETTINGS_SCHEMA, {}, {
    setSource: (current) => {
      state.settingsSource = current;
      syncRoutes();
    },
    onChange: () => { syncRoutes(); }
  });

  // Startup carrier lifecycle (Human-confirmed design): plugin load ensures
  // an empty registration carrier exists — installing the plugin puts the
  // empty file in place, adding a governed project updates it. Only a
  // missing file is created; existing carriers are never rewritten here and
  // corrupt or unreadable ones stay fail-closed (logged, not overwritten).
  // The follow-up inspection is read-only and its result is deliberately not
  // cached as authority: UI/CLI operations re-read their actual files. This
  // validates that every launch checks registered projects and Hook versions
  // without silently installing or updating anything.
  if (typeof dshHomePath === "function") {
    Promise.resolve(ensureRegistrationCarrier(dshHomePath))
      .then((ensured) => {
        if (ensured.created) ctx.logger.info("[dsh-ldvh] initialized empty governed-projects registration carrier");
        return readGovernedProjects(dshHomePath);
      })
      .then((result) => {
        if (!result.ok) ctx.logger.warn("[dsh-ldvh] governed-project startup inspection unavailable: %s", result.error.message);
        else ctx.logger.info("[dsh-ldvh] inspected %d governed project(s) at startup", result.value.projects.length);
      })
      .catch((error) => ctx.logger.warn(error));
  }

  // P0 AI-facing surface: minimal rule guidance (systemPrompt section, the
  // text is a function so it re-evaluates at every prompt assembly) and the
  // first LDVH tool batch, both gated on the live governance three-state.
  //   governed    -> guidance section with the seven 00 anchors + 5 tools
  //   not_governed -> empty guidance text (filtered at assembly = zero
  //                   interference) + no tools (§15 item 1)
  //   unavailable -> fail-closed guidance section + no tools (§15 item 3)
  // The section function resolves the caller session's cwd from the
  // assembly context; per-step re-evaluation means a mid-session install or
  // cancellation of governance takes effect on the next assembly without a
  // restart.
  //
  // Tool registration is AGENT-SCOPED, not global: registering through the
  // started agent's own context (dsh-scope ScopedLayers) makes the batch
  // visible to that agent's session only — a not_governed session in the
  // same host never sees the tools even while a governed session has them.
  // The guidance section keeps its global registration with per-assembly
  // text: not_governed evaluates to "" which assembly filters out (the
  // zero-interference guarantee).
  const scopeCache = new Map();      // cwd -> { fingerprint, promise } — async resolution
  const resolvedScopes = new Map();  // cwd -> scope object — SYNCHRONOUS snapshot
  const agentDisposers = new Map();

  function cachedGovernanceScope(cwd) {
    const unavailable = { state: "unavailable", detail: "session working directory is unavailable" };
    if (typeof cwd !== "string" || cwd.length === 0) return Promise.resolve(unavailable);
    const cached = scopeCache.get(cwd);
    if (cached !== undefined) return cached.promise;
    const promise = resolveGovernanceScope(dshHomePath, cwd).then((scope) => {
      // Snapshot the resolved scope synchronously so the guidance section
      // (which dsh-system-prompt evaluates SYNCHRONOUSLY, never awaiting a
      // Promise) can read the current state without an async text function.
      resolvedScopes.set(cwd, scope);
      // Invalidate other cached entries when the registration fingerprint
      // moved (project added/removed) so a mid-session governance change is
      // visible on the next evaluation.
      const fingerprint = scope.registrationFingerprint ?? null;
      for (const [key, entry] of scopeCache) {
        if (key === cwd) continue;
        if (entry.fingerprint !== fingerprint) scopeCache.delete(key);
      }
      return scope;
    }).catch((error) => {
      const scope = { state: "unavailable", detail: String(error?.message ?? error) };
      resolvedScopes.set(cwd, scope);
      return scope;
    });
    scopeCache.set(cwd, { fingerprint: null, promise });
    promise.then((scope) => {
      const entry = scopeCache.get(cwd);
      if (entry !== undefined) entry.fingerprint = scope.registrationFingerprint ?? null;
    });
    return promise;
  }

  // IMPORTANT (real-host contract): dsh-system-prompt evaluates section.text
  // SYNCHRONOUSLY at every prompt assembly — an async text function would
  // return a Promise and crash interpolate() with `text.indexOf is not a
  // function`. So the section text is a SYNC function reading the resolved
  // snapshot (filled by the async session-start path / cachedGovernanceScope
  // resolution above). Before the snapshot exists the text is "" — assembly
  // filters empty sections, which is exactly the not_governed zero-interference
  // guarantee and is fail-safe.
  ctx.systemPrompt.section({
    name: GUIDANCE_SECTION_NAME,
    order: GUIDANCE_SECTION_ORDER,
    text(context) {
      const cwd = context?.agent?.session?.header?.cwd;
      if (typeof cwd === "string") {
        const scope = resolvedScopes.get(cwd);
        if (scope !== undefined) return guidanceTextFor(scope.state);
        // Snapshot not ready yet: kick the async resolution (it writes the
        // snapshot for the NEXT assembly) and return "" now — assembly
        // filters empty sections, which is the fail-safe zero-interference
        // path (never an asserted wrong state).
        void cachedGovernanceScope(cwd);
        return "";
      }
      return "";
    }
  });

  function syncToolsForAgent(agent, scope) {
    const agentId = agent?.id ?? agent?.session?.header?.id;
    if (typeof agentId !== "string") return;
    const registerable = scope.state === "governed" && agent?.ctx !== undefined;
    const existing = agentDisposers.get(agentId);
    if (registerable && existing === undefined) {
      const dispose = registerLdvhTools(agent.ctx, {
        dshHomePath,
        workspaceRoot: PACKAGE_ROOT,
        sessionPersistence: () => ctx.get("sessionPersistence")
      });
      agentDisposers.set(agentId, { dispose, agent });
      ctx.logger.info("[dsh-ldvh] registered LDVH tool batch (agent-scoped) for governed session %s", agentId);
    } else if (!registerable && existing !== undefined) {
      try { existing.dispose(); } catch { /* already removed */ }
      agentDisposers.delete(agentId);
      ctx.logger.info("[dsh-ldvh] unregistered LDVH tool batch (governance state: %s)", scope.state);
    }
  }

  // Sessions start with a live scope resolution; agent disposal (cordis
  // effect on the agent's own fiber) removes its scoped registrations, so
  // only the started-agent bookkeeping needs explicit handling here.
  ctx.on("agent/session-start", async ({ agent }) => {
    const cwd = agent?.session?.header?.cwd;
    if (typeof cwd !== "string") return;
    const scope = await cachedGovernanceScope(cwd);
    syncToolsForAgent(agent, scope);
  });
  ctx.on("agent/disposed", ({ agent }) => {
    const agentId = agent?.id ?? agent?.session?.header?.id;
    if (typeof agentId === "string") agentDisposers.delete(agentId);
  });



  // Plugin-level cleanup: remove routes, every agent-scoped tool batch, and
  // drop the live source. (Agent-scoped registrations also die with their
  // own fibers; this sweep covers agents outliving the plugin.)
  ctx.effect(() => () => {
    if (state.disposeRoutes !== null) {
      try { state.disposeRoutes(); } catch { /* already removed */ }
      state.disposeRoutes = null;
    }
    if (state.disposeStateRoute !== null) {
      try { state.disposeStateRoute(); } catch { /* already removed */ }
      state.disposeStateRoute = null;
    }
    for (const { dispose } of agentDisposers.values()) {
      try { dispose(); } catch { /* already removed */ }
    }
    agentDisposers.clear();
    state.settingsSource = void 0;
  }, "dsh-ldvh: web routes, state route, and tools");
}