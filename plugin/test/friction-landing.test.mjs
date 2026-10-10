// Tests for plugin/lib/friction-landing.js —
// 缺陷 D2 的修复：把子代理的结构化判断按 04 §8.4 闭集第 2–4 项写成账目。
//
// 本模块是「判断 → 账目」的那条此前缺失的接缝。测试要证明：
//   ① 三态各自的机械动作正确（补充级更新 / 创建 / 无动作）；
//   ② 第 2 项之后确实执行第 4 项（阈值流转），且**只**作用于本次涉及的那条账目；
//   ③ 任一环节失败即整体失败（调用方据此按 §8.3 入队），不停在半路；
//   ④ 不越界：不做存量遍历、不自行判断同题、不解释语义。
import { test } from "node:test";
import assert from "node:assert/strict";

import { landDiscoveryVerdict } from "../lib/friction-landing.js";
import { readFrictionObject, listFrictionObjects } from "../lib/friction-writer.js";
import { withTemp, testSignature } from "./helpers.mjs";

const SIG = testSignature();

/** 建一个空的账本目录（landing 只读写 factSourceRoot 下的账目）。 */
async function withLedger(fn) {
  await withTemp("ldvh-landing-", async (dir) => {
    const factSourceRoot = dir;
    await fn({ factSourceRoot });
  });
}

function newObstacleVerdict(overrides = {}) {
  return {
    verdict: "new-obstacle",
    target_uid: "",
    title: "CI 慢",
    phenomenon: "CI 平均 8 分钟。",
    basis: "可归因于串行化任务编排；修了会更好。",
    impact: "medium",
    reason: "本次区间内观察到 CI 反复超时。",
    ...overrides,
  };
}

function sameObstacleVerdict(uid, overrides = {}) {
  return {
    verdict: "same-obstacle",
    target_uid: uid,
    title: "",
    phenomenon: "",
    basis: "",
    impact: "light",
    reason: "本次区间内再次出现同一现象。",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 三态 → 机械动作
// ---------------------------------------------------------------------------

test("no-discovery：不动作、不创建、不推进（闭集里没有对应项）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const r = await landDiscoveryVerdict({
      factSourceRoot,
      verdict: { verdict: "no-discovery", target_uid: "", title: "", phenomenon: "", basis: "", impact: "light", reason: "无发现。" },
      sessionSignature: SIG,
    });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.action, "none");
    assert.equal(r.value.object_uid, null);

    const listed = await listFrictionObjects({ factSourceRoot });
    assert.equal(listed.value.items.length, 0, "不得凭空创建账目");
  });
});

test("new-obstacle：创建 observing 账目，初值 count=1、status=observing（第 3 项）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const r = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict(), sessionSignature: SIG });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.action, "create");
    assert.ok(r.value.object_uid, "必须回传新建账目的 uid");

    const read = await readFrictionObject({ factSourceRoot, objectUid: r.value.object_uid });
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.frontmatter.status, "observing");
    assert.equal(read.value.frontmatter.occurrence.count, 1);
    assert.equal(read.value.frontmatter.occurrence.human_return_at, null, "26 §8：human_return_at 初值为 null");
    assert.equal(read.value.frontmatter.impact, "medium");
    assert.match(read.value.body, /CI 平均 8 分钟/);
  });
});

test("new-obstacle：count=1 不足阈值，故不流转（第 4 项正常跳过，非失败）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const r = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict(), sessionSignature: SIG });
    assert.ok(r.ok);
    assert.equal(r.value.promoted, false);
    const read = await readFrictionObject({ factSourceRoot, objectUid: r.value.object_uid });
    assert.equal(read.value.frontmatter.status, "observing", "count=1 < N=3，不得流转");
  });
});

test("same-obstacle：补充级更新使 count 递增 1、last_at 更新、status 不变（第 2 项）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const created = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict(), sessionSignature: SIG });
    const uid = created.value.object_uid;
    const before = await readFrictionObject({ factSourceRoot, objectUid: uid });

    const at = "2026-10-11T08:00:00.000Z";
    const r = await landDiscoveryVerdict({
      factSourceRoot,
      verdict: sameObstacleVerdict(uid),
      observationAt: at,
      sessionSignature: SIG,
    });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.action, "supplement");
    assert.equal(r.value.count_before, 1);
    assert.equal(r.value.count, 2);

    const after = await readFrictionObject({ factSourceRoot, objectUid: uid });
    assert.equal(after.value.frontmatter.occurrence.count, 2);
    assert.equal(after.value.frontmatter.occurrence.last_at, at, "last_at 须更新为本次观察时间");
    assert.equal(after.value.frontmatter.occurrence.first_at, before.value.frontmatter.occurrence.first_at, "first_at 不变");
    assert.equal(after.value.frontmatter.status, "observing", "第 2 项不改状态");
  });
});

test("same-obstacle：现象段与计数在同一次更新内（只增叙述不增 count 会使阈值失去输入）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const created = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict(), sessionSignature: SIG });
    const uid = created.value.object_uid;
    const before = await readFrictionObject({ factSourceRoot, objectUid: uid });

    await landDiscoveryVerdict({ factSourceRoot, verdict: sameObstacleVerdict(uid, { reason: "第二次观察到。" }), sessionSignature: SIG });
    const after = await readFrictionObject({ factSourceRoot, objectUid: uid });

    assert.equal(after.value.frontmatter.occurrence.count, 2);
    assert.notEqual(after.value.body, before.value.body, "现象段须同时被扩展");
    assert.match(after.value.body, /第二次观察到/);
  });
});

// ---------------------------------------------------------------------------
// 第 4 项：阈值流转
// ---------------------------------------------------------------------------

test("same-obstacle：补足到 count≥N 时，同一次运行内完成 observing → open（第 4 项）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const created = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict(), sessionSignature: SIG });
    const uid = created.value.object_uid;

    // 第 2 次：count 1 → 2，未达 3
    const second = await landDiscoveryVerdict({ factSourceRoot, verdict: sameObstacleVerdict(uid), sessionSignature: SIG });
    assert.ok(second.ok, JSON.stringify(second.error));
    assert.equal(second.value.promoted, false, "count=2 < 3 不流转");

    // 第 3 次：count 2 → 3，达阈值 → 应流转
    const third = await landDiscoveryVerdict({ factSourceRoot, verdict: sameObstacleVerdict(uid), sessionSignature: SIG });
    assert.ok(third.ok, JSON.stringify(third.error));
    assert.equal(third.value.count, 3);
    assert.equal(third.value.promoted, true, "count≥3 且 status=observing 即流转（电平条件）");
    assert.equal(third.value.status, "open");

    const after = await readFrictionObject({ factSourceRoot, objectUid: uid });
    assert.equal(after.value.frontmatter.status, "open");
    assert.equal(after.value.frontmatter.occurrence.count, 3);
  });
});

test("第 4 项幂等：已 open 者再补充不再流转（26 §9.2「已是 open 者不再匹配」）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const created = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict(), sessionSignature: SIG });
    const uid = created.value.object_uid;
    for (let i = 0; i < 2; i += 1) {
      await landDiscoveryVerdict({ factSourceRoot, verdict: sameObstacleVerdict(uid), sessionSignature: SIG });
    }
    const already = await readFrictionObject({ factSourceRoot, objectUid: uid });
    assert.equal(already.value.frontmatter.status, "open");

    const again = await landDiscoveryVerdict({ factSourceRoot, verdict: sameObstacleVerdict(uid), sessionSignature: SIG });
    assert.ok(again.ok, JSON.stringify(again.error));
    assert.equal(again.value.count, 4);
    assert.equal(again.value.promoted, false, "已 open 不再匹配第 4 项");
  });
});

test("不做存量遍历：只动本次涉及的那条账目（§8.4 第 4 项）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    // 建两条，各自补到阈值边缘
    const a = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict({ title: "A 阻碍" }), sessionSignature: SIG });
    const b = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict({ title: "B 阻碍" }), sessionSignature: SIG });
    for (let i = 0; i < 2; i += 1) {
      await landDiscoveryVerdict({ factSourceRoot, verdict: sameObstacleVerdict(a.value.object_uid), sessionSignature: SIG });
    }
    // 此时 A 已 open、B 仍 observing(count=1)
    const rb = await readFrictionObject({ factSourceRoot, objectUid: b.value.object_uid });
    assert.equal(rb.value.frontmatter.status, "observing");
    assert.equal(rb.value.frontmatter.occurrence.count, 1, "B 未被 A 的运行波及（不做存量遍历）");
  });
});

// ---------------------------------------------------------------------------
// 失败即整体失败（调用方按 §8.3 入队，不停在半路）
// ---------------------------------------------------------------------------

test("same-obstacle 指向不存在的账目：返回失败并标明阶段", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const r = await landDiscoveryVerdict({
      factSourceRoot,
      verdict: sameObstacleVerdict("99999999-0000-4000-8000-000000000000"),
      sessionSignature: SIG,
    });
    assert.ok(!r.ok);
    assert.equal(r.error.stage, "supplement");
    assert.ok(r.error.cause, "失败须带原始原因，便于 §8.3 登记残留");
  });
});

test("终态账目（resolved/voided）不得被补充计数（26 §9.3 计数冻结）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const created = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict(), sessionSignature: SIG });
    const uid = created.value.object_uid;

    // 直接把它置为终态（模拟已被 Human 处置）
    const { updateFrictionObject } = await import("../lib/friction-writer.js");
    const cur = await readFrictionObject({ factSourceRoot, objectUid: uid });
    const retired = await updateFrictionObject({
      factSourceRoot,
      objectUid: uid,
      expectedFingerprint: cur.value.fingerprint,
      frontmatterAfter: { ...cur.value.frontmatter, status: "voided", disposition: "测试置为终态" },
      bodyMarkdownAfter: `${cur.value.body}\n\n## 处置\n测试置为终态。`,
      changeSummary: "测试：置为 voided",
      sessionSignature: SIG,
    });
    assert.ok(retired.ok, JSON.stringify(retired.error));

    const r = await landDiscoveryVerdict({ factSourceRoot, verdict: sameObstacleVerdict(uid), sessionSignature: SIG });
    assert.ok(!r.ok, "终态账目不得被补充计数");
    assert.equal(r.error.stage, "supplement");
  });
});

// ---------------------------------------------------------------------------
// 入参与越界
// ---------------------------------------------------------------------------

test("缺 factSourceRoot / verdict 时拒绝", async () => {
  const a = await landDiscoveryVerdict({ verdict: newObstacleVerdict(), sessionSignature: SIG });
  assert.ok(!a.ok);
  const b = await landDiscoveryVerdict({ factSourceRoot: "/tmp/x", sessionSignature: SIG });
  assert.ok(!b.ok);
});

test("未知 verdict 被拒（本模块只执行闭集，不解释语义）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    const r = await landDiscoveryVerdict({ factSourceRoot, verdict: { verdict: "maybe-an-obstacle" }, sessionSignature: SIG });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "friction/verdict_out_of_set");
  });
});

test("本模块不含语义判断：同样的 verdict 输入产生同样的机械动作（无模型调用面）", async () => {
  await withLedger(async ({ factSourceRoot }) => {
    // 两条内容完全不同、但同属 new-obstacle 的判断 → 都应创建（判断已由子代理给出）
    const r1 = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict({ title: "阻碍甲" }), sessionSignature: SIG });
    const r2 = await landDiscoveryVerdict({ factSourceRoot, verdict: newObstacleVerdict({ title: "阻碍乙" }), sessionSignature: SIG });
    assert.ok(r1.ok && r2.ok);
    assert.notEqual(r1.value.object_uid, r2.value.object_uid);
  });
});

// ---------------------------------------------------------------------------
// 缺陷 D2 的回归护栏（结构不变量）
//
// D2 的形态**不是**某个函数算错了——而是「闭集三个落地函数零调用方、编排层
// 丢弃判断结果」，于是整条落地链路静默不存在，而水位照常推进、表面上像跑通了。
// 行为测试**测不到**这种缺陷（每个函数单独都对）。故此处以源码级不变量守住它：
// 一旦有人把落地调用删掉或把返回值丢掉，这些断言立刻失败。
// ---------------------------------------------------------------------------

test("D2 回归护栏：闭集三个落地函数各须有生产调用方（不能只有测试引用）", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname: dirOf, join: joinOf } = await import("node:path");

  const libDir = joinOf(dirOf(fileURLToPath(import.meta.url)), "..", "lib");
  const files = (await readdir(libDir)).filter((f) => f.endsWith(".js"));
  const sources = new Map();
  for (const f of files) sources.set(f, await readFile(joinOf(libDir, f), "utf8"));

  // 「生产调用方」= 定义文件之外、lib/ 之内的任何引用。
  for (const fn of ["supplementOccurrence", "createObserving", "promoteIfThresholdMet"]) {
    const callers = [...sources.entries()]
      .filter(([name]) => name !== "friction-discovery.js")
      .filter(([, text]) => new RegExp(`\\b${fn}\\b`).test(text))
      .map(([name]) => name);
    assert.ok(
      callers.length > 0,
      `${fn} 在 lib/ 中除定义处外零引用——这正是缺陷 D2 的形态（闭集落地未接通）。` +
        `须由 friction-landing.js 经编排层调用，否则判断结果会被算完即丢。`,
    );
  }
});

test("D2 回归护栏：编排层不得丢弃 runIdleCheckpoint 的返回值", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname: dirOf, join: joinOf } = await import("node:path");

  const path = joinOf(dirOf(fileURLToPath(import.meta.url)), "..", "lib", "lifecycle.js");
  const raw = await readFile(path, "utf8");
  // 剥掉行注释后再判定——否则描述缺陷的注释本身会被误判成缺陷（实测踩过）。
  const text = raw
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");

  // 形如 `await runIdleCheckpoint({` 且**前面没有赋值目标** = 丢弃返回值（D2 原形）。
  // 「前面无赋值目标」的判据：该行匹配 `await runIdleCheckpoint(` 但**不含** `=`。
  // （不能用「await 前一个字符不是 =」——`= await` 之间是空格，那样会漏掉合法的赋值。）
  const offender = text
    .split("\n")
    .find((line) => /await\s+runIdleCheckpoint\s*\(/.test(line) && !/=\s*await\s+runIdleCheckpoint/.test(line));
  assert.ok(
    offender === undefined,
    `lifecycle.js 存在裸 \`await runIdleCheckpoint(...)\`（行：${JSON.stringify(offender?.trim())}）——` +
      "返回值被丢弃时，子代理的判断不会被落地（缺陷 D2）。须接住返回值并交给 landDiscoveryVerdict。",
  );
  assert.match(
    text,
    /landDiscoveryVerdict\s*\(/,
    "lifecycle.js 未调用 landDiscoveryVerdict——判断结果无处落地（缺陷 D2）",
  );
});

test("D2 回归护栏：落地失败须按 §8.3 入队，不得静默吞掉", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname: dirOf, join: joinOf } = await import("node:path");

  const path = joinOf(dirOf(fileURLToPath(import.meta.url)), "..", "lib", "lifecycle.js");
  const text = await readFile(path, "utf8");

  // 落地结果必须被检查（if (!landed.ok)），且该分支内确有入队登记。
  assert.match(text, /if\s*\(\s*!landed\.ok\s*\)/, "落地结果未被检查——失败会被静默吞掉");
  const idx = text.indexOf("if (!landed.ok)");
  const after = text.slice(idx, idx + 700);
  assert.match(after, /appendPendingEntry\s*\(/, "落地失败分支内没有向待处置队列登记（§8.3 第 3 项）");
});

test("D2 回归护栏：落地取的是 decision.verdict（层级写错等于永不落地）", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname: dirOf, join: joinOf } = await import("node:path");

  const path = joinOf(dirOf(fileURLToPath(import.meta.url)), "..", "lib", "lifecycle.js");
  const raw = await readFile(path, "utf8");
  const text = raw
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");

  // 执行体的返回值被 runIdleCheckpoint 原样放在 `decision` 下；直接取
  // `checkpoint.value.verdict`（少一层）会得到 undefined，落地永不触发——
  // 与 D2 同类：功能静默不存在，而水位照常推进。
  assert.ok(
    !/checkpoint\.value\.verdict\b/.test(text),
    "lifecycle.js 取了 checkpoint.value.verdict——少一层，执行体的判断在 decision.verdict 下，这样写会使落地永不触发（等同缺陷 D2）",
  );
  assert.match(
    text,
    /checkpoint\.value\?\.decision\?\.verdict/,
    "lifecycle.js 未从 decision.verdict 取判断结果",
  );
});
