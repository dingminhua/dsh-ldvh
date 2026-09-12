// Shared helpers for the LDVH plugin lib test-suite.
//
// Every test that touches a Git repository uses a throwaway directory under
// the OS temp dir and removes it again when the test finishes, so no test
// ever writes outside its own temporary area.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { authoritativeSignature } from "../lib/signature-channel.js";

export const execFileAsync = promisify(execFile);

/** Absolute path of the plugin root (parent of this test/ directory). */
export const pluginRoot = fileURLToPath(new URL("..", import.meta.url));

/** Absolute path of the git gate runner the hooks exec. */
export const runnerPath = join(pluginRoot, "lib", "git-gate-runner.js");

/** A commit message that satisfies every gate rule of git-gate-runner. */
export const VALID_COMMIT_MESSAGE = [
	"chore(code): add ldvh gate",
	"",
	"关键变更:",
	"- seed README.md test carrier",
	"",
	"LDVH-Provider: deepseek-harness",
	"LDVH-Model: test",
].join("\n");

/** Run a git command against a worktree and return trimmed stdout. */
export async function git(root, args, options = {}) {
	const result = await execFileAsync("git", ["-C", root, ...args], {
		encoding: "utf8",
		...options,
	});
	return result.stdout.trim();
}

/** Run a git command, resolving instead of throwing on a non-zero exit. */
export async function gitOk(root, args, options = {}) {
	try {
		return { ok: true, out: await git(root, args, options) };
	} catch (error) {
		return {
			ok: false,
			code: typeof error?.code === "number" ? error.code : 1,
			stderr: String(error?.stderr ?? error?.message ?? error),
		};
	}
}

/**
 * Run a node script as a child process, resolving instead of throwing.
 * Returns { ok, code, stdout, stderr }; code is the exit code when the child
 * exited normally (0 on success).
 */
export async function runNode(args, options = {}) {
	try {
		const result = await execFileAsync(process.execPath, args, {
			encoding: "utf8",
			...options,
		});
		return { ok: true, code: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		return {
			ok: false,
			code: typeof error?.code === "number" ? error.code : 1,
			stdout: error?.stdout ?? "",
			stderr: error?.stderr ?? String(error?.message ?? error),
		};
	}
}

/**
 * Create a temp directory, run fn(dir), then unconditionally remove it.
 * Every test should wrap its Git work in this helper so nothing leaks.
 */
export async function withTemp(prefix, fn) {	const dir = await mkdtemp(join(tmpdir(), prefix));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * Create a throwaway Git repository rooted at base/<name>.
 *
 * - configures user.name / user.email so `git commit` works,
 * - by default creates README.md and stages it, so `git diff --cached` is
 *   non-empty (the gate refuses to run against an empty Index).
 *
 * Pass stage:false when a test needs an empty candidate Index.
 */
export async function initRepo(base, { name = "repo", stage = true } = {}) {
	const root = join(base, name);
	await mkdir(root, { recursive: true });
	await git(root, ["init", "-q"]);
	await git(root, ["config", "user.name", "LDVH Test"]);
	await git(root, ["config", "user.email", "ldvh-test@example.com"]);
	if (stage) {
		await writeFile(join(root, "README.md"), "ldvh test project\n");
		await git(root, ["add", "README.md"]);
	}
	return root;
}

/**
 * A branded authoritative signature for tests that exercise DOMAIN rules.
 *
 * `03 §6.1` / `09` require every `change_log` entry to carry the authoritative
 * provider/model, and the writers now REFUSE to write without one (Human
 * requirement 2026-09-12: a write that cannot be signed must be reported, not
 * silently recorded). Tests about some other rule are not about the signature,
 * so they supply this carrier and the gate stays satisfied.
 *
 * Tests that DO exercise the gate pass `sessionSignature: null` (or a forged
 * plain object) explicitly and assert the refusal.
 */
export function testSignature({ provider = "test-provider", model = "test-model" } = {}) {
	return authoritativeSignature({ provider, model });
}
