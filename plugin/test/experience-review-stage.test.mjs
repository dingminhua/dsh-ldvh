// 经验审核段的**派发与落盘**（11 §10.2，2026-10-26）。
//
// ## 本文件守什么
//
// §10.2 的判据里，能被机械守住的部分：
//
//   ① **零上下文派生**：执行体必须以 spawn 形态派生；**没有零上下文 provider 时
//      拒绝**，不得退化为继承父上下文（那等于全量交付，§7.1 明禁）。
//   ② **审核段不读实时对话**：交给执行体的提示词里**只有**缓冲投影与既有对象投影，
//      不含区间材料、不含会话正文。这条是结构性的——它拿不到的东西就偷不走。
//   ③ **一次至多 1 条候选**：配额由 `reviewPendingEntries` 强制，本模块不放大。
//   ④ **无提案不落盘**：执行体没给可解析提案时，条目原样留 pending，不得以「缺省」
//      代替材料判断（§10.2 第 5 项）。
//   ⑤ **缓冲为空/不可读时不派发**：空则跳过（不派生执行体），不可读则 fail-closed
//      （不得降级为空集合）。
//
// ## 为什么这些要单独测
//
// 它们都是「错了也不会报错」的类型：退化到继承上下文能跑通、提示词里混进会话正文
// 也能跑通、无提案时静默返回也能跑通——**只有测试能发现**。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_ENTRIES_PER_REVIEW_DISPATCH,
  buildReviewPrompt,
  reviewOutputSchema,
  runReviewStage,
} from "../lib/experience-review-stage.js";

const PROJECT_ID = "fixture-project";

function homeJoiner(base) {
  const joiner = (...segments) => join(base, ...segments);
  joiner.base = base;
  return joiner;
}

/** 在临时 home 里铺一条 pending 条目（生产格式：entry 事件）。 */
async function seedBuffer(base, count = 1) {
  const dir = join(base, "ldvh", "experience-buffers");
  await mkdir(dir, { recursive: true });
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(JSON.stringify({
      kind: "entry",
      record: {
        id: `entry-${index}`,
        // **时间须两位小时**：第一版写成 `T0${index}`，index≥10 时生成 `T010:`——
        // 非法时间戳，条目被读路径判 invalid 而静默丢弃。实测症状是「写 17 条只读到
        // 10 条」，看起来像容量截断，实际是我的夹具造错了时间。
        at: `2026-10-26T${String(index).padStart(2, "0")}:00:00.000Z`,
        session: `session-${index}`,
        anchor: `turn ${index}`,
        phenomenon: `第 ${index} 条观察到的现象。`,
        evidence: `逐字引证 ${index}\n来源：session-${index} turn ${index}`,
        candidate_question: "这是什么机制？",
        status: "pending",
        consumed_by: null,
      },
    }));
  }
  await writeFile(join(dir, `${PROJECT_ID}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

/** 造一个记录所有派发调用的假 subagents 服务。 */
function fakeSubagents({ zeroContext = true, proposals = null, throws = null } = {}) {
  const calls = [];
  return {
    calls,
    list: () => ["spawn"],
    getProvider: (name) => ({ name, inheritsParentContext: !zeroContext, capabilities: { outputSchema: true } }),
    startActivation: async (spec) => {
      calls.push(spec);
      if (throws !== null) throw new Error(throws);
      return {
        childId: "child-1",
        result: Promise.resolve({
          stopReason: "completed",
          structured: proposals === null ? null : { proposals },
        }),
      };
    },
  };
}

function governedScope(base) {
  return { state: "governed", project: { id: PROJECT_ID, path: base } };
}

function quietLifecycle() {
  const events = [];
  return { activity: { record: (name, payload) => events.push({ name, payload }) }, events };
}

// ── ① 零上下文 ──────────────────────────────────────────────────────────

test("没有零上下文 provider 时**拒绝派发**，不得退化为继承父上下文", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  const subagents = fakeSubagents({ zeroContext: false });
  const lifecycle = quietLifecycle();

  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle,
    dshHomePath: homeJoiner(base),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "review_stage/no_zero_context_provider");
  assert.equal(subagents.calls.length, 0, "**不得**调用 startActivation——退化即违反 §7.1");
  assert.match(result.error.message, /zero-context/, "须说清拒绝的理由");
});

// ── ② 提示词只含缓冲投影 ────────────────────────────────────────────────

test("提示词只含缓冲投影与对照集：不含会话正文、区间材料、水位", () => {
  const prompt = buildReviewPrompt({
    entries: [{
      id: "entry-1",
      phenomenon: "现象。",
      anchor: "turn 3",
      session: "session-x",
      candidate_question: "这是什么机制？",
      evidence: "逐字引证片段",
    }],
    existingPitfalls: [{ object_uid: "uid-1", title: "既有经验", status: "active" }],
    projectId: PROJECT_ID,
  });

  // 该有的：条目字段、引证、对照集。
  assert.match(prompt, /现象。/);
  assert.match(prompt, /逐字引证片段/, "必须交付 evidence——审核段要据它判是否成文");
  assert.match(prompt, /uid-1/, "必须交付既有对象投影以便查重");
  // 不该有的：会话正文/区间材料/水位这些「实时对话」的东西。
  for (const forbidden of ["区间材料", "水位", "完整消息", "会话正文"]) {
    assert.ok(!prompt.includes(forbidden), `提示词不得要求或提及 ${forbidden}——审核段不读实时对话`);
  }
  // 逐条判定须写进提示词（2026-10-27 修订：没有产出配额，交出的每条都要有结论）。
  assert.match(prompt, /每一条都必须给出结论/);
  assert.match(prompt, /不得留下未判的条目/);
  // 旧的「一次至多 1 条候选」口径必须消失——它正是待审队列永远清不完的根因。
  assert.ok(
    !prompt.includes("一次至多形成 1 条候选"),
    "不得再向执行体下达「每轮 1 条」的口径（2026-10-27 修订已废止该配额）",
  );
});

test("派发条数受上限约束（防提示词无界增长），且批内每一条都被判完", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  const total = MAX_ENTRIES_PER_REVIEW_DISPATCH + 5;
  await seedBuffer(base, total);
  // 逐条判定：批内**每一条**都要有结论，缺一条整轮 fail-closed。故这里按交付条数
  // 铺满提案（全判为不足），使测试能走到「条数上限」这个断言而不是死在缺判定上。
  const proposals = Array.from({ length: MAX_ENTRIES_PER_REVIEW_DISPATCH }, (_, index) => ({
    entry_id: `entry-${index}`,
    conclusion: "discarded",
    // 弃置理由须与条目的 evidence 有 ≥8 字逐字交集（处置本身要可追溯），故这里
    // 直接引证条目 evidence 里的来源行。
    reason: `不够成文：材料只有「来源：session-${index} turn ${index}」一行，写不出根因与验证两段。`,
  }));
  const subagents = fakeSubagents({ proposals });
  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: homeJoiner(base),
  });
  assert.equal(subagents.calls.length, 1, `须派发一次；实际结果 ${JSON.stringify(result.ok ? result.value : result.error)}`);
  const promptText = subagents.calls[0].request.prompt[0].text;
  const delivered = promptText.match(/### 条目 /g) ?? [];
  assert.equal(delivered.length, MAX_ENTRIES_PER_REVIEW_DISPATCH, "交付条数须受上限约束");
  // 批内全部结算完，未交付的 5 条留到下一次派发（不静默移除）。
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.value.discarded.length, MAX_ENTRIES_PER_REVIEW_DISPATCH);
  assert.equal(result.value.remaining_pending, total - MAX_ENTRIES_PER_REVIEW_DISPATCH);
});

// ── ④ 无提案不落盘 ──────────────────────────────────────────────────────

test("执行体没给可解析提案 → 不落盘，条目原样留 pending（缺省不得代替判断）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  const subagents = fakeSubagents({ proposals: null });
  const lifecycle = quietLifecycle();

  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle,
    dshHomePath: homeJoiner(base),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "review_stage/no_proposals");
  // 缓冲未被改动：仍是 pending（这才是关键——失败不得留下半截状态）。
  const { readBufferEntries } = await import("../lib/observation-buffer.js");
  const after = await readBufferEntries(homeJoiner(base), { projectId: PROJECT_ID });
  assert.equal(after.value.items[0].status, "pending", "无提案时条目必须原样留 pending");
});

// ── ⑤ 空缓冲不派发 / 不可读 fail-closed ──────────────────────────────────

test("缓冲为空时**不派生执行体**（空跑会留下一条无判断产出的运行记录）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  const subagents = fakeSubagents();
  const lifecycle = quietLifecycle();

  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle,
    dshHomePath: homeJoiner(base),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.outcome, "skipped");
  assert.equal(subagents.calls.length, 0, "空缓冲不得派生执行体");
});

test("缓冲不可读时 fail-closed，不降级为空集合（§12bis 纪律 4）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  const dir = join(base, "ldvh", "experience-buffers");
  await mkdir(dir, { recursive: true });
  const readme = join(dir, `${PROJECT_ID}.jsonl`);
  // 造一个「存在但读不了」的载体：用目录占位（readFile 会 EISDIR）。
  await mkdir(readme, { recursive: true });
  const subagents = fakeSubagents();

  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: homeJoiner(base),
  });

  assert.equal(result.ok, false, "不可读必须 fail-closed，不得当作「没有条目」");
  assert.equal(subagents.calls.length, 0);
});

// ── 输出 schema ────────────────────────────────────────────────────────

test("输出 schema 要求 proposals，且每条须有 entry_id 与 conclusion", () => {
  const schema = reviewOutputSchema();
  assert.deepEqual(schema.required, ["proposals"]);
  assert.deepEqual(schema.properties.proposals.items.required, ["entry_id", "conclusion"]);
  assert.deepEqual(
    schema.properties.proposals.items.properties.conclusion.enum.sort(),
    ["discarded", "duplicate", "formed"],
  );
});

// ── 审核执行体的模型指定（2026-10-26 Human 要求）─────────────────────────

test("未指定模型 → 不传 agentOptions（沿用宿主默认路由）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  const subagents = fakeSubagents({ proposals: [{ entry_id: "entry-0", conclusion: "discarded", reason: "不够成文" }] });

  await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: homeJoiner(base),
    model: null,
  });

  assert.equal(subagents.calls[0].request.agentOptions, undefined, "不指定时**不得**传空 agentOptions");
});
