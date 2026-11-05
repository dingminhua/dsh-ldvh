// `summary` 200 字符上限的契约（Human 2026-11-04 裁定 B1 + 乙，workcase-5eec3197）。
//
// 钉住四件事：
//   1. 上限**只对 Spark 生效**（索引层）；WorkCase / DevLog 是执行载体与结论快照，
//      不设上限，靠 §8 分块规则保可读性。
//   2. 判定单位与既有四处一致：UTF-16 码元、按 `.length`、去首尾空白。
//   3. **B1 语义**：存量逐字未改放行，改动即受检（沿用 21 §15.1 先例）。
//   4. 拒绝消息须给出当前字数与超出量，且明写「不得截断后写入」——截断会破坏
//      载体内聚（正文须逐字包含 summary）。
//
// 变异钉法：把上限改成 Infinity、把 skip 逻辑去掉、或把 WorkCase 也加上限，
// 本文件即转红。

import { test } from "node:test";
import assert from "node:assert/strict";

import { SUMMARY_MAX_CHARS, summaryLength, summaryLimitIssue } from "../lib/summary-limit.js";
import { validateSparkFrontmatter } from "../lib/spark-writer.js";
import { validateDevLogFrontmatter } from "../lib/devlog-writer.js";
import { validateWorkcaseFrontmatter } from "../lib/workcase-writer.js";

/** 一个字段齐备的 Spark frontmatter（缺字段会产生无关 issue，淹没断言）。 */
function sparkCase(summary) {
  return {
    object_uid: "71930c4a-f43f-439e-88bd-3aff7d07d37c",
    fact_type_key: "spark",
    created_at: "2026-11-04T00:00:00Z",
    change_log: [{ at: "2026-11-04T00:00:00Z", summary: "x" }],
    title: "测试用",
    question: "这是一个用于验证上限的问题吗？",
    scope_boundary: "当上限行为被验证时停止。",
    intent: "验证上限",
    summary,
    status: "open",
  };
}

// ---------------------------------------------------------------------------
// 1. 上限本身
// ---------------------------------------------------------------------------

test("SUMMARY_MAX_CHARS 与既有四处同为 200", () => {
  assert.equal(SUMMARY_MAX_CHARS, 200, "须与 Spark.disposition / WorkCase.gist / Pitfall.disposition / Goal 目标陈述 同值");
});

test("summaryLength 按 UTF-16 码元计、去首尾空白", () => {
  assert.equal(summaryLength("  短  "), 1, "首尾空白不计入");
  assert.equal(summaryLength(""), 0);
  assert.equal(summaryLength(undefined), 0, "非字符串按 0，不抛");
  assert.equal(summaryLength("甲".repeat(200)), 200, "1 个汉字 = 1 个 UTF-16 码元");
});

test("边界值：200 字通过，201 字拒绝", () => {
  assert.equal(summaryLimitIssue("甲".repeat(200)), null, "恰好 200 应通过");
  assert.notEqual(summaryLimitIssue("甲".repeat(201)), null, "201 应被拒");
});

test("拒绝消息给出当前字数与超出量，并写明不得截断", () => {
  const msg = summaryLimitIssue("甲".repeat(250), { clause: "20 §8" });
  assert.ok(msg.includes("got 250"), "须给出当前字数，否则作者不知差多少");
  assert.ok(msg.includes("超 50 字符"), "须给出超出量");
  assert.ok(msg.includes("不得截断后写入"), "须写明截断被禁止");
  assert.ok(msg.includes("20 §8"), "须带该类型的条款依据");
  assert.ok(msg.includes("载体内聚"), "须说明为何不能截断：正文须逐字包含 summary");
});

// ---------------------------------------------------------------------------
// 2. Spark：上限生效
// ---------------------------------------------------------------------------

test("Spark：create 路径 201 字被拒，200 字通过", () => {
  const over = validateSparkFrontmatter(sparkCase("甲".repeat(201)));
  assert.equal(over.ok, false, "超限必须拒绝");
  assert.ok(over.issues.some((i) => i.includes("≤ 200")), JSON.stringify(over.issues));

  const atLimit = validateSparkFrontmatter(sparkCase("甲".repeat(200)));
  assert.equal(atLimit.ok, true, `恰好 200 应通过，实际：${JSON.stringify(atLimit.issues)}`);
});

// ---------------------------------------------------------------------------
// 3. B1：存量放行
// ---------------------------------------------------------------------------

test("Spark：skipSummaryLimit 时存量超限放行（B1 语义）", () => {
  const stale = sparkCase("甲".repeat(3263)); // 本仓实测最长的一条
  const strict = validateSparkFrontmatter(stale);
  assert.equal(strict.ok, false, "新写入同样内容必须被拒");

  const asIs = validateSparkFrontmatter(stale, { skipSummaryLimit: true });
  assert.equal(asIs.ok, true, `存量逐字未改须放行，否则 66 条现存对象立即只读；实际：${JSON.stringify(asIs.issues)}`);
});

test("Spark：skip 只豁免长度，不豁免其它校验", () => {
  const bad = sparkCase("甲".repeat(300));
  bad.status = "不存在的状态";
  const r = validateSparkFrontmatter(bad, { skipSummaryLimit: true });
  assert.equal(r.ok, false, "skip 不得连带放行状态闭集");
  assert.ok(!r.issues.some((i) => i.includes("≤ 200")), "长度项应被豁免");
});

// ---------------------------------------------------------------------------
// 4. WorkCase / DevLog：不设上限（乙）
// ---------------------------------------------------------------------------

test("WorkCase：长 summary 不受 200 字约束（执行载体靠分块保可读）", () => {
  // 构造合规的分块长文本：>200 且首块之外以 H3 开头
  const long = `总述一段。${"并逐条说明其依据与未覆盖范围，使后续执行者无需回读原讨论即可独立接手".repeat(3)}`
    + `\n\n### 处置方向\n- 甲${"补充说明".repeat(40)}`;
  assert.ok(long.length > 200, "用例须真的超过 200，否则断言空转");
  const fm = {
    title: "测试工单",
    gist: "验证 WorkCase 不设 summary 上限",
    summary: long,
    scope: "做什么：\n- 验证上限\n\n明确不做什么：\n- 不改实现",
    plan: [{ step: "验证", done_criteria: "长 summary 被接受" }],
    status: "draft",
  };
  const r = validateWorkcaseFrontmatter(fm);
  const limitIssues = r.issues.filter((i) => i.includes("≤ 200") && i.includes("summary"));
  assert.equal(limitIssues.length, 0, `WorkCase 不应有 summary 长度上限，实际：${JSON.stringify(limitIssues)}`);
});

test("DevLog：长 summary 不受 200 字约束（结论快照需完整）", () => {
  const fm = {
    object_uid: "07ef92cf-1577-40af-aecf-69d06273fd92",
    fact_type_key: "devlog",
    created_at: "2026-11-04T00:00:00Z",
    change_log: [{ at: "2026-11-04T00:00:00Z", summary: "x" }],
    title: "测试日志",
    occurred_at: "2026-11-04T00:00:00Z",
    summary: "甲".repeat(400),
    status: "active",
  };
  const r = validateDevLogFrontmatter(fm);
  assert.ok(!r.issues.some((i) => i.includes("≤ 200")), `DevLog 不应有 summary 上限，实际：${JSON.stringify(r.issues)}`);
});
