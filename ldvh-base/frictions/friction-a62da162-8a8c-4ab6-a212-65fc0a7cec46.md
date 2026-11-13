---
title: 同批规范候选就摘要是否入指纹自相否证
status: open
phenomenon: 同一批规范候选中，specs/02 通用口径条把 change_summary 列为候选内容（取值变化即内容变化），同批 specs/20 新增段与实施清单却要求把 change_summary 从指纹里剥掉，两条规则互相否证。
attribution: specs/02 通用口径条与 specs/20 新增段及实施清单 D8a/D8c 之间的候选指纹口径接缝：起草与定稿环节没有把「省略≡显式值」的适用前提逐字段核实到同批其它载体，也没有跨文件核对同一字段在各载体中的处置是否一致。
object_uid: a62da162-8a8c-4ab6-a212-65fc0a7cec46
fact_type_key: friction
created_at: 2026-11-13T08:29:56.377Z
change_log:
  - at: 2026-11-13T08:29:56.377Z
    provider: minmax
    model: MiniMax-M3.1-Flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
occurrence:
  count: 3
  first_at: 2026-11-11T20:04:13.750Z
  last_at: 2026-11-13T08:12:32.355Z
---

# 同批规范候选就摘要是否入指纹自相否证

## 现象
同一批规范候选中，specs/02 通用口径条把 change_summary 列为候选内容（取值变化即内容变化），同批 specs/20 新增段与实施清单却要求把 change_summary 从指纹里剥掉，两条规则互相否证。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-11-11T20:04:13.750Z，session-500e73c5-7df1-46ad-b2c8-0828def45165 @ 1）状态闭集为 `active/absorbed/dropped`
（来源：1）
2. （2026-11-13T07:50:27.649Z，session-5b9bffce-77ac-4add-90d8-ab897b427a4c @ 11）02 新写的第一条说「含流入 change_log 的摘要（取值变化即内容变化）」；同一批的 20 号文本与实施清单却要求把 change_summary 从指纹里剥掉，理由写「它取 Code 默认值」。
（来源：11）
3. （2026-11-13T08:12:32.355Z，session-5b9bffce-77ac-4add-90d8-ab897b427a4c @ 13）02 新写的第一条说「**含流入 `change_log` 的摘要**（取值变化即内容变化）」；同一批的 20 号文本与实施清单却要求**把 `change_summary` 从指纹里剥掉**，理由写「它取 Code 默认值」。
（来源：13）

## 入账依据
两条规则落在同一批提交、针对同一个字段给出相反处置，若照现文提交会把「省略≡显式值」这一已被实测证伪的推理固化成公共口径并重开已被修好的缺陷；跨文件逐条核对候选与实施清单的字段处置即可在提交前消除这类自相否证。
