import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

/**
 * 工具描述符契约：DSH 0.1.7 要求每个工具声明 `output: { schema, render }`。
 *
 * 缺了它 `ctx.tools.register` 直接抛错（真机日志：`tool "ldvh_goal_read" must
 * declare output { schema, render, presentationMeta? }`）；更麻烦的是注册中途抛错会
 * 让 lifecycle 的幂等守卫（`syncTools` 里 `toolsDisposer === null`）永远无法落地，
 * 于是每次 assemble 都重试并刷「already registered」警告——工具面缺项，日志被噪声
 * 淹没。
 *
 * 2026-09-25 在 desktop profile 的真机验证中发现 `goal-tools.js` 是唯一漏掉的一层，
 * 而当时 927 个单测全绿——没有任何一条覆盖这条契约。本文件即为补上的守卫：它按
 * 层扫描，凡通过 `ctx.tools.register` 注册工具的层都必须带同一形状的 output 块。
 */
test("every tool layer declares the output contract DSH 0.1.7 requires", async () => {
	const dir = new URL("../lib/", import.meta.url);
	const files = (await readdir(dir)).filter((name) => name.endsWith("-tools.js"));
	assert.ok(files.length > 0, "expected tool layers under lib/");

	const EXPECTED = "output: { schema: OUTPUT_SCHEMA, render: (args, value) => renderEnvelope(operationKey, value) }";
	let audited = 0;
	for (const file of files) {
		const source = await readFile(new URL(file, dir), "utf8");
		// 只审「真的注册工具」的层：纯 writer/工具函数文件不在本契约内。
		if (!source.includes("ctx.tools.register(")) continue;
		audited += 1;
		// 折叠空白后再比对，避免缩进变化造成的假失败。
		const normalized = source.replace(/\s+/g, " ");
		assert.ok(
			normalized.includes(EXPECTED),
			`${file} registers tools but must declare \`${EXPECTED}\` (DSH 0.1.7 rejects a tool without it)`,
		);
	}
	assert.ok(audited >= 5, `expected several tool layers to be audited, audited ${audited}`);
});

/**
 * 写入口的前置校验闭集必须与工具描述符公布的 `action` 枚举一致（21 §14）。
 *
 * 实测缺陷：`ldvh_workcase_write` 的描述符枚举早已列出 `request_adjustment` /
 * `decide_adjustment`（21 §14 增量审批），两个处理分支也都实现了，但
 * `workcase-tools.js` 的 `WRITE_ACTIONS` 前置集合漏了它们。于是每次调用都在
 * 前置校验处被拒，报错写作「unknown action」——**看起来像参数写错，实际是门坏了**，
 * 于是该通道对所有 composition 静默失效，且没有任何测试覆盖这道闭集。
 *
 * 本守卫把两张清单绑在一起：新增一个 action 时只改一处会当场转红。
 */
test("write-action gates and the advertised action enum cannot drift apart", async () => {
	// Only a Set that actually gates the write path participates. Identifying
	// it by text shape alone would drag in unrelated Sets (e.g. an allow-list
	// over field names), so the gate is located by its own declaration name.
	const GATE = /(?:const|let|var)\s+(\w*(?:ACTION|ACTIONS|WRITE)\w*)\s*=\s*new Set\(\[([^\]]*)\]/g;

	/** Every `action` enum literal in a tool descriptor, keyed by nothing. */
	const enumsIn = (source) => [...source.matchAll(/action:\s*\{\s*type:\s*"string",\s*enum:\s*\[([^\]]*)\]/g)]
		.map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));

	/** Named Sets that look like action gates, with their members. */
	const gatesIn = (source) => [...source.matchAll(GATE)].map((m) => ({
		name: m[1],
		actions: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
	}));

	const dir = new URL("../lib/", import.meta.url);
	const files = (await readdir(dir)).filter((n) => n.endsWith("-tools.js"));
	let audited = 0;
	for (const file of files) {
		const source = await readFile(new URL(file, dir), "utf8");
		const enums = enumsIn(source);
		const gates = gatesIn(source);
		if (enums.length === 0 || gates.length === 0) continue;
		audited += 1;
		for (const gate of gates) {
			for (const advertised of enums) {
				const missing = advertised.filter((a) => !gate.actions.includes(a));
				assert.deepEqual(
					missing, [],
					`${file}: action(s) ${JSON.stringify(missing)} are advertised in the tool descriptor but `
					+ `not accepted by the '${gate.name}' gate — the channel is unreachable in every composition `
					+ "and the rejection reads like a bad argument rather than a broken gate",
				);
			}
		}
	}
	assert.ok(audited >= 1, `expected at least one tool layer pairing an action enum with an action gate, audited ${audited}`);
});
