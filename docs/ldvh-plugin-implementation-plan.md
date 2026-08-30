# LDVH 插件落地方案（dsh-ldvh）

> 性质：开发设计输入，非规范、非事实对象。
> 依据：`docs/dsh-plugin-binding-plan.md` 第 13.1 节近期计划；三份调研报告（参考插件工程规范 / v4 Web 迁移盘点 / DSH 官方接入面）。
> 状态：方案已定，待按序实施；重大方向变更需 Human 确认。

## 1. 已确认决策

| 决策点 | 结论 |
|---|---|
| DSH 注册插件 ID | `dsh-ldvh`（与仓库同名，避免冲突） |
| Web 服务形态 | **方案 A：复用宿主 webServer**。在 DSH `webServer` 上注册 `/ldvh/api`（后端 API）与 `/ldvh`（前端 SPA）两个 prefix 路由；零端口管理，随插件自动启停，卸载自动清理（`ctx.effect`） |
| 主界面呈现 | **会话区视图 tab（与 trajectory 同构）**：注册 `conversation.view`（list/session 作用域，id: `ldvh`），会话区 header 出现「LDVH」tab，点击后在会话 body 呈现 Web 页面；与 chat/trajectory 并列，随会话切换 |
| 设置面板 | 参考 `dsh-subagent-default-model`：`@deepseek-ai/schemastery` Schema + `installSettingsSection` + `ctx.slots.inject("settings.plugin.item", ...)` |
| 发布/工程规范 | 与 `dsh-subagent-default-model` 对齐（plugin/ 子目录、package.json 字段、cordis.patch.yml、node --test、双语 README、CHANGELOG、MIT、图标） |
| Web 代码 | 先完整迁入 v4 `web/` 建立可运行基线，再按 v5 调整（遵守第 14 章吸收纪律） |

## 2. 方案 A 对原需求的影响

原需求「前端端口、后端端口可设置、自动启动两个服务」在方案 A 下调整：

- **不再设置前后端端口**：前端/后端都挂在宿主 webServer 上，端口 = DSH webServer 端口（默认 3080）。设置面板不再提供端口字段，改为只读展示当前访问地址。
- **「自动启动」语义**：插件加载即注册路由（= 服务可用），无需额外启动步骤。
- **「关闭/重启服务」语义**：插件管理页提供「停用 LDVH Web」（注销路由）与「启用 LDVH Web」（重新注册路由）控制；完全关闭 = 插件停用/卸载。
- **设置面板保留字段**：默认管辖文件位置（07 语义为准，暂以目录形式配置）、Web 启用开关（可选）。

如后续需要独立进程形态（原方案 B），预留 `ctx.subprocess` 升级路径，不在本期实现。

## 3. 插件总体结构

新建 `plugin/` 子目录承载插件包，与参考项目对齐：

```
plugin/
├── package.json            # name: dsh-ldvh，dsh.bundle.patch 等字段
├── cordis.patch.yml        # bundle patch（insert 插件行）
├── lib/
│   ├── index.js            # Host 半边：settings schema、webServer 路由、状态服务
│   └── client.js           # Client 半边：设置面板 UI、sidebar 入口、overlay 面板
├── web/                    # v4 web 迁移（前端 src + 后端 api + shared + tests → 适配）
├── test/                   # *.test.mjs（node --test）
├── icons/                  # ldvh-plugin-icon-*.png
├── README.md / README.en.md
├── CHANGELOG.md
└── LICENSE
```

仓库根目录补充：`PLUGIN_REQUIREMENTS.md`、`RELEASING.md`、`DEVELOPMENT.md`（对齐参考项目发布门面）。

## 4. 设置面板（Host Schema + Client UI）

设置面板承载三类配置：**管辖项目登记管理**、**默认管辖配置存放目录**、**Web 路由开关**。管辖登记以 07 为唯一权威，插件不建立第二套登记定义。

### 4.1 默认管辖配置存放目录

- 字段：`governanceDirectory`（默认管辖配置存放目录）。
- 默认值：DSH 正式 API 解析的用户配置根下的 `ldvh/` 目录（`dshHomePath("ldvh")`，默认 `~/.dsh/ldvh`，识别 `$DSH_HOME`），不硬编码系统路径（07 §5.1）。
- 该目录是登记载体 `governed-projects.yaml` 的存放位置；留空使用默认值。
- UI：路径输入 + 帮助文本（说明绝对路径要求、留空默认位置、最终解析位置）。

### 4.2 管辖项目登记管理

- 列表：读取登记载体，展示 `projects[]`（id/path/name/description）与 `default_project_id`，并附载体实际路径。
- 登记：Human 在设置面板表达登记意图并提供项目目录后，校验该目录为 Git 项目（存在 `.git`，07 §5.5），按 07 Schema 原子写入，回读确认。
- 取消登记：Human 明确要求取消时，从 `projects[]` 移除对应项并回读确认（07 §5.7）。
- 默认项目：设置/取消 `default_project_id`；`projects: []` 时必须为空，项目非空时必须精确匹配一个 `projects[].id`（07 §5.2）。
- 前置状态：载体不可读/不可写/权限不足/Schema 无效时统一呈现 `unavailable` 与精确缺口，不伪装为可执行、不伪装为「未管辖」（07 §7）。
- 并发：写入前每次重新读取并验证当前 Schema，冲突返回冲突并提示重新读取（07 §5.6）。

### 4.3 Client 侧 UI（`lib/client.js`）

- 注册 `settings.plugin.item` 行 → 渲染设置面板：管辖项目管理（列表/登记/取消/默认项目）+ 默认管辖配置存放目录 + Web 开关 + 保存/放弃（脏检查 + 校验）。
- 注册 `conversation.view` 视图 tab（id: `ldvh`，与 trajectory 同构）→ 会话区 header 出现「LDVH」tab，点击后在会话 body 呈现 Web 页面。
- 视图 body：加载中 / iframe 呈现 `/ldvh/` / 错误态（服务不可用提示 + 重试 + 引导到插件设置）。Session 作用域：视图随会话切换，读取会话快照走标准 kit。

#### 4.3.1 conversation.view 实现（已落地，`lib/client.js`）

```js
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
```

- `LdvhConversationView`：挂载时探测 `/ldvh/api/health`；`checking` → 加载中；`failed` → 错误 + 重试；`ready` → 渲染 iframe `src="/ldvh/"`（同源宿主 webServer）；卸载时取消探测（避免卸载后 setState）。
- 完全对照 `dsh-client-ui-trajectory` 的注册模式（`ctx.slots.inject("conversation.view", () => ctx.slots.register(...))`），`conversation.view` 为 list/session 作用域，会话 body 按 `only: <active id>` 一次渲染一个视图 tab。
- 已移除早期候选的 `sidebar.footer.action` 入口与 `shell.overlay` 全屏面板（呈现决策变更，见 `docs/dsh-plugin-binding-plan.md` §13.1.6）。

## 5. Web 服务接入（Host）

`lib/index.js` 中 `inject: ["webServer", "settings"]`，用 `ctx.effect` 注册路由：

```js
ctx.effect(() => {
  const apiDisposer = ctx.webServer.register({ kind: "prefix", path: "/ldvh/api", handler: apiHandler });
  const spaDisposer = ctx.webServer.register({ kind: "prefix", path: "/ldvh", handler: spaHandler });
  return () => { apiDisposer(); spaDisposer(); };
}, "ldvh:web");
```

- `apiHandler`：迁入的 v4 Express 业务逻辑适配为 handler（objects/cognition/changelog/docs/project-files/settings/health）。
- `spaHandler`：迁入 v4 `src/` 构建出的 dist，静态托管参照 `dsh-host-frontend-static`（防目录穿越 403、MIME、404/405、SPA index 回退）。
- 状态服务：提供 `ctx.ldvhWeb` 状态查询（enabled/routes 注册状态/访问地址）给插件管理 UI 与 Client。

## 6. 前端/后端迁移要点（v4 web/ → plugin/web/）

- **直接复用**：`src/` 前端组件/页面、`api/services/` 业务服务、`shared/` 契约、`tests/api/` 契约测试。
- **需适配**：
  - Express app → 无框架 handler（或保留 Express 路由表但由 handler 包装，去掉自建端口 listen 与 CORS）；
  - Vite dev server / 代理 → 构建为静态 dist 由 webServer 托管；`/api` 相对路径同源；
  - BrowserRouter → 若 SPA 走 `/ldvh/` 前缀，路由库需要 basename 适配；
  - `LDVH_ROOT` / Helper 执行路径 → 由 Host 注入正确值（v5 工作区路径）；
  - 生成文件链 `shared/workcasePresentationContract.generated.ts` → 保留生成脚本并纳入构建。
- **应废弃**：`api/index.ts`(Vercel)+`vercel.json`、`auth.ts` 501 桩、`vite-plugin-trae-solo-badge`、`react.svg`、无效 `pnpm-workspace.yaml`、双锁文件、未用 `zustand`。

**迁移分两步**：(1) 先原样迁入 + 最小适配，用插件加载 + webServer 路由验证可访问；(2) 建立与 v4 的差异清单，再按 v5 逐项调整。

## 7. 插件管理页服务控制

- 显示：Web 启用状态、访问地址（`http://<host>:<webServer 端口>/ldvh/`）、路由注册状态、最近失败原因。
- 操作：启用 / 停用 Web；重启（注销再注册）；全部随插件生命周期自动清理。
- 失败提示区分：配置缺失 / 路由冲突 / SPA 资源缺失 / 页面不可达。

## 8. 实施顺序

1. ✅ 调查参考插件工程规范（已完成）
2. ✅ 盘点 v4 Web（已完成）
3. ✅ 核验 DSH 官方 Tab/Sidebar/Web 服务接口（已完成）
4. ⛳ 沉淀方案（本文档）
5. 建立 `plugin/` 骨架（package.json、cordis.patch.yml、lib/index.js、lib/client.js 空壳、test）
6. 迁入 v4 web 并最小适配，webServer 路由跑通
7. 实现设置面板（Schema + UI）
8. 实现 `conversation.view` LDVH 视图 tab（与 trajectory 同构，iframe 呈现）
9. 实现插件管理 Web 启停控制
10. 验证：插件加载、Web 可访问、侧边栏入口、面板打开、停用/重启、卸载清理、not_governed 零干扰
11. 补齐发布门面（README 双语、CHANGELOG、RELEASING、版本号）

## 9. 完成条件

1. `dsh plugin add` 安装后插件可加载，无报错；
2. Web 前端经 `/ldvh/` 可访问，后端 API 经 `/ldvh/api` 可用；
3. 会话区出现「LDVH」视图 tab（与 trajectory 同构），点击正确呈现 Web；
4. 设置面板可配置管辖目录与 Web 开关，保存生效；
5. 插件管理可停用/重启 Web，失败有明确提示；
6. 插件卸载后 webServer 路由被清理，无残留进程/端口占用；
7. not_governed 项目零干扰；
8. 发布门面齐全且与能力一致（README 不超前宣传）。

## 10. 开放问题（实施中确认）

1. v4 Express 业务是否保留 Express 路由层还是全部改为原生 handler（决策影响适配量）；
2. `governanceDirectory` 为空时的默认位置（DSH 用户配置根下 `ldvh/`？仍需与 07 对齐）；
3. SPA basename（`/ldvh/` 前缀下 BrowserRouter 配置）；
4. `conversation.view` 会话作用域下 iframe 的地址与会话切换语义（视图随会话走，必要时按会话注入 `/ldvh/?session=<id>`）。