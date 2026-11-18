#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '../fixtures/host-theme-tokens.json');

const DEFAULT_ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const THEME_CSS = 'dsh-client-ui-theme/src/styles/design-platform.css';

function readAsarFile(asarPath, target) {
	const fd = fs.openSync(asarPath, 'r');
	try {
		const sizeBuf = Buffer.alloc(8);
		fs.readSync(fd, sizeBuf, 0, 8, 0);
		const headerSize = sizeBuf.readUInt32LE(4);
		const headerBuf = Buffer.alloc(headerSize);
		fs.readSync(fd, headerBuf, 0, headerSize, 8);
		const headerStringSize = headerBuf.readUInt32LE(4);
		const header = JSON.parse(headerBuf.slice(8, 8 + headerStringSize).toString('utf8'));
		const base = 8 + headerSize;
		let hit = null;
		const walk = (filesMap, prefix) => {
			if (hit || !filesMap) return;
			for (const [name, child] of Object.entries(filesMap)) {
				if (hit) return;
				const full = prefix.concat(name);
				if (child.files) {
					walk(child.files, full);
				} else if (full.join('/').endsWith(target)) {
					hit = child;
				}
			}
		};
		walk(header.files, []);
		if (!hit || hit.size === undefined) return null;
		const buf = Buffer.alloc(hit.size);
		fs.readSync(fd, buf, 0, hit.size, base + Number(hit.offset));
		return buf.toString('utf8');
	} finally {
		fs.closeSync(fd);
	}
}

function splitBlocks(css) {
	const staticTokens = {};
	const light = {};
	const dark = {};
	const blockRe = /(?:^|\n)\s*(body|body\[data-ds-dark-theme\])\s*\{([^}]*)\}/g;
	let match;
	while ((match = blockRe.exec(css)) !== null) {
		const [, selector, body] = match;
		for (const [, name, value] of body.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
			if (name.startsWith('--dsw-static-')) {
				if (staticTokens[name] === undefined) staticTokens[name] = value.trim();
			} else if (selector === 'body') {
				if (light[name] === undefined) light[name] = value.trim();
			} else if (dark[name] === undefined) {
				dark[name] = value.trim();
			}
		}
	}
	return { staticTokens, light, dark };
}

function resolve(value, tables, depth = 0) {
	const trimmed = String(value).trim();
	const match = trimmed.match(/^var\(\s*(--dsw-[a-z0-9-]+)\s*\)$/);
	if (!match || depth > 8) return trimmed;
	const ref = match[1];
	for (const table of [tables.staticTokens, tables.light, tables.dark]) {
		if (table[ref] !== undefined) return resolve(table[ref], tables, depth + 1);
	}
	return trimmed;
}

function normalize(color) {
	const text = String(color).trim();
	const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i);
	if (rgb) {
		const [, r, g, b, a] = rgb;
		const hex = '#' + [r, g, b].map((part) => Number(part).toString(16).padStart(2, '0')).join('');
		return a === undefined ? hex : `${hex}${Math.round(Number(a) * 255).toString(16).padStart(2, '0')}`;
	}
	return text;
}

const WANT = [
	'--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
	'--dsw-alias-bg-module-platform', '--dsw-alias-bg-overlay', '--dsw-alias-bg-mask-1',
	'--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4',
	'--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
	'--dsw-alias-label-dimmed', '--dsw-alias-label-primary-foreground',
	'--dsw-alias-brand-primary', '--dsw-alias-brand-primary-new-colorprimary-new-color',
	'--dsw-alias-state-business-primary', '--dsw-alias-state-success-primary',
	'--dsw-alias-state-error-primary', '--dsw-alias-switch-thumb',
	'--dsw-alias-label-on-color',
	'--dsw-specific-sidebar-nav-item-active'
];

const args = process.argv.slice(2);
const asarPath = args.includes('--asar') ? args[args.indexOf('--asar') + 1] : DEFAULT_ASAR;
const checkOnly = args.includes('--check');

if (!fs.existsSync(asarPath)) {
	console.error(`找不到宿主包：${asarPath}`);
	console.error('（宿主不在本机时无法刷新真值——沿用仓库里的 fixtures 即可。）');
	process.exit(2);
}

const css = readAsarFile(asarPath, THEME_CSS);
if (!css) {
	console.error(`宿主包里找不到 ${THEME_CSS}`);
	process.exit(2);
}

const tables = splitBlocks(css);
const pick = (source) => {
	const out = {};
	for (const name of WANT) {
		if (source[name] === undefined) continue;
		out[name] = normalize(resolve(source[name], tables));
	}
	return out;
};

const appVersion = (() => {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(asarPath), 'app.asar.unpacked/package.json'), 'utf8'));
		return pkg.version || null;
	} catch {
		return null;
	}
})();

const snapshot = {
	source: `${path.basename(path.dirname(asarPath))}/app.asar → ${THEME_CSS}`,
	resolvedFrom: 'design-platform.css 的静态色板 + 浅色/暗色 alias 块',
	light: pick(tables.light),
	dark: pick(tables.dark)
};

if (checkOnly) {
	const current = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;
	const same = current && JSON.stringify(current.light) === JSON.stringify(snapshot.light)
		&& JSON.stringify(current.dark) === JSON.stringify(snapshot.dark);
	if (same) {
		console.log('fixtures/host-theme-tokens.json 与宿主现值一致');
		process.exit(0);
	}
	console.error('fixtures/host-theme-tokens.json 与宿主现值**不一致**：');
	console.error('  仓库：', current ? JSON.stringify(current.light) : '(缺)');
	console.error('  宿主：', JSON.stringify(snapshot.light));
	process.exit(1);
}

fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
fs.writeFileSync(fixturePath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
console.log('written:', fixturePath);
console.log('  浅色 brand-primary =', snapshot.light['--dsw-alias-brand-primary']);
console.log('  暗色 brand-primary =', snapshot.dark['--dsw-alias-brand-primary']);
