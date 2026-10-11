/**
 * dsh-ldvh — 闲时辅助的设置解析与节流判据（**纯函数**，无运行状态）.
 *
 * ## 为什么单独成文件、且全是纯函数
 *
 * 闲时辅助的「跑不跑」由两类东西决定：**配置**（Human 在插件设置里定的开关与
 * 参数）与**运行状态**（上次派发时间、本会话已派发次数）。后者必须持久化，
 * 前者不必。把**判据**与**状态**分开，判据就能以 `now`/`key` 为入参纯函数化
 * ——测试不需要为它造运行状态，也就不必新增第二份状态账本
 * （specs/04 §14 第 5 条禁止「为证明检查已执行而保存第二状态账本」）。
 *
 * 本模块**不读写任何文件、不含任何时钟调用**：`now` 一律由调用方传入。
 *
 * ## 与规范的关系（如实声明边界，不得省写）
 *
 * 本文件实现的判据横跨两类性质不同的东西，**它们的规范地位不同**：
 *
 * - **总开关与子项开关**（`idleAssistEnabled` 与三个 `*Enabled`）：让已由
 *   32 §10.2/§10.3–§10.5 定义的三任务可被**选择性停用或启用**，不新增任务、
 *   不改职责。按读法这是**实现已有职责的可配置面**，不构成 00 §4.2「改变辅助
 *   机制的数量、名称或职责」。注意其语义已于 2026-10-11 变更：开关不再只是
 *   「停用某任务」，而是**直接决定本次派发做哪几件事**（勾选几个就做几件）——
 *   原「按预算轮换」的调度语义已删除，故开关的地位从「过滤轮换结果」升为
 *   「即调度本身」。
 * - **最小间隔、内容量门槛、会话配额**：三者都**收窄发起条件**——按 04 §12.1
 *   第 3 项「改变辅助机制的发起条件」属**领域增量事项**，须经 Human Gate 修订
 *   规范正文后方为生效条件。
 *
 * **故本文件的现状须如实登记：判据已实现，但其规范依据尚未取得。** 在 Gate 通过
 * 之前，调用方**不得**据本文件主张「节流已按规范生效」，也不得把参数值写成既成
 * 规范内容。`specs/04 §14 第 3 项`（不以工具成功或测试通过冒充机械校验）与
 * `§8.5`（条件式要求）在此适用：实现存在不等于规范授权存在。
 */

/**
 * 数值字段的读取（与 index.js 的 readSwitch 同规格，但接受数值）。
 *
 * 0.1.7+ 的 volatile 字段是 `{ get() }` 引用；更早宿主（或未经 volatile 包装的
 * 普通值）直接就是值。非法值（NaN、负数、非整数）一律回落 `fallback`
 * ——不静默接受可笑的值（如负冷却会让每次检查点都跑）。
 *
 * @param {{get?: () => unknown}|unknown} value - Config 字段的解析结果。
 * @param {number} fallback - 缺失或非法时的答案。
 * @returns {number} 有效数值。
 */
export function readNumber(value, fallback) {
  const raw = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  if (raw === undefined || raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * 读取一个**必须为正**的数值（窗口长度这类「取 0 即等于取消该约束」的字段）。
 *
 * ## 为什么不能复用 `readNumber`（2026-10-11 复审 D1）
 *
 * `readNumber` 把 0 当合法值——那对 `maxPerSession` 是对的（0 表示「不限」是
 * **安全**语义：不设上限就不会耗尽）。但**窗口长度**的 0 语义相反：窗口为 0 表示
 * 「不设窗口」，配额因而退化为**会话生命周期累计**——那正是 04 §8.4「派发准入」
 * 段明文禁止的取值（耗尽后同一会话恒不可派发，水位冻结、内容永不入账）。
 *
 * 故本字段用**独立读取器**：0、负数、非有限值一律回落默认（默认是有限正值），
 * 而不是「按用户所填的 0 去关闭窗口」。取向外向：宁可忽略一个可疑配置，也不让
 * 机制进入永久停摆。
 *
 * @param {{get?: () => unknown}|unknown} value - Config 字段的解析结果。
 * @param {number} fallback - 必须为正的默认值。
 * @returns {number} 有效的正数。
 */
export function readPositiveNumber(value, fallback) {
  const n = readNumber(value, fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/** 布尔字段的读取。缺省一律按 `fallback` 处理（与 index.js 的 readSwitch 同语义）。 */
export function readBool(value, fallback) {
  const raw = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  if (raw === undefined || raw === null) return fallback;
  return raw !== false;
}

/**
 * 闲时辅助的**参数默认值**——**单一来源**。
 *
 * 默认值即「Human 未作配置时机制如何行为」。取这些数的理由：
 *
 * - `minIntervalMs = 600000`（10 分钟）：参考实现 dsh-mnemon 用 300000（5 分钟）、
 *   dsh-auto-memory 用 1800000（30 分钟，夜间翻倍）。本值取 5 与 30 之间偏保守的
 *   一侧；N=3 的阈值只需 3 次观察，10 分钟内正常对话即可攒到。（取值史：2026-10-12
 *   前执行体为 fork 全量继承，单次派发成本高（实测主控会话解压 21.7 MB）是本值的
 *   主要理由；2026-10-12 供给形态修订为零上下文派生 + 有界材料交付后成本大降，
 *   本值未随之重调——重调需证据，不按新形态倒推。）
 * - `minContentChars = 800`：单轮材料上限 2000 字符（`friction-window.js` 的
 *   `MAX_CHARS_PER_TURN`），800 约等于一个实质问答对。低于此值说明本区间几乎
 *   没有新内容，派发只会空转——实测 13 次运行里有 29 秒、58 秒的近乎零新增配对。
 * - `minContentTurns = 3`：与 `minContentChars` **取或**（任一满足即准入）。
 *   它是逃生阀：防「好的」「继续」这类短对话因字数不足而永远攒不到准入。
 * - `maxPerSession = 8`：参考 mnemon 的 20 与会话级日上限 8，取低者（LDVH 单次
 *   成本更高）。配额随水位键（含 sessionId）天然作用域独立。
 * - `maxPerSession = 4`：**窗口内可达**是选值的硬约束（2026-10-11 复审 D7）。
 *   参考 mnemon 的 20 与会话级日上限 8。但按默认间隔 10 分钟，1 小时窗口内最多
 *   只能派发 6 次——上限若取 8 则**永远轮不到它绑定**，于是「配额存在」与「配额
 *   根本没实现」在运行痕迹里**完全不可区分**，04 §8.4「派发准入」段所要求的
 *   「各自可被独立观察」随之落空。取 4 使它在密集会话中确实触发。
 */
export const IDLE_DEFAULTS = Object.freeze({
  minIntervalMs: 600_000,
  minContentChars: 800,
  minContentTurns: 3,
  maxPerSession: 4,
  /**
   * 配额窗口长度（毫秒）：配额按**滑动窗口**计（见 `countWithinWindow`），
   * 而非会话生命周期累计。默认 1 小时——与「跑太勤」的实际关切（一段密集工作
   * 里的派发密度）同尺度，且使窗口滑过后容量自然恢复。
   *
   * **不得取 0 或无界**：那会退化为会话生命周期累计，即 04 §8.4「派发准入」段
   * 明文禁止的取值（耗尽后同一会话恒不可派发、水位冻结、内容永不入账）。
   * 非法值由 `readPositiveNumber` 回落本默认值，**不按用户所填的 0 关闭窗口**。
   */
  quotaWindowMs: 3_600_000,
});

/**
 * 从 Config 解析出闲时辅助的完整设置（**纯**：只读入参，不读时钟/文件）。
 *
 * 总开关与子项开关的缺省都是「开」——机制当前的实际行为是常开，缺省若为关会
 * 使升级即静默停用，那是行为突变而非配置缺省。两个**未实现**的子项
 * （capacity-maintenance / memory-health）缺省为**关**：它们的开关打开后仍会
 * 如实报 `not-implemented`，但让它们默认开会在设置面首次呈现时给出「已启用」
 * 的假象——默认关更诚实。
 *
 * @param {object} config - 插件 Config 的解析结果（可为 undefined）。
 * @returns {{enabled: boolean, tasks: Record<string, boolean>, limits: typeof IDLE_DEFAULTS}} 解析后的设置。
 */
export function resolveIdleSettings(config) {
  const tasks = {
    // 反思摩擦（idle-review）：已实现，缺省开（与现状一致）。
    "idle-review": readBool(config?.idleReviewEnabled, true),
    // 容量维护：**未实现**，缺省关（打开也只会如实报 not-implemented）。
    "capacity-maintenance": readBool(config?.capacityMaintenanceEnabled, false),
    // 记忆健康：**未实现**，缺省关（同上）。
    "memory-health": readBool(config?.memoryHealthEnabled, false),
  };
  return {
    enabled: readBool(config?.idleAssistEnabled, true),
    tasks,
    limits: {
      minIntervalMs: readNumber(config?.idleMinIntervalMs, IDLE_DEFAULTS.minIntervalMs),
      minContentChars: readNumber(config?.idleMinContentChars, IDLE_DEFAULTS.minContentChars),
      minContentTurns: readNumber(config?.idleMinContentTurns, IDLE_DEFAULTS.minContentTurns),
      maxPerSession: readNumber(config?.idleMaxPerSession, IDLE_DEFAULTS.maxPerSession),
      // 【D1】窗口长度用 readPositiveNumber：0/负数/非有限一律回落默认。
      // 这与 `maxPerSession` 的处理**刻意不同**——后者的 0 是安全的「不限」，
      // 前者的 0 是危险的「取消窗口」。两者 0 的语义相反，读取器也必须不同。
      quotaWindowMs: readPositiveNumber(config?.idleQuotaWindowMs, IDLE_DEFAULTS.quotaWindowMs),
    },
  };
}

/**
 * 冷却判据：距上次**派发**是否已满最小间隔。
 *
 * **锚点在派发前写入**（不由本函数读时钟决定）——这一点是有意的，参照
 * dsh-auto-memory `lib/index.js:4998` 与 dsh-mnemon `lifecycle.ts:464`：两处都在
 * 实际调用**之前**置位。理由是**失败也必须计入冷却**：若等结果再置位，一次失败
 * 就不占冷却窗口，下一次检查点立刻重跑，外观上正是 specs/04 §8.3 禁止的
 * 「不得自行重试」。
 *
 * `lastDispatchAt` 为 `null`/`undefined` 表示**从未派发过**——首次不冷却（立即可跑）。
 * 这一点是必须的：否则新会话要等满一个冷却窗口才可能首次产出。
 *
 * @param {number} now - 当前时刻（毫秒时间戳，由调用方提供）。
 * @param {number|null|undefined} lastDispatchAt - 上次派发时刻；从未派发为 null。
 * @param {number} minIntervalMs - 最小间隔（毫秒）。
 * @returns {boolean} true = 可以派发。
 */
export function cooldownDue(now, lastDispatchAt, minIntervalMs) {
  if (!Number.isFinite(now)) return false;
  if (lastDispatchAt === null || lastDispatchAt === undefined) return true;
  // 归一化为毫秒数。**必须接受 ISO 字符串**：载体的 `recordDispatch` 存的就是
  // `new Date().toISOString()`（见 friction-watermark.js），而此前这里只认数字，
  // 于是 `Number.isFinite("2026-…")` 为 false，直接走进下面的「不可解析 → 放行」
  // 分支——冷却因此**从未生效**（实测配置 600 秒、间隔 67 秒仍放行）。
  //
  // 这与 `countWithinWindow` 的处理**必须一致**：同一份载体里的时刻，两处判据
  // 用不同的类型口径，正是本缺陷的成因。
  const at = typeof lastDispatchAt === "number" ? lastDispatchAt : Date.parse(String(lastDispatchAt));
  // 不可解析（真正的脏数据）才视为「从未派发」。注意这条分支**只该在数据损坏时
  // 走到**——正常路径下上面那一步已把 ISO 字符串转成数字。
  if (!Number.isFinite(at)) return true;
  if (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0) return true;
  return now - at >= minIntervalMs;
}

/**
 * 内容量判据：本区间的新增内容是否值得一次派发。
 *
 * **字符数与轮数取或**——任一达标即准入。两条各自都不充分：
 * - 只看字符数：短对话（「好的」「继续」）永远攒不满，内容被无限期推后；
 * - 只看轮数：几轮寒暄也能凑够轮数，而没有任何实质内容。
 *
 * **首次运行无条件准入**：`isFirstRun` 为真时直接放行。这不是优化，是正确性
 * 要求——水位为 null 意味着有**全部历史内容**待观察，此时若因某个区间恰好很短
 * 而拒跑，历史摩擦就永远不会被发现（`friction-watermark.js` 的 `from: null`
 * 语义即「首次运行，覆盖全部既有内容」）。
 *
 * @param {{chars: number, turns: number}} material - 本区间材料的规模。
 * @param {{minContentChars: number, minContentTurns: number}} limits - 门槛。
 * @param {{isFirstRun?: boolean}} [options] - `isFirstRun` 为真则无条件准入。
 * @returns {boolean} true = 可以派发。
 */
export function contentAdmitted(material, limits, { isFirstRun = false } = {}) {
  if (isFirstRun) return true;
  const chars = Number(material?.chars);
  const turns = Number(material?.turns);
  if (!Number.isFinite(chars) || !Number.isFinite(turns)) return false;
  const minChars = Number(limits?.minContentChars);
  const minTurns = Number(limits?.minContentTurns);
  // 门槛自身非法（NaN/负数）时不得放行——宁可少跑也不得因配置错误而无界派发。
  const charsOk = Number.isFinite(minChars) && minChars >= 0 && chars >= minChars;
  const turnsOk = Number.isFinite(minTurns) && minTurns >= 0 && turns >= minTurns;
  return charsOk || turnsOk;
}

/**
 * 把派发时刻列表折算为**窗口内的次数**（纯函数；`now` 由调用方传入）。
 *
 * ## 为什么配额必须按滑动窗口计，而不能按会话累计（2026-10-11 独立审核 F2）
 *
 * 本判据原先把 `dispatchCount` 当作**会话生命周期内的累计**。审核给出反例并被
 * 实测证实：上限耗尽后，同一会话内**再无任何检查点可派发**——间隔再久、内容再多
 * 都不放行。此时水位不再推进、区间无限增长，**该会话剩余的全部内容永不入账**；
 * 而落地侧又不把它登记为失败，故该损失**无任何痕迹**。
 *
 * 那正是「抑制」而非「延后」：节流的正当性是「把内容并入下次观察区间」，而耗尽
 * 之后根本没有「下次」。故本函数按**滑动窗口**计数——窗口滑过即容量恢复，配额
 * 退回它本来的作用：**间隔被误设或关闭时的兜底**，而不是给会话封顶。
 *
 * ## 与「不得使派发永久终止」（04 §8.4 派发准入段）的对应
 *
 * 该条要求累计须以**可恢复**的口径计数，并明确不许以会话生命周期为口径。
 * 本函数即该要求的机械形态：只要窗口有限，容量终会恢复。
 *
 * @param {Array<string|number>} times - 历史派发时刻（ISO 字符串或毫秒数）。
 * @param {number} now - 当前时刻（毫秒时间戳）。
 * @param {number} windowMs - 窗口长度（毫秒）；`<= 0` 或非法表示**不限窗口**。
 * @returns {number} 窗口内的派发次数。
 */
export function countWithinWindow(times, now, windowMs) {
  if (!Array.isArray(times) || times.length === 0) return 0;
  const stamps = times
    .map((v) => (typeof v === "number" ? v : Date.parse(String(v))))
    .filter((n) => Number.isFinite(n));
  // 窗口不设或非法 → 退化为「全部计入」（与旧行为一致，但那要求**显式**这样配置，
  // 而不是像原先那样默认就是全生命周期累计）。
  if (!Number.isFinite(windowMs) || windowMs <= 0) return stamps.length;
  if (!Number.isFinite(now)) return 0;
  const floor = now - windowMs;
  // 半开区间 [floor, now]：恰好落在窗口下界的那一刻计**在内**（与 cooldownDue 的
  // 「正好满即放行」同一取向——边界按对机制有利的一侧取，避免差 1 毫秒的抖动）。
  return stamps.filter((n) => n >= floor && n <= now).length;
}

/**
 * 配额判据：本会话是否还有派发余量。
 *
 * `maxPerSession <= 0` 表示**不限**（参照 dsh-mnemon 的 `maxPerSession` 允许 0 与
 * dsh-auto-memory 的注释「0=不冷却 是合法值，|| 1 会吃掉 0」——0 是有语义的取值，
 * 归一化时不得被吃掉）。故此处把 0 与负数都解释为「不限」，而非「一次也不许」。
 *
 * @param {number} dispatched - 本会话已派发次数。
 * @param {number} maxPerSession - 会话上限；<=0 表示不限。
 * @returns {number} 剩余次数；`Infinity` 表示不限。
 */
export function quotaLeft(dispatched, maxPerSession) {
  const used = Number.isFinite(dispatched) && dispatched > 0 ? dispatched : 0;
  const max = Number(maxPerSession);
  if (!Number.isFinite(max) || max <= 0) return Infinity;
  return Math.max(0, max - used);
}

/**
 * 取**本次要跑的全部任务**——按 Human 在设置面的勾选逐项过滤（纯函数）。
 *
 * ## 为什么不是「轮换」（Human 决定 2026-10-11）
 *
 * 原实现 `pickEnabledAuxTask(rotation, settings)` 按 `rotation % 3` 挑出**一个**
 * 任务。该语义的来源是 `specs/32 §10.2`（候选设计）的「按预算轮换：评审优先、
 * 容量次之、体检周期性」。Human 于 2026-10-11 改定：闲时任务的取舍由设置面的
 * 开关决定，**勾选几个就做几件事**，一次派发把它们的指令拼接进**同一个**子代理
 * 的提示词——轮换概念连同轮换位计数器一并删除。
 *
 * 理由（Human 原述）：该机制的语义是「空闲时集中做检修」，与任务数量无关；
 * 且轮换使被停用/未实现的任务占据相位——实测轮换 60 个相位里
 * `capacity-maintenance` **被选中 0 次**（它不在任何相位上），
 * `memory-health` 占 20 次而当时它只会回 `not-implemented`。
 *
 * ## 返回值
 *
 * `tasks` 是**有序**数组，顺序即 `AUX_TASK_ORDER`——提示词的拼接顺序、以及
 * 运行痕迹里的记录顺序都取它，使「同一次运行的产出」在多次运行间可比。
 * 顺序**不由设置对象决定**：设置里三个开关的枚举次序是 UI 细节，不该成为
 * 判据（同输入不同展示顺序会得到不同提示词，那是隐藏的耦合）。
 *
 * `tasks` 为空（总开关关闭、或三个子项全被停用）时调用方**不派发**——这是配置
 * 的全部含义，**不是失败**（没有校验不可用，只是没有要跑的活），故不记 throttled、
 * 不入待处置队列（那会让「Human 关掉了它」看起来像「它出错了」）。
 *
 * @param {{enabled?: boolean, tasks?: Record<string, boolean>}|undefined} settings - 闲时辅助设置。
 * @returns {{tasks: string[], reason: string|null}} 本轮要跑的任务；`reason` 仅在为空时给出原因码。
 */
export function pickEnabledAuxTasks(settings) {
  // 无设置来源（老宿主 / 未注入）：**全部任务**都跑。
  //
  // 这是与旧行为**不等价**的降级：旧实现在无设置时按轮换挑一个。但既然轮换已被
  // Human 删除，旧相位不再有依据；而此时也没有任何开关可读，故只能全跑。调用方
  // 据此照常运行（各任务的未实现会在各自的实现分支上如实回报）。
  if (settings === undefined || settings === null) {
    return { tasks: [...AUX_TASK_ORDER], reason: null };
  }
  // 总开关关闭：不跑任何任务。不是「跳过若干槽位」——机制整体停用。
  if (settings.enabled === false) {
    return { tasks: [], reason: "idle-assist-disabled" };
  }
  const tasks = AUX_TASK_ORDER.filter((task) => settings.tasks?.[task] === true);
  return { tasks, reason: tasks.length === 0 ? "all-tasks-disabled" : null };
}

/** 闲时辅助的全部任务，顺序即拼接顺序与痕迹记录顺序。 */
export const AUX_TASK_ORDER = Object.freeze(["idle-review", "capacity-maintenance", "memory-health"]);

/**
 * 派发准入的**单一判据**——把四个条件合成一个答案（纯函数）。
 *
 * 顺序即理由：**总开关 → 子项开关 → 冷却 → 内容量 → 配额**。前两项是 Human 的
 * 明示配置，一旦关闭就不该再算其余（也不该因「条件不足」而记任何账）；后三项
 * 是机械节流，被挡下时调用方须**不推进水位**并把区间并入下次观察。
 *
 * 返回值带 `reason`，使调用方能把「被挡下」写成**可区分的运行阶段**
 * （参照 dsh-mnemon：节流不得与 stopped 混同，否则 Human 从痕迹里看不出
 * 机制是「被节流」还是「坏了」）。
 *
 * @param {object} input - 判据入参（见下各字段）。
 * @returns {{admit: boolean, reason: string}} 结论与理由（`reason` 为 `admitted` 或拒因码）。
 */
export function admitIdleDispatch({ settings, task, now, lastDispatchAt, dispatched, dispatchTimes, material, isFirstRun }) {
  if (!settings?.enabled) return { admit: false, reason: "idle-assist-disabled" };
  if (settings.tasks?.[task] !== true) return { admit: false, reason: "task-disabled" };
  const limits = settings.limits ?? {};

  // 三类约束**各自**的评估结果随返回值一并给出（2026-10-11 复审 D2/D7）。
  //
  // 为什么必须给出：04 §8.4「派发准入」段要求三类约束「各自可被独立观察」，且
  // **可观察性须能区分「存在但未触发」与「不存在」**。只记「被挡下」时写一条
  // throttled 是不够的——某约束若在默认取值下恒不触发（例如上限远高于窗口内
  // 可达次数），它在运行痕迹里与「根本没实现」完全不可区分。故把三类各自的
  // 判定与规模一并留给调用方记录，使「生效但放行」也有痕。
  const cooldownOk = cooldownDue(now, lastDispatchAt, limits.minIntervalMs);
  const contentOk = contentAdmitted(material, limits, { isFirstRun });
  // 配额按**滑动窗口**计（F2）。有 `dispatchTimes` 就用它；否则退回 `dispatched`
  // 这一累计口径——但那只是向后兼容的降级路径，按 04 §8.4「派发准入」段属
  // 「会使派发永久终止」的口径，调用方应尽量提供时刻列表。
  const used = Array.isArray(dispatchTimes)
    ? countWithinWindow(dispatchTimes, now, limits.quotaWindowMs)
    : (Number.isFinite(dispatched) && dispatched > 0 ? dispatched : 0);
  const quotaOk = quotaLeft(used, limits.maxPerSession) > 0;

  // 供调用方如实记录（`evaluated` 即三类约束各自的判定，`scale` 是当时的规模）。
  const evaluations = {
    cooldown: { ok: cooldownOk, minIntervalMs: limits.minIntervalMs },
    content: {
      ok: contentOk,
      chars: Number.isFinite(Number(material?.chars)) ? Number(material.chars) : null,
      turns: Number.isFinite(Number(material?.turns)) ? Number(material.turns) : null,
      isFirstRun: isFirstRun === true,
    },
    quota: { ok: quotaOk, used, max: limits.maxPerSession, windowMs: limits.quotaWindowMs },
  };

  const admit = cooldownOk && contentOk && quotaOk;
  const reason = admit
    ? "admitted"
    : !cooldownOk
      ? "cooldown"
      : !contentOk
        ? "insufficient-content"
        : "quota-exhausted";
  return { admit, reason, evaluations };
}
