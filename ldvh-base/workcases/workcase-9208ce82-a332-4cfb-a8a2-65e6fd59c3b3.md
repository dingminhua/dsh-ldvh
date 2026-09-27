---
fact_type_key: workcase
object_uid: 9208ce82-a332-4cfb-a8a2-65e6fd59c3b3
title: goal 路由补 yaml_source 投影
status: closed
gist: 给 GET /api/cognition/goal 补 yaml_source 投影（读取层早已解析出 goal.md frontmatter 原文），使 goal 详情页的 YAML 节点显示原文而不是重建兜底——这是详情页 YAML 呈现推广之后唯一残留的例外。
serves: SG-3
summary: |-
  事实对象详情页底部的 YAML 源节点已推广到全部类型（workcase-63700bd2，已关闭）。唯一例外是 goal：它不走事实对象读取层，而走 GET /api/cognition/goal 独立直读路由，该路由的响应不投影 yaml_source，于是前端落到 reconstructFactYaml 重建兜底——Human 在 goal 详情页看到的是重建 YAML 而非 goal.md 原文。

  ### 现状核实
  读取层的 readGoalRecord 已解析出 frontmatterSource（frontmatter 逐字原文）并在返回值中携带，但 GET /api/cognition/goal 的响应投影只取 goal_key/title/status/statement/sub_goals/created_at/change_log 与读取层元数据，未把 frontmatterSource 投影为 yaml_source。前端 GoalDetail 直接把该记录当 obj 传给共享的 FactReadingContent，而后者底部 YamlDataNode 的「原文优先、重建兜底」分支已就位（ObjectDetail.tsx），故服务端补上投影即可让原文生效。

  ### 边界
  只补投影与必要测试；不改 goal 阅读布局与字段级呈现，不改其它路由与事实对象读取层，不改 specs/25 与 specs/10 文本。
scope: |-
  做什么：
  - 在 GET /api/cognition/goal 的响应投影中补 yaml_source，取自读取层已解析的 frontmatter 原文，逐字透传
  - 同步前端 CognitionGoalData 的类型声明，使 goal 详情页沿用既有「原文优先、重建兜底」分支
  - 补契约测试断言该投影与 goal.md frontmatter 一致，并重建 Web 产物 dist

  明确不做什么：
  - 不改 goal 详情页的阅读布局与字段级呈现
  - 不改事实对象读取层与其它路由的投影语义
  - 不改 specs/25、specs/10 规范文本
plan:
  - step: 核实 goal 路由投影与 frontmatterSource 可得性
    done_criteria: 列出 GET /api/cognition/goal 现有响应字段与读取层可得的 frontmatter 原文位置，机械可查
  - step: 补 yaml_source 投影与前端类型声明
    done_criteria: 该路由响应含 yaml_source 且与 goal.md frontmatter 逐字一致；前端类型同步；契约测试断言该字段的存在与来源
  - step: 回归确认与 dist 重建
    done_criteria: tsc 报错为 0、web 测试全绿、eslint 无新增；dist 重建后 index.html 引用新 hash
gate_1:
  approved_at: 2026-09-27T02:51:43.229Z
  approver: Human
  authorization_fingerprint: ce9f6f9e3d9a0ee54b98061aaca017b6aa8d1ed1ac82f8c611ad029f1e8d7e49
  scope_snapshot: |-
    做什么：
    - 在 GET /api/cognition/goal 的响应投影中补 yaml_source，取自读取层已解析的 frontmatter 原文，逐字透传
    - 同步前端 CognitionGoalData 的类型声明，使 goal 详情页沿用既有「原文优先、重建兜底」分支
    - 补契约测试断言该投影与 goal.md frontmatter 一致，并重建 Web 产物 dist

    明确不做什么：
    - 不改 goal 详情页的阅读布局与字段级呈现
    - 不改事实对象读取层与其它路由的投影语义
    - 不改 specs/25、specs/10 规范文本
reviews:
  - at: 2026-09-27T15:00:53.342Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: a7dd22b9-490b-4b17-a94a-fc9f177dafac
    session_source: host
    implementer_session_id: session-ec7b4135-e2b3-4205-b442-ec1efb4afe05
    implementer_session_source: host
    summary: 对象：WorkCase 9208ce82 交付 d2e9321（goal 详情页投影 yaml_source 原文）。基线：仓库 dsh-ldvh，HEAD=d2e9321，工作树仅未提交 workcase-2be11478；仓库只读，变异限 /tmp 副本。方法：起真实 app 打真实路由、原始字节子串比对、两轮变异、tsc -b 与全量 api 测试、git archive 交付前树对照。覆盖：五条断言均核实——cognition.ts:1230 取 :1145 原文切片且仅 goal 分支；响应 964 字符/1607 字节与 goal.md frontmatter 逐字相等且为原文连续子串（索引 4、仅一次）；删投影或改重建均令契约测试 2/2 失败；tsc -b 退 0。未覆盖：CRLF 归一、frontmatter 内 --- 行、goal.md 缺失与不可读分支、浏览器渲染、多项目载器。发现：全量 374/373/1，唯一红项 workcase-projection-fidelity.test.ts:392 交付前树同样失败，属数据型空转、与本交付无因果；ObjectDetail.tsx 改动仅注释、去注释后代码逐字未变，所称「去掉类型例外分支」不成立；api.ts 类型声明非承载，其正则被既有 :138 行满足空转。保证边界：仅及上述断言与实验，不构成整体判定。
result:
  achieved_scope: goal 详情页的 YAML 源节点改由服务端投影的 frontmatter 原文呈现——GET /api/cognition/goal 新增 `yaml_source`（逐字透传读取层已解析的原文）、前端 CognitionGoalData 类型同步、新增契约测试两条断言、Web 产物 dist 重建。八类事实对象（含 goal 单例）的 YAML 节点由此不再有重建兜底例外。
  criteria_checks:
    - satisfied: true
      evidence: "读取层 readGoalRecord 已解析并携带原文——plugin/web/api/routes/cognition.ts:1121（返回类型 `frontmatterSource: string`）、:1145（`const frontmatterSource = lines.slice(1, endIdx).join('\\n')`）、:1189（随返回值透出）；交付前该响应投影未取此值（d2e9321 前 cognition.ts 该处无 `yaml_source`）。goal.md frontmatter 实测 964 字符 / 1607 字节 / 21 行。"
    - satisfied: true
      evidence: "plugin/web/api/routes/cognition.ts:1230（`yaml_source: record.frontmatterSource,`，仅 goal 投影分支取该值）；plugin/web/src/utils/api.ts:648（`CognitionGoalData` 块内 `yaml_source?: string;`）；plugin/web/tests/api/goal-yaml-source-projection.test.ts 两条断言分别覆盖「字段存在且取自读取层原文」与「与 goal.md frontmatter 逐字一致」，删投影或改走重建即失败（独立复核两轮变异实测）；消费面 plugin/web/src/pages/ObjectDetail.tsx:328-340「原文优先、重建兜底」分支沿用，该文件本次改动实为注释（a29d3de 剥离注释后逐行比对：两侧非空非注释行均 1666）。"
    - satisfied: true
      evidence: tsc -b exit 0；eslint 本交付四文件 0 error / 13 warning（均为 ObjectDetail.tsx 既有 react-refresh 警告，与基线一致）；web 套件在本单结果节落盘后为 374/374（本会话实跑；关闭动作本身对套件的后续影响见残留「关闭动作会抽空四条投影守卫的唯一输入」）；dist 重建后 index.html 由 `assets/index-B54nxY3s.js`（交付前树同命令构建所得）变为 `assets/index-C3IJjsCE.js`，二次重建得同一 hash。
  residual:
    - 关闭动作会抽空四条投影守卫的唯一输入：plugin/web/tests/api/workcase-projection-fidelity.test.ts 的四条空转守卫以「仓内存在 open 对象」为判别力前提——:307（D5「attempt.session_id 在投影后存活」，要求至少一个真实对象的 attempt 带 session_id）、:383（「open 对象的 reviews 必须完整投影」）、:416（「待批准关闭：核对与建议必须投影到位」）、:655（「待批准关闭：正文残留逐条投影」）。全仓 21 个 WorkCase 中只有本单处于 open（16 closed / 4 draft），而 attempt 只在 open 期存在，故 close 收口 attempt、翻转 status 后四条守卫同时失去输入。本会话在隔离副本上按关闭路径的写入效果（status→closed、attempt 收口、outcome 与 result 落字段）模拟后实测 370/374，四红项即上述四条；同一副本仅补本结果节（仍 open）时为 374/374。故本单现状 1 红（:416，因正文缺结果节而 checked 为空）→ 补结果节后 0 红 → 关闭后 4 红。该结果与四条守卫自身的判别力设计有关，不因本单实现改动而生。
    - dist 仅本机机械验证且未纳入版本控制：hash 变化与二次重建一致性可查，但 plugin/web/dist 被 .gitignore 排除，构建来源无法由第三方溯源自本次提交。
    - d2e9321 消息第 2 项过度声明：称「去掉类型例外分支」，实为注释改写；a29d3de 已以更正记录留痕（按 03 §6.1 不追溯改写历史提交）。
    - 前端类型声明非承载：plugin/web/src/utils/api.ts:648 的字段存在，但 GoalDetail 经 `as unknown as Record<string, unknown>` 消费，删该字段 tsc 仍退 0；判别力来自 a29d3de 把它收敛为 CognitionGoalData 块内断言。
    - 独立复核未覆盖范围未由本次补足：CRLF 归一、frontmatter 内含 `---` 行、goal.md 缺失与不可读分支、浏览器端实际渲染、多项目载器均未验证。
outcome: completed
created_at: 2026-09-27T02:47:36.406Z
change_log:
  - at: 2026-09-27T02:47:36.406Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: 受控创建——goal 原文投影：给 /api/cognition/goal 补 yaml_source（承接 workcase-63700bd2 的残留去向「另立工单」）。查重：workcases 现存 13 个对象（11 open / 2 draft）加 4 份终态记录，无 goal 路由投影或 yaml 原文相关范围重叠者
  - at: 2026-09-27T02:51:43.230Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: Gate 1 批准——Human 确认执行，并明确暂不开工（执行待另行发话）；授权绑定当次 plan+scope 指纹 [gate_1 approved by Human; attempt 1 allocated to deepseek-v4.1-flash@dsh-ldvh-session]
  - at: 2026-09-27T15:00:53.342Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录 9208ce82 交付的隔离对抗复核结论（五条断言均成立，两处自曝瑕瘓：d2e9321 消息过度声明、api.ts 断言空转） [review recorded by session a7dd22b9-490b-4b17-a94a-fc9f177dafac; reviews entries: 1; 记录自子代理会话 a7dd22b9-490b-4b17-a94a-fc9f177dafac 的最终产出（Code 捕获）]"
  - at: 2026-09-27T16:57:47.104Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 执行期记录：计划步骤 1–3 的实现与证据补记入正文（此前仅 frontmatter 侧留痕，正文无执行记录），并落盘 Gate 2 提请草稿（结果节：三条判据逐条核对、achieved_scope、5 条残留、5 条去向建议、整单后续方向）；冷恢复经 21 §10.4 副作用范围核对后决定续跑同一 attempt [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T18:34:36.889Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 2 关闭：Human 裁定 9208ce82 判 completed——三条判据逐条核对为达成（原文可得性核实、yaml_source 投影与前端类型同步、回归与 dist 重建），残留 5 项与去向建议 5 条随结果节落盘 [gate_2 closed with outcome=completed; attempt 1 retracted]
---

# goal 路由补 yaml_source 投影

## 摘要

事实对象详情页底部的 YAML 源节点已推广到全部类型（workcase-63700bd2，已关闭）。唯一例外是 goal：它不走事实对象读取层，而走 GET /api/cognition/goal 独立直读路由，该路由的响应不投影 yaml_source，于是前端落到 reconstructFactYaml 重建兜底——Human 在 goal 详情页看到的是重建 YAML 而非 goal.md 原文。

### 现状核实
读取层的 readGoalRecord 已解析出 frontmatterSource（frontmatter 逐字原文）并在返回值中携带，但 GET /api/cognition/goal 的响应投影只取 goal_key/title/status/statement/sub_goals/created_at/change_log 与读取层元数据，未把 frontmatterSource 投影为 yaml_source。前端 GoalDetail 直接把该记录当 obj 传给共享的 FactReadingContent，而后者底部 YamlDataNode 的「原文优先、重建兜底」分支已就位（ObjectDetail.tsx），故服务端补上投影即可让原文生效。

### 边界
只补投影与必要测试；不改 goal 阅读布局与字段级呈现，不改其它路由与事实对象读取层，不改 specs/25 与 specs/10 文本。

## 授权范围

做什么：
- 在 GET /api/cognition/goal 的响应投影中补 yaml_source，取自读取层已解析的 frontmatter 原文，逐字透传
- 同步前端 CognitionGoalData 的类型声明，使 goal 详情页沿用既有「原文优先、重建兜底」分支
- 补契约测试断言该投影与 goal.md frontmatter 一致，并重建 Web 产物 dist

明确不做什么：
- 不改 goal 详情页的阅读布局与字段级呈现
- 不改事实对象读取层与其它路由的投影语义
- 不改 specs/25、specs/10 规范文本

## 计划

- 核实 goal 路由投影与 frontmatterSource 可得性：判据——列出 GET /api/cognition/goal 现有响应字段与读取层可得的 frontmatter 原文位置，机械可查
- 补 yaml_source 投影与前端类型声明：判据——该路由响应含 yaml_source 且与 goal.md frontmatter 逐字一致；前端类型同步；契约测试断言该字段的存在与来源
- 回归确认与 dist 重建：判据——tsc 报错为 0、web 测试全绿、eslint 无新增；dist 重建后 index.html 引用新 hash

## 执行

- attempt 1 started at 2026-09-27T02:51:43.229Z (controller: deepseek-v4.1-flash@dsh-ldvh-session)；Gate 1 授权范围见 gate_1.scope_snapshot。
- 计划步骤 1 完成：GET /api/cognition/goal 的现有响应字段与读取层可得的原文位置已核实——读取层 readGoalRecord 解析并携带 frontmatter 原文（plugin/web/api/routes/cognition.ts:1121 类型声明、:1145 `const frontmatterSource = lines.slice(1, endIdx).join('\n')`、:1189 随返回值透出）；交付前该路由的响应投影不取其值，故作独立直读路由的 goal 落到重建兜底。
- 计划步骤 2 完成：响应投影补 `yaml_source: record.frontmatterSource,`（plugin/web/api/routes/cognition.ts:1230，仅 goal 投影分支取该值）；前端类型同步（plugin/web/src/utils/api.ts:648，`CognitionGoalData` 块内）；新增契约测试 plugin/web/tests/api/goal-yaml-source-projection.test.ts 两条断言（字段存在与来源、与 goal.md frontmatter 逐字一致）。交付提交 d2e9321（四文件，+127/-3）；补充提交 a29d3de 把类型断言收敛到 `CognitionGoalData` 块内——原全文级正则可被 plugin/web/src/utils/api.ts:138 的 `FactObject` 同名字段满足而空转，并在提交正文留更正记录。
- 计划步骤 3 完成：tsc -b 退出 0；eslint 本交付四文件 0 error / 13 warning（均为 ObjectDetail.tsx 的 react-refresh 既有警告，与基线一致）；dist 重建后 index.html 由 `assets/index-B54nxY3s.js`（交付前树同命令构建所得）变为 `assets/index-C3IJjsCE.js`，二次重建得同一 hash。web 套件在本次补记前为 374/373/1——唯一红项即下方残留所述 plugin/web/tests/api/workcase-projection-fidelity.test.ts:416 空转守卫，其判别力输入恰是本结果节；在隔离副本上仅补本结果节（仍 open）后复跑为 374/374。
- 冷恢复核对（非计划步骤事项，2026-09-28 由本会话 session-f5e4f022 执行）：按 21 §10.4 先精确回读本对象全文与 attempt（attempt 1 属 session-ec7b4135，该会话不在场，构成本孤立 attempt），再逐项核对孤立 attempt 对应的实际副作用范围——交付提交 d2e9321 与 a29d3de 均在 HEAD 祖先链上且内容即上述改动；工作树仅两份未提交的 WorkCase 载体（本对象与 workcase-2be11478）；tsc、契约测试、eslint、全量 web 套件与 dist 重建按上述口径逐一复跑，与记录一致。核对发现的缺口是：本对象此前只有 frontmatter 侧的 `reviews` 与 `change_log` 落盘，正文无任何执行记录——属「已发生但未记录」，据实补记于本节。核对后决定续跑同一 attempt（刷新 `heartbeat_at`），不作废重开。

## 结果

### Gate 2 提请

- criteria_checks:
  - 步骤 1 判据「列出 GET /api/cognition/goal 现有响应字段与读取层可得的 frontmatter 原文位置，机械可查」：**达成**。依据：读取层 readGoalRecord 已解析并携带原文——plugin/web/api/routes/cognition.ts:1121（返回类型 `frontmatterSource: string`）、:1145（`const frontmatterSource = lines.slice(1, endIdx).join('\n')`）、:1189（随返回值透出）；交付前该响应投影未取此值（d2e9321 前 cognition.ts 该处无 `yaml_source`）。goal.md frontmatter 实测 964 字符 / 1607 字节 / 21 行。
  - 步骤 2 判据「该路由响应含 yaml_source 且与 goal.md frontmatter 逐字一致；前端类型同步；契约测试断言该字段的存在与来源」：**达成**。依据：plugin/web/api/routes/cognition.ts:1230（`yaml_source: record.frontmatterSource,`，仅 goal 投影分支取该值）；plugin/web/src/utils/api.ts:648（`CognitionGoalData` 块内 `yaml_source?: string;`）；plugin/web/tests/api/goal-yaml-source-projection.test.ts 两条断言分别覆盖「字段存在且取自读取层原文」与「与 goal.md frontmatter 逐字一致」，删投影或改走重建即失败（独立复核两轮变异实测）；消费面 plugin/web/src/pages/ObjectDetail.tsx:328-340「原文优先、重建兜底」分支沿用，该文件本次改动实为注释（a29d3de 剥离注释后逐行比对：两侧非空非注释行均 1666）。
  - 步骤 3 判据「tsc 报错为 0、web 测试全绿、eslint 无新增；dist 重建后 index.html 引用新 hash」：**达成**。依据：tsc -b exit 0；eslint 本交付四文件 0 error / 13 warning（均为 ObjectDetail.tsx 既有 react-refresh 警告，与基线一致）；web 套件在本单结果节落盘后为 374/374（本会话实跑；关闭动作本身对套件的后续影响见残留「关闭动作会抽空四条投影守卫的唯一输入」）；dist 重建后 index.html 由 `assets/index-B54nxY3s.js`（交付前树同命令构建所得）变为 `assets/index-C3IJjsCE.js`，二次重建得同一 hash。
- achieved_scope: goal 详情页的 YAML 源节点改由服务端投影的 frontmatter 原文呈现——GET /api/cognition/goal 新增 `yaml_source`（逐字透传读取层已解析的原文）、前端 CognitionGoalData 类型同步、新增契约测试两条断言、Web 产物 dist 重建。八类事实对象（含 goal 单例）的 YAML 节点由此不再有重建兜底例外。
- residual:
  - **关闭动作会抽空四条投影守卫的唯一输入**：plugin/web/tests/api/workcase-projection-fidelity.test.ts 的四条空转守卫以「仓内存在 open 对象」为判别力前提——:307（D5「attempt.session_id 在投影后存活」，要求至少一个真实对象的 attempt 带 session_id）、:383（「open 对象的 reviews 必须完整投影」）、:416（「待批准关闭：核对与建议必须投影到位」）、:655（「待批准关闭：正文残留逐条投影」）。全仓 21 个 WorkCase 中只有本单处于 open（16 closed / 4 draft），而 attempt 只在 open 期存在，故 close 收口 attempt、翻转 status 后四条守卫同时失去输入。本会话在隔离副本上按关闭路径的写入效果（status→closed、attempt 收口、outcome 与 result 落字段）模拟后实测 370/374，四红项即上述四条；同一副本仅补本结果节（仍 open）时为 374/374。故本单现状 1 红（:416，因正文缺结果节而 checked 为空）→ 补结果节后 0 红 → 关闭后 4 红。该结果与四条守卫自身的判别力设计有关，不因本单实现改动而生。
  - **dist 仅本机机械验证且未纳入版本控制**：hash 变化与二次重建一致性可查，但 plugin/web/dist 被 .gitignore 排除，构建来源无法由第三方溯源自本次提交。
  - **d2e9321 消息第 2 项过度声明**：称「去掉类型例外分支」，实为注释改写；a29d3de 已以更正记录留痕（按 03 §6.1 不追溯改写历史提交）。
  - **前端类型声明非承载**：plugin/web/src/utils/api.ts:648 的字段存在，但 GoalDetail 经 `as unknown as Record<string, unknown>` 消费，删该字段 tsc 仍退 0；判别力来自 a29d3de 把它收敛为 CognitionGoalData 块内断言。
  - **独立复核未覆盖范围未由本次补足**：CRLF 归一、frontmatter 内含 `---` 行、goal.md 缺失与不可读分支、浏览器端实际渲染、多项目载器均未验证。

- 建议 outcome：completed——理由：三条判据的核对结论均为「达成」，按 21 §9.3 `completed` 要求每条 `criteria_checks` 判为达成，本单无支撑 `partial` 的未达成项；上述残留均为去向事项（另立工单或接受现状），不构成本单判据的未达成。

- advice:
  - **另立工单**：把这四条守卫改为以夹具自证（合成输入覆盖 open 期的 attempt、reviews、结果节投影），不再以「仓内是否存在 open 对象」为判别力前提，另留一条轻量 smoke 断言做真实数据核对；否则本仓一旦没有 open 对象，整套用例必红，长期红会训练读者忽略它。出自「关闭动作会抽空四条投影守卫的唯一输入」
  - **接受现状**：继续以「本机重建 + hash 对照」验证 dist，不把产物纳入版本控制。出自「dist 仅本机机械验证且未纳入版本控制」
  - **接受现状**：不追溯改写 d2e9321，以 a29d3de 的更正记录为事实披露。出自「d2e9321 消息第 2 项过度声明」
  - **接受现状**：类型声明保持弱同步，判别力由契约测试承担，不追加类型层门禁。出自「前端类型声明非承载」
  - **接受现状**：上述未覆盖范围留待后续实际使用中发现问题。出自「独立复核未覆盖范围未由本次补足」

- 关闭后的后续方向（整单一条）：本单关闭后「事实对象详情页 YAML 节点呈现」这条线不再有待办——含 goal 在内的八类源节点均走原文优先；后续若要把 YAML 节点纳入字段级治理、或其呈现规则需要变更，须另立对象承接，不因本单关闭而获得批准。

