# 普查：LDVH 自造轮子清单（凡宿主已有者应改用宿主入口）

> **性质**：**普查记录**（只读，未改动任何代码或 `specs/`）。
> **日期**：2026-10-03｜**宿主**：`0.2.0-rc.2`（`dsh-v0.2.0-rc.2` / `639ed01539`）
> **原则（Human 明确）**：**宿主已有的能力、方法、机制，尽量用宿主的，不自造轮子。**
> **口径**：本表只列「宿主**已提供可用入口**而 LDVH 另行实现」者；LDVH 的**领域语义**（管辖、机械签名、事实对象写入等宿主没有的概念）**不属轮子**，不在本表。
> **结论（先行）**：查得 **1 处已换接完成**（会话日志读取的**宿主路径**改用 `open().read()`，见 §1.4）、**1 处部分可换**（子代理登记表部分字段）、**1 处已换接**（子代理结论，见提交 `47841ba`）。`zstd-compat.js` 判定为**正当保留**（shell 路径无宿主入口，U2 已查证），非轮子。

---

## 1. 会话日志读取（宿主路径已换接；shell 路径仍自造）

### 1.1 LDVH 现状

`plugin/lib/session-signature.js`（312 行）的**宿主路径**：以 `sessionPersistence.locate(agent.session.header)` 取**物理文件路径**，再自行读文件、自行解压、自行切行、自行解析：

```
locate(...)                        ← 取物理路径（且 locate 是 jsonl 后端的 private 方法）
  → readSessionLogText(location.path)   ← 自行 readFile
  → decompressZstdStream(raw)           ← 自造多帧解压（zstd-compat.js，105 行）
  → splitJsonlLines(text)               ← 自行切行
  → 解析 per-line JSON                  ← 自行解析
  → 取 model/selection 或 request/context 的值
```

链路命中 3 处 `locate`（`:93`、`:170`、以及 shell 路径的 `:261`/`:299`），`decompressZstdStream` 另有 **46 条**自造测试（`test/zstd-compat.test.mjs`）。

### 1.2 宿主已提供什么

`SessionPersistence` 抽象服务（`packages/session/session-persistence/src/index.ts`）提供：

| 方法 | 语义 | 证据 |
|---|---|---|
| `open(id, access, opts)` | 打开一个已存会话的**日志句柄**；`access='read'` 时「**never takes ownership and works while another handle (or process) holds write ownership**」——正是只读观察所需 | `:165` 签名与 `:155-157` 语义逐字 |
| `SessionHandle.read(offset?, length?, opts)` | 读「valid contiguous logical log」的一段；「**a torn physical tail is never returned**」；返回 `{ events: SessionEvent[] }`——**已解压、已解析的事件对象** | `handle.ts` 逐字 |

且 **`model/selection` 与 `request/context` 都是标准 `SessionEvent` 类型**（`packages/core/session/src/known-event-types.ts:47`、`:50`）——即 `read()` 直接返回 LDVH 要的那两类事件，**无需任何解压或切行**。

### 1.3 判定与收益

| 项 | 内容 |
|---|---|
| **判定** | **重复造轮子**——而且当前路径还依赖 `locate`，那是 jsonl 后端的 **`private` 方法**（`session-persistence-jsonl/src/index.ts:299`） |
| **收益 1** | 删去 `zstd-compat.js`（105 行）与 `test/zstd-compat.test.mjs` 的 46 条自造测试 |
| **收益 2** | 不再依赖私有方法（`locate` 无公开契约，宿主改实现即静默失效） |
| **收益 3** | 正确性由宿主承担——含「torn 尾段永不返回」「重复读不回退」两条契约，而自造解压器对 torn 尾段只能「跳过、不猜」 |
| **收益 4** | 零第三方依赖的红线不受影响（用宿主服务，非引库） |
| **须保留** | **shell 路径**（`currentRouteValuesFromShellEnvironment`）：普通脚本从 `DSH_SESSION_JSONL` 环境变量自读日志，那里**没有 `ctx`**，故 `open().read()` 不可用——该路径的自造解压**仍需保留**，或改用宿主提供的其它 shell 侧入口（未查，见 §4 U2） |

### 1.4 换接已完成（2026-10-03 本会话）

**已实施**：`currentRouteValues` 改为**优先走 `open(id,'read').read()`**，旧的 `locate()` 文件链路**保留为回退**（入口不可用时才走）。取值逻辑抽为单一函数 `extractRouteValuesFromEvents`，**两条入口共用同一纪律**（零清洗）。

| 项 | 内容 |
|---|---|
| 范围 | 仅**宿主路径**（`currentRouteValues`，被 12 个 `*-tools.js` 的受控写入调用）；**shell 路径未动**（无 `ctx`，用不上该入口） |
| 自造代码 | **未删**——`zstd-compat.js` 与其 46 条测试仍为 shell 路径所必需（U2 未决前不删） |
| 换接前的前置验证 | 先写「只有 `open()`、**故意不提供 `locate()`**」的桩把违规变成**红**（失败原因逐字为 `persistence backend has no log location for this session`），再改实现转绿 |
| 改动中自查出的真实缺陷 | `handle.read()` 返回**正序**事件，而取值器要求**由新到旧**；漏掉反转会**静默取到最旧**的 routing 事件（值错而不报错）。已在实现中反转，并加专测锁定 |
| 新增守卫（3 条） | ①必需经 `open().read()` 且**不得调用 private 的 `locate()`**；②**两条入口对同一日志必须给出逐字相同的署名**（换接不得改变任何写入的署名）；③正序返回时须取**最新**一条（顺序回归） |
| 验证 | 单文件 33/33；全量 1044/1044（+3）；lint 19 项为既有基线，本次两文件零报错 |
| 收益（已实现） | 宿主路径**不再依赖 `locate` 这一 private 方法**；正确性（torn 尾段不返回、重复读不回退）改由宿主契约承担 |
| 收益（未实现） | **尚未**删除 `zstd-compat.js`（105 行）与 46 条自造测试——待 shell 路径也找到宿主入口（或在 09 明确该路径的正当性）后再议 |

---

## 2. 部分可换：子代理登记表

| 项 | 现状 | 宿主 |
|---|---|---|
| 子代理**身份与枚举**（id / label / status / parent / depth） | 自建内存 Map（`children` + `retiredChildren`，含 50 条 FIFO：`child.js:37`） | `ctx.subagents.listChildren()` / `listDescendants()`（durable 投影）＋ `list_agents` 工具 |
| 子代理**结论** | 自建扫描 `session/event` | **已换接**：`subagent/end`（提交 `47841ba`；旧路径保留为回退） |
| 子代理**管辖态**（`scopeState`） | 自建 `DelegatedChildRecord.applyParentScope` + `propagateToChildren` | **宿主无此概念** → 属领域语义，**不换** |
| 子代理**活动轨迹**（`ActivityLog`） | 自建 | 宿主无对等物 → **不换**（或评估是否仍有消费方） |

**判定**：**枚举与身份可换，管辖态与活动轨迹不可换**。但须注意 `lookupChild` 同时供 `record_review`（`workcase-tools.js:627`，**已达机械档**）取 `conclusion`——故本项换接**风险高于收益**，建议**暂缓**（除非同时把管辖态迁到别处，那是另一件事）。

---

## 3. 已确认不属于轮子（宿主没有，属 LDVH 领域语义）

| 模块 | 为何不是轮子 |
|---|---|
| `governance-scope.js`、`governed-projects.js` | 「管辖」是 LDVH 独有概念 |
| `session-signature.js` 的**签名取值纪律**（零清洗、host/shell 双路、branded carrier） | 09 机械签名要求；宿主无对等物 |
| 各 `*-writer.js`（13 个事实类型写入器） | 事实模型与受控写入是 LDVH 核心 |
| `hook-manager.js` / `git-gate-runner.js` / `commit-validation.js` | **宿主无 Git 提交门禁**（已核验：全仓 grep 零命中）——这是 LDVH 的独有价值 |
| `guidance*.js` / `triggers.js` | 规则引导内容与占位触发点属 LDVH 内容 |
| `web-mount.js` / `web-*.js` | Web 呈现层（宿主 webServer 是承载，非替代） |
| `markdown-structure.js`、`spec-registry.js` | 规范源解析（01 的领域） |
| `membership-evidence.js` | 01 §9 成员资格程序（LDVH 领域） |

---

## 4. 本次未查 / 未证实

| # | 项 |
|---|---|
| U1 | **未实测** `open().read()` 在运行中的真实返回（本记录为源码级判定；须实跑验证 seq 口径与事件形状） |
| U2 | **已查（2026-10-03）**：宿主**不为**无 `ctx` 的普通脚本提供日志读取入口——shell 侧只注入 `DSH_SESSION_ID` 等身份键（`packages/shell/shell-env/src/index.ts:73,79,162`），无 `dsh` CLI 读取子命令（`find` 零命中）。**故 shell 路径保留自造解压是正当的**，不是轮子。 |
| U3 | **未穷举** `plugin/lib` 全部 46 个模块（只查了会话读取、子代理登记、及 §3 的抽样）；**可能存在本表未收录的其它轮子** |
| U4 | 未评估换接对 `guidance-text.js` 或 Web 呈现侧引用的连带影响 |
| U5 | 未确认 `sessionPersistence.locate` 是否在宿主某版本被改签名——`private` 无契约，无法从声明判断稳定性 |

---

## 5. 推进状态与后续

**已完成（本会话）**：
1. ✅ 用「只有 `open()`、无 `locate()`」的桩做**前置验证**（先红后绿），确认换接可行且能锁住行为。
2. ✅ 换接**宿主路径**（`currentRouteValues`）；旧 `locate()` 链路保留为回退。
3. ✅ 补两条关键回归：**两条入口取值必须逐字相同**（护住 12 个写入点的署名）、**正序返回须取最新一条**（顺序缺陷）。
4. ✅ 全量 1044/1044 通过；lint 无新增。

**仍待办**：
5. **`zstd-compat.js` 已判定为正当保留**——U2 已查：宿主不为无 `ctx` 的普通脚本提供日志读取入口（只注入 `DSH_SESSION_ID`，无读取 CLI）。该件服务于 shell 路径，**不是轮子**，不应强删。
6. 第 2 节（子代理登记表）**暂缓**——会碰到已达机械档的 `record_review`；若将来要做，须先解决管辖态的迁移。
7. 建议对 `plugin/lib` 余下模块做一次**完整轮子普查**（U3），把"宿主已有而我们自造"的项一次列全，避免逐次零散发现。

---

**本记录为只读普查产出**；§1.4 所述换接已按受控提交落盘（`plugin/lib/session-signature.js` 与 `plugin/test/session-signature.test.mjs`）。未修改 `specs/`、未创建事实对象。
