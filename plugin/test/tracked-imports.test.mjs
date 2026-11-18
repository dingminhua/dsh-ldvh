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

function gitUsable() {
  try {
    git(["rev-parse", "--show-toplevel"]);
    return true;
  } catch {
    return false;
  }
}

function trackedPaths() {
  const raw = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  return new Set(raw.split("\0").filter(Boolean).map(toPosix));
}

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

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
  const sources = [...tracked].filter((p) => p.startsWith("plugin/") && p.endsWith(".js"));

  const offenders = [];
  for (const relPath of sources) {
    const absPath = join(repoRoot, relPath);
    if (!existsSync(absPath)) continue;
    const source = readFileSync(absPath, "utf8");
    for (const spec of relativeSpecifiers(source)) {
      const target = resolve(dirname(absPath), spec);
      if (!existsSync(target)) continue;
      const targetRel = toPosix(target.slice(repoRoot.length + 1));
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


test("动态 import 的字面量路径必须存在于磁盘（被 try 包住的断链不会炸，只能靠这条抓）", async () => {
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const { dirname, join, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const libDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "lib");
  const files = readdirSync(libDir).filter((name) => name.endsWith(".js"));
  const broken = [];
  for (const file of files) {
    const text = readFileSync(join(libDir, file), "utf8");
    const pattern = /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const target = resolve(libDir, match[1]);
      if (!existsSync(target)) broken.push(`${file} → ${match[1]}`);
    }
  }
  assert.deepEqual(
    broken, [],
    `动态 import 指向不存在的文件（运行时不炸、只在该分支静默失效）：\n${broken.join("\n")}`,
  );
});
