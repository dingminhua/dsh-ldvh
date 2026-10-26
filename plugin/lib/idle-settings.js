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
 * - **安静时长（`idleSilenceMs`）——本模块现存的唯一参数**：**2026-10-14 起其规范
 *   依据已取得**——11 §6.1（进入契约的判据，锚在**最后一次会话活动**）。其数值明文
 *   「属实现侧承接」，但其**判据与性质**须经 Human Gate 修订规范正文——2026-10-14
 *   的修订即该 Gate 的产物（workcase-88f3e568）。
 *
 * **2026-10-14 取消的三类准入约束（如实登记，勿读作遗漏）**：11 §6.2 原含三类，
 * **均经 Human Gate 取消**，本模块随之删除全部节流判据与配置键：
 *   · **内容量门槛**（字符数/轮数）——与安静时长重叠，且实现在字符数与轮数间取
 *     「或」关系、两门槛互为兜底；实测 14 个 admitted 样本的 chars 均 ≥ 800，
 *     该门槛**从未参与任何一次判定**（当轮取消）。
 *   · **最小间隔**——被安静时长**结构性吸收**（两次派发之间必然隔着「新活动 +
 *     新安静期」，故「距上次派发」恒 ≥ 安静时长；当轮取消）。
 *   · **配额**（窗口内次数不超过上限）——**同日二次修订取消**。它是本类约束的最后
 *     一类，其实测从未绑定（1 小时窗口内最多用到 3、上限 4）。取消依据：安静时长
 *     已在结构上界定频率，另设约束**不产生可观察差别**却要求 Human 在设置面上
 *     判断其取值（「一个参数就可以控制其他的了……否则会乱」，Human 2026-10-14）。
 * 故本文件现**无任何节流判据**：`cooldownDue`／`contentAdmitted`／`countWithinWindow`／
 * `quotaLeft` 四个函数与 `quotaMax`／`quotaWindowMs` 两个配置键均已删除。
 * **`admitIdleDispatch` 仍保留**，但它现在只判定两道 Human 明示开关，并返回空的
 * `evaluations`（如实表达「§6.2 现为空集」）。
 *
 * **前提条件（不得省写）**：安静时长的取值**须为有限正值**——取零/负数/非数会使
 * 「已空闲」恒成立（等价于取消该判据）。该约束由**写入侧**（设置面保存时）拒绝并
 * 提示，实现见 `validateSilenceMs`；此处不得以「回落默认值」代替拒绝。
 */

// 任务清单的**单一来源**是登记表（本模块原先自持第二份，实测导致新增任务在设置面
// 勾上却永远不被启用——详见下方 AUX_TASK_ORDER 的说明）。
import { AUX_TASK_ORDER } from "./aux-task-registry.js";

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
 * 「不设窗口」，配额因而退化为**会话生命周期累计**——那正是 11 §6.2「派发准入」
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
/**
 * 取字段的**原始值**（`undefined` 表示「用户没设过」）。
 *
 * `volatileField` 字段是只有 `get()` 的引用（宿主 0.1.7 的热改语义），故判「是否
 * 被设置过」必须先取值再比 `undefined`——直接拿引用做 `??` 判断**恒为真**，
 * 那正是「默认值架空回落」的形态。
 */
function readValue(value) {
  if (value !== null && typeof value === "object" && typeof value.get === "function") return value.get();
  return value;
}

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
 * - `silenceMs = 300000`（5 分钟）：11 §6.1 的**安静时长**——距最后一次会话活动
 *   持续满该时长才算「会话确已空闲」。参考实现 dsh-mnemon 用 300000（5 分钟）、
 *   dsh-auto-memory 用 1800000（30 分钟，夜间翻倍）。本值原取 600000（10 分钟，
 *   5 与 30 之间偏保守的一侧），Human 于读取时改定为 5 分钟（与 dsh-mnemon 同值）。
 *   **该数值无规范依据**（11 §6.1 明文「数值属实现侧承接」），它是实现默认；
 *   **不得**据它主张规范已规定该时长（§17 条件式要求）。
 * - `quotaWindowMs = 3600000`（1 小时）与 `quotaMax = 4`：11 §6.2 现存的**唯一**
 *   一类准入约束——「配额窗口内的派发次数未超过上限」。窗口 1 小时与「跑太勤」
 *   的实际关切（一段密集工作里的派发密度）同尺度，且使窗口滑过后容量自然恢复。
 *   **`quotaWindowMs` 不得取 0 或无界**：那会退化为会话生命周期累计，即 11 §6.2
 *   明文禁止的取值（耗尽后同一会话恒不可派发、水位冻结、内容永不入账）。
 *   非法值由 `readPositiveNumber` 回落本默认值。
 */
export const IDLE_DEFAULTS = Object.freeze({
  /** 安静时长（毫秒）——11 §6.1 进入契约的判据。**须为有限正值。** */
  silenceMs: 300_000,
});

/**
 * 安静时长的**写入侧校验**（11 §6.1 明文：非法取值须在写入时拒绝并提示）。
 *
 * 为什么单独成函数而不复用 `readPositiveNumber` 的回落语义：回落是**读取侧**
 * 的容错（容忍存量脏数据），而本条要求的是**写入侧拒绝**——安静时长取 0 会使
 * 「已空闲」恒成立（等价于取消该判据），静默回落为默认值会让误设**不可见**，
 * 外观上表现为「机制跑得异常勤」。故写入路径须拿本函数拦下并提示。
 *
 * @param {unknown} value - 界面/配置提交的安静时长（毫秒）。
 * @returns {{ok: true, value: number}|{ok: false, reason: string}}
 */
export function validateSilenceMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, reason: "not-a-finite-number" };
  if (!Number.isInteger(n)) return { ok: false, reason: "not-an-integer" };
  if (n <= 0) return { ok: false, reason: "not-positive" };
  return { ok: true, value: n };
}

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
    // 反思摩擦（friction-discovery）：已实现，缺省开（与现状一致）。
    //
    // **配置项改名的存量迁移**：本项原名 `idleReviewEnabled`，随任务键一并改为
    // `frictionDiscoveryEnabled`（原名沿用了已被否定的「空闲评审」一词）。
    // 这里**先读新键、读不到再读旧键**——只读新键会使既有配置静默失效：`volatileField`
    // 对未知键不报错，于是 Human 曾**明确关闭**摩擦的设定会悄悄退回缺省值 true
    // （行为突变，且从设置面上看不出为什么它又开着了）。
    // **回落顺序不能写成 `新 ?? 旧`**（实测陷阱）：新键在 Config schema 里带
    // `default(true)`，宿主解析配置时会**把 true 填进 config**，故新键永远不是
    // `undefined`——`??` 的右支成了死代码，Human 曾**明确关闭**摩擦的设定会静默
    // 退回 true（行为突变，且从设置面上看不出为什么它又开着了）。
    // 正确判据是「**旧键是否被显式设置过**」：设置过就以它为准（迁移期尊重用户
    // 原意），否则用新键（含其默认值）。
    "friction-discovery": readBool(
      readValue(config?.idleReviewEnabled) === undefined
        ? config?.frictionDiscoveryEnabled
        : config?.idleReviewEnabled,
      true,
    ),
    // 积累经验（experience-capture，11 §10）：已实现，缺省**关**（理由见 index.js
    // 的 schema 注释：新增能力不应在 Human 尚未知情时就开始写候选）。
    "experience-capture": readBool(config?.experienceCaptureEnabled, false),
    // 容量维护：**未实现**，缺省关（打开也只会如实报 not-implemented）。
    "capacity-maintenance": readBool(config?.capacityMaintenanceEnabled, false),
    // 记忆健康：**未实现**，缺省关（同上）。
    "memory-health": readBool(config?.memoryHealthEnabled, false),
  };
  return {
    enabled: readBool(config?.idleAssistEnabled, true),
    tasks,
    /**
     * 经验审核（11 §10.2）的设置。**与 `tasks` 分开**：§8 明写捕获段与审核段
     * 「不是新增一个任务类型」，故它不进 `AUX_TASK_ORDER`；它是同一职责的第二拍，
     * 由**独立的固定间隔时机**驱动（Human 2026-10-26：两件事分开设置）。
     */
    review: {
      enabled: readBool(config?.experienceReviewEnabled, false),
      intervalMs: readPositiveNumber(config?.experienceReviewIntervalMs, REVIEW_DEFAULTS.intervalMs),
      // 审核执行体使用的模型；空串 = 不指定，沿用宿主默认路由（见 index.js 的注释）。
      model: readModelSelection(config?.experienceReviewModel),
    },
    limits: {
      // 安静时长（11 §6.1）：读取侧回落默认（容忍存量脏数据）。
      //
      // **写入侧拒绝由另外两道承担，不在本处**（2026-10-14 复核更正）：
      //   ① `client.js` 的 `idleSilenceOk`（设置面提交前拦 0/负/非数，并提示）；
      //   ② `index.js` 的 `z.number().min(1)`（schema 层兜住绕过设置面的写入）。
      // 本模块导出的 `validateSilenceMs` 是**同一判据的独立实现**，供这两道之外的
      // 调用方（及单测）复用；**当前生产写入路径并未直接调用它**——不得据其存在
      // 断言「写入已被校验」。
      //
      // **2026-10-14 二次修订**：本节原还含 `quotaMax`／`quotaWindowMs` 两项
      // （配额上限与窗口长度）。经 Human Gate 取消后，**本节现只有安静时长一项**
      // ——11 §6.2 现不设任何准入约束，故实现侧不再有配额判据的配置载体。
      silenceMs: readPositiveNumber(config?.idleSilenceMs, IDLE_DEFAULTS.silenceMs),
    },
  };
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

/**
 * 闲时辅助的全部任务，顺序即拼接顺序与痕迹记录顺序。
 *
 * **单一来源**：本常量**重导出**登记表的那一份，本模块不再自持第二份定义。
 *
 * 为什么必须如此（实测教训，2026-10-14）：本模块原先自持一份同样的数组，而
 * `aux-task-registry.js` 另有一份。给登记表新增任务（积累经验）时只改了那一份，
 * 本模块这份就漏了——于是 `pickEnabledAuxTasks` 按**旧清单**过滤，新任务即使在
 * 设置面勾上也**永远不会被启用**；而它的开关、词条、schema 全都正常，从设置面
 * 到痕迹都看不出问题（表现为「勾了没反应」）。两份定义必然漂移，故改为单一来源。
 */
export { AUX_TASK_ORDER };

/**
 * 派发准入的**单一判据**——把全部条件合成一个答案（纯函数）。
 *
 * 顺序即理由：**总开关 → 子项开关 → 配额**。前两项是 Human 的明示配置，一旦
 * 关闭就不该再算其余（也不该因「条件不足」而记任何账）；末项是机械节流，
 * 被挡下时调用方须**不推进水位**并把区间并入下次观察。
 *
 * ## 2026-10-14：判据由三类收为一类（11 §6.2 修订）
 *
 * 原判据为「冷却 → 内容量 → 配额」三类，经 Human Gate 取消前两类：
 *   · **冷却（最小间隔）**——被 §6.1 的安静时长**结构性吸收**：两次派发之间
 *     必然隔着「一段新的会话活动 + 一段新的安静期」，故「距上次派发」恒不小于
 *     安静时长，该判据恒真、永不绑定。
 *   · **内容量**——与安静时长重叠，且其两门槛互为兜底从未参与判定。
 * **故本函数不再接收 `lastDispatchAt` / `material` / `isFirstRun` 三个入参**
 * （改成可选忽略以防旧调用方传参报错，但不再参与判定）。
 *
 * **进入契约不在此处**：§6.1 的安静时长由 `triggers.js` 在**武装计时器之前**
 * 判定，不属本函数（层次不同：前者是进入契约，本函数是节流）。
 *
 * 返回值带 `reason`，使调用方能把「被挡下」写成**可区分的运行阶段**
 * （参照 dsh-mnemon：节流不得与 stopped 混同，否则 Human 从痕迹里看不出
 * 机制是「被节流」还是「坏了」）。
 *
 * @param {object} input - 判据入参（见下各字段）。
 * @returns {{admit: boolean, reason: string}} 结论与理由（`reason` 为 `admitted` 或拒因码）。
 */
export function admitIdleDispatch({ settings, task }) {
  if (!settings?.enabled) return { admit: false, reason: "idle-assist-disabled" };
  if (settings.tasks?.[task] !== true) return { admit: false, reason: "task-disabled" };

  // **11 §6.2 现不设任何准入约束**（2026-10-14 二次修订，Human Gate 授权）：本节
  // 原只保留「配额窗口内次数未超过上限」一类，该轮一并取消，故此处**没有**机械
  // 节流判据可评估——放行与否只剩前面两道 Human 的明示配置（总开关、子项开关）。
  //
  // ## 为什么不再需要节流判据
  //
  // §6.1 的安静时长**已在结构上界定频率**：要再次派发，必先有新的会话活动刷新
  // 计时、再安静满一个安静时长，故单位时间内派发次数天然有界。实测亦印证：
  // 配额上限 4 在 1 小时窗口内最多只用到 3，**从未绑定过**——它不产生任何可观察
  // 差别，却要求 Human 在设置面上判断其取值。
  //
  // ## `evaluations` 为何保留（当前恒为空对象）
  //
  // 它是 §6.2「约束可被独立观察」这一**条件式要求**的落点：若将来重新引入约束，
  // 各类约束的判定须随返回值一并给出（使「存在但未触发」与「不存在」可区分）。
  // **当前无约束，故本对象为空**——这不是省略，而是如实表达「本节现无约束」；
  // 调用方据此在运行痕迹里写下的 `evaluated: {}`，正是「本节为空集」的可观察形态。
  //
  // ## 入参
  //
  // 原还接收 `now`／`dispatched`／`dispatchTimes`（供配额判据计算窗口内次数）。
  // 配额取消后三者**均无消费方**，故不再接收——保留它们会使调用方误以为仍有
  // 节流在起作用，而「隐形的、不可观察的判据」正是 §6.2 明文禁止的形态。
  return { admit: true, reason: "admitted", evaluations: {} };
}

/**
 * 审核的**固定间隔**与**开关**（2026-10-26）。
 *
 * ## 为什么它们是两个独立的量
 *
 * Human 明确：「这本来就是两件事，一个是对话结束捕获，一个是自动的审核捕获，
 * 所以要分开设置」。规范层面二者本就分属两种时机形态（§6.1）：
 *
 * - **一次延迟**（`silenceMs`）：回合结束 + 空窗 → 捕获段（摩擦发现 + 经验捕获）；
 * - **固定间隔**（`reviewIntervalMs`）：周期到达 → 审核段（判留观材料能否成文）。
 *
 * ## 为什么审核缺省**关**
 *
 * 审核段会**创建 draft 事实对象**。缺省打开等于在 Human 尚未知情时就开始往账本里
 * 写候选——与捕获段缺省关同一理由。
 *
 * ## 为什么间隔缺省 60 分钟没有规范依据
 *
 * §6.1 明文「延迟时长与间隔的数值由实现侧承接，本规范不内嵌、不为其指定配置载体」。
 * 60 分钟是实现默认值，**不得**据以主张规范已规定该间隔（§17 条件式要求）。
 */
/**
 * 解析 `"<provider>/<model>"` 形式的模型选择（2026-10-26）。
 *
 * **解析不出来就返回 null，不猜、不回落**：返回值 null 明确表示「按宿主默认路由」。
 * 若把非法字符串悄悄当作默认，设置面上就会显示一个「已设置」的模型而实际没生效
 * ——那正是本仓反复记载的那类缺陷（设置显示 A、实际生效 B）。
 *
 * 格式判据刻意简单：**按第一个 `/` 切分**。model 名里可能含 `/`（如
 * `meta-llama/Llama-3`），故只切第一个，剩余全部归 model。
 *
 * @param {unknown} raw
 * @returns {{provider:string, model:string}|null}
 */
export function readModelSelection(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // 语法：`provider/model` 或 `provider/model#effort`（2026-10-26 加推理强度）。
  const hash = trimmed.indexOf("#");
  const effort = hash >= 0 ? trimmed.slice(hash + 1).trim() : "";
  const beforeHash = hash >= 0 ? trimmed.slice(0, hash) : trimmed;
  const slash = beforeHash.indexOf("/");
  if (slash <= 0) return null; // 没有 `/`，或 `/` 在开头（缺 provider）
  const provider = beforeHash.slice(0, slash).trim();
  const model = beforeHash.slice(slash + 1).trim();
  if (provider.length === 0 || model.length === 0) return null;
  // effort 可选：没有就不带这个键（而不是给空串——空串会被当成「显式要默认档」）。
  return effort.length === 0 ? { provider, model } : { provider, model, reasoningEffort: effort };
}

export const REVIEW_DEFAULTS = Object.freeze({
  /** 审核的固定间隔（毫秒）。须为有限正值——取值属 §6.1 的实现侧承接。 */
  intervalMs: 3_600_000,
});

/**
 * 审核间隔的**写入侧校验**（§6.1 明文：非法取值须在写入时拒绝并提示）。
 *
 * 取 0、负数或非数会使「到点」恒成立（等价于取消时机约束），故**不得**静默回落为
 * 默认值后照常生效。与 `validateSilenceMs` 同一判据、同一理由——两者都是时机数值。
 */
export function validateReviewIntervalMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, reason: "not-a-finite-number" };
  if (!Number.isInteger(n)) return { ok: false, reason: "not-an-integer" };
  if (n <= 0) return { ok: false, reason: "not-positive" };
  return { ok: true, value: n };
}
