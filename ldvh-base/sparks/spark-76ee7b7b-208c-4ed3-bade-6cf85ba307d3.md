---
title: 上游 DSH 能力变化的吸收
status: open
question: 上游 DSH 版本演进带来的能力变化与缺口如何持续吸收？
scope_boundary: 当前已知版本差异已吸收或明确不采用、且后续版本变化有跟踪机制时停止。
intent: 保留理由——上游持续演进，能力面变化直接影响插件实现与「四档纪律」的档位诚实性规则（依赖未实测宿主机制的档位必须标注待实测并降一档）；属需长期跟踪并吸收的方向。
summary: "`dsh-current-version-and-market-gap.md`（128 行）与 `dsh-0.1.2-upgrade-survey.md`（154 行）记录上游 DSH 重大更新的全量差异与市场缺口（性质自述：开发设计输入，非规范、非事实对象）。已知要点（另见 team-control 底座 §0.4 的 0.1.2-rc.1 更新注）：上游**删除了 `registerContinuableSetup`**，原候选实现失效；**新候选=双缝**——①`toolFilter`（`startContinuable` 声明 `{allow,deny}`，未发布创建窗口经 scoped restrict 应用、执行层 `UNKNOWN_TOOL` 拒绝；0.1.1 的纯 schema 掩蔽已修）；②`ctx.tools.guard(fn)` 宿主原生执行期单调拒绝层（pre-execute 放行后运行、无人能强制放行、经 `agent.ctx` 单 agent 生效）。**实测项**：toolFilter 的覆盖面（preset 贡献工具 / 孙代传播）+ `guard` 的 LDVH 语境复现。相关：编排的宿主 API 面（0.1.2-rc.1 已核验）含 `startContinuable + toolFilter`、`sendMessage`、`interrupt`、`listChildren / listDescendants / drainContinuable*`、`tools.guard`、`jobs`。"
serves: SG-3
object_uid: 76ee7b7b-208c-4ed3-bade-6cf85ba307d3
fact_type_key: spark
created_at: 2026-09-12T21:52:17.976Z
change_log:
  - at: 2026-09-12T21:52:17.976Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
---

# 上游 DSH 能力变化的吸收

## 当前理解

`dsh-current-version-and-market-gap.md`（128 行）与 `dsh-0.1.2-upgrade-survey.md`（154 行）记录上游 DSH 重大更新的全量差异与市场缺口（性质自述：开发设计输入，非规范、非事实对象）。已知要点（另见 team-control 底座 §0.4 的 0.1.2-rc.1 更新注）：上游**删除了 `registerContinuableSetup`**，原候选实现失效；**新候选=双缝**——①`toolFilter`（`startContinuable` 声明 `{allow,deny}`，未发布创建窗口经 scoped restrict 应用、执行层 `UNKNOWN_TOOL` 拒绝；0.1.1 的纯 schema 掩蔽已修）；②`ctx.tools.guard(fn)` 宿主原生执行期单调拒绝层（pre-execute 放行后运行、无人能强制放行、经 `agent.ctx` 单 agent 生效）。**实测项**：toolFilter 的覆盖面（preset 贡献工具 / 孙代传播）+ `guard` 的 LDVH 语境复现。相关：编排的宿主 API 面（0.1.2-rc.1 已核验）含 `startContinuable + toolFilter`、`sendMessage`、`interrupt`、`listChildren / listDescendants / drainContinuable*`、`tools.guard`、`jobs`。

（来源：docs/dsh-current-version-and-market-gap.md、docs/dsh-0.1.2-upgrade-survey.md；普查条目 B-04）

## 调查问题

上游 DSH 版本演进带来的能力变化与缺口如何持续吸收？

## 调查边界

当前已知版本差异已吸收或明确不采用、且后续版本变化有跟踪机制时停止。
