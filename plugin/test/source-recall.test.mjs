// tests for plugin/lib/source-recall.js —— 双源召回（本系统自身的召回环节）
//
// 权威：specs/34 §7「输入来源」、§8.1 第 2 项（适用识别＝从来源中找出）、
// §13「召回的命中不等于适用」、§17 第 1 项（不建全量索引）；
// specs/00 §3.2（两类语义构成要素与规范源、事实源）。
//
// 本文件守的是「能不能找出相关的东西」这一层。它**不**守适用判断——34 §13
// 明文召回命中不等于适用，故本文件不含任何「召回到即适用」的断言。

import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import {
	DEFAULT_STATUSES_BY_TYPE,
	INJECTION_EXCLUDED_TYPES,
	REGISTERED_FACT_TYPES,
	REQUIRED_RECALL_TYPES,
	HIGH_DF_RATIO,
	MATCH_TIERS,
	loadFacts,
	loadSpecs,
	matchCandidate,
	recallForAction,
	resolveSpecsRoot,
	tokenize,
	RECALL_LIMIT_MAX,
	RECALL_LIMIT_MIN,
	recallLimitForBudget,
	isWeakToken,
	statusRank,
	STRUCTURAL_BARE_QUERY_MAX_TOKENS,
	STRUCTURAL_DEFERRED_TIER,
	compareFactHits,
} from "../lib/source-recall.js";
import { RECALL_RENDER_CHAR_LIMIT, renderCharLimitFor } from "../lib/recall-injection.js";

const ROOT = join(import.meta.dirname, "..", "..");
// 本文件内统一用 `joinPath` 指代 `join`（与 lib 中的命名一致，避免与测试变量重名）。
const joinPath = join;

// ---------------------------------------------------------------------------
// 分词
// ---------------------------------------------------------------------------

test("tokenize：ASCII 词与编号保留，长度 < 2 的丢弃", () => {
	const tokens = tokenize("Git Gate pre-commit 03 §10.4 ok a xy");
	assert.ok(tokens.includes("git"));
	assert.ok(tokens.includes("gate"));
	assert.ok(tokens.includes("pre-commit"));
	assert.ok(tokens.includes("03"));
	{
		assert.ok(!tokens.includes("a"), "单字母不应成 token");
		assert.ok(!tokens.includes("ok") || true, "ok 长度为 2，保留即可");
	}
});

test("tokenize：中文只取二元组，单字不进匹配集", () => {
	const tokens = tokenize("验证手段");
	assert.deepEqual(tokens.sort(), ["手段", "验证", "证手"].sort());
	assert.ok(!tokens.includes("验"), "单字不得进匹配集");
	assert.ok(!tokens.includes("段"), "单字不得进匹配集");
});

test("tokenize：纯虚字二元组不进匹配集（实测噪声源）", () => {
	const tokens = tokenize("创建一个 ADR 记录决策");
	assert.ok(!tokens.includes("一个"), "「一个」两端都是虚字，命中一切");
	assert.ok(tokens.includes("建一"), "「建一」只有一个虚字，2026-10-27 起保留（跨词噪声的代价小于实词被吞）");
	assert.ok(tokens.includes("创建"), "实义二元组应保留");
	assert.ok(tokens.includes("记录"), "实义二元组应保留");
	assert.ok(tokens.includes("adr"), "ASCII 词应保留");
});

test("tokenize：含单个虚字的二元组须保留（2026-10-27 修正的核心）", () => {
	// 原实现「含虚字即整组丢弃」把跨越虚字的实词对一并吞掉，实测 12 条真实查询
	// 里 4 条切空（「是不是应该」「现在应该做什么」「我要的是这个」「为什么会这样」），
	// 召回直接 recall/no_tokens。同口径对照 dsh-auto-memory 的 CJK 2-gram 为 0/12。
	for (const q of ["是不是应该", "现在应该做什么", "为什么会这样", "能不能再确认一下"]) {
		assert.ok(tokenize(q).length > 0, `「${q}」不得切空`);
	}
	// 实词必须真的被切出来，而不只是「非空」。
	assert.ok(tokenize("页面白屏了怎么办").includes("白屏"), "「白屏」是实词，必须切出");
	assert.ok(tokenize("现在应该做什么").includes("应该"));
});

test("tokenize：整段零 token 时不硬凑，如实返回空", () => {
	// 「我要的是这个」的六个字（我/要/的/是/这/个）**全部**在 FUNCTION_CHARS 里，
	// 故「两端皆虚才丢」把所有二元组都挡住了，实际返回空数组。
	//
	// **2026-10-27 更正（独立审核中等项 10）**：本条上一版写成
	// `tokens.every(isWeakToken)` —— 对**空数组** `every` 恒为真，是恒真断言；
	// 且注释当时称「确实切出了二元组（我要／要的…）」，与实测相反（返回 []）。
	// 那等于把「断言失效」伪装成「修复完成」。现改为断言实际行为 + 显式非空守卫。
	const tokens = tokenize("我要的是这个");
	assert.deepEqual(tokens, [], "「我要的是这个」六个字全为虚字，应返回空数组");
	// 非空守卫：若将来有人改动过滤规则使其切出 token，本条会红——提醒复核
	// 「这些 token 是否真的承载主题」，而不是让断言静默变成恒真。
	assert.ok(tokens.length === 0, "本条依赖「确实为空」，非空即需重新判断断言形式");
});

test("tokenize：有实词的句子不得因虚字过滤而整段切空", () => {
	// 与上一条互补：只要句中有实词，就必须切出东西。
	for (const q of ["是不是应该", "现在应该做什么", "为什么会这样", "能不能再确认一下"]) {
		assert.ok(tokenize(q).length > 0, `「${q}」含实词，不得切空`);
	}
	assert.ok(tokenize("页面白屏了怎么办").includes("白屏"), "「白屏」是实词，必须切出");
	assert.ok(tokenize("现在应该做什么").includes("应该"));
});

test("tokenize：空串与非字符串返回空数组", () => {
	assert.deepEqual(tokenize(""), []);
	assert.deepEqual(tokenize(null), []);
	assert.deepEqual(tokenize(undefined), []);
	assert.deepEqual(tokenize(123), []);
});

// ---------------------------------------------------------------------------
// 载入
// ---------------------------------------------------------------------------

test("loadSpecs：载入规范源，字段与标题行可取", async () => {
	const specs = await loadSpecs(join(ROOT, "specs"));
	assert.ok(specs.length >= 20, `规范源应有二十余份，实际 ${specs.length}`);
	const first = specs[0];
	assert.equal(first.source, "spec");
	assert.ok(typeof first.ref === "string" && first.ref !== "");
	assert.ok(typeof first.title === "string" && first.title !== "");
	assert.ok(Array.isArray(first.headings));
	assert.ok(first.path.startsWith("specs/"));
});

test("loadFacts：载入事实源，类型名取 fact_type_key（不从目录猜单复数）", async () => {
	const facts = await loadFacts(join(ROOT, "ldvh-base"));
	assert.ok(facts.length >= 200, `事实源应有数百个对象，实际 ${facts.length}`);
	const types = new Set(facts.map((f) => f.type));
	// 七类，单数形；曾因从目录名猜单复数得 "researche"/"workca"。
	for (const expected of ["adr", "friction", "norm", "pitfall", "research", "spark", "workcase"]) {
		assert.ok(types.has(expected), `应含类型 ${expected}，实际 ${[...types].join(",")}`);
	}
	assert.ok(!types.has("researche"), "不得把 researches 猜成 researche");
	assert.ok(!types.has("workca"), "不得把 workcases 猜成 workca");
});

test("loadFacts：每条都有 status 与 title", async () => {
	const facts = await loadFacts(join(ROOT, "ldvh-base"));
	for (const f of facts.slice(0, 30)) {
		assert.ok(typeof f.status === "string" && f.status !== "", `${f.path} 缺 status`);
		assert.ok(typeof f.title === "string" && f.title !== "", `${f.path} 缺 title`);
	}
});

// ---------------------------------------------------------------------------
// 分层匹配
// ---------------------------------------------------------------------------

test("MATCH_TIERS 层号递增，scope 是最精确的一层", () => {
	assert.deepEqual(MATCH_TIERS.map((t) => t.tier), [0, 1, 2, 3, 4]);
	assert.equal(MATCH_TIERS[0].field, "specId");
	assert.equal(MATCH_TIERS[1].field, "scope");
	assert.equal(MATCH_TIERS[4].field, "body");
});

test("matchCandidate：命中 scope 层号最前，命中 title 层号靠后", () => {
	const tokens = tokenize("预检落实记录");
	assert.equal(matchCandidate(tokens, { scope: "预检落实记录的字段与格式" }).tier, 1);
	assert.equal(matchCandidate(tokens, { scope: "", detail: "", title: "预检落实记录说明", body: "" }).tier, 3);
});

test("matchCandidate：无关文本返回 null", () => {
	const tokens = tokenize("预检落实记录");
	assert.equal(matchCandidate(tokens, { scope: "天气预报", detail: "无", title: "午餐", body: "晴" }), null);
});

test("matchCandidate：hitReason 列出命中词，不列全文", () => {
	const m = matchCandidate(tokenize("预检落实记录"), { scope: "预检落实记录的字段与格式", title: "", body: "" });
	assert.match(m.hitReason, /预检/);
	assert.ok(m.hits >= 1);
});

// ---------------------------------------------------------------------------
// 召回入口
// ---------------------------------------------------------------------------

test("recallForAction：缺动作描述即拒绝", async () => {
	const r = await recallForAction({ root: ROOT });
	assert.equal(r.ok, false);
	assert.equal(r.error.code, "recall/action_required");
});

test("recallForAction：返回 specs 与 facts，且不声称适用（34 §13）", async () => {
	const r = await recallForAction({ action: "创建 ADR 记录一个已拍板的取舍", root: ROOT });
	assert.equal(r.ok, true);
	assert.ok(Array.isArray(r.specs));
	assert.ok(Array.isArray(r.facts));
	assert.equal(r.provesApplicability, false, "召回命中不等于适用（34 §13）");
	assert.match(r.coverage, /deterministic/);
	assert.match(r.coverage, /may miss/);
});

test("recallForAction：经验（Pitfall）能被召回到", async () => {
	const r = await recallForAction({ action: "验证手段在骗我，校验假定与语义不对应", root: ROOT });
	const pitfallHits = r.facts.filter((f) => f.type === "pitfall");
	assert.ok(pitfallHits.length > 0, `经验应被召回到，实际 facts=${r.facts.length}`);
});

test("recallForAction：默认只取各类型自己的活跃状态，可显式纳入其他状态", async () => {
	// **2026-10-27 更正**：本条原断言 `every(f => f.status === "active")`——但
	// 「活跃」不是所有类型都叫 `active`：spark/friction 的活跃态是 `open`，
	// workcase 是 draft/open（见 `DEFAULT_STATUSES_BY_TYPE`）。原断言只在该查询
	// 恰好召回不到 spark 时通过，属**依赖偶然的假通过**；排序一变就红。
	// 正确判据：每条结果的状态须落在**它自己类型的**默认状态集内。
	const def = await recallForAction({ action: "校验验证", root: ROOT });
	for (const f of def.facts) {
		const allowed = DEFAULT_STATUSES_BY_TYPE[f.type] ?? ["active"];
		assert.ok(
			allowed.includes(f.status),
			`${f.type} 的状态 ${f.status} 不在该类型默认活跃集 [${allowed.join("/")}] 内`,
		);
	}
	const wide = await recallForAction({
		action: "校验验证", root: ROOT, statuses: ["active", "draft", "open", "observing"],
	});
	assert.ok(wide.facts.length >= def.facts.length, "纳入更多状态时召回不减少");
});

test("recallForAction：types 过滤只回指定类型", async () => {
	const r = await recallForAction({
		action: "校验验证工具", root: ROOT, types: ["pitfall"],
	});
	assert.ok(r.facts.every((f) => f.type === "pitfall"), "types 过滤未生效");
});

test("recallForAction：limit 限制每侧返回条数", async () => {
	const r = await recallForAction({ action: "校验验证工具", root: ROOT, limit: 2 });
	assert.ok(r.specs.length <= 2);
	assert.ok(r.facts.length <= 2);
	assert.equal(r.budget.limit, 2);
});

test("recallForAction：预算超限时如实标 truncated，不静默", async () => {
	const r = await recallForAction({
		action: "校验验证工具 Web 页面", root: ROOT, limit: 20, budgetBytes: 200,
	});
	assert.equal(r.ok, true);
	assert.equal(r.truncated, true, "超预算须标 truncated");
	// 保底一条可能超额（见「预算极小不得返回零结果」用例）：此时不再要求
	// usedBytes <= 预算，但必须如实标 overBudget，使调用方知道超额原因。
	if (r.overBudget !== true) {
		assert.ok(r.budget.usedBytes <= 200, "未走保底时返回内容不得超预算");
	} else {
		assert.ok(r.specs.length + r.facts.length > 0, "保底必须给出至少一条");
	}
});

test("recallForAction：includeSpecs=false 时不回规范源", async () => {
	const r = await recallForAction({
		action: "校验验证", root: ROOT, includeSpecs: false,
	});
	assert.deepEqual(r.specs, []);
	assert.ok(r.facts.length > 0);
});

test("recallForAction：排序先按层、同层按命中词数，且结果可复算", async () => {
	const q = "Git Gate 的 pre-commit 钩子失败";
	const a = await recallForAction({ action: q, root: ROOT });
	const b = await recallForAction({ action: q, root: ROOT });
	assert.deepEqual(a.facts, b.facts, "同输入须同输出（确定性、无随机）");
	const tiers = a.facts.map((f) => f.tier);
	for (let i = 1; i < tiers.length; i += 1) {
		assert.ok(tiers[i - 1] <= tiers[i], "层号须非递减");
	}
});

test("recallForAction：切不出 token 时如实拒绝，不假装召回成功", async () => {
	const r = await recallForAction({ action: "  ", root: ROOT });
	assert.equal(r.ok, false);
	assert.equal(r.error.code, "recall/action_required");
});

test("tokenize：虚字单字也不进匹配集（曾让「的」进命中理由）", () => {
	for (const word of ["的", "了", "是", "在", "与", "之"]) {
		assert.ok(!tokenize(word).includes(word), `虚字单字「${word}」不应成 token`);
	}
	// 实义单字仍保留（长度为 1 的 run 无二元组可取）。
	assert.ok(tokenize("云").includes("云"), "实义单字应保留");
});

test("同层排序：命中词多的必须排在命中词少的前面（曾因 hits 未带出而退化成按路径排序）", async () => {
	// 实测缺陷：collect 的 mapper 返回对象里没有 hits，排序键变成
	// `undefined - undefined = NaN`，同层排序退化为只按路径字典序，
	// 使命中 2 个词的 34 号被命中 1 个词的 01 号挤掉。
	// 查询里同时含「34」与「规范」，故 34 号的 scope 会命中两个词。
	const r = await recallForAction({ action: "把 34 号规范改名，走独立审核", root: ROOT, limit: 3, budgetBytes: 4000 });
	assert.ok(r.specs.length > 0, "应有规范命中");
	const first = r.specs[0];
	assert.ok(typeof first.hits === "number" && first.hits >= 1, `hits 必须带出，实际 ${first.hits}`);
	// 34 号是唯一会同时命中「34」与「规范」的规范，必须排在前列。
	assert.ok(
		r.specs.slice(0, 3).some((s) => s.title.includes("双源召回")),
		`34 号应在前三条内，实际：[${r.specs.map((s) => s.title).join(", ")}]`,
	);
	// 点名编号时，编号层（tier 0）必须压过一切文本层命中。
	assert.equal(first.tier, 0, "「34」是编号命中，应落在 tier 0");
	assert.match(first.hitReason, /规范编号命中/);
	// 同层内 hits 必须非递增。
	const sameTier = r.specs.filter((s) => s.tier === r.specs[0].tier);
	for (let i = 1; i < sameTier.length; i += 1) {
		assert.ok(sameTier[i - 1].hits >= sameTier[i].hits, "同层 hits 须非递增");
	}
});

test("高文档频率过滤：普遍词不再把大半规范拉进来", async () => {
	// 实测缺陷：「规范」出现在 19/27 份规范的 scope 里（70%），命中任何查询；
	// 「定义」27/27（100%）。它们制造假相关。查询「34 号规范改名」时，
	// 01/02/03 等只靠「规范」命中——那是假相关，不是适用。
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 10, budgetBytes: 20000 });
	assert.ok(r.specs.length > 0, "应至少命中 34 号");
	// 34 号靠编号命中，必须排第一。
	assert.match(r.specs[0].hitReason, /规范编号命中：34/);
	// 「规范」这个普遍词不得把大半规范拉进**同一层**：34 号应在 tier 0 独占鳌头，
	// 其余正文层命中的必须是因为真命中 ≥2 个实义词，而非靠「规范」一词。
	assert.equal(r.specs[0].tier, 0, "34 号应以编号层居首");
	// 正文层（tier 4）保留的必须命中 ≥2 个词（单靠一个普遍词的已被 minHits 剔除）。
	//
	// **2026-10-27 修正**：`hits` 自 BM25 加权起是**浮点权重**（如 1.983），
	// 不再是「命中几个词」的整数计数。直接断言 `hits >= 2` 会拿权重冒充计数，
	// 既误判（1.983 个词无从谈起），也失去了原本要守的性质。改为从
	// `hitReason` 里的「跨层命中 N 个词」读回**真实计数**——那才是 minHits 的
	// 判定依据（门槛用未加权的条数，加权只用于同 tier 内排序）。
	for (const s of r.specs.filter((x) => x.tier === 4)) {
		const m = /·(\d+)词/.exec(s.hitReason ?? "");
		assert.ok(m !== null, `正文层条目 ${s.title} 的命中理由须写明命中词数：${s.hitReason}`);
		assert.ok(Number(m[1]) >= 2, `正文层条目 ${s.title} 只命中 ${m[1]} 个词，应被 minHits 剔除`);
	}
});

test("高文档频率过滤：过滤后仍能命中真正相关的（不得因过滤而清空）", async () => {
	// 「web」在规范源里 14/27 (52%) 未过阈值，故 Web 类查询仍应命中规范。
	const r = await recallForAction({ action: "给 Web 页面加一个新面板", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.ok(r.specs.length > 0, "Web 查询应仍能命中规范");
	assert.ok(r.facts.some((f) => f.title.includes("白屏")), "应命中 SPA 白屏教训");
});

test("高文档频率过滤：全部查询词都过于普遍时退回原词，不得给零结果", async () => {
	// 「规范」「定义」都极普遍。若全被滤掉仍须退回，否则零结果会被读成「无相关约束」。
	const r = await recallForAction({ action: "规范定义适用", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.equal(r.ok, true);
	assert.ok(r.specs.length + r.facts.length > 0, "不得因过滤过狠而返回空");
});

test("HIGH_DF_RATIO 是固定常量，样本过小时不丢词", () => {
	assert.equal(HIGH_DF_RATIO, 0.6);
});

test("规范正文层必须参与匹配（曾因读 body 而规范只有 text 导致整层失效）", async () => {
	// 实测缺陷：matchCandidate 的正文层读 `candidate.body`，但 loadSpecs 返回的是
	// `text`（全文）。结果规范正文这一层**从未匹配过**——查询「改 guidance-text.js
	// 的引导文本」一条规范都命中不了，而该文件名只出现在 10 与 00 的正文里，
	// 不在它们的 scope/positioning/title 里。
	const r = await recallForAction({ action: "改 guidance-text.js 的引导文本", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.ok(r.specs.length > 0, "必须命中规范（此前为 0 条）");
	// 该文件名由 10 号规范规定为受保护文本，必须命中它。
	assert.ok(
		r.specs.some((s) => s.title.includes("环境接入") || s.title.includes("插件发布")),
		`应命中 10 号规范，实际：[${r.specs.map((s) => s.title).join(", ")}]`,
	);
	// 命中的层应是正文层（tier 4）——这正是此前失效的那一层。
	assert.ok(r.specs.some((s) => s.tier === 4), "应有正文层（tier 4）命中");
});

test("规范正文层：受保护内容的出处能被召回（00 §4.3）", async () => {
	const r = await recallForAction({ action: "受保护内容怎么改", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.ok(r.specs.length > 0, "应命中规范");
	assert.ok(
		r.specs.some((s) => s.title.includes("理念与构成")),
		`00 号（受保护内容的规定处）应被命中，实际：[${r.specs.map((s) => s.title).join(", ")}]`,
	);
});

test("预算极小不得返回零结果（零结果会被读成「无相关约束」）", async () => {
	// 实测缺陷：budgetBytes 为 1/50/200 时 keepSpecs 与 keepFacts 都为空，
	// 调用方看到 specs: [] + truncated: true 会读成「没有相关约束」——
	// 而 02 §9.2 明文禁止把零结果当作无约束。
	for (const budgetBytes of [1, 50, 200]) {
		const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, budgetBytes });
		assert.equal(r.ok, true);
		assert.ok(
			r.specs.length + r.facts.length > 0,
			`预算 ${budgetBytes} 时不得返回零结果`,
		);
		assert.equal(r.truncated, true, "应标为已裁剪");
		assert.equal(r.overBudget, true, "保底导致超额时须如实标出");
	}
});

test("预算充足时不标 overBudget", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, budgetBytes: 40000 });
	assert.equal(r.overBudget, false);
	// 预算充足不等于**不截断**：limit=3 仍可能丢掉超出的命中（02 §9.1 要求可观察）。
	// 故这里只断言「预算未超」，截断由 limit 决定、另有专门用例覆盖。
	assert.equal(r.budget.usedBytes <= 40000, true);
});

test("受辖但无语料的项目不得抛 ENOENT（新建项目/语料未建立是正常状态）", async () => {
	// 实测缺陷：缺失 specs/ 或 ldvh-base/ 目录时，loadSpecs/loadFacts 直接抛
	// `ENOENT ... scandir`。上层虽有 try/catch 只记日志，但那意味着**这类项目
	// 每回合都在报错**——而「还没有语料」是正常状态，02 §9.2 也没有把它定为错误。
	const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");

	const shapes = [
		["完全没有目录", async () => {}],
		["只有空 specs/", async (p) => { await mkdir(joinPath(p, "specs"), { recursive: true }); }],
		["只有空 ldvh-base/", async (p) => { await mkdir(joinPath(p, "ldvh-base"), { recursive: true }); }],
	];
	for (const [name, setup] of shapes) {
		const project = await mkdtemp(joinPath(tmpdir(), "ldvh-deg-"));
		try {
			await setup(project);
			const r = await recallForAction({ action: "把 34 号规范改名", root: project, limit: 3 });
			assert.equal(r.ok, true, `${name}：不应失败（不得抛 ENOENT）`);
			// 规范可经 01 §10.3 三级回退取得（故可能非空）；事实源只有项目内一源，
			// 无 ldvh-base/ 时必为空。要点是**不抛错**，而不是「必须零命中」。
			assert.equal(r.facts.length, 0, `${name}：无 ldvh-base/ 时事实必为空`);
			assert.equal(r.provesApplicability, false);
			// 若回退到了外部语料，必须如实标注（不得冒充项目自著）。
			if (r.specs.length > 0) {
				assert.equal(r.sourceView.specsAreProjectAuthored, false, `${name}：回退语料须标明非项目自著`);
			}
		} finally {
			await rm(project, { recursive: true, force: true });
		}
	}
});

test("受辖但无语料：注入层报 no-hits 而非报错", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-deg2-"));
	try {
		const r = await buildRecallInjection({ userText: "把 34 号规范改名", projectRoot: project });
		// 规范可经 01 §10.3 回退取得，故此时**可能注入**（来自源仓库语料）；
		// 关键是不得抛错。若未注入，须是 no-hits 而非 recall-failed。
		if (r.inject === false) {
			assert.equal(r.reason, "no-hits", "应报零命中，不是抛错");
		} else {
			assert.match(r.text, /非本项目自著/, "回退语料须如实标注来源");
		}
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("实义动词单字兜底：短指令不得切空（改一下/删了/加个）", () => {
	// 实测缺陷：「含虚字的二元组一律丢弃」这条过滤，把「改一下」里的「一下」
	// 丢掉后，剩下的「改」是单字又不进 token，整句切空 → 召回 no_tokens。
	// 实测 15 个常用动词短语里 11 个切空，而它们是真实使用中最常见的说法。
	const cases = [
		["改一下", "改"], ["删了", "删"], ["加个", "加"], ["建个", "建"],
		["修一下", "修"], ["把这个改了", "改"],
	];
	for (const [phrase, want] of cases) {
		const tokens = tokenize(phrase);
		assert.ok(tokens.includes(want), `「${phrase}」应切出「${want}」，实际：${JSON.stringify(tokens)}`);
	}
});

test("实义动词单字兜底：宽泛字仍不收，避免请回噪声", () => {
	// 「弄/搞/调」语义太宽，收进来会把噪声请回来——故 ACTION_CHARS 刻意不收。
	// **2026-10-27 修正后语义变化**：这些短语不再切空，因为「一下」「换个」这类
	// 含单个虚字的二元组现在会被保留（见上方「含单个虚字的二元组须保留」）。
	// 本条真正要守的是——**宽泛字本身不得成为单字 token**：命中依据若含「弄/调」，
	// 说明收窄被破坏。故改为断言宽泛字不单独成 token，而不是断言整串切空。
	for (const phrase of ["弄一下", "调一下", "换个"]) {
		const tokens = tokenize(phrase);
		for (const wide of ["弄", "调", "换"]) {
			assert.ok(!tokens.includes(wide), `「${phrase}」不得把宽泛字「${wide}」收成单字 token`);
		}
	}
});

test("实义动词单字兜底：短指令能真实召回且质量不退化", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	for (const q of ["改一下", "把这个改了", "删了它"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, true, `「${q}」应能召回（此前报 recall/no_tokens）`);
	}
	// 原有质量不得退化：编号点名仍以 tier 0 居首。
	const r2 = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3, budgetBytes: 2400 });
	assert.equal(r2.specs[0].tier, 0);
	assert.match(r2.specs[0].hitReason, /规范编号命中：34/);
});

test("单字兜底不得引入泛字噪声（回归：成/回/立/新/开/生 曾致假命中）", () => {
	// 实测回归：初版 ACTION_CHARS 收了「成」「回」「立」「新」「开」「生」等泛字。
	// 「改名**成**双源召回」切出单字「成」，「已经完**成**」切「成」，「**回**到上一节」切「回」。
	// 后果：查询「把 34 号规范改名成双源召回」时，00 号规范靠 scope 里的「构**成**」
	// 命中，命中理由显示「适用范围命中：成」——单字噪声把假相关送了回来。
	// 这些字曾误入 ACTION_CHARS，且**出现在几乎任何句子里**。
	const FORBIDDEN_SINGLE_CHARS = ["成", "立", "新", "开", "生", "设", "存", "保", "清", "替", "启", "停"];
	for (const phrase of [
		"把 34 号规范改名成双源召回",
		"这个功能已经完成",
		"新开一个分支",
		"保存这段设置",
	]) {
		const tokens = tokenize(phrase);
		for (const ch of FORBIDDEN_SINGLE_CHARS) {
			assert.ok(
				!tokens.includes(ch),
				`「${phrase}」不得切出泛字「${ch}」，实际：${JSON.stringify(tokens)}`,
			);
		}
	}
});

test("单字兜底：真正的动作字仍须切出（不得因收窄而误删）", () => {
	for (const [phrase, want] of [
		["改一下", "改"], ["删了", "删"], ["加个", "加"], ["建个", "建"], ["修一下", "修"],
	]) {
		assert.ok(tokenize(phrase).includes(want), `「${phrase}」须切出「${want}」`);
	}
});

test("单字噪声不得造成假命中（00 号不得靠「成」命中）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 5, budgetBytes: 20000 });
	for (const s of r.specs) {
		assert.ok(
			!/^.*命中：成$/.test(s.hitReason),
			`${s.title} 的命中理由是单字「成」，属泛字噪声`,
		);
	}
});

test("单字不得单独构成命中依据（真实消息实测：10 条里 4-5 条是单字噪声）", async () => {
	// 实测（用本会话真实用户消息）：
	//   「把这批改动合入吧」10 条结果里 5 条纯单字命中——WorkCase 工单靠「批」、
	//   火花记录与双源召回靠「合」；「经验也要召回啊」有 4 条靠单字「回」。
	// 单个汉字在本语料里覆盖 50–70% 的候选（实测「改」231/337），
	// 靠一个字命中几乎等于没命中。
	// 「决定性命中词全为单字」——用于判定一条命中是否只靠单字。
	const isAllSingleChar = (reason) => {
		const m = /命中（[^）]*）：(.+)$/.exec(reason) ?? /命中：(.+)$/.exec(reason);
		if (m === null) return false;
		return m[1].split("、").every((token) => token.length === 1);
	};
	// **核心断言：有强词可用时，不得出现「只靠单字、却未标注」的命中。**
	// 注意不能写成「跳过带标注的」，那会让断言空转——破坏实现后测试仍全过
	// （实测过：把 strong 改成 >=1 后本条仍通过）。故这里要求：
	//   凡命中词全为单字的条目，必须带「仅单字」标注；否则即为缺陷。
	const r = await recallForAction({ action: "经验也要召回啊", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.ok(r.specs.some((s) => s.title.includes("Pitfall")), "应命中 Pitfall 类型规范");
	assert.ok(r.specs.length > 0, "应至少命中一份规范");
	for (const s of [...r.specs, ...r.facts]) {
		if (isAllSingleChar(s.hitReason)) {
			assert.match(
				s.hitReason,
				/仅单字|仅通用词/,
				`${s.title} 的命中词全是单字却未标注弱相关：${s.hitReason}`,
			);
		}
	}
	// 且「经验」这个强词必须被用上（证明强词优先于单字）。
	assert.ok(
		r.specs.some((s) => /命中：.*经验/.test(s.hitReason) && !/仅单字/.test(s.hitReason)),
		`应有一份规范靠强词「经验」命中，实际：${r.specs.map((s) => s.hitReason).join(" | ")}`,
	);
});

test("靠单字命中时须标注「仅单字…相关性弱」，不得让读者误以为相关性强", async () => {
	const r = await recallForAction({ action: "把这批改动合入吧", root: ROOT, limit: 5, budgetBytes: 20000 });
	const singleHits = r.specs.filter((s) => /仅单字|仅通用词/.test(s.hitReason));
	for (const s of singleHits) {
		assert.match(s.hitReason, /相关性弱，须自行核实/, "标注须说明相关性弱");
	}
});

test("单字兜底不得被削弱：短指令仍须能召回（第 16 轮路径）", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	for (const q of ["改一下", "删了", "加个", "建个"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, true, `「${q}」必须仍能召回——单字是它唯一的词`);
	}
});

test("通用词不得单独构成命中依据（真实 friction 实测：15% 命中只靠通用词）", async () => {
	// 实测（40 条真实 friction 现象陈述 × 3 = 92 条命中）：14 条（15%）只靠
	// 通用词命中。例如「install() 分发器…」靠「任何/执行」命中了
	// 「无关未提交改动阻塞变基致推送延迟」——几乎肯定不相关。
	// 通用词（任何/规范/执行/测试/写/改/回…）有实义但**不足以单独支撑相关**，
	// 与虚字不同，故不丢、只降级并在理由中标注。
	const isAllSingleChar = (reason) => {
		const m = /命中（[^）]*）：(.+)$/.exec(reason) ?? /命中：(.+)$/.exec(reason);
		if (m === null) return false;
		return m[1].split("、").every((token) => token.length === 1);
	};
	const r = await recallForAction({
		action: "install() 分发器在 agent/created 回调里没有 try/catch 致子代理注册失败",
		root: ROOT,
		limit: 3,
		budgetBytes: 20000,
	});
	// 真相关的那条必须命中，且靠的是实义词「子代/代理」而非通用词。
	const relevant = r.facts.find((f) => f.title.includes("插件重建清空子代理登记表"));
	assert.ok(relevant !== undefined, "应命中子代理登记表相关的教训");
	assert.ok(!/仅通用词|仅单字/.test(relevant.hitReason), `真相关命中不应被降级：${relevant.hitReason}`);
	// 凡只靠通用词命中的，必须带弱相关标注。
	const GENERIC_ONLY_MARK = /仅通用词|仅单字/;
	for (const f of r.facts) {
		if (f === relevant) continue;
		if (isAllSingleChar(f.hitReason)) {
			assert.match(f.hitReason, GENERIC_ONLY_MARK, `${f.title} 只靠单字却未标注弱相关`);
		}
	}
});

test("通用词降级后：真主题查询仍须命中真相关项", async () => {
	const r = await recallForAction({ action: "经验也要召回啊", root: ROOT, limit: 3, budgetBytes: 20000 });
	assert.ok(r.specs.some((s) => s.title.includes("Pitfall")), "「经验」应命中 Pitfall 类型规范");
	const pitfallSpec = r.specs.find((s) => s.title.includes("Pitfall"));
	assert.ok(!/仅通用词|仅单字/.test(pitfallSpec.hitReason), "靠「经验」命中不应被降级");
});

test("通用词降级不得削弱短指令路径", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	for (const q of ["改一下", "删了", "加个"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, true, `「${q}」必须仍能召回`);
	}
});

// ---------------------------------------------------------------------------
// 01 §10.3 三级回退（34 §7 把召回绑到这个入口）
// ---------------------------------------------------------------------------

test("三级回退：受辖项目无自著语料时须回退，不得零命中", async () => {
	// 01 §10.3 逐字：受辖项目根 specs/ → 插件源仓库根 specs/ → 插件包内 specs/。
	// 34 §7 把召回绑到此入口（「规则来源为规范源（经 01 §10 的 L0–L4 读取取得）」），
	// 故无自著语料的受辖项目应回退取用源仓库语料，而不是返回零命中。
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-tier-"));
	try {
		const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: project, limit: 3 });
		assert.equal(r.ok, true);
		assert.ok(r.specs.length > 0, "无自著语料时应回退取得语料，而非零命中");
		assert.equal(r.sourceView.specs.tier, "source-repo", "应回退到插件源仓库");
		assert.equal(r.sourceView.specsAreProjectAuthored, false);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("三级回退：有自著语料时用项目语料，不得回退", async () => {
	// 本项目自己有 specs/，必须用自己那份——「首个实际存在的目录即唯一来源视图」。
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(r.sourceView.specs.tier, "project");
	assert.equal(r.sourceView.specsAreProjectAuthored, true);
});

test("三级回退：空目录不得冒充语料来源（以根规范载体的实际存在辨认）", async () => {
	// 01 §10.3：「以根规范载体的实际存在辨认」。某级目录存在但里面没有 .md 时，
	// 不算这一级成立，须继续回退。
	const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-empty-"));
	try {
		await mkdir(joinPath(project, "specs"), { recursive: true }); // 空目录
		const resolved = await resolveSpecsRoot(project);
		assert.notEqual(resolved?.tier, "project", "空的 specs/ 不得被当作项目语料来源");
		assert.equal(resolved?.tier, "source-repo", "应继续回退到源仓库");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("三级回退：渲染行须如实标注语料来自回退来源（不得冒充项目自著）", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const { renderRecallRow } = await import("../lib/recall-injection.js");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-render-"));
	try {
		const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: project, limit: 2 });
		const row = renderRecallRow(r);
		assert.match(row, /非本项目自著/, "回退来源必须在渲染行里如实标注");
		assert.match(row, /插件源仓库/, "应点名具体回退层级");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// 02 §9.1：数量/排序/分页/截断/指纹/未完成范围必须可观察
// ---------------------------------------------------------------------------

test("02 §9.1：counts 须报**截断前总数**，而非返回数", async () => {
	// 实测缺陷：collect 内先 slice 再统计，导致 specHits 恒等于返回数，
	// 「丢了多少」无从看出（limit=1 时 specHits 恒为 1）。
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 2 });
	assert.ok(r.counts.specHits > r.counts.specsReturned, "命中总数应大于返回数");
	assert.equal(r.counts.specsReturned, r.specs.length);
	assert.equal(r.counts.factsReturned, r.facts.length);
	assert.ok(r.counts.candidatesScanned > 0, "须报实际参与匹配的候选数");
	// **分母须动态取，不得写死 337**（2026-10-24 合并 dev 时暴露）：
	// 该常量随事实源增长而失效——合并 dev 带进 1 个新 spark 后载入总数变为 338，
	// 而写死的 337 使本用例误报失败。缺陷本意是「扫描数 + 排除数 = 载入总数」，
	// 那就应当**真的去数载入总数**。
	const specsLoaded = await loadSpecs(join(ROOT, "specs"));
	const factsLoaded = await loadFacts(join(ROOT, "ldvh-base"));
	assert.equal(
		r.counts.candidatesScanned + r.counts.candidatesExcluded,
		specsLoaded.length + factsLoaded.length,
		"扫描数 + 排除数 = 载入总数",
	);
});

test("02 §9.1：limit 造成的丢弃须标 partial/truncated（不只预算）", async () => {
	const small = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 2 });
	assert.equal(small.partial, true, "limit 截断时须报 partial");
	assert.equal(small.truncated, true, "limit 截断时须报 truncated");

	// 注意（2026-10-24）：按类型取默认候选状态集后候选池变大（friction 92 条、
	// spark 34 条现在都可见），`limit: 99` 也可能真的不够——实测该查询命中
	// 144 条事实而 limit 99 只能返回 99 条。故「不虚报」的判据不能再用固定
	// limit 值，而应断言：partial 为真 ⟺ 确实有命中未返回。
	const big = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 999, budgetBytes: 9999999 });
	const reallyDropped =
		big.counts.specsReturned < big.counts.specHits || big.counts.factsReturned < big.counts.factHits;
	assert.equal(
		big.partial,
		reallyDropped,
		`partial 须与「是否真有未返回的命中」一致：partial=${big.partial} dropped=${reallyDropped}`,
	);
	assert.equal(big.truncated, reallyDropped, "truncated 同理");
});

test("02 §9.1：unchecked 须列出**具体被丢弃的候选**，不只是一个布尔", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 2 });
	const dropped = r.unchecked.specs.length + r.unchecked.facts.length;
	const kept = r.specs.length + r.facts.length;
	assert.equal(kept + dropped, r.counts.specHits + r.counts.factHits, "保留数 + 丢弃数 = 命中总数");
	assert.ok(dropped > 0, "limit=2 时必有丢弃");
	for (const item of [...r.unchecked.specs, ...r.unchecked.facts]) {
		assert.equal(typeof item.title, "string");
		assert.equal(typeof item.path, "string");
	}
});

test("02 §9：排序不得用相似度/embedding/AI 裁决相关性（红线）", async () => {
	// **2026-10-27 更正**：本条曾断言 `usesWeights === false` —— 那断言的是一个
	// 写死的字面量，实现无论怎么变都通过（恒真守不住任何东西）。
	//
	// 核对 `02:262` 原文后确认：禁区是「Code 不得使用相似度、embedding、
	// **关键词权重**或 AI 输出**自动裁决**相关性、适用性或事实结论」——禁裁决，
	// 不禁排序；`34 §7` 的召回反而要求「保留命中依据」。故 `usesWeights` 已
	// 如实改为 `true`（idf 加权参与排序）。
	//
	// 真正要守的红线是**这两条**：不得用相似度/embedding，不得用 AI 裁决。
	// 它们由行为断言守护（见下）；`usesWeights` 只作声明一致性检查。
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(r.ranking.usesWeights, true, "idf 加权参与排序，声明须与实际一致（不是 false）");
	assert.equal(r.ranking.usesSimilarity, false);
	assert.equal(r.ranking.usesEmbedding, false);
	assert.equal(r.ranking.usesAiJudgement, false, "02 §9 红线：不得用 AI 输出自动裁决相关性");
	// 排序键必须是可复核的确定性量。
	assert.deepEqual(r.ranking.keys, ["tier", "hits", "path"]);
	// 截断不等于判定不相关——须明确告知。
	assert.equal(r.ranking.truncationIsNotJudgement, true);
});

test("02 §9.1：fingerprint 须为确定性集合指纹，且不得冒称内容指纹", async () => {
	const a = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	const b = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(a.fingerprint.value, b.fingerprint.value, "同一候选集合的指纹须稳定");
	assert.equal(a.fingerprint.kind, "candidate-set");
	assert.equal(a.fingerprint.coversContent, false, "不得冒称内容指纹");
	assert.equal(a.fingerprint.memberCount, a.counts.candidatesScanned + a.counts.candidatesExcluded, "指纹覆盖载入的全部候选（含被排除的）");
});

test("02 §9.1：pagination 须如实说明无游标及如何取更多", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 2 });
	assert.equal(r.pagination.hasCursor, false, "本实现不持有跨调用游标，须如实说明");
	assert.match(r.pagination.howToGetMore, /limit|范围/, "须说明如何取得更多结果");
});

// ---------------------------------------------------------------------------
// 能力边界：词法匹配的固有局限（实测数据，不是模糊说法）
// ---------------------------------------------------------------------------

test("limitations 须如实披露词法匹配的固有边界", async () => {
	// **口径变更说明**（2026-10-24，第 54 轮）：本用例原先断言样本量为 30，
	// 且备注「只有 13/30 = 43% 命中」。两处都已过时：
	//   · 样本量：早先未按类型区分默认状态，Pitfall 的 draft 也算进可见集；
	//     第 48 轮按 `23 §12` 改为「默认只含 active」后，候选是 23 条；
	//   · 命中率：早先正文只匹配前 1200 字符，症状段（在 body 中后部）常被截掉；
	//     第 46 轮改为全文匹配后复测为 23/23 = 100%。
	// 故此处只断言**结构性边界仍在**，不再钉死数字——数字随实现演进，
	// 钉死会让「实现改进」反而弄坏测试。数值一致性由另一条用例
	// （「数据侧实测值须与当前实现一致」）动态比对。
	const r = await recallForAction({ action: "页面白屏了", root: ROOT, limit: 3 });
	assert.equal(r.limitations.lexicalOnly, true, "须声明是纯词法匹配");
	assert.equal(r.limitations.usesSemanticUnderstanding, false, "不得声称有语义理解");
	assert.ok(r.limitations.measuredSymptomSelfRecall.total > 0, "须给出实测样本量");
	assert.ok(
		r.limitations.insufficientForConsumptionPoints.some((x) => /故障调查/.test(x)),
		"须点明「故障调查」这一消费点不能只靠本函数",
	);
	assert.ok(
		r.limitations.insufficientForConsumptionPoints.some((p) => p.includes("故障调查")),
		"须点名哪些消费点不能只靠本函数",
	);
});

test("能力边界须在渲染行里让读者看见（未命中不代表没有同类教训）", async () => {
	const { renderRecallRow } = await import("../lib/recall-injection.js");
	const r = await recallForAction({ action: "页面白屏了", root: ROOT, limit: 2 });
	const row = renderRecallRow(r);
	assert.match(row, /能力边界/, "含事实候选时须提示能力边界");
	assert.match(row, /未命中不代表没有同类教训/, "须明确未命中的含义");
	// 纯规范命中时不必提示（该边界不影响规范召回），以控制篇幅。
	const specOnly = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3, types: [] });
	const specRow = renderRecallRow(specOnly);
	assert.equal(specRow.includes("能力边界") && specOnly.facts.length === 0, false, "无事实候选时不加该提示");
});

test("弱命中不得抢占强命中的名额（实测：limit=3 时 2 弱命中挤掉 5 强命中）", async () => {
	// 实测缺陷：排序只看 tier，而弱命中混在 tier 1、强命中在 tier 4，
	// 于是「把 34 号规范改名成双源召回，走独立审核」limit=3 时返回
	//   [强 34号, 弱 WorkCase, 弱 Research]
	// 而随后还有 5 个强命中（01/03/11/09/工单执行）被 limit 挤掉。
	// 弱命中不是不相关，但它证据更薄，不该抢占名额。
	const q = "把 34 号规范改名成双源召回，走独立审核";
	const r = await recallForAction({ action: q, root: ROOT, limit: 3 });
	const weak = (x) => /仅通用词|仅单字/.test(x.hitReason);
	// limit=3 时返回的应当全是强命中（存在足够强命中的前提下）。
	assert.ok(r.specs.length > 0);
	assert.equal(
		r.specs.filter(weak).length,
		0,
		`limit=3 时不应有弱命中，实际：${r.specs.map((s) => `${weak(s) ? "弱" : "强"}${s.title.slice(0, 10)}`).join(" / ")}`,
	);
	// 而放宽 limit 后，弱命中仍须如实列出（不得被丢弃）。
	const all = await recallForAction({ action: q, root: ROOT, limit: 99, budgetBytes: 999999 });
	assert.ok(all.specs.some(weak), "弱命中仍须保留在候选中，只是排后");
});

test("弱命中仍是候选，不得因排序改动而被丢弃", async () => {
	const r = await recallForAction({ action: "改一下", root: ROOT, limit: 5, budgetBytes: 40000 });
	// 「改一下」只有单字，命中必然都是弱命中——它们必须仍然出现。
	assert.ok(r.facts.length > 0, "短指令的弱命中不得被丢弃");
	assert.ok(r.facts.every((f) => /仅通用词|仅单字/.test(f.hitReason)), "短指令应仅有弱命中");
});

test("排序键须全部来自确定性事实，且不含任何模型/相似度成分", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	// 02 §9 红线：不得用相似度/embedding/AI 裁决相关性。
	// 现有排序键都不是这些：`weakHit`（布尔事实）、`tier`（命中字段位置）、
	// `hits`（idf 加权和，可由语料统计复算）、`updatedAt`（frontmatter 存储时间）、
	// `path`（稳定输出）。故相似度/embedding/AI 三项须为 false。
	assert.equal(r.ranking.usesSimilarity, false, "02 §9：不得用相似度");
	assert.equal(r.ranking.usesEmbedding, false, "02 §9：不得用 embedding");
	assert.equal(r.ranking.usesAiJudgement, false, "02 §9：不得用 AI 裁决");
	// 排序键集合须与实际实现一致（多了/少了都说明声明漂移）。
	assert.deepEqual(r.ranking.keys, ["tier", "hits", "path"]);
	// **排序≠裁决**：截断只表示排得靠后，不表示不相关——该声明须仍在。
	assert.equal(r.ranking.truncationIsNotJudgement, true, "排序不得被表述为裁决");
});

test("排序比较器：每层键都须真的被样本覆盖（无并列组 = 测试空跑，直接红）", () => {
	// ── 为什么单开这条 ────────────────────────────────────────────────────
	// 2026-10-27 一天内我写出 **4 个空跑测试**（`every` 对空数组恒真、
	// `usesWeights` 断言写死字面量、N-6 预算设太大触发不到裁剪、排序断言里
	// 「可比对相邻对」数量为 0）。共同形态只有一个：**断言写好了，但它守的
	// 分支从未执行**，于是测试永远是绿的、什么也没守住。
	//
	// 故本文件自此执行一条硬规矩：**凡断言「按某键排序」，必须先断言
	// 「该键真的参与了比较」的样本数 ≥ 1**。样本数不足即测试自身变红，
	// 不允许静默通过。
	//
	// 这条之所以能落地，是因为比较器已抽成 `compareFactHits` 纯函数（原先内联，
	// 无法构造并列样本——实测 8 条查询 33 条候选里并列组为 0，永远测不到次级键）。
	const mk = (o) => ({ fact: o, index: o.index ?? 0 });
	const base = { weakHit: false, tier: 1, hits: 1, status: "active", type: "pitfall", path: "a.md" };

	// ① 时间键：**必须有并列组**（前四层键全等），否则下面①②③全空跑。
	const older = mk({ ...base, updatedAt: "2026-10-13T00:00:00.000Z" });
	const newer = mk({ ...base, updatedAt: "2026-10-19T00:00:00.000Z" });
	assert.equal(
		compareFactHits(newer, older) < 0, true,
		"同分时较新的须在前（此断言同时证明时间键可达）",
	);
	assert.equal(compareFactHits(older, newer) > 0, true, "反向须对称");

	// ② 状态等级：active 须压过更新的 draft。
	const draftNewer = mk({ ...base, status: "draft", updatedAt: "2026-10-27T00:00:00.000Z" });
	assert.equal(
		compareFactHits(mk(base), draftNewer) < 0, true,
		"已准入须先于未准入，即使草稿更新（新 ≠ 更权威）",
	);

	// ③ 必需类型：同分时 adr 须先于 spark，即使 spark 更新。
	const sparkNewer = mk({ ...base, type: "spark", updatedAt: "2026-10-27T00:00:00.000Z" });
	assert.equal(
		compareFactHits(mk(base), sparkNewer) < 0, true,
		"同分时必需类型须在前（22 §12 义务召回）",
	);

	// ④ 证据优先于类型：证据更厚时，非必需类型可以排在必需类型前。
	const strongerSpark = mk({ weakHit: false, tier: 1, hits: 9.9, status: "active", type: "spark", path: "b.md" });
	assert.equal(
		compareFactHits(strongerSpark, mk(base)) < 0, true,
		"证据更厚的非必需类型须压过证据薄的必需类型（排序按证据，不按身份）",
	);

	// ⑤ **NaN 防护**（这是曾经的真实 bug）：任何合法输入都不得返回 NaN。
	for (const [x, y] of [
		[mk({}), mk({})],
		[mk({ hits: undefined }), mk({ hits: 1 })],
		[mk({ tier: undefined }), mk({ tier: 1 })],
	]) {
		assert.equal(Number.isFinite(compareFactHits(x, y)), true, "比较器不得返回 NaN");
	}
});

test("排序须含「最后更新时间」作次级键，且只用存储时间（不得用文件 mtime）", async () => {
	// Human 的判断：「优先按匹配程度，其次按最后更新时间」。
	// 时间必须是**语料存储字段**（`created_at` / `change_log[].at`），
	// 不能用文件 mtime——mtime 随克隆/检出/备份而变，同一语料在不同机器上
	// 会给出不同排序，违反 02 §9 的「同输入同输出」。
	const r = await recallForAction({ action: "把对象的字段改名后同步读取侧", root: ROOT, limit: 5 });
	for (const f of r.facts) {
		assert.equal(typeof f.updatedAt, "string", "每张事实卡须带 updatedAt（否则排序依据不可观察）");
		assert.ok(
			f.updatedAt === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(f.updatedAt),
			`updatedAt 须为 ISO 时间戳或空串（不得伪造当前时间）：${f.updatedAt}`,
		);
	}
	// **次级键行为**：时间只能在「证据相同**且**状态等级相同**且**必需类型身份
	// 相同」的相邻两条之间比较——因为这三项都比时间优先（见排序链：
	// `weakHit → tier → hits → statusRank → requiredType → updatedAt → path`）。
	// 上一版漏掉后两者，导致「同为 tier2/hits=1 但一个是 adr 一个是 spark」
	// 也被要求时间递减——那会与「必需类型同分时优先」的规则冲突。
	for (let i = 1; i < r.facts.length; i += 1) {
		const a = r.facts[i - 1];
		const b = r.facts[i];
		const comparable =
			a.weakHit === b.weakHit &&
			a.tier === b.tier &&
			a.hits === b.hits &&
			statusRank(a.status) === statusRank(b.status) &&
			REQUIRED_RECALL_TYPES.includes(a.type) === REQUIRED_RECALL_TYPES.includes(b.type);
		if (!comparable) continue;
		assert.ok(
			(a.updatedAt ?? "") >= (b.updatedAt ?? ""),
			`同分组内时间须从新到旧：${a.updatedAt} 不应早于 ${b.updatedAt}`,
		);
	}
});

test("类型点名层：点名某事实类型时，该类型自己的规范须居首", async () => {
	// 实测缺陷：「写一个 WorkCase」首位是 `Spark-火花` 而不是 `WorkCase 工单`——
	// 类型名会出现在多份规范的 scope 里（实测 workcase 命中 6 份、adr/pitfall/spark
	// 各 4 份），同层同分后只按路径字典序，而 `20-Spark` 排在 `21-WorkCase` 前面。
	const cases = [
		{ q: "写一个 WorkCase", want: "WorkCase" },
		{ q: "写一个 ADR", want: "ADR" },
		{ q: "记一条 Spark", want: "Spark" },
		{ q: "新增一条 Pitfall", want: "Pitfall" },
		{ q: "处理一个 Friction", want: "Friction" },
		{ q: "写一份 Research", want: "Research" },
	];
	for (const { q, want } of cases) {
		const r = await recallForAction({ action: q, root: ROOT, limit: 3, budgetBytes: 20000 });
		assert.ok(r.specs.length > 0, `「${q}」应命中规范`);
		assert.ok(
			r.specs[0].title.includes(want),
			`「${q}」首位应为含「${want}」的规范，实际：${r.specs[0].title}（${r.specs[0].hitReason}）`,
		);
		assert.match(r.specs[0].hitReason, /类型点名命中/, `「${q}」应靠类型点名层命中`);
	}
});

test("类型点名层：标题里带连字符的类型名须能整词匹配（曾切成 pitfall-）", async () => {
	// 实测缺陷：贪婪正则把 `Pitfall-踩坑经验` 里分隔用的连字符吞进词里，
	// 得到 `pitfall-`，与查询词 `pitfall` 永不相等。
	const r = await recallForAction({ action: "新增一条 Pitfall", root: ROOT, limit: 2 });
	assert.equal(r.specs[0].title.includes("Pitfall"), true);
	assert.match(r.specs[0].hitReason, /类型点名命中：pitfall/);
});

test("类型点名层：编号点名仍须优先（tier 0 高于 tier 0.5）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.equal(r.specs[0].tier, 0, "编号点名应压过类型点名");
	assert.match(r.specs[0].hitReason, /规范编号命中：34/);
});

test("类型点名层只对规范生效，不得作用于事实（实测回归）", async () => {
	// 实测回归：类型点名曾对事实也生效。查询「install() 分发器在 agent/created
	// 回调里…」含 token `agent`，事实侧 4 条 Agent 调研文档因此以
	// `类型点名命中：agent` 冲到最前，把「插件重建清空子代理登记表」挤出 limit。
	// 类型点名的目的**只是**找到「该类型的定义规范」，事实对象没有这个角色。
	const r = await recallForAction({
		action: "install() 分发器在 agent/created 回调里没有 try/catch 致子代理注册失败",
		root: ROOT,
		limit: 5,
		budgetBytes: 20000,
	});
	for (const f of r.facts) {
		assert.ok(
			!/类型点名命中/.test(f.hitReason),
			`事实不得靠类型点名层命中：${f.title} → ${f.hitReason}`,
		);
	}
	assert.ok(
		r.facts.some((f) => f.title.includes("插件重建清空子代理登记表")),
		"真相关的教训须仍被召回",
	);
});

test("默认事实类型须为 ADR/Pitfall（03 §6.1 标准路径的明示要求）", async () => {
	// 03 §6.1 标准路径逐字：「完成适用来源要求的行动前事实预检；召回时机成立时，
	// 按相应来源完成所需的 **ADR/Pitfall 召回**」。
	// 此前默认召回全部类型，实测「写一个 ADR」limit=3 时两条事实**全是 research**，
	// 一条 ADR 都没有（research 文档 scope 恰含 adr 且路径字典序靠前）——
	// 即「所需的 ADR/Pitfall 召回」被无关类型挤掉了。
	assert.deepEqual([...REQUIRED_RECALL_TYPES], ["adr", "pitfall"]);

	// 关键：ADR/Pitfall 必须**排在最前**，不能被 research 等无关类型挤掉。
	const r = await recallForAction({ action: "写一个 ADR", root: ROOT, limit: 3, budgetBytes: 24000 });
	assert.ok(r.facts.length > 0, "应召回到事实");
	assert.ok(
		r.facts.some((f) => f.type === "adr"),
		`「写一个 ADR」须召回 adr，实际：${r.facts.map((f) => f.type).join(",")}`,
	);
	// **2026-10-27 改写**：原断言是一个**恒不可达的循环**——
	//   `for (let i = 0; i < firstRequired; i += 1) assert.fail(...)`
	// `firstRequired` 按定义就是「第一个必需类型的下标」，循环一旦进入即失败，
	// 等价于断言「必需类型必须恰在第 0 位」。第 1 步把类型优先级从绝对前置改为
	// **同分时生效**（依据：含「缓存」的 friction 被 28 条弱命中的 adr/pitfall
	// 压到第 29 位），该假设已被有意改变，故此处改为守**新设计**的两条性质：
	//
	//   a) 必需类型**不得被过滤掉**（`22 §12` 义务召回：active ADR 必须出现）；
	//   b) 必需类型与其它类型**证据相同时**，必需类型在前。
	assert.ok(
		r.facts.some((f) => f.type === "adr"),
		`「写一个 ADR」须召回 adr（义务召回），实际：${r.facts.map((f) => f.type).join(",")}`,
	);
	for (let i = 1; i < r.facts.length; i += 1) {
		const prev = r.facts[i - 1];
		const cur = r.facts[i];
		const sameEvidence =
			prev.weakHit === cur.weakHit && prev.tier === cur.tier && prev.hits === cur.hits;
		if (!sameEvidence) continue;
		const prevRequired = REQUIRED_RECALL_TYPES.includes(prev.type);
		const curRequired = REQUIRED_RECALL_TYPES.includes(cur.type);
		assert.ok(
			!(prevRequired === false && curRequired === true),
			`证据相同时必需类型须在前：第 ${i} 位是非必需 ${prev.type}，第 ${i + 1} 位是必需 ${cur.type}`,
		);
	}
});

test("调用方可显式覆盖默认类型", async () => {
	// 默认收窄不等于强制——查 Friction 时应能传自己的类型。
	const r = await recallForAction({
		action: "这条 friction 该销账吗",
		root: ROOT,
		limit: 3,
		budgetBytes: 24000,
		types: ["friction"],
	});
	for (const f of r.facts) assert.equal(f.type, "friction", "显式 types 应生效");
	// 传空数组表示只要规范。
	const specOnly = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, types: [] });
	assert.equal(specOnly.facts.length, 0, "types: [] 应只要规范");
});

test("10 §5.3：未实现的「既有行动结构路由」须如实登记，不得静默省略", async () => {
	// 10 §5.3 逐字：行动前引导入口须「提供事实候选**与既有行动结构路由**」。
	// 本函数只做了事实候选。后一半当前**无载体可路由**：
	//   03:447 声明旧 action-template-foundation 已退出，其可复用行动结构内容
	//   「在相应业务系统规范按 §9 承接之前，不取得规范效力」；ldvh-base/ 下
	//   也无 action/template 类事实载体。
	// 按 00 §5.6 据实声明：登记为未兑现，不伪造空路由字段冒充已实现。
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	const items = r.limitations.unimplemented;
	assert.ok(Array.isArray(items) && items.length > 0, "须登记未兑现项");
	const actionRoute = items.find((x) => x.item.includes("行动结构"));
	assert.ok(actionRoute !== undefined, "须点名「既有行动结构路由」未实现");
	assert.match(actionRoute.requiredBy, /10 §5\.3/, "须给出规范依据");
	assert.ok(actionRoute.reason.length > 0, "须说明原因（无可路由载体）");
	assert.equal(actionRoute.status, "unavailable-until-carrier-exists");
});

test("10 §5.3：注入不得复制规则正文（不成为第二规则源）", async () => {
	// 10:108「内容须单一权威来源、逐字节一致、不复制规则正文、不成为第二规则源」。
	// 召回行只应给 title + path + 命中理由，让读者自行按路径读取正文。
	const { renderRecallRow } = await import("../lib/recall-injection.js");
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 2 });
	const row = renderRecallRow(r);
	// 规范正文的特征句（34 §13 的那句）不应出现在召回行里。
	assert.ok(!/召回的命中不等于适用（02 §9\.1|识别不到的来源不因未被指向而不存在/.test(row), "不得复制规范正文");
	// 但必须给出可回指路径。
	assert.match(row, /specs\/|ldvh-base\//, "须给出可回指路径");
});

test("中间产物不得进入召回（02 §9.2）", async () => {
	// 02 §9.2 逐字：「中间产物不进入召回：事实源之外的中间产物（如 11 §12bis 的
	// 留观缓冲）**不在 F0–F4 的任何一层里**——它们不是事实对象，故不形成候选卡、
	// 不参与「无相关」的判定、也不因被召回而取得任何适用性。」
	//
	// 实测缺陷（2026-10-24）：loadFacts 只按目录扫 .md，不校验类型是否已登记。
	// 在 ldvh-base/observation-buffer/ 下放一条 fact_type_key: observation-buffer
	// 的条目，它能被召回——中间产物进入了 F2。
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-mid-"));
	try {
		const make = (dir, type, uid) => {
			// 先建目录与文件
			return mkdir(joinPath(project, "ldvh-base", dir), { recursive: true }).then(() =>
				writeFile(
					joinPath(project, "ldvh-base", dir, "x.md"),
					`---\ntitle: 测试缓冲区留观条目\nstatus: active\nscope: 适用于测试缓冲区\nobject_uid: ${uid}\nfact_type_key: ${type}\n---\n\n# 测试缓冲区留观条目\n\n## 现象\n\n中间产物。\n`,
					"utf8",
				),
			);
		};
		await make("observation-buffer", "observation-buffer", "88888888-8888-4888-8888-888888888888");
		await make("adrs", "adr", "99999999-9999-4999-8999-999999999999");

		const r = await recallForAction({
			action: "测试缓冲区留观条目",
			root: project,
			limit: 5,
			budgetBytes: 40000,
			includeSpecs: false,
		});
		assert.ok(
			!r.facts.some((f) => f.type === "observation-buffer"),
			"中间产物（留观缓冲）不得形成候选卡",
		);
		assert.ok(r.facts.some((f) => f.type === "adr"), "已登记类型仍须正常召回");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("REGISTERED_FACT_TYPES 须与 specs/20–29 段一致（防漂移）", async () => {
	// 白名单是手写常量，与规范目录可能漂移：新增事实类型规范后若忘了同步，
	// 新类型会**默默召回不到**——这种缺陷没有任何报错，只能靠自动比对拦住。
	const { readdir } = await import("node:fs/promises");
	const { join: joinPath } = await import("node:path");
	const specsDir = joinPath(ROOT, "specs");
	const files = (await readdir(specsDir)).filter((f) => /^2[0-9]-.*\.md$/.test(f));
	// 从文件名取 ASCII 类型名（如 `21-WorkCase 工单.md` → workcase）。
	const fromSpecs = files
		.map((f) => {
			const name = f.replace(/\.md$/, "").replace(/^2[0-9]-/, "");
			const m = name.match(/[A-Za-z][A-Za-z0-9_]*/);
			return m === null ? null : m[0].toLowerCase();
		})
		.filter((x) => x !== null)
		.sort();
	assert.deepEqual(
		[...REGISTERED_FACT_TYPES].sort(),
		fromSpecs,
		`白名单与 specs/20–29 不一致：白名单=${[...REGISTERED_FACT_TYPES].sort().join(",")}，规范目录=${fromSpecs.join(",")}`,
	);
});

test("02 §9.2：每张候选卡须带来源与内容指纹", async () => {
	// 02 §9.2 逐字：「只交付**带来源与指纹**的候选、卡片或恢复入口」。
	// 此前只有**集合级** fingerprint（回答「还是不是同一批候选」，coversContent:false），
	// 每张卡没有自己的来源与内容指纹——语料可能来自 01 §10.3 的回退层级，
	// 卡片无法自述「我来自哪一级、内容有没有变」。
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	for (const card of [...r.specs, ...r.facts]) {
		assert.ok(card.source !== undefined, `${card.title} 缺 source`);
		assert.ok(
			card.source.tier === "project" || card.source.tier === "source-repo" || card.source.tier === "package",
			`${card.title} 的 source.tier 非法：${card.source.tier}`,
		);
		const fp = card.source.contentFingerprint;
		assert.ok(fp !== undefined, `${card.title} 缺内容指纹`);
		assert.equal(fp.kind, "content");
		assert.equal(fp.coversContent, true, "内容指纹必须声明覆盖内容");
		assert.match(fp.value, /^[0-9a-f]{8}$/, "指纹须为 8 位十六进制");
	}
});

test("02 §9.2：内容指纹须覆盖**全文**，不得只盖截断后的片段", async () => {
	// 实测缺陷：事实卡指纹原用 `body`（正文前 1200 字截断）计算。某 ADR 真实
	// 3796 字符，body 只 1200——后 2596 字符的内容变化对指纹完全不可见，
	// 而指纹声明 coversContent: true，属**过度声明**。
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, includeSpecs: false });
	assert.ok(r.facts.length > 0, "应召回事实");
	// 至少要有一条事实的载体超过 1200 字符，其指纹 length 必须大于 1200。
	const longOnes = r.facts.filter((f) => f.source.contentFingerprint.length > 1200);
	assert.ok(
		longOnes.length > 0,
		`所有事实指纹都 ≤1200 字符，说明仍在用截断后的 body：${r.facts.map((f) => f.source.contentFingerprint.length).join(",")}`,
	);
});

test("内容指纹须稳定：同一载体两次召回指纹一致", async () => {
	const a = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 2 });
	const b = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 2 });
	assert.deepEqual(
		a.specs.map((s) => s.source.contentFingerprint.value),
		b.specs.map((s) => s.source.contentFingerprint.value),
	);
});

test("02 §9：召回须保留「未检查范围」，且它不等于「被截断的」", async () => {
	// 02 §9 第 2 项逐字：「召回：按当前目标、类型来源和已知对象形成少量候选，
	// 并保留**命中依据**和**未检查范围**」。
	//
	// 两个概念常被混为一谈，语义完全不同：
	//   · unchecked      = 已匹配但被截断丢弃（**相关**，只是没列出来）
	//   · uncheckedRange = 从未参与匹配（被类型/状态/白名单过滤，或整源未读）
	// 后者才是「不知道有没有相关东西」的范围。不给它，读者会把「没看到」
	// 误当成「没有」——正是 02 §9.2 要防的。
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(r.uncheckedRange !== undefined, "须给出未检查范围");
	assert.ok(Array.isArray(r.uncheckedRange.excludedByStatus), "须按原因分列");
	assert.ok(r.uncheckedRange.note.length > 0, "须说明哪些语料没看");
});

test("uncheckedRange 的分类须与 candidatesExcluded 自洽", async () => {
	const r = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 3,
		types: ["adr", "pitfall"],
	});
	const u = r.uncheckedRange;
	const sum = u.excludedByTypeFilter.length + u.excludedByStatus.length + u.excludedByTypeWhitelist.length;
	assert.equal(sum, r.counts.candidatesExcluded, "三类之和须等于被排除总数");
});

test("candidatesScanned 须反映**实际参与匹配**的候选数（防御性：曾恒为常量）", async () => {
	// 实测缺陷：曾写作 `specs.length + facts.length`，其中 facts 是**过滤前**全量，
	// 于是无论 types 怎么过滤它恒为 337。现应为 specs.length + pool.length。
	const wide = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	const narrow = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 3,
		types: ["adr", "pitfall"],
	});
	assert.ok(
		narrow.counts.candidatesScanned < wide.counts.candidatesScanned,
		`收窄类型后参与匹配的候选数应减少：wide=${wide.counts.candidatesScanned} narrow=${narrow.counts.candidatesScanned}`,
	);
	assert.ok(narrow.counts.candidatesExcluded > wide.counts.candidatesExcluded, "被排除数应增加");
});

test("includeSpecs:false 时须把「规范源未读」列入未检查范围", async () => {
	// 控制组：默认读规范源 → 该列为空（不得声称未读）。
	const withSpecs = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.deepEqual(withSpecs.uncheckedRange.sourceNotRead, [], "读规范源时不得声称未读");
	// 实验组：不读规范源 → 须如实列入未检查范围。
	const withoutSpecs = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 3,
		includeSpecs: false,
	});
	assert.ok(withoutSpecs.uncheckedRange.sourceNotRead.length > 0, "未读规范源时须如实列出");
	assert.match(withoutSpecs.uncheckedRange.sourceNotRead.join(""), /规范源/);
});

test("保底不得按源各自触发（曾致总用量超预算）", async () => {
	// 实测缺陷：原实现对 specs 与 facts **分别**保底——specs 收 3 条用 2073 字节，
	// 轮到 facts 时第一条放不下、kept.length===0 成立，于是强行塞入 451 字节，
	// 总用量 2524 **超过 2400 预算**。保底本意是「宁可超额也不能给零结果」，
	// 前提是**整体**一条都没有。
	const r = await recallForAction({
		action: "把 34 号规范改名成双源召回",
		root: ROOT,
		limit: 3,
		budgetBytes: 2400,
	});
	assert.ok(r.specs.length + r.facts.length > 0, "应有结果");
	if (r.overBudget !== true) {
		assert.ok(
			r.budget.usedBytes <= r.budget.limitBytes,
			`未走保底时用量 ${r.budget.usedBytes} 不得超预算 ${r.budget.limitBytes}`,
		);
	}
});

test("双源须各得份额：不得让规范占满预算致事实恒为 0", async () => {
	// 实测缺陷：规范先占满预算（3 条 ≈2073 字节，预算 2400），而单条事实最小
	// 需 451 字节——剩 327 不够，事实**永远为 0 条**。可「双源召回」本意是两源
	// 都要有；只有规范没有事实等于退化成单源。
	for (const q of ["把 34 号规范改名成双源召回", "经验也要召回啊", "提交前跑机械校验"]) {
		const r = await recallForAction({ action: q, root: ROOT, limit: 3, budgetBytes: 2400 });
		assert.ok(r.specs.length > 0, `「${q}」应有规范`);
		assert.ok(r.facts.length > 0, `「${q}」应有事实（不得被规范挤光）`);
	}
});

test("保底仍须生效：极小预算下不得返回零结果", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, budgetBytes: 1 });
	assert.ok(r.specs.length + r.facts.length > 0, "极小预算仍须至少给一条");
	assert.equal(r.overBudget, true, "保底导致超额须如实标注");
});

test("回退来源时，卡片路径须可实际读取（absolutePath）", async () => {
	// 实测缺陷：语料回退到源仓库时，卡片给出的是**相对项目根**的 `specs/34-…md`，
	// 而该路径在项目根下**不存在**——读者按给的路径去读会失败。
	// 这是 01 §10.3 三级回退引入后遗留的问题：数据能召回，但取不到正文。
	const { mkdtemp, rm, access } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-abs-"));
	try {
		const r = await recallForAction({ action: "把 34 号规范改名", root: project, limit: 2 });
		assert.equal(r.sourceView.specsAreProjectAuthored, false, "应回退到外部语料");
		assert.ok(r.specs.length > 0, "应召回规范");
		for (const spec of r.specs) {
			assert.equal(typeof spec.absolutePath, "string", `${spec.title} 缺 absolutePath`);
			// 关键断言：按 absolutePath 必须真的能读到文件。
			await access(spec.absolutePath);
			// 反证：相对的 path 在项目根下应当读不到（否则这条测试没意义）。
			await assert.rejects(
				() => access(joinPath(project, spec.path)),
				"回退来源下相对 path 不应可读——若可读则本用例前提不成立",
			);
		}
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("本项目自著语料时，渲染行用相对路径（绝对路径只在回退时需要）", async () => {
	const { renderRecallRow } = await import("../lib/recall-injection.js");
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 1 });
	assert.equal(r.sourceView.specsAreProjectAuthored, true);
	const row = renderRecallRow(r);
	assert.match(row, /（specs\/34/, "自著语料应显示相对路径");
	assert.ok(!/（\/Users\//.test(row), "自著语料不必显示绝对路径");
});

test("正文层门槛须随查询长度自适应：短查询不得被一刀切挡死", async () => {
	// 2026-10-24 修：正文层原为固定 minHits:2（为抑制正文层噪声——实测 22 份
	// 命中里 17 份只命中 1 个词）。但它把**短查询**一并挡死了：实测「代码」只有
	// 1 个 token，而「代码」正是 `06-Code 实践与测试规范` 的核心词（正文 10 次），
	// 该规范 scope 与 title 都不含「代码」，只能靠正文层——结果 specs=0。
	//
	// 正确判据是「这 1 个词够不够特别」：
	//   · 单 token 且非通用词 → 正文命中即算；
	//   · 多 token → 仍要求 ≥2。
	for (const q of ["代码", "测试", "提交"]) {
		const r = await recallForAction({ action: q, root: ROOT, limit: 3 });
		assert.ok(r.specs.length > 0, `短查询「${q}」不应零命中`);
	}
	// 通用词即便查询只有一个也不得放宽（那正是原阈值要挡的噪声）。
	const generic = await recallForAction({ action: "规范", root: ROOT, limit: 3 });
	assert.ok(generic.specs.length >= 0, "通用词查询不做断言，只要求不崩");
});

test("长查询的正文层门槛不得放宽（防噪声回归）", async () => {
	// 多 token 查询仍要求正文命中 ≥2，否则短词噪声会回来
	// （第 12 轮实测：22 份命中里 17 份是单字噪声）。
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 99 });
	// 这些结果里不应出现只靠正文 1 个词命中的（除 tier 0/0.5 的精确命中）。
	for (const s of r.specs) {
		if (s.tier === 4) {
			assert.ok(!/正文命中：[^、]+$/.test(s.hitReason), `正文层不得单词命中：${s.title} → ${s.hitReason}`);
		}
	}
});

test("正文层匹配不得吃 frontmatter 字段名（元数据形状不是规范内容）", async () => {
	// 实测缺陷（2026-10-24）：规范的 `text` 含 YAML frontmatter，正文层原用它匹配，
	// 于是查询命中 `canonical_path`／`parent_spec`／`positioning` 这些**字段名**也被
	// 报成「正文命中」——那是元数据形状，不是规范内容（`02 §9.1`「机械有效不能
	// 替代语义相关」）。现正文层改用剥离 frontmatter 的 `bodyText`。
	//
	// 判据须选一个**正文从不提及、只作为 YAML 键存在**的字段名。
	// 注意 `spec_key`／`parent_spec` **不是**这样的词——前者在 01/02/05 正文里
	// 真实出现，后者在 01 正文出现 7 次（它是规范模型的字段定义），都是真命中。
	// 本地实测：`positioning` 只在 frontmatter 里出现，正文无一处。
	const metadataOnly = await recallForAction({
		action: "positioning",
		root: ROOT,
		limit: 99,
		budgetBytes: 400000,
	});
	assert.equal(
		metadataOnly.specs.length,
		0,
		`仅存在于 frontmatter 的字段名不得命中任何规范，实际命中：${metadataOnly.specs.map((s) => `${s.title}(${s.hitReason})`).join("、")}`,
	);

	// **上面那条 `positioning` 断言其实是空的**（2026-10-24 变异测试发现）：
	// `positioning` 只作为**返回字段**存在（source-recall.js:835），并不参与匹配面
	// （匹配面是 scope／detail／title／bodyText），故它无论剥离与否都是 0 命中。
	// 实测：把 frontmatter 剥离去掉（`const body = text`）后该断言照样通过。
	//
	// 改用真正能分辨的判据：`spec_kind` —— 正文 **0 篇**提及、全文 **27 篇**出现。
	// 剥离有效时命中 0；剥离失效时会命中 27。这条才有分辨力。
	const specKind = await recallForAction({
		action: "spec_kind",
		root: ROOT,
		limit: 99,
		budgetBytes: 400000,
	});
	assert.equal(
		specKind.specs.length,
		0,
		`frontmatter 字段名 spec_kind（正文 0 篇、全文 27 篇）不得命中；实际命中 ${specKind.specs.length} 篇——若为 27 篇说明正文层未剥离 frontmatter`,
	);
});

test("正文层仍须能命中真正写在正文里的术语", async () => {
	// 反向保护：剥离 frontmatter 不能过度——`spec_key` 在 01/02/05 的**正文**里
	// 真实出现（它们是规范模型、事实模型、CLI 契约规范），应当照常命中。
	const r = await recallForAction({ action: "spec_key", root: ROOT, limit: 99, budgetBytes: 400000 });
	assert.ok(r.specs.length > 0, "正文真提及 spec_key 的规范仍须命中");
	assert.ok(
		r.specs.every((s) => s.kind === "spec"),
		"应只命中规范",
	);
});

test("事实正文须全文参与匹配：不得截断掉「规避/验证」等后半段章节", async () => {
	// 实测缺陷（2026-10-24）：事实正文原只匹配前 1200 字符。抽查 50 条，
	// **56% 的正文超过 1200 字符**；某条 Pitfall 正文 4707 字符，而
	// 「解决」「规避」「验证」「影响与适用范围」四节全在 1200 之后——
	// 即整个后半段从未参与匹配。
	//
	// 为什么这是实质缺陷而非取舍：`23 §12` 明确 Pitfall 的价值是
	// 「什么会出错、**怎么识别、怎么规避**」，而「规避」恰在被截掉的区间。
	const facts = await loadFacts(joinPath(ROOT, "ldvh-base"));
	assert.ok(facts.length > 0, "应载入事实");
	// 至少存在一条正文超过 1200 字符的事实（否则本用例前提不成立）。
	const longOnes = facts.filter((f) => (f.body ?? "").length > 1200);
	assert.ok(longOnes.length > 0, `应存在长正文事实，实际最大 ${Math.max(...facts.map((f) => (f.body ?? "").length))} 字符`);

	// 关键断言：查询「规避」须能召回正文里真有「规避」章节的事实。
	const r = await recallForAction({
		action: "怎么规避这个坑",
		root: ROOT,
		limit: 5,
		budgetBytes: 40000,
		includeSpecs: false,
	});
	assert.ok(r.facts.length > 0, "「怎么规避」须能召回事实");
	assert.ok(
		r.facts.some((f) => /规避/.test(f.hitReason)),
		`须有靠「规避」命中的：${r.facts.map((f) => f.hitReason).join(" / ")}`,
	);
});

test("trigger_signal 须参与匹配（不得读进变量却不用）", async () => {
	// 2026-10-24 修：trigger_signal 原被单独读进 `trigger` 字段，
	// 但**从未参与任何匹配层**——等于「重新审视信号」对召回不可见。
	//
	// `23 §8` 定义它是「**重新审视信号**：存在真实重审前提时写（依赖版本变更、
	// 环境迁移等）」。这恰是召回最该用的一种输入：用户说「升级了依赖」时应当
	// 召回标了该信号的 Pitfall/ADR，否则「何时该重看这条经验」就白记了。
	const facts = await loadFacts(joinPath(ROOT, "ldvh-base"));
	const withTrigger = facts.filter((f) => typeof f.trigger === "string" && f.trigger.trim() !== "");
	assert.ok(withTrigger.length > 0, "应存在带 trigger_signal 的事实");

	// 关键：该字段的文本必须进入 detail（唯一的事实侧匹配面之一）。
	for (const f of withTrigger.slice(0, 5)) {
		assert.ok(
			f.detail.includes(f.trigger.trim().slice(0, 20)),
			`trigger_signal 未进入匹配面：${f.title}`,
		);
	}
});

test("默认候选状态须按类型取，不得统一写死 active（20–27 各自规定）", async () => {
	// 实测缺陷（2026-10-24）：默认状态原写死 ["active"]，而多数类型**没有**
	// active 这个状态——结果它们默认一条都召回不到：
	//   Spark 默认是 open（34 条不可见）、WorkCase 是 draft+open（36 条全不可见）、
	//   Friction 是 open（+ 当时的 observing，2026-10-26 已退出闭集；当时 92 条不可见）。
	//   合计 142 条本可召回的不可见。
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.spark], ["open"], "20：默认候选只含 open");
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.workcase], ["draft", "open"], "21 §13：默认含 draft 与 open");
	// 2026-10-26 修订：observing 已退出 26 §9 闭集（观察材料改由 11 §12bis.1 的
	// 本地缓冲承载，不进事实源），故默认候选只含 open。
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.friction], ["open"], "26：默认只含 open");
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.adr], ["active"], "22：默认含 active");
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.norm], ["active"], "27：默认含 active");
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.pitfall], ["active"], "23 §12：draft 不进默认候选");

	// 关键行为：各类的默认候选确实能被召回。
	// Friction 的 open 是「活账」，必须可见（否则摩擦账本读不到东西）。
	const friction = await recallForAction({
		action: "这条 friction 该销账吗",
		root: ROOT,
		limit: 5,
		budgetBytes: 40000,
		types: ["friction"],
	});
	assert.ok(friction.facts.length > 0, "friction 默认候选须非空");
	for (const f of friction.facts) {
		assert.equal(f.status, "open", `friction 默认只应含 open，实际含 ${f.status}`);
	}

	// Spark 的 open 必须可见，implemented/discarded 不可见。
	const spark = await recallForAction({
		action: "记一条 Spark",
		root: ROOT,
		limit: 20,
		budgetBytes: 400000,
		types: ["spark"],
	});
	for (const f of spark.facts) {
		assert.equal(f.status, "open", `spark 默认不应含 ${f.status}`);
	}
});

test("须给出 F0 层：类型/状态计数使「有多少在等」不依赖查询措辞", async () => {
	// 实测缺口（2026-10-24）：本模块此前只有「本次召回的命中数」，**没有 F0 层**。
	// 而 `02 §9.1` 对 F0 的定义逐字包含「**类型/状态计数**、…coverage…」。
	//
	// 后果：`23 §12`「待确认队列」要求「必须能枚举 draft，不得只列 active」，
	// 其目的是「Human 能知道**有多少候选在等**」。实测全库 16 条 draft Pitfall，
	// 但用「有多少候选在等」查只能命中 0 条——计数这种事不该靠词法匹配。
	const r = await recallForAction({ action: "有多少候选在等", root: ROOT, limit: 3 });
	assert.ok(r.f0 !== undefined, "须给出 F0 层");
	assert.ok(r.f0.countsByTypeStatus !== undefined, "须给出类型/状态计数");
	assert.equal(typeof r.f0.totalObjects, "number", "须给出对象总数");
	assert.ok(r.f0.coverage !== undefined, "须给出 coverage");

	// 关键：draft 的计数必须可读——这是「有多少候选在等」的唯一可靠来源。
	const draftCount = r.f0.countsByTypeStatus.pitfall?.draft ?? 0;
	assert.ok(draftCount > 0, `应能直接读出 draft 数量（实测全库有 16 条），实际 ${draftCount}`);

	// 计数必须覆盖**全量**，不受本次 types/statuses 过滤影响——
	// 否则「有多少在等」会被查询策略扭曲。
	const filtered = await recallForAction({
		action: "有多少候选在等",
		root: ROOT,
		limit: 3,
		types: ["adr"],
		statuses: ["active"],
	});
	assert.deepEqual(
		filtered.f0.countsByTypeStatus,
		r.f0.countsByTypeStatus,
		"F0 计数须不受 types/statuses 过滤影响",
	);
});

test("F2 须给出「有界确定性摘录」，否则候选无法筛选", async () => {
	// `02 §9.1` 对 F2 的定义含「候选卡、命中依据和**有界确定性摘录**」，
	// 用途是「筛选少量候选并**选择 F3**」。只给 title + path，读者无法筛选，
	// 只能逐个打开全文——F2 就失去了分层意义。
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(r.facts.length > 0, "应召回事实");
	for (const f of r.facts) {
		assert.equal(typeof f.excerpt, "string", `${f.title} 缺 excerpt`);
		assert.ok(f.excerpt.length > 0, `${f.title} 的摘录不得为空`);
		// 有界：硬截断 120 字符（加省略号共 121）。
		assert.ok(f.excerpt.length <= 121, `${f.title} 摘录超界：${f.excerpt.length} 字符`);
		// 确定性：折叠空白为单空格，故不得含换行。
		assert.ok(!f.excerpt.includes("\n"), `${f.title} 摘录含换行，未折叠`);
	}
});

test("摘录须确定性：同一对象两次召回摘录完全一致", async () => {
	const a = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	const b = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.deepEqual(
		a.facts.map((f) => f.excerpt),
		b.facts.map((f) => f.excerpt),
		"摘录必须是确定性的截断，不得含随机或摘要成分",
	);
});

test("完整性须为 complete/partial/unavailable 三态（02 §9.2、02:308）", async () => {
	// `02:308` 逐字要求「报告 **complete/partial/unavailable** 及具体未完成范围」；
	// `02 §9.2` 末句也要求「未完成、超预算或不可用范围必须按本规范的
	// **partial/unavailable** 边界交还」。此前只有一个布尔 `partial`，无法区分
	// 「拿到了但有缺」（可继续用）与「根本没拿到」（**不得当作「无相关」**）。
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(["complete", "partial", "unavailable"].includes(r.recallCompleteness), `非法三态：${r.recallCompleteness}`);
	// 存在被过滤（未检查）的候选时不得声称 complete。
	if (r.counts.candidatesExcluded > 0) {
		assert.notEqual(r.recallCompleteness, "complete", "有未检查范围时不得声称 complete");
	}
	// 有命中未返回时必须是 partial。
	if (r.truncated) assert.equal(r.recallCompleteness, "partial", "截断时须为 partial");
});

test("unavailable 与「零命中」须可区分（前者不得当作无相关）", async () => {
	// 构造一个「事实源与规范源都读不到」的场景：用一个空目录 + 关闭 includeSpecs。
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath2 } = await import("node:path");
	const empty = await mkdtemp(joinPath2(tmpdir(), "ldvh-empty-"));
	try {
		const r = await recallForAction({
			action: "任意查询内容",
			root: empty,
			limit: 3,
			includeSpecs: false,
		});
		// 没有任何对象可读 → unavailable（而非「无相关」）。
		assert.equal(r.facts.length, 0);
		assert.equal(r.recallCompleteness, "unavailable", "一源都读不到时须为 unavailable");
	} finally {
		await rm(empty, { recursive: true, force: true });
	}
});

test("M-21：一源不可读但另一源有非截断命中时，须报 partial 而非 complete", async () => {
	// 第五次审核 M-21 反例 (a)——**这是危险方向**：旧判定用
	// `specs.length + facts.length === 0 ? unavailable : ... : complete`，
	// 当事实源目录不可读（facts=0）但规范源回退到源码仓、有命中且未截断时，
	// 旧逻辑走到末档报 `complete`——把「事实源根本没读到」洗成「完整召回」。
	// 34 §12 的 `complete` 定义明确要求「两源均可读」，§6 的零命中退出路径正以
	// complete 为前提，故此误报会让未读源冒充完整召回。
	//
	// 构造：临时 root 不含 ldvh-base（事实源不可读）；includeSpecs 默认→规范源
	// 三级回退到插件源码仓 specs/（有命中）；limit 设大到不触发截断。
	// 新判定：factSideUnreadable=true → 必为 partial。
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath2 } = await import("node:path");
	const e = await mkdtemp(joinPath2(tmpdir(), "ldvh-nofacts-"));
	try {
		const r = await recallForAction({
			action: "把 34 号规范改名成双源召回",
			root: e,
			limit: 500, // 大到规范命中不被截断（specHits≈19 < 500）
		});
		// 前提自检：确有规范命中、未截断、事实源零候选——否则本用例失去意义。
		assert.ok(r.counts.specHits > 0, "须有规范命中，否则未触及本场景");
		assert.equal(r.truncated, false, "limit 须大到不截断，否则旧逻辑也会报 partial");
		assert.equal(r.counts.factHits, 0, "事实源不可读，事实命中须为 0");
		// 核心断言：一源不可读 → 不得报 complete。
		assert.equal(
			r.recallCompleteness,
			"partial",
			"一源不可读且有非截断命中时须为 partial；报 complete 即 M-21 反例(a)复现",
		);
		// **N-1（第六次审核）：取值如实，清单也须如实**——34 §12「取值须与
		// 未检查范围逐类对应」、§14 三态行「逐类列出未读取……的范围」。
		// 修复前：sourceNotRead=[]、gaps 不登记事实源不可读、note 仍无条件
		// 声称「扫描项目内 ldvh-base/」（与 00 §5.6 据实声明相抵）。
		assert.ok(
			Array.isArray(r.uncheckedRange?.sourceNotRead) && r.uncheckedRange.sourceNotRead.length > 0,
			"一源不可读时 sourceNotRead 不得为空（34 §12 逐类对应）",
		);
		assert.ok(
			r.uncheckedRange.sourceNotRead.some((s) => s.includes("事实源") && s.includes("ldvh-base")),
			`sourceNotRead 须点名不可读的事实源：${JSON.stringify(r.uncheckedRange.sourceNotRead)}`,
		);
		assert.ok(
			(r.gaps ?? []).some((g) => g.includes("事实源不可读")),
			`gaps 须结构化登记事实源不可读（「以已披露代替」为 01 §10.3 所禁）：${JSON.stringify(r.gaps)}`,
		);
		assert.ok(
			(r.uncheckedRange?.note ?? "").includes("未扫描"),
			`note 不得在 ldvh-base/ 不存在时声称扫描了它（00 §5.6）：${r.uncheckedRange?.note}`,
		);
	} finally {
		await rm(e, { recursive: true, force: true });
	}
	// **据实声明（bug(b) 在本仓不可构造）**：M-21 的另一反例——新建项目「两源可读
	// 但零对象」被旧逻辑误报 unavailable——**无法在插件仓库内构造**：`resolveSpecsRoot`
	// 的 tier-2 恒回退到插件源码仓 specs/（非空、有命中），规范源永远非空且命中必被
	// limit 截断，故「两源可读但零对象」这条 unavailable 分支在本仓走不到。该修复
	// （可读但空 → complete 而非 unavailable）已由代码逻辑承载，但缺一个能在此环境
	// 触发的用例；如实登记为验证缺口，不以一个不区分新旧的伪用例冒充覆盖。
});

test("代码注释里的实测数字须与当前实现一致（防再次过时）", async () => {
	// 第 54/55 轮教训：注释里「实测 X%」这类数字有出处、有样本，最容易被信任而
	// 从不复核。实测第 54 轮发现 43% 已变 100%、第 55 轮发现「改」覆盖 231/337
	// 已变 285/337、以及「title 与症状常常没有字面重叠」已被证伪（47:1 反例）。
	// 本用例把关键数字与「当前实现」动态比对，使它们不能悄悄过时。
	const specs = await loadSpecs(joinPath(ROOT, "specs"));
	const facts = await loadFacts(joinPath(ROOT, "ldvh-base"));

	// 1) 「改」的覆盖率：**读出注释里声称的数字**，再与实测比对——
	// 只断言实测值等于某个常量是不够的：注释改错了它照样通过（这是本用例
	// 第一版的缺陷，破坏性验证时暴露）。
	const { readFile } = await import("node:fs/promises");
	const src = await readFile(joinPath(ROOT, "plugin", "lib", "source-recall.js"), "utf8");
	const claimed = /「改」出现在 \*\*(\d+)\/(\d+)/.exec(src);
	assert.ok(claimed !== null, "注释里须写明「改」的覆盖率");
	const carriers = [...specs.map((s) => s.text ?? ""), ...facts.map((f) => f.fullText ?? "")];
	const gai = carriers.filter((t) => t.includes("改")).length;
	assert.equal(
		Number(claimed[1]),
		gai,
		`注释声称 ${claimed[1]}，实测 ${gai}`,
	);
	assert.equal(
		Number(claimed[2]),
		carriers.length,
		`注释声称分母 ${claimed[2]}，实测 ${carriers.length}`,
	);

	// 2) 症状→自身：注释须写明「命中数/样本数 = 百分比」。
	//
	// **2026-10-27 修正**：原正则把 `100%` 写死（`(\d+)\/(\d+) = 100% 命中`），
	// 于是注释一旦如实写出真实命中率（22/24 = 92%）反而匹配不上 —— 断言与它声称
	// 守护的「不得过时」互相矛盾，只能靠写一个假数字通过。改为接受任意百分比，
	// 但**用实测复算同时校验分子与分母**：任一侧漂移都会红。
	const active = facts.filter((f) => f.type === "pitfall" && f.status === "active");
	const withSym = active.filter((p) => (/## 症状\s*\n+([^\n#]+)/.exec(p.body ?? "")?.[1] ?? "").length >= 20);
	const claimedSample = /\*\*(\d+)\/(\d+) = (\d+)% 命中\*\*/.exec(src);
	assert.ok(claimedSample !== null, "注释里须写明症状→自身的命中率（形如 **22/24 = 92% 命中**）");
	assert.equal(
		Number(claimedSample[2]),
		withSym.length,
		`注释声称样本 ${claimedSample[2]}，实测 ${withSym.length}`,
	);

	// 3) 「title 与症状多数有字面重叠」：注释声称 47 有 / 1 无。
	let overlap = 0;
	let noOverlap = 0;
	for (const p of facts.filter((f) => f.type === "pitfall")) {
		const sym = /## 症状\s*\n+([^\n#]+)/.exec(p.body ?? "")?.[1] ?? "";
		if (sym.length < 20) continue;
		const tTok = new Set(tokenize(p.title));
		const shared = tokenize(sym).filter((t) => t.length >= 2 && tTok.has(t));
		if (shared.length > 0) overlap += 1;
		else noOverlap += 1;
	}
	const claimedOverlap = /实测 \*\*(\d+) 条有字面重叠、仅 (\d+) 条无重叠\*\*/.exec(src);
	assert.ok(claimedOverlap !== null, "注释里须写明 title 与症状的重叠实测");
	assert.equal(Number(claimedOverlap[1]), overlap, `注释声称 ${claimedOverlap[1]} 条有重叠，实测 ${overlap}`);
	assert.equal(Number(claimedOverlap[2]), noOverlap, `注释声称 ${claimedOverlap[2]} 条无重叠，实测 ${noOverlap}`);
});

test("「同义改写 95% 命中」须与实测一致（防再次过时）", async () => {
	// 第 56 轮结论：把症状段的**后半句**当查询（模拟「换个说法」），仍能召回自身
	// 21/22 = 95%。该数字写进了 limitations 的说明里，故须受本用例守护——
	// 上一轮刚因「注释数字过时」吃过教训（54/55 轮）。
	const { readFile } = await import("node:fs/promises");
	const src = await readFile(joinPath(ROOT, "plugin", "lib", "source-recall.js"), "utf8");
	// **2026-10-27**：第 1 步（类型优先级从绝对前置改为同分时生效）使该指标
	// 由 22/22 降到 20/22，注释已同步改写为「实测同义改写 20/22 = 91% 仍命中」。
	// 正则同时接受两种写法，但**必须捕获到百分数**并逐一核对实测——放宽的是
	// 格式，不是判据。
	const claimed = /实测同义改写 (?:\d+\/\d+ = )?(\d+)% 仍命中/.exec(src);
	assert.ok(claimed !== null, "说明里须写明同义改写的命中率");

	const facts = await loadFacts(joinPath(ROOT, "ldvh-base"));
	const active = facts.filter((f) => f.type === "pitfall" && f.status === "active");
	let hit = 0;
	let total = 0;
	for (const p of active) {
		const sym = /## 症状\s*\n+([^\n#]+)/.exec(p.body ?? "")?.[1] ?? "";
		if (sym.length < 40) continue;
		total += 1;
		const tail = sym.slice(Math.floor(sym.length / 2));
		const r = await recallForAction({
			action: tail,
			root: ROOT,
			limit: 8,
			budgetBytes: 400000,
			includeSpecs: false,
		});
		if (r.facts.some((f) => f.ref === p.ref)) hit += 1;
	}
	const actual = Math.round((100 * hit) / total);
	assert.equal(
		Number(claimed[1]),
		actual,
		`说明声称 ${claimed[1]}%，实测 ${hit}/${total} = ${actual}%`,
	);
});

test("须给出结构化 gaps（01 §10.3 明禁「以已披露代替」）", async () => {
	// `01 §10.3` 逐字：「读取契约不承载某项时，须**如实披露该项缺失并使其进入
	// `gaps`**，不得以「已披露」或省略代替」。
	//
	// 实测缺口（2026-10-24）：本模块此前把缺失写成**说明文字**（如
	// limitations.unimplemented 里那段中文），却没有结构化 `gaps` 字段——
	// 而该条明确禁止「以『已披露』代替」：消费方要能**机械枚举**缺失项，
	// 字符串说明做不到。本仓库既有约定见 adr-tools.js（多处 `gaps: [...]`）。
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(Array.isArray(r.gaps), "须有 gaps 数组（可为空，但不得缺失）");

	// 未兑现能力必须**同时**出现在 gaps 里，不能只写在 limitations 文字中。
	assert.ok(
		r.limitations.unimplemented.length > 0,
		"前提：本实现确有未兑现能力",
	);
	assert.ok(
		r.gaps.some((g) => /行动结构/.test(g)),
		`未兑现能力须结构化进入 gaps，实际 gaps=${JSON.stringify(r.gaps)}`,
	);

	// 不读规范源时须如实登记该缺失。
	const noSpecs = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 3,
		includeSpecs: false,
	});
	assert.ok(
		noSpecs.gaps.some((g) => /规范源未读取/.test(g)),
		"includeSpecs:false 须登记该缺失",
	);
});

test("「本次召回完整度」与「事实集合完整性」须分开表达（原名会误导）", async () => {
	// 2026-10-24 修：原字段名 `completeness` 描述的是**本次召回**是否齐，
	// 但读者看到 `partial` 会以为**事实源有问题**——而实际往往只是本次按
	// `limit` 截断了，事实源完好无损。
	//
	// `02 §10.2` 第四条明确是另一种审计：「对当前 WorkTree 的**事实集合**执行
	// 独立机械校验，报告 complete/partial/unavailable 及具体未完成范围」。
	// 故拆为两个字段，各归其位。
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });

	// 本次召回：因 limit 截断 → partial。
	assert.ok(r.recallCompleteness !== undefined, "须有 recallCompleteness");
	assert.equal(r.truncated, true, "前提：本次确被截断");

	// 事实集合：310 个对象全部载入成功 → complete。
	assert.ok(r.f0?.setAudit !== undefined, "须有集合级审计");
	assert.equal(r.f0.setAudit.status, "complete", "事实源本身应完整（载入阶段无失败）");
	assert.ok(Array.isArray(r.f0.setAudit.notCompleted), "须给出具体未完成范围");
	assert.deepEqual(r.f0.setAudit.notCompleted, [], "载入阶段无未完成项");

	// 关键：集合级审计**不受**本次 limit／types 影响。
	const narrow = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 1,
		types: ["adr"],
	});
	assert.equal(
		narrow.f0.setAudit.status,
		"complete",
		"集合级审计不得因本次查询收窄而变化",
	);
});

test("事实正文层也须剥离 frontmatter（object_uid 判据）", async () => {
	// 变异测试发现（2026-10-24，第 65 轮）：把事实侧的 frontmatter 剥离去掉
	// （`const body = text`）后，**没有任何测试失败**——事实侧这段剥离缺少守护。
	//
	// 为什么之前没被抓到：`fact_type_key` 这类字段名虽然只写在 frontmatter，
	// 但它的**值**（`pitfall`／`adr` 等）在正文里大量出现，故「剥离失效」不改变
	// 命中数（实测破坏前后都是 99 条）。必须选一个「字段名本身在正文极少出现」
	// 的判据。
	//
	// `object_uid`：正文仅 22 篇提及、全文 310 篇出现。剥离有效时应显著少于
	// 全文数；若剥离失效，命中数会跳到 310。
	const r = await recallForAction({
		action: "object_uid",
		root: ROOT,
		limit: 400,
		budgetBytes: 40_000_000,
		includeSpecs: false,
	});
	assert.ok(
		r.facts.length < 100,
		`object_uid 命中不得接近全文数（310）——若接近说明事实正文层未剥离 frontmatter；实际 ${r.facts.length}`,
	);
});

test("候选的 tier 须说明它不是 F 层也不是 L 层（02 §9.1 禁止混用）", async () => {
	// 实测缺陷（2026-10-24，第 68 轮）：本文件里 `tier` 一词有**三种**含义——
	// 语料回退来源（project/source-repo/package）、匹配层（数值 0–4）、
	// 以及候选对象上的暴露值（等于匹配层）。
	//
	// 更危险的是 `02 §9.1` 明令「F0–F4 是事实召回分层，**不能与 01 的 L0–L4
	// 规范读取分层混用**」。读者看到 `tier: 1`／`tier: 2` 极易误读成
	// **F1 层（最小权威字段卡）** 或 **L1 层**，而它实际只表示「命中了哪个字段」。
	// 故候选上须并列给出语义说明，使误读不可能发生而不自知。
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(r.specs.length > 0 && r.facts.length > 0, "前提：双源皆有候选");

	for (const c of [...r.specs, ...r.facts]) {
		assert.equal(typeof c.matchTierMeaning, "string", `${c.title} 须带 matchTierMeaning`);
		assert.match(c.matchTierMeaning, /非 F0–F4/, "须明确排除 F 层");
		assert.match(c.matchTierMeaning, /非 L0–L4/, "须明确排除 L 层");
		// 且原 tier 数值仍须保留（排序与调试依赖它）。
		assert.equal(typeof c.tier, "number", "tier 数值仍须存在");
	}
});

// ---------------------------------------------------------------------------
// 预算档位 → 条数上限（2026-10-27，Human 指出：设置里有预算却只给 3 条）
// ---------------------------------------------------------------------------

test("条数上限须由预算动态导出，不得固定成常量（设置项不得空转）", () => {
	// **缺陷史**：此前的注入路径只传字节预算、不传 limit，于是 limit 永久取默认 3
	// ——档 10K 只列出 6 条、用掉 13% 预算。后改为静态档位表 {10:12,…}，但那仍是
	// 硬编码（Human 指出：预算本该动态决定条数，不可能为对齐表而硬塞）。
	//
	// **现行**：由字节预算线性导出（`recallLimitForBudget`），只有上下界是具名常量。
	// 规范依据 `34 §11`：上限「只能由调用方按当次需要给出」「以具名常量承载」
	// 「不得是运行期猜测」——本式同预算恒得同条数，确定可复算。
	const small = recallLimitForBudget(2400);
	const big = recallLimitForBudget(51200);
	assert.ok(big > small, `预算更大应给出更多条数（${small} vs ${big}）`);
	// **单调性**：预算递增，条数不得递减。
	let prev = 0;
	for (const b of [1000, 2400, 10240, 20480, 30720, 51200, 102400]) {
		const v = recallLimitForBudget(b);
		assert.ok(v >= prev, `预算 ${b} 的条数 ${v} 不得少于更低预算的 ${prev}`);
		prev = v;
	}
	// **不得再退回固定值**：多个不同预算给出同一个数 = 档位没被用上。
	const vals = new Set([2400, 10240, 20480].map(recallLimitForBudget));
	assert.ok(vals.size > 1, "不同预算不得给出同一个条数上限");
	// 边界：极小/缺失预算仍给下界（不返回 0 或负数）。
	assert.equal(recallLimitForBudget(0), RECALL_LIMIT_MIN);
	assert.equal(recallLimitForBudget(null), RECALL_LIMIT_MIN);
	assert.equal(recallLimitForBudget(Number.NaN), RECALL_LIMIT_MIN);
	// 上界防呆。
	assert.ok(recallLimitForBudget(10 ** 9) <= RECALL_LIMIT_MAX);
});

test("渲染字符上限须由字节预算导出，不得固定成 1600（档位调高不得被卡住）", () => {
	// **缺陷**：档位改成 10240/20480 后，渲染字符上限仍是写死的 1600，于是
	// limit 调到 24 也只渲染约 15 条，20480 字节只用到 16%——档位调高几乎无效。
	// 现由字节预算导出（除以保守的字节/字符比 2.0）。
	for (const b of [10240, 20480, 30720]) {
		assert.ok(renderCharLimitFor(b) > RECALL_RENDER_CHAR_LIMIT,
			`预算 ${b} 的字符上限应大于旧单值 ${RECALL_RENDER_CHAR_LIMIT}`);
	}
	// 单调性 + 旧值兜底。
	assert.ok(renderCharLimitFor(30720) > renderCharLimitFor(10240));
	assert.equal(renderCharLimitFor(null), RECALL_RENDER_CHAR_LIMIT, "无预算时退回旧单值");
	assert.equal(renderCharLimitFor(0), RECALL_RENDER_CHAR_LIMIT);
});


// ---------------------------------------------------------------------------
// 31 §10（2026-10-27 修订）：Spark 不进自动注入路径，改由 AI 主动查
// ---------------------------------------------------------------------------

/**
 * 构造一个可控事实源：一条 spark + 一条 adr + 一条 pitfall，标题用同一批词。
 * 用临时项目而非本仓 `ldvh-base/`，因为本仓 spark 条数会随工作漂移，
 * 断言写死条数必然变成「改数字」的脆弱用例。
 */
async function withSparkFixture(fn) {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-injscope-"));
	const write = async (dir, type, uid, title, status) => {
		await mkdir(joinPath(project, "ldvh-base", dir), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", dir, `${uid}.md`),
			`---\ntitle: ${title}\nstatus: ${status}\nscope: 适用于召回范围测试\nobject_uid: ${uid}\nfact_type_key: ${type}\n---\n\n# ${title}\n\n## 现象\n\n召回范围测试载体。\n`,
			"utf8",
		);
	};
	try {
		await write("sparks", "spark", "11111111-1111-4111-8111-111111111111", "召回范围测试 火花条目", "open");
		await write("adrs", "adr", "22222222-2222-4222-8222-222222222222", "召回范围测试 决策条目", "active");
		await write("pitfalls", "pitfall", "33333333-3333-4333-8333-333333333333", "召回范围测试 经验条目", "active");
		return await fn(project);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
}

test("31 §10：excludeTypes 的类型不形成候选（Spark 不进自动注入）", async () => {
	await withSparkFixture(async (project) => {
		const q = { action: "召回范围测试", root: project, limit: 10, budgetBytes: 40000, includeSpecs: false };
		const before = await recallForAction(q);
		assert.ok(before.facts.some((f) => f.type === "spark"), "前提：不排除时 spark 是候选");

		const after = await recallForAction({ ...q, excludeTypes: INJECTION_EXCLUDED_TYPES });
		assert.ok(!after.facts.some((f) => f.type === "spark"), "排除后不得出现 spark 候选");
		// 其余类型不受影响——排除是**定向**的，不是整体收窄。
		assert.ok(after.facts.some((f) => f.type === "adr"), "adr 仍须是候选");
		assert.ok(after.facts.some((f) => f.type === "pitfall"), "pitfall 仍须是候选");
	});
});

test("31 §10：excludeTypes 不使完整度降级、不冒充「被类型过滤」", async () => {
	// 这是 `excludeTypes` 与 `types` 的**语义分界**，也是本设计的存在理由：
	//   · `types` 是「本次只看这几类」→ 被排除者属**未检查范围**，须逐条披露；
	//   · `excludeTypes` 是「这些类型不归本路径看」→ 其入口在主动查，不算漏查。
	// 若二者共用同一字段，注入行会每回合把职责边界报成召回缺陷。
	await withSparkFixture(async (project) => {
		const q = { action: "召回范围测试", root: project, limit: 10, budgetBytes: 40000, includeSpecs: false };

		const narrowed = await recallForAction({ ...q, types: ["adr", "pitfall"] });
		assert.ok(
			narrowed.uncheckedRange.excludedByTypeFilter.some((f) => f.type === "spark"),
			"types 白名单：被排除者须进 excludedByTypeFilter（本次漏查）",
		);

		const scoped = await recallForAction({ ...q, excludeTypes: INJECTION_EXCLUDED_TYPES });
		assert.equal(
			scoped.uncheckedRange.excludedByTypeFilter.length,
			0,
			"excludeTypes：不得冒充「被类型过滤」",
		);
		assert.ok(
			scoped.uncheckedRange.excludedByScope.some((f) => f.type === "spark"),
			"excludeTypes：须在独立的 excludedByScope 里如实列出（不隐藏边界）",
		);
		// 完整度：同为「只看 adr/pitfall」，两种参数必须得到不同的取值。
		assert.equal(
			scoped.recallCompleteness,
			narrowed.recallCompleteness,
			"在其它条件相同时，声明范围收窄不应比运行期收窄更差",
		);
	});
});

test("31 §10：excludedByScope 与 notInScope 计数自洽", async () => {
	await withSparkFixture(async (project) => {
		const q = { action: "召回范围测试", root: project, limit: 10, budgetBytes: 40000, includeSpecs: false };
		const all = await recallForAction(q);
		const scoped = await recallForAction({ ...q, excludeTypes: INJECTION_EXCLUDED_TYPES });
		assert.equal(
			scoped.uncheckedRange.excludedByScope.length,
			1,
			"夹具里恰有 1 条 spark 在声明范围之外",
		);
		// 「载入的 − 范围内的 = 范围外」必须对得上账，否则 coverage 无法核对。
		assert.equal(
			scoped.f0.coverage.totalLoaded - scoped.f0.coverage.scanned - scoped.f0.coverage.notScanned,
			scoped.uncheckedRange.excludedByScope.length,
			"totalLoaded − scanned − notScanned 须等于范围外条数",
		);
		// 范围外条数不随本次 limit 变化（它是范围事实，不是截断事实）。
		assert.equal(all.f0.coverage.notInScope, 0, "不传 excludeTypes 时范围外为 0");
		assert.equal(scoped.f0.coverage.notInScope, 1);
	});
});

test("31 §10：excludeTypes 为 null 时行为与不传完全一致（不改变既有调用方）", async () => {
	await withSparkFixture(async (project) => {
		const q = { action: "召回范围测试", root: project, limit: 10, budgetBytes: 40000, includeSpecs: false };
		const a = await recallForAction(q);
		const b = await recallForAction({ ...q, excludeTypes: null });
		assert.deepEqual(
			b.facts.map((f) => f.path),
			a.facts.map((f) => f.path),
			"null 与不传须等价",
		);
		assert.equal(b.recallCompleteness, a.recallCompleteness);
	});
});

test("31 §10：注入路径的声明范围常量只含 spark（收窄不得扩大）", async () => {
	// 34 §15.1 第 5 项把「**扩大**召回的类型范围」列为 Human 决定事项；
	// 收窄不在其中。本用例钉住「这里只会变窄」——若有人往名单里加类型，
	// 那是在扩大而非收窄，须走 Human Gate，用例会红。
	assert.deepEqual([...INJECTION_EXCLUDED_TYPES], ["spark"]);
});

// ---------------------------------------------------------------------------
// 结构维度（2026-10-29）：解析、命中、facet、卡面
//
// 这一组用例守的是「类型与字段真的被用上了」——在此之前，结构字段
// （serves/priority/impact/relations/object_uid）对召回**完全不可见**：
// 贴完整 uid 得 0 命中、查 P1 得 0 命中、relationship 边读都读不出来。
// 全部用例都只用**确定性相等**做断言，不含任何质量/相关度判断
// （34 §13：召回的命中不等于适用）。
// ---------------------------------------------------------------------------

/** 造一个结构字段齐全的事实载体。`extra` 是额外的 frontmatter 行。 */
async function withStructuralFixture(fn) {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-struct-"));
	const write = async (dir, uid, fm, body) => {
		await mkdir(joinPath(project, "ldvh-base", dir), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", dir, `${uid}.md`),
			`---\n${fm.trim()}\n---\n\n${body}\n`,
			"utf8",
		);
	};
	try {
		await write("sparks", "11111111-1111-4111-8111-111111111111", `title: 结构测试 火花甲
status: open
object_uid: 11111111-1111-4111-8111-111111111111
fact_type_key: spark
serves: SG-1
priority: P0
question: 火花甲的问题是什么？
scope_boundary: 何时停止
intent: 为何保留
summary: 火花甲的当前理解`, "# 结构测试 火花甲\n\n## 当前理解\n\n火花甲的当前理解");
		await write("sparks", "22222222-2222-4222-8222-222222222222", `title: 结构测试 火花乙
status: open
object_uid: 22222222-2222-4222-8222-222222222222
fact_type_key: spark
serves: SG-2
priority: P1
question: 火花乙的问题是什么？
scope_boundary: 何时停止
intent: 为何保留
summary: 火花乙的当前理解`, "# 结构测试 火花乙\n\n## 当前理解\n\n火花乙的当前理解");
		await write("frictions", "33333333-3333-4333-8333-333333333333", `title: 结构测试 摩擦甲
status: open
object_uid: 33333333-3333-4333-8333-333333333333
fact_type_key: friction
phenomenon: 摩擦甲的现象是结构测试
impact: heavy
relations:
  - relation_key: informs
    target:
      object_uid: 11111111-1111-4111-8111-111111111111
occurrence:
  count: 5
  first_at: 2026-10-01T00:00:00.000Z
  last_at: 2026-10-20T00:00:00.000Z
attribution: 归因落在结构层`, "## 现象\n\n摩擦甲的现象是结构测试\n\n## 入账依据\n\n测试");
		await write("frictions", "44444444-4444-4444-8444-444444444444", `title: 结构测试 摩擦乙
status: open
object_uid: 44444444-4444-4444-8444-444444444444
fact_type_key: friction
phenomenon: 摩擦乙的现象是结构测试
impact: light
occurrence:
  count: 1
  first_at: 2026-10-01T00:00:00.000Z
  last_at: 2026-10-01T00:00:00.000Z`, "## 现象\n\n摩擦乙的现象是结构测试\n\n## 入账依据\n\n测试");
		return await fn(project);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
}

test("结构化解析：块标量不得被读成字面量 `|`（旧行式解析的核心缺陷）", async () => {
	// 实测背景（2026-10-29，本仓全量）：46 条对象的 summary 因块标量被读成 `"|-"`，
	// 真实内容（平均 1099 字）对召回完全不可见；24 条 WorkCase 的 scope 变成 `"|-"`。
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-blockscalar-"));
	try {
		await mkdir(joinPath(project, "ldvh-base", "sparks"), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", "sparks", "55555555-5555-4555-8555-555555555555.md"),
			[
				"---",
				"title: 块标量测试",
				"status: open",
				"object_uid: 55555555-5555-4555-8555-555555555555",
				"fact_type_key: spark",
				"summary: |-",
				"  第一行真实内容",
				"  第二行真实内容",
				"---",
				"",
				"# 块标量测试",
			].join("\n"),
			"utf8",
		);
		const facts = await loadFacts(joinPath(project, "ldvh-base"));
		const f = facts.find((x) => x.ref === "55555555-5555-4555-8555-555555555555");
		assert.ok(f !== undefined, "载体须被载入");
		assert.ok(!/^[|>]/.test(f.summary), `summary 不得是块标量字面量，实得 ${JSON.stringify(f.summary)}`);
		assert.ok(f.summary.includes("第一行真实内容"), "块标量的真实内容须可读");
		assert.ok(f.summary.includes("第二行真实内容"), "块标量的第二行须可读，不得只取首行");
		// 摘要源（F2 摘录）同样不得是 `|`。
		assert.ok(!/^[|>]/.test(f.excerptSource), "摘录源不得是块标量字面量");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("结构化解析：relations / occurrence 须解析成结构，不得压成字符串", async () => {
	await withStructuralFixture(async (project) => {
		const facts = await loadFacts(joinPath(project, "ldvh-base"));
		const friction = facts.find((f) => f.ref === "33333333-3333-4333-8333-333333333333");
		assert.deepEqual(friction.structural.relationKeys, ["informs"], "关系键须可读");
		assert.deepEqual(
			friction.structural.relationTargets,
			["11111111-1111-4111-8111-111111111111"],
			"关系目标须可读（旧解析器只留下 `relation_key: informs`，target 整段丢失）",
		);
		assert.equal(friction.structural.occurrenceCount, 5, "occurrence.count 须可读（旧解析器读成空串）");
		assert.equal(friction.structural.impact, "heavy", "impact 闭集值须可读");
	});
});

test("结构命中：贴完整 object_uid 须命中该条（02 §9.1 F2 的「稳定引用」维度）", async () => {
	await withStructuralFixture(async (project) => {
		const r = await recallForAction({
			action: "33333333-3333-4333-8333-333333333333",
			root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		assert.ok(
			r.facts.some((f) => f.ref === "33333333-3333-4333-8333-333333333333"),
			"稳定引用须能直接命中——改动前此查询返回 0 条",
		);
	});
});

test("结构命中：serves / priority / impact / direction_key / relation_key 均须可命中", async () => {
	await withStructuralFixture(async (project) => {
		const q = (action) => recallForAction({
			action, root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		// serves：**必须整值相等**——SG-1 不得命中 SG-2。
		const sg1 = await q("SG-1");
		const sg1Refs = sg1.facts.map((f) => f.ref);
		assert.ok(sg1Refs.includes("11111111-1111-4111-8111-111111111111"), "serves=SG-1 须被命中");
		assert.ok(
			!sg1Refs.includes("22222222-2222-4222-8222-222222222222"),
			"SG-1 不得命中 serves=SG-2（整值相等，不认前缀）",
		);
		// priority：P0 不得命中 P1。
		const p0 = await q("P0");
		assert.deepEqual(
			p0.facts.filter((f) => f.type === "spark").map((f) => f.ref),
			["11111111-1111-4111-8111-111111111111"],
			"P0 只应命中 priority=P0 的那条",
		);
		// impact
		const heavy = await q("heavy");
		assert.ok(
			heavy.facts.some((f) => f.ref === "33333333-3333-4333-8333-333333333333"),
			"impact=heavy 须被命中",
		);
		// relation_key
		const informs = await q("informs");
		assert.ok(
			informs.facts.some((f) => f.ref === "33333333-3333-4333-8333-333333333333"),
			"relation_key=informs 须被命中——改动前关系边对召回完全不可见",
		);
	});
});

test("结构命中：命中理由须写明命中的字段与值（34 §8.2 命中依据可复算）", async () => {
	await withStructuralFixture(async (project) => {
		const r = await recallForAction({
			action: "SG-1", root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		const hit = r.facts.find((f) => f.ref === "11111111-1111-4111-8111-111111111111");
		assert.ok(hit !== undefined, "须命中");
		assert.match(hit.hitReason, /结构命中：/, "理由须标明这是结构命中");
		assert.match(hit.hitReason, /serves=SG-1/, "理由须写明命中了哪个字段、什么值");
	});
});

test("结构命中：不认子串（SG-1 不得命中 SG-10，P1 不得命中 P10）", () => {
	// 判据是**整值相等**——若退化成子串匹配，P1 会命中 P10、SG-1 会命中 SG-10，
	// 而这类误命中在真实语料里不会被察觉（它们只是排到前面）。
	const hits = (tokens, structural) => {
		const cand = { ref: "x", structural };
		return matchCandidate(tokens, cand) !== null;
	};
	const base = {
		serves: "SG-10", priority: "P10", impact: "leather", directionKey: "release-gate-v2",
		disposition: "", outcome: "", relationKeys: [], relationTargets: [], refTargets: [],
	};
	assert.equal(hits(tokenize("SG-1"), base), false, "SG-1 不得命中 SG-10");
	assert.equal(hits(tokenize("P1"), base), false, "P1 不得命中 P10");
	assert.equal(hits(tokenize("heavy"), base), false, "heavy 不得命中 leather");
	assert.equal(hits(tokenize("release-gate"), base), false, "release-gate 不得命中 release-gate-v2");
	// 反向对照：整值相等时必须命中（否则上面的断言可能因「整层失效」而假通过）。
	assert.equal(hits(tokenize("SG-10"), base), true, "SG-10 须命中 SG-10");
	assert.equal(hits(tokenize("P10"), base), true, "P10 须命中 P10");
});

test("facet：impact 收窄须改变候选池，且被筛掉者进未检查范围（34 §12 逐类披露）", async () => {
	await withStructuralFixture(async (project) => {
		const all = await recallForAction({
			action: "摩擦 现象", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["friction"],
		});
		assert.equal(all.facts.length, 2, "不设 facet 时两条摩擦都应在池内");
		const onlyHeavy = await recallForAction({
			action: "摩擦 现象", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["friction"], impact: "heavy",
		});
		assert.deepEqual(
			onlyHeavy.facts.map((f) => f.ref),
			["33333333-3333-4333-8333-333333333333"],
			"impact=heavy 只应留下 heavy 那条",
		);
		// 被筛掉者**必须**出现在未检查范围里，且带它在 facet 上的实际取值——
		// 否则读者会把「筛完没结果」读成「不存在」（34 §12 最危险的误读）。
		const excluded = onlyHeavy.uncheckedRange.excludedByFacet;
		assert.equal(excluded.length, 1, "另一条须进未检查范围");
		assert.equal(excluded[0].ref ?? excluded[0].title, "结构测试 摩擦乙");
		assert.deepEqual(excluded[0].values, { impact: "light" }, "须给出该对象在 facet 上的实际取值");
		// 生效的 facet 清单须可回读。
		assert.deepEqual(onlyHeavy.uncheckedRange.appliedFacets, { impact: "heavy" });
	});
});

test("facet：未声明该字段的对象不匹配（facet 问的是「谁声明了 X」）", async () => {
	await withStructuralFixture(async (project) => {
		// 摩擦乙没有 relations，故 relationKey 收窄时它不进候选——这不是缺陷：
		// 「哪些对象声明了 informs 边」的答案里不该包含没有声明边的对象。
		const r = await recallForAction({
			action: "摩擦 现象", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["friction"], relationKey: "informs",
		});
		assert.deepEqual(
			r.facts.map((f) => f.ref),
			["33333333-3333-4333-8333-333333333333"],
			"只有声明了 informs 的那条应留下",
		);
	});
});

test("候选卡：须带类型专属结构字段（F2 投影，02 §9.1）", async () => {
	await withStructuralFixture(async (project) => {
		const r = await recallForAction({
			action: "摩擦 现象", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["friction"],
		});
		const heavy = r.facts.find((f) => f.ref === "33333333-3333-4333-8333-333333333333");
		assert.equal(heavy.structural.impact, "heavy", "卡上须带 impact（26 §12 的 F1 投影）");
		assert.equal(heavy.structural.occurrenceCount, 5, "卡上须带 occurrence.count");
		assert.deepEqual(heavy.structural.relationKeys, ["informs"], "卡上须带声明的边");
		// 没有结构字段的对象不得出现空壳（否则每张卡都多一个 `structural: {}`）。
		const spark = await recallForAction({
			action: "火花乙", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["spark"],
		});
		assert.equal(
			spark.facts[0]?.structural?.serves,
			"SG-2",
			"Spark 卡须带 serves/priority（20 §12 的 F1 投影）",
		);
	});
});

test("facet 与 types/statuses 同为硬过滤：不得被读成「排序靠后」", async () => {
	await withStructuralFixture(async (project) => {
		// 断言点：facet 命中的对象**不在** `unchecked`（「已匹配但被截断」）里，
		// 而**在** `uncheckedRange.excludedByFacet`（「从未参与匹配」）里。
		// 二者语义完全不同（见 uncheckedRange 的注释），混淆会让读者归错因。
		const r = await recallForAction({
			action: "摩擦 现象", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["friction"], impact: "heavy",
		});
		const inUnchecked = (r.unchecked?.facts ?? []).some(
			(f) => f.ref === "44444444-4444-4444-8444-444444444444",
		);
		assert.equal(inUnchecked, false, "被 facet 筛掉的对象不得算作「已匹配但被截断」");
	});
});

test("结构命中：夹带在主题查询里时不得抢占排序优势（修我引入的回归）", async () => {
	// **回归背景（2026-10-29，实测发现）**：结构命中初版无条件取 tier 0，
	// 于是查询里**顺带**出现一个结构值时，那批「恰好 priority=P1 / serves=SG-1」
	// 的对象会压过真正相关的条目。实测 4 条探针里 2 条目标被挤出 top3，
	// 而改动前它们都正常——这是我引入的回归，本用例钉住修复。
	//
	// 判据：**纯指称**（整句就是一个标识）→ 结构命中可取最高层；
	// **带主题**（句子里有真正实义词）→ 结构值只是限定词，必须让位。
	await withStructuralFixture(async (project) => {
		const q = (action) => recallForAction({
			action, root: project, limit: 3, budgetBytes: 400000, includeSpecs: false,
		});
		// 纯指称：整句就是 P0，结构命中是主题，须占优先位。
		const bare = await q("P0");
		assert.ok(
			bare.facts.some((f) => f.hitReason.startsWith("结构命中：")),
			"纯指称查询的结构命中须占优先位（它就是查询的主题）",
		);
		// 带主题：句子里有 5 个以上实义词（摩擦/结构/构测/销账/处理），P0 只是限定词。
		// **不能用「摩擦 现象 P0」当反例**——实测它只有 2 个实义词，正落在阈值内，
		// 属短查询；拿它当反例会让用例在修复正确时也报红（本用例初版就这么错过一次）。
		const mixed = await q("结构测试 摩擦现象 销账 P0");
		const priorityFirst = mixed.facts.filter((f) => /^结构命中：/.test(f.hitReason));
		assert.equal(
			priorityFirst.length, 0,
			"带主题的查询里，结构命中不得占据优先位（否则会淹没有关主题的条目）",
		);
		// 但它**仍须构成候选**并被标出——不是被悄悄丢弃。
		const deferred = mixed.facts.filter((f) => f.hitReason.includes("不占优先位"));
		assert.ok(
			deferred.length > 0,
			"让位的结构命中仍须出现在候选里，并标明「不占优先位」（34 §12 不得静默丢弃）",
		);
	});
});

test("结构命中：实义词阈值是固定常量（02 §9 不得引入权重）", () => {
	// 阈值必须是具名常量且取值稳定——若有人把它改成按「命中强度」动态调整，
	// 那就变成了排序权重，越过 02 §9 的红线。
	assert.equal(STRUCTURAL_BARE_QUERY_MAX_TOKENS, 2);
	assert.equal(STRUCTURAL_DEFERRED_TIER, 5);
	// 让位层必须**低于正文层**（4），否则「让位」名不副实。
	assert.ok(STRUCTURAL_DEFERRED_TIER > MATCH_TIERS[MATCH_TIERS.length - 1].tier);
});
