
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsDir = join(__dirname, '..', '..', 'docs');

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
