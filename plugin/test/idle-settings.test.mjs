// Tests for plugin/lib/idle-settings.js —
// 闲时辅助的设置解析与节流判据（全部纯函数，不读时钟、不碰文件）。
//
// 为什么这层要单测：判据决定「跑不跑」，而它一旦错了有两种代价相反的后果——
// 过松（每次检查点都 fork 一个继承全上下文的子代理，实测发生过：13 次运行挤在
// 43 分钟内、最短间隔 29 秒）与过紧（真实摩擦永不被观察）。故每条判据都要
// 有**两侧**断言：该放行的放行、该拦的拦住。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IDLE_DEFAULTS,
  admitIdleDispatch,
  contentAdmitted,
  cooldownDue,
  quotaLeft,
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

test("resolveIdleSettings：无配置时给出默认值（总开关与已实现子项为开）", () => {
  const s = resolveIdleSettings(undefined);
  assert.equal(s.enabled, true, "总开关缺省开——机制现状是常开，缺省关会是行为突变");
  assert.equal(s.tasks["idle-review"], true, "已实现的子项缺省开（与现状一致）");
  assert.equal(s.tasks["capacity-maintenance"], false, "未实现子项缺省关");
  assert.equal(s.tasks["memory-health"], false, "未实现子项缺省关");
  assert.deepEqual(s.limits, IDLE_DEFAULTS, "参数回落默认值");
});

test("resolveIdleSettings：显式配置覆盖默认，且三个子项各自独立", () => {
  const s = resolveIdleSettings({
    idleAssistEnabled: false,
    idleReviewEnabled: false,
    capacityMaintenanceEnabled: true,
    memoryHealthEnabled: false,
    idleMinIntervalMs: 60_000,
    idleMinContentChars: 100,
    idleMinContentTurns: 1,
    idleMaxPerSession: 3,
  });
  assert.equal(s.enabled, false);
  assert.equal(s.tasks["idle-review"], false);
  assert.equal(s.tasks["capacity-maintenance"], true);
  assert.equal(s.tasks["memory-health"], false);
  assert.deepEqual(s.limits, {
    minIntervalMs: 60_000,
    minContentChars: 100,
    minContentTurns: 1,
    maxPerSession: 3,
  });
});

// ---------------------------------------------------------------------------
// cooldownDue
// ---------------------------------------------------------------------------

test("cooldownDue：从未派发过 → 立即可跑（首次不冷却）", () => {
  // 这条是必须的：否则新会话要等满一个冷却窗口才可能首次产出。
  assert.equal(cooldownDue(1_000_000, null, 600_000), true);
  assert.equal(cooldownDue(1_000_000, undefined, 600_000), true);
});

test("cooldownDue：两侧边界——差 1 毫秒拦、正好满放", () => {
  const now = 10_000_000;
  const interval = 600_000;
  assert.equal(cooldownDue(now, now - interval + 1, interval), false, "差 1 毫秒须拦");
  assert.equal(cooldownDue(now, now - interval, interval), true, "正好满须放行");
  assert.equal(cooldownDue(now, now - interval - 1, interval), true, "超过更须放行");
});

test("cooldownDue：间隔为 0 或非法 → 不冷却（0 的语义是「关掉节流」）", () => {
  const now = 10_000_000;
  assert.equal(cooldownDue(now, now, 0), true, "间隔 0 = 不冷却");
  assert.equal(cooldownDue(now, now, -5), true, "负数同样视为不限");
  assert.equal(cooldownDue(now, now, NaN), true, "非法间隔视为不限");
});

test("cooldownDue：now 非法 → 拒绝（不得因时钟异常而无界派发）", () => {
  assert.equal(cooldownDue(NaN, null, 600_000), false);
  assert.equal(cooldownDue(undefined, null, 600_000), false);
});

// ---------------------------------------------------------------------------
// contentAdmitted
// ---------------------------------------------------------------------------

test("contentAdmitted：字符数与轮数**取或**——任一达标即准入", () => {
  const limits = { minContentChars: 800, minContentTurns: 3 };
  // 只满足字符数（一段长文但只有 1 轮）。
  assert.equal(contentAdmitted({ chars: 800, turns: 1 }, limits), true, "字数达标即可");
  // 只满足轮数（多轮寒暄，字数很少）。
  assert.equal(contentAdmitted({ chars: 10, turns: 3 }, limits), true, "轮数达标即可");
  // 两者都不满足。
  assert.equal(contentAdmitted({ chars: 799, turns: 2 }, limits), false, "两者皆不满足须拦");
});

test("contentAdmitted：首次运行**无条件准入**（否则历史摩擦永不被发现）", () => {
  // 水位为 null 表示有全部历史内容待观察；此时若因区间短而拒跑，历史摩擦
  // 就永远不会被发现。这是正确性要求，不是优化。
  const limits = { minContentChars: 800, minContentTurns: 3 };
  assert.equal(contentAdmitted({ chars: 0, turns: 0 }, limits, { isFirstRun: true }), true);
  assert.equal(contentAdmitted({ chars: 1, turns: 1 }, limits, { isFirstRun: true }), true);
  // 对照：非首次同样输入须被拦（证明上面那条确实是 isFirstRun 起的作用）。
  assert.equal(contentAdmitted({ chars: 1, turns: 1 }, limits, { isFirstRun: false }), false);
});

test("contentAdmitted：材料规模非法或门槛非法 → 一律拒绝（fail-closed）", () => {
  const limits = { minContentChars: 800, minContentTurns: 3 };
  assert.equal(contentAdmitted(undefined, limits), false, "无材料规模");
  assert.equal(contentAdmitted({ chars: NaN, turns: 3 }, limits), false, "chars 非法");
  assert.equal(contentAdmitted({ chars: 800, turns: undefined }, limits), false, "turns 非法");
  // 门槛自身非法时宁可少跑——不得因配置错误而无界派发。
  assert.equal(contentAdmitted({ chars: 999_999, turns: 999 }, { minContentChars: NaN, minContentTurns: NaN }), false);
  assert.equal(contentAdmitted({ chars: 999_999, turns: 999 }, { minContentChars: -1, minContentTurns: -1 }), false);
  // 门槛为 0 是合法值（任何材料都准入）。
  assert.equal(contentAdmitted({ chars: 0, turns: 0 }, { minContentChars: 0, minContentTurns: 0 }), true);
});

// ---------------------------------------------------------------------------
// quotaLeft
// ---------------------------------------------------------------------------

test("quotaLeft：0 与负数表示**不限**（不是「一次也不许」）", () => {
  // 参照 mnemon 的 maxPerSession 允许 0、auto-memory 明写「0=不冷却 是合法值」。
  assert.equal(quotaLeft(99, 0), Infinity, "0 = 不限");
  assert.equal(quotaLeft(99, -1), Infinity, "负数 = 不限");
  assert.equal(quotaLeft(99, NaN), Infinity, "非法 = 不限");
});

test("quotaLeft：正常配额递减，用尽为 0（不为负）", () => {
  assert.equal(quotaLeft(0, 8), 8);
  assert.equal(quotaLeft(3, 8), 5);
  assert.equal(quotaLeft(8, 8), 0, "用尽为 0");
  assert.equal(quotaLeft(99, 8), 0, "超出不为负");
  // 已派发数非法时按 0 计（不得因计数损坏而拒绝服务）。
  assert.equal(quotaLeft(NaN, 8), 8);
  assert.equal(quotaLeft(-5, 8), 8);
});

// ---------------------------------------------------------------------------
// admitIdleDispatch：合成判据
// ---------------------------------------------------------------------------

const OPEN_SETTINGS = {
  enabled: true,
  tasks: { "idle-review": true, "capacity-maintenance": false, "memory-health": false },
  limits: { minIntervalMs: 600_000, minContentChars: 800, minContentTurns: 3, maxPerSession: 8 },
};

test("admitIdleDispatch：全部满足即准入", () => {
  const r = admitIdleDispatch({
    settings: OPEN_SETTINGS,
    task: "idle-review",
    now: 10_000_000,
    lastDispatchAt: null,
    dispatched: 0,
    material: { chars: 1000, turns: 5 },
  });
  assert.deepEqual(r, { admit: true, reason: "admitted" });
});

test("admitIdleDispatch：**判据顺序**——Human 的明示配置先于机械节流", () => {
  // 顺序即理由：总开关与子项开关一旦关闭，就不该再算其余，也不该因「条件不足」
  // 而记任何账。故此处让所有机械条件都满足，唯独关掉开关，理由须是开关而非节流。
  const closedAssist = { ...OPEN_SETTINGS, enabled: false };
  const r1 = admitIdleDispatch({
    settings: closedAssist, task: "idle-review", now: 1, lastDispatchAt: null, dispatched: 0,
    material: { chars: 99999, turns: 99 },
  });
  assert.equal(r1.reason, "idle-assist-disabled", "总开关优先");

  const taskOff = { ...OPEN_SETTINGS, tasks: { ...OPEN_SETTINGS.tasks, "idle-review": false } };
  const r2 = admitIdleDispatch({
    settings: taskOff, task: "idle-review", now: 1, lastDispatchAt: null, dispatched: 0,
    material: { chars: 99999, turns: 99 },
  });
  assert.equal(r2.reason, "task-disabled", "子项开关次之");
});

test("admitIdleDispatch：未实现的子项即使被打开，也走各自任务名（不冒充 idle-review）", () => {
  // capacity-maintenance 的实现状态是 not-implemented，但判据层不该知道这件事——
  // 它只回答「这个任务此刻准不准跑」。真实实现状态由 runIdleCheckpoint 如实回报。
  const withCapacity = { ...OPEN_SETTINGS, tasks: { ...OPEN_SETTINGS.tasks, "capacity-maintenance": true } };
  const r = admitIdleDispatch({
    settings: withCapacity, task: "capacity-maintenance", now: 1, lastDispatchAt: null, dispatched: 0,
    material: { chars: 99999, turns: 99 },
  });
  assert.equal(r.admit, true, "开关打开即准入（实现状态不在本层判断）");
  // 未打开时须拦。
  assert.equal(
    admitIdleDispatch({
      settings: OPEN_SETTINGS, task: "capacity-maintenance", now: 1, lastDispatchAt: null, dispatched: 0,
      material: { chars: 99999, turns: 99 },
    }).reason,
    "task-disabled",
  );
});

test("admitIdleDispatch：三道机械闸各自的拒因可区分（痕迹里看得出是被节流还是坏了）", () => {
  const now = 10_000_000;
  const base = { settings: OPEN_SETTINGS, task: "idle-review", now, material: { chars: 99999, turns: 99 }, dispatched: 0 };
  assert.equal(admitIdleDispatch({ ...base, lastDispatchAt: now - 1000 }).reason, "cooldown");
  assert.equal(
    admitIdleDispatch({ ...base, lastDispatchAt: null, material: { chars: 10, turns: 1 } }).reason,
    "insufficient-content",
  );
  assert.equal(admitIdleDispatch({ ...base, lastDispatchAt: null, dispatched: 8 }).reason, "quota-exhausted");
});

test("admitIdleDispatch：首运在「刚派发过」之外仍受冷却约束（冷却与首运是两件事）", () => {
  // isFirstRun 只解除**内容量**门槛（历史内容必须能被观察），不解除冷却——
  // 冷却管的是「刚才是不是刚跑过」，与「材料是不是首次」无关。
  const r = admitIdleDispatch({
    settings: OPEN_SETTINGS, task: "idle-review", now: 10_000_000,
    lastDispatchAt: 9_999_000, dispatched: 0,
    material: { chars: 0, turns: 0 }, isFirstRun: true,
  });
  assert.equal(r.reason, "cooldown", "首运不解冷却");
});

test("admitIdleDispatch：isFirstRun 解除内容量门槛（历史摩擦不得因区间短而被漏掉）", () => {
  const r = admitIdleDispatch({
    settings: OPEN_SETTINGS, task: "idle-review", now: 10_000_000,
    lastDispatchAt: null, dispatched: 0,
    material: { chars: 0, turns: 0 }, isFirstRun: true,
  });
  assert.equal(r.admit, true, "首运即使材料为空也准入（那正是「覆盖全部既有内容」）");
});
