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
| 子目标详情 | `/objects/subgoal/:id` | 28 号阅读布局：身份头 chip（类型 → 优先级 → **次序** → 修改次数，次序与列表卡卡头同一枚组件）＋ 达成条件 → 对齐说明 → **判法** → 名下工作（serves 反查派生）→ 修订史；`parent_goal` **不呈现**（2026-11-02 定案，见 §4quindecies） |
| 开发日志列表 | `/objects/devlog` | 29 号 F1：卡头 chip（类型 → **发生时间** → 修改次数）＋ `summary` 一句（折叠阈值 420）；默认只列 active，三枚终态各自成筛选项 |
| 开发日志详情 | `/objects/devlog/:id` | 29 号阅读布局：~~时间轴（发生时间 / 条目形成时间分开）→~~ 结论与边界 → 去向 → 背景 → 做法 → 实测 → 承接边 → 修订史（时间轴节点 2026-11-02 撤除，§4sexdecies） |
| 联邦聚焦 | `/federation` | 跨项目聚合、项目统计、跨项目火花 |
| 联邦对象 | `/federation/objects/:type` | 跨项目对象列表、项目源 chip |
| 项目文件 | `/project-files` | 保留 v4 语言 |
| 变更日志 | `/changelog` | 保留 v4 语言 |
| 帮助 | `/help` | 静态导览页：上方概览 + 下方 sticky tab 切四主题；不读事实源、无写入口、无数据请求（§7） |

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
> `DECISION_TITLE_HUE_CLASS.lime` 这一枚**色相原子**——它当时的唯一消费方是
> `DevLogReadingLayout` 的时间轴标题，与「子目标该是什么颜色」已无关系。本段关于
> 「子目标不该借用 amber/violet」的论理仍然有效且未被推翻，但它所记录的那次加色相
> 作为**视觉决策**已被两轮 Human 定案整体回收：子目标在两个面上都不再用 lime 壳。
>
> **又被下一轮推翻（2026-11-02 更晚，见 §4sexdecies）**：上面那句「只剩
> `DECISION_TITLE_HUE_CLASS.lime` 这一枚色相原子」也已不成立——DevLog 详情的时间轴
> 节点整块撤除后，`lime` 键随之从 `DECISION_TITLE_HUE_CLASS` 删除，色相表收窄为
> `Record<'amber', string>`。**本族至此只剩卡面琥珀一条**，三枚色相与两枚详情面壳
> 全部退出。下方「本段论理仍然有效」仅指子目标为何不该取 amber/violet 的论理，不再是
> 「lime 仍在别处活着」的凭据。

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

> **2026-11-02 二次定案**：`DevLogOccurredBadge.tsx` 已整文件退场（卡头 chip 撤除，
> 它无第二个消费方）。上条「呈现 4 处」因此少一处——按本文档的记录纪律，这里
> **加追记而不删原文**。

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

~~卡头多一枚 `occurred_at` chip（`DevLogOccurredBadge`），排在修改次数之前。~~
**2026-11-02 二次定案：卡头那枚 chip 撤除**（Human 定案「圈出来的部分不用显示」）。
`occurred_at` 是**这件事发生的时间**、`created_at` 是**条目形成的时间**，29 §10.4
要求的始终只是二者的**语义分工**（不得用 `created_at` 冒充发生时间）——**从未要求
「卡头必须给 occurred_at」**。撤除的理由：它是排序轴与回查轴（29 §12.1「时间线
回查」由按 `occurred_at` 排序的条目清单承担），不是逐卡必显的身份信息；条目在自己的
卡面上重复给出它已经记下的时间，没有新增任何可读信息。`DevLogOccurredBadge`
随该决定一并退场（它只有一个消费方，留着就是无人消费的壳）。29 §10.4 已同步订正。

> **2026-11-02 追记（§4sexdecies）**：本节初稿把 29 §10.4 读成了「要求分开呈现」，
> 并据此在详情页做了一条同时给两个时间的**时间轴节点**。**该措辞是本文档自述，
> 不是规范原文**：`grep 分开呈现|两个时间` 在 specs/29 为 **0 命中**，§10.4 只要求
> 语义分工。更关键的是它在呈现层站不住——**两个时间各有别的承载位**：`occurred_at`
> 由本节的卡头 chip 承担（列表是时间线回查入口，29 §12.1），`created_at` 由
> change_log 首条与详情底部 YAML 原文承担（身份头渲染的 `updatedAt` 是 change_log
> **末条**，从来不是 created_at）。故详情页那处并排呈现已整块撤除。
> **本节关于「卡头必须给 occurred_at」的全部论理不受影响**——被撤的只是详情页那次
> 重复呈现，卡头那枚 chip 仍在本节所述的唯一位置上。
>
> **2026-11-02 二次定案补记**：上面那句「卡头那枚 chip 仍在本节所述的唯一位置上」
> **已被推翻**——那枚 chip 也在同日撤除（Human 定案）。原文「两个时间各有别的承载位」
> 仍然成立，只是 `occurred_at` 的承载位从「卡头 chip」改为「按 `occurred_at` 排序的
> 条目清单」（29 §12.1）；29 §10.4 已据此订正。**教训**：`occurred_at` 的语义分工
> 要求（§10.4）与它在呈现面上的落点（§13.1）是两件事——前者是规范要求，后者由
> §13.1 与 07 号决定；把落点写进「要求」的论理里，等于给自己埋一个将来要推翻的
> 前提。

### 详情：阅读次序 ≠ 书写次序

`DEVLOG_BODY_SECTION_ORDER = ['结论与边界', '去向', '背景', '做法', '实测']`。
载体里的书写次序是 29 §8 那五段（背景 → 做法 → 实测 → 结论与边界 → 去向），
**阅读次序把结论提到最前**：读者打开一条 DevLog 要的是结论，而背景/做法/实测是
依据。这不是「重新排列正文」——解析器按 H2 标题取值，次序只影响渲染顺序。

三处显式标注（都不是可选文案）：

1. ~~**时间轴节点**同时给 `occurred_at` 与 `created_at`，各带自己的标签~~ ——
   **2026-11-02 撤除**（§4sexdecies）；
2. **空集歧义**（29 §8.1）：无 `serves` 时标注「未声明或不属于任何子目标」，并说明
   「确实不属于」与「未声明」在机械层不可区分——**不得写成「无主题」**，那会把歧义
   压成一个确定结论；
3. **压缩形态**（29 §9.1）：`absorbed` 条目正文只剩两段，渲染时显式说明「已被承接，
   正文压缩为『结论与边界』与『去向』两段」——不静默少三段，否则读者会以为内容丢了。

> **2026-11-02 后第 1、2 项均已撤除**（§4sexdecies），只剩第 3 项。
> 第 1 项是那次撤除的主体。第 2 项不是独立需求，而是挂在同一节点下方的 `serves`
> 空集提示；撤它的判据与 `serves` 2026-11-01 出列（§4quater）同源——该字段自那时起
> 在 DevLog 的任何呈现面都不再出现，于是「它的值缺失」也只能从**它缺席**推得；为一个
> 已不在屏上的字段写一句「它没填」，是把读者没在问的问题答了一遍。**29 §8.1 那条
> 「须由呈现面显式提示」的义务已在规范侧一并修订**，故此处的撤除是规范同步而非违规。
> 第 3 项（压缩形态）不受影响——它标注的是**正文少了两段**，与 `serves` 无关。

承接边（`absorbed-into` 的 commit 形态）走既有 `FactAssociationsSection`：`facts.ts`
的 `projectFactCardAssociations` 早已支持 `{commit}` 形态目标（读提交标题、`available:
true`、短哈希），**不新写解析**。实拍确认 absorbed 条目关联区显示 `6c43770`。

### 类型色：`#ca21a0`（magenta，色相 315°）

> **2026-11-03 改判（见 §4vicies）**：本节记录的 magenta 取值已由 Human 定案改为冷色系
> 青绿 `#2c9e43`（色相 132°）。下文是当时的定案原文，作为历史留存——「取最大空隙」与
> 「不用中性灰」这两条**方法**仍然成立，改的只是候选带的选择（冷色带里不含 magenta）。

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
已被推翻 0 / 不再承重 0 / 全部 2；详情面确认压缩形态说明、承接边 `6c43770`；控制台零错误。

> **2026-11-02 追记**：本段实拍当时记的「详情面确认时间轴节点两个时间并列、serves 行、
> 空集歧义提示」三项**均已随 §4sexdecies 撤除**——那是本轮定案前的实测记录，如实留在
> 此处作为该形态曾经上屏的凭据，不再代表现状。

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
- **服务目标（`parent_goal`）** → 当时移入身份头**辅助元信息行**（`AUXILIARY_META_KEYS_BY_TYPE.
  subgoal = ['parent_goal']`）。**该处置已被下一轮定案推翻**：2026-11-02 稍后 Human 圈出
  那一行截图，要求「圈出来的不用显示」——它现在**在任何一屏都不呈现**，见 §4quindecies。
- 落地时踩了一次：该行标签显示为英文 `parent goal`（下划线换空格）。原因是
  `FIELD_LABEL_LOCALES` 里只有 `subgoal_parent_goal`，而元信息行按**frontmatter 键名**
  取标签（`getFieldLabel(key, locale, objectType)`），前缀命不中。修法是把词条改成裸键
  `parent_goal`——没有其它类型用这个字段名，裸键不歧义。**这是元信息行与阅读节点的差异**：
  阅读节点自己给标题（可以是任意词条），元信息行的标题由字段键推导。（该词条随后随整行
  撤除一并删除，见 §4quindecies。）

### 连带后果：`DECISION_DETAIL_LIME_SHELL_CLASS` 退场

锚点块是这枚壳的**最后一个消费方**。它撤除后该常量无人读取，同轮删除；
`DECISION_SHELL_SEGMENTS` 删去其登记行、`border-l-*` 白名单 **8 → 6**。
`DECISION_TITLE_HUE_CLASS.lime` 当时**保留**（`DevLogReadingLayout` 的时间轴节点用它作标题色相
——那是色相，不是壳；壳的定义特征是左色条）。**该保留已在同日更晚被推翻**：DevLog 详情
时间轴节点整块撤除（§4sexdecies），`lime` 键随之删除，色相表只剩 `amber`。这里的判据表述
「色相 ≠ 壳」仍然正确，只是那枚色相自己的消费方也没了。

至此子目标在**卡面与详情面都不使用左色条**，§4septies 里登记的「卡面跟判据面板、详情面
留类型锚点」这条分岔已经收敛，不再有「唯一分岔类型」。

同时删除 `objectDetail.subGoalOrderAbsent` 词条：它唯一的消费方是那个锚点块。缺失态文案
统一由 `objectList.subGoalOrderAbsent` 承担——卡头与身份头用同一枚 chip，本来就不该有第二份。

### 验证

`subgoal-presentation-contract` 新增一项（详情身份头有次序 icon、且与修改次数同序；布局
不得再用黄绿锚点块、不得读 `order` / `parent_goal`、不得再拼判据类型的词；判法须经
`AdrProseNode` 且排在「名下的工作」之前；`parent_goal` 须登记为辅助元信息——**这一条
已被 §4quindecies 反向改写为「不得再登记」**）；
「order 取代 anchor」一条改指身份头；`structure-single-source-contract` 删去 lime 详情壳
登记、白名单 8 → 6。

全量 web 用例 586 → **587 全绿**；`tsc -b` 通过；`npm run lint` 仅剩 HEAD 上既有的 1 个
warning；vite build + gzip-dist 重建。

Playwright 实拍三个子目标（`closure-records`/order 4/名下 2 条、`executable-check`/order 1/
名下 48 条、`closure-records`/order 2/名下 1 条）：身份头 chip 序列实测 `["子目标","4","3",
"推进中"]`（次序在修改次数之前），辅助元信息行当时显示「服务目标 project-goal」（该行已于
§4quindecies 撤除），
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

> **本段已被第八节第 8 条改写**：两档明细整段撤除（它是分数的算术展开，不是新信息），
> 分数再弱一档。原文保留以记「先有、后撤」的过程。

条为两段而不是单色填充：读者要看的是「还剩几件」而不是「完成了百分之几」。

**那一行说明的排布（2026-11-03 Human 定案）**：指标名 + 分数 + 两档明细这一行**居中**
（浮在满宽条的正上方，条本身仍满宽），且**整体弱化**——分数取次级色而非主色，指标名与
两档明细再降一档。它是这一块的**注解**，不是这一块的标题：左对齐贴边 + 近黑分数时，
它读起来像卡上的一个独立小标题，与它实际承担的角色不匹配。口径不因弱化而丢失——完整
说法仍在条的 `aria-label` 上（「火花落实 9 / 30」）。聚焦页目标区的**行内形态**另有
一套更紧的排布（数字在上、条在下、`w-24` 定宽），见第八节。

> **本段已被第八节第 6、8 条改写**：第 6 条把这一行居中并弱化；第 8 条进一步撤掉两档
> 明细、并把分数由次级色降为次级色的七成。

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
| `DECISION_CARD_SHELL_CLASS.violet` | 本节点（活跃规范卡体撤空） | 6 → 4 |
| `DECISION_TITLE_HUE_CLASS.violet` | 方向键标题的两处消费方皆撤 | 色相表剩 amber / lime |
| `DECISION_VIOLET_CODE_CHIP_HUE_CLASS` | 方向键那枚 code chip 撤除 | 整条删除 |
| `TYPE_DESCRIPTION_LOCALES` + `getTypeDescription` | 唯一上屏点（规范卡类型说明行）撤除 | 11 条词条全表删除 |
| `objectList.normDirectionKeyMissing` | 详情缺失提示撤除 | 中英各一 |
| `DECISION_DETAIL_NEUTRAL_SHELL_CLASS` | **同日第四轮**：DevLog 详情时间轴节点撤除（§4sexdecies） | 白名单 4 → 2，仅余卡面琥珀 |
| `DECISION_TITLE_HUE_CLASS.lime` | 同上（时间轴标题是其唯一消费方） | 色相表收窄为 `Record<'amber', string>` |

`DECISION_CARD_SHELL_CLASS` 现为 `Record<'amber', string>`——**保留 `Record` 形态不降为
裸字符串**：调用处写 `…CLASS.amber`，语义是「取该色相的卡面壳」，改形会牵动消费方，且
下一枚色相回来时又要重写。键集是证据（当前只有一个领域用左色条卡面），不是待膨胀的白名单。

`TYPE_DESCRIPTION_LOCALES` 的删除另有一条值得记的账：全表 11 条里**只有 `norm` 一条曾
真正上屏**，其余 10 条自 v4 平移以来一直是死的。撤掉呈现却留着词表，「不呈现」这个决定
就没有落点（同 §4quater 的辅助元信息表出列理由）。

### 已知不一致：如实登记，不擅自择一

`DECISION_DETAIL_NEUTRAL_SHELL_CLASS` 的左条是 `border-l-violet-400/70`（紫），而它当时
唯一消费方 `DevLogReadingLayout` 的时间轴节点把**标题**写成 `DECISION_TITLE_HUE_CLASS.lime`
（黄绿）——同一块里左条与标题不同色相；而 DevLog 的类型色是 `#ca21a0`（magenta；
2026-11-03 已改判为青绿 `#2c9e43`，见 §4vicies），两者都不等于 lime。本次**不动它**：改左条色相是未被请求的视觉变更。正确修法任选其一——
把左条并进与本块标题同一色相，或让该块改用四边同宽壳（它已不含「领域归属」语义，本不该
留在本家族）——两者都需 Human 裁决，故只登记。

> **2026-11-02 收尾（§4sexdecies）**：这处争议**已被撤除消解，不必再裁决**。Human 定案
> 「圈出来的部分不用显示」，该块整块删除，`DECISION_DETAIL_NEUTRAL_SHELL_CLASS` 随之
> 失去最后一个消费方并删除。上面两个「正确修法」都失去了对象——左条不存在了，也没有
> 哪个块还需要「改用四边同宽壳」。**这是登记式处置的一种正当结局**：登记时说的是「需
> Human 裁决」，而 Human 的裁决是「此块不必存在」，于是争议连同载体一起退场。
> 该常量原位留下了踪迹注释（含这条争议的去向），理由与 `DECISION_VIOLET_CODE_CHIP_HUE_CLASS`
> 相同——它的名字出现在旧守卫登记与 `docs/01` §1.10 第 7 条的家族讨论里，从旧注释追来
> 的读者应当能查到它去了哪里。

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
- **开发日志卡**：卡头类型 chip 是 magenta `#ca21a0`（当时取值；2026-11-03 改判为青绿
  `#2c9e43`），被圈的主块**同样是蓝面**。

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
   （2026-11-03 类型色改判为青绿 `#2c9e43`／132°，最近的 Tailwind 色变成 `green`／142°，
   相差 10°——**结论不变**：仍是两套值，仍不能靠类名表达。）
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

## 4quaterdecies. 目标区挂子目标进度条（2026-11-02，Human 定案）

Human 定案 2026-11-02：「当前聚焦的目标块的 sg，都要附带一个进度条，样式你看如何呈现，
进度条的构成才看 sg 的进度条」。

### 构成：不新造算法，就是 §4decies 那一个

「进度条的构成才看 sg 的进度条」——即**目标区不另立口径**。分子分母仍是
`open`（待处理）+ `implemented`（已落实）为分母、`implemented` 为分子，仍由
`utils/servingSparkProgress.ts` 的 `summarizeServingSparkProgress` 单点算出，
仍由 `components/ServingSparkProgressBar.tsx` 渲染。目标区只是多了一个**形态**。

故本页与卡片、详情面的数值**不可能不一致**——三处调同一个纯函数，且目标区那条的
输入也是原始 `serving_work` 行（不是 `groupServingWorkByType` 的关联投影：那一层已把
`status` 换成关联状态轴，数出来恒为 0 条，§4decies 已记过一次实拍翻车）。

### 形态：`variant="inline"`，条 + 分数同排

新增一个 `variant` 参数，两档：`block`（默认，卡片与详情面用）与 `inline`（目标区用）。

| 形态 | 内容 | 为什么 |
|---|---|---|
| `block` | 口径名 + 分数 + 条（`h-1.5`），**不给两档明细**（Human 2026-11-03 定案，见第八节第 8 条） | 卡片与详情面有足够高度；但两档明细是分数的算术展开，不是新信息 |
| `inline` | 条（`h-1`）+ 分数，无口径名、无明细 | 目标区一行只有 20px，塞进明细会把子目标标题挤成两行 |

**条用固定宽度**（`w-32`，128px），不吃满剩余宽度。这一条是实拍改的：第一版用
`flex-1` 吃满整行，1440px 视口下条长近 2000px——`9 / 30` 的条看起来像「几乎走完」，
`0 / 1` 的条则成了一条看不见的细缝，比值反而更难读。固定宽度让四条子目标仍共用
同一把尺子（这才是「可比」的来源），而分数就落在条尾旁边，读起来是一个整体。

**三种「算不出」在行内只给短词**（未拆解／已处置／读不到），完整那句挂在 `title` 上。
理由与 `docs/01`「状态不得只由颜色承载」同向：短词本身是文字，颜色只加强。而**不读
工具提示的人也不会看到一个假的 0%**——因为这三种情形下这里根本没有条。

### 位置：子目标标题行**之下**，与标题同左缘内缩

进度条挂在每一行子目标的下方（`mt-1.5 pl-7` 对齐标题文字左缘，跳过 18px 的次序 chip）。
不放在标题行右侧：右侧已经被状态 chip 与 legacy chip 占着，再塞一条 100px 的条会把
子目标标题压成两三个字一行。

**legacy 行不画条**：它没有 `object_uid`，也就没有可反查的身份。给它画一条空条等于把
「还没有对象」说成「没有火花」——这两种情形下一步动作完全不同。

### 服务端：`/api/cognition/goal` 的 `sub_goals` 现在带 `serving_work`

此前该投影只带身份/次序/判据类型，不带名下工作，目标区因此拿不到比值。现补
`serving_work` 与 `serving_unreadable`，来源是 `facts.ts` 新导出的
`deriveServingWorkIndexForScope`——**与子目标列表卡、详情面同一次反查**。

为什么不改让前端另打一次 `/api/objects/subgoal`：两处各读一次会在两次读取之间出现
不一致（一个对象刚被改、另一处还读到旧值），而读者看到的会是一条自相矛盾的卡。
单点反查是唯一能保证「分子分母出自同一次读取」的做法。

### 验证

`goal-detail-presentation-contract.test.ts` 新增 5 项：目标无摘要字段、每行子目标挂条、
三处共用同一派生、行内短词与 title 配套、两形态同源。`goal-writer.test.mjs` 新增 4 项：
200/201 字符边界、超限拒绝且不截断、首尾空白不计入而段内换行计入、本仓存量 87 字仍合规。

全量 web 611 全绿、plugin 2723 全绿（1 skip / 1 todo 为既有）、`tsc -b` 通过、
`npm run lint` 仅剩 HEAD 上既有的 1 个 error（`facts.ts` 的
`currentProjectProjectionIndexes` 未使用，非本次引入）。

**未覆盖（如实登记）**：① 目标区进度条的**浏览器实拍**未做——本仓四条子目标中
1429afe8 名下只有 1 条 open、01978a8b 只有 1 条 open，`0 / 1` 的条几乎不可见，形态
需在真实数据上目视确认；② 行内短词在窄栏（侧栏展开、移动端）的换行表现未实拍；
③ 无障碍走查未做（`role="img"` + `aria-label` 已给，未用读屏验证）。

## 4quindecies. 子目标详情撤除「服务目标」元信息行（2026-11-02，Human 定案）

Human 定案 2026-11-02（附截图，蓝框圈出子目标详情身份头底部那行「服务目标 | project-goal」）：
「圈出来的不用显示」。

这是 §4novies 那轮处置的**反向修正**，不是新决定：`parent_goal` 此前住在阅读面顶部锚点块里，
§4novies 把锚点块收窄为「只留判法」时，顺手把它挪到了身份头辅助元信息行——理由是「归属
事实不能因为收窄而消失」。那一轮保住了字段的可见性，但没有回答一个更前面的问题：**它值不值得
占一行**。

### 为什么撤

单例项目里 `parent_goal` 恒为 `project-goal` 一个值（28 §8 的闭集只有这一个成员），四次出现
四次相同，**不携带任何可分辨的信息**。读者打开一条子目标要回答的是「这条怎么算达成」，
而不是「它属于哪个目标」——后者由「它是子目标」这一事实本身已经回答了。这与 `serves`
2026-11-01 出列（§4sexies）、`anchor` 2026-11-01 废止是同一条纪律：28 §18 第 1 条禁装饰字段。

归属关系没有因此丢失：`parent_goal` 字段仍在对象上，是 28 §8.1 反查派生的输入，**目标区的
子目标列表就是它的可见形态**——读者要看归属，去聚焦页看目标块，那里四条子目标按次序排列
在陈述之下。字段在、关系在、呈现撤了，这三件事互不矛盾。

### 改了什么

- `AUXILIARY_META_KEYS_BY_TYPE.subgoal`：`['parent_goal']` → `[]`。
- `FIELD_LABEL_LOCALES.parent_goal` 词条删除。它此前的存在理由就是「元信息行按 frontmatter
  键名取标签」，行撤了词条就失去唯一消费方；留着等于「不呈现」这个决定没有落点（同 `serves`
  与 `anchor` 出列时）。删前已确认全仓无 `getFieldLabel('parent_goal', …)` 调用。
- 布局与 model 的注释同步改写：原文写的是「已登记为身份头辅助元信息」，留着会让后来者
  以为它仍在呈现。

**出列后会落到兜底字段区吗**——会，但不会冒出来：subgoal 详情走 `SubGoalReadingLayout`，
该布局不消费 `extraEntries`（与 `serves` 出列时同一处境，model.ts 里那段注释已记此事）。

### 守卫改向

`subgoal-presentation-contract` 里原有一条断言 `subgoal: ['parent_goal']`（「归属事实不丢」），
它是上一轮定案的守卫。本轮**改向而不是删除**：改为断言 `parent_goal` **不得**再出现在
`AUXILIARY_META_KEYS_BY_TYPE.subgoal` 的对象字面量内，且不得回到旧态。

改向时踩了一次：第一版取 `auxTable` 后直接 `indexOf('subgoal:')`，而 `auxTable` 的切片
终点是**表里第一个** `};`——`subgoal` 是表里最后一个键，其字面量恰好在那个终点之前，
能取到；但这个写法脆。改成先按 `subgoal:` 定位、再取它之后第一个 `};`，并显式注释
「判据限定在对象字面量内」——表上方那段注释会反复解释「parent_goal 为何撤除」，对全文
匹配会被注释判成失败（与联邦 `type: objectType` 那条守卫同一教训，§4novies 已记）。

### 验证

全量 web 用例 **611 全绿**；`tsc -b` 通过；`npm run build:dsh` 重建成功。
Playwright 实拍 `subgoal-befe1735`（order 1、名下 42 条火花）：身份头 innerText 实测
`["子目标","1","3","推进中","规范体系成为当前规则源并互咬有效","2026-11-01 13:36","deepseek-v4.1-flash","workbuddy"]`
——「服务目标」与「project-goal」均已消失；`document.body.innerText` 全文检索
`服务目标` / `project-goal` / `parent goal` 三者**均为 false**；控制台零错误。

**未覆盖（如实登记）**：① 右侧扩展阅读面板里的子目标详情未单独实拍——它复用同一枚
`ObjectIdentityHeader` 与同一份 `getAuxiliaryMetaEntries`，但仅静态复用关系成立；
② 暗色模式未单独实拍（本次只删了一个文本节点，不涉及配色）；
③ 英文界面下的同一行未实拍（词条已整体删除，中英两版同时消失）。

## 4sexdecies. DevLog 详情撤除时间轴节点（2026-11-02，Human 定案）

Human 定案 2026-11-02（附截图，蓝框圈住 DevLog 详情「结论与边界」之上的**一整块**）：
「圈出来的部分不用显示」。

框里是两件事，住在**同一个 `<section>`** 里（`DevLogReadingLayout`）：

1. 一行**时间轴**：`发生时间 [chip]` + `条目形成时间: …`；
2. 其下一个**琥珀提示框**：`未声明或不属于任何子目标——serves 缺失时主题表现为空集…`
   （`objectList.devlogNoTopic`，29 §8.1 的「显式提示」义务）。

### 为什么撤：不是「太啰嗦」，是两件事都站不住

**时间轴那一行**：本文档 §4octies 当初把它读成「29 §10.4 要求分开呈现两个时间」，
并据此在详情页做了一次并排呈现。**这句措辞是文档自述，规范里没有**——
`grep 分开呈现|两个时间` 在 `specs/29` 为 **0 命中**，§10.4 实际只要求两时间**语义
分工**、不得用 `created_at` 冒充 `occurred_at`（§14.1 与 §15 亦无「两时间分列」验证
行）。而真正的问题是：**两个时间各有别的承载位，详情页这次并排是第三处重复**——
`occurred_at` 由列表卡头的 `DevLogOccurredBadge` 承担（列表是时间线回查入口，29
§12.1），`created_at` 由 change_log 首条与详情底部 YAML 原文承担。**详情页身份头从未
渲染过 `created_at`**：`ObjectIdentityHeader` 的 `showDefaultDates` 渲染的是
`getObjectUpdatedAt(obj)`＝change_log **末条**时间（`ObjectDetail.tsx:731`）。故该行
不是「补上身份头没给的时间」，而是**把两个字段各再印一遍**。

**琥珀提示框**：它是 `serves` 的**空集提示**，不是独立需求。而 `serves` 自 2026-11-01
已退出 DevLog 的全部呈现面（§4quater 同源纪律）：字段既不在屏上，读者就无从问「它填了
吗」；一句「它没填」是把**读者没在问的问题**答了一遍。此处区分要写清：**撤的是呈现，
不是字段**——`serves` 仍在对象上，仍是 29 §8.2 主题反查的输入，只是不再有呈现面与筛选面。

### 规范同步（必做，不是可选项）

`specs/29` 里那条「须由呈现面显式提示」的义务与本次撤除直接冲突，故同轮修订：

- **§8.1**：原文要求无 `serves` 时「须由呈现面显式提示」，改为如实登记该呈现已于
  2026-11-02 撤除，并写明理由（字段已无呈现面，「缺失」只能从缺席推得）；
- **§10.4**：把「两个时间各有承载位」写清（occurred_at → 列表卡头；created_at →
  change_log 与 YAML 原文），避免下一位读者再从本文档的旧措辞里读出「必须并排」；
- **§12.1 / §14.1 / §15**：撤除已无落点的呈现条目与验证行。

**为什么必须连着改规范**：UI 删了而规范仍写着「须显式提示」，下一个人读规范会把它
当成**未实现的欠账**再加回来。规范是事实源，呈现被裁掉而规范不动，等于留了一条
指向空处的义务。

### 改了什么

- `plugin/web/src/pages/object-detail/FactReadingLayouts.tsx`：删 `occurredAt`/`createdAt`
  两个变量与整个时间轴 `<section>`，详情页首屏直接以「结论与边界」开始；同时删除
  `from '@/utils/decisionBlocks'` 导入——**该文件至此已无任何 decisionBlocks 消费方**。
- `plugin/web/src/pages/object-detail/model.ts`：`FIELD_ORDER_BY_TYPE.devlog` 由
  `['occurred_at','created_at','summary','disposition','report_body','change_log','relations']`
  改为 `['summary','disposition','report_body','change_log','relations']`。改这张表是因为
  它本身是一份「该字段有呈现面」的声明；`occurred_at`/`created_at` 仍各自有呈现面（卡头、
  change_log、YAML），只是不在这个兜底字段区里——故出表不等于字段无处可看。
- `plugin/web/src/i18n/locales.ts`：删 `devlog_occurred_at`/`devlog_created_at` 字段词条
  与 zh/en 两条 `objectList.devlogNoTopic`（唯一消费方均已消失）。**`objectList.devlogOccurredLabel`
  与 `...Absent` 保留**——它们服务卡头徽章，不是这处撤除的对象。
- `plugin/web/src/utils/decisionBlocks.ts`：删 `DECISION_DETAIL_NEUTRAL_SHELL_CLASS`
  （该块是它最后一个消费方），`DECISION_TITLE_HUE_CLASS` 由 `Record<'amber'|'lime', string>`
  收窄为 `Record<'amber', string>`。详见下节。

### 连带退场：第四轮「内容撤则壳撤」

- **白名单 4 → 2**（`structure-single-source-contract`）：该块外壳的两段左条
  （`border-l-2` + `border-l-violet-400/70`）随之离场，本族至此只剩卡面琥珀一条壳。
- **`DECISION_TITLE_HUE_CLASS` 收窄为 `Record<'amber', string>`**：`lime` 的唯一消费方
  是那个时间轴标题，随块撤除。**这不是「统一色相」**——三枚色相 amber/violet/lime 的
  四次退出，每次都是被它承载的内容带走的。
- **顺带消解一处已登记的争议**：该壳的左条是 violet、而标题取 lime，同一块里两个色相
  （§4undecies 曾如实登记「需 Human 裁决，故只登记不擅自择一」）。Human 的裁决是
  「此块不必存在」，于是两个「正确修法」都失去对象——**登记式处置的正当结局之一**。
  常量原位留下踪迹注释，理由与 `DECISION_VIOLET_CODE_CHIP_HUE_CLASS` 相同：它的名字
  出现在旧守卫登记与 `docs/01` §1.10 第 7 条里，从旧注释追来的人应当能查到去向。

### 守卫改向（不是删除）

- `devlog-presentation-contract`：原两条 test 断言「详情分开呈现两时间」与「空集文案
  把话说完整」。**改向**为 `assert.doesNotMatch`——`devlog_occurred_at`、
  `devlog_created_at`、`objectList.devlogNoTopic`、`DECISION_DETAIL_NEUTRAL_SHELL_CLASS`、
  `from '@/utils/decisionBlocks'` 在布局里均不得再出现；同时断言 model 的 devlog 表
  不含 `occurred_at`/`created_at`。**保留了阅读次序断言**（结论→去向→背景→做法→实测）
  与压缩形态断言——它们不属本次撤除范围。
- `structure-single-source-contract`：「决策块常量被原消费方使用（防假单源）」中
  `factLayouts` 的断言由 `assert.ok(...includes('DECISION_DETAIL_NEUTRAL_SHELL_CLASS'))`
  改为 `assert.doesNotMatch(factLayouts, /from '@\/utils\/decisionBlocks'/)`；两个登记表
  删去该壳与 `lime` 原子（**不登记已不存在的常量**，登记会让守卫永远取不到值）。

改向时沿用 §4quindecies 的教训：**判据要限定在对象字面量内**。`FIELD_ORDER_BY_TYPE`
上方那段注释会反复解释本次撤除，对全文匹配 `occurred_at` 会被注释判成失败；故就地
`model.slice(indexOf('devlog: ['), indexOf(']', …))` 后再断言。

### 验证

**2026-11-02 实测（本轮，规范同步与实拍同轮完成）**：

- `cd plugin/web && npx tsx --test tests/api/*.test.ts` → **611 pass / 0 fail**（与撤除前
  基线同数：两条 DevLog 守卫是**改向**不是删除，故总数不变）。
- `cd plugin/web && npx tsc -b` → 通过（exit 0）。
- `cd plugin/web && npx eslint .` → 只剩 HEAD 既有 1 error（`api/services/facts.ts:309`
  `currentProjectProjectionIndexes` 未使用）+ 1 warning（`src/pages/ObjectList.tsx:1141`
  react-refresh），**本轮未新增任何 lint 问题**（撤除还减少了 decisionBlocks 的一处消费）。
- `cd plugin/web && npm run build:dsh` → 构建成功（`2807 modules transformed`，
  `dist/assets/index-BwHPnV-f.js` 1904.65 kB / gzip 498.07 kB）。
- `cd plugin && node --test test/*.mjs` → **2725 pass / 1 skip / 1 todo / 0 fail**。
- **Playwright 实拍（真实 API、真实数据，两个 DevLog 对象都查）**：详情页全文检索
  `发生时间` / `条目形成时间` / `未声明或不属于任何子目标` **均 false**，
  `结论与边界` true——首屏直接以结论开始，时间轴节点确已消失；控制台零错误。
  列表卡头仍给出 occurred_at（`/2026-\d\d-\d\d \d\d:\d\d/` true），即 §10.4 订正后
  「两个时间各有承载位」的实据。截图：`scratch.local/devlog-detail-light.png`、
  `devlog-detail-dark.png`、`devlog-detail-narrow.png`（420px）、`devlog-list.png`
  （`scratch.local` 被 `.gitignore` 的 `*.local` 忽略）。

## 4septdecies. 摩擦分级制度整体退役（2026-11-02，Human 定案）

Human 原话（m00809）：「摩擦取消 中 轻 重 这种分级制度」——撤的是**制度本身**，
不是某处显示。规范侧已落盘（`specs/26` §8 字段表 / §12 消费点 / §14.2 存量处置、
`specs/36` §8.3、`specs/11` §12bis.1），Code 侧已全链清除，本节只记 **Web 呈现面**
的处置与判据。

### 为什么撤（呈现侧的理由）

规范声称的两类消费方**在 Code 中从未实现**：①「按状态×影响聚合」的度量（全仓无按
`impact` 的 count/group/aggregate）；② heavy 跳过攒熟的「重大即显」通道（只存在于规范
文本与 tool description 字符串）。实际活消费方只有三处展示 + 召回 structural facet +
观察缓冲晋升的字段传递。一个只有展示消费方的闭集分级，其判定标准（现象严重到什么程度
算「中」）**不可机械核对**、判据不可复现——产出的是「看起来可聚合、实际无法比较」的
数字。故 26 §18 红线 1 恢复无例外。

### Web 呈现面的处置（内容撤则壳撤）

| 位置 | 处置 |
|---|---|
| `src/components/FrictionImpactBadge.tsx` | **整文件删除**（该字段呈现的唯一来源组件） |
| `src/utils/semanticColors.ts` | 删 `FRICTION_IMPACT_CHIP_CLASS`（轻/中/重三档色相表） |
| `src/utils/fieldFormats.ts` | `SUMMARY_TEXT_FIELDS` 去 `impact` |
| `src/utils/api.ts` | 三处类型面（ObjectItem / CognitionInboxItemBase / 近期动态项）去 `impact` |
| `src/pages/ObjectList.tsx` | 删卡头 chip 调用（列表卡卡头：类型 → 优先级 → 重复观察 → 修改次数） |
| `src/pages/ObjectDetail.tsx` | 删身份头 chip 调用（同序同形） |
| `src/pages/CognitionCenter.tsx` | 删近期动态行 chip 调用（同序同形） |
| `src/pages/object-detail/model.ts` | `FIELD_ORDER_BY_TYPE.friction` 去 `impact`；`AUXILIARY_META_KEYS_BY_TYPE.friction` 仍为 `[]` |
| `src/pages/object-detail/FactReadingLayouts.tsx` | 阅读布局从未列它（Human 2026-11 已裁定），本轮只把注释改为追记 |
| `src/i18n/locales.ts` | 删 `FIELD_LABEL_LOCALES.impact` 与 `FIELD_VALUE_LOCALES.impact`（轻/中/重闭集） |
| `api/routes/cognition.ts` | 删 `projectFrictionImpact` 与两段投影（build / recentItems） |
| `api/services/factFieldContract.ts` | 删 `friction-impact` 登记（该字段曾是必填面） |

**为什么词条与配色表也要删**：留着「词条在、字段不在、唯独代码还读它」正是本仓反复
纠正的漂移形态——`FIELD_VALUE_LOCALES.impact` 的轻/中/重闭集值一旦留下，就等于邀请
下一个人把分级接回去。

### 守卫改向（不是删除）

- `tests/api/friction-norm-presentation-contract.test.ts`：原「friction impact 在三处同形
  呈现（Human 裁定 2026-11）」**改向**为「26 §8 impact 分级已整体退役：呈现面不得再有其
  消费方」——保留位置与编号体例，判据反向（原钉「三处同形」，现钉「三处皆无」）：
  组件文件不存在、三处页面不引用、配色表无该表、类型面无该字段、路由不投影、词条无闭集值。
- `tests/api/cognition-inbox-contract.test.ts`：三条用例改向为 `occurrence` 单字段
  （近期动态行顺序、API 链路不丢字段、收件项平铺到条目根），并加一条
  `doesNotMatch(FrictionImpactBadge|FRICTION_IMPACT_CHIP_CLASS)` 防退役项回流。
- `tests/api/fact-field-contract.test.ts`：friction 必填面去 `impact`（余 `phenomenon`）。
- `tests/api/fact-association-commit.test.ts`、`friction-attribution-ref-fidelity.test.ts`、
  `friction-attribution-ref-shape.test.ts`：三个 YAML 夹具去 `impact` 行——留着就是闭集违规。

**判据口径**：判「代码里有没有 X」一律经 `codeOnly`（剥注释）——注释里说明「该字段为何
被撤销」是正当的，把它当消费方会误报。这是本仓既有纪律（`friction-norm-presentation-contract`
自带的 `codeOnly` 说明段）。

### 连带退场的事实源存量

68 份 friction 载体的 `impact` 字段已经受控写入清除（open 25 走受控更新 `frontmatter_removals`、
终态 43 走 `correct` 的 `frontmatter_removals`，见 26 §14.2）。Web 侧的 `localFactReader`
按 26 §8 闭集读 frontmatter，字段一旦留在载体上就会是闭集违规——故「呈现面撤除」与
「存量清除」必须同批完成，否则页面直接读不出该类型。

### 验证

**2026-11-02 实测**：

- `cd plugin/web && npx tsx --test tests/api/*.test.ts` → **611 pass / 0 fail**（与撤除前
  基线同数：守卫全部**改向**不是删除，故总数不变）。
- `cd plugin/web && npx tsc -b` → 通过（exit 0）。
- `cd plugin/web && npx eslint .` → 只剩 HEAD 既有 1 error（`api/services/facts.ts:309`
  `currentProjectProjectionIndexes` 未使用）+ 1 warning（`src/pages/ObjectList.tsx`
  react-refresh），**本轮未新增任何 lint 问题**。
- `grep -rn "impact" -i src api` → 只剩有意保留的历史注记与英文普通词
  （`scope_of_impact` 是 Pitfall 字段、`impact & applicability` 是英文散文），零字段残留。

## 4octodecies. DevLog 卡头撤时间徽章 + `refs` 采用面扩展 + 目标区头改版（2026-11-02，Human 定案）

三条同批提交（Human 在同一轮里连着提的三项：m02151 卡头、m02388 区头、m02390 图标）。

### 一、DevLog 卡头不再呈现 `occurred_at`

**Human 定案**：「圈出来的部分不用显示」——圈的是列表卡头那枚 `2026-10-27 14:35` 时间 chip。

**为什么撤得掉而不违反规范**：上一轮（§4sexdecies）撤详情页时间轴节点时，本文把
`occurred_at` 的承载位写成「**列表卡头的时间徽章**」，并在 §4sexdecies 里留下一句
「本节关于『卡头必须给 occurred_at』的全部论理不受影响」。**那句论理现在被推翻了**，
而它当初就不该写成那样——回 `specs/29` 逐字核对：§10.4 要求的**仅是语义分工**
（两字段含义不可互换、不可相互冒充），并明文写了「呈现面在何处给哪一个，由 §13.1
与 07 号决定，本节不指定其位置」。**「卡头必须给 occurred_at」这句话在规范里从来
不存在**，它是本文自述。§12.1 的「时间线回查」也只要求「按 `occurred_at` 排序的
条目清单」，没有要求单卡呈现它。

**教训（记进 §4sexdecies 的追记里）**：语义分工要求与呈现落点是两件事——把落点写进
「要求」的论理里，等于给自己埋一个将来要推翻的前提。

**处置**：`ObjectList.tsx` 卡头行删 `{obj.type === 'devlog' && <DevLogOccurredBadge …/>}`；
`DevLogOccurredBadge.tsx` **整文件退场**（它只有一个消费方，留着就是无人消费的壳——
同 §4septdecies 撤 `FrictionImpactBadge.tsx` 的判据）；locales 删
`objectList.devlogOccurredLabel` / `devlogOccurredAbsent` 中英各一条；
`model.ts` / `FactReadingLayouts.tsx` / `decisionBlocks.ts` 三处「occurred_at 走卡头徽章」
的注释同步订正（它们是注释不是呈现面，但留着会误导后人）。`occurred_at` 字段本身
**照旧必填**（29 §8），只是不再有单卡呈现面。

已按 `docs/13` §4 的判据在登记表**新增一行**（三腿：锚句取 29 §10.4 的
「列表卡头的 `occurred_at` 时间徽章亦于同日**撤除**（Human 定案）」、判据入口
`ObjectList.tsx → ObjectCardFrame`、守卫 `devlog-presentation-contract.test.ts`
的卡面用例；无例外故第 6/7 列写 `无`）。**如实声明**（`docs/13` §2）：该行全绿只
证明三腿都在，不证明卡面真的没呈现——它买到的是「这条收窄不会被静默拆掉」。

**撤除后 `occurred_at` 的承载现状（据实登记，不粉饰）**：撤掉这枚 chip 之后，
`occurred_at` 在 **Web 面已无任何呈现**——它仍是必填字段（29 §8）、仍是工具侧
`ldvh_devlog_list` 的**排序轴**（`devlog-writer.js` 的 `listDevLogObjects` 按
`occurred_at` 倒序），但 Web 的 `/objects/devlog` 列表页**本来就不按它排序**
（`ObjectListSort` 只有 `updated_desc | created_desc | 'priority_asc'` 三档，
本轮之前就如此），近期动态取的是 change_log 的 `at` 而非对象的 `occurred_at`
（`cognition.ts:596` 注释自述）。所以 29 §12.1「时间线回查」这个消费点目前**只有
工具侧承载**；Web 若要成为真正的回查入口，需要给 devlog 列表加一档
`occurred_at` 排序——**那是呈现扩展，属 Human 决定，本轮未擅自做**。

### 二、`refs` 采用面扩展到 `devlog`（「关联事实对象的处理参考 spark」的落点）

**Human 定案**：「开发日志应该会有关联的事实对象，关联事实对象的处理参考 spark」。

**为什么这不是一句 UI 改动**：`refs` 在 02 §7.1 是**类型条件字段**，采用面明文只有
`spark` 与 `workcase`；29 §8/§11 更明文「**不采用 `refs`**——与工单的连接由工单侧
`refs` 单向声明」。而 02 §8.2 写着「**采用面扩展须经 Human 决定并同步修订各相关类型
来源**」。所以「参考 spark」= 采用面扩展，不是加个渲染分支。经 ask_user_question
取得裁定：**扩采用面，devlog 采用 refs 并补存量**。

**规范层**：02 §7.1 refs 行采用面改三成员、§8.2 采用范围段补 devlog 的理由；
specs/29 十处（§8 字段表新增 refs 行、§8 表后「不采用」段只留 urls、§8 不变量新增
第 6 条「refs 只载内容关联」、§11 末段整段改写、§12.1 新增 refs 呈现面、新增
§12.3bis 解析口径、§12.4、§14.1、§15、§17 第 6bis）。

**分工没有变**：`refs` 载**内容关联**（依据／输入／相关），生命周期关系仍走
`relations`（29 §11 那两条终态边），外部资料走 `urls`（本类型不采用），载体内部锚点
走 `serves`。与工单侧指向条目的 `refs` 是**两侧各自声明**、互不复制反向边（02 §8.2
第 4 条：反向索引是派生物，不建第二权威）。

**Code 层**：`plugin/lib/devlog-writer.js`——`VALID_FM_KEYS` 加 `refs`、
`MAX_REFS_ENTRIES = 10`、`DEVLOG_REMOVABLE_FIELDS` 由 `{serves}` 扩为 `{serves, refs}`
（二者都是可选引用；没有删除通道，02 §10.5「省略即保留」会让它一旦写入就永久撤不掉）、
形状校验块（文案逐字照 20 §8，含「空数组会伪造一个条件字段 03 §6.1」）、新增
`validateRefsTargets`（失败码 `devlog/refs_unresolvable`；**不校验目标状态**——关联是
历史事实，目标关闭不使该条失效；解析失败**零写入拒绝**，不降级为空数组）、
`FRONTMATTER_FIELD_ORDER` 与 `listDevLogIndex` 投影带 refs、create/update 两路各加一次
目标解析。`devlog-tools.js` 的 read/list 投影、write schema、`frontmatter_removals`
描述同步。

**Web 层零改动**：`facts.ts` 的 `projectFactRefs` **本来就不按类型门**，
`ObjectCardFrame` 本来就在 children 之后统一渲染 `<FactAssociationsCardContent
associations refs />`——所以 devlog 一旦有 refs，关联行自动出现，形态与 Spark 卡
**完全一致**。这正是「参考 spark」的字面兑现：不是复制一套渲染，而是让本类型进入
那条已经存在的共用通道。`factFieldContract.ts` devlog 段加
`refs: field('devlog-refs','array',false)`；`localFactReader.ts` 的
`RECORD_ARRAY_FIELDS` **不登记** refs（spark/workcase 同样未登记——成员级校验归
writer，Web 侧只做投影）。

**存量**：`plugin/scripts/migrate-devlog-add-refs.mjs`（新增，未跟踪）逐条走受控更新，
每条的 `change_log` 摘要里写明**判定依据**（该条正文的哪一段），不凭印象配对。
8 份中 **7 份写入成功、1 份如实跳过**：`d5187ddf` 的承接物是规范正文（`specs/11 §6.1`）
与一个明文登记「未落档」的 Pitfall，**无可解析的事实对象 uid**——按 29 §8「不存在时
省略」不写，写空数组会伪造条件字段。304ec293 一条挂了七个 Pitfall（其「去向」段
登记的 §4.1–§4.5 七处承接，根因与该条实测逐条对应）。

### 三、目标区头：撤 `Maximize2`，详情入口移进标题

**Human 定案**：「这个图标去掉」+「这个部分设计的好看一点」。

**去掉图标会让 `/goal` 成死页**：`navigate('/goal')` 全仓原本**只有这一处**，侧栏
`NAV_ITEMS` 与 `FEDERATION_NAV_ITEMS` 都没有 `/goal` 项（25 号 Goal 是单例，不占七类
事实对象的 tab/card）。故撤图标必须同时补入口，经裁定取**标题可点**：`<h3>` 内包一个
`role="link"` 的 `<span>`，`onClick`/`onKeyDown`(Enter/Space) → `stopPropagation` +
`navigate('/goal')`。区头整行仍是折叠按钮，标题是行内的**嵌套链接**——两个动作不同义，
故必须 `stopPropagation`。

**为什么是标题而不是别的**：标题就是那份单例对象的名字，点名字看它的详情，不需要
额外学一层图标语义；而 `Maximize2` 与折叠箭头同为 `ldvh-icon-button` 摆在右侧，
读起来像「两个都是开关」，是易错形态。

**美化**：三处都只加视觉层次、不引入新信息——① 图标加**底托**
（`h-7 w-7 rounded-md border border-ldvh-accent/25 bg-ldvh-accent/10`，与 `Help.tsx`
的既有范式同规格）；② 标题后跟子目标计数（`ldvh-meta`，与模块四 Spark 池健康的
计数同一形态）；③ 标题下方一行副标题（`ldvh-caption`，新词条
`focusV2.goalSectionHint`「目标陈述与子目标——点标题看完整详情」——它同时是**入口的
可发现性说明**，因为图标撤了）。右侧只剩折叠按钮。

**守卫**：`goal-detail-presentation-contract.test.ts` 的用例改名
「exposes the detail entry through the title」并加两条反向断言（不得再 import
`Maximize2`、不得再出现 `<Maximize2`）。**坑（`docs/12` §3 的误报方向）**：第一版用
`/Maximize2/` 全文断言，被文件头注释里「为什么撤掉这枚图标」的历史记述判成失败——
撤除类守卫**只查 import 行与 JSX 元素**，注释里的说明是正当的。

### 验证

- `cd plugin && node --test test/*.mjs` → **2729 tests / 2727 pass / 0 fail / 1 skip / 1 todo**。
- `cd plugin/web && npx tsc -b` 通过；`npx tsx --test tests/api/*.test.ts` → **611 pass / 0 fail**；
  `npx eslint .` → 只剩 HEAD 既有 1 error + 1 warning，**本轮未新增**。
- `npx tsx --test tests/api/presentation-narrowing-registry.test.ts` → 5 pass（新增行三腿齐备）。
- 事实源：`grep -c "^refs:" ldvh-base/devlogs/*.md` → 7 份各 1、`d5187ddf` 为 0；
  `listDevLogObjects({status:'all'})` 8 items，refs 投影逐条正确。

## 4novemdecies. 关联行末「待处理」图标改用问号（2026-11-02，Human 定案）

User said (m04384)：「待确认应该用问号图标」（附图为子目标卡「名下的工作」区右侧一列
琥珀色**四分填充圆**，蓝框圈住其中三枚）。

**判读**：撤的是那枚自绘图形，不是这一族状态。`FactAssociationStateIcon` 的五族里
`pending`（Pitfall draft、WorkCase 方案/关闭待确认、Spark open、Friction 活账）此前
用一段手写 `svg`（圆 + 填充右上四分之一），视觉上是一个**进度环**——读者会把它读成
「这条已经走了 25%」。但这四类的共同点从来不是进度，而是**等一个决定**：draft 在等
准入、pending_gate1 在等放行、awaiting_gate2 在等关闭裁决、Friction open 是没人认领的
活账。所以隐喻本身就是错的，改成 `CircleHelp`（问号）后隐喻与语义对齐。

**顺带收敛的一处纪律问题**：这是全仓**唯一**一处自绘状态图形，绕过了 `docs/09` §8 的
集中映射原则（页面不得自行散落图标选择）——所以它既不在 §4 的工作项状态表里，也不在
任何图标检索路径上，改名换库时无人能找到它。现按 §4 的体例新增 §4.1，把五族行末图标
（`Activity` / `CirclePlay` / 待处理族的问号 / `CircleCheck` / `CircleMinus`）集中登记，
并在 `docs/03` §3 那句「使用待处理图标」处补上具体图标名与指针。

**未改的部分**：tooltip 文案仍是 `objectList.associationState.pending`「待处理」——
用户要的是图形，不是这一族的命名；且 Friction 活账确实不是「待确认」。排序档
（活跃 → 推进中 → 待处理 → 已关闭 → 已废弃）与琥珀状态色不变。

**二次定案（同日，Human 看了首版截图后）**：「有没有单个问号的，不要有外部的圆圈」——
`CircleHelp` 是**带外圈**的问号；行首的类型图标已经圈着一个形状，行末再套一圈是多余的框。
lucide 0.511 **没有裸问号形态**（`CircleHelp`／`BadgeHelp`／`FileQuestion` 全部带圈或徽框），
故按 §8 既有先例（research 的 `FileSearchCornerIcon`）在集中映射处 `SemanticIcon.tsx`
新增 `QuestionMarkIcon`。**禁的是页面内联自绘，不是集中封装本身**——首版那句「不自绘 svg」
若照字面执行会走进死路：lucide 没有这个图形，要么带圈、要么回页面内联。正确读法是
「图形进集中映射，不进页面」。

字形不是照抄 lucide 的问号 path：那截 path 只占 24 视框的 8/24（它是设计来装进 r=10 的
圆里的），直接摘出来在 15px 下是个小点，与同排带圈的四个图标视觉重量失衡。故绕字形中心
(12,13) 放大 1.9 倍（放大后跨 5.4–20.6），`strokeWidth` 保持 2（15px 下 1.25px，与 lucide 同权重）。

**守卫**：`spark-reading-contract.test.ts` 加四条——正向断言
`pending: { Icon: QuestionMarkIcon, … }` 与「import 自 `@/components/SemanticIcon`」；
反向断言自绘 path `M12 12V3a9 9 0 0 1 9 9` 不得再出现、`Icon: CircleHelp` 与 lucide
import 行内不得出现 `CircleHelp`。**坑（本轮第二次踩同一处）**：第一版反向断言写成全文
`/CircleHelp/`，被注释里「为什么撤掉外圈」的历史记述判红——撤除类反向断言**只查代码位**
（import 行、`Icon:` 引用），注释里的说明是正当的（同 §4octodecies 的 `Maximize2` 坑）。

**第三次定案（2026-11-03，Human 复用后）：改回带圈的问号。** User said (m00517)：
「问号图标改回待圆圈的问号」（附图为关联行末的裸问号，蓝框圈住其中一枚）。

**判读**：本次撤的是**裸问号**这一形态，不是上一轮「用问号不用进度环」的判读——问号隐喻
与「等一个决定」的对应关系继续成立，被推翻的只是「外圈多余」这一条审美判断。Human 看过
首版带圈形态时判「外圈多余」，看过裸问号实机后改判「改回带圈的」：行末那一列图标里
其余四族（`Activity`／`CirclePlay`／`CircleCheck`／`CircleMinus`）**全是带形心的圆**，
裸问号孤零零一个字形不成族，读者会先把它读成正文里的标点，再才读成状态。

**落点**：`ObjectList.tsx` 的 `pending` 改回 lucide 原生 `CircleHelp`，lucide import 行补回
`CircleHelp`；`SemanticIcon.tsx` 的本地封装 `QuestionMarkIcon` **整段删除**——它只为这一个
族存在，形态撤回后即成无人引用的死图形（§09 §4.1 的表随之回到「五族全部 lucide 原生」）。

**守卫改向**：`spark-reading-contract.test.ts` 的四条相应反转——正向断言
`pending: { Icon: CircleHelp, … }` 与 lucide import 行内**必须**出现 `CircleHelp`；反向断言
自绘 path `M12 12V3a9 9 0 0 1 9 9` 与 `Icon: QuestionMarkIcon` 都不得再出现。反向断言仍
只查代码位（import 行与 `Icon:` 引用），注释里的历史记述不判红——上一轮踩过的坑继续有效。

### 验证

（前两行为当时的实测记录，形态已随后续定案撤销，留作历史。）

- **首版（带圈）实测**：`lucide-circle-help` 出现 8 次、自绘 path `M12 12V3a9` 已不在页面、
  同页 `circle-check` 6 / `circle-minus` 1 / `activity` 2，零控制台错误
  （截图 `scratch.local/ui-pending-icon.png`）——这一版被 Human 判「外圈多余」。
- **二次定案后（裸问号）实测**：`npx tsc -b` 通过；`npx tsx --test tests/api/*.test.ts` →
  **611 pass / 0 fail**；`npx eslint` 无新增；`npm run build:dsh` 重建后访问
  `/ldvh/objects/subgoal`：`lucide-circle-help` **0 次**，8 个 `title="待处理"` 的 span 内
  svg 均为 `viewBox="0 0 24 24"` + **2 条 path + 0 个 circle**（即无外圈）、渲染框 15×15、
  零控制台错误（截图 `scratch.local/ui-bare-q.png`）。
- **第三次定案后（改回带圈）实测**：`npx tsc -b` 通过；`npx tsx --test tests/api/*.test.ts` →
  **611 pass / 0 fail**；`npx eslint` 无新增；`npm run build:dsh` 重建后访问
  `/ldvh/objects/subgoal`：`lucide-circle-help` 复活、自绘 path 归零、`QuestionMarkIcon`
  已不在任何文件中被引用，零控制台错误。

## 4vicies. DevLog 类型色改冷色系（2026-11-03，Human 定案）

User said (m00001)：「当前开发日志的颜色要改成冷色系的」。改的是 **DevLog 的类型色**
（`#ca21a0` magenta / 315° → **`#2c9e43` 青绿 / 132°**），不是状态色、不是卡面配色方案。
`categoryColors.ts`（前端）与 `api/services/typeColors.ts`（后端，联邦/认知视图消费）两处
同值，`devlog-presentation-contract` 逐字断言这条「前后端同值」。

### 为什么最终落在绿色带，而不是看起来更「冷」的青/蓝

冷色带里对**九类事实类型**都留足 20° 间隔的空隙只有三处，其中两处一放上去就撞状态色：

- **青色带（≈195°）**：距状态天蓝 `#0284c7`（200°，`executing` / `progressing` /
  `closure_preparing` / `plan_revising` 四态用色）仅约 5°。蓝色家族的 WorkCase 卡上
  同时出现「类型 chip」与「状态徽章」，两者同色相等于让读者以为类型和状态是同一件事。
- **靛蓝带（≈238°）**：距 `independent_reviewing` 的靛蓝 `#818cf8`（235°）仅约 3°；且
  `docs` 的 conventional-commit scope 色已是 `#6366f1` 靛蓝。
- **绿色带（104°–140°）**：这是唯一同时满足「距九类事实类型 ≥20°」「距状态绿
  `#059669`（161°）≥20°」「距状态天蓝 ≥20°」的冷色窗口。取值 `#2c9e43`（132°）——
  距最近类型色 goal（160°）28°、距状态绿 29°。

**为什么不用更「冷」的 teal（140°–150°）**：goal 是 `#10b981` emerald（160°），
往 teal 挪每一步都在靠近它；色相 ≈146° 时距离掉到 14°，撞破契约的 20° 阈值。

### 三档对比度都复算过（`type-surface-contract` 兜住正文档）

| 档位 | 浅色主题 | 暗色主题 | 判据 |
|---|---|---|---|
| 卡内正文（oklab 混色 58%） | **7.00:1** | **6.96:1** | ≥4.5（12px 正文，不放宽到 3:1） |
| 类型 chip 贴页底 `--ldvh-bg` | 3.28:1 | 5.72:1 | 非正文 3:1 可读线 |
| 旧 magenta（对照） | 4.71:1 | 3.98:1 | — |

正文档由 `type-surface-contract` 逐类逐主题机械复算（本次改动后仍 **12 pass / 0 fail**）。
chip 档**不是**族内不变量：既有九类里 spark 浅色仅 1.82:1、subgoal 1.88:1，故不设阈值，
此处只如实登记。

### 跟着改的叙述（不是顺手改文案，是防止文档说反）

- `docs/11` §4octies「类型色：`#ca21a0`」整节加改判横幅，保留原文作为历史；
- 同文 §4undecies 与 §4terdecies（卡体染本类型色）里提到 magenta 的三处，标注
  「当时取值」并指向本节；
- `src/utils/typeSurface.ts` 与 `tests/api/type-surface-contract.test.ts` 的由来记述：
  保留「当时 magenta」的事实，同时点明现值——那两段论证的是**为什么用
  `color-mix()` 而不是 Tailwind 类名**，理由不随 hex 变（仍是两套值：132° vs
  `green` 142°，差 10°）；
- `docs/03` §DevLog 卡那段直接写现值 `#2c9e43`（它讲的是**当前**渲染口径）。

### 验证

`npx tsx --test tests/api/type-surface-contract.test.ts tests/api/devlog-presentation-contract.test.ts`
→ **12 pass / 0 fail**（含「前后端同值」「九类色相两两 ≥20°」「九类 × 两主题正文 ≥4.5:1」）。
`api/services/typeColors.ts` 的注释里同步登记了实测值，避免下一个人只信注释、不复算。

## 4unvicies. 目标区改回全站区头语言、子目标行改两列网格（2026-11-03）

老丁指着聚焦页「目标」模块说：「聚焦的这个页面，你根据整体设计语言，再重新设计一下。」
本节的改动只做这一件事：**把目标区拉回全站已经在用的那一套语言**，不新增信息、
不新增字段、不新增状态。

### 一、区头：从「自成一套」回到「与另外四块同构」

改前目标区是聚焦页唯一给区头图标配 `h-7 w-7 rounded-md border bg-ldvh-accent/10`
底托的模块，也是唯一在标题下再写一行 `ldvh-caption` 副标题的模块。它与
「待决定事项 / 推进中事项 / 近期动态 / Spark 健康度」四块并排时，读者要处理两套区头
规格；而这两处差异承载的信息量是零——底托只说明「这是目标」，标题已经写着「目标」。

改后区头与另外四块**逐字同构**：裸 16px `<Target>` + `ldvh-section-title` + `ldvh-meta`
计数 + `ml-auto` 折叠按钮，一条行。

**底托不是「顺手加的装饰」，所以要给出去掉的理由**：它当初与 `Help.tsx` 的步骤图标同
规格（2026-11-02），那是给「一屏里混着多个不同来源的步骤」做视觉分节用的。目标区一场
一景只有一个目标，分节无从谈起——同一规格在没有分节需求的地方就只剩下「这块与别处
不同」这一个信号，而它说的不是信息。

### 二、副标题撤掉，可发现性交给进入箭头

2026-11-02 撤 `Maximize2` 时，`focusV2.goalSectionHint`「目标陈述与子目标——点标题看
完整详情」是**补偿**：图标没了，得有一句话告诉读者标题可点。本次不撤回「标题即入口」
这个定案（`/goal` 仍是全仓唯一入口，侧栏与联邦导航都没有它），只有效的是换一种承载：

- 副标题是**常驻散文**，它占着区头的第二行，说的却是「这里可以点」——一句读一遍就够
  的话，被写成了一个每屏都在的标签；
- 进入箭头是**全站既有的管道**（`docs/01` §1.9：进入箭头默认弱灰、hover/focus 切
  accent、不得常驻状态色）。读者在列表页、诊断页、变更页学过的那个小箭头，在这里是
  同一件事，不需要再读一句话。

具体做**悬停才浮现**（`w-0 opacity-0` → `w-3 opacity-100`，`group-hover/goal` 与
`group-focus-visible/goal` 两条都挂）：默认态下它不该占位——否则「目标 › 4」读起来
就是一枚面包屑，而 4 是子目标**计数**，不是下一级路径。宽度也一并收掉是必要的：只
透明度归零，箭头仍占 13px，那个空隙依然把计数推远、读起来仍有分隔符的味道。

`focusV2.goalSectionHint` 两个 locale 键随之删除（`LocaleKey` 是
`keyof typeof UI_LOCALES.zh` 自动派生的，两侧不同步立即 `tsc` 报错）。

### 三、子目标行：两列网格，替掉 `pl-7` 这个魔法数

改前：

```
[chip] 标题                                    [状态]
       ↑ mt-1.5 pl-7 手工对齐
[条 128px] 9 / 30
```

`pl-7`（28px）是照着「一枚无图标 chip 的宽度」算出来的常数。它只在 chip 恰好这么宽时
成立；chip 一旦换成带 `<ListOrdered size={12}>` 图标的 `SubGoalOrderBadge`，标题与条
就都错位。改后：

```
grid-cols-[auto_minmax(0,1fr)]
[chip] 标题                        [状态] [legacy]
       条 9 / 30
```

对齐成为布局本身的性质，而不是一个需要跟着 chip 走的常数。`minmax(0,1fr)` 而非 `1fr`
是为了让长标题能被压缩换行，而不是把网格撑出容器。

### 四、顺手修掉的三处规格违规（都是「一直存在、这次才被对照出来」）

1. **子目标标题用的是 `ldvh-caption`**（12px 次级辅助信息色）。`docs/01` §1.5 约束 5
   写死「`ldvh-caption` 只用于辅助信息，不承载主要内容；用户需要阅读或点击的至少使用
   `ldvh-body`」——子目标标题正是这一屏最需要被读、且整行可点的文本。改 `ldvh-body`。
2. **状态 chip 直接渲染 raw `{sg.status}`**，中文界面会冒出 `retired`/`achieved` 枚举。
   改用 `StatusBadge` + `getObjectStatusLocale('subgoal', …)`，与 `ReferenceCard`、
   `PanelContent` 同一个口径（tooltip 仍由 `getObjectStatusHint` 给）。
3. **把 `criterion_kind` 拼进状态 chip 的 `title`**。Human 2026-11-02 已定「判据类型
   的词不上呈现面，只保留判法」（`FactReadingLayouts` 与 `ObjectList` 都按此改过），
   目标区是漏掉的一处。删掉；tooltip 交给 `StatusBadge`。

### 五、目标陈述块：给它本类型色（goal = emerald）

改前是中性灰面（`border-ldvh-border/20 bg-ldvh-bg/20`）——它在一屏里是**唯一一句描述
「这个项目要做什么」的正文**，却与周围任何一块辅助信息同色。改后取
`getTypeSurfaceTint('goal')`，几何仍取 `WORKCASE_SURFACE_GEOMETRY_CLASS`：
**面与正文成对**（`surface` 给边框与底、`body` 给正文字色），不单贴 `surface`——
`utils/typeSurface.ts` 的头注写明只贴面会让正文沿用中性近黑，色相面与正文分家。

这也让目标区与卡头那枚 goal 类型 chip、侧栏目标图标、详情身份图标同源，不再引入
第二个色表。

### 六、未做，如实登记

- **没有新增任何测试**：本次改动不引入新契约，全部落在既有断言的覆盖内（
  `goal-detail-presentation-contract` 11 项、`subgoal-presentation-contract`、
  `type-surface-contract` 对「面与正文成对」的要求）。加断言只会把「今天这样排版」
  冻成规则，而排版不是规则。
- **`FactReadingLayouts.GoalReadingLayout` 的子目标行没同步改**（同样的
  `ldvh-caption` + 手写 chip）。本次范围是聚焦页；详情页要改是另一件事，
  不能靠「顺手」把它塞进一个改动里。
- **无障碍实测未做**：`role="link"` + `title` + `aria-expanded`/`aria-controls` 都在，
  悬停箭头的 `group-focus-visible` 也挂了键盘路径，但没有用读屏走查过。
- **`ServingSparkProgressBar` 的 InlineBar 注释是过期文本**（写着「条一律占满该行剩余
  宽度（`flex-1`）」，而实现与守卫都是 `w-32`）。本次改写了该段注释使其与实现一致——
  这是注释修正，不是行为变更。

### 验证

- `npx tsc -b` → 通过；
- `npx tsx --test tests/api/*.test.ts` → **611 pass / 0 fail**（与改前基线同数）；
- `pnpm build:dsh` → 构建成功，`--base=/ldvh/`（未走 `build`，否则整页白屏）；
- 浏览器实拍 1440×1000（`/tmp/focus-goal-after.png`）、1024 窄容器
  （`/tmp/focus-goal-narrow.png`）、暗色主题（`/tmp/focus-goal-dark.png`）、
  标题悬停态（`/tmp/focus-goal-hover.png`）：四条子目标的行内条仍等宽、
  窄容器下分数不换行、暗色下陈述块的面与正文都随主题走。

### 七、同日后续修订：本节的三条排版决定被 Human 改掉（2026-11-03 晚）

本节写的是「两列网格 + 条在标题下一行」的形态。**同日 Human 看实拍后改了三条**，
当前实现与本节上文不同，以 `docs/02` §4.0 为准：

1. **行不再整行换行**：`flex-wrap` 关掉，标题在自己的格子里换行
   （`min-w-0 flex-1 break-words`）。整行换行会把进度组与展开按钮甩到标题下一行，
   四条子目标错成两种行高，扫读时「哪条走得远」对不上。窗口再窄，窄掉的是标题，
   不是标尺。
2. **进度组竖排、只留数字与条**：数字在上、条在下（`w-32` 定宽），屏上**不再渲染**
   口径名与两档明细——横排那一组会占掉子目标标题的宽度，窄屏下标题被挤成一列字。
   口径名仍在进度条的 `title` 与 `aria-label` 上（「火花落实 9 / 30」），两档明细仍可在
   子目标卡与详情页读到。

   > **本条已被第八节第 8 条改写**：两档明细在子目标卡与详情页**也不再呈现**了。
3. **子目标行除标题外默认收起，且展开区不含名下工作**：展开后只有达成条件（判据面）
   与对齐说明两块。名下工作那几十行是子目标卡与详情页的内容，摊在聚焦页会把
   「待决定事项」压到屏外。

本节其余三条（区头逐字同构、副标题撤掉交给进入箭头、标题 `ldvh-body` + `StatusBadge` +
不显示 `criterion_kind`、目标陈述块取本类型色）**继续有效**，未被本节撤回。

### 八、同日再修订：进度组收弱 + 展开区改为子目标卡那两块（2026-11-03 晚第二轮）

Human 看实拍后连改两处。**第七节第 2、3 条被本节改写**，其余仍有效，以 `docs/02`
§4.0 为准：

1. **进度组：数字弱而小、条更短、数字居中**（第七节第 2 条的续改）。
   - **数字**：次级色 + 11px（原 `ldvh-meta` 主色 12px），在条的正上方**居中**。
     比值是这一行的**附属信息**，主角是子目标标题——此前数字的视觉权重与标题相仿，
     读者先被两个数字抓住再读标题，顺序反了。口径没丢：完整说法仍在 `title` 与
     `aria-label`（「火花落实 9 / 30」）。
   - **条**：128px（`w-32`）→ 96px（`w-24`）。这一列是四条子目标**并排共用**的：
     尺子越长，每条标题能拿到的宽度越短。
   - **居中**：`items-center` + 数字 `text-center`。左对齐时「9 / 30」压在条头，
     读起来像条的左侧标注；居中后它就是**这条的分数**。
2. **展开区＝子目标卡那两块**（**取代**第七节第 3 条「展开区不含名下工作」）。
   Human 给的参照就是子目标卡：展开后是**判据面**（`criterion`）+ **名下的工作**
   （`serves` 反查的关联行，每类先展 3 条、可展开其余），与卡片同形同源
   （`components/SubGoalCardParts`）。
3. **展开区不给小标题、不给对齐说明**：Human 圈出了「达成条件」与「对齐说明」两处
   文字——判据面自带类型色，小标题是复述；对齐说明是**理由**不是判定，留在子目标
   详情页读（28 §12.1 的核对点在详情页）。随之：`focusV2.subGoalCriterionLabel` /
   `focusV2.subGoalAlignmentLabel` 两个词条（中英双侧）与 `SubGoalAlignmentNote`
   组件一并撤除（无消费方）。
4. **目标投影不再传 `alignment`**：聚焦页不呈现它，详情页读的是子目标对象本身。
   留一个无人读的字段，等于让读模型替读者做了个没人兑现的承诺。
5. **展开区不重复给进度**：比值常显在标题行上，同一条子目标不出现第二个比值
   （`docs/10` §5.5「同类信息只有一处」）。名下工作区以 `showProgress={false}` 调用，
   两档明细仍在子目标卡与详情页可读。

   > **本条末句已被第八节第 8 条改写**：两档明细不再在任何地方呈现。
6. **块形态（子目标卡／详情页）的说明行居中且弱化**（同日第三轮，Human 截图指认）。
   那一行「火花落实 9 / 30 · 已落实 9 · 待处理 21」是**这一块的注解**，不是这一块的
   标题——此前它左对齐贴边、且分数取主色（近黑），读起来像卡上的一个独立小标题。
   故两处同改：**居中**（浮在满宽条的正上方，条本身仍满宽——Human 选定「只把文字行
   居中」而非「整组连条一起收窄」）；**弱化**（分数由主色改为次级色，指标名与两档
   明细再降一档）。口径不因弱化而丢失：完整说法仍在条的 `aria-label` 上。

   > **本条已被第八节第 8 条改写**：两档明细整段撤除（分数再弱一档），说明行只剩
   > 「口径名 + 分数」。
7. **行内垂直基准＝标题那一条线**（同日第四轮，Human：「这里没垂直居中啊」）。
   Human 选定以**标题**为基准（而非以整行为基准），故行内每一件东西都落在标题的光心上：
   - **数字**：行盒由 `leading-4`（16px）改为 `leading-6`（24px），与标题 `ldvh-body`
     （14px/24px）同高。此前数字的光心比标题高 4px——同一条行里两条基线错开，扫读时
     「这个数说的是哪一条」要靠位置去猜。短词分支（「空集」「已处置」「读不到」）同样
     取 `leading-6`。
   - **条**：数字行盒变高后若顺延，条会被推离数字 10px、中间浮出一段空白；条上提 4px
     （`-mt-1`），仍挂在数字下方，整组高度（28px）与行高不变。
   - **chip**：次序 chip、状态 chip、legacy chip 各裹一枚 24px 盒子（`h-6`）——
     `ldvh-chip-sm` 是 18px 高的盒子，裸放时顶对齐于 24px 的标题行盒，盒心比标题光心
     高 3px；三枚小元素各偏一点，整行读起来就是「没对齐」。
   - **展开按钮**：内边距由 `py-1` 改 `py-0.5`，其 20px 内容盒居中后光心正落在标题线上
     （`py-1` 时按钮文字比标题低半行——同一行里两处文字错开半行，是最容易被眼睛抓住的
     那种不齐）。按钮仍有 24px 高（≥ WCAG 2.2 最小目标尺寸）。
   - **行仍取 `items-start`**（不 `items-center`）：标题换行时各项须对齐标题的**首行**，
     而不是整块居中到两行中间。

   实测（DOM 几何，第 4 行）：标题行盒 371..395（光心 383）、次序 chip 374..392（中心 383）、
   展开文字 span 373..393（中心 383）、条 395..399——四者同在 y=383。
8. **块形态：两档明细整段撤除，分数再弱一档**（同日第五轮，Human 截图圈出「已落实 5 ·
   待处理 8」：「圈出来的字不要，数字也要弱化」）。**第八节第 6 条被本条改写**，
   第五节与第七节第 2 条中关于两档明细的表述同样被本条改写。
   - **撤除两档明细**：「已落实 9 · 待处理 21」是分数的**算术展开**——两者加起来就是
     分母，读者自己对账即可。界面上多写这一段不是新信息，是同一件事的第二种说法
     （`docs/10` §5.5「同类信息只有一处」）；而它恰恰是这一块里最抢眼的一段文字。
     撤除后，块形态的说明行只剩**口径名 + 分数**（「火花落实 5 / 13」）。
   - **分数再弱一档**：由次级色（不透明度 1）降为**次级色的七成**
     （`text-ldvh-text-secondary/70`）。口径名此前已是次级色的六成，二者仍留一档
     层级差——分数是这一行唯一可核对的数（能按它去数名下的火花），口径名只是标注它
     是什么。口径不因弱化而丢失：完整说法仍在条的 `aria-label` 上。
   - **传参 prop 一并撤除**：`openLabel` / `implementedLabel` 两个 prop 及其三处调用点
     传参删除——留一个无人传的 prop，等于让读模型替读者做了个没人兑现的承诺。
   - **条不动**：仍是满宽（`w-full`），说明行仍居中在它正上方。

   实测（DOM 几何，子目标卡「插件能力面 dogfood 闭环」）：口径名 span x=680..728、
   分数 span x=736..779（「5 / 13」，`secondary/70`）、条 x=578..883（满宽 305px）——
   说明行中心 729.5 与条中心 730.5 对齐；英文态同形（Sparks implemented 5 / 13）。
9. **聚焦页近期动态与 Spark 健康度的每条记录改成卡**（同日第六轮，Human 截图指认：
   「这里的样式要和待决定事项一样，要有个外框，近期动态也一样」）。此前这两处的行
   **没有外框**——只有标题那一行套着标题带，于是同页里「待决定事项」读起来是整块有框
   的卡，另两个模块读起来像无框的流水账：标题带被当成了卡的外框，读者得自己把元信息
   行与时间戳行归到标题那条上去。
   - **共享卡框**：新增 `.ldvh-object-card-frame`（`rounded-lg border border-ldvh-border
     bg-ldvh-panel p-3`），**一处定义、三处共用**——对象列表卡（`ObjectCardFrame`）、
     聚焦页待决定事项卡、近期动态行、Spark 健康度行。原先 `ObjectCardFrame` 自己写着
     那串类名，现改为引用共享类：抄三份必分叉，分叉时没有机械判据说哪边才是对的。
   - **标题带保留**：卡框圈**整条记录**，标题带圈**标题本身**——两层不是一回事。撤掉
     标题带，标题就会变成与元信息行、状态徽标同级的一段裸文字，卡内层级塌掉。
     （`docs/01` §1.10 统一要求第 4 条本就这么要求。）
   - **卡间距取代分隔线**：两个列表的 `divide-y` 改为 `gap-3`——有外框之后，那条线是
     「框外的框」。
   - **文档**：`docs/01` §1.8.1 组件契约表新增「对象卡框」一行、§1.10 统一要求新增
     第 9 条；`docs/02` §4.2（近期动态）与 §4.4（Spark 健康度）各记一条。

   实测：Spark 健康度与近期动态两列并排，每条记录皆有外框；卡内仍是元信息行 →
   标题带 → 右对齐时间戳三层，与待决定事项卡同形。
10. **Spark 健康度池结构比例条区块去掉下边框**（同日第七轮，Human 截图指认：「这里有
    条分割线，要去掉」）。该区块原用 `border-y`，上下各一条线；但它的下边框紧贴第一
    张 Spark 卡的上边框——两条线相距不到两像素，叠在一起读成「框外的框」：卡本来就有
    自己的框，再在外面加一条线，卡就被读成了「被包着的卡」。
    - **只去下边框、保留上边框**（`border-y` → `border-t`）：上边框承担的是「池结构
      区块 vs 模块标题栏」的分节，去掉它整个区块会粘进标题栏；Human 红框圈住的只是
      下边框那一行。
    - **与第 9 条是同一条纪律的两面**：第 9 条把 `divide-y` 换成卡间距，这条把区块
      自身的下边框去掉——都是「卡之间不再有线」。
    - **文档**：`docs/01` §1.10 统一要求新增第 12 条（区块边框只作分节，不作卡间距）；
      `docs/02` §4.4 记一条。

    实测（截图像素）：改动后比例条下方只剩一行 `(225,227,232)` 的线，即第一张 Spark
    卡自身的上边框；原区块下边框 `(236,239,241)` 已不在。

#### 验证

- `npx tsc -b` → 通过；`npx eslint src/` → 0 error（9 条既有 fast-refresh warning）；
- Web 契约测试 → **613 pass / 0 fail**（新增「目标区行内垂直基准＝标题那一条线」一条）；
- 浏览器实测：中文 / 英文 × 收起 / 展开四态，窄窗口下四条子目标仍各占一行，
  数字在条上方居中、控制台 0 error；行内各项与标题同在 y=383；
- 块形态（第 8 条）实测：子目标卡与详情页的说明行只剩「口径名 + 分数」，两档明细
  已无处可寻；条仍满宽；中文 / 英文两态同形；控制台 0 error。
- 聚焦页卡框（第 9 条）实测：Spark 健康度与近期动态两列并排，每条记录皆有外框，
  卡内三层（元信息行 → 标题带 → 右对齐时间戳），与待决定事项卡同形；控制台 0 error。
- 池结构区块下边框（第 10 条）实测：比例条下方只剩一行 `(225,227,232)`，即首张 Spark
  卡自身的上边框；区块原下边框 `(236,239,241)` 已不在；上边框保留。

## 7. 帮助页从「流程说明」重设计为「使用引导」（2026-11-03，Human 定案）

### 一、为什么重做

原 `/help` 页承载的是一段 **「Vibe 开发步骤」七步流程说明**。它有三个问题：

1. **它教的是一套已经不在的系统**。七步里的第 3 步与第 5 步让读者「使用讨论模块与 AI
   进行讨论」——**讨论业务系统已于 2026-10 由 Human 决定删除**，该职责归主控本职（见
   `specs/04` 方案收敛自查条）。照着做的人会去找一个不存在的模块。
2. **它把「构成」讲成了「流水线」**。LDVH 的构成是**两类语义构成要素**（规范源与事实源）
   加上**技术与机械保障**（`specs/00` §3），不是一条必须照走的流程。七步叙述把「怎么做事」
   当成唯一入口，反而把更该先知道的四件事压在后面：这套系统在解决什么、内容会落成什么
   形态、AI 什么时候会停下来找我、凭什么说它说完了。
3. **它覆盖不足**。七大业务系统里它只讲到约三个；双源召回、经验积累、摩擦销账，以及
   规范 / 开发日志 / 决策记录这些对象都没有出现。人在页里找不到自己要用的那一类。

### 二、三个方向决定（Human 裁定）

| 决定项 | 裁定 | 落点 |
|---|---|---|
| 主职 | **教怎么用**——先让人知道这套系统在解决什么、与 AI 配合时内容落成什么形态、AI 什么时候会停下来找他 | 概览两块 + 四个分区 |
| 页面形态 | **概览在上 + 下方 sticky tab 切换四个主题** | `ldvh-page-frame` → 概览 → sticky `ldvh-tab-list` → 四分区 |
| 旧七步流程 | **移除**，改写为与实际系统一致的推进主线 | 主线六段；旧结构与旧词条一并撤除 |

### 三、内容结构

**上方概览（常显）**

- **「这套系统解决什么」**：三张卡，对应 `specs/00` §1 的三类问题——AI 靠不住、人接不住
  也留不住、双方互相放大误差。每卡分「症状」与「接法」两段：症状用 `ldvh-body-muted`，
  接法用 `ldvh-body`，不再额外配色。
- **「与 AI 配合的主线」**：一个面板内六格（`ldvh-subgrid`），读起来是**一条链**而不是六张
  独立卡。目标是想法、调研、决定、执行、积累；每格带承载对象入口，面板末尾附双源召回
  说明（`specs/00` §3.4）。
- **主线不给编号**：六段之间没有来源已成立的先后序号（`docs/01` §1.5 第 12 条），用类型
  图标而非数字徽标表达形态；引导语明说「不是必须照走的流水线」。

**下方四个分区（sticky 切换）**

| 分区 | 内容 | 来源 |
|---|---|---|
| 对象地图 | 九类事实对象各三行：**它是什么 / 什么时候产生 / 你去看什么** | 各事实类型规范的 §1 定位与字段边界 |
| 何时停下来找你 | `specs/07` §6 的五类交互入口（结构化问询、计划审查、授权流、验收交还、登记管理）各给「触发条件 + 你的响应契约」；随后是 `specs/00` §5.7 的必停情形 | `specs/07` §6、`specs/00` §5.7 |
| 入口地图 | 左侧导航里**不指向事实对象**的六个入口（聚焦、目录、变更、提交、诊断、全部项目） | 本仓路由与各页自身职责 |
| 怎么判断它说完了 | 声明三层（已证实 / 未证实 / 残留风险）、不能单独证明完成的七件事、值得退回去重问的四种情形 | `specs/00` §5.6、§5.7 |

**两个口径**

- **对象地图必须与左侧导航的事实对象族一一对应**：少一类＝有一个入口没被解释，多一类＝在
  讲不存在的东西。守卫第 4 条直接比对 `Sidebar` 的 `/objects/:type` 集合。
- **「提交」不是事实对象**，它归「入口地图」；两处不重复。

**长内容分层**：同一时刻只呈现一个分区，长内容不一次铺满（`specs/07` §12 第 7 条）。切换
分区后，分区起点被带到切换区正下方——否则人在长页里点切换，视口停在旧位置，看到的是新
分区中段而不是开头。切换区在窄屏会折行变高，故按**实测高度**设 `scroll-margin-top`，
不写死高度。

### 四、版式契约

- **不套对象卡框契约**：`docs/01` §1.10 第 9 条针对的是「呈现一条对象记录」，本页没有事实
  对象记录，故用 `ldvh-panel` + `ldvh-section-grid`，而非 `ldvh-object-card-frame`。
- **不用渐变英雄区与大留白**（`docs/01` §1.8.1）；不用视口断点类（§1.6.1 第 3 条，列数由
  容器宽度决定）；不用任意字号（§1.4）；不用单侧粗边框（§1.10「色彩和状态」第 7 条）。
- **图标单一真源**：对象类型走 `ObjectTypeIcon` + `getCategoryColor`；导航入口图标收进
  `SemanticIcon.tsx` 新增的 `NAV_ICONS`，`Sidebar` 与本页共用一份，落实 `docs/09` §8。
- 页脚常驻一条声明：本页是描述性引导，不构成规则源（`specs/00` §3.2、§3.3）。

### 五、守卫

新建 `plugin/web/tests/api/help-presentation-contract.test.ts`，七条：

1. 不得退回营销式英雄区（禁渐变与装饰光晕；正向要求 `ldvh-page-frame` /
   `ldvh-page-toolbar` / `ldvh-section-grid` / `ldvh-subgrid` / `ldvh-tab-list`）；
2. 不得用视口断点类、任意字号、单侧粗边框；
3. 对象类型图标与导航图标必须走集中映射（`Sidebar` 不得直接 import 那五个导航图标；本页
   不得内联九个类型图标）；
4. **对象地图必须与 `Sidebar` 的 `/objects/:type` 集合完全一致**；
5. 中英词条集合必须一一对应，四个 tab key 与页脚声明必须存在，**旧流程词条不得复活**；
6. **英文 help 词条不得用直双引号**（须用弯引号 `“ ”`，与中文侧 `「 」` 对位）——
   这条是随「英文文案引号改弯引号」一并加的：规则写进了设计文档，就得让机器盯着；
7. 不得硬编码中文文案（扫 JSX 文本节点），不得发起任何请求。

反向断言只查代码位：先剥注释再断言，否则会被「解释为什么撤掉旧结构」的注释判红（本仓已
有同类事故，见 §4unvicies 追记）。

### 六、连带改动

- `src/pages/Help.tsx`：整体重写。
- `src/i18n/locales.ts`：`help.vibeSteps.*` 与 `help.step.*` 全部词条**删除**（不只是不用
  ——留着就可能被无意复活）；新增 123 个 `help.*` 词条，中英各一套。
- `src/components/SemanticIcon.tsx`：新增 `NAV_ICONS`（七个非对象类导航入口图标）。
- `src/components/Sidebar.tsx`：`NAV_ITEMS` 与 `FEDERATION_NAV_ITEMS` 改用 `NAV_ICONS.*`。
- **文档**：新建 `plugin/web/docs/14-Help.md`；`docs/10` §3 表「帮助」行与 §3.1 矩阵
  「Help」行改写并指向新文档；`docs/01` §2 页面索引新增「帮助 | `/help` | 14-Help.md」；
  本文 §3 路由矩阵新增「帮助」行。

### 七、如实登记

- **窄屏实拍到 585px，375px 仍未实拍**：本次重设计在 1280×720 与 585×1318 两个视口下实测。
  585px 下概览三卡与主线六段都正确折叠为单列，标题与承载对象仍相邻。375px 未实拍——
  浏览器窗口最小可到 585px，键盘缩放对嵌入页不生效。补测时看两处：主线格单列时标题与
  承载对象是否仍相邻、切换区折行成两行后 `scroll-margin-top` 是否仍等于实测高度。
- **切换区吸顶，取决于页面够不够长**：`position: sticky` 只在「切换区被滚过视口顶」之后
  才吸顶。分区较短时（如入口地图），页面总高不足，切换区根本滚不出视口顶——此时它与分区
  内容同屏可见，本来就不需要吸顶。585px 视口下内容更高、可滚动距离也更短，实测切换区始终
  留在视口内（最远离顶约 180px）。**这不是 sticky 失效，是页面不够长**——本轮曾据 585px
  实拍误判为「sticky 没生效」，用 `/changelog` 页同样的 `sticky top-0 … -mx-6 -mt-6` 写法
  做对照才定位清楚（对照页在 1280 宽下滚 600px 仍钉在 y=12）。**别按「切换区没吸顶」去改
  样式**，先量页面总高与可滚动距离。

### 验证

- `npx tsc -b --pretty false` → 通过；
- `npx eslint src/` → 0 error（9 条既有 fast-refresh warning，与改前基线同数）；
- Web 契约测试全量 → **622 pass / 0 fail**（其中不含本轮新增守卫的既有 615 条全部通过，
  新增守卫 7 条）；
- 插件全量测试 → **2764 pass / 0 fail**（1 skipped / 1 todo，与改前同）；
- 浏览器实测（1280×720）：四个分区全部正常渲染，切换区吸顶（按钮落在 y=12），切换分区后
  分区起点紧贴切换区下方；入口地图分区较短时切换区与内容同屏可见；英文态无中文泄漏；
  控制台 0 error / 0 warning。
- 浏览器实测（585×1318）：概览三卡与主线六段单列折叠正确，标题与承载对象相邻，四个分区
  切换正常。
- 英文文案引号改为弯引号（`“ ”`），与中文侧 `「 」` 对位（同 `settings.removeConfirm` 先例）。

## 8. 帮助页补入七大业务系统的功能与用法（2026-11-03，Human 追加要求）

上一节把帮助页从「流程说明」重做成「使用引导」，落的是**形态**（对象类型）与**入口**
（导航）。Human 追加要求：「各个系统的功能和用法，你要加上去」。经 `ask_user` 裁定两项：

- **范围**＝LDVH 七大业务系统（`specs/00` §3.4、`specs/03` §9.1–§9.7）；
- **放置**＝**新增第五个分区**，不塞进既有分区。

### 一、为什么单列第五分区

页面其余部分讲的两件事，与「系统怎么用」不是同一件事：

- **对象地图**讲「形态」——一条事实记录长什么样；
- **入口地图**讲「入口」——去哪里看；
- **七大业务系统**是**规范层的过程**——它们各管一段业务过程，结论最终落在对象上，
  但**系统本身不是对象**。

所以「对象是什么」与「这件事由谁管、你怎么用」是两道题。把系统说明混进对象地图，是把
过程讲成了分类学；混进入口地图，是把规范层的分工讲成了产品导航。因此单列第五分区。

这一分区**不是七个页面的说明书**：它讲职责边界与 Human 的参与点，不讲「你在哪个页面点
哪里」。

### 二、每格固定四行

每张系统卡是四行 `dl`，不是自由段落：

| 行 | 讲什么 | 依据 |
| --- | --- | --- |
| 它管什么 | 该系统的职责 | `specs/03` §9.x「职责」 |
| 你怎么用 | Human 在这个系统里的参与点 | §9.x「判据」+ Human 决定权（`specs/00` §4） |
| 落到哪里 | 该系统结论的承载对象（可点开） | §9.x「机制指向」 |
| 它不保证什么 | 该系统的边界 | §9.x「边界」 |

**第四行不是客套**。每条边界都是防自欺条款——「登记了」不等于「推进了」、「召回命中」
不等于「适用」、「预检做完」不等于「行动完成」。它与「怎么判断它说完了」分区是同一件事的
两个落点：一个讲每个系统各自不保证什么，一个讲整体上凭什么信。

### 三、双源召回的特例

`specs/03` §9.5 的双源召回是**横切**其余六个系统的过程，不留独立对象。因此它的「落到
哪里」给**文字说明**（「不留独立对象——它决定的是接下来怎么动。」）而不是对象链接。

实现上把 `SYSTEM_MAP[].landing` 定为**可选字段**：有承载对象的六个系统不写这个字段，
不留死词条（写了不显示的词条，就是给将来的某个编辑埋一个「它为什么没出来」的坑）。

### 四、图标：另立 `SYSTEM_ICONS`

七大业务系统没有对象身份可继承 `OBJECT_TYPE_ICONS`，故在 `SemanticIcon.tsx` 另立
`SYSTEM_ICONS`（7 项），落实 `docs/09` §8「图标映射集中在 `SemanticIcon.tsx`，页面不得散落
图标选择」：

| 系统 | 图形 | 选形理由 |
| --- | --- | --- |
| 目标规划 | Waypoints | 一条方向上的多个判定站点（与 subgoal 的单个 Milestone 路标区分） |
| 火花记录 | Sprout | 还没定型的念头（与 spark 对象的 Sparkles 星芒区分：那是登记之后的形态） |
| 工单执行 | Cog | 批准之后才转起来的机制（与 workcase 的 Shovel 铲子区分：铲子是载体，齿轮是机制） |
| 调研吸收 | Telescope | 朝还没掌握的方向看（与 research 的检索式图形区分：那是报告载体） |
| 双源召回 | Combine | 两股并成一股当前约束；横切过程，图形不能是任何一件东西的形状 |
| 经验积累 | Library | 沉下来能反复取用的存量（与 pitfall 的醒悟区分：那是一次教训，这是收起来的样子） |
| 摩擦销账 | Receipt | 一笔一笔记着的账（与 friction 的蜗牛区分：蜗牛是阻碍的体感，票据是它在账上的样子） |

七个形与既有全部图标（对象类型九个、导航入口七个）**错开形**，不靠颜色区分。

### 五、守卫：九条规则、八个测试块

`plugin/web/tests/api/help-presentation-contract.test.ts` 的规则清单由七条扩到**九条**（测试块
八个——规则 2「旧流程不得复活」并进中英词条测试，规则 7「零数据请求」并进末条测试）。本轮
新增与扩充的是：

- **规则 5「图标走集中映射」扩充**：帮助页不得内联那七个 lucide 图形、须经 `SYSTEM_ICONS[`
  取用；且 `SYSTEM_ICONS` **必须登记齐帮助页用到的全部系统键**——少登记一个，那张卡的图标
  就是 `undefined`，页面静默塌成空白而不报错。
- **规则 9「系统清单必须与规范源一一对应」（新增）**：**直接读 `specs/03` §9.1–§9.7 的节标题**
  与页面 `help.systems.*.title` 的中文值做集合比对。

**为什么读规范源而不写死名单**：规范改名时守卫跟着变，页面必须同步改；写死名单则规范改了
页面不改，两边悄悄分叉而无人察觉。规则 9 的前提是**系统名与规范标题逐字一致**（不加「系统」
后缀），使集合比对退化为纯等值比较。

### 六、变异三连（`docs/12` §2）

| 变异 | 期望 | 实测 |
| --- | --- | --- |
| 页面系统名写错 | 判红（规则 9） | ✅ |
| `SYSTEM_ICONS` 少登记 `friction` | 判红（报出未登记键） | ✅ |
| 帮助页内联 `Waypoints` | 判红（规则 5） | ✅ |
| 规范标题尾随空格 | 放行（不误伤） | ✅ |
| 规范标题 CRLF | 放行（不误伤） | ✅ |
| 规范给系统改名、页面未同步 | 判红（证明读的是规范源） | ✅ |

每次变异后立即还原，`specs/03` 已核对干净、本轮未改动该文件。

### 七、连带改动

- `src/pages/Help.tsx`：新增 `SYSTEM_MAP`（7 项）与 `SystemsPanel`；`TABS` 由四项增至五项。
- `src/components/SemanticIcon.tsx`：新增 `SYSTEM_ICONS`（7 项）。
- `src/i18n/locales.ts`：新增 34 个 `help.systems.*` 词条 × 中英 = 68 条。
- `tests/api/help-presentation-contract.test.ts`：规则清单扩到九条，新增规则 9。
- **文档**：`docs/14-Help.md` 同步第五分区（含「已知边界」新增一条：七个系统的分工仍在演化，
  守卫只保证集合与名称一致，不保证逐句转述相符）；`docs/10` §3「帮助」行与 §3.1「Help」行
  改写为五主题 + 七个业务系统。

### 八、如实登记

- **375px 仍未实拍**：本轮实拍 584×1280 与 1280×720（英文态切换区折成两行时
  `scroll-margin-top` 仍按实测高度留位）。浏览器窗口最小可到 584px，键盘缩放对嵌入页无效。
- **规则 9 的保证边界**：它保证**集合与名称**与规范源一致，不保证页上对每条职责的**转述**
  与规范逐字相符——转述的准确性由人工与规范评审承担。守卫文件头部已声明这条边界。
- **precheck 的 `signature-traceability` 仍是唯一 gap**：standalone 进程拿不到宿主
  `sessionPersistence` 服务，trailer 按当次实际调用值写 `minmax` / `MiniMax-M3.1-Flash`。
  历轮一致的既有状态，非本轮新增。

### 验证

- `npx tsc -b --pretty false` → 通过；
- `npx eslint src/` → 0 error（9 条既有 fast-refresh warning，全在未改动的
  `FactAssociationRows.tsx`，与改前基线同数）；
- Web 契约测试全量 → **623 pass / 0 fail**（既有 622 全部通过 + 本轮新增规则 9）；
- 插件全量测试 → **2764 pass / 0 fail**（1 skipped / 1 todo，与改前同）；
- 浏览器实测（584×1280，中文态）：五个切换项在 584px 宽仍一行排得下；七个系统卡全部渲染
  正常；双源召回那格给文字、其余六格给对象链接；sticky 切换区吸顶；控制台 0 error / 0 warning。
- 浏览器实测（584×1280，英文态）：切换区折成两行，`scroll-margin-top` 仍按实测高度留位；
  英文系统名与四行标签无中文泄漏；引号为弯引号 `“ ”`。

## 9. 帮助页整页 tab 化并统一版式（2026-11-03，Human 定案）

Human 在前两轮之后指出：「整个帮助的页面 要有 tab 的形式，你再通盘考虑一下信息的呈现与
组织，包括样式，现在还是凌乱」。经 `ask_user` 裁定三项：

- **Tab 分法**＝概览收成第一个 tab，共 6 个 tab（整页统一为一个 tab 容器）；
- **条目呈现**＝统一成一套卡 + 纯列表改行式；
- **Tab 标签**＝统一成疑问式短标签。

### 一、先诊断：乱的根源不是某张卡不好看

通盘读代码与渲染后，乱的来源有六处，**没有一处是单张卡的配色或圆角问题**：

1. **两套组织范式挤在一页**：上方两块常显概览 + 下方五个分区。tab 的价值是「一次只
   呈现一件事」，被上面两屏常显内容抵消；进页面第一眼看到的是内容而不是导航。
2. **切 tab 要滚页面**：因此才需要 `scrollIntoView` + 动态算 `scroll-margin-top` 这套
   补偿逻辑。整页 tab 化后它可以大幅简化。
3. **卡片壳有六种**：概览卡（两段自由文字）、对象卡（三行定义 + 底部链接）、入口卡
   （一段 + 底部链接）、系统卡（四行定义）、Gate 卡（两行定义）、信任层卡（无图标）。
   留白、标题行与链接位置各不相同。
4. **标题层级撞车**：h3 既当卡片标题，又当「信任」分区里的小标题用；同一页出现
   h1 → h2 → h3 → h4 四层，意义不统一。
5. **列宽基准三个**：`ldvh-section-grid`（20rem）、`ldvh-subgrid`（16rem）、
   `ldvh-panel-grid`（22rem）。
6. **长列表是三堵墙**：必停 5 条、不能证明完成 7 条、值得退问 4 条，单列排下来是
   十六行文字，条目之间没有分界。

### 二、整页单一 tab 容器

页面改为：**页头 → 常驻声明 → sticky 切换区 → 分区内容**，只有一种组织方式。

- **声明上提**到页头正下方：它是**页面级**限定（规则在规范源、事实在事实源），与分区
  内容无关；压在长分区末尾等人滚到底，等于没有这一条。
- **切 tab 的补偿逻辑简化**：原先「切完把分区起点滚到切换区下方」在整页 tab 化后变成
  「分区起点不在切换区下方可见时才滚」——刚进页面点一下切换不再把页头顶掉。
- **概览收成第一个 tab**：三张短板卡与六段主线都在这个分区里。

### 三、标签与标题的分工

六个标签统一成**疑问式短句**：这是什么 / 有哪些东西 / 事情怎么推进 / 什么时候该你出面 /
去哪儿看 / 怎么判断可信。原先五个标签词性不齐——「对象地图 / 入口地图」是名词，
「何时停下来找你 / 七个系统怎么用 / 怎么判断它说完了」是句子，混排读起来像三套命名。

标签给切换区（窄屏会折行，必须短），分区标题给内容（读者落在这里，要知道自己回答
哪一问）。标题写成**完整问句**（「这是什么：LDVH 的构成与运作方式」），与标签不重复——
标签问「有什么」，标题补「具体是哪些」。

### 四、呈现件唯一

- **一种卡片壳**：概览卡、对象卡、系统卡、入口卡、Gate 卡全部由同一个组件产出
  （标题行 = 图标 + 名称；定义行 = `dl` + `ldvh-caption-strong` + `ldvh-body-muted`；
  可选去往区）。此前六种壳并排，读起来像六个页面。
- **一种行式列表**：主线六段、声明三层、必停五条、不能证明完成七条、值得退问四条，
  全部走同一个行式壳——一个面板，行与行之间一条细线，渲染为 `ul`/`li`（本页的行式
  清单全都是列表，所以行就是列表项，语义不留给读屏器猜）。
- **一个网格基准**：只保留 `ldvh-section-grid`；`ldvh-subgrid`（主线格改行式后不再
  需要）与 `ldvh-panel-grid`（信任分区的两列改用同一个 section-grid）从本页退场。

### 五、标题层级固定为 h1 → h2 → h3

- h1 = 页头（`ldvh-page-title`，18px）；
- h2 = 分区标题（`ldvh-card-title-prominent`，16px semibold），全页恰好一个；
- h3 = 条目标题（`ldvh-card-title`，16px medium）；
- **分组标签不是标题**：它是「这一组讲什么」的眉标，用 `ldvh-section-title` 渲染成一行
  普通文本（`<p>`），不占标题层级。这样既没有 h2 → h4 的跳级，也没有 h3 一身二职。

顺带修掉一处视觉问题：卡片标题行原用 `items-center`，英文态标题折成两行时图标落到
第二行旁边，读起来像是配错了条目；改为 `items-start` 加 4px 下移，对齐首行字冠。

### 六、守卫：九条增至十二条（十一个测试块）

本轮新增三条：

- **规则 10「整页必须是单一 tab 容器」**：切换区只能一处；六个分区各一个条件渲染分支；
  **切换区之前不得出现任何常显内容区块**（判据是「切换区之前出现了内容渲染件」，不认
  组件叫什么，所以把概览换个组件名搬回常显区照样判红）；声明必须在切换区之上。
- **规则 11「呈现件必须唯一」**：`<article` 只允许一处；卡片壳类串只允许一处；行式
  列表壳类串只允许一处；不得出现第二个网格基准。
- **规则 12「标题层级必须是 h1 → h2 → h3」**：h2 恰好一个；不得出现 h4 及更深。

**判据按类串计而不按组件名计**是有意的：只改组件名（改名型变更）不应当把守卫打红，
这是 `docs/12` §2 的「改名型跟着变」。旧规则 1 里「主线格须走 `ldvh-subgrid`」一条随
主线改行式一并撤除（`ldvh-subgrid` 在本页已无使用场景）。

### 七、变异三连（`docs/12` §2）

| 变异 | 期望 | 实测 |
| --- | --- | --- |
| A1 概览搬回切换区之上常显 | 判红（规则 10） | ✅ |
| A2 声明移到页面末尾 | 判红（规则 10） | ✅ |
| A3 引入第二种卡壳 | 判红（规则 11） | ✅ |
| A4 引入第二个网格基准 | 判红（规则 11） | ✅ |
| A5 条目标题降级成 h4 | 判红（规则 12） | ✅ |
| A6 出现第二个 h2 | 判红（规则 12） | ✅ |
| B1 行式列表改用 `ol`（仍是列表） | 放行（不误伤） | ✅ |
| B2 分区渲染顺序调整 | 放行（不误伤） | ✅ |
| C1 卡壳组件改名 | 放行（改名型跟着变） | ✅ |

九项全部符合预期，且**每项都由目标规则本身拦下**（A1 曾先被「不得硬编码中文文案」规则
拦下，已把变异体的中文改成英文后重测，确认拦它的是规则 10 本身）。每次变异后立即还原，
源文件已核对干净。

### 八、连带改动

- `src/pages/Help.tsx`：整体重写。
- `src/i18n/locales.ts`：五个 tab 标签改写、新增 `help.tab.overview`；新增六个
  `help.panel.*.title`（分区完整问句）；新增 `help.overview.symptomLabel` /
  `help.overview.answerLabel`（概览卡的两行定义标签）、`help.entries.whatLabel` /
  `help.entries.goLabel`（入口卡标签与「去看看」去往标签）；`help.subtitle` 改写。
- `tests/api/help-presentation-contract.test.ts`：规则清单由九条扩到十二条（十一个测试
  块）；中英词条测试的必需 key 列表由五个 tab 扩到六个 tab + 六个分区标题。
- **文档**：`docs/14-Help.md` 按新结构重写（§1 改为「整页单一 tab 容器」，§2 改为六分区
  表，§3 版式契约加「卡片壳只有一种 / 行式列表 / 图标顶端对齐」，§4 内容纪律加第 8 条，
  §5 已知边界重写）；`docs/10` §3「帮助」行与 §3.1「Help」行改写。

### 九、如实登记

- **本轮未能在窄视口复测**：嵌入面板宽度固定在 1280×720，无法调窄；本轮实拍
  1280×720 中英双态。窄屏结论**沿用上一轮实测**（584×1280、585×1318）——本轮版式改动
  不触及窄屏的两处敏感逻辑：卡片列数仍由 `ldvh-section-grid` 按容器宽度决定（未换网格
  基准），切换区折行后的 `scroll-margin-top` 仍按**实测高度**动态取值（未写死高度）。
  **但这是推理不是实测**，补测时看两处：六个切换项在 584px 宽是否仍一行排得下（英文态
  必折行）、折行后切换分区是否仍落在切换区正下方。
- **英文态卡片标题折行**：英文 tab 标签更长但 1280 宽仍一行排得下；卡片标题折成两行时
  图标已改为对齐首行。
- **precheck 的 `signature-traceability` 仍是唯一 gap**：standalone 进程拿不到宿主
  `sessionPersistence` 服务，trailer 按当次实际调用值写 `minmax` / `MiniMax-M3.1-Flash`。
  历轮一致的既有状态，非本轮新增。

### 验证

- `npx tsc -b --pretty false` → 通过；
- `npx eslint src/` → 0 error（9 条既有 fast-refresh warning，全在未改动的
  `FactAssociationRows.tsx`，与改前基线同数）；
- Web 契约测试全量 → **626 pass / 0 fail**（既有 623 全部通过 + 本轮新增 3 条）；
- 插件全量测试 → **2776 pass / 0 fail**（1 skipped / 1 todo）。基线较上一轮的 2764
  增加 12 条，原因是**并发会话在同一工作区**落了两笔 pitfall/workcase 相关提交，与本轮
  帮助页改动无关；本轮未触碰 `plugin/lib` 与 `plugin/test`。
- 浏览器实测（1280×720，中文态）：六个切换项一行排得下；六个分区全部正常渲染；分区
  标题为 h2、条目标题为 h3（读屏语义树已核）；sticky 切换区吸顶；控制台 0 error /
  0 warning。
- 浏览器实测（1280×720，英文态）：六个切换项一行排得下；折行卡片标题的图标对齐首行；
  无中文泄漏；引号为弯引号。
