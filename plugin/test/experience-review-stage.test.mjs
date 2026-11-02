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
//   ③ **一次派发逐条判定**：批内每条都要有结论（2026-10-27 修订；原「一次至多
//      1 条候选」的产出配额已废止——它使待审队列永远清不完）。
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

// ── ⑦ 归档血缘守卫（2026-10-31 实测根因）─────────────────────────────
//
// 宿主的 ArchivedSessionGate 无条件挂在 agent/pre-step，归档血缘下的执行体
// 必然 blocked（实测 78f975c2：10 个事件、19 毫秒、0 条 assistant 消息）。
// 那种派发**必然白跑**，还会把外层锁拖到过期。这里钉住「不派发」与
// 「探不到时照常派发但记账」两条。

test("归档血缘下**不派发执行体**，并如实记 skipped/archived-lineage", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  const subagents = fakeSubagents({ proposals: [] });
  const lifecycle = quietLifecycle();

  const result = await runReviewStage({
    subagents,
    parent: { session: { header: { id: "session-child" } } },
    scope: governedScope(base),
    lifecycle,
    dshHomePath: homeJoiner(base),
    workspaceRegistry: { archivedSessionIds: ["session-parent"] },
    sessions: {
      get: (id) => (id === "session-child"
        ? { header: { id: "session-child", origin: "subagent", parentSession: "session-parent" } }
        : { header: { id, origin: "root" } }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.skipped, true);
  assert.equal(result.value.reason, "archived-lineage");
  assert.equal(subagents.calls.length, 0, "归档血缘下不得派发任何执行体");
  const rec = lifecycle.events.find((e) => e.name === "review/stage");
  assert.equal(rec.payload.outcome, "skipped");
  assert.equal(rec.payload.action, "archived-lineage");
});

test("**探不到归档集合时照常派发**，只记 lineage-unchecked（不得据此永久停摆）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  const subagents = fakeSubagents({ proposals: [] });
  const lifecycle = quietLifecycle();

  const result = await runReviewStage({
    subagents,
    parent: { session: { header: { id: "session-child" } } },
    scope: governedScope(base),
    lifecycle,
    dshHomePath: homeJoiner(base),
    // 服务缺失 → 判不出来
    workspaceRegistry: null,
    sessions: null,
  });

  assert.equal(subagents.calls.length, 1, "探不到时必须照常派发");
  assert.equal(result.ok, true);
  const unchecked = lifecycle.events.find((e) => e.name === "review/lineage-unchecked");
  assert.ok(unchecked !== undefined, "探不到须如实记账");
  assert.equal(unchecked.payload.reason, "archive-set-unavailable");
});

test("执行体被拒（refusal）**不记成 no-proposals**——两者根因不同", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  const subagents = {
    list: () => ["spawn"],
    getProvider: (name) => ({ name, inheritsParentContext: false, capabilities: { outputSchema: true } }),
    startActivation: async () => ({
      childId: "child-1",
      result: Promise.resolve({ stopReason: "refusal", structured: null }),
    }),
  };
  const lifecycle = quietLifecycle();

  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle,
    dshHomePath: homeJoiner(base),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "review_stage/executor_not_run");
  assert.equal(result.error.stopReason, "refusal");
  const rec = lifecycle.events.find((e) => e.name === "review/stage");
  assert.equal(rec.payload.action, "executor-not-run");
});

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

// ── ⑥ 查重对照集的根 ────────────────────────────────────────────────────

test("查重对照集必须从**事实源根**（project.path/ldvh-base）读，不是项目根", async () => {
  // ## 这条守的是一个「静默为空」的真缺陷（2026-10-27 实测并修复）
  //
  // `collectExistingPitfalls({factSourceRoot})` 把入参当**事实源根**用——它在下面
  // 直接找 `pitfalls/`。而 `scope.project.path` 是**仓库根**（事实源在其下的
  // `ldvh-base/`）。写在仓库根上时目录不存在，`listPitfallObjects` 对 ENOENT 返回
  // `success({items:[]})`——**不报错，只是空**。
  //
  // 实测：错根 items=0，正确根 items=40。后果不是慢，而是**查重基线恒为空**：
  // 审核段把每条都判成「无重复」并成文，§10.2 第 2 项的查重覆盖在结构上不存在，
  // 而外观一切正常（无报错、无缺口）。这正是「以产物缺席作否定判据」的失效形态。
  //
  // 判据做法：在临时目录里铺出**真实的双根布局**（根下 ldvh-base/pitfalls/ 放一条
  // 真 Pitfall），再用假 subagents 断言派发出去的提示词里**出现了那条对照对象**。
  // 只断言「函数没报错」抓不到这个缺陷——错根也不报错。
  const base = await mkdtemp(join(tmpdir(), "review-stage-root-"));
  await seedBuffer(base);
  const pitfallDir = join(base, "ldvh-base", "pitfalls");
  await mkdir(pitfallDir, { recursive: true });
  const uid = "0b9e2f5a-1c3d-4e8f-9a0b-1c2d3e4f5a6b";
  await writeFile(join(pitfallDir, `pitfall-${uid}.md`), [
    "---",
    `object_uid: ${uid}`,
    "fact_type_key: pitfall",
    "title: 对照集里的既有经验",
    "scope: 适用于本用例",
    "status: active",
    'created_at: "2026-10-01T00:00:00.000Z"',
    "---",
    "",
    "# 对照集里的既有经验",
    "",
    "## 症状",
    "对照集探针。",
    "",
    "## 影响与适用范围",
    "适用于本用例",
    "",
  ].join("\n"), "utf8");

  const subagents = fakeSubagents({ proposals: [] });
  const lifecycle = quietLifecycle();
  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle,
    dshHomePath: homeJoiner(base),
  });

  // 2026-10-27：提案为空不再整轮 fail-closed——该条记为 unsettled、整轮 partial。
  // 本用例只借这次派发的**提示词**做断言，故这里只断言「确实派发过」即可。
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.value.partial, true, "提案为空 → 该条未判定，整轮须标 partial");
  assert.equal(subagents.calls.length, 1, "前提：确实派发过一次");
  // ⚠️ 提示词在 `startActivation` 的 **`request.prompt`** 里，且是**分段数组**
  // （`[{type:"text", text}]`）而非字符串。两个坑都踩过：读 `call.prompt` 得到
  // undefined，对数组直接 `.includes` 也恒为 false——两者都会让本用例在「代码其实
  // 是对的」时变红，从而看起来像又一个缺陷。
  const promptText = (subagents.calls[0].request?.prompt ?? [])
    .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
    .join("\n");
  assert.match(
    promptText,
    /对照集里的既有经验/,
    "提示词必须含既有 Pitfall 的标题——缺它说明对照集是空的，查重覆盖形同虚设",
  );
});

// ── ⑥ 执行体署名：取数通道必须真的能取到（2026-10-27 缺陷复现与守卫）──────
//
// ## 为什么补这一组
//
// 2026-10-27 实测：审核段在「第一条要成文的条目」处恒被判
// `observation_review/signature_unavailable`，经验观察缓冲 23 条**全部**停在
// pending，一条都没被处理过。根因是 `resolveSignature` 写成了
// `sessionPersistence.read?.(childId)`——而宿主 `sessionPersistence` 服务**没有
// `read()` 方法**（接口是 `locate(header)` 与 `open(id,"read")` → `handle.read()`）。
// 可选链恒为 `undefined`，故该函数**从诞生起每次都返回 null**。
//
// ## 为什么既有测试没发现
//
// 本文件此前**没有任何用例传 `sessionPersistence`**，默认 `null` → 签名恒 null
// → 所有用例都跑在「取不到签名」那条分支上，而它们恰好都在签名闸之前就返回了
// （无提案、空缓冲、条数上限…）。缺陷因此长期不可见。
//
// 故这一组必须**真的装配一个只有 `locate`/`open` 的 persistence**（与宿主同形），
// 并让流程走到「创建 draft」那一步——它能取到签名，才能走到那儿。

/** 宿主同形的 persistence 桩：**没有 read()**，只有 locate 与 open。 */
function fakeSessionPersistence({ events = null, openThrows = null } = {}) {
  const opened = [];
  return {
    opened,
    locate: () => undefined,
    open: async (id, access) => {
      opened.push([id, access]);
      if (openThrows !== null) throw new Error(openThrows);
      return {
        read: async () => ({
          events: events ?? [
            { type: "model/selection", seq: 0, data: { provider: "executor-provider", model: "executor-model" } },
          ],
        }),
      };
    },
  };
}

/** 一条能成文的提案（七段齐备、逐字引证命中原条目）。 */
function formableProposal(entryId = "entry-0") {
  return {
    entry_id: entryId,
    conclusion: "form",
    title: "夹具经验候选标题",
    scope: "仅用于验证署名取数通道的测试夹具，不承载真实经验。",
    body: [
      "## 症状",
      "",
      "夹具现象。",
      "",
      "## 触发条件",
      "",
      "夹具条件。",
      "",
      "## 根因",
      "",
      "夹具根因。",
      "",
      "## 解决",
      "",
      "夹具解决。",
      "",
      "## 规避",
      "",
      "夹具规避。",
      "",
      "## 验证",
      "",
      "夹具验证。",
      "",
      "## 影响与适用范围",
      "",
      "仅用于验证署名取数通道的测试夹具，不承载真实经验。",
    ].join("\n"),
    // 查重记录按 23 §6.2 / 11 §18 的字段要求写：checked 是布尔真值、compared 是
    // **曾比对过的 object_uid 数组**（须覆盖全部 active 与 draft）、conclusion 只认
    // "new" 或 "duplicate"。夹具里没有既有 Pitfall，故 compared 为空数组即可。
    dedupe: { checked: true, compared: [], conclusion: "new" },
  };
}

/** 造 3 条同组摩擦观察（达 §12bis.1 阈值），用于验证晋升路径。 */
async function seedFrictionBuffer(base, count = 3) {
  const dir = join(base, "ldvh", "friction-observations");
  await mkdir(dir, { recursive: true });
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(JSON.stringify({
      id: `friction-entry-${index}`,
      at: `2026-10-26T0${index}:00:00.000Z`,
      project: PROJECT_ID,
      session: `session-${index}`,
      anchor: `turn ${index}`,
      phenomenon: `第 ${index} 次观察到的同一阻碍。`,
      evidence: `逐字引证 ${index}`,
      group: "fixture-group",
      target_uid: null,
      title: "夹具摩擦标题",
      basis: "夹具归因依据。",
      attribution: "夹具归属。",
      status: "pending",
      promoted_to: null,
    }));
  }
  await writeFile(join(dir, `${PROJECT_ID}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

// ── ⑧ 摩擦晋升的署名取主控（2026-10-31 实测缺陷）────────────────────
//
// 原实现传的是 `resolveSignature(sessionPersistence, null)`，而该函数在 id 为空时
// **恒返回 null**。于是每一次摩擦晋升/补充都以 `signature_unavailable` 被拒——
// 实测运行记录里 `friction_residual` 三条全是这个码，界面上「5/3 可晋升」永远不动。
// 摩擦晋升发生在**派发执行体之前**，那时 childId 还不存在；它由主控触发、在宿主
// 进程内完成，故取主控会话署名（11 §4 主控最终负责、09 §5.1 取当次实际判断方）。

test("摩擦晋升**取主控会话署名**，不是执行体、也不是 null", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedFrictionBuffer(base);
  const persistence = fakeSessionPersistence({
    events: [
      { type: "model/selection", seq: 0, data: { provider: "controller-provider", model: "controller-model" } },
    ],
  });
  const subagents = fakeSubagents({ proposals: [] });
  const lifecycle = quietLifecycle();

  const result = await runReviewStage({
    subagents,
    // 主控会话：署名必须从这里取
    parent: { session: { header: { id: "session-controller" } } },
    sessionPersistence: persistence,
    scope: governedScope(base),
    lifecycle,
    dshHomePath: homeJoiner(base),
  });

  // 前提钉子：open 收到的必须是主控会话 id——若实现又退回 null 或改用 childId，本条红。
  const openedIds = persistence.opened.map(([id]) => id);
  assert.ok(
    openedIds.includes("session-controller"),
    `署名须按主控会话 id 取，实际打开的会话：${JSON.stringify(openedIds)}`,
  );
  // 摩擦晋升成功（不是 signature_unavailable）
  const rec = lifecycle.events.find((e) => e.name === "review/stage");
  const residual = rec?.payload?.friction_residual ?? [];
  const signatureFailures = residual.filter((r) => r.code === "signature_unavailable");
  assert.deepEqual(signatureFailures, [], "摩擦晋升不得再因缺署名被拒");
  assert.ok(result.ok);
});

test("11 §12ter.1：**只有 locate/open 的 persistence 也能取到执行体署名**（复现 2026-10-27 恒失败缺陷）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  const persistence = fakeSessionPersistence();
  const subagents = fakeSubagents({ proposals: [formableProposal()] });

  // 前提钉子：桩服务**必须**没有 read()——否则本用例测不到真实形态，会假绿。
  assert.equal(
    typeof persistence.read,
    "undefined",
    "宿主的 sessionPersistence 没有 read()；桩若给了它，本用例就不再代表真实形态",
  );

  const result = await runReviewStage({
    subagents,
    parent: {},
    sessionPersistence: persistence,
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: homeJoiner(base),
  });

  // ① 必须**真的**去读执行体会话（走 open(id,"read") 这条正规入口）。
  assert.deepEqual(
    persistence.opened.map((c) => c[0]), ["child-1"],
    `须用 childId 打开执行体会话；实际 ${JSON.stringify(persistence.opened)}`,
  );
  assert.equal(persistence.opened[0][1], "read", "只允许纯读访问");

  // ② 关键断言：不得再因子虚乌有的「缺署名」而整体失败。
  //    修复前这里必然 error.code === "observation_review/signature_unavailable"。
  assert.notEqual(
    result.ok === true ? null : result.error.code,
    "observation_review/signature_unavailable",
    `签名字段明明取得到，不得判「缺署名」：${JSON.stringify(result.ok ? result.value : result.error)}`,
  );
});

test("11 §12ter.1：署名**确实取不到**时仍 fail-closed（不得静默成功、不得回落主控路由）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  // open 抛错 → 取数通道不可用 → 必须如实判「缺署名」，而不是退化为无签名写入。
  const persistence = fakeSessionPersistence({ openThrows: "session log is not flushed" });
  const subagents = fakeSubagents({ proposals: [formableProposal()] });

  const result = await runReviewStage({
    subagents,
    parent: {},
    sessionPersistence: persistence,
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: homeJoiner(base),
  });

  // 2026-10-27 逐条落地：单条缺署名只让该条不落地，不连累整轮。
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.value.partial, true, "取不到署名 → 该条不得成文");
  assert.ok(
    result.value.unsettled.some((u) => u.code === "observation_review/signature_unavailable"),
    `须如实判缺署名：${JSON.stringify(result.value.unsettled)}`,
  );
  // 缓冲未被半截改动：仍 pending。
  const { readBufferEntries } = await import("../lib/observation-buffer.js");
  const after = await readBufferEntries(homeJoiner(base), { projectId: PROJECT_ID });
  assert.equal(after.value.items[0].status, "pending", "拒绝写入时条目必须原样留 pending");
});

test("11 §12ter.1：执行体会话里没有 routing 事件时判缺署名（不得凭 header 猜测）", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-"));
  await seedBuffer(base);
  // 事件里没有 model/selection 或 request/context → 权威路由不可得。
  const persistence = fakeSessionPersistence({ events: [{ type: "assistant/message", seq: 1, data: {} }] });
  const subagents = fakeSubagents({ proposals: [formableProposal()] });

  const result = await runReviewStage({
    subagents,
    parent: {},
    sessionPersistence: persistence,
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: homeJoiner(base),
  });

  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.value.partial, true, "无 routing 事件 → 该条不得成文");
  assert.ok(
    result.value.unsettled.some((u) => u.code === "observation_review/signature_unavailable"),
    `须判缺署名：${JSON.stringify(result.value.unsettled)}`,
  );
});

// ── ⑨ 摩擦侧投影与转写去向（2026-11-01 B 方案）──────────────────────────

test("提示词交付摩擦侧两层投影：待晋升组与既有账目——否则 group 会新起而不是并入", () => {
  const prompt = buildReviewPrompt({
    entries: [{
      id: "entry-1",
      phenomenon: "现象。",
      anchor: "turn 3",
      session: "session-x",
      candidate_question: "这是什么机制？",
      evidence: "逐字引证片段",
    }],
    existingPitfalls: [],
    projectId: PROJECT_ID,
    frictionGroups: [{
      group: "concurrent-test-temp-dir-interference",
      pending_count: 2,
      phenomenon: "并发跑测试出现两条失败。",
    }],
    frictionLedger: [{
      object_uid: "friction-uid-1",
      status: "open",
      attribution: "测试夹具",
      attribution_ref: null,
      title: "并发测试共享临时端口",
      // **`phenomenon` 是 §7.1 交付面的必列项**（2026-11-01 审核 N1）：判「同一笔账
      // 的同源复观」要靠现象句，只给提炼过的标题判不出来。
      phenomenon: "并发执行回归测试时出现两条失败，单独运行同一测试时全部通过。",
    }],
  });

  // 组的聚合键、已攒条数与现象都必须交付——执行体据它决定并入哪一组。
  assert.match(prompt, /concurrent-test-temp-dir-interference/);
  assert.match(prompt, /2 条/);
  // 账目投影：uid 与归因都要，否则 target_uid 与「同源复观」的判据面不存在。
  assert.match(prompt, /friction-uid-1/);
  assert.match(prompt, /测试夹具/);
  // **现象句必须出现在账目行里**（N1）：断言到行，不只断到「提示词含该串」。
  const ledgerLine = prompt.split("\n").find((line) => line.startsWith("- friction-uid-1"));
  assert.ok(ledgerLine !== undefined, "账目行必须存在");
  assert.match(ledgerLine, /并发执行回归测试时出现两条失败/, "账目行须带现象句，否则执行体只能靠标题判同源");
  // 转写的字段要求必须写进提示词（否则执行体给不出五项，转写恒失败）。
  for (const field of ["title", "basis", "attribution", "group"]) {
    assert.ok(prompt.includes(field), `提示词须列明 transfer 的 ${field}`);
  }
  // 「不要转」的反面判据也必须写清——否则噪音会被塞进摩擦缓冲。
  assert.match(prompt, /不要转/);
});

test("摩擦侧投影交付**全部** pending 组，含未达阈值的 1~2 条组——那正是要并入的对象", async () => {
  // 2026-11-01 审核 F1 用这一例钉住交付面。早先交付的是
  // `readPromotionReadyGroups().ready`，只有 `pending_count >= 3` 的组才在里面，
  // 于是「只有 1~2 条、还没攒够」的组对执行体**完全不可见**——而转写的整个理由
  // 就是「同一阻碍被两条尺子拆开、谁也不到阈值」。看不见它们，执行体只能新起
  // group 键，每个转写都新起一组，提案的核心主张在实现上落空。
  const base = await mkdtemp(join(tmpdir(), "review-stage-groups-"));
  await seedBuffer(base, 1);

  // 在摩擦缓冲里铺两组：一组 2 条（未达阈值）、一组 3 条（已达阈值）。
  const { appendFrictionObservation } = await import("../lib/friction-observation-buffer.js");
  const home = homeJoiner(base);
  for (let i = 0; i < 2; i += 1) {
    const appended = await appendFrictionObservation(home, {
      project: PROJECT_ID,
      session: "s-1",
      anchor: `turn ${i}`,
      phenomenon: `未达阈值的组第 ${i + 1} 次观察`,
      evidence: `未达标组引证 ${i}\n来源：turn ${i}`,
      group: "under-threshold-group",
      title: "未达阈值组的标题",
      basis: "未达阈值组的依据",
      attribution: "测试夹具",
    });
    assert.ok(appended.ok, JSON.stringify(appended.error));
  }
  for (let i = 0; i < 3; i += 1) {
    const appended = await appendFrictionObservation(home, {
      project: PROJECT_ID,
      session: "s-2",
      anchor: `turn ${10 + i}`,
      phenomenon: `已达阈值的组第 ${i + 1} 次观察`,
      evidence: `已达标组引证 ${i}\n来源：turn ${10 + i}`,
      group: "at-threshold-group",
      title: "已达阈值组的标题",
      basis: "已达阈值组的依据",
      attribution: "测试夹具",
    });
    assert.ok(appended.ok, JSON.stringify(appended.error));
  }

  const subagents = fakeSubagents({
    proposals: [{
      entry_id: "entry-0",
      conclusion: "discarded",
      reason: "材料只有「来源：session-0 turn 0」，写不出解决与验证两段。",
    }],
  });
  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: home,
  });
  assert.ok(result.ok, JSON.stringify(result.error));

  const promptText = (subagents.calls[0].request?.prompt ?? [])
    .map((part) => part?.text ?? "")
    .join("\n");
  // **未达阈值组必须出现**——这是本用例的全部意义。
  assert.match(promptText, /under-threshold-group/, "未达阈值的组也须交付，否则执行体只能新起 group 键");
  assert.match(promptText, /2 条/);
  assert.match(promptText, /未达/);
  // 已达阈值组同样在，且标出可达状态。
  assert.match(promptText, /at-threshold-group/);
  assert.match(promptText, /已达/);
});

test("摩擦侧投影区分**待补充组**与**聚合组**——待补充组不会晋升，误标会引导执行体并入不存在的语义", async () => {
  // `by_group` 把带 `target_uid` 的待补充条目也归成一组（`group` 是被命中账目的
  // uid 占位）。这类组**永远不会晋升**（`readPromotionReadyGroups` 已显式跳过），
  // 若投影对它们算 `at_threshold`，执行体会看到一个「2 条、未达阈值、攒够即可」的
  // 假信号，而那个键根本没有「攒够即成账」的语义。
  const base = await mkdtemp(join(tmpdir(), "review-stage-supplement-"));
  await seedBuffer(base, 1);

  const { appendFrictionObservation } = await import("../lib/friction-observation-buffer.js");
  const home = homeJoiner(base);
  const TARGET = "22222222-2222-4222-8222-222222222222";
  for (let i = 0; i < 2; i += 1) {
    const appended = await appendFrictionObservation(home, {
      project: PROJECT_ID,
      session: "s-3",
      anchor: `turn ${30 + i}`,
      phenomenon: `待补充观察第 ${i + 1} 次`,
      evidence: `待补充引证 ${i}\n来源：turn ${30 + i}`,
      group: TARGET,
      target_uid: TARGET,
      title: "待补充组的标题",
      basis: "待补充组的依据",
      attribution: "测试夹具",
    });
    assert.ok(appended.ok, JSON.stringify(appended.error));
  }

  const subagents = fakeSubagents({
    proposals: [{
      entry_id: "entry-0",
      conclusion: "discarded",
      reason: "材料只有「来源：session-0 turn 0」，写不出解决与验证两段。",
    }],
  });
  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: home,
  });
  assert.ok(result.ok, JSON.stringify(result.error));

  const promptText = (subagents.calls[0].request?.prompt ?? [])
    .map((part) => part?.text ?? "")
    .join("\n");

  // **断言必须是组行本身**（2026-11-01 审核 N3 修）。
  //
  // 早先这三条是空断言：`/待补充/` 命中的是段首的状态图例（那段里就有「待补充」
  // 一词）、`includes(TARGET)` 命中的是组键自己（该组的 group 键就是 TARGET）、
  // `doesNotMatch(/未达阈值[^\n]*.../)` 永不匹配（组行印的是第 2 次观察，且
  // `[^\n]*` 跨不过图例段）。结果是把 `supplements` 恒置空（kind 恒 aggregate）
  // 的实现变异**照样全绿**——测试钉不住它声称要钉的东西。
  const groupLine = promptText
    .split("\n")
    .find((line) => line.startsWith(`- \`${TARGET}\``));
  assert.ok(groupLine !== undefined, `待补充组必须出现在组清单里，实际提示词没有该行：${promptText.slice(0, 400)}`);
  // 聚合条目数为 0、待补充条目 2 条 → 必须标「待补充」并带出目标账目。
  // 条数须分别标明（自查 P1）：裸数字会让执行体误读「2 条」指哪一类。
  assert.match(groupLine, /｜ 0 条聚合／2 条待补充 ｜/);
  assert.match(groupLine, new RegExp(`待补充（目标账目 ${TARGET}）`));
  // **不能**标成「未达阈值」——那会给执行体一个「攒够即可晋升」的假信号，
  // 而这个键永远不会晋升（条目走 §9 第 4 项的补充路径）。
  assert.doesNotMatch(groupLine, /未达阈值/);
  assert.doesNotMatch(groupLine, /已达阈值/);
});

test("账本侧投影真的带出 phenomenon——从 `listFrictionObjects` 到提示词的全链路", async () => {
  // 上一例直接调 `buildReviewPrompt`，绕过了投影映射（`item.phenomenon` 那一行），
  // 故把映射改成恒空也**照样绿**（2026-11-01 自查复核发现）。本例走 `runReviewStage`
  // 全链路：磁盘上真建一笔账目 → `listFrictionObjects` 投影 → 提示词，
  // 任何一环丢字段都会红。
  const base = await mkdtemp(join(tmpdir(), "review-stage-ledger-"));
  await seedBuffer(base, 1);

  const { createFrictionObject } = await import("../lib/friction-writer.js");
  const { testSignature } = await import("./helpers.mjs");
  const created = await createFrictionObject({
    factSourceRoot: join(base, "ldvh-base"),
    frontmatterDraft: {
      title: "并发测试共享临时端口",
      phenomenon: "并发执行回归测试时出现两条失败，单独运行同一测试时全部通过。",
      occurrence: { count: 3, first_at: "2026-11-01T00:00:00.000Z", last_at: "2026-11-01T00:00:00.000Z" },
      attribution: "测试夹具",
      change_summary: "测试：账本侧投影",
    },
    bodyMarkdown: "## 现象\n并发执行回归测试时出现两条失败，单独运行同一测试时全部通过。\n\n## 入账依据\n重复出现；修了会改善。",
    sessionSignature: testSignature(),
  });
  assert.ok(created.ok, JSON.stringify(created.error));

  const subagents = fakeSubagents({
    proposals: [{
      entry_id: "entry-0",
      conclusion: "discarded",
      reason: "材料只有「来源：session-0 turn 0」，写不出解决与验证两段。",
    }],
  });
  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: homeJoiner(base),
  });
  assert.ok(result.ok, JSON.stringify(result.error));

  const promptText = (subagents.calls[0].request?.prompt ?? [])
    .map((part) => part?.text ?? "")
    .join("\n");
  const ledgerLine = promptText
    .split("\n")
    .find((line) => line.startsWith(`- ${created.value.object_uid}`));
  assert.ok(ledgerLine !== undefined, "账目行必须存在");
  assert.match(
    ledgerLine,
    /并发执行回归测试时出现两条失败/,
    "账目行须带 phenomenon 句——§7.1 明列它，否则执行体只能靠标题判同源复观",
  );
});

test("投影不可得时**在提示词里如实声明缺口**——否则「缺失」与「确实没有」外观相同", async () => {
  // 2026-11-01 审核 N7：投影读取失败早先只记 activity 事件（内存环形缓冲、重启即失），
  // 执行体照常派发、拿到空组列表。它无法区分「缓冲里真的没有组」与「投影没拿到」，
  // 于是安心新起 group 键——正是 F1 要防的形态。
  //
  // 构造：把 `ldvh/experience-buffers` 换成普通文件，使 `loadObservationDedupCandidates`
  // 读缓冲时 ENOTDIR。
  const base = await mkdtemp(join(tmpdir(), "review-stage-gap-"));
  await seedBuffer(base, 1);
  const home = homeJoiner(base);
  // 先把待审条目取出来（feed 之后缓冲已不可读，改用已读到的快照驱动提示词不现实），
  // 故改在「缓冲可读、账本不可读」上构造：把 ldvh-base 换成一个普通文件。
  await writeFile(join(base, "ldvh-base"), "not a directory\n", "utf8");

  const subagents = fakeSubagents({
    proposals: [{
      entry_id: "entry-0",
      conclusion: "discarded",
      reason: "材料只有「来源：session-0 turn 0」，写不出解决与验证两段。",
    }],
  });
  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: home,
  });
  assert.ok(result.ok, JSON.stringify(result.error));

  const promptText = (subagents.calls[0].request?.prompt ?? [])
    .map((part) => part?.text ?? "")
    .join("\n");
  // 缺口声明必须出现在提示词里，并指出去向（仍要给 transfer，但把不确定写进理由）。
  assert.match(promptText, /本次摩擦侧投影不完整/);
  assert.match(promptText, /可能不是全部/);

  // **返回体也必须带出缺口**（2026-11-01 第三轮审核第 12 条）：只在提示词里说
  // 「可能不是全部」不够——那次声明只对执行体可见，Human 读到的是「一切正常」。
  // 11 §15 的交还第 2 项（读取到的账目范围）与第 4 项（未证实范围）没有别的承载者。
  assert.ok(
    typeof result.value.friction_projection_gap === "string",
    "投影缺口必须随返回体带出，否则 Human 面不可见",
  );
  assert.match(result.value.friction_projection_gap, /ledger/);
  // 读取范围也要有值——它是「读到了多少」 vs 「哪里没读全」的另一半。
  assert.ok(
    result.value.friction_projection_scope !== null
    && typeof result.value.friction_projection_scope === "object",
    "账本读取范围必须随返回体带出（交还第 2 项）",
  );
});

test("转写：执行体的 discarded 提案带 transfer 时，机械侧把它带进落盘", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-stage-transfer-"));
  await seedBuffer(base, 1);
  // `seedBuffer` 不返回值：条目 id 由它按下标固定为 `entry-<index>`（见其定义）。
  const entry = {
    id: "entry-0",
    evidence: "逐字引证 0\n来源：session-0 turn 0",
  };
  const subagents = fakeSubagents({
    proposals: [{
      entry_id: entry.id,
      conclusion: "discarded",
      // 弃置理由须与 evidence 有 ≥8 字逐字交集（§10.2 第 5 项：处置可追溯）。
      // 弃置理由须与 evidence 有 ≥8 字逐字交集（§10.2 第 5 项：处置可追溯）。
      reason: "材料只有「来源：session-0 turn 0」，写不出解决与验证两段。",
      transfer: {
        title: "并发测试共享临时端口",
        basis: "同一现象反复出现；归因：夹具共用固定端口。",
        attribution: "测试夹具",
        group: "concurrent-test-temp-dir-interference",
      },
    }],
  });
  const result = await runReviewStage({
    subagents,
    parent: {},
    scope: governedScope(base),
    lifecycle: quietLifecycle(),
    dshHomePath: homeJoiner(base),
  });
  assert.ok(result.ok, JSON.stringify(result.error));
  assert.deepEqual(result.value.discarded, [entry.id]);
  // **转写发生了**：这是「出了错、还没修」的材料不再消失的机械凭据。
  assert.equal(result.value.transferred.length, 1);
  assert.equal(result.value.transferred[0].entry_id, entry.id);
  assert.equal(result.value.transferred[0].group, "concurrent-test-temp-dir-interference");
  assert.deepEqual(result.value.transfer_failed, []);
});
