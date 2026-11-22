
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DECISION_KEYS,
	ENTRY_VERDICTS,
	RECALL_BYTE_BUDGET,
	RECALL_RENDER_CHAR_LIMIT,
	RECALL_SUMMARY,
	FACT_QUOTA_TOTAL,
	FACT_SECTION_ORDER,
	QUOTA_BY_TYPE,
	buildRecallInjection,
	classifyEntry,
	decideInjection,
	currentUserText,
	isUserInputSource,
	renderCharLimitFor,
	renderRecallRow,
	shouldRecall,
} from "../lib/recall-injection.js";
import { recallForAction, RECALL_DIRECT_BYTE_BUDGET, RECALL_LIMIT_MAX, INJECTION_EXCLUDED_TYPES, L0_NORM_NOTE, L0_FULL_NOTE } from "../lib/source-recall.js";
import { skipWithoutCorpus, seedFactCorpus } from "./helpers.mjs";

const ROOT = join(import.meta.dirname, "..", "..");


test("34 §6 排除条件：纯读取与纯查询动作不进入本系统", () => {
	for (const text of [
		"看看这个文件里有什么",
		"列一下所有 ADR 的标题",
		"读一下 34 号规范",
		"现在有几条 Pitfall",
		"搜一下验证相关的经验",
	]) {
		assert.equal(classifyEntry(text), "exclude", `「${text}」是纯读取，应排除`);
		assert.equal(shouldRecall(text), false, `「${text}」不应触发召回`);
	}
});

test("34 §6 进入信号第 1 项：会改变状态的动作进入", () => {
	for (const text of [
		"把 guidance-text.js 加一行引导",
		"删除这个 ADR",
		"提交这批改动",
		"新建一个 Pitfall",
		"重写 34 号规范",
	]) {
		assert.equal(classifyEntry(text), "enter", `「${text}」会改状态，应进入`);
		assert.equal(shouldRecall(text), true, `「${text}」应触发召回`);
	}
});

test("34 §6 不确定处理：判不出动作性质时按进入处理，不得按无约束跳过", () => {
	const verdict = classifyEntry("这个 ADR 该怎么理解");
	assert.equal(verdict, "uncertain", "无明显读/写迹象应判不确定");
	assert.equal(shouldRecall("这个 ADR 该怎么理解"), true, "不确定时必须召回，不得跳过");
});

test("34 §6：过短且无动作可言的输入排除（不是「可能改状态」，是没有动作）", () => {
	for (const text of ["", "  ", "好", "继续", "ok", "？", "，。！", "嗯"]) {
		assert.equal(shouldRecall(text), false, `「${text}」没有动作可言，不应召回`);
	}
});

test("classifyEntry 只产出三态闭集 ENTRY_VERDICTS", () => {
	assert.deepEqual([...ENTRY_VERDICTS], ["enter", "exclude", "uncertain"]);
	for (const text of ["改文件", "看看", "理解一下", "好", ""]) {
		assert.ok(ENTRY_VERDICTS.includes(classifyEntry(text)), `「${text}」产出了闭集外的值`);
	}
});

test("34 §6：非字符串一律判不确定（不得当作「不在范围内」）", () => {
	for (const value of [null, undefined, 42, {}, []]) {
		assert.equal(classifyEntry(value), "uncertain");
	}
});


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

test("currentUserText：跳过宿主上下文行（time-context 不得当查询词）", () => {
	const messages = [
		{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "帮我把字段改掉" }] },
		{ role: "user", source: { kind: "time-context" }, content: [{ type: "text", text: "Time sampled while preparing turn 1, step 1: 2026-10-27T03:00:00+08:00" }] },
	];
	assert.equal(currentUserText(messages, OWN), "帮我把字段改掉", "不得把 time-context 当查询词");
});

test("currentUserText：宿主四种上下文行全部跳过，且按批次顺序取最近一条真实用户消息", () => {
	const hostKinds = ["agent-instructions", "runtime-context", "skill-catalog", "time-context"];
	const messages = [
		{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "旧问题" }] },
		...hostKinds.map((kind) => ({
			role: "user",
			source: { kind },
			content: [{ type: "text", text: `${kind} 的内容` }],
		})),
		{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "当前问题" }] },
		...hostKinds.map((kind) => ({
			role: "user",
			source: { kind },
			content: [{ type: "text", text: `${kind} 的内容（第二次）` }],
		})),
	];
	assert.equal(currentUserText(messages, OWN), "当前问题");
	for (const kind of hostKinds) {
		assert.ok(
			!currentUserText(messages, OWN).includes(kind),
			`取词结果不得含 ${kind} 的内容`,
		);
	}
});

test("currentUserText：未登记 kind 须按非用户排除，无 source 才兜底取用", () => {
	const futureKind = { role: "user", source: { kind: "some-future-context" }, content: [{ type: "text", text: "未来形状" }] };
	const legacy = { role: "user", content: [{ type: "text", text: "无 source 的旧形状" }] };
	assert.equal(currentUserText([futureKind, legacy], OWN), "无 source 的旧形状", "未来形状的 kind 须被排除、回落到旧形状");
	assert.equal(currentUserText([futureKind], OWN), "", "只有未知 kind 时须返回空（fail closed），不得冒充用户输入");
	assert.equal(currentUserText([legacy], OWN), "无 source 的旧形状", "无 source 须兜底取用");
});


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

test("renderRecallRow：零命中时如实说明会漏，不写成「无相关约束」", () => {
	const text = renderRecallRow({ specs: [], facts: [], truncated: false, budget: {} });
	assert.match(text, /未命中/);
	assert.match(text, /不证明「无相关约束」/);
});

test("renderRecallRow：超预算如实标出裁剪与字节数（05 §9.2）", () => {
	const text = renderRecallRow({
		specs: [],
		facts: [{ type: "norm", status: "active", title: "某方向规范", path: "ldvh-base/norms/a.md", hitReason: "标题命中：规范" }],
		truncated: true,
		counts: { specHits: 3, factHits: 1, specsReturned: 0, factsReturned: 1 },
		budget: { limitBytes: 200, usedBytes: 190 },
	});
	assert.match(text, /受预算限制已裁剪/);
	assert.match(text, /200/);
	assert.match(text, /190/);
	assert.match(text, /不代表不存在/);
});


test("buildRecallInjection：无项目路径不注入", async () => {
	const r = await buildRecallInjection({ userText: "修改受保护内容", projectRoot: "" });
	assert.equal(r.inject, false);
	assert.equal(r.reason, "no-project");
});

test("buildRecallInjection：命中 34 §6 排除条件时不进入词法召回，但常驻索引仍可见", async () => {
	const r = await buildRecallInjection({ userText: "看看这个文件", projectRoot: ROOT });
	assert.equal(r.inject, true, "常驻索引仍须注入（34 §8.4 末段）");
	assert.equal(r.result?.baselineOnly, true, "须标记为「只带索引」");
	assert.equal(r.result?.baselineOnlyCause, "excluded-by-34-6", "归因须写明是 34 §6 排除");
	assert.deepEqual(r.result?.specs, [], "不得带入词法候选（规范源）");
	assert.deepEqual(r.result?.facts, [], "不得带入词法候选（事实源）");
	assert.match(r.text, /本轮无词法候选/, "须如实说明本回合没有做词法召回");
	assert.match(r.text, /经验 · active Pitfall|事实规范 · active Norm/, "常驻索引须可见");
});

test("buildRecallInjection：纯读取回合的经验总数须与全量路径一致（2026-11-11 缺陷回归）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const baseline = await buildRecallInjection({ userText: "看看这个文件", projectRoot: ROOT });
	const full = await buildRecallInjection({ userText: "提交这批改动", projectRoot: ROOT });
	const b = baseline.result?.l0Enumeration?.pitfallTotal;
	const f = full.result?.l0Enumeration?.pitfallTotal;
	assert.ok(Number.isInteger(b) && b > 0, `纯读取回合须报真实总数（实测 ${String(b)}）`);
	assert.equal(b, f, "基线路径与全量路径的经验计数须一致（同一语料不得给出两个总数）");
	const line = (baseline.text ?? "").split("\n").find((l) => l.includes("25 §12 按需索引"));
	assert.ok(line, "经验按需行须在");
	assert.match(line, new RegExp(`共 ${b} 条`), "按需行须写真实总数");
	assert.doesNotMatch(line, /本项目当前无 active 经验/, "不得把「有经验」说成「0 条」");
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
	const r = await buildRecallInjection({
		userText: "量子纠缠的超导约瑟夫森结退相干时间",
		projectRoot: ROOT,
	});
	if (r.inject === true) {
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
		if (r.result.overBudget !== true) {
			assert.ok(r.result.budget.usedBytes <= 120, "未走保底时不得超预算");
		}
		assert.match(r.text, /超出预算已裁剪|预算极小|候选/, "超预算须标明或至少是候选行");
	}
});

test("RECALL_BYTE_BUDGET 是固定常量，且大到能容纳 3 规范 + 3 事实", () => {
	assert.equal(typeof RECALL_BYTE_BUDGET, "number");
	assert.equal(RECALL_BYTE_BUDGET, 2400);
	assert.ok(RECALL_BYTE_BUDGET >= 2200, "须容纳完整的一轮 3+3 候选");
});

test("RECALL_SUMMARY 标出「双源召回」，Human 侧折叠可见", () => {
	assert.match(RECALL_SUMMARY, /双源召回/);
});

test("34 §6：空串是「没有动作」故排除，非字符串才是「判不出来」故不确定", () => {
	assert.equal(classifyEntry(""), "exclude", "空串应排除");
	assert.equal(classifyEntry("   "), "exclude", "纯空白应排除");
	assert.equal(classifyEntry(null), "uncertain", "非字符串是不确定，不是排除");
	assert.equal(shouldRecall(""), false, "空串不触发召回");
	assert.equal(shouldRecall(null), true, "不确定一律触发（§6 不得按无约束）");
});

test("34 §6：纯读取即使含领域词也排除（内容相关度不压过排除条件）", () => {
	assert.equal(shouldRecall("列出所有 Pitfall 的标题"), false);
	assert.equal(shouldRecall("看看这些 ADR 有哪些"), false);
	assert.equal(shouldRecall("读一下 34 号规范的输入来源"), false);
});

test("已知精度边界：词表匹配会把「怎么写的」误判为写动作（如实登记，不假装没有）", () => {
	assert.equal(classifyEntry("看看这些 ADR 是怎么写的"), "enter", "已知误判方向：偏保守");
	assert.equal(classifyEntry("看看这些 ADR 有哪些"), "exclude");
});


test("时序：lastScope 未就绪时不得静默跳过召回（pre-step 先于首次 assemble）", async () => {
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
	});
	assert.equal(r.inject, true, "有 projectRoot 就必须召回，不得因时序而跳过");
});

test("时序：projectRoot 缺失时返回 no-project（不假装召回成功）", async () => {
	for (const projectRoot of [undefined, null, ""]) {
		const r = await buildRecallInjection({ userText: "把 34 号规范改名", projectRoot });
		assert.equal(r.inject, false);
		assert.equal(r.reason, "no-project");
	}
});


test("归因不得混同：取不到用户消息 ≠ 34 §6 排除", async () => {
	for (const userText of ["", "   ", null, undefined]) {
		const r = await buildRecallInjection({ userText, projectRoot: ROOT });
		assert.equal(r.inject, false);
		assert.equal(r.reason, "no-user-text", `「${String(userText)}」应报输入缺失，不是 §6 排除`);
	}
	const r2 = await buildRecallInjection({ userText: "看看这个文件里有什么", projectRoot: ROOT });
	assert.equal(r2.result?.baselineOnlyCause, "excluded-by-34-6");
	assert.notEqual(r2.result?.baselineOnlyCause, "recall/no_tokens", "两种归因不得混同");
});

test("诊断问句不得判为纯读取（34 §6 排除条件只挡「只为取信息」的动作）", async () => {
	for (const q of ["为什么这里不对", "这里为什么报错", "为什么不生效", "解释一下这段"]) {
		const verdict = classifyEntry(q);
		assert.notEqual(verdict, "exclude", `「${q}」是诊断问句，不得判为纯读取`);
	}
	for (const q of ["看看这个文件", "列出所有 ADR", "读一下这一节"]) {
		assert.equal(classifyEntry(q), "exclude", `「${q}」是纯读取，应排除`);
	}
});

test("诊断问句能召回（有主题词时）", async () => {
	const r = await buildRecallInjection({ userText: "这里为什么报错", projectRoot: ROOT });
	assert.equal(r.inject, true, "有主题词的诊断问句应能召回");
});

test("无主题词的问句：no_tokens 是合理结果，如实报出而非假装召回", async () => {
	const r = await buildRecallInjection({ userText: "为什么这里不对", projectRoot: ROOT });
	assert.equal(r.result?.baselineOnlyCause, "recall/no_tokens", "应如实说明召回器无从下手");
	assert.deepEqual(r.result?.facts, [], "no_tokens 时不得带入词法候选");
	assert.match(r.text, /本轮无词法候选/, "须如实说明本回合没有词法候选");
});

test("全弱证据查询不得注入（放宽 tokenizer 后的精度护栏）", async () => {
	for (const q of ["为什么这里不对", "现在应该做什么", "是不是应该", "我要的是这个"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.deepEqual(r.result?.facts, [], `「${q}」不得注入词法候选（事实源）`);
		assert.deepEqual(r.result?.specs, [], `「${q}」不得注入词法候选（规范源）`);
		assert.equal(r.result?.baselineOnlyCause, "recall/no_tokens", `「${q}」应报 no_tokens 归因`);
	}
	for (const q of ["页面白屏了怎么办", "把对象的字段改名后同步读取侧"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, true, `「${q}」含主题词，须照常召回`);
	}
});

test("渲染文本须有硬上限，超限按行裁剪并如实说明（不得静默截断）", async () => {
	const fake = {
		ok: true, truncated: false, overBudget: false, partial: false,
		specs: Array.from({ length: 20 }, (_, i) => ({
			title: `很长的规范标题${i}`.repeat(3), path: `specs/${i}.md`,
			hitReason: "正文命中：某个很长的命中理由说明文字",
		})),
		facts: Array.from({ length: 20 }, (_, i) => ({
			type: "pitfall", status: "active", title: `很长的事实标题${i}`.repeat(3),
			path: `ldvh-base/x/${i}.md`, hitReason: "适用范围命中：另一段很长的理由",
		})),
		budget: { limitBytes: 2400, usedBytes: 2300, limit: 20 },
		counts: { specHits: 20, factHits: 20, specsReturned: 20, factsReturned: 20, candidatesScanned: 337 },
		unchecked: { specs: [], facts: [] },
		ranking: { keys: ["tier", "hits", "path"] },
	};
	const out = renderRecallRow(fake);
	assert.ok(out.length <= RECALL_RENDER_CHAR_LIMIT, `渲染 ${out.length} 超过上限 ${RECALL_RENDER_CHAR_LIMIT}`);
	assert.match(out, /渲染层按硬约束/, "超限须如实说明");
	assert.match(out, /字符上限/, "归因须点名生效的约束");
	assert.match(out, /裁去 \d+ 条候选/, "须如实注明裁了几条");
	assert.match(out, /不代表不存在/, "须说明未列出的不代表不存在");
	assert.equal(RECALL_RENDER_CHAR_LIMIT, 1600, "常量值应固定（实测最坏 1167，留约 37% 余量）");
});

test("渲染文本未超限时不得添加裁剪说明", async () => {
	const small = {
		ok: true, truncated: false, overBudget: false, partial: false,
		specs: [{ title: "短标题", path: "specs/x.md", hitReason: "正文命中：短理由" }],
		facts: [],
		budget: { limitBytes: 2400, usedBytes: 120, limit: 3 },
		counts: { specHits: 1, factHits: 0, specsReturned: 1, factsReturned: 0, candidatesScanned: 10 },
		unchecked: { specs: [], facts: [] },
		ranking: { keys: ["tier", "hits", "path"] },
	};
	const out = renderRecallRow(small);
	assert.ok(!/渲染层按硬约束/.test(out), "未超限时不得出现裁剪说明");
	const r = await buildRecallInjection({ userText: "页面白屏了", projectRoot: ROOT, budgetBytes: 4000 });
	if (r.inject) {
		assert.ok(!/渲染层按硬约束/.test(r.text), "预算充裕时不得出现裁剪说明");
	}
});

test("partial 与 truncated 是同一个值，渲染不得输出两条互相矛盾的提示", async () => {
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 3,
		budgetBytes: 2400,
	});
	const truncationLines = (r.text.match(/^（(本次为|受预算|受条数|预算极小)[^\n]*/gm) ?? []);
	assert.ok(truncationLines.length <= 1, `截断说明不得重复输出，实际 ${truncationLines.length} 条：${truncationLines.join(" | ")}`);
});

test("两个预算常量的单位必须真的不同：字节 vs 字符（防命名混同）", async () => {
	assert.equal(RECALL_BYTE_BUDGET, 2400);
	assert.equal(RECALL_RENDER_CHAR_LIMIT, 1600);

	const sample = "双源召回 · 行动前候选";
	assert.notEqual(
		sample.length,
		Buffer.byteLength(sample, "utf8"),
		"样本须含非 ASCII 字符，否则无法体现字节与字符之差",
	);
	for (const ch of sample) {
		if (/[\u4e00-\u9fff]/.test(ch)) {
			assert.equal(Buffer.byteLength(ch, "utf8"), 3, `汉字「${ch}」应占 3 字节`);
		}
	}
	assert.ok(
		Buffer.byteLength(sample, "utf8") > sample.length,
		"含中文的样本，字节数必大于字符数",
	);

	const r = await recallForAction({
		action: "把 34 号规范改名成双源召回",
		root: ROOT,
		limit: 3,
		budgetBytes: RECALL_BYTE_BUDGET,
	});
	assert.ok(
		r.budget.usedBytes <= RECALL_BYTE_BUDGET || r.overBudget === true,
		`数据预算须按字节生效：used=${r.budget.usedBytes} limit=${RECALL_BYTE_BUDGET}`,
	);
});

test("M-20：注入路径与直调路径的两个预算常量不得互相代入（34 §11 第 3 条）", async () => {
	assert.ok(Number.isFinite(RECALL_BYTE_BUDGET) && RECALL_BYTE_BUDGET > 0, "注入预算须为具名正常量");
	assert.ok(Number.isFinite(RECALL_DIRECT_BYTE_BUDGET) && RECALL_DIRECT_BYTE_BUDGET > 0, "直调预算须为具名正常量");
	assert.notEqual(
		RECALL_BYTE_BUDGET,
		RECALL_DIRECT_BYTE_BUDGET,
		`两个预算不得相等（互相代入）：注入=${RECALL_BYTE_BUDGET} 直调=${RECALL_DIRECT_BYTE_BUDGET}`,
	);
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(
		r.budget.limitBytes,
		RECALL_DIRECT_BYTE_BUDGET,
		`recallForAction 默认预算须取自直调常量（${RECALL_DIRECT_BYTE_BUDGET}），实测 ${r.budget.limitBytes}`,
	);
	assert.equal(RECALL_BYTE_BUDGET, 2400, "注入路径预算锚定 2400（10 §5.3 引导面预算）");
});

test("渲染行须显示候选摘录（数据层有而渲染不显示 = 读者仍看不到）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名",
		projectRoot: ROOT,
		limit: 2,
		budgetBytes: 40000,
	});
	assert.equal(r.inject, true);
	assert.match(r.text, /↳ /, "渲染行须出现摘录引导符");
	const excerptLine = r.text.split("\n").find((l) => l.trim().startsWith("↳"));
	assert.ok(excerptLine !== undefined);
	assert.ok(excerptLine.trim().length > 5, "摘录不得为空");
});

test("N-5：partial/unavailable 时注入行须呈现三态与未读取源；complete 保持安静", () => {
	const partialRow = renderRecallRow({
		specs: [{ title: "双源召回系统规范", path: "specs/34-双源召回系统规范.md", hitReason: "命中", excerpt: "……", source: {} }],
		facts: [],
		recallCompleteness: "partial",
		uncheckedRange: { sourceNotRead: ["事实源（项目内 ldvh-base/ 不存在或不可读，未读取）"] },
	});
	assert.match(partialRow, /本次召回完整度：\*\*partial\*\*/, "partial 须在注入行出声");
	assert.match(partialRow, /事实源/, "未读取的源须逐类点名（34 §12）");
	assert.match(partialRow, /不构成「无相关」的证据/, "partial 须带出证据资格限定（34 §12）");

	const unavailableRow = renderRecallRow({
		specs: [],
		facts: [],
		recallCompleteness: "unavailable",
		uncheckedRange: { sourceNotRead: ["规范源（01 §10.3 三级回退均无可用语料，不可读，未读取）", "事实源（项目内 ldvh-base/ 不存在或不可读，未读取）"] },
	});
	assert.match(unavailableRow, /本次召回完整度：\*\*unavailable\*\*/);
	assert.match(unavailableRow, /§16\.1 第 7 项/, "unavailable 须点名必停条款");

	const completeRow = renderRecallRow({
		specs: [{ title: "双源召回系统规范", path: "specs/34-双源召回系统规范.md", hitReason: "命中", excerpt: "……", source: {} }],
		facts: [],
		recallCompleteness: "complete",
	});
	assert.ok(!completeRow.includes("本次召回完整度"), "complete 时不得加三态行（稳态安静）");
});

test("N-8：三态披露行须含「被过滤」类别且按非零类别分列（34 §12 逐类清单）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 3,
	});
	assert.equal(r.inject, true);
	const ur = r.result.uncheckedRange;
	const filteredCount =
		(ur.excludedByTypeFilter?.length ?? 0) +
		(ur.excludedByStatus?.length ?? 0) +
		(ur.excludedByTypeWhitelist?.length ?? 0);
	assert.ok(filteredCount > 0, "本仓事实源有 draft/留观等被过滤候选（实测约 110 条），前提须成立");
	if (r.result.recallCompleteness === "partial") {
		assert.match(r.text, /另 \d+ 条被状态过滤/, "三态行须按类别分列披露被过滤数（34 §12）");
		assert.ok(
			!r.text.includes("被类型/状态过滤"),
			"不得再用合并标签（观察 B：白名单桶语义不同，不得并入）",
		);
	}
	const row = renderRecallRow({
		specs: [{ title: "T", path: "specs/t.md", hitReason: "命中" }],
		facts: [],
		recallCompleteness: "partial",
		uncheckedRange: {
			excludedByTypeFilter: [{}, {}],
			excludedByStatus: [{}, {}, {}],
			excludedByTypeWhitelist: [{}],
		},
	});
	assert.match(row, /另 2 条被类型过滤、3 条被状态过滤、1 条未登记类型不参与/, "三类非零须分列");
});

test("渲染裁剪须可观察（02 §9.1「截断必须可观察」）", async () => {
	const normal = await buildRecallInjection({
		userText: "把 34 号规范改名",
		projectRoot: ROOT,
		limit: 2,
		budgetBytes: 2400,
	});
	assert.ok(normal.result.render !== undefined, "须给出 render 观察字段");
	assert.equal(normal.result.render.limitChars, renderCharLimitFor(2400));
	assert.equal(typeof normal.result.render.truncated, "boolean");

	const big = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 50,
		budgetBytes: 1200,
	});
	assert.equal(big.result.render.truncated, true, "超上限时须标 truncated");
	assert.ok(big.result.render.chars > 0);
	assert.equal(typeof big.result.truncated, "boolean", "数据侧截断字段须独立存在");
});

test("渲染行不得宣称过时的实测百分比（旧值 43% 已与现状 100% 相差巨大）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名",
		projectRoot: ROOT,
		limit: 3,
	});
	assert.equal(r.inject, true);
	assert.ok(!/43%/.test(r.text), "不得再出现已过时的 43%");
	assert.ok(!/13\/30/.test(r.text), "不得再出现旧样本数");
	assert.match(r.text, /未命中不代表没有同类教训/, "结构性边界须保留");
});

test("数据侧实测值须与当前实现一致（症状→自身召回）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const { recallForAction } = await import("../lib/source-recall.js");
	const { loadFacts } = await import("../lib/source-recall.js");
	const facts = await loadFacts(join(ROOT, "ldvh-base"));
	const pitfalls = facts.filter((f) => f.type === "pitfall" && f.status === "active");
	assert.ok(pitfalls.length > 0, "应有 active Pitfall");

	let hit = 0;
	let total = 0;
	for (const p of pitfalls) {
		const sym = /## 症状\s*\n+([^\n#]+)/.exec(p.body ?? "")?.[1] ?? "";
		if (sym.length < 20) continue;
		total += 1;
		const r = await recallForAction({
			action: sym.slice(0, 60),
			root: ROOT,
			limit: 10,
			budgetBytes: 400000,
			includeSpecs: false,
		});
		if (r.facts.some((f) => f.ref === p.ref)) hit += 1;
	}
	assert.ok(total > 0, "样本须非空");
	const probe = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 1 });
	assert.ok(probe.limitations !== undefined, "探测查询须返回 limitations");
	const declared = probe.limitations.measuredSymptomSelfRecall;

	assert.ok(Number.isInteger(declared.total) && declared.total > 0, `声明的样本数须为正整数，实测 ${declared.total}`);
	assert.ok(
		Number.isInteger(declared.hits) && declared.hits >= 0 && declared.hits <= declared.total,
		`声明的命中数须落在 [0, ${declared.total}]，实测 ${declared.hits}`,
	);
	assert.match(String(declared.measuredAt ?? ""), /^\d{4}-\d{2}-\d{2}$/, "声明须标注测于哪一天（过时与否由此判断）");

	assert.ok(
		total >= declared.total,
		`声明的样本数 ${declared.total} 不得超过当前语料 ${total}：声明是历史快照，语料不会变小`,
	);

	const declaredRate = declared.hits / declared.total;
	const actualRate = hit / total;
	assert.ok(
		Math.abs(declaredRate - actualRate) <= 0.2,
		`声明的命中率 ${(declaredRate * 100).toFixed(0)}% 与当前实测 ${(actualRate * 100).toFixed(0)}%（${hit}/${total}）背离超过 20 个百分点`,
	);
});

test("注入文本的实际字节数不得超预算（10:241「未超 LDVH 侧常量预算」）", async () => {
	const budgets = [1200, 1400, 1600, 2000, 2400, 3000, 4000];
	const queries = [
		"把 34 号规范改名成双源召回",
		"页面白屏了",
		"把这个接口改成幂等的",
		"提交这批改动",
		"优化性能",
	];
	for (const budgetBytes of budgets) {
		for (const userText of queries) {
			const r = await buildRecallInjection({ userText, projectRoot: ROOT, limit: 99, budgetBytes });
			if (!r.inject) continue;
			const actual = Buffer.byteLength(r.text, "utf8");
			assert.ok(
				actual <= budgetBytes,
				`预算 ${budgetBytes} 字节、query「${userText}」，实际注入 ${actual} 字节，超 ${actual - budgetBytes}`,
			);
		}
	}
});


test("决策只数条数，不读排序分（排序分注入极端值，注入结果不变）", async () => {
	const many = await buildRecallInjection({ userText: "修改受保护内容并重新提交", projectRoot: ROOT, limit: 20 });
	assert.equal(many.inject, true, "有候选即注入，与分数高低无关");
	const one = await buildRecallInjection({ userText: "修改受保护内容并重新提交", projectRoot: ROOT, limit: 1 });
	assert.equal(one.inject, true, "limit=1 时仍注入（条数 1 ≥ MIN_HITS）");

	const base = { candidateCount: 1, residentIndexPresent: false };
	assert.equal(decideInjection(base), true, "有一条候选即注入");
	assert.equal(decideInjection({ candidateCount: 0, residentIndexPresent: false }), false, "零候选无常驻索引不注入");
	assert.equal(decideInjection({ candidateCount: 0, residentIndexPresent: true }), true, "零候选但有常驻索引内容仍注入（34 §8.4 末段）");
	for (const score of [0, -1e9, 1e9, Number.NaN]) {
		assert.equal(decideInjection({ ...base, hits: score, score, bm25: score }), true,
			`分数 ${score} 不得影响决策`);
		assert.equal(decideInjection({ candidateCount: 0, residentIndexPresent: false, hits: score, score }), false,
			`分数 ${score} 不得让零候选变成注入`);
	}

	assert.ok(Array.isArray(DECISION_KEYS), "DECISION_KEYS 须导出");
	assert.ok(!DECISION_KEYS.includes("baselinePresent"), "已撤除的决策基线死键不得留在决策闭集里");
	for (const forbidden of ["hits", "score", "bm25", "tier", "path"]) {
		assert.ok(!DECISION_KEYS.includes(forbidden),
			`决策闭集不得包含排序键「${forbidden}」（排序分只用于排序，34 §13／02 §9.2）`);
	}
});

test("三态 gate 不因引入加权而改变（34 §6 进入判据仍是唯一决策前提）", async () => {
	for (const q of ["看看这个文件", "列出所有规范"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.deepEqual(r.result?.facts ?? [], [], `「${q}」是纯读取，不得在事实侧给候选`);
		assert.deepEqual(r.result?.specs ?? [], [], `「${q}」是纯读取，不得在规范侧给候选`);
		assert.equal(r.result?.baselineOnlyCause, "excluded-by-34-6", `「${q}」归因须为 §6 排除`);
	}
	const w = await buildRecallInjection({ userText: "修改受保护内容", projectRoot: ROOT });
	assert.equal(w.inject, true, "写动作须进入召回");
});


test("宿主通知不得被当作召回查询（本机实测 11 种 kind 逐一核对）", () => {
	const user = { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "真实用户问题" }] };

	const missed = [
		["model-selection", "[model changed: assistant turns above this point were generated by workbuddy/deepseek-v4.1-flash]"],
		["tool-jobs", "background job bash-a62cb096431c445c445 (bash: cd /Users/x && npm test) finished"],
		["subagent-settled", "Background subagent edf12679-d4f4 finished and will do no further work unless you send it more."],
		["plugin:dsh-subagent-default-model", "[dsh-subagent-default-model] You are running as a subagent on dsh-opencode-go/x"],
		["user-approval", 'The approval policy changed from "ask" to "never" (changed by the user).'],
	];
	const already = ["time-context", "runtime-context", "skill-catalog", "agent-instructions", "compact-checkpoint"];

	for (const [kind, text] of [...missed, ...already.map((k) => [k, `host context for ${k}`])]) {
		const notice = { role: "user", source: { kind }, content: [{ type: "text", text }] };
		assert.equal(
			currentUserText([user, notice], () => false),
			"真实用户问题",
			`kind=${kind} 的通知不得被当作查询（否则召回会整体跑偏）`,
		);
		assert.equal(currentUserText([notice], () => false), "", `kind=${kind} 单独存在时须返回空`);
	}

	assert.equal(
		currentUserText([{ role: "user", content: [{ type: "text", text: "旧形态无 source" }] }], () => false),
		"旧形态无 source",
	);
	assert.equal(
		currentUserText([{ role: "user", source: {}, content: [{ type: "text", text: "有 source 无 kind" }] }], () => false),
		"有 source 无 kind",
	);

	assert.equal(isUserInputSource({ kind: "user" }), true);
	for (const k of ["model-selection", "tool-jobs", "time-context", "user-approval", "anything-new"]) {
		assert.equal(isUserInputSource({ kind: k }), false, `未登记的 kind=${k} 须按非用户处理（失败关闭）`);
	}
	assert.equal(isUserInputSource(undefined), true, "无 source 须按用户处理");
	assert.equal(isUserInputSource({}), true, "无 kind 须按用户处理");
});

test("白名单改为「失败关闭」：未知 kind 须被排除，不得按用户处理", () => {
	const unknown = { role: "user", source: { kind: "some-future-host-notice" }, content: [{ type: "text", text: "未来才有的通知" }] };
	assert.equal(
		currentUserText([unknown], () => false),
		"",
		"未知 kind 须被排除——黑名单方向会让它冒充用户查询，而那正是本次事故的成因",
	);
});


test("31 §10：注入路径须把 Spark 排除在声明范围外（否则规范与实现相反）", async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-injspark-"));
	const write = async (dir, type, uid, title, status) => {
		await mkdir(joinPath(project, "ldvh-base", dir), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", dir, `${uid}.md`),
			`---\ntitle: ${title}\nstatus: ${status}\nscope: 适用于注入范围测试\nobject_uid: ${uid}\nfact_type_key: ${type}\n---\n\n# ${title}\n\n## 现象\n\n注入范围测试载体。\n`,
			"utf8",
		);
	};
	try {
		await write("sparks", "spark", "44444444-4444-4444-8444-444444444444", "注入范围测试 火花条目", "open");
		await write("pitfalls", "pitfall", "55555555-5555-4555-8555-555555555555", "注入范围测试 经验条目", "active");

		const built = await buildRecallInjection({
			userText: "修改 注入范围测试 相关的实现",
			projectRoot: project,
			budgetBytes: 40000,
			limit: 10,
		});
		assert.equal(built.inject, true, "前提：本回合应进入注入路径");
		const types = built.result.facts.map((f) => f.type);
		assert.ok(!types.includes("spark"), `注入候选不得含 spark，实测：${types.join(",")}`);
		assert.ok(types.includes("pitfall"), "同批 pitfall 仍须进入注入（排除是定向的）");
		assert.equal(built.result.uncheckedRange.excludedByTypeFilter.length, 0);
		assert.ok(
			built.result.uncheckedRange.excludedByScope.some((f) => f.type === "spark"),
			"excludedByScope 须如实列出被排除的 spark",
		);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("34 §12：注入面须**无条件**披露声明范围（含 complete 与零命中两种情形）", async () => {
	const { renderRecallRow } = await import("../lib/recall-injection.js");
	const scope = {
		types: ["spark"],
		entryByType: { spark: "ldvh_spark_list" },
	};
	const mk = (over) => ({
		specs: [],
		facts: [],
		recallCompleteness: "partial",
		uncheckedRange: {
			scopeExcluded: scope,
			sourceNotRead: [],
			excludedByTypeFilter: [],
			excludedByStatus: [],
			excludedByTypeWhitelist: [],
			excludedByScope: [{ type: "spark", title: "x", path: "p" }],
		},
		...over,
	});

	const complete = renderRecallRow(mk({ recallCompleteness: "complete" }));
	assert.ok(
		complete.includes("不含 spark"),
		"complete 时也须披露声明范围——否则范围变更在注入面完全不可见",
	);
	assert.ok(complete.includes("ldvh_spark_list"), "披露须给出替代入口，不能只说「不含 spark」");
	assert.ok(
		!complete.includes("本次召回完整度"),
		"complete 时不应打印三态行（既有纪律：稳态安静）",
	);

	const partial = renderRecallRow(mk({ recallCompleteness: "partial" }));
	assert.ok(partial.includes("不含 spark") && partial.includes("本次召回完整度"));

	const zero = renderRecallRow(mk({ recallCompleteness: "complete" }));
	assert.ok(zero.includes("未命中候选"));
	assert.ok(
		!zero.includes("必要时请自行扩大检索"),
		"有声明范围时不得邀请扩大检索——那条路径上永远取不到被排除的类型",
	);
	assert.ok(zero.includes("ldvh_spark_list"), "零命中时须指向替代入口");

	const noScope = renderRecallRow({
		...mk({ recallCompleteness: "complete" }),
		uncheckedRange: { ...mk().uncheckedRange, scopeExcluded: null, excludedByScope: [] },
	});
	assert.ok(noScope.includes("必要时请自行扩大检索"), "无排除范围时不该删掉这句");
	assert.ok(!noScope.includes("不含 spark"), "无排除范围时不该凭空出现范围声明");
});


function truncationNotes(text) {
	const out = [];
	for (const line of text.split("\n")) {
		if (/^（(本次为|受预算|受条数|预算极小|渲染层|\*\*渲染层)/.test(line)) out.push(line);
	}
	return out;
}

test("截断归因：limit 已达 RECALL_LIMIT_MAX 时不得再劝「调大 limit」", async () => {
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: RECALL_LIMIT_MAX,
		budgetBytes: 40000,
	});
	const line = truncationNotes(r.text).find((l) => l.includes("受条数上限"));
	assert.ok(line !== undefined, "须有条数说明行");
	assert.ok(
		!/调大 limit/.test(line),
		`已达上限时不得建议调大（那是给不存在的操作指路）。实际：${line}`,
	);
	assert.match(line, /已是本实现的条数上限/, "须说明为何不能再调");
});

test("截断归因：渲染层行只报渲染层的数字，且 K + M 等于数据层列出条数（可核对）", async () => {
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 3,
		budgetBytes: 2400,
	});
	const notes = truncationNotes(r.text);
	const renderLine = notes.find((l) => l.includes("渲染层按硬约束"));
	if (renderLine === undefined) return;

	const m = /裁去 (\d+) 条候选/.exec(renderLine);
	const k = /现列出 (\d+) 条/.exec(renderLine);
	assert.ok(m !== null && k !== null, `渲染层行须同时给出裁去数与剩余数。实际：${renderLine}`);
	const listed = r.result.specs.length + r.result.facts.length;
	assert.equal(
		Number(k[1]) + Number(m[1]), listed,
		`渲染层剩余 ${k[1]} + 裁去 ${m[1]} 须等于数据层列出 ${listed}（否则两行口径不一致）`,
	);

	assert.ok(
		!/每侧 limit/.test(renderLine),
		`渲染层行不得复述数据层每侧上限。实际：${renderLine}`,
	);
});

test("截断归因：同一次注入里每类来源最多一条说明，且互不冒充", async () => {
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 3,
		budgetBytes: 2400,
	});
	const notes = truncationNotes(r.text);
	const dataLayer = notes.filter((l) => /^（(本次为|受预算|受条数|预算极小)/.test(l));
	assert.ok(dataLayer.length <= 1, `数据层截断说明不得重复，实际 ${dataLayer.length} 条：${dataLayer.join(" | ")}`);
	const renderLayer = notes.filter((l) => /^（\*\*?渲染层/.test(l));
	assert.ok(renderLayer.length <= 1, `渲染层截断说明不得重复，实际 ${renderLayer.length} 条：${renderLayer.join(" | ")}`);
	for (const line of dataLayer) {
		assert.ok(!/渲染层/.test(line), `数据层行不得陈述渲染层的事。实际：${line}`);
	}
});



test("L0 常驻：定位摘录降级须留痕，且「不静默」不变量在紧预算下成立", async () => {
	const project = await mkdtemp(join(tmpdir(), "ldvh-normdegrade-"));
	try {
		await seedFactCorpus(project, { pitfallCount: 0 });
		for (const budgetBytes of [1500, 1800, 2000, 2400, 3000, 10240]) {
			const r = await buildRecallInjection({
				userText: "把 34 号规范改名成双源召回",
				projectRoot: project,
				limit: 99,
				budgetBytes,
			});
			const segment = r.result?.l0Enumeration?.segments?.find((s) => s.type === "norm");
			if (segment === undefined || segment.yielded === true) continue;
			const degraded = (segment.excerptOmitted ?? 0) > 0 || (segment.excerptUnavailable ?? 0) > 0;
			if (!degraded) continue;
			assert.ok(
				segment.excerptDisclosed === true,
				`预算 ${budgetBytes}：摘录被降级（om=${segment.excerptOmitted} unav=${segment.excerptUnavailable}）时，` +
					`必须由披露行显式说明，不得只靠讲标题数的截断段尾。lines=${JSON.stringify(segment.lines)}`,
			);
			assert.equal(
				segment.shown,
				segment.excerptShown + segment.excerptOmitted + segment.excerptUnavailable,
				`预算 ${budgetBytes}：计数须互斥（shown=${segment.shown} = exShown+om+unav）`,
			);
			const actual = Buffer.byteLength((segment.lines ?? []).join("\n"), "utf8") + 1;
			assert.equal(segment.bytes, actual, `预算 ${budgetBytes}：段字节账须与实际相符`);
			assert.ok(
				Buffer.byteLength(r.text, "utf8") <= budgetBytes,
				`预算 ${budgetBytes}：实际注入 ${Buffer.byteLength(r.text, "utf8")}B 不得超预算`,
			);
		}
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});




test("L0 全量段尾不得长于通用段尾（份额守卫）", () => {
	assert.ok(
		Buffer.byteLength(L0_NORM_NOTE, "utf8") <= Buffer.byteLength(L0_FULL_NOTE, "utf8"),
		`Norm 全量段尾 ${Buffer.byteLength(L0_NORM_NOTE, "utf8")}B 不得超过通用段尾 ${Buffer.byteLength(L0_FULL_NOTE, "utf8")}B，否则挤占候选份额`,
	);
});


test("L0 常驻：单纯读取回合也须带出经验按需行，且不并列事实规范段（不依赖词法命中）", async () => {
	for (const q of ["继续", "看看这个文件"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT, budgetBytes: 10240 });
		assert.equal(r.inject, true, `「${q}」：须注入`);
		assert.equal(r.result?.baselineOnly, true, `「${q}」：须标记为只带索引`);
		assert.doesNotMatch(r.text, /【事实规范 · active Norm/, `「${q}」：纯读取行不得再并列事实规范段`);
		assert.match(r.text, /【经验 · active Pitfall（25 §12 按需索引）/, `「${q}」：经验按需行须在`);
	}
});



test("34 §8.2 第 3 项：交付了候选就必须同时给出消费方法（判据是「有候选」，不是预算档位）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await buildRecallInjection({ userText: "改字段名之后读取那边没跟着改", projectRoot: ROOT, limit: 12, budgetBytes: 10240 });
	assert.equal(r.inject, true);
	assert.match(r.text, /【双源召回/, "前提：应已产生候选区");
	const hasCandidates = r.text.split("\n").some((l) => l.startsWith("- "));
	assert.ok(hasCandidates, "前提：本档须真的交付了候选（否则本用例失去意义）");
	assert.match(r.text, /用法/, "有候选时须给出用法");
	assert.match(r.text, /34 §8\.2/, "须回指规范依据，使纪律可核对");
	assert.match(r.text, /写明依据来自哪一条/, "须给出「有改变」时的动作");
	assert.match(r.text, /不改变须说明为何/, "须给出「确认无需改变」时的动作（§8.3 合法结论）");
	const lines = r.text.split("\n");
	const usageIdx = lines.findIndex((l) => l.includes("用法（34 §8.2）"));
	const firstCandidateIdx = lines.findIndex((l) => l.startsWith("- "));
	assert.ok(usageIdx !== -1, "用法行应存在");
	assert.ok(
		usageIdx < firstCandidateIdx,
		`用法行须在候选之前（实际 ${usageIdx}，首条候选 ${firstCandidateIdx}）`,
	);
});

test("34 §8.2 第 3 项：有候选的档位必有用法（正控制，防判据写成恒假）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 99, budgetBytes: 4000 });
	assert.equal(r.inject, true);
	const candidates = r.text.split("\n").filter((l) => l.startsWith("- ")).length;
	assert.ok(candidates > 0, "前提：本档须真的交付了候选（若语料变动致零候选，须换一个实测有候选的紧档）");
	assert.ok(r.text.includes("用法（34 §8.2）"), "有候选时须输出用法行");
	assert.ok(Buffer.byteLength(r.text, "utf8") <= 4000, "输出用法行后仍不得超预算");
});

test("兜底通道：兜底行不得使小预算档的候选数倒挂于更小预算档", async () => {
	const probe = async (b) => {
		const r = await buildRecallInjection({
			userText: "这条 friction 该销账吗",
			projectRoot: ROOT,
			budgetBytes: b,
		});
		const text = typeof r.text === "string" ? r.text : "";
		return (text.match(/^- /gm) ?? []).length;
	};
	const ladder = [3200, 4000, 4800, 6000];
	const rows = [];
	for (const b of ladder) rows.push({ b, n: await probe(b) });
	for (let i = 1; i < rows.length; i += 1) {
		const drop = rows[i - 1].n - rows[i].n;
		assert.ok(
			drop <= 2,
			`预算 ${rows[i].b} 的候选数 ${rows[i].n} 比更小预算 ${rows[i - 1].b} 的 ${rows[i - 1].n} 少了 ${drop} 条——`
			+ "超过 2 条说明某个可选行严重挤占了内容，不是文案微调能解释的",
		);
	}
});



test("34 §8.2 第 4 项：事实候选行须带 object_uid，且它等于载体的 object_uid", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await buildRecallInjection({ userText: "改字段名之后读取那边没跟着改", projectRoot: ROOT, limit: 12, budgetBytes: 10240 });
	assert.equal(r.inject, true);
	const factRows = r.text.split("\n").filter((l) => l.startsWith("- ["));
	assert.ok(factRows.length > 0, "前提：须有事实候选行");
	const withUid = factRows.filter((l) => / · uid=[0-9a-f]{8}-[0-9a-f]{4}-/.test(l));
	assert.ok(withUid.length > 0, `事实候选行须带完整 object_uid。实际行：${factRows[0]}`);
	for (const fact of r.result.facts) {
		if (typeof fact.objectUid !== "string" || fact.objectUid === "") continue;
		assert.ok(
			r.text.includes(` · uid=${fact.objectUid}`),
			`候选「${fact.title}」的 object_uid 未出现在渲染行里`,
		);
	}
});

test("34 §8.2 第 4 项：缺失 object_uid 时如实标注，不得用文件名冒充", async () => {
	const text = renderRecallRow({
		specs: [],
		facts: [{ type: "pitfall", status: "active", title: "无声明载体", path: "ldvh-base/pitfalls/x.md", hitReason: "标题命中：校验" }],
		truncated: false,
		budget: {},
	});
	assert.match(text, /uid=缺失/, "缺 object_uid 须如实标注");
	assert.ok(!/ · uid=x(\.md)?/.test(text), "不得把文件名冒充 object_uid");
});

test("34 §8.2 第 2、4 项：规范候选行须带 spec_key（不暗示已定位章节）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await buildRecallInjection({ userText: "改字段名之后读取那边没跟着改", projectRoot: ROOT, limit: 12, budgetBytes: 10240 });
	const specRows = r.text.split("\n").filter((l) => l.startsWith("- ") && !l.startsWith("- ["));
	assert.ok(specRows.length > 0, "前提：须有规范候选行");
	const withKey = specRows.filter((l) => /spec_key=[a-z0-9-]+/.test(l));
	assert.ok(withKey.length > 0, `规范候选行须带 spec_key。实际行：${specRows[0]}`);
	const leaked = specRows.filter((l) => /heading_path|章节已定位|L3 章节/.test(l));
	assert.deepEqual(leaked, [], `不得暗示已定位章节（本实现只给路径）：${leaked.join(" | ")}`);
	for (const spec of r.result.specs) {
		if (typeof spec.specKey !== "string" || spec.specKey === "") continue;
		assert.ok(r.text.includes(`spec_key=${spec.specKey}`), `候选「${spec.title}」的 spec_key 未出现在渲染行里`);
	}
});

test("34 §8.2 第 3 项：用法是否出现须机械可观察（render.usagePresent）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	for (const budgetBytes of [800, 1200, 1900, 10240]) {
		const r = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 99, budgetBytes });
		if (r.inject !== true) continue;
		assert.equal(
			r.result.render.usagePresent,
			r.text.includes("用法（34 §8.2）"),
			`${budgetBytes} 档：render.usagePresent 须与文本实际内容一致`,
		);
	}
});
