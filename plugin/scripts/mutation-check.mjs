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
//
// ## 判定口径：差分（2026-11-15 改订）
//
// 原口径是「套件里出现了失败 ⇒ 被抓住」。**它会把与本条变异无关的既有失败
// 算作守护**——实测：某两条变异在改动前的基线上各「被抓住 12 处」，差分测量
// 却为 **0**（那 12 处全是基线上本就失败的用例）。于是同一行为在两个基线上
// 得到两个相反的结论，而两个都不成立。
//
// 现口径：运行前先跑一次**无变异基线**；只有**因这条变异而新增**的失败才算
// 「被抓住」。基线自身的失败不归任何变异所有，如实单独报出。
//
// ## 存活项的两种成因（必须分开看）
//
// 1. **缺守护**：该行为确实没有测试守着——缺陷，须补用例。
// 2. **变异惰性**：该变异在当前实现下**不产生任何行为差异**，故没有测试会
//    转红——它测不到东西，不是守护丢失。判据是差分测量为 0。实测例：
//    `statusAllowed` 里「non-candidate 直接 return false」那行——非候选类型的
//    `statuses` 恒为空数组，删掉该短路后落到 `statuses.includes(status)` 仍是
//    false，故该行是冗余的（真实判定在 `recallStatusPolicyOf` 里）。
//    本仓处置：把锚点改钉到真正承载判定的分支（见该变异处的注释）。
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
	// 2026-11-03：引导体量守卫（friction-f9a66474 的处置）。此前引导面的
	// 预算判据**不在**本清单里，故「超预算不拒绝」「预警带恒真」这类破坏
	// 从来不会被本脚本发现。
	"test/guidance-budget.test.mjs",
	// 2026-11-04：在途改动守卫（friction-68e6f33e／451c4a7d 的处置）。该模块守护的
	// 是 mutation-check **自身**不得覆盖并行会话的在途改动；若它不在清单里，
	// 「判据恒返回允许」这类破坏永远不会被发现——而那正是本账目的原始失效形态。
	"test/concurrent-write-guard.test.mjs",
	// 2026-11-04：变异覆盖口径本身（friction-5c5b6261 的处置）。该模块把「触及
	// 几个模块／总共几个模块」变成可读的数；若它自己不在清单里，「报告行只报条数」
	// 「缺口数恒报 0」这类**恰好抹平缺口**的破坏永远不会被发现——那正是本账目的
	// 原始失效形态在元层重演。
	"test/mutation-coverage.test.mjs",
	// 2026-11-15：默认候选状态取自判据表这一层的守卫（`recallStatusPolicyOf`）。
	// **此前它不在清单里**——而判据表的「不采用」「表里没有该类型条目」「表坏了」
	// 三种形态各有精确用例守着（就在该文件里），只是本脚本看不见它们：于是
	// 「按类型默认状态失效」「兜底回落被静默」两条变异长期报「存活」；而在
	// **改动前**的基线上它们又因同一批用例**本已失败**（与变异无关）而被误判为
	// 「被抓住」。两重错位同源于一件事：变异清单没覆盖到真正的守护所在处。
	// 守护随代码增长，变异清单也必须随守护增长。
	"test/recall-type-channels.test.mjs",
];

const MUTATIONS = [
	[LIB, "弱命中不排后", "Number(a.weakHit === true) - Number(b.weakHit === true) ||", "0 ||"],
	[LIB, "中间产物白名单失效", "if (!REGISTERED_FACT_TYPES.includes(c.type)) return false;", ""],
	// **类型轴已删**（2026-10-31 Human 裁定，见 `compareFactHits` 注释）：
	// 原「ADR/Pitfall 优先（typeRank 降级）」锚点随常量一起删除，改钉**删除后的
	// 替代不变量**——候选名次只由证据决定，tier 必须先于 hits。若把 hits 提到
	// tier 之前，「结构命中先于正文命中」的性质必须转红。
	[LIB, "证据次序失效（hits 压过 tier）", "    num(fa.tier) - num(fb.tier) ||\n    num(fb.hits) - num(fa.hits);", "    num(fb.hits) - num(fa.hits) ||\n    num(fa.tier) - num(fb.tier);"],
	// **锚点随 2026-11 的「默认候选状态改读判据表」更新**（02 §12.4）：
	// 原锚点在 `statusAllowed` 的硬编码表取值行上，该行已改为经
	// `recallStatusPolicyOf` 取判据表值。
	//
	// **2026-11-15 再改锚点**：原锚点（`statusAllowed` 里那行
	// `if (policy.kind === "non-candidate") return false;`）经实测是**结构性惰性**
	// 的——`recallStatusPolicyOf` 对 non-candidate 类型恒返回 `statuses: []`，
	// 故删掉该短路后落到 `policy.statuses.includes(status)` 仍是 false，行为不变，
	// 差分测量为 0（详见本文件头「存活项的两种成因」）。改钉到**真正承载该判定
	// 的分支**：`recallStatusPolicyOf` 里认「不采用」的那一行。变异后标「不采用」
	// 的类型会落到回落分支（拿到 `DEFAULT_STATUSES_BY_TYPE` 的 active），于是它
	// 会被当普通候选放进池里——该不变量由 `recall-type-channels.test.mjs` 的
	// 「不采用」用例守护（实测转红）。
	[LIB, "按类型默认状态失效", '    if (entry.values?.notApplicable?.["默认候选状态"] === true) {', '    if (false) {'],
	// **回落路径不得被静默**（02 §12.4 禁「静默回落」）：把 fallback 判成 table，
	// 兜底就变成「看起来像正常读表」，`criteria.fallbackTypes` 与 gaps 两处披露
	// 同时消失。守护用例：`recall-type-channels.test.mjs` 的 fallback 用例。
	// **2026-11-11 更新缩进**：源码该段由并行会话重排（`return { kind: "table" }`
	// 拆成多行、外层补 `if (entry !== null) {...}` 包裹），缩进由 2 空格变 4 空格，
	// 锚点的 `from` 因此不再匹配。改的是**空白形态**，被守护的语义未变：
	// 「解析失败时不得冒充 table」。故按新缩进重写 `from` 与 `to`，不删这条变异。
	[LIB, "兜底回落被静默（冒充正常读表）", '    kind: parseFailed ? "disabled" : "fallback",', '    kind: "table",'],
	[LIB, "F2 摘录为空", "excerpt: excerptOf(c.excerptSource) || c.title,", 'excerpt: "",'],
	[LIB, "F0 层缺失", "      countsByTypeStatus: facts.reduce((acc, fact) => {", "      countsByTypeStatusX: facts.reduce((acc, fact) => {"],
	[LIB, "gaps 缺失", "    gaps: [", "    gapsX: ["],
	[LIB, "uncheckedRange 缺失", "    uncheckedRange: {", "    uncheckedRangeX: {"],
	[LIB, "规范正文未剥离 frontmatter", '      bodyText: text.replace(/^---\\n[\\s\\S]*?\\n---\\n?/, ""),', "      bodyText: text,"],
	[LIB, "事实正文未剥离 frontmatter", '      const body = text.replace(/^---\\n[\\s\\S]*?\\n---\\n?/, "");', "      const body = text;"],
	[INJ, "截断归因只看事实侧（漏规范侧）", '      ((result.counts?.factHits ?? 0) > 0 && (result.counts?.factsReturned ?? 0) === 0) ||\n      ((result.counts?.specHits ?? 0) > 0 && (result.counts?.specsReturned ?? 0) === 0);', '      (result.counts?.factHits ?? 0) > 0 && (result.counts?.factsReturned ?? 0) === 0;'],
	[INJ, "渲染不标截断", "  const renderTruncated = droppedMatch !== null;", "  const renderTruncated = false;"],
	[INJ, "命中理由排到路径之后", "`- ${spec.title} — ${spec.hitReason}（${shown}${stable}）`", "`- ${spec.title}（${shown}${stable}）— ${spec.hitReason}`"],
	// —— 接线层（目标第(1)项「自动运行」的关键路径）——
	[GUID, "每步都注入（不只在 step 1）", "      if (payload.step !== 1) return decision;", "      // 破坏：每步都注入"],
	// 2026-11-13：`noticeReady` 增加了 `&& !suppressRow`（方案 A：不受辖时不注入
	// 可见判定行），故 from 片段随之演进。**变异的语义不变**：既去掉静默条件，
	// 也仍保留「判定未就绪就连坐召回」这一破坏形态——后者才是本锚点要抓的东西。
	[GUID, "判定文本未就绪时连坐召回", '      const noticeReady = currentNotice !== null && currentNotice !== "" && !suppressRow;', '      const noticeReady = currentNotice !== null && currentNotice !== "";\n      if (!noticeReady) return decision;'],
	[GUID, "召回行刷新时覆盖错行", "const priorRecall = batch.find((m) => isRecallMessage(m, label));", "const priorRecall = batch[0];"],
	[LIFE, "召回不检查管辖状态", '          if (lifecycle.scopeState !== "governed") return { inject: false, reason: "not-governed" };', ""],
	[LIB, "候选缺 tier 语义说明", '        matchTierMeaning:\n          "匹配层（命中了哪个字段），非 F0–F4 事实分层、非 L0–L4 规范读取分层（02 §9.1）",', ""],
	[LIB, "预算不按源分配（事实恒饿死）", "const specBudget = bothSources ? Math.floor(usableBudget * 0.6) : usableBudget;", "const specBudget = usableBudget;"],
	[LIB, "排序无确定性兜底", "        a.path.localeCompare(b.path),", "        0,"],
	[LIB, "类型点名层失效", "        return { tier: 0.5, hits: 1, hitReason: `类型点名命中：${named}` };", "        return { tier: 9, hits: 1, hitReason: `x` };"],
	[LIFE, "召回头缺失 projectPath 兜底", '          if (typeof projectPath !== "string" || projectPath.length === 0) return { inject: false, reason: "no-project" };', ""],
	// —— F1 决策基线与常驻索引（22 §12／27 §10 义务召回；2026-10-25 方案 A，
	//    2026-11-15 扩到常驻索引段）——
	// 钉住本功能的**核心不变量**：义务披露不得被词法命中条件挡住。
	// ① 把 baselinePresent 写死 false → 退回「法定决策靠词面运气」（实测
	//    「每次回复先称呼老丁」在无关消息上零召回，正是该缺陷的现场）。
	[INJ, "零命中时基线被短路（退回词面运气）", "  if (!decideInjection({\n    candidateCount: total,\n    baselinePresent: baselineHasContent,\n    residentIndexPresent: residentIndexHasContent,\n  })) {", "  if (!decideInjection({\n    candidateCount: total,\n    baselinePresent: false,\n    residentIndexPresent: residentIndexHasContent,\n  })) {"],
	// ② 把 residentIndexPresent 写死 false → 2026-11-15 修的那个缺陷复活：本仓
	//    ADR 已全数 retired（baselinePresent 恒假），于是「5 条 active Norm + 零词法
	//    命中」的回合整行不注入，而零命中正是常驻索引最该兜底的场景（词面不重合）。
	//    由「常驻索引判据」正反控制用例与 B1 回归用例抓住。
	[INJ, "零命中时常驻索引段被短路（Norm 段随词法运气缺席）", "  if (!decideInjection({\n    candidateCount: total,\n    baselinePresent: baselineHasContent,\n    residentIndexPresent: residentIndexHasContent,\n  })) {", "  if (!decideInjection({\n    candidateCount: total,\n    baselinePresent: baselineHasContent,\n    residentIndexPresent: false,\n  })) {"],
	// ③ 把「经验计数 >0」放宽成「为整数即可」→ 空事实源的零命中行动回合也无条件
	//    注入（实测整块内容里只有「本项目当前无 active 经验（0 条）」一行）。那是
	//    「本类为空」的披露，不是可消费材料；放宽即违反 02 §9.2 不建立无条件注入。
	[INJ, "经验计数为 0 也算常驻内容（空事实源无条件注入）", "  const pitfallPresent = Number.isInteger(l0Enumeration?.pitfallTotal) && l0Enumeration.pitfallTotal > 0;", "  const pitfallPresent = Number.isInteger(l0Enumeration?.pitfallTotal);"],
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
	// —— 引导体量守卫（2026-11-03 加，friction-f9a66474 的处置）——
	//
	// 这三条守的是「引导可以无限增长而无人发现」这件事不再成立：
	// ① 超预算不再拒绝（注入继续）→ 「超预算时拒绝而非截断」必须转红；
	// ② 预警带判据恒真（永远不带内/永远带内）→ 预警带用例必须转红；
	// ③ 漂移判据恒不漂移（记录值形同虚设）→ 漂移报警用例必须转红。
	[GB, "超预算不再拒绝（引导可无限增长）", "  if (length > budget) {", "  if (false && length > budget) {"],
	[GB, "预警带判据恒真（逼近上限无人知）", "  return length <= budget * GUIDANCE_EARLY_WARNING_RATIO;", "  return true;"],
	[GB, "漂移判据恒不漂移（记录值形同虚设）", "  return { drifted: delta !== 0, measured, recorded, delta };", "  return { drifted: false, measured, recorded, delta };"],
	[WM, "回收期间的改动不挂起（in-flight 差异被吞）", "            pendingFingerprint = next;\n            void scheduleRecheck();", "            void 0;"],
	// —— 三段 L0 常驻枚举（2026-11-04 加，Human 决定：ADR／事实规范／经验必须注入）——
	//
	// 这组守的是**「三段的可见性不依赖当回合用词」**这件事。每一条对应一种
	// 「实现看着还在、但某一段其实列不出来」的失效形态：
	// ① 只枚举 ADR 后两段被跳过 → 「单纯读取回合也须带出三段」必须转红；
	// ② 装填次序颠倒（经验先于事实规范）→ 「次序须为 ADR → 事实规范 → 经验」必须转红；
	// ③ 让位时整段静默消失（不留痕迹）→ 「逐段让位须留痕迹」必须转红。
	// **2026-11-11 改订**：经验已移出常驻段（`34 §8.4` 重订），原两条变异的
	// `from` 片段随之失效。这里按新结构重写，并保留它们原本要守护的两件事：
	//   · 「事实规范段不得被漏掉」——仍以 `norm` 为对象；
	//   · 「经验不得被悄悄加回常驻段」——旧版守的是次序颠倒，新版直接守「不含 pitfall」，
	//     因为按需化之后，把 pitfall 加回 `L0_SEGMENT_ORDER` 才是真正的回归。
	[LIB, "L0 只枚举 ADR（事实规范段缺失）", "export const L0_SEGMENT_ORDER = Object.freeze([\"adr\", \"norm\"]);", "export const L0_SEGMENT_ORDER = Object.freeze([\"adr\"]);"],
	[LIB, "经验被悄悄加回常驻段（应按需，34 §8.4 2026-11-11）", "export const L0_SEGMENT_ORDER = Object.freeze([\"adr\", \"norm\"]);", "export const L0_SEGMENT_ORDER = Object.freeze([\"adr\", \"norm\", \"pitfall\"]);"],
	[INJ, "L0 让位不留痕迹（静默消失）", "    if ((!hasBaseline && !hasL0) || yieldNoteEmitted) return text;", "    if ((!hasBaseline && !hasL0) || yieldNoteEmitted) return text;\n    if (hasL0) return text;"],
	// —— 在途改动守卫（2026-11-04 加，friction-68e6f33e／451c4a7d 的处置）——
	//
	// 这组守的是「判据不得恒真」——两个方向的恒真都对应一种真实的覆盖形态：
	// ① 恒允许写 → 他人改动被无条件覆盖（回到原缺陷）；
	// ② 恒拒绝写 → 首次接触被误判为冲突，整个脚本一跑就全是在途改动
	//    （守卫变成停机装置）。正向用例（首次接触须允许）专门守 ②。
	[CWG, "在途判定恒允许（他人改动被覆盖）", "  if (current !== last) {", "  if (false) {"],
	[CWG, "首次接触被判为冲突（守卫变成停机装置）", "  if (last === null) return { ok: true, ownsWrite: true };", "  if (last === null) return { ok: false, code: \"concurrent-write/detected\", reason: \"x\" };"],
	[CWG, "文件消失与内容被改写混同", "  if (current === null) {", "  if (false) {"],
	// —— 变异覆盖口径（2026-11-04，friction-5c5b6261）——
	//
	// 这组守的不是「覆盖率够不够」（那是 Human 的判断），而是**缺口能不能被看见**：
	// 报告行的分子分母、缺口数是否被抹平、空清单会不会静默成 0/0。
	[MC, "报告行只报条数（去掉分母）", "`变异覆盖：${mutationCount} 条变异触及 ${coveredModules.length}/${libs.length} 个 lib 模块`", "`变异覆盖：${mutationCount} 条变异`"],
	[MC, "缺口数恒报 0（看不见缺口）", "withOwnTestButNoMutation.length} 个模块有专用用例但零变异", "0} 个模块有专用用例但零变异"],
	[MC, "分子恒等于分母（冒充全覆盖）", "const coveredModules = libs.filter((name) => mutationsByModule[name] !== undefined);", "const coveredModules = libs.slice();"],
	// 空清单若被算成 0/0，读作「没有问题」；实际是「一条都没测」。这条让分母在
	// 无变异时一起清空——正是那种静默。锚点取分母计算行的一段**可精确引用**的
	// 片段（不含引号，避免转义形态在源码里对不上；实测过带引号的写法会锚点失配，
	// 被记为「锚点失效」而污染结论）。
	[MC, "空清单静默成 0/0（分母一起清空）", "const libs = [...new Set(", "const libs = mutations.length === 0 ? [] : [...new Set("],
	[CWG, "还原侧另立一份实现（两侧口径分叉）", "export const decideMutationRestore = decideMutationWrite;", "export const decideMutationRestore = (x) => ({ ok: true, ownsWrite: true, ...x });"],
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

// ---------------------------------------------------------------------------
// 在途改动守卫（2026-11-04，处置 friction-68e6f33e / friction-451c4a7d）
//
// ## 缺陷：快照 + 无条件还原 = 静默丢弃他人在途改动
//
// 本脚本对每个受变异文件在**启动时**读一次快照（`originals`），每施加一条变异前
// 先写回这份快照「复位」，全部跑完再无条件按快照还原。三个阶段都假定「磁盘上的
// 这份文件自本脚本启动起只由本脚本改动」——而本仓 dev 是多代理共享的同一工作树，
// 并行会话（或用户本人）会在运行期间编辑同一批源码。
//
// 实测后果（friction-68e6f33e，count 15；friction-451c4a7d，count 6）：
// - 运行期间他人在 `lifecycle.js` 的改动被下一轮「复位」直接抹掉，且无任何提示；
// - 他人在 `source-recall.js` / `recall-injection.js` 的在途改动使 4 条召回用例
//   转红，而失败被读成「本次改动的回归」；
// - 结束时的无条件还原把**整个运行期间**落盘的他人改动一并回滚。
//
// ## 修法：把「还原」从「按快照覆盖」改为「条件还原」
//
// 1. **施加变异前**读一次**基线**（不是启动时那份）：该文件只有在「此刻内容 ==
//    我们上次写下的内容」时才允许覆盖。否则说明磁盘上的版本已不是我们的，
//    本文件整组变异记为**不可用（在途改动）**并跳过——不覆盖、不裁决。
// 2. **还原时**同样比对「磁盘内容 == 我们最后一次写下的内容」，只还原自己的。
//    若期间他人改过，保留他人版本并如实报告，绝不回滚。
// 3. 不 import 任何 git 库、不跑 `git status`：判据是内容比对，比「脏/不脏」更精确
//    ——未跟踪文件的旁支改动不会被误判成「有人在改我这份」。
//
// **边界（如实声明）**：本守卫只防「本脚本覆盖他人改动」。它不能防「他人在两次
// 检查之间的毫秒级竞态」（读与写之间仍有一个窗口，只是从整轮缩到一个 writeFile），
// 也不检测他人改动是否使某条变异「碰巧被抓住」——那种情形下变异仍然有效，
// 只是归因不再唯一，属运行环境事实，机械层不判。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 实例互斥（2026-11-15，独立复核 MAJOR-3）
//
// ## 为什么需要它
//
// 本脚本**逐条改写源文件再跑测试**，故两个实例跑在同一目录会互相改写同一批
// 文件：甲的「变异版」可能正好被乙的测试读到，乙的「还原」可能把甲的变异抹掉。
// 后果是**判定不可信**——实测：同一提交、同一脚本，一次完整运行报某锚点
// 「被抓住（4 处失败）」，而只保留该锚点的隔离运行报「存活（0 处失败）」，
// 两次结论相反。复核方与主控当时恰在同一个隔离目录里各跑了一次，
// **两边的数字都不能当凭据**。
//
// 在途改动守卫（上一段）防的是「覆盖**他人**的改动」，它**认不出**另一个
// 变异检查实例——那个实例在机械上就是「本脚本自己」。故另设本锁。
//
// ## 做法
//
// 以**独占创建**的方式在插件目录放一个锁文件；已存在即判定「同目录已有实例在跑」，
// 直接退出并说明——**不跑、不覆盖、不裁决**（本次没有任何判定产生，故没有
// 「不可用终态」需要记账）。
//
// **边界（如实声明）**：锁只挡**同一目录**的并发实例，不挡「同一目录先后两个
// 实例」——那没有互斥问题（前者已退出并还原）。它也不挡别的目录里针对同一
// 仓库的并发运行（那是两份副本，各自自洽）。
// ---------------------------------------------------------------------------
// 锁文件放在**系统临时目录**、按插件目录路径哈希命名——不落仓库（否则会污染
// `git status`，且有可能被误提交；见本仓「共享工作树上先 add 后提交」的经验）。
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
// 退出时释放锁（异常退出也走这条路径）——残留的锁文件会让下次运行直接拒绝，
// 那比「跑一次并给出不可信的数字」更安全，但也更碍事，故务必清掉。
const releaseLock = () => {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // 释放失败不改变判定，只留痕迹（下次运行会据此拒绝并说明）。
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

/** 运行前各文件的原文（首次接触时读取）——还原目标，也是每条变异的施加基底。 */
const baselineOf = new Map();

/** 我们最后一次写下的内容（按文件）。用于判断「磁盘上的这一版是否还是我们的」。 */
const writtenByUs = new Map();

/** 读文件当前内容；不存在时返回 null（新建文件不属本脚本的写入面）。 */
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
	// ── 无变异基线（2026-11-15 新增）──────────────────────────────────────
	//
	// **为什么必须有**：本脚本原先把「套件里出现了失败」直接判作「被抓住」。
	// 但套件**本已失败**的那些用例与任何变异无关——它们会被算作「这条变异
	// 被守护了」。实测：改动前的基线上，「按类型默认状态失效」「兜底回落被静默」
	// 两条变异各「被抓住 12 处」，差分测量却是 **0**——那 12 处全是基线上本就
	// 失败的用例（与变异无关）。反过来，同两条变异在守护用例所在的文件被补进
	// 清单后长期报「存活」。两重错位都源于「把『有失败』当成『因这条变异而失败』」。
	//
	// **本基线的作用**：只有**因这条变异而新增**的失败才算「被抓住」。基线本身
	// 的失败数不归任何变异所有，如实记在报告里，不计入任何一条变异。
	//
	// **边界（如实声明）**：本基线是**本次运行开始时**的套件状态。若并行会话在
	// 运行期间改动代码或语料，基线与后续各次运行的状态可能不同——那种情形下
	// 判定可能偏严或偏松，属运行环境事实，机械层不判（与本文件既有在途改动
	// 守卫同口径）。
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
		// 首次接触该文件：此刻磁盘上的内容就是基线（可能带着他人未提交的改动——
		// 那正是运行前的真实状态，必须原样还原回去）。
		if (last === undefined) {
			baselineOf.set(file, current);
		} else if (!decideMutationWrite({ currentContent: current, lastWrittenContent: last }).ok) {
			// 之后每次接触，磁盘内容必须仍是**我们上次写下的**。不是了 ⇒ 有人在
			// 本次运行期间改过这份文件。此时既不覆盖也不裁决，把该文件余下的变异
			// 全部记为不可用——「测了但没有可用判定」不得读成「存活」。
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
			// **锚点失效必须判失败**（2026-10-25，第八次复核 N-9）：此前把
			// 「锚点未找到」记为一种普通行、既不施加变异、也不影响退出码，
			// 且被汇总式 `rows.length - survived.length` 计入「被抓住」分子——
			// 源码改写后守护悄悄失效，覆盖率却虚高，正是本脚本要防的
			// 「测试通过 ≠ 测试有效」在元工具自身的复现。
			rows.push([name, "**锚点失效**", 0]);
			continue;
		}
		const mutated = base.replace(from, to);
		await writeFile(file, mutated, "utf8");
		writtenByUs.set(file, mutated);
		const runReport = await classifyRun();
		// 三态分开记账：**不可用终态不得读作「存活」**——前者是「这次没测出结论」，
		// 后者是「测了，该行为缺守护」。合并会让一次运行故障伪装成守护健全（或反之）。
		if (runReport.terminal === RUN_TERMINAL.NOT_RUN) {
			rows.push([name, "**未运行**", 0, runReport.evidence]);
		} else if (runReport.terminal === RUN_TERMINAL.COUNT_UNAVAILABLE) {
			rows.push([name, "**计数不可得**", 0, runReport.evidence]);
		} else if (baselineFailed === null) {
			// 基线不可得 ⇒ 差分无从谈起 ⇒ 本次不得给出「被抓住／存活」的裁决
			// （否则就是拿「有失败」当「因这条变异而失败」，即本节要防的那个错位）。
			rows.push([name, "**基线不可得**", 0, runReport.evidence]);
		} else {
			// **差分判定**：只有**因这条变异而新增**的失败才算被抓住。
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
	// **条件还原**：只在「磁盘内容仍是我们最后写下的那一版」时写回基线。
	// 期间被他人改写过的文件一律不动——回滚他人的在途改动是本脚本此前的
	// 缺陷形态（friction-68e6f33e 的原始观察之一），宁可留下变异内容并大声
	// 报告，也不静默覆盖别人的工作。
	for (const file of mutatedFiles) {
		const ours = writtenByUs.get(file);
		if (ours === undefined) continue; // 从未写过（全部跳过或全部锚点失效）
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
// **分母只算「本次有裁决的那些变异」**（2026-11-15）：不可用终态（未运行／
// 计数不可得／锚点失效／基线不可得）不是「没抓住」，把它们计入分母会让这个数字
// 同时被两种相反的误读：既可能被读成「覆盖率低」，也可能被读成「守护健全」。
// 分子分母都只取有裁决者，另把不可用项单列。
const judged = caught.length + survived.length;
console.log(`\n${caught.length}/${judged} 被抓住（差分判定：只有因本条变异新增的失败才算被抓住）`);
if (notRun.length > 0 || staleAnchor.length > 0 || noBaseline.length > 0) {
	console.log(
		`不可用终态 ${notRun.length + staleAnchor.length + noBaseline.length} 条`
		+ `（未运行/计数不可得 ${notRun.length}、锚点失效 ${staleAnchor.length}、基线不可得 ${noBaseline.length}）`
		+ `——它们不是「没抓住」，是「这次没测出结论」`,
	);
}

// **覆盖口径必须与「被抓住」并列报出**（2026-11-04，friction-5c5b6261 的处置）。
//
// 此前这里只有「N/N 被抓住」这一行，它对「哪些模块根本没有变异」一个字都不说，
// 于是该数字读起来像「守护有效」。实测 2026-11-04：50/50 被抓住，而清单只触及
// 9/92 个 lib 模块、59 个模块有专用用例却零变异。两者在输出上无从区分——
// 这正是本账目反复重现的结构性原因。故此处**无条件**报出分子与分母。
{
	const { readdir } = await import("node:fs/promises");
	const coverage = summarizeMutationCoverage({
		mutations: MUTATIONS,
		libModules: await readdir(join(PLUGIN, "lib")),
		testModules: await readdir(join(PLUGIN, "test")),
	});
	console.log(`\n${coverage.summaryLine}`);
	// **本条不设阈值**：覆盖率应达多少是 Human 的判断（00 §3），脚本不代定。
	// 它只保证缺口**不被数字隐去**——「N/N 被抓住」单独出现时必然误导。
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
	// 06 §5 第 3 项：该终态须使**整批结论不可用**，不得以「存活／被抓住」收尾。
	console.log(
		`\n${notRun.length} 项**无可用判定**（未运行或计数不可得）：本次整批结论不可用，` +
			`不得据以声称「已全部被抓住」或「存在 N 项存活」。先查运行环境再重跑。`,
	);
	process.exitCode = 1;
}
if (concurrentTouched.size > 0) {
	// 在途改动不是「缺陷」也不是「已守护」，是**本次结论对这些文件不可用**。
	// 与「未运行／计数不可得」同属不可用终态（06 §5 第 3 项）：不得把跳过读成
	// 「存活」，也不得据以声称这些行为已全部被抓住。
	console.log(
		`\n${concurrentTouched.size} 个文件在本次运行期间被其它会话改写（${[...concurrentTouched].join("、")}）：` +
			`涉及它们的变异记为**在途改动**、不覆盖不裁决。等并行会话的改动落定后重跑。`,
	);
	process.exitCode = 1;
}
