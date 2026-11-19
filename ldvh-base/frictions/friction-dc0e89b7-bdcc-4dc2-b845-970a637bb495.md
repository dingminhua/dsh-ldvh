---
title: 附件审核在长跨度改动前反复自我纠错后方能查明范围
status: accepted
phenomenon: 手工逐条比较式比对在行增删后反复失败，需多次自查修正才逼近真相
object_uid: dc0e89b7-bdcc-4dc2-b845-970a637bb495
fact_type_key: friction
created_at: 2026-10-13T06:01:33.926Z
change_log:
  - at: 2026-10-13T06:01:33.926Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
  - at: 2026-10-21T15:42:09.463Z
    provider: workbuddy
    model: minimax-m3.1-flash
    summary: 补充观察：count 1 → 2（36 §9 第 2 项）
  - at: 2026-10-21T15:50:25.311Z
    provider: dsh-opencode-go
    model: minimax-m3.1-flash-free
    summary: 补充观察：count 2 → 3（36 §9 第 2 项）
  - at: 2026-10-21T15:50:25.317Z
    provider: dsh-opencode-go
    model: minimax-m3.1-flash-free
    summary: 阈值流转 observing → open（count 3 ≥ 3，36 §9 第 4 项）
  - at: 2026-11-02T09:02:37.826Z
    provider: qoder-global
    model: qfmodel
    summary: 撤销影响评级（26 §8 2026-11-02）：删除 impact 字段——分级制度经 Human 裁定取消，本对象为 open 存量，经受控更新显式删除，其余字段与正文逐字继承。另显式承载 occurrence 的 count／first_at／last_at 三件，值与原载逐字相同（仅不再携带 2026-10 已退出闭集的历史子件 human_return_at），非改值、非计数。
  - at: 2026-11-10T11:36:53.176Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
  - at: 2026-11-19T19:40:06.418Z
    provider: workbuddy
    model: hy4flash-free
    summary: 接受（Human Gate，老丁 2026-11-20 决定「全部转 accepted」）：属 Human 已定决策关闭消除途径，写明不可清偿理由与复审触发；无解药、冻结计数
occurrence:
  count: 3
  first_at: 2026-10-13T05:58:00.744Z
  last_at: 2026-10-21T15:50:11.002Z
disposition: Human 已定决策关闭消除途径：核对改动范围可否统一权威口径属纪律，转为靠经验缓解，不再作为待修项跟踪（老丁 2026-11-20 决定）
---

# 附件审核在长跨度改动前反复自我纠错后方能查明范围

## 现象
手工逐条比较式比对在行增删后反复失败，需多次自查修正才逼近真相

## 入账依据
现象可归因于本次材料（助手多次承认比较方式错误并重做），且改用键控比较后得出了更可靠的结论，具备修了会更好的预期

补充观察（2026-10-21T15:41:09.888Z）：材料显示：对同一份规范改动，审核方报「7 个 hunk」、主控自查报「9 处」，重跑 `git diff -U0` 后实测为 11 个 hunk，三方计数互不一致，主控需逐层自我纠正（先认审核计数错、再认自己的 9 处不精确）才确定改动范围。这与既有账目 friction-dc0e89b7「附件审核在长跨度改动前反复自我纠错后方能查明范围」的机制一致——审核与自查均未按同一权威口径核定改动范围，导致反复自纠后才得出真实范围，故判为同一阻碍。说明：本次材料因长度上限被截断（助手段止于「§3.7 把审核「职责」交下位…」处），判断仅就所见部分作出。

补充观察（2026-10-21T15:50:11.002Z）：引证显示本轮在提交前，主控对自己在预检消息中列举的改动范围（4 个文件）先自问「漏了第一条文件？」再逐条重数才与暂存区一一对应，即改动范围核定在自查与预检两处口径不一致时又出现一次反复自我纠错。这与既有账目 friction-dc0e89b7「附件审核在长跨度改动前反复自我纠错后方能查明范围」（其落账描述为「审核说 7 个 hunk、我说 9 处、实测 11 个」，且同批材料把该条归为「审核与自查未按同一权威口径核定改动范围」）指向同一阻碍机制，且本轮同处一批观察的两条之一，故判为 same-obstacle 而非新账目。材料中其余内容（推送成功、工作区干净、提交消息与文件一一对应）未出现新的阻碍现象。

## 处置
接受（open → accepted，Human 老丁 2026-11-20 本会话决定「全部转 accepted」）。不可清偿理由属 36 §9.4 第三类——Human 已定决策关闭消除途径：改动范围的口径统一属主控自查纪律（04 §6.1），无确定性的机械消解可指，Human 决定不再把它作为待修项跟踪，残余风险靠日常自查留痕。本笔无 `informs`（无解药对象）；现象与 occurrence 计数冻结，不再扩展。

复审触发：① 出现能机械统一「审核／自查／实测」三方改动范围口径的工具或门禁；② Human 改变决定、重新要求把此类口径不一致列为待修；③ 同类反复自纠造成实质返工或错误提交。触发出现时由 Human 新建 open 账目并在正文接续本 uid（26 §9.2：accepted 不重开）。
