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
	// Governance marks removed (Human 2026-09-04: the context-injection row
	// supersedes both UI marks), so inject shrinks back to the WorkBuddy
	// baseline: no uiConversation needed without the ldvh-scope-claim
	// event definition.
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
	assert.ok(source.includes('src: "/ldvh/"'));
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
