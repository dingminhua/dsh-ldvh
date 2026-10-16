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
import { dirname } from "node:path";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = ["--test"];
// Windows: forcing exit races libuv's async-handle teardown (see header).
if (process.platform !== "win32") args.push("--test-force-exit");
args.push("test/*.test.mjs");

// stdio "inherit": the runner's output goes straight to the caller, and the
// child's exit code becomes ours — no output capture, so nothing here can
// interact with the very teardown race this script exists to avoid.
// No `shell: true`: Node's own test runner expands the glob argument, so this
// works identically on every platform without a shell in the middle.
const child = spawn(process.execPath, args, {
  cwd: pluginRoot,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.stderr.write(`test runner terminated by signal ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
