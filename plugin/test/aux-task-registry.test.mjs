/**
 * 闲时辅助任务登记表与多任务拼接的**通用机械部分**（Human 决定 2026-10-11）.
 *
 * ## 2026-11-17 收窄说明
 *
 * 宿主辅助派发路径（`friction-discovery-provider.js` / `friction-subagent-contract.js`
 * / `idle-checkpoint.js`）已删除：摩擦观察改由主控经 child-only 工具直接派发，
 * 不再经本表拼接提示词或校验回传结论。`AUX_TASK_REGISTRY` 里 friction-discovery
 * 的三部位（promptSection / outputSchema / validate）随之删除，`implemented` 如实
 * 改为 false；`AUX_TASK_ORDER` 仍保留，因为设置面本批不动、仍会产出该任务键。
 *
 * 本文件保留的是**与具体任务无关**的机械承诺（拼接顺序、命名空间、逐任务独立
 * 收口），并用合成登记项驱动——否则这些代码将完全没有护栏。
 *
 * 本测试守的三类错与它们各自的守卫：
 *
 * 1. **拼接退化为混合**：某任务的产出缺失或校验失败，把其余任务的结论一起掀掉
 *    ——那就白费了「一次做多件」的意义（一次可用的运行被整条丢弃）。
 * 2. **未实现者被静默剔除**：设置面能勾、痕迹里却没有（04 §8.5 条件式要求禁止）。
 * 3. **顺序漂移**：拼接顺序若取自设置对象的键序，同一组勾选在不同展示顺序下
 *    会得到不同提示词（隐藏耦合）。
 */

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

/** 按**任务键**构造子代理提交的结构化对象（属性名经映射得出，不在用例里手写）。 */
function structuredOf(byTaskKey) {
  const out = {};
  for (const [taskKey, value] of Object.entries(byTaskKey)) {
    out[compositePropertyName(taskKey)] = value;
  }
  return out;
}

/** 一个合成任务登记项：只为让通用机械路径可达，不进入生产登记表。 */
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

// ---------------------------------------------------------------------------
// 登记表
// ---------------------------------------------------------------------------

test("登记表：派发面在 `AUX_TASK_ORDER` 内，顺序即规范叙述次序", () => {
  // 2026-11-17：派发面只剩 friction-discovery 一个键；其实现已随宿主派发路径
  // 删除，但键仍保留（设置面本批不动）。顺序仍以 AUX_TASK_ORDER 为唯一来源。
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
  // `implemented` 是本表的**唯一权威**：标了 true 却没有校验步骤，派发时才会以
  // 抛错收场。本条把它变成一条**可在测试期发现**的约束。
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

// ---------------------------------------------------------------------------
// 提示词拼接
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 复合 schema
// ---------------------------------------------------------------------------

test("复合 schema：每个任务占一个**顶层字段**，required 列全（缺件在提交层即被拦）", () => {
  const registry = { a: fakeTask({ key: "a" }), b: fakeTask({ key: "b" }) };
  const schema = compositeOutputSchema(["a", "b"], registry);
  assert.deepEqual(schema.required, ["a", "b"], "全部任务键都须 required");
  assert.equal(schema.additionalProperties, false, "顶层不得有额外字段");
  assert.ok(schema.properties.a !== undefined);
  assert.ok(schema.properties.b !== undefined);
});

test("复合 schema：属性名须是标识符安全形式（宿主按 snake_case 传递参数）", () => {
  // **2026-10-30 新增（实测缺陷的回归守卫）**：原实现把任务键原样当属性名
  // （`friction-discovery`），而宿主在参数传递环节把属性名规范化为 snake_case，
  // 于是**同一份 schema 下发用 kebab、校验用 snake**，子代理按 schema 提交必被拒：
  //   `value.friction-discovery is not a declared property`
  // 实测后果：两个辅助任务的结论**恒无法回传**（会话日志 e00fa45a，2026-10-30）。
  //
  // 本用例把「属性名不含连字符」钉成机械判据。任务键仍是 kebab-case
  // （内部标识，用于配置与日志），只有 schema 属性名是 snake_case。
  // 映射规律：任一 kebab 任务键都须映射为标识符安全的名称（不必在册）。
  for (const probe of ["friction-discovery", "sample-second-task", "a-b-c"]) {
    const mapped = compositePropertyName(probe);
    assert.match(mapped, /^[a-z][a-z0-9_]*$/, `映射结果 ${mapped} 须标识符安全`);
    assert.ok(!mapped.includes("-"), `映射结果 ${mapped} 不得含连字符`);
  }
  assert.equal(compositePropertyName("friction-discovery"), "friction_discovery");
  assert.equal(compositePropertyName("a-b-c"), "a_b_c");
  // 映射须是单射：两个任务键不得映射到同一属性名，否则命名空间退化为平铺。
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

// ---------------------------------------------------------------------------
// 逐任务校验（本设计的核心承诺）
// ---------------------------------------------------------------------------

test("逐任务校验：**某件失败不掀掉其余件**——已成功者仍须可取用", () => {
  // 这是「一次做多件」最关键的一条：§8.4 的闭集动作按任务分别成立。整体失败会
  // 使一次可用的运行被整条丢弃——那正是本设计最该避免的损失。
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
