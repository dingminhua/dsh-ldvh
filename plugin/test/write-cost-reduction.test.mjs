import assert from "node:assert/strict";
import test from "node:test";

import { appendReadBody, DEFAULT_READ_BODY_BYTE_LIMIT } from "../lib/read-body-render.js";
import { repairedLengthMessage } from "../lib/write-diagnostics.js";

test("appendReadBody: completed read-object puts full body into visible lines", () => {
  const lines = ["LDVH spark-read-object: completed"];
  const ok = appendReadBody(lines, { body: "# 标题\n\n## 段\n\n正文一行" });
  assert.equal(ok, true);
  const text = lines.join("\n");
  assert.match(text, /body: \|/);
  assert.match(text, /正文一行/);
  assert.doesNotMatch(text, /body_truncated/);
});

test("appendReadBody: absent or empty body emits nothing", () => {
  const absent = ["head"];
  assert.equal(appendReadBody(absent, {}), false);
  const empty = ["head"];
  assert.equal(appendReadBody(empty, { body: "" }), false);
  assert.equal(absent.length, 1);
  assert.equal(empty.length, 1);
});

test("appendReadBody: over-limit body is truncated with byte-accurate disclosure", () => {
  const body = "字".repeat(100);
  const lines = [];
  const ok = appendReadBody(lines, { body }, { byteLimit: 30 });
  assert.equal(ok, true);
  const text = lines.join("\n");
  assert.match(text, /body_truncated: true/);
  assert.match(text, /body_bytes: 300 \(limit 30\)/);
  assert.match(text, /not_completed:/);
  const emitted = lines.filter((l) => l.startsWith("  ")).join("").replace(/^ +/gm, "").replace(/\n/g, "");
  assert.ok(Buffer.byteLength(emitted, "utf8") <= 30, "截断后的可见正文不得超过字节上限");
});

test("appendReadBody: default byte limit is positive", () => {
  assert.ok(DEFAULT_READ_BODY_BYTE_LIMIT > 0);
});

test("repairedLengthMessage: under-limit keeps classic message without draft", () => {
  const msg = repairedLengthMessage("title", "短标题", 30, "20 §8");
  assert.match(msg, /must be ≤ 30 characters \(20 §8\), got 3/);
  assert.doesNotMatch(msg, /可照抄/);
});

test("repairedLengthMessage: over-limit gives current value, limit, over-by and review-labeled candidate", () => {
  const msg = repairedLengthMessage("disposition", "一二三四五", 3, "20 §9.1");
  assert.match(msg, /got 5/);
  assert.match(msg, /over by 2/);
  assert.match(msg, /机械截取候选值/);
  assert.match(msg, /须自行确认语义与载体内聚/);
  assert.match(msg, /一二三/);
  assert.doesNotMatch(msg, /一二三四五"/);
});
