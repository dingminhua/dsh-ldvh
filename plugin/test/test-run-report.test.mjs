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

import { classifyTestRun, isUsableForVerdict, RUN_TERMINAL } from "../lib/test-run-report.js";

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
