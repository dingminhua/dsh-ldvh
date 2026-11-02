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
| 子目标列表 | `/objects/subgoal` | 28 号 F1：卡头 chip（类型 → 优先级 → **次序** → 修改次数）＋判据面一句 `criterion`＋名下工作区；默认只列 active |
| 子目标详情 | `/objects/subgoal/:id` | 28 号阅读布局：身份头 chip（类型 → 优先级 → **次序** → 修改次数，次序与列表卡卡头同一枚组件）＋ 达成条件 → 对齐说明 → **判法** → 名下工作（serves 反查派生）→ 修订史；`parent_goal` 落身份头元信息行 |
| 开发日志列表 | `/objects/devlog` | 29 号 F1：卡头 chip（类型 → **发生时间** → 修改次数）＋ `summary` 一句（折叠阈值 420）；默认只列 active，三枚终态各自成筛选项 |
| 开发日志详情 | `/objects/devlog/:id` | 29 号阅读布局：时间轴（发生时间 / 条目形成时间分开）→ 结论与边界 → 去向 → 背景 → 做法 → 实测 → 承接边 → 修订史 |
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

> **2026-11-02 追记：卡面那一半已撤回**（见 §4septies）。子目标**卡面**改判据面
> 形态后，`DECISION_CARD_SHELL_CLASS.lime` 连同白名单 2 处一并消失（10 → 8）。
> `DECISION_TITLE_HUE_CLASS.lime` 与 `DECISION_DETAIL_LIME_SHELL_CLASS` 仍在用——
> **详情面**锚点块不在该次定案范围内。故本段「新增第三色相」仍成立，只是作用域
> 从「卡面 + 详情面」收窄为「仅详情面」。
>
> **同日稍晚再追记：详情面那一半也已撤回**（见 §4novies）。Human 定案「这个地方只保留
> 判法即可」，锚点块整体撤除，`DECISION_DETAIL_LIME_SHELL_CLASS` 失去最后一个消费方
> 并删除。**至此 lime 作为「壳的色相」已完全退出**，只剩
> `DECISION_TITLE_HUE_CLASS.lime` 这一枚**色相原子**——它现在的唯一消费方是
> `DevLogReadingLayout` 的时间轴标题，与「子目标该是什么颜色」已无关系。本段关于
> 「子目标不该借用 amber/violet」的论理仍然有效且未被推翻，但它所记录的那次加色相
> 作为**视觉决策**已被两轮 Human 定案整体回收：子目标在两个面上都不再用 lime 壳。

**两条语义边界落在呈现层**（这两条不是文案偏好，是类型存在的理由）：

1. **空集是歧义，不是 0%**（28 §8.1）：名下无 `serves` 指向时，卡片与详情都必须
   标注「未声明或未拆解」，并说明「真的没拆解」与「拆了但没人写 serves」在机械层
   不可区分。**空集时呈现层不得渲染任何进度值**（比值口径与这条的边界见 §4decies）。
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
  状态，此时才回落截断的标题。（**卡头那一处已随 4quater 撤除**；目标区的 `order`
  呈现不受影响。**2026-11-02 已复位**，见 §4sexies：4quater 撤的是 `serves` 子目标
  chip 背后的 uid 解析链路，`order` 在卡头的位置理由从未失效。子目标**详情面**的
  `order` 同日并入身份头，见 §4novies。）
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
   机械层不可区分。**空集时不画任何进度值。**
   （2026-11-02 晚追记：卡上现在有一枚「火花落实 9 / 31」的比值——它是对**已存在
   `serves` 引用**的计数，不是对「还没拆解」的猜测，故不违背本条；分母为空时不画条。
   见 §4decies。）
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

## 4septies. 子目标判据面并入 WorkCase 判据面（2026-11-02，Human 定案）

Human 定案 2026-11-02（附截图裁切子目标卡判据框：「次序 4 | 闭环记录」chip 行 + 正文）：
「这里的样式对齐 workcase 的，左侧的线条不要加粗，此外 次序 闭环记录都不用显示」。

### 形态：复用判据面常量，不自造第二套

判据框的类串从 `DECISION_CARD_SHELL_CLASS.lime`（`rounded-md` + 左 2px 粗线 + 整面
黄绿淡染 + `px-3.5 py-3`）换成 **`WORKCASE_CRITERIA_SURFACE_CLASS`**（`rounded-lg` +
四边同宽 1px + 蓝面 + `px-3 py-2`）。实测计算样式：四边皆 `1px`、`radius 8px`、
`padding 8px 12px`——与 WorkCase 卡面计划清单逐项相同。

**为什么不新写一个「子目标判据面」常量**：判据与 WorkCase 的「计划与判据」是同一
语义（`docs/04:80`「蓝色标准与预期」）——都是「要出现什么材料才算成立」。两侧同一
语义配两种底色，读者会以为它们不是一回事。另造常量只是把「两套视觉」写得更整齐。

**正文色也成对复用**：新增 `WORKCASE_CRITERIA_BODY_HUE_CLASS`（`text-blue-900/70
dark:text-blue-100/75`）并让 `WorkCaseCriteriaList` 自身改用它——此前它是组件内的
字面量。面同源而正文各写一份，等于把「蓝面上的字该多深」拆成两处答案。

### 框内只剩一句判据

- **`order` 不显示**：上一次定案（§4sexies）已把它移到卡头，本轮不动卡头。
- **`criterion_kind`（「闭环记录」）不显示**：它是**判定口径**（用什么材料判），
  卡面只回答「算什么」。两者并排时读者看到的是「两行标签 + 一句正文」，扫读成本
  高于信息量。28 §8 要求该字段必填，故不会因卡面不显示而在载体里消失。
  （**2026-11-02 晚追记**：它的**词**如今在详情面也不上了——Human 定案「只保留判法
  即可」，只留它对应的判法说明。见 §4novies。）
- **不画圆点**：WorkCase 判据面的圆点是「并列条目之间的分隔记号」（恒定 ≥1 条且常
  多条）。本框恒为一句，孤零零一枚圆点会被读成「一个只写了一句的清单」。
- **正文用 `ldvh-card-decision-body`（12px）而非 `ldvh-caption`（12px 次要色）**：
  判据是这张卡的主要阅读对象，不是辅助信息；用次要色会让它看起来比标题更可忽略。

### 连带后果：lime 卡面壳退场

`DECISION_CARD_SHELL_CLASS` 从 `Record<'amber' | 'violet' | 'lime'>` 收窄为
`Record<'amber' | 'violet'>`——该家族的定义特征就是左色条，卡面既撤左条，这枚壳
就不再属于本家族，留着只是一个无人消费的死常量。两处守卫同步：
`DECISION_SHELL_SEGMENTS` 删去该行、`border-l-*` 白名单 **10 → 8**（仍保留两个详情面壳）。

> **2026-11-02 深夜追记：`violet` 随后也退出，该常量现为 `Record<'amber'>`。** 活跃规范卡
> 的方向键块撤除后这枚壳失去最后一个消费方，白名单 8 → 6 → 4。见 §4undecies。

**详情面不动**（如实登记为本次未覆盖项）：`SubGoalReadingLayout` 的锚点块仍是
`DECISION_DETAIL_LIME_SHELL_CLASS` + 次序 chip + 判据类型 chip。Human 附的是**卡面**
截图，详情面未被指认；且详情面是阅读面，类型色锚点在那里有定位作用。子目标因此成为
「卡面不用左色条、详情面仍用」的唯一类型——这是分岔（卡面跟判据面板、详情面留类型
锚点），不是漂移；若 Human 要统一，改 `FactReadingLayouts` 一处即可。

> **2026-11-02 晚追记：这条分岔已收敛**。Human 定案「这个地方只保留判法即可」，
> 详情面那个黄绿锚点块整体撤除，`DECISION_DETAIL_LIME_SHELL_CLASS` 随之失去最后一个
> 消费方（同轮删除）。子目标现在**卡面与详情面都不使用左色条**。见 §4novies。

### 验证

`subgoal-presentation-contract.test.ts` 的次序测试扩为：判据框不得读 `criterion_kind`、
不得用 `DECISION_CARD_SHELL_CLASS`、不得出现 `border-l-2`，且必须引用判据面与正文色
两个常量。全量 web 用例 579 全绿、`tsc -b` 通过、dist 重建；Playwright 实拍确认判据框
只剩一句正文、四边同宽 1px、radius 8px，控制台零错误。
**未覆盖（如实登记）**：暗色模式实拍；`criterion` 为空的降级态实拍（现存四个子目标都
带判据，未造空夹具）。

## 4octies. DevLog（29 号）Web 接入（2026-11-02）

DevLog 是第 9 个事实类型。Human 要求：「新增了 devlog 的事实对象，也要参考一致的设计
语言进行新增，**放在所有事实对象的最后**」。接入沿用既有流程（同 26 friction、
27 norm、28 subgoal 那三轮），形态面按各类型的相邻先例逐一对照，不自造第二套。

### 接入面（21 处）

后端类型面 7 处：`facts.ts` 的 `ACTIVE_OBJECT_TYPES` 与 `OBJECT_ID_PATTERN`、
`localFactReader.ts` 的三张登记表（目录 `devlogs` / 载体 `.md` / markdown 类型）、
`factFieldContract.ts`（字段契约 + 列表字段 + 终态闭集 + 目录名）、`pytools.ts`、
`federation.ts`、`typeColors.ts`、`cognition.ts`（近期动态并入 `recentSources`）。

前端类型面 10 处：`categoryColors.ts`、`SemanticIcon.tsx`（`NotebookPen`）、
`Sidebar.tsx` 两处导航、`listStatus.ts` 默认 active、`ObjectStatusFilter.tsx`
（三枚终态筛选 + `FALLBACK_STATUSES_BY_TYPE`）、`ObjectIdentityActions.tsx` 两处
状态提示链、`fieldFormats.ts`、`commitLabels.ts`、`FederationObjects.tsx`、
`utils/api.ts` 的 `ObjectItem`。

呈现 4 处：`ObjectList.tsx` 卡体与卡头、`DevLogOccurredBadge.tsx`、
`FactReadingLayouts.tsx` 的 `DevLogReadingLayout`、`ObjectDetail.tsx` 分派 +
`model.ts` 字段序。

### 次序：末位，且两处导航同序

`NAV_ITEMS` 与 `FEDERATION_NAV_ITEMS` 都把 devlog 放在 `nav.norms` 之后、
`/project-files` 之前——**它是对象族最后一项，其后不再有任何 `/objects/` 入口**。
两处同改的理由与 §4quinquies 相同：同一入口在两个作用域里换位置，读者会以为
联邦视图里少了一类。契约断言直接断言「devlog 之后不得再有对象族入口」，而不是只
断言「在 norm 之后」——后者在新类型追加到末尾时会静默失效（新类型正好排在 norm 之后，
devlog 的不再末位就没被任何断言看见）。

### 卡面只读 `summary`，不读标题

29 §8 明文 **`title` 不承载结论**（它是 ≤40 字的定位短标题），结论住在 `summary`
（「当前语义快照」：结论本身 + 当前适用边界 + 已确认不成立的情形）。因此卡体的
正文是 `summary`，用 `SummaryText`（`collapseThreshold=420`）折叠——**不复用
WorkCase 判据面常量的取舍**：判据面是「一句判据」的容器，长结论需要的是折叠阈值，
两者共用同一蓝面而非同一组件。

卡头多一枚 `occurred_at` chip（`DevLogOccurredBadge`），排在修改次数之前。
**为什么不与「修改次数」合成「什么时候」**：`occurred_at` 是**这件事发生的时间**，
`created_at` 是**条目形成的时间**，29 §10.4 要求分开呈现——合成一枚会让两个不同
问题共用一个数字。与 `SubGoalOrderBadge` 同一形态（`ldvh-chip-sm` + 12px 图标 +
accent 色相 + 缺失给 `·`），不新造规格。

### 详情：阅读次序 ≠ 书写次序

`DEVLOG_BODY_SECTION_ORDER = ['结论与边界', '去向', '背景', '做法', '实测']`。
载体里的书写次序是 29 §8 那五段（背景 → 做法 → 实测 → 结论与边界 → 去向），
**阅读次序把结论提到最前**：读者打开一条 DevLog 要的是结论，而背景/做法/实测是
依据。这不是「重新排列正文」——解析器按 H2 标题取值，次序只影响渲染顺序。

三处显式标注（都不是可选文案）：

1. **时间轴节点**同时给 `occurred_at` 与 `created_at`，各带自己的标签；
2. **空集歧义**（29 §8.1）：无 `serves` 时标注「未声明或不属于任何子目标」，并说明
   「确实不属于」与「未声明」在机械层不可区分——**不得写成「无主题」**，那会把歧义
   压成一个确定结论；
3. **压缩形态**（29 §9.1）：`absorbed` 条目正文只剩两段，渲染时显式说明「已被承接，
   正文压缩为『结论与边界』与『去向』两段」——不静默少三段，否则读者会以为内容丢了。

承接边（`absorbed-into` 的 commit 形态）走既有 `FactAssociationsSection`：`facts.ts`
的 `projectFactCardAssociations` 早已支持 `{commit}` 形态目标（读提交标题、`available:
true`、短哈希），**不新写解析**。实拍确认 absorbed 条目关联区显示 `6c43770`。

### 类型色：`#ca21a0`（magenta，色相 315°）

取既有八类色相之间的**最大空隙**，而不是就近取一个「看起来属于同一族」的色：
最近邻（`#a855f7` 紫，色相 276°）相距 44°，既有一切类型色两两距离 ≥20°。
**不用中性灰**：灰在 LDVH 里已属「终态/废弃」语义族（`slate` 弱化），拿它当类型色
会让活跃条目读起来像已废弃。对比度：浅底 `#f8f9fb` 4.71:1、暗底 `#0a0a0f` 3.98:1，
均过 WCAG AA 正文阈值。

**断言的作用域刻意收窄到「事实类型那九类」**：`CATEGORY_COLORS` 里还混着 conventional
commit 的 scope 色（`feat` 与 `workcase` 同值 `#3b82f6`、`ci` 粉 `#ec4899` 与 magenta
相距仅 15°）——它们不同屏竞争同一个判断，把它们算进来会得到一条与实际阅读无关的约束。
这条边界写在测试注释里，避免后来者以为「全域色相都 ≥20°」。

### 验证

新建 `web/tests/api/devlog-presentation-contract.test.ts`（7 项）：类型面登记、字段级直读
（含 absorbed 正文只剩两段这条机械可核形态）、图标与类型色（含色相距离）、侧栏末位、
卡面读 `summary` 与卡头次序、详情阅读次序与两时间分开、空集与压缩文案把话说完整。夹具 UID 用 `4444…`/`5555…`/`6666…`
便于辨识，不进事实源。

全量 web 用例 **586 全绿**（起点 579 + 7）；plugin `npm test` **2711 tests / 2709 pass /
0 fail / 1 skip**；`tsc -b` 通过；`npm run lint` 仅剩 HEAD 上既有的 1 error
（`facts.ts` 的 `currentProjectProjectionIndexes` 未使用）+ 1 warning（`ObjectList.tsx`
react-refresh）——已用 `git stash` 对比确认非本轮引入。dist 重建。

Playwright 实拍（真实 API、真实数据路径）：侧栏次序实测为 聚焦/子目标/火花/工单/调研/
决策/经验/摩擦/规范/**开发日志**/目录/变更/提交/帮助/诊断；列表卡 chip 实测
`["开发日志", "2026-11-02 10:30", "1", "承重中"]`；状态筛选实测 承重中 1 / 已被承接 1 /
已被推翻 0 / 不再承重 0 / 全部 2；详情面确认时间轴节点两个时间并列、serves 行、
空集歧义提示、压缩形态说明、承接边 `6c43770`；控制台零错误。

**已知边界（一条既有投影口径，本轮未改）**：对象目录**不存在**时，读取层报
`type_not_integrated`（「该事实类型尚未接入」）。这对 devlog 现在是一句不准确的话——
类型确实已接入，只是本项目还没有任何一条 DevLog，目录因此还没被 writer 建出来
（`devlog-writer.js` 落盘时才 `mkdir`）。同一句话对任何「已接入但尚无对象」的类型都
成立，是**全类型共有的口径**而非 devlog 特有；改它要动 `localFactReader.directoryStatus`
与 `fact-source-metadata.test.ts` 的既有断言，属独立议题，故本轮如实登记不动。
实拍看到的就是这句提示 + 四枚终态筛选各 0 条。

> **2026-11-02 晚追记：这条边界已由 Human 定案修掉**。Human 就这两屏的问法是「都是
> 没有数据，为什么显示不一样」——于是它不再是「独立议题」，而成了要当场修的口径。
> 改动：`directoryStatus` 改为按零对象处理、`readLocalFact` 的精确读取改报 `not_found`、
> 空态文案分两句并本地化类型名。见 §4duodecies。

**未覆盖（如实登记）**：① `ldvh-base/devlogs/` 在本项目当前是空目录（0 个真实对象），
实拍用的是两条**临时夹具**（一 active、一 absorbed），截图后已删除——`git status` 确认
不残留；② 暗色模式实拍只覆盖列表页，两个详情页未拍暗色；③ `superseded` / `dropped`
两个终态的卡面与详情未造夹具实拍，其分支按 `absorbed` 的同一形态实现（`dropped` 多一个
`disposition` 节点）；④ 联邦视图下 devlog 列表未实拍（分派与导航已加，仅静态断言覆盖）。

## 4novies. 子目标详情：次序进身份头，阅读面只留判法（2026-11-02，Human 定案）

Human 定案 2026-11-02（附两张截图：子目标卡卡头「子目标 | ↺ 3」；详情面顶部黄绿锚点块
「次序 4 | 闭环记录 / 服务目标 project-goal / 判法：…」）：
「详细页面里也要有顺序的那个 icon，这个地方只保留判法即可，样式和达成条件一样，放到
名下工作上面」。

### 次序：进身份头，且必须是同一枚组件

此前 `order` 只住在详情面顶部锚点块里。那块本轮收窄为「只留判法」后，
次序若不同时上移，这个字段就在详情面上彻底消失了——它不是装饰，28 §8 把它列为可调整的
显示次序，读者要在详情里确认「这条排第几」。

故 `ObjectDetail` 的 `ObjectIdentityHeader` 在 `FrictionOccurrenceBadge` 之后、修改次数
之前挂 `<SubGoalOrderBadge value={source.order} />`，与列表卡卡头**同一枚组件、同一位置**
（类型 → 优先级 → 次序 → 修改次数）。不复用手写 chip：两处各写一份，缺失态（`·` +
tooltip）与「只接受正整数」的闭集处置就会分叉。

守卫同步改了指向：`subgoal-presentation-contract` 的「order 取代 anchor」一条，原先断言
**阅读布局**读 `obj.order`，现改为断言**身份头**读、且布局**不得**再读。不改的话，守卫
会逼着一处与本次定案相反的呈现复活——守卫钉的应是「次序有一处呈现」，不是「这处必须在
布局里」。

### 判法：自成一个正文节点，与达成条件同形

原来那行判法说明是锚点块里的一条 `ldvh-meta` 小字，现在改成 `AdrProseNode` 承载的独立
阅读节点（`ReadingNodeSection` + 正文 markdown），**与「达成条件」「对齐说明」完全同形**
——同一种节点卡片、同一档字号、同样可折叠。

- **标题是「判法」**（新增词条 `subgoal_kind_hint`），于是三条判法说明文案去掉了自带的
  「判法：」前缀（否则标题与正文各说一遍「判法」）。
- **判据类型的词不上屏**：此前锚点块里有一枚 `kindLabel` chip（「闭环记录」）。读者打开
  这一屏问的是「这条怎么判」，不是「它属于哪个分类」——把闭集名摆在最上面，答案却在下面
  那行说明里。删除后 `getFieldValueLabel('criterion_kind', …)` 在布局里不再被调用（词表
  本身保留：筛选、校验与卡面契约仍需它）。闭集外的 `criterion_kind` 没有判法可给，此时整
  节点不渲染，**不退而显示分类名**（28 §18 红线：不以类推定替代）。
- **位置在「名下的工作」正上方**，不是紧跟达成条件。它回答的是「这些工作按什么算齐了」，
  与紧接着列出的名下工作同属一个判断动作——读完判法，下一眼就是「那条判法对着哪些工作
  看」。夹在达成条件与对齐说明之间会把「凭什么归属这个目标」推到判法之后，打断归属叙事。

### 连带处置：锚点块里的第四样东西

原锚点块同时装着四样：次序、判据类型的词、服务目标、判法。前两样如上处置，后两样：

- **判法** → 独立节点（见上）。
- **服务目标（`parent_goal`）** → 身份头**辅助元信息行**（`AUXILIARY_META_KEYS_BY_TYPE.
  subgoal = ['parent_goal']`）。它是「这条属于哪个目标」的**归属事实**，与 `created_at`
  同级，不是「这条怎么算达成」的一段论证。登记进该表还有第二个作用：**同时从兜底字段区
  排除**——不登记的话它会以裸字段「parent_goal: project-goal」冒出来。
- 落地时踩了一次：该行标签显示为英文 `parent goal`（下划线换空格）。原因是
  `FIELD_LABEL_LOCALES` 里只有 `subgoal_parent_goal`，而元信息行按**frontmatter 键名**
  取标签（`getFieldLabel(key, locale, objectType)`），前缀命不中。修法是把词条改成裸键
  `parent_goal`——没有其它类型用这个字段名，裸键不歧义。**这是元信息行与阅读节点的差异**：
  阅读节点自己给标题（可以是任意词条），元信息行的标题由字段键推导。

### 连带后果：`DECISION_DETAIL_LIME_SHELL_CLASS` 退场

锚点块是这枚壳的**最后一个消费方**。它撤除后该常量无人读取，同轮删除；
`DECISION_SHELL_SEGMENTS` 删去其登记行、`border-l-*` 白名单 **8 → 6**。
`DECISION_TITLE_HUE_CLASS.lime` **保留**（`DevLogReadingLayout` 的时间轴节点用它作标题色相
——那是色相，不是壳；壳的定义特征是左色条）。

至此子目标在**卡面与详情面都不使用左色条**，§4septies 里登记的「卡面跟判据面板、详情面
留类型锚点」这条分岔已经收敛，不再有「唯一分岔类型」。

同时删除 `objectDetail.subGoalOrderAbsent` 词条：它唯一的消费方是那个锚点块。缺失态文案
统一由 `objectList.subGoalOrderAbsent` 承担——卡头与身份头用同一枚 chip，本来就不该有第二份。

### 验证

`subgoal-presentation-contract` 新增一项（详情身份头有次序 icon、且与修改次数同序；布局
不得再用黄绿锚点块、不得读 `order` / `parent_goal`、不得再拼判据类型的词；判法须经
`AdrProseNode` 且排在「名下的工作」之前；`parent_goal` 须登记为辅助元信息）；
「order 取代 anchor」一条改指身份头；`structure-single-source-contract` 删去 lime 详情壳
登记、白名单 8 → 6。

全量 web 用例 586 → **587 全绿**；`tsc -b` 通过；`npm run lint` 仅剩 HEAD 上既有的 1 个
warning；vite build + gzip-dist 重建。

Playwright 实拍三个子目标（`closure-records`/order 4/名下 2 条、`executable-check`/order 1/
名下 48 条、`closure-records`/order 2/名下 1 条）：身份头 chip 序列实测 `["子目标","4","3",
"推进中"]`（次序在修改次数之前），辅助元信息行显示「服务目标 project-goal」为中文标签，
阅读节点序列实测 `["达成条件","对齐说明","判法","名下的工作","修改流水","YAML 数据"]`，
判法与达成条件同形；暗色模式已实拍；控制台零错误。

**未覆盖（如实登记）**：① `order` 缺失态的详情实拍（现存四个子目标都带 `order`，未造
缺失夹具；该分支由 `SubGoalOrderBadge` 的既有断言覆盖，两个宿主共用同一组件）；②
`criterion_kind` 取闭集外值时的详情实拍（此时判法节点整块不渲染）；③ 面板（右侧扩展阅读）
里的子目标详情未单独实拍——它复用 `ObjectIdentityHeader` 与 `FactReadingContent`，与全页
详情同一条路径，但仅静态复用关系成立，非实拍。

## 4decies. 子目标呈现「火花落实」比值（2026-11-02，Human 定案）

Human 定案 2026-11-02：「sg 需要呈现一个进度条件，分母是关联的所有 spark，待处理 +
已落实，分子是已落实」。

### 先说这条与 28 §8.1 的关系（不是回避，是先划清）

§8.1 明文禁止两件事：**把拆解/落实情况存储为字段**、**把空集折算成「进度 0%」**。
本比值两件都不做：

- **不落盘**：分子分母每次从 `serves` 反查的 `serving_work` 行现算，派生仍由
  `facts.ts` 的 `deriveServingWorkIndex` 单点产出（§8.1 要求的正是这个方向）。
- **不折算空集**：分母为 0 时**不画条**，且分别给「名下没有火花」「火花均已废弃」
  「火花读取失败」三句不同的话——§8.1 那条歧义提示原样保留在它旁边，两者并存不冲突。

「进度」在这里是**对已存在引用的计数**，不是对「还没拆解」的猜测。区别可核：
每个数字都能按名下工作逐条数出来。故 §8.1 管的是「不得凭猜测造状态值」，不是
「不得呈现可核对的比值」——把两者混为一谈会让「名下有 31 条火花、9 条已落实」这个
本就写在事实里的关系永远无法出现在任何一屏上。

### 分母为什么排除已废弃

20 §9：`discarded` 是「废弃/被合并/被拆分」——它结束了一条火花，但**不代表这条子目标
少了一件该做的事**（责任已转移或明确放弃）。算进分母会让「处置掉一半火花」显示成进度
倒退，而那其实是处置进展。故分母严格按 Human 指定的两态：`open`（待处理）+
`implemented`（已落实）。

`implemented` 的语义也要如实对待：20 §9 明文「implemented ≠ 下游完成」，它只表示
这条火花的方向已落地。故分子只数它，**不因名下工单关闭而抬高**——有一条断言钉住这点
（三张已关闭工单 + 一条待处理火花 → 分子仍是 0）。

### 三种「算不出」必须各说各的

分母为 0 有三种原因，下一步动作完全不同：

| 情形 | 判据 | 文案要做的事 |
|---|---|---|
| `empty` | 名下没有 spark | 说清「分母为空，不是 0%」，指向「去拆解」 |
| `allDiscarded` | 有 spark 但全为 `discarded` | 说清「不计入分母」＋为什么（废弃≠那件事没了） |
| `unavailable` | `serving_unreadable` 里有 spark 失败 | 说清「读不到不等于没有」（00 §5.6） |

合成一句「暂无」会让读者把「读不到」读成「没有」——那是 00 §5.6 明令禁止的折算。
另有第四种：某条 spark 状态在闭集外（载体不合规或规范漂移）。此时**不猜它属于哪一档、
也不静默丢进分母**：排除出分子分母，并单独计数上报「N 条未计入」。

### 形态：条 + 分数，不给百分比

分数（`9 / 31`）才是可核对的东西；百分比是二次加工，看起来更精密，但分子分母都还得
读者自己去找。故条只承担「大致多少」，精确值一律给分数，旁边再给两档明细
（`已落实 9 · 待处理 22`）——它们相加等于分母，读者可以自己对账。

条为两段而不是单色填充：读者要看的是「还剩几件」而不是「完成了百分之几」。

### 位置：卡面在行之后，详情在行之前（刻意相反）

- **卡面**：放在 spark 那一组的行列表**之后**。先看到有哪几条，再看「其中多少已落实」
  才有意义；代价可接受，因为卡面每类只展 3 行。
- **详情面**：放在行列表**之前**。详情清单不折叠（实测一条子目标名下可到 48 条），
  把汇总放末尾等于放进没人滚到的地方——那不叫「先材料后结论」，叫「结论不可达」。

两种排布同一个目的：结论与材料同屏。同一次派生（`utils/servingSparkProgress.ts`），
两处不各算一遍。展开/收起**不改变**比值：分母是全部 spark，不是可见的 3 条——按可见
条数算会让「展开」这个动作本身改变进度值，那是交互制造出来的假象。

### 落地时踩的一处真错（如实记录）

第一版把 `groupServingWorkByType` 的返回值（`FactCardAssociation[]`）当作比值输入。
那一层已把 `ServingWorkItem` 投影成关联行形状，`status` 被换成了关联状态轴，于是
`type === 'spark'` 数出 0 条——**四张卡全部显示「名下没有火花」**。实拍时发现
（`LINES: ["名下没有火花…","名下没有火花…",...]`），改为读 `obj.serving_work` 原始行。
现有一条断言钉住这点：`assert.doesNotMatch(list, /rows=\{group\.rows/)`。

### 验证

新建 `subgoal-spark-progress.test.ts`（8 项）：分母口径、已废弃不进分母、三种算不出、
工单不混入、闭集外状态计数、分子不因工单关闭虚增、两处共用同一次派生且不读可见条数、
文案完整性。

全量 web 用例 587 → **595 全绿**；`tsc -b` 通过；`npm run lint` 仅剩 HEAD 上既有的
1 个 warning；vite build + gzip-dist 重建。

Playwright 实拍真实数据：四张子目标卡分别显示 `0 / 1`、`5 / 13`、`0 / 1`、`9 / 31`
（与 `ldvh-base` 里 spark 的 `serves` 分布一致：1429afe8 有 1 条 open、c8a2a574 有
5 implemented + 7 open + 3 discarded、01978a8b 有 1 open、befe1735 有 9 implemented +
22 open + 11 discarded）；详情面 `9 / 31` 与两档明细并列在「名下的工作」标题下方；
控制台零错误。

**未覆盖（如实登记）**：① `empty` / `allDiscarded` / `unavailable` 三种态的**实拍**
未做——现存四条子目标都有 spark，未造反例夹具；这三种由纯函数断言覆盖（行为级），
但渲染形态未目视确认；② 比值条未做无障碍走查（`role="img"` 与 `aria-label` 已给，
未用读屏验证）。暗色模式已实拍：两段条与两档明细在暗底下均清晰，「已落实」段用
`bg-ldvh-accent/85`（该 token 浅暗两套值），底槽 `bg-ldvh-border/70` 也随主题。

## 4undecies. 规范卡与规范详情撤除方向键呈现（2026-11-02，Human 定案）

Human 定案 2026-11-02（附两图：图一是规范列表卡，图二是该卡详情的首块）：「规范 card，
框出来的不需要显示，图二是详细内容，框出来的也不需要显示」。框内分别是**卡面的方向键块
（含类型说明行）**与**详情面的方向键节点**。

### 两侧撤的是同一件事

两侧的块都以「`direction_key` 是 27 §8 的机器可验证方向标识」为由置顶呈现。这个理由
**不成立**：方向键是**唯一性公式与索引的作用域**（27 §11 三层机械承载），不是读者在
列表里挑条目、或在详情里判断「这份规范管哪个方向」的依据。后者由标题与正文首段「方向
定位与适用范围」的散文回答——那是一句人话，`local-dev-workflow` 不是。

### 卡面：卡体撤空，回到 ADR 同形

活跃规范卡此后**不承载任何卡体内容**，只剩卡头（类型 / 标题 / 状态 / 修改次数）与标题。
`NormCardContent` 与 `AdrCardContent` 同形：活跃态返回 `null`，只留终态卡。这不是漏写
卡体——本类型的正文是四段成体系长文（方向定位与适用范围／核心规则体系／约束与反模式／
验证与遵从性检查），列表格子里读不成体系，它住在详情页阅读布局。

### 类型说明行：同一壳里的第二处类型定义

原卡面方向键块下方还有一行 `getTypeDescription('norm')`＝「事实规范——一个工程方向的
成体系规则体系（27 §1）」。它撤除的**理由与方向键不同**，须分开记：

- 它是**类型定义的复述**。卡头 chip 已写「规范」，把同一结论再用一句话重说，属
  `docs/10` §5.5「同类信息只有一处行式」的违规。
- 它能存活至今，是因为与方向键同处一个壳里，被当作「这个块的说明」而非「类型的说明」。
  **壳一撤，它的真实身份就露出来了**——这类「寄居在合规块里的第二处来源」，仅在拆壳
  时才会显形，故记在此处供后人对照。

### 详情面：整节点删除，缺失提示一并删除

`NormReadingLayout` 的第一个节点（`DECISION_DETAIL_NEUTRAL_SHELL_CLASS` + 方向键标题 +
`DECISION_VIOLET_CODE_CHIP_HUE_CLASS` 的等宽 chip）整块删除，布局直接从正文首段开始。
**缺失提示 `objectList.normDirectionKeyMissing`（「方向键缺失」）也删除**：缺
`direction_key` 属**载体不合规**，读取层已按字段契约为它产出 `field_issues`（`missing`），
由 `FieldIssuesSection` 如实报出；页面另写一句提示是同一事实的第二处呈现，且它把
「字段缺失」伪装成了「这条规律值得单独说一句」。

### 连带退场（内容撤则壳撤，一条纪律管三处）

同一天三次撤壳，判据相同——**壳比内容活得久，是本仓反复出现的形态**（内容被判定不该
上屏后，壳常以「它是家族成员」为由单独留存）：

| 撤除 | 触发 | 结果 |
|---|---|---|
| `DECISION_CARD_SHELL_CLASS.lime` | 子目标卡面改判据面形态（§4septies） | 白名单 10 → 8 |
| `DECISION_DETAIL_LIME_SHELL_CLASS` | 子目标详情锚点块撤除（§4novies） | 8 → 6 |
| `DECISION_CARD_SHELL_CLASS.violet` | 本节点（活跃规范卡体撤空） | 6 → **4** |
| `DECISION_TITLE_HUE_CLASS.violet` | 方向键标题的两处消费方皆撤 | 色相表剩 amber / lime |
| `DECISION_VIOLET_CODE_CHIP_HUE_CLASS` | 方向键那枚 code chip 撤除 | 整条删除 |
| `TYPE_DESCRIPTION_LOCALES` + `getTypeDescription` | 唯一上屏点（规范卡类型说明行）撤除 | 11 条词条全表删除 |
| `objectList.normDirectionKeyMissing` | 详情缺失提示撤除 | 中英各一 |

`DECISION_CARD_SHELL_CLASS` 现为 `Record<'amber', string>`——**保留 `Record` 形态不降为
裸字符串**：调用处写 `…CLASS.amber`，语义是「取该色相的卡面壳」，改形会牵动消费方，且
下一枚色相回来时又要重写。键集是证据（当前只有一个领域用左色条卡面），不是待膨胀的白名单。

`TYPE_DESCRIPTION_LOCALES` 的删除另有一条值得记的账：全表 11 条里**只有 `norm` 一条曾
真正上屏**，其余 10 条自 v4 平移以来一直是死的。撤掉呈现却留着词表，「不呈现」这个决定
就没有落点（同 §4quater 的辅助元信息表出列理由）。

### 已知不一致：如实登记，不擅自择一

`DECISION_DETAIL_NEUTRAL_SHELL_CLASS` 的左条是 `border-l-violet-400/70`（紫），而它现存
唯一消费方 `DevLogReadingLayout` 的时间轴节点把**标题**写成 `DECISION_TITLE_HUE_CLASS.lime`
（黄绿）——同一块里左条与标题不同色相；而 DevLog 的类型色是 `#ca21a0`（magenta），两者
都不等于 lime。本次**不动它**：改左条色相是未被请求的视觉变更。正确修法任选其一——
把左条并进与本块标题同一色相，或让该块改用四边同宽壳（它已不含「领域归属」语义，本不该
留在本家族）——两者都需 Human 裁决，故只登记。

### 验证

- 守卫反转（正向断言会让「加回来」永不红）：`friction-norm-presentation-contract` 的
  「norm list cards…」与「object detail routes norm…」两项，均改为**断言撤除结果**
  （卡体 `doesNotMatch(/direction_key/)`、布局 `doesNotMatch(/direction_key/)` 与
  `doesNotMatch(/normDirectionKeyMissing/)`），并各留一条正向断言钉住替代形态（卡体
  「return null」、布局首节点是正文首段）。
- `structure-single-source-contract`：`DECISION_SHELL_SEGMENTS` 删 violet 行、
  `DECISION_ATOMS` 删 violet 与 violet chip 两行、防假单源不再要求 ObjectList 引用
  violet 壳、`border-l-*` 白名单 6 → 4。
- 全量 web 用例 595 全绿；`tsc -b` 通过；`npm run lint` 仅剩 HEAD 上既有的 1 error
  （`facts.ts` 的 `currentProjectProjectionIndexes` 未使用，非本轮引入）+ 1 warning。
- 实拍（浅色 + 暗色）：规范列表卡卡头 `["规范","10","生效中"]`、卡体无方向键块、无类型
  说明行；详情页首节点直接是「方向定位与适用范围」，无方向键节点、无缺失提示；控制台零
  错误。

**未覆盖（如实登记）**：① **`direction_key` 缺失态的实拍未做**——现存两份规范都带方向
键，未造不合规夹具；该态的行为由读取层 `field_issues` 承担，本轮只删了页面侧的第二处
提示，未验证 `FieldIssuesSection` 对该字段的实际渲染形态。② 方向键被撤后，**「同一方向
是否已有 active 规范」在 Web 上不再有直接的肉眼入口**——27 §11 的第三层（消费端
fail-closed 报 `direction_collision`）由 CLI 承载（`plugin/lib/norm-tools.js` 的
`ldvh_norm_list`），第二层由 Git Gate 承载（`plugin/lib/commit-validation.js` 的
`facts/norm_direction_collision`）。**已核查：Web 投影层没有该诊断**（`plugin/web/` 全树
除本文档外无 `direction_collision` 命中）。这是本轮之前就存在的边界、不是撤方向键造成的，
但撤除让它在界面上更难被察觉，故记在此。

## 4duodecies. 空事实类型：目录缺失不再等于「类型未接入」（2026-11-02，Human 定案）

Human 附两屏截图并问：「都是没有数据，为什么显示不一样？」

- **开发日志**（本仓 0 条 DevLog，`ldvh-base/devlogs/` 尚未被 writer 建出）→ 琥珀警示
  「该事实类型尚未接入」+ 正文空态**同一句话**（两遍）；
- **规范 · 已退役筛选**（2 条 active 规范在，但都不匹配该筛选）→「未找到 norm 对象」。

### 判据根本不是「有没有数据」

查下来是 `api/services/localFactReader.ts` 的 `directoryStatus`：

```ts
function directoryStatus(scope, type) {
  if (existsSync(baseDirOf(scope, type))) return null
  return { status: 'type_not_integrated', items: [], issues: [...] }
}
```

**实测反证**：临时 `mkdir ldvh-base/devlogs`（空目录）后，同一个请求立刻从
`coverage_status: type_not_integrated` 变成 `complete` + `items: []` + `issues: []`。
也就是说这条警示的**唯一**判据是目录在不在——一个由写入器按需 `mkdir` 的实现细节。

两句话都不准确，且错的方向相反：

| 位置 | 原话 | 错在哪 |
|---|---|---|
| 目录缺失（devlog） | 「该事实类型尚未接入」 | 类型**早已完整接入**（后端类型面、导航、卡体、详情布局、词表都在），只是零对象——这是**假话** |
| 目录在但筛选为空（norm） | 「未找到 norm 对象」 | 把「筛选没命中」说成「这个类型没有对象」——对真未接入的类型是**漏报**；且 `{type}` 传的是原始键，中文界面里冒出 `norm` |

### 新口径：目录缺失 = 零对象

`localFactReader.ts` 新增 `emptyTypeDirectory()`：目录缺失时返回
`{ status: 'complete', items: [], issues: [] }`。三条理由按强度排列：

1. 「未接入」是关于**代码**的断言（这个类型在读取/投影/呈现层有没有支持），目录存在性
   只能回答关于**数据**的问题。用数据事实报代码事实，两个都答错。
2. 类型接入是**编译期事实**：`LocalFactType` 成员、`FACT_TYPE_DIRS` / `FACT_TYPE_CARRIERS`
   的登记都在源码里，缺登记根本进不了这个函数。故 `type_not_integrated` 在运行期**不可能**
   是正确的答案。
3. 目录由写入器按需创建，是**可恢复的瞬时状态**，报成阻塞级结论等于要求 Human 先手动
   建目录才能看到「还没有对象」这句真话。

**撤的是判定，不是状态值**：`LocalFactList.status` 的 `'type_not_integrated'` 成员保留，
`facts.ts` 的 `notIntegrated()` 也保留（前端契约 `FactCoverageStatus` 有该成员、三个筛选器
按它显示 `—`、列表页有覆盖警示分支）。未来若真出现「有目录契约但无读取支持」的类型，
它才是正确答案。

`readLocalFact` 同步收窄：目录缺失时的精确读取返回 `not_found`（不再
`type_not_integrated`），并照样带回 `canonical_path`——读者据此能看出目录还没建过。

### 空态文案分两句，类型名本地化

`ObjectList.tsx` 的兜底空态此前一律 `t('objectList.noObjects', { type: currentType })`。
现在按 `statusTotal`（服务端按**未应用状态筛选**的池子计数）分两句：

- `statusTotal === 0` → 「还没有{type}对象」——这个类型本来就没有，下一步是去建；
- 否则 → 「当前筛选条件下没有{type}对象」——对象有，是筛选挡掉了，下一步是放宽筛选。

**为什么不用 `items.length` 判**：那正是被筛过的结果，用它判会把「筛选后为空」误报成
「本来没有」——正是本次要修的两句话之一。

`{type}` 一律经 `getTypeLabel(currentType, locale)`：此前直塞 `currentType`，中文界面里
露出 `norm` / `devlog` 这类原始键。

### 已知边界（如实登记）

- **空目录与目录缺失在 Web 上给出同一句话**。这是有意的：对读者而言两者是同一件事，
  区分它们只会把实现细节再泄漏一次。
- 目录缺失时，「这个类型有过对象、后来目录被删了」与「从未有过对象」仍不可区分。后者是
  正常路径，前者是载体被误删——两者在读取层都无法判定（没有目录就没有证据），故不冒充
  能区分。

### 验证

新建 `tests/api/empty-fact-type-presentation.test.ts`（6 项）：目录缺失报 complete / 缺失与
空目录结果逐字段相等 / 精确读取返回 not_found 且带回 canonical_path / 列表投影无 issue /
两句文案存在且可区分 / 空态分支用 `statusTotal` 且走 `getTypeLabel`。

改 `tests/api/fact-source-metadata.test.ts` 的既有断言（原要求
`coverage_status === 'type_not_integrated'`），改为断言 `complete` + 空列表 + 无 issue，
并在注释里记明「旧断言把目录存在性钉成了契约」。

全量 web 用例 595 → **601 全绿**；`tsc -b` 通过；`npm run lint` 仅剩 HEAD 上既有的 1 error
（`facts.ts` 的 `currentProjectProjectionIndexes` 未使用，非本轮引入）+ 1 warning。

实拍与接口实测：`GET /ldvh/api/objects/devlog` 现返回 `coverage_status: complete`、
`items: []`、`issues: []`（改动前为 `type_not_integrated` + 一条 issue）；页面顶部不再出现
琥珀覆盖警示，空态只剩一句。

**未覆盖（如实登记）**：① 「目录在但为空」的真实对象类型未实拍——本仓九类目录里唯一
可能为空的 devlogs 目录本身不存在，故实拍只覆盖「目录缺失」这一侧；该侧与新口径是新
一致的那侧，空目录侧由上面「逐字段相等」的断言承担。② 英文界面只验证了词条存在，未实拍。

## 4terdecies. 卡体主块改按**本类型色**上色（2026-11-02，Human 定案）

Human 附两张截图，圈出两张卡的卡体主块，说：「圈出来的要和类型的颜色对上，也就是同一个色系的」。

- **子目标卡**：卡头类型 chip 与次序 icon 是 lime `#84cc16`，被圈的主块是**蓝面**；
- **开发日志卡**：卡头类型 chip 是 magenta `#ca21a0`，被圈的主块**同样是蓝面**。

### 那个蓝是 WorkCase 自己的类型色，不是「判据面通用色」

起因可查：当天更早的定案是「子目标判据框**样式**对齐 workcase 的」，照抄时把**整面**
（`WORKCASE_CRITERIA_SURFACE_CLASS` = 蓝边框 + 蓝淡底 + 蓝灰正文）抄了过来。那次定案要
的是**几何**（四边同宽 1px、无左粗线、8px 圆角、8/12 内距），几何对齐成立；但整面照抄
把一条副属性——「WorkCase 是蓝的」——当成了这一类面的定义。

于是出现「同一张卡上两个色相各说各话」：卡头 chip 声明类型，主块声明另一个类型。读者
看到的第一反应不是「这块属于子目标」，而是「这两个颜色哪个说对了」。

### 修法：几何仍同源，色相从类型色算

新建 `src/utils/typeSurface.ts`（类型色语义面的单一来源）：

- `getTypeSurfaceTint(type)` 返回 `{ surface, body }` 两包 CSS 属性；
- 色相取自 `getCategoryColor(type)` —— **与卡头 chip 同一张色表**，不存在第二张；
- 几何仍取 `WORKCASE_SURFACE_GEOMETRY_CLASS`（消费方各自 import 那个常量）。

**为什么用 `color-mix()` 而不登记一张 9 类 × 2 模式的 Tailwind 色表**：两条否决理由
都不是口味问题。

1. **Tailwind 色相板与类型色不是同一套值**。类型色是 hex（`devlog` = `#ca21a0`，色相
   315°），最近的 Tailwind 色是 `fuchsia`（292°）或 `pink`（330°）——用类名就得二选一，
   两者都偏离 15° 以上，而卡头 chip 用的是精确 hex，并排会读出**两种紫红**。
2. **正文档位需要「该色相更深但低饱和」**（`docs/01` §1.6）。9 类 × 明暗 = 18 条手调
   字面量，下一次调档只会改到其中一部分——正是本仓反复出现的「两处各写一套」病。

`color-mix(in oklab, …)` 让「同一个色系」由**计算**保证而非由抄写保证。三个比例常量
（`TYPE_SURFACE_BORDER_MIX` = 30 / `TYPE_SURFACE_BACKGROUND_MIX` = 5 /
`TYPE_SURFACE_TEXT_MIX` = 58）是**实现自选值**，不是人类定案——故由可复算的对比度判据
兜住（见下）。

### 踩到并修掉的坑：Markdown 的 `<p>` 不继承外层 color

第一版给外层 `div` 设 `style={{ color }}`，实拍发现**块内正文仍是近黑**：DevLog 卡体
走 `SummaryText`（`react-markdown`），渲染出的 `<p>` 由 `github-markdown-css` 按
`--fgColor-default` 着色，**不继承**外层 color。子目标判据面不走 Markdown（直接插值
字符串），所以同一改动在两张卡上表现不同——只看其中一张会以为改对了。

修法：`SummaryText` 增加 `bodyStyle` 口，把色传到 `.ldvh-inline-markdown` 上，由它
经继承交给 `<p>`。实测 `p` 的 computed color 已随类型色变化（`oklab(0.422 0.127 -0.0456)`）。

### 对比度：九类 × 两主题都由判据兜住

`tests/api/type-surface-contract.test.ts` 复算每条组合：背景取**卡片底色 + 5% 类型色
叠加后的实际背景**（不是页面底色——卡片是 `--ldvh-panel`，浅色下是纯白而非 `#f8f9fb`），
正文取 oklab 混合结果，阈值 **4.5:1**（判据正文 12px，属小字号正文，不按 3:1 放宽）。

实测九类结果（light / dark）：workcase 7.26 / 6.88、adr 7.58 / 6.73、pitfall 7.37 / 6.79、
spark 4.77 / 8.12、research 5.69 / 7.62、friction 6.13 / 7.41、norm 7.89 / 6.59、
subgoal 4.87 / 8.07、devlog 8.68 / 6.20。**最低是 spark 的 4.77:1**，全线过线。

### 与既有定案的关系（不越界）

- **2026-11-02「样式对齐 workcase」的几何部分继续成立**：四边同宽 1px、8px 圆角、
  8/12 内距、无左粗线，一条不改。
- **WorkCase 自己的判据面保持蓝**：那本来就是它的类型色。本契约带一条反向断言钉住它，
  防止有人读成本文是「所有判据面都染各自的类型色」而顺手把 WorkCase 也改了。
- **不引入左色条**：`typeSurface` 只产出 CSS 属性（不拼 class 串），故不可能带
  `border-l-*`；契约里也钉了这条。

### 已知边界（如实登记）

- **`color-mix()` 的浏览器门槛**：Chromium 111+ / Safari 16.2+ / Firefox 113+。不支持时
  三个属性整条失效——边框退回 `currentColor`、底色透明、正文继承 `--ldvh-text-primary`，
  即降级成无染色的可读块。这是选它而不选「远端色表」的另一个理由，但**未做旧浏览器实拍**。
- **未覆盖**：仅实拍子目标与开发日志两类（Human 指出的两类），其余七类是**由判据算出**
  的，未逐一实拍；英文界面未单独实拍。
- **与 `docs/01` §1.6 的关系**：该条要求「标题、正文与背景同色相」，本模块只覆盖**正文
  与背景**；这两张卡的卡体无彩色标题（子目标判据框只剩一句、DevLog 卡体只有 summary），
  故不涉及。
