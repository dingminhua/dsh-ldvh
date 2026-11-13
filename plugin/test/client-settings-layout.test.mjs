import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

/**
 * 设置页**版面**的行为守卫。
 *
 * ## 为什么另起一个文件（而不是在 client-contract 里继续钉类名）
 *
 * 2026-11-13 重排设置页版面（扁平化：分节标题 + 标题与控件相邻的行）时，
 * client-contract 里三条断言被打红：它们钉的是**类名与源码缩进**
 * （`ldv-web-panel-body`、`ldv-idle-limit-row`、`checked: … && …`）。
 * 把断言改成匹配新标记，只会把「意图守护」降级成「形状守护」——
 * 这正是本仓 2026-11-13 独立审核 MINOR #9 记过的教训（子串型断言已
 * 改行为断言一次）。故本文件用**真实执行 client.js** 的方式，把那几条
 * 意图改成行为断言：
 *
 *   ① 两个总开关（「启用 LDVH Web 呈现」/「闲时派发」）已撤除，卡头里没有开关；
 *      子项恒渲染，存量关闭值只把子项置为禁用（不隐藏）；
 *   ② 标签与输入框**同处一行**（不是折叠区、不是分两处）；
 *   ③ 两处把关询问是**两行**（不得并排挤成一段）；
 *   ④ 投放项随持久值 webEnabled=false **禁用**（总开关已撤，判据仍是这个字段）。
 *
 * 同时补上**样式表本身的护栏**（此前 SETTINGS_CSS 全量重写却无人求值）：
 * 字符串拼接漏一个 `+`、引号错位，浏览器会静默丢弃整段规则而测试全绿。
 * 这里照 GATE_CSS 的做法（client-contract.test.mjs 的 gateCssText()）求值
 * 实际下发的 CSS，并做两条交叉核对：JSX 用到的类名都有样式、样式里的
 * ldv- 类名都还在用（防死样式残留）。
 */

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

// ── 最小 React 替身：够 client.js 加载，并留下**可查询的树** ────────────────
//
// 与 client-fallback.test.mjs 同款思路（真实执行 client.js），但这里把元素
// 留成树而不是 null：版面断言要看的是「谁在谁里面」，不是「有没有报错」。

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

/** 把元素树渲染成「宿主会看到的 DOM 形状」——函数组件就地执行。 */
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

/** 深度优先遍历产物树。 */
function walk(node, visit) {
	walkWithParents(node, [], visit);
}

/**
 * 带祖先链的遍历：祖先由近及远。
 *
 * 「这个复选框是不是在开关里」这类断言需要它——单看节点不知道自己在哪。
 */
function walkWithParents(node, ancestors, visit) {
	if (!node) return;
	if (Array.isArray(node)) { for (const child of node) walkWithParents(child, ancestors, visit); return; }
	if (node.text !== undefined) return;
	visit(node, ancestors);
	walkWithParents(node.children, ancestors.concat([node]), visit);
}

/** 取某个节点的 class 列表。 */
function classesOf(node) {
	return String((node.props && node.props.className) || "").split(/\s+/).filter(Boolean);
}

/** 取某个节点下所有文本（含后代）。 */
function textOf(node) {
	if (!node) return "";
	if (Array.isArray(node)) return node.map((child) => textOf(child)).join("");
	if (node.text !== undefined) return node.text;
	return textOf(node.children);
}

/**
 * 渲染设置页一节，返回产物树。
 *
 * @param {object} config 设置值（缺省项按「未设置」处理）
 */
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
	// 经 toTree 渲染：函数组件在那里就地执行，hook 槽位也就有了归属。
	return toTree({ type: entry.component, props: entry.definition.inject({}), __element: true }, React);
}

/** 取所有「行」节点（class 含 ldv-row）。 */
function rowsOf(tree) {
	const rows = [];
	walk(tree, (node) => {
		if (classesOf(node).includes("ldv-row")) rows.push(node);
	});
	return rows;
}

/** 取某一行里的控件（开关/输入框/下拉）。 */
function controlsOf(row) {
	const controls = [];
	walk(row, (node) => {
		if (node.type === "input" || node.type === "select") controls.push(node);
	});
	return controls;
}

/** 取一行的标题文字（`.ldv-row-title` 那一格）。 */
function rowTitleOf(row) {
	let title = "";
	walk(row, (node) => {
		if (title === "" && classesOf(node).includes("ldv-row-title")) title = textOf(node);
	});
	return title;
}

/** 取「行内标题」与「行内控件」共同的父容器（没有共同父容器则 null）。 */
function sharedHeadOf(row) {
	let titleNode = null;
	let controlNode = null;
	walkWithParents(row, [], (node, ancestors) => {
		if (!titleNode && classesOf(node).includes("ldv-row-title")) titleNode = { node, ancestors };
		if (!controlNode && (node.type === "input" || node.type === "select")) controlNode = { node, ancestors };
	});
	if (!titleNode || !controlNode) return null;
	// 控制件的祖先里最近的那一层标题祖先，就是两者共同的父。
	for (const ancestor of controlNode.ancestors) {
		if (ancestor === titleNode.node) return null;
		if (ancestor === titleNode.ancestors[titleNode.ancestors.length - 1]) return ancestor;
	}
	return null;
}

/** 取某节点的父节点（从树根走一遍，在它的祖先链里找）。 */
function parentOf(root, target) {
	let found = null;
	walkWithParents(root, [], (node, ancestors) => {
		if (node === target) found = ancestors.length ? ancestors[ancestors.length - 1] : null;
	});
	return found;
}

/** 取树里所有带指定类名的节点。 */
function allByClass(root, className) {
	const out = [];
	walk(root, (node) => {
		if (classesOf(node).includes(className)) out.push(node);
	});
	return out;
}

/** 节点（含后代）里是否出现指定类名。 */
function containsClass(node, className) {
	let found = false;
	walk(node, (current) => {
		if (!found && classesOf(current).includes(className)) found = true;
	});
	return found;
}

/** 取行内第一个带指定类名的节点。 */
function findByClass(root, className) {
	let found = null;
	walk(root, (node) => {
		if (!found && classesOf(node).includes(className)) found = node;
	});
	return found;
}

/** 取行内的说明节点（class 含 ldv-row-desc）。 */
function findDesc(row) {
	let desc = null;
	walk(row, (node) => {
		if (!desc && classesOf(node).includes("ldv-row-desc")) desc = node;
	});
	return desc;
}

/** 行内是否存在「开关外壳 + 滑块」。 */
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

/**
 * 按**标题**找一行（不是「整行文本包含」）。
 *
 * 为什么必须精确到标题：说明文字里也会出现同样的字样——例如「召回预算档位」
 * 那行的说明写着「行动前召回的体量上限…」，用「包含」去匹配「行动前」会先
 * 命中它，断言就落到了别的行上（这正是本测试第一版踩的坑）。
 */
function rowWithTitle(tree, title) {
	return rowsOf(tree).find((row) => rowTitleOf(row) === title) || null;
}

// ── ① 两个总开关已撤除 ──────────────────────────────────────────────────────

test("两个总开关已撤除：卡头里不再有任何开关（服务与入口 / 闲时派发）", () => {
	// 2026-11-13 Human：「这2个开关去掉」——指的是「启用 LDVH Web 呈现」与
	// 「闲时派发」这两个总开关。它们撤除后，卡头只剩组名、说明与读数。
	// 判据按**树**取：卡头（.ldv-block-head）子树里不得出现 `input`——宿主的
	// 开关就是 label.ldv-switch 里包着的 input[type=checkbox]，没有 input 就没有
	// 开关。卡头仍可留按钮（「新增管辖项目」是动作，不是这一组的开关）。
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
	// 总开关撤除后，「关了就整块消失」这个旧形态必须消失——否则读者会以为
	// 这些设置根本不存在（这正是撤除总开关的理由）。
	const off = renderSettingsSection({ idleAssistEnabled: false });
	const on = renderSettingsSection({ idleAssistEnabled: true });
	const titles = ["闲置捕获", "闲置审核", "安静时长（分钟）", "召回预算档位（K 字节）"];
	for (const [state, tree] of [["false", off], ["true", on]]) {
		for (const title of titles) {
			assert.ok(rowWithTitle(tree, title), `idleAssistEnabled=${state} 时仍须有「${title}」这一行`);
		}
	}
	// 存量配置仍作数：服务端确实不派发，故两个子项此时**显示为禁用**——
	// 让它们照常可点就是让读数说谎。
	for (const title of ["闲置捕获", "闲置审核"]) {
		const control = controlsOf(rowWithTitle(off, title))[0];
		assert.equal(control.props.disabled, true, `「${title}」在 idleAssistEnabled=false 时须禁用`);
		assert.equal(control.props.checked, false, `「${title}」在 idleAssistEnabled=false 时须显示为关`);
		const live = controlsOf(rowWithTitle(on, title))[0];
		assert.equal(live.props.disabled, false, `「${title}」在 idleAssistEnabled=true 时须可操作`);
	}
});

// ── ② 标签与输入框同处一行 ────────────────────────────────────────────────

test("参数行：标签与输入框**同处一行**，且输入框不在折叠区", () => {
	const tree = renderSettingsSection({ idleAssistEnabled: true });
	const row = rowWithTitle(tree, "安静时长（分钟）");
	assert.ok(row, "须有「安静时长」这一行");
	// 同一行内既有标题文本，也有那个数值输入框。
	const controls = controlsOf(row);
	assert.equal(controls.length, 1, "该行须恰有一个控件（数值输入框）");
	assert.equal(controls[0].type, "input", "该控件须是输入框");
	assert.equal(controls[0].props.type, "number", "安静时长须用数值输入框");
	// **标题与控件同处一个「行头」**（2026-11-13 可读性改版后：控件紧随标题，
	// 说明另起一行）。这一条钉的是「控件与它的标题相邻」这个绑定关系——
	// 只断言「同处一个 .ldv-row」太宽：控件被放回行的另一端也照样通过。
	const head = sharedHeadOf(row);
	assert.ok(head, "标题与控件须同处一个行头容器");
	assert.ok(classesOf(head).includes("ldv-row-head"), "行头容器须是 .ldv-row-head");
	// 折叠区不得回来：整棵树里不得有 <details>。
	let details = 0;
	walk(tree, (node) => { if (node.type === "details") details += 1; });
	assert.equal(details, 0, "参数区不得收进折叠区");
});

// ── ③ 两处把关询问：两行，不并排 ──────────────────────────────────────────

test("两处把关询问：两个开关分属**两行**（不得并排挤成一段）", () => {
	const tree = renderSettingsSection({});
	const pre = rowWithTitle(tree, "行动前：询问是否安排代理审查");
	const post = rowWithTitle(tree, "行动后：询问是否安排代理复核");
	assert.ok(pre, "须有「行动前」这一行");
	assert.ok(post, "须有「行动后」这一行");
	assert.notEqual(pre, post, "两处询问必须是两行，不是一行");
	// 每行一个开关。
	assert.equal(controlsOf(pre).length, 1, "「行动前」行须恰有一个开关");
	assert.equal(controlsOf(post).length, 1, "「行动后」行须恰有一个开关");
	// 且它们是**开关**而不是裸复选框：开关 = label.ldv-switch 里包着
	// input[type=checkbox] 与 .ldv-switch-track 滑块。
	//
	// 2026-11-13 复核指出：只断言 input[type=checkbox] 是**钉不住的**——原生
	// 复选框同样是 checkbox，把它换成裸 <input> 全部测试照样绿。故此处断言
	// 结构本身（外壳 + 滑块），并另有一条全局断言（见下）。
	for (const row of [pre, post]) {
		const control = controlsOf(row)[0];
		assert.equal(control.props.type, "checkbox", "两处询问的控件须是开关");
		assert.ok(hasSwitchShell(row), "开关须带 .ldv-switch 外壳与 .ldv-switch-track 滑块");
	}
});

test("全页的复选框都在开关/色板里（不得退回裸复选框）", () => {
	// 控件统一这一条若只靠「样式表里有 .ldv-switch」守护，是**钉不住的**：
	// 把 switchControl 换成裸 <input type="checkbox">，样式表一条不改，页面
	// 却已经退回两套控件。故按**树**断言：每个复选框都得有外壳。
	const tree = renderSettingsSection({ idleAssistEnabled: true });
	const bare = [];
	walkWithParents(tree, [], (node, ancestors) => {
		if (node.type !== "input" || node.props.type !== "checkbox") return;
		const classes = ancestors.flatMap((ancestor) => classesOf(ancestor));
		// .ldv-switch = 开关；.ldv-check = 色板里的「自动取色」（卡片内的小控件，
		// 保留原生复选框是有意为之，见 client.js 的注释）。
		if (!classes.includes("ldv-switch") && !classes.includes("ldv-check")) bare.push(classesOf(node).join(" "));
	});
	assert.deepEqual(bare, [], `不得出现没有外壳的裸复选框：${bare.join(" | ")}`);
});

// ── ④ 投放项随 Web 呈现总闸禁用 ────────────────────────────────────────────

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

// ── ⑤ 样式表护栏：求值 + 双向类名核对 ──────────────────────────────────────

/** 去掉 SETTINGS_CSS 字面量后的源码——「标记侧」的类名只能从这里取。 */
function sourceWithoutSettingsCss() {
	const start = source.indexOf("var SETTINGS_CSS = ");
	const body = start + "var SETTINGS_CSS = ".length;
	const end = source.indexOf(";\n", body);
	return source.slice(0, start) + source.slice(end);
}

/** 求值 client.js 里的 SETTINGS_CSS 字面量，得到**实际下发的** CSS 文本。 */
function settingsCssText() {
	const start = source.indexOf("var SETTINGS_CSS = ");
	assert.ok(start >= 0, "SETTINGS_CSS 常量须存在");
	const body = start + "var SETTINGS_CSS = ".length;
	const end = source.indexOf(";\n", body);
	assert.ok(end > body, "SETTINGS_CSS 字面量须有结束位置");
	return vm.runInNewContext(`(${source.slice(body, end)})`);
}

test("SETTINGS_CSS 能被求值并解析（漏一个 + 或引号错位会让整段静默失效）", () => {
	const css = settingsCssText();
	assert.ok(css.length > 2000, "样式表长度异常");
	// 括号配平：少一个 } 会让后面所有规则被吞掉。
	const open = (css.match(/\{/g) || []).length;
	const close = (css.match(/\}/g) || []).length;
	assert.equal(open, close, "CSS 花括号须配平");
	// 求值产物里不得出现 undefined / NaN —— 拼接漏了变量就是这种形态。
	assert.ok(!/undefined|NaN/.test(css), "样式表里不得出现 undefined/NaN");
	// 规则数下限：本次重排后仍应有成百条规则。
	const rules = css.split("}").filter((block) => block.includes("{")).length;
	assert.ok(rules >= 60, `规则数异常（${rules}），先修断言再谈通过`);
});

test("样式表与标记**双向对账**：用到的类名都有样式，样式里的类名都还在用", () => {
	const css = settingsCssText();
	// **标记侧**：所有 ldv- 类名。取自「去掉样式表字面量之后」的源码——
	// 否则反向对账会恒真（样式表里的类名本来就在源码里，`source.includes` 必真，
	// 死样式永远查不出来；2026-11-13 复核实测：塞一条死样式进 CSS，反向检查
	// 仍报「无死类名」）。
	const markupSide = sourceWithoutSettingsCss();
	const jsxClasses = new Set();
	// 前导空格一并容下：状态修饰符在 JSX 里多以拼接形式出现
	//（className: "ldv-status-value" + (x ? " ldv-status-wait" : "")）。
	for (const match of markupSide.matchAll(/"\s*((?:ldv-[a-z0-9-]+)(?:\s+ldv-[a-z0-9-]+)*)"/g)) {
		for (const token of match[1].trim().split(/\s+/)) if (token) jsxClasses.add(token);
	}
	// CSS 侧：所有 .ldv- 选择器。
	const cssClasses = new Set();
	for (const match of css.matchAll(/\.(ldv-[a-z0-9-]+)/g)) cssClasses.add(match[1]);

	const missing = [...jsxClasses].filter((name) => !cssClasses.has(name));
	assert.deepEqual(missing, [], `标记里用到但样式表没有的类名：${missing.join(" | ")}`);

	// 反向：样式表里的 ldv- 类名都还有消费点（防「改了标记忘了删样式」）。
	const dead = [...cssClasses].filter((name) => !jsxClasses.has(name));
	assert.deepEqual(dead, [], `样式表里已无消费点的类名：${dead.join(" | ")}`);
});

// ── ⑥ 容器须有显式纵向排布规则（审查指出：排版不能靠文案长短的巧合）──────

test("块内容与行容器都有**显式**排布规则（不靠文案长短碰巧对齐）", () => {
	const css = settingsCssText();
	// 块内容：纵向排列。
	assert.match(css, /\.ldv-block-body\{[^}]*flex-direction:column/, "块内容须显式纵向排列");
	// 行：纵向排列（标题行 + 说明各占一行）。
	assert.match(css, /\.ldv-row\{[^}]*display:flex/, "行须是 flex 容器");
	assert.match(css, /\.ldv-row\{[^}]*flex-direction:column/, "行的标题与说明须上下分行");
	// 行头：标题与控件横向相邻。
	assert.match(css, /\.ldv-row-head\{[^}]*display:flex/, "行头须是 flex 行容器");
	assert.match(css, /\.ldv-row-head\{[^}]*align-items:center/, "行头须垂直居中对齐");
});

test("每行的控件与标题**相邻**，说明**独占一行**（本轮可读性改版的不变量）", () => {
	// 2026-11-13 可读性改版：控件从「行的另一端」收到「标题旁边」，说明另起一行。
	// 这条不变量此前**无人看守**：把控件挪回行末，8 条测试照样全绿——
	// 复核实测如此。故此处按**树**断言两条绑定关系：
	//   ① 控件的父节点是行头容器（.ldv-row-head），且行头里有标题；
	//   ② 说明（若有）的父节点是行本身，不是行头——即说明独占一行。
	const tree = renderSettingsSection({ idleAssistEnabled: true });
	// 覆盖**所有**控件容器，不只是有 input/select 的行——读数行（Web 呈现状态）
	// 的控件是文字，用「找 input」的方式会把它整行漏掉（复核指出过这个盲区）。
	const holders = allByClass(tree, "ldv-row-control");
	assert.ok(holders.length >= 8, `须检查到足够多的行（实际 ${holders.length}）`);
	for (const holder of holders) {
		// 控件容器（.ldv-row-control）的父节点须是行头（.ldv-row-head）——
		// 即控件与标题同处行头，二者相邻。
		const head = parentOf(tree, holder);
		assert.ok(head && classesOf(head).includes("ldv-row-head"), "控件须在行头容器里（与标题相邻）");
		assert.ok(containsClass(head, "ldv-row-title"), "行头里须有标题");
	}
	// 说明独占一行：说明节点的父节点不是行头。
	for (const desc of allByClass(tree, "ldv-row-desc")) {
		const parent = parentOf(tree, desc);
		assert.ok(parent && !classesOf(parent).includes("ldv-row-head"), "说明须独占一行（不得与标题同处行头）");
	}
	// 块首同理：控件容器在块首容器里，块首里也有标题。
	for (const holder of allByClass(tree, "ldv-block-control")) {
		const head = parentOf(tree, holder);
		assert.ok(head && classesOf(head).includes("ldv-block-head"), "块首控件须在块首容器里");
		assert.ok(containsClass(head, "ldv-block-title"), "块首里须有标题");
	}
});
