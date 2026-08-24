# DSH 宿主能力全景卡（dsh-ldvh 平台事实备忘）

> 用途：v5 骨架 §4 机械守护 / §7 边界授权 / §8 验证交还 起草的宿主能力依据。
> 观察环境：DeepSeek Harness desktop 2.0.2（@deepseek-ai/dsh 0.1.1-rc.2），观察时间 2026-08-24。
> 证据：`/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/` 包清单与 package.json 描述、`~/.dsh/` 结构、`~/.dsh/settings.yaml`、当前会话第一手工具面。
> 性质：开发备忘，非规范、非事实对象；平台变化快，随用随核。

## 1. 宿主能力缝（ctx.* 清单，已确认存在）

| 缝 | 来源包 | 描述（原文要点） |
|---|---|---|
| `ctx.tools` | dsh-tools | 工具注册面（插件工具注册进共享 tools registry） |
| `ctx.systemPrompt.section` | dsh-system-prompt / agent-teams 实证 | 系统提示段注入（usage 段，带 order） |
| `ctx.userQuestions` | dsh-user-questions | 运行中向 Human 提问的结构化问询缝（ask_user_question 的出处） |
| `ctx.authorization` | dsh-authorization | 授权流缝：插件自有流程，经与 Human 对话取得凭据 |
| `ctx.mcpClient` | dsh-mcp-client | **MCP 客户端桥**：连接 MCP server 并把其工具注册进 ctx.tools |
| `ctx.invariants` | dsh-invariants | **运行时不变量注册表**（包自有 invariant 的 registry service） |
| `ctx.fs`（observation policy） | dsh-fs-observation-policy | fs/\* 事件门：observed-state、read-before-edit、version-guarded write/edit |
| `ctx.sessionQuery` | dsh-session-query-sqlite | 会话查询缝，SQLite FTS5 后端 |
| `ctx.compaction` | dsh-compaction（+basic/tool-result-pruner） | 上下文压缩服务缝 |
| `ctx.spillStore` | dsh-spill | 超大工具文本溢出存储，返回检索定位符 |
| `ctx.tokenMeter` | dsh-token-meter | replay-aware token 计量服务 |
| `ctx.workspaceRegistry` | dsh-workspace | 工作区实体注册表（durable workspace records，会话附着校验） |
| `ctx.goalRoundDriver` | dsh-goal-round-driver | **竞态围栏（race-fenced）的会话内目标轮驱动** |

## 2. 其余关键宿主机制

| 机制 | 来源包 | 要点 |
|---|---|---|
| 计划模式 | dsh-plan-mode | 带记录的计划模式 + 用户审查退出（+ slash 命令） |
| Isolated Session 交付流 | worktree 工具面 + dsh-client-ui-deliverables + ~/.dsh/change-ledger（v1：workspaces/worktree-claims/store-id） | 独立 worktree 创建/列表、交付验收条（worktree_ready_for_review：总结+验证证据+建议 Commit Message）、Human 批准提交/放弃、下一轮重建 |
| 目标/轮循环 | dsh-goal + dsh-goal-round-driver + dsh-command-goal + dsh-client-ui-goal | 会话内持久目标 + 自动续轮（rounds） |
| ralph 循环 | dsh-tool-ralph | 每轮全新 agent、共享工作区记忆、结构化轮次报告 |
| 子代理体系 | dsh-subagent（in-process driver/spawn/fork-in-process）+ dsh-tool-subagent-control/report | continuable（durable Session、FIFO inbox、cold resume）、fork（继承父会话已完成轮次）、interrupt、list |
| workflow | dsh-workflow（+worker-thread） | JS 编排 fan-out；agent() 前台收集；pipeline/parallel |
| 权限与沙箱 | dsh-permission-presets + dsh-sandbox（+policy/fs-sandbox/local）+ dsh-user-approval | 权限预设（workspace-write / danger-full-access）、审批策略（ask/never）、沙箱分层 |
| 变更账本 | ~/.dsh/change-ledger | 宿主级变更账本（v1：workspaces、worktree-claims、store-id） |
| 工具协议 | dsh-typert-protocol/registry/loader | 工具注册协议层 |
| 命令系统 | dsh-command-*（feedback/compact/goal）+ dsh-commands | slash 命令注册面 |
| 技能机制 | dsh-skill + dsh-skill-filesystem + dsh-skill-badge + dsh-client-ui-skill | 技能发现根（~/.agents/skills 等）、目录技能、UI 徽章 |
| 执行面 | dsh-bash-local/sandbox + dsh-tool-bash-persistent + dsh-terminal + dsh-tmux-context + dsh-pwsh-* | bash（普通/持久/沙箱）、终端、tmux 上下文 |
| 会话全栈 | dsh-session（persistence/projection/query/stats/telemetry/checkpoint-policy） | JSONL 持久化、投影、SQLite 查询、统计、OTel 遥测、检查点策略 |
| 压缩/预算控制 | dsh-spill + dsh-token-meter + dsh-output-retention + dsh-repeat-tool-reminder + dsh-timeout | 溢出、token 计量、输出保留、重复工具提醒、超时 |
| 文件引用/附件 | dsh-file-reference + dsh-attachment | 文件引用与附件 |
| 反馈 | dsh-message-feedback + dsh-command-feedback | 消息反馈 |
| 模型配置 | settings.yaml：agent-default-model、subagent-default-model、llm-pi-ai 等 | 默认模型路由配置 |
| 搜索 | dsh-web-search-deepseek + dsh-tool-web | 宿主 web 搜索 |
| 编辑器 | dsh-tool-str-replace-editor | str-replace 编辑工具 |

## 3. 对 v4 调研的遗漏清单（09.Att.05 退休卡与「深度绑定 DSH」Study 未覆盖）

1. `ctx.mcpClient`——MCP 原生消费桥（LDVH 提供 MCP server 的落点）。
2. `ctx.invariants`——运行时不变量注册表（机械守护的宿主承载）。
3. `ctx.fs` observation policy（observed-state/read-before-edit/version-guarded write）——受控写入的宿主机械层。
4. Isolated Session 交付验收流 + `~/.dsh/change-ledger` worktree-claims——Gate 2 交还的宿主原生工作流。
5. `ctx.goalRoundDriver`（race-fenced 目标轮）——WorkCase 执行循环的宿主等价物。
6. `dsh-plan-mode`（用户审查退出）——Gate 1 计划提请的宿主 UI。
7. `ctx.userQuestions` / `ctx.authorization`——Human Gate 决策提请与授权流的原生缝。
8. `ctx.compaction` / `ctx.spillStore` / `ctx.tokenMeter`——读维预算（含 CJK 感知计量落点）的宿主基础。
9. `ctx.sessionQuery`（SQLite FTS5）——会话可比性/审计的原生载体（v4 [33] 的下一步实现）。
10. ralph（fresh-agent 循环）——「自发辩证」的新鲜视角承载。
11. subagent fork（继承上下文子代理）——复核执行体的新形态（09.Att.05 观察时无此入口）。
12. 权限预设/审批策略/沙箱分层——授权边界的宿主机械层。
13. 命令系统、消息反馈、持久 bash/tmux、str-replace 编辑器等交互与执行面。

## 4. 待继续核验项

- 插件事件面在 0.1.1-rc.2 的确切清单（agent/pre-step、turn/end、agent/status、internal/service、session-start、tools/pre-execute 等逐一核对，防再有遗漏）。
- typert 协议对插件工具 schema 的约束（注册 ldvh_call 时的契约要求）。
- `~/.dsh/storages`、`dsh-pocket`、`dsh-spill-local` 的用途细节。
- dsh-desktop / settings.yaml 各配置节可开的面（如需）。

## 5. 吸收原则（配合 docs/study-absorption.md）

- 宿主原生已有且属自家平台的 → **直接用**（userQuestions、plan-mode、invariants、change-ledger、goal-round-driver、worktree 验收流、sessionQuery、compaction/spill/tokenMeter、mcpClient 等）。
- 宿主没有的 → **内部重实现**（attempt 令牌语义细节、turn/end 锁恢复语义、局部补丁、预热注入逻辑、关系图浏览）。
- 第三方技术 → **只吸收原理，零运行时依赖**。
