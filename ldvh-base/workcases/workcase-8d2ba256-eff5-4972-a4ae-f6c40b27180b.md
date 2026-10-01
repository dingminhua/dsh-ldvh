---
fact_type_key: workcase
object_uid: 8d2ba256-eff5-4972-a4ae-f6c40b27180b
title: C2 授权校验与 rebatch×reviews 处置
status: closed
gist: 补上 C2 授权钉扎在实现层的缺口，并修正 rebatch 对 reviews 与 change_log 的处置，使授权失效可被机械检测。
serves: SG-3
summary: |-
  补上 WorkCase 授权钉扎（C2）在实现层的缺口与 `rebatch` 对 Code 托管字段的处置缺陷，使「授权指纹失效」被机械检测、且重批（rebatch）对 `reviews`/`change_log` 的处置自洽。本单合并三处经对抗审核与起草者亲验确认的既有缺陷（均先于 E4 存在，由 E4 暴露）：缺口 A（C2 授权校验在实现中不存在）：21:281 要求指纹不一致即授权失效，但 `authorization_fingerprint` 在实现中仅被计算（`:923`）与形状校验（`:278`），从无比对；`rebatch` 全文无 fingerprint 校验；后果是 `open --rebatch--> draft --cancel--> closed` 可绕过关闭门禁。

  ### 缺口 B（rebatch 与 reviews 冲突）
  21:176 要求重批保留 `reviews`，而 writer:472 禁止 draft 携带 `reviews`、`rebatch` 结果恰为 draft，二者不可调和；`rebatch` 从未提及 `reviews`，而 writer 注释 `:469` 却写「重批回退时保留」——注释与代码矛盾，属实现漏做。

  ### 缺口 C（rebatch 的 change_log 可被调用方注入）
  `rebatch` 取 `structuredClone(stripCallerOnlyFields(frontmatterAfter))` 的 `change_log`，未比照 `execute`/`revise` 锁定为 `fm.change_log`；起草者实测传入伪造条目即清空对象全部审计历史，违反 21 §8 / 03 §9.5 的权威流水纪律。
scope: 做什么：(A) 在实现层补上 21:281 要求的 C2 校验——校验 `gate_1.authorization_fingerprint` 与当前 `plan`+`scope` 不一致时按规范处置（授权失效并生成局部重批待办），覆盖 `rebatch` 与 `approve` 等适用路径；(B) 使 `rebatch` 对 `reviews` 的处置显式且自洽——采第三方向：`rebatch` 显式作废 `reviews` 并把其要点写入 `change_log`（与 §9.2 对 `criteria_checks` 的既有处置同形），同时把 `21:176` 的「保留原值」改为「保留其历史要点于 `change_log`」；(C) 补相应行为测试（不用正则断源码）；(D) **锁定 `rebatch` 的 Code 托管字段**——`rebatch` 现取调用方 payload 的 `change_log`（实测可注入伪造条目并清空全部审计历史），须比照 `execute`/`revise` 显式锁定为 `fm.change_log`，使调用方无法改写审计流水。明确不做什么：不改 E4 门禁本身（已实施并生效）；不新增任何字段；不改 `plan`/`scope` 形状（不触发 C2）；不改 02/03/06 号规范；不处理 §6.4.3（独立性，已判定为审核误报）；不处理存量 `open` 工单的复核补录（属另一议题）。
plan:
  - done_criteria: 列出全部 7 个 action 中哪些涉及 authorization_fingerprint 比对，以及 21:281 要求比对而实现未比对的确切位置，文件:行号可查
    step: 核实 C2 缺口的确切范围与适用路径
  - done_criteria: 存在可机械判定的校验（重批时新指纹必须不等于 gate_1 存储指纹，否则拒绝）；open --rebatch--> draft --cancel--> closed 的绕过路径被测例覆盖并阻断
    step: 补 C2 校验并处置授权失效路径
  - done_criteria: rebatch 对 reviews 的处置显式（作废 + 要点入 change_log），21:176 文本与实现一致；rebatch 显式锁定 change_log 为 fm.change_log，调用方注入的伪造条目被丢弃；两者均有行为测试断言
    step: 消解 rebatch 与 Code 托管字段的冲突（reviews 处置 + change_log 锁定）
  - done_criteria: writer 测试全绿、web 测试全绿、tsc 0 错误、eslint 无新增；受控提交且 Git Gate passed
    step: 验证三件套与受控提交
gate_1:
  approved_at: 2026-09-17T08:00:20.335Z
  approver: Human
  authorization_fingerprint: 7041fb33427d604cd66915c9f421b1ef0762f2b7a542ddde538c4a45cc297929
  scope_snapshot: 做什么：(A) 在实现层补上 21:281 要求的 C2 校验——校验 `gate_1.authorization_fingerprint` 与当前 `plan`+`scope` 不一致时按规范处置（授权失效并生成局部重批待办），覆盖 `rebatch` 与 `approve` 等适用路径；(B) 使 `rebatch` 对 `reviews` 的处置显式且自洽——采第三方向：`rebatch` 显式作废 `reviews` 并把其要点写入 `change_log`（与 §9.2 对 `criteria_checks` 的既有处置同形），同时把 `21:176` 的「保留原值」改为「保留其历史要点于 `change_log`」；(C) 补相应行为测试（不用正则断源码）；(D) **锁定 `rebatch` 的 Code 托管字段**——`rebatch` 现取调用方 payload 的 `change_log`（实测可注入伪造条目并清空全部审计历史），须比照 `execute`/`revise` 显式锁定为 `fm.change_log`，使调用方无法改写审计流水。明确不做什么：不改 E4 门禁本身（已实施并生效）；不新增任何字段；不改 `plan`/`scope` 形状（不触发 C2）；不改 02/03/06 号规范；不处理 §6.4.3（独立性，已判定为审核误报）；不处理存量 `open` 工单的复核补录（属另一议题）。
reviews:
  - at: 2026-09-22T14:50:15.622Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    implementer_session_id: session-9f528436-9f3e-4431-b239-4da6126394db
    summary: 对象：workcase-8d2ba256（open，待 Gate 2）。基线：HEAD a56857f，工作树仅 6 项无关未跟踪文件。方法：行锚定读对象全文、读 writer 源码、实跑测试、/tmp 副本负向控制。覆盖：缺口 B/C 实现、缺口 A 回退、21 §9.2/§14/§15.1 文本、change_log 截断、37/37、eslint 0、另立单可追溯性。未覆盖：web 测试与 tsc（并发会话中间态）、25 §11 信号。发现：B/C 修复属实且负向控制判别力成立；A 回退属实；截断属实；§9.2 已同步、§14:286 未同步；新增——结果节 criteria_checks 为散文形态（在正文节，非 frontmatter result 字段），Gate 2 提请时须转为 {satisfied, evidence} 对象；对象亦无 reviews。保证边界：仅核实上述范围。
  - at: 2026-09-27T04:52:08.959Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: bea6b11d-ea26-4eac-bf07-24d40eb58e1f
    session_source: host
    implementer_session_id: session-9f528436-9f3e-4431-b239-4da6126394db
    implementer_session_source: host
    summary: 复核完成，结果已发送至父会话。以下为完整复核报告。
  - at: 2026-09-27T04:56:09.179Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: bea6b11d-ea26-4eac-bf07-24d40eb58e1f
    session_source: host
    implementer_session_id: session-9f528436-9f3e-4431-b239-4da6126394db
    implementer_session_source: host
    summary: 复核完成，结果已发送至父会话。以下为完整复核报告。
  - at: 2026-09-27T04:57:33.926Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: bea6b11d-ea26-4eac-bf07-24d40eb58e1f
    session_source: host
    implementer_session_id: session-9f528436-9f3e-4431-b239-4da6126394db
    implementer_session_source: host
    summary: 复核完成，结果已发送至父会话。以下为完整复核报告。
result:
  achieved_scope: 缺口 B（`rebatch` 与 `reviews` 的规范-实现冲突）与缺口 C（`rebatch` 的 `change_log` 可被调用方注入）已修复并有修改前后对照证据——三处转换类 action 显式锁定 `change_log` 为 `fm.change_log`（execute :1877 / rebatch :2253 / revise :2341），`rebatch` 显式作废 `reviews` 并把作废要点记入 `change_log`（:2257-2266），`specs/21` §9.2 已同步修订；两者的行为测试均经负向控制验证具备判别力。隔离子代理独立复核确认上述均在代码中真实在场。缺口 A（C2 授权校验）经核实真实存在，但本轮所实现的判据不成立、已回退，**未达成**。
  criteria_checks:
    - evidence: "`authorization_fingerprint` 的全部出现均为形状与闭集校验（validateGate1）及 approve 时的计算盖戳——无比对；7 个 action 的终态经穷举确认恰好 close/cancel 可达 closed。2026-09-27 独立复核逐类核实同样结论（注释、shape check :641-653、approve 盖戳 :1786、computeAuthorizationFingerprint :479），并确认 assertAuthorizedPairFrozen（execute :1905 调用）属「开放期内容冻结」守卫而非授权失效比对；rebatch 全文无指纹校验。"
      satisfied: true
    - evidence: 所实现的判据经独立复核与起草者自查共同判定不成立：21 §10.3 情形 ③（serves 指向的 sub-goal 被修订）不改变 plan+scope 指纹，故该判据会误拒合法重批；且其为字节级相等判据，改一空格即可绕过，未能真正阻断。已回退；与 cancel 侧缺失合并另立一单（4005b67b）。2026-09-27 独立复核确认回退轨迹（291c447 引入 → 6ac30ec 加校验 → c8f8878 回退）与理由成立。
      satisfied: false
    - evidence: 有修改前/后对照证据：rebatch 现显式锁定 change_log 为 fm.change_log（改前注入伪造条目即替换全部历史；改后伪造条目被丢弃、真实历史保留并追加）；rebatch 现显式 delete next.reviews 并将作废要点记入 change_log（改前携带 reviews 的重批被 writer 拒绝、对象卡在 open；改后通过且 draft 不含 reviews）。specs/21 §9.2 已同步修订；新增 3 条行为断言且有负向控制验证判别力（移除实现即失败）。2026-09-27 独立复核逐处坐实锁定点与作废逻辑，确认行为测试在场（test:868 / :902 / :931）。
      satisfied: true
    - evidence: writer 测试 37/37 全绿（提交时点规模）、eslint 0、受控提交与 Git Gate 均通过（提交 6ac30ec）。**web 测试与 tsc 未能在本单验证**——因并发的另一会话正在修改 11 个 plugin/web 文件（未提交、中间态），本单未触碰 plugin/web 且 web 测试不引用 writer。2026-09-27 独立复核实跑该 writer 套件得 82/82 全绿（37 系时点规模，套件其后扩充，不构成矛盾），但该复核未运行 web 测试、tsc、eslint，故三项在本单仍未取得独立验证。
      satisfied: false
  residual:
    - "**缺口 A 未修复，且已确认其在现有实现下不可机械判定**：21 §10.3 的第三种失效情形（serves 指向的 sub-goal 被修订）不改变 plan+scope 指纹，故无法以指纹比对区分「滥用重批」与「合法重批」；该区分依赖 25 §11 的 goal-changed 待核对 标记，而该标记在实现中不存在（2026-09-27 独立复核全仓搜索确认：仅命中 test/workcase-plan-gate.test.mjs:68 的负向夹具字符串，非实现）。去向：另立工单（对象号 4005b67b）。"
    - "**cancel（draft→closed）不校验 reviews**，与 21:169「closed ⇒ reviews 必填」冲突；故「先 rebatch 回 draft 再 cancel」仍可绕开 §14 的关闭前置。该冲突先于本单存在。去向：另立工单（与缺口 A 合并，对象号 4005b67b）。"
    - "**本对象自身的 change_log 曾被截断（起草者过失，如实登记）**：为合法扩围，起草者在缺口 C 尚未修复时运行了 rebatch；当时的 rebatch 取调用方 payload 的 change_log，起草者未传，故「受控创建」与「首次 Gate 1 批准」两条历史条目被整体替换（提交 4753420 版本含创建条目，其后版本不含）。按 03 §6.1「不追溯改写」，这两条不予补回；此处如实登记该事实与成因，不掩盖。这同时构成缺口 C 的真实活体演示——修复前该缺陷可被无意触发，不限于恶意注入。"
    - 步骤 4 的 web 测试与 tsc 因并发会话的未提交改动无法在本单验证（本单未触碰 plugin/web）。去向：接受现状（该三项对判定本单成果无判别作用；当前仓库 HEAD 的 tsc 已为 0 错误）。
    - gate_1 缺失时 C2 校验 fail-open（带内不可达——approve 必盖章、execute 锁定 gate_1）。去向：直接行动（把该校验由 fail-open 改为 fail-closed）。
    - 独立复核指出 specs/21-WorkCase-工单.md §14 的局部重批条目未同步 reviews 处置（§9.2 与 §15.1 已修订）。2026-09-27 独立复核确认该登记属实（§14:354 确未提 reviews 处置）。去向：另立工单（对象号 81c37ef0）。
    - "**本单的 reviews 含 3 条仅 25 字符的重复短条目（2026-09-27 关闭时如实登记）**：内容为「复核完成，结果已发送至父会话。以下为完整复核报告。」，系宿主子代理结论捕获的竞态所致——隔离子代理的 turn 2（七要素概要）未被捕获，record_review 反复取到 turn 1 的转场句。按 21 §8「已携带 session_id 的条目是历史记录，不得改写、不得压缩或静默丢弃既有条目」，不予删除或改写；本条为该事实的如实登记。此现象属实现层观测到的捕获竞态，未在本单授权范围内处置。"
    - 浏览器/运行时视觉验证未核验：2026-09-27 独立复核未运行 web 测试、tsc、eslint，亦未做运行时负向注入重演（其结论基于代码路径实读与既有测试断言）。去向：接受现状（本单改动集中于 writer 服务端逻辑，已有行为测试覆盖）。
outcome: partial
created_at: 2026-09-17T06:51:23.939Z
change_log:
  - at: 2026-09-17T07:59:50.891Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: C2 局部重批：扩围纳入缺口 C（rebatch 的 change_log 可被调用方注入，实测可清空审计历史）——起草者在步骤 1 核实中实测发现该漏洞，经 Human 批准纳入；scope 增列 (D) 锁定 Code 托管字段，摘要与计划同步更新为三处缺口 [C2 局部重批 open→draft; attempt 1 voided, gate_1 dropped — 重新组织后重走 Gate 1]
  - at: 2026-09-17T08:00:20.335Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 1 重新批准（C2 局部重批后）——Human 确认扩围纳入缺口 C（rebatch 的 change_log 可被调用方注入）；授权指纹重新绑定扩围后的 plan+scope，范围增至三处缺口 [gate_1 approved by Human; attempt 2 allocated to deepseek-v4.1-flash@dsh-ldvh-session]
  - at: 2026-09-17T09:14:02.449Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 执行期记录：缺口 B/C 已修复（含修改前后对照与负向控制验证）；缺口 A 的判据经复核判定不成立并已回退，连同 cancel 侧门禁缺失另立一单；如实登记本对象 change_log 曾在缺口 C 修复前被截断（起草者过失） [attempt 2 heartbeat refreshed]
  - at: 2026-09-18T02:03:34.410Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 落档独立结果复核概要（reviews）：缺口 B/C 修复经源码实读与负向控制核实属实、缺口 A 回退与 change_log 截断均属实；补记 §14:286 未同步、criteria_checks 正文形态需在 Gate 2 提请前转为 result 字段对象、以及另立单对象号 4005b67b/81c37ef0 的可追溯登记 [attempt 2 heartbeat refreshed]
  - at: 2026-09-18T11:21:15.383Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 迁移：补齐 gist 要点字段（21 §8，WorkCase d5273e1c） [attempt 2 heartbeat refreshed]
  - at: 2026-09-22T14:50:15.622Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "格式治理：摘要分块（忠实重排）——把作者自撰的行内「：」提为 ### 块首并插入空行，使摘要可读且符合 21 §8 书写结构（H3 骨架）；作者原文逐字未改，仅新增标记与空行 [attempt 2 heartbeat refreshed]"
  - at: 2026-09-23T19:05:35.697Z
    provider: deepseek-official
    model: deepseek-flash
    summary: 结果节新增 `- advice:` 建议段，并按 21 §8 把原先写在 residual 条目内的「建议…」子句移入该段（建议只有一处正文承载） [attempt 2 heartbeat refreshed]
  - at: 2026-09-24T02:48:24.820Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 格式治理：建议去向词按 21 §8 新闭集四词归一（更正/改进/补录 → 直接行动），措辞与语义未变 [attempt 2 heartbeat refreshed]
  - at: 2026-09-27T04:39:13.152Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "冷恢复接管孤立 attempt：原持有者会话已结束、attempt 缺 session_id 致关闭门禁 fail-closed；经副作用核对（21 §10.4 第 3 点：所述提交 6ac30ec/4753420 均为 HEAD 祖先、所述 change_log 锁定改动在代码中）后以 takeover 建立身份基准，使独立复核与 Gate 2 在机械上可达 [attempt 2 taken over → attempt 3 (controller: deepseek-v4.1-flash@dsh-ldvh-session (cold-recovery takeover))]"
  - at: 2026-09-27T04:52:08.959Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "复核：落档隔离子代理（bea6b11d）的独立冷读复核结论 [review recorded by session bea6b11d-ea26-4eac-bf07-24d40eb58e1f; reviews entries: 2; 记录自子代理会话 bea6b11d-ea26-4eac-bf07-24d40eb58e1f 的最终产出（Code 捕获）]"
  - at: 2026-09-27T04:56:09.179Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "复核：追加复核者的七要素完整概要（其最新结论首段）——补足先一条自动取段仅 25 字符、不含 02 §15 判据七要素的缺口 [review recorded by session bea6b11d-ea26-4eac-bf07-24d40eb58e1f; reviews entries: 3; 记录自子代理会话 bea6b11d-ea26-4eac-bf07-24d40eb58e1f 的最终产出（Code 捕获）]"
  - at: 2026-09-27T04:57:33.927Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "复核：追加复核者的七要素完整概要——补足前两条自动取段（25 字符转场句）不含 02 §15 判据七要素的缺口 [review recorded by session bea6b11d-ea26-4eac-bf07-24d40eb58e1f; reviews entries: 4; 记录自子代理会话 bea6b11d-ea26-4eac-bf07-24d40eb58e1f 的最终产出（Code 捕获）]"
  - at: 2026-09-27T05:17:36.965Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 2 关闭（outcome=partial）：四条判据逐条核对为 达成/未达成/达成/部分达成；缺口 B/C 修复经隔离子代理（bea6b11d）独立复核坐实（三处 change_log 锁定、reviews 作废、行为测试在场、82/82 全绿），缺口 A 判据不成立已回退且回退轨迹与理由经复核确认；criteria_checks 按 4 步 plan 转写为对象形态；residual 8 条逐条给出去向（另立工单 2 / 直接行动 2 / 接受现状 1 / 本单未处置 1，另含性质说明） [gate_2 closed with outcome=partial; attempt 3 retracted]
  - at: 2026-10-01T17:29:56.563Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 事实更正（非状态转换）——存量迁移（分离式→合并式）：正文「## 结果」节把独立 `- advice:` 段并入各残留之下的去向子项，8 条残留全部落「接受现状」并各写明自足理由；退役词「另立工单」「直接行动」随之取消；两处承接关系改由引用形态承载（承接方 refs 声明，本卡引用区呈现）。终态判定未变：status/outcome/result/gate_1/attempt/plan/scope/reviews 逐字继承落盘对象（本入口不接收 frontmatter，故改动在结构上不可能），仅正文重写。依 21 §9.2「若原终态记录本身错误，按事实更正规则修正，不把更正伪装成领域状态转换」与 03 §9.5，经 Human 授权：Human 2026-10-01 授权（原话「按你建议推进，并规范化」）：把 workcase-8d2ba256 的去向由分离式迁为合并式，8 条残留全部落「接受现状」并各写自足理由；两处承接关系改由引用形态承载（承接方 refs 声明）；经 correct 通道只改正文，status/outcome/result/reviews 逐字不变。
---

# C2 授权校验与 rebatch×reviews 处置

## 摘要

补上 WorkCase 授权钉扎（C2）在实现层的缺口与 `rebatch` 对 Code 托管字段的处置缺陷，使「授权指纹失效」被机械检测、且重批（rebatch）对 `reviews`/`change_log` 的处置自洽。本单合并三处经对抗审核与起草者亲验确认的既有缺陷（均先于 E4 存在，由 E4 暴露）：缺口 A（C2 授权校验在实现中不存在）：21:281 要求指纹不一致即授权失效，但 `authorization_fingerprint` 在实现中仅被计算（`:923`）与形状校验（`:278`），从无比对；`rebatch` 全文无 fingerprint 校验；后果是 `open --rebatch--> draft --cancel--> closed` 可绕过关闭门禁。

### 缺口 B（rebatch 与 reviews 冲突）
21:176 要求重批保留 `reviews`，而 writer:472 禁止 draft 携带 `reviews`、`rebatch` 结果恰为 draft，二者不可调和；`rebatch` 从未提及 `reviews`，而 writer 注释 `:469` 却写「重批回退时保留」——注释与代码矛盾，属实现漏做。

### 缺口 C（rebatch 的 change_log 可被调用方注入）
`rebatch` 取 `structuredClone(stripCallerOnlyFields(frontmatterAfter))` 的 `change_log`，未比照 `execute`/`revise` 锁定为 `fm.change_log`；起草者实测传入伪造条目即清空对象全部审计历史，违反 21 §8 / 03 §9.5 的权威流水纪律。

## 授权范围

做什么：(A) 在实现层补上 21:281 要求的 C2 校验——校验 `gate_1.authorization_fingerprint` 与当前 `plan`+`scope` 不一致时按规范处置（授权失效并生成局部重批待办），覆盖 `rebatch` 与 `approve` 等适用路径；(B) 使 `rebatch` 对 `reviews` 的处置显式且自洽——采第三方向：`rebatch` 显式作废 `reviews` 并把其要点写入 `change_log`（与 §9.2 对 `criteria_checks` 的既有处置同形），同时把 `21:176` 的「保留原值」改为「保留其历史要点于 `change_log`」；(C) 补相应行为测试（不用正则断源码）；(D) **锁定 `rebatch` 的 Code 托管字段**——`rebatch` 现取调用方 payload 的 `change_log`（实测可注入伪造条目并清空全部审计历史），须比照 `execute`/`revise` 显式锁定为 `fm.change_log`，使调用方无法改写审计流水。明确不做什么：不改 E4 门禁本身（已实施并生效）；不新增任何字段；不改 `plan`/`scope` 形状（不触发 C2）；不改 02/03/06 号规范；不处理 §6.4.3（独立性，已判定为审核误报）；不处理存量 `open` 工单的复核补录（属另一议题）。

## 计划

- 核实 C2 缺口的确切范围与适用路径：判据——列出全部 7 个 action 中哪些涉及 authorization_fingerprint 比对，以及 21:281 要求比对而实现未比对的确切位置，文件:行号可查
- 补 C2 校验并处置授权失效路径：判据——存在可机械判定的校验（重批时新指纹必须不等于 gate_1 存储指纹，否则拒绝）；open --rebatch--> draft --cancel--> closed 的绕过路径被测例覆盖并阻断
- 消解 rebatch 与 Code 托管字段的冲突（reviews 处置 + change_log 锁定）：判据——rebatch 对 reviews 的处置显式（作废 + 要点入 change_log），21:176 文本与实现一致；rebatch 显式锁定 change_log 为 fm.change_log，调用方注入的伪造条目被丢弃；两者均有行为测试断言
- 验证三件套与受控提交：判据——writer 测试全绿、web 测试全绿、tsc 0 错误、eslint 无新增；受控提交且 Git Gate passed

## 执行

- 步骤 1 完成：C2 缺口已核实——`authorization_fingerprint` 在实现中**仅被计算**（`approve` 时）与**形状校验**（64-hex），**从无任何代码将其与当前 `plan`+`scope` 比对**。全部 7 个 action 的 status 前置与终态亦已穷举：**恰好 `close` 与 `cancel` 两条可达 `closed`，而只有 `close` 受 E4 门禁**。
- 步骤 1 期间**发现缺口 C**（超出原 scope）：`rebatch` 取调用方 payload 的 `change_log`，实测传入伪造条目即**清空对象全部审计历史**。经 Human 批准，以 **C2 局部重批**合法扩围（`open → draft → 重走 Gate 1`），scope 增列 (D)。
- 步骤 2（**后经复核判定不成立并已回退**）：曾实现「重批时提交的 `plan`+`scope` 指纹必须不等于 `gate_1` 存储指纹」的判据。独立复核与起草者自查共同认定该判据**不成立**——21 §10.3 的第三种法定失效情形（`serves` 指向的 sub-goal 被修订）**不改变 `plan`+`scope` 指纹**，故该判据会**误拒合法重批**；且其判据为字节级相等，**改一个空格即可绕过**，未能真正阻断。**已回退**；缺口 A 与「`cancel` 侧无 `reviews` 门禁」合并另立一单。
- 步骤 3 完成：`rebatch` 现显式锁定 `change_log` 为 `fm.change_log`（**改动前**：注入伪造条目即替换全部历史；**改动后**：伪造条目被丢弃、真实历史保留并追加）；`rebatch` 现显式 `delete next.reviews` 并将作废要点记入 `change_log`（**改动前**：携带 `reviews` 的重批被 writer 拒绝、对象卡在 `open`；**改动后**：通过且 `draft` 不含 `reviews`）。
- 步骤 4 完成：writer 测试 **37/37**、eslint 0；受控提交 `6ac30ec`（初版）与本次修订提交。
- 2026-09-18 独立结果复核落盘（reviews）：缺口 B/C 的修复经源码实读 + 实跑测试 + /tmp 副本负向控制核实属实，判别力成立；缺口 A 回退属实；`change_log` 截断属实（创建条目与首次 Gate 1 批准条目确已消失，成因与自述一致）。复核另确认 §9.2 已同步而 §14:286 仍未同步，且结果节的 `criteria_checks` 为正文散文形态（非 `result` 字段）——Gate 2 提请时须转为 `{satisfied, evidence}` 对象。
- 2026-09-27 冷恢复接管（本会话）：原 attempt 2 的持有者会话已结束，成为孤立 attempt；经 21 §10.4 第 3 点要求的副作用核对（所述提交 `6ac30ec`/`4753420` 经 `git merge-base --is-ancestor` 确认均为 HEAD 祖先；所述 `change_log` 锁定改动经代码实读确认在场，writer 现于 execute/rebatch/revise 三处锁定 `fm.change_log`），以 `takeover` 分配 attempt 3 并建立身份基准——原 attempt 缺 `session_id`/`session_source`，使关闭侧独立性比对无基准、Gate 2 机械不可达。
- 2026-09-27 隔离子代理独立复核（bea6b11d，与本单实施者不同会话）：只读复核（行锚定读对象与 writer 源码、`git log -S`/`merge-base`/`show` 取证、21/25 规范原文比对、实跑 `node --test`）。独立坐实：缺口 B/C 修复真实在场——`next.change_log = fm.change_log` 三处锁定（`:1877` execute、`:2253` rebatch、`:2341` revise），`rebatch` 显式作废 reviews 并把要点记入 `change_log`（`:2257-2266`），`create`/`approve` 由 Code 构造、`close`/`cancel` 用 `structuredClone(fm)` 天然继承，故经受控工具面已无法注入伪造条目；行为测试在场（test:868 / :902 / :931）。缺口 A 回退属实且回退轨迹可查（`291c447` 引入 → `6ac30ec` 加校验 → **`c8f8878` 回退**），回退理由成立（§10.3 情形 ③ 不改变 plan+scope 指纹，指纹比对会误拒合法重批；且字节级判据改一空格即绕过）。25 §11 的 goal-changed 标记确不存在（全仓搜索仅命中测试夹具字符串）。writer 测试 **82/82** 全绿。复核结论：**与事实相符、可据实关闭**；未发现任何虚假声明；按其授权范围（(A) 项明确要求补 C2 校验而未达成）outcome 应判 **partial**。

## 结果

- criteria_checks:
  - 步骤 1 判据「列出 7 个 action 中哪些涉及 `authorization_fingerprint` 比对，以及未比对的确切位置，文件:行号可查」：**达成**。`authorization_fingerprint` 的全部出现均为形状与闭集校验（`validateGate1`）及 `approve` 时的计算盖戳——**无比对**；7 个 action 的终态经穷举确认恰好 `close`/`cancel` 可达 `closed`。证据见「## 执行」第 1 条。2026-09-27 独立复核逐类核实同样结论（注释、validateGate1 形状校验 :641-653、approve 盖戳 :1786、computeAuthorizationFingerprint :479），并确认 `assertAuthorizedPairFrozen`（execute :1905 调用）比对的是落盘对象与 payload 的 plan+scope——属「开放期内容冻结」守卫，**不是**与 `gate_1.authorization_fingerprint` 的授权失效比对；`rebatch` 全文无指纹校验。
  - 步骤 2 判据「存在可机械判定的校验；绕过路径被测例覆盖并阻断」：**未达成**。所实现的判据经独立复核与起草者自查共同判定不成立（误拒 §10.3 情形 ③ 的合法重批；且字节级判据可被一个空格绕过），**已回退**。该缺口与 `cancel` 侧缺失合并另立一单。2026-09-27 独立复核确认回退轨迹（`c8f8878`）与理由成立。
  - 步骤 3 判据「`rebatch` 的 reviews 处置显式、21:176 文本与实现一致；`change_log` 被锁定、注入的伪造条目被丢弃；两者均有行为测试断言」：**达成**。有修改前/后的对照证据（见「## 执行」步骤 3）；`specs/21-WorkCase-工单.md` §9.2 已同步修订；新增 3 条行为断言并有负向控制验证判别力（移除实现即失败）。2026-09-27 独立复核逐处坐实锁定点与作废逻辑，并确认行为测试在场。
  - 步骤 4 判据「writer 测试全绿、web 测试全绿、tsc 0 错误、eslint 无新增；受控提交且 Git Gate passed」：**部分达成**。writer 测试 37/37 全绿、eslint 0、受控提交与 Git Gate 均通过；**web 测试与 tsc 未能在本单验证**——因并发的另一会话正在修改 11 个 `plugin/web` 文件（未提交，处于中间态），其错误与本单改动无关（本单未触碰 `plugin/web`，且 web 测试不引用 writer）。2026-09-27 独立复核实跑该 writer 套件得 **82/82 全绿**（工单自述 37/37 系其提交时点的规模，其后套件已扩充，不构成矛盾）；该复核**未运行** web 测试、tsc、eslint，故此三项在本单仍未取得独立验证。

- achieved_scope: 缺口 B（`rebatch` 与 `reviews` 的规范-实现冲突）与缺口 C（`rebatch` 的 `change_log` 可被注入）**已修复并有修改前后对照证据**，两者的行为测试均经负向控制验证具备判别力。缺口 A（C2 授权校验）**经核实真实存在，但本轮所实现的判据不成立、已回退，未达成**。故本单授权范围中 (A) 项未达成，(B)(C)(D) 三项达成。

- residual:
  - **缺口 A 未修复，且已确认其在现有实现下不可机械判定**：21 §10.3 的第三种失效情形（`serves` 指向的 sub-goal 被修订）**不改变 `plan`+`scope` 指纹**，故无法以指纹比对区分「滥用重批」与「合法重批」；该区分依赖 25 §11 的 `goal-changed 待核对` 标记，而**该标记在实现中不存在**（2026-09-27 独立复核全仓搜索确认：仅命中 `test/workcase-plan-gate.test.mjs:68` 的负向夹具字符串，非实现）。
    - **接受现状**：该项原意向为另立工单处置；**承接关系已由引用形态承载**——`workcase-4005b67b`（关闭侧授权与复核门禁）已在自身 `refs` 中声明承自本单（见本卡引用区的关联行），本单不再跟踪。
  - **`cancel`（draft→closed）不校验 `reviews`**，与 21:169「`closed` ⇒ `reviews` 必填」冲突；故「先 `rebatch` 回 `draft` 再 `cancel`」仍可绕开 §14 的关闭前置。**该冲突先于本单存在**。
    - **接受现状**：原拟与缺口 A 合并另立一单（对象号 `4005b67b`）；该承接方即 `workcase-4005b67b`，其 `refs` 已声明承自本单，本单不再跟踪。
  - **本对象自身的 `change_log` 曾被截断（起草者过失，如实登记）**：为合法扩围，起草者在**缺口 C 尚未修复时**运行了 `rebatch`；当时的 `rebatch` 取调用方 payload 的 `change_log`，起草者未传，故「受控创建」与「首次 Gate 1 批准」两条历史条目被整体替换（提交 `4753420` 版本含创建条目，其后版本不含）。按 03 §6.1「不追溯改写」，这两条**不予补回**；此处如实登记该事实与成因，不掩盖。这同时构成缺口 C 的**真实活体演示**——修复前该缺陷可被**无意**触发，不限于恶意注入。
    - **接受现状**：按 `03 §6.1` 不追溯改写、两条历史条目不予补回；该事实与成因已在本条如实登记，缺陷（缺口 C）已修复并有修改前后对照证据与行为断言，故就此了结。
  - 步骤 4 的 web 测试与 tsc 因并发会话的未提交改动无法在本单验证（本单未触碰 `plugin/web`）。
    - **接受现状**：本单改动不涉及 `plugin/web`，那三项对判定本单成果无判别作用；当前仓库 HEAD 的 tsc 已为 0 错误，无需回溯补验。
  - `gate_1` 缺失时 C2 校验 fail-open（带内不可达——`approve` 必盖章、`execute` 锁定 `gate_1`）。
    - **接受现状**：该 fail-open 在**带内不可达**（`approve` 必盖章、`execute` 锁定 `gate_1`），故不构成现实路径；且 `workcase-4005b67b` 的授权范围**明确不处理**此项（其 `scope` 写明「不处理 `gate_1` 缺失时 C2 fail-open 一事」），本单就此了结、不再跟踪。
  - 独立复核另指出 `specs/21-WorkCase-工单.md` §14 的局部重批条目未同步 `reviews` 处置（§9.2 与 §15.1 已修订），§14 条目待随另立单一并收口。2026-09-27 独立复核确认该登记属实（§14:354 确未提 reviews 处置）。
    - **接受现状**：原拟随另立单一并收口；**承接关系已由引用形态承载**——`workcase-81c37ef0`（清理 writer 注释与规范条目不一致）已在自身 `refs` 中声明承自本单（其 `summary` 明确列入本项），本单不再跟踪。
  - 独立复核补充项（2026-09-18）：本结果节的 `criteria_checks` 现为**正文散文形态**，而 21 §8 的 `result` 字段要求 `criteria_checks` 每项为 `{satisfied: boolean, evidence: 非空字符串}` 且长度与 `plan` 一致——Gate 2 提请时须据此转写为对象形态（本项为提请前的转写要求，非对象缺陷）。**本项已在本次关闭时处置**：`result.criteria_checks` 已按 4 步 plan 逐条转写为对象形态。另：本对象在复核时仍无 `reviews`，该记录由本次写入补足。
    - **接受现状**：本项已在关闭时处置（`result.criteria_checks` 已按 4 步 plan 转写为对象形态、`reviews` 已由本次写入补足）；原拟「后续清理时登记两个对象号」一事，由本次迁移的正文与引用区一并完成，无需再跟踪。
  - **本单的 `reviews` 含 3 条仅 25 字符的重复短条目（2026-09-27 关闭时如实登记）**：其内容为「复核完成，结果已发送至父会话。以下为完整复核报告。」，系宿主子代理结论捕获的**竞态**所致——隔离子代理的 `turn 2`（七要素概要）未被捕获，`record_review` 反复取到 `turn 1` 的转场句。按 21 §8「已携带 `session_id` 的条目是历史记录，不得改写、不得压缩或静默丢弃既有条目」，**不予删除或改写**；本条为该事实的如实登记。较完整的七要素复核概要见同批 `record_review` 写入的会话 transcript 与本单 change_log。此现象属**实现层观测到的捕获竞态**，未在本单授权范围内处置。
    - **接受现状**：按 `21 §8` 既有条目不得改写或静默丢弃，故保留原样；该捕获竞态属实现层观测、载体自述「未在本单授权范围内处置」，本单不再跟踪。

