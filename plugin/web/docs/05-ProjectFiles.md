# ProjectFiles 项目文件

> 路由：`/project-files`
> 源码：`web/src/pages/ProjectFiles.tsx`
> API：`GET /api/project-files/projects`、`GET /api/project-files/entries`、`GET /api/project-files/content`、`GET /api/project-files/git/status`、`GET /api/project-files/git/diff`、`GET /api/project-files/git/commits`、`GET /api/project-files/git/commit/:hash`、`GET /api/project-files/git/commit/:hash/diff`
> 全局设计语言：[`01-全局设计约束.md`](./01-全局设计约束.md)
> 提交记录基线：[`06-Changelog.md`](./06-Changelog.md)

## 1. 页面目标

ProjectFiles 是管辖项目文件、Git 工作区和提交历史的只读工具页。它帮助 Human 查看项目文件、预览 Markdown / SVG / 文本内容、检查待提交文件、查看 diff 和追溯提交，不是工作对象列表、对象详情页、完整 IDE、文件管理器或通用 Git 客户端。

ProjectFiles 可以读取项目文件和 Git 信息，但不得新增、修改、移动、删除项目文件，不得提供 stage、commit、checkout、reset、rebase、merge、discard 或等价写入动作。任何未来写入能力都必须先回到当前有效来源及 [`08-Web 呈现与交互规范.md`](<../../specs/08-Web 呈现与交互规范.md>) 的默认只读、受控操作和 Human Gate 边界。

## 2. 当前页面结构

```text
项目选择
顶部 tab：文件浏览 / 待提交 / 提交历史
文件浏览：目录树 / 文件列表 / Markdown 或文本预览
待提交：git status 文件列表 / diff 预览
提交历史：commit 列表 / commit detail / commit diff
加载态 / 错误态 / 空态
```

最前面第一入口已确认可见名为“聚焦 / Focus”；其余前置入口 / tab 的最终信息架构未定，不影响 ProjectFiles 内部三个工具 tab 的只读边界。ProjectFiles 内部 tab 只表达本页面内的工具视图切换，不替代左侧主导航，也不定义其余全站入口。

## 3. 信息边界

1. 文件内容来自当前管辖项目的 Git 工作区文件系统读取。
2. Git 状态、diff 和提交历史来自 Git 命令或后端确定性解析。
3. ProjectFiles 展示的当前文件内容和 Git 溯源信息必须保持各自来源与身份，不由 Web 翻译或改写，也不被统一提升为稳定事实。
4. ProjectFiles 不把页面选中项、展开目录、当前 tab、搜索条件、diff 展开态或预览滚动位置写成事实源。
5. ProjectFiles 不创建新的工作对象类别，不把文件浏览状态解释为 WorkCase、Spark、ADR、Pitfall 或 Study 生命周期。

## 4. 设计语言

- 页面保持工具页信息密度，不强行套用工作对象卡片的情绪化视觉。
- 顶部项目选择和工具 tab 必须使用全局 tab / control 样式，滚动时保持稳定可见。
- 文件、diff 和 commit 区域使用浅边框、弱背景和紧凑列表；不使用营销式 hero 区。
- Markdown 预览使用全局 `MarkdownPreview` / `.ldvh-markdown-preview` 规则；ProjectFiles 文件预览可渲染 Markdown 中的 SVG 块，但不启用任意 HTML。
- 代码、diff、路径和 hash 使用等宽或弱元信息样式，允许横向滚动或软换行，不能破坏页面主布局。
- 错误态必须显示失败来源，例如项目不可用、路径越界、文件不可读、Git 命令失败或提交不存在。

## 5. 复制语义

ProjectFiles 的复制入口必须按内容命名：

| 场景 | Tooltip | 复制内容 |
|---|---|---|
| 项目根 | 复制项目路径 | 当前项目根路径 |
| 文件或目录 | 复制文件路径 | 项目内文件路径或后端返回的规范路径 |
| Markdown / 文本文档 | 复制文档路径 | 当前预览文档路径 |
| 待提交文件 | 复制文件路径 | git status 对应文件路径 |
| diff 文件 | 复制 diff 文件路径 | diff 对应文件路径 |
| 提交列表项 | 复制提交上下文 | 与 Changelog 一致的 AI 定位上下文 |
| 提交详情 | 复制提交 hash | 完整 commit hash |

复制入口只复制，不打开预览、不切换 tab、不触发外层行点击。

## 6. 与 Changelog 的关系

ProjectFiles 的提交历史必须复用 Changelog 的 commit message 拆分与 Conventional Commits 解析函数，统一输出 `message`、`body`、`category`、`scope`、`description` 和 `isBreaking`。ProjectFiles 可以追加 `parents`、`isMerge`、`files`、`absolutePath`、diff 等工具页字段，但不得维护第二套 commit header parser。

ProjectFiles 展开提交历史项时，commit body 应与 Changelog 的当前呈现保持一致：按 Markdown 渲染 `- ` 无序列表项，不使用 `pre` 原样展示而造成结构化列表表现不一致。

ProjectFiles 的提交历史是工具页上下文中的 Git 证据入口；`/changelog` 仍是全站提交记录主入口，`/changelog/:hash` 仍是提交详情主路由。

## 7. 与右侧扩展阅读的关系

1. 本地 Markdown 文件优先通过右侧扩展阅读或页面内预览展示，正文样式与全局 Markdown 阅读区一致。
2. ProjectFiles 内部的文件预览不等于对象详情页；如果路径指向工作对象事实源，仍应通过对象路由或对象引用能力查看对象语义详情。
3. 在 Compact 宽度下，文件或 Markdown 预览可以切换为底部阅读抽屉，但不得维护另一套 Markdown 样式或另一套对象摘要。

## 8. i18n

- UI 文案、tab、按钮、tooltip、空态、错误态和加载态必须进入 i18n。
- 文件路径、Git message、commit body、diff、Markdown 正文、命令输出、hash 和 raw status token 不翻译。
- 英文环境下工具 tab 和错误态文案必须允许换行或合理收缩，不能依赖中文短文案宽度。

## 9. API 数据结构边界

ProjectFiles API 可以返回项目、目录项、文件内容、Git status、Git diff、提交列表和提交详情。所有返回结构都必须保留来源路径、项目标识或 commit hash，方便 Human 和 AI 回指事实源。

高风险边界：

1. 路径参数必须限制在授权项目根内，不得读取项目外文件。
2. 二进制、大文件、不可读文件和越界路径必须返回明确错误态。
3. Git 命令失败不得被前端缓存为成功态。
4. diff 和 commit detail 只读展示，不产生工作对象事实或验证结论。

## 10. 测试要求

ProjectFiles 属于 Web 高风险 API 覆盖对象。修改 ProjectFiles 的 API、路径解析、Git 解析、diff 展示、commit DTO、Markdown 预览、复制语义或 i18n 时，应优先补充或运行 `web/tests/api/` 下的最小 contract 测试；页面层改动应覆盖空态、错误态、路径越界、只读边界和来源呈现。

无法补自动化测试时，必须说明等价验证方式和残留风险，不得宣称完整验证。

## 11. 不采用的方向

1. 不把 ProjectFiles 做成通用文件管理器。
2. 不提供删除、移动、重命名、保存、stage、commit 或 discard 操作。
3. 不把 ProjectFiles 的文件列表当作工作对象目录事实源。
4. 不维护第二套 commit parser。
5. 不把 Markdown 预览改成手写 Markdown 样式。
6. 不用 ProjectFiles 的内部 tab 替代全站主导航或其余待确认入口。
