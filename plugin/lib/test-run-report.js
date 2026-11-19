
export const RUN_TERMINAL = Object.freeze({
	REPORTED: "reported",
	COUNT_UNAVAILABLE: "count_unavailable",
	NOT_RUN: "not_run",
});

const REPORT_MARKER = /^ℹ (tests|pass|fail) \d+$/m;
const FAIL_LINE = /^ℹ fail (\d+)$/m;

export function classifyTestRun({ stdout = "", stderr = "", error = null } = {}) {
	const out = `${stdout ?? ""}${stderr ?? ""}`;

	if (!REPORT_MARKER.test(out)) {
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

export function isUsableForVerdict(classified) {
	return classified.terminal === RUN_TERMINAL.REPORTED;
}

export function observedTestCount({ stdout = "", stderr = "" } = {}) {
	const m = /^ℹ tests (\d+)$/m.exec(`${stdout ?? ""}${stderr ?? ""}`);
	return m === null ? null : Number(m[1]);
}

export function observedSkippedCount({ stdout = "", stderr = "" } = {}) {
	const m = /^ℹ skipped (\d+)$/m.exec(`${stdout ?? ""}${stderr ?? ""}`);
	return m === null ? null : Number(m[1]);
}

export function countTestBlocks(text) {
	let total = 0;
	for (const line of text.split("\n")) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
		if (/^(test|it)(\.[a-zA-Z]+)?\s*\(/.test(trimmed)) total += 1;
	}
	return total;
}

export function reconcileTestCount({ observed, declared, baseline, skipped, skippedBaseline }) {
	if (observed === null || observed === undefined) {
		return {
			ok: false,
			verdict: "条数不可得（不得读作零失败）",
			evidence: "输出中不存在「ℹ tests N」行",
		};
	}
	if (declared !== null && declared !== undefined && observed < declared) {
		return {
			ok: false,
			verdict: `低于声明数，${declared - observed} 条从未运行`,
			evidence: `本次 ${observed} 条，源码声明 ${declared} 条`,
		};
	}
	if (baseline !== null && baseline !== undefined && observed < baseline) {
		return {
			ok: false,
			verdict: `低于上次全绿基线，${baseline - observed} 条消失`,
			evidence: `本次 ${observed} 条，上次全绿 ${baseline} 条（删减须经评审，不随单次运行下移）`,
		};
	}
	if (skippedBaseline !== null && skippedBaseline !== undefined) {
		if (skipped === null || skipped === undefined) {
			return {
				ok: false,
				verdict: "skip 计数不可得（不得读作零 skip）",
				evidence: "输出中不存在「ℹ skipped N」行",
			};
		}
		if (skipped > skippedBaseline) {
			return {
				ok: false,
				verdict: `skip 数高于基线，新增 ${skipped - skippedBaseline} 条未执行`,
				evidence: `本次 skip ${skipped} 条，基线 ${skippedBaseline} 条（新增 skip 须经评审，不随单次运行上移）`,
			};
		}
	}
	return {
		ok: true,
		verdict: "条数对账通过",
		evidence: `本次 ${observed} 条${baseline !== null && baseline !== undefined ? `，基线 ${baseline} 条` : "（无基线，本次为首次）"}${skippedBaseline !== null && skippedBaseline !== undefined ? `，skip ${skipped ?? "不可得"} 条（基线 ${skippedBaseline}）` : ""}`,
	};
}
