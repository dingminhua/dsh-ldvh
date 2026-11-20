
export const RUN_TERMINAL = Object.freeze({
	REPORTED: "reported",
	COUNT_UNAVAILABLE: "count_unavailable",
	NOT_RUN: "not_run",
});

// 汇总行方言：spec reporter 写「ℹ …」，TAP reporter 写「# …」。两入口
// （drift-check / mutation-check）据此判运行是否发生、失败数几何。
const SPEC_MARKER = /^ℹ (tests|pass|fail) \d+$/m;
const TAP_MARKER = /^# (tests|pass|fail) \d+$/m;
const SPEC_FAIL = /^ℹ fail (\d+)$/m;
const TAP_FAIL = /^# fail (\d+)$/m;

export function classifyTestRun({ stdout = "", stderr = "", error = null } = {}) {
	const out = `${stdout ?? ""}${stderr ?? ""}`;
	const reported = SPEC_MARKER.test(out) || TAP_MARKER.test(out);

	if (!reported) {
		const why = error?.message ? `；调用方观察到错误：${error.message}` : "";
		return {
			terminal: RUN_TERMINAL.NOT_RUN,
			failed: null,
			verdict: "未运行（无报告块）",
			evidence: `输出中不存在 「ℹ/# tests|pass|fail N」任一行${why}`,
		};
	}

	const m = SPEC_FAIL.exec(out) ?? TAP_FAIL.exec(out);
	if (m === null) {
		return {
			terminal: RUN_TERMINAL.COUNT_UNAVAILABLE,
			failed: null,
			verdict: "计数不可得（已运行）",
			evidence: "存在报告块但缺 「ℹ/# fail N」行",
		};
	}

	return {
		terminal: RUN_TERMINAL.REPORTED,
		failed: Number(m[1]),
		verdict: "",
		evidence: `「ℹ/# fail ${m[1]}」`,
	};
}

export function isUsableForVerdict(classified) {
	return classified.terminal === RUN_TERMINAL.REPORTED;
}

// 计数方言：spec reporter 写「ℹ tests N」，TAP reporter（Node 22 非 TTY）
// 写「# tests N」。两者都是 node --test 自己的汇总行；只认汇总行、不数
// 顶层 ok 行（后者在 suite 嵌套时会把一组用例算成一行，且漏计嵌套 skip）。
// 方言缺失时一律 null（fail-closed），由调用方按「未完成」处置。
function summaryCount(text, key) {
	const spec = new RegExp(`^ℹ ${key} (\\d+)$`, "m").exec(text);
	if (spec !== null) return { value: Number(spec[1]), dialect: "spec" };
	const tap = new RegExp(`^# ${key} (\\d+)$`, "m").exec(text);
	if (tap !== null) return { value: Number(tap[1]), dialect: "tap" };
	return { value: null, dialect: null };
}

export function observedTestCount({ stdout = "", stderr = "" } = {}) {
	return summaryCount(`${stdout ?? ""}${stderr ?? ""}`, "tests").value;
}

export function observedSkippedCount({ stdout = "", stderr = "" } = {}) {
	return summaryCount(`${stdout ?? ""}${stderr ?? ""}`, "skipped").value;
}

export function observedCountDialect({ stdout = "", stderr = "" } = {}) {
	return summaryCount(`${stdout ?? ""}${stderr ?? ""}`, "tests").dialect;
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
			evidence: "输出中不存在「ℹ/# tests N」汇总行",
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
				evidence: "输出中不存在「ℹ/# skipped N」汇总行",
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
