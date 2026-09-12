---
ldvh_spec:
  spec_key: "dsh-environment-integration"
  spec_id: "08"
  spec_kind: "spec"
  title: "DSH 环境接入与插件发布规范"
  canonical_path: "specs/08-DSH环境接入与插件发布规范.md"
  parent_spec: ""
  relation: ""
  positioning: "定义 DSH 宿主下的插件接入（manifest/工具注册/引导面/事件时机/交互面）、机械守护部署（Git Gate/不变量/沙箱）、发布与项目门面（版本号/README/CHANGELOG）"
  scope: "适用于 DSH 宿主下 LDVH 插件的接入、部署、发布与公共门面；不定义 LDVH CLI 服务契约、事实模型、业务系统规范、Web 呈现或 Code 实现细节"
  basis:
    - "ldvh-root"
    - "specification-model-foundation"
    - "work-model-foundation"
    - "source-of-truth-traceability"
  authorized_attachments: []
  dimensions: ["read", "write", "orchestrate", "memory", "research", "discussion", "comply"]
---

# DSH 环境接入与插件发布规范


## 1. 价值判断

本规范解决 LDVH 能力缺少统一 DSH 宿主接入、机械守护和发布门面的问题，使插件身份、工具、引导、事件、权限、版本与受保护文档能够在同一环境边界内被核验，减少接入漂移、越权和超前宣传负担。

插件身份与能力入口主要支撑 V1 快速定位；权限、沙箱与工具注册边界主要支撑 V3 边界识别和 HV2 授权执行受控可续；引导面、事件面与机械守护主要支撑 V4 稳定推进；版本声明、README、CHANGELOG 与回读核对主要支撑 V5 据实判断和 HV3 入档闭环节点可验。

本规范只定义 DSH 宿主接入、部署和发布门面；LDVH CLI 确定性服务、事实与业务系统规范语义、提交契约、Code 实现和 Web 交互由 03–07、09、10 与实际环境承接。

manifest 存在、工具注册成功、钩子安装、页面加载或发布完成，只能证明相应接入或发布范围，不能单独证明能力可用、授权成立、行动完成或价值兑现。

## 2. 规范依据

本文直接依据：

1. `ldvh-root`：00 §3.4 的技术与机械保障、§3.5 的四种价值交付方式、§4.3 的受保护内容、§4.4 的回应效力、§7 的防自欺、Stop Conditions 与交还；
2. `specification-model-foundation`：01 §7 的共同章节结构、§9 的当前规则源条件、§10.4 的最小规则引导、§12 的独立对抗审核；
3. `work-model-foundation`：02 §8 编排（能力承载）与 §9 记忆与反思（业务系统）对宿主接入与事件时机的机制指向，以及 §19 交还（含 Output Envelope）对宿主承载的边界；
4. `source-of-truth-traceability`：06 §6.3 的 Git Gate 事件检查（本文 §6 的 Hook 部署使用其定义的同一 validator）与 §6.1 的 message 契约（本文 §6 的 Git Gate 检查与其对齐）。

DSH 插件与市场规范只提供宿主接口和发布格式，不取得 LDVH 领域语义权威。

05、07、09、10 是协作来源，不是本文的规范依据；历史规范、平台调研、决策材料和实现只作为设计输入或授权证据，不取得规范效力。本文不重新解释 00–02；发生冲突或权威关系无法确认时，按 00 §7.2 暂停受影响范围并完成对齐。

## 3. 职责边界

### 3.1 本文负责

1. manifest 字段声明（名称/版本/入口/权限声明/市场字段）与插件身份入口（§5.1）；
2. 工具注册缝的接入语义：领域操作的输入语义约束由 05 及各领域来源定义，DSH 工具层实际工具名称、输入 schema 形态、注册时机与权限配置由 08 按当前 DSH 版本核验并定义（§5.2）；
3. 引导面注入形式与预算、turn/end 事件时机接入（turn/end 为会话事件类型，经 `session/event` 载荷分发）、`ctx.userQuestions` 问询面与审批通道授权承载接入（§5.3–§5.5）；
4. 07 登记制度在 LDVH CLI/Git Gate/Skill/Web 侧的 DSH 宿主接入点（呈现细节归 07/10）（§5.6）；
5. 机械守护部署：运行时不变量、文件观察策略、Git Gate 安装形态、沙箱分层（§6）；
6. 版本号双轨与分发渠道、README 与 CHANGELOG 格式要求、00 §4.3 五类受保护文档在 DSH 域的承接、Output Envelope 宿主承载（§7）。

### 3.2 本文不负责

1. LDVH CLI 服务契约、公开操作声明、传输 envelope——归 05；
2. 事实字段、状态机、CRUD、CAS、content_fingerprint——归 03；业务系统规范步骤、触发条件、完成门禁——归 04；
3. 事实源定义、受控提交契约、precheck 语义——归 06；管辖登记 Schema、判定逻辑——归 07；
4. 代码实现、构建、测试、CI/CD——归 09；Web 呈现、四层阅读器、UI 组件——归 10；
5. 通用 Hook 抽象、跨平台适配、非 DSH 环境接入、MCP 网关——本文红线禁止（§11）。

### 3.3 相邻规范分工与唯一权威

05 是 LDVH CLI 服务契约与领域操作输入语义的唯一权威，06 是 Git Gate 与提交检查语义的唯一权威，07 是管辖判定语义的唯一权威，09 是 Code 实现与测试的唯一权威，10 是 Web 呈现与交互的唯一权威；08 只定义 DSH 宿主接入点、部署形态与发布门面，不另建第二权威。

## 4. 适用范围

### 4.1 适用对象

本规范适用于：

1. DSH 宿主下的 LDVH 插件；
2. 插件 manifest、工具、引导、事件、交互和管辖登记接入；
3. 机械守护、分发渠道、版本声明与受保护文档门面。

### 4.2 适用场景

本规范用于插件装载、工具注册、规则引导、事件接入、授权交互、Git Gate 部署、沙箱权限、版本发布、README/CHANGELOG 与 Output Envelope 宿主承载。

### 4.3 明确排除与证明边界

非 DSH 宿主、跨平台移植与非 LDVH 插件不在本文适用范围；本规范不定义 LDVH CLI 确定性服务、事实模型、业务系统规范、Web 呈现或 Code 实现细节。

manifest 存在、工具注册成功、钩子安装或发布完成，只证明当次接入的机械范围，不单独证明能力可用、授权成立、工作完成或价值兑现。

## 5. DSH 插件身份与接入

### 5.1 插件 manifest

manifest（`package.json` 或 DSH 市场规定的文件）为插件身份入口，至少声明：名称、版本、入口路径、权限声明、DSH 插件市场字段（描述/分类/图标/作者）。manifest 是身份与权限的机械来源；AI 不得修改权限声明字段，修改须经 Human Gate。

### 5.2 工具注册缝

05 定义的 LDVH CLI 操作经 DSH 正式工具注册入口 `ctx.tools.register(defineTool({name, description, parameters, output, execute}))` 接入，返回 disposer；参数经 JSON Schema 编译校验（违规抛 ToolArgsError）；守卫通道 `ctx.tools.guard(guard)` 注册单调守卫（任何 guard 可拒不可放行，guard 在 tools/pre-execute 之后求值），执行链全序为 pre-policy → guards → around-dispatch → post-policy → 内容终结 → 通知；上述形态在 DSH 0.1.2-rc.1 与 0.1.5-alpha.1 一致（源码双版对照核验，2026-09-10），实际注册以装载后注册状态检查为准。领域操作的输入语义约束由 05 及各领域来源定义（承接 05 §5.1 分派），权限配置遵循 §5.1 manifest 权限声明，09 实现并测试；注册成功不证明操作可调用、授权成立或实际可用。

### 5.3 引导面

最小规则引导（内容锚点由 01 §10.4 定义）经两种机制注入：

- 会话冷启动引导入口：经 `system-prompt/assemble` waterfall（(assembly, context, next) 三参、返回组装权威）注入 01 §10.4 定义的最小规则引导 00 锚点；注入以 agent 身份为前提，无 agent 上下文不注入。DSH 宿主不提供注入预算计量 API；预算控制由 LDVH 侧承担——引导文本单一权威源，体量以固定常量承载，变更走受控提交；
- 行动前引导入口：经 `agent/pre-step` waterfall 事件（载荷 {agent, messages, turn, step, signal}）在来源定义的触发时机提供事实候选与既有行动结构路由；事件形态两版一致。

注入内容由 01 定义、注入形式与预算由 08 定义；内容须单一权威来源、逐字节一致、不复制规则正文、不成为第二规则源。

### 5.4 事件面

行动与结束事件接入下列已核验事件（形态在 DSH 0.1.2-rc.1 与 0.1.5-alpha.1 一致，源码双版对照核验 2026-09-10）：`agent/created`（emit {agent}）、`agent/session-start`（emit {agent, source}）、`agent/pre-step`（waterfall）、`agent/turn-stopping`（serial {agent, turn, signal}）、`system-prompt/assemble`（waterfall）、`session/event`（emit (session, event)，turn/end 为会话事件类型、经其载荷分发），用于承载既有行动结构路由、执行状态更新、交还处理和资源清理。工具生命周期观察可经官方 `tools/change`（emit）挂载（LDVH 当前未消费）。中断恢复共同语义由 02 定义，08 只承接宿主接入时机；终止时机无已验证原生事件，维持不接入。

### 5.5 交互面

DSH 结构化问询入口为 `ctx.userQuestions.ask(request)`（validation + scoped answerer waterfall；调用者限制 CALLER_NOT_LIVE/DELEGATED_CALLER——子代理直接问人被拒），承载 Human Gate 决策提请、计划审查与验收交还。行动授权不设独立宿主 API：由 DSH 审批通道（user-approval，ApprovalPolicy 'ask'|'never'，与沙箱三档固化联动）与 00 §4 Human 决定权组合承载。语义区分：宿主存在 `ctx.authorization` 服务，但它是凭证获取流程注册表（credential-obtaining flows），不是行动授权通道，本规范不将其作为授权入口消费。授权包结构仍待 WorkCase/授权承接规范定义。问询授权面三包源码（user-questions、user-approval、tool-ask-user）两版零变更（2026-09-10 核验）。

### 5.6 管辖登记接入

07 是登记位置、Schema、路径、权限目标、三态判定、写入与迁移规则的唯一权威；LDVH CLI、Git Gate、Skill 与 Web 统一消费其结果。08 只承接宿主接入：接入点为 `ctx.get('dshHomePath')` 服务（boot 时 provide，两版源码零 diff；宿主以 DSH_HOME 环境变量与 ~/.dsh 默认根提供，无 Electron userData 级 API），配置根为 dshHomePath 下 `ldvh/governed-projects.yaml`，跨工作区读写经该路径；宿主 ACL/沙箱结果映射为 07 的 `available` 或 `unavailable`。08 不复制 07 的 Schema 或写入规程。

## 6. 机械守护部署

- **运行时不变量**：经 DSH 正式不变量注册器 `ctx.invariants.register(packageName, installer)` 在装载完成、受控写入前和会话交还前执行来源已定义的断言（InvariantInstaller = (ctx, fail) => void|Promise，fail 抛 InvariantError code='INVARIANT' 带 packageName 归因；官方包 permission-presets 以 inject: ['invariants'] 同法消费；该入口 src 在 DSH 0.1.2-rc.1 与 0.1.5-alpha.1 字节级一致，2026-09-10 核验）；不替代 00 §3.4 三层防线。
- **文件观察策略**：经 DSH 守卫式写保护承载（如实：宿主无文件 watch 服务）：读观察经 `fs/observed` 事件；写守卫经 `writeText(target, content, {kind:'replaceIfVersion', version})` 与 `editText(..., {version})` 版本守卫，配合 `fs/write-intent` 与 `fs/edit-intent` waterfall 挂载 LDVH 策略；`fs-observation-policy` 提供 FS_NOT_OBSERVED / FS_STALE_VERSION 拒绝语义，版本或指纹不一致时拒绝写入（签名两版零变化，2026-09-10 核验）。对 07 登记载体，08 只核验宿主满足 07 已定义的跨平台原子写入、冲突拒绝与回读要求并向实现暴露结果，不复制其写入算法。
- **Git Gate 部署**：commit-msg 钩子安装到由项目 Git 根解析所得的 Git common-dir `hooks/commit-msg`，不得简单假设 `<worktree>/.git/hooks/`；主 worktree 与 linked worktree 共享同一 common-dir，独立 clone 分别部署。安装前检查既有钩子，非 LDVH 资产一律 `conflict` 且零写入，不覆盖 Human 自建钩子；部署后须确认 `managed` 状态（归属、路径、内容与版本一致），未确认不得声称已就绪；事件检查用 06 定义的同一 validator。
- **管辖项目安装事务**：Human 在设置页选择的目录必须是实际 Git 根。点击“安装”后，登记项目、创建或校验项目内 `ldvh-base/`、安装或更新当前版本 Git Hook 均为必需步骤而非选项；任一步失败都不得报告管辖已就绪。设置页不提供单独的“卸载”操作；“取消管辖”自动卸载 LDVH 托管 Hook并移除登记，但永久保留 `ldvh-base/` 与其中事实对象。每次 DSH 启动对全部登记项目执行一次只读状态检查；检查或巡检发现 Hook 过时或事实源缺失时，安装事务须能修复可修复状态（Hook `absent/outdated` 或事实源 `absent/incomplete`）；`conflict` 或 `unavailable` 属不可修复状态，事务不得对其执行写入。**上述状态的呈现形态与交互区分由 10 §6.5 定义，本文不复述**；08 只定义事务的步骤、状态闭集与失败处置。版本不一致只报告并等待 Human 点击安装/更新，不静默修改。
- **设置页写入与权限降级**：设置页按钮在空闲状态没有 Agent、call id 与开放 turn，不能复用 `ctx.approval.request()` 或模型工具的 `sandbox_permissions` 一次性升权；普通插件 Host 自动安装只受当前 OS 文件权限约束。安装先完成只读预检，确认所有目标、Hook 所有权和回滚边界后再写入；OS 拒绝写入时 fail-closed、回滚本次可安全回滚的变化，不使用 `sudo` 或管理员 PowerShell。此时可提供同一 LDVH CLI 语义的精确平台命令和 DSH Desktop 正式“打开终端”入口作为降级，macOS/Windows 仅在路径引用和终端载体上不同；用户执行后必须回到设置页重新“检查”，终端退出码不单独证明就绪。
- **权限预设与沙箱分层**：`workspace-write`（默认，工作区路径内读写与执行，无需 Human 授权）/ `danger-full-access`（跨工作区与系统级，需 Human 授权）只约束 Agent 工具调用；分层语义归 00 §3.4 的 fail-closed 授权边界与 00 §4.1 的 Human 授权决定，08 只定义宿主接入方式，AI 不得把聊天工具授权转移给设置页按钮，也不得自行扩权。

**宿主缝的消费义务（条件式）**：上列宿主缝是**可用手段**，其存在**不证明 LDVH 已受其保护**。对每一道宿主缝：**在 LDVH 实际消费该缝之前**，不得据本文主张相应防护已部署、已生效或已 fail-closed；不得把「宿主提供该缝」「提交通过」「工具调用成功」引为守卫、不变量或版本屏障已执行的证据；也不得以「宿主已有该机制」代替 LDVH 自身的消费与验证。

**逐缝的消费要求与证明边界**：

| 宿主缝 | LDVH 须做什么才算消费 | 未消费时不得主张什么 |
|---|---|---|
| `ctx.tools.register` | 经该入口注册操作并接受参数校验 | 不得主张操作已注册可用 |
| `ctx.tools.guard` | 经该入口注册单调守卫；守卫**只能拒绝、不得放行**，拒绝以返回原因表达 | 不得主张执行链对 LDVH 操作有守卫约束 |
| `ctx.invariants.register` | 经该入口部署运行时不变量断言；违规经其 `fail` 通道报告，而非返回值 | 不得主张本节所述检查时机对 LDVH 操作生效 |
| `fs/observed` 读观察 | **两半都要**：读一侧把实际读到的观察**记录并发出**（不得凭空构造版本）；写一侧经 `fs/write-intent`／`fs/edit-intent` 挂载版本守卫，且**只对已观察过的目标**主张版本 | 不得主张版本或指纹屏障已生效；仅挂一个不记录内容的监听器不算消费 |
| `ctx.userQuestions.ask` | 经该入口承载 Human Gate 决策提请；须存在**实际调用点**（提请经该入口发出），未获肯定答复时 fail-closed | 不得主张问询已经该入口；仅取到可调用引用而无人调用不算消费 |

各缝的**实际消费现状**按 01 §7.2 由读取时的观察与实现核对取得，本节不陈述其当前状态。消费补齐后须纳入 §8 的验证对象；**未纳入验证对象的防护不得被声称为已部署**。

**逐缝消费的可报告要求**：消费不是一次性声明，而是**可被读取时观察到的注册结果**。对每一道缝，实现须使「是否已消费」可由装载期诊断或等价的可读结果判定，且**未消费的缝必须与已消费的缝一同如实报告**——只报告已消费项、静默省略未消费项，等同于主张该缝已生效，为本节所禁止。判定结果只证明「该缝已注册」，不证明防护有效（见 §8「宿主缝消费」行的可证明范围）。

## 7. 发布与公共门面

### 7.1 版本号双轨制

对外发布版本 `MAJOR.MINOR.PATCH`（纯 SemVer，仅正式发布递增）；开发迭代版本同主版本 + `-dev.N`（每次开发迭代递增）。二者共享主版本、互不污染（Human 已定 D7）；发布时封存干净版本，之后 dev 进入下一轮。

### 7.2 分发渠道

DSH 插件市场（主要渠道，接受开源公共契约）/ 本地 asar 加载（开发测试与离线使用）/ 源码安装（社区贡献与自定义构建）。

### 7.3 README

README 是 DSH 插件市场的用户第一眼界面，遵循行业通用格式：项目名称与一句话定位、安装说明（市场/本地/源码）、使用指引、配置项、开源协议（MIT，与 DSH 本体同协议）、版本号。内容必须与当前版本实际能力一致，不得超前宣传未实现的功能。README 是 00 §4.3 受保护文档。

### 7.4 CHANGELOG

遵循 Keep a Changelog：条目 `## [版本] - YYYY-MM-DD`，分区 Added/Changed/Fixed/Removed/Known。每次发布对应一条；条目内容必须由实际已提交变更支撑，不得为未提交内容做记录；与 06 提交契约对齐（message 与 diff 共同支撑条目）。

### 7.5 版本声明点

CHANGELOG 版本条目、插件 manifest 版本字段、README 版本行三者共同构成 00 §4.3 的“版本声明点”受保护文档。三者版本号必须一致，漂移按停止条件处理。版本声明点的具体文件路径清单由本文登记（§7.6），登记变更须经 Human Gate。

### 7.6 受保护文档承接

00 §4.3 五类在 DSH 域的映射：00（`specs/00-理念与构成.md`）、README（`README.md`）、插件 AI 面向语义文本（经 `system-prompt/assemble` 注入的 `ldvh:minimal-guidance` 段，文本源为 `plugin/lib/guidance-text.js`）、LICENSE（`LICENSE`）、版本声明点（CHANGELOG + manifest 版本 + README 版本行）。五类修改均须先展示现有内容与准确候选、说明差异与原因，经独立审核并取得 Human 明确同意，且形成只包含相应受保护文档的独立提交（完整流程以 00 §4.3 为准）。08 不削弱其保护地位；受保护文件清单的变更须经 Human Gate。


### 7.7 Output Envelope 宿主承载

09 负责 Output Envelope 的单一生成与一致性实现；本规范只承接其在 DSH 中的存储位置、写入时机、消费方和宿主验收流映射，不定义或复制生成逻辑。核验结论（2026-09-10，源码双版对照）：宿主两版均无交还产物专用存储入口，且 0.1.5 存在两处升级陷阱（session-persistence 服务直调接口整体移除换 handle 所有权式；存储事件对白名单外类型默认拒绝，ignorable:true 为唯一逃生口）。定案（Human 2026-09-10）：Output Envelope 由 LDVH 自持久化于本地存储区（DSH home 下 `~/.dsh/ldvh/` 域，与管辖登记同级的先例承载），定位为本地记忆、与记忆系统绑定处理——载体形态、生命周期与保留策略随记忆系统设计定案；不进项目事实源目录（判据：事实对象=项目转移时跟目录走、他人接手可共享的内容，handovers 不具备），不写宿主会话事件流、不依赖 session-persistence API。宿主侧（Web）只读投影呈现（经 dshHomePath 通道）。机器承载建成前，交还维持 Human 可读正文并如实披露承载未建（按 02 §19 处理），不得声明已存在宿主承载。

## 8. 验证与证据边界

| 验证对象 | 验证时机 | 成立条件 | 可接受依据 | 验证入口 | 可证明范围 | 未满足时的处理 |
|---|---|---|---|---|---|---|
| 插件 manifest | 插件起草、发布或修改 manifest 时 | 字段完整、格式合规、与实际能力一致 | manifest 文件与 DSH 市场规范 | manifest 解析检查 | 当次身份与声明的机械完整性；不证明能力可用或授权成立 | 修复字段，不发布不一致版本 |
| 工具注册 | 插件装载后 | DSH 当前环境已实际注册目标工具 | 宿主注册观察 | 注册状态检查 | 工具面可发现（本行为 DSH 接入域验证权威；05 §10 同名行只验证 LDVH CLI 服务工具面语义）；不证明操作可调用、Human 授权或语义正确 | 未注册时按不可用交还，不伪造接入声明 |
| 引导面注入 | 会话冷启动或行动前触发时 | 注入内容与 01 §10.4 单一权威来源一致且未超 LDVH 侧常量预算 | 注入内容观察与来源比对 | 注入核对 | 当次注入范围；不证明内容正确或 AI 已遵守 | 超预算或漂移时暂停受影响注入并修复 |
| Git Gate 部署 | 部署后或宣称就绪前 | 钩子存在、`managed` 状态已确认（已安装、路径正确、版本匹配） | `.git/hooks` 观察与 managed 确认记录 | 部署状态检查 | 部署状态成立；不证明实际阻断有效或绕过不存在 | 未确认时不得声称就绪，暂停受控提交声明 |
| 权限预设 | 装载或扩权请求时 | 权限边界已声明且沙箱分层与声明一致 | manifest 权限声明与宿主沙箱观察 | 权限一致性检查 | 当次声明与分层一致；不证明越权被实际拒绝 | 不一致时拒绝执行并按 00 §7.2 交还 |
| 版本声明点 | 每次发布前 | CHANGELOG 条目、manifest 版本与 README 版本行一致 | 三处版本观察 | 版本一致性检查 | 当次版本对齐；不证明功能完整或价值成立 | 漂移时按 §10 处理，暂停发布 |
| README 一致性 | 发布或修改 README 时 | 内容与当前版本实际能力一致，无超前宣传 | README 与实际能力对照 | 内容一致性审核 | 当次声明与能力对齐；不证明功能完整或价值成立 | 修正内容，未修复前不发布 |
| CHANGELOG 条目 | 每次发布时 | 条目由实际已提交变更支撑 | CHANGELOG 条目与 06 提交链 | 条目与提交对照 | 当次条目可回指提交；不证明变更语义正确或 Human 授权 | 无提交支撑时移除条目或补齐提交 |
| 宿主缝消费 | 装载后或宣称某缝防护生效前 | §6 所列缝中，被声称已消费的每一道均已**经该缝入口实际注册**并取得 disposer；未消费的缝如实报告为未消费 | 注册调用结果与装载期诊断 | 逐缝注册状态检查（§6 逐缝消费要求表） | 当次该缝已被消费；**不证明**相应防护已生效、已 fail-closed 或覆盖全部受影响操作 | 未消费的缝不得主张其防护；按 §6 报告未消费并保留为缺口 |

机械结果与语义判断互不替代。manifest 合规、注册成功、部署确认或发布完成只能证明各自机械范围；本章不能单独证明能力可用、授权覆盖、行动允许或 V/HV 价值成立，未执行和不可用范围保留为 gaps。

## 9. Human Gate

本文不新增 00 之外的 Human Gate。

### 9.1 领域增量事项

以下事项是 00 §4.2 在 DSH 接入与发布领域的具体化：

1. 改变插件身份定位、权限声明范围或分发渠道；
2. 改变引导面注入形式或预算边界；
3. 改变 Git Gate 部署形态或沙箱分层接入方式；
4. 改变版本号双轨制或版本声明点定义；
5. 新增、删除或修改受保护文档及其登记位置（00 §4.3 与本文 §7.6）。

### 9.2 决定边界

Human 决定只证明决定及其作用范围，不替代 manifest 检查、注册核对、部署确认或版本一致性检查。

## 10. Stop Conditions

本规范不新增根停止类型。

### 10.1 领域触发与影响范围

出现以下任一情况时，按 00 §7.2 暂停受影响的最小接入、部署或发布声明范围：

1. 工具注册失败且无来源允许的分流；
2. Git Gate `managed` 状态无法确认；
3. 引导面注入超出预算或与单一权威来源不一致；
4. 版本声明点不一致（漂移）；
5. 受保护文档修改未按 00 §4.3 流程执行；
6. 准备声明环境接入完成，但 manifest、工具注册、Git Gate 或引导面未全部确认。

### 10.2 暂停期间允许动作

暂停期间只允许不越过停止边界的规则定位、只读核对、能力验证、修复与分流准备，不得继续受影响接入、部署或发布声明。

### 10.3 恢复与再次触发

恢复须与触发原因对应，且只覆盖当前依据支持的范围；同一停止条件恢复后再次触发时按 00 §7.3 进入 Human Gate。

## 11. 反过度设计红线

1. 不写通用 Hook 抽象——只针对 DSH 一个宿主；
2. 不写跨平台适配——DSH 之外的平台移植由社区完成；
3. 不写非 DSH 环境接入（决策 #11）；
4. 不写 MCP 网关（决策 #11）；
5. 工具注册仅经 DSH 正式注册入口一个缝接入，不建独立注册表；
6. 权限与沙箱直接使用 DSH 宿主机制，不建独立权限系统。
