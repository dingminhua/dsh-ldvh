# DSH 0.1.5-rc.2 → 0.1.6 版本差异调研报告

> 对比对象：`@deepseek-ai/dsh-root` `0.1.5-rc.2` → `0.1.6-alpha.2`
> 数据来源：GitHub 官方仓库 `deepseek-ai/deepseek-harness`，git 标签 `dsh-v0.1.5-rc.2`（HEAD：`fb2c4b9e69`）、`dsh-v0.1.6-alpha.2`（HEAD：`ddefc45fbc`，远程最新 0.1.6 标签）
> 调研日期：2026-09-18
> 变更规模：区间共 **1687 个 commit**；全仓 **5420 文件变更**，`+878,484 / -63,637`；`packages/` 内 3013 文件，`+125,532 / -46,237`

---

## TL;DR（先看结论）

`0.1.6-alpha.2` 是一个**方向性大版本**，不是小修小补。四个核心信号：

| 维度 | 结论 |
|---|---|
| **会话格式兼容** | ✅ **零破坏**。会话文件 `currentVersion` 仍为 **3**，v0→v1→v2→v3 迁移链逐字未变，旧会话 100% 向后兼容 |
| **全新能力（出厂默认关闭）** | ✅ 全新引入 `browser-use`（浏览器自动化）与 `computer-use`（电脑使用），均为「薄服务 + 可插拔 provider 包」架构，公开 opt-in，不在默认启用 |
| **插件体系重构** | ✅ 插件管理从「桌面端独立渲染进程」升级为统一 Cordis 包 + Optional Bundles 机制；Creator 模式的动态生成代码工具链被移除 |
| **Office/桌面原生增强** | ✅ Office 三件套技能 + 独立 Python 运行时随桌面版捆绑；Windows 安装器、macOS 毛玻璃、原生更新流、原生致命恢复 |

**一句话**：0.1.6 把 DSH 从「以会话为核心的单体工作台」推向「以 profile/插件为中枢、附赠浏览器与电脑使用两个预览能力的平台」，同时桌面端完成一波大幅原生体验升级，而**现有会话数据完全无损**。

---

## 1. 版本与范围澄清

- **对比基线**：当前用户环境为 `0.1.5-rc.2`（本地 `deepseek-harness` checkout 当前 HEAD 即此标签）。
- **0.1.6 最新标签**：远程仅有 `dsh-v0.1.6-alpha.1`、`dsh-v0.1.6-alpha.2` 两个 0.1.6 标签，无 RC。本次对比取 `dsh-v0.1.6-alpha.2` 作为 0.1.6 代表版本。
- **包级差异摘要**（`packages/`）：
  - **新增**：`browser-use`、`computer-use`（两个全新能力组）
  - **移除**：`code-runtime`、`e2b`（`refactor(e2b): retire remote execution providers`，远端执行 provider 退役）
  - **新增 client UI 包**：`ui-sidebar-browser`、`ui-sidebar-terminal`、`ui-plugin-manager`、`ui-settings-unarchive-sessions`
  - **新增多个 experimental 包**：`auto-review`、`browser-use-*`（playwright-mcp / chrome-devtools-mcp / stagehand-native / runtime）、`computer-use-*`（cua-driver-mcp / cua-driver-native）、`ptc-runtime-python`

---

## 2. 会话格式与持久化：**零破坏**（最重要的兼容性结论）

这是升级前最担心的点，经过四重独立验证确认安全：

1. **源码零实质改动**：`packages/session/session-format*/src/` 过滤注释后 diff 为空，仅一个术语改名（`encodeProvenance` → `encodeSourceEventRanges`，函数体逐字不变）。
2. **目录常量不变**：`session-format-catalog` 的 `currentVersion: 3`、`currentEncoder`、`migrations: [v0→v1, v1→v2, v2→v3]` 两版本完全一致。
3. **未触及表面**：`packages/session/session/src/` 零改动，JSONL 日志后缀与路径布局零改动。
4. **治理记录佐证**：新增的 `docs/persistence-changes/` 全部 **150 条 decision 均为 `same-version`**，无一 `version-bump`。

**唯一需要注意的（非格式）风险**：新增两个读取时必须的事件类型 `image/offload`、`workspace/changes`（log-only）。这意味着**新版本能读旧日志，但旧版本读含新事件的新日志会拒绝**——即「新读旧兼容、旧读新不兼容」，**不存在 header 版本升级**。对升级路径完全无碍。

**行为默认值变化（非格式）**：`session-log-deepseek` 的日志上传 `enabled` 默认值 `false → true`（会话日志默认上传开关翻转）。

---

## 3. 全新能力方向：browser-use 与 computer-use（出厂默认关闭）

### 3.1 Browser use（浏览器自动化）
- 全新包 `packages/browser-use/`（`dsh-browser-use`，`@deepseek-ai/dsh-browser-use`），在 0.1.5-rc.2 中**不存在**。
- 设计：只做**单一 provider 名额注册**（`ctx.browserUse`），第二次注册直接抛错；服务本身不含浏览器对象/共享操作/dispatch。真正的能力由 4 个实验性 rider 承载：
  | Rider | 说明 |
  |---|---|
  | `browser-use-playwright-mcp` | 经 `@playwright/mcp` 提供 per-Session Chromium 工具 |
  | `browser-use-chrome-devtools-mcp` | 经 chrome-devtools-mcp 提供 Chromium 工具 |
  | `browser-use-stagehand-native` | 原生 Stagehand（自带模型配置） |
  | `browser-use-runtime` | 共享资源生命周期 + attach 独占预留 helper |
- 关键语义：浏览器资源归属**确切的 Agent/Session**（跨轮保持状态）；`launch` 与 `attach` 二选一；attach 保留登录状态并独占；relaunch/fork 不继承已启动 profile。全部发布为**公开 experimental opt-in**。

### 3.2 Computer use（电脑使用）
- 全新包 `packages/computer-use/`（`dsh-computer-use`，`@deepseek-ai/dsh-computer-use`），0.1.5-rc.2 中**不存在**。
- 同样为单名额 provider 注册服务；上游实现名为 **Cua Driver**。2 个 rider：
  | Rider | 运行时 |
  |---|---|
  | `computer-use-cua-driver-mcp` | 连接已安装的 `cua-driver` MCP 可执行文件 |
  | `computer-use-cua-driver-native` | 内嵌 Cua Driver 原生 npm SDK（一体化安装） |
- 两个都不默认启用；macOS 光标 overlay 与专用桌面权限 UI 明确 deferred（后续版本）。

### 3.3 其他新增方向
- **`ptc-runtime-python`**（Python 单程序运行时）+ 新增 `native/`、`python/`、`pytest.ini` 根目录：桌面版首次附带 Python 运行时负荷。
- **`auto-review`**（自动复核，实验性）：plugin 侧新增。

> **澄清**：`llm-replay` **不是** 0.1.6 新引入——它在 `packages/test-support/llm-replay/` 于 0.1.5-rc.2 已存在，0.1.6 的真实差异是**首次纳入根 `package.json` devDependencies**（从测试辅助升级为发布依赖）。

---

## 4. 插件管理与生命周期：结构性重构

这是 0.1.6 最深的架构变化。

### 4.1 从「桌面专用管理器」到「统一 Cordis 管理器」
- 旧版：plugin manager 只是桌面渲染进程（`apps/desktop/renderer/plugin-manager.*`），**不存在** `packages/boot/plugin-manager`。
- 0.1.6：建成 Cordis 包对 **`packages/boot/plugin-manager`**（Host 侧，服务 `pluginPackages`）+ **`packages/client/ui-plugin-manager`**（Web 侧 Plugins 页），并**删除**桌面独立管理器（`feat: remove standalone plugin manager`，46 文件、**-1321 行**）。
- 效果：桌面端插件管理与 Web 完全一致；`Settings` 里 Plugin 列表变为只读，Agent-preset 行只读。

### 4.2 Optional Bundles 机制
- Launcher 在 `OPTIONAL_BUNDLES` 列出「出厂携带但默认关闭」的包：**选中前关闭、永不可移除**。
- Web 页以 **Official 组**置顶，实验性 feature 标 beta；无 bundle patch 的依赖不再被列出。
- 内置类能力（如 Agent Teams、Auto review）改以 optional bundle 形式发布。

### 4.3 安装与构建审批（build approval）
- 安装前 `inspect(spec)`：经 pnpm view / 读 package.json 回报名称/版本/描述/是否声明 bundle，或七类分类化失败（invalid-spec / already-installed / not-found / not-a-package / not-a-bundle / network / unknown）。
- pnpm 11 拦截依赖构建脚本时：失败安装经 `pendingBuilds` 报告待批包名，Web 页提供 "Allow these scripts and retry"，可批准被阻止的脚本。
- 安装失败/取消会**还原** `package.json` + `pnpm-lock.yaml`。

### 4.4 Creator 模式生命周期变更（重要）
- Creator 模式启用既有 `plugin_manager` 工具：Agent 在工作区写包与 Loader YAML patch，经 `install_bundle` 安装（持久化 bundle 安装）。
- **移除**模型可见的「生成代码动态插件」mutate 工作流（define/run/stop/undefine 与动态自省工具 API **不存在**），只留两个只读 Cordis inspection 工具。即：**模型发起的改码动态插件这条生命周期被取消**，统一走 profile 事务（profile 锁、包安装、启用、HMR）。

### 4.5 其他
- 新增 `packages/boot/hmr`（HMR 服务）+ `watch-config.ts`：精确路径监听 profile patch，串行化模块与 config 重载。
- 新增 `sanitizeProfile()`：profile patch 损坏时自动备份恢复。
- 客户端插件热更新**免刷新**生效（`feat(web): apply client plugin changes without reloading`）。

---

## 5. 桌面端（Desktop）重大升级

- **Windows 原生标题栏 + 本地化菜单**：隐藏标题栏 + 40-DIP 原生 caption，Application/Edit 弹出菜单语言跟随应用；省掉独立菜单行。
- **macOS 毛玻璃（vibrancy）**：`hiddenInset` 标题栏 + `vibrancy: 'sidebar'`、`data-platform='darwin'` 透明链；折叠侧栏完全隐藏（宽度 0，非 56px rail）。
- **原生 About 菜单**：`About DeepSeek Harness` 打开原生面板（图标 + 产品名 + 已装版本）。
- **原生致命恢复对话框**：取代静态失败页，覆盖主窗口/文档/preload/renderer/Web 初始化/后端失败；提供 Exit / Restart / Disable third-party plugins + 备份 profile patch；`EADDRINUSE` 特判；可选日志上传默认开启。
- **更新流（ordinary + mandatory）**：普通「检查更新」对话框 + 阻塞式强制更新窗口（独立沙箱 preload）；后台就绪时 Windows taskbar attention / macOS Dock bounce + 静默通知。
- **Windows 安装器重做**：NSIS 原生安装页（明暗双色、系统阴影、可装卸载目录）、仅当前用户、目录替换升级并保留旧目录至晋升成功。
- **运行时从 asar 运行**：Electron 运行时宿主改为从 ASAR 内运行，Web UI 在后端就绪前即可加载，启动更快。
- **桌面壳瘦身**：Desktop 改为共享 Web 应用的薄 Electron 壳，插件管理/认证/HTTP/RPC 走统一 profile runner。

---

## 6. Web 端：侧栏成为多功能工作台

### 新增侧栏能力（全新包）
- **`ui-sidebar-browser`**（侧栏浏览器）：右侧栏打开网页，平行于文件预览；地址只接受 https 与 loopback http，拒绝 file:/公网 http/带凭据 URL；iframe sandbox 带 allow-scripts/forms/same-origin/popups。
- **`ui-sidebar-terminal`**（交互式终端）：xterm.js + FitAddon，每 tab 独立进程；颜色跟随应用主题；shell 选择器记忆路径；2 小时无人值守回收；终端以 system-user 权限运行（脱离 Agent 沙箱）。
- **open subagent chats in sidebar**：subagent 对话可在侧栏以内嵌会话形式打开。

### Web UI / 交互
- **Persistent plan cards**：`exit_plan_mode` 提交在已完成 Turn 放一张卡，可回看、写 review（Request changes / Approve），全文自动在侧栏打开。
- **模型图像输入设置**：DeepSeek/pi-ai 共用模型行，Text/Image 复选框，至少保留一个类型；继承的视觉能力在编辑前可见。
- **Composer 键盘模型**：共享菜单族统一 Tab/Enter/Escape/方向键模型。
- **Turn 变更文件卡 + diff 审阅 tab**：每轮显示改了哪些文件，统一/并排 diff 视图。—— 对应你环境里已能看到的「文件交付/变更卡」能力。
- **归档会话恢复页**（`ui-settings-unarchive-sessions`）：Settings 新增 archived-sessions 段，归档会话首次有可见恢复入口。
- **插件页配置**：插件配置集中在 Plugins 页（`ui-plugin-manager`），表单保留到保存、离开即丢弃。
- **Context meter 移入 composer stats**；**已知站点链接图标**（GitHub/GitLab/npm/PyPI 等 40 域名映射 34 个图标）；**Markdown 文件链接**可直接点开侧栏预览并跳行。
- 代码块预览性能优化曾合入后**被回滚**（未进入本版本）。

### 文档站点（website/）
- **页面 Markdown copy/view 动作**：每页可一键复制 Markdown 或查看原文。
- **平台命令分栏**：Python SDK 指南的多平台命令用原生 code-group tabs 分栏。
- **全屏 Mermaid 查看器**：复杂图表可全屏缩放/平移。

---

## 7. Profile 解析重写（架构级）

- 新增 `packages/boot/app-boot/src/profile-resolution/`，核心是**不可变 ResolutionGeneration** 与三模式：
  | 模式 | 行为 |
  |---|---|
  | `link` | 落盘符号链接 |
  | `runtime` | 直接向 Node ESM/CJS 加载器注入路由，不落盘 fallback 链接（**默认**） |
  | `dual` | 内部比对路径 |
- pkg/Electron 构建**强制 runtime**（因依赖树可能在虚拟文件系统）；换代为纯增量发布 + 单引用替换。
- **CLI**：`dsh web` 硬编码别名推广为通用 `dsh <name>` 简写（=`dsh --profile <name>`），help 文案全量改写。
- 会话日志上传默认开启、subagent 委派上限机制化（每 root 连续续接激活受限，`maxActiveSubagents` 默认值数位——见 §8 说明）。

---

## 8. Subagent 与协作

- **subagent 委派上限**：新增 `ActivationPool`，每 root 共享 live continuable slot；`Config` 新增 `maxActiveSubagents`（默认数位在不同提交间由 16 调整到 8）与 `maxDepth`（默认 1）。注：具体生效默认值以 0.1.6-alpha.2 实际发布配置为准（原始 feat commit 标题为 "cap live continuable activations per root at 16"）。
- **git 审批协作**（通用仓库流程，非你环境直接相关但反映方向）：
  - **weighted approval delegation**：PR 评论 `/delegate @username` 转授审批权重（一次性、不可再转授）。
  - **author approval credit from merged PRs**：合并 PR 记账作者信用（约 0.011 分/个，封顶）。
  - **weighted 上游**：按 merge base blame 旧生产行归属加权。

---

## 9. 对升级 0.1.5-rc.2 → 0.1.6-alpha.2 的针对性评估

| 关注点 | 结论 | 风险等级 |
|---|---|---|
| 会话历史丢失 | 绝对安全（格式版本不变） | 🟢 无 |
| 旧日志不可读 | 安全（新读旧兼容） | 🟢 无 |
| 插件失效 | 架构重构——旧自定义插件需走新 optional bundle / plugin-manager 机制；模型动态改码插件工作流被移除 | 🟠 需关注 |
| 配置文件/profile 损坏 | 新增 sanitize 自动备份恢复 | 🟢 改善 |
| 隐私 | session-log 上传默认开启（行为翻转） | 🟡 留意 |
| 桌面端 | 全面重构 + 新安装器，建议在测试机验证更新/恢复流 | 🟠 需验证 |
| 新能力 | browser-use / computer-use 均为彩蛋能力，默认关闭，不影响现有功能 | 🟢 无 |

---

## 10. 方法与数据源

- 对比使用 git 双标签 diff：`dsh-v0.1.5-rc.2..dsh-v0.1.6-alpha.2`（临时克隆仓库）。
- 结论基于 git 历史（`log`/`diff`/`show`/`ls-tree`）与 `.agents/notes/implemented/**` 架构决策记录。
- 面向用户可见行为的断言均逐一映射到具体 commit；子代理分四线并行交叉验证（web/desktop、会话/CLI、新能力/插件、架构）。
- 未做运行时行为验证（本次为静态差异调研）；涉及「默认值」的个别参数（如 subagent 上限、日志上传默认）建议以实际发布包配置复核。

---

*本报告为交付调研文档。如需在 LDVH 中对象化为 Research 事实对象（供后续跨会话引用与溯源），可另行创建。*