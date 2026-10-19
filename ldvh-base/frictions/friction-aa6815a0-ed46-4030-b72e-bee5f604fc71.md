---
title: 入档转正仅靠一手记录佐证未当场重演
status: observing
phenomenon: 一条 Pitfall 候选的转正依据含未经当场重演的端到端 `passed`，转正时未被拦截而被写为 active。
impact: medium
object_uid: aa6815a0-ed46-4030-b72e-bee5f604fc71
fact_type_key: friction
created_at: 2026-10-18T05:58:29.940Z
change_log:
  - at: 2026-10-18T05:58:29.940Z
    provider: xiaomi-token-plan-cn
    model: mimo-v2.6-flash
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
  - at: 2026-10-18T19:33:52.616Z
    provider: go
    model: space-bunny
    summary: 补充观察：count 1 → 2（36 §9 第 2 项）
occurrence:
  count: 2
  first_at: 2026-10-18T05:57:45.269Z
  last_at: 2026-10-18T19:33:19.638Z
  human_return_at: null
---

# 入档转正仅靠一手记录佐证未当场重演

## 现象
一条 Pitfall 候选的转正依据含未经当场重演的端到端 `passed`，转正时未被拦截而被写为 active。

## 入账依据
材料中转正条目（116625df）的通过证据是历史一手记录而非当场重演，且助手自述「如果要严格执行，后续应给经验入档增加一道前置检查：没有当场重演或可自动重演的执行方式，就不得转正」——说明当前入档路径无此机械前置，修了能拦住同类弱证据转正，故构成阻碍。

补充观察（2026-10-18T19:33:19.638Z）：引证处助手自述：e590edb8 上一轮转正所附的验证段是照抄候选自述的结果，自己并未真正复现。既有账目 aa6815a0「入档转正仅靠一手记录佐证未当场重演」描述的正是同一阻碍——转正动作以候选自述充当一手佐证、缺少当场重演；本条是该阻碍的再次发生，故判 same-obstacle 而非新条目。材料中另一现象「我先前那次 `grep` 命中的是过期的读缓存」属缓存陈旧致误判，与既有 fbd65401（宿主缓存旧模块致误报）同阻碍，同样不另立新条目。须说明：本次材料只含 turn 5 且因长度上限被截断（正文末尾停在「active → discarded」），故比对仅就所见部分作出。
