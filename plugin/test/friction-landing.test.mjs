// Tests for plugin/lib/friction-landing.js —
// 缺陷 D2 的修复：把子代理的结构化判断按 11 §9 闭集第 2–4 项落地。
//
// **2026-10 修订（Human 决定：观察不进事实源）**：判定态由三态扩为四态，且
// 「观察材料」不再写事实源——一律先进摩擦观察缓冲（§12bis.1），只有攒够 N 条
// 才晋升为一条 `open` 账目。故本文件的测试重心相应调整：
//   `same-obstacle` → 对既有 open 账目补充级更新（不流转状态）
//   `same-observation-group` / `new-observation` → 写观察条目（可能触发晋升）
//   `no-discovery` → 无动作
//
// 测试要证明：
//   ① 四态各自的机械动作正确；
//   ② 观察层不写事实源，只有达阈值才晋升；
//   ③ 任一环节失败即整体失败（调用方据此按 §12 入队），不停在半路；
//   ④ 不越界：不做存量遍历、不自行判断同题、不解释语义。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	MAX_RESIDUAL_ISSUES,
	landDiscoveryVerdict,
	residualFromLandingError
} from "../lib/friction-landing.js";
import { readFrictionObject, listFrictionObjects, createFrictionObject } from "../lib/friction-writer.js";
import { stripLeadingH1 } from "../lib/friction-discovery.js";
import { readFrictionObservations } from "../lib/friction-observation-buffer.js";
import { withTemp, testSignature } from "./helpers.mjs";

const SIG = testSignature();
const PROJECT = "test-project";

/**
 * 建一个空的账本目录 + 一个 DSH home（缓冲在事实源之外，需要独立的 home 根）。
 *
 * 两者都落在同一个临时目录下：`factSourceRoot` 直接是 dir（landing 只读写它下面的
 * `frictions/`），而 `dshHomePath` 也以 dir 为根——缓冲落在
 * `dir/ldvh/friction-observations/`，与 `dir/frictions/` 互不干扰。
 */
async function withLedger(fn) {
  await withTemp("ldvh-landing-", async (dir) => {
    const factSourceRoot = dir;
    const dshHomePath = (...segments) => (segments.length === 0 ? dir : `${dir}/${segments.join("/")}`);
    await fn({ factSourceRoot, dshHomePath });
  });
}

/** 造一条 open 账目（初态即 open）。 */
async function seedOpen(factSourceRoot, { count = 1, attribution = "串行化任务编排" } = {}) {
  const created = await createFrictionObject({
    factSourceRoot,
    frontmatterDraft: {
      title: "CI 慢",
      phenomenon: "CI 平均 8 分钟。",
      impact: "medium",
      attribution,
      occurrence: { count, first_at: "2026-10-01T00:00:00.000Z", last_at: "2026-10-01T00:00:00.000Z" },
      change_summary: "测试：造一条 open 账目",
    },
    bodyMarkdown: "## 现象\nCI 平均 8 分钟。\n\n## 入账依据\n可归因于串行化任务编排；修了会更好。",
    sessionSignature: SIG,
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  return created.value.object_uid;
}

/** 一条观察层判定（`new-observation` / `same-observation-group` 共用形状）。 */
function observationVerdict(verdict, overrides = {}) {
  return {
    verdict,
    target_uid: "",
    group: "ci-slow",
    title: "CI 慢",
    phenomenon: "CI 平均 8 分钟。",
    basis: "可归因于串行化任务编排；修了会更好。",
    attribution: "串行化任务编排",
    impact: "medium",
    quote: "CI 平均 8 分钟——本次材料里的原文引证片段",
    reason: "本次区间内观察到 CI 反复超时。",
    ...overrides,
  };
}

function sameObstacleVerdict(uid, overrides = {}) {
  return {
    verdict: "same-obstacle",
    target_uid: uid,
    group: "",
    title: "",
    phenomenon: "",
    basis: "",
    attribution: "",
    impact: "light",
    quote: "本次区间内再次出现同一现象——原文引证片段",
    reason: "本次区间内再次出现同一现象。",
    ...overrides,
  };
}

const ANCHOR = "turn-42";
const SESSION = "session-test";

/** 落地一次（把缓冲所需参数一并带上）。 */
async function land(ctx, verdict, extra = {}) {
  return landDiscoveryVerdict({
    factSourceRoot: ctx.factSourceRoot,
    dshHomePath: ctx.dshHomePath,
    projectId: PROJECT,
    anchor: ANCHOR,
    session: SESSION,
    verdict,
    sessionSignature: SIG,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 四态 → 机械动作
// ---------------------------------------------------------------------------

test("no-discovery：不动作、不创建、不推进（闭集里没有对应项）", async () => {
  await withLedger(async (ctx) => {
    const r = await land(ctx, {
      verdict: "no-discovery", target_uid: "", group: "", title: "", phenomenon: "",
      basis: "", attribution: "", impact: "light", quote: "", reason: "本次没有可记的现象。",
    });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.action, "none");
    assert.equal(r.value.object_uid, null);

    const listed = await listFrictionObjects({ factSourceRoot: ctx.factSourceRoot });
    assert.equal(listed.value.items.length, 0, "no ledger entry is written");
    const buffer = await readFrictionObservations(ctx.dshHomePath, PROJECT);
    assert.equal(buffer.value.total, 0, "no buffer entry is written either");
  });
});

test("new-observation：写入一条观察条目，**不创建账目**（观察不是事实对象）", async () => {
  await withLedger(async (ctx) => {
    const r = await land(ctx, observationVerdict("new-observation"));
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.action, "observe");
    assert.equal(r.value.object_uid, null, "no ledger entry yet — 1 < N");
    assert.equal(r.value.group_pending_count, 1);
    assert.equal(r.value.promotion_ready, false);

    const listed = await listFrictionObjects({ factSourceRoot: ctx.factSourceRoot });
    assert.equal(listed.value.items.length, 0, "an observation must not write the fact source");

    const buffer = await readFrictionObservations(ctx.dshHomePath, PROJECT, { status: "pending" });
    assert.equal(buffer.value.total, 1);
    assert.equal(buffer.value.items[0].group, "ci-slow");
  });
});

test("new-observation：引证进缓冲的是 quote（逐字引证），不是 reason（解释）", async () => {
  await withLedger(async (ctx) => {
    const quote = "CI 平均 8 分钟——本次材料里的原文引证片段";
    const r = await land(ctx, observationVerdict("new-observation", { quote }));
    assert.ok(r.ok, JSON.stringify(r.error));
    const buffer = await readFrictionObservations(ctx.dshHomePath, PROJECT, { status: "pending" });
    const evidence = buffer.value.items[0].evidence;
    assert.ok(evidence.includes(quote), "the verbatim quote goes into evidence");
    assert.ok(evidence.includes(ANCHOR), "the source anchor is attached");
  });
});

test("same-observation-group：并入既有组，第二条仍不达阈值", async () => {
  await withLedger(async (ctx) => {
    const first = await land(ctx, observationVerdict("new-observation"));
    assert.equal(first.value.group_pending_count, 1);

    const second = await land(ctx, observationVerdict("same-observation-group"));
    assert.ok(second.ok, JSON.stringify(second.error));
    assert.equal(second.value.group_pending_count, 2);
    assert.equal(second.value.promoted, false);
    assert.equal(second.value.object_uid, null);
  });
});

test("same-observation-group：第三条达 N，发现层**不**晋升（晋升已移入审核层 §10.2）", async () => {
  await withLedger(async (ctx) => {
    await land(ctx, observationVerdict("new-observation"));
    await land(ctx, observationVerdict("same-observation-group"));
    const third = await land(ctx, observationVerdict("same-observation-group"));

    assert.ok(third.ok, JSON.stringify(third.error));
    assert.equal(third.value.promotion_ready, true, "the group is ready — the buffer count reached N");
    assert.equal(third.value.promoted, false, "2026-10-30: discovery no longer writes the fact source");
    assert.equal(third.value.object_uid, null, "no ledger entry is created by the discovery layer");

    // 三条都在缓冲里、且都带晋升所需的承载字段，审核层下一次运行即可建账。
    const pending = await readFrictionObservations(ctx.dshHomePath, PROJECT, { status: "pending" });
    assert.equal(pending.value.total, 3, "all three observations stay pending for the review layer");
    for (const entry of pending.value.items) {
      assert.equal(entry.title, "CI 慢");
      assert.equal(entry.attribution, "串行化任务编排");
      assert.ok(entry.basis.length > 0, "basis is carried into the buffer");
      assert.ok(["light", "medium", "heavy"].includes(entry.impact), "impact is carried into the buffer");
    }
  });
});

test("same-observation-group：条目保持 pending（晋升由审核层结算，发现层不结算）", async () => {
  await withLedger(async (ctx) => {
    await land(ctx, observationVerdict("new-observation"));
    await land(ctx, observationVerdict("same-observation-group"));
    await land(ctx, observationVerdict("same-observation-group"));

    const pending = await readFrictionObservations(ctx.dshHomePath, PROJECT, { status: "pending" });
    assert.equal(pending.value.total, 3, "the review layer settles these, not the discovery layer");
    const promoted = await readFrictionObservations(ctx.dshHomePath, PROJECT, { status: "promoted" });
    assert.equal(promoted.value.total, 0, "nothing is promoted during the discovery run");
  });
});

test("same-obstacle：发现层**不**做补充级更新，改为写入缓冲待审核层执行（第 4 项已移入 §10.2）", async () => {
  await withLedger(async (ctx) => {
    const uid = await seedOpen(ctx.factSourceRoot, { count: 1 });
    const before = await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: uid });

    const r = await land(ctx, sameObstacleVerdict(uid), { observationAt: "2026-11-02T00:00:00.000Z" });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.action, "supplement-pending", "the supplement is queued for the review layer");
    assert.equal(r.value.object_uid, uid);

    // 账目**未**被改动：count 与 last_at 都还是原值。
    const after = await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: uid });
    assert.equal(after.value.frontmatter.occurrence.count, 1, "discovery no longer touches the ledger");
    assert.equal(
      after.value.frontmatter.occurrence.last_at,
      before.value.frontmatter.occurrence.last_at,
      "last_at is untouched",
    );

    // 观察进了缓冲，且带 target_uid 指向该账目。
    const pending = await readFrictionObservations(ctx.dshHomePath, PROJECT, { status: "pending" });
    assert.equal(pending.value.total, 1);
    assert.equal(pending.value.items[0].target_uid, uid, "target_uid tells the review layer which entry to supplement");
  });
});

test("same-obstacle：**不触发任何状态流转**（账目状态推进只有 Human Gate）", async () => {
  await withLedger(async (ctx) => {
    const uid = await seedOpen(ctx.factSourceRoot, { count: 5 });
    const r = await land(ctx, sameObstacleVerdict(uid), { observationAt: "2026-11-03T00:00:00.000Z" });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.promoted, false, "count never drives status any more");
    assert.equal(r.value.status, "open");
    const after = await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: uid });
    assert.equal(after.value.frontmatter.occurrence.count, 5, "the ledger is not written by discovery");
  });
});

test("不做存量遍历：只动本次涉及的那条账目（发现层不改任何账目）", async () => {
  await withLedger(async (ctx) => {
    const a = await seedOpen(ctx.factSourceRoot, { count: 1 });
    const b = await seedOpen(ctx.factSourceRoot, { count: 5 });

    const r = await land(ctx, sameObstacleVerdict(a), { observationAt: "2026-11-02T00:00:00.000Z" });
    assert.ok(r.ok, JSON.stringify(r.error));

    const aAfter = (await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: a })).value.frontmatter;
    const bAfter = (await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: b })).value.frontmatter;
    assert.equal(aAfter.occurrence.count, 1, "discovery does not write the targeted entry either");
    assert.equal(bAfter.occurrence.count, 5, "an unrelated entry is untouched");
  });
});

test("same-obstacle 指向不存在的账目：返回失败并标明阶段", async () => {
  await withLedger(async (ctx) => {
    const r = await land(ctx, sameObstacleVerdict("11111111-2222-3333-4444-555555555555"));
    assert.equal(r.ok, false);
    assert.equal(r.error.stage, "supplement");
  });
});

test("终态账目（voided）不得被补充计数（26 §9.3 计数冻结）", async () => {
  await withLedger(async (ctx) => {
    const uid = await seedOpen(ctx.factSourceRoot, { count: 1 });
    const read = await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: uid });
    const { updateFrictionObject } = await import("../lib/friction-writer.js");
    const voided = await updateFrictionObject({
      factSourceRoot: ctx.factSourceRoot,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        status: "voided",
        disposition: "现象描述失真（测试）",
      },
      bodyMarkdownAfter: `${stripLeadingH1(read.value.body)}\n\n## 处置\n测试：账目记错，废弃。`,
      changeSummary: "测试：废弃",
      sessionSignature: SIG,
    });
    assert.ok(voided.ok, JSON.stringify(voided.error));

    // 2026-10-30：终态账目既不得被补充计数，也不得入缓冲（无补充动作可排）。
    // 处置为「静默 + residual 登记」，而非失败——失败会让整次运行被判无效。
    const r = await land(ctx, sameObstacleVerdict(uid), { observationAt: "2026-11-04T00:00:00.000Z" });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.action, "silent");
    assert.equal(r.value.status, "voided");
    assert.ok(Array.isArray(r.value.residual) && r.value.residual.length > 0, "the hit is registered for review");

    const pending = await readFrictionObservations(ctx.dshHomePath, PROJECT, { status: "pending" });
    assert.equal(pending.value.total, 0, "no observation is buffered for a terminal entry");
  });
});

// ---------------------------------------------------------------------------
// accepted 命中静默（2026-10 新增）
// ---------------------------------------------------------------------------

test("命中 accepted：不写缓冲、不晋升、不计数，且在 residual 登记命中事实（11 §9 第 1 项 / §15）", async () => {
  await withLedger(async (ctx) => {
    const uid = await seedOpen(ctx.factSourceRoot, { count: 1 });
    const read = await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: uid });
    const { updateFrictionObject } = await import("../lib/friction-writer.js");
    const disposition = "消除途径不存在：宿主不提供热重载（测试）。复审触发：宿主升级时重审。";
    const accepted = await updateFrictionObject({
      factSourceRoot: ctx.factSourceRoot,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "accepted", disposition },
      bodyMarkdownAfter: `${stripLeadingH1(read.value.body)}\n\n## 处置\n${disposition}`,
      changeSummary: "测试：接受为不可清偿",
      sessionSignature: SIG,
    });
    assert.ok(accepted.ok, JSON.stringify(accepted.error));
    const acceptedRead = await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: uid });
    const acceptedCount = acceptedRead.value.frontmatter.occurrence.count;

    const r = await land(ctx, sameObstacleVerdict(uid), { observationAt: "2026-11-04T00:00:00.000Z" });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.action, "silent", "命中 accepted 的动作是静默，不是补充级更新");
    assert.equal(r.value.promoted, false, "不得晋升");
    assert.ok(Array.isArray(r.value.residual) && r.value.residual.length > 0, "命中事实须在 residual 登记（不得无痕抑制）");
    assert.match(r.value.residual.join("\n"), new RegExp(uid), "residual 须点名命中的已接受账目");

    // 计数冻结：accepted 的 occurrence 不因命中而递增。
    const after = await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: uid });
    assert.equal(after.value.frontmatter.occurrence.count, acceptedCount, "26 §9.3：终态计数冻结");
    assert.equal(after.value.frontmatter.status, "accepted", "26 §9.2：终态不重开");

    // 不写缓冲：观察缓冲里不得留下该次观察的条目。
    const buf = await readFrictionObservations(ctx.dshHomePath, PROJECT, { status: "pending" });
    assert.ok(buf.ok);
    assert.equal(buf.value.items.length, 0, "命中 accepted 不得写观察缓冲");
  });
});

test("查重候选包含 accepted（否则同一阻碍会反复重新入账）", async () => {
  await withLedger(async (ctx) => {
    const uid = await seedOpen(ctx.factSourceRoot, { count: 1 });
    const read = await readFrictionObject({ factSourceRoot: ctx.factSourceRoot, objectUid: uid });
    const { updateFrictionObject } = await import("../lib/friction-writer.js");
    const disposition = "不在本项目可动范围：宿主侧机制（测试）。复审触发：依赖变更时重审。";
    const accepted = await updateFrictionObject({
      factSourceRoot: ctx.factSourceRoot,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: { ...read.value.frontmatter, status: "accepted", disposition },
      bodyMarkdownAfter: `${stripLeadingH1(read.value.body)}\n\n## 处置\n${disposition}`,
      changeSummary: "测试：接受",
      sessionSignature: SIG,
    });
    assert.ok(accepted.ok, JSON.stringify(accepted.error));

    const { loadDedupCandidates } = await import("../lib/friction-discovery.js");
    const cands = await loadDedupCandidates(ctx.factSourceRoot);
    assert.ok(cands.ok, JSON.stringify(cands.error));
    assert.equal(cands.value.candidates.length, 1, "accepted 必须在账本侧查重候选内");
    assert.equal(cands.value.candidates[0].status, "accepted");
  });
});

// ---------------------------------------------------------------------------
// 参数与边界
// ---------------------------------------------------------------------------

test("缺 factSourceRoot / verdict 时拒绝", async () => {
  await withLedger(async (ctx) => {
    const a = await landDiscoveryVerdict({ verdict: observationVerdict("new-observation"), dshHomePath: ctx.dshHomePath, projectId: PROJECT, anchor: ANCHOR, sessionSignature: SIG });
    assert.equal(a.ok, false);
    const b = await landDiscoveryVerdict({ factSourceRoot: ctx.factSourceRoot, dshHomePath: ctx.dshHomePath, projectId: PROJECT, anchor: ANCHOR, sessionSignature: SIG });
    assert.equal(b.ok, false);
  });
});

test("观察层缺 dshHomePath / projectId / anchor 时拒绝（缓冲无法定位）", async () => {
  await withLedger(async (ctx) => {
    const noHome = await landDiscoveryVerdict({
      factSourceRoot: ctx.factSourceRoot,
      projectId: PROJECT,
      anchor: ANCHOR,
      verdict: observationVerdict("new-observation"),
      sessionSignature: SIG,
    });
    assert.equal(noHome.ok, false);
    assert.equal(noHome.error.code, "invalid_request");

    const noProject = await landDiscoveryVerdict({
      factSourceRoot: ctx.factSourceRoot,
      dshHomePath: ctx.dshHomePath,
      anchor: ANCHOR,
      verdict: observationVerdict("new-observation"),
      sessionSignature: SIG,
    });
    assert.equal(noProject.ok, false);

    const noAnchor = await landDiscoveryVerdict({
      factSourceRoot: ctx.factSourceRoot,
      dshHomePath: ctx.dshHomePath,
      projectId: PROJECT,
      verdict: observationVerdict("new-observation"),
      sessionSignature: SIG,
    });
    assert.equal(noAnchor.ok, false, "the anchor is what lets a promoted entry point back at the source");
  });
});

test("未知 verdict 被拒（本模块只执行闭集，不解释语义）", async () => {
  await withLedger(async (ctx) => {
    const r = await land(ctx, { verdict: "maybe-an-obstacle", target_uid: "", group: "", title: "", phenomenon: "", basis: "", attribution: "", impact: "light", quote: "", reason: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "friction/verdict_out_of_set");
  });
});

test("本模块不含语义判断：同样的 verdict 输入产生同样的机械动作（无模型调用面）", async () => {
  await withLedger(async (ctx) => {
    const r1 = await land(ctx, observationVerdict("new-observation"));
    const r2 = await land(ctx, observationVerdict("new-observation"));
    assert.ok(r1.ok && r2.ok, "both runs succeed");
    assert.equal(r1.value.action, r2.value.action);
    assert.equal(r1.value.group, r2.value.group);
    assert.equal(r2.value.group_pending_count, 2, "identical groups accumulate deterministically");
  });
});

// ---------------------------------------------------------------------------
// D2 回归护栏（接缝存在性）
// ---------------------------------------------------------------------------

test("D2 回归护栏：编排层不得丢弃 runIdleCheckpoint 的返回值", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/lifecycle.js", import.meta.url), "utf8");
  const lines = source.split("\n");
  // 跳过注释行：文件里有一处注释引用了 `await runIdleCheckpoint({...})` 来说明历史
  // 缺陷（D2 原形态），按纯文本匹配会先命中它——那是注释不是调用。
  const callAt = lines.findIndex(
    (l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /await runIdleCheckpoint\s*\(/.test(l),
  );
  assert.ok(callAt >= 0, "lifecycle 未调用 runIdleCheckpoint");
  assert.ok(
    /=\s*await runIdleCheckpoint/.test(lines[callAt]),
    "runIdleCheckpoint 的返回值必须被接住——直接丢弃会使子代理的判断算完即丢（缺陷 D2 原形态）",
  );
});

test("D2 回归护栏：落地失败须按 §12 入队，不得静默吞掉", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/lifecycle.js", import.meta.url), "utf8");
  assert.match(source, /residualFromLandingError/, "落地失败须把完整诊断带进待处置队列，不得只留恒定套话");
});

test("D2 回归护栏：lifecycle 必须真的调用 landDiscoveryVerdict（判断结果须有落地点）", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/lifecycle.js", import.meta.url), "utf8");
  assert.match(source, /landDiscoveryVerdict\s*\(/, "lifecycle.js 未调用 landDiscoveryVerdict——判断结果无处落地（缺陷 D2）");
});

// ---------------------------------------------------------------------------
// 顺序护栏（水位推进必须在落地之后）
// ---------------------------------------------------------------------------

test("发现①护栏：idle-checkpoint 不得自行推进水位（须交给调用方在落地后执行）", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/idle-checkpoint.js", import.meta.url), "utf8");
  assert.match(source, /watermark_advanced:\s*false/, "idle-checkpoint 不得自行推进水位");
  assert.match(source, /pending_watermark_turn/, "可推进的轮次须交给调用方");
});

test("发现①护栏：lifecycle 须在落地成功之后才推进水位（顺序不可倒置）", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/lifecycle.js", import.meta.url), "utf8");
  const lines = source.split("\n");
  const landAt = lines.findIndex((l) => /await landDiscoveryVerdict\s*\(/.test(l));
  const advanceAt = lines.findIndex((l) => /await advanceWatermark\s*\(/.test(l));
  assert.ok(landAt >= 0, "lifecycle 未调用 landDiscoveryVerdict（D2 形态）");
  assert.ok(advanceAt >= 0, "lifecycle 未调用 advanceWatermark");
  assert.ok(
    advanceAt > landAt,
    `landDiscoveryVerdict (行 ${landAt + 1}) 必须在 advanceWatermark (行 ${advanceAt + 1}) 之前——`
    + "倒置会使落地失败时水位已前进，那段内容永远不会再被观察（复核发现①）",
  );
});

// ---------------------------------------------------------------------------
// residualFromLandingError
// ---------------------------------------------------------------------------

test("residualFromLandingError：**逐条校验明细**必须带出（此前只留恒定套话）", () => {
  const error = {
    code: "friction/frontmatter_invalid",
    message: "frontmatter failed mechanical checks",
    cause: { details: { issues: ["title: must be ≤ 30 characters", "occurrence.count: must be ≥ 1"] } },
  };
  const residual = residualFromLandingError(error);
  assert.deepEqual(residual, ["title: must be ≤ 30 characters", "occurrence.count: must be ≥ 1"]);
});

test("residualFromLandingError：明细为**空数组**时才退回 message（须给出类别）", () => {
  const error = { code: "x", message: "outer", cause: { message: "the real cause", details: { issues: [] } } };
  assert.deepEqual(residualFromLandingError(error), ["the real cause"]);
});

test("residualFromLandingError：非法与缺失输入不得抛错，也不得伪造内容", () => {
  assert.deepEqual(residualFromLandingError(undefined), []);
  assert.deepEqual(residualFromLandingError(null), []);
  assert.deepEqual(residualFromLandingError({}), []);
});

test("residualFromLandingError：明细过多须**显式标注截断**，不得静默丢弃", () => {
  const issues = Array.from({ length: MAX_RESIDUAL_ISSUES + 5 }, (_, i) => `issue ${i}`);
  const error = { code: "x", message: "outer", cause: { details: { issues } } };
  const residual = residualFromLandingError(error);
  assert.equal(residual.length, MAX_RESIDUAL_ISSUES + 1);
  assert.match(residual[residual.length - 1], /另有 5 条明细未列出/);
});

test("residualFromLandingError：明细里的空串/空白项须剔除，不得占位", () => {
  const error = { code: "x", message: "outer", cause: { details: { issues: ["real issue", "", "   ", null] } } };
  assert.deepEqual(residualFromLandingError(error), ["real issue"]);
});
