---
title: DSH 官方 Agent Teams bundle 0.2.2-rc.1 能力边界与 WorkCase 分野
status: active
research_question: DSH 官方 Agent Teams bundle @deepseek-ai/dsh-experimental-agent-team-profile 0.2.2-rc.1 由哪些组件构成、实际提供哪些能力与边界，以及它在 LDVH 的 WorkCase 执行体系面前能替代哪些环节、不能替代哪些环节？
research_purpose: 判断 DSH 官方 Agent Teams bundle 能否承接 LDVH 的执行调度与审核返工职责，以决定 WorkCase 是取消、收缩还是维持：该 bundle 提供持久 roster、peer mailbox 与共享任务板，而 LDVH 自有 WorkCase 授权门禁制度，需分清哪些能力可直接借用、哪些语义与 LDVH 制度冲突。
stopping_reason: round-cap
confirmed_statements:
  - 该 bundle 的运行时内容是一层 patch，本机安装为 0.2.2-rc.1 且默认关闭
  - 九个模型工具全部是协作调度工具，没有任何审核/门禁语义
  - 任务板是 CAS 版本化的依赖图，但写范围只是提示、owner 永不自动释放
  - 该 bundle 不提供任何 Human Gate，也不承载授权或审计
  - 多成员并发会让 Git Gate 读到被污染的共享 Index（已实测）
  - 成员身份走宿主原生子代理路径：已实测确证 origin=subagent，复核回传通道可用
  - 与 WorkCase 是互补而非替代关系：它补调度层，缺授权与审计层
uncertain:
  - issue: record_review 实际落一条 teammate 复核尚未执行（身份链已实测通过）
    reason: 该步需要一个 open 期、确有一次真实复核事项的 WorkCase；为实验伪造工单会污染事实源，故本轮止于身份链验证
  - issue: 0.1.7-rc.1 与 0.2.2-rc.1 之间的变更未对照
    reason: 官方未提供可取的逐版 changelog，本次只按 0.2.2-rc.1 当期文本重新取证
gaps:
  - description: 多成员并发时 Git Gate 读取共享 Index 会被静默污染（已实测，仍须修）：teammate 与 Lead 的 git add 互见于同一 Index；pre-commit hook 仅在 LDVH_PREFLIGHT_INDEX 存在时隔离 Index，日常 git commit 直接读共享 Index
    priority: high
  - description: teammate 作为复核者写入 reviews 的一步未实测：身份链已验证（origin=subagent、血缘可溯），但尚未真正调用 record_review 落一条复核；需一个 open 期的真实工单
    priority: high
  - description: 0.1.7-rc.1 与 0.2.2-rc.1 之间的逐版变更未对照：官方未提供可取的 changelog
    priority: medium
  - description: 该 bundle 若引入后与 LDVH 呈现层（Sidebar / 全屏面板）的入口层级关系未评估
    priority: low
implications:
  - finding_ref: 该 bundle 的运行时内容是一层 patch，本机安装为 0.2.2-rc.1 且默认关闭
    implication: 「bundle 即一层 patch」是宿主认可的正式形态，LDVH 可据此把 profile 级组合差异写成 patch 层；但默认关闭意味着引入是显式决定，不会意外生效。
  - finding_ref: 九个模型工具全部是协作调度工具，没有任何审核/门禁语义
    implication: 直接否决「用它替 WorkCase 的审核与返工链」这一设想：该 bundle 无 verdict、无轮次上限、无自动返工，任务 completed 即放行。
  - finding_ref: 任务板是 CAS 版本化的依赖图，但写范围只是提示、owner 永不自动释放
    implication: 任务依赖图与并发 CAS 强于 WorkCase 的线性 plan，是唯一值得借用的部分；但 writeScopes 不构成越权拦截，故不能据此取消事前授权。
  - finding_ref: 该 bundle 不提供任何 Human Gate，也不承载授权或审计
    implication: 须立 ADR 划定边界：团队任务板条目不得替代 WorkCase 的 C1 提案、Gate 1 批准与 Gate 2 关闭，否则授权的可回读链会断在会话日志里。
  - finding_ref: 多成员并发会让 Git Gate 读到被污染的共享 Index（已实测）
    implication: 引入 Team 前必须先把受控提交的 Index 隔离默认化（LDVH_PREFLIGHT_INDEX 机制已存在）；否则并发写入既不受 writeScopes 拦截，也无法在提交时被正确归属。
  - finding_ref: 成员身份走宿主原生子代理路径：已实测确证 origin=subagent，复核回传通道可用
    implication: teammate 可直接充当独立复核者而无需改 LDVH——E2 已实测确证身份链，不再是静态推测；同时「引导文本有、管辖工具无」证明机制注入与文本注入分离，引导不构成能力。
  - finding_ref: 与 WorkCase 是互补而非替代关系：它补调度层，缺授权与审计层
    implication: WorkCase 的改造方向应是「收缩到授权与审计层」，把调度与并发让给宿主机制；这与 Human 的「让 WC 高效运作」诉求方向一致。
urls:
  - ref: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/agent-team-profile/README.zh.md
    summary: 支持 F1/F6：本包让团队协作、工具与 Web 界面通过一个组合包启用；默认关闭、仅显式启用；已知限制列出共享 checkout 与预设内子代理控件
    title: agent-team-profile README.zh.md（组合层官方自述）
  - ref: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/agent-team-profile/cordis.patch.yml
    summary: 支持 F1：该包运行时内容即此 patch——三条 disabled 标准子代理行、三条 insert（agent-team / tool-agent-team / ui-agent-team）与各自 config
    title: agent-team-profile cordis.patch.yml（运行时权威文本）
  - ref: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/tool-agent-team/README.zh.md
    summary: 支持 F2：恰九个工具与四类能力（创建/消息/观察等待/任务板）；亦支持 send_message 不回消息 ID、wait_agent 在无活动成员时立即返回 noProgress 的边界
    title: tool-agent-team README.zh.md（模型工具表层）
  - ref: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/agent-team/README.zh.md
    summary: 支持 F3/F5：任务板 CAS 与依赖图、writeScopes 仅提示、owner 不自动释放；teammate 走既有子代理服务并在子会话元数据写入 origin=subagent；已知限制列出单进程共享 checkout 与无发送重试保证
    title: agent-team README.zh.md（领域服务自述）
  - ref: https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/client-ui-agent-team/README.zh.md
    summary: 支持 F4：Web 面板是只读派生投影，不扩展 API Proxy、不存储 Team 状态、不注册面向模型的输入、不提供任务修改控件
    title: client-ui-agent-team README.zh.md（Web 投影）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-experimental-agent-team-profile
    summary: 支持 F1：dist-tags 为 latest=0.1.5-alpha.2、next=0.2.2-rc.1，共 25 个版本；证实该包长期以预发布通道分发
    title: npm registry：agent-team-profile 版本线
object_uid: e8a9ab59-cb18-41d4-83d1-a7040a70d7cc
fact_type_key: research
created_at: 2026-11-11T18:07:48.524Z
change_log:
  - at: 2026-11-11T18:07:48.524Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建：按 0.2.2-rc.1 当期文本重新取证官方 Agent Teams bundle，替代已过期锚定 0.1.7-rc.1 的 research-9b42bb7a。
  - at: 2026-11-11T18:20:43.937Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补登 2026-11-12 实跑实验结论：E2 确证 teammate 身份为 origin=subagent/depth=1 且工具面收窄为零（复核回传可用，原「未证实一」消解）；E3 实测 Git Gate 并发缺陷，从「可能被干扰」升级为「确定被静默污染」，并定位到 pre-commit 仅在 LDVH_PREFLIGHT_INDEX 存在时隔离 Index。相应更新 gaps、uncertain、implications 与建议 2。
---

# DSH 官方 Agent Teams bundle 0.2.2-rc.1 能力边界与 WorkCase 分野

## 研究问题

DSH 官方 Agent Teams bundle @deepseek-ai/dsh-experimental-agent-team-profile 0.2.2-rc.1 由哪些组件构成、实际提供哪些能力与边界，以及它在 LDVH 的 WorkCase 执行体系面前能替代哪些环节、不能替代哪些环节？

本对象是旧调研 research-9b42bb7a（锚定 0.1.7-rc.1）的替代版。旧对象据以立论的两个前提已过期：版本落后两个 RC，且当时判断「LDVH 对 Agent Teams 零消费面」——而本次取证发现本机安装件已是 0.2.2-rc.1，会话投影层已有 `agentTeam` 空投影，只是 bundle 未启用。故重新取证、重新立论，不沿用旧对象的任何结论条目。

## 输入与边界

观察时点：2026-11-12。版本基线：本机 DSH 随附安装件 0.2.2-rc.1（`app.asar` 内 `dsh/node_modules/`），npm `dist-tags.next` 同为 0.2.2-rc.1，`latest` 仍停在 0.1.5-alpha.2。

来源分工：
- 四个包的 `README.zh.md` 与 `package.json`（随安装件原文）——能力与边界的权威自述；
- `agent-team-profile/cordis.patch.yml`——该 bundle 的运行时内容（其 `lib/index.js` 仅 `export {}`，全部语义在此 patch）；
- 领域包 `lib/index.js` 编译产物——任务状态字面量、`TEAM_*` 错误码闭集的直接取证；
- npm registry 元数据——版本线与 dist-tags；
- 本机 profile 配置（`profiles/web/package.json`、`cordis.patch.yml`）——当前是否启用的直接证据；
- 会话投影缓存——`agentTeam` 投影的当前值；
- 实跑实验（E1/E2/E3）——派生 teammate 的会话载体首行、其工具清单与 runtime context、隔离仓库中的并发 `git add` 对照；
- LDVH 自身源码（`child-session-record.js`、`lifecycle.js`、`git-gate-runner.js`、`.git/hooks/pre-commit`）——判定实验观察落在哪条既有机制上。

读取深度：以官方原文逐条引用为据；领域包只读编译产物的符号层（状态字面量、错误码），未做完整源码审读。

**本轮覆盖两部分**：前半为静态取证（官方 README、patch、编译产物、registry、本机 profile）；后半为实跑实验（2026-11-12，实验 E1/E2/E3——派生两个 teammate、读取其会话载体首行、在隔离仓库中做并发 stage 对照）。实验均在隔离环境或只读范围内进行，未污染 LDVH 主工作树。

**仍未覆盖**：0.1.7-rc.1 → 0.2.2-rc.1 的逐版变更对照（官方未提供可取的 changelog）；`record_review` 实际落一条 teammate 复核（需 open 期真实工单）；任务板记录能否被 LDVH 只读消费。

## 关键发现

### 该 bundle 的运行时内容是一层 patch，本机安装为 0.2.2-rc.1 且默认关闭

`agent-team-profile` 的 `package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`，其 `lib/index.js` 内容为空模块——**该 bundle 的全部运行时语义就是一纸 patch**：先以顶层 `disabled: true` 关掉 `tool-subagent-control`、`tool-subagent`、`tool-subagent-fork` 三条标准子代理行，再以 `insert` 插入 `agent-team`（`maxMembers: 8`、`maxTasks: 256`、`maxMessageBytes: 65536`、`disposalTimeoutMs: 5000`）、`tool-agent-team`（`freshProvider: spawn`、`forkProvider: fork`）与 `ui-agent-team` 三行。

版本上，本机安装件与 npm `next` 均为 **0.2.2-rc.1**，而 `latest` 停留在 0.1.5-alpha.2——说明该包长期以预发布通道分发，`latest` 标签不代表当前。

官方自述「随安装提供但默认关闭；随附 CLI、Web、SDK、ACP 与 Python profile 都不会启用它」。本机取证一致：`profiles/web/package.json` 的 `dsh.profile.bundles` 只有 `dsh-base`、`dsh-web-app` 与两个第三方插件，**不含本 bundle**；会话投影缓存中 `agentTeam` 为 `{members: [], tasks: [], messages: []}` 空投影，即投影层已就位而服务未挂载。

溯源：https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/agent-team-profile/cordis.patch.yml（patch 全文）

### 九个模型工具全部是协作调度工具，没有任何审核/门禁语义

从工具包产物提取的实际注册名恰为九个：`spawn_teammate`（仅 Lead 可调）、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`。

对两个包 README 做全文词频核验：`verdict`、`approve`、`gate` 三词**零命中**；`review` 仅在自然语言叙述中零星出现（领域包 3 次、工具包 2 次），**不存在 verdict 闭集、审核结论字段、轮次上限或自动返工链**。

任务状态经编译产物取证为四值闭集：`pending` / `in_progress` / `completed` / `deleted`（`rejected` 出现于 Promise 结算语境，非任务状态）。README 另述「完成后标记完成、释放回板或重新打开」，故 `completed` 是终态之一而非审核结论载体。

溯源：https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/tool-agent-team/README.zh.md（工具清单与策略段）

### 任务板是 CAS 版本化的依赖图，但写范围只是提示、owner 永不自动释放

任务为完整版本化快照，每次变更携带 `expectedRevision`，陈旧调用方收到 `TEAM_TASK_STALE_REVISION` 而非覆盖更新的值；`task-<n>` 的 id 空间耗尽时报 `TEAM_TASK_LIMIT` 而不复用；已删除任务作为 tombstone 保留以维持 id 稳定，但不占 `maxTasks`、不出现在 `listTasks()`。

两条官方明写的边界对本项目要紧：
- **`writeScopes` 是「规范化后的 workspace 相对前缀」，视图对与 in-progress 任务的重叠发出警告但绝不阻止 claim、也不授予写权限**；已知限制章更直白：「Bash、formatter、代码生成器与直接外部写入可以绕过文件版本检查；Lead 必须协调 owner 并检查最终 diff」。
- **owner 不自动释放**：「成员不活动、interrupt、进程退出与工作失败都不会释放任务 owner」。

这两条都是诚实取舍（不假装自动解决），但也划定了该 bundle 的能力上界。

溯源：https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/agent-team/README.zh.md（共享任务板与已知限制章）

### 该 bundle 不提供任何 Human Gate，也不承载授权或审计

该 bundle 的能力面止于「调度 + 协作 + 只读呈现」：领域包提供 roster、邮箱、任务板；工具包提供九个调度工具；UI 包是**只读**派生投影——「不扩展稳定 API Proxy、不存储 Team 状态、不注册面向模型的输入」，「面板不提供任务修改控件」。

全篇无任何「谁批准这项工作的范围」的承载：没有授权指纹、没有范围快照、没有批准入口、没有关闭审计。团队启动本身不是工作授权。

溯源：https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/client-ui-agent-team/README.zh.md（概述与已知限制）

### 多成员并发会让 Git Gate 读到被污染的共享 Index（已实测）

这是本轮唯一被实测推翻「只是可能」预期的条目——它从假想风险变成了确定缺陷。

**实测设置**（2026-11-12，实验 E3）：在隔离的一次性 git 仓库中，由 teammate `probe-b` 与 Lead 各自只 `git add` 自己的文件（`a.txt` / `b.txt`），先后相差约 1 秒。

**两侧独立记录的同一事实**：
- `probe-b` 于 02:16:38 执行 `git add a.txt`，在 02:16:42 读 `git diff --cached --name-only` 得到 **`a.txt` 与 `b.txt` 两行**；
- Lead 于 02:16:39 执行 `git add b.txt`，同一时刻读 `git status --short` 同样得到 **两行**。

**双方都只添加了自己的文件，却都看到对方的文件进入暂存区。** 这不是观察误差，是双向独立记录的一致结果——`git add` 是对共享 Index 的读-改-写，本身无隔离。

**为什么这直接命中 LDVH 的 Gate**：`git-gate-runner.js` 用 `git ls-files --cached -z` 读**候选 Index** 作为「本次提交的内容」的权威来源（注释原文：「Carriers present in the candidate Index (staged content, not the possibly-newer working-tree copy)」）。而 `.git/hooks/pre-commit` 只在环境变量 `LDVH_PREFLIGHT_INDEX` 存在时才把该变量传给 `--index-file`：

```
if [ -n "${LDVH_PREFLIGHT_INDEX:-}" ]; then
  set -- "$@" --index-file "$LDVH_PREFLIGHT_INDEX"
fi
```

**日常 `git commit` 不设该变量，因此 Gate 直接读共享 Index。** 若同树另一成员在被校验的那一刻已 stage 了文件，Gate 会把这些**不属于本次提交意图**的文件当作本次内容一并校验并通过——占位、路径覆盖、载体唯一性等判据全部在错误输入上运行。

**补充实测**：并非所有并发都会静默通过。强制同时 `git add` 三个文件时，git 报 `fatal: Unable to create '.../index.lock': File exists`，且三个文件只有一个真正进入 Index。故真实行为是**双相的**：时间错开 1 秒 → 静默污染（更危险，因为不报错）；真正同时 → 锁冲突报错但操作部分丢失。

**对本项目的直接含义**：`writeScopes` 仅作提示（官方明写「绝不阻止」），而 Gate 又读共享 Index——两者叠加的净效果是**并发写入既不受拦截，也无法在提交时被正确归属**。因此「引入 Team 后在受管辖会话中并行提交事实对象」在当前实现下**不安全**，除非每次受控提交前把 Index 隔离（`LDVH_PREFLIGHT_INDEX` 机制已存在，缺的是默认启用与调用纪律）。

溯源：https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/agent-team/README.zh.md（已知限制章：成员共享 cwd、write scope 仅作提示）

### 成员身份走宿主原生子代理路径：已实测确证 origin=subagent，复核回传通道可用

领域包创建 teammate 时调用既有子代理服务（续跑型），宿主在子会话元数据中写入 `origin: "subagent"` 与 `parentSession`。

**本轮已实跑验证**（2026-11-12，实验 E2）。派生两个 teammate（`probe-a` 探针、`probe-b` 并发实验体）后，直接读取其会话载体首行，两者均为：

```
{'type': 'session', 'id': '<probe-id>', 'cwd': '/Users/dmh2002/DshProject/dsh-ldvh',
 'parentSession': 'session-1f5f2070-0e54-49c5-bc64-9185d9aee044',
 'origin': 'subagent', 'delegationDepth': 1, 'agentPreset': 'cordis', 'isSeeded': False}
```

即 `origin` 确为 `"subagent"`、`delegationDepth` 为 1、`parentSession` 正确指向 Lead 会话。LDVH 的三道判据逐条满足：`child-session-record.js` 的 `header.origin !== "subagent"` 拒绝分支不会触发；`isDescendantOf` 血缘校验能沿 `parentSession` 走到 Lead；`lifecycle.js` 的 `installChild` 分支会命中。`ldvh_collect_subagent_results` 也确实列出了该 child record（scope=governed）。

**但实测同时暴露一处与静态预期不符的事实**：teammate 收到了完整的 LDVH 管辖引导文本（「【LDVH 管辖判定】governed」及 specs/00 锚点），却**没有注册任何 `ldvh_*` 工具**——probe-a 的工具清单里 `ldvh_*` 计数为 0。静态链本预期「进入子代理登记表」即等于「被如实纳入」，实测表明登记与工具面是两件事：登记表收录了它（故复核回传可用），但工具面按 `installChild` 分支收窄为零。这反过来印证了 04 §7.3 的选择——子代理不注册 `ldvh_*` 工具，故**唯一可行路径是父会话代为回传**，而非子代理自行写入。

引出一个对本项目有用的事实：teammate 的上下文里有管辖引导、却没有管辖工具，意味着它能读到规则文本却无法执行任何受控写入。这正确地限制了它的能力面，但也说明引导文本本身不构成能力——两者由不同机制注入。

溯源：https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/agent-team/README.zh.md（Teammate 与投递路径章）

### 与 WorkCase 是互补而非替代关系：它补调度层，缺授权与审计层

按 21 号现行能力逐项对照可得：该 bundle 在**任务依赖图**（DAG + blocked_by，WC 的 `plan` 是线性数组）与**并发 CAS + owner 协作**两点上强于 WorkCase；在**任务状态机**上弱于 WC（四值 vs draft/open/closed + outcome 四值）；在**审核结论、返工链、轮次上限、Human Gate、授权钉扎、越权基准**六项上完全没有对应物。

因此「把执行任务交给它就不用 WorkCase」不成立——它连自身成员的越界写入都不拦（writeScopes 仅提示）。而 WorkCase 真正承重、也真正昂贵的那部分，恰是它不提供的那部分。

溯源：https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/experimental/agent-team-profile/README.zh.md（概述与已知限制）

## 未证实与缺口

未证实一（本轮已消解）：成员身份通道已实跑验证，见「成员身份走宿主原生子代理路径」一节的实测记录。剩余未验证的只有一步：尚未实际调用 `record_review` 把一条真实复核写进某个 WorkCase 的 `reviews`。该步未做的原因是它要求一个处于 `open` 期、且确有一次真实复核事项的工单——为实验而伪造一个工单本身会污染事实源，故本轮止于身份链实测。

未证实二（本轮已实测，结论见缺口一）：Git Gate 并发交互已实跑，结果不是「可能被干扰」而是「确定会被污染」。

未证实三：0.1.7-rc.1 与 0.2.2-rc.1 之间的变更未对照。官方未提供可取的逐版 changelog，本次只按 0.2.2-rc.1 当期文本重新取证，不声称旧版的具体差异。

## 建议

以下均为调研结论，不是决定；采纳与否由 Human 裁决。

1. **不把该 bundle 当作 WorkCase 的替代**，而按「调度层借用、授权与审计层保留」定位。依据：F6 与 F7 的对照。创建判断：可作为 21 号下次修订或 32 号执行体系设计时的输入，现阶段无须对象化。
2. **实验已完成（2026-11-12），结论两正一负**。正向：teammate 的会话身份确为 `origin=subagent` + `depth=1` + 正确 `parentSession`，血缘链完整，复核回传通道在机制上可用；teammate 能读写共享工作树，工具面按子代理形态正确收窄（无 `ldvh_*`）。负向：Git Gate 读共享 Index 会被并发 stage 静默污染，且日常 `git commit` 不启用既有的 Index 隔离机制。依据：F5 与 E3 节实测。创建判断：负向项须对象化——建议立 WorkCase 明确「受控提交默认隔离 Index」的实现与调用纪律。
3. **确立一条边界：团队任务板条目不得作为 WorkCase 的 C1 提案、Gate 1 批准或 Gate 2 关闭的替代承载**。依据：F4（该 bundle 无任何授权与审计承载）与两者形状相似而语义不同的现实。创建判断：宜立 ADR，因为这是「两套都叫任务的东西并存时」的裁决依据；旧调研建议一即为此，本次重新确认为仍然需要。

## 后续分流

- 建议 1 作为设计输入保留在本对象，供 21/32 号下次修订引用。
- 建议 2 的实验部分已完成并回写本节；剩余「teammate 写入 reviews」一步待真实 open 期工单出现时顺带验证，无须单独立实验。
- 建议 2 的负向结论（Index 污染）须另立 WorkCase，为本对象当前唯一被判为需要对象化的动作项。
- 建议 3 属 ADR 范畴，须 Human 决定后落盘。
- 本对象在以下条件下应更新：本机 bundle 版本变化且触及 patch 禁用段、工具清单、身份来源三处之一；或 Git Gate 的 Index 隔离实现发生变化；或 teammate 首次实际写入 reviews 后补登该步实测结果。
