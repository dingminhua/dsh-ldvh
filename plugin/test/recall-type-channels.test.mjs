// tests for 类型通道召回（2026-10-31）——②类型点名 / ③触发信号标注 /
// ④核心语义字段 / ⑤关系展开 / ⑥注入分节名额。
//
// 权威：specs/02 §12.4「机器可读召回判据表（格式契约）」、specs/34 §12
// （截断须标明来源）、specs/31 §10（spark 不进自动注入）、specs/10 §9.1
// 第 2 项（预算与名额属 Human Gate）。
//
// 判据表解析本身由 `recall-criteria.test.mjs` 守护；本文件守的是
// **判据表的机器值是否真的被消费**，以及消费失败时是否 fail-closed。

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	loadFacts,
	recallForAction,
	selectFactsBySection,
} from "../lib/source-recall.js";
import {
	FACT_SECTION_LABELS,
	FACT_SECTION_ORDER,
	QUOTA_BY_TYPE,
	renderRecallRow,
} from "../lib/recall-injection.js";

const ADR_UID = "22222222-2222-4222-8222-222222222222";
const OLD_UID = "33333333-3333-4333-8333-333333333333";
const PIT_UID = "44444444-4444-4444-8444-444444444444";
const SPARK_UID = "55555555-5555-4555-8555-555555555555";

/** 判据表（合法形态）：判据项七项齐备、版本标记在表头。 */
function criteriaTable({ defaultStatuses, coreFields, aliases, relations }) {
	return [
		"## 召回与消费",
		"",
		"| 判据项（recall-criteria/v1） | 本类型规则 | 机械值 | 依据/理由 |",
		"|---|---|---|---|",
		`| 召回时机 | 任意 |  | 说明 |`,
		`| 默认候选状态 | 见机械值 | ${defaultStatuses} | 说明 |`,
		`| 核心语义字段 | 见机械值 | ${coreFields} | 说明 |`,
		`| 类型词别名 | 见机械值 | ${aliases} | 说明 |`,
		`| 关系展开 | 见机械值 | ${relations} | 说明 |`,
		`| F3/F4 展开 | 不采用 |  | 说明 |`,
		`| 条数上限归属 | 不采用 |  | 说明 |`,
		"",
	].join("\n");
}

async function withProject({ brokenPitfallTable = false } = {}, fn) {
	const project = await mkdtemp(join(tmpdir(), "ldvh-typechannels-"));
	const write = async (relative, text) => {
		const absolute = join(project, relative);
		await mkdir(join(absolute, ".."), { recursive: true });
		await writeFile(absolute, text, "utf8");
	};
	const spec = async (name, table) => write(`specs/${name}`, `---\nldvh_spec:\n  spec_id: "${name.slice(0, 2)}"\n---\n\n# 规范\n\n${table}`);
	const fact = async (dir, uid, fm, body = "") => write(`ldvh-base/${dir}/${uid}.md`, `---\n${fm.trim()}\n---\n\n${body}\n`);
	try {
		await spec("20-Spark-火花.md", criteriaTable({
			defaultStatuses: "open", coreFields: "question, summary", aliases: "火花", relations: "merged-into->spark",
		}));
		await spec("22-ADR-决策.md", criteriaTable({
			defaultStatuses: "active", coreFields: "decision, scope", aliases: "决策记录", relations: "superseded-by->adr",
		}));
		const pitfallTable = criteriaTable({
			defaultStatuses: "active", coreFields: "title, scope", aliases: "踩坑经验", relations: "不采用",
		});
		await spec(
			"23-Pitfall-踩坑经验.md",
			// **失效判据表的构造**：版本标记换成不认识的版本 ⇒ 该类型机器判据停用。
			brokenPitfallTable ? pitfallTable.replace("recall-criteria/v1", "recall-criteria/v2") : pitfallTable,
		);
		await fact("adrs", ADR_UID, `title: 类型通道 决策甲
status: active
object_uid: ${ADR_UID}
fact_type_key: adr
decision: 统一幂等键决策标记甲
scope: 接口层
gist: 非核心字段标记乙
relations:
  - relation_key: superseded-by
    target:
      object_uid: ${OLD_UID}`);
		await fact("adrs", OLD_UID, `title: 类型通道 旧决策
status: active
object_uid: ${OLD_UID}
fact_type_key: adr
decision: 旧决策内容
scope: 接口层`);
		await fact("pitfalls", PIT_UID, `title: 接口重复提交
status: active
object_uid: ${PIT_UID}
fact_type_key: pitfall
scope: 接口层
trigger_signal: 幂等`);
		await fact("sparks", SPARK_UID, `title: 火花甲
status: open
object_uid: ${SPARK_UID}
fact_type_key: spark
question: 火花甲的问题
summary: 火花甲的理解`);
		return await fn(project);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
}

const QUERY = { limit: 20, budgetBytes: 400_000, includeSpecs: false };

test("④ 核心语义字段：detail 只取判据表登记的字段（其它 frontmatter 不进口径）", async () => {
	await withProject({}, async (project) => {
		const facts = await loadFacts(join(project, "ldvh-base"));
		const adr = facts.find((fact) => fact.ref === ADR_UID);
		assert.ok(adr.detail.includes("统一幂等键决策标记甲"), "核心字段 decision 须进 detail");
		assert.ok(adr.detail.includes("接口层"), "核心字段 scope 须进 detail");
		assert.ok(!adr.detail.includes("非核心字段标记乙"), "未登记的 gist 不得进 detail（按判据表消费）");
		// 判据可用时，类型点名闭集须带别名。
		assert.ok(adr.typeNames.includes("adr"), "fact_type_key 派生词须在闭集里");
		assert.ok(adr.typeNames.includes("决策记录"), "判据表别名须在闭集里");
	});
});

test("④ 判据表失效：该类型停用机器判据（detail 为空 + 如实报错），不回落默认值", async () => {
	await withProject({ brokenPitfallTable: true }, async (project) => {
		const facts = await loadFacts(join(project, "ldvh-base"));
		const pitfall = facts.find((fact) => fact.ref === PIT_UID);
		assert.equal(pitfall.machineCriteria, "disabled", "判据不可用须标为 disabled");
		assert.equal(pitfall.detail, "", "机器判据停用时不得用默认字段拼 detail");
		assert.deepEqual(pitfall.typeNames, [], "停用后不得做类型点名");
		assert.ok(pitfall.criteriaError.length > 0, "须如实报错（说明缺什么）");
		// 标题/正文通道不受影响：类型停用的是**机器判据**，不是该类型的召回资格。
		const r = await recallForAction({ ...QUERY, action: "接口重复提交", root: project });
		assert.equal(r.ok, true);
		assert.ok(r.facts.some((fact) => fact.ref === PIT_UID), "标题命中仍须可召回");
		assert.equal(r.criteria.ok, false, "结果须带判据失败");
		assert.ok(r.criteria.disabledTypes.includes("pitfall"), "须列出被停用的类型");
		assert.ok(
			r.gaps.some((gap) => typeof gap === "string" && gap.includes("判据")),
			"判据失效须进 gaps（34 §12 披露）",
		);
	});
});

test("② 类型点名：事实对象按闭集点名（ADR / 中文别名），命中给 tier 0.5", async () => {
	await withProject({}, async (project) => {
		for (const action of ["ADR", "决策记录"]) {
			const r = await recallForAction({ ...QUERY, action, root: project });
			const adr = r.facts.find((fact) => fact.ref === ADR_UID);
			assert.ok(adr !== undefined, `「${action}」须召回 ADR`);
			assert.equal(adr.tier, 0.5, `「${action}」是纯指称，应给类型点名层`);
			assert.match(adr.hitReason, /类型点名命中/);
		}
		// **闭集**：`agent` 不在任何类型的派生词/别名里 —— 它是历史上让 4 条调研
		// 冲顶的开放词表词，不得因类型点名重新变成通配。
		const agents = await recallForAction({ ...QUERY, action: "agent", root: project });
		assert.ok(
			!agents.facts.some((fact) => /类型点名命中/.test(fact.hitReason)),
			"闭集之外的词不得触发类型点名",
		);
	});
});

test("② 类型点名：中文别名右侧须是边界（「火花乙」不点名 spark）", async () => {
	await withProject({}, async (project) => {
		const r = await recallForAction({ ...QUERY, action: "火花乙", root: project });
		assert.ok(
			!r.facts.some((fact) => /类型点名命中/.test(fact.hitReason)),
			"别名后紧跟汉字时应视为另一个词，不得整词点名",
		);
	});
});

test("③ 触发信号：tier2 命中且字面重合时**只做展示标注**，不改 tier/hits", async () => {
	await withProject({}, async (project) => {
		// `幂等` 单独成句会被判为弱 token（`等` 是功能字），故带一个实义词。
		const r = await recallForAction({ ...QUERY, action: "幂等键 接口", root: project });
		const pitfall = r.facts.find((fact) => fact.ref === PIT_UID);
		assert.ok(pitfall !== undefined, "前提：触发信号参与 detail 匹配");
		assert.equal(pitfall.tier, 2, "触发信号在 detail 命中面，属 tier2");
		assert.match(pitfall.hitReason, /触发信号字面重合：幂等/);
		// 展示标注不得改写排序输入：hits 仍由既有匹配算法给出（这里不钉具体数，
		// 只钉「tier 未被标注抬高」）。
		assert.equal(pitfall.tier, 2, "标注不得改变 tier");
		// 非 tier2 的命中不得带该标注（唯一路径写死）。
		for (const fact of r.facts) {
			if (fact.tier !== 2) assert.doesNotMatch(fact.hitReason, /触发信号字面重合/);
		}
	});
});

test("⑤ 关系展开：仅精确引用路径展开，派生条目单独归类且不进 facts", async () => {
	await withProject({}, async (project) => {
		const r = await recallForAction({ ...QUERY, action: ADR_UID, root: project });
		const source = r.facts.find((fact) => fact.ref === ADR_UID);
		assert.ok(source !== undefined, "前提：完整 object_uid 走 tier0 结构命中");
		assert.equal(source.tier, 0);

		const expanded = r.relationExpansions.find((item) => item.derivedFrom?.relationKey === "superseded-by");
		assert.ok(expanded !== undefined, "判据表登记且对象上实际存在的边须被展开");
		assert.equal(expanded.ref, OLD_UID, "展开目标须是关系边指向的对象");
		assert.equal(expanded.resolved, true);
		assert.match(expanded.hitReason, /关系展开：/);
		// 派生条目不进 F2 候选：`facts` 里不得出现目标对象（未直接命中时）。
		assert.ok(!r.facts.some((fact) => fact.ref === OLD_UID), "派生条目不得混进 facts");
		assert.ok(!r.facts.some((fact) => fact.kind === "relation"), "facts 只放直接命中");

		// 默认候选路径（类型点名）不展开。
		const naming = await recallForAction({ ...QUERY, action: "ADR", root: project });
		assert.equal(naming.relationExpansions.length, 0, "非精确引用路径不得展开");
	});
});

test("⑤ 关系展开：目标不可解析时如实报告，不静默丢弃", async () => {
	await withProject({}, async (project) => {
		// 追写一条指向不存在 uid 的边：目标不可解析。
		await writeFile(
			join(project, "ldvh-base", "adrs", `${ADR_UID}.md`),
			[
				"---",
				"title: 类型通道 决策甲",
				"status: active",
				`object_uid: ${ADR_UID}`,
				"fact_type_key: adr",
				"decision: 统一幂等键决策标记甲",
				"scope: 接口层",
				"relations:",
				"  - relation_key: superseded-by",
				"    target:",
				"      object_uid: 99999999-9999-4999-8999-999999999999",
				"---",
				"",
			].join("\n"),
			"utf8",
		);
		const r = await recallForAction({ ...QUERY, action: ADR_UID, root: project });
		const unresolved = r.relationExpansions.find((item) => item.resolved === false);
		assert.ok(unresolved !== undefined, "不可解析的目标须保留在派生集合里");
		assert.match(String(unresolved.unresolvedReason), /目标不可解析/);
	});
});

test("⑥ 分节名额：按次序分节、每类限额、总名额从末尾裁，且如实记账", () => {
	const hit = (type, i) => ({ type, ref: `${type}-${i}`, title: `${type} ${i}` });
	const hits = [
		hit("adr", 0), hit("adr", 1), hit("adr", 2),
		hit("pitfall", 0), hit("pitfall", 1), hit("pitfall", 2),
		hit("research", 0), hit("research", 1),
	];
	const plan = { order: FACT_SECTION_ORDER, quotaByType: QUOTA_BY_TYPE, total: 3 };
	const result = selectFactsBySection(hits, plan);
	// adr 名额 2、pitfall 名额 2 → 各裁 1；总名额 3 再裁 pitfall 1。
	assert.deepEqual(result.selected.map((item) => item.ref), ["adr-0", "adr-1", "pitfall-0"]);
	assert.deepEqual(result.droppedByQuota, [
		{ type: "adr", count: 1 },
		{ type: "pitfall", count: 1 },
		{ type: "research", count: 1 },
	]);
	// 总名额耗尽后，research 的名额份额也被挡下——两笔都如实记账。
	assert.deepEqual(result.droppedByTotal, [
		{ type: "pitfall", count: 1 },
		{ type: "research", count: 1 },
	]);
	assert.equal(result.unassigned, 0);
	// 名额不改变名次：选中项保持传入次序。
	const orders = result.groups.map((group) => group.type);
	assert.deepEqual(orders, ["adr", "pitfall"], "分节次序须按常量，不是按命中数");
});

test("⑥ 渲染：按类型分节、名额披露具名来源；关系展开单独成组不占名额", () => {
	const fact = (type, title) => ({
		type, status: "active", title, path: `ldvh-base/${type}s/x.md`, hitReason: "标题命中：x", excerpt: "",
	});
	const text = renderRecallRow({
		specs: [],
		facts: [fact("adr", "决策甲"), fact("pitfall", "经验甲")],
		relationExpansions: [{
			kind: "relation", type: "adr", ref: OLD_UID, title: "旧决策", status: "active",
			path: "ldvh-base/adrs/old.md", hitReason: `关系展开：${ADR_UID}+superseded-by`,
			derivedFrom: { sourceRef: ADR_UID, sourceTitle: "决策甲", relationKey: "superseded-by" },
		}],
		sectioning: {
			order: FACT_SECTION_ORDER, total: 3,
			droppedByQuota: [{ type: "research", count: 4 }],
			droppedByTotal: [],
		},
		truncated: false,
		budget: {},
	});
	assert.ok(text.includes(`事实源 · ${FACT_SECTION_LABELS.adr}：`), "ADR 分节标题须带类型名");
	assert.ok(text.includes(`事实源 · ${FACT_SECTION_LABELS.pitfall}：`), "Pitfall 分节标题须带类型名");
	assert.ok(text.indexOf(FACT_SECTION_LABELS.adr) < text.indexOf(FACT_SECTION_LABELS.pitfall), "分节须按次序");
	assert.match(text, /分节名额省略/, "名额裁剪须披露");
	assert.match(text, /research 4/, "披露须点名被裁类型与条数（34 §12 标明截断来源）");
	assert.match(text, /关系展开（精确引用派生；不占候选名额）：/, "派生条目须单独归类");
	assert.ok(text.indexOf("关系展开（精确引用派生") > text.indexOf(FACT_SECTION_LABELS.pitfall), "派生组在事实分节之后");
});
