/**
 * Web 挂载三件套（DSH webServer → v4 迁移 Web 的接线层）。
 *
 * 1. createSpaHandler(distDir)   —— /ldvh 静态资源服务（vite build --base=/ldvh/
 *    产物）+ SPA 路由 fallback；dist 未构建时退回占位页并如实说明。
 * 2. createWebApiProcess(opts)   —— Web 的 Express API 以子进程形态托管
 *    （node --import tsx api/server.ts），懒启动、单飞、可处置。
 * 3. createProxyHandler(manager)  —— /ldvh/api 未命中插件本地路由（health +
 *    governed-projects 治理端点）时代理到子进程。
 *
 * 环境由调用方（index.js webApiBridgeEnv）注入：v5 登记模式——
 * LDVH_GOVERNED_PROJECTS_CONFIG 指向 v5 登记载体，治理验证走 Node git 解析，
 * 不依赖 v4 Python Helper。限制见 README-MIGRATION.md。
 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
};

/** 请求体上限：Web API 的 PUT（配置保存）payload 很小，50MB 是宽松上限。 */
const PROXY_BODY_LIMIT = 50 * 1024 * 1024;
const PROXY_RESPONSE_LIMIT = 50 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 120_000;

function isSafeMethod(method) {
  return method === "GET" || method === "HEAD";
}

/** URL 解码 + 越界防护后的静态文件候选路径；越界返回 null。 */
function resolveStaticCandidate(distDir, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  const candidate = resolve(join(distDir, relative));
  const root = resolve(distDir) + sep;
  return candidate.startsWith(root) ? candidate : null;
}

function sendFile(res, filePath, method) {
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) { res.statusCode = 500; res.setHeader("content-type", "text/plain; charset=utf-8"); }
    res.end("static read failed");
  });
  stream.on("open", () => {
    // 预压缩变体（.gz）的 MIME 按原始后缀计算——按 .gz 算成 octet-stream 会让
    // 浏览器下载而不是渲染（Electron iframe 同样触发下载保存）。
    const typeSuffix = filePath.endsWith(".gz") ? extname(filePath.slice(0, -3)) : extname(filePath);
    const type = MIME_TYPES[typeSuffix.toLowerCase()] ?? "application/octet-stream";
    res.setHeader("content-type", type);
    res.setHeader("cache-control", filePath.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
  });
  if (method === "HEAD") {
    stream.on("open", () => { stream.destroy(); res.end(); });
  } else {
    stream.pipe(res);
  }
}

/** dist 未构建时的占位页：如实说明构建命令，不假装系统故障。 */
function sendDistPlaceholder(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>LDVH</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#101114;color:#e6e6e6}
main{max-width:640px;padding:24px;text-align:center}h1{font-size:20px}p{color:#b8b8b8;line-height:1.6}
code{background:#202126;padding:2px 6px;border-radius:6px}</style>
<main><h1>LDVH Web</h1><p>Web 前端尚未构建。<br>请在 plugin/web 目录执行 <code>pnpm run build:dsh</code> 生成 dist 后刷新。</p>
<p>后端健康检查：<code>/ldvh/api/health</code></p></main></html>`);
}

/**
 * /ldvh 静态处理器。dist 存在时服务静态资源 + SPA fallback（非文件 GET 一律
 * 回 index.html，交给前端路由）；dist 缺失时退占位页。
 * handler 收到的 req.url 含 /ldvh 前缀（与既有 apiHandler 同一约定）。
 */
export function createSpaHandler(distDir, logger) {
  return async function spaHandler(req, res) {
    if (!isSafeMethod(req.method)) {
      res.statusCode = 405;
      res.setHeader("allow", "GET, HEAD");
      res.end("method not allowed");
      return;
    }
    const url = new URL(req.url ?? "/", "http://ldvh.local");
    const stripped = url.pathname === "/ldvh" ? "/" : (url.pathname.startsWith("/ldvh/") ? url.pathname.slice("/ldvh".length) : url.pathname);
    let indexStat = null;
    try { indexStat = await lstat(join(distDir, "index.html")); } catch { indexStat = null; }
    if (indexStat === null || !indexStat.isFile()) {
      sendDistPlaceholder(res);
      return;
    }
    const startedAt = Date.now();
    const finish = (filePath) => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > 300 && logger) logger.warn("[dsh-ldvh spa] slow static %s %s -> %sms", req.method, stripped, elapsed);
      void filePath;
    };
    const acceptsGzip = String(req.headers["accept-encoding"] ?? "").includes("gzip");
    const candidate = resolveStaticCandidate(distDir, stripped);
    if (candidate !== null) {
      try {
        const stat = await lstat(candidate);
        if (stat.isFile()) {
          // 预压缩优先：build:dsh 的 gzip 后处理产物（.gz）比在线压缩省掉整段 CPU，
          // 且把跨事件循环字节数降到 1/4（1.8MB bundle → ~450KB）。
          if (acceptsGzip) {
            try {
              const gzStat = await lstat(`${candidate}.gz`);
              if (gzStat.isFile()) {
                res.setHeader("content-encoding", "gzip");
                res.setHeader("vary", "accept-encoding");
                sendFile(res, `${candidate}.gz`, req.method);
                finish(candidate);
                return;
              }
            } catch { /* no precompressed variant */ }
          }
          res.setHeader("vary", "accept-encoding");
          sendFile(res, candidate, req.method);
          finish(candidate);
          return;
        }
      } catch { /* fall through to SPA */ }
    }
    // SPA fallback 也走预压缩 index.html.gz。
    if (acceptsGzip) {
      try {
        const gzStat = await lstat(join(distDir, "index.html.gz"));
        if (gzStat.isFile()) {
          res.setHeader("content-encoding", "gzip");
          res.setHeader("vary", "accept-encoding");
          sendFile(res, join(distDir, "index.html.gz"), req.method);
          finish("index.html.gz");
          return;
        }
      } catch { /* no precompressed variant */ }
    }
    sendFile(res, join(distDir, "index.html"), req.method);
    finish("index.html");
  };
}

/**
 * Web Express API 子进程管理器。
 *
 * - 懒启动：首个被代理的请求才 spawn（测试与未使用 Web 的会话零开销）；
 * - 单飞：并发请求只触发一次启动；
 * - 就绪探测：轮询子进程 /api/health；
 * - 退出处置：dispose() SIGTERM→SIGKILL；意外退出后下次 ensureReady 重拉。
 */
export function createWebApiProcess(options) {
  const {
    webRoot,
    port,
    env,
    logger,
    command = { exec: process.execPath, argv: ["--import", "tsx", "api/server.ts"] },
    readinessPath = "/api/health",
    readinessTimeoutMs = 30_000,
    watchSource = true,
  } = options ?? {};
  let spawned = null;
  let exited = true;
  let starting = null;
  let disposed = false;
  // 源码热刷新：监听 api/ 目录（子进程跑的是 link: 仓库的实时文件——源码更新后
  // 长驻子进程仍是旧码，须杀掉让下次请求重拉）。1s 去抖避免构建期连杀。
  let watchTimer = null;
  let watcher = null;
  if (watchSource) {
    import("node:fs").then((fs) => {
      // 竞态防护：import() 是异步的，watcher 要等这个 then 回调才存在；若
      // dispose() 在这之前同步跑完，它会看到 watcher 仍为 null 而跳过 close，
      // 随后这里再创建的 watcher 就再也没人关闭——进程被永久挂住。
      //
      // 该泄漏在 macOS 上被 watcher.unref?.() 掩盖（darwin 的 FSEvent 支持
      // unref），但 Linux 的 inotify 句柄**不受 unref 影响**，实测进程无法退出。
      // 故不能只依赖 unref：dispose 之后一律不再创建，已创建的一律在 dispose 关闭。
      if (disposed) return;
      watcher = fs.watch(join(webRoot, "api"), { recursive: true }, () => {
        if (disposed) return;
        if (watchTimer !== null) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          watchTimer = null;
          if (!disposed && spawned !== null && !exited) {
            if (logger) logger.info("[dsh-ldvh web-api] source change detected, recycling child for next request");
            try { spawned.kill("SIGTERM"); } catch { /* best effort */ }
            setTimeout(() => { try { spawned.kill("SIGKILL"); } catch { /* best effort */ } }, 3000).unref?.();
          }
        }, 1000);
      });
      watcher.on("error", () => { /* watch 不可用时静默退化为手动重启 */ });
      // 二次检查：watcher 创建与赋值之间不会让出事件循环，但仍保留此关口，
      // 以便 dispose 在任何 await 边界之后发生也能覆盖到。
      if (disposed) {
        try { watcher.close(); } catch { /* already closed */ }
        watcher = null;
        return;
      }
      // unref 只是补充手段（darwin 有效、Linux inotify 无效），真正的保障是
      // dispose() 中的显式 close。
      watcher.unref?.();
    }).catch(() => { /* fs 不可用（理论不可达） */ });
  }

  async function pollReadiness() {
    const deadline = Date.now() + readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (disposed || exited) throw new Error("web api child exited during startup");
      try {
        const response = await fetch(`http://127.0.0.1:${port}${readinessPath}`, { signal: AbortSignal.timeout(1500) });
        if (response.ok) return;
      } catch { /* keep polling */ }
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error(`web api child did not become ready within ${readinessTimeoutMs}ms`);
  }

  function spawnOnce() {
    starting = (async () => {
      if (disposed) return null;
      // ELECTRON_RUN_AS_NODE：宿主是 Electron（DSH Desktop）时 process.execPath
      // 指向 Electron 二进制——直接 spawn 等于启动新应用实例（撞单实例锁即退，
      // 实测 child exited with code 0）。该标志让 Electron 以纯 Node 模式运行；
      // 在普通 node 宿主（测试 harness）下此变量无害被忽略。
      const proc = (await import("node:child_process")).spawn(command.exec, command.argv, {
        cwd: webRoot,
        env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), LDVH_WEB_BIND_HOST: "127.0.0.1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      spawned = proc;
      exited = false;
      proc.on("exit", (code) => {
        exited = true;
        if (!disposed && logger) logger.warn("[dsh-ldvh web-api] child exited with code %s", code ?? "unknown");
      });
      proc.stdout.on("data", (chunk) => { const text = String(chunk).trim(); if (text && logger) logger.info("[dsh-ldvh web-api] %s", text); });
      proc.stderr.on("data", (chunk) => { const text = String(chunk).trim(); if (text && logger) logger.warn("[dsh-ldvh web-api] %s", text); });
      proc.on("error", (error) => {
        exited = true;
        if (logger) logger.error("[dsh-ldvh web-api] spawn failed: %s", error?.message ?? error);
      });
      try {
        await pollReadiness();
        return { port };
      } catch (error) {
        try { proc.kill("SIGKILL"); } catch { /* best effort */ }
        throw error;
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  return {
    async ensureReady() {
      if (disposed) return null;
      if (starting !== null) return starting;
      if (spawned !== null && !exited) return { port };
      return spawnOnce();
    },
    isRunning() {
      return !disposed && spawned !== null && !exited;
    },
    dispose() {
      disposed = true;
      // 显式关闭 watcher：这是进程能退出的**唯一可靠保障**——watcher.unref?.()
      // 在 Linux 的 inotify 下无效（实测进程被永久挂住），只在 darwin 生效。
      try { watcher?.close(); } catch { /* already closed */ }
      watcher = null;
      // 清掉待触发的去抖定时器，避免 dispose 后仍有回调计划执行。
      if (watchTimer !== null) {
        clearTimeout(watchTimer);
        watchTimer = null;
      }
      if (spawned !== null && !exited) {
        const proc = spawned;
        try { proc.kill("SIGTERM"); } catch { /* best effort */ }
        setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* best effort */ } }, 3000).unref?.();
      }
      spawned = null;
      exited = true;
    },
  };
}

async function readRequestBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function forwardableHeaders(headers) {
  const copy = { ...headers };
  for (const key of ["host", "connection", "content-length", "transfer-encoding", "keep-alive"]) delete copy[key];
  return copy;
}

/**
 * /ldvh/api 代理：把未命中插件本地路由的请求转发给 Web Express 子进程。
 * strippedPath 是已剥去 /ldvh/api 前缀的路径（如 /settings/governed-projects），
 * 子进程侧目标为 /api{strippedPath}。
 */
export function createProxyHandler(manager, logger) {
  return async function proxyHandler(req, res, strippedPath, search) {
    const ready = await manager.ensureReady();
    if (ready === null) {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "web api process is not available" }));
      return;
    }
    let body = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try { body = await readRequestBody(req, PROXY_BODY_LIMIT); }
      catch (error) {
        res.statusCode = 413;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
        return;
      }
    }
    const proxiedAt = Date.now();
    const target = `http://127.0.0.1:${ready.port}/api${strippedPath}${search ?? ""}`;
    const headers = forwardableHeaders(req.headers);
    if (body !== null) headers["content-length"] = String(body.length);
    let upstream = null;
    try {
      upstream = await new Promise((resolveRequest, rejectRequest) => {
        const request = http.request(target, { method: req.method, headers, timeout: PROXY_TIMEOUT_MS }, (response) => resolveRequest(response));
        request.on("timeout", () => { request.destroy(new Error("upstream timeout")); });
        request.on("error", rejectRequest);
        if (body !== null) request.end(body);
        else req.pipe(request);
      });
    } catch (error) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: `web api proxy failed: ${String(error?.message ?? error)}` }));
      return;
    }
    const responseHeaders = forwardableHeaders(upstream.headers);
    res.writeHead(upstream.statusCode ?? 502, responseHeaders);
    upstream.on("close", () => {
      const elapsed = Date.now() - proxiedAt;
      if (elapsed > 300 && logger) logger.warn("[dsh-ldvh web-api] slow proxy %s %s -> %sms", req.method, strippedPath, elapsed);
    });
    let total = 0;
    upstream.on("data", (chunk) => {
      total += chunk.length;
      if (total > PROXY_RESPONSE_LIMIT) { upstream.destroy(); res.end(); return; }
      res.write(chunk);
    });
    upstream.on("end", () => res.end());
    upstream.on("error", () => res.end());
  };
}
