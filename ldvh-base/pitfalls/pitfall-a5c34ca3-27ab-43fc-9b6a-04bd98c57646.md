---
title: 补充边界判据绑 active 致同态更新漏检
status: active
scope: 适用于按条文为受控写入实现机械边界的场合——特别是把「补充级更新」的约束入口从条文的「更新时」写成状态值判断（仅 active→active）时，非 active 的同态更新通道（draft→draft、discarded→discarded）会整体落在检查范围之外且不留机械信号；不适用于跨状态转换（draft→active、active→discarded、draft→discarded），它们不属补充更新，由各自的检查项承担。
object_uid: a5c34ca3-27ab-43fc-9b6a-04bd98c57646
fact_type_key: pitfall
created_at: 2026-11-03T09:25:13.575Z
change_log:
  - at: 2026-11-03T09:25:13.575Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累·审核段据缓冲条目 96aec25d-389d-4d38-bcba-5127abbceb3e 形成候选（11 §10.2 第 3 项）
  - at: 2026-11-03T12:40:00.000Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 状态闭集收缩迁移：2026-11-03 Human 决定取消 Pitfall 的 `draft` 待确认态（23 §9），本对象作为存量 draft 载体迁为 active；其所述缺陷已由提交 1a3b4b5 修复，正文所述三条同态用例中 draft→draft 两条随该档取消一并移除
  - at: 2026-11-10T11:35:51.301Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
recall_digest: 补充边界判据 绑active 同态更新漏检 draft到draft 补充级更新 scope整体换掉 受控写入通过 判据未覆盖同态
---

# 补充边界判据绑 active 致同态更新漏检

## 症状

一条候选在等待入档期间，以 `draft→draft` 的补充级更新把 `scope` 的适用条件整体换掉（由「首次运行失败且耗时在毫秒级」换成「报错为未定义标识符」），受控写入通道既没有拒绝、也没有任何机械信号，该更新照常获得一条 `change_log` 并继续进入独立复现核对与入档流程；入档时被复现核对的是换之前的适用范围，而实际生效的适用边界是换之后的。本史实已在受影响对象自带留存：`ldvh-base/pitfalls/pitfall-fd1b7031-be9f-40f6-9e89-977d927e92f6.md` 的「入档声明（2026-11-03）」明写 scope 在 draft 期被实质替换、按 23 §9.3 本应走新对象，而当时通道未拦截。

逐字引证：

```
适用条件整个换了，走的是 `draft→draft`，没有任何拦截
来源：本次观察材料 turn 3 助手回复（主控会话）；对应事实源为提交 c1c63f8 中 pitfall-fd1b7031 的 scope 变更，以及 plugin/lib/pitfall-writer.js:573 的条件判断。
```

识别信号：`updatePitfallObject` 的补充边界条件是「状态未变」与「状态为 active」的合取，而不是「状态未变」；工具面说明文字也只写「active→active」。代码与说明互相印证，使一条本应受约束的更新路径看起来从未被纳入约束。

## 触发条件

- 规范侧的作用域是「更新时」（specs/23 §9.3、§14.1「补充边界」行、§15「补充边界」行的成立条件「scope 与 CAS 基线逐字段一致」），约束对象是全部更新；
- 实现侧把约束写成 `nextStatus === prevStatus && nextStatus === "active"`，作用域被收窄到三个同态通道中的一个；
- 于是 `draft→draft`、`discarded→discarded` 两条同态通道的 scope 比对整条不执行，而 `draft→active` 等转换也不执行——但后者本来就由 §13 的转换检查项承担，属有意排除；前者才是被无声吞掉的。

组合条件：条文的作用域（更新）与实现的作用域（active 同态更新）不相等，且两者之间没有机械对齐约束。只要这条缝存在，任何一次 draft 期或终态期的 scope 改写都不会留下信号；而 draft 期恰好是候选形态尚未定稿、Human 还看不到最终文本的时点，终态期则是「不得靠伪造一次状态转换洗白」所依赖的时点。

## 根因

判据被绑在一个**状态值**上，而不是绑在**定义该类更新的性质**上。补充级更新的定义性质是「状态未变」（§9.3：勘误与补充级，含 draft→draft 与终态勘误）；实现却用「状态是不是 active」来表达它，于是「这次更新要不要比对 scope」由当前状态值决定，而不是由「这次更新是不是同态更新」决定。合取式让后半段成了隐式白名单：只有 active 这一条通道被枚举进来，其余同态通道默认放行。

同批材料第 4 轮把同一判据写得更直白，作为本段旁证：

```
把两个条件串成与，`draft→draft` 天然不满足后半段，整条路径没被检查
来源：本次材料 turn 4 的 assistant 回复正文（说明改动内容的「## 改了什么」段）
```

这条缝之所以无信号，是因为规范侧写「更新时」、实现侧写 `active`、工具说明又照抄实现侧措辞：三处文本各自成立、互相印证，于是「检查范围比条文窄」既不会被结构解析发现，也不会被读说明文字的人发现，只能由对照条文原文与实现条件的独立审核发现。

与既有对象的分工（23 §6.2）：`6a2059d8` 记的是「契约的同语义要求只落成一个字面量、其余字段无任何判据」，其判据是按当前代码里可机械匹配的字面量逐条枚举出来的——漏的是同语义的其它字段维度；本条是判据的**触发条件**被一个状态值替换了「状态未变」这一性质判断，漏的是**一整类更新通道**，两者根因不同、分别承载。`ef04d0a1` 记的是拒绝断言粗粒度化导致检测力为零（测试侧取值域问题），`86f03312` 记的是字段改名后读写两侧未同步，`b011ff88` 记的是相位闭集缺 complete 且错误被两层吞掉——均非本机制。`96fb3199`（已废止）记的是判定单位由集合降级为单点（首行比较漏掉多余 H1），本条不是判定单位问题，而是判定入口的适用条件被写窄。

## 解决

提交 `1a3b4b5`（2026-11-03，「补充边界扩到全部同态更新，堵住 draft→draft 的 scope 漂移」）：

- `plugin/lib/pitfall-writer.js` 的 `if (nextStatus === prevStatus && nextStatus === "active")` 改为 `if (nextStatus === prevStatus)`，拒绝信息带出实际通道（`scope changed on a same-status update (${prevStatus}→${nextStatus})`，错误码 `pitfall/supplement_boundary`）；
- 同文件与 `plugin/lib/pitfall-tools.js` 的说明文字由「active→active」同步为「同态更新（draft→draft、active→active、discarded→discarded errata）」；
- `plugin/test/pitfall-writer.test.mjs` 新增三条用例：draft→draft 改 scope 被拒且**零写入**（拒绝后仍比对指纹与 scope 均未变）、draft→draft 仅改正文放行（防过度拦截）、discarded→discarded 勘误改 scope 被拒。

成功信号：三条同态通道现在都返回 `pitfall/supplement_boundary`；把判据注入回 `active` 后，其中两条新用例转红、其余仍绿，说明用例确实测到这处判据而非邻近行为。

必要边界：修正只覆盖 scope 的机械比对。§9.3 明写「机械比对只覆盖 scope，其余段的语义不变性（补充与实质变更的分界）是 AI 审核义务」，因此根因、解决、规避三段的实质更换仍只能由读原文的审核拦下，本修正不改变这一点。

## 规避

- 写机械边界时，从条文里取**判定入口条件**，不要从实现里的状态值里取：条文写「更新时」，入口就该是「状态未变」，并把全部同态通道显式列出（draft→draft、active→active、discarded→discarded）。
- 把工具面说明文字当成判据的同一载体：说明与条件写在一起时，须按条文原词再核对一次。「实现与说明自洽」不等于「与条文对齐」——本条的三处文本正是同步错到同一个窄口径上。
- 对合取式守卫做一次反例枚举：为合取的每一段给出使其为假的反例输入，检查哪些真实路径被整体跳过；只要有一条合法路径不满足合取、而条文要求它受约束，即为漏检。
- 影响范围实质变化不是补充：改 scope 应走新对象（§9.3），机械层必须拒绝而不是放行；若某 writer（friction/ADR 等）的说明仍写「仅 active→active」，说明该处尚未核对，不得据本条认为已覆盖。

## 验证

已观察：`node --test plugin/test/pitfall-writer.test.mjs` 43 项全通过（2026-11-03 复核，含上述三条新增同态用例）；`1a3b4b5` 记录注入验证——把判据改回 `active` 后两条新用例转红、其余仍绿；实例链有据可查：提交 `c1c63f8` 把该对象 scope 由「失败耗时在毫秒级」改为「报错为未定义标识符」，同一条 `change_log` 记明「据此收紧 scope」，随后 `8efec03`（2026-11-03）经 Human 决定以改后 scope 入档，入档声明明记 scope 曾在 draft 期被实质替换并回指本缺口。

未覆盖：没有回放历史受控更新记录去统计同类漏检的实际次数（本条只有 `pitfall-fd1b7031` 一例可核）；`draft→active` 等状态转换的检查项未纳入本次核对；其他 writer 各自的补充边界未逐一核对是否也有同类写法；AI 审核侧对「其余段语义不变」的分界仍无机械承载；scope 之外的字段（title、body）在同态更新中的实质变更同样没有机械判据。

## 影响与适用范围

适用于按条文为受控写入实现机械边界的场合——特别是把「补充级更新」的约束入口从条文的「更新时」写成状态值判断（仅 active→active）时，非 active 的同态更新通道（draft→draft、discarded→discarded）会整体落在检查范围之外且不留机械信号；不适用于跨状态转换（draft→active、active→discarded、draft→discarded），它们不属补充更新，由各自的检查项承担。

**何时可能踩到**：任何为「更新」类条文实现机械判据时，尤其当状态机存在多个同态通道、或判据以合取式表达、或工具说明文字与判据一同维护时；本仓已验证实例为 `plugin/lib/pitfall-writer.js` 的补充边界（修正前 573 行附近）。

**经验何时可信**：当且仅当该 writer 的判据已改为「状态未变」、且三个同态通道各有针对性用例并能通过注入变异转红时，可直接据此核对；若某载体的说明文字仍写「仅 active→active」，则该处的经验不可套用，须重走本条的核对动作。
