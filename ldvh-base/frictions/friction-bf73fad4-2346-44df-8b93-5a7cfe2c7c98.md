---
title: open 工单无法写入结果节
status: open
phenomenon: "status=open 的 WorkCase 无法写入 ## 结果 正文节，导致 awaiting_gate2 状态不可达"
attribution: specs/21 §8 正文字段契约与 plugin/lib/workcase-writer.js 的 validateWorkcaseBodyStructure 过滤逻辑；呈现侧消费点为 plugin/web/shared/workcaseLifecycle.ts 的 deriveWorkCaseV5View
impact: heavy
serves: SG-3
object_uid: bf73fad4-2346-44df-8b93-5a7cfe2c7c98
fact_type_key: friction
created_at: 2026-09-16T03:57:06.500Z
change_log:
  - at: 2026-09-16T03:57:06.500Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Friction 对象
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
