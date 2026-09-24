---
fact_type_key: workcase
object_uid: 8d2ba256-eff5-4972-a4ae-f6c40b27180b
title: C2 授权校验与 rebatch×reviews 处置
status: open
gist: 补上 C2 授权钉扎在实现层的缺口，并修正 rebatch 对 reviews 与 change_log 的处置，使授权失效可被机械检测。
serves: SG-3
summary: |-
  补上 WorkCase 授权钉扎（C2）在实现层的缺口与 `rebatch` 对 Code 托管字段的处置缺陷，使「授权指纹失效」被机械检测、且重批（rebatch）对 `reviews`/`change_log` 的处置自洽。本单合并三处经对抗审核与起草者亲验确认的既有缺陷（均先于 E4 存在，由 E4 暴露）：缺口 A（C2 授权校验在实现中不存在）：21:281 要求指纹不一致即授权失效，但 `authorization_fingerprint` 在实现中仅被计算（`:923`）与形状校验（`:278`），从无比对；`rebatch` 全文无 fingerprint 校验；后果是 `open --rebatch--> draft --cancel--> closed` 可绕过关闭门禁。

  ### 缺口 B（rebatch 与 reviews 冲突）
  21:176 要求重批保留 `reviews`，而 writer:472 禁止 draft 携带 `reviews`、`rebatch` 结果恰为 draft，二者不可调和；`rebatch` 从未提及 `reviews`，而 writer 注释 `:469` 却写「重批回退时保留」——注释与代码矛盾，属实现漏做。

  ### 缺口 C（rebatch 的 change_log 可被调用方注入）
  `rebatch` 取 `structuredClone(stripCallerOnlyFields(frontmatterAfter))` 的 `change_log`，未比照 `execute`/`revise` 锁定为 `fm.change_log`；起草者实测传入伪造条目即清空对象全部审计历史，违反 21 §8 / 03 §9.5 的权威流水纪律。
scope: 做什么：(A) 在实现层补上 21:281 要求的 C2 校验——校验 `gate_1.authorization_fingerprint` 与当前 `plan`+`scope` 不一致时按规范处置（授权失效并生成局部重批待办），覆盖 `rebatch` 与 `approve` 等适用路径；(B) 使 `rebatch` 对 `reviews` 的处置显式且自洽——采第三方向：`rebatch` 显式作废 `reviews` 并把其要点写入 `change_log`（与 §9.2 对 `criteria_checks` 的既有处置同形），同时把 `21:176` 的「保留原值」改为「保留其历史要点于 `change_log`」；(C) 补相应行为测试（不用正则断源码）；(D) **锁定 `rebatch` 的 Code 托管字段**——`rebatch` 现取调用方 payload 的 `change_log`（实测可注入伪造条目并清空全部审计历史），须比照 `execute`/`revise` 显式锁定为 `fm.change_log`，使调用方无法改写审计流水。明确不做什么：不改 E4 门禁本身（已实施并生效）；不新增任何字段；不改 `plan`/`scope` 形状（不触发 C2）；不改 02/03/06 号规范；不处理 §6.4.3（独立性，已判定为审核误报）；不处理存量 `open` 工单的复核补录（属另一议题）。
plan:
  - step: 核实 C2 缺口的确切范围与适用路径
    done_criteria: 列出全部 7 个 action 中哪些涉及 authorization_fingerprint 比对，以及 21:281 要求比对而实现未比对的确切位置，文件:行号可查
  - step: 补 C2 校验并处置授权失效路径
    done_criteria: 存在可机械判定的校验（重批时新指纹必须不等于 gate_1 存储指纹，否则拒绝）；open --rebatch--> draft --cancel--> closed 的绕过路径被测例覆盖并阻断
  - step: 消解 rebatch 与 Code 托管字段的冲突（reviews 处置 + change_log 锁定）
    done_criteria: rebatch 对 reviews 的处置显式（作废 + 要点入 change_log），21:176 文本与实现一致；rebatch 显式锁定 change_log 为 fm.change_log，调用方注入的伪造条目被丢弃；两者均有行为测试断言
  - step: 验证三件套与受控提交
    done_criteria: writer 测试全绿、web 测试全绿、tsc 0 错误、eslint 无新增；受控提交且 Git Gate passed
gate_1:
  approved_at: 2026-09-17T08:00:20.335Z
  approver: Human
  authorization_fingerprint: 7041fb33427d604cd66915c9f421b1ef0762f2b7a542ddde538c4a45cc297929
  scope_snapshot: 做什么：(A) 在实现层补上 21:281 要求的 C2 校验——校验 `gate_1.authorization_fingerprint` 与当前 `plan`+`scope` 不一致时按规范处置（授权失效并生成局部重批待办），覆盖 `rebatch` 与 `approve` 等适用路径；(B) 使 `rebatch` 对 `reviews` 的处置显式且自洽——采第三方向：`rebatch` 显式作废 `reviews` 并把其要点写入 `change_log`（与 §9.2 对 `criteria_checks` 的既有处置同形），同时把 `21:176` 的「保留原值」改为「保留其历史要点于 `change_log`」；(C) 补相应行为测试（不用正则断源码）；(D) **锁定 `rebatch` 的 Code 托管字段**——`rebatch` 现取调用方 payload 的 `change_log`（实测可注入伪造条目并清空全部审计历史），须比照 `execute`/`revise` 显式锁定为 `fm.change_log`，使调用方无法改写审计流水。明确不做什么：不改 E4 门禁本身（已实施并生效）；不新增任何字段；不改 `plan`/`scope` 形状（不触发 C2）；不改 02/03/06 号规范；不处理 §6.4.3（独立性，已判定为审核误报）；不处理存量 `open` 工单的复核补录（属另一议题）。
attempt:
  attempt_id: 2
  started_at: 2026-09-17T08:00:20.335Z
  controller: deepseek-v4.1-flash@dsh-ldvh-session
  heartbeat_at: 2026-09-24T02:48:24.820Z
reviews:
  - at: 2026-09-22T14:50:15.622Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 对象：workcase-8d2ba256（open，待 Gate 2）。基线：HEAD a56857f，工作树仅 6 项无关未跟踪文件。方法：行锚定读对象全文、读 writer 源码、实跑测试、/tmp 副本负向控制。覆盖：缺口 B/C 实现、缺口 A 回退、21 §9.2/§14/§15.1 文本、change_log 截断、37/37、eslint 0、另立单可追溯性。未覆盖：web 测试与 tsc（并发会话中间态）、25 §11 信号。发现：B/C 修复属实且负向控制判别力成立；A 回退属实；截断属实；§9.2 已同步、§14:286 未同步；新增——结果节 criteria_checks 为散文形态（在正文节，非 frontmatter result 字段），Gate 2 提请时须转为 {satisfied, evidence} 对象；对象亦无 reviews。保证边界：仅核实上述范围。
created_at: 2026-09-17T06:51:23.939Z
change_log:
  - at: 2026-09-17T07:59:50.891Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: C2 局部重批：扩围纳入缺口 C（rebatch 的 change_log 可被调用方注入，实测可清空审计历史）——起草者在步骤 1 核实中实测发现该漏洞，经 Human 批准纳入；scope 增列 (D) 锁定 Code 托管字段，摘要与计划同步更新为三处缺口 [C2 局部重批 open→draft; attempt 1 voided, gate_1 dropped — 重新组织后重走 Gate 1]
  - at: 2026-09-17T08:00:20.335Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 1 重新批准（C2 局部重批后）——Human 确认扩围纳入缺口 C（rebatch 的 change_log 可被调用方注入）；授权指纹重新绑定扩围后的 plan+scope，范围增至三处缺口 [gate_1 approved by Human; attempt 2 allocated to deepseek-v4.1-flash@dsh-ldvh-session]
  - at: 2026-09-17T09:14:02.449Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 执行期记录：缺口 B/C 已修复（含修改前后对照与负向控制验证）；缺口 A 的判据经复核判定不成立并已回退，连同 cancel 侧门禁缺失另立一单；如实登记本对象 change_log 曾在缺口 C 修复前被截断（起草者过失） [attempt 2 heartbeat refreshed]
  - at: 2026-09-18T02:03:34.410Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 落档独立结果复核概要（reviews）：缺口 B/C 修复经源码实读与负向控制核实属实、缺口 A 回退与 change_log 截断均属实；补记 §14:286 未同步、criteria_checks 正文形态需在 Gate 2 提请前转为 result 字段对象、以及另立单对象号 4005b67b/81c37ef0 的可追溯登记 [attempt 2 heartbeat refreshed]
  - at: 2026-09-18T11:21:15.383Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 迁移：补齐 gist 要点字段（21 §8，WorkCase d5273e1c） [attempt 2 heartbeat refreshed]
  - at: 2026-09-22T14:50:15.622Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "格式治理：摘要分块（忠实重排）——把作者自撰的行内「：」提为 ### 块首并插入空行，使摘要可读且符合 21 §8 书写结构（H3 骨架）；作者原文逐字未改，仅新增标记与空行 [attempt 2 heartbeat refreshed]"
  - at: 2026-09-23T19:05:35.697Z
    provider: deepseek-official
    model: deepseek-flash
    summary: 结果节新增 `- advice:` 建议段，并按 21 §8 把原先写在 residual 条目内的「建议…」子句移入该段（建议只有一处正文承载） [attempt 2 heartbeat refreshed]
  - at: 2026-09-24T02:48:24.820Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 格式治理：建议去向词按 21 §8 新闭集四词归一（更正/改进/补录 → 直接行动），措辞与语义未变 [attempt 2 heartbeat refreshed]
---

# C2 授权校验与 rebatch×reviews 处置

## 摘要

补上 WorkCase 授权钉扎（C2）在实现层的缺口与 `rebatch` 对 Code 托管字段的处置缺陷，使「授权指纹失效」被机械检测、且重批（rebatch）对 `reviews`/`change_log` 的处置自洽。本单合并三处经对抗审核与起草者亲验确认的既有缺陷（均先于 E4 存在，由 E4 暴露）：缺口 A（C2 授权校验在实现中不存在）：21:281 要求指纹不一致即授权失效，但 `authorization_fingerprint` 在实现中仅被计算（`:923`）与形状校验（`:278`），从无比对；`rebatch` 全文无 fingerprint 校验；后果是 `open --rebatch--> draft --cancel--> closed` 可绕过关闭门禁。

### 缺口 B（rebatch 与 reviews 冲突）
21:176 要求重批保留 `reviews`，而 writer:472 禁止 draft 携带 `reviews`、`rebatch` 结果恰为 draft，二者不可调和；`rebatch` 从未提及 `reviews`，而 writer 注释 `:469` 却写「重批回退时保留」——注释与代码矛盾，属实现漏做。

### 缺口 C（rebatch 的 change_log 可被调用方注入）
`rebatch` 取 `structuredClone(stripCallerOnlyFields(frontmatterAfter))` 的 `change_log`，未比照 `execute`/`revise` 锁定为 `fm.change_log`；起草者实测传入伪造条目即清空对象全部审计历史，违反 21 §8 / 03 §9.5 的权威流水纪律。

## 授权范围

做什么：(A) 在实现层补上 21:281 要求的 C2 校验——校验 `gate_1.authorization_fingerprint` 与当前 `plan`+`scope` 不一致时按规范处置（授权失效并生成局部重批待办），覆盖 `rebatch` 与 `approve` 等适用路径；(B) 使 `rebatch` 对 `reviews` 的处置显式且自洽——采第三方向：`rebatch` 显式作废 `reviews` 并把其要点写入 `change_log`（与 §9.2 对 `criteria_checks` 的既有处置同形），同时把 `21:176` 的「保留原值」改为「保留其历史要点于 `change_log`」；(C) 补相应行为测试（不用正则断源码）；(D) **锁定 `rebatch` 的 Code 托管字段**——`rebatch` 现取调用方 payload 的 `change_log`（实测可注入伪造条目并清空全部审计历史），须比照 `execute`/`revise` 显式锁定为 `fm.change_log`，使调用方无法改写审计流水。明确不做什么：不改 E4 门禁本身（已实施并生效）；不新增任何字段；不改 `plan`/`scope` 形状（不触发 C2）；不改 02/03/06 号规范；不处理 §6.4.3（独立性，已判定为审核误报）；不处理存量 `open` 工单的复核补录（属另一议题）。

## 计划

- 核实 C2 缺口的确切范围与适用路径：判据——列出全部 7 个 action 中哪些涉及 authorization_fingerprint 比对，以及 21:281 要求比对而实现未比对的确切位置，文件:行号可查
- 补 C2 校验并处置授权失效路径：判据——存在可机械判定的校验（重批时新指纹必须不等于 gate_1 存储指纹，否则拒绝）；open --rebatch--> draft --cancel--> closed 的绕过路径被测例覆盖并阻断
- 消解 rebatch 与 Code 托管字段的冲突（reviews 处置 + change_log 锁定）：判据——rebatch 对 reviews 的处置显式（作废 + 要点入 change_log），21:176 文本与实现一致；rebatch 显式锁定 change_log 为 fm.change_log，调用方注入的伪造条目被丢弃；两者均有行为测试断言
- 验证三件套与受控提交：判据——writer 测试全绿、web 测试全绿、tsc 0 错误、eslint 无新增；受控提交且 Git Gate passed

## 执行

- 步骤 1 完成：C2 缺口已核实——`authorization_fingerprint` 在实现中**仅被计算**（`approve` 时）与**形状校验**（64-hex），**从无任何代码将其与当前 `plan`+`scope` 比对**。全部 7 个 action 的 status 前置与终态亦已穷举：**恰好 `close` 与 `cancel` 两条可达 `closed`，而只有 `close` 受 E4 门禁**。
- 步骤 1 期间**发现缺口 C**（超出原 scope）：`rebatch` 取调用方 payload 的 `change_log`，实测传入伪造条目即**清空对象全部审计历史**。经 Human 批准，以 **C2 局部重批**合法扩围（`open → draft → 重走 Gate 1`），scope 增列 (D)。
- 步骤 2（**后经复核判定不成立并已回退**）：曾实现「重批时提交的 `plan`+`scope` 指纹必须不等于 `gate_1` 存储指纹」的判据。独立复核与起草者自查共同认定该判据**不成立**——21 §10.3 的第三种法定失效情形（`serves` 指向的 sub-goal 被修订）**不改变 `plan`+`scope` 指纹**，故该判据会**误拒合法重批**；且其判据为字节级相等，**改一个空格即可绕过**，未能真正阻断。**已回退**；缺口 A 与「`cancel` 侧无 `reviews` 门禁」合并另立一单。
- 步骤 3 完成：`rebatch` 现显式锁定 `change_log` 为 `fm.change_log`（**改动前**：注入伪造条目即替换全部历史；**改动后**：伪造条目被丢弃、真实历史保留并追加）；`rebatch` 现显式 `delete next.reviews` 并将作废要点记入 `change_log`（**改动前**：携带 `reviews` 的重批被 writer 拒绝、对象卡在 `open`；**改动后**：通过且 `draft` 不含 `reviews`）。
- 步骤 4 完成：writer 测试 **37/37**、eslint 0；受控提交 `6ac30ec`（初版）与本次修订提交。
- 2026-09-18 独立结果复核落盘（reviews）：缺口 B/C 的修复经源码实读 + 实跑测试 + /tmp 副本负向控制核实属实，判别力成立；缺口 A 回退属实；`change_log` 截断属实（创建条目与首次 Gate 1 批准条目确已消失，成因与自述一致）。复核另确认 §9.2 已同步而 §14:286 仍未同步，且结果节的 `criteria_checks` 为正文散文形态（非 `result` 字段）——Gate 2 提请时须转为 `{satisfied, evidence}` 对象。

## 结果

### Gate 2 提请

- criteria_checks:
  - 步骤 1 判据「列出 7 个 action 中哪些涉及 `authorization_fingerprint` 比对，以及未比对的确切位置，文件:行号可查」：**达成**。`authorization_fingerprint` 的全部出现均为形状与闭集校验（`validateGate1`）及 `approve` 时的计算盖戳——**无比对**；7 个 action 的终态经穷举确认恰好 `close`/`cancel` 可达 `closed`。证据见「## 执行」第 1 条。
  - 步骤 2 判据「存在可机械判定的校验；绕过路径被测例覆盖并阻断」：**未达成**。所实现的判据经独立复核与起草者自查共同判定不成立（误拒 §10.3 情形 ③ 的合法重批；且字节级判据可被一个空格绕过），**已回退**。该缺口与 `cancel` 侧缺失合并另立一单。
  - 步骤 3 判据「`rebatch` 的 reviews 处置显式、21:176 文本与实现一致；`change_log` 被锁定、注入的伪造条目被丢弃；两者均有行为测试断言」：**达成**。有修改前/后的对照证据（见「## 执行」步骤 3）；`specs/21-WorkCase-工单.md` §9.2 已同步修订；新增 3 条行为断言并有负向控制验证判别力（移除实现即失败）。
  - 步骤 4 判据「writer 测试全绿、web 测试全绿、tsc 0 错误、eslint 无新增；受控提交且 Git Gate passed」：**部分达成**。writer 测试 37/37 全绿、eslint 0、受控提交与 Git Gate 均通过；**web 测试与 tsc 未能在本单验证**——因并发的另一会话正在修改 11 个 `plugin/web` 文件（未提交，处于中间态），其错误与本单改动无关（本单未触碰 `plugin/web`，且 web 测试不引用 writer）。
- achieved_scope: 缺口 B（`rebatch` 与 `reviews` 的规范-实现冲突）与缺口 C（`rebatch` 的 `change_log` 可被注入）**已修复并有修改前后对照证据**，两者的行为测试均经负向控制验证具备判别力。缺口 A（C2 授权校验）**经核实真实存在，但本轮所实现的判据不成立、已回退，未达成**。
- residual:
  - **缺口 A 未修复，且已确认其在现有实现下不可机械判定**：21 §10.3 的第三种失效情形（`serves` 指向的 sub-goal 被修订）**不改变 `plan`+`scope` 指纹**，故无法以指纹比对区分「滥用重批」与「合法重批」；该区分依赖 25 §11 的 `goal-changed 待核对` 标记，而**该标记在实现中不存在**。
  - **`cancel`（draft→closed）不校验 `reviews`**，与 21:169「`closed` ⇒ `reviews` 必填」冲突；故「先 `rebatch` 回 `draft` 再 `cancel`」仍可绕开 §14 的关闭前置。**该冲突先于本单存在**。
  - **本对象自身的 `change_log` 曾被截断（起草者过失，如实登记）**：为合法扩围，起草者在**缺口 C 尚未修复时**运行了 `rebatch`；当时的 `rebatch` 取调用方 payload 的 `change_log`，起草者未传，故「受控创建」与「首次 Gate 1 批准」两条历史条目被整体替换（提交 `4753420` 版本含创建条目，其后版本不含）。按 03 §6.1「不追溯改写」，这两条**不予补回**；此处如实登记该事实与成因，不掩盖。这同时构成缺口 C 的**真实活体演示**——修复前该缺陷可被**无意**触发，不限于恶意注入。
  - 步骤 4 的 web 测试与 tsc 因并发会话的未提交改动无法在本单验证（本单未触碰 `plugin/web`）。
  - `gate_1` 缺失时 C2 校验 fail-open（带内不可达——`approve` 必盖章、`execute` 锁定 `gate_1`）。
  - 独立复核另指出 `specs/21-WorkCase-工单.md` §14 的局部重批条目未同步 `reviews` 处置（§9.2 与 §15.1 已修订），§14 条目待随另立单一并收口。
  - 独立复核补充项（2026-09-18）：本结果节的 `criteria_checks` 现为**正文散文形态**，而 21 §8 的 `result` 字段要求 `criteria_checks` 每项为 `{satisfied: boolean, evidence: 非空字符串}` 且长度与 `plan` 一致——Gate 2 提请时须据此转写为对象形态（本项为提请前的转写要求，非对象缺陷）。另：本对象在复核时仍无 `reviews`，该记录由本次写入补足。

- advice:
  - **另立工单**：另立一单，其前置为「先实现 25 §11 的级联信号」。出自「缺口 A 未修复，且已确认其在现有实现下不可机械判定」
  - **另立工单**：与缺口 A 合并另立一单——「阻断绕过」的真正落点在关闭侧而非重批侧。出自「cancel（draft→closed）不校验 reviews」
  - **直接行动**：把 gate_1 缺失时的 C2 校验由 fail-open 改为 fail-closed。出自「gate_1 缺失时 C2 校验 fail-open」
  - **直接行动**：后续清理时把「缺口 A 与 cancel 侧」的另立单对象号（4005b67b）与「§14 同步」的另立单对象号（81c37ef0）一并登记，便于追溯。出自「独立复核补充项（2026-09-18）」

