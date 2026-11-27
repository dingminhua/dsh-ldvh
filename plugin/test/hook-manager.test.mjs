import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	HOOK_BUNDLE_VERSION,
	INTERPRETER_UNAVAILABLE_MARKER,
	cleanGitEnvironment,
	inspectHook,
	installHook,
	parseHookPaths,
	parseManagedHook,
	renderHook,
	resolveIdentity,
	resolveShCommand,
	uninstallHook,
} from "../lib/hook-manager.js";
import { gateEnv, git, gitOk, initRepo, pluginRoot, runnerPath, signatureEnv, VALID_COMMIT_MESSAGE, withTemp } from "./helpers.mjs";

const execFileAsync = promisify(execFile);

async function runHookWithEnv(hookPath, messageFile, cwd, env) {
	const command = process.platform === "win32" ? await resolveShCommand() : hookPath;
	const args = process.platform === "win32" ? [hookPath, messageFile] : [messageFile];
	try {
		const result = await execFileAsync(command, args, { cwd, env: { ...cleanGitEnvironment(), ...env }, encoding: "utf8", timeout: 20000 });
		return { code: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		return { code: typeof error?.code === "number" ? error.code : 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? String(error?.message || error) };
	}
}


test("resolveIdentity requires a non-empty absolute path", async () => {
	await assert.rejects(resolveIdentity("relative/path"), /non-empty absolute path/);
	await assert.rejects(resolveIdentity(""), /non-empty absolute path/);
	await assert.rejects(resolveIdentity(undefined), /non-empty absolute path/);
});

test("resolveIdentity requires an existing regular directory", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		await assert.rejects(resolveIdentity(join(base, "does-not-exist")), (error) => error?.code === "ENOENT");
		const file = join(base, "plain-file");
		await writeFile(file, "not a directory\n");
		await assert.rejects(resolveIdentity(file), /must be a directory/);
	});
});

test("resolveIdentity rejects a subdirectory of a repository (strict Git root)", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		await mkdir(join(root, "sub"));
		await assert.rejects(resolveIdentity(join(root, "sub")), /must be the Git root, not a subdirectory/);
		const identity = await resolveIdentity(root);
		assert.equal(identity.projectRoot, await realpath(root));
	});
});

test("resolveIdentity rejects a bare repository", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		await git(base, ["init", "-q", "--bare", join(base, "bare.git")]);
		await assert.rejects(resolveIdentity(join(base, "bare.git")), /work tree/);
	});
});

test("resolveIdentity rejects a repo whose hooks path is not a regular directory", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		await rm(join(root, ".git", "hooks"), { recursive: true, force: true });
		await mkdir(join(base, "hooks-target"));
		await symlink(
			join(base, "hooks-target"),
			join(root, ".git", "hooks"),
			process.platform === "win32" ? "junction" : undefined,
		);
		await assert.rejects(resolveIdentity(root), /Git hooks path must be a regular directory/);
	});
});

test("resolveIdentity reports identity for a governed repository", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const identity = await resolveIdentity(root);
		const canonicalRoot = await realpath(root);
		assert.equal(identity.projectRoot, canonicalRoot);
		assert.equal(identity.gitCommonDir, join(canonicalRoot, ".git"));
		assert.equal(identity.hookDirectory, join(canonicalRoot, ".git", "hooks"));
		assert.equal(identity.hookPath, join(canonicalRoot, ".git", "hooks", "commit-msg"));
	});
});

test("inspectHook reports unavailable for a directory that is not a Git repository", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		await mkdir(join(base, "not-a-repo"));
		const status = await inspectHook(join(base, "not-a-repo"));
		assert.equal(status.state, "unavailable");
		assert.match(status.detail, /not a git repository/i);
	});
});

test("inspectHook tolerates a missing hooks directory and reports absent", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		await rm(join(root, ".git", "hooks"), { recursive: true, force: true });
		const status = await inspectHook(root);
		assert.equal(status.state, "absent");
	});
});


test("parseManagedHook round-trips a rendered Hook and detects body tampering", () => {
	const rendered = renderHook({ runnerPath, workspaceRoot: "/tmp/example" });
	const parsed = parseManagedHook(rendered);
	assert.equal(parsed.owned, true);
	assert.equal(parsed.valid, true);
	assert.equal(parsed.version, HOOK_BUNDLE_VERSION);
	assert.ok(parsed.body.includes("ldvh-hook-bundle-version"));

	const tampered = rendered.replace("set -eu", "set -eu #tampered");
	const parsedTampered = parseManagedHook(tampered);
	assert.equal(parsedTampered.owned, true);
	assert.equal(parsedTampered.valid, false);
	assert.equal(parsedTampered.version, HOOK_BUNDLE_VERSION);
});

test("parseManagedHook rejects content that is not an LDVH-managed Hook", () => {
	assert.equal(parseManagedHook("#!/bin/sh\necho third-party\nexit 0\n").owned, false);
	assert.equal(parseManagedHook("no shebang at all").owned, false);
	assert.deepEqual(parseManagedHook("#!/bin/sh\n# some other marker\nbody\n"), { owned: false, valid: false, version: null });
});

test("inspectHook reports digest tampering as a conflict and never deletes it", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true);

		const hookPath = join(root, ".git", "hooks", "commit-msg");
		const original = await readFile(hookPath, "utf8");
		const tampered = original.replace("set -eu", "set -eu #tampered");
		await writeFile(hookPath, tampered, { mode: 0o755 });

		const status = await inspectHook(root);
		assert.equal(status.state, "conflict");
		assert.match(status.detail, /digest does not match/);
		assert.equal(status.hookBundleVersion, HOOK_BUNDLE_VERSION);

		const removed = await uninstallHook(root);
		assert.equal(removed.ok, false);
		assert.equal(removed.error.code, "hook_conflict");
		assert.equal(await readFile(hookPath, "utf8"), tampered, "tampered Hook must be preserved");
	});
});

test("cleanGitEnvironment strips ambient Git override variables", () => {
	const keys = ["GIT_DIR", "GIT_WORK_TREE", "MY_VAR"];
	const snapshot = new Map(keys.map((key) => [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined]));
	try {
		process.env.GIT_DIR = "/ambient-git-dir";
		process.env.GIT_WORK_TREE = "/ambient-work-tree";
		process.env.MY_VAR = "keep-me";
		const plain = cleanGitEnvironment({});
		assert.equal(plain.GIT_DIR, undefined, "ambient GIT_DIR must be stripped");
		assert.equal(plain.GIT_WORK_TREE, undefined, "ambient GIT_WORK_TREE must be stripped");
		assert.equal(plain.MY_VAR, "keep-me", "unrelated ambient vars must survive");
		assert.equal(plain.GIT_TERMINAL_PROMPT, "0");
		const explicit = cleanGitEnvironment({ GIT_INDEX_FILE: "/explicit/preflight-index", GIT_DIR: "/explicit-dir" });
		assert.equal(explicit.GIT_INDEX_FILE, "/explicit/preflight-index", "explicit GIT_INDEX_FILE must survive");
		assert.equal(explicit.GIT_DIR, "/explicit-dir", "explicit GIT_DIR must survive");
		assert.equal(explicit.MY_VAR, "keep-me", "unrelated ambient vars survive alongside explicit extras");
	} finally {
		for (const [key, value] of snapshot) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});


test("hook lifecycle: absent -> install -> managed -> uninstall -> absent", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const absent = await inspectHook(root);
		assert.equal(absent.state, "absent");
		assert.equal(absent.hookBundleVersion, null);

		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
		assert.equal(install.value.hookBundleVersion, HOOK_BUNDLE_VERSION);
		const content = await readFile(join(root, ".git", "hooks", "commit-msg"), "utf8");
		assert.match(content, /^#!\/bin\/sh\n# ldvh-native-commit-msg-hook: v1 sha256:/);
		assert.doesNotMatch(content, /exec node /);
		assert.match(content, /for candidate in/);
		assert.match(content, /node_bin=\$candidate/);
		assert.match(content, /ELECTRON_RUN_AS_NODE=1 exec "\$node_bin"/);

		const managed = await inspectHook(root);
		assert.equal(managed.state, "managed");
		assert.equal(managed.detail, "LDVH Git Hook is current");

		const removed = await uninstallHook(root);
		assert.equal(removed.ok, true);
		assert.equal(removed.value.state, "absent");
		assert.equal((await inspectHook(root)).state, "absent");
	});
});

test("installHook recreates the hooks directory when it is missing", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		await rm(join(root, ".git", "hooks"), { recursive: true, force: true });
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
		assert.ok((await lstat(join(root, ".git", "hooks"))).isDirectory());
	});
});

test("installHook succeeds on a clean tree via the synthetic preflight index", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base, { stage: false });
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
		assert.equal(await git(root, ["diff", "--cached"]), "", "the real Index must stay empty");
	});
});

test("real commit-msg: illegal commit is blocked, legal commit passes", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		await mkdir(join(root, "specs"), { recursive: true });
		await writeFile(join(root, "specs", "99-fixture.md"), "# fixture\n");
		await gitOk(root, ["add", "specs/99-fixture.md"]);
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);

		const commitEnv = { ...gateEnv(signatureEnv()), LDVH_WORKSPACE_ROOT: pluginRoot };
		const blocked = await gitOk(root, ["commit", "-m", "bad header no colon"], { env: commitEnv });
		assert.equal(blocked.ok, false, "commit with illegal message must be blocked");
		assert.match(blocked.stderr, /LDVH Git Gate \(commit-msg\) failed/);
		assert.match(blocked.stderr, /validation\/header_invalid/);
		const porcelain = await git(root, ["status", "--porcelain"]);
		assert.match(porcelain, /^A {2}README\.md/m);

		const governedMessage = VALID_COMMIT_MESSAGE.replace("seed README.md test carrier", "seed README.md and specs/99-fixture.md carriers");
		const passed = await gitOk(root, ["commit", "-m", governedMessage], { env: commitEnv });
		assert.equal(passed.ok, true, `legal commit must pass: ${passed.stderr}`);
		const log = await git(root, ["log", "--oneline"]);
		assert.match(log, /接入 ldvh 提交校验/);
	});
});

test("preflight synthetic index stays tiny on a repository with commit history", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		await git(root, ["commit", "-m", "initial"]);
		const chunk = "y".repeat(1024);
		for (let i = 0; i < 6; i++) {
			const name = `bulk-${i}.txt`;
			await writeFile(join(root, name), chunk.repeat(1200));
			await git(root, ["add", name]);
		}
		await git(root, ["commit", "-m", "chore(code): 批量添加文件"]);

		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
	});
});

test("preflight still succeeds on a repository without any commit", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
	});
});


test("third-party Hook: install and uninstall refuse and leave zero bytes changed", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const hookPath = join(root, ".git", "hooks", "commit-msg");
		const thirdParty = "#!/bin/sh\necho 'third-party gate'\nexit 0\n";
		await writeFile(hookPath, thirdParty, { mode: 0o755 });
		const before = await readFile(hookPath, "utf8");

		assert.equal((await inspectHook(root)).state, "conflict");

		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, false);
		assert.equal(install.error.code, "hook_conflict");
		assert.match(install.error.message, /unmanaged commit-msg Hook already exists/);

		const removed = await uninstallHook(root);
		assert.equal(removed.ok, false);
		assert.equal(removed.error.code, "hook_conflict");

		assert.equal(await readFile(hookPath, "utf8"), before, "third-party Hook must stay byte-identical");
	});
});


test("uninstallHook is a no-op success on an absent Hook", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const first = await uninstallHook(root);
		assert.equal(first.ok, true);
		assert.equal(first.value.state, "absent");
		const second = await uninstallHook(root);
		assert.equal(second.ok, true);
	});
});

test("uninstallHook removes the surviving managed Hook in a mixed managed/absent state", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		const hooksDir = join(root, ".git", "hooks");
		await rm(join(hooksDir, "pre-commit"), { force: true });

		const status = await inspectHook(root);
		assert.equal(status.state, "absent", "aggregated state collapses to absent when one Hook is missing");
		const removed = await uninstallHook(root);
		assert.equal(removed.ok, true);
		await assert.rejects(readFile(join(hooksDir, "commit-msg")), (error) => error?.code === "ENOENT", "surviving managed Hook must be removed");
	});
});

test("uninstallHook removes only commit-msg and keeps the hooks directory", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		await writeFile(join(root, ".git", "hooks", "post-commit.sample"), "#!/bin/sh\n", { mode: 0o755 });

		const removed = await uninstallHook(root);
		assert.equal(removed.ok, true);
		assert.equal(removed.value.state, "absent");
		await assert.rejects(readFile(join(root, ".git", "hooks", "commit-msg")), (error) => error?.code === "ENOENT");
		assert.ok((await lstat(join(root, ".git", "hooks"))).isDirectory(), "hooks directory must remain");
		assert.equal(await readFile(join(root, ".git", "hooks", "post-commit.sample"), "utf8"), "#!/bin/sh\n");
	});
});


const PATH_WITHOUT_NODE = "/usr/bin:/bin";

test("Hook runs under a PATH without node (friction 6cb53179 regression)", async (t) => {
	if (process.platform === "win32") {
		t.skip("PATH=/usr/bin:/bin 与 shell 退出码 127 是 POSIX 语义；Windows Hook 载体差异按红线4 登记为未覆盖");
	}
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const rendered = renderHook({ runnerPath, workspaceRoot: base, interpreterCandidates: ["node", "nodejs"] });
		const hook = join(base, "commit-msg");
		await writeFile(hook, rendered, { mode: 0o755 });

		const invalid = join(base, "invalid-message");
		await writeFile(invalid, "bad\n", "utf8");
		const result = await runHookWithEnv(hook, invalid, root, { PATH: PATH_WITHOUT_NODE });

		assert.equal(result.code, 127, `expected 127, got ${result.code}: ${result.stderr}`);
		assert.ok(
			result.stderr.includes(INTERPRETER_UNAVAILABLE_MARKER),
			`stderr must carry the marker so it is distinguishable from a validation failure; got: ${result.stderr}`,
		);
		assert.doesNotMatch(result.stderr, /exec: node: not found/);
	});
});

test("Hook still validates when node is baked as an absolute path and PATH lacks node", async (t) => {
	if (process.platform === "win32") {
		t.skip("构造无 node 的 POSIX PATH 在 Windows 上不可复现；按红线4 登记为未覆盖");
	}
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		await mkdir(join(root, "specs"), { recursive: true });
		await writeFile(join(root, "specs", "99-fixture.md"), "# fixture\n");
		await gitOk(root, ["add", "specs/99-fixture.md"]);
		const rendered = renderHook({ runnerPath, workspaceRoot: base, interpreterCandidates: [process.execPath, "node"] });
		const hook = join(base, "commit-msg");
		await writeFile(hook, rendered, { mode: 0o755 });

		const invalid = join(base, "invalid-message");
		await writeFile(invalid, "bad\n", "utf8");
		const blocked = await runHookWithEnv(hook, invalid, root, { PATH: PATH_WITHOUT_NODE });
		assert.notEqual(blocked.code, 0, "invalid message must still be blocked");
		assert.doesNotMatch(blocked.stderr, /exec: node: not found/);
		assert.doesNotMatch(blocked.stderr, new RegExp(INTERPRETER_UNAVAILABLE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.match(blocked.stderr, /LDVH Git Gate \(commit-msg\) failed/);

		const valid = join(base, "valid-message");
		await writeFile(valid, VALID_COMMIT_MESSAGE, "utf8");
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
	});
});

test("preflight refuses a Hook that cannot start the validator (no silent pass)", async (t) => {
	if (process.platform === "win32") {
		t.skip("依赖 sh 的 127 退出码语义；Windows 上按红线4 登记为未覆盖（gate 其它用例仍验证 fail-closed）");
	}
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const broken = renderHook({ runnerPath, workspaceRoot: base, interpreterCandidates: ["ldvh-definitely-not-an-interpreter"] });
		const hook = join(base, "commit-msg");
		await writeFile(hook, broken, { mode: 0o755 });
		const invalid = join(base, "invalid-message");
		await writeFile(invalid, "bad\n", "utf8");
		const result = await runHookWithEnv(hook, invalid, root, { PATH: PATH_WITHOUT_NODE });
		assert.equal(result.code, 127);
		assert.ok(result.stderr.includes(INTERPRETER_UNAVAILABLE_MARKER));
	});
});

test("installed Hook reports outdated once HOOK_BUNDLE_VERSION moves (propagation)", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const stale = renderHook({ runnerPath, workspaceRoot: base, bundleVersion: "0.0.0-older" });
		await writeFile(join(root, ".git", "hooks", "commit-msg"), stale, { mode: 0o755 });
		await writeFile(join(root, ".git", "hooks", "pre-commit"), renderHook({ runnerPath, workspaceRoot: base, bundleVersion: "0.0.0-older", hookName: "pre-commit" }), { mode: 0o755 });

		const staleInspect = await inspectHook(root);
		assert.equal(staleInspect.state, "outdated");
		assert.equal(staleInspect.hookBundleVersion, "0.0.0-older");
		assert.equal(staleInspect.expectedHookBundleVersion, HOOK_BUNDLE_VERSION);

		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
		assert.equal(install.value.hookBundleVersion, HOOK_BUNDLE_VERSION);
		const refreshed = await readFile(join(root, ".git", "hooks", "commit-msg"), "utf8");
		assert.doesNotMatch(refreshed, /exec node /);
	});
});
test("a content-matching Hook without the executable bit is outdated, not managed", async () => {
	if (process.platform === "win32") return;
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		assert.equal((await installHook({ projectRoot: root, runnerPath, workspaceRoot: base })).value.state, "managed");
		const hookPath = join(root, ".git", "hooks", "commit-msg");
		await chmod(hookPath, 0o644);
		const after = await inspectHook(root);
		assert.equal(after.state, "outdated");
		assert.match(after.detail, /not executable/);
		assert.equal((await installHook({ projectRoot: root, runnerPath, workspaceRoot: base })).value.state, "managed");
	});
});

test("parseHookPaths extracts runner/workspace from current and legacy hook bodies", () => {
	const current = renderHook({ runnerPath, workspaceRoot: pluginRoot }).split("\n").slice(2).join("\n");
	assert.deepEqual(parseHookPaths(current), { runnerPath, workspaceRoot: pluginRoot });

	const legacyRunner = "/old/profile/node_modules/dsh-ldvh/lib/git-gate-runner.js";
	const legacyWorkspace = "/old/profile/node_modules/dsh-ldvh";
	const legacy = ["# ldvh-hook-bundle-version: 1.0.0-dev.3", "set -eu", `set -- git-commit-msg --workspace-root '${legacyWorkspace}' --worktree "$worktree"`, `exec node '${legacyRunner}' "$@"`, ""].join("\n");
	assert.deepEqual(parseHookPaths(legacy), { runnerPath: legacyRunner, workspaceRoot: legacyWorkspace });
});

test("a digest-matching hook with a dead runner path is outdated, not managed (issue #10 fake-managed)", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const deadRunner = join(base, "gone", "git-gate-runner.js");
		const hook = renderHook({ runnerPath: deadRunner, workspaceRoot: base });
		await writeFile(join(root, ".git", "hooks", "commit-msg"), hook, { mode: 0o755 });
		await writeFile(join(root, ".git", "hooks", "pre-commit"), renderHook({ runnerPath: deadRunner, workspaceRoot: base, hookName: "pre-commit" }), { mode: 0o755 });

		const status = await inspectHook(root);
		assert.equal(status.state, "outdated", "dead runner must break the managed state");
		assert.equal(status.hookBundleVersion, HOOK_BUNDLE_VERSION, "bundle version still matches");
		for (const hookStatus of status.hooks) {
			assert.equal(hookStatus.state, "outdated");
			assert.match(hookStatus.detail, /runner no longer exists/);
			assert.ok(hookStatus.detail.includes(deadRunner));
		}
		assert.deepEqual(parseManagedHook(hook).version, HOOK_BUNDLE_VERSION, "marker digest is still valid");
	});
});

test("a digest-matching hook with a dead workspace root is outdated", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const deadWorkspace = join(base, "gone-workspace");
		const hook = renderHook({ runnerPath, workspaceRoot: deadWorkspace });
		await writeFile(join(root, ".git", "hooks", "commit-msg"), hook, { mode: 0o755 });
		const status = await inspectHook(root, { hookName: "commit-msg" });
		assert.equal(status.state, "outdated");
		assert.match(status.detail, /workspace root no longer exists/);
	});
});

test("installHook rewrites a fake-managed hook so both hooks become real managed (issue #10 repair)", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const deadRunner = join(base, "gone", "git-gate-runner.js");
		await writeFile(join(root, ".git", "hooks", "commit-msg"), renderHook({ runnerPath: deadRunner, workspaceRoot: base }), { mode: 0o755 });
		await writeFile(join(root, ".git", "hooks", "pre-commit"), renderHook({ runnerPath: deadRunner, workspaceRoot: base, hookName: "pre-commit" }), { mode: 0o755 });
		assert.equal((await inspectHook(root)).state, "outdated");

		const result = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(result.ok, true, result.error?.message);
		assert.equal(result.value.state, "managed");
		assert.equal(result.value.rewritten, 2, "both fake-managed hooks must be rewritten");
		for (const name of ["commit-msg", "pre-commit"]) {
			const content = await readFile(join(root, ".git", "hooks", name), "utf8");
			assert.ok(content.includes(runnerPath), `${name} must point at the live runner`);
			assert.doesNotMatch(content, /gone\/git-gate-runner\.js/);
		}
	});
});
