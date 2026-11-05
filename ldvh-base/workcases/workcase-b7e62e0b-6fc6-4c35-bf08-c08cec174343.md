---
fact_type_key: workcase
object_uid: b7e62e0b-6fc6-4c35-bf08-c08cec174343
title: 转述类拒绝的可用路径提示
status: closed
gist: 降低 workcase_write 转述类失败：该工具 143 次失败中 28 次是「summary 不是子代理结论逐字子串」。根因不是调用方不仔细，而是它不知道可以省略 summary——系统已有自动选段逻辑（pickReviewSummary），但报错从未提及。本单只改两处拒绝文案补上这条指引。
summary: |-
  降低 ldvh_workcase_write 转述类失败的频率：该工具 143 次失败中 28 次是「summary 不是子代理结论的逐字子串」，17 次是「子代理尚未交出结论」。前者的根因不是调用方不仔细，而是它不知道可以省略 summary——workcase-tools.js 已有 pickReviewSummary 自动选段逻辑，省略时系统会挑承载七要素的段落，但报错文案从未告诉调用方这条路。

  ### 现状核实（代码级）
  1. 省略 summary 已有自动路径：workcase-tools.js:1065 起，summary === null 时走 pickReviewSummary，按「优先取承载 02 §16 七要素的段落、不按位置取首段、一段都装不下则 fail-closed」的口径自动选段。
  2. 报错未提及该路径：:1051 的拒绝文案只说「must be traceable… Pass a span of its conclusion text verbatim」，未说明也可以直接省略 summary。
  3. 空白形状已放宽：anchorConclusionExcerpt 已忽略空白形态（friction-b389a3bd，2026-10-28），故仍被拒的是实质性改写，不是复制误差。
  4. 时序类 17 次已有正确文案：:1030 已写「Wait for it to finish its turn」，该部分无需改动。

  ### 据此判断
  甲档的正确形态不是「回显可复制片段」，而是**在报错里指出省略 summary 这条既有路径**。改动量极小、零风险、且复用系统已有的自动选段能力。
scope: |-
  做什么：
  - 修改 `plugin/lib/workcase-tools.js` 中 `record_review`（约 :1051）与 `record_audit`（约 :1179）两处拒绝文案，在「summary 不是逐字子串」的报错里补一句：可直接省略 `summary`，系统将按 `pickReviewSummary` 自动选取承载七要素的段落
  - 若「自动选段也失败」的分支（约 :1071）文案已说明「一段都装不下」，则核对两处文案不重复、不冲突
  - 新增/更新单元测试：断言两处拒绝文案包含「可省略 summary」的指引；断言省略 summary 时确实走自动选段路径

  明确不做什么：
  - 不修改 `pickReviewSummary` 与 `anchorConclusionExcerpt` 的任何匹配口径
  - 不修改 `21`、`03`、`02` 任何规范条文
  - 不新增「回显子代理原文」的行为（原文可能含敏感内容且长度不可控）
  - 不改动 `record_review`／`record_audit` 的校验逻辑本身
  - 不触碰 17 次时序类失败对应的文案（`Wait for it to finish its turn` 已正确）
plan:
  - done_criteria: 列出两处文案的完整原文与所在函数的行号区间，并说明「省略 summary 走自动选段」这一路径在代码中的确切入口行号
    step: 核对两处拒绝文案的完整现状与上下文（`record_review` 约 :1049-1060、`record_audit` 约 :1177-1188），确认改动点与相邻分支的关系
  - done_criteria: 两处报错文本均包含指向省略路径的明确指引；改动后两处文案不与被拒绝的实际原因矛盾（不得暗示「省略一定成功」——自动选段也可能 fail-closed）
    step: 在两处拒绝文案中补充「可省略 summary」的指引
  - done_criteria: 存在用例断言两处报错包含该指引；存在用例断言省略 summary 且结论含可分块文本时，记录成功且入账的 summary 是结论原文的连续区间
    step: 新增单元测试覆盖两处文案与自动选段路径
  - done_criteria: 删掉新增的那句指引后，对应的文案用例失败；还原后通过
    step: 变异验证
result:
  achieved_scope: 未执行任何计划步骤；本工单在 Gate 1 之前的建前独立审核后即取消，未产生任何代码或规范改动
  criteria_checks:
    - evidence: 未开始执行——审核判 needs_revision 后即取消
      satisfied: false
    - evidence: 同上：未修改任何报错文案
      satisfied: false
    - evidence: 同上：未新增测试
      satisfied: false
    - evidence: 同上：未做变异验证
      satisfied: false
  residual:
    - 真问题重新界定为「调用方明知可省略却仍自己摘一段，为什么」，已回写 spark-729491f6，待重新界定后再决定立项形态
    - 52 次转述类失败全部发生在 schema 指引已存在之后，证明「加指引」与失败成因无已证因果链，不得据此立项
outcome: cancelled
created_at: 2026-11-04T14:50:31.356Z
change_log:
  - at: 2026-11-04T14:50:31.356Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-11-04T15:03:37.631Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 取消：建前审核推翻根因主张——schema:1522 自 2026-09-20 起已载省略指引，且 52 次转述类失败全部发生在指引存在之后（分布核查覆盖 59 天），「加指引」与失败成因无已证因果链；另缺 serves、第 3 步判据在既有夹具下不可达。 [cancelled before execution; no Gate 1 approval existed]
---

# 转述类拒绝的可用路径提示

## 摘要

降低 ldvh_workcase_write 转述类失败的频率：该工具 143 次失败中 28 次是「summary 不是子代理结论的逐字子串」，17 次是「子代理尚未交出结论」。前者的根因不是调用方不仔细，而是它不知道可以省略 summary——workcase-tools.js 已有 pickReviewSummary 自动选段逻辑，省略时系统会挑承载七要素的段落，但报错文案从未告诉调用方这条路。

### 现状核实（代码级）
1. 省略 summary 已有自动路径：workcase-tools.js:1065 起，summary === null 时走 pickReviewSummary，按「优先取承载 02 §16 七要素的段落、不按位置取首段、一段都装不下则 fail-closed」的口径自动选段。
2. 报错未提及该路径：:1051 的拒绝文案只说「must be traceable… Pass a span of its conclusion text verbatim」，未说明也可以直接省略 summary。
3. 空白形状已放宽：anchorConclusionExcerpt 已忽略空白形态（friction-b389a3bd，2026-10-28），故仍被拒的是实质性改写，不是复制误差。
4. 时序类 17 次已有正确文案：:1030 已写「Wait for it to finish its turn」，该部分无需改动。

### 据此判断
甲档的正确形态不是「回显可复制片段」，而是**在报错里指出省略 summary 这条既有路径**。改动量极小、零风险、且复用系统已有的自动选段能力。

### 数据依据
2026-11-04 全量统计（502 会话、901 次调用、242 次失败）：ldvh_workcase_write 失败 143 次，其中按详情首句聚合最大单项是 28 次（21 + 7）转述类，17 次子代理未就绪。转述类占写入类失败（198 次）的 14.1%。

## 授权范围

做什么：
- 修改 `plugin/lib/workcase-tools.js` 中 `record_review`（约 :1051）与 `record_audit`（约 :1179）两处拒绝文案，在「summary 不是逐字子串」的报错里补一句：可直接省略 `summary`，系统将按 `pickReviewSummary` 自动选取承载七要素的段落
- 若「自动选段也失败」的分支（约 :1071）文案已说明「一段都装不下」，则核对两处文案不重复、不冲突
- 新增/更新单元测试：断言两处拒绝文案包含「可省略 summary」的指引；断言省略 summary 时确实走自动选段路径

明确不做什么：
- 不修改 `pickReviewSummary` 与 `anchorConclusionExcerpt` 的任何匹配口径
- 不修改 `21`、`03`、`02` 任何规范条文
- 不新增「回显子代理原文」的行为（原文可能含敏感内容且长度不可控）
- 不改动 `record_review`／`record_audit` 的校验逻辑本身
- 不触碰 17 次时序类失败对应的文案（`Wait for it to finish its turn` 已正确）

## 计划

1. 核对两处拒绝文案的完整现状与上下文（`record_review` 约 :1049-1060、`record_audit` 约 :1177-1188），确认改动点与相邻分支的关系
   - 完成判据：列出两处文案的完整原文与所在函数的行号区间，并说明「省略 summary 走自动选段」这一路径在代码中的确切入口行号
2. 在两处拒绝文案中补充「可省略 summary」的指引
   - 完成判据：两处报错文本均包含指向省略路径的明确指引；改动后两处文案不与被拒绝的实际原因矛盾（不得暗示「省略一定成功」——自动选段也可能 fail-closed）
3. 新增单元测试覆盖两处文案与自动选段路径
   - 完成判据：存在用例断言两处报错包含该指引；存在用例断言省略 summary 且结论含可分块文本时，记录成功且入账的 summary 是结论原文的连续区间
4. 变异验证
   - 完成判据：删掉新增的那句指引后，对应的文案用例失败；还原后通过

## 结果

- 取消记录：
  - **理由**：建前独立审核判 `needs_revision`，其核心指控经主控复核**全部属实**，且推翻了本单的根因主张——**本单建立在一个错误前提上，改文案不会解决它指向的问题**。三条关键事实：① 工单称「调用方不知道可以省略 summary」，但工具参数描述 `plugin/lib/workcase-tools.js:1522` 末句早已写明「Omit it to adopt the conclusion paragraph carrying those elements.」，且 `git log -S` 溯源显示该指引自 `fd40541`（2026-09-20）起即存在、`94850bc`（2026-10-30）重写为今措辞。schema 每回合随请求下发，是调用方第一手信息，「不知道」不成立。② 主控另行做的**时间分布核查**（502 个会话目录 mtime 覆盖 2026-09-07 至 2026-11-04，共 59 天，其中包含指引加入之前的时段）显示：转述类失败**实际 52 次**（比工单自述的 28 次更多，因统计口径更宽），且**全部集中在 2026-11-03（6 次）与 2026-11-04（46 次）**——即全部发生在指引已存在之后。故「加一句指引」这一修法与失败成因之间**没有已证的因果链**；指引在，失败照旧。③ 第 3 步完成判据在既有夹具下**不可达**：`plugin/test/workcase-create-confirmation.test.mjs` 的 `setupRelay` 注入的 exec 无宿主会话身份，工具路径在身份门禁处终止，走不到写入；而 `workcase-writer.test.mjs` 的成功用例直调 writer 函数，不经摘录/自动选段分支。另有缺 `serves`（仓内 `goal.md` 与 4 条 active SubGoal 均存在，本单未挂）、scope 中「核对两处文案不重复不冲突」不可机械判定、「不新增回显原文」与既有落盘行为边界不清等必须修改项共六条，见该次 `pre_reviews` 记录。
  - **未发生的范围**：未执行任何 `plan` 步骤（`draft` → `closed`，未经 Gate 1）；未触碰 `plugin/lib`、`plugin/test`、`specs/` 任何文件；四项 `done_criteria` 全部未开始。

### 后续去向

本单取消而非改稿重开，因为**问题本身还没定义清楚**：审核的六条修改建议仍建立在「加指引能减少失败」这一未被验证的前提上，而时间分布恰恰显示指引存在时失败照旧。真问题已改写为「调用方明知可省略却仍选择自己摘一段——为什么」，该问题的事实与 52 次的时间分布已回写来源 Spark `spark-729491f6`（受控写入失败原因与减缓），待其重新界定后再决定是否立项、以及应落 Research 还是 WorkCase。

