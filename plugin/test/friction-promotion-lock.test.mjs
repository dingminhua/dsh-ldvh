import assert from "node:assert/strict";
import { test } from "node:test";
import { isFrictionPromotionRunning, runFrictionPromotionExclusive } from "../lib/friction-promotion-lock.js";

test("**没有「到期」这个概念**：模块不导出任何间隔/记时函数", async () => {
  const mod = await import("../lib/friction-promotion-lock.js");
  for (const gone of ["isReviewDue", "reviewTiming", "markReviewCompleted"]) {
    assert.equal(gone in mod, false, `trigger 模块不得导出 ${gone}——审核随静置触发，没有间隔可判定`);
  }
  assert.equal(typeof mod.isFrictionPromotionRunning, "function", "isFrictionPromotionRunning 必须保留");
  assert.equal(typeof mod.runFrictionPromotionExclusive, "function", "runFrictionPromotionExclusive 必须保留");
});

test("**设置面不得有审核间隔字段**（间隔数值属已废止的量）", async () => {
  const { readFile } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const rel of ["lib/index.js", "lib/idle-settings.js", "lib/client.js"]) {
    const raw = await readFile(join(root, rel), "utf8");
    const asField = /experienceReviewIntervalMs\s*:\s*(volatileField|z\.)/.test(raw)
      || /"row\.experienceReviewIntervalMs"/.test(raw)
      || /key:\s*"experienceReviewIntervalMs"/.test(raw)
      || /intervalMs:\s*readPositiveNumber/.test(raw);
    assert.equal(asField, false, `${rel} 不得把 experienceReviewIntervalMs 作为真字段承载`);
  }
});


async function withLockHome(fn) {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "review-lock."));
  const home = (...parts) => join(root, "dsh-home", ...parts);
  return fn({ root, home });
}

async function waitUntil(check, { timeoutMs = 2000, stepMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return check();
}

test("互斥：空闲时不忙，跑完之后恢复空闲", async () => {
  await withLockHome(async ({ home }) => {
    assert.equal((await isFrictionPromotionRunning(home, "proj")).busy, false, "初态须空闲");
    const r = await runFrictionPromotionExclusive({ dshHomePath: home, projectId: "proj", sessionId: "s", fn: async () => "done" });
    assert.equal(r.skipped, false);
    assert.equal(r.value, "done");
    assert.equal((await isFrictionPromotionRunning(home, "proj")).busy, false, "跑完后必须恢复空闲——否则审核从此再也不触发");
  });
});

test("互斥：**并发第二枪被跳过**，不排队、不并发执行", async () => {
  await withLockHome(async ({ home }) => {
    let aStarted = false;
    const first = runFrictionPromotionExclusive({
      dshHomePath: home, projectId: "proj", sessionId: "s1",
      fn: async () => {
        aStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return "A";
      },
    });
    assert.equal(await waitUntil(async () => aStarted), true, "前提：第一枪已在执行");
    const second = await runFrictionPromotionExclusive({ dshHomePath: home, projectId: "proj", sessionId: "s2", fn: async () => "B" });

    assert.equal(second.skipped, true, "第二次必须被跳过");
    assert.equal(second.reason, "review-in-flight");
    assert.equal(second.value, undefined, "被跳过时不得执行、不得产生结果");
    assert.equal((await first).value, "A");
  });
});

test("互斥：执行体抛错时锁仍须释放（否则一次失败会永久卡死审核）", async () => {
  await withLockHome(async ({ home }) => {
    await assert.rejects(
      () => runFrictionPromotionExclusive({ dshHomePath: home, projectId: "proj", sessionId: "s", fn: async () => { throw new Error("boom"); } }),
      /boom/,
    );
    assert.equal((await isFrictionPromotionRunning(home, "proj")).busy, false, "抛错后必须释放——否则审核再也跑不起来，且外观像「没配置」");
  });
});

test("互斥是**项目级**：另一个项目不受本项目持锁影响（36 §7.6）", async () => {
  await withLockHome(async ({ home }) => {
    let releaseA;
    const aRunning = new Promise((resolve) => { releaseA = resolve; });
    const first = runFrictionPromotionExclusive({
      dshHomePath: home, projectId: "proj-a", sessionId: "s",
      fn: async () => { await aRunning; return "A"; },
    });
    await waitUntil(async () => (await isFrictionPromotionRunning(home, "proj-a")).busy);

    assert.equal((await isFrictionPromotionRunning(home, "proj-a")).busy, true, "A 项目在跑");
    assert.equal((await isFrictionPromotionRunning(home, "proj-b")).busy, false, "B 项目不受影响——互斥按项目分区");

    const second = await runFrictionPromotionExclusive({ dshHomePath: home, projectId: "proj-b", sessionId: "s", fn: async () => "B" });
    assert.equal(second.skipped, false, "另一个项目可以同时跑");
    assert.equal(second.value, "B");

    releaseA();
    assert.equal((await first).value, "A");
  });
});

test("互斥：崩溃残留的陈旧锁可被回收，不会永久卡死", async () => {
  await withLockHome(async ({ home }) => {
    const { writeFrictionPromotionLockForTest, REVIEW_LOCK_STALE_MS } = await import("../lib/friction-promotion-lock.js");
    const startedAt = new Date(Date.now() - REVIEW_LOCK_STALE_MS - 60_000).toISOString();
    await writeFrictionPromotionLockForTest(home, "proj", { projectId: "proj", sessionId: "dead", startedAt, pid: 1 });

    assert.equal((await isFrictionPromotionRunning(home, "proj")).busy, false, "过期锁不算在跑");
    const r = await runFrictionPromotionExclusive({ dshHomePath: home, projectId: "proj", sessionId: "s", fn: async () => "ok" });
    assert.equal(r.skipped, false, "陈旧锁被回收后应能拿到锁");
    assert.equal(r.value, "ok");
  });
});


test("**旧机制已整体移除**：不存在「专属会话 / 宿主周期任务」这套载体", async () => {
  const { readdir } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const libDir = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");
  const files = await readdir(libDir);
  assert.equal(
    files.includes("experience-review-schedule.js"),
    false,
    "experience-review-schedule.js 不得存在——它承载的正是「专属会话 + 宿主周期任务」旧机制",
  );
  assert.equal(
    files.includes("experience-review-reconcile.js"),
    false,
    "experience-review-reconcile.js 不得存在——它是旧机制的协调器",
  );

  assert.equal(files.includes("experience-review-stage.js"), false, "审核执行体已整层删除，不得存在");
  assert.equal(files.includes("friction-promotion-lock.js"), true, "摩擦晋升互斥模块必须存在");
  assert.equal(files.includes("experience-review-trigger.js"), false, "旧模块名已随改名消失，不得复活");
});
