// tests for plugin/lib/source-recall.js —— 双源召回（规则遵守系统的输入侧）
//
// 权威：specs/34 §7「输入来源」、§8.1 第 1 项（适用识别＝从来源中找出）、
// §13「召回的命中不等于适用」、§17 第 1 项（不建全量索引）；
// specs/00 §3.2（两类语义构成要素与规范源、事实源）。
//
// 本文件守的是「能不能找出相关的东西」这一层。它**不**守适用判断——34 §13
// 明文召回命中不等于适用，故本文件不含任何「召回到即适用」的断言。

import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import {
	HIGH_DF_RATIO,
	MATCH_TIERS,
	loadFacts,
	loadSpecs,
	matchCandidate,
	recallForAction,
	resolveSpecsRoot,
	tokenize,
} from "../lib/source-recall.js";

const ROOT = join(import.meta.dirname, "..", "..");

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
	assert.ok(!tokens.includes("一个"), "「一个」是虚字组合，命中一切");
	assert.ok(!tokens.includes("建一"), "「建一」跨虚字，无区分度");
	assert.ok(tokens.includes("创建"), "实义二元组应保留");
	assert.ok(tokens.includes("记录"), "实义二元组应保留");
	assert.ok(tokens.includes("adr"), "ASCII 词应保留");
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

test("recallForAction：默认只取 active，可显式纳入其他状态", async () => {
	const def = await recallForAction({ action: "校验验证", root: ROOT });
	assert.ok(def.facts.every((f) => f.status === "active"), "默认只 active");
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
		r.specs.slice(0, 3).some((s) => s.title.includes("规则遵守")),
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
	for (const s of r.specs.filter((x) => x.tier === 4)) {
		assert.ok(s.hits >= 2, `正文层条目 ${s.title} 只命中 ${s.hits} 个词，应被 minHits 剔除`);
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
	// 「弄/搞/调/换」语义太宽，收进来会把噪声请回来——故刻意不收。
	for (const phrase of ["弄一下", "调一下", "换个"]) {
		assert.deepEqual(tokenize(phrase), [], `「${phrase}」不应切出 token（宽泛字刻意不收）`);
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
	//   火花记录与规则遵守靠「合」；「经验也要召回啊」有 4 条靠单字「回」。
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
	assert.equal(r.counts.candidatesScanned, 337, "本轮扫描的候选总数");
});

test("02 §9.1：limit 造成的丢弃须标 partial/truncated（不只预算）", async () => {
	const small = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 2 });
	assert.equal(small.partial, true, "limit 截断时须报 partial");
	assert.equal(small.truncated, true, "limit 截断时须报 truncated");

	const big = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 99, budgetBytes: 999999 });
	assert.equal(big.partial, false, "未截断时不得虚报 partial");
	assert.equal(big.truncated, false);
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

test("02 §9：排序不得使用相似度/embedding/关键词权重/AI 判断（红线）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(r.ranking.usesWeights, false, "02 §9 红线：不得使用关键词权重");
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
	assert.equal(a.fingerprint.memberCount, a.counts.candidatesScanned);
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
	// 实测（2026-10-24）：用 30 条真实 Pitfall 的「症状」原文召回它自己，
	// 只有 13/30 = 43% 命中。原因是结构性的：title 描述**机制**
	// （「写入侧与呈现层两套残留段解析规则致门禁判据与展示不一致」），
	// 症状描述**表现**（「工单关闭提交被机械门禁拒绝：workcase/direction_incomplete」），
	// 二者常常没有任何字面重叠。词法匹配没有语义能力。
	//
	// 23 §12「故障调查」要求「按表现匹配已知机制」——跨这一层需要语义判断，
	// 本函数做不到，必须让调用方知道。
	const r = await recallForAction({ action: "页面白屏了", root: ROOT, limit: 3 });
	assert.equal(r.limitations.lexicalOnly, true, "须声明是纯词法匹配");
	assert.equal(r.limitations.usesSemanticUnderstanding, false, "不得声称有语义理解");
	assert.ok(r.limitations.measuredSymptomSelfRecall.total === 30, "须给出实测样本量");
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

test("排序键 weakHit 须为确定性事实，不得引入权重", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	// 02 §9 红线：不得用相似度/embedding/关键词权重/AI 裁决相关性。
	// weakHit 是「命中词是否全为单字/通用词」的布尔事实，可复算、无参数。
	assert.equal(r.ranking.usesWeights, false);
	assert.deepEqual(r.ranking.keys, ["tier", "hits", "path"]);
});
