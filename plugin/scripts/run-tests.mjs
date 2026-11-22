#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { countTestBlocks, observedCountDialect, observedTestCount, observedSkippedCount, reconcileTestCount } from "../lib/test-run-report.js";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = ["--test", "test/*.test.mjs"];

async function countDeclaredTests() {
  const testDir = join(pluginRoot, "test");
  let total = 0;
  for (const name of await readdir(testDir)) {
    if (!name.endsWith(".test.mjs")) continue;
    const text = await readFile(join(testDir, name), "utf8");
    total += countTestBlocks(text);
  }
  return total;
}

const child = spawn(process.execPath, args, {
  cwd: pluginRoot,
  stdio: ["inherit", "pipe", "inherit"],
});

let tailBuffer = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  tailBuffer = (tailBuffer + chunk.toString()).slice(-131072);
});

child.on("close", async (code, signal) => {
  if (signal !== null) {
    process.stderr.write(`test runner terminated by signal ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }
  const observedTests = observedTestCount({ stdout: tailBuffer });
  let declared;
  try {
    declared = await countDeclaredTests();
  } catch (error) {
    process.stderr.write(`test-count guard: could not count declared tests (${error?.message ?? error})\n`);
    process.exitCode = 0;
    return;
  }
  const baselinePath = join(pluginRoot, "test", ".test-count-baseline");
  let baseline = null;
  try {
    baseline = Number((await readFile(baselinePath, "utf8")).trim()) || null;
  } catch {
    baseline = null;
  }
  const skippedBaselinePath = join(pluginRoot, "test", ".test-skipped-baseline");
  let skippedBaseline = null;
  try {
    skippedBaseline = Number((await readFile(skippedBaselinePath, "utf8")).trim()) || null;
  } catch {
    skippedBaseline = null;
  }
  const observedSkipped = observedSkippedCount({ stdout: tailBuffer });
  const check = reconcileTestCount({ observed: observedTests, declared, baseline, skipped: observedSkipped, skippedBaseline });
  process.stderr.write(`test-count guard: 取数方言 ${observedCountDialect({ stdout: tailBuffer }) ?? "不可得"}（close 后判定，stdio 已关闭）\n`);
  if (!check.ok) {
    process.stderr.write(`test-count guard: ${check.verdict}（${check.evidence}）\n`);
    if (check.code === "skip_above_baseline") {
      process.stderr.write(
        "  处置：逐条核对本次 skip 清单与 skip 基线的差集——属环境依赖的设计内跳过则评审后受控上移基线；属新增掩盖则修复用例。\n",
      );
    } else {
      process.stderr.write(
        "  汇总行缺失或条数缺口时，把本次套件当作**未完成**，不要当绿；重跑并核对运行环境。\n",
      );
    }
    process.exitCode = 1;
    return;
  }
  if (observedTests !== null && observedTests > (baseline ?? 0)) {
    try {
      await writeFile(baselinePath, `${observedTests}\n`, "utf8");
    } catch {
    }
  }
  process.exitCode = 0;
});
