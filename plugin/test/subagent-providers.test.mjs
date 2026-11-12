// Tests for plugin/lib/subagent-providers.js —
// 宿主 0.2.2-rc.2 删除 `ctx.subagents.list()` 之后的 provider 发现与挑选。
//
// 这里钉的是**替代通道的语义边界**，不是实现细节：
//   1. 名册只收集「注册事件说存在的名字」，不缓存 provider 对象；
//   2. 可用性永远现查 `getProvider` —— 名册里的陈旧名字必须被剔除，
//      否则卸载后的 provider 会被当成还能派发（虚假可用）；
//   3. 零上下文是硬条件，没有就 fail-closed，**绝不**退回 fork（全量交付禁止）；
//   4. 没有名册时仍能经已知内置名找到 provider（覆盖「provider 先注册、
//      插件后装载」的顺序——这是事件通道唯一的盲区）。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createProviderRoster,
  providerCandidates,
  selectZeroContextProvider,
} from "../lib/subagent-providers.js";

/** 最小可用的 provider 记录：只需声明零上下文与能力面。 */
function providerNamed(name, { inherits = false, outputSchema = true } = {}) {
  return {
    name,
    inheritsParentContext: inherits,
    capabilities: { outputSchema, agentOptions: true, agentPreset: true, depthLimit: true },
  };
}

/**
 * 假宿主：`ctx.on` 记录订阅，`subagents.getProvider` 按注册表现查。
 * `registered` 可随时改动——用来验证「名册说有、服务实际没有」时不得误判可用。
 */
function fakeHost(providers = []) {
  const registry = new Map(providers.map((p) => [p.name, p]));
  const handlers = new Map();
  const ctx = {
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  };
  const subagents = {
    getProvider: (name) => registry.get(name),
    // 注意：**没有 list()** —— 这正是 0.2.2-rc.2 的真实形状。
    startActivation: async () => { throw new Error("not used in these tests"); },
  };
  return { ctx, subagents, registry, handlers };
}

test("名册：只记录注册事件里的名字，removed 事件会移除", () => {
  const { ctx, handlers } = fakeHost();
  const roster = createProviderRoster(ctx);
  handlers.get("subagent/provider-added")(providerNamed("spawn"));
  handlers.get("subagent/provider-added")(providerNamed("custom"));
  assert.deepEqual(roster.names().sort(), ["custom", "spawn"]);
  handlers.get("subagent/provider-removed")("spawn");
  assert.deepEqual(roster.names(), ["custom"]);
});

test("名册：dispose 释放订阅，之后事件不再影响名册", () => {
  const { ctx, handlers } = fakeHost();
  const roster = createProviderRoster(ctx);
  handlers.get("subagent/provider-added")(providerNamed("spawn"));
  roster.dispose();
  assert.deepEqual(roster.names(), []);
  assert.equal(handlers.size, 0, "两个订阅都应被释放");
});

test("名册：无 ctx.on 的虚构上下文下退化为空名册而不抛错", () => {
  const roster = createProviderRoster({});
  assert.deepEqual(roster.names(), []);
  assert.doesNotThrow(() => roster.dispose());
  // null/undefined 同样容忍（测试与诊断路径会传入）
  assert.doesNotThrow(() => createProviderRoster(null));
});

test("候选名：名册 ∪ 已知内置名，去重且名册顺序在前", () => {
  const { ctx, handlers } = fakeHost();
  const roster = createProviderRoster(ctx);
  handlers.get("subagent/provider-added")(providerNamed("custom"));
  handlers.get("subagent/provider-added")(providerNamed("spawn"));
  // spawn 同时在名册与内置表里，不得重复
  assert.deepEqual(providerCandidates(roster), ["custom", "spawn"]);
});

test("候选名：空名册仍返回内置名（覆盖 provider 先注册、插件后装载的顺序）", () => {
  const { ctx } = fakeHost();
  assert.deepEqual(providerCandidates(createProviderRoster(ctx)), ["spawn"]);
});

test("挑选：优先 spawn，其次其它零上下文 provider", () => {
  const providers = [providerNamed("custom"), providerNamed("spawn")];
  const { ctx, handlers } = fakeHost(providers);
  const roster = createProviderRoster(ctx);
  for (const p of providers) handlers.get("subagent/provider-added")(p);

  const picked = selectZeroContextProvider(fakeHost(providers).subagents, roster);
  assert.ok(picked.ok, JSON.stringify(picked.error));
  assert.equal(picked.value.name, "spawn");
});

test("挑选：**名册里的陈旧名字必须被 getProvider 剔除**（不据事件缓存判可用）", () => {
  const { ctx, handlers } = fakeHost();
  const roster = createProviderRoster(ctx);
  handlers.get("subagent/provider-added")(providerNamed("ghost"));
  // 服务里没有 ghost（模拟已卸载但事件丢失）：不得当成可用
  const { subagents } = fakeHost([]);
  const picked = selectZeroContextProvider(subagents, roster);
  assert.equal(picked.ok, false);
  assert.match(picked.error.message, /no subagent provider is registered/u);
});

test("挑选：只有继承父上下文的 provider → fail-closed，绝不退回 fork（全量交付禁止）", () => {
  const providers = [providerNamed("fork", { inherits: true })];
  const { ctx, handlers } = fakeHost(providers);
  const roster = createProviderRoster(ctx);
  handlers.get("subagent/provider-added")(providers[0]);

  const picked = selectZeroContextProvider(fakeHost(providers).subagents, roster);
  assert.equal(picked.ok, false);
  assert.match(picked.error.message, /zero-context/u);
  assert.match(picked.error.message, /refusing to fall back/u);
});

test("挑选：优先能力面带 outputSchema 的零上下文 provider", () => {
  const providers = [
    providerNamed("no-schema", { outputSchema: false }),
    providerNamed("with-schema", { outputSchema: true }),
  ];
  const { ctx, handlers } = fakeHost(providers);
  const roster = createProviderRoster(ctx);
  for (const p of providers) handlers.get("subagent/provider-added")(p);

  const picked = selectZeroContextProvider(fakeHost(providers).subagents, roster);
  assert.ok(picked.ok);
  assert.equal(picked.value.name, "with-schema");
});

test("挑选：服务缺 getProvider 时如实报不可用（不抛错、不静默返回可用）", () => {
  const picked = selectZeroContextProvider({ startActivation: async () => ({}) }, createProviderRoster(null));
  assert.equal(picked.ok, false);
  assert.match(picked.error.message, /getProvider/u);
});

test("挑选：getProvider 抛错时按该名不可用处理，不中断整体挑选", () => {
  const subagents = {
    getProvider(name) {
      if (name === "spawn") throw new Error("boom");
      return providerNamed("custom");
    },
  };
  const roster = { names: () => ["spawn", "custom"] };
  const picked = selectZeroContextProvider(subagents, roster);
  assert.ok(picked.ok, JSON.stringify(picked.error));
  assert.equal(picked.value.name, "custom", "抛错的名字跳过，其余候选仍被考虑");
});
