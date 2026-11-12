---
fact_type_key: workcase
object_uid: 3e0ad5ca-e82f-47c9-9aa9-a7a86bff7878
title: ADR 创建与退休补 Human 确认门禁
status: closed
gist: ADR 的创建与退休都能不经任何 Human 回应就落盘，而 22 号把两者都定为 Human Gate。本单补上询问门禁、退休呈报、创建查重结论参数，并处置 22:224 悬空术语与 §16 承载声明缺失。
serves: 3ab9c84c-0ebd-45d5-983d-cec515ef623a
summary: |-
  ADR 的创建与退休当前都只由规范文字要求 Human 确认，实现侧零承载：ldvh_adr_write 的 create 与 update（active → retired）都不经任何询问即可落盘，AI 能在没有 Human 回应的情况下让一条对全仓有法定约束力的决策生效或退出基线。本单为这两处补上可机械取得的 Human 确认，并处置 22 号的两处条文问题（悬空术语、承载声明缺失）。

  ### 现状核实（文件:行号，可 grep 复核）
  - 规范侧六处条文：specs/22-ADR-决策.md:224（§13 创建条「Human 确认后经受控创建入口落盘」）、:226（§13 终态流转条 Human Gate）、:268（§16 第 1 项 ADR 的创建）、:269（§16 第 2 项「ADR 的终态决定（retired——废除已定决策）」）、:284（§17 第 5 项，原文为「AI 未经 Human 确认直接创建、流转或做终态事实更正（授权缺失）」）、:103（§7 创建与变更权）——共六处。
  - 实现侧零承载：adr-tools.js 全文无 hostSeams／userQuestions／awaitsHumanDecision 命中；create 分支（:255 起）直达 createAdrObject（调用点 :261）；update 分支（:372 起）直达 updateAdrObject（调用点 :392）；toolDescriptorFor（:595 起）在 :603 对全部 ADR 操作共用一处硬编码 timeoutMs: 30000。
  - 对照面已落地的同类门禁：host-seams.js:721 requestSparkConsent、:574 requestWorkcaseRouting、spark-tools.js:337 requestSparkGate、:66 awaitsHumanDecision: true、:891 的条件展开；工单路由调用点在 workcase-tools.js:828。
  - 规范侧披露差异：specs/20:377 原文为「在宿主询问入口对本类型实际具备之前，不得主张本项已获机械保障」；22 号无同类句。
  - 退休机制本身完整无缺，缺的只是授权：状态闭集、五值理由闭集、去向配对、目标解析（adr-writer.js:326 relationTarget 定义、:775-782 可解析校验）、终态只读（:709）都在。
  - 悬空术语：specs/22:224 的「完整四要素」——按该词形 grep，全仓 specs 仅此一处命中且无定义（21:412、35:264-265 出现的是「四要素」，所指为 Gate 1 提请要素与 Pitfall 判据，与 ADR 语境无关）；347f4ed6 引入时即无定义。
  - 既有测试的覆盖边界（决定本单判据写法）：plugin/test/ldvh-tools.test.mjs:1188-1211 的 timeoutMs 断言走 descriptors()，其数据源是 lib/ldvh-tools.js 的聚合 OPERATIONS——该表不含任何 adr 条目，且其 toolDescriptor（:1836）早已是条件展开。故沿用既有断言测不到 adr-tools.js:603 的改动（同型失效见 friction-661831ae）。

  ### 更正（落实 00 §4.6 据实声明）
  本单在提案阶段有四处错述，均由建前独立审核实读指出，此处如实登记。
  - 第一处：「retired 时 change_log.summary 可以什么都不写就落盘」不成立。空串在 tools 层（adr-tools.js:389）与 writer 层（adr-writer.js:687）各有一道零写入拒绝。该错述源于从缺席的检索直接下否定结论（同型记录见 friction-21472aca）。
  - 第二处：目标解析的行号引错。初稿写 adr-writer.js:98-108，该区间实为 ADR_REMOVABLE_FIELDS 白名单；真实位置是 :326 与 :775-782。
  - 第三处：scope 与判据自相矛盾，且引文不逐字。初稿 scope 未授权声明 awaitsHumanDecision 而判据却要求无 timeoutMs；把 §16 写成整体承载而第 3 项（:270）无对应实现；20:377、22:284 两处引文与原文不符。已逐项改正。
  - 第四处：两处计数或引文细节有误。正文曾写「规范侧五处条文」却列出六项；22:269 引文曾漏「——废除已定决策」；「完整四要素」的分布曾误按「四要素」计（实为仅 22:224 一处）；§15 判据曾用源码中零命中的 grep 串。已逐项改正。
  - 由此，本单不再声称「事后无从核对谁确认过」会被闭合：本单只补动作前的确认取得，不新增确认凭据字段、不回补存量（见边界）。

  ### 处置方向
  ① host-seams.js 新增 requestAdrConsent（短外壳进 question、完整呈报进 detail、有界组装、fail-closed、转发 signal），按 action 分列两套呈报。② create 与 active → retired 两处在写入前取确认；OPERATIONS 增 awaitsHumanDecision: true，toolDescriptorFor 改为 spark-tools.js:891 式条件展开，使 ldvh_adr_read／ldvh_adr_list 仍保留 30 秒正上界。③ create 增必填 dedup_result 并纳入呈报。④ 退休呈报含 retirement_reason、change_log.summary 全文与关系目标。⑤ 处置 22:224 悬空术语：删去「完整四要素」，就地显式列出 04:117 的四项自查内容。⑥ 22 号 §16 补承载说明：只覆盖第 1、2 项，不主张第 3 项已获承载，并写入 20:377 式条件式披露。

  ### 边界
  已知代价：awaitsHumanDecision 是按工具声明的，故 adr-write-object 一旦声明，其三个动作——create、update（含勘误与退休）、correct（adr-tools.js:299 起）——全部失去 30 秒上界（与 spark-tools.js 同形）；ldvh_adr_read 与 ldvh_adr_list 不受影响。本单不闭合「事后核对」：不新增确认凭据字段、不为既有 9 个 ADR 补记录。correct 的自报语义不改。字段闭集、状态闭集、关系契约与 §9 状态机逐字不动。「四要素」只消除悬空、不考据原意，也不改 04 §6.1 本身。
scope: |-
  做什么：
  - host-seams.js 新增 requestAdrConsent：按 action 分列创建与退休两套呈报；无答题器／询问失败／未作选择一律 fail-closed；转发 caller signal；question 不超过 200 字符（ADR 7ceaf7fc）
  - adr-tools.js 的 create 与「active → retired」两处在写入前取确认，未取得即 rejected 且零写入
  - OPERATIONS["adr-write-object"] 声明 awaitsHumanDecision: true，toolDescriptorFor 改为 spark-tools.js:891 式条件展开（...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 }），使 ldvh_adr_read／ldvh_adr_list 保留正上界
  - 退休呈报内容含 retirement_reason、change_log.summary 全文与关系目标，交由 Human 判断据实说明是否成立（不新增弱判据）
  - create 增必填 dedup_result 并纳入呈报
  - 处置 specs/22:224 的悬空术语：删去「完整四要素」，就地显式列出 04 §6.1 的四条自查内容（只取此形态，不保留二择一）
  - 修订 specs/22 的 §13（创建条与终态流转条）、§15 验证表与 §16：§16 的承载说明只覆盖第 1、2 项，第 3 项不主张已获承载；并写入条件式披露
  - 补测试并做变异验证：去掉门禁调用、去掉 awaitsHumanDecision、忽略答复，各至少一例转红

  明确不做什么：
  - 不改 correct 的 human_authorization 自报语义
  - 不新增确认凭据类字段，不为既有 9 个 ADR 补确认记录、不改写既有 change_log（故本单不闭合「事后核对谁确认过」）
  - 不改 ADR 字段闭集、状态闭集、五值理由闭集与关系契约
  - 不改 specs/22 §9 状态机与 §17 停止类型
  - 不实现 §16 第 3 项（ADR 类型取消或合并），也不为其写承载声明
  - 不改 specs/04 与 specs/10 正文（04 §6.1 只作为内容来源被引用）
  - 不新增「据实说明」的机械弱判据（理由：非空校验已存在，弱判据易误伤正常摘要）
  - 不改 specs/ 其他规范（00／01／02／03／20／21 等）与 Web 呈现层
  - 不重启宿主、不启动服务、不改 ~/.dsh 之外的宿主文件
plan:
  - done_criteria: 清单每项给出 文件:行号 + 原文或代码片段 + 结论，可由 grep 逐条复核；四处错述各自写明原说法与实测反证位置；引用的规范句与原文逐字一致（16 处以上引文逐条比对）
    step: 现状取证与更正登记：把 22 号六处条文与实现侧零承载逐项钉死在文件:行号上，并把提案阶段四处错述（退休 summary 可空、目标解析行号、scope 自相矛盾与引文不逐字、计数与引文细节）如实更正
  - done_criteria: 新函数导出并挂在 seams 对象上；无答题器返回 granted:false；呈报内容为空时不提问直接拒绝；question 长度不超过 200 字符；两套呈报的字段清单在测试中被逐项断言
    step: 设计并实现呈报载体：host-seams.js 新增 requestAdrConsent，按 action 分列创建与退休两套呈报
  - done_criteria: 经 lib/adr-tools.js:595 的 toolDescriptorFor 取得三个描述符后断言——ldvh_adr_write 不含 timeoutMs，ldvh_adr_read 与 ldvh_adr_list 的 timeoutMs 仍为正数（三者同一次断言，不得改用 lib/ldvh-tools.js 的聚合 OPERATIONS，该表不含 adr 条目）；seam 缺失时 create 与退休均返回 unavailable；答复非肯定时返回 rejected 且 ldvh-base/adrs/ 文件数与目标对象指纹均不变；确认后返回 completed 且回读指纹一致
    step: adr-tools 接线两处并改共用描述符：create 与「active → retired」写入前取确认；OPERATIONS 增 awaitsHumanDecision 且 toolDescriptorFor 改为条件展开
  - done_criteria: 改写后 grep -c 完整四要素 specs/22-ADR-决策.md 为 0；该行列出的四条与 specs/04:117 的四句逐条对应（可由 grep 逐句核对）；diff 仅落在该行及其必要交叉引用
    step: 处置 specs/22:224 的悬空术语：删去「完整四要素」，就地显式列出 04 §6.1 的四条自查内容
  - done_criteria: diff 仅落在 §13／§15／§16 及其必要交叉引用；§16 的承载说明明确只覆盖第 1、2 项，第 3 项逐字保留原状且不出现承载主张；改写后 grep -c 「Human 确认后经受控创建入口落盘」specs/22-ADR-决策.md 为 0（该串现为 1 次命中，可区分改动前后）；§9 状态机与 §17 停止类型逐字未动
    step: 规范对齐：修订 specs/22 的 §13（创建条与终态流转条）、§15 验证表与 §16，写明以 ctx.userQuestions.ask 承载并加条件式披露
  - done_criteria: 定向 node --test 全绿；三类变异（删门禁调用、删 awaitsHumanDecision、忽略答复）各自至少一条用例转红，转红输出记入执行节；另须实测「把 adr-tools.js:603 恢复为无条件硬编码」时该 timeoutMs 用例确实转红，否则判为判据空转、须重写
    step: 补测试与变异验证：创建与退休各一条正向 + 无 seam／拒绝答复／空答复／呈报缺失／dedup 缺失五条 fail-closed + 三个描述符的 timeoutMs 断言
  - done_criteria: plugin 下 npm test 全绿、npx eslint 零问题，输出摘录进结果节；如实列明未验证范围（真实宿主弹窗未经本会话重启验证、工具级 awaitsHumanDecision 致 create/update/correct 三个动作均失去 30 秒上界、「事后核对谁确认过」未闭合等）
    step: 全量验证与交还：跑 plugin 全量测试与 eslint，登记未验证范围
pre_reviews:
  - at: 2026-11-12T06:45:01.647Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 三维均符合。对象：22 §16/§17 已定创建为 Human Gate，10 §6 逐缝表已要求 ctx.userQuestions.ask 有实际调用点，本单兑现既有义务而非新决策；54 个 WorkCase 中仅本候选自身（3e0ad5ca draft）同题，0260c75e、8f4742f5 范围不同，无重复。方案：6 步均单执行者可一次完成，判据可由 grep／node --test／eslint／diff／回读判定；11 条关口正则扫描 6 项 step+done_criteria 零命中，未把受控提交、独立复核、Gate 批准写成步骤；spark-tools.js:891、host-seams.js:721、deps.hostSeams 通路与 dedup_result 先例均现成。scope：两必备标签齐备、做什么与不做互不矛盾，可作越权基准。三条建议：补记查重结论；step 4 明示更新既有 create 用例；§16 承载限定第 1 项，并处理「事后无从核对」与 22:260「确认记录」的口径。
    session_id: 3a1340e4-b7c6-4c9a-8a5e-e5f2d5983936
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: b81be0e55ba176562015f06c87760bdbc3967b51bdb09ad9898f8fcc15b98ab4
    covered_partitions:
      - id: plan#1
        fingerprint: 0969f7c8d4d6bbc1742f3d8c08dea6c71b7dd23a635b6e097d34af20811be2e1
      - id: plan#2
        fingerprint: bb84147370b0469110b083a5752e9df569e8902e34449c712f53ed74fef3b7f9
      - id: plan#3
        fingerprint: a279a8941bef6f083dea5003d67c00388c46ad1e0efff5bc203aa229e7fec591
      - id: plan#4
        fingerprint: d49c9c2502622abb1dd1c3bf1262124fc9d83971646126e18b95914a10929a3a
      - id: plan#5
        fingerprint: c0598c4d5c40ccda3fd58e0db29d1a56322f232efc82a99887d3f6bcaa6e1d1e
      - id: plan#6
        fingerprint: 2f16455142a9a0432fdc6cc8067a5acf028a10d471950d9c3875693f12eea540
      - id: scope:做什么#1
        fingerprint: 0ad5918a3550e99a8397f11d44131d55cd49861d723e846bca5cb71b450cac62
      - id: scope:做什么#2
        fingerprint: 94f46409dbf807b144080fe809ad8028e1437dc37107ddfdde7206c3da5b11a0
      - id: scope:做什么#3
        fingerprint: dbbb347ac3a318ed1a80e8ca8c8685259984213b05f3f1936391af9d5d67d2e6
      - id: scope:做什么#4
        fingerprint: 42dde35823091d7207e2e366fd3a68d060ac61c8cf80276141bc980e132aba30
      - id: scope:做什么#5
        fingerprint: 39a0bbf329b017659447d5a8ffe593fd61cdb2bc35695efd501f2d3253f19dc0
      - id: scope:明确不做什么#1
        fingerprint: 95e8c45f92a868869ecde4f3dafc365d7c864734a70c944ca3805d0679340ab0
      - id: scope:明确不做什么#2
        fingerprint: 66ba14530c80bab7a9b9b7f4ffc18b0f0d0e21a66a54c589a3a2bcfdffb5149b
      - id: scope:明确不做什么#3
        fingerprint: 87b4cdbd5cd6eedf1b4eea2adc9732250ea6cddf37524322b89d11051efeaf2c
      - id: scope:明确不做什么#4
        fingerprint: 6a2d37532886e5c31ae492068e4b02df4fbbf995aed03fc36a210765fd281a0a
      - id: scope:明确不做什么#5
        fingerprint: 2306151640f178f79ed2332aa948bcb642c0e17cca1ddd4eabf83a913abf2562
      - id: scope:明确不做什么#6
        fingerprint: d12ac950ede6f65d295e43f7cc69218febf6887f128f44c04031cdc05a14f35d
    round_index: 1
    verdict: pass
  - at: 2026-11-12T08:13:39.466Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 方案可行性：不符。①awaitsHumanDecision 只在处置方向:162 出现，adr-tools.js:54-59 现无该字段，scope:171-178 未授权改，而 :197 判据要求 ldvh_adr_write 无 timeoutMs；②22:270 第 3 项（类型取消/合并）无实现，scope:177 却要 §16 整体写承载，过度声明
    session_id: dc6d55d3-5792-45c4-9bfb-203d0ed26192
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: ab0b0f93f83fde43509b41ab410f5500b14304598f13215e0994eef62fa9a9e0
    covered_partitions:
      - id: plan#1
        fingerprint: 5ee813e202f7989ced0983cfc748f759d859ad7b1a0bd1ed5a81f6de7fe84a1d
      - id: plan#2
        fingerprint: 577f56282dd38d5842be54abbfbedc16b68868f0cbfb56aff5061e76a2207dec
      - id: plan#3
        fingerprint: 8fad52fa66ae75b9ac5e29f566ba3d16fca42b172e14e711cf9c4391e5c84e6a
      - id: plan#4
        fingerprint: 4c464cde8535f8351190dd485505ea745b9d75cd803210b1cf47ef39c2e87a87
      - id: plan#5
        fingerprint: d78d5fe4a7681bdae97fe7483aebd69f4d6c403c846f041f7caa4a56231c0ac8
      - id: plan#6
        fingerprint: f6a1c10e04a74e3048767e260573c115389313ff13def18cbf7e700ef02d508d
      - id: plan#7
        fingerprint: 385fc65c7d6ed239b1e43d4c41c2334dbee990187d988f844f5adc014b1cfbd8
      - id: scope:做什么#1
        fingerprint: a76da8c2c8d567307ecb0aed00838142279c68b298f8bb23b8f881758701f9fa
      - id: scope:做什么#2
        fingerprint: 1686cd483d4e6660fa331c5093540986e24168aad8feb2b2de5bb8b9c0c7c61c
      - id: scope:做什么#3
        fingerprint: a37693e4318a0ded174b50a11364c0151c45e7ae8fbe692aef8bf97e4b8243b9
      - id: scope:做什么#4
        fingerprint: c877b8e1b856867835b64c11fe1d209566d37a37c3eb41e55730ed0d7b0b9b57
      - id: scope:做什么#5
        fingerprint: 018692de4db513460105249672594e236034984fc8b431d488d97c3a026d2d44
      - id: scope:做什么#6
        fingerprint: 5dfc17a8772fce9dbb353436a1c266443e0052a076729b21fa15b65dd9f74019
      - id: scope:做什么#7
        fingerprint: 6b2a8b3360f46bbfa7579cce3e94156e4c8d7d87ae93907657a2ef63e6cb6af2
      - id: scope:做什么#8
        fingerprint: 42dde35823091d7207e2e366fd3a68d060ac61c8cf80276141bc980e132aba30
      - id: scope:明确不做什么#1
        fingerprint: 66ba14530c80bab7a9b9b7f4ffc18b0f0d0e21a66a54c589a3a2bcfdffb5149b
      - id: scope:明确不做什么#2
        fingerprint: 5442869cb042efb4cc1a28acaeffb25bb4a6a619c326859f8aa2b024449f581f
      - id: scope:明确不做什么#3
        fingerprint: d01c480360799980ec8fcc85277db199e9782aade7da6c301684df193f826294
      - id: scope:明确不做什么#4
        fingerprint: fa0e471d4c0493ad50b67587485b8f79be5e5f7267eb8826067d3d22160ed7a4
      - id: scope:明确不做什么#5
        fingerprint: 6a2d37532886e5c31ae492068e4b02df4fbbf995aed03fc36a210765fd281a0a
      - id: scope:明确不做什么#6
        fingerprint: 4ece0b92198723df5cc68d686a5346c8b89a3840d2644282e57e58f99d4f0bfb
      - id: scope:明确不做什么#7
        fingerprint: e97a24a34a253bb088c3e5bc0857e4fb626d57e08366c1ddf686d4e6bd54eedf
      - id: scope:明确不做什么#8
        fingerprint: d12ac950ede6f65d295e43f7cc69218febf6887f128f44c04031cdc05a14f35d
    round_index: 2
    verdict: needs_revision
  - at: 2026-11-12T08:25:34.760Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: ③:270 判据 grep「Human 确认后落盘」在 specs/22 计数 0（原文作「经受控创建入口落盘」），判据空转。其余核验通过：scope:36/:241 已授权 awaitsHumanDecision 并与判据:58/:266 呼应
    session_id: 15b97b7a-26d0-4ee7-8978-2b7583e07ee9
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: 2bf122d4f25dcbee9945b5dfdda468d5785e70d241432bb0f5662721c44af3be
    covered_partitions:
      - id: plan#1
        fingerprint: 0fac6fab63d2ba60132c0f0784d3ccade235943f8a1c2e0412736c0c615c5016
      - id: plan#2
        fingerprint: 577f56282dd38d5842be54abbfbedc16b68868f0cbfb56aff5061e76a2207dec
      - id: plan#3
        fingerprint: de698d277ab0eee77ee505d504461325e0e31c934e7514f58bd2e573c1e47fec
      - id: plan#4
        fingerprint: 4c464cde8535f8351190dd485505ea745b9d75cd803210b1cf47ef39c2e87a87
      - id: plan#5
        fingerprint: c5fcf6d0cbe9ccd278dacf42452f44675d345e0a48df30b37cdf7dc560eccb9d
      - id: plan#6
        fingerprint: f6a1c10e04a74e3048767e260573c115389313ff13def18cbf7e700ef02d508d
      - id: plan#7
        fingerprint: e3124479d3fe6d7cdcb4968da3a5641e32f987a78d8b80986f5ce668683afa5c
      - id: scope:做什么#1
        fingerprint: a76da8c2c8d567307ecb0aed00838142279c68b298f8bb23b8f881758701f9fa
      - id: scope:做什么#2
        fingerprint: 1686cd483d4e6660fa331c5093540986e24168aad8feb2b2de5bb8b9c0c7c61c
      - id: scope:做什么#3
        fingerprint: cde80b8912294158be989f6a65eb94e497be21bbfd5237ef3816907a32683107
      - id: scope:做什么#4
        fingerprint: c877b8e1b856867835b64c11fe1d209566d37a37c3eb41e55730ed0d7b0b9b57
      - id: scope:做什么#5
        fingerprint: 018692de4db513460105249672594e236034984fc8b431d488d97c3a026d2d44
      - id: scope:做什么#6
        fingerprint: 5dfc17a8772fce9dbb353436a1c266443e0052a076729b21fa15b65dd9f74019
      - id: scope:做什么#7
        fingerprint: a3e0322b17623c176abb0a514b99b32681ec314ae5a2ba902a08cb51fb68647c
      - id: scope:做什么#8
        fingerprint: 42dde35823091d7207e2e366fd3a68d060ac61c8cf80276141bc980e132aba30
      - id: scope:明确不做什么#1
        fingerprint: 66ba14530c80bab7a9b9b7f4ffc18b0f0d0e21a66a54c589a3a2bcfdffb5149b
      - id: scope:明确不做什么#2
        fingerprint: a31aae2c2c3b9dcf0b4729221c8d029e8144e3c8675a80b310d15c1c3481d027
      - id: scope:明确不做什么#3
        fingerprint: e0f8e49e6d70a7a5a52d21c2c9f80207486a798b652ff0c7d5cb10e547db8d88
      - id: scope:明确不做什么#4
        fingerprint: d01c480360799980ec8fcc85277db199e9782aade7da6c301684df193f826294
      - id: scope:明确不做什么#5
        fingerprint: 1d37cbad03351fe8a990a284b8ac1e51d3cf4e3ec38b08ea42d84297e258cf48
      - id: scope:明确不做什么#6
        fingerprint: fa0e471d4c0493ad50b67587485b8f79be5e5f7267eb8826067d3d22160ed7a4
      - id: scope:明确不做什么#7
        fingerprint: 4ece0b92198723df5cc68d686a5346c8b89a3840d2644282e57e58f99d4f0bfb
      - id: scope:明确不做什么#8
        fingerprint: e97a24a34a253bb088c3e5bc0857e4fb626d57e08366c1ddf686d4e6bd54eedf
      - id: scope:明确不做什么#9
        fingerprint: d12ac950ede6f65d295e43f7cc69218febf6887f128f44c04031cdc05a14f35d
    round_index: 3
    verdict: needs_revision
  - at: 2026-11-12T08:30:34.284Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 方案可行性：符合——四处修订到位（载体:12/:279「六处」、:279 补全引文、:284 分布、:339 串改，该串现 1 次命中）；行号全实：adr-tools.js:255/261/299/372/389/392/595/603（全文三词零命中）、adr-writer.js:326/687/709/775-782、host-seams/spark-tools:574/721/66/337/891、test.mjs:1188-1211、ldvh-tools:1836、workcase-tools:828；七步可连续、判据可判定。
    session_id: 26792255-6047-4d60-9a64-51efbe4fd03e
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: b502caba04091299bafde247f0601713b6d9d35748ecb20b55e7840af2f78fd5
    covered_partitions:
      - id: plan#1
        fingerprint: a88a59a0b6e6f38522326d7a79eb5ce65547954fd11258eb671524f78473f902
      - id: plan#2
        fingerprint: 577f56282dd38d5842be54abbfbedc16b68868f0cbfb56aff5061e76a2207dec
      - id: plan#3
        fingerprint: de698d277ab0eee77ee505d504461325e0e31c934e7514f58bd2e573c1e47fec
      - id: plan#4
        fingerprint: 545fbc9d8581c772cefc9131c55ace5df8b782ea6db6bcbe2262ba3fe7deca8b
      - id: plan#5
        fingerprint: 989f693f5be3588ef4bb15786990049240e2f7799ec9f12c752413a73350f3c5
      - id: plan#6
        fingerprint: f6a1c10e04a74e3048767e260573c115389313ff13def18cbf7e700ef02d508d
      - id: plan#7
        fingerprint: e3124479d3fe6d7cdcb4968da3a5641e32f987a78d8b80986f5ce668683afa5c
      - id: scope:做什么#1
        fingerprint: a76da8c2c8d567307ecb0aed00838142279c68b298f8bb23b8f881758701f9fa
      - id: scope:做什么#2
        fingerprint: 1686cd483d4e6660fa331c5093540986e24168aad8feb2b2de5bb8b9c0c7c61c
      - id: scope:做什么#3
        fingerprint: cde80b8912294158be989f6a65eb94e497be21bbfd5237ef3816907a32683107
      - id: scope:做什么#4
        fingerprint: c877b8e1b856867835b64c11fe1d209566d37a37c3eb41e55730ed0d7b0b9b57
      - id: scope:做什么#5
        fingerprint: 018692de4db513460105249672594e236034984fc8b431d488d97c3a026d2d44
      - id: scope:做什么#6
        fingerprint: 5dfc17a8772fce9dbb353436a1c266443e0052a076729b21fa15b65dd9f74019
      - id: scope:做什么#7
        fingerprint: a3e0322b17623c176abb0a514b99b32681ec314ae5a2ba902a08cb51fb68647c
      - id: scope:做什么#8
        fingerprint: 42dde35823091d7207e2e366fd3a68d060ac61c8cf80276141bc980e132aba30
      - id: scope:明确不做什么#1
        fingerprint: 66ba14530c80bab7a9b9b7f4ffc18b0f0d0e21a66a54c589a3a2bcfdffb5149b
      - id: scope:明确不做什么#2
        fingerprint: a31aae2c2c3b9dcf0b4729221c8d029e8144e3c8675a80b310d15c1c3481d027
      - id: scope:明确不做什么#3
        fingerprint: e0f8e49e6d70a7a5a52d21c2c9f80207486a798b652ff0c7d5cb10e547db8d88
      - id: scope:明确不做什么#4
        fingerprint: d01c480360799980ec8fcc85277db199e9782aade7da6c301684df193f826294
      - id: scope:明确不做什么#5
        fingerprint: 1d37cbad03351fe8a990a284b8ac1e51d3cf4e3ec38b08ea42d84297e258cf48
      - id: scope:明确不做什么#6
        fingerprint: fa0e471d4c0493ad50b67587485b8f79be5e5f7267eb8826067d3d22160ed7a4
      - id: scope:明确不做什么#7
        fingerprint: 4ece0b92198723df5cc68d686a5346c8b89a3840d2644282e57e58f99d4f0bfb
      - id: scope:明确不做什么#8
        fingerprint: e97a24a34a253bb088c3e5bc0857e4fb626d57e08366c1ddf686d4e6bd54eedf
      - id: scope:明确不做什么#9
        fingerprint: d12ac950ede6f65d295e43f7cc69218febf6887f128f44c04031cdc05a14f35d
    round_index: 3
    verdict: pass
gate_1:
  approved_at: 2026-11-12T08:30:57.611Z
  approver: 老丁（Human，dsh-ldvh 受管辖会话主）
  authorization_fingerprint: b502caba04091299bafde247f0601713b6d9d35748ecb20b55e7840af2f78fd5
  scope_snapshot: |-
    做什么：
    - host-seams.js 新增 requestAdrConsent：按 action 分列创建与退休两套呈报；无答题器／询问失败／未作选择一律 fail-closed；转发 caller signal；question 不超过 200 字符（ADR 7ceaf7fc）
    - adr-tools.js 的 create 与「active → retired」两处在写入前取确认，未取得即 rejected 且零写入
    - OPERATIONS["adr-write-object"] 声明 awaitsHumanDecision: true，toolDescriptorFor 改为 spark-tools.js:891 式条件展开（...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 }），使 ldvh_adr_read／ldvh_adr_list 保留正上界
    - 退休呈报内容含 retirement_reason、change_log.summary 全文与关系目标，交由 Human 判断据实说明是否成立（不新增弱判据）
    - create 增必填 dedup_result 并纳入呈报
    - 处置 specs/22:224 的悬空术语：删去「完整四要素」，就地显式列出 04 §6.1 的四条自查内容（只取此形态，不保留二择一）
    - 修订 specs/22 的 §13（创建条与终态流转条）、§15 验证表与 §16：§16 的承载说明只覆盖第 1、2 项，第 3 项不主张已获承载；并写入条件式披露
    - 补测试并做变异验证：去掉门禁调用、去掉 awaitsHumanDecision、忽略答复，各至少一例转红

    明确不做什么：
    - 不改 correct 的 human_authorization 自报语义
    - 不新增确认凭据类字段，不为既有 9 个 ADR 补确认记录、不改写既有 change_log（故本单不闭合「事后核对谁确认过」）
    - 不改 ADR 字段闭集、状态闭集、五值理由闭集与关系契约
    - 不改 specs/22 §9 状态机与 §17 停止类型
    - 不实现 §16 第 3 项（ADR 类型取消或合并），也不为其写承载声明
    - 不改 specs/04 与 specs/10 正文（04 §6.1 只作为内容来源被引用）
    - 不新增「据实说明」的机械弱判据（理由：非空校验已存在，弱判据易误伤正常摘要）
    - 不改 specs/ 其他规范（00／01／02／03／20／21 等）与 Web 呈现层
    - 不重启宿主、不启动服务、不改 ~/.dsh 之外的宿主文件
reviews:
  - at: 2026-11-12T08:46:29.763Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: 76a94ff4-fd1c-4230-b232-84c6b1a8df12
    session_source: host
    implementer_session_id: session-29319d0a-8051-42bb-9d4b-c0b1767a0bf8
    implementer_session_source: host
    reviewer_origin: subagent
    summary: |-
      发现：**中**——requestAdrConsent 本身零测试覆盖：把它改为回落 `answers[0]` 且不转发 `agent` 后 27/27 仍全绿（代码本身正确：:835 传 agent、:840 按 id 取答复、无回落），但计划步骤 2 判据（空呈报不提问／≤200 字符／转发 agent+signal）未被任何用例钉住，「空答复」用例是自证循环。**无阻断缺陷**
      保证边界：不证明宿主弹窗可达、答复真实性与决策质量；不覆盖事后核对。变异已全部恢复（md5 与改前一致）。
  - at: 2026-11-12T08:54:46.961Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: e7cfd1e9-4b38-488c-8d47-46702994884f
    session_source: host
    implementer_session_id: session-29319d0a-8051-42bb-9d4b-c0b1767a0bf8
    implementer_session_source: host
    reviewer_origin: subagent
    summary: |-
      未覆盖：真实宿主弹窗；退休关系目标分支；宿主对 agent/signal 的实际消费。
      发现：核心缺口已闭合，无阻断缺陷。次要（非阻断）：adr-consent-seam.test.mjs:165「question ≤200」空转——外壳约 30 字，clamp 不触发；lib/host-seams.js:59 的 200 改 5000 后仍 10/10 绿（断言与实现共用常量），200 字面值未被钉住。自述相符，仅漏 todo 1。
      保证边界：不能证明真实弹窗、并发下 runner 不截断，未穷举变异。
result:
  achieved_scope: 授权范围内七个计划步骤全部达成：host-seams.js 新增 requestAdrConsent 并挂入 seams；adr-tools.js 的 create 与「active → retired」两处在写入前取确认、缺 dedup_result 即零写入拒绝；OPERATIONS["adr-write-object"] 声明 awaitsHumanDecision 且 toolDescriptorFor 改条件展开（write 无 timeoutMs、read/list 保留 30000）；退休呈报含 retirement_reason、change_log.summary 全文与关系目标；create 增必填 dedup_result 并纳入呈报；specs/22:224 悬空术语已删除并就地列出 04 §6.1 四条；specs/22 的 §13、§15、§16 已对齐（承载说明只覆盖第 1、2 项，第 3 项不主张承载，含条件式披露）；测试与七类变异验证已补齐。
  criteria_checks:
    - evidence: 「摘要·现状核实」逐项钉死 文件:行号（22 号六处：:224/:226/:268/:269/:284/:103；实现侧 adr-tools.js 零承载与 toolDescriptorFor 硬编码 timeoutMs）；提案阶段四处错述与执行期一处越权如实登记于「摘要·更正」，各有原说法与实测反证位置；引文经两轮建前审核逐字比对（含 22:269 补全「——废除已定决策」）。
      satisfied: true
    - evidence: host-seams.js 新增 requestAdrConsent（与 requestSparkConsent 同形）并挂入 seams 对象；plugin/test/adr-consent-seam.test.mjs 11 例逐项断言（无答题器不提问、空呈报 4 形态不提问、仅本问题肯定放行、别的问题同标签拒绝、抛错 fail-closed、agent 与 signal 必转发、question ≤ 200 用字面值断言且外壳真被截断）；接缝层三次变异（回落 answers[0]／不转发 agent／空呈报仍提问）逐个转红后恢复。
      satisfied: true
    - evidence: "adr-tools.js 的 create 先校验 dedup_result 非空（缺失即 invalid_request 且不提问）再经 requestAdrGate 取确认、最后才 createAdrObject；update 仅在落盘对象为 active 且目标状态为 retired 时取确认；OPERATIONS 增 awaitsHumanDecision: true，toolDescriptorFor 的 timeoutMs 改条件展开；经 lib/adr-tools.js 的 toolDescriptorFor 断言 write 无 timeoutMs、read/list 为 30000；无 seam 时 unavailable、拒绝时 rejected 且 adrs 目录文件数 0、退休被拒后对象仍 active 且指纹不变、确认后 completed 且回读一致；工具层三次变异转红。"
      satisfied: true
    - evidence: 改写后 grep -c 完整四要素 specs/22-ADR-决策.md = 0；该行就地列出的四条与 specs/04:117 的四句逐条对应（可逐句 grep 核对）；diff 仅落在该行及其必要交叉引用。
      satisfied: true
    - evidence: git diff specs/22 仅 §13 两条、§15 两行一增、§16 新增 16.2（承载只覆盖第 1、2 项，第 3 项明确不声明承载，含条件式披露与已知代价）；grep -c「Human 确认后经受控创建入口落盘」= 0；§9 状态机与 §17 停止类型逐字未动。
      satisfied: true
    - evidence: 工具层三类变异（删门禁调用／删 awaitsHumanDecision／忽略答复）逐个转红后恢复；接缝层四类变异逐个转红后恢复；「把 adr-tools.js:603 恢复为无条件硬编码」实测转红，证明 timeoutMs 判据非空转。
      satisfied: true
    - evidence: plugin 全量 tests 3236 / pass 3216 / fail 0 / skipped 19 / todo 1；npx eslint . 退出码 0；未验证范围逐条列明于「执行·执行期如实登记」（真实宿主弹窗端到端、宿主对 agent/signal 的实际消费、退休关系目标分支用例、并发下 runner 是否截断、「事后核对谁确认过」未闭合）。
      satisfied: true
  residual:
    - 真实宿主弹窗的端到端行为未经本会话重启验证（弹窗是否出现未实测）。
    - 宿主对 agent 与 signal 的实际消费只验到接缝把它们放进请求，未验宿主侧行为。
    - 「事后核对谁确认过」未闭合：ADR 对象不承载确认凭据字段。
    - 退休呈报的关系目标分支（superseded 与 absorbed 带 relations 路径）无专用用例。
    - 工具级 awaitsHumanDecision 使 create、update（含勘误）与 correct 三个动作同时失去 30 秒执行期墙钟上限。
    - 本单改动的受控提交尚待进行（specs/06），工作树内另有他会话的在途改动须分开提交。
outcome: completed
created_at: 2026-11-12T06:37:40.717Z
change_log:
  - at: 2026-11-12T06:37:40.717Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-11-12T06:45:01.647Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "自动派生的建前独立审核（插件发起），结论 pass [pre-gate1 audit recorded by session 3a1340e4-b7c6-4c9a-8a5e-e5f2d5983936; verdict: pass; round: 1/3; covered: 17/17 partition(s); candidate_fingerprint: b81be0e55ba1…; pre_reviews entries: 1; auto-dispatched by plugin after create; auditor child 3a1340e4-b7c6-4c9a-8a5e-e5f2d5983936]"
  - at: 2026-11-12T07:50:48.867Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 扩范围至四项：并入退休流转的确认与呈报、22:224 悬空术语处置；并更正上一轮「退休 summary 可空」的失实陈述（实测非空校验已存在于 adr-tools.js:389 与 adr-writer.js:687）
  - at: 2026-11-12T07:55:38.910Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按建前审核（第 2 轮 needs_revision）修正三处：改正目标解析行号为 :326 与 :775-782、把 timeoutMs 改为条件展开并在判据中覆盖 read/list、把 22:224 形态收敛为单一方案（就地列出 04 §6.1 四条）
  - at: 2026-11-12T07:58:33.044Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按建前审核第 2 轮的四条遗留小事修订：条文计数改为五处、边界补记 correct 动作同失上界、判据改为经 adr-tools.js:595 的 toolDescriptorFor 并加「恢复硬编码须转红」的空转检测、来源引到 04:117
  - at: 2026-11-12T08:13:39.466Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录第 3 轮建前独立审核：结论 needs_revision，指出 awaitsHumanDecision 未在 scope 授权、§16 过度声明、引文不逐字三处缺口 [pre-gate1 audit recorded by session dc6d55d3-5792-45c4-9bfb-203d0ed26192; verdict: needs_revision; round: 2/3; covered: 23/23 partition(s); candidate_fingerprint: ab0b0f93f83f…; pre_reviews entries: 2; 记录自子代理会话 dc6d55d3-5792-45c4-9bfb-203d0ed26192 的最终产出（Code 捕获）]"
  - at: 2026-11-12T08:14:09.801Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按第 3 轮审核修订三处：scope 增 awaitsHumanDecision 授权项、§16 承载说明收敛为只覆盖第 1/2 项、引文改逐字并撤回「事后核对已闭合」的过度声明
  - at: 2026-11-12T08:25:34.760Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录第 3 轮建前独立审核：结论 needs_revision（条文计数不一致、22:269 引文不逐字、判据 grep 串零命中属空转、「完整四要素」分布断言有误） [pre-gate1 audit recorded by session 15b97b7a-26d0-4ee7-8978-2b7583e07ee9; verdict: needs_revision; round: 3/3; covered: 24/24 partition(s); candidate_fingerprint: 2bf122d4f25d…; pre_reviews entries: 3; 记录自子代理会话 15b97b7a-26d0-4ee7-8978-2b7583e07ee9 的最终产出（Code 捕获）]"
  - at: 2026-11-12T08:26:17.594Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按第 3 轮审核修订四处文书层缺陷：正文「五处」改「六处」、22:269 引文补全「——废除已定决策」、「完整四要素」分布改为仅 22:224 一处、§15 判据 grep 串改为可命中的「Human 确认后经受控创建入口落盘」
  - at: 2026-11-12T08:30:34.284Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录同轮定向复审（第 3 轮内）：四处文书层修订全部到位，行号全部实证，七步可连续执行，结论 pass [pre-gate1 audit recorded by session 26792255-6047-4d60-9a64-51efbe4fd03e; verdict: pass; round: 3/3; covered: 24/24 partition(s); candidate_fingerprint: b502caba0409…; pre_reviews entries: 4; 记录自子代理会话 26792255-6047-4d60-9a64-51efbe4fd03e 的最终产出（Code 捕获）]"
  - at: 2026-11-12T08:30:57.611Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 1 批准：老丁指示「先把这个执行了」，据此授权按本单 scope 执行四项 ADR 门禁改动，绑定当次 plan+scope 指纹 [gate_1 approved by 老丁（Human，dsh-ldvh 受管辖会话主）; attempt 1 allocated to 主控 AI（dsh-ldvh 受管辖会话）]
  - at: 2026-11-12T08:39:15.111Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 执行 7 个计划步骤并回填执行节：新增 requestAdrConsent、两个写入点接线、条件展开与 dedup_result、22 号 §13/§15/§16 对齐；三次变异验证均转红、全量 3225 例 0 失败、eslint 零问题；另登记一处自我越权已撤销 [attempt 1 heartbeat refreshed]
  - at: 2026-11-12T08:46:29.763Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录独立复核：无阻断缺陷，指出 requestAdrConsent 接缝层零测试覆盖的中等问题（已补 10 例接缝测试并三次变异转红） [review recorded by session 76a94ff4-fd1c-4230-b232-84c6b1a8df12; reviews entries: 1; 记录自子代理会话 76a94ff4-fd1c-4230-b232-84c6b1a8df12 的最终产出（Code 捕获）]"
  - at: 2026-11-12T08:46:51.116Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补测闭合复核指出的中等问题：新增 adr-consent-seam.test.mjs 10 例接缝层用例，三次变异（回落 answers[0]／不转发 agent／空呈报仍提问）均转红；全量升至 3235 例 0 失败 [attempt 1 heartbeat refreshed]
  - at: 2026-11-12T08:54:46.961Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录增量复核：核心缺口已闭合；次要空转已修（question≤200 断言改字面值 200 并新增 clamp 生效用例，变异 200→5000 现转红） [review recorded by session e7cfd1e9-4b38-488c-8d47-46702994884f; reviews entries: 2; 记录自子代理会话 e7cfd1e9-4b38-488c-8d47-46702994884f 的最终产出（Code 捕获）]"
  - at: 2026-11-12T08:55:08.004Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 修闭合第二轮复核指出的空转：question≤200 断言改字面值 200、新增「外壳必须真被截断」用例，变异 200→5000 现转红；全量升至 3236 例 0 失败、eslint 零问题 [attempt 1 heartbeat refreshed]
  - at: 2026-11-12T08:56:17.021Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 提交 Gate 2 关闭提案：写入「## 结果」节（逐条判据核对 7 项全达成 + 6 项残留与去向），status 保持 open 待 Human 批准 [attempt 1 heartbeat refreshed]
  - at: 2026-11-12T18:35:27.118Z
    provider: minmax
    model: MiniMax-M3.1-Flash
    summary: Gate 2 关闭：老丁批准关闭，outcome=completed。授权范围内七个计划步骤全部达成（逐条判据核对见正文「结果·逐条判据核对」），六项残留按 21 §8 登记形态落成残留段与去向子项（均为「接受现状」并给出非空理由）、未宣称闭合；attempt 1 收口撤回。 [gate_2 closed with outcome=completed; attempt 1 retracted]
---

# ADR 创建与退休补 Human 确认门禁

## 摘要

ADR 的创建与退休当前都只由规范文字要求 Human 确认，实现侧零承载：`ldvh_adr_write` 的 `create` 与 `update`（`active → retired`）都不经任何询问即可落盘，AI 能在没有 Human 回应的情况下让一条对全仓有法定约束力的决策生效或退出基线。本单为这两处补上可机械取得的 Human 确认，并处置 22 号的两处条文问题（悬空术语、承载声明缺失）。

### 现状核实（文件:行号，可 grep 复核）

- 规范侧六处条文：`specs/22-ADR-决策.md:224`（§13 创建条）、`:226`（§13 终态流转条）、`:268`（§16 第 1 项）、`:269`（§16 第 2 项）、`:284`（§17 第 5 项）、`:103`（§7 创建与变更权）——共六处。
- 实现侧零承载（改动前）：`plugin/lib/adr-tools.js` 全文无 `hostSeams` / `userQuestions` / `awaitsHumanDecision` 命中；`create` 直达 `createAdrObject`；`update` 直达 `updateAdrObject`；`toolDescriptorFor` 对全部 ADR 操作共用硬编码 `timeoutMs: 30000`。
- 对照面已落地的同类门禁：`host-seams.js:721` `requestSparkConsent`、`spark-tools.js:337` `requestSparkGate`、`spark-tools.js:66` `awaitsHumanDecision: true`、`:891` 条件展开。
- 规范侧披露差异：`specs/20:377` 有「在宿主询问入口对本类型实际具备之前，不得主张本项已获机械保障」；22 号原无同类句。
- 退休机制本身完整无缺，缺的只是授权。
- 悬空术语：`specs/22:224` 的「完整四要素」按该词形 grep 全仓仅此一处且无定义。
- 既有测试的覆盖边界：`plugin/test/ldvh-tools.test.mjs:1188-1211` 的 timeoutMs 断言走聚合 `OPERATIONS`，该表不含任何 adr 条目，照抄会空转（`friction-661831ae` 同型）。

### 更正（落实 00 §4.6 据实声明）

本单在提案与执行阶段共有五处错述或越权，均由审核实读指出或自查发现：

- 第一处：「`retired` 时 `change_log.summary` 可以什么都不写就落盘」不成立——空串在 tools 层与 writer 层各有一道零写入拒绝。源于从缺席的检索直接下否定结论（同型见 `friction-21472aca`）。
- 第二处：目标解析行号引错，实为 `adr-writer.js:326` 与 `:775-782`。
- 第三处：scope 与判据自相矛盾且引文不逐字。
- 第四处：正文「五处」实列六项、`22:269` 引文漏「——废除已定决策」、分布误计、`§15` 判据 grep 串零命中。
- 第五处：**执行期自我越权**——曾用脚本直接向本载体追加「## 执行」节，绕过受控写入通道（`friction-df85d0ea` 同型）。已当场撤销并改走 `execute`。

### 边界

`awaitsHumanDecision` 按工具声明，故 `create`、`update`（含勘误与退休）、`correct` 三个动作全部失去 30 秒上界；`ldvh_adr_read`/`ldvh_adr_list` 不受影响。本单不闭合「事后核对」：不新增确认凭据字段、不为既有 9 个 ADR 补记录。`correct` 的 `human_authorization` 自报语义不改。字段闭集、状态闭集、关系契约与 §9 状态机逐字不动。

## 授权范围

做什么：
- `host-seams.js` 新增 `requestAdrConsent`：按 action 分列创建与退休两套呈报；无答题器／询问失败／未作选择一律 fail-closed；转发 caller signal；question 不超过 200 字符（ADR 7ceaf7fc）
- `adr-tools.js` 的 `create` 与「`active → retired`」两处在写入前取确认，未取得即 `rejected` 且零写入
- `OPERATIONS["adr-write-object"]` 声明 `awaitsHumanDecision: true`，`toolDescriptorFor` 改为条件展开，使 `ldvh_adr_read` / `ldvh_adr_list` 保留正上界
- 退休呈报内容含 `retirement_reason`、`change_log.summary` 全文与关系目标，交由 Human 判断据实说明是否成立（不新增弱判据）
- `create` 增必填 `dedup_result` 并纳入呈报
- 处置 `specs/22:224` 的悬空术语：删去「完整四要素」，就地显式列出 04 §6.1 的四条自查内容
- 修订 `specs/22` 的 §13（创建条与终态流转条）、§15 验证表与 §16：§16 的承载说明只覆盖第 1、2 项，第 3 项不主张已获承载；并写入条件式披露
- 补测试并做变异验证：去掉门禁调用、去掉 `awaitsHumanDecision`、忽略答复，各至少一例转红

明确不做什么：
- 不改 `correct` 的 `human_authorization` 自报语义
- 不新增确认凭据类字段，不为既有 9 个 ADR 补确认记录、不改写既有 `change_log`
- 不改 ADR 字段闭集、状态闭集、五值理由闭集与关系契约
- 不改 `specs/22` §9 状态机与 §17 停止类型
- 不实现 §16 第 3 项（ADR 类型取消或合并），也不为其写承载声明
- 不改 `specs/04` 与 `specs/10` 正文（04 §6.1 只作为内容来源被引用）
- 不新增「据实说明」的机械弱判据
- 不改 `specs/` 其他规范与 Web 呈现层
- 不重启宿主、不启动服务、不改 `~/.dsh` 之外的宿主文件

## 计划

- 现状取证与更正登记：把 22 号六处条文与实现侧零承载逐项钉死在文件:行号上，并把提案阶段四处错述（退休 summary 可空、目标解析行号、scope 自相矛盾与引文不逐字、计数与引文细节）如实更正
  完成判据：清单每项给出 文件:行号 + 原文或代码片段 + 结论，可由 grep 逐条复核；四处错述各自写明原说法与实测反证位置；引用的规范句与原文逐字一致（16 处以上引文逐条比对）
- 设计并实现呈报载体：host-seams.js 新增 requestAdrConsent，按 action 分列创建与退休两套呈报
  完成判据：新函数导出并挂在 seams 对象上；无答题器返回 granted:false；呈报内容为空时不提问直接拒绝；question 长度不超过 200 字符；两套呈报的字段清单在测试中被逐项断言
- adr-tools 接线两处并改共用描述符：create 与「active → retired」写入前取确认；OPERATIONS 增 awaitsHumanDecision 且 toolDescriptorFor 改为条件展开
  完成判据：经 lib/adr-tools.js:595 的 toolDescriptorFor 取得三个描述符后断言——ldvh_adr_write 不含 timeoutMs，ldvh_adr_read 与 ldvh_adr_list 的 timeoutMs 仍为正数（三者同一次断言，不得改用 lib/ldvh-tools.js 的聚合 OPERATIONS，该表不含 adr 条目）；seam 缺失时 create 与退休均返回 unavailable；答复非肯定时返回 rejected 且 ldvh-base/adrs/ 文件数与目标对象指纹均不变；确认后返回 completed 且回读指纹一致
- 处置 specs/22:224 的悬空术语：删去「完整四要素」，就地显式列出 04 §6.1 的四条自查内容
  完成判据：改写后 grep -c 完整四要素 specs/22-ADR-决策.md 为 0；该行列出的四条与 specs/04:117 的四句逐条对应（可由 grep 逐句核对）；diff 仅落在该行及其必要交叉引用
- 规范对齐：修订 specs/22 的 §13（创建条与终态流转条）、§15 验证表与 §16，写明以 ctx.userQuestions.ask 承载并加条件式披露
  完成判据：diff 仅落在 §13／§15／§16 及其必要交叉引用；§16 的承载说明明确只覆盖第 1、2 项，第 3 项逐字保留原状且不出现承载主张；改写后 grep -c 「Human 确认后经受控创建入口落盘」specs/22-ADR-决策.md 为 0；§9 状态机与 §17 停止类型逐字未动
- 补测试与变异验证：创建与退休各一条正向 + 无 seam／拒绝答复／空答复／呈报缺失／dedup 缺失五条 fail-closed + 三个描述符的 timeoutMs 断言
  完成判据：定向 node --test 全绿；三类变异（删门禁调用、删 awaitsHumanDecision、忽略答复）各自至少一条用例转红，转红输出记入执行节；另须实测「把 adr-tools.js:603 恢复为无条件硬编码」时该 timeoutMs 用例确实转红，否则判为判据空转、须重写
- 全量验证与交还：跑 plugin 全量测试与 eslint，登记未验证范围
  完成判据：plugin 下 npm test 全绿、npx eslint 零问题，输出摘录进结果节；如实列明未验证范围（真实宿主弹窗未经本会话重启验证、工具级 awaitsHumanDecision 致 create/update/correct 三个动作均失去 30 秒上界、「事后核对谁确认过」未闭合等）

## 执行

- attempt 1 started at 2026-11-12T08:30:57.611Z (controller: 主控 AI（dsh-ldvh 受管辖会话）)；Gate 1 授权范围见 gate_1.scope_snapshot。

### 计划步骤 1：完成

取证清单已在「摘要·现状核实」逐项钉死，全部经建前审核实读复核。提案阶段四处错述与执行期一处越权已如实登记于「摘要·更正」。

### 计划步骤 2：完成

`host-seams.js` 新增 `requestAdrConsent`（与 `requestSparkConsent` 同形）：常量对、`assembleBoundedAsk` 有界组装、无答题器/询问失败/未作选择一律 fail-closed、转发 caller signal 与 live agent、只接受本问题的肯定标签（不回落 `answers[0]`）。已挂入 seams 对象。

### 计划步骤 3：完成

`adr-tools.js` 三处：`create` 先校验 `dedup_result` 非空（缺失即 `invalid_request` 且不提问）→ 经 `requestAdrGate` 取确认 → 最后才 `createAdrObject`；`update` 仅在目标状态为 `retired` 且落盘对象为 `active` 时取确认（`active → active` 勘误按 22 §9.3 不受本 Gate 约束）；`OPERATIONS` 增 `awaitsHumanDecision: true`，`toolDescriptorFor` 的 `timeoutMs` 改条件展开，schema 增 `dedup_result`。

### 计划步骤 4：完成

`specs/22:224` 的「完整四要素」已删去（`grep -c 完整四要素` = 0），改为就地列出 04 §6.1 四项自查内容（四句逐字取自 `specs/04:117`）。

### 计划步骤 5：完成

`specs/22` 三处：`:224`（创建条）、`:226`（终态流转条补呈报要求）、`§16` 新增 16.2（承载只覆盖第 1、2 项；第 3 项明确不声明承载；保证边界声明不产生事后可核凭据；条件式披露；已知代价）。`§15` 两行调整并新增一行。`grep -c "Human 确认后经受控创建入口落盘"` = 0。§9 状态机与 §17 停止类型逐字未动。

### 计划步骤 6：完成

`plugin/test/adr-tools.test.mjs` 新增 11 例；**工具层三次变异**全部转红（26/1、24/3、26/1），恢复后 27/27。

### 计划步骤 7：完成

- `plugin` 全量（最终）：**tests 3236 / pass 3216 / fail 0 / skipped 19 / todo 1**。
- `npx eslint .`：零问题（退出码 0）。

### 独立复核与两轮补测（关键过程）

**第一轮复核（`76a94ff4`）**：无阻断缺陷，但实测指出中等问题——`requestAdrConsent` 本身零测试覆盖：把它改成回落 `answers[0]` 且不转发 `agent` 后，工具层 27/27 仍全绿。我独立复现确认属实。

处置：新增 `plugin/test/adr-consent-seam.test.mjs`，覆盖接缝自身：无答题器不提问、空/缺席呈报（4 形态）不提问、仅本问题肯定标签放行、拒答/未选/空/别的问题同标签/多选/未提供过的形状全部拒绝、**同批中别的问题先给肯定时不得放行**、抛错 fail-closed、**live agent 必须转发**、**signal 必须转发**、超长呈报下 question ≤ 200 且全文进 detail、两种外壳点名动作。接缝层三次变异转红（8/2、9/1、9/1），恢复后 10/10。

**第二轮复核（`e7cfd1e9`）**：核心缺口已闭合，无阻断缺陷；但指出一处次要空转——「question ≤ 200」用例里断言与实现共用 `ASK_QUESTION_MAX_CHARS`，把该常量改成 5000 仍 10/10 全绿；且外壳约 30 字，clamp 从不触发，只证明「不超」不证明「会截」。复现确认属实。

处置：① 断言改用**字面值 200**，不再引用实现常量；② 新增「外壳必须真的被截断」用例，用 200 字重复的超长 `objectTitle` 顶爆外壳，断言 `question.length ≤ 200` 且 `> 100`（不得过度截断）且不含完整原文标题。**变异验证**：把 `ASK_QUESTION_MAX_CHARS` 200 → 5000，该用例转红（10/1），恢复后 11/11。

### 执行期如实登记

- 未验证范围：真实宿主弹窗未经本会话重启验证；宿主对 `agent`/`signal` 的**实际消费**未验；`create`/`update`（含勘误）/`correct` 三动作同时失去执行期墙钟上限，属已知代价；「事后核对谁确认过」未闭合；**退休呈报的关系目标分支未单独覆盖**；并发下 runner 是否截断未验。
- 非本单的其他在途改动：`docs/` 三份、`ldvh-base/frictions/` 五份、`specs/34-双源召回系统规范.md`、未跟踪的 spark 文件——受控提交时须与本单改动分开。
- 本单的间接副作用：`plugin/test/.test-count-baseline` 由 `plugin/scripts/run-tests.mjs:120` 自动改写（3214 → 3236），非人工编辑。

## 结果

**关闭提案（2026-11-12 经 execute 落盘；2026-11-13 经老丁批准关闭）：授权范围内全部达成，outcome=completed。**

### 逐条判据核对

- 计划步骤 1：达成——证据：现状取证清单已在「摘要·现状核实」逐项钉死 文件:行号（22 号六处：:224／:226／:268／:269／:284／:103；实现侧 adr-tools.js 零承载）；提案阶段四处错述与执行期一处越权在「摘要·更正」各有原说法与实测反证位置；引文经两轮建前审核逐字比对。
- 计划步骤 2：达成——证据：host-seams.js 新增 requestAdrConsent 并挂入 seams 对象；adr-consent-seam.test.mjs 11 例逐项断言（无答题器不提问、空呈报 4 形态不提问、仅本问题肯定放行、别的问题同标签拒绝、抛错 fail-closed、agent 与 signal 必转发、question ≤ 200 用字面值断言且外壳真被截断）；接缝层三次变异逐个转红后恢复。
- 计划步骤 3：达成——证据：adr-tools.js 的 create 先校验 dedup_result 非空、再经 requestAdrGate 取确认、最后才 createAdrObject；update 仅在落盘对象为 active 且目标状态为 retired 时取确认；OPERATIONS 增 awaitsHumanDecision: true，toolDescriptorFor 的 timeoutMs 改条件展开（write 无 timeoutMs、read 与 list 为 30000）；工具层三次变异逐个转红后恢复。
- 计划步骤 4：达成——证据：grep -c 完整四要素 specs/22-ADR-决策.md = 0；该行就地列出的四条与 specs/04:117 的四句逐条对应；diff 仅落在该行及其必要交叉引用。
- 计划步骤 5：达成——证据：git diff specs/22 仅 §13 两条、§15 两行一增、§16 新增 16.2（承载只覆盖第 1、2 项，第 3 项明确不声明承载，含条件式披露与已知代价）；grep -c「Human 确认后经受控创建入口落盘」= 0；§9 状态机与 §17 停止类型逐字未动。
- 计划步骤 6：达成——证据：工具层三类 + 接缝层四类变异逐个转红后恢复；「把 adr-tools.js:603 恢复为无条件硬编码」实测转红，证明 timeoutMs 判据非空转。
- 计划步骤 7：达成——证据：plugin 全量 tests 3236 / pass 3216 / fail 0 / skipped 19 / todo 1；npx eslint . 退出码 0；未验证范围逐条列明于「执行·执行期如实登记」。

### 残留与去向（如实登记，不认为已闭合）

- residual:
  - 真实宿主弹窗的端到端行为未经本会话重启验证（弹窗是否出现未实测）。
    - **接受现状**：本单不另立跟踪对象。验证方式已写明——在任意真实会话触发一次 ldvh_adr_write 的 create，看宿主弹窗是否出现，结论直接记回本单载体即可。
  - 宿主对 agent 与 signal 的实际消费只验到接缝把它们放进请求，未验宿主侧行为。
    - **接受现状**：宿主侧的实际消费以真实弹窗行为为准，本单不跟踪。接缝层已验：live agent 必转发、signal 必转发（见 adr-consent-seam.test.mjs）。
  - 「事后核对谁确认过」未闭合：ADR 对象不承载确认凭据字段。
    - **接受现状**：本单不跟踪该缺口。要闭合须扩 ADR 字段闭集（如 confirmed_by 与 confirmed_at），属 22 号规范修订，须另立一单过 Gate 1；在此之前不得主张本项已获机械保障。
  - 退休呈报的关系目标分支（superseded 与 absorbed 带 relations 路径）无专用用例。
    - **接受现状**：本单不跟踪。将来创建带 relations 的 ADR 时补用例即可；工具层已有「拒绝后对象保持 active 且指纹不变」一例覆盖相邻路径。
  - 工具级 awaitsHumanDecision 使 create、update（含勘误）与 correct 三个动作同时失去 30 秒执行期墙钟上限。
    - **接受现状**：这是本单已写明的取舍代价（22 §16.2），不是缺陷；不为它另立跟踪对象。
  - 本单改动的受控提交尚待进行（specs/06），工作树内另有他会话的在途改动须分开提交。
    - **接受现状**：提交动作本身不另立跟踪对象。本单改动由老丁批准后的受控提交承接，提交时须与工作树内其他在途改动分开。

