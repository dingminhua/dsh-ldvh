---
title: 测试全绿信号无法担保路径被走过
status: open
phenomenon: 全套 1283 条测试全绿、且经三次独立复核通过，但 lifecycle.js 的落地路径上仍有一行每次运行都抛 ReferenceError 的代码。
impact: heavy
object_uid: 545cca82-d83e-488a-99bd-04ad8ef51bcb
fact_type_key: friction
created_at: 2026-10-10T21:04:59.835Z
change_log:
  - at: 2026-10-10T21:04:59.835Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
  - at: 2026-10-11T05:21:02.861Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 1 → 2（04 §8.4 第 2 项）
  - at: 2026-10-11T08:03:43.788Z
    provider: glm
    model: kimi-k3
    summary: 补充观察：count 2 → 3（04 §8.4 第 2 项）
  - at: 2026-10-11T08:03:43.792Z
    provider: glm
    model: kimi-k3
    summary: 阈值流转 observing → open（count 3 ≥ 3，04 §8.4 第 4 项）
  - at: 2026-10-11T22:18:43.583Z
    provider: ds-yue
    model: deepseek-v4-flash
    summary: 修正重复 H1 结构缺陷（正文标题行重复 4 次，保留唯一 H1，26 §8 结构恢复）
occurrence:
  count: 3
  first_at: 2026-10-10T21:04:17.494Z
  last_at: 2026-10-11T08:02:30.042Z
  human_return_at: null
---

# 测试全绿信号无法担保路径被走过

## 现象
全套 1283 条测试全绿、且经三次独立复核通过，但 lifecycle.js 的落地路径上仍有一行每次运行都抛 ReferenceError 的代码。

## 入账依据
可归因性：测试是围绕**被调用方**（runIdleCheckpoint、landDiscoveryVerdict）组织的，而**调用方**（lifecycle.js 的 onSessionCheckpoint 回调）从未被驱动——故「全绿」在结构上就排除了接线层缺陷这一整类。修了会更好的预期：补上调用方覆盖后，D8 会在第一次运行就被抓住，且此后每一次改动的「全绿」都能对接线本身作出保证，而不只是对被调用的函数。

补充观察（2026-10-11T05:20:17.614Z）：本次材料中两次出现「护栏验证输出 0 失败」而该结果毫无信息量：其一，为 `|| previous.truncated` 保护所配的测试因所守分支**不可达**而恒为通过，护栏形同虚设却从未暴露；其二，`python3 -c` 里的转义未匹配，被测代码**根本没有改动**，于是「0 失败」被一度读成「测试太松」——若据此改动断言或放宽判据，护栏就会在无人察觉的情况下失效。两者与既有账目 545cca82「测试全绿信号无法担保路径被走过」是同一阻碍：机械信号不成立，只在被测路径确实被走过时才成立；而本项目所依赖的「故意引入回归→护栏须失败」这一验证动作，其自身「变异确实落地」这一步没有任何机械保障，故阴性结果与真实有效性在外观上不可区分。

补充观察（2026-10-11T08:02:30.042Z）：本次材料（主控派两路独立复核审核其工单优化观点，复核 B 对抗性重断）中，复核 B 明确指出 59b4899d 的 D8 缺陷「躲过 3 复核/1283 测试」而落地链路 D2 全程未接通，根因是测试从未真正驱动调用方——这正是「测试/复核全绿却无法担保关键路径被真正走过」的又一次实例，与既有观察账目 545cca82「测试全绿信号无法担保路径被走过」表述同一，故判 same-obstacle。我作为空闲辅助执行体只作判断不作决定，不评影响等级。另如实声明：材料在 turn 7 assistant 尾部被截断（止于「你先说说：这个汇总里，有没有哪一条跟你的实际体感和判」），未见主控最终收尾与用户后续回应；判断仅依据所见窗口内的内容完成。
