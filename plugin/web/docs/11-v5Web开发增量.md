# v5 Web 开发增量文档

> 基于 v4 Web 开发基线（`01-全局设计约束.md`、`09-图标语义规范.md`、`10-Web开发现状与设计语言基线.md`）建立。
> v4 基线原样平移后迁移至 `web/`，v5 增量与一致性审计记录在此。迁移纪律见 [`README-MIGRATION.md`](../README-MIGRATION.md)。
>
> 上位与直接依据：`specs/02-事实源与事实模型基础规范.md`、`specs/07-Web 呈现与交互规范.md`、`specs/08-管辖范围规范.md`、`specs/24-Research-调研报告.md`、`specs/06-Code 实践与测试规范.md`。

## 1. v5 迁移核心决策（Human 定案）

| 决策 | 定案内容 | 落点 |
|---|---|---|
| Study → Research 重命名 | `study` 类型名在 web/v5 全面替换为 `research`；类型色青绿 `#14b8a6`；v4 归档模式保留 study 仅作历史读取 | `api/services/facts.ts`、`src/components/ObjectStatusFilter.tsx`、`src/pages/CognitionCenter.tsx` |
| 联邦视图（Federation） | 单项目页为"联邦态"：灰显研究区 + 项目级统计 + 跨项目火花；独立联邦页聚合项目与对象 | `src/pages/Federation.tsx`、`src/pages/FederationObjects.tsx` |
| 项目色彩第三正交维度 | 每个项目带颜色；卡片标题左侧色点 + 联邦卡边框左 3px 色条 + 项目源 chip 色点 | `api/services/projectColors.ts`、`src/utils/projectColorVars.ts` |
| 设置页移除 | Settings 页面删除，登录/仓库/颜色由 DSH 插件设置卡管理（`better-sidebar`） | 已移除 `src/pages/Settings.tsx` |
| 署名扁平词汇 | 仅 `model` + `provider`，不含 `tool`；`lastAuthor` → 模型标签（模型/AI Agent 对称） | `src/utils/commitLabel.ts`、`src/i18n/locales.ts` |
| `updated_at` 移除 | 列表/头部更新日期改为 `change_log` 末条时间 | 详情页 `ObjectUpdatedMeta` |
| 详情标题字号定案 | 页面标题 18px（`text-lg`）、卡片标题 14px（`text-sm`）、阅读面板标题 18px（`text-lg`）；**完整字号系统以 `plugin/web/docs/01-全局设计约束.md` §1.4 排版系统表 为唯一权威**，本节不再重复维护 | `src/index.css`、`plugin/web/docs/01-全局设计约束.md` |
| 紧凑徽标语义类 | 新增 `ldvh-chip-sm`（10px / 12px，500）：18px 高的紧凑状态/优先级/类型 chip，组件不手写 `text-[10px]`；已同步写入 `plugin/web/docs/01` §1.4 字号表 | `src/index.css`、`plugin/web/docs/01-全局设计约束.md` |
| 研究对象阅读布局 | 24 号薄索引：固定 H2 正文分节 + YAML 源节点（排序直显、不过滤）+ F1 卡投影 research_question/research_purpose/stopping_reason | `plugin/web/docs/04-ObjectDetail.md` |
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
| 子目标列表 | `/objects/subgoal` | 28 号 F1：卡头 chip（类型 → 优先级 → **次序** → 修改次数）＋判据类型 + 达成条件一句 + 名下工作区；默认只列 active |
| 子目标详情 | `/objects/subgoal/:id` | 28 号阅读布局：次序块 → 达成条件 → 对齐说明 → 名下工作（serves 反查派生）→ 修订史（卡头次序 chip 与详情序次块同源 `order`） |
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

## 4bis. SubGoal（28 号）Web 接入（2026-11）

子目标从 goal.md 的一行文本变为独立事实对象后，Web 侧按「新事实类型完整接入」的
既有流程接入（同 26 号 friction、27 号 norm 那一轮，见 `web/tests/api/friction-norm-presentation-contract.test.ts`）。

**接入面（22 处）**：后端类型面（`facts.ts` / `localFactReader.ts` /
`factFieldContract.ts` / `pytools.ts` / `federation.ts` / `typeColors.ts`）、
列表（`ObjectList.tsx` 的 `SubGoalCardContent` + 状态筛选闭集 + 默认 active）、
详情（`FactReadingLayouts.tsx` 的 `SubGoalReadingLayout` + `model.ts` 字段序 +
`ObjectDetail.tsx` 分派）、导航与图标（`Sidebar.tsx` / `SemanticIcon.tsx` /
`categoryColors.ts` / `statusColors` / `StatusBadge`）、i18n（类型名、状态三态、
`criterion_kind` 三值、七条阅读区标题）、目标页下钻（`GoalSection.tsx`），
以及近期动态取数（`cognition.ts`）。

**新增第三色相 `lime`**：`decisionBlocks.ts` 原为 `Record<'amber' | 'violet'>`。
加色相不是「新类型就该新颜色」——amber 在 Pitfall/Friction 上表示「待处置」、
violet 在 Norm 上表示「规则体系」，子目标既非待处置也非规则，借用任一色都会
被误读成那两类。lime 与 Goal 的 emerald 同属绿族不等值，读作「同一目标层的下一级」。
**代价已付**：`structure-single-source-contract` 的
`DECISION_SHELL_SEGMENTS` / `DECISION_TITLE_HUE_CLASS` / `border-l-*` 白名单
三处同步登记（白名单 6 → 10 处）。

**两条语义边界落在呈现层**（这两条不是文案偏好，是类型存在的理由）：

1. **空集是歧义，不是 0%**（28 §8.1）：名下无 `serves` 指向时，卡片与详情都必须
   标注「未声明或未拆解」，并说明「真的没拆解」与「拆了但没人写 serves」在机械层
   不可区分。呈现层不得渲染任何进度值。
2. **达成不由工单推出**（28 §18 红线 3）：`achieved` 的说明只陈述「判据已由证据
   满足」，并显式否认「名下工作都关闭了」。状态提示（`getObjectStatusHint`）与
   终态卡片（`objectList.subGoalAchievedNote`）两处都写了这句否认。

这两条各有一条契约断言钉住（`web/tests/api/subgoal-presentation-contract.test.ts`
的「名下工作为空时…」与「达成态不得由…推出」两项）。

**已知边界**：`serving_work` 由 `facts.ts` 在详情读取时反查 spark + workcase 全量
（各 `limit 2000`）派生，**不落盘**（28 §8.1 禁存下游状态）。反查失败的类型记入
`serving_unreadable` 单列，不并入空集——「读不到」不得被读成「没有」。

## 4ter. 身份与次序分离（2026-11-01，废止 SG-n）

`serves` 从 `SG-n` 业务编号改为 `object_uid`（与 `refs` 同口径），`anchor` 字段
整体退场，显示次序改由可选 `order` 承担（28 §7/§8）。Web 侧的对账：

- **`serves` 的 uid 必须先解析成子目标再上屏**。（**2026-11-01 晚已作废**——见下节
  4quater，`serves` 整体退出 Web 呈现，本条的解析链路随之删除。保留此条只为记录
  当时的形态与理由，不作为现行约定。）`ServesSgBadge` / `ServesSgFilter`
  经 `hooks/useSubGoals.ts` 的 `useSubGoalIndex()` 取 uid → 子目标表的映射；表源自
  `/api/cognition/goal` 的 `sub_goals` 投影，而该投影本身由 `subgoals/*.md` 反查
  派生（28 §8.1 禁止在 goal.md 存副本）——**没有第二份数据**。
  解析不到时如实回落 uid，不显示空白或「未知」（那会让一条真实引用看起来像坏了）。
- **卡头 chip 显示 `order` 而不是标题**：标题最长 40 字（28 §8），实测塞进卡头会
  挤掉同一行的状态徽标与修改次数。`order` 正是为显示而设的字段，语义也与它接手的
  `SG-n` 一致——第几条子目标；完整标题留在 `title` 悬停里。`order` 缺失是合法
  状态，此时才回落截断的标题。（**卡头那一处已随 4quater 撤除**；子目标详情与
  目标区的 `order` 呈现不受影响。**2026-11-02 已复位**，见 §4sexies：4quater 撤的
  是 `serves` 子目标 chip 背后的 uid 解析链路，`order` 在卡头的位置理由从未失效。）
- **目标区（聚焦页与 `/goal` 详情）同理**：原先直接把 `sg.id` 渲染成 chip，改存
  uid 后那一格会出现四串十六进制，现改渲染 `order`。
- **`order` 不承担身份**：可缺失、可重复、可不连续（28 §8），故契约里是
  `field('subgoal-order', 'number', false)`；排序由 `compareSubGoalDisplayOrder`
  给出（order 升 → created_at → uid），legacy 行一律排对象行之后。
- **联邦卡的类型 chip 顺带修复**：`listObjects` 的投影只带 `fact_type_key`，
  单项目列表路由经 `normalizeItem` 补 `type`，联邦路由没有那道归一化，导致八类
  对象的联邦卡类型 chip 一直是空白。现由 `federation.ts` 按查询上下文写回
  `type: objectType`（虽非本轮引入，但在核对联邦子目标卡时暴露）。

## 4quater. `serves` 退出 Web 呈现与筛选（2026-11-01，Human 定案）

**决定**：`serves` 不再在 Web 上呈现或筛选。上一节建立的整条「uid → 子目标标题」
解析链路随之删除。**撤的是呈现，不是字段**——`serves` 仍是 Spark 与 WorkCase 的
归属引用字段，四个非呈现消费方照旧（25 §9 达成判定、21 §10.3 局部重批、子目标
详情反查、召回 F1/F2）。

**撤除清单（四个呈现点 + 一个筛选条）**：

| 位置 | 原形态 | 现状 |
|---|---|---|
| 列表卡头（`ObjectList.tsx`） | `ServesSgBadge` 紧跟 `PriorityIcon` | 已删 |
| 详情身份头（`ObjectDetail.tsx`） | 同上，四处呈现点之一 | 已删 |
| 认知中心近期动态行 | 同上 | 已删 |
| 认知中心健康度行 | 同上 | 已删 |
| 列表筛选条（`ServesSgFilter`） | 一行 tab，选项来自整份目标投影 | 已删；`?serves=` 旧链接参数一并清理 |

**整文件删除**：`src/components/ServesSgBadge.tsx`、`src/components/ServesSgFilter.tsx`、
`src/hooks/useSubGoals.ts`（其 `normalizeServesList` 只服务于上述徽章）。

**辅助元信息表出列**：`AUXILIARY_META_KEYS_BY_TYPE` 的 `spark: ['serves']` 改为
`spark: []`。该表是**呈现登记**——列在这里 = 以辅助元信息形态呈现、并同时从兜底
字段区排除；撤掉呈现就不该继续留着它，否则「不呈现」这个决定没有落点。出列后
`serves` 落回 `getObjectDetailContentEntries` 的兜底字段区，但不会因此冒出来：
spark 与 workcase 的详情都走专属阅读布局，两者都不消费 `extraEntries`。

**为什么是方向而不是取舍**：子目标（28 号）才是承载体，Spark 与 WorkCase 挂到
子目标上只是归属引用。「这个子目标名下有哪些工作」由子目标详情页的「名下的工作」
正向回答（`deriveServingWork` 反查）。在每个下游列表页先选一个子目标、再看被过滤
的对象池，是把「从目标看工作」倒推成「从工作找目标」。撤除同时去掉一个真实成本：
该筛选每次进列表页都要 `fetchCognitionGoal()` 拉整份目标投影，只为换一行选项。

**规范侧同步**：`specs/20` §13 消费点表两行（「Web 列表筛选与排序」「认知中心 Spark
健康度」）去掉 `serves` 并附决定登记；`specs/28` §12.1 补「呈现方向单向」段，
说明反向不设呈现面。`specs/07` 自始未就 `serves` 的呈现作出规定，无需改动。

**守卫**：`tests/api/subgoal-presentation-contract.test.ts` 的
「serves 不参与 Web 呈现」一条——三个文件必须不存在、四个呈现点不得回归、
`?serves=` 参数必须被清理、辅助元信息表不得再登记。**已做负向验证**：把徽章加回
详情头，该守卫与另两条（详情头块序、WorkCase 呈现）同时报错。

## 5. 设计语言横切审计（2026-10-05）

全站横切验收（静态扫描 + Playwright 实拍浅/深 × 375/1440 + `getComputedStyle` 量测）确认的漂移与处置：

| # | 发现 | 契约依据 | 处置 |
|---|---|---|---|
| G1 | `WorkCaseCriteriaList` 详情档正文停在 12px 卡面扫描档 | `plugin/web/docs/01` §1.4 约束 4 | 已修：`density` 分岔正文层级，detail → `ldvh-body`（14px） |
| G3 | 5 处手写药丸标签无令牌承载 | `docs/01 §1.3`/§1.4 | 已修：新增 `ldvh-pill` token，5 处收敛 |
| G4 | 聚焦页次级网格为全站唯一内联手写网格 | `docs/01 §1.5` | 已修：新增 `ldvh-subgrid` token（16rem/1rem） |
| G5 | 联邦项目筛选为手造 tab 变体 | `plugin/web/docs/01` §1.4 约束 7 / `docs/11 §4` | 已修：归入 `ldvh-tab-*` 家族 |
| G7 | 对象列表排序控件用分段控件而非 tab | `plugin/web/docs/01` §1.4 约束 7 | 已登记例外：排序是**有序枚举二选一**，非内容分区切换，保留 `ldvh-segmented-control`。同批为「数字指标」条补记近期热点标题例外（`docs/02` §139） |
| G8 | `border-l-*` 扩散为 4 族 3 种粗度、6 个文件 | `specs/10` §5.5（判据面板四边 1px）与 `docs/11 §1`（项目色条定案）的作用域口径 | **Human 裁决 2026-10-05（选「甲」）**：保留两族语义左条——领域归属决策块（`decisionBlocks.ts`）与项目识别色条（项目行/项目卡）；归正警示条与导航选中态共 4 处为四边同宽。规则落 `docs/01 §1.10` 第 7 条，新增守卫 `structure-single-source-contract` 防复发 |

**G8 的实测口径（供后人复算）**：归正前全站 `border-l-*` 共 **12 处**（决策块 6 段＝3 壳 × 粗度/色相两段、警示条 2、导航选中态 2、项目识别色条 2）。本轮归正后剩 **8 处**，全在两族允许域内；`border-l-4` 归零。守卫按「允许处数」白名单断言（`decisionBlocks.ts` 6、`ProjectSwitcher.tsx` 1、`Federation.tsx` 1），使同文件内再插入一条非语义左色条也会红。

| G9 | 聚焦页两处对象标题漏配标题带（近期动态行、Spark 健康度行） | `docs/01` §1.10「统一要求」第 4 条、§1.8.1 组件契约 | 已修：两处外层容器补 `ldvh-object-title-tray ldvh-object-title-tray-compact -mx-1 px-2.5`；新增守卫 `web-design-consistency-contract` 断言 `CognitionCenter` 内标题与标题带一一对应 |

**G9 的形态**：标题带**不由标题类自带**，而由调用方在外层容器另加一个类。因此「同一个 `ldvh-card-title`，A 处包带、B 处漏带」在源码与类型上**均合法**，编译与既有守卫都不拦——只能靠逐处人工比对或渲染实拍发现。实测语义：漏带的卡在整页里表现为「只有这两张卡的标题没有背景框」，正是 Human 2026-10-05 指出的一处。全站横向排查结果：有带的 4 处（`ObjectList` 列表卡、`ObjectDetail` 详情、`CommitHotspotGraph` 热点图、`Changelog` 提交卡），漏带的仅 `CognitionCenter` 2 处；其余 `ldvh-card-title` 使用点（`Sidebar` 导航项、`ProjectSwitcher` 选择项、`Help` 步骤标题、`Changes`/`ProjectFiles` 的文件名与分支名、`EvidenceBlock` 小标题、若干错误提示）**不属于对象卡片**，依契约不应带框。

**守卫的保证边界（勿夸大）**：跨文件的「哪些 `ldvh-card-title` 属于对象卡片」无法从字形判定，故守卫只在文件内做计数配对；且它是形态级——改以 inline style 表达标题带会因类名消失而被**误判为缺失**（假阳性式拦截），反之同一文件内把标题与标题带同时换名则逃逸。变异三连实测：漏配被精确捕获（2 : 1）、注释记载不误伤、换表达手段报红但属假阳性。

**复核中被撤回的两项**（初判为缺陷、复核后不成立，如实登记以免后人重复判定）：

1. **G2「同一卡头两种 chip 形态」不成立**。初次 `getComputedStyle` 探测量到若干 `span.rounded-full` 的 `fontSize: 12px`，据此怀疑 `WorkCaseClosedStatusBadge` 与 `StatusBadge` 行高不一致；改用 `.ldvh-chip-sm` 精确取样后，卡头全部徽标（类型/SG/活动数/合并状态徽标）实测均为 `height:18px` / `line-height:12px` / `font-size:10px`，**完全一致**。初次探测选中了空占位元素，是探测方法的缺陷，不是产品缺陷。
2. **G6「能力缺口徽标吃警告琥珀」不改**。`WorkCaseCapabilityStatusBadge` 的琥珀档确实偏离 `LDVH_WARN_CHIP_HUE_CLASS`，但 `src/utils/semanticColors.ts` 已把它登记为**域内自定档**（刻意弱于横切档），契约测试亦同款登记。改动它属配色偏好而非契约修复，故保留现状。

**已消解的历史冲突**：`plugin/web/docs/01` §1.4 约束 8（数字指标只允许 `text-xl` / `text-2xl`）与 `docs/02` §139（近期热点主标题缩略 16px / 展开 18px、一跳工作 14px/20px）的字面冲突。二者都是现行规格，本轮**不改任一原文**，而是在约束 8 补记该页例外，使新页面不再据字面误判热点图违规。

**已裁决**：`border-l-2` 与「四边 1px」的作用域口径（原登记于 `docs/design-language-unification-demo.html` §4）。Human 2026-10-05 选「甲」——保留两族语义左条，其余归正；规则落 `docs/01 §1.10` 第 7 条。演示页五档待批清单中，③（发现 G）与 ④（pill token）已随本轮落地，⑤（`border-l-2` 口径）已裁决。

**登记未修（已知隐患，暂不处理）**：

1. **`EvidenceBlock` 的默认标签为中文硬编码**（`getEvidenceDefaultLabel` 返回 `'计划'`/`'结果'`/`'结论'`/`'记录'`）。这些标签经 `<td>{row.label}</td>` 直接上屏，英文环境下会漏中文，违反 `docs/01 §1.3`（UI 文案须走 `t()`）。**当前不可达**：`EVIDENCE_FIELDS = ['verification','evidence']` 匹配的是**顶层字段**，而当前事实源中 `evidence:` 均嵌套于列表项内，无对象带顶层 `verification`/`evidence` 字段——实测英文环境未检出这 4 个中文标签。待有对象的顶层字段命中该路径时须补 i18n key。
2. **`PanelContent` 的 `goal.md` 读取失败文案为中文硬编码**（`throw new Error(result.error ?? 'goal.md 读取失败')`）。同属兜底路径，仅在 `goal.md` 读取失败时上屏；`docs/01 §1.3` 要求加载失败态必须有中英文版本。

## 6. 会话项目跟随的呈现接线（2026-10-29）

上位规则：`specs/07` §7「会话项目跟随」各条与 §8「跟随判据不可得」行、§9「会话项目跟随」验证行。**本节只登记实现接线（由哪个组件、哪处常量、哪份用例钉住），不复述规则**；规则与实现不一致时以 `specs/07` 为准并须修正实现，不得反过来据实现放宽规范。

| 规则面 | 承载点 | 钉住它的用例 |
|---|---|---|
| 会话所属项目的判据来源 | `plugin/lib/client.js` 的 `askGovernanceProject`／`resolveSessionProject`，经 `/ldvh/state/governance` 取 `project.id`；客户端不解析路径、不读登记载体 | `client-session-follow.test.mjs`「判定经 sessionId 取得」「会话标识缺失时不去问管辖判定」 |
| 判定入参口径 | **两种输入形态都要问**：`sessionId` 与 `cwd`。判定表的 key 是 `agent.session.header.id`，而呈现装载面传入的会话标识须落在同一 id 空间才有答案；不一致时端点按 fail-closed 如实回 `unknown`——只问一种形态时跟随会**静默失效**（页面照开、项目照不对、不报错）。实测：带 `session-` 前缀的 id 回 `governed`，同一会话去掉前缀回 `unknown` | 同上（`sessionId` 判不出时改问 `cwd` 的兜底路径） |
| 仅项目变化才换页 | `useFollowedFrameLocation` 的 state 只记 `projectId`，同项目返回**同一对象**使 `src` 逐字不变；`src` 只在判定回话时拼一次，不在 render 里现拼（现拼会让页内导航后的无关重渲染把新路径写回 src，React 遂重载文档） | 「同项目切会话不换页，跨项目才换」「判不出所属项目时不带项目参数」「管辖判定不可达时页面照常打开」 |
| 跨项目不沿用页内对象链接 | `composeFollowedLocation`＋`ldvhFrameProjectId`：路径归属由 `src/App.tsx` 的 `RouteMemoryReporter` 随 `postMessage` 上报（须带 `projectId`，故该组件必须挂在 `ProjectScopeProvider` **之内**）；归属与跟随目标不一致时落回 `LDVH_HOME_PATH` | 「跨项目不沿用别的项目的深链接；同项目重挂时保住它」 |
| 不存在跟随目标时不生效（07 §7 跟随条） | `src/utils/projectSessionScope.ts` 的 `resolveInitialProjectId`（无 DOM 纯函数）：参数命中登记列表才采用，否则逐字回退「记忆 > 默认 > 首个」；登记列表为空时回空串，由页面既有空态承接——此时不存在跟随目标 | `plugin/web/tests/api/project-session-scope.test.ts` 前三条 |
| 参数名同源 | 两侧各写一份字面量 `ldvhProject`（`client.js` 的 `LDVH_PROJECT_PARAM`、`projectSessionScope.ts` 的 `PROJECT_URL_PARAM`）——漂移即静默失效 | `project-session-scope.test.ts`「参数名与宿主插件半同源」 |
| 手选与跟随的优先边界 | 参数只在**首个载入**读取（`projectContext.tsx` 的 `urlSeedPending` ref 记账）；文档内刷新不重读，故手选保住；文档重新载入时以跟随目标为准 | `project-session-scope.test.ts`「承载点确实接入」 |

**两个已知未决面**（不得据本节主张已解决）：

1. **侧栏投放面的 `scope` 形态未经本仓取证**。`dsh-better-sidebar` 是第三方宿主插件（装机在 `~/.dsh/profiles/desktop/node_modules/`，非本仓依赖），其 `TabComponentProps.scope` 含 `sessionId` 与**可选** `cwd`（读其 `lib/types/client/service.d.ts` 所得），运行时是否始终填充 `cwd` 未实测。跟随在 `cwd` 缺失时退化为「只问 `sessionId`」，判不出即不带参数——**这是如实降级，不是失败**。可取证的路径是对话视图（`conversation.view` 的 `inject` 由本插件自己传 `sessionId`）。
2. **`sessionId` 异步落定的窗口**。判定表由会话生命周期事件填充，新建会话首问可能回 `unknown`；此时跟随不生效，到下次重挂或 `cwd` 可用才生效。未做补问（补问会引入「迟到响应覆盖新会话」的竞态，且需额外计时器），保留为缺口。

## 4quinquies. 子目标卡挂载名下工作（2026-11-02）

Human 定案 2026-11-02：「当前的子目标的 card，需要学习 spark 的 card 可以挂载关联对象，
关联的对象按 spark 和 workcase 分层，每个类型最多展现 3 个，其他的要可以收起展开」。

**学的是判据链，不是皮肤**。Spark 卡挂载关联之所以成立，是因为关联由**已声明的引用**
（`refs`／`relations`）派生、以统一关联行呈现、且区域形态收敛在单点。子目标照此办理：
名下工作来自 `serves` 反查（28 §8.1，**不落盘**），行式用 `FactAssociationCardRow`、
区域用 `FACT_ASSOCIATION_ROWS_ZONE_CLASS`／`_LIST_CLASS`——**没有新增第二套行式或第二处
区域形态**。与 `docs/03` §3.2「不设类型分组标题、不折叠或截断」的关系：本区**只破例后者
（折叠）**，「不设类型分组标题」照样成立——块不带层名，行由行首类型图标自描述（见下节首次
定案与 2026-11-02 的撤除记录）。该处正文已注明指向本节。

### 数据面：一次反查，两条路径共用

`api/services/facts.ts` 的 `deriveServingWorkIndex(scope)` 全场扫描 workcase 与 spark，
把 `serves` 指向同一 uid 的行归组。**列表与详情读的是同一份索引**：

| 路径 | 承载 | 说明 |
|---|---|---|
| 列表 | `listObjects` 里 `type === 'subgoal'` 时投影 `serving_work` / `serving_empty` / `serving_unreadable` | 索引只建一次；逐条建索引会让两类被扫描 N 次（N = 子目标数），而判据完全相同 |
| 详情 | `showObject` 原有的 `deriveServingWork(scope, uid)` | 改为同一索引的 `bySubGoal.get(uid)`，不再各自扫描一遍 |

行里多带两个字段，都是**搬运而非重算**：

- `group`（仅 workcase）——21 号派生分组，由 `deriveWorkCaseV5View` 单点算出（09 §5：同一
  判据不得两处各算一套）。卡片的行末状态图标据此判「推进中／待处理」。
- `governed_project_id`——目标对象**自己的**归属项目。联邦视图里它与卡片所在项目可以不同，
  用当前项目会把跨项目的行伪装成本项目对象（那是伪造定位，不是呈现选择）。

**载荷纪律不破**：新增的是派生视图，列表项仍不携带 `report_body`（`serving-work-card-contract`
的第三条断言钉住这一点）。

### 卡面：分层 + 每类先展 3 条

- `SUB_GOAL_ASSOCIATION_PREVIEW_LIMIT = 3`——**扫读预算，不是收窄**：超出部分先收起、可一键
  展开，展开后的条目、次序与折叠时逐条相同（只改可见条数，不改内容）。故该常量不得被用作
  `slice` 之外的任何语义。
- `SUB_GOAL_SERVING_TYPE_ORDER = ['workcase', 'spark']`——类型层**定序**而不按条目数排：层是
  稳定的读法（先看工单的落实情况、再看火花），按数量排会让同一屏在不同对象间换次序。未登记
  的类型追加在后，不因未登记而消失。
- 层内按 `getFactAssociationStateRank` 排序（活跃 → 推进中 → 待处理 → 已关闭 → 已废弃）——
  与卡片关联区**同一判据**：同一类「指向对象」的行在一处按状态排、另一处按文件名排，会让
  同一条工作在两个呈现面顺序不同。
- **不设层名**（Human 定案 2026-11-02，圈掉「火花 2」「工单 25」两行）：行本身**自描述**——
  行首的类型图标已经说出这是什么类型的对象，再写一遍类型名是同一信息的第二次呈现；计数由
  「其余 N 条」与可见行数共同给出，也不需要单独一枚数字。分组仍按类型分块（各有 `divide-y`
  与各自的展开按钮），只是不给块起名。
  > 首次实现时我加过「类型图标 + 类型名 + 计数」的层名，并为它写了「两类并列需要层名」的理由。
  > 那是**给违规找理由**：`docs/03` §3.2 明文「不设类型分组标题」，而该条约束的正是这类行
  > 区域。该理由与层名一并撤销。
- **关联区挂在卡级、与卡体并列**，不进 lime 判据框（`SubGoalCardContent` 返回 `<>body,
  zone</>`）：Spark 的关联行由 `ObjectCardFrame` 在 `children` 之后以顶部分割线承载，把
  关联塞进判据框会让「判据」与「名下工作」看起来同属一个判断。
- **不按状态分支**（同 Spark 2026-09-16 裁定）：achieved／retired 的子目标名下工作仍是可核对
  的历史——「这件工作曾服务于那条已达成的子目标」是事实（28 §12.3 第 4 条）。

### 两条语义边界仍在（不是文案偏好）

1. **空集是歧义，不是 0%**（28 §8.1）：无名下工作时卡面给「未声明或未拆解」，并说明两种情形
   机械层不可区分。卡上不出现任何进度值。
2. **读不到 ≠ 没有**（00 §5.6）：反查失败的类型记入 `serving_unreadable` 单列，不并入空集。

两条各有一条断言钉住；另有行为断言证明「列表与详情得到同一份名下工作」与「按 object_uid
精确归组、不串到其它子目标」。

### 验证

`plugin/web/tests/api/subgoal-serving-work-card-contract.test.ts`（3 项行为 + 3 项形态）、
全量 web 用例 573 → 578 全绿、`tsc -b` 通过、`vite build --base=/ldvh/`＋`gzip-dist` 重建。
Playwright 实拍 `/objects/subgoal`：分层与计数正确、折叠态每层 3 条、点「展开其余 N 条」后
该层全量展开且按钮变「收起」、控制台零错误；`/objects/subgoal/:id` 详情「名下的工作」不受影响。
**未覆盖（如实登记）**：展开态的键盘 Tab 序列、超长标题在窄栏下的换行表现未单独实拍。

## 4sexies. 次序复位到卡头（2026-11-02，Human 定案）

Human 定案 2026-11-02（附截图圈出卡头与判据框内的「次序 4」）：「次序放到上面，样式对齐
其他的 icon」。

### 位置：卡头而不是判据框

`order`（28 §8）回答的是「**这一条排第几**」，判据框回答的是「**这一条自己怎么算达成**」。
前者是**跨条比较**的扫读要素——读者在四张卡之间比先后；后者是单条自证。把一个与判据无关
的排序值摆在判据框里，那个框就会看起来同时回答两个问题。卡头那排 chip（类型 → 优先级 →
次序 → 修改次数）本来就是「跨条比较、扫一眼」的层级，`order` 与 `priority` 同级。

故 `SubGoalActiveCardBody` 收窄为**只剩判据类型 + 达成条件**，次序一行及其「未定次序」
分支整体移出。`SubGoalOrderBadge`（`src/components/SubGoalOrderBadge.tsx`）是卡头那枚 chip
的**单一来源**：别处若要复用只走它，不各自手写。

### 样式：不是新造一套，是复刻卡头已有规格

`ldvh-chip-sm shrink-0 gap-1` + `border-ldvh-accent/25 bg-ldvh-accent/5 text-ldvh-accent`
+ `<ListOrdered size={12} />`——与卡头「修改次数」（`History` 12px、同色相）逐字同规格，
与 `FrictionOccurrenceBadge` 同形。这三枚都是「一个字段值 + 一枚说明它的图标」，因此共用
`.ldvh-chip-sm` 的 18px 定高与 11px 字，不引入第三种尺寸。

### 缺失态：占位符，不是隐藏

`order` 可缺失（28 §8）。缺失时**保留图标、把值渲染成 `·`**，可读文本由 `title` 承担
（`objectList.subGoalOrderAbsent`）——沿用目标区子目标行与 `GoalSection` 的既有约定。
不隐藏的理由：卡头上突然少一枚 chip，读者无从分辨「这条没有次序」与「这个版本忘了画」；
`·` 是「此处该有值而现在没有」的既有记号。**不补隐式编号**（28 §8 明文禁止）：`·` 不是
0、不是上一条 +1。闭集外取值（0、负数、非整数、字符串）一律按缺失处置——把非法值原样
印上卡头，会让它看起来是一条有效的显示次序。

### 与 friction 卡头契约的位置相容

落地时踩了一次：把次序 chip 插在 `PriorityIcon` 与 `FrictionImpactBadge` 之间，触发了
`friction-norm-presentation-contract` 的「影响紧跟优先级」断言——该断言要求两者在源码里
相隔 ≤400 字符，而我在中间塞了长注释。修法**不是放宽那条守卫**，而是把次序 chip 放到
friction 两枚 chip 之后：那两枚只在 friction 卡上渲染，故子目标卡的可见序列仍是
类型 → 优先级 → 次序 → 修改次数，同时 friction 契约依赖的邻接原样保留。

### 验证

`subgoal-presentation-contract.test.ts` 新增一项：次序 chip 在卡头（且在修改次数之前）、
判据框不得再读 `order`、样式规格与 12px 图标照卡头、缺失态渲染 `·` 且只接受正整数。
全量 web 用例 578 → 579 全绿、`tsc -b` 通过、dist 重建；Playwright 实拍确认卡头 chip 序列
为 子目标 / 4 / 3 / 推进中 / 闭环记录、判据框只剩「判据类型 + 达成条件」、控制台零错误。
**未覆盖（如实登记）**：缺失态的实拍（现存四个子目标都带 `order`，未造缺失夹具）。
