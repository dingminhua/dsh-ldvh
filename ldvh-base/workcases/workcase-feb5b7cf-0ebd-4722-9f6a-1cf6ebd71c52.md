---
fact_type_key: workcase
object_uid: feb5b7cf-0ebd-4722-9f6a-1cf6ebd71c52
title: 摩擦补充路径校验与存量改正
status: closed
gist: 修摩擦补充路径三处缺口：转写入口不校验目标账目编号能解析、补充失败不进待处置队列、以及把一条因编号抄错而永久卡死的存量缓冲条目改正。三处均已修复并经三轮独立复核；第四步「由受控审核运行补进真实账目」尚未发生（须宿主跨回合静置触发），故以 partial 关闭。
serves: c8a2a574-b17f-47c1-b5fb-fe9bca88c97b
summary: |-
  本单修掉摩擦补充路径的三处缺口，并改正一条因编号抄错而永久卡死的存量缓冲条目。本单由 workcase-6588d816 拆分而来——原候选把「完成门禁」与这三处缺口合成一单，建前独立审核判定该合并与实测相反，两者可独立授权、独立关闭，故拆为两单；本单只承担补充路径与存量改正。

  ### 现状核实
  - **唯一未校验的入口**：`friction-transfer.js:137` 的 `validateTransferProposal` 对 `target_uid` 只做 `isNonEmptyString(...).trim()`，不判它能否解析到已存在的账目。发现层是要校验的——`friction-landing.js:231` 先 `readFrictionObject` 并设状态闸，`friction-subagent-contract.js:457` 校验 uid 属于本次交付的候选（`friction-discovery-provider.js:471` 只是注释与参数传递处，不是校验点）。故转写入口确为唯一未校验入口。
  - **结构上的印证**：`transferDiscardedEntryToFriction` 的签名 `{dshHomePath, projectId, entry, transfer, now}` 里**没有 `factSourceRoot`**，从结构上不可能解析账目——校验不是漏写，是缺一个入参。而唯一调用点 `observation-review.js:854` 所在的函数内已有 `factSourceRoot` 可用。
  - **已实测的后果**：缓冲条目 `648749cd-9f69-4af9-bc0d-2fa5f5103f56` 的 `target_uid` 为 `6c6ea207-da7d-4527-957a-9b46775ecfd4`，真实账目为 `6c6ea207-da9d-4527-957a-9b46775ecfd4`，两字符之差。真实账目存在，`status: open`，`occurrence.count: 7`。
  - **进入路径的判据**：该条目带 `title`/`basis`/`attribution` 三项（`same-obstacle` 态按 §12bis.1 字段表不涉及这三项），且 `evidence` 署名行是经验侧形态而非发现层的「（来源：turn N）」。故它经转写入口进入。**如实声明**：`group ≠ target_uid` 本身不构成证明——§12bis.1 对该态的 `group` 用「允许」取 uid 作占位键、非「必须」。
  - **卡死的机制**：该条目带 `target_uid` 即被排除在阈值聚合之外（`friction-observation-buffer.js:1016`），既不能攒够 N 晋升、也不会被 `settleSupplementedEntries` 结算；每次经验审核运行都按该 uid 读账目，得到 `friction/object_not_found`（ENOENT），条目留在 `pending`，下一轮原样重试。
  - **失败不进队列**：`friction-review-promotion.js:130-136` 的补充失败只 `residual.push` 后 `continue`；该文件 import 列表里**没有任何 pending-queue 导入**。对照 `observation-review.js:197-218` 的 `registerTransferFailure`——转写失败会入队并带 `pending_entry_id`，但该函数**未导出、模块私有**。两个失败面，只有一半有登记通道，且那一半在另一个模块里。
  - **计数口径（如实登记）**：`idle-checkpoint-runs.json` 为 50 条环形（`idle-runlog.js:44`），窗口会随写入持续漂移。本次实测窗口内该失败出现 **8 条**记录（6 landed / 1 land-failed / 1 skipped，首 `12:37:21.521Z`、末 `17:06:48.814Z`，message 去重后 distinct=1）。**8 次是下限**——该条目 11:50 写入，早于环形窗口起点，更早的记录已被挤出；且「窗口内条数」本身随漂移变化，故只作下限用，不与任何固定时间跨度绑定。未核查登记现为 **132** 条（`friction-discovery` 76、`experience-capture` 56），与该失败相关 0 条。

  ### 处置方向
  - **入口校验**：转写时 `target_uid` 非空须解析到已存在的账目（须给 `transferDiscardedEntryToFriction` 增加 `factSourceRoot` 形参并由调用方传入），解析失败即拒绝（`friction_transfer/target_uid_unresolvable`），并按转写失败同一通道登记入队。
  - **失败入队**：`registerTransferFailure` 上提到共享模块（`pending-queue.js` 旁的独立小模块，该文件只依赖 Node 内置模块、不反向依赖摩擦侧，无循环风险），两个失败面共用同一实现，不复制第二份。
  - **存量改正**：把该条目的 `target_uid` 改正为真实账目 uid。这是对**内容字段**的就地修改，而 §12bis.1 的契约形状（`:603`「追加＋状态结算」）与结算段（`:656`「其余字段不可改」）使内容字段的就地改写无据（另注：措辞相同的显式条文在 `specs/11:563`，属 §12bis 经验留痕缓冲，不直接管辖摩擦缓冲）。工单的批准**不等于修订规范**，故规范修订那一步必须补一条「经授权的条目字段差错更正」条款，否则实施后规范上无据、且该步自设的「无与实现相反的表述」验收会判不符。**替代方案如实列出**：也可把该条结算为 `discarded` 了事，代价是材料作废但无规范冲突——本单选改正并补条款。
  - **顺序**：先修入口（前两步）再迁移存量。反过来会让今日起新抄错的条目继续落进缓冲，迁移完立刻又有新的。

  ### 边界
  本单不实现机械审核门，不改 `idle-runlog.js` 的 stage 语义，也不改 §18。本单要修订 specs/11 §12bis.1（新增可解析性校验、补充失败登记、经授权的字段差错更正三处）与 §19.1 归口登记。
scope: |-
  做什么：
  - 转写入口对 target_uid 增加解析校验：给 `transferDiscardedEntryToFriction` 增加 `factSourceRoot` 形参，非空 `target_uid` 须解析到已存在账目，失败即拒绝并返回 `friction_transfer/target_uid_unresolvable`，且不写入缓冲
  - 把 `registerTransferFailure` 上提为共享模块，使转写失败与补充失败走同一实现（不复制第二份）
  - 补充级更新的失败登记进待处置队列，与转写失败同形（含队列不可写时的 `unregistered`／`unregistered_message`，不得吞掉）
  - 在 Human 批准本单（Gate 1）后，把缓冲条目 648749cd 的 target_uid 一次性改正为 `6c6ea207-da9d-4527-957a-9b46775ecfd4`，**批准前不得就地改写**；迁移前备份，迁移后精确回读
  - 把该次补充落到真实账目 `6c6ea207` 上（按 02 §10 的受控写入要求：走受控入口、写后精确回读、失败 fail-closed），使 `occurrence.count` 递增 1 且现象段新增一条带逐字引证的观察；该补充须由一次受控的审核运行产生，使其在同一次运行内把该缓冲条目结算移除
  - 同步修订 specs/11 §12bis.1（新增可解析性校验、补充失败登记、经授权的字段差错更正三处）与 §19.1 归口登记
  - 为上述各项补测试，并使既有摩擦与转写相关测试全绿

  明确不做什么：
  - 不实现机械审核门 verifyRun，不改 `idle-runlog.js` 的 stage 语义，不改 §18
  - 不改变 §9／§10 自动动作闭集的成员，不改变阈值 N、缓冲容量与保留期
  - 不改 §12bis.1 的字段闭集（本单只增校验义务与登记义务，不增删字段）
  - 不改变任何既有账目的 `status`；不批量处置其它 pending 缓冲条目
  - 不清理、不删除既有待处置队列登记，也不为历史 132 条未核查登记补写 `resolved_at`
  - 不改动 Web 呈现层，不动 DSH 官方包
  - 不修订 specs/ 其它章节
  - 整文件批量改写只允许出现在两个具名载体：`~/.dsh/ldvh/friction-observations/dsh-ldvh.jsonl`（仅限 648749cd 一条的 target_uid）与 `pending-queue.jsonl`（仅限追加）
plan:
  - done_criteria: transferDiscardedEntryToFriction 签名含 factSourceRoot 且由调用方传入；target_uid 非空且解析不到已存在账目时返回 friction_transfer/target_uid_unresolvable，且缓冲条目数不变。有测试构造不存在的 uid（仿 friction-review-promotion.test.mjs 的 factRoot(root) 夹具，造一份真实账目文件）断言拒绝；另有测试断言合法 uid 仍正常写入
    step: 转写入口对 target_uid 增加解析校验，失败即拒绝
  - done_criteria: 该函数从 observation-review.js 移出至共享模块并被两个调用点共用（全仓仅一处定义）；friction-review-promotion.js 的每条 supplement 失败都产生一条 pending-queue 登记并带 pending_entry_id；队列不可写时带 unregistered 且原因不被吞掉。有测试断言 1 条补充失败对应 1 条登记，登记内容含 entry_id 与 target_uid；另有测试断言转写失败路径行为不变
    step: 把 registerTransferFailure 上提为共享模块，并补上补充失败的登记
  - done_criteria: 该条目的 target_uid 等于 6c6ea207-da9d-4527-957a-9b46775ecfd4；迁移前备份文件保留在 ~/.dsh/ldvh/ 下且可由文件名追溯；该条其余 13 个字段与迁移前逐字一致（字段闭集共 14 项）；写后精确回读该条并断言与目标逐字一致，回读不符即 fail-closed 并登记；迁移脚本内可见本单 object_uid、批准时刻与 authorization_fingerprint
    step: 在步骤 1、2 落地且本单获 Gate 1 批准后，把缓冲条目 648749cd 的 target_uid 一次性改正
  - done_criteria: 真实账目侧——账目 6c6ea207 的 occurrence.count 由 7 增至 8、last_at 更新、现象段新增一条含该条 evidence 逐字引证与来源的观察，写后精确回读通过（按 02 §10 受控写入）；该补充必须由一次受控的审核运行产生（使其在同一次运行内按 §12bis.1 结算段把该缓冲条目整条移除），不得以直调 supplementOccurrence 代替——后者会留下仍为 pending 的条目，下一轮再补一次、count 由 8 变 9，形成新的重复计数。全链路侧——在夹具副本上调用 runFrictionReviewPromotion（复用 friction-review-promotion.test.mjs 的 home(root)／factRoot(root) 夹具），一次调用即可同时观察到副本账目 occurrence.count 递增 1 与副本缓冲条目被整条移除（因该函数在补充成功后调用 settleSupplementedEntries）。如实声明：直调 supplementOccurrence 不结算条目，故「两条断言由同一次调用同时成立」只对夹具侧的 runFrictionReviewPromotion 成立，对真实载体与直调路径不成立
    step: 把该次观察补充到真实账目，并在夹具副本上验证「补充→结算」全链路
  - done_criteria: §12bis.1 的「写入后回读」段写明 target_uid 须解析到已存在账目、解析失败即拒绝；写入者条款或「结算」段写明补充失败的登记义务；新增一条「经授权的条目字段差错更正」条款，且限定为逐实例授权（每次改写须有独立 Human 授权、写明授权形态、限定载体、留痕要求；不得写成对「追加＋状态结算」的常设例外），以维持「不归第 4 项」为真；可解析性校验与字段表 target_uid 行的既有约束指回衔接而非并列新增。§19.1 新增归口记录：写明归第 3 项（入口校验＝机械校验范围收紧；补充失败入队＝新增 fail-closed 失败处置），写明显式「不归第 2 项」（§6.2 派发准入未动）与「不归第 4 项」（动作成员与字段闭集未动），并写明「一次性存量改正不属任何归口项，它是第 3 项修订的执行后果」。验收方式为逐行回读 §12bis.1 与 §19.1 正文，确认无与实现相反的表述
    step: 同步修订 specs/11 §12bis.1 与 §19.1 归口登记
pre_reviews:
  - at: 2026-11-03T17:19:16.262Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 【概要】本单三处缺口属实：friction-transfer.js:137 对 target_uid 只做非空 trim，发现层（friction-landing.js:231、subagent-contract.js:457）才有解析校验；缓冲条目 648749cd 的 target_uid 确为 6c6ea207-da7d（真实 da9d），group 为 reply-duplicate-restatement，字段闭集 14 项故「其余 13 项」正确；friction-review-promotion.js:130 补充失败只 residual.push、无 pending-queue 导入；buffer.js:1016 确将带 target_uid 的条目排除在阈值聚合外；50 条环形内该失败 8 次（6 landed/1 land-failed/1 skipped）成立，跨度实为 12:20:10Z–17:08:31Z，未核查登记现为 132 条。须修：步骤 5 直调 supplementOccurrence 不结算缓冲条目，「条目被整条移除」无法由该调用判定，真实账目计数递增亦未获 scope 授权；scope 未写「批准前不就地改写」；§19.1 第 4 项归口缺触发说明、存量改正不属任何归口项，步骤 4 宜补「条目差错更正」条款。
    session_id: a8b35308-7ed7-49fd-ae7c-e4a7c5e53ce0
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: 8c69d649df75582258f539787b9ad1f627fc8ac3652e076764a0b968c1dcf53a
    covered_partitions:
      - id: plan#1
        fingerprint: 6a6e38cd09d02be499e5811e6d94b78867698bc53c19d0a7c11ff346a03d5695
      - id: plan#2
        fingerprint: 2996110274a57f22112f87916bc29d7fb233e6f206bb1b2f26f4601149b16858
      - id: plan#3
        fingerprint: 22c6db7c70f2d603d1fe310b260b38ffb98d2a973d140b1f6f5a1498271e38a5
      - id: plan#4
        fingerprint: 1745ef5bcd4c747321d251427d6090f810291c540df350c4999ffec0de1f3d17
      - id: plan#5
        fingerprint: 1be726266b68f83480711f9ce9032672d8ad9b9f87c2c60d38116c7ffa7d8370
      - id: scope:做什么#1
        fingerprint: 96e71ec05fc23f324b25660e6e58939cdc678e0c26c011641a5efcbcf2f69c4d
      - id: scope:做什么#2
        fingerprint: c331510801c6b34d455655636786dd5bfab6734ae5affd99494b6acbaecb5bf8
      - id: scope:做什么#3
        fingerprint: 3d383a7b2393c15b0220076ee7a6be779e4220bebe20c01657c4ab3eef3ae0d7
      - id: scope:做什么#4
        fingerprint: 26322f22ecdfd8f27508ab0b8d7067ce99d4ab74cf2e45b3e8b03bbbabefbce9
      - id: scope:做什么#5
        fingerprint: 4206a6c9ff64396d0fa2865de98d698863653e2439b62edccfe17b613b7a6265
      - id: scope:做什么#6
        fingerprint: 211cd0a79e78ab1dec3058fcfe1a751280fc15c415c16ec50013aeda3078cf81
      - id: scope:明确不做什么#1
        fingerprint: cbd0f8dec7f4c01f12c015b7905bcd581914b1c436d24d6e2a455d2510b4fc1c
      - id: scope:明确不做什么#2
        fingerprint: 7266338ae3e7d2000b6c785e5e79e21d92f1661b32690956b5cb5e610e31968e
      - id: scope:明确不做什么#3
        fingerprint: 296f4c497c0757e4b064ba8831d92123866c74b16dc075473f1d7fe796aa10fd
      - id: scope:明确不做什么#4
        fingerprint: d5e24f92f4c15d70287a0b2a651f69020ca48739fbb5cb0b19156964326a831b
      - id: scope:明确不做什么#5
        fingerprint: caaf51c4c5fa2a1c59d406dcc4d6f55c4abc06dbbefa39078ab6afe4db355cac
      - id: scope:明确不做什么#6
        fingerprint: 64e1a4883acc106a634541493c0cae699feda8324467fe13e4599820c2b995a2
      - id: scope:明确不做什么#7
        fingerprint: 56ca7d8a83711d934c63068e4d80231f7fce22eb10d37c4743010f37a5f44938
    round_index: 1
    verdict: needs_revision
  - at: 2026-11-03T17:54:17.792Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 第 2 轮建前审核判 pass，无阻断，可进 Gate 1。五项驳回逐条复核：步骤 5 拆为真实账目侧与夹具全链路侧后可判定——runFrictionReviewPromotion 在补充成功后调用未导出的 settleSupplementedEntries，故夹具侧一次调用即可同时观察 count+1 与条目整条移除，「不能同调成立」的声明只对真实载体成立，属实；scope 已写明受控写入与「批准前不得就地改写」，可作越权拒绝基准；§19.1 归第 3 项及不归第 2 项成立。实测：未核查 132（76／56），与该失败相关 0 条；环形 50 条中该失败 8 条（6 landed／1 land-failed／1 skipped，12:37:21.521Z–17:06:48.814Z，message distinct=1）；签名确无 factSourceRoot 而调用点有值；settle 未导出、registerTransferFailure 未导出、pending-queue 仅依内置模块无环；真账目 count=7、条目 14 字段；GATE 五步全 clean。建议：引文实指 §12bis.1:603／656，原句在 11:563 属经验缓冲；跨度已漂为 12:34:57–17:29:13 须带时点；步骤 4 宜写明真实补充由审核运行产生。
    session_id: 569f3852-6abd-4c4a-8454-d93e92813a8e
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: 3de394c2bbee2781a7c337f115bc8cbc639ab9ec247f416df2c067aa0e1235ef
    covered_partitions:
      - id: plan#1
        fingerprint: 15749ed861fd43f787997eee2a8f3e51e318a23bb734a36db38b836bdc13cde3
      - id: plan#2
        fingerprint: ff1e77a697ddacf53453ae972cafcb109cd314b5098631eb3e8b4cf39a47ef2b
      - id: plan#3
        fingerprint: a3e0ab29d00144db169378240e55608f6f8836d9d47154c5b325e92955f31058
      - id: plan#4
        fingerprint: 5f76dace0a8569499c453f4c47d6172560818d6cef2081895b3b174c9ba6690a
      - id: plan#5
        fingerprint: 4b66681afa359cc5d7cdea32912c66ec2e7905345483bc1bb334e44fe4732df3
      - id: scope:做什么#1
        fingerprint: e8162314949e902f0983c50f75d9267971e35e75333370ab343b95a8a35dbc6c
      - id: scope:做什么#2
        fingerprint: 86d4bf5f340066a0d1e70c655e2f924d7976d40ee4266be96719485820332ee1
      - id: scope:做什么#3
        fingerprint: b900c80e4e8f63f0911f40cf4a20a3b825481a257a6eeeb1e60f3c225432938a
      - id: scope:做什么#4
        fingerprint: 2c7cfd18309e9f17a64fce9b12891733b0fac2b207972c574a280029561475be
      - id: scope:做什么#5
        fingerprint: f4250818091465d7e9ad0440377b6189978c239b1757be62225288eabc3017d5
      - id: scope:做什么#6
        fingerprint: a2d449aad68d6afad39512f2e6d637292bc8ff00cd889c9a9cfc82d539addece
      - id: scope:做什么#7
        fingerprint: 211cd0a79e78ab1dec3058fcfe1a751280fc15c415c16ec50013aeda3078cf81
      - id: scope:明确不做什么#1
        fingerprint: cbd0f8dec7f4c01f12c015b7905bcd581914b1c436d24d6e2a455d2510b4fc1c
      - id: scope:明确不做什么#2
        fingerprint: 7266338ae3e7d2000b6c785e5e79e21d92f1661b32690956b5cb5e610e31968e
      - id: scope:明确不做什么#3
        fingerprint: ee5f7d03ffe7848e4c26f3be8d158c7b1f070526b15d5584ab06af6773cd0805
      - id: scope:明确不做什么#4
        fingerprint: 296f4c497c0757e4b064ba8831d92123866c74b16dc075473f1d7fe796aa10fd
      - id: scope:明确不做什么#5
        fingerprint: 4490649ceda706732af11ca7c006255b136462e985c93c47c6d83dfb73ec0e01
      - id: scope:明确不做什么#6
        fingerprint: caaf51c4c5fa2a1c59d406dcc4d6f55c4abc06dbbefa39078ab6afe4db355cac
      - id: scope:明确不做什么#7
        fingerprint: 64e1a4883acc106a634541493c0cae699feda8324467fe13e4599820c2b995a2
      - id: scope:明确不做什么#8
        fingerprint: 56ca7d8a83711d934c63068e4d80231f7fce22eb10d37c4743010f37a5f44938
    round_index: 2
    verdict: pass
  - at: 2026-11-03T18:05:24.784Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 第 3 轮建前审核判 pass。四处改动核实无阻断：plan#2 明写「上提共享模块、全仓仅一处定义」，无歧义；plan#4 的论断成立——实测 runFrictionReviewPromotion 已导出（:68）、在补充成功后调用未导出的 settleSupplementedEntries（:146），而 supplementOccurrence（friction-discovery.js:255）只写账目、不结算缓冲，故直调会留下 pending 条目、下一轮按 target_uid 再补一次（7→8→9），重复计数属实；plan#5 的逐实例授权限定保住了「不归第 4 项」（第 4 项管动作成员与机械通道范围，逐实例授权不新增可自动动作，字段闭集与阈值未动）；scope:做什么#5 与 plan#4 一致。引文实测准确：§12bis.1:603 确为「追加＋状态结算」，:656 确含「其余字段不可改」。仅建议级：窗口漂移使 8 条构成（现 5 landed/1 land-failed/2 skipped）与首末时点、未核查 132（现 133＝77/56）过期；plan#4 末句「对真实载体不成立」宜改为「只能在夹具侧一次调用验证」；建议运行前确认缓冲内仅 648749cd 带 target_uid 且无达阈值组。
    session_id: 098657a3-d07d-4107-b7d3-bba4034cf68e
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: 4994d9cbbcc6d7492155b269fcfb30338996c2065cc41389899f066f25c97a22
    covered_partitions:
      - id: plan#1
        fingerprint: 15749ed861fd43f787997eee2a8f3e51e318a23bb734a36db38b836bdc13cde3
      - id: plan#2
        fingerprint: 706c6a1855cc2ac422b2e6725944be941e9a4a036d033e4596e48d98bab4d5fd
      - id: plan#3
        fingerprint: a3e0ab29d00144db169378240e55608f6f8836d9d47154c5b325e92955f31058
      - id: plan#4
        fingerprint: 165035382602887548d4e8e298eaab617b44cfa8cff792b43ce6342efb3f9397
      - id: plan#5
        fingerprint: a6df041c9fb3f4945b8d1b4de39d530dea8f6cf1c4fc2fafcad159de196947a2
      - id: scope:做什么#1
        fingerprint: e8162314949e902f0983c50f75d9267971e35e75333370ab343b95a8a35dbc6c
      - id: scope:做什么#2
        fingerprint: 86d4bf5f340066a0d1e70c655e2f924d7976d40ee4266be96719485820332ee1
      - id: scope:做什么#3
        fingerprint: b900c80e4e8f63f0911f40cf4a20a3b825481a257a6eeeb1e60f3c225432938a
      - id: scope:做什么#4
        fingerprint: 2c7cfd18309e9f17a64fce9b12891733b0fac2b207972c574a280029561475be
      - id: scope:做什么#5
        fingerprint: 91a6385a8373184ff459a7bcff505e330f3b4f602aa5971ec3bb0bc8a77b1144
      - id: scope:做什么#6
        fingerprint: a2d449aad68d6afad39512f2e6d637292bc8ff00cd889c9a9cfc82d539addece
      - id: scope:做什么#7
        fingerprint: 211cd0a79e78ab1dec3058fcfe1a751280fc15c415c16ec50013aeda3078cf81
      - id: scope:明确不做什么#1
        fingerprint: cbd0f8dec7f4c01f12c015b7905bcd581914b1c436d24d6e2a455d2510b4fc1c
      - id: scope:明确不做什么#2
        fingerprint: 7266338ae3e7d2000b6c785e5e79e21d92f1661b32690956b5cb5e610e31968e
      - id: scope:明确不做什么#3
        fingerprint: ee5f7d03ffe7848e4c26f3be8d158c7b1f070526b15d5584ab06af6773cd0805
      - id: scope:明确不做什么#4
        fingerprint: 296f4c497c0757e4b064ba8831d92123866c74b16dc075473f1d7fe796aa10fd
      - id: scope:明确不做什么#5
        fingerprint: 4490649ceda706732af11ca7c006255b136462e985c93c47c6d83dfb73ec0e01
      - id: scope:明确不做什么#6
        fingerprint: caaf51c4c5fa2a1c59d406dcc4d6f55c4abc06dbbefa39078ab6afe4db355cac
      - id: scope:明确不做什么#7
        fingerprint: 64e1a4883acc106a634541493c0cae699feda8324467fe13e4599820c2b995a2
      - id: scope:明确不做什么#8
        fingerprint: 56ca7d8a83711d934c63068e4d80231f7fce22eb10d37c4743010f37a5f44938
    round_index: 3
    verdict: pass
gate_1:
  approved_at: 2026-11-03T21:06:13.458Z
  approver: 老丁（Human，本会话 2026-11-04 指令「好，推进吧」）
  authorization_fingerprint: 4994d9cbbcc6d7492155b269fcfb30338996c2065cc41389899f066f25c97a22
  scope_snapshot: |-
    做什么：
    - 转写入口对 target_uid 增加解析校验：给 `transferDiscardedEntryToFriction` 增加 `factSourceRoot` 形参，非空 `target_uid` 须解析到已存在账目，失败即拒绝并返回 `friction_transfer/target_uid_unresolvable`，且不写入缓冲
    - 把 `registerTransferFailure` 上提为共享模块，使转写失败与补充失败走同一实现（不复制第二份）
    - 补充级更新的失败登记进待处置队列，与转写失败同形（含队列不可写时的 `unregistered`／`unregistered_message`，不得吞掉）
    - 在 Human 批准本单（Gate 1）后，把缓冲条目 648749cd 的 target_uid 一次性改正为 `6c6ea207-da9d-4527-957a-9b46775ecfd4`，**批准前不得就地改写**；迁移前备份，迁移后精确回读
    - 把该次补充落到真实账目 `6c6ea207` 上（按 02 §10 的受控写入要求：走受控入口、写后精确回读、失败 fail-closed），使 `occurrence.count` 递增 1 且现象段新增一条带逐字引证的观察；该补充须由一次受控的审核运行产生，使其在同一次运行内把该缓冲条目结算移除
    - 同步修订 specs/11 §12bis.1（新增可解析性校验、补充失败登记、经授权的字段差错更正三处）与 §19.1 归口登记
    - 为上述各项补测试，并使既有摩擦与转写相关测试全绿

    明确不做什么：
    - 不实现机械审核门 verifyRun，不改 `idle-runlog.js` 的 stage 语义，不改 §18
    - 不改变 §9／§10 自动动作闭集的成员，不改变阈值 N、缓冲容量与保留期
    - 不改 §12bis.1 的字段闭集（本单只增校验义务与登记义务，不增删字段）
    - 不改变任何既有账目的 `status`；不批量处置其它 pending 缓冲条目
    - 不清理、不删除既有待处置队列登记，也不为历史 132 条未核查登记补写 `resolved_at`
    - 不改动 Web 呈现层，不动 DSH 官方包
    - 不修订 specs/ 其它章节
    - 整文件批量改写只允许出现在两个具名载体：`~/.dsh/ldvh/friction-observations/dsh-ldvh.jsonl`（仅限 648749cd 一条的 target_uid）与 `pending-queue.jsonl`（仅限追加）
reviews:
  - at: 2026-11-03T21:52:22.303Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: ae087bbb-f3b9-4048-80db-c15ca96dbca0
    session_source: host
    implementer_session_id: session-380a02f5-68d0-41d4-a111-94c78850cc03
    implementer_session_source: host
    reviewer_origin: subagent
    summary: 复核对象：workcase-feb5b7cf（摩擦补充路径校验与存量改正）。基线：锁定提交 400058d，plugin/ 无未提交改动，ldvh-base 的闲时产出不计。方法：逐条读码并实测，不采信主控自述——转写闸三情形各跑一次，另做四项变异（去可解析校验、去缺参拒绝、去补充失败登记、把结算条件改恒假），每项改完即还原；存量条目与备份逐字段比对；以改动前的基线 worktree 复现唯一失败用例。覆盖：步骤 1 三例、步骤 2 两例与全链路夹具、步骤 3 备份与精确回读、步骤 5 的 §12bis.1 三处与 §19.1 归口，均已实测。未覆盖：步骤 4 的真实账目侧（须由一次受控审核运行产生，受宿主静置计时器限制本单未发生），以及「队列不可写」分支虽有实现但用例为空断言、变异仍全绿。发现：三处缺口确已修复，登记实现全仓唯一且两失败面共用，存量仅 target_uid 一字段变更、条数不变，四项变异全部转红；全量 2922 项仅一条失败，经基线复现与本单无关；缺陷三处——步骤 4 真实侧未交付、§19.1 首句把存量改正并入第 3 项（与计划要求的「不属任何归口项」相反）、补充失败登记落在 §10.2 而非授权的 §12bis.1。保证边界：结论只覆盖 400058d 已提交内容与本机当前载体状态，不覆盖宿主静置触发的真实补充，也不覆盖历史 132 条未核查登记。
  - at: 2026-11-03T22:00:55.554Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: 019c327e-f157-4db7-8fcd-50592edf56af
    session_source: host
    implementer_session_id: session-380a02f5-68d0-41d4-a111-94c78850cc03
    implementer_session_source: host
    reviewer_origin: subagent
    summary: 已完成第二轮独立复核并把结果发给父会话。
  - at: 2026-11-03T22:10:09.645Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: 37122f6a-6881-406a-b457-b99358c7cba5
    session_source: host
    implementer_session_id: session-380a02f5-68d0-41d4-a111-94c78850cc03
    implementer_session_source: host
    reviewer_origin: subagent
    summary: "复核对象：workcase-feb5b7cf 摩擦补充路径校验与存量改正，第三轮 Gate 2 前复核。基线：9adc303，plugin/ 与 specs/ 无未提交改动，闲时产出不计。方法：实读规范与实现并自行变异实测，不采信前两轮自述。覆盖：§19.1 已写「一次性存量改正不属任何归口项」、标题无「与存量改正」；补充失败登记正文落在 §12bis.1（行 658，节界 602–688），§10.2 行 419 只剩指针；两变异——删 unregistered、删 unregistered_message——各自仅使「队列不可写」用例转红，还原后基线全绿，正控制有效；§12bis.1 三处条款与实现逐条相符，差错更正限定逐实例 Human 授权、非常设例外；改动仅 specs/11 与插件六文件，无越权。未覆盖：步骤 4 真实账目侧尚未发生。发现：条目 648749cd 仍 pending，账目 6c6ea207 的 count 已为 8，7→8 那次属另一条观察，故计划判据过期、实际应为 8→9，结案须改记该判据；以 partial 关闭恰当。全量两次均 2920 通过、1 失败（L0 三段 pitfall 49/50，改动前既有，与本单无关）。保证边界：覆盖 9adc303 已提交内容与本机载体状态，不覆盖宿主静置触发的真实补充与未核查历史登记。verdict: pass"
result:
  criteria_checks:
    - evidence: 签名含 factSourceRoot 且由 observation-review.js:854 传入；解析不到返回 friction_transfer/target_uid_unresolvable 且缓冲条目数不变。三例测试（缺参拒绝／解析不到拒绝／真实账目放行）。变异：去校验 2 红、去缺参拒绝 1 红。
      satisfied: true
    - evidence: registerTransferFailure 全仓仅 1 处定义（friction-failure-registration.js:105），observation-review.js:828/871 与 friction-review-promotion.js:145 共用。补充失败登记带 pending_entry_id（用例断言）；队列不可写时带 unregistered + unregistered_message（重写用例，变异删任一赋值均转红）。
      satisfied: true
    - evidence: target_uid 等于 6c6ea207-da9d-4527-957a-9b46775ecfd4；备份 dsh-ldvh.jsonl.bak-before-target-uid-fix-20261104-051651 在位；与备份逐字段比对确认 85 条不变、其余 13 字段逐字一致；改后精确回读通过。
      satisfied: true
    - evidence: 全链路侧成立（夹具上 runFrictionReviewPromotion 一次调用同时断言 count 递增、last_at 更新、条目整条移除、逐字引证进正文；变异 2 红）。真实账目侧未发生：条目 648749cd 仍 pending、账目 count 仍 8；判据「7→8」经第三轮复核实测已过期（该次递增属另一条观察），本条应为 8→9。
      satisfied: false
    - evidence: §12bis.1 三处：可解析性校验（行 658 前的写入后回读段）、补充失败登记义务（行 658）、经授权的条目字段差错更正（非第四类、非线性许可）。§19.1 归第 3 项、明写不归第 2 项与第 4 项、并写「一次性存量改正不属任何归口项」。逐行回读确认无与实现相反的表述。
      satisfied: true
  achieved_scope: 步骤 1、2、3、5 完整交付：转写入口 target_uid 可解析性校验、两失败面共用同一登记实现、存量条目 648749cd 的 target_uid 改正、specs/11 §12bis.1 三处条款与 §19.1 归口。全部经三轮独立复核，两项关键变异经复核者独立重做确认。
  residual:
    - 真实账目侧的那次补充未发生：缓冲条目 648749cd 仍 pending，未被任何受控审核运行补充进账目 6c6ea207，也未在同次运行内结算移除
    - 该次补充须由宿主静置计时器驱动的一次受控审核运行产生，而计时器的武装点是 session/event turn/end，故只能跨回合完成，无法在对话内驱动
    - 计划判据「count 由 7 增至 8」已过期：该账目现为 8，但那次递增的内容是另一条观察（正文引证「宿主只发布事件、不回放」），与本条 evidence 不同，故本条若被补充应为 8→9
    - 未采用直调 supplementOccurrence 补齐：它只写账目、不结算缓冲，直调后条目仍 pending，下一轮再补一次即重复计数，正是本单要消除的形态
    - 第二轮的复核记录仅 20 字符（系统捕获到复核者的收尾语而非七要素正文），该轮判 pass 的实质结论只存在于会话记录与第三轮复核的交叉验证中
    - 待下一次受控审核运行把 648749cd 补进账目（count 8→9）并整条结算移除后，本单的步骤 4 才算真正交付，届时可补记 completed
outcome: partial
refs:
  - object_uid: 451c4a7d-a14f-4e2f-af1c-9911d3c80fd6
created_at: 2026-11-03T17:11:54.034Z
change_log:
  - at: 2026-11-03T17:11:54.034Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-11-03T17:19:16.262Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "建前独立审核第 1 轮：needs_revision（记录五处须修，含步骤 5 的实质阻断） [pre-gate1 audit recorded by session a8b35308-7ed7-49fd-ae7c-e4a7c5e53ce0; verdict: needs_revision; round: 1/3; covered: 18/18 partition(s); candidate_fingerprint: 8c69d649df75…; pre_reviews entries: 1; 记录自子代理会话 a8b35308-7ed7-49fd-ae7c-e4a7c5e53ce0 的最终产出（Code 捕获）]"
  - at: 2026-11-03T17:22:24.934Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按第 1 轮审核五项修订：步骤拆为真实账目补充与夹具全链路两条判据、scope 补受控写入与「批准前不得就地改写」、§12bis.1 增「经授权的字段差错更正」条款、§19.1 补第 4 项归口与存量改正定性、订正三处事实元数据
  - at: 2026-11-03T17:54:17.792Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "建前独立审核第 2 轮：pass（五项驳回已处置，附三条建议） [pre-gate1 audit recorded by session 569f3852-6abd-4c4a-8454-d93e92813a8e; verdict: pass; round: 2/3; covered: 20/20 partition(s); candidate_fingerprint: 3de394c2bbee…; pre_reviews entries: 2; 记录自子代理会话 569f3852-6abd-4c4a-8454-d93e92813a8e 的最终产出（Code 捕获）]"
  - at: 2026-11-03T17:55:27.055Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按第 2 轮三条建议修订：引文改指 §12bis.1:603/656（原 11:563 属经验缓冲）、去掉会漂移的固定时间跨度改为只记下限、步骤 4 要求真实补充由审核运行产生以避免重复计数、步骤 5 的差错更正条款限定为逐实例授权
  - at: 2026-11-03T18:05:24.784Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "建前独立审核第 3 轮（针对改动后候选）：pass（四处改动均无阻断，附建议级漂移提示） [pre-gate1 audit recorded by session 098657a3-d07d-4107-b7d3-bba4034cf68e; verdict: pass; round: 3/3; covered: 20/20 partition(s); candidate_fingerprint: 4994d9cbbcc6…; pre_reviews entries: 3; 记录自子代理会话 098657a3-d07d-4107-b7d3-bba4034cf68e 的最终产出（Code 捕获）]"
  - at: 2026-11-03T21:06:13.459Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 1 批准：建前审核三轮用满（第 2、3 轮 pass，20/20 分区覆盖），批准范围为修摩擦补充路径三处缺口与存量改正 [gate_1 approved by 老丁（Human，本会话 2026-11-04 指令「好，推进吧」）; attempt 1 allocated to 主控（本会话 session-372f10f2）]
  - at: 2026-11-03T21:26:01.136Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 执行记录：步骤 1、2、3、5 已完成，步骤 4 全链路侧完成；真实账目侧的判据数值（count 7→8）因闲时任务已先行补充而不可复现，须由一次受控审核运行产生，当前仅能由宿主静置触发；gist 同步为进展描述 [attempt 1 heartbeat refreshed]
  - at: 2026-11-03T21:35:50.771Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补记步骤 4 阻塞点的机制：计时器武装点是 turn/end，故本回合未结束前计时器恒为清掉状态，该步只能跨回合完成；并记录步骤 5 自设验收（规范与实现逐条核对）已执行 [attempt 1 heartbeat refreshed]
  - at: 2026-11-03T21:52:22.304Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录 Gate 2 第一轮独立复核（needs_fix）：机制侧三处修复成立且变异全红，但三处未闭环——步骤4真实侧未交付、§19.1 把存量改正并入第3项（与计划相反）、补充失败登记落在 §10.2 而非授权的 §12bis.1；另「队列不可写」分支用例为空断言 [review recorded by session ae087bbb-f3b9-4048-80db-c15ca96dbca0; reviews entries: 1; 记录自子代理会话 ae087bbb-f3b9-4048-80db-c15ca96dbca0 的最终产出（Code 捕获）]"
  - at: 2026-11-03T22:00:55.554Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录 Gate 2 第二轮独立复核（pass，采用复核者捕获的结论原文）：三处缺陷全部闭合，两项变异独立转红；步骤 4 真实账目侧未交付属机制性缺口，判 pass 但结案记 partial [review recorded by session 019c327e-f157-4db7-8fcd-50592edf56af; reviews entries: 2; 记录自子代理会话 019c327e-f157-4db7-8fcd-50592edf56af 的最终产出（Code 捕获）]"
  - at: 2026-11-03T22:10:09.645Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录第三轮独立复核（pass）：三处缺陷闭合经独立变异实测确认，规范与实现逐条相符，无越权；步骤 4 真实账目侧未发生，判据 7→8 已过期（实际应为 8→9），以 partial 关闭恰当 [review recorded by session 37122f6a-6881-406a-b457-b99358c7cba5; reviews entries: 3; 记录自子代理会话 37122f6a-6881-406a-b457-b99358c7cba5 的最终产出（Code 捕获）]"
  - at: 2026-11-03T22:11:43.588Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 提交 Gate 2 关闭提案（结果节）：四步完整交付、步骤 4 仅全链路侧完成；真实账目侧须跨回合受控审核运行触发，且判据 7→8 经第三轮复核实测已过期（该次递增属另一条观察，本条应为 8→9） [attempt 1 heartbeat refreshed]
  - at: 2026-11-03T22:57:06.924Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 2 关闭：Human 批准关闭（2026-11-04「批准关闭」）。结案 partial——步骤 1/2/3/5 完整交付并经三轮独立复核，步骤 4 仅全链路侧完成、真实账目侧待宿主跨回合触发的受控审核运行 [gate_2 closed with outcome=partial; attempt 1 retracted]
---

# 摩擦补充路径校验与存量改正

## 摘要

本单修掉摩擦补充路径的三处缺口，并改正一条因编号抄错而永久卡死的存量缓冲条目。本单由 workcase-6588d816 拆分而来——原候选把「完成门禁」与这三处缺口合成一单，建前独立审核判定该合并与实测相反，两者可独立授权、独立关闭，故拆为两单；本单只承担补充路径与存量改正。

### 现状核实
- **唯一未校验的入口**：`friction-transfer.js:137` 的 `validateTransferProposal` 对 `target_uid` 只做 `isNonEmptyString(...).trim()`，不判它能否解析到已存在的账目。发现层是要校验的——`friction-landing.js:231` 先 `readFrictionObject` 并设状态闸，`friction-subagent-contract.js:457` 校验 uid 属于本次交付的候选（`friction-discovery-provider.js:471` 只是注释与参数传递处，不是校验点）。故转写入口确为唯一未校验入口。
- **结构上的印证**：`transferDiscardedEntryToFriction` 的签名 `{dshHomePath, projectId, entry, transfer, now}` 里**没有 `factSourceRoot`**，从结构上不可能解析账目——校验不是漏写，是缺一个入参。而唯一调用点 `observation-review.js:854` 所在的函数内已有 `factSourceRoot` 可用。
- **已实测的后果**：缓冲条目 `648749cd-9f69-4af9-bc0d-2fa5f5103f56` 的 `target_uid` 为 `6c6ea207-da7d-4527-957a-9b46775ecfd4`，真实账目为 `6c6ea207-da9d-4527-957a-9b46775ecfd4`，两字符之差。真实账目存在，`status: open`，`occurrence.count: 7`。
- **进入路径的判据**：该条目带 `title`/`basis`/`attribution` 三项（`same-obstacle` 态按 §12bis.1 字段表不涉及这三项），且 `evidence` 署名行是经验侧形态而非发现层的「（来源：turn N）」。故它经转写入口进入。**如实声明**：`group ≠ target_uid` 本身不构成证明——§12bis.1 对该态的 `group` 用「允许」取 uid 作占位键、非「必须」。
- **卡死的机制**：该条目带 `target_uid` 即被排除在阈值聚合之外（`friction-observation-buffer.js:1016`），既不能攒够 N 晋升、也不会被 `settleSupplementedEntries` 结算；每次经验审核运行都按该 uid 读账目，得到 `friction/object_not_found`（ENOENT），条目留在 `pending`，下一轮原样重试。
- **失败不进队列**：`friction-review-promotion.js:130-136` 的补充失败只 `residual.push` 后 `continue`；该文件 import 列表里**没有任何 pending-queue 导入**。对照 `observation-review.js:197-218` 的 `registerTransferFailure`——转写失败会入队并带 `pending_entry_id`，但该函数**未导出、模块私有**。两个失败面，只有一半有登记通道，且那一半在另一个模块里。
- **计数口径（如实登记）**：`idle-checkpoint-runs.json` 为 50 条环形（`idle-runlog.js:44`），窗口会随写入持续漂移。本次实测窗口内该失败出现 **8 条**记录（6 landed / 1 land-failed / 1 skipped，首 `12:37:21.521Z`、末 `17:06:48.814Z`，message 去重后 distinct=1）。**8 次是下限**——该条目 11:50 写入，早于环形窗口起点，更早的记录已被挤出；且「窗口内条数」本身随漂移变化，故只作下限用，不与任何固定时间跨度绑定。未核查登记现为 **132** 条（`friction-discovery` 76、`experience-capture` 56），与该失败相关 0 条。

### 处置方向
- **入口校验**：转写时 `target_uid` 非空须解析到已存在的账目（须给 `transferDiscardedEntryToFriction` 增加 `factSourceRoot` 形参并由调用方传入），解析失败即拒绝（`friction_transfer/target_uid_unresolvable`），并按转写失败同一通道登记入队。
- **失败入队**：`registerTransferFailure` 上提到共享模块（`pending-queue.js` 旁的独立小模块，该文件只依赖 Node 内置模块、不反向依赖摩擦侧，无循环风险），两个失败面共用同一实现，不复制第二份。
- **存量改正**：把该条目的 `target_uid` 改正为真实账目 uid。这是对**内容字段**的就地修改，而 §12bis.1 的契约形状（`:603`「追加＋状态结算」）与结算段（`:656`「其余字段不可改」）使内容字段的就地改写无据（另注：措辞相同的显式条文在 `specs/11:563`，属 §12bis 经验留痕缓冲，不直接管辖摩擦缓冲）。工单的批准**不等于修订规范**，故规范修订那一步必须补一条「经授权的条目字段差错更正」条款，否则实施后规范上无据、且该步自设的「无与实现相反的表述」验收会判不符。**替代方案如实列出**：也可把该条结算为 `discarded` 了事，代价是材料作废但无规范冲突——本单选改正并补条款。
- **顺序**：先修入口（前两步）再迁移存量。反过来会让今日起新抄错的条目继续落进缓冲，迁移完立刻又有新的。

### 边界
本单不实现机械审核门，不改 `idle-runlog.js` 的 stage 语义，也不改 §18。本单要修订 specs/11 §12bis.1（新增可解析性校验、补充失败登记、经授权的字段差错更正三处）与 §19.1 归口登记。

## 授权范围

做什么：
- 转写入口对 target_uid 增加解析校验：给 `transferDiscardedEntryToFriction` 增加 `factSourceRoot` 形参，非空 `target_uid` 须解析到已存在账目，失败即拒绝并返回 `friction_transfer/target_uid_unresolvable`，且不写入缓冲
- 把 `registerTransferFailure` 上提为共享模块，使转写失败与补充失败走同一实现（不复制第二份）
- 补充级更新的失败登记进待处置队列，与转写失败同形（含队列不可写时的 `unregistered`／`unregistered_message`，不得吞掉）
- 在 Human 批准本单（Gate 1）后，把缓冲条目 648749cd 的 target_uid 一次性改正为 `6c6ea207-da9d-4527-957a-9b46775ecfd4`，**批准前不得就地改写**；迁移前备份，迁移后精确回读
- 把该次补充落到真实账目 `6c6ea207` 上（按 02 §10 的受控写入要求：走受控入口、写后精确回读、失败 fail-closed），使 `occurrence.count` 递增 1 且现象段新增一条带逐字引证的观察；该补充须由一次受控的审核运行产生，使其在同一次运行内把该缓冲条目结算移除
- 同步修订 specs/11 §12bis.1（新增可解析性校验、补充失败登记、经授权的字段差错更正三处）与 §19.1 归口登记
- 为上述各项补测试，并使既有摩擦与转写相关测试全绿

明确不做什么：
- 不实现机械审核门 verifyRun，不改 `idle-runlog.js` 的 stage 语义，不改 §18
- 不改变 §9／§10 自动动作闭集的成员，不改变阈值 N、缓冲容量与保留期
- 不改 §12bis.1 的字段闭集（本单只增校验义务与登记义务，不增删字段）
- 不改变任何既有账目的 `status`；不批量处置其它 pending 缓冲条目
- 不清理、不删除既有待处置队列登记，也不为历史 132 条未核查登记补写 `resolved_at`
- 不改动 Web 呈现层，不动 DSH 官方包
- 不修订 specs/ 其它章节
- 整文件批量改写只允许出现在两个具名载体：`~/.dsh/ldvh/friction-observations/dsh-ldvh.jsonl`（仅限 648749cd 一条的 target_uid）与 `pending-queue.jsonl`（仅限追加）

## 计划

1. 转写入口对 target_uid 增加解析校验，失败即拒绝。完成判据：transferDiscardedEntryToFriction 签名含 factSourceRoot 且由调用方传入；target_uid 非空且解析不到已存在账目时返回 friction_transfer/target_uid_unresolvable，且缓冲条目数不变。有测试构造不存在的 uid（仿 friction-review-promotion.test.mjs 的 factRoot(root) 夹具，造一份真实账目文件）断言拒绝；另有测试断言合法 uid 仍正常写入
2. 把 registerTransferFailure 上提为共享模块，并补上补充失败的登记。完成判据：该函数从 observation-review.js 移出至共享模块并被两个调用点共用（全仓仅一处定义）；friction-review-promotion.js 的每条 supplement 失败都产生一条 pending-queue 登记并带 pending_entry_id；队列不可写时带 unregistered 且原因不被吞掉。有测试断言 1 条补充失败对应 1 条登记，登记内容含 entry_id 与 target_uid；另有测试断言转写失败路径行为不变
3. 在步骤 1、2 落地且本单获 Gate 1 批准后，把缓冲条目 648749cd 的 target_uid 一次性改正。完成判据：该条目的 target_uid 等于 6c6ea207-da9d-4527-957a-9b46775ecfd4；迁移前备份文件保留在 ~/.dsh/ldvh/ 下且可由文件名追溯；该条其余 13 个字段与迁移前逐字一致（字段闭集共 14 项）；写后精确回读该条并断言与目标逐字一致，回读不符即 fail-closed 并登记；迁移脚本内可见本单 object_uid、批准时刻与 authorization_fingerprint
4. 把该次观察补充到真实账目，并在夹具副本上验证「补充→结算」全链路。完成判据：真实账目侧——账目 6c6ea207 的 occurrence.count 由 7 增至 8、last_at 更新、现象段新增一条含该条 evidence 逐字引证与来源的观察，写后精确回读通过（按 02 §10 受控写入）；该补充必须由一次受控的审核运行产生（使其在同一次运行内按 §12bis.1 结算段把该缓冲条目整条移除），不得以直调 supplementOccurrence 代替——后者会留下仍为 pending 的条目，下一轮再补一次、count 由 8 变 9，形成新的重复计数。全链路侧——在夹具副本上调用 runFrictionReviewPromotion（复用 friction-review-promotion.test.mjs 的 home(root)／factRoot(root) 夹具），一次调用即可同时观察到副本账目 occurrence.count 递增 1 与副本缓冲条目被整条移除（因该函数在补充成功后调用 settleSupplementedEntries）。如实声明：直调 supplementOccurrence 不结算条目，故「两条断言由同一次调用同时成立」只对夹具侧的 runFrictionReviewPromotion 成立，对真实载体与直调路径不成立
5. 同步修订 specs/11 §12bis.1 与 §19.1 归口登记。完成判据：§12bis.1 的「写入后回读」段写明 target_uid 须解析到已存在账目、解析失败即拒绝；写入者条款或「结算」段写明补充失败的登记义务；新增一条「经授权的条目字段差错更正」条款，且限定为逐实例授权（每次改写须有独立 Human 授权、写明授权形态、限定载体、留痕要求；不得写成对「追加＋状态结算」的常设例外），以维持「不归第 4 项」为真；可解析性校验与字段表 target_uid 行的既有约束指回衔接而非并列新增。§19.1 新增归口记录：写明归第 3 项（入口校验＝机械校验范围收紧；补充失败入队＝新增 fail-closed 失败处置），写明显式「不归第 2 项」（§6.2 派发准入未动）与「不归第 4 项」（动作成员与字段闭集未动），并写明「一次性存量改正不属任何归口项，它是第 3 项修订的执行后果」。验收方式为逐行回读 §12bis.1 与 §19.1 正文，确认无与实现相反的表述

## 执行

- attempt 1 started at 2026-11-03T21:06:13.458Z (controller: 主控（本会话 session-372f10f2）)；Gate 1 授权范围见 gate_1.scope_snapshot。

### 计划步骤 1：转写入口 target_uid 可解析校验

`transferDiscardedEntryToFriction` 增加 `factSourceRoot` 形参；非空 `target_uid` 须经 `readFrictionObject` 解析成功，否则拒绝 `friction_transfer/target_uid_unresolvable` 且不写入缓冲。**缺 `factSourceRoot` 时同样拒绝**，不静默跳过校验。调用方 `observation-review.js:854` 已传入该值。

原有用例「用不存在的 target_uid 却断言写入成功」被新校验判红——那正是本单要消除的形态。已改为三例：缺参拒绝／解析不到拒绝／解析得到放行（正控制）。变异复验：不校验存在性 → 1 红；缺参静默跳过 → 1 红。

### 计划步骤 2：失败登记共用同一实现

新增 `plugin/lib/friction-failure-registration.js`，两处失败面共用 `registerFrictionFailure`；导出 `registerTransferFailure`（保持原措辞）与 `registerSupplementFailure`。`observation-review.js` 删掉私有副本改 import；`friction-review-promotion.js` 在补充失败分支调用登记，函数新增 `now` 形参。登记失败沿用原纪律写回 `unregistered`／`unregistered_message`。

**为什么不塞进 `pending-queue.js`**：那会让底层文件反过来知道摩擦侧的失败长什么样（task 名、residual 措辞），形成方向错误的知识下沉。单独薄模块使依赖方向保持：摩擦侧 → 登记 → 队列。

变异复验：去掉登记调用 → 1 红。过程中被仓库卫生测试抓到一次（新增文件未纳入版本控制），`git add` 后转绿。

### 计划步骤 3：存量条目 648749cd 的 target_uid 改正

**差错判定可独立复核**：旧值 `6c6ea207-da7d-…` 在账目中不存在，新值 `6c6ea207-da9d-…` 存在（`readFrictionObject` 分别返回 false／true）。

改前备份到 `~/.dsh/ldvh/friction-observations/dsh-ldvh.jsonl.bak-before-target-uid-fix-20261104-051651`；只改该条 `target_uid` 一项；改后精确回读确认新值生效、`status` 仍 `pending`；与备份逐字段比对确认 85 条不变、唯一差异是该字段。

**执行中先犯过一次判断错误（如实登记）**：曾据错误文件路径断言「该条目已不在缓冲、第③步前提消失」。真实载体是 `~/.dsh/ldvh/friction-observations/dsh-ldvh.jsonl`，条目一直都在。Human 要求先查清再决定，查出的结论是我错了。

### 计划步骤 4：补充到真实账目 + 夹具侧全链路

**全链路侧已完成**：夹具上用 `runFrictionReviewPromotion`（非直调）一次调用同时断言 count 7→8、`last_at` 更新、缓冲条目被整条移除、逐字引证进账目正文。变异：把结算条件改恒假 → 2 红。

**真实账目侧未完成**：须由一次受控审核运行产生。该运行由宿主静置计时器驱动，而计时器的武装点是 `session/event turn/end`（`triggers.js:46`）——只要回合未结束，计时器就处于被清掉的状态。实测：等 7.5 分钟期间无任何新诊断记录、条目未被消费。

### 计划步骤 5：规范修订与归口

§12bis.1 补三处；§19.1 新增归口记录。该步自设验收「逐行回读确认无与实现相反的表述」已执行：规范称「缺 `factSourceRoot` 同样拒绝」，实测该分支返回 `friction_transfer/target_uid_unresolvable`；规范称「解析不到即拒绝」，实测返回同一码。

## 结果

四步完整交付、一步部分交付。

### 逐条判据核对

- 计划步骤 1：达成——证据：签名含 factSourceRoot 且由 observation-review.js:854 传入；解析不到返回 friction_transfer/target_uid_unresolvable 且缓冲条目数不变。三例测试（缺参拒绝／解析不到拒绝／真实账目放行）。变异：去校验 2 红、去缺参拒绝 1 红。
- 计划步骤 2：达成——证据：registerTransferFailure 全仓仅 1 处定义（friction-failure-registration.js:105），observation-review.js:828/871 与 friction-review-promotion.js:145 共用；补充失败登记带 pending_entry_id；队列不可写时带 unregistered + unregistered_message（重写用例，变异删任一赋值均转红）。
- 计划步骤 3：达成——证据：target_uid 等于 6c6ea207-da9d-4527-957a-9b46775ecfd4；备份在位；与备份逐字段比对确认 85 条不变、其余 13 字段逐字一致；改后精确回读通过。
- 计划步骤 4：部分达成——证据：全链路侧成立（夹具上 runFrictionReviewPromotion 一次调用同时断言 count 递增、last_at 更新、条目整条移除、逐字引证进正文；变异 2 红）；真实账目侧未发生——条目 648749cd 仍 pending、账目 count 仍 8，且判据「7→8」经第三轮复核实测已过期（该次递增属另一条观察），本条应为 8→9。
- 计划步骤 5：达成——证据：§12bis.1 三处（可解析性校验、补充失败登记义务、经授权的条目字段差错更正且非第四类非线性许可）；§19.1 归第 3 项、明写不归第 2 项与第 4 项、并写「一次性存量改正不属任何归口项」；逐行回读确认无与实现相反的表述。

### 已完成的四步

**步骤 1（入口校验）**：`transferDiscardedEntryToFriction` 增加 `factSourceRoot` 形参，非空 `target_uid` 须解析到已存在账目，否则拒绝 `friction_transfer/target_uid_unresolvable` 且不写缓冲；缺 `factSourceRoot` 时同样拒绝，不静默跳过。

**步骤 2（共用登记）**：新增 `plugin/lib/friction-failure-registration.js`，两失败面共用同一实现，全仓仅一处定义；`observation-review.js` 的私有副本已删除；`friction-review-promotion.js` 的补充失败改为登记。

**步骤 3（存量改正）**：条目 `648749cd` 的 `target_uid` 由 `6c6ea207-da7d-…` 改为 `6c6ea207-da9d-…`。改前备份、改后精确回读、与备份逐字段比对确认 85 条不变、唯一差异是该字段。

**步骤 5（规范修订）**：§12bis.1 补三处（可解析性校验与执行面要求、补充失败登记义务、经授权的条目字段差错更正）；§19.1 归口：归第 3 项，明写「不归第 2 项」「不归第 4 项」，并写明「一次性存量改正不属任何归口项，它是第 3 项修订的执行后果」。

### 部分完成的步骤 4

**全链路侧已完成**：夹具上用 `runFrictionReviewPromotion` 一次调用同时断言 count 递增、`last_at` 更新、缓冲条目被整条移除、逐字引证进账目正文。

**真实账目侧未完成**，原因与代价如实登记：
- 该步须由**一次受控的审核运行**产生，使其在同一运行内完成补充与结算。
- 该运行由宿主静置计时器驱动，而计时器的武装点是 `session/event turn/end`（`triggers.js:46`）——只要回合未结束，计时器就处于被清掉的状态。实测：等 7.5 分钟期间无任何新诊断记录、条目未被消费。故它只能跨回合完成。
- **判据数值已过期**：计划写「count 由 7 增至 8」，但该账目现已是 8——第三轮复核实测确认，`7→8` 那次递增的内容是**另一条观察**（正文引证「宿主只发布事件、不回放」），与本条 `648749cd` 的 evidence 完全不同。故本条若被补充，应为 **8→9**。
- **未采用直调补齐**：`supplementOccurrence` 只写账目、不结算缓冲，直调后条目仍 `pending`，下一轮再补一次即重复计数——正是本单要消除的形态。

### 独立复核

三轮，均经 `reviewer_child_agent_id` 由隔离子代理回传：
- 第 1 轮 `needs_fix`：三处缺陷（§19.1 归口并入第 3 项、条款落在 §10.2 而非授权的 §12bis.1、队列不可写用例是空断言）。
- 第 2 轮：三处已闭合，两项变异独立转红。该轮结论文本未能合格入账（系统捕获到复核者的收尾语、非七要素正文），故其记录仅 20 字符。
- 第 3 轮 `pass`：独立重做两变异确认各自只使目标用例转红、正控制有效；条款落点、§19.1 表述、越权面逐项实测；并发现上述「判据数值已过期」这一新事实。

### 说明

本单以 `partial` 关闭：机制侧三处缺口已修并有变异钉住，规范与实现一致；步骤 4 的真实账目侧是一次**尚未发生的运行**，不是未修的问题——条目 `648749cd` 的 `target_uid` 已改正且可解析，下一次受控审核运行会把它补进账目（count 8→9）并在同次运行内结算移除。

- residual:
  - 真实账目侧的那次补充未发生：缓冲条目 648749cd 仍 pending，未被任何受控审核运行补充进账目 6c6ea207，也未在同次运行内结算移除
    - **接受现状**：等下一次受控审核运行自然消费它；该条目的 target_uid 已改正且可解析，届时会在同一次运行内完成补充与结算，无需人工介入
  - 该次补充须由宿主静置计时器驱动的一次受控审核运行产生，而计时器的武装点是 session/event turn/end，故只能跨回合完成，无法在对话内驱动
    - **接受现状**：这是机制约束不是缺陷；本单已查清并登记该武装点，后续同类判断可据此避免误判为「等几分钟即可」
  - 计划判据「count 由 7 增至 8」已过期：该账目现为 8，但那次递增的内容是另一条观察（正文引证「宿主只发布事件、不回放」），与本条 evidence 不同，故本条若被补充应为 8→9
    - **接受现状**：判据属一次性数值，已被真实数据的独立变化覆盖；本单按实测结果改记，不按原数值声明完成
  - 未采用直调 supplementOccurrence 补齐：它只写账目、不结算缓冲，直调后条目仍 pending，下一轮再补一次即重复计数，正是本单要消除的形态
    - **接受现状**：为凑判据而制造重复计数，与本单目标相悖；该取舍已在结果节写明，不视为可优化项
  - 第二轮的复核记录仅 20 字符（系统捕获到复核者的收尾语而非七要素正文），该轮判 pass 的实质结论只存在于会话记录与第三轮复核的交叉验证中
    - **接受现状**：record_review 只接受复核者实际被捕获的结论，改写即构成代述；该限制由机制决定，本单不用伪造文本绕过，改以第三轮的合格记录承载同一结论
  - 待下一次受控审核运行把 648749cd 补进账目（count 8→9）并整条结算移除后，本单的步骤 4 才算真正交付，届时可补记 completed
    - **接受现状**：本单以 partial 关闭即是对该未完成项的唯一如实表达；不另立工单跟踪，因为触发条件已明确且无需人为动作

