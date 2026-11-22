

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { CARRIER_ENTRY_REF_PATTERN } from "../lib/carrier-ref.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const LIB_DIR = join(REPO_ROOT, "plugin", "lib");
const CARRIERS_DIR = join(REPO_ROOT, "plugin-specs");

const SCANNED_FILES = Object.freeze([
  "after-integrity.js",
  "friction-tools.js",
  "goal-tools.js",
  "host-seams.js",
  "norm-tools.js",
  "norm-writer.js",
  "pitfall-tools.js",
  "precheck-record.js",
  "report-tools.js",
  "spark-tools.js",
  "subgoal-tools.js",
]);

async function carrierEntryIds(specKey) {
  const text = await readFile(join(CARRIERS_DIR, `${specKey}.yaml`), "utf8");
  return new Set([...text.matchAll(/^\s{4}- id: (\S+)$/gm)].map((match) => match[1]));
}

async function carrierSpecKeys() {
  const names = await readdir(CARRIERS_DIR);
  return new Set(names.filter((name) => name.endsWith(".yaml")).map((name) => name.slice(0, -".yaml".length)));
}

test("运行期来源指针逐条可解析：载体存在且条目存在", async () => {
  const specKeys = await carrierSpecKeys();
  const entryCache = new Map();
  const problems = [];
  let checked = 0;

  for (const file of SCANNED_FILES) {
    const text = await readFile(join(LIB_DIR, file), "utf8");
    for (const match of text.matchAll(CARRIER_ENTRY_REF_PATTERN)) {
      const [, carrier, first, second] = match;
      checked += 1;
      if (!specKeys.has(carrier)) {
        problems.push(`${file}: 载体 ${carrier} 不存在（指向 ${match[0]}）`);
        continue;
      }
      if (!entryCache.has(carrier)) entryCache.set(carrier, await carrierEntryIds(carrier));
      const ids = entryCache.get(carrier);
      for (const entry of [first, second].filter((value) => value !== undefined)) {
        if (!ids.has(entry)) {
          problems.push(`${file}: 载体 ${carrier} 无条目 ${entry}（指向 ${match[0]}）`);
        }
      }
    }
  }

  assert.deepEqual(problems, [], `运行期来源指针须逐条可解析：\n${problems.join("\n")}`);
  assert.ok(checked > 0, "本次至少应扫到一条运行期来源指针（否则本检查形同虚设）");
});

test("运行期来源指针不得回指开发规范的章节号", async () => {
  const problems = [];
  for (const file of SCANNED_FILES) {
    const text = await readFile(join(LIB_DIR, file), "utf8");

    for (const match of text.matchAll(/\bspecs\/[0-9]{2}[^\s"')]*\s*§/g)) {
      problems.push(`${file}: 仍以开发规范章节号指称来源（${match[0].trim()}）`);
    }
  }
  assert.deepEqual(problems, [], `运行期面不得以开发规范章节号作来源指称：\n${problems.join("\n")}`);
});
