/**
 * dsh-ldvh — 提请文本机械校验（与「何时提请」完全正交）。
 *
 * Human 2026-11-14 决定：
 *   「请求时只有 Title、<200 字、没有细节。不合格 → 拒绝（fail-closed、让调用方重发）。
 *     收到 LDVH 管辖的都要拦。」
 *
 * 本模块只校验**提请发出去的那段文本**，不读任何开关、不读留痕、不解析答复、
 * 不判定「这次该不该问」。它是一块纯函数式的机械校验，挂在两个提交通道：
 *
 *   1. `tools.guard` —— 管辖会话里模型面裸调宿主 `ask_user_question` 的工具调用；
 *   2. `seams.ask`   —— 经 `ctx.userQuestions.ask` 服务发出的所有提请。
 *
 * 两个口都必须挂：只挂一个就是「约束绑单入口致漏检」（pitfall-a5c34ca3 同构）。
 *
 * ## 为什么判「只有 question」而不是「≤200 且无 detail」
 *
 * `detail` 是宿主契约里的 optional 字段；但 Human 的要求是**只有 Title**，即
 * 提请面除一行动作标题外不得再携带任何呈报细节。故校验取**字段闭集**：
 * 每题允许的键只有 `id / question / header / options / multi_select`（timed 版
 * 多一个 `timeout` 在请求根层，不在此题内），其中承载文本的只有 `question`。
 * 多出 `detail`（或任何细节字段）即拒绝，而不是「丢弃后放行」——宿主
 * `questionRequest` 会静默丢弃未声明字段（参数项 `additionalProperties: true`），
 * 那种「吞掉」不构成审核（friction-a06313da，occurrenceCount=6）。
 *
 * ## 不合格处置
 *
 * 一律 **fail-closed 拒绝**：返回带原因的结果，由调用方重发合格文本。
 * 绝不截断、不改写、不加省略号——那会悄悄改掉 Human 该看的字，且让
 * 「不合格」这件事在记录里不可见。
 *
 * ## 计量口径
 *
 * 与仓内既有 200 字符上界一致：`String.prototype.length`（UTF-16 码元），
 * 不是码点数。全 emoji 标题按码点数「看起来 200」时 `.length` 可达 366，
 * 用码点计会让上界在最可能遇到的中文/emoji 文本上静默失效。
 */
// 常量定义在本模块（而非 host-seams.js），因为 host-seams.js 会 import 本模块；
// 反向 import 会形成 ESM 循环依赖。host-seams.js 以 ASK_QUESTION_MAX_CHARS
// re-export 本常量，使既有消费者（含测试）的导入点不变。
export const ASK_TEXT_MAX_CHARS = 200;

/** 单道题允许出现的字段闭集（承载文本的只有 `question`）。 */
const ALLOWED_QUESTION_KEYS = Object.freeze([
  "id", "question", "header", "options", "multi_select", "multiSelect",
]);

/** 根层允许的字段（timed 工具有 `timeout`；`questions` 与 `agent`/`signal` 由宿主装配侧加，不在校验面）。 */
const ALLOWED_ROOT_KEYS = Object.freeze(["questions", "timeout", "signal", "agent", "wait"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 校验一份提请请求的文本形状。
 *
 * @param {unknown} request - 宿主 `ctx.userQuestions.ask` 的请求，或
 *   `ask_user_question` 工具的 `arguments.questions` 所在的整个对象。
 * @returns {{ok: true} | {ok: false, reason: string}}
 *   ok=false 即须拒绝该提请；reason 为可直接回给调用方的中文原因。
 */
export function validateAskText(request) {
  if (!isPlainObject(request)) {
    return { ok: false, reason: "提请请求必须是对象" };
  }
  // 根层出现细节字段（detail/report/summary/…）一律拒绝。
  for (const key of Object.keys(request)) {
    if (!ALLOWED_ROOT_KEYS.includes(key)) {
      return { ok: false, reason: `提请根层出现未允许的字段 ${JSON.stringify(key)}：只承载一行动作标题，不得携带呈报细节` };
    }
  }
  const questions = request.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, reason: "提请必须含至少一道问题（questions 非空数组）" };
  }
  for (let index = 0; index < questions.length; index += 1) {
    const item = questions[index];
    if (!isPlainObject(item)) {
      return { ok: false, reason: `第 ${index + 1} 题不是对象` };
    }
    for (const key of Object.keys(item)) {
      if (!ALLOWED_QUESTION_KEYS.includes(key)) {
        return { ok: false, reason: `第 ${index + 1} 题出现未允许的字段 ${JSON.stringify(key)}：只承载一行动作标题，不得携带 detail 或其它呈报细节` };
      }
    }
    if (typeof item.question !== "string" || item.question.trim().length === 0) {
      return { ok: false, reason: `第 ${index + 1} 题缺少非空 question（Title）` };
    }
    if (item.question.length > ASK_TEXT_MAX_CHARS) {
      return { ok: false, reason: `第 ${index + 1} 题 question 为 ${item.question.length} 字符，超出 ${ASK_TEXT_MAX_CHARS} 字符上限；请重写为更短的标题后重发（不会截断，也不会改写）` };
    }
    // options 的 label 也是呈给 Human 的文本，但属「选项」而非 Title；
    // Human 的要求只约束 Title。这里仅校验 options 形状，不把它的长度算进 Title。
    if (item.options !== undefined) {
      if (!Array.isArray(item.options)) {
        return { ok: false, reason: `第 ${index + 1} 题 options 不是数组` };
      }
      for (let oi = 0; oi < item.options.length; oi += 1) {
        const opt = item.options[oi];
        if (!isPlainObject(opt) || typeof opt.label !== "string") {
          return { ok: false, reason: `第 ${index + 1} 题第 ${oi + 1} 个选项缺少 label` };
        }
        // 选项对象里同样不允许塞 detail 之外的呈报字段（description 是宿主契约允许的）。
        for (const key of Object.keys(opt)) {
          if (!["label", "description"].includes(key)) {
            return { ok: false, reason: `第 ${index + 1} 题第 ${oi + 1} 个选项出现未允许的字段 ${JSON.stringify(key)}` };
          }
        }
      }
    }
  }
  return { ok: true };
}

/**
 * 把校验结果转成 tools.guard 的拒绝理由（返回字符串即拒绝，见 host-seams.js 的
 * installToolsGuard 注疏；契约 `ToolGuard = (execution) => string | undefined`）。
 * 合格返回 undefined（放行），不合格返回原因字符串。
 */
export function askTextDenial(request) {
  const result = validateAskText(request);
  return result.ok ? undefined : `LDVH 提请文本校验未通过（fail-closed，请重写后重发）：${result.reason}`;
}
