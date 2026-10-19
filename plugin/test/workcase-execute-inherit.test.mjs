// C2 闸的「省略即继承」基线（workcase-996e207a）
//
// 缺陷形态（实测）：`assertAuthorizedPairFrozen(fm, next, …)` 以**调用方 payload**
// 与落盘比较。execute 的合法写法是只更新正文与 summary（plan/scope 被冻结，重传
// 没有意义），于是 `frontmatter_after: {}` 使两侧 plan/scope 同为 undefined，
// 指纹「不匹配」，一次正文记账 + 心跳被误判为 C2 失效；而补传完整 frontmatter
// 又会撞上复核流水等其它门禁——open 期 execute 事实上不可用。
//
// 正确的语义（21 §10.3）：冻结的是 plan/scope 的**实质内容**。省略 = 继承落盘值；
// 显式传改后的内容 = 真改动 = 拒绝。这里的两条用例分别钉住这两半。
//
// 2026-10-18 补测（实测复现，第二次）：只把**比较基线**改成 `{...fm, ...payload}`
// 并不足够。`guardAuditField` 用 `structuredClone` 克隆 payload，而该 API 遇到值为
// `undefined` 的键会**抛错**，于是同一调用在到达 C2 闸之前就以 `internal_error` 失败。
// 工具层在 JSON 序列化后还会把 `undefined` 值整体丢弃，故两种形态都要钉住。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { withTemp, sessionPersistenceWithRoutingLog } from "./helpers.mjs";
import { registerWorkcaseTools } from "../lib/workcase-tools.js";
import { createWorkcaseObject, readWorkcaseObject, recordWorkcaseAudit } from "../lib/workcase-writer.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "../lib/signature-channel.js";

const SIG = () => authoritativeSignature({ provider: "test-provider", model: "test-model" });
const GATE1_REQUEST = {
  independent_review: "one isolated subagent",
  unauthorized_action_guard: "writer refuses out-of-scope writes",
  pre_creation_review: "pre-Gate-1 isolated-subagent review conclusion: 对象恰当/方案可行/scope 清晰（21 §14 Gate 1 前置·建前独立审核）",
  unverified_scope_and_risks: "host signature behavior unverified",
  approved_scope_and_next: "execute plan steps 1-3",
};
const PLAN = [
  { step: "编写 writer 骨架", done_criteria: "writer 文件存在且 node --check 通过" },
  { step: "编写测试", done_criteria: "全部测试用例通过" },
];
const SCOPE = "做什么：\n- 实现 X 的 writer 与测试\n\n明确不做什么：\n- 不改 Web 呈现";

function draft() {
  return {
    title: "C2 继承基线",
    gist: "验证 open 期只更新正文（省略 plan/scope）不被误判为 C2 失效。",
    serves: "SG-1",
    summary: "执行期记账：确认正文可更新，且 plan/scope 的显式改动仍被拒绝。",
    scope: SCOPE,
    plan: PLAN,
    change_summary: "受控创建（测试）",
  };
}
function draftBody(d = draft()) {
  return [
    `## 摘要\n\n${d.summary}\n`,
    `## 授权范围\n\n${d.scope}\n`,
    `## 计划\n\n${d.plan.map((p) => `- ${p.step}：判据——${p.done_criteria}`).join("\n")}\n`,
  ].join("\n");
}
async function seedGoal(root) {
  const fm = ["goal_key: project-goal", "title: 测试目标", "status: active", "created_at: 2026-09-15T00:00:00.000Z", "change_log:", "  - at: 2026-09-15T00:00:00.000Z", "    summary: 测试初始化"].join("\n");
  await writeFile(join(root, "goal.md"), `---\n${fm}\n---\n\n# 项目目标\n\n## 目标陈述\n\n测试目标陈述。\n\n## 子目标\n\nSG-1 测试子目标 SG-1\n`, "utf8");
}
function fakeGoalsService() {
  let current;
  return {
    current: () => current,
    get: () => current,
    create: (agent, request) => { current = { id: "g-1", revision: 1, objective: request.objective, phase: "active", activation: "armed" }; return current; },
    edit: (agent, ref, request) => { current = { ...current, ...request, revision: ref.revision + 1 }; return current; },
    resume: (agent, ref) => { current = { ...current, phase: "active", activation: "armed", revision: ref.revision + 1 }; return current; },
    pause: (agent, ref) => { current = { ...current, phase: "paused", activation: "disarmed", revision: ref.revision + 1 }; return current; },
    complete: (agent, ref) => { current = { ...current, phase: "complete", activation: "disarmed", revision: ref.revision + 1 }; return current; },
    clear: (agent, ref) => { current = undefined; return { id: ref.id, revision: ref.revision + 1 }; },
  };
}
async function surface(base) {
  const projectDir = join(base, "proj");
  await mkdir(projectDir, { recursive: true });
  const dir = join(base, "ldvh");
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);
  const carrier = join(dir, "governed-projects.yaml");
  await writeFile(carrier, ["schema_version: 1", "governance_instance_name: Test", "product_description: Test", "projects:", "  - id: p1", "    name: P1", `    path: ${projectDir}`, 'default_project_id: "p1"', ""].join("\n"));
  await chmod(carrier, 0o600);
  const factSourceRoot = join(projectDir, "ldvh-base");
  await mkdir(factSourceRoot, { recursive: true });
  await seedGoal(factSourceRoot);
  const created = await createWorkcaseObject({ factSourceRoot, frontmatterDraft: draft(), bodyMarkdown: draftBody(), sessionSignature: SIG() });
  assert.ok(created.ok, `fixture draft must be created: ${JSON.stringify(created.error)}`);
  const tools = new Map();
  const ctx = { tools: { register: (d) => { tools.set(d.name, d); return () => tools.delete(d.name); } } };
  registerWorkcaseTools(ctx, { dshHomePath: (...s) => join(base, ...s), sessionPersistence: sessionPersistenceWithRoutingLog(base), goals: () => fakeGoalsService() });
  return { write: tools.get("ldvh_workcase_write"), factSourceRoot, objectUid: created.value.object_uid, exec: { agent: { session: { header: { cwd: projectDir } } } } };
}
async function openSurface(base) {
  const s = await surface(base);
  const cur = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
  const audited = await recordWorkcaseAudit({
    factSourceRoot: s.factSourceRoot, objectUid: s.objectUid, expectedFingerprint: cur.value.fingerprint,
    summary: "对象恰当性符合；方案可行性符合；scope 清晰度符合（夹具注入）", verdict: "pass",
    changeSummary: "记录一条建前审核结论（夹具）", sessionSignature: SIG(),
    sessionIdentity: authoritativeSessionIdentity({ sessionId: "session-auditor-fx", source: "host", origin: "subagent" }),
  });
  assert.ok(audited.ok, `fixture audit must be recorded: ${JSON.stringify(audited.error)}`);
  const before = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
  const approved = await s.write.execute({
    action: "approve", object_uid: s.objectUid, expected_fingerprint: before.value.fingerprint,
    approver: "Human", controller: "ctrl", change_summary: "Gate 1", gate1_request: GATE1_REQUEST,
  }, s.exec);
  const ap = approved.envelope ?? approved;
  assert.equal(ap.outcome, "completed", `approve must succeed: ${JSON.stringify(approved).slice(0, 600)}`);
  const open = await readWorkcaseObject({ factSourceRoot: s.factSourceRoot, objectUid: s.objectUid });
  return { ...s, open, openBody: () => { const b = open.value.body; const i = b.indexOf("\n## 摘要"); return (i >= 0 ? b.slice(i + 1) : b).replace(/\s+$/, ""); } };
}

test("execute 省略 frontmatter_after：正文记账不被误判为 C2 失效（继承落盘 plan/scope）", async () => {
  await withTemp("workcase-c2-inherit-", async (base) => {
    const { write, factSourceRoot, objectUid, exec, open, openBody } = await openSurface(base);
    assert.equal(open.value.frontmatter.status, "open");
    const result = await write.execute({
      action: "execute",
      object_uid: objectUid,
      expected_fingerprint: open.value.fingerprint,
      frontmatter_after: {},
      body_markdown_after: `${openBody()}\n- 计划步骤 1 完成：writer 骨架已落盘。\n`,
      change_summary: "执行进展（省略 frontmatter_after）",
    }, exec);
    assert.equal((result.envelope ?? result).outcome, "completed", `execute 应成功，实际：${JSON.stringify(result).slice(0, 600)}`);
  });
});

test("execute 携带值为 undefined 的字段：不得因克隆失败而 internal_error（省略语义须先归一化）", async () => {
  await withTemp("workcase-c2-undefined-", async (base) => {
    const { write, objectUid, exec, open, openBody } = await openSurface(base);
    // 直接调用 writer 路径（绕过工具层 JSON 序列化，故 undefined 键仍在）。
    const result = await write.execute({
      action: "execute",
      object_uid: objectUid,
      expected_fingerprint: open.value.fingerprint,
      frontmatter_after: { plan: undefined, scope: undefined },
      body_markdown_after: `${openBody()}\n- 计划步骤 1 完成。\n`,
      change_summary: "执行进展（plan/scope 显式为 undefined）",
    }, exec);
    const env = result.envelope ?? result;
    assert.equal(env.outcome, "completed", `undefined 值应按省略处理并成功，实际：${JSON.stringify(result).slice(0, 600)}`);
  });
});

test("execute 显式改动 plan：仍按 C2 冻结拒绝（修复没有把闸拆掉）", async () => {
  await withTemp("workcase-c2-reject-", async (base) => {
    const { write, objectUid, exec, open, openBody } = await openSurface(base);
    const fm = open.value.frontmatter;
    const result = await write.execute({
      action: "execute",
      object_uid: objectUid,
      expected_fingerprint: open.value.fingerprint,
      frontmatter_after: { ...fm, plan: [{ step: "偷改的计划", done_criteria: "无" }] },
      body_markdown_after: `${openBody()}\n- 计划步骤 1 完成。\n`,
      change_summary: "试图改 plan",
    }, exec);
    const msg = JSON.stringify(result);
    assert.equal((result.envelope ?? result).outcome, "rejected", `真改动 plan 必须被拒，实际：${msg.slice(0, 600)}`);
    assert.match(msg, /c2_fingerprint_invalidated/, `拒绝理由须指向 C2 闸，实际：${msg.slice(0, 600)}`);
  });
});

test("execute 只显式改 scope：继承机制不得成为 C2 后门", async () => {
  // 钉住 inheritOmittedFields 的反向半边：省略（或 undefined）才继承；显式给值
  // 一律原样进入 after，交给 C2 闸判定。若继承写成「调用方可覆盖任何键」，
  // 这条会红——那正是 21 §10.3 冻结 plan/scope 的唯一机械保障。
  await withTemp("workcase-c2-scope-", async (base) => {
    const { write, factSourceRoot, objectUid, exec, open, openBody } = await openSurface(base);
    const scopeBefore = open.value.frontmatter.scope;
    const result = await write.execute({
      action: "execute",
      object_uid: objectUid,
      expected_fingerprint: open.value.fingerprint,
      // 只改 scope，plan 与其余字段全部省略（省略的应当继承，不应触发 C2）。
      frontmatter_after: { scope: "做什么：偷偷扩大范围\n明确不做什么：无" },
      body_markdown_after: `${openBody()}\n- 计划步骤 1 完成。\n`,
      change_summary: "试图改 scope",
    }, exec);
    const msg = JSON.stringify(result);
    assert.equal((result.envelope ?? result).outcome, "rejected", `改 scope 必须被拒，实际：${msg.slice(0, 600)}`);
    assert.match(msg, /c2_fingerprint_invalidated/, `拒绝理由须指向 C2 闸，实际：${msg.slice(0, 600)}`);
    // 零写入：重新读取，scope 必须原样。
    const after = await readWorkcaseObject({ factSourceRoot, objectUid });
    assert.equal(after.value.frontmatter.scope, scopeBefore, "拒绝必须零写入");
  });
});
