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

import { VALID_FM_KEYS as SPARK_FM_KEYS } from "../lib/spark-writer.js";
import { VALID_FM_KEYS as ADR_FM_KEYS } from "../lib/adr-writer.js";
import { VALID_FM_KEYS as PITFALL_FM_KEYS } from "../lib/pitfall-writer.js";
import { VALID_FM_KEYS as FRICTION_FM_KEYS } from "../lib/friction-writer.js";
import { VALID_FM_KEYS as NORM_FM_KEYS } from "../lib/norm-writer.js";

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
];

/** Read a writer's closed set straight from source when it is not exported. */
async function writerKeysFromSource(fileName) {
	const source = await readFile(join(LIB, fileName), "utf8");
	const match = source.match(/VALID_FM_KEYS = new Set\(\[([\s\S]*?)\]\)/);
	if (match === null) throw new Error(`no VALID_FM_KEYS closed set found in ${fileName}`);
	return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** The schema properties for the create-time frontmatter argument. */
function frontmatterSchemaFields(descriptor) {
	const key = Object.keys(descriptor.parameters.properties).find((name) => name.startsWith("frontmatter"));
	assert.ok(key, `no frontmatter argument declared by ${descriptor.name}`);
	const schema = descriptor.parameters.properties[key];
	return {
		fields: new Set(Object.keys(schema.properties ?? {}).filter((field) => field !== "change_summary")),
		additionalProperties: schema.additionalProperties,
	};
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
