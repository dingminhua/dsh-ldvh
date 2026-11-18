
import assert from "node:assert/strict";
import test from "node:test";

import {
	GUIDANCE_BILLING_BASIS,
	GUIDANCE_CHAR_BUDGET,
	GUIDANCE_EARLY_WARNING_RATIO,
	GUIDANCE_MEASURED_LENGTH,
	buildGuidance,
	evaluateGuidanceSize,
	guidanceLengthDrift,
	guidanceSizeAlerts,
	isWithinEarlyWarningBand,
	reportGuidanceSize,
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

test("buildGuidance：体量判据与预算常量的关系可复算（不钉死精确码元数）", () => {
	for (const state of ["governed", "unavailable", "not_governed"]) {
		const result = buildGuidance(state);
		const budget = GUIDANCE_CHAR_BUDGET[state];
		assert.equal(result.budget, budget, `${state} 预算须取自常量表`);
		assert.ok(result.length <= budget, `${state} 实测体量须在常量预算内`);
		assert.equal(result.remaining, budget - result.length);
		const ceiling = result.earlyWarningCeiling;
		assert.equal(isWithinEarlyWarningBand(ceiling, budget), true, `${state} 预警线须在带内`);
		assert.equal(isWithinEarlyWarningBand(ceiling + 1, budget), false, `${state} 预警线 +1 须出带`);
		assert.equal(result.withinEarlyWarning, isWithinEarlyWarningBand(result.length, budget));
	}
});

test("预警带判据：合成数值可独立验证（不依赖真实引导语料）", () => {
	const budget = 1000;
	assert.equal(isWithinEarlyWarningBand(900, budget), true, "恰在预警线须算带内");
	assert.equal(isWithinEarlyWarningBand(901, budget), false, "越过预警线须判为出带");
	assert.equal(isWithinEarlyWarningBand(1000, budget), false, "硬上限处亦在带外");
	assert.equal(isWithinEarlyWarningBand(Number.NaN, budget), false);
	assert.equal(isWithinEarlyWarningBand("900", budget), false);
	assert.equal(isWithinEarlyWarningBand(900, 0), false);
	assert.equal(isWithinEarlyWarningBand(900, -10), false);
});

test("evaluateGuidanceSize：超预算时拒绝而非截断（合成数值直接证明，10 §10.1 第 3 项）", () => {
	const over = evaluateGuidanceSize(1501, 1500, "governed");
	assert.equal(over.ok, false);
	assert.equal(over.error.code, "guidance/budget_exceeded");
	assert.equal(over.overBy, 1);
	assert.equal(over.length, 1501);
	assert.equal(over.budget, 1500);
	const atLimit = evaluateGuidanceSize(1500, 1500, "governed");
	assert.equal(atLimit.ok, true);
	assert.equal(atLimit.remaining, 0);
	const invalid = evaluateGuidanceSize(Number.NaN, 1500, "governed");
	assert.equal(invalid.ok, false);
	assert.equal(invalid.error.code, "guidance/invalid_measurement");
});

test("evaluateGuidanceSize：越预警带但未越硬上限时，给出提前量结论", () => {
	const within = evaluateGuidanceSize(1000, 1500, "governed");
	assert.equal(within.ok, true, "未越硬上限仍可注入");
	assert.equal(within.withinEarlyWarning, true);
	assert.equal(isWithinEarlyWarningBand(within.earlyWarningCeiling, 1500), true, "预警线须在带内");
	assert.equal(isWithinEarlyWarningBand(within.earlyWarningCeiling + 1, 1500), false, "预警线 +1 须出带");
	const near = evaluateGuidanceSize(1400, 1500, "governed");
	assert.equal(near.ok, true, "未越硬上限仍可注入（预警不是必停）");
	assert.equal(near.withinEarlyWarning, false, "越过预警带须转红一次以提前提出预算复核");
});

test("漂移报警判据：合成数值可独立验证（防漂移／漂移报警，参照值非断言期望值）", () => {
	const same = guidanceLengthDrift(1052, 1052);
	assert.equal(same.drifted, false);
	assert.equal(same.delta, 0);
	const grew = guidanceLengthDrift(1100, 1052);
	assert.equal(grew.drifted, true);
	assert.equal(grew.delta, 48);
	assert.equal(grew.recorded, 1052);
	const shrank = guidanceLengthDrift(1000, 1052);
	assert.equal(shrank.drifted, true, "缩小也是漂移");
	assert.equal(shrank.delta, -52);
	assert.equal(guidanceLengthDrift(1100, null).drifted, false);
	assert.equal(guidanceLengthDrift(1100, undefined).recorded, null);
});

test("GUIDANCE_MEASURED_LENGTH 只作报警参照：与实测不符时如实报出，不阻断", () => {
	const report = reportGuidanceSize("governed");
	assert.equal(report.ok, true);
	assert.equal(report.length, guidanceTextFor("governed").length);
	assert.equal(report.budget, GUIDANCE_CHAR_BUDGET.governed);
	const expectedDrift = report.length !== GUIDANCE_MEASURED_LENGTH.governed;
	assert.equal(report.drift.drifted, expectedDrift, "漂移判定须与「实测 ≠ 记录」一致");
	assert.equal(report.drift.recorded, GUIDANCE_MEASURED_LENGTH.governed);
	assert.equal(report.drift.measured, report.length);
	assert.equal(report.drift.delta, report.length - GUIDANCE_MEASURED_LENGTH.governed);
	assert.equal(report.ok, true, "漂移不改变 ok");
	assert.deepEqual(Object.keys(GUIDANCE_MEASURED_LENGTH).sort(), Object.keys(GUIDANCE_CHAR_BUDGET).sort());
});

test("guidanceSizeAlerts：两类告警都不阻断注入（合成报告可直接验证）", () => {
	const clean = guidanceSizeAlerts({
		state: "governed", ok: true, length: 1052, budget: 1500,
		withinEarlyWarning: true, earlyWarningCeiling: 1350,
		drift: { drifted: false, measured: 1052, recorded: 1052, delta: 0 },
	});
	assert.deepEqual(Object.keys(clean), [], "无漂移无逼近时不得有告警项");

	const driftOnly = guidanceSizeAlerts({
		state: "governed", ok: true, length: 1100, budget: 1500,
		withinEarlyWarning: true, earlyWarningCeiling: 1350,
		drift: { drifted: true, measured: 1100, recorded: 1052, delta: 48 },
	});
	assert.equal(driftOnly.nearBudget, undefined, "未逼近上限时不得报逼近告警");
	assert.equal(driftOnly.drift.delta, 48);
	assert.match(driftOnly.drift.message, /实测 1100/);
	assert.match(driftOnly.drift.message, /记录 1052/);
	assert.match(driftOnly.drift.message, /不阻断注入/);

	const nearOnly = guidanceSizeAlerts({
		state: "governed", ok: true, length: 1400, budget: 1500,
		withinEarlyWarning: false, earlyWarningCeiling: 1350,
		drift: { drifted: false, measured: 1400, recorded: 1400, delta: 0 },
	});
	assert.equal(nearOnly.drift, undefined);
	assert.equal(nearOnly.nearBudget.length, 1400);
	assert.match(nearOnly.nearBudget.message, /尚未越限，注入照常/);

	const over = guidanceSizeAlerts({
		state: "governed", ok: false, length: 1501, budget: 1500,
		drift: { drifted: true, measured: 1501, recorded: 1052, delta: 449 },
	});
	assert.equal(over.nearBudget, undefined, "已越硬上限时不再报逼近告警");
	assert.equal(over.drift.delta, 449, "漂移告警仍照实报出");
});

test("GUIDANCE_BILLING_BASIS 如实披露宿主计量不可用（10 §5.3）", () => {
	assert.equal(GUIDANCE_BILLING_BASIS.hostMeteringAvailable, false);
	assert.equal(GUIDANCE_BILLING_BASIS.unit, "UTF-16 code unit");
	assert.match(GUIDANCE_BILLING_BASIS.note, /权宜/);
});

test("buildGuidance：未知 state 回退到 not_governed 预算（不静默放宽）", () => {
	const unknown = buildGuidance("some_future_state");
	assert.equal(unknown.budget, GUIDANCE_CHAR_BUDGET.not_governed);
});

test("注入路径确实经过体量核对（guidance.js 实际调用 buildGuidance）", async () => {
	const { readFile } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const source = await readFile(join(import.meta.dirname, "..", "lib", "guidance.js"), "utf8");
	assert.match(source, /buildGuidance\(/, "注入处须调用 buildGuidance，否则预算常量只是摆设");
	assert.match(source, /guidanceBudgetExceeded/, "超预算时须记录原因，而非静默丢弃");
	assert.ok(!/text\s*=\s*text\.(slice|substring)\(/.test(source), "不得静默截断引导文本");
});
