# 运行期条文覆盖核对表（20–26、30–36、02）

- 时间：2026-11-22（第二轮覆盖核对，接上一轮未完成部分）
- 仓库：`/Users/dmh2002/DshProject/dsh-ldvh`
- 用途：`specs/` 已全面退为需求文档后，逐节确认每条**面向运行期行动**的条文是否由 `plugin-specs/` 载体承载；本表是后续逐条落位的依据。
- 判定口径（沿用上一轮）：**A**＝约束运行期行动；**B**＝约束开发过程或规范自身结构；**C**＝定义、价值、职责边界、规范依据。只有 A 才问"是否已有载体承载"。
- 缺口取值：**已**＝有载体条目承接该节的规范性内容；**部分**＝只承接了一部分，或只承接了汇总口径；**缺**＝无载体条目；**—**＝该节不要求承载（B/C、汇总节、或规范结构角色）。
- 「依据」列：**读节**＝逐节读过该节正文后判定；**标题映射**＝按节标题与该载体条目的词面近邻自动映射，**未逐字核**，属暂定结论，落位前须复核。

## 规模与统计

- 覆盖规范：15 份（`specs/20`–`specs/26`、`specs/30`–`specs/36`、`specs/02`），共 **737** 个 H2/H3 节。
- 判定分布：A **523**、B **28**、C **186**。
- A 类中：**汇总节／结构角色 72 条**（"14. 类型特有验证与类型退出"这类只作下节索引的 H2、公开操作声明这类规范结构契约），不单独要求承载；其余 **451** 条为实质条文。
- 实质 A 类 451 条，按**证据强度**分两档（这是本表最重要的读法）：

| 证据档 | 条数 | 已承载 | 部分覆盖 | 无载体 |
|---|---|---|---|---|
| **读节**（逐节读过正文后判定） | 77 | **71（92.2%）** | 6（7.8%） | 0 |
| **标题映射**（按节标题与条目词面近邻，未逐字核） | 374 | 273（73.0%） | 101（27.0%） | 0 |
| 合计 | 451 | 344（76.3%） | 107（23.7%） | 0 |

- 读法：**读节档的 92.2% 才是有依据的覆盖率**；映射档的 101 条"部分"里，多数只是词面没对上（含大量系统性小节的重复表述），不等于规则真的缺——它们已逐条列在第一节表里（缺口列＝部分），落位时按行复核即可。
- 口径差异：上一轮报告"A 类约 307 条、完全覆盖 86.3%"是按**条文**计且只含 `00`/`03`/`20–26`/`30–36`；本轮按**节**计、新增 `specs/02`、并把"未逐字核"单列一档，故两边数字不可直接相减。

## 本轮对载体的实际改动（落位清单）

| 载体 | 条目 id | 动作 | 对应规范节 |
|---|---|---|---|
| `fact-model-common` | `type-routing-order` | 新增 | `02` §6.4 事实类型归属的判据与次序 |
| `fact-model-common` | `common-field-adoption` | 新增 | `02` §7.1 公共身份字段（采用面、缺省不得伪造、无统一关键词字段） |
| `fact-model-common` | `object-designation` | 新增 | `02` §9.3 事实对象的指称形态 |
| `fact-model-common` | `consumption-four-conclusions` | 新增 | `02` §9 事实发现/召回/语义消费的四结论；§9.2 召回进入条件 |
| `fact-model-common` | `read-path-kinds` | 新增 | `02` §10.2 只读路径四类能力与"机械有效"边界 |
| `friction-settlement-system-foundation` | `buffer-what` | 扩写 | `36` §8.8 / §14「摩擦观察条目的写入合法」「到期淘汰的登记」两行 |
| `friction-settlement-system-foundation` | `fail-closed` | 扩写 | `36` §14「运行完成」行（逐行结论闭集与整轮成立条件） |

- 改动后条目数/字节：`fact-model-common` 30 条 / 17830 B（余 2650 B）；`friction-settlement-system-foundation` 30 条 / 19954 B（余 526 B）。
- 未新增条目到已满 30 条的载体；未删任何既有要求；未改任何既有 `id`；新增 `id` 为语义化 kebab-case；未写 YAML 注释；未改 `specs/`、`plugin/`、`ldvh-base/`；未 git add/commit/stash。


## 一、逐节核对表

按规范文件顺序列出全部 737 个 H2/H3。

### 20-Goal-项目目标.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 21 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 25 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 33 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 35 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 45 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 52 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 56 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 58 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 65 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 69 | 5. 类型定位与价值（02 §12.1 第 1 项） | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 读节 |
| 77 | 6. 对象边界（02 §12.1 第 2 项） | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 79 | 6.1 什么构成一个对象 | A | goal-fact-type::what-is | 已 | 读节判定：条目 what-is 承接本节的规范性内容 | 读节 |
| 85 | 6.2 查重 | A | goal-fact-type::single-instance | 已 | 读节判定：条目 single-instance 承接本节的规范性内容 | 读节 |
| 89 | 6.3 明确不属于本类型（入口拦截） | A | goal-fact-type::not-goal | 已 | 读节判定：条目 not-goal 承接本节的规范性内容 | 读节 |
| 93 | 7. 身份与载体 | A | goal-fact-type::single-instance | 已 | 读节判定：条目 single-instance 承接本节的规范性内容 | 读节 |
| 108 | 8. 字段契约 | A | goal-fact-type::limits | 已 | 字段闭集、两个上限、拒绝写入与不截断均落在 limits／statement-only | 读节 |
| 139 | 9. 状态与生命周期 | A | goal-fact-type::no-other-states | 已 | 读节判定：条目 no-other-states 承接本节的规范性内容 | 读节 |
| 149 | 10. 来源与证据 | A | goal-fact-type::evidence-layers | 已 | 读节判定：条目 evidence-layers 承接本节的规范性内容 | 读节 |
| 159 | 11. 关系契约 | A | goal-fact-type::no-upstream | 已 | 读节判定：条目 no-upstream 承接本节的规范性内容 | 读节 |
| 163 | 12. 召回与消费 | A | goal-fact-type::session-injection | 已 | 读节判定：条目 session-injection 承接本节的规范性内容 | 读节 |
| 189 | 13. 受控操作 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 200 | 公开操作声明（05 §6.1 形状） | B | — | — | 同上 | 读节 |
| 208 | 14. 类型特有验证与类型退出（02 §12.1 第 10 项） | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 210 | 14.1 类型特有验证 | A | goal-fact-type::limits | 部分 | 载体内聚（frontmatter 与正文对应段逐字一致）在载体里无条目；且 22／23／25／26 均记「Human 取消逐字义务」，两处口径相抵，未择一 | 读节 |
| 221 | 14.2 类型退出 | B | — | — | 类型退出是规范结构角色（按公共契约处理），无独立运行期要求 | 读节 |
| 225 | 15. 验证与证据边界 | A | goal-fact-type::single-instance | 部分 | 七行中六行有对应条目；「子目标归属可解析」每次读取前核对的口径由 subgoal-fact-type::parent-anchor 承载，本侧无对应行 | 读节 |
| 241 | 16. Human Gate | A | goal-fact-type::decision-bound | 已 | 读节判定：条目 decision-bound 承接本节的规范性内容 | 读节 |
| 251 | 17. 必停情形 | A | goal-fact-type::stop | 已 | 读节判定：条目 stop 承接本节的规范性内容 | 读节 |
| 265 | 18. 反过度设计红线 | A | goal-fact-type::subgoals-not-stored | 已 | 读节判定：条目 subgoals-not-stored 承接本节的规范性内容 | 读节 |

### 21-SubGoal-子目标.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 22 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 26 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 37 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 39 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 50 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 60 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 64 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 66 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 81 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 87 | 5. 类型定位与价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 93 | 6. 对象边界 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 95 | 6.1 什么构成一个对象 | A | subgoal-fact-type::what-is | 已 | 词面强映射到 what-is（未逐字核） | 标题映射 |
| 101 | 6.2 查重 | A | subgoal-fact-type::dedup | 已 | 词面强映射到 dedup（未逐字核） | 标题映射 |
| 111 | 6.3 明确不属于本类型 | A | subgoal-fact-type::criterion-is-not-task | 已 | 词面强映射到 criterion-is-not-task（未逐字核） | 标题映射 |
| 117 | 7. 身份与载体 | A | subgoal-fact-type::identity | 已 | 词面强映射到 identity（未逐字核） | 标题映射 |
| 145 | 8. 字段契约 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 183 | 8.1 拆解情况与落实情况不存储为字段 | A | subgoal-fact-type::empty-set | 已 | 词面强映射到 empty-set（未逐字核） | 标题映射 |
| 189 | 9. 状态与生命周期 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 193 | 9.1 状态语义与成立条件 | A | subgoal-fact-type::states | 已 | 词面强映射到 states（未逐字核） | 标题映射 |
| 201 | 9.2 状态转换 | A | subgoal-fact-type::no-reopen | 已 | 词面强映射到 no-reopen（未逐字核） | 标题映射 |
| 207 | 9.3 补充级更新 | A | subgoal-fact-type::substantive-change | 已 | 词面强映射到 substantive-change（未逐字核） | 标题映射 |
| 211 | 9.4 更正与更新的区分 | A | subgoal-fact-type::substantive-change | 已 | 词面强映射到 substantive-change（未逐字核） | 标题映射 |
| 215 | 9.5 删除不存在 | A | subgoal-fact-type::no-delete | 已 | 词面强映射到 no-delete（未逐字核） | 标题映射 |
| 219 | 10. 来源与证据 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 221 | 10.1 来源 | A | subgoal-fact-type::alignment | 部分 | 无强对应条目或仅词面近邻 alignment，须逐条落位复核 | 标题映射 |
| 225 | 10.2 达成判据的类型闭集 | A | subgoal-fact-type::criterion-kind | 已 | 词面强映射到 criterion-kind（未逐字核） | 标题映射 |
| 237 | 10.3 证据充分性与边界 | A | subgoal-fact-type::achievement-evidence | 已 | 词面强映射到 achievement-evidence（未逐字核） | 标题映射 |
| 241 | 10.4 机械校验与语义审核的边界 | A | subgoal-fact-type::mechanical-bound | 已 | 词面强映射到 mechanical-bound（未逐字核） | 标题映射 |
| 247 | 11. 关系契约 | A | subgoal-fact-type::no-derived-copies | 已 | 词面强映射到 no-derived-copies（未逐字核） | 标题映射 |
| 257 | 12. 召回与消费 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 259 | 12.1 消费点 | A | subgoal-fact-type::recall | 已 | 词面强映射到 recall（未逐字核） | 标题映射 |
| 272 | 12.2 召回分层 | A | subgoal-fact-type::recall | 部分 | 无强对应条目或仅词面近邻 recall，须逐条落位复核 | 标题映射 |
| 276 | 12.3 serves 的解析口径 | A | subgoal-fact-type::serves | 已 | 词面强映射到 serves（未逐字核） | 标题映射 |
| 286 | 12.4 召回判据表 | A | subgoal-fact-type::recall | 已 | 词面强映射到 recall（未逐字核） | 标题映射 |
| 298 | 13. 受控操作 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 318 | 公开操作声明（05 §6.1 形状） | B | — | — | 同上 | 标题映射 |
| 328 | 14. 类型特有验证与类型退出 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 330 | 14.1 类型特有验证 | A | subgoal-fact-type::parent-anchor | 已 | 读节判定：条目 parent-anchor 承接本节的规范性内容 | 读节 |
| 341 | 14.2 存量对象迁移 | B | — | — | 开发期或规范结构义务 | 读节 |
| 353 | 14.3 类型退出 | B | — | — | 同上 | 读节 |
| 357 | 15. 验证与证据边界 | A | subgoal-fact-type::precheck | 已 | 读节判定：条目 precheck 承接本节的规范性内容 | 读节 |
| 375 | 16. Human Gate | A | subgoal-fact-type::mechanical-bound | 已 | 读节判定：条目 mechanical-bound 承接本节的规范性内容 | 读节 |
| 386 | 17. 必停情形 | A | subgoal-fact-type::stop | 已 | 读节判定：条目 stop 承接本节的规范性内容 | 读节 |
| 402 | 18. 反过度设计红线 | A | subgoal-fact-type::not-authorization | 已 | 读节判定：条目 not-authorization 承接本节的规范性内容 | 读节 |

### 22-Spark-火花.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 23 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 27 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 39 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 41 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 50 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 59 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 63 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 65 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 72 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 76 | 5. 类型定位与价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 82 | 6. 对象边界 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 84 | 6.1 什么构成一个对象 | A | spark-fact-type::question-scope | 已 | 词面强映射到 question-scope（未逐字核） | 标题映射 |
| 88 | 6.2 查重 | A | spark-fact-type::dedup | 已 | 词面强映射到 dedup（未逐字核） | 标题映射 |
| 92 | 6.3 明确不属于本类型（入口拦截） | A | spark-fact-type::not-spark | 已 | 词面强映射到 not-spark（未逐字核） | 标题映射 |
| 96 | 6.4 提取要求（宽进窄出） | A | spark-fact-type::extract-crystals | 已 | 词面强映射到 extract-crystals（未逐字核） | 标题映射 |
| 102 | 7. 身份与载体 | A | spark-fact-type::change-log | 已 | 词面强映射到 change-log（未逐字核） | 标题映射 |
| 113 | 8. 字段契约 | A | spark-fact-type::question-scope | 已 | 词面强映射到 question-scope（未逐字核） | 标题映射 |
| 148 | 9. 状态与生命周期 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 152 | 9.1 状态语义与成立条件 | A | spark-fact-type::state-discarded | 已 | 词面强映射到 state-discarded（未逐字核） | 标题映射 |
| 174 | 9.2 状态转换 | A | spark-fact-type::terminal-correctable | 已 | 词面强映射到 terminal-correctable（未逐字核） | 标题映射 |
| 185 | 9.3 合并/拆分（终态处理的两条新路径） | A | spark-fact-type::merge | 已 | 词面强映射到 merge（未逐字核） | 标题映射 |
| 195 | 9.4 合并/拆分的非原子例外（依 02 §10.6 明示） | A | spark-fact-type::merge-split-not-atomic | 已 | 词面强映射到 merge-split-not-atomic（未逐字核） | 标题映射 |
| 244 | 10. 来源与证据 | A | spark-fact-type::state-discarded | 已 | 词面强映射到 state-discarded（未逐字核） | 标题映射 |
| 250 | 11. 关系契约 | A | spark-fact-type::state-discarded | 已 | 词面强映射到 state-discarded（未逐字核） | 标题映射 |
| 267 | 12. 召回与消费 | A | spark-fact-type::historical-pointer | 已 | 词面强映射到 historical-pointer（未逐字核） | 标题映射 |
| 302 | 13. 受控操作 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 322 | 公开操作声明（05 §6.1 形状） | B | — | — | 公开操作声明是规范结构契约（供能力发现解析），属写作契约 | 读节 |
| 332 | 14. 类型特有验证与类型退出 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 334 | 14.1 类型特有验证 | A | spark-fact-type::merge-split-order | 已 | 读节判定：条目 merge-split-order 承接本节的规范性内容 | 读节 |
| 353 | 14.2 存量对象迁移 | B | — | — | 开发期或规范结构义务 | 读节 |
| 363 | 14.3 类型退出 | B | — | — | 同上 | 读节 |
| 367 | 15. 验证与证据边界 | A | spark-fact-type::state-discarded | 已 | 读节判定：条目 state-discarded 承接本节的规范性内容 | 读节 |
| 388 | 16. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 428 | 16.1 决定边界 | A | spark-fact-type::no-overclaim | 部分 | 无强对应条目或仅词面近邻 no-overclaim，须逐条落位复核 | 读节 |
| 432 | 17. 必停情形 | A | spark-fact-type::stop | 已 | 读节判定：条目 stop 承接本节的规范性内容 | 读节 |
| 450 | 18. 反过度设计红线 | A | spark-fact-type::merge | 已 | 读节判定：条目 merge 承接本节的规范性内容 | 读节 |

### 23-Norm-事实规范.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 22 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 26 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 36 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 38 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 49 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 57 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 61 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 63 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 70 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 74 | 5. 类型定位与价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 读节 |
| 90 | 6. 对象边界 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 92 | 6.1 什么构成一个对象 | A | norm-fact-type::enforcement-declaration | 已 | 读节判定：条目 enforcement-declaration 承接本节的规范性内容 | 读节 |
| 115 | 6.2 查重 | A | norm-fact-type::dedup | 已 | 读节判定：条目 dedup 承接本节的规范性内容 | 读节 |
| 119 | 6.3 明确不属于本类型 | A | norm-fact-type::not-norm | 已 | 读节判定：条目 not-norm 承接本节的规范性内容 | 读节 |
| 123 | 7. 身份与载体 | A | norm-fact-type::carrier | 已 | 读节判定：条目 carrier 承接本节的规范性内容 | 读节 |
| 139 | 8. 字段契约 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 185 | 8.1 状态与生命周期 | A | norm-fact-type::terminal | 已 | 读节判定：条目 terminal 承接本节的规范性内容 | 读节 |
| 199 | 8.2 来源与证据 | A | norm-fact-type::dedup | 已 | 读节判定：条目 dedup 承接本节的规范性内容 | 读节 |
| 211 | 9. 关系契约 | A | norm-fact-type::no-relations | 已 | 读节判定：条目 no-relations 承接本节的规范性内容 | 读节 |
| 217 | 10. 召回与消费 | A | norm-fact-type::recall-duty | 已 | 读节判定：条目 recall-duty 承接本节的规范性内容 | 读节 |
| 248 | 11. 受控操作 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 280 | 公开操作声明（05 §6.1 形状） | B | — | — | 同上 | 读节 |
| 289 | 12. 授权附件 | A | norm-fact-type::direction-catalog | 已 | 读节判定：条目 direction-catalog 承接本节的规范性内容 | 读节 |
| 299 | 13. 类型特有验证与类型退出 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 301 | 13.1 类型特有验证 | A | norm-fact-type::enforcement-declaration | 已 | 读节判定：条目 enforcement-declaration 承接本节的规范性内容 | 读节 |
| 311 | 13.2 勘误级更新 | A | norm-fact-type::revise-active | 已 | 读节判定：条目 revise-active 承接本节的规范性内容 | 读节 |
| 322 | 13.3 存量对象迁移 | B | — | — | 开发期或规范结构义务 | 读节 |
| 326 | 13.4 类型退出 | B | — | — | 同上 | 读节 |
| 330 | 14. 验证与证据边界 | A | norm-fact-type::enforcement-declaration | 已 | 读节判定：条目 enforcement-declaration 承接本节的规范性内容 | 读节 |
| 346 | 15. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 355 | 15.1 决定边界 | A | norm-fact-type::retire-needs-human | 部分 | 无强对应条目或仅词面近邻 retire-needs-human，须逐条落位复核 | 读节 |
| 359 | 15.2 确认的承载与呈报 | A | norm-fact-type::create-needs-human | 已 | 读节判定：条目 create-needs-human 承接本节的规范性内容 | 读节 |
| 375 | 16. 必停情形 | A | norm-fact-type::stop | 已 | 读节判定：条目 stop 承接本节的规范性内容 | 读节 |
| 389 | 17. 反过度设计红线 | A | norm-fact-type::no-overdesign | 已 | 读节判定：条目 no-overdesign 承接本节的规范性内容 | 读节 |

### 24-Report-报告.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 21 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 25 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 33 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 35 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 44 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 54 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 58 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 60 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 69 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 77 | 5. 类型定位与价值 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 79 | 事实类型声明 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 87 | 五种来源形态（report_form） | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 105 | 调研型的两种子阶段（仅 report_form=research） | A | report-fact-type::body-skeleton | 已 | 词面强映射到 body-skeleton（未逐字核） | 标题映射 |
| 112 | 与 v4 Study 的迁移边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 118 | 6. 对象边界 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 122 | 6.0 公共准入条件（五形态均须同时满足） | A | report-fact-type::what-is | 已 | 词面强映射到 what-is（未逐字核） | 标题映射 |
| 133 | 6.1 调研型专属条件（report_form=research） | A | report-fact-type::research-form | 已 | 词面强映射到 research-form（未逐字核） | 标题映射 |
| 141 | 6.2 总结型专属条件（report_form=summary） | A | report-fact-type::internal-forms | 已 | 词面强映射到 internal-forms（未逐字核） | 标题映射 |
| 148 | 6.3 审核型专属条件（report_form=audit）——四项准入门槛 | A | report-fact-type::audit-form | 已 | 词面强映射到 audit-form（未逐字核） | 标题映射 |
| 159 | 6.4 行动型专属条件（report_form=action） | A | report-fact-type::action-form | 已 | 词面强映射到 action-form（未逐字核） | 标题映射 |
| 167 | 6.5 参考型专属条件（report_form=reference） | A | report-fact-type::reference-form | 已 | 词面强映射到 reference-form（未逐字核） | 标题映射 |
| 175 | 6.6 查重规则 | A | report-fact-type::dedup | 已 | 词面强映射到 dedup（未逐字核） | 标题映射 |
| 179 | 6.7 不得形成报告的内容 | A | report-fact-type::not-report | 已 | 词面强映射到 not-report（未逐字核） | 标题映射 |
| 183 | 7. 身份与载体 | A | report-fact-type::body-skeleton | 已 | 词面强映射到 body-skeleton（未逐字核） | 标题映射 |
| 283 | 8. 字段契约 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 322 | 8.1 目标锚定的采用面（Human 2026-11-20 决定：本类型不挂 SubGoal） | A | report-fact-type::carrier | 已 | 词面强映射到 carrier（未逐字核） | 标题映射 |
| 330 | 8.2 report_form 的存量兼容与过渡条款 | A | report-fact-type::status | 部分 | 无强对应条目或仅词面近邻 status，须逐条落位复核 | 标题映射 |
| 345 | 9. 状态与生命周期 | A | report-fact-type::status | 已 | 词面强映射到 status（未逐字核） | 标题映射 |
| 358 | 10. 来源、证据与来源锚点 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 362 | 10.1 外部来源锚点（report_form=research 专用） | A | report-fact-type::research-form | 已 | 词面强映射到 research-form（未逐字核） | 标题映射 |
| 368 | 10.2 内部来源锚点（report_form=summary／audit／action／reference 专用） | A | report-fact-type::internal-forms | 已 | 词面强映射到 internal-forms（未逐字核） | 标题映射 |
| 390 | 10.3 三态证据的承载与获得判据 | A | report-fact-type::findings-and-states | 已 | 词面强映射到 findings-and-states（未逐字核） | 标题映射 |
| 404 | 11. 关系契约 | A | report-fact-type::relations | 已 | 词面强映射到 relations（未逐字核） | 标题映射 |
| 420 | 12. 召回与消费 | A | report-fact-type::recall | 已 | 词面强映射到 recall（未逐字核） | 标题映射 |
| 446 | 13. 受控操作 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 458 | 公开操作声明（05 §6.1 形状） | B | — | — | 同上 | 标题映射 |
| 469 | 公开操作的输入与结果契约 | B | — | — | 同上 | 标题映射 |
| 480 | 14. 类型特有验证与类型退出 | A | report-fact-type::correction | 已 | 读节判定：条目 correction 承接本节的规范性内容 | 读节 |
| 488 | 15. 验证与证据边界 | A | report-fact-type::correction | 已 | 读节判定：条目 correction 承接本节的规范性内容 | 读节 |
| 504 | 16. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 508 | 16.1 领域增量事项 | A | report-fact-type::correction | 部分 | 无强对应条目或仅词面近邻 correction，须逐条落位复核 | 标题映射 |
| 519 | 16.2 决定边界 | A | report-fact-type::recall | 部分 | 无强对应条目或仅词面近邻 recall，须逐条落位复核 | 标题映射 |
| 523 | 17. 必停情形 | A | ldvh-root::stop-conditions | 已 | 汇总节：必停的根触发由总纲承载，领域触发见其下各节 | 标题映射 |
| 527 | 17.1 领域触发与影响范围 | A | report-fact-type::stop-conditions | 已 | 词面强映射到 stop-conditions（未逐字核） | 标题映射 |
| 544 | 17.2 暂停期间允许动作 | A | report-fact-type::status | 部分 | 无强对应条目或仅词面近邻 status，须逐条落位复核 | 标题映射 |
| 548 | 17.3 恢复与再次触发 | A | report-fact-type::status | 部分 | 无强对应条目或仅词面近邻 status，须逐条落位复核 | 标题映射 |
| 552 | 18. 反过度设计红线 | A | report-fact-type::no-overdesign | 已 | 词面强映射到 no-overdesign（未逐字核） | 标题映射 |

### 25-Pitfall-踩坑经验.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 21 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 25 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 35 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 37 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 46 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 54 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 58 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 60 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 67 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 71 | 5. 类型定位与价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 77 | 6. 对象边界 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 79 | 6.1 什么构成一个对象 | A | pitfall-fact-type::what-is | 已 | 词面强映射到 what-is（未逐字核） | 标题映射 |
| 83 | 6.2 查重 | A | pitfall-fact-type::dedup | 已 | 词面强映射到 dedup（未逐字核） | 标题映射 |
| 94 | 6.3 明确不属于本类型 | A | pitfall-fact-type::avoidance-not-rule | 已 | 词面强映射到 avoidance-not-rule（未逐字核） | 标题映射 |
| 98 | 7. 身份与载体 | A | pitfall-fact-type::carrier | 已 | 词面强映射到 carrier（未逐字核） | 标题映射 |
| 109 | 8. 字段契约 | A | pitfall-fact-type::carrier | 已 | 词面强映射到 carrier（未逐字核） | 标题映射 |
| 143 | 9. 状态与生命周期 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 153 | 9.1 状态语义与成立条件 | A | pitfall-fact-type::state-discarded | 已 | 词面强映射到 state-discarded（未逐字核） | 标题映射 |
| 164 | 9.2 状态转换 | A | pitfall-fact-type::no-reopen | 已 | 词面强映射到 no-reopen（未逐字核） | 标题映射 |
| 168 | 9.3 勘误与补充级更新 | A | pitfall-fact-type::correct-vs-new | 已 | 词面强映射到 correct-vs-new（未逐字核） | 标题映射 |
| 172 | 9.4 配对的复审义务 | A | pitfall-fact-type::pairing-on-retire | 已 | 词面强映射到 pairing-on-retire（未逐字核） | 标题映射 |
| 197 | 10. 来源与证据 | A | pitfall-fact-type::create-quality | 已 | 词面强映射到 create-quality（未逐字核） | 标题映射 |
| 209 | 11. 关系契约 | A | pitfall-fact-type::no-relations | 已 | 词面强映射到 no-relations（未逐字核） | 标题映射 |
| 217 | 12. 召回与消费 | A | pitfall-fact-type::recall-precheck | 已 | 词面强映射到 recall-precheck（未逐字核） | 标题映射 |
| 247 | 13. 受控操作 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 276 | 公开操作声明（05 §6.1 形状） | B | — | — | 同上 | 标题映射 |
| 286 | 14. 类型特有验证与类型退出 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 288 | 14.1 类型特有验证 | A | pitfall-fact-type::carrier | 已 | 读节判定：条目 carrier 承接本节的规范性内容 | 读节 |
| 296 | 14.2 存量对象迁移 | B | — | — | 开发期或规范结构义务 | 读节 |
| 300 | 14.3 类型退出 | B | — | — | 同上 | 读节 |
| 304 | 15. 验证与证据边界 | A | pitfall-fact-type::create-quality | 已 | 读节判定：条目 create-quality 承接本节的规范性内容 | 读节 |
| 319 | 16. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 329 | 16.1 决定边界 | A | pitfall-fact-type::correct-vs-new | 已 | 词面强映射到 correct-vs-new（未逐字核） | 标题映射 |
| 337 | 17. 必停情形 | A | pitfall-fact-type::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 351 | 18. 反过度设计红线 | A | pitfall-fact-type::no-middle-state | 已 | 词面强映射到 no-middle-state（未逐字核） | 标题映射 |

### 26-Friction-摩擦账本.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 20 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 24 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 33 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 35 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 45 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 52 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 56 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 58 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 65 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 86 | 5. 类型定位与价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 92 | 6. 对象边界 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 94 | 6.1 什么构成一个对象 | A | friction-fact-type::what-is | 已 | 词面强映射到 what-is（未逐字核） | 标题映射 |
| 100 | 6.2 查重与攒账 | A | friction-fact-type::dedup | 已 | 词面强映射到 dedup（未逐字核） | 标题映射 |
| 114 | 6.3 明确不属于本类型 | A | friction-fact-type::not-friction | 已 | 词面强映射到 not-friction（未逐字核） | 标题映射 |
| 118 | 7. 身份与载体 | A | friction-fact-type::identity-carrier | 已 | 词面强映射到 identity-carrier（未逐字核） | 标题映射 |
| 137 | 8. 字段契约 | A | friction-fact-type::body-sections | 已 | 词面强映射到 body-sections（未逐字核） | 标题映射 |
| 168 | 9. 状态与生命周期 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 176 | 9.1 状态语义与成立条件 | A | friction-fact-type::states | 已 | 词面强映射到 states（未逐字核） | 标题映射 |
| 185 | 9.2 状态转换 | A | friction-fact-type::accepted-boundary | 已 | 词面强映射到 accepted-boundary（未逐字核） | 标题映射 |
| 201 | 9.3 补充级更新 | A | friction-fact-type::accepted-still-counts | 已 | 词面强映射到 accepted-still-counts（未逐字核） | 标题映射 |
| 216 | 9.4 配对的转换义务 | A | friction-fact-type::pairing-lesson-discarded | 已 | 词面强映射到 pairing-lesson-discarded（未逐字核） | 标题映射 |
| 245 | 10. 来源与证据 | A | friction-fact-type::threshold | 已 | 词面强映射到 threshold（未逐字核） | 标题映射 |
| 258 | 11. 关系契约 | A | friction-fact-type::relations | 已 | 词面强映射到 relations（未逐字核） | 标题映射 |
| 277 | 12. 召回与消费 | A | friction-fact-type::recall-candidates | 已 | 词面强映射到 recall-candidates（未逐字核） | 标题映射 |
| 300 | 13. 受控操作 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 316 | 公开操作声明（05 §6.1 形状） | B | — | — | 同上 | 标题映射 |
| 325 | 14. 类型特有验证与类型退出 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 327 | 14.1 类型特有验证 | A | friction-fact-type::relations | 已 | 读节判定：条目 relations 承接本节的规范性内容 | 读节 |
| 338 | 14.2 存量对象迁移 | B | — | — | 开发期或规范结构义务 | 读节 |
| 354 | 14.3 类型退出 | B | — | — | 同上 | 读节 |
| 358 | 15. 验证与证据边界 | A | friction-fact-type::stop | 已 | 读节判定：条目 stop 承接本节的规范性内容 | 读节 |
| 373 | 16. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 381 | 16.1 决定边界 | A | friction-fact-type::stop | 部分 | 无强对应条目或仅词面近邻 stop，须逐条落位复核 | 标题映射 |
| 385 | 17. 必停情形 | A | friction-fact-type::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 401 | 18. 反过度设计红线 | A | friction-fact-type::no-decoration | 已 | 词面强映射到 no-decoration（未逐字核） | 标题映射 |

### 30-目标规划系统规范.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 22 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 26 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 41 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 43 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 51 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 59 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 63 | 3.4 职责根边界与回指 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 69 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 71 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 83 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 89 | 5. 系统定位与价值 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 91 | 业务系统声明 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 99 | 稳定身份与 00 §2.6 登记名对应 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 103 | 解决的持续业务问题 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 107 | 服务消费方与核心价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 114 | 6. 进入与退出契约 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 116 | 进入信号 | A | goal-planning-system-foundation::when-it-applies | 已 | 词面强映射到 when-it-applies（未逐字核） | 标题映射 |
| 123 | 适用条件 | A | goal-planning-system-foundation::when-it-applies | 已 | 词面强映射到 when-it-applies（未逐字核） | 标题映射 |
| 127 | 排除条件 | A | goal-planning-system-foundation::excludes | 已 | 词面强映射到 excludes（未逐字核） | 标题映射 |
| 131 | 不确定处理 | A | goal-planning-system-foundation::excludes | 已 | 词面强映射到 excludes（未逐字核） | 标题映射 |
| 137 | 当次作用范围 | A | goal-planning-system-foundation::frozen-no-reinterpretation | 已 | 词面强映射到 frozen-no-reinterpretation（未逐字核） | 标题映射 |
| 141 | 退出与转交条件 | A | goal-planning-system-foundation::handover | 部分 | 无强对应条目或仅词面近邻 handover，须逐条落位复核 | 标题映射 |
| 145 | 7. 输入与前置条件 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 147 | 必需输入 | A | goal-planning-system-foundation::handover | 部分 | 无强对应条目或仅词面近邻 handover，须逐条落位复核 | 标题映射 |
| 151 | 可选输入 | A | goal-planning-system-foundation::cascade-scope | 部分 | 无强对应条目或仅词面近邻 cascade-scope，须逐条落位复核 | 标题映射 |
| 155 | 输入来源 | A | goal-planning-system-foundation::when-it-applies | 部分 | 无强对应条目或仅词面近邻 when-it-applies，须逐条落位复核 | 标题映射 |
| 159 | 缺失和冲突处理 | A | goal-planning-system-foundation::constraint-conflict | 已 | 词面强映射到 constraint-conflict（未逐字核） | 标题映射 |
| 167 | 8. 过程机制与分支 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 169 | 关键机制 | A | goal-planning-system-foundation::what-it-is | 部分 | 无强对应条目或仅词面近邻 what-it-is，须逐条落位复核 | 标题映射 |
| 178 | 先后顺序或并行关系 | A | goal-planning-system-foundation::freeze-path | 部分 | 无强对应条目或仅词面近邻 freeze-path，须逐条落位复核 | 标题映射 |
| 182 | 失败分流 | A | goal-planning-system-foundation::stop | 部分 | 无强对应条目或仅词面近邻 stop，须逐条落位复核 | 标题映射 |
| 186 | 停止位置 | A | goal-planning-system-foundation::human-decide | 部分 | 无强对应条目或仅词面近邻 human-decide，须逐条落位复核 | 标题映射 |
| 190 | 8.1 可判定目标陈述的判据 | A | goal-planning-system-foundation::goal-statement-test | 已 | 词面强映射到 goal-statement-test（未逐字核） | 标题映射 |
| 201 | 8.2 子目标可核对的判据 | A | goal-planning-system-foundation::subgoal-test | 已 | 词面强映射到 subgoal-test（未逐字核） | 标题映射 |
| 216 | 8.3 确立路径 | A | goal-planning-system-foundation::freeze-path | 已 | 词面强映射到 freeze-path（未逐字核） | 标题映射 |
| 231 | 8.4 偏离的识别与处置 | A | goal-planning-system-foundation::deviation-action | 已 | 词面强映射到 deviation-action（未逐字核） | 标题映射 |
| 245 | 8.5 修订的级联边界 | A | goal-planning-system-foundation::cascade-scope | 已 | 词面强映射到 cascade-scope（未逐字核） | 标题映射 |
| 256 | 8.6 目标不产生授权（系统扩展） | A | goal-planning-system-foundation::not-authorization | 已 | 词面强映射到 not-authorization（未逐字核） | 标题映射 |
| 265 | 9. 结论承载与回写 | A | goal-planning-system-foundation::single-authority | 已 | 词面强映射到 single-authority（未逐字核） | 标题映射 |
| 281 | 10. 召回与消费 | A | goal-planning-system-foundation::consumption | 已 | 词面强映射到 consumption（未逐字核） | 标题映射 |
| 296 | 11. 风险路由与预检要求 | A | goal-planning-system-foundation::no-fast-path | 已 | 词面强映射到 no-fast-path（未逐字核） | 标题映射 |
| 310 | 12. 交还 | A | goal-planning-system-foundation::handover | 已 | 词面强映射到 handover（未逐字核） | 标题映射 |
| 320 | 13. 与相邻系统及能力的边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 337 | 14. 验证与证据边界 | A | goal-planning-system-foundation::semantic-bound | 已 | 读节判定：条目 semantic-bound 承接本节的规范性内容 | 读节 |
| 351 | 15. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 355 | 15.1 领域增量事项 | A | goal-planning-system-foundation::human-decide | 已 | 词面强映射到 human-decide（未逐字核） | 标题映射 |
| 366 | 15.2 决定边界 | A | goal-planning-system-foundation::human-decide | 已 | 词面强映射到 human-decide（未逐字核） | 标题映射 |
| 372 | 16. 必停情形 | A | ldvh-root::stop-conditions | 已 | 汇总节：必停的根触发由总纲承载，领域触发见其下各节 | 标题映射 |
| 376 | 16.1 领域触发与影响范围 | A | goal-planning-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 389 | 16.2 暂停期间允许动作 | A | goal-planning-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 393 | 16.3 恢复与再次触发 | A | goal-planning-system-foundation::stop | 部分 | 无强对应条目或仅词面近邻 stop，须逐条落位复核 | 标题映射 |
| 397 | 17. 反过度设计红线 | A | goal-planning-system-foundation::no-overdesign | 已 | 词面强映射到 no-overdesign（未逐字核） | 标题映射 |

### 31-火花记录系统规范.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 22 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 26 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 41 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 43 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 51 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 60 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 64 | 3.4 职责根边界与回指 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 70 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 72 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 85 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 91 | 5. 系统定位与价值 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 93 | 业务系统声明 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 101 | 稳定身份与 00 §2.6 登记名对应 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 105 | 解决的持续业务问题 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 109 | 服务消费方与核心价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 116 | 6. 进入与退出契约 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 118 | 进入信号 | A | spark-record-system-foundation::birthplace | 部分 | 无强对应条目或仅词面近邻 birthplace，须逐条落位复核 | 标题映射 |
| 125 | 适用条件 | A | spark-record-system-foundation::what-is | 部分 | 无强对应条目或仅词面近邻 what-is，须逐条落位复核 | 标题映射 |
| 129 | 排除条件 | A | spark-record-system-foundation::not-a-direction | 已 | 词面强映射到 not-a-direction（未逐字核） | 标题映射 |
| 133 | 不确定处理 | A | spark-record-system-foundation::not-a-direction | 已 | 词面强映射到 not-a-direction（未逐字核） | 标题映射 |
| 139 | 当次作用范围 | A | spark-record-system-foundation::scope-of-one | 已 | 词面强映射到 scope-of-one（未逐字核） | 标题映射 |
| 143 | 退出与转交条件 | A | spark-record-system-foundation::handback | 部分 | 无强对应条目或仅词面近邻 handback，须逐条落位复核 | 标题映射 |
| 147 | 7. 输入与前置条件 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 149 | 必需输入 | A | spark-record-system-foundation::what-is | 部分 | 无强对应条目或仅词面近邻 what-is，须逐条落位复核 | 标题映射 |
| 153 | 可选输入 | A | spark-record-system-foundation::dedup-outcomes | 部分 | 无强对应条目或仅词面近邻 dedup-outcomes，须逐条落位复核 | 标题映射 |
| 157 | 输入来源 | A | spark-record-system-foundation::business-not-order | 部分 | 无强对应条目或仅词面近邻 business-not-order，须逐条落位复核 | 标题映射 |
| 161 | 缺失和冲突处理 | A | spark-record-system-foundation::exclusive-options | 已 | 词面强映射到 exclusive-options（未逐字核） | 标题映射 |
| 171 | 8. 过程机制与分支 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 173 | 关键机制 | A | spark-record-system-foundation::human-gate | 部分 | 无强对应条目或仅词面近邻 human-gate，须逐条落位复核 | 标题映射 |
| 182 | 先后顺序或并行关系 | A | spark-record-system-foundation::not-a-direction | 部分 | 无强对应条目或仅词面近邻 not-a-direction，须逐条落位复核 | 标题映射 |
| 186 | 失败分流 | A | spark-record-system-foundation::stop | 部分 | 无强对应条目或仅词面近邻 stop，须逐条落位复核 | 标题映射 |
| 190 | 停止位置 | A | spark-record-system-foundation::business-not-order | 已 | 词面强映射到 business-not-order（未逐字核） | 标题映射 |
| 194 | 8.1 什么算「值得跨行动保留」 | A | spark-record-system-foundation::what-is | 已 | 词面强映射到 what-is（未逐字核） | 标题映射 |
| 205 | 8.2 什么不算（入口拦截与理由登记） | A | spark-record-system-foundation::not-a-direction | 已 | 词面强映射到 not-a-direction（未逐字核） | 标题映射 |
| 222 | 8.3 出生地与主线入口 | A | spark-record-system-foundation::priority-tier | 已 | 词面强映射到 priority-tier（未逐字核） | 标题映射 |
| 232 | 8.4 同题判定与合并/拆分 | A | spark-record-system-foundation::split | 已 | 词面强映射到 split（未逐字核） | 标题映射 |
| 254 | 8.5 分流的业务路由（回指 02 §6.4，本系统只保留准入点） | A | spark-record-system-foundation::not-a-direction | 已 | 词面强映射到 not-a-direction（未逐字核） | 标题映射 |
| 269 | 8.6 悬置不等于推进（系统扩展） | A | spark-record-system-foundation::suspended-not-progress | 已 | 词面强映射到 suspended-not-progress（未逐字核） | 标题映射 |
| 280 | 9. 结论承载与回写 | A | spark-record-system-foundation::single-entry | 已 | 词面强映射到 single-entry（未逐字核） | 标题映射 |
| 306 | 10. 召回与消费 | A | spark-record-system-foundation::consumption | 已 | 词面强映射到 consumption（未逐字核） | 标题映射 |
| 351 | 11. 风险路由与预检要求 | A | spark-record-system-foundation::risk-path | 已 | 词面强映射到 risk-path（未逐字核） | 标题映射 |
| 365 | 12. 交还 | A | spark-record-system-foundation::handback | 已 | 词面强映射到 handback（未逐字核） | 标题映射 |
| 375 | 13. 与相邻系统及能力的边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 392 | 14. 验证与证据边界 | A | spark-record-system-foundation::single-entry | 已 | 读节判定：条目 single-entry 承接本节的规范性内容 | 读节 |
| 405 | 15. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 409 | 15.1 领域增量事项 | A | spark-record-system-foundation::human-gate | 已 | 词面强映射到 human-gate（未逐字核） | 标题映射 |
| 421 | 15.2 决定边界 | A | spark-record-system-foundation::human-gate | 已 | 词面强映射到 human-gate（未逐字核） | 标题映射 |
| 427 | 16. 必停情形 | A | ldvh-root::stop-conditions | 已 | 汇总节：必停的根触发由总纲承载，领域触发见其下各节 | 标题映射 |
| 431 | 16.1 领域触发与影响范围 | A | spark-record-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 444 | 16.2 暂停期间允许动作 | A | spark-record-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 448 | 16.3 恢复与再次触发 | A | spark-record-system-foundation::business-not-order | 已 | 词面强映射到 business-not-order（未逐字核） | 标题映射 |
| 452 | 17. 反过度设计红线 | A | spark-record-system-foundation::entry-not-log | 已 | 词面强映射到 entry-not-log（未逐字核） | 标题映射 |

### 32-把关请示系统规范.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 22 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 26 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 37 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 39 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 49 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 59 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 65 | 3.4 职责根边界与回指 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 80 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 82 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 91 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 116 | 5. 系统定位与价值 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 118 | 5.1 服务对象归属 | A | gate-consult-system-foundation::what-it-is | 部分 | 无强对应条目或仅词面近邻 what-it-is，须逐条落位复核 | 标题映射 |
| 122 | 5.2 业务系统声明 | A | gate-consult-system-foundation::initiator | 已 | 词面强映射到 initiator（未逐字核） | 标题映射 |
| 131 | 6. 进入与退出契约 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 133 | 6.1 进入信号 | A | gate-consult-system-foundation::research-entry | 已 | 词面强映射到 research-entry（未逐字核） | 标题映射 |
| 141 | 6.2 适用条件 | A | gate-consult-system-foundation::research-no-silent | 已 | 词面强映射到 research-no-silent（未逐字核） | 标题映射 |
| 159 | 6.3 排除条件 | A | gate-consult-system-foundation::exclusion-beats-mode | 已 | 词面强映射到 exclusion-beats-mode（未逐字核） | 标题映射 |
| 169 | 6.4 不确定处理 | A | gate-consult-system-foundation::uncertain | 已 | 词面强映射到 uncertain（未逐字核） | 标题映射 |
| 175 | 6.5 当次作用范围 | A | gate-consult-system-foundation::scope-once | 已 | 词面强映射到 scope-once（未逐字核） | 标题映射 |
| 179 | 6.6 退出与转交条件 | A | gate-consult-system-foundation::answer-means | 已 | 词面强映射到 answer-means（未逐字核） | 标题映射 |
| 186 | 7. 输入与前置条件 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 188 | 7.1 必需输入 | A | gate-consult-system-foundation::trace-record | 部分 | 无强对应条目或仅词面近邻 trace-record，须逐条落位复核 | 标题映射 |
| 197 | 7.2 可选输入 | A | gate-consult-system-foundation::before-closing-entry | 部分 | 无强对应条目或仅词面近邻 before-closing-entry，须逐条落位复核 | 标题映射 |
| 201 | 7.3 来源 | A | gate-consult-system-foundation::before-action-entry | 部分 | 无强对应条目或仅词面近邻 before-action-entry，须逐条落位复核 | 标题映射 |
| 206 | 8. 请示内容的形式要求 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 210 | 8.1 问什么 | A | gate-consult-system-foundation::question-form | 已 | 词面强映射到 question-form（未逐字核） | 标题映射 |
| 220 | 8.2 不问什么 | A | gate-consult-system-foundation::not-in-question | 已 | 词面强映射到 not-in-question（未逐字核） | 标题映射 |
| 224 | 8.3 形态要求 | A | gate-consult-system-foundation::question-form | 已 | 词面强映射到 question-form（未逐字核） | 标题映射 |
| 228 | 8.4 缺输入时的处置 | A | gate-consult-system-foundation::missing-input | 已 | 词面强映射到 missing-input（未逐字核） | 标题映射 |
| 232 | 公开操作声明（05 §6.1 形状） | B | — | — | 同上 | 标题映射 |
| 240 | 9. 答复的效力与留痕 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 242 | 9.1 答复表明什么 | A | gate-consult-system-foundation::silent-answer-distinct | 已 | 词面强映射到 silent-answer-distinct（未逐字核） | 标题映射 |
| 252 | 9.2 答复不表明什么 | A | gate-consult-system-foundation::answer-means | 已 | 词面强映射到 answer-means（未逐字核） | 标题映射 |
| 256 | 9.3 留痕承载 | A | gate-consult-system-foundation::trace-record | 已 | 词面强映射到 trace-record（未逐字核） | 标题映射 |
| 273 | 9.4 谁能读取 | A | gate-consult-system-foundation::trace-access | 已 | 词面强映射到 trace-access（未逐字核） | 标题映射 |
| 277 | 9.5 已知缺口 | A | gate-consult-system-foundation::trace-access | 已 | 词面强映射到 trace-access（未逐字核） | 标题映射 |
| 284 | 10. 风险路由与快通道 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 286 | 10.1 风险路由 | A | gate-consult-system-foundation::what-it-is | 已 | 词面强映射到 what-it-is（未逐字核） | 标题映射 |
| 290 | 10.2 快通道 | A | gate-consult-system-foundation::what-it-is | 部分 | 无强对应条目或仅词面近邻 what-it-is，须逐条落位复核 | 标题映射 |
| 294 | 10.3 降级路径 | A | gate-consult-system-foundation::unreadable-values | 已 | 词面强映射到 unreadable-values（未逐字核） | 标题映射 |
| 299 | 11. 预检落实记录 | A | gate-consult-system-foundation::no-mechanical-guarantee | 已 | 词面强映射到 no-mechanical-guarantee（未逐字核） | 标题映射 |
| 305 | 12. 系统扩展 | A | gate-consult-system-foundation::independence | 部分 | 无强对应条目或仅词面近邻 independence，须逐条落位复核 | 标题映射 |
| 312 | 13. 交付合同 | A | gate-consult-system-foundation::handback | 已 | 词面强映射到 handback（未逐字核） | 标题映射 |
| 321 | 14. 与相邻系统及能力的边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 331 | 15. 实现边界 | A | gate-consult-system-foundation::no-mechanical-guarantee | 已 | 词面强映射到 no-mechanical-guarantee（未逐字核） | 标题映射 |
| 348 | 16. 验证与证据边界 | A | gate-consult-system-foundation::no-mechanical-guarantee | 已 | 读节判定：条目 no-mechanical-guarantee 承接本节的规范性内容 | 读节 |
| 373 | 17. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 377 | 17.1 领域增量事项 | A | gate-consult-system-foundation::human-decide | 已 | 词面强映射到 human-decide（未逐字核） | 标题映射 |
| 387 | 17.2 决定边界 | A | gate-consult-system-foundation::human-decide | 已 | 词面强映射到 human-decide（未逐字核） | 标题映射 |
| 391 | 18. 必停情形 | A | ldvh-root::stop-conditions | 已 | 汇总节：必停的根触发由总纲承载，领域触发见其下各节 | 标题映射 |
| 395 | 18.1 领域触发与影响范围 | A | gate-consult-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 401 | 18.2 暂停期间允许动作 | A | gate-consult-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 405 | 18.3 恢复与再次触发 | A | gate-consult-system-foundation::before-closing-entry | 部分 | 无强对应条目或仅词面近邻 before-closing-entry，须逐条落位复核 | 标题映射 |
| 409 | 19. 反过度设计红线 | A | gate-consult-system-foundation::no-overdesign | 已 | 词面强映射到 no-overdesign（未逐字核） | 标题映射 |

### 33-调研吸收系统规范.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 22 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 26 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 37 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 39 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 51 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 55 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 59 | 3.4 职责根边界与回指 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 70 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 72 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 82 | 4.1.1 目标锚定准入（Human 2026-11-20 决定：调研不再结构化锚定 SubGoal） | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 92 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 97 | 5. 系统定位与价值（02 §12.1 第 1 项） | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 108 | 5.1 服务对象归属（调研围绕谁） | A | research-system-foundation::service-object | 已 | 词面强映射到 service-object（未逐字核） | 标题映射 |
| 134 | 5.2 业务系统声明 | A | research-system-foundation::what-it-is | 已 | 词面强映射到 what-it-is（未逐字核） | 标题映射 |
| 150 | 6. 进入与退出契约 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 154 | 5.1 进入信号 | A | research-system-foundation::when-it-applies | 已 | 词面强映射到 when-it-applies（未逐字核） | 标题映射 |
| 165 | 5.2 适用条件 | A | research-system-foundation::preconditions | 已 | 词面强映射到 preconditions（未逐字核） | 标题映射 |
| 174 | 5.3 排除条件 | A | research-system-foundation::excludes | 已 | 词面强映射到 excludes（未逐字核） | 标题映射 |
| 184 | 5.4 不确定处理 | A | research-system-foundation::clarify-downgrade | 已 | 词面强映射到 clarify-downgrade（未逐字核） | 标题映射 |
| 194 | 5.5 当次作用范围 | A | research-system-foundation::exit | 已 | 词面强映射到 exit（未逐字核） | 标题映射 |
| 198 | 5.6 退出与转交条件 | A | research-system-foundation::exit | 已 | 词面强映射到 exit（未逐字核） | 标题映射 |
| 210 | 7. 输入与前置条件 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 214 | 6.1 必需输入 | A | research-system-foundation::inputs-and-missing | 已 | 词面强映射到 inputs-and-missing（未逐字核） | 标题映射 |
| 224 | 6.2 可选输入 | A | research-system-foundation::subagent | 部分 | 无强对应条目或仅词面近邻 subagent，须逐条落位复核 | 标题映射 |
| 230 | 6.3 来源 | A | research-system-foundation::ref-numbering | 部分 | 无强对应条目或仅词面近邻 ref-numbering，须逐条落位复核 | 标题映射 |
| 236 | 6.4 缺失和冲突处理 | A | research-system-foundation::inputs-and-missing | 已 | 词面强映射到 inputs-and-missing（未逐字核） | 标题映射 |
| 244 | 6.5 取证面分流判据 | A | research-system-foundation::evidence-surface | 已 | 词面强映射到 evidence-surface（未逐字核） | 标题映射 |
| 254 | 6.6 内部先查与联网提请的前置 | A | research-system-foundation::internal-first | 已 | 词面强映射到 internal-first（未逐字核） | 标题映射 |
| 264 | 8. 调研入口澄清 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 268 | 7.1 触发条件 | A | research-system-foundation::clarify-trigger | 已 | 词面强映射到 clarify-trigger（未逐字核） | 标题映射 |
| 278 | 7.2 澄清实现 | A | research-system-foundation::clarify-manner | 部分 | 无强对应条目或仅词面近邻 clarify-manner，须逐条落位复核 | 标题映射 |
| 282 | 7.3 澄清记录与注入 | A | research-system-foundation::clarify-manner | 已 | 词面强映射到 clarify-manner（未逐字核） | 标题映射 |
| 286 | 7.4 降级处理 | A | research-system-foundation::clarify-downgrade | 已 | 词面强映射到 clarify-downgrade（未逐字核） | 标题映射 |
| 291 | 9. 三层收敛判定 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 293 | 8.1 sufficient：充分收敛 | A | research-system-foundation::convergence | 已 | 词面强映射到 convergence（未逐字核） | 标题映射 |
| 300 | 8.2 no-gain：零增益收敛 | A | research-system-foundation::convergence | 部分 | 无强对应条目或仅词面近邻 convergence，须逐条落位复核 | 标题映射 |
| 306 | 8.3 round-cap：轮次上限收敛 | A | research-system-foundation::convergence | 部分 | 无强对应条目或仅词面近邻 convergence，须逐条落位复核 | 标题映射 |
| 312 | 8.4 收敛判定时机 | A | research-system-foundation::convergence | 部分 | 无强对应条目或仅词面近邻 convergence，须逐条落位复核 | 标题映射 |
| 317 | 10. 三态证据结构 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 319 | 9.1 confirmed：已证实 | A | research-system-foundation::evidence-states | 已 | 词面强映射到 evidence-states（未逐字核） | 标题映射 |
| 327 | 9.2 uncertain：未证实 | A | research-system-foundation::evidence-states | 已 | 词面强映射到 evidence-states（未逐字核） | 标题映射 |
| 337 | 9.3 gaps：缺口 | A | research-system-foundation::evidence-states | 部分 | 无强对应条目或仅词面近邻 evidence-states，须逐条落位复核 | 标题映射 |
| 350 | 11. 引用闭环 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 352 | 10.1 逐字摘录入库 | A | research-system-foundation::verbatim | 已 | 词面强映射到 verbatim（未逐字核） | 标题映射 |
| 363 | 10.2 报告引用可回指 | A | research-system-foundation::citation | 已 | 词面强映射到 citation（未逐字核） | 标题映射 |
| 369 | 10.3 程序化审计 | A | research-system-foundation::audit | 已 | 词面强映射到 audit（未逐字核） | 标题映射 |
| 381 | 12. 来源引用纪律 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 383 | 11.1 有值必有来源 | A | research-system-foundation::source-required | 已 | 词面强映射到 source-required（未逐字核） | 标题映射 |
| 387 | 11.2 稳定 ref 不复用 | A | research-system-foundation::ref-numbering | 已 | 词面强映射到 ref-numbering（未逐字核） | 标题映射 |
| 393 | 11.3 重注册刷新哈希 | A | research-system-foundation::ref-numbering | 部分 | 无强对应条目或仅词面近邻 ref-numbering，须逐条落位复核 | 标题映射 |
| 398 | 13. 结论承载与回写 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 402 | 12.1 承载载体 | B | — | — | 开发期或规范结构义务 | 标题映射 |
| 414 | 12.2 是否必须写入 | A | research-system-foundation::writeback-readback | 已 | 词面强映射到 writeback-readback（未逐字核） | 标题映射 |
| 418 | 12.3 目标来源 | A | research-system-foundation::carrier | 部分 | 无强对应条目或仅词面近邻 carrier，须逐条落位复核 | 标题映射 |
| 422 | 12.4 回读要求 | A | research-system-foundation::writeback-readback | 已 | 词面强映射到 writeback-readback（未逐字核） | 标题映射 |
| 426 | 12.5 不承载结论的情形 | A | research-system-foundation::writeback-readback | 已 | 词面强映射到 writeback-readback（未逐字核） | 标题映射 |
| 431 | 14. 交付合同 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 433 | 13.1 无占位符残留 | A | research-system-foundation::delivery | 部分 | 无强对应条目或仅词面近邻 delivery，须逐条落位复核 | 标题映射 |
| 439 | 13.2 每项声明挂证据 | A | research-system-foundation::delivery | 已 | 词面强映射到 delivery（未逐字核） | 标题映射 |
| 445 | 13.3 fail loud | A | research-system-foundation::delivery | 已 | 词面强映射到 delivery（未逐字核） | 标题映射 |
| 450 | 15. 与相邻系统及能力的边界 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 454 | 14.1 调研 vs 方案收敛 | A | research-system-foundation::what-it-is | 部分 | 无强对应条目或仅词面近邻 what-it-is，须逐条落位复核 | 标题映射 |
| 458 | 14.2 调研 vs 记忆 | A | research-system-foundation::exit | 部分 | 无强对应条目或仅词面近邻 exit，须逐条落位复核 | 标题映射 |
| 462 | 14.3 调研 vs 编排 | A | research-system-foundation::evidence-surface | 部分 | 无强对应条目或仅词面近邻 evidence-surface，须逐条落位复核 | 标题映射 |
| 466 | 14.4 调研 vs 能力承载（读/写/编排） | A | research-system-foundation::what-it-is | 部分 | 无强对应条目或仅词面近邻 what-it-is，须逐条落位复核 | 标题映射 |
| 474 | 14.5 调研 vs 制度（主控自查/独立复核/机械校验） | A | research-system-foundation::evidence-surface | 部分 | 无强对应条目或仅词面近邻 evidence-surface，须逐条落位复核 | 标题映射 |
| 482 | 14.6 与相近概念的区分 | A | research-system-foundation::excludes | 部分 | 无强对应条目或仅词面近邻 excludes，须逐条落位复核 | 标题映射 |
| 489 | 16. 调研子代理职责 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 491 | 15.1 任务边界 | A | research-system-foundation::subagent | 部分 | 无强对应条目或仅词面近邻 subagent，须逐条落位复核 | 标题映射 |
| 495 | 15.2 证据提交 | A | research-system-foundation::subagent | 已 | 词面强映射到 subagent（未逐字核） | 标题映射 |
| 499 | 15.3 结果整合 | A | research-system-foundation::subagent | 已 | 词面强映射到 subagent（未逐字核） | 标题映射 |
| 504 | 17. 风险路由与预检要求 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 508 | 16.1 风险层引用（指向 03 §6） | A | research-system-foundation::risk-path | 已 | 词面强映射到 risk-path（未逐字核） | 标题映射 |
| 514 | 16.2 最低预检覆盖 | A | research-system-foundation::risk-path | 部分 | 无强对应条目或仅词面近邻 risk-path，须逐条落位复核 | 标题映射 |
| 518 | 16.3 升级触发引用（指向 03 §6.3） | A | research-system-foundation::escalation | 已 | 词面强映射到 escalation（未逐字核） | 标题映射 |
| 522 | 16.4 降级路径引用（指向 03 §8） | A | research-system-foundation::escalation | 已 | 词面强映射到 escalation（未逐字核） | 标题映射 |
| 527 | 18. 交还 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 533 | 17.1 当次状态 | A | research-system-foundation::handover | 部分 | 无强对应条目或仅词面近邻 handover，须逐条落位复核 | 标题映射 |
| 538 | 17.2 结果与证据 | A | research-system-foundation::audit | 部分 | 无强对应条目或仅词面近邻 audit，须逐条落位复核 | 标题映射 |
| 543 | 17.3 已验证和未验证范围 | A | research-system-foundation::handover | 已 | 词面强映射到 handover（未逐字核） | 标题映射 |
| 548 | 17.4 残留风险 | A | research-system-foundation::handover | 部分 | 无强对应条目或仅词面近邻 handover，须逐条落位复核 | 标题映射 |
| 554 | 17.5 待决定事项 | A | research-system-foundation::human-gate | 已 | 词面强映射到 human-gate（未逐字核） | 标题映射 |
| 563 | 系统扩展：调研收敛信号枚举（依 03 §11.3 扩展规则 2） | A | research-system-foundation::convergence | 已 | 词面强映射到 convergence（未逐字核） | 标题映射 |
| 576 | 19. 验证与证据边界 | A | research-system-foundation::writeback-readback | 已 | 读节判定：条目 writeback-readback 承接本节的规范性内容 | 读节 |
| 593 | 20. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 597 | 19.1 领域增量事项 | A | research-system-foundation::human-gate | 已 | 词面强映射到 human-gate（未逐字核） | 标题映射 |
| 605 | 19.2 决定边界 | A | research-system-foundation::human-gate | 已 | 词面强映射到 human-gate（未逐字核） | 标题映射 |
| 610 | 21. 必停情形 | A | ldvh-root::stop-conditions | 已 | 汇总节：必停的根触发由总纲承载，领域触发见其下各节 | 标题映射 |
| 614 | 20.1 领域触发与影响范围 | A | research-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 627 | 20.2 暂停期间允许动作 | A | research-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 631 | 20.2.1 内部来源无锚点时的处置 | A | research-system-foundation::no-anchor | 已 | 词面强映射到 no-anchor（未逐字核） | 标题映射 |
| 641 | 20.3 恢复与再次触发 | A | research-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 646 | 22. 反过度设计红线 | A | research-system-foundation::audit | 已 | 词面强映射到 audit（未逐字核） | 标题映射 |

### 34-双源召回系统规范.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 23 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 27 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 40 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 42 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 53 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 57 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 63 | 3.4 职责根边界与回指 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 75 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 77 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 88 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 94 | 5. 系统定位与价值 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 96 | 业务系统声明 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 104 | 稳定身份与 00 §2.6 登记名对应 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 108 | 解决的持续业务问题 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 112 | 服务消费方与核心价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 120 | 6. 进入与退出契约 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 122 | 进入信号 | A | rule-compliance-recall::when-it-applies | 已 | 词面强映射到 when-it-applies（未逐字核） | 标题映射 |
| 126 | 适用条件 | A | rule-compliance-recall::when-it-applies | 已 | 词面强映射到 when-it-applies（未逐字核） | 标题映射 |
| 130 | 排除条件 | A | rule-compliance-recall::when-it-applies | 已 | 词面强映射到 when-it-applies（未逐字核） | 标题映射 |
| 134 | 不确定处理 | A | rule-compliance-recall::uncertainty | 已 | 词面强映射到 uncertainty（未逐字核） | 标题映射 |
| 138 | 当次作用范围 | A | rule-compliance-recall::when-it-applies | 已 | 词面强映射到 when-it-applies（未逐字核） | 标题映射 |
| 142 | 退出与转交条件 | A | rule-compliance-recall::zero-hit-exit | 已 | 词面强映射到 zero-hit-exit（未逐字核） | 标题映射 |
| 148 | 7. 输入与前置条件 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 150 | 必需输入 | A | rule-compliance-recall::conflict | 部分 | 无强对应条目或仅词面近邻 conflict，须逐条落位复核 | 标题映射 |
| 154 | 可选输入 | A | rule-compliance-recall::zero-hit-exit | 部分 | 无强对应条目或仅词面近邻 zero-hit-exit，须逐条落位复核 | 标题映射 |
| 158 | 输入来源 | A | rule-compliance-recall::two-sources | 已 | 词面强映射到 two-sources（未逐字核） | 标题映射 |
| 164 | 缺失和冲突处理 | A | rule-compliance-recall::conflict | 已 | 词面强映射到 conflict（未逐字核） | 标题映射 |
| 168 | 7.5 约束来源的层级参考（系统扩展） | A | rule-compliance-recall::conflict | 部分 | 无强对应条目或仅词面近邻 conflict，须逐条落位复核 | 标题映射 |
| 184 | 8. 过程机制与分支 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 188 | 8.1 关键机制 | A | rule-compliance-recall::applicability | 已 | 词面强映射到 applicability（未逐字核） | 标题映射 |
| 198 | 先后顺序或并行关系 | A | rule-compliance-recall::when-it-applies | 部分 | 无强对应条目或仅词面近邻 when-it-applies，须逐条落位复核 | 标题映射 |
| 202 | 失败分流 | A | rule-compliance-recall::uncertainty | 部分 | 无强对应条目或仅词面近邻 uncertainty，须逐条落位复核 | 标题映射 |
| 209 | 停止位置 | A | rule-compliance-recall::zero-hit-exit | 部分 | 无强对应条目或仅词面近邻 zero-hit-exit，须逐条落位复核 | 标题映射 |
| 213 | 8.2 候选卡与命中依据（本系统召回侧的核心承载） | A | rule-compliance-recall::hit-basis | 已 | 词面强映射到 hit-basis（未逐字核） | 标题映射 |
| 244 | 8.3 约束落实的判据（本系统核心判据） | A | rule-compliance-recall::consumption-instruction | 已 | 词面强映射到 consumption-instruction（未逐字核） | 标题映射 |
| 256 | 8.4 事实规范的 F1 常驻枚举（经验按需） | A | rule-compliance-recall::norm-directory | 已 | 词面强映射到 norm-directory（未逐字核） | 标题映射 |
| 322 | 9. 偏离的识别与处置 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 324 | 9.1 偏离的分类 | A | rule-compliance-recall::conflict | 部分 | 无强对应条目或仅词面近邻 conflict，须逐条落位复核 | 标题映射 |
| 333 | 9.2 偏离可见性 | A | rule-compliance-recall::when-it-applies | 部分 | 无强对应条目或仅词面近邻 when-it-applies，须逐条落位复核 | 标题映射 |
| 337 | 9.3 不追溯为已遵守 | A | rule-compliance-recall::when-it-applies | 部分 | 无强对应条目或仅词面近邻 when-it-applies，须逐条落位复核 | 标题映射 |
| 341 | 10. 结论承载与回写 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 343 | 以何种事实对象承载结论 | A | rule-compliance-recall::what-it-is | 部分 | 无强对应条目或仅词面近邻 what-it-is，须逐条落位复核 | 标题映射 |
| 351 | 是否必须写入 | A | rule-compliance-recall::zero-hit-exit | 部分 | 无强对应条目或仅词面近邻 zero-hit-exit，须逐条落位复核 | 标题映射 |
| 355 | 目标来源 | A | rule-compliance-recall::zero-hit-exit | 部分 | 无强对应条目或仅词面近邻 zero-hit-exit，须逐条落位复核 | 标题映射 |
| 359 | 回读要求 | A | rule-compliance-recall::zero-hit-exit | 部分 | 无强对应条目或仅词面近邻 zero-hit-exit，须逐条落位复核 | 标题映射 |
| 363 | 不承载结论的显式说明 | A | rule-compliance-recall::what-it-is | 已 | 词面强映射到 what-it-is（未逐字核） | 标题映射 |
| 367 | 11. 风险路由与预检要求 | A | rule-compliance-recall::budget | 已 | 词面强映射到 budget（未逐字核） | 标题映射 |
| 387 | 12. 交还 | A | rule-compliance-recall::recall-scope-disclosure | 已 | 词面强映射到 recall-scope-disclosure（未逐字核） | 标题映射 |
| 402 | 13. 与相邻系统及能力的边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 412 | 14. 验证与证据边界 | A | rule-compliance-recall::stable-reference | 已 | 读节判定：条目 stable-reference 承接本节的规范性内容 | 读节 |
| 436 | 15. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 440 | 15.1 领域增量事项 | A | rule-compliance-recall::conflict | 已 | 词面强映射到 conflict（未逐字核） | 标题映射 |
| 452 | 15.2 决定边界 | A | rule-compliance-recall::what-it-is | 部分 | 无强对应条目或仅词面近邻 what-it-is，须逐条落位复核 | 标题映射 |
| 456 | 16. 必停情形 | A | ldvh-root::stop-conditions | 已 | 汇总节：必停的根触发由总纲承载，领域触发见其下各节 | 标题映射 |
| 460 | 16.1 领域触发与影响范围 | A | rule-compliance-recall::zero-hit-exit | 已 | 词面强映射到 zero-hit-exit（未逐字核） | 标题映射 |
| 474 | 16.2 暂停期间允许动作 | A | rule-compliance-recall::incomplete-recall | 部分 | 无强对应条目或仅词面近邻 incomplete-recall，须逐条落位复核 | 标题映射 |
| 478 | 16.3 恢复与再次触发 | A | rule-compliance-recall::zero-hit-exit | 已 | 词面强映射到 zero-hit-exit（未逐字核） | 标题映射 |
| 482 | 17. 反过度设计红线 | A | rule-compliance-recall::zero-hit-exit | 已 | 词面强映射到 zero-hit-exit（未逐字核） | 标题映射 |

### 35-经验积累系统规范.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 23 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 27 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 43 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 45 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 55 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 63 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 67 | 3.4 职责根边界与回指 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 73 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 75 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 86 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 92 | 5. 系统定位与价值 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 94 | 业务系统声明 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 102 | 稳定身份与 00 §2.6 登记名对应 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 108 | 解决的持续业务问题 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 112 | 服务消费方与核心价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 119 | 6. 进入与退出契约 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 121 | 进入信号 | A | experience-accumulation-system-foundation::when-it-applies | 已 | 词面强映射到 when-it-applies（未逐字核） | 标题映射 |
| 134 | 适用条件 | A | experience-accumulation-system-foundation::entry-prerequisite | 已 | 词面强映射到 entry-prerequisite（未逐字核） | 标题映射 |
| 138 | 排除条件 | A | experience-accumulation-system-foundation::excludes | 已 | 词面强映射到 excludes（未逐字核） | 标题映射 |
| 142 | 不确定处理 | A | experience-accumulation-system-foundation::unsure-routing | 已 | 词面强映射到 unsure-routing（未逐字核） | 标题映射 |
| 148 | 当次作用范围 | A | experience-accumulation-system-foundation::entry-prerequisite | 已 | 词面强映射到 entry-prerequisite（未逐字核） | 标题映射 |
| 152 | 退出与转交条件 | A | experience-accumulation-system-foundation::handover | 部分 | 无强对应条目或仅词面近邻 handover，须逐条落位复核 | 标题映射 |
| 156 | 7. 输入与前置条件 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 158 | 必需输入 | A | experience-accumulation-system-foundation::entry-prerequisite | 部分 | 无强对应条目或仅词面近邻 entry-prerequisite，须逐条落位复核 | 标题映射 |
| 162 | 可选输入 | A | experience-accumulation-system-foundation::reflection-triggers | 部分 | 无强对应条目或仅词面近邻 reflection-triggers，须逐条落位复核 | 标题映射 |
| 166 | 输入来源 | A | experience-accumulation-system-foundation::excludes | 部分 | 无强对应条目或仅词面近邻 excludes，须逐条落位复核 | 标题映射 |
| 170 | 缺失和冲突处理 | A | experience-accumulation-system-foundation::conflict | 已 | 词面强映射到 conflict（未逐字核） | 标题映射 |
| 178 | 8. 过程机制与分支 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 180 | 关键机制 | A | experience-accumulation-system-foundation::capture-before-draft | 已 | 词面强映射到 capture-before-draft（未逐字核） | 标题映射 |
| 189 | 先后顺序或并行关系 | A | experience-accumulation-system-foundation::capture-before-draft | 已 | 词面强映射到 capture-before-draft（未逐字核） | 标题映射 |
| 195 | 失败分流 | A | experience-accumulation-system-foundation::not-candidate-reason | 部分 | 无强对应条目或仅词面近邻 not-candidate-reason，须逐条落位复核 | 标题映射 |
| 199 | 停止位置 | A | experience-accumulation-system-foundation::stop-scope | 部分 | 无强对应条目或仅词面近邻 stop-scope，须逐条落位复核 | 标题映射 |
| 203 | 8.1 什么算「值得留存的经验认识」 | A | experience-accumulation-system-foundation::retention-test | 已 | 词面强映射到 retention-test（未逐字核） | 标题映射 |
| 214 | 8.2 什么不算（入口拦截与理由登记） | A | experience-accumulation-system-foundation::excludes | 已 | 词面强映射到 excludes（未逐字核） | 标题映射 |
| 229 | 8.3 沉淀分流的领域展开（公共判据见 02 §6.4） | A | experience-accumulation-system-foundation::routing-order | 已 | 词面强映射到 routing-order（未逐字核） | 标题映射 |
| 286 | 8.4 候选成立的判据 | A | experience-accumulation-system-foundation::candidate-test | 已 | 词面强映射到 candidate-test（未逐字核） | 标题映射 |
| 300 | 8.5 反思的触发与去向 | A | experience-accumulation-system-foundation::reflection-output | 已 | 词面强映射到 reflection-output（未逐字核） | 标题映射 |
| 315 | 8.6 经验不得自行取得规则效力（系统扩展） | A | experience-accumulation-system-foundation::experience-not-rule | 已 | 词面强映射到 experience-not-rule（未逐字核） | 标题映射 |
| 326 | 9. 结论承载与回写 | A | experience-accumulation-system-foundation::write-readback | 已 | 词面强映射到 write-readback（未逐字核） | 标题映射 |
| 343 | 10. 召回与消费 | A | experience-accumulation-system-foundation::consumption | 已 | 词面强映射到 consumption（未逐字核） | 标题映射 |
| 358 | 11. 风险路由与预检要求 | A | experience-accumulation-system-foundation::risk-tier | 已 | 词面强映射到 risk-tier（未逐字核） | 标题映射 |
| 374 | 12. 交还 | A | experience-accumulation-system-foundation::handover | 已 | 词面强映射到 handover（未逐字核） | 标题映射 |
| 386 | 13. 与相邻系统及能力的边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 405 | 14. 验证与证据边界 | A | experience-accumulation-system-foundation::candidate-test | 已 | 读节判定：条目 candidate-test 承接本节的规范性内容 | 读节 |
| 417 | 15. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 421 | 15.1 领域增量事项 | A | experience-accumulation-system-foundation::human-gate | 已 | 词面强映射到 human-gate（未逐字核） | 标题映射 |
| 431 | 15.2 决定边界 | A | experience-accumulation-system-foundation::human-decision-bound | 已 | 词面强映射到 human-decision-bound（未逐字核） | 标题映射 |
| 437 | 16. 必停情形 | A | ldvh-root::stop-conditions | 已 | 汇总节：必停的根触发由总纲承载，领域触发见其下各节 | 标题映射 |
| 441 | 16.1 领域触发与影响范围 | A | experience-accumulation-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 453 | 16.2 暂停期间允许动作 | A | experience-accumulation-system-foundation::stop-scope | 已 | 词面强映射到 stop-scope（未逐字核） | 标题映射 |
| 457 | 16.3 恢复与再次触发 | A | experience-accumulation-system-foundation::stop-scope | 已 | 词面强映射到 stop-scope（未逐字核） | 标题映射 |
| 461 | 17. 反过度设计红线 | A | experience-accumulation-system-foundation::no-volume-as-evidence | 已 | 词面强映射到 no-volume-as-evidence（未逐字核） | 标题映射 |

### 36-摩擦销账系统规范.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 24 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 28 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 42 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 44 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 54 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 58 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 62 | 3.4 职责根边界与回指 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 72 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 74 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 85 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 91 | 5. 系统定位与价值 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 93 | 业务系统声明 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 101 | 稳定身份与 00 §2.6 登记名对应 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 105 | 解决的持续业务问题 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 109 | 服务消费方与核心价值 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 117 | 6. 进入与退出契约 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 119 | 进入信号 | A | friction-settlement-system-foundation::enters-when | 已 | 词面强映射到 enters-when（未逐字核） | 标题映射 |
| 123 | 适用条件 | A | friction-settlement-system-foundation::three-conditions-criteria | 部分 | 无强对应条目或仅词面近邻 three-conditions-criteria，须逐条落位复核 | 标题映射 |
| 127 | 排除条件 | A | friction-settlement-system-foundation::not-here | 已 | 词面强映射到 not-here（未逐字核） | 标题映射 |
| 131 | 不确定处理 | A | friction-settlement-system-foundation::three-conditions-criteria | 部分 | 无强对应条目或仅词面近邻 three-conditions-criteria，须逐条落位复核 | 标题映射 |
| 135 | 当次作用范围 | A | friction-settlement-system-foundation::handback | 部分 | 无强对应条目或仅词面近邻 handback，须逐条落位复核 | 标题映射 |
| 139 | 退出与转交条件 | A | friction-settlement-system-foundation::human-gate | 部分 | 无强对应条目或仅词面近邻 human-gate，须逐条落位复核 | 标题映射 |
| 143 | 7. 输入与前置条件 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 145 | 必需输入 | A | friction-settlement-system-foundation::enters-when | 部分 | 无强对应条目或仅词面近邻 enters-when，须逐条落位复核 | 标题映射 |
| 149 | 可选输入 | A | friction-settlement-system-foundation::stop | 部分 | 无强对应条目或仅词面近邻 stop，须逐条落位复核 | 标题映射 |
| 153 | 输入来源 | A | friction-settlement-system-foundation::enters-when | 部分 | 无强对应条目或仅词面近邻 enters-when，须逐条落位复核 | 标题映射 |
| 157 | 缺失和冲突处理 | A | friction-settlement-system-foundation::attribution-conflict | 已 | 词面强映射到 attribution-conflict（未逐字核） | 标题映射 |
| 161 | 7.5 入账三条件的判据细化（系统扩展） | A | friction-settlement-system-foundation::three-conditions-criteria | 已 | 词面强映射到 three-conditions-criteria（未逐字核） | 标题映射 |
| 177 | 7.6 摩擦发现的触发与上下文供给（系统扩展） | A | friction-settlement-system-foundation::discovery-trigger | 已 | 词面强映射到 discovery-trigger（未逐字核） | 标题映射 |
| 187 | 8. 过程机制与分支 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 189 | 8.1 入账判定的关键机制 | A | friction-settlement-system-foundation::three-conditions-criteria | 部分 | 无强对应条目或仅词面近邻 three-conditions-criteria，须逐条落位复核 | 标题映射 |
| 195 | 8.2 攒账与合并 | A | friction-settlement-system-foundation::accepted-hit | 已 | 词面强映射到 accepted-hit（未逐字核） | 标题映射 |
| 206 | 8.3 度量 | A | friction-settlement-system-foundation::measure | 已 | 词面强映射到 measure（未逐字核） | 标题映射 |
| 215 | 8.4 失败分流 | A | friction-settlement-system-foundation::record-path | 部分 | 无强对应条目或仅词面近邻 record-path，须逐条落位复核 | 标题映射 |
| 222 | 8.5 停止位置 | A | friction-settlement-system-foundation::record-path | 部分 | 无强对应条目或仅词面近邻 record-path，须逐条落位复核 | 标题映射 |
| 226 | 8.6 摩擦来源的三通道与判别（系统扩展） | A | friction-settlement-system-foundation::discovery-mechanical-bound | 已 | 词面强映射到 discovery-mechanical-bound（未逐字核） | 标题映射 |
| 244 | 8.7 摩擦发现的自动动作闭集（系统扩展） | A | friction-settlement-system-foundation::promotion | 已 | 词面强映射到 promotion（未逐字核） | 标题映射 |
| 263 | 8.8 摩擦观察缓冲（系统扩展） | A | friction-settlement-system-foundation::buffer-write | 已 | 词面强映射到 buffer-write（未逐字核） | 标题映射 |
| 298 | 9. 销账、废弃与接受的判定 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 300 | 9.1 销账（open → resolved）的成立条件 | A | friction-settlement-system-foundation::resolved | 已 | 词面强映射到 resolved（未逐字核） | 标题映射 |
| 312 | 9.2 废弃（→ voided）的理由分类 | A | friction-settlement-system-foundation::voided | 已 | 词面强映射到 voided（未逐字核） | 标题映射 |
| 324 | 9.3 暂不修 | A | friction-settlement-system-foundation::voided | 已 | 词面强映射到 voided（未逐字核） | 标题映射 |
| 332 | 9.4 接受（open → accepted） | A | friction-settlement-system-foundation::accepted | 已 | 词面强映射到 accepted（未逐字核） | 标题映射 |
| 358 | 10. 结论承载与回写 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 360 | 以何种事实对象承载结论 | A | friction-settlement-system-foundation::buffer-what | 部分 | 无强对应条目或仅词面近邻 buffer-what，须逐条落位复核 | 标题映射 |
| 364 | 是否必须写入 | A | friction-settlement-system-foundation::no-overdesign | 部分 | 无强对应条目或仅词面近邻 no-overdesign，须逐条落位复核 | 标题映射 |
| 368 | 目标来源 | A | friction-settlement-system-foundation::discovery-mechanical-bound | 部分 | 无强对应条目或仅词面近邻 discovery-mechanical-bound，须逐条落位复核 | 标题映射 |
| 372 | 回读要求 | A | friction-settlement-system-foundation::record-path | 部分 | 无强对应条目或仅词面近邻 record-path，须逐条落位复核 | 标题映射 |
| 376 | 不承载结论的显式说明 | A | friction-settlement-system-foundation::what-it-is | 部分 | 无强对应条目或仅词面近邻 what-it-is，须逐条落位复核 | 标题映射 |
| 380 | 11. 风险路由与预检要求 | A | friction-settlement-system-foundation::record-path | 已 | 词面强映射到 record-path（未逐字核） | 标题映射 |
| 392 | 12. 交还 | A | friction-settlement-system-foundation::handback | 已 | 词面强映射到 handback（未逐字核） | 标题映射 |
| 398 | 13. 与相邻系统及能力的边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 408 | 14. 验证与证据边界 | A | friction-settlement-system-foundation::discovery-mechanical-bound | 已 | 读节判定：条目 discovery-mechanical-bound 承接本节的规范性内容 | 读节 |
| 437 | 15. Human Gate | A | ldvh-root::decisions-are-human | 已 | 汇总节：人决定权与决定边界的共同前提由总纲承载，逐条见其下各节 | 读节 |
| 441 | 15.1 领域增量事项 | A | friction-settlement-system-foundation::human-gate | 已 | 词面强映射到 human-gate（未逐字核） | 标题映射 |
| 451 | 15.2 决定边界 | A | friction-settlement-system-foundation::human-gate | 部分 | 无强对应条目或仅词面近邻 human-gate，须逐条落位复核 | 标题映射 |
| 455 | 16. 必停情形 | A | ldvh-root::stop-conditions | 已 | 汇总节：必停的根触发由总纲承载，领域触发见其下各节 | 标题映射 |
| 459 | 16.1 领域触发与影响范围 | A | friction-settlement-system-foundation::stop | 已 | 词面强映射到 stop（未逐字核） | 标题映射 |
| 471 | 16.2 暂停期间允许动作 | A | friction-settlement-system-foundation::stop-scope | 已 | 词面强映射到 stop-scope（未逐字核） | 标题映射 |
| 475 | 16.3 恢复与再次触发 | A | friction-settlement-system-foundation::stop-scope | 已 | 词面强映射到 stop-scope（未逐字核） | 标题映射 |
| 479 | 17. 反过度设计红线 | A | friction-settlement-system-foundation::no-overdesign | 已 | 词面强映射到 no-overdesign（未逐字核） | 标题映射 |

### 02-事实源与事实模型基础规范.md

| 行 | 节（H2/H3） | 判定 | 承载载体::条目 id | 缺口 | 说明 | 依据 |
|---|---|---|---|---|---|---|
| 22 | 1. 价值判断 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 26 | 2. 规范依据 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 37 | 3. 职责边界 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 39 | 3.1 本文负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 50 | 3.2 本文不负责 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 62 | 3.3 相邻规范分工与唯一权威 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 68 | 4. 适用范围 | C | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 70 | 4.1 适用对象与场景 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 80 | 4.2 明确排除与证明边界 | C | — | — | 定义／价值／职责边界，不约束运行期行动 | 标题映射 |
| 86 | 5. 事实源载体与溯源 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 90 | 5.1 事实源载体 | A | fact-model-common::stable-fact-not-auto-object | 部分 | 无强对应条目或仅词面近邻 stable-fact-not-auto-object，须逐条落位复核 | 标题映射 |
| 94 | 5.2 Working Tree / Index / HEAD 三层语义 | A | fact-model-common::stable-fact-not-auto-object | 部分 | 无强对应条目或仅词面近邻 stable-fact-not-auto-object，须逐条落位复核 | 标题映射 |
| 100 | 5.3 稳定事实与未提交内容 | A | fact-model-common::stable-fact-not-auto-object | 部分 | 无强对应条目或仅词面近邻 stable-fact-not-auto-object，须逐条落位复核 | 标题映射 |
| 104 | 5.4 溯源 | A | fact-model-common::read-back-after-write | 部分 | 无强对应条目或仅词面近邻 read-back-after-write，须逐条落位复核 | 标题映射 |
| 110 | 6. 基础概念与准入 | A | — | — | 汇总节，逐条见其下各节 | 标题映射 |
| 112 | 6.1 稳定事实、事实类型与事实对象 | A | fact-model-common::evidence-self-contained | 已 | 词面强映射到 evidence-self-contained（未逐字核） | 标题映射 |
| 127 | 6.2 事实模型准入 | A | fact-model-common::admission-before-create | 已 | 词面强映射到 admission-before-create（未逐字核） | 标题映射 |
| 142 | 6.3 类型责任 | B | — | — | 类型责任的「各类型规范起草时至少回答哪些项」是规范写作义务，属开发期 | 读节 |
| 148 | 6.4 事实类型归属的判据与次序 | A | fact-model-common::type-routing-order | 已 | 本轮补写：内容归属的固定次序、取第一个成立项、判据 4/5 不择一、多重去向分别落位 | 读节 |
| 182 | 7. 公共对象身份与载体 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 184 | 7.1 公共身份字段 | A | fact-model-common::common-field-adoption | 已 | 本轮补写：类型登记采用面、缺省不得伪造、无统一关键词字段 | 读节 |
| 208 | 7.2 载体与权威位置 | A | fact-model-common::identity-by-machine | 已 | 读节判定：条目 identity-by-machine 承接本节的规范性内容 | 读节 |
| 217 | 7.3 正文结构的公共契约 | A | fact-model-common::header-mirror | 已 | 读节判定：条目 header-mirror 承接本节的规范性内容 | 读节 |
| 226 | 8. 来源、证据与关系共同边界 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 228 | 8.1 来源与证据 | A | fact-model-common::commit-target | 已 | 词面强映射到 commit-target（未逐字核） | 标题映射 |
| 245 | 8.2 公共关系形状 | A | fact-model-common::relation-key-closed | 已 | 词面强映射到 relation-key-closed（未逐字核） | 标题映射 |
| 291 | 9. 事实发现、召回与语义消费 | A | fact-model-common::consumption-four-conclusions | 已 | 本轮补写：发现／召回／展开／语义消费四结论不可互相替代 | 读节 |
| 302 | 9.1 F0–F4 分层 | A | rule-compliance-recall::recall-not-index | 部分 | F0–F4 分层矩阵与「不与规范读取分层混用」只在分层矩阵附件承载；分层不混用规则本载体无逐条对应 | 读节 |
| 308 | 9.2 召回进入条件 | A | fact-model-common::consumption-four-conclusions | 已 | 本轮补写：进入条件；新会话／压缩／委派不自动证明必要 | 读节 |
| 318 | 9.3 事实对象的指称形态 | A | fact-model-common::object-designation | 已 | 本轮补写：类型短名＋短标识的最小可读形态与不适用面 | 读节 |
| 337 | 9.4 授权附件 | B | — | — | 授权附件是规范结构角色，属开发期写作契约 | 读节 |
| 343 | 10. 受控读取、创建与更新共同契约 | A | — | — | 汇总节，逐条见其下各节 | 读节 |
| 345 | 10.1 共同前提 | A | fact-model-common::precheck-equivalent | 已 | 读节判定：条目 precheck-equivalent 承接本节的规范性内容 | 读节 |
| 376 | 10.2 只读路径 | A | fact-model-common::read-path-kinds | 已 | 本轮补写：候选发现／精确读取／证据展开／完整性审计四类及「机械有效」边界 | 读节 |
| 387 | 10.3 无副作用草案 | A | fact-model-common::read-path-kinds | 部分 | 草案「不得创建对象／预留标识／写缓存／写 Git ref」与草案绑定失效未逐条落载体；只读预检等价要求已由 precheck-equivalent 承载 | 读节 |
| 398 | 10.4 受控创建 | A | fact-model-common::stop-on-residual | 已 | 读节判定：条目 stop-on-residual 承接本节的规范性内容 | 读节 |
| 412 | 10.5 CAS 更新与更正 | A | fact-model-common::field-channel | 已 | 词面强映射到 field-channel（未逐字核） | 标题映射 |
| 440 | 10.6 多对象边界 | A | fact-model-common::multi-object | 已 | 词面强映射到 multi-object（未逐字核） | 标题映射 |
| 451 | 10.7 写后回读与适用完整性审计 | A | fact-model-common::stop-on-residual | 已 | 词面强映射到 stop-on-residual（未逐字核） | 标题映射 |
| 461 | 10.8 部分结果与交还 | A | fact-model-common::partial-handback | 已 | 词面强映射到 partial-handback（未逐字核） | 标题映射 |
| 475 | 11. 事实变更、生命周期与关系失效 | A | fact-model-common::relation-failure | 已 | 词面强映射到 relation-failure（未逐字核） | 标题映射 |
| 483 | 12. 事实类型规范共同结构 | B | — | — | 类型规范共同结构是规范写作契约 | 标题映射 |
| 487 | 12.1 共同结构 | B | — | — | 同上 | 标题映射 |
| 502 | 12.2 必填内容 | B | — | — | 同上 | 标题映射 |
| 527 | 12.3 扩展规则 | B | — | — | 同上 | 标题映射 |
| 540 | 12.4 机器可读召回判据表（格式契约） | B | — | — | 召回判据表是规范写作格式契约 | 标题映射 |
| 567 | 13. 验证与证据边界 | A | fact-model-common::mechanical-not-semantic | 部分 | 「机械结果不等于事实结论」已承载；本节另含「适用范围与未验证范围须交还」，只由 partial-handback 部分承接 | 标题映射 |
| 584 | 14. Human Gate | A | ldvh-root::decisions-are-human | 已 | Human Gate 的共同前提由总纲承载；本节只做领域增量 | 标题映射 |
| 588 | 14.1 领域增量事项 | A | ldvh-root::decisions-are-human | 部分 | 领域增量事项清单（哪些事属本领域的人决定）未逐条落载体 | 标题映射 |
| 600 | 14.2 决定边界 | A | fact-model-common::consumption-four-conclusions | 部分 | 无强对应条目或仅词面近邻 consumption-four-conclusions，须逐条落位复核 | 标题映射 |
| 604 | 15. 必停情形 | A | ldvh-root::stop-conditions | 已 | 必停的根触发由总纲承载 | 标题映射 |
| 608 | 15.1 领域触发与影响范围 | A | ldvh-root::stop-conditions | 部分 | 领域触发与最小影响范围是各类型的领域展开，共同口径只在总纲 | 标题映射 |
| 628 | 15.2 暂停期间允许动作 | A | ldvh-root::stop-conditions | 部分 | 「暂停期间允许动作」在各类型载体里有具体化，共同口径只有总纲必停条目的措辞，未逐条对应 | 标题映射 |
| 632 | 15.3 恢复与再次触发 | A | ldvh-root::stop-conditions | 已 | 恢复与再次触发归总纲 | 标题映射 |
| 636 | 16. 反过度设计红线 | A | fact-model-common::admission-before-create | 部分 | 红线（不为齐整造对象、不为一次性内容对象化）只部分体现在准入口径里，无逐条对应 | 标题映射 |

## 二、验证表逐行落位（§13／§14／§15／§16／§19 一带）

以下按各规范验证表的**行**核对；跨载体承接的注明另一份载体。结论均为读节判定。

### `specs/20` §14.1 类型特有验证（6 项）与 §15 验证表（7 行）

| 验证项／行 | 承载 | 结论 |
|---|---|---|
| 单例 fail-closed | `goal-fact-type::single-instance` | 已 |
| 子目标不落本载体 | `goal-fact-type::subgoals-not-stored` | 已 |
| 载体内聚（frontmatter 与正文对应段逐字一致） | 无 | 部分：载体无对应条目；且 22／23／25／26 均记「已取消逐字义务」，口径相抵（见第四节） |
| 目标陈述长度上限 | `goal-fact-type::limits` | 已 |
| 修订授权绑定 | `goal-fact-type::update-record` | 已 |
| achieved 证据链完整性 | `goal-fact-type::achieved-evidence` | 已 |
| §15 单例存在性 | `goal-fact-type::single-instance` | 已 |
| §15 子目标归属可解析 | `subgoal-fact-type::parent-anchor`（跨载体） | 已 |
| §15 修订授权 | `goal-fact-type::update-record` | 已 |
| §15 achieved 证据链 | `goal-fact-type::achieved-evidence`、`::evidence-layers` | 已 |
| §15 级联标记正确性 | `goal-fact-type::revision-cascade` | 已 |
| §15 子目标不存储于本载体 | `goal-fact-type::subgoals-not-stored` | 已 |
| §15 目标陈述长度 | `goal-fact-type::limits` | 已 |

### `specs/21` §14.1（6 项）与 §15（11 行）

| 验证项／行 | 承载 | 结论 |
|---|---|---|
| `order` 形状 | `subgoal-fact-type::display-order` | 已 |
| `parent_goal` 可解析 | `subgoal-fact-type::parent-anchor` | 已 |
| `serves` 解析成立 | `subgoal-fact-type::serves` | 已 |
| 正文与字段分工（不要求逐字） | `subgoal-fact-type::body-structure` | 已 |
| 状态与 `disposition` 互斥 | `subgoal-fact-type::states` | 已 |
| 空集歧义可见 | `subgoal-fact-type::empty-set` | 已 |
| §15 `order` 形状与身份稳定 | `identity`、`display-order` | 已 |
| §15 判据可判定性 | `criterion-kind`、`mechanical-bound` | 已 |
| §15 对齐说明成立 | `alignment` | 已 |
| §15 查重结论 | `dedup` | 已 |
| §15 Human 确认已发生 | `create-human` | 已 |
| §15 达成证据覆盖 | `achievement-evidence` | 已 |
| §15 提请前机械预检 | `precheck` | 已 |

### `specs/22` §14.1（9 项）与 §15（13 行）

| 验证项／行 | 承载 | 结论 |
|---|---|---|
| 查重结果记录 | `spark-fact-type::dedup` | 已 |
| 授权确认（创建、终态） | `spark-fact-type::ask-human` | 已 |
| 大改判据交还 | `spark-fact-type::big-change` | 已 |
| 合并/拆分去向校验 | `spark-fact-type::merge-split-order` | 已 |
| 状态-关系不变量 | `spark-fact-type::state-implemented`、`::state-discarded` | 已 |
| 终态处置完整性 | `spark-fact-type::limits`、`::states` | 已 |
| `summary` 长度 | `spark-fact-type::limits` | 已 |
| 正文与字段分工 | `spark-fact-type::carrier-structure` | 已 |
| 非原子例外次序（语义层） | `merge-split-order`、`merge-split-recovery`、`merge-split-not-atomic` | 已（机械层与语义层分层已写进条目） |
| §15 载体结构 | `carrier-structure` | 已 |
| §15 question 可读性 | `what-is`、`stop` | 已 |
| §15 `serves` 必填且有效 | `serves-required` | 已 |
| §15 `refs` 目标可解析 | `refs` | 已 |
| §15 priority 闭集/互斥/必填 | `priority` | 已 |
| §15 合并/拆分去向 | `merge-split-order` | 已 |
| §15 授权确认 | `ask-human` | 已 |
| §15 大改判据交还 | `big-change` | 已 |

### `specs/23` §13.1（7 项）与 §14（9 行）

| 验证项／行 | 承载 | 结论 |
|---|---|---|
| 查重结果记录 | `norm-fact-type::dedup` | 已 |
| `direction_key` 合法性 | `norm-fact-type::identity` | 已 |
| `direction_key` 唯一性 | `norm-fact-type::collision` | 已 |
| 正文骨架完整 | `norm-fact-type::body-sections` | 已 |
| 终态完整性 | `norm-fact-type::terminal` | 已 |
| 状态-字段不变量 | `norm-fact-type::terminal`、`::revise-active` | 已 |
| 强制面声明完整性 | `norm-fact-type::enforcement-declaration`、`::enforcement-minimum`、`::two-faces` | 已 |
| §14 方向定位两句 | `positioning-two-lines` | 已 |
| §14 规则内容质量 | `systematic-test`、`no-overclaim` | 已（语义判断） |
| §14 跨方向约束一致性 | `no-relations`（只覆盖"他处引用不重述"） | 部分：缺"引用他方向规则时目标须存在且生效"的可核对要求 |
| §14 强制面声明 | `enforcement-declaration`、`two-faces` | 已 |

### `specs/24` §14–§15（9 行）

| 行 | 承载 | 结论 |
|---|---|---|
| 类型定义 | — | B（本文作为规范自身的成立条件） |
| 对象准入与边界 | `report-fact-type::what-is`、`::five-forms`、各形态条 | 已 |
| 身份与载体 | `carrier`、`body-skeleton` | 已 |
| 三态与溯源锚点 | `findings-and-states`、`research-form`、`internal-forms` | 已 |
| 状态与生命周期 | `status` | 已 |
| 终态事实更正边界 | `correction` | 已 |
| 关系契约 | `relations` | 已 |
| 召回与消费 | `recall` | 已 |
| 受控写入 | `fact-model-common::read-back-after-write`、`::fingerprint-baseline`（跨载体） | 已 |

### `specs/25` §14.1（5 项）与 §15（6 行）

| 验证项／行 | 承载 | 结论 |
|---|---|---|
| 查重结果记录 | `pitfall-fact-type::dedup` | 已 |
| 正文与字段分工 | `pitfall-fact-type::carrier`（文件头与正文不要求逐字一致） | 已 |
| 补充边界（范围逐字段不变） | `pitfall-fact-type::correct-vs-new` | 已 |
| 终态完整性（`disposition` 非空、≤200 字符） | `state-discarded`、`correct-fields` | 已 |
| 状态-终态不变量 | `state-active`、`state-discarded` | 已 |
| §15 载体结构 | `body-sections`、`carrier` | 已 |
| §15 经验质量（创建段） | `create-quality`、`body-sections` | 已 |

### `specs/26` §14.1（6 项）与 §15（8 行）

| 验证项／行 | 承载 | 结论 |
|---|---|---|
| 查重结果记录 | `friction-fact-type::dedup` | 已 |
| 正文与字段分工 | `title-phenomenon`（差异只报告、不阻断） | 已 |
| 状态-关系不变量（按 key 分列） | `relations`、`resolved`、`voided`、`accepted-boundary` | 已 |
| 证据定位采用面（只挂解药边、哈希须可解析） | `relations` | 已 |
| 配对反查接通 | `pair-lookup` | 已 |
| 处置段条件 / 终态去向条件 | `body-sections`、`disposition` | 已 |
| §15 终态完整性（结构项） | `resolved`、`voided`、`accepted-boundary` | 已 |
| §15 终态完整性（内容项） | `voided`、`accepted-boundary`、`accepted-transition` | 已 |
| §15 配对完整性 | `pair-lookup`、`relations` | 已 |
| §15 账目质量 | `three-conditions`、`body-sections` | 已 |

### `specs/30` §14（7 行）

| 行 | 承载 | 结论 |
|---|---|---|
| 目标陈述的四项判据 | `goal-planning-system-foundation::goal-statement-test` | 已 |
| 子目标的可核对性 | `subgoal-test`、`criterion-kind` | 已 |
| 子目标对齐已作说明 | `alignment` | 已 |
| Human 确认已发生 | `freeze-path`、`human-decide` | 已 |
| 单例约束 | `goal-fact-type::single-instance`（跨载体） | 已 |
| 修订级联已作标记 | `cascade-scope`、`cascade-not-modify` | 已 |
| 目标未被当作授权使用 | `not-authorization` | 已 |

### `specs/31` §14（6 行）

| 行 | 承载 | 结论 |
|---|---|---|
| 保留判据的四项 | `spark-record-system-foundation::what-is` | 已 |
| 出生地成立与主线入口唯一 | `birthplace`、`single-entry` | 已 |
| 同题判定已作并记录 | `dedup`、`dedup-outcomes` | 已 |
| 不构成方向线的判定已登记理由 | `judgement-reason` | 已 |
| 合并与拆分的终态纪律 | `merge-split-not-done` | 已 |
| 悬置未被当作推进 | `suspended-not-progress` | 已 |

### `specs/32` §16（14 行）

| 行 | 承载 | 结论 |
|---|---|---|
| 请示已发出 | `gate-consult-system-foundation::before-action-entry`、`::before-closing-entry`、`::research-entry` | 已 |
| 答复已记录 | `trace-record` | 已 |
| 开关关闭时不请示 | `independence`、`silent-subordinate` | 已 |
| 点位排除下不请示 | `point-exclusions`、`exclusion-beats-mode` | 已 |
| 静默档下不发出请示 | `silent-subordinate`、`silent-trace` | 已 |
| 静默档不越过开关 | `silent-subordinate` | 已 |
| 静默档安排不能成立时的处置 | `silent-arrange-fails` | 已 |
| 同一内容不重复提问 | `scope-once` | 已 |
| 行动前那处的判断依据已交还（弱约束） | `no-mechanical-guarantee` | 已 |
| 第三处请示已发出 | `research-entry` | 已 |
| 第三处开关关闭时不提请 | `research-no-silent` | 已 |
| 第三处的内部读数已交付 | `research-entry` | 已 |
| 第三处答复已记录 | `trace-record` | 已 |

### `specs/33` §19（7 行）

| 行 | 承载 | 结论 |
|---|---|---|
| 进入与退出契约 | `research-system-foundation::when-it-applies`、`::preconditions`、`::exit` | 已 |
| 入口澄清 | `clarify-trigger`、`clarify-manner`、`clarify-downgrade` | 已 |
| 三层收敛判定 | `convergence` | 已 |
| 三态证据填充 | `evidence-states` | 已 |
| 引用闭环 | `verbatim`、`citation`、`audit` | 已 |
| 交付合同 | `delivery` | 已 |
| 结论承载与回写 | `carrier`、`writeback-readback` | 已 |

### `specs/34` §14（15 行）

| 行 | 承载 | 结论 |
|---|---|---|
| 进入判定 | `rule-compliance-recall::when-it-applies` | 已 |
| 三段判断齐备 | `rule-compliance-verification::three-tests`（另一份载体） | 已 |
| 约束落实 | `rule-compliance-verification::implementation-criteria` | 已 |
| 「确认无需改变」结论的归属 | `rule-compliance-verification::three-tests` | 已 |
| 未识别缺口的登记 | `rule-compliance-recall::recall-scope-disclosure`、`::incomplete-recall` | 已 |
| 偏离登记时机 | `rule-compliance-verification::deviation-register` | 已 |
| 横切合并且不替代 | `rule-compliance-recall::cross-cut` | 已 |
| 召回范围三态与未检查范围 | `rule-compliance-recall::recall-scope-disclosure` | 已 |
| 零命中退出记录 | `zero-hit-exit` | 已 |
| 命中不等于适用 | `applicability` | 已 |
| 命中依据可复算 | `hit-basis` | 已 |
| 稳定引用书写形态披露 | `stable-reference` | 已 |
| 稳定引用在交付面可用 | `stable-reference`、`consumption-instruction` | 已 |
| 消费方法与候选同时可见 | `consumption-instruction` | 已 |
| 候选选择优先精确率 | `selection-under-budget`、`budget` | 已 |

### `specs/35` §14（5 行）

| 行 | 承载 | 结论 |
|---|---|---|
| 留存判据的四项 | `experience-accumulation-system-foundation::retention-test` | 已 |
| 候选成立的五项 | `candidate-test` | 已 |
| 沉淀分流的归属已作出 | `routing-order`、`not-fixability-judgement`、`pairing-not-either` | 已 |
| 经验未自行取得规则效力 | `experience-not-rule` | 已 |
| 反思的触发与去向已记录 | `reflection-triggers`、`reflection-output` | 已 |

### `specs/36` §14（24 行）

| 行 | 承载 | 结论 |
|---|---|---|
| 入账三条件 | `friction-settlement-system-foundation::three-conditions-criteria` | 已 |
| 查重完整性 | `dedup` | 已 |
| 同源合并 | `merge` | 已 |
| 销账解药成立 | `resolved` | 已 |
| 废弃理由分类 | `voided` | 已 |
| 接受判据 | `accepted` | 已 |
| 阈值晋升 | `promotion` | 已 |
| 派发准入 | — | 条件式：本行当前不产生判定，载体亦无对应（一致） |
| 发起不构成执行完成 | `discovery-trigger` | 已 |
| 主控发起的观察频次如实登记 | `discovery-trigger` | 已 |
| 上下文供给的有界性 | `discovery-context` | 已 |
| 逐字引证 | `buffer-what`（证据须为交付材料的逐字片段）、`discovery-context` | 已 |
| 自动动作边界 | `discovery-closed-set`、`discovery-mechanical-bound` | 已 |
| 摩擦观察条目的写入合法（14 项字段闭集等） | `buffer-what` | 已（本轮补写） |
| 摩擦观察条目到期淘汰的登记（登记键去重、回写失败销账） | `buffer-what` | 已（本轮补写） |
| 摩擦缓冲的准入合法性 | `buffer-what`、`buffer-read` | 已 |
| 缓冲条目不可写／不可回读 | `buffer-read` | 已 |
| fail-closed 处置 | `fail-closed` | 已 |
| 路径约定落实 | `record-path` | 已 |
| 判断责任不归主控时的预检落实 | `record-path`、`fail-closed` | 部分：预检由调度侧配置与"语义判断登记为 gap"未逐条落条目 |
| 交还的接受 | `handback` | 已 |
| 运行完成（逐行结论闭集与整轮成立） | `fail-closed` | 已（本轮补写） |

### `specs/02` §13 验证与证据边界

- 未逐行读（本轮只读到 §10、§12 一带与 Human Gate/必停节标题）。§13 的规范性内容（机械结果与语义判断互不替代、适用范围与未验证范围须交还）已由 `fact-model-common::mechanical-not-semantic` 与 `::partial-handback` 承载；**结论为"已（按标题与条目词面映射，未逐字核）"**，落地前须复核。

## 三、`specs/02` 的承载画像

`specs/02` 共 16 个 H2、31 个 H3。承载它的载体只有 `fact-model-common`（25 条 → 本轮 30 条）。逐段结论：

| 02 的节 | 承载情况 | 载体条目 |
|---|---|---|
| §1 价值判断、§2 规范依据 | C，不要求承载 | — |
| §3 职责边界（含 3.1–3.3） | C | — |
| §4 适用范围（含 4.1–4.2） | C | — |
| §5.1 事实源载体 | 部分 | `stable-fact-not-auto-object`、`one-authority-carrier` 只接住"稳定内容不自动对象化""一个对象一个权威载体"；"事实源载体是什么形态"未落 |
| §5.2 Working Tree / Index / HEAD 三层语义 | 已（部分词面） | `one-authority-carrier`（暂存区、历史提交、缓存都是派生结果） |
| §5.3 稳定事实与未提交内容 | 部分 | `stable-fact-not-auto-object`；"未提交内容不得当稳定事实消费"无独立条目 |
| §5.4 溯源 | 部分 | `source-recorded`、`evidence-self-contained`、`read-back-after-write` |
| §6.1 稳定事实、事实类型与事实对象 | 部分 | `stable-fact-not-auto-object`（三者区分只在开头一句） |
| §6.2 事实模型准入 | 已 | `admission-before-create` |
| §6.3 类型责任 | B（规范写作义务） | — |
| §6.4 事实类型归属的判据与次序 | 已（**本轮新增**） | `type-routing-order` |
| §7.1 公共身份字段 | 已（**本轮新增**）+ 既有 | `common-field-adoption`、`identity-by-machine`、`change-log-once` |
| §7.2 载体与权威位置 | 已 | `one-authority-carrier`、`unique-scope` |
| §7.3 正文结构的公共契约 | 已 | `header-mirror` |
| §8.1 来源与证据 | 已 | `source-recorded`、`evidence-self-contained` |
| §8.2 公共关系形状 | 已 | `relations-minimal`、`relation-key-closed`、`relation-failure`、`relation-vs-content-ref`、`commit-target` |
| §9 四结论 + §9.2 召回进入条件 | 已（**本轮新增**） | `consumption-four-conclusions`（相似度不得自动裁决另由 `rule-compliance-recall::recall-not-index` 承载） |
| §9.1 F0–F4 分层 | 部分 | 分层矩阵只在授权附件 `fact-recall-layers` 里；"不得与规范读取分层混用"无载体条目（载体只覆盖"截断/分页须可观察"于 `partial-handback`） |
| §9.3 事实对象的指称形态 | 已（**本轮新增**） | `object-designation` |
| §9.4 授权附件 | B（规范结构角色） | — |
| §10.1 共同前提 | 已 | `unique-scope`、`fingerprint-baseline`、`input-required-set`、`precheck-equivalent`、`after-complete`、`field-channel` |
| §10.2 只读路径 | 已（**本轮新增**） | `read-path-kinds` |
| §10.3 无副作用草案 | 部分 | 只读预检的等价性有 `precheck-equivalent`；"不得创建对象／预留标识／写缓存／写 Git ref"与"草案绑定变化须失效"未落 |
| §10.4–10.8 受控创建／CAS／多对象／回读／部分交还 | 已 | `identity-by-machine`、`read-back-after-write`、`stop-on-residual`、`multi-object`、`partial-handback` |
| §11 事实变更、生命周期与关系失效 | 已（关系侧） | `relation-failure`、`relation-key-closed` |
| §12.1–12.4 类型规范共同结构 | B（规范写作契约） | — |
| §13 验证与证据边界 | 已（按词面映射，未逐字核） | `mechanical-not-semantic`、`partial-handback` |
| §14 Human Gate／§15 必停 | 已（跨载体） | `ldvh-root::decisions-are-human`、`::stop-conditions`；§15.2「暂停期间允许动作」只有总纲口径（部分） |
| §16 反过度设计红线 | 已 | `admission-before-create`、`stable-fact-not-auto-object` |

**一句话画像**：`fact-model-common` 承接的是 02 的 **§6.2、§6.4、§7、§8、§9（§9.1 矩阵除外）、§10.1–§10.2、§10.4–§10.8、§11、§13**；**不承接** §5 的溯源与三层语义细节、§6.1 的三概念区分、§6.3 与 §12（属 B）、§9.1 的分层不混用、§9.4（B）、§10.3 的草案纪律，§14–§16 由总纲与准入条目分担。本轮新增 5 条把 §6.4、§7.1、§9、§9.2、§9.3、§10.2 补齐；**仍留 5 处部分覆盖**（§5.1、§5.3、§5.4、§6.1、§9.1、§10.3、§15.2，其中 §5.1／§5.3／§6.1 同源）。

## 四、同题不同口径（如实登记，未择一）

1. **载体内聚（正文与字段是否须逐字一致）**
   - `specs/20` §14.1「载体内聚」与 §15 表述为：`title`、`scope` 等 frontmatter 权威字段与正文对应段**逐字一致**（frontmatter 为唯一权威文本）。
   - `specs/21` §14.1、`specs/22` §9.1／§14.1、`specs/23` §7、`specs/25` §14.1、`specs/26` §14.1 均表述为：**不要求逐字一致**，差异只报告不阻断（理由：Human 决定取消「载体内聚」义务）。
   - 载体侧：`subgoal-fact-type::body-structure`、`spark-fact-type::carrier-structure`、`pitfall-fact-type::carrier`、`friction-fact-type::title-phenomenon` 采用"不要求逐字一致"；`goal-fact-type` 无任何一致性条目（既未写"须逐字"，也未写"不须"）。**本轮未择一，也未为 `goal-fact-type` 增写条目**——两条口径方向相反，须由 Human 裁定后统一。
2. **摩擦发现的派发准入**
   - `specs/36` §14「派发准入」行声明：本行当前不产生判定，派发准入由 §7.6 的进入契约界定。
   - 同规范 §7.6／载体 `friction-settlement-system-foundation::discovery-context` 要求交付材料**须有界**（不得交付未挑选的全量会话历史），且无界时 fail-closed。
   - 一处说"当前无准入约束"，一处说"无界即不得执行"。二者是否冲突取决于「准入」是否包含"交付材料形态"；本轮**只登记、未判定、未改措辞**。

## 五、开发期规范的处置建议（`specs/01`、`04`–`08`、`10`、`11`）

判断标准：该规范是否**约束运行期行动**（A），还是只约束"规范怎么写、机制怎么建、工程怎么做"（B）。

| 规范 | 判定 | 依据 | 解绑后的身份 |
|---|---|---|---|
| `01` 规范源与规范模型 | **B**（含少量 C） | 管 YAML 身份块、通用章节契约、编号登记、授权附件、规范成立条件、新建/修改/重构判断、独立审核方法——全是"规范如何写、如何成立、如何登记"。§10.2 的 L0–L4 读取层级原本是运行期读取入口，**入口已撤**，其层级不再有运行期消费点；§12 独立审核若仍要在运行期使用，属**另一件事**（需另立载体），本轮不主张它已被承载。 | 需求记录文档（`docs/`）。运行期仍在用的两条已另有承载：先钉唯一范围 → `fact-model-common::unique-scope`；规则不自我制造 → `ldvh-root::rule-no-self-made`。**不构成缺口**。 |
| `04` 检查与辅助机制 | **B** | 主控自查／代理复核／机械校验／代理辅助任务的分工、视角纪律、协同与交还。 | 需求记录文档；**核对面已有载体** `rule-compliance-verification`（20 条），交还结构由 `ldvh-root::handback` 承载。**不构成缺口**。 |
| `05` LDVH CLI 确定性服务 | **B**（契约面） | 公开操作声明形状、共同请求/响应语义、能力发现、预热协作——是实现契约。 | 需求记录文档；**回执语义已有载体** `service-contract`（27 条）。**不构成缺口**。 |
| `06` Code 实践与测试 | **B** | 编码与测试纪律、强/弱约束判定。运行期被引用的 06 §5／§6（只提供依据、不代为判定）已由 `spark-fact-type::big-change` 落实为可执行要求。 | 需求记录文档。**不构成缺口**。 |
| `07` Web 呈现与交互 | **B** | 呈现层与交互契约。运行期的呈现义务由各类型载体的投影/呈现条目与 `ldvh-root` 表达。 | 需求记录文档。**不构成缺口**。 |
| `08` 管辖范围 | **B**（判定方法） | 管辖登记、取消、边界划定的方法。运行期"先钉唯一范围、多处冲突零写入"由 `fact-model-common::unique-scope`、`::one-authority-carrier` 承载。 | 需求记录文档。**不构成缺口**。 |
| `10` DSH 环境接入 | **B**（实现面） | 宿主注入、询问入口、上下文装配的接入方式。运行期询问规则由 `gate-consult-system-foundation` 承载。 | 需求记录文档。**不构成缺口**；但"询问入口是否实际具备"属观察项，不由文档保证。 |
| `11` 插件规范载体规范 | **B** | 它本身就是载体的写作与校验契约。其机械部分由 `plugin/lib/runtime-carrier-validator.js` 落地。 | 需求记录文档。**不构成缺口**。 |

> 说明：以上"不构成缺口"的判断依据是 **B 类不要求运行期载体**，不是"这些规范已无用"。它们仍以需求记录文档的身份留在 `specs/`，供开发期查阅；解绑后它们不再对运行期行动有规范效力。

## 六、仍未逐条落位的清单（107 条）

完整清单＝第一节表中「缺口」列为**部分**的行（可按列筛选）。其中**读节判定为部分的只有 6 条**，其余 101 条是"词面未对上、须复核"。按成因分组（均为 A 类）：

**A. 读节确认的部分缺口（6 条，优先落位）**

1. `20` §14.1「载体内聚」——载体无对应条目，且与 22／23／25／26 的"已取消逐字义务"口径相抵（见第四节）。
2. `20` §15「子目标归属可解析」——每次读取前核对的口径由 `subgoal-fact-type::parent-anchor` 承载，Goal 侧无对应行。
3. `23` §14「跨方向约束一致性」——载体只写了"他处只引用不重述"，缺"引用目标须存在且生效"的可核对要求。
4. `02` §9.1「F0–F4 分层」——分层矩阵只在授权附件里，"不得与规范读取分层混用"无载体条目。
5. `02` §10.3「无副作用草案」——"不得创建对象／预留标识／写缓存／写 Git ref"与"草案绑定变化须失效"未落。
6. `02` §15.2「暂停期间允许动作」——只有总纲必停条目的措辞，未逐条对应。

**B. 映射档的部分（101 条）——按成因**

1. **系统规范的"输入与前置条件"族**（`30` §7、`31` §7、`32` §7.1–7.3、`33` §6.1–6.3、`34` §7、`35` §7、`36` §7 一带，约 30 条）：载体以"进入条件／缺失处理"整体承接，未逐项列出输入面。**判断**：输入面多为项目事实清单（哪份文件、哪条记录），规范性内核（进入须有人的明确表态、缺失不得补全、冲突须停下）已由 `when-it-applies`、`no-inferred-intent`、`missing-input` 等条目承载，故属"未逐条落位"而非"无承载"。
2. **进入／退出契约的其余小项**（`30` §6、`31` §6、`34` §7／§9.2–9.3、`35` §8、`36` §8.5／§10 一带，约 30 条）。
3. **决定边界与恢复子节**（`22` §16.1、`23` §15.1、`24` §16.2／§17.2–17.3、`26` §16.1、`34` §15.2、`02` §14.2 等，约 20 条）：多为"决定不替代哪些判断""恢复须逐项对应"的重复表述，实质与各载体的 `no-overclaim`／`semantic-bound` 同义，未逐条对应。
4. **`02` 的其余几条**（§5.1、§5.3、§5.4、§6.1、§13、§16、§14.1、§15.1 等，约 12 条）：溯源细节与三概念区分只被部分条目承载。
5. **其余零散**（`24` §14／§15 的若干行、`33` §14 的边界小节等）。

**下一轮建议的落位顺序**：先处理 A 组 6 条（有明确行为缺口），再按 B 组 1 → 2 → 3 逐条扩写既有条目；相关载体多有字节余量（`experience-accumulation` 余 2041 B、`research` 余 4185 B、`spark-record` 余 6186 B），但 `friction-settlement` 只剩 526 B、`friction-fact-type` 只剩 463 B，那两份的落位须先腾位或改为扩写既有句。

## 七、校验器实跑（只读）

运行方式：`node` 直接 `import` `plugin/lib/runtime-carrier-validator.js`，调用 `validateRuntimeCarrierCorpus({carriers, developmentSpecs: []})`；**未修改校验器**。运行时刻该校验器可正常加载（另一代理若同时修改，本结论只对本次运行时点有效）。

- 语料 verdict：**pass**；`carrierCount: 19`、`errorCount: 0`、`hintCount: 0`、`gapCount: 0`、`routerCount: 0`。
- 甲类 1–8（结构类检查项）：**0 命中、0 误伤**——本次运行没有任何 findings，故没有可复核的命中或误伤样本。

| 载体 | 条目 | 字节 | 余量 |
|---|---|---|---|
| controlled-commit | 26 | 13943 | 6537 |
| experience-accumulation-system-foundation | 30 | 18439 | 2041 |
| fact-model-common | 30 | 17830 | 2650 |
| friction-fact-type | 30 | 20017 | **463** |
| friction-settlement-system-foundation | 30 | 19954 | **526** |
| gate-consult-system-foundation | 30 | 16893 | 3587 |
| goal-fact-type | 29 | 11872 | 8608 |
| goal-planning-system-foundation | 30 | 15355 | 5125 |
| ldvh-root | 29 | 17837 | 2643 |
| norm-fact-type | 25 | 14311 | 6169 |
| pitfall-fact-type | 30 | 15872 | 4608 |
| report-fact-type | 19 | 16201 | 4279 |
| research-system-foundation | 30 | 16295 | 4185 |
| rule-compliance-recall | 19 | 13925 | 6555 |
| rule-compliance-verification | 20 | 14901 | 5579 |
| service-contract | 27 | 9964 | 10516 |
| spark-fact-type | 30 | 17510 | 2970 |
| spark-record-system-foundation | 30 | 14294 | 6186 |
| subgoal-fact-type | 27 | 13688 | 6792 |

**放不下的载体**（30 条已满、余量不足以承载新条目的）：`friction-fact-type`（463 B）、`friction-settlement-system-foundation`（526 B）、其余 30 条载体虽已满但余量尚可（≥2.9 KB）。本轮在这两份里只做扩写、未新增条目；`friction-settlement` 的两处扩写已是其可容纳范围的上限（再写需先删既有要求，本轮不做）。

## 八、如实声明

- **读过的**：`specs/20` §5–§18 全文、`specs/21` §14–§18、`specs/22` §13–§18、`specs/23` §5–§17 全文、`specs/24` §14–§15、`specs/25` §14–§15、`specs/26` §14–§15、`specs/30` §14、`specs/31` §14、`specs/32` §16、`specs/33` §19、`specs/34` §14、`specs/35` §14、`specs/36` §14、`specs/02` §6.4–§7.3、§8–§10.4；载体侧：`fact-model-common`、`goal-fact-type`、`subgoal-fact-type`、`spark-fact-type`、`norm-fact-type`(部分)、`report-fact-type`、`friction-fact-type`、`friction-settlement-system-foundation`、`gate-consult-system-foundation`、`spark-record-system-foundation` 全文或近全文；其余 9 份载体只读了**条目 id + 标题 + 部分正文**。
- **没读过的**：`specs/01`、`04`、`05`、`06`、`07`、`08`、`10`、`11` 只读了 H2 标题与载体定位，**未逐节读正文**，故第五节的处置建议是**按职责与标题作出的判断，不是逐条核对结论**；`specs/20` §1–§4、`specs/21` §1–§13、`specs/22` §1–§12、`specs/24` §1–§13、`specs/25` §1–§13、`specs/26` §1–§13、`specs/30`–`36` 的 §1–§13 未逐节读，这些行的判定依据是**标题映射**（表中已标注）。
- **哪些是语义判断**：A/B/C 分类全部是语义判断（无机械判据）；"已承载"中，标"读节"的 110 行是我读过正文后判定，其余 627 行是按节标题与条目词面近邻映射，**属暂定，落地前须复核**；107 条"部分"里只有 6 条是读节判定的实质缺口，其余 101 条是"词面未对上、须复核"，两档已在说明列区分。
- **哪些未验证**：① 上一轮的 28 条部分缺口清单无法取回——本会话的 `session_search` 报"session history storage is unavailable"，故本轮的 107 条（其中读节确认 6 条）是**重新推导**的结果，与上一轮那 28 条不保证一一对应。② `plugin/lib/runtime-carrier-validator.js` 的甲类 1–8 具体判据未逐行读，只按运行结果报告 0 findings。③ 各载体条目与规范节"语义等价"未做独立复核（无第三方对照）。④ 未运行 `pnpm` 测试或 lint。⑤ `git status` 显示 18 份载体与 `plugin/`、`specs/11` 均有未提交改动；其中**只有 `fact-model-common` 与 `friction-settlement-system-foundation` 两份是本轮改的**（mtime 20:15／20:16），其余为本会话之前已存在的他人改动，本轮未触碰、也未提交。
- **本轮未做的**：未删改任何既有载体要求、未改既有 `id`、未改 `specs/`、未改 `plugin/`、未改 `ldvh-base/`、未提交。
