// Tests for plugin/lib/friction-discovery.js — the §9 自动动作闭集.
//
// **2026-10 修订（Human 决定：观察不进事实源）**：`observing` 已退出 26 §9 的
// 状态闭集，观察材料改由 §12bis.1 的摩擦观察缓冲承载。故本文件的测试重心由
// 「observing 账目的创建与阈值流转」改为「观察条目的写入、同组聚合与阈值晋升」。
//
// Every case is derived from specs/11 §9 (the single authority) and specs/26
// (the ledger contract). Where the implementation diverges from the spec the
// failure is reported, never "fixed" by bending the assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadDedupCandidates,
  loadObservationDedupCandidates,
  supplementOccurrence,
  recordObservation,
  meetsPromotionThreshold,
  promoteReadyGroup,
  verifyThresholdAvailable,
  stripLeadingH1,
  FRICTION_THRESHOLD_N,
  MAX_CREATES_PER_RUN,
} from "../lib/friction-discovery.js";
import {
  readFrictionObservations,
  readPromotionReadyGroups,
  FRICTION_OBSERVATION_THRESHOLD_N,
} from "../lib/friction-observation-buffer.js";
import { readFrictionObject, updateFrictionObject, createFrictionObject } from "../lib/friction-writer.js";
import { testSignature } from "./helpers.mjs";

const TEST_SIGNATURE = testSignature();
const PROJECT = "test-project";

async function withRoot(fn) {
  const base = await mkdtemp(join(tmpdir(), "friction-discovery-"));
  await fn(base);
}

/** DSH home 路径拼接器（缓冲在事实源之外，故需要一个 home 根）。 */
function makeHome(base) {
  return (...segments) => join(base, ...segments);
}

/** 造一条 open 账目（2026-10 修订后账本的初态就是 open）。 */
async function seedOpen(base, { count = 1, title = "重复出现的阻碍" } = {}) {
  const created = await createFrictionObject({
    factSourceRoot: base,
    frontmatterDraft: {
      title,
      phenomenon: "CI 在无缓存时平均耗时 8 分钟。",
      impact: "medium",
      attribution: "CI 配置未缓存依赖层",
      occurrence: { count, first_at: "2026-10-01T00:00:00.000Z", last_at: "2026-10-01T00:00:00.000Z" },
      change_summary: "测试：造一条 open 账目",
    },
    bodyMarkdown: "## 现象\nCI 在无缓存时平均耗时 8 分钟。\n\n## 入账依据\n重复出现；归因：CI 配置未缓存依赖层；修了会改善。",
    sessionSignature: TEST_SIGNATURE,
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  return created.value.object_uid;
}

/** 写一条观察条目。 */
async function seedObservation(base, { group = "ci-slow", phenomenon = "CI 平均 8 分钟", at, evidence } = {}) {
  const result = await recordObservation({
    dshHomePath: makeHome(base),
    projectId: PROJECT,
    session: "session-test",
    anchor: "turn-1",
    phenomenon,
    evidence: evidence ?? "CI 耗时 8m02s（构建日志第 12 行）",
    group,
    // 2026-10-30：晋升搬到审核层后，这四项随条目落进缓冲（§12bis.1 字段闭集）。
    title: "CI 慢",
    basis: "重复出现；归因：CI 配置未缓存依赖层；修了会改善。",
    attribution: "CI 配置未缓存依赖层",
    impact: "medium",
    ...(at ? { observationAt: at } : {}),
  });
  assert.ok(result.ok, JSON.stringify(result.error));
  return result.value;
}

/** 晋升一个组的便利包装。 */
async function promote(base, group = "ci-slow", extra = {}) {
  return promoteReadyGroup({
    factSourceRoot: base,
    dshHomePath: makeHome(base),
    projectId: PROJECT,
    group,
    title: "CI 慢",
    impact: "medium",
    basis: "重复出现三次；归因：构建未缓存依赖；修了会改善。",
    attribution: "构建流水线",
    sessionSignature: TEST_SIGNATURE,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// N 的固定性（§9「阈值 N」：不可配置）
// ---------------------------------------------------------------------------

test("11 §9：N 固定为 3 且不经任何配置载体", () => {
  assert.equal(FRICTION_THRESHOLD_N, 3, "N is pinned to 3 by 11 §9");
  assert.equal(FRICTION_OBSERVATION_THRESHOLD_N, 3, "缓冲侧的 N 与发现侧同源（§12bis.1 差异第 3 条）");
  assert.equal(MAX_CREATES_PER_RUN, 1, "§9 每次运行上限：至多晋升 1 条账目");
});

test("11 §9：阈值求值可用（N 固定后该校验不再恒不可用）", () => {
  const check = verifyThresholdAvailable();
  assert.ok(check.ok, JSON.stringify(check.error));
  assert.equal(check.value.threshold, 3);
});

// ---------------------------------------------------------------------------
// 第 1 项（读取部分）：两层候选集
// ---------------------------------------------------------------------------

test("§9 第 1 项：账本侧候选只含 open，终态不入查重范围（26 §12）", async () => {
  await withRoot(async (base) => {
    const open = await seedOpen(base, { title: "待修的阻碍" });
    const loaded = await loadDedupCandidates(base);
    assert.ok(loaded.ok, JSON.stringify(loaded.error));
    const uids = loaded.value.candidates.map((c) => c.object_uid);
    assert.ok(uids.includes(open), "open is a dedup candidate");
    assert.equal(loaded.value.invalid.length, 0);
  });
});

test("§9 第 1 项：空账本是合法的空候选，不是失败", async () => {
  await withRoot(async (base) => {
    const loaded = await loadDedupCandidates(base);
    assert.ok(loaded.ok, JSON.stringify(loaded.error));
    assert.deepEqual(loaded.value.candidates, []);
  });
});

test("§9 第 1 项：缓冲侧候选按 group 聚合，给出每组的 pending 条目数", async () => {
  await withRoot(async (base) => {
    await seedObservation(base, { group: "ci-slow", at: "2026-10-01T00:00:00.000Z" });
    await seedObservation(base, { group: "ci-slow", at: "2026-10-02T00:00:00.000Z" });
    await seedObservation(base, { group: "lint-noise", at: "2026-10-02T00:00:00.000Z" });

    const loaded = await loadObservationDedupCandidates(makeHome(base), PROJECT);
    assert.ok(loaded.ok, JSON.stringify(loaded.error));
    const byGroup = Object.fromEntries(loaded.value.by_group.map((g) => [g.group, g.pending_count]));
    assert.equal(byGroup["ci-slow"], 2, "same group accumulates");
    assert.equal(byGroup["lint-noise"], 1);
    assert.equal(loaded.value.total, 3);
  });
});

test("§9 第 1 项：缓冲残缺时拒绝在残缺输入上判断", async () => {
  await withRoot(async (base) => {
    await seedObservation(base);
    const { appendFile } = await import("node:fs/promises");
    const carrier = join(base, "ldvh", "friction-observations", `${PROJECT}.jsonl`);
    await appendFile(carrier, "{ this is not json }\n", "utf8");

    const loaded = await loadObservationDedupCandidates(makeHome(base), PROJECT);
    assert.equal(loaded.ok, false, "an unparsable entry makes dedup input incomplete");
    assert.equal(loaded.error.code, "friction_observation/dedup_input_incomplete");
  });
});

// ---------------------------------------------------------------------------
// 第 2 项：写入观察条目（不写事实源）
// ---------------------------------------------------------------------------

test("§9 第 2 项：观察写入缓冲，**不产生任何账目**（观察不是事实对象）", async () => {
  await withRoot(async (base) => {
    const recorded = await seedObservation(base);
    assert.ok(recorded.entry_id, "an entry id is issued");
    assert.equal(recorded.group_pending_count, 1);
    assert.equal(recorded.promotion_ready, false, "1 < N");

    const ledger = await loadDedupCandidates(base);
    assert.ok(ledger.ok, JSON.stringify(ledger.error));
    assert.deepEqual(ledger.value.candidates, [], "observation must not write the fact source");
  });
});

test("§9 第 2 项：同组第二条使计数到 2，仍未达阈值", async () => {
  await withRoot(async (base) => {
    await seedObservation(base, { at: "2026-10-01T00:00:00.000Z" });
    const second = await seedObservation(base, { at: "2026-10-02T00:00:00.000Z" });
    assert.equal(second.group_pending_count, 2);
    assert.equal(second.promotion_ready, false);
  });
});

test("§9 第 2 项：不同 group 各自独立计数（不得混为一组）", async () => {
  await withRoot(async (base) => {
    const a = await seedObservation(base, { group: "ci-slow" });
    const b = await seedObservation(base, { group: "lint-noise" });
    assert.equal(a.group_pending_count, 1);
    assert.equal(b.group_pending_count, 1, "a different group must not inherit the other's count");
  });
});

test("§9 第 2 项：group 缺失即拒——没有聚合键，阈值永远算不出来", async () => {
  await withRoot(async (base) => {
    const r = await recordObservation({
      dshHomePath: makeHome(base),
      projectId: PROJECT,
      session: "s",
      anchor: "a",
      phenomenon: "某现象",
      evidence: "某逐字引证片段",
      group: "",
      title: "某标题",
      basis: "某入账依据",
      attribution: "某归因",
      impact: "light",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "invalid_request");
  });
});

test("§9 第 2 项：观察按管辖项目分区，跨项目不混装（02 §6.1 第 2 条 + §12bis.1）", async () => {
  await withRoot(async (base) => {
    await seedObservation(base, { group: "ci-slow" });
    const other = await recordObservation({
      dshHomePath: makeHome(base),
      projectId: "other-project",
      session: "s",
      anchor: "a",
      phenomenon: "他项目的现象",
      evidence: "他项目的逐字引证",
      group: "ci-slow",
      title: "他项目的标题",
      basis: "他项目的入账依据",
      attribution: "他项目的归因",
      impact: "light",
    });
    assert.ok(other.ok, JSON.stringify(other.error));
    assert.equal(other.value.group_pending_count, 1, "another project's identically-named group is a different group");

    const mine = await readFrictionObservations(makeHome(base), PROJECT);
    assert.equal(mine.value.total, 1, "each project sees only its own partition");
  });
});

// ---------------------------------------------------------------------------
// 第 4 项：对既有 open 账目的补充级更新
// ---------------------------------------------------------------------------

test("§9 第 4 项：count 递增 1、last_at 更新、status 不变", async () => {
  await withRoot(async (base) => {
    const uid = await seedOpen(base, { count: 1 });
    const before = await readFrictionObject({ factSourceRoot: base, objectUid: uid });

    const result = await supplementOccurrence({
      factSourceRoot: base,
      objectUid: uid,
      observation: "同一次 CI 卡顿再次出现",
      observationAt: "2026-11-02T00:00:00.000Z",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.count_before, 1);
    assert.equal(result.value.count_after, 2);
    assert.equal(result.value.status, "open", "supplement must not change status");

    const after = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    assert.equal(after.value.frontmatter.occurrence.count, 2);
    assert.equal(after.value.frontmatter.occurrence.last_at, "2026-11-02T00:00:00.000Z");
    assert.equal(after.value.frontmatter.occurrence.first_at, before.value.frontmatter.occurrence.first_at, "first_at is immutable evidence");
    assert.ok(after.value.body.includes("同一次 CI 卡顿再次出现"), "the phenomenon section records this sighting");
  });
});

test("§9 第 4 项：补充级更新**不触发任何状态流转**（账目状态推进只有 Human Gate）", async () => {
  await withRoot(async (base) => {
    const uid = await seedOpen(base, { count: 5 });
    const result = await supplementOccurrence({
      factSourceRoot: base,
      objectUid: uid,
      observation: "又一次出现",
      observationAt: "2026-11-03T00:00:00.000Z",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.count_after, 6);
    assert.equal(result.value.status, "open", "count must not drive status (2026-10 修订：阈值判定已移到缓冲侧)");
  });
});

test("§9 第 4 项：非 open 的账目拒绝补充（26 §9.3 只对非终态 open 执行）", async () => {
  await withRoot(async (base) => {
    const uid = await seedOpen(base, { count: 1 });
    const read = await readFrictionObject({ factSourceRoot: base, objectUid: uid });
    // 走 voided 而非 resolved：resolved 的 informs 需要一个可解析的解药目标，而本
    // writer 在没有 git 解析器时对 commit 形态 fail-closed（02 §8.1）。终态冻结的
    // 判定与哪一个终态无关，故用 voided 即可覆盖。
    const voided = await updateFrictionObject({
      factSourceRoot: base,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      frontmatterAfter: {
        ...read.value.frontmatter,
        status: "voided",
        disposition: "现象描述失真（测试）",
      },
      bodyMarkdownAfter: `${stripLeadingH1(read.value.body)}\n\n## 处置\n测试：账目记错，废弃。`,
      changeSummary: "测试：废弃",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(voided.ok, JSON.stringify(voided.error));

    const result = await supplementOccurrence({
      factSourceRoot: base,
      objectUid: uid,
      observation: "终态后又出现",
      observationAt: "2026-11-04T00:00:00.000Z",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.equal(result.ok, false, "terminal records freeze occurrence counting");
    assert.equal(result.error.code, "friction/status_terminal");
  });
});

// ---------------------------------------------------------------------------
// 第 3 项：阈值晋升
// ---------------------------------------------------------------------------

test("§9 第 3 项：meetsPromotionThreshold 以 pending 条目数为判据（电平条件，不是边沿）", () => {
  assert.equal(meetsPromotionThreshold(0), false);
  assert.equal(meetsPromotionThreshold(1), false);
  assert.equal(meetsPromotionThreshold(2), false);
  assert.equal(meetsPromotionThreshold(3), true, "count == N matches");
  assert.equal(meetsPromotionThreshold(5), true, "N exceeded also matches — a missed run must not strand the group");
  assert.equal(meetsPromotionThreshold("3"), false, "non-integer is not a valid count");
});

test("§9 第 3 项：达阈值前不晋升，且**不是失败**", async () => {
  await withRoot(async (base) => {
    await seedObservation(base, { at: "2026-10-01T00:00:00.000Z" });
    await seedObservation(base, { at: "2026-10-02T00:00:00.000Z" });
    const result = await promote(base);
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.promoted, false, "2 < N: a normal skip, not a failure");
    assert.equal(result.value.pending_count, 2);
  });
});

test("§9 第 3 项：达 N 条即晋升为 open 账目，count 取该组真实条目数（不是 1）", async () => {
  await withRoot(async (base) => {
    await seedObservation(base, { at: "2026-10-01T00:00:00.000Z", evidence: "第一次：CI 耗时 8m02s" });
    await seedObservation(base, { at: "2026-10-05T00:00:00.000Z", evidence: "第二次：CI 耗时 8m11s" });
    await seedObservation(base, { at: "2026-10-09T00:00:00.000Z", evidence: "第三次：CI 耗时 7m58s" });

    const result = await promote(base);
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.promoted, true);
    assert.equal(result.value.count, 3, "count is the group's real observation count");
    assert.equal(result.value.first_at, "2026-10-01T00:00:00.000Z");
    assert.equal(result.value.last_at, "2026-10-09T00:00:00.000Z");

    const fm = (await readFrictionObject({ factSourceRoot: base, objectUid: result.value.object_uid })).value.frontmatter;
    assert.equal(fm.status, "open", "a promoted entry is born open — there is no observing state any more");
    assert.equal(fm.occurrence.count, 3);
    assert.equal(fm.attribution, "构建流水线", "attribution survives into the ledger entry");
  });
});

test("§9 第 3 项 / 02 §6.1 第 3 条：晋升时该组**全部逐字引证**必须复制进账目正文", async () => {
  await withRoot(async (base) => {
    const e1 = "第一次：CI 耗时 8m02s（构建日志第 12 行）";
    const e2 = "第二次：CI 耗时 8m11s（构建日志第 40 行）";
    const e3 = "第三次：CI 耗时 7m58s（构建日志第 77 行）";
    await seedObservation(base, { at: "2026-10-01T00:00:00.000Z", evidence: e1 });
    await seedObservation(base, { at: "2026-10-05T00:00:00.000Z", evidence: e2 });
    await seedObservation(base, { at: "2026-10-09T00:00:00.000Z", evidence: e3 });

    const result = await promote(base);
    assert.ok(result.ok, JSON.stringify(result.error));
    const body = (await readFrictionObject({ factSourceRoot: base, objectUid: result.value.object_uid })).value.body;
    for (const [label, evidence] of [["e1", e1], ["e2", e2], ["e3", e3]]) {
      assert.ok(body.includes(evidence), `the promoted body must carry ${label} verbatim — the buffer is evictable, the ledger is not`);
    }
  });
});

test("§9 第 3 项：晋升后该组条目结算为 promoted 并指向新账目（幂等——不再就绪）", async () => {
  await withRoot(async (base) => {
    for (const at of ["2026-10-01T00:00:00.000Z", "2026-10-05T00:00:00.000Z", "2026-10-09T00:00:00.000Z"]) {
      await seedObservation(base, { at });
    }
    const promoted = await promote(base);
    assert.ok(promoted.ok, JSON.stringify(promoted.error));

    const after = await readFrictionObservations(makeHome(base), PROJECT, { status: "promoted" });
    assert.equal(after.value.total, 3, "all three entries settled to promoted");
    for (const record of after.value.items) {
      assert.equal(record.promoted_to, promoted.value.object_uid, "each entry points at the ledger entry it became");
    }

    const ready = await readPromotionReadyGroups(makeHome(base), PROJECT);
    assert.ok(ready.ok, JSON.stringify(ready.error));
    assert.equal(ready.value.ready.length, 0, "a promoted group must not be promoted twice");

    const again = await promote(base);
    assert.ok(again.ok, JSON.stringify(again.error));
    assert.equal(again.value.promoted, false, "idempotent: no second ledger entry");
  });
});

test("§9 第 3 项：晋升出的账目正文结构合法（H1 恰好一个，H2 固定序）", async () => {
  await withRoot(async (base) => {
    for (const at of ["2026-10-01T00:00:00.000Z", "2026-10-05T00:00:00.000Z", "2026-10-09T00:00:00.000Z"]) {
      await seedObservation(base, { at });
    }
    const promoted = await promote(base);
    assert.ok(promoted.ok, JSON.stringify(promoted.error));
    const body = (await readFrictionObject({ factSourceRoot: base, objectUid: promoted.value.object_uid })).value.body;
    const h1Count = (body.match(/^ {0,3}#(?!#)[ \t]+\S.*$/gm) ?? []).length;
    assert.equal(h1Count, 1, "26 §8 requires exactly one H1");
    assert.ok(body.includes("## 现象"), "H2 现象 present");
    assert.ok(body.includes("## 入账依据"), "H2 入账依据 present");
    assert.ok(!body.includes("## 处置"), "a freshly promoted open entry has no disposition section");
  });
});

// ---------------------------------------------------------------------------
// 回归：H1 不叠加（read-write asymmetry）
// ---------------------------------------------------------------------------

test("回归：补充级更新不得叠加 H1——连跑三次 H1 恒为 1", async () => {
  await withRoot(async (base) => {
    const uid = await seedOpen(base, { count: 1 });
    for (let i = 0; i < 3; i += 1) {
      const r = await supplementOccurrence({
        factSourceRoot: base,
        objectUid: uid,
        observation: `第 ${i + 1} 次补充观察`,
        observationAt: `2026-11-0${i + 1}T00:00:00.000Z`,
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(r.ok, JSON.stringify(r.error));
    }
    const body = (await readFrictionObject({ factSourceRoot: base, objectUid: uid })).value.body;
    const h1Count = (body.match(/^ {0,3}#(?!#)[ \t]+\S.*$/gm) ?? []).length;
    assert.equal(h1Count, 1, "read-write asymmetry must not duplicate the generated H1");
  });
});

test("stripLeadingH1：只剥第一个 H1，正文里作为字面内容的 # 行不受影响", () => {
  const body = "# 标题\n\n## 现象\n看到一行 # 不是标题\n";
  assert.equal(stripLeadingH1(body).trimEnd(), "## 现象\n看到一行 # 不是标题");
});
