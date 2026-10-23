// tests for plugin/lib/recall-injection.js —— 行动前召回注入（触发侧）
//
// 权威：specs/10 §5.3（行动前引导入口经 agent/pre-step，载荷含 messages）、
// specs/02 §9.2（召回进入条件：新会话/压缩/委派/生命周期事件本身不自动证明必要）、
// specs/05 §9.2（F0–F2 候选不得被写成适用或声明）、specs/34 §13（召回命中不等于适用）。
//
// 本文件守的是「注入的纪律」：什么时候注入、注入什么措辞、什么情况下不注入。

import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import {
	RECALL_CHAR_BUDGET,
	RECALL_SUMMARY,
	buildRecallInjection,
	currentUserText,
	enterFactConsumption,
	renderRecallRow,
} from "../lib/recall-injection.js";

const ROOT = join(import.meta.dirname, "..", "..");

// ---------------------------------------------------------------------------
// 02 §9.2 进入条件
// ---------------------------------------------------------------------------

test("enterFactConsumption：过短或纯标点的输入不进入（02 §9.2 防无条件注入）", () => {
	for (const text of ["", "  ", "好", "继续", "ok", "？", "，。！"]) {
		assert.equal(enterFactConsumption(text), false, `「${text}」不应进入事实消费`);
	}
});

test("enterFactConsumption：正常的行动描述进入", () => {
	assert.equal(enterFactConsumption("修改受保护内容 guidance-text.js"), true);
	assert.equal(enterFactConsumption("这个 ADR 该怎么写"), true);
});

test("enterFactConsumption：非字符串不进入", () => {
	assert.equal(enterFactConsumption(null), false);
	assert.equal(enterFactConsumption(undefined), false);
	assert.equal(enterFactConsumption(42), false);
});

// ---------------------------------------------------------------------------
// 从批次里取当前用户消息
// ---------------------------------------------------------------------------

const OWN = (m) => m?.source?.plugin === "dsh-ldvh";

test("currentUserText：取最后一条非本插件注入的 user 消息", () => {
	const messages = [
		{ role: "user", content: [{ type: "text", text: "旧问题" }] },
		{ role: "assistant", content: [{ type: "text", text: "旧回答" }] },
		{ role: "user", content: [{ type: "text", text: "当前问题" }] },
	];
	assert.equal(currentUserText(messages, OWN), "当前问题");
});

test("currentUserText：跳过本插件自己注入的行（否则会拿注入结果当查询）", () => {
	const messages = [
		{ role: "user", content: [{ type: "text", text: "当前问题" }] },
		{
			role: "user",
			content: [{ type: "text", text: "【双源召回 · 行动前候选】…" }],
			source: { plugin: "dsh-ldvh", kind: "dsh-ldvh" },
		},
	];
	assert.equal(currentUserText(messages, OWN), "当前问题", "不得把注入行当查询");
});

test("currentUserText：跳过 assistant 消息", () => {
	const messages = [{ role: "assistant", content: [{ type: "text", text: "回答" }] }];
	assert.equal(currentUserText(messages, OWN), "");
});

test("currentUserText：无 user 消息或非数组返回空串", () => {
	assert.equal(currentUserText([], OWN), "");
	assert.equal(currentUserText(null, OWN), "");
	assert.equal(currentUserText(undefined, OWN), "");
	assert.equal(currentUserText("not-array", OWN), "");
});

test("currentUserText：多段 text 拼接", () => {
	const messages = [{ role: "user", content: [{ type: "text", text: "第一段" }, { type: "text", text: "第二段" }] }];
	assert.equal(currentUserText(messages, OWN), "第一段第二段");
});

// ---------------------------------------------------------------------------
// 渲染措辞（02 §9.2 / 34 §13：只说候选，不说适用）
// ---------------------------------------------------------------------------

test("renderRecallRow：明写「候选不是结论」，不得声称已适用", () => {
	const text = renderRecallRow({
		specs: [],
		facts: [{ type: "pitfall", status: "active", title: "某教训", path: "ldvh-base/pitfalls/x.md", hitReason: "标题命中：校验" }],
		truncated: false,
		budget: {},
	});
	assert.match(text, /候选/);
	assert.match(text, /不等于适用/);
	assert.ok(!/已适用/.test(text), "不得出现「已适用」");
	assert.ok(!/必须遵守/.test(text), "不得把召回写成规范命令");
});

test("renderRecallRow：每条候选带命中理由，使 AI 可核对", () => {
	const text = renderRecallRow({
		specs: [{ title: "某规范", path: "specs/34-x.md", hitReason: "适用范围命中：预检" }],
		facts: [],
		truncated: false,
		budget: {},
	});
	assert.match(text, /适用范围命中：预检/);
	assert.match(text, /specs\/34-x\.md/);
});

test("renderRecallRow：零命中时如实说明会漏，不写成「无相关约束」", () => {
	const text = renderRecallRow({ specs: [], facts: [], truncated: false, budget: {} });
	assert.match(text, /未命中/);
	assert.match(text, /不证明「无相关约束」/);
});

test("renderRecallRow：超预算如实标出裁剪与字节数（05 §9.2）", () => {
	const text = renderRecallRow({
		specs: [],
		facts: [{ type: "adr", status: "active", title: "某决定", path: "ldvh-base/adrs/a.md", hitReason: "标题命中：决定" }],
		truncated: true,
		budget: { limitBytes: 200, usedBytes: 190 },
	});
	assert.match(text, /超出预算已裁剪/);
	assert.match(text, /200/);
	assert.match(text, /190/);
	assert.match(text, /不代表不存在/);
});

// ---------------------------------------------------------------------------
// 注入决定
// ---------------------------------------------------------------------------

test("buildRecallInjection：无项目路径不注入", async () => {
	const r = await buildRecallInjection({ userText: "修改受保护内容", projectRoot: "" });
	assert.equal(r.inject, false);
	assert.equal(r.reason, "no-project");
});

test("buildRecallInjection：用户消息不足以构成查询时不注入（02 §9.2）", async () => {
	const r = await buildRecallInjection({ userText: "好", projectRoot: ROOT });
	assert.equal(r.inject, false);
	assert.equal(r.reason, "no-fact-consumption");
});

test("buildRecallInjection：有命中时注入，且带回 digest 供去重", async () => {
	const r = await buildRecallInjection({
		userText: "Git Gate 的 pre-commit 钩子失败了怎么办",
		projectRoot: ROOT,
	});
	assert.equal(r.inject, true);
	assert.ok(typeof r.text === "string" && r.text.length > 0);
	assert.equal(r.digest, r.text, "digest 与文本同源，供去重");
	assert.match(r.text, /候选/);
});

test("buildRecallInjection：零命中不注入（避免每回合刷空候选行）", async () => {
	// 一组与事实源几乎不可能命中的词。
	const r = await buildRecallInjection({
		userText: "量子纠缠的超导约瑟夫森结退相干时间",
		projectRoot: ROOT,
	});
	if (r.inject === true) {
		// 若真命中了，至少必须是真实候选（不得为空壳）。
		assert.ok((r.result?.specs?.length ?? 0) + (r.result?.facts?.length ?? 0) > 0);
	} else {
		assert.ok(["no-hits", "recall-unavailable"].includes(r.reason) || r.reason.startsWith("recall-failed"), `意外原因：${r.reason}`);
	}
});

test("buildRecallInjection：预算可下调，且超预算标 truncated", async () => {
	const r = await buildRecallInjection({
		userText: "校验验证工具 Web 页面 Git Gate 钩子 ADR 决定",
		projectRoot: ROOT,
		budgetBytes: 120,
	});
	if (r.inject === true) {
		assert.ok(r.result.budget.usedBytes <= 120, "不得超预算");
		assert.match(r.text, /超出预算已裁剪|候选/, "超预算须标明或至少是候选行");
	}
});

test("RECALL_CHAR_BUDGET 是固定常量（不是动态计算）", () => {
	assert.equal(typeof RECALL_CHAR_BUDGET, "number");
	assert.ok(RECALL_CHAR_BUDGET > 0);
	assert.equal(RECALL_CHAR_BUDGET, 900);
});

test("RECALL_SUMMARY 标出「双源召回」，Human 侧折叠可见", () => {
	assert.match(RECALL_SUMMARY, /双源召回/);
});
