
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

const NORM_UID = "22222222-2222-4222-8222-222222222222";
const OLD_UID = "33333333-3333-4333-8333-333333333333";
const PIT_UID = "44444444-4444-4444-8444-444444444444";
const SPARK_UID = "55555555-5555-4555-8555-555555555555";

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
		await spec("22-Spark-火花.md", criteriaTable({
			defaultStatuses: "open", coreFields: "question, summary", aliases: "火花", relations: "merged-into->spark",
		}));
		await spec("23-Norm-事实规范.md", criteriaTable({
			defaultStatuses: "active", coreFields: "direction_key, title", aliases: "事实规范", relations: "不采用",
		}));
		const pitfallTable = criteriaTable({
			defaultStatuses: "active", coreFields: "title, scope", aliases: "踩坑经验", relations: "不采用",
		});
		await spec(
			"25-Pitfall-踩坑经验.md",
			brokenPitfallTable ? pitfallTable.replace("recall-criteria/v1", "recall-criteria/v2") : pitfallTable,
		);
		await fact("norms", NORM_UID, `title: 类型通道 决策甲
status: active
object_uid: ${NORM_UID}
fact_type_key: norm
direction_key: idem-key-alpha
scope: 接口层
gist: 非核心字段标记乙
relations:
  - relation_key: superseded-by
    target:
      object_uid: ${OLD_UID}`);
		await fact("norms", OLD_UID, `title: 类型通道 旧决策
status: active
object_uid: ${OLD_UID}
fact_type_key: norm
direction_key: idem-key-old
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
		const normFact = facts.find((fact) => fact.ref === NORM_UID);
		assert.ok(normFact.detail.includes("idem-key-alpha"), "核心字段 direction_key 须进 detail");
		assert.ok(normFact.detail.includes("类型通道 决策甲"), "核心字段 title 须进 detail");
		assert.ok(!normFact.detail.includes("非核心字段标记乙"), "未登记的 gist 不得进 detail（按判据表消费）");
		assert.ok(normFact.typeNames.includes("norm"), "fact_type_key 派生词须在闭集里");
		assert.ok(normFact.typeNames.includes("事实规范"), "判据表别名须在闭集里");
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

test("② 类型点名：事实对象按闭集点名（Norm / 中文别名），命中给 tier 0.5", async () => {
	await withProject({}, async (project) => {
		for (const action of ["Norm", "事实规范"]) {
			const r = await recallForAction({ ...QUERY, action, root: project });
			const normFact = r.facts.find((fact) => fact.ref === NORM_UID);
			assert.ok(normFact !== undefined, `「${action}」须召回 Norm`);
			assert.equal(normFact.tier, 0.5, `「${action}」是纯指称，应给类型点名层`);
			assert.match(normFact.hitReason, /类型点名命中/);
		}
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

test("③ 触发信号标注层暂缓：trigger_signal 仍在 detail 匹配面，但不做展示标注", async () => {
	await withProject({}, async (project) => {
		const r = await recallForAction({ ...QUERY, action: "幂等键 接口", root: project });
		const pitfall = r.facts.find((fact) => fact.ref === PIT_UID);
		assert.ok(pitfall !== undefined, "前提：触发信号参与 detail 匹配（23 §8）");
		assert.equal(pitfall.tier, 2, "触发信号在 detail 命中面，属 tier2");
		for (const fact of r.facts) {
			assert.doesNotMatch(fact.hitReason, /触发信号字面重合/);
		}
	});
});


test("⑥ 分节名额：按次序分节、每类限额、总名额从末尾裁，且如实记账", () => {
	const hit = (type, i) => ({ type, ref: `${type}-${i}`, title: `${type} ${i}` });
	const hits = [
		hit("norm", 0), hit("norm", 1), hit("norm", 2),
		hit("pitfall", 0), hit("pitfall", 1), hit("pitfall", 2),
		hit("report", 0), hit("report", 1),
	];
	const plan = { order: FACT_SECTION_ORDER, quotaByType: QUOTA_BY_TYPE, total: 3 };
	const result = selectFactsBySection(hits, plan);
	assert.deepEqual(result.selected.map((item) => item.ref), ["norm-0", "pitfall-0", "pitfall-1"]);
	assert.deepEqual(result.droppedByQuota, [
		{ type: "norm", count: 2 },
		{ type: "pitfall", count: 1 },
		{ type: "report", count: 1 },
	]);
	assert.deepEqual(result.droppedByTotal, [
		{ type: "report", count: 1 },
	]);
	assert.equal(result.unassigned, 0);
	const orders = result.groups.map((group) => group.type);
	assert.deepEqual(orders, ["norm", "pitfall"], "分节次序须按常量，不是按命中数");
	assert.deepEqual(result.unassignedByType, [], "无未分配项时明细为空数组，不写空壳条目");
});

test("⑥ 分节之外的类型须给按类型明细（34 §12 未检查范围逐类列出）", () => {
	const hit = (type, i) => ({ type, ref: `${type}-${i}`, title: `${type} ${i}` });
	const hits = [
		hit("norm", 0),
		hit("devlog", 0), hit("devlog", 1), hit("devlog", 2),
		hit("subgoal", 0), hit("subgoal", 1),
	];
	const plan = { order: FACT_SECTION_ORDER, quotaByType: QUOTA_BY_TYPE, total: 3 };
	const result = selectFactsBySection(hits, plan);
	assert.deepEqual(
		result.unassignedByType,
		[{ type: "devlog", count: 3 }, { type: "subgoal", count: 2 }],
		"未分配项须按类型给出条数（保序：插入序即命中次序）",
	);
	assert.equal(
		result.unassignedByType.reduce((sum, entry) => sum + entry.count, 0),
		result.unassigned,
		"按类型明细之和须等于 unassigned 总数",
	);
	assert.ok(
		!result.selected.some((item) => item.type === "devlog" || item.type === "subgoal"),
		"未分配类型不得进入交付集合",
	);
});

test("⑥ 渲染：按类型分节、名额披露具名来源；关系展开单独成组不占名额", () => {
	const fact = (type, title) => ({
		type, status: "active", title, path: `ldvh-base/${type}s/x.md`, hitReason: "标题命中：x", excerpt: "",
	});
	const text = renderRecallRow({
		specs: [],
		facts: [fact("norm", "规范甲"), fact("pitfall", "经验甲")],
		relationExpansions: [{
			kind: "relation", type: "report", ref: OLD_UID, title: "旧报告", status: "active",
			path: "ldvh-base/reports/old.md", hitReason: `关系展开：${NORM_UID}+inspired-by`,
			derivedFrom: { sourceRef: NORM_UID, sourceTitle: "规范甲", relationKey: "inspired-by" },
		}],
		sectioning: {
			order: FACT_SECTION_ORDER, total: 3,
			droppedByQuota: [{ type: "report", count: 4 }],
			droppedByTotal: [],
		},
		truncated: false,
		budget: {},
	});
	assert.ok(text.includes(`事实源 · ${FACT_SECTION_LABELS.norm}：`), "Norm 分节标题须带类型名");
	assert.ok(text.includes(`事实源 · ${FACT_SECTION_LABELS.pitfall}：`), "Pitfall 分节标题须带类型名");
	assert.ok(text.indexOf(FACT_SECTION_LABELS.norm) < text.indexOf(FACT_SECTION_LABELS.pitfall), "分节须按次序");
	assert.match(text, /分节名额省略/, "名额裁剪须披露");
	assert.match(text, /report 4/, "披露须点名被裁类型与条数（34 §12 标明截断来源）");
	assert.match(text, /关系展开（精确引用派生；不占候选名额）：/, "派生条目须单独归类");
	assert.ok(text.indexOf("关系展开（精确引用派生") > text.indexOf(FACT_SECTION_LABELS.pitfall), "派生组在事实分节之后");
});


import { recallStatusPolicyOf, DEFAULT_STATUSES_FALLBACK } from "../lib/source-recall.js";

test("默认候选状态取自判据表：机械值改了，候选池跟着改（不读硬编码表）", async () => {
	const build = async (statuses) => {
		const project = await mkdtemp(join(tmpdir(), "ldvh-statuspolicy-"));
		const write = async (rel, text) => {
			const abs = join(project, rel);
			await mkdir(join(abs, ".."), { recursive: true });
			await writeFile(abs, text, "utf8");
		};
		await write("specs/25-Pitfall-踩坑经验.md",
			`---\nldvh_spec:\n  spec_id: "25"\n---\n\n# 规范\n\n${criteriaTable({
				defaultStatuses: statuses, coreFields: "title, scope", aliases: "踩坑经验", relations: "不采用",
			})}`);
		await write(`ldvh-base/pitfalls/${PIT_UID}.md`,
			`---\ntitle: 接口重复提交\nstatus: active\nobject_uid: ${PIT_UID}\nfact_type_key: pitfall\nscope: 接口层\n---\n\n正文\n`);
		return project;
	};
	const activeProject = await build("active");
	const openProject = await build("open");
	try {
		const asActive = await recallForAction({ ...QUERY, action: "接口重复提交", root: activeProject });
		assert.ok(asActive.facts.some((f) => f.ref === PIT_UID), "判据表写 active 时该对象是候选");
		const asOpen = await recallForAction({ ...QUERY, action: "接口重复提交", root: openProject });
		assert.ok(!asOpen.facts.some((f) => f.ref === PIT_UID), "判据表写 open 时 active 对象不得成为候选（证明读的是表）");
		assert.ok(
			asOpen.uncheckedRange.excludedByStatus.some((f) => f.ref === undefined && f.path.includes(PIT_UID)),
			"被状态筛掉者须进未检查范围（34 §12）",
		);
	} finally {
		await rm(activeProject, { recursive: true, force: true });
		await rm(openProject, { recursive: true, force: true });
	}
});

test("默认候选状态「不采用」：该类型没有候选概念，不进候选池、也不回落 active", async () => {
	const project = await mkdtemp(join(tmpdir(), "ldvh-noncandidate-"));
	const write = async (rel, text) => {
		const abs = join(project, rel);
		await mkdir(join(abs, ".."), { recursive: true });
		await writeFile(abs, text, "utf8");
	};
	try {
		await write("specs/25-Pitfall-踩坑经验.md",
			`---\nldvh_spec:\n  spec_id: "25"\n---\n\n# 规范\n\n${criteriaTable({
				defaultStatuses: "不采用", coreFields: "title, scope", aliases: "踩坑经验", relations: "不采用",
			})}`);
		await write(`ldvh-base/pitfalls/${PIT_UID}.md`,
			`---\ntitle: 接口重复提交\nstatus: active\nobject_uid: ${PIT_UID}\nfact_type_key: pitfall\nscope: 接口层\n---\n\n正文\n`);
		const r = await recallForAction({ ...QUERY, action: "接口重复提交", root: project });
		assert.ok(!r.facts.some((f) => f.ref === PIT_UID), "「不采用」的类型不得成为候选（绝不回落 active）");
		assert.ok(r.criteria.nonCandidateTypes.includes("pitfall"), "「不采用」类型须在 criteria.nonCandidateTypes 里可见");
		assert.ok(
			r.uncheckedRange.excludedByNonCandidate.some((f) => f.path.includes(PIT_UID)),
			"「不采用」类型被挡下者须单列披露，不得混进 excludedByStatus（放宽状态对它无效）",
		);
		assert.ok(
			!r.uncheckedRange.excludedByStatus.some((f) => f.path.includes(PIT_UID)),
			"不得同时出现在 excludedByStatus 里（两种原因不同，混列会误导读者去放宽状态）",
		);
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("判据表里没有该类型条目：回落具名兜底，并在 criteria.fallbackTypes 与 gaps 两处可见", async () => {
	const project = await mkdtemp(join(tmpdir(), "ldvh-fallbackstatus-"));
	const write = async (rel, text) => {
		const abs = join(project, rel);
		await mkdir(join(abs, ".."), { recursive: true });
		await writeFile(abs, text, "utf8");
	};
	try {
		await write("specs/23-Norm-事实规范.md",
			`---\nldvh_spec:\n  spec_id: "23"\n---\n\n# 规范\n\n${criteriaTable({
				defaultStatuses: "active", coreFields: "decision, scope", aliases: "决策记录", relations: "不适用",
			})}`);
		await write(`ldvh-base/pitfalls/${PIT_UID}.md`,
			`---\ntitle: 接口重复提交\nstatus: active\nobject_uid: ${PIT_UID}\nfact_type_key: pitfall\nscope: 接口层\n---\n\n正文\n`);
		const r = await recallForAction({ ...QUERY, action: "接口重复提交", root: project });
		assert.ok(r.criteria.fallbackTypes.includes("pitfall"), "回落类型须在 criteria.fallbackTypes 里可见");
		assert.ok(
			r.gaps.some((gap) => gap.includes("判据表未登记该类型（pitfall）")),
			"回落须进 gaps 逐类点明（34 §12 未检查范围）",
		);
		assert.ok(
			r.gaps.some((gap) => gap.includes("不是判据表损坏")),
			"归因须准：这是「该类型还没规范」，不是「判据表坏了」",
		);
		assert.ok(!r.criteria.disabledTypes.includes("pitfall"), "「表里没条目」不等于「表坏了」，不得报成停用");
	} finally {
		await rm(project, { recursive: true, force: true });
	}
});

test("判据表有该类型但解析失败：仍 fail-closed（不把回落当补救），回落与停用不得混淆", async () => {
	await withProject({ brokenPitfallTable: true }, async (project) => {
		const r = await recallForAction({ ...QUERY, action: "接口重复提交", root: project });
		assert.ok(r.criteria.disabledTypes.includes("pitfall"), "表坏了须报停用");
		assert.ok(!r.criteria.fallbackTypes.includes("pitfall"), "表坏了不得被报成「回落兜底」（那是把故障伪装成正常）");
		assert.ok(
			!r.gaps.some((gap) => gap.includes("判据表未登记该类型（pitfall）")),
			"表坏了不得披露成「没有该类型条目」（归因不能反）",
		);
	});
});
