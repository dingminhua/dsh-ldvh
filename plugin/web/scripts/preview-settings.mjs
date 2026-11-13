/**
 * 设置页版面预览器：在本地把 LDVH 设置页**渲染出来并截图**，不启动宿主。
 *
 * ## 为什么需要它
 *
 * 设置页的正文列很窄（宿主 800px 面板 − 188px 导航 − 2×24px 内衬 ⇒ 约
 * 564px），版面是否成立**看图才知道**：行会不会挤、说明会不会撞控件、窄列
 * 降级会不会散架，靠读 CSS 读不出来。而改一次样式就要重启/刷新宿主，慢且
 * 难对比。
 *
 * 本工具的取值口径（**都来自真实来源，不另抄一份**）：
 *   - **组件**：直接执行 `plugin/lib/client.js` 里的 `LdvhSettingsRow`
 *     （最小 React 替身 + 宿主服务替身），渲染的就是宿主会渲染的那一份；
 *   - **样式**：`SETTINGS_CSS` 字面量求值后的**实际下发文本**（不是源码片段）；
 *   - **几何与配色**：宿主设置面板外壳（800px 面板 / 188px 导航 / 24px 内衬）
 *     与暗色 token，取自宿主包
 *     `dsh-client-ui-settings-general/src/client/SettingsRoot.module.css`
 *     与 `dsh-client-ui-theme` 的 token 表。
 *
 * 用法：
 *   node scripts/preview-settings.mjs            # 写 preview-settings.html
 *   node scripts/preview-settings.mjs --shot     # 另出一张 PNG（需 playwright）
 *   node scripts/preview-settings.mjs --shot --width 388   # 窄列（内容列 388px）
 *   node scripts/preview-settings.mjs --shot --theme light  # 亮色主题
 *   node scripts/preview-settings.mjs --fold              # 按宿主真实首屏高度出图
 *   node scripts/preview-settings.mjs --client /tmp/old.js # 渲染另一份 client.js
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const clientArg = process.argv.indexOf('--client');
// --client 指向另一份 client.js：预览器只读**当前**源码，故想看别的版本得指路。
// 注意：被渲染的那份必须**注册 settings.section**——更早的版本（本插件设置面
// 还在 Plugins 页卡片里时）注册的是 plugins.bundle.config，渲染会直接报
// 「settings.section 未注册」。例：
//   node scripts/preview-settings.mjs --shot --client /path/to/other-client.js
if (clientArg !== -1 && !process.argv[clientArg + 1]) {
	console.error('--client 需要一个 client.js 的路径');
	process.exit(1);
}
const clientPath = clientArg === -1 ? join(here, '../../lib/client.js') : process.argv[clientArg + 1];
const outHtml = join(here, '../preview-settings.html');
const outPng = join(here, '../preview-settings.png');

const source = await readFile(clientPath, 'utf8');

// ── 最小 React 替身：把组件渲染成可序列化的树 ──────────────────────────────
//
// 只求「结构」与「文字」，不求交互：hooks 各给一个槽位，函数组件就地执行。

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
		// 第二帧把副作用关掉：它只用来把第一帧发起的异步结果读回来。
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
		// 同一个组件**实例**的 state 必须跨帧留存——否则第二帧拿到的仍是初值
		//（项目列表停在「正在读取…」、状态停在「检测中…」）。按组件身份
		// 复用槽位，等价于 React 的「同实例同 state」。
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

// ── 宿主替身：配置表单、槽位、词条 ─────────────────────────────────────────

// --off：把两个**已从设置面撤除**的持久开关渲染成 false，用来看禁用态与
// 「去哪儿改回来」的出口说明（2026-11-13 第十三轮：总开关撤除后，只剩存量
// 配置会走到这个分支，日常预览看不到，故留一个开关专门照它）。
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
	// 静默执行（2026-11-13 晚）：预览里保持**打开**，使琥珀轨与「静默」药丸
	// 每次都出现在版面上——一个只在特定取值下才出现的控件最容易在改版时坏掉。
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
	// 第一帧：跑副作用（探活、拉项目列表）。
	const first = renderToHtml({ type: entry.component, props, __element: true }, React);
	// 等一拍让 Promise 落地，再渲染第二帧——此时 state 里已是 resolve 后的值
	//（项目列表、Web 呈现状态）。只截第一帧的话，看到的永远是「检测中…」
	// 与「正在读取管辖项目…」。
	await new Promise((resolve) => setTimeout(resolve, 30));
	React.__effectsEnabled = false;
	const second = renderToHtml({ type: entry.component, props, __element: true }, React);
	void first;
	return second;
}

/** 求值 SETTINGS_CSS 字面量——得到**实际下发**的样式文本。 */
function settingsCss() {
	const start = source.indexOf('var SETTINGS_CSS = ');
	const body = start + 'var SETTINGS_CSS = '.length;
	const end = source.indexOf(';\n', body);
	return vm.runInNewContext(`(${source.slice(body, end)})`);
}

// ── 宿主外壳：几何与暗色 token ─────────────────────────────────────────────

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

// 两套 token 的**真值**取自宿主 dsh-client-ui-theme 的
// src/styles/design-platform.css（浅色 alias 块 / body[data-ds-dark-theme] 块），
// 由 scripts/read-host-tokens.mjs 解析进 fixtures/host-theme-tokens.json，
// 并有守卫测试（plugin/test/client-preview-tokens.test.mjs）逐 token 比对本表——
// 宿主改 token 而本表没跟随时，测试即红。
//
// 注意两处容易记错的真值：
//   浅色 brand-primary = #0f1115（**近黑**，不是蓝！）——宿主浅色主题的品牌色
//   是中性色；蓝色是 --dsw-alias-brand-primary-new-colorprimary-new-color
//   （另一条实验中的 token）与 state-business-primary（#4176e6）。
//   故浅色下的开关是「黑轨 + 白钮」，与宿主自己的开关同形。
// 对比度实测（白底）：primary 18.9:1 / secondary 5.8:1 / tertiary 3.7:1。
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

// --width：把内容列压到指定宽度（默认走宿主桌面几何：内容列 564px）。
// 窄列是**宿主自己会遇到的**情形（macOS/Windows 原生标题栏下宿主仍保留
// 188px 导航列，内容列可窄到一百多像素），故值得单独出一张图。
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
	// 默认：面板自身滚动，故把外壳拉高到内容全展开再截「内容列」。
	// --fold：**不拉高**，按宿主的真实面板高度截——首屏能看见什么，是设置页
	// 能不能被扫读的第一道判据（整页长图看不见折线在哪）。
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
	// 首屏可见高度（宿主 .options 的可视高）：供「最重要的项是否落在首屏」判断。
	const foldHeight = await pageInstance.$eval('.options', (el) => el.clientHeight);
	const totalHeight = await pageInstance.$eval('.ldv-settings', (el) => el.scrollHeight);
	console.log(`options 视口高 ${foldHeight}px / 内容总高 ${totalHeight}px`);
	await browser.close();
	console.log('written:', outPng);
}
