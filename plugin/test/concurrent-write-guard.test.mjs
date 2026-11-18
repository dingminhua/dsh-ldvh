import assert from "node:assert/strict";
import test from "node:test";

import { decideMutationWrite, decideMutationRestore } from "../lib/concurrent-write-guard.js";

test("首次接触不构成冲突：尚未写过时允许写（正控制）", () => {
  for (const currentContent of ["v1", "", null]) {
    const verdict = decideMutationWrite({ currentContent });
    assert.equal(verdict.ok, true, `首次接触（current=${JSON.stringify(currentContent)}）须允许写`);
    assert.equal(verdict.ownsWrite, true);
  }
});

test("内容仍是自己上次写的：允许写（正控制）", () => {
  const verdict = decideMutationWrite({ currentContent: "mutated-v1", lastWrittenContent: "mutated-v1" });
  assert.equal(verdict.ok, true, "磁盘内容与自己上次写下的一致时不得误判为冲突");
});

test("内容已被改写：拒绝写并给出具体 code（负控制）", () => {
  const verdict = decideMutationWrite({ currentContent: "someone-else", lastWrittenContent: "mine" });
  assert.equal(verdict.ok, false, "他人改写后必须拒绝覆盖");
  assert.equal(verdict.code, "concurrent-write/detected");
  assert.match(verdict.reason, /in-flight change/, "理由须点明是在途改动");
});

test("自己被删掉的文件不得被凭空重建（负控制，与 detected 分开）", () => {
  const gone = decideMutationWrite({ currentContent: null, lastWrittenContent: "mine" });
  assert.equal(gone.ok, false);
  assert.equal(gone.code, "concurrent-write/gone");
  const changed = decideMutationWrite({ currentContent: "x", lastWrittenContent: "mine" });
  assert.notEqual(gone.code, changed.code, "消失与改写须给出不同的 code");
});

test("写入侧与还原侧是同一判据（不得分成两份实现）", () => {
  assert.equal(decideMutationWrite, decideMutationRestore, "还原判定须与写入判定同源");
});

test("空字符串是合法内容，不得被当成「没有内容」（边界）", () => {
  const same = decideMutationWrite({ currentContent: "", lastWrittenContent: "" });
  assert.equal(same.ok, true, "空→空是自己上次写下的，允许写");
  const overwritten = decideMutationWrite({ currentContent: "someone", lastWrittenContent: "" });
  assert.equal(overwritten.ok, false, "自己写空后他人写入内容，必须判为在途改动");
});

test("两个会改写源的脚本都接同一个守卫（不得各持一份副本）", async () => {
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const script of ["scripts/mutation-check.mjs", "scripts/drift-check.mjs"]) {
    const src = await readFile(join(PLUGIN, script), "utf8");
    assert.match(
      src,
      /from "\.\.\/lib\/concurrent-write-guard\.js"/,
      `${script} 须从 lib/concurrent-write-guard.js 取判定入口`,
    );
    assert.doesNotMatch(
      src,
      /for \(const \[[^\]]+\] of originals\) await writeFile\(/,
      `${script} 不得保留「按启动快照无条件还原」的写法`,
    );
  }
});
