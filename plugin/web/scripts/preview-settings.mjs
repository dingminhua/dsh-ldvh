import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const clientArg = process.argv.indexOf('--client');
if (clientArg !== -1 && !process.argv[clientArg + 1]) {
	console.error('--client 需要一个 client.js 的路径');
	process.exit(1);
}
const clientPath = clientArg === -1 ? join(here, '../../lib/client.js') : process.argv[clientArg + 1];
const outHtml = join(here, '../preview-settings.html');
const outPng = join(here, '../preview-settings.png');

const source = await readFile(clientPath, 'utf8');


function makeReact() {
	const frames = [];
	const React = {
		createElement(type, props) {
			const children = [];
			for (let index = 2; index < arguments.length; index += 1) children.push(arguments[index]);
			const merged = Object.assign({}, props || {});
			if (children.length === 1) merged.children = children[0];
			else if (children.length > 1) merged.children = children;
			return { type, props: merged, __element: true };
		},
		useState(initial) {
			const frame = frames[frames.length - 1];
			const index = frame.index;
			frame.index += 1;
			if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial;
			return [frame.slots[index], (next) => { frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next; }];
		},
		useEffect(fn) { if (React.__effectsEnabled && typeof fn === 'function') fn(); },
		useRef(value) {
			const frame = frames[frames.length - 1];
			const index = frame.index;
			frame.index += 1;
			if (!(index in frame.slots)) frame.slots[index] = { current: value };
			return frame.slots[index];
		},
		__frames: frames,
		__instances: new Map(),
		__effectsEnabled: true,
	};
	return React;
}

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function styleToString(style) {
	return Object.entries(style || {})
		.map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${value}`)
		.join(';');
}

function renderAttrs(props) {
	const out = [];
	for (const [key, value] of Object.entries(props)) {
		if (key === 'children' || key === 'key' || key === 'ref') continue;
		if (value === undefined || value === null || value === false) continue;
		if (key === 'className') out.push(`class="${escapeHtml(value)}"`);
		else if (key === 'htmlFor') out.push(`for="${escapeHtml(value)}"`);
		else if (key === 'style') out.push(`style="${escapeHtml(styleToString(value))}"`);
		else if (key === 'checked' || key === 'selected') out.push(key);
		else if (key === 'disabled') out.push('disabled');
		else if (typeof value === 'boolean') { if (value) out.push(key); }
		else out.push(`${key}="${escapeHtml(value)}"`);
	}
	return out.join(' ');
}

function renderToHtml(node, React) {
	if (node === null || node === undefined || node === false || node === true) return '';
	if (Array.isArray(node)) return node.map((child) => renderToHtml(child, React)).join('');
	if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
	if (!node.__element) return '';
	if (typeof node.type === 'function') {
		let frame = React.__instances.get(node.type);
		if (!frame) {
			frame = { index: 0, slots: {} };
			React.__instances.set(node.type, frame);
		}
		frame.index = 0;
		React.__frames.push(frame);
		try {
			return renderToHtml(node.type(node.props || {}), React);
		} finally {
			React.__frames.pop();
		}
	}
	const children = renderToHtml(node.props.children);
	const attrs = renderAttrs(node.props || {});
	const tag = node.type;
	if (children === '' && (tag === 'input' || tag === 'img' || tag === 'br')) return `<${tag} ${attrs}>`;
	return `<${tag} ${attrs}>${children}</${tag}>`;
}


const previewOff = process.argv.includes('--off');

const CONFIG = {
	webEnabled: !previewOff,
	showInConversationTab: true,
	showInSidebarTab: true,
	idleAssistEnabled: !previewOff,
	idleCaptureEnabled: true,
	auxReviewEnabled: true,
	idleSilenceMs: 300000,
	injectionBudgetTier: 10,
	preActionReviewAskEnabled: true,
	postWorkReviewAskEnabled: true,
	reviewAskSilentRunEnabled: true,
};

const PROJECTS = {
	ok: true,
	value: {
		projects: [{
			id: 'dsh-ldvh',
			name: 'dsh-ldvh',
			path: '/Users/dmh2002/DshProject/dsh-ldvh',
			color: 'emerald',
			status: { factSource: { state: 'ready' }, hook: { state: 'managed' } },
		}],
	},
};

async function renderSection() {
	const React = makeReact();
	React.__effectsEnabled = true;
	const registered = [];
	const dictionaries = {};
	const scope = {
		getSnapshot() { return { status: 'ready', value: CONFIG, revision: 1, writable: true }; },
		subscribe() { return () => {}; },
		mutate() { return Promise.resolve(true); },
	};
	const forms = {
		describe() { return { getSnapshot() { return { view: { namespaces: [{ ns: 'include:dsh-ldvh' }] } }; } }; },
		get() { return scope; },
	};
	const slots = {
		inject(name, callback) { return callback(); },
		register(definition, component) { registered.push({ definition, component }); return () => {}; },
	};
	const ctx = {
		inject(names, callback) {
			if (names.includes('configForms')) callback({ configForms: forms, slots, effect(fn) { fn(); } });
			return () => {};
		},
		effect(fn) { fn(); },
		get() { return undefined; },
		locale: {
			register(namespace, dictionary) { dictionaries[namespace] = dictionary; return () => {}; },
			bind(namespace) {
				const dictionary = dictionaries[namespace] || { zh: {}, en: {} };
				return (key) => (dictionary.zh[key] === undefined ? key : dictionary.zh[key]);
			},
		},
		slots,
	};
	let plugin = null;
	const context = {
		window: {
			__ModuleLoader__: {
				load(definition) {
					plugin = definition.factory((id) => {
						if (id === 'react') return React;
						if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Toast() { return null; } };
						throw new Error(`unexpected require: ${id}`);
					});
				},
			},
		},
		document: undefined,
		fetch(url) {
			const text = url.includes('/governed-projects/with-colors')
				? JSON.stringify(PROJECTS)
				: JSON.stringify({ ok: true, service: 'dsh-ldvh', status: 'ok', webPort: 3299 });
			return Promise.resolve({ ok: true, text: () => Promise.resolve(text), json: () => Promise.resolve(JSON.parse(text)) });
		},
		console,
		encodeURIComponent,
		setTimeout,
		clearTimeout,
	};
	vm.runInNewContext(source, context, { filename: 'client.js' });
	plugin.apply(ctx);
	const entry = registered.find((item) => item.definition.name === 'settings.section');
	if (!entry) throw new Error('settings.section 未注册');
	const props = entry.definition.inject({});
	const first = renderToHtml({ type: entry.component, props, __element: true }, React);
	await new Promise((resolve) => setTimeout(resolve, 30));
	React.__effectsEnabled = false;
	const second = renderToHtml({ type: entry.component, props, __element: true }, React);
	void first;
	return second;
}

function settingsCss() {
	const marker = 'var SETTINGS_CSS =';
	const start = source.indexOf(marker);
	if (start < 0) throw new Error(`client 源里找不到 ${marker}（CSS 语句的写法变了？）`);
	const body = start + marker.length;
	let quote = null;
	let escaped = false;
	for (let i = body; i < source.length; i += 1) {
		const ch = source[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			escaped = true;
			continue;
		}
		if (quote !== null) {
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			quote = ch;
			continue;
		}
		if (ch === ';') return vm.runInNewContext(`(${source.slice(body, i)})`);
	}
	throw new Error('client 源里找不到 SETTINGS_CSS 语句的结尾分号');
}


const DARK_TOKENS = `
:root{
  --dsw-alias-bg-base:#151517;
  --dsw-alias-bg-layer-1:#232324;
  --dsw-alias-bg-layer-2:#2c2c2e;
  --dsw-alias-bg-layer-3:#353638;
  --dsw-alias-bg-module-platform:#353638;
  --dsw-alias-bg-overlay:#61666b;
  --dsw-alias-bg-mask-1:#00000080;
  --dsw-alias-border-l1:#ffffff0f;
  --dsw-alias-border-l2:#ffffff1f;
  --dsw-alias-border-l3:#ffffff29;
  --dsw-alias-border-l4:#ffffff33;
  --dsw-alias-label-primary:#f9fafb;
  --dsw-alias-label-secondary:#cfd3d6;
  --dsw-alias-label-tertiary:#adb2b8;
  --dsw-alias-label-dimmed:#43454a;
  --dsw-alias-label-primary-foreground:#0f1115;
  --dsw-alias-brand-primary:#f9fafb;
  --dsw-alias-brand-primary-new-colorprimary-new-color:#5686fe;
  --dsw-alias-state-business-primary:#7aaaff;
  --dsw-alias-state-success-primary:#22c55e;
  --dsw-alias-state-error-primary:#f25a5a;
  --dsw-alias-switch-thumb:#adb2b8;
  --dsw-alias-label-on-color:#ffffff;
  --dsw-specific-sidebar-nav-item-active:#43454a;
  --dsw-radius-xs:4px;
  --dsw-radius-sm:8px;
  --dsw-radius-md:12px;
  --dsw-radius-lg:16px;
  --dsw-radius-xl:20px;
  --dsw-radius-panel:28px;
}`;

const LIGHT_TOKENS = `
:root{
  --dsw-alias-bg-base:#ffffff;
  --dsw-alias-bg-layer-1:#ffffff;
  --dsw-alias-bg-layer-2:#ffffff;
  --dsw-alias-bg-layer-3:#ffffff;
  --dsw-alias-bg-module-platform:#f5f6f7;
  --dsw-alias-bg-overlay:#e9ecf2;
  --dsw-alias-bg-mask-1:#0000003d;
  --dsw-alias-border-l1:#0000000a;
  --dsw-alias-border-l2:#0000001a;
  --dsw-alias-border-l3:#0000001f;
  --dsw-alias-border-l4:#00000029;
  --dsw-alias-label-primary:#0f1115;
  --dsw-alias-label-secondary:#61666b;
  --dsw-alias-label-tertiary:#81858c;
  --dsw-alias-label-dimmed:#e1e5ee;
  --dsw-alias-label-primary-foreground:#ffffff;
  --dsw-alias-brand-primary:#0f1115;
  --dsw-alias-brand-primary-new-colorprimary-new-color:#4176e6;
  --dsw-alias-state-business-primary:#4176e6;
  --dsw-alias-state-success-primary:#22c55e;
  --dsw-alias-state-error-primary:#ec1313;
  --dsw-alias-switch-thumb:#ffffff;
  --dsw-alias-label-on-color:#ffffff;
  --dsw-specific-sidebar-nav-item-active:#ebeef2;
  --dsw-radius-xs:4px;
  --dsw-radius-sm:8px;
  --dsw-radius-md:12px;
  --dsw-radius-lg:16px;
  --dsw-radius-xl:20px;
  --dsw-radius-panel:28px;
}`;

const HOST_SHELL_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%}
body{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  font-size:14px;line-height:22px;-webkit-font-smoothing:antialiased}
.overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center}
.mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1)}
.panel{position:relative;z-index:1;display:grid;grid-template-columns:188px minmax(0,1fr);
  grid-template-rows:auto minmax(0,1fr);grid-template-areas:'title header' 'nav options';
  width:800px;height:min(800px,calc(100vh - 48px));max-width:calc(100vw - 48px);
  border-radius:var(--dsw-radius-panel);overflow:hidden;background:var(--dsw-alias-bg-layer-2);
  box-shadow:0 12px 32px rgba(0,0,0,.45)}
.navTitle{grid-area:title;padding:22px 12px 8px 24px;font-size:16px;line-height:24px;font-weight:500}
.nav{grid-area:nav;min-width:0;min-height:0;display:flex;flex-direction:column;padding:10px 12px 0}
.navList{display:flex;flex-direction:column;gap:4px;min-height:0;overflow-y:auto}
.navCell{display:flex;align-items:center;gap:8px;height:40px;padding:9px 16px 9px 12px;border:none;
  border-radius:var(--dsw-radius-md);background:transparent;font-family:inherit;font-size:14px;line-height:22px;text-align:left}
.navCell.active{background:var(--dsw-specific-sidebar-nav-item-active)}
.navIcon{width:16px;height:16px;flex:none;border-radius:4px;background:#3d4a63}
.navLabel{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.header{grid-area:header;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;height:54px;padding:20px 14px 8px 10px}
.close{flex:none;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;font-size:14px}
.options{grid-area:options;min-width:0;min-height:0;padding:0 24px 24px;overflow-y:auto}
`;

const themeArg = process.argv.indexOf('--theme');
const theme = themeArg === -1 ? 'dark' : process.argv[themeArg + 1];
if (theme !== 'dark' && theme !== 'light') {
	console.error(`--theme 只接受 dark | light，收到：${theme}`);
	process.exit(1);
}
const tokens = theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS;

const widthArg = process.argv.indexOf('--width');
const columnWidth = widthArg === -1 ? null : Number(process.argv[widthArg + 1]);
const narrowCss = columnWidth
	? `.panel{grid-template-columns:0 minmax(0,1fr)!important;width:${columnWidth + 32}px!important}`
		+ `.nav{display:none!important}.options{padding:0 16px 24px!important}`
	: '';

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>LDVH 设置页预览</title>
<style>${tokens}</style>
<style>${HOST_SHELL_CSS}</style>
<style>${narrowCss}</style>
<style>${settingsCss()}</style>
</head><body>
<div class="overlay"><div class="mask"></div>
<div class="panel">
  <div class="navTitle">设置</div>
  <nav class="nav"><div class="navList">
    <button class="navCell"><span class="navIcon"></span><span class="navLabel">账号</span></button>
    <button class="navCell"><span class="navIcon"></span><span class="navLabel">通用</span></button>
    <button class="navCell"><span class="navIcon"></span><span class="navLabel">模型</span></button>
    <button class="navCell"><span class="navIcon"></span><span class="navLabel">插件</span></button>
    <button class="navCell active"><span class="navIcon"></span><span class="navLabel">LDVH</span></button>
  </div></nav>
  <div class="header"><button class="close">✕</button></div>
  <div class="options">${await renderSection()}</div>
</div></div>
</body></html>`;

await mkdir(dirname(outHtml), { recursive: true });
await writeFile(outHtml, page, 'utf8');
console.log('written:', outHtml);

if (process.argv.includes('--shot')) {
	const { chromium } = await import('playwright');
	const browser = await chromium.launch();
	const pageInstance = await browser.newPage({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 2 });
	await pageInstance.goto(`file://${outHtml}`);
	const fold = process.argv.includes('--fold');
	if (!fold) {
		await pageInstance.addStyleTag({ content: '.panel{height:auto!important;max-height:none!important}.options{overflow:visible!important}.mask{display:none}' });
	}
	await pageInstance.waitForTimeout(200);
	const suffix = `${theme === 'light' ? '-light' : ''}${columnWidth ? `-w${columnWidth}` : ''}${fold ? '-fold' : ''}`;
	if (fold) {
		const panel = await pageInstance.$('.panel');
		await panel.screenshot({ path: outPng.replace(/\.png$/, `${suffix}.png`) });
	} else {
		const options = await pageInstance.$('.options');
		await options.screenshot({ path: outPng.replace(/\.png$/, `${suffix}.png`) });
	}
	const foldHeight = await pageInstance.$eval('.options', (el) => el.clientHeight);
	const totalHeight = await pageInstance.$eval('.ldv-settings', (el) => el.scrollHeight);
	console.log(`options 视口高 ${foldHeight}px / 内容总高 ${totalHeight}px`);
	await browser.close();
	console.log('written:', outPng);
}
