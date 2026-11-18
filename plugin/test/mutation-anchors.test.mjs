import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadMutations() {
	const src = await readFile(join(PLUGIN, "scripts", "mutation-check.mjs"), "utf8");
	const start = src.indexOf("const MUTATIONS = [");
	assert.ok(start >= 0, "mutation-check.mjs 须含 `const MUTATIONS = [`");
	let depth = 0;
	let end = -1;
	let inString = null;
	for (let i = src.indexOf("[", start); i < src.length; i += 1) {
		const ch = src[i];
		if (inString !== null) {
			if (ch === "\\") i += 1;
			else if (ch === inString) inString = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inString = ch;
		} else if (ch === "[") {
			depth += 1;
		} else if (ch === "]") {
			depth -= 1;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	assert.ok(end > start, "MUTATIONS 数组须闭合");

	const consts = {};
	for (const m of src.matchAll(/^const (\w+)\s*=\s*(.+?);$/gm)) {
		const value = /join\(PLUGIN,\s*"([^"]+)",\s*"([^"]+)"\)/.exec(m[2]);
		if (value !== null) consts[m[1]] = join(PLUGIN, value[1], value[2]);
	}
	assert.ok(Object.keys(consts).length > 0, "须能解析出至少一个文件路径常量");

	return { mutations: new Function(...Object.keys(consts), `return ${src.slice(src.indexOf("[", start), end + 1)};`)(...Object.values(consts)), consts };
}

test("变异锚点存活：每条变异的 from 片段须仍存在于目标文件（防锚点失修）", async () => {
	const { mutations } = await loadMutations();
	assert.ok(mutations.length > 0, "MUTATIONS 不得为空（空清单会让「全部被抓住」恒真）");

	const sources = new Map();
	const stale = [];
	for (const [file, name, from] of mutations) {
		if (!sources.has(file)) sources.set(file, await readFile(file, "utf8"));
		if (!sources.get(file).includes(from)) stale.push(`${name}（${file}）`);
	}

	assert.deepEqual(
		stale, [],
		`以下变异锚点已失效——源码改写后 from 片段不再匹配，` +
			`该行为当前**无变异级守护**，须更新锚点（不是删掉这条变异）：\n  ` +
			stale.join("\n  "),
	);
});

test("变异锚点存活：每条变异须有唯一的 (文件, 名称)，且 from ≠ to", async () => {
	const { mutations } = await loadMutations();
	const seen = new Set();
	for (const [file, name, from, to] of mutations) {
		const key = `${file}\u0000${name}`;
		assert.ok(!seen.has(key), `变异「${name}」在 ${file} 上重复定义`);
		seen.add(key);
		assert.notEqual(from, to, `变异「${name}」的 from 与 to 相同，等于没有施加任何改变`);
	}
});
