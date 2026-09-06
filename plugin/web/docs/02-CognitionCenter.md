# 聚焦（内部概念：项目认知中心）

> 路由：`/`（已实现，由 CognitionCenter 服务，取代原 Dashboard）
> 状态：三期均已完成；当前页面包含「待决定事项」「推进中事项」「Spark 健康度」「近期动态」「近期热点关系」五个模块
> 目标源码：`web/src/pages/CognitionCenter.tsx`（取代 `web/src/pages/Dashboard.tsx`，原文件已移除）
> 目标 API：`GET /api/cognition`（新建，取代 `GET /api/dashboard`）
> 文件名说明：本文取代原 Dashboard 设计文档；文件名、`web/docs` 引用与相关测试契约的更名已在第一期实现中完成。

## 0. 变更决定记录（按 08 §9）

本次改动是有意改变可观察行为，不属于行为保持型重构。按 08 §9 记录决定要素：

| 要素 | 内容 |
|---|---|
| 变更对象 | 路由 `/` 页面及其聚合 API 的可观察行为、左侧导航第一项的名称与图标 |
| 变更前 | Dashboard 仪表盘：态势摘要行、对象统计网格、待推进、最近提交、最近活动 |
| 变更后 | 项目认知中心：待决定事项、推进中事项、Spark 健康度、近期动态、近期热点关系五个只读模块与全局信任标记 |
| 作用范围 | 路由 `/`、由 `GET /api/dashboard` 迁移到 `GET /api/cognition`、左侧导航第一项、由 `dashboard.*` 迁移到 `cognition.*` 的 i18n key；对象列表、对象详情、提交记录、ProjectFiles、右侧扩展阅读、复制语义与 i18n 规则不变 |
| 当前来源支持 | 00 §6 的 HV1-HV5、§7 第 3 条（Web 交互协作为 Human 提供直接价值）；08 §1；`web/docs/01-全局设计约束.md` §1.2.1（第一入口已确认，仍不写死其余入口） |
| Human 决定 | 2026-07-29 Human 在 AI 对话中明确决定：废弃仪表盘，以项目认知中心取代；设计细节以本文为准 |
| 验收依据 | 本文 §10 验收标准 + 范围匹配的 API、组件与代表性浏览器测试（08 §10 对应行） |
| 明确不变范围 | 五个基准模块（提交、研究、决策、火花、经验）与 WorkCase 阅读形态不因本变更改动；本变更不新增事实源、状态机、对象类型、写入白名单或 Human Gate 结论 |

### 0.1 2026-07-30 导航可见名与图标微调（Human 决定）

本次为有意的可见标签与图标变更，不改变路由、API、页面模块或内部概念名（仍为「项目认知中心」）。按 08 §9 记录：

| 要素 | 内容 |
|---|---|
| 变更对象 | 左侧导航第一项可见名（nav.cognition）、页面标题（cognition.title）、导航图标 |
| 变更前 | 可见名「项目认知中心 / Cognition Center / Project Cognition Center」，图标 `Compass` |
| 变更后 | 可见名「聚焦 / Focus」，图标 `LayoutDashboard`（换回 Dashboard 时期的图标） |
| 作用范围 | 仅 i18n 显示文案与 `Sidebar.tsx` 图标；路由 `/`、GET /api/cognition、页面模块、文档名 `02-CognitionCenter.md`、代码文件名 `CognitionCenter.tsx` 与内部概念名不变 |
| Human 决定 | 2026-07-30 Human 在 AI 对话中明确决定：导航可见名改为「聚焦」，图标换回 `LayoutDashboard` |
| 验收依据 | 切换 zh/en 后导航第一项与页面标题显示「聚焦 / Focus」，图标为 `LayoutDashboard`；其余页面与文档引用「认知中心」不变 |
| 明确不变范围 | 内部概念名、文档与代码文件名、API、页面模块、09 规范中「项目认知中心」的对象类型命名不变 |

### 0.2 2026-07-30 收件箱复用事实 Card 与次级阅读

待决定事项不是第二套对象摘要。收件箱使用 `ldvh-section-grid` 与其它事实对象一致地按容器宽度排成多列；每项直接复用其对象列表 Card 的身份、状态、标题和正文，不把完整事实字段改写为聚焦页专属材料，也不叠加聚焦页专属条目操作。聚焦页只在模块层新增待确认集合、观察信息和复制模块摘要；点击标题不跳转路由，而是在右侧（Compact 时底部）展开同源次级阅读。属对既有设计原则的收敛，不改变来源或只读边界。

模块默认展开；Human 可通过标题带右侧的折叠按钮收起整个待决定事项正文。收起态仍保留模块名、总数与复制模块摘要，使后续模块可继续阅读而不丢失当前待决规模。

## 1. 页面目标

聚焦页是 LDVH 面向 Human 的项目认知入口，内部概念和源码仍使用 Cognition Center。当前价值判断以 `specs/00-理念与构成.md` §6 的 HV1-HV5 为上位来源；本页只按实际机制声明直接承接或提供材料：

| 标准 | 名称 | 本页承接与边界 |
|---|---|---|
| HV1 | 决策提请清晰可决 | 待决定事项汇集当前 Human Gate 与 draft Pitfall，复用同源 Card、次级阅读和模块摘要呈现决定对象、依据、处理入口及可见缺口；页面不补造选项或结论 |
| HV2 | 授权执行受控可续 | 推进中事项呈现 WorkCase 的当前推进位置、阻塞和接续入口；对已获批对象，完整授权基线与边界仍进入同源次级阅读核查，页面不把推进状态解释为新增授权 |
| HV3 | 入档闭环节点可验 | 待决定事项呈现当前 Human Gate，Spark 健康度呈现状态分布和静默 open 条目；被展示对象可进入同源阅读核查。页面不提供完整生命周期日志或全部终态明细，对象存在或计数不等于闭环完成 |
| HV4 | 积累效用直观可见 | **尚未完整承接**；近期热点只能显示哪些对象在事实流水中活跃及其正式关系，不能证明积累被实际使用或复用、产生可观察效用 |
| HV5 | 项目演进脉络可循 | 近期动态与近期热点关系提供明确时间窗口内的事实流水和一跳正式关系材料；本页不串联长期意图、关键决定、重要工作和结果，不声明完整 HV5 已成立 |

`ldvh-base/sparks/spark-0037.yaml` 继续保存旧 H1-H6 的形成历史和 2026-07-31 取代记录，但不再是当前价值标准来源。本文不得从该 Spark 的历史摘要恢复旧名称、编号或能力声明。

页面边界：LDVH 不代替 Human 形成认知或作出决定，只提供方法与工具。本页以同源呈现、稳定引用、派生说明和降级范围帮助 Human 核查当前信息；决定、授权、验收与方向判断仍由 Human 作出，决定的作出与回写只发生在 AI 对话与受控写入路径中。模块可见、对象数量或复制摘要均不自动证明 HV1-HV5 中任一价值已经完整成立。

## 2. 设计原则

1. HV1-HV5 是当前 Human 价值判断框架，不是功能清单。每个模块只按 §1 声明其实际直接价值或支持范围，不因页面已实现就扩大为整项价值成立；HV4 缺口保持可见。
2. 默认只读。本页不提供批准、关闭、分流、处置或任何可能改变项目状态的控件；每条目只提供查看详情、复制引用、复制摘要。
3. 一切从既有字段派生。不新增事实字段、状态、对象类型；所有聚合、计数、筛选、排序与"未关联"检测都是派生信息，如实标注来源、转换规则与遗漏范围。
4. 继承五个基准模块与 WorkCase 阅读形态的设计语言；新增组件使用同一套 `ldvh-*` 语义类、复制语义、扩展阅读与 i18n 契约，不另起视觉和信息秩序。

## 3. 页面结构

```text
页面标题：聚焦 / Focus + 页面说明
模块一 待决定事项（全宽主面板，置顶）
推进中事项（全宽主面板，紧随待决定事项）
模块四 Spark 健康度 + 模块二 近期动态（宽容器并列；窄容器单列；健康度优先）
模块三 近期热点关系（全宽主面板）
```

- 模块顺序固定，不按数据有无重排；未建设模块不显示占位（§11 分期）。
- 所有模块按真实内容高度收口；热点关系模块不得吸收剩余视口高度，也不得把关系簇或关系簇网格拉成空画布。内容不足一屏时，剩余区域只是不可滚动的页面背景；不得为了填满宽屏而放大节点间距、制造无信息占位或扭曲关系图。
- 待决定事项始终置顶，推进中事项紧随其后；其它模块只按通用容器网格的真实可用宽度自然换列，不维护 Compact 专属排列。
- 模块与待决定事项 Card 使用 `ldvh-section-grid` 容器宽度驱动列数，不以 `lg:` 视口断点作为唯一依据；右侧次级阅读打开时列数随容器收缩。
- 页面不设置"重新读取"控件；进入路由或切换语言触发新的直读请求，不复用旧 payload、对象 `updated_at` 或浏览器渲染时刻冒充新观察。

## 4. 模块规格

### 4.1 模块一 待决定事项（HV1 决策提请清晰可决）

回答 Human 的问题：**现在有哪些事在等我决定？每个决定需要看什么？**

**收录规则（确定性派生，只使用既有字段）：**

| 待决类型 | 派生条件 | 决定依据区直读字段 |
|---|---|---|
| 待批准计划 | WorkCase resolved `current_snapshot_projection.handoff_narrative_key = gate1_waiting` 且 `blocking_overlay = false` | 与对象列表相同的紧凑 Gate 1 Card：`goal`、成功标准、执行授权边界；存在时必须显示能力限制与低保证 fallback，不能把同一 AI 视角写成独立 subagent |
| 待确认关闭 | WorkCase resolved `current_snapshot_projection.handoff_narrative_key = gate2_waiting` 且 `blocking_overlay = false` | 与对象列表相同的关闭确认 Card：`goal`、`closure_proposal` 与实际 contributed Pitfall |
| 阻塞待处置 | WorkCase resolved `progress_group = plan_confirmation / closure_confirmation` 且 `blocking_overlay = true` | 显示完整 `blocking_summary` 与当前确认位置；不显示 Gate waiting、批准计划或确认关闭入口 |
| 待确认经验 | Pitfall `status = draft` | 与对象列表共享普通 Pitfall Card；正文显示可读的 `symptoms`、`trigger_conditions`、`resolution`、`avoidance`、`validation_summary`、`applicability` |

- 排序：有合法 `priority` 的 WorkCase（P0→P3）→ 无优先级条目（含 Pitfall draft）→ `updated_at` 正序（等待最久在前）。排序是派生展示规则，不表达语义重要性结论。
- 待决类型是 UI 枚举：resolved WorkCase 先由 `progress_group` 确定性归入既有两个行动模块；plan/closure group 进入待决定事项，progressing 进入推进中事项。未阻塞的实际 Gate 类型继续只由两个 handoff key 证明；`blocking_overlay=true` 的 Human-position 改用 `blocked_resolution`，保留在待决定事项但不是 Human Gate。Pitfall 只由类型专属 `draft` 映射为待确认。
- 条目形态直接复用对象列表 Card；聚焦页不新增对象正文。点击标题打开右侧扩展阅读（复用同源对象阅读布局）；标题以外区域不触发路由。
- 复制入口只位于模块标题带：“复制模块摘要”面向 AI 对话，含各待确认类型计数与条目稳定 ID。条目本身保持与对象列表 Card 相同的复制与交互，不因进入聚焦页增加按钮；近期动态的当前时间范围由高亮的快捷按钮表达，不重复显示范围说明。
- 决定在 AI 对话中作出，经 Helper 受控写入回写事实源；本模块不承载决定动作。
- 待决规模如实可见：默认完整展示全部待决条目；条目超出首屏时按上述排序截断，并在面板底部如实提示总数与未显示数量，不用分页掩盖待决规模。该呈现边界不代替对每项提请内容是否满足 HV1 的核查。
- 空态：当前没有待你决定的事项（双语）。

#### 4.1.1 推进中事项（HV2 授权执行受控可续）

回答 Human 的问题：**哪些 WorkCase 正在行动，它们当前推进到哪里？**

- 只收纳当前 `current_snapshot_projection` resolved 且 `progress_group = progressing` 的 WorkCase；它与两个实际 Gate handoff 互斥，不和待决定事项重复。
- `progressing` 包含计划修订、执行项执行、控制器自检、结果复核和控制器综合/关闭准备；复核实际方法与保证边界只按同源事实呈现。`status = blocked` 但仍处于上述推进链的 WorkCase继续保留，并在同源 Card 内显示阻塞说明与等待对象。
- 条目直接复用对象列表的进行中 WorkCase Card：目标和当期执行项来自同一次 source-bound Card 形成，进展分组、生命周期位置、轨道步骤与阻塞覆盖只来自其 `current_snapshot_projection`；聚焦页不另写行动摘要，也不从 raw `status / phase` 新增状态推断。
- 模块使用 `ldvh-section-grid` 随容器宽度自动排成多列，默认展开并支持整块折叠；标题带保留总数和复制模块摘要。
- 点击标题不跳转聚焦页路由，而是在右侧（窄容器时底部）打开同源次级阅读。模块只读，不提供推进、阻塞解除或关闭操作。
- Card 只表达当前推进和接续位置；Human 核查批准对象、范围、边界及其与当前执行的关系时，继续进入同源 WorkCase 阅读。模块不得把 `progressing`、item 状态或复制摘要解释为执行正确、范围内行动已获新增授权或 Human 已验收。
- 排序与待决定事项保持同一确定规则：合法优先级 P0→P3、更新时间正序、稳定 ID；超过首屏阈值时如实显示已展示和未展示数量。
- 空态：当前没有推进中的 WorkCase（双语）。

### 4.2 模块二 近期动态（HV2 当前状态核查与 HV5 演进阅读材料）

回答：**这个明确时间范围内，哪些事实对象有可观察到的新建或更新？**

- 时间窗口只由 Human 显式选择：最近 1 天、最近 3 天、最近 1 周；默认最近 1 天。窗口以本次 API `generatedAt` 向前计算，不维护 Web 上次访问时间，也不使用“我离开期间”这一抽象概念。
- 内容以当前受管项目内事实对象的 `change_log[].at` 为唯一优先时间源：首条可读流水标为“新建”，其后流水标为“更新”。不从摘要推断字段级动作或状态流转。没有可读事实流水的历史对象，才回退使用 `created_at` / `updated_at` 生成一条兼容时间标记；无有效时间标记的对象不收入本模块。相同稳定对象在对象区只显示一次，按其最近一条流水排序；行内以既有“历史图标 + 数值”胶囊表示该对象在窗口内的流水数，不写“几次修改”这类重复文字。第一行呈现相对时间、弱化的对象 ID、存在时的合法优先级、流水数、当前状态与复制对象 ID；第二行直接呈现对象类型图标和完整标题。点击标题打开同源次级阅读。
- 近期动态分为三个阅读区：最近改动的事实对象、署名 AI、署名环境。前者默认显示六个稳定对象，可局部展开显示其余全部对象；后两者以每条完整 `change_log[].signature` 的 `agent_id` / `host_environment` 分组计数、按用量排序，并以并列的半宽条状图表达。两张署名条状图共享一个“显示其余/收起”控制，默认各显示六项，展开后显示全部。缺失或不完整署名不被猜测或归类。时间窗口 Tab 位于模块标题栏，切换时仅替换本模块快照。
- 本模块不是提交列表，也不把提交消息改写成对象动态。提交及其文件级证据仍只在 `/changes` 与 `/changelog` 阅读；字段级 diff 仍在对象详情与提交记录中核对。
- 如实声明遗漏范围：流水摘要是事实源提供的文本，页面不据此推断字段级变化、状态流转或执行结果；“更新”只表示存在一条后续 `change_log` 记录。兼容回退的旧对象仍只能表示时间标记，不能伪造缺失的流水。
- 切换时间窗口时不触发浏览器整页导航或重载，保留原有页面与动态列表，并在近期动态模块内显示更新状态；`GET /api/cognition` 的新快照成功返回后原位替换当前聚焦页快照。单一类型读取失败时就地显示模块级降级，不影响其它类型的动态。
- 本模块只提供明确窗口内的事实流水，不能单独证明授权执行受控可续，也不能由流水串联出完整项目演进。

### 4.3 模块三 近期热点关系（HV5 项目演进脉络的近期材料）

回答：**这个明确时间范围内，哪些事实对象在自身流水中持续活跃，它们通过哪些正式关系相连？**

- 时间范围与模块二完全共用：最近 1 天、最近 3 天、最近 1 周。切换范围只更新当前聚焦页快照，不把“近期”解释为 Human 离开期间。
- 热点中心至少来自一条当前窗口内的事实 `change_log` 流水；历史对象没有可读流水时，才允许其单条 `created_at` / `updated_at` 兼容标记作为活跃证据。热点表示事实记录活跃度，不表示优先级、重要性、执行建议或方向正确性。
- 热点首先按事实流水条数、最近流水时间排序；只有两者相同时，非终态 WorkCase 才作为稳定阅读顺序的兜底。每个热点是独立的一跳阅读单元，页面以更大的中心卡、对象图标和更强的标题层级表达中心，不重复显示“主热点”标签；必须优先呈现完整标题与流水数，不能把事实类型、优先级或关系数量误当成热度。
- 每个热点只展开**与自身直接相连**的入边和出边，并统一收在“围绕它展开的工作”下。相同对象即使存在多条正式关系也只显示一次；原始 `relation_key` 与方向由连线、箭头和顶部图释表达，不在对象卡内重复显示关系文字。无障碍关系文本仍保留同源的本地化关系含义。没有流水、但与热点有正式关系的对象可以作为一跳工作；相邻对象的流水徽标只表示其自身在当前窗口内的事实流水数，不递归展开下一跳。
- 有事实流水但没有正式关系的对象不进入本模块，也不为凑图而连线；完整 Git 提交仍可在 `/changelog` 阅读。页面不把无向连通分量整体归到某个中心，不把多跳对象写成“围绕它展开”，也不表达关系强度、优先级、重要性、方向正确性或执行建议。
- 顶部信息带显示读取流水数、热点数和正式关系数，并以“流水图标 + 示例数字 + 流水数”解释热点卡右侧的计数徽标；该数字只表示当前时间窗口内该对象的事实流水数量，不表示关系数、优先级或重要性。对象类型由对象图标直接表达；不再维护需要来回对照的事实类型图例。关系通过有向曲线、箭头、线型和展开态对象卡上的本地化弱提示共同表达，不能只依赖颜色；SVG 之外同时保留同源的无障碍关系文本。
- 热点单元使用独立的容器宽度驱动网格并始终占满模块宽度；单元以 `22rem` 作为响应式下限，宽容器最多分为五列，各列按所在容器平均使用可用宽度，不设置固定像素宽度或最大宽度。对象卡固定使用三层信息顺序：第一行是事实类型图标、合法优先级和稳定 ID，第二行是标题，第三行是流水数与当前状态；主热点标题在缩略态使用 16px/22px、展开态使用 18px/24px，直接一跳工作标题使用 14px/20px。一级图标在缩略和展开状态均固定为 18px，不随展开跳变；缩略态一级与二级卡保持第一行到标题 4px、标题到流水数/状态 6px，展开态随卡片增高放宽为 8px、10px，第三行始终比前一段多留 2px；缩略态一级卡与二级卡均使用 120px 高度、24px 图标行和 10px 纵向内边距。视觉层级由字号、卡片宽度和强调样式承担。**缩略关系簇**用于概览：外层一行最多五个热点单元；单元内部主热点使用完整可用宽度，直接一跳工作统一使用主热点宽度的四分之三并垂直居中排列，以宽度差明确层级。主热点到各项工作的连线恢复为左右交替的独立曲线路径，形成多路关系概览；悬停或聚焦时只强调当前一路，其余路径淡化，因此多路线不再依赖静态辨线。为控制密度每簇最多绘制五项，其余数量如实提示。**中心关系图**用于聚焦：Human 展开某一簇后，该簇跨满当前模块支持宽度，其它簇仍保持缩略形态；主热点成为更大、更强描边和光晕的视觉中心，直接一跳工作同样保持主热点宽度的四分之三，并预留足以容纳三行标题与流水数/状态的高度；入边工作位于左侧、出边工作位于右侧，`related-to` 或同时具有双向关系的对象在两侧均衡分布，展示该热点全部直接一跳工作。宽屏展开态使用稳定的侧边中心锚点：同一侧的关系统一从主热点左侧或右侧中心出发，并落到目标卡朝向主热点的一侧中心，不再随目标斜率漂移连接位置。它是确定性一跳思维导图，不是自由力导向图；节点不会因刷新漂移，也不递归扩展相邻热点。
- 缩略态和展开态在悬停或键盘聚焦某一工作节点时，都只增强“主热点—当前节点”的路径并降低其它节点与边的视觉权重，使概览中的多条关系无需依赖展开即可逐条辨认；展开/还原只改变当前簇的表达，不重新读取数据、不导航、不改变事实。标题按内容换行；对象卡第一行显示类型图标、优先级和稳定 ID，第二行显示标题，第三行显示流水数与当前状态。点击任一对象卡进入同源次级阅读。对象 ID、优先级、当前状态只作为识别辅助信息，优先级不参与热点或布局计算。
- 明确不做全局图、多跳展开、标题/关键词/相近文件匹配、AI 语义连线、重要性评分或隐藏的“方向”判断。没有流水或没有正式关系的对象不进入图；关系读取失败时模块就地降级，不把缺口表达为无关系。
- 与近期动态的分工：近期动态逐条列出事实流水；本模块将同一窗口内有正式关系的活跃事实聚为一跳热点关系。与 `/changelog` 的分工：本模块不读取 Git 提交，不取代完整提交记录、文件差异或提交正文阅读。
- 本模块不显示长期意图与其形成变化，也不判断提交触及是否构成实际使用、复用或可观察效用；因此只为 HV5 提供近期材料，不声明完整 HV5 或 HV4 成立。

### 4.4 模块四 Spark 健康度（HV3 入档闭环节点可验）

回答：**我提过的事有没有被接住？Spark 池是不是在积压？**

**派生指标（全部标注为派生视图；阈值是 Web 展示参数，不是事实）：**

| 指标 | 派生规则 |
|---|---|
| open 总数与优先级分布 | `status = open`，按 `priority` 分组计数（priority 仅 Spark 适用） |
| 静默数 | `open` 且 `updated_at` 距今 ≥ 静默阈值（当前由 Web API 常量 `SPARK_SILENT_THRESHOLD_DAYS = 5` 提供，并通过 `silentThresholdDays` 返回；UI 如实标注） |
| 收敛情况 | 终态（`implemented` / `discarded`）数 / 总数 |
| 池的当前拆分 | 当前全部有效 Spark = 终态（`implemented` / `discarded`）+ `open`；以一条满宽比例条显示两个数量 |

- 标题带以弱辅助文字显示静默数量与阈值；比例条内仅居中显示终态与待处理数量，条下按两侧居中展示各自的终态/优先级构成。它表达当前结构，不表示告警、成功或处置建议。
- 标题带提供“时间”筛选：全部、超过 3 天、超过一周；默认超过一周。筛选对象是当前全部 `open` Spark，按完整静默天数倒序、优先级、更新时间、ID 排序；默认显示六项，其余由局部展开入口显示。每条列出标题、优先级弱信号、静默天数与复制 ID，点击标题打开右侧扩展阅读。静默数仍按 5 天阈值独立派生，仅作为池健康摘要，不改变筛选阈值。
- 本模块不生成“应当如何处置”的建议；需要跨行动保留的内容是否应形成 Spark、已有 Spark 是否应落实或废弃，仍按 20、31、32 与 Human 当前指令判断。页面只呈现来源已有节点和当前池结构；open、终态、静默数量或比例不证明事项整体闭环，更不证明 HV4。历史 `routed` Spark 只读可见，但不进入当前池、筛选或统计。
- 空态：当前筛选条件下没有待处理 Spark。

## 5. 同源核查与全局信任标记（支撑 HV1-HV3 与 HV5）

Web 给 Human 看的派生视图与 AI 经 Helper 精确读取的事实源应可互相核查。本节定义的是支撑 §1 各项价值的同源交付方法，不把核查入口本身另立为 Human 价值，也不保证 Human 与 AI 的理解自动一致。本页通过以下统一标记实现：

1. 页面不显示“观察时间”。API `generatedAt` 仅用于后端计算近期动态窗口的统一上界，不以对象 `updated_at` 或浏览器时刻替代该计算锚点。
2. 模块级降级：某一数据来源不可用（git 失败、某类型列表读取失败、字段问题）时，对应模块或分区如实显示实际不可用范围与原因，其它模块正常呈现；只有管辖范围解析失败才整页失败。
3. 每个模块标题带提供"复制模块摘要"：面向 AI 对话的多行文本，含模块名、关键计数与条目稳定 ID 列表（不含未精确读取的路径）。Human 粘贴到 AI 对话后，AI 经 Helper 精确读取复核同一对象——页面与 AI 各走 00 §8.3 定义的读取路径，互查而非互替。
4. 事实、派生、诊断、未知范围可区分：直读字段按来源呈现；派生指标带转换说明；近期动态的显式时间窗口、静默阈值等 Web 展示参数如实标注；读取问题与未解析结构在对应消费位置就地显示。

### 5.1 事实变化交付与延迟边界

Helper 成功写入并回读后，浏览器没有可被 Helper 直接调用的写入通知通道；列表、详情、右侧扩展阅读与认知中心不提供应用内重新读取或刷新入口。Human 需要取得新快照时使用浏览器自身的重新加载；页面在路由进入、语言切换等既有读取时机读取各自 API 当前快照，并消费绑定 `source_content_fingerprint + contract_identity` 的 `current_snapshot_projection`，不从 raw phase 重建映射、不写回 YAML、不做乐观迁移。

浏览器重新加载最多表示“下一次成功读取后展示最新可观察快照”，不把文件变化或页面重载表达为 Helper 写入成功。网络、服务、管辖解析或字段读取失败时，保留已存在的成功内容只作视觉占位并在对应页面显示加载失败/模块 issue；不把旧快照标作新观察，也不伪造断连期间的进展变化。页面不在后台或重新可见时自行读取，因此不承诺实时性、自动交付或固定延迟。

## 6. 交互

| 操作 | 行为 |
|---|---|
| 点击待决条目标题 | 打开右侧扩展阅读预览对象（再次点击当前条目关闭） |
| 点击近期动态对象标题 / 静默 Spark 行 / 近期热点对象标题 | 打开右侧扩展阅读 |
| 点击复制模块摘要 | 复制面向 AI 对话的模块观察摘要 |
| 切换语言 | 页面框架、模块标题、待决类型、状态与相对时间同步切换 |

## 7. 实现约束

1. 不把本页做成营销首页、 hero 区或卡片堆叠的装饰页；面向重复阅读与判断，优先信息密度与扫描效率。
2. 不提供批准、关闭、分流、处置、优先级编辑或任何写入口；占位按钮、禁用按钮也不出现。
3. WorkCase 统计只使用 `byProgressGroup`，WorkCase 条目只使用 `progress_group`；不得把派生进展分组放入名为 `status` 或 `byStatus` 的字段。resolved open/blocked WorkCase 在两个既有行动模块中唯一归属：plan/closure group 进入待决定事项，progressing 进入推进中；unresolved 不从 `source_status`、raw status/phase 或文案回退。
4. 不新增事实字段、状态、对象类型、第五进展分组或第二状态模型；待决类型、近期动态时间窗口、静默阈值均为 UI 层派生，如实标注。
5. 收件箱正文直接复用对象列表 Card：计划确认显示 Gate 1 紧凑入口，并把授权中的 capability limitations 作为 Human 判断输入；关闭确认显示关闭判断输入区与后续贡献，blocked Human-position 显示阻塞待处置与当前位置，Pitfall `draft` 使用共享普通 Card 显示当前可读的六类判断字段。完整同源事实在标题打开的次级阅读中展开；模块摘要只提供当前收件箱的观察信息与对象索引。缺失或类型不符必须在对应消费位置如实降级，不能过滤坏成员后拼成看似完整的批准材料。
6. 近期动态与近期热点关系都不读取或展示 Git 提交；二者均只从当前事实源的 `change_log` 读取活动，旧事实在没有可读流水时才回退自身时间字段。热点只使用事实源中已声明的正式关系；不得由标题、关键词、相近文件或语义推断连接。完整提交阅读仍进入现有提交页面。
7. 复制语义按 01 §5；候选条目不用 `path`、`target` 或对象 ID 伪造 `canonical_path`；本模块只增加“复制模块摘要”，tooltip 按内容语义命名。
8. i18n 全量双语；事实正文（goal、提案、commit message 等）不翻译；英文长文案允许换行，不以截断替代阅读。
9. 扩展阅读与详情页复用同一身份头部与 `WorkCaseReadingLayout`，不维护第二套对象摘要。
10. 颜色遵守 01 §1.10：Human 待确认紫色系、阻塞/风险警示色、类型色只用于识别；不以单一色相支配页面。
11. 本页确认最前面入口的可见名为“聚焦 / Focus”，内部概念、API 与源码仍使用 Cognition Center；其余入口的名称、顺序与信息架构仍按 01 §1.2.1 保持不写死，本页实现不得反向固定它们。

## 8. API 数据结构

`GET /api/cognition?locale=&window=1d|3d|7d` 聚合返回（类型命名仅为契约描述，实现以 TS 类型为准）：

```typescript
type CognitionObjectType = 'workcase' | 'adr' | 'pitfall' | 'spark' | 'study';
type WorkCaseProgressGroup = 'plan_confirmation' | 'progressing' | 'closure_confirmation' | 'closed';
type InboxKind = 'plan_confirmation' | 'closure_confirmation' | 'blocked_resolution' | 'pitfall_confirmation';

interface CognitionInboxItemBase {
  id: string;
  title: string;
  title_en?: string;
  title_zh?: string;
  relativeTime: string;
  typeColor: string;
  inboxKind: InboxKind;
  read_status: string;
  card: CognitionInboxCard;                // 与对象列表 Card 同源的内联投影
  priority?: string;
  updatedAt?: string;
  canonical_path?: string;                 // 仅字段级直读成立时出现
  field_issues?: FieldIssue[];
  unparsed_structures?: UnparsedStructure[];
  read_issues?: Record<string, unknown>[];
}

type CognitionInboxItem =
  | (CognitionInboxItemBase & {
      type: 'workcase';
      progress_group: 'plan_confirmation' | 'closure_confirmation';
      lifecycle_position: WorkCaseLifecyclePosition;
      isBlocked: boolean;
      inboxKind: 'plan_confirmation' | 'closure_confirmation' | 'blocked_resolution';
    })
  | (CognitionInboxItemBase & {
      type: 'pitfall';
      status: 'draft';
      inboxKind: 'pitfall_confirmation';
    });

interface CognitionRecentActivityItem {
  id: string;
  type: CognitionObjectType;
  title: string;
  title_en?: string;
  title_zh?: string;
  activity: 'created' | 'updated';
  occurredAt: string;
  relativeTime: string;
  typeColor: string;
  priority?: string;
  progress_group?: WorkCaseProgressGroup;
  status?: string;
  read_status: string;
  field_issues?: FieldIssue[];
  unparsed_structures?: UnparsedStructure[];
}

interface CognitionData {
  generatedAt: string;                     // 近期窗口计算上界，RFC3339（不在页面显示）
  scope: { governedProjectId: string };
  inbox: { items: CognitionInboxItem[]; total: number };
  recentActivity: {
    window: '1d' | '3d' | '7d';
    windowStart: string;
    items: CognitionRecentActivityItem[];
    total: number;
  };
  recentHotspots: {
    window: '1d' | '3d' | '7d';
    totalEvents: number;
    hotspotTotal: number;
    relationTotal: number;
    clusters: {
      nodes: {
        type: CognitionObjectType;
        id: string;
        title: string;
        title_en?: string;
        title_zh?: string;
        progress_group?: WorkCaseProgressGroup;
        status?: string;
        priority?: string;
        read_status: string;
        typeColor: string;
        activityRefs: {
          occurred_at: string;
          activity: 'created' | 'updated';
        }[];
      }[];
      edges: { source: string; target: string; relationKey: string }[];
    }[];
  };
  sparkHealth?: {
    openTotal: number;
    terminalTotal: number;
    terminalByStatus: { implemented: number; discarded: number };
    openByPriority: Record<string, number>;
    silentThresholdDays: number;           // 展示参数
    silentCount: number;
    total: number;
    openItems: {
      type: 'spark'; id: string; title: string; title_en?: string; title_zh?: string; priority?: string;
      updatedAt: string; silentDays: number; typeColor: string; read_status: string;
      field_issues?: FieldIssue[]; unparsed_structures?: UnparsedStructure[];
    }[];
    silentItems: {
      type: 'spark'; id: string; title: string; title_en?: string; title_zh?: string; priority?: string;
      updatedAt: string; silentDays: number; typeColor: string; read_status: string;
      field_issues?: FieldIssue[]; unparsed_structures?: UnparsedStructure[];
    }[];
  };
  issues?: { section: string; code: string; message: string; object_ref?: string }[];
}
```

- WorkCase 聚合遵守 §7 第 3 条命名纪律；其它类型不使用 `progress_group` / `byProgressGroup`。
- 待决定条目首屏内联复用各自对象列表 Card 的投影；完整事实在点击标题后的同源次级阅读中展开。模块摘要只保留当前收件箱的观察信息与对象索引，不另造事实或写回摘要。
- 本端点是派生视图服务，不成为事实权威；读取限定在当前唯一管辖项目与实际 worktree。
- 已实现注记（2026-08-08）：`GET /api/cognition` 返回 `{ generatedAt, scope, inbox, recentActivity, sparkHealth, recentHotspots, issues }`。inbox 收录 plan_confirmation / closure_confirmation WorkCase 与 draft Pitfall，按 `priority → updated_at` 正序排序；近期动态读取五类对象，按 `change_log[].at` 倒序返回窗口内的创建或更新流水；没有可读流水的历史对象才回退到自身时间字段。Spark 健康从当前 Spark 的 `status`、`priority` 和 `updated_at` 派生终态/待处理比例、全部待处理对象、静默计数与静默列表；近期热点关系复用同一时间窗口，只展示至少有一条事实流水且至少具有一条符合当前类型规则正式关系的热点。API 为每个热点返回独立 `primary + relations[]` 一跳投影，前端将相同相关对象合并为一张卡；缩略态以多列紧凑关系簇概览，展开态将所选热点切换为跨满模块宽度的中心式一跳思维导图，并保留关系方向、本地化弱提示与无障碍关系文本。无正式关系的活跃对象不进入热点关系，Git 提交仍只在 Changelog 阅读；blocked 保留在对象列表/详情，不进入 inbox。原规划中的演进时间线与方向对照不再提供字段或页面占位。

## 9. 响应式与移动端

本页不维护移动端专属业务结构。所有宽度使用同一标题、间距和信息层级；待决定事项与关系簇继续使用通用 `auto-fit` 容器网格，近期动态与 Spark 健康继续使用同一 `22rem` 最小面板网格，由真实可用宽度自然决定列数。窄屏只继承 App Shell 的两项结构变化：左侧导航自动成为图标栏，次级阅读切换为底部抽屉；抽屉内为拖动和触摸保留的控制尺寸属于该壳层变化，不得扩散为页面或业务组件的 Compact 变体。

## 10. 验收标准

1. Human 打开 `/` 后第一屏看到两个 WorkCase Human Gate 类型与 draft Pitfall 形成的全部待决定事项；blocked 对象不混入该收件箱。每项复用自身 Card，标题可直接打开同源次级阅读。
2. 完成一次真实闭环：收件箱模块摘要或对象稳定 ID → 粘贴到 AI 对话 → AI 经 Helper 精确读取同一对象 → Human 作出决定 → 受控写入回写事实源 → 重新进入本页后收件箱反映新状态。
3. 每个模块可见派生身份；某类型读取失败时模块级降级并如实标注，不整页失败。近期动态切换窗口时保留旧列表，成功返回后原位替换。
4. 双语切换：无 raw status / raw enum / raw 字段名；事实正文不翻译；英文布局不溢出。
5. 测试按 08 §10 对应行执行：派生内容（来源、转换、过期可复核）、来源与判断边界呈现、Web 行为保持与变更（本表 §0 决定 + 范围匹配的 API/组件/代表性浏览器测试）。
6. i18n、复制语义、扩展阅读同源、字段级解析与未解析结构呈现遵守 01 全部硬约束。

## 11. 已完成分期与维护边界

| 期 | 模块 | 服务标准 | 说明 |
|---|---|---|---|
| 第一期 | 模块一 待决定事项 + §5 全局信任标记 | HV1，支撑 HV3 | 直接对准决策提请对象与依据分散的真实痛点；含 API、页面、复制摘要与模块级降级 |
| 第二期 | 模块二 近期动态 + 模块四 Spark 健康度 | 支撑 HV2 / HV3 / HV5 | 提供近期对象变化的核查材料，并呈现 Spark 当前节点与池结构 |
| 第三期 | 模块三 近期热点关系 | 支撑 HV5 | 在当前时间范围内，用事实流水与正式关系形成小簇阅读，不替代完整演进脉络 |

- 三期均已完成并可按 §10 独立回归；后续维护不得恢复占位空壳、"即将上线"文案或已取消的旧模块。
- 第一期实现时同步完成：路由与导航替换（`CognitionCenter.tsx`、`nav.cognition`、图标按 09 语义规范选定）、`GET /api/cognition` 取代 `GET /api/dashboard`、`dashboard.*` i18n key 清理、本文文件名与测试契约引用更名、原 Dashboard 资产已移除。原 Dashboard 的对象统计网格不再保留为首页模块；对象类型导航由左侧主导航承担。
- 第二期已完成模块二「近期动态」与模块四「Spark 健康度」：近期动态按 Human 显式时间范围显示事实 `change_log` 的新建/更新流水；旧事实没有可读流水时才显示自身时间的兼容标记，不显示“我离开期间”或提交流；Spark 健康度展示当前池的收敛/待处理比例与静默待处理对象。
- 第三期已完成模块三「近期热点关系」：不使用全局图、多跳展开、语义自动连线、自由力导向布局或重要性评分；每个活跃事实热点独立展示自身及去重后的直接一跳工作，缩略态用于多列概览，展开态用于主热点居中的左右思维导图；相邻热点不递归展开，无正式关系的活跃事实对象不进入本模块。模块只提供热点中心状态筛选「全部 / 推进中 / 待决定 / 已收敛」，默认显示「推进中」；筛选不裁剪关系簇内部的一跳工作，切换时只更新当前模块并收起已展开关系簇。
- 三期实现均不记录积累在后续工作中的实际使用或复用、可观察效用及其依据和边界；HV4 仍是明确能力缺口，不得由模块数量、对象计数或事实热点存在推定为已实现。
