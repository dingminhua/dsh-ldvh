# 提交记录页

> 路由：`/changelog`、`/changelog/:hash`
> 源码：`web/src/pages/Changelog.tsx`、`web/src/pages/ChangelogDetail.tsx`
> API：`GET /api/changelog?count=50|100|200`、`GET /api/changelog/:hash`

## 1. 页面目标

提交记录页用于查看 Git commit records，并进入独立提交详情页审阅该提交的语义说明、文件统计和审计原文；右侧扩展阅读作为快速查看入口保留。它是提交证据入口，不是工作对象列表，也不是完整 diff 浏览器。

提交页是当前五个基准模块之一。它虽然读取 Git commit records 而不是工作对象 YAML，但卡片网格、标题带、复制入口、详情身份头部、正文节点和右侧扩展阅读都应与研究、决策、火花、经验保持同一设计语言。

## 2. 当前页面结构

```text
加载范围：最近 50 / 100 / 200
快速筛选：type + scope
顶部控制区：随页面滚动固定在顶部
提交卡片列表
  容器：与对象卡片一致使用 ldvh-section-grid，宽度足够时一行多个
  默认态：左上 type · scope + 右侧同步状态（需要行动时）/复制入口 + 标题块（GitHub 剪影图标 + description）+ 右下角更新时间
  点击卡片主体：进入 /changelog/:hash 独立详情页
  点击右侧阅读入口：打开或收起右侧扩展阅读
右侧扩展阅读
  提交身份区 + 提交与时间 + 文件/新增/删除汇总 + 提交说明 + 改动文件 + 原始信息
独立提交详情页
  返回 + 同一套提交身份区、指标区和正文节点
```

## 3. 提交卡片

- 每条提交一个浅边框卡片。
- 列表容器使用与研究等对象列表一致的 `ldvh-section-grid`，宽度足够时一行多个卡片，窄屏自动回到单列。
- 默认态：
  - 顶部左侧展示 `category` 和 `scope`，使用与研究卡片顶栏一致的 `ldvh-meta-muted` 弱元信息样式，并以文字中点分隔，不使用背景 chip；`category` 和 `scope` 按当前语言展示本地化标签，`scope` 为空时不展示；
  - 顶部右侧只对需要行动的同步状态展示图标，随后固定放置复制提交上下文：本地 `HEAD` 独有的提交使用玫红色云端上传图标，tooltip 为“未推送”；本地已知上游独有的提交使用紫色云端下载图标，tooltip 为“待同步”；两端共有、无上游或无法验证的提交不展示状态图标；不得改变卡片背景或在右上角放置扩展阅读入口；
  - 下方标题块参考研究等对象卡片：使用弱背景、内圈边框和左侧色条，右侧固定放置扩展阅读入口；色条按 commit type 取色；
  - 标题块内使用与侧栏提交入口一致的 GitHub 剪影作为提交记录识别图标；
  - 标题行展示完整 `description`，作为主阅读文本；无法解析时回退到完整 `message`；标题不截断，宽度不足时换行；
  - 时间不放入标题块；卡片底部右侧使用 `ldvh-meta-muted` 展示“提交 + formatDateTime(entry.date)”。若 Git commit footer 有非空 `Agent-ID`、`Host-Environment`，紧跟时间以中点追加两项值；不展示 Session-ID、Signer-Type；
  - 列表卡片不展示 `shortHash`；hash 信息只进入复制上下文和详情审计信息；
- 选中态：
  - 卡片边框和背景轻微高亮；
  - 右侧扩展阅读入口切换为向左收起态；
  - 列表内不展开 diff stat；
  - 右侧扩展阅读展示格式化提交详情。

## 4. 加载范围与筛选

- 页面默认从当前 `HEAD` 与本地已知上游跟踪引用的并集加载最近 50 条提交；未配置可读上游时只读取 `HEAD`。
- 用户可在最近 50、100、200 条之间切换；后端 `count` 上限为 200。
- 加载范围、`type` 和 `scope` 控件使用全局 tab 样式：`ldvh-tab-list`、`ldvh-tab-button`、`ldvh-tab-button-active` 和 `ldvh-tab-button-idle`；该样式也是对象状态筛选和工具页视图切换的统一外观。
- `type` 和 `scope` 快速筛选只作用于当前加载范围，不表示全仓库全量检索。
- `type` 筛选和标签按 `specs/03-事实源与信息溯源规范.md` §9.3 本地化展示；中文显示简体中文列，英文显示原始 type token。
- `scope` 筛选和标签按 `specs/03-事实源与信息溯源规范.md` §9.3 本地化展示；未知 scope 回退显示原始 token，但未知 token 的历史显示兼容不使其取得当前契约效力。
- 切换加载范围时重新拉取提交列表，并清除当前卡片选中态。
- 加载范围和快速筛选控制区应与对象列表页一致，滚动时固定在页面顶部。

## 5. 提交详情

- 提交卡片主体点击进入 `/changelog/:hash` 独立详情页；标题带右侧扩展阅读入口只承担快速预览，不替代详情页。
- 独立详情页和右侧扩展阅读必须复用同一套 `CommitDetailContent`，避免字段顺序、标题、折叠状态和正文样式分叉。
- 右侧扩展阅读顶部栏遵守全局规则，不展示当前内容标题，只保留导航、拖拽和关闭控制。
- 主视图上半部分复用对象详情标准文件头组件和层级，不使用紧凑标题变体：
  - 第一行左侧固定为对象类型“提交 / Commit”，其后使用与提交卡片第一行一致的弱元信息串：相对时间、分类和范围，以文字中点分隔，不使用背景 chip；
  - 提交描述；
  - 对象类型固定显示“提交 / Commit”，不得用 Conventional Commit `category` 替代对象类型；
  - Conventional Commit `category` 不作为对象类型展示；破坏性标记可作为同层短标签保留；
  - 绝对时间在标题区域下一行右对齐展示，供审计读取；
  - 推送状态可得时，短标签紧邻右侧复制操作；复制操作保留在标准文件头操作位，tooltip 表达为复制提交 hash，复制内容为完整 commit hash；卡片上的复制操作继续复制面向 AI 定位的提交上下文；
- 文件数、新增数、删除数汇总保留提交详情专用的三项指标卡设计；指标值和标签都居中显示；
- 主视图后续格式化呈现：
  - `提交说明` 节点；
  - `改动文件` 节点；
  - `原始信息` 节点。
- 有 commit body 时展示 `提交说明` 节点并默认展开；没有 body 时不显示该节点。
- `提交说明` 按 Git message body Markdown 渲染，适合展示结构化语义清单；行内可保留 Markdown 强调、代码和链接。Web 只识别 Git 提交规范已规定的固定小标题，例如“动机、关键变更、影响边界、验证结论、风险与后续”，将独立标题行提升为阅读区小标题，不根据自然语言猜测语义。
- 固定小标题下的正文应来自 07 强制的 `- ` Markdown 无序列表项，因此每条正文都会显示为同一种圆点列表表现；Web 不在显示层把非列表正文伪装成列表。
- 合法 footer 如随 Git message 一并返回，可以保留在原文中；提交签名 trailer 的 `Session-ID`、`Agent-ID`、`Host-Environment` 不混入“验证结论”等正文段落，而是在详情页单独呈现为“署名信息”三字段；每个字段保持“标签在上、值在轻量边框内容框内”的统一结构，长会话 ID 允许安全换行；`Signer-Type` 不在页面呈现。非空 `Agent-ID`、`Host-Environment` 仍可作为提交身份元信息复用在卡片和详情页的时间之后。Web 不把它解析成 LDVH 工作对象字段。
- `提交说明`、`改动文件` 和 `原始信息` 使用与对象正文一致的圆点标题、右侧折叠箭头和节点卡片样式；`改动文件` 和 `原始信息` 默认收起；原始 `git diff --stat` 或 `git show --stat` 文本只作为折叠审计信息保留，不作为主阅读界面。

## 6. 复制上下文

- 提交卡片的复制能力面向“快速与 AI 定位沟通”，不是只复制给人眼阅读的短哈希。
- 复制内容必须包含足够上下文，使 AI 能直接判断这是 LDVH Web 中的一条 Git commit record。
- 复制内容使用稳定多行文本，面向 AI 快速定位而非完整审计，至少包含：
  - 固定标题：`LDVH Commit`;
  - `hash`：完整 commit hash；
  - `type`：Conventional Commit 类型；
  - `scope`：提交范围，缺失时用 `-`；
  - `description`：提交描述，缺失时回退到完整 message；
  - `detail`：`/changelog/{hash}` 详情路由；
  - `body`：存在 commit body 时只保留短预览，当前实现上限为 180 字符，超过时追加 `[truncated; fetch full body/stat by hash]`。
- 复制内容中的 `type` 和 `scope` 必须保留 Git 原始 token，不使用本地化显示名。
- 复制内容不得为了“看起来完整”塞入完整 stat、完整 diff、完整 body 或文件列表；AI 需要更多上下文时应通过 hash 和详情路由重新获取。
- 复制操作不打开、不关闭右侧扩展阅读。

## 7. 提交信息

- commit message 按 Git 事实内容原样展示。
- API 应返回完整 commit body，并按 Conventional Commits 解析 `category`、`scope`、`description` 和 `isBreaking`，供列表、仪表盘、提交详情和后续派生视图使用。
- 页面不把 `Human-Gate:`、`Verification:`、`Risk:` 解析为 LDVH 固定字段；`Refs:`、`BREAKING CHANGE:`、`Co-authored-by:` 等行业兼容 footer 如存在，按 Git message 原文的一部分展示。
- 对象相关提交如需展示，应由后续专门的派生查询能力基于 Git 历史、文件路径、对象 ID 和自然文本实现，不在提交记录页内联解析。

## 8. 日期格式

- 卡片底部右侧的更新时间使用 `formatDateTime(entry.date)`，与对象列表卡片保持一致。
- `relativeTime` 只用于需要相对时间语义的详情元信息，不用于列表卡片更新时间。
- 不使用浏览器 locale 自动格式，不显示秒或毫秒。

## 9. 交互

| 操作 | 行为 |
|---|---|
| 点击最近 50 / 100 / 200 | 重新加载对应数量的最近提交，并清除当前选中态 |
| 点击 type / scope 筛选 | 在当前加载范围内按 type 或 scope 快速过滤 |
| 点击提交卡片主体 | 进入 `/changelog/:hash` 独立提交详情页 |
| 点击右侧复制图标 | 复制提交定位上下文，不打开或关闭详情 |
| 点击右侧详情图标 | 打开或收起右侧扩展阅读，并在列表中高亮当前卡片 |
| 切换语言 | 筛选、加载和错误文案同步切换 |

## 10. 实现约束

1. 页面不展示大标题或说明性副标题；提交页是证据流工具页，交互由筛选和卡片结构表达。
2. 不在卡片内展开 diff stat；提交详情进入独立详情页或右侧扩展阅读。
3. 不把提交记录页改成完整 diff 查看器；当前只展示 stat。
4. 不展示 raw ISO 时间；列表卡片更新时间和详情页绝对时间都使用 `formatDateTime()`。
5. 不把 commit message 强行翻译；它是 Git 事实内容。
6. 不把原始 `git show --stat` 文本作为详情主界面；主界面必须先格式化统计和文件列表，文件列表与原始信息都应位于默认收起的正文节点中。
7. 提交卡片操作区应与对象列表保持方向一致：右上角只放需要行动的同步状态图标与复制，标题带右侧放扩展阅读入口；提交没有对象状态，不展示对象状态徽标，也不按同步状态改变整张卡片背景。
8. 复制内容必须服务 AI 定位沟通，不得退化为只复制短哈希或完整 hash。
9. 提交记录页不是全量搜索页；所有快速筛选均以当前加载的最近 50 / 100 / 200 条为边界。
10. 加载范围、type 和 scope 控制区必须使用 sticky 顶部固定表现，保持与对象列表页筛选区一致。
11. 提交页可本地化展示 type 和 scope 标签，但复制上下文、API 字段和筛选状态必须保留原始 token。
12. `/changelog/:hash` 是提交详情的主路由；刷新、复制 URL 和从外部进入都必须能恢复详情内容。

## 11. API 数据结构

Changelog 与 ProjectFiles 的提交历史必须复用同一套 commit message 拆分、Conventional Commits 解析和可选署名 trailer 解析函数，统一输出 `message`、`body`、`category`、`scope`、`description`、`isBreaking` 与可选 `signature`。两者可以按页面职责追加字段；不得各自维护一套 commit header 解析规则。

Changelog 卡片和详情身份头还可展示 `pushStatus`：它只按当前分支的**本地已知上游跟踪引用**做 Git 可达性判断。当前 `HEAD` 与上游都包含该提交时为 `pushed`；仅 `HEAD` 包含时为 `unpushed`；仅上游包含时为 `incoming`；未配置上游、无法读取或提交不属于两端时为 `unknown`。列表通过 `HEAD` 与该上游引用的并集纳入本地独有和上游独有提交，再在 50 / 100 / 200 条边界内统一按 Git date-order 返回。该读取不发起 `fetch`、合并、变基或其它网络与工作树写入，也不宣称本地上游引用已经反映远端实时状态。

```typescript
interface ChangelogEntry {
  hash: string;
  shortHash: string;
  message: string;
  body: string;
  category: string;
  scope: string;
  description: string;
  isBreaking: boolean;
  pushStatus: 'pushed' | 'unpushed' | 'incoming' | 'unknown';
  signature?: { sessionId?: string; agentId?: string; hostEnvironment?: string };
  author: string;
  date: string;
  relativeTime: string;
}

interface ProjectGitCommitEntry extends Omit<ChangelogEntry, 'relativeTime'> {
  parents: string[];
  isMerge: boolean;
}

interface ProjectGitCommitDetail extends ProjectGitCommitEntry {
  files: { status: string; path: string; absolutePath: string }[];
}

interface ChangelogDetail {
  hash: string;
  stat: string;
  body: string;
  entry: ChangelogEntry;
}
```
