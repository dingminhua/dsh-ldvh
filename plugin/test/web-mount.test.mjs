import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { createProxyHandler, createSpaHandler, createWebApiProcess } from "../lib/web-mount.js";

const longTempDir = () => realpathSync.native(tmpdir());

async function withHandler(handler, fn) {
  const server = http.createServer((req, res) => { void Promise.resolve(handler(req, res)).catch((error) => { res.statusCode = 500; res.end(String(error?.message ?? error)); }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("spa handler serves dist assets, SPA fallback, and blocks traversal", async () => {
  const dist = await mkdtemp(join(tmpdir(), "ldvh-web-mount-"));
  await writeFile(join(dist, "index.html"), "<html>app</html>");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "assets", "app.js"), "console.log('app')");
  await mkdir(join(dist, "deep"), { recursive: true });
  await writeFile(join(dist, "deep", "nested.txt"), "nested");
  const handler = createSpaHandler(dist);
  await withHandler(handler, async (base) => {
    const root = await fetch(`${base}/ldvh`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-type"), /text\/html/);
    assert.match(await root.text(), /app/);
    const asset = await fetch(`${base}/ldvh/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /text\/javascript/);
    const spa = await fetch(`${base}/ldvh/federation/objects/spark`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /app/);
    const nested = await fetch(`${base}/ldvh/deep/nested.txt`);
    assert.equal(nested.status, 200);
    assert.equal(await nested.text(), "nested");
    const traversal = await fetch(`${base}/ldvh/..%2f..%2fetc`);
    assert.equal(traversal.status, 200);
    assert.match(await traversal.text(), /app/);
    const post = await fetch(`${base}/ldvh/`, { method: "POST" });
    assert.equal(post.status, 405);
  });
});

test("spa handler serves precompressed .gz with the ORIGINAL content type (not octet-stream)", async () => {
  const dist = await mkdtemp(join(tmpdir(), "ldvh-web-mount-gz-"));
  await writeFile(join(dist, "index.html"), "<html>app</html>");
  await writeFile(join(dist, "index.html.gz"), gzipSync("<html>app</html>"));
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "assets", "app.js"), "console.log('app')");
  await writeFile(join(dist, "assets", "app.js.gz"), gzipSync("console.log('app')"));
  const handler = createSpaHandler(dist);
  await withHandler(handler, async (base) => {
    const html = await fetch(`${base}/ldvh`, { headers: { "accept-encoding": "gzip" } });
    assert.equal(html.status, 200);
    assert.equal(html.headers.get("content-encoding"), "gzip");
    assert.match(html.headers.get("content-type"), /text\/html/);
    const js = await fetch(`${base}/ldvh/assets/app.js`, { headers: { "accept-encoding": "gzip" } });
    assert.equal(js.status, 200);
    assert.equal(js.headers.get("content-encoding"), "gzip");
    assert.match(js.headers.get("content-type"), /text\/javascript/);
    assert.equal(await js.text(), "console.log('app')");
  });
});

test("spa handler falls back to the honest placeholder when dist is missing", async () => {
  const handler = createSpaHandler(join(tmpdir(), "ldvh-web-mount-does-not-exist"));
  await withHandler(handler, async (base) => {
    const response = await fetch(`${base}/ldvh`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /build:dsh/);
  });
});

test("proxy handler maps /ldvh/api paths to the child /api surface with method and body", async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, body, contentType: req.headers["content-type"] });
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ echoed: req.url }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = upstream.address().port;
  const manager = { ensureReady: async () => ({ port: upstreamPort }) };
  const proxy = createProxyHandler(manager);
  try {
    await withHandler((req, res) => proxy(req, res, "/settings/governed-projects", "?project=ldvh"), async (base) => {
      const get = await fetch(`${base}/anything`);
      assert.equal(get.status, 200);
      assert.equal((await get.json()).echoed, "/api/settings/governed-projects?project=ldvh");
      assert.equal(seen.at(-1).method, "GET");
    });
    await withHandler((req, res) => proxy(req, res, "/settings/governed-projects", ""), async (base) => {
      const put = await fetch(`${base}/anything`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "ldvh" }),
      });
      assert.equal(put.status, 200);
      const record = seen.at(-1);
      assert.equal(record.method, "PUT");
      assert.equal(record.url, "/api/settings/governed-projects");
      assert.equal(record.contentType, "application/json");
      assert.equal(record.body, JSON.stringify({ hello: "ldvh" }));
    });
  } finally {
    upstream.closeAllConnections?.();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("proxy handler strips browser origin metadata before forwarding to the child API", async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push({
      "sec-fetch-site": req.headers["sec-fetch-site"],
      "sec-fetch-mode": req.headers["sec-fetch-mode"],
      origin: req.headers.origin,
      referer: req.headers.referer,
      "content-type": req.headers["content-type"],
    });
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const manager = { ensureReady: async () => ({ port: upstream.address().port }) };
  const proxy = createProxyHandler(manager);
  try {
    await withHandler((req, res) => proxy(req, res, "/objects", ""), async (base) => {
      const res = await fetch(`${base}/anything`, {
        headers: {
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "cors",
          origin: "null",
          referer: "http://127.0.0.1:56248/ldvh",
          "content-type": "application/json",
        },
      });
      assert.equal(res.status, 200);
    });
    const forwarded = seen.at(-1);
    assert.equal(forwarded["sec-fetch-site"], undefined, "sandbox iframe 的 cross-site 头不得透传给内部 web-api");
    assert.equal(forwarded["sec-fetch-mode"], undefined);
    assert.equal(forwarded.origin, undefined);
    assert.equal(forwarded.referer, undefined);
    assert.equal(forwarded["content-type"], "application/json", "非来源头仍须正常转发");
  } finally {
    upstream.closeAllConnections?.();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("proxy handler answers 503 when the web api process is unavailable", async () => {
  const manager = { ensureReady: async () => null };
  const proxy = createProxyHandler(manager);
  await withHandler((req, res) => proxy(req, res, "/objects", ""), async (base) => {
    const response = await fetch(`${base}/anything`);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /not available/);
  });
});

test("proxy handler answers 502 when the upstream target is dead", async () => {
  const grave = http.createServer(() => {});
  await new Promise((resolve) => grave.listen(0, "127.0.0.1", resolve));
  const deadPort = grave.address().port;
  await new Promise((resolve) => grave.close(resolve));
  const manager = { ensureReady: async () => ({ port: deadPort }) };
  const proxy = createProxyHandler(manager);
  await withHandler((req, res) => proxy(req, res, "/objects", ""), async (base) => {
    const response = await fetch(`${base}/anything`);
    assert.equal(response.status, 502);
    assert.match(await response.text(), /proxy failed/);
  });
});

const FAST = Object.freeze({
  debounceMs: 150,
  recycleThrottleMs: 60,
  recheckBaseMs: 40,
  recheckMaxMs: 400,
  hardKillMs: 300,
  rewarmDelayMs: 40,
});

async function waitForServing(url, { attempts = 100, intervalMs = 50 } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, intervalMs));
    }
  }
  throw lastError ?? new Error(`no response from ${url}`);
}

async function makeWatchFixture(overrides = {}) {
  const root = await mkdtemp(join(longTempDir(), "ldvh-recycle-"));
  const pidFile = join(root, "child.pid");
  await mkdir(join(root, "api"), { recursive: true });
  await writeFile(join(root, "api", "server.ts"), "// v1\n");
  const port = 33000 + Math.floor(Math.random() * 15000);
  const manager = createWebApiProcess({
    ...FAST,
    ...overrides,
    webRoot: root,
    port,
    env: {},
    command: {
      exec: process.execPath,
      argv: ["-e", `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));require('http').createServer((req,res)=>{res.setHeader('content-type','application/json');res.end('{"ok":true}')}).listen(Number(process.env.PORT),'127.0.0.1')`],
    },
    readinessPath: "/api/health",
    readinessTimeoutMs: 10_000,
    watchSource: true,
  });
  const readPid = async () => Number((await readFile(pidFile, "utf8")).trim());
  return { root, manager, readPid, port };
}

test("source recycle self-heals the child without any incoming request", async () => {
  const { root, manager, readPid, port } = await makeWatchFixture();
  try {
    await manager.ensureReady();
    const firstPid = await readPid();
    assert.equal(manager.isRunning(), true);
    await writeFile(join(root, "api", "server.ts"), "// v1 edited\n");
    let secondPid = firstPid;
    for (let i = 0; i < 100; i += 1) {
      await new Promise((done) => setTimeout(done, 100));
      if (!manager.isRunning()) continue;
      secondPid = await readPid();
      if (secondPid !== firstPid) break;
    }
    assert.notEqual(secondPid, firstPid, "a content change must recycle the child");
    assert.equal(manager.isRunning(), true, "replacement must be running again — no request was ever sent");
    const response = await waitForServing(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200, "the loopback address the iframe uses must serve again");
  } finally {
    manager.dispose();
  }
});

test("mtime-only touch keeps the child pid unchanged, real content change replaces it", async () => {
  const { root, manager, readPid } = await makeWatchFixture();
  try {
    await manager.ensureReady();
    const firstPid = await readPid();
    const target = join(root, "api", "server.ts");
    const future = new Date(Date.now() + 5000);
    await utimes(target, future, future);
    await new Promise((done) => setTimeout(done, 900));
    assert.equal(manager.isRunning(), true, "child must survive an mtime-only touch");
    assert.equal(await readPid(), firstPid, "an mtime-only touch must NOT recycle the child");
    await writeFile(target, "// v2 changed\n");
    let secondPid = firstPid;
    for (let i = 0; i < 100; i += 1) {
      await new Promise((done) => setTimeout(done, 100));
      if (!manager.isRunning()) continue;
      secondPid = await readPid();
      if (secondPid !== firstPid) break;
    }
    assert.notEqual(secondPid, firstPid, "a real content change MUST recycle the child");
  } finally {
    manager.dispose();
  }
});

test("unexpected child exit re-warms without any incoming request", async () => {
  const { root, manager, readPid, port } = await makeWatchFixture({ rewarmDelayMs: 400 });
  try {
    await manager.ensureReady();
    const firstPid = await readPid();
    assert.equal(manager.isRunning(), true);

    process.kill(firstPid, "SIGKILL");
    for (let i = 0; i < 100 && manager.isRunning(); i += 1) {
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.equal(manager.isRunning(), false, "the child must be observed as gone after the kill");

    let secondPid = firstPid;
    for (let i = 0; i < 100; i += 1) {
      await new Promise((done) => setTimeout(done, 100));
      if (!manager.isRunning()) continue;
      secondPid = await readPid();
      if (secondPid !== firstPid) break;
    }
    assert.notEqual(secondPid, firstPid, "an unexpectedly killed child must be re-warmed with a new pid");
    const response = await waitForServing(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200, "the loopback address must serve again after a crash");
    void root;
  } finally {
    manager.dispose();
  }
});

test("a real content change is not swallowed by the recycle throttle", async () => {
  const { root, manager, readPid } = await makeWatchFixture();
  try {
    await manager.ensureReady();
    const firstPid = await readPid();
    const target = join(root, "api", "server.ts");

    await writeFile(target, "// v2\n");
    await new Promise((done) => setTimeout(done, 60));
    await writeFile(target, "// v3\n");

    let lastPid = firstPid;
    for (let i = 0; i < 100; i += 1) {
      await new Promise((done) => setTimeout(done, 100));
      if (!manager.isRunning()) continue;
      lastPid = await readPid();
      if (lastPid !== firstPid) {
        await new Promise((done) => setTimeout(done, 700));
        if (manager.isRunning()) lastPid = await readPid();
        break;
      }
    }
    assert.notEqual(lastPid, firstPid, "content changes must recycle the child, not be silently dropped");
    assert.equal(manager.isRunning(), true, "the child must end up running, not wedged mid-recycle");
  } finally {
    manager.dispose();
  }
});

test("a change landing during an in-flight recycle is not lost", async () => {
  const DEBOUNCE = 150;
  const CHILD_START = 400;
  const root = await mkdtemp(join(longTempDir(), "ldvh-recheck-"));
  const bootFile = join(root, "booted");
  const pidFile = join(root, "child.pid");
  await mkdir(join(root, "api"), { recursive: true });
  const target = join(root, "api", "server.ts");
  await writeFile(target, "// v1\n");
  const manager = createWebApiProcess({
    ...FAST,
    debounceMs: DEBOUNCE,
    webRoot: root,
    port: 33000 + Math.floor(Math.random() * 15000),
    env: {},
    command: {
      exec: process.execPath,
      argv: ["-e", `const fs=require('fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));let boot='';try{boot=fs.readFileSync(${JSON.stringify(target)},'utf8')}catch{}fs.writeFileSync(${JSON.stringify(bootFile)},boot);setTimeout(()=>{require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end('{"ok":true}')}).listen(Number(process.env.PORT),'127.0.0.1')},${CHILD_START})`],
    },
    readinessPath: "/api/health",
    readinessTimeoutMs: 20_000,
    watchSource: true,
  });
  const readBoot = async () => (await readFile(bootFile, "utf8")).trim();
  try {
    await manager.ensureReady();
    assert.equal(await readBoot(), "// v1");

    await writeFile(target, "// v2\n");

    let bootedNow = "";
    for (let i = 0; i < 200; i += 1) {
      await new Promise((done) => setTimeout(done, 20));
      try { bootedNow = await readBoot(); } catch { continue; }
      if (bootedNow === "// v2") break;
    }
    assert.equal(bootedNow, "// v2", "the replacement child must have booted on v2 before v3 lands");
    await writeFile(target, "// v3\n");

    let booted = "";
    for (let i = 0; i < 150; i += 1) {
      await new Promise((done) => setTimeout(done, 100));
      try { booted = await readBoot(); } catch { continue; }
      if (booted === "// v3") break;
    }
    assert.equal(await readFile(target, "utf8"), "// v3\n", "disk must hold v3");
    assert.equal(booted, "// v3", "the running child must end up on v3 — a change landing mid-recycle must not be lost");
  } finally {
    manager.dispose();
  }
});

test("dispose still refuses to resurrect the child after an unexpected exit", async () => {
  const { manager, readPid } = await makeWatchFixture();
  await manager.ensureReady();
  const firstPid = await readPid();
  manager.dispose();
  try { process.kill(firstPid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  await new Promise((done) => setTimeout(done, 400));
  assert.equal(manager.isRunning(), false);
  assert.equal(await manager.ensureReady(), null, "a disposed manager must never resurrect its child");
});

test("web api process manager spawns a custom command, becomes ready, and disposes", async () => {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const manager = createWebApiProcess({
    webRoot: process.cwd(),
    port,
    env: {},
    command: {
      exec: process.execPath,
      argv: ["-e", "require('http').createServer((req,res)=>{res.setHeader('content-type','application/json');res.end('{\"ok\":true}')}).listen(Number(process.env.PORT),'127.0.0.1')"],
    },
    readinessPath: "/api/health",
    readinessTimeoutMs: 10_000,
  });
  try {
    assert.equal(manager.isRunning(), false);
    const ready = await manager.ensureReady();
    assert.equal(ready.port, port);
    assert.equal(manager.isRunning(), true);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    const again = await manager.ensureReady();
    assert.equal(again.port, port);
  } finally {
    manager.dispose();
  }
  await new Promise((done) => setTimeout(done, 300));
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }));
  assert.equal(manager.isRunning(), false);
  assert.equal(await manager.ensureReady(), null);
});

test("web api child reports its bound port via stdout and the manager adopts it for readiness/proxy", async () => {
  const manager = createWebApiProcess({
    webRoot: process.cwd(),
    port: 0,
    env: {},
    command: {
      exec: process.execPath,
      argv: ["-e", "require('http').createServer((req,res)=>{res.setHeader('content-type','application/json');res.end('{\"ok\":true}')}).listen(0,'127.0.0.1',function(){console.log('LDVH_WEB_PORT='+this.address().port)})"],
    },
    readinessPath: "/api/health",
    readinessTimeoutMs: 10_000,
    watchSource: false,
  });
  try {
    const ready = await manager.ensureReady();
    assert.equal(ready.port, manager.currentPort(), "ready 端口须与管理器当前端口一致");
    assert.ok(ready.port > 0, "0 号端口须解析为子进程实际绑定的非零端口");
    const response = await fetch(`http://127.0.0.1:${ready.port}/api/health`);
    assert.equal(response.status, 200, "探活须走子进程回报的实际端口");
    const proxy = createProxyHandler(manager, null);
    await withHandler((req, res) => proxy(req, res, "/health", ""), async (base) => {
      const proxied = await fetch(`${base}/anything`);
      assert.equal(proxied.status, 200, "代理须转发到子进程回报的实际端口");
      assert.deepEqual(await proxied.json(), { ok: true });
    });
  } finally {
    manager.dispose();
  }
});

test("port report split across stdout chunks is parsed as one line, never a truncated prefix", async () => {
  const manager = createWebApiProcess({
    webRoot: process.cwd(),
    port: 0,
    env: {},
    command: {
      exec: process.execPath,
      argv: ["-e", [
        "const s=require('http').createServer((q,r)=>r.end('{}'));",
        "s.listen(0,'127.0.0.1',()=>{",
        "const p=s.address().port;",
        "const line='LDVH_WEB_PORT='+p;",
        "const cut=line.length-2;",
        "process.stdout.write(line.slice(0,cut));",
        "setTimeout(()=>process.stdout.write(line.slice(cut)+'\\n'),5);",
        "});",
      ].join("")],
    },
    readinessPath: "/api/health",
    readinessTimeoutMs: 10_000,
    watchSource: false,
  });
  try {
    const ready = await manager.ensureReady();
    assert.ok(ready.port > 0, "被切碎的端口行仍须解析出完整端口");
    const body = await (await fetch(`http://127.0.0.1:${ready.port}/api/health`)).text();
    assert.equal(body.trim(), "{}", "探针须命中完整端口，而非被截断的前缀端口");
  } finally {
    manager.dispose();
  }
});

test("reported port is cleared when the live child exits", async () => {
  const manager = createWebApiProcess({
    webRoot: process.cwd(),
    port: 0,
    env: {},
    command: {
      exec: process.execPath,
      argv: ["-e", "const s=require('http').createServer((q,r)=>r.end('{}'));s.listen(0,'127.0.0.1',()=>{console.log('LDVH_WEB_PORT='+s.address().port);setTimeout(()=>s.close(()=>process.exit(0)),300)})"],
    },
    readinessPath: "/api/health",
    readinessTimeoutMs: 10_000,
    watchSource: false,
    rewarmDelayMs: 100_000,
  });
  try {
    const ready = await manager.ensureReady();
    const livePort = ready.port;
    assert.ok(livePort > 0, "子进程存活时报出非零端口");
    assert.equal(manager.currentPort(), livePort);
    await new Promise((done) => setTimeout(done, 900));
    assert.equal(manager.currentPort(), 0, "子进程退出后须清零回报端口，不再对外播死端口");
    assert.equal(manager.isRunning(), false, "长重暖延迟下不得已拉起新子进程，断言才只测退出清零");
  } finally {
    manager.dispose();
  }
});

test("two dynamic-port instances bind distinct ports and each stays reachable", async () => {
  const command = {
    exec: process.execPath,
    argv: ["-e", "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end('{}')}).listen(Number(process.env.PORT),'127.0.0.1',function(){console.log('LDVH_WEB_PORT='+this.address().port)})"],
  };
  const make = () => createWebApiProcess({ webRoot: process.cwd(), port: 0, env: {}, command, readinessPath: "/api/health", watchSource: false });
  const a = make();
  const b = make();
  try {
    const ra = await a.ensureReady();
    const rb = await b.ensureReady();
    assert.ok(ra.port > 0 && rb.port > 0);
    assert.notEqual(ra.port, rb.port, "两实例须绑不同端口，消除固定端口争抢");
    assert.equal((await fetch(`http://127.0.0.1:${ra.port}/api/health`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${rb.port}/api/health`)).status, 200);
  } finally {
    a.dispose();
    b.dispose();
  }
});

test("dynamic port falls back to the configured port when the child reports nothing", async () => {
  const port = 34000 + Math.floor(Math.random() * 8000);
  const manager = createWebApiProcess({
    webRoot: process.cwd(),
    port,
    env: {},
    command: {
      exec: process.execPath,
      argv: ["-e", "require('http').createServer((q,s)=>s.end('{}')).listen(Number(process.env.PORT),'127.0.0.1')"],
    },
    readinessPath: "/api/health",
    readinessTimeoutMs: 10_000,
    watchSource: false,
  });
  try {
    const ready = await manager.ensureReady();
    assert.equal(ready.port, port, "子进程不回报时须回退到配置的端口");
    assert.equal(manager.currentPort(), port);
  } finally {
    manager.dispose();
  }
});

test("dispose() racing the async watcher import does not keep the process alive", async () => {
  const webRoot = await mkdtemp(join(longTempDir(), "ldvh-watch-race-"));
  await mkdir(join(webRoot, "api"), { recursive: true });
  await writeFile(join(webRoot, "api", "server.ts"), "// race fixture\n");

  const script = `
    import { createWebApiProcess } from ${JSON.stringify(new URL("../lib/web-mount.js", import.meta.url).href)};
    const manager = createWebApiProcess({
      webRoot: ${JSON.stringify(webRoot)},
      port: 45999,
      env: {},
      watchSource: true,
    });
    // 抢在 import("node:fs") 的 then 回调之前 dispose。
    manager.dispose();
    // 让出事件循环，使那个异步回调有机会跑（修复后它应直接返回，不建 watcher）。
    await new Promise((done) => setTimeout(done, 300));
    console.log("SCRIPT_DONE");
  `;

  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const watchdog = setTimeout(() => { try { child.kill("SIGKILL"); } catch {   } }, 20_000);
  const exit = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(watchdog);

  assert.match(stdout, /SCRIPT_DONE/, `子进程应跑完脚本：${stderr}`);
  assert.equal(
    exit.code,
    0,
    `dispose() 与异步 watcher 创建竞态时进程应能正常退出，实际 code=${exit.code} signal=${exit.signal}——` +
      "残留的 fs.watch 句柄在 Linux 上会使进程永久挂起（macOS 因 unref 生效而掩盖）",
  );
});

test("watcher resolves the watch target before fs.watch (cross-platform half of the short-name guard)", async () => {
  const base = await mkdtemp(join(tmpdir(), "ldvh-watch-realpath-"));
  const realDir = join(base, "real");
  const linkDir = join(base, "link");
  await mkdir(join(realDir, "api"), { recursive: true });
  await mkdir(join(realDir, "shared"), { recursive: true });
  await mkdir(join(realDir, "src"), { recursive: true });
  try {
    await (await import("node:fs/promises")).symlink(realDir, linkDir, "dir");
  } catch {
    return;
  }

  const manager = createWebApiProcess({
    webRoot: linkDir,
    port: 45997,
    env: {},
    watchSource: true,
    command: {
      exec: process.execPath,
      argv: ["-e", "require('http').createServer((q,s)=>s.end('{}')).listen(Number(process.env.PORT),'127.0.0.1')"],
    },
    readinessPath: "/api/health",
    readinessTimeoutMs: 10000,
  });
  try {
    await manager.ensureReady();
    const deadline = Date.now() + 5000;
    let targets = [];
    while (Date.now() < deadline) {
      targets = manager.watchTargets();
      if (targets.length > 0) break;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.ok(targets.length > 0, "watcher 必须在 5s 内建立（否则本用例无法验证任何东西）");

    const expectTargets = ["api", "shared"].map((root) => realpathSync.native(join(realDir, root)));
    assert.deepEqual(
      targets,
      expectTargets,
      `watcher 必须拿到 realpath 解析后的每一根源码目录（而不是调用方传入的 link 字面量），实际：${JSON.stringify(targets)}`,
    );
  } finally {
    manager.dispose();
  }
});

test("a short-name (8.3) webRoot does not abort the process when the watched tree changes", async (t) => {
  if (process.platform !== "win32") {
    t.skip("the 8.3 short-name defect is Windows-only (libuv src/win/fs-event.c)");
    return;
  }
  const shortRoot = tmpdir();
  if (!/~\d/.test(shortRoot)) {
    t.skip(`os.tmpdir() is already the long form (${shortRoot}) — no short-name trigger on this machine`);
    return;
  }

  const webRoot = await mkdtemp(join(shortRoot, "ldvh-shortpath-"));
  await mkdir(join(webRoot, "api"), { recursive: true });
  await writeFile(join(webRoot, "api", "server.ts"), "// v1\n");

  const script = `
    import { writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import { createWebApiProcess } from ${JSON.stringify(new URL("../lib/web-mount.js", import.meta.url).href)};
    const manager = createWebApiProcess({
      webRoot: ${JSON.stringify(webRoot)},
      port: 45998,
      env: {},
      watchSource: true,
      command: {
        exec: process.execPath,
        argv: ["-e", "require('http').createServer((q,s)=>s.end('{}')).listen(Number(process.env.PORT),'127.0.0.1')"],
      },
      readinessPath: "/api/health",
      readinessTimeoutMs: 10000,
    });
    await manager.ensureReady();
    // 真实写入被监听的树：未加固时，这里整个进程以原生断言中止。
    await writeFile(join(${JSON.stringify(webRoot)}, "api", "server.ts"), "// v2 changed\\n");
    await new Promise((done) => setTimeout(done, 3000));
    console.log("MUTATION_SURVIVED");
    manager.dispose();
    await new Promise((done) => setTimeout(done, 300));
    process.exit(0);
  `;

  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const watchdog = setTimeout(() => { try { child.kill("SIGKILL"); } catch {   } }, 30_000);
  const exit = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(watchdog);

  assert.doesNotMatch(stderr, /_wcsnicmp|fs-event\.c/, `短路径 watcher 触发了 libuv 原生断言：${stderr}`);
  assert.match(stdout, /MUTATION_SURVIVED/, `子进程应跑完脚本：${stderr}`);
  assert.equal(exit.code, 0, `短名 webRoot 下进程被中止：code=${exit.code} signal=${exit.signal}`);
});

test("a watch root that cannot be watched does not leak the watchers built before it", async () => {
  const webRoot = await mkdtemp(join(longTempDir(), "ldvh-missing-root-"));
  await mkdir(join(webRoot, "api"), { recursive: true });
  await writeFile(join(webRoot, "api", "server.ts"), "// only api/, no shared/\n");

  const script = `
    import { createWebApiProcess } from ${JSON.stringify(new URL("../lib/web-mount.js", import.meta.url).href)};
    const manager = createWebApiProcess({
      webRoot: ${JSON.stringify(webRoot)},
      port: 46001,
      env: {},
      command: {
        exec: process.execPath,
        argv: ["-e", "require('http').createServer((q,s)=>{s.end('{}')}).listen(Number(process.env.PORT),'127.0.0.1')"],
      },
      readinessPath: "/api/health",
      readinessTimeoutMs: 10_000,
      watchSource: true,
    });
    await manager.ensureReady();
    // 给异步 watcher 创建留出时间，再断言监听面。
    await new Promise((done) => setTimeout(done, 500));
    console.log("WATCH_TARGETS:" + JSON.stringify(manager.watchTargets()));
    manager.dispose();
    console.log("SCRIPT_DONE");
  `;

  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const watchdog = setTimeout(() => { try { child.kill("SIGKILL"); } catch {   } }, 25_000);
  const exit = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(watchdog);

  assert.match(stdout, /SCRIPT_DONE/, `子进程应跑完脚本：${stderr}`);
  const targets = JSON.parse((stdout.match(/WATCH_TARGETS:(.*)/) ?? [null, "[]"])[1]);
  assert.equal(targets.length, 2, `watchTargets 应仍报告两个根：${JSON.stringify(targets)}`);
  const tail = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop();
  assert.ok(targets.some((t) => tail(t) === "api"), `api/ 根应仍在监听面内：${JSON.stringify(targets)}`);
  assert.equal(
    exit.code,
    0,
    `缺 shared/ 时不应泄漏 watcher 句柄，实际 code=${exit.code} signal=${exit.signal}——` +
      "map() 整体抛出会让先建好的 watcher 失去引用，dispose() 关不掉",
  );
});
