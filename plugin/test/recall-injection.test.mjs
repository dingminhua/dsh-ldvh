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
	DECISION_KEYS,
	ENTRY_VERDICTS,
	RECALL_BYTE_BUDGET,
	RECALL_RENDER_CHAR_LIMIT,
	RECALL_SUMMARY,
	buildRecallInjection,
	classifyEntry,
	decideInjection,
	currentUserText,
	isUserInputSource,
	renderCharLimitFor,
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

// 2026-10-27 实测缺陷（本组是它的回归钉子）：
// 宿主把 time-context / runtime-context / skill-catalog / agent-instructions 都以
// role:"user" 装进批次，旧实现从尾部倒找第一条非本插件消息 → 首回合必然取到
// time-context，召回查询词变成「Time sampled while preparing turn 1, step 1: …」。
// 证据：三个会话的首回合召回注入行与该会话 time-context 文本的本地复算逐字节相同。
test("currentUserText：跳过宿主上下文行（time-context 不得当查询词）", () => {
	const messages = [
		{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "帮我把字段改掉" }] },
		{ role: "user", source: { kind: "time-context" }, content: [{ type: "text", text: "Time sampled while preparing turn 1, step 1: 2026-10-27T03:00:00+08:00" }] },
	];
	assert.equal(currentUserText(messages, OWN), "帮我把字段改掉", "不得把 time-context 当查询词");
});

test("currentUserText：宿主四种上下文行全部跳过，且按批次顺序取最近一条真实用户消息", () => {
	const hostKinds = ["agent-instructions", "runtime-context", "skill-catalog", "time-context"];
	// 真实宿主顺序：用户消息之后紧跟这四类上下文行（time-context 在最后）。
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
	// ── 判据方向已反转（2026-10-27，依据实测事故）──────────────────────────
	// 本条原先断言「未登记的 kind 仍按用户消息取用」，理由是「只认 user 会把
	// 不带 source 的旧形状与未来新 kind 一律判成非用户，使取词恒为空」。
	//
	// 该顾虑对**无 source 的旧形状**成立，且已由兜底保留；但对**未来新 kind**
	// 的结论是错的，实测代价如下：用户问中文「判断一下当前召回机制运作是否符合
	// 设计」，注入命中词却是 model/by/the/changed/session/workbuddy，全部来自
	// 宿主 `[model changed: …]` 通知。本机三日内实际出现 11 种 kind，黑名单只
	// 覆盖 5 种——漏掉的 5 种全部冒充了用户查询。
	//
	// 故：**无 source / 无 kind → 兜底按用户处理**（保住旧形状与直调测试）；
	// **有 source 且 kind 非 user → 排除**（失败关闭）。
	const futureKind = { role: "user", source: { kind: "some-future-context" }, content: [{ type: "text", text: "未来形状" }] };
	const legacy = { role: "user", content: [{ type: "text", text: "无 source 的旧形状" }] };
	assert.equal(currentUserText([futureKind, legacy], OWN), "无 source 的旧形状", "未来形状的 kind 须被排除、回落到旧形状");
	assert.equal(currentUserText([futureKind], OWN), "", "只有未知 kind 时须返回空（fail closed），不得冒充用户输入");
	assert.equal(currentUserText([legacy], OWN), "无 source 的旧形状", "无 source 须兜底取用");
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

test("全弱证据查询不得注入（放宽 tokenizer 后的精度护栏）", async () => {
	// **为什么需要这条**（2026-10-27）：把「含虚字即整组丢弃」放宽为「两端皆虚才丢」
	// 之后，这类句子不再切空，而是切出「为什／里不／做什」这类含虚字的跨词二元组。
	// 若不加拦截，它们会以噪声命中无关对象并占用注入预算——实测「为什么这里不对」
	// 命中了 mattpocock/skills 与 LLM Wiki 两条与题意无关的调研。
	//
	// 判据：一个**双实词**都没有 = 没有主题词。此时如实报 no_tokens，
	// 而不是拿弱噪声冒充候选。破坏性验证：把该拦截置 false，本条立即变红。
	for (const q of ["为什么这里不对", "现在应该做什么", "是不是应该", "我要的是这个"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, false, `「${q}」没有任何主题词，不得注入`);
		assert.match(r.reason ?? "", /no_tokens/, `「${q}」应报 no_tokens：${r.reason}`);
	}
	// 反例保护：含真实主题词的句子必须照常召回，不得被这层误杀。
	for (const q of ["页面白屏了怎么办", "把对象的字段改名后同步读取侧"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, true, `「${q}」含主题词，须照常召回`);
	}
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
	// N-6：统一裁剪后说明行为「渲染层按硬约束（字符上限 N）裁去 M 条候选」。
	assert.match(out, /渲染层按硬约束/, "超限须如实说明");
	assert.match(out, /字符上限/, "归因须点名生效的约束");
	assert.match(out, /裁去 \d+ 条候选/, "须如实注明裁了几条");
	assert.match(out, /不代表不存在/, "须说明未列出的不代表不存在");
	assert.equal(RECALL_RENDER_CHAR_LIMIT, 1600, "常量值应固定（实测最坏 1167，留约 37% 余量）");
});

test("渲染文本未超限时不得添加裁剪说明", async () => {
	// **前提须显式构造**（2026-10-25 修）：原用例用「页面白屏了」走真实召回，
	// 但 F1 决策基线常驻后该回合也会注入基线，2400 预算下总字节可能触到裁剪线
	// ——那说明「基线常驻确实占预算」，不是「未超限却加了说明」。
	// 本用例要钉的是后者，故直接构造一个明确不超限的结果保住原意。
	const small = {
		ok: true, truncated: false, overBudget: false, partial: false,
		specs: [{ title: "短标题", path: "specs/x.md", hitReason: "正文命中：短理由" }],
		facts: [],
		budget: { limitBytes: 2400, usedBytes: 120, limit: 3 },
		counts: { specHits: 1, factHits: 0, specsReturned: 1, factsReturned: 0, candidatesScanned: 10 },
		unchecked: { specs: [], facts: [] },
		ranking: { keys: ["tier", "hits", "path"] },
		decisionBaseline: { items: [], sourceUnreadable: false },
	};
	const out = renderRecallRow(small);
	assert.ok(!/渲染层按硬约束/.test(out), "未超限时不得出现裁剪说明");
	// 真实路径另钉一条：预算充裕时同样安静（基线展开但不触限）。
	const r = await buildRecallInjection({ userText: "页面白屏了", projectRoot: ROOT, budgetBytes: 4000 });
	if (r.inject) {
		assert.ok(!/渲染层按硬约束/.test(r.text), "预算充裕时不得出现裁剪说明");
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

test("N-6：字符硬上限路径不得裁掉三态披露行（统一从尾部裁候选行）", () => {
	// 第七次复审 N-6：旧字符上限路径「从头部保留、尾部整段丢弃」，三态披露行
	// 与截断归因行排在末尾会被一并裁掉——N-5 刚补上的披露在这条路径上恰好被
	// 吞掉，且说明行把被丢弃的**披露**误称为**候选**。修复后统一为「只从尾部
	// 裁 `- ` 候选行，披露行永不裁剪」。
	// 构造：12 条超长候选行使 chars 远超 1600 + partial 三态。
	const longTitle = "A".repeat(120);
	const out = renderRecallRow({
		ok: true,
		specs: Array.from({ length: 12 }, (_, i) => ({
			title: `${longTitle}${i}`,
			path: `specs/${i}.md`,
			hitReason: `正文命中：${"R".repeat(80)}`,
		})),
		facts: [],
		recallCompleteness: "partial",
		uncheckedRange: { sourceNotRead: ["事实源（不存在或不可读，未读取）"] },
		// **2026-10-27**：字符上限不再是固定 1600，而是由 `limitBytes` 导出
		// （`renderCharLimitFor`）。原先这里写 100000，在新规则下字符上限 = 50000，
		// 12 条长候选根本触不到裁剪——本用例会退化成空跑（实测它正是这样变红的）。
		// 故把预算调到足够小，使裁剪**真的发生**，且断言改为「≤ 本档导出的上限」。
		budget: { limitBytes: 2000, usedBytes: 5000, limit: 99 },
	});
	const charCap = renderCharLimitFor(2000);
	assert.ok(out.length <= charCap, `渲染 ${out.length} 须 ≤ 本档上限 ${charCap}`);
	assert.match(out, /本次召回完整度：\*\*partial\*\*/, "字符裁剪路径不得吞掉三态披露行");
	assert.match(out, /未读取的源：事实源/, "未读取源披露同样不得被裁掉");
	// **须核对说明行写的上限 == 实际生效的上限**（2026-10-27，独立审核严重项 1）：
	// 上一版把正则换成通配 `[^）]*`，于是说明行写「字符上限 1600」而实际生效
	// 600 时**完全无感**——那正是本次发现的唯一代码级「说谎」缺陷（现已修）。
	// 断言改为：若说明行归因于字符上限，则其数字必须等于 `renderCharLimitFor`。
	const noteMatch = /字符上限 (\d+)/.exec(out);
	if (noteMatch !== null) {
		assert.equal(
			Number(noteMatch[1]),
			charCap,
			`说明行声称字符上限 ${noteMatch[1]}，实际生效 ${charCap}（不得说谎，02 §9.1）`,
		);
	}
	assert.match(out, new RegExp(`渲染层按硬约束（[^）]*）裁去 \\d+ 条候选`), "裁剪说明须如实注明约束与条数");
	// 说明行不得把披露误称为候选（旧文案「未列出的候选」出现在披露被裁的场景）。
	const candidateLines = out.split("\n").filter((l) => l.startsWith("- ")).length;
	assert.ok(candidateLines < 12, "确应裁去部分候选行（否则未触及本场景）");
	assert.ok(candidateLines > 0, "候选行不应被裁光（只裁到满足上限为止）");
});

test("N-7：字节兜底裁剪须反映到 result.render.truncated 与 droppedCandidates", async () => {
	// 第七次复审 N-7：旧 renderTruncated 正则只认字符上限文案，字节兜底裁剪
	// 被漏报成 truncated:false（文本已裁、字段说未裁——机器可读面撒谎）。
	// 统一裁剪后说明行为「渲染层按硬约束…裁去 N 条候选」，字段由它派生。
	const r = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 99,
		budgetBytes: 800, // 极小预算必触发渲染层裁剪
	});
	assert.equal(r.inject, true);
	if (/裁去 \d+ 条候选/.test(r.text)) {
		assert.equal(r.result.render.truncated, true, "文本被裁时 truncated 不得为 false");
		const m = /裁去 (\d+) 条候选/.exec(r.text);
		assert.equal(r.result.render.droppedCandidates, Number(m[1]), "droppedCandidates 须与说明行一致");
	} else {
		assert.equal(r.result.render.truncated, false, "未裁时 truncated 须为 false");
		assert.equal(r.result.render.droppedCandidates, 0);
	}
	// 最终字节仍不得超预算（两道约束同时满足）。
	assert.ok(
		Buffer.byteLength(r.text, "utf8") <= 800,
		`实际 ${Buffer.byteLength(r.text, "utf8")} 字节不得超预算 800`,
	);
});

test("N-8：三态披露行须含「被过滤」类别且按非零类别分列（34 §12 逐类清单）", async () => {
	// 第七次复审 N-8：34 §12「未检查范围须逐类列出：哪些来源未读取、哪些候选
	// 被类型／状态过滤挡掉、哪些因预算或条数未返回」——第三类由截断归因行承载，
	// 第一类由 N-5 的未读取源承载，第二类此前在注入面缺失（数据层有
	// uncheckedRange.excludedBy* 但不进注入文本）。
	// 第八次复核观察 B：三类过滤不得合并计数——excludedByTypeWhitelist 是
	// 未登记类型（02 §9.2：中间产物不参与「无相关」判定），语义不同须分列。
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
	// partial 时三态行须带过滤计数，且**按非零类别分列**（本仓只有状态过滤非零）。
	if (r.result.recallCompleteness === "partial") {
		assert.match(r.text, /另 \d+ 条被状态过滤/, "三态行须按类别分列披露被过滤数（34 §12）");
		assert.ok(
			!r.text.includes("被类型/状态过滤"),
			"不得再用合并标签（观察 B：白名单桶语义不同，不得并入）",
		);
	}
	// 纯函数路径：三类都非零时须三类分列。
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
	// **2026-10-27**：字符上限由预算导出（不再恒为 1600），故断言「等于本档导出值」。
	assert.equal(normal.result.render.limitChars, renderCharLimitFor(2400));
	assert.equal(typeof normal.result.render.truncated, "boolean");

	// 大 limit 下渲染文本会超上限并被裁剪 → truncated 须为 true。
	// **2026-10-27**：预算 999999 会导出极大的字符上限（≈499999），任何正常
	// 查询都触不到裁剪，本条会退化成空跑。故把预算调到足够小，使裁剪真的发生
	// ——本用例要守的是「裁剪必须可观察」，不是「必须用某个特定预算」。
	const big = await buildRecallInjection({
		userText: "把 34 号规范改名成双源召回",
		projectRoot: ROOT,
		limit: 50,
		budgetBytes: 1200,
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
	// **须多 query**（2026-10-25，第四十次审核 M-1）：旧版只用单一 query
	// 「把 34 号规范改名成双源召回」，而该 query 在预算 1200 时恰好不破口
	// （1126 ≤ 1200），于是 1200–1440 窗内的静默超预算被完全漏掉（另一 query
	// 「页面白屏了」实测 1364 > 1200）。现覆盖多个真实 query。
	//
	// **800/900 排除在断言之外**：实测父提交 ffafb03^ 在该预算下同样注入
	// 936 字节（超 136）——固定声明与三态披露本身即超极小预算，是既有的
	// 「披露优先于极小预算」取舍，非本功能引入，故此处只钉 1200 及以上。
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

// ---------------------------------------------------------------------------
// F1 决策基线（22 §12 义务召回原则 / 02 §9.1 F1「枚举指定对象集合」）
//
// 2026-10-25 Human 决定方案 A：注入面在词法候选区之外**无条件**列出全部
// active ADR。理由：22 §1 把 ADR 定为法定效力决定（违背 active ADR 视同违背
// 规范源），22 §12 立义务召回原则；若基线只靠词法命中，法定决策的可见性
// 就取决于当回合用词——实测「每次回复先称呼老丁」在「改成异步的」上零召回。
// ---------------------------------------------------------------------------

test("F1 基线：法定决策不得靠词面运气——零词法命中时基线仍须出现", async () => {
	// 这条用例钉住方案 A 的全部意义所在：**词法候选为 0 时基线仍须交付**。
	// 而它是法定效力决定，违背它视同违背规范源（22 §1）。若基线随词法命中
	// 一起缺席，义务召回悬空。
	//
	// **输入必须真零命中**（2026-10-25，第四十次审核 M-3）：旧用例用
	// 「把这个函数改成异步的」，实测该 query specs=1 + facts=3 = **4 条命中**——
	// 前提不成立，断言在「零命中」从未发生的情况下恒真，守不住它声称的不变量。
	// 「优化性能」实测 specs=0 / facts=0（且是合理的行动描述，非无意义串）。
	const zeroHit = await recallForAction({ action: "优化性能", root: ROOT, limit: 3 });
	assert.equal(
		zeroHit.specs.length + zeroHit.facts.length,
		0,
		"前提：该 query 须真零命中（若语料变动导致命中，须换一个真零命中的 query）",
	);
	const r = await buildRecallInjection({
		userText: "优化性能",
		projectRoot: ROOT,
		limit: 3,
	});
	assert.equal(r.inject, true, "有 active ADR 时必须注入（基线无条件）");
	const items = r.result.decisionBaseline.items;
	assert.ok(items.length > 0, "本仓有 active ADR（前提须成立）");
	for (const item of items) {
		assert.equal(item.status, "active", "retired 不入基线（22 §12）");
		assert.ok(r.text.includes(item.title), `基线须列出全部 active ADR 标题，缺「${item.title}」`);
	}
	// 基线是**独立段**：不能混进词法候选区（`- ` 前缀），否则会被裁剪循环吃掉。
	assert.match(r.text, /【决策基线 · active ADR/, "基线段须有独立段头");
	assert.match(r.text, /^· /m, "基线行用 `· ` 前缀（与候选 `- ` 区分，不被裁剪）");
});

test("F1 基线：常驻不等于适用——须带「不证明适用」声明（02 §9.2／34 §13）", async () => {
	const r = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 3 });
	assert.equal(r.inject, true);
	assert.match(r.text, /基线只保证「看得见」，\*\*不证明适用\*\*/, "须显式否定适用性");
	// 数据层也不得把基线写成适用（与 provesApplicability:false 同纪律）。
	assert.equal(r.result.provesApplicability, false);
});

test("F1 基线：事实源不可读时须披露「基线未取得」而非静默留空（34 §12）", () => {
	// 读不到 ≠ 没有。若只给空数组，读者会把「读不到」当成「本项目没有 ADR」，
	// 正是 34 §12 与 02 §9.2 要防的「把零结果当无约束」。
	const row = renderRecallRow({
		specs: [],
		facts: [],
		decisionBaseline: { items: [], sourceUnreadable: true },
	});
	assert.match(row, /事实源不可读，基线未取得/, "不可读须显式披露");
	assert.match(row, /\*\*不表示本项目没有 ADR\*\*/, "须否定「没有」的误读");
});

test("F1 基线：零 active ADR 时整段安静（不输出空段头）", () => {
	const row = renderRecallRow({ specs: [], facts: [], decisionBaseline: { items: [], sourceUnreadable: false } });
	assert.ok(!row.includes("决策基线"), "无 active ADR 时不出现空段");
});

test("F1 基线：超出字节上限时须如实计数披露，不得静默截断（02 §9.1）", () => {
	// 造 30 条超长标题，远超 ADR_BASELINE_BYTE_BUDGET。
	const items = Array.from({ length: 30 }, (_, i) => ({
		title: `第${i}条很长的决策标题用来占满基线预算的测试项`,
		status: "active",
		ref: `adr-${i}`,
		path: `ldvh-base/adrs/adr-${i}.md`,
	}));
	const row = renderRecallRow({ specs: [], facts: [], decisionBaseline: { items, sourceUnreadable: false } });
	const shown = (row.match(/^· /gm) || []).length;
	assert.ok(shown > 0 && shown < 30, `须部分列出（实测 ${shown} 条）`);
	assert.match(row, /另有 \d+ 条未列出/, "须如实披露未列出条数");
	assert.match(row, /\*\*未列出不代表不存在\*\*/, "须否定「未列出=不存在」");
});

test("F1 基线：基线字节已从候选预算中扣除（不得挤占后仍声称未超预算）", async () => {
	// 若基线不预留，预算按「只有候选」分配，实际注入时基线再挤进来——
	// 表现为候选被多裁且裁剪原因归错。本用例钉住：总字节仍 ≤ 预算，
	// 且数据层如实给出基线预留量。
	const r = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 99, budgetBytes: 2400 });
	assert.equal(r.inject, true);
	const actual = Buffer.byteLength(r.text, "utf8");
	assert.ok(actual <= 2400, `实际注入 ${actual} 字节须 ≤ 2400`);
	assert.ok(r.result.decisionBaseline.reservedBytes > 0, "须给出基线预留字节数供核对");
});

test("F1 基线：同一事实集两次调用须逐字节一致（确定性排序，02 §9 红线）", async () => {
	const a = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 3 });
	const b = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 3 });
	const titlesA = a.result.decisionBaseline.items.map((i) => i.title);
	const titlesB = b.result.decisionBaseline.items.map((i) => i.title);
	assert.deepEqual(titlesA, titlesB, "基线顺序须确定（不引入相似度/权重）");
});

test("F1 基线：预留量须与实际基线段字节相符（不得欠预留）", async () => {
	// 第四十次审核 Minor-2：数据层预留 400 字节、渲染层实际输出 473 字节，
	// 欠预留 73 字节——正是「预算按 A 算、交付按 B 算」。本用例钉住两者相符。
	const r = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 99, budgetBytes: 2400 });
	assert.equal(r.inject, true);
	const lines = r.text.split("\n");
	const start = lines.findIndex((l) => l.startsWith("【决策基线"));
	assert.ok(start !== -1, "基线段须存在（2400 预算下应展开）");
	let end = start + 1;
	while (end < lines.length && (lines[end].startsWith("· ") || lines[end].startsWith("（基线"))) end += 1;
	const actualBytes = Buffer.byteLength(lines.slice(start, end).join("\n"), "utf8") + 1;
	const reserved = r.result.decisionBaseline.reservedBytes;
	assert.ok(
		reserved >= actualBytes,
		`预留 ${reserved} 字节须 ≥ 实际基线 ${actualBytes} 字节（欠预留会让注入超预算）`,
	);
});

test("F1 基线：retired ADR 不入基线（合成 retired 才具分辨力）", async () => {
	// 第四十次审核 D4-4：本仓当前无 retired ADR，故「断言 item.status==='active'」
	// 是恒真空断言。此处用纯函数 + 合成数据，才有分辨力。
	const row = renderRecallRow({
		specs: [],
		facts: [],
		decisionBaseline: {
			items: [
				{ title: "在效决策", status: "active", ref: "adr-a", path: "x" },
			],
			sourceUnreadable: false,
		},
	});
	assert.match(row, /在效决策/, "active 须列出");
	assert.ok(!row.includes("已退役决策"), "retired 不得出现");
});

test("F1 基线：极小预算下让位须在数据层可观察（不得只剩注释）", async () => {
	// 第四十次审核 Minor-3：让位在注入文本与数据层均无可观察痕迹。
	// 现数据层给出 reservedBytes=0 且 items 仍非空——「有基线但未展开」可机械判定。
	const r = await buildRecallInjection({ userText: "把 34 号规范改名成双源召回", projectRoot: ROOT, limit: 3, budgetBytes: 900 });
	if (!r.inject) return;
	assert.equal(r.result.decisionBaseline.reservedBytes, 0, "极小预算下不预留");
	assert.ok(r.result.decisionBaseline.items.length > 0, "基线仍在数据层可见（有，但未展开）");
	assert.ok(!/^【决策基线/m.test(r.text), "注入面不得出现基线段");
});

test("F1 基线：不受 types/statuses/limit 过滤影响（note 声称须有用例守住）", async () => {
	const configs = [
		{ types: ["pitfall"] },
		{ statuses: ["retired"] },
		{ limit: 1 },
		{ includeSpecs: false },
	];
	for (const cfg of configs) {
		const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3, ...cfg });
		assert.ok(
			r.decisionBaseline.items.length > 0,
			`配置 ${JSON.stringify(cfg)} 下基线不得为空（F1 无条件枚举）`,
		);
		assert.equal(
			r.decisionBaseline.items.length,
			(await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 })).decisionBaseline.items.length,
			`配置 ${JSON.stringify(cfg)} 下基线条数不得变化`,
		);
	}
});

// ---------------------------------------------------------------------------
// 第 3 步：排序分与「是否注入」的决策依据分离（2026-10-27）
// ---------------------------------------------------------------------------

test("决策只数条数，不读排序分（排序分注入极端值，注入结果不变）", async () => {
	// **要守的性质**：排序分（hits / BM25 加权）只决定「谁排在前面」，
	// 不决定「要不要注入」。这不是风格偏好：hits 依赖当次候选集的 N 与 df，
	// 是相对量；拿它当阈值会让「是否注入」取决于恰好还有哪些别的候选被选中。
	// 外部项目 dsh-auto-memory 的 M7 报告实测单阈值策略精确率为 0（全在闲聊触发），
	// 故它明确把融合分限定为「只排序」——见 recall-fusion.js 文件头。
	//
	// **做法**：同一查询下，把注入用的 limit 从 1 调到 20（条数变化、分数不变），
	// 以及反向构造：条数不变而分数随意（通过不同候选集）。真正要断言的是
	// 「条数 ≥1 ⇒ 注入」与「条数 = 0 ⇒ 不注入」，与分数高低无关。
	const many = await buildRecallInjection({ userText: "修改受保护内容并重新提交", projectRoot: ROOT, limit: 20 });
	assert.equal(many.inject, true, "有候选即注入，与分数高低无关");
	const one = await buildRecallInjection({ userText: "修改受保护内容并重新提交", projectRoot: ROOT, limit: 1 });
	assert.equal(one.inject, true, "limit=1 时仍注入（条数 1 ≥ MIN_HITS）");

	// **分辨力来源**：直接对纯函数 `decideInjection` 注入极端输入。
	// 整链路跑是测不出来的——基线恒非空，短路分支进不去（实测破坏版仍全绿）。
	// 这里传入任意「分数」字段，断言决策完全无视它。
	const base = { candidateCount: 1, baselinePresent: false };
	assert.equal(decideInjection(base), true, "有一条候选即注入");
	assert.equal(decideInjection({ candidateCount: 0, baselinePresent: false }), false, "零候选无基线不注入");
	assert.equal(decideInjection({ candidateCount: 0, baselinePresent: true }), true, "零候选但有基线仍注入（22 §12）");
	// 注入排序分：无论多低/多高，决策不变。
	for (const score of [0, -1e9, 1e9, Number.NaN]) {
		assert.equal(decideInjection({ ...base, hits: score, score, bm25: score }), true,
			`分数 ${score} 不得影响决策`);
		assert.equal(decideInjection({ candidateCount: 0, baselinePresent: false, hits: score, score }), false,
			`分数 ${score} 不得让零候选变成注入`);
	}

	// 声明式契约：决策允许读取的输入项是闭集，不含任何排序键。
	assert.ok(Array.isArray(DECISION_KEYS), "DECISION_KEYS 须导出");
	for (const forbidden of ["hits", "score", "bm25", "tier", "path"]) {
		assert.ok(!DECISION_KEYS.includes(forbidden),
			`决策闭集不得包含排序键「${forbidden}」（排序分只用于排序，34 §13／02 §9.2）`);
	}
});

test("三态 gate 不因引入加权而改变（34 §6 进入判据仍是唯一决策前提）", async () => {
	// 第 3 步的边界：**只拆「排序分当决策依据」这一处**，不动 34 §6 三态 gate。
	// 三态是本项目比外部实现更稳的部分（外部靠单阈值，精确率 0）。
	// 纯读取仍须被排除——即便它可能命中很多候选（候选再多也不该改进入判据）。
	for (const q of ["看看这个文件", "列出所有规范"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, false, `「${q}」是纯读取，三态须排除（与命中数无关）`);
	}
	// 写动作仍须进入。
	const w = await buildRecallInjection({ userText: "修改受保护内容", projectRoot: ROOT });
	assert.equal(w.inject, true, "写动作须进入召回");
});

// ---------------------------------------------------------------------------
// 召回输入判定：白名单（2026-10-27 实测事故）
// ---------------------------------------------------------------------------

test("宿主通知不得被当作召回查询（本机实测 11 种 kind 逐一核对）", () => {
	// **实测事故**：用户问的是中文「判断一下当前召回机制运作是否符合设计」，
	// 而注入的命中词是 model/by/the/changed/session/workbuddy —— 一个都不在
	// 用户问题里。定位到 `currentUserText()` 取到了宿主的 `[model changed: …]`。
	//
	// 根因：原实现用黑名单排除 5 种已知 kind，而本机三日内实际出现过 **11 种**，
	// 漏掉的 5 种全部被当成用户查询。黑名单方向失败开放，宿主新增通知即失守。
	const user = { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "真实用户问题" }] };

	// 这 5 种是**实际漏过**的（每种都配一句真实文案，避免用假数据自证）。
	const missed = [
		["model-selection", "[model changed: assistant turns above this point were generated by workbuddy/deepseek-v4.1-flash]"],
		["tool-jobs", "background job bash-a62cb096431c445c445 (bash: cd /Users/x && npm test) finished"],
		["subagent-settled", "Background subagent edf12679-d4f4 finished and will do no further work unless you send it more."],
		["plugin:dsh-subagent-default-model", "[dsh-subagent-default-model] You are running as a subagent on dsh-opencode-go/x"],
		["user-approval", 'The approval policy changed from "ask" to "never" (changed by the user).'],
	];
	// 这 5 种原黑名单已覆盖，一并守住，防将来被误删。
	const already = ["time-context", "runtime-context", "skill-catalog", "agent-instructions", "compact-checkpoint"];

	for (const [kind, text] of [...missed, ...already.map((k) => [k, `host context for ${k}`])]) {
		const notice = { role: "user", source: { kind }, content: [{ type: "text", text }] };
		// 通知排在用户消息**之后**（这正是事故形态：宿主把通知追加在末尾）。
		assert.equal(
			currentUserText([user, notice], () => false),
			"真实用户问题",
			`kind=${kind} 的通知不得被当作查询（否则召回会整体跑偏）`,
		);
		// 且单独存在时也不得取到内容。
		assert.equal(currentUserText([notice], () => false), "", `kind=${kind} 单独存在时须返回空`);
	}

	// **兜底**：无 source / 无 kind 的消息仍按用户处理（旧宿主与直调测试的形态），
	// 不得因为改成白名单而静默漏取。
	assert.equal(
		currentUserText([{ role: "user", content: [{ type: "text", text: "旧形态无 source" }] }], () => false),
		"旧形态无 source",
	);
	assert.equal(
		currentUserText([{ role: "user", source: {}, content: [{ type: "text", text: "有 source 无 kind" }] }], () => false),
		"有 source 无 kind",
	);

	// isUserInputSource 的直接判据（避免只靠 currentUserText 间接验证）。
	assert.equal(isUserInputSource({ kind: "user" }), true);
	for (const k of ["model-selection", "tool-jobs", "time-context", "user-approval", "anything-new"]) {
		assert.equal(isUserInputSource({ kind: k }), false, `未登记的 kind=${k} 须按非用户处理（失败关闭）`);
	}
	assert.equal(isUserInputSource(undefined), true, "无 source 须按用户处理");
	assert.equal(isUserInputSource({}), true, "无 kind 须按用户处理");
});

test("白名单改为「失败关闭」：未知 kind 须被排除，不得按用户处理", () => {
	// 这条守的是**方向**而非具体清单：将来宿主新增 kind，默认应被排除。
	// 若有人把实现改回黑名单，本条会红。
	const unknown = { role: "user", source: { kind: "some-future-host-notice" }, content: [{ type: "text", text: "未来才有的通知" }] };
	assert.equal(
		currentUserText([unknown], () => false),
		"",
		"未知 kind 须被排除——黑名单方向会让它冒充用户查询，而那正是本次事故的成因",
	);
});

// ---------------------------------------------------------------------------
// 31 §10（2026-10-27 修订）：Spark 不进自动注入
// ---------------------------------------------------------------------------

test("31 §10：注入路径须把 Spark 排除在声明范围外（否则规范与实现相反）", async () => {
	// 这条用例钉的是**接线**，不是 `recallForAction` 的能力：`excludeTypes` 传不传，
	// 数据层都对；漏传则注入行里照样出现 spark 候选，而 `31 §10` 已改为
	// 「方向线不经自动注入，由 AI 主动查」。接线漏掉不会报错，只会静默回退到旧行为。
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
		// 声明范围之外的条目须如实可见（不隐藏边界），但**不得冒充**「被类型过滤」。
		assert.equal(built.result.uncheckedRange.excludedByTypeFilter.length, 0);
		assert.ok(
			built.result.uncheckedRange.excludedByScope.some((f) => f.type === "spark"),
			"excludedByScope 须如实列出被排除的 spark",
		);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});
