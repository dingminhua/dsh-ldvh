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
  readDispatchState,
  recordDispatch,
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

// ---------------------------------------------------------------------------
// 缺陷 D3：并发读-改-写须串行化（对照参考实现 dsh-agent-teams 的 withTeamLock）
//
// 形态：两个检查点重叠时，各自读到同一份旧文档、各自写回——后写者覆盖先写者，
// 且较小的那次因读回不符而**误报失败**（该失败会按 §8.3 入队产生噪音）。
// 参考实现（dsh-agent-teams/src/state.ts:63、scheduler.ts:273）以按 key 排队的
// promise 链解决；此处以同样形制解决并加护栏。
// ---------------------------------------------------------------------------

test("D3：并发推进不互相覆盖，且都成功（无 read_back_mismatch 误报）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const home = homeOf(dir);
    const results = await Promise.all([
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 5 }),
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 9 }),
    ]);
    assert.equal(results[0].ok, true, `较小值的那次不应误报失败：${JSON.stringify(results[0].error)}`);
    assert.equal(results[1].ok, true, JSON.stringify(results[1].error));

    const back = await readWatermark(home, { projectRoot: PROJECT, sessionId: SESSION });
    assert.equal(back.value.lastTurn, 9, "最终水位应为较大值");
  });
});

test("D3：乱序并发时单调性仍然生效（较小的那个若后到也不得倒退）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const home = homeOf(dir);
    await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 20 });
    // 20 之后再来一个更小的 7：须被非单调拒绝，而不是静默覆盖
    const back = await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 7 });
    assert.ok(!back.ok);
    assert.equal(back.error.code, "watermark/non_monotonic");
    const after = await readWatermark(home, { projectRoot: PROJECT, sessionId: SESSION });
    assert.equal(after.value.lastTurn, 20);
  });
});

test("D3：并发写不同会话互不阻塞（按载体串行、非全局串行）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const home = homeOf(dir);
    const results = await Promise.all([
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: "s-a", turn: 3 }),
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: "s-b", turn: 4 }),
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: "s-c", turn: 5 }),
    ]);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.error)));
    const a = await readWatermark(home, { projectRoot: PROJECT, sessionId: "s-a" });
    const c = await readWatermark(home, { projectRoot: PROJECT, sessionId: "s-c" });
    assert.equal(a.value.lastTurn, 3);
    assert.equal(c.value.lastTurn, 5);
  });
});

test("D3：突发多次并发推进同一会话，全部成功且最终为最大值", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const home = homeOf(dir);
    const turns = [2, 3, 4, 5, 6, 7, 8];
    const results = await Promise.all(
      turns.map((t) => advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: t })),
    );
    const failed = results.map((r, i) => (r.ok ? null : `${turns[i]}:${r.error.code}`)).filter(Boolean);
    assert.deepEqual(failed, [], `并发的串行化应保证全部成功，失败项：${failed.join(",")}`);
    const back = await readWatermark(home, { projectRoot: PROJECT, sessionId: SESSION });
    assert.equal(back.value.lastTurn, 8);
  });
});

// ---------------------------------------------------------------------------
// 派发状态与水位**共存于同一载体**（闲时辅助节流用；specs/04 §14 第 5 条禁止
// 新建「第二状态账本」，故并入水位载体而非另起文件）。
// ---------------------------------------------------------------------------
//
// 两轴的分工：
//   · 水位 lastTurn        —— 内容看到哪儿了；**只在该次运行成功后**推进；
//   · 派发状态 lastDispatchAt/dispatchCount —— 跑了多少次、隔了多久；
//                             **在派发之前**写入，故失败也计入冷却。
// 因此二者可以不一致（派发了但落地失败 → lastTurn 落后），那是正常态。

test("派发状态：从未派发时为 null/0（首运不冷却、配额从零起算）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const r = await readDispatchState(dshHomePath, { projectRoot: "/proj", sessionId: "s1" });
    assert.equal(r.ok, true);
    assert.equal(r.value.lastDispatchAt, null, "从未派发 → null（首运不冷却的前提）");
    assert.equal(r.value.dispatchCount, 0, "计数从零起算");
  });
});

test("派发状态：记录递增且可读回", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: "/proj", sessionId: "s1" };
    await recordDispatch(dshHomePath, { ...o, at: "2026-10-11T01:00:00.000Z" });
    await recordDispatch(dshHomePath, { ...o, at: "2026-10-11T01:10:00.000Z" });
    const r = await readDispatchState(dshHomePath, o);
    assert.equal(r.value.dispatchCount, 2);
    assert.equal(r.value.lastDispatchAt, "2026-10-11T01:10:00.000Z", "取最近一次");
  });
});

test("**水位推进不得抹掉派发状态**（同一载体两轴，重建该项即互相覆盖）", async () => {
  // 这是实现中实测踩到的缺陷：`advanceWatermark` 曾用
  //   { ...doc.value, [key]: { lastTurn, advancedAt } }
  // **重建**该项，于是同 key 下的 lastDispatchAt/dispatchCount 被静默清回
  // null/0——冷却与配额随即失效，而**外观上一切正常**（水位照常前进）。
  // 该缺陷只能由「先记派发、再推水位、再读派发」这个顺序暴露。
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: "/proj", sessionId: "s1" };
    // 先记两次派发。
    await recordDispatch(dshHomePath, { ...o, at: "2026-10-11T01:00:00.000Z" });
    await recordDispatch(dshHomePath, { ...o, at: "2026-10-11T01:10:00.000Z" });
    // 再推一次水位。
    const advanced = await advanceWatermark(dshHomePath, { ...o, turn: 7 });
    assert.equal(advanced.ok, true, "水位推进本身应成功");
    // 派发状态必须原样还在。
    const after = await readDispatchState(dshHomePath, o);
    assert.equal(after.value.dispatchCount, 2, "水位推进后派发计数不得被抹掉");
    assert.equal(after.value.lastDispatchAt, "2026-10-11T01:10:00.000Z", "派发时刻不得被抹掉");
    // 反向：先推水位、再记派发，水位也不得被抹掉。
    await recordDispatch(dshHomePath, { ...o, at: "2026-10-11T01:20:00.000Z" });
    const wm = await readWatermark(dshHomePath, o);
    assert.equal(wm.value.lastTurn, 7, "记派发后水位不得被抹掉");
    assert.equal((await readDispatchState(dshHomePath, o)).value.dispatchCount, 3);
  });
});

test("派发状态：并发记录不丢更新（与水位共用同一临界区）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: "/proj", sessionId: "s1" };
    // 两个并发 recordDispatch 各自读整份文档、改自己那一项、写回——
    // 无串行化时后写者覆盖先写者，计数会少一次。
    await Promise.all([
      recordDispatch(dshHomePath, { ...o, at: "2026-10-11T02:00:00.000Z" }),
      recordDispatch(dshHomePath, { ...o, at: "2026-10-11T02:00:01.000Z" }),
    ]);
    assert.equal((await readDispatchState(dshHomePath, o)).value.dispatchCount, 2, "两次并发必须都记上");
  });
});

test("派发状态：按「项目根 + 会话」分键（跨项目、跨会话各自独立）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    await recordDispatch(dshHomePath, { projectRoot: "/a", sessionId: "s1", at: "2026-10-11T01:00:00.000Z" });
    await recordDispatch(dshHomePath, { projectRoot: "/b", sessionId: "s1", at: "2026-10-11T01:00:00.000Z" });
    assert.equal((await readDispatchState(dshHomePath, { projectRoot: "/a", sessionId: "s1" })).value.dispatchCount, 1);
    assert.equal((await readDispatchState(dshHomePath, { projectRoot: "/b", sessionId: "s1" })).value.dispatchCount, 1, "另一项目独立");
    assert.equal((await readDispatchState(dshHomePath, { projectRoot: "/a", sessionId: "s2" })).value.dispatchCount, 0, "另一会话独立");
  });
});

test("派发状态：缺参与非法入参一律拒绝（不得静默写坏载体）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    assert.equal((await readDispatchState(dshHomePath, { sessionId: "s" })).ok, false);
    assert.equal((await recordDispatch(dshHomePath, { projectRoot: "/p" })).ok, false);
    assert.equal((await recordDispatch(dshHomePath, {})).ok, false);
  });
});
