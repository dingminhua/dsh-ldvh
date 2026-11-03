// Tests for plugin/lib/git-gate-runner.js — the LDVH Git commit-msg gate that
// hooks exec via `node git-gate-runner.js git-commit-msg ...`.
//
// The runner is a top-level script (it owns process.exitCode), so it is
// exercised by spawning it as a child process against throwaway Git
// repositories that are cleaned up in withTemp().
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git, gitOk, initRepo, pluginRoot, runNode, runnerPath, VALID_COMMIT_MESSAGE, withTemp } from "./helpers.mjs";

function runnerArgs({ workspaceRoot, worktree, messageFile }) {
	return [
		runnerPath,
		"git-commit-msg",
		"--workspace-root", workspaceRoot,
		"--worktree", worktree,
		"--message-file", messageFile,
	];
}

/**
 * pre-commit 入口的参数（09 §5.3 第 6 项 / pre-commit 入口）。
 *
 * git 调用 pre-commit 时不传任何参数，提交消息此刻尚不存在，所以这条入口
 * 没有 --message-file。
 */
function preCommitArgs({ workspaceRoot, worktree }) {
	return [
		runnerPath,
		"git-pre-commit",
		"--workspace-root", workspaceRoot,
		"--worktree", worktree,
	];
}

/**
 * 一个自足的 lint 面（pre-commit 入口用）。
 *
 * pre-commit 会对 lint 面跑一遍全量 eslint，所以这个面的内容必须与被测
 * 行为无关：若把 lint 面指向插件根，任何人正在编辑的插件文件一旦有 lint
 * 错误，本组用例就会因为一个无关理由变红。故此建一个最小 lint 面：自己的
 * eslint.config.js、一个必定干净的 lib 文件，以及指向插件已装 eslint 的
 * 符号链接（runner 只要求 <root>/node_modules/eslint/bin/eslint.js 存在）。
 */
async function lintWorkspace(base) {
	const root = join(base, "lint-workspace");
	await mkdir(join(root, "lib"), { recursive: true });
	await mkdir(join(root, "node_modules"), { recursive: true });
	await writeFile(join(root, "eslint.config.js"), "export default [];\n");
	await writeFile(join(root, "lib", "placeholder.js"), "export const lintSurfacePlaceholder = true;\n");
	try {
		// Windows 上建目录链接不需要管理员权限，普通符号链接需要，故分平台取型。
		await symlink(join(pluginRoot, "node_modules", "eslint"), join(root, "node_modules", "eslint"), process.platform === "win32" ? "junction" : "dir");
	} catch {
		// 建不了链接就退回插件根作为 lint 面：功能正常，但会连带扫描整个插件。
		return pluginRoot;
	}
	return root;
}

/**
 * pre-commit 的环境：lint 面指向自足工作区（见 lintWorkspace），其余环境
 * 继承（git 需要 PATH 与 HOME）。
 */
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
			"chore(x): 合规标题",
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
			"chore(x): 合规标题",
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
			"chore(x): 合规标题",
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
			"chore(x): 合规标题",
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

// ─────────────────────────────────────────────────────────────────────────────
// 09 §5.3 第 7 项（Human 决定 2026-10-15）：以「§7.2 违规」为由删除规范内容时，
// 消息须携带逐字引用 §7.2 原文的声明，且该引用须在当次 §7.2 文本中逐字存在。
// 来历：主控曾自拟判据并另造一个 §7.2 中并不存在的违规类「布局自指计数」，
// 据此批量删除（账目 ba4afa96）。本条即该轮复审给出的「无原文即不得删」。
// ─────────────────────────────────────────────────────────────────────────────

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
		// 历史事故的形态：引用的判据在 §7.2 里根本不存在。
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "§7.2 依据：**布局自指计数**", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: test-provider", "LDVH-Model: test-model", ""].join("\n"));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
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
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "§7.2 依据：禁止的状态有三类：", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: test-provider", "LDVH-Model: test-model", ""].join("\n"));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
	});
});

test("a quote the commit itself deletes still counts (HEAD ∪ candidate)", async () => {
	await withTemp("ldvh-ggr-basis-head.", async (base) => {
		const root = await committedSpecOneRepo(base, SECTION72_BODY);
		await writeFile(join(root, "specs", "01-test.md"), `# 01 规范\n\n${SECTION72_BODY.replace("1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；", "1. 已删除该项。")}`);
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		// 引的正是本次要删的那句：它只在 HEAD 版 §7.2 里，仍算引用成立。
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "§7.2 依据：1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: test-provider", "LDVH-Model: test-model", ""].join("\n"));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
	});
});

test("a quote from outside §7.2 does not satisfy the basis (scope is the section)", async () => {
	await withTemp("ldvh-ggr-basis-scope.", async (base) => {
		const root = await committedSpecOneRepo(base, SECTION72_BODY);
		await writeFile(join(root, "specs", "01-test.md"), `# 01 规范\n\n${SECTION72_BODY.replace("1. **实现状态**：某项机制「已实现／尚未实现」，以及实现所在的文件、函数或批次说明；", "1. 已删除该项。")}`);
		await gitOk(root, ["add", "-A"]);
		const messageFile = join(root, "msg.txt");
		// 引的是 §7.3 的句子：在载体里逐字存在，但不属 §7.2。
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "§7.2 依据：此处不得进入 §7.2 的引用核对范围。", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: test-provider", "LDVH-Model: test-model", ""].join("\n"));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
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
		await writeFile(messageFile, ["docs(specs): 删除该行", "", "关键变更:", "- specs/01-test.md: 删除实现状态行", "", "LDVH-Provider: test-provider", "LDVH-Model: test-model", ""].join("\n"));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
		assert.equal(result.code, 0, result.stderr);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// pre-commit 入口的承重声明检查（09 §5.3 第 6 项 / pre-commit 入口）
//
// 来历：mainPreCommit 曾以两个参数调用 runSharedChecks，承重声明检查的
// 豁免集由消息构造，空消息下豁免集恒空 ⇒ pre-commit 拒绝任何删除/削削
// 承重声明的提交（假拒绝），而同一提交走 commit-msg 却能通过——09 §5.3
// 第 6 项写明的唯一放行条件在 pre-commit 结构上不可达。
//
// 这三条用例守住修复后的边界：pre-commit 显式跳过消息形状的检查（消息
// 此刻不存在），commit-msg 一刻也不放松。
// ─────────────────────────────────────────────────────────────────────────────

/** 一个已提交承重声明、候选里整条声明被删除的仓库（09 §5.3 第 6 项）。 */
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
		// 消息里没有任何可解析的引用 ⇒ 豁免集为空 ⇒ 承重声明检查必须拒绝。
		await writeFile(messageFile, declarationMessage("specs/01-test.md: 移除对齐行（无独立复核引用）"));

		const result = await runNode(runnerArgs({ workspaceRoot: base, worktree: root, messageFile }));
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
