// Tests for plugin/lib/idle-checkpoint.js — 调度与 fail-closed 编排.
//
// Authority: specs/36 §12（fail-closed 收口） and specs/32 §10.2 (预算轮换).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runIdleCheckpoint,
  AUX_TASKS,
} from "../lib/idle-checkpoint.js";
import { readPendingQueue } from "../lib/pending-queue.js";
import { testSignature } from "./helpers.mjs";

const TEST_SIGNATURE = testSignature();

// §8.4 水位段要求调度方给出「会话 + 轮次」两个位置标识，否则无法界定本次观察区间
// （缺之即 fail-closed，不得退化为覆盖全部内容）。测试统一用固定值。
const RUN_SESSION = "session-idle-checkpoint-test";

async function withHome(fn) {
  const base = await mkdtemp(join(tmpdir(), "idle-checkpoint-"));
  const home = (...segments) => join(base, "home", ...segments);
  const factSourceRoot = join(base, "ldvh-base");
  await fn({ home, factSourceRoot, base });
}

// ---------------------------------------------------------------------------
// 任务清单（Human 决定 2026-10-11：删除轮换，一次派发做全部已启用的事）
// ---------------------------------------------------------------------------
//
// 原「32 §10.2 预算轮换」的两条测试已删——轮换概念（`selectAuxTask` /
// `HEALTH_CHECK_PERIOD`）随该决定从代码中移除，旧测试既无对象也无意义。替代它的
// 是 `pickEnabledAuxTasks` 的多任务测试（见 idle-settings.test.mjs），以及下方
// 「任务清单的分派」两条。

test("多任务：清单里既有已实现又有未实现时，已实现的照常跑（不因一件没实现而整批不跑）", async () => {
  // 「勾了三件，其中两件没实现」是**常态**（默认配置就是如此）。若按「有一件没
  // 实现就整批不跑」，Human 从痕迹里看不出为什么——而实际能做的那些本来可以做。
  await withHome(async ({ home, factSourceRoot }) => {
    const result = await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      tasks: ["friction-discovery", "capacity-maintenance", "memory-health"],
      sessionId: RUN_SESSION,
      currentTurn: 5,
    });
    assert.equal(result.ok, true, "清单含已实现任务时不得失败");
    assert.deepEqual(result.value.tasks, ["friction-discovery", "capacity-maintenance", "memory-health"]);
    assert.deepEqual(
      result.value.unimplemented,
      ["capacity-maintenance", "memory-health"],
      "未实现者须如实带出，使调用方能记进痕迹（§8.5：不得主张空闲维护已运行）",
    );
  });
});

test("多任务：清单里**全**是未实现者时，如实报 not-implemented（不假装跑过）", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const result = await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      tasks: ["capacity-maintenance", "memory-health"],
      sessionId: RUN_SESSION,
      currentTurn: 5,
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.outcome, "not-implemented");
    assert.deepEqual(result.value.unimplemented, ["capacity-maintenance", "memory-health"]);
  });
});

test("多任务：清单顺序原样带出（痕迹与提示词的次序不得被本层重排）", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const result = await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      tasks: ["memory-health", "friction-discovery"],
      sessionId: RUN_SESSION,
      currentTurn: 5,
    });
    assert.deepEqual(result.value.tasks, ["memory-health", "friction-discovery"], "调用方给的次序须原样保留");
  });
});

// ---------------------------------------------------------------------------
// §8.5：未实现的任务如实报告，不假装跑过
// ---------------------------------------------------------------------------

test("§8.5：容量/体检尚未实现时如实报告 not-implemented，不假装已运行", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    for (const task of ["capacity-maintenance", "memory-health"]) {
      const result = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task, sessionId: RUN_SESSION, currentTurn: 5 });
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
    const result = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "friction-discovery", sessionId: RUN_SESSION, currentTurn: 5 });
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
      task: "friction-discovery",
      sessionId: RUN_SESSION,
      currentTurn: 5,
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

    const result = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "friction-discovery", sessionId: RUN_SESSION, currentTurn: 5 });
    assert.ok(!result.ok, "an incomplete dedup input must stop the run");
    assert.equal(result.error.code, "idle_checkpoint/stopped");
    assert.ok(typeof result.error.pending_entry_id === "string", "the stop is registered in the pending queue");

    const queue = await readPendingQueue(home);
    assert.equal(queue.value.items.length, 1);
    assert.equal(queue.value.items[0].task, "friction-discovery");
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

    const result = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "friction-discovery", sessionId: RUN_SESSION, currentTurn: 5 });
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

    await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "friction-discovery", sessionId: RUN_SESSION, currentTurn: 5 });
    await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "friction-discovery", sessionId: RUN_SESSION, currentTurn: 5 });

    const queue = await readPendingQueue(home);
    assert.equal(queue.value.items.length, 2, "each stop is its own append (仅追加, no silent overwrite)");
  });
});

test("§8.3：执行体抛错时入队，且错误不逃逸到宿主事件分发", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const result = await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      task: "friction-discovery",
      sessionId: RUN_SESSION,
      currentTurn: 5,
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

test("§8.3：缺 factSourceRoot 时拒绝并说明（不自造路径），且须入待处置队列", async () => {
  await withHome(async ({ home }) => {
    const result = await runIdleCheckpoint({ dshHomePath: home, task: "friction-discovery" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "idle_checkpoint/no_fact_source");
    // 36 §12：fail-closed 停止须登记待处置队列（不得只在返回值里报一声就消失）。
    // 此前这三条前置是裸 return failure，一条都没入队——实测 2026-10-19 重启后
    // 六次 no_current_turn 在队列里查无记录。
    const queue = await readPendingQueue(home);
    assert.equal(queue.value.items.length, 1, "前置校验失败同样要入队");
    assert.equal(queue.value.items[0].task, "friction-discovery");
    assert.match(queue.value.items[0].reason, /factSourceRoot is required/);
    assert.ok(result.error.pending_entry_id, "返回值须带 entry_id，使「已登记」可核对");
  });
});

// ---------------------------------------------------------------------------
// §8.4「观察范围的切分（水位）」：区间界定、成功才推进、失败不推进
// ---------------------------------------------------------------------------

test("§8.4 水位：把本次区间（自上水位起）交给执行体", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    let sawWindow;
    await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      task: "friction-discovery",
      sessionId: RUN_SESSION,
      currentTurn: 9,
      discover: async ({ window: w }) => {
        sawWindow = w;
        return { outcome: "no-new-obstacle" };
      },
    });
    // 首次运行：上水位为空 → 区间自起点起（覆盖既有内容），终点是本次轮次。
    assert.deepEqual(sawWindow, { from: null, to: 9 });
  });
});

test("§8.4 水位：执行体成功时不自行推进，而是把可推进轮次交给调用方（顺序纪律）", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const { readWatermark } = await import("../lib/friction-watermark.js");
    const r = await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      task: "friction-discovery",
      sessionId: RUN_SESSION,
      currentTurn: 4,
      discover: async () => ({ outcome: "no-new-obstacle", watermarkTurn: 4 }),
    });
    assert.ok(r.ok, JSON.stringify(r.error));
    // 复核发现①：本层**不再自行推进**——推进须在调用方**落地成功之后**发生，
    // 否则落地失败时水位已前进而账目未写入，那段内容永不复查。
    assert.equal(r.value.pending_watermark_turn, 4, "可推进轮次须交给调用方");
    assert.equal(r.value.watermark_advanced, false, "本层不推进");
    const w = await readWatermark(home, { projectRoot: factSourceRoot, sessionId: RUN_SESSION, task: "friction-discovery" });
    assert.equal(w.value.lastTurn, null, "调用方尚未推进，水位应保持不变");
  });
});

test("§8.4 水位：执行体未给 watermarkTurn 时不推进（回读未通过即不推进）", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const { readWatermark } = await import("../lib/friction-watermark.js");
    const r = await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      task: "friction-discovery",
      sessionId: RUN_SESSION,
      currentTurn: 4,
      discover: async () => ({ outcome: "no-new-obstacle" }),
    });
    assert.ok(r.ok);
    assert.equal(r.value.watermark_advanced, false, "没有回读通过就不推进");
    const w = await readWatermark(home, { projectRoot: factSourceRoot, sessionId: RUN_SESSION, task: "friction-discovery" });
    assert.equal(w.value.lastTurn, null, "水位必须保持未推进");
  });
});

test("§8.4 水位：skipped 不推进（本次没处理该区间，推进会使内容永失观察机会）", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const { readWatermark } = await import("../lib/friction-watermark.js");
    const r = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "friction-discovery", sessionId: RUN_SESSION, currentTurn: 4 });
    assert.equal(r.value.outcome, "skipped");
    assert.equal(r.value.watermark_advanced, false);
    const w = await readWatermark(home, { projectRoot: factSourceRoot, sessionId: RUN_SESSION, task: "friction-discovery" });
    assert.equal(w.value.lastTurn, null);
  });
});

test("§8.4 水位：执行体抛错时不推进（fail-closed 侧，下次重覆盖同一区间）", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const { readWatermark } = await import("../lib/friction-watermark.js");
    const r = await runIdleCheckpoint({
      dshHomePath: home,
      factSourceRoot,
      task: "friction-discovery",
      sessionId: RUN_SESSION,
      currentTurn: 4,
      discover: async () => {
        throw new Error("subagent exploded");
      },
    });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "idle_checkpoint/stopped");
    const w = await readWatermark(home, { projectRoot: factSourceRoot, sessionId: RUN_SESSION, task: "friction-discovery" });
    assert.equal(w.value.lastTurn, null, "执行体失败不得推进水位");
  });
});

test("§8.4 水位：缺 sessionId / currentTurn 时 fail-closed（不得退化为覆盖全部内容）", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const noSession = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "friction-discovery", currentTurn: 4 });
    assert.ok(!noSession.ok);
    assert.equal(noSession.error.code, "idle_checkpoint/no_session_id");

    const noTurn = await runIdleCheckpoint({ dshHomePath: home, factSourceRoot, task: "friction-discovery", sessionId: RUN_SESSION });
    assert.ok(!noTurn.ok);
    assert.equal(noTurn.error.code, "idle_checkpoint/no_current_turn");

    // 36 §12：两条前置失败都须入待处置队列。实测 2026-10-19 重启后六次
    // no_current_turn 在队列里查无记录——「已停止」与「已登记」是两件事，
    // 只做前者等于让失败凭空消失。
    const queue = await readPendingQueue(home);
    assert.equal(queue.value.items.length, 2, "每次停止各追加一条（仅追加，不覆盖）");
    assert.match(queue.value.items[0].reason, /sessionId is required/);
    assert.match(queue.value.items[1].reason, /currentTurn \(the turn published by the host event payload\) is required/);
    assert.ok(noSession.error.pending_entry_id);
    assert.ok(noTurn.error.pending_entry_id);
  });
});

test("§8.4 水位：第二次运行从上次水位起算（区间不再从零开始）", async () => {
  await withHome(async ({ home, factSourceRoot }) => {
    const seen = [];
    // 调用方负责在「落地成功之后」推进水位（顺序纪律）——此测试模拟一个
    // 正确实现的调用方。
    const { advanceWatermark } = await import("../lib/friction-watermark.js");
    const run = async () => {
      const r = await runIdleCheckpoint({
        dshHomePath: home,
        factSourceRoot,
        task: "friction-discovery",
        sessionId: RUN_SESSION,
        currentTurn: seen.length === 0 ? 3 : 8,
        discover: async ({ window: w }) => {
          seen.push(w);
          return { outcome: "no-new-obstacle", watermarkTurn: w.to };
        },
      });
      if (r.ok && Number.isInteger(r.value.pending_watermark_turn)) {
        await advanceWatermark(home, { projectRoot: factSourceRoot, sessionId: RUN_SESSION, turn: r.value.pending_watermark_turn, task: "friction-discovery" });
      }
      return r;
    };
    await run();
    await run();
    assert.deepEqual(seen[0], { from: null, to: 3 }, "首次覆盖全部既有内容");
    assert.deepEqual(seen[1], { from: 3, to: 8 }, "第二次只覆盖新增区间——同一段内容不会被反复计入");
  });
});
