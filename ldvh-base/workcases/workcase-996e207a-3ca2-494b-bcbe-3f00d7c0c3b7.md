---
fact_type_key: workcase
object_uid: 996e207a-3ca2-494b-bcbe-3f00d7c0c3b7
title: 事实对象指称须带类型与标题
status: draft
gist: 把「事实对象指称必须自带类型前缀与标题」定为规范要求：当下对话、提交消息与规范正文普遍只写裸短标识，读者看不出对象属于哪一类型、标题是什么，必须另行回查。本单需 Human 决定该条款落在哪份规范、覆盖哪些消费面。
serves: SG-1
summary: |-
  把「描述事实对象必须带有事实对象类型」落成规范要求，先固定现状口径与落点。候选口径：事实对象的**指称形态**——即在对话、正文、提交消息与派生输出中指称一个对象时的最小可读形式——最小形态为「类型短名 + 短标识」（如 `friction-abf557e1`）；需要读者据此辨认对象时，紧随其标题（如 `friction-abf557e1 局部改动时以记忆或截断输出为数据源`）。

  ### 现状核实（本轮机械核验）
  - `specs/` 内共 8 处裸 8 位短标识，实测位置为 `04:166` 的 `82260dec`、`21:467`／`21:468`／`21:469`／`21:470` 的 `b57780cb`／`1a895068`／`e0bab773`／`e0bab773`（**`e0bab773` 出现两次**）、`26:203`／`26:204` 的 `bf73fad4`（两次）、`26:222` 的 `71930c4a`。其中 `b57780cb`、`1a895068`、`e0bab773` 在 `ldvh-base/` 事实源内**无任何可解析载体**（全库唯一命中即本单自身），读者无从定位。
  - `ldvh-base/` 正文中裸 8 位串的数量是本工单须固定的口径项，**不在此写死数值**（事实源随写入增长，固定值必然后续失真）。可复现口径与命令见计划步骤 1。
  - 事实类型工具的投影**分四层，形态并不统一**（经五轮审核实测，行号按当前工作树逐条核对）：
    - **列表渲染层**：`spark`／`workcase`／`adr`／`pitfall`／`friction` 五个工具输出「裸 `object_uid` + 标题」行且不带 `fact_type_key`（`spark-tools.js:665`、`workcase-tools.js:1053`、`adr-tools.js:416`、`pitfall-tools.js:414`、`friction-tools.js:501`）。类型短名**不在渲染层可得**——writer 层投影投出的 item 字段为 `object_uid/title/status/…`，**不含 `fact_type_key`**（`spark-writer.js:903`、`workcase-writer.js:3963`、`pitfall-writer.js:681`、`friction-writer.js:1115`、`adr-writer.js:751`；`listAdrObjects` 见 `adr-writer.js:698-762`），故改造须同时覆盖 writer 层投影。
    - **读取 envelope 层**：五个工具各有 `object: ${result.object_uid}` 行（`adr-tools.js:399`、`spark-tools.js:641`、`pitfall-tools.js:398`、`friction-tools.js:485`、`workcase-tools.js:1039`），另有 `spark-tools.js:648` 的 `refs:` 行。
    - **变更流水行**：`change: ${change.change} ${change.object_uid}` 六处同型（`adr-tools.js:419`、`spark-tools.js:668`、`workcase-tools.js:1056`、`pitfall-tools.js:417`、`friction-tools.js:504`、`research-tools.js:598`）。
    - **其它渲染点**：`spark-tools.js:252` 的关系渲染 `${relation_key} → ${target.object_uid}`；`norm-tools.js:368` 的 gaps 行 `object_uid=${entry?.object_uid}`；`research-tools.js` 的 `renderEnvelope`（`research-tools.js:579-602`）输出 `object:`／`title:`（`object:` 在 :584、`title:` 在 :585）；`norm-tools.js` 的 `renderEnvelope`（`norm-tools.js:430-442`）直接 `JSON.stringify(env.result)`（`norm-tools.js:433`）；`experience-capture-contract.js:119` 与 `friction-subagent-contract.js:134` 两处同型列表渲染（`uid=` + `status` + `title`）。
  - **`research` 无列表操作**：其 `OPERATIONS` 仅 `research-session-machine`／`research-read-object`／`research-write-object`（`research-tools.js:45-58`，定义于 :46/:51/:56），故 research 不存在「列表投影」改造面，只有读取路径（`renderEnvelope`）需对齐。
  - 提交消息：`git log -60` 区间内带类型前缀的 `<type>-<uid>` 出现 73 处，**其中 44 处是文件路径片段**（如 `ldvh-base/frictions/friction-abf557e1`，不是指称形态问题），正文中的独立指称仅约 29 处；孤立裸 8 位短标识约 56 处（27 个去重值，已剔除非标识误命中）。故**就正文独立指称而言，裸写多于带前缀**（此前两稿分别写「20 余处为裸串」与「带前缀多于裸写」，均不准确，经第四轮审核更正）。口径提示：该计数随 `git log` 窗口与正则边界变化，**精确值以计划步骤 1 的可复现命令所出为准**，本单不以其固定值作为判据；步骤 1 须同时给出「路径片段 / 正文独立指称」的分类拆分。

  ### 落点建议（待 Human 决定）
  唯一权威归 `02`——该规范已承接公共身份字段 `object_uid` 与 `fact_type_key`（含类型短名值域）、稳定引用原则与载体权威位置；形态条款拟落在 §7 之下。各消费面（09 提交消息、05/06 CLI 与 Code 输出、07/10 呈现与注入）以一行回指承接，不在各自复制展开；**这些回指的写入不在本单授权内**（见授权范围）。

  ### 规范的落盘与生效路径（经建前独立审核补入）
  `02` 正文的修改属规范源变更，不在 WorkCase 授权内自行生效：条款须经 `01 §9.2` 第 8、9、11、12 项所要求的独立审核、Human 决定、受控提交与指纹绑定后，才成为规则源成员。本单的授权边界是**形成候选并提请决定**；落盘与生效由 Human 决定后的受控提交路径执行，本单不代为宣称条款已生效。

  ### 待决范围
  条款覆盖面（是否含提交消息与规范正文）、是否为其设机械门禁（若设，**具体面**是哪些——对话正文面已在授权范围中排除）、既有裸引用的存量是否回改。

  ### 关于「Human 决定」的判据设计（经第三轮审核修订）
  前稿把「取得 Human 决定」写成步骤完成条件，并配「未取得则登记待决并交还」的无条件兜底——该形态使步骤在**无任何工作**时即可宣称达成。故本版改为**状态绑定式**：Human 决定不是本单的完成判据，而是**改造步骤的启动前置**；未取得决定时，对象保持 `open` 并如实登记待决、交还 Human，**不以「已登记待决」充当步骤达成**。
scope: |-
  做什么：
  - 核实并固定事实对象指称的跨面现状（规范正文、事实对象正文、工具响应、提交消息），给出判据、去重口径、可复现命令、分类拆分与不可解析清单；
  - 在 02 形成准确候选条款，规定事实对象指称的最小形态与适用范围；
  - 逐份列出受该条款约束或需回指承接的消费面载体；
  - 按 Human 采纳的条款对齐工具响应投影，改造面按**四层实际路径**枚举：① 五个列表渲染器（spark/workcase/adr/pitfall/friction）**及其 writer 层投影**（使 `fact_type_key` 可达）；② 五个读取 envelope 的 `object:` 行与 `spark-tools.js:648` 的 refs 行；③ 六处 `change:` 变更流水行（adr:419／spark:668／workcase:1056／pitfall:417／friction:504／research:598）；④ `spark-tools.js:252` 关系行、`norm-tools.js:368` gaps 行、research 的 `renderEnvelope`、norm 的 JSON 输出、`experience-capture-contract.js:119` 与 `friction-subagent-contract.js:134` 两处同型渲染。research 无列表操作，不在「列表」改造面内。并补相应契约测试。

  明确不做什么：
  - 不改 00（受保护内容），不改 README、LICENSE 与版本声明点；
  - 不在本单内处置既有裸引用的存量改写（是否回改、改到哪一层由 Human 另行决定）；
  - 不改任何事实类型的字段闭集、状态机、关系 key 与 CAS 语义；
  - 不新增事实类型，不改变 `fact_type_key` 的值域与类型短名登记；
  - 不为 AI 的对话正文设机械门禁（该面无判据，属独立复核与 Human 阅读范围）；
  - 不自行将 02 条款落盘生效——该动作归属 Human 决定后的规范受控提交路径，本单只形成候选并提请（见摘要「规范的落盘与生效路径」）；
  - **不写入 09／05／06／07／10 等消费面规范的「一行回指」**——该写入既不在本单授权内，也不由本单执行；本单只出具回指文本草案随候选一并呈交，其落盘按各规范的受控提交路径另行处理；
  - 不在未获 Human 决定前启动工具投影改造（改造步骤以「决定记录存在且为采纳」为启动前置，非完成判据）；
  - 不为 `experience-capture-contract.js` 与 `friction-subagent-contract.js` 两处引入新的输出契约——仅按采纳条款对齐其指称形态，不改其消息语义。
plan:
  - done_criteria: 四处清点结果以可逐条回读的形式交出：每处给出命中判据、可复现的检索命令、去重计数与不可解析项清单；不写死数值，数值须可由所给命令重算复现。提交消息面须按「文件路径片段 / 正文独立指称」分类拆分，并分别给出裸写与带类型前缀的计数。
    step: 核实并固定事实对象指称的跨面现状（规范正文、事实对象正文、工具响应、提交消息），给出判据、去重口径、可复现命令、分类拆分与不可解析清单。
  - done_criteria: 候选含条款正文（最小形态、适用范围、边界与未验证范围）、受影响载体清单（逐份点名，含各消费面的一行回指草案），以及依 `01 §9.2` 第 8／9／11／12 项的落盘生效路径说明。本步只以「候选与清单已成形并落盘」为判据，不含呈交动作（呈交属步骤 3）。
    step: 在 02 形成规定事实对象指称最小形态的准确候选，并逐份列出需回指承接的消费面载体。
  - done_criteria: 候选条款、受影响载体清单与待决选项已明示呈交；呈交记录落盘，含所针对的候选版本标识与呈交日期。本步骤以「已呈交」为唯一判据，不要求取得答复。
    step: 将候选、载体清单与待决选项呈交 Human，并把「已呈交、待决定」这一状态落成可回读记录。
  - done_criteria: 二择一，且二者可机械区分：(a) 已取得决定——Human 的决定（采纳／否决／改落点／待议）已记录，含决定内容、时间、所针对的候选版本与决定人；此为该步的达成。(b) 未取得决定——如实登记「待决」并交还 Human；此情形下本步不计为达成，对象保持 `open`、`outcome` 不得据此关闭，且后续步骤 5 不得启动。不得以「已登记待决」宣称本步完成。
    step: 取得 Human 就候选作出的决定并落成记录；未取得时如实登记待决并交还，改造不得启动。
  - done_criteria: 启动前置成立（步骤 4 的结果为 (a) 且决定为「采纳」）；改造覆盖授权范围枚举的四层路径，逐条以回读的实际输出为证（列表类、读取类、变更流水类、其它渲染点分别取证）；契约测试通过并给出通过计数。若 Human 决定为否决或改落点，本步骤不执行，并在交还说明中登记为「按决定未执行」，不得以「已登记未执行原因」宣称本步骤达成。
    step: 按 Human 采纳的条款对齐工具响应投影：按四层实际路径改造，使其带类型短名与标题，并补契约测试。
pre_reviews:
  - at: 2026-10-17T06:18:45.404Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 对象恰当性：符合——裸标识 04:166／26:203,204,222 复核一致；02 §7.1/§7.2 确承接 object_uid、fact_type_key 值域与权威位置，serves SG-1 见 goal.md:33；「形成候选条款」非 21 §6.3「已定决策的表达」，不触排除清单（01 §9.2 第8/9/11/12 项路径未在 scope 留痕）。方案可行性：不符——plan[3]（40-41 行）以「按 Human 采纳的条款」为前提，全文未写 Human Gate 由谁发起、采纳与否如何落盘、否决或改落点如何处置，外部依赖使 done_criteria 判定不完整；机械数据三处漂移：21 实为 467–470（写 463–466，e0bab773 出现两次）；163/102/61 不可复现（实测 168=103+65，剔除本单 165=103+62，仅正文 92=67+25）；research/norm-tools.js 无 uuid+标题投影（575/429 行改渲染 envelope／JSON），「七类各一处」不成立。scope 清晰度：结构符合（23/29 行两标签各独占一行、内容在其下；summary 分块首行 H3 见 11/17/20）；覆盖不符——scope 未写 02 正文落盘的受控提交授权或禁止，与「不改 00」不冲突。
    session_id: 62d331bd-cacc-4da1-904c-bbc45d27d489
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: 545fbc3e2f47e90dbd13bc923919e73ec022c95b8420260afb3e22701a05e0b7
    verdict: needs_revision
  - at: 2026-10-17T06:37:09.947Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: I verified all three second-round items against the current candidate. Findings below.
    session_id: a1b4d731-fb27-4af2-b1b0-082ad27f23c7
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: cc2c6602a2658b174b99ca997e4e49ae5dff371d38bdef25e17459adc5fcd47a
    verdict: needs_revision
  - at: 2026-10-17T20:48:27.143Z
    provider: ds-yue
    model: deepseek-v4-flash
    summary: |-
      - **对象恰当性：符合**
      - **方案可行性：不符** — 机械核验行号在当前工作树不可复现（六工具文件多数引用行号偏移约 +4~+5）
      - **scope 清晰度：符合**
      - **审核结论（闭集）：needs_revision**

      判定依据：前三轮历史修订目标（可复现计数、四层路径完整、Human 决定状态绑定、02 落盘排除、09/05/06/07/10 回指排除、提交消息分类）均已达成并经实测确认；唯一未达标项是工具文件行号引用与当前工作树不符（仅 workcase-tools 与两处契约精确），与本单「精确指称」主题及 step-1「可复现」判据相悖。修订面窄：按当前工作树刷正行号引用即可。
    session_id: 814d2a29-121f-4fb4-8c1a-e08f67366b0e
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: 77346470af314fcddb2afe1e3dcbc16c3291890929f0b6761cf991876a64f973
    verdict: needs_revision
  - at: 2026-10-17T21:18:04.776Z
    provider: ds-yue
    model: deepseek-v4-flash
    summary: 本轮「刷正行号引用」目标全部达成，系统性偏移问题已消除，此前的实质内容无回归。
    session_id: 0a64920d-d7b6-4500-af42-d088dece7960
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: b26a4e0209d4549ab98a56a9d56ad128451882b1826558df7b660fdae7a0653d
    verdict: pass
created_at: 2026-10-16T09:36:08.502Z
change_log:
  - at: 2026-10-16T09:36:08.502Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 创建提案：把事实对象指称须带类型与标题落成规范要求，并初拟落点与现状口径
  - at: 2026-10-17T06:18:45.404Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "录入建前独立审核结论（隔离子代理 62d331bd）——verdict=needs_revision：Human 决定承载缺失、机械核验数据三处漂移、落盘与提交授权未界定 [pre-gate1 audit recorded by session 62d331bd-cacc-4da1-904c-bbc45d27d489; verdict: needs_revision; candidate_fingerprint: 545fbc3e2f47…; pre_reviews entries: 1; 记录自子代理会话 62d331bd-cacc-4da1-904c-bbc45d27d489 的最终产出（Code 捕获）]"
  - at: 2026-10-17T06:21:49.045Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 承建前独立审核（隔离子代理 62d331bd，needs_revision）修订：校正 21 裸标识行为 467–470 并标注 e0bab773 出现两次；删去不可复现的写死计数改为「给出口径与可复现命令」；按实测更正七类工具投影形态（research 走 renderEnvelope、norm 走 JSON）；新增「规范的落盘与生效路径」并明确 02 落盘不属本单自行生效；计划补入 Human 决定承载步骤（3 步扩为 4 步）并逐条更新 done_criteria；调用方提交的 pre_reviews 与落盘不一致，已回落为落盘值（审核轴唯一写路径是 record_audit，21 §14）
  - at: 2026-10-17T06:26:22.809Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 承第二轮建前独立审核（隔离子代理 9cba400b，needs_revision）修订：将原先以「已取得 Human 决定」为完成条件的步骤拆为「呈交并登记待决」＋「取得决定」两步，消除 21 §6.1 粒度冲突与单方不可达的挂起面（4 步扩为 5 步）；更正 research 无列表操作、改造面须按各类实际路径枚举；按实测更正提交消息计数（裸串 57 处 vs 带前缀 73 处，前缀反为多数）并据此提示该面必要性须重估；调用方提交的 pre_reviews 与落盘不一致，已回落为落盘值（审核轴唯一写路径是 record_audit，21 §14）
  - at: 2026-10-17T06:36:53.164Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "承第三轮建前独立审核（隔离子代理 a1b4d731，needs_revision）修订：把「取得决定」改为状态绑定式——未取得时不计达成、对象保持 open 且改造不得启动，消除无条件兜底造成的空转达成；步骤 2 剥离呈交动作以消除与步骤 3 互吞；改造面按三层实际路径补齐（五个读取 envelope 的 object: 行、spark:643 refs 行、writer 层投影使 fact_type_key 可达、两处同型契约渲染）；提交消息计数改为方向性结论并注明精确值以可复现命令为准；如实登记与本审核体在「UUID 首段」判定上的分歧；调用方提交的 pre_reviews 与落盘不一致，已回落为落盘值（审核轴唯一写路径是 record_audit，21 §14）"
  - at: 2026-10-17T06:37:09.947Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "补记第三轮建前独立审核（隔离子代理 a1b4d731）——verdict=needs_revision：兜底出口无条件可达、改造面遗漏、提交消息计数分类存疑 [pre-gate1 audit recorded by session a1b4d731-fb27-4af2-b1b0-082ad27f23c7; verdict: needs_revision; candidate_fingerprint: cc2c6602a265…; pre_reviews entries: 2; 记录自子代理会话 a1b4d731-fb27-4af2-b1b0-082ad27f23c7 的最终产出（Code 捕获）]"
  - at: 2026-10-17T06:42:27.591Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 承第四轮建前独立审核（隔离子代理 35d543a4，needs_revision）修订：改造面补入四层枚举遗漏（六处 change 流水行、spark-tools.js:251 关系行、norm-tools.js:364 gaps 行）；按实测更正提交消息口径（73 处带前缀中 44 处为文件路径片段，正文独立指称约 29 处，裸写 56 处为多数），并要求步骤 1 按「路径片段/正文独立指称」分类；scope 明确 09/05/06/07/10 一行回指不在本单授权内；调用方提交的 pre_reviews 与落盘不一致，已回落为落盘值（审核轴唯一写路径是 record_audit，21 §14）
  - at: 2026-10-17T20:48:27.143Z
    provider: ds-yue
    model: deepseek-v4-flash
    summary: "录入第五轮建前独立审核（隔离子代理 814d2a29）——verdict=needs_revision：六工具文件机械核验行号相对当前工作树系统性偏移 [pre-gate1 audit recorded by session 814d2a29-121f-4fb4-8c1a-e08f67366b0e; verdict: needs_revision; candidate_fingerprint: 77346470af31…; pre_reviews entries: 3; 记录自子代理会话 814d2a29-121f-4fb4-8c1a-e08f67366b0e 的最终产出（Code 捕获）]"
  - at: 2026-10-17T21:06:56.128Z
    provider: ds-yue
    model: deepseek-v4-flash
    summary: 承第五轮建前独立审核（隔离子代理 814d2a29，needs_revision）修订：按当前工作树刷正六工具文件与两契约的全部机械核验行号引用（列表渲染层、writer 层投影、读取 envelope、change 流水、关系/gaps/JSON/OPERATIONS 等），其余内容与结构逐字不变。；调用方提交的 pre_reviews 与落盘不一致，已回落为落盘值（审核轴唯一写路径是 record_audit，21 §14）
  - at: 2026-10-17T21:18:04.776Z
    provider: ds-yue
    model: deepseek-v4-flash
    summary: "录入第六轮建前独立审核（隔离子代理 0a64920d，audit6-996e207a）——verdict=pass：清单 30 条工具与契约行号引用经实测与当前工作树一致，系统性偏移消除 [pre-gate1 audit recorded by session 0a64920d-d7b6-4500-af42-d088dece7960; verdict: pass; candidate_fingerprint: b26a4e0209d4…; pre_reviews entries: 4; 记录自子代理会话 0a64920d-d7b6-4500-af42-d088dece7960 的最终产出（Code 捕获）]"
---

# 事实对象指称须带类型与标题

## 摘要
把「描述事实对象必须带有事实对象类型」落成规范要求，先固定现状口径与落点。候选口径：事实对象的**指称形态**——即在对话、正文、提交消息与派生输出中指称一个对象时的最小可读形式——最小形态为「类型短名 + 短标识」（如 `friction-abf557e1`）；需要读者据此辨认对象时，紧随其标题（如 `friction-abf557e1 局部改动时以记忆或截断输出为数据源`）。

### 现状核实（本轮机械核验）
- `specs/` 内共 8 处裸 8 位短标识，实测位置为 `04:166` 的 `82260dec`、`21:467`／`21:468`／`21:469`／`21:470` 的 `b57780cb`／`1a895068`／`e0bab773`／`e0bab773`（**`e0bab773` 出现两次**）、`26:203`／`26:204` 的 `bf73fad4`（两次）、`26:222` 的 `71930c4a`。其中 `b57780cb`、`1a895068`、`e0bab773` 在 `ldvh-base/` 事实源内**无任何可解析载体**（全库唯一命中即本单自身），读者无从定位。
- `ldvh-base/` 正文中裸 8 位串的数量是本工单须固定的口径项，**不在此写死数值**（事实源随写入增长，固定值必然后续失真）。可复现口径与命令见计划步骤 1。
- 事实类型工具的投影**分四层，形态并不统一**（经五轮审核实测，行号按当前工作树逐条核对）：
  - **列表渲染层**：`spark`／`workcase`／`adr`／`pitfall`／`friction` 五个工具输出「裸 `object_uid` + 标题」行且不带 `fact_type_key`（`spark-tools.js:665`、`workcase-tools.js:1053`、`adr-tools.js:416`、`pitfall-tools.js:414`、`friction-tools.js:501`）。类型短名**不在渲染层可得**——writer 层投影投出的 item 字段为 `object_uid/title/status/…`，**不含 `fact_type_key`**（`spark-writer.js:903`、`workcase-writer.js:3963`、`pitfall-writer.js:681`、`friction-writer.js:1115`、`adr-writer.js:751`；`listAdrObjects` 见 `adr-writer.js:698-762`），故改造须同时覆盖 writer 层投影。
  - **读取 envelope 层**：五个工具各有 `object: ${result.object_uid}` 行（`adr-tools.js:399`、`spark-tools.js:641`、`pitfall-tools.js:398`、`friction-tools.js:485`、`workcase-tools.js:1039`），另有 `spark-tools.js:648` 的 `refs:` 行。
  - **变更流水行**：`change: ${change.change} ${change.object_uid}` 六处同型（`adr-tools.js:419`、`spark-tools.js:668`、`workcase-tools.js:1056`、`pitfall-tools.js:417`、`friction-tools.js:504`、`research-tools.js:598`）。
  - **其它渲染点**：`spark-tools.js:252` 的关系渲染 `${relation_key} → ${target.object_uid}`；`norm-tools.js:368` 的 gaps 行 `object_uid=${entry?.object_uid}`；`research-tools.js` 的 `renderEnvelope`（`research-tools.js:579-602`）输出 `object:`／`title:`（`object:` 在 :584、`title:` 在 :585）；`norm-tools.js` 的 `renderEnvelope`（`norm-tools.js:430-442`）直接 `JSON.stringify(env.result)`（`norm-tools.js:433`）；`experience-capture-contract.js:119` 与 `friction-subagent-contract.js:134` 两处同型列表渲染（`uid=` + `status` + `title`）。
- **`research` 无列表操作**：其 `OPERATIONS` 仅 `research-session-machine`／`research-read-object`／`research-write-object`（`research-tools.js:45-58`，定义于 :46/:51/:56），故 research 不存在「列表投影」改造面，只有读取路径（`renderEnvelope`）需对齐。
- 提交消息：`git log -60` 区间内带类型前缀的 `<type>-<uid>` 出现 73 处，**其中 44 处是文件路径片段**（如 `ldvh-base/frictions/friction-abf557e1`，不是指称形态问题），正文中的独立指称仅约 29 处；孤立裸 8 位短标识约 56 处（27 个去重值，已剔除非标识误命中）。故**就正文独立指称而言，裸写多于带前缀**（此前两稿分别写「20 余处为裸串」与「带前缀多于裸写」，均不准确，经第四轮审核更正）。口径提示：该计数随 `git log` 窗口与正则边界变化，**精确值以计划步骤 1 的可复现命令所出为准**，本单不以其固定值作为判据；步骤 1 须同时给出「路径片段 / 正文独立指称」的分类拆分。

### 落点建议（待 Human 决定）
唯一权威归 `02`——该规范已承接公共身份字段 `object_uid` 与 `fact_type_key`（含类型短名值域）、稳定引用原则与载体权威位置；形态条款拟落在 §7 之下。各消费面（09 提交消息、05/06 CLI 与 Code 输出、07/10 呈现与注入）以一行回指承接，不在各自复制展开；**这些回指的写入不在本单授权内**（见授权范围）。

### 规范的落盘与生效路径（经建前独立审核补入）
`02` 正文的修改属规范源变更，不在 WorkCase 授权内自行生效：条款须经 `01 §9.2` 第 8、9、11、12 项所要求的独立审核、Human 决定、受控提交与指纹绑定后，才成为规则源成员。本单的授权边界是**形成候选并提请决定**；落盘与生效由 Human 决定后的受控提交路径执行，本单不代为宣称条款已生效。

### 待决范围
条款覆盖面（是否含提交消息与规范正文）、是否为其设机械门禁（若设，**具体面**是哪些——对话正文面已在授权范围中排除）、既有裸引用的存量是否回改。

### 关于「Human 决定」的判据设计（经第三轮审核修订）
前稿把「取得 Human 决定」写成步骤完成条件，并配「未取得则登记待决并交还」的无条件兜底——该形态使步骤在**无任何工作**时即可宣称达成。故本版改为**状态绑定式**：Human 决定不是本单的完成判据，而是**改造步骤的启动前置**；未取得决定时，对象保持 `open` 并如实登记待决、交还 Human，**不以「已登记待决」充当步骤达成**。

## 授权范围
做什么：
- 核实并固定事实对象指称的跨面现状（规范正文、事实对象正文、工具响应、提交消息），给出判据、去重口径、可复现命令、分类拆分与不可解析清单；
- 在 02 形成准确候选条款，规定事实对象指称的最小形态与适用范围；
- 逐份列出受该条款约束或需回指承接的消费面载体；
- 按 Human 采纳的条款对齐工具响应投影，改造面按**四层实际路径**枚举：① 五个列表渲染器（spark/workcase/adr/pitfall/friction）**及其 writer 层投影**（使 `fact_type_key` 可达）；② 五个读取 envelope 的 `object:` 行与 `spark-tools.js:648` 的 refs 行；③ 六处 `change:` 变更流水行（adr:419／spark:668／workcase:1056／pitfall:417／friction:504／research:598）；④ `spark-tools.js:252` 关系行、`norm-tools.js:368` gaps 行、research 的 `renderEnvelope`、norm 的 JSON 输出、`experience-capture-contract.js:119` 与 `friction-subagent-contract.js:134` 两处同型渲染。research 无列表操作，不在「列表」改造面内。并补相应契约测试。

明确不做什么：
- 不改 00（受保护内容），不改 README、LICENSE 与版本声明点；
- 不在本单内处置既有裸引用的存量改写（是否回改、改到哪一层由 Human 另行决定）；
- 不改任何事实类型的字段闭集、状态机、关系 key 与 CAS 语义；
- 不新增事实类型，不改变 `fact_type_key` 的值域与类型短名登记；
- 不为 AI 的对话正文设机械门禁（该面无判据，属独立复核与 Human 阅读范围）；
- 不自行将 02 条款落盘生效——该动作归属 Human 决定后的规范受控提交路径，本单只形成候选并提请（见摘要「规范的落盘与生效路径」）；
- **不写入 09／05／06／07／10 等消费面规范的「一行回指」**——该写入既不在本单授权内，也不由本单执行；本单只出具回指文本草案随候选一并呈交，其落盘按各规范的受控提交路径另行处理；
- 不在未获 Human 决定前启动工具投影改造（改造步骤以「决定记录存在且为采纳」为启动前置，非完成判据）；
- 不为 `experience-capture-contract.js` 与 `friction-subagent-contract.js` 两处引入新的输出契约——仅按采纳条款对齐其指称形态，不改其消息语义。

## 计划

1. 核实并固定事实对象指称的跨面现状（规范正文、事实对象正文、工具响应、提交消息），给出判据、去重口径、可复现命令、分类拆分与不可解析清单。
   完成判据：四处清点结果以可逐条回读的形式交出：每处给出命中判据、可复现的检索命令、去重计数与不可解析项清单；不写死数值，数值须可由所给命令重算复现。提交消息面须按「文件路径片段 / 正文独立指称」分类拆分，并分别给出裸写与带类型前缀的计数。

2. 在 02 形成规定事实对象指称最小形态的准确候选，并逐份列出需回指承接的消费面载体。
   完成判据：候选含条款正文（最小形态、适用范围、边界与未验证范围）、受影响载体清单（逐份点名，含各消费面的一行回指草案），以及依 `01 §9.2` 第 8／9／11／12 项的落盘生效路径说明。**本步只以「候选与清单已成形并落盘」为判据**，不含呈交动作（呈交属步骤 3）。

3. 将候选、载体清单与待决选项呈交 Human，并把「已呈交、待决定」这一状态落成可回读记录。
   完成判据：候选条款、受影响载体清单与待决选项已明示呈交；呈交记录落盘，含所针对的候选版本标识与呈交日期。本步骤以「已呈交」为唯一判据，不要求取得答复。

4. 取得 Human 就候选作出的决定并落成记录；未取得时如实登记待决并交还，改造不得启动。
   完成判据（**二择一，且二者可机械区分**）：(a) **已取得决定**——Human 的决定（采纳／否决／改落点／待议）已记录，含决定内容、时间、所针对的候选版本与决定人；此为该步的**达成**。(b) **未取得决定**——如实登记「待决」并交还 Human；此情形下本步**不计为达成**，对象保持 `open`、`outcome` 不得据此关闭，且后续步骤 5 不得启动。**不得以「已登记待决」宣称本步完成**。

5. 按 Human 采纳的条款对齐工具响应投影：按四层实际路径改造，使其带类型短名与标题，并补契约测试。
   完成判据：启动前置成立（步骤 4 的结果为 (a) 且决定为「采纳」）；改造覆盖授权范围枚举的四层路径，**逐条以回读的实际输出为证**（列表类、读取类、变更流水类、其它渲染点分别取证）；契约测试通过并给出通过计数。若 Human 决定为否决或改落点，本步骤不执行，并在交还说明中登记为「按决定未执行」，**不得以「已登记未执行原因」宣称本步骤达成**。

