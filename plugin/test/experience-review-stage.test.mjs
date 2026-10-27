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
