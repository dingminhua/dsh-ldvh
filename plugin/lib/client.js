// dsh-ldvh — LD Vibe Harness client-plane plugin.
//
// Registers two contributions:
//   1. settings.plugin.item (keyed "dsh-ldvh")  — the plugin settings card:
//      governed-project management, default governance directory, route switch.
//   2. conversation.view (list/session "ldvh")   — the LDVH view tab beside
//      chat / trajectory in the conversation header; clicking it renders the
//      LDVH Web in the session body (iframe /ldvh/ with loading / error /
//      retry states).
//
// Presentation decision (Human-confirmed): LDVH renders like
// thinking/context/trajectory — a session-scoped view inside the conversation
// area — NOT a sidebar entry + fullscreen overlay. The conversation.view
// registration mirrors dsh-client-ui-trajectory.
//
// Plain JS only (no bundler transform): React.createElement, CSS injected as a
// style tag, locale registered per namespace.

window.__ModuleLoader__.load({
  id: "dsh-ldvh",
  factory: function (require) {
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var Toast = primitives.Toast;
    var IconChevronDownOutline14 = primitives.IconChevronDownOutline14;

    // ── icon: the real 64px LDVH package icon, matching WorkBuddy's pattern ──
    var LDVH_ICON = "data:image/png;base64,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";

    var SETTINGS_CSS = "" +
      /* Strictly follows the dsh-connect-workbuddy settings-card shell. */
      ".ldv-settings-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}" +
      ".ldv-settings-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}" +
      ".ldv-settings-card-open{background:var(--dsw-alias-bg-layer-2,#25262b);border-color:var(--dsw-alias-label-dimmed,#777)}" +
      ".ldv-settings-card-header{appearance:none;box-sizing:border-box;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}" +
      ".ldv-settings-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:-2px}" +
      ".ldv-settings-card-head{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex;text-align:left}" +
      ".ldv-settings-card-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-weight:600;line-height:1.4}" +
      ".ldv-settings-card-desc{color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5}" +
      ".ldv-settings-card-chevron{color:var(--dsw-alias-label-tertiary,#999);flex:none;display:inline-flex;transition:transform .16s}" +
      ".ldv-settings-card-chevron-open{transform:rotate(180deg)}" +
      ".ldv-settings-card-body{border-top:1px solid var(--dsw-alias-border-l2,#36373b);margin:0 16px;padding:0 0 8px}" +
      ".ldv-settings-card-icon{width:32px;height:32px;flex:none;border-radius:7px}" +
      ".ldv-settings{display:flex;flex-direction:column;gap:16px;margin:0;padding:16px 0 4px}" +
      ".ldv-settings-field{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:13px;line-height:19px;color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-settings-input{box-sizing:border-box;appearance:none;width:100%;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#232529);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;line-height:1.5}" +
      ".ldv-governance-note{display:flex;flex-direction:column;gap:4px;padding:0 2px}" +
      ".ldv-governance-note-title{font-size:13px;font-weight:600;line-height:19px;color:var(--dsw-alias-label-primary,#e6e6e6)}" +
      ".ldv-governance-note-text{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ldv-governance-panel{overflow:hidden;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:12px;background:linear-gradient(165deg,var(--dsw-alias-bg-layer-2,#232529),var(--dsw-alias-bg-layer-3,#202126));box-shadow:0 1px 2px rgba(0,0,0,.18)}" +
      ".ldv-governance-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#36373b)}" +
      ".ldv-governance-panel-heading{display:flex;align-items:center;gap:8px;min-width:0}" +
      ".ldv-governance-panel-dot{width:8px;height:8px;border-radius:50%;flex:none;background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 18%,transparent)}" +
      ".ldv-governance-panel-title{font-size:13px;font-weight:600;line-height:19px;color:var(--dsw-alias-label-primary,#e6e6e6)}" +
      ".ldv-governance-panel-count{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary,#b8b8b8) 16%,transparent);color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-governance-panel-body{display:flex;flex-direction:column;gap:12px;padding:14px}" +
      ".ldv-governance-add{display:flex;flex-direction:column;gap:14px;padding:16px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#5686fe) 30%,var(--dsw-alias-border-l2,#36373b));border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#5686fe) 5%,var(--dsw-alias-bg-layer-1,#1b1c20))}" +
      ".ldv-governance-add-head{display:flex;align-items:flex-start;gap:10px}" +
      ".ldv-governance-add-icon{display:grid;place-items:center;width:28px;height:28px;flex:none;border-radius:8px;color:#fff;font-size:17px;font-weight:400;line-height:1;background:var(--dsw-alias-state-business-primary,#5686fe);box-shadow:0 2px 6px color-mix(in srgb,var(--dsw-alias-state-business-primary,#5686fe) 35%,transparent)}" +
      ".ldv-governance-add-copy{display:flex;flex-direction:column;gap:2px;min-width:0}" +
      ".ldv-governance-add-title{font-size:13px;font-weight:600;line-height:19px;color:var(--dsw-alias-label-primary,#e6e6e6)}" +
      ".ldv-governance-add-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999);max-width:560px}" +
      ".ldv-governance-add-fields{display:flex;flex-direction:column;gap:14px}" +
      ".ldv-governance-add-field{display:flex;flex-direction:column;gap:6px;min-width:0}" +
      ".ldv-governance-add-label{font-size:12px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-governance-add-field-help{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ldv-governance-add-field-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-governance-path-control{display:flex;min-width:0}" +
      ".ldv-governance-path-control .ldv-settings-input{flex:1;min-width:0;border-radius:10px 0 0 10px}" +
      ".ldv-governance-path-control .ldv-btn{height:36px;flex:none;border-left:0;border-radius:0 10px 10px 0;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#5686fe) 12%,var(--dsw-alias-bg-layer-2,#232529))}" +
      ".ldv-settings-input.is-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 60%,transparent)}" +
      ".ldv-settings-input.is-error:focus-visible{border-color:var(--dsw-alias-state-error-primary,#ef4444);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 22%,transparent)}" +
      ".ldv-governance-add-actions{display:flex;justify-content:flex-end;gap:8px}" +
      ".ldv-governance-add-actions .ldv-btn{min-width:76px}" +
      ".ldv-governance-add-error{padding:8px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 35%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent);font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ef4444);word-break:break-word}" +
      ".ldv-governance-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:22px 14px;text-align:center}" +
      ".ldv-governance-empty-icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;border:1px dashed var(--dsw-alias-border-l2,#46474c);color:var(--dsw-alias-label-tertiary,#999);font-size:16px;font-weight:600}" +
      ".ldv-governance-empty-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-governance-empty-text{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999);max-width:420px}" +
      ".ldv-governance-error{padding:10px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 45%,transparent);border-left:3px solid var(--dsw-alias-state-error-primary,#ef4444);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent);font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e6e6e6);word-break:break-word}" +
      ".ldv-projects{display:flex;flex-direction:column;gap:10px}" +
      ".ldv-project-card{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#1b1c20);transition:border-color .16s}" +
      ".ldv-project-card:hover{border-color:var(--dsw-alias-label-dimmed,#777)}" +
      ".ldv-project-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}" +
      ".ldv-project-idline{display:flex;flex-direction:column;gap:2px;min-width:0}" +
      ".ldv-project-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}" +
      ".ldv-project-path{font-size:12px;line-height:18px;word-break:break-all;color:var(--dsw-alias-label-tertiary,#999);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}" +
      ".ldv-project-actions{display:flex;justify-content:flex-end;gap:8px}" +
      ".ldv-btn{transition:opacity .16s,border-color .16s}" +
      "@media(max-width:560px){.ldv-governance-add{padding:14px}.ldv-governance-path-control{display:grid;gap:8px}.ldv-governance-path-control .ldv-settings-input{border-radius:10px}.ldv-governance-path-control .ldv-btn{border-left:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px}.ldv-governance-add-actions{justify-content:stretch}.ldv-governance-add-actions .ldv-btn{flex:1;min-width:0}.ldv-project-actions{justify-content:stretch}.ldv-project-actions .ldv-btn{flex:1}}" +
      ".ldv-web-panel{overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:12px;background:linear-gradient(145deg,var(--dsw-alias-bg-layer-2,#232529),var(--dsw-alias-bg-layer-3,#202126))}" +
      ".ldv-web-panel-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#36373b)}" +
      ".ldv-web-panel-copy{display:flex;flex-direction:column;gap:3px;min-width:0}" +
      ".ldv-web-panel-title{font-size:13px;font-weight:600;line-height:19px;color:var(--dsw-alias-label-primary,#e6e6e6)}" +
      ".ldv-web-panel-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ldv-switch{position:relative;width:38px;height:22px;flex:none;cursor:pointer}" +
      ".ldv-switch input{position:absolute;opacity:0;pointer-events:none}" +
      ".ldv-switch-track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-border-l2,#46474c);transition:background .16s}" +
      ".ldv-switch-track:after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .16s}" +
      ".ldv-switch input:checked+.ldv-switch-track{background:var(--dsw-alias-state-business-primary,#5686fe)}" +
      ".ldv-switch input:checked+.ldv-switch-track:after{transform:translateX(16px)}" +
      ".ldv-switch input:focus-visible+.ldv-switch-track{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}" +
      ".ldv-web-panel-body{padding:13px 14px}" +
      ".ldv-status{display:grid;gap:8px;min-width:0}" +
      ".ldv-status-row{display:grid;grid-template-columns:minmax(84px,1fr) auto;align-items:center;gap:12px;font-size:13px;line-height:19px;color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-status-value{display:inline-flex;align-items:center;gap:6px;font-weight:600;flex:none}" +
      ".ldv-status-value:before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 15%,transparent)}" +

      ".ldv-status-ok{color:var(--dsw-alias-state-success-primary,#34d399)}" +
      ".ldv-status-fail{color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-status-wait{color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ldv-settings-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px rgba(86,134,254,.22)}" +
      ".ldv-settings-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ldv-settings-toggle{display:flex;align-items:flex-start;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#232529);font-size:13px;line-height:19px;color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-settings-toggle input{margin-top:3px;accent-color:var(--dsw-alias-brand-primary,#5686fe)}" +
      ".ldv-settings-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);padding-top:12px}" +
      ".ldv-settings-footer-status{margin-right:auto;font-size:12px;color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ldv-settings-footer-error{margin-right:auto;font-size:12px;color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-view{position:relative;width:100%;height:100%;min-height:0}" +
      ".ldv-view-frame{position:absolute;inset:0;width:100%;height:100%;border:0}" +
      ".ldv-view-state{position:absolute;inset:0;display:grid;place-items:center;gap:10px;align-content:center;text-align:center;padding:24px}" +
      ".ldv-view-state p{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#b8b8b8);margin:0;max-width:520px}" +
      ".ldv-btn{box-sizing:border-box;height:30px;padding:0 14px;border-radius:8px;font:inherit;font-size:12px;cursor:pointer}" +
      ".ldv-btn-primary{border:1px solid var(--dsw-alias-state-business-primary,#5686fe);background:var(--dsw-alias-state-business-primary,#5686fe);color:#fff}" +
      ".ldv-btn-outline{border:1px solid var(--dsw-alias-border-l2,#36373b);background:transparent;color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#5686fe) 88%,#fff)}" +
      ".ldv-btn-outline:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,#777)}" +
      ".ldv-btn:disabled{opacity:.5;cursor:default}" +
      /* Governance-state mark (conversation flow, under the first completed
         turn): `governed` renders GREEN (Human 2026-09-02), `unavailable`
         renders RED (Human 2026-09-03 update — it still ACTS as
         not_governed; the colour only makes the degraded state visible),
         not_governed renders nothing. The trailing duration uses tabular
         digits so "· 12.3s" does not jitter between turns. */
      ".ldv-mark{display:inline-flex;align-items:center;gap:6px;padding:2px 0 6px;color:var(--dsw-alias-state-positive,#3fb950);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;user-select:none}" +
      ".ldv-mark-unavailable{color:var(--dsw-alias-state-error-primary,#f85149)}" +
      ".ldv-mark-dot{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 18%,transparent);flex:none}";

    if (typeof document !== "undefined") {
      var cssId = "dsh-ldvh/client.css";
      if (!document.querySelector("style[data-plugin-css='" + cssId + "']")) {
        var styleTag = document.createElement("style");
        styleTag.dataset.plugin = "dsh-ldvh";
        styleTag.dataset.pluginCss = cssId;
        styleTag.textContent = SETTINGS_CSS;
        document.head.appendChild(styleTag);
      }
    }

    // ── locale ───────────────────────────────────────────────────────────
    var LDVH_NS = "settings.ldvh";
    var LDVH_ZH = {
      "row.title": "LD Vibe Harness（dsh-ldvh）",
      "row.desc": "在 DSH 中管理 LDVH 管辖项目、Git Gate 与 Web 呈现。",
      "row.expand": "展开",
      "row.collapse": "收起",
      "row.governanceLocation": "管辖项目配置",
      "row.governanceLocationHint": "由 LDVH 自动保存在 DSH 用户配置目录下的 ldvh/governed-projects.yaml。",
      "row.projectsPanelTitle": "管辖项目",
      "row.addProject": "新增管辖项目",
      "row.addProjectTitle": "新增管辖项目",
      "row.addProjectHint": "选择一个 Git 仓库根目录，安装会同时完成登记、初始化 ldvh-base/ 并安装 Git Hook。",
      "row.cancelAdd": "取消",
      "row.projectsEmptyTitle": "还没有管辖项目",
      "row.projectsEmptyText": "新增后，LDVH 才会在该项目中启用事实源与 Git Gate。",
      "row.projectsLoading": "正在读取管辖项目…",
      "row.projectsEmpty": "尚未安装管辖项目。",
      "row.projectPath": "Git 根目录",
      "row.projectId": "项目 ID",
      "row.projectIdHelp": "用于登记与 CLI 调用的唯一标识（小写字母、数字、连字符；1–64 字符），创建后不可修改。",
      "row.projectIdErrorFormat": "仅可包含小写字母、数字和连字符，且不能以连字符开头或结尾。",
      "row.projectIdErrorLength": "长度需在 1–64 字符之间。",
      "row.projectIdErrorDuplicate": "此 ID 已被其他管辖项目使用。",
      "row.chooseProject": "选择 Git 根目录…",
      "row.install": "安装",
      "row.installBusy": "安装中…",
      "row.update": "更新",
      "row.updateBusy": "更新中…",
      "row.unregister": "取消管辖",
      "row.check": "检查",
      "row.projectReady": "已就绪",
      "row.projectIncomplete": "未就绪",
      "row.operationFailed": "操作失败",
      "row.apiUnavailable": "LDVH 服务暂不可用，请稍后重试或检查 Web 呈现开关",
      "row.projectsUnavailable": "管辖项目列表暂不可用，请先查看上方 Web 呈现状态。",
      "row.webEnabled": "启用 LDVH Web 呈现",
      "row.webHint": "关闭时移除 LDVH 页面和 API；开启后自动挂载并检查是否可用。",
      "row.status": "Web 呈现状态",
      "row.statusChecking": "检测中…",
      "row.statusOk": "运行正常",
      "row.statusUnmounted": "未挂载",
      "row.statusFail": "运行异常",
      "row.save": "保存",
      "row.discard": "放弃修改",
      "row.saved": "已保存",
      "row.saveFailed": "保存失败，请重试。",
      "row.toastSaved": "LDVH 设置已保存。",
      "view.label": "LDVH",
      "view.loading": "正在加载 LDVH Web…",
      "view.error": "LDVH Web 当前不可用，请检查插件设置中的路由开关，或稍后重试。",
      "view.retry": "重试",
      "mark.governed": "本项目受 LDVH 管辖",
      "mark.governedWithName": "本项目受 LDVH 管辖：{name}",
      "mark.unavailable": "LDVH 管辖状态不可用",
      "mark.unavailableHint": "管辖登记当前不可读取，本项目暂按不受管辖处理。处理方法：检查 DSH 用户配置根下 ldvh/governed-projects.yaml 是否可读且格式正确，或在 DSH 设置页查看管辖项目。"
    };
    var LDVH_EN = {
      "row.title": "LD Vibe Harness (dsh-ldvh)",
      "row.desc": "Manage LDVH governed projects, Git Gate, and Web presentation inside DSH.",
      "row.expand": "Expand",
      "row.collapse": "Collapse",
      "row.governanceLocation": "Governed projects configuration",
      "row.governanceLocationHint": "LDVH stores it automatically at ldvh/governed-projects.yaml under the DSH user-config directory.",
      "row.projectsPanelTitle": "Governed projects",
      "row.addProject": "Add governed project",
      "row.addProjectTitle": "Add governed project",
      "row.addProjectHint": "Pick a Git repository root. Installing registers the project, initializes ldvh-base/, and installs the Git Hook in one step.",
      "row.cancelAdd": "Cancel",
      "row.projectsEmptyTitle": "No governed project yet",
      "row.projectsEmptyText": "Add one to enable the fact source and Git Gate for that project.",
      "row.projectsLoading": "Loading governed projects…",
      "row.projectsEmpty": "No governed project is installed yet.",
      "row.projectPath": "Git root",
      "row.projectId": "Project ID",
      "row.projectIdHelp": "Unique identifier for registration and CLI calls (lowercase letters, digits, and hyphens; 1–64 chars). Cannot be changed after creation.",
      "row.projectIdErrorFormat": "Only lowercase letters, digits, and hyphens; cannot start or end with a hyphen.",
      "row.projectIdErrorLength": "Must be between 1 and 64 characters.",
      "row.projectIdErrorDuplicate": "This ID is already used by another governed project.",
      "row.chooseProject": "Choose Git root…",
      "row.install": "Install",
      "row.installBusy": "Installing…",
      "row.update": "Update",
      "row.updateBusy": "Updating…",
      "row.unregister": "Stop governing",
      "row.check": "Check",
      "row.projectReady": "Ready",
      "row.projectIncomplete": "Not ready",
      "row.operationFailed": "Operation failed",
      "row.apiUnavailable": "The LDVH service is unavailable. Retry later or check the Web presentation switch.",
      "row.projectsUnavailable": "The governed-project list is unavailable. Check the Web presentation status above first.",
      "row.webEnabled": "Enable LDVH Web presentation",
      "row.webHint": "Turning it off removes the LDVH page and API; turning it on mounts them and checks availability automatically.",
      "row.status": "Web presentation status",
      "row.statusChecking": "Checking…",
      "row.statusOk": "Running normally",
      "row.statusUnmounted": "Not mounted",
      "row.statusFail": "Unavailable",
      "row.save": "Save",
      "row.discard": "Discard",
      "row.saved": "Saved",
      "row.saveFailed": "Could not save. Try again.",
      "row.toastSaved": "LDVH settings saved.",
      "view.label": "LDVH",
      "view.loading": "Loading LDVH Web…",
      "view.error": "LDVH Web is unavailable. Check the route switch in plugin settings, or try again later.",
      "view.retry": "Retry",
      "mark.governed": "This project is governed by LDVH",
      "mark.governedWithName": "Governed by LDVH: {name}",
      "mark.unavailable": "LDVH governance state unavailable",
      "mark.unavailableHint": "The governed-projects registration cannot be read; this session is treated as ungoverned for now. Check that ldvh/governed-projects.yaml under the DSH user-config root is readable and valid, or inspect the governed-projects page in DSH settings."
    };

    // Mechanical ID validation. Slug rule mirrors chooseProject(): lowercase
    // alphanumeric with single hyphens between segments; no leading/trailing
    // hyphen. "required" is silent in the UI (handled by disabled install).
    function computeIdError(id, projects) {
      if (!id) return "required";
      if (id.length > 64) return "length";
      if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)) return "format";
      if (projects && projects.some(function (p) { return p && p.id === id; })) return "duplicate";
      return null;
    }
    function idErrorMessage(key, t) {
      if (key === "format") return t("row.projectIdErrorFormat");
      if (key === "length") return t("row.projectIdErrorLength");
      if (key === "duplicate") return t("row.projectIdErrorDuplicate");
      return null;
    }

    // Health probe: the view is "ready" only when /ldvh/api/health answers.
    function checkHealth(then) {
      fetch("/ldvh/api/health", { method: "GET", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (body) { then(body && body.ok === true); })
        .catch(function () { then(false); });
    }

    // Web-presentation probe: independently checks the backend API health and
    // whether the /ldvh SPA page is reachable. Both are real HTTP probes (no
    // Host-side state mirror), so the card always reports the true runtime.
    function probeWeb(then) {
      var out = { api: false, page: false };
      fetch("/ldvh/api/health", { method: "GET", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (body) { out.api = !!(body && body.ok === true); })
        .catch(function () { out.api = false; })
        .then(function () {
          return fetch("/ldvh/", { method: "GET", cache: "no-store" })
            .then(function (r) { out.page = r.status >= 200 && r.status < 400; })
            .catch(function () { out.page = false; });
        })
        .then(function () { then(out); })
        .catch(function () { then(out); });
    }

    // ── settings row helpers ─────────────────────────────────────────────
    function useSettingsScopeSnapshot(scope) {
      var snapshotState = React.useState(scope.getSnapshot());
      React.useEffect(function () {
        function update() { snapshotState[1](scope.getSnapshot()); }
        return scope.subscribe(update);
      }, [scope]);
      return snapshotState[0];
    }

    function callLdvhApi(path, body) {
      return fetch("/ldvh/api" + path, {
        method: body === void 0 ? "GET" : "POST",
        cache: "no-store",
        headers: body === void 0 ? void 0 : { "content-type": "application/json" },
        body: body === void 0 ? void 0 : JSON.stringify(body)
      }).then(function (response) {
        return response.text().then(function (text) {
          if (text.length === 0) throw new Error("LDVH 服务返回了空响应");
          try {
            return JSON.parse(text);
          } catch (error) {
            throw new Error("LDVH 服务返回了无法解析的响应");
          }
        });
      });
    }

    // ── LdvhSettingsRow: governed projects + web switch ──────────────────
    function LdvhSettingsRow(props) {
      var t = props.t;
      var scope = props.settingsScope;
      var snap = useSettingsScopeSnapshot(scope);
      var value = (snap && snap.status === "ready" && snap.value) || {};
      var enabledState = React.useState(value.webEnabled !== false);
      var dirtyState = React.useState(false);
      var busyState = React.useState(false);
      var savedState = React.useState(false);
      var saveErrorState = React.useState(false);
      var toastState = React.useState(null);
      var toastSeq = React.useRef(0);
      var webStatusState = React.useState({ checking: true, api: false, page: false });
      var projectsState = React.useState({ loading: true, value: null, error: null, unavailable: false });
      var candidateState = React.useState({ path: "", id: "" });
      var addingState = React.useState(false);
      var projectBusyState = React.useState(false);
      var installErrorState = React.useState(null);
      var directoryPicker = props.directoryPicker;

      function loadProjects() {
        projectsState[1]({ loading: true, value: projectsState[0].value, error: null, unavailable: false });
        callLdvhApi("/governed-projects")
          .then(function (result) {
            if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "project list unavailable");
            projectsState[1]({ loading: false, value: result.value, error: null, unavailable: false });
          })
          .catch(function (error) {
            var message = String(error.message || error);
            var isTransport = message.indexOf("LDVH 服务返回了空响应") !== -1 || message.indexOf("LDVH 服务返回了无法解析的响应") !== -1 || message.indexOf("fetch") !== -1 || message.indexOf("network") !== -1 || message.indexOf("Failed to fetch") !== -1;
            // A transport-level failure is the same condition the Web
            // presentation status row already reports at the top. The reason
            // is stated once, next to that status (Human-confirmed); the
            // projects panel only marks itself unavailable with a pointer
            // instead of repeating the error.
            projectsState[1]({ loading: false, value: null, error: isTransport ? null : message, unavailable: isTransport });
          });
      }

      React.useEffect(function () { loadProjects(); }, []);

      React.useEffect(function () {
        if (dirtyState[0] || busyState[0]) return;
        var next = (snap && snap.status === "ready" && snap.value) || {};
        enabledState[1](next.webEnabled !== false);
        savedState[1](false);
        saveErrorState[1](false);
      }, [snap ? snap.revision : -1, dirtyState[0], busyState[0]]);

      // Probe automatically whenever the persisted enable setting changes.
      // Disabled means "not mounted" and deliberately performs no request.
      React.useEffect(function () {
        var cancelled = false;
        var persisted = (snap && snap.status === "ready" && snap.value) || {};
        if (persisted.webEnabled === false) {
          webStatusState[1]({ checking: false, api: false, page: false });
          return function () { cancelled = true; };
        }
        webStatusState[1]({ checking: true, api: false, page: false });
        probeWeb(function (out) {
          if (cancelled) return;
          webStatusState[1]({ checking: false, api: out.api, page: out.page });
        });
        return function () { cancelled = true; };
      }, [snap ? snap.revision : -1]);

      function chooseProject() {
        if (!directoryPicker || typeof directoryPicker.pick !== "function" || projectBusyState[0]) return;
        projectBusyState[1](true);
        Promise.resolve(directoryPicker.pick()).then(function (result) {
          projectBusyState[1](false);
          if (!result || result.ok !== true || typeof result.value !== "string") return;
          var leaf = result.value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "project";
          candidateState[1]({ path: result.value, id: leaf.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "project" });
        }).catch(function () { projectBusyState[1](false); });
      }
      function openAddForm() {
        installErrorState[1](null);
        addingState[1](true);
      }
      function closeAddForm() {
        installErrorState[1](null);
        candidateState[1]({ path: "", id: "" });
        addingState[1](false);
      }
      function installCandidate() {
        if (!candidateState[0].path || !candidateState[0].id || projectBusyState[0]) return;
        projectBusyState[1](true);
        installErrorState[1](null);
        callLdvhApi("/governed-projects/install", { path: candidateState[0].path, id: candidateState[0].id, name: candidateState[0].id })
          .then(function (result) {
            if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "installation failed");
            closeAddForm();
            loadProjects();
          })
          .catch(function (error) { installErrorState[1](t("row.operationFailed") + ": " + String(error.message || error)); })
          .finally(function () { projectBusyState[1](false); });
      }
      function inspectProject(path) {
        projectBusyState[1](true);
        callLdvhApi("/governed-projects/inspect", { path: path }).then(function () { loadProjects(); }).catch(function (error) {
          projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
        }).finally(function () { projectBusyState[1](false); });
      }
      // "更新" runs the idempotent install transaction: it updates an
      // outdated managed Hook, repairs a missing/incomplete fact source, and
      // re-registers as a no-op when the entry already matches.
      function updateProject(project) {
        projectBusyState[1](true);
        callLdvhApi("/governed-projects/install", { path: project.path, id: project.id, name: project.name || project.id })
          .then(function (result) {
            if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "update failed");
            loadProjects();
          })
          .catch(function (error) {
            projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
          }).finally(function () { projectBusyState[1](false); });
      }
      function unregisterGovernance(project) {
        projectBusyState[1](true);
        var projects = projectsState[0].value && projectsState[0].value.projects || [];
        var nextDefault = projects.find(function (entry) { return entry.id !== project.id; });
        callLdvhApi("/governed-projects/unregister", { id: project.id, path: project.path, nextDefaultProjectId: nextDefault ? nextDefault.id : "" }).then(function (result) {
          if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "unregister failed");
          loadProjects();
        }).catch(function (error) {
          projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
        }).finally(function () { projectBusyState[1](false); });
      }

      function markDirty() {
        savedState[1](false);
        saveErrorState[1](false);
        dirtyState[1](true);
      }
      function save() {
        if (!snap || snap.status !== "ready" || snap.writable === false || busyState[0]) return;
        busyState[1](true);
        Promise.resolve()
          .then(function () { return scope.set("webEnabled", !!enabledState[0]); })
          .then(function () {
            busyState[1](false);
            dirtyState[1](false);
            savedState[1](true);
            toastSeq.current = toastSeq.current + 1;
            toastState[1]({ seq: toastSeq.current, text: t("row.toastSaved") });
          })
          .catch(function () {
            busyState[1](false);
            saveErrorState[1](true);
          });
      }
      function discard() {
        var next = (snap && snap.status === "ready" && snap.value) || {};
        enabledState[1](next.webEnabled !== false);
        dirtyState[1](false);
        savedState[1](false);
        saveErrorState[1](false);
      }
      var saveDisabled = !snap || snap.status !== "ready" || snap.writable === false || busyState[0] || !dirtyState[0];
      var ws = webStatusState[0];
      // API and page probes remain internal diagnostic evidence; the ordinary
      // settings UI exposes one product-level conclusion only.
      var serviceOk = ws.api && ws.page;
      var serviceValueText = ws.checking
        ? t("row.statusChecking")
        : (!enabledState[0] ? t("row.statusUnmounted") : (serviceOk ? t("row.statusOk") : t("row.statusFail")));
      var serviceValueClass = "ldv-status-value" + (ws.checking
        ? " ldv-status-wait"
        : (!enabledState[0] ? " ldv-status-wait" : (serviceOk ? " ldv-status-ok" : " ldv-status-fail")));
      var serviceStatus = React.createElement("div", { className: "ldv-status-row" },
        React.createElement("span", null, t("row.status")),
        React.createElement("span", { className: serviceValueClass }, serviceValueText)
      );
      // The single place a transport-level failure is explained (moved up
      // from the projects panel, Human-confirmed): shown only when the switch
      // is on and the probes actually failed.
      var serviceIssue = ws.checking || !enabledState[0] || serviceOk ? null : t("row.apiUnavailable");
      var idError = computeIdError(candidateState[0].id, projectsState[0].value && projectsState[0].value.projects);
      var idErrorText = idErrorMessage(idError, t);
      var idInputClass = "ldv-settings-input" + (idError && idError !== "required" ? " is-error" : "");
      var installBlocked = projectBusyState[0] || !candidateState[0].path || !candidateState[0].id || (idError && idError !== "required");
      var projectRows = projectsState[0].loading
        ? React.createElement("div", { className: "ldv-governance-empty" },
            React.createElement("span", { className: "ldv-governance-empty-icon", "aria-hidden": "true" }, "…"),
            React.createElement("span", { className: "ldv-governance-empty-text" }, t("row.projectsLoading"))
          )
        : (projectsState[0].unavailable
          // Transport-level failure: the reason lives once next to the Web
          // presentation status above; the panel only points up (no duplicate
          // error box) and does not pretend the project list is empty.
          ? React.createElement("span", { className: "ldv-settings-hint" }, t("row.projectsUnavailable"))
          : (projectsState[0].error
            ? React.createElement("div", { className: "ldv-governance-error", role: "alert" }, projectsState[0].error)
            : ((projectsState[0].value && projectsState[0].value.projects || []).length === 0
              ? React.createElement("div", { className: "ldv-governance-empty" },
                  React.createElement("span", { className: "ldv-governance-empty-icon", "aria-hidden": "true" }, "∅"),
                  React.createElement("span", { className: "ldv-governance-empty-title" }, t("row.projectsEmptyTitle")),
                  React.createElement("span", { className: "ldv-governance-empty-text" }, t("row.projectsEmptyText"))
                )
              : React.createElement("div", { className: "ldv-projects" }, (projectsState[0].value.projects || []).map(function (project) {
              var hook = project.status && project.status.hook;
              var factSource = project.status && project.status.factSource;
              var ready = factSource && factSource.state === "ready" && hook && hook.state === "managed";
              // Repairable = the install transaction can fix it: a missing or
              // outdated managed Hook, or an uninitialized/incomplete fact
              // source. Conflict/unavailable states are NOT repairable here
              // (install refuses) and are explained by the detail line below.
              var repairable = (hook && ["absent", "outdated"].includes(hook.state)) || (factSource && ["absent", "incomplete"].includes(factSource.state));
              var notReadyDetail = ready ? null
                : ((factSource && factSource.state !== "ready" && factSource.detail)
                  || (hook && hook.state !== "managed" && hook.detail)
                  || (project.status && project.status.error && project.status.error.message)
                  || null);
              return React.createElement("article", { className: "ldv-project-card", key: project.id },
                React.createElement("div", { className: "ldv-project-head" },
                  React.createElement("span", { className: "ldv-project-idline" },
                    React.createElement("span", { className: "ldv-project-name" }, project.name || project.id),
                    React.createElement("span", { className: "ldv-project-path" }, project.path)
                  ),
                  React.createElement("span", { className: ready ? "ldv-status-value ldv-status-ok" : "ldv-status-value ldv-status-fail" }, ready ? t("row.projectReady") : t("row.projectIncomplete"))
                ),
                notReadyDetail ? React.createElement("span", { className: "ldv-settings-hint" }, notReadyDetail) : null,
                React.createElement("div", { className: "ldv-project-actions" },
                  React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: function () { inspectProject(project.path); } }, t("row.check")),
                  repairable ? React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", disabled: projectBusyState[0], onClick: function () { updateProject(project); } }, projectBusyState[0] ? t("row.updateBusy") : t("row.update")) : null,
                  React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: function () { unregisterGovernance(project); } }, t("row.unregister"))
                )
              );
            })))));
      return React.createElement("section", { className: "ldv-settings" },
        React.createElement("section", { className: "ldv-web-panel" },
          React.createElement("div", { className: "ldv-web-panel-head" },
            React.createElement("span", { className: "ldv-web-panel-copy" },
              React.createElement("span", { className: "ldv-web-panel-title" }, t("row.webEnabled")),
              React.createElement("span", { className: "ldv-web-panel-desc" }, t("row.webHint"))
            ),
            React.createElement("label", { className: "ldv-switch" },
              React.createElement("input", {
                type: "checkbox",
                checked: enabledState[0],
                "aria-label": t("row.webEnabled"),
                onChange: function (e) { enabledState[1](e.target.checked); markDirty(); }
              }),
              React.createElement("span", { className: "ldv-switch-track", "aria-hidden": "true" })
            )
          ),
          React.createElement("div", { className: "ldv-web-panel-body" },
            React.createElement("div", { className: "ldv-status" },
              serviceStatus,
              serviceIssue ? React.createElement("span", { className: "ldv-settings-hint" }, serviceIssue) : null
            )
          )
        ),
        React.createElement("section", { className: "ldv-governance-note" },
          React.createElement("span", { className: "ldv-governance-note-title" }, t("row.governanceLocation")),
          React.createElement("span", { className: "ldv-governance-note-text" }, t("row.governanceLocationHint"))
        ),
        React.createElement("section", { className: "ldv-governance-panel" },
          React.createElement("div", { className: "ldv-governance-panel-head" },
            React.createElement("span", { className: "ldv-governance-panel-heading" },
              React.createElement("span", { className: "ldv-governance-panel-dot ldv-status-ok", "aria-hidden": "true" }),
              React.createElement("span", { className: "ldv-governance-panel-title" }, t("row.projectsPanelTitle")),
              !projectsState[0].loading && projectsState[0].value
                ? React.createElement("span", { className: "ldv-governance-panel-count" }, String((projectsState[0].value.projects || []).length))
                : null
            ),
            React.createElement("div", { className: "ldv-project-actions" },
              React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0] || addingState[0], onClick: openAddForm }, t("row.addProject"))
            )
          ),
          React.createElement("div", { className: "ldv-governance-panel-body" },
            addingState[0]
              ? React.createElement("div", { className: "ldv-governance-add" },
                  React.createElement("div", { className: "ldv-governance-add-head" },
                    React.createElement("span", { className: "ldv-governance-add-icon", "aria-hidden": "true" }, "+"),
                    React.createElement("span", { className: "ldv-governance-add-copy" },
                      React.createElement("span", { className: "ldv-governance-add-title" }, t("row.addProjectTitle")),
                      React.createElement("span", { className: "ldv-governance-add-hint" }, t("row.addProjectHint"))
                    )
                  ),
                  React.createElement("div", { className: "ldv-governance-add-fields" },
                    React.createElement("div", { className: "ldv-governance-add-field" },
                      React.createElement("span", { className: "ldv-governance-add-label" }, t("row.projectPath")),
                      React.createElement("span", { className: "ldv-governance-path-control" },
                        React.createElement("input", { className: "ldv-settings-input", value: candidateState[0].path, readOnly: true, "aria-label": t("row.projectPath"), placeholder: t("row.projectPath") }),
                        React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: chooseProject }, t("row.chooseProject"))
                      )
                    ),
                    React.createElement("div", { className: "ldv-governance-add-field" },
                      React.createElement("span", { className: "ldv-governance-add-label" }, t("row.projectId")),
                      React.createElement("input", { className: idInputClass, value: candidateState[0].id, disabled: projectBusyState[0], "aria-label": t("row.projectId"), "aria-invalid": idError && idError !== "required" ? "true" : "false", placeholder: t("row.projectId"), onChange: function (event) { candidateState[1]({ path: candidateState[0].path, id: event.target.value }); } }),
                      React.createElement("span", { className: "ldv-governance-add-field-help" }, t("row.projectIdHelp")),
                      idErrorText
                        ? React.createElement("span", { className: "ldv-governance-add-field-error", role: "alert" }, idErrorText)
                        : null
                    )
                  ),
                  installErrorState[0]
                    ? React.createElement("div", { className: "ldv-governance-add-error", role: "alert" }, installErrorState[0])
                    : null,
                  React.createElement("div", { className: "ldv-governance-add-actions" },
                    React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: closeAddForm }, t("row.cancelAdd")),
                    React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", disabled: installBlocked, onClick: installCandidate }, projectBusyState[0] ? t("row.installBusy") : t("row.install"))
                  )
                )
              : null,
            projectRows
          )
        ),
        React.createElement("div", { className: "ldv-settings-footer" },
          savedState[0]
            ? React.createElement("span", { className: "ldv-settings-footer-status" }, t("row.saved"))
            : (saveErrorState[0] ? React.createElement("span", { className: "ldv-settings-footer-error", role: "alert" }, t("row.saveFailed")) : null),
          React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: !dirtyState[0] || busyState[0], onClick: discard }, t("row.discard")),
          React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", disabled: saveDisabled, onClick: save }, busyState[0] ? (t("row.save") + "\u2026") : t("row.save"))
        ),
        toastState[0] ? React.createElement(Toast, { key: toastState[0].seq, text: toastState[0].text, onDone: function () { toastState[1](null); } }) : null
      );
    }

    // ── settings card (collapsible, default collapsed) ───────────────────
    function LdvhSettingsCard(props) {
      var openState = React.useState(false);
      var t = props.t;
      var title = t("row.title");
      return React.createElement("li", { className: "ldv-settings-card" + (openState[0] ? " ldv-settings-card-open" : "") },
        React.createElement("button", {
          type: "button",
          className: "ldv-settings-card-header",
          "aria-expanded": openState[0],
          "aria-label": t(openState[0] ? "row.collapse" : "row.expand") + ": " + title,
          onClick: function () { openState[1](!openState[0]); }
        },
          React.createElement("img", { className: "ldv-settings-card-icon", src: LDVH_ICON, alt: "" }),
          React.createElement("span", { className: "ldv-settings-card-head" },
            React.createElement("span", { className: "ldv-settings-card-title" }, title),
            React.createElement("span", { className: "ldv-settings-card-desc" }, t("row.desc"))
          ),
          React.createElement("span", { className: "ldv-settings-card-chevron" + (openState[0] ? " ldv-settings-card-chevron-open" : ""), "aria-hidden": "true" },
            React.createElement(IconChevronDownOutline14, { size: 14 })
          )
        ),
        React.createElement("div", { className: "ldv-settings-card-body", hidden: !openState[0] },
          React.createElement(LdvhSettingsRow, props)
        )
      );
    }

    // ── governance-state mark (conversation.chat.turnTail, turn 1) ────────
    // A single green dot + label, shown ONLY for `governed` and only under
    // the conversation's first completed turn (see the registration below).
    // not_governed and unavailable render null: they carry no colour, and
    // unavailable is a not_governed special case, so it must not invent a
    // third signal. The state comes from the Host's always-on /ldvh/state
    // endpoint (NOT /ldvh/api, which the Web-presentation switch can
    // unmount).
    //
    // Fail-closed: any unresolved state renders nothing. Showing no mark is
    // the safe default; showing a wrong green mark would be a false governance
    // claim.
    //
    // RETRY: the Host records a session's scope when its agent/session-start
    // fires, which can happen AFTER the page has already rendered this mark
    // (observed: route mounted 23:21:08, component fetched 23:21:09, session
    // registered 23:21:15). `unknown` is therefore a TRANSIENT answer, not a
    // verdict — a single fetch that lands in that window would leave the mark
    // blank forever. So `unknown` (and transport failure) retries with a short
    // backoff, capped so a session that truly never starts does not poll
    // indefinitely. Definitive states (governed / not_governed / unavailable)
    // never retry.
    var MARK_RETRY_DELAY_MS = 1500;
    var MARK_RETRY_LIMIT = 20;
    function LdvhGovernanceMark(props) {
      var t = props.t;
      var sessionId = props.sessionId;
      var state = React.useState(null);
      React.useEffect(function () {
        if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
        var cancelled = false;
        var attempts = 0;
        // The Host owns the cwd→state judgement (it already resolves it for
        // the tools and the guidance section). The Client only knows its
        // sessionId, which `inject` receives — the dock Slot's props carry no
        // cwd (verified: cwd lives in useSessions().byId[…], which this Slot
        // does not receive).
        function attempt() {
          if (cancelled) return;
          fetch("/ldvh/state/governance?sessionId=" + encodeURIComponent(sessionId), { method: "GET", cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (body) {
              if (cancelled) return;
              var resolved = body && body.ok === true && body.state !== "unknown";
              if (resolved) {
                state[1](body);
              } else if (attempts < MARK_RETRY_LIMIT) {
                attempts += 1;
                setTimeout(attempt, MARK_RETRY_DELAY_MS);
              } else {
                state[1](null);
              }
            })
            .catch(function () {
              if (cancelled) return;
              if (attempts < MARK_RETRY_LIMIT) {
                attempts += 1;
                setTimeout(attempt, MARK_RETRY_DELAY_MS);
              } else {
                state[1](null);
              }
            });
        }
        attempt();
        return function () { cancelled = true; };
      }, [sessionId]);

      var value = state[0];
      if (value === null) return null;

      // Turn duration, straight off the Turn object the turnTail ownerProps
      // already carry. Same formula the shipped footer uses:
      // Math.max(0, end.time - start.time) (dsh-client-ui-chat
      // TurnTailNodeView). Renders only when both timestamps exist.
      var turn = props.turn;
      var runMs = turn && turn.start !== void 0 && turn.end !== void 0
        ? Math.max(0, turn.end.time - turn.start.time)
        : null;
      var durationLabel = null;
      if (runMs !== null) {
        var seconds = runMs / 1000;
        durationLabel = seconds < 60
          ? seconds.toFixed(1) + "s"
          : Math.floor(seconds / 60) + "m " + Math.round(seconds % 60) + "s";
      }

      if (value.state === "unavailable") {
        // Human decision (2026-09-03 update): unavailable shows a RED mark in
        // the flow. It still ACTS as not_governed (no tools, no controlled
        // operations) — the colour only makes the degraded state visible; the
        // full remediation path lives in the system-prompt guidance, the
        // tooltip keeps a one-line pointer.
        var unavailableLabel = t("mark.unavailable");
        return React.createElement(
          "div",
          { className: "ldv-mark ldv-mark-unavailable", title: t("mark.unavailableHint") },
          React.createElement("span", { className: "ldv-mark-dot" }),
          React.createElement("span", null, durationLabel === null ? unavailableLabel : unavailableLabel + " · " + durationLabel)
        );
      }
      if (value.state !== "governed") return null;
      var name = value.project && value.project.name ? value.project.name : null;
      var label = name ? t("mark.governedWithName").replace("{name}", name) : t("mark.governed");
      if (durationLabel !== null) label = label + " · " + durationLabel;
      return React.createElement(
        "div",
        { className: "ldv-mark", title: label },
        React.createElement("span", { className: "ldv-mark-dot" }),
        React.createElement("span", null, label)
      );
    }

    // ── LDVH conversation view: iframe /ldvh/ with loading/error states ──
    // Rendered inside the session body when the "LDVH" tab is active
    // (conversation.view ring, exactly like the trajectory view).
    function LdvhConversationView(props) {
      var t = props.t;
      var viewState = React.useState({ checking: true, ready: false, failed: false });
      React.useEffect(function () {
        var cancelled = false;
        checkHealth(function (ok) {
          if (cancelled) return;
          viewState[1](ok ? { checking: false, ready: true, failed: false } : { checking: false, ready: false, failed: true });
        });
        return function () { cancelled = true; };
      }, []);
      function retry() {
        viewState[1]({ checking: true, ready: false, failed: false });
        checkHealth(function (ok) {
          viewState[1](ok ? { checking: false, ready: true, failed: false } : { checking: false, ready: false, failed: true });
        });
      }
      var state = viewState[0];
      var body = null;
      if (state.checking) {
        body = React.createElement("div", { className: "ldv-view-state" },
          React.createElement("p", null, t("view.loading"))
        );
      } else if (state.failed) {
        body = React.createElement("div", { className: "ldv-view-state" },
          React.createElement("p", null, t("view.error")),
          React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", onClick: retry }, t("view.retry"))
        );
      } else {
        body = React.createElement("iframe", {
          className: "ldv-view-frame",
          src: "/ldvh/",
          title: t("view.label")
        });
      }
      return React.createElement("div", { className: "ldv-view" }, body);
    }

    // ── apply: inject the contributions ──────────────────────────────────
    var inject = ["slots", "locale", "settingsScope"];

    function apply(ctx) {
      try {
        ctx.effect(function () {
          return ctx.locale.register(LDVH_NS, { zh: LDVH_ZH, en: LDVH_EN });
        }, "dsh-ldvh: settings copy");

        var t = ctx.locale.bind(LDVH_NS);
        var ldvhScope = ctx.settingsScope.bind({ namespace: "dsh-ldvh" });
        var rowInjected = function () {
          return { t: t, settingsScope: ldvhScope, directoryPicker: ctx.get("remote.directoryPicker") };
        };

        // 1) settings card: match dsh-connect-workbuddy's keyed contribution.
        ctx.slots.inject("settings.plugin.item", function () {
          return ctx.slots.register({
            name: "settings.plugin.item",
            key: "dsh-ldvh",
            priority: 30,
            inject: rowInjected
          }, LdvhSettingsCard);
        });

        // 2) LDVH view tab, trajectory-analogue (conversation.view / list / session)
        ctx.slots.inject("conversation.view", function () {
          return ctx.slots.register({
            name: "conversation.view",
            id: "ldvh",
            order: 20,
            label: function () { return t("view.label"); },
            inject: function (sessionId) { return { t: t, sessionId: sessionId }; }
          }, LdvhConversationView);
        });

        // 3) governance-state mark inside the conversation flow
        //    (conversation.chat.turnTail, chain/session). Human decision
        //    (2026-09-02): the mark appears ONCE — under the first completed
        //    turn of a governed session — and scrolls with the flow, instead
        //    of a persistent row above the composer. Chain semantics (verified
        //    against dsh-client-ui-renderer renderOutletContent + the
        //    dsh-deliverables precedent): select(owner) is called per
        //    completed turn; the first non-null entry is elected and its
        //    component renders above that turn's usage/actions footer. Turn
        //    ids are sequential per session record (verified in the session
        //    JSONL: 1,2,3…), so `turn 1` is a stable anchor for "the
        //    conversation's first turn" — including continued conversations,
        //    whose replayed history is renumbered into the new record.
        ctx.slots.inject("conversation.chat.turnTail", function () {
          return ctx.slots.register({
            name: "conversation.chat.turnTail",
            select: function (owner) {
              var turnId = owner && owner.turn ? owner.turn.turn : void 0;
              // Accept the raw number and its string form; anything else —
              // including a missing turn — declines (renders nothing).
              if (turnId !== 1 && turnId !== "1") return null;
              return { mark: true };
            },
            // inject receives the sessionId (a string) for session-scoped
            // slots; the mark fetches the governance state from the Host with
            // it (see LdvhGovernanceMark).
            inject: function (sessionId) { return { t: t, sessionId: sessionId }; }
          }, LdvhGovernanceMark);
        });
      } catch (error) {
        // Match WorkBuddy's browser failure boundary: Host remains functional,
        // developers see the cause, users do not get a page-level red banner.
        console.error("[dsh-ldvh] client UI failed to load (host routes unaffected):", error);
      }
    }

    return { apply: apply, inject: inject };
  }
});