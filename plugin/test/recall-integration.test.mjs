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
	REGISTERED_FACT_TYPES,
	recallForAction,
} from "../lib/source-recall.js";
import { buildRecallInjection, renderRecallRow } from "../lib/recall-injection.js";

const ROOT = join(import.meta.dirname, "..", "..");
const q = (o) => recallForAction({ root: ROOT, ...o });

test("集成：历轮修复须同时成立（跨文件交互不得互相破坏）", async () => {
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
	assert.equal(REGISTERED_FACT_TYPES.length, 8, "白名单须为 8 个已登记类型");

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
	const avoid = await q({ action: "怎么规避这个坑", limit: 5, budgetBytes: 40000, includeSpecs: false });
	assert.ok(avoid.facts.some((f) => /规避/.test(f.hitReason)), "「规避」须可召回");

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
	assert.match(renderRecallRow(base), /↳ /, "渲染须显示摘录");

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
