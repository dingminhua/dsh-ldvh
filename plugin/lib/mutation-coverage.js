
export function summarizeMutationCoverage({ mutations = [], libModules = [], testModules = [] } = {}) {
	const mutationsByModule = {};
	for (const entry of Array.isArray(mutations) ? mutations : []) {
		const target = Array.isArray(entry) ? entry[0] : entry;
		if (typeof target !== "string" || target === "") continue;
		const name = target.split(/[\\/]/).pop();
		if (!name || !name.endsWith(".js")) continue;
		mutationsByModule[name] = (mutationsByModule[name] ?? 0) + 1;
	}

	const libs = [...new Set((Array.isArray(libModules) ? libModules : []).filter((n) => typeof n === "string" && n.endsWith(".js")))].sort();
	const coveredModules = libs.filter((name) => mutationsByModule[name] !== undefined);

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
