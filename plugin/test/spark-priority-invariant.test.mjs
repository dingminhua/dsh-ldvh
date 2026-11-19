import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { repoRoot, skipWithoutCorpus } from "./helpers.mjs";

const TIERS = new Set(["P0", "P1", "P2", "P3"]);

test("事实源：每条 open Spark 都带处置档位，终态 Spark 都不带（22 §8）", async (t) => {
  if (await skipWithoutCorpus(t)) return;
  const dir = join(repoRoot, "ldvh-base", "sparks");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const problems = [];
  let open = 0;
  let terminal = 0;
  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf8");
    const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
    if (m === null) {
      problems.push(`${file}: 无 frontmatter 块`);
      continue;
    }
    const fm = parseYaml(m[1]);
    if (fm.status === "open") {
      open += 1;
      if (!TIERS.has(fm.priority)) {
        problems.push(`${file}: status=open 但 priority=${JSON.stringify(fm.priority)}`);
      }
    } else {
      terminal += 1;
      if (fm.priority !== undefined) {
        problems.push(`${file}: status=${fm.status} 却带 priority=${fm.priority}`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join("; "));
  assert.ok(open > 0, "读到的 open Spark 不得为空——否则本用例可能因指错目录而空过");
  assert.ok(terminal > 0, "读到的终态 Spark 不得为空——否则互斥那一半没被检过");
});
