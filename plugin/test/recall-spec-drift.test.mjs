
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DEFAULT_STATUSES_BY_TYPE,
	MATCHED_FACT_FIELDS,
	REGISTERED_FACT_TYPES,
	loadFacts,
	recallForAction,
} from "../lib/source-recall.js";
import {
	FACTSOURCE_TYPE_KEYS,
	allTypeKeyDerivedWords,
	loadRecallCriteria,
} from "../lib/recall-criteria.js";
import { VALID_FM_KEYS as SPARK_FM_KEYS } from "../lib/spark-writer.js";
import { VALID_FM_KEYS as SUBGOAL_FM_KEYS } from "../lib/subgoal-writer.js";
import { VALID_FM_KEYS as NORM_FM_KEYS } from "../lib/norm-writer.js";
import { VALID_FM_KEYS as PITFALL_FM_KEYS } from "../lib/pitfall-writer.js";
import { VALID_FM_KEYS as FRICTION_FM_KEYS } from "../lib/friction-writer.js";
import { validateResearchFrontmatter, validateResearchRelations } from "../lib/report-writer.js";
import { validateSparkRelations } from "../lib/spark-writer.js";
import { validateFrictionRelations } from "../lib/friction-writer.js";

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

test("判据表「默认候选状态」机械值须与代码默认状态逐字一致（01 §11.4 禁第二规则源）", async () => {
	for (const [type, statuses] of Object.entries(DEFAULT_STATUSES_BY_TYPE)) {
		const specFile = TYPE_SPEC_FILES[type];
		assert.ok(specFile !== undefined, `类型「${type}」缺规范映射`);
		const text = await readSpec(specFile);
		assert.notEqual(text, null, `规范不可读：specs/${specFile}`);
		const row = text.split("\n").find((line) => line.startsWith("| 默认候选状态 |"));
		assert.ok(row !== undefined, `判据表缺「默认候选状态」行：specs/${specFile}`);
		const cells = row.split("|").map((cell) => cell.trim());
		const machine = cells[3] ?? "";
		assert.deepEqual(
			machine.split(",").map((value) => value.trim()).filter((value) => value !== ""),
			[...statuses],
			`判据表机械值与代码默认状态不一致：specs/${specFile}`,
		);
	}
});

test("摩擦的 §12 召回分层段首个「默认候选（F2）」句须逐字含全部默认状态（26 §12 与判据表不得分叉）", async () => {
	const statuses = DEFAULT_STATUSES_BY_TYPE.friction;
	const text = await readSpec(TYPE_SPEC_FILES.friction);
	assert.notEqual(text, null, "规范不可读：specs/26-Friction-摩擦账本.md");
	const idx = text.indexOf("默认候选（F2）");
	assert.ok(idx >= 0, "specs/26 缺「默认候选（F2）」句");
	const rest = text.slice(idx);
	const end = rest.search(/[。；]/);
	const sentence = end < 0 ? rest : rest.slice(0, end);
	assert.match(sentence, /只含/, `§12 召回分层段须以「只含」限定默认状态范围：${sentence}`);
	const listed = [...sentence.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
	assert.deepEqual(
		[...new Set(listed)].sort(),
		[...statuses].sort(),
		`§12 召回分层段的默认状态集合须与判据表机械值完全一致（多列、漏列或否定均不通过）：${sentence}`,
	);
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


const WRITER_FM_KEYS = Object.freeze({
	spark: SPARK_FM_KEYS,
	subgoal: SUBGOAL_FM_KEYS,
	norm: NORM_FM_KEYS,
	pitfall: PITFALL_FM_KEYS,
	friction: FRICTION_FM_KEYS,
});

const TARGET_UID = "11111111-1111-4111-8111-111111111111";

function relationCheckOf(type, relationKey) {
	const relation = { relation_key: relationKey, target: { object_uid: TARGET_UID } };
	if (type === "spark") return validateSparkRelations({ status: "discarded", relations: [relation] });
	if (type === "report") return validateResearchRelations({ relations: [relation] });
	if (type === "friction") {
		return validateFrictionRelations({
			status: relationKey === "informs" ? "resolved" : "open",
			relations: [relation],
		});
	}
	return null;
}

test("判据表四类机械值须与代码消费面同源：默认候选状态／核心语义字段／类型词别名／关系展开", async () => {
	const criteria = await loadRecallCriteria(SPECS_DIR);
	assert.equal(criteria.ok, true, `判据表须全部可解析：${JSON.stringify(criteria.errors)}`);
	assert.deepEqual([...criteria.byType.keys()].sort(), [...FACTSOURCE_TYPE_KEYS].sort(), "七类型都须有条目");

	for (const [type, table] of criteria.byType) {
		const values = table.values;
		const specFile = TYPE_SPEC_FILES[type];
		assert.ok(specFile !== undefined, `类型「${type}」缺规范映射`);

		if (values.notApplicable["默认候选状态"]) {
			assert.equal(DEFAULT_STATUSES_BY_TYPE[type], undefined,
				`类型「${type}」判据表登记「不采用」，代码却仍登记了默认候选状态`);
		} else {
			assert.deepEqual(values.defaultStatuses, [...DEFAULT_STATUSES_BY_TYPE[type]],
				`类型「${type}」的默认候选状态与判据表机械值不一致`);
		}

		if (values.notApplicable["核心语义字段"]) {
			assert.deepEqual(values.coreFields, [], `类型「${type}」登记「不采用」却带核心字段`);
		} else {
			assert.ok(values.coreFields.length > 0, `类型「${type}」缺核心语义字段`);
			if (type === "report") {
				for (const field of values.coreFields) {
					const frontmatter = {
						object_uid: TARGET_UID,
						fact_type_key: "report",
						title: "标题",
						created_at: "2026-01-01T00:00:00Z",
						status: "active",
						report_form: "research",
						urls: [],
						[field]: "标记",
					};
					const result = validateResearchFrontmatter(frontmatter);
					assert.equal(
						result.issues.some((issue) => issue.includes(`unexpected field "${field}"`)),
						false,
						`类型 report 的核心语义字段「${field}」不在 report-writer 的 frontmatter 闭集内`,
					);
				}
			} else {
				const keys = WRITER_FM_KEYS[type];
				assert.ok(keys instanceof Set, `类型「${type}」缺 writer frontmatter 闭集`);
				for (const field of values.coreFields) {
					assert.ok(
						keys.has(field),
						`类型「${type}」的核心语义字段「${field}」不在 writer 的 frontmatter 闭集内（规范已改，writer 未跟随）`,
					);
				}
			}
		}

		const derived = allTypeKeyDerivedWords();
		for (const alias of values.typeAliases) {
			assert.equal(derived.has(alias.toLowerCase()), false,
				`类型「${type}」的类型词别名「${alias}」与 fact_type_key 派生词冲突`);
		}
		if (values.notApplicable["类型词别名"]) {
			assert.deepEqual(values.typeAliases, [], `类型「${type}」登记「不采用」却带别名`);
		} else {
			assert.ok(values.typeAliases.length > 0, `类型「${type}」缺类型词别名`);
		}

		if (values.notApplicable["关系展开"]) {
			assert.deepEqual(values.relations, [], `类型「${type}」登记「不采用」却带关系展开`);
			continue;
		}
		assert.ok(values.relations.length > 0, `类型「${type}」缺关系展开`);
		for (const relation of values.relations) {
			assert.ok(
				FACTSOURCE_TYPE_KEYS.includes(relation.relationKey) === false,
				`关系键「${relation.relationKey}」不得是类型键`,
			);
			for (const target of relation.targets) {
				assert.ok(
					FACTSOURCE_TYPE_KEYS.includes(target),
					`类型「${type}」关系「${relation.relationKey}」的目标「${target}」不是已登记事实类型`,
				);
			}
			const checked = relationCheckOf(type, relation.relationKey);
			assert.notEqual(checked, null, `类型「${type}」登记了关系展开，但没有对应的 writer 关系校验器`);
			assert.equal(
				checked.ok,
				true,
				`类型「${type}」的关系键「${relation.relationKey}」未被 writer 关系闭集接受：${checked.issues.join("；")}`,
			);
		}
	}
});

test("类型词别名须由 loadFacts 实际注入 typeNames（判据表读到 ≠ 代码用上）", async () => {
	const criteria = await loadRecallCriteria(SPECS_DIR);
	const base = await mkdtemp(join(tmpdir(), "ldvh-criteria-alias-"));
	const DIRS = {
		goal: "goals", subgoal: "subgoals", spark: "sparks", norm: "norms",
		report: "reports", pitfall: "pitfalls", friction: "frictions",
	};
	const uids = new Map();
	let counter = 0;
	for (const type of FACTSOURCE_TYPE_KEYS) {
		counter += 1;
		const uid = `aaaaaaaa-aaaa-4aaa-8aaa-${String(counter).padStart(12, "0")}`;
		uids.set(type, uid);
		await mkdir(join(base, DIRS[type]), { recursive: true });
		await writeFile(
			join(base, DIRS[type], `${type}.md`),
			`---\ntitle: ${type} 标题\nstatus: active\nobject_uid: ${uid}\nfact_type_key: ${type}\n---\n\n正文\n`,
			"utf8",
		);
	}
	const facts = await loadFacts(base, { criteria });
	for (const [type, table] of criteria.byType) {
		const fact = facts.find((item) => item.ref === uids.get(type));
		assert.ok(fact !== undefined, `未读到 ${type} 事实`);
		for (const alias of table.values.typeAliases) {
			assert.ok(
				fact.typeNames.includes(alias.toLowerCase()),
				`类型「${type}」的别名「${alias}」未进入 typeNames（类型点名失效）`,
			);
		}
		for (const word of [`${type}`, `${type}s`]) {
			assert.ok(fact.typeNames.includes(word), `typeNames 缺 fact_type_key 派生词「${word}」`);
		}
	}
});
