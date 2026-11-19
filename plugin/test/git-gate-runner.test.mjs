import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gateEnv, git, gitOk, initRepo, pluginRoot, runNode, runnerPath, signatureEnv, VALID_COMMIT_MESSAGE, withTemp } from "./helpers.mjs";

const GOVERNED_FIXTURE = "specs/99-fixture.md";
async function initGovernedRepo(base) {
	const root = await initRepo(base, { stage: false });
	await mkdir(join(root, "specs"), { recursive: true });
	await writeFile(join(root, GOVERNED_FIXTURE), "# fixture\n");
	await gitOk(root, ["add", GOVERNED_FIXTURE]);
	return root;
}

function runGate(args) {
	return runNode(args, { env: gateEnv(signatureEnv()) });
}

function runnerArgs({ workspaceRoot, worktree, messageFile }) {
	return [
		runnerPath,
		"git-commit-msg",
		"--workspace-root", workspaceRoot,
		"--worktree", worktree,
		"--message-file", messageFile,
	];
}

function preCommitArgs({ workspaceRoot, worktree }) {
	return [
		runnerPath,
		"git-pre-commit",
		"--workspace-root", workspaceRoot,
		"--worktree", worktree,
	];
}

async function lintWorkspace(base) {
	const root = join(base, "lint-workspace");
	await mkdir(join(root, "lib"), { recursive: true });
	await mkdir(join(root, "node_modules"), { recursive: true });
	await writeFile(join(root, "eslint.config.js"), "export default [];\n");
	await writeFile(join(root, "lib", "placeholder.js"), "export const lintSurfacePlaceholder = true;\n");
	try {
		await symlink(join(pluginRoot, "node_modules", "eslint"), join(root, "node_modules", "eslint"), process.platform === "win32" ? "junction" : "dir");
	} catch {
		return pluginRoot;
	}
	return root;
}

function preCommitEnv(lintRoot) {
	return { ...process.env, LDVH_WORKSPACE_ROOT: lintRoot };
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
		const root = await initRepo(base);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, VALID_COMMIT_MESSAGE);

		let result = await runGate(runnerArgs({ workspaceRoot: root, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) passed/);

		await mkdir(join(root, "inner"));
		result = await runGate(runnerArgs({ workspaceRoot: join(root, "inner"), worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) passed/);
	});
});

test("blocks an illegal message and reports every failing rule", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initGovernedRepo(base);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, "not a conventional header\n");

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) failed/);
		assert.match(result.stderr, /validation\/header_invalid/);
		assert.match(result.stderr, /validation\/key_changes_required/);
		assert.match(result.stderr, /validation\/signature_trailer_missing/);
	});
});

test("blocks a message that misses or duplicates a signature trailer", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initGovernedRepo(base);
		const messageFile = join(root, "msg.txt");

		const missing = [
			"chore(x): 合规标题",
			"",
			"关键变更:",
			"- specs/99-fixture.md item",
			"",
			"LDVH-Provider: deepseek-harness",
		].join("\n");
		await writeFile(messageFile, missing);
		let result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /validation\/signature_trailer_missing/);
		assert.doesNotMatch(result.stderr, /header_invalid/);

		const duplicated = [
			"chore(x): 合规标题",
			"",
			"关键变更:",
			"- specs/99-fixture.md item",
			"",
			"LDVH-Provider: a",
			"LDVH-Provider: b",
			"LDVH-Model: c",
		].join("\n");
		await writeFile(messageFile, duplicated);
		result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /validation\/signature_trailer_missing/);
	});
});

test("blocks a valid message when the candidate Index is empty", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base, { stage: false });
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, VALID_COMMIT_MESSAGE);

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /git\/index_empty/);
		assert.doesNotMatch(result.stderr, /header_invalid|key_changes_required/);
	});
});

test("passes a legal message against a non-empty Index", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initGovernedRepo(base);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, VALID_COMMIT_MESSAGE.replace("seed README.md test carrier", `seed ${GOVERNED_FIXTURE} test carrier`));

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) passed/);
		assert.match(result.stderr, /source_fingerprint=/);
		assert.match(result.stderr, /snapshot_identity=/);
	});
});

test("fails cleanly when the message file cannot be read", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base);
		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile: join(root, "missing-msg.txt") }));
		assert.equal(result.code, 1);
		assert.match(result.stderr, /LDVH Git Gate \(commit-msg\) unavailable/);
	});
});

test("rejects legacy Product-Name/Model-Name trailers and accepts only LDVH-Provider/LDVH-Model", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initGovernedRepo(base);
		const messageFile = join(root, "msg.txt");

		const legacy = [
			"chore(x): 合规标题",
			"",
			"关键变更:",
			"- specs/99-fixture.md item",
			"",
			"LDVH-Product-Name: x",
			"LDVH-Model-Name: y",
		].join("\n");
		await writeFile(messageFile, legacy);
		const rejected = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(rejected.code, 1);
		assert.match(rejected.stderr, /validation\/signature_trailer_missing/);
		assert.doesNotMatch(rejected.stderr, /header_invalid|key_changes_required/);

		const forged = [
			"chore(x): 合规标题",
			"",
			"关键变更:",
			"- specs/99-fixture.md item",
			"",
			"LDVH-Provider: x",
			"LDVH-Model: y",
		].join("\n");
		await writeFile(messageFile, forged);
		const rejectedForged = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(rejectedForged.code, 1, rejectedForged.stderr);
		assert.match(rejectedForged.stderr, /validation\/signature_provider_mismatch/);
		assert.match(rejectedForged.stderr, /validation\/signature_model_mismatch/);

		const current = [
			"chore(x): 合规标题",
			"",
			"关键变更:",
			"- specs/99-fixture.md item",
			"",
			"LDVH-Provider: deepseek-harness",
			"LDVH-Model: test",
		].join("\n");
		await writeFile(messageFile, current);
		const accepted = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(accepted.code, 0, accepted.stderr);
		assert.match(accepted.stderr, /LDVH Git Gate \(commit-msg\) passed/);
	});
});
test("passes an ordinary commit without running the controlled-commit checks", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base, { stage: false });
		await mkdir(join(root, "plugin", "lib"), { recursive: true });
		await writeFile(join(root, "plugin", "lib", "ordinary.js"), "export const x = 1;\n");
		await gitOk(root, ["add", "plugin/lib/ordinary.js"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, "not a conventional header\n");
		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /ordinary commit/);
		assert.doesNotMatch(result.stderr, /validation\//);
	});
});

test("a staged ldvh-base carrier triggers the controlled-commit checks", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base, { stage: false });
		await mkdir(join(root, "ldvh-base"), { recursive: true });
		await writeFile(join(root, "ldvh-base", "notes.md"), "notes\n");
		await gitOk(root, ["add", "ldvh-base/notes.md"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, "not a conventional header\n");
		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/header_invalid/);
	});
});

test("a staged repository-root README.md is passed by the Gate (declared divergence, 09 §5.5)", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initRepo(base);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, "not a conventional header\n");
		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /ordinary commit/);
	});
});


test("blocks a governed commit when the authoritative route is unavailable", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await initGovernedRepo(base);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, VALID_COMMIT_MESSAGE.replace("seed README.md test carrier", `seed ${GOVERNED_FIXTURE} test carrier`));
		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }), { env: gateEnv() });
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/signature_source_unverifiable/);
	});
});


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
	["docs(specs): 调整规范", "", "关键变更:", `- ${item}`, "", "LDVH-Provider: deepseek-harness", "LDVH-Model: test", ""].join("\n");

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

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
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

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
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

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
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

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/load_bearing_resolution_missing/);
	});
});

test("a fact reference resolves by the carrier's object_uid, not only by its file name", async () => {
	await withTemp("ldvh-ggr.", async (base) => {
		const root = await committedDeclarationRepo(base);
		const uid = "11112222-3333-4444-5555-666677778888";
		await mkdir(join(root, "ldvh-base", "norms"), { recursive: true });
		await writeFile(join(root, "ldvh-base", "norms", "unnamed-carrier.md"), `---\nobject_uid: ${uid}\ntitle: x\n---\n\n# x\n`);
		await gitOk(root, ["add", "-A"]);
		await gitOk(root, ["commit", "-qm", "add fact carrier"]);
		await writeFile(join(root, "specs", "01-test.md"), declarationFile("**无**——须按判据逐处核对"));
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, declarationMessage(`specs/01-test.md: 调整表述（独立复核 ${uid} 已确认范围关闭）`));

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
	});
});


const SECTION72_BODY = [
	"### 7.2 领域正文与规则单元",
	"",
	"本节的状态禁令覆盖 `specs/` 内一切载体。禁止的状态有三类：",
	"",
	"1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；",
	"2. **下位文档的存在状态**：某文件已建立／尚未建立；",
	"3. **过程与进度**：某工作已完成百分之多少。",
	"",
	"### 7.3 下一节",
	"",
	"此处不得进入 §7.2 的引用核对范围。",
	"",
].join("\n");

async function committedSpecOneRepo(base, body) {
	const root = await initRepo(base);
	await mkdir(join(root, "specs"), { recursive: true });
	await writeFile(join(root, "specs", "01-test.md"), `# 01 规范\n\n${body}`);
	await gitOk(root, ["add", "-A"]);
	await gitOk(root, ["commit", "-qm", "base"]);
	return root;
}

test("blocks a §7.2 removal basis whose quoted sentence is absent from §7.2", async () => {
	await withTemp("ldvh-ggr-basis.", async (base) => {
		const root = await committedSpecOneRepo(base, SECTION72_BODY);
		await writeFile(join(root, "specs", "01-test.md"), `# 01 规范\n\n${SECTION72_BODY.replace("1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；", "1. 已删除该项。")}`);
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "§7.2 依据：**布局自指计数**", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: deepseek-harness", "LDVH-Model: test", ""].join("\n"));

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/removal_basis_unquotable/);
	});
});

test("allows a §7.2 removal basis that quotes §7.2 verbatim", async () => {
	await withTemp("ldvh-ggr-basis-ok.", async (base) => {
		const root = await committedSpecOneRepo(base, SECTION72_BODY);
		await writeFile(join(root, "specs", "01-test.md"), `# 01 规范\n\n${SECTION72_BODY.replace("1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；", "1. 已删除该项。")}`);
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "§7.2 依据：禁止的状态有三类：", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: deepseek-harness", "LDVH-Model: test", ""].join("\n"));

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
	});
});

test("a quote the commit itself deletes still counts (HEAD ∪ candidate)", async () => {
	await withTemp("ldvh-ggr-basis-head.", async (base) => {
		const root = await committedSpecOneRepo(base, SECTION72_BODY);
		await writeFile(join(root, "specs", "01-test.md"), `# 01 规范\n\n${SECTION72_BODY.replace("1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；", "1. 已删除该项。")}`);
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "§7.2 依据：1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: deepseek-harness", "LDVH-Model: test", ""].join("\n"));

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
	});
});

test("a quote from outside §7.2 does not satisfy the basis (scope is the section)", async () => {
	await withTemp("ldvh-ggr-basis-scope.", async (base) => {
		const root = await committedSpecOneRepo(base, SECTION72_BODY);
		await writeFile(join(root, "specs", "01-test.md"), `# 01 规范\n\n${SECTION72_BODY.replace("1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；", "1. 已删除该项。")}`);
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "§7.2 依据：此处不得进入 §7.2 的引用核对范围。", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: deepseek-harness", "LDVH-Model: test", ""].join("\n"));

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/removal_basis_unquotable/);
	});
});

test("no declaration means no check (narrow by design)", async () => {
	await withTemp("ldvh-ggr-basis-absent.", async (base) => {
		const root = await committedSpecOneRepo(base, SECTION72_BODY);
		await writeFile(join(root, "specs", "01-test.md"), `# 01 规范\n\n${SECTION72_BODY.replace("1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；", "1. 已删除该项。")}`);
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: deepseek-harness", "LDVH-Model: test", ""].join("\n"));

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
	});
});


async function declarationRemovalRepo(base) {
	const root = await committedDeclarationRepo(base);
	await writeFile(join(root, "specs", "01-test.md"), declarationFile("已完成").replace(MARKER, ""));
	await gitOk(root, ["add", "-A"]);
	return root;
}

test("pre-commit 不因删除承重声明而拒绝（09 §5.3 第 6 项 / pre-commit 入口）", async () => {
	await withTemp("ldvh-ggr-precommit.", async (base) => {
		const root = await declarationRemovalRepo(base);
		const lintRoot = await lintWorkspace(base);

		const result = await runNode(
			preCommitArgs({ workspaceRoot: base, worktree: root }),
			{ env: preCommitEnv(lintRoot) }
		);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(pre-commit\) passed/);
	});
});

test("同一条删声明的提交走 commit-msg 仍被拒（09 §5.3 第 6 项 / commit-msg 入口不放宽）", async () => {
	await withTemp("ldvh-ggr-precommit-msg.", async (base) => {
		const root = await declarationRemovalRepo(base);
		const messageFile = join(root, "msg.txt");
		await writeFile(messageFile, declarationMessage("specs/01-test.md: 移除对齐行（无独立复核引用）"));

		const result = await runGate(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/load_bearing_declaration_removed/);
	});
});

test("pre-commit 不再因豁免集为空而误报删声明（09 §5.3 第 6 项 / pre-commit 入口 / 规则名不出现）", async () => {
	await withTemp("ldvh-ggr-precommit-rule.", async (base) => {
		const root = await declarationRemovalRepo(base);
		const lintRoot = await lintWorkspace(base);

		const result = await runNode(
			preCommitArgs({ workspaceRoot: base, worktree: root }),
			{ env: preCommitEnv(lintRoot) }
		);
		assert.doesNotMatch(result.stderr, /validation\/load_bearing_declaration_removed/);
	});
});


async function repoWithLintWorkspace(base, { body = "export const ok = 1;\n", stage = true } = {}) {
	const root = await initRepo(base, { name: "lintrepo" });
	const lintRoot = join(root, "plugin");
	await mkdir(join(lintRoot, "lib"), { recursive: true });
	await mkdir(join(lintRoot, "node_modules"), { recursive: true });
	await writeFile(
		join(lintRoot, "eslint.config.js"),
		'export default [{ files: ["**/*.js"], rules: { "no-unused-vars": "error" } }];\n'
	);
	try {
		await symlink(
			join(pluginRoot, "node_modules", "eslint"),
			join(lintRoot, "node_modules", "eslint"),
			process.platform === "win32" ? "junction" : "dir"
		);
	} catch {
		return { root, lintRoot: pluginRoot };
	}
	await writeFile(join(lintRoot, "lib", "sample.js"), body);
	if (stage) await gitOk(root, ["add", "plugin/lib/sample.js"]);
	return { root, lintRoot };
}

test("pre-commit 拒绝本次提交里 lint 有错的文件（06 §5 / lint 面）", async () => {
	await withTemp("ldvh-ggr-lint-dirty.", async (base) => {
		const { root, lintRoot } = await repoWithLintWorkspace(base, {
			body: "const unusedVariable = 1;\nexport const ok = 2;\n",
		});

		const result = await runNode(
			preCommitArgs({ workspaceRoot: base, worktree: root }),
			{ env: preCommitEnv(lintRoot) }
		);
		assert.equal(result.code, 1, result.stderr);
		assert.match(result.stderr, /validation\/lint_failed/);
		assert.match(result.stderr, /no-unused-vars/);
	});
});

test("pre-commit 放行 lint 干净的提交（06 §5 / lint 面 / 正控制）", async () => {
	await withTemp("ldvh-ggr-lint-clean.", async (base) => {
		const { root, lintRoot } = await repoWithLintWorkspace(base);

		const result = await runNode(
			preCommitArgs({ workspaceRoot: base, worktree: root }),
			{ env: preCommitEnv(lintRoot) }
		);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(pre-commit\) passed/);
	});
});

test("本次提交不含 lint 面内文件时跳过，且不退化为全仓扫描（lint 面 / 空清单）", async () => {
	await withTemp("ldvh-ggr-lint-empty.", async (base) => {
		const { root, lintRoot } = await repoWithLintWorkspace(base, { stage: false });
		await writeFile(join(root, "notes.md"), "# 只是文档\n");
		await gitOk(root, ["add", "notes.md"]);
		await writeFile(join(lintRoot, "lib", "preExistingDirty.js"), "const alsoUnused = 1;\n");

		const result = await runNode(
			preCommitArgs({ workspaceRoot: base, worktree: root }),
			{ env: preCommitEnv(lintRoot) }
		);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(pre-commit\) passed/);
		assert.doesNotMatch(result.stderr, /validation\/lint_failed/);
	});
});

test("他人未提交的 lint 错误不再阻塞本次提交（lint 面 / 阻塞归属）", async () => {
	await withTemp("ldvh-ggr-lint-others.", async (base) => {
		const { root, lintRoot } = await repoWithLintWorkspace(base);
		await writeFile(join(lintRoot, "lib", "someoneElse.js"), "const theirUnused = 1;\n");

		const result = await runNode(
			preCommitArgs({ workspaceRoot: base, worktree: root }),
			{ env: preCommitEnv(lintRoot) }
		);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stderr, /LDVH Git Gate \(pre-commit\) passed/);
	});
});

test("删除一个 lint 面内文件不得被读成 lint 工具故障（lint 面 / 已删除路径）", async () => {
	await withTemp("ldvh-ggr-lint-deleted.", async (base) => {
		const { root, lintRoot } = await repoWithLintWorkspace(base);
		await gitOk(root, ["commit", "-q", "-m", "seed"]);
		await gitOk(root, ["rm", "-q", "plugin/lib/sample.js"]);

		const result = await runNode(
			preCommitArgs({ workspaceRoot: base, worktree: root }),
			{ env: preCommitEnv(lintRoot) }
		);
		assert.equal(result.code, 0, result.stderr);
		assert.doesNotMatch(result.stderr, /No files matching the pattern/);
	});
});






