---
title: 管辖判定操作的名实错配
status: implemented
question: "`resolve-governance-scope` 命名与实际判定语义（项目资格 vs 工作范围）错配应如何消解？"
scope_boundary: 命名或语义表述定案并同步到 07 与实现时停止。
intent: 保留理由——名实不一致会让后续消费者误以为该操作返回「管辖范围」，而它实际回答的是项目资格；属可独立分流的轻量方向。本条已由概念收敛解决：同一实体的双名是误解根源，消除「工作对象」后操作名与语义自洽。
summary: "已消解。根因不是操作名 `resolve-governance-scope` 本身，而是同一实体（`07 §6` 的 Git 根 + `ldvh-base/` + `specs/`）有两个名字：「工作对象」与「管辖范围」。概念收敛后，「工作对象」作为第三个名字被消除，地盘边界统一称「管辖范围」——而 `scope` 的中文对应正是「管辖范围」，操作名随之名副其实，无需改名。判断依据：`05 §6.1` 明定 `operation_key` 只稳定识别服务行为、不能从名称推导语义，故操作名本身不构成契约缺陷；真正的误解源是同实体双名。已落地改动：`specs/07` 共 13 处用词收敛，文件名同步为 `specs/07-管辖范围规范.md`；`specs/01` 登记表摘要、`specs/05` §3.2、`specs/25` §3.2 与两份 web 文档路径同步。经机械校验：身份块解析与路径一致性 ok: true，操作声明锚点 2/2 可解析，插件测试 720 通过 0 失败。保留未改并按语境判定：00 V1/V2、03 F0、04 §7.3、05 §6.2、31 中的「工作对象」均指「当次事务」而非 07 术语。`spec_key` 依 01 §6.2「职责标识符不得改派」保留原名，属已知残留、不影响理解。"
serves: SG-1
disposition: 已落实为概念收敛：07 §6「工作对象」统一为「管辖范围」，消除同实体双名；操作名 resolve-governance-scope 保留不改（scope 即管辖范围）。落地见 specs/07 标题与正文 13 处、文件名、01 登记表摘要、05 §3.2、25 §3.2 及 web 文档路径。spec_key 依 01 §6.2 保留原名。
object_uid: 64ae68ac-4294-4ed7-9c46-2d5ba4afbd31
fact_type_key: spark
created_at: 2026-09-12T21:46:36.301Z
change_log:
  - at: 2026-09-12T21:46:36.301Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-09-13T01:07:17.768Z
    provider: zzztoken-glm
    model: deepseek-v4.1-flash
    summary: 概念收敛落地：07 §6「工作对象」统一为「管辖范围」，标为 implemented
  - at: 2026-09-13T01:45:06.153Z
    provider: zzztoken-glm
    model: deepseek-v4.1-flash
    summary: 更正终态记录：disposition 压缩至 200 字符内（20 §9.1 新上限）；同时修正重复 H1
  - at: 2026-09-13T01:45:44.407Z
    provider: zzztoken-glm
    model: deepseek-v4.1-flash
    summary: 更正正文结构：移除重复 H1（H1 由写入器按 title 生成，body 不应携带）
---

# 管辖判定操作的名实错配

## 当前理解

已消解。根因不是操作名 `resolve-governance-scope` 本身，而是同一实体（`07 §6` 的 Git 根 + `ldvh-base/` + `specs/`）有两个名字：「工作对象」与「管辖范围」。概念收敛后，「工作对象」作为第三个名字被消除，地盘边界统一称「管辖范围」——而 `scope` 的中文对应正是「管辖范围」，操作名随之名副其实，无需改名。判断依据：`05 §6.1` 明定 `operation_key` 只稳定识别服务行为、不能从名称推导语义，故操作名本身不构成契约缺陷；真正的误解源是同实体双名。已落地改动：`specs/07` 共 13 处用词收敛，文件名同步为 `specs/07-管辖范围规范.md`；`specs/01` 登记表摘要、`specs/05` §3.2、`specs/25` §3.2 与两份 web 文档路径同步。经机械校验：身份块解析与路径一致性 ok: true，操作声明锚点 2/2 可解析，插件测试 720 通过 0 失败。保留未改并按语境判定：00 V1/V2、03 F0、04 §7.3、05 §6.2、31 中的「工作对象」均指「当次事务」而非 07 术语。`spec_key` 依 01 §6.2「职责标识符不得改派」保留原名，属已知残留、不影响理解。

（来源：docs/archive/read-dimension-understanding.md §0.1）

## 调查问题

`resolve-governance-scope` 命名与实际判定语义（项目资格 vs 工作范围）错配应如何消解？

## 调查边界

命名或语义表述定案并同步到 07 与实现时停止。
