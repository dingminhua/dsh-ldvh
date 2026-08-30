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

    // ── icon (compact SVG data URI, LDVH mark) ──────────────────────────
    var LDVH_ICON =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
          '<rect width="64" height="64" rx="14" fill="#101114"/>' +
          '<rect x="14" y="14" width="36" height="36" rx="8" fill="none" stroke="#5686fe" stroke-width="4"/>' +
          '<path d="M24 40V24h8a6 6 0 0 1 0 12h-4l6 4" fill="none" stroke="#e6e6e6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
        "</svg>"
      );

    var SETTINGS_CSS = "" +
      ".ldv-settings{display:flex;flex-direction:column;gap:14px;margin:0;padding:0}" +
      ".ldv-settings-field{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-settings-input{width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#232529);color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;line-height:1.5}" +
      ".ldv-settings-input:focus{outline:2px solid var(--dsw-alias-state-business-primary,#5686fe);outline-offset:1px}" +
      ".ldv-settings-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ldv-settings-toggle{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-settings-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:4px}" +
      ".ldv-settings-footer-status{font-size:12px;color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ldv-settings-footer-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-settings-card{list-style:none}" +
      ".ldv-settings-card-header{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;padding:8px 4px;cursor:pointer;color:var(--dsw-alias-label-primary,#e6e6e6)}" +
      ".ldv-settings-card-icon{width:28px;height:28px;border-radius:8px;flex:none}" +
      ".ldv-settings-card-head{display:flex;flex-direction:column;gap:2px;min-width:0;text-align:left}" +
      ".ldv-settings-card-title{font-size:13px;font-weight:600}" +
      ".ldv-settings-card-desc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ldv-settings-card-chevron{margin-left:auto;color:var(--dsw-alias-label-tertiary,#999);transition:transform .15s}" +
      ".ldv-settings-card-chevron-open{transform:rotate(180deg)}" +
      ".ldv-settings-card-body{padding:4px 4px 10px}" +
      ".ldv-view{position:relative;width:100%;height:100%;min-height:0}" +
      ".ldv-view-frame{position:absolute;inset:0;width:100%;height:100%;border:0}" +
      ".ldv-view-state{position:absolute;inset:0;display:grid;place-items:center;gap:10px;align-content:center;text-align:center;padding:24px}" +
      ".ldv-view-state p{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#b8b8b8);margin:0;max-width:520px}" +
      ".ldv-btn{height:30px;padding:0 14px;border-radius:8px;font:inherit;font-size:12px;cursor:pointer}" +
      ".ldv-btn-primary{border:1px solid var(--dsw-alias-state-business-primary,#5686fe);background:var(--dsw-alias-state-business-primary,#5686fe);color:#fff}" +
      ".ldv-btn-outline{border:1px solid var(--dsw-alias-border-l2,#36373b);background:transparent;color:var(--dsw-alias-label-secondary,#b8b8b8)}" +
      ".ldv-btn:disabled{opacity:.5;cursor:default}";

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
      "row.desc": "LDVH 深度绑定 DSH 的工作面板与 Web 呈现。",
      "row.governanceDirectory": "默认管辖配置存放目录",
      "row.governanceHint": "绝对路径。留空使用 DSH 用户配置根默认位置（经 DSH 正式路径 API 解析，如 ~/.dsh/ldvh/）。",
      "row.webEnabled": "启用 LDVH Web 路由（/ldvh）",
      "row.webHint": "关闭后立即移除 /ldvh 与 /ldvh/api 路由；重新打开即恢复。",
      "row.save": "保存",
      "row.discard": "放弃修改",
      "row.saved": "已保存",
      "row.saveFailed": "保存失败，请重试。",
      "row.toastSaved": "LDVH 设置已保存。",
      "view.label": "LDVH",
      "view.loading": "正在加载 LDVH Web…",
      "view.error": "LDVH Web 当前不可用，请检查插件设置中的路由开关，或稍后重试。",
      "view.retry": "重试"
    };
    var LDVH_EN = {
      "row.title": "LD Vibe Harness (dsh-ldvh)",
      "row.desc": "LDVH panel and Web presentation bound to DSH.",
      "row.governanceDirectory": "Default governance config directory",
      "row.governanceHint": "Absolute path. Leave empty for the DSH user-config default (resolved via the official DSH path API, e.g. ~/.dsh/ldvh/).",
      "row.webEnabled": "Enable LDVH web routes (/ldvh)",
      "row.webHint": "Turning this off removes the /ldvh and /ldvh/api routes immediately; turning it back on restores them.",
      "row.save": "Save",
      "row.discard": "Discard",
      "row.saved": "Saved",
      "row.saveFailed": "Could not save. Try again.",
      "row.toastSaved": "LDVH settings saved.",
      "view.label": "LDVH",
      "view.loading": "Loading LDVH Web…",
      "view.error": "LDVH Web is unavailable. Check the route switch in plugin settings, or try again later.",
      "view.retry": "Retry"
    };

    // Health probe: the view is "ready" only when /ldvh/api/health answers.
    function checkHealth(then) {
      fetch("/ldvh/api/health", { method: "GET", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (body) { then(body && body.ok === true); })
        .catch(function () { then(false); });
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

    // ── LdvhSettingsRow: governance directory + web switch ───────────────
    function LdvhSettingsRow(props) {
      var t = props.t;
      var scope = props.settingsScope;
      var snap = useSettingsScopeSnapshot(scope);
      var value = (snap && snap.status === "ready" && snap.value) || {};
      var dirState = React.useState(typeof value.governanceDirectory === "string" ? value.governanceDirectory : "");
      var enabledState = React.useState(value.webEnabled !== false);
      var dirtyState = React.useState(false);
      var busyState = React.useState(false);
      var savedState = React.useState(false);
      var saveErrorState = React.useState(false);
      var toastState = React.useState(null);
      var toastSeq = React.useRef(0);

      React.useEffect(function () {
        if (dirtyState[0] || busyState[0]) return;
        var next = (snap && snap.status === "ready" && snap.value) || {};
        dirState[1](typeof next.governanceDirectory === "string" ? next.governanceDirectory : "");
        enabledState[1](next.webEnabled !== false);
        savedState[1](false);
        saveErrorState[1](false);
      }, [snap ? snap.revision : -1, dirtyState[0], busyState[0]]);

      function markDirty() {
        savedState[1](false);
        saveErrorState[1](false);
        dirtyState[1](true);
      }
      function save() {
        if (!snap || snap.status !== "ready" || snap.writable === false || busyState[0]) return;
        busyState[1](true);
        Promise.resolve()
          .then(function () { return scope.set("governanceDirectory", dirState[0]); })
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
        dirState[1](typeof next.governanceDirectory === "string" ? next.governanceDirectory : "");
        enabledState[1](next.webEnabled !== false);
        dirtyState[1](false);
        savedState[1](false);
        saveErrorState[1](false);
      }

      var saveDisabled = !snap || snap.status !== "ready" || snap.writable === false || busyState[0] || !dirtyState[0];
      return React.createElement("section", { className: "ldv-settings" },
        React.createElement("label", { className: "ldv-settings-field" },
          t("row.governanceDirectory"),
          React.createElement("input", {
            className: "ldv-settings-input",
            type: "text",
            value: dirState[0],
            spellCheck: false,
            placeholder: "~/.dsh/ldvh/",
            onChange: function (e) { dirState[1](e.target.value); markDirty(); }
          }),
          React.createElement("span", { className: "ldv-settings-hint" }, t("row.governanceHint"))
        ),
        React.createElement("label", { className: "ldv-settings-toggle" },
          React.createElement("input", {
            type: "checkbox",
            checked: enabledState[0],
            onChange: function (e) { enabledState[1](e.target.checked); markDirty(); }
          }),
          React.createElement("span", null, t("row.webEnabled")),
          React.createElement("span", { className: "ldv-settings-hint" }, t("row.webHint"))
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
      return React.createElement("li", { className: "ldv-settings-card" },
        React.createElement("button", {
          type: "button",
          className: "ldv-settings-card-header",
          "aria-expanded": openState[0],
          onClick: function () { openState[1](!openState[0]); }
        },
          React.createElement("img", { className: "ldv-settings-card-icon", src: LDVH_ICON, alt: "" }),
          React.createElement("span", { className: "ldv-settings-card-head" },
            React.createElement("span", { className: "ldv-settings-card-title" }, title),
            React.createElement("span", { className: "ldv-settings-card-desc" }, t("row.desc"))
          ),
          React.createElement("span", { className: "ldv-settings-card-chevron" + (openState[0] ? " ldv-settings-card-chevron-open" : ""), "aria-hidden": "true" }, "\u25be")
        ),
        React.createElement("div", { className: "ldv-settings-card-body", hidden: !openState[0] },
          React.createElement(LdvhSettingsRow, props)
        )
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
    var inject = ["slots", "locale", "settingsScope", "connection"];

    function apply(ctx) {
      ctx.locale.register(LDVH_NS, "zh", LDVH_ZH);
      ctx.locale.register(LDVH_NS, "en", LDVH_EN);

      var ldvhScope = ctx.settingsScope.bind({ namespace: "dsh-ldvh" });
      var rowInjected = function () {
        return { settingsScope: ldvhScope };
      };

      // 1) settings card (keyed "dsh-ldvh")
      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register({
          name: "settings.plugin.item",
          key: "dsh-ldvh",
          locale: LDVH_NS,
          inject: rowInjected
        }, LdvhSettingsCard);
      });

      // 2) LDVH view tab, trajectory-analogue (conversation.view / list / session)
      ctx.slots.inject("conversation.view", function () {
        return ctx.slots.register({
          name: "conversation.view",
          id: "ldvh",
          order: 20,
          locale: LDVH_NS,
          label: function () { return ctx.locale.bind(LDVH_NS)("view.label"); },
          inject: function (sessionId) { return { sessionId: sessionId }; }
        }, LdvhConversationView);
      });
    }

    return { apply: apply, inject: inject };
  }
});