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
  recordWorkcaseReview,
  listWorkcaseObjects,
  computeAuthorizationFingerprint,
  validateWorkcaseBodyStructure,
  validateWorkcaseFrontmatter,
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
      scope: "做什么：a。明确不做什么：b。",
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
      result: { achieved_scope: "取消（缺口用例）" },
      changeSummary: "取消",
      bodyMarkdownAfter: `${draftBody}\n\n## 结果\n\n取消。\n`,
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
