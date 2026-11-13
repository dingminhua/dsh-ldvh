/**
 * dsh-ldvh — 两处把关询问：复杂任务判定 + 询问 + 答复留痕。
 *
 * ## 这是什么（Human 2026-11-13 决定）
 *
 * 保留两项把关：**行动前审核**与**行动后复核**，落地方式为**两处询问**：
 *
 *   1. 主控判定当次任务属「复杂任务」、且 `preActionReviewAskEnabled` 打开时，
 *      动手前询问 Human「是否安排代理审查」；
 *   2. 主控判定一件复杂任务做完、且 `postWorkReviewAskEnabled` 打开时，
 *      收口前询问 Human「是否安排代理复核」。
 *
 * **开关不开就没有这两处询问**——这是 Human 的原话「打开才有，否则就是不安排
 * 审核与复核」。
 *
 * ## 静默执行（2026-11-13 晚 Human 确认 A1）
 *
 * 两处询问之上还有一枚**执行档位**开关 `reviewAskSilentRunEnabled`：打开后
 * 判为复杂任务时**不问，直接按设置安排**那次核对。它不是第三处把关，也不
 * 越过各自的询问开关（关着的那一处静默没有作用对象）。免掉的是**询问**，
 * 不是**核对**——故它仍产出派发模板，并要求在交付里留痕迹（`silentRunNotice`）。
 *
 * ## 判据从哪来（不新造）
 *
 * 「复杂任务」的判据**不新增**，但两处来源的**性质不同**（2026-11-13 更正）：
 *
 * - `specs/04 §6.1`：工作指向「怎么做」层面的方案时——**建立或修改结构性事物**、
 *   **存在多个可选路径的选型**、**方向可能与既定决策冲突**；
 * - `specs/04 §6.1` 排除五条（取反）：方向未定（归 Spark）、当次可直接处理的
 *   低风险改动（不对象化）、已定决策（归 ADR）、系统性阻碍（归 Friction）
 *   ——**取反即「属于复杂任务」**。
 *
 * 本模块把这两处编译成一份**可读的判据清单**交给主控（用于判断），并**不机械
 * 判定**——本模块只做「开关读值 + 询问 + 留痕」，复杂度判定属 AI 语义判断。
 *
 * ## 如实声明边界（00 §4.6，不得省写）
 *
 * **本模块提供的不是机械保障，是「AI 按开关执行的自律 + 询问留痕」。**
 *
 * 具体说：
 *
 * - 「这次任务算不算复杂」由**主控判断**，机械层不判定。判错了、或主控压根没
 *   判，本模块不会拦——它只在主控**调用**时工作。
 * - 询问走宿主 `ctx.userQuestions.ask`（与既有路由询问同一入口），答复由
 *   宿主记录；但**「主控有没有真的来问」机械层不知道**。这与既有覆盖闸
 *   那种「没写记录就拒绝写入」不同：那里有一道闸读记录，这里没有闸。
 * - 因此**不得**把本模块的实现表述为「审查/复核已获机械保障」。它保障的只有
 *   两件事：开关真的决定问不问（读了就算数）、问过的答复可回读（不留痕重问）。
 *
 * ## 为什么答复要留痕（复用既有先例的教训，不是新发明）
 *
 * 同目录的路由答复账目记录了两个**实测**失效：
 *
 *   1. **重试必重问**——答复只在内存里被消费一次，写入失败后重试无处可读，
 *      只能再问一次；
 *   2. **事实不可回读**——宿主询问走 waterfall，**不进入会话事件流**，事后无法
 *      从任何权威记录回答「问过没有、答了什么」。实测后果是主控误判「询问未
 *      发生」，在工具之外补问了一次。
 *
 * 这两条对两处新询问**同样成立**（同一入口、同一失效面），故复用同一形态：
 * 按内容指纹记答复，位于 `~/.dsh/ldvh/`，**不进事实源、不构成授权凭据**。
 *
 * ## 载体与既有答复账目的关系
 *
 * 不复用既有的路由答复账目——那个载体的键闭集语义已定，把 `review|skip` 塞进去
 * 会污染它。故**另立一个同目录、同形态的文件** `review-ask-decisions.json`。两者
 * 同属「辅助机制的运行状态」，都不进事实源。
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

/** DSH home 下的相对位置（与 route ledger、水位、待处置队列同层）。 */
const LEDGER_RELATIVE_PATH = ["ldvh", "review-ask-decisions.json"];

/** 环形保留上限（与 route ledger 的 50 同量级：询问是低频事件）。 */
const MAX_ENTRIES = 50;

/**
 * 把关询问行的折叠标签（宿主渲染格式：`上下文注入 · <插件名> · <本标签>`）。
 *
 * **单一来源**（2026-11-13 独立审核 MINOR #7）：此前 guidance.js 与
 * lifecycle.js 各写一遍同一字符串，靠 client-contract.test.mjs 的正则比两处
 * 源码文本保持一致——那不是单一来源，是「两份副本 + 一条断言盯着它们别跑偏」。
 * 本常量落在 review-ask.js（两处都已 import 它），改动只需改这一处。
 *
 * **不带插件名**：宿主已经填了 `dsh-ldvh`，再写一遍会渲染成
 * 「上下文注入 · dsh-ldvh · 把关询问 · dsh-ldvh · …」。
 */
export const REVIEW_ASK_ROW_SUMMARY = "把关询问 · 待你决定是否安排代理";

/**
 * task 缺失时的退化占位词。
 *
 * **它与 null 同义**（2026-11-13 独立审核 MAJOR-2）：占位词会被写进载体，若
 * 复用门只看「task 非空」，占位词记录会被判为「可复用」——模型传恒定字符串时
 * 静默复用复发，那条修复等于没做。故读取侧须把它也视同 null。
 */
export const REVIEW_ASK_PLACEHOLDER_TASK = "当次任务";

/** 两处询问的位置闭集。 */
export const REVIEW_ASK_POINTS = Object.freeze({
  PRE_ACTION: "pre-action",
  POST_WORK: "post-work",
});

/** 答复闭集：问过就算数，`skip` 是一个**明确的答复**，不是「没答」。 */
export const REVIEW_ASK_ANSWERS = Object.freeze({
  REVIEW: "review",
  SKIP: "skip",
});

/**
 * 「复杂任务」的判据清单（供主控判断，非机械判定）。
 *
 * 每条都标出处，使主控能回指到规范原文而不是记住一句话。**清单本身不新增
 * 判据**——它是 04 §6.1 两处既有条文的编译产物。
 */
export const COMPLEXITY_CRITERIA = Object.freeze([
  {
    key: "structural-change",
    label: "建立或修改结构性事物",
    source: "specs/04 §6.1",
  },
  {
    key: "multi-path-choice",
    label: "存在多个可选路径的选型",
    source: "specs/04 §6.1",
  },
  {
    key: "decision-conflict",
    label: "方向可能与既定决策冲突",
    source: "specs/04 §6.1",
  },
  {
    key: "not-clearly-direct",
    // **是五条，不是四条**（逐条核对 `specs/04 §6.1` 原文时发现）。
    //
    // 原文：「以下内容不形成复杂任务：方向未定、尚无可执行方案的议题（归 Spark）；
    // 当次行动可直接处理且不需跨会话保留的低风险改动（不对象化）；已定决策的表达
    // （归 ADR）；需要持续跟踪的系统性阻碍（归 26 号 Friction）；**过程日志、逐条
    // 聊天、工具输出与单纯执行提醒**。」
    //
    // 第五条此前被漏掉——而它在**任务请示系统**下恰恰最相关：「单纯执行提醒」
    // 不该触发请示，「过程日志、逐条聊天、工具输出」更不该。漏掉的直接后果是
    // 主控可能把「一条执行提醒」判成复杂任务而去请示 Human。
    label: "不属于 §6.3 五条排除项（方向未定／当次可直接处理的低风险改动／已定决策／系统性阻碍／过程日志与工具输出与单纯执行提醒）",
    source: "specs/04 §6.1 排除五条取反",
  },
]);

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function success(value) {
  return { ok: true, value };
}

/**
 * 从 volatile 引用或普通值读一个布尔开关（与 index.js 的 readSwitch 同语义）。
 *
 * **不在这里写默认值**：默认值由 schema 的 `.default(false)` 承载，本函数只在
 * 取不到值时如实返回 `undefined`，由调用方决定怎么处置——静默兜底会让「Human
 * 显式关掉」与「配置没读到」不可区分（本仓既有失效形态，见 idle-settings.js）。
 */
function readSwitchValue(value) {
  const raw = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  if (raw === undefined || raw === null) return undefined;
  // **只认布尔真值**（2026-11-13 自查所修）。
  //
  // 原实现是 `return raw !== false`——把任何非 false 的东西都当成开启。实测
  // `"false"`、`0`、`""` 全部解析为 **true**。这条路径通向「询问 Human」，
  // 所以方向必须偏保守：**不确定就当关**。
  //
  // 为什么这个方向的错误更危险：默认关闭是 Human 明确的期望（「关着就完全不问」）。
  // 一旦配置面传进来非布尔值（profile 手写成 `"false"` 字符串、或某个中间层
  // 做了字符串化），`raw !== false` 会让它**无故开启**——Human 没打开过开关，
  // 却被问了。反过来（把 `1` 当成关）只会少问一次，代价小得多。
  //
  // 取 `=== true` 也顺手消掉一个陷阱：`new Boolean(false)` 这类对象在
  // `!== false` 下为真，在 `=== true` 下为假。
  return raw === true;
}

/**
 * 读出两处询问的当前开关状态。
 *
 * @param {object|null} config - 本插件的 Cordis Config。
 * @returns {{preAction: boolean, postWork: boolean, preActionKnown: boolean, postWorkKnown: boolean,
 *   silentRun: boolean, silentRunKnown: boolean}}
 *   `silentRun` 是**执行档位**（不问直接做）而非第三处把关，见 index.js 的 schema 注释。
 */
export function resolveReviewAskSettings(config) {
  const pre = readSwitchValue(config?.preActionReviewAskEnabled);
  const post = readSwitchValue(config?.postWorkReviewAskEnabled);
  const silent = readSwitchValue(config?.reviewAskSilentRunEnabled);
  return {
    // 未设置时按「关」——与 schema 默认一致；但**另带 known 标记**，使消费方
    // 能区分「Human 关掉了」与「配置面取不到」（后者应如实报告，不假装是关）。
    preAction: pre === true,
    postWork: post === true,
    preActionKnown: pre !== undefined,
    postWorkKnown: post !== undefined,
    // 静默执行（2026-11-13 晚 Human 确认 A1）：**只作用在「已判定为复杂任务」
    // 之后的询问环节**，不影响任何 Human Gate。
    silentRun: silent === true,
    silentRunKnown: silent !== undefined,
  };
}

/**
 * 该位置在执行档位上是「问」还是「静默」。
 *
 * 返回三态而非布尔——**「静默执行目标位置不存在」与「静默执行」是两回事**：
 *
 * - `{ mode: "ask" }`：对应询问开关开着、静默关 → 照旧问 Human；
 * - `{ mode: "silent" }`：对应询问开关开着、静默开 → **不问**，直接安排那次核对；
 * - `{ mode: "off" }`：对应询问开关关着 → 不问也不安排。
 *
 * **静默不越过询问开关**（这是本函数唯一的判断）：`preActionReviewAskEnabled`
 * 关着时，即使静默开着也不派代理——关掉询问开关的语义是「这一处不必有人盯着」，
 * 若静默能越过它，关开关就失去了「省掉这次核对」的意思。Human 原话是
 * 「打开后才自动执行而不请示」：**静默是询问的替代形态，不是询问的取消**。
 *
 * @param {object|null} settings - `resolveReviewAskSettings` 的返回值
 * @param {"pre-action"|"post-work"} point
 * @returns {{mode: "ask"|"silent"|"off", point: string|null, silentUnknown: boolean}}
 */
export function reviewAskMode(settings, point) {
  const enabled = askEnabledFor(settings, point);
  if (!enabled) return { mode: "off", point: point ?? null, silentUnknown: false };
  // **「静默开关取不到」必须在这里被真正处理**（2026-11-13 独立复核 MAJOR-4）。
  //
  // 原实现只在 `silentRun === true` 且 `silentRunKnown === false` 时标记
  // `silentUnknown`——而真实读取器里 `silentRun = silent === true`、
  // `silentRunKnown = silent !== undefined`，**该组合不可能出现**：那个分支
  // 是死代码，两条测试却在手工构造它并互相矛盾。
  //
  // 真实的「取不到」是 `silentRunKnown === false`（配置里没有这个键）——
  // 它现在落进 `ask` 分支，即**照旧询问**。这不是缺陷，是保守选择，但必须
  // **如实报告**：否则配了静默却没生效时，Human 看不出「开关没被读到」与
  // 「我关掉了」的区别（本仓既有失效形态）。
  if (settings?.silentRunKnown === false) {
    return { mode: "ask", point, silentUnknown: true };
  }
  if (settings?.silentRun === true) return { mode: "silent", point, silentUnknown: false };
  return { mode: "ask", point, silentUnknown: false };
}

/**
 * 静默执行的**痕迹行**（00 §4.6 据实声明；11 §6.2 对「无痕抑制」的同源纪律）。
 *
 * 「静默」指的是**不问**，不是**不留痕**。这两件事必须分开：一次静默执行若在
 * 交付里什么都不说，Human 事后无从判断「这轮到底派没派代理、为什么没问他」，
 * 那与本仓反复否定的「无痕迹的抑制」是同一类缺陷。
 *
 * 故每次静默执行须原样引用本函数产出的这一行（而不是「说一句大概」）——
 * 固定的形态使它在交付里可被辨识、可被核对。
 */
export function silentRunNotice({ point, task } = {}) {
  const what = point === REVIEW_ASK_POINTS.PRE_ACTION ? "行动前审查" : "收口前复核";
  const subject = typeof task === "string" && task.trim().length > 0 ? task.trim() : "当次任务";
  // **时态须如实**（独立复核 MINOR-9）：产出这一行时工具只返回了派发模板，
  // 代理**尚未派出**。写「已安排」会把一件还没发生的事说成已发生——
  // 故写「将按此安排」，由主控派发后在交付里回报结果。
  return `【静默执行】${what}：已按设置跳过询问，将按返回的模板安排一次零上下文代理核对（${subject}）。此为执行痕迹，不构成授权凭据，也不代表核对已完成。`;
}


/** 该位置对应的开关是否打开。未知位置返回 false（不猜）。 */
export function askEnabledFor(settings, point) {
  if (point === REVIEW_ASK_POINTS.PRE_ACTION) return settings?.preAction === true;
  if (point === REVIEW_ASK_POINTS.POST_WORK) return settings?.postWork === true;
  return false;
}

/**
 * 候选内容指纹——决定「这是不是同一件事」的唯一依据。
 *
 * 稳定输入（位置 + 任务描述 + 范围）排序后取 SHA-256：同一件事重试时指纹相同，
 * 于是既有答复被复用、不重问；内容一变指纹即变，须重新询问。
 */
export function reviewAskFingerprint({ point, task, scope }) {
  const payload = [
    point === undefined ? "" : String(point),
    task === undefined ? "" : String(task),
    scope === undefined ? "" : String(scope),
  ].join("\u0000");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function ledgerPath(dshHomePath) {
  if (typeof dshHomePath !== "function") return null;
  try {
    const resolved = dshHomePath(...LEDGER_RELATIVE_PATH);
    return typeof resolved === "string" && resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

async function readAll(dshHomePath) {
  const path = ledgerPath(dshHomePath);
  if (path === null) {
    return failure("review-ask/unavailable", "dshHomePath is not a callable home resolver (cannot locate the review-ask carrier)");
  }
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return success({ decisions: [] });
    return failure("review-ask/unreadable", `cannot read the review-ask carrier: ${String(error?.message ?? error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // 损坏**不按空处理**：把「读不出来」当成「没问过」会导致重复提问。
    return failure("review-ask/malformed", `the review-ask carrier is not valid JSON: ${String(error?.message ?? error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return failure("review-ask/malformed", "the review-ask carrier is not a JSON object");
  }
  if (!Array.isArray(parsed.decisions)) {
    return failure("review-ask/malformed", "the review-ask carrier carries no `decisions` array");
  }
  return success(parsed);
}

/**
 * 按指纹查既有答复。`value` 为对象即「问过且答过，直接复用」；为 null 即「未问过」。
 */
export async function findReviewAskDecision(dshHomePath, fingerprint) {
  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    return failure("review-ask/invalid_key", "fingerprint is required to look up a review-ask decision");
  }
  const doc = await readAll(dshHomePath);
  if (!doc.ok) return doc;
  let found = null;
  for (const entry of doc.value.decisions) {
    if (typeof entry !== "object" || entry === null) continue;
    if (entry.fingerprint === fingerprint) found = entry;
  }
  return success(found);
}

const ledgerQueues = new Map();

function serialize(key, task) {
  const previous = ledgerQueues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => {});
  ledgerQueues.set(key, tail);
  tail.then(() => {
    if (ledgerQueues.get(key) === tail) ledgerQueues.delete(key);
  });
  return run;
}

/**
 * 记录一条答复。
 *
 * **只有已确定的答复才允许入载体**：空答复是「未决策」，写成记录会让下一次误以为
 * 问过了而复用一个不存在的决定。
 */
export async function recordReviewAskDecision(dshHomePath, entry = {}) {
  try {
    return await recordReviewAskDecisionInner(dshHomePath, entry);
  } catch (error) {
    return failure("review-ask/unavailable", `review-ask recording threw: ${String(error?.message ?? error)}`);
  }
}

async function recordReviewAskDecisionInner(dshHomePath, entry) {
  const fingerprint = entry?.fingerprint;
  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    return failure("review-ask/invalid_entry", "fingerprint is required to record a review-ask decision");
  }
  const answer = entry?.answer;
  if (answer !== REVIEW_ASK_ANSWERS.REVIEW && answer !== REVIEW_ASK_ANSWERS.SKIP) {
    return failure("review-ask/invalid_entry", `answer must be "${REVIEW_ASK_ANSWERS.REVIEW}" or "${REVIEW_ASK_ANSWERS.SKIP}", got ${JSON.stringify(answer ?? null)}`);
  }
  const point = entry?.point;
  if (point !== REVIEW_ASK_POINTS.PRE_ACTION && point !== REVIEW_ASK_POINTS.POST_WORK) {
    return failure("review-ask/invalid_entry", `point must be "${REVIEW_ASK_POINTS.PRE_ACTION}" or "${REVIEW_ASK_POINTS.POST_WORK}", got ${JSON.stringify(point ?? null)}`);
  }
  const path = ledgerPath(dshHomePath);
  if (path === null) {
    return failure("review-ask/unavailable", "dshHomePath is not a callable home resolver (cannot locate the review-ask carrier)");
  }
  const at = typeof entry.at === "string" && entry.at.length > 0 ? entry.at : new Date().toISOString();
  const record = { fingerprint, point, answer, at };
  // 任务原话逐字保留（它是 Human 的），截断到 500 字符避免单条撑大载体——
  // 超出部分对「认出问的是哪件事」已无增益，完整原话仍在该次会话记录里。
  if (typeof entry.task === "string" && entry.task.trim().length > 0) {
    const text = entry.task.trim();
    record.task = text.length > 500 ? `${text.slice(0, 500)}…` : text;
  }

  await mkdir(dirname(path), { recursive: true });
  return serialize(path, async () => {
    const doc = await readAll(dshHomePath);
    if (!doc.ok) return doc;
    const decisions = doc.value.decisions.filter((item) => !(typeof item === "object" && item !== null && item.fingerprint === fingerprint));
    decisions.push(record);
    const trimmed = decisions.length > MAX_ENTRIES ? decisions.slice(decisions.length - MAX_ENTRIES) : decisions;
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ decisions: trimmed }, null, 2)}\n`, "utf8");
    await rename(tmp, path);
    return success(record);
  });
}

/**
 * 组装一次询问的呈报内容。
 *
 * **只产出 `question`，不产出 `detail`**（Human 2026-11-13，两次指认）：
 * ① 判据不进入对话框——判据是 AI 用来**决定要不要问**的输入，问出来时已经用过
 *    一次了；再摆给 Human，等于让他复核 AI 的推理，而不是回答那个待决问题。
 * ② detail 与紧随其后的两个选项说的是同一件事，卡片上于是三处重复。
 *
 * **为什么不把内容塞进 question**：宿主询问的标题区不可滚动，长内容会把选项挤出
 * 视野。2026-11-13 Human 决定的形态是：**弹窗只留一行标题（≤ 200 字），
 * 不带 detail**；需要 Human 一读再答的材料（判据、呈报正文）一律写在**对话
 * 正文**里，由主控在他作答之前给出。这条对 LDVH 自己的三处 consent 接缝同样
 * 成立（见 `host-seams.js` 的 `composeAskTitle`）。
 *
 * @returns {{question: string}} —— **无 detail 键**
 */
// **不接受 criteria 参数**（2026-11-13）：判据不再进入对话框，故没有理由让
// 调用方把它递进来。签名收紧即约束——留着可传的参数，早晚有人传。
export function composeReviewAsk({ point, task } = {}) {
  const isPre = point === REVIEW_ASK_POINTS.PRE_ACTION;
  const what = isPre ? "代理审查" : "代理复核";
  // **任务描述要短**（Human 2026-11-13：「只写要做什么」）。问题标题是 Human
  // 一眼扫过的那一行，写成长段落等于没写。超长时截断并加省略号——宁可让他
  // 看到「……」，也不要让标题挤成三行。
  //
  // 上限 60 字符：加上「——要不要安排代理审查？」（约 13 字）后仍在宿主
  // `ask_user_question` 的 200 字符限额内，且能在卡片里单行显示。
  // **占位词与空值同义**（2026-11-13 独立审核 MAJOR-2 的绕过口）。
  //
  // 「当次任务」是 task 缺失时的**退化占位**。但它同时被写进载体（task 字段），
  // 于是「历史记录的 task 非空」这一复用判据会被占位词骗过——模型若每次都传
  // 占位词（或任何恒定字符串），指纹退化成 point+scope，历史记录 task 非空 ⇒
  // 判「可复用」⇒ **静默复用复发**，MAJOR-2 等于没修。
  //
  // 故占位词在**两处**都要视同 null：此处（写入载体）与 host-seams.js 的复用门
  // （读取时判定）。单点修不够——只修写入侧则载体里不再有占位词，但只修读取侧
  // 则载体里的占位词记录仍会被判为「可复用」。
  const PLACEHOLDER_TASK = "当次任务";
  const rawTask = typeof task === "string" && task.trim().length > 0 ? task.trim() : PLACEHOLDER_TASK;
  // 注意：此处**不**归一化——占位词在卡片上显示为中性的「当次任务」是对的。
  // 归一化只发生在**载体与复用门**两侧（host-seams.js），因为那里判的是
  // 「这件事是什么」，而非「怎么显示」。
  const TASK_TITLE_MAX = 60;
  // **截断不得劈开代理对**（2026-11-13 独立审核 NIT #8）：`slice` 按 UTF-16 码元
  // 切，若第 60 位正好落在 emoji 的中间，会留下一个孤立高代理项，渲染成乱码。
  // host-seams.js 的 `clampHead` 是同一问题的同形处理；本路径不经过它，
  // 故就地补一步：若切点前一位是高代理项、切点处是低代理项，退一格再切。
  const cutAt = (text, max) => {
    if (text.length <= max) return text;
    let end = max;
    const prev = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
    return text.slice(0, end);
  };
  const taskTitle = rawTask.length > TASK_TITLE_MAX ? `${cutAt(rawTask, TASK_TITLE_MAX)}…` : rawTask;

  // ── 只写「要做什么」和「要不要审」（Human 2026-11-13 明确要求）──────────
  //
  // 原实现把整段判据清单（4 条，各带 specs 条目出处）塞进 `detail`，标题还写
  // 「是否安排代理审查（动手前）？」。Human 的实际反馈：「对话框里写的太啰嗦了，
  // 判据不用写，只写要做什么而是否需要审核」。
  //
  // **那不是措辞问题，是把两件事混进了一个呈报面**：
  //   - Human 的面要回答的是「这件事要不要找人挑错」——他需要知道**做什么**；
  //   - 判据是 AI 用来**决定要不要问**的，问出来之后已经用过一次了，
  //     再摆给 Human 是让他复核 AI 的推理，而不是回答那个待决问题。
  //
  // 故 `question` = 「<要做什么>——要不要安排<审查/复核>？」，**不出现任何判据
  // 条目与规范出处**。判据仍由 `COMPLEXITY_CRITERIA` 承载、供 AI 判定使用
  // （见 guidance 注入行），只是不再进入这个对话框。
  // 后果信息由**选项的 description** 承担（见 host-seams.js 的注册处）。
  const head = `${taskTitle}——要不要安排${what}？`;

  // **不产出 detail**（Human 2026-11-13，截图指认）。
  //
  // 原 detail 写「安排：……结论回来后再收口。跳过：本次不做独立把关，直接推进。」
  // ——与紧随其下的两个选项**说的是同一件事**，只是换了个说法。卡片上于是出现
  // 三处重复：detail 一段、选项一、选项二。
  //
  // 宿主契约里 `detail` 是 optional（`z.string().optional()`，缺省时卡片不渲染
  // 该块），故这里直接不产出该字段；后果信息改由**选项的 description** 承担
  // ——那才是 Human 实际会读的地方（选项就在答案输入框上方）。
  return { question: head };
}
