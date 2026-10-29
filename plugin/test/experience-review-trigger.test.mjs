/**
 * 审核触发时机的契约（2026-10-27 二次修订后）。
 *
 * ## 这组测试守的是什么
 *
 * 不是「函数返回什么」，而是**两个结构性缺陷不再回来**：
 *
 * **其一：审核不得有落点会话。** 旧实现的「专属会话」是一个普通对话，会被人当工作
 * 对话使用——2026-10-27 实测：`session-2827e177` 在 03:22:51 被本插件创建（标题
 * 「LDVH 经验审核 · dsh-ldvh」），03:29:49 Human 就在里面提问「我们的经验召回是否
 * 有作用」。审核提醒直接投进 Human 正在工作的对话，Human 的内容也被当成审核上下文。
 * 只因落点是可用对话，这个占用就必然发生——改投递路由治不了。故改为「静置触发 +
 * 进程内互斥」。
 *
 * **其二：审核不得有时间间隔。** 去掉落点会话后仍留着「距上次审核满 N 分钟才派发」
 * 这道闸，但间隔本就是给「每小时往那个会话投一次」定频用的——落点没了，就没有东西
 * 需要定频。留着它的后果是**静置到期、审核该跑却不跑，而界面上看不出来**。Human
 * 2026-10-27：「==，这个不存在时间了呀，随静置触发」。故连同 `isReviewDue()` /
 * `reviewTiming()` / `markReviewCompleted()` 与配置项一并删除。
 *
 * 故这里钉住四件事：
 *   1. 判据只有两项：静置到期（由检查点本身承载）＋ 无审核在跑；
 *   2. 并发第二枪必须被**跳过**而不是排队（排队会让过时内容被成文）；
 *   3. 抛错后互斥标志必须释放（否则一次失败永久卡死审核，外观像「没配置」）；
 *   4. **间隔机制整体不存在**——模块不导出任何到期/记时函数，设置面无该字段。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isReviewRunning, runReviewExclusive } from "../lib/experience-review-trigger.js";

test("**没有「到期」这个概念**：模块不导出任何间隔/记时函数", async () => {
  // 这是本组最重要的一条之一。它守的**不是某个函数的返回值**，而是「间隔这个机制
  // 不存在」——只要有人把 isReviewDue / reviewTiming / markReviewCompleted 重新加
  // 回来（哪怕是「为了兼容」），本条立刻变红。
  //
  // 为什么必须用「不存在」而不是「返回值正确」来守：一个恒返回 `{due:true}` 的
  // isReviewDue 在行为上与「没有间隔」等价，但它把「间隔机制还在」写成了代码事实，
  // 下一次有人要「调小间隔」时就会把它接回派发路径——那是本条要防的形态。
  const mod = await import("../lib/experience-review-trigger.js");
  for (const gone of ["isReviewDue", "reviewTiming", "markReviewCompleted"]) {
    assert.equal(gone in mod, false, `trigger 模块不得导出 ${gone}——审核随静置触发，没有间隔可判定`);
  }
  // 保留的机制仍须在（去掉的是间隔，不是互斥）。
  assert.equal(typeof mod.isReviewRunning, "function", "isReviewRunning 必须保留");
  assert.equal(typeof mod.runReviewExclusive, "function", "runReviewExclusive 必须保留");
});

test("**设置面不得有审核间隔字段**（间隔数值属已废止的量）", async () => {
  const { readFile } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const rel of ["lib/index.js", "lib/idle-settings.js", "lib/client.js"]) {
    const raw = await readFile(join(root, rel), "utf8");
    // 允许出现在「已删除」这类说明性注释里，但不允许作为真字段出现。
    const asField = /experienceReviewIntervalMs\s*:\s*(volatileField|z\.)/.test(raw)
      || /"row\.experienceReviewIntervalMs"/.test(raw)
      || /key:\s*"experienceReviewIntervalMs"/.test(raw)
      || /intervalMs:\s*readPositiveNumber/.test(raw);
    assert.equal(asField, false, `${rel} 不得把 experienceReviewIntervalMs 作为真字段承载`);
  }
});

// 2026-10-30：互斥从**进程内布尔**改为**项目级跨进程文件锁**。
// 故这里的调用形态随之变为 async 且带 {dshHomePath, projectId, fn}。

async function withLockHome(fn) {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "review-lock."));
  const home = (...parts) => join(root, "dsh-home", ...parts);
  return fn({ root, home });
}

test("互斥：空闲时不忙，跑完之后恢复空闲", async () => {
  await withLockHome(async ({ home }) => {
    assert.equal((await isReviewRunning(home, "proj")).busy, false, "初态须空闲");
    const r = await runReviewExclusive({ dshHomePath: home, projectId: "proj", sessionId: "s", fn: async () => "done" });
    assert.equal(r.skipped, false);
    assert.equal(r.value, "done");
    assert.equal((await isReviewRunning(home, "proj")).busy, false, "跑完后必须恢复空闲——否则审核从此再也不触发");
  });
});

test("互斥：**并发第二枪被跳过**，不排队、不并发执行", async () => {
  await withLockHome(async ({ home }) => {
    let aStarted = false;
    const first = runReviewExclusive({
      dshHomePath: home, projectId: "proj", sessionId: "s1",
      fn: async () => {
        aStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return "A";
      },
    });
    // 等第一枪确实进入执行体，再发第二枪。
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(aStarted, true, "前提：第一枪已在执行");
    const second = await runReviewExclusive({ dshHomePath: home, projectId: "proj", sessionId: "s2", fn: async () => "B" });

    assert.equal(second.skipped, true, "第二次必须被跳过");
    assert.equal(second.reason, "review-in-flight");
    assert.equal(second.value, undefined, "被跳过时不得执行、不得产生结果");
    assert.equal((await first).value, "A");
  });
});

test("互斥：执行体抛错时锁仍须释放（否则一次失败会永久卡死审核）", async () => {
  await withLockHome(async ({ home }) => {
    await assert.rejects(
      () => runReviewExclusive({ dshHomePath: home, projectId: "proj", sessionId: "s", fn: async () => { throw new Error("boom"); } }),
      /boom/,
    );
    assert.equal((await isReviewRunning(home, "proj")).busy, false, "抛错后必须释放——否则审核再也跑不起来，且外观像「没配置」");
  });
});

test("互斥是**项目级**：另一个项目不受本项目持锁影响（11 §6.1）", async () => {
  await withLockHome(async ({ home }) => {
    let releaseA;
    const aRunning = new Promise((resolve) => { releaseA = resolve; });
    const first = runReviewExclusive({
      dshHomePath: home, projectId: "proj-a", sessionId: "s",
      fn: async () => { await aRunning; return "A"; },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal((await isReviewRunning(home, "proj-a")).busy, true, "A 项目在跑");
    assert.equal((await isReviewRunning(home, "proj-b")).busy, false, "B 项目不受影响——互斥按项目分区");

    const second = await runReviewExclusive({ dshHomePath: home, projectId: "proj-b", sessionId: "s", fn: async () => "B" });
    assert.equal(second.skipped, false, "另一个项目可以同时跑");
    assert.equal(second.value, "B");

    releaseA();
    assert.equal((await first).value, "A");
  });
});

test("互斥：崩溃残留的陈旧锁可被回收，不会永久卡死", async () => {
  await withLockHome(async ({ home }) => {
    const { writeReviewLockForTest, REVIEW_LOCK_STALE_MS } = await import("../lib/experience-review-trigger.js");
    // 写一个「很久以前开始」的锁，模拟持锁者崩溃。
    const startedAt = new Date(Date.now() - REVIEW_LOCK_STALE_MS - 60_000).toISOString();
    await writeReviewLockForTest(home, "proj", { projectId: "proj", sessionId: "dead", startedAt, pid: 1 });

    assert.equal((await isReviewRunning(home, "proj")).busy, false, "过期锁不算在跑");
    const r = await runReviewExclusive({ dshHomePath: home, projectId: "proj", sessionId: "s", fn: async () => "ok" });
    assert.equal(r.skipped, false, "陈旧锁被回收后应能拿到锁");
    assert.equal(r.value, "ok");
  });
});

// ── 结构：不再有专属会话 ─────────────────────────────────────────────

test("**旧机制已整体移除**：不存在「专属会话 / 宿主周期任务」这套载体", async () => {
  // 这是本组测试最重要的一条：它守的不是某个函数，而是**那种承载方式不再回来**。
  // 只要有人重新引入「按固定标题找/建一个会话当审核落点」，这条就红。
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

  // 审核段仍须存在（去掉的是载体，不是功能）。
  assert.equal(files.includes("experience-review-stage.js"), true, "审核执行体本身必须保留");
  assert.equal(files.includes("experience-review-trigger.js"), true, "触发时机模块必须存在");
});
