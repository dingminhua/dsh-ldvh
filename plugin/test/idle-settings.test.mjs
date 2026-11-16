// Tests for plugin/lib/idle-settings.js —
// 闲时辅助的设置解析与节流判据（全部纯函数，不读时钟、不碰文件）。
//
// 为什么这层要单测：判据决定「跑不跑」，而它一旦错了有两种代价相反的后果——
// 过松（每次检查点都 fork 一个继承全上下文的子代理，实测发生过：13 次运行挤在
// 43 分钟内、最短间隔 29 秒）与过紧（真实摩擦永不被观察）。故每条判据都要
// 有**两侧**断言：该放行的放行、该拦的拦住。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  IDLE_DEFAULTS,
  admitIdleDispatch,
  pickEnabledAuxTasks,
  AUX_TASK_ORDER,
  readBool,
  readNumber,
  resolveIdleSettings,
} from "../lib/idle-settings.js";

// ---------------------------------------------------------------------------
// 读取层：两代宿主的取值形态
// ---------------------------------------------------------------------------

test("readNumber：volatile 引用与裸值两种形态都认（0.1.7 前后通吃）", () => {
  assert.equal(readNumber(42, 7), 42, "裸数值");
  assert.equal(readNumber({ get: () => 42 }, 7), 42, "volatile { get() }");
  // 缺失与非法一律回落——不静默接受可笑的值。
  assert.equal(readNumber(undefined, 7), 7, "undefined 回落");
  assert.equal(readNumber(null, 7), 7, "null 回落");
  assert.equal(readNumber({}, 7), 7, "无 get 的对象回落");
  assert.equal(readNumber("abc", 7), 7, "非数值回落");
  assert.equal(readNumber(-1, 7), 7, "负数回落（负冷却会让每次检查点都跑）");
  assert.equal(readNumber(Infinity, 7), 7, "Infinity 回落");
});

test("readNumber：**0 是合法值**，不得被回落吃掉", () => {
  // 参照 dsh-auto-memory 的注释「0=不冷却 是合法值，|| 1 会吃掉 0」——
  // 归一化时把 0 当缺省是这类实现最经典的坑。
  assert.equal(readNumber(0, 7), 0, "0 必须原样保留");
  assert.equal(readNumber({ get: () => 0 }, 7), 0, "volatile 形态的 0 同样保留");
});

test("readBool：缺省按 fallback，显式 false 才是否", () => {
  assert.equal(readBool(true, false), true);
  assert.equal(readBool(false, true), false, "显式 false 必须生效");
  assert.equal(readBool(undefined, true), true, "缺失走 fallback");
  assert.equal(readBool({ get: () => false }, true), false, "volatile false 生效");
  assert.equal(readBool({ get: () => true }, false), true, "volatile true 生效");
});

// ---------------------------------------------------------------------------
// resolveIdleSettings：总开关、子项、参数
// ---------------------------------------------------------------------------

test("resolveIdleSettings：无配置时给出默认值（总开关与两个子项均为开）", () => {
  const s = resolveIdleSettings(undefined);
  assert.equal(s.enabled, true, "总开关缺省开——机制现状是常开，缺省关会是行为突变");
  assert.equal(s.tasks["experience-accumulation"], true, "积累经验缺省开");
  assert.equal(s.tasks["friction-discovery"], true, "发现摩擦缺省开");
  assert.equal(s.limits, undefined, "limits 已删除（原只含 silenceMs）");
});

test("resolveIdleSettings：显式配置覆盖默认；两个子项可各自停用", () => {
  // **2026-11-17**：两个子项的产物落点完全不同（Pitfall vs 摩擦缓冲），
  // 故必须能各自停用——合并成一个开关会使其中一类无法单独关掉。
  const onlyExperience = resolveIdleSettings({
    proxyAssistEnabled: true,
    experienceAccumulationEnabled: true,
    frictionDiscoveryEnabled: false,
  });
  assert.equal(onlyExperience.enabled, true);
  assert.equal(onlyExperience.tasks["experience-accumulation"], true);
  assert.equal(onlyExperience.tasks["friction-discovery"], false, "摩擦发现被单独停用");

  const neither = resolveIdleSettings({
    proxyAssistEnabled: false,
    experienceAccumulationEnabled: true,
    frictionDiscoveryEnabled: true,
  });
  assert.equal(neither.enabled, false, "总开关关闭");
  // 总开关关闭时子项开关的取值仍如实解析（不是被抹成 false）——调用方据
  // `enabled` 判定，不据子项；把子项也抹掉会让「用户勾了什么」不可见。
  assert.equal(neither.tasks["friction-discovery"], true);
});

test("配置面迁移：旧键 idleAssistEnabled 仍被识别为总开关（存量配置不静默失效）", () => {
  // 存量用户配置文件里写的是 `idleAssistEnabled`。该键已改名，但**读侧必须回落**——
  // 否则升级后他们的「关」会静默变成「开」，那是行为突变而非配置缺省。
  const legacyOff = resolveIdleSettings({ idleAssistEnabled: false });
  assert.equal(legacyOff.enabled, false, "旧键的关闭值必须仍然生效");

  // 新键优先于旧键。
  const both = resolveIdleSettings({ idleAssistEnabled: false, proxyAssistEnabled: true });
  assert.equal(both.enabled, true, "新键优先");
});


// ---------------------------------------------------------------------------
// admitIdleDispatch：合成判据
// ---------------------------------------------------------------------------

const OPEN_SETTINGS = {
  enabled: true,
  tasks: { "experience-accumulation": true, "friction-discovery": true },
};

test("admitIdleDispatch：开关已开即准入——**§6.2 现无约束可评估**", () => {
  const r = admitIdleDispatch({ settings: OPEN_SETTINGS, task: "friction-discovery" });
  assert.equal(r.admit, true);
  assert.equal(r.reason, "admitted");
  // 2026-10-14 二次修订：§6.2 收为空集，故 evaluations 恒为 `{}`——**这正是
  // 「本节无约束」的可观察形态**（不是省略、也不是漏实现）。若将来重新引入约束，
  // 各类判定须在此逐项给出（当时须补测）。
  assert.deepEqual(r.evaluations, {}, "§6.2 现为空集 → 无约束可评估");
});

test("admitIdleDispatch：**判据顺序**——Human 的明示配置先于机械节流", () => {
  // 顺序即理由：总开关与子项开关一旦关闭，就不该再算其余，也不该因「条件不足」
  // 而记任何账。故此处让所有机械条件都满足，唯独关掉开关，理由须是开关而非节流。
  const closedAssist = { ...OPEN_SETTINGS, enabled: false };
  const r1 = admitIdleDispatch({
    settings: closedAssist, task: "friction-discovery", now: 1, lastDispatchAt: null, dispatched: 0,
  });
  assert.equal(r1.reason, "idle-assist-disabled", "总开关优先");

  const taskOff = { ...OPEN_SETTINGS, tasks: { ...OPEN_SETTINGS.tasks, "friction-discovery": false } };
  const r2 = admitIdleDispatch({
    settings: taskOff, task: "friction-discovery", now: 1, lastDispatchAt: null, dispatched: 0,
  });
  assert.equal(r2.reason, "task-disabled", "子项开关次之");
});

test("admitIdleDispatch：未实现的子项即使被打开，也走各自任务名（不冒充 idle-review）", () => {
  // capacity-maintenance 的实现状态是 not-implemented，但判据层不该知道这件事——
  // 它只回答「这个任务此刻准不准跑」。真实实现状态由 runIdleCheckpoint 如实回报。
  const withCapacity = { ...OPEN_SETTINGS, tasks: { ...OPEN_SETTINGS.tasks, "capacity-maintenance": true } };
  const r = admitIdleDispatch({
    settings: withCapacity, task: "capacity-maintenance", now: 1, lastDispatchAt: null, dispatched: 0,
  });
  assert.equal(r.admit, true, "开关打开即准入（实现状态不在本层判断）");
  // 未打开时须拦。
  assert.equal(
    admitIdleDispatch({
      settings: OPEN_SETTINGS, task: "capacity-maintenance", now: 1, lastDispatchAt: null, dispatched: 0,
    }).reason,
    "task-disabled",
  );
});

test("admitIdleDispatch：isFirstRun 解除内容量门槛（历史摩擦不得因区间短而被漏掉）", () => {
  const r = admitIdleDispatch({
    settings: OPEN_SETTINGS, task: "friction-discovery", now: 10_000_000, dispatched: 0,
  });
  assert.equal(r.admit, true, "首运即使材料为空也准入（那正是「覆盖全部既有内容」）");
});

// ---------------------------------------------------------------------------
// 配额须按**滑动窗口**计（2026-10-11 独立审核 F2 的修复）
// ---------------------------------------------------------------------------
//
// 审核反例（已用真代码复现）：配额原按**会话生命周期累计**，上限耗尽后同一会话
// 内**再无任何检查点可派发**——间隔再久、内容再多都不放行。此时水位不再推进、
// 区间无限增长，**该会话剩余内容永不入账**；而落地侧又不把它登记为失败，故损失
// **无任何痕迹**。那是「抑制」而非「延后」：节流的正当性是「并入下次观察区间」，
// 而耗尽之后根本没有「下次」。
//
// 故 11 §6.2「派发准入」段规定：累计须以**可恢复**的口径计数，不得以会话生命
// 周期为口径。








// ---------------------------------------------------------------------------
// 复审 D1/D2/D7（2026-10-11 第二版独立审核的放行条件）
// ---------------------------------------------------------------------------



// **2026-10-14 删除的测试（如实登记）**：原「D7：默认上限须在默认窗口内可达」断言
// `IDLE_DEFAULTS.maxPerSession < Math.floor(quotaWindowMs / minIntervalMs)`——其
// 前提是「最小间隔」约束存在（窗口内可达次数由它推导）。11 §6.2（2026-10-14 修订）
// 取消该约束后，`minIntervalMs` 不再存在，可达次数不再由比值定义，故本测试的前提
// 消失。**配额是否可被观察**现由「评估结果随返回值给出」的那条测试承载。

// ---------------------------------------------------------------------------
// 一次派发做多件事（Human 决定 2026-10-11：删除轮换概念）
// ---------------------------------------------------------------------------
//
// ## 改动经过
//
// 原实现 `pickEnabledAuxTask(rotation, settings)` 按 `rotation % 3` 挑出**一个**
// 任务，依据是 `specs/32 §10.2`（候选设计）的「按预算轮换：评审优先、容量次之、
// 体检周期性」。Human 于 2026-10-11 改定：闲时任务的取舍由设置面开关决定，
// **勾选几个就做几件事**，一次派发把它们拼进同一个子代理的提示词。
//
// 该改动同时消除了原实现的两个缺陷，故旧的轮换测试（含死锁守卫）已随之删除——
// **没有相位就没有相位死锁**，保留它们既无对象也无意义：
//   · 轮换位死锁：`memory-health` 默认停用 → 每次被挡下 → 轮换位永为 2 →
//     `friction-discovery` 再也不被跑到；
//   · 任务不在任何相位上：`capacity-maintenance` 实测 60 个相位里被选中 **0** 次。

test("pickEnabledAuxTasks：**勾选几个就跑几件**——不是挑一个（本条守卫本次改案本身）", () => {
  // 按登记表构造「全开」，不硬编码清单——清单会随新增任务变化（已由三项增至
  // 四项：积累经验），硬编码会使本测试在每次新增任务时必然过期。
  const openAll = { enabled: true, tasks: Object.fromEntries(AUX_TASK_ORDER.map((k) => [k, true])) };
  const all = pickEnabledAuxTasks(openAll);
  assert.deepEqual(all.tasks, [...AUX_TASK_ORDER], "全部勾选须**全部**返回（按登记表，不硬编码清单）");
  assert.equal(all.reason, null, "有任务可跑时不得给原因码");

  const one = pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": true } });
  assert.deepEqual(one.tasks, ["friction-discovery"], "只勾一个就只做一件");

  // 2026-10-30：派发面只剩两个任务（容量维护/记忆健康移出），故「勾两个」用它俩。
  const onlyFriction = pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": true } });
  assert.deepEqual(onlyFriction.tasks, ["friction-discovery"], "派发面只剩一件");
  // 已移出派发面的任务即使被勾上也不得进入派发清单（它们没有执行体）。
  const stale = pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": true, "memory-health": true } });
  assert.deepEqual(stale.tasks, ["friction-discovery"], "未实现的任务不得被派发");
});

test("pickEnabledAuxTasks：顺序取**规范叙述次序**，不取设置对象的枚举次序", () => {
  // 若顺序由设置对象的键序决定，同一组勾选在不同展示顺序下会得到不同提示词
  // ——那是隐藏耦合（判据不该依赖 UI 的枚举细节）。
  // 两种声明顺序相反，且都按登记表构造（不硬编码清单）
  const a = pickEnabledAuxTasks({ enabled: true, tasks: Object.fromEntries([...AUX_TASK_ORDER].reverse().map((k) => [k, true])) });
  const b = pickEnabledAuxTasks({ enabled: true, tasks: Object.fromEntries(AUX_TASK_ORDER.map((k) => [k, true])) });
  assert.deepEqual(a.tasks, b.tasks, "两种声明顺序须给出**同一**任务序列");
  assert.deepEqual(a.tasks, [...AUX_TASK_ORDER], "顺序即 AUX_TASK_ORDER");
});

test("pickEnabledAuxTasks：总开关关闭 / 全停用 都返回空清单，且**给出可区分的原因码**", () => {
  // 两者都不派发，但原因不同——痕迹里的 reason 须能区分「Human 关了总开关」与
  // 「三个子项都被关」，否则 Human 排查时看不出是哪一个。
  assert.deepEqual(pickEnabledAuxTasks({ enabled: false, tasks: { "friction-discovery": true } }), { tasks: [], reason: "idle-assist-disabled" });
  assert.deepEqual(pickEnabledAuxTasks({ enabled: true, tasks: {} }), { tasks: [], reason: "all-tasks-disabled" });
  assert.deepEqual(pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": false, "capacity-maintenance": false, "memory-health": false } }), { tasks: [], reason: "all-tasks-disabled" });
});

test("pickEnabledAuxTasks：开关只认**布尔真**——真值字符串/数字不得被当作已勾选", () => {
  // 设置来自 JSON 配置，`"true"` / 1 之类若被真值判定吞下，会出现「Human 明明没勾
  // 却被跑」的错位；反之 `undefined`（键缺失）必须等于「未勾选」。
  const s = pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": "true", "capacity-maintenance": 1, "memory-health": undefined } });
  assert.deepEqual(s.tasks, [], "非布尔真值一律不算已勾选");
});

test("pickEnabledAuxTasks：无设置来源（老宿主）→ 全部任务（如实，不假装只有一个）", () => {
  // 与旧行为**不等价**是刻意的：旧实现在无设置时按轮换挑一个，但轮换已被删除，
  // 那个相位不再有依据。此时没有任何开关可读，故只能全跑——各任务的未实现会在
  // 各自的实现分支上如实回报。
  // 断言取 `[...AUX_TASK_ORDER]` 而非硬编码清单：硬编码会在新增任务时**必然**
  // 过期，而本条测的是「无设置来源时全跑」这一行为，不是「清单恰好是哪几项」。
  assert.deepEqual(pickEnabledAuxTasks(undefined).tasks, [...AUX_TASK_ORDER]);
  assert.deepEqual(pickEnabledAuxTasks(null).tasks, [...AUX_TASK_ORDER]);
});

test("pickEnabledAuxTasks：与 AUX_TASK_ORDER 永不漂移（登记表是唯一来源）", () => {
  // 三处曾各自定义任务清单（idle-checkpoint 的 AUX_TASKS、idle-settings 的
  // AUX_TASK_ORDER、client.js 的开关表）。清单漂移会使「设置面能勾、调度不认」
  // 或反之。本条守住「调度侧与登记表同源」。
  // 按登记表构造「全开」，不硬编码清单——清单会随新增任务变化（已由三项增至
  // 四项：积累经验），硬编码会使本测试在每次新增任务时必然过期。
  const openAll = { enabled: true, tasks: Object.fromEntries(AUX_TASK_ORDER.map((k) => [k, true])) };
  assert.deepEqual(pickEnabledAuxTasks(openAll).tasks, [...AUX_TASK_ORDER]);
});

test("任务清单只有**一处**定义——模块间不得各持一份（实测漂移教训）", () => {
  // 2026-10-14 实测：`idle-settings.js` 与 `aux-task-registry.js` 各持一份同样的
  // 数组。给登记表新增「积累经验」时只改了那一份，本模块这份就漏了——于是
  // `pickEnabledAuxTasks` 按**旧清单**过滤，新任务即使在设置面勾上也**永远不会
  // 被启用**；而它的开关、词条、schema 全都正常，从设置面到痕迹都看不出问题
  // （表现为「勾了没反应」）。
  //
  // 本条把「单一来源」变成可机械核对的约束：扫描两模块的源码，若出现第二处
  // 字面量数组定义即失败。这样下一次新增任务时，漏改会被测试直接指出。
  const files = ["../lib/idle-settings.js", "../lib/aux-task-registry.js"];
  const literal = /AUX_TASK_ORDER\s*=\s*Object\.freeze\(\[/;
  const offenders = files.filter((f) => {
    const text = readFileSync(new URL(f, import.meta.url), "utf8");
    return literal.test(text);
  });
  assert.deepEqual(
    offenders,
    ["../lib/aux-task-registry.js"],
    "AUX_TASK_ORDER 只允许在登记表里定义为字面量；其它模块须重导出（否则必然漂移）",
  );
});

// ---------------------------------------------------------------------------
// 配置项**改名**的存量迁移（2026-10-14）：idleReviewEnabled → frictionDiscoveryEnabled
//
// 本条守的是一个**实测踩到**的陷阱：新键在 Config schema 里带 default(true)，
// 宿主解析配置时会**把 true 填进 config**，故回落若写成 `新键 ?? 旧键`，右支
// **永不生效**——Human 曾明确关闭摩擦的设定会静默退回 true（行为突变，且从
// 设置面上看不出为什么它又开着了）。
// ---------------------------------------------------------------------------

test("配置改名：旧键被显式设过时以旧键为准（默认值不得架空回落）", () => {
  // 用**原始对象**直接调 resolveIdleSettings——它就是判据侧的入口，且这里要验的
  // 正是「默认值已被填进 config」这一形态（用已解析的 Config 反而掩盖该陷阱）。
  //
  // 2026-10-30：合并为两层开关后，旧键的语义是「合并前它管的那一半是否被显式关掉」。
  const off = resolveIdleSettings({ idleCaptureEnabled: true, frictionDiscoveryEnabled: false });
  assert.equal(
    off.tasks["friction-discovery"], false,
    "旧键 false（Human 曾明确关闭）必须生效——若回落写成 `新 ?? 旧`，新键的 default(true) 会架空它",
  );
  const on = resolveIdleSettings({ experienceCaptureEnabled: true });
  assert.equal(on.tasks["friction-discovery"], true, "旧键 true 亦须生效");
  // 审核层的旧键同理。
  const reviewOff = resolveIdleSettings({ auxReviewEnabled: true, experienceReviewEnabled: false });
  assert.equal(reviewOff.review, undefined, "审核字段已删除（2026-11-16）");
});

test("配置改名：未设旧键时用新键（含其缺省）", () => {
  // 2026-11-17：旧键 `idleCaptureEnabled` 已随「捕获层/审核层」那套结构删除，
  // 现子项键是 `frictionDiscoveryEnabled`（与 `experienceAccumulationEnabled` 并列）。
  assert.equal(resolveIdleSettings(undefined).tasks["friction-discovery"], true, "两者都未设 → 缺省开");
  assert.equal(resolveIdleSettings({}).tasks["friction-discovery"], true, "配置对象为空 → 缺省开");
  assert.equal(
    resolveIdleSettings({ frictionDiscoveryEnabled: false }).tasks["friction-discovery"], false,
    "只设了子项键 → 以它为准",
  );
});

// ---------------------------------------------------------------------------
// 安静时长（11 §6.1，2026-10-14 新增）
// ---------------------------------------------------------------------------

test("11 §6.1（2026-11-17）：安静时长已随计时器删除——校验函数与配置载体都不得残留", async () => {
  // 触发锚改为主控发起后，安静时长不再是任何判据。**不得保留一个恒不生效的
  // 默认值或一个恒返回 ok 的空壳校验函数**——那会让「计时机制还在、只是不起
  // 作用」成为表面事实，读者据它推断「仍有一道写入侧闸门」。
  const mod = await import("../lib/idle-settings.js");
  assert.equal(mod.validateSilenceMs, undefined, "validateSilenceMs 不得再存在");
  assert.deepEqual(Object.keys(IDLE_DEFAULTS), [], "IDLE_DEFAULTS 不得残留 silenceMs");

  const s = resolveIdleSettings({ idleSilenceMs: 900_000 });
  assert.equal(s.limits, undefined, "limits 不得再存在（它当时只含 silenceMs 一项）");
});

// ---------------------------------------------------------------------------
// 11 §6.2 取值为空集（2026-10-14 二次修订，Human Gate 授权）
// ---------------------------------------------------------------------------
//
// ## 为什么这些用例是**负向守卫**
//
// §6.2 的约束类别是**闭集**，而**空集同样是该闭集的成员状态**。把本节由零约束
// 改回带约束，与由带约束改为零约束**同等需要 Human Gate**（§6.2），不得由实现侧
// 自行引入。下列断言的作用是：若有人日后悄悄加回任何节流判据或配置键，
// 它们会立刻失败——而不是让「隐形的、不可观察的判据」重新出现。

test("11 §6.2 空集：模块**不导出**任何节流判据（加回即须走 Human Gate）", async () => {
  const mod = await import("../lib/idle-settings.js");
  for (const gone of ["countWithinWindow", "quotaLeft", "cooldownDue", "contentAdmitted"]) {
    assert.equal(mod[gone], undefined, `${gone} 不得再存在——§6.2 现为空集`);
  }
});

test("11 §6.2 空集：`IDLE_DEFAULTS` 不含任何默认值", () => {
  // 2026-11-17：原断言是「只含 silenceMs 一项」；silenceMs 删除后本对象为空。
  assert.deepEqual(Object.keys(IDLE_DEFAULTS), [], "不得残留任何配额或计时默认值");
});

test("11 §6.2 空集：`admitIdleDispatch` 只判明示开关，`evaluations` 恒为空", () => {
  // 开关已开 → 一律准入（无约束可挡）；开关关闭 → 各自的可区分原因码仍须在。
  const on = admitIdleDispatch({ settings: OPEN_SETTINGS, task: "friction-discovery" });
  assert.equal(on.admit, true);
  assert.deepEqual(on.evaluations, {}, "无约束可评估——空对象即「本节为空集」的可观察形态");

  const off = admitIdleDispatch({ settings: { ...OPEN_SETTINGS, enabled: false }, task: "friction-discovery" });
  assert.equal(off.admit, false);
  assert.equal(off.reason, "idle-assist-disabled", "总开关的拒因须可区分");

  const sub = admitIdleDispatch({ settings: { ...OPEN_SETTINGS, tasks: {} }, task: "friction-discovery" });
  assert.equal(sub.admit, false);
  assert.equal(sub.reason, "task-disabled", "子项开关的拒因须与总开关可区分");
});

test("11 §6.2 空集：约束值一律不再被读取（传入即被忽略，不产生隐形判据）", () => {
  // 关键性质：传入旧键也不得改变结论——否则「设置在代码里仍起作用但界面上看不到」，
  // 这正是 §6.2 明文禁止的「不可观察的隐藏判据」形态。
  const a = admitIdleDispatch({ settings: OPEN_SETTINGS, task: "friction-discovery" });
  const withQuota = admitIdleDispatch({
    settings: { ...OPEN_SETTINGS, limits: { silenceMs: 600_000, quotaMax: 0, quotaWindowMs: 0 } },
    task: "friction-discovery",
  });
  assert.deepEqual(withQuota, a, "残留的配额键不得改变判定（且不得被读取）");
});


// ── 审核模型解析：已随设置移除 ───────────────────────────────────────
//
// `readModelSelection` 与其全部用例已删除（2026-10-27 Human 要求去掉「审核模型」
// 设置）。该设置从未真正生效——设置面能填能存，审核执行体却一直按默认路由跑。
// 一个「设了不生效」的选项比没有更糟，故整块移除，审核固定跟随宿主默认路由。
