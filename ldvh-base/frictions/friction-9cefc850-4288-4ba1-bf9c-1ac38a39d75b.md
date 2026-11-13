---
title: 规范已批字段在写入器闭集缺位
status: open
phenomenon: specs/29 §8 的 internal_evidence 与 specs/24 §8 的 serves 已由规范与 ADR 批准，但对应写入器的字段闭集（plugin/lib/devlog-writer.js 的 VALID_FM_KEYS、plugin/lib/research-writer.js）不含这些字段，按规范构造的写入被判 closed-set violation 拒收。
attribution: 类型规范的字段表（specs/29 §8、specs/24 §8）与其受控写入器的字段闭集（plugin/lib/devlog-writer.js 的 VALID_FM_KEYS、plugin/lib/research-writer.js 的字段闭集）之间的承载接缝：两侧各自维护字段清单，规范侧新增字段不触发写入器闭集变更，二者之间没有 schema–writer 一致性用例或常量化绑定，落差只能由按规范构造写入才暴露。
object_uid: 9cefc850-4288-4ba1-bf9c-1ac38a39d75b
fact_type_key: friction
created_at: 2026-11-13T16:57:35.885Z
change_log:
  - at: 2026-11-13T16:57:35.885Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-13T20:19:10.580Z
    provider: qoder-global
    model: qmodel_38max
    summary: 补充级更新（保持 open）：DevLog/internal_evidence 半边随类型撤除消失（specs/29 删 aeb5cb7b、devlog-writer/tools 删 6c1b15e3、internal_evidence 全库零命中）；Research/serves 半边实测仍活——24 §8 字段表与 ADR af38533d 均在、research-writer VALID_FM_KEYS 与工具 schema（additionalProperties:false）均不含 serves，按规范构造写入仍被拒；出路为补闭集+解析校验+一致性用例，待并行线收口后单批实施
occurrence:
  count: 3
  first_at: 2026-11-12T23:45:47.367Z
  last_at: 2026-11-13T16:29:05.440Z
---

# 规范已批字段在写入器闭集缺位

## 现象
specs/29 §8 的 internal_evidence 与 specs/24 §8 的 serves 已由规范与 ADR 批准，但对应写入器的字段闭集（plugin/lib/devlog-writer.js 的 VALID_FM_KEYS、plugin/lib/research-writer.js）不含这些字段，按规范构造的写入被判 closed-set violation 拒收。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-11-12T23:45:47.367Z，session-04bdf95b-a6a7-4e33-9d9a-17fbe414422a @ 25）`research-writer.js` 的 `VALID_FM_KEYS` 是硬编码白名单，没有加 `serves`，所以规范改了、代码没改，按新规范建对象会被拒。
（来源：25）
2. （2026-11-13T07:08:04.389Z，session-5b9bffce-77ac-4add-90d8-ab897b427a4c @ 5）ldvh_research_write 的 schema 拒收 serves——但 ADR-2「Research 增设 serves 目标锚定字段」已 active、24 §8.1 也已把它列为可选字段。
（来源：5）
3. （2026-11-13T16:29:05.440Z，session-500e73c5-7df1-46ad-b2c8-0828def45165 @ 3）但 `plugin/lib/devlog-writer.js` 的 `VALID_FM_KEYS` 里没有这个字段
（来源：3）

## 入账依据
可归因性：拒收直接由写入器字段闭集产生，与规范字段表的位置一一对应，不是调用方传参错误；修了会更好的预期：把已批字段补进字段闭集并加 schema–writer 一致性用例后，照规范写的写入不再被自身机制拒收。

补充级更新（2026-11-14，主控核查，**不构成销账**）：**两半前提一消一存——DevLog/internal_evidence 半边随类型撤除而消失；Research/serves 半边的落差经实测原样存活，故状态保持 open。**

**① DevLog 半边已消失（实测）。** `aeb5cb7b`（2026-11-14）把 specs/29 整份物理删除，`6c1b15e3`（2026-11-14「DevLog 退场代码层」）删除了 devlog-writer.js 与 devlog-tools.js；本次核验 `internal_evidence` 在 plugin/lib 与 specs/ 全库零命中，观察 3 点名的 `devlog-writer.js VALID_FM_KEYS` 已不存在。「规范已批 internal_evidence 而写入器拒收」这半边落差连同两侧承载一并消失。

**② Research 半边仍活（实测，本次核验三处）。** (a) 声明侧在：specs/24 §8 字段表仍列 `serves`（可选、须解析到 active/achieved SubGoal、24 §8.1/不变量 11），其依据 ADR「Research 增设 serves 目标锚定字段」（af38533d）仍 active，24 §8:196 且已把采用面收窄记载为「原另一采用方 DevLog 已于 2026-11-14 撤除」——即规范侧在 DevLog 撤除后**明确保留了 Research 的 serves 契约**；(b) 实现侧缺：research-writer.js:57 的 `VALID_FM_KEYS` 仍不含 `serves`（全文件该词零命中），research-tools.js 的参数 schema（frontmatter_draft/frontmatter_after 均 `additionalProperties: false`）也不声明 `serves`；(c) 后果不变：今天按 24 §8 构造一次带 `serves` 的 Research 创建，仍会在 schema 层或 closed-set 校验被拒——观察 1/2 的失效形态逐字可复现。

**③ 不销账的理由与出路。** 不标 resolved：无可指解药，落差半边存活。不标 voided：Research 侧承载面（24 §8 字段表、ADR、writer 闭集、工具 schema）全部在位，阻碍随时可复现。出路即入账依据原句：把 `serves` 补进 research-writer 的 `VALID_FM_KEYS` 与工具 schema（含 24 §8 要求的 UUID 形态校验与 resolveSubGoal 目标解析，参照 devlog-writer 撤除前的 serves 实现与 spark/subgoal 两侧同口径），并补 schema–writer 一致性用例。本轮不动代码的如实理由：并行工作线正在改同一测试面（schema-writer-agreement.test.mjs 在途未提交），共享工作树下同时改同域文件有在途冲突风险（既有账目 d7e0a3d3/68e6f33e 的教训），修复应待该线收口后单批实施。
