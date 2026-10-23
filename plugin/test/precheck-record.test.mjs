// tests for plugin/lib/precheck-record.js — 规则遵守系统的机械承载切片
//
// 权威：specs/34 §8/§10/§12/§14；specs/03 §7.2（公共格式唯一权威）；
// specs/10 §7.7（ldvh/ 域承载，不硬编码路径）。
//
// 本文件守的是**形态**这一层：必需段齐备与否、落盘与回读一致与否、结论三态是否
// 落在闭集内。它**不**、也不能证明「规则被遵守」——34 §14 末段明文如此，故本文件
// 不含任何把格式合规读成已遵守的断言。

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	APPLICATION_CRITERIA,
	FAST_PATH_REQUIREMENTS,
	RISK_TIERS,
	STAGE_MINIMUM_TIER,
	checkFastPathDeclaration,
	checkRiskRouting,
	CONDITIONAL_SECTIONS,
	DEVIATION_FIELDS,
	DEVIATION_FORMS,
	checkRetroactiveCoverage,
	evaluateApplication,
	evaluateDeviation,
	FINDING_STATES,
	RECALLED_LABEL,
	RECORD_HEADER,
	REQUIRED_SECTIONS,
	REUSE_CONDITIONS,
	checkFindingStates,
	checkRecordShape,
	evaluateReuse,
	fingerprintCarriers,
	recordFingerprint,
	renderPrecheckRecord,
	buildHandover,
	summarizeApplications,
	carrierStatus,
} from "../lib/precheck-record.js";

/** 一份满足 03 §7.2 四段必需项的最小输入。 */
const COMPLETE_FIELDS = {
	effective: "specs/34（L3 §8）、ldvh-base/adrs/adr-0b08523c（active）",
	applicable: "34 §8.3 约束落实三判据；21 §6.1 plan 边界",
	allowed: "本会话 Human 授权：仅改 plugin/lib 与 plugin/test",
	unverified: "specs/07 Web 呈现层未核对",
};

// ---------------------------------------------------------------------------
// 段闭集
// ---------------------------------------------------------------------------

test("REQUIRED_SECTIONS 恰为 03 §7.2 中不带「如」的四段", () => {
	assert.deepEqual(
		REQUIRED_SECTIONS.map((s) => s.label),
		["生效规则", "适用规则", "行动允许", "未验证范围"],
	);
});

test("CONDITIONAL_SECTIONS 恰为 03 §7.2 中带「如」的两段（条件段，不得凑空句）", () => {
	assert.deepEqual(
		CONDITIONAL_SECTIONS.map((s) => s.label),
		["快通道声明", "升级记录"],
	);
});

// ---------------------------------------------------------------------------
// render：必需段缺失即拒绝（34 §17 第 2 项：禁止为凑段填无内容结论）
// ---------------------------------------------------------------------------

test("render：四段全齐时产出 §7.2 形态，段名逐字对应", () => {
	const result = renderPrecheckRecord(COMPLETE_FIELDS);
	assert.equal(result.ok, true);
	assert.ok(result.text.startsWith(RECORD_HEADER), "须以 [预检落实记录] 起首");
	for (const section of REQUIRED_SECTIONS) {
		assert.match(result.text, new RegExp(`^- ${section.label}：`, "m"), `缺段名 ${section.label}`);
	}
	assert.match(result.text, new RegExp(`^- ${RECALLED_LABEL}：`, "m"));
	// 段序即 03 §7.2 的顺序：生效 → 适用 → 行动允许 → 已召回 → 未验证范围
	const order = ["生效规则", "适用规则", "行动允许", "已召回", "未验证范围"]
		.map((label) => result.text.indexOf(`- ${label}：`));
	assert.deepEqual([...order].sort((a, b) => a - b), order, "段序须与 03 §7.2 一致");
});

test("render：缺任一段即拒绝，且指明缺哪几段", () => {
	for (const section of REQUIRED_SECTIONS) {
		const partial = { ...COMPLETE_FIELDS };
		delete partial[section.key];
		const result = renderPrecheckRecord(partial);
		assert.equal(result.ok, false, `缺 ${section.label} 时须拒绝`);
		assert.equal(result.error.code, "record/section_missing");
		assert.deepEqual(result.missing, [section.label]);
		assert.match(result.error.message, new RegExp(section.label));
	}
});

test("render：空串与纯空白不算「有内容」，与缺段同等拒绝", () => {
	for (const blank of ["", "   ", "\n\t "]) {
		const result = renderPrecheckRecord({ ...COMPLETE_FIELDS, allowed: blank });
		assert.equal(result.ok, false, `allowed=${JSON.stringify(blank)} 须拒绝`);
		assert.deepEqual(result.missing, ["行动允许"]);
	}
});

test("render：缺三段时一次性列出全部缺项，不只报第一个", () => {
	const result = renderPrecheckRecord({ effective: "有" });
	assert.equal(result.ok, false);
	assert.deepEqual(result.missing, ["适用规则", "行动允许", "未验证范围"]);
});

test("render：非对象入参拒绝", () => {
	for (const bad of [null, "text", 42, ["a"]]) {
		const result = renderPrecheckRecord(bad);
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "invalid_request");
	}
});

// ---------------------------------------------------------------------------
// 「已召回」两级结构（03 §7.2：ADR / Pitfall 各一行，未触发须标记）
// ---------------------------------------------------------------------------

test("recalled：未传时两级都标「未触发」，不省略行", () => {
	const result = renderPrecheckRecord(COMPLETE_FIELDS);
	assert.match(result.text, /^ {2}- ADR：未触发$/m);
	assert.match(result.text, /^ {2}- Pitfall：未触发$/m);
});

test("recalled：传对象时逐级呈现", () => {
	const result = renderPrecheckRecord({
		...COMPLETE_FIELDS,
		recalled: { adr: "adr-0b08523c（active）：不硬编码路径", pitfall: "pitfall-3ee591bc：验证手段自欺" },
	});
	assert.match(result.text, /^ {2}- ADR：adr-0b08523c/m);
	assert.match(result.text, /^ {2}- Pitfall：pitfall-3ee591bc/m);
	assert.equal(result.undifferentiatedRecall, false);
});

test("recalled：单串无法区分两级时如实标记 undifferentiated，不猜不拆", () => {
	const result = renderPrecheckRecord({ ...COMPLETE_FIELDS, recalled: "ADR 与 Pitfall 均已核对" });
	assert.equal(result.undifferentiatedRecall, true);
	assert.match(result.text, /^ {2}- ADR：ADR 与 Pitfall 均已核对$/m);
	assert.match(result.text, /^ {2}- Pitfall：未触发$/m);
});

// ---------------------------------------------------------------------------
// 条件段：未传则不出现（不凑空句）
// ---------------------------------------------------------------------------

test("条件段未传时不出现在记录里", () => {
	const result = renderPrecheckRecord(COMPLETE_FIELDS);
	assert.doesNotMatch(result.text, /快通道声明/);
	assert.doesNotMatch(result.text, /升级记录/);
});

test("条件段传入时按 §7.2 位置呈现（在未验证范围之后）", () => {
	const result = renderPrecheckRecord({
		...COMPLETE_FIELDS,
		fastPath: "低风险、已反复执行",
		escalation: "升级原因：触及受控事实对象",
	});
	const unverifiedAt = result.text.indexOf("- 未验证范围：");
	const fastAt = result.text.indexOf("- 快通道声明：");
	const escalateAt = result.text.indexOf("- 升级记录：");
	assert.ok(fastAt > unverifiedAt && escalateAt > fastAt, "条件段须排在未验证范围之后");
});

// ---------------------------------------------------------------------------
// checkRecordShape：只判段齐备，不判取值（34 §14「不证明取值正确」）
// ---------------------------------------------------------------------------

test("checkRecordShape：完整记录判为 complete", () => {
	const { text } = renderPrecheckRecord(COMPLETE_FIELDS);
	const shape = checkRecordShape(text);
	assert.equal(shape.ok, true);
	assert.equal(shape.complete, true);
	assert.deepEqual(shape.missing, []);
});

test("checkRecordShape：缺段时列出缺哪几段，且不出「通过」结论", () => {
	const shape = checkRecordShape(`${RECORD_HEADER}\n\n- 生效规则：x\n`);
	assert.equal(shape.ok, true);
	assert.equal(shape.complete, false);
	assert.deepEqual(shape.missing, ["适用规则", "行动允许", "未验证范围", "已召回"]);
});

test("checkRecordShape：缺起首标记即拒绝（03 §7.2 形态）", () => {
	const shape = checkRecordShape("- 生效规则：x\n- 适用规则：y\n");
	assert.equal(shape.ok, false);
	assert.equal(shape.error.code, "record/header_missing");
});

test("checkRecordShape：空入参拒绝", () => {
	for (const bad of ["", "   ", null, undefined]) {
		const shape = checkRecordShape(bad);
		assert.equal(shape.ok, false);
		assert.equal(shape.error.code, "invalid_request");
	}
});

// ---------------------------------------------------------------------------
// 逐项结论三态（34 §12：不得合并为「已遵守」）
// ---------------------------------------------------------------------------

test("FINDING_STATES 恰为 34 §12 的三态", () => {
	assert.deepEqual([...FINDING_STATES], ["落实", "已识别未落实", "未识别"]);
});

test("checkFindingStates：三态各自计数，且从不返回「已遵守」", () => {
	const result = checkFindingStates([
		{ statement: "a", state: "落实" },
		{ statement: "b", state: "已识别未落实" },
		{ statement: "c", state: "已识别未落实" },
		{ statement: "d", state: "未识别" },
	]);
	assert.equal(result.ok, true);
	assert.deepEqual(result.counts, { 落实: 1, 已识别未落实: 2, 未识别: 1 });
	assert.equal(result.claimsCompliance, false);
});

test("checkFindingStates：把三态合并成「已遵守」即拒绝（§12 强制区分）", () => {
	for (const merged of ["已遵守", "已检查", "通过", "落实但未核"]) {
		const result = checkFindingStates([{ statement: "a", state: merged }]);
		assert.equal(result.ok, false, `${merged} 不应被接受`);
		assert.equal(result.error.code, "findings/state_invalid");
		assert.deepEqual(result.invalid, [{ index: 0, state: merged }]);
	}
});

test("checkFindingStates：空数组合法（无识别结果时不制造空结论）", () => {
	const result = checkFindingStates([]);
	assert.equal(result.ok, true);
	assert.deepEqual(result.counts, { 落实: 0, 已识别未落实: 0, 未识别: 0 });
});

test("checkFindingStates：非数组拒绝", () => {
	const result = checkFindingStates("已遵守");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "invalid_request");
});

// ---------------------------------------------------------------------------
// 复用条件（03 §7.3：三条全部满足才可直接复用）
// ---------------------------------------------------------------------------

test("REUSE_CONDITIONS 恰为 03 §7.3 的三条，且标明哪条机械可核", () => {
	assert.deepEqual(
		REUSE_CONDITIONS.map((c) => c.mechanical),
		[false, true, false],
		"只有第 2 条（载体未变更）机械可核；第 1、3 条是语义判断",
	);
});

test("evaluateReuse：三条全成立时判为可复用，且无待办处置", () => {
	const result = evaluateReuse({
		recordSessionId: "session-abc",
		sessionId: "session-abc",
		sameScope: true,
		noNewSignal: true,
		carriers: [{ path: "specs/34-规则遵守系统规范.md", baseline: "h1", current: "h1" }],
	});
	assert.equal(result.ok, true);
	assert.equal(result.reusable, true);
	assert.deepEqual(result.failed, []);
	assert.deepEqual(result.unverifiable, []);
	assert.equal(result.requiredAction, null);
});

test("evaluateReuse：跨会话一律不得直接复用（第 1 条的前置）", () => {
	const result = evaluateReuse({
		recordSessionId: "session-old",
		sessionId: "session-new",
		sameScope: true,
		noNewSignal: true,
		carriers: [{ path: "p", baseline: "h", current: "h" }],
	});
	assert.equal(result.reusable, false);
	assert.deepEqual(result.failed.map((f) => f.condition), ["sameScope"]);
	assert.match(result.failed[0].reason, /跨会话/);
});

test("evaluateReuse：调用方未确认范围未变时不复用（语义判断不由机械代替）", () => {
	for (const sameScope of [false, undefined, "true"]) {
		const result = evaluateReuse({
			recordSessionId: "s",
			sessionId: "s",
			sameScope,
			noNewSignal: true,
			carriers: [{ path: "p", baseline: "h", current: "h" }],
		});
		assert.equal(result.reusable, false, `sameScope=${JSON.stringify(sameScope)} 不应判为可复用`);
		assert.ok(result.failed.some((f) => f.condition === "sameScope"));
	}
});

test("evaluateReuse：载体指纹已变即不复用，并指出是哪个载体", () => {
	const result = evaluateReuse({
		recordSessionId: "s",
		sessionId: "s",
		sameScope: true,
		noNewSignal: true,
		carriers: [
			{ path: "specs/34-规则遵守系统规范.md", baseline: "aaa", current: "bbb" },
			{ path: "ldvh-base/adrs/adr-1.md", baseline: "ccc", current: "ccc" },
		],
	});
	assert.equal(result.reusable, false);
	assert.equal(result.failed.length, 1);
	assert.equal(result.failed[0].condition, "sourcesUnchanged");
	assert.match(result.failed[0].reason, /specs\/34-规则遵守系统规范\.md/);
});

test("evaluateReuse：载体不可读即不复用，不当成「没变化」", () => {
	const result = evaluateReuse({
		recordSessionId: "s",
		sessionId: "s",
		sameScope: true,
		noNewSignal: true,
		carriers: [{ path: "gone.md", baseline: "h", current: null }],
	});
	assert.equal(result.reusable, false);
	assert.match(result.failed[0].reason, /不可读/);
});

test("evaluateReuse：未提供载体指纹时按未核验处理，不默认通过", () => {
	const result = evaluateReuse({
		recordSessionId: "s",
		sessionId: "s",
		sameScope: true,
		noNewSignal: true,
		carriers: [],
	});
	assert.equal(result.reusable, false);
	assert.deepEqual(result.unverifiable.map((u) => u.condition), ["sourcesUnchanged"]);
	assert.match(result.unverifiable[0].reason, /不默认通过/);
});

test("evaluateReuse：载体缺基线指纹时按未核验处理（无法证明未变更）", () => {
	const result = evaluateReuse({
		recordSessionId: "s",
		sessionId: "s",
		sameScope: true,
		noNewSignal: true,
		carriers: [{ path: "x.md", baseline: null, current: "h" }],
	});
	assert.equal(result.reusable, false);
	assert.equal(result.unverifiable[0].condition, "sourcesUnchanged");
});

test("evaluateReuse：不成立的处置是「重做受影响部分的预检」，不是全量重扫", () => {
	const result = evaluateReuse({
		recordSessionId: "s",
		sessionId: "s",
		sameScope: false,
		noNewSignal: true,
		carriers: [],
	});
	assert.equal(result.reusable, false);
	assert.match(result.requiredAction, /重新执行受影响部分的预检/);
	assert.match(result.requiredAction, /不得以「无法证明没有变化」为由全量重扫/);
});

test("evaluateReuse：第 3 条未确认时不复用", () => {
	const result = evaluateReuse({
		recordSessionId: "s",
		sessionId: "s",
		sameScope: true,
		noNewSignal: false,
		carriers: [{ path: "p", baseline: "h", current: "h" }],
	});
	assert.equal(result.reusable, false);
	assert.deepEqual(result.failed.map((f) => f.condition), ["noNewSignal"]);
});

test("evaluateReuse：缺 sessionId 即拒绝（无法判定是否同一会话）", () => {
	for (const bad of ["", undefined, null, 42]) {
		const result = evaluateReuse({ sessionId: bad, sameScope: true, noNewSignal: true });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "invalid_request");
	}
});

// ---------------------------------------------------------------------------
// fingerprintCarriers：真实读盘算指纹，不给调用方自证的机会
// ---------------------------------------------------------------------------

test("fingerprintCarriers：读真实文件算 SHA-256，与 recordFingerprint 同源", async () => {
	const root = await mkdtemp(join(tmpdir(), "ldvh-carriers-"));
	try {
		await writeFile(join(root, "a.md"), "内容甲", "utf8");
		const result = await fingerprintCarriers(root, ["a.md"]);
		assert.equal(result.ok, true);
		assert.equal(result.carriers[0].current, recordFingerprint("内容甲"));
		assert.equal(result.carriers[0].baseline, null, "未给基线时如实为 null，不伪造");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fingerprintCarriers：不存在的载体记 current=null，不伪造为「无变化」", async () => {
	const root = await mkdtemp(join(tmpdir(), "ldvh-carriers-"));
	try {
		const result = await fingerprintCarriers(root, ["missing.md"]);
		assert.equal(result.ok, true);
		assert.equal(result.carriers[0].current, null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fingerprintCarriers：保留调用方给的基线指纹", async () => {
	const root = await mkdtemp(join(tmpdir(), "ldvh-carriers-"));
	try {
		await writeFile(join(root, "a.md"), "x", "utf8");
		const result = await fingerprintCarriers(root, [{ path: "a.md", baseline: "deadbeef" }]);
		assert.equal(result.carriers[0].baseline, "deadbeef");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fingerprintCarriers → evaluateReuse：内容真变了就判不可复用（端到端）", async () => {
	const root = await mkdtemp(join(tmpdir(), "ldvh-carriers-"));
	try {
		const file = join(root, "spec.md");
		await writeFile(file, "第一版", "utf8");
		const atRecordTime = await fingerprintCarriers(root, ["spec.md"]);
		// 记录之后载体被改
		await writeFile(file, "第二版", "utf8");
		const now = await fingerprintCarriers(root, [
			{ path: "spec.md", baseline: atRecordTime.carriers[0].current },
		]);
		const verdict = evaluateReuse({
			recordSessionId: "s",
			sessionId: "s",
			sameScope: true,
			noNewSignal: true,
			carriers: now.carriers,
		});
		assert.equal(verdict.reusable, false);
		assert.equal(verdict.failed[0].condition, "sourcesUnchanged");
		assert.match(verdict.failed[0].reason, /spec\.md/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fingerprintCarriers → evaluateReuse：内容未变则第 2 条通过（端到端）", async () => {
	const root = await mkdtemp(join(tmpdir(), "ldvh-carriers-"));
	try {
		const file = join(root, "spec.md");
		await writeFile(file, "稳定内容", "utf8");
		const atRecordTime = await fingerprintCarriers(root, ["spec.md"]);
		const now = await fingerprintCarriers(root, [
			{ path: "spec.md", baseline: atRecordTime.carriers[0].current },
		]);
		const verdict = evaluateReuse({
			recordSessionId: "s",
			sessionId: "s",
			sameScope: true,
			noNewSignal: true,
			carriers: now.carriers,
		});
		assert.equal(verdict.reusable, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fingerprintCarriers：不枚举目录——只读点名的路径，多给的路径不会扩大读取面", async () => {
	const root = await mkdtemp(join(tmpdir(), "ldvh-carriers-"));
	try {
		await writeFile(join(root, "a.md"), "甲", "utf8");
		await writeFile(join(root, "b.md"), "乙", "utf8");
		const result = await fingerprintCarriers(root, ["a.md"]);
		assert.equal(result.carriers.length, 1, "只回一个载体，不扫出 b.md");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("fingerprintCarriers：缺 root、carriers 非数组、条目缺 path 均拒绝", async () => {
	assert.equal((await fingerprintCarriers("", ["a.md"])).error.code, "invalid_request");
	assert.equal((await fingerprintCarriers("/x", "a.md")).error.code, "invalid_request");
	assert.equal((await fingerprintCarriers("/x", [{}])).error.code, "invalid_request");
});

// ---------------------------------------------------------------------------
// 偏离登记（34 §9.1 形态闭集 / §9.2 发现即登记 / §9.3 不追溯为已遵守）
// ---------------------------------------------------------------------------

const DEVIATION_OK = {
	form: "已识别未落实偏离",
	affectedScope: "plugin/lib/precheck-record.js 的 render 分支",
	sideEffects: "无写入；仅当次交还缺失该段",
	pendingChecks: "确认调用方是否已据结论改行动",
	discoveredAt: "2026-10-23T15:00:00+08:00",
	registeredAt: "2026-10-23T15:00:00+08:00",
	returnedAt: "2026-10-23T15:30:00+08:00",
};

test("DEVIATION_FORMS 恰为 34 §9.1 的四类形态", () => {
	assert.deepEqual(
		[...DEVIATION_FORMS],
		["未识别偏离", "已识别未落实偏离", "判断错误偏离", "来源本身冲突"],
	);
});

test("evaluateDeviation：四要素齐备、形态在闭集、登记不晚于交还即通过", () => {
	const result = evaluateDeviation(DEVIATION_OK);
	assert.equal(result.ok, true);
	assert.equal(result.registeredBeforeReturn, true);
	assert.equal(result.lateRegistration, false);
});

test("evaluateDeviation：缺 §9.2 任一项即拒绝并指名", () => {
	for (const field of DEVIATION_FIELDS) {
		const partial = { ...DEVIATION_OK };
		delete partial[field.key];
		const result = evaluateDeviation(partial);
		assert.equal(result.ok, false, `缺 ${field.label} 须拒绝`);
		assert.equal(result.error.code, "deviation/fields_missing");
		assert.deepEqual(result.missing, [field.label]);
	}
});

test("evaluateDeviation：形态不在闭集内即拒绝（无法按形态分流）", () => {
	const result = evaluateDeviation({ ...DEVIATION_OK, form: "小失误" });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "deviation/form_invalid");
	assert.deepEqual(result.allowed, [...DEVIATION_FORMS]);
});

test("evaluateDeviation：登记晚于交还即拒绝（§9.2 不得等到交还时一并说明）", () => {
	const result = evaluateDeviation({
		...DEVIATION_OK,
		registeredAt: "2026-10-23T15:45:00+08:00",
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "deviation/registered_after_return");
});

test("evaluateDeviation：发现与登记不同刻即标记 lateRegistration（需再登记为一条偏离）", () => {
	const result = evaluateDeviation({
		...DEVIATION_OK,
		discoveredAt: "2026-10-23T14:00:00+08:00",
		registeredAt: "2026-10-23T15:00:00+08:00",
	});
	assert.equal(result.ok, true);
	assert.equal(result.lateRegistration, true, "延迟登记本身须作为一项偏离登记（§14）");
});

test("evaluateDeviation：从不授予「追溯为已遵守」", () => {
	const result = evaluateDeviation(DEVIATION_OK);
	assert.equal(result.retroactiveReliefGranted, false);
});

test("evaluateDeviation：时间戳不可解析即拒绝", () => {
	const result = evaluateDeviation({ ...DEVIATION_OK, registeredAt: "昨天" });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "deviation/timestamp_invalid");
});

// §9.3：补做识别不得覆盖已发生的偏离

test("checkRetroactiveCoverage：非补做（无 backfilledAt）不受此判据约束", () => {
	const result = checkRetroactiveCoverage({ actionAt: "2026-10-23T10:00:00+08:00" });
	assert.equal(result.ok, true);
	assert.equal(result.backfilled, false);
	assert.equal(result.retroactive, false);
});

test("checkRetroactiveCoverage：补做却声明未覆盖偏离即拒绝（§9.3 禁区）", () => {
	const result = checkRetroactiveCoverage({
		actionAt: "2026-10-23T10:00:00+08:00",
		backfilledAt: "2026-10-23T11:00:00+08:00",
		coversDeviations: false,
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "record/retroactive_coverage");
});

test("checkRetroactiveCoverage：补做且声明保留偏离段即为合法形态", () => {
	const result = checkRetroactiveCoverage({
		actionAt: "2026-10-23T10:00:00+08:00",
		backfilledAt: "2026-10-23T11:00:00+08:00",
		coversDeviations: true,
	});
	assert.equal(result.ok, true);
	assert.equal(result.acceptable, true);
	assert.equal(result.provesOnlyAfterBackfill, true, "补做只能证明补齐后的状态（§9.3）");
});

test("checkRetroactiveCoverage：actionAt 缺失或不可解析即拒绝", () => {
	for (const bad of [undefined, "", "昨天"]) {
		const result = checkRetroactiveCoverage({ actionAt: bad });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "invalid_request");
	}
});

// ---------------------------------------------------------------------------
// 承载：交还文本，不落盘（34 §17 第 3 项禁专属存储 / §10 不要求写入事实源）
// ---------------------------------------------------------------------------

test("carrierStatus：如实报告未建 Output Envelope 载体，不声称已建成", () => {
	const status = carrierStatus();
	assert.equal(status.persisted, false, "本模块没有任何写盘路径");
	assert.equal(status.carriedBy, "handover-text");
	assert.equal(status.envelope.built, false);
	assert.match(status.envelope.disclosure, /未建/);
	assert.match(status.envelope.specRef, /10 §7\.7/);
});

test("buildHandover：返回可直接进交还正文的文本与指纹，且带承载声明", () => {
	const result = buildHandover(COMPLETE_FIELDS);
	assert.equal(result.ok, true);
	assert.ok(result.text.startsWith(RECORD_HEADER));
	assert.equal(result.fingerprint, recordFingerprint(result.text));
	assert.equal(result.shape.complete, true);
	assert.deepEqual(result.carrier, carrierStatus());
});

test("buildHandover：缺必需段时与 render 同样拒绝，不产出半份交还", () => {
	const result = buildHandover({ effective: "只有这一段" });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "record/section_missing");
});

test("本模块不导出任何写盘入口（§17 第 3 项：不得建专属存储）", async () => {
	const module = await import("../lib/precheck-record.js");
	for (const forbidden of ["writeRecord", "readRecord", "recordPath", "STORE_DIR"]) {
		assert.equal(module[forbidden], undefined, `${forbidden} 不应存在——那属于已禁的专属存储`);
	}
});

// ---------------------------------------------------------------------------
// 约束落实三判据（34 §8.3，本系统核心判据）
// ---------------------------------------------------------------------------

const SETTLED_FINDING = {
	statement: "34 §17 第 3 项禁专属存储",
	hasTarget: "范围：本模块不写盘",
	hasChange: "从「写 ldvh/precheck-records/」改为「交还正文承载」",
	hasTraceableBasis: "34 §17 第 3 项 + §10「不要求写入事实源」",
};

test("APPLICATION_CRITERIA 恰为 34 §8.3 的三项", () => {
	assert.deepEqual(
		APPLICATION_CRITERIA.map((c) => c.label),
		["有指向", "有改变", "有可回指依据"],
	);
});

test("evaluateApplication：三项齐备判为落实", () => {
	const result = evaluateApplication(SETTLED_FINDING);
	assert.equal(result.ok, true);
	assert.equal(result.state, "落实");
	assert.deepEqual(result.unresolvedCriteria, []);
	assert.equal(result.claimsCompliance, false, "仍不得给出合并式「已遵守」");
});

test("evaluateApplication：缺任一项即按「已识别未落实」处理（不因其余齐备而改判）", () => {
	for (const criterion of APPLICATION_CRITERIA) {
		const partial = { ...SETTLED_FINDING };
		delete partial[criterion.key];
		const result = evaluateApplication(partial);
		assert.equal(result.ok, true);
		assert.equal(result.state, "已识别未落实", `缺 ${criterion.label} 应判未落实`);
		assert.deepEqual(result.unresolvedCriteria, [criterion.label]);
		assert.match(result.reason, /§8\.3/);
	}
});

test("evaluateApplication：三项全缺时逐项列出，不只报第一个", () => {
	const result = evaluateApplication({ statement: "某约束" });
	assert.equal(result.state, "已识别未落实");
	assert.deepEqual(result.unresolvedCriteria, ["有指向", "有改变", "有可回指依据"]);
});

test("evaluateApplication：第②项写「已遵守」类措辞即拒绝（§8.3 末段）", () => {
	for (const term of ["已遵守", "已检查", "已确认", "没问题", "符合要求"]) {
		const result = evaluateApplication({ ...SETTLED_FINDING, hasChange: `该约束${term}` });
		assert.equal(result.ok, false, `${term} 不应被当作「有改变」`);
		assert.equal(result.error.code, "application/merged_compliance_claim");
	}
});

test("evaluateApplication：合法的「按设计不改变」须给理由，否则拒绝", () => {
	const result = evaluateApplication({
		...SETTLED_FINDING,
		hasChange: undefined,
		actionUnchangedByDesign: true,
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "application/no_change_rationale_missing");
});

test("evaluateApplication：按设计不改变且给足理由时判为落实，但标记 unchangedByDesign", () => {
	const result = evaluateApplication({
		statement: "纯读取动作不进入本系统（34 §6 排除条件）",
		hasTarget: "是否继续：不进入本系统",
		actionUnchangedByDesign: true,
		noChangeRationale: "§6 排除条件明文排除纯读取；该约束不要求改变本次读取",
		hasTraceableBasis: "34 §6 排除条件",
	});
	assert.equal(result.ok, true);
	assert.equal(result.state, "落实");
	assert.equal(result.unchangedByDesign, true);
	assert.equal(result.claimsCompliance, false);
});

test("evaluateApplication：按设计不改变时仍须有指向与依据（缺则未落实）", () => {
	const result = evaluateApplication({
		statement: "某约束",
		actionUnchangedByDesign: true,
		noChangeRationale: "理由",
	});
	assert.equal(result.state, "已识别未落实");
	assert.deepEqual(result.unresolvedCriteria, ["有指向", "有可回指依据"]);
});

test("evaluateApplication：缺 statement 即拒绝", () => {
	for (const bad of [undefined, "", "   ", null]) {
		const result = evaluateApplication({ statement: bad });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "invalid_request");
	}
});

test("summarizeApplications：两类结论分列，永不合并（34 §12）", () => {
	const result = summarizeApplications([
		SETTLED_FINDING,
		{ statement: "只识别未改行动", hasTarget: "范围", hasTraceableBasis: "依据" },
		{ statement: "另一条落实", hasTarget: "路径", hasChange: "换路径", hasTraceableBasis: "依据" },
	]);
	assert.equal(result.ok, true);
	assert.equal(result.落实.length, 2);
	assert.equal(result.已识别未落实.length, 1);
	assert.equal(result.claimsCompliance, false);
	assert.equal(result.mergedConclusionForbidden, true);
});

test("summarizeApplications：空数组合法，仍不给合并结论", () => {
	const result = summarizeApplications([]);
	assert.equal(result.ok, true);
	assert.deepEqual(result.落实, []);
	assert.deepEqual(result.已识别未落实, []);
	assert.equal(result.claimsCompliance, false);
});

test("summarizeApplications：任一条非法即整体拒绝，不返回部分结论", () => {
	const result = summarizeApplications([SETTLED_FINDING, { statement: "x", hasChange: "已遵守" }]);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "application/merged_compliance_claim");
});

test("summarizeApplications：非数组拒绝", () => {
	assert.equal(summarizeApplications("已遵守").error.code, "invalid_request");
});

// ---------------------------------------------------------------------------
// 风险路由（34 §11 环节级声明 / 03 §6.1 三层 / §6.2 快通道五要素）
// ---------------------------------------------------------------------------

test("RISK_TIERS 恰为 03 §6.1 的三层（34 §17 第 4 项禁增设中间层）", () => {
	assert.deepEqual([...RISK_TIERS], ["快通道", "标准路径", "加固路径"]);
});

test("checkRiskRouting：纯读取可走快通道（34 §11 环节级声明）", () => {
	const result = checkRiskRouting({ stage: "纯读取", tier: "快通道" });
	assert.equal(result.ok, true);
	assert.equal(result.allowed, true);
	assert.equal(result.reason, null);
});

test("checkRiskRouting：三段判断走快通道即不成立，并指出最低要求", () => {
	const result = checkRiskRouting({ stage: "三段判断", tier: "快通道" });
	assert.equal(result.ok, true);
	assert.equal(result.allowed, false);
	assert.equal(result.minimumTier, "标准路径");
	assert.match(result.reason, /必须 标准路径 以上/);
});

test("checkRiskRouting：约束落实判定与偏离判定同样不可走快通道", () => {
	for (const stage of ["约束落实判定", "偏离判定"]) {
		const result = checkRiskRouting({ stage, tier: "快通道" });
		assert.equal(result.allowed, false, `${stage} 不应允许快通道`);
		assert.equal(result.minimumTier, "标准路径");
	}
});

test("checkRiskRouting：涉及授权边界时快通道一律不可用（与环节表独立）", () => {
	const result = checkRiskRouting({ stage: "纯读取", tier: "快通道", involvesAuthorization: true });
	assert.equal(result.allowed, false);
	assert.match(result.reason, /授权边界.*不得产自快通道/);
});

test("checkRiskRouting：加固路径满足任何环节的最低要求", () => {
	for (const stage of Object.keys(STAGE_MINIMUM_TIER)) {
		const result = checkRiskRouting({ stage, tier: "加固路径" });
		assert.equal(result.allowed, true, `${stage} 在加固路径下应允许`);
	}
});

test("checkRiskRouting：未知环节拒绝并列出允许集", () => {
	const result = checkRiskRouting({ stage: "随便什么", tier: "标准路径" });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "routing/stage_unknown");
	assert.ok(result.allowed.includes("三段判断"));
});

test("checkRiskRouting：四层或非法风险层拒绝（禁增设中间层）", () => {
	for (const tier of ["中间路径", "快速通道", "", undefined]) {
		const result = checkRiskRouting({ stage: "纯读取", tier });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "routing/tier_invalid");
	}
});

test("checkFastPathDeclaration：五要素齐备即完整", () => {
	const result = checkFastPathDeclaration({
		applicability: "低风险、已反复执行",
		exclusions: "涉及受控写入时不适用",
		minimumCoverage: "仍完成三段判断",
		escalationTriggers: "实际影响超出假设",
		declarationForm: "进入时声明「本次走快通道」并附适用依据",
	});
	assert.equal(result.ok, true);
	assert.equal(result.complete, true);
	assert.equal(result.waivesThreeWay, false);
});

test("checkFastPathDeclaration：缺任要素即拒绝并逐项列出", () => {
	const full = {
		applicability: "a", exclusions: "b", minimumCoverage: "c",
		escalationTriggers: "d", declarationForm: "e",
	};
	for (const requirement of FAST_PATH_REQUIREMENTS) {
		const partial = { ...full };
		delete partial[requirement.key];
		const result = checkFastPathDeclaration(partial);
		assert.equal(result.ok, false, `缺 ${requirement.label} 须拒绝`);
		assert.equal(result.error.code, "fastpath/declaration_incomplete");
		assert.deepEqual(result.missing, [requirement.label]);
	}
});

test("checkFastPathDeclaration：不得声明免除三段判断（03 §6.2 第 3 项）", () => {
	const result = checkFastPathDeclaration({
		applicability: "a", exclusions: "b", minimumCoverage: "c",
		escalationTriggers: "d", declarationForm: "e",
		waivesThreeWayJudgement: true,
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "fastpath/waives_three_way");
});
