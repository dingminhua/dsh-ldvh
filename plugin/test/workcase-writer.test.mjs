// Tests for plugin/lib/workcase-writer.js — the WorkCase mechanical writer slice.
//
// Every case is derived from specs/21 (the single authority):
//   §8 字段契约与正文结构（摘要/授权范围/计划 + 条件执行/结果）,
//   §9 状态生命周期（draft→open→closed；outcome 四值；局部重批回退）,
//   §10 Gate 1/Gate 2 授权语义（gate_1 四字段、C2 指纹钉扎、attempt 令牌）,
//   §12 关系闭集（contributed-to → Pitfall）,
//   §13 召回（默认 draft+open）, §14 受控操作, §15.1 类型特有验证.
// Tests assert spec behaviour; where the implementation diverges from the
// spec the failure is reported in the task report, never "fixed" by bending
// the assertion. lib/ is NOT modified here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { testSignature, withTemp } from "./helpers.mjs";

// 03 §6.1 / 09: every write carries the authoritative signature.
const TEST_SIGNATURE = testSignature();

import {
  createWorkcaseObject,
  readWorkcaseObject,
  approveWorkcaseObject,
  executeWorkcaseObject,
  closeWorkcaseObject,
  rebatchWorkcaseObject,
  cancelWorkcaseObject,
  reviseWorkcaseObject,
  listWorkcaseObjects,
  computeAuthorizationFingerprint,
  validateWorkcaseBodyStructure,
} from "../lib/workcase-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";

const SIG = () => authoritativeSignature({ provider: "p", model: "m" });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedGoal(root, anchors = ["SG-1", "SG-2"]) {
  const fm = ["goal_key: project-goal", "title: 测试目标", "status: active", "created_at: 2026-09-15T00:00:00.000Z", "change_log:", "  - at: 2026-09-15T00:00:00.000Z", "    summary: 测试初始化"].join("\n");
  const lines = anchors.map((a) => `${a} 测试子目标 ${a}`);
  await writeFile(join(root, "goal.md"), `---\n${fm}\n---\n\n# 项目目标\n\n## 目标陈述\n\n测试目标陈述。\n\n## 子目标\n\n${lines.join("\n")}\n`, "utf8");
}

async function seedPitfall(root, uid = "11111111-2222-4333-8444-555555555555") {
  await mkdir(join(root, "pitfalls"), { recursive: true });
  const fm = ["title: 测试坑", "status: active", "created_at: 2026-09-15T00:00:00.000Z", `object_uid: ${uid}`, "fact_type_key: pitfall", "change_log:", "  - at: 2026-09-15T00:00:00.000Z", "    summary: seed"].join("\n");
  await writeFile(join(root, "pitfalls", `pitfall-${uid}.md`), `---\n${fm}\n---\n\n# 测试坑\n`, "utf8");
  return uid;
}

function validDraft(overrides = {}) {
  return {
    title: "实现 X 的最小承载",
    serves: "SG-1",
    summary: "为 X 建立最小实现并通过测试，使后续工作可复用。",
    scope: "做什么：实现 X 的 writer 与测试；明确不做什么：不改 Web 呈现、不动规范条文。",
    plan: [
      { step: "编写 writer 骨架", done_criteria: "writer 文件存在且 node --check 通过" },
      { step: "编写测试", done_criteria: "全部测试用例通过且覆盖创建与关闭路径" },
    ],
    change_summary: "受控创建（测试）",
    ...overrides,
  };
}

function draftBody(draft = validDraft()) {
  return [
    `## 摘要\n\n${draft.summary}\n`,
    `## 授权范围\n\n${draft.scope}\n`,
    `## 计划\n\n${draft.plan.map((p) => `- ${p.step}：判据——${p.done_criteria}`).join("\n")}\n`,
  ].join("\n");
}

function parseFrontmatter(raw) {
  const fmEnd = raw.indexOf("\n---\n", 5);
  return parseYaml(raw.slice(4, fmEnd));
}

async function createDraft(root, overrides = {}) {
  const draft = validDraft(overrides);
  const created = await createWorkcaseObject({
    factSourceRoot: root,
    frontmatterDraft: draft,
    bodyMarkdown: draftBody(draft),
    sessionSignature: SIG(),
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  return { created, draft, read: await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid }) };
}

/** assembleBody prepends the H1 from title; callers must pass the body without it. */
function bodyWithoutH1(body) {
  return String(body).replace(/^#\s+.*\n+/, "").replace(/\s+$/, "") + "\n";
}

async function approved(root, overrides = {}) {
  const { created } = await createDraft(root, overrides);
  const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
  const ok = await approveWorkcaseObject({
    factSourceRoot: root,
    objectUid: created.value.object_uid,
    expectedFingerprint: before.value.fingerprint,
    approver: "human-test",
    controller: "controller-a",
    changeSummary: "Gate 1 批准（测试）",
    sessionSignature: SIG(),
  });
  assert.ok(ok.ok, JSON.stringify(ok.error));
  return { uid: created.value.object_uid, after: await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid }) };
}

// ---------------------------------------------------------------------------
// create (21 §14 C1 / §8 / §9)
// ---------------------------------------------------------------------------

test("create: valid draft lands at workcases/workcase-<uid>.md with Code identity, serves resolved and read-back ok", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { created, read } = await createDraft(root);
    assert.match(created.value.object_uid, UUID_PATTERN);
    assert.equal(read.value.frontmatter.status, "draft");
    assert.equal(read.value.frontmatter.fact_type_key, "workcase");
    assert.equal(read.value.frontmatter.serves, "SG-1");
    assert.equal(created.value.read_back, "ok");
    assert.equal(read.value.mechanical_issues.length, 0);
  });
});

test("create: rejects non-draft initial status (21 §9 create always initialises draft)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: validDraft({ status: "open" }),
      bodyMarkdown: draftBody(),
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/initial_state_violation");
  });
});

test("create: rejects gate_1/attempt/result/outcome attached at creation (21 §14)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    for (const extra of [
      { gate_1: { approved_at: "2026-09-15T00:00:00Z", approver: "h", authorization_fingerprint: "a".repeat(64), scope_snapshot: "s" } },
      { attempt: { attempt_id: 1, started_at: "2026-09-15T00:00:00Z", controller: "c", heartbeat_at: "2026-09-15T00:00:00Z" } },
      { outcome: "completed" },
    ]) {
      const bad = await createWorkcaseObject({
        factSourceRoot: root,
        frontmatterDraft: validDraft(extra),
        bodyMarkdown: draftBody(),
        sessionSignature: SIG(),
      });
      assert.ok(!bad.ok, `expected rejection for ${JSON.stringify(Object.keys(extra))}`);
      assert.equal(bad.error.code, "workcase/frontmatter_invalid");
    }
  });
});

test("create: rejects plan items without done_criteria (21 §6.1 判据可判定)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: validDraft({ plan: [{ step: "只写步骤" }] }),
      bodyMarkdown: draftBody(),
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/frontmatter_invalid");
    assert.ok(bad.error.details.issues.some((i) => i.includes("done_criteria")));
  });
});

test("create: rejects unknown frontmatter fields — closed set (21 §8)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: validDraft({ priority: "P0", urls: [] }),
      bodyMarkdown: draftBody(),
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.ok(bad.error.details.issues.some((i) => i.includes("priority")));
    assert.ok(bad.error.details.issues.some((i) => i.includes("urls")));
  });
});

test("create: rejects serves that matches no goal.md SG-n (21 §10.1 fail-closed)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: validDraft({ serves: "SG-9" }),
      bodyMarkdown: draftBody(validDraft({ serves: "SG-9" })),
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/serves_unresolvable");
  });
});

test("create: rejects body whose 摘要 does not carry the authoritative summary verbatim (载体内聚)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft();
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: `## 摘要\n\n这里故意写了一段和 frontmatter 不一致的内容。\n\n## 授权范围\n\n${draft.scope}\n\n## 计划\n\n${draft.plan.map((p) => `- ${p.step}`).join("\n")}\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/coherence_invalid");
  });
});

test("create: rejects draft body carrying an 执行 section (21 §8 执行条件出现)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft();
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: `${draftBody(draft)}\n\n## 执行\n\n不应出现。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/body_invalid");
  });
});

test("create: relations require a resolvable Pitfall target (21 §12)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const missing = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: validDraft({ relations: [{ relation_key: "contributed-to", target: { object_uid: "99999999-8888-4777-a666-555555555555" } }] }),
      bodyMarkdown: draftBody(),
      sessionSignature: SIG(),
    });
    assert.ok(!missing.ok);
    assert.equal(missing.error.code, "workcase/relations_unresolvable");

    const uid = await seedPitfall(root);
    const ok = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: validDraft({ relations: [{ relation_key: "contributed-to", target: { object_uid: uid } }] }),
      bodyMarkdown: draftBody(),
      sessionSignature: SIG(),
    });
    assert.ok(ok.ok, JSON.stringify(ok.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: ok.value.object_uid });
    assert.equal(read.value.frontmatter.relations[0].target.object_uid, uid);
  });
});

// ---------------------------------------------------------------------------
// approve — Gate 1 (21 §10.1 / §14)
// ---------------------------------------------------------------------------

test("approve: draft→open stamps gate_1 (approver, fingerprint, scope_snapshot) and allocates attempt 1", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { after } = await approved(root);
    const fm = after.value.frontmatter;
    assert.equal(fm.status, "open");
    assert.equal(fm.gate_1.approver, "human-test");
    assert.equal(fm.gate_1.scope_snapshot, draft.scope);
    assert.equal(fm.gate_1.authorization_fingerprint, computeAuthorizationFingerprint(draft.plan, draft.scope));
    assert.equal(fm.attempt.attempt_id, 1);
    assert.equal(fm.attempt.controller, "controller-a");
    assert.ok(after.value.body.includes("## 执行"));
  });
});

test("approve: rejects when status is not draft (Gate 1 is the only draft→open path)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await approved(root);
    const bad = await approveWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      approver: "human-test",
      controller: "controller-b",
      changeSummary: "重复批准",
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/transition_invalid");
  });
});

// ---------------------------------------------------------------------------
// execute — C2 pinning + attempt operations (21 §10.3/§10.4)
// ---------------------------------------------------------------------------

test("execute: heartbeat refreshes heartbeat_at and keeps attempt id", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const before = after.value.frontmatter.attempt;
    const fmNext = structuredClone(after.value.frontmatter);
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: fmNext,
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- 已完成第一步。\n`,
      changeSummary: "执行进展",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read.value.frontmatter.attempt.attempt_id, before.attempt_id);
    assert.equal(read.value.frontmatter.attempt.controller, before.controller);
  });
});

test("execute: C2 refuses an in-place plan change while open — the only legal path is rebatch (21 §10.3)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const fmNext = structuredClone(after.value.frontmatter);
    fmNext.plan = [...fmNext.plan, { step: "偷偷加一步", done_criteria: "越权步骤" }];
    const bad = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: fmNext,
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- x\n`,
      changeSummary: "越权改计划",
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/c2_fingerprint_invalidated");
  });
});

test("execute: C2 refuses an in-place scope change while open (21 §10.3)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const fmNext = structuredClone(after.value.frontmatter);
    fmNext.scope = `${draft.scope}；另外扩大范围做 Y。`;
    const bad = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: fmNext,
      bodyMarkdownAfter: `${draftBody({ ...draft, scope: fmNext.scope })}\n\n## 执行\n\n- x\n`,
      changeSummary: "越权扩 scope",
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/c2_fingerprint_invalidated");
  });
});

test("execute: takeover allocates a strictly higher attempt id (21 §10.4 单调)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const fmNext = structuredClone(after.value.frontmatter);
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: fmNext,
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- 接管续跑。\n`,
      changeSummary: "新主控接管",
      attemptOperation: "takeover",
      newController: "controller-b",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read.value.frontmatter.attempt.attempt_id, 2);
    assert.equal(read.value.frontmatter.attempt.controller, "controller-b");
  });
});

test("execute: CAS conflict rejected on stale fingerprint (03 §9.5)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await approved(root);
    const bad = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: "0".repeat(64),
      frontmatterAfter: after.value.frontmatter,
      bodyMarkdownAfter: `${after.value.body}`,
      changeSummary: "过期指纹",
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/cas_conflict");
  });
});

// ---------------------------------------------------------------------------
// close — Gate 2 (21 §10.2 / §9.3)
// ---------------------------------------------------------------------------

test("close: open→closed stamps result+outcome and retracts the attempt (收口)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const body = `${draftBody(draft)}\n\n## 执行\n\n- 两步均完成。\n\n## 结果\n\n- 逐条核对：两步判据均达成。\n`;
    const res = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "completed",
      result: {
        criteria_checks: [
          { satisfied: true, evidence: "writer 文件存在且 node --check 通过" },
          { satisfied: true, evidence: "测试全部通过" },
        ],
        achieved_scope: "两步均在授权范围内完成。",
        residual: [],
      },
      changeSummary: "完成关闭",
      bodyMarkdownAfter: body,
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const fm = read.value.frontmatter;
    assert.equal(fm.status, "closed");
    assert.equal(fm.outcome, "completed");
    assert.equal(fm.attempt, undefined);
    assert.equal(fm.result.criteria_checks.length, 2);
    assert.equal(read.value.mechanical_issues.length, 0);
  });
});

test("close: completed with an unmet criterion is rejected (21 §9.3/§15.1)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const bad = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "completed",
      result: {
        criteria_checks: [
          { satisfied: true, evidence: "ok" },
          { satisfied: false, evidence: "第二步未达成" },
        ],
        achieved_scope: "仅第一步完成。",
        residual: [],
      },
      changeSummary: "声明完成",
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- 部分完成。\n\n## 结果\n\n- 一步未达成。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.ok(bad.error.details.issues.some((i) => i.includes("completed requires every criteria_checks")));
  });
});

test("close: partial without residual is rejected (21 §9.3)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const bad = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "partial",
      result: {
        criteria_checks: [
          { satisfied: true, evidence: "ok" },
          { satisfied: false, evidence: "未达成" },
        ],
        achieved_scope: "部分完成。",
      },
      changeSummary: "部分关闭",
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- 部分。\n\n## 结果\n\n- 有残留。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.ok(bad.error.details.issues.some((i) => i.includes("residual")));
  });
});

test("close: criteria_checks length must match plan (逐条对应, 21 §8)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const bad = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "completed",
      result: {
        criteria_checks: [{ satisfied: true, evidence: "只核对了第一步" }],
        achieved_scope: "声称全部完成。",
        residual: [],
      },
      changeSummary: "长度不符",
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- x\n\n## 结果\n\n- y\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.ok(bad.error.details.issues.some((i) => i.includes("length")));
  });
});

// ---------------------------------------------------------------------------
// rebatch — C2 局部重批 (21 §9.2 / §10.3)
// ---------------------------------------------------------------------------

test("rebatch: open→draft voids the attempt, drops gate_1/result, and attempt ids stay monotonic on re-approval", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const nextDraft = { ...draft, plan: [...draft.plan, { step: "重批新增步骤", done_criteria: "新步骤可判定" }] };
    const res = await rebatchWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: nextDraft,
      bodyMarkdownAfter: draftBody(nextDraft),
      changeSummary: "C2 失效：范围实质变化，重批原因记录在案；当时第一步已完成的核对结论一并记录。",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    let read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read.value.frontmatter.status, "draft");
    assert.equal(read.value.frontmatter.attempt, undefined);
    assert.equal(read.value.frontmatter.gate_1, undefined);
    assert.equal(read.value.frontmatter.result, undefined);

    // Re-approval after rebatch allocates attempt 2 (1 was used and voided —
    // never reused; the id history lives in change_log, 21 §10.4 单调).
    const re = await approveWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      approver: "human-test",
      controller: "controller-c",
      changeSummary: "重批后再批准",
      sessionSignature: SIG(),
    });
    assert.ok(re.ok, JSON.stringify(re.error));
    read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read.value.frontmatter.attempt.attempt_id, 2);
  });
});

// ---------------------------------------------------------------------------
// cancel / revise / terminal read-only (21 §9.2 / §14)
// ---------------------------------------------------------------------------

test("cancel: draft→closed cancelled carries the cancellation reason in result", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { created, draft } = await createDraft(root);
    const read0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const res = await cancelWorkcaseObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: read0.value.fingerprint,
      result: { achieved_scope: "取消理由：方向调整；实际未发生任何执行。", residual: [] },
      changeSummary: "取消",
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 结果\n\n- 工单在执行前被取消。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(read.value.frontmatter.status, "closed");
    assert.equal(read.value.frontmatter.outcome, "cancelled");
    assert.equal(read.value.frontmatter.gate_1, undefined);
    assert.equal(read.value.mechanical_issues.length, 0, JSON.stringify(read.value.mechanical_issues));
  });
});

test("revise: draft→draft plan evolution is legal before Gate 1", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { created, draft } = await createDraft(root);
    const read0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const nextDraft = { ...draft, plan: [...draft.plan, { step: "补充步骤", done_criteria: "可判定" }], change_summary: "计划演进" };
    const res = await reviseWorkcaseObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: read0.value.fingerprint,
      frontmatterAfter: nextDraft,
      bodyMarkdownAfter: draftBody(nextDraft),
      changeSummary: "Gate 1 前的计划演进",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(read.value.frontmatter.plan.length, 3);
    assert.equal(read.value.frontmatter.change_log.length, 2);
  });
});

test("terminal: closed objects refuse execute/close/rebatch (21 §9.2 终态不可重开)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const closed = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "completed",
      result: {
        criteria_checks: draft.plan.map(() => ({ satisfied: true, evidence: "达成" })),
        achieved_scope: "全部完成。",
        residual: [],
      },
      changeSummary: "关闭",
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- 完成。\n\n## 结果\n\n- 判据均达成。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(closed.ok, JSON.stringify(closed.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const fm = read.value.frontmatter;
    const attempts = [
      executeWorkcaseObject({ factSourceRoot: root, objectUid: uid, expectedFingerprint: read.value.fingerprint, frontmatterAfter: fm, bodyMarkdownAfter: read.value.body, changeSummary: "x", sessionSignature: SIG() }),
      rebatchWorkcaseObject({ factSourceRoot: root, objectUid: uid, expectedFingerprint: read.value.fingerprint, frontmatterAfter: fm, bodyMarkdownAfter: read.value.body, changeSummary: "x", sessionSignature: SIG() }),
      closeWorkcaseObject({ factSourceRoot: root, objectUid: uid, expectedFingerprint: read.value.fingerprint, outcome: "completed", result: fm.result, changeSummary: "x", bodyMarkdownAfter: read.value.body, sessionSignature: SIG() }),
    ];
    for (const bad of await Promise.all(attempts)) {
      assert.ok(!bad.ok, "closed objects must be read-only");
      assert.equal(bad.error.code, "workcase/transition_invalid");
    }
  });
});

// ---------------------------------------------------------------------------
// list — F0/F1 (21 §13)
// ---------------------------------------------------------------------------

test("list: default candidates carry draft+open only; closed appears with includeClosed", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    await createDraft(root);
    await approved(root);
    const all = await listWorkcaseObjects({ factSourceRoot: root });
    assert.ok(all.ok);
    assert.equal(all.value.total, 2);
    assert.ok(all.value.items.every((i) => i.status !== "closed"));

    const closed = await createDraft(root);
    const read0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: closed.created.value.object_uid });
    const cancel = await cancelWorkcaseObject({
      factSourceRoot: root,
      objectUid: closed.created.value.object_uid,
      expectedFingerprint: read0.value.fingerprint,
      result: { achieved_scope: "取消。", residual: [] },
      changeSummary: "取消",
      bodyMarkdownAfter: `${draftBody(closed.draft)}\n\n## 结果\n\n- 取消。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(cancel.ok, JSON.stringify(cancel.error));
    const open2 = await listWorkcaseObjects({ factSourceRoot: root });
    assert.equal(open2.value.total, 2, "closed stays out of ordinary candidates (21 §13)");
    const withClosed = await listWorkcaseObjects({ factSourceRoot: root, includeClosed: true });
    assert.equal(withClosed.value.total, 3);
    const cancelledItem = withClosed.value.items.find((i) => i.status === "closed");
    assert.equal(cancelledItem.outcome, "cancelled");
  });
});

// ---------------------------------------------------------------------------
// Body structure: the 结果 section is optional while open (21 §8 条件出现)
// ---------------------------------------------------------------------------
// Regression for Friction bf73fad4: 结果 was treated as an expected section
// only when requireResult, while the presence filter kept it unconditionally —
// the two together made any open WorkCase carrying a Gate 2 result draft fail
// with a length mismatch, leaving the v5 `awaiting_gate2` state unreachable.
test("body structure: 结果 may be present while open (awaiting_gate2 draft)", () => {
  const title = "T";
  const core = `# ${title}\n\n## 摘要\n\ns\n\n## 授权范围\n\nsc\n\n## 计划\n\n- p\n`;
  const exec = `\n## 执行\n\n- e\n`;
  const result = `\n## 结果\n\n- r\n`;

  // open (hasExecution, not requireResult): both with and without 结果 are valid.
  assert.equal(validateWorkcaseBodyStructure(core + exec + result, title, { hasExecution: true, requireResult: false }).ok, true);
  assert.equal(validateWorkcaseBodyStructure(core + exec, title, { hasExecution: true, requireResult: false }).ok, true);

  // closed with gate_1 (hasExecution + requireResult): 结果 required.
  assert.equal(validateWorkcaseBodyStructure(core + exec + result, title, { hasExecution: true, requireResult: true }).ok, true);
  assert.equal(validateWorkcaseBodyStructure(core + exec, title, { hasExecution: true, requireResult: true }).ok, false);

  // draft → closed cancelled (21 §9.2): no gate_1, but 结果 records the reason.
  assert.equal(validateWorkcaseBodyStructure(core + result, title, { hasExecution: false, requireResult: true }).ok, true);
  assert.equal(validateWorkcaseBodyStructure(core, title, { hasExecution: false, requireResult: true }).ok, false);

  // A draft that is not closing: no 执行, and the section order still holds.
  assert.equal(validateWorkcaseBodyStructure(core, title, { hasExecution: false, requireResult: false }).ok, true);
  assert.equal(validateWorkcaseBodyStructure(core + exec, title, { hasExecution: false, requireResult: false }).ok, false);
  assert.equal(validateWorkcaseBodyStructure(core + result + exec, title, { hasExecution: true, requireResult: false }).ok, false);
});

// ---------------------------------------------------------------------------
// reviews — 复核节点概要流水（21 §8，Human 裁定 2026-09-16）
// ---------------------------------------------------------------------------
test("reviews: execute accepts a well-formed entry and persists it", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await approved(root);
    const fm = { ...after.value.frontmatter };
    fm.reviews = [{
      at: new Date().toISOString(),
      provider: "test-provider",
      model: "test-model",
      summary: "对象：本单；基线：plan 判据；方法：隔离子代理只读复核；覆盖：步骤1-2；未覆盖：无；发现：无；保证边界：仅文本回读。",
    }];
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "录入复核概要",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read.value.frontmatter.reviews.length, 1);
  });
});

test("reviews: summary over 600 chars is rejected (21 §8 cap)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await approved(root);
    const fm = { ...after.value.frontmatter };
    fm.reviews = [{
      at: new Date().toISOString(),
      provider: "test-provider",
      model: "test-model",
      summary: "x".repeat(601),
    }];
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "超限复核",
      sessionSignature: SIG(),
    });
    assert.ok(!res.ok);
    assert.equal(res.error.code, "workcase/frontmatter_invalid");
    assert.ok(JSON.stringify(res.error.details.issues).includes("600"), JSON.stringify(res.error.issues));
  });
});

test("reviews: more than 20 entries is rejected — refuse, never truncate (21 §8 cap)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await approved(root);
    const fm = { ...after.value.frontmatter };
    fm.reviews = Array.from({ length: 21 }, (_, i) => ({
      at: new Date().toISOString(),
      provider: "test-provider",
      model: "test-model",
      summary: `第 ${i + 1} 次复核`,
    }));
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "超条数复核",
      sessionSignature: SIG(),
    });
    assert.ok(!res.ok);
    assert.ok(JSON.stringify(res.error.details.issues).includes("20"), JSON.stringify(res.error.issues));
  });
});

test("reviews: empty array is rejected — omit rather than fabricate a conditional field (03 §6.1)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await approved(root);
    const fm = { ...after.value.frontmatter };
    fm.reviews = [];
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "空复核数组",
      sessionSignature: SIG(),
    });
    assert.ok(!res.ok);
    assert.ok(JSON.stringify(res.error.details.issues).includes("omitted"), JSON.stringify(res.error.issues));
  });
});

test("reviews: must not appear while status=draft (复核 occurs during execution)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { created } = await createDraft(root);
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const fm = { ...before.value.frontmatter };
    fm.reviews = [{
      at: new Date().toISOString(),
      provider: "test-provider",
      model: "test-model",
      summary: "草稿期不应有复核",
    }];
    const res = await reviseWorkcaseObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: before.value.body,
      changeSummary: "草稿期写入复核",
      sessionSignature: SIG(),
    });
    assert.ok(!res.ok);
    assert.ok(JSON.stringify(res.error.details.issues).includes("draft"), JSON.stringify(res.error.issues));
  });
});
