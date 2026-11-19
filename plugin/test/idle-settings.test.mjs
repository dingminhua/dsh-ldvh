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


test("readNumber：volatile 引用与裸值两种形态都认（0.1.7 前后通吃）", () => {
  assert.equal(readNumber(42, 7), 42, "裸数值");
  assert.equal(readNumber({ get: () => 42 }, 7), 42, "volatile { get() }");
  assert.equal(readNumber(undefined, 7), 7, "undefined 回落");
  assert.equal(readNumber(null, 7), 7, "null 回落");
  assert.equal(readNumber({}, 7), 7, "无 get 的对象回落");
  assert.equal(readNumber("abc", 7), 7, "非数值回落");
  assert.equal(readNumber(-1, 7), 7, "负数回落（负冷却会让每次检查点都跑）");
  assert.equal(readNumber(Infinity, 7), 7, "Infinity 回落");
});

test("readNumber：**0 是合法值**，不得被回落吃掉", () => {
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


test("resolveIdleSettings：无配置时给出默认值（总开关与两个子项均为开）", () => {
  const s = resolveIdleSettings(undefined);
  assert.equal(s.enabled, true, "总开关缺省开——机制现状是常开，缺省关会是行为突变");
  assert.equal(s.tasks["experience-accumulation"], true, "积累经验缺省开");
  assert.equal(s.tasks["friction-discovery"], true, "发现摩擦缺省开");
  assert.equal(s.limits, undefined, "limits 已删除（原只含 silenceMs）");
});

test("resolveIdleSettings：显式配置覆盖默认；两个子项可各自停用", () => {
  const onlyExperience = resolveIdleSettings({
    proxyAssistEnabled: true,
    experienceAccumulationEnabled: true,
    idleCaptureEnabled: false,
  });
  assert.equal(onlyExperience.enabled, true);
  assert.equal(onlyExperience.tasks["experience-accumulation"], true);
  assert.equal(onlyExperience.tasks["friction-discovery"], false, "摩擦发现被单独停用");

  const neither = resolveIdleSettings({
    proxyAssistEnabled: false,
    experienceAccumulationEnabled: true,
    idleCaptureEnabled: true,
  });
  assert.equal(neither.enabled, false, "总开关关闭");
  assert.equal(neither.tasks["friction-discovery"], true);
});

test("发现摩擦开关：设置面现役键 idleCaptureEnabled 生效，旧键显式值仍优先", () => {
  const byCurrentKey = resolveIdleSettings({ idleCaptureEnabled: false });
  assert.equal(byCurrentKey.tasks["friction-discovery"], false, "设置面现役键关闭须生效");
  const legacyWins = resolveIdleSettings({ idleCaptureEnabled: true, frictionDiscoveryEnabled: false });
  assert.equal(legacyWins.tasks["friction-discovery"], false, "旧键显式 false 不被新键 default 架空");
  const legacyOnly = resolveIdleSettings({ frictionDiscoveryEnabled: true });
  assert.equal(legacyOnly.tasks["friction-discovery"], true, "仅旧键时按其回落");
});

test("配置面迁移：旧键 idleAssistEnabled 仍被识别为总开关（存量配置不静默失效）", () => {
  const legacyOff = resolveIdleSettings({ idleAssistEnabled: false });
  assert.equal(legacyOff.enabled, false, "旧键的关闭值必须仍然生效");

  const both = resolveIdleSettings({ idleAssistEnabled: false, proxyAssistEnabled: true });
  assert.equal(both.enabled, true, "新键优先");
});



const OPEN_SETTINGS = {
  enabled: true,
  tasks: { "experience-accumulation": true, "friction-discovery": true },
};

test("admitIdleDispatch：开关已开即准入——**§6.2 现无约束可评估**", () => {
  const r = admitIdleDispatch({ settings: OPEN_SETTINGS, task: "friction-discovery" });
  assert.equal(r.admit, true);
  assert.equal(r.reason, "admitted");
  assert.deepEqual(r.evaluations, {}, "§6.2 现为空集 → 无约束可评估");
});

test("admitIdleDispatch：**判据顺序**——Human 的明示配置先于机械节流", () => {
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
  const withCapacity = { ...OPEN_SETTINGS, tasks: { ...OPEN_SETTINGS.tasks, "capacity-maintenance": true } };
  const r = admitIdleDispatch({
    settings: withCapacity, task: "capacity-maintenance", now: 1, lastDispatchAt: null, dispatched: 0,
  });
  assert.equal(r.admit, true, "开关打开即准入（实现状态不在本层判断）");
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














test("pickEnabledAuxTasks：**勾选几个就跑几件**——不是挑一个（本条守卫本次改案本身）", () => {
  const openAll = { enabled: true, tasks: Object.fromEntries(AUX_TASK_ORDER.map((k) => [k, true])) };
  const all = pickEnabledAuxTasks(openAll);
  assert.deepEqual(all.tasks, [...AUX_TASK_ORDER], "全部勾选须**全部**返回（按登记表，不硬编码清单）");
  assert.equal(all.reason, null, "有任务可跑时不得给原因码");

  const one = pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": true } });
  assert.deepEqual(one.tasks, ["friction-discovery"], "只勾一个就只做一件");

  const onlyFriction = pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": true } });
  assert.deepEqual(onlyFriction.tasks, ["friction-discovery"], "派发面只剩一件");
  const stale = pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": true, "memory-health": true } });
  assert.deepEqual(stale.tasks, ["friction-discovery"], "未实现的任务不得被派发");
});

test("pickEnabledAuxTasks：顺序取**规范叙述次序**，不取设置对象的枚举次序", () => {
  const a = pickEnabledAuxTasks({ enabled: true, tasks: Object.fromEntries([...AUX_TASK_ORDER].reverse().map((k) => [k, true])) });
  const b = pickEnabledAuxTasks({ enabled: true, tasks: Object.fromEntries(AUX_TASK_ORDER.map((k) => [k, true])) });
  assert.deepEqual(a.tasks, b.tasks, "两种声明顺序须给出**同一**任务序列");
  assert.deepEqual(a.tasks, [...AUX_TASK_ORDER], "顺序即 AUX_TASK_ORDER");
});

test("pickEnabledAuxTasks：总开关关闭 / 全停用 都返回空清单，且**给出可区分的原因码**", () => {
  assert.deepEqual(pickEnabledAuxTasks({ enabled: false, tasks: { "friction-discovery": true } }), { tasks: [], reason: "idle-assist-disabled" });
  assert.deepEqual(pickEnabledAuxTasks({ enabled: true, tasks: {} }), { tasks: [], reason: "all-tasks-disabled" });
  assert.deepEqual(pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": false, "capacity-maintenance": false, "memory-health": false } }), { tasks: [], reason: "all-tasks-disabled" });
});

test("pickEnabledAuxTasks：开关只认**布尔真**——真值字符串/数字不得被当作已勾选", () => {
  const s = pickEnabledAuxTasks({ enabled: true, tasks: { "friction-discovery": "true", "capacity-maintenance": 1, "memory-health": undefined } });
  assert.deepEqual(s.tasks, [], "非布尔真值一律不算已勾选");
});

test("pickEnabledAuxTasks：无设置来源（老宿主）→ 全部任务（如实，不假装只有一个）", () => {
  assert.deepEqual(pickEnabledAuxTasks(undefined).tasks, [...AUX_TASK_ORDER]);
  assert.deepEqual(pickEnabledAuxTasks(null).tasks, [...AUX_TASK_ORDER]);
});

test("pickEnabledAuxTasks：与 AUX_TASK_ORDER 永不漂移（登记表是唯一来源）", () => {
  const openAll = { enabled: true, tasks: Object.fromEntries(AUX_TASK_ORDER.map((k) => [k, true])) };
  assert.deepEqual(pickEnabledAuxTasks(openAll).tasks, [...AUX_TASK_ORDER]);
});

test("任务清单只有**一处**定义——模块间不得各持一份（实测漂移教训）", () => {
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


test("配置改名：旧键被显式设过时以旧键为准（默认值不得架空回落）", () => {
  const off = resolveIdleSettings({ idleCaptureEnabled: true, frictionDiscoveryEnabled: false });
  assert.equal(
    off.tasks["friction-discovery"], false,
    "旧键 false（Human 曾明确关闭）必须生效——若回落写成 `新 ?? 旧`，新键的 default(true) 会架空它",
  );
  const on = resolveIdleSettings({ experienceCaptureEnabled: true });
  assert.equal(on.tasks["friction-discovery"], true, "旧键 true 亦须生效");
  const reviewOff = resolveIdleSettings({ auxReviewEnabled: true, experienceReviewEnabled: false });
  assert.equal(reviewOff.review, undefined, "审核字段已删除（2026-11-16）");
});

test("配置改名：未设旧键时用新键（含其缺省）", () => {
  assert.equal(resolveIdleSettings(undefined).tasks["friction-discovery"], true, "两者都未设 → 缺省开");
  assert.equal(resolveIdleSettings({}).tasks["friction-discovery"], true, "配置对象为空 → 缺省开");
  assert.equal(
    resolveIdleSettings({ frictionDiscoveryEnabled: false }).tasks["friction-discovery"], false,
    "只设了子项键 → 以它为准",
  );
});


test("36 §7.6（2026-11-17）：安静时长已随计时器删除——校验函数与配置载体都不得残留", async () => {
  const mod = await import("../lib/idle-settings.js");
  assert.equal(mod.validateSilenceMs, undefined, "validateSilenceMs 不得再存在");
  assert.deepEqual(Object.keys(IDLE_DEFAULTS), [], "IDLE_DEFAULTS 不得残留 silenceMs");

  const s = resolveIdleSettings({ idleSilenceMs: 900_000 });
  assert.equal(s.limits, undefined, "limits 不得再存在（它当时只含 silenceMs 一项）");
});


test("36 §7.6 空集：模块**不导出**任何节流判据（加回即须走 Human Gate）", async () => {
  const mod = await import("../lib/idle-settings.js");
  for (const gone of ["countWithinWindow", "quotaLeft", "cooldownDue", "contentAdmitted"]) {
    assert.equal(mod[gone], undefined, `${gone} 不得再存在——§6.2 现为空集`);
  }
});

test("36 §7.6 空集：`IDLE_DEFAULTS` 不含任何默认值", () => {
  assert.deepEqual(Object.keys(IDLE_DEFAULTS), [], "不得残留任何配额或计时默认值");
});

test("36 §7.6 空集：`admitIdleDispatch` 只判明示开关，`evaluations` 恒为空", () => {
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

test("36 §7.6 空集：约束值一律不再被读取（传入即被忽略，不产生隐形判据）", () => {
  const a = admitIdleDispatch({ settings: OPEN_SETTINGS, task: "friction-discovery" });
  const withQuota = admitIdleDispatch({
    settings: { ...OPEN_SETTINGS, limits: { silenceMs: 600_000, quotaMax: 0, quotaWindowMs: 0 } },
    task: "friction-discovery",
  });
  assert.deepEqual(withQuota, a, "残留的配额键不得改变判定（且不得被读取）");
});


