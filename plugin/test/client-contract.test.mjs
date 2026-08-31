import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

test("matches the WorkBuddy plugin-card shell contract", () => {
	for (const fragment of [
		'.ldv-settings-card{border:1px solid',
		'.ldv-settings-card-open{',
		'.ldv-settings-card-header{appearance:none',
		'padding:14px 16px',
		'.ldv-settings-card-icon{width:32px;height:32px',
		'.ldv-settings-card-body{border-top:1px solid',
		'priority: 30',
	]) assert.ok(source.includes(fragment), `missing WorkBuddy card fragment: ${fragment}`);
});

test("uses the WorkBuddy client registration and degradation pattern", () => {
	assert.ok(source.includes('var inject = ["slots", "locale", "settingsScope"]'));
	assert.ok(source.includes('ctx.effect(function ()'));
	assert.ok(source.includes('ctx.locale.register(LDVH_NS, { zh: LDVH_ZH, en: LDVH_EN })'));
	assert.ok(source.includes('ctx.locale.bind(LDVH_NS)'));
	assert.ok(source.includes('ctx.slots.inject("settings.plugin.item"'));
	assert.ok(source.includes('key: "dsh-ldvh"'));
	assert.ok(source.includes('console.error("[dsh-ldvh] client UI failed to load'));
	assert.ok(!source.includes('"connection"]'), "settings card must not inject unused connection service");
});

test("uses the real package icon and the official chevron primitive", () => {
	assert.ok(source.includes('data:image/png;base64,'));
	assert.ok(source.includes('primitives.IconChevronDownOutline14'));
	assert.ok(source.includes('React.createElement(IconChevronDownOutline14, { size: 14 })'));
});

test("provides accessible expand and collapse labels", () => {
	assert.ok(source.includes('"row.expand": "展开"'));
	assert.ok(source.includes('"row.collapse": "收起"'));
	assert.ok(source.includes('"row.expand": "Expand"'));
	assert.ok(source.includes('"row.collapse": "Collapse"'));
	assert.ok(source.includes('"aria-label": t(openState[0] ? "row.collapse" : "row.expand") + ": " + title'));
});
