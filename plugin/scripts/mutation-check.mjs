import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { open, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTestRun, RUN_TERMINAL } from "../lib/test-run-report.js";
import { decideMutationWrite, decideMutationRestore } from "../lib/concurrent-write-guard.js";
import { summarizeMutationCoverage } from "../lib/mutation-coverage.js";

const run = promisify(execFile);
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(PLUGIN, "lib", "source-recall.js");
const INJ = join(PLUGIN, "lib", "recall-injection.js");
const GUID = join(PLUGIN, "lib", "guidance.js");
const LIFE = join(PLUGIN, "lib", "lifecycle.js");
const HM = join(PLUGIN, "lib", "hook-manager.js");
const GGR = join(PLUGIN, "lib", "git-gate-runner.js");
const WM = join(PLUGIN, "lib", "web-mount.js");
const GB = join(PLUGIN, "lib", "guidance-budget.js");
const CWG = join(PLUGIN, "lib", "concurrent-write-guard.js");
const MC = join(PLUGIN, "lib", "mutation-coverage.js");
const TRR = join(PLUGIN, "lib", "test-run-report.js");
const TESTS = [
	"test/source-recall.test.mjs",
	"test/recall-injection.test.mjs",
	"test/recall-integration.test.mjs",
	"test/recall-real-activation.test.mjs",
	"test/injection-budget.test.mjs",
	"test/lifecycle.test.mjs",
	"test/preflight-cost.test.mjs",
	"test/web-mount.test.mjs",
	"test/guidance-budget.test.mjs",
	"test/concurrent-write-guard.test.mjs",
	"test/mutation-coverage.test.mjs",
	"test/recall-type-channels.test.mjs",
	"test/test-run-report.test.mjs",
];

const MUTATIONS = [
	[LIB, "弱命中不排后", "Number(a.weakHit === true) - Number(b.weakHit === true) ||", "0 ||"],
	[LIB, "中间产物白名单失效", "if (!REGISTERED_FACT_TYPES.includes(c.type)) return false;", ""],
	[LIB, "证据次序失效（hits 压过 tier）", "    num(fa.tier) - num(fb.tier) ||\n    num(fb.hits) - num(fa.hits);", "    num(fb.hits) - num(fa.hits) ||\n    num(fa.tier) - num(fb.tier);"],
	[LIB, "按类型默认状态失效", '    if (entry.values?.notApplicable?.["默认候选状态"] === true) {', '    if (false) {'],
	[LIB, "兜底回落被静默（冒充正常读表）", '    kind: parseFailed ? "disabled" : "fallback",', '    kind: "table",'],
	[LIB, "F2 摘录为空", "excerpt: excerptOf(c.excerptSource) || c.title,", 'excerpt: "",'],
	[LIB, "F0 层缺失", "      countsByTypeStatus: facts.reduce((acc, fact) => {", "      countsByTypeStatusX: facts.reduce((acc, fact) => {"],
	[LIB, "gaps 缺失", "    gaps: [", "    gapsX: ["],
	[LIB, "uncheckedRange 缺失", "    uncheckedRange: {", "    uncheckedRangeX: {"],
	[LIB, "事实正文未剥离 frontmatter", '      const body = text.replace(/^---\\n[\\s\\S]*?\\n---\\n?/, "");', "      const body = text;"],
	[INJ, "渲染不标截断", "  const renderTruncated = droppedMatch !== null;", "  const renderTruncated = false;"],
	[GUID, "每步都注入（不只在 step 1）", "      if (payload.step !== 1) return decision;", "      // 破坏：每步都注入"],
	[GUID, "判定文本未就绪时连坐召回", '      const noticeReady = currentNotice !== null && currentNotice !== "" && !suppressRow;', '      const noticeReady = currentNotice !== null && currentNotice !== "";\n      if (!noticeReady) return decision;'],
	[GUID, "召回行刷新时覆盖错行", "const priorRecall = batch.find((m) => isRecallMessage(m, label));", "const priorRecall = batch[0];"],
	[LIFE, "召回不检查管辖状态", '          if (lifecycle.scopeState !== "governed") return { inject: false, reason: "not-governed" };', ""],
	[LIB, "候选缺 tier 语义说明", '        matchTierMeaning:\n          "匹配层（命中了哪个字段），非 F0–F4 事实分层、非 L0–L4 规范读取分层（02 §9.1）",', ""],
	[LIB, "预算裁剪失效（候选超预算不拦截）", "    if (used + size > usableBudget) return false;", "    if (false) return false;"],
	[LIB, "排序无确定性兜底", "        a.path.localeCompare(b.path),", "        0,"],
	[LIB, "类型点名层失效", "        return { tier: 0.5, hits: 1, hitReason: `类型点名命中：${named}` };", "        return { tier: 9, hits: 1, hitReason: `x` };"],
	[LIFE, "召回头缺失 projectPath 兜底", '          if (typeof projectPath !== "string" || projectPath.length === 0) return { inject: false, reason: "no-project" };', ""],
	[INJ, "零命中时常驻索引段被短路（Norm 段随词法运气缺席）", "  if (!decideInjection({\n    candidateCount: total,\n    residentIndexPresent: residentIndexHasContent,\n  })) {", "  if (!decideInjection({\n    candidateCount: total,\n    residentIndexPresent: false,\n  })) {"],
	[INJ, "注入判据恒真（无条件注入）", "  return count >= MIN_HITS || residentIndexPresent;", "  return true;"],
	[INJ, "经验计数为 0 也算常驻内容（空事实源无条件注入）", "  const pitfallPresent = Number.isInteger(l0Enumeration?.pitfallTotal) && l0Enumeration.pitfallTotal > 0;", "  const pitfallPresent = Number.isInteger(l0Enumeration?.pitfallTotal);"],
	[LIB, "档位表被改成无上限（任意数可填）", "  10: 10 * 1024,", "  10: Number.MAX_SAFE_INTEGER,"],
	[LIB, "未登记档位静默回落（不报错）", "    return {\n      ok: false,", "    return {\n      ok: true,"],
	[LIB, "默认档退回旧常量（数值偏小未解决）", "export const DEFAULT_INJECTION_BUDGET_TIER = 10;", "export const DEFAULT_INJECTION_BUDGET_TIER = 2;"],
	[LIB, "语料缓存键不含内容（改动后仍返陈旧解析）", "    fingerprint = await corpusFingerprintOf(files.map((entry) => entry.path));", "    fingerprint = \"fixed-key\";"],
	[LIB, "语料缓存键不含新增文件", "  const sorted = [...files].sort();", "  const sorted = [...files].slice(0, 1).sort();"],
	[LIB, "tokenize 跨段拼接（段内性失效）", "  const cjk = text.match(/[\\u4e00-\\u9fff]+/g) ?? [];", "  const cjk = [text];"],
	[LIB, "窄面 token 集混入 body", "  const narrow = new Set([...scopeTokens, ...detailTokens, ...titleTokens]);", "  const narrow = new Set([...scopeTokens, ...detailTokens, ...titleTokens, ...bodyTokens]);"],
	[LIB, "事实源混入顶层文件（goal.md 进入语料）", "      if (rel === \"\" && skipTopLevelFiles) continue;", "      if (false) continue;"],
	[LIB, "语料解析不复用（每次重新 parse）", "  const byFingerprint = PARSED_CORPUS_CACHE.get(dir);", "  const byFingerprint = undefined;"],
	[LIB, "token 集不复用（每次重新切词）", "  let entry = TOKEN_CACHE.get(candidate);", "  let entry = undefined;"],
	[HM, "preflight 少跑一次探针（有效消息不验）", "      const allowed = invokeHook(hook, [valid], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: preflightIndex });", "      const allowed = Promise.resolve({ code: 0, stdout: \"\", stderr: \"\" });"],
	[GGR, "git 只读查询不去重（一次门禁内重复 spawn）", "  const memo = GIT_READ_CACHE.get(cacheKey);", "  const memo = undefined;"],
	[WM, "内容指纹混入 mtime（一次 touch 就回收）", "          hash.update(`${file}\\0${content.length}\\0`);", "          hash.update(`${file}\\0${content.length}\\0${(await fs.promises.stat(file)).mtimeMs}\\0`);"],
	[WM, "回收后不自愈（kill 完不重拉）", "      await ensureReady();\n      if (logger) logger.info(\"[dsh-ldvh web-api] replacement child ready on port %s\", port);", "      if (logger) logger.info(\"[dsh-ldvh web-api] replacement child ready on port %s\", port);"],
	[GB, "超预算不再拒绝（引导可无限增长）", "  if (length > budget) {", "  if (false && length > budget) {"],
	[GB, "预警带判据恒真（逼近上限无人知）", "  return length <= budget * GUIDANCE_EARLY_WARNING_RATIO;", "  return true;"],
	[GB, "漂移判据恒不漂移（记录值形同虚设）", "  return { drifted: delta !== 0, measured, recorded, delta };", "  return { drifted: false, measured, recorded, delta };"],
	[WM, "回收期间的改动不挂起（in-flight 差异被吞）", "            pendingFingerprint = next;\n            void scheduleRecheck();", "            void 0;"],
	[LIB, "常驻段被整段跳过（事实规范段缺失）", "export const L0_SEGMENT_ORDER = Object.freeze([\"norm\"]);", "export const L0_SEGMENT_ORDER = Object.freeze([]);"],
	[LIB, "经验被悄悄加回常驻段（应按需，34 §8.4 2026-11-11）", "export const L0_SEGMENT_ORDER = Object.freeze([\"norm\"]);", "export const L0_SEGMENT_ORDER = Object.freeze([\"norm\", \"pitfall\"]);"],
	[INJ, "L0 让位不留痕迹（静默消失）", "    yieldNoteEmitted = true;\n    const suffix = yieldHintOf({ l0: true });", "    yieldNoteEmitted = true;\n    const suffix = \"\";"],
	[CWG, "在途判定恒允许（他人改动被覆盖）", "  if (current !== last) {", "  if (false) {"],
	[CWG, "首次接触被判为冲突（守卫变成停机装置）", "  if (last === null) return { ok: true, ownsWrite: true };", "  if (last === null) return { ok: false, code: \"concurrent-write/detected\", reason: \"x\" };"],
	[CWG, "文件消失与内容被改写混同", "  if (current === null) {", "  if (false) {"],
	[MC, "报告行只报条数（去掉分母）", "`变异覆盖：${mutationCount} 条变异触及 ${coveredModules.length}/${libs.length} 个 lib 模块`", "`变异覆盖：${mutationCount} 条变异`"],
	[MC, "缺口数恒报 0（看不见缺口）", "withOwnTestButNoMutation.length} 个模块有专用用例但零变异", "0} 个模块有专用用例但零变异"],
	[MC, "分子恒等于分母（冒充全覆盖）", "const coveredModules = libs.filter((name) => mutationsByModule[name] !== undefined);", "const coveredModules = libs.slice();"],
	[MC, "空清单静默成 0/0（分母一起清空）", "const libs = [...new Set(", "const libs = mutations.length === 0 ? [] : [...new Set("],
	[CWG, "还原侧另立一份实现（两侧口径分叉）", "export const decideMutationRestore = decideMutationWrite;", "export const decideMutationRestore = (x) => ({ ok: true, ownsWrite: true, ...x });"],
	[TRR, "skip 超基线不标失败码（处置提示分流失效）", '\t\t\t\tcode: "skip_above_baseline",', ""],
	[TRR, "skip 超基线放行（守卫失效）", "\t\tif (skipped > skippedBaseline) {", "\t\tif (false) {"],
];

async function classifyRun() {
	try {
		const r = await run("node", ["--test", ...TESTS], { cwd: PLUGIN, maxBuffer: 64 * 1024 * 1024 });
		return classifyTestRun({ stdout: r.stdout, stderr: r.stderr });
	} catch (e) {
		return classifyTestRun({ stdout: e.stdout, stderr: e.stderr, error: e });
	}
}


const LOCK_FILE = join(
  tmpdir(),
  `ldvh-mutation-check-${createHash("sha256").update(PLUGIN).digest("hex").slice(0, 16)}.lock`,
);
let lockHandle = null;
try {
  lockHandle = await open(LOCK_FILE, "wx");
  await lockHandle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");
} catch (error) {
  if (error?.code === "EEXIST") {
    console.error(
      `!! 同目录已有变异检查实例在跑（锁文件 ${LOCK_FILE}）——本次不跑、不覆盖、不裁决。`
      + `\n   请先确认那个实例是否仍在运行（ps），待其退出后再重跑。`,
    );
    process.exit(3);
  }
  throw error;
}
const releaseLock = () => {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
  }
};
process.on("exit", releaseLock);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    releaseLock();
    process.exit(130);
  });
}

const mutatedFiles = [...new Set(MUTATIONS.map(([f]) => f))];

const baselineOf = new Map();

const writtenByUs = new Map();

async function currentContentOf(file) {
	try {
		return await readFile(file, "utf8");
	} catch (e) {
		if (e?.code === "ENOENT") return null;
		throw e;
	}
}

const rows = [];
const concurrentTouched = new Set();
try {
	const baselineRun = await classifyRun();
	const baselineFailed = baselineRun.terminal === RUN_TERMINAL.NOT_RUN
		|| baselineRun.terminal === RUN_TERMINAL.COUNT_UNAVAILABLE
		? null
		: baselineRun.failed;
	console.log(
		`无变异基线：${baselineFailed === null ? "计数不可得（本次所有变异的判定降级为不可用）" : `${baselineFailed} 条失败`}`,
	);
	for (const [file, name, from, to] of MUTATIONS) {
		const current = await currentContentOf(file);
		const last = writtenByUs.get(file);
		if (last === undefined) {
			baselineOf.set(file, current);
		} else if (!decideMutationWrite({ currentContent: current, lastWrittenContent: last }).ok) {
			concurrentTouched.add(file);
			rows.push([name, "**在途改动**", 0, `跳过：${file} 在本次运行期间被其它会话改写，不覆盖、不裁决`]);
			continue;
		}
		const base = baselineOf.get(file);
		if (base === null) {
			rows.push([name, "**未运行**", 0, `跳过：${file} 不存在`]);
			continue;
		}
		if (!base.includes(from)) {
			rows.push([name, "**锚点失效**", 0]);
			continue;
		}
		const mutated = base.replace(from, to);
		await writeFile(file, mutated, "utf8");
		writtenByUs.set(file, mutated);
		const runReport = await classifyRun();
		if (runReport.terminal === RUN_TERMINAL.NOT_RUN) {
			rows.push([name, "**未运行**", 0, runReport.evidence]);
		} else if (runReport.terminal === RUN_TERMINAL.COUNT_UNAVAILABLE) {
			rows.push([name, "**计数不可得**", 0, runReport.evidence]);
		} else if (baselineFailed === null) {
			rows.push([name, "**基线不可得**", 0, runReport.evidence]);
		} else {
			const added = runReport.failed - baselineFailed;
			rows.push([
				name,
				added > 0 ? "被抓住" : "**存活**",
				added > 0 ? added : runReport.failed,
				runReport.evidence,
			]);
		}
	}
} finally {
	for (const file of mutatedFiles) {
		const ours = writtenByUs.get(file);
		if (ours === undefined) continue;
		const now = await currentContentOf(file);
		if (!decideMutationRestore({ currentContent: now, lastWrittenContent: ours }).ok) {
			console.error(`!! 未还原：${file} 在本次运行期间被其它会话改写——保留磁盘上的版本，请人工核对（本脚本不覆盖他人改动）`);
			concurrentTouched.add(file);
			continue;
		}
		const baseline = baselineOf.get(file);
		await writeFile(file, baseline, "utf8");
		if ((await currentContentOf(file)) !== baseline) console.error(`!! 还原失败：${file}`);
	}
}

const survived = rows.filter(([, s]) => s === "**存活**");
const staleAnchor = rows.filter(([, s]) => s === "**锚点失效**");
const notRun = rows.filter(([, s]) => s === "**未运行**" || s === "**计数不可得**");
const noBaseline = rows.filter(([, s]) => s === "**基线不可得**");
const caught = rows.filter(([, s]) => s === "被抓住");
for (const [n, s, f, ev] of rows) console.log(`  ${s.padEnd(8)} ${n}${f ? `  (${f} 处失败)` : ""}${ev ? `  ← ${ev}` : ""}`);
const judged = caught.length + survived.length;
console.log(`\n${caught.length}/${judged} 被抓住（差分判定：只有因本条变异新增的失败才算被抓住）`);
if (notRun.length > 0 || staleAnchor.length > 0 || noBaseline.length > 0) {
	console.log(
		`不可用终态 ${notRun.length + staleAnchor.length + noBaseline.length} 条`
		+ `（未运行/计数不可得 ${notRun.length}、锚点失效 ${staleAnchor.length}、基线不可得 ${noBaseline.length}）`
		+ `——它们不是「没抓住」，是「这次没测出结论」`,
	);
}

{
	const { readdir } = await import("node:fs/promises");
	const coverage = summarizeMutationCoverage({
		mutations: MUTATIONS,
		libModules: await readdir(join(PLUGIN, "lib")),
		testModules: await readdir(join(PLUGIN, "test")),
	});
	console.log(`\n${coverage.summaryLine}`);
	console.log(
		"（覆盖口径只暴露缺口，不主张守护有效：「被变异触及」≠「该模块守护有效」，"
		+ "「有专用用例文件」≠「该模块被有效守护」。）",
	);
}
if (survived.length > 0) {
	console.log("\n存活项需人工看：可能是该行为由别处承担，也可能是缺守护。");
	process.exitCode = 1;
}
if (staleAnchor.length > 0) {
	console.log("\n锚点失效项：源码已改写而变异锚点未同步——该行为当前**无变异级守护**，须更新锚点。");
	process.exitCode = 1;
}
if (notRun.length > 0) {
	console.log(
		`\n${notRun.length} 项**无可用判定**（未运行或计数不可得）：本次整批结论不可用，` +
			`不得据以声称「已全部被抓住」或「存在 N 项存活」。先查运行环境再重跑。`,
	);
	process.exitCode = 1;
}
if (concurrentTouched.size > 0) {
	console.log(
		`\n${concurrentTouched.size} 个文件在本次运行期间被其它会话改写（${[...concurrentTouched].join("、")}）：` +
			`涉及它们的变异记为**在途改动**、不覆盖不裁决。等并行会话的改动落定后重跑。`,
	);
	process.exitCode = 1;
}
