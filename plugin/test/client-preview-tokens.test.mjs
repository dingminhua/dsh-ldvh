import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const previewSource = fs.readFileSync(path.join(here, '../web/scripts/preview-settings.mjs'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(here, '../web/fixtures/host-theme-tokens.json'), 'utf8'));

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
			assert.ok(table.has(token), `${tableName} 缺少宿主 token ${token}`);
			assert.equal(table.get(token), normalize(value), `${tableName} 的 ${token} 与宿主真值不符`);
		}
	}
});

test("快照本身标注了出处（不是无主的数字）", () => {
	assert.match(fixture.source, /design-platform\.css/);
	assert.ok(fixture.resolvedFrom && fixture.resolvedFrom.length > 0);
	assert.notEqual(fixture.light['--dsw-alias-brand-primary'], fixture.dark['--dsw-alias-brand-primary']);
});

test("预览器取 SETTINGS_CSS 时不依赖行内写法（改版后会崩）", () => {
	assert.ok(!previewSource.includes("'var SETTINGS_CSS = '"), "不得再用带空格的旧标记：client.js 的 CSS 语句改成换行写法后它会 indexOf 返 -1 而崩");
	assert.ok(previewSource.includes("'var SETTINGS_CSS ='"), "须用不带空格的标记");
	assert.ok(previewSource.includes("if (ch === ';')"), "须按字符串感知的方式扫描语句结尾分号，不得用首个 ';' 定位");
});
