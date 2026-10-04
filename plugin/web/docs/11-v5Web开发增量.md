# v5 Web 开发增量文档

> 基于 v4 Web 开发基线（`01-全局设计约束.md`、`09-图标语义规范.md`、`10-Web开发现状与设计语言基线.md`）建立。
> v4 基线原样平移后迁移至 `web/`，v5 增量与一致性审计记录在此。迁移纪律见 [`README-MIGRATION.md`](../README-MIGRATION.md)。
>
> 上位与直接依据：`specs/03-事实模型基础规范.md`、`specs/10-Web 呈现与交互规范.md`、`specs/07-管辖范围规范.md`、`specs/24-Research-调研报告.md`、`specs/09-Code 实践与测试规范.md`。

## 1. v5 迁移核心决策（Human 定案）

| 决策 | 定案内容 | 落点 |
|---|---|---|
| Study → Research 重命名 | `study` 类型名在 web/v5 全面替换为 `research`；类型色青绿 `#14b8a6`；v4 归档模式保留 study 仅作历史读取 | `api/services/facts.ts`、`src/components/ObjectStatusFilter.tsx`、`src/pages/CognitionCenter.tsx` |
| 联邦视图（Federation） | 单项目页为"联邦态"：灰显研究区 + 项目级统计 + 跨项目火花；独立联邦页聚合项目与对象 | `src/pages/Federation.tsx`、`src/pages/FederationObjects.tsx` |
| 项目色彩第三正交维度 | 每个项目带颜色；卡片标题左侧色点 + 联邦卡边框左 3px 色条 + 项目源 chip 色点 | `api/services/projectColors.ts`、`src/utils/projectColorVars.ts` |
| 设置页移除 | Settings 页面删除，登录/仓库/颜色由 DSH 插件设置卡管理（`better-sidebar`） | 已移除 `src/pages/Settings.tsx` |
| 署名扁平词汇 | 仅 `model` + `provider`，不含 `tool`；`lastAuthor` → 模型标签（模型/AI Agent 对称） | `src/utils/commitLabel.ts`、`src/i18n/locales.ts` |
| `updated_at` 移除 | 列表/头部更新日期改为 `change_log` 末条时间 | 详情页 `ObjectUpdatedMeta` |
| 详情标题字号定案 | 页面标题 18px（`text-lg`）、卡片标题 14px（`text-sm`）、阅读面板标题 18px（`text-lg`）；**完整字号系统以 `docs/01-全局设计约束.md §1.4 排版系统表` 为唯一权威**，本节不再重复维护 | `src/index.css`、`docs/01-全局设计约束.md` |
| 紧凑徽标语义类 | 新增 `ldvh-chip-sm`（10px / 12px，500）：18px 高的紧凑状态/优先级/类型 chip，组件不手写 `text-[10px]`；已同步写入 `docs/01 §1.4` 字号表 | `src/index.css`、`docs/01-全局设计约束.md` |
| 研究对象阅读布局 | 24 号薄索引：固定 H2 正文分节 + YAML 源节点（排序直显、不过滤）+ F1 卡投影 research_question/research_purpose/stopping_reason | `docs/04-ObjectDetail.md` |
| 活跃调研卡克制 | 活跃研究/调研卡不渲染研究问题/调研目的/停止原因块（在详情页阅读布局呈现）| `src/pages/ObjectList.tsx` |
| 近期动态行 | 不显示 research_question（动态摘要非 F1 卡）| `src/pages/CognitionCenter.tsx` |
| DSH 挂载模式 | `http://127.0.0.1:43120/ldvh` = v5 登记模式；`LDVH_GOVERNED_PROJECTS_CONFIG` 直读 `~/.dsh/ldvh/governed-projects.yaml`；独立开发用 `restart.sh` 指向 v4 归档 | `README-MIGRATION.md` |

## 2. 设计语言一致性审计（2026-09-10）

以下为本次审计发现的 v5 与 v4 设计语言不一致点及修复：

| # | 不一致点 | 修复 | 文件 |
|---|---|---|---|
| A1 | `ObjectStatusFilter` fallback map 仍含 `study` 键，`research` 列表无兜底 tab 且 `CognitionCenter` 近期热点 research 对象终态错归"推进中" | `study` → `research` | `ObjectStatusFilter.tsx`、`CognitionCenter.tsx` |
| A2 | 停止原因/退出原因 raw enum 直显（违反 01 §1.3 枚举值必须语义映射） | `retirement_reason` 加入 `FIELD_VALUE_LOCALES` 闭集映射，详情页改用 `getFieldValueLabel` | `locales.ts`、`ObjectDetail.tsx` |
| A3 | 联邦页面刷新/重试用手造按钮样式，违反"统一使用语义令牌" | 改用已存在的设计系统令牌 `ldvh-page-toolbar-action` | `Federation.tsx`、`FederationObjects.tsx` |
| A4 | 联邦对象列表用 `sm:/xl: /2xl:` 断点列数 + `items-stretch`，违反"卡片组用容器驱动网格（auto-fit + minmax）"且不与 `ObjectList` 同 grid | 改用 `ldvh-section-grid`（容器驱动） | `FederationObjects.tsx` |
| A5 | 联邦项目卡用 `md:/xl:` 断点列数（同型违规） | 改用 `ldvh-section-grid` | `Federation.tsx` |
| A6 | 联邦统计格数字指标用 `text-lg`（闭集仅允许 `text-xl / text-2xl`） | 改用 `text-xl` | `Federation.tsx` |
| A7 | 联邦空态/加载态用盒式空态（`rounded-xl p-8`），v4 列表空态语言为无框居中弱文本 | 改为 `ldvh-body-muted py-20 text-center` | `Federation.tsx`、`FederationObjects.tsx` |
| A8 | `ObjectList` 事实块标题含死 token 类 `text-ldvh-text`（未定义，颜色回退继承） | 移除 | `ObjectList.tsx` |
| A9 | `ObjectDetail` 标题字号计算 `compact ? 18 : 18` 冗余 | 简化为 `18` | `ObjectDetail.tsx` |
| A10 | 终端卡命名 `StudyTerminalCardContent` 沿用 v4 词汇 | 重命名为 `ResearchTerminalCardContent` | `ObjectList.tsx`、`nonactive-fact-card-contract.test.ts` |

## 3. v5 页面与路由矩阵（v4 基线 + v5 增量）

| 页面 | 路由 | v5 说明 |
|---|---|---|
| 认知中心 | `/` | 五个只读模块；近期动态不显示 research_question |
| 研究/调研列表 | `/objects/research` | F1 投影字段；活跃卡克制 |
| 研究/调研详情 | `/objects/research/:id` | 24 号薄索引阅读布局、YAML 源节点 |
| 决策/火花/经验列表 | `/objects/{adr,spark,workcase}` | 保留 v4 语言 |
| 联邦聚焦 | `/federation` | 跨项目聚合、项目统计、跨项目火花 |
| 联邦对象 | `/federation/objects/:type` | 跨项目对象列表、项目源 chip |
| 项目文件 | `/project-files` | 保留 v4 语言 |
| 变更日志 | `/changelog` | 保留 v4 语言 |

## 4. 已知边界与待定

- `ObjectReportKindFilter.tsx`：已标注【v5 已下线】空实现保留（无引用）；`report_kind` 字段仅 v4 归档对象携带时详情页徽章可见（v4 归档兼容）。
- `api/services/pytools.ts` `OBJECT_TYPES` 仍含 `study`：已改为 `research`；v4 归档模式独立开发时可能回退——若使用 v4 归档需同步。
- `docs/01` 与 `docs/10` 上位引用与术语仍残留 v4 痕迹（specs/05、08、21 路径与 study 词汇）——新文档 11 为 v5 权威基线，01/10 仅作 v4 迁移基线对照。
- WorkCase 规范 v5 尚未建立；WorkCase 卡片契约以 `specs/10` 与本文为准。
- ~~联邦视图的 `ProjectFilterChips` 仍使用手造 tab 变体（未改用 `ldvh-tab-list`）——本次审计保留，列入后续收敛。~~ **已收敛（2026-10-05）**：`FederationObjects` 的 `ProjectFilterChips` 改用 `ldvh-tab-list` / `ldvh-tab-button-*` / `ldvh-tab-count` 家族，项目色点保留在按钮内承载项目识别；同时清掉 `ProjectSwitcher`（4 处）与 `Federation`（1 处）手写 `rounded-full … px-1.5 py-0.5` 药丸，统一为新增的 `ldvh-pill` 语义 token。

## 5. 设计语言横切审计（2026-10-05）

全站横切验收（静态扫描 + Playwright 实拍浅/深 × 375/1440 + `getComputedStyle` 量测）确认的漂移与处置：

| # | 发现 | 契约依据 | 处置 |
|---|---|---|---|
| G1 | `WorkCaseCriteriaList` 详情档正文停在 12px 卡面扫描档 | `docs/01 §1.4` 约束 4 | 已修：`density` 分岔正文层级，detail → `ldvh-body`（14px） |
| G3 | 5 处手写药丸标签无令牌承载 | `docs/01 §1.3`/§1.4 | 已修：新增 `ldvh-pill` token，5 处收敛 |
| G4 | 聚焦页次级网格为全站唯一内联手写网格 | `docs/01 §1.5` | 已修：新增 `ldvh-subgrid` token（16rem/1rem） |
| G5 | 联邦项目筛选为手造 tab 变体 | `docs/01 §1.4` 约束 7 / `docs/11 §4` | 已修：归入 `ldvh-tab-*` 家族 |
| G7 | 对象列表排序控件用分段控件而非 tab | `docs/01 §1.4` 约束 7 | 已登记例外：排序是**有序枚举二选一**，非内容分区切换，保留 `ldvh-segmented-control`。同批为「数字指标」条补记近期热点标题例外（`docs/02` §139） |
| G8 | `border-l-*` 扩散为 4 族 3 种粗度、6 个文件 | `specs/10` §5.5（判据面板四边 1px）与 `docs/11 §1`（项目色条定案）的作用域口径 | **Human 裁决 2026-10-05（选「甲」）**：保留两族语义左条——领域归属决策块（`decisionBlocks.ts`）与项目识别色条（项目行/项目卡）；归正警示条与导航选中态共 4 处为四边同宽。规则落 `docs/01 §1.10` 第 7 条，新增守卫 `structure-single-source-contract` 防复发 |

**G8 的实测口径（供后人复算）**：归正前全站 `border-l-*` 共 **12 处**（决策块 6 段＝3 壳 × 粗度/色相两段、警示条 2、导航选中态 2、项目识别色条 2）。本轮归正后剩 **8 处**，全在两族允许域内；`border-l-4` 归零。守卫按「允许处数」白名单断言（`decisionBlocks.ts` 6、`ProjectSwitcher.tsx` 1、`Federation.tsx` 1），使同文件内再插入一条非语义左色条也会红。

| G9 | 聚焦页两处对象标题漏配标题带（近期动态行、Spark 健康度行） | `docs/01` §1.10「统一要求」第 4 条、§1.8.1 组件契约 | 已修：两处外层容器补 `ldvh-object-title-tray ldvh-object-title-tray-compact -mx-1 px-2.5`；新增守卫 `web-design-consistency-contract` 断言 `CognitionCenter` 内标题与标题带一一对应 |

**G9 的形态**：标题带**不由标题类自带**，而由调用方在外层容器另加一个类。因此「同一个 `ldvh-card-title`，A 处包带、B 处漏带」在源码与类型上**均合法**，编译与既有守卫都不拦——只能靠逐处人工比对或渲染实拍发现。实测语义：漏带的卡在整页里表现为「只有这两张卡的标题没有背景框」，正是 Human 2026-10-05 指出的一处。全站横向排查结果：有带的 4 处（`ObjectList` 列表卡、`ObjectDetail` 详情、`CommitHotspotGraph` 热点图、`Changelog` 提交卡），漏带的仅 `CognitionCenter` 2 处；其余 `ldvh-card-title` 使用点（`Sidebar` 导航项、`ProjectSwitcher` 选择项、`Help` 步骤标题、`Changes`/`ProjectFiles` 的文件名与分支名、`EvidenceBlock` 小标题、若干错误提示）**不属于对象卡片**，依契约不应带框。

**守卫的保证边界（勿夸大）**：跨文件的「哪些 `ldvh-card-title` 属于对象卡片」无法从字形判定，故守卫只在文件内做计数配对；且它是形态级——改以 inline style 表达标题带会因类名消失而被**误判为缺失**（假阳性式拦截），反之同一文件内把标题与标题带同时换名则逃逸。变异三连实测：漏配被精确捕获（2 : 1）、注释记载不误伤、换表达手段报红但属假阳性。

**复核中被撤回的两项**（初判为缺陷、复核后不成立，如实登记以免后人重复判定）：

1. **G2「同一卡头两种 chip 形态」不成立**。初次 `getComputedStyle` 探测量到若干 `span.rounded-full` 的 `fontSize: 12px`，据此怀疑 `WorkCaseClosedStatusBadge` 与 `StatusBadge` 行高不一致；改用 `.ldvh-chip-sm` 精确取样后，卡头全部徽标（类型/SG/活动数/合并状态徽标）实测均为 `height:18px` / `line-height:12px` / `font-size:10px`，**完全一致**。初次探测选中了空占位元素，是探测方法的缺陷，不是产品缺陷。
2. **G6「能力缺口徽标吃警告琥珀」不改**。`WorkCaseCapabilityStatusBadge` 的琥珀档确实偏离 `LDVH_WARN_CHIP_HUE_CLASS`，但 `src/utils/semanticColors.ts` 已把它登记为**域内自定档**（刻意弱于横切档），契约测试亦同款登记。改动它属配色偏好而非契约修复，故保留现状。

**已消解的历史冲突**：`docs/01 §1.4` 约束 8（数字指标只允许 `text-xl` / `text-2xl`）与 `docs/02` §139（近期热点主标题缩略 16px / 展开 18px、一跳工作 14px/20px）的字面冲突。二者都是现行规格，本轮**不改任一原文**，而是在约束 8 补记该页例外，使新页面不再据字面误判热点图违规。

**已裁决**：`border-l-2` 与「四边 1px」的作用域口径（原登记于 `docs/design-language-unification-demo.html` §4）。Human 2026-10-05 选「甲」——保留两族语义左条，其余归正；规则落 `docs/01 §1.10` 第 7 条。演示页五档待批清单中，③（发现 G）与 ④（pill token）已随本轮落地，⑤（`border-l-2` 口径）已裁决。

**登记未修（已知隐患，暂不处理）**：

1. **`EvidenceBlock` 的默认标签为中文硬编码**（`getEvidenceDefaultLabel` 返回 `'计划'`/`'结果'`/`'结论'`/`'记录'`）。这些标签经 `<td>{row.label}</td>` 直接上屏，英文环境下会漏中文，违反 `docs/01 §1.3`（UI 文案须走 `t()`）。**当前不可达**：`EVIDENCE_FIELDS = ['verification','evidence']` 匹配的是**顶层字段**，而当前事实源中 `evidence:` 均嵌套于列表项内，无对象带顶层 `verification`/`evidence` 字段——实测英文环境未检出这 4 个中文标签。待有对象的顶层字段命中该路径时须补 i18n key。
2. **`PanelContent` 的 `goal.md` 读取失败文案为中文硬编码**（`throw new Error(result.error ?? 'goal.md 读取失败')`）。同属兜底路径，仅在 `goal.md` 读取失败时上屏；`docs/01 §1.3` 要求加载失败态必须有中英文版本。
