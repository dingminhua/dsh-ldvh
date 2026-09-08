# 蓝图功能 Web 呈现 —— 设计讨论记录（形态与决策点）

> 性质：**讨论工作稿（非规范、非候选、非事实对象）**——承接 `blueprint-feature-draft.md` 的 §5 待决问题与 specs/25/26 的「蓝图投影格式由 10 号承载」声明。
> 讨论发起：Human（2026-09-11，审批策略改为 never 后；结合调研对象 0ca1ab2c 内容讨论蓝图在 LDVH 的呈现）
> 状态：方向已对齐，代码未动。落 spec10 需另行裁决。
> 关联：`docs/blueprint-feature-draft.md`、`ldvh-base/researches/research-0ca1ab2c…`、`specs/25-Goal-项目目标.md`、`specs/26-Initiative-专项.md`、`specs/10-Web 呈现与交互规范.md`

## 0. 现状核对（2026-09-11 实读）

| 事实 | 状态 |
|---|---|
| specs/25-Goal、specs/26-Initiative | 已在 dev HEAD 上（25: 26871c3, 26: 431e142, 对抗修复: 5476e90） |
| Web 后端事实类型枚举 | 闭集 `ACTIVE_OBJECT_TYPES = [workcase, adr, pitfall, spark, research]`（`api/services/facts.ts`），未含 goal/initiative |
| 事实对象目录映射 | 硬编码 `FACT_TYPE_DIRS`（`api/services/localFactReader.ts`）：workcases/adrs/pitfalls/sparks/researches |
| `OBJECT_ID_PATTERN` | 正则硬编码到上述五类（facts.ts） |
| 前端类型注册 | `CATEGORY_COLORS` / `OBJECT_TYPE_ICONS` / `locales` / `Sidebar` 均无 goal/initiative |
| 蓝图页面 / BLUEPRINT.md | 均不存在 |
| 路由 `/` 首页 | 聚焦/Cognition Center（五模块：待决定/推进中/Spark 健康/近期动态/近期热点） |
| CognitionCenter 自我声明 | HV5「不串联长期意图…不声明完整 HV5 已成立」、HV4「尚未完整承接」 |
| specs/25/26 §3.2 scope | 「蓝图投影格式（10 号承载）」——但 spec 10 现无任何蓝图投影章节 |

## 1. 已对齐的三个方向性决策（Human 2026-09-11 确认）

1. **改造聚焦首页为「蓝图首页」**：不新增第二个首页。现有 `/` CognitionCenter 升级为单项目入口——既能看当前事态聚合，也能看长期意图/演进脉络。符合调研 F3「单页活文档、永远最新」共识；Human 打开项目即见全貌。
2. **Goal 特殊呈现 + Initiative 进对象系统**：
   - **Goal**：单例冻结锚 + 单例三免（免 object_uid / 免 F0–F2 候选召回 / 免目录基数校验），文件 `goal.md`。**不进**标准多例对象列表/详情机制（会与现有关键机制硬冲突），而是作为「首页顶部的目标锚投影」特殊呈现（目标陈述 + sub-goal 达成概览）。
   - **Initiative**：走标准多例对象通道（列表 + 详情 + 新类型色/图标），`serves: SG-n` 与 `depends_on` 在详情展示。
3. **本轮只定形态与决策点，不写代码**。

## 2. 调研对象 0ca1ab2c 对呈现的地基约束

- **F1（负结果）**：业界无枚举式区块先例，维护成本高于读取成本是业界共识。→ 蓝图/首页价值由「区块有机械来源（投影 Goal/Initiative/提交）而非手写」翻转成本判断。呈现必须让每个区块可溯源到事实源，不能是自由手写文本。
- **F2（三级光谱）**：投影区块（已完成/进行中→由 Initiative 及名下 WorkCase 机械投影）学 GitHub；authored 区块（下一步/悬而未决）学 Linear 由 AI 起草经 Human 验收。
- **F3（交互共识）**：最新置顶 + 历史可溯（Git/change_log 承载，不做独立历史 tab）+ AI 起草只 diff 变化区块。

## 3. 待裁决的呈现决策点（未定，留给 Human）

### D1 首页「长期意图区」与「当前事态区」的版面关系
确认「蓝图首页」= 改造后的 CognitionCenter。需定长期意图投影（Goal 陈述 + sub-goal 概览 + 当前 active Initiative）是**置顶**（长期意图优先，契合 HV5 补位）还是**独立模块列于现有五模块之间**。

### D2 Goal 特殊呈现的具体投影内容
specs/25 §10 已定义消费内容「目标陈述投影 + sub-goal 达成概览」。需定：
- sub-goal 达成概览的形态（SG-n 编号 + 是否展示其名下 Initiative/WC 的 serves 反查进度）；
- Goal 单例展示是否允许点进详情（无 object_uid，详情载体如何定义）或仅首页投影 + 回读 `goal.md`。

### D3 Initiative 进对象系统的接入面
机械上须动（本轮不写，仅登记）：
1. `ACTIVE_OBJECT_TYPES`/`OBJECT_TYPES` 扩 `initiative`；
2. `FACT_TYPE_DIRS` 加 `initiative: 'initiatives'` + 建 `ldvh-base/initiatives/`；
3. `OBJECT_ID_PATTERN` 正则加 `initiative`；
4. 前端 `CATEGORY_COLORS`（新色相）、`OBJECT_TYPE_ICONS`、`locales`、`Sidebar` 入口；
5. `ObjectStatusFilter` + 新字段（serves/depends_on/状态闭集）的字段值 locale 映射；
6. Initiative 状态闭集（spec 26）与 status filter tab 对齐。

### D4 serves/depends_on 在详情/列表的呈现方式
- serves 指向 SG-n（非 fact-to-fact，是对象内字段引用）——详情如何展示「这是实现哪个子目标」；
- depends_on 为 fact-to-fact DAG（无循环）——详情/列表是否做依赖图/链可视化，还是仅文本列示；
- 依赖排序是「蓝图展示性排序」非 Gate 1 前置（spec 26）——首页「下一步」区块须按拓扑排序。

### D5 蓝图首页与现有五模块的价值归属
需明确哪些现有模块仍保留/调整，避免「蓝图」与「聚焦」概念重复：是否把聚焦首页改名/改导航为蓝图语义，或保留「聚焦」名但内部补长期意图区。

## 4. 未决但需后续裁决的规范落点

- **spec 10 增「蓝图投影格式」章节**（25/26 已声明由其承载，目前空洞）；
- 蓝图首页更新触发（沿用草案 §5 问题 3：机械 vs 主动提议）；
- 蓝图是否受保护内容（草案 §5 问题 2）；
- 多管辖项目蓝图（草案 §5 问题 5，涉及联邦视图 Federation）。

## 5. 演进记录

| 日期 | 事件 |
|---|---|
| 2026-09-11 | Human 结合调研对象 0ca1ab2c 提出讨论蓝图呈现；本稿记录现状核对 + 三个方向决策 + 待决点 D1–D5 |
