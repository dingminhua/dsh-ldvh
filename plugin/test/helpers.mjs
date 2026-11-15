// Shared helpers for the LDVH plugin lib test-suite.
//
// Every test that touches a Git repository uses a throwaway directory under
// the OS temp dir and removes it again when the test finishes, so no test
// ever writes outside its own temporary area.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
	"chore(code): 接入 ldvh 提交校验",
	"",
	"关键变更:",
	"- seed README.md test carrier",
	"",
	"LDVH-Provider: deepseek-harness",
	"LDVH-Model: test",
].join("\n");

/**
 * A hermetic DSH shell environment for Git Gate (commit-msg) tests.
 *
 * The Hook resolves the authoritative route through the shell channel
 * (09 §5.1 取值来源). A test child would otherwise inherit
 * the real DSH_* of whoever runs the suite, so the route would be the live
 * session's provider/model and the assertions would depend on the operator.
 * Stripping the three route variables makes the child hermetic; callers that
 * need a resolvable route pass `signatureEnv()` extras.
 */
export function gateEnv(extra = {}) {
	const env = { ...process.env };
	delete env.DSH_SESSION_ID;
	delete env.DSH_SESSION_JSONL;
	delete env.DSH_HOME;
	return { ...env, ...extra };
}

const ROUTE_HOMES = new Map();

/**
 * Build a DSH home holding one session log whose last routing event carries the
 * given provider/model, and return the env additions that let a child process
 * resolve it (`DSH_HOME` + `DSH_SESSION_ID`). Memoized per pair so a test file
 * does not create a directory per spawn.
 */
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
 * Remove a temp tree, retrying through the brief Windows EBUSY/EPERM window.
 *
 * A handle can outlive its owner by a few milliseconds (an HTTP server or
 * fs.watch closing asynchronously), so an immediate `rm` fails on a tree that is
 * not actually leaked. The attempt bound keeps a real leak failing loudly.
 *
 * Kept OUT of the `finally` block body on purpose: `no-unsafe-finally` forbids a
 * `throw` there, because a cleanup failure would replace whatever the test body
 * threw and hide the real failure. Calling a function that may throw keeps the
 * original error primary.
 */
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

/**
 * Create a temp directory, run fn(dir), then unconditionally remove it.
 * Every test should wrap its Git work in this helper so nothing leaks.
 */
export async function withTemp(prefix, fn) {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	try {
		return await fn(dir);
	} finally {
		await removeTreeWithRetry(dir);
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

/**
 * A file-backed sessionPersistence mock for the TOOLS-layer tests.
 *
 * The tools resolve the mechanical signature through the real host channel
 * (`currentRouteValues(deps.sessionPersistence(), exec.agent)`), so — unlike
 * writer-level tests, which hand over `testSignature()` directly — the tools
 * tests must provide a service that `locate`s a real session log carrying a
 * routing event. The log is a plain (uncompressed) JSONL file, which
 * `readSessionLogText` accepts as a legitimate persistence configuration.
 *
 * Returns the `() => service` thunk shaped exactly like `makeDeps`'s other
 * deferred services. Tests that exercise the unavailable-signature refusal
 * keep passing `() => undefined`.
 */
export function sessionPersistenceWithRoutingLog(base, { provider = "test-provider", model = "test-model", sessionId = null } = {}) {
	const logPath = join(base, "session.v3.jsonl");
	const lines = [
		// Optional leading session record: identity resolution (fail-closed
		// on identity-less attempt allocation) needs it; tests that exercise the
		// unavailable-identity path leave it off.
		...(sessionId === null ? [] : [JSON.stringify({ type: "session", id: sessionId })]),
		JSON.stringify({ type: "user/prompt", data: { text: "hi" } }),
		JSON.stringify({ type: "model/selection", data: { provider, model } }),
	].join("\n");
	// The log is written lazily on the first locate() call: deps factories are
	// also used by render/schema tests whose base paths (e.g. "/nope") exist
	// only as placeholders and must never be written to.
	return () => ({
		locate: () => {
			writeFileSync(logPath, lines, "utf8");
			return { kind: "jsonl", path: logPath };
		},
	});
}

/**
 * Seed `ldvh-base/subgoals/` with SubGoal carriers for the given anchors.
 *
 * 25 §7 (2026-11) moved sub-goals out of goal.md into SubGoal fact objects
 * (28). Tests that need `serves: SG-n` to resolve must now seed these carriers
 * instead of writing a `## 子目标` section into goal.md.
 *
 * `factSourceRoot` is the directory that holds goal.md and the typed
 * subdirectories (i.e. the parent of ldvh-base/, as the writers see it).
 */
/** Deterministic fixture uid for the n-th seeded SubGoal (1-based). */
export function subGoalUid(n) {
	return `${String(n).padStart(8, "0")}-1111-4111-8111-${String(n).padStart(12, "0")}`;
}

/** A uuid that NO seeded SubGoal ever occupies (for "unresolvable serves" cases). */
export const UNKNOWN_SUBGOAL_UID = "00000099-9999-4999-8999-999999999999";

/**
 * Seed `ldvh-base/subgoals/` with SubGoal carriers.
 *
 * `anchors` keeps its old call shape (`["SG-1","SG-2"]`) but is now only a
 * FIXTURE LABEL: `SG-n` is no longer a field (28 §7 废止业务编号, 2026-11-01),
 * so it lands in `title` and the returned uid map. `serves` in a fixture must
 * use `subGoalUid(n)` — the anchors are not identities any more.
 *
 * Returns `{ [label]: uid }` so a caller can wire `serves` without hard-coding
 * the uuid scheme.
 */
export async function seedSubGoals(factSourceRoot, anchors = ["SG-1", "SG-2"], { status = "active", parentGoal = "project-goal", indexOffset = 0 } = {}) {
	await mkdir(join(factSourceRoot, "subgoals"), { recursive: true });
	const byLabel = {};
	for (const [i, label] of anchors.entries()) {
		// `indexOffset` keeps uids distinct across successive calls — otherwise a
		// second call would overwrite the first call's carriers at the same path.
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

// ---------------------------------------------------------------------------
// 仓库自带语料（`ldvh-base/` + `specs/`）的存在性守卫
//
// 一批召回/注入用例把**本仓库自己的事实源与规范源**当作被测语料：它们断言「真实
// 语料里能召回某条教训」「注入行的实测百分比与当前语料一致」等。这类断言的被测
// 对象是仓库内容，不是代码——因此语料缺席时它们必然红，而红的不是代码缺陷。
//
// 语料为什么可能缺席：`main` 是发布线，按 adr-62d3e2d8 其树**不含事实对象**，故
// 从 `main` 单独取树（或任何只包含发布产物的检出）里没有 `ldvh-base/`。
//
// 处理纪律（两半缺一不可）：
//   1. 语料缺席 ⇒ 相关用例**如实 skip**，并在跳过消息里点名缺的是哪一侧。不得
//      改断言去迁就（那会把「语料在不在」变成静默变化）。
//   2. 语料缺席这件事本身**必须有一条反向用例守住**（见 `corpus.test.mjs`）：
//      在 `dev` 这类承载语料的树上，语料缺失即报错。否则第 1 条就成了「谁也
//      不知道语料还在不在」的掩护——语料被误删时全绿。
// ---------------------------------------------------------------------------

/** 仓库根（`plugin/test` 上溯两级）。与既有用例里的 `ROOT` 同值。 */
export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * 返回缺失的语料目录名（`ldvh-base` / `specs` 的子集）；空数组表示语料齐备。
 *
 * 检查的是**目录是否存在且含 `.md` 载体**，不是「目录存在」——一个空目录同样
 * 无法支撑任何「真实语料能召回 X」的断言。
 */
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

/**
 * `missingCorpus` 的布尔便捷形式——供 `t.skip()` 的判定使用。
 */
export async function hasCorpus(root = repoRoot) {
	return (await missingCorpus(root)).length === 0;
}

/**
 * 语料缺席时 `t.skip()` 并返回 `true`（调用方据此提前 `return`）。
 *
 * 用法：`if (await skipWithoutCorpus(t)) return;`
 */
export async function skipWithoutCorpus(t, root = repoRoot) {
	const missing = await missingCorpus(root);
	if (missing.length === 0) return false;
	t.skip(`仓库自带语料缺席（缺 ${missing.join(" / ")}）：本用例的被测对象是仓库内容而非代码，` +
		`语料不在的检出任（如 main 发布线，adr-62d3e2d8）不应判为代码缺陷`);
	return true;
}

// ---------------------------------------------------------------------------
// 受控合成语料（常驻索引与基线用例的夹具）
//
// 一批用例钉的是**代码行为**——零命中回合仍须注入、基线字节须从候选预算扣除、
// F1 枚举不受 limit/types 过滤、极小预算让位须留痕——但初版把**本仓库自己的
// 事实源**当夹具。后果是：这些守卫随仓库的语料态漂移，而不是随代码漂移。
//
// 实证（2026-11-15）：`8055c813` 把 2 条 active ADR 转为 Norm 后，全仓 17 条 ADR
// 均为 retired，于是 10 条 ADR 基线守卫一起转红——红的是「仓库现在没有 active
// ADR」这个语料事实，不是基线代码坏了。把它们 skip 掉等于让活代码失去守卫；
// 往事实源里造一条 active ADR 则是污染真实语料。故改用本夹具：临时目录里造
// 受控语料，守卫既活着又不随仓库漂移。
// ---------------------------------------------------------------------------

/** 合成语料里 active ADR 的固定 uid（1-based → uid）。 */
export function fixtureAdrUid(n) {
	return `aaaaaaaa-${String(n).padStart(4, "0")}-4aaa-8aaa-${String(n).padStart(12, "0")}`;
}

/** 合成语料里 active Norm 的固定 uid（1-based → uid）。 */
export function fixtureNormUid(n) {
	return `bbbbbbbb-${String(n).padStart(4, "0")}-4bbb-8bbb-${String(n).padStart(12, "0")}`;
}

/**
 * 造一份**受控合成语料**目录（`ldvh-base/adrs` + `ldvh-base/norms`），返回其根路径。
 *
 * 调用方须在用完后 `rm(dir, {recursive:true, force:true})`（或用 `withTemp`）。
 *
 * @param {string} base 承载目录（通常是 `mkdtemp` 的结果）
 * @param {object} [options]
 * @param {number} [options.adrCount=2] active ADR 条数（0 = 模拟「ADR 全数退役」态）
 * @param {string[]} [options.adrTitles] 逐条覆盖 ADR 标题（长度须 ≤ adrCount）。
 *   标题须含「ADR」字样时可被类型点名层命中（`recallForAction` 的
 *   `matchCandidate` 类型点名通道）——「写一个 ADR 须召回 adr」这类用例依赖它。
 * @param {Array<{title:string, directionKey:string, governs:string, whenToRead:string}>} [options.norms]
 *   active Norm 清单；缺省造两条合 27 §8 两句契约的定位段
 * @param {number} [options.pitfallCount=0] active Pitfall 条数（经验按需行的计数来源）
 * @returns {Promise<{root: string, adrTitles: string[], normTitles: string[]}>}
 */
export async function seedFactCorpus(base, { adrCount = 2, adrTitles = null, norms = null, pitfallCount = 0 } = {}) {
	const root = base;
	const adrDir = join(root, "ldvh-base", "adrs");
	const normDir = join(root, "ldvh-base", "norms");
	await mkdir(adrDir, { recursive: true });
	await mkdir(normDir, { recursive: true });

	const seededAdrTitles = [];
	for (let i = 1; i <= adrCount; i += 1) {
		const uid = fixtureAdrUid(i);
		const title = Array.isArray(adrTitles) && typeof adrTitles[i - 1] === "string"
			? adrTitles[i - 1]
			: `合成决策基线条目${i}`;
		seededAdrTitles.push(title);
		const fm = [
			`title: ${title}`,
			"status: active",
			`decision: 合成决策 ${i} 的决定句。`,
			`scope: 适用于合成语料的注入范围。`,
			`object_uid: ${uid}`,
			"fact_type_key: adr",
			"created_at: 2026-11-15T00:00:00.000Z",
		].join("\n");
		const body = [
			`# ${title}`,
			"",
			"## 决策背景",
			"",
			"合成语料。",
			"",
			"## 决定",
			"",
			`合成决策 ${i} 的决定句。`,
			"",
			"## 备选与理由",
			"",
			"合成语料。",
			"",
			"## 后果",
			"",
			"合成语料。",
			"",
			"## 适用范围",
			"",
			"适用于合成语料的注入范围。",
			"",
		].join("\n");
		await writeFile(join(adrDir, `adr-${uid}.md`), `---\n${fm}\n---\n\n${body}`, "utf8");
	}

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
		// 定位段按 27 §8 两句契约（2026-11-15）：恰好两段，各以固定标签起首。
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

	// 返回**实际落盘的标题**（可能与入参不同：入参为 null 时用缺省名）。
	return { root, adrTitles: seededAdrTitles, normTitles };
}
