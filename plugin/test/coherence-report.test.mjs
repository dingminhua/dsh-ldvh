
import { test } from "node:test";
import assert from "node:assert/strict";

import { COHERENCE_CLIP, clipped, carrierCoherenceMessage } from "../lib/coherence-report.js";

const LONG = "这是一段足够长的字段值用来触发截断并检查是否注明了真实总长".repeat(20);
const BODY_MARK = "正文里写着完全不同的内容";

function assertTwoSided(message, { declared, actual, clause }) {
  assert.ok(
    message.includes(declared.slice(0, 20)),
    `报错必须含 frontmatter 字段值（至少前缀可辨），实际：${message.slice(0, 120)}`,
  );
  assert.ok(
    message.includes(actual),
    `报错必须含正文该段内容，实际：${message.slice(0, 120)}`,
  );
  if (clause !== undefined) {
    assert.ok(
      message.includes(clause),
      `报错须带该类型的实际条款依据 ${clause}，实际：${message.slice(0, 160)}`,
    );
  }
}


test("clipped：未超限原样返回，超限截断并注明真实总长", () => {
  const short = "短文本";
  assert.equal(clipped(short), short, "未超限不应改动内容，也不应加省略号");
  const long = "x".repeat(COHERENCE_CLIP + 50);
  const out = clipped(long);
  assert.ok(out.startsWith("x".repeat(COHERENCE_CLIP)), "保留前 400 字");
  assert.ok(out.includes(`共 ${long.length} 字`), "必须注明真实总长，否则读者不知差多远");
  assert.ok(out.endsWith("）"), "截断标记须闭合");
});

test("carrierCoherenceMessage：两侧都给、条款号由调用方决定", () => {
  const msg = carrierCoherenceMessage({
    section: "决定",
    field: "decision",
    declared: "字段侧原文",
    actual: "正文侧原文",
    clause: "22 §8",
  });
  assert.ok(msg.includes("决定"), "须指明是哪个正文段");
  assert.ok(msg.includes("decision"), "须指明是哪个字段");
  assert.ok(msg.includes("22 §8"), "条款号须是调用方给的那个");
  assert.ok(msg.includes("字段侧原文") && msg.includes("正文侧原文"), "两侧都必须出现");
});

test("carrierCoherenceMessage：不给条款号时不伪造一个", () => {
  const msg = carrierCoherenceMessage({ section: "s", field: "f", declared: "a", actual: "b" });
  assert.ok(!msg.includes("§"), "没有依据就不应出现章节号——编造条款比缺条款更糟");
});


const CASES = [
  {
    type: "friction",
    file: "friction-writer.js",
    fn: "validateCarrierCoherence",
    frontmatter: { phenomenon: LONG },
    body: `# T\n\n## 现象\n\n${BODY_MARK}\n`,
    clause: "26 §8",
  },
  {
    type: "pitfall",
    file: "pitfall-writer.js",
    fn: "validateCarrierCoherence",
    frontmatter: { scope: LONG },
    body: `# T\n\n## 影响与适用范围\n\n${BODY_MARK}\n`,
    clause: "25 §8",
  },
  {
    type: "spark",
    file: "spark-writer.js",
    fn: "validateCarrierCoherence",
    frontmatter: { summary: LONG },
    body: `# T\n\n## 当前理解\n\n${BODY_MARK}\n`,
    clause: "20 §14.1",
  },
  {
    type: "subgoal",
    file: "subgoal-writer.js",
    fn: "validateCarrierCoherence",
    frontmatter: { criterion: LONG, alignment: "x" },
    body: `# T\n\n## 达成条件\n\n${BODY_MARK}\n`,
    clause: "28 §8",
  },
];

for (const c of CASES) {
  test(`${c.type}：内聚拒绝同时给出字段值与正文段（条款 ${c.clause ?? "无"}）`, async () => {
    const mod = await import(new URL(`../lib/${c.file}`, import.meta.url).href);
    const fn = mod[c.fn];
    assert.equal(typeof fn, "function", `${c.file} 应导出 ${c.fn}`);
    const result = fn(c.frontmatter, c.body);
    const all = [...(result.issues ?? []), ...(result.warnings ?? [])];
    assert.ok(all.length > 0, `${c.type} 的该输入应被判不符（issues 或 warnings 非空）`);
    const message = all.join("\n");
    assertTwoSided(message, { declared: LONG, actual: BODY_MARK, clause: c.clause });
    assert.ok(message.length < 1200, `${c.type} 报错过长（${message.length}），截断可能失效`);
  });
}


test("research：question-coherence 同样给出两侧（24 §8 invariant 10）", async () => {
  const mod = await import(new URL("../lib/report-writer.js", import.meta.url).href);
  const question = LONG;
  const frontmatter = {
    research_question: question,
    research_purpose: "p",
    stopping_reason: "sufficient",
    urls: [{ ref: "https://example.com/x" }],
    title: "t",
    status: "active",
  };
  const body = `# T\n\n## 研究问题\n\n${BODY_MARK}\n\n## 输入与边界\n\nx\n\n## 关键发现\n\nx\n`
    + `\n## 未证实与缺口\n\nx\n\n## 建议\n\nx\n\n## 后续分流\n\nx\n`;
  const result = await mod.validateIndexBodyCoherence(frontmatter, body);
  assert.equal(result.ok, false);
  assertTwoSided(result.issues.join("\n"), { declared: question, actual: BODY_MARK, clause: "24 §8" });
});


test("norm：direction_key 一致性拒绝引用 23 §7（不是 §8）", async () => {
  const mod = await import(new URL("../lib/norm-writer.js", import.meta.url).href);
  const result = mod.validateCarrierCoherence({ direction_key: "aa-bb" }, "# T\n\n## 核心规则体系\n\ndirection_key: zz-yy\n");
  assert.equal(result.ok, false);
  const message = result.issues.join("\n");
  assert.ok(message.includes("23 §7"), `应引 23 §7（载体内聚所在），实际：${message}`);
  assert.ok(!message.includes("23 §8"), `23 §8 是字段契约，不是内聚条款；实际：${message}`);
  assert.ok(message.includes("aa-bb") && message.includes("zz-yy"), "两侧短键都应在场");
});

test("norm：正文不声明 direction_key 时不报内聚错（本类型不要求逐字复现）", async () => {
  const mod = await import(new URL("../lib/norm-writer.js", import.meta.url).href);
  const result = mod.validateCarrierCoherence(
    { direction_key: "aa-bb" },
    "# T\n\n## 核心规则体系\n\n这里是纯规则散文，不提任何方向键。\n",
  );
  assert.equal(result.ok, true, "23 §7 明确本类型不要求正文复现 frontmatter 标量");
});



test("research 的 research_question 参数描述含逐字要求（24 §8 invariant 10）", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../lib/report-tools.js", import.meta.url), "utf8");
  const line = source.split("\n").find((l) => l.includes("research_question: { type: \"string\""));
  assert.ok(line !== undefined, "research_question 字段应存在");
  assert.ok(
    /VERBATIM/i.test(line),
    "参数描述须写明「须逐字出现在正文研究问题段」，否则调用方不知道这条约束的存在",
  );
  assert.ok(/24 §8/.test(line), "须带 24 §8 invariant 10 的条款依据");
});

test("subgoal 的 criterion 与 norm 的 direction_key 均带内聚说明", async () => {
  const { readFileSync } = await import("node:fs");
  const sub = readFileSync(new URL("../lib/subgoal-tools.js", import.meta.url), "utf8");
  const criterion = sub.split("\n").find((l) => l.includes('criterion: { type: "string"'));
  assert.ok(criterion !== undefined, "subgoal criterion 应存在");
  assert.ok(/VERBATIM/i.test(criterion), "criterion 须声明逐字要求");
  assert.ok(/28 §8/.test(criterion), "须带 28 §8 依据");

  const norm = readFileSync(new URL("../lib/norm-tools.js", import.meta.url), "utf8");
  const dirKey = norm.split("\n").find((l) => l.includes('direction_key: { type: "string"'));
  assert.ok(dirKey !== undefined, "norm direction_key 应存在");
  assert.ok(/23 §7/.test(dirKey), "norm 须带 23 §7 依据");
  assert.ok(/NOT required to reproduce/i.test(dirKey), "须写明本类型不要求逐字复现，否则会误导调用方");
});
