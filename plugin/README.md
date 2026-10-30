# dsh-ldvh

[English](README.en.md) | 简体中文

> 当前状态：`1.0.0-dev.1` 开发预览。管辖项目管理、Git Gate、LDVH Web 与 `ldvh_*` 工具面均已落地；真实 UI 验收尚未全项完成，**尚未在真实 Windows 主机验证**，故仍不建议普通用户安装或提交市场。

LD Vibe Harness（LDVH）的 DeepSeek Harness 原生插件。目标是在 DSH 内提供：

- LDVH 会话视图；
- 管辖项目和默认管辖配置管理；
- Git Gate 状态、安装、升级和卸载；
- LDVH Web 信息呈现；
- AI 工作引导与确定性 LDVH CLI 入口。

## 当前已实现

- Host 侧 `/ldvh` 与 `/ldvh/api` 路由，含 Web 路由启用/停用与插件卸载清理；
- 管辖项目生命周期：登记载体、安装/检查/卸载 Hook/取消管辖事务；
- Git Gate：受管 `commit-msg` Hook 与受控提交 message 契约校验；
- 插件设置卡片：管辖项目管理与 Web 呈现偏好；
- LDVH Web SPA（v4 迁移第 1 步已落地，含管辖联邦视图与项目色标识）与 LDVH 会话视图；
- `ldvh_*` 工具面与规则引导注入；
- Host 路由生命周期测试。

## 尚未实现

- 真实 UI 验收六项中四项尚未核对（设置卡片、会话视图、停用与重启、卸载清理）；
- 正式市场截图和发布版本；
- Windows 真机验收（见下「平台支持」）。

## 开发安装

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-ldvh/plugin
```

安装或修改 Host/Client/bundle patch 后需要重启 DSH Desktop。当前开发目标环境（本机观察值，2026-10-30）：

- DSH Desktop `0.2.1-rc.5`（`/Applications/DeepSeek Harness.app`）
- `@deepseek-ai/dsh` `0.2.1-rc.5`
- Node.js `>=22.15.0`（代码下限；DSH 宿主 `dsh-plugin-desktop` 自身要求 `^22.19.0 || >=24.0.0`）

> **宿主兼容（自 `1.0.0-dev.1` 起；该断言随本版首次登记）**：本插件只支持 `@deepseek-ai/dsh >= 0.1.7-rc.1 < 0.3.0`（peerDependencies 已收窄）。0.1.7 线（rc.1 与 rc.2）对设置模型（SettingsProvider → 插件 Config + volatile）、客户端设置面（settingsScope / settings.plugin.item 删除 → configForms / plugins.*）、事件（agent/session-start 删除）与工具输出契约的破坏性变更均已适配；0.1.7-rc.2 相对 rc.1 为契约只增不改（服务/事件/槽位零删除），无需额外适配；0.2.0-rc.1 相对 rc.2 亦无契约破坏（服务 89→91 零删除、事件 81→81 零变化、客户端槽位条目 89→89 零增删、模型可见工具零变化，本插件消费的主机侧 11 个宿主服务与八个事件 mode/签名逐字未变）；0.2.0-rc.2 相对 rc.1 同样只增不改（服务 91→91 零增删、事件 81→81 零变化、工具名 65→65 零增删、包集合 325→325 零增删，唯一被改动的服务 `userQuestions` 其既有 `ask` 方法签名逐字未变、新增三方法为并列增量）；0.2.1 线（rc.1–rc.3）相对 0.2.0-rc.2 亦无对本插件的破坏面——本插件消费的服务与事件除下述 `ctx.invariants` 外只增不改（2026-10-19 项目内实测：区间 0.2.0-rc.2→0.2.1-rc.2 消费面 12 服务 / 9 事件逐条比对，唯一被删服务为 `invariants`），本次另行实测 0.2.1-rc.2→0.2.1-rc.3 为**服务端零契约变更**（被消费的宿主服务包在该区间仅 `package.json` 版本行变化）、**客户端槽位纯新增**（槽位键 74→77，新增 `conversation.session.header.views.actions`、`sidebar.panellist.actions`、`sidebar.right.tab.guide.actions`，零删除），本插件使用的四个槽位与所消费服务签名逐字未变，故**无需代码层适配**。**`0.2.1-rc.3`→`0.2.1-rc.5`（2026-10-30 实测，13 commits / 388 文件）同样无需代码层适配**：其中 349 个文件是 `package.json` 的版本行，全区间 39 个非清单变更里（`packages/` 内 34 个）**服务端 src 代码变更仅两处、且都在本插件不消费的面上**（`llm-deepseek-account` 把账户目录加载的日志从 `console.info` 改到 `console.error`——ACP 保留 stdout；`mcp-client` 改为先判服务器是否声明 `resources` 能力再列举，避免 SDK 往 stdout 写 `console.debug`）；服务端侧另有三个包的 README（中/英/i18n 共 9 个文件）与两处测试文件变更，均属文档与测试；本插件消费的宿主服务所在包——`core/tools`、`interaction/user-questions`、`core/system-prompt`、`session/session-persistence`、`fs/fs`、`core/agent`、`interaction/commands`、`util/home-paths`、`util/atomic-write`、`host/webserver`，以及另外四个同样被消费的 `goal/goal`、`schedule/schedule`、`api/session-controller`、`api/workspace-controller`——在该区间的差异**全部仅为 `package.json` 版本行**（逐包核对，每个包只命中自身清单一个文件）；客户端槽位**键** 103→103 逐条全等（无增删、无改名）；条目内容有 9 条变化——8 条只改 `source:` 文档行号引用，1 条是 `conversation.chat.reasoning.body` 的 summary/doc/ownerProps（即下述 rawText）。本插件使用的四个槽位的 registration 与 owner props 逐字未变（经 Cordis Inspect 在运行中的 rc.5 宿主上实测：`conversation.view` 的 `ldvh`、`conversation.chat.node` 的 `ldvh-notice`、`plugins.bundle.config` 与 `plugins.row.config` 的 `dsh-ldvh` 键 occupant 均在且 active）；提问卡 CSS module 的局部名集合（`eyebrow` / `options` / `detail` / `optionLabel` / `pager` 等）与契约属性 `data-question-key` 在 rc.3 与 rc.5 之间**逐字未变**，故 GATE_CSS 覆写选择器的静态命中面不变。另需知悉：本插件在 `dsh.client.inject` 中显式声明的 `@deepseek-ai/dsh-client-ui-conversation` 在该区间有 2 处 src 变更（删除一个 `session.moreViewsCurrent` 文案键、会话视图标签改为仅在溢出时才给 tooltip），二者都不是契约变更，不触及本插件消费的 `uiConversation.events.register` 与 `conversation.chat.node`。**唯一的客户端契约变化是 `conversation.chat.reasoning.body` 新增了 `rawText`**（`text` 语义改为「Chat 处理后的显示文本」）：该变化只影响注册了此槽位的推理渲染器与翻译包装，本插件**未注册该槽位**，故不受影响——它属上游对第三方扩展的迁移提示，本插件无迁移义务。唯一的契约移除是宿主服务 `ctx.invariants`（运行时不变量注册器在上游提交 `f028f25667` 整体退役，自 `0.2.1-alpha.1` 起不再提供）：本插件对该缝的安装期断言在 0.2.1 线宿主上不再部署，插件按 `specs/10` §6 如实报告该缝为未消费，**不主张**其防护已生效，替代方向留待 Spark 裁夺。**上界取 `< 0.3.0` 的依据是覆盖 `0.2.x` 稳定版**：在宿主判定语义（`includePrerelease: true`）下 `< 0.2.0` 与 `< 0.3.0` 对各自的预发布版结果相同，二者的真实差异只在**非预发布**的 `0.2.0`（前者拒收、后者接纳），故上界推进防范的是上游发布正式版时 bundle 被兼容门禁拒收；0.1.6 及更早宿主不兼容，详见 [CHANGELOG.md](CHANGELOG.md)。

本节登记的是开发目标基线，不等于已验证支持：`specs/08` §8 要求的真实 UI 验收六项中，`/ldvh` 与 `/ldvh/api/health` 已实证，设置卡片、会话视图、停用与重启、卸载清理尚未核对。

## 平台支持

本插件面向 DSH Desktop，**声明的支持平台为 macOS 与 Windows**。Linux 按同一宿主契约运行（CI 在 Ubuntu 上执行全套测试），但无真机桌面验收，不在支持声明内。

`specs/08` §8 要求不得以「已实现」代替「已验收」，故两个状态分开登记：

| 平台 | 实现 | 真机验收 |
|---|---|---|
| macOS | 完整 | 已实测：管辖项目生命周期 10 项、`/ldvh`、`/ldvh/api/health` |
| Windows | 已实现（见下） | **未在真实 Windows 主机验证（`unverified`）** |
| Linux | 同一契约下运行 | 仅 CI 覆盖，未验收 |

macOS 已实测的 10 项（逐条见仓库内 `docs/governed-project-lifecycle-verification.md`）：候选路径须为实际 Git 根、首次安装建 `ldvh-base/` 五类目录、首次安装写登记并设默认项目、Hook 装入 Git common-dir、Hook marker digest 可回读为 `managed`、真实提交中非法 message 被阻断、合规 message 被放行、卸载 Hook 后登记与 `ldvh-base/` 保留、重装可修复缺失 Hook 且不重复登记、取消管辖移除登记并自动卸载 Hook。

平台差异集中在三处核心机制，另含一处交互适配：

- **路径语义**：盘符绝对路径（`C:/…`）与 UNC 路径（`//server/share/…`）由 Node/Git realpath 与 Git 根解析承接；包含判定按宿主平台的分隔符与盘符语义进行，不以硬编码 `/` 假设 POSIX；
- **Git Hook 载体**：Hook 脚本以 `#!/bin/sh` 渲染；`win32` 下预检经 Git for Windows 自带的 `sh`（`bin/sh.exe` → `usr/bin/sh.exe` → PATH）调用，避免直接执行无扩展名脚本；脚本内按 `${1}` 形态识别盘符与 UNC 消息文件路径；可执行位由 Git for Windows 的 shebang 承接（NTFS 上 `chmod` 为惰性）；
- **文件权限**：管辖登记载体的写入经 DSH atomic-write（同目录临时文件 + 原子 replace）落盘；事实源对象写入由各 writer 自带的同目录临时文件 + 回读校验 + rename 承接。Windows 继承 DSH 用户配置目录 ACL，不伪造 POSIX mode；
- **目录选择**：Desktop 页面标记 `dsh-desktop-platform=win32` 下走主进程原生弹窗，失败回退宿主 remote 选择器与手动输入。DSH Terminal 的 PowerShell/cmd 启动由 Desktop 宿主实现，LDVH 不自行选择或提权。

Windows 上如实登记的当前限制：

- `ldvh_register_governed_project`（AI 登记入口）在 Windows 返回 `registration_permission_unverified`：本实现尚无 ACL 核验器，而 `specs/07` §5.6 要求 ACL 无法核验时高风险写入 fail-closed。设置页「安装」（Human 明确操作）不受影响。
- **登记载体所在的 DSH 用户配置根**不得置于网络文件系统或跨 PID namespace 的共享卷（含 UNC 共享）：登记载体的锁接管以 PID 判定持有者，官方不支持跨宿主共享同一文件。事实源 `ldvh-base/` 不经该锁包（各 fact writer 自带无锁原子替换），故该约束的对象是配置根而非项目目录。详见 [CHANGELOG.md](CHANGELOG.md) 的 Known 段。
- CI 的两个 job 均运行在 Ubuntu，**win32 分支不经 CI 执行**；全套测试中共 5 处断言在 win32 上早退（`plugin/test/` 4 处依赖 POSIX 权限语义，`plugin/web/tests/` 1 处依赖可执行位），即 win32 路径与这些断言在 Windows 上均未被执行。故 win32 路径目前只有代码层实现，没有自动化验证背书。
- 未验证风险：Git Bash/MSYS `sh` 在目标 Windows 环境的可发现性；NTFS 文件占用导致原子替换失败时的错误呈现；UNC 与 junction 的真实行为。

「支持 Windows」声明的是纳入的平台范围；真机验收完成前，不得据此认为 Windows 已验收通过。

## 验证

```bash
npm --prefix plugin test
npm --prefix plugin pack --dry-run
```

单元测试只证明已覆盖的机械范围，不证明完整产品能力、当前 DSH 兼容或市场发布条件成立。

## 设计边界

- v4 已验证机械核心优先迁入和适配，不从零重写；
- DSH 提供宿主承载，不取得 LDVH 规范、事实或业务语义权威；
- 管辖登记和 Git Gate 变更必须经明确 Human 操作；
- 不覆盖或自动链入未知第三方 `commit-msg` Hook；
- 不从测试、页面或安装成功推导整体完成。

## License

MIT © LaoDing
