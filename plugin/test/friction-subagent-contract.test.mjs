// Tests for plugin/lib/friction-subagent-contract.js —
// 11 §9 第 1 项语义判断的承载契约（提示词 + outputSchema + 落地前校验）.
//
// 2026-10 修订（Human 决定：摩擦的观察不进事实源）：子代理的判定态闭集由三态扩为
// **四态**——观察材料不再直接进事实源，一律先进 11 §12bis.1 的摩擦观察缓冲，攒够
// N=3 才晋升为一条 `open` 账目。故判定态闭集与落地动作是：
//
// | 态 | 含义 | 落地动作（11 §9） |
// |---|---|---|
// | `same-obstacle` | 与**既有 open 账目**同一阻碍 | 第 4 项：补充级更新（count+1） |
// | `same-observation-group` | 与**缓冲中某个 pending 组**同一阻碍 | 第 2 项：追加进该组；达 N 则第 3 项晋升 |
// | `new-observation` | 账本与缓冲都没有的**新阻碍** | 第 2 项：开一个新组（留在缓冲） |
// | `no-discovery` | 没有构成系统性阻碍的现象 | 无动作 |
//
// 旧名 `new-obstacle`（它曾直接建账目）已退场——本文件钉住「旧名不得再交出来」。
//
// **本次修订新增的两个必填字段**：
//   - `group`：观察层的聚合键（11 §12bis.1）——`same-observation-group` 必须命中本次
//     交付的观察组清单（不得凭空并组），`new-observation` 则由子代理新起一个键；
//   - `attribution`：归因陈述——**观察层两态都必填**。这修的是一个既有缺陷：机械
//     通道入账 95/97 条缺归因（见 schema 字段说明）。两态都要填，因为**这一条可能
//     正是攒够 N 的那一条**——届时它要立刻晋升为账目（11 §9 第 3 项）。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VERDICTS,
  discoveryOutputSchema,
  buildDiscoveryPrompt,
  buildDiscoveryPromptSection,
  validateDiscoveryVerdict,
} from "../lib/friction-subagent-contract.js";
// 材料边界与引证核对走**同一来源**（friction-window.js）——测试直接 import 它，
// 才能断言「两级渲染同源」这一不变量。
import {
  verifyQuotation,
  renderWindowText,
  windowBody,
  WINDOW_OPEN,
  WINDOW_CLOSE,
} from "../lib/friction-window.js";

/**
 * 账本侧候选（11 §9 第 1 项的**第一层**）：2026-10 修订后只有 `open`——
 * `observing` 已退出 26 §9 的状态闭集（观察改由缓冲承载）。
 */
const CANDIDATES = [
  { object_uid: "11111111-2222-4333-8444-555555555555", status: "open", title: "CI 慢", phenomenon: "CI 平均 8 分钟。" },
  { object_uid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", status: "open", title: "钩子依赖 PATH", phenomenon: "提交钩子找不到 node。" },
];

/**
 * 观察层候选（11 §9 第 1 项的**第二层** / §12bis.1）：形状与 idle-checkpoint 实际
 * 交付给 provider 的一致（`group` 键 + 组内条数 + 现象摘要；不带 `evidence` 全文）。
 */
const OBSERVATION_GROUPS = [
  { group: "ci-slow-build", pending_count: 2, phenomenon: "CI 平均 8 分钟。" },
  { group: "hook-missing-node", pending_count: 1, phenomenon: "提交钩子找不到 node。" },
];

/**
 * 四个态共用的字段集（宿主 schema 无条件约束，故全部字段都在场且都在 `required` 内；
 * 「哪一态必填哪些」由落地侧校验承载——11 §12bis.1 与 §9 第 2/3 项）。
 */
function verdict(overrides = {}) {
  return {
    verdict: "no-discovery",
    target_uid: "",
    group: "",
    title: "",
    phenomenon: "",
    basis: "",
    attribution: "",
    impact: "light",
    quote: "",
    reason: "本次区间内没有出现反复出现的阻碍。",
    ...overrides,
  };
}

/**
 * 观察层两态（`same-observation-group` / `new-observation`）的**合规基线**——
 * 两态的必填字段集完全相同（11 §9 第 3 项：这一条可能正是攒够 N 的那一条）。
 */
function observationVerdict(overrides = {}) {
  return verdict({
    verdict: "new-observation",
    group: "ci-slow-build",
    title: "CI 构建缓慢",
    phenomenon: "CI 平均 8 分钟。",
    basis: "可归因于依赖安装未缓存，修了构建会更快。",
    attribution: "CI 配置未开依赖缓存（CI 配置文件）。",
    impact: "medium",
    quote: "某段材料原文内容。",
    ...overrides,
  });
}

/**
 * 提示词任务段里「新发现」一态的**状态名**。
 *
 * 本次修订把 `new-obstacle` 改名为 `new-observation`（旧名曾直接建账目，语义已变）。
 * 提示词任务段已跟进新名，故此处**严格**取新名——旧名不得再出现在提示词里。
 */
const NEW_STATE_NAME = "new-observation";

// ---------------------------------------------------------------------------
// schema 形状（宿主支持的子集）
// ---------------------------------------------------------------------------

test("schema: object root，只有受支持的 JSON Schema 子集（无 oneOf/$ref 等扩展）", () => {
  const s = discoveryOutputSchema();
  assert.equal(s.type, "object");
  assert.ok(Array.isArray(s.required) && s.required.length > 0);
  assert.equal(s.additionalProperties, false, "多余字段必须交不出来（实测宿主在提交层拦）");
  // 宿主只支持 type/properties/required/additionalProperties/items/enum/description 等
  for (const key of Object.keys(s)) {
    assert.ok(["type", "properties", "required", "additionalProperties", "description"].includes(key), `unexpected top-level key ${key}`);
  }
  for (const [name, node] of Object.entries(s.properties)) {
    for (const key of Object.keys(node)) {
      assert.ok(["type", "enum", "description"].includes(key), `property ${name} uses unsupported construct ${key}`);
    }
  }
});

test("schema: verdict 的 enum 与模块导出的闭集同源（防规范与实现漂移）", () => {
  const s = discoveryOutputSchema();
  assert.deepEqual(s.properties.verdict.enum, [...VERDICTS]);
  assert.deepEqual([...VERDICTS], ["same-obstacle", "same-observation-group", "new-observation", "no-discovery"]);
});

test("schema: 闭集为四值，旧名 new-obstacle 已退场（11 §9 四态闭集）", () => {
  // 旧名曾直接建账目，语义已随「观察不进事实源」而变——不得再被交出来。
  assert.equal(VERDICTS.length, 4, "四态闭集（11 §9 第 1–3 项 + 无发现）");
  assert.ok(!VERDICTS.includes("new-obstacle"), "旧名不得留在闭集里");
  assert.ok(!discoveryOutputSchema().properties.verdict.enum.includes("new-obstacle"));
});

test("schema: 所有字段都在 required 内（四态共用一套字段，跨态约束由落地侧校验）", () => {
  const s = discoveryOutputSchema();
  for (const name of Object.keys(s.properties)) {
    assert.ok(s.required.includes(name), `${name} must be required (宿主子集无条件 schema，故不适用者交空串)`);
  }
});

test("schema: 观察层新增的两个字段都在 schema 里——group 与 attribution（11 §12bis.1 / 26 §8）", () => {
  const s = discoveryOutputSchema();
  assert.ok(s.properties.group, "须有 group 字段（观察层聚合键，§12bis.1）");
  assert.equal(s.properties.group.type, "string");
  assert.ok(s.properties.attribution, "须有 attribution 字段（归因陈述，26 §8）");
  assert.equal(s.properties.attribution.type, "string");
  assert.ok(s.required.includes("group"), "group 须在 required 内（不适用者交空串）");
  assert.ok(s.required.includes("attribution"), "attribution 须在 required 内（不适用者交空串）");
});

test("schema: impact 的枚举闭集为 light/medium/heavy（26 §8 影响评级）", () => {
  assert.deepEqual(discoveryOutputSchema().properties.impact.enum, ["light", "medium", "heavy"]);
});

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

test("prompt: 含阈值、候选清单与区间声明（§8.4 第 1 项的机械前提）", () => {
  const prompt = buildDiscoveryPrompt({
    threshold: 3,
    candidates: CANDIDATES,
    window: { items: [{ turn: 4, user: "帮我看看构建", assistant: "这次构建在链接阶段失败了。" }], truncated: false },
  });
  assert.match(prompt, /N=3/, "阈值必须写明");
  assert.ok(prompt.includes(CANDIDATES[0].object_uid), "候选 uid 必须可见（否则无从产出 target_uid）");
  assert.match(prompt, /\[turn 4\]/, "窗口材料必须带轮次标注");
  assert.match(prompt, /这次构建在链接阶段失败了。/);
});

test("prompt: 明确禁止价值判断与 Human 决定项（§8.4 + §8.2 第 2/4 条）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [], window: { items: [{ turn: 1, assistant: "某段材料。" }] } });
  assert.match(prompt, /不取得授权或完成效力/);
  assert.match(prompt, /不得.*值不值得修|值不值得修/, "必须写出不得判断值不值得修");
  assert.match(prompt, /Human/, "必须点明哪些属外送 Human 的判断项");
});

test("prompt: 明确要求只判断区间内内容，且不得默默扩大范围（§8.4 水位段）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [], window: { items: [{ turn: 9, assistant: "材料。" }] } });
  assert.match(prompt, /只能依据本次材料判断|本次观察材料是本次运行的唯一依据/);
  assert.match(prompt, /不得.*依据材料之外|逐字引证/, "须写明只依据本次材料且要求逐字引证");
});

test("prompt: 空候选时如实说明（避免子代理误报 same-obstacle）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [], window: { items: [] } });
  assert.match(prompt, /本账本当前没有 open 账目/, "空候选须如实说明账本侧无可比对对象");
  assert.match(prompt, /还不能与既有账目比对/, "须说明「本次不能与账本比对」，而非留白");
});

test("prompt: 空观察组时如实说明（本次若观察到阻碍只能是 new-observation）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [], window: { items: [] } });
  assert.match(prompt, /观察缓冲当前没有待晋升的组/, "空观察组须如实说明");
  assert.match(prompt, new RegExp(`只能是 ${NEW_STATE_NAME}`), "须点名「新观察」那一态");
});

test("prompt: 任务段按**四态**表述，且旧名 new-obstacle 不再出现（11 §9 四态闭集）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: CANDIDATES, window: { items: [{ turn: 1, assistant: "材料。" }] } });
  // 判据取「**定义行**」而非「字符串出现过」——四态名在别处（如两态都要填齐那段）
  // 也会出现，只查出现过就测不出「某一态的定义被删掉」。
  for (const v of ["same-obstacle", "same-observation-group", "new-observation", "no-discovery"]) {
    assert.match(prompt, new RegExp(`- \`${v}\`：`), `提示词须逐态定义：${v}`);
  }
  assert.ok(!prompt.includes("new-obstacle"), "旧名不得再出现（它曾直接建账目，语义已变）");
  assert.match(prompt, /四态/, "须明示这是四态（不是三态）");
});

test("prompt: 交付观察组清单（组键 + 条数 + 现象），使子代理能判断并入哪个组（11 §9 第 1 项第二层）", () => {
  // **两层查重**：只给账本候选而不给观察组清单，子代理每次都把同一阻碍判成新组，
  // 聚合永远到不了 N（§9 第 3 项）。
  const prompt = buildDiscoveryPromptSection({ threshold: 3, candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS });
  assert.match(prompt, /观察缓冲中已有的组/, "须有一节列出观察组");
  assert.ok(prompt.includes("ci-slow-build"), "组键须可见（否则无从产出 group）");
  assert.match(prompt, /已有 2 次观察/, "须给出组内条数（机械层按 N 判晋升，子代理据此理解形状）");
  assert.ok(prompt.includes("CI 平均 8 分钟。"), "须给出组内现象摘要（供归属判断）");
});

test("prompt: 任务段列出 group 与 attribution 两个字段，并写明归因不得省略（26 §8）", () => {
  const prompt = buildDiscoveryPromptSection({ threshold: 3, candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS });
  assert.match(prompt, /`group`/, "须列出 group 字段");
  assert.match(prompt, /`attribution`/, "须列出 attribution 字段");
  assert.match(prompt, /`attribution`[^。]{0,40}必填/, "须写明归因必填");
  assert.match(prompt, /不得写「暂缺」/, "须禁止用「暂缺」冒充归因");
});

test("prompt: 明示判断**不直接创建账目**（观察层只归组，晋升由机械层按 N 决定，11 §9 第 2/3 项）", () => {
  const prompt = buildDiscoveryPromptSection({ threshold: 3, candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS });
  assert.match(prompt, /不会直接创建账目/, "须纠正旧语义（子代理的产出不再是账目）");
  assert.match(prompt, /两层/, "须讲清账本层与观察层");
});

test("prompt: 未给出区间时要求子代理声明其边界（不自行假定）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [] });
  assert.match(prompt, /本次窗口为空/, "未给窗口内容时须明示为空，而非让子代理自行界定");
  assert.match(prompt, /不得凭你可见的其他上下文编造发现/);
});

test("prompt: 不得由子代理自行数条目数（计数属机械层，11 §9 第 3 项）", () => {
  // 2026-10 修订后计数的对象变了：不再是账目的 occurrence.count，而是**组内 pending
  // 条目数**（11 §9 第 3 项：达 N 即晋升）。无论数什么，都不由子代理数。
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: CANDIDATES, window: { items: [{ turn: 1, assistant: "w" }] } });
  assert.match(prompt, /不得自己数/);
});

test("prompt: 任务段接受观察组清单参数而不报错（provider 已按 2026-10 修订传入；单任务兼容入口的转发问题见文末 todo）", () => {
  // provider 现在按 `{ threshold, candidates, observationGroups }` 调任务段
  // （friction-discovery-provider.js:336）——契约侧收下这个参数不得抛错，
  // 且组清单须真的进了提示词（内容由上一条断言）。
  const section = buildDiscoveryPromptSection({ threshold: 3, candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS });
  assert.match(section, /N=3/, "任务段须带机械前提");
  assert.match(section, /same-obstacle/, "任务段须说明既有账目那一态");
});

// ---------------------------------------------------------------------------
// 落地前校验（跨态约束）
// ---------------------------------------------------------------------------

test("validate: no-discovery 合法（其余字段可为空串）", () => {
  const r = validateDiscoveryVerdict(verdict(), { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS });
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.verdict, "no-discovery");
  // 无发现态不要求任何观察层字段（group / attribution / title 等皆为空串）。
  assert.equal(r.value.group, "");
  assert.equal(r.value.attribution, "");
  assert.equal(r.value.target_uid, "");
});

test("validate: verdict 越界被拒", () => {
  const r = validateDiscoveryVerdict(verdict({ verdict: "maybe" }), { candidates: CANDIDATES });
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/verdict_out_of_set");
});

test("validate: no-discovery 的必填字段逐个缺失均被拒（quote 与 reason；非空窗口下 quote 必填）", () => {
  // 四态各有各的必填字段集，逐态钉住：
  //   same-obstacle         → target_uid
  //   same-observation-group → group + title + phenomenon + basis + attribution
  //   new-observation       → group + title + phenomenon + basis + attribution
  //   no-discovery          → quote（非空窗口时）+ reason
  const windowText = "[turn 1]\nassistant: 这里有大量内容，其中包含一段可引证原文。";
  for (const field of ["quote", "reason"]) {
    const r = validateDiscoveryVerdict(
      verdict({ verdict: "no-discovery", [field]: "" }),
      { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS, windowText },
    );
    assert.ok(!r.ok, `${field} missing must be rejected`);
    assert.equal(r.error.code, `discovery/${field}_missing`);
  }
});

test("validate: 已改名的旧名 new-obstacle 不得再交出来（11 §9 四态闭集）", () => {
  const r = validateDiscoveryVerdict(
    observationVerdict({ verdict: "new-obstacle" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(!r.ok, "旧名曾直接建账目，语义已变，不得再被接受");
  assert.equal(r.error.code, "discovery/verdict_out_of_set");
});

test("validate: reason 必填（须指回本次区间）", () => {
  const r = validateDiscoveryVerdict(verdict({ reason: "   " }), { candidates: CANDIDATES });
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/reason_missing");
});

test("validate: 非对象输入被拒（结构化通道理论上交不出，仍须兜底）", () => {
  for (const bad of [null, undefined, "text", 42]) {
    const r = validateDiscoveryVerdict(bad, { candidates: [] });
    assert.ok(!r.ok, `${JSON.stringify(bad)} must be rejected`);
    assert.equal(r.error.code, "discovery/verdict_malformed");
  }
});

test("validate: 通过时返回已 trim 的规范形态（含新增的 group 与 attribution）", () => {
  const r = validateDiscoveryVerdict(
    observationVerdict({
      verdict: "new-observation",
      group: "  ci-slow-build  ",
      title: "  带空格的标题  ",
      phenomenon: " P。 ",
      basis: " B。 ",
      attribution: " A。 ",
      reason: "  据该引证判断。  ",
      quote: "  某段材料原文内容。  ",
    }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.group, "ci-slow-build");
  assert.equal(r.value.title, "带空格的标题");
  assert.equal(r.value.phenomenon, "P。");
  assert.equal(r.value.basis, "B。");
  assert.equal(r.value.attribution, "A。");
  assert.equal(r.value.reason, "据该引证判断。");
  // 引证**不得被 trim 改写**——它须与材料里的原文逐字一致（§11 水位段）。
  assert.equal(r.value.quote, "  某段材料原文内容。  ");
});

// ---------------------------------------------------------------------------
// 态一：same-obstacle（与既有 open 账目同一阻碍 → 11 §9 第 4 项补充级更新）
// ---------------------------------------------------------------------------

test("validate: same-obstacle 缺 target_uid 被拒", () => {
  const r = validateDiscoveryVerdict(verdict({ verdict: "same-obstacle", target_uid: "", quote: "某段材料原文内容。" }), { candidates: CANDIDATES });
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/target_uid_missing");
});

test("validate: same-obstacle 指向本次未提供的 uid 被拒（只能指它见过的账目）", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "same-obstacle", target_uid: "99999999-8888-4777-8666-555555555555", quote: "某段材料原文内容。" }),
    { candidates: CANDIDATES },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/target_uid_unknown");
});

test("validate: same-obstacle 指向候选内的 uid 通过（uid 首尾空白被 trim 后仍命中）", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "same-obstacle", target_uid: `  ${CANDIDATES[0].object_uid}  `, quote: "某段材料原文内容。" }),
    { candidates: CANDIDATES },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.target_uid, CANDIDATES[0].object_uid);
});

test("validate: same-obstacle 只认 target_uid，不要求观察层字段（11 §9 第 4 项是补充级更新，不建条目）", () => {
  // 观察层的 group/title/phenomenon/basis/attribution 是**写缓冲条目**时才需要的；
  // 补充级更新只落在既有账目上，故这一态不要求它们。
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "same-obstacle", target_uid: CANDIDATES[0].object_uid, quote: "某段材料原文内容。" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.group, "");
  assert.equal(r.value.attribution, "");
});

// ---------------------------------------------------------------------------
// 态二：same-observation-group（与缓冲中某个 pending 组同一阻碍 → 11 §9 第 2/3 项）
// ---------------------------------------------------------------------------

test("validate: same-observation-group 必填字段逐个缺失均被拒（11 §9 第 2/3 项）", () => {
  for (const field of ["group", "title", "phenomenon", "basis", "attribution"]) {
    const r = validateDiscoveryVerdict(
      observationVerdict({ verdict: "same-observation-group", group: "ci-slow-build", [field]: "" }),
      { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
    );
    assert.ok(!r.ok, `${field} missing must be rejected`);
    assert.equal(r.error.code, `discovery/${field}_missing`);
  }
});

test("validate: same-observation-group 的 group 不在本次观察组清单内被拒（不得凭空并组）", () => {
  const r = validateDiscoveryVerdict(
    observationVerdict({ verdict: "same-observation-group", group: "not-shown-this-run" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(!r.ok, "并入一个本次没给过的组 → 落地侧无从核对，机械层必须拦下");
  assert.equal(r.error.code, "discovery/group_unknown");
});

test("validate: same-observation-group 命中观察组清单内的 group 通过", () => {
  const r = validateDiscoveryVerdict(
    observationVerdict({ verdict: "same-observation-group", group: "hook-missing-node" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.group, "hook-missing-node");
});

test("validate: same-observation-group 缺 attribution 被拒（两态都必填——晋升那一条不得缺归因）", () => {
  const r = validateDiscoveryVerdict(
    observationVerdict({ verdict: "same-observation-group", group: "ci-slow-build", attribution: "" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(!r.ok, "缺归因必须被拒（本次修订的关键新增字段）");
  assert.equal(r.error.code, "discovery/attribution_missing");
});

// ---------------------------------------------------------------------------
// 态三：new-observation（账本与缓冲都没有的新阻碍 → 11 §9 第 2 项开新组）
// ---------------------------------------------------------------------------

test("validate: new-observation 必填字段逐个缺失均被拒（11 §9 第 2 项）", () => {
  for (const field of ["group", "title", "phenomenon", "basis", "attribution"]) {
    const r = validateDiscoveryVerdict(
      observationVerdict({ verdict: "new-observation", group: "ci-slow-build", [field]: "" }),
      { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
    );
    assert.ok(!r.ok, `${field} missing must be rejected`);
    assert.equal(r.error.code, `discovery/${field}_missing`);
  }
});

test("validate: new-observation 缺 attribution 被拒（本次修订的关键新增字段——晋升出的账目不得缺归因）", () => {
  // 既有缺陷：机械通道入账 95/97 条缺归因。归因须**每次**都填——因为这一条可能
  // 正是攒够 N 的那一条，届时它要立刻晋升为账目（11 §9 第 3 项）。
  const r = validateDiscoveryVerdict(
    observationVerdict({ verdict: "new-observation", attribution: "" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(!r.ok, "缺归因必须被拒");
  assert.equal(r.error.code, "discovery/attribution_missing");
});

test("validate: new-observation 缺 group 被拒（组键是阈值判定的聚合维度，11 §9 第 3 项）", () => {
  const r = validateDiscoveryVerdict(
    observationVerdict({ verdict: "new-observation", group: "" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/group_missing");
});

test("validate: new-observation 的 group 无需在观察组清单内（新组键由子代理新起）", () => {
  // **反证**：与 same-observation-group 相反，new-observation 是「开新组」，故其组键
  // 本就不在清单里。机械层只做相等比较，不判断两个组键是否指向同一阻碍
  //（11 §12bis.1「机械层不判断两个 group 值是否指向同一阻碍」——那是 §9 第 1 项的
  // 语义判断，登记为 gap）。
  const r = validateDiscoveryVerdict(
    observationVerdict({ verdict: "new-observation", group: "brand-new-group" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.group, "brand-new-group");
});

test("validate: 同一个组键在两态的判定相反（反证：成员关系才是两态的分界）", () => {
  const opts = { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS };
  const asNew = validateDiscoveryVerdict(observationVerdict({ verdict: "new-observation", group: "brand-new-group" }), opts);
  const asSame = validateDiscoveryVerdict(observationVerdict({ verdict: "same-observation-group", group: "brand-new-group" }), opts);
  assert.ok(asNew.ok, JSON.stringify(asNew.error));
  assert.ok(!asSame.ok, "该组不在清单内 → 报 same-observation-group 必须被拒");
  assert.equal(asSame.error.code, "discovery/group_unknown");
});

test("validate: new-observation 的 impact 必须在闭集内", () => {
  const r = validateDiscoveryVerdict(
    observationVerdict({ verdict: "new-observation", impact: "critical" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/impact_out_of_set");
});

test("validate: new-observation 的 title 超 30 字被拒（26 §8）", () => {
  const r = validateDiscoveryVerdict(
    observationVerdict({ verdict: "new-observation", title: "x".repeat(31) }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/title_too_long");
});

test("validate: same-observation-group 的 impact 与 title 约束与 new-observation 同（两态共用一组必填字段）", () => {
  const opts = { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS };
  const badImpact = validateDiscoveryVerdict(
    observationVerdict({ verdict: "same-observation-group", group: "ci-slow-build", impact: "critical" }),
    opts,
  );
  assert.ok(!badImpact.ok);
  assert.equal(badImpact.error.code, "discovery/impact_out_of_set");

  const longTitle = validateDiscoveryVerdict(
    observationVerdict({ verdict: "same-observation-group", group: "ci-slow-build", title: "x".repeat(31) }),
    opts,
  );
  assert.ok(!longTitle.ok);
  assert.equal(longTitle.error.code, "discovery/title_too_long");
});

// ---------------------------------------------------------------------------
// D1：逐字引证 + 机械核对（§8.4 水位段——切分依据不得由 AI 判断）
// ---------------------------------------------------------------------------

test("validate: 非 no-discovery 缺 quote 被拒（无引证则无从核对其依据来自本次材料）", () => {
  for (const v of ["same-obstacle", "same-observation-group", "new-observation"]) {
    const r = validateDiscoveryVerdict(
      observationVerdict({ verdict: v, target_uid: CANDIDATES[0].object_uid, group: "ci-slow-build", quote: "" }),
      { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS },
    );
    assert.ok(!r.ok, `${v} without quote must be rejected`);
    assert.equal(r.error.code, "discovery/quote_missing");
  }
});

test("validate: 提供了 windowText 时，**窗口外的引证被拒**（D1 的机械判定点）", () => {
  const windowText = "[turn 4]\nassistant: 这次构建在链接阶段失败了。";
  const r = validateDiscoveryVerdict(
    observationVerdict({
      verdict: "new-observation",
      title: "构建失败",
      phenomenon: "链接阶段失败。",
      basis: "可归因于依赖版本。",
      attribution: "依赖版本未锁定。",
      quote: "这是一段并不在上述材料里的内容，子代理凭上下文自行回忆出来的。",
    }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS, windowText },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/quote_not_in_window");
});

test("validate: 引证确实在窗口内则通过（正例，证明上一条不是恒拒）", () => {
  const windowText = "[turn 4]\nassistant: 这次构建在链接阶段失败了。";
  const r = validateDiscoveryVerdict(
    observationVerdict({
      verdict: "new-observation",
      title: "构建失败",
      phenomenon: "链接阶段失败。",
      basis: "可归因于依赖版本。",
      attribution: "依赖版本未锁定。",
      quote: "这次构建在链接阶段失败了。",
      reason: "据该引证判断。",
    }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS, windowText },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.quote, "这次构建在链接阶段失败了。");
});

test("发现④：no-discovery 在**非空窗口**下也须引证（否则「恒报无发现」无从发现）", () => {
  const windowText = "[turn 1]\nassistant: 这里有大量内容，其中包含一段可引证原文。";
  const missing = validateDiscoveryVerdict(
    verdict({ verdict: "no-discovery", quote: "" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS, windowText },
  );
  assert.ok(!missing.ok, "非空窗口下 no-discovery 免引证 → 恒报无发现的失效不可见");
  assert.equal(missing.error.code, "discovery/quote_missing");

  const withQuote = validateDiscoveryVerdict(
    verdict({ verdict: "no-discovery", quote: "这里有大量内容，其中包含一段可引证原文。" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS, windowText },
  );
  assert.ok(withQuote.ok, JSON.stringify(withQuote.error));
});

test("发现④：**空窗口**下 no-discovery 的引证必须为空（那时无从引证）", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "no-discovery", quote: "" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS, windowText: "" },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
});

test("发现④：no-discovery 引证窗口外文本同样被拒（引证核对不因判定态而放松）", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "no-discovery", quote: "这是我凭上下文回忆出来的一段内容。" }),
    { candidates: CANDIDATES, observationGroups: OBSERVATION_GROUPS, windowText: "[turn 1]\nassistant: 材料里的原文。" },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/quote_not_in_window");
});

test("prompt: 窗口材料以**内容本身**交付，且明示唯一依据 + 引证要求", () => {
  const prompt = buildDiscoveryPrompt({
    threshold: 3,
    candidates: [],
    window: { items: [{ turn: 2, user: "问题", assistant: "回答内容。" }], truncated: false },
  });
  assert.match(prompt, /\[turn 2\]/);
  assert.match(prompt, /user: 问题/);
  assert.match(prompt, /assistant: 回答内容。/);
  assert.match(prompt, /逐字引证/);
  assert.match(prompt, /引证不在材料中即判定该判断不成立/);
});

test("prompt: 材料被截断时如实告知（截断有损，不得静默）", () => {
  const prompt = buildDiscoveryPrompt({
    threshold: 3,
    candidates: [],
    window: { items: [{ turn: 1, assistant: "x", truncated: true }], truncated: true },
  });
  assert.match(prompt, /截断/);
});

test("prompt: 空窗口明示「只能报 no-discovery 且 quote 为空」", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [], window: { items: [] } });
  // 措辞于 2026-10-11 改为**多任务通用**：「每一件都只能报对应的『无发现』态」。
  // 本条断言的是**语义**（空材料下只能报无发现且 quote 为空），故按语义匹配，
  // 不锁死某一种措辞——锁死措辞会使任何非实质改写都触发失败，那不是它的目的。
  assert.match(prompt, /只能.{0,6}报[^。]{0,12}(no-discovery|无发现)/);
  // 字段名在新措辞里带反引号（Markdown 行内代码），故匹配时容忍两侧反引号。
  assert.match(prompt, /`?quote`? 必须为空字符串/);
});

// ---------------------------------------------------------------------------
// 材料边界（2026-10-11 修复）：引文失败率 3/10 的根因
// ---------------------------------------------------------------------------
//
// 实测背景：10 次运行中 3 次被机械引证核对拒绝，其中 2 次引的是**工具输出**。
// 根因不是执行体「不听话」——是**材料交付有缺陷**：
//   ① 材料只交付内容、没有边界标记，执行体（fork 起、继承完整上下文）无从
//      判断某一句到底在不在材料里；
//   ② prompt 只说「不得依据材料之外的内容」，却从未说明**工具输出一律不在
//      材料中**——而工具输出从不进窗口（窗口只收 user/message 与
//      assistant/message），正是执行体最容易误取的一类（本会话里工具输出
//      224 万字符，是助手文本的 10 倍）。
// 这三次都是**机器判定正确、材料交付有缺陷**：拒绝对，但本可避免。

test("材料自带机械可判的边界标记（执行体据此判断引文在不在材料里）", () => {
  const prompt = buildDiscoveryPrompt({
    threshold: 3,
    candidates: [],
    window: { items: [{ turn: 7, user: "用户提问", assistant: "助手回答" }] },
  });

  // 标记会出现**两次**：一次在说明文字里（教执行体去找它），一次是材料本身的
  // 边界。**必须用 lastIndexOf 取材料那一次**——用 indexOf 会命中说明文字，
  // 那正是本人的第一版断言踩的坑（`材料正文须夹在边界标记之间` 失败）。
  const begin = prompt.lastIndexOf(WINDOW_OPEN);
  const close = prompt.lastIndexOf(WINDOW_CLOSE);
  assert.ok(begin >= 0, `材料须有开始标记 ${WINDOW_OPEN}`);
  assert.ok(close >= 0, `材料须有结束标记 ${WINDOW_CLOSE}`);
  assert.ok(begin < close, "开始标记须在结束标记之前（否则边界无意义）");
  // 材料正文夹在两者之间——且这是**材料那一段**，不是说明文字。
  const body = prompt.slice(begin, close);
  assert.match(body, /\[turn 7\]/, "材料正文须夹在边界标记之间");
  // 说明文字里也有标记（执行体据此照找），两处都须在。
  assert.ok(prompt.indexOf(WINDOW_OPEN) < begin, "说明文字须先教它找标记，材料再给标记");
});

test("prompt 明确告知**工具输出不在材料里**（此前从未提及，是 2/3 被拒引文的出处）", () => {
  const prompt = buildDiscoveryPrompt({
    threshold: 3,
    candidates: [],
    window: { items: [{ turn: 7, user: "u", assistant: "a" }] },
  });

  // 判据要**贴着那一条**：点出「工具输出」且同一行里说它不在材料里。
  // 早先写成两个独立 match（/工具输出/ 与 /不在材料里/）——撤掉该条后二者
  // 仍各自命中别处，护栏**测不出来**（实测：撤掉后失败数仍为 0）。
  assert.match(
    prompt,
    /工具调用与工具输出的一切内容都不在材料里/,
    "须在同一句里点名「工具输出不在材料里」——两个词分开匹配测不出该条的缺失",
  );
  // **工具输入**也须点名（2026-10-11 实测缺口）：一次被拒引文来自提交信息的
  // heredoc——那是**命令参数**，不是工具输出，故既有的「工具输出」措辞盖不住它。
  assert.match(prompt, /工具输入/, "须点名工具输入（旧措辞只说工具输出，漏掉 heredoc 这类）");
  assert.match(prompt, /heredoc/, "须具体举例 heredoc——那是实测踩到的形态，不举例则执行体想不到");
  // 还须说明「只有 user:/assistant: 行可引」，给出正向判据。
  assert.match(prompt, /user:.*assistant:/s, "须给出可引内容的正文形态");
});

test("**累积语义**：一轮多条 assistant 消息都须进材料（旧实现只留最后一条）", () => {
  // 提示词侧要说清「材料里的 assistant: 行是一轮正文的累积」这一事实不算必要，
  // 但它**不得**宣称「每轮只有一条」。此测试守的是 prompt 与该语义不冲突：
  // 材料由 renderWindowText 渲染，本测试直接验渲染结果含全部消息。
  const prompt = buildDiscoveryPrompt({
    threshold: 3,
    candidates: [],
    window: { items: [{ turn: 7, user: "提问", assistant: "第一条正文\n\n第二条正文" }] },
  });
  assert.ok(prompt.includes("第一条正文"), "材料须含第一条（累积语义的直接体现）");
  assert.ok(prompt.includes("第二条正文"), "材料须含第二条");
});

test("边界标记**不给**核对方：引标记本身须被拒（否则是一个无意义的通过面）", () => {
  const items = [{ turn: 7, user: "用户提问", assistant: "助手回答某阻碍。" }];
  const body = windowBody(items);

  // 核对用的正文不含标记。
  assert.doesNotMatch(body, /WINDOW-BEGIN|WINDOW-END/, "被核对正文不得含边界标记");
  // 故引标记本身会被判不在材料中。
  const r = verifyQuotation(WINDOW_OPEN, body, { minChars: 8 });
  assert.equal(r.ok, false, "引边界标记本身须被拒（它不在正文里）");
  assert.equal(r.error.code, "discovery/quote_not_in_window");
});

test("两级渲染同源：提示词那份去掉标记后与核对那份**逐字相同**（防两处漂移）", () => {
  // 这是 D5 那类「两处各写一套」的防线：核对是 includes 字符串比对，任何漂移
  // 都会使**所有**引证无故被拒，且失败形态与「引错地方」无从区分。
  const items = [
    { turn: 1, user: "甲", assistant: "乙" },
    { turn: 2, assistant: "丙\n丁" },
  ];
  const rendered = renderWindowText(items);
  const body = windowBody(items);

  // 去掉标记行即得正文（同源性的机械判据）。
  const stripped = rendered
    .split("\n")
    .filter((line) => line !== WINDOW_OPEN && line !== WINDOW_CLOSE)
    .join("\n");
  assert.equal(stripped, body, "windowBody 必须是 renderWindowText 去掉标记行的结果");

  // 正文里的内容必须真能通过核对（说明两处口径一致）。
  assert.equal(verifyQuotation("丙", body, { minChars: 1 }).ok, true);
});

test("空窗口：材料段**不含**边界标记（空材料不该有边界；此时只能报 no-discovery）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [], window: { items: [] } });
  // 说明文字里仍会提到标记（告诉执行体边界长什么样）——故**不能**断言全文不含
  // 标记。判据是：标记只出现在说明文字里，材料段本身没有。
  assert.match(prompt, /本次窗口为空/, "空窗口须说明只能报 no-discovery");
  assert.equal(windowBody([]), "", "空窗口的被核对正文为空串");
  assert.equal(windowBody(undefined), "", "未提供窗口时同样为空串");
  assert.equal(renderWindowText([]), "", "空窗口不渲染材料（也就没有边界标记）");
  assert.equal(renderWindowText(undefined), "", "未提供窗口时同样不渲染");
});

// ---------------------------------------------------------------------------
// 已知缺口（待 lib/ 修订后启用；本次**不修改 lib/**）
// ---------------------------------------------------------------------------
//
// 单任务兼容入口 `buildDiscoveryPrompt` **不转发 `observationGroups`**——它调
// `buildDiscoveryPromptSection({ threshold, candidates })`，故该入口生成的提示词
// 恒称「观察缓冲当前没有待晋升的组」，即使本次确有观察组。
//
// 影响面有限：生产路径走 `aux-task-registry.js` 的任务段（provider 直接调
// `buildDiscoveryPromptSection` 并传入 `observationGroups`），故真实派发不受影响；
// 受影响的是**测试与诊断路径**（aux-task-registry.test.mjs 的「两条路径逐字相同」
// 断言也据此把观察组排除在比较之外）。
//
// 修订后应成立：`buildDiscoveryPrompt({ threshold, candidates, observationGroups })`
// 与 `buildDiscoveryPromptSection({ threshold, candidates, observationGroups })`
// 在同一组前提下产出**逐字相同**的任务段。
test.todo("单任务兼容入口须转发 observationGroups（当前恒称缓冲为空，测试与诊断路径受影响）");

// ---------------------------------------------------------------------------
// 第三层：Pitfall 侧候选进入提示词（11 §9 第 1 项，2026-10-28）
//
// 首轮的缺陷是「规范要求三层、实现只交付两层」——执行体看不见同源的 Pitfall，
// 于是 paired-with 永远建不起来。此用例钉住第三层的渲染。
// ---------------------------------------------------------------------------

test("discovery prompt renders the cross-type (Pitfall) layer with scope and trigger signal", async () => {
  const section = buildDiscoveryPromptSection({
    threshold: 3,
    candidates: [],
    observationGroups: [],
    crossTypeCandidates: [{
      object_uid: "abcdef01-2345-4678-8abc-def012345678",
      fact_type_key: "pitfall",
      title: "期望值与实际值同经归一化致断言恒真",
      status: "active",
      scope: "适用于断言期望值由被测代码导出的测试。",
      trigger_signal: "夹具改造后重审",
    }],
  });
  assert.match(section, /Pitfall 侧已有对象/);
  assert.match(section, /期望值与实际值同经归一化致断言恒真/);
  assert.match(section, /适用于断言期望值由被测代码导出的测试/);
  assert.match(section, /夹具改造后重审/);
  // 同源不等于放弃记账——提示词必须说清这一点，否则执行体会把跨类型同源当重复而漏记。
  assert.match(section, /不要\*\*因此放弃记这笔账/);
});

test("discovery prompt discloses an incomplete cross-type layer and forbids claiming coverage", async () => {
  const section = buildDiscoveryPromptSection({
    threshold: 3, candidates: [], observationGroups: [],
    crossTypeCandidates: [],
    crossTypeGap: "Pitfall 侧不可读，跨类型查重本层缺失：boom",
  });
  assert.match(section, /本层不完整/);
  assert.match(section, /不构成\*\*「跨类型重复已排除」的证据/);
});

test("discovery prompt truncates long scope visibly and caps the cross-type layer (cost bound, 11 §7.1)", async () => {
  const longScope = "适用于".repeat(60) + "结尾标记不应出现";
  const section = buildDiscoveryPromptSection({
    threshold: 3, candidates: [], observationGroups: [],
    crossTypeCandidates: [{
      object_uid: "abcdef01-2345-4678-8abc-def012345678",
      title: "长 scope 条目", status: "active", scope: longScope,
    }],
  });
  // Truncation must be visible ("…") and the overflow must not be dumped wholesale.
  assert.match(section, /适用范围：.{0,80}…/s);
  assert.doesNotMatch(section, /结尾标记不应出现/);
});
