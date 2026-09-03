// dsh-ldvh — LD Vibe Harness host-plane plugin (assembly layer).
//
// This module only ASSEMBLES: settings section, registration-carrier
// startup self-check, the per-agent lifecycle registry (framework doc §4
// points 1–2, 4–5), and the web surface mounted through a soft
// ctx.inject(["webServer"]) callback (point 3) so headless compositions
// still get the full core (governance judgement, guidance, tools).
//
// Web routes (only when a webServer exists):
//   /ldvh/api   — backend API (health + governed-project lifecycle ops)
//   /ldvh       — frontend SPA (placeholder until the v4 web migration)
//   /ldvh/state — always-on governance-state endpoint (independent of the
//                 webEnabled presentation switch). Client-mark consumers were
//                 removed with the UI marks (Human 2026-09-04: context-
//                 injection row supersedes them); the endpoint remains as the
//                 machine-checkable state surface (E2 backfill: 稳态可查),
//                 and the ldvh_resolve_governance_scope tool path shares the
//                 same judgement source.
//
// What deliberately does NOT live here anymore (batch-1 rewrite):
//   - the global systemPrompt.section guidance channel (removed by Human
//     decision 2026-09-03 — the per-agent assemble waterfall in
//     guidance.js is the single injection path);
//   - governance judgement caches (removed by Human decision 2026-09-03 —
//     07 §5.3: every judgement reads the registration carrier for real);
//   - host-level agent/session-start tool registration and the manual
//     agent Map (replaced by lifecycle.js: agent/created + per-agent
//     fiber effects + roots-only gate + adoption of already-live agents).

import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRegistrationCarrier, readGovernedProjects } from "./governed-projects.js";
import { createGovernanceHandler } from "./host-api.js";
import { createLifecycleRegistry } from "./lifecycle.js";
import { createSessionScopes } from "./session-scopes.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { registerLdvhRpc, registerLdvhCommands } from "./rpc.js";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GATE_RUNNER_PATH = fileURLToPath(new URL("./git-gate-runner.js", import.meta.url));

export const name = "dsh-ldvh";
export const inject = ["tools", "settings", "systemPrompt"];

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
 * Two query forms, in priority order:
 *   1. `?sessionId=` — answered from the session-scopes table populated by
 *      the per-agent lifecycle (session-start and assemble). An unknown
 *      sessionId is NOT guessed: it answers `unknown`, and the Client
 *      renders nothing (fail-closed — no mark is safer than a false green).
 *   2. `?cwd=` — a direct judgement call, kept for callers that know the cwd.
 *
 * Only identity is returned: no paths, no settings — this is a status
 * indicator, not a settings surface.
 */
function registerStateRoute(webServer, sessionScopes, dshHomePath) {
  return webServer.register({
    kind: "prefix",
    path: STATE_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://ldvh.local");
      const path = url.pathname === STATE_PREFIX ? "/" : url.pathname.slice(STATE_PREFIX.length);
      if ((path === "/governance" || path === "/governance/") && (req.method === "GET" || req.method === "HEAD")) {
        const sessionId = url.searchParams.get("sessionId");
        if (typeof sessionId === "string" && sessionId.length > 0) {
          const known = sessionScopes.get(sessionId);
          if (known === undefined) {
            // Not yet resolved (or not an LDVH-tracked session): report
            // unknown rather than guessing governed/not_governed.
            json(res, 200, { ok: true, state: "unknown", project: null });
            return;
          }
          json(res, 200, {
            ok: true,
            state: known.state,
            project: known.project === undefined ? null : { id: known.project.id, name: known.project.name ?? null }
          });
          return;
        }
        const cwd = url.searchParams.get("cwd");
        if (typeof cwd !== "string" || cwd.length === 0) {
          json(res, 400, { ok: false, error: { code: "MISSING_QUERY" }, detail: "sessionId or cwd is required" });
          return;
        }
        try {
          const scope = await resolveGovernanceScope(dshHomePath, cwd);
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
  const state = { settingsSource: void 0, syncRoutes: void 0 };
  const sessionScopes = createSessionScopes();
  const dshHomePath = ctx.get("dshHomePath");

  // Per-agent lifecycle: agent/created install + adoption of already-live
  // agents; guidance injection, tools guard and the pre-step skeleton all
  // live behind this registry (framework doc §4 points 1–2, 4–5).
  const lifecycle = createLifecycleRegistry(ctx, {
    dshHomePath,
    workspaceRoot: PACKAGE_ROOT,
    sessionScopes
  });
  const stopLifecycle = lifecycle.start();

  // Soft web mount (framework doc §4 point 3): the webServer service is NOT a
  // hard injection anymore. In compositions that provide one, this child
  // fiber mounts the routes; headless compositions simply never run the
  // callback and the core (judgement/guidance/tools) is unaffected. The
  // child fiber is disposed with the plugin, so every route registered here
  // is cleaned up automatically on stop/update (audit D confirmed).
  ctx.inject(["webServer"], (webCtx) => {
    const webServer = webCtx.webServer;
    if (webServer === undefined) return;
    const disposeStateRoute = registerStateRoute(webServer, sessionScopes, dshHomePath);
    webCtx.logger.info("[dsh-ldvh] governance-state route registered under %s", STATE_PREFIX);
    let disposeRoutes = null;
    const syncRoutes = () => {
      if (webEnabled(state)) {
        if (disposeRoutes === null) {
          disposeRoutes = registerWebRoutes(webServer, dshHomePath);
          webCtx.logger.info("[dsh-ldvh] web routes registered under %s / %s", SPA_PREFIX, API_PREFIX);
        }
      } else if (disposeRoutes !== null) {
        disposeRoutes();
        disposeRoutes = null;
        webCtx.logger.info("[dsh-ldvh] web routes unmounted by setting");
      }
    };
    syncRoutes();
    state.syncRoutes = syncRoutes;
    webCtx.effect(() => () => {
      if (disposeRoutes !== null) {
        try { disposeRoutes(); } catch { /* already removed */ }
        disposeRoutes = null;
      }
      try { disposeStateRoute(); } catch { /* already removed */ }
      if (state.syncRoutes === syncRoutes) state.syncRoutes = void 0;
    }, "dsh-ldvh: web routes and state route");
  });

  // RPC + slash-command surface (mnemon parity, SKELETON): only in Web
  // compositions (connection service present). The lifecycle snapshot
  // channel is real and read-only; commands are placeholders.
  ctx.inject(["connection"], (connectionCtx) => {
    const connection = connectionCtx.connection;
    if (connection === undefined) return;
    const disposeRpc = registerLdvhRpc(connection, { lifecycle });
    const disposeCommands = registerLdvhCommands(connectionCtx.get?.("commands") ?? ctx.get("commands"));
    connectionCtx.effect(() => () => {
      try { disposeRpc(); } catch { /* already removed */ }
      try { disposeCommands(); } catch { /* already removed */ }
    }, "dsh-ldvh: rpc and commands");
  });

  // The settings seam owns its injected lifecycle and provides a live source
  // thunk plus change notifications. It declares its own `settings` injection
  // internally, so the settings row appears once the settings service is up.
  installSettingsSection(ctx, LDVH_SETTINGS_NAMESPACE, LDVH_SETTINGS_SCHEMA, {}, {
    setSource: (current) => {
      state.settingsSource = current;
      state.syncRoutes?.();
    },
    onChange: () => { state.syncRoutes?.(); }
  });

  // Startup carrier lifecycle (Human-confirmed design): plugin load ensures
  // an empty registration carrier exists — installing the plugin puts the
  // empty file in place, adding a governed project updates it. Only a
  // missing file is created; existing carriers are never rewritten here and
  // corrupt or unreadable ones stay fail-closed (logged, not overwritten).
  // The follow-up inspection is read-only: every launch checks registered
  // projects without silently installing or updating anything.
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

  // Plugin-level cleanup: stop the lifecycle registry (agent/created
  // listener + adoption bookkeeping) and drop the session-scopes table.
  // Per-agent hooks and tools die with their own agent fibers; the web
  // child fiber dies with the plugin.
  ctx.effect(() => () => {
    try { stopLifecycle(); } catch { /* already removed */ }
    sessionScopes.clear();
    state.settingsSource = void 0;
  }, "dsh-ldvh: lifecycle registry and session scopes");
}
