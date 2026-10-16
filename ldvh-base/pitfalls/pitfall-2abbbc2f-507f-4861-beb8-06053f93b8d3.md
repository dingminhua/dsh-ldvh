---
title: 受控写入重建漏抄字段被删除后回填
status: draft
scope: LDVH 受控写入与字段比对核查流程（摩擦账本等 frontmatter 载体）
object_uid: 2abbbc2f-507f-4861-beb8-06053f93b8d3
fact_type_key: pitfall
created_at: 2026-10-16T06:17:56.417Z
change_log:
  - at: 2026-10-16T06:17:56.417Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累（机械通道）于 2026-10-16T06:17:11.212Z 形成候选
---

# 受控写入重建漏抄字段被删除后回填

## 症状
受控写入某账目载体（frontmatter）时，本应保留的字段（如 `attribution`）被意外删除：重建写入内容时漏抄一行，字段连同被写入结果一起被抹去，与基线相比出现意外差异。

## 触发条件
以重建（记忆或截断输出为数据源）的方式组装要写入的内容，而不是从基线逐字复制时，容易漏掉某个非目标字段行；写入契约对未触字段按继承处理，但发出侧没有该字段，差异在 diff 比对中暴露。

## 根因
重建 frontmatter 时以记忆/截断输出为数据源，遗漏了个别字段行；受控写入未自带对未触字段的逐字比对，差异只能靠事后 diff 比对发现。材料中主控自述「只因为我重建 frontmatter 时漏抄一行」，并把该机制识别为 abf557e1 记的失效。

## 解决
重新读取 HEAD 上的原载体，将遗漏字段从 HEAD 逐字取回（「restore attribution verbatim from HEAD」），其余部分保持字节一致后再重写。

## 规避
受控写入后对未触字段与基线做逐字比对，发现差异即拒并回填，用 diff 比对代替对重建产物的目检，不凭记忆或截断输出直接组装写入内容。

## 验证
回填后 diff 与预期完全一致（「The diff is now exactly as intended」），工具读回指纹与 HEAD 精确一致，测试套件 1523 通过 0 失败，两账目销账后 open 数由 3 降到 1。

## 影响与适用范围
本机制作用于 LDVH 受控写入与字段比对核查流程（摩擦账本等 frontmatter 载体）。适用同类以重建方式产出受控写入、随后由 diff 比对核查的场景；未覆盖在前端仍为 open 的 abf557e1 账号面、非 frontmatter 写入路径的字段比对应用。
