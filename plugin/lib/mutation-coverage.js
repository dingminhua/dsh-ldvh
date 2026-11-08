/**
 * 变异覆盖的**可观察口径**（friction-5c5b6261 的处置）。
 *
 * ## 为什么需要它（2026-11-04）
 *
 * `scripts/mutation-check.mjs` 的输出长期只有一个数字：「50/50 被抓住」。这个
 * 数字**读起来像「守护有效」，实际只说明「这 50 条变异各自被某条用例抓住了」**——
 * 它对「哪些模块根本没有变异」一个字都不说。实测（2026-11-04）：
 *
 *   · lib 模块 92 个，变异清单只触及 **9 个**；
 *   · 其中 **59 个模块有专用用例文件，却零条变异**；
 *   · 另有 24 个模块既无专用用例、也无变异。
 *
 * 也就是说，「50/50 被抓住」的真实含义是「已写的那 50 条都被抓住了」，
 * 而不是「守护覆盖了这 92 个模块」。两者在输出上无从区分——这正是
 * `friction-5c5b6261`（守卫用例空断言致变异零检出）能够反复重现的**结构性原因**：
 * 缺口的载体不是某一条写错的用例，而是**没人看得见缺口在哪里**。
 *
 * ## 本模块只做一件事：把这个缺口变成可读的数
 *
 * 它**不**声称覆盖已充分，也**不**给出「覆盖率应达到多少」的判据——那个数是
 * 判断，应由 Human 定（`00 §3`）。本模块只提供**事实**：多少个模块被变异触及、
 * 多少个有专用用例却未被触及。判据与处置留在调用方与其用例里。
 *
 * ## 边界（如实声明）
 *
 * 1. **「被变异触及」不等于「该模块的守护有效」**：一条变异被抓住只能证明
 *    「这条失效形态当前有守护」，不能证明该模块其他行为也有守护。
 * 2. **「有专用用例文件」不等于「该模块被有效守护」**：文件名对应只是一种
 *    组织约定，一个模块的用例完全可能整份都是零检测力断言（那正是本账目的现象）。
 * 3. 因此本模块给出的数**只能用来暴露缺口，不能用来主张覆盖充分**。
 */

/**
 * 汇总变异覆盖情况。
 *
 * @param {object} input
 * @param {Array<[string, ...any[]]>} input.mutations 变异清单（每项首元是目标文件绝对路径）
 * @param {string[]} input.libModules `lib/` 下的模块文件名（含 `.js`）
 * @param {string[]} input.testModules `test/` 下的用例文件名（含 `.test.mjs`）
 * @returns {{
 *   libTotal: number,
 *   coveredModules: string[],
 *   mutationsByModule: Record<string, number>,
 *   withOwnTestButNoMutation: string[],
 *   neither: string[],
 *   summaryLine: string
 * }}
 *
 * `summaryLine` 是给人读的一行，**必须同时含被触及数与模块总数**：只报前者
 * （如「50 条变异」）正是本账目的原始失效形态。
 */
export function summarizeMutationCoverage({ mutations = [], libModules = [], testModules = [] } = {}) {
	// 变异清单里的首元是绝对路径；只保留落在 `lib/` 下的，且归一成文件名。
	const mutationsByModule = {};
	for (const entry of Array.isArray(mutations) ? mutations : []) {
		const target = Array.isArray(entry) ? entry[0] : entry;
		if (typeof target !== "string" || target === "") continue;
		// 取末段文件名：清单用绝对路径，本函数不假设路径分隔符（Windows 亦有）。
		const name = target.split(/[\\/]/).pop();
		if (!name || !name.endsWith(".js")) continue;
		mutationsByModule[name] = (mutationsByModule[name] ?? 0) + 1;
	}

	const libs = [...new Set((Array.isArray(libModules) ? libModules : []).filter((n) => typeof n === "string" && n.endsWith(".js")))].sort();
	const coveredModules = libs.filter((name) => mutationsByModule[name] !== undefined);

	// 用例文件的「同名」约定：`foo.js` ↔ `foo.test.mjs`。
	const testStems = new Set(
		(Array.isArray(testModules) ? testModules : [])
			.filter((n) => typeof n === "string" && n.endsWith(".test.mjs"))
			.map((n) => n.slice(0, -".test.mjs".length)),
	);
	const hasOwnTest = (name) => testStems.has(name.slice(0, -".js".length));

	const withOwnTestButNoMutation = coveredModules.length === libs.length
		? []
		: libs.filter((name) => mutationsByModule[name] === undefined && hasOwnTest(name));
	const neither = libs.filter((name) => mutationsByModule[name] === undefined && !hasOwnTest(name));

	const mutationCount = Object.values(mutationsByModule).reduce((a, b) => a + b, 0);
	const summaryLine =
		`变异覆盖：${mutationCount} 条变异触及 ${coveredModules.length}/${libs.length} 个 lib 模块`
		+ `（${withOwnTestButNoMutation.length} 个模块有专用用例但零变异，`
		+ `${neither.length} 个既无专用用例也无变异）`;

	return {
		libTotal: libs.length,
		coveredModules,
		mutationsByModule,
		withOwnTestButNoMutation,
		neither,
		summaryLine,
	};
}
