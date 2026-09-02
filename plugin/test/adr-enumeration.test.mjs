// adr-enumeration renderer tests (batch 3 content side).
//
// Pins the enumeration boundaries (03 §8.2 amendment draft v2): active-only,
// summary fields only, one-line truncation, invalid files reported as
// partial (never guessed), empty/absent directory -> null block, digest
// stability, and prompt-interpolation escaping.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderActiveAdrEnumeration, escapePromptText } from "../lib/adr-enumeration.js";
import { withTemp } from "./helpers.mjs";

const ACTIVE_ADR = `title: 规则缺口时先修规则源
status: active
decision: 先修规范再改实现
applicability: 改变行为或接口的缺陷修复
object_id: adr-TEST0001
`;

const CLOSED_ADR = `title: 已关闭旧决定
status: superseded
decision: 旧方向
object_id: adr-TEST0002
`;

async function makeAdrs(base, files) {
	const dir = join(base, "ldvh-base", "adrs");
	await mkdir(dir, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		await writeFile(join(dir, name), content);
	}
	return base;
}

test("renders active ADRs with one-line summaries; non-active excluded", async () => {
	await withTemp("ldvh-adr.", async (base) => {
		await makeAdrs(base, { "a.yaml": ACTIVE_ADR, "b.yaml": CLOSED_ADR });
		const result = await renderActiveAdrEnumeration(base);
		assert.equal(result.active, 1);
		assert.ok(result.text.includes("规则缺口时先修规则源"));
		assert.ok(result.text.includes("决定: 先修规范再改实现"));
		assert.ok(!result.text.includes("已关闭旧决定"), "superseded ADR excluded");
		assert.ok(typeof result.digest === "string" && result.digest.length === 64);
	});
});

test("absent directory and zero-active both yield null block (no injection)", async () => {
	await withTemp("ldvh-adr.", async (base) => {
		const empty = await renderActiveAdrEnumeration(base);
		assert.equal(empty.text, null);
		await makeAdrs(base, { "b.yaml": CLOSED_ADR });
		const noActive = await renderActiveAdrEnumeration(base);
		assert.equal(noActive.text, null);
		assert.equal(noActive.active, 0);
	});
});

test("unparseable file is reported as partial problem, never guessed", async () => {
	await withTemp("ldvh-adr.", async (base) => {
		await makeAdrs(base, { "a.yaml": ACTIVE_ADR, "broken.yaml": ":\n  not: : yaml\n  [" });
		const result = await renderActiveAdrEnumeration(base);
		assert.equal(result.active, 1);
		assert.equal(result.problems.length, 1);
		assert.ok(result.text.includes("读取失败"), "partial marker rendered honestly");
	});
});

test("long fields are hard-truncated to the line budget with ellipsis", async () => {
	await withTemp("ldvh-adr.", async (base) => {
		const long = `title: 长文本\nstatus: active\ndecision: ${"决定".repeat(200)}\nobject_id: adr-LONG\n`;
		await makeAdrs(base, { "long.yaml": long });
		const result = await renderActiveAdrEnumeration(base);
		const decisionLine = result.text.split("\n").find((line) => line.startsWith("  决定:"));
		assert.ok(decisionLine.length <= 210, "line budget enforced");
		assert.ok(decisionLine.endsWith("…"), "truncation marker present");
	});
});

test("digest is stable for identical content and changes with content", async () => {
	await withTemp("ldvh-adr.", async (base) => {
		await makeAdrs(base, { "a.yaml": ACTIVE_ADR });
		const first = await renderActiveAdrEnumeration(base);
		const second = await renderActiveAdrEnumeration(base);
		assert.equal(first.digest, second.digest);
		await writeFile(join(base, "ldvh-base", "adrs", "c.yaml"), ACTIVE_ADR.replace("TEST0001", "TEST0003"));
		const third = await renderActiveAdrEnumeration(base);
		assert.notEqual(third.digest, first.digest);
	});
});

test("prompt interpolation openers are escaped", () => {
	assert.equal(escapePromptText("a {{var}} b"), "a {​{var}} b");
});
