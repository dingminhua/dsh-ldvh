// WorkCase tool-surface contract: the authoritative plan-step list computed by
// the writer must actually REACH the caller through the tool envelope
// (21 §8「执行」节的记账纪律；workcase-1c6afa19 计划步骤 2/3).
//
// Background (2026-09-27). 21 §8 requires 正文 to cite plan steps only in the
// explicit form 「计划步骤 N」, with N bounded by the current plan. plan[2] of
// WC-1c6afa19 therefore put the authoritative list into the approve/execute
// return value — `plugin/lib/workcase-writer.js:381 planStepReference(plan)`,
// returned at the two call sites (`approveWorkcaseObject` 尾 / `executeWorkcaseObject` 尾).
//
// But the writer's return value is not what a caller sees. The tool boundary
// in `plugin/lib/workcase-tools.js` re-projects the writer result into a
// fixed-shape envelope, and that projection was a SIX-KEY whitelist
// (action / object_uid / actual_ref / fingerprint / read_back / changes) — so
// `plan_step_reference` was computed, returned, and then silently dropped. The
// tool description told the caller the list would come back; it did not.
//
// The pre-existing guards for this WC live in
// plugin/web/tests/api/workcase-execution-ledger-contract.test.ts and are
// SOURCE-TEXT assertions (readFileSync + regex). Their own header states the
// limit: 「只拦形态、不拦语义」— a readSource assertion on the writer cannot
// observe whether the value survives a later projection. That is exactly how
// this gap lived: every source-text guard was green while no caller could see
// the list.
//
// These tests are therefore BEHAVIOURAL: they register the real tool through
// the real registration function and assert on the envelope a caller receives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { withTemp, sessionPersistenceWithRoutingLog } from "./helpers.mjs";
import { registerWorkcaseTools } from "../lib/workcase-tools.js";
import { createWorkcaseObject, readWorkcaseObject } from "../lib/workcase-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";

const SIG = () => authoritativeSignature({ provider: "test-provider", model: "test-model" });

/** Minimal ctx capturing registered tool descriptors. */
function collectorCtx() {
  const tools = new Map();
  return {
    ctx: { tools: { register: (descriptor) => { tools.set(descriptor.name, descriptor); return () => tools.delete(descriptor.name); } } },
    tools,
  };
}

/** Well-formed governed-projects carrier pointing at `projectPath`. */
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

async function seedGoal(root, anchors = ["SG-1", "SG-2"]) {
  const fm = ["goal_key: project-goal", "title: 测试目标", "status: active", "created_at: 2026-09-15T00:00:00.000Z", "change_log:", "  - at: 2026-09-15T00:00:00.000Z", "    summary: 测试初始化"].join("\n");
  const lines = anchors.map((a) => `${a} 测试子目标 ${a}`);
  await writeFile(join(root, "goal.md"), `---\n${fm}\n---\n\n# 项目目标\n\n## 目标陈述\n\n测试目标陈述。\n\n## 子目标\n\n${lines.join("\n")}\n`, "utf8");
}

// Beware: a plan step named after a lifecycle gate (受控提交 / 独立复核 / Gate 批准)
// is rejected by the writer's plan-gate check (21 §6.1) — these steps must be the
// work package's own implementation work, which is all this fixture needs.
const PLAN = [
  { step: "编写 writer 骨架", done_criteria: "writer 文件存在且 node --check 通过" },
  { step: "编写测试", done_criteria: "全部测试用例通过" },
  { step: "补充文档说明", done_criteria: "文档含使用示例" },
];

function validDraft(overrides = {}) {
  return {
    title: "实现 X 的最小承载",
    gist: "为 X 建立最小承载，使后续工作可复用。",
    serves: "SG-1",
    summary: "为 X 建立最小实现并通过测试，使后续工作可复用。",
    scope: "做什么：\n- 实现 X 的 writer 与测试\n\n明确不做什么：\n- 不改 Web 呈现",
    plan: PLAN,
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

/** Governed project + registered write tool + a draft object to act on. */
async function surface(base, draftOverrides = {}) {
  const projectDir = join(base, "proj");
  await mkdir(projectDir, { recursive: true });
  await writeCarrier(base, projectDir);
  const factSourceRoot = join(projectDir, "ldvh-base");
  await mkdir(factSourceRoot, { recursive: true });
  await seedGoal(factSourceRoot);

  const draft = validDraft(draftOverrides);
  const created = await createWorkcaseObject({
    factSourceRoot,
    frontmatterDraft: draft,
    bodyMarkdown: draftBody(draft),
    sessionSignature: SIG(),
  });
  assert.ok(created.ok, `fixture draft must be created: ${JSON.stringify(created.error)}`);

  const { ctx, tools } = collectorCtx();
  registerWorkcaseTools(ctx, {
    dshHomePath: (...segments) => join(base, ...segments),
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
  });
  const write = tools.get("ldvh_workcase_write");
  assert.ok(write, "write tool must be registered");
  return {
    write,
    draft,
    factSourceRoot,
    objectUid: created.value.object_uid,
    exec: { agent: { session: { header: { cwd: projectDir } } } },
  };
}

const GATE1_REQUEST = {
  independent_review: "one isolated subagent",
  unauthorized_action_guard: "writer refuses out-of-scope writes",
  unverified_scope_and_risks: "host signature behavior unverified",
  approved_scope_and_next: "execute plan steps 1-3",
};

test("approve envelope carries plan_step_reference — the caller can see the N it must cite (21 §8)", async () => {
  await withTemp("workcase-psr-", async (base) => {
    const { write, draft, factSourceRoot, objectUid, exec } = await surface(base);
    const before = await readWorkcaseObject({ factSourceRoot, objectUid });

    const result = await write.execute({
      action: "approve",
      object_uid: objectUid,
      expected_fingerprint: before.value.fingerprint,
      approver: "Human",
      controller: "ctrl",
      change_summary: "Gate 1",
      gate1_request: GATE1_REQUEST,
    }, exec);

    const env = result.envelope;
    assert.equal(env.outcome, "completed", `approve must succeed, got: ${JSON.stringify(env).slice(0, 600)}`);
    const ref = env.result.plan_step_reference;
    assert.ok(ref !== undefined,
      "the writer computed the plan list and returned it, but the tool envelope dropped it — "
      + `the caller cannot see the authoritative N. envelope.result keys: ${JSON.stringify(Object.keys(env.result))}`);
    assert.equal(ref.plan_length, draft.plan.length);
    // The list must be usable as-is against what the caller is about to write:
    // same order, same numbering, step text verbatim from the plan.
    assert.deepEqual(ref.steps, draft.plan.map((item, index) => ({ n: index + 1, step: item.step })));
    // The rule text is the writer's single source — the tool must pass it through,
    // not restate it (a second copy would be free to drift).
    assert.match(ref.rule, /计划步骤 N/);
  });
});

test("execute envelope carries plan_step_reference — a cross-session executor has the list too (21 §8)", async () => {
  await withTemp("workcase-psr-ex-", async (base) => {
    const { write, draft, factSourceRoot, objectUid, exec } = await surface(base);
    const before = await readWorkcaseObject({ factSourceRoot, objectUid });
    const approved = await write.execute({
      action: "approve",
      object_uid: objectUid,
      expected_fingerprint: before.value.fingerprint,
      approver: "Human",
      controller: "ctrl",
      change_summary: "Gate 1",
      gate1_request: GATE1_REQUEST,
    }, exec);
    assert.equal(approved.envelope.outcome, "completed");

    const after = await readWorkcaseObject({ factSourceRoot, objectUid });
    const result = await write.execute({
      action: "execute",
      object_uid: objectUid,
      expected_fingerprint: after.value.fingerprint,
      frontmatter_after: after.value.frontmatter,
      body_markdown_after: `${draftBody(draft)}\n\n## 执行\n\n- 计划步骤 1 完成。\n`,
      change_summary: "执行进展",
    }, exec);

    const env = result.envelope;
    assert.equal(env.outcome, "completed", `execute must succeed, got: ${JSON.stringify(env).slice(0, 600)}`);
    const ref = env.result.plan_step_reference;
    assert.ok(ref !== undefined,
      `execute must carry the list as well (a later controller never saw approve's return value). `
      + `envelope.result keys: ${JSON.stringify(Object.keys(env.result))}`);
    assert.deepEqual(ref.steps, draft.plan.map((item, index) => ({ n: index + 1, step: item.step })));
  });
});

test("actions without a plan list do not gain a stray key — the passthrough is conditional, not a blanket add", async () => {
  await withTemp("workcase-psr-neg-", async (base) => {
    const { write, draft, factSourceRoot, objectUid, exec } = await surface(base);
    const before = await readWorkcaseObject({ factSourceRoot, objectUid });

    // revise stays in draft and returns no plan list; the envelope must not
    // invent one (an empty/undefined list would read as "the plan is empty").
    const result = await write.execute({
      action: "revise",
      object_uid: objectUid,
      expected_fingerprint: before.value.fingerprint,
      frontmatter_after: { ...before.value.frontmatter, summary: `${draft.summary}（修订）` },
      body_markdown_after: draftBody({ ...draft, summary: `${draft.summary}（修订）` }),
      change_summary: "草稿演进",
    }, exec);

    const env = result.envelope;
    assert.equal(env.outcome, "completed", `revise must succeed, got: ${JSON.stringify(env).slice(0, 600)}`);
    assert.ok(!Object.prototype.hasOwnProperty.call(env.result, "plan_step_reference"),
      "a non-approve/execute envelope must not carry plan_step_reference");
  });
});
