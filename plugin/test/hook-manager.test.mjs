// Tests for plugin/lib/hook-manager.js:
// - Git root strict checks (resolveIdentity)
// - managed Hook marker digest integrity (parseManagedHook / inspectHook)
// - absent -> install -> managed lifecycle
// - real commit-msg gate: illegal message blocked, legal message allowed
// - uninstall removes only a managed Hook
// - third-party Hook zero-write (install and uninstall refuse to touch it)
//
// All tests run against throwaway Git repositories created per test and
// removed in withTemp(). No test modifies plugin/lib or any real repository.
import assert from "node:assert/strict";
import test from "node:test";
import { lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	HOOK_BUNDLE_VERSION,
	cleanGitEnvironment,
	inspectHook,
	installHook,
	parseManagedHook,
	renderHook,
	resolveIdentity,
	uninstallHook,
} from "../lib/hook-manager.js";
import { git, gitOk, initRepo, runnerPath, VALID_COMMIT_MESSAGE, withTemp } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// Git root strict check
// ---------------------------------------------------------------------------

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
		// the real root still resolves fine
		const identity = await resolveIdentity(root);
		assert.equal(identity.projectRoot, await realpath(root));
	});
});

test("resolveIdentity rejects a bare repository", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		await git(base, ["init", "-q", "--bare", join(base, "bare.git")]);
		// `git rev-parse --show-toplevel` fails in a bare repo, so the strict
		// check rejects it as not a governing worktree.
		await assert.rejects(resolveIdentity(join(base, "bare.git")), /work tree/);
	});
});

test("resolveIdentity rejects a repo whose hooks path is not a regular directory", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		// Replace the real hooks dir with a symlink (drop the dir first: on
		// macOS ln -s into an existing directory creates a link INSIDE it).
		await rm(join(root, ".git", "hooks"), { recursive: true, force: true });
		await mkdir(join(base, "hooks-target"));
		await symlink(join(base, "hooks-target"), join(root, ".git", "hooks"));
		await assert.rejects(resolveIdentity(root), /Git hooks path must be a regular directory/);
	});
});

test("resolveIdentity reports identity for a governed repository", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const identity = await resolveIdentity(root);
		// macOS /var vs /private/var: compare against realpath-derived expectations
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

// ---------------------------------------------------------------------------
// Managed Hook marker digest
// ---------------------------------------------------------------------------

test("parseManagedHook round-trips a rendered Hook and detects body tampering", () => {
	const rendered = renderHook({ runnerPath, workspaceRoot: "/tmp/example" });
	const parsed = parseManagedHook(rendered);
	assert.equal(parsed.owned, true);
	assert.equal(parsed.valid, true);
	assert.equal(parsed.version, HOOK_BUNDLE_VERSION);
	assert.ok(parsed.body.includes("ldvh-hook-bundle-version"));

	// Tampering with the body without regenerating the marker digest breaks
	// the digest check even though the marker line itself is unchanged.
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

		// uninstall must refuse to remove a Hook whose digest is broken.
		const removed = await uninstallHook(root);
		assert.equal(removed.ok, false);
		assert.equal(removed.error.code, "hook_conflict");
		assert.equal(await readFile(hookPath, "utf8"), tampered, "tampered Hook must be preserved");
	});
});

test("cleanGitEnvironment strips ambient Git override variables", () => {
	// 新契约：先从继承的 process.env 剥离环境 GIT_* 覆盖变量，再合并调用方
	// 显式传入的 extra——显式传入的 GIT_* 现在会存活（如 preflight 的 GIT_INDEX_FILE）。
	const keys = ["GIT_DIR", "GIT_WORK_TREE", "MY_VAR"];
	const snapshot = new Map(keys.map((key) => [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined]));
	try {
		process.env.GIT_DIR = "/ambient-git-dir";
		process.env.GIT_WORK_TREE = "/ambient-work-tree";
		process.env.MY_VAR = "keep-me";
		// (a) ambient overrides are stripped, unrelated vars survive, prompts off
		const plain = cleanGitEnvironment({});
		assert.equal(plain.GIT_DIR, undefined, "ambient GIT_DIR must be stripped");
		assert.equal(plain.GIT_WORK_TREE, undefined, "ambient GIT_WORK_TREE must be stripped");
		assert.equal(plain.MY_VAR, "keep-me", "unrelated ambient vars must survive");
		assert.equal(plain.GIT_TERMINAL_PROMPT, "0");
		// (b) explicit extras win over ambient stripping
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

// ---------------------------------------------------------------------------
// absent -> installed -> managed lifecycle
// ---------------------------------------------------------------------------

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
		// hook is executable and carries the rendered marker
		const content = await readFile(join(root, ".git", "hooks", "commit-msg"), "utf8");
		assert.match(content, /^#!\/bin\/sh\n# ldvh-native-commit-msg-hook: v1 sha256:/);
		assert.match(content, /exec node/);

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
		// Nothing staged: preflight builds a synthetic Index (hash-object -w +
		// update-index --cacheinfo through GIT_INDEX_FILE) instead of requiring
		// a real staged change, so a clean tree installs fine.
		const root = await initRepo(base, { stage: false });
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
		// the real Index is still empty: preflight must not touch staging state
		assert.equal(await git(root, ["diff", "--cached"]), "", "the real Index must stay empty");
	});
});

test("real commit-msg: illegal commit is blocked, legal commit passes", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);

		// Illegal message: header is not a conventional commit header.
		const blocked = await gitOk(root, ["commit", "-m", "bad header no colon"]);
		assert.equal(blocked.ok, false, "commit with illegal message must be blocked");
		assert.match(blocked.stderr, /LDVH Git Gate \(commit-msg\) failed/);
		assert.match(blocked.stderr, /validation\/header_invalid/);
		// nothing was committed and the staged change survived
		const porcelain = await git(root, ["status", "--porcelain"]);
		assert.match(porcelain, /^A {2}README\.md/m);

		// Legal message: full conventional header + 关键变更 + signatures.
		const passed = await gitOk(root, ["commit", "-m", VALID_COMMIT_MESSAGE]);
		assert.equal(passed.ok, true, `legal commit must pass: ${passed.stderr}`);
		const log = await git(root, ["log", "--oneline"]);
		assert.match(log, /add ldvh gate/);
	});
});

test("preflight synthetic index stays tiny on a repository with commit history", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		// initRepo staged README but did not commit: the first commit seeds
		// real history with a non-empty HEAD tree.
		await git(root, ["commit", "-m", "initial"]);
		// Add several large files so HEAD's tree is megabytes in size. The
		// runner's internal `git diff --cached` buffer is 4MB; pre-fix, the
		// single-entry synthetic index diffs as "delete every tracked file"
		// against HEAD, so a multi-MB tree blows that buffer. The fixed
		// `read-tree HEAD` seed keeps the synthetic diff at ~150 bytes.
		const chunk = "y".repeat(1024);
		for (let i = 0; i < 6; i++) {
			const name = `bulk-${i}.txt`;
			await writeFile(join(root, name), chunk.repeat(1200)); // ~1.2MB each
			await git(root, ["add", name]);
		}
		await git(root, ["commit", "-m", "chore(code): add bulk files"]);

		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
	});
});

test("preflight still succeeds on a repository without any commit", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		// initRepo stages README but never commits, so HEAD does not exist and
		// `read-tree HEAD` fails — the preflight must fall back to starting the
		// synthetic index from the empty tree and still install cleanly.
		const root = await initRepo(base);
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
	});
});

// ---------------------------------------------------------------------------
// Third-party Hook is never written
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// uninstall removes only a managed Hook
// ---------------------------------------------------------------------------

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
		// unrelated hook files untouched
		assert.equal(await readFile(join(root, ".git", "hooks", "post-commit.sample"), "utf8"), "#!/bin/sh\n");
	});
});