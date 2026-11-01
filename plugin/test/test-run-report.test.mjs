// specs/06 §5「『没有输出』与『输出为零』是两个结果」的机械承载（06 §7「批量判定的零值歧义」行）。
//
// 来源经验：pitfall-fa36d461（验证副本目标已存在致缺失输出被读作确定结论）。
// 该条此前**不能退场**，正因为条文已立而原始失效点未修：
//   `scripts/mutation-check.mjs` 与 `scripts/drift-check.mjs` 各持一份
//   `return m ? Number(m[1]) : 0`，把「测试没跑」并入「零失败」。
//
// 本套用例锁三件事：
//   ① 三态可区分（reported / count_unavailable / not_run）；
//   ② **退出码不单独充当「运行发生过」的证据**（06 §5 第 1 项）——
//      失败运行（exit 1）必须仍判「已运行」，不能被误判成未运行；
//   ③ 两个脚本都改用同一入口，且不再持有各自的 failCount 副本（06 §6 单一实现）。
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

/** 真实的 node --test 汇总块（全通过）。 */
const PASS_OUTPUT = ["▶ a", "ℹ tests 1", "ℹ suites 0", "ℹ pass 1", "ℹ fail 0", "ℹ cancelled 0", ""].join("\n");

/** 真实的 node --test 汇总块（有失败）——注意 `fail 2` 与 `tests 3` 并存。 */
const FAIL_OUTPUT = ["▶ a", "✖ bad", "ℹ tests 3", "ℹ pass 1", "ℹ fail 2", "ℹ cancelled 0", ""].join("\n");

/** 被测文件不存在时 node 的真实输出形态：只有 stderr 的一句，无汇总块。 */
const MISSING_OUTPUT = "Could not find '/tmp/x/nope.test.mjs'\n";

test("三态：全通过 ⇒ reported / failed=0", () => {
	const r = classifyTestRun({ stdout: PASS_OUTPUT });
	assert.equal(r.terminal, RUN_TERMINAL.REPORTED);
	assert.equal(r.failed, 0);
	assert.ok(isUsableForVerdict(r));
});

test("三态：有失败 ⇒ reported / failed=2（**退出码非零不得被读成未运行**）", () => {
	// 这一条防的是 06 §5 第 1 项点名的反向失效：把「跑了且失败」判成「没跑」，
	// 会让每一个真正被抓住的变异项都显示成「无可用判定」。
	const r = classifyTestRun({ stdout: FAIL_OUTPUT, error: { message: "Command failed: node --test (exit 1)" } });
	assert.equal(r.terminal, RUN_TERMINAL.REPORTED);
	assert.equal(r.failed, 2);
	assert.ok(isUsableForVerdict(r));
});

test("三态：测试文件不存在（无汇总块）⇒ not_run，**不得**读作零失败", () => {
	// 这是 pitfall-fa36d461 的原始失效点：旧逻辑 `m ? Number(m[1]) : 0` 在此返回 0，
	// 于是「测试根本没跑」被判成「跑了且没有失败」。
	const r = classifyTestRun({ stderr: MISSING_OUTPUT, error: { message: "Command failed: exit 1" } });
	assert.equal(r.terminal, RUN_TERMINAL.NOT_RUN);
	assert.equal(r.failed, null, "取不到计数时必须为 null，不得给 0");
	assert.equal(isUsableForVerdict(r), false, "该终态须使整批结论不可用");
});

test("三态：有汇总块但缺 fail 行 ⇒ count_unavailable（与零区分）", () => {
	// 构造一个「运行发生了但计数行缺失」的形态：pass 行在、fail 行不在。
	// 这是格式漂移下的真实风险——node 改版或 runner 换成别的适配器时，
	// 「取不到计数」会被旧逻辑吞成 0。
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
	// 06 §6：同一规则只存在唯一职责入口实现，无副本逻辑。
	// 反向：任一脚本重新内联 `Number(m[1]) : 0` 即转红。
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
	// 反向：别的文件里再出现「取不到计数并入 0」的同一形态即转红。
	//
	// **须先剥注释**：本模块的文档注释里引用了被修掉的旧代码原文
	// （`return m ? Number(m[1]) : 0`），直接文本匹配会把「说明」当成「实现」。
	// 这是 06 §5「源码文本断言」要防的形态之一——断言的字形须指向被测对象，
	// 不得把引用它的散文一并计入。故此处只扫**非注释行**。
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
	// 判据须可读出：报告标记是一个显式的多行正则，而不是拿 exitCode 兜。
	assert.match(src, /\^ℹ \(tests\|pass\|fail\) \\d\+\$/m, "报告标记须为「ℹ tests/pass/fail N」的显式多行匹配");
	// 反向：实现里不得出现以退出码判「是否运行」的分支。
	assert.ok(!/exitCode|signal\s*===\s*null\s*&&/.test(src), "不得以退出码充当运行发生与否的证据");
});

// ---------------------------------------------------------------------------
// 条数对账（observedTestCount / reconcileTestCount）
//
// 来源：2026-11-02 实测 —— `--test-force-exit` 在同一测试文件的多个 runner
// 并存时可能让文件执行到一半就退出，而汇总块完全自洽（tests 62 / pass 62 /
// fail 0）、退出码也是 0。24 次并发里 3 次截断（91 条的 commit-validation
// 出现过 42/83/85 条）。本组用例锁住三件事：
//   ① 取不到条数与「零条」必须可区分（与 06 §5 同一纪律）；
//   ② 声明数只能当下限，落在声明数与基线之间的截断要靠基线拦；
//   ③ 基线不得因一次截断而下移（否则一次截断就把后续所有截断合法化）。
// ---------------------------------------------------------------------------

test("observedTestCount 取出汇总行里的条数，取不到时给 null 而不是 0", () => {
	assert.equal(observedTestCount({ stdout: PASS_OUTPUT }), 1);
	assert.equal(observedTestCount({ stdout: FAIL_OUTPUT }), 3);
	// 「取不到」与「零条」是两种结果：这里必须是 null
	assert.equal(observedTestCount({ stdout: "" }), null);
	assert.equal(observedTestCount({ stdout: "▶ a\nℹ pass 1\n" }), null);
	// stderr 合并后同样可读（node 的启动期错误写在 stderr）
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
	// 实测形态：声明 2615、全绿 2639，截断落在两者之间（如 2606 高于声明数？不，
	// 2606 < 2615；用 2620 表示真正只在基线区间里的截断）。
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
	// 脚本须调用共享实现，而不是自己写一套比较逻辑
	assert.match(script, /reconcileTestCount/, "脚本须调用 reconcileTestCount");
	assert.match(script, /observedTestCount/, "脚本须调用 observedTestCount");
	// 反向：脚本里不得再出现独立的条数比较分支（那是第二份判定的形态）
	assert.ok(
		!/observedTests\s*<\s*baseline/.test(script),
		"脚本不得自行比较 observedTests 与 baseline——判定须只在 lib 内实现一次",
	);
});
