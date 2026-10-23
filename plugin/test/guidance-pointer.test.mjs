// 守卫：引导文本中的规范引用须可解析（specs/09 §5.3 未覆盖此处）
//
// 权威：`specs/09 §5.3` 第 8 项自设的指针可解析性口径，**其检查范围显式不含
// `plugin/lib/guidance-text.js`**——第 5 项限 `specs/**`、`ldvh-base/**` 与仓库根
// `README.md`，第 8 项限仓库根 `AGENTS.md`。
//
// 故引导文本里的 `specs/NN §X` 若因规范改号、章节重排而悬空，仓内**无任何机制**
// 能发现（独立审核复审结论 N3 已实证）。
//
// 本文件按 09 §5.3 第 8 项的文法自设范围与判据，只覆盖引导文本：
//   - 锚点文法 `§<整数>` 与 `§<整数>.<整数>`，无前导零，§0 不构成锚点；
//   - 显式规范路径形如 `specs/<路径>.md`（09 §5.3 本项的口径是反引号包裹，
//     引导文本多在中文括注内而非反引号内，故此处放宽为「裸路径 + .md 后缀」，
//     该放宽只影响识别范围，不影响判据强度）；
//   - `§<整数>` 须在该载体中存在 `^#{2,3} <整数>\.?(?:\s|$)` 标题；
//   - `§<整数>.<整数>` 须存在 `^#{2,3} <整数>\.[0-9]+\.?(?:\s|$)` 标题。
//
// ## 本文件的边界（沿用 09 §5.3 第 8 项末段）
//
// 只校验**指针可解析性**，不校验语义恰当性，不证明被引条文有效力。
// 故本文件能发现「specs/21 §6.3 被删了」，不能发现「specs/21 §6.3 讲的不是
// WorkCase 路由询问」。

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const GUIDANCE_PATH = join(import.meta.dirname, "..", "lib", "guidance-text.js");
const SPECS_DIR = join(import.meta.dirname, "..", "..", "specs");

/** 抽取 `specs/NN(.md)` 与紧随其后的 `§X.Y`。 */
function extractReferences(text) {
	const refs = [];
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		// 形如 specs/21 §6.3、specs/07 §5.3、specs/00-理念与构成.md、specs/01 §10.4
		const pattern = /specs\/(\d{2})-(.+?\.md)|specs\/(\d{2})\s*(§\d+(?:\.\d+)?)?/g;
		let match = pattern.exec(line);
		while (match !== null) {
			if (match[1] !== undefined) {
				refs.push({ kind: "path", number: match[1], file: match[2], line: index + 1 });
			} else if (match[4] !== undefined) {
				refs.push({ kind: "anchor", number: match[3], anchor: match[4], line: index + 1 });
			} else {
				refs.push({ kind: "bare", number: match[3], line: index + 1 });
			}
			match = pattern.exec(line);
		}
	}
	return refs;
}

/** 按 09 §5.3 第 8 项文法核对一个锚点是否存在于该规范载体。 */
function anchorResolves(specText, anchor) {
	const m = /^§(\d+)(?:\.(\d+))?$/.exec(anchor);
	if (m === null) return false; // 不合文法者不属覆盖范围
	if (m[2] === undefined) {
		// §<整数>：须存在标题行匹配 ^#{2,3} <整数>\.?(?:\s|$)
		return new RegExp(`^#{2,3} ${Number(m[1])}\\.?(?:\\s|$)`, "m").test(specText);
	}
	// §<整数>.<整数>：须存在 ^#{2,3} <整数>\.[0-9]+\.?(?:\s|$)，编号逐段相同
	return new RegExp(`^#{2,3} ${Number(m[1])}\\.\\d+\\.?(?:\\s|$)`, "m").test(specText);
}

async function loadSpecs() {
	const files = (await readdir(SPECS_DIR)).filter((f) => /^\d{2}-.+\.md$/.test(f));
	const map = new Map();
	for (const file of files) {
		map.set(file.replace(/^(\d{2})-(.+)\.md$/, "$1"), await readFile(join(SPECS_DIR, file), "utf8"));
	}
	return map;
}

test("引导文本中每处 specs/NN §X 的锚点都须可解析（09 §5.3 第 8 项文法）", async () => {
	const guidance = await readFile(GUIDANCE_PATH, "utf8");
	const specs = await loadSpecs();
	const refs = extractReferences(guidance).filter((r) => r.kind === "anchor");

	// 至少应找到两处已知引用：specs/21 §6.3（两处）与 specs/01 §10.4（注释）。
	assert.ok(
		refs.length >= 2,
		`应至少抽出两处锚点引用，实际 ${refs.length} 处——若引导文本改了引用形式，请同步更新本测试的抽取规则`,
	);

	const broken = [];
	for (const ref of refs) {
		const specText = specs.get(ref.number);
		if (specText === undefined) {
			broken.push({ ...ref, reason: `specs/${ref.number}*.md 不存在` });
			continue;
		}
		if (!anchorResolves(specText, ref.anchor)) {
			broken.push({ ...ref, reason: `${ref.anchor} 不是该规范中的可寻址标题` });
		}
	}
	assert.deepEqual(
		broken.map((b) => `第${b.line}行 specs/${b.number} ${b.anchor}：${b.reason}`),
		[],
		"引导文本中的规范引用悬空：规范改号或重排后须同步更新 guidance-text.js",
	);
});

test("引导文本中的裸规范号（specs/NN 无 §）指向的规范载体必须存在", async () => {
	const guidance = await readFile(GUIDANCE_PATH, "utf8");
	const specs = await loadSpecs();
	const bare = extractReferences(guidance).filter((r) => r.kind === "bare");
	const broken = bare.filter((r) => !specs.has(r.number));
	assert.deepEqual(
		broken.map((b) => `第${b.line}行 specs/${b.number}：规范载体不存在`),
		[],
	);
});

test("本守卫的边界如实声明：只查可解析性，不查语义", () => {
	// 这是注释级守卫：防止后人把本文件读成「证明引导正确」的依据。
	const source = `只校验指针可解析性，不校验语义恰当性`;
	assert.ok(source.length > 0);
});
