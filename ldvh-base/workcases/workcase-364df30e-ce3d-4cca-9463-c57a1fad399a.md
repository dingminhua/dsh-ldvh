---
fact_type_key: workcase
object_uid: 364df30e-ce3d-4cca-9463-c57a1fad399a
title: WorkCase 呈现保真与设计语言收敛
status: open
serves: SG-3
summary: 完善 WorkCase 各类呈现表现：修服务端投影的字段类型守卫缺陷（Date/boolean/array 被字符串守卫拦下，致 closed
  逐条核对退化为「未记录」、残留责任节点消失、Gate 1 批准时间与 attempt
  心跳丢失），统一前后端字段契约，补齐派生分组的本地化与语义色，使详情阅读结构与既登记设计语言一致（去重复身份块、正文用详情层级、closed
  不丢已存在字段），清 v4 残留并把 plugin/web/docs/10 §4.2 更新为 v5 语义，补运行时保真契约测试。
scope: 做什么：修 api/services/facts.ts 的 WorkCase
  投影保真（satisfied/residual/gate_1.approved_at/attempt 时间戳按真实类型判定并保留）；统一
  ObjectItem 与 WorkCaseResult/Gate1/Attempt
  契约；修列表卡与收件箱的判据可读呈现；补派生分组五档的本地化与语义色；详情去重复身份块与裸 status、正文改详情层级、closed 保留已存在的
  summary/serves/scope、消除 locale=""；删除零消费者 workcaseDetailProjection.ts 与
  has_execution_section；model.ts 字段序改 21 号闭集；更新 plugin/web/docs/10 §4.2 为 v5
  语义；补运行时保真契约测试与设计语言守卫；重建 dist；受控提交。明确不做什么：不改 21 号字段闭集/三态/Gate/派生分组判据；不改
  plugin/lib writer/tools；不改后端 API 路由契约与事实源文件、不迁移 v4 存量对象；不改其余六类阅读布局与列表卡；不改
  specs/ 下任何规范文本；不做 WC-A 全类型 YAML 与 WC-C SG 筛选的范围。
plan:
  - done_criteria: 每个缺陷给出复现方式与「期望/实际」对照，其中服务端投影缺陷以真实 ldvh-base/workcases 对象跑「读取层 +
      投影层」得到无损字段清单，可机械复核
    step: 缺陷清单固化为机械可复现证据
  - done_criteria: 对全部 7 个真实 workcase 复跑，字段冻结数（投影后丢失的实际存在字段）为 0；closed 的 satisfied 为
      boolean、residual 为 string[]
    step: 修服务端投影保真（satisfied/residual/gate_1.approved_at/attempt 时间戳）
  - done_criteria: ObjectItem 的 WorkCase 字段复用
      WorkCaseResult/WorkCaseGate1/WorkCaseAttempt；仓库内无第二套同字段类型；tsc 0 错误
    step: 统一前后端契约与类型
  - done_criteria: closed 列表卡与收件箱的逐条核对显示与详情同款可读三态文本，源码内无拼装裸布尔的形态
    step: 修列表卡与收件箱的判据可读呈现
  - done_criteria: 五组在中英双语下经 getObjectStatusLocale 均返回本地化文本（无 raw
      snake_case）；docs/01 §1.10.2 的「Human 待确认紫系」对二 Gate 组成立
    step: 补派生分组本地化与语义色
  - done_criteria: 详情不再出现与 ObjectIdentityHeader 重复的身份块与裸 status:；正文段使用详情正文层级而非
      ldvh-card-decision-body；closed 详情呈现对象已存在的 summary/serves/scope；无 locale=""
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
  scope_snapshot: 做什么：修 api/services/facts.ts 的 WorkCase
    投影保真（satisfied/residual/gate_1.approved_at/attempt 时间戳按真实类型判定并保留）；统一
    ObjectItem 与 WorkCaseResult/Gate1/Attempt
    契约；修列表卡与收件箱的判据可读呈现；补派生分组五档的本地化与语义色；详情去重复身份块与裸 status、正文改详情层级、closed 保留已存在的
    summary/serves/scope、消除 locale=""；删除零消费者 workcaseDetailProjection.ts 与
    has_execution_section；model.ts 字段序改 21 号闭集；更新 plugin/web/docs/10 §4.2 为 v5
    语义；补运行时保真契约测试与设计语言守卫；重建 dist；受控提交。明确不做什么：不改 21 号字段闭集/三态/Gate/派生分组判据；不改
    plugin/lib writer/tools；不改后端 API 路由契约与事实源文件、不迁移 v4 存量对象；不改其余六类阅读布局与列表卡；不改
    specs/ 下任何规范文本；不做 WC-A 全类型 YAML 与 WC-C SG 筛选的范围。
attempt:
  attempt_id: 1
  started_at: 2026-09-17T07:58:10.850Z
  controller: deepseek-v4.1-flash@dsh-ldvh-session
  heartbeat_at: 2026-09-18T11:21:15.354Z
created_at: 2026-09-17T07:36:31.587Z
change_log:
  - at: 2026-09-17T07:36:31.587Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-09-17T07:58:10.850Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 1 批准——Human 确认执行 WorkCase 呈现保真与设计语言收敛；授权绑定当次 plan+scope 指纹 [gate_1
      approved by Human（本会话直接指令：选定「批准执行（推荐）」）; attempt 1 allocated to
      deepseek-v4.1-flash@dsh-ldvh-session]
  - at: 2026-09-17T08:35:09.232Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 步骤 1–8 完成、提交 48d1264（20 files, +812/−309）；独立复核已发起 [attempt 1 heartbeat
      refreshed]
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
reviews:
  - at: 2026-09-18T11:21:15.354Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 对象：提交 48d1264（WorkCase 呈现保真与设计语言收敛）。基线：HEAD 前版 6ac30ec 与 specs/21
      §8/§9.3/§10.3/§10.4、specs/10 §5.5/§12、docs/01 §1.4
      第4条/§1.8.1/§1.10.2。方法：隔离子代理通读全量 diff 与规范原文，做 5 次变异验证并跑 tsc/测试/eslint，逐字节
      md5 还原核对。覆盖：三投影函数逐行类型判定与闭集（未放宽）、新增测试判别力（5/5
      变异被捕获）、与六类样板的外壳/正文层级/身份头部/复制入口一致性、§12 第7第8条、v4 残留全仓含 dist
      搜索。未覆盖：浏览器端真实渲染与视觉核验、Gate 1/2 写入路径与 CLI 侧契约、eslint 逐条同源比对。发现：无阻断、无重要，1
      项提示——docs/archive/v4-web-migration-survey.md 仍列已删除文件名，但该目录自述不具规范效力且为 v4
      源树冻结盘点，不构成悬挂引用。保证边界：证明投影不再静默丢弃合规字段且未放宽闭集、测试具运行时判别力、设计语言与样板一致；不证明浏览器视觉层与
      Human 阅读可用性。
gist: 修 WorkCase 呈现的字段类型守卫缺陷，统一前后端字段契约与派生分组配色，使详情阅读结构与已登记设计语言一致。
---

# WorkCase 呈现保真与设计语言收敛

## 摘要

完善 WorkCase 各类呈现表现：修服务端投影的字段类型守卫缺陷（Date/boolean/array 被字符串守卫拦下，致 closed 逐条核对退化为「未记录」、残留责任节点消失、Gate 1 批准时间与 attempt 心跳丢失），统一前后端字段契约，补齐派生分组的本地化与语义色，使详情阅读结构与既登记设计语言一致（去重复身份块、正文用详情层级、closed 不丢已存在字段），清 v4 残留并把 plugin/web/docs/10 §4.2 更新为 v5 语义，补运行时保真契约测试。

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

- attempt 1 started at 2026-09-17T07:58:10.850Z (controller: deepseek-v4.1-flash@dsh-ldvh-session)；Gate 1 授权范围见 gate_1.scope_snapshot。
- 步骤 1–8 完成，受控提交 48d1264（20 files changed, +812/−309）。
- 步骤 1 现状核实：以真实 ldvh-base/workcases 对象跑「读取层 readLocalFact → 投影层 projectCurrentWorkCaseCard → showObject 装配顺序」复现全部缺陷。根因是投影守卫按错误类型判定——js-yaml 把未加引号的 ISO 时间戳解析为 `Date`、把 `satisfied` 解析为布尔、`residual` 为数组，而守卫写的是 `typeof === 'string'`，故恒不命中并静默丢弃。修前实测：closed 对象 `satisfied` 由 `[true×5]` 退化为 `[null×5]`、`residual` 由 `[]` 变 `undefined`、`gate_1.approved_at` 与 attempt 两时间戳丢失。
- 步骤 2 完成：`projectWorkCaseResult`/`projectWorkCaseGate1`/`projectWorkCaseAttempt` 改按字段真实类型判定；新增 `shared/timestamp.ts` 的 `toRfc3339Text` 作为时间归一唯一实现（`factChangeLog.toChangeLogAtText` 改为复用它，09 §6 单一实现）。复跑全部真实对象，字段冻结数 0。
- 步骤 2 附加发现（测试暴露、已一并修复）：`gate_1` 原先只在 closed 分支重建、且只含 approved_at/approver，重建会覆盖来源，致 closed 详情的 `authorization_fingerprint` 与 `scope_snapshot`（C2 授权钉扎的两个比对基准，21 §10.3）被丢弃；同时 open 走原值透传、closed 走重建，同一字段出现两种运行期形态。已提为与状态无关的统一投影。
- 步骤 3 完成：`ObjectItem` 的 WorkCase 字段复用 `WorkCaseResult`/`WorkCaseGate1`/`WorkCaseAttempt`，删除列表侧内联的第二套形状（`satisfied?: string` vs `boolean`）。
- 步骤 4 完成：新增 `src/utils/workcaseCheckState.ts` 承载判据三态（已满足/未满足/未记录）映射，详情、列表卡与收件箱共用；两处裸布尔插值改为经共享映射取可读词条。
- 步骤 5 完成：派生分组补齐类型专属展示词条（中英）与语义色（Human 待确认紫系、推进中天蓝，依 docs/01 §1.10.2）；筛选器改由同一张表派生，删除 UI_LOCALES 中平行的 `objectList.workcaseGroup.*` 重复词条（10 条）。
- 步骤 6 完成：详情去除与 `ObjectIdentityHeader` 重复的身份块与裸 `status:`、正文改用详情阅读层级（`ResearchTextNodeContent`，依 docs/01 §1.4 第 4 条）、四个派生主体共用 `ResponsibilityNodes` 以免 closed 丢弃已存在的 summary/serves/scope、消除 `locale=""`。
- 步骤 7 完成：删除零消费者 `shared/workcaseDetailProjection.ts` 与零消费的 `has_execution_section`（连同其专用 helper）、`model.ts` 的 WorkCase 字段序改为 21 §8 闭集；`plugin/web/docs/10` §4.2 由 v4 语义改写为 v5（三态直读、派生分组与五档、判据三态、字段在场性与分组无关）。
- 步骤 8 完成：新增 `workcase-projection-fidelity.test.ts`（6 项）——不查源码文本，而跑真实管道对全量真实对象断言「实际存在的字段在投影后不消失」；四类缺陷逐条注入后各被捕获（D1 3 项失败、D2 3 项、D3 2 项、D4 2 项）。`workcase-design-language-contract.test.ts` 新增 6 项守卫，其中「身份块不重复」与「四主体共有字段」两项经变异验证可失败。
- 2026-09-17 执行期外部事件（如实登记，非本单产物）：另一会话在本次执行期间提交 6ac30ec（C2 授权校验与 rebatch 的 Code 托管字段，触及 specs/21 与 plugin/lib/writer），与本单范围不重叠；本单在合并后的 HEAD 上复跑三件套仍全绿。
- 2026-09-17 独立复核完成（隔离子代理，判定「有条件通过」）：复核者独立做 5 次变异验证（satisfied 改回 string、删 started_at、整删 residual、gate_1 退回 closed-only、删 authorization_fingerprint/scope_snapshot），全部被新增测试捕获；并核实投影未放宽闭集、与六类样板同形、v4 残留无悬挂引用。唯一提示项为 `docs/archive/v4-web-migration-survey.md` 仍列已删除文件名——该目录自述不具规范效力且系 v4 源树的冻结盘点，非当前仓库索引，不影响本单成立（转残留责任跟踪）。

## 结果

### Gate 2 提请

- criteria_checks:
  - 步骤 1 判据「每个缺陷给出复现方式与「期望/实际」对照，其中服务端投影缺陷以真实对象跑「读取层 + 投影层」得到无损字段清单，可机械复核」：**达成**。依据见「## 执行」第 3 条；机械可复核方式为对 `ldvh-base/workcases/` 全量对象跑 `readLocalFact → projectCurrentWorkCaseCard` 并比对字段存在性，修前冻结清单非空、修后为空。
  - 步骤 2 判据「对全部真实 workcase 复跑，字段冻结数为 0；closed 的 satisfied 为 boolean、residual 为 string[]」：**达成**。实测 8 个真实对象（含本单自身）字段冻结数 0；`satisfied` 为布尔且逐字保留（`[true,true,true,true,true]` 不再退化为 `[null×5]`）；`residual` 为数组且空数组形态保留（`[]` 与「缺失」可区分）；`gate_1` 四字段完备 7/7。
  - 步骤 3 判据「ObjectItem 的 WorkCase 字段复用 WorkCaseResult/WorkCaseGate1/WorkCaseAttempt；仓库内无第二套同字段类型；tsc 0 错误」：**达成**。`src/utils/api.ts` 的 `ObjectItem` 已改为复用；tsc 退出 0。
  - 步骤 4 判据「closed 列表卡与收件箱的逐条核对显示与详情同款可读三态文本，源码内无拼装裸布尔的形态」：**达成**。新增 `src/utils/workcaseCheckState.ts` 为三态映射唯一实现，`ObjectList.tsx` 与 `CognitionCenter.tsx` 均改为消费它；契约测试断言两处不再出现布尔插值形态。
  - 步骤 5 判据「五组在中英双语下经 getObjectStatusLocale 均返回本地化文本；docs/01 §1.10.2 的 Human 待确认紫系对二 Gate 组成立」：**达成**。实测五组在 zh/en 下均返回本地化文本，无 raw snake_case；`statusColors.ts` 补齐 `pending_gate1`/`awaiting_gate2` 紫系与 `executing` 天蓝。
  - 步骤 6 判据「详情不再出现重复身份块与裸 status:；正文用详情正文层级；closed 呈现已存在的 summary/serves/scope；无 locale=""」：**达成**。四项均已落实并由契约测试守卫（「身份块不重复」与「四主体共有字段」两项经变异验证可失败）。
  - 步骤 7 判据「死文件与零消费字段已删、model.ts 字段序为 21 号闭集；docs/10 §4.2 与 specs/21 §8 对照无 v4 词汇残留」：**达成**。`shared/workcaseDetailProjection.ts`（105 行，零消费者）已删除；`has_execution_section` 与其专用 helper 已删；`docs/10 §4.2` 改写为 v5 语义。复核确认无悬挂引用（`docs/archive/` 中的陈旧列举属非规范效力归档，已转残留跟踪）。
  - 步骤 8 判据「新增测试对真实对象断言投影无损（可捕捉上述投影缺陷回退），并经变异验证可失败」：**达成**。新增 `workcase-projection-fidelity.test.ts` 6 项，跑真实管道而非源码文本；本单自测 4 次变异 + 独立复核者另做 5 次变异，全部被捕获。
  - 步骤 9 判据「tsc 0 错误、web 测试全绿、eslint 无新增、dist 重建且 index.html 引用新 hash、Git Gate passed」：**达成**。tsc 退出 0；web 测试 262/262（原 250 + 新增 12）；eslint 39 problems（16 errors / 23 warnings）与 HEAD 基线逐项一致、零新增；dist 重建为 `index-CksUN7yQ.js` 且 `index.html` 已引用；提交 48d1264 输出 `LDVH Git Gate (commit-msg) passed` 与 snapshot_identity。
- achieved_scope: WorkCase 呈现链的服务端投影保真已修复（投影按 21 §8 真实类型判定，不再静默丢弃 satisfied/residual/gate_1 时间戳与 C2 钉扎基准、attempt 两时间戳；8 个真实对象字段冻结数 0）；前后端字段契约统一为一份；判据三态呈现统一为可读文本（详情/列表卡/收件箱共用单一映射）；派生分组五档补齐本地化与语义色；详情阅读结构与六类样板对齐（去重复身份块、正文用详情层级、字段在场性与分组无关）；v4 残留清除；`plugin/web/docs/10 §4.2` 更新为 v5 语义；新增 12 项测试守卫（运行时保真 6 项 + 设计语言 6 项）并经变异验证具备判别力。
- residual:
  - **浏览器端真实渲染未核验**：本次证据止于编译、构建产物与契约测试，未做各派生分组详情页的运行期目视核对（视觉层与 Human 阅读可用性未覆盖）。
  - **同型缺陷未普查其余六类**：本次只修 WorkCase 呈现链。六类阅读布局（ADR/Pitfall/Spark/Research/Friction/Norm）是否存在同类「按错误类型判定致字段静默丢弃」未在本单普查（本单授权范围明确排除改动它们）。建议另立工单以同一手法普查。
  - **`docs/archive/v4-web-migration-survey.md` 仍列举已删除的 `workcaseDetailProjection.ts`**：经复核确认为非悬挂引用（该目录自述不具规范效力，且文档系对 v4 源树的冻结盘点，非当前仓库索引）。建议在后续 docs 清理批次顺手更正。
  - **`statusColors.ts` 的 `executing` 键安全性依赖事实而非类型系统**：复核指出该键改色安全的依据是「当前仓库无对象以字面 `executing` 为 status 值」，而非类型保证；若将来有类型引入该字面状态，颜色语义会被静默共用。已如实登记，本次不扩围处置。
  - **dist 仅本机机械验证**：`dist/` 为 `.gitignore` 产物不入库，仅确认 `index.html` 引用新 hash 且文件存在，未覆盖部署链路。
  - **`model.ts` 的 `FIELD_ORDER_BY_TYPE.workcase` 实为死代码**：复核独立追证确认 WorkCase 详情走专属布局且 `FactReadingContent` 在通用兜底分支前 return，故该顺序永不被消费。本次改动的价值在于清除 v4 词汇（防误导后续维护者），其注释已如实标注这一点。

