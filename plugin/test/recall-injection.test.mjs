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
import { recallForAction, RECALL_DIRECT_BYTE_BUDGET } from "../lib/source-recall.js";

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

test("M-20：注入路径与直调路径的两个预算常量不得互相代入（34 §11 第 3 条）", async () => {
	// 第五次审核 M-20：34 §11 规定召回侧须区分**两个预算**——宿主注入路径
	// （RECALL_BYTE_BUDGET，属 10 §5.3 引导面预算）与直调路径
	// （RECALL_DIRECT_BYTE_BUDGET，不进入引导面，由 34 承接），二者「分别承载、
	// 不得互相代入」。此前只有注释说明，无机械断言：一旦有人把两个常量写成相等、
	// 或让注入路径误用直调预算，规范约束就静默失效。
	//
	// 断言三件事：① 两个常量都是有限正数（确为承载了的具名常量，非运行期猜测）；
	// ② 二者取值不同（若相等即「互相代入」，违反 §11「不得互相代入」）；
	// ③ recallForAction 的默认预算取自直调常量（证明默认走的是直调路径预算）。
	assert.ok(Number.isFinite(RECALL_BYTE_BUDGET) && RECALL_BYTE_BUDGET > 0, "注入预算须为具名正常量");
	assert.ok(Number.isFinite(RECALL_DIRECT_BYTE_BUDGET) && RECALL_DIRECT_BYTE_BUDGET > 0, "直调预算须为具名正常量");
	assert.notEqual(
		RECALL_BYTE_BUDGET,
		RECALL_DIRECT_BYTE_BUDGET,
		`两个预算不得相等（互相代入）：注入=${RECALL_BYTE_BUDGET} 直调=${RECALL_DIRECT_BYTE_BUDGET}`,
	);
	// ③ 直调默认预算 = RECALL_DIRECT_BYTE_BUDGET（不传 budgetBytes 时）。
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(
		r.budget.limitBytes,
		RECALL_DIRECT_BYTE_BUDGET,
		`recallForAction 默认预算须取自直调常量（${RECALL_DIRECT_BYTE_BUDGET}），实测 ${r.budget.limitBytes}`,
	);
	// 注入路径用的是另一个常量：证明两条路径各取各的预算。
	assert.equal(RECALL_BYTE_BUDGET, 2400, "注入路径预算锚定 2400（10 §5.3 引导面预算）");
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

test("N-5：partial/unavailable 时注入行须呈现三态与未读取源；complete 保持安静", () => {
	// 第六次审核 N-5：34 §12 要求「召回范围的完整度须以三态交还」「取值须与
	// 未检查范围逐类对应」，而注入路径此前从不渲染 recallCompleteness——
	// §6 零命中退出路径的 complete 前提在注入上下文中无从核对。
	// renderRecallRow 是纯函数，用最小构造结果直接核对渲染。
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

	// complete 稳态安静：不加三态行（与截断说明只在有事发生时输出同一纪律）。
	const completeRow = renderRecallRow({
		specs: [{ title: "双源召回系统规范", path: "specs/34-双源召回系统规范.md", hitReason: "命中", excerpt: "……", source: {} }],
		facts: [],
		recallCompleteness: "complete",
	});
	assert.ok(!completeRow.includes("本次召回完整度"), "complete 时不得加三态行（稳态安静）");
});

test("渲染裁剪须可观察（02 §9.1「截断必须可观察」）", async () => {
	// 实测缺口（2026-10-24）：渲染层硬上限会按行裁剪、提示语也写明了，但
	// `result` 上没有对应字段——调用方与测试只能正则匹配那段中文提示，
	// 无法机械判定「这次渲染被裁过」。
	const normal = await buildRecallInjection({
		userText: "把 34 号规范改名",
		projectRoot: ROOT,
		limit: 2,
		budgetBytes: 2400,
	});
	assert.ok(normal.result.render !== undefined, "须给出 render 观察字段");
	assert.equal(normal.result.render.limitChars, RECALL_RENDER_CHAR_LIMIT);
	assert.equal(typeof normal.result.render.truncated, "boolean");

	// 大 limit 下渲染文本会超上限并被裁剪 → truncated 须为 true。
	const big = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 50,
		budgetBytes: 999999,
	});
	assert.equal(big.result.render.truncated, true, "超上限时须标 truncated");
	assert.ok(big.result.render.chars > 0);
	// 且与「数据侧截断」是两个独立字段，不得混同。
	assert.equal(typeof big.result.truncated, "boolean", "数据侧截断字段须独立存在");
});

test("渲染行不得宣称过时的实测百分比（旧值 43% 已与现状 100% 相差巨大）", async () => {
	// 实测缺陷（2026-10-24）：渲染行每回合都宣称「用 Pitfall 症状召回自身仅 43%
	// （13/30）」。那是**第 46 轮之前**（正文只匹配前 1200 字符时）的测量；
	// 改为全文匹配后复测为 **23/23 = 100%**（22 条靠 tier 1、1 条靠 tier 4）。
	//
	// 危害：数字每回合被注入，会给读者**错误的悲观预期**（以为查故障基本查不到），
	// 从而不敢用这个功能。故渲染行不引用具体百分比，只保留结构性边界。
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名",
		projectRoot: ROOT,
		limit: 3,
	});
	assert.equal(r.inject, true);
	assert.ok(!/43%/.test(r.text), "不得再出现已过时的 43%");
	assert.ok(!/13\/30/.test(r.text), "不得再出现旧样本数");
	// 结构性边界仍须在（它不因实现改进而变假）。
	assert.match(r.text, /未命中不代表没有同类教训/, "结构性边界须保留");
});

test("数据侧实测值须与当前实现一致（症状→自身召回）", async () => {
	const { recallForAction } = await import("../lib/source-recall.js");
	const { loadFacts } = await import("../lib/source-recall.js");
	const facts = await loadFacts(join(ROOT, "ldvh-base"));
	const pitfalls = facts.filter((f) => f.type === "pitfall" && f.status === "active");
	assert.ok(pitfalls.length > 0, "应有 active Pitfall");

	// 用**症状段**（body 的「## 症状」首句），不用 scope——用 scope 查会靠 scope
	// 命中自己，是循环自证。
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
	// 声明值须与实际相符（允许将来实现变化时更新两侧，但不能只改一侧）。
	// 用一个能命中 token 的查询——`action: "x"` 会走 no_tokens 短路，返回不含 limitations。
	const probe = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 1 });
	assert.ok(probe.limitations !== undefined, "探测查询须返回 limitations");
	const declared = probe.limitations.measuredSymptomSelfRecall;
	assert.equal(declared.total, total, "声明的 total 须与实际样本数一致");
	assert.equal(declared.hits, hit, "声明的 hits 须与实际命中数一致");
});

test("命中理由须排在路径之前（路径对人零信息量，却是读者最先读到的）", async () => {
	// 实测缺陷（2026-10-24）：单条规范卡 114 字符里路径占 67（59%），且路径排在
	// 命中理由之前——读者须先读完 `ldvh-base/pitfalls/pitfall-86f03312-…md`
	// 才看到「这条为什么相关」。而路径里是 UUID，对人零信息量。
	// 规范（02 §9.1 F2）要求的是「候选卡、命中依据、有界确定性摘录」，本无路径义务。
	// 修正后顺序：标题 → **命中理由** → 摘录 → 路径（路径仍保留供打开文件）。
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名",
		projectRoot: ROOT,
		limit: 2,
	});
	assert.equal(r.inject, true);

	const specLine = r.text.split("\n").find((l) => l.startsWith("- ") && l.includes("—"));
	assert.ok(specLine !== undefined, "应有规范卡行");
	const reasonAt = specLine.indexOf("— ");
	const pathAt = specLine.indexOf("（specs/");
	assert.ok(reasonAt > 0 && pathAt > 0, "行内须同时有命中理由与路径");
	assert.ok(reasonAt < pathAt, `命中理由须在路径之前：理由@${reasonAt} 路径@${pathAt}`);

	const factLine = r.text.split("\n").find((l) => l.startsWith("- ["));
	assert.ok(factLine !== undefined, "应有事实卡行");
	const fReasonAt = factLine.indexOf("— ");
	const fPathAt = factLine.indexOf("（ldvh-base/");
	assert.ok(fReasonAt < fPathAt, `事实卡的理由也须在路径之前：理由@${fReasonAt} 路径@${fPathAt}`);
});

test("规范侧有命中却返回 0 时，归因须指向预算而非条数（原只查事实侧）", async () => {
	// 实测缺陷（2026-10-24，第 68 轮）：`oneSourceEmpty` 只检查事实侧
	// （`factsReturned === 0`），**漏了规范侧**。当规范侧有命中却返回 0
	// （预算按 60/40 分配、规范配额放不下任何一条）时，渲染会报
	// 「受条数上限（limit=99）限制」——而 limit=99 根本不构成限制，属**归因错误**。
	//
	// 实测复现：limit=99、budgetBytes=1200 → specHits=12、specsReturned=0、
	// factsReturned=1、used=899/1200。正确归因是「受预算限制」。
	// **前提变更说明**（2026-10-24 第 69 轮）：预算估算从「数据对象 JSON 大小」
	// 改为「渲染行字节数」后，预算分配变得合理，规范侧不再轻易返回 0——
	// 原先 `budgetBytes: 1200` 能构造出 `specsReturned=0`，现在会返回 2 条。
	//
	// 但 `oneSourceEmpty` 的规范侧分支仍是必要的正确性保险（若将来渲染开销或
	// 排序变化使规范侧被挤空，它必须能正确归因）。故这里改用**极小预算**触发
	// 「预算受限」分支，断言不得误报为条数限制——该断言与分支实现无关。
	for (const budgetBytes of [900, 1200]) {
		const r = await buildRecallInjection({
			userText: "把 34 号规范改名成双源召回",
			projectRoot: ROOT,
			limit: 99,
			budgetBytes,
		});
		assert.equal(r.inject, true, `预算 ${budgetBytes} 应注入`);
		assert.ok(r.result.counts.specHits > 0, "前提：规范侧确有命中");
		assert.ok(
			!/受条数上限/.test(r.text),
			`limit=99 不构成限制，不得误报条数限制（预算 ${budgetBytes}）；实际：${r.text.slice(-120)}`,
		);
	}
});

test("注入文本的实际字节数不得超预算（10:241「未超 LDVH 侧常量预算」）", async () => {
	// 实测缺陷（2026-10-24，第 69 轮）：`source-recall.js` 用 `JSON.stringify(item)`
	// 估预算——那是**整个候选对象**（含 path/absolutePath/fingerprint/matchTierMeaning），
	// 而渲染出的卡片只有它的约 1/9。实测单条规范候选 JSON 881 字节、渲染卡片约 100 字节；
	// 预算报 1780 而实际注入 1103。更严重的是相反方向：只按候选行估、不预留渲染固定
	// 开销（标题＋候选声明＋能力边界＋分段标题，约 720 字节）时，预算 2400 实际注入
	// 3093 字节，**超 29%**——直接违反 10:241。
	//
	// 本用例钉住最终性质：**实际注入的字节数 ≤ 预算**。这条与实现细节无关，
	// 无论怎么改估算方式都必须成立。
	const budgets = [800, 900, 1200, 1600, 2000, 2400, 3000, 4000];
	for (const budgetBytes of budgets) {
		const r = await buildRecallInjection({
			userText: "把 34 号规范改名成双源召回",
			projectRoot: ROOT,
			limit: 99,
			budgetBytes,
		});
		if (!r.inject) continue;
		const actual = Buffer.byteLength(r.text, "utf8");
		assert.ok(
			actual <= budgetBytes,
			`预算 ${budgetBytes} 字节，实际注入 ${actual} 字节，超 ${actual - budgetBytes}`,
		);
	}
});
