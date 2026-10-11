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
  countWithinWindow,
  pickEnabledAuxTask,
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
    // 窗口长度未显式配置 → 回落默认（配额按滑动窗口计，见 F2）。
    quotaWindowMs: IDLE_DEFAULTS.quotaWindowMs,
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
  assert.equal(r.admit, true);
  assert.equal(r.reason, "admitted");
  // 三类约束各自的评估须随返回值给出（04 §8.4「派发准入」段的「各自可被独立
  // 观察」要求；复审 D2/D7）——放行时也须有，否则「生效但未触发」不可观察。
  assert.equal(r.evaluations.cooldown.ok, true);
  assert.equal(r.evaluations.content.ok, true);
  assert.equal(r.evaluations.quota.ok, true);
  assert.equal(r.evaluations.quota.max, 8);
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
// 故 04 §8.4「派发准入」段规定：累计须以**可恢复**的口径计数，不得以会话生命
// 周期为口径。

test("countWithinWindow：只计窗口内的次数（窗口外的不算）", () => {
  const now = 10_000_000;
  const HOUR = 3_600_000;
  const times = [
    now - 10_000,            // 窗内
    now - 1_000_000,         // 窗内
    now - 2 * HOUR,          // 窗外
    now - 5 * HOUR,          // 窗外
  ].map((n) => new Date(n).toISOString());
  assert.equal(countWithinWindow(times, now, HOUR), 2, "只计窗内的两次");
});

test("countWithinWindow：**窗口滑过后容量恢复**（这是 F2 修复的核心性质）", () => {
  const now = 10_000_000;
  const HOUR = 3_600_000;
  // 全部落在窗外 → 计 0（容量已恢复）。
  const stale = Array.from({ length: 8 }, (_, i) => new Date(now - 2 * HOUR - i * 60_000).toISOString());
  assert.equal(countWithinWindow(stale, now, HOUR), 0, "窗外的 8 次都不计入 → 容量恢复");
});

test("countWithinWindow：边界按「对外机制有利」取——恰好落在窗口下界计在内", () => {
  const now = 10_000_000;
  const HOUR = 3_600_000;
  // 与 cooldownDue 的「正好满即放行」同一取向：避免差 1 毫秒的抖动使容量
  // 时而恢复时而不恢复。
  assert.equal(countWithinWindow([new Date(now - HOUR).toISOString()], now, HOUR), 1, "恰好在下界 → 计内");
  assert.equal(countWithinWindow([new Date(now - HOUR - 1).toISOString()], now, HOUR), 0, "差 1 毫秒 → 计外");
});

test("countWithinWindow：窗口为 0 或非法 → 退化为「全部计入」（须显式选择）", () => {
  // 该口径按 04 §8.4「派发准入」段属「会使派发永久终止」的取值，故默认不采用；
  // 但它必须仍可表达（用户显式配置 0 时要尊重其选择，不得被静默替换）。
  const now = 10_000_000;
  const all = [new Date(now).toISOString(), new Date(now - 9e9).toISOString()];
  assert.equal(countWithinWindow(all, now, 0), 2, "0 = 不限窗口");
  assert.equal(countWithinWindow(all, now, -1), 2, "负数同样视为不限");
  assert.equal(countWithinWindow(all, now, NaN), 2, "非法同样视为不限");
});

test("countWithinWindow：非法输入一律安全（不得抛错，也不得误放行）", () => {
  const now = 10_000_000;
  assert.equal(countWithinWindow(undefined, now, 1000), 0, "非数组 → 0");
  assert.equal(countWithinWindow([], now, 1000), 0, "空数组 → 0");
  assert.equal(countWithinWindow(["not-a-date"], now, 1000), 0, "无法解析的时刻被丢弃");
  assert.equal(countWithinWindow([now], NaN, 1000), 0, "now 非法 → 0（宁可拦下也不误放行）");
});

test("admitIdleDispatch：**窗口滑过后配额不再永久拦下**（F2 的端到端断言）", () => {
  const now = 10_000_000;
  const HOUR = 3_600_000;
  const CAP = 4;
  const settings = {
    enabled: true,
    tasks: { "idle-review": true },
    limits: { minIntervalMs: 600_000, minContentChars: 800, minContentTurns: 3, maxPerSession: CAP, quotaWindowMs: HOUR },
  };
  const base = { settings, task: "idle-review", now, material: { chars: 99999, turns: 99 } };

  // 让 anchor 落在**冷却窗口之外**（20 分钟前 > 600 秒），使本测试验的确实是
  // **配额**而非冷却。判据顺序是「冷却 → 内容量 → 配额」——若 anchor 太近，
  // 先撞冷却，本测试就会以错误的理由通过（或失败）。
  const anchor = new Date(now - 20 * 60_000).toISOString();

  // 窗内已满 → 拦下（这是配额该起的作用）。
  const recent = Array.from({ length: CAP }, (_, i) => new Date(now - i * 60_000).toISOString());
  assert.equal(
    admitIdleDispatch({ ...base, lastDispatchAt: anchor, dispatchTimes: recent }).reason,
    "quota-exhausted",
    `窗内满 ${CAP} 次须拦下（且理由须是配额，不是冷却）`,
  );

  // 同样满额、但都在窗外 → **必须放行**。旧口径（会话累计）在这里会永久拦下，
  // 使该会话剩余内容永不入账且无痕迹——这正是 F2。
  const stale = Array.from({ length: CAP }, (_, i) => new Date(now - 2 * HOUR - i * 60_000).toISOString());
  assert.equal(
    admitIdleDispatch({ ...base, lastDispatchAt: anchor, dispatchTimes: stale }).admit,
    true,
    "窗口滑过后须恢复容量——否则构成永久抑制",
  );
});

test("admitIdleDispatch：无时刻列表时退回累计口径（兼容路径，且仍**不得**被当成默认）", () => {
  // 兼容旧载体/旧调用方。该口径按 04 §8.4 属「会使派发永久终止」的取值，故
  // 这里是**降级**而非默认；调用方应尽量给时刻列表。
  const settings = {
    enabled: true,
    tasks: { "idle-review": true },
    limits: { minIntervalMs: 0, minContentChars: 0, minContentTurns: 0, maxPerSession: 3, quotaWindowMs: 3_600_000 },
  };
  const base = { settings, task: "idle-review", now: 10_000_000, lastDispatchAt: null, material: { chars: 1, turns: 1 } };
  assert.equal(admitIdleDispatch({ ...base, dispatched: 2 }).admit, true, "未达上限");
  assert.equal(admitIdleDispatch({ ...base, dispatched: 3 }).reason, "quota-exhausted", "达上限即拦");
  assert.equal(admitIdleDispatch({ ...base, dispatched: 99 }).reason, "quota-exhausted", "且不会自行恢复（降级口径的固有性质）");
});

// ---------------------------------------------------------------------------
// 复审 D1/D2/D7（2026-10-11 第二版独立审核的放行条件）
// ---------------------------------------------------------------------------

test("D1：窗口长度为 0/负数/非有限时**回落默认**，不得按 0 关闭窗口", () => {
  // 0 的语义在两类字段上**相反**，故读取器也必须不同：
  //   · `maxPerSession = 0` → 「不限」（安全：不设上限就不会耗尽）
  //   · `quotaWindowMs = 0` → 「不设窗口」＝会话生命周期累计（**危险**：耗尽即
  //     永久停，正是 04 §8.4「派发准入」段明文禁止的取值）
  // 若窗口按 0 生效，F2 的洞就被重新打开了。
  for (const bad of [0, -1, -3_600_000, NaN, Infinity]) {
    const s = resolveIdleSettings({ idleQuotaWindowMs: bad });
    assert.equal(
      s.limits.quotaWindowMs,
      IDLE_DEFAULTS.quotaWindowMs,
      `窗口长度 ${String(bad)} 须回落默认（不得按 0 关闭窗口）`,
    );
    assert.ok(s.limits.quotaWindowMs > 0, "回落后的窗口须为有限正值");
  }
  // 合法值须被尊重（不得一律回落）。
  assert.equal(resolveIdleSettings({ idleQuotaWindowMs: 7_200_000 }).limits.quotaWindowMs, 7_200_000);
});

test("D1 对照：maxPerSession 的 0 **仍须**表示「不限」（两类字段的 0 语义相反）", () => {
  // 这条是上一条的对照——若有人「统一」了两个字段的读取器，两条测试必有一条失败。
  const s = resolveIdleSettings({ idleMaxPerSession: 0 });
  assert.equal(s.limits.maxPerSession, 0, "上限的 0 是合法的「不限」");
  assert.equal(quotaLeft(999, s.limits.maxPerSession), Infinity, "且确实不放行受限");
});

test("D2/D7：三类约束各自的评估须随返回值给出（放行时也有）", () => {
  // 只记「被挡下」时某约束若恒不触发，它与「根本没实现」不可区分——而 04 §8.4
  // 「派发准入」段要求「各自可被独立观察」。故 evaluations 必须三类齐备。
  const settings = {
    enabled: true,
    tasks: { "idle-review": true },
    limits: { minIntervalMs: 600_000, minContentChars: 800, minContentTurns: 3, maxPerSession: 4, quotaWindowMs: 3_600_000 },
  };
  const r = admitIdleDispatch({
    settings, task: "idle-review", now: 10_000_000, lastDispatchAt: null,
    dispatchTimes: [], material: { chars: 5000, turns: 20 },
  });
  assert.ok(r.evaluations, "须给出 evaluations");
  for (const key of ["cooldown", "content", "quota"]) {
    assert.ok(r.evaluations[key], `须含 ${key} 的评估`);
    assert.equal(typeof r.evaluations[key].ok, "boolean", `${key}.ok 须是布尔`);
  }
  // 规模也须在，否则复核者无法据以复算该约束为何未触发。
  assert.equal(r.evaluations.quota.used, 0);
  assert.equal(r.evaluations.quota.max, 4);
  assert.equal(r.evaluations.quota.windowMs, 3_600_000);
  assert.equal(r.evaluations.content.chars, 5000);

  // 被挡下时同样给出（且明确指出是哪一类）。
  const blocked = admitIdleDispatch({
    settings, task: "idle-review", now: 10_000_000, lastDispatchAt: 9_999_000,
    dispatchTimes: [], material: { chars: 5000, turns: 20 },
  });
  assert.equal(blocked.reason, "cooldown");
  assert.equal(blocked.evaluations.cooldown.ok, false, "挡下时该类的 ok 须为 false");
  assert.equal(blocked.evaluations.content.ok, true, "其余类的真实判定不得被掩盖");
});

test("D7：默认上限须在默认窗口内**可达**（否则该约束不可被独立观察）", () => {
  // 默认间隔 10 分钟 ⇒ 1 小时窗口内最多约 6 次。上限若 ≥6，则配额**永远轮不到
  // 它绑定**，「存在」与「不存在」在运行痕迹里完全一致。
  const maxPerWindow = Math.floor(IDLE_DEFAULTS.quotaWindowMs / IDLE_DEFAULTS.minIntervalMs);
  assert.ok(
    IDLE_DEFAULTS.maxPerSession < maxPerWindow,
    `默认上限 ${IDLE_DEFAULTS.maxPerSession} 须小于窗口内可达次数 ${maxPerWindow}，否则该约束恒不触发`,
  );
});

// ---------------------------------------------------------------------------
// 轮换位不得因「任务被停用」而死锁（2026-10-11 实测缺陷）
// ---------------------------------------------------------------------------
//
// 实测经过：机制重启后连出三条 `throttled / reason=task-disabled`，任务全是
// `memory-health`。原因是轮换位**只在准入通过后**推进，而 `memory-health` 默认
// 停用 → 每次都被挡下 → 轮换位永为 2 → **`idle-review` 再也不会被跑到**。
// 且 `throttled` 不属于失败，故这件事没有任何痕迹。
//
// 两类挡下的处置方向相反：被停用须**跳过**（配置的意图是「别跑这个」，不是
// 「让整个辅助机制停摆」）；被节流须**留在原位**（本该轮到它的下次仍轮到它）。

const ALL_TASKS = { "idle-review": true, "capacity-maintenance": false, "memory-health": false };
const OPEN_ALL = { enabled: true, tasks: { "idle-review": true, "capacity-maintenance": true, "memory-health": true } };

test("pickEnabledAuxTask：某个任务被停用时**跳过它**，不得停在原地（死锁的直接守卫）", () => {
  const settings = { enabled: true, tasks: ALL_TASKS };
  // 遍历所有轮换位：任何一位都必须挑出 idle-review（它是唯一启用的）。
  for (let rotation = 0; rotation < 12; rotation += 1) {
    const pick = pickEnabledAuxTask(rotation, settings);
    assert.equal(pick.task, "idle-review", `rotation=${rotation} 须跳过被停用者挑出唯一启用的任务`);
  }
  // 尤其守卫实测踩到的那一位：rotation=2 本会挑到 memory-health（默认停用）。
  assert.equal(pickEnabledAuxTask(2, settings).task, "idle-review", "rotation=2 曾在此死锁");
  assert.ok(pickEnabledAuxTask(2, settings).skipped >= 1, "该位须报告跳过了至少一个槽位");
});

test("pickEnabledAuxTask：**连续推进**轮换位不会反复走同一槽位（skipped 须被消费）", () => {
  // 调用方用 `rotation + skipped + 1` 作为下一个轮换位。若忽略 skipped，被跳过的
  // 槽位会在下一轮被重复走一遍——不致命，但相位与痕迹会对不上。
  const settings = { enabled: true, tasks: ALL_TASKS };
  let rotation = 0;
  const seen = [];
  for (let i = 0; i < 6; i += 1) {
    const pick = pickEnabledAuxTask(rotation, settings);
    seen.push(pick.task);
    rotation = rotation + pick.skipped + 1;   // 与 lifecycle 同式
  }
  assert.deepEqual(seen, Array.from({ length: 6 }, () => "idle-review"), "每轮都须跑得起来");
  assert.ok(rotation > 6, `轮换位须真实前进（实际到 ${rotation}）`);
});

test("pickEnabledAuxTask：**全部启用**时相位与 idle-checkpoint 的 selectAuxTask 一致（不得漂移）", async () => {
  // 本模块要保持纯（不依赖宿主），故相位函数是独立实现。两处若漂移，「跳过」的
  // 相位与「派发」的相位就会对不上——故直接比对。
  const { selectAuxTask } = await import("../lib/idle-checkpoint.js");
  for (let rotation = 0; rotation < 12; rotation += 1) {
    assert.equal(
      pickEnabledAuxTask(rotation, OPEN_ALL).task,
      selectAuxTask(rotation),
      `rotation=${rotation} 两处相位须一致`,
    );
    assert.equal(pickEnabledAuxTask(rotation, OPEN_ALL).skipped, 0, "全启用则无跳过");
  }
});

test("pickEnabledAuxTask：总开关关闭 与 全部子项停用 都返回 task=null，且**轮换位不动**", () => {
  // 这是配置的全部含义，不是失败——调用方据此不派发、不记 throttled、不推进轮换位。
  const off = { enabled: false, tasks: { "idle-review": true } };
  const none = { enabled: true, tasks: { "idle-review": false, "capacity-maintenance": false, "memory-health": false } };
  for (const rotation of [0, 2, 7]) {
    assert.equal(pickEnabledAuxTask(rotation, off).task, null, "总开关关闭 → 不派发");
    assert.equal(pickEnabledAuxTask(rotation, off).skipped, 0, "总开关关闭 → 轮换位不动（重开从原相位继续）");
    assert.equal(pickEnabledAuxTask(rotation, none).task, null, "全停用 → 不派发");
    assert.equal(pickEnabledAuxTask(rotation, none).skipped, 0, "全停用 → 轮换位不动");
  }
});

test("pickEnabledAuxTask：无设置来源（老宿主）保持旧行为，不做任何跳过", async () => {
  const { selectAuxTask } = await import("../lib/idle-checkpoint.js");
  for (let rotation = 0; rotation < 6; rotation += 1) {
    const pick = pickEnabledAuxTask(rotation, undefined);
    assert.equal(pick.task, selectAuxTask(rotation), "老宿主：相位照旧");
    assert.equal(pick.skipped, 0, "老宿主：不跳过");
  }
});

test("pickEnabledAuxTask：轮换位非法输入按 0 处理（不得抛错）", () => {
  for (const bad of [undefined, null, -1, NaN, "x"]) {
    const pick = pickEnabledAuxTask(bad, { enabled: true, tasks: ALL_TASKS });
    assert.equal(pick.task, "idle-review", `非法轮换位 ${String(bad)} 须按 0 处理`);
  }
});

// ---------------------------------------------------------------------------
// 冷却判据须接受 **ISO 字符串**（2026-10-11 实测缺陷：冷却从未生效）
// ---------------------------------------------------------------------------
//
// ## 缺陷经过
//
// `friction-watermark.js` 的 `recordDispatch` 把时刻写成 ISO 字符串
// （`new Date().toISOString()`），而 `cooldownDue` 原先只认毫秒数：
// `Number.isFinite("2026-…")` 为 false → 走进「不可解析 → 视为从未派发 → 放行」。
// 实测后果：配置 600 秒，而派发间隔为 172/67/1/63 秒——**冷却一次都没拦住过**。
//
// ## 为什么原来的 29 条测试全绿却没发现
//
// 下面原有各条一律用**毫秒数**构造（`now - interval + 1` 之类），而真实载体是
// **ISO 字符串**——测试与真实数据的形状不一致。本组测试全部用字符串构造，
// 补上这个形状缺口。

test("cooldownDue：**ISO 字符串**形式的锚点须被正确解析（真实载体的形状）", () => {
  const now = Date.parse("2026-10-11T05:50:14.595Z");
  const interval = 600_000;
  // 间隔 67 秒（实测被错误放行的真实值）→ 必须拦下。
  assert.equal(
    cooldownDue(now, "2026-10-11T05:49:07.536Z", interval),
    false,
    "ISO 字符串下间隔 67 秒须拦下——这正是冷却失效的直接复现",
  );
  // 间隔正好满 600 秒 → 放行。
  assert.equal(cooldownDue(now, "2026-10-11T05:40:14.595Z", interval), true, "正好满须放行");
  // 差 1 毫秒 → 拦下。
  assert.equal(cooldownDue(now, "2026-10-11T05:40:14.596Z", interval), false, "差 1 毫秒须拦");
  // 远超 → 放行。
  assert.equal(cooldownDue(now, "2026-10-11T04:00:00.000Z", interval), true, "超过更须放行");
});

test("cooldownDue：字符串与数字两种形态给出**同一答案**（口径不得分叉）", () => {
  // 缺陷根源就是两处判据用了不同的类型口径。此条守住它们不分叉。
  const iso = "2026-10-11T05:49:07.536Z";
  const ms = Date.parse(iso);
  const now = Date.parse("2026-10-11T05:50:14.595Z");
  for (const interval of [0, 1_000, 60_000, 600_000, 10_000_000]) {
    assert.equal(
      cooldownDue(now, iso, interval),
      cooldownDue(now, ms, interval),
      `间隔 ${interval} 时两种形态须同答案`,
    );
  }
});

test("cooldownDue：脏数据（不可解析）才视为从未派发——不得与合法字符串混同", () => {
  const now = Date.parse("2026-10-11T05:50:14.595Z");
  // 真正的脏数据 → 放行（宁可放行也不永久停：与 P2「不得使派发永久终止」同取向）。
  assert.equal(cooldownDue(now, "not-a-date", 600_000), true, "不可解析 → 视为从未派发");
  assert.equal(cooldownDue(now, {}, 600_000), true, "对象 → 不可解析");
  // 但**合法**的 ISO 字符串绝不能被当成脏数据——那正是本次缺陷。
  assert.equal(cooldownDue(now, "2026-10-11T05:49:07.536Z", 600_000), false, "合法 ISO 不得被当作脏数据");
});

test("admitIdleDispatch：ISO 字符串锚点下冷却须拦下（端到端复现真实缺陷）", () => {
  // 直接重放实测中被错误放行的一次：05:50:14 派发，上次锚点 05:49:07（间隔 67 秒）。
  const settings = {
    enabled: true,
    tasks: { "idle-review": true },
    limits: { minIntervalMs: 600_000, minContentChars: 800, minContentTurns: 3, maxPerSession: 4, quotaWindowMs: 3_600_000 },
  };
  const last = "2026-10-11T05:49:07.536Z";
  const r = admitIdleDispatch({
    settings,
    task: "idle-review",
    now: Date.parse("2026-10-11T05:50:14.595Z"),
    lastDispatchAt: last,
    dispatched: 0,
    dispatchTimes: [last],
    material: { chars: 4732, turns: 2 },
  });
  assert.equal(r.reason, "cooldown", "ISO 锚点下 67 秒须判 cooldown——实测曾判 admitted");
  assert.equal(r.admit, false);
  assert.equal(r.evaluations.cooldown.ok, false, "评估须如实反映被拦");
  // 对照：同一锚点但间隔已满 → 放行（证明拦下是因为冷却，不是别的原因）。
  const ok = admitIdleDispatch({
    settings, task: "idle-review",
    now: Date.parse("2026-10-11T06:00:00.000Z"),
    lastDispatchAt: last, dispatched: 0, dispatchTimes: [last],
    material: { chars: 4732, turns: 2 },
  });
  assert.equal(ok.reason, "admitted", "间隔满 10 分钟后须放行");
});
