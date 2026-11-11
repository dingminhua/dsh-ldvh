// 跨历轮修复的**集成回归**：一次跑完全部关键行为。
//
// 为什么需要它（2026-10-24，第 51 轮）：单项行为已各有测试，但它们分散在
// source-recall / recall-injection / lifecycle 三个文件里。**跨文件的交互退化**
// （例如「按类型默认状态」改动使「弱命中排序」失效）不会被任何单文件测试抓到。
// 本文件把历轮修复收敛成一组面向行为的断言，作为改动的守门。
//
// 每条断言都注明它守的是哪一轮的缺陷，便于追溯。
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
	DEFAULT_STATUSES_BY_TYPE,
	INJECTION_EXCLUDED_TYPES,
	REGISTERED_FACT_TYPES,
	recallForAction,
} from "../lib/source-recall.js";
import { buildRecallInjection, renderRecallRow } from "../lib/recall-injection.js";
import { skipWithoutCorpus } from "./helpers.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
// **默认按注入路径的声明范围调用**（2026-10-30）：`q` 是「模拟一次注入会看到什么」
// 的简写，而注入路径（`buildRecallInjection`）恒传
// `excludeTypes: INJECTION_EXCLUDED_TYPES`——`31 §10`（2026-10-27 修订）已让 spark
// 退出自动注入。此前 `q` 不传，于是它与注入路径扫的是不同的候选集合：
// spark 参与排序并占掉 limit 名额，「写一个 ADR」limit=3 时一条 adr 都进不来
// （实测裸调用 `spark,friction,spark`，加参 `friction,adr,adr`）——用例转红而
// 实现无退化。需要**直调路径**语义的用例须显式覆盖 `excludeTypes: undefined`。
const q = (o) => recallForAction({ root: ROOT, excludeTypes: INJECTION_EXCLUDED_TYPES, ...o });

test("集成：历轮修复须同时成立（跨文件交互不得互相破坏）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	// 第 16 轮：短指令仍能召回（单字兜底路径）。
	for (const t of ["改一下", "删了", "加个"]) {
		const r = await buildRecallInjection({ userText: t, projectRoot: ROOT });
		assert.equal(r.inject, true, `短指令「${t}」应可召回`);
	}

	// 第 23 轮：02 §9.1 的六项可观察量同时在场。
	const base = await q({ action: "把 34 号规范改名", limit: 3, budgetBytes: 2400 });
	assert.ok(base.counts?.candidatesScanned > 0, "counts 可观察");
	assert.ok(base.pagination !== undefined, "pagination 可观察");
	assert.ok(base.fingerprint?.value !== undefined, "fingerprint 可观察");
	assert.ok(base.uncheckedRange !== undefined, "uncheckedRange 可观察");
	assert.ok(base.f0 !== undefined, "F0 可观察");

	// 第 27 轮：弱命中不得抢占强命中的名额。
	const ranked = await q({ action: "把 34 号规范改名成双源召回", limit: 3, budgetBytes: 2400 });
	assert.equal(ranked.specs.filter((s) => s.weakHit).length, 0, "弱命中不应占名额");

	// 第 28 轮：类型点名层（且只对规范生效）。
	const wc = await q({ action: "写一个 WorkCase", limit: 2, budgetBytes: 24000 });
	assert.ok(wc.specs[0]?.title?.includes("WorkCase"), "类型点名须居首");

	// 第 29 轮：ADR/Pitfall 事实优先。
	const adr = await q({ action: "写一个 ADR", limit: 3, budgetBytes: 24000 });
	assert.ok(adr.facts.some((f) => f.type === "adr"), "须召回 adr");

	// 第 31 轮：中间产物白名单。
	// **2026-11-01 改为不写死条数**（第 6 次同类转红，friction-943940d6）：
	// 原先此处断言 `REGISTERED_FACT_TYPES.length === 9`（此前 8），每当新增一个
	// 事实类型——一次**完全正常的登记动作**——它就会转红，而被测代码并无退化。
	// 把「有几个类型」当作断言对象是错的目标：该用例守的是**中间产物不进候选**，
	// 与类型总数无关。改守真正的行为：白名单每类都能在默认状态表里被认到——
	// 新增类型时该断言**自动跟随**，不再需要人工改数字。
	assert.ok(REGISTERED_FACT_TYPES.length >= 8, "白名单须覆盖至少 8 个已登记类型");
	for (const t of REGISTERED_FACT_TYPES) {
		if (t === "goal") continue; // Goal 是单例，不使用多例状态机（25 §7）
		assert.ok(
			Array.isArray(DEFAULT_STATUSES_BY_TYPE[t]) && DEFAULT_STATUSES_BY_TYPE[t].length > 0,
			`白名单类型「${t}」缺默认候选状态定义——该类型将默认零召回`,
		);
	}

	// 第 33 轮：candidatesScanned 非恒量。
	const narrow = await q({ action: "把 34 号规范改名", limit: 3, types: ["adr"] });
	assert.notEqual(
		narrow.counts.candidatesScanned,
		base.counts.candidatesScanned,
		"candidatesScanned 须随过滤变化",
	);

	// 第 43 轮：短查询不被正文层门槛挡死。
	assert.ok((await q({ action: "代码", limit: 3 })).specs.length > 0, "短查询可召回");

	// 第 45 轮：正文层不吃 frontmatter 字段名。
	assert.equal(
		(await q({ action: "positioning", limit: 99, budgetBytes: 400000 })).specs.length,
		0,
		"positioning 属纯 frontmatter，不得命中",
	);

	// 第 46 轮：事实正文全文参与匹配（「规避」在被截断过的后半段）。
	//
	// ── 2026-11-12 改为夹具 ────────────────────────────────────────────────
	// 原为 `q({action:"怎么规避这个坑"})` 后断言「必有一条靠『规避』命中」。
	// 该断言依赖真实语料里恰好有一条 active 且正文含「规避」的长载体排得进
	// top-5——属**未声明的偶然事实**。实测击穿：旧调研 research-9b42bb7a
	// 按 Human 决定退场（active→retired）后，24 §12 的默认候选状态集把它
	// 排除，那条唯一载体消失，本用例转红而**被测代码无退化**（同
	// friction-943940d6：一次正常的对象登记/退场不该击穿性能或行为回归）。
	//
	// 本文件是**跨文件交互**的守门，它该守的是「正文层与排序层的接口没被
	// 破坏」，而非某条真实载体还在不在。故改用一条自造载体精确测定：正文
	// 1200 字符之后的词必须仍然参与匹配。详细判据在
	// source-recall.test.mjs 的同名用例，此处只做集成层复核。
	{
		const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const tail = await mkdtemp(join(tmpdir(), "recall-int-tail-"));
		try {
			const dir = join(tail, "ldvh-base", "pitfalls");
			await mkdir(dir, { recursive: true });
			const front = "本节描述受控写入环节观察到的现象，涉及载体一致性校验与前置条件核对顺序。".repeat(45);
			await writeFile(
				join(dir, "pitfall-cccccccc-cccc-4ccc-8ccc-cccccccccccc.md"),
				[
					"---",
					"title: 夹具 集成层后半段可见性",
					"status: active",
					"scope: 适用于夹具的集成层后半段可见性场景",
					"object_uid: cccccccc-cccc-4ccc-8ccc-cccccccccccc",
					"fact_type_key: pitfall",
					"---",
					"",
					"# 夹具 集成层后半段可见性",
					"",
					"## 症状",
					"",
					front,
					"",
					"## 规避",
					"",
					"应当椎间盘式地绕开这一写法。",
					"",
				].join("\n"),
			);
			const avoid = await recallForAction({
				action: "规避",
				root: tail,
				limit: 5,
				budgetBytes: 200_000,
				includeSpecs: false,
			});
			assert.ok(
				avoid.facts.some((f) => /规避/.test(f.hitReason)),
				`正文后半段的「规避」须经注入路径参与匹配：${avoid.facts.map((f) => f.hitReason).join(" / ")}`,
			);
		} finally {
			await rm(tail, { recursive: true, force: true });
		}
	}

	// 第 48 轮：按类型取默认候选状态集。
	const friction = await q({ action: "这条 friction 该销账吗", limit: 5, types: ["friction"], budgetBytes: 40000 });
	assert.ok(friction.facts.length > 0, "friction 默认候选须非空");
	for (const f of friction.facts) {
		assert.ok(["open", "observing"].includes(f.status), `friction 默认不应含 ${f.status}`);
	}
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.spark], ["open"], "spark 默认候选是 open");

	// 第 50 轮：F2 有界确定性摘录，且渲染层要显示。
	assert.ok(base.facts.every((f) => f.excerpt?.length > 0), "摘录不得为空");
	assert.ok(base.facts.every((f) => f.excerpt.length <= 121), "摘录须有界");
	// **本条单独取一个装得下的预算**（2026-11-11 修）：
	// `base` 用的是 2400 字节，而该档的固定披露行本身就要约 2000 字节，
	// 候选连一张都放不下——用它验「渲染层会显示摘录」这**个能力**是选错了参数，
	// 验的成了「极小预算下装不下」。实测摘录要到 3600 档才出现
	// （3600→3211 字节、4000→3696 字节，均未超预算）。
	// 该断言要验的是能力，故取能装下的预算；「极小预算下的取舍」由
	// 预算让位相关用例单独覆盖，不在这里重复。
	const withExcerptBudget = 4000;
	const excerptBase = await q({ action: "把 34 号规范改名", limit: 3, budgetBytes: withExcerptBudget });
	assert.ok(
		excerptBase.facts.every((f) => f.excerpt?.length > 0),
		`预算 ${withExcerptBudget} 下摘录不得为空`,
	);
	assert.match(renderRecallRow(excerptBase), /↳ /, "渲染须显示摘录");

	// 第 34 轮：双源各得份额，且不静默截断。
	assert.ok(base.specs.length > 0 && base.facts.length > 0, "双源皆须有结果");
	assert.ok(base.truncated === false || base.partial === true, "截断须可观察");
});

test("集成：回退来源下 absolutePath 可读（第 36 轮）", async () => {
	const project = await mkdtemp(join(tmpdir(), "ldvh-int-"));
	try {
		const r = await recallForAction({ action: "把 34 号规范改名", root: project, limit: 2 });
		assert.equal(r.sourceView.specsAreProjectAuthored, false, "应回退到外部语料");
		assert.ok(r.specs.length > 0, "应召回规范");
		for (const s of r.specs) {
			await access(s.absolutePath); // 必须真的可读
		}
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});
