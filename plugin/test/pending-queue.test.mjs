// Tests for plugin/lib/pending-queue.js — the §8.3 待处置队列 carrier.
//
// Every case is derived from specs/04 §8.3 「队列载体」 (the single authority).
// Where the implementation diverges from the spec the failure is reported, never
// "fixed" by bending the assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendPendingEntry,
  readPendingQueue,
  resolvePendingEntry,
  countPendingEntries,
  QUEUE_RELATIVE_PATH,
} from "../lib/pending-queue.js";

/** dshHomePath 的形状与 governed-projects 一致：一个 (...)segments => path 的函数。 */
async function withHome(fn) {
  const base = await mkdtemp(join(tmpdir(), "pending-queue-"));
  const home = (...segments) => join(base, ...segments);
  home.base = base;
  try {
    await fn(home);
  } finally {
    // temp dirs are left for the OS; no cleanup service is mandated by the spec
  }
}

function validEntry(overrides = {}) {
  return {
    task: "friction-discovery",
    reason: "回读不完整：写入后比对失败",
    residual: ["ldvh-base/frictions/friction-<uid>.md 可能已部分写入"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §8.3 第 3 条：仅追加
// ---------------------------------------------------------------------------

test("append: appends a well-formed entry and creates the carrier under the DSH home (§8.3 第 3 条)", async () => {
  await withHome(async (home) => {
    const result = await appendPendingEntry(home, validEntry());
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.ok(typeof result.value.entry_id === "string" && result.value.entry_id.length > 0);

    // 载体位置：DSH home 之下，**不进入事实源**（§8.3 第 1 条）。
    const raw = await readFile(join(home.base, ...QUEUE_RELATIVE_PATH), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 1, "one append writes one JSONL line");
    const parsed = JSON.parse(lines[0]);
    for (const field of ["at", "task", "reason", "residual", "resolved_at"]) {
      assert.ok(field in parsed, `§8.3 第 2 条 requires field "${field}"`);
    }
    assert.equal(parsed.resolved_at, null, "a fresh entry is unresolved");
    assert.match(parsed.at, /^\d{4}-\d{2}-\d{2}T/, "at is RFC3339");
  });
});

test("append: two appends accumulate two lines, the first is byte-identical (§8.3 第 3 条 仅追加)", async () => {
  await withHome(async (home) => {
    await appendPendingEntry(home, validEntry({ reason: "第一次" }));
    const afterFirst = await readFile(join(home.base, ...QUEUE_RELATIVE_PATH), "utf8");
    await appendPendingEntry(home, validEntry({ reason: "第二次" }));
    const afterSecond = await readFile(join(home.base, ...QUEUE_RELATIVE_PATH), "utf8");
    assert.equal(afterSecond.trim().split("\n").length, 2);
    assert.ok(afterSecond.startsWith(afterFirst), "append never rewrites the existing prefix");
  });
});

test("append: missing task / reason / residual are each refused (§8.3 第 2 条 必含字段)", async () => {
  await withHome(async (home) => {
    for (const field of ["task", "reason", "residual"]) {
      const entry = validEntry();
      delete entry[field];
      const result = await appendPendingEntry(home, entry);
      assert.ok(!result.ok, `${field} must be required`);
      assert.match(result.error.code, /^pending_queue\//);
    }
  });
});

test("append: residual must be an array — absent side-effect scope is not the same as 'no side effects' (§8.3 第 2 条)", async () => {
  await withHome(async (home) => {
    const result = await appendPendingEntry(home, validEntry({ residual: "not-an-array" }));
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pending_queue/invalid_residual");
  });
});

// 2026-10-18：`task` 的契约是**非空字符串**，但调用方曾整批传数组
// （`plugin/lib/lifecycle.js` 的缺署名分支，自 `39e3623` 多任务派发改造起）。
// 数组在**参数校验阶段**即被拒，而该调用方丢弃了返回值，于是「缺署名」这条
// 登记从未真正入队、且不留任何痕迹（实测 2026-10-17T18:11 那次
// `land-failed/no-signature` 在队列里查无此条）。
// 本用例把这个契约钉住：非字符串必被拒，且**不得写入任何行**。
test("append: a non-string task is refused at validation and writes nothing (callers must not batch tasks)", async () => {
  await withHome(async (home) => {
    for (const badTask of [["a", "b"], 42, null, ""]) {
      const result = await appendPendingEntry(home, validEntry({ task: badTask }));
      assert.ok(!result.ok, `task=${JSON.stringify(badTask)} must be refused`);
      assert.equal(result.error.code, "pending_queue/invalid_task");
    }
    // 一次都不能落盘：拒绝发生在任何文件操作之前。
    await assert.rejects(
      readFile(join(home.base, "ldvh", "pending-queue.jsonl"), "utf8"),
      "a refused append must not create the carrier",
    );
    // 对照：字符串 task 照常写入，证明上面失败的是守卫而非队列不可用。
    const ok = await appendPendingEntry(home, validEntry({ task: "friction-discovery" }));
    assert.ok(ok.ok, "a string task must still be accepted");
    const raw = await readFile(join(home.base, "ldvh", "pending-queue.jsonl"), "utf8");
    assert.equal(raw.trim().split("\n").length, 1);
  });
});

test("append: empty residual array is accepted (verified-empty scope is a statement, not an omission)", async () => {
  await withHome(async (home) => {
    const result = await appendPendingEntry(home, validEntry({ residual: [] }));
    assert.ok(result.ok, JSON.stringify(result.error));
  });
});

// ---------------------------------------------------------------------------
// §8.3 第 6 条：载体不可用时 fail-closed
// ---------------------------------------------------------------------------

test("append: an unwritable carrier fails closed, never degrades to memory/log (§8.3 第 6 条)", async () => {
  await withHome(async (home) => {
    // 让 DSH home 路径的父级是一个普通文件——mkdir 必然失败。
    const blocked = await mkdtemp(join(tmpdir(), "pending-queue-"));
    const fileAsDir = join(blocked, "not-a-dir");
    await writeFile(fileAsDir, "x", "utf8");
    const brokenHome = (...segments) => join(fileAsDir, ...segments);
    const result = await appendPendingEntry(brokenHome, validEntry());
    assert.ok(!result.ok, "an unusable carrier must not report success");
    assert.equal(result.error.code, "pending_queue/unavailable");
  });
});

// ---------------------------------------------------------------------------
// §8.3 第 4 条：读取者
// ---------------------------------------------------------------------------

test("read: absent carrier is a legitimate empty state, not a failure (§8.3 第 4 条)", async () => {
  await withHome(async (home) => {
    const result = await readPendingQueue(home);
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.deepEqual(result.value.items, []);
    assert.equal(result.value.total, 0);
    assert.equal(result.value.carrier, "absent");
  });
});

test("read: default returns only unresolved entries; includeResolved returns history (§8.3 第 4 条)", async () => {
  await withHome(async (home) => {
    const a = await appendPendingEntry(home, validEntry({ reason: "A" }));
    await appendPendingEntry(home, validEntry({ reason: "B" }));
    await resolvePendingEntry(home, a.value.entry_id);

    const open = await readPendingQueue(home);
    assert.ok(open.ok, JSON.stringify(open.error));
    assert.equal(open.value.items.length, 1);
    assert.equal(open.value.items[0].reason, "B");
    assert.equal(open.value.unresolved, 1);
    assert.equal(open.value.total, 2);

    const all = await readPendingQueue(home, { includeResolved: true });
    assert.equal(all.value.items.length, 2);
  });
});

test("read: a malformed line is reported in invalid, never silently dropped (03 §8.1)", async () => {
  await withHome(async (home) => {
    await appendPendingEntry(home, validEntry({ reason: "good" }));
    const path = join(home.base, ...QUEUE_RELATIVE_PATH);
    const raw = await readFile(path, "utf8");
    // 一条坏 JSON + 一条缺字段的合法 JSON
    await writeFile(path, `${raw}{not json}\n{"at":"2026-01-01T00:00:00.000Z"}\n`, "utf8");

    const result = await readPendingQueue(home);
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.items.length, 1, "the good entry is still returned");
    assert.equal(result.value.invalid.length, 2, "both malformed lines are surfaced");
    assert.equal(result.value.complete, false, "a reader must know it is not seeing everything");
  });
});

// ---------------------------------------------------------------------------
// §8.3 第 5 条：核查与解除
// ---------------------------------------------------------------------------

test("resolve: stamps resolved_at and preserves every other field byte-identically (§8.3 第 5 条)", async () => {
  await withHome(async (home) => {
    const appended = await appendPendingEntry(home, validEntry());
    const before = JSON.parse((await readFile(join(home.base, ...QUEUE_RELATIVE_PATH), "utf8")).trim());

    const resolved = await resolvePendingEntry(home, appended.value.entry_id, { note: "已核对，残留已清理" });
    assert.ok(resolved.ok, JSON.stringify(resolved.error));

    const after = JSON.parse((await readFile(join(home.base, ...QUEUE_RELATIVE_PATH), "utf8")).trim());
    assert.equal(after.resolved_at, resolved.value.resolved_at);
    assert.match(after.resolved_at, /^\d{4}-\d{2}-\d{2}T/);
    for (const field of ["entry_id", "at", "task", "reason"]) {
      assert.equal(after[field], before[field], `${field} must survive resolution unchanged`);
    }
    assert.deepEqual(after.residual, before.residual);
  });
});

test("resolve: unknown id is refused, not a silent success (§8.3 第 5 条)", async () => {
  await withHome(async (home) => {
    await appendPendingEntry(home, validEntry());
    const result = await resolvePendingEntry(home, "11111111-2222-4333-8444-555555555555");
    assert.ok(!result.ok);
    assert.equal(result.error.code, "pending_queue/entry_not_found");
  });
});

test("resolve: resolving the same entry twice is refused (no accidental second 'clearance')", async () => {
  await withHome(async (home) => {
    const appended = await appendPendingEntry(home, validEntry());
    const first = await resolvePendingEntry(home, appended.value.entry_id);
    assert.ok(first.ok, JSON.stringify(first.error));
    const second = await resolvePendingEntry(home, appended.value.entry_id);
    assert.ok(!second.ok);
    assert.equal(second.error.code, "pending_queue/already_resolved");
  });
});

test("resolve: malformed lines survive a resolution write (a write must not discard what a reader was told about)", async () => {
  await withHome(async (home) => {
    const appended = await appendPendingEntry(home, validEntry());
    const path = join(home.base, ...QUEUE_RELATIVE_PATH);
    const raw = await readFile(path, "utf8");
    await writeFile(path, `${raw}{broken\n`, "utf8");

    const resolved = await resolvePendingEntry(home, appended.value.entry_id);
    assert.ok(resolved.ok, JSON.stringify(resolved.error));

    // §8.3 第 4 条：坏行仍须可见（读取侧单列），不得被解除写入吞掉。
    const result = await readPendingQueue(home);
    assert.equal(result.value.invalid.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 会话启动清点（§8.3 第 4 条 / 32 §10.2 第 2 项）
// ---------------------------------------------------------------------------

test("count: reports unresolved and invalid counts without mutating the queue", async () => {
  await withHome(async (home) => {
    await appendPendingEntry(home, validEntry());
    const path = join(home.base, ...QUEUE_RELATIVE_PATH);
    const before = await readFile(path, "utf8");

    const counted = await countPendingEntries(home);
    assert.ok(counted.ok, JSON.stringify(counted.error));
    assert.equal(counted.value.unresolved, 1);
    assert.equal(counted.value.invalid, 0);

    assert.equal(await readFile(path, "utf8"), before, "counting is read-only");
  });
});

test("count: an absent carrier reports zero rather than failing at session start", async () => {
  await withHome(async (home) => {
    const counted = await countPendingEntries(home);
    assert.ok(counted.ok, JSON.stringify(counted.error));
    assert.equal(counted.value.unresolved, 0);
    assert.equal(counted.value.carrier, "absent");
  });
});
