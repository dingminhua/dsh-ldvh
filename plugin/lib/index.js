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
// removes the routes and releases every resource. When the host has no
// webServer (headless), the plugin fails closed.

import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readGovernedProjects } from "./governed-projects.js";
import { createGovernanceHandler } from "./host-api.js";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GATE_RUNNER_PATH = fileURLToPath(new URL("./git-gate-runner.js", import.meta.url));

export const name = "dsh-ldvh";

const LDVH_SETTINGS_NAMESPACE = settingsNamespace("dsh-ldvh");

const LDVH_SETTINGS_SCHEMA = z.object({
  // Whether LDVH mounts its own /ldvh + /ldvh/api routes onto the host
  // webServer at startup (and on toggle). The host webServer itself always
  // runs — this switch only governs LDVH's routes, not the web service.
  webEnabled: z.boolean().default(true),
}).default({});

const API_PREFIX = "/ldvh/api";
const SPA_PREFIX = "/ldvh";

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

export function apply(ctx) {
  const state = { settingsSource: void 0, disposeRoutes: null };

  const webServer = ctx.get("webServer");
  const dshHomePath = ctx.get("dshHomePath");

  // Sync the web route registration with the live setting:
  //   webEnabled on  → register (mount) the /ldvh routes;
  //   webEnabled off → unregister (unmount) them.
  // No-op when the host webServer is absent (fail-closed, no route is claimed).
  function syncRoutes() {
    if (webServer === void 0) return;
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

  // The settings seam owns its injected lifecycle and provides a live source
  // thunk plus change notifications. Register it unconditionally so the web
  // settings row is available even when the host webServer is not mounted.
  installSettingsSection(ctx, LDVH_SETTINGS_NAMESPACE, LDVH_SETTINGS_SCHEMA, {}, {
    setSource: (current) => {
      state.settingsSource = current;
      syncRoutes();
    },
    onChange: () => { syncRoutes(); }
  });

  // Prime one read-only governance inspection at Host startup. The result is
  // deliberately not cached as authority: UI/CLI operations re-read their
  // actual files. This validates that every launch checks registered project
  // and Hook versions without silently installing or updating anything.
  if (typeof dshHomePath === "function") {
    Promise.resolve(readGovernedProjects(dshHomePath)).then((result) => {
      if (!result.ok) ctx.logger.warn("[dsh-ldvh] governed-project startup inspection unavailable: %s", result.error.message);
      else ctx.logger.info("[dsh-ldvh] inspected %d governed project(s) at startup", result.value.projects.length);
    }).catch((error) => ctx.logger.warn(error));
  }

  // Plugin-level cleanup: remove routes and drop the live source.
  ctx.effect(() => () => {
    if (state.disposeRoutes !== null) {
      try { state.disposeRoutes(); } catch { /* already removed */ }
      state.disposeRoutes = null;
    }
    state.settingsSource = void 0;
  }, "dsh-ldvh: web routes");
}