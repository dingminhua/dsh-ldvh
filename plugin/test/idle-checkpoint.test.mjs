// Tests for plugin/lib/idle-checkpoint.js — 调度与 fail-closed 编排.
//
// Authority: specs/04 §8.4 (§8.3 fail-closed 收口) and specs/32 §10.2 (预算轮换).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runIdleCheckpoint,
  selectAuxTask,
  AUX_TASKS,
  HEALTH_CHECK_PERIOD,
} from "../lib/idle-checkpoint.js";
import { readPendingQueue } from "../lib/pending-queue.js";
import { testSignature } from "./helpers.mjs";

const TEST_SIGNATURE = testSignature();

async function withHome(fn) {
  const base = await mkdtemp(join(tmpdir(), "idle-checkpoint-"));
  const home = (...segments) => join(base, "home", ...segments);
  const factSourceRoot = join(base, "ldvh-base");
  await fn({ home, factSourceRoot, base });
}

// ---------------------------------------------------------------------------
// 32 §10.2：预算轮换
// ---------------------------------------------------------------------------

test("32 §10.2：评审优先，体检周期性出现（如每 N 次触发一次）", () => {
  const seen = [];
  for (let i = 0; i < 9; i += 1) seen.push(selectAuxTask(i));
  // 前两次评审，第三次体检——评审优先、体检周期 3。
  assert.deepEqual(seen.slice(0, 3), ["idle-review", "idle-review", "memory-health"]);
  assert.equal(seen.filter((t) => t === "memory-health").length, 3, "one health check per period across 9 rotations");
  for (const task of seen) assert.ok(AUX_TASKS.includes(task), `${task} must be a known aux task`);
});

test("32 §10.2：轮换是纯函数——同输入同输出，状态由调用方持有", () => {
  assert.equal(selectAuxTask(2), selectAuxTask(2));
  assert.equal(selectAuxTask(999), "idle-review");
  assert.equal(HEALTH_CHECK_PERIOD, 3);
});

// ---------------------------------------------------------------------------
// §8.5：未实现的任务如实报告，不假装跑过
// ---------------------------------------------------------------------------

test("§8.5：容量/体检尚未实现时如实报告 not-implemented，不假装已运行", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    for (const task of ["capacity-maintenance", "memory-health"]) {
      const result = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task });
      assert.ok(result.ok, JSON.stringify(result.error));
      assert.equal(result.value.outcome, "not-implemented");
    }
    // 未实现的任务不入队、不记账。
    const queue = await readPendingQueue(home);
    assert.equal(queue.value.items.length, 0);
  });
});

// ---------------------------------------------------------------------------
// §8.4 第 1 项：机械前提齐备时，无子代理 → skipped（不越界代判）
// ---------------------------------------------------------------------------

test("§8.4 第 1 项：无语义判断提供者时 skipped——机械层不得代为查重", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const result = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "idle-review" });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.outcome, "skipped");
    assert.equal(result.value.threshold, 3);
    assert.match(result.value.reason, /语义判断|gap/);

    // 关键：没有创建任何账目——无语义判断就没有入账依据。
    const { listFrictionObjects } = await import("../lib/friction-writer.js");
    const listed = await listFrictionObjects({ factSourceRoot });
    assert.equal(listed.value.items.length, 0, "no ledger entry may be created without a semantic judgement");
  });
});

test("§8.4：有子代理时把机械前提交给它，并上抛其结论", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    let sawThreshold;
    let sawCandidates;
    const result = await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      task: "idle-review",
      discover: async ({ threshold, candidates }) => {
        sawThreshold = threshold;
        sawCandidates = candidates;
        return { outcome: "no-new-obstacle" };
      },
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(sawThreshold, 3, "the subagent receives the fixed threshold");
    assert.ok(Array.isArray(sawCandidates), "the subagent receives the dedup candidates");
    assert.equal(result.value.outcome, "no-new-obstacle");
  });
});

// ---------------------------------------------------------------------------
// §8.3：fail-closed 与待处置登记
// ---------------------------------------------------------------------------

test("§8.3：账本有不可读载体时停止，并把原因与残留追加进待处置队列", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    // 造一个坏载体：文件名合法但无 frontmatter。
    const { mkdir } = await import("node:fs/promises");
    const dir = join(factSourceRoot, "frictions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "friction-11111111-2222-4333-8444-555555555555.md"), "no frontmatter here", "utf8");

    const result = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "idle-review" });
    assert.ok(!result.ok, "an incomplete dedup input must stop the run");
    assert.equal(result.error.code, "idle_checkpoint/stopped");
    assert.ok(typeof result.error.pending_entry_id === "string", "the stop is registered in the pending queue");

    const queue = await readPendingQueue(home);
    assert.equal(queue.value.items.length, 1);
    assert.equal(queue.value.items[0].task, "idle-review");
    assert.match(queue.value.items[0].reason, /查重输入不完整/);
    assert.ok(queue.value.items[0].residual.length > 0, "the residual scope names the unreadable carrier");
  });
});

test("§8.3 第 6 条：队列不可写时不得降级登记，且如实上报 queue_unavailable", async () => {
  await withHome(async ({ factSourceRoot, base }) => {
    // 用一个把 DSH home 指向普通文件的 home 函数 → 队列必然不可写。
    const fileAsDir = join(base, "blocked");
    await writeFile(fileAsDir, "x", "utf8");
    const home = (...segments) => join(fileAsDir, ...segments);

    const { mkdir } = await import("node:fs/promises");
    const dir = join(factSourceRoot, "frictions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "friction-11111111-2222-4333-8444-555555555555.md"), "bad", "utf8");

    const result = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "idle-review" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "idle_checkpoint/queue_unavailable");
    assert.equal(result.error.queue_unavailable, true, "the caller must be able to tell the stop was NOT registered");
    assert.match(result.error.message, /未登记|不得降级/);
  });
});

test("§8.3 第 3 项：停止后不自行重试——同一失败再跑一次会追加第二条登记（不静默覆盖）", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const { mkdir } = await import("node:fs/promises");
    const dir = join(factSourceRoot, "frictions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "friction-11111111-2222-4333-8444-555555555555.md"), "bad", "utf8");

    await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "idle-review" });
    await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "idle-review" });

    const queue = await readPendingQueue(home);
    assert.equal(queue.value.items.length, 2, "each stop is its own append (仅追加, no silent overwrite)");
  });
});

test("§8.3：执行体抛错时入队，且错误不逃逸到宿主事件分发", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const result = await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      task: "idle-review",
      discover: async () => {
        throw new Error("子代理中断");
      },
    });
    assert.ok(!result.ok, "a throwing subagent stops the run");
    assert.equal(result.error.code, "idle_checkpoint/stopped");

    const queue = await readPendingQueue(home);
    assert.equal(queue.value.items.length, 1);
    assert.match(queue.value.items[0].reason, /子代理中断/);
  });
});

test("§8.3：缺 factSourceRoot 时拒绝并说明（不自造路径）", async () => {
  await withHome(async ({ home }) => {
    const result = await runIdleCheckpoint({ dshHomePath: home, task: "idle-review" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "idle_checkpoint/no_fact_source");
  });
});
