/**
 * dsh-ldvh — 闲时辅助「积累经验」**捕获段**的契约切片（11 §10.1 捕获段）.
 *
 * 权威：specs/11 §10.1（捕获段）与 §12bis（留观缓冲）；specs/23（Pitfall 事实类型）。
 *
 * ## 本模块与摩擦发现的契约模块（`friction-subagent-contract.js`）的分工
 *
 * 两者结构同形（提示词段 + 输出 schema + 落地前校验），但**产出不同**：摩擦发现
 * 产出 Friction 账目的判定（26 号），本模块产出一条**留观缓冲条目**（11 §12bis，
 * 不是事实对象）。11 §8 明文二者「产出不同对象，互不替代」，故本模块**不引用**
 * 摩擦侧的常量与校验——各任务的提示词段与输出字段必须**各自独立、互不引用**
 * （`aux-task-registry.js` 的三条纪律之一）。
 *
 * ## 本模块只做「捕获」，不做「审核」（11 §10 两段分工）
 *
 * 2026-10-20 起，经验积累由一段判断拆成两段（11 §10.1/§10.2）：
 *
 * - **捕获段（本模块）**：只判「有没有一个失败发生过」，产出一条缓冲条目。
 *   它**不判根因、不判解法、不判是否已解决、不判是否与既有经验重复**，
 *   也**不创建任何 Pitfall**（任何状态）。失效方向是「漏记」而不是「多记」。
 * - **审核段（`observation-review.js`）**：读缓冲条目，查重、按其成文建 `draft`。
 *   七段结构校验（`REQUIRED_BODY_SECTIONS` / `validateCaptureBody`）留在本模块
 *   导出，供审核段复用——**七段是候选正文的契约，不是捕获段的契约**；本模块
 *   自己不调用它们，捕获段的输出里没有正文。
 *
 * 四前提（失败已发生／根因已查明／解决已采用／验证已有观察）自 2026-10-20 起
 * 是 `draft → active` 的前置（23 §10、§16.1），**不是捕获段的判据**——捕获段
 * 只判第一项「失败发生过」。
 *
 * ## 机械通道的边界
 *
 * 捕获段的机械通道**仅限写入一条缓冲条目**（11 §10.1 第 2 项）。写缓冲不产生
 * 任何事实对象、不进入事实源、不取得授权或结论效力（11 §12bis 定性）。故本模块
 * 的输出**只能**表达「观察到一次失败现象」或「没有观察到」，不能表达任何
 * 「该不该记／是不是重复／影响多大」的判断。
 */

import { verifyQuotation } from "./friction-window.js";

/**
 * 本任务在复合输出里的那片判定态（闭集两值）。
 *
 * - `failure-observed`：本次材料里有**一次失败发生过**，写一条缓冲条目；
 * - `no-failure`：本次材料里没有失败现象（含材料为空）。
 *
 * 两者都不表达「这是不是同一个已知机制」——查重在审核段（11 §10.2 第 2 项）。
 */
export const CAPTURE_VERDICTS = Object.freeze(["failure-observed", "no-failure"]);

/**
 * 候选正文固定七段（23 §8）。**审核段**使用；捕获段不产出正文。
 *
 * 保留在本模块导出是为了让「候选正文的结构契约」只有一处定义（06 §6 单一实现）。
 */
export const REQUIRED_BODY_SECTIONS = Object.freeze([
  "症状", "触发条件", "根因", "解决", "规避", "验证", "影响与适用范围",
]);

/**
 * 缓冲条目字段的长度上限（与 11 §12bis 的实现侧承接一致，见 `observation-buffer.js`）。
 *
 * `evidence` 的 3000 低于载体字段的 4000：载体上的 `evidence` 是「逐字片段 +
 * 换行 + 来源引用」的合成串，3000 + 256 仍留有余量，故不会出现「本层通过、
 * 落缓冲时才因总长越界被拒」的两处判据不一致。
 */
export const CAPTURE_MAX_PHENOMENON_LENGTH = 400;
export const CAPTURE_MAX_EVIDENCE_LENGTH = 3000;
export const CAPTURE_MAX_QUESTION_LENGTH = 400;
export const CAPTURE_MAX_SOURCE_LENGTH = 256;

/**
 * 给子代理的结构化输出 schema（本任务在复合 schema 里的那一片）。
 *
 * 形状约束与摩擦侧一致：只用宿主支持的 JSON Schema 子集（type / properties /
 * required / additionalProperties / enum / description），两态各自的必填字段
 * 用 `description` 说明 + 落地前校验承载。
 */
export function captureOutputSchema() {
  return {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: [...CAPTURE_VERDICTS],
        description:
          "两态之一：failure-observed=本次材料里**有一个失败实际发生过**，写一条留观缓冲条目；no-failure=本次材料里没有失败现象。**不要**判根因、解法、是否已解决、是否与既有经验重复——那是审核段的事，判了也不被采信。",
      },
      phenomenon: {
        type: "string",
        description:
          "verdict=failure-observed 时必填：观察到的现象，**一句话**，**是描述不是结论**（写「X 在 Y 条件下返回了空结果」，不写「这是缓存失效类的 bug」）。其余态填空字符串。",
      },
      evidence: {
        type: "string",
        description:
          "verdict=failure-observed 时必填：**逐字引证片段**——从本次观察材料里原样摘出的最小原文跨度（不得转述、不得概括、不得拼接多段），且 `quote` 必须是它的子串。其余态填空字符串。",
      },
      source: {
        type: "string",
        description:
          "verdict=failure-observed 时必填：该片段的来源引用（会话 id + 位置 / 文件:行 / 命令与输出的引文）。它使审核段能回指原始位置。其余态填空字符串。",
      },
      candidate_question: {
        type: "string",
        description:
          "verdict=failure-observed 时必填：一句话，指向「这是什么机制」——留给审核段的问题，**不是**候选正文、**不是**解法建议。其余态填空字符串。",
      },
      quote: {
        type: "string",
        description:
          "材料非空时必填：**逐字**引自本次观察材料的原文（不得改写、不得取自材料外的其它上下文）。no-failure 在非空材料下同样必填——否则「恒报无失败」与「确实没失败」无从区分。材料为空时填空字符串。",
      },
      reason: {
        type: "string",
        description: "必填：本次判断的理由，须回指本次材料（不得凭你可见的其他上下文）。",
      },
    },
    required: ["verdict", "quote", "reason"],
    additionalProperties: false,
  };
}

/**
 * 本任务的提示词段——**必须自足**：说明本任务要判断什么、输出什么字段。
 *
 * 本段**不再携带既有 Pitfall 列表**：查重已移入审核段（11 §10.2 第 2 项、23 §6.2），
 * 捕获段拿到既有对象只会诱使它做「是重复吗」的判断——那正是 §10.1 禁止的事。
 *
 * @param {{existing?: Array<object>}} _ctx - 兼容 provider 的统一拼段调用；本段忽略。
 */
export function buildCapturePromptSection(_ctx = {}) {
  return [
    "**要判断的事情**：本次观察材料里，**有没有一个失败发生过**。只判这一件事。",
    "",
    "**你不做的事**：不判根因、不判解法、不判是否已解决、不判影响多大、"
    + "**不判这是不是与既有经验重复**（重复判断在审核段）。你也不创建任何经验对象——"
    + "你只写一条**留观缓冲条目**，它还不是事实、不会被当作经验使用。",
    "",
    "**宁可多记，不可漏记**：可疑但不确定的失败现象**也要记**。禁止因为「觉得这条没用」"
    + "「大概是噪音」而不记——本段的失效方向被限定为漏记，漏记无法在下游被补救。",
    "",
    "**两态**：",
    "- `failure-observed`：材料中有一个失败实际发生过 → 填 `phenomenon`／`evidence`／`source`／`candidate_question`。",
    "- `no-failure`：材料中没有失败现象 → 上述四个字段填空字符串。",
    "",
    "**字段的硬要求**：",
    "- `phenomenon`：**一句话**，描述现象而不是下结论（「请求返回 500」而不是「接口有 bug」）。",
    "- `evidence`：**逐字**从材料摘出的最小跨度——不改写、不概括、不拼接多段；附来源引用写进 `source`。",
    "- `source`：会话 id + 位置 / 文件:行 / 命令与输出的引文。它使审核段能回指原始位置。",
    "- `candidate_question`：一句话指向「这是什么机制」，不是候选正文、不是解法建议。",
    "- `quote`：**逐字**引自本次材料的原文（≥8 个字，连 Markdown 标记一并复制）。"
    + "材料非空时两态都必须填——否则「恒报无失败」与「确实没失败」无法区分。",
    "",
    "**你要输出的字段**：`verdict`、`phenomenon`、`evidence`、`source`、"
    + "`candidate_question`、`quote`、`reason`。逐条说明见输出 schema。",
  ].join("\n");
}

/** 一句话判定（只数句末标点与换行，先剥引号内内容；不做语义判断）。 */
function isOneSentence(text) {
  const stripped = String(text ?? "").replace(/「[^」]*」|“[^”]*”|『[^』]*』|"[^"]*"|'[^']*'/g, "X");
  const marks = stripped.match(/[。！？!?]|\n/g) ?? [];
  return marks.length <= 1;
}

/**
 * 落地前的**跨字段校验**（宿主支持的 schema 子集表达不了条件约束）。
 *
 * 与落地侧共用同一份判据。校验通过**不等于**该现象会成立为经验候选——那由
 * 审核段据缓冲条目判断（11 §10.2）。
 *
 * @param {object} slice - 本任务在复合输出里的那一片。
 * @param {{windowText?: string|null}} ctx - `windowText` 是本轮观察材料正文，用于引证机械核对。
 */
export function validateCaptureVerdict(slice, { windowText = null } = {}) {
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  if (typeof slice !== "object" || slice === null) {
    return failure("capture/verdict_malformed", `structured output is not an object (got ${JSON.stringify(slice)})`);
  }
  const {
    verdict, phenomenon, evidence, source, candidate_question: candidateQuestion,
    quote, reason,
  } = slice;

  if (!CAPTURE_VERDICTS.includes(verdict)) {
    return failure(
      "capture/verdict_out_of_set",
      `verdict ${JSON.stringify(verdict)} is not in the closed set ${JSON.stringify([...CAPTURE_VERDICTS])}`,
    );
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return failure("capture/reason_missing", "reason is required and must be non-empty (it must point back to this run's materials)");
  }

  // 逐字引证 + 机械核对（与摩擦侧同源纪律：判断的可回指性由引证保证）。
  // 非空材料下**两态都须引证**——否则「恒报无失败」这一失效完全不可见。
  const windowProvided = typeof windowText === "string";
  const windowIsEmpty = windowProvided && windowText.trim().length === 0;
  if (typeof quote !== "string") {
    return failure("capture/quote_missing", "quote must be a string (empty only when the window itself is empty)");
  }
  if (windowProvided && !windowIsEmpty && quote.trim().length === 0) {
    return failure(
      "capture/quote_missing",
      "a verbatim quote is required over a non-empty window (both verdicts) — without it, a verdict that always answers 'no failure' is indistinguishable from correct operation",
    );
  }
  if (quote.trim().length > 0 && windowText !== null) {
    const checked = verifyQuotation(quote, windowText);
    if (!checked.ok) return failure(checked.error.code, checked.error.message);
  }

  if (verdict === "no-failure") {
    return { ok: true, value: { verdict, entry: null } };
  }

  // verdict === "failure-observed"：缓冲条目的四个内容字段都必填。
  for (const [field, value, maxLength] of [
    ["phenomenon", phenomenon, CAPTURE_MAX_PHENOMENON_LENGTH],
    ["evidence", evidence, CAPTURE_MAX_EVIDENCE_LENGTH],
    ["source", source, CAPTURE_MAX_SOURCE_LENGTH],
    ["candidate_question", candidateQuestion, CAPTURE_MAX_QUESTION_LENGTH],
  ]) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return failure(`capture/${field}_missing`, `verdict=failure-observed requires a non-empty ${field}`);
    }
    if (value.trim().length > maxLength) {
      return failure(`capture/${field}_too_long`, `${field} must be ≤ ${maxLength} characters (11 §12bis), got ${value.trim().length}`);
    }
  }

  // phenomenon 是**一句话的描述**，不是一串结论（11 §12bis 字段表）。
  if (!isOneSentence(phenomenon)) {
    return failure("capture/phenomenon_not_one_sentence", "phenomenon must be a single-sentence description (11 §12bis)");
  }

  // evidence 的「逐字」由 quote 机械核对承载：quote 必须是 evidence 的子串，
  // 否则说明 evidence 是转述而 quote 另摘一段——两者不一致即证据不可回指。
  const normEvidence = String(evidence).replace(/\s+/g, " ");
  const normQuote = String(quote).replace(/\s+/g, " ").trim();
  if (normQuote.length > 0 && !normEvidence.includes(normQuote)) {
    return failure(
      "capture/evidence_quote_mismatch",
      `evidence must contain the verbatim quote ${JSON.stringify(normQuote)} — evidence is the quoted span, not a paraphrase (11 §12bis)`,
    );
  }

  return {
    ok: true,
    value: {
      verdict,
      entry: {
        phenomenon: phenomenon.trim(),
        // §12bis 的 evidence 字段 = 逐字片段 **并附来源引用**；两者分字段采集、
        // 在此合成为载体上的单一字段（闭集只有 9 项，没有独立 source 字段）。
        evidence: `${evidence.trim()}\n来源：${source.trim()}`,
        source: source.trim(),
        candidate_question: candidateQuestion.trim(),
      },
    },
  };
}

/**
 * 候选正文的结构核对：七段按序、各段非空、无占位符。
 *
 * **审核段使用**（11 §10.2 第 3 项）；捕获段不产出正文，故不调用。
 * **只管结构**——不判断七段内容是否据实（那属语义工作，由 Human 与另一主体的
 * 复现验证承担，23 §16.1）。故本函数的通过**不证明**四前提确已齐备。
 */
export function validateCaptureBody(body) {
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  if (typeof body !== "string" || body.trim().length === 0) {
    return failure("capture/body_missing", "body is required for a draft candidate");
  }
  const text = body.trim();
  // H1 由 title 生成，正文不得自带（否则载体出现两个标题）。
  if (/^#\s+\S/m.test(text.split("\n")[0] ?? "")) {
    return failure("capture/body_has_h1", "body must not start with an H1 — the title is generated from `title`; start at `## 症状`");
  }
  // 占位符检测：明文禁止以「待查明」类标记冒充（11 §10.2 第 3 项）。
  const placeholder = text.match(/待查明|待补充|TBD|TODO|\?\?\?|（略）|\(略\)/);
  if (placeholder) {
    return failure(
      "capture/body_placeholder",
      `body contains a placeholder marker ${JSON.stringify(placeholder[0])} — a section that cannot be written truthfully means the entry does not support a candidate; settle it as discarded instead (11 §10.2 第 5 项)`,
    );
  }
  const headings = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
  const required = [...REQUIRED_BODY_SECTIONS];
  // 七段须按序出现且各段非空（可另含条件段「证据」，但不得插入必需段之间）。
  let cursor = 0;
  for (const want of required) {
    const idx = headings.indexOf(want, cursor);
    if (idx === -1) {
      return failure("capture/body_section_missing", `body is missing the required section 「${want}」 in the fixed order (23 §8); found [${headings.join(", ")}]`);
    }
    cursor = idx + 1;
  }
  // 各段非空：取每个必需段标题与下一标题之间的正文。
  const parts = text.split(/^##\s+.+$/m);
  const bodies = parts.slice(1);
  const heads = headings;
  for (let i = 0; i < required.length; i += 1) {
    const h = heads.indexOf(required[i]);
    const content = (bodies[h] ?? "").trim();
    if (content.length === 0) {
      return failure("capture/body_section_empty", `body section 「${required[i]}」 is empty — all seven sections must be non-empty (23 §8; 11 §10.2 forbids placeholders)`);
    }
  }
  return { ok: true, value: { headings } };
}
