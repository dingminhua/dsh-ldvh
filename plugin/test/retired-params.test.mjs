// specs/06 §6「删除唯一生产者须同轮清理下游」的机械承载（06 §7「删除后的下游清理」行）。
//
// 来源经验：pitfall-ff5a832a（删除唯一生产者后幽灵形参残留致派生恒空）。
// 该条此前**不能退场**，因为规范已立而该机制在实现层**零检测力**：
//   经验正文实测——把 `existingPitfalls` 形参、`existing: existingPitfalls ?? []`
//   调用点、`existing_pitfalls:` 痕迹字段一起放回后，四文件 120 项全绿（前后同为
//   120/120）。也就是说「形参被清退」这件事当时没有任何判据，同类残留已复发过一次
//   （`sessionSignature` → `existingPitfalls`）。
//
// 本套用例锁的是**已清退的形参不得复活**——按形参名、调用点传值、返回痕迹三层：
//   ① 签名里不得再出现已清退的形参名；
//   ② 调用点不得再传该名（含 `X: X ?? …` 这类空转写法）；
//   ③ 返回/痕迹字段里不得再出现同名键形（下划线、驼峰、复数变体均计入）。
//
// **范围如实声明**：只覆盖本仓已实际发生过清退的两处
// （`sessionSignature`、`existingPitfalls`，均在发现-派发链路上）。
// 它不构成「任何形参清退都会被抓住」的通用保证——通用保证需要一张形参清退登记表，
// 而那张表在本仓尚不存在（本条经验的 scope 自认）。故本用例是**反回归**，
// 不是清退完备性的证明。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 剥掉注释行：判据须针对实现，不得把「说明这次清退了什么」的散文算成复活。 */
function nonCommentLines(src) {
	return src
		.split("\n")
		.filter((line) => {
			const t = line.trim();
			if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
			// 行尾注释一并剥（但保留代码本体，避免把 `foo(); // 关于 x 的说明` 整行丢掉）
			return true;
		})
		.map((line) => line.replace(/\/\/.*$/, ""))
		.join("\n");
}

/**
 * 某个已清退的标识符在给定的**代码面**里出现的形态。
 *
 * 三类键形一起算（06 §6「检索不能证明『没有』」的教训：同一语义在不同载体上可有
 * 不同键形——大小写、下划线/驼峰、单复数）：
 *   - 驼峰：`existingPitfalls` / `sessionSignature`
 *   - 下划线痕迹：`existing_pitfalls` / `session_signature`
 *   - 全大写常量：`EXISTING_PITFALLS`
 */
function occurrenceForms(name) {
	const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
	return [name, snake, name.toUpperCase()];
}

const RETIRED = [
	{
		name: "existingPitfalls",
		file: "lib/friction-discovery-provider.js",
		retiredOn: "2026-10-20",
		why: "两段式之后查重属审核段（11 §10.2 第 2 项），捕获段明令不判重复；生产方 idle-checkpoint 也不再读取该列表",
	},
	{
		name: "sessionSignature",
		file: "lib/friction-discovery-provider.js",
		retiredOn: "2026-10-17",
		why: "lifecycle 调用时从不传入，形参恒为 undefined；署名改由 provider 从执行体会话记录取得并随 executorSignature 上抛",
	},
];

for (const { name, file, retiredOn, why } of RETIRED) {
	test(`已清退形参不得复活：${name}（${retiredOn} 清退）`, async () => {
		const src = nonCommentLines(await readFile(join(PLUGIN, file), "utf8"));
		const forms = occurrenceForms(name);
		for (const form of forms) {
			// 用词边界匹配：避免 `existingPitfallsCount` 这类派生被漏掉。
			const re = new RegExp(`\\b${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
			const hits = src.match(re) ?? [];
			assert.equal(
				hits.length,
				0,
				`${file} 的非注释代码出现 ${hits.length} 处 "${form}"——该形参已于 ${retiredOn} 清退（原因：${why}）；` +
					`复活会使它重新变成恒空的幽灵形参（06 §6 删除唯一生产者须同轮清理下游）`,
			);
		}
	});
}

test("调用点不得再向 discover 传已清退的形参（idle-checkpoint 侧）", async () => {
	const src = nonCommentLines(await readFile(join(PLUGIN, "lib/idle-checkpoint.js"), "utf8"));

	// **取实参块须按花括号配平，不得用非贪婪正则**。
	// 曾写 `/await discover\(\{([\s\S]*?)\}\)/` —— 它在 `observationGroups: (…).map((g) => ({…})),`
	// 的 `})` 处就停住，捕获块根本不含 `window:` 及其后诸项，于是「调用点不得传
	// sessionSignature」这条断言**恒真而无检测力**（放回变异实测不转红）。
	// 这与 pitfall-8cbde9ed「回归用例虚构事实读取形状」同机制：断言的取值路径与实际
	// 结构不符，测试全绿却什么都没测。
	const start = src.indexOf("await discover({");
	assert.ok(start >= 0, "idle-checkpoint 的 discover 调用点须可定位（锚点失效即本条判据失效）");
	const open = src.indexOf("{", start);
	let depth = 0;
	let end = -1;
	for (let i = open; i < src.length; i++) {
		const ch = src[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	assert.ok(end > open, "discover 实参块须可完整配平（锚点失效即本条判据失效）");
	const callArgs = src.slice(open + 1, end);
	// 前置断言：块内确实含有后续关键字，否则说明截取仍然过早（防止本判据再次退化为恒真）。
	assert.ok(callArgs.includes("window:"), "截取到的实参块须包含 window: ——否则截取过早，判据会退化为恒真");
	assert.ok(callArgs.includes("tasks:"), "截取到的实参块须包含 tasks: ——同上");

	for (const name of ["existingPitfalls", "sessionSignature"]) {
		assert.ok(!callArgs.includes(name), `discover 调用点不得再传已清退形参 "${name}"`);
	}
	assert.ok(!/\bexisting\s*:/.test(callArgs), `discover 调用点不得再传 "existing:"（曾为空转型参的中转）`);
});

test("provider 返回的痕迹字段不得含已清退键形", async () => {
	// 返回值的键形是消费方（idle-checkpoint/lifecycle）读取的依据。
	// 曾出现 `existing_pitfalls:` 痕迹字段随形参一起复活并静默吸收空值。
	const src = nonCommentLines(await readFile(join(PLUGIN, "lib/friction-discovery-provider.js"), "utf8"));
	for (const key of ["existing_pitfalls", "existingPitfalls", "session_signature", "sessionSignature"]) {
		assert.ok(!src.includes(`${key}:`), `provider 返回值不得再带 "${key}:" 痕迹字段`);
	}
});

test("锚点自检：清退注释仍在（判据假设的前提可读）", async () => {
	// 本条判据依据的是「代码里已无该形参」。若那两段清退注释被一并删掉，
	// 后来者将无从得知这两个名字为何不得复活——此时该判据仍成立但**理由失传**，
	// 故把「理由可读」也钉住，避免只留禁令不留依据。
	const raw = await readFile(join(PLUGIN, "lib/friction-discovery-provider.js"), "utf8");
	for (const name of ["existingPitfalls", "sessionSignature"]) {
		assert.ok(raw.includes(`${name}\` **不再是入参**`), `须保留 "${name}" 的清退说明（含清退日期与原因），否则禁令失去依据`);
	}
});
