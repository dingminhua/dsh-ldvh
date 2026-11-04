// **变异覆盖的可观察性**：守卫的是「缺口能否被看见」，不是「覆盖够不够」。
//
// ## 为什么这组用例存在（friction-5c5b6261 的处置，2026-11-04）
//
// 该账目的现象是「守卫用例空断言致变异零检出」，反复出现 6 次。三个原始场景
// （直接调内部函数绕过投影映射、否定式用例对整层失效不敏感、夹具形状与生产
// 不同构）都已被各自的修复补上用例。**但机制没变**：缺口的载体不是某条用例，
// 而是「没人看得见缺口在哪里」。
//
// 实测（2026-11-04 真跑 `mutation-check.mjs`）：50/50 被抓住，而这个数字掩盖了
// **只触及 9/92 个 lib 模块**、59 个模块有专用用例但零变异的事实。故新增
// `lib/mutation-coverage.js` 把该事实变成可读的数，本用例钉住它**不被说成别的**。
//
// ## 这组用例不主张什么
//
// 它**不**断言「覆盖率必须达到 X」——那个数是判断，属 Human 决定（00 §4）。
// 它只钉两件事：① 汇总口径本身正确（正控制 + 负控制）；② 报告行**必须同时
// 含分子与分母**——只报「50 条变异」正是本账目的原始失效形态。
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
			// 非 lib 目标不计入（脚本条目等）——但它仍是合法变异，只是不在 lib 覆盖口径内。
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
	// 反控制：若实现把「未覆盖」算错成恒有，上面那条会绿而这条会红。
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
	// 「空清单」若被算成 0/0，读作「没有问题」；实际是「一条都没测」。
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
	// 这是本模块存在的**唯一理由**，故单独立一条钉住它。
	// 反向：把 summaryLine 改成只报「N 条变异」而不带「/模块总数」即转红。
	const r = summarizeMutationCoverage({
		mutations: [["/abs/lib/a.js", "m", "f", "t"]],
		libModules: ["a.js", "b.js", "c.js"],
		testModules: [],
	});
	assert.match(r.summaryLine, /\d+\/\d+/, "须以「分子/分母」形态报出");
	assert.match(r.summaryLine, /个 lib 模块/, "须写明分母的口径是 lib 模块数");
	// 且必须报出缺口数——只报覆盖数会让人以为没缺口。
	assert.match(r.summaryLine, /零变异/, "须报出「有专用用例但零变异」的模块数");
});

test("报告行里的缺口数必须等于实际缺口数——绑值，不绑措辞", () => {
	// **这条是补出来的**（2026-11-04，自查变异发现）：上面那两条只断言「报告行
	// 含『零变异』字样」，而把报告行里的缺口数改成恒 `0` 时**仍然全绿**——
	// 「0 个模块有专用用例但零变异」也含「零变异」三个字。断言绑的是措辞而不是值，
	// 于是它对「缺口被抹平」这种最要紧的失效**没有检测力**。
	//
	// 这正是本模块要防的那类缺陷在自身用例上的重演，故单独立一条：把报告行里的
	// 数字抠出来，与数组长度逐一比对。
	const r = summarizeMutationCoverage({
		mutations: [["/abs/lib/a.js", "m", "f", "t"]],
		libModules: ["a.js", "b.js", "c.js", "d.js"],
		testModules: ["b.test.mjs", "c.test.mjs"], // b、c 有专用用例但零变异；d 两者皆无
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
	// 夹具自身的正控制：这两类缺口在本次输入下**非零**，否则上面的相等断言
	// 会被「两边都是 0」满足——那正是「否定式用例缺正控制」的形态。
	assert.equal(r.withOwnTestButNoMutation.length, 2);
	assert.equal(r.neither.length, 1);
});

test("真实仓库的当前覆盖数可回读，且未被说成「已充分覆盖」", async () => {
	// 这条**不做阈值断言**（阈值属 Human 决定）。它只钉住：
	// ① 真实现状可被读出；② 报告行不会把 9/92 说成「覆盖充分」。
	const libDir = join(PLUGIN, "lib");
	const testDir = join(PLUGIN, "test");
	const { readFile } = await import("node:fs/promises");
	const src = await readFile(join(PLUGIN, "scripts", "mutation-check.mjs"), "utf8");

	// 从脚本源码取出变异清单的**目标文件**：只取 `[CONST,` 形态的首元所在常量。
	// 不解析 from/to（含换行与转义，逐行正则会在换行处断开）——本用例只要目标。
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
	// 关键：报告行**不得**出现「充分」「完整覆盖」之类结论词——它只报事实。
	assert.doesNotMatch(r.summaryLine, /充分|完整覆盖|已覆盖全部/, "报告行不得把覆盖数说成结论");
});
