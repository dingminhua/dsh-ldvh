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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The very function the DSH runtime calls before a tool handler runs.
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";

import { VALID_FM_KEYS as SPARK_FM_KEYS } from "../lib/spark-writer.js";
import { VALID_FM_KEYS as ADR_FM_KEYS } from "../lib/adr-writer.js";
import { VALID_FM_KEYS as PITFALL_FM_KEYS } from "../lib/pitfall-writer.js";
import { VALID_FM_KEYS as FRICTION_FM_KEYS } from "../lib/friction-writer.js";
import { VALID_FM_KEYS as NORM_FM_KEYS } from "../lib/norm-writer.js";
import { VALID_FM_KEYS as WORKCASE_FM_KEYS } from "../lib/workcase-writer.js";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");

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
		name: "workcase",
		writerKeys: WORKCASE_FM_KEYS,
		load: () => import("../lib/workcase-tools.js"),
		operationKey: "workcase-write-object",
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
			const args = structuredClone(base);
			// Only optional fields need probing; required ones are already in.
			args[key][field] = schema.properties?.[field] !== undefined
				? valueSatisfying(schema.properties[field])
				: "x";

			// The exact call the DSH runtime makes before the handler runs.
			const violations = validateJsonSchemaValue(descriptor.parameters, args, "");
			for (const violation of violations) failures.push(`${type.name}.${field}: ${violation}`);
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
		.filter((name) => !["goal"].includes(name)); // Goal is a singleton with no frontmatter draft argument
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
//      spark 同样缺 `refs`，故本守卫覆盖全部登记的 writer 而不只 workcase。
//
//   ② 序列化选项：`lineWidth: 0` 是 ef08d9e（2026-09-06，Human 反馈「YAML 折行
//      不可读」）确立的跨 writer 约定，7 个 writer 已跟进，workcase（2026-09-15
//      建立）未继承——长中文 summary/scope 被折成 ~80 列 + 2 空格续行。数据无损，
//      但 review 与 diff 的可读性下降。选项藏在 `buildFileContent` 里且非导出，
//      故按源码文本断言（与「按源码解析」同法，见 closure-items.test.mjs 先例）。

/** writer 模块 → 其导出的键序数组名。未导出序数组者不列入（无法机械核对）。 */
const ORDER_ARRAYS = [
	{ name: "workcase", module: "workcase-writer.js", arrayExport: "FRONTMATTER_FIELD_ORDER" },
];

test("schema/writer agreement: the frontmatter order array covers the writer's whole closed set", async () => {
	for (const entry of ORDER_ARRAYS) {
		const mod = await import(join(LIB, entry.module));
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
