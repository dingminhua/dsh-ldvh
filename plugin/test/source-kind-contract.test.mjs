import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

/**
 * 消息 source kind 契约：DSH 0.1.7 退役了共享的 `kind: "plugin"` 包装。
 *
 * v3→v4 迁移的「原生 source 准入」**显式拒绝这个字面量**
 * （`session-format-v3-to-v4/src/message-sources.ts`：
 * `value['kind'] === 'plugin'` → `SessionFormatError: format v4 message requires
 * a producer-owned source kind`）。写入了该 kind 的行会让整个会话的 v4 迁移/写入
 * 抛错（2026-09-25 真机日志：会话 turn 失败 + 投影缓存写失败）。
 *
 * 0.1.7 的契约是「每个生产者在自己模块里声明自己的 kind」；未知 kind 的归属由
 * v4 原样保留。本文件即守卫：lib 下的消息写入端不得再使用退役的 `"plugin"` 包装
 * （读取端对历史行的兼容判断不在此列——见 guidance.js isOwnMessage）。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

test("no lib module writes the retired shared plugin-kind as a message source", async () => {
	const dir = new URL("../lib/", import.meta.url);
	const files = (await readdir(dir)).filter((name) => name.endsWith(".js") && !name.endsWith(".d.ts"));
	assert.ok(files.length > 0, "expected lib modules");
	for (const file of files) {
		const code = stripComments(await readFile(new URL(file, dir), "utf8"));
		assert.ok(
			!/kind:\s*["']plugin["']/.test(code),
			`${file} still writes the retired \`kind: "plugin"\` message source — use the plugin's own producer kind`,
		);
	}
});

test("guidance.js writes the plugin's own producer kind and reads both old and new", async () => {
	const source = await readFile(new URL("../lib/guidance.js", import.meta.url), "utf8");
	assert.ok(source.includes("kind: LDVH_PLUGIN_SOURCE"), "writer uses the plugin's own producer kind");
	// 读取端对历史 "plugin" 包装行保持兼容（旧会话里可能残留 v3 行）。
	assert.ok(/source\?\.plugin === LDVH_PLUGIN_SOURCE/.test(source), "ownership is keyed by plugin id");
	assert.ok(/source\?\.kind === LDVH_PLUGIN_SOURCE \|\| source\?\.kind === "plugin"/.test(source), "reader accepts the legacy plugin wrapper");
});