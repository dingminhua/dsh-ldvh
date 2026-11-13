#!/usr/bin/env node
/**
 * 从**宿主**的主题样式里解析出浅色/暗色两套 token 的真值，写进
 * plugin/web/fixtures/host-theme-tokens.json。
 *
 * 为什么要它：预览器（preview-settings.mjs）自带一套 token 表——那份是**副本**，
 * 宿主改 token 时它不会自己跟���，于是「浅色出图 = 真实观感」这个前提会悄悄
 * 失效（2026-11-13 独立复核就抓到一次：预览写 brand-primary=#4176e6（蓝），
 * 而宿主浅色真值是 #0f1115（近黑）——出图里的开关是蓝轨，真实宿主是黑轨）。
 *
 * 宿主真值来源：dsh-client-ui-theme/src/styles/design-platform.css
 *   - 第一个 body{} 块：静态色板 --dsw-static-*
 *   - 第二个 body{} 块：浅色 alias --dsw-alias-* → var(--dsw-static-*)
 *   - body[data-ds-dark-theme]{} 块：暗色 alias
 *
 * 用法：
 *   node scripts/read-host-tokens.mjs                 # 用默认的宿主 app.asar
 *   node scripts/read-host-tokens.mjs --asar <路径>     # 指定别的 asar
 *   node scripts/read-host-tokens.mjs --check          # 只比对，不写盘（有差异则退出码 1）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '../fixtures/host-theme-tokens.json');

const DEFAULT_ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const THEME_CSS = 'dsh-client-ui-theme/src/styles/design-platform.css';

/** 读 asar 里的一个文件（asar = 头部 JSON + 顺序拼接的文件内容）。
 *
 * 头部结构：8 字节前缀（4 / headerPickleSize），随后是一个嵌套 pickle
 * ——再 4 字节长度前缀、再 4 字节 JSON 长度、然后是 JSON；文件内容从
 * 8 + headerPickleSize 处开始按 offset 排布。
 */
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
		// 按路径后缀找文件（宿主包里的前缀随打包结构变，如 dsh/node_modules/@deepseek-ai/…）。
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

/** 把样式表切成三个块：静态色板 / 浅色 alias / 暗色 alias。 */
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

/** 解析 var(--x) 链，直到落到具体颜色。 */
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
	// 「色上文字色」：白钮要用的就是它——两套主题都是纯白（bluish-00），
	// 而 label-primary-foreground 在暗色下是近黑，不能拿来当钮。
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
