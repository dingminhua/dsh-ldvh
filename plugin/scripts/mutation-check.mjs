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
const HM = join(PLUGIN, "lib", "hook-manager.js");
const GGR = join(PLUGIN, "lib", "git-gate-runner.js");
const WM = join(PLUGIN, "lib", "web-mount.js");
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
	// 2026-10-31：preflight 并行化与 git 只读查询去重的守护在这里。
	"test/preflight-cost.test.mjs",
	// 2026-10-31：web-mount 的等待时长改为可注入之后，这些用例守护的是
	// **同一批不变量**（mtime 不进指纹、回收后自愈、in-flight 改动不被吞），
	// 只是把绝对时长按比例缩放。它们必须进变异检查——否则「缩放到用例不再
	// 守任何东西」这件事不会有任何东西发现（实测踩过：改写后的 in-flight
	// 用例对 pendingFingerprint 变异失去检测力）。
	"test/web-mount.test.mjs",
];

const MUTATIONS = [
	[LIB, "弱命中不排后", "Number(a.weakHit === true) - Number(b.weakHit === true) ||", "0 ||"],
	[LIB, "中间产物白名单失效", "if (!REGISTERED_FACT_TYPES.includes(c.type)) return false;", ""],
	// 「必需类型优先」由 `typeRank` 承担（`rank` 死代码已删——见 compareFactHits 注释）。
	// 故本变异改钉**真正生效的那一级**：把 ADR 降为末位，
	// 「ADR/Pitfall 优先」的性质必须转红。
	[LIB, "ADR/Pitfall 不优先（typeRank 降级）", "  adr: 0,\n  norm: 1,\n  pitfall: 2,\n  friction: 3,", "  adr: 4,\n  norm: 1,\n  pitfall: 2,\n  friction: 3,"],
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
	[INJ, "零命中时基线被短路（退回词面运气）", "  if (!decideInjection({ candidateCount: total, baselinePresent: baselineHasContent })) {", "  if (!decideInjection({ candidateCount: total, baselinePresent: false })) {"],
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
	// —— 语料 token 缓存（2026-10-31 加）——
	//
	// 这组变异守护的是**缓存的正确性**：缓存必须既不改变结果、也不返回陈旧读。
	// 每条对应一个「缓存写错了会怎样」的具体失效形态——
	// 若某条存活，说明该失效形态**当前无守护**（不是「没关系」）。
	//
	// ① 缓存键不含内容（语料改了仍命中旧解析）→ 「语料内容改变后须读到新内容」
	//    用例必须转红。
	[LIB, "语料缓存键不含内容（改动后仍返陈旧解析）", "    fingerprint = await corpusFingerprintOf(files.map((entry) => entry.path));", "    fingerprint = \"fixed-key\";"],
	// ② 缓存不按新增文件换键 → 「新增载体后须被纳入」必须转红。
	[LIB, "语料缓存键不含新增文件", "  const sorted = [...files].sort();", "  const sorted = [...files].slice(0, 1).sort();"],
	// ③ token 缓存退化为「每次重算」不应被抓住（那是性能问题不是正确性问题）——
	//    故**不做**该方向的变异；此处改钉「段内性」这条地基：
	//    若 tokenize 变成跨段拼接（把窄面/宽面并集算错），段内性用例必须转红。
	[LIB, "tokenize 跨段拼接（段内性失效）", "  const cjk = text.match(/[\\u4e00-\\u9fff]+/g) ?? [];", "  const cjk = [text];"],
	// ④ 窄面 token 集漏掉 body（口径错）→ 段内性与 df 口径用例须转红。
	[LIB, "窄面 token 集混入 body", "  const narrow = new Set([...scopeTokens, ...detailTokens, ...titleTokens]);", "  const narrow = new Set([...scopeTokens, ...detailTokens, ...titleTokens, ...bodyTokens]);"],
	// ⑤ 顶层文件混入事实语料 → 「事实源只取类型子目录」用例必须转红。
	[LIB, "事实源混入顶层文件（goal.md 进入语料）", "      if (rel === \"\" && skipTopLevelFiles) continue;", "      if (false) continue;"],
	// ⑥ 语料解析不复用（每次 parse 出新对象）→ 「二次加载须复用同一解析产物」
	//    必须转红。这是**本次性能优化被回退**的直接形态。
	//
	//    注意它与 ①（缓存键不含内容）守的是**不同性质**：① 守正确性
	//    （不得返回陈旧解析），⑥ 守复用性（不得退化为每次重算）。
	//    一条断言同时抓不住两者——实测 ① 恒定键下 ⑥ 的用例仍绿、⑥ 下 ① 的用例仍绿。
	[LIB, "语料解析不复用（每次重新 parse）", "  const byFingerprint = PARSED_CORPUS_CACHE.get(dir);", "  const byFingerprint = undefined;"],
	// ⑦ token 集不复用（每次重新切词）→ 「同一候选二次取用须复用同一结果」
	//    必须转红。这是「同一份正文被切 6 遍」这一原始根因回潮的形态。
	[LIB, "token 集不复用（每次重新切词）", "  let entry = TOKEN_CACHE.get(candidate);", "  let entry = undefined;"],
	// —— preflight 成本优化（2026-10-31 加）——
	//
	// 这两条守的不是「快不快」，而是**优化不得退化成少证明**：
	// ① 把四次探针减成三次（「有效消息反正会过，跳过它」）必须转红；
	// ② 把 git 只读查询的 memo 关掉（回到一次门禁内重复三次 ls-files）
	//    必须转红。两者的判据都是确定性的调用计数，不是耗时阈值
	//    （耗时阈值属 Human Gate：06 §9.1 第 5 项 / 34 §17 第 9 项）。
	[HM, "preflight 少跑一次探针（有效消息不验）", "      const allowed = invokeHook(hook, [valid], identity.projectRoot, { ...hookEnv, LDVH_PREFLIGHT_INDEX: preflightIndex });", "      const allowed = Promise.resolve({ code: 0, stdout: \"\", stderr: \"\" });"],
	[GGR, "git 只读查询不去重（一次门禁内重复 spawn）", "  const memo = GIT_READ_CACHE.get(cacheKey);", "  const memo = undefined;"],
	// —— web-mount 热刷新（2026-10-31 加）——
	//
	// 这组的来历是本轮的一次真实失误：把等待时长做成可注入参数后，我按比例缩减
	// 了用例里的 sleep，其中 in-flight 竞态用例的检测力**悄悄归零**——把
	// pendingFingerprint 那两行删掉它照样绿（未缩放的版本上同一变异转红）。
	// 成因是改写后「等常数毫秒」与子进程读盘的时机重叠，子进程直接读到 v3，
	// 于是「最终跑 v3」不依赖 recheck 也成立。已改为观察 bootFile 再写 v3。
	// 这三条变异即该缺口的守门人。
	//
	// ① mtime 混进内容指纹 → 「mtime-only touch」必须转红（原实现的缺陷形态）。
	[WM, "内容指纹混入 mtime（一次 touch 就回收）", "          hash.update(`${file}\\0${content.length}\\0`);", "          hash.update(`${file}\\0${content.length}\\0${(await fs.promises.stat(file)).mtimeMs}\\0`);"],
	// ② 回收后不重拉（自愈失效，原缺陷）→ 「source recycle self-heals」必须转红。
	[WM, "回收后不自愈（kill 完不重拉）", "      await ensureReady();\n      if (logger) logger.info(\"[dsh-ldvh web-api] replacement child ready on port %s\", port);", "      if (logger) logger.info(\"[dsh-ldvh web-api] replacement child ready on port %s\", port);"],
	// ③ 不记录挂起的差异 → 「a change landing during an in-flight recycle」
	//    必须转红。这条最容易被「缩放后仍然绿」掩盖，也正是 ② 抓不住的那一类：
	//    ② 守「回收后有没有重拉」，③ 守「回收期间落的改动有没有被记住」。
	[WM, "回收期间的改动不挂起（in-flight 差异被吞）", "            pendingFingerprint = next;\n            void scheduleRecheck();", "            void 0;"],
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
