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
	parseManagedHook,
	renderHook,
	resolveIdentity,
	resolveShCommand,
	uninstallHook,
} from "../lib/hook-manager.js";
import { git, gitOk, initRepo, pluginRoot, runnerPath, VALID_COMMIT_MESSAGE, withTemp } from "./helpers.mjs";

const execFileAsync = promisify(execFile);

/**
 * Run a rendered Hook exactly as Git would (same entry point, one argument),
 * under an explicit environment.
 *
 * Why not the module's own `invokeHook`: it is private to hook-manager and this
 * file must exercise the Hook as a real shell process. Inheriting the ambient
 * environment here would hide the very defect these tests exist for, so callers
 * pass the PATH they want to prove.
 *
 * On win32 the shell must come from `resolveShCommand()` — the SAME resolver
 * production uses — rather than a bare "sh". Git for Windows ships sh.exe under
 * its install root but does NOT put it on PATH, so a bare "sh" fails with
 * ENOENT and the child never starts; the observed code was then 1 (Node's own
 * spawn failure), not the 127 the Hook is asserting. Using the production
 * resolver keeps the test measuring the Hook's contract instead of the
 * runner's PATH.
 */
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
		// The Hook must resolve an interpreter itself instead of calling bare
		// `exec node`: a PATH without node used to reduce every commit to
		// `exec: node: not found`, indistinguishable from a validation failure
		// (friction 6cb53179).
		assert.doesNotMatch(content, /exec node /);
		assert.match(content, /for candidate in/);
		assert.match(content, /node_bin=\$candidate/);
		// Electron hosts (DSH Desktop) make the baked absolute path the Electron
		// binary; without this flag it starts as an app and exits 0, i.e. passes
		// the gate without validating (fail-open).
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

		// Illegal message: header is not a conventional commit header. The
		// install writes BOTH Hooks, so the run reaches commit-msg only if
		// pre-commit let the staged README through — the assertions below pick
		// both up, which is what makes this a test of the pair rather than of
		// one file in isolation. The temp repo has no node_modules of its own,
		// so the rendered pre-commit Hook is pointed at this plugin's tree,
		// exactly as a real install points it at the governed workspace.
		const blocked = await gitOk(root, ["commit", "-m", "bad header no colon"], { env: { ...process.env, LDVH_WORKSPACE_ROOT: pluginRoot } });
		assert.equal(blocked.ok, false, "commit with illegal message must be blocked");
		assert.match(blocked.stderr, /LDVH Git Gate \(commit-msg\) failed/);
		assert.match(blocked.stderr, /validation\/header_invalid/);
		// nothing was committed and the staged change survived
		const porcelain = await git(root, ["status", "--porcelain"]);
		assert.match(porcelain, /^A {2}README\.md/m);

		// Legal message: full conventional header + 关键变更 + signatures.
		const passed = await gitOk(root, ["commit", "-m", VALID_COMMIT_MESSAGE], { env: { ...process.env, LDVH_WORKSPACE_ROOT: pluginRoot } });
		assert.equal(passed.ok, true, `legal commit must pass: ${passed.stderr}`);
		const log = await git(root, ["log", "--oneline"]);
		assert.match(log, /接入 ldvh 提交校验/);
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
		await git(root, ["commit", "-m", "chore(code): 批量添加文件"]);

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

// ---------------------------------------------------------------------------
// Interpreter resolution (friction 6cb53179)
//
// Every other test in this file inherits the ambient PATH from the test runner,
// which is exactly how the original defect stayed hidden: no test ever ran the
// Hook in a shell where node is unreachable. These tests construct that
// environment explicitly instead of relying on the developer's machine.
// ---------------------------------------------------------------------------

/** PATH with no node: keeps git and sh reachable, drops every node install. */
const PATH_WITHOUT_NODE = "/usr/bin:/bin";

test("Hook runs under a PATH without node (friction 6cb53179 regression)", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		// Bake only PATH-resolved names, so the baked absolute path cannot mask
		// the very condition under test.
		const rendered = renderHook({ runnerPath, workspaceRoot: base, interpreterCandidates: ["node", "nodejs"] });
		const hook = join(base, "commit-msg");
		await writeFile(hook, rendered, { mode: 0o755 });

		const invalid = join(base, "invalid-message");
		await writeFile(invalid, "bad\n", "utf8");
		const result = await runHookWithEnv(hook, invalid, root, { PATH: PATH_WITHOUT_NODE });

		// No interpreter is reachable at all, so the Hook must fail CLOSED and
		// say why — rather than dying on a bare `exec node`.
		assert.equal(result.code, 127, `expected 127, got ${result.code}: ${result.stderr}`);
		assert.ok(
			result.stderr.includes(INTERPRETER_UNAVAILABLE_MARKER),
			`stderr must carry the marker so it is distinguishable from a validation failure; got: ${result.stderr}`,
		);
		// The old failure mode must be gone.
		assert.doesNotMatch(result.stderr, /exec: node: not found/);
	});
});

test("Hook still validates when node is baked as an absolute path and PATH lacks node", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		// With the real node baked in as an absolute candidate, a PATH without
		// node must NOT matter: the gate must actually validate.
		const rendered = renderHook({ runnerPath, workspaceRoot: base, interpreterCandidates: [process.execPath, "node"] });
		const hook = join(base, "commit-msg");
		await writeFile(hook, rendered, { mode: 0o755 });

		const invalid = join(base, "invalid-message");
		await writeFile(invalid, "bad\n", "utf8");
		const blocked = await runHookWithEnv(hook, invalid, root, { PATH: PATH_WITHOUT_NODE });
		assert.notEqual(blocked.code, 0, "invalid message must still be blocked");
		assert.doesNotMatch(blocked.stderr, /exec: node: not found/);
		assert.doesNotMatch(blocked.stderr, new RegExp(INTERPRETER_UNAVAILABLE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		// Proof the validator really ran: it reports its own findings.
		assert.match(blocked.stderr, /LDVH Git Gate \(commit-msg\) failed/);

		const valid = join(base, "valid-message");
		await writeFile(valid, VALID_COMMIT_MESSAGE, "utf8");
		// installHook's preflight proves the same path with a synthetic index.
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
	});
});

test("preflight refuses a Hook that cannot start the validator (no silent pass)", async () => {
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		// A Hook whose candidates cannot resolve anywhere: the shell exits 127,
		// which is nonzero and therefore used to satisfy `blocked.code === 0`'s
		// negation while nothing was validated.
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
		// Simulate an install made by an older bundle: same template, older
		// version marker. This is the only channel through which a Hook-body fix
		// reaches an existing installation, so it must flip managed -> outdated.
		// BOTH owned Hooks go stale: the rollup reports the worst state across
		// the pair, so a stale commit-msg beside an absent pre-commit would
		// report `absent` — correct, but it would test the rollup rather than
		// the version propagation this test is named for.
		const stale = renderHook({ runnerPath, workspaceRoot: base, bundleVersion: "0.0.0-older" });
		await writeFile(join(root, ".git", "hooks", "commit-msg"), stale, { mode: 0o755 });
		await writeFile(join(root, ".git", "hooks", "pre-commit"), renderHook({ runnerPath, workspaceRoot: base, bundleVersion: "0.0.0-older", hookName: "pre-commit" }), { mode: 0o755 });

		const staleInspect = await inspectHook(root);
		assert.equal(staleInspect.state, "outdated");
		assert.equal(staleInspect.hookBundleVersion, "0.0.0-older");
		assert.equal(staleInspect.expectedHookBundleVersion, HOOK_BUNDLE_VERSION);

		// Reinstall refreshes it to the current bundle.
		const install = await installHook({ projectRoot: root, runnerPath, workspaceRoot: base });
		assert.equal(install.ok, true, install.error?.message);
		assert.equal(install.value.state, "managed");
		assert.equal(install.value.hookBundleVersion, HOOK_BUNDLE_VERSION);
		const refreshed = await readFile(join(root, ".git", "hooks", "commit-msg"), "utf8");
		assert.doesNotMatch(refreshed, /exec node /);
	});
});
test("a content-matching Hook without the executable bit is outdated, not managed", async () => {
	// **本形态只在类 Unix 存在，win32 上早退**（2026-10-30 第三轮复审 N-A）：
	// NTFS 不设执行位——`chmod` 在 Windows 上只切换只读属性、`lstat().mode`
	// 也不含 0o111 位，`X_OK` 在那里退化为「存在即真」。故 `chmod(0o644)` 后
	// 判 `outdated` 与「重装后 mode & 0o111 !== 0」两条断言在 win32 上必红，
	// 而 plugin/README.md 明写声明的支持平台含 Windows，并登记了「依赖 POSIX
	// 权限语义的断言在 win32 上早退」这一既有约定。不早退就是给支持平台塞一条
	// 必红用例。
	if (process.platform === "win32") return;
	// **「字节匹配」不等于「门禁存在」**（2026-10-30 复审 I3/N5）：git 对没有
	// 执行位的 Hook **直接忽略**。修复前 inspectOneHook 只比对 marker 摘要与
	// 版本，一个 0644 的 Hook 被判成 managed——于是 hook-repair 见 managed 就
	// continue、永不修复，而项目实际毫无门禁，且所有用例照样绿。
	await withTemp("ldvh-hm.", async (base) => {
		const root = await initRepo(base);
		assert.equal((await installHook({ projectRoot: root, runnerPath, workspaceRoot: base })).value.state, "managed");
		const hookPath = join(root, ".git", "hooks", "commit-msg");
		await chmod(hookPath, 0o644);
		// 判据：内容未变、只是不可执行 → 必须是可修复态（outdated），不是 managed。
		const after = await inspectHook(root);
		assert.equal(after.state, "outdated");
		assert.match(after.detail, /not executable/);
		// 修复（重装）须把它恢复成 managed——证明该状态确实可修复。
		//
		// **这里不再单独断言「重装后带执行位」**（2026-10-30 第四轮复审 N-I）：本轮
		// 给 `inspectOneHook` 加了执行位检查后，`managed` **本身就已蕴含可执行**
		// （不可执行会被判 outdated）。实测把重装改成 `chmod(temp, 0o644)`，
		// `installHook` 会在自己的校验里失败（`.value` 为 undefined）、红落在上一行，
		// 那条物理位断言永远等不到自己的红——它被状态断言蕴含，属零检测力断言，
		// 按本节 §5「零检测力断言不得保留」删除。若要单独守护「重装置位」这一实现
		// 细节，须另造一条不经 `installHook` 校验路径的用例，不在本用例内混写。
		assert.equal((await installHook({ projectRoot: root, runnerPath, workspaceRoot: base })).value.state, "managed");
	});
});
