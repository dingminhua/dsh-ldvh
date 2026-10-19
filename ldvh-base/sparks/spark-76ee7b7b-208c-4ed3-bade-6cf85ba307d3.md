---
title: 建立上游 DSH 能力变化的吸收与同步机制
status: open
question: 上游 DSH 能力变化（版本推进、契约面增删改、破坏性迁移）如何被持续地机械吸收与同步，而不是靠人工事后补？
scope_boundary: 宿主基线有唯一权威登记点、契约面差分可取数、差动能机械落到「破坏／降级／无关」三态，且落地时机点被规范写明时停止。
intent: 保留理由——上游持续演进，能力面变化直接影响插件实现与「四档纪律」的档位诚实性（依赖未实测宿主机制的档位必须标注待实测并降一档）。现状核实表明：本仓已有一次真实破坏（0.2.1-rc.1 移除 start/startContinuable）由人工事后补，而版本推进记录仍停在 norm 的观察值；故须从「泛方向跟踪」收紧为「可机械执行并记录落地时机的机制」。
summary: |-
  本 Spark 已由「上游 DSH 能力变化的吸收」（泛方向跟踪）收紧为「建立上游 DSH 能力变化的吸收与同步机制」（Human 指令 m00496）。原摘要所据的两份 docs 调研（`dsh-current-version-and-market-gap.md` 128 行、`dsh-0.1.2-upgrade-survey.md` 154 行）已随提交 ec19ba6（2026-10-12）整体删除 docs/ 而不可再取，凭据链断裂，故不再作为当前理解的依据。

  ### 现状核实（2026-10-19 实测）

  - 宿主已推进到 **0.2.1-rc.2**（`CFBundleShortVersionString`；asar 内 296 个 dsh* 包全为 0.2.1-rc.2），而 norm `a1b559a6`（本地开发工作流）的「目标环境」仍登记 0.2.0-rc.2（观察时点 2026-09-30）——登记值已被实测推翻。
  - 区间 dsh-v0.2.0-rc.2（2026-09-29）→ dsh-v0.2.1-rc.2（2026-10-17）共 1925 commits：契约表服务 91→98（删 1 增 8、改 24）、事件 81→82（改 1）、类型 936→1053（删 9 增 126、改 51）、模型可见工具名 65→68（零删除）、会话事件 type 闭集与 SESSION_FORMAT_VERSION(4) 未变。
  - 本插件消费面 12 服务 / 9 事件，逐条比对后**唯一被删除的服务是 `invariants`**（替换为软探测惰性，不构成运行时破坏，但造成安装期 schema 断言静默降级）；所消费的 systemPrompt / webServer / connection 成员均未变（仅新增方法）。
  - 已发生过一次真实破坏并由人工吸收：宿主 0.2.1-rc.1 起 `start` / `startContinuable` 移除、`SubagentRun.localAgent` 消失（见 plugin/lib/friction-discovery-provider.js:8-16、plugin/lib/session-signature.js:206-228）。
  - specs 全文无「宿主版本追踪 / 契约快照 / 侵入性检查 / 基线核对」条款；spec 10 §8 验证表 10 行全部是「本仓内部一致性」，没有一行比对上游版本差异。
  - 现有实现只有**运行时软探测**（plugin/lib/host-seams.js 的 `snapshot()` 对五缝返回 consumed/absent/available/partial，plugin/lib/index.js:373-390 在装载期逐条 logger.info），它探测「宿主缺该能力」，不比对「宿主版本变了」，且派发点 friction-discovery-provider.js:386 直接调用 `subagents.startActivation(...)`、无存在性守卫。
  - 现有「版本推进 → CHANGELOG 记一条 + 契约差分数字」是**手工惯例**（plugin/CHANGELOG.md 已有 0.1.7-rc.2 / 0.2.0-rc.1 / 0.2.0-rc.2 三条先例），未被任何机械检查承接。

  ### 机制须回答的问题

  1. 基线登记：宿主基线的权威登记点在哪（现分散于 norm a1b559a6 目标环境、CHANGELOG、package.json peer/dev）且如何一处为权威。
  2. 差分取证：契约面差分的机械取数方式（服务/事件/类型/工具名/槽位闭集 + 条目指纹），及「只比本插件消费面」的收敛口径。
  3. 侵入性判定：差分结果如何机械落到「对插件是破坏 / 静默降级 / 无关」三态，避免每次靠人工通读 40 份 upgrade-guide。
  4. 落地时序：机制停留在「报告」还是可以「阻断」；参照 36 号规范 §11/§12 的 fail-closed 与待处置队列范式。

  ### 边界与未决

  - 本机制的实现须守住 spec 10 §11 与 spec 36 §21 的反过度设计红线：只针对 DSH 一个宿主、不建通用抽象、不为每个场景建独立账本。
  - 未决：「宿主装了什么」的权威取值方式（asar 解析已建成取证脚本但仍有偏移脆弱性，见 pitfall d8d4bc4a）；peer 包 `dsh-client-ui-primitives` 在 0.2.1-rc.2 asar 中缺席而插件仍运行，此事实尚未解释，**不得据此主张任何结论**。
  - 未决：机制落点是 spec 10 新增条款、还是 CLI 侧确定性检查（spec 05 helper-service-contract）由 Human 决定。
serves: SG-3
priority: P1
object_uid: 76ee7b7b-208c-4ed3-bade-6cf85ba307d3
fact_type_key: spark
created_at: 2026-09-12T21:52:17.976Z
change_log:
  - at: 2026-09-12T21:52:17.976Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-09-13T15:08:54.035Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 回填 priority=P1（20 §8 新增字段，Human 裁定 A；AI 出初值，Human 可随时调整）
  - at: 2026-09-26T09:12:45.339Z
    provider: glm
    model: glm-5.3
    summary: refs 回挂编排生态调研（research-25a34e54）：auto-review 转正跟踪与 workflow 消费方式评估的证据基线，当前理解补一段最新摘要
  - at: 2026-10-19T04:56:46.345Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Human 指令 m00496：由「上游 DSH 能力变化的吸收」收紧为「建立上游 DSH 能力变化的吸收与同步机制」，标题/问题/边界/当前理解实质重写并补 2026-10-19 实测取证
refs:
  - object_uid: 25a34e54-fa56-45e7-92a9-85eb222aee97
---

# 建立上游 DSH 能力变化的吸收与同步机制

## 当前理解

本 Spark 已由「上游 DSH 能力变化的吸收」（泛方向跟踪）收紧为「建立上游 DSH 能力变化的吸收与同步机制」（Human 指令 m00496）。原摘要所据的两份 docs 调研（`dsh-current-version-and-market-gap.md` 128 行、`dsh-0.1.2-upgrade-survey.md` 154 行）已随提交 ec19ba6（2026-10-12）整体删除 docs/ 而不可再取，凭据链断裂，故不再作为当前理解的依据。

### 现状核实（2026-10-19 实测）

- 宿主已推进到 **0.2.1-rc.2**（`CFBundleShortVersionString`；asar 内 296 个 dsh* 包全为 0.2.1-rc.2），而 norm `a1b559a6`（本地开发工作流）的「目标环境」仍登记 0.2.0-rc.2（观察时点 2026-09-30）——登记值已被实测推翻。
- 区间 dsh-v0.2.0-rc.2（2026-09-29）→ dsh-v0.2.1-rc.2（2026-10-17）共 1925 commits：契约表服务 91→98（删 1 增 8、改 24）、事件 81→82（改 1）、类型 936→1053（删 9 增 126、改 51）、模型可见工具名 65→68（零删除）、会话事件 type 闭集与 SESSION_FORMAT_VERSION(4) 未变。
- 本插件消费面 12 服务 / 9 事件，逐条比对后**唯一被删除的服务是 `invariants`**（替换为软探测惰性，不构成运行时破坏，但造成安装期 schema 断言静默降级）；所消费的 systemPrompt / webServer / connection 成员均未变（仅新增方法）。
- 已发生过一次真实破坏并由人工吸收：宿主 0.2.1-rc.1 起 `start` / `startContinuable` 移除、`SubagentRun.localAgent` 消失（见 plugin/lib/friction-discovery-provider.js:8-16、plugin/lib/session-signature.js:206-228）。
- specs 全文无「宿主版本追踪 / 契约快照 / 侵入性检查 / 基线核对」条款；spec 10 §8 验证表 10 行全部是「本仓内部一致性」，没有一行比对上游版本差异。
- 现有实现只有**运行时软探测**（plugin/lib/host-seams.js 的 `snapshot()` 对五缝返回 consumed/absent/available/partial，plugin/lib/index.js:373-390 在装载期逐条 logger.info），它探测「宿主缺该能力」，不比对「宿主版本变了」，且派发点 friction-discovery-provider.js:386 直接调用 `subagents.startActivation(...)`、无存在性守卫。
- 现有「版本推进 → CHANGELOG 记一条 + 契约差分数字」是**手工惯例**（plugin/CHANGELOG.md 已有 0.1.7-rc.2 / 0.2.0-rc.1 / 0.2.0-rc.2 三条先例），未被任何机械检查承接。

### 机制须回答的问题

1. 基线登记：宿主基线的权威登记点在哪（现分散于 norm a1b559a6 目标环境、CHANGELOG、package.json peer/dev）且如何一处为权威。
2. 差分取证：契约面差分的机械取数方式（服务/事件/类型/工具名/槽位闭集 + 条目指纹），及「只比本插件消费面」的收敛口径。
3. 侵入性判定：差分结果如何机械落到「对插件是破坏 / 静默降级 / 无关」三态，避免每次靠人工通读 40 份 upgrade-guide。
4. 落地时序：机制停留在「报告」还是可以「阻断」；参照 36 号规范 §11/§12 的 fail-closed 与待处置队列范式。

### 边界与未决

- 本机制的实现须守住 spec 10 §11 与 spec 36 §21 的反过度设计红线：只针对 DSH 一个宿主、不建通用抽象、不为每个场景建独立账本。
- 未决：「宿主装了什么」的权威取值方式（asar 解析已建成取证脚本但仍有偏移脆弱性，见 pitfall d8d4bc4a）；peer 包 `dsh-client-ui-primitives` 在 0.2.1-rc.2 asar 中缺席而插件仍运行，此事实尚未解释，**不得据此主张任何结论**。
- 未决：机制落点是 spec 10 新增条款、还是 CLI 侧确定性检查（spec 05 helper-service-contract）由 Human 决定。

（来源：本地仓 /Users/dmh2002/DshProject/deepseek-harness 的 tag dsh-v0.2.0-rc.2 / dsh-v0.2.1-rc.2；宿主 asar 实测；plugin/lib 实测；普查原条目 B-04）

## 调查问题

上游 DSH 能力变化（版本推进、契约面增删改、破坏性迁移）如何被持续地机械吸收与同步，而不是靠人工事后补？

## 调查边界

宿主基线有唯一权威登记点、契约面差分可取数、差动能机械落到「破坏／降级／无关」三态，且落地时机点被规范写明时停止。
