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
	CONDITIONAL_SECTIONS,
	FINDING_STATES,
	RECALLED_LABEL,
	RECORD_HEADER,
	REQUIRED_SECTIONS,
	REUSE_CONDITIONS,
	checkFindingStates,
	checkRecordShape,
	evaluateReuse,
	fingerprintCarriers,
	readRecord,
	recordFingerprint,
	recordPath,
	renderPrecheckRecord,
	writeRecord,
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
// 落盘与回读（specs/10 §7.7：路径由 dshHomePath 解析，不硬编码）
// ---------------------------------------------------------------------------

test("recordPath：路径由 dshHomePath 解析得到，落在 ldvh/ 域内且不碰事实源", () => {
	const calls = [];
	const fakeHome = (...segments) => {
		calls.push(segments);
		return join("/dsh-home", ...segments);
	};
	const path = recordPath(fakeHome, { sessionId: "session-abc", stamp: "20261023T140000" });
	assert.equal(calls[0][0], "ldvh", "首段须是 ldvh 域（10 §7.7）");
	assert.ok(path.startsWith(join("/dsh-home", "ldvh")), `路径须在 ldvh 域下，实际 ${path}`);
	assert.doesNotMatch(path, /ldvh-base/, "不得写入项目事实源目录（34 §10）");
});

test("recordPath：sessionId 与 stamp 中的路径分隔符被规范化，不能逃出目录", () => {
	const path = recordPath((...segments) => join("/dsh-home", ...segments), {
		sessionId: "../../etc/passwd",
		stamp: "a/b",
	});
	assert.doesNotMatch(path, /\.\.\//, "不得把 .. 带进落盘路径");
	assert.equal(path.startsWith(join("/dsh-home", "ldvh")), true);
});

test("recordPath：缺少参数或 dshHomePath 不可用时抛错，不退回默认路径", () => {
	assert.throws(() => recordPath(undefined, { sessionId: "s", stamp: "t" }), /dshHomePath/);
	assert.throws(() => recordPath((...s) => s.join("/"), { stamp: "t" }), /sessionId/);
	assert.throws(() => recordPath((...s) => s.join("/"), { sessionId: "s" }), /stamp/);
});

test("writeRecord：落盘后回读逐字一致，并给出内容指纹", async () => {
	const root = await mkdtemp(join(tmpdir(), "ldvh-precheck-"));
	try {
		const home = (...segments) => join(root, ...segments);
		const { text } = renderPrecheckRecord(COMPLETE_FIELDS);
		const file = recordPath(home, { sessionId: "session-abc", stamp: "s1" });
		const written = await writeRecord(file, text);
		assert.equal(written.ok, true);
		assert.equal(written.fingerprint, recordFingerprint(text));
		assert.equal(await readFile(file, "utf8"), text);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("readRecord：回读给出原文、指纹与形态核对结论", async () => {
	const root = await mkdtemp(join(tmpdir(), "ldvh-precheck-"));
	try {
		const home = (...segments) => join(root, ...segments);
		const { text } = renderPrecheckRecord(COMPLETE_FIELDS);
		const file = recordPath(home, { sessionId: "session-abc", stamp: "s2" });
		await writeRecord(file, text);
		const read = await readRecord(file);
		assert.equal(read.ok, true);
		assert.equal(read.text, text);
		assert.equal(read.fingerprint, recordFingerprint(text));
		assert.equal(read.shape.complete, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("readRecord：不存在的载体报不可读，不伪造空记录", async () => {
	const read = await readRecord(join(tmpdir(), "ldvh-definitely-missing", "x.txt"));
	assert.equal(read.ok, false);
	assert.equal(read.error.code, "record/unreadable");
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
