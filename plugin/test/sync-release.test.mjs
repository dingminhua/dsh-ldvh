import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO_ROOT, "plugin", "scripts", "sync-release.mjs");

const EXIT = { OK: 0, DRIFT: 1, BAD_ARGS: 2, KEEP_CONFLICT: 3, DIRTY_TARGET: 4 };

function git(repo, args) {
	return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function initRepo(repo, files) {
	mkdirSync(repo, { recursive: true });
	git(repo, ["init", "-q", "."]);
	for (const [path, content] of Object.entries(files)) {
		const dest = join(repo, path);
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, content);
	}
	git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
	git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
}

function run(args, cwd) {
	const localScript = join(cwd, "plugin", "scripts", "sync-release.mjs");
	try {
		const stdout = execFileSync(process.execPath, [localScript, ...args], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { code: EXIT.OK, stdout };
	} catch (err) {
		return { code: err.status, stdout: `${err.stdout ?? ""}${err.stderr ?? ""}` };
	}
}

const VERSION_FILE = '{"name":"fixture","version":"1.0.0"}';

function makePair() {
	const root = mkdtempSync(join(tmpdir(), "sync-release-"));
	const dev = join(root, "dev");
	const tgt = join(root, "target");
	mkdirSync(join(dev, "plugin", "scripts"), { recursive: true });
	git(dev, ["init", "-q", "."]);
	copyFileSync(SCRIPT, join(dev, "plugin", "scripts", "sync-release.mjs"));
	writeFileSync(join(dev, "plugin", "package.json"), VERSION_FILE);
	writeFileSync(join(dev, "plugin", "code.js"), "export const v = 1;\n");
	git(dev, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
	git(dev, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
	initRepo(tgt, {
		"plugin/package.json": VERSION_FILE,
		"plugin/code.js": "export const v = 0;\n",
	});
	return { root, dev, tgt };
}

test("sync-release: check 报告漂移时以 DRIFT 退出", () => {
	const { dev, tgt } = makePair();
	const result = run(["--check", "--target", tgt], dev);
	assert.equal(result.code, EXIT.DRIFT);
	assert.match(result.stdout, /differs（内容不同、非版本豁免，apply 将覆盖）: 1/);
});

test("sync-release: apply 成功以 OK 退出（不再与中止共用退出码）", () => {
	const { dev, tgt } = makePair();
	const result = run(["--apply", "--target", tgt], dev);
	assert.equal(result.code, EXIT.OK);
	assert.match(result.stdout, /applied/);
	assert.equal(git(tgt, ["status", "--porcelain"]).trim().length > 0, true);
});

test("sync-release: apply 成功后提交，check 归零", () => {
	const { dev, tgt } = makePair();
	run(["--apply", "--target", tgt], dev);
	git(tgt, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
	git(tgt, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "sync"]);
	const result = run(["--check", "--target", tgt], dev);
	assert.equal(result.code, EXIT.OK);
	assert.match(result.stdout, /differs（内容不同、非版本豁免，apply 将覆盖）: 0/);
});

test("sync-release: target 有未提交改动时 apply 以 DIRTY_TARGET 退出且不写入", () => {
	const { dev, tgt } = makePair();
	writeFileSync(join(tgt, "plugin", "code.js"), "export const v = 999;\n");
	const before = git(tgt, ["show", "HEAD:plugin/code.js"]);
	const result = run(["--apply", "--target", tgt], dev);
	assert.equal(result.code, EXIT.DIRTY_TARGET);
	assert.match(result.stdout, /target 有未提交改动/);
	assert.equal(git(tgt, ["show", "HEAD:plugin/code.js"]), before);
});

test("sync-release: 未知参数以 BAD_ARGS 退出，且与 DRIFT/DIRTY_TARGET 可区分", () => {
	const { dev, tgt } = makePair();
	const result = run(["--bogus"], dev);
	assert.equal(result.code, EXIT.BAD_ARGS);
	assert.notEqual(EXIT.BAD_ARGS, EXIT.DRIFT);
	assert.notEqual(EXIT.BAD_ARGS, EXIT.DIRTY_TARGET);
	assert.equal(new Set([EXIT.OK, EXIT.DRIFT, EXIT.BAD_ARGS, EXIT.KEEP_CONFLICT, EXIT.DIRTY_TARGET]).size, 5);
});
