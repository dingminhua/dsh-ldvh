
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const GUIDANCE_PATH = join(import.meta.dirname, "..", "lib", "guidance-text.js");
const SPECS_DIR = join(import.meta.dirname, "..", "..", "specs");

function extractReferences(text) {
	const refs = [];
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
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

function anchorResolves(specText, anchor) {
	const m = /^§(\d+)(?:\.(\d+))?$/.exec(anchor);
	if (m === null) return false;
	if (m[2] === undefined) {
		return new RegExp(`^#{2,3} ${Number(m[1])}\\.?(?:\\s|$)`, "m").test(specText);
	}
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

	assert.ok(
		refs.length >= 1,
		`应至少抽出一处锚点引用，实际 ${refs.length} 处——若引导文本改了引用形式，请同步更新本测试的抽取规则`,
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

