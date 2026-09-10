# 06 修订候选 · 签名取值来源的入口职责划分（3.2）

> 依据：`docs/action-plan-2026-09-10.md` 阶段 3 步 3.2。
> 门：规范文本修改 → 独立审核 → Human 同意 → 只含 06 的独立提交。

---

## 0. 修订记录：v1 被独立审核推翻，本稿（v2）改向

**v1** 提出方案 B：把「取值来源」按入口分派为 **precheck 独有职责**，理由是 Git Gate 结构上拿不到会话记录。

**独立对抗审核（`71ed6c36`）判定 v1 有 2 项阻塞缺陷，推翻其结论。** 核心发现：

1. **「不降低约束」为不实声明（F1）**：v1 把该检查从**强制闸门**移到**主动工具**，而 **precheck 在规范上从不是强制前置**（`specs/06:85` 明确「不因本规范存在而强制经过 precheck」；`hook-manager.js` 与 `git-gate-runner.js` 中 `grep precheck` **零命中**——hook 从不调用 precheck，也无任何机制把提交与「已过 precheck」绑定）。故 v1 的净效果是**取消**一项强制检查，同时**未新增任何检查**。据 00 §7.1，此即「声称已被保障而实现不符」。
2. **v1 的推理方向错了**：v1 把 Gate 无法查证当作「应改规范去承认」，但 Gate 无法查证的**真实成因**是 §6.1 与实现之间存在**未修复的缺口**——行动计划的原始记载正是「**Git Gate fail-open 修复**」。**把 fail-open 写进规范，等于把缺陷升格为特性。**

**本稿改向**：不再以「改规范承认限制」为主体。改为**两条并行且互补**的动作——规范侧**明确 precheck 的强制地位**（把可选前序变成机械可达的前置），从而使「取值来源」无论由哪个入口执行都**真正被强制**。

> **本稿不自行认定 Human 决定的作用范围。** v1 声称「Human 决定采方案 B」，但行动计划在案记录为「3.2 ＝ **甲（补实现）**」（`action-plan:53`），且待决清单 B 将「Git Gate fail-open 修复方向」列为 **Human 待决**（`:103`）。**该冲突需 Human 明确回应**（见 §5 待决 1）。在取得回应前，本候选不进入 Human 决定。

---

## 1. 问题陈述（事实层，经独立审核复核成立）

`06 §6.1` 现文：

> precheck 与 Git Gate 机械检查两行 trailer 的**存在、取值来源**和候选一致性。

该句把「取值来源」列为 **precheck 与 Git Gate 共同**的机械检查项。经核实实现：

| 入口 | 输入 | 能否查「取值来源」 |
|---|---|---|
| precheck（`plugin/lib/ldvh-tools.js`） | message ＋ Index diff ＋ 会话权威记录（route） | **能**——`checkSignatureAgainstRoute` 逐值比对，命中 `validation/signature_provider_mismatch` / `signature_model_mismatch` |
| Git Gate（`plugin/lib/git-gate-runner.js`） | `--workspace-root` / `--worktree` / `--message-file` / `--index-file` | **不能**——入口签名不含会话记录路径 |

独立审核进一步确认「结构不可达」比我方论证**更稳固**：`--workspace-root` 在 Gate 内**从未被使用**（仅 `:23`、`:27` 出现），hook 脚本为固定字符串（`hook-manager.js:82-103`）且以 sha256 锚定完整性，添加会话变量会使 hook 进入 `conflict` 状态。

**实证反例（审核构造，已复核）**：`LDVH-Provider: x` 与权威记录不符时，Gate 仍放行——

```
plugin/test/git-gate-runner.test.mjs:188
assert.equal(accepted.code, 0, accepted.stderr);   // 任意取值均被接受
```

**即当前 §6.1 处于 fail-open 状态**——规范宣称 Gate 检查取值来源，Gate 实际不检查。这正是行动计划所称的「Git Gate fail-open」。

---

## 2. 真正的成因与修复方向

**成因不是「§6.1 写错了」，而是「§6.1 要求的一项检查没有任何入口真正强制它」。**

- Gate 侧：结构不可达（技术事实）；
- precheck 侧：**能查，但从不被强制**——它只是一个 AI 可跳过地调用的工具。

因此**两条路可选，且只有一条能真正闭合**：

| 方向 | 做法 | 是否闭合 |
|---|---|---|
| **给 Gate 会话输入**（v1 的「方案 A」） | hook 注入会话记录路径 | 闭合，但使终闸依赖运行时环境，与 `cleanGitEnvironment` 与 `session-signature.js:12-18` 的**去环境依赖**意图相反 |
| **使 precheck 成为机械前置**（本稿） | 规范明确：受控提交候选须先取得 precheck 的 `passed`；Gate 校验该前置是否成立 | 闭合，且**不引入会话环境依赖**——Gate 只需校验一个**已绑定到 staged Index 的凭证** |

**本稿采后者。** 理由：它把「无状态」与「真强制」两个目标同时满足——Gate 仍只需 (diff, message) ＋ 一个可机械核对的凭证，**不需要会话历史**。

### 2.1 可行性核验（本稿已做，含代码实证）

`precheck` 通过时已返回 `snapshot_identity`：

```
plugin/lib/ldvh-tools.js:374
...(mechanicalOutcome === "passed" ? { snapshot_identity: snapshotIdentity(diff, message), ... })
```

Gate 侧已计算**同一函数**的同一结果：

```
plugin/lib/git-gate-runner.js:46
const snapshot = snapshotIdentity(diff, message);
```

两侧均 `import ... snapshotIdentity ... from "./commit-validation.js"`（`ldvh-tools.js:23`、`git-gate-runner.js:6`）——**同一实现、同一输入（diff, message）**。§6.2 亦已写明其用途是「与 Git Gate 双入口一致性比对」，且 precheck 的 `follow_up`（`:386`）已指示「commit 后核对 Git Gate stderr 的 `snapshot_identity` 与本次一致」。

**故凭证的机械基础已经存在且无状态**：Gate 重算 `snapshot_identity`，与提交候选携带的凭证比对，即可判定「该候选确曾通过 precheck」——**不需要会话历史**。本稿不预设凭证的具体承载形式（见 §5 待决 2）。


---

## 3. 拟修改条文

### 3.1 §6.1 末段（核心改动）

**原文**：

> **precheck 与 Git Gate 机械检查两行 trailer 的存在、取值来源和候选一致性。**

**改为**：

> **两行 trailer 的机械检查按入口分派，且受控提交候选须先经 precheck：precheck 检查其存在、取值来源与候选一致性；Git Gate 检查其存在、候选一致性，并校验本次候选已取得 precheck 的准备结果。取值来源检查以 DSH 权威会话或请求记录为输入，只在持有该输入的入口（precheck）执行——Git Gate 由 commit-msg Hook 触发，其入口输入为 message 与 staged Index，不含会话记录，故不承担取值来源检查。该分派不豁免 §6.3 的任何阻断要求，也不得被解释为允许 AI 自填、越过取值来源取得数值，或跳过 precheck 直接提交。**

### 3.2 §6.3 新增「precheck 前置」条

**新增**：

> - **precheck 前置**：受控提交候选在提交前必须取得 precheck 的准备结果，并使该结果与本次 staged Index 绑定（绑定方式由 08/09 实现并登记）。Git Gate 校验该前置成立；前置缺失、与当前候选不一致或不可校验时**阻断**。本条使 §6.1 的取值来源检查获得机械可达的强制路径：不经 precheck 的提交在取值来源项上**不得**被视为已受机械保障。

### 3.3 §6.2「输入契约」第 4 项（措辞收口）

**原文**：

> 4. Trailer 两行完整（LDVH-Provider / LDVH-Model），且 provider/model 可回指当次 DSH 权威记录。

**改为**：

> 4. Trailer 两行完整（LDVH-Provider / LDVH-Model），且 provider/model 的**取值来源**可回指当次 DSH 权威会话或请求记录（按 §6.1 入口分派，**本条为 precheck 独有职责**）。当权威记录不可取得（空白会话、历史会话、会话内模型切换）时，本条不判为未通过，而以 `unverifiable` 返回并附具体缺口，不得以部署默认值顶替比对。

### 3.4 §8 验证表（**同批**，不再推迟）

**新增一行**：

| 验证对象 | 验证时机 | 成立条件 | 可接受依据 | 验证入口 | 可证明范围 | 未满足时的处理 |
|---|---|---|---|---|---|---|
| precheck 前置成立 | 受控提交事件中 | staged Index 与某次 precheck 准备结果一致 | Git Gate 重算的 `snapshot_identity` 与候选携带的凭证 | Git Gate 事件检查 | 该候选曾取得 precheck 结果；不证明该结果本身正确或 Human 已授权 | 阻断，须补跑 precheck |

**并修改「message 机械合规」行**（`:190`）的「可接受依据」，把「message 文本与本文 §6.1」改为「message 文本与本文 §6.1（precheck 侧含取值来源；Git Gate 侧不含）」。

> **v1 曾把此项列为「待审确认项，不擅自改」。独立审核（F4）判定该推迟不合法**：§8 表是同一门控、同一提交范围内的内容，已知会产生内部矛盾而仍提交，违反 01 §11.1「准确候选」。**本稿已同批修改。**

### 3.5 §6.3「同一 validator」条（消除 v1 引入的新冲突）

**原文**：

> - **同一 validator**：precheck 与 Git Gate 使用同一算法逻辑，只允许入口输入、响应形式与实际作用不同……

**改为**：

> - **同一 validator**：precheck 与 Git Gate 共用同一校验实现，只允许入口输入、响应形式与实际作用不同——各入口按自身输入调用该实现中适用的检查项，**检查项集可因输入不同而不同**，但不得出现同一检查项的第二份实现……

> **理由（独立审核 F5）**：v1 只改 §6.1，会把冲突从 §6.1↔§6.3 移到 §6.3↔09 §6，未真正解决。本稿同步澄清 §6.3 的「同一算法逻辑」措辞，使「共享实现、检查项集可不同」成为明文，与 09 §6「同一校验职责入口」不再冲突。

---

## 4. 与既有规范的一致性

- **00 §3.4（机械守护 fail-closed）**：本稿**修复** fail-open 而非承认它，方向与该锚点一致（v1 方向相反）。
- **00 §7.1（防自欺）**：v1 的护栏是「无机械来源的自报禁则」，恰是 §6.1 自身否定过的形态。本稿改为**机械可达**的前置校验（§3.2），不再以散文禁则替代机械保障。
- **09 §6「Git Gate 共享」**：本稿 §3.5 同步澄清措辞，使「共享实现」与「检查项集可不同」并存，消除与 09 §6 的张力。
- **09 §6「机械签名」**：§3.3 保留 `unverifiable` 处置，与 09 对空白／历史会话的确定性要求一致。

## 5. 残留待决

1. **Human 须先回应决定冲突**：行动计划 `:53` 记「3.2 ＝ 甲（补实现）」，v1 声称「Human 采 B」。**两者不可同真**。请 Human 明确：3.2 的方向是「补 Gate 实现」还是「改规范分派」。**在取得回应前本候选不推进。**
2. **前置凭证的承载形式**：§3.2 需要一种「与 staged Index 绑定」的凭证。候选形式：① 新增 trailer 行（但 §6.1 刚确立「Human 授权不由 trailer 承载」，需论证不冲突）；② 独立预检文件；③ Index metadata。**属实现设计，须 08/09 定义后回填本候选**，本稿不预设。
3. **`invokeGovernanceScope` 类问题不涉本候选**：本候选只动 06，不触实现。
4. **是否存在第三入口**：审核指出 Web 侧可能成为第三接入面；本稿 §3.1 的「只在不持有会话输入的入口例外」措辞可自然覆盖，但**未逐一验证**。

## 6. 风险

- **风险 1（高，方向性）**：若 Human 实际要的是「补 Gate 实现」而非改规范，本稿整体作废。**缓解：§5 待决 1 前置。**
- **风险 2（中）**：§3.2 的前置校验若最终无法以无状态方式实现，则退化为「Gate 仍需会话输入」，届时须回到 v1 的「方案 A」并重估其无状态性代价。
- **风险 3（低）**：§3.1 新增句较长，独立审核批评 v1「把实现事实写进规范条文」（违反 01 §11.4）。本稿保留了对入口输入的描述，但已改为描述**输入定义**而非当前 hook 命令行形状；**仍请审核判断是否足够**。
- **已消除**：v1 的 F1（不实声明）／F2（绕过路径）／F3（未披露冲突）／F4（§8 推迟）／F5（新冲突）均在本稿对应处理。

## 7. 测试基线

`cd plugin && node --test test/commit-validation.test.mjs test/git-gate-runner.test.mjs test/ldvh-tools.test.mjs test/session-signature.test.mjs` → **97 pass / 0 fail**。

`git-gate-runner.test.mjs:152-190` 现有 legacy trailer 测试**断言 Gate 接受任意取值**——那是当前 fail-open 的书面证据。**本候选若落地，该测试须相应更新**（属实现笔，不在本规范笔内）。
