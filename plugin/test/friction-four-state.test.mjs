
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { stripLeadingH1 } from "../lib/friction-discovery.js";

import {
  createFrictionObject,
  listFrictionObjects,
  updateFrictionObject,
  correctFrictionObject,
  readFrictionObject,
  STATUSES_EXPORT_FOR_TEST,
  CORRECT_ADDABLE_FIELDS_FOR_TEST,
  CORRECT_REMOVABLE_FIELDS_FOR_TEST,
} from "../lib/friction-writer.js";
import {
  appendFrictionObservation,
  readFrictionObservations,
  readPromotionReadyGroups,
  settleGroupPromoted,
  frictionObservationPath,
  FRICTION_OBSERVATION_STATUSES,
  FRICTION_OBSERVATION_THRESHOLD_N,
} from "../lib/friction-observation-buffer.js";
import { withTemp, testSignature } from "./helpers.mjs";

const TEST_SIGNATURE = testSignature();

function draft(overrides = {}) {
  return {
    title: "CI 构建缓慢",
    phenomenon: "CI 每次构建平均需要 8 分钟，其中 5 分钟花在重复依赖安装上。",
    occurrence: { count: 1, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
    change_summary: "受控创建（测试）",
    ...overrides,
  };
}

function body(d, { disposition = null } = {}) {
  const sections = [
    `## 现象\n${d.phenomenon}\n\n首次观察来源：2026-11-01 的构建流水线日志。`,
    `## 入账依据\n三条件逐项核对：重复出现（本次会话内命中多次）、可归因（见 frontmatter）、修了会更好（缩短构建时间）。`,
  ];
  if (disposition !== null) sections.push(`## 处置\n${disposition}`);
  return sections.join("\n\n");
}


test("26 §9：状态闭集为四值（含 accepted），observing 与 deferred 均已退出", () => {
  assert.deepEqual(
    [...STATUSES_EXPORT_FOR_TEST].sort(),
    ["accepted", "open", "resolved", "voided"],
    "closed set must be open/resolved/voided/accepted — 观察态已于 2026-11 退出闭集，accepted 于 2026-10 进入",
  );
  assert.ok(
    !STATUSES_EXPORT_FOR_TEST.has("observing"),
    "26 §9/§10（2026-11 修订）：observing 不在闭集内——观察材料由摩擦观察缓冲承载（36 §8.8），它不是账目状态",
  );
  assert.ok(
    !STATUSES_EXPORT_FOR_TEST.has("deferred"),
    "26 §9：deferred 已于更早的修订退场，不得借本次收缩回流",
  );
});

test("26 §9：创建初态为 open（不是 observing，也不是旧 deferred）", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const created = await createFrictionObject({
      factSourceRoot: root,
      frontmatterDraft: draft(),
      bodyMarkdown: body(draft()),
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const read = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(read.value.frontmatter.status, "open", "26 §9：初态必为 open（观察态已退出，初态即待修态）");
    assert.equal(read.value.frontmatter.occurrence.count, 1, "26 §8：occurrence 初值 count=1");
    assert.equal(
      read.value.frontmatter.occurrence.human_return_at,
      undefined,
      "26 §8：human_return_at 随「放回留观」流转一并删除，账目上不得出现",
    );
  });
});

test("26 §9：创建不得进入 resolved/voided，也不得进入 observing/deferred", async () => {
  await withTemp("friction-four-state.", async (root) => {
    for (const status of ["observing", "deferred", "resolved", "voided"]) {
      const created = await createFrictionObject({
        factSourceRoot: root,
        frontmatterDraft: draft({ status }),
        bodyMarkdown: body(draft()),
        sessionSignature: TEST_SIGNATURE,
      });
      assert.ok(!created.ok, `create with status=${status} must be rejected`);
      assert.equal(
        created.error?.code,
        "friction/initial_state_violation",
        `create with status=${status} 须以「初态只能是 open」拒绝；实际 ${created.error?.code}`,
      );
    }
  });
});

test("26 §9：observing 写不进账本——open 账目改判 observing 被拒且零写", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const d = draft({ title: "将被改判留观的摩擦（应被拒）" });
    const created = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: body(d), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const before = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(before.value.frontmatter.status, "open");

    const observed = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: { ...before.value.frontmatter, status: "observing" },
      bodyMarkdownAfter: body(d),
      changeSummary: "试改判 observing（应被拒）",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!observed.ok, "26 §9：observing 已不在闭集内，不得作为流转目标");
    assert.equal(observed.error?.code, "friction/status_transition_invalid", "拒绝理由须是「目标状态不在闭集内」");

    const after = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(after.value.frontmatter.status, "open", "被拒的流转不得落盘");
    assert.equal(after.value.fingerprint, before.value.fingerprint, "拒绝即零写（指纹逐字不变）");
  });
});

test("26 §12：账本里出现 observing 载体时按闭集外拒收，不被静默召回", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const d = draft({ title: "现行待修账目" });
    const created = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: body(d), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));

    const realFile = join(root, "frictions", `friction-${created.value.object_uid}.md`);
    const text = await readFile(realFile, "utf8");
    const legacyUid = randomUUID();
    await writeFile(
      join(root, "frictions", `friction-${legacyUid}.md`),
      text
        .replace(/^status: open$/m, "status: observing")
        .replace(/^object_uid: .+$/m, `object_uid: ${legacyUid}`),
      "utf8",
    );

    const all = await listFrictionObjects({ factSourceRoot: root, statusFilter: null });
    assert.ok(all.ok, JSON.stringify(all.error));
    assert.deepEqual(
      all.value.items.map((item) => item.status),
      ["open"],
      "闭集外的 observing 不得进入召回投影",
    );
    assert.equal(all.value.invalid.length, 1, "闭集外载体须单列进 invalid，不得静默跳过");
    assert.match(
      all.value.invalid[0].reason,
      /outside the closed set/,
      "拒收理由须指明「状态在闭集之外」",
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


test("26 §12：默认候选范围（open,accepted）不含 resolved/voided，二者仅在 statusFilter=null 全量枚举时展开", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const keep = draft({ title: "仍待修的摩擦" });
    const k = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: keep, bodyMarkdown: body(keep), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(k.ok, JSON.stringify(k.error));

    const toVoid = draft({ title: "将被作废的摩擦" });
    const v = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: toVoid, bodyMarkdown: body(toVoid), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(v.ok, JSON.stringify(v.error));

    const voided = await updateFrictionObject({
      factSourceRoot: root,
      objectUid: v.value.object_uid,
      expectedFingerprint: v.value.fingerprint,
      frontmatterAfter: { ...toVoid, status: "voided", disposition: "废弃理由：根本不是系统性阻碍（测试）。" },
      bodyMarkdownAfter: body(toVoid, { disposition: "作废理由：根本不是系统性阻碍（测试）。" }),
      changeSummary: "改判 voided（测试）",
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(voided.ok, JSON.stringify(voided.error));

    const def = await listFrictionObjects({ factSourceRoot: root });
    assert.ok(def.ok, JSON.stringify(def.error));
    const statuses = def.value.items.map((item) => item.status);
    assert.deepEqual(statuses, ["open"], `默认候选须排除终态；实际得到 ${JSON.stringify(statuses)}`);

    const all = await listFrictionObjects({ factSourceRoot: root, statusFilter: null });
    assert.ok(all.ok, JSON.stringify(all.error));
    assert.deepEqual(
      all.value.items.map((item) => item.status).sort(),
      ["open", "voided"],
      "statusFilter=null 全量枚举须同时展开 resolved 与 voided 两个终态",
    );
  });
});


test("26 §9.2：voided 为终态——停止计数且不可重开", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const d = draft({ title: "终态冻结的摩擦" });
    const created = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: body(d), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));

    const disposition = "废弃理由：现象描述失真（测试）。";
    const voided = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: created.value.fingerprint,
      frontmatterAfter: { ...d, status: "voided", disposition },
      bodyMarkdownAfter: body(d, { disposition }),
      changeSummary: "改判 voided（测试）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(voided.ok, JSON.stringify(voided.error));

    const reopen = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: voided.value.fingerprint,
      frontmatterAfter: {
        ...d, status: "open",
        occurrence: { count: 2, first_at: d.occurrence.first_at, last_at: "2026-11-02T00:00:00.000Z" },
      },
      bodyMarkdownAfter: body(d),
      changeSummary: "试重开并计数（应被拒）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!reopen.ok, "26 §9.2：resolved/voided 为终态，不得重开或继续计数");
    assert.equal(reopen.error?.code, "friction/status_terminal", "拒绝理由须是终态只读");
  });
});

test("26 §9.2：accepted 为终态——需 disposition 与处置段，informs 不得出现，且不可重开", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const d = draft({ title: "不可清偿的摩擦" });
    const created = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: body(d), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));

    const noDisposition = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: created.value.fingerprint,
      frontmatterAfter: { ...d, status: "accepted" },
      bodyMarkdownAfter: body(d, { disposition: "消除途径不存在（测试）" }),
      changeSummary: "试接受但不带 disposition（应被拒）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!noDisposition.ok, "accepted 必须带 disposition（26 §8）");

    const noSection = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: created.value.fingerprint,
      frontmatterAfter: { ...d, status: "accepted", disposition: "消除途径不存在（测试）" },
      bodyMarkdownAfter: body(d),
      changeSummary: "试接受但不写处置段（应被拒）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!noSection.ok, "accepted 必须有处置段（26 §8）");

    const disposition = "消除途径不存在：宿主不提供热重载，本仓无法消除该中断（测试）。复审触发：宿主版本升级时重审。";
    const accepted = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: created.value.fingerprint,
      frontmatterAfter: { ...d, status: "accepted", disposition },
      bodyMarkdownAfter: body(d, { disposition }),
      changeSummary: "接受为不可清偿（测试）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(accepted.ok, JSON.stringify(accepted.error));

    const reopen = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: accepted.value.fingerprint,
      frontmatterAfter: {
        ...d, status: "open",
        occurrence: { count: 2, first_at: d.occurrence.first_at, last_at: "2026-11-02T00:00:00.000Z" },
      },
      bodyMarkdownAfter: body(d),
      changeSummary: "试重开 accepted（应被拒）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!reopen.ok, "26 §9.2：accepted 为终态，不得重开");
    assert.equal(reopen.error?.code, "friction/status_terminal", "拒绝理由须是终态只读");
  });
});

test("26 §12：accepted 进默认候选面（不进待修聚合），statusFilter=accepted 可单独取（但仍参与查重）", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const d = draft({ title: "已接受的摩擦（默认不召回）" });
    const created = await createFrictionObject({
      factSourceRoot: root, frontmatterDraft: d, bodyMarkdown: body(d), sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));
    const disposition = "不在本项目可动范围：宿主侧机制（测试）。复审触发：依赖变更时重审。";
    const accepted = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: created.value.fingerprint,
      frontmatterAfter: { ...d, status: "accepted", disposition },
      bodyMarkdownAfter: body(d, { disposition }),
      changeSummary: "接受（测试）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(accepted.ok, JSON.stringify(accepted.error));

    const def = await listFrictionObjects({ factSourceRoot: root });
    assert.ok(def.ok);
    assert.equal(def.value.items.length, 1, "26 §12：accepted 进默认候选面（默认候选状态 = open,accepted）");

    const all = await listFrictionObjects({ factSourceRoot: root, statusFilter: null });
    assert.ok(all.ok);
    assert.equal(all.value.items.length, 1);
    assert.equal(all.value.items[0].status, "accepted");
    assert.equal(all.value.items[0].disposition, disposition, "终态去向须在投影中可读（列表卡直读）");
  });
});


test("26 §13：补填与删除通道都只接受登记过的字段", () => {
  assert.deepEqual(
    [...CORRECT_ADDABLE_FIELDS_FOR_TEST].sort(),
    ["disposition", "occurrence"],
    "闭集扩张时在 CORRECT_ADDABLE_FIELDS 登记；其它字段的补填属受控更新，不得走终态更正",
  );
  assert.deepEqual(
    [...CORRECT_REMOVABLE_FIELDS_FOR_TEST].sort(),
    ["impact", "occurrence", "serves"],
    "可删两类：已退出闭集者（serves 于 2026-10、impact 于 2026-11-02）、存在即违反 §8 条件约束者（occurrence——§14.2 豁免的 voided 对象携带它即违规）。impact 入本通道是 68 份存量终态对象的清除前提（26 §14.2）。",
  );
  assert.ok(
    !CORRECT_ADDABLE_FIELDS_FOR_TEST.has("human_return_at") && !CORRECT_REMOVABLE_FIELDS_FOR_TEST.has("human_return_at"),
    "26 §8：human_return_at 已删除，不得经任何更正通道回流",
  );
});

test("26 §13：correct 可用于终态对象补填 occurrence（对称于 frontmatter_removals）", async () => {
  await withTemp("friction-four-state.", async (root) => {
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
      frontmatterAfter: { ...beforeVoid.value.frontmatter, status: "voided", disposition: "废弃理由：根本不是系统性阻碍（测试）。" },
      bodyMarkdownAfter: body(d, { disposition: "废弃理由：根本不是系统性阻碍（测试）。" }),
      changeSummary: "改判 voided（测试）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(voided.ok, JSON.stringify(voided.error));

    const viaUpdate = await updateFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: voided.value.fingerprint,
      frontmatterAfter: {
        ...beforeVoid.value.frontmatter, status: "voided", disposition: "废弃理由：根本不是系统性阻碍（测试）。",
        occurrence: { count: 1, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
      },
      bodyMarkdownAfter: body(d, { disposition: "废弃理由：根本不是系统性阻碍（测试）。" }),
      changeSummary: "试补填（应被拒）", sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(!viaUpdate.ok, "终态只读：受控更新不得触及");
    assert.equal(viaUpdate.error?.code, "friction/status_terminal", "拒绝理由须是终态只读");

    const voidedRead = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const filled = await correctFrictionObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: voidedRead.value.fingerprint,
      bodyMarkdownAfter: stripLeadingH1(voidedRead.value.body),
      frontmatterAdditions: {
        occurrence: { count: 1, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
      },
      changeSummary: "补填 occurrence（测试）",
      humanAuthorization: "测试授权记录",
      sessionSignature: TEST_SIGNATURE,
      gitCommitResolver: async () => true,
    });
    assert.ok(filled.ok, JSON.stringify(filled.error));

    const back = await readFrictionObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(back.value.frontmatter.occurrence?.count, 1, "occurrence 已补填");
    assert.equal(back.value.frontmatter.occurrence?.human_return_at, undefined, "补填的 occurrence 不得携带已删除的 human_return_at");
    assert.equal(back.value.frontmatter.status, "voided", "终态判定逐字未变（补填不使终态重开）");
  });
});


function bufferHome(root) {
  const home = (...segments) => join(root, "dsh-home", ...segments);
  return home;
}

const PROJECT_ID = "dsh-ldvh-friction";

function bufferEntry({ minutesAgo, group, index }) {
  return {
    project: PROJECT_ID,
    session: "sess-2026-11-02-ci",
    anchor: `turn-00${index}`,
    phenomenon: "重建索引后必须手工重跑一次依赖安装。",
    evidence: `同一份依赖在 8 分钟内被重装 5 次，耗时 4 分 12 秒。—— 来源：sess-2026-11-02-ci turn-00${index}`,
    group,
    title: "依赖安装被重复执行",
    basis: "重复出现；归因：索引重建流程未复用已安装依赖；修了会改善。",
    attribution: "索引重建流程",
    at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

test("36 §8.8 / 26 §9：观察缓冲 3 条同 group 达阈值就绪，晋升结算后不再就绪", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const factSourceRoot = join(root, "fact-source");
    const home = bufferHome(root);
    const group = "ci-slow-dependency-install";

    const ids = [];
    for (let index = 1; index <= FRICTION_OBSERVATION_THRESHOLD_N; index += 1) {
      const appended = await appendFrictionObservation(home, bufferEntry({ minutesAgo: (4 - index) * 3, group, index }));
      assert.ok(appended.ok, JSON.stringify(appended.error));
      assert.equal(appended.value.group, group);
      assert.equal(appended.value.group_pending_count, index, `第 ${index} 条写入后该组 pending 数应为 ${index}`);
      assert.equal(
        appended.value.promotion_ready,
        index >= FRICTION_OBSERVATION_THRESHOLD_N,
        "只有达阈值（pending ≥ 3）的那条才报告就绪（36 §8.7 第 3 项）",
      );
      ids.push(appended.value.entry_id);
    }

    const carrierPath = frictionObservationPath(home, PROJECT_ID);
    assert.ok(carrierPath.startsWith(join(root, "dsh-home")), "缓冲载体须落在 dsh home 下");
    assert.ok(!carrierPath.startsWith(factSourceRoot), "缓冲载体不得落在事实源内（02 §6.1：中间产物不进事实源）");

    const emptyLedger = await listFrictionObjects({ factSourceRoot, statusFilter: null });
    assert.ok(emptyLedger.ok, JSON.stringify(emptyLedger.error));
    assert.equal(emptyLedger.value.total, 0, "26 §9/§10：缓冲条目不是账目，不得出现在召回里");

    const ready = await readPromotionReadyGroups(home, PROJECT_ID);
    assert.ok(ready.ok, JSON.stringify(ready.error));
    assert.equal(ready.value.ready.length, 1, "只有一个 group 达阈值");
    assert.equal(ready.value.ready[0].group, group);
    assert.equal(ready.value.ready[0].pending_count, FRICTION_OBSERVATION_THRESHOLD_N);
    assert.equal(ready.value.ready[0].entries.length, FRICTION_OBSERVATION_THRESHOLD_N);
    assert.deepEqual(
      ready.value.ready[0].entries.map((entry) => entry.status),
      Array(FRICTION_OBSERVATION_THRESHOLD_N).fill("pending"),
      "就绪组里应全为 pending 条目",
    );
    assert.deepEqual(
      ready.value.ready[0].entries.map((entry) => Date.parse(entry.at)),
      [...ready.value.ready[0].entries.map((entry) => Date.parse(entry.at))].sort((a, b) => a - b),
      "就绪组条目按观察时间升序给出（first_at/last_at 的直接来源）",
    );

    const entries = ready.value.ready[0].entries;
    const phenomenon = "CI 每次构建平均 8 分钟，其中 5 分钟花在重复依赖安装上。";
    const evidenceLines = entries
      .map((entry, i) => `${i + 1}. （${entry.at}，${entry.session} @ ${entry.anchor}）${entry.evidence}`)
      .join("\n");
    const promotedBody = [
      `## 现象\n${phenomenon}\n\n${evidenceLines}`,
      "## 入账依据\n三条件逐项核对：重复出现（缓冲同源条目 3 条，达阈值 N）、可归因（构建流程）、修了会更好（缩短构建时间）。",
    ].join("\n\n");

    const created = await createFrictionObject({
      factSourceRoot,
      frontmatterDraft: {
        title: "CI 重复依赖安装",
        phenomenon,
            occurrence: { count: entries.length, first_at: entries[0].at, last_at: entries[entries.length - 1].at },
        change_summary: "缓冲达阈值晋升为 open 账目（测试）",
      },
      bodyMarkdown: promotedBody,
      sessionSignature: TEST_SIGNATURE,
    });
    assert.ok(created.ok, JSON.stringify(created.error));

    const settled = await settleGroupPromoted(home, PROJECT_ID, ids, created.value.object_uid);
    assert.ok(settled.ok, JSON.stringify(settled.error));
    assert.deepEqual([...settled.value.settled].sort(), [...ids].sort(), "该组全部条目须结算为 promoted");
    assert.equal(settled.value.promoted_to, created.value.object_uid);

    const readyAfter = await readPromotionReadyGroups(home, PROJECT_ID);
    assert.ok(readyAfter.ok, JSON.stringify(readyAfter.error));
    assert.deepEqual(readyAfter.value.ready, [], "晋升结算后该组不得再次就绪（否则会重复入账）");

    const pendingAfter = await readFrictionObservations(home, PROJECT_ID, { status: "pending" });
    assert.ok(pendingAfter.ok, JSON.stringify(pendingAfter.error));
    assert.equal(pendingAfter.value.total, 0, "该组已无 pending 条目");

    const promotedAfter = await readFrictionObservations(home, PROJECT_ID, { status: "promoted" });
    assert.ok(promotedAfter.ok, JSON.stringify(promotedAfter.error));
    assert.equal(promotedAfter.value.total, FRICTION_OBSERVATION_THRESHOLD_N);
    for (const record of promotedAfter.value.items) {
      assert.equal(record.promoted_to, created.value.object_uid, "promoted 条目须指向新账目的 object_uid（36 §8.8）");
    }

    const ledger = await listFrictionObjects({ factSourceRoot, statusFilter: null });
    assert.ok(ledger.ok, JSON.stringify(ledger.error));
    assert.equal(ledger.value.total, 1);
    assert.equal(ledger.value.items[0].status, "open");
    assert.equal(ledger.value.items[0].occurrence.count, FRICTION_OBSERVATION_THRESHOLD_N);
  });
});

test("36 §8.8：阈值按 group 独立计算，未达阈值的组不产生就绪项", async () => {
  await withTemp("friction-four-state.", async (root) => {
    const factSourceRoot = join(root, "fact-source");
    const home = bufferHome(root);

    const fixtures = [
      { group: "group-a", minutesAgo: 8, index: 1 },
      { group: "group-a", minutesAgo: 7, index: 2 },
      { group: "group-b", minutesAgo: 6, index: 3 },
      { group: "group-b", minutesAgo: 5, index: 4 },
    ];
    for (const fixture of fixtures) {
      const appended = await appendFrictionObservation(home, bufferEntry(fixture));
      assert.ok(appended.ok, JSON.stringify(appended.error));
      assert.equal(appended.value.promotion_ready, false, `group=${fixture.group} 只有 2 条，不得就绪`);
    }

    const ready = await readPromotionReadyGroups(home, PROJECT_ID);
    assert.ok(ready.ok, JSON.stringify(ready.error));
    assert.deepEqual(ready.value.ready, [], "阈值按 group 独立判定，不是全局条目数 ≥ 3");

    const read = await readFrictionObservations(home, PROJECT_ID);
    assert.ok(read.ok, JSON.stringify(read.error));
    assert.equal(read.value.total, 4, "两组 4 条都在缓冲里（pending）");
    assert.equal(
      read.value.by_status.pending,
      4,
      "观察态在缓冲侧叫 pending——它不属于账本状态闭集",
    );

    assert.deepEqual(
      FRICTION_OBSERVATION_STATUSES.filter((status) => STATUSES_EXPORT_FOR_TEST.has(status)),
      [],
      "观察缓冲状态与账本状态闭集必须不相交（观察材料不是账目状态）",
    );
    assert.ok(
      !FRICTION_OBSERVATION_STATUSES.includes("observing"),
      "36 §8.8：缓冲条目状态是 pending/promoted/discarded/evicted，observing 不再是任何载体的状态",
    );
    assert.equal(FRICTION_OBSERVATION_THRESHOLD_N, 3, "36 §8.7：阈值 N 固定内嵌为 3，不可配置");

    const ledger = await listFrictionObjects({ factSourceRoot, statusFilter: null });
    assert.ok(ledger.ok, JSON.stringify(ledger.error));
    assert.equal(ledger.value.total, 0, "未达阈值的观察留在缓冲，绝不落成账目");
  });
});
