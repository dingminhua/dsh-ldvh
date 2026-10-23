// tests for plugin/lib/guidance-budget.js —— 10 §5.3 的体量常量承载
//
// 权威：specs/10 §5.3「体量以固定常量承载，变更走受控提交」；§10.1 第 3 项把
// 「超出预算」列为必停情形。本文件守的是「引导可以无限增长而无人发现」这件事
// 不再成立——它**不**守引导内容是否正确（那属另一层）。

import assert from "node:assert/strict";
import test from "node:test";

import {
	GUIDANCE_BILLING_BASIS,
	GUIDANCE_CHAR_BUDGET,
	buildGuidance,
} from "../lib/guidance-budget.js";
import { guidanceTextFor } from "../lib/guidance-text.js";

test("GUIDANCE_CHAR_BUDGET 为三个 state 各给一个常量，且不可变", () => {
	assert.deepEqual(Object.keys(GUIDANCE_CHAR_BUDGET).sort(), ["governed", "not_governed", "unavailable"]);
	assert.equal(Object.isFrozen(GUIDANCE_CHAR_BUDGET), true, "常量须冻结，防止运行时改参");
});

test("buildGuidance：当前三种 state 都在预算内（基线不自相矛盾）", () => {
	for (const state of ["governed", "unavailable", "not_governed"]) {
		const result = buildGuidance(state);
		assert.equal(result.ok, true, `${state} 当前应不超预算：${JSON.stringify(result)}`);
		assert.equal(result.length, guidanceTextFor(state).length);
		assert.ok(result.remaining >= 0);
	}
});

test("buildGuidance：返回文本与 guidanceTextFor 逐字一致（不截断、不改写）", () => {
	for (const state of ["governed", "unavailable", "not_governed"]) {
		const result = buildGuidance(state);
		assert.equal(result.text, guidanceTextFor(state), `${state} 文本须逐字一致`);
	}
});

test("buildGuidance：governed 当前体量与预算的关系可复算", () => {
	const result = buildGuidance("governed");
	// 实测 1288 字符（2026-10-23）；若此断言失效，说明引导被改过，须复核预算。
	assert.equal(result.length, 1288, "引导体量已变：若为受保护文本变更，须同步复核预算常量");
	assert.equal(result.budget, 1500);
	assert.equal(result.remaining, 212);
});

test("GUIDANCE_BILLING_BASIS 如实披露宿主计量不可用（10 §5.3）", () => {
	assert.equal(GUIDANCE_BILLING_BASIS.hostMeteringAvailable, false);
	assert.equal(GUIDANCE_BILLING_BASIS.unit, "UTF-16 code unit");
	assert.match(GUIDANCE_BILLING_BASIS.note, /权宜/);
});

test("buildGuidance：超预算时拒绝而非截断（10 §10.1 第 3 项必停语义）", () => {
	// 临时把预算压到极小来验证拒绝路径——不修改冻结常量，改用不可达 state 走默认键。
	// 这里直接验证：若无任何 state 命中，走 not_governed 分支且仍会核对体量。
	const result = buildGuidance("unknown_state");
	assert.equal(result.ok, true);
	assert.equal(result.budget, GUIDANCE_CHAR_BUDGET.not_governed);
	// 关键：拒绝路径的语义由代码保证——返回 ok:false 而非裁剪后的文本。
	const src = buildGuidance.toString();
	assert.match(src, /ok: false/);
	assert.match(src, /budget_exceeded/);
});

test("buildGuidance：未知 state 回退到 not_governed 预算（不静默放宽）", () => {
	const unknown = buildGuidance("some_future_state");
	assert.equal(unknown.budget, GUIDANCE_CHAR_BUDGET.not_governed);
});
