import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { authoritativeSignature } from "../lib/signature-channel.js";

export const execFileAsync = promisify(execFile);

export const pluginRoot = fileURLToPath(new URL("..", import.meta.url));

export const runnerPath = join(pluginRoot, "lib", "git-gate-runner.js");

export const VALID_COMMIT_MESSAGE = [
	"chore(code): 接入 ldvh 提交校验",
	"",
	"关键变更:",
	"- seed README.md test carrier",
	"",
	"LDVH-Provider: deepseek-harness",
	"LDVH-Model: test",
].join("\n");

export function gateEnv(extra = {}) {
	const env = { ...process.env };
	delete env.DSH_SESSION_ID;
	delete env.DSH_SESSION_JSONL;
	delete env.DSH_HOME;
	return { ...env, ...extra };
}

const ROUTE_HOMES = new Map();

export function signatureEnv({ provider = "deepseek-harness", model = "test", sessionId = "session-test" } = {}) {
	const key = `${provider}\0${model}\0${sessionId}`;
	const cached = ROUTE_HOMES.get(key);
	if (cached !== undefined) return cached;
	const home = mkdtempSync(join(tmpdir(), "ldvh-sig-home-"));
	const dir = join(home, "sessions", "enc-cwd", sessionId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "session.v3.jsonl"), [
		JSON.stringify({ type: "session", id: sessionId }),
		JSON.stringify({ type: "model/selection", data: { provider, model } }),
	].join("\n"));
	const env = { DSH_HOME: home, DSH_SESSION_ID: sessionId };
	ROUTE_HOMES.set(key, env);
	return env;
}

export async function git(root, args, options = {}) {
	const result = await execFileAsync("git", ["-C", root, ...args], {
		encoding: "utf8",
		...options,
	});
	return result.stdout.trim();
}

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

async function removeTreeWithRetry(target, attempts = 10) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			await rm(target, { recursive: true, force: true });
			return;
		} catch (error) {
			const retryable = error?.code === "EBUSY" || error?.code === "EPERM" || error?.code === "ENOTEMPTY";
			if (!retryable || attempt >= attempts) throw error;
			await new Promise((done) => setTimeout(done, 50 * attempt));
		}
	}
}

export async function withTemp(prefix, fn) {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	try {
		return await fn(dir);
	} finally {
		await removeTreeWithRetry(dir);
	}
}

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

export function testSignature({ provider = "test-provider", model = "test-model" } = {}) {
	return authoritativeSignature({ provider, model });
}

export function sessionPersistenceWithRoutingLog(base, { provider = "test-provider", model = "test-model", sessionId = null } = {}) {
	const logPath = join(base, "session.v3.jsonl");
	const lines = [
		...(sessionId === null ? [] : [JSON.stringify({ type: "session", id: sessionId })]),
		JSON.stringify({ type: "user/prompt", data: { text: "hi" } }),
		JSON.stringify({ type: "model/selection", data: { provider, model } }),
	].join("\n");
	return () => ({
		locate: () => {
			writeFileSync(logPath, lines, "utf8");
			return { kind: "jsonl", path: logPath };
		},
	});
}

export function subGoalUid(n) {
	return `${String(n).padStart(8, "0")}-1111-4111-8111-${String(n).padStart(12, "0")}`;
}

export const UNKNOWN_SUBGOAL_UID = "00000099-9999-4999-8999-999999999999";

export async function seedSubGoals(factSourceRoot, anchors = ["SG-1", "SG-2"], { status = "active", parentGoal = "project-goal", indexOffset = 0 } = {}) {
	await mkdir(join(factSourceRoot, "subgoals"), { recursive: true });
	const byLabel = {};
	for (const [i, label] of anchors.entries()) {
		const n = i + 1 + indexOffset;
		const uid = subGoalUid(n);
		byLabel[label] = uid;
		const fm = [
			"title: 测试子目标 " + label,
			"order: " + n,
			"status: " + status,
			"parent_goal: " + parentGoal,
			"criterion: 测试子目标 " + label + " 的达成判据",
			"criterion_kind: closure-records",
			"alignment: 服务于测试目标陈述",
			...(status === "retired" ? ["disposition: 测试作废"] : []),
			"object_uid: " + uid,
			"fact_type_key: subgoal",
			"created_at: 2026-09-15T00:00:00.000Z",
			"change_log:",
			"  - at: 2026-09-15T00:00:00.000Z",
			"    summary: 测试夹具",
		].join("\n");
		const body = [
			"# 测试子目标 " + label,
			"",
			"## 达成条件",
			"",
			"测试子目标 " + label + " 的达成判据",
			"",
			"## 对齐说明",
			"",
			"服务于测试目标陈述",
			"",
		].join("\n");
		await writeFile(join(factSourceRoot, "subgoals", `subgoal-${uid}.md`), `---\n${fm}\n---\n\n${body}`, "utf8");
	}
	return byLabel;
}


export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function missingCorpus(root = repoRoot) {
	const missing = [];
	for (const rel of ["ldvh-base", "specs"]) {
		const dir = join(root, rel);
		let names = [];
		try {
			names = await readdir(dir);
		} catch {
			missing.push(rel);
			continue;
		}
		if (!names.some((n) => n.endsWith(".md"))) missing.push(rel);
	}
	return missing;
}

export async function hasCorpus(root = repoRoot) {
	return (await missingCorpus(root)).length === 0;
}

export async function skipWithoutCorpus(t, root = repoRoot) {
	const missing = await missingCorpus(root);
	if (missing.length === 0) return false;
	t.skip(`仓库自带语料缺席（缺 ${missing.join(" / ")}）：本用例的被测对象是仓库内容而非代码，` +
		`语料不在的检出任（如 main 发布线，adr-62d3e2d8）不应判为代码缺陷`);
	return true;
}


export function fixtureNormUid(n) {
	return `bbbbbbbb-${String(n).padStart(4, "0")}-4bbb-8bbb-${String(n).padStart(12, "0")}`;
}

export async function seedFactCorpus(base, { norms = null, pitfallCount = 0 } = {}) {
	const root = base;
	const normDir = join(root, "ldvh-base", "norms");
	await mkdir(normDir, { recursive: true });

	const normList = norms ?? [
		{
			title: "合成方向规范甲",
			directionKey: "fixture-direction-alpha",
			governs: "本方向管合成语料甲方向的准入与边界。",
			whenToRead: "改动合成语料甲的实现前查阅本规范。",
		},
		{
			title: "合成方向规范乙",
			directionKey: "fixture-direction-beta",
			governs: "本方向管合成语料乙方向的发布门禁。",
			whenToRead: "执行合成语料乙的发布动作前查阅本规范。",
		},
	];
	const normTitles = [];
	for (const [i, norm] of normList.entries()) {
		const uid = fixtureNormUid(i + 1);
		normTitles.push(norm.title);
		const fm = [
			`title: ${norm.title}`,
			"status: active",
			`direction_key: ${norm.directionKey}`,
			`object_uid: ${uid}`,
			"fact_type_key: norm",
			"created_at: 2026-11-15T00:00:00.000Z",
		].join("\n");
		const body = [
			`# ${norm.title}`,
			"",
			"## 方向定位与适用范围",
			"",
			`**管什么**：${norm.governs}`,
			"",
			`**何时查阅**：${norm.whenToRead}`,
			"",
			"## 核心规则体系",
			"",
			"1. 合成规则条目。",
			"",
			"## 约束与反模式",
			"",
			"1. 合成禁止项。",
			"",
			"## 验证与遵从性检查",
			"",
			"合成验证行。",
			"",
		].join("\n");
		await writeFile(join(normDir, `norm-${uid}.md`), `---\n${fm}\n---\n\n${body}`, "utf8");
	}

	if (pitfallCount > 0) {
		const pitfallDir = join(root, "ldvh-base", "pitfalls");
		await mkdir(pitfallDir, { recursive: true });
		for (let i = 1; i <= pitfallCount; i += 1) {
			const uid = `cccccccc-${String(i).padStart(4, "0")}-4ccc-8ccc-${String(i).padStart(12, "0")}`;
			const title = `合成经验条目${i}`;
			const fm = [
				`title: ${title}`,
				"status: active",
				"scope: 适用于合成语料的经验范围。",
				`object_uid: ${uid}`,
				"fact_type_key: pitfall",
				"created_at: 2026-11-15T00:00:00.000Z",
			].join("\n");
			const body = [
				`# ${title}`,
				"",
				"## 症状",
				"",
				"合成症状。",
				"",
				"## 触发条件",
				"",
				"合成触发条件。",
				"",
				"## 根因",
				"",
				"合成根因。",
				"",
				"## 解决",
				"",
				"合成解决。",
				"",
				"## 规避",
				"",
				"合成规避。",
				"",
				"## 验证",
				"",
				"合成验证。",
				"",
				"## 影响与适用范围",
				"",
				"适用于合成语料的经验范围。",
				"",
			].join("\n");
			await writeFile(join(pitfallDir, `pitfall-${uid}.md`), `---\n${fm}\n---\n\n${body}`, "utf8");
		}
	}

	return { root, normTitles };
}
