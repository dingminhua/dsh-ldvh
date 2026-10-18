// Tests for plugin/lib/friction-watermark.js —
// 36 §11「观察范围的切分（水位）」的落地：位置标识、成功才推进、失败不推进、
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
  recordActivity,
  numberOfWindowSlots,
  admitAndRecordDispatch,
  releaseDispatch,
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
    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.lastTurn, null);
    assert.equal(r.value.carrier, "absent");
  });
});

test("推进后回读得到新的轮次，且载体落在 DSH home 的 ldvh 域", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const a = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 7, task: "friction-discovery" });
    assert.ok(a.ok, JSON.stringify(a.error));
    assert.equal(a.value.lastTurn, 7);

    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
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
    await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-1", turn: 3, task: "friction-discovery" });
    await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-2", turn: 9, task: "friction-discovery" });

    const r1 = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-1", task: "friction-discovery" });
    const r2 = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-2", task: "friction-discovery" });
    const r3 = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: "s-3", task: "friction-discovery" });
    assert.equal(r1.value.lastTurn, 3);
    assert.equal(r2.value.lastTurn, 9);
    assert.equal(r3.value.lastTurn, null, "未见过的会话应从零开始");
  });
});

test("水位按项目根分键：不同项目互不影响", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    await advanceWatermark(homeOf(dir), { projectRoot: "/proj/A", sessionId: SESSION, turn: 5, task: "friction-discovery" });
    const b = await readWatermark(homeOf(dir), { projectRoot: "/proj/B", sessionId: SESSION, task: "friction-discovery" });
    assert.equal(b.value.lastTurn, null);
  });
});

test("单调性：拒绝倒退（倒退会使已处理区间被重复计入）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 10, task: "friction-discovery" });
    const back = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 4, task: "friction-discovery" });
    assert.ok(!back.ok);
    assert.equal(back.error.code, "watermark/non_monotonic");

    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.equal(r.value.lastTurn, 10, "被拒的推进不得改变既有水位");
  });
});

test("单调性：允许同值（同一轮重复推进是幂等的）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 6, task: "friction-discovery" });
    const again = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 6, task: "friction-discovery" });
    assert.ok(again.ok, JSON.stringify(again.error));
  });
});

test("推进后精确回读：返回值与回读一致（§8.4 第 5 项同源纪律）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const a = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 12, task: "friction-discovery" });
    assert.ok(a.ok);
    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.equal(r.value.lastTurn, a.value.lastTurn);
  });
});

test("载体内容无法解析时 fail-closed，不静默当作空", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await carrierPathIn(dir);
    await mkdir(join(dir, "ldvh"), { recursive: true });
    await writeFile(path, "{ not json", "utf8");

    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "watermark/unreadable");

    const a = await advanceWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, turn: 1, task: "friction-discovery" });
    assert.ok(!a.ok, "载体损坏时不得据「反正要写」而覆盖——那会静默丢失既有区间");
  });
});

test("载体是数组/标量（形状不符）时 fail-closed", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, "ldvh"), { recursive: true });
    await writeFile(await carrierPathIn(dir), "[1,2,3]", "utf8");
    const r = await readWatermark(homeOf(dir), { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "watermark/carrier_malformed");
  });
});

test("入参校验：缺 projectRoot / sessionId / 非法 turn 均被拒", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const home = homeOf(dir);
    assert.equal((await readWatermark(home, { sessionId: SESSION, task: "friction-discovery" })).error.code, "watermark/invalid_project_root");
    assert.equal((await readWatermark(home, { projectRoot: PROJECT, task: "friction-discovery" })).error.code, "watermark/invalid_session_id");
    assert.equal((await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: -1, task: "friction-discovery" })).error.code, "watermark/invalid_turn");
    assert.equal((await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 1.5, task: "friction-discovery" })).error.code, "watermark/invalid_turn");
    assert.equal((await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" })).error.code, "watermark/invalid_turn");
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
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 5, task: "friction-discovery" }),
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 9, task: "friction-discovery" }),
    ]);
    assert.equal(results[0].ok, true, `较小值的那次不应误报失败：${JSON.stringify(results[0].error)}`);
    assert.equal(results[1].ok, true, JSON.stringify(results[1].error));

    const back = await readWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.equal(back.value.lastTurn, 9, "最终水位应为较大值");
  });
});

test("D3：乱序并发时单调性仍然生效（较小的那个若后到也不得倒退）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const home = homeOf(dir);
    await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 20, task: "friction-discovery" });
    // 20 之后再来一个更小的 7：须被非单调拒绝，而不是静默覆盖
    const back = await advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: 7, task: "friction-discovery" });
    assert.ok(!back.ok);
    assert.equal(back.error.code, "watermark/non_monotonic");
    const after = await readWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.equal(after.value.lastTurn, 20);
  });
});

test("D3：并发写不同会话互不阻塞（按载体串行、非全局串行）", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const home = homeOf(dir);
    const results = await Promise.all([
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: "s-a", turn: 3, task: "friction-discovery" }),
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: "s-b", turn: 4, task: "friction-discovery" }),
      advanceWatermark(home, { projectRoot: PROJECT, sessionId: "s-c", turn: 5, task: "friction-discovery" }),
    ]);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r) => r.error)));
    const a = await readWatermark(home, { projectRoot: PROJECT, sessionId: "s-a", task: "friction-discovery" });
    const c = await readWatermark(home, { projectRoot: PROJECT, sessionId: "s-c", task: "friction-discovery" });
    assert.equal(a.value.lastTurn, 3);
    assert.equal(c.value.lastTurn, 5);
  });
});

test("D3：突发多次并发推进同一会话，全部成功且最终为最大值", async () => {
  await withTemp("ldvh-watermark-", async (dir) => {
    const home = homeOf(dir);
    const turns = [2, 3, 4, 5, 6, 7, 8];
    const results = await Promise.all(
      turns.map((t) => advanceWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, turn: t, task: "friction-discovery" })),
    );
    const failed = results.map((r, i) => (r.ok ? null : `${turns[i]}:${r.error.code}`)).filter(Boolean);
    assert.deepEqual(failed, [], `并发的串行化应保证全部成功，失败项：${failed.join(",")}`);
    const back = await readWatermark(home, { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
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
    const advanced = await advanceWatermark(dshHomePath, { ...o, turn: 7, task: "friction-discovery" });
    assert.equal(advanced.ok, true, "水位推进本身应成功");
    // 派发状态必须原样还在。
    const after = await readDispatchState(dshHomePath, o);
    assert.equal(after.value.dispatchCount, 2, "水位推进后派发计数不得被抹掉");
    assert.equal(after.value.lastDispatchAt, "2026-10-11T01:10:00.000Z", "派发时刻不得被抹掉");
    // 反向：先推水位、再记派发，水位也不得被抹掉。
    await recordDispatch(dshHomePath, { ...o, at: "2026-10-11T01:20:00.000Z" });
    const wm = await readWatermark(dshHomePath, { ...o, task: "friction-discovery" });
    assert.equal(wm.value.lastTurn, 7, "记派发后水位不得被抹掉");
    assert.equal((await readDispatchState(dshHomePath, o)).value.dispatchCount, 3);
  });
});

test("派发状态：并发记录不丢更新（与水位共用同一临界区）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: "/proj", sessionId: "s1", task: "friction-discovery" };
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

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 时刻列表容量（2026-10-14 变更：由「按配置推导」改为**具名常量**）
// ---------------------------------------------------------------------------
//
// **变更经过（workcase-88f3e568，36 §6.2 修订）**：原实现按 `配额窗口 ÷ 最小间隔`
// 推导容量，理由是「间隔若被设为 1 秒，1 小时窗口内可发生 3600 次，写死 64 会低估」。
// 该理由的**前提已被取消**——36 §6.2 取消了「最小间隔」一类准入约束（它被 §6.1 的
// 安静时长结构性吸收），除数不复存在，故容量改由具名常量直接给出。
//
// **刻意不再成立的性质**：旧测试断言「间隔越小容量越大」（1 秒 → 3602）。该性质
// 现在**不成立**，且这不是缺陷——容量不再由任何准入约束推导。

test("numberOfWindowSlots：返回具名常量（容量不再按配置推导——除数已随 §6.2 取消）", async () => {
  const { numberOfWindowSlots, FALLBACK_MAX_DISPATCH_TIMES } = await import("../lib/friction-watermark.js");
  assert.ok(FALLBACK_MAX_DISPATCH_TIMES > 0, "须是有限正值（列表有界，04 §14 第 5 条）");
  assert.equal(numberOfWindowSlots({ quotaWindowMs: 3_600_000, minIntervalMs: 600_000 }), FALLBACK_MAX_DISPATCH_TIMES);
  assert.equal(numberOfWindowSlots({ quotaWindowMs: 3_600_000, minIntervalMs: 1_000 }), FALLBACK_MAX_DISPATCH_TIMES, "间隔不再是输入");
  assert.equal(numberOfWindowSlots({}), FALLBACK_MAX_DISPATCH_TIMES, "缺配置同样返回常量（不再有回落到 0 的分支）");
  assert.equal(numberOfWindowSlots(undefined), FALLBACK_MAX_DISPATCH_TIMES);
});

test("numberOfWindowSlots：**任何入参都不返回 0**（旧实现缺配置返回 0 会让调用方回落）", async () => {
  const { numberOfWindowSlots, FALLBACK_MAX_DISPATCH_TIMES } = await import("../lib/friction-watermark.js");
  // 这是变更带来的行为差异，须显式钉住：调用方现在恒得一个有界正值。
  for (const input of [undefined, {}, { quotaWindowMs: 0 }, { quotaWindowMs: -1 }, { minIntervalMs: 0 }]) {
    assert.equal(numberOfWindowSlots(input), FALLBACK_MAX_DISPATCH_TIMES, `${JSON.stringify(input)} 亦返回常量`);
  }
});

test("recordDispatch：未传 limits 时回落保守下限（不让列表无界增长）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: "/proj", sessionId: "s1" };
    for (let i = 0; i < 80; i += 1) {
      await recordDispatch(dshHomePath, { ...o, at: new Date(1_700_000_000_000 + i * 1000).toISOString() });
    }
    const st = await readDispatchState(dshHomePath, o);
    assert.equal(st.value.dispatchTimes.length, 64, "无配置时按保守下限截断（有界）");
    assert.equal(st.value.dispatchCount, 80, "**累计计数不受列表容量影响**");
  });
});

// ---------------------------------------------------------------------------
// 按任务分别的水位（2026-10-14）——消除「一件成功、一件失败」的重复落地
//   权威：36 §11（水位）+ friction-discovery-provider 登记的残留风险
// ---------------------------------------------------------------------------

test("逐任务水位：一个任务推进不影响另一个（消除重复落地的根因）", async () => {
  await withTemp("watermark-tasks.", async (dir) => {
    const h = homeOf(dir);
    const base = { projectRoot: PROJECT, sessionId: SESSION };
    // 任务 A 推进到 10
    const a = await advanceWatermark(h, { ...base, task: "friction-discovery", turn: 10 });
    assert.ok(a.ok, JSON.stringify(a.error));
    // 任务 B 仍为 null——**互不牵连**是本改造的全部意义
    const rb = await readWatermark(h, { ...base, task: "experience-capture" });
    assert.equal(rb.value.lastTurn, null, "B 未被推进过，其水位必须仍为 null");
    // B 推进到 7，A 不受影响
    await advanceWatermark(h, { ...base, task: "experience-capture", turn: 7 });
    const ra = await readWatermark(h, { ...base, task: "friction-discovery" });
    assert.equal(ra.value.lastTurn, 10, "A 的水位不得因 B 推进而改变");
  });
});

test("逐任务水位：单调性是按任务分别判定的", async () => {
  await withTemp("watermark-tasks.", async (dir) => {
    const h = homeOf(dir);
    const base = { projectRoot: PROJECT, sessionId: SESSION };
    await advanceWatermark(h, { ...base, task: "friction-discovery", turn: 10 });
    // A 倒退被拒
    const back = await advanceWatermark(h, { ...base, task: "friction-discovery", turn: 5 });
    assert.equal(back.ok, false);
    assert.equal(back.error.code, "watermark/non_monotonic");
    // 但 B 可以推进到**超过** A 的值——两个任务各自单调，不互相约束
    const b = await advanceWatermark(h, { ...base, task: "experience-capture", turn: 20 });
    assert.ok(b.ok, JSON.stringify(b.error));
  });
});

test("逐任务水位：缺 task 即 fail-closed（不得静默共用另一任务的水位）", async () => {
  await withTemp("watermark-tasks.", async (dir) => {
    const h = homeOf(dir);
    const r = await readWatermark(h, { projectRoot: PROJECT, sessionId: SESSION });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "watermark/invalid_task");
    const a = await advanceWatermark(h, { projectRoot: PROJECT, sessionId: SESSION, turn: 3 });
    assert.equal(a.ok, false);
    assert.equal(a.error.code, "watermark/invalid_task");
  });
});

test("逐任务水位：旧形态（单条 lastTurn）归属 friction-discovery——改造前只有它写过", async () => {
  await withTemp("watermark-tasks.", async (dir) => {
    const h = homeOf(dir);
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(dir, "ldvh"), { recursive: true });
    // 手写旧形态载体（改造前的结构）
    await writeFile(
      join(dir, "ldvh", "friction-discovery-watermarks.json"),
      JSON.stringify({ [`${PROJECT}::${SESSION}`]: { lastTurn: 42, lastDispatchAt: "2026-01-01T00:00:00.000Z", dispatchCount: 3 } }),
    );
    const legacy = await readWatermark(h, { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.equal(legacy.value.lastTurn, 42, "旧形态的单条水位必须被解释为 friction-discovery 的水位（否则升级后已处理区间被重覆盖）");
    const fresh = await readWatermark(h, { projectRoot: PROJECT, sessionId: SESSION, task: "experience-capture" });
    assert.equal(fresh.value.lastTurn, null, "旧形态下未写过水位的任务仍为 null");
  });
});

test("逐任务水位：推进不抹掉派发状态（同一载体两轴）", async () => {
  await withTemp("watermark-tasks.", async (dir) => {
    const h = homeOf(dir);
    const base = { projectRoot: PROJECT, sessionId: SESSION };
    await recordDispatch(h, { ...base, at: "2026-10-14T01:00:00.000Z" });
    await advanceWatermark(h, { ...base, task: "friction-discovery", turn: 9 });
    const st = await readDispatchState(h, base);
    assert.equal(st.value.dispatchCount, 1, "推进水位不得抹掉派发计数");
    assert.equal(st.value.lastDispatchAt, "2026-10-14T01:00:00.000Z");
    // 反向：记派发不得抹掉任一任务的水位
    await recordDispatch(h, { ...base, at: "2026-10-14T02:00:00.000Z" });
    const wm = await readWatermark(h, { ...base, task: "friction-discovery" });
    assert.equal(wm.value.lastTurn, 9, "记派发不得抹掉水位");
  });
});

// ---------------------------------------------------------------------------
// 任务**改名**的存量迁移（2026-10-14）：idle-review → friction-discovery
//   不迁移的后果是**静默的数据损坏**（既有水位读不到 → 判为首次运行 → 整区间
//   被重覆盖 → 重复计数，而 count 是阈值流转的唯一输入源）。
// ---------------------------------------------------------------------------

test("改名回落：载体里**改名前的键**必须被现行键读到（否则重复计数）", async () => {
  await withTemp("watermark-rename.", async (dir) => {
    const h = homeOf(dir);
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(dir, "ldvh"), { recursive: true });
    // 模拟改名前的载体：tasks 下用的是旧键 idle-review
    await writeFile(
      join(dir, "ldvh", "friction-discovery-watermarks.json"),
      JSON.stringify({ [`${PROJECT}::${SESSION}`]: { tasks: { "idle-review": { lastTurn: 7, advancedAt: "2026-10-13T00:00:00.000Z" } } } }),
    );
    const r = await readWatermark(h, { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.equal(
      r.value.lastTurn, 7,
      "改名前的 idle-review 水位必须被现行键 friction-discovery 读到——读不到会被判为首次运行，"
      + "使已处理区间被重新覆盖而重复计数（count 是阈值流转的唯一输入源）",
    );
  });
});

test("改名回落：写时只用**现行键**，不写旧键（回落面随时间自然消失）", async () => {
  await withTemp("watermark-rename.", async (dir) => {
    const h = homeOf(dir);
    await advanceWatermark(h, { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery", turn: 9 });
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const doc = JSON.parse(await readFile(join(dir, "ldvh", "friction-discovery-watermarks.json"), "utf8"));
    const tasks = doc[`${PROJECT}::${SESSION}`].tasks;
    assert.ok(tasks["friction-discovery"] !== undefined, "应写入现行键");
    assert.equal(tasks["idle-review"], undefined, "不得写入旧键（否则两键并存，回落面永不消失）");
  });
});

test("改名回落：现行键存在时优先于旧键（不因回落覆盖新值）", async () => {
  await withTemp("watermark-rename.", async (dir) => {
    const h = homeOf(dir);
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(dir, "ldvh"), { recursive: true });
    await writeFile(
      join(dir, "ldvh", "friction-discovery-watermarks.json"),
      JSON.stringify({ [`${PROJECT}::${SESSION}`]: { tasks: { "friction-discovery": { lastTurn: 20 }, "idle-review": { lastTurn: 7 } } } }),
    );
    const r = await readWatermark(h, { projectRoot: PROJECT, sessionId: SESSION, task: "friction-discovery" });
    assert.equal(r.value.lastTurn, 20, "现行键须优先——若回落旧键会**倒退**水位，使已处理区间被重复计入");
  });
});

// ---------------------------------------------------------------------------
// 活动时刻的持久化（2026-10-14，36 §6.1 的安静期锚点）
// ---------------------------------------------------------------------------

test("recordActivity：写入并回读活动时刻（36 §6.1 的安静期计时锚）", async () => {
  await withTemp("ldvh-activity-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: "/proj", sessionId: "s1" };
    const at = "2026-10-14T00:00:00.000Z";
    const w = await recordActivity(dshHomePath, { ...o, at });
    assert.ok(w.ok, JSON.stringify(w.error));
    assert.equal(w.value.lastActivityAt, at);

    const st = await readDispatchState(dshHomePath, o);
    assert.equal(st.value.lastActivityAt, at, "须可经 readDispatchState 回读");
  });
});

test("recordActivity：与派发状态**共载体但不互相覆盖**（合并而非重建）", async () => {
  await withTemp("ldvh-activity-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: "/proj", sessionId: "s1" };
    await recordActivity(dshHomePath, { ...o, at: "2026-10-14T00:00:00.000Z" });
    await recordDispatch(dshHomePath, { ...o, at: "2026-10-14T01:00:00.000Z" });
    const st = await readDispatchState(dshHomePath, o);
    assert.equal(st.value.lastActivityAt, "2026-10-14T00:00:00.000Z", "派发不得清掉活动时刻");
    assert.equal(st.value.lastDispatchAt, "2026-10-14T01:00:00.000Z", "活动不得清掉派发时刻");
  });
});

test("recordActivity：同一 key 下的**水位**不被清掉（重建陷阱）", async () => {
  await withTemp("ldvh-activity-", async (dir) => {
    const h = homeOf(dir);
    const o = { projectRoot: PROJECT, sessionId: SESSION };
    await advanceWatermark(h, { ...o, task: "friction-discovery", turn: 42 });
    await recordActivity(h, { ...o, at: "2026-10-14T00:00:00.000Z" });
    const wm = await readWatermark(h, { ...o, task: "friction-discovery" });
    assert.equal(wm.value.lastTurn, 42, "活动写入不得清掉水位（已实测踩过该陷阱）");
  });
});

test("recordActivity：参数缺失即拒绝（fail-closed，不写半条）", async () => {
  await withTemp("ldvh-activity-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    assert.equal((await recordActivity(dshHomePath, { sessionId: "s1" })).ok, false);
    assert.equal((await recordActivity(dshHomePath, { projectRoot: "/p" })).ok, false);
  });
});

test("recordActivity：未传 at 时用当前时刻（调用方无须自造时间戳）", async () => {
  await withTemp("ldvh-activity-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: "/proj", sessionId: "s1" };
    const w = await recordActivity(dshHomePath, o);
    assert.ok(w.ok);
    assert.ok(!Number.isNaN(Date.parse(w.value.lastActivityAt)), "须是可解析的 ISO 时刻");
  });
});

// ── admitAndRecordDispatch / releaseDispatch（2026-10-19）──────────────────
//
// 复现并钉住 2026-10-19 03:00:17 的实测缺陷：四个检查点在同一毫秒相继通过准入，
// 随后派出四个任务清单完全相同的子代理。根因是「判定」与「写锚点」分处两个临界区，
// 并发之下各自读到同一份旧状态、各自放行。

test("并发准入：同一毫秒的四个检查点只放行一个（复现 2026-10-19 缺陷）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const opts = { projectRoot: PROJECT, sessionId: SESSION, at: "2026-10-18T19:00:17.464Z" };

    // 四个**同时启动**的准入，全部不 await 中间态——这正是原来的缺陷形态。
    const results = await Promise.all([
      admitAndRecordDispatch(dshHomePath, { ...opts, token: "tok-1" }),
      admitAndRecordDispatch(dshHomePath, { ...opts, token: "tok-2" }),
      admitAndRecordDispatch(dshHomePath, { ...opts, token: "tok-3" }),
      admitAndRecordDispatch(dshHomePath, { ...opts, token: "tok-4" }),
    ]);

    const admitted = results.filter((r) => r.ok && r.value.admit === true);
    const blocked = results.filter((r) => r.ok && r.value.admit === false);
    assert.equal(admitted.length, 1, `只应放行一个，实际 ${admitted.length}`);
    assert.equal(blocked.length, 3);
    for (const b of blocked) assert.equal(b.value.reason, "dispatch-in-flight");

    // 被挡下的不占计数：dispatchCount 应恰为 1，不是 4。
    const st = await readDispatchState(dshHomePath, { projectRoot: PROJECT, sessionId: SESSION });
    assert.ok(st.ok, JSON.stringify(st.error));
    assert.equal(st.value.dispatchCount, 1, "被挡下的准入不得计入派发次数");
  });
});

test("占用释放后可再次准入（占用不是一次性封印）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: PROJECT, sessionId: SESSION };

    const a = await admitAndRecordDispatch(dshHomePath, { ...o, at: "2026-10-18T19:00:17Z", token: "tok-a" });
    assert.ok(a.ok, JSON.stringify(a.error));
    assert.equal(a.value.admit, true);

    const b = await admitAndRecordDispatch(dshHomePath, { ...o, at: "2026-10-18T19:00:18Z", token: "tok-b" });
    assert.equal(b.value.admit, false, "在途期间第二个必须被挡下");

    const rel = await releaseDispatch(dshHomePath, { ...o, token: "tok-a" });
    assert.ok(rel.ok, JSON.stringify(rel.error));
    assert.equal(rel.value.released, true);

    const c = await admitAndRecordDispatch(dshHomePath, { ...o, at: "2026-10-18T19:00:30Z", token: "tok-c" });
    assert.ok(c.ok, JSON.stringify(c.error));
    assert.equal(c.value.admit, true, "释放后应能重新准入");
  });
});

test("释放是幂等的：token 不符时如实返回 released:false，不抛错", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: PROJECT, sessionId: SESSION };
    await admitAndRecordDispatch(dshHomePath, { ...o, at: "2026-10-18T19:00:17Z", token: "tok-x" });

    const wrong = await releaseDispatch(dshHomePath, { ...o, token: "tok-y" });
    assert.ok(wrong.ok, "token 不符不得报错——收尾路径不应因状态漂移抛异常");
    assert.equal(wrong.value.released, false);
    assert.equal(wrong.value.reason, "token-mismatch");

    // 原占用仍在，故仍拒绝新准入。
    const again = await admitAndRecordDispatch(dshHomePath, { ...o, at: "2026-10-18T19:00:20Z", token: "tok-z" });
    assert.equal(again.value.admit, false);

    // 二次释放（已无占用）也是幂等的。
    await releaseDispatch(dshHomePath, { ...o, token: "tok-x" });
    const twice = await releaseDispatch(dshHomePath, { ...o, token: "tok-x" });
    assert.ok(twice.ok);
    assert.equal(twice.value.released, false);
  });
});

test("租约超时：陈旧的占用被回收而非永久封印（fail-open）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    const o = { projectRoot: PROJECT, sessionId: SESSION };
    const t0 = Date.parse("2026-10-18T19:00:00Z");

    // 第一次占用，租约 1 秒。
    const a = await admitAndRecordDispatch(dshHomePath, {
      ...o, at: "2026-10-18T19:00:00Z", token: "tok-lease", now: t0, staleMs: 1000,
    });
    assert.equal(a.value.admit, true);

    // 租约内（+500ms）：仍算在途。
    const inside = await admitAndRecordDispatch(dshHomePath, {
      ...o, at: "2026-10-18T19:00:00.500Z", token: "tok-new", now: t0 + 500, staleMs: 1000,
    });
    assert.equal(inside.value.admit, false, "租约内不得回收");

    // 租约后（+2000ms）：视为无主并回收——宁可多派一次，不可永久不派。
    const after = await admitAndRecordDispatch(dshHomePath, {
      ...o, at: "2026-10-18T19:00:02Z", token: "tok-newer", now: t0 + 2000, staleMs: 1000,
    });
    assert.ok(after.ok, JSON.stringify(after.error));
    assert.equal(after.value.admit, true, "过期占用应被回收");
    assert.equal(after.value.reclaimedStaleClaim, true, "回收事实须在返回值里可读");
  });
});

test("参数缺失即拒绝（fail-closed，不写半条）", async () => {
  await withTemp("ldvh-dispatch-", async (dir) => {
    const dshHomePath = (...p) => join(dir, ...p);
    assert.equal((await admitAndRecordDispatch(dshHomePath, { sessionId: "s" , token: "t"})).ok, false);
    assert.equal((await admitAndRecordDispatch(dshHomePath, { projectRoot: "/p", token: "t" })).ok, false);
    // token 必填：没有它占用无法被释放。
    const noToken = await admitAndRecordDispatch(dshHomePath, { projectRoot: "/p", sessionId: "s" });
    assert.equal(noToken.ok, false);
    assert.equal(noToken.error.code, "watermark/invalid_token");
  });
});
