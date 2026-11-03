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
import { classifyTestRun, RUN_TERMINAL } from "../lib/test-run-report.js";
import { decideMutationRestore } from "../lib/concurrent-write-guard.js";

const run = promisify(execFile);
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(PLUGIN, "..");
const SPECS = join(ROOT, "specs");
const FACTS = join(ROOT, "ldvh-base");

const SPARK = join(SPECS, "20-Spark-火花.md");
const ADR = join(SPECS, "22-ADR-决策.md");
const PITFALL = join(SPECS, "23-Pitfall-踩坑经验.md");

/**
 * 跑漂移检查，按 `specs/06` §5 的三态归类（单一入口见 `lib/test-run-report.js`）。
 *
 * **此处曾返回 `m ? Number(m[1]) : 0`**——与 `mutation-check.mjs` 是同一段判定
 * 被复制的第二份（违 06 §6 单一实现原则），且同样把「测试根本没跑」并入
 * 「零失败」，于是本脚本会报「被抓住」而实际上一次断言都没执行
 * （pitfall-fa36d461 的原始失效点之一）。
 */
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

/**
 * 把三态映射成本脚本的判定词。
 *
 * 不可用终态**不得**落成「被抓住」——那会把「这次没测」读成「漂移被发现了」，
 * 使一项从未执行的检查看起来在守护。
 */
async function driftVerdict(label) {
	const r = await classifyDriftRun();
	if (r.terminal === RUN_TERMINAL.NOT_RUN) return ["**未运行**", label, r.evidence];
	if (r.terminal === RUN_TERMINAL.COUNT_UNAVAILABLE) return ["**计数不可得**", label, r.evidence];
	return [r.failed > 0 ? "被抓住" : "**未报警**", label, r.evidence];
}

// ---------------------------------------------------------------------------
// 在途改动守卫（2026-11-04，与 mutation-check 同一判据、同一模块）
//
// 本脚本会**真的改写 specs/ 与 ldvh-base/ 下的载体**，跑完再按备份还原。这与
// `mutation-check.mjs` 是同一形态的风险面（friction-68e6f33e）：本仓 dev 是
// 多代理共享的同一工作树，运行期间他人在这些载体上的改动会被无条件还原覆盖。
//
// 判据与还原方式完全复用 `lib/concurrent-write-guard.js`：只在「磁盘内容仍是
// 我们最后写下的那一版」时写回备份；期间被他人改过的一律保留其版本并大声报告。
// 不在此另写一份——两份实现分叉正是本类缺陷的来源。
// ---------------------------------------------------------------------------
const backups = new Map();
/** 我们最后一次写下的内容（按路径）。用于判定磁盘上这一版是否还是我们的。 */
const writtenByUs = new Map();
const concurrentTouched = new Set();

async function backup(path) {
	if (!backups.has(path)) backups.set(path, await readFile(path, "utf8"));
}

/** 写一个受守卫的载体：先判归属，再写，并记下自己写的这一版。 */
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
	// —— 变动 1：新增规范 —— 
	// 新增的普通规范由目录扫描自动纳入，**不需要**任何代码改动；
	// 此类变动不该让漂移检查失败（它本就不依赖清单）。
	// 真正的守护是「新增类型规范」——见变动 3。
	results.push(["① 新增普通规范（specs/ 新载体）", "无需守护", "目录扫描自动纳入，另由召回用例验证"]);

	// —— 变动 2：修改规范内容（字段改名）——
	await backup(ADR);
	await backup(PITFALL);
	await writeGuarded(ADR, (await readFile(ADR, "utf8")).replaceAll("trigger_signal", "trigger_sig"));
	await writeGuarded(PITFALL, (await readFile(PITFALL, "utf8")).replaceAll("trigger_signal", "trigger_sig"));
	results.push(["② 修改规范：frontmatter 字段改名", ...(await driftVerdict("改动 22/23 的 trigger_signal"))]);
	await restoreAll();

	// —— 变动 3：新增事实类型规范 ——
	//
	// **新建文件同样要判归属**：若该路径已存在，说明有人已经在用它（并行会话、
	// 或上一次异常退出的残留），此时既不得覆盖、也不得在收尾 `rm` 掉别人的文件。
	// 判据同 writeGuarded：不存在才允许创建。存在即记为在途改动并跳过本项——
	// 跳过是**不可用**，不是「未报警」。
	const NEW_SPEC = join(SPECS, "98-TestNewType.md");
	const newSpecExists = (await readFile(NEW_SPEC, "utf8").catch(() => null)) !== null;
	if (newSpecExists) {
		concurrentTouched.add(NEW_SPEC);
		results.push(["③ 新增事实类型规范", "**在途改动**", `跳过：${NEW_SPEC} 已存在，不覆盖他人文件`]);
	} else {
		await writeFile(
			NEW_SPEC,
			// 须写成**真实类型规范的形态**：在表格里声明自己的 `fact_type_key` 短名。
			// 只写一段普通正文的话，漂移检查判据会（正确地）不把它当类型规范。
			"---\nldvh_spec:\n  spec_key: \"t98\"\n  spec_id: \"98\"\n  spec_kind: \"spec\"\n  title: \"测试新类型\"\n  canonical_path: \"specs/98-TestNewType.md\"\n  scope: \"测试\"\n---\n# 测试新类型\n\n## 1. 身份与载体\n\n| 字段 | 值 |\n| --- | --- |\n| `fact_type_key` | `testnewthing` |\n",
			"utf8",
		);
		results.push(["③ 新增事实类型规范", ...(await driftVerdict("新增 specs/98-…"))]);
		await rm(NEW_SPEC, { force: true });
	}

	// —— 变动 4：修改某类型的状态闭集 ——
	await backup(SPARK);
	await writeGuarded(SPARK, (await readFile(SPARK, "utf8")).replace("默认候选只包含 open Spark", "默认候选只包含 pending Spark"));
	results.push(["④ 修改事实类型：状态闭集变更", ...(await driftVerdict("Spark 的 open→pending"))]);
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
	console.log(`  ${verdict.padEnd(10)} ${name}\n             ${detail}`);
}
const missed = results.filter(([, v]) => v === "**未报警**");
const unusable = results.filter(([, v]) => v === "**未运行**" || v === "**计数不可得**");
const inFlight = results.filter(([, v]) => v === "**在途改动**");
console.log(`\n${results.length - missed.length - unusable.length - inFlight.length}/${results.length} 种变动能感知到`);
if (missed.length > 0) process.exitCode = 1;
if (concurrentTouched.size > 0) {
	// 在途改动 = 本次无法判定（不覆盖、不裁决），与「未运行」同属不可用终态。
	console.log(
		`\n${concurrentTouched.size} 个路径在本次运行期间被其它会话占用（${[...concurrentTouched].join("、")}）：` +
			`涉及它们的变动记为**在途改动**、不覆盖不裁决。等并行会话的改动落定后重跑。`,
	);
	process.exitCode = 1;
}
if (unusable.length > 0) {
	// 06 §5 第 3 项：该终态须使**整批结论不可用**——不得把它算进「能感知到」的分子，
	// 也不得以「X/Y 种能感知到」收尾而隐去这次没测出结论的那几项。
	console.log(
		`\n${unusable.length} 项**无可用判定**（未运行或计数不可得）：本次整批结论不可用，` +
			`不得据以声称「漂移检查有效」或「全部未报警」。先查运行环境再重跑。`,
	);
	process.exitCode = 1;
}
