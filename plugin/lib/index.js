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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRegistrationCarrier, readGovernedProjects, setCarrierObserver } from "./governed-projects.js";
import { createGovernanceHandler } from "./host-api.js";
import { createProxyHandler, createSpaHandler, createWebApiProcess } from "./web-mount.js";
import { createLifecycleRegistry } from "./lifecycle.js";
import { createSessionScopes } from "./session-scopes.js";
import { createHostSeams } from "./host-seams.js";
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
    env.LDVH_WEB_PREFERENCES = dshHomePath("ldvh", "web-preferences.yaml");
  } catch {
    // DSH 用户配置根不可用时保持环境不含载体路径——Web 侧如实报配置不可读。
  }
  return env;
}

export const name = "dsh-ldvh";
// 不再声明 "settings"：0.1.7 起设置值由本插件自己的 Cordis Config 承载，
// 宿主把 Config 的 volatile 字段投影成表单；插件不再注册 settings 命名空间，
// 也不再消费 ctx.settings 服务（依据：docs/dsh-0.1.5-rc2-to-0.1.7-rc1-research.md §3.2）。
export const inject = ["tools", "systemPrompt"];

/**
 * LDVH 的可配置面（DSH 0.1.7+ 设置模型：插件自己的 Config 即设置）。
 *
 * 与旧模型的差别（调研 §3.2「设置模型整体重建」）：
 *   - 旧：installSettingsSection(ctx, ns, schema, …) 注册独立命名空间，值存
 *     $DSH_HOME/settings.yaml，经 setSource / onChange 回调通知变更；
 *   - 新：以下字段就是 Loader 条目（id = `dsh-ldvh`）的 Config；宿主把带
 *     `.volatile()` 的字段投影成设置表单，写回 profile 的 cordis.patch.yml。
 *
 * volatile 字段的读法：解析结果是 cosmokit 的 Volatile 引用 —— 只有 get()，
 * 没有订阅；宿主热改时把新值写进同一引用。所以每次现读即可（readSwitch），
 * 既不需要也拿不到变更通知。`.volatile()` 必须链在字段表达式最后。
 */
/**
 * 声明一个可热改字段（schemastery 的 `.volatile()`）。
 *
 * `.volatile()` 自 schemastery 3.18.4 起提供：宿主 0.1.7-rc.1 用它把字段投影成
 * 「改设置实时生效、不重挂插件」的表单字段（解析结果是只有 get() 的引用）。旧版
 * schemastery（如 3.18.2）没有该方法，直接链式调用会在**模块加载期**抛 TypeError，
 * 让整个插件起不来——所以先探测再调用：缺失时退化为普通字段（设置照旧可读可写，
 * 只是不享受热改语义），由消费点如实呈现，而不是让插件整体消失。
 *
 * @param {object} schema - schemastery 字段。
 * @returns {object} 标记为 volatile 的字段（不支持时原样返回）。
 */
function volatileField(schema) {
  return typeof schema?.volatile === "function" ? schema.volatile() : schema;
}

export const Config = z.object({
  /** 是否挂载 /ldvh + /ldvh/api 前缀路由（宿主 webServer 本身始终运行）。 */
  webEnabled: volatileField(z.boolean().default(true)),
  /** 对话 Tab 投放面（conversation.view 插槽）；仅在 webEnabled 开启时生效。 */
  showInConversationTab: volatileField(z.boolean().default(true)),
  /** 侧边栏投放面（betterSidebar 的 LDVH tab）；仅在 webEnabled 开启时生效。 */
  showInSidebarTab: volatileField(z.boolean().default(true)),
});

/**
 * 读一个可热改开关的当前值，两代宿主通吃。
 *
 * 0.1.7+ 的 volatile 字段是 `{ get() }` 引用；更早的宿主（或未经 volatile
 * 包装的普通值）直接就是布尔。缺省一律按「开」处理，与旧实现的 webEnabled()
 * 语义一致（section 缺失 = 默认启用）。
 *
 * @param {{get?: () => unknown}|unknown} value - Config 字段的解析结果。
 * @param {boolean} fallback - 值为 undefined / null 时的答案。
 * @returns {boolean} 开关当前值。
 */
function readSwitch(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value.get === "function") return value.get() !== false;
  return value !== false;
}

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
      // `webPort` 供客户端 iframe 拼绝对地址（见 lib/client.js 的 ldvhWebOrigin）。
      // 客户端不能硬编码端口——宿主侧端口可被 LDVH_WEB_API_PORT 覆盖，硬编码会漂移。
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

/**
 * 读「是否挂载 LDVH Web 路由」的当前值（缺省视为启用）。
 *
 * 新模型没有设置变更通知（volatile 只有 get()），所以开关不再触发重挂路由，
 * 而是由 gated() 在每次请求时现判 —— 关闭后立即生效，不依赖任何回调。
 */
function webEnabled(config) {
  return readSwitch(config?.webEnabled, true);
}

/**
 * 把「是否挂载」开关挪进请求路径。
 *
 * 旧实现靠设置变更回调真正摘掉路由；新模型拿不到变更通知，于是改为
 * 「注册一次、请求时现判」：关闭后 /ldvh 与 /ldvh/api 立即不可用，且不会
 * 因缺通知而停在旧状态。/ldvh/state 不经此包装（always-on 治理状态面）。
 *
 * @param {(req: object, res: object, ...rest: unknown[]) => unknown} handler - 真正的前缀处理器。
 * @param {object} config - 本插件的 Cordis Config。
 * @returns {(req: object, res: object, ...rest: unknown[]) => unknown} 带开关判断的处理器。
 */
function gated(handler, config) {
  return (req, res, ...rest) => {
    if (!webEnabled(config)) {
      json(res, 404, { ok: false, error: { code: "LDVH_WEB_DISABLED" } });
      return undefined;
    }
    return handler(req, res, ...rest);
  };
}

/**
 * Register both web routes; returns a single disposer removing both. The Web
 * API child process is owned by the caller (created once per webServer mount,
 * outliving webEnabled toggles but disposed with the fiber) — route
 * registration and process lifetime are deliberately decoupled: toggling the
 * presentation switch must not kill a possibly in-flight child restart.
 *
 * 0.1.7 起开关不再是「挂/卸路由」，而是由 gated() 在请求路径上现判（config
 * 的 volatile 字段没有变更通知）。因此本函数注册一次即长期有效，关闭开关
 * 只改变请求结果，不改路由账本。
 */
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

export function apply(ctx, config) {
  const sessionScopes = createSessionScopes();
  const dshHomePath = ctx.get("dshHomePath");

  // Per-agent lifecycle: agent/created install + adoption of already-live
  // specs/08 §6: consume the host seams this composition provides. Installed
  // BEFORE the lifecycle, because the lifecycle hands the registry to the tool
  // batch so the 07 §5.6 Human Gate can route through ctx.userQuestions.ask.
  // Each seam is registered on this plugin's own fiber, so nothing survives
  // stop/update. Unconsumed seams are reported in snapshot() rather than
  // hidden (08 §6 forbids claiming protection a seam's absence did not deliver).
  const hostSeams = createHostSeams();
  const seamsInstall = hostSeams.install(ctx, { dshHomePath });
  ctx.effect(() => () => {
    try { seamsInstall.dispose(); } catch { /* already removed */ }
    // Detach the read observer too: without this, a stopped plugin would keep
    // recording observations into the module map, contradicting the "nothing
    // leaks past plugin stop" discipline.
    try { setCarrierObserver(null); } catch { /* already detached */ }
  }, "dsh-ldvh: host seam consumption");
  for (const seam of hostSeams.snapshot()) {
    ctx.logger.info("[dsh-ldvh] host seam %s: %s (%s)", seam.state, seam.seam, seam.detail);
  }
  // 08 §6 read half, wired to the real read path: every LDVH read of the
  // registration carrier records an authoritative observation, so the
  // fs/write-intent guard below keys writes to a host-reported version.
  setCarrierObserver((carrierPath) => hostSeams.observePath(carrierPath));

  // Per-agent lifecycle: agent/created install + adoption of already-live
  // agents; guidance injection, tools guard and the pre-step skeleton all
  // live behind this registry (framework doc §4 points 1–2, 4–5).
  const lifecycle = createLifecycleRegistry(ctx, {
    dshHomePath,
    workspaceRoot: PACKAGE_ROOT,
    sessionScopes,
    hostSeams
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
    // 路由注册一次即长期有效：开关由 gated() 在请求路径上现判（见 registerWebRoutes）。
    // Web API 子进程与路由账本解耦——切换开关不杀可能正在重启的子进程。
    const disposeRoutes = registerWebRoutes(webServer, dshHomePath, webApiProcess, webCtx.logger, config);
    webCtx.logger.info("[dsh-ldvh] web routes registered under %s / %s (webEnabled=%s)", SPA_PREFIX, API_PREFIX, webEnabled(config));
    webCtx.effect(() => () => {
      try { disposeRoutes(); } catch { /* already removed */ }
      try { webApiProcess.dispose(); } catch { /* best effort */ }
      try { disposeStateRoute(); } catch { /* already removed */ }
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

  // 设置面：三个开关由本插件 Cordis Config 的 volatile 字段承载（见文件头的
  // Config 声明），宿主把它们投影成设置表单并写进 profile patch。这里不再注册
  // 任何 settings 命名空间，也没有 setSource / onChange 回调可挂——新模型没有
  // 变更通知，开关一律由消费点现读（webEnabled(config) / 客户端 configForms）。

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
  }, "dsh-ldvh: lifecycle registry and session scopes");
}
