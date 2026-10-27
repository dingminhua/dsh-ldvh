---
title: 粗粒度拒绝断言致目标校验零检测
status: active
scope: 适用于本插件回归用例中以不区分层的断言去验证某一层形态校验的场景；本例的抢先命中发生在工具层正文形态校验与 writer 层 H1 计数之间。不涉及宿主模块加载或 HMR 行为。
object_uid: ef04d0a1-1bcb-416d-b308-c6097dfd8a93
fact_type_key: pitfall
created_at: 2026-10-19T07:35:12.254Z
change_log:
  - at: 2026-10-19T07:35:12.254Z
    provider: go
    model: space-bunny
    summary: 闲时辅助经验积累（机械通道）于 2026-10-19T07:33:27.251Z 形成候选
  - at: 2026-10-27T18:26:05.424Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 独立复现验证通过（隔离子代理 762dde2b，同模型/独立上下文）：旧形态下拒绝来自 writer 层 H1 计数（gaps 逐字可核）、把工具层门禁放行后现行用例转红，证明收窄后的断言有检测力。据 Human 2026-10-28「验证属实即入档」逐条验收指示，draft→active 入档。
  - at: 2026-10-27T19:32:02.687Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充级更新（23 §9.3）：登记 2026-10-28 机械化承载与规范依据盘点结论——机械承载为覆盖不全（用例已收窄到 invalid_request 并钉住理由，破坏性反证做过），规范源为部分吸收（05:190 只限响应生产侧）；状态与 scope 不变。
---

# 粗粒度拒绝断言致目标校验零检测

## 症状
回归用例 `plugin/test/workcase-execute-inherit.test.mjs:241`（断言「缺 `## 摘要` 必须拒绝」的那条）失败，但失败原因与被测目标无关：请求被拒的真实理由来自 writer 层的 H1 计数，而该用例想验证的是工具层的正文形态校验。复核者第 11 轮把这一现象表述为「测到了另一道校验路径」。

## 触发条件
用例正文采用整体转义后拼接，使正文同时具备上游校验的命中条件；而断言写成 `rejected`——一个不区分拒绝层的粗粒度值——于是上游校验先返回拒绝，用例即以「被拒绝」满足断言，目标校验从未执行。

## 根因
断言的取值域把不同层的拒绝折叠为同一个 `rejected`，使「被拒」与「被哪一层拒」不可分辨；同时 writer 层的 H1 计数先于工具层 `normalizeBodyMarkdown` 的形态校验执行并返回拒绝，两者叠加使该用例对目标校验的检测力为零。

## 解决
把用例正文改为逐段转义、再用字面量 `\n` 拼接，消除上游 H1 计数抢先命中的条件；并把断言从 `rejected` 收窄为能指明层的 `invalid_request`。修改已落到该测试文件。

## 规避
新增针对某一层校验的回归用例时：(1) 断言取能区分校验层的具体拒绝码，不使用统一的 `rejected`；(2) 构造正文后先确认它不会触发前序校验层；(3) 在用例中写明本例要命中的校验层与可能抢先命中的前序层，避免后人把「通过」误读为目标校验已被覆盖。

## 验证
已观察：`test/workcase-execute-inherit.test.mjs` 的 7 条测试全部通过；修正前该用例在目标校验未执行的情况下以「被拒绝」满足断言，复核意见与修正后收窄的断言互为对照。
未覆盖：本次验证只在磁盘代码与测试进程内成立；同一会话中宿主运行实例仍执行旧副本（`plugin_manager` 停用再启用只报 `application: "applied"`、行为不变），故工具层校验在真实调用链上的行为未被覆盖。

独立复现验证（2026-10-28，入档前置）：复现主体为隔离子代理（独立上下文 session 762dde2b-f796-410c-927e-bf89b5712245，未参与本候选形成）；独立性边界为与形成者同一模型（dsh-opencode-go/deepseek-v4.1-flash）、上下文隔离。复现做法：`node --test test/workcase-execute-inherit.test.mjs` 得 7 项全过；在 /tmp 副本把该用例正文改回「整体转义」并把断言写回 `rejected`。观察一：旧形态 outcome=rejected，gaps 为 `body: expected exactly 1 H1 heading, found 2`——拒绝确由 writer 层 H1 计数给出，用例以「被拒绝」通过而工具层形态校验未执行。观察二：在 /tmp 把 `normalizeBodyMarkdown` 改为无条件放行后，现行用例失败并落到 `rejected`，证明修正后的 `invalid_request` 断言确有检测力。观察三：HEAD 用例已采用逐段转义 + 字面量 `\n` 拼接，`:262` 的断言与拒绝层一一对应。复现未覆盖：形成会话（2026-10-19）不在本机会话库，「复核者第 11 轮」原文及宿主实例仍跑旧副本的说法无法核对；真实调用链未覆盖。

**机械化承载与规范依据盘点（2026-10-28）**：机械承载为**覆盖不全**——`plugin/test/workcase-execute-inherit.test.mjs:262` 已收窄为 `env.outcome === "invalid_request"`，`:263` 再钉住拒绝理由须含 `## 摘要`，`':250'` 的逐段转义与字面量 `\n` 拼接消除了 writer 层抢先命中的条件；破坏性反证做过（/tmp 把 `normalizeBodyMarkdown` 改为无条件返回正文后该用例转红，实际落到 `rejected` 且 gaps 为 `body: expected exactly 1 H1 heading, found 2`，正是本条描述的抢跑形态；还原后 7/7）。缺的块：只覆盖 execute 的「缺 `## 摘要`」这一道门禁，同文件 `:160`、`:182` 仍用 `rejected`（这两条确属 writer 层，合法），全仓 40+ 处 `rejected` 断言没有任何「命中的是哪一层」判据；规避的三条没有跨用例门禁或检查器。规范源为**部分吸收**：`specs/05` :190「`completed`、`partial`、`unavailable`、`rejected`、`invalid_request` 与 `execution_error` 必须可区分」与 :196 的取值定义，效力落在**响应生产侧**（状态取值不得折叠），未要求「验证某一层校验的用例把断言钉在该层状态上」，也未要求用例声明目标层与前序层。故本条保留。

## 影响与适用范围
适用于本插件回归用例中以不区分层的断言去验证某一层形态校验的场景；本例的抢先命中发生在工具层正文形态校验与 writer 层 H1 计数之间。不涉及宿主模块加载或 HMR 行为。
