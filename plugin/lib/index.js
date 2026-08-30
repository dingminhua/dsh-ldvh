// dsh-ldvh — LD Vibe Harness host-plane plugin.
//
// Registers the `dsh-ldvh` settings section (default governance directory,
// web route enable switch) and, when the host `webServer` service is loaded,
// serves the LDVH Web under two prefix routes:
//
//   /ldvh/api  — the migrated backend (business services from v4 web/api)
//   /ldvh      — the migrated frontend SPA (built dist, static + index fallback)
//
// The web routes are registered/unregistered against the live `webEnabled`
// setting: turning the switch off removes the routes (service "stopped"),
// turning it on (re)registers them (service "restarted") — no plugin reload
// required. Lifecycle is otherwise owned by ctx.effect: disabling the plugin
// removes the routes and releases every resource. When the host has no
// webServer (headless), the plugin fails closed.

import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

export const name = "dsh-ldvh";

const LDVH_SETTINGS_NAMESPACE = settingsNamespace("dsh-ldvh");

const LDVH_SETTINGS_SCHEMA = z.object({
  governanceDirectory: z.string().default(""),
  webEnabled: z.boolean().default(true),
}).default({});

const API_PREFIX = "/ldvh/api";
const SPA_PREFIX = "/ldvh";

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

/** Minimal backend handler until the migrated v4 services are wired in. */
function apiHandler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.end(JSON.stringify({ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }));
    return;
  }
  if (req.url === "/health" || req.url === "/health/") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, service: "dsh-ldvh", status: "ok", prefix: API_PREFIX }));
    return;
  }
  res.statusCode = 404;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND" }, path: req.url }));
}

/** Read the live web-enabled switch from the settings source. Absent = default enabled. */
function webEnabled(state) {
  const section = state.settingsSource?.();
  return section === void 0 || section === null ? true : section.webEnabled !== false;
}

/** Register both web routes; returns a single disposer removing both. */
function registerWebRoutes(webServer) {
  const apiDisposer = webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    handler: apiHandler
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

  // Sync the web route registration with the live webEnabled switch:
  // on → register (restart), off → unregister (stop). No-op when the host
  // webServer is absent (fail-closed, no route is ever claimed).
  function syncRoutes() {
    if (webServer === void 0) return;
    const enabled = webEnabled(state);
    if (enabled && state.disposeRoutes === null) {
      state.disposeRoutes = registerWebRoutes(webServer);
      ctx.logger.info("[dsh-ldvh] web routes registered under %s / %s", SPA_PREFIX, API_PREFIX);
    } else if (!enabled && state.disposeRoutes !== null) {
      state.disposeRoutes();
      state.disposeRoutes = null;
      ctx.logger.info("[dsh-ldvh] web routes disabled by setting");
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

  // Plugin-level cleanup: remove routes and drop the live source.
  ctx.effect(() => () => {
    if (state.disposeRoutes !== null) {
      try { state.disposeRoutes(); } catch { /* already removed */ }
      state.disposeRoutes = null;
    }
    state.settingsSource = void 0;
  }, "dsh-ldvh: web routes");
}