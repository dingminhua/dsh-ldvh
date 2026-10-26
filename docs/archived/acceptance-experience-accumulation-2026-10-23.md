# 经验积累系统 · 功能验收报告（2026-10-23）

| 项 | 值 |
|---|---|
| 业务系统 | 经验积累（00 §3.4 名录第 6 项） |
| 事实规范 | `specs/35-经验积累系统规范.md`（业务判据） |
| 运行机制 | `specs/11-宿主辅助任务规范.md` §10／§12bis／§12ter／§18（唯一权威） |
| 事实类型 | `specs/23-Pitfall-踩坑经验.md` §6.2／§8／§9／§16.1 |
| 验收工作树 | `/Users/dmh2002/DshProject/dsh-ldvh-experience-accumulation` |
| 分支 | `acceptance/experience-accumulation`（自 `dev@ee11fc1`） |
| 验收日期 | 2026-10-23（Asia/Shanghai） |
| Human 路由决定 | 直接执行（21 §6.3 判定不对象化） |

**本报告能证明什么**：条款与实现的对应关系、测试覆盖、真实运行痕迹的取值，
以及本次修复前后的行为对照。
**本报告不能证明什么**：经验在将来仍然成立、经验会被复用、项目因此少犯错误
（35 §14 末段）。本报告不作任何此类结论。

---

## 1. 验收基线

| 项 | 接单前（`dev@ee11fc1`） | 修复后（本分支工作树） |
|---|---|---|
| `npm --prefix plugin ci` | 退出码 0 | 未重跑（依赖未变） |
| `npm --prefix plugin test` tests | 1813 | **1856** |
| pass | 1812 | **1855** |
| fail | 0 | **0** |
| 插件顶层 `test(` 声明数 | 1783 | **1826**（+43） |
| Web API 测试（`web/tests/api`） | 528 | **527**（+10 条新护栏；旧的 7 条按修订后规范重写） |
| `npx eslint .` | 通过 | 通过 |

```text
plugin:  ℹ tests 1856  ℹ pass 1855  ℹ fail 0
web api: ℹ tests  527  ℹ pass  527  ℹ fail 0
tsc -b:  exit 0
eslint:  exit 0
```

> **注**：修复 ①（接上审核段派发）与 ⑦（留观区可见）是**在验收过程中按 Human
> 指示追加实现**的，不是验收前的基线。接单前基线仍是 `1813 / 1812 / 0 / 1`。

跳过的 1 条为 `test/web-mount.test.mjs` 的 Windows 8.3 短名专用用例，在 macOS 上
按平台早退，与本次验收无关。

> **计数口径说明（避免误读）**：`tests` 是运行计数（含子测试），`test(` 声明数
> 只数顶层用例。两个口径都记录，是因为只看其中一个会让人误判"新增了 7 条却只多
> 几个运行项"或反之。

---

## 2. 条款覆盖矩阵

判定口径：**有实现** = 存在承担该条款的入口且可机械核对；**无实现** = 检索不到
承担者；**部分** = 有入口但未覆盖该条款的全部要求。

### 2.1 运行机制（11 号）

| 条款 | 要求 | 实现位置 | 判定 |
|---|---|---|---|
| §10.1 第 1 项 | 读区间材料、识别失败现象 | `lib/experience-capture-contract.js` `validateCaptureVerdict`；`lib/aux-task-registry.js` 的 `experience-capture` 登记 | 有实现 |
| §10.1 第 2 项 | 写 1 条留观缓冲条目 | `lib/experience-landing.js` `landCaptureVerdict` → `lib/observation-buffer.js` `appendBufferEntry` | 有实现 |
| §10.1 第 3 项 | 写入后精确回读 | `observation-buffer.js:580` `appendBufferEntry` 内的写后回读 | 有实现 |
| §10.1 第 4 项 | 校验不可用即 fail-closed | `experience-landing.js` 的失败分支 + `lifecycle.js:1020` 的入队 | 有实现 |
| §10.2 第 1 项 | 只读 pending 条目、不读实时对话 | `observation-review.js` `reviewPendingEntries` 入参闭集（无任何会话正文参数） | 有实现 |
| §10.2 第 2 项 | 对照 active 与 draft 查重 | `collectExistingPitfalls` + `verifyDedupeRecord` | **本次修复后才有实现**（见缺陷 ②） |
| §10.2 第 3 项 | 建 `draft`、七段、逐字引证复制 | `verifyEvidenceCopy` + `createPitfallObject(status=draft)` | 有实现 |
| §10.2 第 4 项 | 回读候选、条目置 `consumed` | `readPitfallObject` 回读 + `settleBufferEntry` | 有实现 |
| §10.2 第 5 项 | 不足成文置 `discarded` 并披露理由 | `settleBufferEntry(status=discarded)` | **本次修复后才有实现**（理由原被丢弃，见缺陷 ③） |
| §10.2 第 6 项 | 任一校验不可用即 fail-closed | `failClosed(...)` 全路径 | 有实现 |
| §10.2 上限 | 一次运行至多 1 条候选 | `MAX_CANDIDATES_PER_RUN = 1`（模块常量，不可入参放大） | 有实现 |
| **§8 第 3 项** | **「审核经验候选」作为一项空闲职责** | **无**：`AUX_TASK_ORDER` 只有 `friction-discovery`/`experience-capture`/`capacity-maintenance`/`memory-health`；`reviewPendingEntries` 只被 `ldvh_observation_buffer_review` 调用 | **无空闲调度入口**（缺陷 ①，见 §4） |
| §12bis 载体 | 字段闭集／容量 200／保留期 30·90 天 | `observation-buffer.js` 常量与 `readBufferEntries` 的惰性结算 | 有实现 |
| §12bis 写入纪律 2 | 唯一消费者是审核段 | 无 Web/其它读入口（`web/api/routes/*` 检无引用） | 有实现 |
| §12bis 末「证据不留在缓冲」 | 正文须复制逐字引证 | `verifyEvidenceCopy`（拒绝 `buffer:<id>` 单独出现） | 有实现 |
| §12ter 两条操作 | 声明输入/结果契约 | `ldvh-tools.js` 的 `OPERATIONS` + `parameterSchemaFor` + 信封 | 有实现；**交付面本次修复**（缺陷 ④） |
| §18 七段完整行 | 结构解析＋逐段非空＋引证复制 | `verifyEvidenceCopy` | 有实现 |

### 2.2 业务判据（35 号）

| 条款 | 要求 | 实现位置 | 判定 |
|---|---|---|---|
| §8.1 四项留存判据 | 语义判断，规范明定不由机械校验保障 | —（语义） | 不适用机械核对；**不得据测试通过主张已满足** |
| §8.2 不算形态 | 同上，入口拦截属语义 | — | 同上 |
| §8.3 分流路由 | **沉淀去向的唯一承载**；六项按序判定 | **无 Code 实现** | **无实现**（35 §13 亦未把它指派给 11 号的自动动作，属主控/Human 适用判据） |
| §8.4 候选成立五项 | 其中回指／引证／查重三项可机械核对 | `verifyEvidenceCopy`、`verifyDedupeRecord` | 三项有实现；分段质量属语义 |
| §8.5 反思触发与去向 | 四条触发信号、产出修订意见 | **无实现**（全库检索无承担者） | **无实现** |
| §8.6 经验不得取得规则效力 | 边界，不产生机械动作 | `createPitfallObject` 拒绝省略 status、拒绝直建 active | 有实现（结构性） |
| §14 验证表 | 各验证入口 | 见上两表 | 部分（§8.5 无入口） |
| §16 必停情形 | 领域触发的停止 | 部分落在 `failClosed` 路径 | 部分（语义类触发无机械判据，规范亦未要求） |

---

## 3. 真实运行痕迹

### 3.1 捕获段：**已实际运行**，有可回读痕迹

`~/.dsh/ldvh/idle-checkpoint-runs.json` 的逐任务结局（`per_task.experience-capture`）：

| 结局 | 次数 | 含义 |
|---|---|---|
| `landed` / `buffer-appended` | 多条 | 写入了一条缓冲条目并推进水位 |
| `landed` / `none` | 1 | 本次未观察到失败（如实登记的"无"） |
| `rejected` | 6 | 执行体未取得合格结论，已按 §8.3 入队登记 |

最近一次成功捕获：`2026-10-22T16:39:30.930Z`，`entry_id=7db75134-…`，
`watermark_advanced=true`，`watermark_turn=38`。

### 3.2 缓冲载体现状

```text
条目数          37
status 分布     { pending: 37 }
时间跨度        2026-10-20T18:44:46.604Z → 2026-10-22T16:38:43.339Z
anchor 含 '?'   3 条
```

- **37 条全为 `pending`**：无一条被审核段结算过。
- `anchor` 含 `?` 的 3 条（形如 `turn ?..2`）说明区间某端未取到位置——§12bis 要求
  `anchor` 是"使审核段能回指原始位置"的标识，该 3 条的来源位置**不完整**。

### 3.3 审核段：**未观察到任何一次运行**

| 观察项 | 取值 | 说明 |
|---|---|---|
| 空闲派发中是否调用审核段 | 否（`lifecycle.js` 零引用） | 只有 Human/主控显式调用 `ldvh_observation_buffer_review` 才会跑 |
| 最后一条 `draft` 的创建时间 | `2026-10-20T13:31:52.530Z` | **早于**两段式拆分提交 `f98cbd2`/`12f906f`（2026-10-21 13:40） |
| `2026-10-21` 之后新建的 `draft` | **0 条** | 那 16 条 `draft` 全部由拆分前的单段通道产生（`change_summary` 逐字为「闲时辅助经验积累（机械通道）…形成候选」） |

**结论**：审核段有代码、有测试、能跑通（见 §5 端到端验证），但**没有任何真实运行
证据**；缓冲里积压的 37 条待审核材料从未被消费。按 11 §17 条件式要求，**不得主张
「经验积累机制已运行」**——捕获段已运行，审核段未运行。

> **本节结论已于本次修复后被补上「原因」**：审核段并非"跑失败"，而是**根本没有
> 调度入口**。修复与验证见 §4.1（缺陷 ① 已处置）。

### 3.4 本次验收接触到的工具面事实

| 调用 | 返回 |
|---|---|
| `ldvh_observation_buffer_list` | 仅 `LDVH observation-buffer-list: completed` |
| `ldvh_observation_buffer_review` | 仅 `LDVH observation-buffer-review: completed` |
| `ldvh_read_specification_content`（本会话多次） | 仅 `LDVH read-specification-content: completed` |
| `ldvh_goal_read` | 完整 JSON（该层渲染器逐字段打印 `result`） |

同一批工具里，`goal-tools` 的渲染器会 `JSON.stringify(env.result)`，而
`ldvh-tools` 的渲染器只打印白名单字段——这是缺陷 ④ 的直接证据。

---

## 4. 发现与处置

| # | 缺陷 | 影响 | 处置 |
|---|---|---|---|
| ① | 审核段无空闲调度入口（11 §8 第 3 项未落成派发） | 缓冲只进不出：37 条 `pending` 永不被消费，两段式拆分的第二拍**从未真正运转** | **已修复**：接入同一检查点的第二拍（见 §4.1） |
| ⑦ | 留观缓冲对 Human **完全不可见**（Web 无任何呈现） | 积压看不出就等于没被发现：37 条待审核在界面上是一片空白 | **已修复**：诊断页呈现存在+数量+有限内容投影（§4.2、§4.3） |
| ⑧ | 留观缓冲**不按项目隔离**（全局单文件、条目无 project） | 在 A 项目审核会读到 B 项目材料，而 draft 写进 A —— **用别的项目的材料在本项目建经验**，且事后无法分辨归属 | **已修复**：载体按项目分文件（§4.4）；存量 47 条不迁移，只登记 |
| ⑨ | 捕获与审核共用同一个时机数值 | 无法「分开设置」；改一个会牵动另一个 | **已修复**：两种时机形态、两套设置（§4.5） |
| ② | `collectExistingPitfalls` 的 `truncated`／`comparable`／`invalid` 算出即丢，`verifyDedupeRecord` 三者都不看 | 分页截断、正文读不全或载体载入失败时，对**不完整对照集**判"覆盖全部 active 与 draft"通过 → 同机制可被写成第二条候选（23 §6.2 要防的正是这个） | **已修复** + 3 条护栏（见下方第 2 轮补漏说明） |
| ③ | `discarded` 的理由校验完即丢，交还面只剩一个 id | 11 §10.2 第 5 项要求"理由按 §17 在交还时如实披露"无法履行；下一位读者看不出丢弃是否成立 | **已修复** + 2 条护栏（理由走交还面，**不**写进条目——闭集不许扩张） |
| ④ | `renderEnvelope` 只打印白名单字段，`result` 整块丢失 | `read-specification-content` 正文不可见（调用方只能绕开受控读取入口改读文件）；两条 11 §12ter 公开操作的结果契约**在交付面上不可兑现** | **已修复** + 3 条护栏 |
| ⑤ | `observation-buffer.js` 头注释三处引用不存在的旧规范文件名（`specs/11-` 旧称「闲时辅助系统规范」，该载体已改名为「宿主辅助任务规范」） | 悬空引用使"权威来源"指不到任何文件 | **已修复**（3 处路径） |
| ⑥ | 3 条缓冲条目的 `anchor` 含 `?` | 来源位置不完整，§12bis 的 `anchor` 语义未满足 | **只登记**（历史数据，不改写） |

### 4.1 缺陷 ① 的修复：把审核段接进空闲派发

**接线位置**：`plugin/lib/lifecycle.js` — 在捕获段落地之后、运行痕迹写入之前，
`if (tasksForThisCheckpoint.includes("experience-capture"))` 时调用新增的
`runReviewStage(...)`。

**为什么必须另派生一次，而不是复用捕获段那次派发**（这是实施中最容易做错的一步）：

11 §10.2「审核段不得做的事」第一条是**不得读实时对话、不得引用缓冲之外的任何材料**。
捕获段那次派发的执行体**手里就有本次区间材料**（§7.1 机械交付给它）。若让它接着做
审核，等于把对话原文塞进了审核段——直接违反 §10 的共同硬约束，而且**产物上看不出来**。

故审核段单独派生一个零上下文执行体，输入**只有**缓冲条目投影与查重对照集。
机械保障：`experience-review-dispatch.js` 的 `buildReviewPrompt` 入参里**没有**任何
会话材料通道；测试 `提示词不得含任何对话材料——审核段只读缓冲` 断言提示词中
不存在 `^user:` / `^assistant:` 行。

**为什么不是新增一个任务键**：11 §8 明写「捕获段与审核段可以在同一次空闲派发内先后
执行……**不是新增一个任务类型**」。给 `AUX_TASK_ORDER` 加键会把两拍做成两件，并同时
改动复合 schema 的字段集。故按「同一检查点内先后两拍」实现。

**新增文件**：`plugin/lib/experience-review-dispatch.js`（派发侧，语义判断由执行体做、
落地仍交 `observation-review.js` 的六项闭集）。

**stage 派生的连带修正**（实施中发现并修掉的两个真缺陷）：

| 问题 | 后果 | 修法 |
|---|---|---|
| 审核段若记成独立 per_task 键 | `per_task` 里出现 `tasks` 中不存在的名字，读者分不清「两件之一」还是「一件的第二拍」 | 记作 `taskOutcomes["experience-capture"].review` |
| `stage` 只看外层 `outcome` | 捕获段本次无结论、而审核段真的形成了候选时，整轮被判成 `land-failed` —— **谎报** | `stage` 派生把第二拍一并计入；`not-dispatched`／`skipped` 不计入分母 |
| 注释里含调用字面量 | 接线测试按括号文本切片，注释中的字面量被误认成调用点，两处断言同时失败 | 注释改为不含该序列的措辞 |

### 4.4 缺陷 ⑧：留观缓冲**不按项目隔离**（本次最严重的一处）

**发现过程**：核查「是否需要独立的审核间隔设置」时，顺手看了缓冲载体的分布，才发现的。

**事实**（实测 2026-10-24）：`~/.dsh/ldvh/observation-buffer.jsonl` 是**全局单文件**，
45 条来自 **11 个不同会话**，而条目字段闭集里**没有 project**。把它回溯到项目目录：
43 条属 `dsh-ldvh`，**4 条定位不到任何项目**（会话记录已不在）。

**后果链**（这才是严重的地方，不只是数据卫生）：

1. 在 A 项目跑审核段 → `readBufferEntries` 无项目过滤 → 读到**所有项目**的材料；
2. `draft` 写进的是**当前**项目的 `ldvh-base/`；
3. 两者叠加 = 「用 A 项目的材料在 B 项目建出一条经验」；
4. 且该经验一旦进 `draft` 就带 B 项目的 `change_log`——**事后从内容上分辨不出**它原本属于 A。

**修法（不改规范）**：§12bis 明文「载体与位置……位于事实源目录之外；**其具体路径与载体
形态由实现侧承接**（改变载体或位置不改变本契约）」。故按项目分文件即可，**不必动字段闭集**：

```text
旧（全局单文件）  ldvh/observation-buffer.jsonl
新（按项目）      ldvh/buffers/<项目目录名>/observation-buffer.jsonl
```

目录名 = 路径可读化（非法字符换 `-`）+ **SHA-256 前 10 位**。加哈希并非装饰：测试发现
`/Users/a/My Project/alpha`、`/Users/a/My-Project/alpha`、`/Users/a/My_Project/alpha`
三者只做字符替换会归一到**同一目录**——那等于让三个项目共用一份缓冲，正是本次要消除的
形态。这是测试抓出来的真 bug，不是预设的保险。

**防漏传的机械护栏**：`projectRoot` 在各入口是**必填**——缺它即明确拒绝
（`capture/project_root_missing`、`observation_review/project_root_missing`、
`review_dispatch/project_root_missing`），**不静默落到全局载体**。「形参存在但调用方忘了传」
是本仓库反复登记的失效形态，故另加一条**源码级护栏**：扫描 `lib/` 下所有缓冲 API 调用点，
凡未出现 `projectRoot` 即失败；并配一条元测试确认该护栏本身能识别漏传（防「护栏假绿」）。

**存量处置（未做，如实登记）**：47 条存量**不自动迁移**。实测归属：43 条属本项目、
4 条无法归属。迁移需要按会话反查项目，而「无法归属」那 4 条没有可判据的归属——
擅自塞进本项目就是伪造归属。故旧载体保持原样，留待 Human 决定。

### 4.5 缺陷 ⑨：捕获与审核共用一个时机数值，无法分开设置

**触发**：Human 明确「这本来就是两件事，一个是对话结束捕获，一个是自动的审核捕获，
所以要分开设置」。

**规范依据**（两者本就可分，是原实现没分）：
- §8 第 2、3 项是**两项职责**；
- §6.1 给了两种时机形态，用途分别点名：形态 1「一次延迟」用于「一段对话结束后执行一次」，
  形态 2「固定间隔」用于「在固定会话中周期性执行」；
- §6.1 明文「**延迟时长与间隔的数值由实现侧承接**，本规范不内嵌、不为其指定配置载体」——
  故各配一个设置项**不改规范**。

**实现**：

| 面 | 捕获 | 审核 |
|---|---|---|
| 时机形态 | 一次延迟（回合结束 + 空窗） | 固定间隔（周期） |
| 设置项 | `idleSilenceMs`（既有） | `experienceReviewIntervalMs`（新，缺省 60 分钟） |
| 开关 | `experienceCaptureEnabled` | `experienceReviewEnabled`（新，缺省**关**） |
| 宿主任务 | 绝对时刻 `{kind:"at"}`，标签 `session-silence` | 周期 `{kind:"every"}`，标签 `experience-review` |

**审核不是一个任务类型**：11 §8 明写两段「不是新增一个任务类型」，故 `AUX_TASK_ORDER`
**不加键**；审核是独立时机驱动的第二拍。已有护栏断言这一点。

**一处规范内部的紧张，处理方式如实记录**：§6.1 说「回合进行中**本任务不得派发**」并由
§6.3 独立保障；而 §6.3 说固定间隔形态下「**无此项二次确认**，不判空窗」。照字面，周期到期时
若正在对话就会派发。**实现的选择：仍强制「有回合在跑就不派发」**（跳过本次并记账）——
§6.3 是不要求那道确认，不是禁止多加一道。下一个周期自然会到，周期任务常驻，不存在
「错过即永久丢失」。

**连带修掉的一个既有缺陷**：`schedule()` 的 `create` 只传 `{ at }`，**缺 `kind` 判别式**
（宿主规则是带判别式的联合）。`update` 路径一直是对的，故该缺陷只在**首次创建**时命中，
而症状隐蔽——「没触发」与「没武装」外观相同。由本轮新测试发现并修正。

**另一处连带**：`client.js` 里被删除的 `idleSilenceOk` 成为未使用函数，**eslint 报错**，
而该报错进入 Git Gate 的 preflight，使**整个仓库的 hook 测试全部失败**（19 条）。
这轮是「我改的代码让 lint 挂掉、进而让不相关的测试挂掉」——记在这里是因为它说明
Git Gate 的 lint 检查确实在拦，且本地跑全套测试能提前暴露，不必等到提交。

### 4.3 缺陷 ⑦ 的**二次修订**：从「只给数量」改为「有限可见」

**触发**：缺陷 ⑦ 的第一版按当时规范只呈现存在与数量。Human 指出「很难直观感受到」——
这不是体验偏好，而是**可观测性缺口**：本次验收里那 37 条积压，是靠直接读 JSONL 才发现
的，界面上完全空白；若没人去读文件，「缓冲只进不出」会一直藏着。

**因此先改规范，再改实现**（顺序不可颠倒）：

| 文档 | 改动 | 依据 |
|---|---|---|
| `specs/11` §12bis 读取纪律第 2 条 | 新增「Human 感知视图」：除存在与数量外，可呈现**有限投影**，并附六条机械限制 | 经 **§19.1 第 4 项**（载体契约变更；按 2026-10-20 建立 §12bis 时的同一归口） |
| `specs/11` §19.1 第 4 项 | 增加 2026-10-24 的归口记载 | 该条既有体例：每次修订在此留痕 |

**六条机械限制（规范原文要点）**：
1. 只可呈现 `phenomenon`／`at`／`anchor`／`status`；
2. 不得呈现 `evidence`（引证最易被当证据引用）、`candidate_question`（未核对的问题会被当成待办）；
3. 不得赋予对象身份（不呈现 `id`、不提供 `canonical_path`、不提供跳转或反查通路）；
4. 不得提供外带通路（不导出、不复制为证据、不进检索索引）；
5. 须逐处标注「待审核材料 · 非事实 · 不可作为依据」；
6. 只可在运行状态呈现（诊断面）出现，不得与事实对象混排。

**让步边界**：规范正文已明示——只放开「人可感知内容」这一层，**不放开**「条目可被消费为
事实或依据」；机械能保证界面不提供引用与反查通路，**不能**保证读者不把所见当作已知，
该残余风险由规范明示承担。

**实现对应的结构性保障**（不是靠自觉）：
- API 层**逐字段白名单**（`bufferEntries.push({ phenomenon, at, anchor, status })`），
  **不整体透传**载体行——故未来载体新增任何字段都不会自动外露；
- 类型上 `IdleReport` 的条目就没有 `id`／`evidence`／`canonical_path` 字段，页面**没有可用字段**去违反；
- 只投影 `pending`，按 `at` 升序（与审核段处理序一致），上限 30 条并给出总条数。

**验证**：真实缓冲数据上跑投影——45 条全 `pending`、投影字段名恰为
`[phenomenon, at, anchor, status]`、禁止字段泄漏检查「否」、按升序展示最旧 30 条。

**测试口径的一处修正（值得一提）**：新护栏最初按「字样出现」断言 `evidence` 不得出现，
结果**正确的实现反而被判失败**——因为注释里写着「不得含 evidence」。改为按**字段形状**
（`<名>:` / `<名>?:`）断言后通过。这是测试自身的缺陷，不是实现的问题；照原样改实现去迎合
测试，会把注释删掉而留下错误的判据。

### 4.2 缺陷 ⑦ 的修复：留观缓冲对 Human 可见

**改动**：`plugin/web/api/routes/diagnostics.ts`（`/api/diagnostics/idle` 增加
`observationBuffer` 段）、`Diagnostics.tsx`（`IdlePanel` 增加一块）、`locales.ts`（中英各 8 条）。

**口径**：严格按 11 §12bis 读取纪律第 2 条——「Human 查阅入口**只可展示其存在与
数量**（属运行状态呈现，**不构成事实读取**）」。故只回：

```text
carrierExists / total / liveTotal / capacity / atCapacity
invalidRows / byStatus / pending / oldestPendingAt / note
```

**刻意不回的**：`phenomenon`／`evidence`／`candidate_question`（内容）、`id`／
`session`／`anchor`（能用来反查内容）。哪怕只回 `id`，Human 也能拿它去别的入口取
内容——那样缓冲事实上就成了「第二个事实库」，正是 §12bis 开头点名要防的。

**一个实施中修掉的坑**：最初想复用 `readJsonLines` 统计，但那个辅助函数**静默跳过
坏行**（对 append-only 队列是合理处置）。沿用它会令 `invalidRows` **恒为 0**，
「有坏行」永远看不见——等于把「读得出几条」说成「有几条」。改为自己解析并单独计数。

### 修复明细

| 文件 | 改动 | 依据 |
|---|---|---|
| `plugin/lib/ldvh-tools.js` | `renderEnvelope` 增 `result` 整体输出（`content` 逐字原样，其余 JSON） | 05 §8 最小共同响应语义 |
| `plugin/lib/observation-review.js` | `collectExistingPitfalls` 用非枚举属性携带 `truncated` 与 `invalid`；`verifyDedupeRecord` 校验 `truncated`、`comparable=false` 与载入失败的载体；`state.discarded_reasons` 随结果交还 | 23 §6.2、11 §10.2 第 5 项、§17 |
| `plugin/lib/observation-buffer.js` | 3 处失效规范路径改为 `11-宿主辅助任务规范.md` | 01 §10.3 受控读取 |

#### 第 2 轮复核补漏（缺陷 ② 的第三面）

第一轮修完 `truncated`／`comparable` 后，复核发现同一失效面还有第三成因：**载入
失败的载体根本不在对照集里**。`listPitfallObjects` 把 frontmatter 解析失败、status
越界、读不开的文件单列进 `invalid`，这些文件不进 `items`——于是它们既不被「覆盖
全部」的 `missing` 判定发现，也不出现在任何比对中。后果与截断完全相同：一个坏掉的
既有经验载体，其机制不在对照集内，同机制可被写成第二条候选。

修法：`collectExistingPitfalls` 同样把 `invalid` 附到数组上，`verifyDedupeRecord`
在 `invalid` 非空时拒绝并点名文件与原因。**这是拒绝而非警告**——理由与截断一致：
23 §6.2 不允许把未加载的载体算作已比对。

**误伤检查（已做）**：本项目自身对照集实测 39 条（active+draft）、`invalid` 为空、
`comparable=false` 为 0，故该守卫不会挡住真实项目的正常评审。

### 修复后新增护栏（21 条 + Web 7 条）

```text
test/ldvh-tools.test.mjs
  - renderEnvelope: result 必须随响应到达调用方（05 §8 最小共同响应语义）
  - renderEnvelope: read-specification-content 的正文逐字可达（01 §10.3 受控读取入口）
  - renderEnvelope: 结果为空时不得凭渲染虚构内容
test/observation-review.test.mjs
  - 第 2 项：对照集被分页截断 → 拒绝（不得把 partial page 当作完整对照集）
  - 第 2 项：既有对象正文读不全 → 拒绝（comparable=false 不得计入「已比对」）
  - 第 2 项：既有载体载入失败（invalid）→ 拒绝（不在对照集里的对象不得算作已比对）
  - 第 5 项：理由不得写进缓冲条目——字段闭集不因披露要求而扩张（§12bis）
test/experience-review-dispatch.test.mjs（新增 14 条）
  - 提示词不得含任何对话材料——审核段只读缓冲（§10.2 共同硬约束）
  - 提示词把查重对照集交给执行体，且明确要求覆盖每个 uid（23 §6.2）
  - 提示词说明边界：只判形态、不判价值、不判四前提（23 §16.1）
  - 输出 schema 是封闭形状
  - 缓冲不可读 → fail-closed，不派发、不降级为空集合
  - 没有 pending 条目 → 合法的 skipped，不派生执行体
  - 无零上下文 provider → fail-closed，绝不回落（§7.1 全量交付禁止）
  - 执行体未正常收束 → fail-closed，不伪造结论
  - 执行体没有给出 proposals → fail-closed
  - 派发把 pending 条目与查重对照集一并交付
  - 派发条目数受上限约束，未处理的留在缓冲里
  - 上限是模块常量，入参不得放大
  - entryId 指定时只审那一条；不在 pending 里即 fail-closed
  - 缺 factSourceRoot → fail-closed
web/tests/api/diagnostics-idle-buffer.test.ts（新增 7 条）
  - 只呈现存在与数量——不得把条目内容带进任何字段
  - 须呈现「多少条待审核」与「积压多久」
  - 坏行须单独计数，不得被静默跳过
  - 容量口径与实现一致（只数在管条目）
  - 须带性质说明，使读者知道它不是事实
  - 容量常量与缓冲实现一致（200）
  - 载体路径与实现一致
```

第 1 条护栏刻意用一个**渲染器不认识**的字段名（`domain_specific_field_unknown_to_the_renderer`）
断言它不得消失——白名单式渲染正是缺陷 ④ 的成因，只钉住当前几个字段名防不住下一次。

---

## 5. 端到端验证（本次实跑）

在临时事实源上以真实代码跑通审核段六项闭集（不触碰本项目 `ldvh-base/`）：

```text
写入缓冲条目    entry = fe81b5b0-878f-4bef-826e-9d224ba3a870
查重（空对照集）dedupe.checked=true, compared=[], conclusion=new
形成候选        object_uid = 7f3c2e07-b74c-4b1f-bed6-169125519d6d
draft 回读      status=draft, body_valid=true
条目结算        status=consumed
```

- 生成的 `draft` 正文七段齐备，且**不含** `buffer:<id>` 形式的唯一引用（逐字引证已复制）。
- `discarded` 路径另行验证：条目置 `discarded`、`consumed_by=null`、
  `discarded_reasons` 带回理由，且条目**未新增**任何闭集外字段。

**这次实跑证明的是**：审核段代码能按六项闭集产出合规候选并正确结算条目。
**它不证明**：该候选在语义上确实是"已验证的失败机制"（那是 Human 与另一主体
复现验证的事，23 §16.1）。

### 5.1 在真实数据形状上的复跑（防误挡）

修复 ② 新增了三道查重前置（截断／不可比／载入失败）。为确认它们不会挡住正常工作，
把本项目真实 `ldvh-base/` **复制**到临时目录（只读真实源，绝不写它），在其中跑一次
完整评审：

```text
真实形状对照集    39 条（active+draft）| invalid: 0
评审结果          通过（未被误挡）
draft 回读        status=draft, body_valid=true
条目结算          status=consumed
```

这一步同时验证了两件事：① 真实项目的对照集是干净的，三道前置都不会触发；
② 前置通过后，完整链路（建 draft → 回读 → 结算）在真实数据形状上照常工作。

### 5.2 修复 ① 的端到端验证：派发 → 提案 → 六项闭集 → draft → 结算

用**假 subagents 服务**回放一份合规提案（真实代码走完派发与落盘两条链），在空的
临时事实源上跑一遍冷启动：

```text
① 缓冲写入     entry = fd3155ba-1fea-4d27-8123-29a805f0f559
② 派发         提案 1 条（零上下文派生，输入只有缓冲投影 + 空对照集）
③ 形成候选     object_uid = 9d3b628f-9287-4a7e-8133-93ee2013655f
④ draft 回读   status=draft, body_valid=true
⑤ 条目结算     status=consumed, consumed_by 已指向该 draft
```

**证明的是**：接上派发后，从「缓冲里有 pending 条目」到「账本里多一条 draft、条目
被结算」这条链**在代码层面是通的**——这正是修复前缺的那一环。
**不证明的是**：真实宿主静默期会不会按预期触发它（须重载后观察），以及形成的候选在
语义上是否确属「已验证的失败机制」（那是 Human 与另一主体复现验证的事，23 §16.1）。

---

## 6. 未验证范围（如实登记）

1. **审核段**（修复后）**仍未在真实空闲派发中被观察到运行**——派发链路已接上，且用
   假 subagents 端到端跑通了「派发 → 提案 → 六项闭集 → draft → 结算」全链（§5.2），
   但**真实宿主派发**需重载插件后由下一次安静期触发才会发生。本报告**不**声称它已在
   真实工作流中运转。
2. **37 条积压条目未被审核**——其中哪些构成候选、哪些应 `discarded`，本次未作判断；
   那需要逐条语义判断，且属审核段（或 Human）的职责，不是验收的产出。
3. **§8.3 分流路由与 §8.5 反思机制无 Code 实现**——本报告只登记该事实，未评价其
   是否应当有 Code 实现（35 号把分流指给主控/Human，把反思指给 11 号的触发纪律；
   这两处是否该由插件承担属方向问题，见 §7）。
4. **UI 面只做到「源码 + 接口 + 构建」三层验证，未在真实浏览器中目视核对**：
   - 收件箱（Pitfall `pitfall_confirmation`）：**已请求真实接口核实**——16 条 draft
     全部呈现，字段齐（`object_uid`／`id`／`title`／`canonicalPath`／`relativeTime`）。
   - 留观缓冲新块（修复 ⑦）：已改源码、`tsc -b` 通过、`pnpm build:dsh` 成功、
     7 条契约测试通过；**但当前运行中的 GUI 加载的是已安装的插件版本，不是本工作树**
     ——故界面上**尚未看到**这一块。须重载插件后刷新页面才能目视确认。
   - 这一条是本次如实登记的**主要残余未验证面**。
5. **Windows 平台未验证**——本报告全部结论取自 macOS。
6. **修复 ④ 后的真实工具返回面未复核**——修复在 `plugin/lib/`，需宿主重载插件后
   才能在新会话里观察到新的返回形状。本报告证明的是**渲染器输出**（可直接单测），
   不是**宿主送达**。
7. **3 条 `anchor` 含 `?` 的历史条目未修复**——属历史数据，按只追加纪律不改写。

---

## 7. 待复核的处置（原「待 Human 决定」，多项已按指示实施）

### 已实施、待你确认

1. **缺陷 ① 已按「同一检查点内的第二拍」实现**（不是新任务类型）——依据是 11 §8
   原文：「捕获段与审核段可以在同一次空闲派发内先后执行……**不是新增一个任务类型**」。
   按此读法，把已登记的职责接上调度**不构成** §19.1 第 1 项的「职责构成新增/删除/改名」，
   故未走该 Gate。**但这是我的读法，须你确认**：若你认为「接上调度」本身即属职责
   构成变更，则应回退并走 §19.1 第 1 项。
2. **缺陷 ⑦（留观区可见）已实现**——严格只呈现存在与数量（11 §12bis 读取纪律第 2 条）。
   你能在诊断页看到「待审核 N 条 / 在管 x / 容量 200 / 最旧一条何时提交」，
   但看不到任何条目内容。**若你希望看到条目内容，那需要先改规范**——现在的实现
   是照规范做的，不是漏做。
3. **缺陷 ②③④ 的修复是否接受并入 `dev`**——四处都是实现向规范的回正（非放宽校验）。

### 仍待你决定

4. **37 条积压条目如何处置。** 全为 `pending`。**更正**：早先报告的「最早一条已 31 天、
   临近淘汰」是**我的计算错误**（把 10-20 当成 09-20）。实测最旧条目
   `2026-10-20T18:44:46Z`，距今 **2 天**，**没有淘汰压力**。
   但仍有一个真问题：这 37 条是**修复前积压的**，审核段接上后它们会被逐个处理；
   其中哪些能成文、哪些应 `discarded`，属审核段的语义判断，不是验收产出。
5. **§8.3／§8.5 无 Code 实现是否构成缺口。** 35 号 §8.3 把分流路由定为"唯一承载"，
   但未规定它必须有 Code 实现；§8.5 的反思触发明定经宿主自动化机制承载（§17 第 5
   条红线）。本次只登记"无实现"，**未**主张这是缺陷——是否落成属方向决定。

---

## 8. 交付物

| 文件 | 说明 |
|---|---|
| `specs/11-宿主辅助任务规范.md` | §12bis 读取纪律第 2 条修订（Human 感知视图）+ §19.1 第 4 项归口 |
| `plugin/lib/experience-review-dispatch.js` | **新增**：审核段派发侧（零上下文派生、输入闭集、fail-closed） |
| `plugin/lib/lifecycle.js` | 接线：同一检查点第二拍 + 两种时机分流 + `stage` 派生 |
| `plugin/lib/observation-buffer.js` | **按项目隔离**（载体路径 + 哈希防碰撞）、`projectRoot` 贯穿 |
| `plugin/lib/observation-review.js` | 缺陷 ②③ 修复；`projectRoot` 必填 |
| `plugin/lib/experience-landing.js` | 捕获落地 `projectRoot` 必填 |
| `plugin/lib/host-schedule.js` | **周期通道**（`scheduleEvery`／`removeReview`）+ 修 `create` 缺 `kind` |
| `plugin/lib/triggers.js` | 两条投递的识别与分流、`armReviewTask`／`syncReviewTask` |
| `plugin/lib/idle-settings.js` | `reviewEnabled` + `limits.reviewIntervalMs`（与静默时长分开） |
| `plugin/lib/index.js` | 两个新配置键（含 `.min(1)` 拒绝 0） |
| `plugin/lib/client.js` | 设置面：独立审核开关 + 审核间隔（分钟），提交与回填 |
| `plugin/lib/ldvh-tools.js` | 缺陷 ④ 修复；缓冲路径按项目回指 |
| `plugin/web/api/routes/diagnostics.ts` | 留观区计数 + 有限内容投影（四字段白名单） |
| `plugin/web/src/pages/Diagnostics.tsx` | 留观区展示（无链接、无导出） |
| `plugin/web/src/utils/api.ts` | `IdleReport.observationBuffer`（类型上就没有内容泄漏位） |
| `plugin/web/src/i18n/locales.ts` | 中英文案 |
| `plugin/test/*` | 新增 4 个测试文件；多个既有测试按新设计更新 |
| `docs/acceptance-experience-accumulation-2026-10-23.md` | 本报告 |

**验证状态**：`plugin` 1856 例 / 1855 通过 / 0 失败；`web api` 527 例全通过；
`tsc -b` 与 `npx eslint .` 均退出码 0；`pnpm build:dsh` 构建成功。

**改动未提交。** 受控提交须走 09 号 Git Gate（`ldvh_precheck_git_commit`）。

**重载后方可目视确认的两项**：缺陷 ④ 的真实工具返回形状、留观区新块。
当前 GUI 加载的是已安装版本，不是本工作树。

---

## 9. 残余风险：一次未能复现的失败（如实登记 + 已做排查）

在最后一次全量运行中，曾出现 `tests 1834 / pass 1832 / fail 1 / skipped 1`。随后做了
**9 轮**复跑，全部通过（其中 1 轮在 **6 倍 CPU 负载**下进行），**始终未能复现**。

**为什么没能定位到具体是哪一例**：当次运行的逐例输出被我的汇总命令过滤掉了
（只留下 `ℹ` 汇总行）。这是我的操作失误——排查偶发失败时本应保留完整输出。

**已做的排查（有确定结论的部分）**：

| 排查项 | 结论 |
|---|---|
| 是否我引入 | **不是**。含真实定时器的四个文件与 `dev` 分支**逐字未变** |
| 是否测试读了真实 `~/.dsh` 而被宿主写入干扰 | **不是**。全部测试都注入临时 home 路径 |
| 是否负载导致超时 | **未能复现**。6 倍 CPU 负载下仍全绿 |

**结论**：一个**观察过一次、无法复现、未能归因**的不稳定因素。本次验收**不排除**它：

- 它**不影响**本次任何一条结论的证据链——每条结论的依据是代码位置、真实数据取值或
  针对性单测，不是「全套通过」这个汇总数；
- **若它再次出现**，先保留完整逐例输出再判断。不要用「重跑就绿了」当成通过。

> **附记（2026-10-24）**：后来出现过一次**成批失败**（19 条 hook 测试），原因已确定且
> 不是偶发——是我删除 `idleSilenceOk` 后留下的未使用函数让 `eslint` 报错，而该报错进入
> Git Gate 的 preflight，使所有 hook 相关测试同时失败。已修正。这说明**这批测试对 lint
> 状态敏感**：将来若再出现「hook 测试成批失败」，先查 `npx eslint .`。
