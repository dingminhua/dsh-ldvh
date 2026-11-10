/**
 * 守卫：经 `ctx.tools.register` 注册的每一个工具，其参数表必须**真的被执行**。
 *
 * WHY THIS EXISTS
 * spark-5b0b380e 记录过一个存在了约两个月的缺口：12 个工具模块全部以
 * `ctx.tools.register(裸描述符)` 注册。该入口只断言 output/timeoutMs/保留名，
 * 把 definition 原样存入——`parameters` 里的类型、枚举、`additionalProperties: false`
 * 一条都不执行。DSH 的参数校验写在 `defineTool()` 的 execute 闭包内，裸描述符
 * 天然绕过它。于是 specs/10 §5.2 声称的「参数经 JSON Schema 编译校验（违规抛
 * ToolArgsError）」从未成立，参数错误一律延迟到 writer 才暴露。
 *
 * 2026-11-10 接入 `defineTool` 后缺口关闭。**但关闭它的只有代码，没有任何用例
 * 守住它**：把某一层改回裸描述符，全部既有测试仍然通过——`tool-descriptor-contract`
 * 只检查 `output` 块是否存在，参数层是否执行不在它的判据内。这正是本文件补的洞。
 *
 * HOW IT PROBES (行为断言，不看源码文本)
 * 逐个工具构造一个**必被参数层拒绝**的输入，要求 execute 抛 `ToolArgsError`：
 *   - 有 string 型参数的：给该参数传数字（类型错）；
 *   - 没有 string 型参数的（全零参数工具）：给根传数字（根不是 object）。
 * 两条探针都在 `defineTool` 的闭包里判定，且都在 handler 之前 —— 故 handler
 * 不会被调用，写入类工具不会产生副作用。
 *
 * 为什么不扫源码找 `defineTool(`：文本匹配既会漏（换个写法就绕过），也会误报
 * （注释里出现该词）。行为探针问的是「校验到底发不发生」，那才是要守的东西。
 *
 * 正控制见文件末尾：同一个探针打在**裸描述符**上必须不抛，否则本文件的判据
 * 恒真、形同虚设。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { registerLdvhTools } from "../lib/ldvh-tools.js";

/**
 * 以生产同款入口注册全部工具，返回被注册的描述符。
 *
 * `children` 必须传：`registerLdvhTools` 用它判断是否追加
 * `ldvh_collect_subagent_results`（`deps.children !== undefined`）。不传会让本
 * 守卫静默少守一个工具——那正是 2026-09-26 真机上漏掉该工具的同一种失效。
 */
function registerAll() {
	const registered = [];
	const ctx = {
		tools: {
			register(definition) {
				registered.push(definition);
				return () => {};
			},
		},
	};
	registerLdvhTools(ctx, { children: new Map() });
	return registered;
}

/** 一个必定违反该工具参数表的输入。 */
function violatingArgs(definition) {
	const properties = definition.parameters?.properties ?? {};
	const stringKey = Object.keys(properties).find((name) => properties[name]?.type === "string");
	// 有 string 参数就给它传数字；全零参数工具则让根不再是 object。
	return stringKey === undefined ? 42 : { [stringKey]: 12345 };
}

/** 返回本次调用抛出的错误，未抛出则为 null。 */
async function rejectionOf(execute, args) {
	try {
		await execute(args, {});
		return null;
	} catch (error) {
		return error;
	}
}

test("每一个经 ctx.tools.register 注册的工具都在参数层拒绝非法输入", async () => {
	const registered = registerAll();
	assert.ok(registered.length > 0, "expected the LDVH tool batch to register something");

	const names = registered.map((definition) => definition.name);
	assert.equal(
		new Set(names).size,
		names.length,
		`duplicate tool names registered: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`,
	);
	// 46 是当前登记的全部 LDVH 工具。数量写下界而非等值：新增工具不应让本守卫
	// 失效，但**减少**工具（例如某层悄悄没注册）必须转红。
	assert.ok(
		registered.length >= 46,
		`expected the full LDVH tool batch (>= 46), registered ${registered.length}`,
	);

	const unguarded = [];
	for (const definition of registered) {
		const error = await rejectionOf(definition.execute, violatingArgs(definition));
		if (error?.name !== "ToolArgsError") {
			unguarded.push(`${definition.name} (got ${error === null ? "no throw" : error.name})`);
		}
	}

	assert.deepEqual(
		unguarded,
		[],
		`these tools registered WITHOUT an enforced parameter layer — most likely their layer `
			+ `reverted to a bare descriptor passed straight to ctx.tools.register (specs/10 §5.2, `
			+ `spark-5b0b380e):\n  ${unguarded.join("\n  ")}`,
	);
});

test("正控制：同一探针打在裸描述符上不抛错（判据确实能分辨）", async () => {
	const registered = registerAll();
	const sample = registered.find(
		(definition) => Object.values(definition.parameters?.properties ?? {}).some((node) => node?.type === "string"),
	);
	assert.ok(sample !== undefined, "expected at least one tool with a string parameter");

	// 与真实描述符相比只把 execute 换成不校验的裸实现——即旧注册路径产出的形状。
	const bare = {
		name: sample.name,
		description: sample.description,
		parameters: sample.parameters,
		output: sample.output,
		async execute() {
			return { envelope: { operation_key: "probe" } };
		},
	};

	const error = await rejectionOf(bare.execute, violatingArgs(bare));
	assert.equal(
		error,
		null,
		"the probe must NOT reject a bare descriptor, otherwise the guard would pass on a broken registration",
	);
});
