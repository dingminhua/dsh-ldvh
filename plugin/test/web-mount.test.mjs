/**
 * web-mount.js 契约测试：/ldvh 静态服务（dist 存在/缺失两态、SPA fallback、
 * 越界防护）、代理（路径映射、方法/请求体往返、子进程不可用 503、上游死 502）、
 * 子进程管理器（自定义命令 spawn → 就绪 → dispose）。
 */
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProxyHandler, createSpaHandler, createWebApiProcess } from "../lib/web-mount.js";

/** 用真实 http.Server 包住 handler 再 fetch——比 mock req/res 更接近真实调用面。 */
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
    // 根路径 → index.html
    const root = await fetch(`${base}/ldvh`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-type"), /text\/html/);
    assert.match(await root.text(), /app/);
    // 静态资源 → 正确 MIME
    const asset = await fetch(`${base}/ldvh/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /text\/javascript/);
    // SPA 路由 → index.html fallback（非文件路径）
    const spa = await fetch(`${base}/ldvh/federation/objects/spark`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /app/);
    // 嵌套静态文件
    const nested = await fetch(`${base}/ldvh/deep/nested.txt`);
    assert.equal(nested.status, 200);
    assert.equal(await nested.text(), "nested");
    // 越界 → SPA fallback（不泄露 dist 之外的内容，仍回 index.html）
    const traversal = await fetch(`${base}/ldvh/..%2f..%2fetc`);
    assert.equal(traversal.status, 200);
    assert.match(await traversal.text(), /app/);
    // 非 GET/HEAD → 405
    const post = await fetch(`${base}/ldvh/`, { method: "POST" });
    assert.equal(post.status, 405);
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
  // 一个「子进程」替身：真实 http.Server 记录收到的请求并回 JSON。
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
    // POST 带请求体 + content-type 透传
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
  // 占一个端口然后立刻关掉——保证端口无人监听。
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
    // 单飞：再次 ensureReady 不换进程
    const again = await manager.ensureReady();
    assert.equal(again.port, port);
  } finally {
    manager.dispose();
  }
  // dispose 后端口停止服务（给 SIGTERM 一点时间）
  await new Promise((done) => setTimeout(done, 300));
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }));
  assert.equal(manager.isRunning(), false);
  // dispose 后 ensureReady 返回 null（不再复活）
  assert.equal(await manager.ensureReady(), null);
});
