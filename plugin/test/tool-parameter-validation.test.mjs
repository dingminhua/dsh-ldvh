import test from "node:test";
import assert from "node:assert/strict";

import { registerLdvhTools } from "../lib/ldvh-tools.js";

function registerAll() {
	const registered = [];
	const ctx = {
		tools: {
			register(definition) {
				registered.push(definition);
				return () => {};
			},
		},
	};
	registerLdvhTools(ctx, { children: new Map() });
	return registered;
}

function violatingArgs(definition) {
	const properties = definition.parameters?.properties ?? {};
	const stringKey = Object.keys(properties).find((name) => properties[name]?.type === "string");
	return stringKey === undefined ? 42 : { [stringKey]: 12345 };
}

async function rejectionOf(execute, args) {
	try {
		await execute(args, {});
		return null;
	} catch (error) {
		return error;
	}
}

test("每一个经 ctx.tools.register 注册的工具都在参数层拒绝非法输入", async () => {
	const registered = registerAll();
	assert.ok(registered.length > 0, "expected the LDVH tool batch to register something");

	const names = registered.map((definition) => definition.name);
	assert.equal(
		new Set(names).size,
		names.length,
		`duplicate tool names registered: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`,
	);
	assert.ok(
		registered.length >= 33,
		`expected the full LDVH tool batch (>= 33), registered ${registered.length}`,
	);

	const unguarded = [];
	for (const definition of registered) {
		const error = await rejectionOf(definition.execute, violatingArgs(definition));
		if (error?.name !== "ToolArgsError") {
			unguarded.push(`${definition.name} (got ${error === null ? "no throw" : error.name})`);
		}
	}

	assert.deepEqual(
		unguarded,
		[],
		`these tools registered WITHOUT an enforced parameter layer — most likely their layer `
			+ `reverted to a bare descriptor passed straight to ctx.tools.register (specs/10 §5.2, `
			+ `spark-5b0b380e):\n  ${unguarded.join("\n  ")}`,
	);
});

test("正控制：同一探针打在裸描述符上不抛错（判据确实能分辨）", async () => {
	const registered = registerAll();
	const sample = registered.find(
		(definition) => Object.values(definition.parameters?.properties ?? {}).some((node) => node?.type === "string"),
	);
	assert.ok(sample !== undefined, "expected at least one tool with a string parameter");

	const bare = {
		name: sample.name,
		description: sample.description,
		parameters: sample.parameters,
		output: sample.output,
		async execute() {
			return { envelope: { operation_key: "probe" } };
		},
	};

	const error = await rejectionOf(bare.execute, violatingArgs(bare));
	assert.equal(
		error,
		null,
		"the probe must NOT reject a bare descriptor, otherwise the guard would pass on a broken registration",
	);
});
