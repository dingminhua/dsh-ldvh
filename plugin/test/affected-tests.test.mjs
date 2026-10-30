// 契约测试：按改动影响面选跑测试（plugin/scripts/affected-tests.mjs）。
//
// 这套规则的失效方向决定它在测什么：**漏判会给出假通过**，而假通过比「多跑了
// 几个文件」贵得多。所以本文件的重头是「保守侧」——认不出、够不着、被注释干扰
// 的场合都必须朝「跑得更多」或「明确失败」倒，绝不能安静地返回一个小子集。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeAffectedTests } from "../scripts/affected-tests.mjs";
import { withTemp } from "./helpers.mjs";

/**
 * 在临时目录里造一个最小的 plugin 形状（lib/、test/、scripts/），
 * 并在该目录内执行 fn —— 不能把 dir 返回出去：withTemp 在回调返回后立刻删除它。
 * @param {Record<string, string>} files 相对路径 → 内容
 * @param {(dir: string) => Promise<void>} fn
 */
async function withTree(files, fn) {
  return withTemp("affected", async (dir) => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      await mkdir(join(abs, ".."), { recursive: true });
      await writeFile(abs, content, "utf8");
    }
    await fn(dir);
  });
}

test("a static import chain selects the test that reaches it", async () => {
  await withTree(
    {
      "lib/a.js": "export const a = 1;\n",
      "lib/b.js": 'import { a } from "./a.js";\nexport const b = a + 1;\n',
      "test/b.test.mjs": 'import { b } from "../lib/b.js";\n',
      "test/other.test.mjs": "// unrelated\n",
    },
    async (dir) => {
      const plan = await computeAffectedTests({ root: dir, changedPaths: ["lib/a.js"] });
      assert.equal(plan.mode, "partial");
      assert.deepEqual(plan.tests, ["test/b.test.mjs"]);
    },
  );
});

test("a comment that merely mentions a module is NOT a dependency edge", async () => {
  // 实测本仓这类注释有 126 处，它们曾把所有模块连成一片。
  await withTree(
    {
      "lib/a.js": "export const a = 1;\n",
      "lib/b.js": "// 参见 lib/a.js 里的实现\nexport const b = 1;\n",
      "test/b.test.mjs": 'import { b } from "../lib/b.js";\n',
      "test/a.test.mjs": 'import { a } from "../lib/a.js";\n',
    },
    async (dir) => {
      const plan = await computeAffectedTests({ root: dir, changedPaths: ["lib/a.js"] });
      assert.equal(plan.mode, "partial");
      assert.deepEqual(plan.tests, ["test/a.test.mjs"], "b.test.mjs 只在注释里提到 a，不应被选中");
    },
  );
});

test("a path literal in code IS an edge — spawn and read-as-text leave no import edge", async () => {
  await withTree(
    {
      "lib/runner.js": "export const run = 1;\n",
      "test/bin.test.mjs": 'const runnerPath = "../lib/runner.js";\n',
      "test/unrelated.test.mjs": "const x = 1;\n",
    },
    async (dir) => {
      const plan = await computeAffectedTests({ root: dir, changedPaths: ["lib/runner.js"] });
      assert.equal(plan.mode, "partial");
      assert.deepEqual(plan.tests, ["test/bin.test.mjs"]);
    },
  );
});

test("a dynamic import with a literal specifier is an edge", async () => {
  await withTree(
    {
      "lib/lazy.js": "export const lazy = 1;\n",
      "test/lazy.test.mjs": 'const { lazy } = await import("../lib/lazy.js");\n',
    },
    async (dir) => {
      const plan = await computeAffectedTests({ root: dir, changedPaths: ["lib/lazy.js"] });
      assert.deepEqual(plan.tests, ["test/lazy.test.mjs"]);
    },
  );
});

test("a change with no reachable test is UNCOVERED, never an empty pass", async () => {
  // 空集不等于通过：这是本脚本最容易被误用成「绿」的地方。
  await withTree(
    {
      "lib/orphan.js": "export const orphan = 1;\n",
      "test/other.test.mjs": "// nothing imports orphan\n",
    },
    async (dir) => {
      const plan = await computeAffectedTests({ root: dir, changedPaths: ["lib/orphan.js"] });
      assert.equal(plan.mode, "uncovered");
      assert.deepEqual(plan.tests, []);
      assert.deepEqual(plan.uncovered, ["lib/orphan.js"]);
    },
  );
});

test("one orphan among several covered changes is still reported", async () => {
  // 混跑一次反向 BFS 会把「这个没人测」和「那个有人测」搅在一起。
  await withTree(
    {
      "lib/covered.js": "export const c = 1;\n",
      "lib/orphan.js": "export const o = 1;\n",
      "test/covered.test.mjs": 'import { c } from "../lib/covered.js";\n',
    },
    async (dir) => {
      const plan = await computeAffectedTests({ root: dir, changedPaths: ["lib/covered.js", "lib/orphan.js"] });
      assert.equal(plan.mode, "partial");
      assert.deepEqual(plan.tests, ["test/covered.test.mjs"]);
      assert.deepEqual(plan.uncovered, ["lib/orphan.js"]);
    },
  );
});

test("a change outside the known surface falls back to the full suite", async () => {
  await withTree({ "lib/a.js": "export const a = 1;\n" }, async (dir) => {
    const plan = await computeAffectedTests({ root: dir, changedPaths: ["docs/README.md"] });
    assert.equal(plan.mode, "full");
    assert.match(plan.reason, /不在已知面内/);
  });
});

test("each full-suite trigger explains itself and returns mode full", async () => {
  await withTree({ "lib/a.js": "export const a = 1;\n" }, async (dir) => {
    const triggers = ["specs/06-Test.md", "ldvh-base/goal.md", "package.json", "eslint.config.js", "test/helpers.mjs"];
    for (const trigger of triggers) {
      const plan = await computeAffectedTests({ root: dir, changedPaths: [trigger] });
      assert.equal(plan.mode, "full", `${trigger} 应触发全量`);
      assert.ok(plan.reason.length > 0, `${trigger} 的全量判定须给出理由`);
    }
  });
});

test("a non-literal dynamic import is reported as an undetermined dependency", async () => {
  // 这类依赖无法静态确定；必须出现在 warnings 里，不能安静地当作没有依赖。
  await withTree(
    {
      "lib/a.js": "export const a = 1;\n",
      "test/dyn.test.mjs": "const name = process.argv[2];\nconst m = await import(name);\n",
    },
    async (dir) => {
      const plan = await computeAffectedTests({ root: dir, changedPaths: ["lib/a.js"] });
      assert.equal(plan.mode, "partial");
      assert.ok(
        plan.warnings.some((w) => w.includes("动态 import")),
        `应报出无法静态确定的依赖，实得 ${JSON.stringify(plan.warnings)}`,
      );
    },
  );
});

test("a changed test file is itself selected", async () => {
  await withTree({ "test/only.test.mjs": "// no imports\n" }, async (dir) => {
    const plan = await computeAffectedTests({ root: dir, changedPaths: ["test/only.test.mjs"] });
    assert.deepEqual(plan.tests, ["test/only.test.mjs"]);
  });
});
