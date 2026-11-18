import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installHook } from "../lib/hook-manager.js";
import { initRepo, runnerPath, withTemp } from "./helpers.mjs";

async function withGitLog(base, fn) {
	const shimDir = join(base, "git-shim");
	await mkdir(shimDir, { recursive: true });
	const logFile = join(base, "git-argv.log");
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
	await withTemp("ldvh-pfc.", async (base) => {
		const root = await initRepo(base);
		const { result, calls } = await withGitLog(base, () => installHook({ projectRoot: root, runnerPath, workspaceRoot: base }));
		assert.equal(result.ok, true, result.error?.message);
		const indexListings = calls.filter((line) => line.endsWith("ls-files --cached -z")).length;
		assert.ok(indexListings <= 4, `a single gate run must not re-issue the whole-Index listing (saw ${indexListings} across four runs): ${calls.filter((l) => l.endsWith("ls-files --cached -z")).join(" | ")}`);
	});
});
