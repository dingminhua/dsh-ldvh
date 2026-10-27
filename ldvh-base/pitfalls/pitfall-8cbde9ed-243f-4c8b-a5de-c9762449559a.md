---
title: 回归用例虚构事实读取形状致复核阻塞
status: active
scope: 适用于 Web 端事实读取（facts.ts 展平返回）相关的契约与回归测试编写，以及任何以嵌套路径断言事实字段的用例；不适用于受控写入的正文结构、残留段解析与 H1 校验场景。
object_uid: 8cbde9ed-243f-4c8b-a5de-c9762449559a
fact_type_key: pitfall
created_at: 2026-10-20T08:42:17.240Z
change_log:
  - at: 2026-10-20T08:42:17.240Z
    provider: workbuddy
    model: space-bunny
    summary: 闲时辅助经验积累（机械通道）于 2026-10-20T08:40:59.704Z 形成候选
  - at: 2026-10-27T18:26:05.443Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 独立复现验证通过（隔离子代理 762dde2b，同模型/独立上下文）：showObject 返回证实事实展平（'fact_object' in data === false）、两个针对性测试文件 4+2 全通过、提交 3780c0c 与修复同批。据 Human 2026-10-28「验证属实即入档」逐条验收指示，draft→active 入档。
---

# 回归用例虚构事实读取形状致复核阻塞

## 症状
在「修复 attribution_ref 三处静默丢弃」工单的实施阶段，独立复核（后台子代理）给出结论"建议不关闭"，附带 7 个发现 + 1 个独立项；其中发现 1 与发现 2 指向助手自己写出的测试用例失败——测试按嵌套路径 `data.fact_object` 取事实对象并据此断言，该路径在真实返回中不存在，于是断言落空、工单无法收口。

## 触发条件
为验证 attribution_ref 对象形状而编写的测试，只要假定事实对象以嵌套字段形式挂在 `data.fact_object` 之下即触发；读取侧对事实做了展平处理时，该假设必然不成立，失败必然出现。

## 根因
读取侧 facts.ts 会将事实对象展平后返回，事实字段因此位于结果对象的顶层，而不是嵌套在 `data.fact_object` 之下；测试作者按未经核对的嵌套形状编写断言，把宿主的真实返回结构记成了另一种形状，于是被判为「对象不存在」而失败。这是「回归用例以虚构形状编码宿主语义致修复受阻」机制的一次再现。

## 解决
已按 facts.ts 的展平事实重写该批测试的取值路径，使其与读取侧真实返回形状一致；同时按独立复核的其余发现逐项处理（含发现 3 所指的坏对象被静默投影），并在 `plugin/web/tests/api/` 下新增 `friction-attribution-ref-fidelity.test.ts` 与 `friction-attribution-ref-shape.test.ts` 两个针对性测试文件。

## 规避
编写断言前先读一次读取侧实现，确认真实返回结构（尤其是展平、嵌套这类形状变换），只对实际存在的路径断言；把对形状的假设先落成一条会失败的最小用例，确认失败原因落在形状而非其它分支后，再补全断言内容。

## 验证
已观察：独立复核列出的 7 个发现与 1 个独立项（含发现 1&2 的失败测试、发现 3 的静默投影）均已按材料记述处理完毕，并新增了两个针对该形状的针对性测试文件；普查阶段基线为 514 个 Web 测试通过。未覆盖：材料在「Gate 2」处被截断，未出现改动之后完整测试套件的通过记录，也未出现独立复核重新出具「建议关闭」的结论。

独立复现验证（2026-10-28，入档前置）：复现主体为隔离子代理（独立上下文 session 762dde2b-f796-410c-927e-bf89b5712245，未参与本候选形成）；独立性边界为与形成者同一模型（dsh-opencode-go/deepseek-v4.1-flash）、上下文隔离。复现做法：以 friction 夹具经 `showObject` 读取，分别取顶层字段与 `data.fact_object`；再单跑两个针对性测试文件。观察一：`data.attribution_ref` 存在，`'fact_object' in data === false`、`data.fact_object === undefined`——按嵌套路径断言的用例必然落空（`facts.ts` 以 `...item.fact_object` 展平返回）。观察二：`friction-attribution-ref-shape.test.ts` 4 项、`friction-attribution-ref-fidelity.test.ts` 2 项均通过，测试内已明确断言 `'fact_object' in data === false`。观察三：两个测试文件由 `3780c0c` 与本修复同时加入，取值路径已改为顶层。复现未覆盖：形成期独立复核报告与失败测试输出无留痕（会话库自 2026-10-20 起才有记录），「7 个发现 + 1 个独立项」逐项及「514 Web 测试通过」基线未能核对；只跑两个文件，全量未跑。

## 影响与适用范围
适用于 Web 端事实读取（facts.ts 展平返回）相关的契约与回归测试编写，以及任何以嵌套路径断言事实字段的用例；不适用于受控写入的正文结构、残留段解析与 H1 校验场景。
