// Tests for plugin/lib/git-gate-runner.js — the LDVH Git commit-msg gate that
// hooks exec via `node git-gate-runner.js git-commit-msg ...`.
//
// The runner is a top-level script (it owns process.exitCode), so it is
// exercised by spawning it as a child process against throwaway Git
// repositories that are cleaned up in withTemp().
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git, gitOk, initRepo, runNode, runnerPath, VALID_COMMIT_MESSAGE, withTemp } from "./helpers.mjs";

function runnerArgs({ workspaceRoot, worktree, messageFile }) {
	return [
		runnerPath,
		"git-commit-msg",
		"--workspace-root", workspaceRoot,
		"--worktree", worktree,
		"--message-file", messageFile,
	];
}

test("rejects an unsupported runner command", async () => {
	const result = await runNode([runnerPath, "git-precommit"]);
	assert.equal(result.code, 1);
	assert.match(result.stderr, /unsupported runner command/);
});

test("requires absolute workspace-root, worktree, and message-file", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const result = await runNode([
			runnerPath, "git-commit-msg",
			"--workspace-root", "relative/workspace",
			"--worktree", join(base, "repo"),
			"--message-file", join(base, "msg.txt"),
		]);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /must be absolute paths/);

		const missing = await runNode([runnerPath, "git-commit-msg", "--workspace-root", base]);
		assert.equal(missing.code, 1);
		assert.match(missing.stderr, /must be absolute paths/);
	});
});

test("accepts a workspace-root inside or equal to the governed Git root", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base); // README staged -> Index non-empty
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, VALID_COMMIT_MESSAGE);

		// workspace-root == worktree (runtime sits inside the governed repo)
		let result = await runNode(runnerArgs({ workspaceRoot: root, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) passed/);

		// workspace-root is a subdirectory of the worktree
		await mkdir(join(root, "inner"));
		result = await runNode(runnerArgs({ workspaceRoot: join(root, "inner"), worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) passed/);
	});
});

test("blocks an illegal message and reports every failing rule", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base); // README staged -> Index non-empty
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, "not a conventional header\n");

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) failed/);
		assert.match(result.stderr, /validation\/header_invalid/);
		assert.match(result.stderr, /validation\/key_changes_required/);
		assert.match(result.stderr, /validation\/signature_trailer_missing/);
	});
});

test("blocks a message that misses or duplicates a signature trailer", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base);
		const messageFile = join(root, "msg.txt");

		const missing = [
			"chore(x): fine header",
			"",
			"关键变更:",
			"- README.md item",
			"",
			"LDVH-Provider: deepseek-harness",
		].join("\n");
		await writeFile(messageFile, missing);
		let result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /validation\/signature_trailer_missing/);
		assert.doesNotMatch(result.stderr, /header_invalid/);

		const duplicated = [
			"chore(x): fine header",
			"",
			"关键变更:",
			"- README.md item",
			"",
			"LDVH-Provider: a",
			"LDVH-Provider: b",
			"LDVH-Model: c",
		].join("\n");
		await writeFile(messageFile, duplicated);
		result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /validation\/signature_trailer_missing/);
	});
});

test("blocks a valid message when the candidate Index is empty", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base, { stage: false }); // nothing staged
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, VALID_COMMIT_MESSAGE);

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /git\/index_empty/);
		assert.doesNotMatch(result.stderr, /header_invalid|key_changes_required/);
	});
});

test("passes a legal message against a non-empty Index", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base); // README staged
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, VALID_COMMIT_MESSAGE);

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) passed/);
		assert.match(result.stderr, /source_fingerprint=/);
		assert.match(result.stderr, /snapshot_identity=/);
	});
});

test("fails cleanly when the message file cannot be read", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base);
		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile: join(root, "missing-msg.txt") }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) unavailable/);
	});
});

test("rejects legacy Product-Name/Model-Name trailers and accepts only LDVH-Provider/LDVH-Model", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base); // README staged -> Index non-empty
		const messageFile = join(root, "msg.txt");

		// Legacy trailer: header and 关键变更段 are compliant, but the
		// signature trailer still uses the retired LDVH-Product-Name /
		// LDVH-Model-Name names — exactly one of each, which the gate
		// must still reject because the names themselves are wrong.
		const legacy = [
			"chore(x): fine header",
			"",
			"关键变更:",
			"- README.md item",
			"",
			"LDVH-Product-Name: x",
			"LDVH-Model-Name: y",
		].join("\n");
		await writeFile(messageFile, legacy);
		const rejected = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(rejected.code, 1);
		assert.match(rejected.stderr, /validation\/signature_trailer_missing/);
		assert.doesNotMatch(rejected.stderr, /header_invalid|key_changes_required/);

		// The new trailer is accepted with the same header + 关键变更段,
		// proving the gate's contract is precisely the new field names.
		const current = [
			"chore(x): fine header",
			"",
			"关键变更:",
			"- README.md item",
			"",
			"LDVH-Provider: x",
			"LDVH-Model: y",
		].join("\n");
		await writeFile(messageFile, current);
		const accepted = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(accepted.code, 0, accepted.stderr);
		assert.match(accepted.stderr, /LDVH Git Gate \(commit-msg\) passed/);
	});
});
// ---------------------------------------------------------------------------
// Load-bearing declaration protection, driven through the real gate
// (01 §7 末段; 09 §5.3 item 6)
//
// These spawn the runner exactly as the commit-msg hook does, so the adapter
// that reads the HEAD baseline and the staged candidate is exercised too; the
// pure validator's own five classes live in commit-validation.test.mjs.
// ---------------------------------------------------------------------------

const MARKER = "【承重声明】";
const RESOLUTION = "**恢复条件**：";

const declarationFile = (resolution) =>
	[
		"## 7. 测试节",
		"",
		"| 依赖项 | 未满足时不得声称 | 替代保障 |",
		"|---|---|---|",
		`| ${MARKER} 本文正文对 §7.2 的对齐 | 不得声称已完成对齐 | ${resolution} |`,
		"",
	].join("\n");

const declarationMessage = (item) =>
	["docs(specs): 调整规范", "", "关键变更:", `- ${item}`, "", "LDVH-Provider: test-provider", "LDVH-Model: test-model", ""].join("\n");

async function committedDeclarationRepo(base) {
	const root = await initRepo(base);
	await mkdir(join(root, "specs"), { recursive: true });
	await writeFile(join(root, "specs", "01-test.md"), declarationFile(`${RESOLUTION}完成后删除本行`));
	await gitOk(root, ["add", "-A"]);
	await gitOk(root, ["commit", "-qm", "base"]);
	return root;
}

test("blocks an edit that strips a declaration's 恢复条件 element (the incident's shape)", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await committedDeclarationRepo(base);
		await writeFile(join(root, "specs", "01-test.md"), declarationFile("**无**——须按判据逐处核对"));
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, declarationMessage("specs/01-test.md: 调整对齐列的表述"));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/load_bearing_resolution_missing/);
	});
});

test("blocks removing a declaration outright", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await committedDeclarationRepo(base);
		await writeFile(join(root, "specs", "01-test.md"), declarationFile("已完成").replace(MARKER, ""));
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, declarationMessage("specs/01-test.md: 移除对齐行"));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/load_bearing_declaration_removed/);
	});
});

test("passes the same edit when a 关键变更 item carries a resolvable reference", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await committedDeclarationRepo(base);
		const head = await git(root, ["rev-parse", "HEAD"]);
		await writeFile(join(root, "specs", "01-test.md"), declarationFile("**无**——须按判据逐处核对"));
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(
			messageFile,
			declarationMessage(`specs/01-test.md: 调整对齐列表述（独立复核 ${head} 已确认范围关闭）`)
		);

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) passed/);
	});
});

test("an unresolvable reference exempts nothing", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await committedDeclarationRepo(base);
		await writeFile(join(root, "specs", "01-test.md"), declarationFile("**无**——须按判据逐处核对"));
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, declarationMessage("specs/01-test.md: 调整表述（独立复核 deadbeefdeadbeef）"));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/load_bearing_resolution_missing/);
	});
});

test("a fact reference resolves by the carrier's object_uid, not only by its file name", async () => {
	// Review finding F2: resolution matched the uid against file PATHS, so an
	// object whose carrier is not named after its uid could not back a
	// reference. The carrier's own object_uid line is the declaration that
	// counts (09 §5.3 item 6: "可解析的同项目事实对象").
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await committedDeclarationRepo(base);
		const uid = "11112222-3333-4444-5555-666677778888";
		await mkdir(join(root, "ldvh-base", "adrs"), { recursive: true });
		await writeFile(join(root, "ldvh-base", "adrs", "unnamed-carrier.md"), `---\nobject_uid: ${uid}\ntitle: x\n---\n\n# x\n`);
		await gitOk(root, ["add", "-A"]);
		await gitOk(root, ["commit", "-qm", "add fact carrier"]);
		await writeFile(join(root, "specs", "01-test.md"), declarationFile("**无**——须按判据逐处核对"));
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, declarationMessage(`specs/01-test.md: 调整表述（独立复核 ${uid} 已确认范围关闭）`));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
	});
});
