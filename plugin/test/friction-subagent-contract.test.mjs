// Tests for plugin/lib/friction-subagent-contract.js —
// 04 §8.4 第 1 项语义判断的承载契约（提示词 + outputSchema + 落地前校验）.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VERDICTS,
  discoveryOutputSchema,
  buildDiscoveryPrompt,
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

const CANDIDATES = [
  { object_uid: "11111111-2222-4333-8444-555555555555", status: "observing", title: "CI 慢", phenomenon: "CI 平均 8 分钟。" },
  { object_uid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", status: "open", title: "钩子依赖 PATH", phenomenon: "提交钩子找不到 node。" },
];

function verdict(overrides = {}) {
  return {
    verdict: "no-discovery",
    target_uid: "",
    title: "",
    phenomenon: "",
    basis: "",
    impact: "light",
    quote: "",
    reason: "本次区间内没有出现反复出现的阻碍。",
    ...overrides,
  };
}

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
  assert.deepEqual([...VERDICTS], ["same-obstacle", "new-obstacle", "no-discovery"]);
});

test("schema: 所有字段都在 required 内（三态共用一套字段，跨态约束由落地侧校验）", () => {
  const s = discoveryOutputSchema();
  for (const name of Object.keys(s.properties)) {
    assert.ok(s.required.includes(name), `${name} must be required (宿主子集无条件 schema，故三态不填者交空串)`);
  }
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
  assert.match(prompt, /没有 open\/observing 账目/);
  assert.match(prompt, /只能是 new-obstacle/);
});

test("prompt: 未给出区间时要求子代理声明其边界（不自行假定）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: [] });
  assert.match(prompt, /本次窗口为空/, "未给窗口内容时须明示为空，而非让子代理自行界定");
  assert.match(prompt, /不得凭你可见的其他上下文编造发现/);
});

test("prompt: 不得由子代理自行数 count（计数属机械层）", () => {
  const prompt = buildDiscoveryPrompt({ threshold: 3, candidates: CANDIDATES, window: { items: [{ turn: 1, assistant: "w" }] } });
  assert.match(prompt, /不得自己数 count/);
});

// ---------------------------------------------------------------------------
// 落地前校验（跨态约束）
// ---------------------------------------------------------------------------

test("validate: no-discovery 合法（其余字段可为空串）", () => {
  const r = validateDiscoveryVerdict(verdict(), { candidates: CANDIDATES });
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.verdict, "no-discovery");
});

test("validate: verdict 越界被拒", () => {
  const r = validateDiscoveryVerdict(verdict({ verdict: "maybe" }), { candidates: CANDIDATES });
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/verdict_out_of_set");
});

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

test("validate: same-obstacle 指向候选内的 uid 通过", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "same-obstacle", target_uid: CANDIDATES[0].object_uid, quote: "某段材料原文内容。" }),
    { candidates: CANDIDATES },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.target_uid, CANDIDATES[0].object_uid);
});

test("validate: new-obstacle 必填字段逐个缺失均被拒", () => {
  for (const field of ["title", "phenomenon", "basis"]) {
    const r = validateDiscoveryVerdict(
      verdict({ verdict: "new-obstacle", title: "T", phenomenon: "P 现象。", basis: "B 依据。", quote: "某段材料原文内容。", [field]: "" }),
      { candidates: CANDIDATES },
    );
    assert.ok(!r.ok, `${field} missing must be rejected`);
    assert.equal(r.error.code, `discovery/${field}_missing`);
  }
});

test("validate: new-obstacle 的 impact 必须在闭集内", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "new-obstacle", title: "T", phenomenon: "P。", basis: "B。", quote: "某段材料原文内容。", impact: "critical" }),
    { candidates: CANDIDATES },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/impact_out_of_set");
});

test("validate: new-obstacle 的 title 超 30 字被拒（26 §8）", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "new-obstacle", title: "x".repeat(31), phenomenon: "P。", basis: "B。", quote: "某段材料原文内容。" }),
    { candidates: CANDIDATES },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/title_too_long");
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

test("validate: 通过时返回已 trim 的规范形态", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "new-obstacle", title: "  带空格的标题  ", phenomenon: " P。 ", basis: " B。 ", quote: "某段材料原文内容。" }),
    { candidates: CANDIDATES },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.title, "带空格的标题");
  assert.equal(r.value.phenomenon, "P。");
  assert.equal(r.value.basis, "B。");
});

// ---------------------------------------------------------------------------
// D1：逐字引证 + 机械核对（§8.4 水位段——切分依据不得由 AI 判断）
// ---------------------------------------------------------------------------

test("validate: 非 no-discovery 缺 quote 被拒（无引证则无从核对其依据来自本次材料）", () => {
  for (const v of ["same-obstacle", "new-obstacle"]) {
    const r = validateDiscoveryVerdict(
      verdict({ verdict: v, target_uid: CANDIDATES[0].object_uid, title: "T", phenomenon: "P。", basis: "B。", quote: "" }),
      { candidates: CANDIDATES },
    );
    assert.ok(!r.ok, `${v} without quote must be rejected`);
    assert.equal(r.error.code, "discovery/quote_missing");
  }
});

test("validate: 提供了 windowText 时，**窗口外的引证被拒**（D1 的机械判定点）", () => {
  const windowText = "[turn 4]\nassistant: 这次构建在链接阶段失败了。";
  const r = validateDiscoveryVerdict(
    verdict({
      verdict: "new-obstacle",
      title: "构建失败",
      phenomenon: "链接阶段失败。",
      basis: "可归因于依赖版本。",
      quote: "这是一段并不在上述材料里的内容，子代理凭上下文自行回忆出来的。",
    }),
    { candidates: CANDIDATES, windowText },
  );
  assert.ok(!r.ok);
  assert.equal(r.error.code, "discovery/quote_not_in_window");
});

test("validate: 引证确实在窗口内则通过（正例，证明上一条不是恒拒）", () => {
  const windowText = "[turn 4]\nassistant: 这次构建在链接阶段失败了。";
  const r = validateDiscoveryVerdict(
    verdict({
      verdict: "new-obstacle",
      title: "构建失败",
      phenomenon: "链接阶段失败。",
      basis: "可归因于依赖版本。",
      quote: "这次构建在链接阶段失败了。",
      reason: "据该引证判断。",
    }),
    { candidates: CANDIDATES, windowText },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.value.quote, "这次构建在链接阶段失败了。");
});

test("发现④：no-discovery 在**非空窗口**下也须引证（否则「恒报无发现」无从发现）", () => {
  const windowText = "[turn 1]\nassistant: 这里有大量内容，其中包含一段可引证原文。";
  const missing = validateDiscoveryVerdict(
    verdict({ verdict: "no-discovery", quote: "" }),
    { candidates: CANDIDATES, windowText },
  );
  assert.ok(!missing.ok, "非空窗口下 no-discovery 免引证 → 恒报无发现的失效不可见");
  assert.equal(missing.error.code, "discovery/quote_missing");

  const withQuote = validateDiscoveryVerdict(
    verdict({ verdict: "no-discovery", quote: "这里有大量内容，其中包含一段可引证原文。" }),
    { candidates: CANDIDATES, windowText },
  );
  assert.ok(withQuote.ok, JSON.stringify(withQuote.error));
});

test("发现④：**空窗口**下 no-discovery 的引证必须为空（那时无从引证）", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "no-discovery", quote: "" }),
    { candidates: CANDIDATES, windowText: "" },
  );
  assert.ok(r.ok, JSON.stringify(r.error));
});

test("发现④：no-discovery 引证窗口外文本同样被拒（引证核对不因三态而放松）", () => {
  const r = validateDiscoveryVerdict(
    verdict({ verdict: "no-discovery", quote: "这是我凭上下文回忆出来的一段内容。" }),
    { candidates: CANDIDATES, windowText: "[turn 1]\nassistant: 材料里的原文。" },
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
  assert.match(prompt, /只能.*报 no-discovery|只能报 `no-discovery`/);
  assert.match(prompt, /quote 必须为空字符串/);
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
    /工具输出[^\n]*不在材料里/,
    "须在同一句里点名「工具输出不在材料里」——两个词分开匹配测不出该条的缺失",
  );
  // 还须说明「只有 user:/assistant: 行可引」，给出正向判据。
  assert.match(prompt, /user:.*assistant:/s, "须给出可引内容的正文形态");
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
