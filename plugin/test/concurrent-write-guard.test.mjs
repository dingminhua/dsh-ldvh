// 在途改动守卫的用例（friction-68e6f33e / friction-451c4a7d 的处置）
//
// ## 为什么必须直接测这个模块
//
// 该守卫的**真实用途**是防止 `scripts/mutation-check.mjs` 覆盖并行会话的在途改动，
// 而 mutation-check 是 7 分钟级的手工入口、日常不跑。若只用「脚本能跑通」当证据，
// 就会重演 pitfall「新增防护无直接用例致变异零检出」：一条恒真的判定与一条正确的
// 判定在端到端路径上**看不出区别**——脚本正常跑完，两种情形都退出 0。
//
// 故本文件直接对判定函数做**双向**用例：允许时必须允许（正控制），拒绝时必须有
// 具体 code（负控制）。只有负控制时，把函数恒返回 `{ok:false}` 能让全部用例通过，
// 那样的测试守不住「首次接触不构成冲突」这一半。
import assert from "node:assert/strict";
import test from "node:test";

import { decideMutationWrite, decideMutationRestore } from "../lib/concurrent-write-guard.js";

test("首次接触不构成冲突：尚未写过时允许写（正控制）", () => {
  // 这一半决定了守卫不会把「他人的在途改动」当成「不能开工」——
  // 运行前磁盘上的内容本就可能是别人未提交的版本，那时该文件就是基线。
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
  // 「文件消失」与「文件被改写」是两种不同的他人动作，混成同一个 code 会让
  // 报告读者以为有人改了内容。此处只要求两者**可区分**，不要求措辞一致。
  const gone = decideMutationWrite({ currentContent: null, lastWrittenContent: "mine" });
  assert.equal(gone.ok, false);
  assert.equal(gone.code, "concurrent-write/gone");
  const changed = decideMutationWrite({ currentContent: "x", lastWrittenContent: "mine" });
  assert.notEqual(gone.code, changed.code, "消失与改写须给出不同的 code");
});

test("写入侧与还原侧是同一判据（不得分成两份实现）", () => {
  // 两份实现一旦分叉，其中一侧就会静默覆盖他人改动——这正是本账目记录的缺陷形态。
  // 用「同一输入同一结论」的可判定性质表达，不复算实现。
  assert.equal(decideMutationWrite, decideMutationRestore, "还原判定须与写入判定同源");
});

test("空字符串是合法内容，不得被当成「没有内容」（边界）", () => {
  // 真实场景：某个受变异文件的基线为空（文件被清空但存在）。若实现用
  // `typeof x === "string" && x.length > 0` 判「有值」，空文件会被读成「首次接触」，
  // 于是运行期间他人写给该文件的内容会被覆盖。
  const same = decideMutationWrite({ currentContent: "", lastWrittenContent: "" });
  assert.equal(same.ok, true, "空→空是自己上次写下的，允许写");
  const overwritten = decideMutationWrite({ currentContent: "someone", lastWrittenContent: "" });
  assert.equal(overwritten.ok, false, "自己写空后他人写入内容，必须判为在途改动");
});

test("两个会改写源的脚本都接同一个守卫（不得各持一份副本）", async () => {
  // 06 §6 单一实现：`mutation-check` 与 `drift-check` 都真的改写工作树里的源码/
  // 载体再还原，是同一形态的风险面。任一脚本若重新内联「按快照无条件写回」，
  // 即回到 friction-68e6f33e 的原始失效形态。
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
    // 反向：不得再出现「按启动快照无条件还原」的那一行。
    assert.doesNotMatch(
      src,
      /for \(const \[[^\]]+\] of originals\) await writeFile\(/,
      `${script} 不得保留「按启动快照无条件还原」的写法`,
    );
  }
});
