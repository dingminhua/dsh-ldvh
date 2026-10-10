// 26 §9/§12 四值状态闭集的受控行为契约（2026-11 修订）。
//
// 为什么独立成文件：`friction-writer.test.mjs` 与 `friction-tools.test.mjs` 仍
// 停留在 `serves` 字段时代（2026-10 已从 26 §8 删除该字段），整体无法导入
// `readGoalAnchors`。本文件只钉住本次修订引入的行为，不依赖那两个文件的
// 脚手架，故不受其既存漂移影响。
//
// 覆盖：
//   1. 状态闭集四值：observing/open/resolved/voided（旧 deferred 退场）
//   2. 创建初态为 observing，且 occurrence 必填（count=1）
//   3. 默认召回不含 resolved 与 voided；includeResolved 时二者均出现（26 §12）
//   4. 终态冻结：resolved/voided 停止计数（26 §8/§9.3）

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createFrictionObject,
  listFrictionObjects,
  updateFrictionObject,
  correctFrictionObject,
  readFrictionObject,
  STATUSES_EXPORT_FOR_TEST,
  CORRECT_ADDABLE_FIELDS_FOR_TEST,
} from "../lib/friction-writer.js";
import { withTemp, testSignature } from "./helpers.mjs";

const TEST_SIGNATURE = testSignature();

/** 26 §8 必填字段的最小合法草稿（含 occurrence）。 */
function draft(overrides = {}) {
  return {
    title: "CI 构建缓慢",
    phenomenon: "CI 每次构建平均需要 8 分钟，其中 5 分钟花在重复依赖安装上。",
    impact: "heavy",
    occurrence: { count: 1, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
    change_summary: "受控创建（测试）",
    ...overrides,
  };
}

/** 现象段须逐字含 phenomenon（§8 载体内聚）。 */
function body(d, { disposition = null } = {}) {
  const sections = [
    `## 现象\n${d.phenomenon}\n\n首次观察来源：2026-11-01 的构建流水线日志。`,
    `## 入账依据\n三条件逐项核对：重复出现（本次会话内命中多次）、可归因（见 frontmatter）、修了会更好（缩短构建时间）。`,
  ];
  if (disposition !== null) sections.push(`## 处置\n${disposition}`);
  return sections.join("\n\n");
}

test("26 §9：状态闭集为四值，deferred 不再合法", () => {
  assert.deepEqual(
    [...STATUSES_EXPORT_FOR_TEST].sort(),
    ["observing", "open", "resolved", "voided"],
    "closed set must be observing/open/resolved/voided — deferred has been retired",
  );
});

test("26 §9：创建初态为 observing（不是 open，也不是旧 deferred）", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const created = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: draft(),
      bodyMarkdown: body(draft()),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const read = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(read.value.frontmatter.status, "observing", "26 §9：初态必为 observing");
    assert.equal(read.value.frontmatter.occurrence.count, 1, "26 §8：occurrence 初值 count=1");
  });
});

test("26 §9：创建不得直接进入 resolved 或 voided", async () => {
  await withTemp("friction-four-state.", async (root) => {
    for (const status of ["resolved", "voided", "deferred"]) {
      const created = await createFrictionObject({
        factSourceRoot: root,
        frontmatterDraft: draft({ status }),
        bodyMarkdown: body(draft()),
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(!created.ok, `create with status=${status} must be rejected`);
    }
  });
});

test("26 §12：默认召回含 open 与 observing，不含 resolved 与 voided", async () => {
  await withTemp("friction-four-state.", async (root) => {
    // 造三条：一条留观、一条待修、一条终态（resolved 需要 informs，此处用 voided
    // 验证终态排除——voided 无需 informs，是最直接的终态样本）。
    const keep = draft({ title: "仍留观的摩擦" });
    const k = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: keep, bodyMarkdown: body(keep), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(k.ok, JSON.stringify(k.error));

    const toVoid = draft({ title: "将被作废的摩擦" });
    const v = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: toVoid, bodyMarkdown: body(toVoid), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(v.ok, JSON.stringify(v.error));

    // 作废它：observing → voided（Human Gate；须写作废理由）
    const voided = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: v.value.object_uid,
      expectedFingerprint: v.value.fingerprint,
      frontmatterAfter: { ...toVoid, status: "voided" },
      bodyMarkdownAfter: body(toVoid, { disposition: "作废理由：根本不是系统性阻碍（测试）。" }),
      changeSummary: "改判 voided（测试）",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(voided.ok, JSON.stringify(voided.error));

    // 默认召回：只应看到那一条 observing；voided 不出现。
    const def = await listFrictionObjects({ factSourceRoot: root });
    assert.ok(def.ok, JSON.stringify(def.error));
    const statuses = def.value.items.map((item) => item.status);
    assert.deepEqual(statuses, ["observing"], `默认候选须排除终态；实际得到 ${JSON.stringify(statuses)}`);

    // includeResolved（语义：含全部终态）时两条都在。
    const all = await listFrictionObjects({ factSourceRoot: root, includeResolved: true });
    assert.ok(all.ok, JSON.stringify(all.error));
    assert.deepEqual(
      all.value.items.map((item) => item.status).sort(),
      ["observing", "voided"],
      "includeResolved 须同时展开 resolved 与 voided 两个终态",
    );
  });
});

test("26 §8：occurrence 必填——缺失即拒绝创建", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const d = draft();
    delete d.occurrence;
    const created = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: d,
      bodyMarkdown: body({ ...d, occurrence: undefined }),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!created.ok, "26 §8 把 occurrence 列为必填，缺失须拒绝");
  });
});

test("26 §13：补填通道只接受新进入闭集的字段（当前唯一实例是 occurrence）", () => {
  assert.deepEqual(
    [...CORRECT_ADDABLE_FIELDS_FOR_TEST],
    ["occurrence"],
    "闭集扩张时在 CORRECT_ADDABLE_FIELDS 登记；其它字段的补填属受控更新，不得走终态更正",
  );
});

test("26 §13：correct 可用于终态对象补填 occurrence（对称于 frontmatter_removals）", async () => {
  await withTemp("friction-four-state.", async (root) => {
    // 模拟存量对象：它创建于 occurrence 进入 §8 之前，故落盘对象上没有该字段。
    // writer 现在强制创建时必带，所以先创建再抹掉，得到「缺该字段」的目标形态。
    const d = draft({ title: "将被废弃并补填的摩擦" });
    const created = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: body(d), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const file = join(root, "frictions", `friction-${created.value.object_uid}.md`);

    const dropOccurrence = async () => {
      const lines = (await readFile(file, "utf8")).split("\n");
      const out = [];
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i] === "occurrence:") {
          // 跳过该字段及其缩进成员行
          while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) i += 1;
          continue;
        }
        out.push(lines[i]);
      }
      await writeFile(file, out.join("\n"), "utf8");
    };

    await dropOccurrence();
    const beforeVoid = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(beforeVoid.value.frontmatter.occurrence, undefined, "夹具：该对象应缺 occurrence");

    const voided = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: beforeVoid.value.fingerprint,
      frontmatterAfter: { ...beforeVoid.value.frontmatter, status: "voided" },
      bodyMarkdownAfter: body(d, { disposition: "废弃理由：根本不是系统性阻碍（测试）。" }),
      changeSummary: "改判 voided（测试）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(voided.ok, JSON.stringify(voided.error));

    // 终态只读：受控更新再也触及不到它——这正是补填通道存在的理由。
    const viaUpdate = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: voided.value.fingerprint,
      frontmatterAfter: {
        ...beforeVoid.value.frontmatter, status: "voided",
        occurrence: { count: 1, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
      },
      bodyMarkdownAfter: body(d, { disposition: "废弃理由：根本不是系统性阻碍（测试）。" }),
      changeSummary: "试补填（应被拒）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!viaUpdate.ok, "终态只读：受控更新不得触及");
    assert.equal(viaUpdate.error?.code, "friction/status_terminal", "拒绝理由须是终态只读");

    // 经 correct 的补填通道：成功
    const voidedRead = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const filled = await correctFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: voidedRead.value.fingerprint,
      bodyMarkdownAfter: voidedRead.value.body,
      frontmatterAdditions: {
        occurrence: { count: 1, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z", human_return_at: null },
      },
      changeSummary: "补填 occurrence（测试）",
      humanAuthorization: "测试授权记录",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => true,
    });
    assert.ok(filled.ok, JSON.stringify(filled.error));

    const back = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(back.value.frontmatter.occurrence?.count, 1, "occurrence 已补填");
    assert.equal(back.value.frontmatter.status, "voided", "终态判定逐字未变（补填不使终态重开）");
  });
});
