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
  validateSilenceMs,
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

test("resolveIdleSettings：无配置时给出默认值（总开关与已实现子项为开）", () => {
  const s = resolveIdleSettings(undefined);
  assert.equal(s.enabled, true, "总开关缺省开——机制现状是常开，缺省关会是行为突变");
  assert.equal(s.tasks["friction-discovery"], true, "已实现的子项缺省开（与现状一致）");
  assert.equal(s.tasks["capacity-maintenance"], false, "未实现子项缺省关");
  assert.equal(s.tasks["memory-health"], false, "未实现子项缺省关");
  assert.deepEqual(s.limits, IDLE_DEFAULTS, "参数回落默认值");
});

test("resolveIdleSettings：显式配置覆盖默认，且三个子项各自独立", () => {
  const s = resolveIdleSettings({
    idleAssistEnabled: false,
    frictionDiscoveryEnabled: false,
    capacityMaintenanceEnabled: true,
    memoryHealthEnabled: false,
    idleSilenceMs: 900_000,
  });
  assert.equal(s.enabled, false);
  assert.equal(s.tasks["friction-discovery"], false);
  assert.equal(s.tasks["capacity-maintenance"], true);
  assert.equal(s.tasks["memory-health"], false);
  // 2026-10-14 二次修订：limits 现只含安静时长一项——配额两键随 §6.2 收为空集而删除。
  assert.deepEqual(s.limits, { silenceMs: 900_000 });
});


// ---------------------------------------------------------------------------
// admitIdleDispatch：合成判据
// ---------------------------------------------------------------------------

const OPEN_SETTINGS = {
  enabled: true,
  tasks: { "friction-discovery": true, "capacity-maintenance": false, "memory-health": false },
  limits: { quotaMax: 8 },
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

  const two = pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": true, "memory-health": true } });
  assert.deepEqual(two.tasks, ["friction-discovery", "memory-health"], "勾两个就做两件");
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
  const off = resolveIdleSettings({ frictionDiscoveryEnabled: true, idleReviewEnabled: false });
  assert.equal(
    off.tasks["friction-discovery"], false,
    "旧键 false（Human 曾明确关闭）必须生效——若回落写成 `新 ?? 旧`，新键的 default(true) 会架空它",
  );
  const on = resolveIdleSettings({ idleReviewEnabled: true });
  assert.equal(on.tasks["friction-discovery"], true, "旧键 true 亦须生效");
});

test("配置改名：未设旧键时用新键（含其缺省）", () => {
  assert.equal(resolveIdleSettings(undefined).tasks["friction-discovery"], true, "两者都未设 → 缺省开");
  assert.equal(resolveIdleSettings({}).tasks["friction-discovery"], true, "配置对象为空 → 缺省开");
  assert.equal(
    resolveIdleSettings({ frictionDiscoveryEnabled: false }).tasks["friction-discovery"], false,
    "只设了新键 → 以新键为准",
  );
});

// ---------------------------------------------------------------------------
// 安静时长（11 §6.1，2026-10-14 新增）
// ---------------------------------------------------------------------------

test("11 §6.1：安静时长须为**有限正值**——0/负数/非数一律拒绝（不得静默回落）", () => {
  // 规范明文：该取值「须为有限正值……须在写入时被拒绝并提示，使误设当场可见」。
  // 取 0 会使「已空闲」恒成立（等价于取消该判据），故必须拒绝而不是回落。
  assert.equal(validateSilenceMs(600_000).ok, true, "10 分钟合法");
  assert.equal(validateSilenceMs(1).ok, true, "1 毫秒合法（下界是「> 0」而非某个经验值）");

  for (const bad of [0, -1, -600_000]) {
    const r = validateSilenceMs(bad);
    assert.equal(r.ok, false, `${bad} 须被拒绝`);
    assert.equal(r.reason, "not-positive");
  }
  for (const bad of [NaN, Infinity, -Infinity, "abc", null, undefined, {}]) {
    const r = validateSilenceMs(bad);
    assert.equal(r.ok, false, `${String(bad)} 须被拒绝`);
  }
  const frac = validateSilenceMs(1.5);
  assert.equal(frac.ok, false, "非整数须被拒绝");
  assert.equal(frac.reason, "not-an-integer");
});


test("11 §6.1：读取侧对非法安静时长回落默认（容忍存量脏数据）", () => {
  // 写入侧拒绝、读取侧回落——两者分工不同：前者防新误设，后者使既有脏配置
  // 不至于让机制失效。
  const s = resolveIdleSettings({ idleSilenceMs: 0 });
  assert.equal(s.limits.silenceMs, IDLE_DEFAULTS.silenceMs, "0 → 回落默认");
  const s2 = resolveIdleSettings({ idleSilenceMs: -5 });
  assert.equal(s2.limits.silenceMs, IDLE_DEFAULTS.silenceMs, "负数 → 回落默认");
  const s3 = resolveIdleSettings({ idleSilenceMs: 900_000 });
  assert.equal(s3.limits.silenceMs, 900_000, "合法值原样保留");
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

test("11 §6.2 空集：`IDLE_DEFAULTS` 只含安静时长一项", () => {
  assert.deepEqual(Object.keys(IDLE_DEFAULTS), ["silenceMs"], "不得残留任何配额默认值");
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
