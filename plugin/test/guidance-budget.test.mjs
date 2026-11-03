// tests for plugin/lib/guidance-budget.js —— 10 §5.3 的体量常量承载
//
// 权威：specs/10 §5.3「体量以固定常量承载，变更走受控提交」；§10.1 第 3 项把
// 「超出预算」列为必停情形。本文件守的是「引导可以无限增长而无人发现」这件事
// 不再成立——它**不**守引导内容是否正确（那属另一层）。
//
// ## 为什么本文件**不**断言引导体的精确码元数（2026-11-03，friction-f9a66474）
//
// 早前本文件有一行 `assert.equal(result.length, 1052)`。它与 `00 §4.3`
// 「受保护文档须形成只含该文档的独立提交」构成**程序死锁**：改动
// `plugin/lib/guidance-text.js` 必然让该断言转红，而同步断言的测试文件不能进
// 同一个提交——于是每次引导文本改动都停在「需 Human 三选一」。
//
// 现改为两层，**互不耦合**：
//   · **硬上限**（阻断）：体量超过 `GUIDANCE_CHAR_BUDGET` 即拒绝注入，
//     `ok:false`。该常量与受保护文本分处两个文件，其值由 Human 定。
//   · **预警带**（阻断）：体量越过 `budget × 0.9` 即转红，把「要不要放宽预算」
//     这个 Human 决定在越界**之前**提出。0.9 是实现自选提前量，规范未规定数值。
//   · **漂移报警**（不阻断）：实测体量与 `GUIDANCE_MEASURED_LENGTH` 记录值
//     不一致时如实报出差异，由 `guidance.js` 记日志。它**不是**断言期望值，
//     故不与受保护提交抢同一个提交位。
//
// 依据 `specs/06` §5：防漂移断言须「在用例名或断言处写明『防漂移／漂移报警』并
// 注明期望值所据的基线提交」——本文件据此把漂移记录值显式标注为**报警参照**
// 而非断言期望值，故不落入 §5 形态 5 的处置口径（形态 5 豁免针对的是**断言**，
// 本文件不再有以体量为期望值的断言）。

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
	// **不**断言精确码元数——那会把本文件与受保护文本绑死在同一个提交里
	// （friction-f9a66474）。此处只断言**关系**：
	//   实测体量 ≤ 常量预算；余量 = 预算 − 体量；预警带上限 = ⌊预算 × 0.9⌋。
	// 这些关系在受保护文本合法增删后仍然成立，故不必同步任何期望值。
	for (const state of ["governed", "unavailable", "not_governed"]) {
		const result = buildGuidance(state);
		const budget = GUIDANCE_CHAR_BUDGET[state];
		assert.equal(result.budget, budget, `${state} 预算须取自常量表`);
		assert.ok(result.length <= budget, `${state} 实测体量须在常量预算内`);
		assert.equal(result.remaining, budget - result.length);
		// 预警线判据用**性质**表达，不复算实现里的算式（复算即 06 §5 形态 4
		// 的同源自证——改动比值常量时两侧会一起动，断言跟着「恒成立」）：
		// 预警线本身须在带内，预警线 +1 须出带。
		const ceiling = result.earlyWarningCeiling;
		assert.equal(isWithinEarlyWarningBand(ceiling, budget), true, `${state} 预警线须在带内`);
		assert.equal(isWithinEarlyWarningBand(ceiling + 1, budget), false, `${state} 预警线 +1 须出带`);
		// 接线检查：buildGuidance 的带内结论须与带判据函数一致（换实现即转红）。
		assert.equal(result.withinEarlyWarning, isWithinEarlyWarningBand(result.length, budget));
	}
});

test("预警带判据：合成数值可独立验证（不依赖真实引导语料）", () => {
	// 边界：恰在预警线上的长度算带内，越过一个码元即出带。
	const budget = 1000;
	assert.equal(isWithinEarlyWarningBand(900, budget), true, "恰在预警线须算带内");
	assert.equal(isWithinEarlyWarningBand(901, budget), false, "越过预警线须判为出带");
	assert.equal(isWithinEarlyWarningBand(1000, budget), false, "硬上限处亦在带外");
	// 非数值与非法预算不得被判为带内（否则「无法测量」会被静默当成「体量正常」）。
	assert.equal(isWithinEarlyWarningBand(Number.NaN, budget), false);
	assert.equal(isWithinEarlyWarningBand("900", budget), false);
	assert.equal(isWithinEarlyWarningBand(900, 0), false);
	assert.equal(isWithinEarlyWarningBand(900, -10), false);
});

test("evaluateGuidanceSize：超预算时拒绝而非截断（合成数值直接证明，10 §10.1 第 3 项）", () => {
	// 此前此路径只能靠「读源码文本匹配 ok: false」间接证明——那只证明形态存在，
	// 证明不了「超预算时真的拒绝」。现由纯函数直接断言。
	const over = evaluateGuidanceSize(1501, 1500, "governed");
	assert.equal(over.ok, false);
	assert.equal(over.error.code, "guidance/budget_exceeded");
	assert.equal(over.overBy, 1);
	assert.equal(over.length, 1501);
	assert.equal(over.budget, 1500);
	// 恰好等于上限不算超限（边界）。
	const atLimit = evaluateGuidanceSize(1500, 1500, "governed");
	assert.equal(atLimit.ok, true);
	assert.equal(atLimit.remaining, 0);
	// 非数值输入不得被当作「正常」——须显式报不可测量。
	const invalid = evaluateGuidanceSize(Number.NaN, 1500, "governed");
	assert.equal(invalid.ok, false);
	assert.equal(invalid.error.code, "guidance/invalid_measurement");
});

test("evaluateGuidanceSize：越预警带但未越硬上限时，给出提前量结论", () => {
	const within = evaluateGuidanceSize(1000, 1500, "governed");
	assert.equal(within.ok, true, "未越硬上限仍可注入");
	assert.equal(within.withinEarlyWarning, true);
	// 预警线须是「带内 → 出带」的分界：合成数值验证其位置，不复算算式。
	assert.equal(isWithinEarlyWarningBand(within.earlyWarningCeiling, 1500), true, "预警线须在带内");
	assert.equal(isWithinEarlyWarningBand(within.earlyWarningCeiling + 1, 1500), false, "预警线 +1 须出带");
	const near = evaluateGuidanceSize(1400, 1500, "governed");
	assert.equal(near.ok, true, "未越硬上限仍可注入（预警不是必停）");
	assert.equal(near.withinEarlyWarning, false, "越过预警带须转红一次以提前提出预算复核");
});

test("漂移报警判据：合成数值可独立验证（防漂移／漂移报警，参照值非断言期望值）", () => {
	// 本文件**不**以实测码元数为断言期望值；漂移只作报警，判据逻辑须独立可测。
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
	// 无记录值时不报警（不是「报一个说不清的漂移」）。
	assert.equal(guidanceLengthDrift(1100, null).drifted, false);
	assert.equal(guidanceLengthDrift(1100, undefined).recorded, null);
});

test("GUIDANCE_MEASURED_LENGTH 只作报警参照：与实测不符时如实报出，不阻断", () => {
	const report = reportGuidanceSize("governed");
	assert.equal(report.ok, true);
	// 报告的体量须等于**真实引导文本**的体量（不是等于某个记下来的数）——
	// 这条断言指向受测面（guidanceTextFor 的输出），不与期望值同源。
	assert.equal(report.length, guidanceTextFor("governed").length);
	assert.equal(report.budget, GUIDANCE_CHAR_BUDGET.governed);
	// 记录值与实测一致时无漂移；不一致时 drift.drifted 为真——但 ok 仍为真，
	// 即漂移**不阻断**注入（阻断的是超预算，不是漂移）。
	const expectedDrift = report.length !== GUIDANCE_MEASURED_LENGTH.governed;
	assert.equal(report.drift.drifted, expectedDrift, "漂移判定须与「实测 ≠ 记录」一致");
	assert.equal(report.drift.recorded, GUIDANCE_MEASURED_LENGTH.governed);
	assert.equal(report.drift.measured, report.length);
	assert.equal(report.drift.delta, report.length - GUIDANCE_MEASURED_LENGTH.governed);
	assert.equal(report.ok, true, "漂移不改变 ok");
	// 记录表覆盖三个 state，且其键与预算表一致（否则某 state 的漂移无参照）。
	assert.deepEqual(Object.keys(GUIDANCE_MEASURED_LENGTH).sort(), Object.keys(GUIDANCE_CHAR_BUDGET).sort());
});

test("guidanceSizeAlerts：两类告警都不阻断注入（合成报告可直接验证）", () => {
	// 无漂移、未逼近 → 无告警。
	const clean = guidanceSizeAlerts({
		state: "governed", ok: true, length: 1052, budget: 1500,
		withinEarlyWarning: true, earlyWarningCeiling: 1350,
		drift: { drifted: false, measured: 1052, recorded: 1052, delta: 0 },
	});
	assert.deepEqual(Object.keys(clean), [], "无漂移无逼近时不得有告警项");

	// 只有漂移 → 漂移告警，且消息里带上实测/记录/差值。
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

	// 逼近上限 → 逼近告警（未越硬上限仍 ok:true，即不阻断）。
	const nearOnly = guidanceSizeAlerts({
		state: "governed", ok: true, length: 1400, budget: 1500,
		withinEarlyWarning: false, earlyWarningCeiling: 1350,
		drift: { drifted: false, measured: 1400, recorded: 1400, delta: 0 },
	});
	assert.equal(nearOnly.drift, undefined);
	assert.equal(nearOnly.nearBudget.length, 1400);
	assert.match(nearOnly.nearBudget.message, /尚未越限，注入照常/);

	// 越硬上限（ok:false）→ 不报「逼近」告警（那时注入已被拒绝，另走必停路径）。
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
	// 不得在超预算时注入半截文本：断言没有对 text 做 slice/substring 截断。
	assert.ok(!/text\s*=\s*text\.(slice|substring)\(/.test(source), "不得静默截断引导文本");
});
