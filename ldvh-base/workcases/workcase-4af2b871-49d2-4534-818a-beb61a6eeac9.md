---
fact_type_key: workcase
object_uid: 4af2b871-49d2-4534-818a-beb61a6eeac9
title: Web 工单呈现三态重建
status: closed
gist: 把 Web 的 WorkCase 呈现从 v4 八值状态机重建为三态直读，改五档筛选、重建认知中心收件箱，并清除 v4 残留。
serves: SG-3
summary: |-
  按 21 号定稿语义重建 Web 的 WorkCase 呈现链（2026-09-15 Human 裁决「登记+三态重建」的实施单）：投影器从 v4 状态机（open/blocked/closed+phase 八值）改为 21 号三态直读（draft/open/closed + gate_1/attempt/result/outcome 字段）；状态筛选改五档（待批准执行/执行中/待批准关闭/已关闭/全部）；认知中心收件箱按三态重建并与筛选器共用「待批准关闭」派生判据；详情与卡片读 v5 字段；

  ### 清除 v4 残留与登记呈现契约
  清除 v4 残留；派生规则与 Gate 1/2 待办呈现契约登记进 10 号（受保护变更，随本单走 Human Gate）。
scope: 做什么：重写 plugin/web 的 WorkCase 投影（workcaseStatus.ts 及生成契约）为 21 号三态直读；objects.ts 筛选改五档语义与 cancelled 四值徽标（废弃 ?progress= 五值词汇与 discarded 映射）；cognition.ts 收件箱 InboxKind 改三态+派生判定；WorkCaseReadingLayout/CriteriaList/ProgressTrack 等组件改读 plan/result/outcome/attempt/gate_1；删除 v4 残留（progressOptions、PriorityIcon/objectSignals 的 priority 链）；同步改写契约测试；在 10 号登记 WorkCase 呈现契约（三态直读+五档派生规则+Gate 1/2 待办语义）。明确不做什么：不改 21 号（类型权威不动）；不改 plugin/lib writer/tools（已对齐）；不做蓝图新功能与 serves 筛选（未裁决，另行）；不迁移 v4 存量对象（21 §15.3 另行）。
plan:
  - step: 投影器重写为 21 号三态直读
    done_criteria: draft/open/closed 三态对象全部 resolved、v4 phase 依赖消除；单元测试覆盖三态与字段缺失反例
  - step: 筛选器五档与四值徽标
    done_criteria: "五档（待批准执行/执行中/待批准关闭/已关闭/全部）可用，「待批准关闭」按「open ∧ 正文含 ## 结果 节」派生；cancelled 不再映射 discarded，closed 组显 outcome 四值徽标"
  - step: 认知中心收件箱三态重建
    done_criteria: InboxKind 改 draft→Gate 1 待批、open+结果草稿→Gate 2 待关（与筛选器共用同一派生函数）；对 21 号对象产生真实待办
  - step: 详情与卡片字段改读 v5
    done_criteria: closed 详情显 criteria_checks 逐条核对与 outcome；open 显 attempt 现场与 plan 进度；draft 显计划判据与待批准标识；work_items/closure_proposal/success_criterion_* 等 v4 字段消费清除
  - step: 10 号呈现契约登记（受保护变更）
    done_criteria: specs/10 增 WorkCase 呈现契约节（三态直读+派生规则+Gate 1/2 待办语义），经 Human Gate 独立批准后受控提交
  - step: 测试全绿与受控提交
    done_criteria: web 测试套（含改写后的契约测试）全绿、tsc/lint 无新增问题、全部变更经 Git Gate 提交
gate_1:
  approved_at: 2026-09-15T21:58:57.171Z
  approver: Human
  authorization_fingerprint: 329d5e1ba69e82299959396fee525343849c8f3d8dc7e4d11167986a5f8770fe
  scope_snapshot: 做什么：重写 plugin/web 的 WorkCase 投影（workcaseStatus.ts 及生成契约）为 21 号三态直读；objects.ts 筛选改五档语义与 cancelled 四值徽标（废弃 ?progress= 五值词汇与 discarded 映射）；cognition.ts 收件箱 InboxKind 改三态+派生判定；WorkCaseReadingLayout/CriteriaList/ProgressTrack 等组件改读 plan/result/outcome/attempt/gate_1；删除 v4 残留（progressOptions、PriorityIcon/objectSignals 的 priority 链）；同步改写契约测试；在 10 号登记 WorkCase 呈现契约（三态直读+五档派生规则+Gate 1/2 待办语义）。明确不做什么：不改 21 号（类型权威不动）；不改 plugin/lib writer/tools（已对齐）；不做蓝图新功能与 serves 筛选（未裁决，另行）；不迁移 v4 存量对象（21 §15.3 另行）。
reviews:
  - at: 2026-09-22T14:50:15.600Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: session-31b3aef4-1398-46dd-b02c-ad06fca0ee33
    implementer_session_id: session-31b3aef4-1398-46dd-b02c-ad06fca0ee33
    summary: 对象：WC-4af2b871「Web 工单呈现三态重建」，status=open，无 reviews 记录。基线：21 §8/§9.3/§10.4/§15/§16、02 §15/§20、03 §6.1、10 §5.5、Gate 1 授权范围。方法：只读独立复核——git 对象/历史取证、源码实读、临时 worktree 实跑测试（用后移除）；不采信对象自述。覆盖：三提交存在性与内容；a656dd7 单文件性；§5.5 全文；C1–C6 逐条；bde9c9f 与 HEAD 测试实跑；tsc。未覆盖：e56ce02 当次三件套、eslint、页面实际渲染、fingerprint 比对。发现：①结果节「e56ce02 验证记录 241/241」系错误归属，实为 235/235（241 出自后继 merge 10e3f79）；②「e56ce02 属已发生未记录」定性不成立——该提交创建了本对象，change_log 与产物同提交落盘；③追加式不追溯改写处置合规。保证边界：仅证明当次可读层一致与实跑结果，不证明价值、页面效果与授权成立。
  - at: 2026-09-27T02:16:49.495Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    session_id: 38ea38a6-69fd-450a-acc9-40eaf3e0fe13
    session_source: host
    implementer_session_id: session-31b3aef4-1398-46dd-b02c-ad06fca0ee33
    implementer_session_source: host
    summary: 对象：WC-4af2b871「Web 工单呈现三态重建」六步判据。基线：21 §8、10 §5.5、提交 e56ce02/a656dd7/bde9c9f/10e3f79。方法：git 取证＋四棵临时 worktree 实跑三件套（测试/tsc/eslint，基线 e56ce02^）＋源码逐点核对＋变异复现，不采信自述，worktree 已清除。覆盖：三提交形状/尾注/单文件性；e56 实跑 235/235、bde 249/249、a656 树 248；tsc 0；eslint 50→43→39；判据 1–6 源码面；§5.5 全文与守护测试 7/7、变异失败复现；本对象派生=awaiting_gate2 真实 Gate2 待办；241 出自 merge 10e3f79；「已发生未记录」不成立（e56ce02 即创建者）。发现：①六步判据与结果自述属实；②a656dd7 信息混写后继状态；③federation.ts 残留 v4 phase/blocked；④eslint「零新增」仅总量口径，e56 较基线多 3 error 站点；⑤对象文件有未提交修改。未覆盖：Gate 授权、页面渲染、dist/指纹复算、当初过程真实性、共享 node_modules。保证边界：仅证可读层一致与当次实跑，不证授权/价值/当时过程。
result:
  criteria_checks:
    - satisfied: true
      evidence: "提交 e56ce02（34 files changed, +1508/−7648，带 LDVH-Provider/Model 尾注）落盘 plugin/web/shared/workcaseLifecycle.ts：三闭集（WORKCASE_V5_STATUSES 三态 / WORKCASE_V5_OUTCOMES 四值 / WORKCASE_V5_FILTER_VALUES 五档）+ deriveWorkCaseV5View（非三态→unresolved、draft→pending_gate1、open∧正文含 ## 结果→awaiting_gate2、open→executing、closed→closed，非法 outcome 降级 null）+ bodyHasResultSection（ATX ≤3 空格缩进与 ```/~~~ 围栏配对忽略）；v4 投影器 workcaseStatus.ts 与生成契约 workcasePresentationContract.generated.ts 已删除，无 phase 依赖。单元测试 workcase-lifecycle.test.ts 覆盖三态派生、围栏/缩进反例、非法 outcome 等 12 例。实跑（2026-09-27 接管会话与独立复核各自在 e56ce02 真树）：web 测试 235/235、tsc 0。"
    - satisfied: true
      evidence: objects.ts 对 ?progress= 一律 400 并指向 ?lifecycle=（L239–243）；?lifecycle= 按五档闭集校验（L248–255）并以 deriveWorkCaseV5View(...).group === lifecycle 过滤（L288–290，不再有第二套判据），lifecycleOptions 取代 progressOptions；仓库内已无 cancelled→discarded 映射；closed 组 outcome 四值徽标在 ObjectList.tsx（closed 分支）与 i18n objectList/objectDetail.workcaseOutcome.* 逐词条落地，契约测试逐条断言。
    - satisfied: true
      evidence: "cognition.ts 的 deriveInboxKind(view) 直接消费 deriveWorkCaseV5View 的结果（同一次派生，非第二套判据）：pending_gate1→plan_confirmation、awaiting_gate2→closure_confirmation，v4 phase/handoff 判据已清除；CognitionCenter 终态集不含 discarded。以仓库内同一派生函数对本对象实跑得 {status: open, resolution: resolved, group: awaiting_gate2, has_result_draft: true}——本对象确实产生 Gate 2 待关的真实待办。"
    - satisfied: true
      evidence: facts.ts 卡片/详情按 v5 字段闭集投影（summary/serves/scope/plan/gate_1 四字段/attempt 全字段/result.criteria_checks）；WorkCaseReadingLayout.tsx 四分流（Draft/Executing/AwaitingGate2/Closed），closed 显 criteria_checks 逐条与 outcome、open 显 attempt 现场、draft 显计划判据；workcaseStatus 与生成契约删除，objectSignals 的 workcase priority 链摘除（非 spark 一律返回 null），work_items/closure_proposal/success_criterion_* 等 v4 字段无消费方（仅 locales 孤儿词条）。授权范围内 v4 残留清除成立；范围外残留（federation.ts、api.ts）见残留项。
    - satisfied: true
      evidence: 提交 a656dd7 单文件（specs/10-Web呈现与交互规范.md, 1 file, +26/−1，带 LDVH 尾注）新增 §5.5 WorkCase 呈现契约（三态直读、四派生组与五档筛选、收件箱与交互入口接线、复核节点呈现、机械校验边界），遵 00 §4.3 独立提交；提交 bde9c9f 单文件（+31/−0）在既有契约测试文件内新增 §5.5 一致性断言块，HEAD 实跑 7/7 通过；独立复核在真树内移除 §5.5 的「筛选提供五档」声明复现变异失败（6 pass/1 fail），还原后 7/7 通过——「变异可失败」的内容经独立复现为真（当初那次实验是否执行过不可机械复核）。
    - satisfied: true
      evidence: bde9c9f 真树实跑：web 测试 249/249 全绿、tsc -b 零输出退出 0、eslint 39 problems（16 errors）对比干净基线 e56ce02^ 的 50 problems（23 errors）无新增（总量口径；逐文件口径见残留项）；三提交均带 LDVH-Provider/Model 尾注（受控提交形式合规，Gate 是否真经人工批准不可机械复核）；HEAD 现状：web 测试 367/367 通过，tsc 另有 api/app.ts:134 报错（由 d7a19a1 引入，非本单文件）。
  achieved_scope: Web 侧 WorkCase 呈现链由 v4 八值状态机重建为 21 号三态直读：派生权威 workcaseLifecycle.ts（三闭集 + deriveWorkCaseV5View + bodyHasResultSection）、五档筛选与 outcome 四值徽标、认知中心收件箱三态派生（复用同一派生结果）、详情与卡片 v5 字段消费、v4 投影器与生成契约删除、objectSignals 的 workcase priority 链摘除、契约测试改写与新增、specs/10 §5.5 登记。六步判据逐条达成，并经隔离子代理独立复核以 git 取证、四棵真树实跑三件套与变异复现核实。
  residual:
    - attempt 1 的控制器更替与提交 e56ce02 未记入 change_log 属历史既成事实，本次冷恢复已如实登记于执行节；对象 change_log 不作追溯改写（03 §6.1）。
    - 提交 e56ce02 当时的三件套记录（241/241、tsc 0）来自该提交信息，本次未复跑复算，如实标为未复核。
    - v4 存量对象迁移（21 §15.3）不在本单范围。
    - 证据更正（2026-09-18 独立复核）：结果节「步骤 1–4」条所记「提交 e56ce02 的验证记录为 web 测试 241/241」系归属错误——e56ce02 提交信息原文为 235/235；241/241 出自其后继 merge 10e3f79（自述「较合并前 235 增加分支带入的 refs 测试」），且系他人分支带入的结果。执行节所记「已发生未记录」的定性亦不成立（e56ce02 即本对象创建者）。上述两项以 reviews 记载为准；原记录保留不改写（03 §6.1）。
    - 2026-09-27 接管复核（本会话）：上文「三件套未复跑复算」一项至此结清——e56ce02 当次实跑为 web 测试 235/235、tsc 0 错误、eslint 43 problems（21 errors）对比干净基线 50 problems（23 errors），零新增净减 7；241/241 的归属错误一并确认。
    - 2026-09-27 独立复核新增残留（隔离子代理，reviews 第二条）：federation.ts L142–143 仍按 v4 语义消费 WorkCase（status==='blocked' 计数、phase ∈ {human_plan_confirming, human_closure_confirming} 计待决），src/utils/api.ts 仍留 phase? 字段；该文件自 e56ce02 起未被触碰，也不在本单授权范围（objects/cognition/facts）与契约测试的 v4 词汇守护名单内——「v4 残留清除」在授权范围内成立，非全域成立。
    - 2026-09-27 独立复核口径提醒：eslint「无新增」按总量口径成立（50/23→43/21→39/16），按逐文件口径 e56ce02 相对干净基线新增 3 个 error 站点（同时消除 5 个）；两种读法并存，提交信息的「零新增且净减」指总量口径。
    - 2026-09-27 独立复核记载瑕疵：a656dd7 提交信息把 bde9c9f 才加入的一致性断言与 249/249 记入自身（该树实跑 248/248，当时测试文件不含 §5.5 断言）；bde9c9f 的表述实为既有契约测试文件内新增 31 行断言块，非新建文件。本单结果节的归属无误，属提交信息留痕不精确。
    - 2026-09-27 独立复核未覆盖项（保证边界）：Human Gate 1/2 与 Git Gate 的授权事实本身、页面实际渲染、dist 产物、fingerprint 复算、三树共用同一份 node_modules（非各提交 lockfile 冻结版本），以及「当初确实执行过」的过程事实——均不可机械复核。
    - 2026-09-27 实现层新发现（本会话）：本对象 reviews[0]（2026-09-18 由 workbuddy-global 记录）在 2026-09-27 的两次受控写入中被 writer 按「既有条目缺失时回落到当前值」的规则补记了本会话的 session_id 与 implementer_session_id；session_source 未被补记（该规则明文不作继承性补齐），故该条目在关闭门禁上不可比对，不构成独立复核证据，也不表示本会话记录了那次复核。原记录者身份在身份锚点（workcase-2be11478，2026-09-19）落地前从未落盘，机械上不可复原。
outcome: completed
created_at: 2026-09-15T21:44:22.236Z
change_log:
  - at: 2026-09-15T21:44:22.236Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: 受控创建 WC-0002——Web WorkCase 呈现三态重建（阶段 6 承载层：2026-09-15 裁决「登记+三态重建」的实施单；查重：workcases 全量 1 对象 WC-0001（32 号起草，范围不同）；普查 docs/web-workcase-v4-residue-census.md 为调研输入非对象）
  - at: 2026-09-15T21:58:57.171Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: Gate 1 批准——经 ask_user_question 取得（2026-09-15），作用范围为 scope_snapshot 记载的 Web 呈现重建范围；六步计划与 C2 冻结生效 [gate_1 approved by Human; attempt 1 allocated to glm-5.3-main-controller]
  - at: 2026-09-15T22:46:04.776Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: 编码主体完成（子代理+主控收尾）：tsc 归零、测试 213/241（28 失败均为旧 v4 契约断言，12 文件待改写）；步骤 1-4 编码面完成，剩余测试改写→10 号登记→全绿提交 [attempt 1 heartbeat refreshed]
  - at: 2026-09-15T23:46:40.026Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: 验证三件套全达标：tsc 0、测试 235/235、eslint 零新增净减 7（基线 50→43）；28 项 v4 断言全改写、两个功能缺口补齐；剩余步骤 5（10 号登记 Human Gate）与受控提交 [attempt 1 heartbeat refreshed]
  - at: 2026-09-16T13:44:57.334Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "冷恢复接管——完成孤立 attempt 副作用核对（提交 e56ce02 属已发生未记录）并 takeover 分配 attempt 2；步骤 1-4/6 已完成，步骤 5 待 Gate [attempt 1 taken over → attempt 2 (controller: glm-5.3-main-controller)]"
  - at: 2026-09-16T13:45:38.977Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "更正接管控制器身份——takeover 分配 attempt 3，controller 更正为 workbuddy/deepseek-v4.1-flash [attempt 2 taken over → attempt 3 (controller: workbuddy/deepseek-v4.1-flash)]"
  - at: 2026-09-16T14:32:44.306Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 步骤 5 完成——specs/10 §5.5 登记 WorkCase 呈现契约（提交 a656dd7）并新增一致性契约测试（bde9c9f）；六步判据全部达成 [attempt 3 heartbeat refreshed]
  - at: 2026-09-16T14:33:44.755Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 更正结果节标题为纯「## 结果」并同步结果内容——原带后缀标题不合 21 §8，且致呈现层误判为 executing [attempt 3 heartbeat refreshed]
  - at: 2026-09-18T02:01:14.735Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 落档独立结果复核概要（reviews）：三提交与六判据经 worktree 实跑逐条核实达成；同时更正两处事实性错误——「e56ce02 验证记录 241/241」系归属错误（实为 235/235，241 出自后继 merge 10e3f79）与「已发生未记录」定性不成立（e56ce02 即本对象创建者），冷恢复处置形式经核实合规 [attempt 3 heartbeat refreshed]
  - at: 2026-09-18T11:21:15.367Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 迁移：补齐 gist 要点字段（21 §8，WorkCase d5273e1c） [attempt 3 heartbeat refreshed]
  - at: 2026-09-22T14:50:15.600Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "格式治理：摘要分块（忠实重排）——把作者自撰的行内「：」提为 ### 块首并插入空行，使摘要可读且符合 21 §8 书写结构（H3 骨架）；作者原文逐字未改，仅新增标记与空行 [attempt 3 heartbeat refreshed]"
  - at: 2026-09-27T01:48:09.396Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: "换 attempt 建立关闭侧身份基线——attempt 3 分配于身份锚点（workcase-2be11478，2026-09-19）落地之前，其会话身份从未落盘，关闭侧独立性比对无基准可建；接管分配 attempt 4（原工作与证据不变） [attempt 3 taken over → attempt 4 (controller: deepseek-v4.1-flash@dsh-ldvh-session)]"
  - at: 2026-09-27T02:16:49.495Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: "隔离子代理独立复核落盘（2026-09-27）：六步判据与结果自述经 git 取证、四棵真树实跑三件套与变异复现核实属实，另报 5 项新发现 [review recorded by session 38ea38a6-69fd-450a-acc9-40eaf3e0fe13; reviews entries: 2; 记录自子代理会话 38ea38a6-69fd-450a-acc9-40eaf3e0fe13 的最终产出（Code 捕获）]"
  - at: 2026-09-27T02:22:58.869Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: Gate 2 关闭：六步判据逐条达成，隔离子代理独立复核落盘（另报 5 项发现已全部登入残留），outcome=completed [gate_2 closed with outcome=completed; attempt 4 retracted]
  - at: 2026-10-01T19:01:44.862Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 事实更正（非状态转换）——丙方案推进：存量迁移（分离式→合并式）——正文「## 结果」节把独立 `- advice:` 段并入各残留之下的去向子项，10 条残留全落「接受现状」并各写自足理由；3 条退役词去向全部转换：2 条「另立工单」（v4 残留收敛、writer 补记 reviews 身份）已另行立为 Spark（f07f3526／a687da1f，二者 refs 均已声明承自本单，本卡引用区呈现），1 条「另立工单」（v4 存量迁移）经认定即本批次正在执行的工作、无须另立。终态判定未变：status/outcome/result/gate_1/attempt/plan/scope/reviews 逐字继承落盘对象（本入口不接收 frontmatter，故改动在结构上不可能），仅正文重写。依 21 §9.2「若原终态记录本身错误，按事实更正规则修正，不把更正伪装成领域状态转换」与 03 §9.5，经 Human 授权：Human 2026-10-01 授权（原话「丙 方案你改一个我看看效果」→「可以，就这么推进」→「dsh-ldvh@workcase-364df30e 这个还有 另立工单，直接行动，都要转换」→「确认」）：按丙方案迁移本单去向——有价值事项已立 Spark 并由其 refs 反引本单；退役词去向全部转换；经 correct 通道只改正文，status/outcome/result/reviews 逐字不变。
---

# Web 工单呈现三态重建

## 摘要

按 21 号定稿语义重建 Web 的 WorkCase 呈现链（2026-09-15 Human 裁决「登记+三态重建」的实施单）：投影器从 v4 状态机（open/blocked/closed+phase 八值）改为 21 号三态直读（draft/open/closed + gate_1/attempt/result/outcome 字段）；状态筛选改五档（待批准执行/执行中/待批准关闭/已关闭/全部）；认知中心收件箱按三态重建并与筛选器共用「待批准关闭」派生判据；详情与卡片读 v5 字段；

### 清除 v4 残留与登记呈现契约
清除 v4 残留；派生规则与 Gate 1/2 待办呈现契约登记进 10 号（受保护变更，随本单走 Human Gate）。

## 授权范围

做什么：重写 plugin/web 的 WorkCase 投影（workcaseStatus.ts 及生成契约）为 21 号三态直读；objects.ts 筛选改五档语义与 cancelled 四值徽标（废弃 ?progress= 五值词汇与 discarded 映射）；cognition.ts 收件箱 InboxKind 改三态+派生判定；WorkCaseReadingLayout/CriteriaList/ProgressTrack 等组件改读 plan/result/outcome/attempt/gate_1；删除 v4 残留（progressOptions、PriorityIcon/objectSignals 的 priority 链）；同步改写契约测试；在 10 号登记 WorkCase 呈现契约（三态直读+五档派生规则+Gate 1/2 待办语义）。明确不做什么：不改 21 号（类型权威不动）；不改 plugin/lib writer/tools（已对齐）；不做蓝图新功能与 serves 筛选（未裁决，另行）；不迁移 v4 存量对象（21 §15.3 另行）。

## 计划

- 投影器重写为 21 号三态直读：判据——draft/open/closed 三态对象全部 resolved、v4 phase 依赖消除；单元测试覆盖三态与字段缺失反例
- 筛选器五档与四值徽标：判据——五档（待批准执行/执行中/待批准关闭/已关闭/全部）可用，「待批准关闭」按「open ∧ 正文含 ## 结果 节」派生；cancelled 不再映射 discarded，closed 组显 outcome 四值徽标
- 认知中心收件箱三态重建：判据——InboxKind 改 draft→Gate 1 待批、open+结果草稿→Gate 2 待关（与筛选器共用同一派生函数）；对 21 号对象产生真实待办
- 详情与卡片字段改读 v5：判据——closed 详情显 criteria_checks 逐条核对与 outcome；open 显 attempt 现场与 plan 进度；draft 显计划判据与待批准标识；work_items/closure_proposal/success_criterion_* 等 v4 字段消费清除
- 10 号呈现契约登记（受保护变更）：判据——specs/10 增 WorkCase 呈现契约节（三态直读+派生规则+Gate 1/2 待办语义），经 Human Gate 独立批准后受控提交
- 测试全绿与受控提交：判据——web 测试套（含改写后的契约测试）全绿、tsc/lint 无新增问题、全部变更经 Git Gate 提交

## 执行

- attempt 1 started at 2026-09-15T21:58:57.171Z (controller: glm-5.3-main-controller)。
- 步骤 1–4 与步骤 6 前半完成，受控提交 e56ce02（feat(web): WorkCase 呈现三态重建，34 files changed, +1508/−7648）；heartbeat 末次刷新 2026-09-15T23:46:40Z。
- 2026-09-16 冷恢复（21 §10.4）：确认该 attempt 为孤立 attempt（原 controller 属已中断会话，心跳陈旧约 9 小时）。已完成副作用范围核对——
  - 「已发生未记录」：受控提交 e56ce02 实际已落盘步骤 1–4 与 6 前半，但对象 change_log 无该条目（末条 23:46:40Z 早于提交 23:54:03Z）；控制器已更替而 attempt.controller 未更新。
  - 「已记录未发生」：未发现。步骤 5 记「剩余」且当时确未完成。
  - 未核对项（如实声明）：三件套未复跑、dist hash 未复算、authorization_fingerprint 未复算。
- 副作用核对完成后执行 takeover：分配 attempt 3，controller 更正为 workbuddy/deepseek-v4.1-flash（21 §10.4 第 1、3 点）。
- 2026-09-16 步骤 5 完成：获 Human 授权后登记 specs/10 §5.5 WorkCase 呈现契约，受控提交 a656dd7（仅含该规范文档，遵 00 §4.3 独立提交要求）；配套新增代码-规范一致性契约测试，受控提交 bde9c9f。
- 2026-09-16 正文标题更正：结果节标题原写作「## 结果（草稿，本单未关闭）」，**该写法不合 21 §8**——正文 H2 须为纯标题「结果」（writer 的 sectionContent 与呈现层的派生判据均按精确匹配识别）。已更正为「## 结果」。**该更正同时修复了一个派生错误**：带后缀的标题使呈现层判定 group=executing 而非 awaiting_gate2。
- 2026-09-18 独立结果复核落盘（reviews）：三提交存在性与内容、a656dd7 单文件性、specs/10 §5.5 全文、六步判据逐一核实（含在 bde9c9f 真实树上实跑 249/249 与 tsc）。复核指出上述「已发生未记录」的定性不成立——e56ce02 即本对象文件的创建者（`git log --diff-filter=A` 证实，父提交中不存在该路径），change_log 与产物在同一提交内一并生成；「末条早于提交 8 分钟」正因它就写在该提交里，原据时间先后推因果有误。冷恢复的**处置形式**（追加式、未改写既有条目）经复核确认合规，仅在事实认定上有此偏差，见 reviews 概要。
- 2026-09-27 换 attempt 以建立关闭侧身份基线（21 §10.4）：Gate 2 关闭的前置条件二要求至少一条 `reviews` 的 `session_id` 与其 `implementer_session_id` 可比对且不同（workcase-2be11478）。attempt 3 分配于该身份锚点（2026-09-19）落地之前，其会话身份从未落盘，比对基准无从建立；且原执行会话已不存在，无法由身份本人经心跳补齐。故**接管并分配 attempt 4**（controller: deepseek-v4.1-flash@dsh-ldvh-session），由本会话在任，取得带来源的完整基线。原 attempt 3 的工作与证据不变，change_log 不作追溯改写（03 §6.1）。
- 2026-09-27 隔离子代理独立复核落盘（reviews 第二条）：在四棵临时真树（e56ce02 / bde9c9f / e56ce02^ / a656dd7）实跑三件套、逐点核对判据 1–6 源码面、复现变异失败，并核对本对象派生（awaiting_gate2）。六步判据与结果自述核实属实；另报 5 项发现，已全部登入结果节残留。

## 结果

- 步骤 1–4：达成——证据：提交 e56ce02 落盘三态投影器、五档筛选与 outcome 四值徽标、认知中心 InboxKind 三态重建、详情与卡片 v5 字段消费清除，以及改写的契约测试；该提交的验证记录为 web 测试 241/241 全绿、tsc 0 错误。
- 步骤 5：达成——证据：specs/10 §5.5 登记 WorkCase 呈现契约（三态直读、四派生组与五档筛选、收件箱与交互入口接线、复核节点呈现、机械校验边界），提交 a656dd7；§5.5 每条声明均与实现逐条核对（三态/四值/五档闭集、pending_gate1 与 awaiting_gate2 判据、H2 围栏与缩进容错、cognition 复用同一派生结果）；提交 bde9c9f 新增一致性契约测试并经变异验证可失败。
- 步骤 6：达成——证据：web 测试 249/249 全绿（含改写与新增的契约测试）、tsc 0 错误、eslint 无新增；全部变更经 Git Gate 提交。

- residual:
  - attempt 1 的控制器更替与提交 e56ce02 未记入 change_log 属历史既成事实，本次冷恢复已如实登记于执行节；对象 change_log 不作追溯改写（03 §6.1）。
    - **接受现状**：历史既成事实，已如实登记于执行节，不追溯改写，就此了结。
  - 提交 e56ce02 当时的三件套记录（241/241、tsc 0）来自该提交信息，本次未复跑复算，如实标为未复核。
    - **接受现状**：e56ce02 当次三件套已由接管会话（235/235、tsc 0）与独立复核双重复跑复算结清，无需再跟踪。
  - v4 存量对象迁移（21 §15.3）不在本单范围。
    - **接受现状**：原拟另立工单；该迁移即本次存量迁移批次正在执行的工作（本会话逐份处理），本单无须另立，就此了结。
  - 证据更正（2026-09-18 独立复核）：结果节「步骤 1–4」条所记「提交 e56ce02 的验证记录为 web 测试 241/241」系归属错误——e56ce02 提交信息原文为 235/235；241/241 出自其后继 merge 10e3f79（自述「较合并前 235 增加分支带入的 refs 测试」），且系他人分支带入的结果。执行节所记「已发生未记录」的定性亦不成立（e56ce02 即本对象创建者）。上述两项以 `reviews` 记载为准；原记录保留不改写（03 §6.1）。
    - **接受现状**：两项证据更正已以 `reviews` 与本节残留为准，原记录按 `03 §6.1` 保留，无需处置。
  - 2026-09-27 接管复核（本会话）：上文「三件套未复跑复算」一项至此结清——e56ce02 当次实跑为 web 测试 235/235、tsc 0 错误、eslint 43 problems（21 errors）对比干净基线 50 problems（23 errors），零新增净减 7；241/241 的归属错误一并确认。
    - **接受现状**：该项已由接管复核结清（实测数字入账），无待跟踪事项，就此了结。
  - 2026-09-27 独立复核新增残留（隔离子代理，reviews 第二条）：`federation.ts` L142–143 仍按 v4 语义消费 WorkCase（`status==='blocked'` 计数、`phase ∈ {human_plan_confirming, human_closure_confirming}` 计待决），`src/utils/api.ts` 仍留 `phase?` 字段；该文件自 e56ce02 起未被触碰，也不在本单授权范围（objects/cognition/facts）与契约测试的 v4 词汇守护名单内——「v4 残留清除」在授权范围内成立，非全域成立。
    - **接受现状**：原拟另立工单收敛；该 v4 残留已另行立为 Spark（议题「federation 与 api 的 v4 残留收敛」，其 `refs` 已声明承自本单，见本卡引用区的关联行），本单不再跟踪。
  - 2026-09-27 独立复核口径提醒：eslint「无新增」按**总量**口径成立（50/23→43/21→39/16），按**逐文件**口径 e56ce02 相对干净基线新增 3 个 error 站点（同时消除 5 个）；两种读法并存，提交信息的「零新增且净减」指总量口径。
    - **接受现状**：两种口径与提交信息的混写均已如实并陈，提交信息不可改写，无需另立对象，就此了结。
  - 2026-09-27 独立复核记载瑕疵：a656dd7 提交信息把 bde9c9f 才加入的一致性断言与 249/249 记入自身（该树实跑 248/248，当时测试文件不含 §5.5 断言）；bde9c9f 的表述实为既有契约测试文件内新增 31 行断言块，非新建文件。本单结果节的归属无误，属提交信息留痕不精确。
    - **接受现状**：属提交信息留痕不精确（本单结果节归属无误），提交信息按 `03 §6.1` 不可改写；差异已如实登记，就此了结。
  - 2026-09-27 独立复核未覆盖项（保证边界）：Human Gate 1/2 与 Git Gate 的授权事实本身、页面实际渲染、dist 产物、fingerprint 复算、三树共用同一份 node_modules（非各提交 lockfile 冻结版本），以及「当初确实执行过」的过程事实——均不可机械复核。
    - **接受现状**：上述各项属如实声明的保证边界（不可机械复核），无需跟踪。
  - 2026-09-27 实现层新发现（本会话）：本对象 `reviews[0]`（2026-09-18 由 workbuddy-global 记录）在 2026-09-27 的两次受控写入中被 writer 按「既有条目缺失时回落到当前值」的规则补记了本会话的 `session_id` 与 `implementer_session_id`；`session_source` 未被补记（该规则明文不作继承性补齐），故该条目在关闭门禁上不可比对，不构成独立复核证据，也不表示本会话记录了那次复核。原记录者身份在身份锚点（workcase-2be11478，2026-09-19）落地前从未落盘，机械上不可复原。
    - **接受现状**：原拟另立工单处置；该实现层缺陷已另行立为 Spark（议题「writer 补记 reviews 身份致归属失真」，其 `refs` 已声明承自本单，见本卡引用区的关联行），本单不再跟踪。

建议 outcome：completed——理由：六步判据逐条达成，且经 2026-09-27 的隔离子代理独立复核以 git 取证、四棵真树实跑三件套与变异复现核实（e56ce02 235/235、bde9c9f 249/249、tsc 0、eslint 无新增、§5.5 守护测试 7/7 且变异可失败、本对象派生确为 awaiting_gate2）；该复核另报的 5 项发现已全部登入上列残留，均属范围外残留、口径提醒、记载瑕疵与保证边界，不构成任何一步判据未达成。

关闭后的后续方向（整单一条）：本单关闭后不再派生新工作；Web 侧 WorkCase 呈现线由已开的后续工单继续（364df30e 呈现保真与设计语言收敛、99957f65 卡片与详情对齐设计语言、63700bd2 详情页 YAML 呈现推广到全类型），v4 残留的 federation 角落与实现层身份补记行为另立工单处置。

