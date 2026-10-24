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
	ENTRY_VERDICTS,
	RECALL_BYTE_BUDGET,
	RECALL_RENDER_CHAR_LIMIT,
	RECALL_SUMMARY,
	buildRecallInjection,
	classifyEntry,
	currentUserText,
	renderRecallRow,
	shouldRecall,
} from "../lib/recall-injection.js";
import { recallForAction } from "../lib/source-recall.js";

const ROOT = join(import.meta.dirname, "..", "..");

// ---------------------------------------------------------------------------
// 34 §6 进入判定（进入信号 + 排除条件 + 不确定处理）
// ---------------------------------------------------------------------------

test("34 §6 排除条件：纯读取与纯查询动作不进入本系统", () => {
	// §6 逐字：「纯读取与纯查询动作不进入本系统」
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
	// §6 逐字：「即将执行会产生副作用或改变状态的动作」
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
	// §6 逐字：「适用性无法判定时，**不得**按「无约束」处理」
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
	// 夹具补上 counts：新判据用「有一源命中却返回 0」识别「放不下」，
	// 缺 counts 时无法判断，会退到条数分支（2026-10-24 改）。
	const text = renderRecallRow({
		specs: [],
		facts: [{ type: "adr", status: "active", title: "某决定", path: "ldvh-base/adrs/a.md", hitReason: "标题命中：决定" }],
		truncated: true,
		counts: { specHits: 3, factHits: 1, specsReturned: 0, factsReturned: 1 },
		budget: { limitBytes: 200, usedBytes: 190 },
	});
	// 文案已按真实原因细分（2026-10-24）：190/200 = 95%，属**预算受限**，
	// 故走「受预算限制已裁剪」而非笼统的「超出预算已裁剪」（后者在未超预算时是误报）。
	assert.match(text, /受预算限制已裁剪/);
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

test("buildRecallInjection：命中 34 §6 排除条件时不注入", async () => {
	const r = await buildRecallInjection({ userText: "看看这个文件", projectRoot: ROOT });
	assert.equal(r.inject, false);
	assert.equal(r.reason, "excluded-by-34-6");
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
		// 保底一条可能超额；未走保底时不得超。
		if (r.result.overBudget !== true) {
			assert.ok(r.result.budget.usedBytes <= 120, "未走保底时不得超预算");
		}
		assert.match(r.text, /超出预算已裁剪|预算极小|候选/, "超预算须标明或至少是候选行");
	}
});

test("RECALL_BYTE_BUDGET 是固定常量，且大到能容纳 3 规范 + 3 事实", () => {
	assert.equal(typeof RECALL_BYTE_BUDGET, "number");
	assert.equal(RECALL_BYTE_BUDGET, 2400);
	// 实测：limit:3 时三条规范候选约 1400–1500 字节、三条事实约 870–910 字节。
	// 预算过紧会让每一次召回都 truncated，使它失去「防超量」的原意。
	assert.ok(RECALL_BYTE_BUDGET >= 2200, "须容纳完整的一轮 3+3 候选");
});

test("RECALL_SUMMARY 标出「双源召回」，Human 侧折叠可见", () => {
	assert.match(RECALL_SUMMARY, /双源召回/);
});

test("34 §6：空串是「没有动作」故排除，非字符串才是「判不出来」故不确定", () => {
	// 这两者必须分开：空串有明确含义（没有输入），非字符串是调用方的类型错误。
	assert.equal(classifyEntry(""), "exclude", "空串应排除");
	assert.equal(classifyEntry("   "), "exclude", "纯空白应排除");
	assert.equal(classifyEntry(null), "uncertain", "非字符串是不确定，不是排除");
	assert.equal(shouldRecall(""), false, "空串不触发召回");
	assert.equal(shouldRecall(null), true, "不确定一律触发（§6 不得按无约束）");
});

test("34 §6：纯读取即使含领域词也排除（内容相关度不压过排除条件）", () => {
	// 含领域词的纯读取仍应排除：排除条件不看内容相关度。
	assert.equal(shouldRecall("列出所有 Pitfall 的标题"), false);
	assert.equal(shouldRecall("看看这些 ADR 有哪些"), false);
	assert.equal(shouldRecall("读一下 34 号规范的输入来源"), false);
});

test("已知精度边界：词表匹配会把「怎么写的」误判为写动作（如实登记，不假装没有）", () => {
	// 34 §6 的进入信号是语义条件，词表只能近似。实测反例：
	// 「看看这些 ADR 是怎么写的」是询问，但含「写」字 → 判 enter。
	//
	// 这是**刻意的取舍方向**：判成 enter 的代价是多注入一行候选；判成 exclude 的
	// 代价是漏掉一次本该做的召回。后者更贵（§6 不确定处理：不得按无约束处理）。
	// 故本测试登记该误判为「已知边界」，而非断言它不成立——规范原文不要求
	// 实现对语义动作的精确分类，只要求不把「判不出」当作「不在范围内」。
	assert.equal(classifyEntry("看看这些 ADR 是怎么写的"), "enter", "已知误判方向：偏保守");
	// 反向保证：不含写动作字的纯读取确实被排除（这才是排除条件的主要作用）。
	assert.equal(classifyEntry("看看这些 ADR 有哪些"), "exclude");
});

// ---------------------------------------------------------------------------
// 第一回合时序：lastScope 可能尚未就绪
// ---------------------------------------------------------------------------

test("时序：lastScope 未就绪时不得静默跳过召回（pre-step 先于首次 assemble）", async () => {
	// 背景：lifecycle.lastScope 由安装时的异步 resolve() 在 .then 里赋值，而
	// pre-step（prepend）在首次 assemble **之前**运行。故第一回合读 lastScope
	// 可能仍是 undefined。若此时直接返回 no-project，召回会在第一回合静默失效。
	//
	// 这里守的是「兜底路径存在且可用」：给定 cwd 能解析出项目时，仍应召回。
	// 用 buildRecallInjection 直接验证兜底的输入（projectRoot）可得，
	// 而不依赖 lifecycle 内部的私有状态。
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT, // 兜底路径解析出来的正是这个值
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
	// 这两者的处置完全不同：取不到输入要去查「为什么取不到」（批次形态、
	// step 语义、注入行是否被误当成用户消息）；§6 排除是**正常判定**。
	// 若都报 excluded-by-34-6，前者会被当成后者，从而无人调查——那正是
	// 「验证手段在骗我」的形态。
	for (const userText of ["", "   ", null, undefined]) {
		const r = await buildRecallInjection({ userText, projectRoot: ROOT });
		assert.equal(r.inject, false);
		assert.equal(r.reason, "no-user-text", `「${String(userText)}」应报输入缺失，不是 §6 排除`);
	}
	// 取到了但不满足进入条件，才是 §6 排除。
	const r2 = await buildRecallInjection({ userText: "看看这个文件里有什么", projectRoot: ROOT });
	assert.equal(r2.reason, "excluded-by-34-6");
});

test("诊断问句不得判为纯读取（34 §6 排除条件只挡「只为取信息」的动作）", async () => {
	// 实测缺陷：「为什么」「解释」「说明」曾在 READ_ACTIONS 里，导致「为什么这里
	// 不对」「这里为什么报错」「为什么不生效」这类**导向修**的问句被判 exclude，
	// 完全不进入召回。排除条件要挡的是「看看/列一下/查一下」这种只取信息的动作。
	for (const q of ["为什么这里不对", "这里为什么报错", "为什么不生效", "解释一下这段"]) {
		const verdict = classifyEntry(q);
		assert.notEqual(verdict, "exclude", `「${q}」是诊断问句，不得判为纯读取`);
	}
	// 真纯读取仍须排除。
	for (const q of ["看看这个文件", "列出所有 ADR", "读一下这一节"]) {
		assert.equal(classifyEntry(q), "exclude", `「${q}」是纯读取，应排除`);
	}
});

test("诊断问句能召回（有主题词时）", async () => {
	const r = await buildRecallInjection({ userText: "这里为什么报错", projectRoot: ROOT });
	assert.equal(r.inject, true, "有主题词的诊断问句应能召回");
});

test("无主题词的问句：no_tokens 是合理结果，如实报出而非假装召回", async () => {
	// 「为什么这里不对」全是虚字 + 「不对」，没有任何**主题词**——不知道要召回
	// 什么主题，no_tokens 是正确行为。这里断言「如实报出」，不是断言「必须召回」。
	const r = await buildRecallInjection({ userText: "为什么这里不对", projectRoot: ROOT });
	assert.equal(r.inject, false);
	assert.match(r.reason, /no_tokens|no-hits/, "应如实说明召回器无从下手，而不是伪装成无相关约束");
});

test("渲染文本须有硬上限，超限按行裁剪并如实说明（不得静默截断）", async () => {
	// 此前只有**数据**预算（RECALL_BYTE_BUDGET，约束候选 JSON 字节量），
	// 没有**渲染文本**预算——同批数据的渲染长度取决于标题长短、命中理由、
	// 是否带 partial/来源/边界提示，实测同一批从 802 到 1167 字符不等。
	// 项目语料变大后渲染层可无界增长（10:241 对引导面有「未超常量预算」核对项，
	// 召回面此前缺对应约束）。
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
	assert.match(out, /渲染文本超出上限/, "超限须如实说明");
	assert.match(out, /不代表不存在/, "须说明未列出的不代表不存在");
	assert.equal(RECALL_RENDER_CHAR_LIMIT, 1600, "常量值应固定（实测最坏 1167，留约 37% 余量）");
});

test("渲染文本未超限时不得添加裁剪说明", async () => {
	const r = await buildRecallInjection({ userText: "页面白屏了", projectRoot: ROOT });
	if (r.inject) {
		assert.ok(!/渲染文本超出上限/.test(r.text), "未超限时不得出现裁剪说明");
	}
});

test("截断说明须区分真实原因（预算 vs 条数），不得一律说「超预算」", async () => {
	// 实测缺陷：渲染层对 `truncated` 一律输出「超出预算已裁剪」，而多数情形
	// **根本没超预算**（实测 used 2330 < limit 2400 却仍如此声明）——属误报。
	// 裁剪有三种来源：limit（条数）、预算（字节）、保底（超额）。
	// 1) 条数限制：预算余量充足。
	const byLimit = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 1,
		budgetBytes: 40000,
	});
	assert.equal(byLimit.inject, true);
	assert.match(byLimit.text, /受条数上限/, "条数限制须说 limit");
	assert.ok(!/超出预算已裁剪/.test(byLimit.text), "预算充足时不得声称超预算");
	assert.match(byLimit.text, /预算尚有余量/, "须如实说明预算有余量");

	// 2) 预算限制：须把预算压到确实放不下更多候选的程度。
	// 注意（2026-10-24）：第 34 轮改成按源分配预算（规范最多 60%）后，正常预算
	// 不再压线（实测 1981/2400 = 82.5%），此时正确归因是「条数限制」而非预算。
	// 故此处必须用**真正紧张**的预算才能触发预算分支。
	const byBudget = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 99,
		budgetBytes: 1200,
	});
	assert.equal(byBudget.inject, true);
	assert.match(byBudget.text, /受预算限制|预算极小/, `预算受限须点名预算，实际：${byBudget.text.slice(-160)}`);
	assert.ok(!/受条数上限/.test(byBudget.text), "预算受限时不得归因为条数限制");
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
	// 2026-10-24：原名 RECALL_CHAR_BUDGET 实际按 UTF-8 字节使用（传给 budgetBytes），
	// 而同文件的 RECALL_RENDER_CHAR_LIMIT 真按字符计（line.length）。两个「CHAR」
	// 不同义——中文一字三字节，混同会让维护者按字符估算而低估 3 倍。
	// 现字节预算已改名为 RECALL_BYTE_BUDGET。
	assert.equal(RECALL_BYTE_BUDGET, 2400);
	assert.equal(RECALL_RENDER_CHAR_LIMIT, 1600);

	// 实测同一段文本的字符数与字节数确实不同（中文占 3 字节），
	// 若两者相等则说明全部是 ASCII——那样这条校验就失去意义。
	const sample = "双源召回 · 行动前候选";
	assert.notEqual(
		sample.length,
		Buffer.byteLength(sample, "utf8"),
		"样本须含非 ASCII 字符，否则无法体现字节与字符之差",
	);
	// 逐字核算，不断言「整体 = 字符数×3」——样本含 `·`（U+00B7，2 字节）与空格
	// （1 字节），整体并非纯 3 字节。只断言「汉字占 3 字节」这一条事实。
	for (const ch of sample) {
		if (/[\u4e00-\u9fff]/.test(ch)) {
			assert.equal(Buffer.byteLength(ch, "utf8"), 3, `汉字「${ch}」应占 3 字节`);
		}
	}
	assert.ok(
		Buffer.byteLength(sample, "utf8") > sample.length,
		"含中文的样本，字节数必大于字符数",
	);

	// 数据预算按字节生效：显式传 RECALL_BYTE_BUDGET 后，用量须受其字节约束。
	// 注意 `recallForAction` 自身的默认预算是 4000（另一个函数、另一个默认值），
	// 与 `RECALL_BYTE_BUDGET`（buildRecallInjection 的默认）不是同一个数——
	// 这正是本条用例要锁住的地方：混用会让「预算到底是多少」变得说不清。
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

test("渲染行须显示候选摘录（数据层有而渲染不显示 = 读者仍看不到）", async () => {
	// `02 §9.1` F2 要求「有界确定性摘录」。数据层加了 excerpt 但渲染层不显示时，
	// 读者依然只能看到 title + path，F2 的分层意义丢失。
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名",
		projectRoot: ROOT,
		limit: 2,
		budgetBytes: 40000,
	});
	assert.equal(r.inject, true);
	// 摘录以「↳ 」引导行呈现。
	assert.match(r.text, /↳ /, "渲染行须出现摘录引导符");
	// 且摘录内容须来自数据层（非重复标题）。
	const excerptLine = r.text.split("\n").find((l) => l.trim().startsWith("↳"));
	assert.ok(excerptLine !== undefined);
	assert.ok(excerptLine.trim().length > 5, "摘录不得为空");
});
