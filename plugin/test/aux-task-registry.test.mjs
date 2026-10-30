/**
 * 闲时辅助的任务登记表与多任务拼接（Human 决定 2026-10-11：一次派发做多件事）.
 *
 * ## 本测试守的是什么
 *
 * 改案把「按轮换位挑一个任务」换成「勾选几个就做几件，拼进同一个子代理」。这项
 * 改动最容易出的三类错，各有一组守卫：
 *
 * 1. **拼接退化为混合**：某任务的产出缺失或校验失败，把其余任务的结论一起掀掉
 *    ——那就白费了「一次做多件」的意义（一次可用的运行被整条丢弃）。
 * 2. **未实现者被静默剔除**：设置面能勾、痕迹里却没有，Human 从两头都看不出它
 *    没做（04 §8.5 条件式要求禁止）。
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
import {
  buildDiscoveryPrompt,
  buildDiscoveryPromptSection,
  buildSharedPromptSection,
} from "../lib/friction-subagent-contract.js";

/**
 * 按**任务键**构造子代理提交的结构化对象。
 *
 * 属性名一律经 `compositePropertyName` 映射得出——**不在用例里手写属性名**。
 * 理由：属性名若由用例写死，它就成了一份与实现无关的第二份约定；实现改了映射
 * 而用例没改，用例会在**与被测行为无关**的地方红（或更糟：继续绿而实际已经
 * 错配）。经映射构造则用例与实现同源，映射一旦错，用例立刻以「提交交不出来」
 * 的形态暴露。
 *
 * 键的形状与真实提交一致：宿主按 snake_case 传参，故 `friction-discovery`
 * 任务的结果落在 `friction_discovery` 下。
 */
function structuredOf(byTaskKey) {
  const out = {};
  for (const [taskKey, value] of Object.entries(byTaskKey)) {
    out[compositePropertyName(taskKey)] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 登记表
// ---------------------------------------------------------------------------

test("登记表：派发面是两个任务，顺序即 AUX_TASK_ORDER（规范叙述次序）", () => {
  // 2026-10-30 收窄：容量维护与记忆健康移出**派发面**（它们没有执行体/提示词段/
  // 落地路径），改由 UNIMPLEMENTED_AUX_TASKS 承载「登记在册但未实现」的可见性。
  assert.deepEqual([...AUX_TASK_ORDER], ["friction-discovery", "experience-capture"]);
  for (const key of AUX_TASK_ORDER) {
    assert.ok(AUX_TASK_REGISTRY[key] !== undefined, `${key} 须在登记表内`);
    assert.equal(AUX_TASK_REGISTRY[key].key, key, "登记项的 key 须与键一致（防错位）");
  }
});

test("§8.5：未实现的职责不得从登记里消失——移出派发面后仍须可见", () => {
  // 反向约束：把两个未实现任务移出 AUX_TASK_ORDER 时，最容易犯的错是让它们
  // 干脆不出现，于是「§8 登记了记忆维护」这件事在系统里再也看不到。
  assert.deepEqual([...UNIMPLEMENTED_AUX_TASKS], ["capacity-maintenance", "memory-health"]);
  for (const key of UNIMPLEMENTED_AUX_TASKS) {
    assert.ok(AUX_TASK_REGISTRY[key] !== undefined, `${key} 仍须在登记表内（只是不进派发面）`);
    assert.equal(AUX_TASK_REGISTRY[key].implemented, false, `${key} 的 implemented 须如实为 false`);
    assert.ok(!AUX_TASK_ORDER.includes(key), `${key} 不得同时出现在派发面`);
  }
});

test("登记表：`implemented` 与「四个部位是否齐备」互不矛盾", () => {
  // `implemented` 是本表的唯一权威判据，但若它与事实不符（标了 true 却没有校验
  // 步骤），派发时才会以抛错收场。本条把它变成一条**可在测试期发现**的约束。
  for (const key of AUX_TASK_ORDER) {
    const entry = AUX_TASK_REGISTRY[key];
    const parts = ["promptSection", "outputSchema", "validate"].filter((f) => typeof entry[f] === "function");
    if (entry.implemented === true) {
      assert.equal(parts.length, 3, `${key} 标为已实现，但只登记了 ${parts.join("/") || "无"}——登记不完整`);
    } else {
      assert.equal(parts.length, 0, `${key} 标为未实现，却登记了部位 ${parts.join("/")}——判定与事实矛盾`);
    }
  }
});

test("登记表：现状如实——idle-review 与 experience-capture 已实现（§8.5 不得主张空闲维护已运行）", () => {
  const implemented = AUX_TASK_ORDER.filter((k) => AUX_TASK_REGISTRY[k].implemented === true);
  assert.deepEqual(implemented, ["friction-discovery", "experience-capture"], "容量维护与记忆健康的能力本体确实没有代码");
});

test("splitRunnableTasks：两半都返回，且合起来等于输入（不得静默丢弃未实现者）", () => {
  // 2026-10-30：AUX_TASK_ORDER 只含已实现任务，故这里显式把「派发面 + 未实现」
  // 合起来作为输入——正是配置面可能给出的清单（旧配置里仍可能勾着未实现项）。
  const all = [...AUX_TASK_ORDER, ...UNIMPLEMENTED_AUX_TASKS];
  const { runnable, unimplemented } = splitRunnableTasks(all);
  assert.deepEqual(runnable, ["friction-discovery", "experience-capture"]);
  assert.deepEqual(unimplemented, ["capacity-maintenance", "memory-health"]);
  assert.deepEqual(
    [...runnable, ...unimplemented].sort(),
    [...all].sort(),
    "两半的并集须等于输入——少一个即「静默剔除」",
  );
  // 顺序须原样保留（痕迹与提示词的次序依据）。
  assert.deepEqual(splitRunnableTasks(["memory-health", "friction-discovery"]).runnable, ["friction-discovery"]);
  assert.deepEqual(splitRunnableTasks(["memory-health", "friction-discovery"]).unimplemented, ["memory-health"]);
});

test("splitRunnableTasks：不在册的键既不算已实现也不算未实现白名单——如实归入未实现", () => {
  // 不在册 ≠ 已实现。把它归入 runnable 会使派发时因缺 schema 抛错（可用性差），
  // 而它确实没有任何实现，故归 unimplemented 是如实处置。
  const { runnable, unimplemented } = splitRunnableTasks(["friction-discovery", "nonexistent-task"]);
  assert.deepEqual(runnable, ["friction-discovery"]);
  assert.deepEqual(unimplemented, ["nonexistent-task"]);
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
    tasks: [" friction-discovery ".trim()],
    sections: { "friction-discovery": "段" },
    shared: "共用",
  });
  assert.match(prompt, /本次要做的一件事/);
  assert.doesNotMatch(prompt, /逐件/, "单任务不该有「逐件」的要求");
});

test("拼接：无任务时**抛错**（不得返回半截提示词去派生执行体）", () => {
  // 半截提示词会被执行体当作「只要随便答点什么」，比不派发更糟。
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

test("拼接：N=1 的复合结果与单任务入口**逐字相同**（两条路径共用同一份措辞）", () => {
  // 这是「N=1 等价于旧行为」的机械形式：若两条路径各自拼装，措辞迟早漂移。
  const window = { items: [{ turn: 1, user: "u", assistant: "a" }], truncated: false };
  const candidates = [{ object_uid: "11111111-2222-4333-8444-555555555555", status: "observing", title: "T", phenomenon: "P" }];
  const viaSingle = buildDiscoveryPrompt({ threshold: 3, candidates, window });
  const viaComposite = buildCompositePrompt({
    tasks: ["friction-discovery"],
    sections: { "friction-discovery": buildDiscoveryPromptSection({ threshold: 3, candidates }) },
    shared: buildSharedPromptSection({ window, taskCount: 1 }),
  });
  assert.equal(viaComposite, viaSingle, "两条路径须逐字相同");
});

// ---------------------------------------------------------------------------
// 复合 schema
// ---------------------------------------------------------------------------

test("复合 schema：每个任务占一个**顶层字段**，required 列全（缺件在提交层即被拦）", () => {
  const schema = compositeOutputSchema(["friction-discovery"]);
  assert.deepEqual(schema.required, ["friction_discovery"], "全部任务键都须 required");
  assert.equal(schema.additionalProperties, false, "顶层不得有额外字段");
  assert.ok(schema.properties["friction_discovery"] !== undefined);
});

test("复合 schema：属性名须是标识符安全形式（宿主按 snake_case 传递参数）", () => {
  // **2026-10-30 新增（实测缺陷的回归守卫）**：原实现把任务键原样当属性名
  // （`friction-discovery`），而宿主在参数传递环节把属性名规范化为 snake_case，
  // 于是**同一份 schema 下发用 kebab、校验用 snake**，子代理按 schema 提交必被拒：
  //   `value.friction-discovery is not a declared property`
  // 实测后果：friction-discovery 与 experience-capture 两个辅助任务的结论
  // **恒无法回传**（会话日志 e00fa45a，2026-10-30）。
  //
  // 本用例把「属性名不含连字符」钉成机械判据。任务键仍是 kebab-case
  // （内部标识，用于配置与日志），只有 schema 属性名是 snake_case。
  const schema = compositeOutputSchema(["friction-discovery", "experience-capture"]);
  for (const name of Object.keys(schema.properties)) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `属性名 ${name} 须是标识符安全形式`);
    assert.ok(!name.includes("-"), `属性名 ${name} 不得含连字符（宿主按 snake_case 传参）`);
  }
  // 映射须是单射：两个任务键不得映射到同一属性名，否则命名空间退化为平铺。
  assert.notEqual(
    compositePropertyName("friction-discovery"),
    compositePropertyName("experience-capture"),
  );
  // 任务键本身不受影响——它仍是内部标识，不得因修属性名而被改掉。
  assert.equal(compositePropertyName("friction-discovery"), "friction_discovery");
  assert.deepEqual([...AUX_TASK_ORDER], ["friction-discovery", "experience-capture"]);
});

test("复合 schema：命名空间使两个任务的同名字段不互相覆盖（平铺会静默覆盖）", () => {
  // 平铺设计的致命处：两个任务都用 `reason` 时后者覆盖前者，而 schema 无法表达
  // 「这两个 reason 属于不同任务」——覆盖是静默的，只有命名空间能机械地防住。
  assert.notEqual(compositePropertyName("a"), compositePropertyName("b"));
  // 每个任务片的字段被完整包在自己的键下：顶层只应有任务键，没有任务内部字段。
  const schema = compositeOutputSchema(["friction-discovery"]);
  const inner = schema.properties["friction_discovery"];
  assert.ok(Array.isArray(inner.required) && inner.required.includes("verdict"), "任务片自带其 required");
  assert.ok(!("verdict" in schema.properties), "任务内部字段不得泄漏到顶层");
});

test("复合 schema：未实现的任务**不得**进入派发（缺 schema 即抛错，而非产出残缺 schema）", () => {
  assert.throws(
    () => compositeOutputSchema(["friction-discovery", "capacity-maintenance"]),
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
  // 这是「一次做多件」最关键的一条：§8.4 的闭集动作按任务分别成立，`friction-discovery`
  // 的引证不成立不该影响另一件已经得出的结论。整体失败会使一次可用的运行被整条
  // 丢弃——那正是本设计最该避免的损失。
  const structured = structuredOf({
    "friction-discovery": { verdict: "no-discovery", target_uid: "", title: "", phenomenon: "", basis: "", impact: "light", quote: "这是一段足够长的材料原文内容", reason: "无" },
    // 第二件故意不合法（此处借 friction-discovery 的校验器：same-obstacle 却缺 target_uid）
    broken: { verdict: "same-obstacle", target_uid: "" },
  });
  const registry = {
    "friction-discovery": AUX_TASK_REGISTRY["friction-discovery"],
    broken: { key: "broken", implemented: true, validate: () => ({ ok: false, error: { code: "x", message: "broken on purpose" } }) },
  };
  const out = validateCompositeOutput(structured, {
    tasks: ["friction-discovery", "broken"],
    registry,
    contexts: { "friction-discovery": { candidates: [], windowText: "这是一段足够长的材料原文内容" } },
  });
  assert.equal(out.results["friction-discovery"].ok, true, "已成功的那件须仍然成功");
  assert.equal(out.results["broken"].ok, false, "失败的那件如实失败");
  assert.equal(out.okCount, 1);
  assert.equal(out.failCount, 1);
});

test("逐任务校验：结论整体缺失时也须为该任务产出一条失败（不得退化为「这次没它」）", () => {
  // 「它没答」与「这次运行没有它」处置不同：前者要入待处置队列，后者不。若缺失
  // 时结果对象里连键都没有，调用方就无从区分两者。
  const out = validateCompositeOutput({}, { tasks: ["friction-discovery"], contexts: { "friction-discovery": {} } });
  assert.ok("friction-discovery" in out.results, "键必须齐全");
  assert.equal(out.results["friction-discovery"].ok, false);
  assert.equal(out.failCount, 1);
});

test("逐任务校验：某任务的校验器抛错**不得**掀掉其它任务（异常按该任务失败收口）", () => {
  const boom = { key: "boom", implemented: true, validate: () => { throw new Error("validator exploded"); } };
  const out = validateCompositeOutput(
    structuredOf({ boom: {}, "friction-discovery": { verdict: "no-discovery", target_uid: "", title: "", phenomenon: "", basis: "", impact: "light", quote: "足够的材料原文内容", reason: "无" } }),
    { tasks: ["boom", "friction-discovery"], registry: { boom, "friction-discovery": AUX_TASK_REGISTRY["friction-discovery"] }, contexts: { boom: {}, "friction-discovery": { candidates: [], windowText: "足够的材料原文内容" } } },
  );
  assert.equal(out.results.boom.ok, false);
  assert.match(out.results.boom.error.code, /validate_threw/);
  assert.equal(out.results["friction-discovery"].ok, true, "抛错者不得掀掉其余件");
});

test("逐任务校验：未实现/无校验步骤的任务按失败收口（不得静默通过）", () => {
  const out = validateCompositeOutput({ "capacity-maintenance": {} }, { tasks: ["capacity-maintenance"] });
  assert.equal(out.results["capacity-maintenance"].ok, false);
  assert.equal(out.results["capacity-maintenance"].error.code, "aux_task/not_implemented");
});

test("提示词段自足：任务段含四态与字段要求，公共段不含（分工不得混）", () => {
  const section = buildDiscoveryPromptSection({ threshold: 3, candidates: [] });
  // 2026-10 修订：三态 → 四态（观察层与账本层分开判定）。
  assert.match(section, /same-obstacle/);
  assert.match(section, /same-observation-group/);
  assert.match(section, /new-observation/);
  assert.match(section, /no-discovery/);
  // 旧名 `new-obstacle` 已作废——它同时承担「新建账目」，而现在观察不进账本。
  assert.doesNotMatch(section, /new-obstacle/, "旧态名不得再出现在提示词里");
  assert.match(section, /你要输出的字段/);
  assert.match(section, /attribution/, "归因是必填字段（本次修订的关键新增）");
  // 公共段不重复任务的四态要求（重复即有两种措辞，执行体按更宽松的理解）。
  const shared = buildSharedPromptSection({ window: { items: [] } });
  assert.doesNotMatch(shared, /same-obstacle/, "四态属任务段，公共段不得重述");
});

// ---------------------------------------------------------------------------
// N≥2 的拼接路径（注入假任务使该路径可达）
// ---------------------------------------------------------------------------
//
// ## 为什么要靠注入
//
// `runnable` 现状恒为单元素（只有 `friction-discovery` 已实现），故拼接路径（N≥2）
// **在真实运行中不可达**——那意味着本次改案的核心路径无法被验证，只能靠阅读。
// 故 `createDiscoveryProvider` 增加了 `registry` 注入点：测试放入一个「假装的第二
// 任务」，驱动**真实的**拼接器、复合 schema 与逐任务校验代码。
//
// 默认值仍是生产登记表，生产路径行为不变。

/** 一个假装的第二任务：只为让 N≥2 可达，不进入生产登记表。 */
function fakeSecondTask({ validate } = {}) {
  return {
    key: "capacity-maintenance",
    implemented: true,
    promptSection: () => "**要判断的事情**：本次材料中是否有需要整理的记忆条目。要输出的字段：`entries`。",
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

const GOOD_VERDICT = {
  verdict: "no-discovery", target_uid: "", title: "", phenomenon: "", basis: "",
  impact: "light", quote: "这是一段足够长的材料内容原文。", reason: "本次无系统性阻碍。",
};

/**
 * 跑一次两任务派发，返回 provider 的产出与派发请求。
 *
 * 入参 `byTaskKey` 是**按任务键**给出的两份结论（不是提交形态的扁平对象）——
 * 由本函数经 `structuredOf` 映射成提交形态。这样调用点不必知道属性名，
 * 而提交形态仍与真实提交一致。
 */
async function runWithTwoTasks(byTaskKey) {
  const { createDiscoveryProvider } = await import("../lib/friction-discovery-provider.js");
  const registry = { ...AUX_TASK_REGISTRY, "capacity-maintenance": fakeSecondTask() };
  const structured = structuredOf(byTaskKey);
  let captured = null;
  const subagents = {
    list: () => ["spawn"],
    getProvider: () => ({ inheritsParentContext: false, capabilities: { outputSchema: true } }),
    startActivation: async (spec) => {
      captured = spec.request;
      return { childId: "session-executor", result: Promise.resolve({ stopReason: "completed", structured }), dispose: async () => {} };
    },
  };
  const provider = createDiscoveryProvider({
    subagents,
    parent: { id: "p", session: { header: { id: "s" } } },
    signal: new AbortController().signal,
    registry,
    provideWindow: () => ({ items: [{ turn: 1, user: "用户的话", assistant: "这是一段足够长的材料内容原文。" }], truncated: false }),
  });
  const out = await provider({
    threshold: 3, candidates: [], sessionSignature: "sig",
    window: { from: 0, to: 1 },
    tasks: ["friction-discovery", "capacity-maintenance"],
  });
  return { out, captured };
}

test("N=2 拼接：**一份**提示词含**两个**任务段，公共段只出现一次", async () => {
  const { captured } = await runWithTwoTasks({
    "friction-discovery": GOOD_VERDICT,
    "capacity-maintenance": { entries: "无待整理条目" },
  });
  const text = captured.prompt[0].text;
  assert.match(text, /本次要做的 2 件事/, "须显式声明要做两件");
  assert.deepEqual(
    // 标题形如「### 事项 1／2：friction-discovery（**…顶层字段名是 `friction_discovery`**）」
    // ——只取到任务标识为止，故正则用「：」后接非中文括号的一段。
    text.match(/### 事项 \d+／\d+：[^\s（]+/g),
    ["### 事项 1／2：friction-discovery", "### 事项 2／2：capacity-maintenance"],
    "两个任务段须各占一段，顺序与输入一致",
  );
  // **属性名须写在标题里**（2026-10-30 修）：任务标识是 kebab-case，而宿主按
  // snake_case 校验提交参数——子代理若照抄标题里的任务标识就交不出来。故标题
  // 须明写顶层字段名，让子代理不必推断。
  assert.match(
    text,
    /顶层字段名是 `friction_discovery`/,
    "任务段标题须给出宿主校验所用的顶层字段名（snake_case）",
  );
  assert.match(
    text,
    /顶层字段名是 `capacity_maintenance`/,
    "每个任务段都须给出自己的顶层字段名",
  );
  assert.equal((text.match(/## 本次观察材料/g) || []).length, 1, "公共材料段**只出现一次**（不随任务数重复）");
  assert.equal((text.match(/# 你只能依据本次材料判断/g) || []).length, 1, "边界规则也只出现一次");
});

test("N=2 复合 schema：两个任务各占一个顶层字段，required 列全", async () => {
  const { captured } = await runWithTwoTasks({
    "friction-discovery": GOOD_VERDICT,
    "capacity-maintenance": { entries: "无" },
  });
  // required 列的是**提交形态的属性名**（snake_case）——它就是宿主校验时用的键。
  assert.deepEqual(captured.outputSchema.required, ["friction_discovery", "capacity_maintenance"]);
  assert.equal(captured.outputSchema.additionalProperties, false);
  // 两任务的字段名不同、互不覆盖——平铺设计会在这里静默覆盖。
  assert.ok(!("entries" in captured.outputSchema.properties), "任务内部字段不得泄漏到顶层");
});

test("N=2 逐任务校验：**某件失败不掀掉另一件**（32 §10.2 的核心承诺，三种组合）", async () => {
  // 情形 A：两件都成功
  const a = await runWithTwoTasks({ "friction-discovery": GOOD_VERDICT, "capacity-maintenance": { entries: "无" } });
  assert.deepEqual(a.out.failedTasks, []);
  assert.equal(a.out.taskResults["friction-discovery"].ok, true);
  assert.equal(a.out.taskResults["capacity-maintenance"].ok, true);
  assert.notEqual(a.out.watermarkTurn, undefined, "全成功时水位的区间上界须给出");

  // 情形 B：idle-review 失败（引证不在材料），capacity 成功
  const b = await runWithTwoTasks({
    "friction-discovery": { ...GOOD_VERDICT, quote: "这句材料里根本没有出现过完全无关的一句话" },
    "capacity-maintenance": { entries: "无" },
  });
  assert.deepEqual(b.out.failedTasks, ["friction-discovery"]);
  assert.equal(b.out.taskResults["capacity-maintenance"].ok, true, "★ 另一件的结论**不得**因它失效");
  assert.equal(b.out.verdict, null, "失败者不得产出可落地的结论");
  // **水位的区间上界仍须给出**（独立代码审核 F-1 的修复）：它是「本次区间上界」，
  // 是否采用由调用方**按任务分别**决定——成功者推进、失败者不推进。原断言要求
  // `undefined`（即「任一失败即整体不推进」），那使成功者的水位也停滞、下轮重覆盖
  // 同一区间而致其 `occurrence.count` 虚增——**恰是本条测试名所承诺之事被架空**。
  assert.notEqual(
    b.out.watermarkTurn, undefined,
    "水位**上界**不得因有任务失败而缺席——缺席即成功者也被重覆盖（F-1）",
  );

  // 情形 C：idle-review 成功，capacity 失败
  const c = await runWithTwoTasks({ "friction-discovery": GOOD_VERDICT, "capacity-maintenance": {} });
  assert.deepEqual(c.out.failedTasks, ["capacity-maintenance"]);
  assert.equal(c.out.taskResults["friction-discovery"].ok, true, "★ 成功者须仍可取用");
  assert.notEqual(c.out.verdict, null, "friction-discovery 成功时须给出可落地的结论");
  assert.notEqual(
    c.out.watermarkTurn, undefined,
    "水位**上界**不得因有任务失败而缺席（同上，F-1）",
  );
});

test("N=2 逐任务校验：某任务的校验器**抛错**不掀掉另一件（异常按该任务失败收口）", async () => {
  const { createDiscoveryProvider } = await import("../lib/friction-discovery-provider.js");
  const registry = {
    ...AUX_TASK_REGISTRY,
    "capacity-maintenance": fakeSecondTask({ validate: () => { throw new Error("校验器爆炸"); } }),
  };
  const subagents = {
    list: () => ["spawn"],
    getProvider: () => ({ inheritsParentContext: false, capabilities: { outputSchema: true } }),
    startActivation: async () => ({
      childId: "session-executor",
      result: Promise.resolve({ stopReason: "completed", structured: structuredOf({ "friction-discovery": GOOD_VERDICT, "capacity-maintenance": { entries: "x" } }) }),
      dispose: async () => {},
    }),
  };
  const provider = createDiscoveryProvider({
    subagents, parent: { id: "p", session: { header: { id: "s" } } },
    signal: new AbortController().signal, registry,
    provideWindow: () => ({ items: [{ turn: 1, user: "u", assistant: "这是一段足够长的材料内容原文。" }], truncated: false }),
  });
  const out = await provider({ threshold: 3, candidates: [], window: { from: 0, to: 1 }, tasks: ["friction-discovery", "capacity-maintenance"] });
  assert.deepEqual(out.failedTasks, ["capacity-maintenance"]);
  assert.equal(out.taskResults["friction-discovery"].ok, true, "抛错的任务不得掀掉另一件");
});
