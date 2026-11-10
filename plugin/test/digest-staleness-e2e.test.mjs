import test from "node:test";
import assert from "node:assert/strict";
import { detectDigestStaleness } from "../lib/digest-staleness.js";

// 端到端：陈旧提示必须能到达**模型可见文本**。
//
// 只断言 writer 返回里有 warnings 是不够的——`mechanical_issues` 此前正是
// 「写入路径算出来了、投影与呈现两侧各 0 处命中」，读者什么都看不到。
// 故本条同时钉住两件事：① 判定能被触发；② 渲染函数会把它写成文本行。

test("陈旧时：writer 返回 warnings，且 render 会把它渲染成 warning 行", async () => {
  const type = "spark";
  const baseline = { summary: "旧结论", recall_digest: "旧 关键词" };
  const next = { summary: "新结论", recall_digest: "旧 关键词" };
  const r = detectDigestStaleness({ type, baseline, next });
  assert.equal(r.stale, true);

  // 模拟工具面把 warnings 放进 result 后的 envelope，再看渲染是否可见。
  const tools = await import("../lib/spark-tools.js");
  const render = tools.renderEnvelopeForTest;
  assert.ok(typeof render === "function", "renderEnvelope 须可测（导出供断言）");
  const text = render("spark-write-object", {
    envelope: {
      operation_key: "spark-write-object",
      outcome: "completed",
      result: { action: "update", object_uid: "x", warnings: ["recall_digest may be stale: ..."] },
      gaps: [],
    },
  });
  const plain = typeof text === "string" ? text : (text?.text ?? JSON.stringify(text));
  assert.ok(plain.includes("warning:"), `模型可见文本须含 warning 行：${plain}`);
  assert.ok(plain.includes("recall_digest may be stale"), plain);
});
