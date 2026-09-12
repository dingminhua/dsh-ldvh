// Tests for plugin/lib/bin.js — the `dsh-ldvh governed-project` CLI.
//
// The CLI is spawned as a child process with DSH_HOME pointed at a throwaway
// directory so registration never touches the real harness home.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gitOk, initRepo, runNode, VALID_COMMIT_MESSAGE, withTemp } from "./helpers.mjs";

const binPath = fileURLToPath(new URL("../lib/bin.js", import.meta.url));

function runBin(args, home) {
	return runNode([binPath, ...args], { env: { ...process.env, DSH_HOME: home } });
}

test("prints usage and exits 2 on malformed invocations", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const home = join(base, "home");

		let result = await runBin([], home);
		assert.equal(result.code, 2);
		assert.match(result.stderr, /Usage: dsh-ldvh governed-project/);

		result = await runBin(["governed-project"], home);
		assert.equal(result.code, 2);
		assert.match(result.stderr, /Usage/);

		result = await runBin(["governed-project", "bogus", "--project", base], home);
		assert.equal(result.code, 2);
		assert.match(result.stderr, /Usage/);

		result = await runBin(["governed-project", "install", "--project", base, "--human-confirmed"], home);
		assert.equal(result.code, 2);
		assert.match(result.stderr, /install requires --id/);
	});
});

test("inspect prints a JSON result with hook and fact source state", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		const result = await runBin(["governed-project", "inspect", "--project", root], home);
		assert.equal(result.code, 0, result.stderr);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.ok, true);
		// resolveGitRoot canonicalizes symlinked path components (e.g. /var -> /private/var)
		assert.equal(parsed.value.projectRoot, await realpath(root));
		assert.equal(parsed.value.factSource.state, "absent");
		assert.equal(parsed.value.hook.state, "absent");
	});
});

test("inspect on an invalid candidate exits 1 with ok:false", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const home = join(base, "home");
		const result = await runBin(["governed-project", "inspect", "--project", "relative/path"], home);
		assert.equal(result.code, 1);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.ok, false);
		assert.equal(parsed.error.code, "candidate_invalid");
	});
});

test("list reports an uninitialized registration on a fresh home", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const home = join(base, "home");
		const result = await runBin(["governed-project", "list"], home);
		assert.equal(result.code, 0, result.stderr);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.ok, true);
		assert.equal(parsed.value.initialized, false);
		assert.deepEqual(parsed.value.projects, []);
		assert.equal(parsed.value.defaultProjectId, "");
	});
});

test("install, list, and uninstall-hook round-trip through the CLI", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const root = await initRepo(base); // staged -> gate preflight passes
		const home = join(base, "home");

		const install = await runBin(
			["governed-project", "install", "--project", root, "--id", "cli-proj", "--name", "CLI Test", "--human-confirmed"],
			home,
		);
		assert.equal(install.code, 0, install.stderr);
		const installParsed = JSON.parse(install.stdout);
		assert.equal(installParsed.ok, true);
		assert.equal(installParsed.value.status.hook.state, "managed");
		assert.equal(installParsed.value.status.factSource.state, "ready");

		const list = await runBin(["governed-project", "list"], home);
		assert.equal(list.code, 0, list.stderr);
		const listParsed = JSON.parse(list.stdout);
		assert.equal(listParsed.value.initialized, true);
		assert.equal(listParsed.value.defaultProjectId, "cli-proj");
		assert.equal(listParsed.value.projects.length, 1);
		assert.equal(listParsed.value.projects[0].name, "CLI Test");

		const uninstall = await runBin(["governed-project", "uninstall-hook", "--project", root, "--human-confirmed"], home);
		assert.equal(uninstall.code, 0, uninstall.stderr);
		assert.equal(JSON.parse(uninstall.stdout).ok, true);

		const after = await runBin(["governed-project", "inspect", "--project", root], home);
		assert.equal(after.code, 0, after.stderr);
		assert.equal(JSON.parse(after.stdout).value.hook.state, "absent");
	});
});

test("install failure propagates as ok:false with exit 1", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const home = join(base, "home");
		const result = await runBin(["governed-project", "install", "--project", join(base, "not-a-repo"), "--id", "x", "--human-confirmed"], home);
		assert.equal(result.code, 1);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.ok, false);
		assert.equal(parsed.error.code, "candidate_invalid");
	});
});

test("uninstall-hook refuses a third-party Hook and exits 1", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const root = await initRepo(base);
		const hookPath = join(root, ".git", "hooks", "commit-msg");
		const thirdParty = "#!/bin/sh\necho third-party\nexit 0\n";
		await writeFile(hookPath, thirdParty, { mode: 0o755 });
		const home = join(base, "home");

		const result = await runBin(["governed-project", "uninstall-hook", "--project", root, "--human-confirmed"], home);
		assert.equal(result.code, 1);
		assert.equal(JSON.parse(result.stdout).ok, false);
		assert.equal(await readFile(hookPath, "utf8"), thirdParty);
	});
});

test("a legal commit passes through the installed CLI Hook (end-to-end)", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		const install = await runBin(["governed-project", "install", "--project", root, "--id", "e2e", "--human-confirmed"], home);
		assert.equal(install.code, 0, install.stderr);

		const passed = await gitOk(root, ["commit", "-m", VALID_COMMIT_MESSAGE]);
		assert.equal(passed.ok, true, passed.stderr);
	});
});

test("unregister requires --id and exits 2", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		const result = await runBin(["governed-project", "unregister", "--project", root], home);
		assert.equal(result.code, 2);
		assert.match(result.stderr, /unregister requires --id/);
	});
});

test("unregister removes the project and clears the default through the CLI", async () => {
	await withTemp("ldvh-bin.", async (base) => {
		const root = await initRepo(base);
		const home = join(base, "home");
		const install = await runBin(["governed-project", "install", "--project", root, "--id", "cli-proj", "--human-confirmed"], home);
		assert.equal(install.code, 0, install.stderr);

		// 07 §5.6: cancellation requires explicit Human intent. A bare
		// invocation is not consent, so the CLI must refuse it.
		const refused = await runBin(["governed-project", "unregister", "--project", root, "--id", "cli-proj"], home);
		assert.equal(refused.code, 1);
		assert.equal(JSON.parse(refused.stdout).error.code, "human_intent_required");

		const unregister = await runBin(["governed-project", "unregister", "--project", root, "--id", "cli-proj", "--human-confirmed"], home);
		assert.equal(unregister.code, 0, unregister.stderr);
		const parsed = JSON.parse(unregister.stdout);
		assert.equal(parsed.ok, true);
		assert.equal(parsed.value.hook.state, "absent");

		const list = await runBin(["governed-project", "list"], home);
		assert.equal(list.code, 0, list.stderr);
		const listParsed = JSON.parse(list.stdout);
		assert.equal(listParsed.value.initialized, true);
		assert.deepEqual(listParsed.value.projects, []);
		assert.equal(listParsed.value.defaultProjectId, "");
	});
});