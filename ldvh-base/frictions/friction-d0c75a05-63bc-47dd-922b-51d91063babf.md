---
title: 建前预检与写入器字段判据不同源
status: open
phenomenon: Norm create 的建前预检把 writer 会剥离的 frontmatter_draft.change_summary 判为闭集外字段，一份完全合法的创建被预检直接拒收，且给出的拒因与 writer 不同。
attribution: 根在 Norm create 建前预检层与 norm-writer 校验层之间的「喂入校验函数前的对象形态」接缝：预检把原始 frontmatter_draft 与原始 body 直接交给校验函数，而 writer 会先剥离 change_summary、先拼装 body 再校验，两侧字段搬运与状态归一不同源。
object_uid: d0c75a05-63bc-47dd-922b-51d91063babf
fact_type_key: friction
created_at: 2026-11-15T13:42:10.433Z
change_log:
  - at: 2026-11-15T13:42:10.433Z
    provider: workbuddy
    model: hy4free
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
occurrence:
  count: 3
  first_at: 2026-11-14T19:47:46.483Z
  last_at: 2026-11-15T09:36:43.841Z
---

# 建前预检与写入器字段判据不同源

## 现象
Norm create 的建前预检把 writer 会剥离的 frontmatter_draft.change_summary 判为闭集外字段，一份完全合法的创建被预检直接拒收，且给出的拒因与 writer 不同。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-11-14T19:47:46.483Z，session-12ab3c2f-4cd9-43ee-8a75-37cadf265612 @ 7）create 侧没预检 frontmatter 闭集与方向键唯一性就提问
（来源：7）
2. （2026-11-14T20:28:28.288Z，session-12ab3c2f-4cd9-43ee-8a75-37cadf265612 @ 9）同源不是「调同一个函数」，是「连函数之前的字段搬运与状态归一也要一致」
（来源：9）
3. （2026-11-15T09:36:43.841Z，session-12ab3c2f-4cd9-43ee-8a75-37cadf265612 @ turn 8..9）一份完全合法的创建被我的预检拦死，理由还写错了，会把人引向「删掉 change_summary」这个错误修法。
来源：主控会话 turn 9 助手最终回复「我自己犯的错（两个）」段第一项（以「一、我第一版的预检把合法输入挡死了」起首的小节）

## 入账依据
可归因：预检层与写入层各自维护字段判据，一份按 schema 构造的合法创建会在预检层被直接挡死，且拒因与 writer 判定不一致，会把人引向「删掉 change_summary」这个错误修法；预检入口与 writer 同处 plugin/lib 写入面却非同源（字段搬运与状态归一没有常量化绑定或一致性用例），落差只能由构造一份合法输入才暴露。预期收益：把预检喂入校验函数前的对象形态与 writer 的字段搬运对齐后，合法输入不再被误伤。
