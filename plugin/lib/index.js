
import z from "@deepseek-ai/schemastery";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRegistrationCarrier, setCarrierObserver } from "./governed-projects.js";
import { createGovernanceHandler } from "./host-api.js";
import { createProxyHandler, createSpaHandler, createWebApiProcess } from "./web-mount.js";
import { createLifecycleRegistry } from "./lifecycle.js";
import { resolveIdleSettings } from "./idle-settings.js";
import { resolveReviewAskSettings } from "./review-ask.js";
import { resolveInjectionBudget } from "./source-recall.js";
import { createSessionScopes } from "./session-scopes.js";
import { createHostSeams } from "./host-seams.js";
import { createGreetingEnforcer } from "./greeting-enforcer.js";
import { loadFacts } from "./source-recall.js";
import { resolveGovernanceScope } from "./governance-scope.js";
import { repairHooksOnStartup } from "./hook-repair.js";
import { registerLdvhRpc, registerLdvhCommands } from "./rpc.js";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GATE_RUNNER_PATH = fileURLToPath(new URL("./git-gate-runner.js", import.meta.url));
const WEB_DIST_DIR = join(PACKAGE_ROOT, "web", "dist");
const WEB_API_PORT = Number(process.env.LDVH_WEB_API_PORT ?? 3299);
function webApiBridgeEnv(dshHomePath) {
  const env = {
    LDVH_WORKSPACE_ROOT: dirname(PACKAGE_ROOT),
  };
  try {
    env.LDVH_GOVERNED_PROJECTS_CONFIG = dshHomePath("ldvh", "governed-projects.yaml");
    env.LDVH_WEB_PREFERENCES = dshHomePath("ldvh", "web-preferences.yaml");
  } catch {
  }
  return env;
}

export const name = "dsh-ldvh";
export const inject = ["tools", "systemPrompt"];

function volatileField(schema) {
  return typeof schema?.volatile === "function" ? schema.volatile() : schema;
}

export const Config = z.object({
  webEnabled: volatileField(z.boolean().default(true)),
  showInConversationTab: volatileField(z.boolean().default(true)),
  showInSidebarTab: volatileField(z.boolean().default(true)),

  idleAssistEnabled: volatileField(z.boolean()),
  proxyAssistEnabled: volatileField(z.boolean().default(true)),
  experienceAccumulationEnabled: volatileField(z.boolean().default(true)),
  idleCaptureEnabled: volatileField(z.boolean().default(true)),
  frictionDiscoveryEnabled: volatileField(z.boolean()),
  experienceCaptureEnabled: volatileField(z.boolean()),
  experienceReviewEnabled: volatileField(z.boolean()),
  idleReviewEnabled: volatileField(z.boolean()),
  capacityMaintenanceEnabled: volatileField(z.boolean()),
  memoryHealthEnabled: volatileField(z.boolean()),

  injectionBudgetTier: volatileField(z.number().min(10).max(50).step(10).default(10)),

  preActionReviewAskEnabled: volatileField(z.boolean().default(false)),
  postWorkReviewAskEnabled: volatileField(z.boolean().default(false)),
  researchConsultAskEnabled: volatileField(z.boolean().default(false)),
  reviewAskSilentRunEnabled: volatileField(z.boolean().default(false)),
  reviewAskTimeoutEnabled: volatileField(z.boolean().default(false)),
  reviewAskTimeoutSeconds: volatileField(z.union([10, 30, 60]).default(30)),

  });

function readSwitch(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value.get === "function") return value.get() !== false;
  return value !== false;
}

function readVolatileNumber(value) {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value.get === "function" ? value.get() : value;
  const num = typeof raw === "string" ? Number(raw) : raw;
  if (typeof num === "number" && Number.isFinite(num)) return num;
  return Number.NaN;
}

const API_PREFIX = "/ldvh/api";
const SPA_PREFIX = "/ldvh";
const STATE_PREFIX = "/ldvh/state";

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function createApiHandler(dshHomePath, webApiProxy) {
  const governance = createGovernanceHandler({ dshHomePath, runnerPath: GATE_RUNNER_PATH, workspaceRoot: PACKAGE_ROOT });
  return async function apiHandler(req, res) {
    const url = new URL(req.url ?? "/", "http://ldvh.local");
    const rawPath = url.pathname;
    const path = rawPath === API_PREFIX ? "/" : (rawPath.startsWith(`${API_PREFIX}/`) ? rawPath.slice(API_PREFIX.length) : rawPath);
    if ((path === "/health" || path === "/health/") && (req.method === "GET" || req.method === "HEAD")) {
      json(res, 200, { ok: true, service: "dsh-ldvh", status: "ok", prefix: API_PREFIX, webPort: WEB_API_PORT });
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

function webEnabled(config) {
  return readSwitch(config?.webEnabled, true);
}

function gated(handler, config) {
  return (req, res, ...rest) => {
    if (!webEnabled(config)) {
      json(res, 404, { ok: false, error: { code: "LDVH_WEB_DISABLED" } });
      return undefined;
    }
    return handler(req, res, ...rest);
  };
}

function registerWebRoutes(webServer, dshHomePath, webApiProcess, logger, config) {
  const webApiProxy = createProxyHandler(webApiProcess, logger);
  const apiHandler = typeof dshHomePath === "function" ? createApiHandler(dshHomePath, webApiProxy) : createApiHandler(() => { throw new Error("DSH user configuration root is unavailable"); }, webApiProxy);
  const apiDisposer = webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    handler: gated(apiHandler, config)
  });
  const spaDisposer = webServer.register({
    kind: "prefix",
    path: SPA_PREFIX,
    handler: gated(createSpaHandler(WEB_DIST_DIR, logger), config)
  });
  return () => {
    try { apiDisposer(); } catch {   }
    try { spaDisposer(); } catch {   }
  };
}

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

export function apply(ctx, config) {
  const sessionScopes = createSessionScopes();
  const dshHomePath = ctx.get("dshHomePath");

  const hostSeams = createHostSeams();
  const seamsInstall = hostSeams.install(ctx, { dshHomePath });
  ctx.effect(() => () => {
    try { seamsInstall.dispose(); } catch {   }
    try { setCarrierObserver(null); } catch {   }
  }, "dsh-ldvh: host seam consumption");
  for (const seam of hostSeams.snapshot()) {
    ctx.logger.info("[dsh-ldvh] host seam %s: %s (%s)", seam.state, seam.seam, seam.detail);
  }
  setCarrierObserver((carrierPath) => hostSeams.observePath(carrierPath));

  const greetingEnforcer = createGreetingEnforcer({
    sessionScopes,
    projectCarriesNorm: async (projectPath) => {
      try {
        const facts = await loadFacts(join(projectPath, "ldvh-base"));
        return facts.some((fact) => fact.type === "norm" && fact.status === "active"
          && fact.structural?.directionKey === "ai-human-collaboration");
      } catch { return false; }
    },
    logger: ctx.logger,
  });
  const greetingStop = greetingEnforcer.install(ctx);
  ctx.effect(() => () => { try { greetingStop(); } catch {   } }, "dsh-ldvh: greeting enforcer");
  ctx.logger.info("[dsh-ldvh] greeting enforcer mounted: %s", JSON.stringify(greetingEnforcer.snapshot()));

  const lifecycle = createLifecycleRegistry(ctx, {
    dshHomePath,
    workspaceRoot: PACKAGE_ROOT,
    sessionScopes,
    hostSeams,
    getIdleSettings: () => resolveIdleSettings(config),
    getReviewAskSettings: () => resolveReviewAskSettings(config),
    getInjectionBudget: () => {
      const raw = readVolatileNumber(config?.injectionBudgetTier);
      return resolveInjectionBudget(raw);
    },
  });
  const stopLifecycle = lifecycle.start();


  ctx.inject(["webServer"], (webCtx) => {
    const webServer = webCtx.webServer;
    if (webServer === undefined) return;
    const disposeStateRoute = registerStateRoute(webServer, sessionScopes, dshHomePath);
    webCtx.logger.info("[dsh-ldvh] governance-state route registered under %s", STATE_PREFIX);
    const webApiProcess = createWebApiProcess({
      webRoot: join(PACKAGE_ROOT, "web"),
      port: WEB_API_PORT,
      env: webApiBridgeEnv(dshHomePath),
      logger: webCtx.logger,
    });
    void webApiProcess.ensureReady().then(() => {
      webCtx.logger.info("[dsh-ldvh] web api child warmed up on port %s", WEB_API_PORT);
    }).catch((error) => {
      webCtx.logger.warn("[dsh-ldvh] web api warm-up failed (will retry on first request): %s", error?.message ?? error);
    });
    const disposeRoutes = registerWebRoutes(webServer, dshHomePath, webApiProcess, webCtx.logger, config);
    webCtx.logger.info("[dsh-ldvh] web routes registered under %s / %s (webEnabled=%s)", SPA_PREFIX, API_PREFIX, webEnabled(config));
    webCtx.effect(() => () => {
      try { disposeRoutes(); } catch {   }
      try { webApiProcess.dispose(); } catch {   }
      try { disposeStateRoute(); } catch {   }
    }, "dsh-ldvh: web routes and state route");
  });

  ctx.inject(["connection"], (connectionCtx) => {
    const connection = connectionCtx.connection;
    if (connection === undefined) return;
    const disposeRpc = registerLdvhRpc(connection, { lifecycle });
    const disposeCommands = registerLdvhCommands(connectionCtx.get?.("commands") ?? ctx.get("commands"));
    connectionCtx.effect(() => () => {
      try { disposeRpc(); } catch {   }
      try { disposeCommands(); } catch {   }
    }, "dsh-ldvh: rpc and commands");
  });


  if (typeof dshHomePath === "function") {
    Promise.resolve(ensureRegistrationCarrier(dshHomePath))
      .then((ensured) => {
        if (ensured.created) ctx.logger.info("[dsh-ldvh] initialized empty governed-projects registration carrier");
        return repairHooksOnStartup({
          dshHomePath,
          runnerPath: GATE_RUNNER_PATH,
          workspaceRoot: PACKAGE_ROOT,
          logger: ctx.logger,
        });
      })
      .then((summary) => {
        ctx.logger.info(
          "[dsh-ldvh] governed-project startup check: %d project(s), %d Hook set(s) repaired, %d skipped, %d failed",
          summary.checked, summary.repaired.length, summary.skipped.length, summary.failed.length
        );
      })
      .catch((error) => ctx.logger.warn(error));
  }

  ctx.effect(() => async () => {
    try {
      await stopLifecycle();
    } finally {
      sessionScopes.clear();
    }
  }, "dsh-ldvh: lifecycle registry and session scopes");
}
