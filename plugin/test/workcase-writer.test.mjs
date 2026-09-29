// Tests for plugin/lib/workcase-writer.js — the WorkCase mechanical writer slice.
//
// Every case is derived from specs/21 (the single authority):
//   §8 字段契约与正文结构（摘要/授权范围/计划 + 条件执行/结果）,
//   §9 状态生命周期（draft→open→closed；outcome 四值；局部重批回退）,
//   §10 Gate 1/Gate 2 授权语义（gate_1 四字段、C2 指纹钉扎、attempt 令牌）,
//   §12 关系闭集（contributed-to → Pitfall；routed-to → Spark，写入时须 open）,
//   §13 召回（默认 draft+open）, §14 受控操作, §15.1 类型特有验证.
// Tests assert spec behaviour; where the implementation diverges from the
// spec the failure is reported in the task report, never "fixed" by bending
// the assertion. lib/ is NOT modified here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  correctWorkcaseObject,
  recordWorkcaseReview,
  requestWorkcaseAdjustment,
  decideWorkcaseAdjustment,
  listWorkcaseObjects,
  computeAuthorizationFingerprint,
  validateWorkcaseBodyStructure,
  validateWorkcaseFrontmatter,
  validateDirectionCompleteness,
} from "../lib/workcase-writer.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "../lib/signature-channel.js";

const SIG = () => authoritativeSignature({ provider: "p", model: "m" });
// 会话身份（workcase-2be11478 计划步骤 2）：关闭侧独立性比对的锚点。
// 实施会话与复核会话必须是**不同**的 identity，否则关闭门禁 fail-closed。
// 身份来源（source）是判据的一部分：写入器只接受 **host**（宿主执行上下文，
// 不可由调用者设置）。shell 来源可被一行环境变量伪造，故被拒——测试夹具用 host。
const IDENTITY = (sessionId) => authoritativeSessionIdentity({ sessionId, source: "host" });
const IMPLEMENTER = () => IDENTITY("session-implementer-test");
const REVIEWER = () => IDENTITY("session-reviewer-test");
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
    // 21 §8: gist（要点）—— draft/open 必填、≤ 200 字符、给 Human 扫读的一句话。
    gist: "为 X 建立最小承载，使后续工作可复用。",
    serves: "SG-1",
    summary: "为 X 建立最小实现并通过测试，使后续工作可复用。",
    scope: "做什么：\n- 实现 X 的 writer 与测试\n\n明确不做什么：\n- 不改 Web 呈现\n- 不动规范条文",
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
    // 实施会话身份 → attempt.session_id：关闭侧独立性比对的基线。
    sessionIdentity: IMPLEMENTER(),
  });
  assert.ok(ok.ok, JSON.stringify(ok.error));
  return { uid: created.value.object_uid, after: await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid }) };
}

/**
 * 记录一条独立复核（21 §8），使工单满足 Gate 2 的关闭前置条件
 * （21 §9.1/§14，Human 裁定 2026-09-17：关闭前须已存在至少一条 `reviews`）。
 *
 * `reviews` 只能在 status=open 时经 execute 落盘（close 不接受 frontmatterAfter），
 * 故这里走 executeWorkcaseObject。返回可供 close 使用的最新对象。
 */
/**
 * 构造一个判据全达成的 `result`（长度与 plan 一致，满足 21 §8 逐条对应）。
 * 供关闭侧独立性用例使用，使断言聚焦在身份门禁而非结果形状。
 */
function completedResult(planLength) {
  return {
    criteria_checks: Array.from({ length: planLength }, (_, i) => ({
      satisfied: true,
      evidence: `第 ${i + 1} 条判据的核对证据`,
    })),
    achieved_scope: "全部计划步骤在授权范围内完成。",
    residual: [],
  };
}

async function reviewed(root, approvedResult, summary = "对象：本单；基线：plan 判据；方法：隔离子代理只读复核；覆盖：全部判据；未覆盖：无；发现：无；保证边界：仅静态核对。", identity = REVIEWER()) {
  const { uid, after } = approvedResult;
  const fm = { ...after.value.frontmatter };
  fm.reviews = [{ summary }];
  const res = await executeWorkcaseObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: after.value.fingerprint,
    frontmatterAfter: fm,
    bodyMarkdownAfter: bodyWithoutH1(after.value.body),
    changeSummary: "录入独立复核概要",
    sessionSignature: SIG(),
    // 复核会话身份（默认 REVIEWER，≠ IMPLEMENTER）→ reviews[].session_id：
    // 这正是「独立会话记录复核」的机械证据。传 IMPLEMENTER() 可构造同会话自评。
    sessionIdentity: identity,
  });
  assert.ok(res.ok, JSON.stringify(res.error));
  return { uid, after: await readWorkcaseObject({ factSourceRoot: root, objectUid: uid }) };
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

// ---------------------------------------------------------------------------
// 21 §8 `gist`（要点）—— draft/open 必填、≤ 200 字符、closed 条件
// ---------------------------------------------------------------------------

test("gist: draft without gist is rejected (21 §8 draft/open 必填)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft();
    delete draft.gist;
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: draftBody(draft),
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.ok(
      bad.error.details.issues.some((i) => i.includes("gist: required when status=draft")),
      `expected a gist-required issue, got: ${JSON.stringify(bad.error.details.issues)}`,
    );
  });
});

test("gist: over 200 chars is rejected — refuse, never truncate (21 §8 扫读上限)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft({ gist: "字".repeat(201) });
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: draftBody(draft),
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.ok(bad.error.details.issues.some((i) => i.includes("exceeds the 200-char cap")));
  });
});

test("gist: exactly 200 chars is accepted — the cap is inclusive (21 §8 边界)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft({ gist: "字".repeat(200) });
    const ok = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: draftBody(draft),
      sessionSignature: SIG(),
    });
    assert.ok(ok.ok, JSON.stringify(ok.error));
  });
});

test("gist: empty or whitespace-only is rejected (21 §8 必填非空)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft({ gist: "   " });
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: draftBody(draft),
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.ok(bad.error.details.issues.some((i) => i.includes("gist: must be a non-empty string")));
  });
});

test("gist: absent on a CLOSED object is NOT rejected — 终态只读、无入口可补写（21 §8 分层必填的负向控制）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    // 直接对 frontmatter 校验做负向控制：closed 且无 gist 必须通过。
    // 这条断言的意义在于锁死「分层必填」不是「一律必填」——若实现被改成
    // 无条件必填，本用例会失败，从而阻止那次会永久卡死存量 closed 对象的改动。
    const closed = {
      fact_type_key: "workcase",
      object_uid: "11111111-1111-4111-8111-111111111111",
      title: "T",
      status: "closed",
      summary: "s",
      scope: "做什么：\n- a\n\n明确不做什么：\n- b",
      plan: [{ step: "x", done_criteria: "y" }],
      outcome: "cancelled",
      result: { achieved_scope: "x" },
      created_at: "2026-01-01T00:00:00.000Z",
      change_log: [{ at: "2026-01-01T00:00:00.000Z", summary: "c" }],
    };
    const check = validateWorkcaseFrontmatter(closed);
    assert.ok(
      !check.issues.some((i) => i.includes("gist")),
      `closed without gist must not raise a gist issue, got: ${JSON.stringify(check.issues)}`,
    );
  });
});

test("create: rejects serves that matches no goal.md SG-n (21 §10.1 fail-closed)", async () => {  await withTemp("workcase-writer.", async (root) => {
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
    // 夹具只让「摘要」漂移：计划部分走 draftBody 的标准写法（步骤+判据齐备），
    // 以免判据缺失一并触发内聚失败、使本用例的断言对象不再单一。
    const goodPlan = draftBody(draft).split("## 计划")[1];
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: `## 摘要\n\n这里故意写了一段和 frontmatter 不一致的内容。\n\n## 授权范围\n\n${draft.scope}\n\n## 计划${goodPlan}\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "workcase/coherence_invalid");
  });
});

// ---------------------------------------------------------------------------
// 载体内聚的登记范围（21 §8 不变量 / §15.1 / §16）
// ---------------------------------------------------------------------------
// 登记范围恰好两项：① summary/scope 在正文对应段逐字出现；② plan[].step 在
// 「计划」段按数组序出现。**判据不在其中**——§8 的「步骤 + 逐条完成判据」是对该节
// 内容的描述，其机械子句只登记了「各 step 按数组序出现」；§16 把「计划可判定性」
// 的验证入口登记为 **AI 语义审核 + Human 确认**。故本组用例同时钉住两侧边界：
// 登记项必须被机械拦下，未登记项不得被机械拦下（后者防「越界校验」复活）。
test("coherence: a body plan whose steps are not in array order is rejected (21 §15.1 按数组序)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft();
    // 步骤齐全但次序颠倒 —— 登记项，必须被拦
    const reversed = [...draft.plan].reverse();
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: `## 摘要\n\n${draft.summary}\n\n## 授权范围\n\n${draft.scope}\n\n## 计划\n\n${reversed.map((p) => `- ${p.step}：判据——${p.done_criteria}`).join("\n")}\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok, "步骤次序与数组不一致必须被拒绝");
    assert.equal(bad.error.code, "workcase/coherence_invalid");
  });
});

test("coherence: 判据未入正文 NOT rejected — 该项归 AI/Human，机器不拦 (21 §16 越界防线)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft();
    // 步骤逐字、按序出现，但一条判据都不写进正文。
    // 这是 §16 登记给 AI 语义审核 + Human 确认的判断面，机械层必须放行——
    // 若此处变红，说明有人把未登记的校验加了回来（本会话曾一度如此）。
    const res = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: `## 摘要\n\n${draft.summary}\n\n## 授权范围\n\n${draft.scope}\n\n## 计划\n\n${draft.plan.map((p) => `- ${p.step}`).join("\n")}\n`,
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, `判据是否入正文不属机械校验范围（21 §16 归 AI/Human），不得拒绝：${JSON.stringify(res.error)}`);
  });
});

test("coherence: summary/scope must appear verbatim in their sections (21 §15.1 逐字)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft();
    const plan = draft.plan.map((p) => `- ${p.step}：判据——${p.done_criteria}`).join("\n");

    // ① 正文擅自改写 scope（frontmatter 是唯一权威文本）——必须拦
    const drifted = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: `## 摘要\n\n${draft.summary}\n\n## 授权范围\n\n这是与 frontmatter 不一致的授权范围。\n\n## 计划\n\n${plan}\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!drifted.ok, "scope 漂移必须被拒绝");
    assert.equal(drifted.error.code, "workcase/coherence_invalid");

    // ② 逐字包含 + 追加说明 —— 合规：「逐字包含」不等于「不得追加」
    const appended = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: `## 摘要\n\n${draft.summary}\n\n## 授权范围\n\n${draft.scope}\n\n（补充说明：以上为授权复述。）\n\n## 计划\n\n${plan}\n`,
      sessionSignature: SIG(),
    });
    assert.ok(appended.ok, `追加说明不构成漂移：${JSON.stringify(appended.error)}`);
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

test("create: refs require exact bounded readable same-project targets and round-trip (03 §7.2 / 21 §8)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const targetUid = await seedPitfall(root);
    const refs = [{ object_uid: targetUid }];
    const created = await createDraft(root, { refs });
    assert.deepEqual(created.read.value.frontmatter.refs, refs);

    for (const badRefs of [
      [],
      Array.from({ length: 11 }, (_, index) => ({ object_uid: `11111111-2222-4333-8444-${String(index).padStart(12, "0")}` })),
      [{ object_uid: targetUid }, { object_uid: targetUid.toUpperCase() }],
      [{ object_uid: targetUid, title: "not allowed" }],
    ]) {
      const result = await createWorkcaseObject({
        factSourceRoot: root,
        frontmatterDraft: validDraft({ refs: badRefs }),
        bodyMarkdown: draftBody(),
        sessionSignature: SIG(),
      });
      assert.ok(!result.ok, `refs should be rejected: ${JSON.stringify(badRefs)}`);
      assert.equal(result.error.code, "workcase/frontmatter_invalid");
    }

    const missingUid = "99999999-8888-4777-a666-555555555555";
    const missing = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: validDraft({ refs: [{ object_uid: missingUid }] }),
      bodyMarkdown: draftBody(),
      sessionSignature: SIG(),
    });
    assert.ok(!missing.ok);
    assert.equal(missing.error.code, "workcase/refs_target_unresolvable");
  });
});

test("refs: survive carried lifecycle writes and are re-validated on rebatch (21 §8 / 03 §7.2)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const targetUid = await seedPitfall(root);
    const refs = [{ object_uid: targetUid }];

    // 创建 → 批准：refs 不经 Code 托管，须随对象落盘并回读。
    const { uid, after } = await approved(root, { refs });
    assert.deepEqual(after.value.frontmatter.refs, refs);

    // execute 携带 refs：同一解析口径下保留。
    const carried = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: { ...after.value.frontmatter, refs },
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "执行写入携带 refs（测试）",
      sessionSignature: SIG(),
    });
    assert.ok(carried.ok, JSON.stringify(carried.error));
    const afterExec = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.deepEqual(afterExec.value.frontmatter.refs, refs);

    // rebatch 允许调用方改写 refs，但仍按同一口径解析目标：不可解析即零写入拒绝。
    const unresolvable = await rebatchWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: afterExec.value.fingerprint,
      frontmatterAfter: validDraft({ refs: [{ object_uid: "99999999-8888-4777-a666-555555555555" }] }),
      bodyMarkdownAfter: draftBody(),
      changeSummary: "C2 重批：refs 目标不可解析（测试）",
      sessionSignature: SIG(),
    });
    assert.ok(!unresolvable.ok);
    assert.equal(unresolvable.error.code, "workcase/refs_target_unresolvable");

    // 拒绝是零写入：对象与 refs 保持被拒前的状态。
    const untouched = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.deepEqual(untouched.value.frontmatter.refs, refs);
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
    // Gate 2 前置（21 §9.1/§14）：先记录独立复核，否则关闭被拒。
    const { uid, after } = await reviewed(root, await approved(root));
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
    // Gate 2 前置（21 §9.1/§14）：先记录独立复核，否则关闭被拒。
    const { uid, after } = await reviewed(root, await approved(root));
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
    // Gate 2 前置（21 §9.1/§14）：先记录独立复核，否则关闭被拒。
    const { uid, after } = await reviewed(root, await approved(root));
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
    // Gate 2 前置（21 §9.1/§14）：先记录独立复核，否则关闭被拒。
    const { uid, after } = await reviewed(root, await approved(root));
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

// Gate 2 前置：关闭前须已存在至少一条 reviews（21 §9.1/§8/§14，Human 裁定 2026-09-17）
test("close: rejected when reviews is absent — 关闭前须已有独立复核记录 (21 §9.1/§14)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root); // 刻意不记录复核
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
      changeSummary: "试图无复核关闭",
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- 两步均完成。\n\n## 结果\n\n- 逐条核对：两步判据均达成。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!res.ok, "close without reviews must be rejected");
    assert.equal(res.error.code, "workcase/review_required");
    // 拒绝后对象保持 open（不得以终态掩盖复核缺失，21 §18）。
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read.value.frontmatter.status, "open");
    assert.equal(read.value.frontmatter.result, undefined);
    assert.equal(read.value.frontmatter.outcome, undefined);
  });
});

test("close: accepted once reviews exists — 有独立复核记录即可关闭 (21 §9.1/§14)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await reviewed(root, await approved(root));
    assert.ok(Array.isArray(after.value.frontmatter.reviews) && after.value.frontmatter.reviews.length > 0);
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
      changeSummary: "有复核后关闭",
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- 两步均完成。\n\n## 结果\n\n- 逐条核对：两步判据均达成。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(read.value.frontmatter.status, "closed");
    // reviews 随关闭保留（21 §8：记录「复核确实发生过」）。
    assert.equal(read.value.frontmatter.reviews.length, 1);
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
// ---------------------------------------------------------------------------
// Code 托管字段锁定与 rebatch 的 reviews 处置（21 §9.2 / §8）
// ---------------------------------------------------------------------------

test("rebatch: caller-supplied change_log is discarded — audit history cannot be injected (03 §9.5/21 §8)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const historyBefore = after.value.frontmatter.change_log.length;
    assert.ok(historyBefore >= 2, "fixture should already carry creation + approval entries");
    const nextDraft = { ...draft, plan: [...draft.plan, { step: "重批新增步骤", done_criteria: "新步骤可判定" }] };
    // 注入伪造的 change_log（企图清空并替换全部审计历史）。
    const forged = [{ at: "1999-01-01T00:00:00.000Z", provider: "FAKE", model: "FAKE", summary: "伪造的历史" }];
    const res = await rebatchWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: { ...nextDraft, change_log: forged },
      bodyMarkdownAfter: draftBody(nextDraft),
      changeSummary: "重批（含伪造 change_log 注入）",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const entries = read.value.frontmatter.change_log;
    // 真实历史必须留存，伪造条目必须被丢弃。
    assert.ok(!entries.some((e) => e.summary === "伪造的历史"), "forged change_log entry must be discarded");
    assert.ok(
      entries.length > forged.length,
      "the object's real audit history must be preserved (only appended to, never replaced)",
    );
    const last = entries[entries.length - 1];
    assert.match(String(last.summary), /C2 局部重批/);
    assert.equal(last.provider, "p", "the appended entry carries the authoritative signature (SIG() provider)");
  });
});

test("rebatch: reviews are voided with their essentials recorded in change_log (21 §9.2/§176)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await reviewed(root, await approved(root));
    assert.equal(after.value.frontmatter.reviews.length, 1, "fixture should carry one review");
    const nextDraft = { ...draft, plan: [...draft.plan, { step: "重批新增步骤", done_criteria: "新步骤可判定" }] };
    const res = await rebatchWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: nextDraft,
      bodyMarkdownAfter: draftBody(nextDraft),
      changeSummary: "范围实质变化，重批",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    // draft 不得携带 reviews（21 §8 不变量），且重批要点须在 change_log 留痕（21:176 的历史要求）。
    assert.equal(read.value.frontmatter.reviews, undefined, "reviews must not survive into draft");
    const last = read.value.frontmatter.change_log[read.value.frontmatter.change_log.length - 1];
    assert.match(
      String(last.summary),
      /reviews 随授权失效作废/,
      "the voided review must leave a trace in change_log (history is not lost)",
    );
  });
});

test("rebatch: reviews smuggled in the payload are stripped — the delete is what enforces it (21 §8/§9.2)", async () => {
  // 复核者指出：上一条用例的 payload 从未携带 reviews，故「draft 无 reviews」是被 payload
  // 决定的，不是被 `delete next.reviews` 决定的——它对剥离行为**无判别力**。
  // 本用例刻意让 payload **夹带** reviews，以真正压住剥离逻辑（去掉 delete 即失败）。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { draft } = await createDraft(root);
    const { uid, after } = await approved(root);
    const nextDraft = { ...draft, plan: [...draft.plan, { step: "重批新增步骤", done_criteria: "新步骤可判定" }] };
    const smuggled = [{
      at: "2020-01-01T00:00:00.000Z",
      provider: "smuggled-provider",
      model: "smuggled-model",
      summary: "夹带的复核条目，企图随重批带入 draft",
    }];
    const res = await rebatchWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: { ...nextDraft, reviews: smuggled },
      bodyMarkdownAfter: draftBody(nextDraft),
      changeSummary: "重批（payload 夹带 reviews）",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(
      read.value.frontmatter.reviews,
      undefined,
      "reviews smuggled through the payload must be stripped — draft never carries reviews (21 §8)",
    );
    assert.ok(
      !JSON.stringify(read.value.frontmatter).includes("smuggled-provider"),
      "no smuggled review content may survive anywhere in the frontmatter",
    );
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
      result: { achieved_scope: "未执行，无已证实范围。", residual: [] },
      changeSummary: "取消",
      // 21 §8 取消记录：`- cancellation:` 下两行均必填（§9.2/§9.3 的「取消理由与
      // 未发生的范围」）。取消理由不再塞进 `achieved_scope`（那是「已证实范围」）。
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 结果\n\n- cancellation:\n  - **理由**：方向调整，本工单不再需要。\n  - **未发生的范围**：三个计划步骤全部未执行，无任何工程改动。\n`,
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
    // Gate 2 前置（21 §9.1/§14）：先记录独立复核，否则关闭被拒。
    const { uid, after } = await reviewed(root, await approved(root));
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
// correct — closed 记录的受控事实更正 (21 §9.2:259 / 03 §9.5 / §10)
// ---------------------------------------------------------------------------

/**
 * 关闭一个工单（Gate 1 → 独立复核 → Gate 2），返回落盘对象。
 * 更正用例需要**真的 closed** 对象：冻结字段的证据力取决于它们确实由 close 路径盖戳。
 */
async function closedFixture(root) {
  const draft = validDraft();
  const { uid, after } = await reviewed(root, await approved(root));
  const closed = await closeWorkcaseObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: after.value.fingerprint,
    outcome: "completed",
    result: completedResult(draft.plan.length),
    changeSummary: "关闭（测试）",
    bodyMarkdownAfter: `${draftBody(draft)}\n\n## 执行\n\n- 完成。\n\n## 结果\n\n- 判据均达成。\n`,
    sessionSignature: SIG(),
  });
  assert.ok(closed.ok, JSON.stringify(closed.error));
  return { uid, read: await readWorkcaseObject({ factSourceRoot: root, objectUid: uid }) };
}

test("correct: closed 记录的正文可被受控更正，终态判定与授权快照逐字不变 (21 §9.2:259)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, read } = await closedFixture(root);
    const before = read.value.frontmatter;
    const beforeLog = before.change_log.length;

    // 调用方按 21 §8 只传 H2 起的正文（H1 由 writer 从 title 生成）。
    const correctedBody = `${bodyWithoutH1(read.value.body).replace("- 判据均达成。", "- 判据均达成（更正：补记逐条证据）。")}\n\n### 建议\n\n- 更正后的正文形态。\n`;
    const res = await correctWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: correctedBody,
      changeSummary: "更正建议段写法（H3 → 登记形态）",
      humanAuthorization: "Human 2026-09-27 裁定：正文形态偏差按事实更正处理",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));

    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const fm = after.value.frontmatter;
    // 终态判定与授权快照逐字不变——本入口结构上不接收 frontmatter。
    assert.equal(fm.status, "closed");
    assert.equal(fm.outcome, before.outcome);
    assert.deepEqual(fm.result, before.result);
    assert.deepEqual(fm.gate_1, before.gate_1);
    assert.deepEqual(fm.plan, before.plan);
    assert.deepEqual(fm.scope, before.scope);
    assert.deepEqual(fm.reviews, before.reviews);
    assert.equal(fm.attempt, undefined);
    assert.equal(fm.object_uid, before.object_uid);
    assert.equal(fm.created_at, before.created_at);
    // 恰好一条 change_log，且被登记为「非状态转换」的更正，Human 授权逐字留档。
    assert.equal(fm.change_log.length, beforeLog + 1);
    const entry = fm.change_log[fm.change_log.length - 1];
    assert.match(entry.summary, /^事实更正（非状态转换）——/);
    assert.ok(entry.summary.includes("Human 2026-09-27 裁定"), "Human 授权记录必须落盘");
    assert.equal(entry.provider, "p");
    assert.equal(entry.model, "m");
    // 正文确实被重写，且 H1 仍只有 writer 生成的那一条。
    assert.ok(after.value.body.includes("更正后的正文形态"));
    assert.ok(!after.value.body.includes("判据均达成。\n"));
    assert.equal((after.value.body.match(/^# /gm) ?? []).length, 1);
    assert.equal(after.value.mechanical_issues.length, 0, JSON.stringify(after.value.mechanical_issues));
  });
});

test("correct: 非终态对象、缺授权、缺摘要、空写入与陈旧指纹都被机械拒绝且零写入", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    // open 对象：更正入口只对 closed 开放——否则就是把内容更新伪装成状态转换。
    const { uid: openUid, after: openAfter } = await approved(root);
    const openAttempt = await correctWorkcaseObject({
      factSourceRoot: root,
      objectUid: openUid,
      expectedFingerprint: openAfter.value.fingerprint,
      bodyMarkdownAfter: `${bodyWithoutH1(openAfter.value.body)}\n\n### 额外\n`,
      changeSummary: "x",
      humanAuthorization: "Human 裁定",
      sessionSignature: SIG(),
    });
    assert.ok(!openAttempt.ok);
    assert.equal(openAttempt.error.code, "workcase/correction_requires_closed");

    const { uid, read } = await closedFixture(root);
    const base = {
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: read.value.fingerprint,
      bodyMarkdownAfter: `${bodyWithoutH1(read.value.body)}\n\n### 更正后\n`,
      changeSummary: "更正",
      humanAuthorization: "Human 裁定",
      sessionSignature: SIG(),
    };
    const noAuth = await correctWorkcaseObject({ ...base, humanAuthorization: "  " });
    assert.equal(noAuth.error.code, "invalid_request");
    const noSummary = await correctWorkcaseObject({ ...base, changeSummary: "" });
    assert.equal(noSummary.error.code, "workcase/change_summary_required");
    const noop = await correctWorkcaseObject({ ...base, bodyMarkdownAfter: bodyWithoutH1(read.value.body) });
    assert.ok(!noop.ok, "no-op write must be refused — supplying the stored body verbatim must not append a change_log entry");
    assert.equal(noop.error.code, "invalid_request");
    // 只多出尾随空行的「伪改动」同样不构成一次真实写入（落盘层本就会归一尾换行）。
    const noopTail = await correctWorkcaseObject({ ...base, bodyMarkdownAfter: `${bodyWithoutH1(read.value.body)}\n\n\n` });
    assert.ok(!noopTail.ok, "trailing-blank-line-only write must be refused as a no-op");
    assert.equal(noopTail.error.code, "invalid_request");
    const stale = await correctWorkcaseObject({ ...base, expectedFingerprint: "0".repeat(64) });
    assert.equal(stale.error.code, "workcase/cas_conflict");
    // 全部拒绝路径零写入：对象指纹与 change_log 长度均未变。
    const reread = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(reread.value.fingerprint, read.value.fingerprint);
    assert.equal(reread.value.frontmatter.change_log.length, read.value.frontmatter.change_log.length);
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
      result: { achieved_scope: "未执行，无已证实范围。", residual: [] },
      changeSummary: "取消",
      bodyMarkdownAfter: `${draftBody(closed.draft)}\n\n## 结果\n\n- cancellation:\n  - **理由**：列表用例。\n  - **未发生的范围**：全部计划步骤未执行。\n`,
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
// 「## 结果」的禁止侧（21 §8/§9.1）——判据是「既不执行、也不关闭」
// ---------------------------------------------------------------------------
// 缺口回归：此前该情形没有任何守卫。旧注释声称「已由 requireResult 与调用方的
// 状态配对拦住」，但 requireResult 在 draft 未关闭时为 false，而调用方的状态配对
// 只覆盖 frontmatter 的 `result` 字段、不覆盖正文节——实测一个未关闭的 draft
// 携带「## 结果」可以落盘成功，注释描述的保护并不存在。
test("body structure: a non-closing draft must NOT carry 结果 (21 §8/§9.1 禁止侧)", () => {
  const title = "T";
  const core = `# ${title}\n\n## 摘要\n\ns\n\n## 授权范围\n\nsc\n\n## 计划\n\n- p\n`;
  const result = `\n## 结果\n\n- r\n`;

  // 四个状态的穷举：只有「既不执行、也不关闭」的 draft 被禁止。
  // ① draft 未关闭 —— 禁止
  assert.equal(validateWorkcaseBodyStructure(core + result, title, { hasExecution: false, requireResult: false }).ok, false);
  // 反向控制：同一 draft 不带结果节必须通过（守卫不得误伤正常草案）
  assert.equal(validateWorkcaseBodyStructure(core, title, { hasExecution: false, requireResult: false }).ok, true);
  // ② open（含 Gate 2 结果草稿 = awaiting_gate2）—— 允许
  assert.equal(validateWorkcaseBodyStructure(`${core}\n## 执行\n\n- e\n` + result, title, { hasExecution: true, requireResult: false }).ok, true);
  // ③ draft→closed(cancelled) —— 结果必填，故允许携带
  assert.equal(validateWorkcaseBodyStructure(core + result, title, { hasExecution: false, requireResult: true }).ok, true);
  // ④ closed with gate_1 —— 允许
  assert.equal(validateWorkcaseBodyStructure(`${core}\n## 执行\n\n- e\n` + result, title, { hasExecution: true, requireResult: true }).ok, true);
});

test("body structure: create rejects a non-closing draft carrying 结果 (端到端，21 §14)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft();
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: `${draftBody(draft)}\n## 结果\n\n尚未执行却写了结果。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok, "未关闭的 draft 携带结果节必须被拒绝");
    assert.equal(bad.error.code, "workcase/body_invalid");
    assert.ok(bad.error.details.issues.some((i) => i.includes("## 结果") && i.includes("neither executing nor closing")), JSON.stringify(bad.error.details.issues));
  });
});

// ---------------------------------------------------------------------------
// 正文 H2 取值闭集（21 §8，Human 裁定 2026-09-22）
// ---------------------------------------------------------------------------
// 缺口回归：此前**没有任何守卫**拦「清单之外的 H2」。旧实现只做两项比对——
// 「期望节是否出现」与「已出现节的相对次序」——未登记标题既不参与前者也不参与
// 后者，因而默认放行（实测：正文含额外「## 复核」可落盘成功）。21 §14 原有的
// 「正文不设复核节」是「无须」而非「不得」，不足以充当机械门禁。
test("body structure: an H2 outside the closed set is rejected (21 §8 H2 闭集)", () => {
  const title = "T";
  const core = `# ${title}\n\n## 摘要\n\ns\n\n## 授权范围\n\nsc\n\n## 计划\n\n- p\n`;
  const full = `${core}\n## 执行\n\ne\n\n## 结果\n\nr\n`;
  const opts = { hasExecution: true, requireResult: true };

  // 正向控制：闭集内的完整正文必须通过（守卫不得误伤合规对象）
  assert.equal(validateWorkcaseBodyStructure(full, title, opts).ok, true);

  // 已裁定的那个具体情形：「## 复核」不得出现在正文
  // （21 §14 明言复核详情不入对象，正文无须为其新增 H2）
  const withReview = validateWorkcaseBodyStructure(`${core}\n## 执行\n\ne\n\n## 复核\n\nn\n\n## 结果\n\nr\n`, title, opts);
  assert.equal(withReview.ok, false);
  assert.ok(withReview.issues.some((i) => i.includes("unexpected H2") && i.includes("复核")), JSON.stringify(withReview.issues));

  // 不限于「复核」：任何未登记标题一视同仁（否则闭集退化为关键词黑名单）
  for (const bogus of ["备注", "背景", "参考", "Review", "摘要2"]) {
    const r = validateWorkcaseBodyStructure(`${core}\n## 执行\n\ne\n\n## ${bogus}\n\nx\n\n## 结果\n\nr\n`, title, opts);
    assert.equal(r.ok, false, `「## ${bogus}」应被拒绝`);
    assert.ok(r.issues.some((i) => i.includes("unexpected H2")), JSON.stringify(r.issues));
  }
});

test("body structure: H2 闭集不误伤围栏内字面标题、H3 分块标记与尾部内容", () => {
  const title = "T";
  const base = `# ${title}\n\n## 摘要\n\ns\n\n## 授权范围\n\nsc\n\n## 计划\n\n- p\n\n## 执行\n\ne\n`;
  const opts = { hasExecution: true, requireResult: true };

  // ① 围栏内的 `## 复核` 是**字面内容**（示例/模板/被引用的规范片段），不是标题。
  //    h2Titles 按 CommonMark 语义跳过 fenced code block —— 闭集必须继承该语义，
  //    否则正文里连「引用一段带 ## 的示例」都做不到。
  const fenced = `${base}\n## 结果\n\nr\n\n\`\`\`md\n## 复核\n这是字面内容，不是标题\n\`\`\`\n`;
  assert.equal(validateWorkcaseBodyStructure(fenced, title, opts).ok, true, "围栏内的 ## 不应被判为预期外 H2");

  // ② `###` 不是 H2。§8 书写结构允许用 `### 标签` 作分块标记，闭集不得把它一并禁掉。
  const h3 = `${base}\n### 分块标记\n\nnote\n\n## 结果\n\nr\n`;
  assert.equal(validateWorkcaseBodyStructure(h3, title, opts).ok, true, "### 分块标记不应被判为预期外 H2");

  // ③ `#标题`（井号后无空格）按 CommonMark 不是标题，不应触发闭集。
  const noSpace = `${base}\n## 结果\n\nr\n\n#不空格的井号\n`;
  assert.equal(validateWorkcaseBodyStructure(noSpace, title, opts).ok, true, "#标题 不是 ATX 标题");
});

test("body structure: create rejects an unexpected H2 end-to-end (端到端，21 §14)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const draft = validDraft();
    const bad = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: `${draftBody(draft)}\n## 复核\n\n复核详情不应入对象。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok, "含预期外 H2 的正文必须被拒绝");
    assert.equal(bad.error.code, "workcase/body_invalid");
    assert.ok(bad.error.details.issues.some((i) => i.includes("unexpected H2")), JSON.stringify(bad.error.details.issues));
  });
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

test("reviews: Code stamps at/provider/model — caller-supplied values are discarded (21 §8)", async () => {
  // 21 §8：`at` 与署名由 Code 托管，**AI 不得自填**。此前无写路径盖戳，调用方
  // 被迫自填（三重矛盾）。本用例锁定修复后的不变量：调用方传什么署名都会被
  // 权威会话记录覆盖，调用方实际只能决定 `summary`。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await approved(root);
    const fm = { ...after.value.frontmatter };
    fm.reviews = [{
      at: "1999-01-01T00:00:00.000Z", // 伪造的旧时间戳
      provider: "forged-provider", // 伪造的署名
      model: "forged-model",
      summary: "对象：本单；基线：plan 判据；方法：隔离子代理只读复核；覆盖：无；未覆盖：无；发现：无；保证边界：仅文本回读。",
    }];
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "录入复核概要（署名防伪用例）",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const entry = read.value.frontmatter.reviews[0];
    assert.notEqual(entry.at, "1999-01-01T00:00:00.000Z", "caller-supplied at must be overwritten by Code");
    assert.notEqual(entry.provider, "forged-provider", "caller-supplied provider must be overwritten by the authoritative record");
    assert.notEqual(entry.model, "forged-model", "caller-supplied model must be overwritten by the authoritative record");
    assert.equal(typeof entry.provider, "string");
    assert.ok(entry.provider.length > 0 && entry.model.length > 0, "the stamped signature must be non-empty");
    // 调用方唯一能决定的是概要内容。
    assert.match(entry.summary, /^对象：本单/);
  });
});

test("reviews: an existing entry keeps its at/provider/model across a later heartbeat (2026-09-23)", async () => {
  // 实测缺陷（2026-09-23）：stampReviewEntries 原先把所有条目的 at 刷成当前时刻、
  // provider/model 取**当前写入者**的路由。于是对一份「待批准关闭」对象做一次与复核
  // 无关的 execute 心跳（内容只是给结果节补 `- advice:` 段），就把 2026-09-22 由
  // workbuddy/deepseek-v4.1-flash 记录的独立复核**署名换成了心跳那一方**——历史复核
  // 记录被篡改。本用例锁定修正后的不变量：既有条目的 at/署名逐字继承，只有本次新写入
  // 的条目才取 Code 时钟与当前路由（后者由上一个用例负责）。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await approved(root);
    // 第一次写入：录入一条复核（新条目 → Code 盖当前路由 SIG()=p/m）。
    const first = { ...after.value.frontmatter };
    first.reviews = [{
      at: "1999-01-01T00:00:00.000Z",
      provider: "forged-provider",
      model: "forged-model",
      summary: "对象：本单；基线：plan 判据；方法：隔离子代理只读复核；覆盖：无；未覆盖：无；发现：无；保证边界：仅文本回读。",
    }];
    const r1 = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: first,
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "录入复核概要",
      sessionSignature: SIG(),
    });
    assert.ok(r1.ok, JSON.stringify(r1.error));
    const recorded = (await readWorkcaseObject({ factSourceRoot: root, objectUid: uid })).value.frontmatter.reviews[0];
    assert.equal(recorded.provider, "p");

    // 第二次写入：与复核无关的心跳，路由换成另一个署名。
    const mid = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const second = { ...mid.value.frontmatter };
    const r2 = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: mid.value.fingerprint,
      frontmatterAfter: second,
      bodyMarkdownAfter: bodyWithoutH1(mid.value.body),
      changeSummary: "补建议段（与复核无关的心跳）",
      sessionSignature: authoritativeSignature({ provider: "other-provider", model: "other-model" }),
    });
    assert.ok(r2.ok, JSON.stringify(r2.error));
    const after2 = (await readWorkcaseObject({ factSourceRoot: root, objectUid: uid })).value.frontmatter.reviews[0];
    assert.equal(after2.provider, "p", "an existing review entry must not be re-attributed to the later writer");
    assert.equal(after2.model, "m");
    assert.equal(after2.at, recorded.at, "an existing review entry keeps its recorded time verbatim");
    // 而本次的变更流水仍然署当前写入者——继承只约束 reviews 既有条目。
    const log = (await readWorkcaseObject({ factSourceRoot: root, objectUid: uid })).value.frontmatter.change_log;
    assert.equal(log.at(-1).provider, "other-provider");
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

// ---------------------------------------------------------------------------
// 关闭侧身份比对硬门禁（workcase-2be11478，Human 裁定 2026-09-19）
//
// 本组用例锁定：关闭前至少一条 reviews 必须由**独立于实施者的会话**记录。
// 伪装路径各有用例锁定被拒；合法路径有通过断言。
// ---------------------------------------------------------------------------

/** 读取当前对象的 reviews 条目（供断言）。 */
async function reviewsOf(root, uid) {
  const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
  return read.value.frontmatter.reviews ?? [];
}

test("independence: attempt.session_id is stamped from the Code-managed identity (workcase-2be11478)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { after } = await approved(root);
    assert.equal(
      after.value.frontmatter.attempt.session_id,
      "session-implementer-test",
      "Gate 1 must stamp the implementing session identity into attempt.session_id",
    );
  });
});

test("independence: a caller-supplied (forged) identity is discarded — only the branded carrier counts", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { created } = await createDraft(root);
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const ok = await approveWorkcaseObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: before.value.fingerprint,
      approver: "human-test",
      controller: "controller-a",
      changeSummary: "Gate 1 批准（伪造身份用例）",
      sessionSignature: SIG(),
      // 普通对象不是品牌载体 —— 必须被解析为「无身份」，而不是被采信。
      sessionIdentity: { sessionId: "session-forged-by-ai" },
    });
    assert.ok(ok.ok, JSON.stringify(ok.error));
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(
      after.value.frontmatter.attempt.session_id,
      undefined,
      "a forged plain-object identity must never be stamped (only the branded carrier is accepted)",
    );
  });
});

test("independence: close is REJECTED when the only review came from the implementing session (同会话自评)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    // 实施者用**自己的**身份记录复核 —— 这就是主控自查冒充独立复核。
    const rev = await reviewed(root, appr, undefined, IMPLEMENTER());
    const res = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: rev.uid,
      expectedFingerprint: rev.after.value.fingerprint,
      outcome: "completed",
      result: completedResult(rev.after.value.frontmatter.plan.length),
      changeSummary: "尝试以同会话自评关闭",
      bodyMarkdownAfter: bodyWithoutH1(rev.after.value.body),
      sessionSignature: SIG(),
    });
    assert.ok(!res.ok, "自评冒充独立复核必须被拒绝");
    assert.equal(res.error.code, "workcase/review_independence_missing");
  });
});

test("independence: close is ACCEPTED when a DIFFERENT session recorded the review (合法路径)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    const rev = await reviewed(root, appr); // 默认 REVIEWER ≠ IMPLEMENTER
    const res = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: rev.uid,
      expectedFingerprint: rev.after.value.fingerprint,
      outcome: "completed",
      result: completedResult(rev.after.value.frontmatter.plan.length),
      changeSummary: "独立会话复核后关闭",
      // close 要求 body 携带「## 结果」节（21 §8）。
      bodyMarkdownAfter: `${bodyWithoutH1(rev.after.value.body)}\n\n## 结果\n\n- 逐条核对：全部计划步骤判据达成；独立会话复核记录见 reviews。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
  });
});

test("independence: close is REJECTED when no reviews entry carries an identity (身份不可得不得当作独立)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    // 无身份写入：execute 不带 sessionIdentity → reviews 条目无 session_id。
    const fm = { ...appr.after.value.frontmatter };
    fm.reviews = [{ summary: "无身份复核记录" }];
    const exec = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: appr.after.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: bodyWithoutH1(appr.after.value.body),
      changeSummary: "无身份写入复核",
      sessionSignature: SIG(),
      // 故意不传 sessionIdentity
    });
    assert.ok(exec.ok, JSON.stringify(exec.error));
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.equal(after.value.frontmatter.reviews[0].session_id, undefined, "无身份时不得虚构 session_id");
    const res = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "completed",
      result: completedResult(after.value.frontmatter.plan.length),
      changeSummary: "身份不可得时尝试关闭",
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      sessionSignature: SIG(),
    });
    assert.ok(!res.ok, "身份不可得时不得放行（未知不等于独立）");
    assert.equal(res.error.code, "workcase/review_independence_unverifiable");
  });
});

test("independence: a recorded review's summary cannot be rewritten by another session (防借壳)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    const rev = await reviewed(root, appr, "独立会话 S2 的真实复核结论。");
    // 实施者保留索引、换成自己的文本 —— 企图借 S2 的身份通过门禁。
    const fm = { ...rev.after.value.frontmatter };
    fm.reviews = [{ summary: "实施者改写后的自查文本" }];
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: rev.uid,
      expectedFingerprint: rev.after.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: bodyWithoutH1(rev.after.value.body),
      changeSummary: "企图改写既有复核条目",
      sessionSignature: SIG(),
      sessionIdentity: IMPLEMENTER(),
    });
    assert.ok(!res.ok, "已有身份的复核条目不得被其它会话改写概要");
    assert.equal(res.error.code, "workcase/review_history_rewritten");
  });
});

test("independence: an implementer heartbeat must NOT erase the reviewer's recorded identity", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    const rev = await reviewed(root, appr);
    const reviewerId = (await reviewsOf(root, rev.uid))[0].session_id;
    assert.equal(reviewerId, "session-reviewer-test");
    // 实施者在复核之后继续工作：一次普通心跳。
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: rev.uid,
      expectedFingerprint: rev.after.value.fingerprint,
      frontmatterAfter: { ...rev.after.value.frontmatter },
      bodyMarkdownAfter: bodyWithoutH1(rev.after.value.body),
      changeSummary: "复核之后的心跳",
      sessionSignature: SIG(),
      sessionIdentity: IMPLEMENTER(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const after = await reviewsOf(root, rev.uid);
    assert.equal(
      after[0].session_id,
      "session-reviewer-test",
      "已记录的复核会话身份必须按索引继承，不得被实施者后续写入抹掉",
    );
  });
});

test("independence: a legacy attempt without session_id is BACKFILLED by heartbeat (否则存量对象永远无法关闭)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    // 模拟「本锚点之前建立」的对象：approve 时不带身份。
    const { created } = await createDraft(root);
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const ok = await approveWorkcaseObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: before.value.fingerprint,
      approver: "human-test",
      controller: "controller-a",
      changeSummary: "Gate 1 批准（存量对象：无身份）",
      sessionSignature: SIG(),
      // 不带 sessionIdentity → attempt.session_id 缺席（存量形态）
    });
    assert.ok(ok.ok, JSON.stringify(ok.error));
    let after = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(after.value.frontmatter.attempt.session_id, undefined);
    // 执行会话做一次心跳：应把缺失的基线补齐。
    const hb = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: { ...after.value.frontmatter },
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "心跳并补齐身份基线",
      sessionSignature: SIG(),
      sessionIdentity: IMPLEMENTER(),
    });
    assert.ok(hb.ok, JSON.stringify(hb.error));
    after = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(after.value.frontmatter.attempt.session_id, "session-implementer-test");
  });
});

test("independence: an EXISTING baseline is not overwritten by a later heartbeat (复核者心跳不得改写基线)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root); // 基线 = session-implementer-test
    const hb = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: appr.after.value.fingerprint,
      frontmatterAfter: { ...appr.after.value.frontmatter },
      bodyMarkdownAfter: bodyWithoutH1(appr.after.value.body),
      changeSummary: "复核者误做的普通心跳",
      sessionSignature: SIG(),
      sessionIdentity: REVIEWER(), // 不同会话
    });
    assert.ok(hb.ok, JSON.stringify(hb.error));
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.equal(
      after.value.frontmatter.attempt.session_id,
      "session-implementer-test",
      "已存在的实施者基线不得被后续心跳改写（否则门禁会把复核者与自身比较）",
    );
  });
});

test("independence: KNOWN GAP — rebatch→cancel still reaches closed without any review (归 4005b67b)", async () => {
  // 本用例**锁定一个已知缺口**，不是期望行为。21 §15.1 登记的缺口②：`cancel`
  // （draft→closed）不校验 `reviews`，故「open → rebatch → draft → cancel → closed」
  // 可绕开关闭侧全部门禁。本单（workcase-2be11478）只硬化 `close` 路径，该缺口的
  // 修复归 `workcase-4005b67b`（其 scope 的 (A) 项）。
  //
  // 之所以把它写成断言而非留白：这样缺口一旦被修复，本用例会失败并提醒改文档
  // （21 §14 的「机械覆盖范围」声明与 §15.1 的缺口②条目需同步），避免出现
  // 「实现已修、规范仍写着有缺口」的静默漂移。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root); // 无 reviews
    // rebatch: open → draft（reviews 一并作废）。draft 不得携带「## 执行」节
    // （21 §8：Gate 1 前无执行），故提交的 draft 正文须剥掉执行节。
    const draftFm = { ...appr.after.value.frontmatter };
    delete draftFm.attempt; delete draftFm.result; delete draftFm.outcome; delete draftFm.gate_1; delete draftFm.reviews;
    const cleanDraftBody = bodyWithoutH1(appr.after.value.body).replace(/## 执行[\s\S]*$/, "").replace(/\s+$/, "") + "\n";
    const rb = await rebatchWorkcaseObject({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: appr.after.value.fingerprint,
      frontmatterAfter: draftFm,
      bodyMarkdownAfter: cleanDraftBody,
      changeSummary: "重批（缺口用例）",
      sessionSignature: SIG(),
    });
    assert.ok(rb.ok, JSON.stringify(rb.error));
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.equal(after.value.frontmatter.status, "draft");
    assert.equal(after.value.frontmatter.reviews, undefined, "重批后 reviews 随授权作废");
    // cancel: draft → closed，未经任何复核。draft 不得携带「## 执行」节（21 §8），
    // 故此处剥掉执行节后再补结果节。
    const draftBody = bodyWithoutH1(after.value.body).replace(/## 执行[\s\S]*$/, "").replace(/\s+$/, "");
    const cx = await cancelWorkcaseObject({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: after.value.fingerprint,
      result: { achieved_scope: "未执行，无已证实范围。" },
      changeSummary: "取消",
      bodyMarkdownAfter: `${draftBody}\n\n## 结果\n\n- cancellation:\n  - **理由**：缺口用例。\n  - **未发生的范围**：全部计划步骤未执行。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(cx.ok, "缺口②当前允许该路径——若本断言失败，说明缺口已被修复，请同步 21 §14/§15.1");
    const fin = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.equal(fin.value.frontmatter.status, "closed");
    assert.equal(fin.value.frontmatter.outcome, "cancelled");
    assert.equal((fin.value.frontmatter.reviews ?? []).length, 0, "到达 closed 而 reviews 为 0 —— 缺口②的表现");
  });
});

test("record_review: appends one entry carrying the caller's Code-stamped identity", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    const res = await recordWorkcaseReview({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: appr.after.value.fingerprint,
      summary: "对象：本单；基线：plan 判据；方法：隔离会话只读复核；覆盖：全部判据；未覆盖：运行时渲染；发现：无；保证边界：仅静态核对。",
      sessionSignature: SIG(),
      sessionIdentity: REVIEWER(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const entries = await reviewsOf(root, appr.uid);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].session_id, "session-reviewer-test");
    assert.match(entries[0].summary, /^对象：本单/);
  });
});

test("record_review: refuses without an authoritative identity (通道不得被无身份调用)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    const res = await recordWorkcaseReview({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: appr.after.value.fingerprint,
      summary: "无身份复核",
      sessionSignature: SIG(),
      // 故意不传 sessionIdentity
    });
    assert.ok(!res.ok);
    assert.equal(res.error.code, "workcase/review_identity_unavailable");
  });
});

test("record_review: does not alter attempt, plan or scope (通道不授予其它写能力)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    const before = appr.after.value.frontmatter;
    const res = await recordWorkcaseReview({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: appr.after.value.fingerprint,
      summary: "只读复核结论。",
      sessionSignature: SIG(),
      sessionIdentity: REVIEWER(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    const after = read.value.frontmatter;
    assert.deepEqual(after.attempt, before.attempt, "record_review must not touch attempt");
    assert.deepEqual(after.plan, before.plan, "record_review must not touch plan");
    assert.equal(after.scope, before.scope, "record_review must not touch scope");
    assert.equal(after.status, "open");
  });
});


test("independence: a legacy attempt lacking session_source is backfilled only by the identity owner", async () => {
  // 存量对象：attempt 有 session_id 却无 session_source（本锚点之前写入）。关闭门禁
  // 要求条目两端来源俱为 "host"，故这类对象若不补齐就永远关不掉。补齐只允许**该身份
  // 本人**触发（他人不得代补），且补出的是「自证」而非对当初来源的追溯证明。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { created } = await createDraft(root);
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const ok = await approveWorkcaseObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: before.value.fingerprint,
      approver: "human-test", controller: "controller-a",
      changeSummary: "Gate 1 批准（存量：无来源）",
      sessionSignature: SIG(), sessionIdentity: IMPLEMENTER(),
    });
    assert.ok(ok.ok, JSON.stringify(ok.error));
    // 在**文件层**抹掉来源，模拟存量形态（经写入器抹会被其自身的补齐逻辑补回，
    // 那正是被测行为，故不能用它来构造前置状态）。
    const filePath = join(root, "workcases", `workcase-${created.value.object_uid}.md`);
    const rawText = await readFile(filePath, "utf8");
    await writeFile(filePath, rawText.replace(/^\s*session_source: host\n/m, ""), "utf8");
    let after = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(after.value.frontmatter.attempt.session_source, undefined, "前置：来源确实缺失");

    // 由**他人**心跳：不得代补（本人以外不补）
    const other = await executeWorkcaseObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: after.value.fingerprint, frontmatterAfter: { ...after.value.frontmatter },
      bodyMarkdownAfter: bodyWithoutH1(after.value.body), changeSummary: "他人心跳",
      sessionSignature: SIG(), sessionIdentity: IDENTITY("session-someone-else"),
    });
    assert.ok(other.ok, JSON.stringify(other.error));
    after = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(after.value.frontmatter.attempt.session_source, undefined, "他人不得代补来源");

    // 由**本人**心跳：补齐来源
    const owner = await executeWorkcaseObject({
      factSourceRoot: root, objectUid: created.value.object_uid,
      expectedFingerprint: after.value.fingerprint, frontmatterAfter: { ...after.value.frontmatter },
      bodyMarkdownAfter: bodyWithoutH1(after.value.body), changeSummary: "本人心跳（补齐来源）",
      sessionSignature: SIG(), sessionIdentity: IMPLEMENTER(),
    });
    assert.ok(owner.ok, JSON.stringify(owner.error));
    after = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(after.value.frontmatter.attempt.session_source, "host", "本人可补齐自身来源");
  });
});

test("independence: a source-less legacy entry is NOT laundered into host by a later write", async () => {
  // 本单自审发现并修正（2026-09-19）：来源若按「继承性补齐」，任何一条**没有来源**的
  // 条目都会被随后一次宿主写入洗白成 source="host"，从而计入独立性判据——那等于把
  // 「shell 身份可伪造」的缺口从后门放回来。故既有条目一律保留原值，缺失即缺失。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    // 在**文件层**注入一条「无来源」的既有条目（模拟经旧路径写入或直接改文件）
    const filePath = join(root, "workcases", `workcase-${appr.uid}.md`);
    const rawText = await readFile(filePath, "utf8");
    const injected = [
      "reviews:",
      "  - at: 2026-09-19T00:00:00.000Z",
      "    provider: p",
      "    model: m",
      "    summary: 旧条目（无来源）",
      "    session_id: session-OLD",
      "    implementer_session_id: session-implementer-test",
      "",
    ].join("\n");
    await writeFile(filePath, rawText.replace(/^change_log:/m, `${injected}change_log:`), "utf8");

    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.equal(before.value.frontmatter.reviews[0].session_source, undefined, "前置：该条目确实没有来源");

    // 由另一会话（host 来源）做一次写入：不得把上面那条的来源补齐
    const res = await executeWorkcaseObject({
      factSourceRoot: root, objectUid: appr.uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: { ...before.value.frontmatter },
      bodyMarkdownAfter: bodyWithoutH1(before.value.body),
      changeSummary: "另一会话写入（不得洗白既有条目来源）",
      sessionSignature: SIG(), sessionIdentity: IDENTITY("session-other-host"),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.equal(
      after.value.frontmatter.reviews[0].session_source,
      undefined,
      "无来源的既有条目不得被后续写入洗白为 host（否则该条目会被门禁误当作可采信证据）",
    );
  });
});

// ---------------------------------------------------------------------------
// reviews 保全（2026-09-27，实测缺陷）
//
// 三处缺陷由一次真实关闭准备暴露（workcase-364df30e 的 2026-09-22 复核条目被一次
// 心跳静默移除）。三者同在 reviews 的落盘与守卫路径上，故成组锁定。
// ---------------------------------------------------------------------------

test("reviews 保全: execute 漏传 reviews 时以落盘值为基线，历史复核条目不消失（2026-09-27）", async () => {
  // `next` 是调用方 payload 的克隆，除 Code 托管字段外一律以 payload 为准；而 `reviews`
  // 不在 Code 托管重写之列，故调用方漏传一步即把对象既有的复核流水整段覆盖为空。
  // 这是执行者最容易漏的一步：心跳的 payload 通常只关心 attempt。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    const rec = await recordWorkcaseReview({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: appr.after.value.fingerprint,
      summary: "对象：本单；基线：plan 判据；方法：隔离会话只读复核；覆盖：全部判据；未覆盖：无；发现：无；保证边界：仅静态核对。",
      sessionSignature: SIG(),
      sessionIdentity: REVIEWER(),
    });
    assert.ok(rec.ok, JSON.stringify(rec.error));
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.equal(before.value.frontmatter.reviews.length, 1, "前置：已有一条复核流水");

    const fm = { ...before.value.frontmatter };
    delete fm.reviews; // 刻意漏传
    const hb = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: bodyWithoutH1(before.value.body),
      changeSummary: "心跳（payload 未携带 reviews）",
      sessionSignature: SIG(),
      sessionIdentity: IMPLEMENTER(),
    });
    assert.ok(hb.ok, JSON.stringify(hb.error));
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.deepEqual(
      after.value.frontmatter.reviews,
      before.value.frontmatter.reviews,
      "payload 未携带 reviews 时，既有复核流水必须逐字保留（不得被覆盖为空）",
    );
  });
});

test("reviews 保全: 条目数减少的写入被拒绝并报告丢弃了几条（2026-09-27）", async () => {
  // 原 `assertReviewHistoryNotRewritten` 只逐条比对**同索引**条目的概要，对「整条消失」
  // 完全不敏感。21 §8 的 reviews 是复核流水，作废只走 `rebatch`（§9.2，且不经本守卫）。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    let uid = appr.uid;
    let cur = appr.after;
    const identities = [REVIEWER(), IDENTITY("session-reviewer-2")];
    for (const [i, summary] of ["第一条复核。", "第二条复核。"].entries()) {
      const rec = await recordWorkcaseReview({
        factSourceRoot: root,
        objectUid: uid,
        expectedFingerprint: cur.value.fingerprint,
        summary,
        sessionSignature: SIG(),
        sessionIdentity: identities[i],
      });
      assert.ok(rec.ok, JSON.stringify(rec.error));
      cur = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    }
    assert.equal(cur.value.frontmatter.reviews.length, 2, "前置：两条复核流水");

    const fm = { ...cur.value.frontmatter };
    fm.reviews = [fm.reviews[0]]; // 丢掉第二条
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: cur.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: bodyWithoutH1(cur.value.body),
      changeSummary: "试图丢弃一条复核流水",
      sessionSignature: SIG(),
      sessionIdentity: IMPLEMENTER(),
    });
    assert.ok(!res.ok, "条目数减少必须被拒绝");
    assert.equal(res.error.code, "workcase/review_history_rewritten");
    assert.ok(
      JSON.stringify(res.error).includes("drop 1 of 2 recorded entry"),
      `拒绝原因须说明丢弃了几条：${JSON.stringify(res.error)}`,
    );

    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after.value.frontmatter.reviews.length, 2, "拒绝即未落盘：流水仍为两条");
  });
});

test("independence: an identity-less legacy entry is NOT stamped with the writer's identity（2026-09-27）", async () => {
  // 与 `session_source` 同纪律：缺失就是缺失。原实现取 `storedSessionId ?? sessionId`，
  // 会把一条身份缺席的存量条目盖上「本次写入会话记录」的身份——该身份是假的（条目的
  // at/署名仍是历史值，记录者另有其人），且会随每次宿主写入继续漂移。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const appr = await approved(root);
    // 在**文件层**注入一条身份缺席的既有条目（模拟本锚点之前写入的存量形态；
    // 经写入器写入的条目必然带身份，故不能用它来构造前置状态）。
    const filePath = join(root, "workcases", `workcase-${appr.uid}.md`);
    const rawText = await readFile(filePath, "utf8");
    const injected = [
      "reviews:",
      "  - at: 2026-09-22T00:00:00.000Z",
      "    provider: workbuddy",
      "    model: deepseek-v4.1-flash",
      "    summary: 身份缺席的存量条目",
      "",
    ].join("\n");
    await writeFile(filePath, rawText.replace(/^change_log:/m, `${injected}change_log:`), "utf8");

    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.equal(before.value.frontmatter.reviews[0].session_id, undefined, "前置：该条目确实没有身份");

    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: appr.uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: { ...before.value.frontmatter },
      bodyMarkdownAfter: bodyWithoutH1(before.value.body),
      changeSummary: "宿主写入（不得给身份缺席的既有条目盖章）",
      sessionSignature: SIG(),
      sessionIdentity: IDENTITY("session-someone-else"),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: appr.uid });
    assert.equal(
      after.value.frontmatter.reviews[0].session_id,
      undefined,
      "身份缺席的既有条目不得被后续写入盖上当前写入者的身份（缺失即缺失，fail-closed）",
    );
    assert.equal(after.value.frontmatter.reviews[0].at, "2026-09-22T00:00:00.000Z", "历史时刻逐字保留");
    assert.equal(after.value.frontmatter.reviews[0].provider, "workbuddy", "历史署名逐字保留");
  });
});

// ---------------------------------------------------------------------------
// 21 §8 书写纪律：summary / scope 的结构化书写（机械校验）
//
// 实测缺陷（2026-09-20）：16/16 份对象的 summary/scope 都是单块整段（最长 1123
// 字符、零换行），而同一份文件的「计划」节 15/16 份用了列表——差别在字段类型：
// plan 是数组（schema 强制逐项），自由字符串没有任何结构约定。本组用例守住新
// 规则的两个方向：不合规必须拒绝、合规必须通过。
// ---------------------------------------------------------------------------
const LONG_PAD = "并逐条说明其依据与未覆盖范围，使后续执行者无需回读原讨论即可独立接手".repeat(3);
const LONG_FLAT_SUMMARY = `把复核独立性升级为硬门禁：凡关闭必须至少一条独立结论；${LONG_PAD}；${LONG_PAD}。`;
const SCOPE_OK = "做什么：\n- 建立身份锚点\n- 补行为测试\n\n明确不做什么：\n- 不改 C2 授权钉扎";
const SCOPE_INLINE = "做什么：(A) 建立锚点；(B) 补测试。明确不做什么：不改 C2。";

function writingCase(overrides = {}) {
  const base = {
    fact_type_key: "workcase",
    object_uid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    title: "书写纪律用例",
    status: "draft",
    gist: "给 Human 扫读的一句话要点。",
    summary: "短摘要。",
    scope: SCOPE_OK,
    plan: [{ step: "一步", done_criteria: "判据" }],
    created_at: "2026-01-01T00:00:00+08:00",
    change_log: [{ at: "2026-01-01T00:00:00+08:00", summary: "create" }],
  };
  return { ...base, ...overrides };
}

test("写作纪律: scope 须两段标签各占一行 —— 行内串联被拒 (21 §8)", () => {
  const inline = validateWorkcaseFrontmatter(writingCase({ scope: SCOPE_INLINE }));
  assert.equal(inline.ok, false, "行内串联的 scope 必须被拒（它语义回答了，但读不出版面层次）");
  assert.ok(
    inline.issues.some((i) => i.includes('"做什么："')),
    `应报告缺独占一行的「做什么：」，实际：${JSON.stringify(inline.issues)}`,
  );

  const twoLine = validateWorkcaseFrontmatter(writingCase({ scope: SCOPE_OK }));
  assert.equal(twoLine.ok, true, `两段标签须通过，实际：${JSON.stringify(twoLine.issues)}`);
});

test("写作纪律: scope 标签下不得为空 (21 §8)", () => {
  const empty = validateWorkcaseFrontmatter(writingCase({ scope: "做什么：\n\n明确不做什么：\n- b" }));
  assert.equal(empty.ok, false);
  assert.ok(empty.issues.some((i) => i.includes("has no content")), JSON.stringify(empty.issues));
});

test("写作纪律: 阈值以内不强制分块 —— 短文本豁免 (21 §8)", () => {
  // 短 summary：单块也合规。规则要的是可读，不是形式主义。
  const short = validateWorkcaseFrontmatter(writingCase({ summary: "短摘要，不分块。" }));
  assert.equal(short.ok, true, `短文本不应被要求分块，实际：${JSON.stringify(short.issues)}`);

  // 同一份文本超过阈值后，单块即不合规。
  const long = validateWorkcaseFrontmatter(writingCase({ summary: LONG_FLAT_SUMMARY }));
  assert.equal(long.ok, false, "超过阈值仍为单块必须被拒");
  assert.ok(long.issues.some((i) => i.includes("single block")), JSON.stringify(long.issues));
});

test("写作纪律: 长文本分块后，首块之外的每块须以 ### 开头 (21 §8 书写结构，Human 裁定 2026-09-22)", () => {
  // 分块后的块首用例必须**真的超过 200 阈值**，否则会被短文本豁免放行，
  // 断言就成了空转（本用例初版即踩此坑：加粗用例总长仅 135，误判为「被接受」）。
  const LONG = LONG_PAD.repeat(3); // >200
  const tail = `\n\n### 处置方向\n- 乙${LONG}`;

  // 分了块但无骨架 —— 分块本身不产生可读性收益，须拒。
  const unheaded = validateWorkcaseFrontmatter(writingCase({ summary: `总述一段。${LONG}\n\n${LONG}` }));
  assert.equal(unheaded.ok, false, "分块但块首无骨架必须被拒");
  assert.ok(unheaded.issues.some((i) => i.includes("fixed head")), JSON.stringify(unheaded.issues));

  // 目标形态：H3 —— 唯一被接受的形式。
  const h3 = validateWorkcaseFrontmatter(
    writingCase({ summary: `总述一段。${LONG}\n\n### 现状核实\n- 甲${tail}` }),
  );
  assert.equal(h3.ok, true, `H3 骨架应被接受，实际：${JSON.stringify(h3.issues)}`);

  // **反回退守卫**（本用例的主要价值）：曾被接受的两种形式现已不合规。
  // 三种在**呈现层并不等价**——`**标签**` 后的单个换行不产生新段落（react-markdown
  // 实测仍在同一 <p> 内，只是标签加粗），`标签：` 更是无任何标记。故允许三种等于
  // 允许两种读者看不出层次的写法。此断言钉住该裁定；若有人把它们改回「接受」，
  // 本用例必须变红。
  for (const [name, text] of [
    ["加粗", `总述一段。${LONG}\n\n**现状核实**\n- 甲${tail}`],
    ["冒号", `总述一段。${LONG}\n\n现状核实：\n- 甲${tail}`],
  ]) {
    assert.ok(text.length > 200, `${name}用例须超过 200 阈值，否则断言空转（实际 ${text.length}）`);
    const r = validateWorkcaseFrontmatter(writingCase({ summary: text }));
    assert.equal(r.ok, false, `${name}骨架不得被接受——它在呈现层分不出块（21 §8 书写结构）`);
    assert.ok(r.issues.some((i) => i.includes("fixed head")), JSON.stringify(r.issues));
  }

  // 首块不受骨架约束（它是总述，节点标题已说明它是什么）；短文本仍豁免分块。
  const short = validateWorkcaseFrontmatter(writingCase({ summary: "短摘要，不分块。" }));
  assert.equal(short.ok, true, `短文本应豁免，实际：${JSON.stringify(short.issues)}`);
});

test("写作纪律: scope 的块首是闭集 —— 只认 H3 与两个已登记标签 (21 §8)", () => {
  const LONG = LONG_PAD.repeat(3);
  // scope 的语义骨架（做什么／明确不做什么）是字段定义的一部分，仍是合法块首。
  // 长文放在第二个块内，使全字段 > 200 且只有两个块。
  const withLabels = validateWorkcaseFrontmatter(writingCase({
    scope: `做什么：\n- 甲\n\n明确不做什么：\n- 乙\n- ${LONG}`,
  }));
  assert.equal(withLabels.ok, true, `两个标签行应作合法块首，实际：${JSON.stringify(withLabels.issues)}`);

  // 但**任意 `XX：` 行不再构成块首** —— 那正是本次收敛掉的宽松形态。
  const arbitrary = validateWorkcaseFrontmatter(writingCase({
    scope: `做什么：\n- 甲\n\n明确不做什么：\n- 乙\n\n其他事项：\n- 丙\n- ${LONG}`,
  }));
  assert.equal(arbitrary.ok, false, "任意「XX：」不得充当块首（scope 块首是闭集）");
  assert.ok(arbitrary.issues.some((i) => i.includes("fixed head")), JSON.stringify(arbitrary.issues));
});

test("写作纪律: H3 是块级元素，故块首由 H3 承担 —— 渲染层等价性回归 (21 §8)", () => {
  // 本用例把「为什么只有 H3」的依据固定下来：不是风格偏好，而是渲染语义。
  // react-markdown（CommonMark）中，H3 是块级元素而 **加粗** 不是——后者与其后的
  // 正文同处一个 <p>，单个换行只是软换行。若哪天渲染层改为「软换行即断段」，
  // 本测试提醒复核该裁定是否仍然成立。
  const md = `### 现状核实\nreviews 取自路由记录。`;
  assert.match(md, /^###[ \t]+\S/m, "块首须为 H3 行");
  // 骨架行与正文分行：`### 标签` 独占一行。
  const [head] = md.split("\n");
  assert.equal(head.trim(), "### 现状核实");
});

test("写作纪律: 存量豁免 —— 字段逐字未改放行，改动即受检 (21 §8 适用范围)", () => {
  const legacyScope = SCOPE_INLINE;
  const legacySummary = LONG_FLAT_SUMMARY;

  // ① 逐字未改（基线相同）→ 放行。否则存量对象连追加 change_log 都会被拒，
  //    而 close 是唯一出口、本类型无删除操作（21 §14）→ 工单永久无法关闭。
  const unchanged = validateWorkcaseFrontmatter(
    writingCase({ scope: legacyScope, summary: legacySummary }),
    null, legacySummary, legacyScope,
  );
  assert.equal(unchanged.ok, true, `逐字未改须放行（否则存量死锁），实际：${JSON.stringify(unchanged.issues)}`);

  // ② 改动 summary（哪怕一字）→ 重新受检。
  const summaryChanged = validateWorkcaseFrontmatter(
    writingCase({ scope: legacyScope, summary: `${legacySummary}（改）` }),
    null, legacySummary, legacyScope,
  );
  assert.equal(summaryChanged.ok, false, "改动后的 summary 必须受检");
  assert.ok(summaryChanged.issues.some((i) => i.startsWith("summary:")), JSON.stringify(summaryChanged.issues));

  // ③ 改动 scope → 重新受检（既有两个标签的语义未变，但形态须补齐）。
  const scopeChanged = validateWorkcaseFrontmatter(
    writingCase({ scope: `${legacyScope}（改）`, summary: legacySummary }),
    null, legacySummary, legacyScope,
  );
  assert.equal(scopeChanged.ok, false, "改动后的 scope 必须受检");

  // ④ 无基线（新建）→ 全量受检。
  const created = validateWorkcaseFrontmatter(
    writingCase({ scope: legacyScope, summary: legacySummary }),
    null, undefined, undefined,
  );
  assert.equal(created.ok, false, "新建对象无基线，须全量受检");
});

const GOAL_STUB = "---\ngoal_key: project-goal\ntitle: T\nstatus: active\ncreated_at: 2026-01-01T00:00:00+08:00\nchange_log:\n  - at: 2026-01-01T00:00:00+08:00\n    summary: x\n---\n\n# T\n\n## 子目标\n- SG-3 t\n";

test("写作纪律: 端到端 —— 合规写法可落盘且正文逐字承载 (21 §8)", async () => {
  await withTemp("wc-writing-", async (root) => {
  await mkdir(join(root, "workcases"), { recursive: true });
  await writeFile(join(root, "goal.md"), GOAL_STUB);

  const summary = "总述一段。\n\n**现状核实**\n- 甲\n\n**处置方向**\n- 乙";
  const res = await createWorkcaseObject({
    factSourceRoot: root,
    frontmatterDraft: { title: "合规写法", gist: "要点。", summary, scope: SCOPE_OK, plan: [{ step: "一步", done_criteria: "判据" }] },
    bodyMarkdown: `## 摘要\n${summary}\n\n## 授权范围\n${SCOPE_OK}\n\n## 计划\n- 一步：判据——判据\n`,
    sessionSignature: SIG(),
  });
  assert.ok(res.ok, JSON.stringify(res.error));
  const back = await readWorkcaseObject({ factSourceRoot: root, objectUid: res.value.object_uid });
  assert.equal(back.value.frontmatter.scope, SCOPE_OK, "结构化 scope 须逐字无损往返");
  assert.equal(back.value.frontmatter.summary, summary, "结构化 summary 须逐字无损往返");
  });
});

test("写作纪律: 端到端 —— 不合规写法在 create 被拒 (21 §8)", async () => {
  await withTemp("wc-writing-bad-", async (root) => {
  await mkdir(join(root, "workcases"), { recursive: true });
  await writeFile(join(root, "goal.md"), GOAL_STUB);

  const res = await createWorkcaseObject({
    factSourceRoot: root,
    frontmatterDraft: { title: "不合规写法", gist: "要点。", summary: LONG_FLAT_SUMMARY, scope: SCOPE_INLINE, plan: [{ step: "一步", done_criteria: "判据" }] },
    bodyMarkdown: `## 摘要\n${LONG_FLAT_SUMMARY}\n\n## 授权范围\n${SCOPE_INLINE}\n\n## 计划\n- 一步：判据——判据\n`,
    sessionSignature: SIG(),
  });
  assert.equal(res.ok, false, "行内 scope + 单块长 summary 不得通过创建");
  assert.equal(res.error.code, "workcase/frontmatter_invalid");
  });
});

// ---------------------------------------------------------------------------
// 取消记录完备性（21 §8 / §15.1，Human 2026-09-24）
// ---------------------------------------------------------------------------
// 规范原文（§9.2「`result` 记录取消理由与未发生的范围」/ §9.3 cancelled「记录取消理由
// 与实际未发生的范围」）早已要求这两件事，但此前**没有任何机械锚点**：`validateResult`
// 只要求 `achieved_scope` 非空，故「本工单取消」四字同样通过写入。本组用例锁定新接上
// 的机械判据——判据取 **outcome 值**而非 action（`close` 的 outcome 也可为 cancelled）。

const CANCEL_OK_BODY = (base) =>
  `${base}\n\n## 结果\n\n- cancellation:\n  - **理由**：方向调整。\n  - **未发生的范围**：三步全未执行。\n`;

test("cancel: outcome=cancelled 缺取消记录段时拒绝写入（21 §8）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { created, draft } = await createDraft(root);
    const read0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const res = await cancelWorkcaseObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: read0.value.fingerprint,
      result: { achieved_scope: "未执行，无已证实范围。" },
      changeSummary: "取消",
      // 只有一句叙述，没有 `- cancellation:` 段——旧实现会放行
      bodyMarkdownAfter: `${draftBody(draft)}\n\n## 结果\n\n- 工单被取消。\n`,
      sessionSignature: SIG(),
    });
    assert.ok(!res.ok, "缺取消记录段必须被拒");
    assert.equal(res.error.code, "workcase/body_invalid");
    assert.ok(
      JSON.stringify(res.error.details.issues).includes("cancellation record"),
      JSON.stringify(res.error.details.issues),
    );
  });
});

test("cancel: 取消记录缺任一行时拒绝写入（21 §8 两行均必填）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    for (const [label, body] of [
      ["缺理由", `${draftBody((await createDraft(root)).draft)}\n\n## 结果\n\n- cancellation:\n  - **未发生的范围**：三步全未执行。\n`],
      ["缺未发生的范围", `${draftBody((await createDraft(root)).draft)}\n\n## 结果\n\n- cancellation:\n  - **理由**：方向调整。\n`],
      ["理由为空", `${draftBody((await createDraft(root)).draft)}\n\n## 结果\n\n- cancellation:\n  - **理由**：   \n  - **未发生的范围**：三步全未执行。\n`],
    ]) {
      const { created } = await createDraft(root);
      const read0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
      const res = await cancelWorkcaseObject({
        factSourceRoot: root,
        objectUid: created.value.object_uid,
        expectedFingerprint: read0.value.fingerprint,
        result: { achieved_scope: "未执行，无已证实范围。" },
        changeSummary: "取消",
        bodyMarkdownAfter: body,
        sessionSignature: SIG(),
      });
      assert.ok(!res.ok, `${label} 必须被拒`);
      assert.equal(res.error.code, "workcase/body_invalid", label);
    }
  });
});

test("cancel: 两行齐备时放行，且取消记录逐字落盘（21 §8）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { created, draft } = await createDraft(root);
    const read0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    const res = await cancelWorkcaseObject({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: read0.value.fingerprint,
      result: { achieved_scope: "未执行，无已证实范围。" },
      changeSummary: "取消",
      bodyMarkdownAfter: CANCEL_OK_BODY(draftBody(draft)),
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: created.value.object_uid });
    assert.equal(read.value.mechanical_issues.length, 0, JSON.stringify(read.value.mechanical_issues));
    assert.match(read.value.body, /- cancellation:/);
    assert.match(read.value.body, /\*\*理由\*\*：方向调整。/);
    assert.match(read.value.body, /\*\*未发生的范围\*\*：三步全未执行。/);
  });
});

test("cancel: 非取消对象不要求取消记录（判据取 outcome，不误伤其它路径）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await approved(root);
    // open 对象写结果节（Gate 2 提案形态），无取消记录——不得被拒
    const res = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: after.value.frontmatter,
      bodyMarkdownAfter: `${bodyWithoutH1(after.value.body)}\n\n## 结果\n\n- criteria_checks:\n  - 步骤 1 判据「x」：达成——证据：y。\n`,
      changeSummary: "写关闭提案",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
  });
});

// 去向完整性 — validateDirectionCompleteness（21 §8/§12/§15.1，2026-09-28 二次修订）
//
// Human 裁决 2026-09-28：去向词由四词收为二词（接受现状 / 转入 Spark）；
// **2026-09-28 二次修订把形态由「两段分离」改为「主从一段」**——去向不再是独立的一段，
// 而是**长在每条残留里面**（§8）：`- residual:` 段下每条残留条目自带一个更深一层的
// 去向子项。硬门禁由五组改为**六组**（编号与 §8「综上」段及 §15.1 逐字一致）：
//   ① 残留段恰好一处（**状态无关**）；
//   ② 残留段条目数 = result.residual 长度（residual 空则不得有残留段）；
//   ③ 每条残留恰有一个去向子项（子项须比残留条目更深）；
//   ④ 每条「转入 Spark」恰有一条 routed-to（**条数一致**）；
//   ⑤ 每条「接受现状」的去向正文非空；
//   ⑥ 每条去向词落在闭集二词内（不达形态者按零条计，不静默丢弃）。
// 另有**形态前提**（不在六组门禁之列）：§8 明文「不再另设独立的建议段」——正文出现
// `- advice:`／`- 建议:` 即拒绝。
// **顺序对应不在机械范围内**：去向子项只写去向词与正文，不携带目标 Spark 标识或
// residual 条目标识，任何按位置定义的顺序在机械上等价（§15.1 已同口径登记）。
// 软约束（去向是否恰当、理由是否成立、是否构成实质挂起、去向正文是否自足、目标 Spark
// 是否语义上真的容纳该残留）归 AI 与 Human，本函数不判——故下列用例只断言结构性事实，
// 不把语义判断写成机械门禁。
// ---------------------------------------------------------------------------

/** 单元级载荷：本函数只读 `## 结果` 节与 frontmatter，正文其余部分不参与判定。 */
const resultOnlyBody = (...lines) => `# T\n\n## 结果\n\n${lines.join("\n")}\n`;

const closedFmWith = (residual, relations = undefined) => ({
  status: "closed",
  outcome: "partial",
  result: { criteria_checks: [], achieved_scope: "部分达成。", residual },
  ...(relations === undefined ? {} : { relations }),
});

const ROUTED = (uid) => ({ relation_key: "routed-to", target: { object_uid: uid } });

// 关系去重的另一侧（21 §15.1「关系闭集」条，2026-09-28 登记）：`contributed-to` 无逐条
// 对应义务，同键同目标仍是同义重复——故它与 `routed-to` 的「允许同键同目标重复」是
// **两条不同的口径**，用例必须成对存在，否则无法区分「按 key 分派」与「一律去重」。
const PITFALL_UID = "11111111-2222-4333-8444-555555555555";
const CONTRIBUTED = (uid) => ({ relation_key: "contributed-to", target: { object_uid: uid } });

/**
 * 合并式残留段（§8 登记形态）：每条残留之下一个更深一层的去向子项。
 * 参数是 `[残留正文, 去向条目或 null]` 对；`null` 表示该残留**没有**去向子项
 * （用于验证门禁③的拒绝路径）。
 */
const residualBlock = (pairs) => {
  const lines = ["- residual:"];
  for (const [residual, direction] of pairs) {
    lines.push(`  - ${residual}`);
    if (direction !== null && direction !== undefined) lines.push(`    - ${direction}`);
  }
  return lines;
};

test("direction: ① 状态无关——非 closed/cancelled 不参与 ②–⑥，但 ① 与「不得另设独立建议段」始终适用", () => {
  // 六组门禁的适用面分两层（21 §15.1，2026-09-28 二次修订）：
  //   ②–⑥（条数／每条残留一个去向／routed-to／非空理由／去向词闭集）——只在 closed
  //        且非 cancelled 判定；
  //   ①（残留段恰好一处）——**状态无关**，凡「## 结果」节出现残留段即适用。
  // 理由：残留段正是开放期写入的承载（§8）。若 ① 也随状态缺省，多段正文可在 open 期
  // 经受控入口落盘，而两处解析器都只读一段 → 第 2 段条目「正文里有、卡面不可见」，
  // 直到关闭才被拦（§15.1 已登记该理由）。
  const single = resultOnlyBody(...residualBlock([["残留 A", "**接受现状**：不跟踪。"]]));
  for (const status of ["draft", "open"]) {
    const res = validateDirectionCompleteness({ status, result: { residual: [] } }, single);
    assert.deepEqual(res, { ok: true, issues: [] }, `${status} 下单一残留段不受 ②–⑥ 约束`);
  }
  // cancelled 走 §9.3 的取消记录，②–⑥ 不适用（21 §9.1/§15.1）。
  const cancelled = validateDirectionCompleteness(
    { status: "closed", outcome: "cancelled", result: { residual: [] } },
    single,
  );
  assert.deepEqual(cancelled, { ok: true, issues: [] });

  // ① 的对照：同一「非 closed」状态 + 两处开启符 → 必须被拒（不能因状态而放行）。
  const twoBlocks = resultOnlyBody(
    ...residualBlock([["残留 A", "**接受现状**：甲。"]]),
    ...residualBlock([["残留 B", "**接受现状**：乙。"]]),
  );
  for (const status of ["draft", "open"]) {
    const res = validateDirectionCompleteness({ status, result: { residual: [] } }, twoBlocks);
    assert.ok(!res.ok, `${status} 下两处残留段开启符必须被拒（① 状态无关）`);
    assert.equal(res.issues.length, 1, JSON.stringify(res.issues));
    assert.match(res.issues[0], /门禁① "## 结果" 残留段 must appear exactly once — found 2 residual section openers/);
  }
  const cancelledTwo = validateDirectionCompleteness(
    { status: "closed", outcome: "cancelled", result: { residual: [] } },
    twoBlocks,
  );
  assert.ok(!cancelledTwo.ok, "cancelled 也不豁免 ① —— 否则取消记录期同样可落多段正文");

  // 「不得另设独立建议段」同为状态无关的**形态前提**（不在六组门禁之列）。
  const legacyAdvice = resultOnlyBody("- advice:", "  - **接受现状**：旧形态。");
  for (const status of ["draft", "open"]) {
    const res = validateDirectionCompleteness({ status, result: { residual: [] } }, legacyAdvice);
    assert.ok(!res.ok, `${status} 下独立建议段必须被拒（§8 形态前提，状态无关）`);
    assert.equal(res.issues.length, 1, JSON.stringify(res.issues));
    assert.match(res.issues[0], /不得另设独立的建议段 — found 1 advice section opener/);
    assert.match(res.issues[0], /可操作处置：删去该段/);
  }
});

test("direction: ② residual 为空且无残留段时通过（completed 的正常形态）", () => {
  const res = validateDirectionCompleteness(closedFmWith([]), resultOnlyBody("- 判据均达成。"));
  assert.ok(res.ok, JSON.stringify(res.issues));
});

test("direction: ② residual 为空却写了残留段 → 拒绝（21 §8 字段间不变量）", () => {
  const res = validateDirectionCompleteness(
    closedFmWith([]),
    resultOnlyBody(...residualBlock([["残留 A", "**接受现状**：不跟踪。"]])),
  );
  assert.ok(!res.ok);
  assert.equal(res.issues.length, 1, JSON.stringify(res.issues));
  assert.match(res.issues[0], /门禁② "## 结果" 残留段 must not exist when result\.residual is empty/);
  assert.match(res.issues[0], /got 1 residual entry/);
});

test("direction: ② 残留段条数必须等于 residual 长度——多写少写都被拒（21 §8/§15.1）", () => {
  const one = resultOnlyBody(...residualBlock([["残留 A", "**接受现状**：原因甲。"]]));
  const two = resultOnlyBody(
    ...residualBlock([
      ["残留 A", "**接受现状**：原因甲。"],
      ["残留 B", "**接受现状**：原因乙。"],
    ]),
  );

  const tooFew = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B"]), one);
  assert.ok(!tooFew.ok);
  assert.ok(tooFew.issues.some((i) => /门禁②.*must carry exactly 2 entr.*got 1/s.test(i)), JSON.stringify(tooFew.issues));

  const tooMany = validateDirectionCompleteness(closedFmWith(["残留 A"]), two);
  assert.ok(!tooMany.ok);
  assert.ok(tooMany.issues.some((i) => /门禁②.*must carry exactly 1 entry.*got 2/s.test(i)), JSON.stringify(tooMany.issues));

  const exact = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B"]), two);
  assert.ok(exact.ok, JSON.stringify(exact.issues));
});

test("direction: ③ 每条残留恰有一个去向子项——缺子项被拒，失败文案指向「残留 N 条但去向子项 M 条」（21 §15.1 判据边界）", () => {
  // §15.1 判据边界第二条：残留条目缩进正确、但其下没有更深层的去向条目时，拒绝发生在
  // **门禁③**，文案指向条数对照；这与「条数不符」（门禁②）是**不同的拒绝路径**。
  const missing = resultOnlyBody(...residualBlock([["残留 A", null]]));
  const res = validateDirectionCompleteness(closedFmWith(["残留 A"]), missing);
  assert.ok(!res.ok, "缺去向子项必须被拒");
  assert.ok(
    res.issues.some((i) => /门禁③ each residual entry must carry exactly one direction sub-item/.test(i)),
    JSON.stringify(res.issues),
  );
  assert.ok(
    res.issues.some((i) => /残留 1 条但去向子项 0 条/.test(i)),
    `失败文案须指向「残留 N 条但去向子项 M 条」：${JSON.stringify(res.issues)}`,
  );
  // 归因固定：② 的条数相符（1 = 1），故不得同时报条数门禁——两条路径必须分得开。
  // 判据取门禁②的**报告前缀**（`门禁② "## 结果" 残留段`）而非裸 `门禁②`：③ 的文案里
  // 有一句「本条与门禁②的失败码不同」是在**解释两条路径的区别**，不是②的报告。
  assert.ok(
    !res.issues.some((i) => i.includes('门禁② "## 结果" 残留段')),
    `条数相符时不得报②（拒绝归因须唯一）：${JSON.stringify(res.issues)}`,
  );

  // 多于一个子项同样被拒（「恰有一个」）。
  const doubled = resultOnlyBody(
    "- residual:",
    "  - 残留 A",
    "    - **接受现状**：原因甲。",
    "    - **接受现状**：原因乙。",
  );
  const two = validateDirectionCompleteness(closedFmWith(["残留 A"]), doubled);
  assert.ok(!two.ok, "多于一个去向子项必须被拒");
  assert.ok(two.issues.some((i) => /第 1 条残留有 2 个去向子项/.test(i)), JSON.stringify(two.issues));

  // 对照：恰一个子项即通过（避免上两条因解析全面失效而空转）。
  const ok = validateDirectionCompleteness(
    closedFmWith(["残留 A"]),
    resultOnlyBody(...residualBlock([["残留 A", "**接受现状**：该分支已被后续工作覆盖，继续跟踪无增量。"]]),
    ),
  );
  assert.ok(ok.ok, JSON.stringify(ok.issues));
});

test("direction: ③ 多残留下逐条配对——第 k 条去向挂第 k 条残留（主从由结构承载，不是按序约定）", () => {
  // §8：去向子项与残留条目是**主从关系**，结构上不可分离——「第 k 条去向 ↔ 第 k 条
  // 残留」的对应**由形态本身承载**，不再是需要核验的写法约定。
  const body = resultOnlyBody(
    ...residualBlock([
      ["残留 A", "**接受现状**：原因甲。"],
      ["残留 B", "**转入 Spark**：转入议题待裁。"],
      ["残留 C", "**接受现状**：原因丙。"],
    ]),
  );
  const uid = "22222222-3333-4444-8555-666666666666";
  const res = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B", "残留 C"], [ROUTED(uid)]), body);
  assert.ok(res.ok, JSON.stringify(res.issues));

  // 交换两条残留的顺序不影响结果——对应由结构承载，故**不存在**「错配」这一失败态
  // （这正是合并式相对分离式的收益：计数对齐只能防总数错、不能防错配）。
  const swapped = resultOnlyBody(
    ...residualBlock([
      ["残留 C", "**接受现状**：原因丙。"],
      ["残留 B", "**转入 Spark**：转入议题待裁。"],
      ["残留 A", "**接受现状**：原因甲。"],
    ]),
  );
  assert.ok(validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B", "残留 C"], [ROUTED(uid)]), swapped).ok);
});

test("direction: ⑥ 去向词不在闭集内 → 拒绝；存量两词（另立工单/直接行动）已不是闭集取值", () => {
  const body = resultOnlyBody(
    ...residualBlock([
      ["残留 A", "**另立工单**：把该分支另立一单。"],
      ["残留 B", "**直接行动**：后续清理时顺手处置。"],
    ]),
  );
  const res = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B"]), body);
  assert.ok(!res.ok);
  const closedSetIssues = res.issues.filter((i) => i.includes("is not one of the closed set"));
  assert.equal(closedSetIssues.length, 2, JSON.stringify(res.issues));
  assert.match(closedSetIssues[0], /门禁⑥ 残留\[1\] 去向子项\[0\] 去向词 "另立工单"/);
  assert.match(closedSetIssues[1], /门禁⑥ 残留\[2\] 去向子项\[1\] 去向词 "直接行动"/);
});

test("direction: ⑥ 去向条目形态失败 → 计入子项数 → 闭集分支拒绝（不是「条数不符」）（21 §15.1 判据边界第三条）", () => {
  // §15.1 判据边界第三条（含实测）：去向条目深度正确、但不达
  // `- **<去向词>**：<正文>` 形态（如缺 `**` 包裹）时，**该条目不被丢弃、照常计入
  // 子项数**；拒绝发生在**去向词闭集分支**（门禁⑥），**不是**条数不符。
  // 实测：residual = 1、正文写 `    - 接受现状：就此了结，原因是策略已变。`（无 `**`）
  // → 报的是闭集分支消息。
  const body = resultOnlyBody(
    "- residual:",
    "  - 残留 A",
    "    - 接受现状：就此了结，原因是策略已变。",
  );
  const res = validateDirectionCompleteness(closedFmWith(["残留 A"]), body);
  assert.ok(!res.ok);
  assert.ok(
    res.issues.some((i) => /门禁⑥.*does not match the registered form/.test(i)),
    JSON.stringify(res.issues),
  );
  // 判据边界明文要求：读者不得据此推断出「条数不符」的失败码归因。
  assert.ok(
    !res.issues.some((i) => i.includes('门禁② "## 结果" 残留段') || i.includes("门禁③ each residual entry")),
    `不得报条数/子项数门禁（该条目照常计入子项数）：${JSON.stringify(res.issues)}`,
  );
  // 用原文前 40 字符作诊断，读者能认出是哪一条。
  assert.ok(res.issues.some((i) => /接受现状：就此了结，原因是策略已变。/.test(i)), JSON.stringify(res.issues));
});

test("direction: ⑤ 「接受现状」必须带非空理由（去空白后长度 > 0）（21 §8/§15.1）", () => {
  const empty = validateDirectionCompleteness(
    closedFmWith(["残留 A"]),
    resultOnlyBody(...residualBlock([["残留 A", "**接受现状**："]])),
  );
  assert.ok(!empty.ok);
  assert.ok(empty.issues.some((i) => /门禁⑤.*「接受现状」 must carry a non-empty reason/.test(i)), JSON.stringify(empty.issues));

  const blank = validateDirectionCompleteness(
    closedFmWith(["残留 A"]),
    resultOnlyBody(...residualBlock([["残留 A", "**接受现状**：   "]])),
  );
  assert.ok(!blank.ok, "全空白不算理由");

  // 已登记的上限（§15.1 实际接受集④）：非空判定就是「去空白后长度 > 0」，
  // 故 `：。` 通过——这是本项已登记的口径，不属缺陷；但不得据此认为理由在语义上成立。
  const punctuation = validateDirectionCompleteness(
    closedFmWith(["残留 A"]),
    resultOnlyBody(...residualBlock([["残留 A", "**接受现状**：。"]])),
  );
  assert.ok(punctuation.ok, JSON.stringify(punctuation.issues));

  const ok = validateDirectionCompleteness(
    closedFmWith(["残留 A"]),
    resultOnlyBody(...residualBlock([["残留 A", "**接受现状**：该分支已被后续工作覆盖，继续跟踪无增量。"]])),
  );
  assert.ok(ok.ok, JSON.stringify(ok.issues));
});

test("direction: ④ 「转入 Spark」须有恰好一条 routed-to——缺、多、都对不上（21 §8/§12/§15.1）", () => {
  const uidA = "22222222-3333-4444-8555-666666666666";
  const uidB = "33333333-4444-4555-8666-777777777777";
  const oneTransfer = resultOnlyBody(...residualBlock([["残留 A", "**转入 Spark**：把该残留转入议题待裁。"]]));

  const missing = validateDirectionCompleteness(closedFmWith(["残留 A"]), oneTransfer);
  assert.ok(!missing.ok);
  assert.ok(
    missing.issues.some((i) => /门禁④.*carries 1 「转入 Spark」 entry but relations carries 0 routed-to/.test(i)),
    JSON.stringify(missing.issues),
  );

  const surplus = validateDirectionCompleteness(closedFmWith(["残留 A"], [ROUTED(uidA), ROUTED(uidB)]), oneTransfer);
  assert.ok(!surplus.ok);
  assert.ok(
    surplus.issues.some((i) => /carries 1 「转入 Spark」 entry but relations carries 2 routed-to/.test(i)),
    JSON.stringify(surplus.issues),
  );

  const matched = validateDirectionCompleteness(closedFmWith(["残留 A"], [ROUTED(uidA)]), oneTransfer);
  assert.ok(matched.ok, JSON.stringify(matched.issues));
});

test("direction: ④ routed-to 之外的 relations（contributed-to）不计入去向配对", () => {
  const uid = "22222222-3333-4444-8555-666666666666";
  const body = resultOnlyBody(...residualBlock([["残留 A", "**转入 Spark**：把该残留转入议题待裁。"]]));
  const res = validateDirectionCompleteness(
    closedFmWith(["残留 A"], [{ relation_key: "contributed-to", target: { object_uid: uid } }]),
    body,
  );
  assert.ok(!res.ok, "contributed-to 不能被当成去向承载");
  assert.ok(res.issues.some((i) => /relations carries 0 routed-to/.test(i)), JSON.stringify(res.issues));
});

test("direction: ① 开启符变体（冒号可省 / 残留责任）均被识别（§15.1 实际接受集②）", () => {
  for (const opener of ["- residual", "- 残留责任", "- 残留责任："]) {
    const body = `# T\n\n## 结果\n\n${opener}\n  - 残留 A\n    - **接受现状**：原因甲。\n`;
    const ok = validateDirectionCompleteness(closedFmWith(["残留 A"]), body);
    assert.ok(ok.ok, `开启符「${opener}」须被识别：${JSON.stringify(ok.issues)}`);
  }
  // 两处开启符（其一为变体）仍须被①拒绝——变体不得成为绕过通道。
  const twoVariants = `# T\n\n## 结果\n\n- residual:\n  - 残留 A\n    - **接受现状**：原因甲。\n- 残留责任\n  - 残留 B\n    - **接受现状**：原因乙。\n`;
  const res = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B"]), twoVariants);
  assert.ok(!res.ok);
  assert.ok(res.issues.some((i) => /must appear exactly once — found 2/.test(i)), JSON.stringify(res.issues));
});

test("direction: ① 残留段多于一处时不得择一推断条数（21 §15.1 2026-09-28 更正）", () => {
  // §15.1 明文：本节此前把多残段登记为「出现两段时后段覆盖前段、条数按后段计」，该项
  // **不成立**——多段形态下「该读哪一段」在规范上没有依据。故多段整体由①拒绝，
  // 且**不得择一推断条数**：即便某一段条数恰好相符，也照样拒绝。
  const two = resultOnlyBody(
    ...residualBlock([["残留 A", "**接受现状**：原因甲。"]]),
    ...residualBlock([["残留 B", "**接受现状**：原因乙。"]]),
  );
  // 首段条数与 residual 相符（1 条）→ 仍须被拒（条数不是①的判据）。
  const counted = validateDirectionCompleteness(closedFmWith(["残留 A"]), two);
  assert.ok(!counted.ok, "两处残留段必须被拒，哪怕首段条数恰好相符");
  assert.equal(counted.issues.length, 1, JSON.stringify(counted.issues));
  assert.match(counted.issues[0], /门禁①.*must appear exactly once — found 2 residual section openers/);
  assert.match(counted.issues[0], /不得择一推断条数，须按不符报告/);

  // 首段 1 条 + 次段 1 条、residual 2 条：两条门禁各自独立报出——
  // ① 报段数、② 报条数（只数首段），读者不得按后者推断「次段被计入」。
  const mixed = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B"]), two);
  assert.ok(!mixed.ok);
  assert.ok(mixed.issues.some((i) => i.includes("门禁①")), JSON.stringify(mixed.issues));
  assert.ok(
    mixed.issues.some((i) => /门禁②.*must carry exactly 2 entr.*got 1/s.test(i)),
    `条数只按首段计：次段的 1 条不得被计入，实际：${JSON.stringify(mixed.issues)}`,
  );

  // ① 不依赖条数分支：residual 为空时「不得有残留段」报的是另一条，多段照旧单独报出。
  const emptyResidual = validateDirectionCompleteness(closedFmWith([]), two);
  assert.ok(!emptyResidual.ok);
  assert.ok(emptyResidual.issues.some((i) => i.includes("门禁①")), JSON.stringify(emptyResidual.issues));
  assert.ok(emptyResidual.issues.some((i) => i.includes("must not exist when result.residual is empty")));
});

test("direction: 归属失败 → 按零条计 → 条数不符（不静默丢弃）（21 §15.1 判据边界第一条）", () => {
  // 与开启符**同级或更浅**的 bullet 不属于残留段、不计入条目数（§8 登记形态包含缩进）。
  const flush = "# T\n\n## 结果\n\n- residual:\n- 残留 A\n  - **接受现状**：顶格书写，不属于残留段。\n";
  const counted = validateDirectionCompleteness(closedFmWith(["残留 A"]), flush);
  assert.ok(!counted.ok, "顶格条目按零条计，须以条数不符被拒");
  assert.ok(
    counted.issues.some((i) => /门禁②.*must carry exactly 1 entry.*got 0/s.test(i)),
    JSON.stringify(counted.issues),
  );

  // 段存在但零条：residual 为空时仍被拒（不静默放行）。
  const emptyResidual = validateDirectionCompleteness(closedFmWith([]), flush);
  assert.ok(!emptyResidual.ok, "残留段存在即不得在 residual 为空时出现，哪怕零条");
  assert.ok(
    emptyResidual.issues.some((i) => /must not exist when result\.residual is empty.*got 0 residual entries/s.test(i)),
    JSON.stringify(emptyResidual.issues),
  );

  // 无开启符（如写成 `### 残留` 标题式）→ 同样按零条计 → 条数不符。
  const titled = "# T\n\n## 结果\n\n### 残留\n\n- 残留 A\n";
  const noOpener = validateDirectionCompleteness(closedFmWith(["残留 A"]), titled);
  assert.ok(!noOpener.ok, "标题式写法没有开启符 → 按零条计");
  assert.ok(noOpener.issues.some((i) => /门禁②.*got 0/s.test(i)), JSON.stringify(noOpener.issues));

  // 缩进 2 空格的登记形态照常计入（对照，避免上两条因解析全面失效而空转）。
  const indented = "# T\n\n## 结果\n\n- residual:\n  - 残留 A\n    - **接受现状**：缩进书写，计入残留段。\n";
  const ok = validateDirectionCompleteness(closedFmWith(["残留 A"]), indented);
  assert.ok(ok.ok, JSON.stringify(ok.issues));
});

test("direction: 缩进未锚定绝对值，只比较相对深度（§15.1 实际接受集③）", () => {
  // 登记形态为 0／2／4，但开启符 2、残留条目 4、去向子项 6 同样通过——机械层只比较
  // **相对深度**。消费方不得据 §8 字面推断更严的拒绝行为。
  const deep = "# T\n\n## 结果\n\n  - residual:\n      - 残留 A\n          - **接受现状**：原因甲。\n";
  const ok = validateDirectionCompleteness(closedFmWith(["残留 A"]), deep);
  assert.ok(ok.ok, JSON.stringify(ok.issues));
});

test("direction: 去向之后的同级 bullet 收束段（不吞后续节内容）", () => {
  // 判据边界：残留段以 `- residual:` 开启、`indent <= modeIndent` 收束。
  const body = `# T\n\n## 结果\n\n- residual:\n  - 残留 A\n    - **接受现状**：原因甲。\n- 关闭后的后续方向：保持现状。\n`;
  const res = validateDirectionCompleteness(closedFmWith(["残留 A"]), body);
  assert.ok(res.ok, JSON.stringify(res.issues));

  const swallowed = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B"]), body);
  assert.ok(!swallowed.ok);
  assert.ok(
    swallowed.issues.some((i) => /门禁②.*must carry exactly 2 entr.*got 1/s.test(i)),
    `收束后的 bullet 不得计为残留条目：${JSON.stringify(swallowed.issues)}`,
  );
});

test("direction: 存量豁免——基线已是 closed 且「## 结果」节逐字未改则整体放行（21 §15.3 存量不溯及）", () => {
  // 存量载体是**分离式**（`- residual:` 段 + `- advice:` 段）、写着已撤销的四词、且条数
  // 与 residual 不符。只要不动「## 结果」节，correct 这类写入不得被新门禁挡住，否则存量
  // 对象死锁（21 §14 无删除操作、closed 无 execute 通道 → 无从补齐 routed-to）。
  //
  // **豁免判定必须发生在其后所有门禁之前**（§16 验证表：「存量豁免见 §15.3——基线为
  // closed 且「## 结果」节逐字未改时整体放行」）——否则存量分离式对象会在「不得另设独立
  // 建议段」或门禁②上先被拒，那正是 §15.3 要避免的。
  const legacyBody = resultOnlyBody(
    "- residual:",
    "  - 残留 A",
    "  - 残留 B",
    "- advice:",
    "  - **另立工单**：把该分支另立一单。",
  );
  const fm = closedFmWith(["残留 A", "残留 B"]); // 2 条 residual vs 1 条建议 → 本会被拒
  const baselineBody = bodyWithoutH1(legacyBody);

  const withBaseline = validateDirectionCompleteness(fm, legacyBody, fm, baselineBody);
  assert.ok(withBaseline.ok, JSON.stringify(withBaseline.issues));

  const crossChecked = validateDirectionCompleteness(fm, legacyBody);
  assert.ok(!crossChecked.ok, "无基线时全量受检（fail closed）");
  assert.ok(crossChecked.issues.length > 0);

  // 基线是 closed 但「## 结果」节被改动 → 受检。
  const changedBody = resultOnlyBody(
    "- residual:",
    "  - 残留 A",
    "  - 残留 B",
    "- advice:",
    "  - **另立工单**：把该分支另立一单。",
    "  - **接受现状**：另外这条不跟踪。",
  );
  const changed = validateDirectionCompleteness(fm, changedBody, fm, baselineBody);
  assert.ok(!changed.ok, "改动「## 结果」节即受检");

  // 基线不是 closed（open/draft）→ 豁免不适用，全量受检。
  const openBaseline = { ...fm, status: "open" };
  const notExempt = validateDirectionCompleteness(fm, legacyBody, openBaseline, baselineBody);
  assert.ok(!notExempt.ok, "豁免只对基线已 closed 的写入生效");

  // baselineBody 缺失 → 按「已改动」处理（未知不等于未改动）。
  const noBaselineBody = validateDirectionCompleteness(fm, legacyBody, fm, null);
  assert.ok(!noBaselineBody.ok);
});

test("direction: 豁免基准是「## 结果」节逐字未改——四类正文编辑全部受检（21 §15.3/§15.1）", () => {
  // 2026-09-28 审核 F3：旧基准是「解析后条目列表深等」，它只覆盖 `- ` 条目，
  // 于是改写尾注、加缩进续行、追加散文、改缩进四类编辑全部放行——登记为「窄豁免」，
  // 实际是「## 结果」节的正文自由编辑通道（01 §12.3 第 6 维）。
  // 现基准逐字比较整个「## 结果」节：任何改动该节的受控写入都受检，不再逃逸。
  const fm = closedFmWith(["残留 A", "残留 B"]); // 2 条 residual vs 1 条去向 → 本不合门禁
  const base = resultOnlyBody(
    "- residual:",
    "  - 残留 A",
    "  - 残留 B",
    "- advice:",
    "  - **另立工单**：把该分支另立一单。出自「残留 A」",
  );
  const baselineBody = bodyWithoutH1(base);

  // 正向对照：节逐字未改时豁免成立（存量对象不会死锁）。
  const control = validateDirectionCompleteness(fm, base, fm, baselineBody);
  assert.ok(control.ok, JSON.stringify(control.issues));

  // 四类逃逸：旧基准下全部 ok=true（条目列表未变），现全部受检。
  const escapes = {
    尾注重写: resultOnlyBody(
      "- residual:",
      "  - 残留 A",
      "  - 残留 B",
      "- advice:",
      "  - **另立工单**：把该分支另立一单。出自「残留 B」",
    ),
    缩进续行: resultOnlyBody(
      "- residual:",
      "  - 残留 A",
      "  - 残留 B",
      "- advice:",
      "  - **另立工单**：把该分支另立一单。出自「残留 A」",
      "    补充：该残留实际已由 spark-ce1db936 承接，不再另立。",
    ),
    追加散文: resultOnlyBody(
      "- residual:",
      "  - 残留 A",
      "  - 残留 B",
      "- advice:",
      "  - **另立工单**：把该分支另立一单。出自「残留 A」",
      "",
      "以上去向经 Human 复核确认。",
    ),
    改缩进: resultOnlyBody(
      "- residual:",
      "  - 残留 A",
      "  - 残留 B",
      "- advice:",
      "      - **另立工单**：把该分支另立一单。出自「残留 A」",
    ),
  };
  for (const [name, body] of Object.entries(escapes)) {
    assert.notEqual(body, base, `${name} 用例必须真的改动了「## 结果」节`);
    const res = validateDirectionCompleteness(fm, body, fm, baselineBody);
    assert.ok(!res.ok, `${name}：结果节被改动 → 豁免不适用（旧基准会放行）`);
  }

  // baselineBody 缺失两态（null / undefined）都必须按「已改动」处理（未知不等于未改动）。
  for (const missing of [null, undefined]) {
    const res = validateDirectionCompleteness(fm, base, fm, missing);
    assert.ok(!res.ok, `baselineBody=${String(missing)} 时不得按「未改动」放行`);
  }

  // 边界（如实固定实际宽度）：豁免基准的作用范围就是「## 结果」节本身，
  // 节外改动不撤销豁免——本门禁只约束该节，不对其它节行使否决权。
  const execEdited = base.replace(/^# T\n/, "# T\n\n## 执行\n\n- 该节改动与本门禁无关。\n");
  const outside = validateDirectionCompleteness(fm, execEdited, fm, baselineBody);
  assert.ok(outside.ok, "节外改动不改变「## 结果」节 → 豁免仍在（作用范围仅该节）");
});

test("direction: 豁免对存量分离式（含旧建议段）整体生效——① 与形态前提均不追溯存量（21 §15.3）", () => {
  // §15.3「形态不溯及」：已关闭的既有对象**全部**是分离式，不因新形态而变得不合规、
  // 也不被自动改写。机械层新校验只作用于受控写入的落盘汇聚点，不回扫既有载体。
  //
  // 实测口径（本仓 17 份 closed）：16 份为分离式、1 份两者皆无。故豁免必须同时盖住
  // 「旧建议段开启符」（形态前提）与「① 多段」——两者都不是为存量而设的门禁。
  const legacy = resultOnlyBody(
    "- residual:",
    "  - 残留 A",
    "  - 残留 B",
    "- advice:",
    "  - **直接行动**：把该分支改为 fail-closed。出自「残留 A」",
  );
  const fm = closedFmWith(["残留 A", "残留 B"]);
  const baselineBody = bodyWithoutH1(legacy);
  const exempt = validateDirectionCompleteness(fm, legacy, fm, baselineBody);
  assert.ok(exempt.ok, `存量分离式对象不触碰结果节时必须整体放行：${JSON.stringify(exempt.issues)}`);

  // 多段残留段的存量（实测 0 份，但豁免的作用范围由 §16 验证表登记为「整体放行」，
  // 不按门禁分组）——此边界如实固定，不假装它是被①拦住的。
  const legacyTwoResidualBlocks = resultOnlyBody(
    "- residual:",
    "  - 残留 A",
    "- residual:",
    "  - 残留 B",
  );
  const twoExempt = validateDirectionCompleteness(
    fm,
    legacyTwoResidualBlocks,
    fm,
    bodyWithoutH1(legacyTwoResidualBlocks),
  );
  assert.ok(twoExempt.ok, "豁免先于①：结果节逐字未改时整体放行（§16 验证表口径）");

  // 一旦该节被改动，豁免失效，①/形态前提立即生效——不是永久豁免。
  const edited = `${legacy}\n以上去向经 Human 复核确认。\n`;
  const enforced = validateDirectionCompleteness(fm, edited, fm, baselineBody);
  assert.ok(!enforced.ok, "结果节被改动后门禁必须生效");
  assert.ok(enforced.issues.some((i) => i.includes("不得另设独立的建议段")), JSON.stringify(enforced.issues));

  const noBaseline = validateDirectionCompleteness(fm, legacy);
  assert.ok(!noBaseline.ok);
  assert.ok(noBaseline.issues.some((i) => i.includes("不得另设独立的建议段")));
});

test("direction: 顺序对应不在机械判定范围内（写法约定，2026-09-28 更正）", () => {
  const sparkA = "22222222-3333-4444-8555-666666666666";
  const sparkB = "33333333-4444-4555-8666-777777777777";
  const body = resultOnlyBody(
    ...residualBlock([
      ["残留 A", "**转入 Spark**：残留 A 转入议题甲。"],
      ["残留 B", "**转入 Spark**：残留 B 转入议题乙。"],
    ]),
  );
  const inOrder = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B"], [ROUTED(sparkA), ROUTED(sparkB)]), body);
  const swapped = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B"], [ROUTED(sparkB), ROUTED(sparkA)]), body);
  assert.ok(inOrder.ok, JSON.stringify(inOrder.issues));
  assert.ok(
    swapped.ok,
    `把 relations 数组顺序对调后仍须通过——顺序不可机械核验（§15.1 已登记：去向子项不携带目标标识），实际：${JSON.stringify(swapped.issues)}`,
  );
});

// ---------------------------------------------------------------------------
// 去向完整性：端到端（写入路径上的机械拒绝与放行）
// ---------------------------------------------------------------------------

const SPARK_UID = "22222222-3333-4444-8555-666666666666";

/** 种子 Spark 载体（`routed-to` 的目标；status 可参数化以验证「写入时须 open」）。 */
async function seedSpark(root, uid = SPARK_UID, status = "open") {
  await mkdir(join(root, "sparks"), { recursive: true });
  const fm = [
    "title: 测试议题",
    `status: ${status}`,
    "question: 测试问题应由什么承载？",
    "scope_boundary: 取得判定时停止。",
    "intent: 保留理由——测试夹具；后续方向——取得判定。",
    `object_uid: ${uid}`,
    "fact_type_key: spark",
    "created_at: 2026-09-15T00:00:00.000Z",
    "change_log:",
    "  - at: 2026-09-15T00:00:00.000Z",
    "    summary: seed",
  ].join("\n");
  await writeFile(join(root, "sparks", `spark-${uid}.md`), `---\n${fm}\n---\n\n# 测试议题\n`, "utf8");
  return uid;
}

/**
 * 关闭正文：在既有正文（含摘要/授权范围/计划三段，BODY_H2_CORE 非空是硬要求）
 * 之后追加「执行」与「结果」两节，结果节里给出判据与残留段。
 *
 * `residualPairs` 是 `[残留正文, 去向条目或 null]` 对——**合并式**形态（§8，2026-09-28
 * 二次修订后新写入的唯一形态）：去向子项比残留条目更深一层。
 */
function closingBody(baseBody, residualPairs, residualLines = null) {
  // Gate 1 批准时 writer 已盖了一个「## 执行」节（attempt 起始记录），故以该节为界
  // 只保留其之前的内容，再统一重建「执行」与「结果」。直接追加会得到两个「## 执行」，
  // 被 H2 顺序校验（21 §8 书写结构）先行拒绝，测不到去向门禁。
  const body = bodyWithoutH1(baseBody).replace(/\s+$/, "");
  const execAt = body.search(/^## 执行[ \t]*$/m);
  const head = execAt === -1 ? body : body.slice(0, execAt).replace(/\s+$/, "");
  const lines = [
    head,
    "",
    "## 执行",
    "",
    "- 完成。",
    "",
    "## 结果",
    "",
    "- criteria_checks:",
    "  - 步骤 1 判据「writer 文件存在且 node --check 通过」：达成——证据：node --check 通过。",
    "  - 步骤 2 判据「全部测试用例通过且覆盖创建与关闭路径」：未达成——证据：只覆盖创建路径。",
    "- residual:",
    ...residualPairs.map(([residual, direction]) =>
      direction === null || direction === undefined
        ? `  - ${residual}`
        : `  - ${residual}\n    - ${direction}`),
  ];
  if (Array.isArray(residualLines)) lines.push(...residualLines);
  return `${lines.join("\n")}\n`;
}

/**
 * 存量**分离式**形态的关闭正文（`§15.3`「形态不溯及」的忠实复现）：
 * `- residual:` 段陈述残留、`- advice:` 段另起一段陈述去向，两者靠位置对齐。
 *
 * 与 `closingBody`（合并式，去向作为残留子项）成对存在——呈现层与写入器都必须能读
 * 这两种形态，故测试也要能造出这两种形态。
 */
function legacyClosingBody(baseBody, residualLines, adviceLines) {
  const body = closingBody(baseBody, residualLines.map((line) => [line, null]));
  return `${body}- advice:\n${adviceLines.map((line) => `  - ${line}`).join("\n")}\n`;
}

function partialResult() {
  return {
    criteria_checks: [
      { satisfied: true, evidence: "第 1 条判据的核对证据" },
      { satisfied: false, evidence: "第 2 条判据未达成" },
    ],
    achieved_scope: "第一条判据在授权范围内完成。",
    residual: ["残留 A：第二条判据的关闭路径用例尚未覆盖。"],
  };
}

function partialResultTwoResiduals() {
  return {
    ...partialResult(),
    residual: ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "残留 B：跨会话的残留去向尚未验证。"],
  };
}

test("direction e2e: 关闭时「转入 Spark」缺 routed-to 被机械拒绝且零写入（21 §15.1 门禁④）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await reviewed(root, await approved(root));
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });

    const bad = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "partial",
      result: partialResult(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: closingBody(after.value.body, [
        ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "**转入 Spark**：把残留 A 转入议题待裁。"],
      ]),
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok, "关闭必须被拒——去向缺对象标识");
    assert.equal(bad.error.code, "workcase/direction_incomplete");
    assert.ok(
      bad.error.details.issues.some((i) => /carries 1 「转入 Spark」 entry but relations carries 0 routed-to/.test(i)),
      JSON.stringify(bad.error.details.issues),
    );

    const after0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after0.value.fingerprint, before.value.fingerprint, "零写入：指纹不变");
    assert.equal(after0.value.frontmatter.status, "open");
  });
});

test("direction e2e: 合并式合法形态在关闭入口通过（21 §8/§15.1 放行路径）", async () => {
  // 六组门禁的**放行**用例：合并式（残留 + 去向子项）在关闭时通过，且落盘后
  // 机械问题为零。这一层是 §1 机械侧要求的「可重跑的用例覆盖」——拒绝路径有覆盖
  // 而放行路径无覆盖时，无法区分「门禁生效」与「门禁恒拒」。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const sparkUid = await seedSpark(root);
    const { uid: wcUid, after } = await reviewed(root, await approved(root));

    // 先经 execute 落 routed-to（close 不接受 frontmatterAfter，故这是唯一写入通道，
    // §14 CREATE-FIRST 次序纪律）。
    const exec = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: wcUid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: { ...after.value.frontmatter, relations: [ROUTED(sparkUid)] },
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "登记残留去向",
      sessionSignature: SIG(),
    });
    assert.ok(exec.ok, JSON.stringify(exec.error));
    const execRead = await readWorkcaseObject({ factSourceRoot: root, objectUid: wcUid });

    const closed = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: wcUid,
      expectedFingerprint: exec.value.fingerprint,
      outcome: "partial",
      result: partialResult(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: closingBody(execRead.value.body, [
        ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "**转入 Spark**：把残留 A 转入议题待裁。"],
      ]),
      sessionSignature: SIG(),
    });
    assert.ok(closed.ok, JSON.stringify(closed.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: wcUid });
    assert.equal(read.value.frontmatter.status, "closed");
    assert.equal(read.value.frontmatter.relations[0].relation_key, "routed-to");
    assert.equal(read.value.frontmatter.relations[0].target.object_uid, sparkUid);
    assert.equal(read.value.mechanical_issues.length, 0, JSON.stringify(read.value.mechanical_issues));

    // 六组门禁对落盘对象全量复核（无基线）：合法合并式必须整体通过。
    const recheck = validateDirectionCompleteness(read.value.frontmatter, read.value.body);
    assert.ok(recheck.ok, `合法合并式在关闭后仍须通过六组门禁：${JSON.stringify(recheck.issues)}`);
  });
});

test("direction e2e: 关闭时残留段条数与 residual 不符被拒；补齐后放行（21 §8 字段间不变量）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const uid = await seedSpark(root);
    const { uid: wcUid, after } = await reviewed(root, await approved(root));

    const withRelation = { ...after.value.frontmatter, relations: [ROUTED(uid)] };
    const exec1 = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: wcUid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: withRelation,
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "登记残留去向",
      sessionSignature: SIG(),
    });
    assert.ok(exec1.ok, JSON.stringify(exec1.error));
    // writeValidated 只回 {object_uid,file,fingerprint,read_back}，正文须另读。
    const exec1Read = await readWorkcaseObject({ factSourceRoot: root, objectUid: wcUid });

    // residual 1 条却写 0 条残留条目 → 条数不符，拒绝。
    const tooFew = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: wcUid,
      expectedFingerprint: exec1.value.fingerprint,
      outcome: "partial",
      result: partialResult(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: closingBody(exec1Read.value.body, []),
      sessionSignature: SIG(),
    });
    assert.ok(!tooFew.ok);
    assert.equal(tooFew.error.code, "workcase/direction_incomplete");
    assert.ok(tooFew.error.details.issues.some((i) => /must carry exactly 1 entry/.test(i)), JSON.stringify(tooFew.error.details.issues));

    // residual 1 条写 2 条残留条目 → 同样拒绝。
    const tooMany = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: wcUid,
      expectedFingerprint: exec1.value.fingerprint,
      outcome: "partial",
      result: partialResult(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: closingBody(exec1Read.value.body, [
        ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "**接受现状**：原因甲。"],
        ["残留 B：另一条。", "**接受现状**：原因乙。"],
      ]),
      sessionSignature: SIG(),
    });
    assert.ok(!tooMany.ok);
    assert.ok(tooMany.error.details.issues.some((i) => /must carry exactly 1 entry/.test(i)), JSON.stringify(tooMany.error.details.issues));

    // 条数一致 + routed-to 配对 → 放行。
    const good = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: wcUid,
      expectedFingerprint: exec1.value.fingerprint,
      outcome: "partial",
      result: partialResult(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: closingBody(exec1Read.value.body, [
        ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "**转入 Spark**：把残留 A 转入议题待裁。"],
      ]),
      sessionSignature: SIG(),
    });
    assert.ok(good.ok, JSON.stringify(good.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: wcUid });
    assert.equal(read.value.frontmatter.status, "closed");
    assert.equal(read.value.mechanical_issues.length, 0, JSON.stringify(read.value.mechanical_issues));
  });
});

test("direction e2e: 独立建议段（旧形态）在新写入被拒且零写入（21 §8 形态前提）", async () => {
  // §8（2026-09-28 二次修订）明文「**不再另设独立的建议段**」。本用例固定「新写入出现
  // 旧形态即被拒」这一行为，并核对拒绝**可操作**（文案给出该怎么改）。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await reviewed(root, await approved(root));
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });

    const legacyShape = closingBody(after.value.body, [
      ["残留 A：第二条判据的关闭路径用例尚未覆盖。", null],
    ]) + "- advice:\n  - **接受现状**：把该残留就此了结。\n";

    const bad = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "partial",
      result: partialResult(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: legacyShape,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok, "旧形态的独立建议段必须被拒");
    assert.equal(bad.error.code, "workcase/direction_incomplete");
    const adviceIssue = bad.error.details.issues.find((i) => i.includes("不得另设独立的建议段"));
    assert.ok(adviceIssue, JSON.stringify(bad.error.details.issues));
    // 可操作文案：指明该怎么改（删去该段、把去向移入残留之下作为更深一层的子项）。
    assert.match(adviceIssue, /可操作处置：删去该段/);
    assert.match(adviceIssue, /- residual:/);

    const after0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after0.value.fingerprint, before.value.fingerprint, "零写入：指纹不变");
    assert.equal(after0.value.frontmatter.status, "open");

    // 对照：同一内容改用合并式（去向作为残留子项）即放行——证明拒绝来自形态，不是别处。
    const ok = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "partial",
      result: partialResult(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: closingBody(after.value.body, [
        ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "**接受现状**：把该残留就此了结。"],
      ]),
      sessionSignature: SIG(),
    });
    assert.ok(ok.ok, JSON.stringify(ok.error));
  });
});

test("direction e2e: routed-to 目标不存在或在写入时非 open → 零写入拒绝（21 §12）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await reviewed(root, await approved(root));

    const missing = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: { ...after.value.frontmatter, relations: [ROUTED(SPARK_UID)] },
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "登记残留去向",
      sessionSignature: SIG(),
    });
    assert.ok(!missing.ok, "目标不存在必须被拒");
    assert.equal(missing.error.code, "workcase/relations_unresolvable");
    const afterMissing = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(afterMissing.value.fingerprint, after.value.fingerprint, "零写入：指纹不变");

    // 目标存在但已是终态（implemented）→ 同样拒绝（§12：只有仍在承载议题的 Spark 才配作去向）。
    await seedSpark(root, SPARK_UID, "implemented");
    const retired = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: { ...after.value.frontmatter, relations: [ROUTED(SPARK_UID)] },
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "登记残留去向",
      sessionSignature: SIG(),
    });
    assert.ok(!retired.ok, "写入时非 open 的目标必须被拒");
    assert.equal(retired.error.code, "workcase/relations_unresolvable");
  });
});

test("direction e2e: 存量 closed 对象的 correct——「## 结果」节逐字未改放行，改动即受检（21 §15.3）", async () => {
  // **存量形态的忠实复现**（`§15.3`「形态不溯及」）：实测 17 份 closed 中 16 份是
  // **分离式**（`- residual:` 段陈述残留、`- advice:` 段陈述去向），且其中 6 份的建议段
  // 条数**少于** `residual` 长度（合计 22 条残留当年就没有去向）。故本 fixture 刻意用
  // 「2 条残留 + 1 条旧四词去向」这一不合新形态的存量组合——它在新门禁下必然被拒，
  // 而 `correct` 若不触碰「## 结果」节就必须**整体放行**（否则存量对象死锁：
  // `§14` 无删除操作、closed 无 execute 通道 → 无从补齐 `routed-to`）。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await reviewed(root, await approved(root));

    // **存量载体不能由受控入口造出来**——`close` 会把分离式形态当场拒绝（`§8` 明文
    // 「不再另设独立的建议段」，且 `close` 无基线、不受 `§15.3` 豁免）。故此处先经合法
    // 合并式关闭，再把落盘载体**改写为存量分离式形态**——这正是 2026-09-28 之前已关闭的
    // 17 份对象的实际状态（实测 16 份为分离式）。受控入口不回扫既有载体（`§15.3`），
    // 故这一改写是「模拟既有载体」，不是「绕过门禁写入」。
    const closed = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "partial",
      result: partialResultTwoResiduals(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: closingBody(after.value.body, [
        ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "**接受现状**：先按合并式关闭。"],
        ["残留 B：跨会话的残留去向尚未验证。", "**接受现状**：先按合并式关闭。"],
      ]),
      sessionSignature: SIG(),
    });
    assert.ok(closed.ok, JSON.stringify(closed.error));

    const closedRead0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const legacyBody = legacyClosingBody(
      bodyWithoutH1(closedRead0.value.body),
      ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "残留 B：跨会话的残留去向尚未验证。"],
      ["**另立工单**：把该分支另立一单。出自「残留 A」"],
    );
    const carrierPath = join(root, "workcases", `workcase-${uid}.md`);
    const carrier = await readFile(carrierPath, "utf8");
    const yamlEnd = carrier.indexOf("\n---\n");
    assert.ok(yamlEnd > 0, "载体须有 YAML 头");
    await writeFile(carrierPath, `${carrier.slice(0, yamlEnd)}\n---\n\n# ${closedRead0.value.frontmatter.title}\n\n${legacyBody}`, "utf8");

    const closedRead = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(
      sectionOfBody(closedRead.value.body, "结果"),
      sectionOfBody(legacyBody, "结果"),
      "改写后的载体须确实携带存量分离式的「## 结果」节",
    );
    // 前提自证：该对象在新门禁下（无基线）确实不合规——否则本用例测不到豁免。
    const strict = validateDirectionCompleteness(closedRead.value.frontmatter, closedRead.value.body);
    assert.ok(!strict.ok, "本 fixture 必须是「新门禁下不合规」的存量形态，否则豁免用例空转");
    assert.ok(
      strict.issues.some((i) => i.includes("不得另设独立的建议段")),
      JSON.stringify(strict.issues),
    );

    // ① 不触碰「## 结果」节的更正 → 放行（存量不溯及）。
    // 判据是**逐字比较整个「## 结果」节**，故只改节外文本（此处改「执行」节）。
    const execOnly = closedRead.value.body.replace(
      "## 执行\n\n- 完成。",
      "## 执行\n\n- 完成（补记：该节与去向无关，属节外更正）。",
    );
    assert.notEqual(execOnly, closedRead.value.body, "本用例必须真的改动了正文，否则测不到什么");
    assert.equal(
      sectionOfBody(execOnly, "结果"),
      sectionOfBody(closedRead.value.body, "结果"),
      "「## 结果」节须逐字未改——这是豁免的实际基准",
    );

    const untouched = await correctWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: closedRead.value.fingerprint,
      bodyMarkdownAfter: bodyWithoutH1(execOnly),
      changeSummary: "事实更正（非状态转换）——节外说明补记",
      humanAuthorization: "Human 授权：节外说明补记（测试）",
      sessionSignature: SIG(),
    });
    assert.ok(untouched.ok, `不触碰结果节的更正经存量豁免必须放行：${JSON.stringify(untouched.error)}`);

    // ② 触碰「## 结果」节（补一个旧形态建议段）→ 受检（旧形态被拒）。
    const correctedRead = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const addAdvice = await correctWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: correctedRead.value.fingerprint,
      bodyMarkdownAfter: bodyWithoutH1(`${correctedRead.value.body}\n- advice:\n  - **接受现状**：无残留需要跟踪。\n`),
      changeSummary: "事实更正（非状态转换）——补建议段",
      humanAuthorization: "Human 授权：补建议段（测试）",
      sessionSignature: SIG(),
    });
    assert.ok(!addAdvice.ok, "改动「## 结果」节即受检");
    assert.equal(addAdvice.error.code, "workcase/direction_incomplete");
    assert.ok(
      addAdvice.error.details.issues.some((i) => i.includes("不得另设独立的建议段")),
      JSON.stringify(addAdvice.error.details.issues),
    );
  });
});

/** 取正文某个 H2 节的原文（不含标题行）——本文件内的最小实现，用于比对「节逐字未改」。 */
function sectionOfBody(body, heading) {
  const lines = String(body).split("\n");
  const out = [];
  let collecting = false;
  for (const line of lines) {
    if (/^ {0,3}##\s+\S/.test(line)) {
      if (new RegExp(`^ {0,3}##\\s+${heading}\\s*$`).test(line)) {
        collecting = true;
        continue;
      }
      if (collecting) break;
    }
    if (collecting) out.push(line);
  }
  return out.join("\n").trim();
}

test("relations 去重: 同键同目标的双 routed-to 放行（两条残留转入同一 Spark，按条对应）", () => {
  // 03 §7.2 不变量 3 + 21 §12：`routed-to` 的判定键是 `relation_key::target`，且**允许
  // 同键同目标重复出现**——去向完整性由**条数**承载（每条残留对应一条边），两条残留转入
  // 同一 Spark 时须各有一条边。这是「按条对应」的承载，不是同义重复。
  const uid = "22222222-3333-4444-8555-666666666666";
  const body = resultOnlyBody(
    ...residualBlock([
      ["残留 A", "**转入 Spark**：残留 A 转入议题待裁。"],
      ["残留 B", "**转入 Spark**：残留 B 同样转入该议题。"],
    ]),
  );
  const res = validateDirectionCompleteness(closedFmWith(["残留 A", "残留 B"], [ROUTED(uid), ROUTED(uid)]), body);
  assert.ok(res.ok, `两条同 uid 的 routed-to 必须放行（按条对应）：${JSON.stringify(res.issues)}`);
});

test("relations 去重: 跨 key 的同目标是两条独立关系（各自成立，互不重复）", () => {
  const uid = "22222222-3333-4444-8555-666666666666";
  const body = resultOnlyBody(...residualBlock([["残留 A", "**转入 Spark**：转入议题待裁。"]]));
  const res = validateDirectionCompleteness(
    closedFmWith(["残留 A"], [ROUTED(uid), { relation_key: "contributed-to", target: { object_uid: uid } }]),
    body,
  );
  // 跨 key 的两条各自独立成立；④ 只数 `routed-to`，故此处恰好配对。
  assert.ok(res.ok, JSON.stringify(res.issues));
});

test("relations 去重: contributed-to 的同键同目标仍是同义重复 —— 零写入拒绝", () => {
  // 判定键是 `relation_key::target`（03 §7.2 不变量 3 + 21 §15.1 2026-09-28 登记）：
  //   · `routed-to` 的同键同目标**允许重复**——去向完整性由**条数**承载（每条残留对应
  //     一条边），两条残留转入同一 Spark 时须各有一条边，这是「按条对应」的承载；
  //   · `contributed-to` **无逐条对应义务**，同键同目标仍是同义重复，零写入拒绝。
  // 两者口径不同，故本用例与上一条（routed-to 放行）成对存在——只断言其一无法区分
  // 「按 key 分派」与「一律去重」/「一律放行」三种实现。
  const dup = validateWorkcaseFrontmatter(writingCase({ relations: [CONTRIBUTED(PITFALL_UID), CONTRIBUTED(PITFALL_UID)] }));
  assert.equal(dup.ok, false, "contributed-to 无逐条对应义务，同键同目标仍是同义重复");
  assert.ok(
    dup.issues.some((i) => i.includes(`duplicate relation contributed-to → ${PITFALL_UID}`)),
    JSON.stringify(dup.issues),
  );

  // 目标比较大小写不敏感（与 refs 同名口径一致）。
  const caseDup = validateWorkcaseFrontmatter(
    writingCase({ relations: [CONTRIBUTED(PITFALL_UID), CONTRIBUTED(PITFALL_UID.toUpperCase())] }),
  );
  assert.equal(caseDup.ok, false, "同一 uid 的大小写变体仍应判为重复");
  assert.ok(caseDup.issues.some((i) => i.includes("duplicate relation contributed-to")), JSON.stringify(caseDup.issues));
});

test("direction e2e: 两条残留转入同一 Spark —— 两条同 uid 的 routed-to 可落盘，关闭放行（21 §15.1）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const sparkUid = await seedSpark(root);
    const { uid: wcUid, after } = await reviewed(root, await approved(root));

    const exec = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: wcUid,
      expectedFingerprint: after.value.fingerprint,
      frontmatterAfter: { ...after.value.frontmatter, relations: [ROUTED(sparkUid), ROUTED(sparkUid)] },
      bodyMarkdownAfter: bodyWithoutH1(after.value.body),
      changeSummary: "两条残留登记到同一议题",
      sessionSignature: SIG(),
    });
    assert.ok(exec.ok, `同目标的两条 routed-to 必须可写入，实际：${JSON.stringify(exec.error)}`);
    const execRead = await readWorkcaseObject({ factSourceRoot: root, objectUid: wcUid });
    assert.equal(execRead.value.frontmatter.relations.length, 2, "同 uid 的两条边须都保留（按条对应，不是去重）");
    assert.equal(execRead.value.mechanical_issues.length, 0, JSON.stringify(execRead.value.mechanical_issues));

    const closed = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: wcUid,
      expectedFingerprint: exec.value.fingerprint,
      outcome: "partial",
      result: partialResultTwoResiduals(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: closingBody(execRead.value.body, [
        ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "**转入 Spark**：残留 A 转入议题待裁。"],
        ["残留 B：跨会话的残留去向尚未验证。", "**转入 Spark**：残留 B 同样转入该议题。"],
      ]),
      sessionSignature: SIG(),
    });
    assert.ok(closed.ok, JSON.stringify(closed.error));
    const read = await readWorkcaseObject({ factSourceRoot: root, objectUid: wcUid });
    assert.equal(read.value.frontmatter.status, "closed");
    assert.equal(read.value.mechanical_issues.length, 0, JSON.stringify(read.value.mechanical_issues));
  });
});

test("direction e2e: 多残段在关闭入口被机械拒绝且零写入（21 §8/§15.1 硬门禁①）", async () => {
  // 为什么必须有 e2e 覆盖（21 §1 的证据条件式要求）：① 此前只有单元层用例（直调
  // validateDirectionCompleteness），而 §1 的机械侧要求是「门禁…与端到端零写入拒绝各自
  // 具备可重跑的用例覆盖之前，不得声称本项已获机械保障」。本用例补上「走真实 close 入口
  // + 零写入」这一层：拒绝必须发生在**任何落盘之前**，而不只是校验函数返回 false。
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid, after } = await reviewed(root, await approved(root));
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });

    // 首段条数与 residual 相符（1 条），仅多出一个残留段开启符 → ① 单独触发。
    const twoSections = `${closingBody(after.value.body, [
      ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "**接受现状**：该分支已被后续工作覆盖，继续跟踪无增量。"],
    ])}\n- residual:\n  - 第二个残留段。\n    - **接受现状**：原因乙。\n`;

    const bad = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "partial",
      result: partialResult(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: twoSections,
      sessionSignature: SIG(),
    });
    assert.ok(!bad.ok, "多残段必须被拒");
    assert.equal(bad.error.code, "workcase/direction_incomplete");
    assert.ok(
      bad.error.details.issues.some((i) => i.includes("must appear exactly once — found 2 residual section openers")),
      JSON.stringify(bad.error.details.issues),
    );
    // ① 是唯一触发的门禁：条数相符，故不应同时报「条数不符」（防空转，也固定拒绝归因）。
    assert.ok(
      !bad.error.details.issues.some((i) => i.includes("must carry exactly")),
      `首段条数与 residual 相符时不该报条数门禁，实际：${JSON.stringify(bad.error.details.issues)}`,
    );

    // 零写入三证据：指纹、状态、outcome 均未变。
    const after0 = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after0.value.fingerprint, before.value.fingerprint, "零写入：指纹不变");
    assert.equal(after0.value.frontmatter.status, "open");
    assert.equal(after0.value.frontmatter.outcome, undefined);

    // 对照：同一正文去掉第二个开启符即放行（证明拒绝来自 ①，不是别的门禁在拦）。
    const single = closingBody(after.value.body, [
      ["残留 A：第二条判据的关闭路径用例尚未覆盖。", "**接受现状**：该分支已被后续工作覆盖，继续跟踪无增量。"],
    ]);
    const ok = await closeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: after.value.fingerprint,
      outcome: "partial",
      result: partialResult(),
      changeSummary: "关闭（测试）",
      bodyMarkdownAfter: single,
      sessionSignature: SIG(),
    });
    assert.ok(ok.ok, JSON.stringify(ok.error));
    const after1 = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after1.value.frontmatter.status, "closed");
  });
});

test("result: plan 缺失时机械校验报告而非崩溃（回归：曾读 frontmatter.plan.length 抛 TypeError）", () => {
  const fm = writingCase({
    plan: undefined,
    status: "closed",
    outcome: "partial",
    result: { criteria_checks: [], achieved_scope: "部分达成。", residual: ["残留 A"] },
  });
  let res;
  assert.doesNotThrow(() => { res = validateWorkcaseFrontmatter(fm); }, "plan 缺失不得抛 TypeError");
  assert.equal(res.ok, false);
  assert.ok(
    res.issues.some((i) => i.includes("plan: must be a non-empty array")),
    `plan 缺失须由形状校验单独报告，实际：${JSON.stringify(res.issues)}`,
  );

  // 同一 frontmatter 在 plan 齐备时不应报 plan 错（证明上一条不是解析全面失效的空转）。
  const withPlan = validateWorkcaseFrontmatter({ ...fm, plan: [{ step: "一步", done_criteria: "判据" }] });
  assert.ok(!withPlan.issues.some((i) => i.includes("plan: must be a non-empty array")), JSON.stringify(withPlan.issues));
});

// ---------------------------------------------------------------------------
// 增量审批（21 §14「增量审批」/ §8 四档的乙档；承载 = gate_1.amendments）
//
// 这一组钉的是**通道本身的语义**，而不是它有没有被实现：
//   · 申请只登记待批条目 —— 不触碰 plan/scope，也不产生任何可执行权限；
//   · 批准 —— 追加 plan、重算并写回 authorization_fingerprint，**attempt 与 reviews 不动**；
//   · 拒绝 —— 只落 decision，plan/scope 一字不动；
//   · 一条待批的纪律、以及"批准必须让正文同步"（载体内聚）。
// ---------------------------------------------------------------------------

/** 在已批准对象上取当前指纹，供下一次受控写作用（AVOID stale CAS）。 */
async function fingerprintOf(root, uid) {
  const cur = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
  return cur.value.fingerprint;
}

/**
 * 把一条新步骤**追加到正文「## 计划」节的末尾**，并确保「## 执行」节存在。
 *
 * 必须是末尾：21 §16 的载体内聚按 `plan` 数组序在正文里**顺序定位**（in order），
 * 插到中间会让后续既有步骤"落后于"新步骤而定位失败（本例即一次实测踩坑）。
 */
function bodyWithExtraStep(body, line, execLine) {
  const lines = String(body).split("\n");
  let lastPlanLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^- .*：判据——/.test(lines[i])) lastPlanLine = i;
  }
  const withStep = lastPlanLine >= 0
    ? [...lines.slice(0, lastPlanLine + 1), line, ...lines.slice(lastPlanLine + 1)].join("\n")
    : `${String(body)}\n${line}\n`;
  return /^## 执行/m.test(withStep)
    ? withStep
    : `${withStep}\n## 执行\n\n- ${execLine}\n`;
}

async function requestedAdjustment(root, uid, items, rationale) {
  const res = await requestWorkcaseAdjustment({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: await fingerprintOf(root, uid),
    items,
    rationale,
    sessionSignature: SIG(),
  });
  assert.ok(res.ok, JSON.stringify(res.error));
  return res;
}

const ADJUST_ITEM = [{ step: "执行中发现必需的第二步", done_criteria: "第二步有可判定证据" }];

test("调整·申请：只登记待批条目——plan/scope/授权指纹一字不动，且不产生任何可执行权限 (21 §14 乙档)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    await requestedAdjustment(root, uid, ADJUST_ITEM, "不做它，第一条判据达不成");
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });

    assert.deepEqual(after.value.frontmatter.plan, before.value.frontmatter.plan, "申请不得动 plan");
    assert.equal(after.value.frontmatter.scope, before.value.frontmatter.scope, "申请不得动 scope");
    assert.equal(
      after.value.frontmatter.gate_1.authorization_fingerprint,
      before.value.frontmatter.gate_1.authorization_fingerprint,
      "申请不得改授权指纹（申请不是授权）",
    );
    const amendments = after.value.frontmatter.gate_1.amendments;
    assert.equal(amendments.length, 1);
    assert.equal(amendments[0].decision, undefined, "待批 = 末项无 decision");
    assert.equal(amendments[0].rationale, "不做它，第一条判据达不成");
    assert.match(amendments[0].requested_at, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test("调整·批准：追加 plan + 重算并写回 authorization_fingerprint，且 attempt 与 reviews 一概不动 (21 §14)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const attemptBefore = JSON.stringify(before.value.frontmatter.attempt);
    await requestedAdjustment(root, uid, ADJUST_ITEM, "不做它，第一条判据达不成");

    const bodyAfter = bodyWithExtraStep(before.value.body, `- ${ADJUST_ITEM[0].step}：判据——${ADJUST_ITEM[0].done_criteria}`, "增量审批批准后执行第二步。");
    const decided = await decideWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: await fingerprintOf(root, uid),
      decision: "approved",
      by: "human-test",
      bodyMarkdownAfter: bodyAfter,
      sessionSignature: SIG(),
    });
    assert.ok(decided.ok, JSON.stringify(decided.error));

    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after.value.frontmatter.plan.length, before.value.frontmatter.plan.length + 1, "批准后 plan 应追加一条");
    const last = after.value.frontmatter.gate_1.amendments.at(-1);
    assert.equal(last.decision.kind, "approved");
    assert.equal(last.decision.by, "human-test");
    assert.equal(
      last.decision.resulting_fingerprint,
      computeAuthorizationFingerprint(after.value.frontmatter.plan, after.value.frontmatter.scope),
      "decision 留痕的新指纹须与当前 plan+scope 一致",
    );
    assert.equal(
      after.value.frontmatter.gate_1.authorization_fingerprint,
      last.decision.resulting_fingerprint,
      "批准须把重算后的指纹写回 gate_1（否则 §9.1 的 open 不变量立刻不自洽）",
    );
    assert.equal(JSON.stringify(after.value.frontmatter.attempt), attemptBefore, "批准不得重置 attempt（这正是与局部重批的差别）");
    assert.equal(
      JSON.stringify(after.value.frontmatter.reviews ?? null),
      JSON.stringify(before.value.frontmatter.reviews ?? null),
      "批准也不得动 reviews（规范声称 attempt 与 reviews **两者**均不动，故两者都要钉）",
    );
    assert.equal(after.value.frontmatter.status, "open", "增量审批不改变状态");
  });
});

test("调整·批准：正文未同步新步骤时被拒——且拒绝理由是载体内聚（不是别的结构错）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    await requestedAdjustment(root, uid, ADJUST_ITEM, "不做它，第一条判据达不成");
    const decided = await decideWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: await fingerprintOf(root, uid),
      decision: "approved",
      by: "human-test",
      bodyMarkdownAfter: bodyWithoutH1(before.value.body), // 未把新步骤写进「## 计划」
      sessionSignature: SIG(),
    });
    assert.equal(decided.ok, false, "字段与正文不同步时必须拒绝，而不是落一个字段有、正文没有的对象");
    // 空转防线（2026-09-30 独立对抗复核 F-9）：必须钉住**拒绝理由**，否则一个因"缺 H1"等
    // 无关结构错而失败的用例会被误当成"载体内聚生效"的证据。
    assert.equal(decided.error.code, "workcase/coherence_invalid", "拒绝须来自载体内聚校验");
  });
});

test("调整·批准：结构错（缺节）与载体内聚错是两种不同的拒绝", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    await requestedAdjustment(root, uid, ADJUST_ITEM, "不做它，第一条判据达不成");
    // 该正文的 H1 会先被剥掉（本入口与 execute/close 同形），实际因**缺 H2 节**而报结构错——
    // 本用例钉的是"结构错与内聚错被区分开"，不是"H1 被处理"（2026-09-30 独立对抗复核 F-8）。
    const noH1NoStep = await decideWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: await fingerprintOf(root, uid),
      decision: "approved",
      by: "human-test",
      bodyMarkdownAfter: "# 不该有的 H1\n\n## 摘要\n",
      sessionSignature: SIG(),
    });
    assert.equal(noH1NoStep.ok, false);
    assert.equal(noH1NoStep.error.code, "workcase/body_invalid", "结构错须报 body_invalid，与载体内聚区分开");
  });
});

test("调整·批准：旁注占用步骤文本时仍可落盘——载体内聚的**已知边界**，如实钉住（21 §16 的定位是子串匹配）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    const before = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    await requestedAdjustment(root, uid, ADJUST_ITEM, "不做它，第一条判据达不成");
    // 把步骤文本放进**「## 计划」节内的一条旁注**（不新增独立步骤行）。
    // 载体内聚的定位是 `indexOf(item.step)`（子串匹配）→ 定位得到满足 → 写入被接受。
    // **这是既有实现的边界**（非本通道引入）：本用例把它钉住，使"字段有、正文没有独立步骤行"
    // 这一事实可被回归发现——若将来改为行匹配，本例会变红，那正是它该有的行为。
    const parts = String(before.value.body).split("## 计划");
    const planSection = parts[1].split(/\n## /)[0];
    const withNote = `## 计划${planSection}- 备注：本条与「${ADJUST_ITEM[0].step}」无关，只是引用了这句话。\n${parts[1].slice(planSection.length)}`;
    const bodyAfter = (parts[0] + withNote).replace(/\n$/, "\n");
    const decided = await decideWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: await fingerprintOf(root, uid),
      decision: "approved",
      by: "human-test",
      bodyMarkdownAfter: bodyAfter,
      sessionSignature: SIG(),
    });
    // 断言**必然执行**（此前的写法把断言放在 if(ok) 里，写入被拒时空转——复核 F-3）。
    assert.equal(decided.ok, true, `该旁注形态按现行子串匹配应被接受；实际：${JSON.stringify(decided.error ?? {})}`);
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const planSectionAfter = String(after.value.body).split("## 计划")[1].split(/\n## /)[0];
    const hasStepLine = planSectionAfter
      .split("\n")
      .some((l) => l.trim() === `- ${ADJUST_ITEM[0].step}：判据——${ADJUST_ITEM[0].done_criteria}`);
    assert.equal(hasStepLine, false, "本用例记录的就是这条已知边界：正文没有独立步骤行，字段却已追加");
    assert.equal(after.value.frontmatter.plan.at(-1).step, ADJUST_ITEM[0].step, "字段侧确实已追加（否则本用例无从谈“绕”）");
  });
});

test("调整·纪律：非末位的待批条目一律拒绝——校验器与决定路径同口径（10 §5.5 的「末项无 decision」）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    const cur = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    // 手工构造 [待批, 已决定]（正常写入路径产不出该形态；此处直接落盘以钉住校验器与 decide 的口径）。
    const fm = structuredClone(cur.value.frontmatter);
    const entry = (decided) => ({
      requested_at: "2026-09-30T00:00:00.000Z",
      items: [{ step: `步骤-${decided ? "d" : "p"}`, done_criteria: "证据" }],
      rationale: "测",
      ...(decided ? { decision: { kind: "approved", by: "human-test", at: "2026-09-30T00:00:00.000Z", resulting_fingerprint: "x".repeat(64) } } : {}),
    });
    fm.gate_1.amendments = [entry(false), entry(true)];
    const res = validateWorkcaseFrontmatter(fm);
    const list = Array.isArray(res) ? res : (res.issues ?? []);
    assert.ok(
      list.some((i) => /undecided entry must be the LAST one/.test(i)),
      `非末位待批须被校验器拒绝；实际 issues：${JSON.stringify(list)}`,
    );
  });
});

test("调整·身份：决定者会话身份被盖戳；身份不可得时**显式**报出（不静默）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    await requestedAdjustment(root, uid, ADJUST_ITEM, "不做它，第一条判据达不成");
    const cur = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const decided = await decideWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: cur.value.fingerprint,
      decision: "approved",
      by: "human-test",
      bodyMarkdownAfter: bodyWithExtraStep(cur.value.body, `- ${ADJUST_ITEM[0].step}：判据——${ADJUST_ITEM[0].done_criteria}`, "执行。"),
      sessionSignature: SIG(),
      sessionIdentity: IDENTITY("session-decider-test"),
    });
    assert.ok(decided.ok, JSON.stringify(decided.error));
    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const d = after.value.frontmatter.gate_1.amendments.at(-1).decision;
    assert.equal(d.session_id, "session-decider-test", "决定者会话身份须落盘（`by` 是自报，痕迹来自这里）");
    assert.equal(d.session_source, "host");
    assert.equal(decided.value.decider_identity, "session-decider-test");

    // 身份不可得：写入仍成功，但必须**显式**报出（不得静默）
    await requestedAdjustment(root, uid, [{ step: "第三件事", done_criteria: "证据 3" }], "第二份申请");
    const cur2 = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const noIdentity = await decideWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: cur2.value.fingerprint,
      decision: "rejected",
      by: "human-test",
      sessionSignature: SIG(),
    });
    assert.ok(noIdentity.ok, JSON.stringify(noIdentity.error));
    assert.equal(noIdentity.value.decider_identity, "unavailable", "身份不可得须显式报出，不得静默");
    const after2 = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after2.value.frontmatter.gate_1.amendments.at(-1).decision.session_id, undefined);
  });
});

test("调整·内容下限：与既有 plan 步骤逐字重复的申请被拒；超长项被拒（21 §14）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    const cur = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const dup = await requestWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: cur.value.fingerprint,
      items: [{ step: cur.value.frontmatter.plan[0].step, done_criteria: cur.value.frontmatter.plan[0].done_criteria }],
      rationale: "重复申请",
      sessionSignature: SIG(),
    });
    assert.equal(dup.ok, false);
    assert.equal(dup.error.code, "invalid_request");
    const tooLong = await requestWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: cur.value.fingerprint,
      items: [{ step: "长".repeat(2001), done_criteria: "证据" }],
      rationale: "超长申请",
      sessionSignature: SIG(),
    });
    assert.equal(tooLong.ok, false);
    assert.equal(tooLong.error.code, "invalid_request");
  });
});

test("调整·纪律：无待批时不得作出决定；申请要求 status=open (21 §14)", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    const nonePending = await decideWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: await fingerprintOf(root, uid),
      decision: "approved",
      by: "human-test",
      bodyMarkdownAfter: bodyWithoutH1((await readWorkcaseObject({ factSourceRoot: root, objectUid: uid })).value.body),
      sessionSignature: SIG(),
    });
    assert.equal(nonePending.ok, false);
    assert.equal(nonePending.error.code, "workcase/no_pending_adjustment");

    // draft 期不得申请（增量审批是执行期通道）
    const { created } = await createDraft(root);
    const onDraft = await requestWorkcaseAdjustment({
      factSourceRoot: root,
      objectUid: created.value.object_uid,
      expectedFingerprint: created.value.fingerprint,
      items: ADJUST_ITEM,
      rationale: "draft 期申请",
      sessionSignature: SIG(),
    });
    assert.equal(onDraft.ok, false);
    assert.equal(onDraft.error.code, "workcase/transition_invalid");
  });
});

test("调整·校验：amendments 的形状与决定取值受机械校验（21 §8）", async () => {
  await withTemp("workcase-writer.", async (root) => {
    await seedGoal(root);
    const { uid } = await approved(root);
    const cur = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    const fm = structuredClone(cur.value.frontmatter);
    fm.gate_1.amendments = [
      { requested_at: "not-a-date", items: [], rationale: "", decision: { kind: "maybe", by: "", at: "x" } },
    ];
    const result = validateWorkcaseFrontmatter(fm);
    const list = Array.isArray(result) ? result : (result.issues ?? []);
    const text = list.join("\n");
        assert.match(text, /decision\.kind: must be "approved" \| "rejected"/, "非法决定取值须被报出");
    assert.match(text, /decision\.by: required non-empty/, "空的决定者姓名须被报出");
    assert.match(text, /decision\.at: required RFC3339/, "非法的决定时间须被报出");
  });
});
