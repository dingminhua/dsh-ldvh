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

const PROXY_BODY_LIMIT = 50 * 1024 * 1024;
const PROXY_RESPONSE_LIMIT = 50 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 120_000;

const WATCHED_SOURCE_ROOTS = Object.freeze(["api", "shared"]);

function isSafeMethod(method) {
  return method === "GET" || method === "HEAD";
}

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
            } catch {   }
          }
          res.setHeader("vary", "accept-encoding");
          sendFile(res, candidate, req.method);
          finish(candidate);
          return;
        }
      } catch {   }
    }
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
      } catch {   }
    }
    sendFile(res, join(distDir, "index.html"), req.method);
    finish("index.html");
  };
}

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
    debounceMs = 1500,
    recycleThrottleMs = 500,
    recheckBaseMs = 250,
    recheckMaxMs = 5000,
    hardKillMs = 3000,
    rewarmDelayMs = 250,
  } = options ?? {};
  let spawned = null;
  let exited = true;
  let starting = null;
  let disposed = false;
  let reportedPort = null;
  let watchTimer = null;
  let watcher = null;
  let watchTargetPath = null;
  let sourceFingerprint = null;
  let pendingFingerprint = null;
  let recheckTimer = null;
  let lastRecycle = null;
  let recycling = false;
  async function recycleChild(reason) {
    const proc = spawned;
    if (proc === null || exited || disposed || recycling) return false;
    if (lastRecycle !== null && Date.now() - lastRecycle < recycleThrottleMs) return false;
    lastRecycle = Date.now();
    recycling = true;
    if (logger) logger.info("[dsh-ldvh web-api] %s, recycling child and warming a replacement up", reason);
    try { proc.kill("SIGTERM"); } catch {   }
    const hard = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {   } }, hardKillMs);
    hard.unref?.();
    await new Promise((done) => {
      if (exited || proc.exitCode !== null || proc.signalCode !== null) { done(); return; }
      proc.once("exit", () => done());
      setTimeout(done, 5000).unref?.();
    });
    if (spawned === proc) spawned = null;
    if (disposed) { recycling = false; return false; }
    try {
      await ensureReady();
      if (logger) logger.info("[dsh-ldvh web-api] replacement child ready on port %s", effectivePort());
    } catch (error) {
      if (logger) logger.warn("[dsh-ldvh web-api] replacement warm-up failed: %s", error?.message ?? error);
    } finally {
      recycling = false;
    }
    return true;
  }
  let recheckDelayMs = recheckBaseMs;
  async function runRecheck() {
    recheckTimer = null;
    if (disposed || pendingFingerprint === null) return;
    if (recycling || spawned === null || exited) {
      recheckTimer = setTimeout(() => { void runRecheck(); }, recheckDelayMs);
      recheckTimer.unref?.();
      return;
    }
    const seen = pendingFingerprint;
    pendingFingerprint = null;
    if (seen === sourceFingerprint) return;
    const recycled = await recycleChild("web source content changed (api/ or shared/, requeued)");
    if (recycled) { sourceFingerprint = seen; recheckDelayMs = recheckBaseMs; return; }
    if (disposed) return;
    pendingFingerprint = seen;
    recheckDelayMs = Math.min(recheckDelayMs * 2, recheckMaxMs);
    recheckTimer = setTimeout(() => { void runRecheck(); }, recheckDelayMs);
    recheckTimer.unref?.();
  }
  function scheduleRecheck() {
    if (disposed || recheckTimer !== null) return;
    recheckTimer = setTimeout(() => { void runRecheck(); }, recheckDelayMs);
    recheckTimer.unref?.();
  }
  if (watchSource) {
    import("node:fs").then(async (fs) => {
      const nodeCrypto = await import("node:crypto");
      const fingerprintSourceTree = async () => {
        const files = [];
        const walk = async (dir) => {
          let entries;
          try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) { await walk(full); continue; }
            if (entry.isFile()) files.push(full);
          }
        };
        for (const root of WATCHED_SOURCE_ROOTS) await walk(join(webRoot, root));
        files.sort();
        const hash = nodeCrypto.createHash("sha1");
        for (const file of files) {
          let content;
          try { content = await fs.promises.readFile(file); } catch { continue; }
          hash.update(`${file}\0${content.length}\0`);
          hash.update(nodeCrypto.createHash("sha1").update(content).digest());
        }
        return hash.digest("hex");
      };
      const probeFingerprint = async () => fingerprintSourceTree().catch(() => null);

      const onWatchEvent = () => {
        if (disposed) return;
        if (watchTimer !== null) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          watchTimer = null;
          if (disposed || spawned === null || exited) return;
          void (async () => {
            if (disposed || spawned === null || exited) return;
            const next = await probeFingerprint();
            if (next === null) return;
            const previous = sourceFingerprint;
            if (previous === null || next === previous) { sourceFingerprint = next; return; }
            const recycled = await recycleChild("web source content changed (api/ or shared/)");
            if (recycled) { sourceFingerprint = next; return; }
            if (disposed) return;
            pendingFingerprint = next;
            void scheduleRecheck();
          })();
        }, debounceMs);
      };

      sourceFingerprint = await probeFingerprint();

      if (disposed) return;
      const watchTargets = WATCHED_SOURCE_ROOTS.map((root) => {
        const target = join(webRoot, root);
        try { return fs.realpathSync.native(target); } catch { return target; }
      });
      watchTargetPath = watchTargets;
      const watchers = [];
      for (const watchTarget of watchTargets) {
        let w;
        try { w = fs.watch(watchTarget, { recursive: true }, onWatchEvent); } catch { continue; }
        watchers.push(w);
      }
      watchers.forEach((w) => w.on("error", () => {   }));
      watcher = watchers;
      if (disposed) {
        for (const w of watchers) { try { w.close(); } catch {   } }
        watcher = null;
        return;
      }
      for (const w of watchers) w.unref?.();
    }).catch(() => {   });
  }

  function effectivePort() {
    return reportedPort !== null ? reportedPort : port;
  }

  async function pollReadiness() {
    const deadline = Date.now() + readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (disposed || exited) throw new Error("web api child exited during startup");
      try {
        const response = await fetch(`http://127.0.0.1:${effectivePort()}${readinessPath}`, { signal: AbortSignal.timeout(1500) });
        if (response.ok) return;
      } catch {   }
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error(`web api child did not become ready within ${readinessTimeoutMs}ms`);
  }

  function spawnOnce() {
    starting = (async () => {
      if (disposed) return null;
      const proc = (await import("node:child_process")).spawn(command.exec, command.argv, {
        cwd: webRoot,
        env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), LDVH_WEB_BIND_HOST: "127.0.0.1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      spawned = proc;
      exited = false;
      proc.on("exit", (code) => {
        if (spawned !== proc) return;
        exited = true;
        if (spawned === proc) spawned = null;
        reportedPort = null;
        if (disposed) return;
        if (logger) logger.warn("[dsh-ldvh web-api] child exited with code %s", code ?? "unknown");
        if (recycling) return;
        setTimeout(() => {
          if (disposed || spawned !== null) return;
          ensureReady().catch((error) => {
            if (logger) logger.warn("[dsh-ldvh web-api] re-warm after unexpected exit failed: %s", error?.message ?? error);
          });
        }, rewarmDelayMs).unref?.();
      });
      let stdoutBuffer = "";
      const portLine = /^LDVH_WEB_PORT=(\d{2,5})$/;
      proc.stdout.on("data", (chunk) => {
        const text = String(chunk);
        stdoutBuffer += text;
        let newline = stdoutBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = stdoutBuffer.slice(0, newline).trim();
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          const match = line.match(portLine);
          if (match !== null) {
            const value = Number(match[1]);
            if (Number.isInteger(value) && value > 0 && value <= 65535) reportedPort = value;
          }
          newline = stdoutBuffer.indexOf("\n");
        }
        if (text.trim() && logger) logger.info("[dsh-ldvh web-api] %s", text.trim());
      });
      reportedPort = null;
      proc.stderr.on("data", (chunk) => { const text = String(chunk).trim(); if (text && logger) logger.warn("[dsh-ldvh web-api] %s", text); });
      proc.on("error", (error) => {
        if (spawned !== proc) return;
        exited = true;
        if (logger) logger.error("[dsh-ldvh web-api] spawn failed: %s", error?.message ?? error);
      });
      try {
        await pollReadiness();
        return { port: effectivePort() };
      } catch (error) {
        try { proc.kill("SIGKILL"); } catch {   }
        throw error;
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  async function ensureReady() {
    if (disposed) return null;
    if (starting !== null) return starting;
    if (spawned !== null && !exited) return { port: effectivePort() };
    return spawnOnce();
  }

  return {
    ensureReady,
    currentPort() {
      return effectivePort();
    },
    isRunning() {
      return !disposed && spawned !== null && !exited;
    },
    watchTargets() {
      return watchTargetPath === null ? [] : [...watchTargetPath];
    },
    dispose() {
      disposed = true;
      for (const w of (Array.isArray(watcher) ? watcher : (watcher ? [watcher] : []))) {
        try { w.close(); } catch {   }
      }
      watcher = null;
      if (watchTimer !== null) {
        clearTimeout(watchTimer);
        watchTimer = null;
      }
      if (recheckTimer !== null) {
        clearTimeout(recheckTimer);
        recheckTimer = null;
      }
      pendingFingerprint = null;
      if (spawned !== null && !exited) {
        const proc = spawned;
        try { proc.kill("SIGTERM"); } catch {   }
        setTimeout(() => { try { proc.kill("SIGKILL"); } catch {   } }, hardKillMs).unref?.();
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
    for (const key of ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user", "origin", "referer"]) delete headers[key];
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
