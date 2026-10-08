---
fact_type_key: workcase
object_uid: 364df30e-ce3d-4cca-9463-c57a1fad399a
title: WorkCase 呈现保真与设计语言收敛
status: closed
gist: 修 WorkCase 呈现的字段类型守卫缺陷，统一前后端字段契约与派生分组配色，使详情阅读结构与已登记设计语言一致。
serves: SG-3
summary: |-
  ### 完善 WorkCase 各类呈现表现
  修服务端投影的字段类型守卫缺陷（Date/boolean/array 被字符串守卫拦下，致 closed 逐条核对退化为「未记录」、残留责任节点消失、Gate 1 批准时间与 attempt 心跳丢失），统一前后端字段契约，补齐派生分组的本地化与语义色，

  ### 详情阅读结构与设计语言对齐
  使详情阅读结构与既登记设计语言一致（去重复身份块、正文用详情层级、closed 不丢已存在字段），清 v4 残留并把 plugin/web/docs/10 §4.2 更新为 v5 语义，补运行时保真契约测试。
scope: 做什么：修 api/services/facts.ts 的 WorkCase 投影保真（satisfied/residual/gate_1.approved_at/attempt 时间戳按真实类型判定并保留）；统一 ObjectItem 与 WorkCaseResult/Gate1/Attempt 契约；修列表卡与收件箱的判据可读呈现；补派生分组五档的本地化与语义色；详情去重复身份块与裸 status、正文改详情层级、closed 保留已存在的 summary/serves/scope、消除 locale=""；删除零消费者 workcaseDetailProjection.ts 与 has_execution_section；model.ts 字段序改 21 号闭集；更新 plugin/web/docs/10 §4.2 为 v5 语义；补运行时保真契约测试与设计语言守卫；重建 dist；受控提交。明确不做什么：不改 21 号字段闭集/三态/Gate/派生分组判据；不改 plugin/lib writer/tools；不改后端 API 路由契约与事实源文件、不迁移 v4 存量对象；不改其余六类阅读布局与列表卡；不改 specs/ 下任何规范文本；不做 WC-A 全类型 YAML 与 WC-C SG 筛选的范围。
plan:
  - done_criteria: 每个缺陷给出复现方式与「期望/实际」对照，其中服务端投影缺陷以真实 ldvh-base/workcases 对象跑「读取层 + 投影层」得到无损字段清单，可机械复核
    step: 缺陷清单固化为机械可复现证据
  - done_criteria: 对全部 7 个真实 workcase 复跑，字段冻结数（投影后丢失的实际存在字段）为 0；closed 的 satisfied 为 boolean、residual 为 string[]
    step: 修服务端投影保真（satisfied/residual/gate_1.approved_at/attempt 时间戳）
  - done_criteria: ObjectItem 的 WorkCase 字段复用 WorkCaseResult/WorkCaseGate1/WorkCaseAttempt；仓库内无第二套同字段类型；tsc 0 错误
    step: 统一前后端契约与类型
  - done_criteria: closed 列表卡与收件箱的逐条核对显示与详情同款可读三态文本，源码内无拼装裸布尔的形态
    step: 修列表卡与收件箱的判据可读呈现
  - done_criteria: 五组在中英双语下经 getObjectStatusLocale 均返回本地化文本（无 raw snake_case）；docs/01 §1.10.2 的「Human 待确认紫系」对二 Gate 组成立
    step: 补派生分组本地化与语义色
  - done_criteria: 详情不再出现与 ObjectIdentityHeader 重复的身份块与裸 status:；正文段使用详情正文层级而非 ldvh-card-decision-body；closed 详情呈现对象已存在的 summary/serves/scope；无 locale=""
    step: 详情阅读结构对齐设计语言
  - done_criteria: 死文件与零消费字段已删、model.ts 字段序为 21 号闭集；docs/10 §4.2 与 specs/21 §8 逐项对照无 v4 词汇残留
    step: 清 v4 残留并更新 docs/10 §4.2
  - done_criteria: 新增测试对真实对象断言投影无损（可捕捉上述投影缺陷回退），并经变异验证可失败
    step: 补运行时保真测试与设计语言守卫
  - done_criteria: tsc 0 错误、web 测试全绿、eslint 无新增、dist 重建且 index.html 引用新 hash、Git Gate passed
    step: 验证三件套、dist 重建与受控提交
gate_1:
  approved_at: 2026-09-17T07:58:10.850Z
  approver: Human（本会话直接指令：选定「批准执行（推荐）」）
  authorization_fingerprint: 7ff749a6b5db95d6ec943e3a8bba876840ea745251a8fcbd1dd4204d8ea9a229
  scope_snapshot: 做什么：修 api/services/facts.ts 的 WorkCase 投影保真（satisfied/residual/gate_1.approved_at/attempt 时间戳按真实类型判定并保留）；统一 ObjectItem 与 WorkCaseResult/Gate1/Attempt 契约；修列表卡与收件箱的判据可读呈现；补派生分组五档的本地化与语义色；详情去重复身份块与裸 status、正文改详情层级、closed 保留已存在的 summary/serves/scope、消除 locale=""；删除零消费者 workcaseDetailProjection.ts 与 has_execution_section；model.ts 字段序改 21 号闭集；更新 plugin/web/docs/10 §4.2 为 v5 语义；补运行时保真契约测试与设计语言守卫；重建 dist；受控提交。明确不做什么：不改 21 号字段闭集/三态/Gate/派生分组判据；不改 plugin/lib writer/tools；不改后端 API 路由契约与事实源文件、不迁移 v4 存量对象；不改其余六类阅读布局与列表卡；不改 specs/ 下任何规范文本；不做 WC-A 全类型 YAML 与 WC-C SG 筛选的范围。
reviews:
  - at: 2026-09-22T14:50:15.593Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    implementer_session_id: session-6f1905a4-3761-44b4-b0fd-3a80b6589e31
    summary: 对象：提交 48d1264（WorkCase 呈现保真与设计语言收敛）。基线：HEAD 前版 6ac30ec 与 specs/21 §8/§9.3/§10.3/§10.4、specs/10 §5.5/§12、docs/01 §1.4 第4条/§1.8.1/§1.10.2。方法：隔离子代理通读全量 diff 与规范原文，做 5 次变异验证并跑 tsc/测试/eslint，逐字节 md5 还原核对。覆盖：三投影函数逐行类型判定与闭集（未放宽）、新增测试判别力（5/5 变异被捕获）、与六类样板的外壳/正文层级/身份头部/复制入口一致性、§12 第7第8条、v4 残留全仓含 dist 搜索。未覆盖：浏览器端真实渲染与视觉核验、Gate 1/2 写入路径与 CLI 侧契约、eslint 逐条同源比对。发现：无阻断、无重要，1 项提示——docs/archive/v4-web-migration-survey.md 仍列已删除文件名，但该目录自述不具规范效力且为 v4 源树冻结盘点，不构成悬挂引用。保证边界：证明投影不再静默丢弃合规字段且未放宽闭集、测试具运行时判别力、设计语言与样板一致；不证明浏览器视觉层与 Human 阅读可用性。
  - at: 2026-09-27T03:12:37.255Z
    provider: trae
    model: Doubao-Seed-2.1-Pro
    session_id: 159cbb4a-2465-4d2f-b403-3cc8fdd6dc90
    session_source: host
    implementer_session_id: session-6f1905a4-3761-44b4-b0fd-3a80b6589e31
    implementer_session_source: host
    summary: 对象：WorkCase 364df30e 的执行结果主张与提交 48d1264。基线：HEAD a7a5cfb（工作树含他人未提交改动，全程未触碰并前后比对确认）。方法：通读对象与 48d1264 全量 diff；9 条判据逐条对源码、文档与真实对象核验；独立复跑 tsc 与 web 全量测试（当前树与 48d1264 worktree 双基线）；2 次变异验证，逐次仅 git checkout -- 单文件还原。覆盖：9 条全部核到，判别力变异 2 项，残留 6 条逐条核验。未覆盖：浏览器真实渲染、部署链路、eslint 逐项复跑、他人未提交改动的正确性。发现：9 条主张 8 条属实；步骤 4 三态主张语义成立但判别力有缺口——变异（三态映射改坏）未被本单新增的两个测试捕获，仅被后建的 workcase-lifecycle.test.ts 捕获；当前 HEAD tsc 有 2 错（d7a19a1 引入，非本单）；当前工作树 web 测试 1 失败，根因是未提交的对象改动暴露 parseWorkCaseResultDraft 会把 advice 段后的顶层行吞为建议条目（解析器缺口，非 48d1264 产物：提交态 HEAD 全绿）。保证边界：证明交付真实、测试在提交时点全绿且投影守卫具判别力；不证明浏览器视觉层与阅读可用性。
result:
  achieved_scope: WorkCase 呈现链的服务端投影保真已修复（投影按 21 §8 真实类型判定，不再静默丢弃 satisfied/residual/gate_1 时间戳与 C2 钉扎基准、attempt 两时间戳；8 个真实对象字段冻结数 0）；前后端字段契约统一为一份；判据三态呈现统一为可读文本（详情/列表卡/收件箱共用单一映射）；派生分组五档补齐本地化与语义色；详情阅读结构与六类样板对齐（去重复身份块、正文用详情层级、字段在场性与分组无关）；v4 残留清除；plugin/web/docs/10 §4.2 更新为 v5 语义；新增 12 项测试守卫（运行时保真 6 项 + 设计语言 6 项），投影类守卫经变异验证具备判别力，呈现映射类守卫的行为判别力由后续工单 workcase-lifecycle.test.ts 补齐。
  criteria_checks:
    - evidence: 「## 执行」第 3 条：以真实对象跑 readLocalFact → projectCurrentWorkCaseCard 复现全部缺陷并给出修前/修后字段冻结清单；机械可复核方式为对 ldvh-base/workcases/ 全量对象比对字段存在性，修前冻结清单非空、修后为空。
      satisfied: true
    - evidence: 实测 8 个真实对象字段冻结数 0；satisfied 为布尔且逐字保留（[true×5] 不再退化为 [null×5]）；residual 为数组且空数组形态保留；gate_1 四字段完备 7/7。2026-09-27 双基线复核在 48d1264 提交态独立复跑确认。
      satisfied: true
    - evidence: src/utils/api.ts L76–79 的 ObjectItem 已复用 WorkCaseResult/WorkCaseGate1/WorkCaseAttempt；四个 interface 全仓各仅一份定义；48d1264 提交态 tsc 退出 0（2026-09-27 复核在 worktree 复跑确认）。
      satisfied: true
    - evidence: 新增 src/utils/workcaseCheckState.ts 为三态映射唯一实现，详情、列表卡（经 WorkCaseClosedSummary）、收件箱（经 WorkCaseCriteriaList/WorkCaseResultDraft）均消费它，源码内无裸布尔插值残留。语义成立；呈现映射判别力缺口见步骤 8 与 residual。
      satisfied: true
    - evidence: 实测五组在 zh/en 下经 getObjectStatusLocale 均返回本地化文本、无 raw snake_case；48d1264 时两 Gate 组同为紫系（当日判据成立）。d979846（WC-52314cf8）后 pending_gate1 改琥珀、awaiting_gate2 保留紫——后续有意超越，见 residual。
      satisfied: true
    - evidence: 四项均已落实并由 workcase-design-language-contract.test.ts 守卫，其中「身份块不重复」与「四主体共有字段」两项经变异验证可失败。
      satisfied: true
    - evidence: shared/workcaseDetailProjection.ts（105 行，零消费者）与 has_execution_section 及其专用 helper 已删；model.ts 字段序为 21 §8 闭集；docs/10 §4.2 改写为 v5 语义；复核确认无悬挂引用（docs/archive/ 陈旧列举属非规范效力归档）。
      satisfied: true
    - evidence: 新增 workcase-projection-fidelity.test.ts 6 项跑真实管道；本单 4 次 + 2026-09-17 复核 5 次投影类变异全部被捕获，2026-09-27 复核 satisfied 守卫回退变异触发 fidelity 5 项失败。判据字面（投影无损测试可失败）成立；呈现映射类变异（三态映射改恒 unknown）在交付时点未被本单两个测试捕获、仅后续 workcase-lifecycle.test.ts 捕获，缺口转 residual。
      satisfied: true
    - evidence: 48d1264 提交态经 2026-09-27 双基线复核独立复跑：tsc 退出 0、web 测试 262/262；eslint 39 problems 与当时基线逐项一致零新增；dist 重建为 index-CksUN7yQ.js 且 index.html 已引用；提交 48d1264 输出 LDVH Git Gate (commit-msg) passed。提交后 HEAD 的 tsc 2 错（d7a19a1）与工作树 fidelity L547 失败（63700bd2 暴露 parseWorkCaseResultDraft 缺口）非本单产物，见 residual。
      satisfied: true
  residual:
    - 浏览器端真实渲染未核验：证据止于编译、构建产物与契约测试，未做各派生分组详情页的运行期目视核对（视觉层与 Human 阅读可用性未覆盖）。
    - 同型缺陷未普查其余六类：六类阅读布局（ADR/Pitfall/Spark/Research/Friction/Norm）是否存在同类按错误类型判定致字段静默丢弃未在本单普查（scope 明确排除改动它们）。
    - docs/archive/v4-web-migration-survey.md 仍列举已删除的 workcaseDetailProjection.ts：经复核确认为非悬挂引用（该目录自述不具规范效力，且文档系对 v4 源树的冻结盘点，非当前仓库索引）。
    - statusColors.ts 的 executing 键安全性依赖事实而非类型系统：依据是当前仓库无对象以字面 executing 为 status 值，而非类型保证；将来若有类型引入该字面状态，颜色语义会被静默共用。
    - dist 仅本机机械验证：dist/ 为 .gitignore 产物不入库，仅确认 index.html 引用新 hash 且文件存在，未覆盖部署链路。
    - model.ts 的 FIELD_ORDER_BY_TYPE.workcase 实为死代码：WorkCase 详情走专属布局且 FactReadingContent 在通用兜底分支前 return，故该顺序永不被消费；改动价值在清除 v4 词汇，注释已如实标注。
    - 步骤 8 呈现映射类变异在交付时点未被新增测试捕获（2026-09-27 双基线独立复核发现）：把 workcaseCheckState.ts 三态映射改恒 unknown 的变异未被本单新增的两个测试捕获（design-language 相关守卫为结构性断言），仅被后续工单建立的 workcase-lifecycle.test.ts 行为断言捕获。判据文本只要求投影无损测试可失败（成立）；呈现映射判别力缺口已由后续测试补齐。
    - 当前 HEAD tsc 2 错与当前工作树 1 项 web 测试失败均非本单产物（2026-09-27 双基线复核确认）：api/app.ts(134,7) TS2339 由 d7a19a1（2026-09-25）引入，48d1264 提交态 tsc 退出 0、web 262/262、HEAD 提交态 367/367 全绿；当前工作树 fidelity L547 失败由另一会话未提交的 workcase-63700bd2 正文改动暴露 parseWorkCaseResultDraft 段退出条件缺口（advice 段后的顶层 bullet 被吞为建议条目），建议另立修复。
outcome: completed
created_at: 2026-09-17T07:36:31.587Z
change_log:
  - at: 2026-09-17T07:36:31.587Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-09-17T07:58:10.850Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 1 批准——Human 确认执行 WorkCase 呈现保真与设计语言收敛；授权绑定当次 plan+scope 指纹 [gate_1 approved by Human（本会话直接指令：选定「批准执行（推荐）」）; attempt 1 allocated to deepseek-v4.1-flash@dsh-ldvh-session]
  - at: 2026-09-17T08:35:09.232Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 步骤 1–8 完成、提交 48d1264（20 files, +812/−309）；独立复核已发起 [attempt 1 heartbeat refreshed]
  - at: 2026-09-17T08:39:27.611Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补录独立复核概要至 reviews 与执行节（判定：有条件通过，无阻断） [attempt 1 heartbeat refreshed]
  - at: 2026-09-17T08:40:28.013Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 写入 Gate 2 提请（逐条判据核对 + 已证实范围 + 残留责任） [attempt 1 heartbeat refreshed]
  - at: 2026-09-18T11:21:15.354Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 迁移：补齐 gist 要点字段（21 §8，WorkCase d5273e1c） [attempt 1 heartbeat refreshed]
  - at: 2026-09-22T14:50:15.593Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "格式治理：摘要分块（忠实重排）——把作者自撰的行内「：」提为 ### 块首并插入空行，使摘要可读且符合 21 §8 书写结构（H3 骨架）；作者原文逐字未改，仅新增标记与空行 [attempt 1 heartbeat refreshed]"
  - at: 2026-09-23T19:05:35.678Z
    provider: deepseek-official
    model: deepseek-flash
    summary: 结果节新增 `- advice:` 建议段，并按 21 §8 把原先写在 residual 条目内的「建议…」子句移入该段（建议只有一处正文承载） [attempt 1 heartbeat refreshed]
  - at: 2026-09-24T02:48:24.800Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 格式治理：建议去向词按 21 §8 新闭集四词归一（更正/改进/补录 → 直接行动），措辞与语义未变 [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T02:45:56.349Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: 存量补齐 attempt 会话身份基线（关闭侧独立性比对基准），并在执行节登记本次关闭准备与其暴露的写路径缺陷（本单之外处置） [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T03:12:37.256Z
    provider: trae
    model: Doubao-Seed-2.1-Pro
    summary: "复核：记录独立复核结论（隔离子代理，双基线复核——9 条主张 8 条属实；步骤 8 呈现映射类判别力缺口如实登记，提交态 HEAD 测试全绿） [review recorded by session 159cbb4a-2465-4d2f-b403-3cc8fdd6dc90; reviews entries: 2; 记录自子代理会话 159cbb4a-2465-4d2f-b403-3cc8fdd6dc90 的最终产出（Code 捕获）]"
  - at: 2026-09-27T03:16:58.279Z
    provider: trae
    model: Doubao-Seed-2.1-Pro
    summary: Gate 2 关闭（outcome=completed）：9 条判据全达成；2026-09-27 双基线独立复核确认 8 条属实、步骤 8 呈现映射判别力缺口转 residual；attempt 1 收口 [gate_2 closed with outcome=completed; attempt 1 retracted]
  - at: 2026-10-01T18:59:37.395Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 事实更正（非状态转换）——丙方案推进：存量迁移（分离式→合并式）——正文「## 结果」节把独立 `- advice:` 段并入各残留之下的去向子项，8 条残留全落「接受现状」并各写自足理由；3 条退役词去向全部转换：2 条「另立工单」的未普查面／解析器缺口已另行立为 Spark（8d5437b7／4a21bfda，二者 refs 均已声明承自本单，本卡引用区呈现），1 条「直接行动」（docs 归档更正）经复核属非悬挂引用、保持原样；含退役词的内联声明一并改写为接受现状并写明原意向。终态判定未变：status/outcome/result/gate_1/attempt/plan/scope/reviews 逐字继承落盘对象（本入口不接收 frontmatter，故改动在结构上不可能），仅正文重写。依 21 §9.2「若原终态记录本身错误，按事实更正规则修正，不把更正伪装成领域状态转换」与 03 §9.5，经 Human 授权：Human 2026-10-01 授权（原话「丙 方案你改一个我看看效果」→「可以，就这么推进」→「dsh-ldvh@workcase-364df30e 这个还有 另立工单，直接行动，都要转换」→「确认」）：按丙方案迁移本单去向——有价值事项已立 Spark 并由其 refs 反引本单；退役词去向全部转换（另立工单→接受现状＋引用行，直接行动→接受现状）；经 correct 通道只改正文，status/outcome/result/reviews 逐字不变。
  - at: 2026-10-08T20:45:46.123Z
    provider: glm
    model: glm-5.3
    summary: 事实更正（非状态转换）——批次 F+ 旧号位更正（终态事实更正）：执行节步骤 2「09 §6 单一实现」更正为「06 §6 单一实现」（契约实现纪律经 02–10 重构由 09 号迁至 06 号），并在执行节首加号位注记；摘要/授权范围/计划/结果为冻结镜像区照录不改（「plugin/web/docs/10 §4.2」指 plugin/web/docs/ 设计文档而非 specs 号位）；终态判定与 result/reviews 逐字不变。终态判定未变：status/outcome/result/gate_1/attempt/plan/scope/reviews 逐字继承落盘对象（本入口不接收 frontmatter，故改动在结构上不可能），仅正文重写。依 21 §9.2「若原终态记录本身错误，按事实更正规则修正，不把更正伪装成领域状态转换」与 03 §9.5，经 Human 授权：Human 于本会话（2026-10-14）批准批次 F+——在 ask_user_question「批次 F 收口去向」中选择「追加批次 F+（推荐）」：逐份分类残留对象并对确需处置者做受控更正；本条为终态事实更正（21 §9.2），不触碰终态判定与 result/reviews
  - at: 2026-10-08T20:58:18.721Z
    provider: glm
    model: glm-5.3
    summary: 事实更正（非状态转换）——勘误上一条写入的一处誊录错误：结果节残留「步骤 8 呈现映射类变异」条目的「改恒 `unknown`」恢复为原记录的反引号形态（前次写入误丢反引号）；其余内容与上次写入逐字一致，号位注记不变。终态判定未变：status/outcome/result/gate_1/attempt/plan/scope/reviews 逐字继承落盘对象（本入口不接收 frontmatter，故改动在结构上不可能），仅正文重写。依 21 §9.2「若原终态记录本身错误，按事实更正规则修正，不把更正伪装成领域状态转换」与 03 §9.5，经 Human 授权：Human 于本会话（2026-10-14）批准批次 F+——在 ask_user_question「批次 F 收口去向」中选择「追加批次 F+（推荐）」：逐份分类残留对象并对确需处置者做受控更正；本条为对前条事实更正的誊录勘误（21 §9.2），不触碰终态判定与 result/reviews
---

# WorkCase 呈现保真与设计语言收敛

## 摘要

### 完善 WorkCase 各类呈现表现
修服务端投影的字段类型守卫缺陷（Date/boolean/array 被字符串守卫拦下，致 closed 逐条核对退化为「未记录」、残留责任节点消失、Gate 1 批准时间与 attempt 心跳丢失），统一前后端字段契约，补齐派生分组的本地化与语义色，

### 详情阅读结构与设计语言对齐
使详情阅读结构与既登记设计语言一致（去重复身份块、正文用详情层级、closed 不丢已存在字段），清 v4 残留并把 plugin/web/docs/10 §4.2 更新为 v5 语义，补运行时保真契约测试。

**关键定位**：WC-D（99957f65）已修 `api.ts` 的前端类型声明，但**未触及服务端投影**——`git show --name-only ba8d71a` 确认未改 `facts.ts`。故服务端投影的字段丢弃是该单的残留缺口，本单承接。

## 授权范围

做什么：修 api/services/facts.ts 的 WorkCase 投影保真（satisfied/residual/gate_1.approved_at/attempt 时间戳按真实类型判定并保留）；统一 ObjectItem 与 WorkCaseResult/Gate1/Attempt 契约；修列表卡与收件箱的判据可读呈现；补派生分组五档的本地化与语义色；详情去重复身份块与裸 status、正文改详情层级、closed 保留已存在的 summary/serves/scope、消除 locale=""；删除零消费者 workcaseDetailProjection.ts 与 has_execution_section；model.ts 字段序改 21 号闭集；更新 plugin/web/docs/10 §4.2 为 v5 语义；补运行时保真契约测试与设计语言守卫；重建 dist；受控提交。明确不做什么：不改 21 号字段闭集/三态/Gate/派生分组判据；不改 plugin/lib writer/tools；不改后端 API 路由契约与事实源文件、不迁移 v4 存量对象；不改其余六类阅读布局与列表卡；不改 specs/ 下任何规范文本；不做 WC-A 全类型 YAML 与 WC-C SG 筛选的范围。

## 计划

- 缺陷清单固化为机械可复现证据：判据——每个缺陷给出复现方式与「期望/实际」对照，其中服务端投影缺陷以真实 ldvh-base/workcases 对象跑「读取层 + 投影层」得到无损字段清单，可机械复核
- 修服务端投影保真（satisfied/residual/gate_1.approved_at/attempt 时间戳）：判据——对全部 7 个真实 workcase 复跑，字段冻结数（投影后丢失的实际存在字段）为 0；closed 的 satisfied 为 boolean、residual 为 string[]
- 统一前后端契约与类型：判据——ObjectItem 的 WorkCase 字段复用 WorkCaseResult/WorkCaseGate1/WorkCaseAttempt；仓库内无第二套同字段类型；tsc 0 错误
- 修列表卡与收件箱的判据可读呈现：判据——closed 列表卡与收件箱的逐条核对显示与详情同款可读三态文本，源码内无拼装裸布尔的形态
- 补派生分组本地化与语义色：判据——五组在中英双语下经 getObjectStatusLocale 均返回本地化文本（无 raw snake_case）；docs/01 §1.10.2 的「Human 待确认紫系」对二 Gate 组成立
- 详情阅读结构对齐设计语言：判据——详情不再出现与 ObjectIdentityHeader 重复的身份块与裸 status:；正文段使用详情正文层级而非 ldvh-card-decision-body；closed 详情呈现对象已存在的 summary/serves/scope；无 locale=""
- 清 v4 残留并更新 docs/10 §4.2：判据——死文件与零消费字段已删、model.ts 字段序为 21 号闭集；docs/10 §4.2 与 specs/21 §8 逐项对照无 v4 词汇残留
- 补运行时保真测试与设计语言守卫：判据——新增测试对真实对象断言投影无损（可捕捉上述投影缺陷回退），并经变异验证可失败
- 验证三件套、dist 重建与受控提交：判据——tsc 0 错误、web 测试全绿、eslint 无新增、dist 重建且 index.html 引用新 hash、Git Gate passed

## 执行

**号位注记（2026-10-14，批次 F+ 事实更正）**：步骤 2 中「09 §6 单一实现」已更正为「06 §6 单一实现」——该契约实现纪律条款经 02–10 重构由 09 号迁至 06 号（原 09 号文件名「Code实践与测试规范」现即 specs/06）。摘要/授权范围/计划/结果各节为冻结镜像，其中「plugin/web/docs/10 §4.2」指 plugin/web/docs/ 下的设计文档（非 specs 规范号位），沿用不改。

- attempt 1 started at 2026-09-17T07:58:10.850Z (controller: deepseek-v4.1-flash@dsh-ldvh-session)；Gate 1 授权范围见 gate_1.scope_snapshot。
- 步骤 1–8 完成，受控提交 48d1264（20 files changed, +812/−309）。
- 步骤 1 现状核实：以真实 ldvh-base/workcases 对象跑「读取层 readLocalFact → 投影层 projectCurrentWorkCaseCard → showObject 装配顺序」复现全部缺陷。根因是投影守卫按错误类型判定——js-yaml 把未加引号的 ISO 时间戳解析为 `Date`、把 `satisfied` 解析为布尔、`residual` 为数组，而守卫写的是 `typeof === 'string'`，故恒不命中并静默丢弃。修前实测：closed 对象 `satisfied` 由 `[true×5]` 退化为 `[null×5]`、`residual` 由 `[]` 变 `undefined`、`gate_1.approved_at` 与 attempt 两时间戳丢失。
- 步骤 2 完成：`projectWorkCaseResult`/`projectWorkCaseGate1`/`projectWorkCaseAttempt` 改按字段真实类型判定；新增 `shared/timestamp.ts` 的 `toRfc3339Text` 作为时间归一唯一实现（`factChangeLog.toChangeLogAtText` 改为复用它，06 §6 单一实现）。复跑全部真实对象，字段冻结数 0。
- 步骤 2 附加发现（测试暴露、已一并修复）：`gate_1` 原先只在 closed 分支重建、且只含 approved_at/approver，重建会覆盖来源，致 closed 详情的 `authorization_fingerprint` 与 `scope_snapshot`（C2 授权钉扎的两个比对基准，21 §10.3）被丢弃；同时 open 走原值透传、closed 走重建，同一字段出现两种运行期形态。已提为与状态无关的统一投影。
- 步骤 3 完成：`ObjectItem` 的 WorkCase 字段复用 `WorkCaseResult`/`WorkCaseGate1`/`WorkCaseAttempt`，删除列表侧内联的第二套形状（`satisfied?: string` vs `boolean`）。
- 步骤 4 完成：新增 `src/utils/workcaseCheckState.ts` 承载判据三态（已满足/未满足/未记录）映射，详情、列表卡与收件箱共用；两处裸布尔插值改为经共享映射取可读词条。
- 步骤 5 完成：派生分组补齐类型专属展示词条（中英）与语义色（Human 待确认紫系、推进中天蓝，依 docs/01 §1.10.2）；筛选器改由同一张表派生，删除 UI_LOCALES 中平行的 `objectList.workcaseGroup.*` 重复词条（10 条）。
- 步骤 6 完成：详情去除与 `ObjectIdentityHeader` 重复的身份块与裸 `status:`、正文改用详情阅读层级（`ResearchTextNodeContent`，依 docs/01 §1.4 第 4 条）、四个派生主体共用 `ResponsibilityNodes` 以免 closed 丢弃已存在的 summary/serves/scope、消除 `locale=""`。
- 步骤 7 完成：删除零消费者 `shared/workcaseDetailProjection.ts` 与零消费的 `has_execution_section`（连同其专用 helper）、`model.ts` 的 WorkCase 字段序改为 21 §8 闭集；`plugin/web/docs/10` §4.2 由 v4 语义改写为 v5（三态直读、派生分组与五档、判据三态、字段在场性与分组无关）。
- 步骤 8 完成：新增 `workcase-projection-fidelity.test.ts`（6 项）——不查源码文本，而跑真实管道对全量真实对象断言「实际存在的字段在投影后不消失」；四类缺陷逐条注入后各被捕获（D1 3 项失败、D2 3 项、D3 2 项、D4 2 项）。`workcase-design-language-contract.test.ts` 新增 6 项守卫，其中「身份块不重复」与「四主体共有字段」两项经变异验证可失败。
- 2026-09-17 执行期外部事件（如实登记，非本单产物）：另一会话在本次执行期间提交 6ac30ec（C2 授权校验与 rebatch 的 Code 托管字段，触及 specs/21 与 plugin/lib/writer），与本单范围不重叠；本单在合并后的 HEAD 上复跑三件套仍全绿。
- 2026-09-17 独立复核完成（隔离子代理，判定「有条件通过」）：复核者独立做 5 次变异验证（satisfied 改回 string、删 started_at、整删 residual、gate_1 退回 closed-only、删 authorization_fingerprint/scope_snapshot），全部被新增测试捕获；并核实投影未放宽闭集、与六类样板同形、v4 残留无悬挂引用。唯一提示项为 `docs/archive/v4-web-migration-survey.md` 仍列已删除文件名——该目录自述不具规范效力且系 v4 源树的冻结盘点，非当前仓库索引，不影响本单成立（转残留责任跟踪）。
- 2026-09-27 关闭准备（后续会话）：本单 2026-09-17 建立的 attempt 与 2026-09-22 记录的复核条目均不带会话身份，关闭侧独立性比对（21 §14 前置条件二）无基准可建。经心跳按存量补齐路径写入 `attempt.session_id` / `session_source`——该值即**当次心跳会话**的身份，机械上成为本次比对所记录的实施者基线；原复核条目身份不可事后追溯（规范明文「未知不等于独立」），故关闭前另记一条带身份的独立复核。
- 2026-09-27 关闭准备暴露的写路径缺陷（如实登记，本单之外处置）：准备过程中实测 `plugin/lib/workcase-writer.js` 两处缺陷——①`executeWorkcaseObject` 以调用方 payload 的 `reviews` 覆盖落盘值，漏传即静默丢弃既有复核流水；②`stampReviewEntries` 对身份缺席的既有条目取 `storedSessionId ?? 当前写入者身份`，会盖上假的记录者身份。二者均超出本单授权范围（scope 明列「不改 plugin/lib writer/tools」），经 Human 裁定「直接执行」在本单之外修复，并加三条回归测试（`plugin/test/workcase-writer.test.mjs`，逐条变异验证具判别力）；宿主重载后本次心跳即跑在修复后的写器上，历史条目逐字保留。
- 2026-09-27 独立复核完成（隔离子代理，双基线复核）：复核者通读对象与 48d1264 全量 diff，在 48d1264 提交态（临时 worktree）与当前 HEAD 双基线上复跑——48d1264 时 tsc 退出 0、web 262/262 全绿；HEAD 提交态 367/367 全绿。判定：9 条主张 8 条属实；步骤 8 判据文本只要求「投影无损测试可失败」（成立，satisfied 守卫改回 string 的变异触发 fidelity 5 项失败），但把 `workcaseCheckState.ts` 三态映射改恒 unknown 的变异未被本单新增的两个测试捕获，仅被后续工单建立的 `workcase-lifecycle.test.ts` 捕获——呈现映射判别力缺口如实转 residual（当前已由后续测试补齐）。当前 HEAD tsc 2 错（d7a19a1 引入）与当前工作树 fidelity L547 失败（另一会话未提交的 workcase-63700bd2 正文改动暴露 `parseWorkCaseResultDraft` 段退出条件缺口）均非本单产物，转 residual 与 advice。

## 结果

- criteria_checks:
  - 步骤 1 判据「每个缺陷给出复现方式与「期望/实际」对照，其中服务端投影缺陷以真实对象跑「读取层 + 投影层」得到无损字段清单，可机械复核」：**达成**。依据见「## 执行」第 3 条；机械可复核方式为对 `ldvh-base/workcases/` 全量对象跑 `readLocalFact → projectCurrentWorkCaseCard` 并比对字段存在性，修前冻结清单非空、修后为空。
  - 步骤 2 判据「对全部真实 workcase 复跑，字段冻结数为 0；closed 的 satisfied 为 boolean、residual 为 string[]」：**达成**。实测 8 个真实对象（含本单自身）字段冻结数 0；`satisfied` 为布尔且逐字保留（`[true,true,true,true,true]` 不再退化为 `[null×5]`）；`residual` 为数组且空数组形态保留（`[]` 与「缺失」可区分）；`gate_1` 四字段完备 7/7。2026-09-27 双基线复核在 48d1264 提交态独立复跑确认。
  - 步骤 3 判据「ObjectItem 的 WorkCase 字段复用 WorkCaseResult/WorkCaseGate1/WorkCaseAttempt；仓库内无第二套同字段类型；tsc 0 错误」：**达成**。`src/utils/api.ts` L76–79 的 `ObjectItem` 已改为复用；四个 interface 全仓各仅一份定义；48d1264 提交态 tsc 退出 0（2026-09-27 复核在 worktree 复跑确认）。
  - 步骤 4 判据「closed 列表卡与收件箱的逐条核对显示与详情同款可读三态文本，源码内无拼装裸布尔的形态」：**达成（语义成立；判别力缺口见步骤 8 补充与 residual）**。新增 `src/utils/workcaseCheckState.ts` 为三态映射唯一实现，详情、列表卡（经 WorkCaseClosedSummary）、收件箱（经 WorkCaseCriteriaList/WorkCaseResultDraft）均消费它，源码内无裸布尔插值残留。
  - 步骤 5 判据「五组在中英双语下经 getObjectStatusLocale 均返回本地化文本；docs/01 §1.10.2 的 Human 待确认紫系对二 Gate 组成立」：**达成（当日成立；配色后被后续工单有意超越，见 residual 与执行节）**。实测五组在 zh/en 下均返回本地化文本，无 raw snake_case；48d1264 时两 Gate 组同为紫系。d979846（WC-52314cf8，Human 指令「两个 Gate 待办组显著不同色」）后 `pending_gate1` 改琥珀、`awaiting_gate2` 保留紫。
  - 步骤 6 判据「详情不再出现重复身份块与裸 status:；正文用详情正文层级；closed 呈现已存在的 summary/serves/scope；无 locale=""」：**达成**。四项均已落实并由契约测试守卫（「身份块不重复」与「四主体共有字段」两项经变异验证可失败）。
  - 步骤 7 判据「死文件与零消费字段已删、model.ts 字段序为 21 号闭集；docs/10 §4.2 与 specs/21 §8 对照无 v4 词汇残留」：**达成**。`shared/workcaseDetailProjection.ts`（105 行，零消费者）已删除；`has_execution_section` 与其专用 helper 已删；`docs/10 §4.2` 改写为 v5 语义。复核确认无悬挂引用（`docs/archive/` 中的陈旧列举属非规范效力归档，已转残留跟踪）。
  - 步骤 8 判据「新增测试对真实对象断言投影无损（可捕捉上述投影缺陷回退），并经变异验证可失败」：**达成（判据字面成立；呈现映射判别力缺口如实补充）**。新增 `workcase-projection-fidelity.test.ts` 6 项，跑真实管道而非源码文本；本单自测 4 次变异 + 2026-09-17 独立复核者 5 次变异（均为投影类：satisfied 改回 string、删 started_at、整删 residual、gate_1 退回 closed-only、删 authorization_fingerprint/scope_snapshot）全部被捕获；2026-09-27 双基线复核另做 satisfied 守卫回退变异，fidelity 5 项失败被捕获。**补充（2026-09-27 复核）**：把 `workcaseCheckState.ts` 三态映射改恒 unknown 的**呈现映射类**变异未被本单新增的两个测试捕获（design-language 相关守卫为结构性断言），仅被后续工单建立的 `workcase-lifecycle.test.ts` 捕获——判据文本只要求投影无损测试可失败（成立），该呈现映射缺口转 residual。
  - 步骤 9 判据「tsc 0 错误、web 测试全绿、eslint 无新增、dist 重建且 index.html 引用新 hash、Git Gate passed」：**达成（提交时点）**。48d1264 提交态经 2026-09-27 双基线复核独立复跑：tsc 退出 0、web 测试 262/262；eslint 39 problems（16 errors / 23 warnings）与当时 HEAD 基线逐项一致、零新增；dist 重建为 `index-CksUN7yQ.js` 且 `index.html` 已引用；提交 48d1264 输出 `LDVH Git Gate (commit-msg) passed` 与 snapshot_identity。提交时点之后的 HEAD 变化（tsc 2 错、工作树 1 项失败）非本单产物，见 residual。

- achieved_scope: WorkCase 呈现链的服务端投影保真已修复（投影按 21 §8 真实类型判定，不再静默丢弃 satisfied/residual/gate_1 时间戳与 C2 钉扎基准、attempt 两时间戳；8 个真实对象字段冻结数 0）；前后端字段契约统一为一份；判据三态呈现统一为可读文本（详情/列表卡/收件箱共用单一映射）；派生分组五档补齐本地化与语义色；详情阅读结构与六类样板对齐（去重复身份块、正文用详情层级、字段在场性与分组无关）；v4 残留清除；`plugin/web/docs/10 §4.2` 更新为 v5 语义；新增 12 项测试守卫（运行时保真 6 项 + 设计语言 6 项），其中投影类守卫经变异验证具备判别力（呈现映射类守卫的行为判别力由后续工单 `workcase-lifecycle.test.ts` 补齐）。

- residual:
  - **浏览器端真实渲染未核验**：本次证据止于编译、构建产物与契约测试，未做各派生分组详情页的运行期目视核对（视觉层与 Human 阅读可用性未覆盖）。
    - **接受现状**：本单证据止于编译与契约测试，运行期目视核对不在本单授权范围；该边界已如实登记，就此了结。
  - **同型缺陷未普查其余六类**：本次只修 WorkCase 呈现链。六类阅读布局（ADR/Pitfall/Spark/Research/Friction/Norm）是否存在同类「按错误类型判定致字段静默丢弃」未在本单普查（本单授权范围明确排除改动它们）。
    - **接受现状**：原拟另立工单；该未普查面已另行立为 Spark（议题「六类阅读布局同型守卫未扩面」，其 `refs` 已声明承自本单，见本卡引用区的关联行），本单不再跟踪。
  - **`docs/archive/v4-web-migration-survey.md` 仍列举已删除的 `workcaseDetailProjection.ts`**：经复核确认为非悬挂引用（该目录自述不具规范效力，且文档系对 v4 源树的冻结盘点，非当前仓库索引）。
    - **接受现状**：原拟在后续 docs 清理批次顺手更正；经复核该目录自述不具规范效力、文档系 v4 源树的冻结盘点，更正它会破坏其「冻结盘点」的性质，故保持原样、就此了结。
  - **`statusColors.ts` 的 `executing` 键安全性依赖事实而非类型系统**：复核指出该键改色安全的依据是「当前仓库无对象以字面 `executing` 为 status 值」，而非类型保证；若将来有类型引入该字面状态，颜色语义会被静默共用。已如实登记，本次不扩围处置。
    - **接受现状**：该键的成立依据已如实登记为「事实而非类型保证」，本次不扩围；若将来真有类型引入该字面状态，届时按新证据另议，本单就此了结。
  - **dist 仅本机机械验证**：`dist/` 为 `.gitignore` 产物不入库，仅确认 `index.html` 引用新 hash 且文件存在，未覆盖部署链路。
    - **接受现状**：dist 的部署链路不在本单验证范围，本机机械验证已足；证据边界已如实登记，就此了结。
  - **`model.ts` 的 `FIELD_ORDER_BY_TYPE.workcase` 实为死代码**：复核独立追证确认 WorkCase 详情走专属布局且 `FactReadingContent` 在通用兜底分支前 return，故该顺序永不被消费。本次改动的价值在于清除 v4 词汇（防误导后续维护者），其注释已如实标注这一点。
    - **接受现状**：该顺序确为死代码、本次改动的价值（清 v4 词汇）已达成并如实标注；死代码本身是否删除不属本单范围，就此了结。
  - **步骤 8 呈现映射类变异在交付时点未被新增测试捕获（2026-09-27 双基线独立复核发现）**：把 `workcaseCheckState.ts` 三态映射改恒 `unknown` 的变异未被本单新增的两个测试捕获（`workcase-design-language-contract.test.ts` 的相关守卫为结构性断言，只断言「组件引用共享导出」「不自造词条」；fidelity 不经组件映射），仅被后续工单建立的 `workcase-lifecycle.test.ts` 的行为断言捕获。判据文本只要求投影无损测试可失败（成立）；呈现映射判别力缺口如实登记，当前已由后续测试补齐。
    - **接受现状**：该判别力缺口已由后续工单建立的行为断言补齐（`workcase-lifecycle.test.ts` 捕获该变异），本单无须再处置，就此了结。
  - **当前 HEAD tsc 2 错与当前工作树 1 项 web 测试失败均非本单产物（2026-09-27 双基线复核确认）**：`api/app.ts(134,7) TS2339 'handle' does not exist on type 'Application'` 由 d7a19a1（2026-09-25）引入；48d1264 提交态 tsc 退出 0、web 262/262、HEAD 提交态 367/367 全绿。当前工作树 fidelity L547「去向投影计数」失败由另一会话未提交的 workcase-63700bd2 正文改动暴露 `parseWorkCaseResultDraft` 段退出条件缺口（advice 段后的顶层 bullet 被吞为第 6 条建议，kind:null）——解析器缺口建议另立修复，不属本单范围。
    - **接受现状**：tsc 与测试的现状均非本单产物（原记录已如实归属）；其中解析器缺口已另行立为 Spark（议题「advice 段解析吞条目缺陷」，其 `refs` 已声明承自本单，见本卡引用区的关联行），本单不再跟踪。

