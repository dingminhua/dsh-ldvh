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
import { skipWithoutCorpus, seedFactCorpus } from "./helpers.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const q = (o) => recallForAction({ root: ROOT, excludeTypes: INJECTION_EXCLUDED_TYPES, ...o });

test("集成：历轮修复须同时成立（跨文件交互不得互相破坏）", async (t) => {
	if (await skipWithoutCorpus(t)) return;
	for (const t of ["改一下", "删了", "加个"]) {
		const r = await buildRecallInjection({ userText: t, projectRoot: ROOT });
		assert.equal(r.inject, true, `短指令「${t}」应可召回`);
	}

	const base = await q({ action: "把 34 号规范改名", limit: 3, budgetBytes: 2400 });
	assert.ok(base.counts?.candidatesScanned > 0, "counts 可观察");
	assert.ok(base.pagination !== undefined, "pagination 可观察");
	assert.ok(base.fingerprint?.value !== undefined, "fingerprint 可观察");
	assert.ok(base.uncheckedRange !== undefined, "uncheckedRange 可观察");
	assert.ok(base.f0 !== undefined, "F0 可观察");

	const ranked = await q({ action: "把 34 号规范改名成双源召回", limit: 3, budgetBytes: 2400 });
	assert.equal(ranked.specs.filter((s) => s.weakHit).length, 0, "弱命中不应占名额");

	const named = await q({ action: "写一个 Pitfall", limit: 2, budgetBytes: 24000 });
	assert.ok(named.specs[0]?.title?.includes("Pitfall"), "类型点名须居首");

	const pitfallCorpus = await mkdtemp(join(tmpdir(), "ldvh-integ-pitfall-"));
	try {
		await seedFactCorpus(pitfallCorpus, { pitfallCount: 2 });
		const pitfall = await recallForAction({
			action: "写一条 Pitfall 经验",
			root: pitfallCorpus,
			limit: 3,
			budgetBytes: 24000,
			excludeTypes: INJECTION_EXCLUDED_TYPES,
		});
		assert.ok(pitfall.facts.some((f) => f.type === "pitfall"), "须召回 pitfall（义务召回，23 §12）");
	} finally {
		await rm(pitfallCorpus, { recursive: true, force: true });
	}

	assert.ok(REGISTERED_FACT_TYPES.length >= 7, "白名单须覆盖至少 7 个已登记类型");
	for (const t of REGISTERED_FACT_TYPES) {
		if (t === "goal") continue;
		assert.ok(
			Array.isArray(DEFAULT_STATUSES_BY_TYPE[t]) && DEFAULT_STATUSES_BY_TYPE[t].length > 0,
			`白名单类型「${t}」缺默认候选状态定义——该类型将默认零召回`,
		);
	}

	const narrow = await q({ action: "把 34 号规范改名", limit: 3, types: ["norm"] });
	assert.notEqual(
		narrow.counts.candidatesScanned,
		base.counts.candidatesScanned,
		"candidatesScanned 须随过滤变化",
	);

	assert.ok((await q({ action: "代码", limit: 3 })).specs.length > 0, "短查询可召回");


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

	const friction = await q({ action: "这条 friction 该销账吗", limit: 5, types: ["friction"], budgetBytes: 40000 });
	assert.ok(friction.facts.length > 0, "friction 默认候选须非空");
	for (const f of friction.facts) {
		assert.ok(["open", "observing"].includes(f.status), `friction 默认不应含 ${f.status}`);
	}
	assert.deepEqual([...DEFAULT_STATUSES_BY_TYPE.spark], ["open"], "spark 默认候选是 open");

	assert.ok(base.facts.every((f) => f.excerpt?.length > 0), "摘录不得为空");
	assert.ok(base.facts.every((f) => f.excerpt.length <= 121), "摘录须有界");
	const withExcerptBudget = 4000;
	const excerptBase = await q({ action: "把 34 号规范改名", limit: 3, budgetBytes: withExcerptBudget });
	assert.ok(
		excerptBase.facts.every((f) => f.excerpt?.length > 0),
		`预算 ${withExcerptBudget} 下摘录不得为空`,
	);
	assert.match(renderRecallRow(excerptBase), /↳ /, "渲染须显示摘录");

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
			await access(s.absolutePath);
		}
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});
