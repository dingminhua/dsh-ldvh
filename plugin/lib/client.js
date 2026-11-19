
window.__ModuleLoader__.load({
  id: "dsh-ldvh",
  factory: function (require) {
    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var Toast = primitives.Toast;

    var LDVH_ICON = "data:image/png;base64,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";

    var LDVH_GITHUB_URL = "https://github.com/dingminhua/dsh-ldvh";

    var LDVH_BLOCK_ICONS = {
      services: [
        { t: "rect", p: { x: 1.8, y: 3, width: 12.4, height: 9.4, rx: 1.6 } },
        { t: "line", p: { x1: 1.8, y1: 6.2, x2: 14.2, y2: 6.2 } },
        { t: "line", p: { x1: 6.2, y1: 13.4, x2: 9.8, y2: 13.4 } }
      ],
      idle: [
        { t: "circle", p: { cx: 8, cy: 8, r: 5.7 } },
        { t: "path", p: { d: "M8 4.7V8l2.3 1.5" } }
      ],
      budget: [
        { t: "line", p: { x1: 2.4, y1: 5.2, x2: 13.6, y2: 5.2 } },
        { t: "line", p: { x1: 2.4, y1: 10.8, x2: 13.6, y2: 10.8 } },
        { t: "circle", p: { cx: 5.6, cy: 5.2, r: 1.7 } },
        { t: "circle", p: { cx: 10.6, cy: 10.8, r: 1.7 } }
      ],
      review: [
        { t: "path", p: { d: "M8 2.2l5 2v4.1c0 3-2.1 5.4-5 6.5-2.9-1.1-5-3.5-5-6.5V4.2z" } },
        { t: "path", p: { d: "M5.9 8.1l1.6 1.6 2.9-3.2" } }
      ],
      projects: [
        { t: "path", p: { d: "M1.9 4.6a1 1 0 0 1 1-1h3.2l1.4 1.7h5.6a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1z" } }
      ]
    };

    var SETTINGS_CSS =
      ".ldv-settings{--ldv-ink:var(--dsw-alias-label-primary,currentColor);--ldv-body:var(--dsw-alias-label-secondary,currentColor);--ldv-meta:var(--dsw-alias-label-tertiary,currentColor);--ldv-accent:var(--dsw-alias-state-business-primary,#4176e6);--ldv-silent:var(--dsw-alias-state-warning-primary,#f59e0b);--ldv-hair:color-mix(in srgb,var(--ldv-ink) 8%,transparent);display:flex;flex-direction:column;gap:16px;margin:0;padding:0 0 4px;color:var(--ldv-ink);container-type:inline-size;container-name:ldv-settings}" +
      ".ldv-intro{position:relative;display:flex;align-items:flex-start;gap:12px;padding:2px 2px 15px}" +
      ".ldv-intro:after{content:'';position:absolute;left:2px;right:2px;bottom:0;height:1px;background:var(--ldv-hair)}" +
      ".ldv-intro-icon{width:32px;height:32px;flex:none;border-radius:8px;display:block;box-shadow:0 0 0 1px color-mix(in srgb,var(--ldv-ink) 10%,transparent)}" +
      ".ldv-intro-body{display:flex;flex-direction:column;gap:3px;min-width:0}" +
      ".ldv-intro-title-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}" +
      ".ldv-intro-title{font-size:18px;font-weight:600;line-height:24px;letter-spacing:.01em;color:var(--ldv-ink)}" +
      ".ldv-intro-badge{font-size:11px;font-weight:600;line-height:16px;padding:1px 8px;border-radius:999px;color:color-mix(in srgb,var(--ldv-accent) 62%,var(--ldv-ink));background:color-mix(in srgb,var(--ldv-accent) 12%,transparent);white-space:nowrap}" +
      ".ldv-intro-values{display:flex;flex-direction:column;gap:4px;margin-top:7px}" +
      ".ldv-intro-value{font-size:12px;font-weight:400;line-height:19px;color:var(--ldv-body);text-wrap:pretty}" +
      ".ldv-intro-value strong{font-weight:600;color:var(--ldv-ink)}" +
      ".ldv-block{position:relative;display:flex;flex-direction:column;min-width:0;padding:0;border:1px solid color-mix(in srgb,var(--ldv-ink) 7%,transparent);border-radius:12px;background:var(--dsw-alias-bg-module-platform,color-mix(in srgb,currentColor 4%,transparent));box-shadow:none;overflow:hidden}" +
      ".ldv-block-head{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:9px;padding:15px 16px 13px;background:transparent}" +
      ".ldv-block-head:after{content:'';position:absolute;left:16px;right:16px;bottom:0;height:1px;background:var(--ldv-hair)}" +
      ".ldv-block-icon{display:grid;place-items:center;width:16px;height:16px;flex:none;color:var(--ldv-body)}" +
      ".ldv-block-icon svg{width:16px;height:16px;display:block}" +
      ".ldv-block-title-line{display:flex;align-items:center;gap:8px;min-width:0}" +
      ".ldv-block-title{font-size:15px;font-weight:600;line-height:22px;letter-spacing:.01em;color:var(--ldv-ink)}" +
      ".ldv-row{position:relative;display:flex;flex-direction:column;gap:6px;padding:14px 16px;border-top:none}" +
      ".ldv-row:after{content:'';position:absolute;left:16px;right:16px;top:0;height:1px;background:var(--ldv-hair)}" +
      ".ldv-row:first-child:after{display:none}" +
      ".ldv-block-desc{flex-basis:100%;margin-top:8px;font-size:12px;font-weight:400;line-height:20px;color:var(--ldv-body);text-wrap:pretty}" +
      ".ldv-block-control{flex:none;display:flex;align-items:center;gap:8px}" +
      ".ldv-block-toggle{margin-left:auto}" +
      ".ldv-block-action{margin-left:auto}" +
      ".ldv-block-body{display:flex;flex-direction:column}" +
      ".ldv-row-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}" +
      ".ldv-row-title{min-width:0;font-size:14px;font-weight:500;line-height:21px;color:var(--ldv-ink)}" +
      ".ldv-row-desc{font-size:12px;font-weight:400;line-height:20px;color:var(--ldv-body);text-wrap:pretty}" +
      ".ldv-row-desc strong{font-weight:600;color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-row-control{flex:none;display:flex;align-items:center}" +
      ".ldv-note{position:relative;display:flex;flex-direction:column;gap:2px;margin:0;padding:13px 16px 15px}" +
      ".ldv-note:before{content:'';position:absolute;left:16px;right:16px;top:0;height:1px;background-image:repeating-linear-gradient(90deg,color-mix(in srgb,var(--ldv-ink) 13%,transparent) 0 4px,transparent 4px 9px)}" +
      ".ldv-note-title{font-size:12px;font-weight:600;line-height:19px;color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-note-text{font-size:12px;font-weight:400;line-height:19px;color:var(--dsw-alias-label-secondary,currentColor);text-wrap:pretty}" +
      ".ldv-count{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:600;line-height:16px;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary,currentColor) 16%,transparent);color:var(--dsw-alias-label-secondary,currentColor)}" +
      ".ldv-status-value{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;line-height:16px;flex:none;padding:1px 9px;border-radius:999px;background:color-mix(in srgb,currentColor 12%,transparent)}" +
      ".ldv-status-value:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}" +
      ".ldv-status-ok{color:var(--dsw-alias-state-success-primary,#34d399)}" +
      ".ldv-status-fail{color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-status-wait{color:var(--dsw-alias-label-tertiary,currentColor)}" +
      ".ldv-settings-input{box-sizing:border-box;appearance:none;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));border-radius:6px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--ldv-ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-variant-numeric:tabular-nums;line-height:1.5}" +
      ".ldv-field-input{width:82px;flex:none}" +
      ".ldv-field-select{width:96px;flex:none;padding-right:24px}" +
      ".ldv-select{position:relative;display:inline-flex;align-items:center}" +
      ".ldv-select:after{content:'';position:absolute;right:9px;top:50%;width:6px;height:6px;margin-top:-4px;border-right:1px solid var(--dsw-alias-label-secondary,currentColor);border-bottom:1px solid var(--dsw-alias-label-secondary,currentColor);transform:rotate(45deg);pointer-events:none}" +
      ".ldv-field-invalid{font-size:11px;font-weight:400;line-height:16px;color:var(--dsw-alias-state-error-primary,#f56c6c)}" +
      ".ldv-settings-input.is-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 60%,transparent)}" +
      ".ldv-settings-input[aria-invalid='true']{border-color:var(--dsw-alias-state-error-primary,#f56c6c)}" +
      ".ldv-settings-input:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#5686fe);box-shadow:0 0 0 3px rgba(86,134,254,.22)}" +
      ".ldv-settings-input.is-error:focus-visible{border-color:var(--dsw-alias-state-error-primary,#f56c6c);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 22%,transparent)}" +
      ".ldv-switch{position:relative;display:inline-block;width:36px;height:20px;flex:none;cursor:pointer}" +
      ".ldv-switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}" +
      ".ldv-switch-track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-border-l3,#ffffff29);transition:background .12s ease}" +
      ".ldv-switch-track:after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb,currentColor);transition:transform .12s ease}" +
      ".ldv-switch input:checked+.ldv-switch-track{background:var(--ldv-accent)}" +
      ".ldv-switch input:checked+.ldv-switch-track:after{background:var(--dsw-alias-label-on-color,#ffffff);transform:translateX(16px)}" +
      ".ldv-switch input:focus-visible+.ldv-switch-track{outline:2px solid var(--ldv-accent);outline-offset:2px}" +
      ".ldv-switch input:disabled+.ldv-switch-track{opacity:.5;cursor:not-allowed}" +
      ".ldv-silent-control{display:inline-flex;align-items:center;gap:8px;flex:none}" +
      ".ldv-silent-badge{font-size:11px;font-weight:600;line-height:16px;padding:1px 7px;border-radius:999px;color:color-mix(in srgb,var(--ldv-silent) 55%,var(--ldv-ink));background:color-mix(in srgb,var(--ldv-silent) 16%,transparent);white-space:nowrap}" +
      ".ldv-switch-silent input:checked+.ldv-switch-track{background:var(--ldv-silent)}" +
      ".ldv-switch-silent input:checked+.ldv-switch-track:after{background:var(--dsw-alias-label-on-color,#ffffff)}" +
      ".ldv-switch-silent input:focus-visible+.ldv-switch-track{outline-color:var(--ldv-silent)}" +
      ".ldv-governance-add{display:flex;flex-direction:column;gap:13px;margin:14px 16px;padding:14px;border:1px solid var(--ldv-hair);border-radius:10px;background:var(--dsw-alias-bg-layer-2,transparent)}" +
      ".ldv-governance-add-head{display:flex;align-items:flex-start;gap:9px}" +
      ".ldv-governance-add-icon{display:grid;place-items:center;width:22px;height:22px;flex:none;border:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));border-radius:5px;color:var(--dsw-alias-label-secondary,currentColor);font-size:14px;font-weight:400;line-height:1;background:transparent}" +
      ".ldv-governance-add-copy{display:flex;flex-direction:column;gap:2px;min-width:0}" +
      ".ldv-governance-add-title{font-size:13px;font-weight:600;line-height:19px;color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-governance-add-hint{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary,currentColor)}" +
      ".ldv-governance-add-fields{display:flex;flex-direction:column;gap:13px}" +
      ".ldv-governance-add-field{display:flex;flex-direction:column;gap:6px;min-width:0}" +
      ".ldv-governance-add-label{font-size:12px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor)}" +
      ".ldv-governance-add-field-help{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor)}" +
      ".ldv-governance-add-field-error{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-governance-path-control{display:flex;min-width:0}" +
      ".ldv-governance-path-control .ldv-settings-input{flex:1;min-width:0;border-radius:6px 0 0 6px}" +
      ".ldv-governance-path-control .ldv-btn{height:32px;flex:none;border-left:0;border-radius:0 6px 6px 0;white-space:nowrap}" +
      ".ldv-governance-add-actions{display:flex;justify-content:flex-end;gap:8px}" +
      ".ldv-governance-add-actions .ldv-btn{min-width:76px}" +
      ".ldv-governance-add-error{padding:8px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 35%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent);font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-state-error-primary,#ef4444);word-break:break-word}" +
      ".ldv-governance-empty{display:flex;flex-direction:column;align-items:center;gap:6px;margin:0;padding:22px 16px;text-align:center}" +
      ".ldv-governance-empty-icon{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;border:1px dashed var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));color:var(--dsw-alias-label-tertiary,currentColor);font-size:16px;font-weight:600}" +
      ".ldv-governance-empty-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary,currentColor)}" +
      ".ldv-governance-empty-text{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor)}" +
      ".ldv-governance-error{margin:0 16px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 45%,transparent);border-left:3px solid var(--dsw-alias-state-error-primary,#ef4444);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent);font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-primary,currentColor);word-break:break-word}" +
      ".ldv-projects{display:flex;flex-direction:column;gap:8px;padding:14px 16px}" +
      ".ldv-project-card{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--ldv-hair);border-radius:10px;background:var(--dsw-alias-bg-layer-2,transparent)}" +
      ".ldv-project-head{display:flex;align-items:flex-start;gap:12px}" +
      ".ldv-project-idline{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;min-width:0}" +
      ".ldv-project-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-project-path{flex-basis:100%;font-size:12px;font-weight:400;line-height:18px;word-break:break-all;color:var(--dsw-alias-label-tertiary,currentColor);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}" +
      ".ldv-project-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}" +
      ".ldv-palette{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--ldv-hair)}" +
      ".ldv-palette-label{font-size:12px;font-weight:400;color:var(--ldv-meta);flex:none;margin-right:2px}" +
      ".ldv-palette-dot{position:relative;width:16px;height:16px;border-radius:50%;border:none;padding:0;cursor:pointer;flex:none;opacity:.72;transition:transform .12s,opacity .12s}" +
      ".ldv-palette-dot:hover,.ldv-palette-dot:focus-visible{transform:scale(1.12);opacity:1}" +
      ".ldv-palette-dot:disabled{cursor:not-allowed;opacity:.4}" +
      ".ldv-palette-dot-active{opacity:1;box-shadow:0 0 0 2px var(--dsw-alias-bg-module-platform,#f5f6f7),0 0 0 3.5px color-mix(in srgb,var(--ldv-ink) 38%,transparent)}" +
      ".ldv-palette-check{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.55);pointer-events:none}" +
      ".ldv-palette-dot-locked{opacity:.25}" +
      ".ldv-palette-dot-locked:hover{transform:none}" +
      ".ldv-palette-auto{flex:none;margin-left:auto}" +
      ".ldv-check{position:relative;display:inline-flex;align-items:center;gap:0;min-height:20px;padding-left:21px;cursor:pointer}" +
      ".ldv-check input{position:absolute;left:0;top:50%;margin:-7px 0 0;width:14px;height:14px;opacity:0;cursor:pointer}" +
      ".ldv-check:before{content:'';position:absolute;left:0;top:50%;margin-top:-7px;width:14px;height:14px;border:1px solid var(--dsw-alias-border-l3,color-mix(in srgb,currentColor 12%,transparent));border-radius:3px;background:transparent}" +
      ".ldv-check:has(input:checked):before{background:var(--dsw-alias-state-business-primary,#5686fe);border-color:var(--dsw-alias-state-business-primary,#5686fe)}" +
      ".ldv-check:has(input:checked):after{content:'';position:absolute;left:4px;top:50%;margin-top:-4px;width:4px;height:8px;border-right:1.5px solid var(--dsw-alias-label-on-color,#ffffff);border-bottom:1.5px solid var(--dsw-alias-label-on-color,#ffffff);transform:rotate(45deg)}" +
      ".ldv-check:has(input:focus-visible):before{outline:2px solid var(--dsw-alias-state-business-primary,#5686fe);outline-offset:2px}" +
      ".ldv-check-label{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary,currentColor);user-select:none}" +
      ".ldv-palette-auto-on .ldv-check-label{color:var(--dsw-alias-state-business-primary,#5686fe);font-weight:600}" +
      ".ldv-settings-hint{font-size:12px;font-weight:400;line-height:18px;color:var(--ldv-body)}" +
      ".ldv-block-body>.ldv-settings-hint{display:block;padding:12px 16px 0}" +
      ".ldv-settings-hint strong{font-weight:600;color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:6px;padding:6px 13px;font-size:13px;font-weight:500;line-height:1.5;transition:opacity .16s,border-color .16s}" +
      ".ldv-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}" +
      ".ldv-btn-primary{background:var(--dsw-alias-label-primary,currentColor);color:var(--dsw-alias-bg-layer-3,#202126)}" +
      ".ldv-btn-outline{border-color:var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));color:var(--dsw-alias-label-secondary,currentColor);background:transparent}" +
      ".ldv-btn-primary:hover:not(:disabled){opacity:.9}" +
      ".ldv-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary,currentColor);border-color:var(--dsw-alias-label-dimmed,#777);background:rgba(255,255,255,.04)}" +
      ".ldv-btn:disabled{opacity:.4;cursor:default}" +
      ".ldv-btn-dirty{font-weight:600;box-shadow:0 0 0 2px color-mix(in srgb,currentColor 45%,transparent)}" +
      ".ldv-settings-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px;padding:16px 0 4px;border-top:1px solid var(--ldv-hair)}" +
      ".ldv-settings-footer-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}" +
      ".ldv-settings-footer-status{flex:1;min-width:0;font-size:12px;font-weight:400;line-height:1.5;color:var(--dsw-alias-label-tertiary,currentColor)}" +
      ".ldv-settings-footer-error{flex:1;min-width:0;font-size:12px;font-weight:400;line-height:1.5;color:var(--dsw-alias-state-error-primary,#ef4444)}" +
      ".ldv-settings-cheer{display:inline-flex;align-items:center;gap:4px;flex:none;text-decoration:underline;text-underline-offset:2px;color:var(--dsw-alias-label-tertiary,currentColor);font-size:13px;line-height:1.5;transition:color .16s}" +
      ".ldv-settings-cheer-star{font-size:12px;line-height:1;display:inline-flex}" +
      ".ldv-settings-cheer:hover{color:var(--dsw-alias-label-primary,currentColor)}" +
      ".ldv-settings-cheer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}" +
      "@container ldv-settings (max-width:420px){.ldv-block{border-radius:10px}.ldv-block-head{padding:14px 14px 12px}.ldv-block-head:after{left:14px;right:14px}.ldv-row{padding:13px 14px}.ldv-row:after{left:14px;right:14px}.ldv-note{padding:12px 14px 14px}.ldv-note:before{left:14px;right:14px}.ldv-projects{padding:12px 14px}.ldv-governance-add{margin:12px 14px}.ldv-block-head,.ldv-row{gap:8px}.ldv-governance-path-control{display:grid;gap:8px}.ldv-governance-path-control .ldv-settings-input{border-radius:6px}.ldv-governance-path-control .ldv-btn{border-left:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));border-radius:6px}.ldv-governance-add-actions,.ldv-project-actions{justify-content:stretch}.ldv-governance-add-actions .ldv-btn,.ldv-project-actions .ldv-btn{flex:1;min-width:0}}" +
      "@container ldv-settings (max-width:300px){.ldv-row-head{flex-wrap:wrap}.ldv-field-input,.ldv-field-select{width:160px}}" +
      ".ldv-view{position:relative;width:100%;height:100%;min-height:0}" +
      ".ldv-view-frame{position:absolute;inset:0;width:100%;height:100%;border:0}" +
      ".ldv-view-state{position:absolute;inset:0;display:grid;place-items:center;gap:10px;align-content:center;text-align:center;padding:24px}" +
      ".ldv-view-state p{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,currentColor);margin:0;max-width:520px}" +
      "";
;

    var GATE_CSS = "" +
      "[data-question-key]{display:flex;justify-content:center;padding:10px calc(var(--dsh-composer-side-clearance,16px) + 16px) 14px}" +
      "[data-question-key] section{border-radius:var(--dsw-radius-panel,28px);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-stroke,0 0 0 .5px var(--dsw-alias-border-l2)),var(--dsw-elevation-panel,0 3px 8px rgba(0,0,0,.03)),0 12px 32px rgba(0,0,0,.08);overflow:hidden}" +
      "[data-question-key] section[class*=\"cardMinimized\"]{max-height:none;overflow:visible}" +
      "[data-question-key] header{padding:18px 14px 0 20px}" +
      "[data-question-key] [class*=\"eyebrow\"]{display:inline-flex;align-items:center;height:22px;padding:0 9px;margin-bottom:8px;border-radius:999px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;letter-spacing:.02em;line-height:16px}" +
      "[data-question-key] h2{font-size:16px;font-weight:600;letter-spacing:-.01em;line-height:24px}" +
      "[data-question-key] [data-question-scroll]{padding:2px 8px 0;overscroll-behavior:contain}" +
      "[data-question-key] [class*=\"options\"]{gap:0;margin:10px 0 0;padding:0 12px}" +
      "[data-question-key] [class*=\"detail\"]{margin:10px 12px 2px;padding:10px 12px;border-left:2px solid var(--dsw-alias-border-l4);border-radius:0 var(--dsw-radius-sm,8px) var(--dsw-radius-sm,8px) 0;background:color-mix(in srgb,var(--dsw-alias-bg-module-platform) 55%,transparent);font-size:13px;line-height:21px}" +
      "[data-question-key] [data-option-row]{position:relative;box-sizing:border-box;min-height:48px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);background:color-mix(in srgb,var(--dsw-alias-bg-module-platform) 45%,transparent);transition:background-color .14s ease,border-color .14s ease,box-shadow .14s ease,transform .14s ease}" +
      "[data-question-key] [data-option-row]+[data-option-row]{margin-top:6px}" +
      "[data-question-key] [data-option-row] [role=\"radio\"],[data-question-key] [data-option-row] [role=\"checkbox\"]{position:relative;box-sizing:border-box;min-height:0;padding:10px 12px;border:0;background:transparent;box-shadow:none;text-align:left;cursor:pointer}" +
      "[data-question-key] [data-option-row]:hover:not(:has([role=\"radio\"]:disabled)):not(:has([role=\"checkbox\"]:disabled)){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4);transform:translateY(-.5px)}" +
      "[data-question-key] [data-option-row]:active:not(:has([role=\"radio\"]:disabled)):not(:has([role=\"checkbox\"]:disabled)){transform:translateY(0)}" +
      "[data-question-key] [data-option-row][class*=\"optionSelected\"]{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 9%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent)}" +
      "[data-question-key] [role=\"radio\"]:focus-visible,[data-question-key] [role=\"checkbox\"]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}" +
      "[data-question-key] [data-option-row]:has([role=\"radio\"]:disabled),[data-question-key] [data-option-row]:has([role=\"checkbox\"]:disabled){cursor:default;opacity:.55;transform:none}" +
      "[data-question-key] [class*=\"number\"]{width:18px;flex:0 0 18px;height:18px;margin-top:3px;border:1px solid var(--dsw-alias-border-l4);border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;line-height:16px;transition:background-color .14s ease,border-color .14s ease,color .14s ease}" +
      "[data-question-key] [aria-checked=\"true\"] [class*=\"number\"]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground)}" +
      "[data-question-key] [class*=\"checkbox\"]{width:18px;flex:0 0 18px;height:18px;margin-top:3px}" +
      "[data-question-key] [class*=\"checkbox\"]::before{width:18px;height:18px;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-xs,4px)}" +
      "[data-question-key] [class*=\"checkbox\"][class*=\"checkboxChecked\"]{color:var(--dsw-alias-label-primary-foreground)}" +
      "[data-question-key] [class*=\"checkbox\"][class*=\"checkboxChecked\"]::before{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary)}" +
      "[data-question-key] [class*=\"optionLabel\"]{font-size:14px;font-weight:600;line-height:22px}" +
      "[data-question-key] [class*=\"description\"]:not([class*=\"descriptionToggle\"]){font-size:13px;line-height:20px}" +
      "[data-question-key] [class*=\"customRow\"]{box-sizing:border-box;min-height:48px;margin-top:6px;padding:10px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);background:transparent;transition:background-color .14s ease,border-color .14s ease}" +
      "[data-question-key] [class*=\"customRow\"]:hover,[data-question-key] [class*=\"customRow\"]:focus-within,[data-question-key] [class*=\"customRow\"][class*=\"customRowActive\"]{border-style:solid;border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent)}" +
      "[data-question-key] [class*=\"customBlock\"]{border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px)}" +
      "[data-question-key] [class*=\"customBlock\"]:focus-within{border-style:solid;border-color:var(--dsw-alias-state-business-primary)}" +
      "[data-question-key] footer{margin-top:12px;padding:10px 14px 12px 20px;border-top:1px solid var(--dsw-alias-border-l2)}" +
      "[data-question-key] footer [class*=\"footerActions\"]>button:last-child{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:600}" +
      "[data-question-key] footer [class*=\"footerActions\"]>button:last-child:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}" +
      "[data-question-key] footer [class*=\"pager\"]:has(> button:disabled + [class*=\"progress\"] + button:disabled){visibility:hidden}" +
      "@media (max-width:720px){" +
      "[data-question-key] header{padding:14px 10px 0 14px}" +
      "[data-question-key] [data-question-scroll]{padding:2px 4px 0}" +
      "[data-question-key] footer{padding:10px 10px 12px 14px}" +
      "}" +
      "@media (prefers-reduced-motion:reduce){" +
      "[data-question-key],[data-question-key] *{transition:none!important;transform:none!important}" +
      "}";
    if (typeof document !== "undefined") {
      var cssSheets = [["dsh-ldvh/client.css", SETTINGS_CSS], ["dsh-ldvh/gate.css", GATE_CSS]];
      for (var cssSheetIndex = 0; cssSheetIndex < cssSheets.length; cssSheetIndex++) {
        var cssId = cssSheets[cssSheetIndex][0];
        if (document.querySelector("style[data-plugin-css='" + cssId + "']")) continue;
        var styleTag = document.createElement("style");
        styleTag.dataset.plugin = "dsh-ldvh";
        styleTag.dataset.pluginCss = cssId;
        styleTag.textContent = cssSheets[cssSheetIndex][1];
        document.head.appendChild(styleTag);
      }
    }

    var LDVH_NS = "settings.ldvh";
    var LDVH_ENTRY_ID = "dsh-ldvh";
    var LDVH_SETTINGS_SECTION_ID = "dsh-ldvh";
    var LDVH_SETTINGS_SECTION_ORDER = 50;

    function ldvhEntryIdOf(forms) {
      try {
        var view = forms.describe().getSnapshot().view;
        var namespaces = (view && view.namespaces) || [];
        var served = namespaces.find(function (entry) {
          return entry.ns === LDVH_ENTRY_ID || /ldvh/i.test(entry.ns || "");
        });
        if (served !== undefined && typeof served.ns === "string" && served.ns !== "") return served.ns;
      } catch (error) {   }
      return LDVH_ENTRY_ID;
    }
    var LDVH_ZH = {
      "row.title": "LDVH",
      "intro.title": "LD Vibe Harness（LDVH）",
      "intro.badge": "AI 治理框架",
      "intro.valueVibe": "**对齐 Vibe**：让人与 AI 对项目的由来、现状、去向形成一致的认识。",
      "intro.valueCoding": "**协调 Coding**：借助宿主调度资源，明晰权责、记录火花、确立规范、构建报告、积累经验、发现摩擦，让项目进展更稳定、执行更顺利。",
      "row.governanceLocation": "管辖项目配置",
      "row.governanceLocationHint": "由 LDVH 自动保存在 DSH 用户配置目录下的 ldvh/governed-projects.yaml。",
      "row.projectsPanelTitle": "管辖项目",
      "group.services": "服务与入口",
      "group.idle": "代理辅助",
      "group.budget": "召回预算",
      "row.addProject": "新增管辖项目",
      "row.addProjectTitle": "新增管辖项目",
      "row.addProjectHint": "选 Git 仓库根目录或输入绝对路径，安装即完成登记与 Hook。",
      "row.cancelAdd": "取消",
      "row.projectsEmptyTitle": "还没有管辖项目",
      "row.projectsEmptyText": "新增后，LDVH 才会在该项目中启用事实源与 Git Gate。",
      "row.projectsLoading": "正在读取管辖项目…",
      "row.projectPath": "Git 根目录",
      "row.projectId": "项目 ID",
      "row.projectIdHelp": "用于登记与 CLI 调用的唯一标识（小写字母、数字、连字符；1–64 字符），创建后不可修改。",
      "row.projectIdErrorFormat": "仅可包含小写字母、数字和连字符，且不能以连字符开头或结尾。",
      "row.projectIdErrorLength": "长度需在 1–64 字符之间。",
      "row.projectIdErrorDuplicate": "此 ID 已被其他管辖项目使用。",
      "row.chooseProject": "选择 Git 根目录…",
      "row.pickFailed": "选择文件夹失败：",
      "row.pickUnavailable": "当前环境没有可用的目录选择服务，请直接在路径框中手动输入 Git 根目录。",
      "row.install": "安装",
      "row.installBusy": "安装中…",
      "row.update": "更新修复",
      "row.updateBusy": "更新修复中…",
      "sidebar.label": "LDVH",
      "sidebar.title": "LDVH 信息呈现",
      "row.unregister": "取消管辖",
      "row.check": "检查",
      "row.projectReady": "已就绪",
      "row.projectIncomplete": "未就绪",
      "row.operationFailed": "操作失败",
      "row.apiUnavailable": "LDVH 服务暂不可用，请稍后刷新页面重试；持续失败请检查插件是否已加载",
      "row.projectsUnavailable": "管辖项目列表暂不可用，请先查看上方 Web 呈现状态。",
      "row.projectColor": "项目颜色",
      "row.colorAuto": "自动取色",
      "row.mountConversationTab": "加入到对话 Tab",
      "row.mountSidebarTab": "加入到侧边栏",
      "row.idleAssistHint": "发现值得记的事就交给代理处理，主控只转发。两项分别管积累经验与发现摩擦。",
      "row.reviewAsk": "把关请示",
      "row.reviewAskPre": "行动前：询问是否安排代理审查",
      "row.reviewAskPreHint": "**第一次给出方案后**（判定复杂且已形成候选方案时），动手前问要不要独立子代理审核。",
      "row.reviewAskPost": "行动后：询问是否安排代理复核",
      "row.reviewAskPostHint": "**执行完成后**（复杂任务做完、准备收口时）问要不要逐条复核。",
      "row.reviewAskConsult": "遇难题：联网调查提请",
      "row.reviewAskConsultHint": "**执行过程中遇到难题时**——依赖外部信息又不掌握、内部查不到，才问要不要联网调查。",
      "row.reviewAskSilent": "静默执行：不问，直接安排",
      "row.reviewAskSilentBadge": "静默",
      "row.reviewAskSilentHint": "**判为复杂后不问你，直接派代理审核/复核**，结果里留一行静默痕迹。",
      "row.reviewAskTimeout": "倒计时：超时自动推进",
      "row.reviewAskTimeoutSeconds": "倒计时秒数",
      "row.reviewAskTimeoutHint": "**请示卡片显示倒计时**（10/30/60 秒），到点未选按未答复直接推进。",
      "row.experienceAccumulation": "积累经验",
      "row.experienceAccumulationHint": "主控在当次行动中发现已查明验证的失败机制时，把上下文交给代理起草一条经验，由主控写入。关掉后不再自动记录经验。",
      "row.idleCapture": "发现摩擦",
      "row.idleCaptureHint": "发现阻碍时交给代理，同源攒够 3 次即建待修账目，不够留在缓冲。",
"row.injectionBudgetTier": "召回预算档位（K 字节）",
      "row.injectionBudgetTierHint": "行动前召回的体量上限，10/20/30/40/50 KB 可选。",
      "row.idleLimitInvalid": "请填入整数；配额上限填 0 表示不限。",
      "row.webHint": "插件自带的页面与 API；是否可用见标题旁的读数，两项投放决定入口出现在哪里。",
      "row.webDisabledNote": "配置文件里关掉了 Web 呈现（webEnabled: false），故两项投放不可用。设置面已不再提供这个开关；需要时请在插件配置文件中改回 true。",
      "row.idleDisabledNote": "配置文件里关掉了代理辅助（proxyAssistEnabled 或旧键 idleAssistEnabled 为 false），故这两个子项不可用。设置面已不再提供这个总开关；需要时请在插件配置文件中改回 true。",
      "row.status": "Web 呈现状态",
      "row.statusChecking": "检测中…",
      "row.statusOk": "运行正常",
      "row.statusUnmounted": "未挂载",
      "row.statusFail": "运行异常",
      "row.save": "保存",
      "row.saveDirty": "保存改动",
      "row.saveDirtyAria": "有未保存的更改，点此保存",
      "row.saving": "保存中…",
      "row.discard": "放弃修改",
      "row.cheer": "鼓励一下",
      "row.saved": "已保存",
      "row.saveFailed": "保存失败，请重试。",
      "row.toastSaved": "LDVH 设置已保存。",
      "view.label": "LDVH",
      "view.loading": "正在加载 LDVH Web…",
      "view.error": "LDVH Web 当前不可用，请确认插件已加载，或稍后重试。",
      "view.retry": "重试",
    };
    var LDVH_EN = {
      "row.title": "LDVH",
      "intro.title": "LD Vibe Harness (LDVH)",
      "intro.badge": "AI governance framework",
      "intro.valueVibe": "**Align Vibe**: give the human and the AI a shared understanding of where the project came from, where it stands, and where it is going.",
      "intro.valueCoding": "**Coordinate Coding**: draw on the host to allocate resources — clarify rights and responsibilities, record sparks, establish norms, build reports, accumulate experience, and discover friction, so the project advances more steadily and execution goes more smoothly.",
      "row.governanceLocation": "Governed projects configuration",
      "row.governanceLocationHint": "LDVH stores it automatically at ldvh/governed-projects.yaml under the DSH user-config directory.",
      "row.projectsPanelTitle": "Governed projects",
      "group.services": "Service and entries",
      "group.idle": "Delegate assist",
      "group.budget": "Recall budget",
      "row.addProject": "Add governed project",
      "row.addProjectTitle": "Add governed project",
      "row.addProjectHint": "Pick a Git root or type its path; installing registers it and sets up the Hook.",
      "row.cancelAdd": "Cancel",
      "row.projectsEmptyTitle": "No governed project yet",
      "row.projectsEmptyText": "Add one to enable the fact source and Git Gate for that project.",
      "row.projectsLoading": "Loading governed projects…",
      "row.projectPath": "Git root",
      "row.projectId": "Project ID",
      "row.projectIdHelp": "Unique identifier for registration and CLI calls (lowercase letters, digits, and hyphens; 1–64 chars). Cannot be changed after creation.",
      "row.projectIdErrorFormat": "Only lowercase letters, digits, and hyphens; cannot start or end with a hyphen.",
      "row.projectIdErrorLength": "Must be between 1 and 64 characters.",
      "row.projectIdErrorDuplicate": "This ID is already used by another governed project.",
      "row.chooseProject": "Choose Git root…",
      "row.pickFailed": "Folder selection failed: ",
      "row.pickUnavailable": "No directory-picker service is available in this environment; type the Git root path manually.",
      "row.install": "Install",
      "row.installBusy": "Installing…",
      "row.update": "Update & Repair",
      "row.updateBusy": "Updating & repairing…",
      "sidebar.label": "LDVH",
      "sidebar.title": "LDVH presentation",
      "row.unregister": "Stop governing",
      "row.check": "Check",
      "row.projectReady": "Ready",
      "row.projectIncomplete": "Not ready",
      "row.operationFailed": "Operation failed",
      "row.apiUnavailable": "The LDVH service is unavailable. Refresh the page and retry; if it keeps failing, check that the plugin is loaded.",
      "row.projectsUnavailable": "The governed-project list is unavailable. Check the Web presentation status above first.",
      "row.projectColor": "Project color",
      "row.colorAuto": "Auto color",
      "row.mountConversationTab": "Add to conversation tab",
      "row.mountSidebarTab": "Add to sidebar",
      "row.idleAssistHint": "Hands worth-recording things to a delegate; the controller only forwards. Two switches: accumulate experience / discover friction.",
      "row.reviewAsk": "Review checkpoints",
      "row.reviewAskPre": "Before acting: ask whether to arrange an agent review",
      "row.reviewAskPreHint": "**After the first plan is given** (complex task with a candidate plan), asks before acting whether to arrange an independent agent review.",
      "row.reviewAskPost": "After the work: ask whether to arrange an agent re-check",
      "row.reviewAskPostHint": "**After execution completes** (complex task done, about to close), asks whether to check the work item by item.",
"row.reviewAskConsult": "When stuck: ask about an online investigation",
"row.reviewAskConsultHint": "**When a hard problem is hit during execution** — depends on external info not at hand and internal search found nothing — asks whether to investigate online.",
      "row.reviewAskSilent": "Silent run: skip the question, arrange it directly",
      "row.reviewAskSilentBadge": "silent",
      "row.reviewAskSilentHint": "**When judged complex, no question — directly arranges the review**, leaving a silent-run trace.",
      "row.reviewAskTimeout": "Countdown: auto-proceed on timeout",
      "row.reviewAskTimeoutSeconds": "Countdown seconds",
      "row.reviewAskTimeoutHint": "**Checkpoint cards show a countdown** (10/30/60s); on timeout it proceeds as unanswered.",
      "row.frictionDiscovery": "Friction discovery",
      "row.frictionDiscoveryHint": "Records recurring obstacles from the real workflow into the friction ledger (implemented).",
      "row.experienceAccumulation": "Accumulate experience",
      "row.experienceAccumulationHint": "When the main controller spots a verified failure mechanism during its own work, it hands the context to a delegate that drafts the experience entry. Turn off to stop recording automatically.",
      "row.idleCapture": "Discover friction",
      "row.idleCaptureHint": "Hands obstacles to a delegate; 3 same-source sightings build a to-be-fixed entry, fewer stay in the buffer.",
"row.injectionBudgetTier": "Recall budget tier (KiB)",
      "row.injectionBudgetTierHint": "Size cap for pre-action recall: 10/20/30/40/50 KiB.",
      "row.idleLimitInvalid": "Enter an integer; the silence duration must exceed 0 (0 in the cap means unlimited).",
      "row.webHint": "The plugin's own page and API; availability shows in the readout beside the title, and the two placements decide where the entry appears.",
      "row.webDisabledNote": "Web presentation is switched off in the config file (webEnabled: false), so both placements are unavailable. This switch is no longer offered in Settings; set it back to true in the plugin config file if you need it.",
      "row.idleDisabledNote": "Delegate assist is switched off in the config file (proxyAssistEnabled, or the legacy idleAssistEnabled, is false), so these two items are unavailable. This master switch is no longer offered in Settings; set it back to true in the plugin config file if you need it.",
      "row.status": "Web presentation status",
      "row.statusChecking": "Checking…",
      "row.statusOk": "Running normally",
      "row.statusUnmounted": "Not mounted",
      "row.statusFail": "Unavailable",
      "row.save": "Save",
      "row.saveDirty": "Save changes",
      "row.saveDirtyAria": "You have unsaved changes; click to save",
      "row.saving": "Saving…",
      "row.discard": "Discard changes",
      "row.cheer": "Star on GitHub",
      "row.saved": "Saved",
      "row.saveFailed": "Could not save. Try again.",
      "row.toastSaved": "LDVH settings saved.",
      "view.label": "LDVH",
      "view.loading": "Loading LDVH Web…",
      "view.error": "LDVH Web is unavailable. Check that the plugin is loaded, or try again later.",
      "view.retry": "Retry",
    };

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

    var LDVH_APP_PROTOCOL = "dsh-app:";
    function webFrameOrigin(port) {
      if (typeof window === "undefined" || !window.location) return "http://127.0.0.1:" + port;
      if (window.location.protocol === LDVH_APP_PROTOCOL) return "http://127.0.0.1:" + port;
      return window.location.origin;
    }

    var LDVH_WEB_PORT_DEFAULT = 3299;
    var ldvhWebPort = LDVH_WEB_PORT_DEFAULT;
    var ldvhWebOrigin = webFrameOrigin(ldvhWebPort);
    var ldvhFrameLocation = ldvhWebOrigin + "/ldvh/";
    function applyWebPort(port) {
      if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) return;
      if (port === ldvhWebPort) return;
      ldvhWebPort = port;
      ldvhWebOrigin = webFrameOrigin(ldvhWebPort);
      var tail = ldvhFrameLocation.indexOf("/ldvh") >= 0 ? ldvhFrameLocation.slice(ldvhFrameLocation.indexOf("/ldvh")) : "/ldvh/";
      ldvhFrameLocation = ldvhWebOrigin + tail;
    }

    function probeLoopback(path, then) {
      try {
        fetch(ldvhWebOrigin + path, { method: "GET", mode: "no-cors", cache: "no-store" })
          .then(function () { then(true); })
          .catch(function () { then(false); });
      } catch (error) {
        void error;
        then(false);
      }
    }

    function healthBodyOk(body) {
      if (body && body.success === true) return true;
      return Boolean(body && body.ok === true && body.status === "ok");
    }
    function probeHealthStatus(then) {
      fetch(ldvhWebOrigin + "/ldvh/api/health", { method: "GET", cache: "no-store" })
        .then(function (r) {
          if (!r.ok) { then(false, "unhealthy"); return; }
          return r.json().then(function (body) {
            then(healthBodyOk(body), healthBodyOk(body) ? "healthy" : "unhealthy");
          }, function () {
            then(true, "reachable");
          });
        })
        .catch(function () {
          probeLoopback("/ldvh/api/health", function (reachable) {
            then(reachable, reachable ? "reachable" : "unreachable");
          });
        });
    }

    function discoverWebPort() {
      return fetch("/ldvh/api/health", { method: "GET", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (body) {
          if (body && body.ok === true && body.webPort !== undefined) applyWebPort(body.webPort);
          return !!(body && body.ok === true);
        })
        .catch(function () { return false; });
    }

    function checkHealth(then) {
      discoverWebPort()
        .catch(function () { return false; })
        .then(function () {
          return new Promise(function (done) {
            probeLoopback("/ldvh/", function (pageReachable) {
              if (!pageReachable) { done(false); return; }
              probeHealthStatus(function (healthy) { done(healthy); });
            });
          });
        })
        .then(then, function () { then(false); });
    }

    function probeWeb(then) {
      var out = { api: false, page: false, apiState: "unreachable", pageState: "unreachable" };
      discoverWebPort()
        .catch(function () { return false; })
        .then(function () {
          return Promise.all([
            new Promise(function (done) {
              probeHealthStatus(function (healthy, state) { out.api = healthy; out.apiState = state; done(); });
            }),
            new Promise(function (done) {
              probeLoopback("/ldvh/", function (ok) {
                out.page = ok;
                out.pageState = ok ? "reachable" : "unreachable";
                done();
              });
            }),
          ]);
        })
        .then(function () { then(out); })
        .catch(function () { then(out); });
    }

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

    var IDLE_LIMITS = [
    ];
    var IDLE_DEFAULT_STORED = {
    };
    var INJECTION_BUDGET_TIER_OPTIONS = [10, 20, 30, 40, 50];
    var INJECTION_BUDGET_TIER_DEFAULT = 10;
    function injectionBudgetTierOk(value) {
      var n = Number(value);
      return INJECTION_BUDGET_TIER_OPTIONS.indexOf(n) !== -1;
    }
    function idleLimitToText(value, scale) {
      if (value === undefined || value === null || value === "") return "";
      var n = Number(value);
      if (!Number.isFinite(n) || n < 0) return "";
      return String(n / scale);
    }
    function idleLimitToStored(text, scale) {
      if (typeof text !== "string" || text.trim() === "") return undefined;
      var n = Number(text);
      if (!Number.isFinite(n) || n < 0) return undefined;
      var stored = n * scale;
      if (!Number.isInteger(stored) || stored < 0) return undefined;
      if (Number(idleLimitToText(stored, scale)) !== n) return undefined;
      return stored;
    }


    function LdvhSettingsRow(props) {
      var t = props.t;
      var scope = props.settingsScope;
      var snap = useSettingsScopeSnapshot(scope);
      var value = (snap && snap.status === "ready" && snap.value) || {};
      var webOn = value.webEnabled !== false;
      var idleOn = (value.proxyAssistEnabled !== undefined
        ? value.proxyAssistEnabled !== false
        : value.idleAssistEnabled !== false);
      var convTabState = React.useState(value.showInConversationTab !== false);
      var sidebarTabState = React.useState(value.showInSidebarTab !== false);
      var idleCaptureState = React.useState(idleCaptureValueOf(value));
      var experienceAccumulationState = React.useState(value.experienceAccumulationEnabled !== false);
      var preActionReviewState = React.useState(value.preActionReviewAskEnabled === true);
      var postWorkReviewState = React.useState(value.postWorkReviewAskEnabled === true);
      var researchConsultState = React.useState(value.researchConsultAskEnabled === true);
      var reviewSilentState = React.useState(value.reviewAskSilentRunEnabled === true);
      var reviewTimeoutState = React.useState(value.reviewAskTimeoutEnabled === true);
      var reviewTimeoutSecondsState = React.useState(
        [10, 30, 60].indexOf(Number(value.reviewAskTimeoutSeconds)) >= 0 ? Number(value.reviewAskTimeoutSeconds) : 30
      );
      function idleCaptureValueOf(value) {
        return value.frictionDiscoveryEnabled !== undefined
          ? value.frictionDiscoveryEnabled !== false
          : value.idleCaptureEnabled !== false;
      }
      function idleLimitsTextOf(value) {
        var out = {};
        IDLE_LIMITS.forEach(function (limit) {
          var stored = value[limit.key] !== undefined ? value[limit.key] : IDLE_DEFAULT_STORED[limit.key];
          out[limit.key] = idleLimitToText(stored, limit.scale);
        });
        return out;
      }
      var injectionBudgetState = React.useState(
        injectionBudgetTierOk(value.injectionBudgetTier) ? Number(value.injectionBudgetTier) : INJECTION_BUDGET_TIER_DEFAULT
      );
      var idleLimitsState = React.useState(idleLimitsTextOf(value));
      function idleLimitOk(text, scale) {
        return idleLimitToStored(text, scale) !== undefined;
      }
      function idleLimitOkFor(key, text) {
        var limit = IDLE_LIMITS.filter(function (l) { return l.key === key; })[0];
        return limit !== undefined && idleLimitOk(text, limit.scale);
      }
      function idleLimitsAllOk(limits) {
        return IDLE_LIMITS.every(function (limit) {
          return idleLimitOkFor(limit.key, limits[limit.key]);
        });
      }
      var dirtyState = React.useState(false);
      var busyState = React.useState(false);
      var savedState = React.useState(false);
      var saveErrorState = React.useState(false);
      var saveErrorDetailState = React.useState("");
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
        callLdvhApi("/governed-projects/with-colors")
          .then(function (result) {
            if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "project list unavailable");
            projectsState[1]({ loading: false, value: result.value, error: null, unavailable: false });
          })
          .catch(function (error) {
            var message = String(error.message || error);
            var isTransport = message.indexOf("LDVH 服务返回了空响应") !== -1 || message.indexOf("LDVH 服务返回了无法解析的响应") !== -1 || message.indexOf("fetch") !== -1 || message.indexOf("network") !== -1 || message.indexOf("Failed to fetch") !== -1;
            projectsState[1]({ loading: false, value: null, error: isTransport ? null : message, unavailable: isTransport });
          });
      }

      React.useEffect(function () { loadProjects(); }, []);

      React.useEffect(function () {
        if (dirtyState[0] || busyState[0]) return;
        var next = (snap && snap.status === "ready" && snap.value) || {};
        convTabState[1](next.showInConversationTab !== false);
        sidebarTabState[1](next.showInSidebarTab !== false);
        experienceAccumulationState[1](next.experienceAccumulationEnabled !== false);
        idleCaptureState[1](idleCaptureValueOf(next));
        injectionBudgetState[1](
          injectionBudgetTierOk(next.injectionBudgetTier) ? Number(next.injectionBudgetTier) : INJECTION_BUDGET_TIER_DEFAULT
        );
        preActionReviewState[1](next.preActionReviewAskEnabled === true);
        postWorkReviewState[1](next.postWorkReviewAskEnabled === true);
        researchConsultState[1](next.researchConsultAskEnabled === true);
        reviewSilentState[1](next.reviewAskSilentRunEnabled === true);
        reviewTimeoutState[1](next.reviewAskTimeoutEnabled === true);
        reviewTimeoutSecondsState[1](
          [10, 30, 60].indexOf(Number(next.reviewAskTimeoutSeconds)) >= 0 ? Number(next.reviewAskTimeoutSeconds) : 30
        );
        idleLimitsState[1](idleLimitsTextOf(next));
        savedState[1](false);
        saveErrorState[1](false);
      }, [snap ? snap.revision : -1, dirtyState[0], busyState[0]]);

      React.useEffect(function () {
        var cancelled = false;
        webStatusState[1]({ checking: true, api: false, page: false });
        probeWeb(function (out) {
          if (cancelled) return;
          webStatusState[1]({ checking: false, api: out.api, page: out.page });
        });
        return function () { cancelled = true; };
      }, [snap ? snap.revision : -1]);

      function adoptPickedPath(path) {
        if (path === null || typeof path !== "string") return;
        var leaf = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "project";
        candidateState[1]({ path: path, id: leaf.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "project" });
      }
      function chooseProject() {
        if (projectBusyState[0]) return;
        var desktopPick = null;
        try {
          if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("dsh-desktop-platform") === "win32"
            && typeof window.__DSH_DESKTOP_PICK_DIRECTORY__ === "function") {
            desktopPick = window.__DSH_DESKTOP_PICK_DIRECTORY__;
          }
        } catch (error) {   }
        if (desktopPick !== null) {
          projectBusyState[1](true);
          installErrorState[1](null);
          Promise.resolve(desktopPick()).then(function (path) {
            projectBusyState[1](false);
            adoptPickedPath(path === undefined ? null : path);
          }).catch(function (error) {
            projectBusyState[1](false);
            installErrorState[1](t("row.pickFailed") + (error && error.message ? String(error.message) : ""));
          });
          return;
        }
        if (!directoryPicker || typeof directoryPicker.pick !== "function") {
          installErrorState[1](t("row.pickUnavailable"));
          return;
        }
        projectBusyState[1](true);
        installErrorState[1](null);
        Promise.resolve(directoryPicker.pick()).then(function (result) {
          projectBusyState[1](false);
          if (!result || result.ok !== true || typeof result.value !== "string") return;
          adoptPickedPath(result.value);
        }).catch(function (error) {
          projectBusyState[1](false);
          installErrorState[1](t("row.pickFailed") + (error && error.message ? String(error.message) : ""));
        });
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
        callLdvhApi("/governed-projects/install", { path: candidateState[0].path, id: candidateState[0].id, name: candidateState[0].id, human_confirmed: true })
          .then(function (result) {
            if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "installation failed");
            closeAddForm();
            loadProjects();
          })
          .catch(function (error) { installErrorState[1](t("row.operationFailed") + ": " + String(error.message || error)); })
          .finally(function () { projectBusyState[1](false); });
      }
      var PROJECT_COLOR_KEYS = ["emerald", "sky", "violet", "amber", "rose", "cyan", "indigo", "orange", "teal", "fuchsia"];
      var PROJECT_COLOR_VALUES = {
        emerald: "#34d399", sky: "#38bdf8", violet: "#a78bfa", amber: "#fbbf24", rose: "#fb7185",
        cyan: "#22d3ee", indigo: "#818cf8", orange: "#fb923c", teal: "#2dd4bf", fuchsia: "#e879f9"
      };
      function projectColorVar(key) { return PROJECT_COLOR_VALUES[key] || "#999999"; }
      function setProjectColor(projectId, color) {
        projectBusyState[1](true);
        callLdvhApi("/governed-projects/color", { projectId: projectId, color: color })
          .then(function (result) {
            if (!result || result.ok !== true) {
              var raw = result && result.error;
              var text = raw && typeof raw.message === "string" ? raw.message : (typeof raw === "string" ? raw : "color update failed");
              throw new Error(text);
            }
            loadProjects();
          })
          .catch(function (error) {
            projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
          }).finally(function () { projectBusyState[1](false); });
      }
      function inspectProject(path) {
        projectBusyState[1](true);
        callLdvhApi("/governed-projects/inspect", { path: path }).then(function () { loadProjects(); }).catch(function (error) {
          projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
        }).finally(function () { projectBusyState[1](false); });
      }
      function updateProject(project) {
        projectBusyState[1](true);
        callLdvhApi("/governed-projects/install", { path: project.path, id: project.id, name: project.name || project.id, human_confirmed: true })
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
        callLdvhApi("/governed-projects/unregister", { id: project.id, path: project.path, nextDefaultProjectId: nextDefault ? nextDefault.id : "", human_confirmed: true }).then(function (result) {
          if (!result || result.ok !== true) throw new Error(result && result.error ? result.error.message : "unregister failed");
          loadProjects();
        }).catch(function (error) {
          projectsState[1]({ loading: false, value: projectsState[0].value, error: String(error.message || error), unavailable: false });
        }).finally(function () { projectBusyState[1](false); });
      }

      function markDirty() {
        savedState[1](false);
        saveErrorState[1](false);
        saveErrorDetailState[1]("");
        dirtyState[1](true);
      }
      function save() {
        if (!snap || snap.status !== "ready" || snap.writable === false || busyState[0]) return;
        if (!idleLimitsAllOk(idleLimitsState[0])) {
          saveErrorState[1](true);
          return;
        }
        busyState[1](true);
        Promise.resolve()
          .then(function () {
            var operations = [
              { op: "set", path: ["showInConversationTab"], value: !!convTabState[0] },
              { op: "set", path: ["showInSidebarTab"], value: !!sidebarTabState[0] },
              { op: "set", path: ["experienceAccumulationEnabled"], value: !!experienceAccumulationState[0] },
              { op: "set", path: ["idleCaptureEnabled"], value: !!idleCaptureState[0] },
              { op: "set", path: ["injectionBudgetTier"], value: Number(injectionBudgetState[0]) },
              { op: "set", path: ["preActionReviewAskEnabled"], value: !!preActionReviewState[0] },
              { op: "set", path: ["postWorkReviewAskEnabled"], value: !!postWorkReviewState[0] },
              { op: "set", path: ["researchConsultAskEnabled"], value: !!researchConsultState[0] },
              { op: "set", path: ["reviewAskSilentRunEnabled"], value: !!reviewSilentState[0] },
              { op: "set", path: ["reviewAskTimeoutEnabled"], value: !!reviewTimeoutState[0] },
              { op: "set", path: ["reviewAskTimeoutSeconds"], value: Number(reviewTimeoutSecondsState[0]) }
            ];
            IDLE_LIMITS.forEach(function (limit) {
              operations.push({ op: "set", path: [limit.key], value: idleLimitToStored(idleLimitsState[0][limit.key], limit.scale) });
            });
            return scope.mutate(operations, snap.revision);
          })
          .then(function (accepted) {
            if (accepted === false) throw new Error("LDVH 设置写入被宿主拒绝");
          })
          .then(function () {
            busyState[1](false);
            dirtyState[1](false);
            savedState[1](true);
            saveErrorDetailState[1]("");
            toastSeq.current = toastSeq.current + 1;
            toastState[1]({ seq: toastSeq.current, text: t("row.toastSaved") });
          })
          .catch(function (error) {
            busyState[1](false);
            saveErrorState[1](true);
            saveErrorDetailState[1](String((error && error.message) || error || ""));
          });
      }
      function discard() {
        var next = (snap && snap.status === "ready" && snap.value) || {};
        convTabState[1](next.showInConversationTab !== false);
        sidebarTabState[1](next.showInSidebarTab !== false);
        idleCaptureState[1](idleCaptureValueOf(next));
        preActionReviewState[1](next.preActionReviewAskEnabled === true);
        postWorkReviewState[1](next.postWorkReviewAskEnabled === true);
        researchConsultState[1](next.researchConsultAskEnabled === true);
        reviewSilentState[1](next.reviewAskSilentRunEnabled === true);
        reviewTimeoutState[1](next.reviewAskTimeoutEnabled === true);
        reviewTimeoutSecondsState[1](
          [10, 30, 60].indexOf(Number(next.reviewAskTimeoutSeconds)) >= 0 ? Number(next.reviewAskTimeoutSeconds) : 30
        );
        injectionBudgetState[1](injectionBudgetTierOk(next.injectionBudgetTier) ? Number(next.injectionBudgetTier) : INJECTION_BUDGET_TIER_DEFAULT);
        idleLimitsState[1](idleLimitsTextOf(next));
        dirtyState[1](false);
        savedState[1](false);
        saveErrorState[1](false);
        saveErrorDetailState[1]("");
      }
      var saveDisabled = !snap || snap.status !== "ready" || snap.writable === false || busyState[0] || !dirtyState[0];
      var ws = webStatusState[0];
      var serviceOk = ws.api && ws.page;
      var serviceValueText = ws.checking
        ? t("row.statusChecking")
        : (!webOn ? t("row.statusUnmounted") : (serviceOk ? t("row.statusOk") : t("row.statusFail")));
      var serviceValueClass = "ldv-status-value" + (ws.checking
        ? " ldv-status-wait"
        : (!webOn ? " ldv-status-wait" : (serviceOk ? " ldv-status-ok" : " ldv-status-fail")));
      var serviceStatus = React.createElement("span", {
        className: serviceValueClass,
        "aria-label": t("row.status") + "：" + serviceValueText
      }, serviceValueText);
      var serviceIssue = ws.checking || !webOn || serviceOk ? null : t("row.apiUnavailable");
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
                    React.createElement("span", { className: ready ? "ldv-status-value ldv-status-ok" : "ldv-status-value ldv-status-fail" }, ready ? t("row.projectReady") : t("row.projectIncomplete")),
                    React.createElement("span", { className: "ldv-project-path" }, project.path)
                  )
                ),
                notReadyDetail ? React.createElement("span", { className: "ldv-settings-hint" }, notReadyDetail) : null,
                React.createElement("div", { className: "ldv-palette", role: "group", "aria-label": t("row.projectColor") },
                  React.createElement("span", { className: "ldv-palette-label" }, t("row.projectColor")),
                  PROJECT_COLOR_KEYS.map(function (key) {
                    var isExplicit = project.color === key;
                    var locked = !project.color;
                    return React.createElement("button", {
                      key: key, type: "button",
                      className: "ldv-palette-dot" + (isExplicit ? " ldv-palette-dot-active" : "") + (locked ? " ldv-palette-dot-locked" : ""),
                      title: key, "aria-label": key, "aria-pressed": isExplicit,
                      disabled: projectBusyState[0] || locked,
                      style: { backgroundColor: projectColorVar(key) },
                      onClick: function () { setProjectColor(project.id, key); }
                    },
                      isExplicit ? React.createElement("span", { className: "ldv-palette-check", "aria-hidden": "true" }, "\u2713") : null
                    );
                  }),
                  React.createElement("label", { className: "ldv-check ldv-palette-auto" + (!project.color ? " ldv-palette-auto-on" : "") },
                    React.createElement("input", {
                      type: "checkbox",
                      checked: !project.color,
                      disabled: projectBusyState[0],
                      "aria-label": t("row.colorAuto"),
                      onChange: function (e) { setProjectColor(project.id, e.target.checked ? null : "emerald"); }
                    }),
                    React.createElement("span", { className: "ldv-check-label" }, t("row.colorAuto"))
                  )
                ),
                React.createElement("div", { className: "ldv-project-actions" },
                  React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: function () { inspectProject(project.path); } }, t("row.check")),
                  repairable ? React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-primary", disabled: projectBusyState[0], onClick: function () { updateProject(project); } }, projectBusyState[0] ? t("row.updateBusy") : t("row.update")) : null,
                  React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: function () { unregisterGovernance(project); } }, t("row.unregister"))
                )
              );
            })))));
      function emphasis(text) {
        if (typeof text !== "string" || text.indexOf("**") === -1) return text;
        return text.split("**").map(function (part, index) {
          if (part === "") return null;
          return index % 2 === 1 ? React.createElement("strong", { key: "emphasis-" + index }, part) : part;
        });
      }
      function settingRow(titleKey, descKey, control) {
        return React.createElement("div", { className: "ldv-row" },
          React.createElement("div", { className: "ldv-row-head" },
            React.createElement("span", { className: "ldv-row-title" }, t(titleKey)),
            React.createElement("span", { className: "ldv-row-control" }, control)
          ),
          descKey ? React.createElement("span", { className: "ldv-row-desc" }, emphasis(t(descKey))) : null
        );
      }
      function blockIcon(name) {
        var shapes = LDVH_BLOCK_ICONS[name] || [];
        return React.createElement("svg", {
          viewBox: "0 0 16 16", width: 15, height: 15,
          fill: "none", stroke: "currentColor", strokeWidth: 1.6,
          strokeLinecap: "round", strokeLinejoin: "round",
          focusable: "false", "aria-hidden": "true"
        }, shapes.map(function (shape, index) {
          return React.createElement(shape.t, Object.assign({ key: "shape-" + index }, shape.p));
        }));
      }
      function cardHead(iconKey, titleKey, descKey, readout, toggles) {
        var readouts = Array.isArray(readout) ? readout : (readout ? [readout] : []);
        var switches = Array.isArray(toggles) ? toggles : (toggles ? [toggles] : []);
        return React.createElement("div", { className: "ldv-block-head" },
          React.createElement("span", { className: "ldv-block-icon", "aria-hidden": "true" }, blockIcon(iconKey)),
          React.createElement("span", { className: "ldv-block-title-line" },
            React.createElement("span", { className: "ldv-block-title" }, t(titleKey))
          ),
          readouts.length ? React.createElement("span", { className: "ldv-block-control" }, readouts) : null,
          switches.length ? React.createElement("span", { className: "ldv-block-control ldv-block-toggle" }, switches) : null,
          descKey ? React.createElement("span", { className: "ldv-block-desc" }, emphasis(t(descKey))) : null
        );
      }
      function switchControl(checked, onChange, ariaLabel, disabled, tone) {
        return React.createElement("label", { className: tone === "silent" ? "ldv-switch ldv-switch-silent" : "ldv-switch" },
          React.createElement("input", {
            type: "checkbox",
            checked: !!checked,
            disabled: !!disabled,
            "aria-label": ariaLabel,
            onChange: onChange
          }),
          React.createElement("span", { className: "ldv-switch-track", "aria-hidden": "true" })
        );
      }
      return React.createElement("section", { className: "ldv-settings" },
        React.createElement("header", { className: "ldv-intro" },
          React.createElement("img", { className: "ldv-intro-icon", src: LDVH_ICON, width: 32, height: 32, alt: "" }),
          React.createElement("div", { className: "ldv-intro-body" },
            React.createElement("div", { className: "ldv-intro-title-line" },
              React.createElement("span", { className: "ldv-intro-title" }, t("intro.title")),
              React.createElement("span", { className: "ldv-intro-badge" }, t("intro.badge"))
            ),
            React.createElement("div", { className: "ldv-intro-values" },
              React.createElement("span", { className: "ldv-intro-value" }, emphasis(t("intro.valueVibe"))),
              React.createElement("span", { className: "ldv-intro-value" }, emphasis(t("intro.valueCoding")))
            )
          )
        ),
        React.createElement("section", { className: "ldv-block" },
          cardHead("services", "group.services", "row.webHint",
            serviceStatus,
            null
          ),
          React.createElement("div", { className: "ldv-block-body" },
            !webOn
              ? React.createElement("span", { className: "ldv-settings-hint" }, t("row.webDisabledNote"))
              : (serviceIssue ? React.createElement("span", { className: "ldv-settings-hint" }, serviceIssue) : null),
            settingRow("row.mountConversationTab", null, switchControl(
              webOn && convTabState[0],
              function (e) { convTabState[1](e.target.checked); markDirty(); },
              t("row.mountConversationTab"),
              !webOn
            )),
            settingRow("row.mountSidebarTab", null, switchControl(
              webOn && sidebarTabState[0],
              function (e) { sidebarTabState[1](e.target.checked); markDirty(); },
              t("row.mountSidebarTab"),
              !webOn
            )),
          )
        ),
        React.createElement("section", { className: "ldv-block" },
          cardHead("idle", "group.idle", "row.idleAssistHint", null, null),
          React.createElement("div", { className: "ldv-block-body" },
            !idleOn ? React.createElement("span", { className: "ldv-settings-hint" }, t("row.idleDisabledNote")) : null,
            [
              { key: "experienceAccumulationEnabled", state: experienceAccumulationState, label: "row.experienceAccumulation", hint: "row.experienceAccumulationHint" },
              { key: "idleCaptureEnabled", state: idleCaptureState, label: "row.idleCapture", hint: "row.idleCaptureHint" }
            ].map(function (task) {
              return settingRow(task.label, task.hint, switchControl(
                idleOn && task.state[0],
                function (e) { task.state[1](e.target.checked); markDirty(); },
                t(task.label),
                !idleOn
              ));
            }),
            IDLE_LIMITS.map(function (limit) {
              var invalid = !idleLimitOkFor(limit.key, idleLimitsState[0][limit.key]);
              return React.createElement("div", { key: limit.key, className: "ldv-row" },
                React.createElement("div", { className: "ldv-row-head" },
                  React.createElement("span", { className: "ldv-row-title" }, t("row." + limit.key)),
                  React.createElement("span", { className: "ldv-row-control" },
                    React.createElement("input", {
                      type: "number",
                      step: "1",
                      min: "1",
                      inputMode: "numeric",
                      className: "ldv-settings-input ldv-field-input",
                      value: idleLimitsState[0][limit.key],
                      "aria-invalid": invalid,
                      "aria-label": t("row." + limit.key),
                      onChange: function (e) {
                        var next = {};
                        Object.keys(idleLimitsState[0]).forEach(function (k) { next[k] = idleLimitsState[0][k]; });
                        next[limit.key] = e.target.value;
                        idleLimitsState[1](next);
                        markDirty();
                      }
                    })
                  )
                ),
                limit.hintKey ? React.createElement("span", { className: "ldv-row-desc" }, emphasis(t(limit.hintKey))) : null,
                invalid ? React.createElement("span", { className: "ldv-field-invalid" }, t("row.idleLimitInvalid")) : null
              );
            }),
          )
        ),
        React.createElement("section", { className: "ldv-block" },
          cardHead("budget", "group.budget", null, null, null),
          React.createElement("div", { className: "ldv-block-body" },
            React.createElement("div", { className: "ldv-row" },
              React.createElement("div", { className: "ldv-row-head" },
                React.createElement("span", { className: "ldv-row-title" }, t("row.injectionBudgetTier")),
                React.createElement("span", { className: "ldv-row-control ldv-select" },
                  React.createElement("select", {
                    className: "ldv-settings-input ldv-field-select",
                    value: String(injectionBudgetState[0]),
                    "aria-label": t("row.injectionBudgetTier"),
                    onChange: function (e) {
                      injectionBudgetState[1](Number(e.target.value));
                      markDirty();
                    }
                  },
                    INJECTION_BUDGET_TIER_OPTIONS.map(function (tier) {
                      return React.createElement("option", { key: String(tier), value: String(tier) }, String(tier) + " K");
                    })
                  )
                )
              ),
              React.createElement("span", { className: "ldv-row-desc" }, emphasis(t("row.injectionBudgetTierHint"))),
              injectionBudgetTierOk(injectionBudgetState[0])
                ? null
                : React.createElement("span", { className: "ldv-field-invalid" }, t("row.idleLimitInvalid"))
            )
          )
        ),
        React.createElement("section", { className: "ldv-block" },
          cardHead("review", "row.reviewAsk", null, null, null),
          React.createElement("div", { className: "ldv-block-body" },
            [
              { key: "preActionReviewAskEnabled", state: preActionReviewState, label: "row.reviewAskPre", hint: "row.reviewAskPreHint" },
              { key: "postWorkReviewAskEnabled", state: postWorkReviewState, label: "row.reviewAskPost", hint: "row.reviewAskPostHint" },
              { key: "researchConsultAskEnabled", state: researchConsultState, label: "row.reviewAskConsult", hint: "row.reviewAskConsultHint" }
            ].map(function (item) {
              return settingRow(item.label, item.hint, switchControl(
                item.state[0],
                function (e) { item.state[1](e.target.checked); markDirty(); },
                t(item.label)
              ));
            }),
            settingRow("row.reviewAskSilent", "row.reviewAskSilentHint",
              React.createElement("span", { className: "ldv-silent-control" },
                React.createElement("span", { className: "ldv-silent-badge" }, t("row.reviewAskSilentBadge")),
                switchControl(
                  reviewSilentState[0],
                  function (e) { reviewSilentState[1](e.target.checked); markDirty(); },
                  t("row.reviewAskSilent"),
                  false,
                  "silent"
                )
              )
            ),
            settingRow("row.reviewAskTimeout", "row.reviewAskTimeoutHint",
              React.createElement("span", { className: "ldv-silent-control" },
                React.createElement("select", {
                  className: "ldv-settings-input ldv-field-select",
                  value: String(reviewTimeoutSecondsState[0]),
                  disabled: !reviewTimeoutState[0],
                  "aria-label": t("row.reviewAskTimeoutSeconds"),
                  onChange: function (e) { reviewTimeoutSecondsState[1](Number(e.target.value)); markDirty(); }
                },
                  [10, 30, 60].map(function (sec) {
                    return React.createElement("option", { key: String(sec), value: String(sec) }, String(sec) + "s");
                  })
                ),
                switchControl(
                  reviewTimeoutState[0],
                  function (e) { reviewTimeoutState[1](e.target.checked); markDirty(); },
                  t("row.reviewAskTimeout")
                )
              )
            )
          )
        ),
        React.createElement("section", { className: "ldv-block" },
          React.createElement("div", { className: "ldv-block-head" },
            React.createElement("span", { className: "ldv-block-icon", "aria-hidden": "true" }, blockIcon("projects")),
            React.createElement("span", { className: "ldv-block-title-line" },
              React.createElement("span", { className: "ldv-block-title" }, t("row.projectsPanelTitle")),
              !projectsState[0].loading && projectsState[0].value
                ? React.createElement("span", { className: "ldv-count" }, String((projectsState[0].value.projects || []).length))
                : null
            ),
            React.createElement("span", { className: "ldv-block-control ldv-block-action" },
              React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0] || addingState[0], onClick: openAddForm }, t("row.addProject"))
            )
          ),
          React.createElement("div", { className: "ldv-block-body" },
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
                        React.createElement("input", { className: "ldv-settings-input", value: candidateState[0].path, disabled: projectBusyState[0], "aria-label": t("row.projectPath"), placeholder: t("row.projectPath"), onChange: function (event) { candidateState[1]({ path: event.target.value, id: candidateState[0].id }); } }),
                        React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: projectBusyState[0], onClick: chooseProject }, t("row.chooseProject"))
                      )
                    ),
                    React.createElement("div", { className: "ldv-governance-add-field" },
                      React.createElement("span", { className: "ldv-governance-add-label" }, t("row.projectId")),
                      React.createElement("input", { className: idInputClass, value: candidateState[0].id, disabled: projectBusyState[0], "aria-invalid": idError && idError !== "required" ? "true" : "false", placeholder: t("row.projectId"), onChange: function (event) { candidateState[1]({ path: candidateState[0].path, id: event.target.value }); } }),
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
          ),
          React.createElement("span", { className: "ldv-note" },
            React.createElement("span", { className: "ldv-note-title" }, t("row.governanceLocation")),
            React.createElement("span", { className: "ldv-note-text" }, t("row.governanceLocationHint"))
          )
        ),
        React.createElement("div", { className: "ldv-settings-footer" },
          React.createElement("div", { className: "ldv-settings-footer-left" },
            React.createElement("a", {
              className: "ldv-settings-cheer",
              href: LDVH_GITHUB_URL,
              target: "_blank",
              rel: "noopener noreferrer"
            },
              t("row.cheer"),
              React.createElement("span", { className: "ldv-settings-cheer-star", "aria-hidden": "true" }, "\u2605")
            ),
            savedState[0]
              ? React.createElement("span", { className: "ldv-settings-footer-status" }, t("row.saved"))
              : (saveErrorState[0] ? React.createElement("span", { className: "ldv-settings-footer-error", role: "alert" }, t("row.saveFailed") + (saveErrorDetailState[0] ? " " + saveErrorDetailState[0] : "")) : null)
          ),
          React.createElement("button", { type: "button", className: "ldv-btn ldv-btn-outline", disabled: !dirtyState[0] || busyState[0], onClick: discard }, t("row.discard")),
          React.createElement("button", {
            type: "button",
            className: dirtyState[0] ? "ldv-btn ldv-btn-primary ldv-btn-dirty" : "ldv-btn ldv-btn-primary",
            disabled: saveDisabled,
            onClick: save,
            "aria-label": busyState[0] ? t("row.saving") : (dirtyState[0] ? t("row.saveDirtyAria") : t("row.save"))
          }, busyState[0] ? t("row.saving") : (dirtyState[0] ? t("row.saveDirty") : t("row.save")))
        ),
        toastState[0] ? React.createElement(Toast, { key: toastState[0].seq, text: toastState[0].text, onDone: function () { toastState[1](null); } }) : null
      );
    }


    if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("message", function (event) {
      if (event.source === window) return;
      var data = event.data;
      if (data && typeof data === "object" && data.type === "ldvh:navigate" && typeof data.pathname === "string") {
        if (data.pathname.indexOf("/ldvh") === 0) {
          ldvhFrameLocation = ldvhWebOrigin + data.pathname;
          ldvhFrameProjectId = typeof data.projectId === "string" && data.projectId.length > 0 ? data.projectId : null;
        }
      }
    });

    var LDVH_PROJECT_PARAM = "ldvhProject";
    var LDVH_HOME_PATH = "/ldvh/";
    var ldvhFrameProjectId = null;

    function askGovernanceProject(query) {
      return fetch("/ldvh/state/governance?" + query, { method: "GET", cache: "no-store" })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (body) {
          if (!body || body.state !== "governed") return null;
          var project = body.project;
          if (!project || typeof project.id !== "string" || project.id.length === 0) return null;
          return project.id;
        })
        .catch(function () { return null; });
    }

    function resolveSessionProject(sessionId, cwd) {
      var sessionQuery = typeof sessionId === "string" && sessionId.length > 0
        ? "sessionId=" + encodeURIComponent(sessionId)
        : "";
      var cwdQuery = typeof cwd === "string" && cwd.length > 0
        ? "cwd=" + encodeURIComponent(cwd)
        : "";
      if (sessionQuery === "") {
        return cwdQuery === "" ? Promise.resolve(null) : askGovernanceProject(cwdQuery);
      }
      return askGovernanceProject(sessionQuery).then(function (bySession) {
        if (bySession !== null) return bySession;
        return cwdQuery === "" ? null : askGovernanceProject(cwdQuery);
      });
    }

    function withProjectParam(location, projectId) {
      if (!projectId) return location;
      var hashIndex = location.indexOf("#");
      var hash = hashIndex >= 0 ? location.slice(hashIndex) : "";
      var base = hashIndex >= 0 ? location.slice(0, hashIndex) : location;
      var queryIndex = base.indexOf("?");
      var path = queryIndex >= 0 ? base.slice(0, queryIndex) : base;
      var query = queryIndex >= 0 ? base.slice(queryIndex + 1) : "";
      var kept = query.length === 0 ? [] : query.split("&").filter(function (pair) {
        return pair.split("=")[0] !== LDVH_PROJECT_PARAM;
      });
      kept.push(LDVH_PROJECT_PARAM + "=" + encodeURIComponent(projectId));
      return path + "?" + kept.join("&") + hash;
    }

    function composeFollowedLocation(projectId) {
      if (projectId === null) return ldvhFrameLocation;
      if (ldvhFrameProjectId === projectId) return withProjectParam(ldvhFrameLocation, projectId);
      return withProjectParam(ldvhWebOrigin + LDVH_HOME_PATH, projectId);
    }

    function useFollowedFrameLocation(sessionId, cwd) {
      var frameState = React.useState(null);
      React.useEffect(function () {
        var cancelled = false;
        resolveSessionProject(sessionId, cwd).then(function (projectId) {
          if (cancelled) return;
          frameState[1](function (previous) {
            if (previous !== null && previous.projectId === projectId) return previous;
            if (previous !== null && projectId === null) return previous;
            return { projectId: projectId, src: composeFollowedLocation(projectId) };
          });
        });
        return function () { cancelled = true; };
      }, [sessionId, cwd]);
      var resolved = frameState[0];
      if (resolved === null) return { following: false, src: ldvhFrameLocation };
      return { following: true, src: resolved.src };
    }

    function LdvhSidebarTab(props) {
      var t = props.t;
      var sessionScope = props.scope;
      var sessionId = sessionScope && typeof sessionScope.sessionId === "string" ? sessionScope.sessionId : "";
      var sessionCwd = sessionScope && typeof sessionScope.cwd === "string" ? sessionScope.cwd : "";
      var followed = useFollowedFrameLocation(sessionId, sessionCwd);
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
      if (state.checking || !followed.following) {
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
          src: followed.src,
          title: t("sidebar.title")
        });
      }
      return React.createElement("div", { className: "ldv-view" }, body);
    }

    function LdvhConversationView(props) {
      var t = props.t;
      var sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
      var followed = useFollowedFrameLocation(sessionId);
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
      if (state.checking || !followed.following) {
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
          src: followed.src,
          title: t("view.label")
        });
      }
      return React.createElement("div", { className: "ldv-view" }, body);
    }

    var inject = ["slots", "locale"];

    function apply(ctx) {
      try {
        ctx.effect(function () {
          return ctx.locale.register(LDVH_NS, { zh: LDVH_ZH, en: LDVH_EN });
        }, "dsh-ldvh: settings copy");

        var t = ctx.locale.bind(LDVH_NS);

        ctx.inject(["configForms"], function (formsCtx) {
          var ldvhScope = formsCtx.configForms.get(ldvhEntryIdOf(formsCtx.configForms));

          var registerSettingsSection = function () {
            try {
              return formsCtx.slots.inject("settings.section", function () {
                var disposers = [];
                var sectionInjected = function () {
                  return {
                    t: t,
                    settingsScope: ldvhScope,
                    directoryPicker: ctx.get("remote.directoryPicker"),
                    surface: "settings",
                  };
                };
                disposers.push(formsCtx.slots.register({
                  name: "settings.section",
                  id: LDVH_SETTINGS_SECTION_ID,
                  order: LDVH_SETTINGS_SECTION_ORDER,
                  label: function () { return t("row.title"); },
                  locale: LDVH_NS,
                  inject: sectionInjected,
                }, LdvhSettingsRow));

                try {
                  var iconInject = formsCtx.slots.inject("settings.section.icon", function () {
                    var iconDisposer = formsCtx.slots.register({
                      name: "settings.section.icon",
                      id: LDVH_SETTINGS_SECTION_ID,
                      locale: LDVH_NS,
                    }, function (iconProps) {
                      var edge = iconProps && typeof iconProps.size === "number" ? iconProps.size : 16;
                      return React.createElement("img", {
                        src: LDVH_ICON,
                        width: edge,
                        height: edge,
                        alt: "",
                        style: { borderRadius: "4px", display: "block", opacity: iconProps && iconProps.active === false ? 0.75 : 1 }
                      });
                    });
                    disposers.push(iconDisposer);
                    return iconDisposer;
                  });
                  if (typeof iconInject === "function") disposers.push(iconInject);
                } catch (iconError) {
                  console.error('[dsh-ldvh] settings nav icon failed to register (page unaffected):', iconError);
                }

                return function () {
                  for (var i = 0; i < disposers.length; i += 1) {
                    try { disposers[i](); } catch (alreadyGone) {   }
                  }
                };
              });
            } catch (error) {
              console.error('[dsh-ldvh] settings section failed to register (host provider unaffected):', error);
              return undefined;
            }
          };
          registerSettingsSection();
        });

        var mountDisposers = { sidebar: null, conversation: null };
        var registerSidebarTab = function () {
          var disposeInject = ctx.inject(["betterSidebar"], function (scope) {
            var betterSidebar = scope.betterSidebar;
            if (!betterSidebar || typeof betterSidebar.registerTab !== "function") return;
            var disposeEffect = scope.effect(function () {
              mountDisposers.sidebar = function () {
                try { disposeEffect(); } catch (alreadyGone) { }
              };
              return betterSidebar.registerTab({
                id: "dsh-ldvh:web",
                title: function () { return t("sidebar.label"); },
                icon: function (size) {
                  return React.createElement("img", { src: LDVH_ICON, width: size, height: size, alt: "LDVH", style: { borderRadius: "3px" } });
                },
                order: 35,
                single: true,
                component: function (tabProps) {
                  return React.createElement(LdvhSidebarTab, { t: t, scope: tabProps && tabProps.scope });
                }
              });
            }, "dsh-ldvh: better sidebar tab");
          });
          return function () { try { disposeInject(); } catch (alreadyGone) { } };
        };
        var registerConversationTab = function () {
          var disposeInject = ctx.slots.inject("conversation.view", function () {
            mountDisposers.conversation = function () { try { disposeInject(); } catch (alreadyGone) { } };
            return ctx.slots.register({
              name: "conversation.view",
              id: "ldvh",
              order: 20,
              label: function () { return t("view.label"); },
              inject: function (sessionId) { return { t: t, sessionId: sessionId }; }
            }, LdvhConversationView);
          });
        };

        var applyMountSettings = function (value) {
          var webOn = !value || value.webEnabled !== false;
          var sidebarOn = webOn && value && value.showInSidebarTab !== false;
          var conversationOn = webOn && value && value.showInConversationTab !== false;
          if (sidebarOn && mountDisposers.sidebar === null) {
            registerSidebarTab();
          } else if (!sidebarOn && mountDisposers.sidebar !== null) {
            var offSidebar = mountDisposers.sidebar;
            mountDisposers.sidebar = null;
            try { offSidebar(); } catch (alreadyGone) { }
          }
          if (conversationOn && mountDisposers.conversation === null) {
            registerConversationTab();
          } else if (!conversationOn && mountDisposers.conversation !== null) {
            var offConversation = mountDisposers.conversation;
            mountDisposers.conversation = null;
            try { offConversation(); } catch (alreadyGone) { }
          }
        };

        applyMountSettings({});


        ctx.inject(["configForms"], function (formsCtx) {
          var ldvhScope = formsCtx.configForms.get(ldvhEntryIdOf(formsCtx.configForms));
          formsCtx.effect(function () {
            return ldvhScope.subscribe(function () {
              var snap = ldvhScope.getSnapshot();
              if (snap && snap.status === "ready") applyMountSettings(snap.value || {});
            });
          }, "dsh-ldvh: mount placement subscription");
          try {
            var initialSnap = ldvhScope.getSnapshot();
            if (initialSnap && initialSnap.status === "ready") applyMountSettings(initialSnap.value || {});
          } catch (mountError) {   }
        });

      } catch (error) {
        console.error("[dsh-ldvh] client UI failed to load (host routes unaffected):", error);
      }
    }

    return { apply: apply, inject: inject };
  }
});