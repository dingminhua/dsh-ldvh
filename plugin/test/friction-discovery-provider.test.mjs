// Tests for plugin/lib/friction-discovery-provider.js —
// 04 §8.4 执行体派生：provider 选择（零上下文派生，Human 决定 2026-10-12）、
// start 调用面、结构化结果的落地前校验、以及各失败路径必须上抛（由调用方按 §8.3 入队）。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectZeroContextProvider,
  createDiscoveryProvider,
} from "../lib/friction-discovery-provider.js";

// 子代理的「一份结论」——注意它现在由**复合对象**承载：每个任务占一个顶层字段
// （Human 2026-10-11 的决定：一次派发做多件事，输出按任务命名空间分区）。
// 这样两个任务用同名通用字段（如 `reason`）时不会互相覆盖，而覆盖是**静默**的。
const VERDICT_SLICE = {
  verdict: "no-discovery",
  target_uid: "",
  title: "",
  phenomenon: "",
  basis: "",
  impact: "light",
  quote: "这是一段足够长的材料内容原文。",
  reason: "本次区间内没有反复出现的阻碍。",
};

/** 把一份任务结论包成宿主提交的复合对象（单任务：名空间为 idle-review）。 */
function composed(slice = VERDICT_SLICE) {
  return { "friction-discovery": slice };
}

const VERDICT_SCHEMA_OK = composed();

const CANDIDATES = [{ object_uid: "11111111-2222-4333-8444-555555555555", status: "observing", title: "CI 慢", phenomenon: "CI 平均 8 分钟。" }];

/** 假 subagents 服务：可控 provider 列表与 start 行为。 */
function fakeSubagents({ providers = [], startImpl } = {}) {
  const starts = [];
  return {
    starts,
    list: () => providers.map((p) => p.name),
    getProvider: (name) => providers.find((p) => p.name === name),
    start: async (name, request) => {
      starts.push({ name, request });
      if (startImpl) return startImpl({ name, request, starts });
      return { id: "run-1", result: Promise.resolve({ stopReason: "completed", structured: VERDICT_SCHEMA_OK }), dispose: async () => {} };
    },
  };
}

function providerNamed(name, { inherits = false, outputSchema = true } = {}) {
  // 默认 inherits=false：与真实 spawn 一致（零上下文）。需继承形态时显式传 true。
  return { name, inheritsParentContext: inherits, capabilities: { outputSchema, agentOptions: true, depthLimit: true, toolFilter: true, persona: true } };
}

const PARENT = { id: "session-parent" };
const SIGNAL = new AbortController().signal;

// ---------------------------------------------------------------------------
// provider 选择（§8.4「执行体与上下文供给」段：零上下文派生，禁止全量交付）
// ---------------------------------------------------------------------------

test("选择：优先 inheritsParentContext=false 的 provider 且偏好名为 spawn 者", () => {
  const r = selectZeroContextProvider(fakeSubagents({ providers: [providerNamed("spawn"), providerNamed("fork", { inherits: true })] }));
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.name, "spawn");
});

test("选择：名不叫 spawn 但零上下文者同样被接受（按能力挑，不硬编码名字）", () => {
  const r = selectZeroContextProvider(fakeSubagents({ providers: [providerNamed("fork", { inherits: true }), providerNamed("custom-zero-context")] }));
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.name, "custom-zero-context");
});

test("选择：**没有任何零上下文 provider 即不可用**，不退回继承形态的 fork（禁止全量交付）", () => {
  const r = selectZeroContextProvider(fakeSubagents({ providers: [providerNamed("fork", { inherits: true })] }));
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery_provider/unavailable");
  assert.match(r.error.message, /zero-context/);
  assert.match(r.error.message, /refusing to fall back to a context-inheriting provider/);
});

test("选择：无 provider 注册即不可用", () => {
  const r = selectZeroContextProvider(fakeSubagents({ providers: [] }));
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery_provider/unavailable");
});

test("选择：list() 抛错时不可用（不静默当作空）", () => {
  const broken = { list: () => { throw new Error("boom"); }, getProvider: () => undefined, start: async () => {} };
  const r = selectZeroContextProvider(broken);
  assert.ok(!r.ok);
  assert.match(r.error.message, /cannot list subagent providers/);
});

// ---------------------------------------------------------------------------
// createDiscoveryProvider 的前置校验
// ---------------------------------------------------------------------------

test("工厂：缺 subagents / parent / signal 均拒绝（显式依赖，不自造）", () => {
  assert.throws(() => createDiscoveryProvider({ parent: PARENT, signal: SIGNAL }), /requires the host `subagents` service/);
  assert.throws(() => createDiscoveryProvider({ subagents: fakeSubagents(), signal: SIGNAL }), /requires the initiating `parent` Agent/);
  assert.throws(() => createDiscoveryProvider({ subagents: fakeSubagents(), parent: PARENT }), /requires an AbortSignal/);
});

// ---------------------------------------------------------------------------
// start 调用面
// ---------------------------------------------------------------------------

test("discover：以 outputSchema 与零上下文 provider 调用 start（§8.4 上下文供给段 + 第三次重批结论）", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("spawn"), providerNamed("fork", { inherits: true })] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  const out = await discover({ threshold: 3, candidates: CANDIDATES, window: { from: 1, to: 5, items: [{ turn: 5, assistant: "这是一段足够长的材料内容原文。" }] } });

  assert.equal(svc.starts.length, 1);
  const call = svc.starts[0];
  assert.equal(call.name, "spawn");
  assert.equal(call.request.parent, PARENT);
  assert.equal(call.request.signal, SIGNAL);
  assert.ok(call.request.outputSchema, "outputSchema 必须随请求传递——它是结构化判断的唯一通道");
  assert.equal(call.request.outputSchema.type, "object");
  assert.ok(Array.isArray(call.request.prompt) && call.request.prompt[0].type === "text");
  assert.match(call.request.prompt[0].text, /N=3/);
  assert.ok(call.request.prompt[0].text.includes(CANDIDATES[0].object_uid));
  assert.equal(out.outcome, "no-discovery");
  assert.equal(out.watermarkTurn, 5, "成功完成才给出推进凭据");
});

test("prompt：公共段声明零上下文派生 + 机械交付，旧「继承主控上下文」措辞不得残留", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("spawn")] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await discover({ threshold: 3, candidates: CANDIDATES, window: { to: 5, items: [{ turn: 5, assistant: "这是一段足够长的材料内容原文。" }] } });
  const text = svc.starts[0].request.prompt[0].text;
  assert.match(text, /零上下文/);
  assert.match(text, /机械交付/);
  assert.doesNotMatch(text, /你继承发起会话的主控上下文/, "旧继承措辞不得残留（04 §8.4 上下文供给段，2026-10-12）");
});

test("discover：run 被释放（holder-owned）", async () => {
  let disposed = 0;
  const svc = fakeSubagents({
    providers: [providerNamed("spawn")],
    startImpl: async () => ({ id: "run-x", result: Promise.resolve({ stopReason: "completed", structured: VERDICT_SCHEMA_OK }), dispose: async () => { disposed += 1; } }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await discover({ threshold: 3, candidates: [], window: { to: 2, items: [{ turn: 2, assistant: "这是一段足够长的材料内容原文。" }] } });
  assert.equal(disposed, 1);
});

test("discover：dispose 抛错不影响已取回的结果", async () => {
  const svc = fakeSubagents({
    providers: [providerNamed("spawn")],
    startImpl: async () => ({ id: "run-y", result: Promise.resolve({ stopReason: "completed", structured: VERDICT_SCHEMA_OK }), dispose: async () => { throw new Error("dispose failed"); } }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  const out = await discover({ threshold: 3, candidates: [], window: { to: 2, items: [{ turn: 2, assistant: "这是一段足够长的材料内容原文。" }] } });
  assert.equal(out.outcome, "no-discovery");
});

// ---------------------------------------------------------------------------
// 失败路径：必须上抛（由 runIdleCheckpoint 按 §8.3 入队，不静默降级）
// ---------------------------------------------------------------------------

test("discover：无零上下文 provider 时抛错（调用方将按 §8.3 入队）", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("fork", { inherits: true })] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await assert.rejects(() => discover({ threshold: 3, candidates: [], window: { to: 1, items: [{ turn: 1, assistant: "这是一段足够长的材料内容原文。" }] } }), /zero-context/);
});

test("discover：start 自身 reject 时上抛（不留 run 供释放）", async () => {
  const svc = fakeSubagents({
    providers: [providerNamed("spawn")],
    startImpl: async () => { throw new Error("capability mismatch"); },
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await assert.rejects(() => discover({ threshold: 3, candidates: [], window: { to: 1, items: [{ turn: 1, assistant: "这是一段足够长的材料内容原文。" }] } }), /capability mismatch/);
});

test("discover：stopReason 非 completed 时上抛并带 diagnostic（不伪造结论）", async () => {
  const svc = fakeSubagents({
    providers: [providerNamed("spawn")],
    startImpl: async () => ({ id: "run-z", result: Promise.resolve({ stopReason: "error", diagnostic: "provider 502" }), dispose: async () => {} }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await assert.rejects(() => discover({ threshold: 3, candidates: [], window: { to: 1, items: [{ turn: 1, assistant: "这是一段足够长的材料内容原文。" }] } }), /stopReason=error.*provider 502/s);
});

test("discover：落地前校验不通过时**如实载明**该任务失败（含指向未知 uid 的情形）", async () => {
  // 改案（2026-10-11 多任务）：任务级失败**不再抛错**——规范 §10.2 要求「任一任务
  // 的结论缺失/校验未通过不使其余任务的结论失效」，而抛错使调用方只能整条丢弃。
  // 现在失败逐任务载明，调用方据此入队（§8.3 停止的对象是失败的任务，不是整次运行）。
  const svc = fakeSubagents({
    providers: [providerNamed("spawn")],
    startImpl: async () => ({
      id: "run-w",
      result: Promise.resolve({ stopReason: "completed", structured: composed({ ...VERDICT_SLICE, verdict: "same-obstacle", target_uid: "99999999-0000-4000-8000-000000000000", quote: "这是一段足够长的材料内容原文。" }) }),
      dispose: async () => {},
    }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  const out = await discover({ threshold: 3, candidates: CANDIDATES, window: { to: 1, items: [{ turn: 1, assistant: "这是一段足够长的材料内容原文。" }] } });
  assert.deepEqual(out.failedTasks, ["friction-discovery"], "失败须如实载明");
  assert.equal(out.taskResults["friction-discovery"].ok, false);
  assert.match(out.taskResults["friction-discovery"].error.message, /target_uid|not among the candidates/);
  // 失败的任务**不得**产出可落地的结论——否则落地侧会把一份无效判断写成账目。
  assert.equal(out.verdict, null, "失败时不得给出 verdict（否则调用方会拿它去落地）");
  assert.equal(out.outcome, null);
  assert.ok(out.taskVerdicts["friction-discovery"] === undefined, "失败的任务不得出现在逐任务成功结论表里");
  // **水位上界仍须给出**（独立代码审核 F-1 的修复）：本字段是「本次区间上界」，
  // 其是否被采用由调用方**按任务分别**决定——成功者推进、失败者不推进。
  // 原断言要求 `undefined`（即「任一任务失败即整体不推进」），那使成功者的水位也
  // 停滞、下轮重覆盖同一区间而致其 `occurrence.count` 虚增；即该「修复」在唯一
  // 需要它的场景里不生效。此处改为断言上界**存在**，且由调用方逐任务决定采用。
  assert.equal(
    out.watermarkTurn, 1,
    "水位**上界**不得因有任务失败而缺席（缺席会使成功者也被重覆盖）",
  );
});

test("discover：structured 缺席时**如实载明**失败（不把空结论当作 no-discovery）", async () => {
  const svc = fakeSubagents({
    providers: [providerNamed("spawn")],
    startImpl: async () => ({ id: "run-v", result: Promise.resolve({ stopReason: "completed" }), dispose: async () => {} }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  const out = await discover({ threshold: 3, candidates: [], window: { to: 1, items: [{ turn: 1, assistant: "这是一段足够长的材料内容原文。" }] } });
  assert.deepEqual(out.failedTasks, ["friction-discovery"], "空结论须判为失败");
  // 关键：**不得**退化为 no-discovery——那会把「执行体什么都没交」写成一次正常观察。
  assert.equal(out.verdict, null);
  assert.notEqual(out.outcome, "no-discovery");
});

test("discover：区间未给 to 时不给出推进凭据（水位不推进）", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("spawn")] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  const out = await discover({ threshold: 3, candidates: [], window: { from: 2, to: null, items: [{ turn: 3, assistant: "这是一段足够长的材料内容原文。" }] } });
  assert.equal(out.watermarkTurn, undefined);
});

test("discover：onRun 观察钩子上报各阶段（供活动记账与实跑取证）", async () => {
  const phases = [];
  const svc = fakeSubagents({ providers: [providerNamed("spawn")] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL, onRun: (e) => phases.push(e.phase) });
  await discover({ threshold: 3, candidates: [], window: { to: 3, items: [{ turn: 3, assistant: "这是一段足够长的材料内容原文。" }] } });
  assert.deepEqual(phases, ["start", "started", "result", "verdict"]);
});

// ---------------------------------------------------------------------------
// D5 回归护栏：窗口判空与取用必须是同一个对象
//
// 形态：曾误写为「判 `effectiveWindow?.items` 而 map `windowRange.items`」——
// 当 provideWindow 返回 undefined 时，前者为假而后者不存在 → TypeError。
// 该异常会让整次运行按 §8.3 入队（机制静默不产出）。由第二次独立复核的探针
// （THREW: Cannot read properties of undefined (reading 'map')）发现。
// 这类缺陷在「happy path 测试」下完全不可见——故须覆盖各种窗口形状。
// ---------------------------------------------------------------------------

test("D5：provideWindow 返回 undefined / 空窗口 / 有材料，三种形状都不得抛错", async () => {
  // 每个形状须给出与其窗口相称的引证：非空材料须引其原文，空/未提供引证为空
  const material = "这是一段足够长的材料内容原文。";
  const shapes = [
    ["undefined", undefined, ""],
    ["null", null, ""],
    ["空窗口", { items: [], truncated: false }, ""],
    ["有材料", { items: [{ turn: 3, assistant: material }], truncated: false }, material],
    ["缺 items 字段", { truncated: false }, ""],
  ];
  for (const [label, shape, quote] of shapes) {
    const svc = fakeSubagents({
      providers: [providerNamed("spawn")],
      startImpl: async () => ({
        id: "run-shape",
        result: Promise.resolve({ stopReason: "completed", structured: composed({ ...VERDICT_SLICE, quote }) }),
        dispose: async () => {},
      }),
    });
    const discover = createDiscoveryProvider({
      subagents: svc,
      parent: PARENT,
      signal: SIGNAL,
      provideWindow: () => shape,
    });
    const out = await discover({ threshold: 3, candidates: [], window: { from: null, to: 5 } });
    assert.equal(out.outcome, "no-discovery", `${label} 形状应当正常产出而非抛错`);
  }
});

test("D5：无 provideWindow 时退回调用方给的 window（向后兼容旧调用面）", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("spawn")] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  const out = await discover({
    threshold: 3,
    candidates: [],
    window: { from: 1, to: 5, items: [{ turn: 5, assistant: "这是一段足够长的材料内容原文。" }] },
  });
  assert.equal(out.outcome, "no-discovery");
  // 提示词须含该材料（证明退回路径也把内容交了出去）
  assert.match(svc.starts[0].request.prompt[0].text, /这是一段足够长的材料内容原文。/);
});

test("D6：窗口有未观察缺口时，缺口被带出交由调用方登记（不静默、也不死锁）", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("spawn")] });
  const gap = { from: 11, to: 20 };
  const discover = createDiscoveryProvider({
    subagents: svc,
    parent: PARENT,
    signal: SIGNAL,
    // 模拟重启后：水位说从 10 起，但本进程只见过 turn 21
    provideWindow: () => ({ items: [{ turn: 21, assistant: "这是一段足够长的材料内容原文。" }], truncated: false, unobserved: gap }),
  });
  const out = await discover({ threshold: 3, candidates: [], window: { from: 10, to: 21 } });
  assert.deepEqual(out.unobserved, gap, "缺口须如实带出，供调用方登记——不得静默丢弃");
  // 但仍照常派生：缺口不可恢复（宿主不回放），拒不推进会永久停摆
  assert.equal(svc.starts.length, 1, "缺口不阻止运行——否则机制永久停摆且每次检查点都塞队列");
});

test("D6：无缺口时 unobserved 为 null（不得误报）", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("spawn")] });
  const discover = createDiscoveryProvider({
    subagents: svc,
    parent: PARENT,
    signal: SIGNAL,
    provideWindow: () => ({ items: [{ turn: 11, assistant: "这是一段足够长的材料内容原文。" }], truncated: false, unobserved: null }),
  });
  const out = await discover({ threshold: 3, candidates: [], window: { from: 10, to: 11 } });
  assert.equal(out.unobserved, null);
});

// ---------------------------------------------------------------------------
// 空区间短路（2026-10-11）——
// 04 §8.4 把观察对象定义为「自上次运行以来新增的会话内容」：无新增即无从观察。
// 此前会照常 fork 一个**继承主控完整上下文**的子代理，只为让它回答「材料为空
// → no-discovery」——而提示词已写死该情形下只能这样答，故这次派发不可能产出
// 别的结论。代价（实测主控会话解压 21.7 MB）与收益完全不相称。
// ---------------------------------------------------------------------------

/** 空窗口短路测试专用的 provider：若被 start 即记为「不该发生」。 */
function shortCircuitHarness() {
  const events = [];
  const subagents = fakeSubagents({ providers: [providerNamed("spawn")] });
  const discover = createDiscoveryProvider({
    subagents,
    parent: PARENT,
    signal: SIGNAL,
    onRun: (e) => events.push(e),
    provideWindow: () => windowFor(),
  });
  let windowFor = () => ({ items: [], truncated: false, unobserved: null });
  return { events, subagents, discover, setWindow: (fn) => { windowFor = fn; } };
}

test("空窗口且**无缺口**：不派生执行体，但结果与「子代理报 no-discovery」同形", async () => {
  const h = shortCircuitHarness();
  const r = await h.discover({ threshold: 3, candidates: [], sessionSignature: "s", window: { from: 10, to: 20 } });

  // ① 核心：**没有派生**。这是本次改动的全部目的（省掉继承全上下文的 fork）。
  assert.equal(h.subagents.starts.length, 0, "空窗口不得派生执行体");

  // ② 结果须与正常路径**完全同形**——调用方按 outcome/verdict/unobserved/
  //    watermarkTurn 四处消费，缺一处就会走出不同分支。
  assert.equal(r.outcome, "no-discovery", "与子代理报无发现同形");
  assert.equal(r.verdict.verdict, "no-discovery", "内层字段名是落地侧既有契约（verdict.verdict）");
  assert.equal(r.unobserved, null, "无缺口");
  assert.equal(r.watermarkTurn, 20, "水位推进终值仍是区间终点（区间内确实无内容可丢）");
  assert.equal(r.skipped, "empty-window", "须留下可分辨的短路标记");

  // ③ 痕迹须可分辨：phase=skipped 且带确切条件，而非一个无从核对的字符串。
  const skipped = h.events.filter((e) => e.phase === "skipped");
  assert.equal(skipped.length, 1, "须记一条 skipped 痕迹");
  assert.equal(skipped[0].reason, "empty-window");
  assert.match(skipped[0].note, /§8\.4|新增内容/, "note 须说清依据（04 §8.4 观察对象=新增内容）");
});

test("空窗口但**有缺口**：**绝不短路**——缺口正是必须登记的对象", async () => {
  // 缺口意味着内容**真实丢失过**。若短路，则「本进程没看到任何事件」这种最
  // 严重的情形（unobserved = { from, to: null }）会被一并吞掉，使缺口既不入队
  // 也不上报——那是把「如实登记」换成「看起来没事」。
  const h = shortCircuitHarness();
  h.setWindow(() => ({ items: [], truncated: false, unobserved: { from: 10, to: 20 } }));

  const r = await h.discover({ threshold: 3, candidates: [], sessionSignature: "s", window: { from: 10, to: 20 } });

  // 本条的断言点是「**不得短路**」——不是「是否抛错」。走原路径意味着它真的派生了
  // 执行体并取回了结果，故返回值里**没有** `skipped: "empty-window"` 标记。
  // （改案后任务级失败不再抛错，故不能再用「有没有 throw」表示「走了原路径」。）
  assert.equal(r?.skipped, undefined, "不得走短路返回");
  assert.ok(!h.events.some((e) => e.phase === "skipped" && e.reason === "empty-window"), "不得记空窗口短路痕迹");
  assert.deepEqual(r?.unobserved, { from: 10, to: 20 }, "缺口须如实带出，交由调用方登记");
});

test("缺口为「开到区间终点」（本进程什么都没看到）同样不得短路", async () => {
  // 最严重的情形：firstObservedTurn === null → unobserved = { from, to: null }。
  const h = shortCircuitHarness();
  h.setWindow(() => ({ items: [], truncated: false, unobserved: { from: 10, to: null } }));
  let skipped = false;
  try {
    await h.discover({ threshold: 3, candidates: [], sessionSignature: "s", window: { from: 10, to: 20 } });
  } catch { /* 走原路径即可能因 provider 行为抛错，与短路判定无关 */ }
  skipped = h.events.some((e) => e.phase === "skipped" && e.reason === "empty-window");
  assert.equal(skipped, false, "「什么都没看到」不得被当成空窗口短路");
});

test("非空窗口：不短路（短路只针对真正没有材料的情形）", async () => {
  const h = shortCircuitHarness();
  // 材料须**含** fixture 的引文（VERDICT_SCHEMA_OK.quote = 「这是一段足够长的材料
  // 内容原文。」）——否则落地侧的逐字引证核对会正确地拒掉它，测试便测不到短路
  // 与否（本测试初版即栽在这里：引文不在窗口，抛错被误读成「没短路」）。
  h.setWindow(() => ({
    items: [{ turn: 11, user: "提问", assistant: "这是一段足够长的材料内容原文。" }],
    truncated: false,
    unobserved: null,
  }));
  const r = await h.discover({ threshold: 3, candidates: [], sessionSignature: "s", window: { from: 10, to: 20 } });
  assert.equal(h.subagents.starts.length, 1, "有材料即须派生执行体");
  assert.equal(r.skipped, undefined, "非空窗口不得带短路标记");
  assert.ok(!h.events.some((e) => e.phase === "skipped"), "不得记短路痕迹");
});

test("短路判定**先于 provider 选择**：无可用 provider 时空窗口仍可短路", async () => {
  // 若短路排在 provider 选择之后，则「没有零上下文的 provider」会让空窗口
  // 情形照旧抛错——而那种情形本就不该需要 provider（不派生任何东西）。
  // 这也使短路对降级组合（无 spawn 能力）同样成立。
  const events = [];
  const discover = createDiscoveryProvider({
    subagents: fakeSubagents({ providers: [providerNamed("fork", { inherits: true })] }),
    parent: PARENT,
    signal: SIGNAL,
    onRun: (e) => events.push(e),
    provideWindow: () => ({ items: [], truncated: false, unobserved: null }),
  });
  const r = await discover({ threshold: 3, candidates: [], sessionSignature: "s", window: { from: 10, to: 20 } });
  assert.equal(r.skipped, "empty-window", "无 provider 也应短路成功（不派生即不需要 provider）");
  assert.equal(events.filter((e) => e.phase === "skipped").length, 1);
});

// ---------------------------------------------------------------------------
// F-1（独立代码审核，高危）：多任务**部分失败**时，成功任务的结论与水位的独立性
//
// 原实现中「按任务分别的水位」只在**存储层**成立，**策略层是全有或全无**：
//   - `watermarkTurn` 以 `failedTasks.length === 0` 为条件；
//   - 调用方的落地闸门同样以它为条件。
// 于是「一件成功、一件失败」时：成功者的结论**算完即丢**（D2 同形），两个水位都
// 不推进，下轮重覆盖使成功者被再落地（`occurrence.count` 虚增）。
// **该修复在唯一需要它的场景里不生效**——而当时没有任何测试覆盖该场景。
// ---------------------------------------------------------------------------

const CAPTURE_SLICE_OK = {
  verdict: "no-capture",
  title: "", scope: "", body: "",
  failure_observed: "", root_cause_known: "", resolution_adopted: "",
  verification_observed: "", duplicate_of: "",
  quote: "这是一段足够长的材料内容原文。",
  reason: "本次没有命中四前提的失败机制。",
};

test("F-1：一件失败一件成功时，`watermarkTurn` 仍须给出（否则成功者也被重覆盖）", async () => {
  const subagents = fakeSubagents({
    providers: [providerNamed("exec")],
    startImpl: () => ({
      id: "run-1",
      dispose: async () => {},
      result: Promise.resolve({
        stopReason: "completed",
        structured: {
          // 摩擦成功
          "friction-discovery": VERDICT_SLICE,
          // 经验失败：引证不在窗口内（真实高频失败：引证核对按材料正文做字符串比对）
          "experience-capture": { ...CAPTURE_SLICE_OK, quote: "这段引证根本不在材料里面呀" },
        },
      }),
    }),
  });
  const discover = createDiscoveryProvider({
    subagents,
    parent: PARENT,
    signal: SIGNAL,
    provideWindow: () => ({ items: [{ turn: 1, user: "这是一段足够长的材料内容原文。" }], truncated: false }),
  });

  const out = await discover({
    threshold: 3,
    candidates: [],
    existingPitfalls: [],
    sessionSignature: null,
    window: { from: 0, to: 5 },
    tasks: ["friction-discovery", "experience-capture"],
  });

  assert.deepEqual(out.failedTasks, ["experience-capture"], "经验积累应失败、摩擦应成功");
  assert.ok(out.taskVerdicts["friction-discovery"] !== undefined, "成功者的结论须可取用");
  assert.equal(
    out.watermarkTurn, 5,
    "**watermarkTurn 不得因有任务失败而缺席**——它是「本次区间上界」，由调用方按任务分别"
    + "决定是否采用；缺席会使成功者的水位也不推进，下轮重覆盖致其 count 虚增（F-1）",
  );
});

test("F-1：全成功时同样给出 watermarkTurn（回归：新条件不得反向破坏）", async () => {
  const subagents = fakeSubagents({
    providers: [providerNamed("exec")],
    startImpl: () => ({
      id: "run-1",
      dispose: async () => {},
      result: Promise.resolve({
        stopReason: "completed",
        structured: { "friction-discovery": VERDICT_SLICE, "experience-capture": CAPTURE_SLICE_OK },
      }),
    }),
  });
  const discover = createDiscoveryProvider({
    subagents,
    parent: PARENT,
    signal: SIGNAL,
    provideWindow: () => ({ items: [{ turn: 1, user: "这是一段足够长的材料内容原文。" }], truncated: false }),
  });
  const out = await discover({
    threshold: 3, candidates: [], existingPitfalls: [], sessionSignature: null,
    window: { from: 0, to: 9 }, tasks: ["friction-discovery", "experience-capture"],
  });
  assert.deepEqual(out.failedTasks, []);
  assert.equal(out.watermarkTurn, 9);
});
