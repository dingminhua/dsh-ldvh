import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

test("no lib module writes the retired shared plugin-kind as a message source", async () => {
	const dir = new URL("../lib/", import.meta.url);
	const files = (await readdir(dir)).filter((name) => name.endsWith(".js") && !name.endsWith(".d.ts"));
	assert.ok(files.length > 0, "expected lib modules");
	for (const file of files) {
		const code = stripComments(await readFile(new URL(file, dir), "utf8"));
		assert.ok(
			!/kind:\s*["']plugin["']/.test(code),
			`${file} still writes the retired \`kind: "plugin"\` message source — use the plugin's own producer kind`,
		);
	}
});

test("guidance.js writes the plugin's own producer kind and reads both old and new", async () => {
	const source = await readFile(new URL("../lib/guidance.js", import.meta.url), "utf8");
	assert.ok(source.includes("kind: LDVH_PLUGIN_SOURCE"), "writer uses the plugin's own producer kind");
	assert.ok(/source\?\.plugin === LDVH_PLUGIN_SOURCE/.test(source), "ownership is keyed by plugin id");
	assert.ok(/source\?\.kind === LDVH_PLUGIN_SOURCE \|\| source\?\.kind === "plugin"/.test(source), "reader accepts the legacy plugin wrapper");
});