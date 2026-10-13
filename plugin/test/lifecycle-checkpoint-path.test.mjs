// **调用方覆盖**：本测试驱动真实的生命周期回调，而不是绕过它直接调下游模块。
//
// 为什么必须有它：本单的 D1/D2/D3/D8 全部位于「被调用方」，而**调用方从未被
// 测试覆盖**——单元测试直接调 runIdleCheckpoint / landDiscoveryVerdict，
// 于是 `onSessionCheckpoint` 里的一行 `sessionPersistence?.()`（裸标识符，
// 每次都抛 ReferenceError）躲过了三次独立复核与 1281 条测试。
//
// 「测试全绿」与「路径被走过」是两件事。本文件补上后者：以最小可信桩装配
// createLifecycleRegistry, 触发 agent/created → turn-stopping → status:idle,
// 断言检查点**确实走到了落地**（而不是抛错后被吞）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
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
    // install 需要 agent.ctx.effect（宿主的作用域生命周期原语）
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

async function setup({ withSubagents = true } = {}) {
  const { createLifecycleRegistry } = await import("../lib/lifecycle.js");

  const home = await mkdtemp(join(tmpdir(), "ldvh-lc-"));
  const project = await mkdtemp(join(tmpdir(), "ldvh-proj-"));
  await mkdir(join(project, "ldvh-base", "frictions"), { recursive: true });
  // 登记载体：resolve(cwd) 依它判定受管辖。缺它时检查点回调会在第一步静默
  // return——这正是「路径没被走过」时最容易误判成「机制坏了」的又一处。
  await mkdir(join(home, "ldvh"), { recursive: true });
  await writeFile(
    join(home, "ldvh", "governed-projects.yaml"),
    `schema_version: 1\ngovernance_instance_name: t\nproduct_description: t\nprojects:\n  - id: test\n    path: ${project}\n    name: test\ndefault_project_id: test\n`,
    "utf8",
  );
  await writeFile(join(project, "ldvh-base", "goal.md"), "---\ntitle: t\n---\n", "utf8").catch(() => {});

  const ctx = fakeCtx();
  const dshHomePath = (...n) => join(home, ...n);
  ctx.set("dshHomePath", dshHomePath);

  // install 的 roots-only 闸门：ctx.get("agents").roots() 须含该 agent
  const roots = [];
  ctx.set("agents", { roots: () => roots });
  // 工具注册路径：ldvh-tools 用 **ctx.tools 属性**（非服务表）；缺它会让
  // syncTools 抛 TypeError 并被记成 "tool registration DEFECT"，从而中断安装。
  ctx.tools = { register: () => () => {} };

  // 受管辖判定：让 resolve 认为该 cwd 受管辖
  const { setGovernanceScopeResolverForTests } = await import("../lib/lifecycle.js").catch(() => ({}));

  // 子代理服务桩：fork = 继承上下文（§8.4 要求）
  let starts = 0;
  ctx.set("subagents", {
    list: () => ["fork"],
    getProvider: (n) => (n === "fork" ? { name: "fork", inheritsParentContext: true, capabilities: { outputSchema: true } } : undefined),
    start: async () => {
      starts += 1;
      return {
        id: "run-1",
        result: Promise.resolve({
          stopReason: "completed",
          structured: { verdict: "no-discovery", target_uid: "", title: "", phenomenon: "", basis: "", impact: "light", quote: "", reason: "无" },
        }),
        dispose: async () => {},
      };
    },
  });

  // 会话持久化桩：提供路由签名所需的形态（缺失时该步会 fail → 入队）
  ctx.set("sessionPersistence", {
    locate: () => undefined,
    open: () => undefined,
  });

  const lifecycle = createLifecycleRegistry(ctx, {
    dshHomePath,
    workspaceRoot: project,
    sessionScopes: new Map(),
    hostSeams: {
      observePath: () => {},
      // 工具注册路径需要 register 返回可用注册器（否则同步阶段报 DEFECT 并中断安装）
      register: () => ({ dispose: () => {} }),
      install: () => () => {},
    },
  });
  lifecycle.start();

  return { ctx, lifecycle, home, project, dshHomePath, roots, startsRef: () => starts };
}

test("调用方覆盖：驱动检查点后**必须留下运行痕迹**（而非抛错被吞）", async () => {
  const { ctx, dshHomePath, roots, project } = await setup();

  // 捕获被收口的异常：triggers 把 onSessionCheckpoint 的拒绝写成 log.warn，
  // 故把 logger 换成记录器——**被吞掉的异常正是 D8 躲过测试的方式**。
  const warnings = [];
  ctx.logger = { warn: (...a) => warnings.push(a.join(" ")), info() {}, debug() {}, error() {} };

  const agent = { id: "agent-1", session: { header: { id: `session-${Date.now()}`, cwd: project } }, ctx };
  roots.push(agent); // install 的 roots-only 闸门
  await ctx.emit("agent/created", { agent, source: "startup" });
  // install 的**初始受管辖判定是异步的**（resolve(cwd).then(...)）：不等它完成，
  // 检查点会因 scopeState 尚未置为 governed 而静默不跑——这正是「路径没被走过」
  // 时最容易误判成「机制坏了」的地方。
  await new Promise((r) => setTimeout(r, 500));
  await ctx.emit("agent/turn-stopping", { agent, turn: 7 });
  await ctx.emit("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 1200));

  const { readRuns } = await import("../lib/idle-runlog.js");
  const runs = await readRuns(dshHomePath);

  // 判据一：调度未抛错。D8 的形态会让 dispatchCheckpoint 的 catch 记一条
  // "idle checkpoint dispatch failed" —— 这正是要抓的。
  const dispatchFailure = warnings.filter((w) => /dispatch failed|dispatch threw/.test(w));
  assert.deepEqual(dispatchFailure, [], `检查点调度抛出并被吞掉：\n${dispatchFailure.join("\n")}`);

  // 判据二：运行痕迹落盘（证明真的走到了检查点里，而不是被前置 return 挡掉）
  assert.ok(runs.ok, "运行痕迹须可读");
  assert.ok(
    runs.value.total >= 1,
    "驱动检查点后必须留下至少一条运行痕迹——否则说明回调在中途被前置 return 挡掉，或抛错后被吞（D8 形态）",
  );
  const latest = runs.value.runs[runs.value.runs.length - 1];
  assert.ok(
    ["skipped", "not-implemented", "stopped", "landed", "land-failed"].includes(latest.stage),
    `运行痕迹的 stage 须落在已知取值内，实测 ${JSON.stringify(latest.stage)}`,
  );

  // 判据三（M3，2026-10-11 独立复核发现）：持久化痕迹须载明**本次要求做哪几件**
  // 与**哪几件未实现**。
  //
  // 为什么必须在**持久化**层而不只是内存态 activity：activity 随进程退出即消失，
  // 而 32 §10.2 要求「已启用但未实现」在**该次运行的记录**里可见，使 Human 事后
  // 翻查时能看出它没被执行。此前只写 `task: tasks[0]`，于是混合勾选
  // （friction-discovery 开 + capacity 勾但未实现）时，「capacity 已启用却未执行」在
  // runlog 里**根本不出现**——等于没登记。
  assert.ok(Array.isArray(latest.tasks), `运行痕迹须带 tasks 清单（本次要求做哪几件），实测 ${JSON.stringify(latest.tasks)}`);
  assert.ok(latest.tasks.length >= 1, "tasks 不得为空——本次至少有一件要跑才会走到这里");
  assert.ok(
    Array.isArray(latest.unimplemented),
    `运行痕迹须带 unimplemented 清单（哪几件已启用但未实现），实测 ${JSON.stringify(latest.unimplemented)}`,
  );
});

test("调用方覆盖：装配阶段不得引用未声明的标识符（静态判据）", async () => {
  const raw = await readFile(new URL("../lib/lifecycle.js", import.meta.url), "utf8");
  const text = raw.split("\n").map((l) => (l.trimStart().startsWith("//") ? "" : l)).join("\n");
  // D8 的精确形态：把别处的属性名当变量用
  assert.ok(
    !/\bcurrentRouteValues\(\s*sessionPersistence\?\./.test(text),
    "落地路径又用了裸 sessionPersistence —— D8 形态",
  );
});
