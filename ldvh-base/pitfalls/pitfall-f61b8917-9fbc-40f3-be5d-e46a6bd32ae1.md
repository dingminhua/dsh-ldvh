---
title: 动态 import 指向已删模块致派生静默为空
status: active
scope: 适用于以动态 import 装配读取分支的派生路径（serves 反查、聚合、跨类型枚举等）：当被 import 的模块已随类型或功能撤除而删除、而装配点仍保留该 import 时，运行期抛 ERR_MODULE_NOT_FOUND，若同一 try 的 catch 把该错误降级为 gap 或空集合，派生即静默失效——调用方看到的是「没有对象服务于它」，与「查不了」不可区分。经验可信复用的边界：它是装配期依赖完整性的核对项（删除后下游残留），不是派生逻辑本身的缺陷；不覆盖静态 import（加载期即报错，不会被 catch 吞掉）与目标文件存在但导出缺失的情形。
object_uid: f61b8917-9fbc-40f3-be5d-e46a6bd32ae1
fact_type_key: pitfall
created_at: 2026-11-13T15:10:56.874Z
change_log:
  - at: 2026-11-13T15:10:56.874Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累·审核段据缓冲条目 84370ae7-2233-4d76-9802-b540e4b0248f 形成候选（11 §10.2 第 3 项）
---

# 动态 import 指向已删模块致派生静默为空

## 症状

调用 `ldvh_subgoal_list` 查询子目标时，serves 派生返回空列表（serving-empty），看上去「没有对象服务于该子目标」，实际上派生根本没跑成：装配点 `subgoal-tools.js:207` 的动态 import 指向已随 WorkCase 类型撤除而删除的 `workcase-writer.js`，运行期抛 `ERR_MODULE_NOT_FOUND`，被同一 try 的 catch 降级成一条 gap，空结果与「查不了」在返回值上看起来同形。识别信号：结果里 `serves-lookup` 的 gap 与空 items 同时出现；或在代码里按 `import("./` 逐个核对目标文件是否存在。逐字引证：`subgoal-tools.js:207` 动态 import 的是已删除的 `workcase-writer.js`，运行时会 `ERR_MODULE_NOT_FOUND`
来源：本次材料 turn 5 assistant 消息（主控会话，2026-11-13 回合）；引述落点 plugin/lib/subgoal-tools.js:207 与 ldvh_subgoal_list 的 serves 派生路径

## 触发条件

三个条件同时成立时触发：①某个类型或功能被整体撤除，其 writer 模块文件随提交删除；②某个读取或派生装配点仍以动态 import 引用该模块（静态 import 在模块加载期即报错，反而不容易被 catch 吞掉）；③该装配点运行在 try/catch 内，且 catch 的处置是「降级为 gap 或返回空集合」而不是抛出。本实例：WorkCase 类型撤除后，`subgoal-tools.js:207` 的 `import("./workcase-writer.js")` 仍留在 serves 派生里，而该派生被 `ldvh_subgoal_list` 与 `ldvh_subgoal_read` 共用，于是两个工具同时静默失效。

## 根因

撤除类型时只删了写入器文件，没有同轮清理下游的动态 import 装配点——被引用的目标 `workcase-writer.js` 已不存在，引用它的代码仍在，是「删除唯一生产者后下游残留」的具体形态。更深一层是失败处置与派生语义的错配：`ERR_MODULE_NOT_FOUND` 属装配期错误，意味着整条派生没有成立，但 catch 把它降级成 gap 后，返回的 items 为空，而空列表在调用方被读成「没有对象服务于它」，不是「没查到」。第三层是观测面缺口：全仓没有一条测试走这条派生路径（`deriveServingObjects` 在测试里零命中），所以删除模块后构建、类型检查与全量测试全绿，缺陷只能靠人工读代码发现。

## 解决

已实际采用（提交 e4f3369f「fix(subgoal): 移除指向已撤除 WorkCase 写入器的动态 import」）：删除 `subgoal-tools.js:207` 处指向已删除 `workcase-writer.js` 的整段 WorkCase 分支（该分支的动态 import、list 调用与 truncated 探测一并删除），serves 派生只保留现行类型 Spark（`serves` 是 Spark 的现行字段，20 §12.3）；并在原处留下注释，写明该动态 import 曾抛 `ERR_MODULE_NOT_FOUND`、被 catch 吞成 gap、导致派生静默失效的来历，避免后来者照样式加回。同时补一条回归用例（`plugin/test/subgoal-writer.test.mjs`），钉两件事：①剥掉注释后的代码里不得残留指向已删除模块的动态 import；②每个动态 import 的目标文件必须可解析。成功信号：`plugin/test/subgoal-writer.test.mjs` 44 例全通过。

## 规避

删除任何类型或功能及其 writer 模块时，同轮按名扫描全仓的动态与静态 import 目标，逐个核对目标文件仍存在，不得只依赖 lint 与类型检查——动态 import 的字符串路径不在它们覆盖内（06 §6「删除唯一生产者须同轮清理下游」即此义务）。派生路径里的 catch 不得把「装配期错误」与「单类型查询失败」合并降级：模块不存在、模块加载失败应使整条派生显式失败，不得退化成空集合，也不得只留一条与成功结果同形的 gap。为这类装配点补用例时，钉「依赖目标存在」这一层（遍历源码里的动态 import 逐项核对目标文件），不要只钉当前输出值，否则撤除类型时仍是零检测。例外：动态 import 的目标文件与读取面同批撤除时，撤除提交必须包含读取面的删除，不得留下悬空引用交给下一轮。

## 验证

已观察：在当前 HEAD 实跑 `node --test plugin/test/subgoal-writer.test.mjs`，44 例全通过，新增用例「subgoal tools: serves 派生的动态 import 目标必须存在（防静默降级）」在列；`subgoal-tools.js` 中已无对 `workcase-writer.js` 的动态 import，`deriveServingObjects` 只 import `spark-writer.js`，目标文件存在且可解析；提交 e4f3369f 的消息记载变异检验——把该 import 加回去后新用例立即判红（1 例失败）。未覆盖（如实登记）：①变异检验由形成会话执行，本轮复核只复跑了用例，未重做一次「加回—判红—还原」；②只核了 serves 这一条派生路径，未穷举全仓其余动态 import 装配点；③未在宿主运行实例上复跑 `ldvh_subgoal_list`，故「调用方在工具输出里确实能看到那条 gap」只由代码路径与用例推出——按既有经验，plugin/lib 改动须重启宿主才进运行实例，端到端形态本轮未观察。

## 影响与适用范围

适用于以动态 import 装配读取分支的派生路径（serves 反查、聚合、跨类型枚举等）：当被 import 的模块已随类型或功能撤除而删除、而装配点仍保留该 import 时，运行期抛 ERR_MODULE_NOT_FOUND，若同一 try 的 catch 把该错误降级为 gap 或空集合，派生即静默失效——调用方看到的是「没有对象服务于它」，与「查不了」不可区分。经验可信复用的边界：它是装配期依赖完整性的核对项（删除后下游残留），不是派生逻辑本身的缺陷；不覆盖静态 import（加载期即报错，不会被 catch 吞掉）与目标文件存在但导出缺失的情形。

何时可能踩到：任何以动态 import 装配读取面、且把异常降级为 gap 或空集合的工具面与派生（serves 反查、聚合枚举、跨类型清单），尤其在一次类型撤除或功能下线之后。何时可信：先按代码核对动态 import 的目标文件是否存在、catch 是否区分装配期错误与单类型查询失败；这两条都成立时，本条可直接用于判断「空结果」到底是「没有」还是「没查到」。不适用于静态 import（加载期即失败，不会被吞）与目标文件存在但导出缺失的情形。

与既有对象的区分（23 §6.2）：`5d187171` 记的是读取已删字段得 undefined、症状是整次诊断调用失败；`b011ff88` 记的是相位闭集缺 complete 且错误被两层吞成成功；`86f03312` 记的是字段改名后读写两侧未同步；`a5b7b148` 记的是读取侧被删致字段只写不读。本条是动态 import 的目标模块被删、catch 把装配期错误降级成与空结果同形的 gap——根因在装配期依赖残留与降级语义的错配，不在读侧取键、闭集成员或字段名同步。
