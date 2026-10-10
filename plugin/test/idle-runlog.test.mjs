// Tests for plugin/lib/idle-runlog.js —
// 空闲检查点的运行痕迹：固定容量环形（**上界**）、只追加不修改、
// 并发读-改-写串行化、载体损坏 fail-closed、不进入事实源。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { recordRun, readRuns, RUNLOG_RELATIVE_PATH, MAX_ENTRIES } from "../lib/idle-runlog.js";
import { withTemp } from "./helpers.mjs";

function homeOf(root) {
  return (...names) => join(root, ...names);
}

const carrierIn = (root) => join(root, ...RUNLOG_RELATIVE_PATH);

test("首次运行：载体缺席不是失败，而是空环形", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const r = await readRuns(homeOf(dir));
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.deepEqual(r.value, { total: 0, runs: [] });
  });
});

test("记录一条：可回读且字段完整", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const home = homeOf(dir);
    const w = await recordRun(home, {
      at: "2026-10-11T04:40:00.000Z",
      task: "idle-review",
      stage: "landed",
      action: "none",
      watermark: 33,
    });
    assert.ok(w.ok, JSON.stringify(w.error));
    assert.equal(w.value.size, 1);

    const r = await readRuns(home, { latest: true });
    assert.equal(r.value.total, 1);
    assert.equal(r.value.run.stage, "landed");
    assert.equal(r.value.run.action, "none");
    assert.equal(r.value.run.watermark, 33);
    assert.equal(r.value.run.task, "idle-review");
  });
});

test("容量上界：超过 MAX_ENTRIES 即丢最旧（这是用户关切的直接答复）", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const home = homeOf(dir);
    for (let i = 0; i < MAX_ENTRIES + 20; i += 1) {
      await recordRun(home, { task: "idle-review", stage: "landed", note: `run-${i}` });
    }
    const r = await readRuns(home);
    assert.equal(r.value.total, MAX_ENTRIES, "文件条目数须有硬上界，不得随运行次数无限增长");
    // 保留的是**最近**的，最旧的已丢
    assert.equal(r.value.runs[r.value.runs.length - 1].note, `run-${MAX_ENTRIES + 19}`);
    assert.equal(r.value.runs[0].note, "run-20");
  });
});

test("容量上界：文件字节数同样有界（不得只限条数而单条膨胀）", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const home = homeOf(dir);
    for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
      await recordRun(home, { task: "idle-review", stage: "landed", note: "x".repeat(5000) });
    }
    const raw = await readFile(carrierIn(dir), "utf8");
    // 单条 note 被截断到 300 字 + 省略号，故总量约 MAX_ENTRIES × 数百字节
    assert.ok(raw.length < MAX_ENTRIES * 1200, `载体不得膨胀：实测 ${raw.length} 字节`);
  });
});

test("只追加不修改：既有条目在后续写入中原样保留", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const home = homeOf(dir);
    await recordRun(home, { at: "2026-10-11T01:00:00.000Z", task: "idle-review", stage: "landed", action: "create" });
    await recordRun(home, { at: "2026-10-11T02:00:00.000Z", task: "idle-review", stage: "not-implemented" });
    const r = await readRuns(home);
    assert.equal(r.value.runs[0].at, "2026-10-11T01:00:00.000Z");
    assert.equal(r.value.runs[0].action, "create", "既有条目不得被后续写入改写");
    assert.equal(r.value.runs[1].stage, "not-implemented");
  });
});

test("at 缺省时自动补当前时刻（调用方不必自己造时间戳）", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const before = new Date().toISOString();
    await recordRun(homeOf(dir), { task: "idle-review", stage: "landed" });
    const r = await readRuns(homeOf(dir), { latest: true });
    assert.ok(typeof r.value.run.at === "string" && r.value.run.at.length > 0);
    assert.ok(r.value.run.at >= before, "自动时间戳须为当前时刻或之后");
  });
});

test("limit 取最近 N 条；latest 只回最后一条", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const home = homeOf(dir);
    for (let i = 0; i < 5; i += 1) await recordRun(home, { task: "idle-review", stage: "landed", note: `n${i}` });
    const three = await readRuns(home, { limit: 3 });
    assert.equal(three.value.runs.length, 3);
    assert.equal(three.value.total, 5, "total 须报真实总数，不因 limit 而截断");
    assert.equal(three.value.runs[0].note, "n2");
    const latest = await readRuns(home, { latest: true });
    assert.equal(latest.value.run.note, "n4");
  });
});

test("无记录时 latest 回 null（不抛错、不编造）", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const r = await readRuns(homeOf(dir), { latest: true });
    assert.ok(r.ok);
    assert.equal(r.value.run, null);
    assert.equal(r.value.total, 0);
  });
});

test("载体损坏：非 JSON 对象时 fail-closed（不静默当作空）", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const path = carrierIn(dir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify([1, 2, 3]), "utf8");
    const r = await readRuns(homeOf(dir));
    assert.ok(!r.ok, "损坏的载体须如实报错，不得当作空环形——那会静默丢掉既有痕迹");
    assert.equal(r.error.code, "runlog/carrier_malformed");
  });
});

test("载体损坏：缺 runs 数组时同样 fail-closed", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const path = carrierIn(dir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ nope: 1 }), "utf8");
    const r = await readRuns(homeOf(dir));
    assert.ok(!r.ok);
    assert.equal(r.error.code, "runlog/carrier_malformed");
  });
});

test("损坏时写入也被拒（不得覆盖掉可能可救的载体）", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const path = carrierIn(dir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "not json at all", "utf8");
    const w = await recordRun(homeOf(dir), { task: "idle-review", stage: "landed" });
    assert.ok(!w.ok);
  });
});

test("并发写入不丢记录、不互相覆盖（与水位 D3 同类风险）", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const home = homeOf(dir);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => recordRun(home, { task: "idle-review", stage: "landed", note: `c${i}` })),
    );
    const r = await readRuns(home);
    assert.equal(r.value.total, 12, "并发写入的 12 条须全部留存——读-改-写未串行化时会被互相覆盖");
    const notes = new Set(r.value.runs.map((x) => x.note));
    assert.equal(notes.size, 12, "不得有重复或丢失");
  });
});

test("长 note 被截断（单条不得无界膨胀）", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    await recordRun(homeOf(dir), { task: "idle-review", stage: "stopped", note: "y".repeat(1000) });
    const r = await readRuns(homeOf(dir), { latest: true });
    assert.ok(r.value.run.note.length <= 301, `note 须被截断，实测 ${r.value.run.note.length}`);
  });
});

test("不写项目仓库：载体只在 DSH home 之下", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    await recordRun(homeOf(dir), { task: "idle-review", stage: "landed" });
    assert.deepEqual(RUNLOG_RELATIVE_PATH, ["ldvh", "idle-checkpoint-runs.json"]);
    const raw = await readFile(carrierIn(dir), "utf8");
    assert.ok(raw.includes("runs"), "载体须为环形文档");
  });
});

test("stage 字段承载「落到哪一步」——这是本模块存在的理由", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    const home = homeOf(dir);
    // 五种结局都能被区分——「跑了但没发现」与「根本没跑」不再无从分辩
    for (const stage of ["skipped", "not-implemented", "stopped", "landed", "land-failed"]) {
      await recordRun(home, { task: "idle-review", stage });
    }
    const r = await readRuns(home);
    assert.deepEqual(r.value.runs.map((x) => x.stage), ["skipped", "not-implemented", "stopped", "landed", "land-failed"]);
  });
});

// ---------------------------------------------------------------------------
// 「诊断不得反过来弄坏机制」——本模块是诊断旁路，不是 §8.4 闭集里的机械校验。
// 它若抛错会打断检查点路径：为了可观测性反而让机制变脆，与目的相反。
// ---------------------------------------------------------------------------

test("形态异常一律不抛错（dshHomePath 非函数）", async () => {
  for (const bad of ["not-a-function", undefined, null, 42]) {
    const w = await recordRun(bad, { stage: "landed" });
    assert.ok(!w.ok, "须如实返回 failure 而非抛错");
    assert.equal(w.error.code, "runlog/unavailable");
    const r = await readRuns(bad);
    assert.ok(!r.ok);
  }
});

test("dshHomePath 自身抛错时也不得抛（不得让诊断打断机制）", async () => {
  const throwing = () => {
    throw new Error("home resolver exploded");
  };
  const w = await recordRun(throwing, { stage: "landed" });
  assert.ok(!w.ok);
  assert.equal(w.error.code, "runlog/unavailable");
});

test("dshHomePath 返回非字符串时不抛", async () => {
  const w = await recordRun(() => undefined, { stage: "landed" });
  assert.ok(!w.ok);
});

test("载体不可写时不抛（只读目录等环境问题）", async () => {
  await withTemp("ldvh-runlog-", async (dir) => {
    // 用一个必然失败的 home：把它指向一个文件而非目录
    const { writeFile } = await import("node:fs/promises");
    const filePath = join(dir, "not-a-dir");
    await writeFile(filePath, "x", "utf8");
    const home = (...names) => join(filePath, ...names);
    const w = await recordRun(home, { stage: "landed" });
    assert.ok(!w.ok, "写不进去须回 failure，不得抛");
  });
});
