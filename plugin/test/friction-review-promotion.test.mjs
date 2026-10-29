/**
 * 审核层摩擦晋升（2026-10-30 职责重划：§9 第 3／4 项移入 §10.2）。
 *
 * 守的是**分工**而不是实现细节：
 * - 发现层只写缓冲、不写事实源；
 * - 审核层把缓冲升级为事实对象（达阈值晋升、既有账目补充）；
 * - 升级是机械的（不派生执行体），且失败 fail-closed。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { withTemp, testSignature } from "./helpers.mjs";
import {
  appendFrictionObservation,
  readFrictionObservations,
  FRICTION_OBSERVATION_THRESHOLD_N,
} from "../lib/friction-observation-buffer.js";
import { runFrictionReviewPromotion } from "../lib/friction-review-promotion.js";
import { listFrictionObjects, readFrictionObject, createFrictionObject } from "../lib/friction-writer.js";

const PROJECT = "dsh-ldvh";
const SIG = testSignature();

function home(root) {
  return () => join(root, "dsh-home");
}

function factRoot(root) {
  return join(root, "fact-source");
}

/** 一条达阈值所需的观察条目（闭集字段齐全）。 */
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
    impact: "medium",
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

    // 账目成立：open、count 取真实条目数、标题与归因来自缓冲条目。
    const read = await readFrictionObject({ factSourceRoot: fsRoot, objectUid: promoted.object_uid });
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.frontmatter.status, "open");
    assert.equal(read.value.frontmatter.occurrence.count, FRICTION_OBSERVATION_THRESHOLD_N);
    assert.equal(read.value.frontmatter.title, "依赖被重复安装");
    assert.equal(read.value.frontmatter.attribution, "索引重建流程");

    // 02 §6.1 第 3 条：该组每条逐字引证都进了账目正文。
    for (let i = 1; i <= FRICTION_OBSERVATION_THRESHOLD_N; i += 1) {
      assert.ok(
        read.value.body.includes(`依赖重装记录第 ${i} 行（逐字引证）`),
        `entry ${i}'s verbatim evidence must be carried into the ledger body`,
      );
    }

    // 缓冲侧结算：不再有 pending 条目。
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
    const ledger = await listFrictionObjects({ factSourceRoot: factRoot(root), includeResolved: true });
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

    // 先造一笔既有 open 账目（模拟它此前已由晋升建立）。
    const created = await createFrictionObject({
      factSourceRoot: fsRoot,
      frontmatterDraft: {
        title: "依赖被重复安装",
        phenomenon: "同一份依赖被重装 3 次",
        impact: "medium",
        occurrence: { count: 3, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
        attribution: "索引重建流程",
        change_summary: "测试：既有账目",
      },
      bodyMarkdown: "## 现象\n同一份依赖被重装 3 次\n\n## 入账依据\n重复出现；修了会改善。",
      sessionSignature: SIG,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const uid = created.value.object_uid;

    // 发现层在 same-obstacle 态写入一条带 target_uid 的观察。
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

    // 补充过的条目必须被结算掉，否则下次运行会重复补充（计数虚增）。
    const pending = await readFrictionObservations(h, PROJECT, { status: "pending" });
    assert.equal(pending.value.total, 0, "a supplemented entry is settled out of pending");
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
        impact: "light",
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

    // 未处理的那组条目仍 pending，下一次运行继续——不是丢失。
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
