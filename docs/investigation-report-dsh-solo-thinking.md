# dsh-solo-thinking 调研：独立 Session 思考树与显式 Handoff 对 LDVH 多分支编排的参考价值

> 性质：开发设计输入（非规范、非事实对象）。
> 调研对象：[fredalxin/dsh-solo-thinking](https://github.com/fredalxin/dsh-solo-thinking) v0.1.19（MIT）。已迁出至 `/Users/dmh2002/DshProject/dsh-solo-thinking`（2026-09-01 克隆快照，8 commits，2026-08-14 至 08-21，作者 fredal xin；当前部署在本环境 desktop profile 的是 v0.1.18）。
> 方法：两路子代理（核心树模型 / 客户端+测试+设计审计）+ 主控第一手源码核验（domain.ts 全读、index.ts 生命周期钩子与工具、client sendToBranch/openSession、domain.test.ts 全读、markBranchStarted/recoverIncompleteOperation/renderBranchContext）。
> 关联：dsh-solo-thinking 把项目 [Solo](https://github.com/solo-agent/solo) 的"可操作思考树"移植到 DSH——每方向独立 Session、分支间只交换 Agent 主动撰写的 Handoff。v4 已有草案级 study（study-01M0SHBPFGFCX），本次是对代码仓库本身的完整新调研。与 LDVH 八维"反思/沉淀"、多分支并研、复核独立性与 Web 呈现直接相关。

---

## 0. 执行摘要

1. **它把"多分支研究"做成了"一棵由独立 DSH Session 组成的、仅以显式 Handoff 交换信息的思考树"**——每方向一个独立 Session，父子/兄弟之间**永远不共享原始对话**，只通过 Agent 主动撰写的 Markdown Handoff（继承/Current State/回传三种角色）交换跨分支相关结论。
2. **三条最可靠的工程不变量**（主控已核验）：
   - **隔离是 Host 硬保证不是素养**：每个 `ThinkingNode` 1:1 映射一个 DSH Session（`domain.ts` Node.sessionId），提示层 `renderBranchContext` 只渲染 published Handoff 并写死 *"Raw conversations are isolated by DSH Session. Never infer or request another branch's raw transcript."*（`domain.ts:407`）；
   - **休眠是默认，显式唤醒才工作**：建议分支以 `dormant: true` 出生，只有收到真实用户消息或 Agent 轮次（`markBranchStarted`）才激活；`agent/pre-step` 对 `returned` / `forkHandoffPending` 节点直接 `reject`（`index.ts:404-408`）；
   - **回传封存有拓扑约束**：根节点不可 return、有活跃子节点的分支不可 return（`assertReturnTopology`，`domain.ts:481-489`）——审计完整性由状态机强制。
3. **状态机是纯函数 + 事件溯源 whole-value 投影**：`solo-thinking/state` 单事件类型、整棵 `ThinkingSpace` 快照广播（`appendSpace`），Projection `soloThinking` 冷启动还原；`revision` 乐观锁 + `serializeWrite` 串行化 + `recoverIncompleteOperation` 冷恢复。
4. **对 LDVH 最有价值的是三个可移植隐喻**（独立证据池 / 惰性委派 / 回传封存）和**"过程透明 = 交接物透明而非原始思维链透明"**的定位——与 LDVH"判断与声明经信息交付可查可验"同构。
5. **边界**：这是小型专注插件（src 2,845 行 + 测试 597 行 + 文档 218 行），靠 5 个纯状态机测试 + 受控 Provider 的真 E2E 支撑；它的 MARKER 文本路由（依赖 LLM 认 marker 前缀）是弱设计，whole-value 复制到所有节点 Session 在 >40 节点会膨胀——两者 LDVH 不应照搬。

---

## 1. 项目概况与定位

| 维度 | 现状 |
|---|---|
| 定位 | "把头脑风暴拆成一棵可操作的思考树"——Solo 项目的能力移植，只移植 Thinking 核心不变量，不移植 Channel/团队/PostgreSQL/daemon/CLI |
| 映射 | DSH Session 代替 Thinking Node 独立作用域；DSH persistence 代替进程池/数据库；DSH Tool+System Prompt context 代替 Handoff 控制协议；Conversation View/右栏代替 Channel 工作区 |
| 规模 | src 5 文件 2,845 行（domain.ts 505 / index.ts 955 / client/index.tsx 1288 / client/layout.ts 75 / rc-event-catalog.ts 22）+ lib 预构建（提交在仓库，安装不构建）+ tests 5 文件 597 行 + docs 3 篇 218 行 |
| 版本 | 0.1.19（2026-08-21）：0.1.17 右栏伴侣+dormant+Workspace+不串线+冷启动；0.1.18 Better Sidebar Tab+四抽屉+optional peer+npm 准备；0.1.19 `thinking_end` + 回传后 Session 保留到 shutdown |
| 兼容 | 目标 DSH 0.1.0-rc.6；Better Sidebar optional peer（软检测，不打包） |
| 依赖 | 无外部网络服务；state 入 DSH Session persistence；卸载不删历史 Session |
| 测试 | 5 个 vitest + verify 链（tsc + test + e2e 脚本语法 + build + verify-client-bundle + verify-persistence 真 JSONL 冷加载 + npm pack dry-run）+ 受控 Provider 真 E2E（真实 DSH adapter/Agent loop/persistence/Projection/浏览器） |

## 2. 核心数据模型（domain.ts，主控全读）

**`ThinkingNode`**（:9-29）：`id`（树内唯一，≠ sessionId）、`sessionId`（1:1 DSH Session）、`parentId`（null=根）、`depth`、`sortOrder`；`status: active | returning | returned` 三态；三个瞬态锁 `forkHandoffPending` / `checkpointRefreshingAt` / `returningAt`；**三种 Handoff 角色**：`inheritedHandoff`（不可变，父→子）、`checkpointHandoff`（可替换，跨分支 Current State）、`returnedHandoff`（终态，子→父最终交接）；`dormant`（休眠）。

**`ThinkingSpace`**（:31-37）：whole-value 投影。`version:1`（schema 升级锁）、`revision` 单调乐观锁、`endedAt`（整树终结，Projection 隐藏但历史保留）。

**`DEFAULT_LIMITS`**（:46-51）：`maxDepth:4, maxBranches:6, maxNodes:40, maxHandoffChars:8000`——纯函数在写入前拒绝越界。

**生命周期状态机**（纯函数，:99-389，测试 domain.test.ts 全绿）：
```
suggested/新建 ──> active+dormant
  markBranchStarted 激活 ──> active
  requestSplit ──> active+forkHandoffPending ──(completeSplitHandoff)──> active+inheritedHandoff
  beginCheckpoint ──> active+checkpointRefreshingAt ──(checkpointNode)──> active+checkpointHandoff
  beginReturn(非根) ──> returning ──(returnNode)──> returned+returnedHandoff
  任何瞬态锁 turn/end 时 recoverIncompleteOperation 回滚为 active
```

**关键不变式**：
- 根不可 return（`domain.ts:481-482`）；有活跃子节点不可 return（:483-488）；
- `renderBranchContext` 只向兄弟渲染 `returnedHandoff ?? checkpointHandoff`，**永不 raw**（:407 + :426-445）。

## 3. 8 个 thinking_* 工具 + /thinking 命令

| 工具 | 语义（index.ts） | 备注 |
|---|---|---|
| `thinking_start` | 幂等建树，root=当前 Session | 提示 agent 用 `thinking_suggest` 建初始 2-4 方向 |
| `thinking_suggest` | 默认初始 fan-out：一次建 **2-4 个休眠**建议分支（仅根、仅无子时可调；**宁缺勿凑**） | 每个带方向专属 inheritedHandoff，`dormant:true` 出生 |
| `thinking_split` | Agent 自主分裂一个子分支，**必须带子专属 Agent 撰写的 Handoff，raw 永不复制** | 纯函数校验 maxDepth/Branches/Nodes/同名/重 ID |
| `thinking_fork_handoff` | 只完成"人请求的 split"的待补继承 Handoff（精确 childId） | 完成后 `concludeTurn()` |
| `thinking_checkpoint` | 发布本分支"只含跨分支相关结论/证据/风险/依赖/下一步"的 Current State，**不唤醒兄弟** | refresh 路径用 checkpointRefreshingAt 锁 |
| `thinking_return` | 非根分支终态回传：status→returned + 写 returnedHandoff + 在父 Session 持久化一条 plugin-origin notice | 父分支收到后不自动跑，下轮显式读 |
| `thinking_end` | 整树 endedAt（历史保留，可再开新树） | 仅根节点 |
| `thinking_status` | 读快照：active/returning/returned 计数 | |

`/thinking start|split|split-retry|rename|checkpoint|return|end|status`。四个"request 变体"（split/checkpoint/return/fork-handoff 的 UI 触发路径）走 **followup 模式**：先把状态写成 preparing（加锁），`parentAgent.followup(createControlMessage(...))` 推 user-role notice 让父 Agent 接着整理，**然后 `await parentAgent.whenIdle()`**——"一次只让父分支干一件事"。三个 MARKER 常量（`[solo-thinking:return-request]` 等）用纯文本前缀 + 六段 Markdown 骨架做约束性指令。

## 4. 输入路由与"不串线"（主控核验）

**Host 侧无 send-to-session 路由逻辑**——隔离靠 DSH 原生 Session 模型本身。`agent/pre-step`（index.ts:404-408）对 returned/forkHandoffPending 节点 `reject`；`renderBranchContext` 只注入 published Handoff。

**Client 侧三层**：
1. `ThinkingView` 是 `conversation.view` 加法视图（order 20，label 头脑风暴）——**点节点只改本地 selectedNodeId，不切 DSH Session**（index.tsx:333-338）；
2. 直接给选中分支发消息 `sendToBranch` → `session.prompt([...], 'queue')`（index.tsx:164-169），目标由 **SessionId** 隔离，主输入框仍只服务当前 Session；
3. **进入对话是显式门**：`shouldOpenNodeConversation`（非当前/非 dormant/非 forkHandoffPending）真才 `openSession` → `sessions.open` + 点"对话"Tab（**故意不点头脑风暴**，index.tsx:180-211）。

## 5. 事件溯源持久化（主控核验）

- `THINKING_STATE_EVENT='solo-thinking/state'`，**整棵 ThinkingSpace 快照作为一次事件**（非 delta）；`foldThinkingSpace(session.events)` 还原（domain.ts:119-127）。
- **写时全节点广播**：`appendSpace`（index.ts:805-848）遍历所有 live Session，`revision` 不同才 append；冷 Session 走 `sessionPersistence.append`（含 next seq + structuredClone）。
- Projection `soloThinking`（index.ts:384-391）：init null / apply last-write-wins / view 忽略 endedAt / stateVersion 1。
- 并发：`serializeWrite` 按 rootSessionId 串行化 + revision 乐观锁；冷恢复 `recoverIncompleteOperation`（turn/end 时回滚残留 returning/checkpointRefreshingAt 锁，index.ts:869-887）。
- `rc-event-catalog.ts`（22 行）= rc.6 兼容桥：优先 official `registerEventType`，旧 RC 才临时往 live catalog 注册 `solo-thinking/state`（可逆，官方 API 统一后应删）。

## 6. 客户端 Web 视图与 UI 纪律（client 子代理报告 + 主控核验）

- **两套呈现同一语义**：顶部完整 Tab（`ThinkingView`，全审查密度）+ 右栏 `ThinkingRail`（伴随密度，四类上下文 `<details>` 默认折叠、图吃剩余高度）。色相编码语义生命周期：蓝发散/琥珀进展/青绿继承准备/紫刷新回传/灰完成。
- **四类层级上下文**：①父节点结论=inheritedHandoff（pending 写"不复制父原始对话"）；②当前结论=returned??checkpointHandoff；③兄弟感知=同 parent 其它节点 meta"已发布/总数"；④子节点结论=已返回子 meta"已回传/总数"。无发布物统一"尚未发布可供兄弟读取的结论"。Handoff 一律走 DSH 安全 `MarkdownText`。
- **"过程透明 = 交接物透明"**：四卡片 body 只绑三个 Handoff 字段，无跨节点 session.history/useSession；兄弟列表可点但只切树选中，原始对话直到 Human 显式进入该 Session 才可见；pending 文案反复声明不偷用父原始对话——**透明的是状态机与交叉结论，不是原始思维链**。
- Better Sidebar 软检测：`ctx.inject(['betterSidebar'])` 嵌套 fiber，卸即回卷；`registerTab`（single、order 30、key `sessionId:rootSessionId` 防重复预热，先其它分支当前最后）。
- `layout.ts`（75 行）：根居中、叶子按 DFS 均分圆周、非叶取子角度质心，父子连线 SVG `<line>`。

## 7. 测试与工程纪律

**5 个测试（597 行）**：domain.test.ts（230 行，纯状态机全覆盖——隔离身份/上限/2-4 休眠/checkpoint 不暴露 raw/human split 只读到 fork/子未回传父不能 return/根不能 return/refresh 失败保旧/recover）、layout.test.ts、package-contract.test.ts（optional peer 不打包）、rc-event-catalog.test.ts（registerEventType 优先+fallback 只删自己）、better-sidebar.test.ts（290 行，单实例 Tab/预热顺序/provider 替换回卷/activateConversationView 不碰侧栏/dormant 不导航/右栏四 details 默认关+Markdown/完整 Tab 四类+计数）。

**verify 链**（package.json:63-70）：check(tsc) + vitest + e2e 脚本语法 + build + verify-client-bundle（ModuleLoader banner/factory）+ **verify-persistence（真 JSONL 冷加载）** + npm pack dry-run。**E2E**（受控 Provider 替模型响应，真 DSH adapter/Agent loop/JSONL/Projection/浏览器）：`thinking_suggest`→4 dormant 分支（无 subagent origin、带 Handoff）→ Workspace 继承 → human split →p pending → fork_handoff → 清 dormant → checkpoint 锁 → Current State → returning → returned（revision 0→7）→ 父收 plugin notice 不被自动唤醒 → end 后同 Session 从 revision 0 再开树 → 冷启动仍见 revision 7 + pending 可复活。

**设计审计**（docs/DSH-PLUGIN-DESIGN-AUDIT.md，53 行）：对照官方插件模型五条（贡献能力非绑提供方/长生命周期可回卷/bundle/proto 分层/双面/稳定 id 锚点）全部"符合"；有意保留的 RC 兼容层定性为"可逆版本兼容层而非长期 service seam"。

## 8. 与已装 v0.1.18 及既有 study 的关系

- 本环境实际装在 desktop profile 的是 **0.1.18**（repo 已到 0.1.19）；两版差异仅：0.1.19 加 `thinking_end`+UI 清除、回传后 Session 保留到 shutdown 以便 tool result 落盘——**不影响核心树模型与本文所有结论**。
- v4 study-01M0SHBPFGFCX 是草案级（基于 README/界面推断）；**本调研是对代码仓库的第一手核验**，确认了该 study 的关键判断并补充模板确切的机制（reject 闸门、revision 锁、whole-value 广播、sendToBranch 路由）。

## 9. 对 LDVH 的参考价值（核心）

### 9.1 三个可移植的编排隐喻

1. **独立会话树 = 独立证据池**：LDVH"五批并行读 study"（见 eight-dimension-study-reread）或复核独立性（三轴审计并行 subagent）可对应一棵 Space——每个 subagent 一个 `ThinkingNode`，`sessionId` 即证据入口，**"绝不同步 raw transcript、只传 Handoff"是原则而非策略**，杜绝"以为对方读过原文"的错觉。
2. **惰性委派**：建议方向先建节点不启动（dormant），等上游人类或 Agent 决定要哪个方向再 `prompt`——LDVH 多项可选行动（如并行研究方向）可先物化可选集、由 Human Gate 选定后唤醒单支。
3. **回传封存 + 拓扑约束**：子未回传（active）父不能 return、根不可 return——LDVH"复核 subagent 完成后结论应写成只读交付而非可反复编辑的工作副本"的机械实现；审计完整性由状态机强制而非自觉。

### 9.2 Handoff 结构与 LDVH 交接包的异同

Solo Handoff 字段（目标/已确认结论/证据/风险/未解问题/下一步）与 LDVH 交接包高度同构；**差异在于 Solo 隐含"读者无法访问 raw"的纪律**（domain.ts:407）。LDVH 若引入分支独立 subagent，可强制：交接包 ≤8,000 字符、必填六段、禁在交接包中引用 raw 现场——把"反思/沉淀"维度的可验证性提升一档。

### 9.3 对 LDVH Web 呈现（四支柱之一）的启示

- **研究过程可视化**：轨道图把"有哪些独立方向、各走到哪相"压成可点状态图，色相编码语义生命周期而非 token 流——LDVH 应把管辖态（governed/Human Gate/待审议）做成节点色相+图例，而非塞进长 Markdown。
- **四类层级上下文按需折叠**：全审查密度 vs 伴随密度两种呈现，Human 先看拓扑与计数（`3/4 已发布`）再点开读正文——正是"人接得住"所需。LDVH Web 可拆"当前规范结论/上级约束/并行视角（审议）/下游回传（执行结果）"四层。
- **观察过程与进入过程分离**：选中绝不切 Session，只有显式"进入分支对话"才打开——Human 先看清依据再决定是否深入某次审议/执行会话。

### 9.4 与 LDVH"过程信息保持透明"的对照

**对齐处**：状态机可见（revision/running 脉冲/dormant 未启动/pending 锁/returning），交接物可见且可点，checkpoint/return 不自动唤醒（透明≠打断），跨节点只渲染已发布结构化交接物、永不 raw——即**"透明的是交接，不是原始思维链"**，与 LDVH"判断与声明经信息交付可查可验"同构。

**需改写处**：Solo 透明服务"发散隔离"，LDVH 透明服务"规范遵守与 Human Gate"——Solo 让兄弟看不到 raw，LDVH 复核维可能需要受控展示"规范条款↔事实锚点↔拟议行动"三联；Solo 四层是亲缘拓扑，LDVH 八维不是树（节点语义应是工作维/审议对象，边是规范关系/事实引用）；Solo 结束清空界面（历史仍在），LDVH 沉淀要求结构化留档可回溯、清视图可以但不能让管辖事实随 UI 消失；Solo 控件"请当前节点 Agent 去写"，LDVH 需区分"请 AI 整理汇报"与"人批准/否决"。

### 9.5 LDVH 应避免的

1. **MARKER 文本路由**：`[solo-thinking:return-request]` 靠 LLM 认 marker 前缀文本——脆弱，Agent 端无 schema 校验。LDVH 若用 tool calling 路由则不必走 marker。
2. **whole-value 复制到所有节点 Session**：>40 节点膨胀。LDVH 人主导少量分支（2-5 批）可接受；若全量多 agent 编排应 reference/event sourcing。
3. **"at most one"靠 persona**（上游 dsh-mnemon 教训，同址不同项目）：本插件的 "Default suggested-direction mode" 也是提示词纪律（renderBranchContext 内）；LDVH 凡"AI 必须不…"应自问机械可证还是 persona 自律。

## 10. 证据与未验证范围

### 10.1 已证实（两路子代理 + 主控第一手核验）

- domain.ts 全读，纯状态机与三种 Handoff 角色、限额、根/子 return 拓扑断言逐行核验；domain.test.ts 全读证实状态机行为；
- index.ts 生命周期钩子（agent/pre-step reject、session/event 激活与恢复、systemPrompt.context 渲染）、8 工具、MARKER/followup/whenIdle 模式、appendSpace/recoverIncompleteOperation/markBranchStarted 逐段核验；
- client sendToBranch（prompt queue）/openSession（进入对话显式门）/shouldOpenNodeConversation/watchBetterSidebar 冷恢复/activateConversationView 不点头脑风暴 Tab 逐段核验；
- renderBranchContext "Never infer or request another branch's raw transcript."（domain.ts:407）确认；
- 工程数据（verify 链/E2E/版本史/审计）从 package.json/CHANGELOG/docs 核对。

### 10.2 未验证/残留风险

- 未实际运行 `pnpm verify`（E2E 需要受控 Provider + 真 DSH，未执行）；
- lib 编译产物未逐行展开（由 scripts verify-client-bundle 保障，未运行）；
- 在本环境 v0.1.18 上的实际交互（Trees 工具是否已暴露给当前 agent）未实测；
- Better Sidebar 实际安装/运行集成在桌面环境未验证（本机非其目标 rc.6 web profile）；
- 本环境部署的 0.1.18 与 repo 0.1.19 的核心等价性据 CHANGELOG 判断，未对 0.1.18 源码单独核验；
- 本报告为设计输入，不构成任何机制已在 LDVH 落实的证明；吸收项落规范前按行动基线走查。