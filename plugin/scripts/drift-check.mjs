import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTestRun, RUN_TERMINAL } from "../lib/test-run-report.js";
import { decideMutationRestore } from "../lib/concurrent-write-guard.js";

const run = promisify(execFile);
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(PLUGIN, "..");
const SPECS = join(ROOT, "specs");
const FACTS = join(ROOT, "ldvh-base");

const SPARK = join(SPECS, "20-Spark-火花.md");
const PITFALL = join(SPECS, "23-Pitfall-踩坑经验.md");

async function classifyDriftRun() {
	try {
		const r = await run("node", ["--test", "test/recall-spec-drift.test.mjs"], {
			cwd: PLUGIN,
			maxBuffer: 64 * 1024 * 1024,
		});
		return classifyTestRun({ stdout: r.stdout, stderr: r.stderr });
	} catch (e) {
		return classifyTestRun({ stdout: e.stdout, stderr: e.stderr, error: e });
	}
}

async function driftVerdict(label) {
	const r = await classifyDriftRun();
	if (r.terminal === RUN_TERMINAL.NOT_RUN) return ["**未运行**", label, r.evidence];
	if (r.terminal === RUN_TERMINAL.COUNT_UNAVAILABLE) return ["**计数不可得**", label, r.evidence];
	return [r.failed > 0 ? "被抓住" : "**未报警**", label, r.evidence];
}

const backups = new Map();
const writtenByUs = new Map();
const concurrentTouched = new Set();

async function backup(path) {
	if (!backups.has(path)) backups.set(path, await readFile(path, "utf8"));
}

async function writeGuarded(path, text) {
	const current = await readFile(path, "utf8").catch(() => null);
	const last = writtenByUs.get(path) ?? backups.get(path) ?? null;
	if (!decideMutationRestore({ currentContent: current, lastWrittenContent: last }).ok) {
		concurrentTouched.add(path);
		throw new Error(`${path} 在本次运行期间被其它会话改写——不覆盖他人改动`);
	}
	await writeFile(path, text, "utf8");
	writtenByUs.set(path, text);
}

async function restoreAll() {
	for (const [path, text] of backups) {
		const current = await readFile(path, "utf8").catch(() => null);
		if (!decideMutationRestore({ currentContent: current, lastWrittenContent: writtenByUs.get(path) ?? text }).ok) {
			console.error(`!! 未还原：${path} 在本次运行期间被其它会话改写——保留磁盘上的版本，请人工核对`);
			concurrentTouched.add(path);
			continue;
		}
		await writeFile(path, text, "utf8");
		writtenByUs.set(path, text);
	}
}

const results = [];
try {
	results.push(["① 新增普通规范（specs/ 新载体）", "无需守护", "目录扫描自动纳入，另由召回用例验证"]);

	await backup(PITFALL);
	await writeGuarded(PITFALL, (await readFile(PITFALL, "utf8")).replaceAll("trigger_signal", "trigger_sig"));
	results.push(["② 修改规范：frontmatter 字段改名", ...(await driftVerdict("改动 23 的 trigger_signal"))]);
	await restoreAll();

	const NEW_SPEC = join(SPECS, "98-TestNewType.md");
	const newSpecExists = (await readFile(NEW_SPEC, "utf8").catch(() => null)) !== null;
	if (newSpecExists) {
		concurrentTouched.add(NEW_SPEC);
		results.push(["③ 新增事实类型规范", "**在途改动**", `跳过：${NEW_SPEC} 已存在，不覆盖他人文件`]);
	} else {
		await writeFile(
			NEW_SPEC,
			"---\nldvh_spec:\n  spec_key: \"t98\"\n  spec_id: \"98\"\n  spec_kind: \"spec\"\n  title: \"测试新类型\"\n  canonical_path: \"specs/98-TestNewType.md\"\n  scope: \"测试\"\n---\n# 测试新类型\n\n## 1. 身份与载体\n\n| 字段 | 值 |\n| --- | --- |\n| `fact_type_key` | `testnewthing` |\n",
			"utf8",
		);
		results.push(["③ 新增事实类型规范", ...(await driftVerdict("新增 specs/98-…"))]);
		await rm(NEW_SPEC, { force: true });
	}

	await backup(SPARK);
	await writeGuarded(SPARK, (await readFile(SPARK, "utf8")).replace("默认候选只包含 open Spark", "默认候选只包含 pending Spark"));
	results.push(["④ 修改事实类型：状态闭集变更", ...(await driftVerdict("Spark 的 open→pending"))]);
	await restoreAll();

	const UNKNOWN_DIR = join(FACTS, "unknown-things");
	await mkdir(UNKNOWN_DIR, { recursive: true });
	await writeFile(
		join(UNKNOWN_DIR, "thing-dddddddd-4444-4444-8444-444444444444.md"),
		"---\ntitle: 未知类型\ntitle2: x\nstatus: active\nobject_uid: dddddddd-4444-4444-8444-444444444444\nfact_type_key: unknown-thing\n---\n# 未知类型\n\n## 症状\n\n内容。\n",
		"utf8",
	);
	const { recallForAction } = await import("../lib/source-recall.js");
	const probe = await recallForAction({ action: "未知类型", root: ROOT, limit: 5 });
	const disclosed = (probe.gaps ?? []).some((g) => /未登记|未识别|未知类型/.test(g));
	results.push(["⑤ 新增未知类型的事实", disclosed ? "被抓住" : "**未报警**", "gaps 须披露该类型被排除"]);
	await rm(UNKNOWN_DIR, { recursive: true, force: true });
} finally {
	await restoreAll();
}

for (const [name, verdict, detail] of results) {
	console.log(`  ${verdict.padEnd(10)} ${name}\n             ${detail}`);
}
const missed = results.filter(([, v]) => v === "**未报警**");
const unusable = results.filter(([, v]) => v === "**未运行**" || v === "**计数不可得**");
const inFlight = results.filter(([, v]) => v === "**在途改动**");
console.log(`\n${results.length - missed.length - unusable.length - inFlight.length}/${results.length} 种变动能感知到`);
if (missed.length > 0) process.exitCode = 1;
if (concurrentTouched.size > 0) {
	console.log(
		`\n${concurrentTouched.size} 个路径在本次运行期间被其它会话占用（${[...concurrentTouched].join("、")}）：` +
			`涉及它们的变动记为**在途改动**、不覆盖不裁决。等并行会话的改动落定后重跑。`,
	);
	process.exitCode = 1;
}
if (unusable.length > 0) {
	console.log(
		`\n${unusable.length} 项**无可用判定**（未运行或计数不可得）：本次整批结论不可用，` +
			`不得据以声称「漂移检查有效」或「全部未报警」。先查运行环境再重跑。`,
	);
	process.exitCode = 1;
}
