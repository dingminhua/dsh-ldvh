/**
 * dsh-ldvh — 闲时辅助的**任务登记表**：一次派发做多件事（Human 决定 2026-10-11）.
 *
 * ## 本模块为什么存在
 *
 * 原实现按 `rotation % 3` 挑出**一个**任务派发（`selectAuxTask`），其依据是
 * `specs/32 §10.2`（候选设计）的「按预算轮换：评审优先、容量次之、体检周期性」。
 * Human 于 2026-10-11 改定：闲时任务的取舍由设置面的开关决定，**勾选几个就做
 * 几件事**——一次派发把全部已启用任务的指令**拼接**进**同一个**子代理的提示词，
 * 轮换概念（连同轮换位计数器）删除。理由：该机制的语义是「空闲时集中做检修」，
 * 与任务数量无关；而轮换使被停用/未实现的任务占据相位（实测 60 个相位里
 * `capacity-maintenance` 被选中 0 次）。
 *
 * ## 登记的四个部位（每个任务必须自述）
 *
 * 一个任务的「实现」由四处共同构成，缺任一处即不算实现：
 *
 * | 部位 | 作用 |
 * |---|---|
 * | `promptSection(ctx)` | 拼进共享提示词的那段指令——**它必须自足**：说明本任务要判断什么、输出什么字段 |
 * | `outputSchema()` | 该任务在复合 schema 里的那一片（字段名、枚举、必填性） |
 * | `validate(structured, ctx)` | 落地前的**跨字段**校验（宿主支持的 schema 子集表达不了条件约束，见契约模块） |
 * | `land(...)` | 该任务结论的落地动作（由调用方按本表登记的分派函数执行） |
 *
 * ## 三条不许越界的纪律
 *
 * 1. **拼接不等于混合**：各任务的提示词段与输出字段**各自独立、互不引用**。
 *    一个任务的产出缺失或校验失败**不得**影响其它任务（§8.4 的闭集动作按任务
 *    分别成立），故校验与落地都在**每任务**的粒度上收口。
 * 2. **顺序是判据的一部分**：拼接顺序取 `AUX_TASK_ORDER`（规范里的叙述次序），
 *    **不取**设置对象的枚举次序——后者是 UI 细节，若成判据，同一次勾选在不同
 *    展示顺序下会得到不同提示词（隐藏耦合）。
 * 3. **未实现的任务照实登记，不静默跳过**：`implemented === false` 的任务仍会
 *    出现在提示词与 schema 里吗？——**不会**。它既不拼接也不派发，但调用方**必须**
 *    在运行痕迹里如实记一条「已启用但未实现」（§8.5 条件式要求：不得主张空闲
 *    维护已运行）。静默剔除会使 Human 从设置面到痕迹都看不出该任务没做。
 */

import { buildDiscoveryPromptSection, discoveryOutputSchema, validateDiscoveryVerdict } from "./friction-subagent-contract.js";
import { buildCapturePromptSection, captureOutputSchema, validateCaptureVerdict } from "./experience-capture-contract.js";


/**
 * 闲时辅助的全部任务，顺序即拼接顺序与痕迹记录顺序（规范叙述次序）。
 *
 * **2026-10-30 收窄为两个**（Human 决定：配置面合并为「闲置捕获 / 闲置审核」两项）：
 * `capacity-maintenance` 与 `memory-health` 移出本表。
 *
 * 移出的理由不是「它们不再是 §8 的职责」——§8 仍登记着它们，只是**未实现**。
 * 移出的理由是：本表是**派发面**（能被配置开关选中、被拼进复合提示词的任务），
 * 而这两个任务没有执行体、没有提示词段、没有落地路径。让它们留在派发面里，唯一
 * 效果是 `splitRunnableTasks` 把它们报成 `unimplemented` 而其余任务照常跑——那正是
 * §8.5 要的「如实登记」，但该登记现已由 `UNIMPLEMENTED_AUX_TASKS` 独立承载（见下），
 * 不必依赖它们占着派发位。
 */
export const AUX_TASK_ORDER = Object.freeze(["friction-discovery", "experience-capture"]);

/**
 * §8 登记在册、但**尚未实现**的职责（2026-10-30）。
 *
 * 它们**不在** `AUX_TASK_ORDER`（不进派发面），但必须可见——§8.5 明文「不得主张
 * 空闲维护已运行」，反向也要求「未实现的职责不得从登记里消失」。诊断面与痕迹
 * 通过本常量把它们如实报为未实现，而不是让它们悄悄不出现。
 */
export const UNIMPLEMENTED_AUX_TASKS = Object.freeze(["capacity-maintenance", "memory-health"]);

/**
 * `friction-discovery`（摩擦发现）的登记项。
 *
 * 提示词段与输出 schema 的实际内容由 `friction-subagent-contract.js` 提供——本项
 * 只做**查找与分派**，不复制其正文（04 §14 第 6 条：不在规范里复制宿主/下位实现；
 * 同理实现内部也不复制彼此的文本，否则一改两处必漂移）。
 */


/** 摩擦发现（11 §9）的任务键。**曾用名 `idle-review`**（见 friction-watermark 的改名回落）。 */
const FRICTION_DISCOVERY_KEY = "friction-discovery";

/** 经验积累（11 §10）的任务键。 */
const EXPERIENCE_CAPTURE_KEY = "experience-capture";

/**
 * 复合输出的**顶层字段名**约定。
 *
 * 用「任务键 → 该任务的结论对象」的**一层命名空间**，而不是把各任务的字段平铺在
 * 顶层。理由：平铺会使两个任务都用 `reason` 之类的通用名时互相覆盖，而覆盖是
 * **静默**的（schema 无法表达「这两个 reason 属于不同任务」）；命名空间使归属
 * 由结构本身承载，且新增任务不改动既有任务的字段。
 *
 * ── 属性名必须是标识符安全形式（2026-10-30 修）────────────────────
 *
 * 原实现直接返回任务键（kebab-case，如 `friction-discovery`）。这导致
 * **schema 下发的键与宿主校验的键不是同一个**：宿主在参数传递环节把属性名
 * 规范化为 snake_case，于是子代理按 schema 提交 `friction-discovery` 时，
 * 宿主收到的是 `friction_discovery`，校验以
 * `value.friction-discovery is not a declared property` 拒绝。
 *
 * 实测证据（会话日志 e00fa45a，2026-10-30）：请求头下发的 schema 属性名为
 * `friction-discovery`（kebab），而 tool/call 的 arguments 键为
 * `friction_discovery`（snake）——**同一份 schema，两种键形**，任何子代理
 * 都无法完成提交。该缺陷使 friction-discovery 与 experience-capture 两个
 * 辅助任务的结论**恒无法回传**。
 *
 * 修法：属性名统一为 snake_case（标识符安全形式），与宿主的规范化规则一致。
 * **任务键本身仍是 kebab-case**（它是内部标识，广泛用于配置、日志与提示词
 * 分段），本函数只负责「任务键 → schema 属性名」这一个映射。
 *
 * 映射须是**单射**：两个任务键不得映射到同一属性名，否则命名空间退化为平铺，
 * 回到上面那条「静默覆盖」的老问题——故下方断言不同键映射出不同属性名。
 */
export function compositePropertyName(taskKey) {
  return taskKey.replace(/-/g, "_");
}

/**
 * 组装交给**一个**子代理的拼接提示词。
 *
 * 参数：
 *   - `tasks`：本次要跑的任务键（有序；调用方取自 `pickEnabledAuxTasks`）；
 *   - `sections`：`{ [taskKey]: string }`——各任务的提示词段正文；
 *   - `shared`：**只出现一次**的公共部分（材料边界、观察材料、既有账本、产出方式）。
 *
 * ## 为什么公共部分只出现一次
 *
 * 材料（本次观察区间）与边界声明对**所有**任务都是同一份：若每任务各拼一遍，
 * 提示词会随任务数线性膨胀，而材料本身可能上万字（实测主控会话材料 10 万+ 字符）。
 * 更关键的是**一致性**：同一段边界规则出现两次，就可能出现两种措辞，而执行体
 * 会按更宽松的那个理解——引证核对是按材料正文做的，措辞漂移直接使引证被拒。
 *
 * ## 顺序
 *
 * 先公共部分，再按 `AUX_TASK_ORDER` 逐个列任务段。任务段的顺序**必须**与
 * `tasks` 的给定顺序一致（调用方已按规范次序排好），本函数**不重排**——
 * 重排会使「同一次运行的产出」与痕迹记录的顺序对不上。
 *
 * @param {{tasks: string[], sections: Record<string,string>, shared: string}} input
 * @returns {string} 拼接后的完整提示词。
 */
export function buildCompositePrompt({ tasks = [], sections = {}, shared = "" } = {}) {
  const parts = [];
  const body = String(shared ?? "").trim();
  if (body.length > 0) parts.push(body);

  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0) {
    // 无任务时不给提示词——调用方不该走到这里（无任务即不派发）。如实抛错而不
    // 返回半截提示词：半截提示词会被执行体当作「只要随便答点什么」，比不派发更糟。
    throw new Error("buildCompositePrompt requires at least one task (无任务即不派发，调用方不得以空提示词派生执行体)");
  }

  parts.push("");
  parts.push(
    list.length === 1
      ? "## 本次要做的一件事"
      : `## 本次要做的 ${list.length} 件事（**逐件都要给出结论**）`,
  );
  if (list.length > 1) {
    parts.push(
      "下面是本次运行要完成的全部事项。它们是**各自独立**的判断，请逐件作答，"
      + "每一件都在输出里占一个自己的字段（见各段末尾的字段说明）。"
      + "**不得因为某一件没有发现就略过其它件**，也不得把两件事合并成一个结论。",
    );
  }

  list.forEach((taskKey, index) => {
    const section = String(sections?.[taskKey] ?? "").trim();
    if (section.length === 0) {
      // 任务在册却无提示词段 = 登记不完整。抛出而不静默跳过：静默跳过会使该任务
      // 「被启用、被拼接、却从未被要求作答」，而输出里它仍占一个字段（恒为空）——
      // 那与「它答了没有发现」在落地侧无从区分。
      throw new Error(`no prompt section registered for task "${taskKey}" (登记不完整，不得静默跳过)`);
    }
    parts.push("");
    // **标题须同时给出属性名**（2026-10-30 修）：标题里的任务键是 kebab-case
    // （`friction-discovery`），而输出对象的**顶层属性名**是 snake_case
    // （`friction_discovery`）——两者分叉后，子代理若照抄标题里的键就会交不出来
    // （宿主按 snake_case 校验，kebab 键被判为未声明属性）。
    // 故标题明写「顶层字段名」，让子代理不必推断。
    parts.push(
      `### 事项 ${index + 1}／${list.length}：${taskKey}`
      + `（**你的输出里，它的顶层字段名是 \`${compositePropertyName(taskKey)}\`**）`,
    );
    parts.push(section);
  });

  return parts.join("\n");
}

/**
 * 组装复合输出的 schema：`{ [taskKey]: <该任务的 schema> }`。
 *
 * 顶层 `additionalProperties: false` + `required` 列出全部任务键——使「某任务没
 * 作答」在**提交层**即被宿主拦下，而不是等到落地侧发现字段缺失。这是本设计能
 * 让「逐件作答」成为机械要求（而非提示词里的请求）的关键：宿主按 schema 拦截
 * 不合规的提交，故执行体**交不出**缺件的结论。
 *
 * ## ⚠️ 已登记的边界：提交层是**原子的**（2026-10-11 独立复核 M1）
 *
 * 宿主按本 schema 校验的是**一次工具调用提交的整个对象**。故未来两个任务并存时，
 * 「任务 A 的字段齐、任务 B 的字段缺」会使**整单被退回**——A 的结论**也**到不了
 * 落地层。这与 §10.2「任一任务失败不使其余任务失效」**不冲突**，但两者管的是
 * 不同层，必须分清：
 *
 *   · **提交层**（本 schema）：结论**尚未到达**。缺件时子代理收到宿主的校验错误，
 *     可**改正后再提交**（可自纠）。若它最终没交出合规对象，则全部任务都无从校验
 *     ——此时不存在「A 已成立而 B 缺失」的状态。
 *   · **落地层**（`validateCompositeOutput` + 各任务落地路径）：结论**已经到达**。
 *     此层的承诺是逐任务独立——A 校验不过不使 B 失效。这才是 §10.2 所管的那一层。
 *
 * **不得**据本条认为「一次做多件」已天然具备逐任务容错：容错在落地层实现，提交层
 * 的一次性退回是可自纠的，不是缺陷。若将来要放宽（如允许部分提交），须同时改
 * 宿主契约与本条注释，不得只改其一。
 *
 * @param {string[]} tasks - 任务键（有序）。
 * @param {Record<string, {schema: () => object}>} registry - 登记表。
 * @returns {object} 复合 schema（宿主支持的 JSON Schema 子集内）。
 */
export function compositeOutputSchema(tasks = [], registry = AUX_TASK_REGISTRY) {
  const properties = {};
  const required = [];
  for (const key of tasks) {
    const entry = registry[key];
    if (entry === undefined) throw new Error(`unknown aux task "${key}" (不在登记表内)`);
    if (typeof entry.outputSchema !== "function") {
      throw new Error(`aux task "${key}" is enabled but has no output schema (未实现的任务不得进入派发) `);
    }
    properties[compositePropertyName(key)] = entry.outputSchema();
    required.push(compositePropertyName(key));
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * 逐任务校验复合结论——**每任务独立收口**，任一失败不影响其它（本模块的核心纪律）。
 *
 * 返回：
 *   - `results`：`{ [taskKey]: { ok: true, value } | { ok: false, error } }`——
 *     **键齐全**：即使某任务的字段在结构化输出里整体缺失，也要为它产出一条
 *     `ok:false`（否则「它没答」会退化为「这次运行没它」，二者处置不同）。
 *   - `okCount` / `failCount`：便于调用方如实记账（部分成功是合法结果）。
 *
 * **不因部分失败而整体失败**：§8.4 的闭集动作按任务分别成立，某任务校验不过时
 * 其余任务的结论仍然成立、仍须落地。整体失败会使一次可用的运行被整条丢弃。
 *
 * @param {object} structured - 子代理提交的复合结论。
 * @param {{tasks: string[], registry?: object, contexts?: Record<string, object>}} input
 */
export function validateCompositeOutput(structured, { tasks = [], registry = AUX_TASK_REGISTRY, contexts = {} } = {}) {
  const results = {};
  let okCount = 0;
  let failCount = 0;
  for (const key of tasks) {
    const entry = registry[key];
    if (entry === undefined || typeof entry.validate !== "function") {
      results[key] = {
        ok: false,
        error: { code: "aux_task/not_implemented", message: `aux task "${key}" has no validate step` },
      };
      failCount += 1;
      continue;
    }
    const slice = structured?.[compositePropertyName(key)];
    let outcome;
    try {
      outcome = entry.validate(slice, { ...(contexts[key] ?? {}), taskKey: key });
    } catch (error) {
      // 校验器抛错按该任务失败收口（不得让一个任务的异常掀掉其余任务的结论）。
      outcome = {
        ok: false,
        error: { code: "aux_task/validate_threw", message: `validator for "${key}" threw: ${String(error?.message ?? error)}` },
      };
    }
    results[key] = outcome;
    if (outcome?.ok === true) okCount += 1;
    else failCount += 1;
  }
  return { results, okCount, failCount };
}

/**
 * 任务的登记表。
 *
 * `implemented` 是本表的**唯一权威**：调用方据它决定「拼接进提示词」还是
 * 「记一条未实现」。**不得**用「有没有 outputSchema」之类间接信号判断——那会
 * 使登记不完整（有 schema 没有 validate）被误判为已实现。
 *
 * `capacity-maintenance` 与 `memory-health` 的能力本体尚未实现（`specs/32`
 * §10.4/§10.5 的容量整理与四失败模式体检都没有代码）。它们**在册但未实现**：
 * 设置面可以勾选，但派发时不拼接、不派发，调用方记 `not-implemented` 痕迹。
 * 这是 §8.5 条件式要求的机械形态——不得主张空闲维护已运行。
 */
export const AUX_TASK_REGISTRY = Object.freeze({
  [FRICTION_DISCOVERY_KEY]: Object.freeze({
    key: FRICTION_DISCOVERY_KEY,
    implemented: true,
    // 三个部位的正文由契约/落地模块提供——本表只**引用**，不复制。
    // 复制会使同一段规则有两份文本，一改两处必漂移（04 §14 第 6 条同理）。
    promptSection: buildDiscoveryPromptSection,
    outputSchema: discoveryOutputSchema,
    validate: (slice, ctx) => validateDiscoveryVerdict(slice, {
      candidates: ctx?.candidates ?? [],
      // 2026-10 修订：观察层的判定需要知道「缓冲里已有哪些组」——否则子代理
      // 无法把本次观察并入既有组，聚合永远到不了 N（11 §9 第 1、3 项）。
      observationGroups: ctx?.observationGroups ?? [],
      windowText: ctx?.windowText ?? null,
    }),
  }),
  [EXPERIENCE_CAPTURE_KEY]: Object.freeze({
    key: EXPERIENCE_CAPTURE_KEY,
    implemented: true,
    // 与摩擦侧同构：三部位正文由契约模块提供，本表只**引用**、不复制。
    //
    // **捕获段（11 §10.1）**：本任务现在只判「有没有失败发生过」并写一条留观
    // 缓冲条目，不判重复、不产正文。故 `validate` 不再接收既有 Pitfall 列表
    // （查重已移审核段 §10.2 第 2 项），只留引证核对所需的 `windowText`。
    promptSection: buildCapturePromptSection,
    outputSchema: captureOutputSchema,
    validate: (slice, ctx) => validateCaptureVerdict(slice, {
      windowText: ctx?.windowText ?? null,
    }),
  }),
  // 以下两个**在册但未实现**：能力本体（容量整理、四失败模式体检）没有代码。
  // 它们没有 promptSection / outputSchema / validate 三部位——这正是「未实现」
  // 的机械含义，`implemented: false` 与之互为印证（`splitRunnableTasks` 按本
  // 字段分派，不靠「有没有 schema」这类间接信号）。
  "capacity-maintenance": Object.freeze({
    key: "capacity-maintenance",
    implemented: false,
  }),
  "memory-health": Object.freeze({
    key: "memory-health",
    implemented: false,
  }),
});

/**
 * 取本次**真正可派发**的任务：已启用 ∩ 已实现。
 *
 * 返回 `{ runnable, unimplemented }` 两半——**两半都必须被消费**：
 * `runnable` 决定提示词与 schema，`unimplemented` 让调用方如实记一条痕迹。
 * 只返回 `runnable` 会使「已启用但未实现」在痕迹里彻底消失（§8.5 禁止）。
 *
 * @param {string[]} tasks - 已启用的任务键（有序）。
 * @param {object} registry - 登记表。
 */
export function splitRunnableTasks(tasks = [], registry = AUX_TASK_REGISTRY) {
  const runnable = [];
  const unimplemented = [];
  for (const key of tasks) {
    const entry = registry[key];
    if (entry?.implemented === true) runnable.push(key);
    else unimplemented.push(key);
  }
  return { runnable, unimplemented };
}
