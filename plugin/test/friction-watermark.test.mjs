// Tests for plugin/lib/friction-watermark.js —
// 04 §8.4「观察范围的切分（水位）」的落地：位置标识、成功才推进、失败不推进、
// 重复覆盖不重复计数、水位不进入事实源。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  readWatermark,
  advanceWatermark,
  describeWindow,
  WATERMARK_RELATIVE_PATH,
} from "../lib/friction-watermark.js";
import { withTemp } from "./helpers.mjs";

const PROJECT = "/tmp/some-governed-project";
const SESSION = "session-aaaa-bbbb";

/** dshHomePath 形如 (…names) => join(root, …names)，与 lifecycle 的注入形态一致。 */
function homeOf(root) {
  return (...names) => join(root, ...names);
}

async function carrierPathIn(root) {
  return join(root, ...WATERMARK_RELATIVE_PATH);
}

test("首次运行：水位缺席不是失败，而是「覆盖全部既有内容」", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.lastTurn, null);
    assert.equal(r.value.carrier, "absent");
  });
});

test("推进后回读得到新的轮次，且载体落在 DSH home 的 ldvh 域", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const a = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 7 });
    assert.ok(a.ok, JSON.stringify(a.error));
    assert.equal(a.value.lastTurn, 7);

    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION });
    assert.equal(r.value.lastTurn, 7);
    assert.equal(r.value.carrier, "present");

    const path = await carrierPathIn(dir);
    assert.equal(path, join(dir, "ldvh", "friction-discovery-watermarks.json"));
    const raw = JSON.parse(await readFile(path, "utf8"));
    assert.equal(typeof raw, "object");
  });
});

test("水位按「项目根 + 会话」分键：不同会话互不影响", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-1", turn: 3 });
    await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-2", turn: 9 });

    const r1 = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-1" });
    const r2 = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-2" });
    const r3 = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-3" });
    assert.equal(r1.value.lastTurn, 3);
    assert.equal(r2.value.lastTurn, 9);
    assert.equal(r3.value.lastTurn, null, "未见过的会话应从零开始");
  });
});

test("水位按项目根分键：不同项目互不影响", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    await advanceWatermark(homeOf(dir), { projectRoot: "/proj/A", sessionId: SESSION, turn: 5 });
    const b = await readWatermark(homeOf(dir), { projectRoot: "/proj/B", sessionId: SESSION });
    assert.equal(b.value.lastTurn, null);
  });
});

test("单调性：拒绝倒退（倒退会使已处理区间被重复计入）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 10 });
    const back = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 4 });
    assert.ok(!back.ok);
    assert.equal(back.error.code, "watermark/non_monotonic");

    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION });
    assert.equal(r.value.lastTurn, 10, "被拒的推进不得改变既有水位");
  });
});

test("单调性：允许同值（同一轮重复推进是幂等的）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 6 });
    const again = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 6 });
    assert.ok(again.ok, JSON.stringify(again.error));
  });
});

test("推进后精确回读：返回值与回读一致（§8.4 第 5 项同源纪律）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const a = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 12 });
    assert.ok(a.ok);
    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION });
    assert.equal(r.value.lastTurn, a.value.lastTurn);
  });
});

test("载体内容无法解析时 fail-closed，不静默当作空", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await carrierPathIn(dir);
    await mkdir(join(dir, "ldvh"), { recursive: true });
    await writeFile(path, "{ not json", "utf8");

    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "watermark/unreadable");

    const a = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 1 });
    assert.ok(!a.ok, "载体损坏时不得据「反正要写」而覆盖——那会静默丢失既有区间");
  });
});

test("载体是数组/标量（形状不符）时 fail-closed", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, "ldvh"), { recursive: true });
    await writeFile(await carrierPathIn(dir), "[1,2,3]", "utf8");
    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "watermark/carrier_malformed");
  });
});

test("入参校验：缺 projectRoot / sessionId / 非法 turn 均被拒", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const home = homeOf(dir);
    assert.equal((await readWatermark(home, { sessionId: SESSION })).error.code, "watermark/invalid_project_root");
    assert.equal((await readWatermark(home, { projectRoot: PROJECT })).error.code, "watermark/invalid_session_id");
    assert.equal((await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: -1 })).error.code, "watermark/invalid_turn");
    assert.equal((await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 1.5 })).error.code, "watermark/invalid_turn");
    assert.equal((await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION })).error.code, "watermark/invalid_turn");
  });
});

test("describeWindow：区间端点只是位置标识，不设默认扩大", async () => {
  assert.deepEqual(describeWindow({ lastTurn: null }, 5), { from: null, to: 5 });
  assert.deepEqual(describeWindow({ lastTurn: 3 }, 5), { from: 3, to: 5 });
  assert.deepEqual(describeWindow({ lastTurn: 3 }, null), { from: 3, to: null });
  assert.deepEqual(describeWindow(undefined, undefined), { from: null, to: null });
});

test("水位不进入事实源：载体路径在 DSH home 的 ldvh 域下，与事实目录无关", () => {
  assert.deepEqual([...WATERMARK_RELATIVE_PATH], ["ldvh", "friction-discovery-watermarks.json"]);
  assert.ok(!WATERMARK_RELATIVE_PATH.includes("frictions"), "水位不得落在 Friction 账目目录");
});
