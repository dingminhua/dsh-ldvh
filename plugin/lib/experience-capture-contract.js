/**
 * dsh-ldvh — 闲时辅助「积累经验」任务的**契约切片**（36 §10 经验积累）.
 *
 * 权威：specs/36 §10（经验积累）与 specs/23（Pitfall 事实类型）。
 *
 * ## 本模块与摩擦发现的契约模块（`friction-subagent-contract.js`）的分工
 *
 * 两者结构同形（提示词段 + 输出 schema + 落地前校验），但**产出对象不同**：
 * 摩擦发现产出 Friction 账目的判定（26 号），本模块产出 Pitfall 候选的判定
 * （23 号）。36 §8 明文二者「产出不同对象，互不替代」，故本模块**不引用**
 * 摩擦侧的常量与校验——各任务的提示词段与输出字段必须**各自独立、互不引用**
 * （`aux-task-registry.js` 的三条纪律之一）。
 *
 * ## 机械通道的边界（36 §10「机械通道的边界」）
 *
 * 本机制的机械通道**仅限创建 `draft` 候选**：不得创建 `active`、不得升格、
 * 不得废止——三者均属 23 §16 的 Human Gate。故本模块的输出**只能**表达
 * 「形成一条候选」或「无候选」，**不能**表达任何入档/废止/评级判断。
 *
 * ## 与摩擦侧的关键差异：不设阈值
 *
 * 摩擦发现按 `observing → open` 的阈值流转（N=3），故它需要 `same-obstacle`
 * 这一「命中既有账目」的态来累计计数。**经验积累没有阈值**：Pitfall 的准入是
 * **四前提齐**（失败已发生／根因已查明／解决已采用／验证已有观察，23 §5），
 * 不是「重复次数够多」。故本模块只有两态——「形成候选」与「无候选」。
 */

import { verifyQuotation } from "./friction-window.js";

/** 本任务的判定态（闭集两值）。 */
export const CAPTURE_VERDICTS = Object.freeze(["new-experience", "no-capture"]);

/** 正文固定七段（23 §8）——候选必须七段齐备，不得以占位符冒充。 */
export const REQUIRED_BODY_SECTIONS = Object.freeze([
  "症状", "触发条件", "根因", "解决", "规避", "验证", "影响与适用范围",
]);

/**
 * 给子代理的结构化输出 schema（本任务在复合 schema 里的那一片）。
 *
 * 形状约束与摩擦侧一致：只用宿主支持的 JSON Schema 子集（type / properties /
 * required / additionalProperties / items / enum / description），两态各自的
 * 必填字段用 `description` 说明 + 落地前校验承载。
 */
export function captureOutputSchema() {
  return {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: [...CAPTURE_VERDICTS],
        description:
          "两态之一：new-experience=本次材料含一条**已实际发生、已查明根因、已采用解法、已有观察**的失败机制，应形成 draft 候选；no-capture=本次材料中没有满足四前提的失败机制。",
      },
      title: {
        type: "string",
        description:
          "verdict=new-experience 时必填：失败机制的短标题（≤30 字，23 §8）。其余态填空字符串。",
      },
      scope: {
        type: "string",
        description:
          "verdict=new-experience 时必填：影响与适用范围陈述（23 §8 的 scope）。必须**逐字出现**在正文本「影响与适用范围」段——载体内聚是机械校验项。其余态填空字符串。",
      },
      body: {
        type: "string",
        description:
          "verdict=new-experience 时必填：候选正文，自 `## 症状` 起，含固定七段（症状/触发条件/根因/解决/规避/验证/影响与适用范围）按此序。**不要写 H1**——标题由 title 生成。**不得使用占位符或「待查明」标记**：写不出某一段说明四前提未齐，此时应报 no-capture。其余态填空字符串。",
      },
      failure_observed: {
        type: "string",
        description:
          "verdict=new-experience 时必填：该失败**实际发生**的可回指证据（会话留痕、提交、日志等的指向）。其余态填空字符串。",
      },
      root_cause_known: {
        type: "string",
        description:
          "verdict=new-experience 时必填：根因**已查明**的判断（不是「可能是」。23 §5 四前提之二）。其余态填空字符串。",
      },
      resolution_adopted: {
        type: "string",
        description:
          "verdict=new-experience 时必填：**已实际采用**的解法（不是建议。四前提之三）。其余态填空字符串。",
      },
      verification_observed: {
        type: "string",
        description:
          "verdict=new-experience 时必填：**已有的观察结果**（解决了是否生效、观察到什么、**未覆盖什么**。四前提之四；须区分已观察与未覆盖，不得以「应该没问题」代替观察）。其余态填空字符串。",
      },
      duplicate_of: {
        type: "string",
        description:
          "verdict=no-capture 且原因是「同一机制已存在」时填写：命中的既有 Pitfall 的 object_uid（必须来自本次交给你的既有对象列表）。其余情形填空字符串。",
      },
      quote: {
        type: "string",
        description:
          "材料非空时必填：**逐字**引自本次观察材料的原文（不得改写、不得取自材料外的其它上下文）。no-capture 在非空材料下同样必填——否则「恒报无候选」与「确实没有」无从区分。材料为空时填空字符串。",
      },
      reason: {
        type: "string",
        description: "必填：本次判断的理由，须回指本次材料（不得凭你可见的其他上下文）。",
      },
    },
    required: ["verdict", "title", "scope", "body", "quote", "reason"],
    additionalProperties: false,
  };
}

/**
 * 本任务的提示词段——**必须自足**：说明本任务要判断什么、输出什么字段。
 *
 * @param {{existing?: Array<object>}} ctx - `existing` 是本次交给它的既有 Pitfall 列表（查重比对对象）。
 */
export function buildCapturePromptSection({ existing = [] } = {}) {
  const list = existing.length === 0
      ? "（本知识库当前没有 `active` 或 `draft` 的 Pitfall——任何命中四前提的失败机制都只能是 new-experience）"
      : existing
          .map((c) => `- uid=${c.object_uid} [${c.status}] ${c.title}`)
          .join("\n");

  return [
    "**要判断的事情**：本次观察材料中，是否存在一条**已经解决并验证**的失败机制——即四前提齐备、应形成经验候选（Pitfall `draft`）的内容。",
    "",
    "**你只能做判断，不能做决定**：本机制没有主控，你的产出不取得授权或完成效力，"
    + "也不得产生需要 Human 决定的结论。具体地：你**不得**判断该候选「该不该入档」"
    + "「值不值得记」「影响多大」——入档是 Human Gate，且以另一主体的独立复现验证为前置"
    + "（36 §10、23 §16.1）。你**只**形成候选。",
    "",
    "**四前提（缺一即不构成候选，须报 no-capture）**：",
    "1. **失败已实际发生**——不是假想风险、不是预防性记录（23 §4.3 明确排除「未发生实际失败的假想风险」）；",
    "2. **根因已查明**——当前经验范围内能解释症状与触发的机制判断，不是「可能是」；",
    "3. **解决已采用**——已**实际执行**的处理方式，不是建议或计划；",
    "4. **验证已有观察**——已观察到的结果，且**须区分已观察什么与未覆盖什么**。",
    "",
    "**另须排除的**（23 §6.3）：单次调试过程**未收敛**为经验的内容、纯偏好或审美之争、"
    + "已由规范源吸收为强制规则的规避。",
    "",
    "**两态**：",
    "- `new-experience`：命中四前提 → 必填 `title`/`scope`/`body` 与四项前提各自的陈述字段。",
    "- `no-capture`：材料中没有命中四前提的失败机制（含「同一机制已存在，走补充级更新而非新建」）→ 其余字段填空字符串；若因「已存在」而报无候选，`duplicate_of` 填该既有对象的 uid。",
    "",
    "**`body` 的硬要求**：自 `## 症状` 起，含固定七段（" + REQUIRED_BODY_SECTIONS.join(" / ") + "）**按此序、各段非空**。"
    + "**不要写 H1**（标题由 `title` 生成）。**不得使用占位符、空段或「待查明」标记**——"
    + "写不出某一段就说明四前提未齐，此时应报 `no-capture`，而不是凑一条候选。"
    + "`scope` 必须逐字出现在「影响与适用范围」段内（载体内聚，机械校验）。",
    "",
    "**你要输出的字段**：`verdict`、`title`、`scope`、`body`、`failure_observed`、"
    + "`root_cause_known`、`resolution_adopted`、`verification_observed`、`duplicate_of`、"
    + "`quote`、`reason`。逐条说明见输出 schema。",
    "",
    "**本次交给你的既有 Pitfall（查重比对对象）**：",
    list,
  ].join("\n");
}

/**
 * 落地前的**跨字段校验**（宿主支持的 schema 子集表达不了条件约束）。
 *
 * 与落地侧共用同一份判据——校验通过不等于可入档（本任务只能产出 `draft`）。
 *
 * @param {object} slice - 本任务在复合输出里的那一片。
 * @param {{existing?: Array<object>, windowText?: string|null}} ctx
 */
export function validateCaptureVerdict(slice, { existing = [], windowText = null } = {}) {
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  if (typeof slice !== "object" || slice === null) {
    return failure("capture/verdict_malformed", `structured output is not an object (got ${JSON.stringify(slice)})`);
  }
  const { verdict, title, scope, body, quote, reason, duplicate_of: duplicateOf } = slice;

  if (!CAPTURE_VERDICTS.includes(verdict)) {
    return failure("capture/verdict_out_of_set", `verdict ${JSON.stringify(verdict)} is not in the closed set ${JSON.stringify([...CAPTURE_VERDICTS])}`);
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return failure("capture/reason_missing", "reason is required and must be non-empty (it must point back to this run's materials)");
  }

  // 逐字引证 + 机械核对（与摩擦侧同源纪律：切分与判断的可回指性由引证保证）。
  // 非空材料下**两态都须引证**——否则「恒报无候选」这一失效完全不可见。
  const windowProvided = typeof windowText === "string";
  const windowIsEmpty = windowProvided && windowText.trim().length === 0;
  if (typeof quote !== "string") {
    return failure("capture/quote_missing", "quote must be a string (empty only when the window itself is empty)");
  }
  if (windowProvided && !windowIsEmpty && quote.trim().length === 0) {
    return failure(
      "capture/quote_missing",
      "a verbatim quote is required over a non-empty window (both verdicts) — without it, a verdict that always answers 'no capture' is indistinguishable from correct operation",
    );
  }
  if (quote.trim().length > 0 && windowText !== null) {
    const checked = verifyQuotation(quote, windowText);
    if (!checked.ok) return failure(checked.error.code, checked.error.message);
  }

  if (verdict === "no-capture") {
    // 因「已存在」而无候选时，须指向本次交给它的既有对象（防凭空指向未见的对象）。
    if (typeof duplicateOf === "string" && duplicateOf.trim().length > 0) {
      const known = existing.some((c) => c.object_uid === duplicateOf.trim());
      if (!known) {
        return failure(
          "capture/duplicate_of_unknown",
          `duplicate_of ${JSON.stringify(duplicateOf)} is not among the objects supplied this run (${existing.length} supplied)`,
        );
      }
    }
    return { ok: true, value: { verdict, duplicateOf: typeof duplicateOf === "string" ? duplicateOf.trim() : "" } };
  }

  // verdict === "new-experience"：四前提各自的陈述与载体字段都必填。
  for (const [field, value] of [
    ["title", title], ["scope", scope], ["body", body],
    ["failure_observed", slice.failure_observed],
    ["root_cause_known", slice.root_cause_known],
    ["resolution_adopted", slice.resolution_adopted],
    ["verification_observed", slice.verification_observed],
  ]) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return failure(`capture/${field}_missing`, `verdict=new-experience requires a non-empty ${field}`);
    }
  }

  // 载体结构：七段齐备且各段非空（23 §8）。此处只做**结构**核对，
  // 内容是否据实由 Human 与另一主体复现验证承担（36 §10）。
  const structure = validateCaptureBody(body.trim());
  if (!structure.ok) return structure;

  // title 长度上限（23 §8：≤30 字）。
  if (title.trim().length > 30) {
    return failure("capture/title_too_long", `title must be ≤ 30 characters (23 §8), got ${title.trim().length}`);
  }

  return {
    ok: true,
    value: {
      verdict,
      title: title.trim(),
      scope: scope.trim(),
      body: body.trim(),
    },
  };
}

/**
 * 候选正文的结构核对：七段按序、各段非空、无占位符。
 *
 * **只管结构**——不判断七段内容是否据实（那属语义工作，由 Human 与另一主体
 * 的复现验证承担，36 §10）。故本函数的通过**不证明**四前提确已齐备。
 */
export function validateCaptureBody(body) {
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  if (typeof body !== "string" || body.trim().length === 0) {
    return failure("capture/body_missing", "body is required for new-experience");
  }
  const text = body.trim();
  // H1 由 title 生成，正文不得自带（否则载体出现两个标题）。
  if (/^#\s+\S/m.test(text.split("\n")[0] ?? "")) {
    return failure("capture/body_has_h1", "body must not start with an H1 — the title is generated from `title`; start at `## 症状`");
  }
  // 占位符检测：明文禁止以「待查明」类标记冒充（36 §10 自动动作闭集第 3 项）。
  const placeholder = text.match(/待查明|待补充|TBD|TODO|\?\?\?|（略）|\(略\)/);
  if (placeholder) {
    return failure(
      "capture/body_placeholder",
      `body contains a placeholder marker ${JSON.stringify(placeholder[0])} — a section that cannot be written truthfully means the four preconditions are not met; answer no-capture instead of submitting a candidate (36 §10)`,
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
      return failure("capture/body_section_empty", `body section 「${required[i]}」 is empty — all seven sections must be non-empty (23 §8; 36 §10 forbids placeholders)`);
    }
  }
  return { ok: true, value: { headings } };
}
