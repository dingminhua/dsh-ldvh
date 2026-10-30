// **变异锚点存活检查**：`scripts/mutation-check.mjs` 的每条变异锚点，
// 其 `from` 源码片段必须仍然存在于目标文件中。
//
// ## 为什么需要它（2026-10-31）
//
// `mutation-check.mjs` 自己已经会在锚点失效时报错并退出 1（第八次复核 N-9 的
// 修复），**但它是手工入口、单次运行约 7 分钟**——日常 `npm test` 不会跑它。
// 于是锚点随源码改写而悄悄失修，直到某人某天手动跑一次才发现。
//
// 本轮实测就吃到两次：`ADR/Pitfall 不优先` 与 `零命中时基线被短路` 两条锚点
// 早已失修（源码重写后 `from` 片段不再匹配）。**更严重的是后果**：前者失修期间
// 它守护的行为其实**已经是死代码**（`rank` 被 `typeRank` 完全覆盖），失修的锚点
// 把「该行为无守护」伪装成了「锚点待更新」，掩盖了一个真实缺陷。
//
// 本用例把「锚点仍能匹配」这一条从 7 分钟的手工运行里摘出来，做成毫秒级检查，
// 使它在每次测试运行中都被核对。
//
// ## 它**不**替代 mutation-check
//
// 锚点存在 ≠ 该变异能被测试抓住。后者只有真跑变异才知道（那是 mutation-check
// 的职责，也是 `06 §5` 要求的「实做对应的变异运行」）。本用例只保证
// **「变异还能施加」**这一前置条件，不主张任何守护已成立。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 从 mutation-check 源码里解析出 `[FILE, "名称", "from", "to"]` 四元组。
 *
 * **不用正则逐行匹配**：`from`/`to` 字符串里含换行与转义（`\\n`、`\\"`），
 * 逐行正则会在第一个换行处断开。改为定位 `const MUTATIONS = [` 到配对 `]`，
 * 再用 `Function` 求值该数组字面量——它只含字符串字面量与常量标识符，
 * 不执行任何副作用。
 */
async function loadMutations() {
	const src = await readFile(join(PLUGIN, "scripts", "mutation-check.mjs"), "utf8");
	const start = src.indexOf("const MUTATIONS = [");
	assert.ok(start >= 0, "mutation-check.mjs 须含 `const MUTATIONS = [`");
	// 括号配对：从中括号起数到配对的 `]`（字符串内的括号须跳过）。
	let depth = 0;
	let end = -1;
	let inString = null;
	for (let i = src.indexOf("[", start); i < src.length; i += 1) {
		const ch = src[i];
		if (inString !== null) {
			if (ch === "\\") i += 1;
			else if (ch === inString) inString = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inString = ch;
		} else if (ch === "[") {
			depth += 1;
		} else if (ch === "]") {
			depth -= 1;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	assert.ok(end > start, "MUTATIONS 数组须闭合");

	// 数组字面量里出现的 `LIB`/`INJ`/`GUID`/`LIFE`/`HM`/`GGR` 等是文件路径常量，须先取值。
	//
	// **不写死名单**：早先这里枚举了四个固定名字，于是新增一个路径常量（本轮
	// 加 `HM`/`GGR`）时 `new Function` 直接抛 `HM is not defined` —— 报错信息
	// 说的是「锚点存活检查崩了」，而不是「解析器不认识这个常量」，排查方向被
	// 引到错的地方。改为扫出**全部** `const X = join(PLUGIN, "dir", "file")`
	// 形态，常量增删无须改本用例。
	const consts = {};
	for (const m of src.matchAll(/^const (\w+)\s*=\s*(.+?);$/gm)) {
		// 只接受 `join(PLUGIN, "lib", "x.js")` 这种纯路径构造。
		const value = /join\(PLUGIN,\s*"([^"]+)",\s*"([^"]+)"\)/.exec(m[2]);
		if (value !== null) consts[m[1]] = join(PLUGIN, value[1], value[2]);
	}
	assert.ok(Object.keys(consts).length > 0, "须能解析出至少一个文件路径常量");

	return { mutations: new Function(...Object.keys(consts), `return ${src.slice(src.indexOf("[", start), end + 1)};`)(...Object.values(consts)), consts };
}

test("变异锚点存活：每条变异的 from 片段须仍存在于目标文件（防锚点失修）", async () => {
	const { mutations } = await loadMutations();
	assert.ok(mutations.length > 0, "MUTATIONS 不得为空（空清单会让「全部被抓住」恒真）");

	const sources = new Map();
	const stale = [];
	for (const [file, name, from] of mutations) {
		if (!sources.has(file)) sources.set(file, await readFile(file, "utf8"));
		if (!sources.get(file).includes(from)) stale.push(`${name}（${file}）`);
	}

	assert.deepEqual(
		stale, [],
		`以下变异锚点已失效——源码改写后 from 片段不再匹配，` +
			`该行为当前**无变异级守护**，须更新锚点（不是删掉这条变异）：\n  ` +
			stale.join("\n  "),
	);
});

test("变异锚点存活：每条变异须有唯一的 (文件, 名称)，且 from ≠ to", async () => {
	// 重名会让「N/N 被抓住」的分子重复计数；from === to 则是空变异——
	// 两者都会让覆盖率虚高，正是 mutation-check 头部记的「测试通过 ≠ 测试有效」
	// 在元工具自身上的复现形态。
	const { mutations } = await loadMutations();
	const seen = new Set();
	for (const [file, name, from, to] of mutations) {
		const key = `${file}\u0000${name}`;
		assert.ok(!seen.has(key), `变异「${name}」在 ${file} 上重复定义`);
		seen.add(key);
		assert.notEqual(from, to, `变异「${name}」的 from 与 to 相同，等于没有施加任何改变`);
	}
});
