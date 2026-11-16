/**
 * dsh-ldvh — 闲时辅助的设置解析与节流判据（**纯函数**，无运行状态）.
 *
 * ## 为什么单独成文件、且全是纯函数
 *
 * 闲时辅助的「跑不跑」由两类东西决定：**配置**（Human 在插件设置里定的开关与
 * 参数）与**运行状态**（上次派发时间、本会话已派发次数）。后者必须持久化，
 * 前者不必。把**判据**与**状态**分开，判据就能以 `now`/`key` 为入参纯函数化
 * ——测试不需要为它造运行状态，也就不必新增第二份状态账本
 * （specs/04 §13 第 5 条禁止「为证明检查已执行而保存第二状态账本」）。
 *
 * 本模块**不读写任何文件、不含任何时钟调用**：`now` 一律由调用方传入。
 *
 * ## 与规范的关系（如实声明边界，不得省写）
 *
 * 本文件实现的判据横跨两类性质不同的东西，**它们的规范地位不同**：
 *
 * - **总开关与子项开关**（`idleAssistEnabled` 与三个 `*Enabled`）：让已由
 *   32 §10.2/§10.3–§10.5 定义的三任务可被**选择性停用或启用**，不新增任务、
 *   不改职责。按读法这是**实现已有职责的可配置面**，不构成 00 §3.2「改变辅助
 *   机制的数量、名称或职责」。注意其语义已于 2026-10-11 变更：开关不再只是
 *   「停用某任务」，而是**直接决定本次派发做哪几件事**（勾选几个就做几件）——
 *   原「按预算轮换」的调度语义已删除，故开关的地位从「过滤轮换结果」升为
 *   「即调度本身」。
 * - **安静时长（`idleSilenceMs`）——已删除（2026-11-17）**：它曾是本模块唯一的
 *   数值参数，锚在 11 §6.1 原「距最后一次会话活动持续满一个安静时长」这一进入
 *   契约。触发锚改为**主控发起**后该判据整体不存在，参数随之删除。**本模块现无
 *   任何数值参数**，只剩两道 Human 明示开关。
 *
 * **2026-10-14 取消的三类准入约束（如实登记，勿读作遗漏）**：11 §6.2 原含三类，
 * **均经 Human Gate 取消**，本模块随之删除全部节流判据与配置键：
 *   · **内容量门槛**（字符数/轮数）——与安静时长重叠，且实现在字符数与轮数间取
 *     「或」关系、两门槛互为兜底；实测 14 个 admitted 样本的 chars 均 ≥ 800，
 *     该门槛**从未参与任何一次判定**（当轮取消）。
 *   · **最小间隔**——当时被安静时长**结构性吸收**（两次派发之间必然隔着「新活动
 *     + 新安静期」；当轮取消）。**现由主控发起结构吸收**：两次发起之间必然隔着
 *     「一次主控行动 + 一次阻碍判定」（11 §6.2，2026-11-17）。
 *   · **配额**（窗口内次数不超过上限）——**同日二次修订取消**。它是本类约束的最后
 *     一类，其实测从未绑定（1 小时窗口内最多用到 3、上限 4）。取消依据：进入契约
 *     已在结构上界定频率，另设约束**不产生可观察差别**却要求 Human 在设置面上
 *     判断其取值（「一个参数就可以控制其他的了……否则会乱」，Human 2026-10-14）。
 * 故本文件现**无任何节流判据**：`cooldownDue`／`contentAdmitted`／`countWithinWindow`／
 * `quotaLeft` 四个函数与 `quotaMax`／`quotaWindowMs` 两个配置键均已删除。
 * **`admitIdleDispatch` 仍保留**，但它现在只判定两道 Human 明示开关，并返回空的
 * `evaluations`（如实表达「§6.2 现为空集」）。
 *
 * **原「安静时长须为有限正值」的前提已随该参数删除**（2026-11-17）：没有时长可
 * 取值，`validateSilenceMs` 一并删除。现存的数值参数只有召回预算档位（K 字节），
 * 其 0 合法（表示不限），与本条原语义相反，不得共用判据。
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

export function readBool(value, fallback) {
  const raw = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  if (raw === undefined || raw === null) return fallback;
  return raw !== false;
}

// 2026-11-17：`pickLegacyBoolean` 已删除——它唯一的使用者是随「捕获层/
// 审核层」结构取消而删除的旧键兼容块。总开关的旧键兼容改由下面 `resolveIdleSettings`
// 内 `readBool(proxyAssistEnabled, readBool(idleAssistEnabled, true))` 直接承载。

/**
 * 本模块的默认值。
 *
 * **2026-11-17：原唯一的安静时长默认值已删除。** 它承载的是 11 §6.1 原「安静
 * 时长」这一进入契约判据；触发锚改为主控发起后，该判据连同计时器一并删除
 * （11 §6.1「触发锚是主控发起」）。**不得保留一个恒不生效的默认值**——那会让
 * 「计时机制还在、只是不起作用」成为表面事实。故本对象现为空，保留导出是为了
 * 不改动调用方的解构形状。
 */
export const IDLE_DEFAULTS = Object.freeze({});

/**
 * 原「安静时长的写入侧校验」已随安静时长一并删除（2026-11-17）。
 *
 * 保留本注释而不留空函数：调用方若仍 import 本符号，**导入期就会报错**（ESM 的
 * 具名导入不存在即 SyntaxError），这比留一个恒返回 ok 的空壳更早暴露问题——后者
 * 会让「写入侧仍在校验」成为表面事实。
 */

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
  // ── 2026-10-30 配置面合并（Human 决定）────────────────────────────────
  //
  // 六个开关合并为两个：`idleCaptureEnabled`（发现层：摩擦发现 + 经验捕获）与
  // `auxReviewEnabled`（审核层：经验审核 + 摩擦缓冲升级）。理由是两层重构后同层
  // 任务在同一次派发里一起跑，拆开只会产生「半套材料」而痕迹里看不出原因。
  //
  // **迁移必须能区分「用户显式设过」与「默认值填进来的」**。这正是本文件此前反复
  // 警告的失效形态：带 `default()` 的键会被宿主填进 config，`新 ?? 旧` 的右支成
  // 死代码，Human 曾明确关闭的设定会静默退回默认值。故：
  //   - 新键（`idleCaptureEnabled`/`auxReviewEnabled`）**有** default；
  //   - 旧键（`frictionDiscoveryEnabled`/`experienceCaptureEnabled`/
  //     `experienceReviewEnabled`/`idleReviewEnabled`）在 schema 里**无** default。
  // 判据因此是「旧键是否被显式设置过」：设过就以它为准（迁移期尊重原意），否则
  // 用新键（含其默认值）。
  //
  // 多个旧键并存时（历史迁移留下的）按「任一被显式设置过即生效，且**关闭优先**」
  // 处理——若用户曾关掉其中任一半，说明他不想让那一半跑；合并后不再分开关，保守
  // 取「关」比擅自打开更诚实。
  // 2026-11-17：`captureLegacy` / `captureEnabled` 旧键兼容块已删除——
  // 子项现役键是 `frictionDiscoveryEnabled`（与 `experienceAccumulationEnabled`
  // 并列），旧 `idleCaptureEnabled` 随「捕获层/审核层」结构取消，测试已钉住。

  // ── 2026-11-17：两个子项改为「代理辅助」的两类 ──────────────────────────
  //
  // 原「闲时辅助」的语义是「空闲时集中做检修」，其子项是宿主侧任务。现机制改为
  // 「主控发现 → 交派代理处理」，故子项只剩**两类动作**（00 §4.5 代理辅助任务）：
  //   · `experience-accumulation`：积累经验（主控发现失败机制，派代理起草）
  //   · `friction-discovery`：发现摩擦（主控发现阻碍，派代理写缓冲）
  //
  // **两类共用同一个总开关**（`proxyAssistEnabled`），但**各自有子项开关**：
  // 主控可能只想积累经验、不想记摩擦，反之亦然——合并成一个开关会使其中一类
  // 无法单独停用，而它们的产物落点完全不同（Pitfall vs 摩擦缓冲）。
  //
  // **子项缺省为「开」**：与总开关同理，缺省关会使升级即静默停用。
  const tasks = {
    "experience-accumulation": readBool(config?.experienceAccumulationEnabled, true),
    "friction-discovery": readBool(config?.frictionDiscoveryEnabled, true),
  };
  return {
    enabled: readBool(config?.proxyAssistEnabled, readBool(config?.idleAssistEnabled, true)),
    tasks,
    // **2026-11-17**：`limits` 已整体删除——它当时只含安静时长一项，
    // 而安静时长随计时器删除（11 §6.1）。**不得保留空对象 `limits: {}`**：
    // 那会让调用方以为「还有限值可读」，且在解构该限值时
    // 时得到 `undefined` 而非报错——静默通过比导入期报错更难发现。
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
 *   · **冷却（最小间隔）**——被 §6.1 的进入契约**结构性吸收**：两次派发之间
 *     必然隔着「一段新的会话活动 + 一段新的安静期」，故「距上次派发」恒不小于
 *     安静时长，该判据恒真、永不绑定。
 *   · **内容量**——与安静时长重叠，且其两门槛互为兜底从未参与判定。
 * **故本函数不再接收 `lastDispatchAt` / `material` / `isFirstRun` 三个入参**
 * （改成可选忽略以防旧调用方传参报错，但不再参与判定）。
 *
 * **进入契约不在此处**：§6.1 的进入契约现为「主控在当次行动中判定出现阻碍并
 * 交派执行体」（2026-11-17），由主控的发起动作承载，不属本函数（层次不同：
 * 前者是进入契约，本函数是节流）。
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
  // §6.1 的进入契约**已在结构上界定频率**（2026-11-17 改为主控发起）：要再次
  // 派发，必先有主控的一次新行动与一次阻碍判定，故单位时间内派发次数天然有界。
  // 原计时器形态下的实测亦印证：
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
 * 审核的**开关**（2026-10-26；2026-10-27 二次修订：去掉间隔）。
 *
 * ## 为什么开关与捕获分开
 *
 * Human 明确：「这本来就是两件事，一个是对话结束捕获，一个是自动的审核捕获，
 * 所以要分开设置」。
 *
 * ## 为什么审核缺省**关**
 *
 * 审核段会**创建 draft 事实对象**。缺省打开等于在 Human 尚未知情时就开始往账本里
 * 写候选——与捕获段缺省关同一理由。
 *
 * ## 为什么这里没有间隔值（2026-10-27 二次修订）
 *
 * 间隔原本是给「每小时往专属会话投一次提醒」定频用的；落点会话已被整体移除
 * （见 `friction-promotion-lock.js`），就没有东西需要定频。Human 2026-10-27：
 * 「==，这个不存在时间了呀，随静置触发」。故本模块**不再有** `intervalMs`，
 * `REVIEW_DEFAULTS` 与 `validateReviewIntervalMs` 一并删除——保留一个「恒为 0 的
 * 间隔」比直接删掉更危险：它看起来像间隔机制还在，某次调参就会把真闸门装回去。
 *
 * 时机的实际判据在 `friction-promotion-lock.js`：**静置到期 + 无审核在跑**，
 * 两个条件，没有第三个。
 */
