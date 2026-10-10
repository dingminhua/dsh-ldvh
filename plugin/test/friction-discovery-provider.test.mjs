// Tests for plugin/lib/friction-discovery-provider.js —
// 04 §8.4 执行体派生：provider 选择（必须继承上下文）、start 调用面、
// 结构化结果的落地前校验、以及各失败路径必须上抛（由调用方按 §8.3 入队）。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectContextInheritingProvider,
  createDiscoveryProvider,
} from "../lib/friction-discovery-provider.js";

const VERDICT_SCHEMA_OK = {
  verdict: "no-discovery",
  target_uid: "",
  title: "",
  phenomenon: "",
  basis: "",
  impact: "light",
  reason: "本次区间内没有反复出现的阻碍。",
};

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

function providerNamed(name, { inherits = true, outputSchema = true } = {}) {
  return { name, inheritsParentContext: inherits, capabilities: { outputSchema, agentOptions: true, depthLimit: true, toolFilter: true, persona: true } };
}

const PARENT = { id: "session-parent" };
const SIGNAL = new AbortController().signal;

// ---------------------------------------------------------------------------
// provider 选择（§8.4：执行体须继承主控上下文）
// ---------------------------------------------------------------------------

test("选择：优先 inheritsParentContext=true 的 provider 且偏好名为 fork 者", () => {
  const r = selectContextInheritingProvider(fakeSubagents({ providers: [providerNamed("spawn", { inherits: false }), providerNamed("fork", { inherits: true })] }));
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.name, "fork");
});

test("选择：名不叫 fork 但继承上下文者同样被接受（按能力挑，不硬编码名字）", () => {
  const r = selectContextInheritingProvider(fakeSubagents({ providers: [providerNamed("spawn", { inherits: false }), providerNamed("custom-inheriting", { inherits: true })] }));
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.name, "custom-inheriting");
});

test("选择：**没有任何继承上下文的 provider 即不可用**，不退回 spawn", () => {
  const r = selectContextInheritingProvider(fakeSubagents({ providers: [providerNamed("spawn", { inherits: false })] }));
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery_provider/unavailable");
  assert.match(r.error.message, /inherits the parent context/);
  assert.match(r.error.message, /refusing to fall back to a zero-context provider/);
});

test("选择：无 provider 注册即不可用", () => {
  const r = selectContextInheritingProvider(fakeSubagents({ providers: [] }));
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery_provider/unavailable");
});

test("选择：list() 抛错时不可用（不静默当作空）", () => {
  const broken = { list: () => { throw new Error("boom"); }, getProvider: () => undefined, start: async () => {} };
  const r = selectContextInheritingProvider(broken);
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

test("discover：以 outputSchema 与继承上下文的 provider 调用 start（§8.4 + 第三次重批结论）", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("spawn", { inherits: false }), providerNamed("fork", { inherits: true })] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  const out = await discover({ threshold: 3, candidates: CANDIDATES, window: { from: 1, to: 5 } });

  assert.equal(svc.starts.length, 1);
  const call = svc.starts[0];
  assert.equal(call.name, "fork");
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

test("discover：run 被释放（holder-owned）", async () => {
  let disposed = 0;
  const svc = fakeSubagents({
    providers: [providerNamed("fork")],
    startImpl: async () => ({ id: "run-x", result: Promise.resolve({ stopReason: "completed", structured: VERDICT_SCHEMA_OK }), dispose: async () => { disposed += 1; } }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await discover({ threshold: 3, candidates: [], window: { to: 2 } });
  assert.equal(disposed, 1);
});

test("discover：dispose 抛错不影响已取回的结果", async () => {
  const svc = fakeSubagents({
    providers: [providerNamed("fork")],
    startImpl: async () => ({ id: "run-y", result: Promise.resolve({ stopReason: "completed", structured: VERDICT_SCHEMA_OK }), dispose: async () => { throw new Error("dispose failed"); } }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  const out = await discover({ threshold: 3, candidates: [], window: { to: 2 } });
  assert.equal(out.outcome, "no-discovery");
});

// ---------------------------------------------------------------------------
// 失败路径：必须上抛（由 runIdleCheckpoint 按 §8.3 入队，不静默降级）
// ---------------------------------------------------------------------------

test("discover：无继承上下文 provider 时抛错（调用方将按 §8.3 入队）", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("spawn", { inherits: false })] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await assert.rejects(() => discover({ threshold: 3, candidates: [], window: { to: 1 } }), /inherits the parent context/);
});

test("discover：start 自身 reject 时上抛（不留 run 供释放）", async () => {
  const svc = fakeSubagents({
    providers: [providerNamed("fork")],
    startImpl: async () => { throw new Error("capability mismatch"); },
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await assert.rejects(() => discover({ threshold: 3, candidates: [], window: { to: 1 } }), /capability mismatch/);
});

test("discover：stopReason 非 completed 时上抛并带 diagnostic（不伪造结论）", async () => {
  const svc = fakeSubagents({
    providers: [providerNamed("fork")],
    startImpl: async () => ({ id: "run-z", result: Promise.resolve({ stopReason: "error", diagnostic: "provider 502" }), dispose: async () => {} }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await assert.rejects(() => discover({ threshold: 3, candidates: [], window: { to: 1 } }), /stopReason=error.*provider 502/s);
});

test("discover：结构化结论未通过落地前校验时抛错（含指向未知 uid 的情形）", async () => {
  const svc = fakeSubagents({
    providers: [providerNamed("fork")],
    startImpl: async () => ({
      id: "run-w",
      result: Promise.resolve({ stopReason: "completed", structured: { ...VERDICT_SCHEMA_OK, verdict: "same-obstacle", target_uid: "99999999-0000-4000-8000-000000000000" } }),
      dispose: async () => {},
    }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await assert.rejects(() => discover({ threshold: 3, candidates: CANDIDATES, window: { to: 1 } }), /target_uid|not among the candidates/);
});

test("discover：structured 缺席时抛错（不把空结论当作 no-discovery）", async () => {
  const svc = fakeSubagents({
    providers: [providerNamed("fork")],
    startImpl: async () => ({ id: "run-v", result: Promise.resolve({ stopReason: "completed" }), dispose: async () => {} }),
  });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  await assert.rejects(() => discover({ threshold: 3, candidates: [], window: { to: 1 } }), /failed the landing-side checks/);
});

test("discover：区间未给 to 时不给出推进凭据（水位不推进）", async () => {
  const svc = fakeSubagents({ providers: [providerNamed("fork")] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL });
  const out = await discover({ threshold: 3, candidates: [], window: { from: 2, to: null } });
  assert.equal(out.watermarkTurn, undefined);
});

test("discover：onRun 观察钩子上报各阶段（供活动记账与实跑取证）", async () => {
  const phases = [];
  const svc = fakeSubagents({ providers: [providerNamed("fork")] });
  const discover = createDiscoveryProvider({ subagents: svc, parent: PARENT, signal: SIGNAL, onRun: (e) => phases.push(e.phase) });
  await discover({ threshold: 3, candidates: [], window: { to: 3 } });
  assert.deepEqual(phases, ["start", "started", "result", "verdict"]);
});
