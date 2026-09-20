// markdown 结构解析的单一权威守卫（specs/09 §5 同族纪律）
//
// WHY THIS EXISTS（真实缺陷，非假设）：
// `h2Titles` / `sectionContent` / `countAtxHeadings` 曾在 6 个 writer 中各自
// 实现，且语义分叉——workcase 的实现跳代码围栏，其余 5 份不跳；同一文件内
// spark/pitfall 的 `h2Titles`（不跳围栏）与 `countAtxHeadings`（跳围栏）也相互
// 矛盾。围栏内的 `## 假标题` 于是被部分实现当成真 H2，使 H2 集合校验产生假命中。
//
// 这是 pitfall `e8cadde1`（身份判定散落 4 处、3 处取错版本位致关联全量判死）的
// **同构复发**：同一判定在多层各自实现，任一处漂移即产生静默错误。该 pitfall 的
// 机制结论（「同一判定不得在多层各自实现」）与形态无关，故在此适用。
//
// 本文件做两件事：
//   ① 行为守卫——新共享实现必须跳过围栏、归一 CRLF、按 CommonMark 识别 ATX；
//   ② 结构守卫——各 writer 不得再各自实现结构解析（源码断言 + 反查覆盖），
//      新增 writer 漏挂共享实现即失败。

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  normalizeNewlines,
  atxHeadings,
  h2Titles,
  countAtxHeadings,
  sectionContent,
  h3TitlesInSection,
} from "../lib/markdown-structure.js";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");

// ---------------------------------------------------------------------------
// ① 行为守卫
// ---------------------------------------------------------------------------

test("normalizeNewlines: CRLF 与裸 CR 一律归一为 LF", () => {
  assert.equal(normalizeNewlines("a\r\nb\rc\nd"), "a\nb\nc\nd");
});

test("h2Titles: 围栏内的 ## 行不计入结构（核心分歧点的固化）", () => {
  const body = "# T\n\n## 甲\na\n\n```\n## 假标题\n```\n\n## 乙\nb\n";
  assert.deepEqual(h2Titles(body), ["甲", "乙"]);
});

test("h2Titles: ~~~ 围栏同样跳过，且不因 ``` 误闭合", () => {
  const body = "## 甲\na\n\n~~~\n## 假\n```\n## 假二\n~~~\n\n## 乙\nb\n";
  assert.deepEqual(h2Titles(body), ["甲", "乙"]);
});

test("h2Titles: CommonMark 合法变体（≤3 前导空格、tab 分隔、尾随空白）", () => {
  const body = "## 甲\na\n   ## 乙\nb\n##\t丙\nc\n## 丁   \nd\n";
  assert.deepEqual(h2Titles(body), ["甲", "乙", "丙", "丁"]);
});

test("h2Titles: `##标题`（井号后无空格）不是标题", () => {
  assert.deepEqual(h2Titles("##标题\n## 真标题\n"), ["真标题"]);
});

test("h2Titles: `###` 不被误认为 H2", () => {
  assert.deepEqual(h2Titles("### 三级\n## 二级\n"), ["二级"]);
});

test("h2Titles: `##` 后仅空白视为空标题（与收敛前的既有行为逐字一致）", () => {
  // 如实登记该边界：CommonMark 允许空 ATX 标题，故 `##   ` 是「标题文本为空」的
  // 合法标题，而非「不是标题」。收敛前 5 份旧实现的 startsWith("## ") + trim()
  // 同样产出 [""]，本模块保持该行为——本次收敛只统一语义分叉，不夹带行为变更。
  // 空标题由各类型的「各段非空」校验另行拒绝，不依赖结构解析层。
  assert.deepEqual(h2Titles("##   \n"), [""]);
});

test("h2Titles: CRLF 载体与 LF 载体结果一致", () => {
  const lf = "## 甲\na\n\n## 乙\nb\n";
  assert.deepEqual(h2Titles(lf), h2Titles(lf.replace(/\n/g, "\r\n")));
});

test("countAtxHeadings: 集合性质判定——恰好一个 H1 的三种逃逸形式均被计数", () => {
  assert.equal(countAtxHeadings("# T\n# 多\n", 1), 2, "连续多余 H1");
  assert.equal(countAtxHeadings("# T\n\nbody\n\n# 多\n", 1), 2, "中间多余 H1");
  assert.equal(countAtxHeadings("# T\n\nbody\n\n# 多\n\n", 1), 2, "末尾多余 H1");
  assert.equal(countAtxHeadings("   # T\n", 1), 1, "缩进的合法 H1");
  assert.equal(countAtxHeadings("# T   \n", 1), 1, "尾随空白的合法 H1");
});

test("countAtxHeadings: 围栏内的 # 行不计入", () => {
  assert.equal(countAtxHeadings("# T\n\n```\n# 假\n```\n", 1), 1);
});

test("sectionContent: 节内容不与围栏内的 ## 行混淆", () => {
  const body = "## 甲\n第一行\n\n```\n## 假\n```\n\n## 乙\n第二行\n";
  assert.equal(sectionContent(body, "甲"), "第一行\n\n```\n## 假\n```");
  assert.equal(sectionContent(body, "乙"), "第二行");
});

test("sectionContent: 节不存在返回 null（与「节为空」可区分）", () => {
  assert.equal(sectionContent("## 甲\n\n## 乙\nb\n", "丙"), null);
  assert.equal(sectionContent("## 甲\n\n## 乙\nb\n", "甲"), "");
});

test("h3TitlesInSection: 只取该 H2 节内的 H3，且跳过围栏", () => {
  const body = "## 调查阶段\n### 一\nx\n```\n### 假\n```\n### 二\ny\n## 其他\n### 三\nz\n";
  assert.deepEqual(h3TitlesInSection(body, "调查阶段"), ["一", "二"]);
});

test("atxHeadings: 任意层级可查（H1/H3 同一实现）", () => {
  const body = "# 一\n## 二\n### 三\n";
  assert.deepEqual(atxHeadings(body, 1), ["一"]);
  assert.deepEqual(atxHeadings(body, 2), ["二"]);
  assert.deepEqual(atxHeadings(body, 3), ["三"]);
});

// ---------------------------------------------------------------------------
// ② 结构守卫：各 writer 不得再各自实现结构解析
// ---------------------------------------------------------------------------

const SCANNER_NAMES = ["h2Titles", "sectionContent", "countAtxHeadings", "h3TitlesInSection"];

test("结构守卫: 全库不再存在本地的结构解析实现（反查覆盖，新增 writer 漏挂即失败）", async () => {
  const files = (await readdir(LIB)).filter((n) => n.endsWith(".js") && n !== "markdown-structure.js");
  const offenders = [];
  for (const name of files) {
    const src = await readFile(join(LIB, name), "utf8");
    for (const fn of SCANNER_NAMES) {
      // 本地「函数声明」形式即视为各自实现；import 进来的不算。
      const localDecl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?function\\s+${fn}\\s*\\(`);
      if (localDecl.test(src)) offenders.push(`${name}: ${fn}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `以下文件仍各自实现 markdown 结构解析（应改用 markdown-structure.js）:\n  ${offenders.join("\n  ")}`,
  );
});

test("结构守卫: 防御性自检——该断言确实能捕获本地实现（变异测试）", async () => {
  // 在内存中重建一个「本地实现」的形态，确认上面的正则真的会命中。
  const mutated = "function h2Titles(body) {\n  return [];\n}\n";
  const localDecl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?function\\s+h2Titles\\s*\\(`);
  assert.ok(localDecl.test(mutated), "守卫的正则必须能命中本地实现，否则守卫是空转的");
});

test("结构守卫: 消费方 writer 均已引用共享实现", async () => {
  const consumers = [
    "adr-writer.js",
    "friction-writer.js",
    "norm-writer.js",
    "pitfall-writer.js",
    "research-writer.js",
    "spark-writer.js",
    "workcase-writer.js",
  ];
  for (const name of consumers) {
    const src = await readFile(join(LIB, name), "utf8");
    assert.match(src, /from "\.\/markdown-structure\.js"/, `${name} 应引用 markdown-structure.js`);
  }
});
