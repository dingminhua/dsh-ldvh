// 建前独立审核的**对象承载与三道机械门禁**（21 §8/§9.2/§14/§15.1，2026-10-16 建立）。
//
// 本工件钉住的是「审核轴」（Gate 1 前对候选找错）与「复核轴」（Gate 2 前对已发生
// 工作核对）的**分立**，以及为前者新增的三道门禁各自的**拒绝/放行两态**：
//   ① 时序闸（approve）：上一次落盘的 draft 须已带 pre_reviews —— 审核不得与批准同批写入；
//   ② 覆盖闸（approve）：须存在一条 candidate_fingerprint == 当前 plan+scope 指纹
//      且 verdict == pass 的条目 —— 「审完又改」的旧结论不覆盖当前候选；
//   ③ 上限闸（record_audit）：按 `round_index` 的不同值计轮次（2026-10-27 口径，
//      不因修订或 rebatch 重置），**开启第 4 轮**被拒；复用既有轮号不受此限——那是
//      达上限后的同轮定向复审出口（§9.2 条末段，2026-11-03 登记）。出口本身也须被
//      钉住：只测「第 4 轮被拒」的套件会把合法出口与旁路混为一谈。
//
// 为什么需要这组测试：修订前只有 Approve 的「第五要素非空」形式校验，故「审没审」
// 「审的是哪一版」「审到第几次」三者都不可机械核验（实测：workcase-c36b0208 的审核
// 结论为「建议修订，3 项必改」，该候选随后仍以 draft 进 Gate 1）。三道门禁若不被
// 拒绝态钉住，就只是装饰——一个只测放行路径的套件无法区分「闸生效」与「闸被旁路」。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { seedSubGoals, subGoalUid, withTemp } from "./helpers.mjs";
import {
  createWorkcaseObject,
  readWorkcaseObject,
  approveWorkcaseObject,
  recordWorkcaseAudit,
  executeWorkcaseObject,
  reviseWorkcaseObject,
  rebatchWorkcaseObject,
  computeAuthorizationFingerprint,
  computeAuditPartitions,
  auditCoverageFor,
  workcaseFileName,
  PRE_AUDIT_ROUNDS_MAX,
} from "../lib/workcase-writer.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "../lib/signature-channel.js";
import { normalizeCoveredPartitionsArg, normalizeRoundIndexArg } from "../lib/workcase-tools.js";

const SIG = () => authoritativeSignature({ provider: "test-provider", model: "test-model" });
const IDENTITY = (sessionId, origin = null) => authoritativeSessionIdentity({ sessionId, source: "host", origin });
/** 审核者是**受管辖隔离子代理**（21 §14 承载形式唯一）：origin="subagent"。 */
const AUDITOR = () => IDENTITY("session-auditor-test", "subagent");
const IMPLEMENTER = () => IDENTITY("session-implementer-test");

const DRAFT = {
  title: "建前审核门禁测试工单",
  gist: "夹具：钉住建前审核的对象承载与三道机械门禁。",
  serves: subGoalUid(1),
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
  ].join("\n"), "utf8");
  // 25 §7 (2026-11): sub-goals live in SubGoal objects. This fixture uses
  // goal_key=fixture-goal, so the carrier must carry the same parent_goal.
  await seedSubGoals(factSourceRoot, ["SG-1"], { parentGoal: "fixture-goal" });
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
async function audit(root, uid, { verdict = "pass", summary = AUDIT_SUMMARY, identity = AUDITOR(), roundIndex = null, coveredPartitionIds = null } = {}) {
  const cur = await read(root, uid);
  return await recordWorkcaseAudit({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: cur.value.fingerprint,
    summary,
    verdict,
    coveredPartitionIds,
    roundIndex,
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
// 门禁三·上限闸（record_audit）—— 21 §9.2「同一次审核事项最多 3 轮」
// ---------------------------------------------------------------------------

test("上限闸：第 4 轮被拒并指明转 Human 裁决（计数按轮次，不按条数）(21 §9.2)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    for (let i = 1; i <= PRE_AUDIT_ROUNDS_MAX; i += 1) {
      const r = await audit(root, uid, { verdict: "needs_revision", summary: `第 ${i} 轮：未通过（夹具）` });
      assert.ok(r.ok, `第 ${i} 轮应被接受：${JSON.stringify(r.error)}`);
    }
    const over = await audit(root, uid, { verdict: "needs_revision", summary: "第 4 轮（应被拒）" });
    assert.ok(!over.ok, "第 4 轮必须被拒绝");
    assert.equal(over.error.code, "workcase/pre_gate1_audit_round_cap");
    // 零写入：条数仍为 3，状态仍为 draft
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews.length, PRE_AUDIT_ROUNDS_MAX);
    assert.equal(after.value.frontmatter.status, "draft");
  });
});

test("上限闸：计数按审核事项轮次计——指纹变化不重置，第 4 轮被拒 (21 §9.2，2026-10-27 口径)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    for (let i = 1; i <= PRE_AUDIT_ROUNDS_MAX; i += 1) {
      const r = await audit(root, uid, { verdict: "needs_revision", summary: `事项甲第 ${i} 轮（夹具）` });
      assert.ok(r.ok, JSON.stringify(r.error));
    }
    // 改 plan ⇒ 整体指纹变化。旧口径（以 candidate_fingerprint 为界）会把计数
    // 归零、允许继续审——这正是 workcase-996e207a 建前审 6 轮却从不触顶的机制。
    // 新口径下轮次不因修订重置，第 4 轮须被拒。
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
    const fourth = await audit(root, uid, { summary: "第 4 轮审核（夹具）" });
    assert.ok(!fourth.ok, "指纹变化后轮次不应重置——第 4 轮须被拒");
    assert.equal(fourth.error.code, "workcase/pre_gate1_audit_round_cap");
  });
});

// 拒绝文案的可发现性（2026-11-03，承 8552a6f 之后的实测归因）。
//
// 为什么单列一条：出口写进规范但不出现在系统实际拦人的地方，等于没有出口。实测全库
// `round_index` 复用 0 例，而 workcase-7ec9833d 的 residual 逐字写着「该通道当时未被
// 知晓」——它的审核者第 3 轮已判「建议按上述订正后再入 Gate 1」，pass 就在手边。
// 所以这里钉的不是行为，是**文案**：`round_cap` 与覆盖闸的拒绝文本必须自己说出那条路。
// 文案被后人简化掉时，这条测试变红——否则下一次同样的事只会重演一遍。
test("拒绝文案的可发现性：round_cap 与覆盖闸的拒绝文本须自行指出复用轮号的出口 (21 §9.2 条末段)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    for (let i = 1; i <= PRE_AUDIT_ROUNDS_MAX; i += 1) {
      assert.ok((await audit(root, uid, { verdict: "needs_revision", summary: `第 ${i} 轮（夹具）` })).ok);
    }
    // round_cap 的拒绝文案
    const capped = await audit(root, uid, { summary: "试图开第 4 轮（夹具）" });
    assert.ok(!capped.ok);
    assert.equal(capped.error.code, "workcase/pre_gate1_audit_round_cap");
    const capMsg = String(capped.error.message || "");
    assert.match(capMsg, /复用既有轮号/, "round_cap 拒绝文案须指出复用轮号的出口，实际：" + capMsg);
    assert.match(capMsg, /round_index/, "round_cap 拒绝文案须给出可操作的参数名");

    // 覆盖闸的拒绝文案（零 pass 条目时）
    const blocked = await approve(root, uid);
    assert.ok(!blocked.ok);
    assert.equal(blocked.error.code, "workcase/pre_gate1_audit_not_covering_candidate");
    const coverMsg = String(blocked.error.message || "");
    assert.match(coverMsg, /复用既有轮号/, "覆盖闸拒绝文案须指出复用轮号的出口，实际：" + coverMsg);
  });
});

// `round_index` 的取值闭集（2026-11-03 复审发现）。
//
// 受控工具面原来用 `Number.isInteger(args?.round_index) ? args.round_index : null` 分流，
// 非整数（如 2.5）会被**静默归一为「省略」**、按新轮处理——非法值拿到一个合法结果，
// 而 21 §8 写的是「正整数」。工具面已改为只把「未提供」归一为 null、其余原样透传，
// 由 writer 判正整数。本条钉住 writer 侧的拒绝，防它再次被上游吞掉。
test("round_index 取值闭集：非整数被拒，不静默归一为省略 (21 §8「正整数」)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    for (const bad of [2.5, 0, -1]) {
      const r = await audit(root, uid, { summary: `非法 round_index ${bad}（夹具）`, roundIndex: bad });
      assert.ok(!r.ok, `round_index=${bad} 必须被拒绝`);
      assert.equal(r.error.code, "invalid_request", `round_index=${bad} 应得 invalid_request`);
    }
    // 零写入
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews, undefined, "拒绝须为零写入");
  });
});

// 上限闸的**出口**（21 §9.2 条末段，2026-11-03 Human 决定）。
//
// 为什么必须钉住这一条：上限闸只拒绝**开启新轮**，复用既有 `round_index` 是规范
// 写明的合法通道——三轮用尽后若审核者已就当前候选判定通过，可复用既有轮号补记
// `pass` 并进 Gate 1。实测 workcase-7ec9833d 第 3 轮审核者自陈「三维已全符合、
// 仅剩两处文案订正」，本可复用该轮记 pass 直接过闸，实际因无人知晓该路径而以
// cancelled 收场。只钉「第 4 轮被拒」而不钉「复用轮号放行」的套件，会把合法出口
// 与旁路混为一谈，也无法阻止将来把两者一起收紧。

test("上限闸的出口：三轮用尽后可复用既有轮号补记 pass 并过覆盖闸 (21 §9.2 条末段，2026-11-03)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    for (let i = 1; i <= PRE_AUDIT_ROUNDS_MAX; i += 1) {
      assert.ok((await audit(root, uid, { verdict: "needs_revision", summary: `第 ${i} 轮：未通过（夹具）` })).ok);
    }
    // 开新轮仍被拒——出口不是「取消上限」
    const blocked = await audit(root, uid, { verdict: "pass", summary: "试图开第 4 轮（应被拒）" });
    assert.ok(!blocked.ok, "开新轮仍须被拒绝");
    assert.equal(blocked.error.code, "workcase/pre_gate1_audit_round_cap");

    // 复用既有轮号补记 pass：放行，且是该轮定向复审的承载
    const reused = await audit(root, uid, { verdict: "pass", summary: "复用第 3 轮：复审后判定通过（夹具）", roundIndex: PRE_AUDIT_ROUNDS_MAX });
    assert.ok(reused.ok, "复用既有轮号补记 pass 须被放行：" + JSON.stringify(reused.error));
    const after = await read(root, uid);
    const last = after.value.frontmatter.pre_reviews.at(-1);
    assert.equal(last.round_index, PRE_AUDIT_ROUNDS_MAX);
    assert.equal(last.verdict, "pass");
    // 轮次计数不因复用得以上涨——上限仍是「不同 round_index 值个数」
    assert.equal(new Set(after.value.frontmatter.pre_reviews.map((e) => e.round_index)).size, PRE_AUDIT_ROUNDS_MAX);

    // 覆盖闸因这条 pass 而满足，Gate 1 可过
    const coverage = auditCoverageFor(after.value.frontmatter.plan, after.value.frontmatter.scope, after.value.frontmatter.pre_reviews);
    assert.deepEqual(coverage.uncovered, [], "复用轮号的 pass 须提供完整覆盖：" + JSON.stringify(coverage));
    const ok = await approve(root, uid);
    assert.ok(ok.ok, "覆盖闸满足后应放行 Gate 1：" + JSON.stringify(ok.error));
  });
});

test("上限闸的出口：复用轮号的 pass 仍受覆盖闸约束——只覆盖部分分区时其余仍须重审 (21 §9.2/§15.1)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    for (let i = 1; i <= PRE_AUDIT_ROUNDS_MAX; i += 1) {
      assert.ok((await audit(root, uid, { verdict: "needs_revision", summary: `第 ${i} 轮：未通过（夹具）` })).ok);
    }
    const cur = await read(root, uid);
    const partitions = computeAuditPartitions(cur.value.frontmatter.plan, cur.value.frontmatter.scope);
    const onlyPlan = partitions.filter((p) => p.kind === "plan").map((p) => p.id);
    // 只声明 plan 分区：复用轮号放行，但覆盖闸须如实报出未覆盖的 scope 分区
    const reused = await audit(root, uid, { verdict: "pass", summary: "复用第 3 轮：只复审了 plan（夹具）", roundIndex: PRE_AUDIT_ROUNDS_MAX, coveredPartitionIds: onlyPlan });
    assert.ok(reused.ok, JSON.stringify(reused.error));
    const after = await read(root, uid);
    const coverage = auditCoverageFor(after.value.frontmatter.plan, after.value.frontmatter.scope, after.value.frontmatter.pre_reviews);
    assert.ok(coverage.uncovered.length > 0, "未声明覆盖的 scope 分区须仍被视为未覆盖");
    const blocked = await approve(root, uid);
    assert.ok(!blocked.ok, "覆盖不全时仍须拒绝批准");
    assert.equal(blocked.error.code, "workcase/pre_gate1_audit_not_covering_candidate");
  });
});

// 本条钉住本次修订的**真实场景**：修订（改 plan/scope）之后复用既有轮号补记 pass。
// 与上一条的区别：上一条的候选内容全程不变，只验证「覆盖不全要拦」；本条必须有内容
// 变更，否则「按当前候选的指纹匹配」这一层根本没被触发——而它正是复用通道的全部风险
// 所在（拿旧候选的 pass 覆盖新候选）。
test("上限闸的出口：修订后复用既有轮号——旧 pass 不覆盖新内容，须就当前候选重新判定 (21 §9.2/§15.1)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    for (let i = 1; i <= PRE_AUDIT_ROUNDS_MAX; i += 1) {
      assert.ok((await audit(root, uid, { verdict: "needs_revision", summary: `第 ${i} 轮：未通过（夹具）` })).ok);
    }
    // 修订：改掉一个 plan 步骤，使该分区指纹变化
    const before = await read(root, uid);
    const plan = before.value.frontmatter.plan.map((p, i) => (i === 0 ? { ...p, step: p.step + "（第 3 轮订正后）" } : p));
    const revised = await reviseWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: before.value.fingerprint,
      bodyMarkdownAfter: draftBody({ ...before.value.frontmatter, plan, scope: before.value.frontmatter.scope }),
      plan,
      changeSummary: "按第 3 轮意见订正 plan 首步骤",
      sessionSignature: SIG(),
      sessionIdentity: AUDITOR(),
    });
    assert.ok(revised.ok, JSON.stringify(revised.error));

    // 变更后：计划分区 fingerprint 已变，无任何条目覆盖它
    const mid = await read(root, uid);
    const staleCoverage = auditCoverageFor(mid.value.frontmatter.plan, mid.value.frontmatter.scope, mid.value.frontmatter.pre_reviews);
    assert.ok(staleCoverage.uncovered.length > 0, "修订后旧 pass 不得覆盖新内容");
    const blockedBeforeReaudit = await approve(root, uid);
    assert.ok(!blockedBeforeReaudit.ok, "未就当前候选重新审核时不得批准");
    assert.equal(blockedBeforeReaudit.error.code, "workcase/pre_gate1_audit_not_covering_candidate");

    // 就当前候选复用既有轮号补记 pass：覆盖闸满足，轮次计数不变
    const reaudited = await audit(root, uid, { verdict: "pass", summary: "复用第 3 轮：就订正后的当前候选复审通过（夹具）", roundIndex: PRE_AUDIT_ROUNDS_MAX });
    assert.ok(reaudited.ok, JSON.stringify(reaudited.error));
    const after = await read(root, uid);
    assert.equal(new Set(after.value.frontmatter.pre_reviews.map((e) => e.round_index)).size, PRE_AUDIT_ROUNDS_MAX, "复用不增加轮次计数");
    const coverage = auditCoverageFor(after.value.frontmatter.plan, after.value.frontmatter.scope, after.value.frontmatter.pre_reviews);
    assert.deepEqual(coverage.uncovered, [], JSON.stringify(coverage));
    const ok = await approve(root, uid);
    assert.ok(ok.ok, "就当前候选复审后应放行 Gate 1：" + JSON.stringify(ok.error));
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
    // **只断言实际可达的那个码**。`hostSessionIdentity`（lib/workcase-writer.js:2652）
    // 把所有非 `source="host"` 的身份一律解析为 null，故 writer 里
    // `identity.source === "shell"` 的分支（:3246、:3376）在本实现下**不可达**，
    // `workcase/audit_identity_untrusted` 与 `workcase/review_identity_untrusted`
    // 目前是无出口的失败码。此处接受两个码会让该用例对 shell 分支零判别力——
    // 实测证明走的是 unavailable。
    assert.equal(
      res.error.code,
      "workcase/audit_identity_unavailable",
      `shell 身份在上游已被归一为「无身份」，故只应得 unavailable，实得 ${res.error.code}`,
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

test("重批（open→draft）作废 reviews、保留 pre_reviews 为审核流水（21 §9.2，2026-10-27 口径）", async () => {
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
    // 2026-10-27 改口径：重批保留审核流水。分区指纹按内容匹配，旧审核不会被
    // 误用为「当前内容已审」；清零反而会把轮次计数一起丢掉，使「重批后再审
    // 3 轮」成为绕过上限的新路径。
    assert.ok(Array.isArray(back.value.frontmatter.pre_reviews)
      && back.value.frontmatter.pre_reviews.length === 1,
      "重批后 pre_reviews 保留为历史（未变分区可沿用既有 pass；轮次跨重批累计）");
    assert.equal(back.value.frontmatter.reviews, undefined, "reviews 随授权失效作废");
  });
});

// ---------------------------------------------------------------------------
// 旁路封堵（承独立复核 F1/F2，2026-10-16）
//
// 上面各组用例全部经 `recordWorkcaseAudit()` 这个受控写入器造夹具，即只覆盖了
// **正常写入路径**。独立复核实测出两条致命旁路，且 0 覆盖：
//
//   F1：`revise` 把调用方 frontmatterAfter 整体作为 next，pre_reviews 不在托管
//       字段重设清单里 ⇒ 一次 revise 即可自造一条 verdict=pass、指纹正确的条目，
//       随后 approve 两道闸全部放行；`create` 同样可携带该字段。
//   F2：先由子代理如实记一条 needs_revision，再用 revise 把它改写为 pass。
//
// 修复为「结构性剥离」（guardAuditField）与「create 拒绝携带」。以下用例钉住
// 这两条旁路**必须不可用**——若无这些用例，上面 12 组全绿也无法区分
// 「闸生效」与「闸被旁路」。
// ---------------------------------------------------------------------------

/** 造一条「看起来完全合法」的伪审核条目（形状与 Code 盖戳的真条目一致）。 */
function forgedAuditEntry(root, uid, { verdict = "pass" } = {}) {
  return {
    at: new Date().toISOString(),
    provider: "forged-provider",
    model: "forged-model",
    summary: "主控自写：对象恰当性符合；方案可行性符合；scope 清晰度符合（伪造）",
    session_id: "session-implementer-test",
    session_source: "host",
    auditor_origin: "subagent",
    verdict,
  };
}

test("旁路封堵 F1：revise 伪造 pre_reviews 被结构性剥离，随后批准仍被时序闸拒绝", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);

    // 前置：无审核 ⇒ 批准被拒（证明闸在「伪造之前」是生效的）
    const denied = await approve(root, uid);
    assert.equal(denied.error?.code, "workcase/pre_gate1_audit_proposal_required");

    // 攻击：一次 revise 自造一条 pass 条目（指纹填当前值）
    const before = await read(root, uid);
    const fm = before.value.frontmatter;
    const forged = forgedAuditEntry(root, uid);
    forged.candidate_fingerprint = computeAuthorizationFingerprint(fm.plan, fm.scope);
    const attack = await reviseWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: { ...fm, pre_reviews: [forged] },
      bodyMarkdownAfter: before.value.body.replace(/^#\s+.*\n+/, ""),
      changeSummary: "尝试伪造审核印记",
      sessionSignature: SIG(),
    });
    assert.ok(attack.ok, "revise 本身应成功（回落而非拒绝整次写入）：" + JSON.stringify(attack.error));

    // 关键断言：伪造的条目**没有落盘**
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews, undefined,
      "revise 提交的 pre_reviews 必须被剥离——否则唯一写路径失效（F1）");

    // 关键断言：批准仍被拒（闸没有被旁路绕过）
    const stillDenied = await approve(root, uid);
    assert.ok(!stillDenied.ok, "剥离后不得放行");
    assert.equal(stillDenied.error.code, "workcase/pre_gate1_audit_proposal_required",
      "闸仍须以「无审核印记」拒绝，而不是换了别的理由");
  });
});

test("旁路封堵 F1b：create 携带 pre_reviews 被拒绝（不得在建单瞬间自造审核印记）", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const draft = {
      ...DRAFT,
      pre_reviews: [{
        at: new Date().toISOString(),
        provider: "p", model: "m", summary: "伪造（create）",
        session_id: "s", session_source: "host", auditor_origin: "subagent",
        candidate_fingerprint: computeAuthorizationFingerprint(DRAFT.plan, DRAFT.scope),
        verdict: "pass",
      }],
    };
    const created = await createWorkcaseObject({
      factSourceRoot: root,
      frontmatterDraft: draft,
      bodyMarkdown: draftBody(draft),
      sessionSignature: SIG(),
    });
    assert.ok(!created.ok, "create 携带 pre_reviews 必须被拒绝");
    assert.equal(created.error.code, "workcase/frontmatter_invalid");
  });
});

test("旁路封堵 F2：已盖戳的 needs_revision 审核条目不可被 revise 改写为 pass", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    // 子代理如实记一条未通过
    const rec = await audit(root, uid, { verdict: "needs_revision", summary: "对象恰当性不符：未覆盖 §6.3 排除项（真审核）" });
    assert.ok(rec.ok, JSON.stringify(rec.error));

    const before = await read(root, uid);
    const fm = before.value.frontmatter;
    const original = fm.pre_reviews[0];
    assert.equal(original.verdict, "needs_revision");

    // 攻击：用 revise 把该条改成 pass
    const tampered = { ...original, verdict: "pass", summary: "改写：全部符合" };
    const attack = await reviseWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: { ...fm, pre_reviews: [tampered] },
      bodyMarkdownAfter: before.value.body.replace(/^#\s+.*\n+/, ""),
      changeSummary: "尝试改写审核结论",
      sessionSignature: SIG(),
    });
    assert.ok(attack.ok, "整次写入应成功（该字段被回落），而非整单失败");

    // 关键断言：条目逐字未变
    const after = await read(root, uid);
    const kept = after.value.frontmatter.pre_reviews[0];
    assert.equal(kept.verdict, "needs_revision", "verdict 不得被改写（F2）");
    assert.equal(kept.summary, original.summary, "summary 不得被改写（F2）");
    assert.equal(kept.session_id, original.session_id, "署名不得被改写（F2）");

    // 关键断言：批准仍被拒
    const denied = await approve(root, uid);
    assert.ok(!denied.ok, "needs_revision 不得放行");
    assert.equal(denied.error.code, "workcase/pre_gate1_audit_not_covering_candidate");
  });
});

test("旁路封堵：execute 同样不得改写 pre_reviews（唯一写路径是 record_audit）", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    assert.ok((await audit(root, uid)).ok);
    assert.ok((await approve(root, uid)).ok);

    // open 期经 execute 尝试替换审核流水
    const before = await read(root, uid);
    const fm = before.value.frontmatter;
    const attack = await executeWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: { ...fm, pre_reviews: [] },
      bodyMarkdownAfter: before.value.body.replace(/^#\s+.*\n+/, ""),
      changeSummary: "尝试清空审核流水",
      sessionSignature: SIG(),
      sessionIdentity: IMPLEMENTER(),
    });
    assert.ok(attack.ok, "整次写入应成功（该字段回落）");
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews.length, 1,
      "execute 不得增删 pre_reviews（F1 的 execute 变体）");
  });
});

// ---------------------------------------------------------------------------
// 承载形式门禁与回滚留痕（承第二轮独立复核 G1/G2，2026-10-16）
//
// G1：writer 层对 auditor_origin 曾零校验 ⇒ 实施者用**自己 root 会话**自记一条
//     pass（根本不派生审核体）即可过覆盖闸。关闭侧早有同类门禁
//     （reviewer_origin === "subagent"），审核侧此前漏掉对称的那一道。
// G2：guardAuditField 的 attempted 标志曾被丢弃 ⇒ 回滚静默无痕，而 §14 明文
//     承诺「改动过则在写入结果中如实登记」。
// ---------------------------------------------------------------------------

test("G1：非子代理来源的审核（root 会话自审）不满足覆盖闸 (21 §14)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    // 自审：origin = null（root 会话自己记的），指纹与 verdict 都正确
    const selfAudit = await audit(root, uid, {
      summary: "对象恰当性符合；方案可行性符合；scope 清晰度符合（自审，非子代理）",
      identity: IDENTITY("session-implementer-test"),
    });
    assert.ok(selfAudit.ok, "记录本身应成功（通道不拒绝落盘）");

    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews[0].auditor_origin, null,
      "前置：该条目来源确为 root 会话（auditor_origin 非 subagent）");

    // 关键断言：自审不得满足覆盖闸
    const denied = await approve(root, uid);
    assert.ok(!denied.ok, "root 会话自审不得放行 Gate 1");
    assert.equal(denied.error.code, "workcase/pre_gate1_audit_not_covering_candidate");
  });
});

test("G1b：子代理来源的审核满足覆盖闸（正向对照，证明门禁不是一律拒绝）", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    assert.ok((await audit(root, uid)).ok); // 默认 AUDITOR() origin=subagent
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews[0].auditor_origin, "subagent");
    const ok = await approve(root, uid);
    assert.ok(ok.ok, "子代理来源的通过结论应放行：" + JSON.stringify(ok.error));
  });
});

test("G2：revise 回滚被篡改的 pre_reviews 时，change_log 如实留痕（不静默）(21 §14)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    assert.ok((await audit(root, uid, { verdict: "needs_revision" })).ok);

    const before = await read(root, uid);
    const fm = before.value.frontmatter;
    const attack = await reviseWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: { ...fm, pre_reviews: [] }, // 尝试清空
      bodyMarkdownAfter: before.value.body.replace(/^#\s+.*\n+/, ""),
      changeSummary: "尝试清空审核流水",
      sessionSignature: SIG(),
    });
    assert.ok(attack.ok, JSON.stringify(attack.error));

    // 关键断言：回滚必须留痕（G2）
    const after = await read(root, uid);
    const lastEntry = after.value.frontmatter.change_log.at(-1);
    assert.match(lastEntry.summary, /pre_reviews/,
      "change_log 末条须记载 pre_reviews 被回落——否则伪造无痕可查（G2）");
    assert.match(lastEntry.summary, /回落|唯一写路径/);
  });
});

test("G2b：未改动 pre_reviews 的正常写回不产生留痕噪音", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    assert.ok((await audit(root, uid)).ok);
    const before = await read(root, uid);
    const fm = before.value.frontmatter;
    // 整对象写回，pre_reviews 原样带上（正常的「读出-改一处-写回」形态）
    const res = await reviseWorkcaseObject({
      factSourceRoot: root,
      objectUid: uid,
      expectedFingerprint: before.value.fingerprint,
      frontmatterAfter: { ...fm, gist: `${fm.gist}（已微调）` },
      bodyMarkdownAfter: before.value.body.replace(/^#\s+.*\n+/, ""),
      changeSummary: "微调要点",
      sessionSignature: SIG(),
    });
    assert.ok(res.ok, JSON.stringify(res.error));
    const after = await read(root, uid);
    const lastEntry = after.value.frontmatter.change_log.at(-1);
    assert.doesNotMatch(lastEntry.summary, /回落/,
      "原样带上的 pre_reviews 不应被记为「回落」——否则正常写回全被打上伪造嫌疑");
  });
});

// ---------------------------------------------------------------------------
// A（2026-11-03 第三轮复审）：`covered_partitions` 的**非数组形态**一律拒绝
// ---------------------------------------------------------------------------
// 原实现用 `Array.isArray` 分流：数组走校验、非数组落到 `else` 取全部分区。于是
// 「更畸形的入参」（字符串／数字）拿到「更宽松的结果」（覆盖全部分区、可通过覆盖闸），
// 而更接近正确的空数组反被拒。审核者写错一个括号就得到自己从未声明的全分区覆盖，
// 且落盘记录上看不出来——与 21 §15.1「不静默忽略、不降级」直接冲突。

test("A：covered_partitions 传字符串被拒，不静默当作「省略」而展开成全部分区 (21 §8/§15.1)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const r = await audit(root, uid, { coveredPartitionIds: "plan#1" });
    assert.ok(!r.ok, "字符串形态必须被拒绝，不得被当作省略");
    assert.equal(r.error.code, "invalid_request");
    assert.match(r.error.message, /covered_partitions/);
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews, undefined, "拒绝须为零写入");
  });
});

test("A：covered_partitions 传数字被拒（同上，非数组既非省略也非声明）(21 §8/§15.1)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const r = await audit(root, uid, { coveredPartitionIds: 42 });
    assert.ok(!r.ok, "数字形态必须被拒绝");
    assert.equal(r.error.code, "invalid_request");
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews, undefined, "拒绝须为零写入");
  });
});

test("A：covered_partitions 传空数组被拒（无覆盖不等于覆盖全部分区）(21 §8)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const r = await audit(root, uid, { coveredPartitionIds: [] });
    assert.ok(!r.ok, "空数组必须被拒绝");
    assert.equal(r.error.code, "invalid_request");
    const after = await read(root, uid);
    assert.equal(after.value.frontmatter.pre_reviews, undefined, "拒绝须为零写入");
  });
});

test("A：covered_partitions 显式 null 与「省略」同义，落盘为全部分区 (21 §8:147)", async () => {
  // R1：规范把显式 `null` 归入「省略」而非「非数组值」。此例钉住该语义——若有人把
  // null 改成拒绝，或把「省略」改成不展开全部分区，这条会红。
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const r = await audit(root, uid, { coveredPartitionIds: null });
    assert.ok(r.ok, `显式 null 应被接受（与省略同义）：${JSON.stringify(r.error)}`);
    const after = await read(root, uid);
    const partitions = computeAuditPartitions(DRAFT.plan, DRAFT.scope);
    const stored = after.value.frontmatter.pre_reviews[0].covered_partitions;
    assert.equal(stored.length, partitions.length, "null 与省略同义，须落盘为全部分区");
    assert.deepEqual(
      stored.map((p) => p.id).sort(),
      partitions.map((p) => p.id).sort(),
      "落盘的分区 id 须是当前候选的全部分区",
    );
  });
});

// ---------------------------------------------------------------------------
// 工具面入参归一（21 §8:147）—— 此前无任何测试，回退成 fail-open 时套件仍全绿
// ---------------------------------------------------------------------------
// 第四轮独立复审 M3 变异实测：把 workcase-tools.js 的归一化改回
// `Array.isArray(v) ? v : null`，A 组三条用例**全部仍绿**——因为 A 组直调 writer，
// 绕过了工具面那一行。它因此是「未被钉住的承重行」：回退即恢复原始 fail-open。
// 抽出 normalizeCoveredPartitionsArg / normalizeRoundIndexArg 两个纯函数后在此钉住。

test("工具面归一：covered_partitions 只把「未提供」归为 null，其余形态原样透传 (21 §8:147)", () => {
  assert.equal(normalizeCoveredPartitionsArg(undefined), null, "undefined 是「未提供」");
  assert.equal(normalizeCoveredPartitionsArg(null), null, "显式 null 与省略同义");
  // 以下五种都不是「未提供」：必须原样透传给 writer，由它拒绝。
  // 若这里改回 Array.isArray 分流，字符串/数字/对象会被静默变成 null → 全分区覆盖。
  assert.equal(normalizeCoveredPartitionsArg("plan#1"), "plan#1", "字符串须原样透传，不得归一为 null");
  assert.equal(normalizeCoveredPartitionsArg(42), 42, "数字须原样透传");
  const obj = { id: "plan#1" };
  assert.equal(normalizeCoveredPartitionsArg(obj), obj, "对象须原样透传");
  assert.deepEqual(normalizeCoveredPartitionsArg([]), [], "空数组须原样透传，由 writer 拒绝");
  const arr = ["plan#1"];
  assert.equal(normalizeCoveredPartitionsArg(arr), arr, "合法数组原样透传");
});

test("工具面归一：round_index 只把「未提供」归为 null，非整数原样透传 (21 §8:147「正整数」)", () => {
  assert.equal(normalizeRoundIndexArg(undefined), null);
  assert.equal(normalizeRoundIndexArg(null), null);
  // 2.5 若被归一为 null 就会「按新轮处理」——让一个非法值拿到合法结果。
  assert.equal(normalizeRoundIndexArg(2.5), 2.5, "非整数须原样透传，由 writer 判正整数并拒绝");
  assert.equal(normalizeRoundIndexArg(0), 0, "0 须原样透传（writer 判 >= 1）");
  assert.equal(normalizeRoundIndexArg(-1), -1, "负数须原样透传");
  assert.equal(normalizeRoundIndexArg(3), 3, "合法正整数原样透传");
});

// ---------------------------------------------------------------------------
// 存量条目的轮次补记（21 §9.2「存量条目的补记」）—— 此前全仓零测试
// ---------------------------------------------------------------------------
// 2026-10-27 之前落盘的条目可能不含 `round_index`。规范要求「按落盘顺序依次计为
// 第 1、2、…轮」，即它们**已消耗**同等数目轮次，不因口径改换而免计。若这条补记
// 被拿掉，存量对象会凭空重获 3 轮额度——这正是 F1 阻断所指的相反读法。
test("存量补记：无 round_index 的存量条目各占一轮，耗尽后开启新轮被拒 (21 §9.2 补记)", async () => {
  await withTemp("wc-audit-", async (root) => {
    await seedGoal(root);
    const uid = await createDraft(root);
    const cur = await read(root, uid);
    const fm = cur.value.frontmatter;
    const whole = computeAuthorizationFingerprint(fm.plan, fm.scope);
    // 模拟 2026-10-27 之前落盘的三条：不含 `round_index` 字段。
    fm.pre_reviews = [1, 2, 3].map((i) => ({
      at: `2026-10-2${i}T00:00:00.000Z`,
      provider: "test-provider",
      model: "test-model",
      summary: `存量第 ${i} 条（无 round_index，夹具）`,
      session_id: "session-auditor-test",
      session_source: "host",
      auditor_origin: "subagent",
      candidate_fingerprint: whole,
      verdict: "needs_revision",
    }));
    await writeFile(join(root, "workcases", workcaseFileName(uid)),
      `---\n${stringifyYaml(fm, { lineWidth: 0 })}---\n\n${cur.value.body}\n`, "utf8");

    // 补记口径成立时：3 条存量已占满 3 轮，开启第 4 轮必须被拒。
    const over = await audit(root, uid, { verdict: "needs_revision", summary: "第 4 轮（应被拒）" });
    assert.ok(!over.ok, "3 条存量各占一轮，第 4 轮必须被拒（若补记失效，此轮会被放行）");
    assert.equal(over.error.code, "workcase/pre_gate1_audit_round_cap");

    // 反向对照：复用既有轮号仍可记录（补记占满额度不等于通道封闭）。
    const reuse = await audit(root, uid, { verdict: "pass", summary: "复用第 1 轮", roundIndex: 1 });
    assert.ok(reuse.ok, `复用既有轮号应被放行：${JSON.stringify(reuse.error)}`);
  });
});
