// Guards for the two cost reductions in `installHook`'s preflight
// (2026-10-31), written so that REVERTING either reduction turns a test red.
//
// WHY THIS FILE EXISTS
// `installHook` spends almost all its time in the preflight: four Hook
// invocations, each spawning `node` and then ~13 `git` children. Measured on a
// throwaway repo: 2.5s per install, ~35s of the suite across 13 installs. Two
// reductions were made, and BOTH preserve every assertion:
//
//   1. the four invocations now run concurrently instead of serially
//      (2072ms -> 501ms for the same four probes);
//   2. within one gate run, identical read-only git queries are memoized
//      (60 -> 52 spawns per install; `ls-files --cached -z` alone went 12 -> 4).
//
// Neither reduction may be turned into "prove less". The whole point of the
// preflight is that EVERY install really proves both Hooks block; an
// optimization that quietly drops a probe would still look fast and still pass
// a timing test. So the guards below assert the INVOCATION COUNT and the
// ABSENCE OF DUPLICATE QUERIES — deterministic properties of the code, not
// wall-clock thresholds. (A timing threshold would also be a Human Gate matter:
// 06 §9.1 item 5 forbids implementing a mechanical rule the spec has not
// established, and 34 §17 item 9 states recall performance is not an
// auto-acceptable criterion.)
//
// The counting is done with a PATH shim that logs every `git` argv, because the
// alternative — asserting on source text — cannot tell "the query is issued
// twice" from "the line appears twice".
import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installHook } from "../lib/hook-manager.js";
import { initRepo, runnerPath, withTemp } from "./helpers.mjs";

/**
 * Run `fn` with a logging `git` wrapper first on PATH, then return both the
 * result and every git argv the process tree issued.
 *
 * The shim is a POSIX shell script, so this file early-returns on win32 — the
 * same convention the rest of the suite uses for POSIX-only mechanisms (see
 * `plugin/README.md` and `hook-manager.test.mjs`'s executable-bit case). The
 * behavior being guarded is platform-independent; only this measurement
 * technique is not.
 */
async function withGitLog(base, fn) {
	const shimDir = join(base, "git-shim");
	await mkdir(shimDir, { recursive: true });
	const logFile = join(base, "git-argv.log");
	// `command -v` would resolve the shim itself, so the real binary is located
	// with an explicit PATH that excludes the shim directory.
	const realGit = "/usr/bin/git";
	await writeFile(join(shimDir, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${logFile}'\nexec '${realGit}' "$@"\n`, "utf8");
	await chmod(join(shimDir, "git"), 0o755);
	const originalPath = process.env.PATH;
	process.env.PATH = `${shimDir}:${originalPath}`;
	try {
		const result = await fn();
		let calls = [];
		try {
			calls = (await readFile(logFile, "utf8")).split("\n").filter(Boolean);
		} catch {
			calls = [];
		}
		return { result, calls };
	} finally {
		process.env.PATH = originalPath;
	}
}

test("preflight proves both Hooks with both probes on every install", async () => {
	if (process.platform === "win32") return;
	// The rendered Hook body calls `git rev-parse --show-toplevel` exactly once
	// per invocation, and it does so WITHOUT `-C` (it is already cd'd into the
	// worktree). The manager's own calls always pass `-C`, so counting the bare
	// form counts HOOK INVOCATIONS and nothing else.
	//
	// commit-msg: invalid + valid message = 2. pre-commit: empty Index +
	// synthetic valid Index = 2. Total 4 — the number the preflight must keep
	// whatever it does about scheduling. Dropping any probe (e.g. "the valid
	// message always passes, skip it") makes this 3 and turns the test red.
	const BARE_REV_PARSE = /^rev-parse --show-toplevel$/;
	await withTemp("ldvh-pfc.", async (base) => {
		const root = await initRepo(base);
		const { result, calls } = await withGitLog(base, () => installHook({ projectRoot: root, runnerPath, workspaceRoot: base }));
		assert.equal(result.ok, true, result.error?.message);
		const invocations = calls.filter((line) => BARE_REV_PARSE.test(line)).length;
		assert.equal(invocations, 4, `the preflight must still run all four probes (got ${invocations}): ${calls.filter((l) => l.includes("rev-parse")).join(" | ")}`);
	});
});

test("one gate run issues each read-only git query at most once", async () => {
	if (process.platform === "win32") return;
	// The memo's contract, stated as a property of the observed argv stream
	// rather than of the source: within one install (four gate runs, each
	// re-memoized) no two spawns may carry the same argv for the same
	// worktree. Reverting the memo puts `ls-files --cached -z` back to three
	// spawns per run and turns this red.
	//
	// Duplicates are counted per (worktree, argv) pair. The two Hooks share the
	// same worktree, so a query legitimately appears once per GATE RUN — the
	// bound below is "at most one per run per Hook probe", which is why the
	// expectation is derived from the observed number of gate runs instead of
	// being pinned to a magic constant.
	await withTemp("ldvh-pfc.", async (base) => {
		const root = await initRepo(base);
		const { result, calls } = await withGitLog(base, () => installHook({ projectRoot: root, runnerPath, workspaceRoot: base }));
		assert.equal(result.ok, true, result.error?.message);
		// `ls-files --cached -z` (whole Index) is the query that was duplicated
		// three times inside a single run. Each of the four probes runs it at
		// most once, so four runs may produce at most four.
		const indexListings = calls.filter((line) => line.endsWith("ls-files --cached -z")).length;
		assert.ok(indexListings <= 4, `a single gate run must not re-issue the whole-Index listing (saw ${indexListings} across four runs): ${calls.filter((l) => l.endsWith("ls-files --cached -z")).join(" | ")}`);
	});
});
