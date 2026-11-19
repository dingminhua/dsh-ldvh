
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TOOLS_SOURCE = join(import.meta.dirname, "..", "lib", "goal-tools.js");
const WRITER_SOURCE = join(import.meta.dirname, "..", "lib", "goal-writer.js");

test("goal 更新结果不再承诺不产出的 revised_anchors 字段", async () => {
  const tools = await readFile(TOOLS_SOURCE, "utf8");
  assert.ok(
    !tools.includes("revised_anchors"),
    "goal-tools.js 不得在 result/follow_up 中承诺 revised_anchors（277d7479：写入器从不产出该字段）",
  );
});

test("级联提示不得再引用不存在的 revised_anchors 或过时的 21 §C2 条款", async () => {
  const tools = await readFile(TOOLS_SOURCE, "utf8");
  assert.ok(
    !/revised_anchors/.test(tools),
    "工具面任何位置都不得再点名写入器从不产出的 revised_anchors",
  );
  assert.ok(
    !/21 §C2/.test(tools),
    "级联条款号已迁至 20 §13 / 30 §8.5，不得再引用失效的 21 §C2",
  );
  assert.ok(
    /按 parent_goal → serves 两层反查/.test(tools),
    "保留真实的修订级联义务提示，只修假字段与错条款，不删义务",
  );
});

test("写入器返回字段与工具面交还字段同源：writer 不产出的字段不得被工具面点名", async () => {
  const [tools, writer] = await Promise.all([
    readFile(TOOLS_SOURCE, "utf8"),
    readFile(WRITER_SOURCE, "utf8"),
  ]);
  const resultLine = tools.split("\n").find((line) => line.includes("result: { action: \"update\""));
  assert.ok(resultLine !== undefined, "goal-tools.js 应包含 update 的 result 行");
  for (const field of ["revised_anchors"]) {
    if (resultLine.includes(field)) {
      assert.ok(
        new RegExp(`\\b${field}\\b`).test(writer),
        `工具面 result 引用了 ${field}，但 goal-writer.js 从未产出它`,
      );
    }
  }
});
