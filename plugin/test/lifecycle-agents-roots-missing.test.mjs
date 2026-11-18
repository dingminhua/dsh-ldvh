import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      try { fn(); } catch {   }
      return () => {};
    },
    set(name, value) {
      services.set(name, value);
    },
    logger: { warn() {}, info() {}, debug() {}, error() {} },
  };
}

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
  ctx.set("agents", { get: () => undefined, list: () => [] });

  const agent = rootAgent();
  agent.session.header.cwd = project;

  await assert.doesNotReject(() => driveInstall(ctx, agent, home, project));
});

test("agents 提供 roots() 但不含该 agent 时，仍按原判据拦截（fail-closed 不变）", async () => {
  const { home, project } = await governedHome();
  const ctx = fakeCtx();
  ctx.set("dshHomePath", (...n) => join(home, ...n));
  const agent = rootAgent();
  agent.session.header.cwd = project;
  ctx.set("agents", { get: () => undefined, list: () => [], roots: () => [] });

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
