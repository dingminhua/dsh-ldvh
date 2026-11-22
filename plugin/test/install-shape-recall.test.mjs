import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { pluginRoot, withTemp } from "./helpers.mjs";

const RECALL_MODULE_CLOSURE = Object.freeze([
	"source-recall.js",
	"recall-criteria.js",
	"friction-writer.js",
	"signature-channel.js",
	"after-integrity.js",
	"object-identifier.js",
	"object-reference.js",
	"carrier-scan.js",
	"markdown-structure.js",
	"write-diagnostics.js",
	"coherence-report.js",
	"norm-positioning.js",
	"runtime-carrier-reader.js",
]);

const GOAL_UID = "11111111-1111-4111-8111-111111111111";
const PIT_UID = "22222222-2222-4222-8222-222222222222";

function criteriaTable() {
	return [
		"## 召回与消费",
		"",
		"| 判据项（recall-criteria/v1） | 本类型规则 | 机械值 | 依据/理由 |",
		"|---|---|---|---|",
		"| 召回时机 | 任意 |  | 说明 |",
		"| 默认候选状态 | 见机械值 | active | 说明 |",
		"| 核心语义字段 | 见机械值 | title, scope | 说明 |",
		"| 类型词别名 | 见机械值 | 踩坑经验 | 说明 |",
		"| 关系展开 | 不采用 | 不采用 | 说明 |",
		"| F3/F4 展开 | 不采用 |  | 说明 |",
		"| 条数上限归属 | 不采用 | 不采用 | 说明 |",
		"",
	].join("\n");
}

async function installShapedRecall(base) {
	await mkdir(join(base, "lib"), { recursive: true });
	for (const name of RECALL_MODULE_CLOSURE) {
		await cp(join(pluginRoot, "lib", name), join(base, "lib", name));
	}
	await mkdir(join(base, "node_modules"), { recursive: true });
	await cp(join(pluginRoot, "node_modules", "yaml"), join(base, "node_modules", "yaml"), { recursive: true });
	return await import(pathToFileURL(join(base, "lib", "source-recall.js")).href);
}

async function writeProject(project) {
	await mkdir(join(project, "ldvh-base", "goals"), { recursive: true });
	await mkdir(join(project, "ldvh-base", "pitfalls"), { recursive: true });
	await writeFile(
		join(project, "ldvh-base", "goals", "project-goal.md"),
		`---\ntitle: 目标计划甲\nstatus: active\nobject_uid: ${GOAL_UID}\nfact_type_key: goal\n---\n\n正文\n`,
		"utf8",
	);
	await writeFile(
		join(project, "ldvh-base", "pitfalls", "repeat-submit.md"),
		`---\ntitle: 接口重复提交\nstatus: active\nobject_uid: ${PIT_UID}\nfact_type_key: pitfall\nscope: 接口层\n---\n\n正文\n`,
		"utf8",
	);
}

const QUERY = {
	action: "目标计划甲 接口重复提交",
	limit: 10,
	budgetBytes: 400_000,
	includeSpecs: false,
	includeCarriers: false,
};

test("安装形态：规范源不可读且无具名兜底的类型（goal）不得按 active 成为候选", async () => {
	await withTemp("ldvh-install-shape-", async (base) => {
		const recall = await installShapedRecall(base);
		const project = join(base, "project");
		await writeProject(project);

		assert.equal(
			await recall.resolveSpecsRoot(project),
			null,
			"前提：安装形态下三级回退均无规范语料（否则本条测的不是安装形态）",
		);

		const r = await recall.recallForAction({ ...QUERY, root: project });
		assert.equal(r.ok, true);
		assert.ok(
			!r.facts.some((fact) => fact.ref === GOAL_UID),
			"判据表不可用时，没有登记机械值的 goal 不得成为候选（不得回落 active）",
		);
		assert.ok(
			r.facts.some((fact) => fact.ref === PIT_UID),
			"对照：有具名兜底值的 pitfall 仍按兜底状态是候选（本条不得连带收紧其它类型）",
		);
		assert.equal(r.criteria.ok, false, "判据表不可用须如实报出");
		assert.deepEqual(r.criteria.nonCandidateTypes, [], "判据表不可读时没有「不采用」条目可报");
		assert.ok(
			r.gaps.some((gap) => gap.includes("该类型的机械判据不可用，故不作为候选") && gap.includes("goal")),
			"缺口披露须点明 goal 因机械判据不可用而不作为候选",
		);
		assert.ok(
			r.uncheckedRange.excludedByNonCandidate.some((fact) => fact.path.includes("project-goal.md")),
			"被挡下的 goal 须进「非候选」单列披露",
		);
		assert.ok(
			!r.uncheckedRange.excludedByStatus.some((fact) => fact.path.includes("project-goal.md")),
			"不得混进「状态不符」名单（放宽状态对它无效，混列会误导）",
		);
	});
});

test("判据表可读但缺该类型条目：goal 仍不按兜底 active 成为候选", async () => {
	await withTemp("ldvh-install-shape-partial-", async (base) => {
		const recall = await installShapedRecall(base);
		const project = join(base, "project");
		await writeProject(project);
		await mkdir(join(base, "specs"), { recursive: true });
		await writeFile(
			join(base, "specs", "25-Pitfall-踩坑经验.md"),
			`---\nldvh_spec:\n  spec_id: "25"\n---\n\n# 规范\n\n${criteriaTable()}`,
			"utf8",
		);

		assert.notEqual(await recall.resolveSpecsRoot(project), null, "前提：本次判据表可读");

		const r = await recall.recallForAction({ ...QUERY, root: project });
		assert.equal(r.ok, true);
		assert.ok(
			!r.facts.some((fact) => fact.ref === GOAL_UID),
			"判据表没有 goal 条目时，不得按兜底 active 把 goal 当作候选",
		);
		assert.ok(
			r.facts.some((fact) => fact.ref === PIT_UID),
			"对照：pitfall 有条目，仍按表内 active 成为候选",
		);
		assert.ok(
			r.gaps.some((gap) => gap.includes("该类型的机械判据不可用，故不作为候选") && gap.includes("goal")),
			"缺口披露须点明 goal 的机械判据不可用",
		);
	});
});
