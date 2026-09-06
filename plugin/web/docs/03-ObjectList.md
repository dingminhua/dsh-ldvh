# ObjectList 对象列表

> 路由：`/objects/:type`
> 源码：`web/src/pages/ObjectList.tsx`
> API：`GET /api/objects/:type`；WorkCase 使用 `?progress=<progress_group>`，另允许 Web 派生分类 `?progress=discarded`；其它对象按各自契约使用 `?status=<status>`
> 图标规范：[`09-图标语义规范.md`](./09-图标语义规范.md)

## 1. 页面目标

对象列表用于浏览单一对象类型下的事实对象，并通过该对象类型的浏览分类快速缩小范围。WorkCase 使用 Web 派生的“进展分组”，不能把它写成事实状态或生命周期。

对象类型切换由左侧主导航完成，本页不再提供顶部类型标签页。

对象列表页是主选择面，不承接详情页的右侧扩展阅读状态；进入 `/objects/:type` 时 App Shell 应主动关闭扩展阅读区。

## 2. 当前页面结构

```text
浏览筛选（WorkCase 使用 WorkCaseProgressFilter；其它对象使用 ObjectStatusFilter）
对象卡片自适应网格（ldvh-section-grid）
  通用卡片：ID + 优先级字符徽标 + 状态徽章 + 标题 + 信号标签 + 更新时间
  WorkCase 卡片：对象身份 + 进展分组 + 已确认分组的专属正文
加载态 / 错误态 / 空态
```

## 3. 区域详细设计

### 3.1 浏览筛选

- 位于列表顶部。
- 浏览筛选及同层任务态势图例属于列表切换控制区，必须固定在主滚动容器顶部；对象卡片列表在其下方滚动。
- WorkCase 由 `WorkCaseProgressFilter` 展示 `plan_confirmation / progressing / termination_cleanup / closure_confirmation / closed` 五个进展分组及“全部”，数量读取 API 的 `progressOptions`；五个值的显示顺序固定，“全部”放在最后。
- WorkCase 筛选写入 `?progress=<progress_group>`；`closed + closure_outcome=cancelled` 使用派生分类 `?progress=discarded`，不计入“已关闭”。没有 `progress` 时展示全部 WorkCase。原始 `status` 或 `phase` 不成为 WorkCase 列表的另一套同级筛选。
- 其它对象由 `ObjectStatusFilter` 根据各自状态契约展示“各状态 + 全部 + 数量”，并把选择写入 `?status=<status>`。
- 两类筛选都使用全局 tab 样式：`ldvh-tab-list`、`ldvh-tab-button`、`ldvh-tab-button-active` 和 `ldvh-tab-button-idle`，与提交记录页加载范围、type、scope 筛选保持一致。
- 数据返回前先渲染稳定的筛选占位，数字位置使用轻量加载动画，避免对象卡片先出现、顶部筛选后插入造成页面跳动。
- 无法形成合法 `progress_group` 的 WorkCase 仍属于“全部”的读取范围，但不能被猜入五个分组；界面应如实保留其不可判定状态，不能用已退出显示词补造分组。
- 点击对象进入详情页时保留当前 query，使详情页返回路径与列表筛选一致。

### 3.2 对象卡片

- 使用 `ldvh-section-grid`，列数由容器宽度自动决定。
- 不使用表格视图，不使用顶部类型标签页。
- 所有对象卡片一律按 `updated` 时间倒序排列，最近发生变化的对象在最前；状态只用于筛选、徽章和卡片内容表达，不参与排序。
- 通用卡片结构：
  - 左上：对象 ID，`ldvh-meta-muted`；
  - 右上：`StatusBadge` 后紧邻“复制对象 ID”图标；列表只是候选发现，不显示或复制精确来源路径，复制值仅为稳定 `object_id`；
  - 中部：本地化标题，`ldvh-card-title`，放入轻量标题带，左侧使用状态语义短线突出，不通过放大字号突出；标题必须允许换行完整显示，不得用截断省略代替阅读；
  - 优先级字符徽标：WorkCase 和 Spark 如存在 `priority`，在 ID 后面展示 `P0` / `P1` / `P2` / `P3` 字符徽标；标题行只保留 `ObjectTypeIcon(obj.type)` 和标题。徽标使用颜色、轻量边框和 tooltip 表达优先级，不作为错误或阻塞状态；
  - 可选信号：仅当对应对象的字段契约定义该字段时展示；`priority` 只适用于 WorkCase 和 Spark，不得为 ADR、Pitfall 或 Study 杜撰 priority，也不得为任何对象杜撰 importance、category 或 tags；Spark 不维护 category；Pitfall 不维护 repeatability；importance 字段已由 priority 统一承载，不作为独立字段使用
  - 终态处置：ADR、Pitfall 与 Spark 不复用泛化的“非活跃原因”字段。它们在各自终态卡片中只读取 `disposition_summary`，用弱圆点与小号正文承载，不另造“退出理由”“关闭时间”“处置时间”标签；缺失时如实显示处置缺失提示，仍不得压过标题、状态和更新时间。
  - 正式 `relations` 由所有五类对象 Card 统一呈现：同一稳定目标只呈现一次，即使来源以多个 relation key 关联它；使用对象语义图标、完整标题和关联状态图标；悬停显示文字：待处理的 Spark、Pitfall draft、方案待确认或关闭待确认的 WorkCase 使用待处理图标；推进中的 WorkCase 使用推进图标；其余可读的活跃对象使用活跃图标；所有可读终态关联也保留，已关闭使用勾选图标，已废弃使用灰色废弃图标。已废弃关联整行进一步使用中性 slate 灰色弱化对象图标、标题、状态图标和 hover/focus 反馈，但仍保持可读、可进入和完整标题。关联严格按“活跃 → 推进中 → 待处理 → 已关闭 → 已废弃”排序；不可用关联保留在这些状态之后并显示“关联信息不可用”。不设“关联”标题、类型分组标题、对象 ID 或复制按钮，不折叠或截断。它不是链接、URL、材料或引用列表，也不据此推断分流、依赖、承接责任或终态处置。仅当前项目内精确读取成功的目标可点击并打开扩展阅读；跨项目、缺失、不可读或结构无效的关联明确显示“关联信息不可用”，不猜标题或静默遗漏。
  - Pitfall 状态筛选使用 `draft / active / discarded`，分别显示“待确认 / 活跃 / 已废弃”；`discarded` 与其终态处置说明均使用中性灰，红色只保留给 Pitfall 类型识别。Pitfall 卡片不提供 promote、discard 或批量审核控件，也不展示 `tags` 或冗余解决态。
  - 底部：只展示更新时间，使用 `formatDateTime()`，格式为 `YYYY-MM-DD HH:mm`，样式为弱化元信息 `ldvh-meta-muted`；更新时间行使用 `mt-auto` 贴近卡片下边距，避免不同标题行数或中部内容高度导致时间上浮；对象列表以更新时间排序，创建时间留在详情页身份区展示。
- 复制对象 ID 只复制，不触发导航。只有详情或引用行完成精确读取并取得可消费 `canonical_path` 后，才可另行显示复制对象路径入口。
- hover 时边框变为 `border-ldvh-accent/40`，标题变 accent 色。
- 卡片标题不得超过全局 `ldvh-card-title` 字号；标题强调优先使用轻量背景、位置、留白、状态语义短线和 hover 反馈。

### 3.3 ADR 卡片

ADR 是已经形成、并应在适用边界内执行的当前决策。列表卡片只帮助用户定位当前决策，不在卡片内展开决策影响范围。

- ADR 状态筛选只认 `active / retired`。`active` 是当前有效决策；`retired` 表示不再作为当前决策入口，中文显示为”已废弃”并使用中性灰。
- ADR 卡片使用通用卡片结构：ID、状态、完整标题、更新时间；`retired` 时在标题之后以弱处置正文展示 `disposition_summary`。
- ADR 标题就是最好的摘要；除 retired 的处置正文与通用正式关联区外，卡片不展示 `decision_question`、`decision`、`applicability`、`rationale`、`consequences`或未采纳备选摘要。
- ADR 卡片标题必须允许换行完整显示，避免用截断标题替代决策识别。
- ADR 卡片不展示 `related_rules` chip，也不展示 `superseded_by`、`proposed`、`accepted`、`rejected`、`superseded`、`alternatives` 或 `affects` 等旧生命周期和旧字段信息。

### 3.4 WorkCase 卡片

WorkCase 卡片帮助 Human 识别当前工作责任所处的进展分组，并按各分组真正需要关注的信息继续阅读。它首先区分“仍在推进”与“稳定停留”，不能把等待 Human 或已经关闭的 WorkCase 画成仍有自动推进。

- 保留通用卡片头部：ID、进展分组、标题。
- 不显示虚构的“所属工作责任”归属行；Card 标题识别 WorkCase 自身，内部 work item 只在“推进中”按本节规则呈现当前 active 项。
- WorkCase Card 消费 21 §9.3 当前快照投影中的五个进展分组：`plan_confirmation`（方案待确认）、`progressing`（推进中）、`termination_cleanup`（终止善后中）、`closure_confirmation`（关闭位置）、`closed`（已关闭）。列表分类额外将 `closed + closure_outcome=cancelled` 派生为“已废弃”，不与普通已关闭混计；它不改变事实 `status` 或 `progress_group`。仅 `handoff_narrative_key=gate2_waiting` 把 `closure_confirmation` 显示为“关闭待确认”；`gate2_position_blocked` 必须显示“关闭位置受阻”。界面分类轴命名为“进展分组”，不得显示为“生命周期”。创建前计划复核时尚无正式 WorkCase，不提供 Card 或筛选项。
- 每张 Card 必须直接显示自己的进展分组，不能要求 Human 只靠顶部筛选位置推断；来源 phase 不再作为与五个分组同级的 Card 主状态。
- “方案待确认”Card 是 Gate 1 的紧凑入口：完整直读 `goal`、`success_criterion_definitions` 与 `execution_authorization`；三者分别固定使用“目标”“成功标准”“执行授权边界”标题。授权区以允许动作、禁止项、实际存在的 Human 前置条件和 capability limitations 数量形成可扫读入口；能力限制存在时必须可展开阅读 capability/availability、当前观察与证据、受影响复核类别、fallback policy、assurance gap 和停止条件，不能隐藏低保证基础或把同一 AI 切换视角称为独立 subagent。完整授权动作与边界统一留在同源详情页阅读。摘要不替代或截断来源内容。Card 不显示 `scope`、`work_items`、`creation_reviews` 或 `execution_approval`，这些完整材料留在同源详情页；decision mode 仍完整显示 creation reviews 的实际方法与低保证披露。项目认知中心复用同一紧凑 Card；其标题在本页打开同源次级阅读，不增设聚焦页专属正文或条目操作。任一结构缺失或 malformed 时在原位置明确标注，不能丢弃坏成员后形成伪完整基线。
- “方案待确认”同时出现 `status=blocked` 时，必须在 Gate 1 材料之外完整显示独立的阻塞状态提示，直接读取 `blocking_summary`，缺失时明确提示。阻塞状态提示必须成为 Card 身份头部之后的首个内容块，位于“目标”之前。该提示不是 Gate 1 授权内容，也不把进展分组改成“推进中”或其它分组。
- “方案待确认”Card 使用四级排版层级：对象标题与其它事实对象统一使用 14px 卡片标题，两个判断区标题使用 13px 卡片判断项标题，事实原文使用 12px 卡片判断项正文，ID、数量和时间使用元信息。判断项正文仍是事实正文，不得使用弱色或 mono 把它降成辅助信息；不得在业务组件内用临时字号制造层级。
- 五种进展分组共享同一中性外层 Card，不用整卡底色重复表达头部已有的进展分组。语义色只进入当前判断所需的内部信息块：方案待确认时“目标”与“成功标准”共同承担主要判断；推进中以“当前情况”为主；终止善后中突出中止原因、善后摘要及保留/丢弃/未验证边界；关闭待确认与已关闭突出关闭结论及责任处置。等待与阻塞等次级语义标题使用普通阅读字体，不使用稳定 ID、版本和时间专用的等宽元信息字体。
- 成功标准没有先后关系，统一使用圆点无序列表；不得因数组位置、criterion ID 或当前显示顺序使用数字序号。只有来源明确规定步骤、优先级、排名或依赖顺序的内容才使用编号。
- “推进中”Card 保留“目标”，并把第二个区域从“成功标准”替换为与详情同名的“当前情况”：目标继续完整读取 `goal`；结果推进主链显示由 `progress_step` 指定的四环节当前位置，`plan_revising` 则明确显示轨迹外内部位置“方案修订中”。`item_execution` 显示工作项的最小展示投影，其他环节只显示真实 active 项，以及事实中实际存在的等待或阻塞。Card 不显示成功标准、scope、依赖、方法、完整工作项计划中的执行细节、态势条、验证安排、Reviewer 复核、Controller 处置、Human 批准或关闭报告与分流建议。
- “当前情况”以当前环节为主信息，不显示返回次数、复核次数、完成比例或其它过程计数。四个环节使用一条 1–4 的连续结构轨迹，只有当前位置使用强调色和轻微动态信号；轨迹线及其它位置保持中性，不借颜色、连线或勾选暗示前序环节已经完成或对象不会返回。窄屏允许当前环节与工作项区换行，但不得改变它们的阅读先后或把四环节拆成 2×2 宫格。
- `item_execution` 时完整列出全部工作项的稳定 item_id、完整 goal 和当前状态：`completed` 在前并显示完成勾选，`in_progress` 随后并突出显示，`blocked` 保留阻塞说明，`pending` 以弱化样式在后，`cancelled` 也明确保留。状态分组只帮助扫描，不表示执行顺序、依赖顺序或完成历史；同组内也不从数组位置导出顺序。其它环节只列出 `in_progress` 和 `blocked` 项；active 项使用无序圆点。work item 投影必须先确认当前完整结构、唯一稳定 ID、目标、状态条件和依赖图均有效；任一成员不成立时，完整清单或 active 项整组显示“工作项进展不可判定”，但不隐藏仍可由 phase 确定的当前内部位置。不得丢弃错误成员后计算部分总数，也不得用数组位置、title、ID 或已退出字段生成替代身份/目标。
- `item_execution` 的全部项都已完成或取消时显示环节与状态不一致。主控自检、结果复核和主控收敛不为预期为空的 active 项生成噪声；如仍有 pending 或 active 项，则显示环节与状态不一致。`independent_review` 只是稳定投影键，显示词不推断实际方法；实际方法只由 review 字段据实呈现。
- 四个推进环节存在确定顺序，可以使用 1–4 编号；编号只表达环节次序，不能根据当前位置把前序环节标成已完成或生成经过历史。结果推进主链的当前位置缺失时明确显示“当前环节不可判定”。`plan_revising` 不高亮四步中的任何一项，也不新增第五个稳定 `progress_step`。
- `waiting_on` 实际存在时完整显示，并与详情统一称为“等待对象”、使用琥珀色语义块，不根据当前环节自动补造等待文案。`status=blocked` 是推进位置上的独立异常信号；Card 保留当前推进环节，并以玫红色“阻塞说明”完整显示 `blocking_summary`，缺失时明确提示。阻塞说明必须成为 Card 身份头部之后的首个内容块，位于目标和当前情况之前；此时实际存在的等待对象紧跟阻塞说明，也位于目标之前。未阻塞时，等待对象仍属于当前情况。Card 中两者的标题使用 `13px / 20px`，与详情对应的 `14px / 22px` 保持同一层级语言但小一级。等待与阻塞同时存在时均保留，Web 不作语义去重。
- “推进中”可用轻微、遵守减弱动态偏好的动效提示当前位置；方案待确认、关闭待确认和已关闭不显示脉冲或推进轨迹。两个 Human 确认关口必须保持为不同进展分组。
- “终止善后中”不进入普通四步轨迹，直接读取 `termination` 显示 Human 中止来源、善后摘要、保留/丢弃/未验证范围、关系影响和质量步骤；不把旧工作项呈现为仍待执行，也不生成 Gate 2 入口。
- 进展分组直接显示在通用卡片头部；正文中的推进环节只表达当前浏览语义。status、phase 与授权的事实含义仍以事实源和详情阅读为准。
- 投影的 `lifecycle_position=closure_preparing` 表示“推进中 / 主控收敛”：此时 Controller 正在吸收当前结果复核并形成关闭报告与分流建议，尚未向 Human 提交关闭请求。只有同一投影的 `handoff_narrative_key=gate2_waiting` 才显示“关闭待确认”，不得提前制造 Human 待办。
- `gate2_waiting` Card 正文由“关闭判断输入区”构成。关闭判断输入区直读 `goal` 与 `closure_proposal`，完整显示目标、拟议关闭结论、处置摘要、三类 `residual_decisions[]` 和完整 `spark_suggestions[]`。三类处置显示为 `route_existing`“路由到已有对象”、`suggest_spark`“建议后续建立 Spark”、`accept_stop`“接受停止”；route_existing 按保存的稳定目标读取当前标题和类型，不以 object ID 冒充名称。受限责任建议显示摘要、受限原因、影响、恢复条件和后续定位；后续机会显示摘要和后续定位，不生成受限字段空态，也不显示或猜测未来 Spark ID。实际 `contributed-to` 与其它正式关系由 Card 末尾的通用关系区统一呈现，不作为关闭责任去向或独立“后续贡献”模块；不提供 promote、discard、批量审核或自动过期控件。`closure_proposal` 缺失或结构不符时明确显示信息缺失，不拼凑替代文本。`gate2_position_blocked` 改用“关闭位置受阻”Card，首先显示完整 `blocking_summary`，可以保留来源材料但不得显示 Gate 2 判断入口、关闭待确认或仅剩关闭确认。
- “已关闭”Card 使用相同扫读结构，从 `goal`、`closure_outcome` 和 `disposition_summary` 读取终态内容；route_existing 从 `routed-to` 呈现，suggest_spark 从顶层 `spark_suggestions` 呈现，accept_stop 从 `residual_responsibilities` 呈现，不反推原 proposal ID。正式 `relations` 由所有五类对象 Card 统一呈现，不限于详情关系区。closed 不保存关闭 approval 或关闭时间，Web 不得据此报缺。

### 3.5 Spark 卡片

Spark 是“待处理信息”卡片，列表态用于快速定位每条火花，并在已经形成终态处置时提示闭环事实；待处理卡片不展开意图、摘要、演变或长正文。

- Spark 卡片保留通用头部、标题、优先级字符徽标、状态和更新时间。
- Spark 卡片不使用通用非活跃原因块；卡片中部只由 Spark 闭环状态驱动。
- Spark 卡片中部状态内容必须使用与 Pitfall 归档原因一致的弱说明表达：弱圆点、小号标签、小号正文，无彩色外框、无大面积状态底色、无 section 标题级强调。
- `open` 时，卡片中部不展示 `intent`、`summary` 或 `evolution`；这些内容留在详情页按阅读节点展开。
- `implemented` 与 `discarded` 时，卡片中部展示 `disposition_summary`。`implemented`（已关闭）使用低饱和蓝灰，`discarded`（已废弃）使用中性灰；状态徽章说明终态类别，正文说明实际处置；不在卡片中显示承接目标、额外终态时间或旧的 `resolved_to` / `resolved_at` / `discard_reason` 投影。历史 `routed` 仅保留直接只读查看，不是当前列表状态。
- 实际存在 `relations` 时，Spark 与其它四类对象一样使用 §3.2 的通用正式关联区；它不表示链接或分流。
- Spark 卡片内部信息区域只用于阅读，不响应主路由跳转；只有卡片标题进入 Spark 详情页，ID、状态、正文、更新时间和卡片空白区域均不触发导航。

### 3.6 Spark 创建边界

Spark 列表页保持只读；Web 不提供 Spark 创建、直接捕获、写入或由表单生成 Spark 的入口。Spark 的对象化、既有对象查重和受控创建只由 AI 按 20 与 31 的规则调用 Helper 完成；Web 只呈现当前事实源中的结果。

### 3.7 空态、加载态、错误态

- 加载态：居中旋转动画。
- 错误态：`common.loadFailed` + 错误信息。
- 空态：`objectList.noObjects`，不得拼 raw 中文句子。

### 3.8 五个基准模块中的对象列表基线

研究、决策、火花、经验四个对象列表已经进入五个基准模块，应作为非工作主线对象卡片的统一基线。提交列表不属于工作对象列表，但其卡片网格、标题带和底部更新时间必须与这四类对象列表保持同一视觉语言。

- 四类对象都使用同一外层卡片框架：浅边框、`ldvh-panel` 背景、`p-4`、`gap-3`、hover/focus 轻微 accent 边框反馈。
- 顶部区域统一为左侧对象 ID、右侧状态徽章；候选卡不伪造或复制来源路径，也不得在右侧操作区加入强视觉按钮。
- 标题带统一使用弱背景、内圈边框、左侧语义短线、对象类型图标、完整标题和右侧进入箭头；标题使用 `ldvh-card-title`，必须允许换行完整显示。
- 更新时间统一放在卡片底部右侧，使用 `formatDateTime()` 和 `ldvh-meta-muted`；列表排序统一按 `updated` 倒序，最近发生变化的对象在最前。
- 研究、决策、火花和经验在列表态只展示对象定位所需信息与通用正式关联区，不展开长正文；ADR 的 `retired`、Pitfall 的 `discarded` 与 Spark 的 `implemented` / `discarded` 才展示终态 `disposition_summary`，并使用弱说明表达，不升级为强状态模块。
- 终态处置在决策、经验和火花中保持一致：弱圆点、小号正文、无额外标签、无醒目外框、大面积状态底色或标题级强调。
- 四类对象必须继续使用同一 `ObjectStatusFilter` tab 视觉；状态数量数字使用 `ldvh-tab-count`，不得在单个对象页局部改大、改粗或拉开间距。

## 4. 交互

| 操作 | 行为 |
|---|---|
| 点击左侧导航类型 | 切换到对应 `/objects/:type` |
| 点击浏览筛选 | WorkCase 更新 `progress` query；其它对象更新 `status` query；按 query 重新读取列表 |
| 点击对象卡片外层空白、标题带、ID、状态徽章或更新时间 | 跳转到当前对象详情页，保留当前 query，并把当前列表 URL 记录为详情页返回来源 |
| 点击任意对象 Card 的正式关联行 | 在右侧扩展阅读打开对应对象，不改变当前列表路由 |
| 点击卡片内部信息框、区块标题、态势条或普通信息区域 | 不触发路由跳转，不表现为独立可点控件 |
| 从详情页返回对象列表 | 主内容回到 `/objects/:type`，并主动关闭右侧扩展阅读区 |
| 切换语言 | 状态、标题和空态文案同步切换 |

## 5. 实现约束

1. 不恢复顶部对象类型标签页；类型导航已经统一到左侧侧栏。
2. 不把列表改成表格；当前事实对象用卡片扫描。
3. 不展示 raw ISO 时间，统一使用 `formatDateTime()`。
4. 不在列表卡片里复述完整详情；WorkCase 只按 §3.4 展示当前已经确定的分组专属内容。
   - `closure_confirmation` 的结论语义块固定显示“关闭提案”，标题已提供提议身份，因此右侧只显示“目标达成 / 部分达成 / 未达成 / 取消”（英文“Achieved / Partial / Not achieved / Cancel”）的紧凑分类标签，不重复“提议结论 / Proposed conclusion”前缀；整体统一使用中性提案图标和琥珀色提案色调，不把提案分类表现成既成状态。`closed` 的总体语义块固定显示“终态处置”，读取 `closure_outcome` 选择语义色与图标，但 Card 不再重复显示“完成”等第二状态标签。
5. 候选对象卡片不得用对象 ID、导航 target 或空 `path` 冒充来源路径；精确读取成功后再在详情或引用消费点提供复制入口。
6. 执行项不作为一级导航 tab，也不拥有独立详情路由。
7. 对象卡片只有标题是当前对象详情入口，并提供统一 hover/focus 反馈；ID、状态、正文、更新时间和卡片空白区域均不触发导航。正式关联行是唯一可单独响应的内部控件，并只打开扩展阅读；内部工作项不拥有独立详情路由。

## 6. API 数据结构

对象列表 API 只向 Card 交付当组实际消费的最小字段。所有当前事实类型（包括 WorkCase）在 Helper 已确认的管辖 worktree 内由 Web 直接读取正式载体；页面字段缺失或类型不符保留为逐字段问题，额外、旧或无法归类的结构保留在 `unparsed_structures`，不经过 Core 全量校验、Python machine 或第二份 Schema。列表使用同一字段级读取结果投影 Card，并保留 `read_status`、读取问题、字段问题与未解析结构供范围提示。

```typescript
interface WorkCaseCardItem {
  object_id: string;
  fact_type_key: 'workcase';
  title: string;
  status: 'open' | 'blocked' | 'closed'; // 责任状态原值；不得改写成 phase
  phase?: string;
  current_snapshot_projection: WorkCaseCurrentSnapshotProjection; // source-bound；downstream 唯一投影合同
  priority?: 'P0' | 'P1' | 'P2' | 'P3'; // plan_confirmation / progressing / termination_cleanup
  updated_at: string;
  progress_group?: 'plan_confirmation' | 'progressing' | 'termination_cleanup' | 'closure_confirmation' | 'closed';
  progress_step?: 'item_execution' | 'controller_self_check' | 'independent_review' | 'controller_synthesis';
  goal?: string;                       // 所有五个进展分组
  termination?: Record<string, unknown>; // termination_cleanup 与主动终止 closed
  successCriteria?: string[];          // 仅 plan_confirmation；全部 statement 原文
  success_criterion_definitions?: unknown; // 仅 plan_confirmation；稳定 criterion_id 与 statement
  scope?: string;                      // 仅 plan_confirmation；批准边界
  work_items?: unknown;                // 仅 plan_confirmation；完整工作项与方法
  creation_reviews?: unknown;          // 仅 plan_confirmation；当前方案复核与主控处置
  execution_authorization?: unknown;   // 仅 plan_confirmation；完整执行授权边界
  execution_approval?: unknown;        // plan_confirmation 已存在时；含 baseline_fingerprint/source_refs
  waiting_on?: string;                 // 仅 progressing 且实际存在
  blocking_summary?: string;           // 活动分组的独立阻塞状态提示
  executionItems?: Array<{              // 仅 progressing；最小展示投影，不是完整 work_items
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
    blockingReason?: string;
  }>;
  contributedTo?: Array<{            // closure_confirmation / closed 的 Pitfall contributed-to；稳定三元组
    governedProjectId: string;
    factTypeKey: string;
    objectId: string;
  }>;
  closureProposal?: {                // 仅 closure_confirmation 且 closure_proposal 结构合法；稳定子集，不透传整对象
    proposedOutcome: 'completed' | 'partial' | 'not-achieved' | 'cancelled';
    dispositionSummary: string;
    residualDecisions: Array<{
      residualId: string;
      summary: string;
      proposedDisposition: 'route_existing' | 'suggest_spark' | 'accept_stop';
      routeTarget?: { governedProjectId: string; factTypeKey: string; objectId: string };
    }>;
    sparkSuggestions: Array<{ suggestionId: string; suggestionKind: 'constrained_responsibility' | 'follow_up_opportunity'; summary: string; followUpSummary: string; restrictionReason?: string; impactSummary?: string; resumeCondition?: string }>;
  }>;
  closureTerminal?: {                // 仅 closed；直接投影终态字段
    outcome: 'completed' | 'partial' | 'not-achieved' | 'cancelled';
    dispositionSummary: string;
    routedTo: Array<{ governedProjectId: string; factTypeKey: string; objectId: string }>;
    acceptedStop: Array<{ residualId: string; summary: string }>;
    sparkSuggestions: Array<{ suggestionId: string; suggestionKind: 'constrained_responsibility' | 'follow_up_opportunity'; summary: string; followUpSummary: string; restrictionReason?: string; impactSummary?: string; resumeCondition?: string }>;
  };
}
```

`status` 始终保留事实责任状态，`phase` 独立保留当前阶段；不得把 phase 填进 `status`，也不得新增 `responsibilityStatus` 兼容别名。`current_snapshot_projection` 在 API 读取边界用实际原始载体 SHA-256 形成并绑定合同身份；形成后，列表筛选、Card 分支、共享轨道和阻塞提示只消费其中的 resolved 字段，不得用 raw `status / phase` fallback。unresolved 时对象仍留在“全部”范围并显示不可判定，不猜入任何分组。`progress_group`、`progress_step` 是该投影的兼容只读字段，`executionItems` 是另一个 Card 派生。plan_confirmation 是唯一允许携带完整 `work_items`、`creation_reviews` 与授权基线的 Card 分组；progressing 仍只携带最小 `executionItems`。`closure_confirmation` 携带 `goal`、Pitfall `contributedTo` 和 `closureProposal`；`closed` 携带 `goal`、Pitfall `contributedTo` 和 `closureTerminal`。关联目标标题和状态由 Card 按需同源读取，不复制到列表响应；`related-to` 不进入 Card 投影。

列表顶层返回字段级直读的范围与集合问题：`coverage_status` 与 `collection_issues`。对象卡携带自己的 `read_status`、`read_issues`、`field_issues` 与 `unparsed_structures`；集合问题保留准确路径、原因和消息，不以旧 machine 的 `invalid / not_found` 分类替代。页面必须保留已形成的可消费 Card，独立展示集合问题与未完成范围；不设置列表级“观察时间”或“重新读取”控件。筛选或导航发生时照常发起新的列表请求，不能复用旧 payload。读取失败时页面必须保留实际失败原因，不得回退其它读取路径或显示伪零值。
