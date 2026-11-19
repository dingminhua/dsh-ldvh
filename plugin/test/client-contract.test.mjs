import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");

test("plugin-page card shell is gone with its styles (config lives in Settings only)", () => {
	for (const fragment of [
		'.ldv-settings-card{border:1px solid',
		'.ldv-settings-card-open{',
		'.ldv-settings-card-header{appearance:none',
		'.ldv-settings-card-icon{width:32px;height:32px',
		'.ldv-settings-card-body{border-top:1px solid',
		'LDVH_ROW_CONFIG_KEY',
	]) assert.ok(!source.includes(fragment), `plugin-page card remnant must be gone: ${fragment}`);
});

test("uses the WorkBuddy client registration and degradation pattern", () => {
	assert.ok(source.includes('var inject = ["slots", "locale"]'));
	assert.ok(!source.includes('"uiConversation"'), "uiConversation lost its only consumer (ldvh-notice) and must not be hard-injected");
	assert.ok(!source.includes('LdvhGovernanceMark'), "the 2026-09-04 UI marks must stay removed");
	assert.ok(!source.includes('LdvhHeaderMark'), "the 2026-09-04 UI marks must stay removed");
	assert.ok(!source.includes('var inject = ["slots", "locale", "settingsScope"]'), "settingsScope must not be hard-injected (service removed in 0.1.7)");
	assert.ok(!source.includes('var inject = ["slots", "locale", "uiConversation", "settingsScope"]'), "settingsScope must not be hard-injected (service removed in 0.1.7)");
	assert.ok(source.includes('ctx.inject(["configForms"]'), "settings transport must be a soft configForms injection");
	assert.ok(source.includes('ctx.effect(function ()'));
	assert.ok(source.includes('ctx.locale.register(LDVH_NS, { zh: LDVH_ZH, en: LDVH_EN })'));
	assert.ok(source.includes('ctx.locale.bind(LDVH_NS)'));
	assert.ok(source.includes('slots.inject("settings.section"'), "configuration lives in the Settings panel only");
	assert.ok(!source.includes('slots.inject("plugins.bundle.config"'), "the bundle-card seat must stay removed");
	assert.ok(!source.includes('slots.inject("plugins.row.config"'), "the row-card seat must stay removed");
	assert.ok(!source.includes('function LdvhSettingsCard'), "the collapsible plugin-page card must be gone");
	assert.ok(!source.includes('var openState = React.useState(true)'), "no collapse state remains without a card");
	assert.ok(!source.includes('name: "settings.plugin.item"'), "must not register into the removed settings.plugin.item slot");
	assert.ok(source.includes('console.error("[dsh-ldvh] client UI failed to load'));
	assert.ok(!source.includes('"connection"]'), "settings card must not inject unused connection service");
});

test("resolves the served settings namespace instead of assuming the bare id", () => {
	assert.ok(source.includes('function ldvhEntryIdOf(forms)'), "must probe the served namespace from the configForms mirror");
	assert.ok(source.includes('forms.describe().getSnapshot().view'), "probe reads the served-namespace directory from the mirror");
	assert.ok(source.includes('entry.ns === LDVH_ENTRY_ID || /ldvh/i.test(entry.ns || "")'), "probe accepts the declared id or a package-name substring");
	assert.ok(!source.includes('configForms.get(LDVH_ENTRY_ID)'), "must not call get() with the bare declared id — bind the probed ns instead");
	assert.ok(source.includes('configForms.get(ldvhEntryIdOf(formsCtx.configForms))'), "both bind sites must go through the resolver");
});

test("uses the real package icon and leaves no chevron probe behind", () => {
	assert.ok(source.includes('data:image/png;base64,'));
	assert.ok(!source.includes('primitives.IconChevronDownOutlineRegular'), "the chevron probe has no consumer left");
	assert.ok(source.includes('typeof iconProps.size === "number"'), "nav icon must fall back to a default edge");
});

test("provides accessible nav labels for the settings section (no card collapse chrome left)", () => {
	assert.ok(source.includes('"row.title": "LDVH"'), "nav label must be the short brand name");
	assert.ok(!source.includes('"row.title": "LD Vibe Harness'), "nav label must not carry the long form (it gets clipped)");
	assert.ok(source.includes('label: function () { return t("row.title"); }'), "nav row must have a human label");
	assert.ok(!source.includes('"aria-label": t(openState[0] ? "row.collapse" : "row.expand")'));
});

test("loadProjects catch demotes transport failures to unavailable: true (no error text)", () => {
	assert.ok(
		source.includes("error: isTransport ? null : message, unavailable: isTransport"),
		"loadProjects catch must write error: null and unavailable: true on transport failure",
	);
	const catchStart = source.indexOf(".catch(function (error) {");
	assert.ok(catchStart !== -1, "loadProjects catch block not found");
	const catchEnd = source.indexOf("});", catchStart);
	assert.ok(catchEnd !== -1, "loadProjects catch terminator not found");
	const catchBody = source.slice(catchStart, catchEnd);
	assert.ok(
		!catchBody.includes('"row.apiUnavailable"'),
		"loadProjects catch must not surface row.apiUnavailable (cause already explained in the Web status row)",
	);
	assert.ok(
		catchBody.includes("isTransport"),
		"loadProjects catch must keep the isTransport transport-failure classification",
	);
});

test("chooseProject uses the desktop pick-bridge ladder with visible failures", () => {
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
	assert.ok(
		source.includes('? React.createElement("span", { className: "ldv-settings-hint" }, t("row.projectsUnavailable"))'),
		"unavailable branch must render ldv-settings-hint + row.projectsUnavailable",
	);
	const unavailableIdx = source.indexOf("projectsState[0].unavailable");
	assert.ok(unavailableIdx !== -1, "projectsState.unavailable guard not found");
	const errorIdx = source.indexOf("projectsState[0].error", unavailableIdx);
	assert.ok(errorIdx !== -1, "domain error guard not found");
	const unavailableBranch = source.slice(unavailableIdx, errorIdx);
	assert.ok(
		!unavailableBranch.includes("ldv-governance-error"),
		"unavailable branch must not render ldv-governance-error (that would be the duplicate we are deleting)",
	);
	assert.ok(
		!unavailableBranch.includes("ldv-governance-empty-title"),
		"unavailable branch must not pretend the project list is empty",
	);
});

test("domain-error red box (ldv-governance-error) is reserved for non-transport errors", () => {
	const errorBranchFragment =
		': (projectsState[0].error\n            ? React.createElement("div", { className: "ldv-governance-error", role: "alert" }, projectsState[0].error)';
	assert.ok(
		source.includes(errorBranchFragment),
		"domain error branch must still render ldv-governance-error with role=alert",
	);
	for (const op of ["inspectProject", "updateProject", "unregisterGovernance"]) {
		assert.ok(
			source.includes(op),
			`op handler ${op} must exist (sanity)`,
		);
	}
	assert.ok(
		source.includes("error: String(error.message || error), unavailable: false"),
		"non-transport failures (inspect/update/unregister) must still write error text + unavailable: false",
	);
});

test("project card actions: uninstall removed, Update only when repairable, notReadyDetail hint", () => {
	assert.ok(
		!source.includes("uninstallProjectHook"),
		"client must not reference the removed uninstallProjectHook",
	);
	assert.ok(
		!source.includes('"row.uninstall"'),
		"locale key row.uninstall must be removed with the uninstall button",
	);
	assert.ok(
		source.includes('["absent", "outdated"].includes(hook.state)'),
		"repairable must treat absent/outdated Hook states as fixable",
	);
	assert.ok(
		source.includes('["absent", "incomplete"].includes(factSource.state)'),
		"repairable must treat absent/incomplete fact source states as fixable",
	);
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
	assert.ok(source.includes('"row.update": "更新修复"'), "LDVH_ZH must define row.update");
	assert.ok(source.includes('"row.updateBusy": "更新修复中…"'), "LDVH_ZH must define row.updateBusy");
	assert.ok(source.includes('"row.update": "Update & Repair"'), "LDVH_EN must define row.update");
	assert.ok(source.includes('"row.updateBusy": "Updating & repairing…"'), "LDVH_EN must define row.updateBusy");
});

test("betterSidebar LDVH tab registers as a soft dependency with iframe fallback states", () => {
	assert.ok(source.includes('ctx.inject(["betterSidebar"]'), "must subscribe via ctx.inject, not ctx.get");
	assert.ok(!source.includes('var betterSidebar = ctx.get("betterSidebar")'), "ctx.get snapshot is unreliable for late-bound services");
	assert.ok(source.includes('id: "dsh-ldvh:web"'));
	assert.ok(source.includes('single: true'));
	assert.ok(source.includes('src: ldvhFrameLocation'));
	assert.ok(source.includes('betterSidebar.registerTab'));
	assert.ok(source.includes('LdvhSidebarTab'));
});

test("iframe origin: loopback for the dsh-app desktop document, current origin for browser access", () => {
	assert.ok(
		/function webFrameOrigin\(port\)/.test(source),
		"iframe origin construction must be centralized in webFrameOrigin(port)",
	);
	assert.ok(
		/window\.location\.protocol === LDVH_APP_PROTOCOL\) return "http:\/\/127\.0\.0\.1:" \+ port/.test(source),
		"the dsh-app desktop document must keep the absolute loopback origin (subframe 403 guard)",
	);
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
	assert.ok(
		source.includes('ldvhFrameLocation = ldvhWebOrigin + data.pathname'),
		"navigation memory must re-prefix the absolute origin",
	);
	assert.ok(
		source.includes('function applyWebPort(port)'),
		"the client must be able to adopt the host-reported web port",
	);
	assert.ok(
		source.includes('applyWebPort(body.webPort)'),
		"checkHealth must feed the host-reported webPort into the iframe origin",
	);
	assert.ok(
		/function healthBodyOk\(body\)/.test(source),
		"the health verdict must be centralized in healthBodyOk (two response shapes)",
	);
	assert.ok(
		/body\.ok === true && body\.status === "ok"/.test(source),
		"healthBodyOk must accept the host-route shape { ok, status } (browser scenario)",
	);
});

test("chat context injection row is left to the host (no self-owned row)", () => {
	const code = source.replace(/\/\/[^\n]*/g, '');
	assert.ok(
		!code.includes("ldvh-notice"),
		"regression: a self-owned notice kind duplicates the host's native context row",
	);
	assert.ok(
		!code.includes("LDVH_NOTICE_KIND") && !code.includes("registerLdvhNotice"),
		"regression: the retired notice definition/renderer must not come back",
	);
	assert.ok(
		!code.includes('ctx.slots.inject("conversation.chat.node"'),
		"regression: the plugin must not claim a conversation.chat.node key any more",
	);
	assert.ok(
		!code.includes('"uiConversation"'),
		"regression: uiConversation has no remaining consumer and must not be hard-injected",
	);
	assert.ok(
		source.includes('var inject = ["slots", "locale"]'),
		"the hard inject list should be the minimal slots+locale pair",
	);
});

test("Web status row exposes a single serviceIssue hint on transport failure", () => {
	assert.ok(
		source.includes(
			'var serviceIssue = ws.checking || !webOn || serviceOk ? null : t("row.apiUnavailable");',
		),
		"serviceIssue must be null while checking / disabled / ok, and t(row.apiUnavailable) only when web is on and probes failed",
	);
	assert.match(
		source,
		/serviceIssue \? React\.createElement\("(?:span|div)", \{ className: "ldv-settings-hint[^"]*" \}, serviceIssue\) : null/,
		"serviceIssue must render as a ldv-settings-hint element (or render null when not needed)",
	);
	const headIdx = source.indexOf('cardHead("services", "group.services"');
	const statusIdx = source.indexOf("serviceStatus,");
	const issueIdx = source.indexOf("serviceIssue ?");
	assert.ok(headIdx !== -1 && statusIdx !== -1 && issueIdx !== -1,
		"status readout / serviceIssue rendering not found");
	assert.ok(headIdx < statusIdx, "状态读数须在卡头渲染（与组名同一行；总开关已于第十三轮撤除）");
	assert.ok(statusIdx < issueIdx, "状态读数须排在故障说明之前");
});

test("LDVH_ZH and LDVH_EN both provide row.projectsUnavailable copy", () => {
	const zhFragment = '"row.projectsUnavailable": "管辖项目列表暂不可用，请先查看上方 Web 呈现状态。"';
	const enFragment = '"row.projectsUnavailable": "The governed-project list is unavailable. Check the Web presentation status above first."';
	assert.ok(source.includes(zhFragment), "LDVH_ZH must define row.projectsUnavailable");
	assert.ok(source.includes(enFragment), "LDVH_EN must define row.projectsUnavailable");
	assert.ok(
		!source.includes('"row.projectsUnavailable": "LDVH 服务暂不可用'),
		"row.projectsUnavailable must not reuse the row.apiUnavailable wording",
	);
});

test("web mount placements: two checkboxes gated by the master switch + refresh hint", () => {
	assert.ok(source.includes('convTabState') && source.includes('sidebarTabState'), "settings row keeps placement states");
	assert.match(source, /scope\.mutate\(operations, snap\.revision\)/, "save must use the revision-fenced mutate of SettingsFormScope");
	assert.ok(source.includes('{ op: "set", path: ["showInConversationTab"]'), "save persists the conversation placement");
	assert.ok(source.includes('{ op: "set", path: ["showInSidebarTab"]'), "save persists the sidebar placement");
	assert.ok(!source.includes('scope.set("'), "legacy scope.set(key, value) must be gone");
	assert.ok(source.includes('webOn && convTabState[0]') && source.includes('webOn && sidebarTabState[0]'), "switches visually checked only when web is on");
	assert.match(source, /t\("row\.mountSidebarTab"\),\s*\n\s*!webOn\s*\n/, "switches disabled when persisted webEnabled is false");
	assert.ok(source.includes("ldvhScope.subscribe"), "mount placement is subscription-driven, not a one-shot snapshot");
	assert.ok(source.includes("applyMountSettings({})"), "placements must mount by default before settings are known");
	assert.ok(source.includes('var sidebarOn = webOn && value && value.showInSidebarTab !== false'), "sidebar placement derived from master + checkbox");
	assert.ok(source.includes('var conversationOn = webOn && value && value.showInConversationTab !== false'), "conversation placement derived from master + checkbox");
	assert.ok(source.includes('if (sidebarOn && mountDisposers.sidebar === null)'), "sidebar tab mounts only when placement on");
	assert.ok(source.includes('else if (!sidebarOn && mountDisposers.sidebar !== null)'), "sidebar tab unmounts when placement off");
	assert.ok(source.includes('if (conversationOn && mountDisposers.conversation === null)'), "conversation tab mounts only when placement on");
	assert.ok(source.includes('else if (!conversationOn && mountDisposers.conversation !== null)'), "conversation tab unmounts when placement off");
});

test("plugin settings card hosts the project color palette (web settings page is read-only)", () => {
	assert.ok(source.includes("PROJECT_COLOR_KEYS"), "palette closed set is embedded in the settings card");
	assert.ok(source.includes('callLdvhApi("/governed-projects/color"'), "palette writes go through the plugin color endpoint");
	assert.ok(source.includes('typeof raw === "string" ? raw : "color update failed"'), "color error extraction survives string-shaped errors");
	assert.ok(source.includes('callLdvhApi("/governed-projects/with-colors")'), "project list carries colors via with-colors endpoint");
	assert.ok(source.includes("ldv-palette-dot-active"), "explicit selection has an active ring");
	assert.ok(source.includes("ldv-palette-check"), "selected dot renders a check mark");
	assert.ok(source.includes('var locked = !project.color'), "auto color locks the palette dots");
	assert.ok(source.includes("ldv-palette-dot-locked"), "locked dots dim via CSS class");
	assert.ok(source.includes("checked: !project.color"), "auto-color is a checkbox bound to absence of explicit color");
	assert.ok(source.includes('e.target.checked ? null : "emerald"'), "unchecking auto picks a color to unlock");
	assert.ok(source.includes("PROJECT_COLOR_VALUES"), "palette uses inline hex values, not host-undefined CSS variables");
	assert.ok(source.indexOf("var(--ldvh-pj-") === -1, "palette never references host-undefined CSS vars");
	assert.ok(source.includes('"row.colorAuto"'), "auto-color reset button exists");
	assert.ok(source.includes('"row.projectColor"'), "project color label exists");
});

test("settings footer carries the 鼓励一下 cheer link (family-wide pattern)", () => {
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


test("闲时辅助设置面：**一个**子项 + 参数；总开关已撤除，关只关子项", () => {
  for (const field of [
    "idleAssistEnabled",
    "idleCaptureEnabled",
  ]) {
    assert.ok(source.includes(field), `设置面须含开关字段 ${field}`);
  }
  for (const gone of [
    "capacityMaintenanceEnabled",
    "memoryHealthEnabled",
  ]) {
    assert.ok(!source.includes(gone), `设置面不得残留已合并的开关 ${gone}`);
  }
  assert.ok(
    source.includes("value.proxyAssistEnabled !== undefined"),
    "idleOn 须优先读新键 proxyAssistEnabled",
  );
  assert.ok(
    source.includes("value.idleAssistEnabled !== false"),
    "idleOn 须回落旧键（存量配置不得被静默当成全开）",
  );
  assert.ok(
    source.includes('cardHead("idle", "group.idle", "row.idleAssistHint", null, null)'),
    "闲时派发卡头不得再有开关槽位",
  );
  assert.match(
    source,
    /idleOn && task\.state\[0\]/,
    "子项勾选态须挂在派生量 idleOn 上（而不是界面上某个可点的总开关）",
  );
  assert.ok(source.includes('label: "row.experienceAccumulation"'), "须有「积累经验」子项");
  assert.ok(source.includes('label: "row.idleCapture"'), "须有「发现摩擦」子项");
  for (const gone of [
    "idleMinIntervalMs", "idleMinContentChars", "idleMinContentTurns",
    "idleMaxPerSession", "idleQuotaMax", "idleQuotaWindowMs",
  ]) {
    assert.ok(!source.includes(gone), `设置面不得残留已取消的参数 ${gone}`);
  }
  const limitsTable = source.match(/var IDLE_LIMITS = \[([\s\S]*?)\];/);
  assert.ok(limitsTable, "须有参数表");
  const entries = limitsTable[1].match(/\{ key: "/g) ?? [];
  assert.equal(entries.length, 0, `设置面参数表须恰好零项（2026-11-17 安静时长已删），实为 ${entries.length} 项`);
  assert.ok(!limitsTable[1].includes("idleSilenceMs"), "参数表不得再含 idleSilenceMs");
  assert.equal(
    source.includes("experienceReviewIntervalMs"),
    false,
    "审核间隔已整体删除（随静置触发，无间隔可配）；该字段名不得再出现在设置面",
  );
  assert.ok(!source.includes("auxReviewEnabled"), "设置面不得再有审核开关");
  assert.ok(!source.includes("row.auxReview"), "设置面不得再有审核开关文案");
});

test("§8.5：未实现的职责移出设置面后仍须在登记里可见", async () => {
  const { UNIMPLEMENTED_AUX_TASKS, AUX_TASK_REGISTRY, AUX_TASK_ORDER } =
    await import("../lib/aux-task-registry.js");
  assert.deepEqual([...UNIMPLEMENTED_AUX_TASKS], ["capacity-maintenance", "memory-health"]);
  for (const key of UNIMPLEMENTED_AUX_TASKS) {
    assert.ok(AUX_TASK_REGISTRY[key] !== undefined, `${key} 仍须在登记表内`);
    assert.equal(AUX_TASK_REGISTRY[key].implemented, false, `${key} 须如实标为未实现`);
    assert.ok(!AUX_TASK_ORDER.includes(key), `${key} 不得进派发面`);
  }
});

test("数值参数的默认值与服务端**同源**：不得在两处各写一套", async () => {
  const defaults = source.match(/var IDLE_DEFAULT_STORED = \{([\s\S]*?)\};/) || [];
  assert.ok(defaults[1], "须有 IDLE_DEFAULT_STORED 表");
  assert.ok(!defaults[1].includes("idleSilenceMs"), "客户端默认表不得再含 idleSilenceMs");

  const server = await readFile(new URL("../lib/idle-settings.js", import.meta.url), "utf8");
  assert.ok(!server.includes("silenceMs"), "服务端 IDLE_DEFAULTS 不得再含 silenceMs");
});

test("参数非法时**不写入**（不得把非法值送进宿主再被静默回落）", () => {
  assert.match(source, /function idleLimitOk\(text, scale\)/, "须有合法性判定（带 scale）");
  assert.match(source, /if \(!idleLimitsAllOk\(idleLimitsState\[0\]\)\) \{\s*saveErrorState\[1\]\(true\);\s*return;\s*\}/, "非法时须拦下写入并报失败");
});

test("时间参数以**分钟**读写，存储仍是毫秒（scale 单一来源，不得两处各写一套）", () => {
  assert.match(source, /var IDLE_LIMITS = \[/, "须有参数表");
  const table = source.match(/var IDLE_LIMITS = \[([\s\S]*?)\];/);
  assert.ok(table, "须能取到参数表");
  assert.equal(
    (table[1].match(/scale:/g) ?? []).length, 0,
    "参数表不得含任何 scale 条目（2026-11-17 起已无时间参数）",
  );
  assert.doesNotMatch(source, /"row\.idleSilenceMs":/, "安静时长的标签词条须一并删除");
  assert.doesNotMatch(source, /Silence duration/, "英文标签词条须一并删除");
  assert.doesNotMatch(source, /idleSilenceMs": "[^"]*毫秒"/, "不得残留毫秒标签");
  assert.match(source, /IDLE_LIMITS\.map\(function \(limit\) \{/, "UI 须遍历参数表");
});

test("换算判据是**往返回损**，而非「必须是整数」（不得凭空收紧服务端口径）", () => {
  assert.match(source, /function idleLimitToStored\(text, scale\)/, "须有换算函数");
  assert.match(source, /if \(Number\(idleLimitToText\(stored, scale\)\) !== n\) return undefined;/, "须做往返回损检查");
  assert.doesNotMatch(source, /Number\.isInteger\(n\) && n >= 0\) return undefined;\s*\n\s*var stored/, "不得把「输入是整数」当判据");
  assert.match(source, /if \(!Number\.isInteger\(stored\) \|\| stored < 0\) return undefined;/, "仍须拒绝换算出非整数的值");
});

test("参数区不再承载「数值属实现侧承接」与「编辑后需点保存」声明——按 code-no-comments 不留注释版本", () => {
  assert.doesNotMatch(source, /row\.idleLimitsPending/, "设置面不得再有该声明文案");
  assert.doesNotMatch(source, /idleLimitsHint/, "「编辑后需点保存生效」亦须删除（改由按钮态自明）");
  assert.doesNotMatch(source, /数值属实现侧承接/, "该声明不得作为注释留在代码里（规范与 idle-settings.js 已是权威承载）");
});

test("设置面：改动后**保存按钮自身**须显示为「需要保存」（不得只靠一行文字提示）", () => {
  assert.match(source, /"row\.saveDirty":/, "须有「有未保存改动」的按钮文案");
  assert.match(source, /"row\.saveDirtyAria":/, "须有对应的无障碍文案（供读屏）");
  assert.match(
    source,
    /busyState\[0\] \? t\("row\.saving"\) : \(dirtyState\[0\] \? t\("row\.saveDirty"\) : t\("row\.save"\)\)/,
    "按钮文案须随 dirtyState 切换",
  );
  assert.match(source, /ldv-btn-dirty/, "dirty 时须有独立的样式类");
  assert.match(
    source,
    /\.ldv-btn-dirty\{font-weight:600/,
    "该类须含**不依赖颜色**的变化（此处为字重），否则色觉障碍下不可辨",
  );
  assert.match(source, /var saveDisabled = [^;]*!dirtyState\[0\]/, "无改动时保存须不可点");
});


test("默认值三处一致：index.js 的 zod default ≡ idle-settings 的 IDLE_DEFAULTS ≡ client.js", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

  const indexSrc = await read("../lib/index.js");
  const settingsMod = await import("../lib/idle-settings.js");
  const clientSrc = await read("../lib/client.js");

  const d = settingsMod.IDLE_DEFAULTS;

  const zod = {};
  for (const key of []) {
    const m = indexSrc.match(new RegExp(`${key}:\\s*volatileField\\(z\\.number\\(\\)(?:\\.[a-z]+\\([^)]*\\))*\\.default\\(([\\d_]+)\\)\\)`));
    assert.ok(m, `index.js 须以 zod default 声明 ${key}`);
    zod[key] = Number(m[1].replace(/_/g, ""));
  }

  const storedBlock = clientSrc.match(/var IDLE_DEFAULT_STORED = \{([\s\S]*?)\};/);
  assert.ok(storedBlock, "client.js 须有 IDLE_DEFAULT_STORED 表");
  const stored = {};
  for (const m of storedBlock[1].matchAll(/(\w+):\s*(\d+)/g)) stored[m[1]] = Number(m[2]);

  const JUDGE_KEY = {};

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


test("设置面：安静时长已删除，其解释词条不得残留", () => {
  assert.doesNotMatch(source, /row\.idleSilenceMsHint/, "安静时长的解释词条须一并删除");
  assert.doesNotMatch(
    source,
    /"row\.idle[A-Za-z]*": "[^"]*(每隔|定期)[^"]*"/,
    "闲时相关文案不得含周期表述（机制已无周期触发）",
  );
});

test("设置面：标签与输入框须在**同一行**，且输入框**不得**收进折叠区", () => {
  assert.match(source, /className: "ldv-row"/, "参数行须用全页统一的行容器");
  assert.match(source, /\.ldv-row\{[^}]*display:flex/, "行容器须为 flex 行");
  assert.doesNotMatch(
    source,
    /React\.createElement\("details", \{ className: "ldv-block-body"/,
    "参数区不得折叠——直接展示",
  );
  assert.doesNotMatch(source, /ldv-idle-limit-grid/, "旧的网格容器须一并移除");
  assert.doesNotMatch(source, /ldv-idle-limit-row/, "旧的参数行容器须一并移除");
});


function gateCssText() {
  const start = source.indexOf("var GATE_CSS = ");
  assert.ok(start >= 0, "GATE_CSS 常量须存在");
  const body = start + "var GATE_CSS = ".length;
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

test("选项卡片外观挂在外层行 `[data-option-row]` 上（0.2.2-rc.1 的双层结构）", () => {
  const css = gateCssText();
  assert.ok(/\[data-option-row\]\{[^}]*border:1px solid/.test(css), "外层行须承接卡片边框");
  assert.ok(/\[data-option-row\][^{]*\{[^}]*min-height:48px/.test(css), "外层行须承接最小高度");
  assert.match(css, /\[data-option-row\] \[role="radio"\][^{]*\{[^}]*border:0/, "内层按钮须撤掉自己的边框（否则双框）");
  assert.match(css, /\[data-option-row\]\[class\*="optionSelected"\]/, "选中态须落在外层行上");
});

test("`description` 覆写排除 `descriptionToggle`（新宿主的子串碰撞）", () => {
  const css = gateCssText();
  assert.match(css, /\[class\*="description"\]:not\(\[class\*="descriptionToggle"\]\)/, "须排除 descriptionToggle");
});

test("召回预算档位：客户端选项须与服务端 INJECTION_BUDGET_TIERS **同源**", async () => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const serverSrc = await readFile(join(import.meta.dirname, "..", "lib", "source-recall.js"), "utf8");

  const opts = source.match(/var INJECTION_BUDGET_TIER_OPTIONS = \[([^\]]+)\]/);
  assert.ok(opts, "客户端须有 INJECTION_BUDGET_TIER_OPTIONS 表");
  const clientTiers = opts[1].split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  assert.deepEqual(clientTiers, [10, 20, 30, 40, 50], "客户端档位选项须为 10/20/30/40/50");

  const serverTiers = [...serverSrc.matchAll(/^ {2}(\d+): \d+ \* 1024,$/gm)].map((m) => Number(m[1]));
  assert.deepEqual(clientTiers, serverTiers, "客户端选项须与服务端 INJECTION_BUDGET_TIERS 的键逐个一致");

  const clientDefault = source.match(/var INJECTION_BUDGET_TIER_DEFAULT = (\d+);/);
  assert.ok(clientDefault, "客户端须有 INJECTION_BUDGET_TIER_DEFAULT");
  const serverDefault = serverSrc.match(/export const DEFAULT_INJECTION_BUDGET_TIER = (\d+);/);
  assert.ok(serverDefault, "服务端须有 DEFAULT_INJECTION_BUDGET_TIER");
  assert.equal(Number(clientDefault[1]), Number(serverDefault[1]), "两端默认档须一致");

  assert.match(source, /t\("row\.injectionBudgetTier"\)/, "须渲染档位控件标签");
  assert.match(source, /path: \["injectionBudgetTier"\]/, "保存时须提交该字段");
});



test("设置页节：注册 settings.section 与其图标，两者共用同一 id", async () => {
  assert.match(source, /slots\.inject\("settings\.section"/, "须注册设置页节");
  assert.match(source, /slots\.inject\("settings\.section\.icon"/, "须注册导航图标");
  assert.match(source, /var LDVH_SETTINGS_SECTION_ID = "dsh-ldvh"/);
  const registrations = source.match(/name: "settings\.section(?:\.icon)?"/g) ?? [];
  assert.ok(registrations.length >= 2, "节与图标各须一次注册");
  assert.match(source, /settings nav icon failed to register \(page unaffected\)/);
});

test("设置页节：order 不与已装插件冲突，且不使用会被精确匹配失败的名字", async () => {
  const m = source.match(/var LDVH_SETTINGS_SECTION_ORDER = (\d+)/);
  assert.ok(m, "order 须是显式常量");
  const order = Number(m[1]);
  for (const taken of [-10, 0, 10, 15, 20, 30, 35, 40, 45, 100]) {
    assert.notEqual(order, taken, `order=${order} 与已发布节位次 ${taken} 冲突`);
  }
  assert.ok(order > 45, "须排在已装的第三方页之后，避免抢占别人的位置");
});

test("设置页节：Plugins 页那两个 keyed 槽位**已撤除**（同一份配置不得有两个编辑入口）", () => {
  assert.doesNotMatch(source, /slots\.inject\("plugins\.bundle\.config"/, "不得再注册插件页 bundle 配置卡");
  assert.doesNotMatch(source, /slots\.inject\("plugins\.row\.config"/, "不得再注册插件页行级配置卡");
  assert.doesNotMatch(source, /LDVH_ROW_CONFIG_KEY/, "行级配置键已无消费点，不应残留");
  assert.match(source, /slots\.inject\("settings\.section"/);
});



test("注入行标签：单一来源，且不得自带插件名（宿主已加前缀）", async () => {
	const reviewAsk = await readFile(new URL("../lib/review-ask.js", import.meta.url), "utf8");
	assert.match(reviewAsk, /export const REVIEW_ASK_ROW_SUMMARY = "([^"]*)"/, "标签须在 review-ask.js 单点导出");
	const label = reviewAsk.match(/export const REVIEW_ASK_ROW_SUMMARY = "([^"]*)"/)[1];
	assert.ok(!label.includes("dsh-ldvh"), `标签不得重复插件名：${label}`);
	for (const file of ["guidance.js", "lifecycle.js"]) {
		const text = await readFile(new URL(`../lib/${file}`, import.meta.url), "utf8");
		assert.match(text, /import \{[^}]*REVIEW_ASK_ROW_SUMMARY[^}]*\} from "\.\/review-ask\.js"/, `${file} 须引用同一常量`);
		assert.doesNotMatch(text, /const REVIEW_ASK_ROW_SUMMARY =/, `${file} 不得再自带一份副本`);
	}
});

test("把关询问行须先判管辖（源码层只作补充：行为由 lifecycle.test.mjs 钉住）", async () => {
	const lifecycle = await readFile(new URL("../lib/lifecycle.js", import.meta.url), "utf8");
	const start = lifecycle.indexOf("reviewAskRow: async");
	assert.ok(start > 0, "reviewAskRow handler must exist");
	const body = lifecycle.slice(start, start + 4000);
	assert.match(body, /scopeState !== "governed"/, "把关门禁须以 governed 为判据");
	assert.match(body, /reason: "not-governed"/, "须申报未注入的原因");
});

test("设置保存须提交两个把关开关（漏写＝勾了也存不进去，且看不出来）", () => {
	assert.match(source, /path: \["preActionReviewAskEnabled"\]/, "行动前审查开关须进入保存操作");
	assert.match(source, /path: \["postWorkReviewAskEnabled"\]/, "行动后复核开关须进入保存操作");
	for (const key of ["preActionReviewAskEnabled", "postWorkReviewAskEnabled"]) {
		const occurrences = source.split(key).length - 1;
		assert.ok(occurrences >= 3, `${key} 须至少在读取/回填/提交三处出现（实际 ${occurrences}）`);
	}
});

test("静默执行开关：四处接线齐全（读初值 / 外部回填 / 放弃修改 / 提交）", () => {
	const key = "reviewAskSilentRunEnabled";
	const occurrences = source.split(key).length - 1;
	assert.ok(occurrences >= 4, `静默开关须在读取/回填/放弃/提交四处出现（实际 ${occurrences}）`);
	assert.match(source, /path: \["reviewAskSilentRunEnabled"\]/, "静默开关须进入保存操作");
	for (const id of ["row.reviewAskSilent", "row.reviewAskSilentHint", "row.reviewAskSilentBadge"]) {
		const hits = source.split(`"${id}":`).length - 1;
		assert.equal(hits, 2, `${id} 须中英各一份（实际 ${hits}）`);
	}
});

test("倒计时开关与秒数：四处接线齐全且中英文案齐备", () => {
	for (const key of ["reviewAskTimeoutEnabled", "reviewAskTimeoutSeconds"]) {
		const occurrences = source.split(key).length - 1;
		assert.ok(occurrences >= 4, `${key} 须在读取/回填/放弃/提交四处出现（实际 ${occurrences}）`);
		assert.match(source, new RegExp(`path: \\["${key}"\\]`), `${key} 须进入保存操作`);
	}
	assert.match(source, /\[10, 30, 60\]/, "秒数下拉须是 10/30/60 三档闭集");
	for (const id of ["row.reviewAskTimeout", "row.reviewAskTimeoutSeconds", "row.reviewAskTimeoutHint"]) {
		const hits = source.split(`"${id}":`).length - 1;
		assert.equal(hits, 2, `${id} 须中英各一份（实际 ${hits}）`);
	}
});

test("静默开关：颜色不是唯一载体（07 §12 第 8 条），且不改其它开关的配色", () => {
	assert.match(source, /\.ldv-switch-silent input:checked\+\.ldv-switch-track\{background:var\(--ldv-silent\)\}/, "琥珀轨须只作用于 .ldv-switch-silent");
	assert.match(source, /\.ldv-switch input:checked\+\.ldv-switch-track\{background:var\(--ldv-accent\)\}/, "默认开关仍须是蓝色，不得被静默那一档改掉");
	assert.match(source, /ldv-silent-badge/, "须有文字药丸，颜色不得单独承载语义");
	assert.match(source, /--ldv-silent:/, "静默色须是具名 token，不散落字面值");
});
