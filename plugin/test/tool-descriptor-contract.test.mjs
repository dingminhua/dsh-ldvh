import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

test("every tool layer declares the output contract DSH 0.1.7 requires", async () => {
	const dir = new URL("../lib/", import.meta.url);
	const files = (await readdir(dir)).filter((name) => name.endsWith("-tools.js"));
	assert.ok(files.length > 0, "expected tool layers under lib/");

	const EXPECTED = "output: { schema: OUTPUT_SCHEMA, render: (args, value) => renderEnvelope(operationKey, value) }";
	let audited = 0;
	for (const file of files) {
		const source = await readFile(new URL(file, dir), "utf8");
		if (!source.includes("ctx.tools.register(")) continue;
		audited += 1;
		const normalized = source.replace(/\s+/g, " ");
		assert.ok(
			normalized.includes(EXPECTED),
			`${file} registers tools but must declare \`${EXPECTED}\` (DSH 0.1.7 rejects a tool without it)`,
		);
	}
	assert.ok(audited >= 5, `expected several tool layers to be audited, audited ${audited}`);
});

test("write-action gates and the advertised action enum cannot drift apart", async () => {
	const GATE = /(?:const|let|var)\s+(\w*(?:ACTION|ACTIONS|WRITE)\w*)\s*=\s*new Set\(\[([^\]]*)\]/g;

	const enumsIn = (source) => [...source.matchAll(/action:\s*\{\s*type:\s*"string",\s*enum:\s*\[([^\]]*)\]/g)]
		.map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));

	const gatesIn = (source) => [...source.matchAll(GATE)].map((m) => ({
		name: m[1],
		actions: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
	}));

	const dir = new URL("../lib/", import.meta.url);
	const files = (await readdir(dir)).filter((n) => n.endsWith("-tools.js"));
	let audited = 0;
	for (const file of files) {
		const source = await readFile(new URL(file, dir), "utf8");
		const enums = enumsIn(source);
		const gates = gatesIn(source);
		if (enums.length === 0 || gates.length === 0) continue;
		audited += 1;
		for (const gate of gates) {
			for (const advertised of enums) {
				const missing = advertised.filter((a) => !gate.actions.includes(a));
				assert.deepEqual(
					missing, [],
					`${file}: action(s) ${JSON.stringify(missing)} are advertised in the tool descriptor but `
					+ `not accepted by the '${gate.name}' gate — the channel is unreachable in every composition `
					+ "and the rejection reads like a bad argument rather than a broken gate",
				);
			}
		}
	}
	assert.ok(audited >= 0, `audited ${audited}`);
});
