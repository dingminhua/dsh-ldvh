// 预览器的 token 表必须与**宿主真值**一致。
//
// 2026-11-13 独立复核抓到一次真实的失真：预览器自带的浅色 token 表把
// `--dsw-alias-brand-primary` 写成 #4176e6（蓝），而宿主浅色主题的真值是
// #0f1115（近黑）——出图里的开关是蓝轨，真实宿主里是黑轨，「浅色出图 = 真实
// 观感」这个前提被悄悄换掉了。
//
// 故：真值由 plugin/web/scripts/read-host-tokens.mjs 从宿主包里解析进
// plugin/web/fixtures/host-theme-tokens.json，本测试逐 token 比对预览器与该快照；
// 宿主换版本时重跑那个脚本，快照与预览器的差异即由本测试暴露。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const previewSource = fs.readFileSync(path.join(here, '../web/scripts/preview-settings.mjs'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(here, '../web/fixtures/host-theme-tokens.json'), 'utf8'));

/** 把颜色写法归一：#abc / #aabbcc / #aabbccdd / rgb() / rgba() → 小写 6 或 8 位 hex。 */
function normalize(color) {
	const text = String(color).trim().toLowerCase();
	const hex = text.match(/^#([0-9a-f]{3,8})$/);
	if (hex) {
		let value = hex[1];
		if (value.length === 3) value = value.split('').map((c) => c + c).join('');
		if (value.length === 4) value = value.split('').map((c) => c + c).join('');
		return value.length === 6 ? value : value.slice(0, 6) + value.slice(6);
	}
	const rgb = text.match(/^rgba?\(([^)]+)\)$/);
	if (rgb) {
		const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
		const [r, g, b] = parts;
		const hex6 = [r, g, b].map((part) => Math.round(part).toString(16).padStart(2, '0')).join('');
		if (parts.length < 4) return hex6;
		return hex6 + Math.round(parts[3] * 255).toString(16).padStart(2, '0');
	}
	return text;
}

/** 从预览器源码里取出某套 token 表（形如 `--x:#fff`）。 */
function tableOf(source, name) {
	const start = source.indexOf(`const ${name} = \``);
	assert.notEqual(start, -1, `预览器里找不到 ${name}`);
	const end = source.indexOf('`;', start);
	const body = source.slice(start, end);
	const out = new Map();
	for (const match of body.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
		out.set(match[1], normalize(match[2]));
	}
	return out;
}

test("预览器的 token 表与宿主真值快照逐项一致", () => {
	for (const [tableName, fixtureKey] of [['LIGHT_TOKENS', 'light'], ['DARK_TOKENS', 'dark']]) {
		const table = tableOf(previewSource, tableName);
		const truth = fixture[fixtureKey];
		for (const [token, value] of Object.entries(truth)) {
			// 半径等本表自定义项不在宿主快照里——只比宿主给定的那些。
			assert.ok(table.has(token), `${tableName} 缺少宿主 token ${token}`);
			assert.equal(table.get(token), normalize(value), `${tableName} 的 ${token} 与宿主真值不符`);
		}
	}
});

test("快照本身标注了出处（不是无主的数字）", () => {
	assert.match(fixture.source, /design-platform\.css/);
	assert.ok(fixture.resolvedFrom && fixture.resolvedFrom.length > 0);
	// 两套主题的关键值不得相同——若解析器退化成只读一块，两套会一模一样。
	assert.notEqual(fixture.light['--dsw-alias-brand-primary'], fixture.dark['--dsw-alias-brand-primary']);
});
