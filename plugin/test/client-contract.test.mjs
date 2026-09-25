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
		'LDVH_ROW_CONFIG_KEY',
	]) assert.ok(source.includes(fragment), `missing WorkBuddy card fragment: ${fragment}`);
});

test("uses the WorkBuddy client registration and degradation pattern", () => {
	// Governance marks removed (Human 2026-09-04: the context-injection row
	// supersedes both UI marks), so inject shrinks back to the WorkBuddy
	// baseline: no uiConversation needed without the ldvh-scope-claim
	// event definition.
	// 0.1.7 变更（调研 §3.3）：settingsScope 服务已删除，硬注入它会让整个客户端
	// 插件永不 apply——因此 inject 里不得再出现它；设置面改走 configForms 软注入。
	assert.ok(source.includes('var inject = ["slots", "locale"]'));
	assert.ok(!source.includes('var inject = ["slots", "locale", "settingsScope"]'), "settingsScope must not be hard-injected (service removed in 0.1.7)");
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
	assert.ok(source.includes('scope.mutate(['), "save must use the revision-fenced mutate of SettingsFormScope");
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
