# 独立审核报告：闲时辅助「一次派发做多件事」规范修订与配套实现

审核者：独立审核者（与起草者不同上下文）。审核时间：基于当前 dev 分支工作树稳定状态。
审核对象与范围：`specs/32-记忆存取系统规范.md` §10.2/§10.6 修订，及下述未提交实现。

---

## 一、对象 / 基线 / 方法

- **对象**：A. `specs/32-记忆存取系统规范.md` §10.2、§10.6（git diff HEAD）。B. 未提交实现：`plugin/lib/aux-task-registry.js`（新增）、`idle-settings.js`、`friction-subagent-contract.js`、`friction-discovery-provider.js`、`idle-checkpoint.js`、`lifecycle.js`、`agent-lifecycle.js`，及关联测试、`web/src/components/Sidebar.tsx`。
- **基线**：`git diff HEAD`；对照规范 `specs/01 §7.2/§12/§13`、`specs/04 §8.3/§8.4/§8.5/§14`、`specs/00 §4/§5.7/§6` 原文。
- **方法**：通读全部改动文件与相关规范原文；逐条核对风险点；grep 全仓悬空引用；运行 `npm test` 与 `npx eslint`；构造拒绝性场景（mock 子代理探针）实测行为。**未修改任何文件**。

**重要过程事实**：审核期间实现文件被**并发继续编辑**（`friction-discovery-provider.js` 在我的第一次读取为 376 行含「`primary` 失败即 `throw` 并挂 `error.partialTaskResults`」，稳定后发现盘上为 392 行「不抛错、以 `failedTasks`/`outcome:null` 如实返回」的设计；测试与注释随之更新）。因此我以**最终稳定状态**（哈希已多次复核不再变化）为准，但会保留对「最初 read 到的中间态」的价值说明（见发现 F2），因为它恰好是被修复的问题的原始形态。

---

## 二、覆盖 / 未覆盖

- **覆盖**：规范修订语义、任务登记表与拼接、复合 schema、逐任务校验、fail-closed 编排、生命周期落地、水位推进、Web 导航、全部相关测试、循环导入、悬空引用、eslint、全量测试、拒绝性场景。
- **未覆盖**：未实跑宿主（无法验证 `outputSchema` 提交层与 provider 列表的真实可用性——按代码注释，讲的是实测既有事实；我只能核验代码路径与既有测试）；`Sidebar.tsx` 是无关的导航项排序改动（research 提前到 adr 前），与本次改动无关，属工作树里的并发现象，未纳入审核结论。

---

## 三、验证命令与结果（实际跑过）

| 命令（均在 `cd plugin`） | 结果 |
|---|---|
| `npm test`（全量 1383 条） | **1383 pass / 0 fail** ✅ |
| `node --test test/friction-discovery-provider.test.mjs`（单独） | 25/25 pass ✅ |
| `npx eslint <本次变更的全部 js/mjs>` | 0 error 0 warning ✅ |
| `git diff HEAD` 各文件逐一核读 | 见发现 |
| grep 全仓 `轮换/HEALTH_CHECK/rotation/selectAuxTask/auxRotation/pickEnabledAuxTask` | 仅注释与废止条款，**无活引用** |
| grep `partialTaskResults` | 仅一处注释，已废弃该路径 ✅ |
| 拒绝性探针（mock 子代理）：structured 缺失 / verdict=unknown target_uid | 均**不抛错**，返回 `{outcome:null,failedTasks,taskResults}` ✅ |

---

## 四、发现

### 规范部分

**S0. §10.2 标题仍标「候选设计，待审核确认」，与正文「Human 决定 2026-10-11」自相矛盾（应修项）**
- `specs/32-记忆存取系统规范.md:381` `### 10.2 空闲触发表达（候选设计，待审核确认）`。
- 文件顶部 `:22` 已定义「『候选设计』标注均指尚未经独立审核与 Human 确认的设计内容」；而 §10.2 正文（行 390-395）明确写入「同一次空闲派发一并执行（Human 决定 2026-10-11）」，并以限期规则陈述派发模型。
- 于是同一载体内：正文以「已定」的口吻陈述「Human 决定」，标题却标记「待 Human 确认」。不改会导致：§10.2 的「按任务分别处置」等新增规则被读成**仍无规范效力、可继续变更的候选**，而实现却已把「勾选几件做几件」当作既定语义落地（`idle-settings.js`、`registry`、`lifecycle` 的注释与行为均以「决定」为准），出现「规范效力 vs 实现依据」错位。建议：若本次 Human 决定即视为对派发模型的确认，则移除/吸收该标注；否则不要在正文写入「Human 决定」的完成时态。§10.5 的同类标注（行 406）因 memory-health 仍未实现，保留是自洽的，不构成问题。

**S1. 与 §6.1 第 4 项「维护预算成立」的冲突——已妥善化解，不构成矛盾 ✅**
- `specs/32:392` 明确区分「派发次序上的预算」（已取消）与「各任务自身的作业限额」（§10.3、§10.4、§6.1 所指，照旧成立）。这是对「§10.2 取消预算会与 §6.1 预算冲突」最有针对性的预先澄清，行文严谨。**无冲突。**

**S2. 与 §10.3「每次至多一条变更提议」、§10.4「单次整理上限」——无冲突 ✅**
- 同上，`specs/32:392` 已显式列出二者不受影响。§10.3/§10.4 未被改动，遗漏该承诺。

**S3. §10.6 与 §10.2 一致性——一致 ✅**
- 均采用「按任务分别成立」的处置；§10.6（行 421-424）与 §10.2（行 393-395）措辞呼应。条件式要求与独立处置两处自洽。

**S4. 状态陈述（01 §7.2）——基本合规，个别措辞贴近边界（建议项）**
- 新条款多处以「属实现现状，按 01 §7.2 由读取时的观察取得，本条不陈述其当前状态」自证合规（行 388、424），并统一改用条件式要求形态，是规范书写上的正面实践。
- 边界个案：`specs/32:393`「尚未实现（能力本体不存在）」的「能力本体不存在」读起来像现状断言。细读是在定义「尚未实现」这一**处置类别**（与「Human 明示停用」作对照规则），属 01 §7.2 允许的「假设/定义」形态，我认为合规，但建议把措辞改成「能力本体按实现现状尚不具备」，避免被机械扫描判为状态。

**S5. 可机械判定性——部分无实现支撑（应修项，见 M3）**
- 「被停用」与「尚未实现」两类处置的区分是**可判定**的（`implemented:false` 是登记表权威字段，`splitRunnableTasks` 机械分派）。
- 但「须在运行痕迹中如实登记为未执行」——「运行痕迹」是否指持久化 runlog 不明确，且实现里**持久化 runlog 并不写入"已启用但未实现"的完整清单**（见 M3）。这句在规范层面是义务、成立；在机械实现层面未闭环。

### 实现部分

**M1. 「某任务失败不使其余任务失效」的承诺——当前单任务下成立；未来多任务下仅在落地层成立，提交层有结构性缺口（应修项/不确定点）**
- 现设计（`friction-discovery-provider.js:325-357, 359-390`）对**落地侧跨字段校验**逐任务收口，失败任务不抛错，如实返回 `failedTasks`/`taskResults`；`lifecycle.js:514-535` 对每个失败任务逐条 `appendPendingEntry`，且 `verdict==null || failedTasks.length>0` 时不落地。已成功任务在单任务现实下就是 idle-review 本身，语义自洽。**这是对最初「throw + error.partialTaskResults 无人消费」缺陷的实质性修复**（该原形态已从盘上删除，仅剩注释存证 `provider:339`）。✅
- **结构性缺口（未来多任务）**：复合 schema（`aux-task-registry.js:144-162`）用 `additionalProperties:false + required 列出全部任务键`，且宿主在**提交层**一次性拦截整个对象。于是若某任务字段缺失/枚举越界，宿主 reject **整份提交**——`result.structured` 拿不到，其余任务哪怕结论正确也**不会落地**（`provider:298-302` 会以 incomplete_run 入队整次失败）。即「某任务的『结论缺失』使其余任务失效」——这恰是 §10.2 明文禁止的。当前只有 idle-review 一个任务，该路径**不可触发**；但规范把该保证写成无条件规则，而**单对象复合提交的 schema 结构无法在提交层兑现**。代码注释只登记了「多任务水位重覆盖会重复落地」的残留风险（`provider:376-380` 自述「当前不可达」），**没有**登记「提交层整单 reject 会掀翻其余任务」这一同样不可达但方向更严重的缺口。建议：在 `aux-task-registry.js`/`provider` 注释里把两条都登记为「第二任务落地前必须解决」的开放项；或在规范 §10.2 把该承诺限定为「落地侧校验不使其余失效」（严格照实现的语义措辞）。

**M2. 循环导入 / 未声明标识符 / implemented:true 缺校验——无问题 ✅**
- `aux-task-registry.js → friction-subagent-contract.js` 单向；`friction-subagent-contract.js` 仅引 `friction-window.js`，无回环。`buildDiscoveryPrompt` 内联拼接以规避 `registry↔contract` 回环（`friction-subagent-contract.js:252-255` 有显式说明）。
- `eslint` 全绿 → 无未声明标识符、无未用变量（含曾报的 4 处均已消解）。
- 唯一 `implemented:true` 项 `idle-review` 具备 `promptSection+outputSchema+validate` 三部位（`aux-task-registry.js:224-235`），`validate` 启动于 `validateCompositeOutput`（`provider:314-319`），确有校验步骤。无「implemented:true 却无校验」的登记项。

**M3. 「已启用但未实现」的持久化登记缺环（应修项）**
- 语义分流正确：`pickEnabledAuxTasks`（`idle-settings.js:313-328`）返回全部已勾选任务（含未实现者）；`splitRunnableTasks`（`aux-task-registry.js:260-268`）产出 `{runnable, unimplemented}` 两半；`idle-checkpoint.js:102-108`/`runIdleCheckpoint` 返回 `unimplemented`。
- 但**持久化 runlog**（`lifecycle.js:646-663` 的最终 `recordRun`）只写 `task: tasksForThisCheckpoint[0]`，**不带 `tasks` 清单、也不带 `unimplemented`**。混合勾选（idle-review 开 + capacity 勾但未实现）时，runlog 只有 `task:"idle-review"`/`stage:"landed"`，**capacity「已启用但未执行」不出现在持久化 runlog**。它只出现在记忆态 activity 记录 `session/checkpoint`(`lifecycle:670` 带 `tasks`)与 `unimplemented` 返回值里。
- 反例实测逻辑：当 idle-review 关闭、仅 capacity+memory 启用 → `checkpoint.outcome="not-implemented"` → `stage:"not-implemented"`，但仍只记第一个任务名 `capacity-maintenance`，**memory-health 未实现的信息不进 runlog**。
- 结论：§10.2「须在运行痕迹中如实登记为未执行」在**持久化运行痕迹**层面未闭环。若「运行痕迹」以 runlog 为准，这是实的缺环；若以 activity 事件为准则勉强成立。建议在最终 `recordRun` 补 `tasks`/`unimplemented`，或明确定义「运行痕迹」口径。

**M4. 悬空引用清理——彻底 ✅**
- `selectAuxTask`/`HEALTH_CHECK_PERIOD`/`auxRotation`/`pickEnabledAuxTask` 全仓仅出现于注释与废止说明；`lifecycle.js`、`agent-lifecycle.js`、`web` 均无活引用；测试中相关旧用例已删除并注明（`idle-checkpoint.test.mjs:34-35`、`idle-settings.test.mjs:465`）。`idle-checkpoint.js:27` 注解说明 `advanceWatermark` 是 HEAD 已存在的未用导入，本次未新增。

**M5. 命名空间防冲突（你问的「两个任务都用 quote」）——已解决 ✅**
- `compositePropertyName` = 任务键，`{ [taskKey]: <该任务结论> }` 一层命名空间（`aux-task-registry.js:54-64`）。两个任务各自独立的 `quote`/`reason` 各居其命名空间，不互相覆盖；且 `additionalProperties:false` 防平铺误混。比「平铺字段」方案正确，实现理由充分。

**M6. 水位纪律与残留风险——诚实但可推进性待评估（建议项）**
- `provider:382-384` 仅在 `failedTasks.length===0` 时给 `watermarkTurn`；注释（`provider:376-380`）自述多任务「一件成一件败」不推进会导致已成功者被重覆盖、重复落地，属已知残留风险、当前不可达。方向上是把「失败即不推进」沿用为「任一失败即整体不推进」，保守但正确指向安全侧。属建议项：第二任务落地前须一并解决。

---

## 五、阻断项 / 应修项 / 建议项 / 不确定

### 阻断项（不修则不应提交 Human 决定）
1. **S0**：§10.2 标题「候选设计，待审核确认」与正文「Human 决定 2026-10-11」自相矛盾，直接动摇本次修订的规范效力声明。必须二选一：确认则吸收标注，否则撤回「决定」时态措辞。

### 应修项（建议本轮修正）
2. **M3**：持久化 runlog 未写入「已启用但未实现」完整清单（`lifecycle.js:646-663`），§10.2「如实登记为未执行」在持久化痕迹层未闭环。
3. **M1 结构面**：`provider:376-380`/`aux-task-registry.js` 的已知残留登记里，补上「宿主提交层整单 reject 会掀翻其余任务」这一与 §10.2 承诺直接冲突的、第二任务落地前必须解决的结构性缺口说明（若规范措辞保持无条件）。

### 建议项
4. **S4**：§10.2「能力本体不存在」措辞改为「能力本体按实现现状尚不具备」，避免贴近状态断言。
5. **S5**：规范层面明确「运行痕迹」口径（runlog vs activity），消除 S5/M3 的判定歧义。
6. **M6**：第二任务实现前，把「多任务水位重覆盖」与「提交层整单」两条继承面合并成一份开放项清单（`specs/32` 附录 A 或代码注释），避免各自散落。

### 我不确定的地方（如实）
- **「运行痕迹」的权威口径**：规范 §10.2 用「运行痕迹」，实现里 runlog 与 activity 事件并存。我判断规范意图偏向可持久化的登记，但无法确定起草者的本意是哪一个，这决定 M3 是应修还是可容忍。建议起草者@确认。
- **§10.2 标题标注是否真需改**：取决于本次「Human 决定 2026-10-11」是否被认定为对「一次派发做多件事」派发模型的最终 Human 确认，还是仍处于「独立审核确认前」的草案态（文件顶部 :22 表明整份 32 尚在 01 §12 独立审核流程中）。若整份文档仍是草案，那么"待确认"标注或许是系统性一致的——但正文以「决定」时态陈述，与文件顶部「尚未完成 01 §9.2 成立程序（含 Human 决定）」的全文口径**本身矛盾**，这一点绕不开。
- **并发编辑的影响**：审核期间实现被继续改动，我以稳定态为准；但无法排除我读到中间态时遗漏的、起草者已处理的细节。建议合入前以最终 diff 再自核一次。

---

## 六、结论

规范修订在方向与多数措辞上是严谨的：与 §6.1/§10.3/§10.4 的预算冲突被显式化解，§10.6 按任务分列自洽，§7.2 状态禁令整体被自觉遵守，且把「同一次派发做多件事」以规则形式写实。实现侧质量显著：**全量测试穿绿、eslint 全绿、悬空引用彻底、命名空间防冲突到位、循环导入规避、不抛错的逐任务收口是对早期「错误挂 partialTaskResults」缺陷的正确修复**。

堵在提交前的**必须修**是 S0（§10.2 标题与正文矛盾）。**应当修**是 M3（持久化 runlog 缺未实现清单）与 M1 结构注释缺项。其余为建议与待起草者澄清的歧义。**整体可审通过（conditional pass）**：修掉 S0 与 M3 后即可提交 Human 决定。

*(本报告同时通过 send_message 发往父智能体 session-700d5c0c-f299-49c2-87f7-8e28a6893d16。)*