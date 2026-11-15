---
title: 规范标题路径带 markdown 前缀致读取被拒
status: active
scope: 适用于所有经 `ldvh_read_specification_content` 的 L3 读取（`heading_path` 为 H2 或 H2/H3），以及复用同一标题路径解析的 05 §6.1 操作声明表锚点校验。凡由人或模型照抄源文件标题行、或在标题路径里保留 markdown 标记的调用都可能落入；当标题路径取自大纲且不含 `#` 标记时，经验可信。不适用于不带 `heading_path` 的 L4 全源读取与 L0–L2 披露层；标题正文含 `/` 或存在同名标题时，本条不提供可用解法。同轮 `heading-path reads` 失败的调用即此类。
object_uid: d06bb77a-de13-4c76-b77e-3150d1731bbe
fact_type_key: pitfall
created_at: 2026-11-15T15:52:04.606Z
change_log:
  - at: 2026-11-15T15:52:04.606Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累·审核段据缓冲条目 dc3cc0c6-fc52-4bfe-a4e6-8ca58b107dc1 形成候选（11 §10.2 第 3 项）
---

# 规范标题路径带 markdown 前缀致读取被拒

## 症状
助手在同一轮内多次调用 `ldvh_read_specification_content` 做 L3 精确读取，全部被拒，拒因为 `content/heading_not_found`；请求里带的标题路径是 markdown 整行形态（含 `## ` 前缀）。逐字引证：

> Several heading-path reads failed
> 来源：本会话观察材料 [turn 1] assistant 正文：「I have spec 11 (host auxiliary task) fully. Several heading-path reads failed, so let me get the correct outlines…」；同轮后段又自述「my earlier heading paths had a `## ` prefix mismatch」。

## 触发条件
调用方把规范源里的整行标题（例如 `## 6. 检查机制三形态`）直接当作 `heading_path` 传入，或从源文件、渲染视图复制标题、凭印象给标题补上 `## ` 前缀时触发。同轮自述给出直接线索：「my earlier heading paths had a `## ` prefix mismatch」。

## 根因
读取工具按标题正文寻址：`heading_path` 以 `/` 分成 H2 或 H2/H3 段，每段只去首尾空白，再与文档里去掉 `## `/`### ` 标记后的标题正文做逐字相等比较；调用方传入的 `## 6. …` 不会被剥掉标记，段文本与标题正文不相等，H2 匹配为零，于是判为 `content/heading_not_found`，H3 段同理。该行为与自述「my earlier heading paths had a `## ` prefix mismatch」一致。

## 解决
实际处理：不再把整行标题传入，而是改取正确大纲（材料原文：「let me get the correct outlines」），以无前缀的标题正文重读。成功信号：改取正确大纲后的重读不再被前缀不匹配拦下，读取流程继续推进。

## 规避
调用前从 L1/L2 大纲或 `ldvh_read_specification_candidates` 取标题正文，不要从源文件照抄整行；若标题以 `#` 开头，先剥掉 `#{2,3} ` 前缀再拼 H2 或 H2/H3 路径。收到 `content/heading_not_found` 且请求串以 `## ` 开头时，按「剥前缀后重试」处理，不要改读 L4 全源来绕开定位。另须注意：标题正文含 `/` 时无法用该路径寻址，同名标题会被 `content/heading_ambiguous` 拒绝，这两种情形应改读上级段或 L4。同轮 `heading-path reads` 失败的调用都能由此避免。

## 验证
已观察：同一轮内多次读取因标题路径带 `## ` 前缀被拒（逐字引证「Several heading-path reads failed」），助手自述根因为前缀不匹配（「my earlier heading paths had a `## ` prefix mismatch」）并改取正确大纲后重读（「let me get the correct outlines」）。未覆盖：`### ` 前缀、行尾闭合 `#`、缩进标题等其它 markdown 变体未逐一实测；H2/H3 双段路径中各段都须无前缀这一点由解析逻辑推得，未用独立用例验证；该形态是否同样影响 05 §6.1 操作声明表的标题锚点解析，未单独取证。

## 影响与适用范围
适用于所有经 `ldvh_read_specification_content` 的 L3 读取（`heading_path` 为 H2 或 H2/H3），以及复用同一标题路径解析的 05 §6.1 操作声明表锚点校验。凡由人或模型照抄源文件标题行、或在标题路径里保留 markdown 标记的调用都可能落入；当标题路径取自大纲且不含 `#` 标记时，经验可信。不适用于不带 `heading_path` 的 L4 全源读取与 L0–L2 披露层；标题正文含 `/` 或存在同名标题时，本条不提供可用解法。同轮 `heading-path reads` 失败的调用即此类。
