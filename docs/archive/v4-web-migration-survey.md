# v4 Web 迁移盘点报告（供 v5 迁入 DSH 插件壳使用）

> 调查对象：`/Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4/web`（只读，未做任何修改）
> 用途：v5 将 v4 Web 完整迁入 DSH 插件壳（`window.__DSH_BOOT__` + Cordis Client Slot）前的前置盘点。
> 调查时间：基于 v4 `web/` 当前磁盘状态（含 `docs/` 2026-08-19、`dist/` 2026-08-23 等）。

---

## 0. 概览表

| 目录 | 职责 | 源码文件数 | 说明 |
|---|---|---|---|
| `src/` | 前端（React SPA） | 74 | pages/components/hooks/lib/i18n/assets/utils + 入口 |
| `api/` | 后端（Express + 服务层） | 23 | 6 个路由文件 + 12 个服务文件 + 3 个入口（app/index/server） |
| `shared/` | 前后端共享 TS 契约/投影 | 7 | 纯函数与常量，被 `api/` 与 `src/` 同时 import |
| `tests/` | 后端 API 契约测试 | 40（全部在 `tests/api/`） | 纯 Node `node:test`，无前端组件测试 |
| `public/` | 静态资源 | 10 | 仅 LDVH 插件图标（png 多尺寸） |
| `docs/` | Web 页面设计文档 | 8 | 设计规范（非运行时资源） |
| `dist/` | 生产构建产物 | — | `vite build` 输出（index.html + assets/ + 图标） |

注：`package.json` 版本为 `4.1.0`；同时存在 `package-lock.json` 与 `pnpm-lock.yaml`（历史遗留，见 §7）。

---

## 1. 前端（`src/`）

### 1.1 技术栈（来自 `docs/01-全局设计约束.md §1.1` 与 `package.json`）

| 层 | 技术 | 版本 |
|---|---|---|
| 框架 | React | ^18.3.1（**React 18**，非 19） |
| 语言 | TypeScript | ~5.8.3（strict） |
| 构建 | Vite | ^6.3.5（dev 端口 5173，strictPort） |
| 样式 | Tailwind CSS | ^3.4.17（darkMode: class，`@tailwind base/components/utilities`） |
| UI 图标 | lucide-react | ^0.511.0 |
| 路由 | react-router-dom | ^7.3.0（**v7**，代码用 `BrowserRouter/Routes/Route/NavLink` 经典 API） |
| Markdown | react-markdown + remark-gfm | ^10.1.0 / ^4.0.1 |
| 代码高亮 | react-syntax-highlighter | ^16.1.1 |
| 状态管理 | **zustand**（依赖列表有，但**源码未见实际使用**，见 §7） | ^5.0.3 |
| 类名合并 | clsx + tailwind-merge | ^2.1.1 / ^3.0.2 |
| 主题 | 自研 `useTheme` hook（system/light/dark） | — |

### 1.2 入口与路由

- **入口链**：`index.html` → `src/main.tsx` → `src/App.tsx`。
  - `main.tsx`：`createRoot(...).render(<StrictMode><I18nProvider><App/></I18nProvider></StrictMode>)`，并 `import './index.css'`。
  - `App.tsx`：`<BrowserRouter><I18nProvider><ProjectScopeProvider><AppRoutes/></...>`。
- **路由表**（`App.tsx` 内 `AppRoutes`，全部包在 `<Layout>` 里）：

| 路径 | 页面组件 |
|---|---|
| `/` | `pages/CognitionCenter.tsx`（聚焦页，1170 行） |
| `/project-files` | `pages/ProjectFiles.tsx`（290 行） |
| `/changes` | `pages/Changes.tsx`（434 行） |
| `/objects/:type` | `pages/ObjectList.tsx`（2117 行） |
| `/objects/:type/:id` | `pages/ObjectDetail.tsx`（1591 行）+ `object-detail/WorkCaseReadingLayout.tsx`（2753 行） |
| `/changelog` | `pages/Changelog.tsx`（252 行） |
| `/changelog/:hash` | `pages/ChangelogDetail.tsx`（88 行） |
| `/settings` | `pages/Settings.tsx`（146 行） |
| `*` | `<Navigate to="/" replace />` |

### 1.3 目录结构与职责

- **`src/pages/`**：每个路由一个页面。
  - 顶层：`CognitionCenter`（聚焦页：待决定事项/推进中/近期动态/Spark 健康度/近期热点）、`ObjectList`、`ObjectDetail`、`ProjectFiles`、`Changes`、`Changelog`、`ChangelogDetail`、`Settings`。
  - 子目录（大型页面的拆分逻辑，非路由）：
    - `pages/cognition/CommitHotspotGraph.tsx`（近期热点关系图，715 行，SVG/布局）
    - `pages/object-detail/`：`WorkCaseReadingLayout.tsx`、`FactAssociationsSection.tsx`、`FactReadingLayouts.tsx`、`factReadingProjection.ts`、`model.ts`、`fieldIssues.ts`
    - `pages/project-files/`：`model.ts`、`useProjectFilesController.ts`
    - `pages/changes/useWorkspaceChanges.ts`（工作区变更数据 hook）
- **`src/components/`**：通用 UI 组件（30 个 + `reading-panel/` 子目录）。
  - 布局类：`Layout.tsx`（左导航/主内容/右阅读区三栏）、`Sidebar.tsx`、`PageHeader.tsx`、`ProjectSwitcher.tsx`
  - 卡片/状态类：`StatusBadge`、`PriorityIcon`、`CommitBreakingBadge`、`CommitPushStatusBadge`、`CommitSignatureMeta`、`ObjectUpdatedMeta`、`ObjectStatusFilter`、`ObjectPriorityFilter`、`ObjectReportKindFilter`、`ObjectIdentityActions`、`WorkCaseProgressFilter`、`WorkCaseProgressTrack`、`WorkCaseCriteriaList`、`WorkCaseCapabilityStatusBadge`
  - 展示类：`MarkdownPreview`、`ReferenceCard`、`EvidenceBlock`、`SummaryText`、`ChecklistCard`、`CopyPathButton`、`ObjectReferenceCopyButton`、`DocPreviewLink`、`SegmentedControl`、`SemanticIcon`
  - 扩展阅读：`ReadingPanel.tsx` + `reading-panel/PanelContent.tsx` + `reading-panel/commitModel.ts`
- **`src/hooks/`**：仅 `useTheme.ts`（主题三态 + 系统跟随）。
- **`src/lib/`**：仅 `utils.ts`（导出 `cn()` = `twMerge(clsx(...))`）。
- **`src/i18n/`**：`context.tsx`（`I18nProvider` + `useI18n`，localStorage key `ldvh-locale`）+ `locales.ts`（`UI_LOCALES`，zh/en 双语，量极大；含 `getStatusLocale`/`getFieldLabel`/`getCommitTypeLocale` 等辅助）。
- **`src/utils/`**：前端核心逻辑层。
  - `api.ts`（1055 行）：**唯一 API 客户端**，封装 `fetch`、请求去重（in-flight map）、`projectId`/`worktreePath` 作用域注入、全部 `fetch*` 函数与全部 DTO 类型。
  - `projectContext.tsx`：`ProjectScopeProvider`/`useProjectScope`（管辖项目 + worktree 全局选择，localStorage）。
  - `panelContext.tsx`：`PanelProvider`/`usePanel`（右阅读区状态 + 跨组件 CustomEvent `ldvh:ref-preview`/`ldvh:doc-preview`）。
  - 其余：`categoryColors`、`statusColors`、`cognitionSparkHealth`、`commitLabels`、`dateFormat`、`factChangeLog`、`factReadMeta`、`fieldFormats`、`listStatus`、`objectReference`、`objectSignals`、`sparkImplementationStatus`（re-export shared）、`panelContext`、`projectContext`。
- **`src/assets/`**：`ldvh-plugin-icon.png`、`react.svg`（遗留 Vite 默认资源，`react.svg` 可弃）。
- **`src/index.css`**：Tailwind + `github-markdown-css` 引入 + 大量 `ldvh-*` 组件类（`@layer components`），是设计语言基线的主要落点。
- **`src/main.tsx` / `App.tsx` / `vite-env.d.ts`**：见上。

---

## 2. 后端（`api/`）

### 2.1 框架与入口

- **框架**：Express ^4.21.2（经典，非 Fastify）。
- **入口三文件**：
  - `api/app.ts`：组装 Express 应用 + 挂载路由 + CORS + 健康检查 + 500/404 兜底。**注意**：`export const appReady = primeWebGovernanceScope()`（启动期即触发管辖范围验证，可 await）。
  - `api/index.ts`：**Vercel serverless 入口**（`@vercel/node` handler，文件头注明"don't modify"）。
  - `api/server.ts`：**本地开发入口**，`PORT = process.env.PORT || 3001`。
- **端口**：后端 3001（`server.ts`），前端 dev 5173（`vite.config.ts`）。`restart.sh` 硬编码这两端口并自动杀占用进程。
- **CORS**（`app.ts`）：`origin: ['http://localhost:5173','http://localhost:5174','http://localhost:3000']`，`credentials: true`。说明存在多端口前端开发场景。
- **代理**：`vite.config.ts` 将 `/api` 代理到 `process.env.VITE_API_TARGET || 'http://localhost:3001'`（`changeOrigin: true, secure: false`）。前端代码内 `API_BASE = '/api'`（同源相对路径），走代理而非跨域。
- **`/api` 前缀统一加 `Cache-Control: no-store`**。

### 2.2 API 端点清单（`api/routes/`）

| 路由文件 | 挂载前缀 | 端点 | 职责 |
|---|---|---|---|
| `auth.ts` | `/api/auth` | `POST /register` `POST /login` `POST /logout` | **全部 501 未实现**（脚手架 demo，v5 应废弃） |
| `objects.ts` | `/api/objects` | `GET /:type` | 按事实类型（workcase/adr/pitfall/spark/study）列对象，支持 `status`/`progress`/`priority` 过滤 + 派生 `statusOptions`/`progressOptions`/`priorityOptions` |
| | | `GET /:type/:id` | 对象详情（字段级直读，校验返回类型与 URL 类型一致，否则 404） |
| `cognition.ts` | `/api/cognition` | `GET /?window=1d\|3d\|7d&locale=` | 聚焦页聚合：inbox（待决定）、activeWorkCases、recentActivity、sparkHealth、recentHotspots + issues 降级 |
| `changelog.ts` | `/api/changelog` | `GET /?count=&locale=` | git log 列表（解析 Conventional Commit 类别/scope/签名/push 状态） |
| | | `GET /:hash` | commit 详情（stat + body + entry） |
| `docs.ts` | `/api/docs` | `GET /?path=` | 读项目内文档（**白名单 `specs/`、`web/docs/`**，防路径穿越，200KB 截断） |
| `project-files.ts` | `/api/project-files` | `GET /projects` | 管辖项目 + 各项目 worktree 概览 |
| | | `GET /entries?dir=` | 目录浏览（只读，排除 `.git`/`node_modules` 等，500 条上限） |
| | | `GET /content?path=` | 文件内容读取（只读，300KB 截断，隐藏文件默认不可见） |
| | | `GET /git/status` | 工作区 git 变更（staged/unstaged/untracked，全部只读） |
| | | `GET /git/diff?path=&status=` | 单个文件 diff（untracked 直接展示内容） |
| | | `GET /git/commits?count=` | git log（1–200 条） |
| | | `GET /git/commit/:hash` | commit 元信息 + 变更文件列表 |
| | | `GET /git/commit/:hash/diff?path=` | commit 内单文件 diff |
| `settings.ts` | `/api/settings` | `GET /governed-projects` | 读 `LDVH-GOVERNED-PROJECTS.yaml`（读 + 返回 fingerprint） |
| | | `GET /workspace-worktrees` | 扫描工作区所有 worktree（只读，候选） |
| | | `POST /governed-projects/verify` | 显式验证管辖配置 |
| | | `PUT /governed-projects` | **受控写入**管辖配置（需 `expectedFingerprint` 乐观锁，422 冲突） |
| `app.ts` | `/api/health` | `GET` | `{success:true,message:'ok'}` |

### 2.3 服务层（`api/services/`）

| 文件 | 职责 |
|---|---|
| `pytools.ts`（15 行） | **路径根**：`LDVH_ROOT`（`process.env.LDVH_ROOT || path.resolve(__dirname,'../../..')`）、`LDVH_WORKSPACE_ROOT`（env 或 `path.dirname(LDVH_ROOT)`）。所有路径的源头。 |
| `governanceScope.ts`（273 行） | **Web→Helper 唯一边界**。通过子进程调用 `LDVH_ROOT/ldvh`（或 `LDVH_HELPER_EXECUTABLE`）的 `call resolve-governance-scope`，校验配置指纹（sha256 of `LDVH-GOVERNED-PROJECTS.yaml`）与治理范围；导出 `resolveCurrentWebProject`/`resolveWebGovernedProjects`/`primeWebGovernanceScope`/`verifyWebGovernanceConfiguration`。 |
| `localFactReader.ts`（358 行） | **Web 自有字段级读取器**（刻意不调用 Core validator），直读 YAML/Markdown 事实载体，产出 `read_status`/`field_issues`/`unparsed_structures`。 |
| `facts.ts`（666 行） | 基于 `localFactReader` 的列表/详情组装，含跨工作区合并、WorkCase 投影。 |
| `factFieldContract.ts`（128 行） | Web 消费字段的传输投影（与 05.Att.01 机械对齐，供测试）。 |
| `crossWorktreeMerger.ts`（187 行） | 跨 git worktree 事实对象合并（sha256 指纹比对）。 |
| `git.ts`（383 行） | git 子进程封装：log/show/diff/push 可达性（本地 ref 检查，非网络探测）+ Conventional Commit 解析 + 签名归一。 |
| `projectFiles.ts`（135 行） | 文件浏览辅助：目录排除、类型检测、路径归一、项目解析。 |
| `governedProjectsSettings.ts`（132 行） | 读写 `LDVH-GOVERNED-PROJECTS.yaml`（含 fingerprint 乐观锁）。 |
| `requestScope.ts`（56 行） | 把请求 `projectId` query 参数匹配到已校验管辖项目（防任意路径注入）。 |
| `workspaceWorktrees.ts`（186 行） | 扫描工作区 worktree 的只读概览。 |
| `time.ts`（76 行） | 相对时间、RFC3339 解析。 |
| `typeColors.ts`（16 行） | 对象类型→颜色。 |

---

## 3. 共享代码（`shared/`）

7 个文件，纯 TS 类型/常量/投影函数，同时被 `api/`（`../../shared/...`）与 `src/`（`@/shared/...`）引用：

| 文件 | 职责 |
|---|---|
| `workcaseStatus.ts`（201 行） | WorkCase 进展分组/步骤/生命周期常量与类型；re-export `workcasePresentationContract.generated` |
| `workcasePresentationContract.generated.ts`（137 行） | **生成文件**（"Generated by code/tools/... Do not edit"），WorkCase 呈现契约常量 |
| `workcaseDetailProjection.ts`（105 行） | WorkCase 详情分区顺序/投影 |
| `sparkImplementationStatus.ts`（54 行） | Spark `implemented` 拆分 settled/unclosed 投影 |
| `signature.ts`（43 行） | commit 署名归一（DeepSeek Harness/Codex/Trae 等） |
| `timestamp.ts`（78 行） | RFC3339 / Git 时间戳解析 |
| `workcaseCapability.ts`（19 行） | 独立 subagent 复核可用性判断 |

> ⚠️ `workcasePresentationContract.generated.ts` 由 v4 的 `code/tools/generate_workcase_presentation_contract.py` 生成（v4 仓库根 `code/` 下）。v5 需保留该生成脚本或对应规范，否则该文件无法再生成/对齐。

---

## 4. 启动、构建、端口、代理、部署

### 4.1 `package.json` scripts

| Script | 命令 | 用途 |
|---|---|---|
| `dev` | `npm run server:dev & npm run client:dev --` | 同时起前后端 |
| `client:dev` | `vite` | 前端 dev（5173） |
| `server:dev` | `nodemon` | 后端 dev（nodemon.json 执行 `tsx api/server.ts`，watch `api/`，3001） |
| `build` | `tsc -b && vite build` | 生产构建（tsc 项目引用检查 + vite） |
| `preview` | `vite preview` | 预览构建产物 |
| `check` | `tsc -b --pretty false` | 类型检查 |
| `lint` | `eslint .` | ESLint |
| `test` | `npm run test:web:api` | `tsx --test tests/api/*.test.ts` |
| `test:web:api` | `tsx --test tests/api/*.test.ts` | 后端 API 测试 |

### 4.2 配置细节

- **前端 dev**：`vite.config.ts`。端口 `5173`（`strictPort: true`，host `127.0.0.1`）。`allowedHosts` 默认含 `2ch75157hd.vicp.fun`（内网穿透域名，可经 `VITE_ALLOWED_HOSTS` 覆盖）。别名：`@/shared`→`shared`、`@`→`src`。plugins：`@vitejs/plugin-react`（+`react-dev-locator` babel）、`traeBadgePlugin`（**Trae 品牌角标，prodOnly，v5 应废弃**）、`vite-tsconfig-paths`。
- **后端 dev**：`nodemon.json` → `tsx api/server.ts`，watch `api/`，env `NODE_ENV=development`，delay 1000ms。
- **生产构建**：`tsc -b && vite build` → `dist/`。
- **端口**：前端 5173 / 后端 3001，`restart.sh` 硬编码并自动清理占用。
- **代理**：Vite `/api` → `VITE_API_TARGET || http://localhost:3001`。
- **部署目标**：`vercel.json` 存在，rewrite `/api/(.*)`→`/api/index`（Vercel serverless 后端）、其余→`index.html`（SPA fallback）。配合 `api/index.ts`（`@vercel/node`）。**Vercel 部署是 v4 明确目标**，v5 迁入 DSH 插件壳后不再需要。
- **pnpm-workspace.yaml**：内容异常（`allowBuilds: esbuild: set this to true or false`——是占位/错误内容，非有效工作区声明）。

---

## 5. 测试（`tests/`）

全部 40 个文件在 `tests/api/*.test.ts`，用 **Node 原生 `node:test`**（`tsx --test` 跑），共约 6046 行。**无前端组件/E2E 测试**（有 `playwright` devDep 但无对应 test script；根目录有 `shoot-walkthrough.mjs`/`capture-frames.cjs` 等截图脚本但不在 npm scripts 内）。

代表性测试覆盖：
- **契约/边界**：`app-contract`（health/404/no-store）、`docs-route-boundary`（路径穿越）、`api-request-error`、`git-failure-transparency`、`git-sync-status`、`web-design-consistency-contract`（263 行）
- **对象/投影**：`workcase-card-lifecycle-contract`（1146 行）、`workcase-detail-current-contract`（757 行）、`cognition-inbox-contract`（871 行）、`commit-dto`（337 行）、`fact-source-metadata`（234 行）、`field-level-local-fact-reader`（260 行）、`settings`、`project-files`
- **各类型阅读契约**：`adr-card-contract`、`pitfall-card-contract`、`spark-reading-contract`、`study-reading-contract`、`workcase-presentation-spec-contract`、`truthful-reading-projection`、`navigation-layout-contract`

> 这些测试是 Web 呈现/投影的**机械守护**，v5 迁移后应整体保留并继续运行（它们直接 import `api/app.ts` 与 shared 模块）。

---

## 6. 资源（`public/`）

10 个文件，全部是 LDVH 插件图标：
`ldvh-plugin-icon.png` + `ldvh-plugin-icon-{16,32,48,64,128,180,192,256,512}.png`。`src/assets/ldvh-plugin-icon.png` 是同一图标（241KB）供 Sidebar 品牌区引用。`src/assets/react.svg` 是 Vite 默认遗留（可弃）。

---

## 7. 体积与依赖

### 7.1 文件数
- 前端源码 `src/`：74 文件（含子目录）
- 后端 `api/`：23 文件
- 共享 `shared/`：7 文件
- 测试 `tests/`：40 文件
- 资源 `public/`：10 文件
- 设计文档 `docs/`：8 文件

### 7.2 主要依赖清单（dependencies）

| 包 | 用途 | 迁移判断 |
|---|---|---|
| react / react-dom ^18.3.1 | UI 框架 | 保留（React 18） |
| react-router-dom ^7.3.0 | 路由 | **需适配**（v5 插件壳可能用 Slot 而非独立 BrowserRouter） |
| express ^4.21.2 | 后端框架 | 保留 |
| cors ^2.8.5 | CORS | 插件壳同源后可能可去 |
| dotenv ^17.2.1 | env | 看插件壳环境注入方式 |
| js-yaml ^4.1.1 | YAML 解析 | 保留（localFactReader/settings） |
| github-markdown-css ^5.9.0 | markdown 样式 | 保留 |
| lucide-react ^0.511.0 | 图标 | 保留 |
| react-markdown ^10.1.0 + remark-gfm ^4.0.1 | markdown 渲染 | 保留 |
| react-syntax-highlighter ^16.1.1 | 代码高亮 | 保留 |
| clsx ^2.1.1 + tailwind-merge ^3.0.2 | 类名合并 | 保留（`cn()`） |
| zustand ^5.0.3 | 状态管理 | **未实际使用，可弃**（状态走 React context：projectContext/panelContext/i18n） |

### 7.3 devDependencies 要点
`@vitejs/plugin-react`、`vite`、`vite-tsconfig-paths`、`tailwindcss`/`postcss`/`autoprefixer`、`typescript`、`eslint` 全家、`nodemon`、`tsx`、`playwright`、`@vercel/node`（**Vercel 专属，v5 可弃**）、`vite-plugin-trae-solo-badge`（**Trae 专属，v5 可弃**）、`concurrently`、`babel-plugin-react-dev-locator`、`globals`。

### 7.4 应废弃 / 不继承项（迁移红线）
1. **`api/index.ts`（Vercel handler）+ `vercel.json`**：Vercel serverless 专属，v5 插件壳内不适用 → 废弃。
2. **`auth.ts` 全部 501 桩**：demo 脚手架，未实现 → 废弃。
3. **`vite-plugin-trae-solo-badge`**：Trae 品牌角标，v5 与 DSH 品牌冲突 → 废弃。
4. **`react.svg`（src/assets）**：Vite 默认遗留 → 废弃。
5. **`pnpm-workspace.yaml`**：内容是无效占位（`allowBuilds: esbuild: set this to true or false`）→ 删除/修正。
6. **双锁文件**（`package-lock.json` + `pnpm-lock.yaml` 并存）→ v5 统一一种包管理器。
7. **`zustand` 依赖**：源码未使用 → 可去。

---

## 8. 迁移建议与风险

### 8.1 可直接复用（高价值，迁入即可）
- **`shared/` 全部 7 文件**：纯 TS 常量/类型/函数，无副作用，前后端共享，直接迁移（`workcasePresentationContract.generated.ts` 保留其生成脚本来源）。
- **`api/services/` 全部**：Express 无关的服务层（facts/localFactReader/git/projectFiles/settings/time/typeColors/crossWorktreeMerger/workspaceWorktrees），可整体复用。
- **`api/routes/` 除 `auth.ts` 与 `index.ts`**：业务路由全部保留。
- **`src/utils/api.ts`**：唯一 API 客户端 + 全部 DTO，是前端与后端契约核心，直接迁移。
- **`src/components/`、`src/pages/`、`src/i18n/`、`src/index.css`、`tailwind.config.js`**：UI 与设计语言基线整体复用。
- **`tests/api/*.test.ts`**：全部保留，作为投影/呈现机械守护。
- **`src/assets/ldvh-plugin-icon.png` + `public/` 图标**：品牌资源复用。

### 8.2 需适配（重点风险区）
1. **路由挂载**：当前 `BrowserRouter` + 独立路由表（`App.tsx`）。v5 作为 DSH Client Slot 时，需改为插件内路由（Slot 内嵌 Router 或用 DSH 的导航注入），`<Layout>` 三栏结构保留但外壳由 DSH 提供。**最高优先适配点**。
2. **`<Layout>`/`<Sidebar>`**：目前自带品牌区 + 导航 + 主题/语言切换。v5 插件壳可能已有 DSH 导航/主题，需决策是否保留独立 Sidebar 或融合进 DSH Shell。
3. **后端端口/进程**：当前 Express 独立进程 3001。v5 插件壳内，后端应迁为 **Host 侧 Service（ctx.provide/Service）**，前端经 Client→Host RPC 调用，不再走 HTTP `/api` 代理。`api/app.ts` 的 HTTP 封装、CORS、Vite proxy 均需重构为 Host service 方法。
4. **环境变量**：`LDVH_ROOT`/`LDVH_WORKSPACE_ROOT`/`LDVH_HELPER_EXECUTABLE`/`LDVH_WORKSPACE_ROOT`。v5 插件壳需在 Host 启动时注入正确的工作区根（当前 v5 工作区 `/Users/dmh2002/DshProject` 已有 `LDVH-GOVERNED-PROJECTS.yaml` 登记 `dsh-ldvh`）。
5. **Helper 依赖**：`governanceScope.ts` 调用 `LDVH_ROOT/ldvh call resolve-governance-scope`（子进程）。v5 插件分发需保证 `ldvh` helper 可达（或改为 Host 直接调用 Helper Service，避免子进程）。
6. **i18n/主题 localStorage**：`ldvh-locale`/`ldvh-theme-mode`/`ldvh-active-project-id` 等 key，v5 插件壳内 localStorage 命名空间可能冲突，需前缀隔离。
7. **React Router v7 + React 18**：版本较新但稳定；v5 若统一 React 版本需核对。

### 8.3 迁移关键事实（已确认）
- v5 工作区根 `/Users/dmh2002/DshProject` **已有** `LDVH-GOVERNED-PROJECTS.yaml`，`projects[0].path = /Users/dmh2002/DshProject/dsh-ldvh`（即 v5 仓库本身），`default_project_id: dsh-ldvh`。Web 后端将把 v5 仓库当作管辖项目读取事实源（`workcases/adrs/pitfalls/sparks/studies` 载体）→ **v5 自身的事实文件必须就位**，Web 才能读。

### 8.4 主要风险
- **后端服务化是最大改动**：`api/` 是 Express + 子进程（git、helper）模式，迁入 Cordis Host Service 需改写接口形态，但服务内部逻辑（facts/localFactReader/git）可保留。
- **生成文件来源**：`workcasePresentationContract.generated.ts` 依赖 v4 根 `code/tools/` 生成脚本，v5 需一并迁移生成链，否则该文件不可再生成。
- **跨工作区/跨项目作用域**：Web 依赖 `projectId`+`worktreePath` query 注入作用域，迁入插件后作用域传递方式需重新设计（当前经 `setCurrentProjectScope` 模块级变量）。

---

## 9. Questions（开放问题，未在 v4 web/ 内确认）

1. **后端进程形态**：v5 插件壳内，Express 服务是整体迁为 Host Service（推荐）还是保留独立 HTTP 进程仅由 DSH 壳内嵌 iframe？这决定 `api/app.ts`/CORS/proxy 的去留。需在 v5 确认插件架构后定。
2. **`LDVH_HELPER_EXECUTABLE`/`LDVH_ROOT` 在 v5 的取值**：v4 默认 `path.resolve(__dirname,'../../..')` 指向 v4 仓库根。v5 插件壳内 Host 需显式注入，值是什么（是否指向 v5 仓库根）？需在 v5 确认。
3. **`zustand` 是否彻底无引用**：依赖列表有但 `src/` 未 grep 到 import。v5 可直接去掉，但需在迁移时复核确认（未在 v4 全量 grep import）。
4. **Trae 角标与内网穿透域名**：`VITE_ALLOWED_HOSTS` 默认 `2ch75157hd.vicp.fun`、`traeBadgePlugin`——这些是 v4 开发者的本地穿透/品牌配置，v5 是否彻底移除？（倾向移除，但保留可选注入）
5. **React Router v7 的 Slot 内嵌策略**：DSH Client Slot 通常要求插件自管路由或使用 DSH 导航。v5 是否允许 `BrowserRouter` 存在于 Slot 内，还是必须改用 `HashRouter`/DSH 路由？需 v5 的 Slot 契约确认。
6. **`docs/` 8 份 Web 设计文档**：是否一并迁入 v5 `docs/` 作为 Web 设计基线？本报告未调查它们在 v5 中是否有对应文档。
7. **前端组件/E2E 测试缺失**：v4 只有后端 API 契约测试，无组件测试。v5 是否需要在迁移时补前端测试？（Playwright 已在 devDep，但未接线）
8. **`workcasePresentationContract.generated.ts` 生成脚本**：v4 根 `code/tools/generate_workcase_presentation_contract.py` 是否随 v5 迁移？其与 v5 `specs/21` 的同步职责归谁？
9. **`pnpm-workspace.yaml` 异常内容**：确认为无效占位，v5 是否还要沿用 pnpm 还是改 npm？双锁文件需统一。
10. **`dist/` 与 `.vite/` 目录**：构建产物与缓存是否不迁移（应由 v5 重新构建）？
