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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRegistrationCarrier, readGovernedProjects } from "./governed-projects.js";
import { createGovernanceHandler } from "./host-api.js";
import { createProxyHandler, createSpaHandler, createWebApiProcess } from "./web-mount.js";
import { createLifecycleRegistry } from "./lifecycle.js";
import { createSessionScopes } from "./session-scopes.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { registerLdvhRpc, registerLdvhCommands } from "./rpc.js";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GATE_RUNNER_PATH = fileURLToPath(new URL("./git-gate-runner.js", import.meta.url));
const WEB_DIST_DIR = join(PACKAGE_ROOT, "web", "dist");
const WEB_API_PORT = Number(process.env.LDVH_WEB_API_PORT ?? 3299);
/**
 * ⚠️ 临时桥接（docs/README-MIGRATION.md 同款声明）：Web 的 Express API 事实
 * 读取依赖 v4 归档的 Python Helper 与 v4 工作区配置。DSH Helper 集成落地后
 * 这里改指 v5 登记载体。与 plugin/web/restart.sh 保持同一数据源。
 */
/**
 * Web API 子进程的 v5 登记模式环境：LDVH_GOVERNED_PROJECTS_CONFIG 指向 v5 登记载体
 * （dshHomePath 下 ldvh/governed-projects.yaml，由本插件的安装事务拥有）——读取链
 * 不再经过 v4 Python Helper，治理验证由 Express 侧 Node git 解析完成（与插件
 * resolveGitRoot 同语义）。已知限制（README-MIGRATION.md）：v5 的调研对象在
 * ldvh-base/researches/（research 读取引擎属后续接线），study 类型列表在 v5
 * 项目上为空是如实呈现。
 */
function webApiBridgeEnv(dshHomePath) {
  const env = {
    LDVH_WORKSPACE_ROOT: dirname(PACKAGE_ROOT),
  };
  try {
    env.LDVH_GOVERNED_PROJECTS_CONFIG = dshHomePath("ldvh", "governed-projects.yaml");
  } catch {
    // DSH 用户配置根不可用时保持环境不含载体路径——Web 侧如实报配置不可读。
  }
  return env;
}

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

/**
 * LDVH API handler: health plus governed-project lifecycle operations, then a
 * fall-through proxy to the migrated Web Express child process. Local routes
 * (health + /governed-projects* governance endpoints) keep priority; every
 * other /ldvh/api path belongs to the Web API surface and is proxied.
 */
function createApiHandler(dshHomePath, webApiProxy) {
  const governance = createGovernanceHandler({ dshHomePath, runnerPath: GATE_RUNNER_PATH, workspaceRoot: PACKAGE_ROOT });
  return async function apiHandler(req, res) {
    const url = new URL(req.url ?? "/", "http://ldvh.local");
    const rawPath = url.pathname;
    const path = rawPath === API_PREFIX ? "/" : (rawPath.startsWith(`${API_PREFIX}/`) ? rawPath.slice(API_PREFIX.length) : rawPath);
    if ((path === "/health" || path === "/health/") && (req.method === "GET" || req.method === "HEAD")) {
      json(res, 200, { ok: true, service: "dsh-ldvh", status: "ok", prefix: API_PREFIX });
      return;
    }
    const handled = await governance(req, res);
    if (handled !== false) return;
    if (webApiProxy !== null) {
      await webApiProxy(req, res, path, url.search);
      return;
    }
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

/**
 * Register both web routes; returns a single disposer removing both. The Web
 * API child process is owned by the caller (created once per webServer mount,
 * outliving webEnabled toggles but disposed with the fiber) — route
 * registration and process lifetime are deliberately decoupled: toggling the
 * presentation switch must not kill a possibly in-flight child restart.
 */
function registerWebRoutes(webServer, dshHomePath, webApiProcess, logger) {
  const webApiProxy = createProxyHandler(webApiProcess, logger);
  const apiDisposer = webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    handler: typeof dshHomePath === "function" ? createApiHandler(dshHomePath, webApiProxy) : createApiHandler(() => { throw new Error("DSH user configuration root is unavailable"); }, webApiProxy)
  });
  const spaDisposer = webServer.register({
    kind: "prefix",
    path: SPA_PREFIX,
    handler: createSpaHandler(WEB_DIST_DIR, logger)
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
    // Web API 子进程：随 webServer 注入块创建/销毁（与 webEnabled 切换解耦——
    // 切换只挂/卸路由，不杀进程；插件停止/更新时统一处置）。懒启动：只有真的
    // 有 /ldvh/api 代理请求才会 spawn，测试与纯治理会话零开销。
    const webApiProcess = createWebApiProcess({
      webRoot: join(PACKAGE_ROOT, "web"),
      port: WEB_API_PORT,
      env: webApiBridgeEnv(dshHomePath),
      logger: webCtx.logger,
    });
    // 预热：挂载即启动子进程（懒启动省的是空闲会话的一次 ~0.3s，代价却是
    // 每次 DSH 重启后首次打开 Web 的整段冷启动等待——Human 反馈"比之前卡"的主因之一）。
    void webApiProcess.ensureReady().then(() => {
      webCtx.logger.info("[dsh-ldvh] web api child warmed up on port %s", WEB_API_PORT);
    }).catch((error) => {
      webCtx.logger.warn("[dsh-ldvh] web api warm-up failed (will retry on first request): %s", error?.message ?? error);
    });
    let disposeRoutes = null;
    const syncRoutes = () => {
      if (webEnabled(state)) {
        if (disposeRoutes === null) {
          disposeRoutes = registerWebRoutes(webServer, dshHomePath, webApiProcess, webCtx.logger);
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
      try { webApiProcess.dispose(); } catch { /* best effort */ }
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
