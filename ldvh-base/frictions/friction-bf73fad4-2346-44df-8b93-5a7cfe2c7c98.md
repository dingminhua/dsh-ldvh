---
title: open 工单无法写入结果节
status: resolved
phenomenon: "status=open 的 WorkCase 无法写入 ## 结果 正文节，导致 awaiting_gate2 状态不可达"
attribution: 21 §8 正文字段契约与 plugin/lib/workcase-writer.js 的 validateWorkcaseBodyStructure 期望集合/过滤逻辑不一致（长度比对把「结果」计入实际却不计入期望）；呈现侧消费点为 plugin/web/shared/workcaseLifecycle.ts 的 deriveWorkCaseV5View
impact: heavy
relations:
  - relation_key: informs
    target:
      commit: e4e178fd7e3293f47003ed0150ab1128cc6ae0ef
object_uid: bf73fad4-2346-44df-8b93-5a7cfe2c7c98
fact_type_key: friction
created_at: 2026-09-16T03:57:06.500Z
change_log:
  - at: 2026-09-16T03:57:06.500Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Friction 对象
  - at: 2026-10-09T17:44:19.429Z
    provider: workbuddy
    model: space-bunny
    summary: 销账（Human Gate 2026-10-09 明示「先消账吧」）：根因已消除并经五态穷举实测——open+结果（Gate 2 草稿）放行、draft+结果仍拒、closed+结果放行；两张真实工单已端到端走完 awaiting_gate2 → Gate 2 → closed（a2eb4e8）。解药为直提路径修复 e4e178f、无对应事实对象，依 02 §8.1 commit 形态以 evidence_locator 承载 informs
  - at: 2026-10-10T02:17:37.608Z
    provider: workbuddy
    model: space-bunny
    summary: 事实更正（非状态转换）——更正解药身份：target 由指向消费者工单 1a34f9e4 改为直接指向修复本体 commit e4e178f（02 §8.1 commit 形态）；该工单是缺陷修好之后的消费者与端到端证据，非解药，其证据改记入处置段。终态判定未变：status/title/phenomenon/impact/serves/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter，改动在结构上不可能；可改范围仅正文与 relations（26 §13）。经 Human 授权：Human（dsh-ldvh 会话主，2026-10-09）：先是明示「先消账吧」批准本账销账；后在审阅销账形态时判定「评判的关键是，那张工单到底是不是解药，因为 wc 对应的不是摩擦记录的问题吧」，据此裁定那张工单不是解药，并于同轮明示「扩展 target：commit 可直接作 target」与「行动吧」，授权据此修订关系与正文。本机械记录由 AI 自报，其存在不证明 Human 真的作过上述授权（26 §13 自报边界）。
  - at: 2026-10-10T02:36:31.841Z
    provider: workbuddy
    model: space-bunny
    summary: 事实更正（非状态转换）——2026-10 补记：26 号已删除 Friction 的 serves 字段（本对象随之移除），本账所记的复核真空在 Spark 侧仍原样存在，故本账保持 resolved 不变。终态判定未变：status/title/phenomenon/impact/serves/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter，改动在结构上不可能；可改范围仅正文与 relations（26 §13）。经 Human 授权：Human 于本会话明示「1、修改规范 2、修改存量」，并确认存量处置方式为「逐份删除」；该授权覆盖对 9 份存量 Friction 逐份删除 serves 字段，其中本份为 resolved 终态、须经 correct 入口实施。
  - at: 2026-10-10T02:41:43.543Z
    provider: workbuddy
    model: space-bunny
    summary: 事实更正（非状态转换）——清除已退出闭集的 serves 字段（26 号 2026-10 删除该字段；本对象为唯一 resolved 终态存量，Human 据此裁定扩展 correct 入口新增 frontmatter_removals——仅允许删除已退役字段，不得新增或改值）。终态判定未变：status/title/phenomenon/impact/serves/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter，改动在结构上不可能；可改范围仅正文与 relations（26 §13）。经 Human 授权：Human 于本会话明示「1、修改规范 2、修改存量」，并确认存量处置为「逐份删除」；bf73fad4 为唯一 resolved 终态存量、无法经受控更新删除后，Human 明确选择「扩 correct 入口（改规范+代码）」以清除其 serves 字段。该授权覆盖本条 correct 动作及其对 26 号 §13 的相应扩展。
  - at: 2026-10-10T02:44:49.635Z
    provider: workbuddy
    model: space-bunny
    summary: 事实更正（非状态转换）——清除已退出闭集的 serves 字段（26 号 2026-10 删除该字段；本对象为唯一 resolved 终态存量，Human 据此裁定扩展 correct 入口新增 frontmatter_removals——仅允许删除已退役字段，不得新增或改值）。本次为宿主重载后的实际执行，前一次尝试因插件代码未生效而空转，其流水中的「已移除」表述当时不实。终态判定未变：status/title/phenomenon/impact/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter（唯一例外：2026-10 起可显式删除已退出类型闭集的字段，本次删除：serves），不得新增或改值；其余可改范围为正文与 relations（26 §13）。经 Human 授权：Human 于本会话明示「1、修改规范 2、修改存量」，并确认存量处置为「逐份删除」；bf73fad4 为唯一 resolved 终态存量、无法经受控更新删除后，Human 明确选择「扩 correct 入口（改规范+代码）」以清除其 serves 字段。该授权覆盖本条 correct 动作及其对 26 号 §13 的相应扩展。
  - at: 2026-10-10T09:15:26.863Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 事实更正（非状态转换）——补填 occurrence（26 §8 于 2026-11 新增必填字段）——本对象为 resolved 终态，无法经受控更新触及，经 §13 的 frontmatter_additions 通道补填；count=1、first_at=last_at 取既有时间锚（存量对象无可考的重复计数，保守记为首见一次）。终态判定未变：status/title/phenomenon/impact/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter 值（两处例外，均为「字段之有无」而非「字段之值」：① 2026-10 起可显式删除已退出类型闭集的字段，本次删除：无；② 2026-11 起可补填新进入类型闭集的字段，本次补填：occurrence），不得改值；其余可改范围为正文与 relations（26 §13）。经 Human 授权：Human 于本会话裁定「1」——批准给 correct 增设对称补填通道（选项①），并批准按「count=1、first_at 取 change_log 首条」的口径回填存量 occurrence；本条为该口径的最后一个对象
  - at: 2026-10-12T03:48:13.925Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 事实更正（非状态转换）——结构修正：收敛重复的生成式 H1（2 → 1）——读写契约不对称导致补充级更新每次叠加一个 H1（2026-10-12 修）. 不改 count、不改状态、不改语义内容。终态判定未变：status/title/phenomenon/impact/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter 值（两处例外，均为「字段之有无」而非「字段之值」：① 2026-10 起可显式删除已退出类型闭集的字段，本次删除：无；② 2026-11 起可补填新进入类型闭集的字段，本次补填：无），不得改值；其余可改范围为正文与 relations（26 §13）。经 Human 授权：Human 2026-10-12 指示「修复吧」（本会话）：授权修正 3 条被重复 H1 损坏的账目结构
occurrence:
  count: 1
  first_at: 2026-09-16T03:57:06.500Z
  last_at: 2026-09-16T03:57:06.500Z
  human_return_at: null
---

# open 工单无法写入结果节

## 现象

status=open 的 WorkCase 无法写入 ## 结果 正文节，导致 awaiting_gate2 状态不可达。

实现层细节：`validateWorkcaseBodyStructure` 在 `hasExecution=true, requireResult=false` 时把期望 H2 集合算成「摘要/授权范围/计划/执行」（4 项），但过滤逻辑又把实际出现的 `结果` 保留进待比对集合（5 项），长度不等即报 `body: expected H2 sections (摘要 / 授权范围 / 计划 / 执行), found 摘要 / 授权范围 / 计划 / 执行 / 结果`。直接调用复现：

- `open + 结果` → `ok=false`，issues 为上述长度不等
- `open 无结果` → `ok=true`
- `closed + 结果` → `ok=true`

后果：`awaiting_gate2`（待批准关闭）这一状态在当前代码下不可达——v5 三态呈现把 `awaiting_gate2` 定义为 `status=open ∧ 正文含 H2「结果」`（`plugin/web/shared/workcaseLifecycle.ts` 的 `bodyHasResultSection` + `deriveWorkCaseV5View`），而写侧恰好禁止写出该组合。事实源核对：`ldvh-base/workcases/` 全部对象中，唯一 `status: open` 的 WC-0002 不含 `## 结果`，即当前不存在也无法产生处于该态的对象。

## 入账依据

发现于 WC-D（99957f65）执行收尾：为该单写 Gate 2 结果草稿（`action=execute` + 含 `## 结果` 的 body）时被 `workcase/body_invalid` 拒绝，随后用 `validateWorkcaseBodyStructure` 三组输入直接复现并隔离到长度比对分支（`plugin/lib/workcase-writer.js` 约 516–520 行）。

注意这不是单纯的实现笔误，其背后是 21 §8 自身的表述张力：同一节既写「`result` 与 `outcome` 出现 ⇔ `status = closed`」（第 156 行不变量），又把 `## 结果` 标注为「关闭提案时必填」（第 151 行），而函数内注释明写「open may carry it as a Gate 2 draft（21 §8 条件出现）」——即实现层注释承认 open 可携带结果草稿，规范层不变量却把它排除在 open 之外。因此修复方向有两种可能，属 Human 决定项：一是承认 open 可携带结果草稿（则修过滤逻辑并放宽 §8 不变量），二是维持 `result ⇔ closed`（则 `awaiting_gate2` 必须改由其他机械可判依据派生，例如 change_log 中的提请记录，而非正文「结果」节）。

## 处置

**根因已消除（Human Gate 2026-10-09 批准销账）**。修复为 commit `e4e178f`（2026-09-16「fix(workcase): 修正正文结构校验——open 工单可携带结果节（Friction bf73fad4）」）：`validateWorkcaseBodyStructure` 的 `expected` 集合改为无条件含「结果」，顺序比对改为「实际出现者为期望集的保序子序列」，并保留「执行」的前置门禁（draft 不得有）与 closed 缺结果节必须拒绝。该修复走直提路径、未对象化，故无对应 ADR/WorkCase 可指向——依 02 §8.1「`commit` 形态」以 `target: {commit}` 承载（Human 裁定 2026-10-09 同日两次修订：先设 `evidence_locator` 附加形态，复审与 Human 复核指出「解药未必有对象身份」后扩为 target 可直接取）。

**关于解药身份的更正（2026-10-09，本条经 `correct` 修正）**：本账初销账时曾把 `target.object_uid` 指向工单 `1a34f9e4`——那是**错误的解药身份**。该工单（标题「提请弹窗 200 字符上限落到接缝」）并不修复本账所述的 `validateWorkcaseBodyStructure` 缺陷，它是**缺陷修好之后的消费者与端到端证据**：它之所以能写入「## 结果」节并走完 awaiting_gate2 → Gate 2，正是因为本账的根因已被 `e4e178f` 修掉。按 26 §11「本摩擦由目标的修复/决策解决」，解药是那次修复本身，不是消费了修复的工单。该区分由 Human 判定（2026-10-09：「评判的关键是，那张工单到底是不是解药，因为 wc 对应的不是摩擦记录的问题吧」），并据此修订 02 §8.1：**一笔摩擦若只是消费了某次修复，那是证据而非解药**——证据记在处置段（本条下方「消除证据二」即该证据），不得指向那个消费者对象当作解药。

**消除证据一：五态穷举实测（2026-10-09，直接调用 `validateWorkcaseBodyStructure`，修复在 HEAD 中）**

- `open + 结果`（Gate 2 草稿）→ **放行** ✅（本条现象所指的不可达组合）
- `open 无结果`（执行中）→ 放行 ✅
- `draft + 结果` → **仍拒绝** ❌（`「## 结果」 must not be present for a draft that is neither executing nor closing`）——判据未被放宽成开口
- `draft 无结果` → 放行 ✅
- `closed + 结果` → 放行 ✅

即修复是**定向打开缺失的那一格**，不是取消该门禁。

**消除证据二：端到端（2026-10-09 真实工作流）**：`awaiting_gate2` 已实际达成并走完 Gate 2——两张工单 `workcase-1a34f9e4`（提请弹窗 200 字符上限）与 `workcase-81c37ef0`（清理 writer 注释）各自经 `execute` 写入「## 结果」节后成功派生为 awaiting_gate2，经 Human 逐张批准后落为 `closed`／`completed`（提交 `a2eb4e8`）。呈现层派生条件与写侧不再互斥——这正是本条现象所称「awaiting_gate2 不可达」的反证。该证据说明修复在真实工作流中生效，但它**不是**解药，故只记于此处而不指向为 `target`。

**与同族摩擦的区分（避免重复销账）**：本账根因是「写不进去」（正文结构校验的期望集合/过滤逻辑缺陷），已消除；`friction-720b58c9`「关闭提请无专属动作承载」根因是「没有人写」（关闭信号无专属动作，只能作为 execute 的附带产物出现），**该机制性缺口仍在、未消除**，其 status 保持 open——两账同题不同根因，不可因本账销账而一并视为解决。

**2026-10 补记（`serves` 字段清除，终态判定不变）**：26 号规范于 2026-10 删除了 Friction 的 `serves` 字段（该字段在 §12 四个消费点均无消费方，违反 §18 第 1 条红线）。本对象是 9 份存量中**唯一为 `resolved` 终态**的一份——受控更新入口对终态只读（§9.2），故其 `serves: SG-3` 无法经受控更新删除。Human 据此裁定扩展 `correct` 入口：新增 `frontmatter_removals`，允许**显式删除已退出类型闭集的字段**（唯一动作，不得新增或改值）。经该通道本对象的 `serves` 已清除。本次动作不触及本账的解药身份、消除证据与销账判定——终态仍为 `resolved`，`informs` 关系逐字不变。

**本次动作的中间失败如实登记（2026-10）**：清除 `serves` 的第一次尝试发生在插件宿主重载新代码之前，工具侧未收到 `frontmatter_removals`（schema 尚未声明该参数），该次 correct 只改正了正文、未删除字段，却返回成功并在 change_log 中写入了「本对象随之移除」这一与落盘事实不符的表述。宿主重启后重试，才真正删除该字段。此处登记以免后人误读流水：同一 summary 在相邻两条 change_log 中一真一假，真伪以**落盘文件**为准。
