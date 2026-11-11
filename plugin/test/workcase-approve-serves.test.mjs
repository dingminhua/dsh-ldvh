// Gate 1 侧的 `serves` 有效性校验（21 §15.1「serves 有效」行，2026-11-12 补）。
//
// 背景：`create`（workcase-writer.js:2587）与 `revise`/`update`（:4274、:4369）都在
// **写入那一刻**校验 `serves` 可解析，但**批准环节此前完全没有校验**。于是存在一个
// 窗口：建单时 serves 指向 active 的子目标 → 子目标在批准前被 retired → Gate 1 仍把
// 授权钉在这个已失效的锚上。21 §10.3 已把「serves 指向的 sub-goal 被修订或原位作废」
// 列为授权失效事由，本条使其在批准这一刻有机械落点。
//
// 本工件钉住**两态**：
//   ① serves 指向 active SubGoal → approve 放行（不得因新增校验误杀正常路径）；
//   ② serves 指向 retired SubGoal → approve 被拒、失败码为 subgoal/serves_unresolvable、
//      对象保持 draft（不得静默降级为「已批准」）。
// 只测放行的套件无法区分「校验生效」与「校验被绕过」——理由同 pre-gate1 套件。
//
// 另钉住边界：**`serves` 缺失仍可批准**（21 §8：无适用子目标时省略）。本项不拦缺失，
// 缺失是否为缺口属语义判断；若将来把缺失改为拒绝，本用例会失败并迫使重新审议。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { seedSubGoals, subGoalUid, withTemp } from "./helpers.mjs";
import {
  createWorkcaseObject,
  readWorkcaseObject,
  approveWorkcaseObject,
  recordWorkcaseAudit,
} from "../lib/workcase-writer.js";
import { authoritativeSignature, authoritativeSessionIdentity } from "../lib/signature-channel.js";

const SIG = () => authoritativeSignature({ provider: "test-provider", model: "test-model" });
const IDENTITY = (sessionId, origin = null) => authoritativeSessionIdentity({ sessionId, source: "host", origin });
const AUDITOR = () => IDENTITY("session-auditor-serves-test", "subagent");
const IMPLEMENTER = () => IDENTITY("session-implementer-serves-test");

const AUDIT_SUMMARY = "对象恰当性符合；方案可行性符合；scope 清晰度符合（serves 夹具）";

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
}

function draftBody(serves) {
  const head = serves === undefined ? "" : `serves: \`${serves}\`。\n\n`;
  return [
    `## 摘要\n\n${head}夹具候选。\n`,
    "## 授权范围\n\n做什么：\n- 夹具项。\n\n明确不做什么：\n- 无。\n",
    "## 计划\n\n- 夹具步骤：判据——夹具判据可判定。\n",
  ].join("\n");
}

/** 建一个 draft 并返回其 uid；`serves` 传 undefined 即构造无 serves 的单。 */
async function createDraft(root, { serves = subGoalUid(1) } = {}) {
  const draft = {
    title: "Gate 1 serves 校验测试工单",
    gist: "夹具：钉住 Gate 1 的 serves 有效性校验两态。",
    summary: "夹具候选。",
    scope: "做什么：\n- 夹具项。\n\n明确不做什么：\n- 无。",
    plan: [{ step: "夹具步骤", done_criteria: "夹具判据可判定。" }],
    change_summary: "初始落盘",
  };
  if (serves !== undefined) draft.serves = serves;
  const created = await createWorkcaseObject({
    factSourceRoot: root,
    frontmatterDraft: draft,
    bodyMarkdown: draftBody(serves),
    sessionSignature: SIG(),
  });
  assert.ok(created.ok, JSON.stringify(created.error));
  return created.value.object_uid;
}

/** 记录一条覆盖当前候选的建前审核 pass，使时序闸与覆盖闸放行。 */
async function passAudit(root, uid) {
  const cur = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
  const recorded = await recordWorkcaseAudit({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: cur.value.fingerprint,
    summary: AUDIT_SUMMARY,
    verdict: "pass",
    changeSummary: "记录一条建前审核结论",
    sessionSignature: SIG(),
    sessionIdentity: AUDITOR(),
  });
  assert.ok(recorded.ok, JSON.stringify(recorded.error));
}

async function approve(root, uid) {
  const cur = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
  return await approveWorkcaseObject({
    factSourceRoot: root,
    objectUid: uid,
    expectedFingerprint: cur.value.fingerprint,
    approver: "human-test",
    controller: "controller-a",
    changeSummary: "Gate 1 批准",
    sessionSignature: SIG(),
    sessionIdentity: IMPLEMENTER(),
  });
}

/**
 * 把指定 SubGoal 的状态改成 retired（模拟「建单后、批准前子目标被作废」）。
 * 直接改载体而不经受控入口：本用例测的是 approve 侧的读校验，不测 SubGoal 的写入路径。
 */
async function retireSubGoal(root, uid) {
  const file = join(root, "subgoals", `subgoal-${uid}.md`);
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(file, "utf8");
  await writeFile(file, text.replace(/^status: active$/m, "status: retired"), "utf8");
}

// ---------------------------------------------------------------------------
// ① 放行态：serves 指向 active SubGoal
// ---------------------------------------------------------------------------

test("Gate 1：serves 指向 active SubGoal 时批准放行（新增校验不误杀正常路径）", async () => {
  await withTemp("wc-serves-active-", async (root) => {
    await seedGoal(root);
    await seedSubGoals(root, ["SG-1"], { parentGoal: "fixture-goal", status: "active" });
    const uid = await createDraft(root);
    await passAudit(root, uid);

    const approved = await approve(root, uid);
    assert.ok(approved.ok, JSON.stringify(approved.error));

    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after.value.frontmatter.status, "open", "批准后应进入 open");
  });
});

// ---------------------------------------------------------------------------
// ② 拒绝态：serves 指向 retired SubGoal（本用例的存在理由）
// ---------------------------------------------------------------------------

test("Gate 1：serves 指向 retired SubGoal 时拒绝批准，对象保持 draft (21 §15.1/§10.3)", async () => {
  await withTemp("wc-serves-retired-", async (root) => {
    await seedGoal(root);
    await seedSubGoals(root, ["SG-1"], { parentGoal: "fixture-goal", status: "active" });
    const uid = await createDraft(root);
    await passAudit(root, uid);

    // 建单之后、批准之前，子目标被原位作废——这正是本条要拦的窗口。
    await retireSubGoal(root, subGoalUid(1));

    const approved = await approve(root, uid);
    assert.equal(approved.ok, false, "retired 子目标不得被批准");
    // `resolveServes` 把底层 `subgoal/serves_unresolvable` 包成 `workcase/` 命名空间下的
    // 同义码，对外统一 WC 侧前缀（不向调用方泄漏另一种类型的内部码）。
    assert.equal(approved.error.code, "workcase/serves_unresolvable");

    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after.value.frontmatter.status, "draft", "被拒后对象必须保持 draft");
    assert.equal(after.value.frontmatter.gate_1, undefined, "被拒后不得写入 gate_1");
  });
});

// ---------------------------------------------------------------------------
// ③ 边界：serves 缺失仍可批准（21 §8 省略路径合法）
// ---------------------------------------------------------------------------

test("Gate 1：serves 缺失时仍可批准（21 §8 省略路径不被本校验封闭）", async () => {
  await withTemp("wc-serves-absent-", async (root) => {
    await seedGoal(root);
    await seedSubGoals(root, ["SG-1"], { parentGoal: "fixture-goal", status: "active" });
    const uid = await createDraft(root, { serves: undefined });
    await passAudit(root, uid);

    const approved = await approve(root, uid);
    assert.ok(approved.ok, JSON.stringify(approved.error));

    const after = await readWorkcaseObject({ factSourceRoot: root, objectUid: uid });
    assert.equal(after.value.frontmatter.status, "open");
  });
});
