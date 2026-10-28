// **变异测试**：对召回模块做定点破坏，检验测试是否真有守护力。
//
// ## 为什么需要它（2026-10-24，第 65 轮）
//
// 「测试通过」与「测试有效」是两件事。只有**故意改坏代码时它会失败**，才叫有守护力。
// 本轮用这个方法立刻发现：`positioning` 那条断言是**空的**——`positioning` 只作为
// 返回字段存在、不参与匹配面，故无论 frontmatter 剥离是否有效，它都是 0 命中。
// 换成 `spec_kind`（正文 0 篇、全文 27 篇）之后才有分辨力。
//
// ## 用法
//
//     node scripts/mutation-check.mjs
//
// 每项输出「被抓住」（有测试失败，好）或「**存活**」（无测试失败，该行为缺守护）。
// 存活项**未必都是缺陷**：也可能是该行为由别处承担、或当前无测试覆盖但影响可控。
// 但每一处存活都值得看一眼。
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTestRun, RUN_TERMINAL } from "../lib/test-run-report.js";

const run = promisify(execFile);
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(PLUGIN, "lib", "source-recall.js");
const INJ = join(PLUGIN, "lib", "recall-injection.js");
const GUID = join(PLUGIN, "lib", "guidance.js");
const LIFE = join(PLUGIN, "lib", "lifecycle.js");
const TESTS = [
	"test/source-recall.test.mjs",
	"test/recall-injection.test.mjs",
	"test/recall-integration.test.mjs",
	"test/recall-real-activation.test.mjs",
	// **新代码的守护必须随代码增长**（第四十一次审核 Major-3）：此前这份列表
	// 只有四个文件，而 `test/injection-budget.test.mjs`（预算档位）与
	// `test/lifecycle.test.mjs`（接线）从未参与变异检查——于是「24/24 被抓住」
	// 只覆盖了旧代码，新功能的变异根本不会被发现。
	"test/injection-budget.test.mjs",
	"test/lifecycle.test.mjs",
];

const MUTATIONS = [
	[LIB, "弱命中不排后", "Number(a.weakHit === true) - Number(b.weakHit === true) ||", "0 ||"],
	[LIB, "中间产物白名单失效", "if (!REGISTERED_FACT_TYPES.includes(c.type)) return false;", ""],
	[LIB, "ADR/Pitfall 不优先", "const rank = (x) => (REQUIRED_RECALL_TYPES.includes(x.fact.type) ? 0 : 1);", "const rank = () => 0;"],
	[LIB, "按类型默认状态失效", 'const allowed = explicitStatuses ?? DEFAULT_STATUSES_BY_TYPE[type] ?? ["active"];', 'const allowed = ["active"];'],
	[LIB, "F2 摘录为空", "excerpt: excerptOf(c.excerptSource) || c.title,", 'excerpt: "",'],
	[LIB, "F0 层缺失", "      countsByTypeStatus: facts.reduce((acc, fact) => {", "      countsByTypeStatusX: facts.reduce((acc, fact) => {"],
	[LIB, "gaps 缺失", "    gaps: [", "    gapsX: ["],
	[LIB, "uncheckedRange 缺失", "    uncheckedRange: {", "    uncheckedRangeX: {"],
	[LIB, "规范正文未剥离 frontmatter", '      bodyText: text.replace(/^---\\n[\\s\\S]*?\\n---\\n?/, ""),', "      bodyText: text,"],
	[LIB, "事实正文未剥离 frontmatter", '      const body = text.replace(/^---\\n[\\s\\S]*?\\n---\\n?/, "");', "      const body = text;"],
	[INJ, "截断归因只看事实侧（漏规范侧）", '      ((result.counts?.factHits ?? 0) > 0 && (result.counts?.factsReturned ?? 0) === 0) ||\n      ((result.counts?.specHits ?? 0) > 0 && (result.counts?.specsReturned ?? 0) === 0);', '      (result.counts?.factHits ?? 0) > 0 && (result.counts?.factsReturned ?? 0) === 0;'],
	[INJ, "渲染不标截断", "  const renderTruncated = droppedMatch !== null;", "  const renderTruncated = false;"],
	[INJ, "命中理由排到路径之后", "`- ${spec.title} — ${spec.hitReason}（${shown}）`", "`- ${spec.title}（${shown}）— ${spec.hitReason}`"],
	// —— 接线层（目标第(1)项「自动运行」的关键路径）——
	[GUID, "每步都注入（不只在 step 1）", "      if (payload.step !== 1) return decision;", "      // 破坏：每步都注入"],
	[GUID, "判定文本未就绪时连坐召回", '      const noticeReady = currentNotice !== null && currentNotice !== "";', '      const noticeReady = currentNotice !== null && currentNotice !== "";\n      if (!noticeReady) return decision;'],
	[GUID, "召回行刷新时覆盖错行", "const priorRecall = batch.find((m) => isRecallMessage(m, label));", "const priorRecall = batch[0];"],
	[LIFE, "召回不检查管辖状态", '          if (lifecycle.scopeState !== "governed") return { inject: false, reason: "not-governed" };', ""],
	[LIB, "候选缺 tier 语义说明", '        matchTierMeaning:\n          "匹配层（命中了哪个字段），非 F0–F4 事实分层、非 L0–L4 规范读取分层（02 §9.1）",', ""],
	[LIB, "预算不按源分配（事实恒饿死）", "const specBudget = bothSources ? Math.floor(usableBudget * 0.6) : usableBudget;", "const specBudget = usableBudget;"],
	[LIB, "排序无确定性兜底", "        a.path.localeCompare(b.path),", "        0,"],
	[LIB, "类型点名层失效", "        return { tier: 0.5, hits: 1, hitReason: `类型点名命中：${named}` };", "        return { tier: 9, hits: 1, hitReason: `x` };"],
	[LIFE, "召回头缺失 projectPath 兜底", '          if (typeof projectPath !== "string" || projectPath.length === 0) return { inject: false, reason: "no-project" };', ""],
	// —— F1 决策基线（22 §12 义务召回；2026-10-25 方案 A）——
	// 钉住本功能的**核心不变量**：基线必须无条件交付，不得被词法命中条件挡住。
	// 若把 baselineHasContent 恒为 false，就退回到「法定决策靠词面运气」——
	// 实测「每次回复先称呼老丁」在无关消息上零召回，正是该缺陷的现场。
	[INJ, "零命中时基线被短路（退回词面运气）", "  if (total < MIN_HITS && !baselineHasContent) {", "  if (total < MIN_HITS) {"],
		// **对准真实不变量**（第四十次审核 M-2）：数据层不为基线预留预算，
	// 于是预算按「只有候选」分配、实际注入时基线再挤进来——这正是
	// 「预留量须与实际基线段字节相符」用例要防的错配（欠预留会让注入超预算）。
	[LIB, "基线不预留预算（预算按无基线分配）", "    : Math.min(baselineFullBytes, baselineScaledCap);", "    : 0;"],
	// —— 召回面预算档位（第四十一次审核 Major-3：新代码零变异守护）——
	//
	// 锚点须对准**行为不变量**，不是「常量值等于某个数」（后者改常量就会误报）。
	[LIB, "档位表被改成无上限（任意数可填）", "  10: 10 * 1024,", "  10: Number.MAX_SAFE_INTEGER,"],
	[LIB, "未登记档位静默回落（不报错）", "    return {\n      ok: false,", "    return {\n      ok: true,"],
	[LIB, "默认档退回旧常量（数值偏小未解决）", "export const DEFAULT_INJECTION_BUDGET_TIER = 10;", "export const DEFAULT_INJECTION_BUDGET_TIER = 2;"],
];

/**
 * 跑一次变异体下的测试套件，按 `specs/06` §5 的三态归类（单一入口见
 * `lib/test-run-report.js`）。
 *
 * **此处曾返回 `m ? Number(m[1]) : 0`**——取不到计数就并入 0，于是「被测文件
 * 不存在、测试根本没跑」被读成「跑了且零失败」，本脚本随即报「存活」，
 * 把「该行为缺守护」与「这次没测」混成同一结论（pitfall-fa36d461 的原始失效点）。
 */
async function classifyRun() {
	try {
		const r = await run("node", ["--test", ...TESTS], { cwd: PLUGIN, maxBuffer: 64 * 1024 * 1024 });
		return classifyTestRun({ stdout: r.stdout, stderr: r.stderr });
	} catch (e) {
		return classifyTestRun({ stdout: e.stdout, stderr: e.stderr, error: e });
	}
}

const originals = new Map();
for (const file of new Set(MUTATIONS.map(([f]) => f))) originals.set(file, await readFile(file, "utf8"));

const rows = [];
try {
	for (const [file, name, from, to] of MUTATIONS) {
		const base = originals.get(file);
		if (!base.includes(from)) {
			// **锚点失效必须判失败**（2026-10-25，第八次复核 N-9）：此前把
			// 「锚点未找到」记为一种普通行、既不施加变异、也不影响退出码，
			// 且被汇总式 `rows.length - survived.length` 计入「被抓住」分子——
			// 源码改写后守护悄悄失效，覆盖率却虚高，正是本脚本要防的
			// 「测试通过 ≠ 测试有效」在元工具自身的复现。
			rows.push([name, "**锚点失效**", 0]);
			continue;
		}
		await writeFile(file, base, "utf8"); // 复位，防上一项污染
		await writeFile(file, base.replace(from, to), "utf8");
		const runReport = await classifyRun();
		// 三态分开记账：**不可用终态不得读作「存活」**——前者是「这次没测出结论」，
		// 后者是「测了，该行为缺守护」。合并会让一次运行故障伪装成守护健全（或反之）。
		if (runReport.terminal === RUN_TERMINAL.NOT_RUN) {
			rows.push([name, "**未运行**", 0, runReport.evidence]);
		} else if (runReport.terminal === RUN_TERMINAL.COUNT_UNAVAILABLE) {
			rows.push([name, "**计数不可得**", 0, runReport.evidence]);
		} else {
			rows.push([name, runReport.failed > 0 ? "被抓住" : "**存活**", runReport.failed, runReport.evidence]);
		}
	}
} finally {
	for (const [file, text] of originals) await writeFile(file, text, "utf8");
	// 还原后必须核验：若这里报错，说明脚本把源码改坏了。
	for (const [file, text] of originals) {
		if ((await readFile(file, "utf8")) !== text) console.error(`!! 还原失败：${file}`);
	}
}

const survived = rows.filter(([, s]) => s === "**存活**");
const staleAnchor = rows.filter(([, s]) => s === "**锚点失效**");
const notRun = rows.filter(([, s]) => s === "**未运行**" || s === "**计数不可得**");
const caught = rows.filter(([, s]) => s === "被抓住");
for (const [n, s, f, ev] of rows) console.log(`  ${s.padEnd(8)} ${n}${f ? `  (${f} 处失败)` : ""}${ev ? `  ← ${ev}` : ""}`);
console.log(`\n${caught.length}/${rows.length} 被抓住`);
if (survived.length > 0) {
	console.log("\n存活项需人工看：可能是该行为由别处承担，也可能是缺守护。");
	process.exitCode = 1;
}
if (staleAnchor.length > 0) {
	console.log("\n锚点失效项：源码已改写而变异锚点未同步——该行为当前**无变异级守护**，须更新锚点。");
	process.exitCode = 1;
}
if (notRun.length > 0) {
	// 06 §5 第 3 项：该终态须使**整批结论不可用**，不得以「存活／被抓住」收尾。
	console.log(
		`\n${notRun.length} 项**无可用判定**（未运行或计数不可得）：本次整批结论不可用，` +
			`不得据以声称「已全部被抓住」或「存在 N 项存活」。先查运行环境再重跑。`,
	);
	process.exitCode = 1;
}
