// 建前审核的**分区增量覆盖**与**分片并行**（21 §9.2/§14/§15.1，2026-10-27 改造）。
//
// 改造前：覆盖闸要求 `candidate_fingerprint` 等于当前 `plan`+`scope` 的**整体**
// 指纹——改一个行号也要整份重审；轮次上限按整体指纹计数，每轮修订都换指纹、
// 计数归零，3 轮上限因此从未生效（实测 workcase-996e207a 建前审 6 轮）。
//
// 本工件钉住四件新机制：
//   ① 分区指纹只随**内容**变化——增删步骤不让其余分区漂移；
//   ② 未变分区沿用既有 `pass`，只审改动分区即可过覆盖闸（增量审核）；
//   ③ 同一轮的多个分片共享 `round_index`，合起来覆盖全部分区（分片并行）；
//   ④ 分片不占额外轮次——轮次按不同 `round_index` 计数（单门 3 次）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTemp } from "./helpers.mjs";
import {
  createWorkcaseObject,
  readWorkcaseObject,
  approveWorkcaseObject,
  recordWorkcaseAudit,
  reviseWorkcaseObject,
  computeAuditPartitions,
  auditCoverageFor,
  PRE_AUDIT_ROUNDS_MAX,
} from "../lib/workcase-writer.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "../lib/signature-channel.js";

const SIG = () => authoritativeSignature({ provider: "test-provider", model: "test-model" });
const AUDITOR = () => authoritativeSessionIdentity({ sessionId: "session-auditor-partitions", source: "host", origin: "subagent" });
const IMPLEMENTER = () => authoritativeSessionIdentity({ sessionId: "session-implementer-partitions", source: "host", origin: null });

const DRAFT = {
  title: "分区增量审核测试工单",
  gist: "夹具：钉住分区增量覆盖与分片并行。",
  serves: "SG-1",
  summary: "夹具候选。",
  scope: "做什么：\n- 夹具项甲。\n- 夹具项乙。\n\n明确不做什么：\n- 无。",
  plan: [{ step: "夹具步骤一", done_criteria: "判据一可判定。" }],
  change_summary: "初始落盘",
};

async function seedGoal(root) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(root, { recursive: true });
  await writeFile(
    `${root}/goal.md`,
    [
      "---",
      "goal_key: fixture-goal",
      "title: 夹具目标",
      "---",
      "",
      "# 夹具目标",
      "",
      "## 目标陈述",
      "",
      "夹具。",
      "",
      "## 子目标",
      "",
      "SG-1 夹具子目标。",
      "",
    ].join("\n"),
    "utf8",
  );
}

function draftBody(draft) {
  return [
    `## 摘要\n\n${draft.summary}\n`,
    `## 授权范围\n\n${draft.scope}\n`,
    `## 计划\n\n${draft.plan.map((p, i) => `${i + 1}. ${p.step}\n\n   完成判据：${p.done_criteria}`).join("\n\n")}\n`,
  ].join("\n");
}

async function createDraft(root, overrides = {}) {
  const draft = { ...DRAFT, ...overrides };
  const created = await createWorkcaseObject({
    factSourceRoot: root,
    frontmatterDraft: draft,
    bodyMarkdown: draftBody(draft),
    sessionSignature: SIG(),
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  return created.value.object_uid;
}

async function readObject(root, uid) {
  const cur = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
  assert.ok(cur.ok, JSON.stringify(cur.error));
  return cur.value;
}

async function auditWith(root, uid, opts = {}) {
  const cur = await readObject(root, uid);
  return recordWorkcaseAudit({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: cur.fingerprint,
    summary: opts.summary ?? "分区审核（夹具）",
    verdict: opts.verdict ?? "pass",
    changeSummary: "记录一条建前审核结论",
    sessionSignature: SIG(),
    sessionIdentity: opts.identity ?? AUDITOR(),
    coveredPartitionIds: opts.coveredPartitionIds ?? null,
    roundIndex: opts.roundIndex ?? null,
  });
}

async function revisePlan(root, uid, plan) {
  const cur = await readObject(root, uid);
  const frontmatterAfter = { ...cur.frontmatter, plan };
  return reviseWorkcaseObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: cur.fingerprint,
    frontmatterAfter,
    bodyMarkdownAfter: draftBody({ ...DRAFT, ...frontmatterAfter }),
    changeSummary: "修订计划（夹具）",
    sessionSignature: SIG(),
  });
}

async function approveNow(root, uid) {
  const cur = await readObject(root, uid);
  return approveWorkcaseObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: cur.fingerprint,
    approver: "human-test",
    controller: "controller-a",
    changeSummary: "Gate 1 批准",
    sessionSignature: SIG(),
    sessionIdentity: IMPLEMENTER(),
  });
}

// ---------------------------------------------------------------------------
// ① 分区指纹只随内容变化
// ---------------------------------------------------------------------------

test("分区指纹：内容不变则指纹不变，增删步骤不使其余分区漂移 (21 §9.2)", () => {
  const p1 = computeAuditPartitions(
    [{ step: "甲", done_criteria: "甲判据" }, { step: "乙", done_criteria: "乙判据" }],
    "做什么：\n- 项一。\n\n明确不做什么：\n- 无。",
  );
  const p2 = computeAuditPartitions(
    [{ step: "甲", done_criteria: "甲判据" }, { step: "乙", done_criteria: "乙判据" }, { step: "丙", done_criteria: "丙判据" }],
    "做什么：\n- 项一。\n\n明确不做什么：\n- 无。",
  );
  const byId = new Map(p2.map((p) => [p.id, p.fingerprint]));
  // 甲、乙与两个 scope 条目逐字未变 ⇒ 指纹一致；只有新增的 plan#3 是新内容。
  assert.equal(byId.get("plan#1"), p1.find((p) => p.id === "plan#1").fingerprint);
  assert.equal(byId.get("plan#2"), p1.find((p) => p.id === "plan#2").fingerprint);
  assert.equal(byId.get("scope:做什么#1"), p1.find((p) => p.id === "scope:做什么#1").fingerprint);
  assert.equal(p2.length, p1.length + 1);
});

// ---------------------------------------------------------------------------
// ② 未变分区沿用既有 pass，只审改动分区
// ---------------------------------------------------------------------------

test("增量覆盖：改一个步骤后只审该步骤即可过覆盖闸，未变分区沿用旧 pass (21 §14)", async () => {
  await withTemp("wc-part-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const first = await auditWith(root, uid, { coveredPartitionIds: ["plan#1", "scope:做什么#1", "scope:做什么#2", "scope:明确不做什么#1"] });
    assert.ok(first.ok, JSON.stringify(first.error));

    // 追加一步，其余逐字不变。
    const edited = await revisePlan(root, uid, [
      { step: "夹具步骤一", done_criteria: "判据一可判定。" },
      { step: "新增步骤二", done_criteria: "判据二可判定。" },
    ]);
    assert.ok(edited.ok, JSON.stringify(edited.error));

    // 覆盖闸：plan#2 尚未被审，其余分区由旧条目覆盖。
    const beforeAudit = auditCoverageFor(
      (await readObject(root, uid)).frontmatter.plan,
      (await readObject(root, uid)).frontmatter.scope,
      (await readObject(root, uid)).frontmatter.pre_reviews,
    );
    assert.deepEqual(beforeAudit.uncovered, ["plan#2"], "只应剩未变的那个新步骤未覆盖");

    // 只审改动分区即可。
    const delta = await auditWith(root, uid, { coveredPartitionIds: ["plan#2"] });
    assert.ok(delta.ok, JSON.stringify(delta.error));

    const approved = await approveNow(root, uid);
    assert.ok(approved.ok, JSON.stringify(approved.error));
  });
});

test("增量覆盖：缺一个分区时覆盖闸拒绝，并点名未覆盖分区 (21 §14)", async () => {
  await withTemp("wc-part-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    assert.ok((await auditWith(root, uid, { coveredPartitionIds: ["plan#1"] })).ok);
    const approved = await approveNow(root, uid);
    assert.ok(!approved.ok, "只覆盖 plan#1 不应通过");
    assert.equal(approved.error.code, "workcase/pre_gate1_audit_not_covering_candidate");
    assert.match(approved.error.message, /scope:做什么#1/);
  });
});

// ---------------------------------------------------------------------------
// ③ 分片并行：同一轮的分片合起来覆盖全部分区
// ---------------------------------------------------------------------------

test("分片并行：同一轮的两片各自覆盖一半分区，合起来即可批准 (21 §9.2)", async () => {
  await withTemp("wc-part-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const shardA = await auditWith(root, uid, { coveredPartitionIds: ["plan#1"], roundIndex: 1 });
    assert.ok(shardA.ok, JSON.stringify(shardA.error));
    const shardB = await auditWith(root, uid, {
      coveredPartitionIds: ["scope:做什么#1", "scope:做什么#2", "scope:明确不做什么#1"],
      roundIndex: 1,
    });
    assert.ok(shardB.ok, JSON.stringify(shardB.error));

    const stored = (await readObject(root, uid)).frontmatter.pre_reviews;
    assert.equal(stored.length, 2);
    assert.equal(stored[0].round_index, 1);
    assert.equal(stored[1].round_index, 1);

    const approved = await approveNow(root, uid);
    assert.ok(approved.ok, JSON.stringify(approved.error));
  });
});

test("分片不占轮次：同轮三片之后仍可开第 2 轮，第 4 轮才被拒 (21 §9.2)", async () => {
  await withTemp("wc-part-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    // 第 1 轮三片（同一 round_index）。
    for (const ids of [["plan#1"], ["scope:做什么#1"], ["scope:做什么#2", "scope:明确不做什么#1"]]) {
      assert.ok((await auditWith(root, uid, { coveredPartitionIds: ids, roundIndex: 1 })).ok);
    }
    // 第 2、3 轮仍可开——轮次计数是 1，不是 3。
    assert.ok((await auditWith(root, uid, { coveredPartitionIds: ["plan#1"] })).ok, "第 2 轮应可开");
    assert.ok((await auditWith(root, uid, { coveredPartitionIds: ["plan#1"] })).ok, "第 3 轮应可开");
    const fourth = await auditWith(root, uid, { coveredPartitionIds: ["plan#1"] });
    assert.ok(!fourth.ok, `第 4 轮须被拒（上限 ${PRE_AUDIT_ROUNDS_MAX}）`);
    assert.equal(fourth.error.code, "workcase/pre_gate1_audit_round_cap");
  });
});

// ---------------------------------------------------------------------------
// ④ 参数面 fail-closed
// ---------------------------------------------------------------------------

test("分区 id 未知时拒绝记录（分区随内容变化，不能沿用旧 id）(21 §9.2)", async () => {
  await withTemp("wc-part-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const res = await auditWith(root, uid, { coveredPartitionIds: ["plan#99"] });
    assert.ok(!res.ok);
    assert.equal(res.error.code, "invalid_request");
    assert.match(res.error.message, /plan#99/);
  });
});
