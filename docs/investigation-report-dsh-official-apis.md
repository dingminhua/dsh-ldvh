# DSH 官方插件接入面调研报告（Tab / Sidebar / Web 服务）

> 性质：开发设计输入，非规范、非事实对象。
> 目的：为 LDVH 插件实现「主界面 LDVH Tab + Sidebar Web 入口 + Web 前后端服务生命周期」提供 DSH 官方机制依据。
> 方式：纯只读源码调研 `/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/`，未修改任何文件。
> 状态：调研完成，供方案设计与 Human 确认。

## 1. Web 服务生命周期（dsh-host-webserver / dsh-web-app）

### 1.1 核心：`WebServer` Service（`dsh-host-webserver/lib/index.js`）

- `WebServer extends Service(ctx, "webServer")`，配置 `z.object({ host: "127.0.0.1"|"0.0.0.0", port: 0..65535 })`。
- `[Service.init]()` 里 `createServer(node:http)`，`this.server.listen(config.port, config.host)`，listen 成功后才 resolve；失败 reject 整个 fiber（boot 报告失败）。
- 三个路由注册表 + 回退席位：
  - `register({kind:"exact"|"prefix", path, handler})` → 返回 disposer（删除路由）。
  - `registerUpgrade({path, handler})` → HTTP upgrade（WS/SSE socket）。
  - `registerFallback(handler)` → **唯一**回退席位，处理所有未匹配请求（SPA dist 服务器）。再次注册抛错。
  - `match(pathname)`：exact 表优先，prefix 表最长前缀匹配。
- **生命周期清理（ctx.effect）**（第 253-267 行）：

  ```js
  this.ctx.effect(() => async () => {
    const serverClosed = new Promise(res => this.server.close(res));
    this.server.closeAllConnections();
    const upgradedClosed = [...this.upgradedSockets].map(socket => new Promise(res => {
      socket.once("close", res); socket.destroy();
    }));
    await Promise.all([serverClosed, ...upgradedClosed]);
  }, "webServer.listen");
  ```

  卸载插件 → effect 逆序执行 → 关掉 server、强杀连接与升级 socket。**这就是插件卸载与 Web 服务停止的联动机制**。
- 端口来源：`config.port`。port=0 时取 OS 分配值 `this.server.address().port`（`this.port` getter）。宿主组合通过 `!!js` 表达式注入。

### 1.2 host/port 由组合层注入（dsh-web-app/cordis.patch.yml）

```yaml
- id: web-startup
  name: '@deepseek-ai/dsh-web-app/startup'   # 解析 --host/--port/--no-open/--trusted-host，provide webStartup
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port ?? 3080
```

端口来自 CLI（--port，0=OS 分配），默认 3080。webStartup 拒绝 `--host 0.0.0.0`（安全）。

### 1.3 错误处理

- handler 抛错 → `ctx.logger.warn`；若 headers 未发送 → 500/400。
- server `error` 事件 listen 后用 `ctx.logger.error` 记录。
- route 注册重复 (kind,path) 抛错（组合级契约）。

## 2. 前端静态托管（dsh-host-frontend-static）

- `name="frontend-static"`, `inject=["webServer"]`, `Config={distIndex}`。
- `apply(ctx, config)` 里 `ctx.effect(() => ctx.webServer.registerFallback(...))` —— **占用回退席位**（SPA 服务器）。
- `serveStatic(pathname, res, distRoot, distIndex, renderIndex)`：
  - 目录穿越防护：`resolve(normalize(join(distRoot, pathname)))` 必须落在 distRoot 内，否则 403。
  - 非 GET/HEAD → 405；缺失/目录 → 404。
  - dist 根与 index 路径渲染 `renderIndex()`（走 webServer 的结构化 index 注入 + raw taps）；其它扩展名查 MIME 表，未知 → octet-stream。
- **它正是 Web 前端（dsh-web-frontend 构建的 dist）的宿主**。dsh-web-app 里 `resolveDistIndex()` = `require.resolve("@deepseek-ai/dsh-web-frontend/dist/index.html")`，然后 `ctx.plugin(FrontendStatic, { distIndex })`。
- 结论：**官方不运行 dev/preview server 进程，而是启动一个 node:http 服务器（webServer）+ 静态文件回退服务 dist**。

## 3. 主界面 Tab / 布局 与 Sidebar —— Slot 路径清单

### 3.1 布局（dsh-client-ui-layout/lib/client.js）

- 三列布局 `AppFrame` 注册进内建 **`'root'`** slot（`slots.register({name:"root", children:{...}}, AppFrame)`）。web shell 只渲染 `'root'`。
- `root` 的 children 声明：
  - `"sidebar"` — single / scope=root（AppFrame 渲染 `renderSlot("sidebar",{collapsed,width})`）
  - `"conversation"` — single / scope=session-maybe（**内容区/中列**）
  - `"details"` — single / scope=session（右列）
  - `"shell.overlay"` — list / scope=root（全局浮层）
- 提供 `ctx.layout` service（toggleSidebar/openDetails/closeDetails）。
- 注入 `["slots","theme"]`，还做主题呈现。

### 3.2 Sidebar（dsh-client-ui-sidebar/lib/client.js）

- `slots.register({name:"sidebar", children:{...}}, SidebarRoot)`，children：
  - `"sidebar.brand.mark"` — single/root（左上 logo，默认 FishLogo）
  - `"sidebar.brand.name"` — single/root
  - `"sidebar.workspaces"` — single/root（**工作区/会话浏览区**，New Session 与 foot 之间）
  - `"sidebar.settings"` — single/root（底部设置区）
  - `"sidebar.footer.action"` — **list/root**（底部操作项，可多个）
- SidebarRoot 渲染 `renderSlot("sidebar.workspaces",{wide,expandSidebar})`、`renderSlot("sidebar.footer.action",{wide})`、`renderSlot("sidebar.settings",{wide})`。
- 注入 `["slots","layout","sessions","workspaces","locale"]`。

### 3.3 完整 Slot 路径清单（从各 client 插件源码枚举）

**root 层**（由 layout 声明）：
- `sidebar`、`conversation`、`details`、`shell.overlay`

**sidebar.\*** （由 ui-sidebar 声明）：
- `sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.workspaces`、`sidebar.settings`、`sidebar.footer.action`
- `sidebar.workspaces.directoryFlow`（由 ui-workspace 声明，single/root）

**settings.\*** （由 ui-settings-general 在 sidebar.settings 内声明）：
- `settings.trigger`(single/root)、`settings.header`、`settings.action`(list)、`settings.close`、`settings.section`(list/root)、`settings.onboarding`(list)、`settings.general.item`(list)

**conversation.\*** （由 ui-conversation 声明，session/session-maybe 作用域）：
- `conversation.session`、`conversation.session.header`、`conversation.session.header.actions`、`conversation.session.header.lineage`、`conversation.session.header.utilities`
- `conversation.composer`(chain)、`conversation.composer.bar`、`conversation.composer.dock`
- `conversation.input.dock`、`conversation.input.overlay`、`conversation.input.left/right`、`conversation.input.attachments`、`conversation.input.plan`、`conversation.input.model`
- `conversation.chat.node`、`conversation.chat.commandview`、`conversation.chat.turnTail`、`conversation.chat.assistant-actions`
- `conversation.hero.agentPreset`、`conversation.hero.brand.mark`、`conversation.hero.workspace`、`conversation.hero.workspace.directoryFlow`
- `conversation.view`、`conversation.message.images`、`conversation.details.tool`
- dock 插件：`conversation-todo-dock`、`conversation-queue-dock`

**tool/shell/其他**：
- `tool.call.toolview`、`tool.view.cordis`（ui-cordis）、`details.close/empty/input/notInWindow/output/running/title`、`shell.overlay`

**重要结论：官方主界面没有「顶部水平 Tab 栏」slot。** 布局是固定的三列 `sidebar | conversation | details` + `shell.overlay`。LDVH 若要「主界面 LDVH Tab」，需自行在 `conversation`（替换/包一层内容区）或 `details` 里实现 Tab，或注册 `sidebar.footer.action`/`sidebar.workspaces` 做 Sidebar Web 入口。

### 3.4 dsh-client-ui-slots 的定位（纠正任务预期）

`dsh-client-ui-slots` **不是 Slot 调试/查看工具**，而是 **SlotMap 纯核心库**（无 React、无 Cordis 依赖）：`SlotCore.register` 声明合并、single/keyed/list/chain 四类 slot、store seat、renderer 安装约定。它本身不运行。真正的 Slot 树枚举手段：
- `ctx.slots.snapshot(root?)`（SlotsService 暴露 `_core.snapshot()`）
- 宿主 Inspect 工具的 `Slots.listSubTree`（对应 dsh-tool-cordis 的 `cordis_inspect_list/query`）

## 4. iframe 嵌入官方做法

- **在全部非 dist 的 lib/client 源码中，没有任何 iframe 用法**（`grep iframe` 仅命中 web 前端 dist bundle 中 React 内部的 `case "iframe"` 事件派发，不是真实嵌入）。
- 官方没有「在 DSH UI 中 iframe 嵌入第三方 Web 页面」的 Slot 或组件。
- **DSH 自身「Web 页面」与 LDVH「LDVH Web 页面」的关系**：
  - `dsh-web-frontend` = DSH 自带的浏览器前端，是 **Vite 构建的 SPA dist**（`dist/index.html` + assets），由 `frontend-static` 通过 webServer fallback 席位服务。
  - `dsh-web-app` = 组合包，把 dist 挂到 webServer 下，提供 `webRuntime`、URL 行、浏览器打开、`DSH_WEB_URL` bash 变量、web-surface 提示词。
  - 也就是说：**DSH 的「Web 形态」就是把一个 React SPA 构建后由自身 node:http 服务器托管**，不是第三方页面 iframe。
- **对 LDVH 的含义**：LDVH 若要做「外部 React SPA + 后端 API」，最贴合官方模式的做法是 —— ①在 webServer 上注册 `prefix` 路由（如 `/ldvh/api`）托管后端 API；②在 webServer 上再注册 `prefix` 路由（如 `/ldvh/`）服务 LDVH SPA dist，或用 frontend-static 的额外 fallback/子路径；③在 client 侧用 slot 渲染一个 React 组件（iframe 或直接嵌 React 树）作为 LDVH Tab 内容。iframe 不是官方模式，但 slot 组件里完全可以用 `<iframe src="/ldvh/">`（同源，走同一 webServer）。

## 5. Client 接入 Slot 的代码模式

### 5.1 插件入口/导出（client 插件 bundle）

每个 client 插件的 `lib/client.js` 都这样导出：

```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-ui-sidebar",
  factory: (require) => {
    // ... 编译后的 CJS 模块，最后：
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

- `dsh-client-modules` 作为宿主侧：扫描插件树 → 组合 `window.__DSH_BOOT__` → 服务 `/plugins/<id>/client.js`（module-graph 顺序）。浏览器侧 `window.__ModuleLoader__.load({id,factory})` 注册模块。
- **client 插件本身是 Cordis 插件**（loader 把模块 exports 作为对象插件），有 `inject` 与 `apply(ctx)`。

### 5.2 slots.inject + slots.register 完整样例（官方最标准用法）

以 `dsh-client-ui-settings-general/lib/client.js` 为例（注册设置面板到 sidebar.settings，并声明子 slot）：

```js
const inject = ["slots", "locale", "connection", "settingsScope"];

function apply(ctx) {
  // 先注入字典命名空间
  ctx.effect(() => ctx.locale.register("settings", { zh, en }), "...dictionaries");

  // 等 sidebar.settings 声明出现后再注册（声明注入）
  ctx.slots.inject("sidebar.settings", () => ctx.slots.register({
    name: "sidebar.settings",
    children: {
      "settings.trigger": { kind: "single", scope: "root" },
      "settings.header":  { kind: "single", scope: "root" },
      "settings.action":  { kind: "list",   scope: "root" },
      "settings.close":   { kind: "single", scope: "root" },
      "settings.section": { kind: "list",   scope: "root" },
      "settings.onboarding": { kind: "list", scope: "root" }
    },
    inject: shellInjected   // 返回业务 props（hooks 快照等）
  }, SettingsRoot));
  // 再向这些子 slot 注入具体贡献
  ctx.slots.inject("settings.trigger", () => ctx.slots.register({ name: "settings.trigger", locale: NS }, TriggerContent));
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section", id: "general", order: 0,
    label: () => t("general.nav"), locale: NS,
    children: { "settings.general.item": { kind: "list", scope: "root" } }
  }, GeneralSection));
}
```

- **`ctx.slots.inject(name, cb)`**：把 slot 声明当依赖。声明在→同步跑 cb；不在→等待；声明折叠→dispose cb effect；重新声明→重跑。回调返回 disposer 或 yield 多个 register 的 generator（事务）。**控制器归调用方插件 fiber**，卸载即取消。
- **`ctx.slots.register({name, children?, store?, inject?, locale?, ...kind}, Component)`**：向已声明 slot 贡献组件 + 声明子 slot。kind（single/keyed/list/chain）在父声明中定义；list 需要 `id`+`order`，single 同 priority 只能一个。
- **组件通过 props 接收**：`renderSlot`（子 slot 渲染）、`useStore`（store selector）、业务 `inject` 返回的 props、运行时 share（collapsed/width 等）。AppFrame 把子 slot 用 `renderSlot("sidebar", {...})` 渲染，并把 `renderSlot` 传给 SidebarRoot，逐层下传。
- 若直接 `slots.register` 到未声明 slot → 抛错。所以**官方规范是先 `slots.inject(target, ...)` 再在其内 `slots.register`**。

### 5.3 注册到 sidebar 的入口样例（LDVH 最相关）

`dsh-client-ui-cordis` 注册底部操作项（list slot，可叠加）：

```js
ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
  name: "sidebar.footer.action",
  id: "cordis-panel",        // list slot 需要唯一 id
  locale: NS,
  inject: () => ({ hooks: {...}, onRun, onStop, ... })
}, CordisPanel));
```

`dsh-client-ui-workspace` 注册工作区浏览（single slot，独占）：

```js
ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
  name: "sidebar.workspaces",
  children: { "sidebar.workspaces.directoryFlow": { kind:"single", scope:"root" } },
  store: createWorkspaceViewStore(),
  inject: browserInjected, locale: NS
}, WorkspaceBrowser));
```

注意 `sidebar.workspaces` 是 **single**，已被 ui-workspace 占用；`sidebar.footer.action` 是 **list**（可加）。

## 6. Host 侧启动子进程 / 后台服务（官方模式）

### 6.1 `ctx.subprocess`（dsh-subprocess + dsh-subprocess-local）

- Service Definition `SubprocessRuntime extends Service(ctx,"subprocess")`；实现 `ctx.subprocess.spawn(...)`。
- **环境脱敏**：`scrubbedParentEnv()` 去掉所有 `KEY|PASSWORD|SECRET|TOKEN`（大小写不敏感）与所有 `DSH_*` 变量；显式 env 在脱敏后合并覆盖。
- **spawn 语义**（dsh-subprocess-local/lib/index.js `spawnSubprocess`）：
  - `spec.argv`（program + args）、`spec.cwd`、`spec.env`、`spec.stdio.{stdin,stdout,stderr}`（`collect` 带 maxBytes 尾部 + spill 文件，或 pipe 原始流）、`spec.graceMs`、`spec.signal`（AbortSignal）。
  - **detached 进程树**；POSIX 用进程组 `process.kill(-pgid, sig)`，Windows 用 `taskkill /T /F`。
  - **终止 = SIGTERM→grace→SIGKILL** 树级升级，唯一终止动词 `handle.terminate()`。
  - `spawn` 立即返回 live handle；`done` 在 close 时 resolve（含 exit facts）；spawn 失败才 reject。
  - `ctx.subprocess` 的 `inject: []`，host 侧一行即可加载。

### 6.2 后台任务系统（dsh-jobs / dsh-jobs-local）

- `dsh-jobs` 定义 JobId 等共享类型；实现是 registry + controller 模式。适合管理「后台长期任务」的注册、取消、状态查询。
- 前端 `dsh-client-ui-jobs` 提供任务 UI。
- **LDVH 建议**：若需独立启动后端 Node 服务进程，用 `ctx.subprocess.spawn({argv:[node, script], ...})` 拉起来，把生命周期用 `ctx.effect` 包住：卸载时 `handle.terminate()`。更简单可靠的是「**直接复用宿主 webServer 注册 prefix 路由**」——不需要额外进程。

### 6.3 代码执行（dsh-code-runtime）

- `ctx.codeRuntime.run(request)` 运行一段程序（worker-thread 后端），`dispose` 终止进行中运行并等待退出。适合跑「小段确定性代码」而非常驻服务；isolation 仅 `worker-thread`（process/container 未实现）。

## 7. 对 LDVH 的落地建议

基于官方源码的可靠结论：

1. **Sidebar Web 入口**：注册进 **`sidebar.footer.action`**（list slot，可叠加多个、id 唯一）→ 或若想进工作区列表则需 shadow/replace single 的 `sidebar.workspaces`（不推荐，会被现有占用冲突）。推荐 `sidebar.footer.action`。样例如 §5.3（抄 ui-cordis 的 CordisPanel）。

2. **主界面 LDVH Tab**：官方没有顶层 Tab slot。两种可行方案：
   - **方案 A（推荐，贴合官方）**：在 `conversation` slot 内做视图切换。但 `conversation` 是 single/session-maybe 且已被 ui-conversation 占用（shadow 需优先级）。更稳妥：注册到 `conversation.session` 或 `conversation.view` 下，或做成 `shell.overlay` 浮层/独立面板。
   - **方案 B（LDVH Tab 面板）**：用 `slots.inject("conversation.composer.dock")` 或 `conversation.details.tool` 等 list 槽挂 Tab 组件；或干脆用 `sidebar.footer.action` 点开一个 `shell.overlay` 全屏 LDVH 面板。
   - 结论：**LDVH「主界面 Tab」没有现成 slot，需在 conversation 区（session 作用域）或 shell.overlay 上自建**，并明确 UI 优先级与 shadow 策略。

3. **Web 服务被插件管理**（后端 API + LDVH SPA）：
   - 写一个 host 插件 `apply(ctx)`，`inject:["webServer"]`，用：
     - `ctx.effect(() => ctx.webServer.register({kind:"prefix", path:"/ldvh/api", handler}), "ldvh:api")` 挂后端 API；
     - `ctx.effect(() => ctx.webServer.register({kind:"prefix", path:"/ldvh", handler}), "ldvh:spa")` 服务 LDVH SPA dist（抄 frontend-static 的 serveStatic：防穿越 403、MIME、404/405）；
     - 生命周期全交给 `ctx.effect` → 插件卸载自动停。
   - **端口不用自己管**：直接复用 `ctx.webServer.port`（LDVH SPA 内用相对路径/`/ldvh/*` 即可同源）。
   - 若必须独立进程：`ctx.subprocess.spawn` + `ctx.effect` 内 `terminate()`。

4. **Client 侧 LDVH 插件**：`window.__ModuleLoader__.load({id, factory})`，`apply(ctx)` 里 `ctx.slots.inject(...)` → `ctx.slots.register(...)`。React 组件用 `React.createElement`/`jsx`，CSS 用 CSS-in-JS（官方 client.js 内嵌 CSS 文本 + `data-plugin-css` style 注入）。若想在 LDVH Tab 里 iframe 自己的 SPA：`<iframe src="/ldvh/">`（同源 webServer，非官方但可行）。

5. **DSH_WEB_URL / 组合**：LDVH 插件应作为独立组合行挂到会话 preset（host 行注册 webServer 路由；client 行注册 slot），参照 `dsh-web-app/cordis.patch.yml` 的 `!!js` 配置表达式与 `inject` 写法。

## 8. 开放问题（questions）

1. LDVH「主界面 Tab」到底指哪个区域？conversation 区是 session 作用域（随会话切换），若 LDVH Tab 要全局常驻，需用 root 作用域的自建 slot（官方没有，需在 layout 层扩展或自建 shell.overlay 面板）。
2. LDVH Tab 与 DSH 原有会话/对话区的共存策略：替换（shadow conversation）、并列（composer dock）、还是独立浮层？决定 slot 选择。
3. LDVH Web 后端是「复用宿主 webServer 加 prefix 路由」（推荐、零端口管理）还是「独立子进程 + ctx.subprocess」（需自行管理端口/生命周期/进程树终止）？
4. LDVH SPA 是否需要在 Electron Desktop（file:// + IPC）与 Web（http:// + webServer）两种表层同时可用？Desktop compatibility 模式下 dist 走 file://，prefix 路由服务方式可能不同。
5. 是否需要一个官方 Slot 调试面板来验证 LDVH 注册是否生效（可用 `ctx.slots.snapshot()` / Inspect `Slots.listSubTree`）。
6. 若 LDVH 需要展示自己的「项目信息呈现」页面，是否接受用 iframe 嵌同源 SPA（官方无此先例，但技术上可行），还是纯 React 组件内联渲染？
