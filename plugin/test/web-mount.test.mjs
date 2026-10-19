/**
 * web-mount.js 契约测试：/ldvh 静态服务（dist 存在/缺失两态、SPA fallback、
 * 越界防护）、代理（路径映射、方法/请求体往返、子进程不可用 503、上游死 502）、
 * 子进程管理器（自定义命令 spawn → 就绪 → dispose）。
 */
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

/**
 * A canonical (long-form) temp root.
 *
 * `os.tmpdir()` returns the 8.3 SHORT name on Windows (`C:\Users\ADMINI~1\...`).
 * Handing a short path to `fs.watch(dir, { recursive: true })` and then mutating
 * the directory ABORTS the whole Node process — `Assertion failed:
 * !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c, line 72` — because
 * ReadDirectoryChangesW reports the LONG name while the watcher holds the short
 * one. Reproduced on Node 24.19 / Windows before this helper existed.
 *
 * This is an upstream libuv defect, not an LDVH one:
 *   https://github.com/libuv/libuv/issues/5010
 *   https://github.com/nodejs/node/issues/63638
 * Nothing in the product code is at fault (`fs.watch` is used exactly as
 * documented), so the fixture resolves the path instead of the product
 * weakening its watch. The crash is unrunnable to assert against — a native
 * abort kills the runner — so it is registered as a known platform limitation
 * rather than covered by a test.
 */
const longTempDir = () => realpathSync.native(tmpdir());

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
    // 回归断言：content-type 必须是原始类型——曾按 .gz 后缀误判 octet-stream，
    // 浏览器把 iframe 页面当下载处理（Electron tab 触发下载保存）。
    assert.match(html.headers.get("content-type"), /text\/html/);
    const js = await fetch(`${base}/ldvh/assets/app.js`, { headers: { "accept-encoding": "gzip" } });
    assert.equal(js.status, 200);
    assert.equal(js.headers.get("content-encoding"), "gzip");
    assert.match(js.headers.get("content-type"), /text\/javascript/);
    // 内容不变（fetch 对 content-encoding: gzip 已自动解压）
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

/**
 * 建一个可被源码热刷新观察的临时 webRoot（api/ 目录 + 一个可改的文件）。
 * 子进程命令用「把 pid 写到 pidFile」的小 http 服务替身：这样测试能断言
 * 「pid 变了 / 没变」，而不只是「端口通不通」。
 */
async function makeWatchFixture() {
  const root = await mkdtemp(join(longTempDir(), "ldvh-recycle-"));
  const pidFile = join(root, "child.pid");
  await mkdir(join(root, "api"), { recursive: true });
  await writeFile(join(root, "api", "server.ts"), "// v1\n");
  const port = 33000 + Math.floor(Math.random() * 15000);
  const manager = createWebApiProcess({
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
  // 回归（工单 c6d88dac）：原实现 kill 之后不重拉，而重拉只由 /ldvh/api/* 代理
  // 请求触发——那个请求恰来自已打不开的页面，进程一死就永不自愈。这里断言：改内容
  // → 回收 → **全程不发任何请求** → 子进程自己回到运行态，且换成新 pid。
  const { root, manager, readPid, port } = await makeWatchFixture();
  try {
    await manager.ensureReady();
    const firstPid = await readPid();
    assert.equal(manager.isRunning(), true);
    // 真实改码（内容变）→ 应触发回收并自愈
    await writeFile(join(root, "api", "server.ts"), "// v1 edited\n");
    let secondPid = firstPid;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((done) => setTimeout(done, 500));
      if (!manager.isRunning()) continue;
      secondPid = await readPid();
      if (secondPid !== firstPid) break;
    }
    assert.notEqual(secondPid, firstPid, "a content change must recycle the child");
    assert.equal(manager.isRunning(), true, "replacement must be running again — no request was ever sent");
    // 自愈的落点是「iframe 那个地址恢复 200」，不是仅进程活着。
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200, "the loopback address the iframe uses must serve again");
  } finally {
    manager.dispose();
  }
});

test("mtime-only touch keeps the child pid unchanged, real content change replaces it", async () => {
  // 计划步骤 2 的两条判据：仅触碰 mtime → pid 不变；内容真变 → pid 变化。
  const { root, manager, readPid } = await makeWatchFixture();
  try {
    await manager.ensureReady();
    const firstPid = await readPid();
    const target = join(root, "api", "server.ts");
    // ① 只改 mtime，内容一字不动
    const future = new Date(Date.now() + 5000);
    await utimes(target, future, future);
    await new Promise((done) => setTimeout(done, 3000));
    assert.equal(manager.isRunning(), true, "child must survive an mtime-only touch");
    assert.equal(await readPid(), firstPid, "an mtime-only touch must NOT recycle the child");
    // ② 内容真变
    await writeFile(target, "// v2 changed\n");
    let secondPid = firstPid;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((done) => setTimeout(done, 500));
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
  // 独立复核发现（工单 c6d88dac）：初版的「意外退出自愈」是**死代码**——
  // exit 回调里 re-warm 的守卫是 `if (disposed || spawned !== null) return;`，
  // 而 spawned 只在 recycleChild 内清空，意外退出时仍指向已死进程，定时器必然
  // 早退。热刷新路径的自愈成立，崩溃路径从未生效。本用例钉住崩溃路径。
  const { root, manager, readPid, port } = await makeWatchFixture();
  try {
    await manager.ensureReady();
    const firstPid = await readPid();
    assert.equal(manager.isRunning(), true);

    // 模拟崩溃：从外部 SIGKILL，不经 dispose、不经回收路径。
    process.kill(firstPid, "SIGKILL");
    // exit 事件是异步送达的：先等它被观察到，再谈重拉。
    for (let i = 0; i < 40 && manager.isRunning(); i += 1) {
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.equal(manager.isRunning(), false, "the child must be observed as gone after the kill");

    // 不发任何请求，等它自己回来。
    let secondPid = firstPid;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((done) => setTimeout(done, 250));
      if (!manager.isRunning()) continue;
      secondPid = await readPid();
      if (secondPid !== firstPid) break;
    }
    assert.notEqual(secondPid, firstPid, "an unexpectedly killed child must be re-warmed with a new pid");
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200, "the loopback address must serve again after a crash");
    void root;
  } finally {
    manager.dispose();
  }
});

test("a real content change is not swallowed by the recycle throttle", async () => {
  // 独立复核发现：回收回调原先**先**推进内容指纹基线、再调 recycleChild，而
  // recycleChild 会因节流（500ms）或正在回收而早退——本次真实改码就被「吃掉」：
  // 基线已是新内容，下次事件判成未变，进程却还跑着旧码。
  // 这里连改两次内容、间隔短于节流窗口，两次都必须生效。
  const { root, manager, readPid } = await makeWatchFixture();
  try {
    await manager.ensureReady();
    const firstPid = await readPid();
    const target = join(root, "api", "server.ts");

    await writeFile(target, "// v2\n");
    await new Promise((done) => setTimeout(done, 300));
    // 第二次改码发生在第一次回收的节流窗口内（去抖 1.5s 后才判指纹，节流 500ms）。
    await writeFile(target, "// v3\n");

    let lastPid = firstPid;
    for (let i = 0; i < 60; i += 1) {
      await new Promise((done) => setTimeout(done, 500));
      if (!manager.isRunning()) continue;
      lastPid = await readPid();
      if (lastPid !== firstPid) {
        // 换过一次之后再等一轮，确认第二次改码也被消费（基线未被提前吃掉）。
        await new Promise((done) => setTimeout(done, 3500));
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
  // 第二次独立复核发现的残留竞态：v2 触发回收后、回收**进行中**再落 v3。初版
  // 修法只是「回收没发生就不推进基线」，但 v3 此后不会再有 fs 事件来驱动它——
  // 实测（复核者在 /tmp 用慢启动子进程复现）进程会一直跑 v2 而磁盘是 v3。
  // 本用例用慢启动子进程放大这个窗口，并直接断言**最终跑的是 v3**。
  const root = await mkdtemp(join(longTempDir(), "ldvh-recheck-"));
  const bootFile = join(root, "booted");
  const pidFile = join(root, "child.pid");
  await mkdir(join(root, "api"), { recursive: true });
  const target = join(root, "api", "server.ts");
  await writeFile(target, "// v1\n");
  // 子进程启动时把自己读到的源码内容写进 bootFile：于是「进程跑的是哪一版」
  // 可被外部直接读出，不必靠 pid 推断。
  const manager = createWebApiProcess({
    webRoot: root,
    port: 33000 + Math.floor(Math.random() * 15000),
    env: {},
    command: {
      exec: process.execPath,
      // 子进程在 **spawn 时刻**就把读到的源码内容写进 bootFile（真实子进程加载
      // 模块也是在启动时读盘），然后**延迟 3s** 才 listen。
      // 两个设计各有用处：bootFile 令「进程跑的是哪一版」可被外部直读；
      // 3s 延迟把「回收进行中」的窗口拉长到超过去抖窗口 1.5s，竞态才真会出现。
      argv: ["-e", `const fs=require('fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));let boot='';try{boot=fs.readFileSync(${JSON.stringify(target)},'utf8')}catch{}fs.writeFileSync(${JSON.stringify(bootFile)},boot);setTimeout(()=>{require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end('{"ok":true}')}).listen(Number(process.env.PORT),'127.0.0.1')},3000)`],
    },
    readinessPath: "/api/health",
    // 慢启动 3s：让「回收进行中」的时间窗**长于去抖窗口 1.5s**。这是复现该竞态
    // 的必要条件——若回收在下一个去抖窗口到期前就结束，v3 写入自己产生的新
    // fs 事件会把它正常消费掉，竞态根本不出现（初版用例就栽在这里：它恒过，
    // 因为它压根没进过竞态窗口）。
    readinessTimeoutMs: 20_000,
    watchSource: true,
  });
  const readBoot = async () => (await readFile(bootFile, "utf8")).trim();
  try {
    await manager.ensureReady();
    assert.equal(await readBoot(), "// v1");

    // v2 → 触发回收（去抖 1.5s 后开始 kill + 重启，重启本身要 3s）
    await writeFile(target, "// v2\n");
    // v3 落在「回收进行中」：此刻 recycling 为 true，v3 自己的去抖窗口会在
    // t≈3.5s 触发，而那轮回收要到 t≈4.5s 才结束——回收早退，v3 被吞。
    await new Promise((done) => setTimeout(done, 2500));
    await writeFile(target, "// v3\n");

    // 不发任何请求，等它自己收敛到 v3。
    let booted = "";
    for (let i = 0; i < 80; i += 1) {
      await new Promise((done) => setTimeout(done, 500));
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
  // dispose 的语义不得被 re-warm 分支破坏：关闭后不复活（既有 dispose 用例钉住
  // 「dispose 后 ensureReady 返回 null」，这里钉住崩溃路径上也不复活）。
  const { manager, readPid } = await makeWatchFixture();
  await manager.ensureReady();
  const firstPid = await readPid();
  manager.dispose();
  // Simulate the child dying out-of-band. `dispose()` already sent SIGTERM, and
  // on Windows that terminates (and reaps) the process immediately — so this
  // kill can legitimately race into ESRCH. Tolerating it does not weaken the
  // assertion: "the child is gone" is exactly the precondition this test needs,
  // and which of the two kills produced it is immaterial. On POSIX SIGTERM is
  // asynchronous, so the pid is normally still resolvable here.
  try { process.kill(firstPid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  await new Promise((done) => setTimeout(done, 1500));
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

test("dispose() racing the async watcher import does not keep the process alive", async () => {
  // 回归：createWebApiProcess 用 import("node:fs").then(...) 异步创建 fs.watch。
  // 若 dispose() 在该 then 回调之前同步跑完，它会看到 watcher 仍为 null 而跳过
  // close，随后创建出来的 watcher 再无机会关闭——进程被永久挂住。
  //
  // 失败模式只在**子进程退出**时可见，且仅在某些平台：darwin 的 FSEvent 支持
  // unref（掩盖该缺陷），Linux 的 inotify 句柄不受 unref 影响（CI 的 plugin job
  // 因此挂起 30 分钟以上；同一份代码在 macOS 上 15 秒跑完）。
  //
  // 由于 darwin 上 unref 会掩盖该缺陷，**本用例在 macOS 上恒通过**；它的实际
  // 守护发生在 Linux（CI 的 plugin job 跑全套，HEAD 版在那里 exit=124 挂起，
  // 修复后 exit=0）。此处直接断言子进程能否自然退出——超时即失败。
  //
  // watchSource 需为 true 且 webRoot/api 存在，才能走到 fs.watch 分支。
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

  // 兜底看门狗：仅在句柄泄漏时触发。它保证用例本身不会永久挂住整轮测试，
  // 同时把「未退出」判为失败（而非让 CI 超时这种更难诊断的形式）。
  const watchdog = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 20_000);
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

/**
 * 跨平台半：watcher 必须监听 **realpath 解析后的**目录，而不是调用方传进来的
 * 字符串。
 *
 * 为什么要有这一条：上面那条 Windows 用例在本机（macOS/Linux）整条跳过，
 * 于是 `web-mount.js` 里「建立 watcher 前先取长名」这段修复**在非 Windows 上
 * 一行都没被执行过**——修复本身可以被改坏而无人发现。8.3 短名只在 Windows
 * 存在，但「watcher 拿的是解析后路径」这个**机制**在符号链接上可以跨平台验证
 * （符号链接与短名一样，都是「路径字面量 ≠ 真实目录」）。两边合起来才覆盖完整：
 * 这里钉机制，Windows 用例钉那个能 abort 进程的具体触发条件。
 */
test("watcher resolves the watch target before fs.watch (cross-platform half of the short-name guard)", async () => {
  const base = await mkdtemp(join(tmpdir(), "ldvh-watch-realpath-"));
  const realDir = join(base, "real");
  const linkDir = join(base, "link");
  await mkdir(join(realDir, "api"), { recursive: true });
  await mkdir(join(realDir, "src"), { recursive: true });
  try {
    await (await import("node:fs/promises")).symlink(realDir, linkDir, "dir");
  } catch {
    // 平台不允许建符号链接（Windows 无符号链接权限）：本半无法验证，
    // Windows 那半仍在（见下一条用例）。此处如实返回而非静默通过——
    // 断言失败会误报，故直接跳过。
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
    // watcher 建立在 `import("node:fs").then(...)` 的异步链里，ensureReady 返回时
    // 未必已建立。必须等到它出现再断言——否则 watchTargets() 返回空数组，断言整段
    // 被跳过，用例就成了**空转的绿灯**（实测：把 realpath 修复删掉，本用例照样通过）。
    const deadline = Date.now() + 5000;
    let targets = [];
    while (Date.now() < deadline) {
      targets = manager.watchTargets();
      if (targets.length > 0) break;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.ok(targets.length > 0, "watcher 必须在 5s 内建立（否则本用例无法验证任何东西）");

    // 关键断言：webRoot 传的是 `link`（符号链接），watcher 必须挂到 realpath 解析后
    // 的真实目录。删掉 realpathSync.native 这段修复，此处即失败。
    //
    // **不能**用 realpathSync 归一后再比较：它会把两侧都折叠成同一个真实路径，
    // 于是「watcher 拿到的是 link 还是 real」这个待判事实被断言自己抹平了
    // （实测：去掉修复后该写法照样通过）。必须比较**未经解析的字面路径**。
    const expectTarget = realpathSync(join(realDir, "api"));
    assert.equal(targets.length, 1, `应当只有一个 watch 目标：${JSON.stringify(targets)}`);
    assert.equal(
      targets[0],
      expectTarget,
      `watcher 必须拿到 realpath 解析后的路径（而不是调用方传入的 link 字面量），实际：${JSON.stringify(targets)}`,
    );
  } finally {
    manager.dispose();
  }
});

/**
 * 回归：`fs.watch` 遇 8.3 短路径时，写入该目录会让进程以 **libuv 原生断言**
 * 中止——`Assertion failed: !_wcsnicmp(filename, dir, dirlen), file
 * src\win\fs-event.c, line 72`（ReadDirectoryChangesW 报长名、watcher 持短名）。
 *
 * 为什么必须用**子进程**：原生 abort 不能被 try/catch 捕获，若在本进程里跑，
 * 整轮测试会一起中止，连「失败了」都报不出来。放进子进程后，「子进程是否存活」
 * 就是可断言的判据。
 *
 * 为什么这条用例有真实价值：症状在**宿主**侧。`webRoot` 若含短名组件
 * （`os.tmpdir()` 在本机就返回 `C:\Users\ADMINI~1\...`），`web-mount.js` 建立的
 * watcher 一旦被写入触发，会连带整个 DSH 宿主进程一起崩。修复是建立 watcher 前
 * 先取长名（`realpathSync.native`）；本用例故意喂一个**短名** webRoot 并在建好
 * 子进程后真实写入，从而锁住该修复。
 *
 * 非 Windows 上不存在该缺陷（`fs.watch` 走 inotify/FSEvent），故跳过；Windows
 * 上若 `os.tmpdir()` 已是长名，则本机无法制造触发条件，同样跳过并说明原因。
 */
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

  const watchdog = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 30_000);
  const exit = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(watchdog);

  assert.doesNotMatch(stderr, /_wcsnicmp|fs-event\.c/, `短路径 watcher 触发了 libuv 原生断言：${stderr}`);
  assert.match(stdout, /MUTATION_SURVIVED/, `子进程应跑完脚本：${stderr}`);
  assert.equal(exit.code, 0, `短名 webRoot 下进程被中止：code=${exit.code} signal=${exit.signal}`);
});
