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


/**
 * **计时载体是进程内 `setTimeout`（2026-10-24 回退）**，故本文件不再提供任何宿主
 * 调度服务桩：把注入的安静时长调小（50ms）后，触发器自己的计时器就会在真实时间
 * 里到期。测试仍须**等它真的到期**（等待显著大于安静时长），不得绕过计时器直接
 * 调派发——那会把「判据没生效」测成通过。
 */

async function setup({ withSubagents = true, tasks = { "friction-discovery": true, "experience-capture": false } } = {}) {
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
  // **不装配任何宿主调度服务**（2026-10-24 回退后计时器在进程内）：本文件整体
  // 也不再依赖 `ctx.schedule` 的存在与否。

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
    startActivation: async () => {
      starts += 1;
      return {
        childId: "run-1",
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
    // **安静时长缩到 50ms**（11 §6.1）：真值 5 分钟，测试等不起。这是**注入的
    // 测试参数**而非放宽判据——判据本身（「距最后活动 ≥ 安静时长」）原样生效，
    // 只是把它的取值调小。测试仍须等定时器真的到期，不得绕过它直接派发。
    getIdleSettings: () => ({
      enabled: true,
      tasks,
      limits: { silenceMs: 50, quotaMax: 4, quotaWindowMs: 3_600_000 },
    }),
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
  // 11 §6.1：派发发生在**安静期到期**之后（注入值 50ms），故此处须等定时器真的
  // 到期。等待时间须显著大于安静时长，否则会把「还没到点」误判成「机制没跑」。
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

// ---------------------------------------------------------------------------
// F-1（独立代码审核，高危）：**一件成功、一件失败**时，成功者必须照常落地并
// **推进自己的水位**。
//
// 该路径此前**零覆盖**：`friction-discovery-provider.test.mjs` 只测单任务失败，
// 而调用方的落地闸门曾是 `failedTasks.length === 0`（全有或全无），于是：
//   ① 成功者的结论算完即丢（D2 同形）；
//   ② 两个水位都不推进 → 下轮重覆盖同一区间 → 成功者被再落地
//      （`occurrence.count` 虚增，而它是阈值流转的唯一输入源）。
// 「测试全绿」与「该路径被走过」是两件事——本文件正是为后者而存在的。
// ---------------------------------------------------------------------------

test("F-1：一件成功一件失败时，成功者仍落地并**只推进它自己的水位**", async () => {
  // 本测试的**前提是两个任务都启用**（一个成功、一个失败才成其为 F-1 场景）。
  const { ctx, dshHomePath, roots, project, lifecycle } = await setup({
    tasks: { "friction-discovery": true, "experience-capture": true },
  });

  // 让两个任务分别走「成功」与「失败」：经验积累的引证**不在窗口内**——这是
  // 真实高频失败（引证核对按材料正文做字符串比对），不是人为构造的异常。
  const materialText = "本次会话材料：解析反复失败，清理缓存后恢复。";
  ctx.set("subagents", {
    list: () => ["spawn"],
    getProvider: () => ({ name: "spawn", inheritsParentContext: false, capabilities: { outputSchema: true, agentOptions: true, depthLimit: true } }),
    startActivation: async (spec) => {
      const request = spec?.request;
      const promptText = request?.prompt?.[0]?.text ?? "";
      // 探针：把「桩是否被调用」与「窗口里到底有没有材料」写进可断言的地方——
      // 否则「没失败」既可能是逻辑正确，也可能是桩压根没跑（空过）。
      globalThis.__f1Probe = {
        called: true,
        promptChars: promptText.length,
        sawMaterial: promptText.includes(materialText.slice(0, 10)),
        topKeys: Object.keys(request?.outputSchema?.properties ?? {}),
      };
      return {
      // 2026-10-17（rc.1 适配）：SubagentActivation 只暴露 childId——没有 id、
      // 没有 localAgent。provider 以 childId 为键读**执行体自己的**会话记录取署名，
      // 故桩须同时提供该会话的路由（缺它会如实报「执行体无署名」并停止落地，
      // 本用例就验证不到 F-1 的按任务分支）。
      childId: "session-executor-f1",
      dispose: async () => {},
      result: Promise.resolve({
        stopReason: "completed",
        structured: {
          "friction-discovery": {
            verdict: "no-discovery", target_uid: "", title: "", phenomenon: "", basis: "",
            impact: "light", quote: materialText.slice(0, 20), reason: "本次没有系统性阻碍",
          },
          // 经验侧失败靠引证不在材料内（11 §10.1 两段式后只剩这一个高频失败点：
          // 判定态与缓冲字段都合法，唯独 quote 不是材料里的原文）。
          "experience-capture": {
            verdict: "no-failure", phenomenon: "", evidence: "", source: "",
            candidate_question: "",
            quote: "这段引证根本不在材料里面呀", reason: "无命中",
          },
        },
      }),
      };
    },
  });

  // 受控写入需要**权威路由签名**（02 §10.5）：本桩让 `open(id,"read").read()`
  // 返回一条**真实的 routing 事件**，使签名链路走通——否则落地会在「缺签名」
  // 处停住（记 `land-failed/no-signature`），本测试就验证不到「成功者是否落地」。
  //
  // 2026-10-17：签名改为取**执行体**会话路由（09 §5.1「当次实际」），故桩按 sessionId
  // 分别作答——执行体会话给 `executor-provider/executor-model`，其余给父会话那组。
  // 用**不同值**是为让「盖的是谁的章」在本用例里也可判（见下方签名断言）。
  ctx.set("sessionPersistence", {
    locate: () => undefined,
    open: (sid) => ({
      read: async () => ({
        events: [{
          type: "model/selection",
          data: String(sid) === "session-executor-f1"
            ? { provider: "executor-provider", model: "executor-model" }
            : { provider: "stub-provider", model: "stub-model" },
        }],
      }),
      close: async () => {},
    }),
  });

  const sessionId = `session-f1-${Date.now()}`;
  const session = { header: { id: sessionId, cwd: project }, id: sessionId };
  const agent = { id: "agent-f1", session, ctx };
  roots.push(agent);
  await ctx.emit("agent/created", { agent, source: "startup" });
  await new Promise((r) => setTimeout(r, 500));

  // **必须先喂材料**：区间无内容时 provider 会走「空窗口短路」分支（不派生执行体），
  // 我的桩根本不会被调用，于是本条测试会**空过**——这正是「测试全绿≠路径被走过」。
  // 材料由调度侧的累积器在 `session/event` 上机械累积（不读会话日志）。
  // **两个参数**（`(session, event)`）——lifecycle 的注册形态是
  // `ctx.on("session/event", (session, event) => turnTriggers.onSessionEvent(session, event))`。
  // 曾误发成单个对象 `{session, event}`，于是 `event.type` 为 undefined、累积器
  // 收到空内容，区间保持为空 → 空窗口短路 → 桩不被调用（本条测试**空过**）。
  await ctx.emit("session/event", session, { type: "user/message", data: { content: [{ type: "text", text: materialText }] } });
  await ctx.emit("session/event", session, { type: "assistant/message", data: { turn: 12, content: [{ type: "text", text: "已查明根因并采用解法。" }] } });

  await ctx.emit("agent/turn-stopping", { agent, turn: 12 });
  await ctx.emit("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1500));

  const { readRuns } = await import("../lib/idle-runlog.js");
  const read = await readRuns(dshHomePath);
  assert.ok(read.ok, "运行痕迹须可读");
  const runs = read.value.runs;
  // 子项 3 后部分失败的整轮 stage 是 `partial`（有成有败），`land-failed` 专指
  // **无一落地**——两者不得混同，故本测试认 `partial`。
  const failed = runs.filter((r) => r.stage === "partial" || r.stage === "land-failed");
  const landed = runs.filter((r) => r.stage === "landed" || r.stage === "partial");

  // ── 判据一：场景**确实可达**（防「测试空过」）────────────────────────────
  //
  // 本判据是防自欺的关键：若本次运行**根本没走到部分失败**（例如被前置闸门挡掉、
  // 或桩的结论形态不对），那么下面的水位断言就**什么都没验证**——而测试仍然全绿。
  // 「测试全绿」与「该路径被走过」是两件事，本文件正是为后者而存在，故此处
  // **必须先证明场景发生**，再断言其行为。
  assert.ok(
    runs.length > 0,
    "驱动检查点后必须留下运行痕迹——否则回调被前置 return 挡掉或抛错被吞（D8 形态）",
  );
  assert.ok(
    globalThis.__f1Probe?.called === true,
    "**桩执行体必须被真的调用过**——否则本条测试什么都没验证（空窗口短路会绕过它）",
  );
  assert.ok(
    failed.length > 0,
    `本次须真的出现「任务失败」（否则本条什么都没验证）：痕迹见 ${JSON.stringify(runs.map((r) => [r.stage, r.per_task]))}`,
  );
  // 判据以**水位**为准而非 runlog：runlog 在整轮末尾写一条（`landed` 或
  // `land-failed`），它反映的是「整轮结局」，不足以判断**单个任务**是否落地。
  // 水位是每任务独立的，故它才是本条的机械判据——但需先确定「本次确实部分失败」。
  assert.ok(
    failed.length > 0 || landed.length > 0,
    "检查点须走到落地阶段"
    + `若本断言失败即 F-1 复发（闸门仍为全有或全无）；痕迹见 ${JSON.stringify(runs.map((r) => [r.stage, r.action ?? null]))}`
    + `\n待处置队列：${
      await (async () => {
        try {
          const raw = await readFile(join(await dshHomePath(), "ldvh", "pending-queue.jsonl"), "utf8");
          return raw.trim().split("\n").slice(-4).map((l) => { try { const o = JSON.parse(l); return `${o.task}: ${String(o.reason).slice(0, 90)}`; } catch { return l.slice(0, 90); } }).join("\n  ");
        } catch (e) { return `(读不到: ${e.message})`; }
      })()
    }`,
  );

  // ── 判据一·二：**逐任务留痕**（子项 3；§11 留痕前提「其二」的闭合判据）────
  const lastRun = runs[runs.length - 1];
  assert.ok(
    lastRun.per_task && typeof lastRun.per_task === "object",
    "痕迹须含 `per_task` 逐任务结局（整轮单一 action/watermark 不足以推断连续停滞轮次）",
  );
  const fd = lastRun.per_task["friction-discovery"];
  const ec = lastRun.per_task["experience-capture"];
  assert.ok(fd && fd.outcome === "landed", `成功者须在 per_task 里记为 landed，实为 ${JSON.stringify(fd)}`);
  assert.equal(fd.watermark_advanced, true, "成功者的水位推进须逐体可见");
  assert.ok(ec && ec.outcome === "rejected", `校验失败者须在 per_task 里记为 rejected（缺席与「没跑」不可区分），实为 ${JSON.stringify(ec)}`);
  assert.equal(ec.watermark_advanced, undefined, "失败者不得有水位推进记录");

  // ── 判据二：水位按任务分别——**成功者推进、失败者不动** ────────────────────
  const { readWatermark } = await import("../lib/friction-watermark.js");
  const base = { projectRoot: project, sessionId };
  const wFriction = await readWatermark(dshHomePath, { ...base, task: "friction-discovery" });
  const wCapture = await readWatermark(dshHomePath, { ...base, task: "experience-capture" });
  assert.ok(wFriction.ok && wCapture.ok, "两任务的水位都须可读（按任务分别的键）");

  // 两次读取须**各自认出自己的任务**（载体键是会话级的、任务维在其下，故比较
  // `task` 而非 `key`——`key` 两任务本就相同，它是「同一会话的同一份载体」）。
  assert.equal(wFriction.value.task, "friction-discovery");
  assert.equal(wCapture.value.task, "experience-capture");
  // 两任务的水位是**同一个载体下的两个子项**，故其中一项推进不得影响另一项：
  // 这正是「按任务分别」的机械含义。
  assert.notEqual(
    wFriction.value.lastTurn, wCapture.value.lastTurn,
    "两任务水位不得相同——本次一件成功一件失败，成功者应推进、失败者应仍为 null",
  );
  // 成功者的水位**必须**前进（本次区间上界 = turn 12）。
  assert.equal(
    wFriction.value.lastTurn, 12,
    "**成功者（friction-discovery）的水位须推进到本次区间上界**——不推进即下轮重覆盖"
    + "同一区间，使成功者被再落地、`occurrence.count` 虚增（F-1 的后果）",
  );
  // 失败者的水位**必须**不动（留待下次重覆盖）。
  assert.equal(
    wCapture.value.lastTurn, null,
    "**失败者（experience-capture）的水位不得推进**——推进会使那段内容被标记为已处理而永不复查",
  );
});

// ---------------------------------------------------------------------------
// 重启/热重载：轮次号从宿主会话记录回填（2026-10-19）
// ---------------------------------------------------------------------------
//
// 失效路径（生产实测 2026-10-19 10:46–10:51，六次连续失败）：进程重启后
//   · 启动恢复旁路把「最后一次活动时刻」写回并**武装**安静期计时器；
//   · 该会话尚未开启新回合 → `triggers.onTurnStopping` / `onSessionEvent` 都没被
//     调用 → `state.lastTurn` 保持 undefined；
//   · 安静期到期 → `onSessionCheckpoint({ turn: undefined })` → runIdleCheckpoint
//     按 §8.4 第 6 项 fail-closed（`no_current_turn`）。
// 即：**重启后第一次闲时派发必然失败**。
//
// 修复后：位置缺失时从宿主会话记录取最后一个轮次号（11 §11 明定「切分依据只能
// 是宿主会话记录中的位置」），并写回触发器；仍取不到时维持 fail-closed 并如实
// 记下原因。本测试走**真实生命周期回调**——不绕过 onSessionCheckpoint 直调下游
// （D1/D2/D3/D8 全都是这么躲过 1281 条单元测试的）。

test("重启：无回合事件时从宿主会话记录回填轮次，且回填值须一路流到水位", async () => {
  const { ctx, dshHomePath, roots, project, lifecycle } = await setup();
  const sessionId = `session-restart-${Date.now()}`;
  const session = { header: { id: sessionId, cwd: project }, id: sessionId };
  const agent = { id: "agent-restart", session, ctx };
  const EXECUTOR_ID = "session-executor-restart";

  // 窗口材料（重启前该会话最后一轮的内容）。它经 `session/event` 机械累积——
  // **不**由本测试从会话日志重建（11 §11：材料只来自调度侧累积器）。
  const userText = "这次恢复之后，我又遇到重复解析失败。";
  const assistantText = "已定位到缓存条目未失效导致的重复解析失败。";

  // 执行体桩：只跑摩擦发现一件，结论为「无发现」并逐字引证窗口材料。
  // 必须让**落地真的发生**，否则回填出的轮次号在下游没有任何可断言的位置——
  // 首版只断言 `stage !== "stopped"`，实测落在 `land-failed/no-signature`，
  // 于是「回填值被改小/被改 0」这类失效全绿通过（变异测试 M9，0/5 命中）。
  ctx.set("subagents", {
    list: () => ["spawn"],
    getProvider: () => ({ name: "spawn", inheritsParentContext: false, capabilities: { outputSchema: true, agentOptions: true, depthLimit: true } }),
    startActivation: async () => ({
      childId: EXECUTOR_ID,
      dispose: async () => {},
      result: Promise.resolve({
        stopReason: "completed",
        structured: {
          "friction-discovery": {
            verdict: "no-discovery", target_uid: "", title: "", phenomenon: "", basis: "",
            impact: "light", quote: "缓存条目未失效导致的重复解析失败", reason: "本次没有系统性阻碍",
          },
        },
      }),
    }),
  });

  // 宿主记录：本会话已经跑过 7 轮（重启前），但新进程还没收到任何回合事件。
  // 执行体会话的桩另给一条 routing 事件——落地需要**执行体自己的**署名
  // （09 §5.1「当次实际」），缺它会停在 no-signature，本条就又验证不到水位。
  const openCalls = [];
  ctx.set("sessionPersistence", {
    locate: () => undefined,
    open: async (id, access) => {
      openCalls.push([id, access]);
      assert.equal(access, "read", "只允许纯读访问（读位置不取写租约）");
      if (String(id) === EXECUTOR_ID) {
        return {
          read: async () => ({
            events: [{ type: "model/selection", seq: 0, data: { provider: "executor-provider", model: "executor-model" } }],
          }),
          close: async () => {},
        };
      }
      return {
        read: async () => ({
          events: [
            { type: "session", seq: 0, data: { id } },
            { type: "turn/start", seq: 1, data: { turn: 1 } },
            { type: "turn/end", seq: 2, data: { turn: 1 } },
            { type: "turn/start", seq: 11, data: { turn: 6 } },
            { type: "turn/end", seq: 12, data: { turn: 6 } },
            { type: "turn/start", seq: 13, data: { turn: 7 } },
            { type: "turn/end", seq: 14, data: { turn: 7 } },
          ],
        }),
        close: async () => {},
      };
    },
  });

  // 「重启」的形态：没有任何 turn-stopping / turn-end 事件，直接恢复活动锚点。
  // 令锚点足够久远，修复后的 restoreActivityAt 会立刻武装并按剩余量到期。
  const { recordActivity } = await import("../lib/friction-watermark.js");
  await recordActivity(dshHomePath, {
    projectRoot: project,
    sessionId: agent.session.header.id,
    at: new Date(Date.now() - 60_000).toISOString(),
  });

  roots.push(agent);
  await ctx.emit("agent/created", { agent, source: "startup" });
  // 喂入窗口材料：只有 `assistant/message`（**不是** turn/end）不会写 `lastTurn`，
  // 故「重启后尚无回合」这一被测前提仍然成立。
  //
  // ⚠️ 必须在 `agent/created` 返回后**同帧**发出：事件处理器在 install 里同步注册，
  // 而启动恢复旁路的武装是异步的（先 await 受管辖判定）。若先等一轮再喂材料，
  // 恢复锚点会让安静期计时器**立刻**到期并派发——此时累积器还是空的，本次运行
  // 会被判成 `empty-window`，材料一条都进不去（实测踩过：这正是首版失败的原因）。
  await ctx.emit("session/event", session, { type: "user/message", data: { content: [{ type: "text", text: userText }] } });
  await ctx.emit("session/event", session, { type: "assistant/message", data: { turn: 7, message: { content: [{ type: "text", text: assistantText }] } } });
  await new Promise((r) => setTimeout(r, 1500));   // 受管辖判定 + 武装 + 安静期到期（注入 50ms）

  // ① 位置确已写回触发器：`lastTurn` 此前必为 undefined，现在须是宿主记录里的最大值。
  //    触发器状态直接住在 `lifecycle.turns` 里（createTurnTriggers 的注入点），
  //    故 `snapshotOf` 是「机制内部状态」的只读观测口——不需要读插件日志。
  const turns = lifecycle.snapshotOf(agent.id)?.turns;
  assert.ok(turns, "agent 生命周期快照须可读");
  assert.equal(turns.lastTurn, 7, "重启后回填的轮次须是宿主记录里的最大 turn");
  // 派发确已发生（`lastCheckpointDispatch` 在**进入**回调前记录，故它的 turn
  // 仍是回填前的 undefined——回填发生在回调内部，这正是修复的位置）。
  assert.equal(turns.lastCheckpointDispatch?.source, "silence:timer", "安静期到期须真的派发了一次");
  assert.equal(turns.lastCheckpointDispatch?.turn, undefined, "回填发生在回调内部，派发记录的 turn 仍是缺失的原值");

  // ② 派发确已跑起来（不是被 no_current_turn 挡在门外）
  const { readRuns } = await import("../lib/idle-runlog.js");
  const runs = await readRuns(dshHomePath);
  assert.ok(runs.ok && runs.value.total >= 1, "重启后的检查点必须留下运行痕迹");
  const latest = runs.value.runs[runs.value.runs.length - 1];
  assert.notEqual(
    latest.stage, "stopped",
    `重启后派发不得以 stopped 收场（修复前必然是 no_current_turn）：${JSON.stringify(latest)}`,
  );
  assert.notEqual(latest.code, "idle_checkpoint/no_current_turn", "本次修复要消灭的正是这个码");

  // ③ 回填出的轮次号必须**流到下游**并被水位钉住。这一条是本用例的判据核心：
  //    ②只说明「没被前置挡掉」，落地缺签名、空窗口等路径都能让 ② 成立，而
  //    「回填值是多少」全程无人核对（变异测试 M9 正是这样逃过的）。
  assert.equal(
    latest.stage, "landed",
    `回填后的派发须真的走到落地（否则回填值无人消费）：${JSON.stringify(latest)}`,
  );
  assert.equal(latest.action, "none", "无发现即`action: none`——它证明落地函数真的被调用过，而不是停在缺签名");
  assert.equal(
    latest.watermark, 7,
    `**水位须推进到回填出的轮次**——若回填值被改小/改 0，此处即刻暴露：${JSON.stringify(latest)}`,
  );
  assert.equal(
    latest.per_task?.["friction-discovery"]?.watermark_advanced, true,
    "成功者的逐任务水位推进须可见",
  );

  // ④ 两次读取各自钉住来源：先父会话（取位置），后执行体会话（取署名）。
  assert.deepEqual(
    openCalls.map((c) => c[0]), [sessionId, EXECUTOR_ID],
    "位置读父会话、署名读执行体会话，各一次",
  );
});

test("重启：Human 关闭全部子项时不得为读位置而打开会话日志（顺序纪律）", async () => {
  // 回填读的是会话日志（大会话可达数十 MB），故它必须发生在「无启用任务」早退
  // **之后**：Human 关掉机制时本检查点什么都不做。变异测试 M10 把回填移到前置
  // 判定之前，虽然能红，但那是 TDZ 事故而非本纪律——故补一条专属用例：
  // 此处**没有**任何 turn 事件（lastTurn 必为 undefined，回填一定会触发），
  // 唯一可能阻止读取的就是顺序纪律本身。
  const { ctx, dshHomePath, roots, project, lifecycle } = await setup({
    tasks: { "friction-discovery": false, "experience-capture": false },
  });
  const sessionId = `session-restart-disabled-${Date.now()}`;
  const session = { header: { id: sessionId, cwd: project }, id: sessionId };
  const agent = { id: "agent-restart-disabled", session, ctx };

  const openCalls = [];
  ctx.set("sessionPersistence", {
    locate: () => undefined,
    open: async (id, access) => {
      openCalls.push([id, access]);
      throw new Error("Human 已关闭全部子项，本检查点不得读取会话日志");
    },
  });

  const { recordActivity } = await import("../lib/friction-watermark.js");
  await recordActivity(dshHomePath, {
    projectRoot: project,
    sessionId,
    at: new Date(Date.now() - 60_000).toISOString(),
  });

  roots.push(agent);
  await ctx.emit("agent/created", { agent, source: "startup" });
  await new Promise((r) => setTimeout(r, 500));
  await ctx.emit("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 1200));

  // 先证明**检查点真的被派发过**——否则「没读日志」是空过（根本没走到回调）。
  const turns = lifecycle.snapshotOf(agent.id)?.turns;
  assert.equal(
    turns?.lastCheckpointDispatch?.source, "silence:timer",
    "安静期到期须真的派发过一次——否则本用例什么都没验证",
  );
  assert.deepEqual(openCalls, [], "Human 关闭全部子项时本检查点什么都不做，不得为读位置而打开会话日志");
  assert.equal(turns?.lastTurn, undefined, "早退路径不得回填（回填发生在「无启用任务」早退之后）");
});

test("重启：宿主记录不可读时维持 fail-closed 并如实记下原因（不推测位置）", async () => {
  const { ctx, dshHomePath, roots, project, lifecycle } = await setup();
  const agent = { id: "agent-restart-2", session: { header: { id: `session-restart2-${Date.now()}`, cwd: project } }, ctx };

  // 入口可用但读取失败：必须如实上报，不得退化为「当作全部内容」。
  ctx.set("sessionPersistence", {
    locate: () => undefined,
    open: async () => { throw new Error("session log is not flushed"); },
  });

  const { recordActivity } = await import("../lib/friction-watermark.js");
  await recordActivity(dshHomePath, {
    projectRoot: project,
    sessionId: agent.session.header.id,
    at: new Date(Date.now() - 60_000).toISOString(),
  });

  roots.push(agent);
  await ctx.emit("agent/created", { agent, source: "startup" });
  await new Promise((r) => setTimeout(r, 500));
  await ctx.emit("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 1200));

  // 读不到就不得报成已恢复：触发器的 lastTurn 必须仍是 undefined（无位置），
  // 且派发确实以 undefined 走到 fail-closed。
  const turns = lifecycle.snapshotOf(agent.id)?.turns;
  assert.equal(turns?.lastTurn, undefined, "读不到时不得凭空写入轮次号");
  assert.equal(turns?.lastCheckpointDispatch?.source, "silence:timer", "派发确实发生过（不是没到点）");

  // fail-closed：仍以 no_current_turn 停止，且**入了待处置队列**（§12）。
  const { readRuns } = await import("../lib/idle-runlog.js");
  const runs = await readRuns(dshHomePath);
  const latest = runs.value.runs[runs.value.runs.length - 1];
  assert.equal(latest.code, "idle_checkpoint/no_current_turn", "位置不可得须维持 fail-closed，不得当作覆盖全部内容");
  const { readPendingQueue } = await import("../lib/pending-queue.js");
  const queue = await readPendingQueue(dshHomePath);
  assert.ok(
    queue.value.items.some((item) => /currentTurn .* is required/.test(item.reason)),
    `fail-closed 停止须入待处置队列，实测：${JSON.stringify(queue.value.items)}`,
  );
});
