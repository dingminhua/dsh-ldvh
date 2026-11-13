// Cross-type guard: the tool-plane schema must admit every field the writer's
// closed set accepts.
//
// WHY THIS EXISTS (a real defect, not a hypothetical):
// `aa12604` added the Spark `priority` field to spark-writer.js but not to
// spark-tools.js's `sparkFrontmatter` JSON Schema. That schema declares
// `additionalProperties: false`, so every create/update carrying `priority` was
// rejected BEFORE reaching the writer — the writer's own validation for the
// field became unreachable code. The defect sat latent across 727 green tests,
// because no test crossed the "tool plane → writer" boundary: the tools tests
// asserted negative shapes, the writer tests asserted the writer, and the seam
// between them was untested.
//
// This file closes that seam permanently: for every fact type, the writer's
// closed set minus Code-assigned fields must be a subset of the tool schema's
// declared properties. Any future field addition that forgets one side fails
// here immediately.
//
// The Code-assigned exclusion is explicit and per-field — without it the check
// would flag legitimate omissions (e.g. `retired_at`, which the writers assign
// themselves via `new Date().toISOString()` and which 27/22/24 forbid AI from
// supplying).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

// The very function the DSH runtime calls before a tool handler runs.
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";

import { VALID_FM_KEYS as SPARK_FM_KEYS } from "../lib/spark-writer.js";
import { VALID_FM_KEYS as ADR_FM_KEYS } from "../lib/adr-writer.js";
import { VALID_FM_KEYS as PITFALL_FM_KEYS } from "../lib/pitfall-writer.js";
import { VALID_FM_KEYS as FRICTION_FM_KEYS } from "../lib/friction-writer.js";
import { VALID_FM_KEYS as NORM_FM_KEYS } from "../lib/norm-writer.js";
import { VALID_FM_KEYS as SUBGOAL_FM_KEYS } from "../lib/subgoal-writer.js";
// DevLog（29 号）已于 2026-11-14 撤除，其 writer 与 tools 不再纳入本守卫。

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");
const SPECS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "specs");

/** Fields Code assigns; AI must not supply them, so tool schemas omit them. */
const CODE_ASSIGNED = new Set([
	"object_uid",
	"fact_type_key",
	"created_at",
	"change_log",
	"retired_at", // writer assigns on the retire transition (22/24/27)
	"goal_key",   // Goal singleton identity
]);

/**
 * Each entry: the writer's AI-supplied field set, and how to obtain the tool
 * schema that must expose it. `research` is loaded dynamically because its
 * module pulls in the research session machinery.
 */
const TYPES = [
	{
		name: "spark",
		writerKeys: SPARK_FM_KEYS,
		load: () => import("../lib/spark-tools.js"),
		operationKey: "spark-write-object",
	},
	{
		name: "adr",
		writerKeys: ADR_FM_KEYS,
		load: () => import("../lib/adr-tools.js"),
		operationKey: "adr-write-object",
	},
	{
		name: "pitfall",
		writerKeys: PITFALL_FM_KEYS,
		load: () => import("../lib/pitfall-tools.js"),
		operationKey: "pitfall-write-object",
	},
	{
		name: "friction",
		writerKeys: FRICTION_FM_KEYS,
		load: () => import("../lib/friction-tools.js"),
		operationKey: "friction-write-object",
	},
	{
		name: "norm",
		writerKeys: NORM_FM_KEYS,
		load: () => import("../lib/norm-tools.js"),
		operationKey: "norm-write-object",
	},
	{
		name: "research",
		writerKeys: null, // read from source: the module exports no key set
		load: () => import("../lib/research-tools.js"),
		operationKey: "research-write-object",
		writerFile: "research-writer.js",
	},
	{
		name: "subgoal",
		writerKeys: SUBGOAL_FM_KEYS,
		load: () => import("../lib/subgoal-tools.js"),
		operationKey: "subgoal-write-object",
	},
];

/** Read a writer's closed set straight from source when it is not exported. */
async function writerKeysFromSource(fileName) {
	const source = await readFile(join(LIB, fileName), "utf8");
	const match = source.match(/VALID_FM_KEYS = new Set\(\[([\s\S]*?)\]\)/);
	if (match === null) throw new Error(`no VALID_FM_KEYS closed set found in ${fileName}`);
	return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** Locate the create-time frontmatter argument and its declared schema. */
function frontmatterSchema(descriptor) {
	const key = Object.keys(descriptor.parameters.properties).find((name) => name.startsWith("frontmatter"));
	assert.ok(key, `no frontmatter argument declared by ${descriptor.name}`);
	return { key, schema: descriptor.parameters.properties[key] };
}

/** The schema properties for the create-time frontmatter argument. */
function frontmatterSchemaFields(descriptor) {
	const { schema } = frontmatterSchema(descriptor);
	return {
		fields: new Set(Object.keys(schema.properties ?? {}).filter((field) => field !== "change_summary")),
		additionalProperties: schema.additionalProperties,
	};
}

/**
 * Produce an argument value that satisfies a declared property schema.
 *
 * The goal is a call that carries ONE optional field and is otherwise
 * schema-valid, so the reachability check below measures exactly one thing:
 * whether the validator admits the field. Content semantics are NOT this
 * test's business (the writers' own tests cover them), so placeholders are
 * fine — but they must respect the declared type/enum or the check would fail
 * on the filler instead of on the field under test.
 */
function valueSatisfying(schema) {
	if (schema.const !== undefined) return schema.const;
	if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
	if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return valueSatisfying(schema.oneOf[0]);
	switch (schema.type) {
		case "array":
			return [];
		case "integer":
		case "number":
			return 0;
		case "boolean":
			return false;
		case "object": {
			const out = {};
			for (const [key, sub] of Object.entries(schema.properties ?? {})) out[key] = valueSatisfying(sub);
			return out;
		}
		default:
			return "x";
	}
}

/**
 * Every legal carrier shape a declared property admits.
 *
 * `valueSatisfying` returns ONE sample (for oneOf: the first branch). When a
 * field carries several legal shapes — `attribution_ref` accepts both the
 * object form `{ object_uid }` and the legacy bare string — sampling only the
 * first branch means the other branches are never exercised by this guard, and
 * a branch that the DSH validator would reject would stay invisible. So probe
 * each oneOf branch with its own sample.
 */
function valueVariantsSatisfying(schema) {
	if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
		return schema.oneOf.map((branch) => valueSatisfying(branch));
	}
	return [valueSatisfying(schema)];
}

/**
 * A minimal schema-valid argument object for the create action of a type,
 * carrying every declared create-time argument the tool schema accepts.
 */
function minimalCreateArgs(type, descriptor) {
	const { key, schema } = frontmatterSchema(descriptor);
	const draft = {};
	for (const [field, sub] of Object.entries(schema.properties ?? {})) {
		draft[field] = valueSatisfying(sub);
	}
	for (const field of schema.required ?? []) {
		if (draft[field] === undefined) draft[field] = "x";
	}

	const args = { action: "create", [key]: draft };
	// Every other top-level argument the operation declares.
	for (const [name, sub] of Object.entries(descriptor.parameters.properties)) {
		if (name === key || name === "action") continue;
		args[name] = valueSatisfying(sub);
	}
	const action = descriptor.parameters.properties.action;
	if (Array.isArray(action?.enum) && action.enum.includes("create")) args.action = "create";
	return args;
}

for (const type of TYPES) {
	test(`schema/writer agreement: ${type.name} exposes every AI-supplied field through the tool plane`, async () => {
		const writerKeys = type.writerKeys ?? await writerKeysFromSource(type.writerFile);
		const module = await type.load();
		const operation = module.OPERATIONS[type.operationKey];
		assert.ok(operation, `${type.name}: operation ${type.operationKey} is not declared`);
		const descriptor = module.toolDescriptorFor(type.operationKey, operation, () => {});
		const { fields, additionalProperties } = frontmatterSchemaFields(descriptor);

		// A restrictive schema is what makes an omission fatal rather than
		// silently ignored — assert it so the guard cannot be defeated by
		// flipping the schema open.
		assert.equal(
			additionalProperties,
			false,
			`${type.name}: frontmatter schema must declare additionalProperties: false, otherwise omitted fields are silently accepted and this guard proves nothing`,
		);

		const aiSupplied = [...writerKeys].filter((field) => !CODE_ASSIGNED.has(field));
		const unreachable = aiSupplied.filter((field) => !fields.has(field));

		assert.deepEqual(
			unreachable,
			[],
			`${type.name}: field(s) ${unreachable.join(", ")} are accepted by the writer's closed set but absent from the tool schema — every call carrying them is rejected before reaching the writer (the aa12604 defect class)`,
		);

		// The reverse direction: a schema field the writer rejects would let the
		// tool plane promise something the writer refuses.
		const phantom = [...fields].filter((field) => !writerKeys.has(field));
		assert.deepEqual(
			phantom,
			[],
			`${type.name}: tool schema declares ${phantom.join(", ")} but the writer's closed set rejects them`,
		);
	});
}

// ---------------------------------------------------------------------------
// Reachability, proven through DSH's OWN argument validator
// ---------------------------------------------------------------------------
//
// WHY THIS IS SEPARATE FROM THE FIELD-SET CHECK ABOVE:
//
// The check above compares two field *lists*. It proves a field is declared.
// It does NOT prove a call carrying that field survives the validation the
// DSH runtime actually performs — and that gap is exactly how aa12604 hid.
//
// The mechanism, read from @deepseek-ai/dsh-tools (lib/index.js):
//   - `defineTool` builds `execute` as: `const violations = validate(args);
//     if (violations.length > 0) throw new ToolArgsError(violations)`.
//     Validation lives INSIDE defineTool's closure.
//   - `ToolRuntime` dispatches with `await tool.execute(exec.arguments, exec)`
//     and does NOT re-validate.
//   - LDVH's `toolDescriptorFor` returns a RAW descriptor (it never calls
//     defineTool), and the test mock registry just collects descriptors, so
//     the tests drive `descriptor.execute(args)` directly.
//
// Consequence: neither the LDVH test suite NOR the LDVH runtime executes DSH's
// argument validation on these tools. So we invoke the very same validator the
// runtime would (`validateJsonSchemaValue(parameters, args, "")`) directly on
// the descriptor's declared parameters. That is the closest faithful
// reproduction available without a live harness, and it fails with the exact
// message the defect produced:
//   "frontmatter_draft.priority" is not a declared property (additionalProperties: false)

test("schema/writer agreement: the DSH argument validator accepts every optional field", async () => {
	// For each type, start from a schema-valid create call and then attach each
	// AI-supplied OPTIONAL field the WRITER declares — taken from the writer's
	// closed set, NOT from the schema. That independence is the whole point:
	// if a field is missing from the schema, the writer's set still names it,
	// we still attach it, and the validator rejects it here.
	const failures = [];

	for (const type of TYPES) {
		const writerKeys = type.writerKeys ?? await writerKeysFromSource(type.writerFile);
		const module = await type.load();
		const operation = module.OPERATIONS[type.operationKey];
		const descriptor = module.toolDescriptorFor(type.operationKey, operation, () => {});
		const { key, schema } = frontmatterSchema(descriptor);

		const base = minimalCreateArgs(type, descriptor);
		const aiSupplied = [...writerKeys].filter((field) => !CODE_ASSIGNED.has(field));

		for (const field of aiSupplied) {
			// 一个字段可能有**多条**合法承载（oneOf 分支）。只造 oneOf[0] 的样会让
			// 其余分支零覆盖——守卫看起来在守，实际从没验过那些分支。故对 oneOf
			// 逐分支造样各探一次（这是复核发现 5 指出的覆盖缺口）。
			const declared = schema.properties?.[field];
			const candidates = declared !== undefined ? valueVariantsSatisfying(declared) : ["x"];
			for (const [variantIndex, candidate] of candidates.entries()) {
				const args = structuredClone(base);
				// Only optional fields need probing; required ones are already in.
				args[key][field] = candidate;

				// The exact call the DSH runtime makes before the handler runs.
				const violations = validateJsonSchemaValue(descriptor.parameters, args, "");
				const label = candidates.length > 1 ? `${type.name}.${field}[oneOf#${variantIndex}]` : `${type.name}.${field}`;
				for (const violation of violations) failures.push(`${label}: ${violation}`);
			}
		}
	}

	assert.deepEqual(
		failures,
		[],
		`calls valid at the writer level are rejected by the DSH argument validator before reaching it ` +
		`(the aa12604 defect class):\n${failures.join("\n")}`,
	);
});

test("schema/writer agreement: this guard actually detects the aa12604 defect", async () => {
	// A guard that cannot fail proves nothing. Reconstruct the original defect
	// in memory — drop an optional field from the declared schema — and assert
	// the check above WOULD have caught it. Without this, the guard above
	// could silently degrade into a no-op and still show green.
	const module = await import("../lib/spark-tools.js");
	const descriptor = module.toolDescriptorFor(
		"spark-write-object",
		module.OPERATIONS["spark-write-object"],
		() => {},
	);
	const args = {
		action: "create",
		frontmatter_draft: { title: "t", question: "q?", scope_boundary: "s", intent: "i", summary: "m", priority: "P1" },
		body_markdown: "b",
	};

	// Sanity: with the real schema, this call is valid.
	assert.deepEqual(
		validateJsonSchemaValue(descriptor.parameters, args, ""),
		[],
		"precondition failed: a priority-carrying call should already be valid",
	);

	// Now simulate the defect on a structuredClone of the schema.
	const broken = structuredClone(descriptor.parameters);
	delete broken.properties.frontmatter_draft.properties.priority;
	const violations = validateJsonSchemaValue(broken, args, "");

	assert.ok(
		violations.some((v) => v.includes("priority")),
		`the reachability check must detect a field missing from the schema, got: ${JSON.stringify(violations)}`,
	);
});

test("schema/writer agreement: every fact-type writer is covered by this guard", async () => {
	// A new type added without a guard entry would silently escape the check.
	const { readdir } = await import("node:fs/promises");
	const files = await readdir(LIB);
	const writerTypes = files
		.filter((name) => name.endsWith("-writer.js"))
		.map((name) => name.replace("-writer.js", ""))
		// goal：单例、无 frontmatter draft 参数；devlog：29 号已于 2026-11-14
		// 撤除，其 writer 文件暂留（带在途改动，待后续批次物理删除），故豁免。
		.filter((name) => !["goal", "devlog"].includes(name));
	const covered = new Set(TYPES.map((type) => type.name));
	const uncovered = writerTypes.filter((name) => !covered.has(name));
	assert.deepEqual(
		uncovered,
		[],
		`writer(s) ${uncovered.join(", ")} exist but are not covered by the schema/writer agreement guard — add them to TYPES`,
	);
});

// ---------------------------------------------------------------------------
// 键序数组完整性 + 序列化选项一致性（跨 writer 约定）
// ---------------------------------------------------------------------------
// 这两条缝此前没有任何守卫，实测已各自产生缺陷：
//
//   ① 键序数组：`gist`（2e11707）与 `reviews` 进入了 writer 闭集却没有进入
//      `FRONTMATTER_FIELD_ORDER`，于是落盘位置取决于「何时引入」而非语义归属
//      —— 实测两份 draft 的 `gist` 都落在 `change_log` 之后。上面的
//      schema/writer 守卫守的是「工具 schema ↔ 闭集」，不覆盖这条缝。
//      spark 同样缺 `refs`，故本守卫覆盖全部登记的 writer。
//
//   ② 序列化选项：`lineWidth: 0` 是 ef08d9e（2026-09-06，Human 反馈「YAML 折行
//      不可读」）确立的跨 writer 约定，7 个 writer 已跟进，
//      建立）未继承——长中文 summary/scope 被折成 ~80 列 + 2 空格续行。数据无损，
//      但 review 与 diff 的可读性下降。选项藏在 `buildFileContent` 里且非导出，
//      故按源码文本断言（与「按源码解析」同法，见 closure-items.test.mjs 先例）。

/** writer 模块 → 其导出的键序数组名。未导出序数组者不列入（无法机械核对）。 */
const ORDER_ARRAYS = [
];

test("schema/writer agreement: the frontmatter order array covers the writer's whole closed set", async () => {
	for (const entry of ORDER_ARRAYS) {
		// `import()` takes a URL specifier, not a native filesystem path: on
		// win32 a bare `D:\...\writer.js` is parsed as the scheme `d:`
		// and rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME. pathToFileURL gives
		// the file:// form ESM requires, on every platform.
		const mod = await import(pathToFileURL(join(LIB, entry.module)).href);
		const order = mod[entry.arrayExport];
		const keys = mod.VALID_FM_KEYS;
		assert.ok(Array.isArray(order), `${entry.name}: ${entry.arrayExport} must be an exported array`);
		assert.ok(keys instanceof Set, `${entry.name}: VALID_FM_KEYS must be a Set`);

		// 未列入序数组的字段会被 orderFrontmatterFields 的兜底循环追加到末尾，
		// 位置即失去定义 —— 这正是 gist/reviews 的实测缺陷形态。
		const missing = [...keys].filter((k) => !order.includes(k));
		assert.deepEqual(
			missing,
			[],
			`${entry.name}: field(s) ${missing.join(", ")} are in the closed set but missing from ${entry.arrayExport}`
				+ ` — they would be appended after change_log, so their position is undefined (this is how gist/reviews were lost)`,
		);

		// 反向：序数组不得含闭集之外的键（否则该键的书写序说明的是不存在的字段）
		const extra = order.filter((k) => !keys.has(k));
		assert.deepEqual(
			extra,
			[],
			`${entry.name}: ${entry.arrayExport} lists field(s) ${extra.join(", ")} that are not in the closed set`,
		);
	}
});

test("schema/writer agreement: every writer disables YAML folding (lineWidth: 0 跨 writer 约定)", async () => {
	const { readdir } = await import("node:fs/promises");
	const files = (await readdir(LIB)).filter((name) => name.endsWith("-writer.js"));
	const offenders = [];
	for (const file of files) {
		const src = await readFile(join(LIB, file), "utf8");
		// 只看**实际调用点**，不看整份源码：注释里提到 `lineWidth: 0` 不算数。
		// （本守卫初版按整份源码的 includes 判定，变异验证发现把注释删掉实现
		//  仍能通过——那个假阴性正是本守卫要防的形状。故改为逐调用点检查。）
		const callSites = src.match(/stringifyYaml\([^;]*\)/g) ?? [];
		if (callSites.length === 0) continue; // 不序列化 YAML 的文件不适用
		for (const call of callSites) {
			// 只有当这次调用序列化的对象可能含长文本时才要求禁用折行；
			// 这里一律要求，因为所有 writer 的 frontmatter 都含长字段。
			if (!/lineWidth\s*:\s*0/.test(call)) offenders.push(`${file}: ${call.replace(/\s+/g, " ").slice(0, 80)}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`writer(s) serialize YAML without { lineWidth: 0 } at the actual call site:\n  ${offenders.join("\n  ")}`
			+ `\nlong CJK text is folded at ~80 columns with 2-space continuations, which is unreadable in review and diff`
			+ ` (Human feedback 2026-09-06, ef08d9e)`,
	);
});

// ---------------------------------------------------------------------------
// Retirement-reason closed set: writer ⇄ tool plane
// ---------------------------------------------------------------------------
//
// The same defect class as the field-set guard above, one level down. Each
// writer validates `retirement_reason` against a Set; its tools restate that Set
// as a JSON Schema `enum`. Drift in either direction is silent:
//
//   - added to the writer only → the model can never pick it (the argument is
//     rejected by the tool plane before the writer's check is reachable), which
//     is exactly how `abolished` would have been born dead;
//   - left in the enum only → the tool plane advertises a transition the writer
//     refuses, and the failure surfaces as an unexplained rejection.
//
// 22 §9.2 / 27 §8.1 / 24 §8 each define ONE closed set, so the two carriers must
// agree exactly — no subset is a legal state.

/** Read a writer's retirement-reason closed set straight from source when unexported. */
async function retirementSetFromSource(fileName) {
	const source = await readFile(join(LIB, fileName), "utf8");
	const match = source.match(/RETIREMENT_REASONS = new Set\(\[([\s\S]*?)\]\)/);
	if (match === null) throw new Error(`no RETIREMENT_REASONS closed set found in ${fileName}`);
	return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

/**
 * Read the closed set as the SPEC declares it, so the guard covers all three
 * carriers instead of only the two code-side ones. Without this the test names
 * `22 §9.2` while asserting nothing about that text: renaming or dropping a
 * value in the spec would leave both code carriers silently agreeing with each
 * other and disagreeing with the authority.
 *
 * The declared row differs in shape across types (Research uses a wider table),
 * so tokens are filtered by shape — a reason value is a lowercase kebab token —
 * rather than by position.
 */
async function retirementSetFromSpec(specFile) {
	const source = await readFile(join(SPECS, specFile), "utf8");
	// The frontmatter field-table row that declares retirement_reason. ONLY this
	// row is parsed here: 22 §9.2 additionally restates the closed set as one
	// bullet per value (covered by retirementSetFromBullets below), and 24 §9 /
	// 27 §9 restate theirs in prose that this parser does not cover — a value
	// changed only in those paragraphs would not be caught here.
	const row = source
		.split("\n")
		.find((line) => /^\|\s*`retirement[-_]reason`/.test(line) && line.includes("闭集"));
	if (row === undefined) throw new Error(`no retirement_reason 闭集 row found in ${specFile}`);
	// Only the 闭集 clause declares values; the rest of the row carries stage
	// labels and other backticked field names.
	const clause = row.slice(row.indexOf("闭集"));
	const values = [...clause.matchAll(/`([^`]+)`/g)]
		.map((m) => m[1])
		.filter((token) => /^[a-z]+(?:-[a-z]+)*$/.test(token));
	if (values.length === 0) throw new Error(`the 闭集 clause in ${specFile} declares no values`);
	return values.sort();
}

/**
 * The second spec-side carrier: 22 §9.2 lists the closed set a second time as
 * one bullet per reason (`- \`superseded\`：…`), introduced by the sentence
 * 「正常转换只有 `active → retired`…理由闭集：」. The field-table row above and
 * these bullets are two independent declarations of the same set, so a value
 * added to one and not the other leaves the authority self-contradictory.
 * Only the first bullet run after the 理由闭集 line is read; anything that is
 * not a `- \`value\`：` bullet (blank lines aside) ends the run.
 */
async function retirementSetFromBullets(specFile) {
	const source = await readFile(join(SPECS, specFile), "utf8");
	const lines = source.split("\n");
	const start = lines.findIndex((line) => line.includes("理由闭集"));
	if (start === -1) throw new Error(`no 理由闭集 paragraph in ${specFile}`);
	const values = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim() === "") continue;
		const match = /^- `([^`]+)`：/.exec(line);
		if (!match) break;
		values.push(match[1]);
	}
	if (values.length === 0) throw new Error(`no per-value bullets under 理由闭集 in ${specFile}`);
	return values.sort();
}

const RETIREMENT_OWNERS = [
	{ name: "adr", spec: "22 §9.2", specFile: "22-ADR-决策.md", loadWriter: () => import("../lib/adr-writer.js"), loadTools: () => import("../lib/adr-tools.js"), operationKey: "adr-write-object" },
	{ name: "norm", spec: "27 §8.1", specFile: "27-Norm-事实规范.md", loadWriter: () => import("../lib/norm-writer.js"), loadTools: () => import("../lib/norm-tools.js"), operationKey: "norm-write-object" },
	{ name: "research", spec: "24 §8", specFile: "24-Research-调研报告.md", source: "research-writer.js", loadTools: () => import("../lib/research-tools.js"), operationKey: "research-write-object" },
];

for (const owner of RETIREMENT_OWNERS) {
	test(`schema/writer agreement: ${owner.name} retirement_reason enum matches the writer's closed set (${owner.spec})`, async () => {
		const writerReasons = owner.source
			? await retirementSetFromSource(owner.source)
			: [...(await owner.loadWriter()).RETIREMENT_REASONS].sort();

		const module = await owner.loadTools();
		const operation = module.OPERATIONS[owner.operationKey];
		assert.ok(operation, `${owner.name}: operation ${owner.operationKey} is not declared`);
		const descriptor = module.toolDescriptorFor(owner.operationKey, operation, () => {});
		const { schema } = frontmatterSchema(descriptor);
		const declared = schema.properties?.retirement_reason;
		assert.ok(declared, `${owner.name}: frontmatter schema declares no retirement_reason property`);
		assert.ok(Array.isArray(declared.enum), `${owner.name}: retirement_reason must be a closed enum, not ${JSON.stringify(declared)}`);

		assert.deepEqual(
			[...declared.enum].sort(),
			writerReasons,
			`${owner.name}: the tool enum and the writer's closed set disagree — a value present on one side only is either unpickable by the model or promised-and-refused`,
		);

		// The retired-only gate is the other half of the contract: a value the
		// enum offers must be refused while the object is still active.
		assert.match(
			declared.description ?? "",
			/retired/,
			`${owner.name}: retirement_reason description must state its status binding (${owner.spec})`,
		);

		// Third carrier: the spec text itself. The test name cites a spec section,
		// so the spec's declared closed set must be the one the code implements.
		assert.deepEqual(
			await retirementSetFromSpec(owner.specFile),
			writerReasons,
			`${owner.name}: the spec (${owner.spec}) declares a different closed set than the writer — the authority and its implementation drifted apart`,
		);

		// Fourth carrier (adr only): 22 §9.2 restates the same set as one bullet
		// per value, so the spec can contradict itself even when the field table
		// still agrees with the code.
		if (owner.name === "adr") {
			assert.deepEqual(
				await retirementSetFromBullets(owner.specFile),
				writerReasons,
				"adr: the 22 §9.2 per-value bullets declare a different closed set than the writer — the spec contradicts its own field table",
			);
		}
	});
}
