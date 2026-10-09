// Web 专属设计文档的目录与命名约定守卫。
//
// WHY THIS EXISTS（真实缺陷，非假设）：
//
// `specs/07` §5.5 规定：全部 Web 专属设计文档位于 `plugin/web/docs/`，文件名形如
// `NN-<短名>.md`，序号不得改号或复用，每份文档首部须声明范围与上位依据。
//
// 这不是洁癖，而是本仓已付出过代价的形态：
//   · **改号事故**：2026-10-08 规范改号（Web 10→07、DSH 环境 08→10）后，21 号 15 处
//     引用仍指旧号位、指向了另一份规范的无关章节，**形式合法、语义错误**，按号位替换
//     的机械修复查不出，直到数月后人工发现。
//   · **缺声明**：无首部声明的文档，读者无法判断它管什么、受谁约束，只能翻源码或问人。
//
// 本守卫把该约定落成可机检的断言，使约定不因无人记得而漂移。
//
// 证明边界（`specs/06` §5 要求声明）：本守卫断言的是**文件形态**，不是内容质量——
// 它不证明文档写得对、覆盖全或与实现一致。首部声明的**语义**（是否真的说清范围）
// 属人工审核范围。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', '..', 'docs');

/** `specs/07` §5.5 规定的文件名形态：两位序号 + 短名 + .md。 */
const NAME_PATTERN = /^(\d{2})-[^/]+\.md$/;

async function docFiles() {
	const entries = await readdir(docsDir, { withFileTypes: true });
	return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort();
}

test('全部 Web 专属设计文档位于 plugin/web/docs/ 且命名为 NN-<短名>.md', async () => {
	const files = await docFiles();
	assert.ok(files.length > 0, 'plugin/web/docs/ 不应为空');
	const bad = files.filter((f) => !NAME_PATTERN.test(f));
	assert.deepEqual(
		bad,
		[],
		`以下文件不符合 specs/07 §5.5 的命名约定（NN-<短名>.md）：${JSON.stringify(bad)}`,
	);
});

test('序号不重复且不跳号复用（specs/07 §5.5：序号一经分配不得改号或复用）', async () => {
	const files = await docFiles();
	const nums = files.map((f) => f.match(NAME_PATTERN)?.[1]).filter(Boolean);
	const seen = new Set();
	const dup = [];
	for (const n of nums) {
		if (seen.has(n)) dup.push(n);
		seen.add(n);
	}
	assert.deepEqual(
		dup,
		[],
		`序号重复：${JSON.stringify(dup)}。specs/07 §5.5 禁止序号复用——改号或复用会使既有引用静默指错。`,
	);
});

test('每份文档首部声明范围与上位依据（specs/07 §5.5）', async () => {
	const files = await docFiles();
	const missing = [];
	for (const f of files) {
		const text = await readFile(join(docsDir, f), 'utf8');
		const head = text.split('\n').slice(0, 14).join('\n');
		// 首部须有引用块行声明**范围**（管什么）与**上位**（受谁约束）。
		// 上位以两种既有写法之一承载：显式「上位」行，或指向同目录/规范的具体依据行
		// （如「全局设计语言：01-…」「图标规范：09-…」「基于…建立」）——两者都使读者
		// 无需外部索引即可判断该文档受谁约束，与本条的用意一致。
		const declaresScope = /^>\s.*(范围|路由|定位|状态|基于)/m.test(head);
		const declaresParent =
			/^>\s.*(上位|依据)/m.test(head) ||
			/^>\s.*[：:]\s*[`「]?(?:\.\.\/)*[^\s`」]*\d{2}-[^`」\s]*\.md/m.test(head) ||
			/^>\s.*(规范|基线|设计语言)[：:]/m.test(head);
		if (!declaresScope || !declaresParent) {
			missing.push({ file: f, declaresScope, declaresParent });
		}
	}
	assert.deepEqual(
		missing,
		[],
		`以下文档首部缺少范围或上位声明：${JSON.stringify(missing)}。\nspecs/07 §5.5 要求每份文档首部声明自己的范围与上位依据，使读者无需外部索引即可判断它管什么、受谁约束。`,
	);
});
