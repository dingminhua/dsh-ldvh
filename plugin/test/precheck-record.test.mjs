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
	RETURN_ITEMS,
	THREE_WAY_ITEMS,
	COMPLIANCE_BUCKET_LABELS,
	assembleReturn,
	CONFLICT_TIERS,
	SELF_TIER_SEGMENT,
	routeConflict,
	ENTRY_SIGNALS,
	GAP_FIELDS,
	checkGapRegistration,
	FAILURE_ROUTES,
	checkEntry,
	routeFailure,
	FAST_PATH_REQUIREMENTS,
	RISK_TIERS,
	STAGE_MINIMUM_TIER,
	checkFastPathDeclaration,
	checkRiskRouting,
	checkTransverseMerge,
	CONDITIONAL_SECTIONS,
	DEVIATION_FIELDS,
	DEVIATION_FORMS,
	checkRetroactiveCoverage,
	evaluateApplication,
	evaluateDeviation,
	FINDING_STATES,
	RECALLED_LABEL,
	RECALL_MARKS,
	RECORD_HEADER,
	REQUIRED_SECTIONS,
	REUSE_CONDITIONS,
	checkFindingStates,
	checkRecordShape,
	evaluateReuse,
	fingerprintCarriers,
	recordFingerprint,
	renderPrecheckRecord,
	parseRecord,
	detectRitualRecord,
	HUMAN_GATE_ITEMS,
	NON_EQUIVALENCES,
	checkConceptBoundaries,
	checkHumanGate,
	HANDOVER_LAYERS,
	declareHandoverLayer,
	roundTripRecord,
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

test("recalled：未传时如实留「未声明」并带出理由，不冒充「未触发」（03 §7.2 末句）", () => {
	const result = renderPrecheckRecord(COMPLETE_FIELDS);
	// 修正（首版错误）：缺省只说明调用方没说，不说明召回时机未成立。
	// 把未知写成「未触发」正是 §7.2 要防的「把没查的写成查过了」。
	assert.match(result.text, /^ {2}- ADR：未声明$/m);
	assert.match(result.text, /^ {2}- Pitfall：未声明$/m);
	assert.match(result.recallDeclarationGap, /未给出「已召回」区/);
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
	// 不能替调用方判 Pitfall 未触发——缺省即「未声明」。
	assert.match(result.text, /^ {2}- Pitfall：未声明$/m);
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

// ---------------------------------------------------------------------------
// 进入判定（34 §6）与失败分流 / 停止位置（34 §8）
// ---------------------------------------------------------------------------

test("ENTRY_SIGNALS 恰为 34 §6 列出的四种情形", () => {
	assert.equal(ENTRY_SIGNALS.length, 4);
	assert.ok(ENTRY_SIGNALS.some((s) => s.includes("副作用")));
	assert.ok(ENTRY_SIGNALS.some((s) => s.includes("未验证范围")));
});

test("checkEntry：纯读取不进入本系统（§6 排除条件优先于进入信号）", () => {
	for (const kind of ["纯读取", "纯查询"]) {
		const result = checkEntry({ actionKind: kind, signals: ["即将执行会产生副作用或改变状态的动作"] });
		assert.equal(result.ok, true);
		assert.equal(result.entered, false, `${kind} 不应进入`);
		assert.match(result.reason, /排除条件/);
	}
});

test("checkEntry：命中任一进入信号即进入", () => {
	const result = checkEntry({ signals: ["既有规则、事实、决定或授权发生变化"] });
	assert.equal(result.entered, true);
	assert.deepEqual(result.signals, ["既有规则、事实、决定或授权发生变化"]);
});

test("checkEntry：适用性不明时不得按「无约束」处理（§6 不确定处理）", () => {
	const result = checkEntry({ signals: [], applicabilityUndetermined: true });
	assert.equal(result.ok, true);
	assert.equal(result.entered, null, "不得返回 entered:false 冒充「不适用」");
	assert.equal(result.undetermined, true);
	assert.equal(result.mustRegisterAsUnverified, true);
	assert.equal(result.mustStop, true);
	assert.match(result.reason, /不得按「无约束」处理/);
});

test("checkEntry：不明但确认不会改变行动是否被允许时可不停（仍须登记未验证范围）", () => {
	const result = checkEntry({ applicabilityUndetermined: true, mayChangePermission: false });
	assert.equal(result.mustStop, false);
	assert.equal(result.mustRegisterAsUnverified, true);
});

test("checkEntry：未知进入信号拒绝并列出允许集", () => {
	const result = checkEntry({ signals: ["我觉得要检查"] });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "entry/signal_unknown");
	assert.equal(result.allowed.length, 4);
});

test("checkEntry：无信号且未声明不明时给「未命中」而非「已排除」", () => {
	const result = checkEntry({ signals: [] });
	assert.equal(result.entered, false);
	assert.match(result.reason, /不表示适用性已被否证/);
});

test("FAILURE_ROUTES 恰为 34 §8 的四条失败分流", () => {
	// 措辞取 34 §8「失败分流」原文逐字（2026-10-23 修正：原写「三段判断不成立」，
	// 原文是「三段判断任一项不成立 → 按其性质分流」）。
	assert.deepEqual(
		[...FAILURE_ROUTES],
		["识别失败", "三段判断任一项不成立", "落实未发生", "偏离已发生"],
	);
});

test("routeFailure：四条去向一律 mustStop（§8 停止位置：任一失败分流点都是停止位置）", () => {
	for (const route of FAILURE_ROUTES) {
		const result = routeFailure({ route });
		assert.equal(result.ok, true);
		assert.equal(result.mustStop, true, `${route} 必须停止`);
		assert.equal(result.partialDeliveryForbidden, true, "不得以「其余部分已完成」部分交付");
		assert.equal(result.mustCarryResidualToHandover, true, "残留范围须进入交还");
	}
});

test("routeFailure：三条判断不成立的处置按性质分别说明", () => {
	const result = routeFailure({ route: "三段判断任一项不成立" });
	assert.match(result.action, /生效不成立补来源/);
	assert.match(result.action, /适用不成立缩小范围/);
	assert.match(result.action, /行动允许不成立停止/);
});

test("routeFailure：识别失败不得以「已尽力检索」代替结论", () => {
	const result = routeFailure({ route: "识别失败" });
	assert.match(result.action, /不得以「已尽力检索」代替识别结论/);
});

test("routeFailure：未知去向拒绝", () => {
	const result = routeFailure({ route: "再看看" });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "failure/route_unknown");
});

// ---------------------------------------------------------------------------
// 横切合并且不替代（34 §11 / §16.1 第 6 项必停）
// ---------------------------------------------------------------------------

test("checkTransverseMerge：两套都执行才构成通过", () => {
	const result = checkTransverseMerge({
		systemKey: "workcase",
		ruleComplianceExecuted: true,
		systemSpecificExecuted: true,
	});
	assert.equal(result.ok, true);
	assert.equal(result.passed, true);
	assert.deepEqual(result.missing, []);
	assert.match(result.proves, /不证明任一套正确/);
});

test("checkTransverseMerge：只做本系统不免除该系统（§11 第一句）", () => {
	const result = checkTransverseMerge({
		systemKey: "workcase",
		ruleComplianceExecuted: true,
		systemSpecificExecuted: false,
	});
	assert.equal(result.passed, false);
	assert.deepEqual(result.missing, ["workcase 的专属预检"]);
	assert.equal(result.stopCondition, "34 §16.1 第 6 项");
});

test("checkTransverseMerge：只做该系统不免除本系统（§11 第二句，双向对称）", () => {
	const result = checkTransverseMerge({
		systemKey: "workcase",
		ruleComplianceExecuted: false,
		systemSpecificExecuted: true,
	});
	assert.equal(result.passed, false);
	assert.deepEqual(result.missing, ["本系统的适用识别与预检"]);
});

test("checkTransverseMerge：两套都缺时逐项列出", () => {
	const result = checkTransverseMerge({ systemKey: "spark" });
	assert.equal(result.passed, false);
	assert.equal(result.missing.length, 2);
});

test("checkTransverseMerge：缺 systemKey 即拒绝（不知在哪个系统内执行）", () => {
	for (const bad of [undefined, "", null]) {
		const result = checkTransverseMerge({ systemKey: bad });
		assert.equal(result.ok, false);
		assert.equal(result.error.code, "invalid_request");
	}
});

// ---------------------------------------------------------------------------
// 未识别缺口的登记（34 §14 该行：不得以「已尽力」替代）
// ---------------------------------------------------------------------------

test("GAP_FIELDS 恰为 §14 缺口清单核对要求的三项", () => {
	assert.deepEqual(GAP_FIELDS.map((f) => f.label), ["未识别的来源", "影响的范围", "缺口状态"]);
});

test("checkGapRegistration：三项齐备即登记成立，但不声称缺口已闭合", () => {
	const result = checkGapRegistration([
		{ source: "specs/07 Web 呈现", scope: "本单不做呈现层", state: "未识别" },
	]);
	assert.equal(result.ok, true);
	assert.equal(result.count, 1);
	assert.match(result.proves, /不证明缺口已闭合/);
	assert.equal(result.closesGaps, false);
});

test("checkGapRegistration：写「已尽力」类措辞即拒绝（§14 点名禁止）", () => {
	for (const term of ["已尽力", "尽力了", "已充分检索", "已全面检索", "应该没有遗漏"]) {
		const result = checkGapRegistration([
			{ source: "x", scope: "y", state: "未识别", note: `关于这个来源，${term}` },
		]);
		assert.equal(result.ok, false, `${term} 不应被接受`);
		assert.equal(result.error.code, "gap/substitute_claim");
	}
});

test("checkGapRegistration：缺口缺任一项即未如实登记", () => {
	for (const field of GAP_FIELDS) {
		const gap = { source: "s", scope: "p", state: "未识别" };
		delete gap[field.key];
		const result = checkGapRegistration([gap]);
		assert.equal(result.ok, false, `缺 ${field.label} 须拒绝`);
		assert.equal(result.error.code, "gap/incomplete");
		assert.deepEqual(result.incomplete[0].missing, [field.label]);
	}
});

test("checkGapRegistration：多个缺口缺项时逐个指出，不只报第一个", () => {
	const result = checkGapRegistration([
		{ source: "a", scope: "b", state: "未识别" },
		{ source: "a" },
		{ scope: "b" },
	]);
	assert.equal(result.error.code, "gap/incomplete");
	assert.equal(result.incomplete.length, 2);
	assert.deepEqual(result.incomplete.map((i) => i.index), [1, 2]);
});

test("checkGapRegistration：空数组合法（表示无缺口，其真假由语义判断）", () => {
	const result = checkGapRegistration([]);
	assert.equal(result.ok, true);
	assert.equal(result.count, 0);
	assert.equal(result.closesGaps, false);
});

test("checkGapRegistration：非数组拒绝", () => {
	assert.equal(checkGapRegistration("无缺口").error.code, "invalid_request");
});

// ---------------------------------------------------------------------------
// §12 交还组装（七项 + 强制区分两类结论）
// ---------------------------------------------------------------------------

const RETURN_INPUT = {
	identification: "读 specs/34 §12 与 §14 全文；查 plugin/lib 现有导出",
	threeWayJudgement: { effective: "34 与 03 §7.2 均生效", applicable: "§12 交还结构适用", allowed: "本会话授权仅限 plugin/ 下" },
	application: summarizeApplications([
		{ statement: "a", hasTarget: "范围", hasChange: "改为分列", hasTraceableBasis: "§12" },
		{ statement: "b", hasTarget: "路径", hasTraceableBasis: "§8.3" },
	]),
	recalled: "ADR 一条（已适用）；Pitfall 未触发",
	unverified: "specs/34 的 operation 声明未落盘",
	humanDecisions: "是否批准 34 号加操作声明",
};

test("RETURN_ITEMS 恰为 34 §12 的七项，且只有「偏离情况」是条件项", () => {
	assert.equal(RETURN_ITEMS.length, 7);
	const optional = RETURN_ITEMS.filter((i) => !i.required).map((i) => i.label);
	assert.deepEqual(optional, ["偏离情况"], "原文只有偏离情况带「如有」");
});

test("assembleReturn：六项齐备 + 三段判断逐项 + 两类分列即组装成功", () => {
	const result = assembleReturn(RETURN_INPUT);
	assert.equal(result.ok, true);
	assert.equal(result.complete, true);
	assert.equal(result.claimsCompliance, false);
	assert.equal(result.distinctionEnforced, true);
	assert.deepEqual(result.buckets, { 已落实: 1, 已识别未落实: 1 });
	assert.match(result.text, /已落实：1 项/);
	assert.match(result.text, /已识别未落实：1 项/);
});

test("assembleReturn：缺任一必填项即拒绝并列出缺项", () => {
	for (const item of RETURN_ITEMS.filter((i) => i.required)) {
		const partial = { ...RETURN_INPUT };
		delete partial[item.key];
		const result = assembleReturn(partial);
		assert.equal(result.ok, false, `缺 ${item.label} 须拒绝`);
		assert.equal(result.error.code, "return/items_missing");
		assert.ok(result.missing.some((m) => m.includes(item.label)));
	}
});

test("assembleReturn：偏况缺省合法（「如有」），不会因缺它而拒绝", () => {
	const result = assembleReturn({ ...RETURN_INPUT, deviations: undefined });
	assert.equal(result.ok, true);
	assert.match(result.text, /偏离情况：无/);
});

test("assembleReturn：三段判断写成一句话即拒绝（§12「逐项」）", () => {
	const result = assembleReturn({ ...RETURN_INPUT, threeWayJudgement: "三项都成立" });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "return/three_way_not_itemized");
});

test("assembleReturn：三段判断缺其中一项即拒绝，并指明缺哪项", () => {
	for (const item of THREE_WAY_ITEMS) {
		const threeWay = { ...RETURN_INPUT.threeWayJudgement };
		delete threeWay[item.key];
		const result = assembleReturn({ ...RETURN_INPUT, threeWayJudgement: threeWay });
		assert.equal(result.ok, false);
		assert.ok(result.missing.some((m) => m.includes(item.label)));
	}
});

test("assembleReturn：约束落实未分列两类即拒绝（§12 第二段）", () => {
	// 注意 `{落实: [], 已识别未落实: []}` 是**正确**的分列形态（summarizeApplications 的返回），
	// 空数组不等于缺失——不得把它当违规。故此处只列真正未分列的三种。
	for (const bad of ["已落实 3 项、未落实 1 项", { 落实: [] }, null]) {
		const result = assembleReturn({ ...RETURN_INPUT, application: bad });
		assert.equal(result.ok, false, `${JSON.stringify(bad)} 不应被接受`);
		assert.equal(result.error.code, "return/items_missing");
		// 未分列的两种违规形态会走不同分支：单串走「形态不符」，缺一个桶走「须分列」。
		// 二者都是拒绝，断言只要求「问题项落在约束落实这一段」，不钉具体措辞。
		assert.ok(result.missing.some((m) => m.includes("约束落实的具体形态")));
	}
});

test("assembleReturn：正文出现「已遵守」即拒绝（§12 禁合并结论）", () => {
	const result = assembleReturn({ ...RETURN_INPUT, identification: "本次已遵守全部约束" });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "return/merged_conclusion");
	assert.match(result.error.message, /已遵守/);
});

test("assembleReturn：偏离情况逐条过 §9.2，非法形态整体拒绝", () => {
	const result = assembleReturn({
		...RETURN_INPUT,
		deviations: [{ ...DEVIATION_OK }, { ...DEVIATION_OK, form: "小失误" }],
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "deviation/form_invalid");
});

test("assembleReturn：合法偏离情况逐条留痕", () => {
	const result = assembleReturn({ ...RETURN_INPUT, deviations: [DEVIATION_OK] });
	assert.equal(result.ok, true);
	assert.equal(result.deviations.length, 1);
	assert.match(result.text, /1 项，均已按 §9\.2 登记/);
});

// ---------------------------------------------------------------------------
// 来源冲突层级（34 §7.5：只用于提请，不构成自动裁决）
// ---------------------------------------------------------------------------

test("CONFLICT_TIERS 恰为 34 §7.5 的五级", () => {
	assert.deepEqual(CONFLICT_TIERS.map((t) => t.level), [1, 2, 3, 4, 5]);
	assert.equal(SELF_TIER_SEGMENT, "30–39 业务系统规范");
});

test("routeConflict：任何合法层级组合都只提请 Human，永不自动裁决", () => {
	for (const a of [1, 2, 3, 4, 5]) {
		for (const b of [1, 2, 3, 4, 5]) {
			if (a === b) continue;
			const result = routeConflict({ levelA: a, levelB: b });
			assert.equal(result.ok, true);
			assert.equal(result.escalateTo, "Human", `${a} vs ${b} 须提请 Human`);
			assert.equal(result.autoResolved, false, `${a} vs ${b} 不得自动裁决`);
			assert.equal(result.picks, null, "不得给出「选哪一方」的出口");
		}
	}
});

test("routeConflict：层级数值不是优先级分数（§7.5 边界）", () => {
	const result = routeConflict({ levelA: 1, levelB: 5 });
	assert.equal(result.levelsAreScores, false);
	assert.equal(result.picks, null, "高一级不得自动覆盖低一级");
});

test("routeConflict：本规范自身不在表内，故涉己时不得按级处置（表头括注）", () => {
	const result = routeConflict({ levelA: 4, levelB: 3, involvesThisSpec: true });
	assert.equal(result.escalateTo, "Human");
	assert.match(result.reason, /本规范自身不在层级表内/);
	assert.equal(result.autoResolved, false);
});

test("routeConflict：第 1 级且触及根决定清单时一律提请（§7.5 两段式）", () => {
	const result = routeConflict({ levelA: 1, levelB: 2, touchesRootDecisionList: true });
	assert.equal(result.escalateTo, "Human");
	assert.match(result.reason, /一律提请 Human/);
});

test("routeConflict：第 1 级未触及根决定时仍提请，不自行依根规范处置", () => {
	// §7.5 给了「仅当不触及根决定且根规范已给明文结论」的窄路，但那需要
	// 调用方证明「根规范已给出明文结论」——本函数不替它判定，故仍回提请。
	const result = routeConflict({ levelA: 1, levelB: 5 });
	assert.equal(result.escalateTo, "Human");
	assert.equal(result.autoResolved, false);
});

test("routeConflict：非法层级拒绝并列出允许集", () => {
	for (const bad of [0, 6, -1, 1.5, "1", undefined]) {
		const result = routeConflict({ levelA: bad, levelB: 2 });
		assert.equal(result.ok, false, `${JSON.stringify(bad)} 应被拒绝`);
		assert.equal(result.error.code, "conflict/level_invalid");
	}
});

// ---------------------------------------------------------------------------
// 「未触发」与「未遍历」不得互换（03 §7.2 末句，2026-10-23 修正）
// ---------------------------------------------------------------------------

test("RECALL_MARKS 恰为三个合法取值", () => {
	assert.deepEqual([...RECALL_MARKS], ["未触发", "未遍历", "未声明"]);
});

test("recalled：显式声明「未触发」与「未遍历」各自原样保留", () => {
	const result = renderPrecheckRecord({
		...COMPLETE_FIELDS,
		tier: "快通道",
		recalled: { adr: "未触发", pitfall: "未遍历" },
	});
	assert.match(result.text, /^ {2}- ADR：未触发$/m);
	assert.match(result.text, /^ {2}- Pitfall：未遍历$/m);
});

test("recalled：快通道下未逐级标明即带出警告（§7.2 末句要求明确标记）", () => {
	const result = renderPrecheckRecord({
		...COMPLETE_FIELDS,
		tier: "快通道",
		recalled: { adr: "未触发" },
	});
	assert.equal(result.fastPathWarnings.length, 1);
	assert.match(result.fastPathWarnings[0], /未遍历/);
});

test("recalled：把「未遍历」写成「已核对」即拒绝（§7.2 点名禁止）", () => {
	const result = renderPrecheckRecord({
		...COMPLETE_FIELDS,
		recalled: { adr: "未遍历（已核对全部）", pitfall: "未触发" },
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "record/recall_mark_swapped");
	assert.deepEqual(result.offenders.map((o) => o.level), ["ADR"]);
});

test("recalled：标准路径下未逐级标明不产生快通道警告（该警告仅属快通道）", () => {
	const result = renderPrecheckRecord({
		...COMPLETE_FIELDS,
		tier: "标准路径",
		recalled: { adr: "未触发" },
	});
	assert.deepEqual(result.fastPathWarnings, []);
});

// ---------------------------------------------------------------------------
// 回读（34 §10「生成后须可回读」）
// ---------------------------------------------------------------------------

test("parseRecord：把完整记录解析回结构化字段", () => {
	const { text } = renderPrecheckRecord(COMPLETE_FIELDS);
	const parsed = parseRecord(text);
	assert.equal(parsed.ok, true);
	assert.equal(parsed.complete, true);
	assert.deepEqual(parsed.missing, []);
	assert.equal(parsed.fields.effective, COMPLETE_FIELDS.effective);
	assert.equal(parsed.fields.applicable, COMPLETE_FIELDS.applicable);
	assert.equal(parsed.fields.allowed, COMPLETE_FIELDS.allowed);
	assert.equal(parsed.fields.unverified, COMPLETE_FIELDS.unverified);
});

test("parseRecord：两级「已召回」各自解析", () => {
	const { text } = renderPrecheckRecord({
		...COMPLETE_FIELDS,
		recalled: { adr: "adr-1 适用", pitfall: "未遍历" },
	});
	const parsed = parseRecord(text);
	assert.deepEqual(parsed.fields.recalled, { adr: "adr-1 适用", pitfall: "未遍历" });
});

test("parseRecord：条件段出现即解析，未出现则不在结果里（不虚构占位）", () => {
	const without = parseRecord(renderPrecheckRecord(COMPLETE_FIELDS).text);
	assert.equal(without.fields.fastPath, undefined);
	assert.equal(without.fields.escalation, undefined);

	const withFast = parseRecord(
		renderPrecheckRecord({ ...COMPLETE_FIELDS, fastPath: "低风险", escalation: "触及受控写入" }).text,
	);
	assert.equal(withFast.fields.fastPath, "低风险");
	assert.equal(withFast.fields.escalation, "触及受控写入");
});

test("parseRecord：缺段时 complete=false 并列出缺项（回读的交还入口）", () => {
	const parsed = parseRecord(`${RECORD_HEADER}\n\n- 生效规则：x\n`);
	assert.equal(parsed.complete, false);
	assert.deepEqual(parsed.missing, ["适用规则", "行动允许", "未验证范围", "已召回"]);
});

test("parseRecord：不解析段内语义，明写只证明可解析", () => {
	const parsed = parseRecord(renderPrecheckRecord(COMPLETE_FIELDS).text);
	assert.match(parsed.proves, /不证明其取值正确或识别充分/);
});

test("parseRecord：缺起首标记与空入参均拒绝", () => {
	assert.equal(parseRecord("- 生效规则：x").error.code, "record/header_missing");
	for (const bad of ["", "   ", null, undefined]) {
		assert.equal(parseRecord(bad).error.code, "invalid_request");
	}
});

test("parseRecord：不认识的段被忽略，不误当已识别项", () => {
	const parsed = parseRecord(`${RECORD_HEADER}\n\n- 生效规则：x\n- 随便一段：y\n`);
	assert.equal(parsed.fields.effective, "x");
	assert.equal(parsed.fields["随便一段"], undefined);
});

test("roundTripRecord：渲染再解析后字段等价（防渲染器与解析器漂移）", () => {
	const result = roundTripRecord(COMPLETE_FIELDS);
	assert.equal(result.ok, true);
	assert.equal(result.roundTripStable, true);
	assert.deepEqual(result.diffs, []);
});

test("roundTripRecord：含条件段时往返仍稳定", () => {
	const result = roundTripRecord({ ...COMPLETE_FIELDS, fastPath: "低风险", escalation: "升级原因" });
	assert.equal(result.roundTripStable, true);
});

test("roundTripRecord：渲染阶段被拒时原样返回该拒绝（不吞错误）", () => {
	const result = roundTripRecord({ effective: "只有一段" });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "record/section_missing");
});

test("shape 与 parseRecord 对同一输入的 complete 判定必须一致（防两套标签逻辑漂移）", () => {
	const cases = [
		renderPrecheckRecord(COMPLETE_FIELDS).text,
		renderPrecheckRecord({ ...COMPLETE_FIELDS, fastPath: "e" }).text,
		`${RECORD_HEADER}\n\n- 生效规则：x\n`,
		`${RECORD_HEADER}\n`,
	];
	for (const [index, text] of cases.entries()) {
		const shape = checkRecordShape(text);
		const parsed = parseRecord(text);
		assert.equal(
			shape.complete,
			parsed.complete,
			`第 ${index} 个输入上两个判定器结论不一致：shape=${shape.complete} parse=${parsed.complete}`,
		);
	}
});

// ---------------------------------------------------------------------------
// 反仪式自查（34 §17 第 2 项）
// ---------------------------------------------------------------------------

test("detectRitualRecord：全「无」内容的记录被标为疑似，但不拒绝", () => {
	const result = detectRitualRecord({
		effective: "无", applicable: "无", allowed: "无", unverified: "无",
		recalled: { adr: "无", pitfall: "无" },
	});
	assert.equal(result.ok, true);
	assert.equal(result.ritualSuspected, true);
	assert.equal(result.judged, false, "机械层不做语义判定");
	assert.ok(result.suspect.length >= 4);
	assert.match(result.notice, /§17 第 2 项/);
});

test("detectRitualRecord：有实质内容时不标疑", () => {
	const result = detectRitualRecord(COMPLETE_FIELDS);
	assert.equal(result.ritualSuspected, false);
	assert.equal(result.notice, null);
});

test("detectRitualRecord：两级召回均为「未声明」也算疑似（整个召回区没交代）", () => {
	const result = detectRitualRecord({
		...COMPLETE_FIELDS,
		recalled: { adr: "未声明", pitfall: "未声明" },
	});
	assert.ok(result.suspect.some((item) => item.section === RECALLED_LABEL));
});

test("detectRitualRecord：「略」「同上」「N/A」等也计入", () => {
	for (const term of ["略", "同上", "N/A", "—"]) {
		const result = detectRitualRecord({ ...COMPLETE_FIELDS, effective: term });
		assert.equal(result.ritualSuspected, true, `${term} 应被检出`);
	}
});

test("renderPrecheckRecord：疑似空记录仍渲染成功，但带出提醒（不阻断）", () => {
	const result = renderPrecheckRecord({
		effective: "无", applicable: "无", allowed: "无", unverified: "无",
		recalled: { adr: "无", pitfall: "无" },
	});
	assert.equal(result.ok, true, "不得因疑似而拒绝——会逼出更糟的空话");
	assert.equal(result.ritualSuspected, true);
	assert.match(result.ritualNotice, /凑段/);
});

test("renderPrecheckRecord：实质内容不产生仪式提醒", () => {
	const result = renderPrecheckRecord(COMPLETE_FIELDS);
	assert.equal(result.ritualSuspected, false);
	assert.equal(result.ritualNotice, null);
});

// ---------------------------------------------------------------------------
// Human Gate 领域增量（34 §15.1 / §15.2）
// ---------------------------------------------------------------------------

test("HUMAN_GATE_ITEMS 恰为 34 §15.1 的四项", () => {
	assert.equal(HUMAN_GATE_ITEMS.length, 4);
	assert.deepEqual(
		HUMAN_GATE_ITEMS.map((i) => i.key),
		["sourceConflict", "sourceDefect", "scopeEscalation", "acceptIncomplete"],
	);
});

test("checkHumanGate：空列表不需 Human", () => {
	const result = checkHumanGate([]);
	assert.equal(result.ok, true);
	assert.equal(result.requiresHuman, false);
	assert.equal(result.fastPathAllowed, true);
});

test("checkHumanGate：任一项触发即需 Human，且禁用快通道（§11 授权边界）", () => {
	for (const item of HUMAN_GATE_ITEMS) {
		const result = checkHumanGate([item.key]);
		assert.equal(result.requiresHuman, true, `${item.key} 应触发 Gate`);
		assert.equal(result.fastPathAllowed, false, `${item.key} 不得走快通道`);
		assert.deepEqual(result.triggered, [item.key]);
		assert.deepEqual(result.labels, [item.label]);
	}
});

test("checkHumanGate：多项并发时逐条列出，不只报第一项", () => {
	const result = checkHumanGate(["sourceConflict", "scopeEscalation"]);
	assert.deepEqual(result.triggered, ["sourceConflict", "scopeEscalation"]);
	assert.equal(result.labels.length, 2);
});

test("checkHumanGate：永不提供「已批准」出口（§15.2 批准不解除识别义务）", () => {
	const result = checkHumanGate(["acceptIncomplete"]);
	assert.equal(result.approved, undefined, "不得提供 approved 字段");
	assert.equal(result.approvalDoesNotGrantIdentification, true);
	assert.equal(result.approvalDoesNotGrantCompliance, true);
});

test("checkHumanGate：未知事项拒绝并列出允许集", () => {
	const result = checkHumanGate(["我想继续"]);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "gate/item_unknown");
	assert.equal(result.allowed.length, 4);
});

test("checkHumanGate：非数组拒绝", () => {
	assert.equal(checkHumanGate("sourceConflict").error.code, "invalid_request");
});

// ---------------------------------------------------------------------------
// 相近概念区分（34 §13 末条 / §14 末段的三条边界）
// ---------------------------------------------------------------------------

test("NON_EQUIVALENCES 覆盖 §13 的五条与 §14 的三条边界", () => {
	const pairs = NON_EQUIVALENCES.map((n) => `${n.left}≠${n.doesNotImply}`);
	for (const expected of [
		"识别≠落实", "落实≠授权", "预检记录完成≠行动完成",
		"已识别≠已允许", "补做识别≠从未偏离", "已落实≠已完成",
	]) {
		assert.ok(pairs.includes(expected), `应含 ${expected}`);
	}
});

test("checkConceptBoundaries：干净文本无违规", () => {
	const result = checkConceptBoundaries("本次识别到三条约束，其中一条已落实，另一条已识别未落实。");
	assert.equal(result.clean, true);
	assert.deepEqual(result.violations, []);
});

test("checkConceptBoundaries：三条 §14 末段边界逐个可抓", () => {
	const cases = [
		["已识别即已允许，可以继续", "已识别", "已允许"],
		["该项已落实=已完成", "已落实", "已完成"],
		["补做识别就是从未偏离", "补做识别", "从未偏离"],
	];
	for (const [text, left, right] of cases) {
		const result = checkConceptBoundaries(text);
		assert.equal(result.clean, false, `${text} 应被抓到`);
		assert.equal(result.violations[0].left, left);
		assert.equal(result.violations[0].right, right);
	}
});

test("checkConceptBoundaries：§13 的另外三条也可抓", () => {
	for (const text of ["识别即落实", "落实即授权", "预检记录完成即行动完成"]) {
		assert.equal(checkConceptBoundaries(text).clean, false, `${text} 应被抓到`);
	}
});

test("checkConceptBoundaries：多种符号写法都能抓到", () => {
	for (const sep of ["即", "=", "＝", "就是"]) {
		const result = checkConceptBoundaries(`已识别${sep}已允许`);
		assert.equal(result.clean, false, `分隔符 ${sep} 应被抓到`);
	}
});

test("checkConceptBoundaries：违规项带规范依据与说明", () => {
	const result = checkConceptBoundaries("已识别即已允许");
	assert.match(result.violations[0].specRef, /34 §/);
	assert.match(result.violations[0].note, /不得被跨越/);
});

test("checkConceptBoundaries：明写只抓字面等式，不证明未隐含（边界声明）", () => {
	const result = checkConceptBoundaries("本次工作已识别全部相关规则。");
	assert.equal(result.clean, true);
	assert.match(result.proves, /不证明文中未隐含该结论/);
	assert.equal(result.nonEquivalences, 6);
});

test("checkConceptBoundaries：空入参拒绝", () => {
	for (const bad of ["", "  ", null, undefined]) {
		assert.equal(checkConceptBoundaries(bad).error.code, "invalid_request");
	}
});

// ---------------------------------------------------------------------------
// 段数的事实核对（2026-10-23 修正：注释首版误称「六段」）
// ---------------------------------------------------------------------------

test("03 §7.2 的顶层条目为 7 个：4 字符串必需 + 已召回 + 2 条件", () => {
	// 这是对规范原文的核对，不是对实现的核对——防止注释再次数与原文不符。
	assert.equal(REQUIRED_SECTIONS.length, 4, "字符串必需段四个");
	assert.equal(CONDITIONAL_SECTIONS.length, 2, "条件条目两个，原文均带「如」");
	// 4 + 已召回(1) + 2 = 7
	assert.equal(REQUIRED_SECTIONS.length + 1 + CONDITIONAL_SECTIONS.length, 7);
	// 必备标签数（含已召回）为 5——checkRecordShape 与 parseRecord 同口径。
	const requiredLabels = [...REQUIRED_SECTIONS.map((s) => s.label), RECALLED_LABEL];
	assert.equal(requiredLabels.length, 5);
	const parsed = parseRecord(`${RECORD_HEADER}\n\n`);
	assert.deepEqual(parsed.missing.slice().sort(), requiredLabels.slice().sort());
});

test("条件条目的原文措辞确实带「如」（不得把它们当必需段）", () => {
	const labels = CONDITIONAL_SECTIONS.map((s) => s.label);
	assert.deepEqual(labels, ["快通道声明", "升级记录"]);
});

// ---------------------------------------------------------------------------
// 系统执行分层交还（03 §5.5）—— 三层互不替代、不得跳层
// ---------------------------------------------------------------------------

test("HANDOVER_LAYERS 恰为 03 §5.5 的三层", () => {
	assert.deepEqual(
		HANDOVER_LAYERS.map((l) => l.label),
		["流程完成层", "验证通过层", "交还承接层"],
	);
});

test("declareHandoverLayer：三层全成立时到交还承接层", () => {
	const result = declareHandoverLayer({
		flowComplete: true, verificationPassed: true, handoverCarried: true,
	});
	assert.equal(result.ok, true);
	assert.equal(result.reached, "交还承接层");
	assert.deepEqual(result.layers, ["流程完成层", "验证通过层", "交还承接层"]);
	assert.equal(result.status, "carried");
});

test("declareHandoverLayer：永不声称价值成立（§5.5 末句）", () => {
	const result = declareHandoverLayer({
		flowComplete: true, verificationPassed: true, handoverCarried: true,
	});
	assert.equal(result.provesValue, false);
	// §5.4 末句：静态存在不单独替代成立条件。
	assert.equal(result.staticExistenceSuffices, false);
});

test("declareHandoverLayer：不得跳层到验证通过层", () => {
	const result = declareHandoverLayer({ flowComplete: false, verificationPassed: true });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "handover/layer_skipped");
	assert.match(result.error.message, /验证通过层/);
});

test("declareHandoverLayer：不得跳层到交还承接层", () => {
	const result = declareHandoverLayer({ flowComplete: true, verificationPassed: false, handoverCarried: true });
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "handover/layer_skipped");
	assert.match(result.error.message, /交还承接层/);
});

test("declareHandoverLayer：覆盖不足时只能停在流程完成层并交还 partial/unverified", () => {
	const result = declareHandoverLayer({
		flowComplete: true, verificationPassed: true, handoverCarried: true, coverageInsufficient: true,
	});
	assert.equal(result.ok, true);
	assert.equal(result.reached, "流程完成层");
	assert.equal(result.status, "partial/unverified");
	assert.deepEqual(result.layers, ["流程完成层"]);
});

test("declareHandoverLayer：仅流程完成即如实停在第一层", () => {
	const result = declareHandoverLayer({ flowComplete: true });
	assert.equal(result.reached, "流程完成层");
	assert.equal(result.status, "partial/unverified");
});

test("declareHandoverLayer：什么都没成立时也停在第一层且标 partial", () => {
	const result = declareHandoverLayer({});
	assert.equal(result.ok, true);
	assert.equal(result.reached, "流程完成层");
	assert.equal(result.status, "partial/unverified");
});
