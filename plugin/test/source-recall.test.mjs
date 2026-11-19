
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import {
	DEFAULT_STATUSES_BY_TYPE,
	INJECTION_EXCLUDED_TYPES,
	REGISTERED_FACT_TYPES,
	REQUIRED_RECALL_TYPES,
	HIGH_DF_RATIO,
	MATCH_TIERS,
	loadFacts,
	loadSpecs,
	matchCandidate,
	recallForAction,
	resolveSpecsRoot,
	tokenize,
	tokenSetOf,
	RECALL_LIMIT_MAX,
	RECALL_LIMIT_MIN,
	INJECTION_BUDGET_TIERS,
	recallLimitForBudget,
	isWeakToken,
	statusRank,
	STRUCTURAL_BARE_QUERY_MAX_TOKENS,
	STRUCTURAL_DEFERRED_TIER,
	compareFactHits,
} from "../lib/source-recall.js";
import { RECALL_RENDER_CHAR_LIMIT, renderCharLimitFor } from "../lib/recall-injection.js";
import { skipWithoutCorpus, seedFactCorpus } from "./helpers.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const joinPath = join;


test("tokenize：ASCII 词与编号保留，长度 < 2 的丢弃", () => {
	const tokens = tokenize("Git Gate pre-commit 03 §10.4 ok a xy");
	assert.ok(tokens.includes("git"));
	assert.ok(tokens.includes("gate"));
	assert.ok(tokens.includes("pre-commit"));
	assert.ok(tokens.includes("03"));
	assert.ok(!tokens.includes("a"), "单字母不应成 token");
});

test("tokenize：中文只取二元组，单字不进匹配集", () => {
	const tokens = tokenize("验证手段");
	assert.deepEqual(tokens.sort(), ["手段", "验证", "证手"].sort());
	assert.ok(!tokens.includes("验"), "单字不得进匹配集");
	assert.ok(!tokens.includes("段"), "单字不得进匹配集");
});

test("tokenize：纯虚字二元组不进匹配集（实测噪声源）", () => {
	const tokens = tokenize("创建一个 Norm 记录方向");
	assert.ok(!tokens.includes("一个"), "「一个」两端都是虚字，命中一切");
	assert.ok(tokens.includes("建一"), "「建一」只有一个虚字，2026-10-27 起保留（跨词噪声的代价小于实词被吞）");
	assert.ok(tokens.includes("创建"), "实义二元组应保留");
	assert.ok(tokens.includes("记录"), "实义二元组应保留");
	assert.ok(tokens.includes("norm"), "ASCII 词应保留");
});

test("tokenize：含单个虚字的二元组须保留（2026-10-27 修正的核心）", () => {
	for (const q of ["是不是应该", "现在应该做什么", "为什么会这样", "能不能再确认一下"]) {
		assert.ok(tokenize(q).length > 0, `「${q}」不得切空`);
	}
	assert.ok(tokenize("页面白屏了怎么办").includes("白屏"), "「白屏」是实词，必须切出");
	assert.ok(tokenize("现在应该做什么").includes("应该"));
});

test("tokenize：整段零 token 时不硬凑，如实返回空", () => {
	const tokens = tokenize("我要的是这个");
	assert.deepEqual(tokens, [], "「我要的是这个」六个字全为虚字，应返回空数组");
	assert.ok(tokens.length === 0, "本条依赖「确实为空」，非空即需重新判断断言形式");
});

test("tokenize：有实词的句子不得因虚字过滤而整段切空", () => {
	for (const q of ["是不是应该", "现在应该做什么", "为什么会这样", "能不能再确认一下"]) {
		assert.ok(tokenize(q).length > 0, `「${q}」含实词，不得切空`);
	}
	assert.ok(tokenize("页面白屏了怎么办").includes("白屏"), "「白屏」是实词，必须切出");
	assert.ok(tokenize("现在应该做什么").includes("应该"));
});

test("tokenize：空串与非字符串返回空数组", () => {
	assert.deepEqual(tokenize(""), []);
	assert.deepEqual(tokenize(null), []);
	assert.deepEqual(tokenize(undefined), []);
	assert.deepEqual(tokenize(123), []);
});


test("loadSpecs：载入规范源，字段与标题行可取", async () => {
	const specs = await loadSpecs(join(ROOT, "specs"));
	const { readdir } = await import("node:fs/promises");
	const onDisk = (await readdir(join(ROOT, "specs"))).filter((f) => f.endsWith(".md"));
	assert.equal(
		specs.length,
		onDisk.length,
		`载入条数须等于盘上载体数（盘上 ${onDisk.length} 份），实际 ${specs.length}`,
	);
	assert.ok(specs.length > 0, "规范源不得为空（否则后续断言全部失去前提）");
	const first = specs[0];
	assert.equal(first.source, "spec");
	assert.ok(typeof first.ref === "string" && first.ref !== "");
	assert.ok(typeof first.title === "string" && first.title !== "");
	assert.ok(Array.isArray(first.headings));
	assert.ok(first.path.startsWith("specs/"));
});

test("loadFacts：载入事实源，类型名取 fact_type_key（不从目录猜单复数）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const facts = await loadFacts(join(ROOT, "ldvh-base"));
	const { readdir } = await import("node:fs/promises");
	const base = join(ROOT, "ldvh-base");
	const dirs = (await readdir(base, { withFileTypes: true }))
		.filter((d) => d.isDirectory())
		.map((d) => d.name);
	let onDisk = 0;
	for (const d of dirs) {
		onDisk += (await readdir(join(base, d))).filter((f) => f.endsWith(".md")).length;
	}
	assert.equal(
		facts.length,
		onDisk,
		`载入条数须等于盘上载体数（盘上 ${onDisk} 份），实际 ${facts.length}`,
	);
	assert.ok(facts.length > 0, "事实源不得为空（否则后续断言全部失去前提）");
	const types = new Set(facts.map((f) => f.type));
	for (const expected of ["friction", "norm", "pitfall", "report", "spark"]) {
		assert.ok(types.has(expected), `应含类型 ${expected}，实际 ${[...types].join(",")}`);
	}
	for (const t of types) {
		if (t === "devlog" || t === "adr") continue;
		assert.ok(
			REGISTERED_FACT_TYPES.includes(t),
			`类型 ${t} 不在已登记闭集内——目录名猜单复数会产生这类值`,
		);
	}
	assert.ok(!types.has("researche"), "不得把 researches 猜成 researche");
	assert.ok(!types.has("spar"), "不得把 sparks 猜成 spar");
});

test("loadFacts：每条都有 status 与 title", async () => {
	const facts = await loadFacts(join(ROOT, "ldvh-base"));
	for (const f of facts.slice(0, 30)) {
		assert.ok(typeof f.status === "string" && f.status !== "", `${f.path} 缺 status`);
		assert.ok(typeof f.title === "string" && f.title !== "", `${f.path} 缺 title`);
	}
});


test("MATCH_TIERS 层号递增，scope 是最精确的一层", () => {
	assert.deepEqual(MATCH_TIERS.map((t) => t.tier), [0, 1, 2, 3, 4]);
	assert.equal(MATCH_TIERS[0].field, "specId");
	assert.equal(MATCH_TIERS[1].field, "scope");
	assert.equal(MATCH_TIERS[4].field, "body");
});

test("matchCandidate：命中 scope 层号最前，命中 title 层号靠后", () => {
	const tokens = tokenize("预检落实记录");
	assert.equal(matchCandidate(tokens, { scope: "预检落实记录的字段与格式" }).tier, 1);
	assert.equal(matchCandidate(tokens, { scope: "", detail: "", title: "预检落实记录说明", body: "" }).tier, 3);
});

test("matchCandidate：无关文本返回 null", () => {
	const tokens = tokenize("预检落实记录");
	assert.equal(matchCandidate(tokens, { scope: "天气预报", detail: "无", title: "午餐", body: "晴" }), null);
});

test("matchCandidate：hitReason 列出命中词，不列全文", () => {
	const m = matchCandidate(tokenize("预检落实记录"), { scope: "预检落实记录的字段与格式", title: "", body: "" });
	assert.match(m.hitReason, /预检/);
	assert.ok(m.hits >= 1);
});


test("recallForAction：缺动作描述即拒绝", async () => {
	const r = await recallForAction({ root: ROOT });
	assert.equal(r.ok, false);
	assert.equal(r.error.code, "recall/action_required");
});

test("recallForAction：返回 specs 与 facts，且不声称适用（34 §13）", async () => {
	const r = await recallForAction({ action: "创建 Norm 记录一个方向约束", root: ROOT });
	assert.equal(r.ok, true);
	assert.ok(Array.isArray(r.specs));
	assert.ok(Array.isArray(r.facts));
	assert.equal(r.provesApplicability, false, "召回命中不等于适用（34 §13）");
	assert.match(r.coverage, /deterministic/);
	assert.match(r.coverage, /may miss/);
});

test("recallForAction：经验（Pitfall）能被召回到", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await recallForAction({
		action: "验证手段在骗我，校验假定与语义不对应",
		root: ROOT,
		excludeTypes: INJECTION_EXCLUDED_TYPES,
	});
	const pitfallHits = r.facts.filter((f) => f.type === "pitfall");
	assert.ok(pitfallHits.length > 0, `经验应被召回到，实际 facts=${r.facts.length}`);
});

test("recallForAction：默认只取各类型自己的活跃状态，可显式纳入其他状态", async () => {
	const def = await recallForAction({ action: "校验验证", root: ROOT });
	for (const f of def.facts) {
		const allowed = DEFAULT_STATUSES_BY_TYPE[f.type] ?? ["active"];
		assert.ok(
			allowed.includes(f.status),
			`${f.type} 的状态 ${f.status} 不在该类型默认活跃集 [${allowed.join("/")}] 内`,
		);
	}
	const wide = await recallForAction({
		action: "校验验证", root: ROOT, statuses: ["active", "discarded", "open", "draft"],
	});
	assert.ok(wide.facts.length >= def.facts.length, "纳入更多状态时召回不减少");
});

test("recallForAction：types 过滤只回指定类型", async () => {
	const r = await recallForAction({
		action: "校验验证工具", root: ROOT, types: ["pitfall"],
	});
	assert.ok(r.facts.every((f) => f.type === "pitfall"), "types 过滤未生效");
});

test("recallForAction：limit 限制每侧返回条数", async () => {
	const r = await recallForAction({ action: "校验验证工具", root: ROOT, limit: 2 });
	assert.ok(r.specs.length <= 2);
	assert.ok(r.facts.length <= 2);
	assert.equal(r.budget.limit, 2);
});

test("recallForAction：预算超限时如实标 truncated，不静默", async () => {
	const r = await recallForAction({
		action: "校验验证工具 Web 页面", root: ROOT, limit: 20, budgetBytes: 200,
	});
	assert.equal(r.ok, true);
	assert.equal(r.truncated, true, "超预算须标 truncated");
	if (r.overBudget !== true) {
		assert.ok(r.budget.usedBytes <= 200, "未走保底时返回内容不得超预算");
	} else {
		assert.ok(r.specs.length + r.facts.length > 0, "保底必须给出至少一条");
	}
});

test("recallForAction：includeSpecs=false 时不回规范源", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await recallForAction({
		action: "校验验证", root: ROOT, includeSpecs: false,
	});
	assert.deepEqual(r.specs, []);
	assert.ok(r.facts.length > 0);
});

test("recallForAction：排序先按层、同层按命中词数，且结果可复算", async () => {
	const q = "Git Gate 的 pre-commit 钩子失败";
	const a = await recallForAction({ action: q, root: ROOT });
	const b = await recallForAction({ action: q, root: ROOT });
	assert.deepEqual(a.facts, b.facts, "同输入须同输出（确定性、无随机）");
	const tiers = a.facts.map((f) => f.tier);
	for (let i = 1; i < tiers.length; i += 1) {
		assert.ok(tiers[i - 1] <= tiers[i], "层号须非递减");
	}
});

test("recallForAction：切不出 token 时如实拒绝，不假装召回成功", async () => {
	const r = await recallForAction({ action: "  ", root: ROOT });
	assert.equal(r.ok, false);
	assert.equal(r.error.code, "recall/action_required");
});

test("tokenize：虚字单字也不进匹配集（曾让「的」进命中理由）", () => {
	for (const word of ["的", "了", "是", "在", "与", "之"]) {
		assert.ok(!tokenize(word).includes(word), `虚字单字「${word}」不应成 token`);
	}
	assert.ok(tokenize("云").includes("云"), "实义单字应保留");
});

test("同层排序：命中词多的必须排在命中词少的前面（曾因 hits 未带出而退化成按路径排序）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名，走独立审核", root: ROOT, limit: 3, budgetBytes: 4000 });
	assert.ok(r.specs.length > 0, "应有规范命中");
	const first = r.specs[0];
	assert.ok(typeof first.hits === "number" && first.hits >= 1, `hits 必须带出，实际 ${first.hits}`);
	assert.ok(
		r.specs.slice(0, 3).some((s) => s.title.includes("双源召回")),
		`34 号应在前三条内，实际：[${r.specs.map((s) => s.title).join(", ")}]`,
	);
	assert.equal(first.tier, 0, "「34」是编号命中，应落在 tier 0");
	assert.match(first.hitReason, /规范编号命中/);
	const sameTier = r.specs.filter((s) => s.tier === r.specs[0].tier);
	for (let i = 1; i < sameTier.length; i += 1) {
		assert.ok(sameTier[i - 1].hits >= sameTier[i].hits, "同层 hits 须非递增");
	}
});

test("高文档频率过滤：普遍词不再把大半规范拉进来", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 10, budgetBytes: 20000 });
	assert.ok(r.specs.length > 0, "应至少命中 34 号");
	assert.match(r.specs[0].hitReason, /规范编号命中：34/);
	assert.equal(r.specs[0].tier, 0, "34 号应以编号层居首");
	for (const s of r.specs.filter((x) => x.tier === 4)) {
		const m = /·(\d+)词/.exec(s.hitReason ?? "");
		assert.ok(m !== null, `正文层条目 ${s.title} 的命中理由须写明命中词数：${s.hitReason}`);
		assert.ok(Number(m[1]) >= 2, `正文层条目 ${s.title} 只命中 ${m[1]} 个词，应被 minHits 剔除`);
	}
});

test("高文档频率过滤：过滤后仍能命中真正相关的（不得因过滤而清空）", async () => {
	const r = await recallForAction({ action: "给 Web 页面加一个新面板", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.ok(r.specs.length > 0, "Web 查询应仍能命中规范");
});

test("高文档频率过滤：全部查询词都过于普遍时退回原词，不得给零结果", async () => {
	const r = await recallForAction({ action: "规范定义适用", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.equal(r.ok, true);
	assert.ok(r.specs.length + r.facts.length > 0, "不得因过滤过狠而返回空");
});

test("HIGH_DF_RATIO 是固定常量，样本过小时不丢词", () => {
	assert.equal(HIGH_DF_RATIO, 0.6);
});

test("规范正文层必须参与匹配（曾因读 body 而规范只有 text 导致整层失效）", async () => {
	const r = await recallForAction({ action: "改 guidance-text.js 的引导文本", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.ok(r.specs.length > 0, "必须命中规范（此前为 0 条）");
	assert.ok(
		r.specs.some((s) => s.title.includes("环境接入") || s.title.includes("插件发布")),
		`应命中 10 号规范，实际：[${r.specs.map((s) => s.title).join(", ")}]`,
	);
	assert.ok(r.specs.some((s) => s.tier === 4), "应有正文层（tier 4）命中");
});

test("规范正文层：受保护内容的出处能被召回（00 §3.3）", async () => {
	const r = await recallForAction({ action: "受保护内容怎么改", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.ok(r.specs.length > 0, "应命中规范");
	assert.ok(
		r.specs.some((s) => s.title.includes("理念与构成")),
		`00 号（受保护内容的规定处）应被命中，实际：[${r.specs.map((s) => s.title).join(", ")}]`,
	);
});

test("预算极小不得返回零结果（零结果会被读成「无相关约束」）", async () => {
	for (const budgetBytes of [1, 50, 200]) {
		const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, budgetBytes });
		assert.equal(r.ok, true);
		assert.ok(
			r.specs.length + r.facts.length > 0,
			`预算 ${budgetBytes} 时不得返回零结果`,
		);
		assert.equal(r.truncated, true, "应标为已裁剪");
		assert.equal(r.overBudget, true, "保底导致超额时须如实标出");
	}
});

test("预算充足时不标 overBudget", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, budgetBytes: 40000 });
	assert.equal(r.overBudget, false);
	assert.equal(r.budget.usedBytes <= 40000, true);
});

test("受辖但无语料的项目不得抛 ENOENT（新建项目/语料未建立是正常状态）", async () => {
	const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");

	const shapes = [
		["完全没有目录", async () => {}],
		["只有空 specs/", async (p) => { await mkdir(joinPath(p, "specs"), { recursive: true }); }],
		["只有空 ldvh-base/", async (p) => { await mkdir(joinPath(p, "ldvh-base"), { recursive: true }); }],
	];
	for (const [name, setup] of shapes) {
		const project = await mkdtemp(joinPath(tmpdir(), "ldvh-deg-"));
		try {
			await setup(project);
			const r = await recallForAction({ action: "把 34 号规范改名", root: project, limit: 3 });
			assert.equal(r.ok, true, `${name}：不应失败（不得抛 ENOENT）`);
			assert.equal(r.facts.length, 0, `${name}：无 ldvh-base/ 时事实必为空`);
			assert.equal(r.provesApplicability, false);
			if (r.specs.length > 0) {
				assert.equal(r.sourceView.specsAreProjectAuthored, false, `${name}：回退语料须标明非项目自著`);
			}
		} finally {
			await rm(project, { recursive: true, force: true });
		}
	}
});

test("受辖但无语料：注入层报 no-hits 而非报错", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-deg2-"));
	try {
		const r = await buildRecallInjection({ userText: "把 34 号规范改名", projectRoot: project });
		if (r.inject === false) {
			assert.equal(r.reason, "no-hits", "应报零命中，不是抛错");
		} else {
			assert.match(r.text, /非本项目自著/, "回退语料须如实标注来源");
		}
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("实义动词单字兜底：短指令不得切空（改一下/删了/加个）", () => {
	const cases = [
		["改一下", "改"], ["删了", "删"], ["加个", "加"], ["建个", "建"],
		["修一下", "修"], ["把这个改了", "改"],
	];
	for (const [phrase, want] of cases) {
		const tokens = tokenize(phrase);
		assert.ok(tokens.includes(want), `「${phrase}」应切出「${want}」，实际：${JSON.stringify(tokens)}`);
	}
});

test("实义动词单字兜底：宽泛字仍不收，避免请回噪声", () => {
	for (const phrase of ["弄一下", "调一下", "换个"]) {
		const tokens = tokenize(phrase);
		for (const wide of ["弄", "调", "换"]) {
			assert.ok(!tokens.includes(wide), `「${phrase}」不得把宽泛字「${wide}」收成单字 token`);
		}
	}
});

test("实义动词单字兜底：短指令能真实召回且质量不退化", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	for (const q of ["改一下", "把这个改了", "删了它"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, true, `「${q}」应能召回（此前报 recall/no_tokens）`);
	}
	const r2 = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3, budgetBytes: 2400 });
	assert.equal(r2.specs[0].tier, 0);
	assert.match(r2.specs[0].hitReason, /规范编号命中：34/);
});

test("单字兜底不得引入泛字噪声（回归：成/回/立/新/开/生 曾致假命中）", () => {
	const FORBIDDEN_SINGLE_CHARS = ["成", "立", "新", "开", "生", "设", "存", "保", "清", "替", "启", "停"];
	for (const phrase of [
		"把 34 号规范改名成双源召回",
		"这个功能已经完成",
		"新开一个分支",
		"保存这段设置",
	]) {
		const tokens = tokenize(phrase);
		for (const ch of FORBIDDEN_SINGLE_CHARS) {
			assert.ok(
				!tokens.includes(ch),
				`「${phrase}」不得切出泛字「${ch}」，实际：${JSON.stringify(tokens)}`,
			);
		}
	}
});

test("单字兜底：真正的动作字仍须切出（不得因收窄而误删）", () => {
	for (const [phrase, want] of [
		["改一下", "改"], ["删了", "删"], ["加个", "加"], ["建个", "建"], ["修一下", "修"],
	]) {
		assert.ok(tokenize(phrase).includes(want), `「${phrase}」须切出「${want}」`);
	}
});

test("单字噪声不得造成假命中（00 号不得靠「成」命中）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 5, budgetBytes: 20000 });
	for (const s of r.specs) {
		assert.ok(
			!/^.*命中：成$/.test(s.hitReason),
			`${s.title} 的命中理由是单字「成」，属泛字噪声`,
		);
	}
});

test("单字不得单独构成命中依据（真实消息实测：10 条里 4-5 条是单字噪声）", async () => {
	const isAllSingleChar = (reason) => {
		const m = /命中（[^）]*）：(.+)$/.exec(reason) ?? /命中：(.+)$/.exec(reason);
		if (m === null) return false;
		return m[1].split("、").every((token) => token.length === 1);
	};
	const r = await recallForAction({ action: "经验也要召回啊", root: ROOT, limit: 5, budgetBytes: 20000 });
	assert.ok(r.specs.some((s) => s.title.includes("Pitfall")), "应命中 Pitfall 类型规范");
	assert.ok(r.specs.length > 0, "应至少命中一份规范");
	for (const s of [...r.specs, ...r.facts]) {
		if (isAllSingleChar(s.hitReason)) {
			assert.match(
				s.hitReason,
				/仅单字|仅通用词/,
				`${s.title} 的命中词全是单字却未标注弱相关：${s.hitReason}`,
			);
		}
	}
	assert.ok(
		r.specs.some((s) => /命中：.*经验/.test(s.hitReason) && !/仅单字/.test(s.hitReason)),
		`应有一份规范靠强词「经验」命中，实际：${r.specs.map((s) => s.hitReason).join(" | ")}`,
	);
});

test("靠单字命中时须标注「仅单字…相关性弱」，不得让读者误以为相关性强", async () => {
	const r = await recallForAction({ action: "把这批改动合入吧", root: ROOT, limit: 5, budgetBytes: 20000 });
	const singleHits = r.specs.filter((s) => /仅单字|仅通用词/.test(s.hitReason));
	for (const s of singleHits) {
		assert.match(s.hitReason, /相关性弱，须自行核实/, "标注须说明相关性弱");
	}
});

test("单字兜底不得被削弱：短指令仍须能召回（第 16 轮路径）", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	for (const q of ["改一下", "删了", "加个", "建个"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, true, `「${q}」必须仍能召回——单字是它唯一的词`);
	}
});

test("通用词不得单独构成命中依据（通用词只降级、不丢弃，且真相关不被降级）", async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const isAllSingleChar = (reason) => {
		const m = /命中（[^）]*）：(.+)$/.exec(reason) ?? /命中：(.+)$/.exec(reason);
		if (m === null) return false;
		return m[1].split("、").every((token) => token.length === 1);
	};
	const tmp = await mkdtemp(join(tmpdir(), "recall-generic-"));
	try {
		const dir = join(tmp, "ldvh-base", "pitfalls");
		await mkdir(dir, { recursive: true });
		const carrier = (uid, title, scope, body) => [
			"---",
			`title: ${title}`,
			"status: active",
			`scope: ${scope}`,
			`object_uid: ${uid}`,
			"fact_type_key: pitfall",
			"---",
			"",
			`# ${title}`,
			"",
			"## 症状",
			"",
			body,
			"",
		].join("\n");
		await writeFile(
			join(dir, "pitfall-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.md"),
			carrier(
				"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				"夹具甲 分发器回调缺少异常处理",
				"适用于夹具甲的分发器回调场景",
				"分发器在回调里没有 try/catch，子代理注册失败。",
			),
		);
		await writeFile(
			join(dir, "pitfall-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.md"),
			carrier(
				"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
				"夹具乙 通用词载体",
				"适用于夹具乙的执行与测试场景",
				"这里只写执行与测试这类通用词，不含真相关的分发器与回调。",
			),
		);

		const r = await recallForAction({
			action: "分发器回调里没有执行",
			root: tmp,
			limit: 10,
			budgetBytes: 200_000,
			includeSpecs: false,
		});
		assert.equal(r.ok, true, "夹具召回须成功");

		const relevant = r.facts.find((f) => f.title.includes("夹具甲"));
		assert.ok(relevant !== undefined, "带真相关词的夹具须被召回");
		assert.ok(
			!/仅通用词|仅单字/.test(relevant.hitReason),
			`真相关命中不应被降级：${relevant.hitReason}`,
		);
		const WEAK_MARK = /仅通用词|仅单字/;
		const WEAK_DISCLOSURE = /相关性弱，须自行核实/;
		let checkedWeak = 0;
		for (const f of r.facts) {
			if (f === relevant) continue;
			if (!WEAK_MARK.test(f.hitReason)) continue;
			checkedWeak += 1;
			assert.match(
				f.hitReason,
				WEAK_DISCLOSURE,
				`${f.title} 自称弱相关却未声明「相关性弱，须自行核实」：${f.hitReason}`,
			);
		}
		const genericOnly = r.facts.find((f) => f.title.includes("夹具乙"));
		assert.ok(genericOnly !== undefined, "只有通用词的夹具乙须出现在候选里");
		assert.match(
			genericOnly.hitReason,
			WEAK_MARK,
			`只靠通用词命中的夹具乙须被判为弱命中（否则降级规则已失效）：${genericOnly.hitReason}`,
		);
		assert.ok(checkedWeak > 0, "须至少检查到一条弱命中（否则断言未被执行）");
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
});

test("通用词降级后：真主题查询仍须命中真相关项", async () => {
	const r = await recallForAction({ action: "经验也要召回啊", root: ROOT, limit: 3, budgetBytes: 20000 });
	assert.ok(r.specs.some((s) => s.title.includes("Pitfall")), "「经验」应命中 Pitfall 类型规范");
	const pitfallSpec = r.specs.find((s) => s.title.includes("Pitfall"));
	assert.ok(!/仅通用词|仅单字/.test(pitfallSpec.hitReason), "靠「经验」命中不应被降级");
});

test("通用词降级不得削弱短指令路径", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	for (const q of ["改一下", "删了", "加个"]) {
		const r = await buildRecallInjection({ userText: q, projectRoot: ROOT });
		assert.equal(r.inject, true, `「${q}」必须仍能召回`);
	}
});


test("三级回退：受辖项目无自著语料时须回退，不得零命中", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-tier-"));
	try {
		const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: project, limit: 3 });
		assert.equal(r.ok, true);
		assert.ok(r.specs.length > 0, "无自著语料时应回退取得语料，而非零命中");
		assert.equal(r.sourceView.specs.tier, "source-repo", "应回退到插件源仓库");
		assert.equal(r.sourceView.specsAreProjectAuthored, false);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("三级回退：有自著语料时用项目语料，不得回退", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(r.sourceView.specs.tier, "project");
	assert.equal(r.sourceView.specsAreProjectAuthored, true);
});

test("三级回退：空目录不得冒充语料来源（以根规范载体的实际存在辨认）", async () => {
	const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-empty-"));
	try {
		await mkdir(joinPath(project, "specs"), { recursive: true });
		const resolved = await resolveSpecsRoot(project);
		assert.notEqual(resolved?.tier, "project", "空的 specs/ 不得被当作项目语料来源");
		assert.equal(resolved?.tier, "source-repo", "应继续回退到源仓库");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("三级回退：渲染行须如实标注语料来自回退来源（不得冒充项目自著）", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const { renderRecallRow } = await import("../lib/recall-injection.js");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-render-"));
	try {
		const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: project, limit: 2 });
		const row = renderRecallRow(r);
		assert.match(row, /非本项目自著/, "回退来源必须在渲染行里如实标注");
		assert.match(row, /插件源仓库/, "应点名具体回退层级");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});


test("02 §9.1：counts 须报**截断前总数**，而非返回数", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 2 });
	assert.ok(r.counts.specHits > r.counts.specsReturned, "命中总数应大于返回数");
	assert.equal(r.counts.specsReturned, r.specs.length);
	assert.equal(r.counts.factsReturned, r.facts.length);
	assert.ok(r.counts.candidatesScanned > 0, "须报实际参与匹配的候选数");
	const specsLoaded = await loadSpecs(join(ROOT, "specs"));
	const factsLoaded = await loadFacts(join(ROOT, "ldvh-base"));
	assert.equal(
		r.counts.candidatesScanned + r.counts.candidatesExcluded,
		specsLoaded.length + factsLoaded.length,
		"扫描数 + 排除数 = 载入总数",
	);
});

test("02 §9.1：limit 造成的丢弃须标 partial/truncated（不只预算）", async () => {
	const small = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 2 });
	assert.equal(small.partial, true, "limit 截断时须报 partial");
	assert.equal(small.truncated, true, "limit 截断时须报 truncated");

	const big = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 999, budgetBytes: 9999999 });
	const reallyDropped =
		big.counts.specsReturned < big.counts.specHits || big.counts.factsReturned < big.counts.factHits;
	assert.equal(
		big.partial,
		reallyDropped,
		`partial 须与「是否真有未返回的命中」一致：partial=${big.partial} dropped=${reallyDropped}`,
	);
	assert.equal(big.truncated, reallyDropped, "truncated 同理");
});

test("02 §9.1：unchecked 须列出**具体被丢弃的候选**，不只是一个布尔", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 2 });
	const dropped = r.unchecked.specs.length + r.unchecked.facts.length;
	const kept = r.specs.length + r.facts.length;
	assert.equal(kept + dropped, r.counts.specHits + r.counts.factHits, "保留数 + 丢弃数 = 命中总数");
	assert.ok(dropped > 0, "limit=2 时必有丢弃");
	for (const item of [...r.unchecked.specs, ...r.unchecked.facts]) {
		assert.equal(typeof item.title, "string");
		assert.equal(typeof item.path, "string");
	}
});

test("02 §9.1：unchecked 与已返回的交集须为空（切片冒充差集即红）", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	const r = await buildRecallInjection({
		userText: "当前ldvh在召回上做的如何？",
		projectRoot: ROOT,
		budgetBytes: 10240,
		limit: 12,
	});
	assert.equal(r.inject, true, "前提：该查询须能进入词法候选召回");
	const res = r.result;
	assert.ok(res.sectioning !== null && res.sectioning !== undefined, "前提：须走分节路径");
	const returned = [...(res.specs ?? []), ...(res.facts ?? [])].map((x) => x.path);
	const unchecked = [...(res.unchecked?.specs ?? []), ...(res.unchecked?.facts ?? [])].map((x) => x.path);
	const overlap = unchecked.filter((p) => returned.includes(p));
	assert.deepEqual(
		overlap,
		[],
		`「未列出」不得包含已返回的对象（实测重叠 ${overlap.length} 条）——`
		+ "分节后 kept 不是命中列表的前缀，须按 path 求差集",
	);
	assert.equal(
		(res.specs ?? []).length + (res.unchecked?.specs ?? []).length,
		res.counts.specHits,
		"规范侧：已返回 + 未列出 须等于命中总数",
	);
	assert.equal(
		(res.facts ?? []).length + (res.unchecked?.facts ?? []).length,
		res.counts.factHits,
		"事实侧：已返回 + 未列出 须等于命中总数",
	);
});

test("02 §9：排序不得用相似度/embedding/AI 裁决相关性（红线）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(r.ranking.usesWeights, true, "idf 加权参与排序，声明须与实际一致（不是 false）");
	assert.equal(r.ranking.usesSimilarity, false);
	assert.equal(r.ranking.usesEmbedding, false);
	assert.equal(r.ranking.usesAiJudgement, false, "02 §9 红线：不得用 AI 输出自动裁决相关性");
	assert.deepEqual(r.ranking.keys, ["tier", "hits", "path"]);
	assert.equal(r.ranking.truncationIsNotJudgement, true);
});

test("02 §9.1：fingerprint 须为确定性集合指纹，且不得冒称内容指纹", async () => {
	const a = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	const b = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(a.fingerprint.value, b.fingerprint.value, "同一候选集合的指纹须稳定");
	assert.equal(a.fingerprint.kind, "candidate-set");
	assert.equal(a.fingerprint.coversContent, false, "不得冒称内容指纹");
	assert.equal(a.fingerprint.memberCount, a.counts.candidatesScanned + a.counts.candidatesExcluded, "指纹覆盖载入的全部候选（含被排除的）");
});

test("02 §9.1：pagination 须如实说明无游标及如何取更多", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 2 });
	assert.equal(r.pagination.hasCursor, false, "本实现不持有跨调用游标，须如实说明");
	assert.match(r.pagination.howToGetMore, /limit|范围/, "须说明如何取得更多结果");
});


test("limitations 须如实披露词法匹配的固有边界", async () => {
	const r = await recallForAction({ action: "页面白屏了", root: ROOT, limit: 3 });
	assert.equal(r.limitations.lexicalOnly, true, "须声明是纯词法匹配");
	assert.equal(r.limitations.usesSemanticUnderstanding, false, "不得声称有语义理解");
	assert.ok(r.limitations.measuredSymptomSelfRecall.total > 0, "须给出实测样本量");
	assert.ok(
		r.limitations.insufficientForConsumptionPoints.some((x) => /故障调查/.test(x)),
		"须点明「故障调查」这一消费点不能只靠本函数",
	);
	assert.ok(
		r.limitations.insufficientForConsumptionPoints.some((p) => p.includes("故障调查")),
		"须点名哪些消费点不能只靠本函数",
	);
});

test("能力边界须在渲染行里让读者看见（未命中不代表没有同类教训）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const { renderRecallRow } = await import("../lib/recall-injection.js");
	const r = await recallForAction({ action: "页面白屏了", root: ROOT, limit: 2 });
	const row = renderRecallRow(r);
	assert.match(row, /能力边界/, "含事实候选时须提示能力边界");
	assert.match(row, /未命中不代表没有同类教训/, "须明确未命中的含义");
	const specOnly = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3, types: [] });
	const specRow = renderRecallRow(specOnly);
	assert.equal(specRow.includes("能力边界") && specOnly.facts.length === 0, false, "无事实候选时不加该提示");
});

test("弱命中不得抢占强命中的名额（实测：limit=3 时 2 弱命中挤掉 5 强命中）", async () => {
	const q = "把 34 号规范改名成双源召回，走独立审核";
	const r = await recallForAction({ action: q, root: ROOT, limit: 3 });
	const weak = (x) => /仅通用词|仅单字/.test(x.hitReason);
	assert.ok(r.specs.length > 0);
	assert.equal(
		r.specs.filter(weak).length,
		0,
		`limit=3 时不应有弱命中，实际：${r.specs.map((s) => `${weak(s) ? "弱" : "强"}${s.title.slice(0, 10)}`).join(" / ")}`,
	);
	const all = await recallForAction({ action: q, root: ROOT, limit: 99, budgetBytes: 999999 });
	assert.ok(all.specs.some(weak), "弱命中仍须保留在候选中，只是排后");
});

test("弱命中仍是候选，不得因排序改动而被丢弃", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await recallForAction({ action: "改一下", root: ROOT, limit: 5, budgetBytes: 40000 });
	assert.ok(r.facts.length > 0, "短指令的弱命中不得被丢弃");
	assert.ok(r.facts.every((f) => /仅通用词|仅单字/.test(f.hitReason)), "短指令应仅有弱命中");
});

test("排序键须全部来自确定性事实，且不含任何模型/相似度成分", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 3 });
	assert.equal(r.ranking.usesSimilarity, false, "02 §9：不得用相似度");
	assert.equal(r.ranking.usesEmbedding, false, "02 §9：不得用 embedding");
	assert.equal(r.ranking.usesAiJudgement, false, "02 §9：不得用 AI 裁决");
	assert.deepEqual(r.ranking.keys, ["tier", "hits", "path"]);
	assert.equal(r.ranking.truncationIsNotJudgement, true, "排序不得被表述为裁决");
});

test("排序比较器：每层键都须真的被样本覆盖（无并列组 = 测试空跑，直接红）", () => {
	const mk = (o) => ({ fact: o, index: o.index ?? 0 });
	const base = { weakHit: false, tier: 1, hits: 1, status: "active", type: "pitfall", path: "a.md" };

	const older = mk({ ...base, updatedAt: "2026-10-13T00:00:00.000Z" });
	const newer = mk({ ...base, updatedAt: "2026-10-19T00:00:00.000Z" });
	assert.equal(
		compareFactHits(newer, older) < 0, true,
		"同分时较新的须在前（此断言同时证明时间键可达）",
	);
	assert.equal(compareFactHits(older, newer) > 0, true, "反向须对称");

	const draftNewer = mk({ ...base, status: "draft", updatedAt: "2026-10-27T00:00:00.000Z" });
	assert.equal(
		compareFactHits(mk(base), draftNewer) < 0, true,
		"已准入须先于未准入，即使草稿更新（新 ≠ 更权威）",
	);

	const sparkNewer = mk({ ...base, type: "spark", updatedAt: "2026-10-27T00:00:00.000Z" });
	assert.equal(
		compareFactHits(mk(base), sparkNewer) > 0, true,
		"类型不再是排序键：同证据、更新者（spark）须在前（时间键生效）",
	);
	const sameEvidenceNorm = mk({ ...base, type: "norm" });
	assert.equal(
		compareFactHits(mk(base), sameEvidenceNorm), 0,
		"同证据、同时间、同路径的 pitfall 与 norm 必须并列（无类型轴）",
	);

	const sameEvidenceSpark = mk({ weakHit: false, tier: 1, hits: 1, status: "active", type: "spark", path: "a.md" });
	assert.equal(
		compareFactHits(mk(base), sameEvidenceSpark), 0,
		"同等证据下 pitfall 与 spark 必须并列（类型轴已删除，不得复活）",
	);
	const weakNorm = mk({ weakHit: true, tier: 1, hits: 99, status: "active", type: "norm", path: "c.md" });
	const strongPitfall = mk({ weakHit: false, tier: 4, hits: 1, status: "active", type: "pitfall", path: "d.md" });
	assert.equal(
		compareFactHits(strongPitfall, weakNorm) < 0, true,
		"弱命中的 norm 不得压过强命中的 pitfall（证据先于身份）",
	);
	const strongSpark = mk({ weakHit: false, tier: 4, hits: 1, status: "active", type: "spark", path: "e.md" });
	assert.equal(
		compareFactHits(strongSpark, weakNorm) < 0, true,
		"证据相同时不再有类型轴：强命中的 spark 同样压过弱命中的 norm",
	);

	for (const [x, y] of [
		[mk({}), mk({})],
		[mk({ hits: undefined }), mk({ hits: 1 })],
		[mk({ tier: undefined }), mk({ tier: 1 })],
	]) {
		assert.equal(Number.isFinite(compareFactHits(x, y)), true, "比较器不得返回 NaN");
	}
});

test("排序须含「最后更新时间」作次级键，且只用存储时间（不得用文件 mtime）", async () => {
	const r = await recallForAction({ action: "把对象的字段改名后同步读取侧", root: ROOT, limit: 5 });
	for (const f of r.facts) {
		assert.equal(typeof f.updatedAt, "string", "每张事实卡须带 updatedAt（否则排序依据不可观察）");
		assert.ok(
			f.updatedAt === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(f.updatedAt),
			`updatedAt 须为 ISO 时间戳或空串（不得伪造当前时间）：${f.updatedAt}`,
		);
	}
	for (let i = 1; i < r.facts.length; i += 1) {
		const a = r.facts[i - 1];
		const b = r.facts[i];
		const comparable =
			a.weakHit === b.weakHit &&
			a.tier === b.tier &&
			a.hits === b.hits &&
			statusRank(a.status) === statusRank(b.status) &&
			REQUIRED_RECALL_TYPES.includes(a.type) === REQUIRED_RECALL_TYPES.includes(b.type);
		if (!comparable) continue;
		assert.ok(
			(a.updatedAt ?? "") >= (b.updatedAt ?? ""),
			`同分组内时间须从新到旧：${a.updatedAt} 不应早于 ${b.updatedAt}`,
		);
	}
});

test("类型点名层：点名某事实类型时，该类型自己的规范须居首", async () => {
	const cases = [

		{ q: "记一条 Spark", want: "Spark" },
		{ q: "新增一条 Pitfall", want: "Pitfall" },
		{ q: "处理一个 Friction", want: "Friction" },
		{ q: "写一份报告", want: "报告", reason: /适用范围命中|类型点名命中/ },
	];
	for (const { q, want, reason } of cases) {
		const r = await recallForAction({ action: q, root: ROOT, limit: 3, budgetBytes: 20000 });
		assert.ok(r.specs.length > 0, `「${q}」应命中规范`);
		assert.ok(
			r.specs[0].title.includes(want),
			`「${q}」首位应为含「${want}」的规范，实际：${r.specs[0].title}（${r.specs[0].hitReason}）`,
		);
		assert.match(r.specs[0].hitReason, reason ?? /类型点名命中/, `「${q}」应靠类型点名或适用范围命中`);
	}
});

test("类型点名层：标题里带连字符的类型名须能整词匹配（曾切成 pitfall-）", async () => {
	const r = await recallForAction({ action: "新增一条 Pitfall", root: ROOT, limit: 2 });
	assert.equal(r.specs[0].title.includes("Pitfall"), true);
	assert.match(r.specs[0].hitReason, /类型点名命中：pitfall/);
});

test("类型点名层：编号点名仍须优先（tier 0 高于 tier 0.5）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.equal(r.specs[0].tier, 0, "编号点名应压过类型点名");
	assert.match(r.specs[0].hitReason, /规范编号命中：34/);
});

test("类型点名层只对规范生效，不得作用于事实（实测回归）", async () => {
	const r = await recallForAction({
		action: "install() 分发器在 agent/created 回调里没有 try/catch 致子代理注册失败",
		root: ROOT,
		limit: 5,
		budgetBytes: 20000,
	});
	for (const f of r.facts) {
		assert.ok(
			!/类型点名命中/.test(f.hitReason),
			`事实不得靠类型点名层命中：${f.title} → ${f.hitReason}`,
		);
	}
});

test("默认事实类型须为 Pitfall（03 §6.1 标准路径的明示要求）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	assert.deepEqual([...REQUIRED_RECALL_TYPES], ["pitfall"]);

	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const project = await mkdtemp(join(tmpdir(), "ldvh-requiredtypes-"));
	try {
		await seedFactCorpus(project, { pitfallCount: 2 });
		const r = await recallForAction({
			action: "写一条 Pitfall 经验",
			root: project,
			limit: 3,
			budgetBytes: 24000,
			excludeTypes: INJECTION_EXCLUDED_TYPES,
		});
		assert.ok(r.facts.length > 0, "应召回到事实");
		assert.ok(
			r.facts.some((f) => f.type === "pitfall"),
			`「写一条 Pitfall」须召回 pitfall（义务召回，25 §12），实际：${r.facts.map((f) => f.type).join(",")}`,
		);
	} finally {
		await rm(project, { recursive: true, force: true });
	}

	const ranked = await recallForAction({
		action: "把 34 号规范改名成双源召回",
		root: ROOT,
		limit: 12,
		budgetBytes: 24000,
		excludeTypes: INJECTION_EXCLUDED_TYPES,
	});
	for (let i = 1; i < ranked.facts.length; i += 1) {
		const prev = ranked.facts[i - 1];
		const cur = ranked.facts[i];
		const sameEvidence =
			prev.weakHit === cur.weakHit && prev.tier === cur.tier && prev.hits === cur.hits;
		if (!sameEvidence) continue;
		const prevStatus = statusRank(prev.status);
		const curStatus = statusRank(cur.status);
		const prevAt = String(prev.updatedAt ?? "");
		const curAt = String(cur.updatedAt ?? "");
		const ordered =
			prevStatus < curStatus ||
			(prevStatus === curStatus &&
				(prevAt > curAt || (prevAt === curAt && String(prev.path ?? "") <= String(cur.path ?? ""))));
		assert.ok(
			ordered,
			`证据并列时名次须由状态/时间/路径决定（不得由类型决定）：第 ${i} 位 ${prev.type}/${prev.path}，第 ${i + 1} 位 ${cur.type}/${cur.path}`,
		);
	}
});

test("调用方可显式覆盖默认类型", async () => {
	const r = await recallForAction({
		action: "这条 friction 该销账吗",
		root: ROOT,
		limit: 3,
		budgetBytes: 24000,
		types: ["friction"],
	});
	for (const f of r.facts) assert.equal(f.type, "friction", "显式 types 应生效");
	const specOnly = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, types: [] });
	assert.equal(specOnly.facts.length, 0, "types: [] 应只要规范");
});

test("10 §5.3：未实现的「既有行动结构路由」须如实登记，不得静默省略", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	const items = r.limitations.unimplemented;
	assert.ok(Array.isArray(items) && items.length > 0, "须登记未兑现项");
	const actionRoute = items.find((x) => x.item.includes("行动结构"));
	assert.ok(actionRoute !== undefined, "须点名「既有行动结构路由」未实现");
	assert.match(actionRoute.requiredBy, /10 §5\.3/, "须给出规范依据");
	assert.ok(actionRoute.reason.length > 0, "须说明原因（无可路由载体）");
	assert.equal(actionRoute.status, "unavailable-until-carrier-exists");
});

test("10 §5.3：注入不得复制规则正文（不成为第二规则源）", async () => {
	const { renderRecallRow } = await import("../lib/recall-injection.js");
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 2 });
	const row = renderRecallRow(r);
	assert.ok(!/召回的命中不等于适用（02 §9\.1|识别不到的来源不因未被指向而不存在/.test(row), "不得复制规范正文");
	assert.match(row, /specs\/|ldvh-base\//, "须给出可回指路径");
});

test("中间产物不得进入召回（02 §9.2）", async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-mid-"));
	try {
		const make = (dir, type, uid) => {
			return mkdir(joinPath(project, "ldvh-base", dir), { recursive: true }).then(() =>
				writeFile(
					joinPath(project, "ldvh-base", dir, "x.md"),
					`---\ntitle: 测试缓冲区留观条目\nstatus: active\nscope: 适用于测试缓冲区\nobject_uid: ${uid}\nfact_type_key: ${type}\n---\n\n# 测试缓冲区留观条目\n\n## 现象\n\n中间产物。\n`,
					"utf8",
				),
			);
		};
		await make("observation-buffer", "observation-buffer", "88888888-8888-4888-8888-888888888888");
		await make("norms", "norm", "99999999-9999-4999-8999-999999999999");

		const r = await recallForAction({
			action: "测试缓冲区留观条目",
			root: project,
			limit: 5,
			budgetBytes: 40000,
			includeSpecs: false,
		});
		assert.ok(
			!r.facts.some((f) => f.type === "observation-buffer"),
			"中间产物（留观缓冲）不得形成候选卡",
		);
		assert.ok(r.facts.some((f) => f.type === "norm"), "已登记类型仍须正常召回");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("REGISTERED_FACT_TYPES 须与 specs/20–26 段一致（防漂移）", async () => {
	const { readdir } = await import("node:fs/promises");
	const { join: joinPath } = await import("node:path");
	const specsDir = joinPath(ROOT, "specs");
	const files = (await readdir(specsDir)).filter((f) => /^2[0-6]-.*\.md$/.test(f));
	const fromSpecs = files
		.map((f) => {
			const name = f.replace(/\.md$/, "").replace(/^2[0-6]-/, "");
			const m = name.match(/[A-Za-z][A-Za-z0-9_]*/);
			return m === null ? null : m[0].toLowerCase();
		})
		.filter((x) => x !== null)
		.sort();
	assert.deepEqual(
		[...REGISTERED_FACT_TYPES].sort(),
		fromSpecs,
		`白名单与 specs/20–26 不一致：白名单=${[...REGISTERED_FACT_TYPES].sort().join(",")}，规范目录=${fromSpecs.join(",")}`,
	);
});

test("02 §9.2：每张候选卡须带来源与内容指纹", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	for (const card of [...r.specs, ...r.facts]) {
		assert.ok(card.source !== undefined, `${card.title} 缺 source`);
		assert.ok(
			card.source.tier === "project" || card.source.tier === "source-repo" || card.source.tier === "package",
			`${card.title} 的 source.tier 非法：${card.source.tier}`,
		);
		const fp = card.source.contentFingerprint;
		assert.ok(fp !== undefined, `${card.title} 缺内容指纹`);
		assert.equal(fp.kind, "content");
		assert.equal(fp.coversContent, true, "内容指纹必须声明覆盖内容");
		assert.match(fp.value, /^[0-9a-f]{8}$/, "指纹须为 8 位十六进制");
	}
});

test("02 §9.2：内容指纹须覆盖**全文**，不得只盖截断后的片段", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, includeSpecs: false });
	assert.ok(r.facts.length > 0, "应召回事实");
	const longOnes = r.facts.filter((f) => f.source.contentFingerprint.length > 1200);
	assert.ok(
		longOnes.length > 0,
		`所有事实指纹都 ≤1200 字符，说明仍在用截断后的 body：${r.facts.map((f) => f.source.contentFingerprint.length).join(",")}`,
	);
});

test("内容指纹须稳定：同一载体两次召回指纹一致", async () => {
	const a = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 2 });
	const b = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 2 });
	assert.deepEqual(
		a.specs.map((s) => s.source.contentFingerprint.value),
		b.specs.map((s) => s.source.contentFingerprint.value),
	);
});

test("02 §9：召回须保留「未检查范围」，且它不等于「被截断的」", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(r.uncheckedRange !== undefined, "须给出未检查范围");
	assert.ok(Array.isArray(r.uncheckedRange.excludedByStatus), "须按原因分列");
	assert.ok(r.uncheckedRange.note.length > 0, "须说明哪些语料没看");
});

test("uncheckedRange 的分类须与 candidatesExcluded 自洽", async () => {
	const r = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 3,
		types: ["norm", "pitfall"],
	});
	const u = r.uncheckedRange;
	const sum = u.excludedByTypeFilter.length + u.excludedByStatus.length + u.excludedByTypeWhitelist.length;
	assert.equal(sum, r.counts.candidatesExcluded, "三类之和须等于被排除总数");
});

test("candidatesScanned 须反映**实际参与匹配**的候选数（防御性：曾恒为常量）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const wide = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	const narrow = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 3,
		types: ["norm", "pitfall"],
	});
	assert.ok(
		narrow.counts.candidatesScanned < wide.counts.candidatesScanned,
		`收窄类型后参与匹配的候选数应减少：wide=${wide.counts.candidatesScanned} narrow=${narrow.counts.candidatesScanned}`,
	);
	assert.ok(narrow.counts.candidatesExcluded > wide.counts.candidatesExcluded, "被排除数应增加");
});

test("includeSpecs:false 时须把「规范源未读」列入未检查范围", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const withSpecs = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.deepEqual(withSpecs.uncheckedRange.sourceNotRead, [], "读规范源时不得声称未读");
	const withoutSpecs = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 3,
		includeSpecs: false,
	});
	assert.ok(withoutSpecs.uncheckedRange.sourceNotRead.length > 0, "未读规范源时须如实列出");
	assert.match(withoutSpecs.uncheckedRange.sourceNotRead.join(""), /规范源/);
});

test("保底不得按源各自触发（曾致总用量超预算）", async () => {
	const r = await recallForAction({
		action: "把 34 号规范改名成双源召回",
		root: ROOT,
		limit: 3,
		budgetBytes: 2400,
	});
	assert.ok(r.specs.length + r.facts.length > 0, "应有结果");
	if (r.overBudget !== true) {
		assert.ok(
			r.budget.usedBytes <= r.budget.limitBytes,
			`未走保底时用量 ${r.budget.usedBytes} 不得超预算 ${r.budget.limitBytes}`,
		);
	}
});

test("双源须各得份额：不得让规范占满预算致事实恒为 0", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	for (const q of ["把 34 号规范改名成双源召回", "经验也要召回啊", "提交前跑机械校验"]) {
		const r = await recallForAction({ action: q, root: ROOT, limit: 3, budgetBytes: 2400 });
		assert.ok(r.specs.length > 0, `「${q}」应有规范`);
		assert.ok(r.facts.length > 0, `「${q}」应有事实（不得被规范挤光）`);
	}
});

test("保底仍须生效：极小预算下不得返回零结果", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3, budgetBytes: 1 });
	assert.ok(r.specs.length + r.facts.length > 0, "极小预算仍须至少给一条");
	assert.equal(r.overBudget, true, "保底导致超额须如实标注");
});

test("回退来源时，卡片路径须可实际读取（absolutePath）", async () => {
	const { mkdtemp, rm, access } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-abs-"));
	try {
		const r = await recallForAction({ action: "把 34 号规范改名", root: project, limit: 2 });
		assert.equal(r.sourceView.specsAreProjectAuthored, false, "应回退到外部语料");
		assert.ok(r.specs.length > 0, "应召回规范");
		for (const spec of r.specs) {
			assert.equal(typeof spec.absolutePath, "string", `${spec.title} 缺 absolutePath`);
			await access(spec.absolutePath);
			await assert.rejects(
				() => access(joinPath(project, spec.path)),
				"回退来源下相对 path 不应可读——若可读则本用例前提不成立",
			);
		}
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("本项目自著语料时，渲染行用相对路径（绝对路径只在回退时需要）", async () => {
	const { renderRecallRow } = await import("../lib/recall-injection.js");
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 1 });
	assert.equal(r.sourceView.specsAreProjectAuthored, true);
	const row = renderRecallRow(r);
	assert.match(row, /（specs\/34/, "自著语料应显示相对路径");
	assert.ok(!/（\/Users\//.test(row), "自著语料不必显示绝对路径");
});

test("正文层门槛须随查询长度自适应：短查询不得被一刀切挡死", async () => {
	for (const q of ["代码", "测试", "提交"]) {
		const r = await recallForAction({ action: q, root: ROOT, limit: 3 });
		assert.ok(r.specs.length > 0, `短查询「${q}」不应零命中`);
	}
});

test("长查询的正文层门槛不得放宽（防噪声回归）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名成双源召回", root: ROOT, limit: 99 });
	for (const s of r.specs) {
		if (s.tier === 4) {
			assert.ok(!/正文命中：[^、]+$/.test(s.hitReason), `正文层不得单词命中：${s.title} → ${s.hitReason}`);
		}
	}
});

test("正文层匹配不得吃 frontmatter 字段名（元数据形状不是规范内容）", async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const tmp = await mkdtemp(join(tmpdir(), "recall-fmstrip-"));
	try {
		const specsDir = join(tmp, "specs");
		await mkdir(specsDir, { recursive: true });
		const PROBE = "zz_fixture_metadata_key";
		const identity = (key) => [
			"---",
			"ldvh_spec:",
			`  spec_key: "${key}"`,
			'  spec_id: "99"',
			'  spec_kind: "spec"',
			`  title: "夹具规范 ${key}"`,
			`  canonical_path: "specs/${key}.md"`,
			`  ${PROBE}: "只作为 YAML 键存在的值"`,
			"---",
		].join("\n");
		await writeFile(
			join(specsDir, "zz-meta-only.md"),
			`${identity("zz-meta-only")}\n\n# 夹具规范 zz-meta-only\n\n## 1. 价值判断\n\n本夹具只验证元数据不进入正文匹配面。\n\n## 2. 职责边界\n\n夹具内容，与探针无关。\n`,
			"utf8",
		);
		await writeFile(
			join(specsDir, "zz-in-body.md"),
			`${identity("zz-in-body")}\n\n# 夹具规范 zz-in-body\n\n## 1. 价值判断\n\n本夹具验证正文里的 ${PROBE} 一词照常参与匹配。\n\n## 2. 职责边界\n\n夹具内容。\n`,
			"utf8",
		);

		const metaOnly = await recallForAction({ action: PROBE, root: tmp, limit: 99, budgetBytes: 400000 });
		assert.equal(
			metaOnly.specs.filter((s) => s.specKey === "zz-meta-only").length,
			0,
			`仅以 YAML 键形态存在的 ${PROBE} 不得命中该规范（命中即说明正文层未剥离 frontmatter）`,
		);
		const inBody = await recallForAction({ action: PROBE, root: tmp, limit: 99, budgetBytes: 400000 });
		assert.ok(
			inBody.specs.some((s) => s.specKey === "zz-in-body"),
			`写进正文的 ${PROBE} 仍须命中（过度剥离会让真内容消失）`,
		);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
});

test("正文层仍须能命中真正写在正文里的术语", async () => {
	const r = await recallForAction({ action: "spec_key", root: ROOT, limit: 99, budgetBytes: 400000 });
	assert.ok(r.specs.length > 0, "正文真提及 spec_key 的规范仍须命中");
	assert.ok(
		r.specs.every((s) => s.kind === "spec"),
		"应只命中规范",
	);
});

test("事实正文须全文参与匹配：不得截断掉「规避/验证」等后半段章节", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const tmp = await mkdtemp(joinPath(tmpdir(), "recall-tail-"));
	try {
		const dir = joinPath(tmp, "ldvh-base", "pitfalls");
		await mkdir(dir, { recursive: true });
		const front = "本节描述受控写入环节观察到的现象，涉及载体一致性校验与前置条件核对顺序。".repeat(45);
		assert.ok(front.length > 1200, `前提：前段须越过 1200 字符，实际 ${front.length}`);
		assert.ok(!front.includes("规避") && !front.includes("椎间盘"), "前提：被测词不得出现在前段");
		const carrier = [
			"---",
			"title: 夹具 后半段章节可见性",
			"status: active",
			"scope: 适用于夹具的后半段章节可见性场景",
			"object_uid: cccccccc-cccc-4ccc-8ccc-cccccccccccc",
			"fact_type_key: pitfall",
			"---",
			"",
			"# 夹具 后半段章节可见性",
			"",
			"## 症状",
			"",
			front,
			"",
			"## 规避",
			"",
			"应当椎间盘式地绕开这一写法。",
			"",
		].join("\n");
		await writeFile(
			joinPath(dir, "pitfall-cccccccc-cccc-4ccc-8ccc-cccccccccccc.md"),
			carrier,
		);

		const hit = await recallForAction({
			action: "规避",
			root: tmp,
			limit: 5,
			budgetBytes: 200_000,
			includeSpecs: false,
		});
		assert.ok(hit.facts.length > 0, "正文后半段的「规避」须能召回夹具事实（否则正文未被匹配）");
		assert.ok(
			hit.facts.some((f) => /规避/.test(f.hitReason)),
			`正文后半段的「规避」须参与匹配：${hit.facts.map((f) => f.hitReason).join(" / ")}`,
		);
		const unique = await recallForAction({
			action: "椎间盘",
			root: tmp,
			limit: 5,
			budgetBytes: 200_000,
			includeSpecs: false,
		});
		assert.ok(
			unique.facts.some((f) => /椎间|间盘/.test(f.hitReason)),
			`后半段独有词「椎间盘」须参与匹配：${unique.facts.map((f) => f.hitReason).join(" / ")}`,
		);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
});

test("trigger_signal 须参与匹配（不得读进变量却不用）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const facts = await loadFacts(joinPath(ROOT, "ldvh-base"));
	const withTrigger = facts.filter((f) => REGISTERED_FACT_TYPES.includes(f.type) && typeof f.trigger === "string" && f.trigger.trim() !== "");
	assert.ok(withTrigger.length > 0, "应存在带 trigger_signal 的事实");

	for (const f of withTrigger.slice(0, 5)) {
		assert.ok(
			f.detail.includes(f.trigger.trim().slice(0, 20)),
			`trigger_signal 未进入匹配面：${f.title}`,
		);
	}
});

test("默认候选状态须按类型取，不得统一写死 active（20–26 各自规定）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.spark], ["open"], "22：默认候选只含 open");
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.friction], ["open"], "26：默认只含 open");
	assert.equal(Object.hasOwn(DEFAULT_STATUSES_BY_TYPE, "adr"), false, "adr 已撤除（无现行编号）：默认状态表不得再含 adr");
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.norm], ["active"], "23：默认含 active");
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.pitfall], ["active"], "25 §12 / 2026-11-03：Pitfall 无 draft，默认候选只含 active");

	const friction = await recallForAction({
		action: "这条 friction 该销账吗",
		root: ROOT,
		limit: 5,
		budgetBytes: 40000,
		types: ["friction"],
	});
	assert.ok(friction.facts.length > 0, "friction 默认候选须非空");
	for (const f of friction.facts) {
		assert.equal(f.status, "open", `friction 默认只应含 open，实际含 ${f.status}`);
	}

	const spark = await recallForAction({
		action: "记一条 Spark",
		root: ROOT,
		limit: 20,
		budgetBytes: 400000,
		types: ["spark"],
	});
	for (const f of spark.facts) {
		assert.equal(f.status, "open", `spark 默认不应含 ${f.status}`);
	}
});

test("须给出 F0 层：类型/状态计数使「有多少在等」不依赖查询措辞", async () => {
	const r = await recallForAction({ action: "有多少候选在等", root: ROOT, limit: 3 });
	assert.ok(r.f0 !== undefined, "须给出 F0 层");
	assert.ok(r.f0.countsByTypeStatus !== undefined, "须给出类型/状态计数");
	assert.equal(typeof r.f0.totalObjects, "number", "须给出对象总数");
	assert.ok(r.f0.coverage !== undefined, "须给出 coverage");

	const { loadFacts: loadFactsForDraft } = await import("../lib/source-recall.js");
	const allFacts = await loadFactsForDraft(joinPath(ROOT, "ldvh-base"));
	const draftByType = {};
	for (const f of allFacts) {
		if (f.status !== "draft") continue;
		draftByType[f.type] = (draftByType[f.type] ?? 0) + 1;
	}
	const draftTotal = Object.values(draftByType).reduce((a, b) => a + b, 0);
	for (const [type, count] of Object.entries(draftByType)) {
		assert.equal(
			r.f0.countsByTypeStatus[type]?.draft ?? 0,
			count,
			`F0 须如实报出 ${type} 的 draft 数（全库实为 ${count} 条）`,
		);
	}
	for (const [type, byStatus] of Object.entries(r.f0.countsByTypeStatus)) {
		assert.equal(
			byStatus.draft ?? 0,
			draftByType[type] ?? 0,
			`F0 报了 ${type} 的 draft=${byStatus.draft ?? 0}，但全库只有 ${draftByType[type] ?? 0} 条`,
		);
	}
	assert.equal(typeof draftTotal, "number", "全库 draft 总数须可算（即使为 0）");

	const filtered = await recallForAction({
		action: "有多少候选在等",
		root: ROOT,
		limit: 3,
		types: ["norm"],
		statuses: ["active"],
	});
	assert.deepEqual(
		filtered.f0.countsByTypeStatus,
		r.f0.countsByTypeStatus,
		"F0 计数须不受 types/statuses 过滤影响",
	);
});

test("F2 须给出「有界确定性摘录」，否则候选无法筛选", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(r.facts.length > 0, "应召回事实");
	for (const f of r.facts) {
		assert.equal(typeof f.excerpt, "string", `${f.title} 缺 excerpt`);
		assert.ok(f.excerpt.length > 0, `${f.title} 的摘录不得为空`);
		assert.ok(f.excerpt.length <= 121, `${f.title} 摘录超界：${f.excerpt.length} 字符`);
		assert.ok(!f.excerpt.includes("\n"), `${f.title} 摘录含换行，未折叠`);
	}
});

test("摘录须确定性：同一对象两次召回摘录完全一致", async () => {
	const a = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	const b = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.deepEqual(
		a.facts.map((f) => f.excerpt),
		b.facts.map((f) => f.excerpt),
		"摘录必须是确定性的截断，不得含随机或摘要成分",
	);
});

test("完整性须为 complete/partial/unavailable 三态（02 §9.2、02:308）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(["complete", "partial", "unavailable"].includes(r.recallCompleteness), `非法三态：${r.recallCompleteness}`);
	if (r.counts.candidatesExcluded > 0) {
		assert.notEqual(r.recallCompleteness, "complete", "有未检查范围时不得声称 complete");
	}
	if (r.truncated) assert.equal(r.recallCompleteness, "partial", "截断时须为 partial");
});

test("unavailable 与「零命中」须可区分（前者不得当作无相关）", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath2 } = await import("node:path");
	const empty = await mkdtemp(joinPath2(tmpdir(), "ldvh-empty-"));
	try {
		const r = await recallForAction({
			action: "任意查询内容",
			root: empty,
			limit: 3,
			includeSpecs: false,
		});
		assert.equal(r.facts.length, 0);
		assert.equal(r.recallCompleteness, "unavailable", "一源都读不到时须为 unavailable");
	} finally {
		await rm(empty, { recursive: true, force: true });
	}
});

test("M-21：一源不可读但另一源有非截断命中时，须报 partial 而非 complete", async () => {
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath2 } = await import("node:path");
	const e = await mkdtemp(joinPath2(tmpdir(), "ldvh-nofacts-"));
	try {
		const r = await recallForAction({
			action: "把 34 号规范改名成双源召回",
			root: e,
			limit: 500,
			budgetBytes: 40_000_000,
		});
		assert.ok(r.counts.specHits > 0, "须有规范命中，否则未触及本场景");
		assert.equal(r.truncated, false, "limit 须大到不截断，否则旧逻辑也会报 partial");
		assert.equal(r.counts.factHits, 0, "事实源不可读，事实命中须为 0");
		assert.equal(
			r.recallCompleteness,
			"partial",
			"一源不可读且有非截断命中时须为 partial；报 complete 即 M-21 反例(a)复现",
		);
		assert.ok(
			Array.isArray(r.uncheckedRange?.sourceNotRead) && r.uncheckedRange.sourceNotRead.length > 0,
			"一源不可读时 sourceNotRead 不得为空（34 §12 逐类对应）",
		);
		assert.ok(
			r.uncheckedRange.sourceNotRead.some((s) => s.includes("事实源") && s.includes("ldvh-base")),
			`sourceNotRead 须点名不可读的事实源：${JSON.stringify(r.uncheckedRange.sourceNotRead)}`,
		);
		assert.ok(
			(r.gaps ?? []).some((g) => g.includes("事实源不可读")),
			`gaps 须结构化登记事实源不可读（「以已披露代替」为 01 §10.3 所禁）：${JSON.stringify(r.gaps)}`,
		);
		assert.ok(
			(r.uncheckedRange?.note ?? "").includes("未扫描"),
			`note 不得在 ldvh-base/ 不存在时声称扫描了它（00 §4.6）：${r.uncheckedRange?.note}`,
		);
	} finally {
		await rm(e, { recursive: true, force: true });
	}
});

const FIXTURE_PITFALLS = [
	["11111111-1111-4111-8111-111111111111", "夹具甲 分发器改名后回调丢失", "分发器改名后回调注册表仍按旧名索引，回调被静默丢弃；上游只看到超时，日志里没有任何异常记录，排查需要半天时间"],
	["22222222-2222-4222-8222-222222222222", "夹具乙 缓存键改动漏掉租户维度", "缓存键改动只拼了用户标识而漏掉租户维度，多租户下同一用户标识在不同租户间读到彼此缓存内容；实测串号只在压测时出现"],
	["33333333-3333-4333-8333-333333333333", "夹具丙 装饰器顺序致初始化乱序", "装饰器顺序决定了依赖注入的时点，模块加载阶段读到的配置对象还是空壳，实际取到的永远是默认值；测试环境看不出问题"],
	["44444444-4444-4444-8444-444444444444", "夹具丁 重试策略叠加导致请求放大", "重试策略两层各自独立计数，外层三次内层三次共九次实际请求，服务端在故障恢复瞬间被放大流量压垮；客户端日志只记录最外层一次"],
	["55555555-5555-4555-8555-555555555555", "夹具戊 门禁状态判断放宽过界", "门禁状态判断把草稿态当成通过，门禁脚本本身返回成功码，调用方看不出问题"],
	["66666666-6666-4666-8666-666666666666", "夹具己 日志字段截断", "日志字段被截断成空串"],
	["77777777-7777-4777-8777-777777777777", "夹具庚 静默失败", "上游超时之后没有任何错误码返回，调用方以为这批请求都已成功落库，直到对账日才发现缺口"],
	["88888888-8888-4888-8888-888888888888", "夹具辛 版本号比较", "两端各自解析之后再比对大小，补零的位数不同导致判断相反，现象是升级后被判定为需要升级"],
];

async function withFixtureCorpus(fn) {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const root = await mkdtemp(joinPath(tmpdir(), "recall-comment-fixture-"));
	try {
		const dir = joinPath(root, "ldvh-base", "pitfalls");
		await mkdir(dir, { recursive: true });
		for (const [uid, title, symptom] of FIXTURE_PITFALLS) {
			await writeFile(
				joinPath(dir, `pitfall-${uid}.md`),
				[
					"---",
					`title: ${title}`,
					"status: active",
					`scope: 适用于${title}的夹具场景`,
					`object_uid: ${uid}`,
					"fact_type_key: pitfall",
					"---",
					"",
					`# ${title}`,
					"",
					"## 症状",
					"",
					symptom,
					"",
				].join("\n"),
				"utf8",
			);
		}
		const facts = await loadFacts(joinPath(root, "ldvh-base"));
		return await fn(root, facts);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const symptomOf = (p) => /## 症状\s*\n+([^\n#]+)/.exec(p.body ?? "")?.[1] ?? "";


test("须给出结构化 gaps（01 §10.3 明禁「以已披露代替」）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(Array.isArray(r.gaps), "须有 gaps 数组（可为空，但不得缺失）");

	assert.ok(
		r.limitations.unimplemented.length > 0,
		"前提：本实现确有未兑现能力",
	);
	assert.ok(
		r.gaps.some((g) => /行动结构/.test(g)),
		`未兑现能力须结构化进入 gaps，实际 gaps=${JSON.stringify(r.gaps)}`,
	);

	const noSpecs = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 3,
		includeSpecs: false,
	});
	assert.ok(
		noSpecs.gaps.some((g) => /规范源未读取/.test(g)),
		"includeSpecs:false 须登记该缺失",
	);
});

test("「本次召回完整度」与「事实集合完整性」须分开表达（原名会误导）", async () => {
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });

	assert.ok(r.recallCompleteness !== undefined, "须有 recallCompleteness");
	assert.equal(r.truncated, true, "前提：本次确被截断");

	assert.ok(r.f0?.setAudit !== undefined, "须有集合级审计");
	assert.equal(r.f0.setAudit.status, "complete", "事实源本身应完整（载入阶段无失败）");
	assert.ok(Array.isArray(r.f0.setAudit.notCompleted), "须给出具体未完成范围");
	assert.deepEqual(r.f0.setAudit.notCompleted, [], "载入阶段无未完成项");

	const narrow = await recallForAction({
		action: "把 34 号规范改名",
		root: ROOT,
		limit: 1,
		types: ["norm"],
	});
	assert.equal(
		narrow.f0.setAudit.status,
		"complete",
		"集合级审计不得因本次查询收窄而变化",
	);
});

test("事实正文层也须剥离 frontmatter（object_uid 判据）", async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const tmp = await mkdtemp(join(tmpdir(), "recall-strip-"));
	try {
		const pitfallDir = join(tmp, "ldvh-base", "pitfalls");
		await mkdir(pitfallDir, { recursive: true });
		const fm = (uid, title) => [
			"---",
			`title: ${title}`,
			"status: active",
			"scope: 夹具，用于验证 frontmatter 是否被剥离",
			`object_uid: ${uid}`,
			"fact_type_key: pitfall",
			"---",
			"",
		].join("\n");
		await writeFile(
			join(pitfallDir, `pitfall-${"11111111-1111-4111-8111-111111111111"}.md`),
			`${fm("11111111-1111-4111-8111-111111111111", "夹具甲：正文不提字段名")}\n## 症状\n\n正文里没有任何字段名。\n`,
		);
		await writeFile(
			join(pitfallDir, `pitfall-${"22222222-2222-4222-8222-222222222222"}.md`),
			`${fm("22222222-2222-4222-8222-222222222222", "夹具乙：正文真提到字段名")}\n## 症状\n\n正文确实写着 object_uid 这个词。\n`,
		);

		const r = await recallForAction({
			action: "object_uid",
			root: tmp,
			limit: 100,
			budgetBytes: 4_000_000,
			includeSpecs: false,
		});
		assert.equal(r.ok, true, "夹具召回须成功");
		const titles = r.facts.map((f) => f.title);
		assert.ok(
			!titles.some((t) => t.includes("夹具甲")),
			`只在 frontmatter 出现的 object_uid 不得命中（实际命中：${titles.join("、")}）——`
			+ "命中说明事实正文层未剥离 frontmatter",
		);
		assert.ok(
			titles.some((t) => t.includes("夹具乙")),
			"正文真提到 object_uid 的夹具须命中（否则说明剥离把正文也丢了）",
		);
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
});

test("候选的 tier 须说明它不是 F 层也不是 L 层（02 §9.1 禁止混用）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const r = await recallForAction({ action: "把 34 号规范改名", root: ROOT, limit: 3 });
	assert.ok(r.specs.length > 0 && r.facts.length > 0, "前提：双源皆有候选");

	for (const c of [...r.specs, ...r.facts]) {
		assert.equal(typeof c.matchTierMeaning, "string", `${c.title} 须带 matchTierMeaning`);
		assert.match(c.matchTierMeaning, /非 F0–F4/, "须明确排除 F 层");
		assert.match(c.matchTierMeaning, /非 L0–L4/, "须明确排除 L 层");
		assert.equal(typeof c.tier, "number", "tier 数值仍须存在");
	}
});


test("条数上限须由预算动态导出，不得固定成常量（设置项不得空转）", () => {
	const small = recallLimitForBudget(2400);
	const big = recallLimitForBudget(51200);
	assert.ok(big > small, `预算更大应给出更多条数（${small} vs ${big}）`);
	let prev = 0;
	for (const b of [1000, 2400, 10240, 20480, 30720, 51200, 102400]) {
		const v = recallLimitForBudget(b);
		assert.ok(v >= prev, `预算 ${b} 的条数 ${v} 不得少于更低预算的 ${prev}`);
		prev = v;
	}
	const vals = new Set([2400, 10240, 20480].map(recallLimitForBudget));
	assert.ok(vals.size > 1, "不同预算不得给出同一个条数上限");
	const tierVals = Object.values(INJECTION_BUDGET_TIERS).map(recallLimitForBudget);
	assert.equal(new Set(tierVals).size, Object.keys(INJECTION_BUDGET_TIERS).length, "每个已登记预算档位须给出互异的条数，不得被固定上限压成同值");
	assert.equal(recallLimitForBudget(0), RECALL_LIMIT_MIN);
	assert.equal(recallLimitForBudget(null), RECALL_LIMIT_MIN);
	assert.equal(recallLimitForBudget(Number.NaN), RECALL_LIMIT_MIN);
	assert.ok(recallLimitForBudget(10 ** 9) <= RECALL_LIMIT_MAX);
});

test("渲染字符上限须由字节预算导出，不得固定成 1600（档位调高不得被卡住）", () => {
	for (const b of [10240, 20480, 30720]) {
		assert.ok(renderCharLimitFor(b) > RECALL_RENDER_CHAR_LIMIT,
			`预算 ${b} 的字符上限应大于旧单值 ${RECALL_RENDER_CHAR_LIMIT}`);
	}
	assert.ok(renderCharLimitFor(30720) > renderCharLimitFor(10240));
	assert.equal(renderCharLimitFor(null), RECALL_RENDER_CHAR_LIMIT, "无预算时退回旧单值");
	assert.equal(renderCharLimitFor(0), RECALL_RENDER_CHAR_LIMIT);
});



async function withSparkFixture(fn) {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-injscope-"));
	const write = async (dir, type, uid, title, status) => {
		await mkdir(joinPath(project, "ldvh-base", dir), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", dir, `${uid}.md`),
			`---\ntitle: ${title}\nstatus: ${status}\nscope: 适用于召回范围测试\nobject_uid: ${uid}\nfact_type_key: ${type}\n---\n\n# ${title}\n\n## 现象\n\n召回范围测试载体。\n`,
			"utf8",
		);
	};
	try {
		await write("sparks", "spark", "11111111-1111-4111-8111-111111111111", "召回范围测试 火花条目", "open");
		await write("norms", "norm", "22222222-2222-4222-8222-222222222222", "召回范围测试 规范条目", "active");
		await write("pitfalls", "pitfall", "33333333-3333-4333-8333-333333333333", "召回范围测试 经验条目", "active");
		return await fn(project);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
}

test("31 §10：excludeTypes 的类型不形成候选（Spark 不进自动注入）", async () => {
	await withSparkFixture(async (project) => {
		const q = { action: "召回范围测试", root: project, limit: 10, budgetBytes: 40000, includeSpecs: false };
		const before = await recallForAction(q);
		assert.ok(before.facts.some((f) => f.type === "spark"), "前提：不排除时 spark 是候选");

		const after = await recallForAction({ ...q, excludeTypes: INJECTION_EXCLUDED_TYPES });
		assert.ok(!after.facts.some((f) => f.type === "spark"), "排除后不得出现 spark 候选");
		assert.ok(after.facts.some((f) => f.type === "norm"), "norm 仍须是候选");
		assert.ok(after.facts.some((f) => f.type === "pitfall"), "pitfall 仍须是候选");
	});
});

test("31 §10：excludeTypes 不使完整度降级、不冒充「被类型过滤」", async () => {
	await withSparkFixture(async (project) => {
		const q = { action: "召回范围测试", root: project, limit: 10, budgetBytes: 40000, includeSpecs: false };

		const narrowed = await recallForAction({ ...q, types: ["norm", "pitfall"] });
		assert.ok(
			narrowed.uncheckedRange.excludedByTypeFilter.some((f) => f.type === "spark"),
			"types 白名单：被排除者须进 excludedByTypeFilter（本次漏查）",
		);

		const scoped = await recallForAction({ ...q, excludeTypes: INJECTION_EXCLUDED_TYPES });
		assert.equal(
			scoped.uncheckedRange.excludedByTypeFilter.length,
			0,
			"excludeTypes：不得冒充「被类型过滤」",
		);
		assert.ok(
			scoped.uncheckedRange.excludedByScope.some((f) => f.type === "spark"),
			"excludeTypes：须在独立的 excludedByScope 里如实列出（不隐藏边界）",
		);
		assert.equal(
			scoped.recallCompleteness,
			narrowed.recallCompleteness,
			"在其它条件相同时，声明范围收窄不应比运行期收窄更差",
		);
	});
});

test("31 §10：excludedByScope 与 notInScope 计数自洽", async () => {
	await withSparkFixture(async (project) => {
		const q = { action: "召回范围测试", root: project, limit: 10, budgetBytes: 40000, includeSpecs: false };
		const all = await recallForAction(q);
		const scoped = await recallForAction({ ...q, excludeTypes: INJECTION_EXCLUDED_TYPES });
		assert.equal(
			scoped.uncheckedRange.excludedByScope.length,
			1,
			"夹具里恰有 1 条 spark 在声明范围之外",
		);
		assert.equal(
			scoped.f0.coverage.totalLoaded - scoped.f0.coverage.scanned - scoped.f0.coverage.notScanned,
			scoped.uncheckedRange.excludedByScope.length,
			"totalLoaded − scanned − notScanned 须等于范围外条数",
		);
		assert.equal(all.f0.coverage.notInScope, 0, "不传 excludeTypes 时范围外为 0");
		assert.equal(scoped.f0.coverage.notInScope, 1);
	});
});

test("31 §10：excludeTypes 为 null 时行为与不传完全一致（不改变既有调用方）", async () => {
	await withSparkFixture(async (project) => {
		const q = { action: "召回范围测试", root: project, limit: 10, budgetBytes: 40000, includeSpecs: false };
		const a = await recallForAction(q);
		const b = await recallForAction({ ...q, excludeTypes: null });
		assert.deepEqual(
			b.facts.map((f) => f.path),
			a.facts.map((f) => f.path),
			"null 与不传须等价",
		);
		assert.equal(b.recallCompleteness, a.recallCompleteness);
	});
});

test("31 §10：声明范围常量的成员须各有规范依据，且只会变窄", async () => {
	const BASIS = {
		spark: "22 §12／31 §10",
	};
	assert.deepEqual(
		[...INJECTION_EXCLUDED_TYPES].sort(),
		Object.keys(BASIS).sort(),
		"排除名单与登记过的规范依据必须一一对应：新增类型须先有写明「不进自动注入」的条文",
	);
});

test("召回路径的用例须与它们所测的路径同参（`excludeTypes` 不得漏传）", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	await withSparkFixture(async (project) => {
		const r = await buildRecallInjection({
			userText: "召回范围测试 测试范围 范围测试",
			projectRoot: project,
		});
		assert.equal(r.inject, true, "前提：夹具须能产出注入行");
		const injectedFacts = r.result?.facts ?? [];
		assert.ok(
			!injectedFacts.some((f) => f.type === "spark"),
			`注入路径不得让 spark 占掉候选名额（31 §10）——实际：${injectedFacts.map((f) => f.type).join(",")}`,
		);
	});
});

test("已撤除类型：盘上残留 devlog 载体须如实披露为未登记类型被排除", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-injdevlog-"));
	try {
		await mkdir(joinPath(project, "ldvh-base", "devlogs"), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", "devlogs", "44444444-4444-4444-8444-444444444444.md"),
			"---\ntitle: 召回范围测试 devlog 条目\nstatus: active\noccurred_at: 2026-11-01T00:00:00Z\n"
			+ "summary: 召回范围测试载体，用于验证 devlog 不进注入候选。\n"
			+ "object_uid: 44444444-4444-4444-8444-444444444444\nfact_type_key: devlog\n---\n\n"
			+ "# 召回范围测试 devlog 条目\n\n## 背景\n\n召回范围测试载体。\n",
			"utf8",
		);
		await mkdir(joinPath(project, "ldvh-base", "pitfalls"), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", "pitfalls", "55555555-5555-4555-8555-555555555555.md"),
			"---\ntitle: 召回范围测试 经验条目\nstatus: active\n"
			+ "scope: 适用于召回范围测试\n"
			+ "object_uid: 55555555-5555-4555-8555-555555555555\nfact_type_key: pitfall\n---\n\n"
			+ "# 召回范围测试 经验条目\n\n## 症状\n\n召回范围测试载体。\n",
			"utf8",
		);
		const r = await buildRecallInjection({
			userText: "召回范围测试 测试范围 范围测试",
			projectRoot: project,
		});
		assert.equal(r.inject, true, "前提：夹具须能产出注入行");
		const injectedFacts = r.result?.facts ?? [];
		assert.ok(
			!injectedFacts.some((f) => f.type === "devlog"),
			`注入路径不得让 devlog 占候选（未登记类型不参与：02 §7.1 值域）——实际：${injectedFacts.map((f) => f.type).join(",")}`,
		);
		assert.ok(
			!(r.result?.unchecked?.facts ?? []).some((f) => /devlogs\//.test(f.path)),
			"devlog 不得出现在「未列出」清单里——它不属本路径的声明范围，不是本次漏掉的",
		);
		assert.match(
			r.text ?? "",
			/未登记类型不参与/,
			"盘上残留的已撤除类型须如实披露为「未登记类型不参与」",
		);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("已撤除类型：盘上残留 devlog 载体须如实披露为未登记类型被排除", async () => {
	const { buildRecallInjection } = await import("../lib/recall-injection.js");
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-injdevlog-"));
	try {
		await mkdir(joinPath(project, "ldvh-base", "devlogs"), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", "devlogs", "44444444-4444-4444-8444-444444444444.md"),
			"---\ntitle: 召回范围测试 devlog 条目\nstatus: active\noccurred_at: 2026-11-01T00:00:00Z\n"
			+ "summary: 召回范围测试载体，用于验证 devlog 不进注入候选。\n"
			+ "object_uid: 44444444-4444-4444-8444-444444444444\nfact_type_key: devlog\n---\n\n"
			+ "# 召回范围测试 devlog 条目\n\n## 背景\n\n召回范围测试载体。\n",
			"utf8",
		);
		const r = await buildRecallInjection({
			userText: "召回范围测试 测试范围 范围测试",
			projectRoot: project,
		});
		assert.equal(r.inject, true, "前提：夹具须能产出注入行");
		const injectedFacts = r.result?.facts ?? [];
		assert.ok(
			!injectedFacts.some((f) => f.type === "devlog"),
			`注入路径不得让 devlog 占候选（未登记类型不参与：02 §7.1 值域）——实际：${injectedFacts.map((f) => f.type).join(",")}`,
		);
		assert.ok(
			!(r.result?.unchecked?.facts ?? []).some((f) => /devlogs\//.test(f.path)),
			"devlog 不得出现在「未列出」清单里——它不属本路径的声明范围，不是本次漏掉的",
		);
		assert.match(
			r.text ?? "",
			/未登记类型不参与/,
			"盘上残留的已撤除类型须如实披露为「未登记类型不参与」",
		);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});


async function withStructuralFixture(fn) {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-struct-"));
	const write = async (dir, uid, fm, body) => {
		await mkdir(joinPath(project, "ldvh-base", dir), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", dir, `${uid}.md`),
			`---\n${fm.trim()}\n---\n\n${body}\n`,
			"utf8",
		);
	};
	try {
		await write("sparks", "11111111-1111-4111-8111-111111111111", `title: 结构测试 火花甲
status: open
object_uid: 11111111-1111-4111-8111-111111111111
fact_type_key: spark
serves: SG-1
priority: P0
question: 火花甲的问题是什么？
scope_boundary: 何时停止
intent: 为何保留
summary: 火花甲的当前理解`, "# 结构测试 火花甲\n\n## 当前理解\n\n火花甲的当前理解");
		await write("sparks", "22222222-2222-4222-8222-222222222222", `title: 结构测试 火花乙
status: open
object_uid: 22222222-2222-4222-8222-222222222222
fact_type_key: spark
serves: SG-2
priority: P1
question: 火花乙的问题是什么？
scope_boundary: 何时停止
intent: 为何保留
summary: 火花乙的当前理解`, "# 结构测试 火花乙\n\n## 当前理解\n\n火花乙的当前理解");
		await write("frictions", "33333333-3333-4333-8333-333333333333", `title: 结构测试 摩擦甲
status: open
object_uid: 33333333-3333-4333-8333-333333333333
fact_type_key: friction
phenomenon: 摩擦甲的现象是结构测试
relations:
  - relation_key: informs
    target:
      object_uid: 11111111-1111-4111-8111-111111111111
occurrence:
  count: 5
  first_at: 2026-10-01T00:00:00.000Z
  last_at: 2026-10-20T00:00:00.000Z
attribution: 归因落在结构层`, "## 现象\n\n摩擦甲的现象是结构测试\n\n## 入账依据\n\n测试");
		await write("frictions", "44444444-4444-4444-8444-444444444444", `title: 结构测试 摩擦乙
status: open
object_uid: 44444444-4444-4444-8444-444444444444
fact_type_key: friction
phenomenon: 摩擦乙的现象是结构测试
occurrence:
  count: 1
  first_at: 2026-10-01T00:00:00.000Z
  last_at: 2026-10-01T00:00:00.000Z`, "## 现象\n\n摩擦乙的现象是结构测试\n\n## 入账依据\n\n测试");
		return await fn(project);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
}

test("结构化解析：块标量不得被读成字面量 `|`（旧行式解析的核心缺陷）", async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-blockscalar-"));
	try {
		await mkdir(joinPath(project, "ldvh-base", "sparks"), { recursive: true });
		await writeFile(
			joinPath(project, "ldvh-base", "sparks", "55555555-5555-4555-8555-555555555555.md"),
			[
				"---",
				"title: 块标量测试",
				"status: open",
				"object_uid: 55555555-5555-4555-8555-555555555555",
				"fact_type_key: spark",
				"summary: |-",
				"  第一行真实内容",
				"  第二行真实内容",
				"---",
				"",
				"# 块标量测试",
			].join("\n"),
			"utf8",
		);
		const facts = await loadFacts(joinPath(project, "ldvh-base"));
		const f = facts.find((x) => x.ref === "55555555-5555-4555-8555-555555555555");
		assert.ok(f !== undefined, "载体须被载入");
		assert.ok(!/^[|>]/.test(f.summary), `summary 不得是块标量字面量，实得 ${JSON.stringify(f.summary)}`);
		assert.ok(f.summary.includes("第一行真实内容"), "块标量的真实内容须可读");
		assert.ok(f.summary.includes("第二行真实内容"), "块标量的第二行须可读，不得只取首行");
		assert.ok(!/^[|>]/.test(f.excerptSource), "摘录源不得是块标量字面量");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("结构化解析：relations / occurrence 须解析成结构，不得压成字符串", async () => {
	await withStructuralFixture(async (project) => {
		const facts = await loadFacts(joinPath(project, "ldvh-base"));
		const friction = facts.find((f) => f.ref === "33333333-3333-4333-8333-333333333333");
		assert.deepEqual(friction.structural.relationKeys, ["informs"], "关系键须可读");
		assert.deepEqual(
			friction.structural.relationTargets,
			["11111111-1111-4111-8111-111111111111"],
			"关系目标须可读（旧解析器只留下 `relation_key: informs`，target 整段丢失）",
		);
		assert.equal(friction.structural.occurrenceCount, 5, "occurrence.count 须可读（旧解析器读成空串）");
	});
});

test("结构命中：贴完整 object_uid 须命中该条（02 §9.1 F2 的「稳定引用」维度）", async () => {
	await withStructuralFixture(async (project) => {
		const r = await recallForAction({
			action: "33333333-3333-4333-8333-333333333333",
			root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		assert.ok(
			r.facts.some((f) => f.ref === "33333333-3333-4333-8333-333333333333"),
			"稳定引用须能直接命中——改动前此查询返回 0 条",
		);
	});
});

test("结构命中：短指称「类型短名-前8位」与裸前8位都须命中（语料实际写法）", async () => {
	await withStructuralFixture(async (project) => {
		const q = (action) => recallForAction({
			action, root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		const FRICTION = "33333333-3333-4333-8333-333333333333";
		for (const [form, label] of [
			["friction-33333333", "类型短名 + 前 8 位"],
			["33333333", "裸前 8 位"],
			[FRICTION, "完整 36 位"],
		]) {
			const r = await q(form);
			assert.ok(
				r.facts.some((f) => f.ref === FRICTION),
				`${label}（${form}）须命中该条`,
			);
		}
	});
});

test("结构命中：短指称不认前缀之外的形态（7 位、9 位、错误类型前缀均不命中）", async () => {
	await withStructuralFixture(async (project) => {
		const q = (action) => recallForAction({
			action, root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		const FRICTION = "33333333-3333-4333-8333-333333333333";
		const positive = await q("friction-33333333");
		assert.ok(
			positive.facts.some((f) => f.ref === FRICTION),
			"对照：正确的短指称须命中。此项失败说明结构层整体失效，下面的否定断言无意义",
		);
		for (const bad of ["3333333", "333333333", "spark-33333333"]) {
			const r = await q(bad);
			assert.ok(
				!r.facts.some((f) => f.ref === FRICTION),
				`${bad} 不得命中——短指称只认恰好 8 位，且类型前缀须与该对象类型一致`,
			);
		}
	});
});

test("结构命中：serves / priority / direction_key / relation_key 均须可命中", async () => {
	await withStructuralFixture(async (project) => {
		const q = (action) => recallForAction({
			action, root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		const sg1 = await q("SG-1");
		const sg1Refs = sg1.facts.map((f) => f.ref);
		assert.ok(sg1Refs.includes("11111111-1111-4111-8111-111111111111"), "serves=SG-1 须被命中");
		assert.ok(
			!sg1Refs.includes("22222222-2222-4222-8222-222222222222"),
			"SG-1 不得命中 serves=SG-2（整值相等，不认前缀）",
		);
		const p0 = await q("P0");
		assert.deepEqual(
			p0.facts.filter((f) => f.type === "spark").map((f) => f.ref),
			["11111111-1111-4111-8111-111111111111"],
			"P0 只应命中 priority=P0 的那条",
		);
		const informs = await q("informs");
		assert.ok(
			informs.facts.some((f) => f.ref === "33333333-3333-4333-8333-333333333333"),
			"relation_key=informs 须被命中——改动前关系边对召回完全不可见",
		);
	});
});

test("结构命中：命中理由须写明命中的字段与值（34 §8.2 命中依据可复算）", async () => {
	await withStructuralFixture(async (project) => {
		const r = await recallForAction({
			action: "SG-1", root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		const hit = r.facts.find((f) => f.ref === "11111111-1111-4111-8111-111111111111");
		assert.ok(hit !== undefined, "须命中");
		assert.match(hit.hitReason, /结构命中：/, "理由须标明这是结构命中");
		assert.match(hit.hitReason, /serves=SG-1/, "理由须写明命中了哪个字段、什么值");
	});
});

test("结构命中：命中理由须写明命中的是哪一种书写形态（34 §8.2 披露义务）", async () => {
	const UID = "11111111-1111-4111-8111-111111111111";
	await withStructuralFixture(async (project) => {
		const q = (action) => recallForAction({
			action, root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		const cases = [
			[UID, "完整标识"],
			["11111111", "短标识"],
			["spark-11111111", "类型短名+短标识"],
		];
		for (const [query, form] of cases) {
			const r = await q(query);
			const hit = r.facts.find((f) => f.ref === UID);
			assert.ok(hit !== undefined, `${query} 须命中`);
			assert.ok(
				hit.hitReason.includes(`（${form}）`),
				`${query} 的理由须写明形态「${form}」，实际：${hit.hitReason}`,
			);
			assert.match(
				hit.hitReason, /（(完整标识|短标识|类型短名\+短标识)）/,
				"形态标注须用可识别的固定词，且不得与值里的括号混淆",
			);
		}
		const closed = await q("SG-1");
		const closedHit = closed.facts.find((f) => f.ref === UID);
		assert.ok(closedHit !== undefined, "SG-1 须命中");
		assert.ok(
			!/serves=SG-1（/.test(closedHit.hitReason),
			`serves 是闭集值，无「形态」之分，不得标注。实际：${closedHit.hitReason}`,
		);
	});
});

test("结构命中：不认子串（SG-1 不得命中 SG-10，P1 不得命中 P10）", () => {
	const hits = (tokens, structural) => {
		const cand = { ref: "x", structural };
		return matchCandidate(tokens, cand) !== null;
	};
	const base = {
		serves: "SG-10", priority: "P10", directionKey: "release-gate-v2",
		disposition: "", outcome: "", relationKeys: [], relationTargets: [], refTargets: [],
	};
	assert.equal(hits(tokenize("SG-1"), base), false, "SG-1 不得命中 SG-10");
	assert.equal(hits(tokenize("P1"), base), false, "P1 不得命中 P10");
	assert.equal(hits(tokenize("release-gate"), base), false, "release-gate 不得命中 release-gate-v2");
	assert.equal(hits(tokenize("SG-10"), base), true, "SG-10 须命中 SG-10");
	assert.equal(hits(tokenize("P10"), base), true, "P10 须命中 P10");
});

test("facet：priority 收窄须改变候选池，且被筛掉者进未检查范围（34 §12 逐类披露）", async () => {
	await withStructuralFixture(async (project) => {
		const all = await recallForAction({
			action: "火花 问题", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["spark"],
		});
		assert.equal(all.facts.length, 2, "不设 facet 时两条火花都应在池内");
		const onlyP0 = await recallForAction({
			action: "火花 问题", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["spark"], priority: "P0",
		});
		assert.deepEqual(
			onlyP0.facts.map((f) => f.ref),
			["11111111-1111-4111-8111-111111111111"],
			"priority=P0 只应留下 P0 那条",
		);
		const excluded = onlyP0.uncheckedRange.excludedByFacet;
		assert.equal(excluded.length, 1, "另一条须进未检查范围");
		assert.equal(excluded[0].ref ?? excluded[0].title, "结构测试 火花乙");
		assert.deepEqual(excluded[0].values, { priority: "P1" }, "须给出该对象在 facet 上的实际取值");
		assert.deepEqual(onlyP0.uncheckedRange.appliedFacets, { priority: "P0" });
	});
});

test("facet：未声明该字段的对象不匹配（facet 问的是「谁声明了 X」）", async () => {
	await withStructuralFixture(async (project) => {
		const r = await recallForAction({
			action: "摩擦 现象", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["friction"], relationKey: "informs",
		});
		assert.deepEqual(
			r.facts.map((f) => f.ref),
			["33333333-3333-4333-8333-333333333333"],
			"只有声明了 informs 的那条应留下",
		);
	});
});

test("候选卡：须带类型专属结构字段（F2 投影，02 §9.1）", async () => {
	await withStructuralFixture(async (project) => {
		const r = await recallForAction({
			action: "摩擦 现象", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["friction"],
		});
		const heavy = r.facts.find((f) => f.ref === "33333333-3333-4333-8333-333333333333");
		assert.equal(heavy.structural.occurrenceCount, 5, "卡上须带 occurrence.count");
		assert.deepEqual(heavy.structural.relationKeys, ["informs"], "卡上须带声明的边");
		const spark = await recallForAction({
			action: "火花乙", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["spark"],
		});
		assert.equal(
			spark.facts[0]?.structural?.serves,
			"SG-2",
			"Spark 卡须带 serves/priority（22 §12 的 F1 投影）",
		);
	});
});

test("facet 与 types/statuses 同为硬过滤：不得被读成「排序靠后」", async () => {
	await withStructuralFixture(async (project) => {
		const r = await recallForAction({
			action: "摩擦 现象", root: project, limit: 10, budgetBytes: 400000, includeSpecs: false,
			types: ["friction"], relationKey: "informs",
		});
		const inUnchecked = (r.unchecked?.facts ?? []).some(
			(f) => f.ref === "44444444-4444-4444-8444-444444444444",
		);
		assert.equal(inUnchecked, false, "被 facet 筛掉的对象不得算作「已匹配但被截断」");
	});
});

test("结构命中：夹带在主题查询里时不得抢占排序优势（修我引入的回归）", async () => {
	await withStructuralFixture(async (project) => {
		const q = (action) => recallForAction({
			action, root: project, limit: 3, budgetBytes: 400000, includeSpecs: false,
		});
		const bare = await q("P0");
		assert.ok(
			bare.facts.some((f) => f.hitReason.startsWith("结构命中：")),
			"纯指称查询的结构命中须占优先位（它就是查询的主题）",
		);
		const mixed = await q("结构测试 摩擦现象 销账 P0");
		const priorityFirst = mixed.facts.filter((f) => /^结构命中：/.test(f.hitReason));
		assert.equal(
			priorityFirst.length, 0,
			"带主题的查询里，结构命中不得占据优先位（否则会淹没有关主题的条目）",
		);
		const deferred = mixed.facts.filter((f) => f.hitReason.includes("不占优先位"));
		assert.ok(
			deferred.length > 0,
			"让位的结构命中仍须出现在候选里，并标明「不占优先位」（34 §12 不得静默丢弃）",
		);
	});
});

test("结构命中：实义词阈值是固定常量（02 §9 不得引入权重）", () => {
	assert.equal(STRUCTURAL_BARE_QUERY_MAX_TOKENS, 2);
	assert.equal(STRUCTURAL_DEFERRED_TIER, 5);
	assert.ok(STRUCTURAL_DEFERRED_TIER > MATCH_TIERS[MATCH_TIERS.length - 1].tier);
});


test("tokenize 是段内的：拼接串的 token 集等于各段 token 集之并", () => {
	const cases = [
		["白屏", "测试"],
		["召回", "排序改进"],
		["创建一个 Norm 记录方向", "提交校验"],
		["pre-commit", "白屏"],
		["改一下", "删了"],
		["", "只有一段"],
		["只有一段", ""],
		["", ""],
	];
	for (const [a, b] of cases) {
		const joined = tokenize(`${a}\n${b}`).sort();
		const union = [...new Set([...tokenize(a), ...tokenize(b)])].sort();
		assert.deepEqual(
			joined, union,
			`tokenize 须是段内的：「${a}」+「${b}」的拼接 token 集须等于分段之并`,
		);
	}
});

test("语料缓存：同一份语料二次加载须复用同一解析产物（缓存确实生效）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	const specsFirst = await loadSpecs(joinPath(ROOT, "specs"));
	const specsSecond = await loadSpecs(joinPath(ROOT, "specs"));
	assert.equal(
		specsSecond, specsFirst,
		"同一份规范语料二次加载须复用同一解析产物——否则缓存未生效（性能优化已退化）",
	);
	const factsFirst = await loadFacts(joinPath(ROOT, "ldvh-base"));
	const factsSecond = await loadFacts(joinPath(ROOT, "ldvh-base"));
	assert.equal(
		factsSecond, factsFirst,
		"同一份事实语料二次加载须复用同一解析产物——否则缓存未生效（性能优化已退化）",
	);
	assert.equal(specsSecond.length, specsFirst.length, "复用后条目数须一致");
	assert.equal(factsSecond.length, factsFirst.length, "复用后条目数须一致");
});

test("语料缓存：语料内容改变后须读到新内容（不得返回陈旧解析）", async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");

	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-cache-"));
	const factsDir = joinPath(project, "ldvh-base", "pitfalls");
	try {
		await mkdir(factsDir, { recursive: true });
		const carrier = joinPath(factsDir, "pitfall-11111111-1111-4111-8111-111111111111.md");
		const write = async (marker) => writeFile(carrier, [
			"---",
			"object_uid: 11111111-1111-4111-8111-111111111111",
			"fact_type_key: pitfall",
			"title: 缓存陈旧性用例",
			"status: active",
			"scope: 用于验证语料缓存的失效行为",
			"---",
			"",
			`# 用例`,
			"",
			`标记词：${marker}`,
			"",
		].join("\n"), "utf8");

		await write("甲乙丙标记");
		const before = await recallForAction({
			action: "甲乙丙标记", root: project, limit: 5, includeSpecs: false,
		});
		assert.ok(
			before.facts.some((f) => f.ref === "11111111-1111-4111-8111-111111111111"),
			"首次召回须命中该载体（建立缓存基线）",
		);

		await write("丁戊己标记");

		const afterOld = await recallForAction({
			action: "甲乙丙标记", root: project, limit: 5, includeSpecs: false,
		});
		assert.ok(
			!afterOld.facts.some((f) => f.ref === "11111111-1111-4111-8111-111111111111"),
			"语料内容改动后，旧内容不得再被召回（缓存不得返回陈旧解析）",
		);

		const afterNew = await recallForAction({
			action: "丁戊己标记", root: project, limit: 5, includeSpecs: false,
		});
		assert.ok(
			afterNew.facts.some((f) => f.ref === "11111111-1111-4111-8111-111111111111"),
			"语料内容改动后，新内容须被召回（缓存须按内容换键）",
		);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("语料缓存：新增载体后须被纳入（不得因缓存漏掉新文件）", async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");

	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-cache2-"));
	const factsDir = joinPath(project, "ldvh-base", "pitfalls");
	try {
		await mkdir(factsDir, { recursive: true });
		const write = async (uid, title) => writeFile(joinPath(factsDir, `pitfall-${uid}.md`), [
			"---",
			`object_uid: ${uid}`,
			"fact_type_key: pitfall",
			`title: ${title}`,
			"status: active",
			"scope: 用于验证新增载体是否被纳入缓存",
			"---",
			"",
			"# 用例",
			"",
		].join("\n"), "utf8");

		await write("22222222-2222-4222-8222-222222222222", "首个载体");
		const before = await recallForAction({
			action: "首个载体", root: project, limit: 5, includeSpecs: false,
		});
		assert.ok(
			before.facts.some((f) => f.ref === "22222222-2222-4222-8222-222222222222"),
			"首次召回须命中首个载体",
		);

		await write("33333333-3333-4333-8333-333333333333", "新增载体");
		const after = await recallForAction({
			action: "新增载体", root: project, limit: 5, includeSpecs: false,
		});
		assert.ok(
			after.facts.some((f) => f.ref === "33333333-3333-4333-8333-333333333333"),
			"新增载体须被纳入（缓存键须覆盖新增文件）",
		);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("语料缓存：删除载体后须从候选中消失", async () => {
	const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");

	const project = await mkdtemp(joinPath(tmpdir(), "ldvh-cache3-"));
	const factsDir = joinPath(project, "ldvh-base", "pitfalls");
	try {
		await mkdir(factsDir, { recursive: true });
		const doomed = joinPath(factsDir, "pitfall-44444444-4444-4444-8444-444444444444.md");
		const keeper = joinPath(factsDir, "pitfall-55555555-5555-4555-8555-555555555555.md");
		const carrierText = (uid, title) => [
			"---",
			`object_uid: ${uid}`,
			"fact_type_key: pitfall",
			`title: ${title}`,
			"status: active",
			"scope: 用于验证删除后是否从候选消失",
			"---",
			"",
			"# 用例",
			"",
		].join("\n");
		await writeFile(doomed, carrierText("44444444-4444-4444-8444-444444444444", "待删除载体"), "utf8");
		await writeFile(keeper, carrierText("55555555-5555-4555-8555-555555555555", "保留载体"), "utf8");

		const before = await recallForAction({
			action: "待删除载体", root: project, limit: 5, includeSpecs: false,
		});
		assert.ok(
			before.facts.some((f) => f.ref === "44444444-4444-4444-8444-444444444444"),
			"删除前须能召回该载体",
		);

		await rm(doomed, { force: true });

		const after = await recallForAction({
			action: "待删除载体", root: project, limit: 5, includeSpecs: false,
		});
		assert.ok(
			!after.facts.some((f) => f.ref === "44444444-4444-4444-8444-444444444444"),
			"载体删除后不得继续出现在候选里（缓存键须覆盖删除）",
		);
		assert.equal(
			after.counts.candidatesScanned, 1,
			"删除 1 份后语料应剩 1 份（缓存换键不得吞掉其余载体）",
		);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("语料缓存：事实源只取类型子目录，顶层文件不得混入（goal.md 不是候选）", async () => {
	const facts = await loadFacts(joinPath(ROOT, "ldvh-base"));
	const topLevel = facts.filter((f) => typeof f.dir !== "string" || f.dir === "");
	assert.equal(
		topLevel.length, 0,
		`顶层文件不得进入事实语料（实得 ${topLevel.length} 条）`,
	);
	assert.ok(
		facts.every((f) => typeof f.dir === "string" && f.dir !== ""),
		"每条事实候选都须带类型子目录名",
	);
});

test("token 集缓存：同一候选二次取用须复用同一结果（不重复切词）", () => {
	const candidate = { scope: "召回排序", detail: "适用范围", title: "缓存", bodyText: "正文内容" };
	const first = tokenSetOf(candidate);
	const second = tokenSetOf(candidate);
	assert.equal(second, first, "同一候选二次取用须复用同一 token 集——否则缓存未生效（性能优化已退化）");
	assert.ok(first.wide.has("召回"), "宽面 token 集须含 scope 中的词（防缓存空结果冒充命中）");
});

test("结构命中：接受短形态时须同时声明前缀碰撞边界（34 §8.2、§14 可接受依据＝命中理由原文）", async () => {
	const UID = "22222222-2222-4222-8222-222222222222";
	await withStructuralFixture(async (project) => {
		const q = (action) => recallForAction({
			action, root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		const short = await q("22222222");
		const shortHit = short.facts.find((f) => f.ref === UID);
		assert.ok(shortHit !== undefined, "短标识须命中");
		assert.match(shortHit.hitReason, /短形态边界/, "短标识命中须带前缀碰撞边界声明");
		assert.match(shortHit.hitReason, /前缀碰撞/, "声明须点明碰撞可能");
		assert.match(shortHit.hitReason, /候选可筛选/, "声明须写明这是可筛选而非唯一");
		assert.match(shortHit.hitReason, /不得据此断言该指称无歧义/, "声明须给出读者义务");
		assert.equal(shortHit.shortForm, true, "候选卡须能机械判定「走了短形态」");

		const typed = await q("spark-22222222");
		const typedHit = typed.facts.find((f) => f.ref === UID);
		assert.ok(typedHit !== undefined, "类型短名+短标识须命中");
		assert.match(typedHit.hitReason, /短形态边界/, "类型短名+短标识也须带声明");

		const full = await q(UID);
		const fullHit = full.facts.find((f) => f.ref === UID);
		assert.ok(fullHit !== undefined, "完整标识须命中");
		assert.ok(!/短形态边界/.test(fullHit.hitReason), `完整标识不得带短形态声明。实际：${fullHit.hitReason}`);
		assert.notEqual(fullHit.shortForm, true, "完整标识不得标 shortForm");

		const closed = await q("SG-2");
		const closedHit = closed.facts.find((f) => f.ref === UID);
		assert.ok(closedHit !== undefined, "SG-2 须命中");
		assert.ok(!/短形态边界/.test(closedHit.hitReason), "闭集字段命中不得带短形态声明");
	});
});

test("结构命中：声明与「命中理由被截断」解耦（展示位不足时仍须声明）", async () => {
	const UID = "11111111-1111-4111-8111-111111111111";
	await withStructuralFixture(async (project) => {
		const r = await recallForAction({
			action: "11111111 spark-11111111 SG-1 P0",
			root: project, limit: 5, budgetBytes: 400000, includeSpecs: false,
		});
		const hit = r.facts.find((f) => f.ref === UID);
		assert.ok(hit !== undefined, "多形态 + 闭集字段同时点名须命中");
		assert.ok(hit.hits >= 4, `本用例须命中 ≥4 项结构证据（否则理由不会截断）。实际 hits=${hit.hits}`);
		assert.match(hit.hitReason, /等/, `理由须进入截断形态（否则本用例没有证明力）。实际：${hit.hitReason}`);
		assert.match(
			hit.hitReason, /短形态边界/,
			`理由被截断时短形态声明仍须存在。实际：${hit.hitReason}`,
		);
	});
});

