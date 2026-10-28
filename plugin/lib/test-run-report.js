// 批量测试判定的**唯一入口**：把「跑了但取不到计数」与「根本没跑」从「取到零」
// 里分离出来（specs/06 §5「『没有输出』与『输出为零』是两个结果」）。
//
// ## 为什么需要它（2026-10-28）
//
// `scripts/mutation-check.mjs` 与 `scripts/drift-check.mjs` 曾各自持有一份
// `return m ? Number(m[1]) : 0`。同一段判定被复制两份（违 06 §6 单一实现原则），
// 且两处都把「取不到 `ℹ fail N`」并入 0：
//
//   - 被测测试文件不存在时，node 打印 `Could not find …`、退出码 1，
//     输出里没有 `ℹ fail N` → 旧逻辑返回 0 → 判为「没有测试失败」
//     → mutation-check 报「存活」、drift-check 报「未报警」。**测试根本没跑，
//     结论却是「跑了且没发现问题」。**
//   - 这是 pitfall-fa36d461 的原始失效点，规范条文早已立在 06 §5，
//     实现一直没跟上（本条经验因此不能退场）。
//
// ## 判据（照 06 §5 的三项要求）
//
// 1. **运行是否发生，证据须与本次结果无关**：用「运行器是否产出了它的汇总块」
//    （`ℹ tests N` / `ℹ pass N` / `ℹ fail N` 任一，属于本次运行的报告行）。
//    **退出码不单独充当该证据**——非零退出既可能是「跑了且失败」，也可能是
//    「根本没启动」；把它当判据会把正常的失败运行误判成未运行。
// 2. **取不到计数时给独立终态**，不得并入零计数。
// 3. 该终态须**使整批结论不可用**——调用方不得据此声称「全部存活／全部通过」。

/** 批量判定的三种终态（闭集）。 */
export const RUN_TERMINAL = Object.freeze({
	/** 运行发生，且失败计数可读。 */
	REPORTED: "reported",
	/** 运行发生（有报告块），但取不到失败计数。 */
	COUNT_UNAVAILABLE: "count_unavailable",
	/** 无运行证据：运行器没有产出任何本次运行的报告行。 */
	NOT_RUN: "not_run",
});

/** 报告块的存在性标记——**只看存在，不看数值**（06 §5 第 1 项）。 */
const REPORT_MARKER = /^ℹ (tests|pass|fail) \d+$/m;
/** 失败计数行。 */
const FAIL_LINE = /^ℹ fail (\d+)$/m;

/**
 * 把一次 `node --test` 的原始输出归类为三种终态之一。
 *
 * @param {{ stdout?: string, stderr?: string, error?: { message?: string } | null }} input
 *   调用方把 stdout 与 stderr **合并**后传入亦可（node 的汇总写在 stdout，
 *   但启动期错误写在 stderr，两处都要看）。
 * @returns {{ terminal: string, failed: number|null, verdict: string, evidence: string }}
 *   `verdict` 是给报告的短句；`evidence` 说明该判定据何得出（供交还引用）。
 */
export function classifyTestRun({ stdout = "", stderr = "", error = null } = {}) {
	const out = `${stdout ?? ""}${stderr ?? ""}`;

	if (!REPORT_MARKER.test(out)) {
		// 无报告块：可能是被测文件不存在、node 自身启动失败、或进程被信号打断。
		// 三者都属「本次运行没有产出结论」，一律不得读作「零失败」。
		const why = error?.message ? `；调用方观察到错误：${error.message}` : "";
		return {
			terminal: RUN_TERMINAL.NOT_RUN,
			failed: null,
			verdict: "未运行（无报告块）",
			evidence: `输出中不存在 「ℹ tests|pass|fail N」任一行${why}`,
		};
	}

	const m = FAIL_LINE.exec(out);
	if (m === null) {
		// 报告块在（运行确已发生），但缺失败计数行——两种形态须与零区分。
		return {
			terminal: RUN_TERMINAL.COUNT_UNAVAILABLE,
			failed: null,
			verdict: "计数不可得（已运行）",
			evidence: "存在报告块但缺 「ℹ fail N」行",
		};
	}

	return {
		terminal: RUN_TERMINAL.REPORTED,
		failed: Number(m[1]),
		verdict: "",
		evidence: `「ℹ fail ${m[1]}」`,
	};
}

/**
 * 判定某次运行**是否可用来支撑「被抓住／未报警」这类结论**。
 *
 * 06 §5 第 3 项：出现不可用终态时，不得以「全部存活／全部通过」收尾，
 * 并使该批结果不可用于后续结论。调用方据此把该批结论作废即可。
 */
export function isUsableForVerdict(classified) {
	return classified.terminal === RUN_TERMINAL.REPORTED;
}
