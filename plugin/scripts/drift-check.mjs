// **召回-源一致性检查**：真的制造五种源变动，验证召回模块能感知到。
//
// ## 为什么需要它（2026-10-24，第 70 轮）
//
// `recall-spec-drift.test.mjs` 只证明「在当前源状态下常量与原文一致」。
// 它**不能**证明「源变动时会被发现」——那需要真的把源改掉再看。
//
// 本脚本逐项制造变动、跑漂移检查、还原，报告检查是否真的报警。
// 若某项显示「未报警」，说明该种变动缺守护。
//
// ## 用法
//
//     node scripts/drift-check.mjs
//
// 本脚本会**临时修改 specs/ 与 ldvh-base/**，运行结束（含异常）必定还原。
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(PLUGIN, "..");
const SPECS = join(ROOT, "specs");
const FACTS = join(ROOT, "ldvh-base");

const SPARK = join(SPECS, "20-Spark-火花.md");
const ADR = join(SPECS, "22-ADR-决策.md");
const PITFALL = join(SPECS, "23-Pitfall-踩坑经验.md");

/** 跑漂移检查，返回失败数。 */
async function driftFailures() {
	let out = "";
	try {
		const r = await run("node", ["--test", "test/recall-spec-drift.test.mjs"], {
			cwd: PLUGIN,
			maxBuffer: 64 * 1024 * 1024,
		});
		out = (r.stdout ?? "") + (r.stderr ?? "");
	} catch (e) {
		out = (e.stdout ?? "") + (e.stderr ?? "");
	}
	const m = /^ℹ fail (\d+)/m.exec(out);
	return m ? Number(m[1]) : 0;
}

const backups = new Map();
async function backup(path) {
	if (!backups.has(path)) backups.set(path, await readFile(path, "utf8"));
}
async function restoreAll() {
	for (const [path, text] of backups) await writeFile(path, text, "utf8");
}

const results = [];
try {
	// —— 变动 1：新增规范 —— 
	// 新增的普通规范由目录扫描自动纳入，**不需要**任何代码改动；
	// 此类变动不该让漂移检查失败（它本就不依赖清单）。
	// 真正的守护是「新增类型规范」——见变动 3。
	results.push(["① 新增普通规范（specs/ 新载体）", "无需守护", "目录扫描自动纳入，另由召回用例验证"]);

	// —— 变动 2：修改规范内容（字段改名）——
	await backup(ADR);
	await backup(PITFALL);
	await writeFile(ADR, (await readFile(ADR, "utf8")).replaceAll("trigger_signal", "trigger_sig"), "utf8");
	await writeFile(PITFALL, (await readFile(PITFALL, "utf8")).replaceAll("trigger_signal", "trigger_sig"), "utf8");
	results.push(["② 修改规范：frontmatter 字段改名", (await driftFailures()) > 0 ? "被抓住" : "**未报警**", "改动 22/23 的 trigger_signal"]);
	await restoreAll();

	// —— 变动 3：新增事实类型规范 ——
	const NEW_SPEC = join(SPECS, "98-TestNewType.md");
	await writeFile(
		NEW_SPEC,
		// 须写成**真实类型规范的形态**：在表格里声明自己的 `fact_type_key` 短名。
		// 只写一段普通正文的话，漂移检查判据会（正确地）不把它当类型规范。
		"---\nldvh_spec:\n  spec_key: \"t98\"\n  spec_id: \"98\"\n  spec_kind: \"spec\"\n  title: \"测试新类型\"\n  canonical_path: \"specs/98-TestNewType.md\"\n  scope: \"测试\"\n---\n# 测试新类型\n\n## 1. 身份与载体\n\n| 字段 | 值 |\n| --- | --- |\n| `fact_type_key` | `testnewthing` |\n",
		"utf8",
	);
	results.push(["③ 新增事实类型规范", (await driftFailures()) > 0 ? "被抓住" : "**未报警**", "新增 specs/98-…"]);
	await rm(NEW_SPEC, { force: true });

	// —— 变动 4：修改某类型的状态闭集 ——
	await backup(SPARK);
	await writeFile(SPARK, (await readFile(SPARK, "utf8")).replace("默认候选只包含 open Spark", "默认候选只包含 pending Spark"), "utf8");
	results.push(["④ 修改事实类型：状态闭集变更", (await driftFailures()) > 0 ? "被抓住" : "**未报警**", "Spark 的 open→pending"]);
	await restoreAll();

	// —— 变动 5：新增未知类型的事实目录 ——
	const UNKNOWN_DIR = join(FACTS, "unknown-things");
	await mkdir(UNKNOWN_DIR, { recursive: true });
	await writeFile(
		join(UNKNOWN_DIR, "thing-dddddddd-4444-4444-8444-444444444444.md"),
		"---\ntitle: 未知类型\ntitle2: x\nstatus: active\nobject_uid: dddddddd-4444-4444-8444-444444444444\nfact_type_key: unknown-thing\n---\n# 未知类型\n\n## 症状\n\n内容。\n",
		"utf8",
	);
	// 这一项由召回层 gaps 守护，不是漂移检查——单独看 gaps。
	const { recallForAction } = await import("../lib/source-recall.js");
	const probe = await recallForAction({ action: "未知类型", root: ROOT, limit: 5 });
	const disclosed = (probe.gaps ?? []).some((g) => /未登记|未识别|未知类型/.test(g));
	results.push(["⑤ 新增未知类型的事实", disclosed ? "被抓住" : "**未报警**", "gaps 须披露该类型被排除"]);
	await rm(UNKNOWN_DIR, { recursive: true, force: true });
} finally {
	await restoreAll();
}

for (const [name, verdict, detail] of results) {
	console.log(`  ${verdict.padEnd(8)} ${name}\n             ${detail}`);
}
const missed = results.filter(([, v]) => v === "**未报警**");
console.log(`\n${results.length - missed.length}/${results.length} 种变动能感知到`);
if (missed.length > 0) process.exitCode = 1;
