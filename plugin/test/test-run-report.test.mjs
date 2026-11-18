import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	classifyTestRun,
	isUsableForVerdict,
	observedTestCount,
	reconcileTestCount,
	RUN_TERMINAL,
} from "../lib/test-run-report.js";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");

const PASS_OUTPUT = ["▶ a", "ℹ tests 1", "ℹ suites 0", "ℹ pass 1", "ℹ fail 0", "ℹ cancelled 0", ""].join("\n");

const FAIL_OUTPUT = ["▶ a", "✖ bad", "ℹ tests 3", "ℹ pass 1", "ℹ fail 2", "ℹ cancelled 0", ""].join("\n");

const MISSING_OUTPUT = "Could not find '/tmp/x/nope.test.mjs'\n";

test("三态：全通过 ⇒ reported / failed=0", () => {
	const r = classifyTestRun({ stdout: PASS_OUTPUT });
	assert.equal(r.terminal, RUN_TERMINAL.REPORTED);
	assert.equal(r.failed, 0);
	assert.ok(isUsableForVerdict(r));
});

test("三态：有失败 ⇒ reported / failed=2（**退出码非零不得被读成未运行**）", () => {
	const r = classifyTestRun({ stdout: FAIL_OUTPUT, error: { message: "Command failed: node --test (exit 1)" } });
	assert.equal(r.terminal, RUN_TERMINAL.REPORTED);
	assert.equal(r.failed, 2);
	assert.ok(isUsableForVerdict(r));
});

test("三态：测试文件不存在（无汇总块）⇒ not_run，**不得**读作零失败", () => {
	const r = classifyTestRun({ stderr: MISSING_OUTPUT, error: { message: "Command failed: exit 1" } });
	assert.equal(r.terminal, RUN_TERMINAL.NOT_RUN);
	assert.equal(r.failed, null, "取不到计数时必须为 null，不得给 0");
	assert.equal(isUsableForVerdict(r), false, "该终态须使整批结论不可用");
});

test("三态：有汇总块但缺 fail 行 ⇒ count_unavailable（与零区分）", () => {
	const drift = ["ℹ tests 1", "ℹ pass 1", ""].join("\n");
	const r = classifyTestRun({ stdout: drift });
	assert.equal(r.terminal, RUN_TERMINAL.COUNT_UNAVAILABLE);
	assert.equal(r.failed, null);
	assert.equal(isUsableForVerdict(r), false);
});

test("三态：完全空输出 ⇒ not_run（不得因「没有坏消息」而当成功）", () => {
	const r = classifyTestRun({ stdout: "", stderr: "" });
	assert.equal(r.terminal, RUN_TERMINAL.NOT_RUN);
	assert.equal(isUsableForVerdict(r), false);
});

test("三态闭集固定为三值，不新增第四值", () => {
	assert.deepEqual(Object.values(RUN_TERMINAL).sort(), ["count_unavailable", "not_run", "reported"]);
});

test("单一实现：两个脚本都经同一入口，且**不再持有各自的 failCount 副本**", async () => {
	for (const script of ["scripts/mutation-check.mjs", "scripts/drift-check.mjs"]) {
		const src = await readFile(join(PLUGIN, script), "utf8");
		assert.ok(
			/from "\.\.\/lib\/test-run-report\.js"/.test(src),
			`${script} 须从 lib/test-run-report.js 取判定入口`,
		);
		assert.ok(!/:\s*0;\s*\n\}/.test(src), `${script} 不得内联「取不到计数就返回 0」`);
		assert.ok(
			!/(function|const)\s+(failCount|driftFailures)\b/.test(src),
			`${script} 不得再持有自己的 failCount/driftFailures 副本`,
		);
	}
});

test("单一实现：三态判定只在 test-run-report.js 内实现一次", async () => {
	const stripComments = (src) =>
		src
			.split("\n")
			.filter((line) => {
				const t = line.trim();
				return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
			})
			.join("\n");

	for (const f of ["lib/test-run-report.js", "lib/source-recall.js", "lib/recall-injection.js"]) {
		const src = stripComments(await readFile(join(PLUGIN, f), "utf8"));
		const hits = src.match(/Number\(m\[1\]\)\s*:\s*0/g) ?? [];
		assert.equal(hits.length, 0, `${f} 的非注释代码出现「取不到计数即 0」形态 ${hits.length} 次`);
	}
});

test("报告块标记只认本次运行的汇总行，不靠退出码", async () => {
	const src = await readFile(join(PLUGIN, "lib/test-run-report.js"), "utf8");
	assert.match(src, /\^ℹ \(tests\|pass\|fail\) \\d\+\$/m, "报告标记须为「ℹ tests/pass/fail N」的显式多行匹配");
	assert.ok(!/exitCode|signal\s*===\s*null\s*&&/.test(src), "不得以退出码充当运行发生与否的证据");
});


test("observedTestCount 取出汇总行里的条数，取不到时给 null 而不是 0", () => {
	assert.equal(observedTestCount({ stdout: PASS_OUTPUT }), 1);
	assert.equal(observedTestCount({ stdout: FAIL_OUTPUT }), 3);
	assert.equal(observedTestCount({ stdout: "" }), null);
	assert.equal(observedTestCount({ stdout: "▶ a\nℹ pass 1\n" }), null);
	assert.equal(observedTestCount({ stdout: "ℹ tests 7\n" }), 7);
});

test("reconcileTestCount：低于声明数即判不完整（截断的第一道闸）", () => {
	const r = reconcileTestCount({ observed: 2606, declared: 2615, baseline: 2639 });
	assert.equal(r.ok, false);
	assert.match(r.verdict, /低于声明数/);
	assert.match(r.evidence, /2606/);
	assert.match(r.evidence, /2615/);
});

test("reconcileTestCount：声明数是**不完备的下限**，故落在其上的截断须由基线拦", () => {
	const inBaselineOnlyZone = reconcileTestCount({ observed: 2620, declared: 2615, baseline: 2639 });
	assert.equal(inBaselineOnlyZone.ok, false, "2620 高于声明数但低于基线，必须被拦");
	assert.match(inBaselineOnlyZone.verdict, /低于上次全绿基线/);
	assert.match(inBaselineOnlyZone.evidence, /2620/);
	assert.match(inBaselineOnlyZone.evidence, /2639/);
});

test("reconcileTestCount：恰好等于基线或更高即通过（不得因相等而误报）", () => {
	assert.equal(reconcileTestCount({ observed: 2639, declared: 2615, baseline: 2639 }).ok, true);
	assert.equal(reconcileTestCount({ observed: 2700, declared: 2615, baseline: 2639 }).ok, true);
});

test("reconcileTestCount：没有基线时只靠声明数（首次运行不得被误判）", () => {
	assert.equal(reconcileTestCount({ observed: 2639, declared: 2615, baseline: null }).ok, true);
	const truncated = reconcileTestCount({ observed: 2606, declared: 2615, baseline: null });
	assert.equal(truncated.ok, false, "无基线时仍须拦住低于声明数的截断");
});

test("reconcileTestCount：条数不可得一律判失败——不得当作通过也不得当作零失败", () => {
	const r = reconcileTestCount({ observed: null, declared: 2615, baseline: 2639 });
	assert.equal(r.ok, false);
	assert.match(r.verdict, /不可得/);
});

test("守卫实现只有一份：判定逻辑在 lib/test-run-report.js，脚本不另持副本", async () => {
	const script = await readFile(join(PLUGIN, "scripts/run-tests.mjs"), "utf8");
	assert.match(script, /reconcileTestCount/, "脚本须调用 reconcileTestCount");
	assert.match(script, /observedTestCount/, "脚本须调用 observedTestCount");
	assert.ok(
		!/observedTests\s*<\s*baseline/.test(script),
		"脚本不得自行比较 observedTests 与 baseline——判定须只在 lib 内实现一次",
	);
});
