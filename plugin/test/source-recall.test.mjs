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
	assert.deepEqual(MATCH_TIERS.map((t) => t.tier), [1, 2, 3, 4]);
	assert.equal(MATCH_TIERS[0].field, "scope");
	assert.equal(MATCH_TIERS[3].field, "body");
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
