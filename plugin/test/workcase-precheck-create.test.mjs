// 提请前机械检查：只读预检入口 + create 的次序纪律（21 §14 create）
//
// 本文件守的是 2026-09-26 引入的一条次序：**先做提请前的只读机械检查，通过后
// 再提请**。此前该次序在实现中并不存在——create 分支先取 Human 的路由答复，
// 之后才校验与落盘，故机械上站不住的候选同样会被呈到 Human 面前，Human 的答复
// 可能落在一个从未成立的提案上。这不是礼节问题：提请与其审查针对的是**那份**
// 候选内容，提问者与答问者必须围绕同一件事。
//
// 三条性质各自需要一条用例，且缺一不可：
//
//   (1) 预检**只读**：调用后事实源不得产生任何文件。否则「预检」会变成一次
//       静默写入，而写入是要走 Gate 1 的。
//   (2) 预检与写入**同一实现**：合格候选两侧同判 passed，不合格候选两侧同判
//       失败。若两侧各有一套规则，就会出现「预检说可以、写入说不行」的分歧，
//       而那正是本改动要消除的东西。
//   (3) 次序**真的成立**（09 §5 变异验证）：候选机械不合格时，宿主询问入口必须
//       零调用。仅断言「结果被拒绝」是不够的——把预检放在提问之后同样会拒绝，
//       却已经打扰了 Human。故本用例断言的是**提问次数为 0**，这一条能杀掉
//       「把预检挪到提问之后」的变异体。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, chmod, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { withTemp, sessionPersistenceWithRoutingLog } from "./helpers.mjs";
import { registerWorkcaseTools } from "../lib/workcase-tools.js";
import { precheckWorkcaseCreate, createWorkcaseObject } from "../lib/workcase-writer.js";
import { authoritativeSignature } from "../lib/signature-channel.js";

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

const SIG = () => authoritativeSignature({ provider: "test-provider", model: "test-model" });

/** 合格候选：scope 两标签各独占一行，正文逐字承载（与写入侧同判）。 */
function viableCandidate() {
  const summary = "把某处行为改成预期形态。";
  const scope = "做什么：\n- 改 X\n\n明确不做什么：\n- 不动 Y";
  return {
    frontmatterDraft: {
      title: "测试工单",
      status: "draft",
      gist: "为 X 建立最小承载，使后续工作可复用。",
      summary,
      scope,
      plan: [{ step: "改 X", done_criteria: "X 的输出为 Z" }],
    },
    bodyMarkdown: [
      "## 摘要",
      summary,
      "",
      "## 授权范围",
      scope,
      "",
      "## 计划",
      "1. 改 X —— X 的输出为 Z",
      "",
    ].join("\n"),
  };
}

/** 不合格候选：scope 行内串联（21 §8 明列的违规写法）。 */
function brokenCandidate() {
  const candidate = viableCandidate();
  const inlineScope = "做什么：改 X；明确不做什么：不动 Y。";
  return {
    frontmatterDraft: { ...candidate.frontmatterDraft, scope: inlineScope },
    bodyMarkdown: candidate.bodyMarkdown.replace(candidate.frontmatterDraft.scope, inlineScope),
  };
}

function routingSeam(reply) {
  const calls = [];
  return {
    calls,
    requestWorkcaseRouting: async (payload) => { calls.push(payload); return reply(payload); },
  };
}

async function setup(base, { hostSeams } = {}) {
  const projectDir = join(base, "proj");
  await mkdir(projectDir, { recursive: true });
  await writeCarrier(base, projectDir);
  const { ctx, tools } = collectorCtx();
  registerWorkcaseTools(ctx, {
    dshHomePath: (...segments) => join(base, ...segments),
    sessionPersistence: sessionPersistenceWithRoutingLog(base),
    ...(hostSeams === undefined ? {} : { hostSeams }),
  });
  const precheck = tools.get("ldvh_workcase_precheck_create");
  const write = tools.get("ldvh_workcase_write");
  assert.ok(precheck, "the precheck tool must be registered");
  assert.ok(write, "the write tool must be registered");
  return { precheck, write, projectDir, exec: { agent: { session: { header: { cwd: projectDir } } } } };
}

// ---------------------------------------------------------------------------
// (1) 预检只读
// ---------------------------------------------------------------------------

test("precheck: 合格候选判 passed 并给出候选指纹，且不落盘（21 §14 create）", async () => {
  await withTemp("workcase-precheck-a-", async (base) => {
    const { precheck, projectDir, exec } = await setup(base);
    const candidate = viableCandidate();
    const result = await precheck.execute({
      frontmatter_draft: candidate.frontmatterDraft,
      body_markdown: candidate.bodyMarkdown,
    }, exec);

    assert.equal(result.envelope.outcome, "completed");
    assert.equal(result.envelope.result.mechanical_outcome, "passed");
    assert.match(result.envelope.result.candidate_fingerprint, /^[0-9a-f]{64}$/, "预检须返回 64-hex 候选指纹");

    // 只读性：事实源目录不得出现任何文件（预检若落盘，就等于绕开 Gate 1 写入）。
    const dir = join(projectDir, "ldvh-base", "workcases");
    const entries = await readdir(dir).catch(() => []);
    assert.deepEqual(entries, [], `预检必须零写入，实际产生：${entries.join(", ")}`);
  });
});

test("precheck: 不合格候选判 failed 并逐条给出 issues", async () => {
  await withTemp("workcase-precheck-b-", async (base) => {
    const { precheck, exec } = await setup(base);
    const candidate = brokenCandidate();
    const result = await precheck.execute({
      frontmatter_draft: candidate.frontmatterDraft,
      body_markdown: candidate.bodyMarkdown,
    }, exec);

    assert.equal(result.envelope.outcome, "rejected");
    assert.equal(result.envelope.result.mechanical_outcome, "failed");
    const issues = result.envelope.result.issues;
    assert.ok(Array.isArray(issues) && issues.length > 0, "必须逐条交还未通过项");
    assert.ok(
      issues.some((i) => /做什么|scope/.test(i)),
      `issues 须指出 scope 的具体问题，实际：${JSON.stringify(issues)}`,
    );
  });
});

test("precheck: 候选缺失判 unverifiable（输入不足以完成检查）", async () => {
  await withTemp("workcase-precheck-c-", async (base) => {
    const { precheck, exec } = await setup(base);
    const result = await precheck.execute({ frontmatter_draft: viableCandidate().frontmatterDraft }, exec);
    // 缺 body_markdown：不是「候选有格式缺陷」，而是没有东西可检——两者不可混同，
    // 否则调用方会把「检查没做成」读成「候选不合格」。
    assert.equal(result.envelope.outcome, "invalid_request");
  });
});

// ---------------------------------------------------------------------------
// (2) 预检与写入同一实现
// ---------------------------------------------------------------------------

test("precheck 与写入同判：合格候选两侧都通过，不合格候选两侧都被拒", async () => {
  await withTemp("workcase-precheck-d-", async (base) => {
    const { precheck, exec } = await setup(base);
    const projectDir = join(base, "proj");
    const factSourceRoot = join(projectDir, "ldvh-base");

    // 合格候选
    const ok = viableCandidate();
    const pre = await precheck.execute({ frontmatter_draft: ok.frontmatterDraft, body_markdown: ok.bodyMarkdown }, exec);
    assert.equal(pre.envelope.result.mechanical_outcome, "passed");
    const written = await createWorkcaseObject({
      factSourceRoot,
      frontmatterDraft: ok.frontmatterDraft,
      bodyMarkdown: ok.bodyMarkdown,
      sessionSignature: SIG(),
    });
    assert.ok(written.ok, `预检说可以，写入却说不行：${JSON.stringify(written.error)}`);

    // 不合格候选：写入侧必须拒绝
    const bad = brokenCandidate();
    const preBad = await precheckWorkcaseCreate({
      factSourceRoot,
      frontmatterDraft: bad.frontmatterDraft,
      bodyMarkdown: bad.bodyMarkdown,
    });
    assert.equal(preBad.value.mechanical_outcome, "failed");
    const badWrite = await createWorkcaseObject({
      factSourceRoot,
      frontmatterDraft: bad.frontmatterDraft,
      bodyMarkdown: bad.bodyMarkdown,
      sessionSignature: SIG(),
    });
    assert.ok(!badWrite.ok, "预检说不行，写入却接受了——两侧不是同一实现");
    assert.equal(badWrite.error.code, "workcase/frontmatter_invalid");
  });
});

test("write: 提请时的候选指纹与写入时内容不符则拒绝（21 §14 create）", async () => {
  await withTemp("workcase-precheck-e-", async (base) => {
    const { precheck, exec } = await setup(base);
    const factSourceRoot = join(base, "proj", "ldvh-base");
    const checked = viableCandidate();
    const pre = await precheck.execute({ frontmatter_draft: checked.frontmatterDraft, body_markdown: checked.bodyMarkdown }, exec);
    const fingerprint = pre.envelope.result.candidate_fingerprint;

    // 内容改变后再用旧指纹写入：预检的结论属于**被检查的那份内容**，不属于这一份。
    const drifted = viableCandidate();
    drifted.frontmatterDraft.summary = "把另一处行为改成另一种形态。";
    drifted.bodyMarkdown = drifted.bodyMarkdown.replace("把某处行为改成预期形态。", "把另一处行为改成另一种形态。");
    const res = await createWorkcaseObject({
      factSourceRoot,
      frontmatterDraft: drifted.frontmatterDraft,
      bodyMarkdown: drifted.bodyMarkdown,
      sessionSignature: SIG(),
      expectedCandidateFingerprint: fingerprint,
    });
    assert.ok(!res.ok, "候选在预检与写入之间改变时必须拒绝，否则 Human 之所见与所落不是同一物");
    assert.equal(res.error.code, "workcase/candidate_changed");

    // 同一份内容则放行（证明拒绝来自内容变化，而非该参数本身不可用）
    const same = viableCandidate();
    const ok = await createWorkcaseObject({
      factSourceRoot,
      frontmatterDraft: same.frontmatterDraft,
      bodyMarkdown: same.bodyMarkdown,
      sessionSignature: SIG(),
      expectedCandidateFingerprint: fingerprint,
    });
    assert.ok(ok.ok, `同一内容必须放行：${JSON.stringify(ok.error)}`);
  });
});

// ---------------------------------------------------------------------------
// (3) 次序纪律 + 09 §5 变异验证
// ---------------------------------------------------------------------------

test("create: 候选机械不合格时，宿主询问入口零调用——先检查、后提请（09 §5 变异验证）", async () => {
  await withTemp("workcase-precheck-f-", async (base) => {
    const seam = routingSeam(() => ({ granted: true, routedTo: "workcase", answer: "建工单走流程" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const candidate = brokenCandidate();
    const result = await write.execute({
      action: "create",
      frontmatter_draft: candidate.frontmatterDraft,
      body_markdown: candidate.bodyMarkdown,
    }, exec);

    assert.equal(result.envelope.outcome, "rejected");
    // 本断言即变异验证：若把预检挪到提问之后，结果仍是 rejected，但提问已经
    // 发生——Human 会被拉进一个从未成立的提案。故必须断言**提问次数为 0**。
    assert.equal(
      seam.calls.length,
      0,
      "候选未过机械检查时不得提问：Human 的答复不应落在一个机械上站不住的提案上",
    );
    const gaps = result.envelope.gaps.join(" | ");
    assert.match(gaps, /pre-submission mechanical check did not pass/, `须如实报告未通过，实际：${gaps.slice(0, 400)}`);
  });
});

test("create: 候选合格时次序为「先预检、后提问」，且预检通过后才提问", async () => {
  await withTemp("workcase-precheck-g-", async (base) => {
    const seam = routingSeam(() => ({ granted: true, routedTo: "workcase", answer: "建工单走流程" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const candidate = viableCandidate();
    const result = await write.execute({
      action: "create",
      frontmatter_draft: candidate.frontmatterDraft,
      body_markdown: candidate.bodyMarkdown,
    }, exec);

    assert.equal(seam.calls.length, 1, "合格候选应在预检通过后提出路由问题");
    // 写入路径的 verification 必须同时登记预检与路由两项检查，否则「先预检」
    // 无法从结果中读出（读者只能看到路由被问过）。
    const checks = result.envelope.verification.checks;
    assert.ok(checks.includes("pre-mechanical-check"), `verification 须登记预检：${JSON.stringify(checks)}`);
    assert.ok(checks.includes("human-routing"), `verification 须登记路由：${JSON.stringify(checks)}`);
  });
});

test("create: 预检通过的候选在写入时再检一次——两处由同一实现承担", async () => {
  await withTemp("workcase-precheck-h-", async (base) => {
    const seam = routingSeam(() => ({ granted: true, routedTo: "workcase", answer: "建工单走流程" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const candidate = viableCandidate();
    const result = await write.execute({
      action: "create",
      frontmatter_draft: candidate.frontmatterDraft,
      body_markdown: candidate.bodyMarkdown,
    }, exec);

    assert.equal(result.envelope.outcome, "completed", JSON.stringify(result.envelope).slice(0, 600));
    // 落盘后的对象须真实存在且可回读（写后回读是 03 §9 的要求）
    assert.equal(result.envelope.result.read_back.ok, true);
    assert.match(result.envelope.result.fingerprint, /^[0-9a-f]{64}$/);
  });
});

test("create: 调用方显式提供的候选指纹被真正消费（跨调用的预检结论不得被静默忽略）", async () => {
  await withTemp("workcase-precheck-i-", async (base) => {
    const seam = routingSeam(() => ({ granted: true, routedTo: "workcase", answer: "建工单走流程" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const candidate = viableCandidate();
    // 一个真实存在、但属于**另一份内容**的指纹（64-hex）。
    const foreign = "a".repeat(64);
    const result = await write.execute({
      action: "create",
      frontmatter_draft: candidate.frontmatterDraft,
      body_markdown: candidate.bodyMarkdown,
      expected_candidate_fingerprint: foreign,
    }, exec);

    // 候选本身合格（会走到写入），但调用方声明的那次预检针对的是别的候选：
    // 必须拒绝而不是以内部预检的指纹覆盖掉调用方的声明。
    assert.equal(result.envelope.outcome, "rejected");
    assert.match(
      result.envelope.gaps.join(" | "),
      /candidate_changed/,
      `调用方提供的指纹必须被消费，实际：${result.envelope.gaps.join(" | ").slice(0, 300)}`,
    );
  });
});

test("create: 未提供指纹时以内部预检的指纹为准（默认路径不受影响）", async () => {
  await withTemp("workcase-precheck-j-", async (base) => {
    const seam = routingSeam(() => ({ granted: true, routedTo: "workcase", answer: "建工单走流程" }));
    const { write, exec } = await setup(base, { hostSeams: seam });
    const candidate = viableCandidate();
    const result = await write.execute({
      action: "create",
      frontmatter_draft: candidate.frontmatterDraft,
      body_markdown: candidate.bodyMarkdown,
    }, exec);
    assert.equal(result.envelope.outcome, "completed", JSON.stringify(result.envelope).slice(0, 400));
  });
});

// ---------------------------------------------------------------------------
// 独立对抗审核发现（2026-09-26，实现侧）的回归守卫
//
// F1（高）：指纹曾剥离 change_summary，而它由调用方提供且会逐字落盘到
// change_log[0].summary。实测反例：预检候选甲得指纹后，把值换成乙并携带同一
// 指纹写入，写入被接受、落盘为乙——候选文本承诺的「内容变化一律拒绝」当时不成立。
// 本组用例把该反例固化为守卫：它证明的是**该值属于候选内容**，故受同一一致性约束。
// ---------------------------------------------------------------------------

test("F1 回归：change_summary 变化后携带旧指纹必须被拒绝（该值会落盘，属候选内容）", async () => {
  await withTemp("workcase-f1-", async (base) => {
    const { precheck, exec } = await setup(base);
    const factSourceRoot = join(base, "proj", "ldvh-base");
    const candidate = viableCandidate();
    const withSummary = (value) => ({
      frontmatterDraft: { ...candidate.frontmatterDraft, change_summary: value },
      bodyMarkdown: candidate.bodyMarkdown,
    });

    const first = withSummary("审计记录 A");
    const pre = await precheck.execute({ frontmatter_draft: first.frontmatterDraft, body_markdown: first.bodyMarkdown }, exec);
    const fingerprint = pre.envelope.result.candidate_fingerprint;

    // 同内容 + 不同 change_summary：必须被拒（此前此处会通过）
    const drifted = withSummary("审计记录 B");
    const res = await createWorkcaseObject({
      factSourceRoot,
      frontmatterDraft: drifted.frontmatterDraft,
      bodyMarkdown: drifted.bodyMarkdown,
      sessionSignature: SIG(),
      expectedCandidateFingerprint: fingerprint,
    });
    assert.ok(!res.ok, "change_summary 变化必须被指纹比对拦下——它会逐字落盘到 change_log");
    assert.equal(res.error.code, "workcase/candidate_changed");
  });
});

test("F1 回归：change_summary 逐字未变时同一指纹仍放行（拒绝来自漂移，不是该参数本身）", async () => {
  await withTemp("workcase-f1b-", async (base) => {
    const { precheck, exec } = await setup(base);
    const factSourceRoot = join(base, "proj", "ldvh-base");
    const candidate = viableCandidate();
    const draft = { ...candidate.frontmatterDraft, change_summary: "审计记录 A" };
    const pre = await precheck.execute({ frontmatter_draft: draft, body_markdown: candidate.bodyMarkdown }, exec);
    const res = await createWorkcaseObject({
      factSourceRoot,
      frontmatterDraft: draft,
      bodyMarkdown: candidate.bodyMarkdown,
      sessionSignature: SIG(),
      expectedCandidateFingerprint: pre.envelope.result.candidate_fingerprint,
    });
    assert.ok(res.ok, `同一内容必须放行：${JSON.stringify(res.error)}`);
  });
});

// F3（中）：指纹格式校验此前无用例守卫，禁用该校验后全部用例仍通过。
test("F3 回归：非法格式的候选指纹被拒绝（格式校验需有守卫，09 §5）", async () => {
  await withTemp("workcase-f3-", async (base) => {
    const factSourceRoot = join(base, "proj", "ldvh-base");
    const candidate = viableCandidate();
    for (const bad of ["not-hex", "a".repeat(63), "g".repeat(64)]) {
      const res = await createWorkcaseObject({
        factSourceRoot,
        frontmatterDraft: candidate.frontmatterDraft,
        bodyMarkdown: candidate.bodyMarkdown,
        sessionSignature: SIG(),
        expectedCandidateFingerprint: bad,
      });
      assert.ok(!res.ok, `非法指纹 ${JSON.stringify(bad)} 必须被拒绝`);
      assert.equal(res.error.code, "workcase/candidate_fingerprint_invalid");
    }
  });
});
