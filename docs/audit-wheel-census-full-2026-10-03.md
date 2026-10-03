# 完整轮子普查：`plugin/lib` 全部 48 个模块（宿主已有 vs LDVH 自造）

> **性质**：**普查记录**（只读，未改动任何代码或 `specs/`）。
> **日期**：2026-10-03｜**宿主**：`0.2.0-rc.2`（`dsh-v0.2.0-rc.2` / `639ed01539`）
> **原则（Human 明确）**：**宿主已有的能力、方法、机制，尽量用宿主的，不自造轮子。**
> **口径**：判据是「**宿主是否提供可用入口**」，不是「看起来像不像轮子」。凡宿主无对应者（尤其 LDVH 领域语义）**不算轮子**，须如实标注避免误删。
> **范围**：`plugin/lib/` 全部 **48** 个 `.js`（22,874 行）逐个过。
> **前序**：`docs/audit-wheel-census-2026-10-03.md`（首项已换接，本文件为完整化）。

---

## 0. 总览（五类）

| 类 | 数量 | 含义 |
|---|---|---|
| **A · 应换接（宿主有可用入口）** | **2** | 明确的自造轮子，建议改用宿主入口 |
| **B · 已换接（本会话）** | **2** | 已改为宿主入口并验证 |
| **C · 宿主无对应（LDVH 领域语义，非轮子）** | **38** | 不得以「像轮子」为由删除 |
| **D · 无生产消费方（疑似空转/死码）** | **3** | 与「轮子」不同族的问题：无人调用 |
| **E · 正当使用宿主包** | **3** | 已用宿主第一手包，不是自造 |

---

## 1. A 类 · 应换接（2 项）

### A1 · 事实对象的文件写入未走宿主 `ctx.fs` 的版本守卫（**新发现，最重**）

| 项 | 内容 |
|---|---|
| **现状** | 6 个 writer（`spark-writer.js`、`workcase-writer.js`、`adr-writer.js`、`pitfall-writer.js`、`norm-writer.js`、`goal-writer.js`）**全部**用 `node:fs/promises` 自建「写临时文件 → 回读比对 → `rename`」的原子写（如 `spark-writer.js:43`、`:613-621`） |
| **宿主已提供** | `ctx.fs.writeText(target, content, expected?, signal?, sandboxPolicy?)` 与 `ctx.fs.editText(...)` —— 是 **plugin-visible 的抽象服务**（`packages/fs/fs/src/index.ts:266,287`），`expected` 即 `{kind:'replaceIfVersion', version}` 版本守卫 |
| **规范要求** | `specs/08` §6 该行逐字：「**两半都要**：读一侧把实际读到的观察**记录并发出**……**写一侧经 `fs/write-intent`／`fs/edit-intent` 挂载版本守卫**，且只对已观察过的目标主张版本」；未满足时「**不得主张版本或指纹屏障已生效**」 |
| **实测缺口** | **两半不匹配**：<br>· 读侧**已实现**——`host-seams.js:283` 挂 `fs/observed`、`:299-300` 挂 `fs/write-intent`／`fs/edit-intent` 并返回 `{kind:'replaceIfVersion', version}`<br>· 写侧**零生产调用**——全仓 `grep '\.writeText(' / '\.editText('` **零命中**；6 个 writer 直接走 `node:fs`<br>· ⇒ **那个守卫生效了，但没有任何 LDVH 写入经过它**——守卫无生产者 |
| **判定** | **应换接**。这不是「少写代码」，而是**规范已要求、实现已装好一半、却没接到写入路径** |
| **为何没接上（架构原因，非疏忽）** | writer 是**纯函数层**：`atomicWriteFile(filePath, content)` 是模块私有函数、**作用域内无 `ctx`**（`spark-writer.js:609`），故它**在结构上无法**调用 `ctx.fs`。`ctx` 在更外层——`registerSparkTools(ctx, deps)`（`spark-tools.js:806`）持有它，但调用 `createSparkObject({...})`（`:396`、`:416`）时**没有把 `ctx`/`fs` 传进去**。⇒ 换接须**把 `ctx`/`fs` 沿调用链接到写盘点位**，不是改一行 |
| **替代处置（若不换接）** | 按 `specs/08` §6 纪律，该缝现属**半消费**：读侧已装、写侧未接。**不换接也可，但须如实报告「写侧未消费」**，且不得主张版本屏障已生效 |
| **收益** | ①事实对象写入真正获得宿主版本屏障（当前只有自建 read-back，不防「读后他方改动」）；②`specs/08` §6 该行的「两半」要求真正满足；③自建原子写可退化为回退路径 |
| **风险与前置** | 6 个 writer 是**受控写入的点位**（03 的原子+不可回读要求在此），**改动前须确认**：`ctx.fs.writeText` 的原子性是否满足 `specs/03` 的「原子、不可覆盖」（`03:290`），以及换接后**写后回读与失败回滚**语义不变。**建议先只改 1 个 writer 做验证**，不全量替换 |

### A2 · 子代理登记表的枚举与身份（部分可换）

| 项 | 内容 |
|---|---|
| **现状** | 自建内存 Map：`children`（活体）+ `retiredChildren`（已结束，**50 条 FIFO**：`child.js:37`），`childRecords()`／`lookupChild()` |
| **宿主已提供** | `ctx.subagents.listChildren()`／`listDescendants()`（durable 投影）；`list_agents` 工具给 `id`/`label`/`status`/`parent`/`depth` |
| **可换范围** | **仅枚举与身份**（id／label／status／parent／depth） |
| **不可换** | `scopeState`（管辖态）与 `conclusion`（结论）——**宿主都没有**；且 `lookupChild` 被 `record_review`（`workcase-tools.js:627`，**已达机械档**）取 `conclusion` |
| **判定** | **部分可换，建议暂缓**——风险大于收益：须先解决管辖态迁移，否则会碰坏机械档 |
| **注** | 结论捕获已在 B1 换接；此项剩余价值仅「去掉 50 条 FIFO 上限」，可等管辖态有出路时一并做 |

---

## 2. B 类 · 已换接（本会话，2 项）

| # | 项 | 提交 | 验证 |
|---|---|---|---|
| **B1** | 子代理结论 → `subagent/end` 的 `lastAssistantMessage` | `47841ba` | 全量 1041/1041；含 2 条新守卫（采纳结论、防串写） |
| **B2** | 会话日志读取（宿主路径）→ `open(id,'read').read()` | `863b1be` | 全量 1044/1044；含 3 条新守卫（必经 `open`、两入口取值逐字相同、正序须取最新） |

---

## 3. C 类 · 宿主无对应（LDVH 领域语义，38 项，**非轮子**）

按功能族归类，逐项注明「为何不是轮子」：

| 族 | 模块 | 为何不是轮子 |
|---|---|---|
| **管辖**（4） | `governance-scope.js`、`governed-projects.js`、`session-scopes.js`、`host-api.js` | 「管辖」是 LDVH 独有概念，宿主无此语义 |
| **机械签名**（2） | `session-signature.js`（取值纪律部分）、`signature-channel.js` | `specs/09` 要求签名由 Code 从权威记录取；宿主无对等物（`00.1.7` 后 `locate` 已换成 `open().read()`） |
| **事实类型写入器**（8） | `spark-writer`、`workcase-writer`、`adr-writer`、`pitfall-writer`、`norm-writer`、`goal-writer`、`friction-writer`、`research-writer` | 事实模型、CAS、受控写入是 LDVH 核心（**其文件写入方式见 A1**） |
| **事实类型工具层**（8） | `spark-tools`、`workcase-tools`、`adr-tools`、`pitfall-tools`、`norm-tools`、`goal-tools`、`friction-tools`、`research-tools` | 05 声明的领域操作，宿主无对等物 |
| **Git 提交门禁**（3） | `hook-manager.js`、`git-gate-runner.js`、`commit-validation.js` | **宿主零命中**——受控提交完全由 LDVH 自供，是本仓库独有价值 |
| **规范源解析**（2） | `spec-registry.js`、`markdown-structure.js` | 01 的领域（身份块、L0–L4、正文结构） |
| **成员资格证据**（1） | `membership-evidence.js` | 01 §9.2 第 8/9/11/12 项，LDVH 领域 |
| **注入内容**（2） | `guidance-text.js`、`guidance.js` | 引导**内容**属 LDVH（宿主提供 `system-prompt/assemble` 缝，内容归 LDVH） |
| **生命周期编排**（3） | `lifecycle.js`、`agent-lifecycle.js`、`child.js` | 管辖沿委派链继承属 LDVH 语义（宿主无「管辖态」概念） |
| **触发占位**（2） | `triggers.js`、`event-stream.js` | 触发点占位与事件原语（`event-stream` 另见 D 类） |
| **Web/RPC**（4） | `web-mount.js`、`web-preferences.js`、`rpc.js`、`client.js` | Web 呈现层（宿主 `webServer` 是承载非替代）；`web-preferences` 是 LDVH 呈现偏好 |
| **装配与入口**（3） | `index.js`、`bin.js`、`runtime-config.js` | 插件装配层 |
| **其他**（5） | `spark-tools` 等已计；`research-session.js`、`adr-enumeration.js`、`subagent-result.js`、`zstd-compat.js`、`ldvh-tools.js` | 见下注 |

**特别注明三项曾被误判为轮子的**：

| 模块 | 先前判断 | 查证后 | 依据 |
|---|---|---|---|
| `zstd-compat.js`（105 行） | 疑为轮子（自造多帧解压） | **正当保留** | 宿主**不为无 `ctx` 的普通脚本**提供日志读取入口——shell 侧只注入 `DSH_SESSION_ID`（`packages/shell/shell-env/src/index.ts:73,79,162`），无读取 CLI（`find` 零命中）。该件服务于 shell 路径 |
| `subagent-result.js`（199 行） | 疑为可选 | **正当保留** | 提供宿主 `list_agents` **不提供**的 `conclusion` 与 `scopeState` |
| `adr-enumeration.js`（117 行） | — | **见 D 类**（无消费方） |

---

## 4. D 类 · 无生产消费方（3 项，**与「轮子」不同族**）

| 模块 | 规模 | 状态 | 证据 |
|---|---|---|---|
| `adr-enumeration.js` | 117 行 | **仅被自己的测试引用**（`test/adr-enumeration.test.mjs`、`test/scaffolding.test.mjs`），`lib/` 内零引用 | 全量扫描 `grep -rls` |
| `event-stream.js` | 49 行 | 同上（仅 `test/scaffolding.test.mjs`） | 同上；其自述为「为反思批次预留」 |
| `runtime-config.js` | 43 行 | 同上（仅 `test/scaffolding.test.mjs`） | 同上；其自述「借用 mnemon live-runtime shape」 |

**判定**：这三项**不是「宿主已有而我们自造」**（宿主无对应），而是**「写了但没人用」**——属于**另一个问题族**（候选设计的空转）。处置选项：① 接线（若有真实消费方）；② 如实登记为「候选未接线」；③ 删除。**不属本次轮子普查的处置范围**，单独列出避免与轮子混淆。

---

## 5. E 类 · 正当使用宿主第一手包（3 项，非自造）

| 模块 | 用的宿主包 |
|---|---|
| `governed-projects.js` | `@deepseek-ai/dsh-atomic-write`（`withFileLock`、`writeFileAtomic`） |
| 各 writer | `yaml`（第三方解析包，非自造） |
| `session-signature.js`、`governed-projects.js` | `node:zlib` 内建 zstd（红线：零第三方运行时依赖） |

**现有红线合规**：LDVH 的「零第三方运行时依赖」承重件**未被破坏**——A1 的换接（改用 `ctx.fs`）也是在用宿主服务，不引新依赖。

---

## 6. 未做 / 未证实

| # | 项 |
|---|---|
| U1 | **A1 未实测**：`ctx.fs.writeText` 的原子性与 `specs/03` 的「原子、不可覆盖」是否**逐条相容**（只读了签名与语义描述，未跑对照实验） |
| U2 | **A1 未评估**：换接后 6 个 writer 的**写后回读与失败回滚**语义是否不变（本轮只定位差异，未做等价性证明） |
| U3 | **未查 `plugin/web/`**（Web 侧另有独立代码树，不在 `plugin/lib` 48 个模块内） |
| U4 | 未评估 D 类三项的**历史意图**（是否曾接线后被撤） |
| U5 | **C 类判定为「宿主无对应」系逐族判断**，未对 38 项逐项做源码级排除性检索（如「宿主是否恰有其他等价服务」）；故 C 类**不是**「已证明宿主没有」，而是「未发现宿主有」 |
| U6 | 未做**运行时**验证（全部为源码/静态判定） |

---

## 7. 建议

1. **优先做 A1 的前置实测**（U1/U2）：先在一个 writer 上验证 `ctx.fs.writeText` 与自建原子写的**等价性**，再决定是否换接。**注意**：`specs/08` §6 该行现在处于「读侧已装、写侧未接」的**半消费**状态——按该节纪律，这属「未消费」不得主张版本屏障已生效；换接与否都须**如实报告**该状态。
2. **A2 暂缓**（会碰机械档）。
3. **D 类三项单独立项**（接线 / 登记 / 删除），不混入轮子处置。
4. **C 类不删**——尤其别误删 `zstd-compat.js`（shell 路径刚查证为必需）。

---

**本记录为只读普查产出**：未修改 `plugin/` 与 `specs/`、未创建事实对象。
