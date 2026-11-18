
export const AUX_TASK_ORDER = Object.freeze(["friction-discovery"]);

export const UNIMPLEMENTED_AUX_TASKS = Object.freeze(["capacity-maintenance", "memory-health"]);


const FRICTION_DISCOVERY_KEY = "friction-discovery";


export function compositePropertyName(taskKey) {
  return taskKey.replace(/-/g, "_");
}

export function buildCompositePrompt({ tasks = [], sections = {}, shared = "" } = {}) {
  const parts = [];
  const body = String(shared ?? "").trim();
  if (body.length > 0) parts.push(body);

  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0) {
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
      throw new Error(`no prompt section registered for task "${taskKey}" (登记不完整，不得静默跳过)`);
    }
    parts.push("");
    parts.push(
      `### 事项 ${index + 1}／${list.length}：${taskKey}`
      + `（**你的输出里，它的顶层字段名是 \`${compositePropertyName(taskKey)}\`**）`,
    );
    parts.push(section);
  });

  return parts.join("\n");
}

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

export const AUX_TASK_REGISTRY = Object.freeze({
  [FRICTION_DISCOVERY_KEY]: Object.freeze({
    key: FRICTION_DISCOVERY_KEY,
    implemented: false,
  }),
  "capacity-maintenance": Object.freeze({
    key: "capacity-maintenance",
    implemented: false,
  }),
  "memory-health": Object.freeze({
    key: "memory-health",
    implemented: false,
  }),
});

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
