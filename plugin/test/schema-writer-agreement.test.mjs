
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";

import { VALID_FM_KEYS as SPARK_FM_KEYS } from "../lib/spark-writer.js";
import { VALID_FM_KEYS as PITFALL_FM_KEYS } from "../lib/pitfall-writer.js";
import { VALID_FM_KEYS as FRICTION_FM_KEYS } from "../lib/friction-writer.js";
import { VALID_FM_KEYS as NORM_FM_KEYS } from "../lib/norm-writer.js";
import { VALID_FM_KEYS as SUBGOAL_FM_KEYS } from "../lib/subgoal-writer.js";

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "lib");
const SPECS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "specs");

const CODE_ASSIGNED = new Set([
	"object_uid",
	"fact_type_key",
	"created_at",
	"change_log",
	"retired_at",
	"goal_key",
]);

const TYPES = [
	{
		name: "spark",
		writerKeys: SPARK_FM_KEYS,
		load: () => import("../lib/spark-tools.js"),
		operationKey: "spark-write-object",
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
		name: "report",
		writerKeys: null,
		load: () => import("../lib/report-tools.js"),
		operationKey: "report-write-object",
		writerFile: "report-writer.js",
	},
	{
		name: "subgoal",
		writerKeys: SUBGOAL_FM_KEYS,
		load: () => import("../lib/subgoal-tools.js"),
		operationKey: "subgoal-write-object",
	},
];

async function writerKeysFromSource(fileName) {
	const source = await readFile(join(LIB, fileName), "utf8");
	const match = source.match(/VALID_FM_KEYS = new Set\(\[([\s\S]*?)\]\)/);
	if (match === null) throw new Error(`no VALID_FM_KEYS closed set found in ${fileName}`);
	return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function frontmatterSchema(descriptor) {
	const key = Object.keys(descriptor.parameters.properties).find((name) => name.startsWith("frontmatter"));
	assert.ok(key, `no frontmatter argument declared by ${descriptor.name}`);
	return { key, schema: descriptor.parameters.properties[key] };
}

function frontmatterSchemaFields(descriptor) {
	const { schema } = frontmatterSchema(descriptor);
	return {
		fields: new Set(Object.keys(schema.properties ?? {}).filter((field) => field !== "change_summary")),
		additionalProperties: schema.additionalProperties,
	};
}

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

function valueVariantsSatisfying(schema) {
	if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
		return schema.oneOf.map((branch) => valueSatisfying(branch));
	}
	return [valueSatisfying(schema)];
}

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

		const phantom = [...fields].filter((field) => !writerKeys.has(field));
		assert.deepEqual(
			phantom,
			[],
			`${type.name}: tool schema declares ${phantom.join(", ")} but the writer's closed set rejects them`,
		);
	});
}


test("schema/writer agreement: the DSH argument validator accepts every optional field", async () => {
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
			const declared = schema.properties?.[field];
			const candidates = declared !== undefined ? valueVariantsSatisfying(declared) : ["x"];
			for (const [variantIndex, candidate] of candidates.entries()) {
				const args = structuredClone(base);
				args[key][field] = candidate;

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

	assert.deepEqual(
		validateJsonSchemaValue(descriptor.parameters, args, ""),
		[],
		"precondition failed: a priority-carrying call should already be valid",
	);

	const broken = structuredClone(descriptor.parameters);
	delete broken.properties.frontmatter_draft.properties.priority;
	const violations = validateJsonSchemaValue(broken, args, "");

	assert.ok(
		violations.some((v) => v.includes("priority")),
		`the reachability check must detect a field missing from the schema, got: ${JSON.stringify(violations)}`,
	);
});

test("schema/writer agreement: every fact-type writer is covered by this guard", async () => {
	const { readdir } = await import("node:fs/promises");
	const files = await readdir(LIB);
	const writerTypes = files
		.filter((name) => name.endsWith("-writer.js"))
		.map((name) => name.replace("-writer.js", ""))
		.filter((name) => !["goal", "devlog"].includes(name));
	const covered = new Set(TYPES.map((type) => type.name));
	const uncovered = writerTypes.filter((name) => !covered.has(name));
	assert.deepEqual(
		uncovered,
		[],
		`writer(s) ${uncovered.join(", ")} exist but are not covered by the schema/writer agreement guard — add them to TYPES`,
	);
});


const ORDER_ARRAYS = [
];

test("schema/writer agreement: the frontmatter order array covers the writer's whole closed set", async () => {
	for (const entry of ORDER_ARRAYS) {
		const mod = await import(pathToFileURL(join(LIB, entry.module)).href);
		const order = mod[entry.arrayExport];
		const keys = mod.VALID_FM_KEYS;
		assert.ok(Array.isArray(order), `${entry.name}: ${entry.arrayExport} must be an exported array`);
		assert.ok(keys instanceof Set, `${entry.name}: VALID_FM_KEYS must be a Set`);

		const missing = [...keys].filter((k) => !order.includes(k));
		assert.deepEqual(
			missing,
			[],
			`${entry.name}: field(s) ${missing.join(", ")} are in the closed set but missing from ${entry.arrayExport}`
				+ ` — they would be appended after change_log, so their position is undefined (this is how gist/reviews were lost)`,
		);

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
		const callSites = src.match(/stringifyYaml\([^;]*\)/g) ?? [];
		if (callSites.length === 0) continue;
		for (const call of callSites) {
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


async function retirementSetFromSource(fileName) {
	const source = await readFile(join(LIB, fileName), "utf8");
	const match = source.match(/RETIREMENT_REASONS = new Set\(\[([\s\S]*?)\]\)/);
	if (match === null) throw new Error(`no RETIREMENT_REASONS closed set found in ${fileName}`);
	return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

async function retirementSetFromSpec(specFile) {
	const source = await readFile(join(SPECS, specFile), "utf8");
	const row = source
		.split("\n")
		.find((line) => /^\|\s*`retirement[-_]reason`/.test(line) && line.includes("闭集"));
	if (row === undefined) throw new Error(`no retirement_reason 闭集 row found in ${specFile}`);
	const clause = row.slice(row.indexOf("闭集"));
	const values = [...clause.matchAll(/`([^`]+)`/g)]
		.map((m) => m[1])
		.filter((token) => /^[a-z]+(?:-[a-z]+)*$/.test(token));
	if (values.length === 0) throw new Error(`the 闭集 clause in ${specFile} declares no values`);
	return values.sort();
}

const RETIREMENT_OWNERS = [
	{ name: "norm", spec: "23 §8.1", specFile: "23-Norm-事实规范.md", loadWriter: () => import("../lib/norm-writer.js"), loadTools: () => import("../lib/norm-tools.js"), operationKey: "norm-write-object" },
	{ name: "report", spec: "24 §8", specFile: "24-Report-报告.md", source: "report-writer.js", loadTools: () => import("../lib/report-tools.js"), operationKey: "report-write-object" },
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

		assert.match(
			declared.description ?? "",
			/retired/,
			`${owner.name}: retirement_reason description must state its status binding (${owner.spec})`,
		);

		assert.deepEqual(
			await retirementSetFromSpec(owner.specFile),
			writerReasons,
			`${owner.name}: the spec (${owner.spec}) declares a different closed set than the writer — the authority and its implementation drifted apart`,
		);
	});
}
