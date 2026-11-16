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
import { compositePropertyName } from "../lib/aux-task-registry.js";

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

async function setup({ withSubagents = true, tasks = { "friction-discovery": true, "experience-capture": false }, seedPendingQueue = null } = {}) {
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
    // **没有 list()**：宿主 0.2.2-rc.2 已删除它（上游 86d4c75516）。
    // 本假件只提供 fork（继承上下文），用于验证「只有继承形态 → 不可用」；
    // 内置名 spawn 会被探测但 getProvider 返回 undefined，故行为不变。
    getProvider: (n) => (n === "fork" ? { name: "fork", inheritsParentContext: true, capabilities: { outputSchema: true } } : undefined),
    startActivation: async () => {
      starts += 1;
      return {
        childId: "run-1",
        result: Promise.resolve({
          stopReason: "completed",
          structured: { verdict: "no-discovery", target_uid: "", title: "", phenomenon: "", basis: "", quote: "", reason: "无" },
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
  // 11 §12 第 4 条「会话启动时的队列清点」：须在 start() **之前**落好载体，
  // 否则清点读到的是空队列（absent 也是合法初态，但那样测不出「读到几条」）。
  if (Array.isArray(seedPendingQueue)) {
    await writeFile(
      join(home, "ldvh", "pending-queue.jsonl"),
      seedPendingQueue.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      "utf8",
    );
  }
  lifecycle.start();

  return { ctx, lifecycle, home, project, dshHomePath, roots, startsRef: () => starts };
}

/**
 * 等「受管辖判定」落定。
 *
 * 为什么必须轮询而不是固定等待：`turn/end` 只在 `getScopeState() === "governed"`
 * 时才起算安静期（11 §6.1 的管辖闸），而该判定发生在 install 的异步旁路里。
 * 固定等待在全量并发跑测试时不够（实测 2026-10-27：5 条重启用例集体红），
 * 而把等待时间一味拉大又会让整套测试变慢——按条件轮询既确定又快。
 */
async function waitForGoverned(lifecycle, agentId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (lifecycle.snapshotOf(agentId)?.scopeState === "governed") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`受管辖判定未在 ${timeoutMs}ms 内落定（agent=${agentId}）`);
}

/**
 * **唯一能封住「预置活动时刻」变通方式的机械判据**（2026-10-27，独立审核 E4）。
 *
 * 审核实测出的漏洞：把恢复逻辑改名（`restoreAnchor`）、**只预置 `lastActivityAt`
 * 而不武装计时器**、再由 install 调用——全部既有测试仍然全绿。原因是既有用例要么
 * 断言「有没有计时器」，要么断言「派发时的轮次号」，都不问「装载后收到一次
 * status idle 会不会立刻派发」。而真实宿主恰恰会在装载/resume 后报 idle，
 * 此时旧锚点的剩余量为 0，缺陷等效复现。
 *
 * 故本用例只问那一件事：**种一个久远的持久化活动时刻 → 装载 → 报 idle → 有无派发**。
 * 它对应 specs/11 §6.1「不得以变通方式恢复重建」段点名的「预置活动时刻」。
 *
 * **本用例已做破坏性验证**（2026-10-27，在临时副本内注入、工作区未改）：把
 * `restoreAnchorOnly` 加进 triggers、由 install 预置锚点后——本用例**变红**
 * （派发 `source: silence:timer`）；还原后归绿。首版曾误绿，原因是没等装载侧的
 * 异步旁路落定就发 idle（锚点还是 null → 走「无从计时」早退），已由下面的 300ms
 * 等待修正。**已知边界**：若变体连 `silenceTimer` 的初值都修成 `null`（绕开
 * `!== null` 守卫），本用例抓得到的正是那种形态；若变体不改守卫、只预置锚点，
 * 则它被 `armSilenceTimer` 自己的 `!== null` 守卫挡住（`state` 复用的
 * `lifecycle.turns` 本无该键，初值为 `undefined`）——那种情形下缺陷不成立，
 * 用例因此保持绿是对的，但它依赖的是**另一个**偶然守卫，故此点已单列风险登记。
 */
test("11 §6.1：装载后收到 idle **不得**用持久化旧锚点派发（封「预置活动时刻」变通）", async () => {
  const { ctx, dshHomePath, roots, project, lifecycle } = await setup();
  const sessionId = `session-stale-anchor-${Date.now()}`;
  const session = { header: { id: sessionId, cwd: project }, id: sessionId };
  const agent = { id: "agent-stale-anchor", session, ctx };

  // 种一个「早就该到期」的持久化活动时刻（60 秒前，注入的安静时长只有 50ms）。
  // 这正是重启前那个已花掉的安静期的形态。
  const { recordActivity } = await import("../lib/friction-watermark.js");
  await recordActivity(dshHomePath, {
    projectRoot: project,
    sessionId,
    at: new Date(Date.now() - 60_000).toISOString(),
  });

  roots.push(agent);
  await ctx.emit("agent/created", { agent, source: "startup" });
  await waitForGoverned(lifecycle, agent.id);

  // **必须给装载侧的异步旁路留出落定时间**（2026-10-27 破坏性验证实测）：
  // 首版在这里立刻发 idle，结果「预置活动时刻」变体仍然全绿——不是用例判据错，
  // 而是时序错了：装载侧的恢复是 fire-and-forget（中间有 await），idle 先到时
  // `lastActivityAt` 仍为 null，`onAgentStatus` 于是走「无从计时」早退，锚点根本
  // 没用上。真实宿主的 idle 也会在装载后若干毫秒才到，故这里等待是**贴合真实
  // 时序**，不是给缺陷让路。
  await new Promise((r) => setTimeout(r, 300));

  // 宿主在装载/resume 后报 idle——这是真实宿主的行为，也是变通方式的触发点。
  await ctx.emit("agent/status", { agent, status: "idle" });
  await new Promise((r) => setTimeout(r, 800));   // 远大于注入的 50ms 安静时长

  const turns = lifecycle.snapshotOf(agent.id)?.turns;
  assert.equal(
    turns?.lastCheckpointDispatch, undefined,
    "装载后没有结束过任何回合 → 持久化旧锚点不得使检查点被派发（11 §6.1「重启使安静期作废」）",
  );
  // 更强的一条：即便某实现把锚点预置进去了，只要**没有回合结束**，就不得存在
  // 待触发的计时器。`silenceTimer` 可本地回读，故这一条不依赖时序。
  // 取值口径：`state` 复用了 `lifecycle.turns`，该对象本来没有 `silenceTimer` 键，
  // 故「从未武装」表现为 `undefined`；被清过则表现为 `null`。两者都等于「没有活
  // 句柄」，故用宽松判空而不是 `=== null`（写成 `=== null` 会误报真实现）。
  assert.ok(
    turns?.silenceTimer == null,
    `装载后无回合结束 → 不得留下待触发的安静期计时器（实得 ${String(turns?.silenceTimer)}）`,
  );

  // 反向确证本用例**没被空过**：同一会话再走一遍「回合结束 + idle」，仍不得派发。
  //
  // **2026-11-17 改动**：原反向确证是「有回合结束就应当派发（source: silence:timer）」。
  // 触发锚改为主控发起后，回合结束**不再**产生任何派发——故反向确证翻转为
  // 「连回合结束也不得派发」。这不是把用例放宽，而是把判据换成新语义下的更强形式：
  // 旧形态只封住「用旧锚点提前派发」，新形态封住「任何自动派发」。
  await ctx.emit("session/event", session, { type: "turn/end", data: {} });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(
    lifecycle.snapshotOf(agent.id)?.turns?.lastCheckpointDispatch,
    undefined,
    "回合结束也不得自行派发——派发只由主控发起（11 §6.1，2026-11-17）",
  );
});

test("调用方覆盖：驱动检查点后**必须留下运行痕迹**（而非抛错被吞）", async () => {
  const { ctx, dshHomePath, roots, project, lifecycle } = await setup();

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
  // **2026-11-17**：触发锚改为主控发起——不再等「安静期到期」，而是显式发起一次。
  // 这正是新机制下的真实调用形态：主控发现值得记的事，调 requestCheckpoint。
  const requested = lifecycle.requestCheckpoint(agent.id, "controller");
  assert.equal(requested, true, "主控发起入口须可用（否则新机制没有任何触发路径）");
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

// **2026-11-16**：原「F-1：一件成功一件失败」用例已删除——它的前提是「两个任务都启用」
// （`friction-discovery` + `experience-capture`），而经验捕获已从辅助任务移出，
// 派发面只剩摩擦发现一项，「一件成功一件失败」不再可能发生。
// 跨任务不混排的纪律（11 §11）仍由 `friction-discovery` 单任务的逐任务水位承载。


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

// 用例名按刺激如实写（独立审核 2026-10-27 发现 4）：本用例**会**发一条
// `turn/end`（用于起算安静期），那不是「没有回合事件」，而是「没有**带轮次号的**
// 回合事件」——后者才是「重启后尚无回合」这一被测前提的准确形态。
test("重启：无**带轮次号的**回合事件时从宿主会话记录回填轮次，且回填值须一路流到水位", async () => {
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
    // **没有 list()**：候选名由内置名 spawn 提供，与真宿主同形。
    getProvider: () => ({ name: "spawn", inheritsParentContext: false, capabilities: { outputSchema: true, agentOptions: true, depthLimit: true } }),
    startActivation: async () => ({
      childId: EXECUTOR_ID,
      dispose: async () => {},
      result: Promise.resolve({
        stopReason: "completed",
        structured: {
          [compositePropertyName("friction-discovery")]: {
            verdict: "no-discovery", target_uid: "", title: "", phenomenon: "", basis: "",
            quote: "缓存条目未失效导致的重复解析失败", reason: "本次没有系统性阻碍",
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

  // 「重启」的形态：装载之后该会话**尚无任何带轮次号的回合事件**。
  //
  // **2026-10-27 变更**：装载路径不再恢复活动锚点（重启使安静期作废），故不能
  // 再靠「种一个久远锚点」让计时器立刻到期。现在计时**只能由回合结束起算**：
  // 这里发一条 **不带轮次号** 的 `turn/end`——它足以让安静期起算，但**不写**
  // `lastTurn`，于「重启后尚无回合」这一被测前提仍然成立，回填路径照样被走到。
  // （带轮次号的 `turn/end` 会直接把 `lastTurn` 填上，回填就不再发生。）
  roots.push(agent);
  await ctx.emit("agent/created", { agent, source: "startup" });
  // 等受管辖判定落定：`turn/end` 只在 `getScopeState() === "governed"` 时起算安静期
  // （11 §6.1 的管辖闸），而该判定是异步的。装载路径已不建计时器，故此处无需担心
  // 旧陷阱（「累积器还空着就到期」）。
  await waitForGoverned(lifecycle, agent.id);
  // 喂入窗口材料：只有 `assistant/message`（**不是** turn/end）不会写 `lastTurn`。
  await ctx.emit("session/event", session, { type: "user/message", data: { content: [{ type: "text", text: userText }] } });
  await ctx.emit("session/event", session, { type: "assistant/message", data: { turn: 7, message: { content: [{ type: "text", text: assistantText }] } } });
  // **2026-11-17**：不再靠「安静期到期」驱动，改由主控显式发起（新机制的唯一入口）。
  // 回合结束事件仍发——它维护 `lastTurn` 之外的活动记账，但**不再起算任何计时**。
  await ctx.emit("session/event", session, { type: "turn/end", data: {} });
  assert.equal(lifecycle.requestCheckpoint(agent.id, "controller"), true, "发起入口须可用");
  await new Promise((r) => setTimeout(r, 1500));   // 等回填与落地

  // ① 位置确已写回触发器：`lastTurn` 此前必为 undefined，现在须是宿主记录里的最大值。
  //    触发器状态直接住在 `lifecycle.turns` 里（createTurnTriggers 的注入点），
  //    故 `snapshotOf` 是「机制内部状态」的只读观测口——不需要读插件日志。
  const turns = lifecycle.snapshotOf(agent.id)?.turns;
  assert.ok(turns, "agent 生命周期快照须可读");
  assert.equal(turns.lastTurn, 7, "重启后回填的轮次须是宿主记录里的最大 turn");
  // 派发确已发生（`lastCheckpointDispatch` 在**进入**回调前记录，故它的 turn
  // 仍是回填前的 undefined——回填发生在回调内部，这正是修复的位置）。
  assert.equal(turns.lastCheckpointDispatch?.source, "controller", "主控发起须真的派发了一次");
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
  const { ctx, roots, project, lifecycle } = await setup({
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

  roots.push(agent);
  await ctx.emit("agent/created", { agent, source: "startup" });
  await waitForGoverned(lifecycle, agent.id);
  // **2026-11-17**：改由主控显式发起（新机制唯一入口），不再等安静期到期。
  await ctx.emit("session/event", session, { type: "turn/end", data: {} });
  assert.equal(lifecycle.requestCheckpoint(agent.id, "controller"), true, "发起入口须可用");
  await new Promise((r) => setTimeout(r, 1200));

  // 先证明**检查点真的被派发过**——否则「没读日志」是空过（根本没走到回调）。
  const turns = lifecycle.snapshotOf(agent.id)?.turns;
  assert.equal(
    turns?.lastCheckpointDispatch?.source, "controller",
    "主控发起须真的派发过一次——否则本用例什么都没验证",
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

  roots.push(agent);
  await ctx.emit("agent/created", { agent, source: "startup" });
  await waitForGoverned(lifecycle, agent.id);
  // **2026-11-17**：改由主控显式发起（新机制唯一入口），不再等安静期到期。
  await ctx.emit("session/event", agent.session, { type: "turn/end", data: {} });
  assert.equal(lifecycle.requestCheckpoint(agent.id, "controller"), true, "发起入口须可用");
  await new Promise((r) => setTimeout(r, 1200));

  // 读不到就不得报成已恢复：触发器的 lastTurn 必须仍是 undefined（无位置），
  // 且派发确实以 undefined 走到 fail-closed。
  const turns = lifecycle.snapshotOf(agent.id)?.turns;
  assert.equal(turns?.lastTurn, undefined, "读不到时不得凭空写入轮次号");
  assert.equal(turns?.lastCheckpointDispatch?.source, "controller", "派发确实发生过（不是没到点）");

  // fail-closed：仍以 no_current_turn 停止，且**留痕进运行痕迹**（§12，2026-11-17
  // 队列删除后的承载）。
  const { readRuns } = await import("../lib/idle-runlog.js");
  const runs = await readRuns(dshHomePath);
  const stopped = runs.value.runs.filter((r) => r.stage === "stopped");
  assert.ok(
    stopped.some((r) => r.code === "idle_checkpoint/no_current_turn"),
    "位置不可得须维持 fail-closed，不得当作覆盖全部内容",
  );
  assert.ok(
    stopped.some((r) => /currentTurn .* is required/.test(r.reason ?? "")),
    `fail-closed 停止须留痕，实测：${JSON.stringify(stopped)}`,
  );
});

// ---------------------------------------------------------------------------
// 11 §6.1：插件级卸载须清掉已装 agent 的安静期计时器（2026-11-03 补）
//
// 缺口：per-agent disposer 已会 `turnTriggers.dispose()`，但那条路径只在**该 agent
// 的 fiber** 卸载时触发。插件 fiber 卸载（`start()` 返回的清理函数）此前只
// disposeCreated/disposeSubagentEnd、清 children 并删 `agents` 表项，**不枚举已装
// agent 的计时器**。后果：插件重载后旧计时器仍在进程里跑，到期仍会派发——这正是
// 「装载不重建计时」想消除的那类重复触发，只是入口换成了「旧对象没死透」。
//
// 本用例只问一件事：**装一个 agent、武装计时器、走插件级卸载、之后还会不会派发**。
// ---------------------------------------------------------------------------

test("11 §6.1：插件级卸载须清掉已装 agent 的计时器（卸载后不得再派发）", async () => {
  const { ctx, lifecycle, roots, project } = await setup();
  const stopLifecycle = lifecycle.start();
  try {
    const sessionId = `session-plugin-unload-${Date.now()}`;
    const session = { header: { id: sessionId, cwd: project }, id: sessionId };
    const agent = { id: "agent-plugin-unload", session, ctx };

    roots.push(agent);
    await ctx.emit("agent/created", { agent, source: "startup" });
    await waitForGoverned(lifecycle, agent.id);
    // 装载侧异步旁路（含受管辖判定）须落定后再起算安静期
    await new Promise((r) => setTimeout(r, 300));

    // 起算安静期：turn/end → 武装计时器（注入的安静时长是 50ms）
    ctx.emit("session/event", session, { type: "turn/end", turn: 7 });
    ctx.emit("agent/status", { agent, status: "idle" });

    // 插件级卸载（宿主重载插件时走这条路，**不动 agent 自己的 fiber**）
    stopLifecycle();

    // 卸载记录须可回读（否则「清了几台」无从核查）
    const cleared = lifecycle.registryActivitySnapshot().filter((e) => e.hook === "timers/cleared");
    assert.equal(cleared.length, 1, "插件级卸载须落一条 timers/cleared 痕迹");
    assert.ok(
      cleared[0].detail.disposed.includes(agent.id),
      `已装 agent 的计时器须在清理名单里，实测：${JSON.stringify(cleared[0].detail)}`,
    );

    // 等过安静时长：若计时器没被清掉，这里就会派发
    const before = quietDispatchCount(lifecycle);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(
      quietDispatchCount(lifecycle),
      before,
      "插件级卸载后不得再有静置派发（旧计时器必须已清）",
    );
  } finally {
    try { stopLifecycle(); } catch { /* 幂等 */ }
  }
});

/** 读运行记录里由静置计时器发出的派发条数。 */
function quietDispatchCount(lifecycle) {
  const snap = lifecycle.snapshots();
  let count = 0;
  for (const s of snap) {
    for (const entry of s.activity ?? []) {
      if (entry.hook === "session/checkpoint" && entry.detail?.source === "silence:timer") count += 1;
    }
  }
  return count;
}

// ── 11 §12 第 4 条：会话启动时的队列清点 ─────────────────────────────────────
//
// 为什么这条判据必须存在：`countPendingEntries` 早就写好（pending-queue.js:215，
// 注释自称「会话启动时的队列清点」），但**在生产路径上零调用**——只有测试引用
// 过它。后果不是报错而是静默：§12 第 5 条「核查前受影响对象不得被当作稳定事实
// 消费」缺少执行时点，新会话开局时没人知道有多少条未核查登记，也就不会有人去
// 核查（实测 2026-11-02：269 条登记的 resolved_at 全空）。
//
// 这条用例钉的是「调用真的发生且结果可回读」，不是「函数存在」。
// 2026-11-17：会话启动清点测试已随待处置队列删除（11 §12）。
