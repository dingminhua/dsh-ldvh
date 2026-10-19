/**
 * 已跟踪文件不得 import 未纳入版本控制的文件。
 *
 * WHY THIS EXISTS
 * `e25dc43`（2026-10-19 02:08）给 `lib/adr-tools.js` 加了
 * `import { objectRef } from "./object-reference.js"`，但那个新文件**忘记
 * `git add`**。此后连续 14 个提交都带着这条断链，而**本地一切正常**——
 * 因为文件就躺在工作树里，`import` 当然成功。
 *
 * 只有净检出（clone / worktree / CI）才会暴露：
 *     import('plugin/lib/adr-tools.js') → ERR_MODULE_NOT_FOUND
 * 而且断的不止一个模块：spark-tools / pitfall-tools / workcase-tools 都 import 它，
 * 四个模块一起起不来。
 *
 * 现有测试全绿也报不出来：它们跑在**同一个工作树**里，同样能读到那个未跟踪
 * 文件。这个缺陷的盲区正好是「工作树 ≠ 提交内容」，所以判据必须直接问 git
 * 「这个文件在版本控制里吗」，而不是问文件系统「这个文件存在吗」。
 *
 * 判据只覆盖一类：相对路径 import 指向的**已存在于磁盘**的文件不在 git 索引里。
 * 故意不覆盖「路径根本不存在」（那是拼写错误，Node 运行时会立刻炸，测试本来
 * 也跑不起来），也不覆盖 node: 内置与裸包名。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(pluginRoot);

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

/** git 是否可用且当前目录在仓库内——不可用时跳过，绝不伪造通过。 */
function gitUsable() {
  try {
    git(["rev-parse", "--show-toplevel"]);
    return true;
  } catch {
    return false;
  }
}

/** 索引中存在的路径集合（相对仓库根）。`ls-files -z` 避免路径含空格时被拆开。 */
function trackedPaths() {
  const raw = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  return new Set(raw.split("\0").filter(Boolean));
}

/**
 * 抓取源码里的相对说明符：`from "./x.js"`、`import("./x.js")`、`import "./x.js"`。
 * 只认以 `.` 开头的，`node:` 内置与裸包名不在此列。
 */
function relativeSpecifiers(source) {
  const found = new Set();
  const patterns = [
    /\bfrom\s+["'](\.[^"']*)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']*)["']\s*\)/g,
    /\bimport\s+["'](\.[^"']*)["']/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) found.add(m[1]);
  }
  return [...found];
}

test("已跟踪的源文件不得 import 未纳入版本控制的文件", (t) => {
  if (!gitUsable()) {
    t.skip("git 不可用（或不在仓库内），无法判定跟踪状态");
    return;
  }
  const tracked = trackedPaths();
  // 只看已跟踪的源文件：未跟踪文件本来就不该作为「已提交状态」的代表。
  const sources = [...tracked].filter((p) => p.startsWith("plugin/") && p.endsWith(".js"));

  const offenders = [];
  for (const relPath of sources) {
    const absPath = join(repoRoot, relPath);
    if (!existsSync(absPath)) continue; // 索引里有、盘上没有（删除待提交），另有检查负责
    const source = readFileSync(absPath, "utf8");
    for (const spec of relativeSpecifiers(source)) {
      const target = resolve(dirname(absPath), spec);
      if (!existsSync(target)) continue; // 真·路径不存在，运行时会报，不归这条管
      const targetRel = target.slice(repoRoot.length + 1);
      if (!tracked.has(targetRel)) {
        offenders.push(`${relPath} → ${spec}（${targetRel} 不在索引中）`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "存在 import 指向未跟踪文件的情形——本地能跑通，因为工作树里有那个文件；"
      + "别人净检出会 ERR_MODULE_NOT_FOUND。修法：git add 那些文件。\n"
      + offenders.map((line) => `  - ${line}`).join("\n"),
  );
});

test("判据本身有效：能识别出未跟踪目标（防止用例空转）", () => {
  // 上一条用例的失效形态是「永久绿」：如果 relativeSpecifiers 抓不到东西，或
  // trackedPaths 恰好为空集，它会无条件通过。这里直接钉住两个基本事实。
  const sample = [
    'import { a } from "./alpha.js";',
    'import "./beta.js";',
    'const m = await import("./gamma.js");',
    'import { n } from "node:fs";',
    'import { s } from "yaml";',
  ].join("\n");
  assert.deepEqual(
    relativeSpecifiers(sample).sort(),
    ["./alpha.js", "./beta.js", "./gamma.js"],
    "必须抓到三种相对 import 形态，且不得把 node: 内置与裸包名当成相对路径",
  );

  if (!gitUsable()) return;
  const tracked = trackedPaths();
  assert.ok(tracked.size > 0, "索引非空——否则上一条用例会因遍历零个文件而无条件通过");
  assert.ok(
    [...tracked].some((p) => p === "plugin/lib/spark-writer.js"),
    "索引里应当有 plugin/lib/spark-writer.js；它不在说明判据扫描的分区不对",
  );
});
