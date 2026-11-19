
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { withTemp, testSignature } from "./helpers.mjs";
import {
  appendFrictionObservation,
  readFrictionObservations,
  readPromotionReadyGroups,
  FRICTION_OBSERVATION_THRESHOLD_N,
} from "../lib/friction-observation-buffer.js";
import { runFrictionReviewPromotion } from "../lib/friction-review-promotion.js";
import { listFrictionObjects, readFrictionObject, createFrictionObject } from "../lib/friction-writer.js";

const PROJECT = "dsh-ldvh";
const SIG = testSignature();

function home(root) {
  return (...segments) => join(root, "dsh-home", ...segments);
}

function factRoot(root) {
  return join(root, "fact-source");
}

function entry({ group, index, title = "依赖被重复安装", attribution = "索引重建流程" }) {
  return {
    project: PROJECT,
    session: "sess-1",
    anchor: `turn-${index}`,
    phenomenon: `同一份依赖被重装 ${index} 次`,
    evidence: `依赖重装记录第 ${index} 行（逐字引证）`,
    group,
    title,
    basis: "重复出现；归因：索引重建未复用已装依赖；修了会改善。",
    attribution,
    at: new Date(Date.now() - (10 - index) * 60_000).toISOString(),
  };
}

test("达阈值：审核层把该组晋升为 open 账目，并把缓冲条目结算为 promoted", async () => {
  await withTemp("friction-review-promotion.", async (root) => {
    const h = home(root);
    const fsRoot = factRoot(root);
    const group = "dependency-reinstall";

    for (let i = 1; i <= FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
      const appended = await appendFrictionObservation(h, entry({ group, index: i }));
      assert.ok(appended.ok, JSON.stringify(appended.error));
    }

    const result = await runFrictionReviewPromotion({
      factSourceRoot: fsRoot,
      dshHomePath: h,
      projectId: PROJECT,
      sessionSignature: SIG,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.promotions.length, 1, "the ready group is promoted");

    const promoted = result.value.promotions[0];
    assert.equal(promoted.group, group);
    assert.equal(promoted.count, FRICTION_OBSERVATION_THRESHOLD_N);

    const read = await readFrictionObject({ factSourceRoot: fsRoot, objectUid: promoted.object_uid });
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.frontmatter.status, "open");
    assert.equal(read.value.frontmatter.occurrence.count, FRICTION_OBSERVATION_THRESHOLD_N);
    assert.equal(read.value.frontmatter.title, "依赖被重复安装");
    assert.equal(read.value.frontmatter.attribution, "索引重建流程");

    for (let i = 1; i <= FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
      assert.ok(
        read.value.body.includes(`依赖重装记录第 ${i} 行（逐字引证）`),
        `entry ${i}'s verbatim evidence must be carried into the ledger body`,
      );
    }

    const pending = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.equal(pending.value.total, 0, "the promoted entries are settled out of pending");
    const promotedEntries = await readFrictionObservations(h, PROJECT, { status: "promoted" });
    assert.equal(promotedEntries.value.total, FRICTION_OBSERVATION_THRESHOLD_N);
  });
});

test("未达阈值：不晋升，且**不是失败**", async () => {
  await withTemp("friction-review-promotion.", async (root) => {
    const h = home(root);
    for (let i = 1; i < FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
      await appendFrictionObservation(h, entry({ group: "dependency-reinstall", index: i }));
    }
    const result = await runFrictionReviewPromotion({
      factSourceRoot: factRoot(root),
      dshHomePath: h,
      projectId: PROJECT,
      sessionSignature: SIG,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.promotions.length, 0, "below threshold nothing is promoted");
    const ledger = await listFrictionObjects({ factSourceRoot: factRoot(root), statusFilter: null });
    assert.equal(ledger.value.total, 0, "no ledger entry is created below the threshold");
  });
});

test("空缓冲：成功且无动作（不报错，不建账）", async () => {
  await withTemp("friction-review-promotion.", async (root) => {
    const result = await runFrictionReviewPromotion({
      factSourceRoot: factRoot(root),
      dshHomePath: home(root),
      projectId: PROJECT,
      sessionSignature: SIG,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.deepEqual(result.value.promotions, []);
    assert.deepEqual(result.value.supplemented, []);
  });
});

test("补充级更新：target_uid 非空的条目补进既有 open 账目，计数递增、状态不变", async () => {
  await withTemp("friction-review-promotion.", async (root) => {
    const h = home(root);
    const fsRoot = factRoot(root);

    const created = await createFrictionObject({
      factSourceRoot: fsRoot,
      frontmatterDraft: {
        title: "依赖被重复安装",
        phenomenon: "同一份依赖被重装 3 次",
        occurrence: { count: 3, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
        attribution: "索引重建流程",
        change_summary: "测试：既有账目",
      },
      bodyMarkdown: "## 现象\n同一份依赖被重装 3 次\n\n## 入账依据\n重复出现；修了会改善。",
      sessionSignature: SIG,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const uid = created.value.object_uid;

    const appended = await appendFrictionObservation(h, {
      ...entry({ group: uid, index: 9 }),
      target_uid: uid,
      phenomenon: "又一次重装（第 4 次）",
    });
    assert.ok(appended.ok, JSON.stringify(appended.error));

    const result = await runFrictionReviewPromotion({
      factSourceRoot: fsRoot,
      dshHomePath: h,
      projectId: PROJECT,
      sessionSignature: SIG,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.supplemented.length, 1);
    assert.equal(result.value.promotions.length, 0, "a supplement is not a promotion");

    const after = await readFrictionObject({ factSourceRoot: fsRoot, objectUid: uid });
    assert.equal(after.value.frontmatter.occurrence.count, 4, "the count increments by exactly one");
    assert.equal(after.value.frontmatter.status, "open", "supplementing never changes status");
    assert.ok(after.value.body.includes("又一次重装（第 4 次）"), "the phenomenon section records this sighting");

    assert.ok(
      after.value.body.includes("依赖重装记录第 9 行（逐字引证）"),
      "the verbatim evidence of this sighting must be carried into the ledger body — "
      + "the buffer entry is removed once supplemented, so the body is the only remaining carrier",
    );

    const pending = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.equal(pending.value.total, 0, "a supplemented entry is settled out of pending");
  });
});

test("带 target_uid 的待补充条目不计入晋升组——否则同一阻碍会被建第二笔账", async () => {
  await withTemp("friction-review-promotion.", async (root) => {
    const h = home(root);
    const uid = "11111111-2222-3333-4444-555555555555";

    for (let i = 1; i <= FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
      const appended = await appendFrictionObservation(h, {
        ...entry({ group: uid, index: i }),
        target_uid: uid,
      });
      assert.ok(appended.ok, JSON.stringify(appended.error));
    }

    const ready = await readPromotionReadyGroups(h, PROJECT);
    assert.ok(ready.ok, JSON.stringify(ready.error));
    assert.deepEqual(
      ready.value.ready,
      [],
      "three supplement-pending sightings of one obstacle must NOT reach the promotion threshold — "
      + "they are §9 item 4 (supplement an existing ledger entry), not §9 item 3 (create a new one). "
      + "Counting them here would create a duplicate ledger entry for an obstacle already on the books.",
    );
  });
});

test("补充与晋升同批：两者都完成，互不吞掉", async () => {
  await withTemp("friction-review-promotion.", async (root) => {
    const h = home(root);
    const fsRoot = factRoot(root);

    const created = await createFrictionObject({
      factSourceRoot: fsRoot,
      frontmatterDraft: {
        title: "既有账目",
        phenomenon: "现象 A",
        occurrence: { count: 1, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
        change_summary: "测试",
      },
      bodyMarkdown: "## 现象\n现象 A\n\n## 入账依据\n重复出现。",
      sessionSignature: SIG,
    });
    const uid = created.value.object_uid;

    await appendFrictionObservation(h, { ...entry({ group: uid, index: 8 }), target_uid: uid });
    for (let i = 1; i <= FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
      await appendFrictionObservation(h, entry({ group: "new-group", index: i, title: "新组标题" }));
    }

    const result = await runFrictionReviewPromotion({
      factSourceRoot: fsRoot,
      dshHomePath: h,
      projectId: PROJECT,
      sessionSignature: SIG,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.supplemented.length, 1, "the existing entry is supplemented");
    assert.equal(result.value.promotions.length, 1, "the ready group is promoted in the same run");
    assert.equal(result.value.promotions[0].group, "new-group");
  });
});

test("每次运行至多创建 1 笔账目：多组达阈值时其余如实登记为未处理", async () => {
  await withTemp("friction-review-promotion.", async (root) => {
    const h = home(root);
    for (const group of ["group-a", "group-b"]) {
      for (let i = 1; i <= FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
        await appendFrictionObservation(h, entry({ group, index: i }));
      }
    }
    const result = await runFrictionReviewPromotion({
      factSourceRoot: factRoot(root),
      dshHomePath: h,
      projectId: PROJECT,
      sessionSignature: SIG,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.promotions.length, 1, "§8.4 per-run cap is 1");
    assert.equal(result.value.skipped.length, 1, "the other ready group is registered as not handled");
    assert.equal(result.value.skipped[0].reason, "per-run-create-cap");

    const pending = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.equal(pending.value.total, FRICTION_OBSERVATION_THRESHOLD_N);
  });
});

test("项目分区：别的项目的缓冲不会被本项目晋升（§12bis.1）", async () => {
  await withTemp("friction-review-promotion.", async (root) => {
    const h = home(root);
    for (let i = 1; i <= FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
      await appendFrictionObservation(h, { ...entry({ group: "other-group", index: i }), project: "other-project" });
    }
    const result = await runFrictionReviewPromotion({
      factSourceRoot: factRoot(root),
      dshHomePath: h,
      projectId: PROJECT,
      sessionSignature: SIG,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.promotions.length, 0, "another project's group is not ours to promote");
  });
});


test("补充失败：留痕进运行痕迹（不再只留在当拍返回体里；2026-11-17 队列已删除）", async () => {
  await withTemp("friction-review-promotion.", async (base) => {
    const h = home(base);
    const fsRoot = join(base, "facts");
    const bogus = "0e1d2c3b-4444-4555-8666-777788889999";
    const appended = await appendFrictionObservation(h, {
      ...entry({ group: bogus, index: 21 }),
      target_uid: bogus,
      phenomenon: "指向不存在的账目",
    });
    assert.ok(appended.ok, JSON.stringify(appended.error));

    const result = await runFrictionReviewPromotion({
      factSourceRoot: fsRoot,
      dshHomePath: h,
      projectId: PROJECT,
      sessionSignature: SIG,
    });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.equal(result.value.supplemented.length, 0, "前置：补充确实失败了");

    const failure = result.value.residual.find((r) => r.stage === "supplement");
    assert.ok(failure, "补充失败须出现在 residual 里（既有行为）");
    assert.ok(!failure.unregistered,
      `补充失败须成功留痕；实得 unregistered=${JSON.stringify(failure.unregistered)}`);

    const { readRuns } = await import("../lib/idle-runlog.js");
    const runs = await readRuns(h, {});
    assert.ok(runs.ok, JSON.stringify(runs.error));
    const mine = runs.value.runs.filter((r) => r.stage === "failure-registration" && /补充未完成/.test(r.reason ?? ""));
    assert.equal(mine.length, 1, "运行痕迹里须有对应的那一条");
    assert.match(mine[0].reason, /unknown|object_not_found|not_found/i,
      `reason 须带失败码；实得 ${mine[0].reason}`);
  });
});

test("登记实现：留痕不可写时把原因写回失败项，不静默吞掉", async () => {
  const { registerSupplementFailure } = await import("../lib/friction-failure-registration.js");
  await withTemp("friction-failure-registration.", async (base) => {
    const { writeFile } = await import("node:fs/promises");
    const blocker = join(base, "blocker");
    await writeFile(blocker, "not a directory");
    const brokenHome = (...seg) => join(blocker, ...seg);

    const failureItem = {
      stage: "supplement",
      entry_id: "e-queue-unwritable",
      target_uid: "t-queue-unwritable",
      code: "friction/object_not_found",
      message: "cannot read object",
    };
    await registerSupplementFailure(brokenHome, failureItem, new Date());

    assert.ok(failureItem.unregistered,
      "留痕不可写时必须留下 unregistered——把赋值删掉这条就会红");
    assert.ok(typeof failureItem.unregistered_message === "string" && failureItem.unregistered_message.length > 0,
      "必须留下原因，不静默吞掉");
  });
});

test("登记实现：留痕可写时不写 unregistered（2026-11-17 载体为 runlog）", async () => {
  const { registerSupplementFailure } = await import("../lib/friction-failure-registration.js");
  await withTemp("friction-failure-registration.", async (base) => {
    const failureItem = {
      stage: "supplement",
      entry_id: "e-queue-writable",
      target_uid: "t-queue-writable",
      code: "friction/object_not_found",
      message: "cannot read object",
    };
    await registerSupplementFailure(home(base), failureItem, new Date());
    assert.ok(!failureItem.unregistered, "成功留痕时不得写 unregistered");
    const { readRuns } = await import("../lib/idle-runlog.js");
    const runs = await readRuns(home(base), {});
    assert.ok(runs.ok && runs.value.runs.some((r) => r.stage === "failure-registration"),
      "留痕须真的落进运行痕迹");
  });
});

test("全链路：一次 runFrictionReviewPromotion 同时完成「count 递增 + 缓冲条目被移除」", async () => {
  await withTemp("friction-review-promotion.", async (base) => {
    const h = home(base);
    const fsRoot = factRoot(base);
    const created = await createFrictionObject({
      factSourceRoot: fsRoot,
      frontmatterDraft: {
        title: "全链路夹具账目",
        phenomenon: "全链路夹具账目用于验证补充与结算同在一次调用内完成",
        occurrence: { count: 7, first_at: "2026-10-20T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
        attribution: "全链路测试",
        change_summary: "夹具：count 起始为 7",
      },
      bodyMarkdown: "## 现象\n全链路夹具账目用于验证补充与结算同在一次调用内完成\n\n## 入账依据\n测试夹具。",
      sessionSignature: SIG,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const uid = created.value.object_uid;

    const appended = await appendFrictionObservation(h, {
      ...entry({ group: uid, index: 41 }),
      target_uid: uid,
      phenomenon: "全链路：又一次观察到同一阻碍",
      evidence: "全链路夹具逐字引证片段（来源：turn 9 assistant）",
    });
    assert.ok(appended.ok, JSON.stringify(appended.error));

    const before = await readFrictionObservations(h, PROJECT, { status: "pending" });
    const mine = before.value.items.filter((e) => e.target_uid === uid);
    assert.equal(mine.length, 1, "前置：缓冲里有该待补充条目");
    const observedAt = mine[0].at;

    const result = await runFrictionReviewPromotion({
      factSourceRoot: fsRoot,
      dshHomePath: h,
      projectId: PROJECT,
      sessionSignature: SIG,
    });
    assert.ok(result.ok, JSON.stringify(result.error));

    const after = await readFrictionObject({ factSourceRoot: fsRoot, objectUid: uid });
    assert.equal(after.value.frontmatter.occurrence.count, 8, "count 须由 7 增至 8");
    assert.equal(Date.parse(after.value.frontmatter.occurrence.last_at), Date.parse(observedAt),
      `last_at 须更新为本次观察时刻（实得 ${after.value.frontmatter.occurrence.last_at} vs ${observedAt}）`);

    const buffered = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.equal(buffered.value.items.filter((e) => e.target_uid === uid).length, 0,
      "补充成功后该条目须被整条移除——否则下一轮会再补一次、count 虚增到 9");

    assert.ok(after.value.body.includes("全链路夹具逐字引证片段"),
      "现象段须含该条 evidence 的逐字引证");
  });
});
