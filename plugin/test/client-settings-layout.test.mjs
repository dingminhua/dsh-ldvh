import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";


const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");


function createReactStub() {
	const hookFrames = [];
	function currentFrame() {
		return hookFrames[hookFrames.length - 1];
	}
	return {
		createElement(type, props) {
			const children = [];
			for (let index = 2; index < arguments.length; index += 1) children.push(arguments[index]);
			const merged = Object.assign({}, props || {});
			if (children.length === 1) merged.children = children[0];
			else if (children.length > 1) merged.children = children;
			return { type, props: merged, __element: true };
		},
		useState(initial) {
			const frame = currentFrame();
			const index = frame.index;
			frame.index += 1;
			if (!(index in frame.slots)) frame.slots[index] = typeof initial === "function" ? initial() : initial;
			return [frame.slots[index], (next) => { frame.slots[index] = typeof next === "function" ? next(frame.slots[index]) : next; }];
		},
		useEffect(fn) {
			if (typeof fn === "function") fn();
		},
		useRef(value) {
			const frame = currentFrame();
			const index = frame.index;
			frame.index += 1;
			if (!(index in frame.slots)) frame.slots[index] = { current: value };
			return frame.slots[index];
		},
		__frames: hookFrames,
	};
}

function toTree(node, React) {
	if (node === null || node === undefined || node === false || node === true) return null;
	if (Array.isArray(node)) return node.map((child) => toTree(child, React)).filter(Boolean);
	if (typeof node === "string" || typeof node === "number") return { text: String(node) };
	if (!node.__element) return null;
	if (typeof node.type === "function") {
		React.__frames.push({ index: 0, slots: {} });
		try {
			return toTree(node.type(node.props || {}), React);
		} finally {
			React.__frames.pop();
		}
	}
	return {
		type: node.type,
		props: node.props || {},
		children: toTree(node.props && node.props.children, React),
	};
}

function walk(node, visit) {
	walkWithParents(node, [], visit);
}

function walkWithParents(node, ancestors, visit) {
	if (!node) return;
	if (Array.isArray(node)) { for (const child of node) walkWithParents(child, ancestors, visit); return; }
	if (node.text !== undefined) return;
	visit(node, ancestors);
	walkWithParents(node.children, ancestors.concat([node]), visit);
}

function classesOf(node) {
	return String((node.props && node.props.className) || "").split(/\s+/).filter(Boolean);
}

function textOf(node) {
	if (!node) return "";
	if (Array.isArray(node)) return node.map((child) => textOf(child)).join("");
	if (node.text !== undefined) return node.text;
	return textOf(node.children);
}

function renderSettingsSection(config) {
	const React = createReactStub();
	const registered = [];
	const scope = {
		getSnapshot() { return { status: "ready", value: config, revision: 1, writable: true }; },
		subscribe() { return function () {}; },
		mutate() { return Promise.resolve(true); },
	};
	const forms = {
		describe() { return { getSnapshot() { return { view: { namespaces: [{ ns: "include:dsh-ldvh" }] } }; } }; },
		get() { return scope; },
	};
	const slots = {
		inject(name, callback) { return callback(); },
		register(definition, component) { registered.push({ definition, component }); return function () {}; },
	};
	const ctx = {
		inject(names, callback) {
			if (names.includes("configForms")) callback({ configForms: forms, slots, effect(fn) { fn(); } });
			return function () {};
		},
		effect(fn) { fn(); },
		get() { return undefined; },
		locale: {
			register(namespace, dictionary) { dictionaries[namespace] = dictionary; return function () {}; },
			bind(namespace) {
				const dictionary = dictionaries[namespace] || { zh: {}, en: {} };
				return (key) => (dictionary.zh[key] === undefined ? key : dictionary.zh[key]);
			},
		},
		slots,
	};
	const dictionaries = {};
	let plugin = null;
	const context = {
		window: {
			__ModuleLoader__: {
				load(definition) {
					plugin = definition.factory((id) => {
						if (id === "react") return React;
						if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Toast() { return null; } };
						throw new Error("unexpected require: " + id);
					});
				},
			},
		},
		document: undefined,
		fetch() { return Promise.reject(new Error("preview: no network")); },
		console: { error() {}, log() {} },
		encodeURIComponent,
		setTimeout,
		clearTimeout,
	};
	vm.runInNewContext(source, context, { filename: "client.js" });
	assert.ok(plugin, "client.js 须导出插件工厂");
	plugin.apply(ctx);
	const entry = registered.find((item) => item.definition.name === "settings.section");
	assert.ok(entry, "settings.section 须已注册");
	return toTree({ type: entry.component, props: entry.definition.inject({}), __element: true }, React);
}

function rowsOf(tree) {
	const rows = [];
	walk(tree, (node) => {
		if (classesOf(node).includes("ldv-row")) rows.push(node);
	});
	return rows;
}

function controlsOf(row) {
	const controls = [];
	walk(row, (node) => {
		if (node.type === "input" || node.type === "select") controls.push(node);
	});
	return controls;
}

function rowTitleOf(row) {
	let title = "";
	walk(row, (node) => {
		if (title === "" && classesOf(node).includes("ldv-row-title")) title = textOf(node);
	});
	return title;
}

function sharedHeadOf(row) {
	let titleNode = null;
	let controlNode = null;
	walkWithParents(row, [], (node, ancestors) => {
		if (!titleNode && classesOf(node).includes("ldv-row-title")) titleNode = { node, ancestors };
		if (!controlNode && (node.type === "input" || node.type === "select")) controlNode = { node, ancestors };
	});
	if (!titleNode || !controlNode) return null;
	for (const ancestor of controlNode.ancestors) {
		if (ancestor === titleNode.node) return null;
		if (ancestor === titleNode.ancestors[titleNode.ancestors.length - 1]) return ancestor;
	}
	return null;
}

function parentOf(root, target) {
	let found = null;
	walkWithParents(root, [], (node, ancestors) => {
		if (node === target) found = ancestors.length ? ancestors[ancestors.length - 1] : null;
	});
	return found;
}

function allByClass(root, className) {
	const out = [];
	walk(root, (node) => {
		if (classesOf(node).includes(className)) out.push(node);
	});
	return out;
}

function containsClass(node, className) {
	let found = false;
	walk(node, (current) => {
		if (!found && classesOf(current).includes(className)) found = true;
	});
	return found;
}

function findByClass(root, className) {
	let found = null;
	walk(root, (node) => {
		if (!found && classesOf(node).includes(className)) found = node;
	});
	return found;
}

function findDesc(row) {
	let desc = null;
	walk(row, (node) => {
		if (!desc && classesOf(node).includes("ldv-row-desc")) desc = node;
	});
	return desc;
}

function hasSwitchShell(row) {
	let shell = false;
	let track = false;
	walk(row, (node) => {
		const classes = classesOf(node);
		if (classes.includes("ldv-switch")) shell = true;
		if (classes.includes("ldv-switch-track")) track = true;
	});
	return shell && track;
}

function rowWithTitle(tree, title) {
	return rowsOf(tree).find((row) => rowTitleOf(row) === title) || null;
}


test("两个总开关已撤除：卡头里不再有任何开关（服务与入口 / 闲时派发）", () => {
	const tree = renderSettingsSection({});
	const heads = allByClass(tree, "ldv-block-head");
	assert.ok(heads.length >= 4, `卡头数量异常（${heads.length}），先修断言再谈通过`);
	for (const head of heads) {
		const inputs = [];
		walk(head, (node) => {
			if (node.type === "input") inputs.push(node);
		});
		assert.equal(
			inputs.length,
			0,
			"卡头不得再有开关/输入控件：" + String(textOf(head)).slice(0, 24),
		);
	}
});

test("闲时辅助：子项**恒渲染**；存量 idleAssistEnabled:false 时显示为禁用而非消失", () => {
	const off = renderSettingsSection({ idleAssistEnabled: false });
	const on = renderSettingsSection({ idleAssistEnabled: true });
	const titles = ["积累经验", "发现摩擦", "召回预算档位（K 字节）"];
	for (const [state, tree] of [["false", off], ["true", on]]) {
		for (const title of titles) {
			assert.ok(rowWithTitle(tree, title), `idleAssistEnabled=${state} 时仍须有「${title}」这一行`);
		}
	}
	for (const title of ["积累经验", "发现摩擦"]) {
		const control = controlsOf(rowWithTitle(off, title))[0];
		assert.equal(control.props.disabled, true, `「${title}」在 idleAssistEnabled=false 时须禁用`);
		assert.equal(control.props.checked, false, `「${title}」在 idleAssistEnabled=false 时须显示为关`);
		const live = controlsOf(rowWithTitle(on, title))[0];
		assert.equal(live.props.disabled, false, `「${title}」在 idleAssistEnabled=true 时须可操作`);
	}
	assert.equal(rowWithTitle(off, "闲置审核"), null, "审核子项已删除，不得出现在设置面");
});


test("参数行：标签与输入框**同处一行**，且输入框不在折叠区", () => {
	const tree = renderSettingsSection({ idleAssistEnabled: true });
	const row = rowWithTitle(tree, "召回预算档位（K 字节）");
	assert.ok(row, "须有「召回预算档位」这一行");
	assert.doesNotMatch(
		JSON.stringify(tree),
		/安静时长/,
		"安静时长行须已删除（2026-11-17 起无时间参数可配）",
	);
	const controls = controlsOf(row);
	assert.ok(controls.length >= 1, "该行须有控件");
	const head = sharedHeadOf(row);
	assert.ok(head, "标题与控件须同处一个行头容器");
	assert.ok(classesOf(head).includes("ldv-row-head"), "行头容器须是 .ldv-row-head");
	let details = 0;
	walk(tree, (node) => { if (node.type === "details") details += 1; });
	assert.equal(details, 0, "参数区不得收进折叠区");
});


test("两处把关询问：两个开关分属**两行**（不得并排挤成一段）", () => {
	const tree = renderSettingsSection({});
	const pre = rowWithTitle(tree, "行动前：询问是否安排代理审查");
	const post = rowWithTitle(tree, "行动后：询问是否安排代理复核");
	assert.ok(pre, "须有「行动前」这一行");
	assert.ok(post, "须有「行动后」这一行");
	assert.notEqual(pre, post, "两处询问必须是两行，不是一行");
	assert.equal(controlsOf(pre).length, 1, "「行动前」行须恰有一个开关");
	assert.equal(controlsOf(post).length, 1, "「行动后」行须恰有一个开关");
	for (const row of [pre, post]) {
		const control = controlsOf(row)[0];
		assert.equal(control.props.type, "checkbox", "两处询问的控件须是开关");
		assert.ok(hasSwitchShell(row), "开关须带 .ldv-switch 外壳与 .ldv-switch-track 滑块");
	}
});

test("遇难题：联网调查提请——独立一行、恰有一个开关，且反映配置取值", () => {
	const tree = renderSettingsSection({});
	const consult = rowWithTitle(tree, "遇难题：联网调查提请");
	assert.ok(consult, "须有「遇难题：联网调查提请」这一行");
	assert.equal(controlsOf(consult).length, 1, "第三处行须恰有一个开关");
	const control = controlsOf(consult)[0];
	assert.equal(control.props.type, "checkbox", "第三处的控件须是开关");
	assert.ok(hasSwitchShell(consult), "开关须带 .ldv-switch 外壳与 .ldv-switch-track 滑块");
	const on = renderSettingsSection({ researchConsultAskEnabled: true });
	const onRow = rowWithTitle(on, "遇难题：联网调查提请");
	assert.equal(controlsOf(onRow)[0].props.checked, true, "配置为开时须显示为开");
	const off = renderSettingsSection({ researchConsultAskEnabled: false });
	const offRow = rowWithTitle(off, "遇难题：联网调查提请");
	assert.equal(controlsOf(offRow)[0].props.checked, false, "配置为关时须显示为关");
});

test("全页的复选框都在开关/色板里（不得退回裸复选框）", () => {
	const tree = renderSettingsSection({ idleAssistEnabled: true });
	const bare = [];
	walkWithParents(tree, [], (node, ancestors) => {
		if (node.type !== "input" || node.props.type !== "checkbox") return;
		const classes = ancestors.flatMap((ancestor) => classesOf(ancestor));
		if (!classes.includes("ldv-switch") && !classes.includes("ldv-check")) bare.push(classesOf(node).join(" "));
	});
	assert.deepEqual(bare, [], `不得出现没有外壳的裸复选框：${bare.join(" | ")}`);
});


test("投放项（对话 Tab / 侧边栏）：总闸关着时**禁用且显示为关**", () => {
	const off = renderSettingsSection({ webEnabled: false });
	for (const label of ["加入到对话 Tab", "加入到侧边栏"]) {
		const row = rowWithTitle(off, label);
		assert.ok(row, "须有「" + label + "」这一行");
		const control = controlsOf(row)[0];
		assert.ok(control, label + " 须带一个控件");
		assert.equal(control.props.disabled, true, label + " 在总闸关闭时须禁用");
		assert.equal(control.props.checked, false, label + " 在总闸关闭时须显示为关");
	}
	const on = renderSettingsSection({ webEnabled: true });
	const row = rowWithTitle(on, "加入到对话 Tab");
	assert.equal(controlsOf(row)[0].props.disabled, false, "总闸打开时投放项须可操作");
});


function sourceWithoutSettingsCss() {
	const marker = "var SETTINGS_CSS =";
	const start = source.indexOf(marker);
	const body = start + marker.length;
	const end = source.indexOf(";\n", body);
	return source.slice(0, start) + source.slice(end);
}

function settingsCssText() {
	const marker = "var SETTINGS_CSS =";
	const start = source.indexOf(marker);
	assert.ok(start >= 0, "SETTINGS_CSS 常量须存在");
	const body = start + marker.length;
	const end = source.indexOf(";\n", body);
	assert.ok(end > body, "SETTINGS_CSS 字面量须有结束位置");
	return vm.runInNewContext(`(${source.slice(body, end)})`);
}

test("SETTINGS_CSS 能被求值并解析（漏一个 + 或引号错位会让整段静默失效）", () => {
	const css = settingsCssText();
	assert.ok(css.length > 2000, "样式表长度异常");
	const open = (css.match(/\{/g) || []).length;
	const close = (css.match(/\}/g) || []).length;
	assert.equal(open, close, "CSS 花括号须配平");
	assert.ok(!/undefined|NaN/.test(css), "样式表里不得出现 undefined/NaN");
	const rules = css.split("}").filter((block) => block.includes("{")).length;
	assert.ok(rules >= 60, `规则数异常（${rules}），先修断言再谈通过`);
});

test("样式表与标记**双向对账**：用到的类名都有样式，样式里的类名都还在用", () => {
	const css = settingsCssText();
	const markupSide = sourceWithoutSettingsCss();
	const jsxClasses = new Set();
	for (const match of markupSide.matchAll(/"\s*((?:ldv-[a-z0-9-]+)(?:\s+ldv-[a-z0-9-]+)*)"/g)) {
		for (const token of match[1].trim().split(/\s+/)) if (token) jsxClasses.add(token);
	}
	const cssClasses = new Set();
	for (const match of css.matchAll(/\.(ldv-[a-z0-9-]+)/g)) cssClasses.add(match[1]);

	const missing = [...jsxClasses].filter((name) => !cssClasses.has(name));
	assert.deepEqual(missing, [], `标记里用到但样式表没有的类名：${missing.join(" | ")}`);

	const dead = [...cssClasses].filter((name) => !jsxClasses.has(name));
	assert.deepEqual(dead, [], `样式表里已无消费点的类名：${dead.join(" | ")}`);
});


test("块内容与行容器都有**显式**排布规则（不靠文案长短碰巧对齐）", () => {
	const css = settingsCssText();
	assert.match(css, /\.ldv-block-body\{[^}]*flex-direction:column/, "块内容须显式纵向排列");
	assert.match(css, /\.ldv-row\{[^}]*display:flex/, "行须是 flex 容器");
	assert.match(css, /\.ldv-row\{[^}]*flex-direction:column/, "行的标题与说明须上下分行");
	assert.match(css, /\.ldv-row-head\{[^}]*display:flex/, "行头须是 flex 行容器");
	assert.match(css, /\.ldv-row-head\{[^}]*align-items:center/, "行头须垂直居中对齐");
});

test("每行的控件与标题**相邻**，说明**独占一行**（本轮可读性改版的不变量）", () => {
	const tree = renderSettingsSection({ idleAssistEnabled: true });
	const holders = allByClass(tree, "ldv-row-control");
	assert.ok(holders.length >= 7, `须检查到足够多的行（实际 ${holders.length}）`);
	for (const holder of holders) {
		const head = parentOf(tree, holder);
		assert.ok(head && classesOf(head).includes("ldv-row-head"), "控件须在行头容器里（与标题相邻）");
		assert.ok(containsClass(head, "ldv-row-title"), "行头里须有标题");
	}
	for (const desc of allByClass(tree, "ldv-row-desc")) {
		const parent = parentOf(tree, desc);
		assert.ok(parent && !classesOf(parent).includes("ldv-row-head"), "说明须独占一行（不得与标题同处行头）");
	}
	for (const holder of allByClass(tree, "ldv-block-control")) {
		const head = parentOf(tree, holder);
		assert.ok(head && classesOf(head).includes("ldv-block-head"), "块首控件须在块首容器里");
		assert.ok(containsClass(head, "ldv-block-title"), "块首里须有标题");
	}
});
