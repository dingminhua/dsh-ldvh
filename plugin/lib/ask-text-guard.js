const ALLOWED_QUESTION_KEYS = Object.freeze([
  "id", "question", "header", "options", "multi_select", "multiSelect",
]);

const ALLOWED_ROOT_KEYS = Object.freeze(["questions", "timeout", "signal", "agent", "wait"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateAskText(request) {
  if (!isPlainObject(request)) {
    return { ok: false, reason: "提请请求必须是对象" };
  }
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
    if (item.options !== undefined) {
      if (!Array.isArray(item.options)) {
        return { ok: false, reason: `第 ${index + 1} 题 options 不是数组` };
      }
      for (let oi = 0; oi < item.options.length; oi += 1) {
        const opt = item.options[oi];
        if (!isPlainObject(opt) || typeof opt.label !== "string") {
          return { ok: false, reason: `第 ${index + 1} 题第 ${oi + 1} 个选项缺少 label` };
        }
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

export function askTextDenial(request) {
  const result = validateAskText(request);
  return result.ok ? undefined : `LDVH 提请文本校验未通过（fail-closed，请重写后重发）：${result.reason}`;
}
