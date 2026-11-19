import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeMutationCoverage } from "../lib/mutation-coverage.js";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");

test("汇总口径：分子与分母各自正确，且同名的用例文件才算专用用例", () => {
	const r = summarizeMutationCoverage({
		mutations: [
			["/abs/path/lib/a.js", "m1", "from", "to"],
			["/abs/path/lib/a.js", "m2", "from", "to"],
			["/abs/path/lib/b.js", "m3", "from", "to"],
			["/abs/path/scripts/x.mjs", "m4", "from", "to"],
		],
		libModules: ["a.js", "b.js", "c.js", "d.js"],
		testModules: ["a.test.mjs", "c.test.mjs"],
	});
	assert.equal(r.libTotal, 4, "分母须是 lib 模块总数");
	assert.deepEqual(r.coveredModules.sort(), ["a.js", "b.js"], "分子须是被变异触及的 lib 模块");
	assert.equal(r.mutationsByModule["a.js"], 2, "同一模块的多条变异须累计");
	assert.deepEqual(r.withOwnTestButNoMutation, ["c.js"], "c 有专用用例但零变异——正是要暴露的那类缺口");
	assert.deepEqual(r.neither, ["d.js"], "d 既无专用用例也无变异");
	assert.equal(r.summaryLine.includes("9/92"), false, "不得出现与本夹具无关的硬编码数");
});

test("汇总口径的正控制：全覆盖时缺口清单须为空（否则「有缺口」恒真）", () => {
	const r = summarizeMutationCoverage({
		mutations: [["/abs/lib/a.js", "m", "f", "t"]],
		libModules: ["a.js"],
		testModules: ["a.test.mjs"],
	});
	assert.deepEqual(r.withOwnTestButNoMutation, [], "全覆盖时不得报缺口");
	assert.deepEqual(r.neither, []);
	assert.match(r.summaryLine, /1\/1/, "分母须为 1");
});

test("汇总口径的负控制：空变异清单须报 0/N，不得静默成 0/0", () => {
	const r = summarizeMutationCoverage({
		mutations: [],
		libModules: ["a.js", "b.js"],
		testModules: ["a.test.mjs"],
	});
	assert.equal(r.libTotal, 2);
	assert.deepEqual(r.coveredModules, []);
	assert.deepEqual(r.withOwnTestButNoMutation, ["a.js"]);
	assert.match(r.summaryLine, /0\/2/, "须报 0/2，不是 0/0");
});

test("报告行必须同时含分子与分母——只报条数正是本账目的原始失效形态", async () => {
	const r = summarizeMutationCoverage({
		mutations: [["/abs/lib/a.js", "m", "f", "t"]],
		libModules: ["a.js", "b.js", "c.js"],
		testModules: [],
	});
	assert.match(r.summaryLine, /\d+\/\d+/, "须以「分子/分母」形态报出");
	assert.match(r.summaryLine, /个 lib 模块/, "须写明分母的口径是 lib 模块数");
	assert.match(r.summaryLine, /零变异/, "须报出「有专用用例但零变异」的模块数");
});

test("报告行里的缺口数必须等于实际缺口数——绑值，不绑措辞", () => {
	const r = summarizeMutationCoverage({
		mutations: [["/abs/lib/a.js", "m", "f", "t"]],
		libModules: ["a.js", "b.js", "c.js", "d.js"],
		testModules: ["b.test.mjs", "c.test.mjs"],
	});
	const gapMatch = /(\d+) 个模块有专用用例但零变异/.exec(r.summaryLine);
	const neitherMatch = /(\d+) 个既无专用用例也无变异/.exec(r.summaryLine);
	assert.ok(gapMatch !== null, `报告行须带缺口数，实际：${r.summaryLine}`);
	assert.ok(neitherMatch !== null, `报告行须带另一类缺口数，实际：${r.summaryLine}`);
	assert.equal(
		Number(gapMatch[1]),
		r.withOwnTestButNoMutation.length,
		"报告行的缺口数须等于实际缺口数（恒报 0 即抹平缺口）",
	);
	assert.equal(Number(neitherMatch[1]), r.neither.length, "报告行的「两者皆无」数须等于实际数");
	assert.equal(r.withOwnTestButNoMutation.length, 2);
	assert.equal(r.neither.length, 1);
});

test("真实仓库的当前覆盖数可回读，且未被说成「已充分覆盖」", async () => {
	const libDir = join(PLUGIN, "lib");
	const testDir = join(PLUGIN, "test");
	const { readFile } = await import("node:fs/promises");
	const src = await readFile(join(PLUGIN, "scripts", "mutation-check.mjs"), "utf8");

	const consts = {};
	for (const m of src.matchAll(/^const (\w+)\s*=\s*(.+?);$/gm)) {
		const value = /join\(PLUGIN,\s*"([^"]+)",\s*"([^"]+)"\)/.exec(m[2]);
		if (value !== null) consts[m[1]] = join(PLUGIN, value[1], value[2]);
	}
	const start = src.indexOf("const MUTATIONS = [");
	assert.ok(start >= 0);
	const targets = [];
	for (const m of src.slice(start).matchAll(/^\t\[(\w+),/gm)) {
		if (consts[m[1]]) targets.push([consts[m[1]]]);
	}
	assert.ok(targets.length > 0, "须能解析出变异目标");

	const r = summarizeMutationCoverage({
		mutations: targets,
		libModules: await readdir(libDir),
		testModules: await readdir(testDir),
	});
	assert.ok(r.libTotal > 0);
	assert.ok(r.coveredModules.length > 0, "至少有一个模块被变异触及");
	assert.ok(
		r.coveredModules.length <= r.libTotal,
		"分子不得超过分母",
	);
	assert.doesNotMatch(r.summaryLine, /充分|完整覆盖|已覆盖全部/, "报告行不得把覆盖数说成结论");
});
