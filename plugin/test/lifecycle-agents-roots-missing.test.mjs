// **回归测试**：宿主 dsh-agent 没有 `roots()` 时，install 不得抛 TypeError。
//
// 2026-11-12 线上事故：宿主 dsh-agent 0.2.2-rc.2 的 AgentRegistry 只有
// get() / list()，**没有 roots()**（entry 里也没有 owner 字段）。而
// lifecycle.js 的 install() 无条件调用 `agentsService.roots()`，
// TypeError 冒泡到 `agent/created` 监听器 → agents.create 整体失败 →
// UI 报「新建会话失败：gateway/internal: failed to create session:
// TypeError: agentsService.roots is not a function」。
//
// 本测试锁两件事：
//   1. `roots()` 缺失时 install 不抛错（会话仍能装上）；
//   2. `roots()` 存在但不含该 agent 时，行为不变（仍是 fail-closed 拦截）。
//
// 第 2 条是回归护栏：修复不能把「有 roots() 时按 roots 判据拦截」也一并放掉，
// 否则在提供 roots() 的宿主上子代理会误入 root 路径。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 极小的事件总线桩：只实现本路径用到的 on/emit。 */
function fakeCtx() {
  const handlers = new Map();
  const services = new Map();
  return {
    handlers,
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
      return () => {};
    },
    async emit(type, ...args) {
      const out = [];
      for (const fn of handlers.get(type) ?? []) out.push(await fn(...args));
      return out;
    },
    get(name) {
      return services.get(name);
    },
    effect(fn) {
      try { fn(); } catch { /* 测试桩：不传播 */ }
      return () => {};
    },
    set(name, value) {
      services.set(name, value);
    },
    logger: { warn() {}, info() {}, debug() {}, error() {} },
  };
}

/** 装一个受管辖工作区，让 resolve(cwd) 判定为受管辖。 */
async function governedHome() {
  const home = await mkdtemp(join(tmpdir(), "ldvh-roots-"));
  const project = await mkdtemp(join(tmpdir(), "ldvh-roots-proj-"));
  await mkdir(join(project, "ldvh-base", "frictions"), { recursive: true });
  await mkdir(join(home, "ldvh"), { recursive: true });
  await writeFile(
    join(home, "ldvh", "governed-projects.yaml"),
    `schema_version: 1\ngovernance_instance_name: t\nproduct_description: t\nprojects:\n  - id: test\n    path: ${project}\n    name: test\ndefault_project_id: test\n`,
    "utf8",
  );
  await writeFile(join(project, "ldvh-base", "goal.md"), "---\ntitle: t\n---\n", "utf8").catch(() => {});
  return { home, project };
}

/**
 * 驱动一次 install()：走 `agent/created` 事件，装一个根会话 agent。
 * @param {object} ctx - 事件总线桩
 * @param {object} agent - 根会话 agent 桩
 * @param {string} home - DSH home 路径
 * @param {string} project - 受管辖工作区路径
 */
async function driveInstall(ctx, agent, home, project) {
  const { createLifecycleRegistry } = await import("../lib/lifecycle.js");
  const registry = createLifecycleRegistry(ctx, {
    dshHomePath: (...n) => join(home, ...n),
    workspaceRoot: project,
    sessionScopes: new Map(),
    getIdleSettings: () => ({
      enabled: true,
      tasks: [],
      limits: { silenceMs: 50, quotaMax: 4, quotaWindowMs: 3_600_000 },
    }),
    hostSeams: {
      observePath: () => {},
      register: () => ({ dispose: () => {} }),
      install: () => () => {},
    },
  });
  ctx.tools = { register: () => () => {} };
  ctx.set("subagents", {
    list: () => [],
    getProvider: () => undefined,
    startActivation: async () => undefined,
  });
  await registry.start();
  await ctx.emit("agent/created", { agent, source: "startup" });
  return registry;
}

/** 根会话 agent 桩：无 parentSession → 走 root 路径。 */
function rootAgent() {
  return {
    id: "session-root-1",
    session: {
      id: "session-root-1",
      header: { id: "session-root-1", cwd: "/tmp" },
      events: [],
    },
    ctx: { effect: () => () => {} },
  };
}

test("agents 服务没有 roots() 时，install 不抛 TypeError（会话仍能装上）", async () => {
  const { home, project } = await governedHome();
  const ctx = fakeCtx();
  ctx.set("dshHomePath", (...n) => join(home, ...n));
  // 关键形态：宿主只提供 list()，**没有** roots()。这正是 0.2.2-rc.2 的实况。
  ctx.set("agents", { get: () => undefined, list: () => [] });

  const agent = rootAgent();
  agent.session.header.cwd = project;

  // 修复前此处抛 "agentsService.roots is not a function"；修复后不抛。
  await assert.doesNotReject(() => driveInstall(ctx, agent, home, project));
});

test("agents 提供 roots() 但不含该 agent 时，仍按原判据拦截（fail-closed 不变）", async () => {
  const { home, project } = await governedHome();
  const ctx = fakeCtx();
  ctx.set("dshHomePath", (...n) => join(home, ...n));
  const agent = rootAgent();
  agent.session.header.cwd = project;
  // roots() 存在但返回空数组 → 该 agent 不在 root 名册内 → 应被拦截。
  ctx.set("agents", { get: () => undefined, list: () => [], roots: () => [] });

  // 拦截不是抛错，而是「不装」：agent/created 不得因此失败。
  await assert.doesNotReject(() => driveInstall(ctx, agent, home, project));
});

test("agents 提供 roots() 且含该 agent 时，正常安装", async () => {
  const { home, project } = await governedHome();
  const ctx = fakeCtx();
  ctx.set("dshHomePath", (...n) => join(home, ...n));
  const agent = rootAgent();
  agent.session.header.cwd = project;
  ctx.set("agents", { get: () => undefined, list: () => [agent], roots: () => [agent] });

  await assert.doesNotReject(() => driveInstall(ctx, agent, home, project));
});
