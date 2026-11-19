
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUX_TASK_ORDER,
  AUX_TASK_REGISTRY,
  UNIMPLEMENTED_AUX_TASKS,
  buildCompositePrompt,
  compositeOutputSchema,
  compositePropertyName,
  splitRunnableTasks,
  validateCompositeOutput,
} from "../lib/aux-task-registry.js";

function structuredOf(byTaskKey) {
  const out = {};
  for (const [taskKey, value] of Object.entries(byTaskKey)) {
    out[compositePropertyName(taskKey)] = value;
  }
  return out;
}

function fakeTask({ key, validate } = {}) {
  return {
    key,
    implemented: true,
    promptSection: () => `**要判断的事情**：${key} 的输出。要输出的字段：\`entries\`。`,
    outputSchema: () => ({
      type: "object",
      properties: { entries: { type: "string" } },
      required: ["entries"],
      additionalProperties: false,
    }),
    validate: validate ?? ((slice) => (typeof slice?.entries === "string"
      ? { ok: true, value: slice }
      : { ok: false, error: { code: "cap/bad", message: "entries 缺失" } })),
  };
}


test("登记表：派发面在 `AUX_TASK_ORDER` 内，顺序即规范叙述次序", () => {
  assert.deepEqual([...AUX_TASK_ORDER], ["friction-discovery"]);
  for (const key of AUX_TASK_ORDER) {
    assert.ok(AUX_TASK_REGISTRY[key] !== undefined, `${key} 须在登记表内`);
    assert.equal(AUX_TASK_REGISTRY[key].key, key, "登记项的 key 须与键一致（防错位）");
  }
});

test("§8.5：未实现的职责不得从登记里消失——移出派发面后仍须可见", () => {
  assert.deepEqual([...UNIMPLEMENTED_AUX_TASKS], ["capacity-maintenance", "memory-health"]);
  for (const key of UNIMPLEMENTED_AUX_TASKS) {
    assert.ok(AUX_TASK_REGISTRY[key] !== undefined, `${key} 仍须在登记表内（只是不进派发面）`);
    assert.equal(AUX_TASK_REGISTRY[key].implemented, false, `${key} 的 implemented 须如实为 false`);
    assert.ok(!AUX_TASK_ORDER.includes(key), `${key} 不得同时出现在派发面`);
  }
});

test("登记表：`implemented` 与「四个部位是否齐备」互不矛盾", () => {
  for (const key of Object.keys(AUX_TASK_REGISTRY)) {
    const entry = AUX_TASK_REGISTRY[key];
    const parts = ["promptSection", "outputSchema", "validate"].filter((f) => typeof entry[f] === "function");
    if (entry.implemented === true) {
      assert.equal(parts.length, 3, `${key} 标为已实现，但只登记了 ${parts.join("/") || "无"}——登记不完整`);
    } else {
      assert.equal(parts.length, 0, `${key} 标为未实现，却登记了部位 ${parts.join("/")}——判定与事实矛盾`);
    }
  }
});

test("登记表：现状如实——宿主派发路径删除后没有已实现任务", () => {
  const implemented = [...Object.keys(AUX_TASK_REGISTRY), ...AUX_TASK_ORDER]
    .filter((k) => AUX_TASK_REGISTRY[k]?.implemented === true);
  assert.deepEqual(implemented, [], "摩擦发现改由 child-only 工具承载，不再经本表派发");
});

test("splitRunnableTasks：两半都返回，且合起来等于输入（不得静默丢弃未实现者）", () => {
  const all = [...AUX_TASK_ORDER, ...UNIMPLEMENTED_AUX_TASKS];
  const { runnable, unimplemented } = splitRunnableTasks(all);
  assert.deepEqual(runnable, [], "没有任何任务是可派发的（三部位已删）");
  assert.deepEqual(unimplemented, ["friction-discovery", "capacity-maintenance", "memory-health"]);
  assert.deepEqual(
    [...runnable, ...unimplemented].sort(),
    [...all].sort(),
    "两半的并集须等于输入——少一个即「静默剔除」",
  );
});

test("splitRunnableTasks：不在册的键既不算已实现也不算未实现白名单——如实归入未实现", () => {
  const { runnable, unimplemented } = splitRunnableTasks(["friction-discovery", "nonexistent-task"]);
  assert.deepEqual(runnable, []);
  assert.deepEqual(unimplemented, ["friction-discovery", "nonexistent-task"]);
});


test("拼接：公共部分**只出现一次**（材料与边界不随任务数重复）", () => {
  const shared = "SHARED-SECTION-UNIQUE-MARKER";
  const prompt = buildCompositePrompt({
    tasks: ["a", "b", "c"],
    sections: { a: "段A", b: "段B", c: "段C" },
    shared,
  });
  assert.equal(prompt.split(shared).length - 1, 1, "公共段须恰好出现一次");
  for (const s of ["段A", "段B", "段C"]) {
    assert.equal(prompt.split(s).length - 1, 1, `${s} 须恰好出现一次`);
  }
});

test("拼接：任务段的顺序即给定顺序（本函数不重排）", () => {
  const prompt = buildCompositePrompt({
    tasks: ["b", "a"],
    sections: { a: "段A", b: "段B" },
    shared: "共用",
  });
  assert.ok(prompt.indexOf("段B") < prompt.indexOf("段A"), "须按给定顺序，不得重排");
});

test("拼接：多任务时明示「逐件作答、不得合并、不得因一件无发现而略过其它件」", () => {
  const prompt = buildCompositePrompt({
    tasks: ["a", "b"],
    sections: { a: "段A", b: "段B" },
    shared: "共用",
  });
  assert.match(prompt, /本次要做的 2 件事/);
  assert.match(prompt, /逐件/, "须要求逐件作答");
  assert.match(prompt, /不得因为某一件没有发现就略过/, "须显式禁止因一件无发现而略过其它件");
  assert.match(prompt, /不得把两件事合并成一个结论/);
});

test("拼接：单任务时不出现「多件事」的措辞（N=1 与旧行为等价）", () => {
  const prompt = buildCompositePrompt({
    tasks: ["friction-discovery"],
    sections: { "friction-discovery": "段" },
    shared: "共用",
  });
  assert.match(prompt, /本次要做的一件事/);
  assert.doesNotMatch(prompt, /逐件/, "单任务不该有「逐件」的要求");
});

test("拼接：无任务时**抛错**（不得返回半截提示词去派生执行体）", () => {
  assert.throws(() => buildCompositePrompt({ tasks: [], sections: {}, shared: "x" }), /at least one task/);
});

test("拼接：任务段缺失时**抛错**（静默跳过会使该任务「被要求作答却从未被要求」）", () => {
  assert.throws(
    () => buildCompositePrompt({ tasks: ["a", "b"], sections: { a: "段A" }, shared: "x" }),
    /no prompt section registered for task "b"/,
  );
  assert.throws(
    () => buildCompositePrompt({ tasks: ["a"], sections: { a: "   " }, shared: "x" }),
    /no prompt section registered/,
    "纯空白段等同缺失",
  );
});


test("复合 schema：每个任务占一个**顶层字段**，required 列全（缺件在提交层即被拦）", () => {
  const registry = { a: fakeTask({ key: "a" }), b: fakeTask({ key: "b" }) };
  const schema = compositeOutputSchema(["a", "b"], registry);
  assert.deepEqual(schema.required, ["a", "b"], "全部任务键都须 required");
  assert.equal(schema.additionalProperties, false, "顶层不得有额外字段");
  assert.ok(schema.properties.a !== undefined);
  assert.ok(schema.properties.b !== undefined);
});

test("复合 schema：属性名须是标识符安全形式（宿主按 snake_case 传递参数）", () => {
  for (const probe of ["friction-discovery", "sample-second-task", "a-b-c"]) {
    const mapped = compositePropertyName(probe);
    assert.match(mapped, /^[a-z][a-z0-9_]*$/, `映射结果 ${mapped} 须标识符安全`);
    assert.ok(!mapped.includes("-"), `映射结果 ${mapped} 不得含连字符`);
  }
  assert.equal(compositePropertyName("friction-discovery"), "friction_discovery");
  assert.equal(compositePropertyName("a-b-c"), "a_b_c");
  assert.notEqual(compositePropertyName("a"), compositePropertyName("b"));
});

test("复合 schema：命名空间使两个任务的同名字段不互相覆盖（平铺会静默覆盖）", () => {
  const registry = {
    "sample-task": fakeTask({ key: "sample-task" }),
    "other-task": fakeTask({ key: "other-task" }),
  };
  const schema = compositeOutputSchema(["sample-task", "other-task"], registry);
  for (const name of Object.keys(schema.properties)) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `属性名 ${name} 须是标识符安全形式`);
  }
  const inner = schema.properties.sample_task;
  assert.ok(Array.isArray(inner.required) && inner.required.includes("entries"), "任务片自带其 required");
  assert.ok(!("entries" in schema.properties), "任务内部字段不得泄漏到顶层");
});

test("复合 schema：未实现的任务**不得**进入派发（缺 schema 即抛错，而非产出残缺 schema）", () => {
  assert.throws(
    () => compositeOutputSchema(["friction-discovery"]),
    /no output schema|未实现的任务不得进入派发/,
  );
});

test("复合 schema：不在册的任务键抛错（不得静默产出一个空 schema）", () => {
  assert.throws(() => compositeOutputSchema(["nonexistent"]), /unknown aux task/);
});


test("逐任务校验：**某件失败不掀掉其余件**——已成功者仍须可取用", () => {
  const registry = {
    good: fakeTask({ key: "good" }),
    broken: { key: "broken", implemented: true, validate: () => ({ ok: false, error: { code: "x", message: "broken on purpose" } }) },
  };
  const out = validateCompositeOutput(
    structuredOf({ good: { entries: "有" }, broken: {} }),
    { tasks: ["good", "broken"], registry },
  );
  assert.equal(out.results.good.ok, true, "已成功的那件须仍然成功");
  assert.equal(out.results.broken.ok, false, "失败的那件如实失败");
  assert.equal(out.okCount, 1);
  assert.equal(out.failCount, 1);
});

test("逐任务校验：结论整体缺失时也须为该任务产出一条失败（不得退化为「这次没它」）", () => {
  const registry = { good: fakeTask({ key: "good" }) };
  const out = validateCompositeOutput({}, { tasks: ["good"], registry });
  assert.ok("good" in out.results, "键必须齐全");
  assert.equal(out.results.good.ok, false);
  assert.equal(out.failCount, 1);
});

test("逐任务校验：某任务的校验器抛错**不得**掀掉其它任务（异常按该任务失败收口）", () => {
  const boom = { key: "boom", implemented: true, validate: () => { throw new Error("validator exploded"); } };
  const registry = { boom, good: fakeTask({ key: "good" }) };
  const out = validateCompositeOutput(
    structuredOf({ boom: {}, good: { entries: "有" } }),
    { tasks: ["boom", "good"], registry },
  );
  assert.equal(out.results.boom.ok, false);
  assert.match(out.results.boom.error.code, /validate_threw/);
  assert.equal(out.results.good.ok, true, "抛错者不得掀掉其余件");
});

test("逐任务校验：未实现/无校验步骤的任务按失败收口（不得静默通过）", () => {
  const out = validateCompositeOutput({ "capacity-maintenance": {} }, { tasks: ["capacity-maintenance"] });
  assert.equal(out.results["capacity-maintenance"].ok, false);
  assert.equal(out.results["capacity-maintenance"].error.code, "aux_task/not_implemented");
});
