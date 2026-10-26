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
  // 一次至多 1 条候选须写进提示词（执行体要知道配额）。
  assert.match(prompt, /一次至多形成 1 条候选/);
});

test("派发条数受上限约束（防提示词无界增长）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base, MAX_ENTRIES_PER_REVIEW_DISPATCH + 5);
  // 须给一条「discarded」提案：否则落盘阶段会因「无提案」fail-closed，测试就
  // 到不了条数断言（第一版就是这么假失败的——断言本身没错，夹具没铺到那一步）。
  const subagents = fakeSubagents({
    proposals: [{ entry_id: "entry-0", conclusion: "discarded", reason: "不够成文：引证 0" }],
  });
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

test("指定模型 → 经 agentOptions 传给执行体（宿主唯一入口）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  const subagents = fakeSubagents({ proposals: [{ entry_id: "entry-0", conclusion: "discarded", reason: "不够成文" }] });
  // 支持 agentOptions 的 provider
  subagents.getProvider = (name) => ({
    name,
    inheritsParentContext: false,
    capabilities: { outputSchema: true, agentOptions: true },
  });

  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: homeJoiner(base),
    model: { provider: "deepseek", model: "deepseek-chat" },
  });

  assert.equal(subagents.calls.length, 1, JSON.stringify(result));
  assert.deepEqual(
    subagents.calls[0].request.agentOptions,
    { provider: "deepseek", model: "deepseek-chat" },
    "模型须经 request.agentOptions 传递——那是宿主给子代理指定路由的唯一入口",
  );
});

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

test("provider 不支持 agentOptions → 不硬传，且如实记账（否则界面显示已指定而实际未生效）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  const subagents = fakeSubagents({ proposals: [{ entry_id: "entry-0", conclusion: "discarded", reason: "不够成文" }] });
  subagents.getProvider = (name) => ({
    name,
    inheritsParentContext: false,
    capabilities: { outputSchema: true, agentOptions: false },
  });
  const lifecycle = quietLifecycle();

  await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle,
    dshHomePath: homeJoiner(base),
    model: { provider: "deepseek", model: "deepseek-chat" },
  });

  assert.equal(subagents.calls[0].request.agentOptions, undefined, "provider 不认该字段时不得硬传");
  const recorded = lifecycle.events.find((e) => e.name === "review/model-unsupported");
  assert.ok(recorded, "须如实记「模型未被采纳」——静默忽略会让设置面撒谎");
  assert.equal(recorded.payload.requested, "deepseek/deepseek-chat");
});
