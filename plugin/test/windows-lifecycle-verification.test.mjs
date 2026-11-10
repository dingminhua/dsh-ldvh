// Windows 生命周期 10 项实测（对照 docs/governed-project-lifecycle-verification.md）。
//
// 每一项都真做一次动作并读回结果，不靠读代码推断。全部在临时目录里建仓库，
// 不触碰任何已登记的真实项目。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
	ensureRegistrationCarrier,
	inspectCandidate,
	installProject,
	initializeFactSource,
	readGovernedProjects,
	registerProject,
	resolveGitRoot,
	uninstallHook,
	unregisterProject,
} from '../lib/governed-projects.js';
import { inspectHook } from '../lib/hook-manager.js';

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";

async function git(cwd, args) {
	await execFileAsync("git", args, { cwd, windowsHide: true });
}

/** 建一个临时 Git 仓库；返回其根路径。 */
async function initRepo(base, name = "repo") {
	const root = join(base, name);
	await mkdir(root, { recursive: true });
	await git(root, ["init", "-q"]);
	await git(root, ["config", "user.email", "t@example.com"]);
	await git(root, ["config", "user.name", "T"]);
	await git(root, ["config", "commit.gpgsign", "false"]);
	await writeFile(join(root, "README.md"), "x\n", "utf8");
	await git(root, ["add", "."]);
	await git(root, ["commit", "-qm", "init"]);
	return root;
}

/** 一次性与环境无关的 shell 引导。 */
async function withWorld(fn) {
	const base = await mkdtemp(join(tmpdir(), "win-lifecycle-"));
	const home = (...segments) => join(base, "home", ...segments);
	await ensureRegistrationCarrier(home);
	try {
		await fn({ base, home });
	} finally {
		await rm(base, { recursive: true, force: true });
	}
}

// runnerPath 必须指向真实的 Gate 执行器，否则 Hook 预检会因 MODULE_NOT_FOUND 失败
// （本文件初版误指向临时路径，导致 ④–⑩ 全部假红——那是验证脚本的错，不是产品缺陷）。
import {
	gateEnv,
	pluginRoot,
	runnerPath as REAL_RUNNER_PATH,
	signatureEnv,
	VALID_COMMIT_MESSAGE,
} from "./helpers.mjs";

/** 供 installProject 使用的 runtime。 */
function runtimeFor(base) {
	return { runnerPath: REAL_RUNNER_PATH, workspaceRoot: base };
}

test("① 候选路径必须为实际 Git 根：仓库子目录被拒绝", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base }) => {
		const repo = await initRepo(base);
		const sub = join(repo, "sub");
		await mkdir(sub, { recursive: true });

		const root = await resolveGitRoot(repo);
		assert.equal(root.projectRoot.toLowerCase().endsWith("repo"), true, `Git 根解析错误：${root.projectRoot}`);

		await assert.rejects(
			() => resolveGitRoot(sub),
			(err) => /git root|subdirectory|not a git/i.test(String(err?.message ?? err)),
			"仓库子目录必须被拒绝",
		);
	});
});

test("② 首次安装创建 ldvh-base 各类型目录（原文档写「五类」，现为七类：researches/frictions/norms 后加）", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base }) => {
		const repo = await initRepo(base);
		const result = await initializeFactSource(repo);
		assert.equal(result.state, "ready", `事实源未就绪：${JSON.stringify(result)}`);
		for (const dir of ["sparks", "workcases", "adrs", "pitfalls", "researches", "frictions", "norms"]) {
			const s = await stat(join(repo, "ldvh-base", dir));
			assert.equal(s.isDirectory(), true, `${dir} 未创建`);
		}
	});
});

test("③ 首次安装创建登记文件，并把首个项目设为默认", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base, home }) => {
		const repo = await initRepo(base);
		const reg = await registerProject(home, { id: "p1", path: repo });
		assert.equal(reg.ok, true, JSON.stringify(reg.error ?? null));
		const read = await readGovernedProjects(home);
		assert.equal(read.value.defaultProjectId, "p1", "首个项目应为默认");
		assert.equal(read.value.projects.length, 1);
	});
});

test("④ Hook 安装在 Git common-dir 的 hooks/commit-msg", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base, home }) => {
		const repo = await initRepo(base);
		const installed = await installProject(home, { id: "p1", path: repo }, runtimeFor(base));
		assert.equal(installed.ok, true, JSON.stringify(installed.error ?? null));
		const hook = await inspectHook(repo);
		assert.equal(hook.state, "managed", `Hook 状态：${hook.state} — ${hook.detail ?? ""}`);
	});
});

test("⑤ Hook marker 的正文 digest 与 bundle 版本可回读为 managed", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base, home }) => {
		const repo = await initRepo(base);
		const installed = await installProject(home, { id: "p1", path: repo }, runtimeFor(base));
		assert.equal(installed.ok, true, JSON.stringify(installed.error ?? null));
		const hook = await inspectHook(repo);
		assert.equal(hook.state, "managed");
		assert.equal(hook.hookBundleVersion, hook.expectedHookBundleVersion, "bundle 版本须可回读且与期望一致");
		assert.equal(typeof hook.hookBundleVersion, "string");
	});
});

test("⑥ 真实 git commit 中非法 message 被阻断", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base, home }) => {
		const repo = await initRepo(base);
		const installed = await installProject(home, { id: "p1", path: repo }, runtimeFor(base));
		assert.equal(installed.ok, true, JSON.stringify(installed.error ?? null));
		await writeFile(join(repo, "a.txt"), "a\n", "utf8");
		await git(repo, ["add", "."]);
		// 无 LDVH trailer 的自由文本应被 Gate 阻断。
		await assert.rejects(
			() => git(repo, ["commit", "-m", "随便写的提交信息"]),
			"非法 message 必须被 commit-msg Hook 阻断",
		);
	});
});

test("⑦ 符合最小 Gate 契约的 message 被放行", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base, home }) => {
		const repo = await initRepo(base);
		const installed = await installProject(home, { id: "p1", path: repo }, runtimeFor(base));
		assert.equal(installed.ok, true, JSON.stringify(installed.error ?? null));
		// pre-commit 会对 `<repo>/node_modules` 跑全量 eslint；临时仓库没有依赖，
		// 因此必须自备一个**最小 lint 面**（与 git-gate-runner.test.mjs 的
		// lintWorkspace 同款）：自带 eslint 配置 + 一个必定干净的文件 + 指向插件
		// 已装 eslint 的目录链接。这不是产品要求，是验证脚手架的必备前置。
		await mkdir(join(base, "node_modules"), { recursive: true });
		await writeFile(join(base, "eslint.config.js"), "export default [];\n", "utf8");
		await mkdir(join(base, "lib"), { recursive: true });
		await writeFile(join(base, "lib", "placeholder.js"), "export const p = true;\n", "utf8");
		await symlink(
			join(pluginRoot, "node_modules", "eslint"),
			join(base, "node_modules", "eslint"),
			process.platform === "win32" ? "junction" : "dir",
		);
		await writeFile(join(repo, "b.txt"), "b\n", "utf8");
		await git(repo, ["add", "."]);
		// 说明：本项只验证「Hook 对合法形态放行」，具体契约形状由 09 §5 决定；
		// 这里用一个带 trailer 的最小形态，断言它不被 Hook 阻断。
		// 两点都是**必须**的，缺一即假红（本文件初版缺这两点，⑦ 因此误判为产品缺陷）：
		//  ① 消息用 helpers 里已被 Gate 契约钉住的那份，不自编；
		//  ② 子进程用 `gateEnv(signatureEnv())` 起——Gate 从会话记录取运维方/模型
		//     作为 trailer 权威值，若继承本机真实 DSH_*，断言就会绑到运行者身上。
		await execFileAsync("git", ["commit", "-m", VALID_COMMIT_MESSAGE], {
			cwd: repo,
			windowsHide: true,
			env: gateEnv(signatureEnv()),
		});
		const log = await execFileAsync("git", ["log", "-1", "--format=%s"], { cwd: repo, windowsHide: true });
		assert.ok(String(log.stdout ?? "").trim().length > 0, "合法 message 应被放行");
	});
});

test("⑧ 卸载 Hook 后登记与 ldvh-base 保留", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base, home }) => {
		const repo = await initRepo(base);
		await installProject(home, { id: "p1", path: repo }, runtimeFor(base));
		const removed = await uninstallHook(repo);
		assert.equal(removed.ok, true, JSON.stringify(removed.error ?? null));
		const after = await inspectHook(repo);
		assert.equal(after.state, "absent", `卸载后仍非 absent：${after.state}`);
		const reg = await readGovernedProjects(home);
		assert.equal(reg.value.projects.length, 1, "登记必须保留");
		const s = await stat(join(repo, "ldvh-base"));
		assert.equal(s.isDirectory(), true, "ldvh-base 必须保留");
	});
});

test("⑨ 再次安装可修复缺失 Hook，且不重复登记", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base, home }) => {
		const repo = await initRepo(base);
		await installProject(home, { id: "p1", path: repo }, runtimeFor(base));
		await uninstallHook(repo);
		// 修复：再次安装
		const again = await installProject(home, { id: "p1", path: repo }, runtimeFor(base));
		assert.equal(again.ok, true, JSON.stringify(again.error ?? null));
		const hook = await inspectHook(repo);
		assert.equal(hook.state, "managed", "Hook 应被修复");
		const reg = await readGovernedProjects(home);
		assert.equal(reg.value.projects.length, 1, "不得重复登记");
	});
});

test("⑩ 取消管辖移除登记并自动卸载 Hook，保留 ldvh-base", { skip: !isWindows && "本文件是 Windows 验证记录" }, async () => {
	await withWorld(async ({ base, home }) => {
		const repo = await initRepo(base);
		await installProject(home, { id: "p1", path: repo }, runtimeFor(base));
		const off = await unregisterProject(home, { id: "p1", path: repo });
		assert.equal(off.ok, true, JSON.stringify(off.error ?? null));
		const hook = await inspectHook(repo);
		assert.equal(hook.state, "absent", "取消管辖须卸载 Hook");
		const reg = await readGovernedProjects(home);
		assert.equal(reg.value.projects.length, 0, "登记须移除");
		const s = await stat(join(repo, "ldvh-base"));
		assert.equal(s.isDirectory(), true, "ldvh-base 须保留");
	});
});
