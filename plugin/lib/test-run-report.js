
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

export function reconcileTestCount({ observed, declared, baseline }) {
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
	return {
		ok: true,
		verdict: "条数对账通过",
		evidence: `本次 ${observed} 条${baseline !== null && baseline !== undefined ? `，基线 ${baseline} 条` : "（无基线，本次为首次）"}`,
	};
}
