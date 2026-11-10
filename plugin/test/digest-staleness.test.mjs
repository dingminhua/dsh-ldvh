import test from "node:test";
import assert from "node:assert/strict";
import { detectDigestStaleness, CONTENT_FIELDS_BY_TYPE } from "../lib/digest-staleness.js";

// `recall_digest` 陈旧检测（02 §7.1；Human 2026-11-10 要求「内容变了 digest 要重写」）。
//
// 为什么不做机械门禁：机械层分不清「追加证据」（Friction 补充观察，全库 290 次）
// 与「改写结论」——两者都是正文变了。故只做窄口径提示：**结论标量字段变了而
// digest 一字未动**时才报，且只 warning 不阻断。

test("陈旧的判定：结论标量变了而 digest 未动 → 报陈旧", () => {
  const r = detectDigestStaleness({
    type: "spark",
    baseline: { summary: "旧结论", recall_digest: "旧的 关键词面" },
    next: { summary: "新结论", recall_digest: "旧的 关键词面" },
  });
  assert.equal(r.stale, true);
  assert.deepEqual(r.changedFields, ["summary"]);
});

test("digest 同步跟进了 → 不报陈旧（这是期望路径，不得误报）", () => {
  const r = detectDigestStaleness({
    type: "spark",
    baseline: { summary: "旧结论", recall_digest: "旧的 关键词面" },
    next: { summary: "新结论", recall_digest: "新的 关键词面 已更新" },
  });
  assert.equal(r.stale, false);
});

test("**只追加补充观察（结论字段未变）→ 不报陈旧**（这是全库 290 次正常写入的形态）", () => {
  // Friction 补充观察：count 递增、last_at 更新、现象段追加逐字引证，
  // 但 phenomenon 结论本身不变。digest 一个字都不用改，不得判红。
  const r = detectDigestStaleness({
    type: "friction",
    baseline: {
      phenomenon: "同一现象。",
      recall_digest: "现象 关键词",
      occurrence: { count: 3, first_at: "2026-11-01T00:00:00Z", last_at: "2026-11-02T00:00:00Z" },
      status: "open",
    },
    next: {
      phenomenon: "同一现象。",
      recall_digest: "现象 关键词",
      occurrence: { count: 4, first_at: "2026-11-01T00:00:00Z", last_at: "2026-11-09T00:00:00Z" },
      status: "open",
    },
  });
  assert.equal(r.stale, false, "计数与时间戳变化不属于内容语义变更");
});

test("状态翻转不触发陈旧（status 不是结论标量）", () => {
  const r = detectDigestStaleness({
    type: "spark",
    baseline: { summary: "结论不变", recall_digest: "关键词", status: "open" },
    next: { summary: "结论不变", recall_digest: "关键词", status: "discarded", disposition: "不再跟踪" },
  });
  assert.equal(r.stale, false);
});

test("对象本来就没有 digest → 不提示（走 summary/正文/title 回退链）", () => {
  const r = detectDigestStaleness({
    type: "spark",
    baseline: { summary: "旧" },
    next: { summary: "新" },
  });
  assert.equal(r.stale, false);
});

test("基线不可得（创建路径）→ 不凭空断言陈旧", () => {
  const r = detectDigestStaleness({ type: "spark", baseline: null, next: { summary: "新", recall_digest: "x" } });
  assert.equal(r.stale, false);
});

test("Norm 无结论标量（规则散文住正文）→ 永不报陈旧", () => {
  assert.deepEqual(CONTENT_FIELDS_BY_TYPE.norm, []);
  const r = detectDigestStaleness({
    type: "norm",
    baseline: { recall_digest: "a", direction_key: "x" },
    next: { recall_digest: "a", direction_key: "x" },
  });
  assert.equal(r.stale, false);
});

test("多字段同时改写时逐个列出（读者据此判断改了哪几处结论）", () => {
  const r = detectDigestStaleness({
    type: "adr",
    baseline: { decision: "旧决定", scope: "旧范围", recall_digest: "k" },
    next: { decision: "新决定", scope: "新范围", recall_digest: "k" },
  });
  assert.equal(r.stale, true);
  assert.deepEqual(r.changedFields, ["decision", "scope"]);
});
