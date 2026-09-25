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
