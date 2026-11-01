#!/usr/bin/env node
/**
 * Run the plugin test suite, applying `--test-force-exit` only where it is safe.
 *
 * WHY THIS EXISTS
 * `4e02f9f` added `--test-force-exit` to `npm test` to remove a ~84s teardown
 * hang. That flag is correct on Linux and macOS but ABORTS the whole Node
 * process on Windows when undici still holds in-flight `fetch` handles at
 * teardown:
 *
 *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
 *       file src\win\async.c, line 94
 *
 * The abort is a native assertion, so it is not an assertion failure any test
 * can catch: the runner dies and the containing file is reported as failed with
 * no failing test inside it. Observed deterministically on Windows/Node 24.19
 * (2/2 runs) in `test/client-fallback.test.mjs`, whose probe leaves fetches
 * outstanding; the same suite passes 1523/1523 without the flag (2/2 runs).
 *
 * Upstream reports (Windows-only, `fetch` + early exit):
 *   https://github.com/nodejs/node/issues/58091
 *   https://github.com/undici/undici/issues/5680
 *   https://github.com/libuv/libuv/issues/3622
 *
 * Measured on Windows, the flag buys nothing anyway (38.0s vs 37.9s for the
 * full suite), so omitting it there costs no time. On Linux/macOS the ~84s
 * teardown hang it prevents is real and the flag is kept.
 *
 * This is a platform-conditional invocation, not a weakening of the suite: both
 * branches run the SAME test files, and the flag is not a correctness knob —
 * it only skips the post-run waiting period.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { observedTestCount, reconcileTestCount } from "../lib/test-run-report.js";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = ["--test"];
// Windows: forcing exit races libuv's async-handle teardown (see header).
if (process.platform !== "win32") args.push("--test-force-exit");
args.push("test/*.test.mjs");

/**
 * Count the `test(...)` / `it(...)` declarations across every test file.
 *
 * WHY THIS EXISTS（2026-11-02，实测）
 * `--test-force-exit` 让进程在**同一测试文件的多个 runner 同时存在**时可能
 * 在文件执行到一半就退出，且退出过程不留任何痕迹：统计行照样自洽
 * （`tests 62 / pass 62 / fail 0 / cancelled 0`），**退出码也是 0**。
 * 实测（10 路并发同文件 ×1 批，24 次里 3 次截断）：91 条的
 * `commit-validation.test.mjs` 出现过 42/83/85 条，缺失的总是执行顺序靠后的
 * 那一段，而报告说「全过」。
 *
 * 这个缺陷在 `npm test` 的当前用法下**不会发生**——它是单进程、每个文件只跑
 * 一次；实测真实全量连跑 6 次全部 2639 条、exit 0。但它一旦发生就是静默丢
 * 用例，且**没有任何机械信号**能区分「少跑了」与「用例本来就少」。所以这里
 * 加一道独立于 runner 的声明数对账：跑完后按源码里的 `test(` 声明数复核，
 * 数量对不上就判失败。
 *
 * 边界（如实登记）：只数 `test(` / `it(` 的**声明**，不解析条件注册
 * （`test.skipIf(...)`、循环里生成的用例会数偏），因此它是**下限守卫**而不是
 * 精确等式——`--test-force-exit` 的截断只会让实际运行数**少于**声明数，
 * 用「实际 < 声明」作判据既抓住这个缺陷，又不会被条件注册误报。
 */
async function countDeclaredTests() {
  const testDir = join(pluginRoot, "test");
  let total = 0;
  for (const name of await readdir(testDir)) {
    if (!name.endsWith(".test.mjs")) continue;
    const text = await readFile(join(testDir, name), "utf8");
    // 逐行匹配行首（允许缩进）的 test( / it( / test.only( 等；跳过注释行。
    for (const line of text.split("\n")) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (/^(test|it)(\.[a-zA-Z]+)?\s*\(/.test(trimmed)) total += 1;
    }
  }
  return total;
}

// TAP reporter on stdout would change the human-facing output, so instead we
// let the child write normally and parse the summary line it prints at the end
// (`ℹ tests N`). That line is emitted by the runner itself, after every file
// finished — its absence with a zero exit code is itself the anomaly we guard.
const child = spawn(process.execPath, args, {
  cwd: pluginRoot,
  stdio: ["inherit", "pipe", "inherit"],
});

let tailBuffer = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  tailBuffer = (tailBuffer + chunk.toString()).slice(-4096);
});

child.on("exit", async (code, signal) => {
  if (signal !== null) {
    process.stderr.write(`test runner terminated by signal ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }
  // 条数对账的**判定**在 lib/test-run-report.js 内实现一次（06 §6 单一实现），
  // 本脚本只负责取数、读写基线与把结论转成退出码。
  const observedTests = observedTestCount({ stdout: tailBuffer });
  let declared;
  try {
    declared = await countDeclaredTests();
  } catch (error) {
    // 数不出来时不冒充通过：显式告警并保持成功退出码（对账本身不是被测对象）。
    process.stderr.write(`test-count guard: could not count declared tests (${error?.message ?? error})\n`);
    process.exitCode = 0;
    return;
  }
  const baselinePath = join(pluginRoot, "test", ".test-count-baseline");
  let baseline = null;
  try {
    baseline = Number((await readFile(baselinePath, "utf8")).trim()) || null;
  } catch {
    baseline = null; // 首次运行没有基线，本回合只写不校验
  }
  const check = reconcileTestCount({ observed: observedTests, declared, baseline });
  if (!check.ok) {
    process.stderr.write(`test-count guard: ${check.verdict}（${check.evidence}）\n`);
    process.stderr.write(
      "  --test-force-exit 的截断签名：汇总块照样自洽（pass N / fail 0），退出码也是 0。" +
        "重跑；若重现，把本次套件当作**未完成**，不要当绿。\n",
    );
    process.exitCode = 1;
    return;
  }
  // 基线只在**绿跑**且条数增长时前移。刻意不在条数下降时前移：删减用例须经
  // 评审，届时新的绿跑自然把基线下移——那是有意的，不是掩盖。
  if (observedTests !== null && observedTests > (baseline ?? 0)) {
    try {
      await writeFile(baselinePath, `${observedTests}\n`, "utf8");
    } catch {
      /* 写不成基线不影响本次通过 */
    }
  }
  process.exitCode = 0;
});
