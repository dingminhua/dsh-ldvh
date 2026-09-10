# 05／Web 接入面 outcome 漂移修复候选（3.4）

> 依据：`docs/action-plan-2026-09-10.md` 阶段 3 步 3.4（新立项）。
> 门：涉及规范文本（05 §5.3 待登记项撤销、§8 闭集）＋实现改动 → **规范与实现必须分两笔提交**；规范走 01 §11/§12 独立审核＋Human 决定；实现走 09 测试纪律。

---

## 0. 修订记录：方向已由独立审核推翻（v1 → v2）

**v1（初稿）**主张在 05 §8 闭集**补入 `completed`**，以消解「实现发出 26 处 `completed` 而闭集不含」的漂移。

**v2（本稿）推翻 v1 的这一主张。** 独立对抗审核（`d7de2eff`）实证发现：**26 处 `completed` 中至少 4 处直接违反 v1 自己新写的释义**（发出 `completed` 的同时携带非空 `not_completed` 与 `gaps`）。故补闭集不是「补一个缺失的合法值」，而是**把误用洗白为合法**。

同时，补闭集触犯三条上位约束：

- **09 §3.3**：Code 不得反向创造规则；
- **01 §11.4**：不得因实现方便而反向改变规范语义；
- **00 §3.4**：技术不反向定义规范，机械保障只执行规范已定义内容。

「实现里有 26 处」是**实现现状**，不构成扩闭集的规范理由。**正确方向：先修实现使其真正对齐现有闭集；`completed` 是否应成为独立取值，作为**独立规范议题**另行立项，不在 3.4 内夹带。**

---

## 1. 计划记载的问题

行动计划 3.4 原文：

> `plugin/web/api/services/governanceScope.ts:209` 按 `outcome === "ok"` 判定，而 05 §8 闭集为 partial／unavailable／rejected／invalid_request／执行错误；同文件 `:176` 调用的 `ldvh` 可执行文件在仓库根部不存在。

## 2. 核实的完整事实（比计划记载更大）

### 2.1 `ok` 确实不存在于实现全域

对 `plugin/lib/*.js` 全部 `envelope(...)` 调用的 outcome 实参做枚举：

| 实际取值 | 出现次数 | 是否在 05 现闭集 |
|---|---|---|
| `completed` | 26 | **否** |
| `unavailable` | 25 | 是 |
| `partial` | 10 | 是 |
| `invalid_request` | 7 | 是 |
| `execution_error` | 7 | 是（文本作「执行错误」） |
| `rejected` | 6 | 是 |

**`ok` 出现 0 次。** `completed` 出现 26 次，但 05 闭集**不含 `completed`**。

### 2.2 因此漂移是两段，不是一段

| 位置 | 现状 | 与 05 §8 的关系 |
|---|---|---|
| 实现全域（26 处） | 发出 `outcome: "completed"` | 闭集**缺** `completed` |
| `governanceScope.ts:208` | 判定 `outcome !== 'ok'` | 判定值**不存在于任何实现** |
| `governanceScope.ts:340` | 判定 `outcome !== 'ok'` | 同上 |

行动计划只记了 `:209` 一处；实为**两处判定 ＋ 闭集本身缺一个真实主力取值**。

### 2.2.1 `ok` 的来源已查明（v4 遗留，非新引入）

`git log -S "outcome !== 'ok'" -- plugin/web/api/services/governanceScope.ts` 命中共 **一笔** 提交：

```
6bf5e4f  feat: v4 Web 整体平移至 plugin/web——全部管辖计划第 1 步（纯迁移）
         2026-09-06 20:12  （183 文件 38485 行，src/api/shared 与 v4 归档逐字节一致）
```

结论：`'ok'` **不是本次重写引入的新漂移**，而是 **v4 时代的取值随整体平移原样带入 v5**，此后从未与新契约对齐。该笔提交自述为「纯迁移、设计语言零变动」，故当时未适配 v5 属**预期行为**——漂移是在 v5 契约（05 §8）定型后才成为漂移的。

**对本候选的意义**：确认这是**迁移期遗留的对齐欠账**，而非有人在 v5 之下新写错值。修复属「补齐欠账」，符合行动计划总原则（不回指上位新决定，只消除既有不一致）。

### 2.3 `:172` Helper 路径的可达性（含 v1 表述修正）

`governanceScope.ts:89` 的 `v5CarrierPath()` 读 `LDVH_GOVERNED_PROJECTS_CONFIG`；`plugin/lib/index.js:64` 在 Web API 子进程环境中设置该变量：

```js
env.LDVH_GOVERNED_PROJECTS_CONFIG = dshHomePath("ldvh", "governed-projects.yaml");
```

**但该设置位于 `try/catch` 内（`index.js:66-70`）**：DSH 用户配置根不可用时**不设置**该变量，此时 `v5CarrierPath()` 返回 null，`invokeGovernanceScope()` **是活路径**。

> **v1 表述修正**：本稿初版写作「恒设置…总是…从不…不可达」，该表述**过强**，已由独立审核（主张 5 核验）与本稿自查共同更正。准确表述为：**在 v5 登记模式可用的部署中**该 v4 Helper 路径不执行；**配置根不可用时它是唯一路径**。

同时，`resolveV5CarrierScope()` 直接 `readFile` ＋ `yaml.load` 解析登记载体，**完全不产生 `outcome` 字段**——这是本步的关键：v5 路径根本不参与 outcome 契约，故 `:208` / `:340` 两处判定在 v5 部署下**无机会被观察**。

---

## 3. 改动清单（v2：实现优先，规范随后）

### 3.1 【实现·第一笔】修正 Web 判定值与 `completed` 误用

| 序 | 改动 | 说明 |
|---|---|---|
| a | `governanceScope.ts:208` `outcome !== 'ok'` → 对齐 §8 闭集真值 | `ok` 在实现全域出现 0 次，判定恒为「未完成」 |
| b | `governanceScope.ts:340` 同上 | 同因 |
| c | 将下述 `completed` 误用改为 `partial`，并同步 `verification.passed` | 见 §3.1.1；这是 v1 试图用「补闭集」掩盖的真实缺陷 |
| d | `invokeGovernanceScope()`／`verifiedResolution()` 函数头补可达性注释 | 见 §3.2.3；**不改代码** |

#### 3.1.1 必须一并修正的 `completed` 误用（独立审核实证，已复核）

| # | 位置 | 症状 |
|---|---|---|
| 1 | `ldvh-tools.js:377` `precheck-git-commit` | `not_completed: route.ok ? [] : ["signature-traceability"]` ＋ `gaps` 非空，却发 `completed` |
| 2 | `ldvh-tools.js:174` `read-specification-candidates` | `gaps: scan.gaps`（可非空）却发 `completed`、`passed: true` |
| 3 | `ldvh-tools.js:297` `discover-ldvh-capabilities` | governance 不可用时 `gaps` 非空仍发 `completed` |
| 4 | `ldvh-tools.js:124` `resolve-governance-scope` | `not_completed: cwd === undefined ? ["session working directory"] : []`，却发 `completed` 且 `passed: true` |
| 5 | `adr-tools.js:127`（friction／pitfall／spark／research 同构，共 5 处） | `not_completed: value.body_valid ? [] : ["body-structure …"]`、`gaps: value.body_valid ? [] : value.body_issues`，却发 `completed` |

**判定依据**：05 §8 定义 `partial` 为「已实际完成独立子范围，但仍有明确未完成或未验证范围」。上表各行**恰好满足**该定义。故应改发 `partial`。

**注**：
- 第 4 项（`resolve-governance-scope`）系独立审核构造反例时发现，**候选形成者初稿遗漏**；它同时暴露 `not_completed` 非空却 `passed: true` 的既有不自洽。
- 独立审核另指出：`plugin/lib/*.js` 中还有 **17 处** outcome 为运行期变量、**6 处**为条件表达式（如 `research-tools.js:257` `audit.ok ? "completed" : "rejected"`）。故**运行期实际发出的 `completed` 可能多于字面量 26 处**，误用面可能更大。**实现笔开工前须逐处复核该 17＋6 处**。
- `adr-tools.js:118/:98/:65` 三处发 `unavailable`／`rejected`，其 `not_completed: [objectUid]` ＋ `completed: []` 语义正确，**不在修正范围**。

### 3.2 【规范·第二笔】05 §5.3 待登记项撤销

**时序依赖（独立审核发现 7）**：`action-plan:55` 明写「**在修复前**，05 §5.3 已据实登记该差异」。故**实现笔必须先落地并验证**，规范笔才可撤销 §5.3；否则会出现「登记已撤而漂移仍在」——正是 §5.3 本身要防的「据接入面实现主张契约已满足」。

#### 3.2.1 §5.3 待登记项撤销

现文（§5.3，第 109 行）：

> 已观察到的接入面差异（首个待登记项）：Web API 接入面当前按 `outcome === "ok"` 判定成功，而本文 §8 的结果分类闭集为 partial／unavailable／rejected／invalid_request／执行错误，不含 `ok`；该差异在建立授权附件或经 09 登记之前，不得被引为本契约已满足该接入面的证据。

**处置**：实现修复（§3.1）**落地并验证后**，**删除此段**（保留第 103 行「接入面差异须登记」的一般要求不动）。

#### 3.2.2 三处闭集枚举的处置（**不由本候选决定**）

闭集在 05 内出现于**三处**（v1 只发现一处，独立审核发现第二处，本稿复核后定为三处）：

| 行 | 位置 | 措辞 |
|---|---|---|
| `:51` | §3 职责边界 | 「响应状态分类（partial/unavailable/rejected/invalid_request/执行错误）」 |
| `:135` | §6.2 | 「每次调用的 `outcome` **仅使用** §8 的 …」—**强制措辞最强** |
| `:174` | §8 | 「`partial`、`unavailable`、`rejected`、`invalid_request` 与执行错误必须可区分」 |

三处**均不含 `completed`**。**只改其中一处必然制造内部矛盾**——这是 v1 的实质缺陷之一。

**本候选不在 3.4 内改动这三处枚举**。理由：是否把 `completed` 纳入闭集，是**独立规范议题**，须按 01 §11 判断＋01 §12 独立审核另行立项。在 §3.1.1 的误用被清零**之前**讨论扩闭集，正是 v1 被推翻的原因。

**若 Human 决定另行立项**，该议题至少须回答：`completed` 与 `partial` 的判别线如何**机械化**（现实现用 `passed`／`gaps.length`／`not_completed.length` 三套互不一致的信号）；`execution_error` 与文本「执行错误」的命名是否收口；**三处枚举如何同步**。

> **方向性约束**：该议题的唯一正当依据**不得**是「实现里有 26 处 `completed`」——那正是 00 §3.4／01 §11.4／09 §3.3 禁止的「由实现反向定义规范」。立项须回指 00 的具体条款后方可推进。

#### 3.2.3 死路径处置：**只标注，不删除**（推翻 v1 的删除建议）

v1 曾建议删除 `invokeGovernanceScope()`／`verifiedResolution()` 与 `helperExecutable()`／`helperInvocation()`。全仓检索后**推翻**，理由三条：

1. **`helperExecutable()` 有 test 直接钉住其行为**：`plugin/web/tests/api/truthful-reading-projection.test.ts:31-40` 导入该函数并断言其抛「Configured Helper executable is unavailable」。删除会使既有测试失败，且该测试守护的是**真实约束**（配置的 Helper 必须是常规可执行文件），不是冗余。
2. **`configuredLocator()` 仍在活路径上**：`resolveV5CarrierScope()`（`:155`）调用它以选定 current 项目——它不是死代码，v1 误将其列入删除范围。
3. **存在真实的非 v5 部署形态**：见 §2.3 的 try/catch 分析。

**修正后处置**：在 `invokeGovernanceScope()`／`verifiedResolution()` 函数头补注释，如实标注「v5 登记模式下不执行；`LDVH_GOVERNED_PROJECTS_CONFIG` 不可用时为唯一路径」，**代码不动**。删除属独立的重构判断，**不在 3.4（outcome 漂移）授权范围内**——纳入即构成行动计划明令禁止的「借下位修订夹带上位未决定的实质变化」（00 §3.6、01 §11.2）。

> **修正说明**：本项系候选形成者自查发现并主动推翻；独立审核已复核并确认该撤回正确（其主张 5 核验同意「恒不可达」过强），但**同时指出撤回不彻底**（§2.3 正文与 §3.3 表格残留，本稿已一并更正）。
3. **存在真实的非 v5 部署形态**：`LDVH_GOVERNED_PROJECTS_CONFIG` 的设置在 `plugin/lib/index.js:66-70` 被 `try/catch` 包裹；DSH 用户配置根不可用时**不会设置**该变量，此时 `v5CarrierPath()` 返回 null，`invokeGovernanceScope()` **是活路径**。故初稿「恒不可达」表述**过强，已修正**。

**修正后处置**：在 `invokeGovernanceScope()`／`verifiedResolution()` 函数头补注释，如实标注「v5 登记模式下不可达；`LDVH_GOVERNED_PROJECTS_CONFIG` 不可用时为唯一路径」，**代码不动**。删除属独立的重构判断，**不在 3.4（outcome 漂移）授权范围内**——纳入即构成行动计划明令禁止的「借下位修订夹带上位未决定的实质变化」（00 §3.6、01 §11.2）。

> **修正说明**：本项系候选形成者自查发现并主动推翻，非独立审核发现；独立审核仍须复核该判断，并检查是否还有其它过度声明的删除范围。

---

## 4. 与既有规范的一致性

- **00 §3.4（技术不反向定义规范）／01 §11.4（不得因实现方便反向改变规范语义）／09 §3.3（Code 不得反向创造规则）**：这是 v2 推翻 v1「补闭集」的**规范依据**。以「实现有 26 处」为由扩闭集，正是「由实现反向定义规范」，构成行动计划总原则禁止的夹带。
- **09 §6「契约实现纪律」**：本候选不涉及删除任何函数（v1 的删除建议已推翻）。`invokeGovernanceScope()`／`verifiedResolution()` 仅**如实标注可达性**，代码不动。
- **05 §8「partial」定义**：§3.1.1 的 5 类改判**直接援引**现闭集既有定义，属「实现对齐规范」，方向正确。
- **05 §5（接入面）**：修复后 Web 接入面与 LDVH CLI 共用同一 `outcome` 分类，§5.3 的差异项得以消除，而非被「登记」掩盖。

## 5. 残留待决（交 Human／后续审核）

1. **实现笔开工前必做**：逐处复核 `plugin/lib/*.js` 中 **17 处运行期 outcome 变量**与 **6 处条件表达式**（如 `research-tools.js:257` `audit.ok ? "completed" : "rejected"`），确认是否还有 `completed` 误用。字面量 26 处只是下界。
2. **两函数可达性标注**：`invokeGovernanceScope()`／`verifiedResolution()` 是否应补注释如实标注「v5 登记模式下不执行」？本候选倾向**补注释、不改代码**——删除属独立重构判断，不在 3.4 授权范围。请确认。
3. **`completed` 独立议题**：§3.1.1 误用清零后，`completed` 是否仍应成为闭集取值？若应，须另行立项（见 §3.2.2），并回答判别线机械化与三处枚举同步问题。
4. **`execution_error` 命名**：05 §8 文本作「执行错误」，实现用 `execution_error`。该命名差异是否随本病一同收口？本候选**不做**，等 Human 判断是否越出 3.4 范围。
5. **既存不自洽（独立审核附带发现，本候选不修）**：`verification.passed` 与 `not_completed`／`gaps` 在多处互相矛盾（如 `resolve-governance-scope` 在 `not_completed` 非空时仍 `passed: true`）。这已超出 3.4 的 outcome 漂移范围，宜**另立议题**；但它是 §3.2.2 讨论「判别线机械化」时的必要输入。
6. **提交切分**：见 §3 定的两笔，且**实现笔先落、规范笔后落**（§3.2 时序依赖）。请审核确认。

## 6. 已消除的风险与仍存风险

- **已消除 · 风险 1（v1 的「洗白缺陷」）**：v1 主张补闭集，会合法化 5 类误用。**独立审核实证后 v1 已被推翻**，v2 改为先修误用。
- **已消除 · 风险 2（误删死路径）**：v1 的删除建议经自查推翻，代码不动。
- **已消除 · 风险 5（规范与实现同笔提交）**：v2 明确两笔分离且有序。
- **仍存 · 风险 3（中）**：§3.1.1 的改判若改错方向（本应为 `completed` 却改 `partial`），会使正常成功响应降级为部分完成。缓解：逐条按 05 §8 `partial` 定义复核 ＋ 现有测试须全绿。
- **仍存 · 风险 4（低）**：`:208` / `:340` 两处在 v5 部署下不可观察，修改后**无法由现有测试证明其行为**。缓解：保留 v4 路径判定正确性，并在实现处注明该限制。

## 7. 测试基线（本次实测，供实现笔比对）

`cd plugin && node --test test/*.test.mjs` → **538 tests，533 pass，5 fail**。

5 处失败均为**环境性**（`ERR_MODULE_NOT_FOUND`: `@deepseek-ai/dsh-tools/lib/index.js` 在 DSH 安装中缺失），涉及 `adr-tools`／`friction-tools`／`pitfall-tools`／`research-tools`／`spark-tools` 五个测试文件——**与本候选无关，属既有基线**。

与本候选直接相关的四文件（`commit-validation`／`git-gate-runner`／`ldvh-tools`／`session-signature`）：**97 tests，97 pass，0 fail**。


