# LDVH 插件深度绑定 DSH 计划

> 性质：开发设计输入，非规范、非事实对象。
> 目的：明确 LDVH 插件需要绑定的 DSH 原生能力、价值、边界与实施优先级，为最小插件替代 Skill 和后续内核建设提供依据。
> 状态：候选，待独立审核与 Human 确认。

## 1. 总体定位

LDVH 插件不是 Helper 的 UI 包装，而是以 DSH 原生形态承载四类价值交付：

1. AI 工作引导；
2. Helper 确定性执行；
3. Git 机械守护；
4. Web 信息呈现与 Human 交互。

插件深度绑定的目标不是尽可能调用更多 DSH API，而是把管辖路由、规则获取、确定性操作、权限、Human 决定、协作、验证和交还做成宿主原生体验。DSH 只提供机械承载，不取得 LDVH 规范、事实或业务语义权威。

## 2. 会话入口与管辖路由

### 2.1 会话启动

在新会话或恢复入口取得：

- Session 身份；
- 当前工作目录；
- canonical Git root；
- Git common-dir；
- DSH user-data/config 根。

调用 07 定义的管辖判定，形成会话级：

- `governed`；
- `not_governed`；
- `unavailable`。

正常情况下每个会话只判断一次并冻结作用范围：

- `not_governed`：正常使用 DSH，不增加 LDVH 机制；
- `governed`：启用 LDVH 最小规则引导和工具面；
- `unavailable`：不猜测，普通只读和诊断可继续，LDVH 受管动作 fail-closed。

具体业务是否需要事实、模板、审核、Human Gate 或受控写入，属于进入 LDVH 后的内部判断，不由管辖路由决定。外部 Git Hook 是独立事件，可按提交事件重新判定目标项目，不属于会话内重复判定。

## 3. AI 工作引导

### 3.1 system prompt 注入

绑定 DSH `systemPrompt.section` 或当前正式等价入口，在 governed 会话注入最小规则引导：

- 当前项目受 LDVH 管辖；
- 当前行动先取得适用规则和边界；
- 不从文件存在、工具成功、测试通过或提交成功推导适用、授权或整体完成；
- 信息不足时继续读取或披露缺口；
- 指向 LDVH 原生工具入口。

引导必须短小、单一来源生成、可测试，不复制规范全文、事实摘要或行动计划。

### 3.2 行动前入口

绑定 pre-step / agent-pre-step 或当前正式等价事件：

- 判断当前动作是否需要 action guidance；
- 提示主控调用规则读取工具；
- 后续可承载事实或模板候选提示。

事件触发不等于已遵守，不自动创建对象、启动完整模板或触发 Human Gate。

## 4. DSH 原生工具面

绑定正式工具注册 API（候选为 `ctx.tools.register`），为确定性能力提供结构化输入输出、权限、`may_change_state` 和错误映射。

### 4.1 第一阶段工具

管辖类：

- `resolve-governance-scope`；
- `register-governed-project`；
- `unregister-governed-project`。

规范与行动指导类：

- `read-specification-candidates`；
- `read-specification-content`；
- `resolve-action-guidance`。

公共类：

- `discover-ldvh-capabilities`；
- `precheck-git-commit`。

后续再加入事实对象读写等操作。

### 4.2 Action Context Resolver

`resolve-action-guidance` 面向当前行动问题，而非只面向文件读取。输入可包含：

```yaml
action_kind: modify_specification
target: specs/03-事实模型基础规范.md
change_kind: substantive
```

输出：

- 当前有效规范来源；
- 精确规则单元；
- 必读层级；
- Human Gate；
- Stop Conditions；
- 独立复核要求；
- 继续读取入口；
- gaps 和仍需 AI 判断的事项。

规则映射必须由规范来源定义，Code 不自创。Resolver 提供确定性规则上下文，不替代 AI 对具体适用性、授权和行动方案的语义判断，也不充当行动模板执行器。

## 5. Human 结构化交互

### 5.1 结构化问询

绑定 `ctx.userQuestions` 或正式等价入口，承载：

- 缺失信息；
- 选项取舍；
- Human Gate；
- 候选方案确认；
- 风险接受；
- 准确候选确认。

问题应携带稳定 ID、对象、作用范围、依据、选项影响、风险和推荐项。Human 回答不替代机械或语义验证。

### 5.2 授权

绑定 `ctx.authorization` 或正式等价入口，承载：

- 跨工作区访问；
- 危险权限；
- 外部副作用；
- 部署、发布和 push；
- 其它明确保留给 Human 的执行授权。

授权只覆盖明确范围，不从单次授权推导长期授权；权限不足 fail-closed。授权与 Human Gate 相关但不等价。

### 5.3 计划审查

绑定 DSH plan mode：复杂、多阶段或高影响任务可呈交计划，普通任务不默认进入计划模式。计划批准不自动覆盖计划之外的副作用；实质范围变化时重新审查。

## 6. 执行与协作原语

LDVH 使用 DSH 协作能力时遵循“默认主控直接执行，存在明确收益才升级”。

### 6.1 子代理

使用独立、继承上下文、隔离/新鲜视角、可续和中断能力，用于：

- 专项研究；
- 审议补充；
- 独立复核；
- Code/tests 分任；
- 反思对抗视角。

子代理不转移主控责任；`running` 不等于失败；代理输出不是事实对象。provider/model 应由 DSH 机械取得，不能依靠代理自报。

### 6.2 AgentTeams

只用于有明确角色、任务 DAG、多阶段依赖、持续协调、attempt/review/repair 需求的行动。Team task、attempt 和成员状态属于宿主运行状态，不自动成为 WorkCase 或事实对象。

### 6.3 Workflow

用于大量同构 fan-out、pipeline 和结构化汇总；不用于一两个普通子任务。workflow 成功只证明编排结果，不证明业务完成。

### 6.4 Goal 与 Thinking

Goal 用于同会话长目标；Thinking 用于方向发散与隔离思考。二者都是运行状态，不等同事实、ADR、Study、WorkCase 或稳定交还。

## 7. 事件系统

### 7.1 Session/agent start

- 执行会话管辖判断；
- governed 时注入最小引导；
- 初始化会话级 LDVH 路由上下文。

### 7.2 Pre-step

- 轻量提示规则解析；
- 判断是否需要 action guidance；
- 不自动完成遵守、事实召回或模板执行。

### 7.3 Turn end

候选用途：

- 检查受控操作是否缺少回读；
- 检查是否有未交还结果；
- 提供轻量反思触发信号；
- 清理运行资源。

不自动写事实，不强制每轮反思，也不把 turn-end 当作行动完成。

### 7.4 Status/task/feedback 事件

用于调度、attempt 回收、中断恢复和 Human 反馈输入。宿主状态与反馈只作运行线索或反思输入，不自动进入事实源。

## 8. 文件系统、权限与用户配置

### 8.1 文件观察

绑定 DSH 正式文件观察/编辑能力，支持：

- read-before-edit；
- 版本守卫；
- 文件身份变化；
- 冲突拒绝；
- 原子替换；
- 写后回读。

### 8.2 Sandbox 与授权

使用 DSH workspace-write / danger-full-access 或当前正式权限模型；AI 不自行扩权。权限结果、Human 授权与 LDVH 语义 Gate 不互相替代。

### 8.3 user-data/config

通过 DSH/Electron 正式 API 取得用户配置根，承载 07 定义的：

```text
<DSH user config>/ldvh/governed-projects.yaml
```

需覆盖 macOS、Windows、Linux、ACL、锁、同目录临时文件、原子 replace 与失败映射。08 只核验宿主接入，07 保持 Schema 和判定语义唯一权威，09 实现并测试。

## 9. Git 机械守护

### 9.1 Git Hook

部署 commit-msg Git Gate：

- 与 `precheck-git-commit` 使用同一 validator；
- 观察 Index、diff、message、trailer 与 candidate paths；
- 核对 `snapshot_identity`；
- 非 passed 阻断；
- 不允许 `--no-verify`；
- push 仍需 Human 单独授权。

Git Gate 只执行来源已定义的机械规则，不判断语义正确、授权合理或整体完成。

## 10. Web 与侧边栏

### 10.1 Web 路由与组件

后续绑定插件 Web 路由与组件，用于：

- 四层阅读器；
- 管辖登记和项目切换；
- 规范/事实呈现；
- 结构化问询、计划、授权和 Human Gate；
- 验收交还；
- unavailable/fail-closed 呈现。

Web 不解析第二份规则或事实，不以页面呈现证明事实、授权或验证成立。

### 10.2 Sidebar

使用文件/页面侧边栏打开精确规范、差异、事实对象和本地 Web 页面；展示只提供消费入口，不取得语义权威。

## 11. 模型路由信息

通过 DSH `session.models` 或未来正式工具机械取得当前执行的 provider/model，用于：

- 协同回报来源；
- Git 签名；
- 事实 change_log；
- 模型质量对照。

不得依赖提示词自报、部署默认值或用主控模型覆盖协同执行者的实际模型。

## 12. 轨迹与摩擦分析

DSH transcript、event log、FTS、审批链、tool call/result、token 和模型路由只用于只读摩擦分析：

- 重复调用；
- 重试与中断；
- 审批摩擦；
- token 成本；
- 工具 call/result 配对；
- 模型路由质量。

过程数据不是事实源，不自动写入事实对象，不保存隐藏推理，不建立统一健康分；分析结果先作为反思候选。

## 13. 实施优先级

### 13.1 近期优先计划：插件外壳与 Web 接入闭环

近期先完成 LDVH 的 DSH 原生插件外壳、Web 迁移和宿主接入闭环，再在该基础上接入规则引导、Action Context Resolver、事实能力与其它治理内核。

#### 13.1.1 插件身份

- 注册到 DSH 的插件 ID 固定使用 `dsh-ldvh`，避免与其它项目或通用名称冲突；
- 项目名称继续使用 **LD Vibe Harness**，简称 **LDVH**；
- manifest、插件管理、主界面 Tab、Sidebar 和发布产物必须使用一致的插件身份，不得混用 `ldvh`、目录名或其它临时 ID 代替正式注册 ID。

#### 13.1.2 插件设置面板

参考 DSH 现有插件的设置表达方式，至少提供：

1. 默认管辖文件位置：
   - 支持手工输入；
   - 提供“浏览…”入口；
   - 明确绝对路径要求、留空时的默认位置和最终解析位置；
   - 具体配置对象是管辖文件目录还是完整文件路径，必须以 07 的唯一语义为准，不在插件中建立第二套管辖定义；
2. Web 前端端口；
3. Web 后端端口；
4. 端口合法性、前后端端口冲突和占用检查；
5. 只有配置发生变化且输入有效时才允许保存；
6. 配置改变后明确提示需要重启服务，或提供直接重启入口。

#### 13.1.3 Web 前后端生命周期

插件加载后默认自动启动 LDVH Web 前端和后端，并由插件统一管理生命周期：

- 防止重复启动；
- 区分 `starting`、`running`、`stopped` 和 `failed`；
- 分别保留前端、后端的运行状态和最近失败原因；
- 使用设置面板配置的端口；
- 端口变化后经重启生效；
- 插件关闭、停用或卸载时清理其管理的进程与资源；
- 自动启动失败必须诚实显示，不得把进程创建成功等同于服务可访问。

开发服务器、生产静态资源服务及现有启动脚本的取舍，应先调查 v4 实现和同级 `subagent` 项目的正式做法，再决定迁移方式。

#### 13.1.4 主界面 LDVH 呈现（会话区视图，与 trajectory 同构）

在 DSH 会话区注册 `conversation.view` 视图 tab（id: `ldvh`，list/session 作用域），与 chat/trajectory 并列，点击后在会话 body 呈现 LDVH Web：

- 提供加载中状态；
- 页面可访问时显示 LDVH Web（iframe 同源 `/ldvh/`）；
- 页面不可访问时显示明确错误态，不允许只呈现空白页面；
- 错误态至少显示当前地址、服务状态、可观察的失败原因和“重试”入口；
- 引导 Human 到插件管理或插件设置中启用服务；
- 视图 tab 不自行维护第二套服务状态；
- 会话作用域：视图随会话切换，遵循与 trajectory 相同的呈现语义（Human 确认：LDVH 呈现与 thinking/context/trajectory 同类的会话区呈现，而非全屏浮层或独立 Tab 栏）。

#### 13.1.5 插件设置与服务控制（方案 A：复用宿主 webServer）

插件设置面板承载管辖项目登记管理、默认管辖配置存放目录与 Web 路由开关；Web 服务复用宿主 `webServer`（前缀路由 `/ldvh` 与 `/ldvh/api`），零独立端口：

- 显示：Web 路由启用状态、实际访问地址（`http://<host>:<webServer 端口>/ldvh/`）、路由注册状态、最近失败原因；
- 管辖项目登记/取消/默认项目按 07 规范原子写与回读；
- 默认管辖配置存放目录默认 DSH 用户配置根下 `ldvh/`（经正式路径 API 解析，不硬编码）；
- 操作：启用 / 停用 Web 路由（即时注销/重注册）；
- 配置错误、路由冲突和页面不可达的区别提示；
- 自动启动是插件加载即注册路由（默认行为），Human 可停用或重启。

#### 13.1.6 呈现方式决策记录

LDVH 主界面呈现经 Human 确认与 thinking/context/trajectory 同类的**会话区呈现**：

- 不使用独立端口驱动的主界面 Tab（§13.1.4 已改为 `conversation.view` 视图 tab）；
- 不使用 Sidebar 入口 + 全屏浮层方案（早期候选已废弃）；
- 视图随会话走，遵循与 trajectory 相同的呈现语义。

#### 13.1.7 同级 subagent 项目对照

插件工程、管理和发布相关实现先学习同级 `subagent` 项目，并按同等要求对齐：

- 插件目录与 manifest；
- Cordis Host/Client 组成；
- 配置 Schema 和设置面板；
- 服务生命周期与资源清理；
- 主界面 Tab 和 Sidebar 注册；
- 构建、打包、本地加载与发布；
- 插件启停、升级和错误呈现；
- 测试、版本及发布门面。

对照结果只作为当前 DSH 能力和工程做法的证据，不取得 LDVH 领域规范权威。

#### 13.1.8 v4 Web 迁移

Web 代码先从 v4 完整迁入，建立可运行基线，再按 v5 调整：

1. 定位 v4 Web 前端、后端、共享代码、资源、启动命令、依赖和测试；
2. 保留原代码结构与行为，优先处理依赖、路径、构建和 DSH 宿主适配；
3. 迁移阶段不顺手重写业务或提前实施 v5 语义变化；
4. 验证前端、后端和关键页面能够在插件管理的端口上启动并访问；
5. 形成与 v4 的差异清单；
6. 后续每项 v5 调整回指当前规范和确认后的设计，不从 Code 反向创造规则。

吸收顺序继续遵守第 14 章：直接复用优先，其次提取适配、保留算法重写边界、明确废弃，最后才从零重写。

#### 13.1.9 实施顺序与完成条件

按以下顺序推进：

1. 调查同级 `subagent` 插件及发布结构；
2. 定位和盘点 v4 Web；
3. 核验 DSH 当前版本的设置、Tab、Sidebar、服务生命周期与资源加载正式接口；
4. 建立注册 ID 为 `dsh-ldvh` 的插件工程骨架；
5. 完整迁入 v4 Web 并建立可运行基线；
6. 实现设置面板与配置持久化；
7. 实现自动启动、停止和重启；
8. 接入主界面 LDVH Tab；
9. 接入 Sidebar；
10. 验证正常启动、插件重载、手动停止、重启、端口改变、端口冲突、前后端失败、页面不可达和插件关闭清理。

近期计划只有在上述入口和生命周期形成可验证闭环后才算完成。插件可见、子进程已创建、页面曾成功打开或单次构建通过，都不能单独证明该计划完成。

### P0：最小插件替代 Skill

1. 会话启动管辖判断；
2. governed 会话最小规则引导；
3. DSH 原生工具注册；
4. action guidance；
5. 规范候选与内容读取；
6. capability discovery；
7. not_governed 零干扰；
8. unavailable fail-closed。

### P1：机械闭环

1. 文件观察；
2. user-data；
3. 权限；
4. precheck；
5. Git Gate；
6. provider/model 机械读取；
7. Human 问询与授权。

### P2：协作与执行

1. 子代理；
2. AgentTeams；
3. Workflow；
4. Goal；
5. Thinking；
6. turn-end/status/feedback。

### P3：事实与 Web

1. 事实对象读写；
2. ADR/Pitfall 等类型召回；
3. 反思与沉淀；
4. 四层阅读器；
5. 效用分析。

## 14. v4 吸收纪律

实现每一项插件能力前，先定位 v4 对应规范、Code、tests、样例、问题记录和提交；实现选择顺序为：

```text
直接复用
→ 提取并适配
→ 保留算法、重写边界
→ 明确废弃
→ 最后才从零重写
```

优先吸收规范读取、Helper 请求闭集、Git/Index 检查、指纹、CAS、安全扫描、错误模型、测试边界等已验证机械核心；不恢复 v4 旧规范权威、向上遍历、旧字段/状态机/生命周期或过度合规机制。

## 15. 最小插件完成条件

在不依赖 Skill 的情况下：

1. not_governed 项目正常使用 DSH，无额外干扰；
2. governed 项目会话启动后获得最小规则引导；
3. unavailable 不被猜成 governed 或 not_governed；
4. “修改某个 spec”能得到当前有效的必要规则、精确来源和缺口；
5. 普通代码改动不触发完整治理流程；
6. 插件不复制规范正文，不建立第二规则源；
7. 插件关闭或能力不可用时有诚实降级；
8. user-data 与路径处理具备跨平台测试；
9. 规范读取吸收 v4 已验证算法和边界；
10. 对照验证确认后，现有 LDVH Skill 可退役删除。
