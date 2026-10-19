// WorkCase × 宿主推进目标 的工具层契约（specs/21 §14「宿主推进目标」，接入形态 specs/10 §5.8）。
//
// 行为断言（不是源码文本断言）：经**真实注册**的 `ldvh_workcase_write` 工具调用，
// 断言调用方实际收到的信封与对象实际发生的变化。要钉的是三件事：
//
//   1. approve／execute 成功时，宿主目标确实被设置／恢复，且信封把这一步如实报出；
//   2. 宿主目标服务**不可用**时，写入被**拒绝**且对象**没有变**（fail-closed，
//      不降级、不静默跳过）——「对象前进了、目标没跟上」的半态在此被挡住；
//   3. 当前目标指向**另一对象**时拒绝写入，且**不碰**那个目标。
//
// 边界：本文件用内存假服务替代宿主服务，只证明「插件的决定与调用顺序」；
// 宿主自身行为以其 Inspect 通道取得的契约为准（`goals.get/create/edit/resume/
// pause/complete/clear`，`GoalView{phase, activation, revision}`），本文件不证明宿主照此行事。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { withTemp, sessionPersistenceWithRoutingLog } from "./helpers.mjs";
import { registerWorkcaseTools } from "../lib/workcase-tools.js";
import { createWorkcaseObject, readWorkcaseObject, recordWorkcaseAudit } from "../lib/workcase-writer.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "../lib/signature-channel.js";
import { goalObjectiveFor } from "../lib/workcase-goals.js";

const SIG = () => authoritativeSignature({ provider: "test-provider", model: "test-model" });

/** 工具返回体包在 `{envelope}` 里；断言针对信封本身。 */
const env = (out) => out.envelope ?? out;

function collectorCtx() {
  const tools = new Map();
  return {
    ctx: { tools: { register: (descriptor) => { tools.set(descriptor.name, descriptor); return () => tools.delete(descriptor.name); } } },
    tools,
  };
}

async function writeCarrier(home, projectPath) {
  const dir = join(home, "ldvh");
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);
  const file = join(dir, "governed-projects.yaml");
  await writeFile(file, [
    "schema_version: 1",
    "governance_instance_name: Test",
    "product_description: Test",
    "projects:",
    "  - id: p1",
    "    name: P1",
    `    path: ${projectPath}`,
    'default_project_id: "p1"',
    "",
  ].join("\n"));
  await chmod(file, 0o600);
  return file;
}

function fakeGoals(seed) {
  const calls = [];
  let current = seed;
  return {
    calls,
    current: () => current,
    get: () => current,
    create: (agent, request) => {
      calls.push(["create", request.objective]);
      current = { id: "g-1", revision: 1, objective: request.objective, phase: "active", activation: "armed" };
      return current;
    },
    edit: (agent, ref, request) => {
      calls.push(["edit", request.objective]);
      current = { ...current, ...request, revision: ref.revision + 1 };
      return current;
    },
    resume: (agent, ref) => {
      calls.push(["resume"]);
      current = { ...current, phase: "active", activation: "armed", revision: ref.revision + 1 };
      return current;
    },
    pause: (agent, ref) => {
      calls.push(["pause"]);
      current = { ...current, phase: "paused", activation: "disarmed", revision: ref.revision + 1 };
      return current;
    },
    complete: (agent, ref) => {
      calls.push(["complete"]);
      current = { ...current, phase: "complete", activation: "disarmed", revision: ref.revision + 1 };
      return current;
    },
    clear: (agent, ref) => {
      calls.push(["clear"]);
      current = undefined;
      return { id: ref.id, revision: ref.revision + 1 };
    },
  };
}

const DRAFT = {
  title: "宿主推进目标契约用例",
  gist: "钉住 WorkCase 写入点与宿主推进目标的一致性。",
  summary: "本单用于钉住写入点与宿主推进目标的一致性：批准与接手设置或恢复目标，收口点完成、清除或暂停目标；服务不可用或目标指向他对象时拒绝写入。",
  scope: "做什么：\n- 钉住五个写入点与宿主目标的一致性\n\n明确不做什么：\n- 不证明宿主自身行为",
  plan: [{ step: "钉住写入点", done_criteria: "五个写入点的目标侧动作各有断言" }],
};

const GATE1_REQUEST = {
  independent_review: "one isolated subagent",
  unauthorized_action_guard: "writer refuses out-of-scope writes",
  pre_creation_review: "pre-Gate-1 isolated-subagent review conclusion: 对象恰当/方案可行/scope 清晰（21 §14 Gate 1 前置·建前独立审核）",
  unverified_scope_and_risks: "host signature behavior unverified",
  approved_scope_and_next: "execute plan step 1",
};

/** 建一个 draft 工件并注册工具；`goals` 为 undefined 即模拟服务缺失。 */
async function surface(base, goals) {
  const projectDir = join(base, "project");
  await mkdir(projectDir, { recursive: true });
  await writeCarrier(base, projectDir);
  const factSourceRoot = join(projectDir, "ldvh-base");
  // `serves: SG-n` 须在 goal.md 中解析得到锚点（21 §10.1：无锚点则 Gate 1 无法受理）。
  await mkdir(factSourceRoot, { recursive: true });
  await writeFile(join(factSourceRoot, "goal.md"), [
    "---",
    "goal_key: project-goal",
    "title: 夹具项目目标",
    "status: active",
    "---",
    "",
    "# 项目目标",
    "",
    "## 目标陈述",
    "",
    "夹具。",
    "",
    "## 子目标",
    "",
    "SG-1 夹具子目标。",
    "",
  ].join("\n"));
  const created = await createWorkcaseObject({
    factSourceRoot,
    frontmatterDraft: { ...DRAFT, serves: "SG-1", change_summary: "初始落盘" },
    bodyMarkdown: `## 摘要\n${DRAFT.summary}\n\n## 授权范围\n${DRAFT.scope}\n\n## 计划\n1. ${DRAFT.plan[0].step}\n   完成判据：${DRAFT.plan[0].done_criteria}\n`,
    sessionSignature: SIG(),
  });
  assert.ok(created.ok, `fixture: ${JSON.stringify(created.error)}`);
  const { ctx, tools } = collectorCtx();
  registerWorkcaseTools(ctx, {
    dshHomePath: (...segments) => join(base, ...segments),
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
    ...(goals === undefined ? {} : { goals: () => goals }),
  });
  // Gate 1 前置·时序闸（21 §14，2026-10-16 建立）：建前审核须先落盘，否则 approve
  // 被拒。本工件的被测对象是「宿主推进目标」接线，不是审核通道，故直接经 writer
  // 注入一条覆盖当前候选的通过审核结论作夹具（审核通道自身的契约测试见
  // workcase-writer.test.mjs）。
  const seeded = await readWorkcaseObject({ factSourceRoot, objectUid: created.value.object_uid });
  const audit = await recordWorkcaseAudit({
    factSourceRoot,
    objectUid: created.value.object_uid,
    expectedFingerprint: seeded.value.fingerprint,
    summary: "对象恰当性符合；方案可行性符合；scope 清晰度符合（夹具注入）",
    verdict: "pass",
    changeSummary: "记录一条建前审核结论（夹具）",
    sessionSignature: SIG(),
    sessionIdentity: authoritativeSessionIdentity({ sessionId: "session-auditor-fx", source: "host", origin: "subagent" }),
  });
  assert.ok(audit.ok, `fixture audit: ${JSON.stringify(audit.error)}`);
  const audited = await readWorkcaseObject({ factSourceRoot, objectUid: created.value.object_uid });
  return {
    write: tools.get("ldvh_workcase_write"),
    factSourceRoot,
    objectUid: created.value.object_uid,
    fingerprint: audited.value.fingerprint,
    title: DRAFT.title,
    exec: { agent: { session: { header: { cwd: projectDir } } } },  };
}

function approveArgs(surface) {
  return {
    action: "approve",
    object_uid: surface.objectUid,
    expected_fingerprint: surface.fingerprint,
    approver: "Human（测试）",
    controller: "controller（测试）",
    change_summary: "Gate 1 批准",
    gate1_request: GATE1_REQUEST,
  };
}

test("批准成功时：宿主目标被设置，且信封如实报出这一步", async () => {
  await withTemp("wc-goal-", async (base) => {
    const goals = fakeGoals(undefined);
    const s = await surface(base, goals);
    const out = env(await s.write.execute(approveArgs(s), s.exec));
    assert.equal(out.outcome, "completed", JSON.stringify(out.gaps));
    assert.equal(out.result.goal.action, "created");
    assert.equal(goals.current().objective, goalObjectiveFor(s.objectUid, s.title));
    assert.ok(out.scope.completed.includes("host-goal"), "信封的 scope 须登记目标这一步");
  });
});

test("服务不可用时：写入被拒绝，且对象**没有变**（fail-closed）", async () => {
  await withTemp("wc-goal-", async (base) => {
    const s = await surface(base, undefined);
    const before = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
    const out = env(await s.write.execute(approveArgs(s), s.exec));
    assert.equal(out.outcome, "rejected", JSON.stringify(out));
    assert.match(out.gaps.join(" "), /workcase\/goals_unavailable/);
    assert.equal(out.result.goal.ok, false);
    const after = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
    assert.equal(after.value.frontmatter.status, before.value.frontmatter.status, "被拒绝的写入不得改变对象状态");
    assert.equal(after.value.fingerprint, before.value.fingerprint, "被拒绝的写入不得改变对象字节");
  });
});

test("目标已指向另一对象时：拒绝写入，且不碰那个目标", async () => {
  await withTemp("wc-goal-", async (base) => {
    const other = "aaaa1111-bbbb-2222-cccc-333344445555";
    const goals = fakeGoals({ id: "g-other", revision: 4, objective: goalObjectiveFor(other, "别的工单"), phase: "active", activation: "armed" });
    const s = await surface(base, goals);
    const out = env(await s.write.execute(approveArgs(s), s.exec));
    assert.equal(out.outcome, "rejected");
    assert.match(out.gaps.join(" "), /workcase\/goals_conflict/);
    assert.equal(goals.current().objective, goalObjectiveFor(other, "别的工单"), "他人目标不得被改写");
    assert.equal(goals.calls.length, 0, "冲突时不得对该目标做任何写操作");
  });
});

test("接手（execute）时：解除武装的目标被重新武装，信封报出 resumed", async () => {
  await withTemp("wc-goal-", async (base) => {
    const goals = fakeGoals(undefined);
    const s = await surface(base, goals);
    const approved = env(await s.write.execute(approveArgs(s), s.exec));
    assert.equal(approved.outcome, "completed", JSON.stringify(approved.gaps));
    // 模拟会话起点边缘：目标仍在但被解除武装。
    const disarmed = { ...goals.current(), activation: "disarmed" };
    const goals2 = fakeGoals(disarmed);
    const s2 = { ...s };
    const { ctx, tools } = collectorCtx();
    registerWorkcaseTools(ctx, {
      dshHomePath: (...segments) => join(base, ...segments),
      sessionPersistence: sessionPersistenceWithRoutingLog(base),
      goals: () => goals2,
    });
    const write2 = tools.get("ldvh_workcase_write");
    const after = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
    const out = env(await write2.execute({
      action: "execute",
      object_uid: s.objectUid,
      expected_fingerprint: after.value.fingerprint,
      frontmatter_after: { ...after.value.frontmatter, change_summary: "接手" },
      // 读回的 body 含 H1；写入器要求正文自 H2 起（21 §8）。
      body_markdown_after: after.value.body.replace(/^#[^\n]*\n/, ""),
      change_summary: "接手继续执行",
    }, s2.exec));
    assert.equal(out.outcome, "completed", JSON.stringify(out.gaps));
    assert.equal(out.result.goal.action, "resumed", JSON.stringify(out.result.goal));
    assert.equal(goals2.current().activation, "armed");
  });
});

test("取消（cancel）收口：目标被清除，信封报出 cleared", async () => {
  await withTemp("wc-goal-", async (base) => {
    // draft 对象即可取消（无需 Gate 1），故这条能端到端跑通一次收口。
    const goals = fakeGoals({ id: "g-1", revision: 2, objective: goalObjectiveFor("PLACEHOLDER", "x"), phase: "active", activation: "armed" });
    const s = await surface(base, goals);
    // 目标指向本对象（夹具建对象后才知 uid，故此处重设）。
    goals.get = () => ({ id: "g-1", revision: 2, objective: goalObjectiveFor(s.objectUid, s.title), phase: "active", activation: "armed" });
    const before = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
    const out = env(await s.write.execute({
      action: "cancel",
      object_uid: s.objectUid,
      expected_fingerprint: before.value.fingerprint,
      result: { achieved_scope: "计划未经执行即取消" },
      change_summary: "取消",
      body_markdown_after: `## 摘要\n${DRAFT.summary}\n\n## 授权范围\n${DRAFT.scope}\n\n## 计划\n1. ${DRAFT.plan[0].step}\n   完成判据：${DRAFT.plan[0].done_criteria}\n\n## 结果\n\n- cancellation:\n  - **理由**：计划未经执行即取消。\n  - **未发生的范围**：计划全部步骤均未执行。\n`,
    }, s.exec));
    assert.equal(out.outcome, "completed", JSON.stringify(out.gaps));
    assert.equal(out.result.goal.action, "cleared");
    assert.equal(goals.current(), undefined, "取消后目标应已清除");
  });
});

test("收口点遇他对象目标：**不收口、但不拒绝**——取消照常完成，且不碰那个目标（D1，Human 2026-10-15 裁定）", async () => {
  await withTemp("wc-goal-", async (base) => {
    const other = "dddd1111-2222-3333-4444-555566667777";
    const goals = fakeGoals({ id: "g-other", revision: 9, objective: goalObjectiveFor(other, "别人的工单"), phase: "active", activation: "armed" });
    const s = await surface(base, goals);
    const before = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
    const out = env(await s.write.execute({
      action: "cancel",
      object_uid: s.objectUid,
      expected_fingerprint: before.value.fingerprint,
      result: { achieved_scope: "计划未经执行即取消" },
      change_summary: "取消",
      body_markdown_after: `## 摘要\n${DRAFT.summary}\n\n## 授权范围\n${DRAFT.scope}\n\n## 计划\n1. ${DRAFT.plan[0].step}\n   完成判据：${DRAFT.plan[0].done_criteria}\n\n## 结果\n\n- cancellation:\n  - **理由**：计划未经执行即取消。\n  - **未发生的范围**：计划全部步骤均未执行。\n`,
    }, s.exec));
    assert.equal(out.outcome, "completed", JSON.stringify(out.gaps));
    assert.equal(out.result.goal.action, "none", "他对象目标不属本单，故无事可做");
    assert.equal(goals.current().objective, goalObjectiveFor(other, "别人的工单"), "他人目标不得被改写或清除");
    assert.deepEqual(goals.calls, [], "收口点对他对象目标不得做任何写操作");
  });
});

test("收口点遇目标服务不可用：**照常收尾**并在信封里如实登记降级（D3，Human 2026-10-15 裁定）", async () => {
  await withTemp("wc-goal-", async (base) => {
    const s = await surface(base, undefined);
    const before = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
    const out = env(await s.write.execute({
      action: "cancel",
      object_uid: s.objectUid,
      expected_fingerprint: before.value.fingerprint,
      result: { achieved_scope: "计划未经执行即取消" },
      change_summary: "取消",
      body_markdown_after: `## 摘要\n${DRAFT.summary}\n\n## 授权范围\n${DRAFT.scope}\n\n## 计划\n1. ${DRAFT.plan[0].step}\n   完成判据：${DRAFT.plan[0].done_criteria}\n\n## 结果\n\n- cancellation:\n  - **理由**：计划未经执行即取消。\n  - **未发生的范围**：计划全部步骤均未执行。\n`,
    }, s.exec));
    assert.equal(out.outcome, "completed", JSON.stringify(out.gaps));
    assert.equal(out.result.goal.action, "none");
    assert.equal(out.result.goal.detail.degraded, true, "降级必须可从信封读出，不得静默");
    const after = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
    assert.equal(after.value.frontmatter.status, "closed", "收口不得因目标服务缺失而失败");
  });
});

test("提交关闭提案（execute 首次落「## 结果」节）时：推进目标转为 paused，且不被同一次调用的另一跳重新武装", async () => {
  // 回归（2026-10-19 实测复现）：写入点按目的分岔之前，`execute` 先被通用写入点分支
  // 按 `point = execute` 同步了一次（对已武装目标即 kept、对暂停目标即 resume），
  // 随后分支内的 `propose_close` 暂停在同一会话里被前一跳到抵消的顺序打乱——
  // 落盘结果节后目标仍是 active/armed，自动续轮照旧把工单推向终态，
  // 「待批准关闭」期在动力层从未真正存在。本用例钉住：一次 execute 提关闭提案后，
  // 目标的终态必须是 paused。
  await withTemp("wc-goal-", async (base) => {
    const goals = fakeGoals(undefined);
    const s = await surface(base, goals);
    const approved = env(await s.write.execute(approveArgs(s), s.exec));
    assert.equal(approved.outcome, "completed", JSON.stringify(approved.gaps));
    assert.equal(goals.current().phase, "active", "批准后目标应为 active");

    const after = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
    const body = after.value.body.replace(/^#[^\n]*\n/, "").trimEnd();
    // 基线正文尚无「## 结果」节 ⇒ 本次写入即「提交关闭提案」。
    const proposed = env(await s.write.execute({
      action: "execute",
      object_uid: s.objectUid,
      expected_fingerprint: after.value.fingerprint,
      frontmatter_after: { ...after.value.frontmatter },
      body_markdown_after: `${body}\n\n## 结果\n\n- criteria_checks:\n  - 计划步骤 1 判据「夹具判据」：达成——证据：夹具\n- achieved_scope: 夹具\n`,
      change_summary: "落盘关闭提案",
    }, s.exec));
    assert.equal(proposed.outcome, "completed", JSON.stringify(proposed.gaps));
    assert.equal(proposed.result.goal.action, "paused", JSON.stringify(proposed.result.goal));
    assert.equal(goals.current().phase, "paused", "进入待批准关闭期后目标必须停在 paused，否则自动续轮会把工单直接推到终态");
    assert.equal(goals.current().activation, "disarmed", "paused 的目标须同时解除武装");
    // 暂停只发生一次：不得出现「先 resumed 再 paused」这种自相抵消的两跳。
    const resumeCalls = goals.calls.filter((c) => c[0] === "resume").length;
    const pauseCalls = goals.calls.filter((c) => c[0] === "pause").length;
    assert.equal(pauseCalls, 1, "提出关闭提案应恰好暂停一次");
    assert.equal(resumeCalls, 0, "同一次调用内不得先重新武装再暂停——那会让暂停形同虚设");
  });
});
