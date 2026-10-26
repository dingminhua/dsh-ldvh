import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

test("matches the WorkBuddy plugin-card shell contract", () => {
	for (const fragment of [
		'.ldv-settings-card{border:1px solid',
		'.ldv-settings-card-open{',
		'.ldv-settings-card-header{appearance:none',
		'padding:14px 16px',
		'.ldv-settings-card-icon{width:32px;height:32px',
		'.ldv-settings-card-body{border-top:1px solid',
		'LDVH_ROW_CONFIG_KEY',
	]) assert.ok(source.includes(fragment), `missing WorkBuddy card fragment: ${fragment}`);
});

test("uses the WorkBuddy client registration and degradation pattern", () => {
	// Governance marks removed (Human 2026-09-04: the context-injection row
	// supersedes both UI marks).
	//
	// 2026-09-25 修订（Human 授权撤销 2026-09-04 决定）：当年删的是**客户端自建的
	// 两套标记组件**（LdvhGovernanceMark / LdvhHeaderMark，与注入行重复呈现，故被
	// 判定为冗余）；而宿主 0.1.7 起把插件注入一律归为不可见的 `context` 行，
	// 注入行本身在对话流**已不可见**——「注入行唯一承载」的前提随之失效。故重新
	// 引入一个客户端呈现组件（ldvh-notice），但**仍不恢复那两套标记**：新组件呈现的
	// 是注入消息本身的内容，不是另画一个状态标记。本条断言据此改为守护新基线。
	// 撤销依据与未验证范围见 plugin/lib/client.js 的 ldvhNoticeDefinition 注释。
	//
	// 0.1.7 变更（调研 §3.3）：settingsScope 服务已删除，硬注入它会让整个客户端
	// 插件永不 apply——因此 inject 里不得再出现它；设置面改走 configForms 软注入。
	assert.ok(source.includes('var inject = ["slots", "locale", "uiConversation"]'));
	assert.ok(!source.includes('var inject = ["slots", "locale", "settingsScope"]'), "settingsScope must not be hard-injected (service removed in 0.1.7)");
	assert.ok(!source.includes('var inject = ["slots", "locale", "uiConversation", "settingsScope"]'), "settingsScope must not be hard-injected (service removed in 0.1.7)");
	assert.ok(source.includes('ctx.inject(["configForms"]'), "settings transport must be a soft configForms injection");
	assert.ok(source.includes('ctx.effect(function ()'));
	assert.ok(source.includes('ctx.locale.register(LDVH_NS, { zh: LDVH_ZH, en: LDVH_EN })'));
	assert.ok(source.includes('ctx.locale.bind(LDVH_NS)'));
	// 设置卡：与 dsh-connect-workbuddy 同款**双注册**——plugins.bundle.config
	//（key = 包名）在 bundle 详情页直接展开，plugins.row.config（key = <包名>#<行 id>）
	// 作为行级补充；各自 try/catch。官方契约把 plugins.item 留给「官方设置页」。
	assert.ok(source.includes('registerCard("plugins.bundle.config", LDVH_PACKAGE_NAME)'), "must register the bundle-card seat (expanded on the bundle detail page)");
	assert.ok(source.includes('registerCard("plugins.row.config", LDVH_ROW_CONFIG_KEY)'), "must keep the row-card seat");
	assert.ok(source.includes('registerCard("plugins.bundle.config", LDVH_PACKAGE_NAME)'), "bundle config key must be the package name");
	assert.ok(source.includes('registerCard("plugins.row.config", LDVH_ROW_CONFIG_KEY)'), "row config key must be <package>#<row id>");
	assert.ok(source.includes('var LDVH_PACKAGE_NAME = "dsh-ldvh"'), "package name constant declared");
	assert.ok(source.includes('var LDVH_ROW_CONFIG_KEY = "dsh-ldvh#dsh-ldvh"'), "row key must be <package>#<row id>");
	// 页面按 view 请求两种形态：summary 回一行文本，page 回表单。
	assert.ok(source.includes('if (props.view === "summary")'), "card must branch on the page's view prop");
	// page 形态默认展开（用户一进详情页就看到内容，不必再点开）。
	assert.ok(source.includes('var openState = React.useState(true)'), "card must default to expanded on the page view");
	assert.ok(!source.includes('name: "settings.plugin.item"'), "must not register into the removed settings.plugin.item slot");
	assert.ok(source.includes('console.error("[dsh-ldvh] client UI failed to load'));
	assert.ok(!source.includes('"connection"]'), "settings card must not inject unused connection service");
});

test("resolves the served settings namespace instead of assuming the bare id", () => {
	// dsh-connect-workbuddy 2.0.16 同款坑：0.1.7 的 configForms.get() 对宿主
	// served-namespace 目录做**精确匹配**，而桌面宿主以 `include:<包名>` 挂载
	// Loader 条目。硬编码 `dsh-ldvh` 会让设置卡绑定到无人服务的命名空间
	// （status: unavailable，静默失效、不报错）。必须先从 describe() 的 mirror
	// 探测实际服务的 ns，声明常量只作 mirror 未就绪时的兜底。
	assert.ok(source.includes('function ldvhEntryIdOf(forms)'), "must probe the served namespace from the configForms mirror");
	assert.ok(source.includes('forms.describe().getSnapshot().view'), "probe reads the served-namespace directory from the mirror");
	assert.ok(source.includes('entry.ns === LDVH_ENTRY_ID || /ldvh/i.test(entry.ns || "")'), "probe accepts the declared id or a package-name substring");
	assert.ok(!source.includes('configForms.get(LDVH_ENTRY_ID)'), "must not call get() with the bare declared id — bind the probed ns instead");
	assert.ok(source.includes('configForms.get(ldvhEntryIdOf(formsCtx.configForms))'), "both bind sites must go through the resolver");
});

test("uses the real package icon and a renamed chevron primitive with a fallback", () => {
	assert.ok(source.includes('data:image/png;base64,'));
	// 0.1.7 起图标导出族由尺寸后缀改为粗细语义后缀（调研 §4.3 致命点 B）：
	// 必须按名探测取新名，旧名仅作回退，且渲染点要有兜底。
	assert.ok(source.includes('primitives.IconChevronDownOutlineRegular'), "must probe the new icon name first");
	assert.ok(source.includes('|| primitives.IconChevronDownOutline14'), "must fall back to the legacy icon name");
	assert.ok(source.includes('IconChevronDown ? React.createElement(IconChevronDown, { size: 14 })'), "render site must guard against a missing icon component");
});

test("provides accessible expand and collapse labels", () => {
	assert.ok(source.includes('"row.expand": "展开"'));
	assert.ok(source.includes('"row.collapse": "收起"'));
	assert.ok(source.includes('"row.expand": "Expand"'));
	assert.ok(source.includes('"row.collapse": "Collapse"'));
	assert.ok(source.includes('"aria-label": t(openState[0] ? "row.collapse" : "row.expand") + ": " + title'));
});

test("loadProjects catch demotes transport failures to unavailable: true (no error text)", () => {
	// 传输层失败不再把 t("row.apiUnavailable") 塞进 projectsState.error，
	// 也不再调 t(...)；只写 error: null, unavailable: true（领域错误时相反）。
	assert.ok(
		source.includes("error: isTransport ? null : message, unavailable: isTransport"),
		"loadProjects catch must write error: null and unavailable: true on transport failure",
	);
	// catch 分支里不能出现 row.apiUnavailable —— 之前就是它导致重复渲染。
	const catchStart = source.indexOf(".catch(function (error) {");
	assert.ok(catchStart !== -1, "loadProjects catch block not found");
	const catchEnd = source.indexOf("});", catchStart);
	assert.ok(catchEnd !== -1, "loadProjects catch terminator not found");
	const catchBody = source.slice(catchStart, catchEnd);
	assert.ok(
		!catchBody.includes('"row.apiUnavailable"'),
		"loadProjects catch must not surface row.apiUnavailable (cause already explained in the Web status row)",
	);
	// 关键 isTransport 判定关键词仍然存在（这是契约保留的传输判定，不只是空断言）。
	assert.ok(
		catchBody.includes("isTransport"),
		"loadProjects catch must keep the isTransport transport-failure classification",
	);
});

test("chooseProject uses the desktop pick-bridge ladder with visible failures", () => {
	// 目录选择梯级：Desktop 窗口预注入桥优先（window.__DSH_DESKTOP_PICK_DIRECTORY__
	// 经 /_dsh/desktop/pick-directory 直通主进程 Electron dialog——win32 Desktop
	// 内可靠的原生弹窗，与宿主 browse surface 同款 dsh-desktop-platform=win32
	// 门控），remote.directoryPicker.pick() 兜底；失败一律进表单错误位（对齐宿主
	// directoryFlow 契约的 onError 一等公民语义），取消（null）静默返回；
	// 路径框保持可手动编辑作为最终兜底。
	assert.ok(
		source.includes("window.__DSH_DESKTOP_PICK_DIRECTORY__"),
		"the desktop pick bridge must be probed before the remote ladder",
	);
	assert.ok(
		source.includes('new URLSearchParams(window.location.search).get("dsh-desktop-platform") === "win32"'),
		"the desktop bridge must be gated on the desktop win32 page marker (host browse-surface gating)",
	);
	assert.ok(
		source.includes("function adoptPickedPath(path)"),
		"every picked path must funnel through adoptPickedPath (cancel = null is not an error)",
	);
	assert.ok(
		source.includes('"row.pickFailed"') || source.includes('"row.pickFailed":'),
		"pick failures must surface through the form error slot",
	);
	assert.ok(
		source.includes('"row.pickUnavailable"') || source.includes('"row.pickUnavailable":'),
		"a missing picker service must surface through the form error slot",
	);
	assert.ok(
		!source.includes("readOnly: true"),
		"the path field must stay manually editable (the always-available fallback)",
	);
});

test("projectsState.unavailable branch renders a pointer hint, not a red error box", () => {
	// unavailable 分支渲染 ldv-settings-hint + row.projectsUnavailable，不渲染红框、不渲染空列表态。
	// 检查三元子句的关键词和产物，注释行可能出现在 ? 之前（缩进无关）。
	assert.ok(
		source.includes('projectsState[0].unavailable\n          // Transport-level failure'),
		"projectsState.unavailable ternary guard must be present with transport-level comment",
	);
	assert.ok(
		source.includes('? React.createElement("span", { className: "ldv-settings-hint" }, t("row.projectsUnavailable"))'),
		"unavailable branch must render ldv-settings-hint + row.projectsUnavailable",
	);
	// unavailable 分支不能渲染 ldv-governance-error（在它自己分支内）。
	// 验证 unavailable 三元 → 其三元体结束于 ldv-governance-error 出现处。
	const unavailableIdx = source.indexOf("projectsState[0].unavailable");
	assert.ok(unavailableIdx !== -1, "projectsState.unavailable guard not found");
	const errorIdx = source.indexOf("projectsState[0].error", unavailableIdx);
	assert.ok(errorIdx !== -1, "domain error guard not found");
	const unavailableBranch = source.slice(unavailableIdx, errorIdx);
	assert.ok(
		!unavailableBranch.includes("ldv-governance-error"),
		"unavailable branch must not render ldv-governance-error (that would be the duplicate we are deleting)",
	);
	// unavailable 分支也不应渲染"还没有管辖项目"空态。
	assert.ok(
		!unavailableBranch.includes("ldv-governance-empty-title"),
		"unavailable branch must not pretend the project list is empty",
	);
});

test("domain-error red box (ldv-governance-error) is reserved for non-transport errors", () => {
	// 非 transport 路径仍渲染领域错误红框。位置：error 分支（区别于 unavailable 分支）。
	const errorBranchFragment =
		': (projectsState[0].error\n            ? React.createElement("div", { className: "ldv-governance-error", role: "alert" }, projectsState[0].error)';
	assert.ok(
		source.includes(errorBranchFragment),
		"domain error branch must still render ldv-governance-error with role=alert",
	);
	// inspect / update / unregister 的 catch 仍把 message 写入 error、unavailable: false。
	for (const op of ["inspectProject", "updateProject", "unregisterGovernance"]) {
		assert.ok(
			source.includes(op),
			`op handler ${op} must exist (sanity)`,
		);
	}
	// 这三个 catch 都使用统一的非 transport 写入：error 字符串、unavailable: false。
	assert.ok(
		source.includes("error: String(error.message || error), unavailable: false"),
		"non-transport failures (inspect/update/unregister) must still write error text + unavailable: false",
	);
});

test("project card actions: uninstall removed, Update only when repairable, notReadyDetail hint", () => {
	// 卸载按钮与其处理函数已删除：源码不得再引用 row.uninstall / uninstallProjectHook。
	assert.ok(
		!source.includes("uninstallProjectHook"),
		"client must not reference the removed uninstallProjectHook",
	);
	assert.ok(
		!source.includes('"row.uninstall"'),
		"locale key row.uninstall must be removed with the uninstall button",
	);
	// repairable 判定：Hook absent/outdated 或 fact source absent/incomplete 可修复。
	assert.ok(
		source.includes('["absent", "outdated"].includes(hook.state)'),
		"repairable must treat absent/outdated Hook states as fixable",
	);
	assert.ok(
		source.includes('["absent", "incomplete"].includes(factSource.state)'),
		"repairable must treat absent/incomplete fact source states as fixable",
	);
	// 更新按钮仅在 repairable 时渲染，并调用 updateProject(project)（幂等安装事务）。
	assert.ok(
		source.includes(
			'repairable ? React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", disabled: projectBusyState[0], onClick: function () { updateProject(project); } }',
		),
		"update button must render only when repairable and call updateProject(project)",
	);
	assert.ok(
		source.includes('projectBusyState[0] ? t("row.updateBusy") : t("row.update")'),
		"update button must show row.updateBusy while busy and row.update otherwise",
	);
	// notReadyDetail 原因链：factSource.detail → hook.detail → status.error.message，
	// 未就绪且非空时以 ldv-settings-hint 渲染在卡片头下方。
	assert.ok(
		source.includes("var notReadyDetail = ready ? null"),
		"notReadyDetail must be computed per project card",
	);
	assert.ok(
		source.includes('(factSource && factSource.state !== "ready" && factSource.detail)'),
		"notReadyDetail chain must start with factSource.detail",
	);
	assert.ok(
		source.includes('(hook && hook.state !== "managed" && hook.detail)'),
		"notReadyDetail chain must fall back to hook.detail",
	);
	assert.ok(
		source.includes("(project.status && project.status.error && project.status.error.message)"),
		"notReadyDetail chain must fall back to status.error.message",
	);
	assert.ok(
		source.includes('notReadyDetail ? React.createElement("span", { className: "ldv-settings-hint" }, notReadyDetail) : null'),
		"notReadyDetail must render as ldv-settings-hint under the card head",
	);
	// 中英 locale 均提供 row.update 与 row.updateBusy。
	assert.ok(source.includes('"row.update": "更新修复"'), "LDVH_ZH must define row.update");
	assert.ok(source.includes('"row.updateBusy": "更新修复中…"'), "LDVH_ZH must define row.updateBusy");
	assert.ok(source.includes('"row.update": "Update & Repair"'), "LDVH_EN must define row.update");
	assert.ok(source.includes('"row.updateBusy": "Updating & repairing…"'), "LDVH_EN must define row.updateBusy");
});

test("betterSidebar LDVH tab registers as a soft dependency with iframe fallback states", () => {
	// 软依赖：ctx.inject 订阅服务可用性（apply 时未就绪也会等）
	// ——不能用 ctx.get 快照（加载顺序问题）；服务缺失时本插件照常工作。
	assert.ok(source.includes('ctx.inject(["betterSidebar"]'), "must subscribe via ctx.inject, not ctx.get");
	assert.ok(!source.includes('var betterSidebar = ctx.get("betterSidebar")'), "ctx.get snapshot is unreliable for late-bound services");
	// 注册形态：专属 id、single 实例、图标、iframe 指向 /ldvh/。
	assert.ok(source.includes('id: "dsh-ldvh:web"'));
	assert.ok(source.includes('single: true'));
	assert.ok(source.includes('src: ldvhFrameLocation'));
	assert.ok(source.includes('betterSidebar.registerTab'));
	// 降级：与 conversation.view 同一健康检查模式（checking/failed/retry）。
	assert.ok(source.includes('LdvhSidebarTab'));
});

test("iframe origin: loopback for the dsh-app desktop document, current origin for browser access", () => {
	// 回归守护（2026-09-25）：iframe 若用相对路径 `/ldvh/`，在 `dsh-app://app`
	// 主文档里会解析为 `dsh-app://app/ldvh/`，走宿主转发链；而宿主只在
	// `request.frame === owner.mainFrame` 时注入身份头（lib/web-document.js:20），
	// 子框架拿不到 → 403 → Tab 全白。实测报错 `GET dsh-app://app/ldvh/ 403`。
	// 故桌面场景 src 必须由绝对回环 origin 拼出；本断言锁死「不得退回相对路径」。
	//
	// 2026-10-17 扩展（远程访问缺陷，实测：局域网访问 3081 时管辖项目列表只显示
	// 访问设备本机的登记、或加载失败）：DSH Web GUI 经 http(s) 访问时（webServer
	// 0.0.0.0 监听，主文档源是 http(s)://<服务器地址>），回环 origin 指向**访问
	// 设备自己**——iframe 连到访问设备本地的 LDVH 服务。浏览器场景必须改用当前
	// origin：宿主已挂载 /ldvh 静态与 /ldvh/api 代理，同源 iframe 自动携带认证
	// cookie，读到的是服务器的登记数据。
	// origin 构造统一收口在 webFrameOrigin(port)——消费点不得各自内联判定。
	assert.ok(
		/function webFrameOrigin\(port\)/.test(source),
		"iframe origin construction must be centralized in webFrameOrigin(port)",
	);
	// 桌面场景：dsh-app: 协议 → 绝对回环 host + port（子框架 403 守护不回归）。
	assert.ok(
		/window\.location\.protocol === LDVH_APP_PROTOCOL\) return "http:\/\/127\.0\.0\.1:" \+ port/.test(source),
		"the dsh-app desktop document must keep the absolute loopback origin (subframe 403 guard)",
	);
	// 浏览器场景：http/https → 当前 origin（读到服务器的登记数据）。
	assert.ok(
		/return window\.location\.origin/.test(source),
		"browser-origin documents must build the iframe origin from the current origin",
	);
	assert.ok(
		source.includes('var ldvhFrameLocation = ldvhWebOrigin + "/ldvh/"'),
		"iframe src must be absolute (ldvhWebOrigin + path), not a bare /ldvh/ relative path",
	);
	assert.ok(
		!source.includes('var ldvhFrameLocation = "/ldvh/"'),
		"regression: a relative /ldvh/ src is what the host rejects with 403 for subframes",
	);
	// postMessage 位置记忆同样必须带上 origin，否则记回的是相对路径。
	assert.ok(
		source.includes('ldvhFrameLocation = ldvhWebOrigin + data.pathname'),
		"navigation memory must re-prefix the absolute origin",
	);
	// 端口不得只硬编码：宿主侧端口可被 LDVH_WEB_API_PORT 覆盖，须能从 health 取回。
	// 守护「端口发现」这一机制不被后续重构丢掉——只留常量即会与宿主漂移。
	assert.ok(
		source.includes('function applyWebPort(port)'),
		"the client must be able to adopt the host-reported web port",
	);
	assert.ok(
		source.includes('applyWebPort(body.webPort)'),
		"checkHealth must feed the host-reported webPort into the iframe origin",
	);
	// 健康判据两形兼容（浏览器场景命中宿主路由应答，无 success 字段）：
	// 见 client-fallback.test.mjs 的行为测试——此处只钉判据函数存在且两形都在。
	assert.ok(
		/function healthBodyOk\(body\)/.test(source),
		"the health verdict must be centralized in healthBodyOk (two response shapes)",
	);
	assert.ok(
		/body\.ok === true && body\.status === "ok"/.test(source),
		"healthBodyOk must accept the host-route shape { ok, status } (browser scenario)",
	);
});

test("chat notice row registers a self-owned node kind to escape the context filter", () => {
	// 回归守护（2026-09-25）：宿主把 `source.kind !== "user"` 的插件注入一律归为
	// `kind: "context"`，而 isVisibleChatNode() 的可见性黑名单排除 context——故
	// 注入只进轨迹、不进对话流。绕行是注册**自有 kind**（黑名单只列
	// system-prompt/context/permission），并满足 ConversationNodeDefinition 契约：
	// target 与 buildViewNode 必须成对声明，节点须 key===context.key 且 target 一致。
	// 本断言锁死这组条件，防止后续重构退回「可见但被过滤」或「契约不成立」的写法。
	assert.ok(
		source.includes('var LDVH_NOTICE_KIND = "ldvh-notice"'),
		"the notice row must use a self-owned kind, not the filtered 'context' kind",
	);
	// 只查**代码**里的注册写法，不误伤解释该机制的注释（注释里必然出现该字面量）。
	// 判据：definition 的 kind 字段必须绑到自有常量，不得直接写 "context"。
	assert.ok(
		!/kind:\s*"context"/.test(source.replace(/\/\/[^\n]*/g, '')),
		"regression: registering the definition under kind 'context' is exactly what the host hides",
	);
	// 契约：target 与 buildViewNode 成对声明（assertDefinitionTarget 会抛错）。
	assert.ok(
		/target:\s*"chat"/.test(source) && /buildViewNode:\s*function/.test(source),
		"target and buildViewNode must be declared together",
	);
	// 节点身份必须与 context 一致，否则宿主抛 unstable key。
	assert.ok(
		source.includes("key: context.key"),
		"the view node key must equal context.key (host rejects unstable keys)",
	);
	// 只认本插件注入，不劫持用户或其它插件的消息。
	assert.ok(
		source.includes('event.data.source.kind === LDVH_NOTICE_SOURCE_KIND'),
		"the definition must match only this plugin's own injected messages",
	);
	// 渲染器须注册到宿主的 keyed 槽位，key 与 kind 一致。
	assert.ok(
		source.includes('ctx.slots.inject("conversation.chat.node"'),
		"the renderer must ride the host's keyed conversation.chat.node slot",
	);
	// 注入声明：uiConversation 必须在硬注入里，否则整块注册永不执行。
	assert.ok(
		source.includes('var inject = ["slots", "locale", "uiConversation"]'),
		"uiConversation must be a hard inject, otherwise the registration never runs",
	);
});

test("Web status row exposes a single serviceIssue hint on transport failure", () => {
	// 顶部新增 serviceIssue 变量，条件为 checking / 未启用 / 正常 时为 null，仅当开关开启且探测失败时为 t("row.apiUnavailable")。
	assert.ok(
		source.includes(
			'var serviceIssue = ws.checking || !enabledState[0] || serviceOk ? null : t("row.apiUnavailable");',
		),
		"serviceIssue must be null while checking / disabled / ok, and t(row.apiUnavailable) only when switch is on and probes failed",
	);
	// 渲染为 ldv-settings-hint 行，挂在 serviceStatus 下方。
	assert.ok(
		source.includes(
			'serviceIssue ? React.createElement("span", { className: "ldv-settings-hint" }, serviceIssue) : null',
		),
		"serviceIssue must render as ldv-settings-hint span (or render null when not needed)",
	);
	// serviceStatus 必须在 serviceIssue 之前渲染，二者都在 ldv-status 容器内 —— 位置契约。
	const statusIdx = source.indexOf('className: "ldv-status"');
	assert.ok(statusIdx !== -1, "ldv-status container not found");
	const block = source.slice(statusIdx, statusIdx + 600);
	const statusOffset = block.indexOf("serviceStatus,");
	const issueOffset = block.indexOf("serviceIssue ?");
	assert.ok(statusOffset !== -1 && issueOffset !== -1, "serviceStatus / serviceIssue rendering not found in ldv-status block");
	assert.ok(statusOffset < issueOffset, "serviceStatus must render before serviceIssue inside the same ldv-status block");
});

test("LDVH_ZH and LDVH_EN both provide row.projectsUnavailable copy", () => {
	const zhFragment = '"row.projectsUnavailable": "管辖项目列表暂不可用，请先查看上方 Web 呈现状态。"';
	const enFragment = '"row.projectsUnavailable": "The governed-project list is unavailable. Check the Web presentation status above first."';
	assert.ok(source.includes(zhFragment), "LDVH_ZH must define row.projectsUnavailable");
	assert.ok(source.includes(enFragment), "LDVH_EN must define row.projectsUnavailable");
	// 行级 key 顺序不影响契约，但确认 key 没拼错（不能误把 row.apiUnavailable 重新塞回新 key）。
	assert.ok(
		!source.includes('"row.projectsUnavailable": "LDVH 服务暂不可用'),
		"row.projectsUnavailable must not reuse the row.apiUnavailable wording",
	);
});

test("web mount placements: two checkboxes gated by the master switch + refresh hint", () => {
	// 设置行读写两投放面字段，总闸关闭时复选框禁用；挂载注册读取一次性快照条件化。
	assert.ok(source.includes('convTabState') && source.includes('sidebarTabState'), "settings row keeps placement states");
	// 0.1.7 起 SettingsFormScope 没有 set(key, value)：写必须是带 revision fence 的
	// 一次原子 mutate（调研 §3.2/§3.3），且三个字段一次提交。
	// 2026-10 起写路径改为先构造 operations 数组再一次提交（参数表 driving，见
	// IDLE_LIMITS），故断言从字面量 `scope.mutate([` 改为「一次调用 + revision fence」
	// ——后者才是契约本身，前者只是当时的写法。
	assert.match(source, /scope\.mutate\(operations, snap\.revision\)/, "save must use the revision-fenced mutate of SettingsFormScope");
	assert.ok(source.includes('{ op: "set", path: ["showInConversationTab"]'), "save persists the conversation placement");
	assert.ok(source.includes('{ op: "set", path: ["showInSidebarTab"]'), "save persists the sidebar placement");
	assert.ok(!source.includes('scope.set("'), "legacy scope.set(key, value) must be gone");
	assert.ok(source.includes('checked: enabledState[0] && convTabState[0]') && source.includes('checked: enabledState[0] && sidebarTabState[0]'), "checkboxes visually checked only when master is on");
	assert.ok(source.includes('disabled: !enabledState[0]'), "checkboxes disabled when master switch is off");
	// 订阅驱动：apply 时设置可能未 ready（一次性快照会静默走默认全开——Human 实测
	// 复选框不生效的根因），必须经 ldvhScope.subscribe 在 ready/变更时应用投放开关。
	assert.ok(source.includes("ldvhScope.subscribe"), "mount placement is subscription-driven, not a one-shot snapshot");
	// 投放面不得因设置服务缺失而整体消失：先按默认全开挂上，再由订阅覆盖。
	assert.ok(source.includes("applyMountSettings({})"), "placements must mount by default before settings are known");
	assert.ok(source.includes('var sidebarOn = webOn && value && value.showInSidebarTab !== false'), "sidebar placement derived from master + checkbox");
	assert.ok(source.includes('var conversationOn = webOn && value && value.showInConversationTab !== false'), "conversation placement derived from master + checkbox");
	assert.ok(source.includes('if (sidebarOn && mountDisposers.sidebar === null)'), "sidebar tab mounts only when placement on");
	assert.ok(source.includes('else if (!sidebarOn && mountDisposers.sidebar !== null)'), "sidebar tab unmounts when placement off");
	assert.ok(source.includes('if (conversationOn && mountDisposers.conversation === null)'), "conversation tab mounts only when placement on");
	assert.ok(source.includes('else if (!conversationOn && mountDisposers.conversation !== null)'), "conversation tab unmounts when placement off");
	assert.ok(source.includes('"row.mountHint"'), "refresh hint key exists");
	assert.ok(source.includes('保存后刷新页面生效'), "LDVH_ZH mount hint states the refresh requirement");
	assert.ok(source.includes('Takes effect after saving and reloading'), "LDVH_EN mount hint states the refresh requirement");
});

test("plugin settings card hosts the project color palette (web settings page is read-only)", () => {
	// 调色板搬进插件设置卡：十色闭集 + callLdvhApi 颜色端点 + 自动取色重置。
	assert.ok(source.includes("PROJECT_COLOR_KEYS"), "palette closed set is embedded in the settings card");
	assert.ok(source.includes('callLdvhApi("/governed-projects/color"'), "palette writes go through the plugin color endpoint");
	// callLdvhApi 只发 GET/POST——颜色端点必须收 POST（PUT 曾不匹配落入代理 404，
	// 客户端空 message 经 String(error) 变成裸 "Error"）。
	assert.ok(source.includes('typeof raw === "string" ? raw : "color update failed"'), "color error extraction survives string-shaped errors");
	assert.ok(source.includes('callLdvhApi("/governed-projects/with-colors")'), "project list carries colors via with-colors endpoint");
	assert.ok(source.includes("ldv-palette-dot-active"), "explicit selection has an active ring");
	// 交互定案（Human 2026-09-08）：选中色点打勾；自动取色是排他锁——勾选后
	// 色点全部暗掉禁用（ldv-palette-dot-locked），取消勾选才恢复选色。
	assert.ok(source.includes("ldv-palette-check"), "selected dot renders a check mark");
	assert.ok(source.includes('var locked = !project.color'), "auto color locks the palette dots");
	assert.ok(source.includes("ldv-palette-dot-locked"), "locked dots dim via CSS class");
	assert.ok(source.includes("checked: !project.color"), "auto-color is a checkbox bound to absence of explicit color");
	assert.ok(source.includes('e.target.checked ? null : "emerald"'), "unchecking auto picks a color to unlock");
	// 色点必须用内联色值：--ldvh-pj-* 变量是 Web 应用 CSS 的命名空间，宿主设置卡
	// 页面没有这些变量，var() 引用会让色点透明不可见（Human 实测截图确认）。
	assert.ok(source.includes("PROJECT_COLOR_VALUES"), "palette uses inline hex values, not host-undefined CSS variables");
	assert.ok(source.indexOf("var(--ldvh-pj-") === -1, "palette never references host-undefined CSS vars");
	assert.ok(source.includes('"row.colorAuto"'), "auto-color reset button exists");
	assert.ok(source.includes('"row.projectColor"'), "project color label exists");
});

test("settings footer carries the 鼓励一下 cheer link (family-wide pattern)", () => {
	// 同族插件（dsh-sub-cli / dsh-subagent-default-model / dsh-connect-workbuddy /
	// dsh-connect-trae）在设置卡页脚左侧都有“鼓励一下 ★”外链；LDVH 对齐：
	// URL 常量指向本仓库 + zh/en row.cheer 文案 + footer-left 曝光位。
	assert.ok(
		source.includes('var LDVH_GITHUB_URL = "https://github.com/dingminhua/dsh-ldvh"'),
		"GitHub URL constant must target the dsh-ldvh repo",
	);
	assert.ok(source.includes('"row.cheer": "鼓励一下"'), "LDVH_ZH must define row.cheer");
	assert.ok(source.includes('"row.cheer": "Star on GitHub"'), "LDVH_EN must define row.cheer");
	assert.ok(source.includes('className: "ldv-settings-cheer"'), "footer renders the cheer anchor");
	assert.ok(source.includes('href: LDVH_GITHUB_URL'), "cheer anchor points at the repo constant");
	assert.ok(source.includes('target: "_blank"'), "cheer link opens in a new tab");
	assert.ok(source.includes('rel: "noopener noreferrer"'), "cheer link is noopener noreferrer");
	assert.ok(source.includes("ldv-settings-footer-left"), "cheer link sits in the footer-left container");
	assert.ok(source.includes("ldv-settings-cheer-star"), "cheer link carries the star glyph");
});

// ---------------------------------------------------------------------------
// 闲时辅助设置面（04 §8.1 / 32 §10；形态参照 dsh-mnemon 的 idleReview）
// ---------------------------------------------------------------------------

test("闲时辅助设置面：总开关 + 三个子项 + 四个参数，且总开关关闭时不渲染子项", () => {
  // 五个开关须各自成 state（而非一个数组）——它们绑定到不同的 Config 字段，
  // 且 dsh-mnemon 的形态是「总开关关掉就整块不展开」。
  for (const field of [
    "idleAssistEnabled",
    "frictionDiscoveryEnabled",
    "capacityMaintenanceEnabled",
    "memoryHealthEnabled",
  ]) {
    assert.ok(source.includes(field), `设置面须含开关字段 ${field}`);
  }
  // 子项在总开关关闭时**不渲染**（与 dsh-mnemon 同形：未启用时不给无意义的选项）。
  assert.match(
    source,
    /idleAssistState\[0\] \? React\.createElement\("div", \{ className: "ldv-web-panel-body" \}/,
    "总开关关闭时须整块不展开子项",
  );
  // 2026-10-14（11 §6.2 两次修订）：数值参数由**五个收为一个**——安静时长。
  // 第一次取消最小间隔／内容字符数／内容轮数三项；第二次取消配额上限与窗口长度
  // 两项（§6.2 收为空集）。**设置面须恰好一个参数输入框**。
  assert.ok(source.includes("idleSilenceMs"), "设置面须含安静时长");
  for (const gone of [
    "idleMinIntervalMs", "idleMinContentChars", "idleMinContentTurns",
    "idleMaxPerSession", "idleQuotaMax", "idleQuotaWindowMs",
  ]) {
    assert.ok(!source.includes(gone), `设置面不得残留已取消的参数 ${gone}`);
  }
  // **2026-10-26 起恰好两项**：安静时长（形态 1 的空窗）+ 审核间隔（形态 2 的周期）。
  //
  // 判据仍是「恰好」而非「至少」：多出第三项就意味着又悄悄加了输入框而本条没更新。
  // 但新增的必须是**时机数值**（§6.1），不得是 §6.2 的节流约束——那一点由上一条的
  // gone 列表守住（配额/最小间隔类参数名一个都不许回来）。
  const limitsTable = source.match(/var IDLE_LIMITS = \[([\s\S]*?)\];/);
  assert.ok(limitsTable, "须有参数表");
  const entries = limitsTable[1].match(/\{ key: "/g) ?? [];
  assert.equal(entries.length, 2, `设置面参数表须恰好两项（安静时长 + 审核间隔），实为 ${entries.length} 项`);
  for (const key of ["idleSilenceMs", "experienceReviewIntervalMs"]) {
    assert.ok(limitsTable[1].includes(key), `参数表须含 ${key}`);
  }
  // 审核**开关**须独立于捕获开关（Human：「这本来就是两件事……所以要分开设置」）。
  assert.ok(source.includes("experienceReviewEnabled"), "设置面须含审核开关");
  assert.ok(source.includes("row.experienceReview"), "设置面须有审核开关文案");
});

test("未实现的子项须在设置面**当场标出**（不得让开关看起来能跑）", () => {
  // capacity-maintenance 与 memory-health 的服务端实现状态是 not-implemented。
  // 开关打开后它们仍会如实回报，但设置面上不标出就是**在界面上说假话**。
  assert.match(source, /implemented: false/, "两个未实现子项须标记 implemented: false");
  assert.match(source, /implemented: true/, "已实现的子项须标记 implemented: true");
  assert.match(source, /t\("row\.notImplemented"\)/, "未实现子项须渲染「尚未实现」徽标");
  // 徽标文案须说明「仍会如实报 not-implemented」，而不只是贴一个标签。
  assert.match(source, /not-implemented/, "未实现说明须点名 not-implemented 这一实际回报");
});

test("数值参数的默认值与服务端**同源**：不得在两处各写一套", async () => {
  // 客户端默认 300000 必须与服务端 idle-settings.js 的 IDLE_DEFAULTS 一致。
  // （默认值现值 300000/5 分钟，Human 2026-10-18 改定；原 600000/10 分钟。）
  // 两处漂移会让「设置页显示 A、实际生效 B」——用户永远看不到真实值。
  // 2026-10 起默认值集中在一张表（此前散落在 state 初值里，改一处漏三处）。
  const defaults = source.match(/var IDLE_DEFAULT_STORED = \{([\s\S]*?)\};/) || [];
  assert.ok(defaults[1], "须有 IDLE_DEFAULT_STORED 表");
  for (const [key, value] of [["idleSilenceMs", 300000]]) {
    assert.match(defaults[1], new RegExp(`${key}: ${value}`), `客户端默认 ${key} 须为 ${value}`);
  }

  // 与服务端文件逐字比对（真同源，不只是「我抄对了」）。
  const server = await readFile(new URL("../lib/idle-settings.js", import.meta.url), "utf8");
  for (const [key, expected] of [["silenceMs", "300_000"]]) {
    assert.ok(server.includes(`${key}: ${expected},`), `服务端 IDLE_DEFAULTS.${key} 须为 ${expected}`);
  }
});

test("参数非法时**不写入**（不得把非法值送进宿主再被静默回落）", () => {
  // 服务端 readNumber 把「NaN / 负 / 非有限」回落默认值——那会让用户看到的数
  // 与生效值不一致。故客户端必须在写入前拦住，并如实报失败。
  //
  // 注意判据**不是「非负整数」**：服务端接受任何非负有限数（含小数），故客户端
  // 也不能凭空收紧。真正的判据是「按 scale 换算后能原样还原」——见下一条。
  assert.match(source, /function idleLimitOk\(text, scale\)/, "须有合法性判定（带 scale）");
  assert.match(source, /if \(!idleLimitsAllOk\(idleLimitsState\[0\]\)\) \{\s*saveErrorState\[1\]\(true\);\s*return;\s*\}/, "非法时须拦下写入并报失败");
});

test("时间参数以**分钟**读写，存储仍是毫秒（scale 单一来源，不得两处各写一套）", () => {
  // 界面按分钟、存储按毫秒。两者由 IDLE_LIMITS 的 scale 单向决定，
  // 不得在 UI 那一处再写一套换算（否则改单位时会漏改一处）。
  assert.match(source, /var IDLE_LIMITS = \[/, "须有参数表");
  // 条目还可带 `hintKey`（设置面的解释词条，见本文件末的可读性用例），故只钉 key 与 scale。
  assert.match(source, /\{ key: "idleSilenceMs", scale: 60000/, "安静时长 scale 须为 60000（分钟↔毫秒）");
  // 标签须写明单位是分钟（不得仍写「毫秒」）。
  assert.match(source, /"row\.idleSilenceMs": "安静时长（分钟）"/, "中文标签单位须为分钟");
  assert.match(source, /"row\.idleSilenceMs": "Silence duration \(minutes\)"/, "英文标签单位须为分钟");
  assert.doesNotMatch(source, /idleSilenceMs": "[^"]*毫秒"/, "不得残留毫秒标签");
  // UI 循环须走参数表，不得再内联一份 key/label 清单。
  assert.match(source, /IDLE_LIMITS\.map\(function \(limit\) \{/, "UI 须遍历参数表");
});

test("换算判据是**往返回损**，而非「必须是整数」（不得凭空收紧服务端口径）", () => {
  // 服务的 readNumber 接受任何非负有限数，含小数。客户端若只允许整数，就是
  // 凭空收紧——用户输入一个服务端本来接受的值却被界面拒绝，且无从知道原因。
  assert.match(source, /function idleLimitToStored\(text, scale\)/, "须有换算函数");
  assert.match(source, /if \(Number\(idleLimitToText\(stored, scale\)\) !== n\) return undefined;/, "须做往返回损检查");
  // 该判据不得写成「n 必须是整数」——那是收紧。
  assert.doesNotMatch(source, /Number\.isInteger\(n\) && n >= 0\) return undefined;\s*\n\s*var stored/, "不得把「输入是整数」当判据");
  // 非时间参数（scale=1）下，小数仍会被拦——但理由是无损性（800.5 字不成立），
  // 不是「禁止小数」。两条断言并存即说明该判据是通用的。
  assert.match(source, /if \(!Number\.isInteger\(stored\) \|\| stored < 0\) return undefined;/, "仍须拒绝换算出非整数的值");
});

test("参数区**不再**承载「数值属实现侧承接」声明——该声明改由代码注释与规范承载", () => {
  // ## 本条为何从「须有」翻转为「须无」
  //
  // 原断言要求设置面上有 `row.idleLimitsPending` 文案（「安静时长的数值属实现侧
  // 承接（11 §6.1）……不得据此主张规范已规定该时长」）。2026-10-14 Human 指示
  // **删除该句**（连同「编辑后需点保存生效」一句）。
  //
  // **删除不等于放弃该声明**——它只是**换了承载处**。原位置属错置：那是一句
  // 对 AI/读者的**规范地位声明**，不是给设置的人的操作提示；放在设置界面上，
  // Human 每次调参数都要读一句与自己无关的告诫，而真正会误读的是写代码的人。
  //
  // 故本条的判据改为**检验声明仍在且已落到正确承载处**：
  assert.doesNotMatch(source, /row\.idleLimitsPending/, "设置面不得再有该声明文案");
  assert.doesNotMatch(source, /idleLimitsHint/, "「编辑后需点保存生效」亦须删除（改由按钮态自明）");
  // 声明本体须落在**代码注释**里（规范正文另有 11 §6.1「数值属实现侧承接」）。
  assert.match(
    source,
    /数值属实现侧承接/,
    "该声明须仍存在于本文件的代码注释中（换了承载处，不是删除）",
  );
  assert.match(source, /11 §6\.1/, "代码注释须点名依据条款");
});

test("设置面：改动后**保存按钮自身**须显示为「需要保存」（不得只靠一行文字提示）", () => {
  // Human 2026-10-14：「修改后需要保存按钮显示为需要保存」。原设计只有一行
  // 文字提示，而文字要在读者看见时才起作用；按钮是**操作发生处**，状态落在那里。
  assert.match(source, /"row\.saveDirty":/, "须有「有未保存改动」的按钮文案");
  assert.match(source, /"row\.saveDirtyAria":/, "须有对应的无障碍文案（供读屏）");
  assert.match(
    source,
    /busyState\[0\] \? t\("row\.saving"\) : \(dirtyState\[0\] \? t\("row\.saveDirty"\) : t\("row\.save"\)\)/,
    "按钮文案须随 dirtyState 切换",
  );
  // **三重表达**：文案 + 类名 + aria。不只靠颜色——色觉障碍与高对比主题下
  // 颜色可能不可辨，故须另有形状变化（描边/字重，见 .ldv-btn-dirty）。
  assert.match(source, /ldv-btn-dirty/, "dirty 时须有独立的样式类");
  assert.match(
    source,
    /\.ldv-btn-dirty\{font-weight:600/,
    "该类须含**不依赖颜色**的变化（此处为字重），否则色觉障碍下不可辨",
  );
  // 状态与可操作性须一致：无改动时按钮仍不可点（避免「亮着但点了没反应」）。
  assert.match(source, /var saveDisabled = [^;]*!dirtyState\[0\]/, "无改动时保存须不可点");
});

// ---------------------------------------------------------------------------
// 三处默认值不得漂移（2026-10-11 实测缺陷：判据侧默认被架空）
// ---------------------------------------------------------------------------
//
// ## 缺陷经过
//
// 默认配额上限同时声明在**三处**：`index.js` 的 zod schema、`idle-settings.js` 的
// `IDLE_DEFAULTS`、`client.js` 的 `IDLE_DEFAULT_STORED`。复审 D7 把「窗口内可达」
// 定为选值硬约束（1 小时窗口 ÷ 当时 10 分钟的安静时长 ⇒ 最多 6 次可达，上限取 8
// 则**永不绑定**），于是判据侧改成了 4。
//
// 注：该推导的分母**后来又变了**——安静时长于 2026-10-18 由 10 分钟改定为 5 分钟，
// 按同一算式可达上限升至 12，8 仍不绑定，**结论不动**。但「最小间隔」一类约束已于
// 2026-10-14 由 11 §6.2 取消（被 §6.1 安静时长结构性吸收），故这个算式如今只剩
// **历史依据**的意义：现行容量由 `FALLBACK_MAX_DISPATCH_TIMES` 具名常量直接给出
// （`plugin/lib/friction-watermark.js`），不再按窗口÷间隔推导。
//
// **但 zod schema 仍是 8。** 而生产路径读的是**它**——宿主按 zod 的 default 把 8
// 填进 `config`，`resolveIdleSettings` 便永远读到 8，判据侧那个 4 **从未生效**。
// 实测痕迹里 `quota.max` 恒为 8 即此。
//
// 既有守卫只比对 `client.js` 与硬编码值，**没有跨文件比对 zod 与判据侧**，故漏掉。
// 本条补上该缺口——三处必须同值。

test("默认值三处一致：index.js 的 zod default ≡ idle-settings 的 IDLE_DEFAULTS ≡ client.js", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

  const indexSrc = await read("../lib/index.js");
  const settingsMod = await import("../lib/idle-settings.js");
  const clientSrc = await read("../lib/client.js");

  // ① 判据侧的真值（运行时导出，最权威）
  const d = settingsMod.IDLE_DEFAULTS;

  // ② index.js 的 zod default —— 生产路径实际用它填 config
  const zod = {};
  for (const key of ["idleSilenceMs"]) {
    // 数字**带下划线分隔**（如 `600_000`）——正则须容忍，否则守卫自身失效。
    // `idleSilenceMs` 另带 `.min(1)`（11 §6.1 的写入侧下界约束），故正则须容忍
    // 「链式方法（含带参的 min/max）再 .default(...)」。
    const m = indexSrc.match(new RegExp(`${key}:\\s*volatileField\\(z\\.number\\(\\)(?:\\.[a-z]+\\([^)]*\\))*\\.default\\(([\\d_]+)\\)\\)`));
    assert.ok(m, `index.js 须以 zod default 声明 ${key}`);
    zod[key] = Number(m[1].replace(/_/g, ""));
  }

  // ③ client.js 的界面缺省（存储单位）
  const storedBlock = clientSrc.match(/var IDLE_DEFAULT_STORED = \{([\s\S]*?)\};/);
  assert.ok(storedBlock, "client.js 须有 IDLE_DEFAULT_STORED 表");
  const stored = {};
  for (const m of storedBlock[1].matchAll(/(\w+):\s*(\d+)/g)) stored[m[1]] = Number(m[2]);

  // 配置键（zod / 界面）与判据键（IDLE_DEFAULTS）**名字不同**：前者带 `idle` 前缀
  // 且描述的是「设置项」，后者是判据层的内部名。映射写在这里而不是靠命名巧合——
  // 缺失映射会使断言比较 undefined 与数值，报出一个与真因无关的错。
  const JUDGE_KEY = { idleSilenceMs: "silenceMs" };

  // 三者逐一比对——任一不同即判据与生产不一致，而非「风格问题」。
  for (const [key, judgeKey] of Object.entries(JUDGE_KEY)) {
    assert.ok(judgeKey in d, `IDLE_DEFAULTS 须含判据键 ${judgeKey}`);
    assert.equal(
      zod[key],
      d[judgeKey],
      `index.js 的 zod default（${zod[key]}）与判据侧 IDLE_DEFAULTS.${judgeKey}（${d[judgeKey]}）不一致——` +
      `生产路径读 zod，判据侧的默认值会被架空（2026-10-11 实测缺陷）`,
    );
    assert.equal(
      stored[key],
      d[judgeKey],
      `client.js 的界面缺省（${stored[key]}）与判据侧 IDLE_DEFAULTS（${d[judgeKey]}）不一致`,
    );
  }
});

// ---------------------------------------------------------------------------
// 设置面的**可读性**约定（Human 2026-10-14 明确要求）
// ---------------------------------------------------------------------------

test("设置面：安静时长须有**一句话解释**，且该解释不得与实现语义相悖", () => {
  // Human 原话：「什么是安静时长一句话解释清楚」。故该参数须带一条 hint 词条
  // （不是只靠标签），且 hint 的**语义**须与 11 §6.1 的实现一致。
  assert.match(source, /hintKey: "row\.idleSilenceMsHint"/, "参数表须登记其解释词条");
  const zh = (source.match(/"row\.idleSilenceMsHint": "([^"]+)"/) || [])[1];
  assert.ok(zh, "须有中文解释词条");
  // 语义锚点：必须点明「距最后一次活动」（而非「距上次派发」）——这正是 §6.1 的判据，
  // 也是本次修订纠正的那个偏离。缺之则解释会把人引回旧语义。
  assert.ok(/对话/.test(zh) && /安静/.test(zh), "须说清「对话停了多久」这件事");
  assert.ok(/重新开始|重来|重置/.test(zh), "须说明「有新活动就重新计时」（否则会被读成固定间隔）");
  // 不得出现与实现相悖的表述：现实现为「一次安静期至多触发一次」。
  assert.ok(!/每隔|每过|定期/.test(zh), "不得写成固定周期的定时任务——实现是「停下来才跑」");
});

test("设置面：标签与输入框须在**同一行**，且输入框**不得**收进折叠区", () => {
  // Human 原话：「和填写框放在一行，且直接显示出来」。
  assert.match(source, /className: "ldv-idle-limit-row"/, "标签与输入须同处一个行容器");
  assert.match(source, /\.ldv-idle-limit-row\{display:flex;align-items:center/, "该行容器须为 flex 行");
  // **不得**再用 <details> 折叠（唯一一个参数没有折叠的理由）。
  assert.doesNotMatch(
    source,
    /React\.createElement\("details", \{ className: "ldv-idle-limits"/,
    "参数区不得折叠——直接展示",
  );
  // 也不得残留只对旧折叠形态有意义的样式或结构。
  assert.doesNotMatch(source, /ldv-idle-limit-grid/, "旧的网格容器须一并移除");
});

// ---------------------------------------------------------------------------
// 宿主提问卡（Human Gate 落点）观感覆写
// ---------------------------------------------------------------------------

/** 求值 client.js 里的 GATE_CSS 字面量，得到**实际下发的** CSS 文本。
 *  断言必须打在求值结果上而不是源码片段上：字符串拼接的产物与源码里的片段
 *  不是一回事（漏一个 `+` 或引号转义错位，源码看着对、下发的是坏 CSS）。 */
function gateCssText() {
  const start = source.indexOf("var GATE_CSS = ");
  assert.ok(start >= 0, "GATE_CSS 常量须存在");
  const body = start + "var GATE_CSS = ".length;
  // 语句终止符取 `;` + 换行：CSS 串内不出现裸 `;\n`（每条声明以 `}"` 收尾），
  // 而按 `"}` 或 `";` 找都会落进串内——实测停在 `transition:none!important;` 上，
  // 截出半条语句，vm 求值抛 SyntaxError。
  const end = source.indexOf(";\n", body);
  assert.ok(end > body, "GATE_CSS 字面量须有结束位置");
  return vm.runInNewContext(`(${source.slice(body, end)})`);
}

test("提问卡覆写以独立 style 卡下发，可单独摘除", () => {
  assert.match(source, /\["dsh-ldvh\/client\.css", SETTINGS_CSS\]/, "本插件自有面须为一张");
  assert.match(source, /\["dsh-ldvh\/gate\.css", GATE_CSS\]/, "宿主观感覆写须单独一张");
  assert.match(source, /cssSheets\.length/, "两张卡须由同一循环装载");
});

test("提问卡覆写**零 `!important`**（唯一例外：reduced-motion 的撤销）", () => {
  const css = gateCssText();
  const offenders = css.split("}").filter((block) => block.includes("!important") && !/prefers-reduced-motion/.test(block));
  assert.deepEqual(offenders, [], `不得用 !important 压宿主（特异性靠 [data-question-key] 根抬）：${offenders.join(" | ")}`);
});

test("提问卡覆写的每条规则都锚在 `[data-question-key]` 上", () => {
  const css = gateCssText();
  const selectors = [...css.matchAll(/(^|[}\n])\s*([^@{}\n][^{]*)\{/g)].map((m) => m[2].trim());
  assert.ok(selectors.length >= 20, `规则数异常（解析到 ${selectors.length} 条），先修断言再谈通过`);
  const loose = selectors.filter((sel) => sel !== "@media" && !sel.startsWith("[data-question-key]"));
  assert.deepEqual(loose, [], `未锚定的选择器会波及宿主其它表面：${loose.join(" | ")}`);
});

test("选择器命中**局部类名子串**，不得依赖构建期哈希的 `_` 边界", () => {
  const css = gateCssText();
  // 宿主 CSS module 打包后形如 `22xwLW_frame`：哈希前缀长度不定，`_frame` 只在
  // 未打包的 dev 构建里成立。写成 `[class*="_frame"]` 等于把覆写绑死在构建形态上。
  assert.doesNotMatch(css, /\[class\*="_/, "子串选择器不得带下划线前缀");
  assert.ok(/\[class\*="eyebrow"\]/.test(css), "局部名子串口径须在（丢了即整卡失焦）");
});

test("颜色与圆角全部走宿主 token，不硬编码色值", () => {
  const css = gateCssText();
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "不得出现十六进制色值（浅/深主题须自动跟随）");
  assert.ok(/var\(--dsw-alias-state-business-primary\)/.test(css), "强调色须取宿主语义 token");
});

test("只改观感：不得出现接管行为或隐藏内容的声明", () => {
  const css = gateCssText();
  assert.doesNotMatch(css, /pointer-events\s*:/, "不得接管指针事件（答复通道属宿主）");
  assert.doesNotMatch(css, /display\s*:\s*none/, "不得抽掉元素——页脚是 space-between，抽掉整组会让按钮横向抖动");
  assert.ok(/visibility:hidden/.test(css), "单题 pager 用 visibility 隐藏（保留占位，理由见源码注释）");
});

test("召回预算档位：客户端选项须与服务端 INJECTION_BUDGET_TIERS **同源**", async () => {
  // 与 IDLE_DEFAULT_STORED 同一纪律：两处各写一套必然漂移，漂移后「设置页选
  // 20K、实际生效 10K」，而用户永远看不到真实值。
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const serverSrc = await readFile(join(import.meta.dirname, "..", "lib", "source-recall.js"), "utf8");

  // 1) 客户端选项表须存在且列出 10/20/30/40/50。
  const opts = source.match(/var INJECTION_BUDGET_TIER_OPTIONS = \[([^\]]+)\]/);
  assert.ok(opts, "客户端须有 INJECTION_BUDGET_TIER_OPTIONS 表");
  const clientTiers = opts[1].split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  assert.deepEqual(clientTiers, [10, 20, 30, 40, 50], "客户端档位选项须为 10/20/30/40/50");

  // 2) 服务端档位键须与客户端**逐个一致**（同源，不只是抄对）。
  const serverTiers = [...serverSrc.matchAll(/^ {2}(\d+): \d+ \* 1024,$/gm)].map((m) => Number(m[1]));
  assert.deepEqual(clientTiers, serverTiers, "客户端选项须与服务端 INJECTION_BUDGET_TIERS 的键逐个一致");

  // 3) 默认档须一致。
  const clientDefault = source.match(/var INJECTION_BUDGET_TIER_DEFAULT = (\d+);/);
  assert.ok(clientDefault, "客户端须有 INJECTION_BUDGET_TIER_DEFAULT");
  const serverDefault = serverSrc.match(/export const DEFAULT_INJECTION_BUDGET_TIER = (\d+);/);
  assert.ok(serverDefault, "服务端须有 DEFAULT_INJECTION_BUDGET_TIER");
  assert.equal(Number(clientDefault[1]), Number(serverDefault[1]), "两端默认档须一致");

  // 4) 设置面须真的渲染该控件（不是只有状态没有 UI）。
  assert.match(source, /t\("row\.injectionBudgetTier"\)/, "须渲染档位控件标签");
  assert.match(source, /path: \["injectionBudgetTier"\]/, "保存时须提交该字段");
});

// ── 审核模型：两级联动下拉（2026-10-26 Human 指定参考 dsh-subagent-default-model）──

test("审核模型用**下拉**选择，不是手打文本框", () => {
  // Human 的反馈是「参考 subagent-default-model 的做法」——那套做法的要点是
  // 「从宿主模型目录拉选项」。手打文本框的问题不是好不好用，而是**错误可被机械
  // 消除却留给了人工**：拼错 provider 或 model 就变成「设了不生效」，而界面上
  // 看不出任何异常。
  assert.match(
    source,
    /row\.experienceReviewModel/,
    "审核模型的行须存在",
  );
  // 取目录的方式：remote.session.modelCatalog（与参考实现一致）。
  assert.ok(
    source.includes("modelCatalog"),
    "须从宿主的 modelCatalog 取模型目录——那是唯一权威来源",
  );
  // 必须有「跟随默认」的空选项：留空 = 不指定，这条语义不能丢。
  assert.ok(
    source.includes("row.experienceReviewModelInherit"),
    "须有「跟随默认」选项（空值 = 沿用宿主默认路由）",
  );
  // 两级联动：provider 与 model 各一个下拉。
  assert.ok(source.includes("row.experienceReviewProvider"), "须有 provider 级选择");
  assert.ok(source.includes("row.experienceReviewModelName"), "须有 model 级选择");
});

test("模型目录异步就绪：须有界重试，且空目录时如实说明（不静默显示为空下拉）", () => {
  // `remote.session` 由异步的 `remote.$mount()` 装配，单次探测会拿到空目录，
  // 表现是「下拉里只有『跟随默认』一项」——与「宿主确实没有任何 provider」外观
  // 相同，用户无从分辨。故须重试，且耗尽后如实提示。
  assert.ok(
    /MAX_ATTEMPTS\s*=\s*\d+/.test(source),
    "须有重试次数上限（有界，不得无限轮询）",
  );
  assert.ok(
    source.includes("row.experienceReviewCatalogEmpty"),
    "目录为空时须如实提示——空下拉会被误读为「没有模型」",
  );
});

test("已保存但不在目录里的模型须仍能显示（否则下拉落到第一项，看着像设置丢了）", () => {
  // 用户设了某模型、之后该模型下线：目录里就没有它了。若直接按目录渲染，
  // select 的 value 匹配不到任何 option，浏览器会显示第一项（「跟随默认」）——
  // 用户会以为自己的设置被清掉了。实际是「设了但当前不可用」，两件事外观相同、
  // 处置完全不同。故须把已保存值补进选项。
  assert.match(
    source,
    /reviewSelectedProvider/,
    "须把已保存值补进 provider 选项",
  );
  assert.match(
    source,
    /reviewSelectedModel/,
    "须把已保存值补进 model 选项",
  );
  // 补进去的那一项必须是从已保存值构造的（而不是从目录）。
  assert.ok(
    /providers\s*=\s*\[\{\s*id:\s*reviewSelectedProvider/.test(source) ||
      /models\s*=\s*\[\{\s*id:\s*reviewSelectedModel/.test(source),
    "已保存值须被显式构造为选项（否则它匹配不到任何 option）",
  );
});
