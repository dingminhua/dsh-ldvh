/**
 * 审核触发时机（形态 2）的契约（2026-10-27 重做，Human 方案）。
 *
 * ## 这组测试守的是什么
 *
 * 不是「函数返回什么」，而是**一个结构性缺陷不再回来**：
 *
 * 旧实现按 `specs/11 §6.1` 形态 2 走「宿主周期任务 + 绑定专属会话」。那个「专属
 * 会话」是一个**普通对话**，会被人当工作对话使用——2026-10-27 实测：`session-2827e177`
 * 在 03:22:51 被本插件创建（标题「LDVH 经验审核 · dsh-ldvh」），03:29:49 Human
 * 就在里面提问「我们的经验召回是否有作用」。于是审核提醒直接投进 Human 正在工作的
 * 对话，Human 的内容也被当成审核上下文。
 *
 * 只因落点是可用对话，这个占用就必然发生——改投递路由治不了。故改为「静置触发 +
 * 进程内互斥」，不再有任何落点会话。
 *
 * 故这里钉住三件事：
 *   1. 到期判据计的是「距上次审核」，不是「距上次静置」；
 *   2. 从未跑过 → **立即到期**（开启后不必再等一个完整间隔）；
 *   3. 并发第二枪必须被**跳过**而不是排队（排队会让过时内容被成文）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isReviewDue, isReviewRunning, markReviewCompleted, reviewTiming, runReviewExclusive } from "../lib/experience-review-trigger.js";

// 模块级状态会在同一进程的测试间残留，故每个用例开头复位。
function resetTiming() {
  markReviewCompleted(null);
}

test("到期判据：从未跑过 → **立即**到期（不该再等一个完整间隔）", () => {
  resetTiming();
  const r = isReviewDue({ lastRunAtMs: null, intervalMs: 3_600_000, nowMs: 1_000 });
  assert.equal(r.due, true, "开启后第一次审核应立即到期，否则要等满一小时才第一次审");
  assert.equal(r.reason, "never-ran");
});

test("到期判据：未满间隔 → 不到期，且给出剩余时长", () => {
  const r = isReviewDue({ lastRunAtMs: 1_000, intervalMs: 60_000, nowMs: 31_000 });
  assert.equal(r.due, false);
  assert.equal(r.reason, "not-yet");
  assert.equal(r.remainingMs, 30_000, "剩余时长须可读——诊断靠它说明「还要等多久」");
});

test("到期判据：已满间隔 → 到期", () => {
  const r = isReviewDue({ lastRunAtMs: 1_000, intervalMs: 60_000, nowMs: 61_000 });
  assert.equal(r.due, true);
  assert.equal(r.reason, "interval-elapsed");
});

test("间隔非法时**不到期**（不猜一个默认值去跑）", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null, "60000"]) {
    const r = isReviewDue({ lastRunAtMs: 0, intervalMs: bad, nowMs: 10_000_000 });
    assert.equal(r.due, false, `intervalMs=${String(bad)} 不得判为到期`);
  }
});

test("上次时刻不可读时**不到期**（宁可少跑一次，不按错值算间隔）", () => {
  const r = isReviewDue({ lastRunAtMs: "not-a-number", intervalMs: 60_000, nowMs: 10_000_000 });
  assert.equal(r.due, false);
  assert.equal(r.reason, "last-run-unreadable");
});

test("互斥：空闲时不忙，跑完之后恢复空闲", async () => {
  resetTiming();
  assert.equal(isReviewRunning().busy, false, "初态须空闲");
  const r = await runReviewExclusive(async () => "done");
  assert.equal(r.skipped, false);
  assert.equal(r.value, "done");
  assert.equal(isReviewRunning().busy, false, "跑完后必须恢复空闲——否则审核从此再也不触发");
});

test("互斥：**并发第二枪被跳过**，不排队、不并发执行", async () => {
  resetTiming();
  let aStarted = false;
  const first = runReviewExclusive(async () => {
    aStarted = true;
    await new Promise((resolve) => setTimeout(resolve, 60));
    return "A";
  });
  // 等第一枪确实进入执行体，再发第二枪。
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(aStarted, true, "前提：第一枪已在执行");
  const second = await runReviewExclusive(async () => "B");

  assert.equal(second.skipped, true, "第二次必须被跳过");
  assert.equal(second.reason, "review-in-flight");
  assert.equal(second.value, undefined, "被跳过时不得执行、不得产生结果");
  assert.equal((await first).value, "A");
});

test("互斥：执行体抛错时标志仍须释放（否则一次失败会永久卡死审核）", async () => {
  resetTiming();
  await assert.rejects(() => runReviewExclusive(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(isReviewRunning().busy, false, "抛错后必须释放——否则审核再也跑不起来，且外观像「没配置」");
});

test("记时只在跑完之后发生：跳过时不改记时", async () => {
  resetTiming();
  assert.equal(reviewTiming().lastCompletedAtMs, null);
  markReviewCompleted(12_345);
  assert.equal(reviewTiming().lastCompletedAtMs, 12_345);
  // 被跳过的调用不得改写记时（否则会假装「刚跑过」，把下一次审核推迟一整个间隔）
  const blocker = runReviewExclusive(async () => { await new Promise((r) => setTimeout(r, 40)); });
  await new Promise((r) => setTimeout(r, 5));
  const skipped = await runReviewExclusive(async () => "nope");
  assert.equal(skipped.skipped, true);
  assert.equal(reviewTiming().lastCompletedAtMs, 12_345, "跳过不得改写上次审核时刻");
  await blocker;
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
