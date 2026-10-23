// 端到端链路：一条完整预检流程穿过全部判据
//
// 权威：specs/34 §6（进入）→ §11（风险路由）→ §8（三段判断与落实）→ §9（偏离）→
//       §12（交还）→ §15（Human Gate）→ §16（必停）；specs/03 §5.5（分层交还）。
//
// ## 为什么需要这个文件
//
// `precheck-record.test.mjs` 的每一条都是**单测**：每个判据函数各自被调用、各自断言。
// 单测过不代表**它们能串起来**——一个常见失败是字段名在函数间对不上
// （A 产出的键，B 不认），而单测永远不会暴露这一点。
//
// 本文件跑一条真实场景，从「AI 要改一个受控写入文件」走到「分层交还」，
// 逐段把上一段的输出喂给下一段。任一接缝断裂即失败。
//
// ## 边界
//
// 它验证的是**接线**（field 名、返回形状、顺序依赖），**不是**判断质量。
// 场景里的取值是编的，不证明真实行动被正确预检。

import assert from "node:assert/strict";
import test from "node:test";

import {
	buildHandover,
	checkEntry,
	checkFastPathDeclaration,
	checkHumanGate,
	checkRecordShape,
	checkRiskRouting,
	checkTransverseMerge,
	declareHandoverLayer,
	detectRitualRecord,
	evaluateApplication,
	evaluateDeviation,
	roundTripRecord,
	routeConflict,
	routeFailure,
	summarizeApplications,
	assembleReturn,
	parseRecord,
	renderPrecheckRecord,
	checkConceptBoundaries,
} from "../lib/precheck-record.js";

// ---------------------------------------------------------------------------
// 场景：AI 要改一份受控事实对象（ADR），并行工作 case
// ---------------------------------------------------------------------------

test("端到端：进入 → 风险路由 → 三段判断 → 落实 → 记录 → 交还 → 分层", () => {
	// ── 第 1 段：进入判定（34 §6）──────────────────────────────────────────
	// 动作是「创建 ADR」，属会改状态的动作，命中进入信号第 1 项。
	const entry = checkEntry({
		actionKind: "创建 ADR",
		signals: ["即将执行会产生副作用或改变状态的动作"],
	});
	assert.equal(entry.ok, true, "进入判定应成立");
	assert.equal(entry.entered, true, "改状态的动作应进入本系统");

	// ── 第 2 段：风险路由（34 §11）────────────────────────────────────────
	// 涉及授权边界（ADR 承载已拍板取舍），故不可快通道。
	const routing = checkRiskRouting({
		stage: "三段判断",
		tier: "标准路径",
		involvesAuthorization: true,
	});
	assert.equal(routing.allowed, true, "三段判断走标准路径且涉授权边界的组合应允许");

	// 快通道声明的五要素（03 §6.2）——本场景走标准路径，故不需；但若走快通道须齐备。
	const fastPath = checkFastPathDeclaration({
		applicability: "低风险已反复执行",
		exclusions: "涉及受控写入时不适用",
		minimumCoverage: "仍完成三段判断",
		escalationTriggers: "实际影响超出假设",
		declarationForm: "进入时声明并附依据",
	});
	assert.equal(fastPath.ok, true);

	// ── 第 3 段：三段判断 + 约束落实（34 §8 / §8.3）────────────────────────
	// 识别到两条约束：一条落实了，一条只识别未改行动。
	const applications = [
		{
			statement: "34 §17 第 3 项禁专属存储",
			hasTarget: "范围：本模块不落盘",
			hasChange: "从写目录改为交还正文承载",
			hasTraceableBasis: "34 §17 第 3 项 + §10「不要求写入事实源」",
		},
		{
			statement: "34 §14「已识别不构成已允许」",
			hasTarget: "交还措辞",
			// 只给了指向与依据，缺「有改变」——按 §8.3 应判已识别未落实。
			hasTraceableBasis: "34 §14 末段",
		},
	];
	const settled = summarizeApplications(applications);
	assert.equal(settled.ok, true);
	assert.equal(settled.落实.length, 1, "第一条三判据齐备，应落实");
	assert.equal(settled.已识别未落实.length, 1, "第二条缺「有改变」，应判未落实");
	assert.equal(settled.claimsCompliance, false, "§12 禁止合并结论");
	// 单条判定的形状也要对得上（接口接线）。
	const single = evaluateApplication(applications[1]);
	assert.equal(single.state, "已识别未落实");
	assert.deepEqual(single.unresolvedCriteria, ["有改变"]);

	// ── 第 4 段：偏离（34 §9）───────────────────────────────────────────────
	// 执行中发现一个判断错误偏离，已发现即登记。
	const deviation = evaluateDeviation({
		form: "判断错误偏离",
		affectedScope: "ADR 范围写宽了",
		sideEffects: "无写入",
		pendingChecks: "核对范围边界",
		discoveredAt: "2026-10-23T18:00:00+08:00",
		registeredAt: "2026-10-23T18:00:00+08:00",
		returnedAt: "2026-10-23T18:30:00+08:00",
	});
	assert.equal(deviation.ok, true);
	assert.equal(deviation.lateRegistration, false, "发现即登记，非延迟");

	// ── 第 5 段：横切合并（34 §11）─────────────────────────────────────────
	// 本系统横切全部业务系统，在 workcase 内执行时两套预检都要有。
	const transverse = checkTransverseMerge({
		systemKey: "workcase",
		ruleComplianceExecuted: true,
		systemSpecificExecuted: true,
	});
	assert.equal(transverse.passed, true);

	// ── 第 6 段：Human Gate（34 §15.1）─────────────────────────────────────
	// 偏离影响超出当次行动，触发第 3 项领域增量事项。
	const gate = checkHumanGate(["scopeEscalation"]);
	assert.equal(gate.requiresHuman, true);
	assert.equal(gate.fastPathAllowed, false, "触发 Gate 即不可快通道");

	// ── 第 7 段：失败分流（34 §8 失败分流）────────────────────────────────
	// 既然触发 Gate，须停止而非继续。
	const failure = routeFailure({ route: "偏离已发生" });
	assert.equal(failure.mustStop, true, "任一失败分流点都是停止位置");

	// ── 第 8 段：冲突路由（34 §7.5）────────────────────────────────────────
	// 两个来源给出互斥要求，只提请不裁决。
	const conflict = routeConflict({ levelA: 3, levelB: 5 });
	assert.equal(conflict.escalateTo, "Human");
	assert.equal(conflict.picks, null, "§7.5 明禁自动裁决");

	// ── 第 9 段：生成记录（03 §7.2）────────────────────────────────────────
	const record = renderPrecheckRecord({
		effective: "specs/34（L3 §8）、specs/03 §7.2（L2）、adr-1（active）",
		applicable: "34 §17 第 3 项；34 §9.3",
		allowed: "本会话 Human 授权限 plugin/ 下",
		recalled: { adr: "adr-1：不硬编码路径（适用）", pitfall: "未遍历" },
		unverified: "specs/34 的 operation 声明未落盘（已判定为 C：不声明）",
	});
	assert.equal(record.ok, true);
	assert.equal(record.ritualSuspected, false, "内容有实质，不应标仪式疑似");

	// ── 第 10 段：记录形态与回读（34 §10）──────────────────────────────────
	const shape = checkRecordShape(record.text);
	assert.equal(shape.complete, true, "五段必备齐备");
	const parsed = parseRecord(record.text);
	assert.equal(parsed.complete, true);
	assert.equal(parsed.fields.effective, "specs/34（L3 §8）、specs/03 §7.2（L2）、adr-1（active）");
	assert.deepEqual(parsed.fields.recalled, { adr: "adr-1：不硬编码路径（适用）", pitfall: "未遍历" });

	// 往返校验：渲染 → 解析 → 比对，字段须等价（防两套逻辑漂移）。
	const roundTrip = roundTripRecord({
		effective: "specs/34",
		applicable: "34 §17 第 3 项",
		allowed: "本会话授权限 plugin/",
		recalled: { adr: "adr-1", pitfall: "未遍历" },
		unverified: "未落盘",
	});
	assert.equal(roundTrip.roundTripStable, true, "往返须稳定");

	// ── 第 11 段：交还组装（34 §12）────────────────────────────────────────
	const handover = assembleReturn({
		identification: "读 specs/34 §6–§16 全文；查 plugin/lib 现有导出",
		threeWayJudgement: {
			effective: "34 与 03 §7.2 均在当前规则源",
			applicable: "本场景涉及受控写入与授权边界",
			allowed: "本会话 Human 授权限 plugin/ 下",
		},
		application: settled,
		recalled: "ADR 一条（适用）；Pitfall 未遍历（快通道下未扫）",
		unverified: "未验证：注入后的实际理解效果",
		humanDecisions: "偏离影响是否扩大暂停范围（34 §15.1 第 3 项）",
		deviations: [
			{
				form: "判断错误偏离",
				affectedScope: "ADR 范围写宽了",
				sideEffects: "无写入",
				pendingChecks: "核对范围边界",
				discoveredAt: "2026-10-23T18:00:00+08:00",
				registeredAt: "2026-10-23T18:00:00+08:00",
				returnedAt: "2026-10-23T18:30:00+08:00",
			},
		],
	});
	assert.equal(handover.ok, true);
	assert.equal(handover.claimsCompliance, false);
	assert.match(handover.text, /已落实：1 项/);
	assert.match(handover.text, /已识别未落实：1 项/);

	// ── 第 12 段：概念边界（34 §13 / §14 末段）────────────────────────────
	// 交还正文不得把相邻概念写成等式。
	const boundaries = checkConceptBoundaries(handover.text);
	assert.equal(boundaries.clean, true, "交还正文不得出现「已识别即已允许」类等式");

	// ── 第 13 段：分层交还（03 §5.5）───────────────────────────────────────
	// 本场景有偏离未处置、有 Human Gate 未决，验证未通过。
	//
	// **接线修正（端到端测试抓到的）**：我首版在这里传 handoverCarried: true，
	// 但 03 §5.5 明文「交还承接层」以「验证通过层成立」为前提，故模块正确地
	// 按 handover/layer_skipped 拒绝——那不是模块的 bug，是我把「交还做完了」
	// 误当成「可以声明交还承接层」。二者不同：验证未通过时，交还只能以
	// partial/unverified 形态存在，层仍停在流程完成层。故此处须传 false。
	const layer = declareHandoverLayer({
		flowComplete: true,
		verificationPassed: false,
		handoverCarried: false,
	});
	assert.equal(layer.reached, "流程完成层");
	assert.equal(layer.status, "partial/unverified", "验证未通过只能 partial");
	assert.equal(layer.provesValue, false);

	// 同一个场景的另一面：验证通过且交还齐备，才到交还承接层。
	const carried = declareHandoverLayer({
		flowComplete: true,
		verificationPassed: true,
		handoverCarried: true,
	});
	assert.equal(carried.reached, "交还承接层");

	// 而「验证未通过却声明已交还」是跳层，模块必须拒绝。
	const skipped = declareHandoverLayer({
		flowComplete: true,
		verificationPassed: false,
		handoverCarried: true,
	});
	assert.equal(skipped.ok, false, "验证未通过却声明已交还＝跳层，须拒绝");
	assert.equal(skipped.error.code, "handover/layer_skipped");

	// ── 第 14 段：交还文本承载（34 §10 不要求写入事实源）───────────────────
	const envelope = buildHandover({
		effective: "specs/34、specs/03 §7.2",
		applicable: "34 §12 交还结构",
		allowed: "本会话授权限 plugin/",
		recalled: { adr: "adr-1", pitfall: "未遍历" },
		unverified: "operation 声明未落盘",
	});
	assert.equal(envelope.ok, true);
	assert.equal(envelope.carrier.persisted, false, "不落盘（34 §17 第 3 项）");
	assert.equal(envelope.carrier.envelope.built, false, "如实报告载体未建");
});

// ---------------------------------------------------------------------------
// 负路径：任一段失败，后续段不得被当作通过
// ---------------------------------------------------------------------------

test("端到端负路径：进入未成立时，不应生成记录", () => {
	const entry = checkEntry({ actionKind: "纯读取", signals: [] });
	assert.equal(entry.entered, false);
	assert.match(entry.reason, /排除条件/);
	// 纯读取不进入 → 不应有记录产出。这里断言调用方据 entry 结论分支：
	if (entry.entered === true) {
		// 不该走到这里；断言失败即说明分支判断接反了。
		assert.fail("纯读取不应产出记录");
	}
});

test("端到端负路径：验证覆盖不足时不得宣称验证通过层", () => {
	const layer = declareHandoverLayer({
		flowComplete: true,
		verificationPassed: true,
		handoverCarried: true,
		coverageInsufficient: true,
	});
	assert.equal(layer.reached, "流程完成层", "覆盖不足时封顶在流程完成层");
	assert.equal(layer.status, "partial/unverified");
});

test("端到端负路径：交还缺必填项时，分层声明不应被当作已完成", () => {
	const bad = assembleReturn({ identification: "只有这一项" });
	assert.equal(bad.ok, false);
	assert.equal(bad.error.code, "return/items_missing");
	// 交还不成立 → 不应进入分层声明（调用方据此分支）。
	if (bad.ok === true) {
		assert.fail("交还缺项时不应进入分层");
	}
});

test("端到端负路径：仪式疑似记录仍可交还，但须带提醒", () => {
	const ritual = renderPrecheckRecord({
		effective: "无", applicable: "无", allowed: "无", unverified: "无",
		recalled: { adr: "无", pitfall: "无" },
	});
	assert.equal(ritual.ok, true, "不因疑似而拒绝（拒绝会逼出更糟的空话）");
	assert.equal(ritual.ritualSuspected, true);
	assert.match(ritual.ritualNotice, /凑段/);
	// 但取值层面它仍是「格式合规」——这正是 §17 第 2 项要防的形态。
	const shape = checkRecordShape(ritual.text);
	assert.equal(shape.complete, true, "格式合规不等于内容有实质");
});
