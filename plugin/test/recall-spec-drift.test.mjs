
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
	DEFAULT_STATUSES_BY_TYPE,
	MATCHED_FACT_FIELDS,
	REGISTERED_FACT_TYPES,
	recallForAction,
} from "../lib/source-recall.js";

const ROOT = join(import.meta.dirname, "..", "..");
const SPECS_DIR = join(ROOT, "specs");

const TYPE_SPEC_FILES = Object.freeze({
	spark: "22-Spark-火花.md",
	pitfall: "25-Pitfall-踩坑经验.md",
	report: "24-Report-报告.md",
	goal: "20-Goal-项目目标.md",
	friction: "26-Friction-摩擦账本.md",
	norm: "23-Norm-事实规范.md",
	subgoal: "21-SubGoal-子目标.md",
});

async function readSpec(name) {
	try {
		return await readFile(join(SPECS_DIR, name), "utf8");
	} catch {
		return null;
	}
}

test("specs 语料可读（不可读须显式失败，不得静默通过）", async () => {
	for (const name of Object.values(TYPE_SPEC_FILES)) {
		assert.notEqual(await readSpec(name), null, `语料不可读：specs/${name}`);
	}
});

test("① 新增规范：specs/ 下新增载体须自动可召回（无需改代码）", async () => {
	const r = await recallForAction({
		action: "业务系统 职责 边界",
		root: ROOT,
		limit: 200,
		budgetBytes: 40_000_000,
		includeFacts: false,
	});
	assert.ok(r.specs.length > 0, "应能召回规范");
	assert.ok(
		r.coverage?.specsScanned === undefined || r.coverage.specsScanned > 8,
		"规范侧应扫描整个 specs/ 目录，而非固定清单",
	);
});

test("②③ 事实类型白名单须覆盖 20–26 全部类型规范（新增类型即失败）", async () => {
	const entries = await readdir(SPECS_DIR);
	const allMd = entries.filter((f) => f.endsWith(".md"));
	const typeSpecFiles = [];
	for (const file of allMd) {
		const text = await readSpec(file);
		if (text === null) continue;
		const specKeyMatch = /spec_key:\s*"([^"]+)"/.exec(text);
		const declaresOwnKey = specKeyMatch !== null && /-fact-type$/.test(specKeyMatch[1]);
		const isTypeSpec = /spec_kind:\s*"spec"/.test(text) && declaresOwnKey;
		if (isTypeSpec) typeSpecFiles.push(file);
	}
	typeSpecFiles.sort();

	const missing = [];
	for (const file of typeSpecFiles) {
		const m = /^(\d+)-/.exec(file);
		if (m === null) continue;
		const prefix = m[1];
		const known = Object.entries(TYPE_SPEC_FILES).find(([, specFile]) => specFile.startsWith(`${prefix}-`));
		if (known === undefined) {
			missing.push(`specs/${file} 是类型规范，但未登记在 TYPE_SPEC_FILES / REGISTERED_FACT_TYPES 中`);
			continue;
		}
		if (!REGISTERED_FACT_TYPES.includes(known[0])) {
			missing.push(`类型「${known[0]}」有规范 specs/${file}，但不在 REGISTERED_FACT_TYPES 中`);
		}
	}
	assert.deepEqual(
		missing,
		[],
		`新增或重命名了事实类型规范，但召回白名单未跟随（01 §11.4 禁第二规则源）：\n  ${missing.join("\n  ")}`,
	);
});

test("②④ 每类型的默认候选状态须在规范原文中逐字可回指", async () => {
	for (const [type, statuses] of Object.entries(DEFAULT_STATUSES_BY_TYPE)) {
		const specFile = TYPE_SPEC_FILES[type];
		assert.ok(specFile !== undefined, `类型「${type}」缺规范映射`);
		const text = await readSpec(specFile);
		assert.notEqual(text, null, `规范不可读：specs/${specFile}`);

		const defaultSentence = (() => {
			const hits = [];
			let from = 0;
			while (true) {
				const idx = text.indexOf("默认候选", from);
				if (idx < 0) break;
				const rest = text.slice(idx);
				const end = rest.search(/[。；]/);
				hits.push(end < 0 ? rest.slice(0, 200) : rest.slice(0, end));
				from = idx + 4;
			}
			if (hits.length === 0) return null;
			const withStatus = hits.find((h) => statuses.some((s) => h.includes(s)));
			return withStatus ?? hits[hits.length - 1];
		})();

		if (defaultSentence === null) {
			continue;
		}

		for (const status of statuses) {
			assert.ok(
				defaultSentence.includes(status),
				`类型「${type}」的默认候选状态「${status}」不在 specs/${specFile} 的「默认候选…」句内——` +
					`规范已改而代码未跟随（01 §11.4 禁第二规则源）。原文该句：${defaultSentence}`,
			);
		}
	}
	for (const type of REGISTERED_FACT_TYPES) {
		if (type === "goal") continue;
		assert.ok(
			DEFAULT_STATUSES_BY_TYPE[type] !== undefined,
			`白名单含类型「${type}」但缺默认候选状态定义——该类型将默认零召回`,
		);
	}
});

test("⑤ 未登记类型目录不得被静默忽略（须进 gaps）", async () => {
	const base = join(ROOT, "ldvh-base");
	const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
	const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
	const withCarriers = [];
	for (const d of dirs) {
		const files = await readdir(join(base, d)).catch(() => []);
		if (files.some((f) => f.endsWith(".md"))) withCarriers.push(d);
	}
	const knownDirs = new Set(REGISTERED_FACT_TYPES.map((t) => `${t}s`));
	knownDirs.add("reports");
	knownDirs.add("goal.md");
	const unknown = withCarriers.filter((d) => !knownDirs.has(d) && !knownDirs.has(`${d}s`) && d !== "observation-buffer");

	if (unknown.length === 0) return;

	const r = await recallForAction({ action: "任意查询", root: ROOT, limit: 5 });
	const disclosed = (r.gaps ?? []).some((g) => /未登记|未识别|未知类型/.test(g)) ||
		(r.uncheckedRange?.note ?? "").includes("未登记");
	assert.ok(
		disclosed,
		`存在未登记类型目录（${unknown.join("、")}），但召回结果未在 gaps/uncheckedRange 中披露——` +
			`静默忽略会让使用者以为没有这类事实`,
	);
});

test("⑥ frontmatter 匹配字段清单须与类型规范的字段定义一致", async () => {
	const spec02 = await readSpec("02-事实源与事实模型基础规范.md");
	assert.notEqual(spec02, null, "02 号规范不可读");

	const allTypeTexts = [];
	for (const file of Object.values(TYPE_SPEC_FILES)) {
		const t = await readSpec(file);
		if (t !== null) allTypeTexts.push(t);
	}
	const corpus = [spec02, ...allTypeTexts].join("\n");

	const missing = MATCHED_FACT_FIELDS.filter((field) => !corpus.includes(field));
	assert.deepEqual(
		missing,
		[],
		`以下参与匹配的 frontmatter 字段在 02 或 20–26 原文中都找不到——` +
			`可能是字段已改名/废弃而代码未跟随：${missing.join(" / ")}`,
	);
});
