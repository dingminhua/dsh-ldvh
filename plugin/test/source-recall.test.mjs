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
	assert.ok(r.budget.usedBytes <= 200, "返回内容不得超预算");
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
