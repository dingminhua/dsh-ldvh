// 建前独立审核的**对象承载与三道机械门禁**（21 §8/§9.2/§14/§15.1，2026-10-16 建立）。
//
// 本工件钉住的是「审核轴」（Gate 1 前对候选找错）与「复核轴」（Gate 2 前对已发生
// 工作核对）的**分立**，以及为前者新增的三道门禁各自的**拒绝/放行两态**：
//   ① 时序闸（approve）：上一次落盘的 draft 须已带 pre_reviews —— 审核不得与批准同批写入；
//   ② 覆盖闸（approve）：须存在一条 candidate_fingerprint == 当前 plan+scope 指纹
//      且 verdict == pass 的条目 —— 「审完又改」的旧结论不覆盖当前候选；
//   ③ 上限闸（record_audit）：同一次审核事项（同一指纹）最多 3 条，第 4 条拒绝。
//
// 为什么需要这组测试：修订前只有 Approve 的「第五要素非空」形式校验，故「审没审」
// 「审的是哪一版」「审到第几次」三者都不可机械核验（实测：workcase-c36b0208 的审核
// 结论为「建议修订，3 项必改」，该候选随后仍以 draft 进 Gate 1）。三道门禁若不被
// 拒绝态钉住，就只是装饰——一个只测放行路径的套件无法区分「闸生效」与「闸被旁路」。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTemp } from "./helpers.mjs";
import {
  createWorkcaseObject,
  readWorkcaseObject,
  approveWorkcaseObject,
  recordWorkcaseAudit,
  executeWorkcaseObject,
  reviseWorkcaseObject,
  rebatchWorkcaseObject,
  computeAuthorizationFingerprint,
  PRE_AUDIT_ENTRIES_PER_MATTER_MAX,
} from "../lib/workcase-writer.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "../lib/signature-channel.js";

const SIG = () => authoritativeSignature({ provider: "test-provider", model: "test-model" });
const IDENTITY = (sessionId, origin = null) => authoritativeSessionIdentity({ sessionId, source: "host", origin });
/** 审核者是**受管辖隔离子代理**（21 §14 承载形式唯一）：origin="subagent"。 */
const AUDITOR = () => IDENTITY("session-auditor-test", "subagent");
const IMPLEMENTER = () => IDENTITY("session-implementer-test");

const DRAFT = {
  title: "建前审核门禁测试工单",
  gist: "夹具：钉住建前审核的对象承载与三道机械门禁。",
  serves: "SG-1",
  summary: "夹具候选。",
  scope: "做什么：\n- 夹具项。\n\n明确不做什么：\n- 无。",
  plan: [{ step: "夹具步骤", done_criteria: "夹具判据可判定。" }],
  change_summary: "初始落盘",
};

const AUDIT_SUMMARY = "对象恰当性符合；方案可行性符合；scope 清晰度符合（夹具）";

async function seedGoal(factSourceRoot) {
  await mkdir(factSourceRoot, { recursive: true });
  await writeFile(join(factSourceRoot, "goal.md"), [
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
  ].join("\n"), "utf8");
}

// 正文自 H2 起（21 §8）：H1 由 assembleBody 从 title 生成，调用方不得自带。
function draftBody(d) {
  return [
    `## 摘要\n\n${d.summary}\n`,
    `## 授权范围\n\n${d.scope}\n`,
    `## 计划\n\n- ${d.plan[0].step}：判据——${d.plan[0].done_criteria}\n`,
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

async function read(root, uid) {
  return await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
}

/** 记录一条建前审核；返回 writer 结果供断言。 */
async function audit(root, uid, { verdict = "pass", summary = AUDIT_SUMMARY, identity = AUDITOR() } = {}) {
  const cur = await read(root, uid);
  return await recordWorkcaseAudit({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: cur.value.fingerprint,
    summary,
    verdict,
    changeSummary: "记录一条建前审核结论",
    sessionSignature: SIG(),
    sessionIdentity: identity,
  });
}

async function approve(root, uid, extra = {}) {
  const cur = await read(root, uid);
  return await approveWorkcaseObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: cur.value.fingerprint,
    approver: "human-test",
    controller: "controller-a",
    changeSummary: "Gate 1 批准",
    sessionSignature: SIG(),
    sessionIdentity: IMPLEMENTER(),
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 门禁一·时序闸（approve）
// ---------------------------------------------------------------------------

test("时序闸：无 pre_reviews 的 draft 被拒绝批准，且失败码指明「审核须先行落盘」(21 §14)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const res = await approve(root, uid);
    assert.ok(!res.ok, "无审核印记时不得批准");
    assert.equal(res.error.code, "workcase/pre_gate1_audit_proposal_required");
    // 零写入：状态仍为 draft，且未落 gate_1
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.status, "draft");
    assert.equal(after.value.frontmatter.gate_1, undefined);
  });
});

test("时序闸：审核落盘后批准放行（合法两步），并保留 pre_reviews 为历史 (21 §14)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const rec = await audit(root, uid);
    assert.ok(rec.ok, JSON.stringify(rec.error));
    const res = await approve(root, uid);
    assert.ok(res.ok, JSON.stringify(res.error));
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.status, "open");
    // 审核印记在 open 期保留为历史（§9.1 open 行）
    assert.equal(after.value.frontmatter.pre_reviews.length, 1);
    assert.equal(after.value.frontmatter.pre_reviews[0].verdict, "pass");
  });
});

// ---------------------------------------------------------------------------
// 门禁二·覆盖闸（approve）—— 「审完又改」
// ---------------------------------------------------------------------------

test("覆盖闸：「审完又改」后旧结论不覆盖当前候选，批准被拒（21 §14）", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const rec = await audit(root, uid);
    assert.ok(rec.ok, JSON.stringify(rec.error));

    // 审完之后改 plan（仍在 draft 期，属合法编辑）——候选内容变了，旧审核失效。
    const before = await read(root, uid);
    const changed = { ...before.value.frontmatter, plan: [{ step: "改后的步骤", done_criteria: "改后的判据。" }] };
    const edited = await reviseWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: changed,
      bodyMarkdownAfter: [
        `## 摘要\n\n${changed.summary}\n`,
        `## 授权范围\n\n${changed.scope}\n`,
        "## 计划\n\n- 改后的步骤：判据——改后的判据。\n",
      ].join("\n"),
      changeSummary: "审核后修改计划",
      sessionSignature: SIG(),
    });
    assert.ok(edited.ok, JSON.stringify(edited.error));

    const res = await approve(root, uid);
    assert.ok(!res.ok, "审完又改的候选不得沿用旧审核结论");
    assert.equal(res.error.code, "workcase/pre_gate1_audit_not_covering_candidate");
    // 旧条目仍在（历史不丢），但指纹已失配
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews.length, 1);
    assert.equal(after.value.frontmatter.status, "draft");
  });
});

test("覆盖闸：verdict=needs_revision 的结论不满足覆盖闸（21 §8 闭集）", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const rec = await audit(root, uid, { verdict: "needs_revision" });
    assert.ok(rec.ok, JSON.stringify(rec.error));
    const res = await approve(root, uid);
    assert.ok(!res.ok, "审核未通过时不得批准");
    assert.equal(res.error.code, "workcase/pre_gate1_audit_not_covering_candidate");
  });
});

// ---------------------------------------------------------------------------
// 门禁三·上限闸（record_audit）—— 21 §9.2「同一次审核事项最多 3 次」
// ---------------------------------------------------------------------------

test("上限闸：同一候选最多 3 条审核，第 4 条被拒并指明转 Human 裁决 (21 §9.2)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    for (let i = 1; i <= PRE_AUDIT_ENTRIES_PER_MATTER_MAX; i += 1) {
      const r = await audit(root, uid, { verdict: "needs_revision", summary: `第 ${i} 次审核：未通过（夹具）` });
      assert.ok(r.ok, `第 ${i} 条应被接受：${JSON.stringify(r.error)}`);
    }
    const over = await audit(root, uid, { verdict: "needs_revision", summary: "第 4 次审核（应被拒）" });
    assert.ok(!over.ok, "第 4 条必须被拒绝");
    assert.equal(over.error.code, "workcase/pre_gate1_audit_round_cap");
    // 零写入：条数仍为 3，状态仍为 draft
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews.length, PRE_AUDIT_ENTRIES_PER_MATTER_MAX);
    assert.equal(after.value.frontmatter.status, "draft");
  });
});

test("上限闸：计数以 candidate_fingerprint 为界——指纹一变即为新事项、计数归零 (21 §9.2)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    for (let i = 1; i <= PRE_AUDIT_ENTRIES_PER_MATTER_MAX; i += 1) {
      const r = await audit(root, uid, { verdict: "needs_revision", summary: `事项甲第 ${i} 次（夹具）` });
      assert.ok(r.ok, JSON.stringify(r.error));
    }
    // 改 plan ⇒ 新指纹 ⇒ 新事项，计数归零，可继续审
    const before = await read(root, uid);
    const changed = { ...before.value.frontmatter, plan: [{ step: "新事项步骤", done_criteria: "新事项判据。" }] };
    const edited = await reviseWorkcaseObject({
      factSourceRoot: root, objectUid: uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: changed,
      bodyMarkdownAfter: [
        `## 摘要\n\n${changed.summary}\n`,
        `## 授权范围\n\n${changed.scope}\n`,
        "## 计划\n\n- 新事项步骤：判据——新事项判据。\n",
      ].join("\n"),
      changeSummary: "改为新事项",
      sessionSignature: SIG(),
    });
    assert.ok(edited.ok, JSON.stringify(edited.error));
    const fresh = await audit(root, uid, { summary: "新事项第 1 次审核（夹具）" });
    assert.ok(fresh.ok, `指纹变化后计数应归零：${JSON.stringify(fresh.error)}`);
  });
});

// ---------------------------------------------------------------------------
// 审核通道的不可自证性（与复核轴同规格）
// ---------------------------------------------------------------------------

test("审核通道：非 draft 对象拒绝记录审核（审核轴只作用于尚未取得效力的候选）(21 §9.2)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    assert.ok((await audit(root, uid)).ok);
    assert.ok((await approve(root, uid)).ok);
    const late = await audit(root, uid);
    assert.ok(!late.ok, "open 期不得记录建前审核（其把关归复核轴）");
    assert.equal(late.error.code, "workcase/transition_invalid");
  });
});

test("审核通道：shell 来源身份被拒（该通道读可被调用方设置的环境变量）(21 §14)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const cur = await read(root, uid);
    // `authoritativeSessionIdentity` 在**构造期**就拒绝 source="shell"（返回 null），
    // 故写入器看到的是「无身份」而非「不可信来源」——两条路径都是 fail-closed，任一
    // 都不得落盘。此处接受两者，并断言零写入。
    const forged = authoritativeSessionIdentity({ sessionId: "session-forged", source: "shell", origin: "subagent" });
    const res = await recordWorkcaseAudit({
      factSourceRoot: root, objectUid: uid,
      expectedFingerprint: cur.value.fingerprint,
      summary: AUDIT_SUMMARY, verdict: "pass",
      changeSummary: "伪造来源尝试",
      sessionSignature: SIG(),
      sessionIdentity: forged,
    });
    assert.ok(!res.ok, "shell 来源身份不得作为审核凭据");
    assert.ok(
      res.error.code === "workcase/audit_identity_untrusted" || res.error.code === "workcase/audit_identity_unavailable",
      `期望 shell 身份被拒（untrusted 或 unavailable），实得 ${res.error.code}`,
    );
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews, undefined, "拒绝须为零写入");
  });
});

test("审核通道：verdict 闭集之外的取值 fail closed (21 §8)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const res = await audit(root, uid, { verdict: "looks_fine" });
    assert.ok(!res.ok, "未知 verdict 必须被拒（否则拼错的值会静默地永远无法满足覆盖闸）");
    assert.equal(res.error.code, "invalid_request");
  });
});

// ---------------------------------------------------------------------------
// 两轴分立：pre_reviews 与 reviews 互不替代、生命周期位置相反
// ---------------------------------------------------------------------------

test("两轴分立：draft 不得携带 reviews，但可携带 pre_reviews (21 §8/§9.1)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    assert.ok((await audit(root, uid)).ok, "draft 期 pre_reviews 合法");

    // draft 期注入 reviews ⇒ 拒绝（复核轴的对象是已发生的工作）
    const cur = await read(root, uid);
    const fm = { ...cur.value.frontmatter, reviews: [{ summary: "伪造的复核（夹具）" }] };
    const res = await reviseWorkcaseObject({
      factSourceRoot: root, objectUid: uid,
      expectedFingerprint: cur.value.fingerprint,
      frontmatterAfter: fm,
      bodyMarkdownAfter: cur.value.body.replace(/^#\s+.*\n+/, ""),
      changeSummary: "注入 reviews 尝试",
      sessionSignature: SIG(),
    });
    assert.ok(!res.ok, "draft 期不得携带 reviews");
  });
});

test("两轴分立：审核条目的指纹与授权指纹同源（同一函数算得）(21 §8/§10.1)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const rec = await audit(root, uid);
    assert.ok(rec.ok, JSON.stringify(rec.error));
    const after = await read(root, uid);
    const fm = after.value.frontmatter;
    const expected = computeAuthorizationFingerprint(fm.plan, fm.scope);
    assert.equal(fm.pre_reviews[0].candidate_fingerprint, expected,
      "candidate_fingerprint 必须与 computeAuthorizationFingerprint 同源——两处各写一套会使覆盖闸误判");
    // approve 落下的授权指纹亦应等于同一值
    assert.ok((await approve(root, uid)).ok);
    const opened = await read(root, uid);
    assert.equal(opened.value.frontmatter.gate_1.authorization_fingerprint, expected);
  });
});

test("重批（open→draft）作废 pre_reviews 与 reviews 两者，要点入 change_log (21 §9.2)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    assert.ok((await audit(root, uid)).ok);
    assert.ok((await approve(root, uid)).ok);

    const open = await read(root, uid);
    // 重批回 draft：正文不得携带「## 执行」节（draft carries no execution, 21 §8）。
    // 夹具的 open 对象带该节（批准时由 approve 写入），须先行剥除。
    const draftBodyFromOpen = open.value.body
      .replace(/^#\s+.*\n+/, "")
      .replace(/^##\s*执行[\s\S]*?(?=^##\s|\s*$)/m, "")
      .trimEnd() + "\n";
    const res = await rebatchWorkcaseObject({
      factSourceRoot: root, objectUid: uid,
      expectedFingerprint: open.value.fingerprint,
      frontmatterAfter: { ...open.value.frontmatter },
      bodyMarkdownAfter: draftBodyFromOpen,
      changeSummary: "局部重批（夹具）",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const back = await read(root, uid);
    assert.equal(back.value.frontmatter.status, "draft");
    assert.equal(back.value.frontmatter.pre_reviews, undefined,
      "重批后 pre_reviews 须作废（旧审核针对旧 plan/scope，其指纹必然失配）");
    assert.equal(back.value.frontmatter.reviews, undefined, "reviews 同样作废");
  });
});
