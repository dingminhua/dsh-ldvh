
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


test("端到端：进入 → 风险路由 → 三段判断 → 落实 → 记录 → 交还 → 分层", () => {
	const entry = checkEntry({
		actionKind: "创建 Norm",
		signals: ["即将执行会产生副作用或改变状态的动作"],
	});
	assert.equal(entry.ok, true, "进入判定应成立");
	assert.equal(entry.entered, true, "改状态的动作应进入本系统");

	const routing = checkRiskRouting({
		stage: "三段判断",
		tier: "标准路径",
		involvesAuthorization: true,
	});
	assert.equal(routing.allowed, true, "三段判断走标准路径且涉授权边界的组合应允许");

	const fastPath = checkFastPathDeclaration({
		applicability: "低风险已反复执行",
		exclusions: "涉及受控写入时不适用",
		minimumCoverage: "仍完成三段判断",
		escalationTriggers: "实际影响超出假设",
		declarationForm: "进入时声明并附依据",
	});
	assert.equal(fastPath.ok, true);

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
			hasTraceableBasis: "34 §14 末段",
		},
	];
	const settled = summarizeApplications(applications);
	assert.equal(settled.ok, true);
	assert.equal(settled.落实.length, 1, "第一条三判据齐备，应落实");
	assert.equal(settled.已识别未落实.length, 1, "第二条缺「有改变」，应判未落实");
	assert.equal(settled.claimsCompliance, false, "§12 禁止合并结论");
	const single = evaluateApplication(applications[1]);
	assert.equal(single.state, "已识别未落实");
	assert.deepEqual(single.unresolvedCriteria, ["有改变"]);

	const deviation = evaluateDeviation({
		form: "判断错误偏离",
		affectedScope: "Norm 范围写宽了",
		sideEffects: "无写入",
		pendingChecks: "核对范围边界",
		discoveredAt: "2026-10-23T18:00:00+08:00",
		registeredAt: "2026-10-23T18:00:00+08:00",
		returnedAt: "2026-10-23T18:30:00+08:00",
	});
	assert.equal(deviation.ok, true);
	assert.equal(deviation.lateRegistration, false, "发现即登记，非延迟");

	const transverse = checkTransverseMerge({
		systemKey: "gate-consult",
		ruleComplianceExecuted: true,
		systemSpecificExecuted: true,
	});
	assert.equal(transverse.passed, true);

	const gate = checkHumanGate(["scopeEscalation"]);
	assert.equal(gate.requiresHuman, true);
	assert.equal(gate.fastPathAllowed, false, "触发 Gate 即不可快通道");

	const failure = routeFailure({ route: "偏离已发生" });
	assert.equal(failure.mustStop, true, "任一失败分流点都是停止位置");

	const conflict = routeConflict({ levelA: 3, levelB: 5 });
	assert.equal(conflict.escalateTo, "Human");
	assert.equal(conflict.picks, null, "§7.5 明禁自动裁决");

	const record = renderPrecheckRecord({
		effective: "specs/34（L3 §8）、specs/03 §7.2（L2）、norm-1（active）",
		applicable: "34 §17 第 3 项；34 §9.3",
		allowed: "本会话 Human 授权限 plugin/ 下",
		recalled: { pitfall: "未遍历" },
		unverified: "specs/34 的 operation 声明未落盘（已判定为 C：不声明）",
	});
	assert.equal(record.ok, true);
	assert.equal(record.ritualSuspected, false, "内容有实质，不应标仪式疑似");

	const shape = checkRecordShape(record.text);
	assert.equal(shape.complete, true, "五段必备齐备");
	const parsed = parseRecord(record.text);
	assert.equal(parsed.complete, true);
	assert.equal(parsed.fields.effective, "specs/34（L3 §8）、specs/03 §7.2（L2）、norm-1（active）");
	assert.deepEqual(parsed.fields.recalled, { pitfall: "未遍历" });

	const roundTrip = roundTripRecord({
		effective: "specs/34",
		applicable: "34 §17 第 3 项",
		allowed: "本会话授权限 plugin/",
		recalled: { pitfall: "未遍历" },
		unverified: "未落盘",
	});
	assert.equal(roundTrip.roundTripStable, true, "往返须稳定");

	const handover = assembleReturn({
		identification: "读 specs/34 §6–§16 全文；查 plugin/lib 现有导出",
		threeWayJudgement: {
			effective: "34 与 03 §7.2 均在当前规则源",
			applicable: "本场景涉及受控写入与授权边界",
			allowed: "本会话 Human 授权限 plugin/ 下",
		},
		application: settled,
		recalled: "Pitfall 未遍历（快通道下未扫）",
		verified: "34 与 03 §7.2 全文已读；当前 Norm 对象已按 F3 读取",
		unverified: "未验证：注入后的实际理解效果",
		residualRisk: "注入理解效果未验证，可能误把候选当适用",
		humanDecisions: "偏离影响是否扩大暂停范围（34 §15.1 第 3 项）",
		madeHumanDecisions: "本会话 Human 授权：限 plugin/ 下的受控写入",
		continuation: "先核 Norm 范围边界，再决定是否恢复偏离",
		deviations: [
			{
				form: "判断错误偏离",
				affectedScope: "Norm 范围写宽了",
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

	const boundaries = checkConceptBoundaries(handover.text);
	assert.equal(boundaries.clean, true, "交还正文不得出现「已识别即已允许」类等式");

	const layer = declareHandoverLayer({
		flowComplete: true,
		verificationPassed: false,
		handoverCarried: false,
	});
	assert.equal(layer.reached, "流程完成层");
	assert.equal(layer.status, "partial/unverified", "验证未通过只能 partial");
	assert.equal(layer.provesValue, false);

	const carried = declareHandoverLayer({
		flowComplete: true,
		verificationPassed: true,
		handoverCarried: true,
	});
	assert.equal(carried.reached, "交还承接层");

	const skipped = declareHandoverLayer({
		flowComplete: true,
		verificationPassed: false,
		handoverCarried: true,
	});
	assert.equal(skipped.ok, false, "验证未通过却声明已交还＝跳层，须拒绝");
	assert.equal(skipped.error.code, "handover/layer_skipped");

	const envelope = buildHandover({
		effective: "specs/34、specs/03 §7.2",
		applicable: "34 §12 交还结构",
		allowed: "本会话授权限 plugin/",
		recalled: { pitfall: "未遍历" },
		unverified: "operation 声明未落盘",
	});
	assert.equal(envelope.ok, true);
	assert.equal(envelope.carrier.persisted, false, "不落盘（34 §17 第 3 项）");
	assert.equal(envelope.carrier.envelope.built, false, "如实报告载体未建");
});


test("端到端负路径：进入未成立时，不应生成记录", () => {
	const entry = checkEntry({ actionKind: "纯读取", signals: [] });
	assert.equal(entry.entered, false);
	assert.match(entry.reason, /排除条件/);
	if (entry.entered === true) {
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
	if (bad.ok === true) {
		assert.fail("交还缺项时不应进入分层");
	}
});

test("端到端负路径：仪式疑似记录仍可交还，但须带提醒", () => {
	const ritual = renderPrecheckRecord({
		effective: "无", applicable: "无", allowed: "无", unverified: "无",
		recalled: { pitfall: "无" },
	});
	assert.equal(ritual.ok, true, "不因疑似而拒绝（拒绝会逼出更糟的空话）");
	assert.equal(ritual.ritualSuspected, true);
	assert.match(ritual.ritualNotice, /凑段/);
	const shape = checkRecordShape(ritual.text);
	assert.equal(shape.complete, true, "格式合规不等于内容有实质");
});
