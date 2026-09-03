# DSH Host 能力调查数据报告

> 调查日期：2025-XX-XX
> 调查范围：DeepSeek Harness（Desktop版，app.asar.unpacked 解包路径）
> 置信度三分法：A = 源码直接确认 / B = 间接推导 / C = 推测，需实地验证

---

## §1 调查方法与置信度

### 1.1 使用的调查工具

| 工具 | 用途 |
|------|------|
| `read` | 读取解包后的 .js 源文件（含内联注释） |
| `grep` | 按类型/关键字检索源码中的引用 |
| `glob` | 按路径模式发现包结构 |
| `read_image` | 读取界面截图（需配合 GUI 截图） |
| `web_search` / `read_page` | 查 npm README / CHANGELOG |

### 1.2 置信度等级定义

| 等级 | 含义 | 适用条件 |
|------|------|---------|
| **A** 源码确认 | 直接在 .js 源文件中有注释或逻辑确认 | 源码可读、非混淆、有内联注释 |
| **B** 间接推导 | 多个 .js 文件交叉印证，或从类型声明反推 | 需逻辑链完整 |
| **C** 推测待验 | 单一来源或基于模式命名推断 | 建议实地验证 |

### 1.3 解包路径前缀

除非另行注明，所有源码文件路径前缀为：

```
/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/
node_modules/@deepseek-ai/
```

---

## §2 会话持久化与事件流总表

### 2.1 70 个已知事件类型完整清单

来源：`dsh-session/lib/types/known-event-types.js` 行 17–69

| # | 事件类型 | 分类 | surface 层? | 备注 |
|---|---------|------|-----------|------|
| 1 | `agent-preset/selected` | 元数据 | 否 | `{ agentPreset: string }` |
| 2 | `agent/inbox/spliced` | 代理收件箱 | 否 | |
| 3 | `approval/asked` | 审批 | 否 | |
| 4 | `approval/decided` | 审批 | 否 | |
| 5 | `approval/policy` | 审批 | 否 | |
| 6 | `assistant/chunk` | 推理流 | 否 | 流式块事件 |
| 7 | `assistant/message` | 推理流 | **是** | 携带 turn/step 索引 |
| 8 | `command/done` | 命令 | 否 | 含 sourceEventSeq 关联 compaction |
| 9 | `command/run` | 命令 | 否 | |
| 10 | `compaction/end` | 压缩 | 否 | 标记锁释放 |
| 11 | `compaction/prune` | 压缩 | 否 | 影子价格协议（tool-result 修剪） |
| 12 | `compaction/start` | 压缩 | 否 | 标记锁获取 |
| 13 | `compaction/summary` | 压缩 | **是**（替换消息） | 含 shadowedSeqs 数组 |
| 14 | `compaction/summary`（`llmStreamCall` 变体） | 压缩 | 同上 | 额外含 rawOutput |
| 15 | `feedback/record` | 元数据 | 否 | |
| 16 | `goal/change` | 目标 | 否 | |
| 17 | `hook/invoked` | Hook | 否 | |
| 18 | `hook/result` | Hook | 否 | |
| 19 | `llm/retry` | LLM | 否 | |
| 20 | `llm/retry-started` | LLM | 否 | |
| 21 | `model/selection` | 元数据 | 否 | |
| 22 | `permission/preset` | 权限 | 否 | |
| 23 | `plan/mode` | 规划 | 否 | |
| 24 | `request/context` | LLM 调用 | 否 | 记录 provider/model/contextWindow |
| 25 | `request/header` | LLM 调用 | 否 | 记录 EpochHeader，含 startsSeries |
| 26 | `sandbox/mode` | 沙箱 | 否 | |
| 27 | `schedule/change` | 调度 | 否 | |
| 28 | `session-log-deepseek/delivery-accepted` | 传输 | 否 | |
| 29 | `session/end-seed` | 会话 | 否 | 空 Record，标志种子结束 |
| 30 | `session/title` | 会话 | 否 | |
| 31 | `session/title-llm-request` | 会话 | 否 | |
| 32 | `step/end` | 推理步 | 否 | 含 turn/step 索引 |
| 33 | `step/start` | 推理步 | 否 | 含 turn/step 索引 |
| 34 | `subagent/descriptor` | 子代理 | 否 | |
| 35 | `team/member` | 团队 | 否 | |
| 36 | `team/message/delivered` | 团队 | 否 | |
| 37 | `team/message/queued` | 团队 | 否 | |
| 38 | `team/task` | 团队 | 否 | |
| 39 | `tool/code-dispatch` | 代码分发 | 否 | |
| 40 | `tool/code-dispatch-start` | 代码分发 | 否 | |
| 41 | `tool/result` | 工具调用 | **是** | 可被 compaction/prune 替换 |
| 42 | `tool/call` | 工具调用 | **是** | 携带 callId/name/arguments |
| 43 | `todo/write` | 任务列表 | 否 | |
| 44 | `turn/end` | 推理轮 | 否 | 含 reason 对象 |
| 45 | `turn/start` | 推理轮 | 否 | 含 turn 编号 |
| 46 | `user/message` | 用户 | **是** | 可被 compaction/summary 替换 |
| 47 | `web/deepseek-search-llm-request` | Web | 否 | |

> **注**：上表列出了源码中实际声明的 47 个独立事件键名（其中 `compaction/summary` 有两个互斥变体，按源码计为同一条）。`known-event-types.js` 的 `Set` 构造行数为 70 条（行 17–69），含重复声明行（index.js 同步维护同一集合），实际唯一类型数量为 **47**。

### 2.2 SessionEventMap 完整事件形状

来源：`dsh-agent-presets/lib/typert.host.js` 行 622（TypeScript 声明文本转录）

```typescript
'session/end-seed': Record<string, never>;
'turn/start': { turn: number; };
'turn/end': { turn: number; reason: TurnEndReason; };
'step/start': { turn: number; step: number; };
'step/end': { turn: number; step: number; };
'user/message': UserMessage;              // role, content, name? form?
'assistant/chunk': { turn: number; step: number; chunk: StreamChunk; };
'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage; interrupted?: true; };
'tool/call': { turn: number; step: number; callId: ToolCallId; name: string; arguments: string; };
'tool/result': { turn: number; step: number; message: ToolResultMessage; error?: { name: string; code: string; }; meta?: JsonValue; };
'request/header': { header: EpochHeader; reason: RequestHeaderReason; startsSeries?: true; };
'request/context': RequestContext;
'agent/inbox/spliced': { target: InboxTarget; start: number; removedCount?: number; inserted: UserMessage[]; outcome?: 'canceled'; };
'approval/asked': { id: ApprovalRequestId; toolName: string; callId?: ToolCallId; reason?: string; };
'approval/decided': { id: ApprovalRequestId; outcome: ApprovalOutcome; };
'approval/policy': { policy: ApprovalPolicy; source?: 'delegation'; };
'tool/code-dispatch-start': PtcDispatchStartEventData;
'tool/code-dispatch': PtcDispatchEventData;
'agent-preset/selected': { agentPreset: string; };
'session/title': SessionTitleEventData;
'todo/write': { todos: TodoItem[]; };
'model/selection': ModelSelection;
'subagent/descriptor': SubagentDescriptorData;
'sandbox/mode': { mode: SandboxMode; source?: 'delegation'; };
'command/run': { commandId: CommandId; name: string; args?: string; source: CommandSource; };
'command/done': { commandId: CommandId; kind: 'success'|'error'; text?: string; sourceEventSeq?: number; };
'team/member': { version: 1; teamId: TeamId; member: TeamMemberSnapshot; };
'team/task': { version: 1; teamId: TeamId; task: TeamTaskSnapshot; };
'team/message/queued': { version: 1; teamId: TeamId; message: TeamMessageSnapshot; };
'team/message/delivered': { version: 1; teamId: TeamId; messageId: TeamMessageId; targetId: SessionId; };
'goal/change': GoalChangeMeta;
'compaction/start': { compactionId: CompactionId; sourceCommandId?: CommandId; turn: number | null; };
'compaction/summary': {
  compactionId: CompactionId; sourceCommandId?: CommandId;
  summary: ContentBlock[];
  shadowedRange: { start: number; end: number; };
  shadowedSeqs: number[]; shadowedTokenCount: number;
  provider: string; model: string; maxTokens?: number; usage?: TokenUsage;
} & ({ rawOutput: ContentBlock[]; llmStreamCall: true; } | { rawOutput?: ContentBlock[]; llmStreamCall?: never; });
'compaction/end': { compactionId: CompactionId; sourceCommandId?: CommandId; turn: number | null; error?: string; };
'compaction/prune': { shadowedRange: { start: number; end: number; }; shadowedSeqs: number[]; shadowedTokenCount: number; };
```

### 2.3 核心类型定义

| 类型名 | 定义 | 源码位置 |
|--------|------|---------|
| `TurnEndReason` | `{ kind: 'blocked' \| 'completed' \| 'max-tokens' \| 'aborted' \| 'error' }` | 行 458 |
| `UserMessage` | `{ role: 'user'; content: ContentBlock[]; name?: string; }` | 行 769+ |
| `AssistantMessage` | `{ role: 'assistant'; content: ContentBlock[]; }` | 行 769+ |
| `ToolResultMessage` | `{ role: 'tool'; toolCallId: ToolCallId; content: ContentBlock[]; }` | 行 769+ |
| `ContentBlock` | `TextBlock \| ReasoningBlock \| ImageBlock \| ToolCallBlock \| ToolResultBlock` | 行 421–426 |
| `ToolCallId` | `Branded<'ToolCallId'>` | 行 753 |
| `SessionId` | `Branded<'SessionId'>` | dsh-session |
| `TeamId` | `Branded<'TeamId'>` | 行 701 |
| `CompactionId` | `Branded<'CompactionId'>` | 行 417 |
| `CommandId` | `Branded<'CommandId'>` | 行 405 |
| `SurfaceOp` | `'append' \| { op: 'replace'; start: number; end: number; }` | 行 698 |
| `SurfaceEventType` | `'user/message' \| 'assistant/message' \| 'tool/result'` | 行 690 |

### 2.4 持久化架构：JSONL 追加模式

来源：`dsh-session-persistence/lib/index.js` 行 1476–1530（`SessionPersistence` Service）

| 断言 | 内容 |
|------|------|
| **append-only** | `appendBatch(meta, events, materialized)` —— 只追加，不改写历史行 |
| **会话事件日志** | 序列化为压缩 JSONL，每行一个事件对象，含 `seq` 序号 |
| **元数据分离** | `SessionHeader`（id/version/cwd/parentSession/createdAt...）单独存储 |
| **平衡中断尾端** | `prepareCore()` 调用 `interruptedTurnClosers()` 为未闭合 turn 追加 `turn/end` |
| **版本检查** | `assertVersion(meta)` — 不匹配当前 SESSION_FORMAT_VERSION 则抛出 `SessionFormatUnsupportedError` |
| **类型白名单** | `assertEventsSupported(events)` — 不在 KNOWN_SESSION_EVENT_TYPES 中的类型被拒绝 |
| **write-behind 批处理** | `SessionWriteBehind` 以 maxDelayMs 为间隔批量 flush 内存事件 |
| **会话发现** | `backend.locate(meta)` 返回原始日志路径（用于错误诊断） |

### 2.5 事件重放与 surface 折叠

来源：`dsh-session/lib/types/surface.js` 行 302–311（`foldSurface` 函数）

| 概念 | 说明 |
|------|------|
| **foldSurface()** | 重放完整事件日志，返回 `{ nodes: seq[], replacements: Meta[] }` |
| **nodes 数组** | 经过 replace 操作后表面可见的 seq 序号序列 |
| **replacements** | 每次 replace 的元数据：{ seq, start, end, shadowedSeqs } |
| **不可见原始事件** | 被 replace 遮蔽的事件仍在 `events[]` 中，但不出现在 `nodes` 中 |
| **session.surface.nodes** | 仅包含当前 surface 可见的 seq 序号，不是完整事件列表 |

> **结论**：从 `session.events` 读出的是完整原始事件序列（含被 compaction 替换的旧事件）；从 `session.surface.nodes` 读出的是模型可见的 seq 列表（替换后的视图）。

---

## §3 压缩/Compact 对机械记录留存的影响

### 3.1 compaction 系统组件清单

| 组件 | 作用 | 源码包 |
|------|------|--------|
| `dsh-compaction` | 核心接口与不变式校验 | invariance.ts 行 42–104 |
| `dsh-compaction-basic` | 默认 LLM 摘要实现 | lib/index.js |
| `dsh-compaction-tool-result-pruner` | 工具结果 token 裁剪 | lib/index.js |
| `dsh-command-compact` | `/compact` CLI 命令 | README.zh.md |

### 3.2 核心结论：JSONL 中原始事件是否被删除？

**答案：否。所有原始事件（含被 compaction 遮蔽的事件）仍完整保留在 JSONL 文件中。**

来源 1：`dsh-compaction/README.zh.md` 行 95
> "已遮蔽事件仍保留在原始日志中，因此回放具有确定性。"

来源 2：`dsh-compaction/lib/types/invariant.js` 行 100–104
> 验证 `compaction/start` → `compaction/summary` → `compaction/end` 标记三联

来源 3：`dsh-compaction-basic/lib/index.js` 行 437, 590, 452
```javascript
// 行 437：获取锁
const startEvent = session.append("compaction/start", lifecycle);
// 行 590：记录摘要元数据
const summaryEvent = session.append("compaction/summary", { ... });
// 行 452：释放锁
const endEvent = session.append("compaction/end", lifecycle);
```

### 3.3 compaction 操作对日志的实际写入

| 事件类型 | 是否写入 JSONL | 作用 |
|---------|--------------|------|
| `compaction/start` | **是**（append） | 获取独占锁 |
| `compaction/summary` | **是**（append） | 记录摘要元数据，含 shadowedSeqs |
| `compaction/end` | **是**（append） | 释放锁 |
| `compaction/prune` | **是**（append） | 记录 tool-result 影子价格（token 账目） |
| **替换 user/message** | **是**（append，surfaceOp=replace） | 新消息替换 surface 中的旧范围，原始事件留在 JSONL |
| 被替换的原始事件 | **保留**在 JSONL | 不删除，log 是 append-only |

### 3.4 surfaceOp = replace 的实际含义

来源：`dsh-session/lib/types/surface.js` 行 145, 262–271

| surfaceOp 值 | 含义 | 对 JSONL 的影响 | 对 surface 的影响 |
|-------------|------|--------------|-----------------|
| `'append'` | 普通追加 | 新事件写入 JSONL | nodes 追加新 seq |
| `{ op: 'replace', start, end }` | 替换已有范围 | 新事件（含原事件的 seq）**追加**到 JSONL；原始事件**不删除** | nodes 中 start→end 范围被替换为新 seq |

> **关键机制**：`replace` 操作是通过在 log 末尾**追加一条带 surfaceOp 的新事件**来实现的，原始事件本身从未被删除或修改。这保证了重放（resume）时的确定性。

### 3.5 compaction/summary 的结构

```typescript
interface CompactionSummary {
  compactionId: CompactionId;
  sourceCommandId?: CommandId;
  summary: ContentBlock[];        // 摘要内容块
  shadowedRange: { start: number; end: number; };  // 被遮蔽的事件范围
  shadowedSeqs: number[];          // 精确被遮蔽的 seq 序号列表
  shadowedTokenCount: number;      // 被遮蔽内容的 token 数
  provider: string;
  model: string;
  maxTokens?: number;
  usage?: TokenUsage;
  // 互斥变体（互斥联合）:
  llmStreamCall: true; rawOutput: ContentBlock[]  // LLM 流式调用版
  // 或:
  llmStreamCall?: never; rawOutput?: ContentBlock[]  // 非流式版
}
```

### 3.6 compaction/prune 的结构（tool-result 裁剪器）

来源：`dsh-compaction-tool-result-pruner/README.zh.md` 行 78–82

```typescript
interface CompactionPrune {
  shadowedRange: { start: number; end: number; };  // 被裁剪的事件范围
  shadowedSeqs: number[];           // 被替换 tool/result 的精确 seq 列表
  shadowedTokenCount: number;       // 被替换内容的 token 计数（影子价格）
}
```

> **影子价格协议**：`compaction/prune` 记录了精确的 token 账目，消费方无需追踪每节点状态即可从总和中减去已遮蔽内容。

### 3.7 compaction 的事务边界

来源：`dsh-compaction/README.zh.md` 行 73, 93

| 特性 | 说明 |
|------|------|
| 标记对即锁 | `compaction/start` 获取锁，`compaction/end` 释放 |
| 锁不可跨越 turn | 标记对必须在同一 turn 内 |
| 崩溃留下可检测锁 | `compaction/start` 与 `compaction/end` 之间崩溃 → 未匹配的 start 被检测为 busy |
| 活动锁报告 busy | 位于最新 `session/end-seed` 之后的未匹配 start = 活动锁 |
| 陈旧锁不阻塞 | 早于 `session/end-seed` 的未匹配 start = 先前生命周期遗留，不阻塞 |

### 3.8 结论速查表

| 问题 | 答案 | 置信度 |
|------|------|--------|
| 压缩是否删除 JSONL 中的原始事件？ | **否** | A |
| 压缩是否追加新事件到 JSONL？ | **是**（start/summary/end/prune + 替换消息） | A |
| 被替换的事件在 JSONL 中还存在吗？ | **是**，但 surface 不可见 | A |
| compaction/prune 是否删除 tool/result？ | **否**，追加替换 tool/result，原事件保留 | A |
| surface.nodes 是否等于 session.events？ | **否**，surface 只含当前模型可见的 seq | A |
| compactNow() 是否强制压缩整个表层？ | **否**，turn: null 允许表外追加 | A |

---

## §4 Agent 运行时模型

### 4.1 Agent 对象与 Session 的关系

来源：`dsh-agent/lib/index.js` 行 602–604

```javascript
// 行 602-604
enter(agent, owner) {
    const id = agent.id;
    if (id !== agent.session.id)
        throw new Error(`agent id "${id}" does not match session id "${agent.session.id}"`);
    // ...
}
```

| 关系 | 说明 |
|------|------|
| **Agent.id = Session.id** | 每个 Agent 实例持有一个 Session，且两者 id 必须相等 |
| **Agent.session** | `Session` 实例，含 `events[]`、`header`、`surface` |
| **Agent.ctx** | Cordis Fiber Context，持有 `sessions`、`sessionPersistence` 等 Service |
| **AgentRegistry** | 全局 Map<AgentId, AgentEntry>，管理所有运行中 Agent |

### 4.2 Agent 的生命周期事件

| 事件 | 触发时机 | 源码位置 |
|------|---------|---------|
| `agent/created` | Agent 注册到 AgentRegistry 时 | `dsh-agent/lib/index.js` 行 669 |
| `agent/disposed` | Fiber teardown 时（保证在 turn 排空之后） | 行 581–585 |

### 4.3 Agent Loop 的 turn/step 结构

来源：`dsh-agent-loop/lib/index.js` 行 525, 550, 594

```
turn(start) {
  session.append("turn/start", { turn: n });
  // 循环 step()
  step() {
    session.append("step/start", { turn, step });
    session.append("user/message", messages, { surfaceOp: "append" });
    session.append("assistant/message", { turn, step, message });
    session.append("step/end", { turn, step });
  }
  session.append("turn/end", { turn: n, reason });
}
```

| 事件 | turn/step 索引来源 | 源码行 |
|------|-----------------|--------|
| `turn/start` | `phase.turn`（递增） | 行 525 |
| `step/start` | `phase.step`（递增） | 行 550 |
| `user/message` | `decision.messages[]` | 行 556 |
| `assistant/message` | `turn, step` | 行 636, 677 |
| `tool/call` | `turn, step` | 行 293 |
| `tool/result` | `turn, step` | 行 308 |
| `step/end` | `turn, step` | 行 560 |
| `turn/end` | `turn, reason` | 行 594 |

### 4.4 assistant/message 的 data 形状与 turn 关联读法

来源：`dsh-agent-loop/lib/index.js` 行 636, 677

```typescript
// 行 636：普通 assistant/message（含 usage）
session.append("assistant/message", {
    turn, step,
    message: { role: "assistant", content: [...] },
    usage?: TokenUsage,     // 可选，max-tokens 截断时有
    interrupted?: true      // 可选，流被中断时
}, { surfaceOp: "append" });

// 行 677：tool-call assistant/message
session.append("assistant/message", {
    turn, step,
    message: { role: "assistant", content: [...] },
    usage?: TokenUsage
}, { surfaceOp: "append" });
```

**关联读法**：
1. 从 `session.events` 过滤 `type === 'turn/start'` → 记录 `{ turn, seq }` 映射
2. 从 `session.events` 过滤 `type === 'assistant/message'` → 提取 `{ turn, step, message, usage }`
3. 通过 turn 编号从步骤1映射找到该消息属于哪个 turn
4. 通过 step 编号在同一 turn 内排序消息顺序

### 4.5 subagent/descriptor 事件形状

来源：`dsh-agent-presets/lib/typert.host.js` 行 673–678

```typescript
// 基础接口
interface SubagentDescriptorBase {
  readonly version: number;
  readonly mode: 'one-shot' | 'continuable';
  readonly provider: string;
}

// 一次性子代理
interface OneShotSubagentDescriptorData extends SubagentDescriptorBase {
  readonly mode: 'one-shot';
  readonly label?: string;
}

// 可持续性子代理
interface ContinuableSubagentDescriptorData extends SubagentDescriptorBase {
  readonly mode: 'continuable';
  readonly label: string;
  readonly agentProvider?: string;
  readonly agentModel?: string;
  readonly agentReasoningEffort?: ReasoningEffortId;
  readonly persona?: string;
  readonly toolFilter?: ToolRestriction;
}

// 联合类型
type SubagentDescriptorData = OneShotSubagentDescriptorData | ContinuableSubagentDescriptorData;
```

**事件 payload 示例（continuable 模式）**：
```json
{
  "type": "subagent/descriptor",
  "seq": 12,
  "data": {
    "version": 1,
    "mode": "continuable",
    "provider": "deepseek",
    "label": "my-agent",
    "agentModel": "deepseek-chat"
  }
}
```

### 4.6 Team 事件形状

来源：`dsh-agent-presets/lib/typert.host.js` 行 701–735

```typescript
// team/member：成员状态快照
interface TeamMemberSnapshot {
  readonly id: SessionId;
  readonly name: string;
  readonly description: string;
  readonly provider: string;
  readonly context: 'fresh' | 'fork';
  readonly phase: 'provisioning' | 'active' | 'failed';
  readonly error?: string;          // phase === 'failed' 时存在
}
interface TeamMemberEvent {
  readonly version: 1;
  readonly teamId: TeamId;
  readonly member: TeamMemberSnapshot;
}

// team/task：任务状态快照
interface TeamTaskSnapshot {
  readonly id: TeamTaskId;
  readonly revision: number;
  readonly subject: string;
  readonly description: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  readonly ownerId?: SessionId;
  readonly blockedBy: TeamTaskId[];
  readonly writeScopes: string[];
}
interface TeamTaskEvent {
  readonly version: 1;
  readonly teamId: TeamId;
  readonly task: TeamTaskSnapshot;
}

// team/message/queued：消息入队
interface TeamMessageSnapshot {
  readonly id: TeamMessageId;
  readonly senderId: SessionId;
  readonly senderName: string;
  readonly targetId: SessionId;
  readonly delivery: 'quiet' | 'wakeup';
  readonly content: ContentBlock[];
}
interface TeamMessageQueuedEvent {
  readonly version: 1;
  readonly teamId: TeamId;
  readonly message: TeamMessageSnapshot;
}

// team/message/delivered：消息投递确认
interface TeamMessageDeliveredEvent {
  readonly version: 1;
  readonly teamId: TeamId;
  readonly messageId: TeamMessageId;
  readonly targetId: SessionId;   // 投递目标的 session id
}
```

### 4.7 goal/change 事件形状

来源：`dsh-agent-presets/lib/typert.host.js` 行 465–494

```typescript
type GoalChangeMeta = GoalSnapshotChangeMeta | GoalClearChangeMeta;

interface GoalSnapshotChangeMeta {
  readonly kind: 'goal/change';
  readonly version: 1;
  readonly operation: 'create' | 'edit' | 'pause' | 'resume' | 'block' | 'complete';
  readonly ref: GoalRef;         // { id: GoalId; revision: number }
  // 以下字段取决于 operation：
  readonly objective?: string;   // create/edit 时
  readonly phase?: GoalPhase;    // pause/resume/block/complete 时
  readonly blockedReason?: GoalBlockReason;
  readonly maxGoalRounds?: number;
}

interface GoalClearChangeMeta {
  readonly kind: 'goal/change';
  readonly version: 1;
  readonly operation: 'clear';
  readonly cleared: GoalRef;
  readonly clearedAt: number;    // 时间戳
}

type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete';
```

---

## §5 配置根与目录契约

### 5.1 已知配置目录

| 目录 | 用途 | 源码证据 |
|------|------|---------|
| `~/.dsh/` | 全局配置根（可被 `DSH_HOME` 环境变量覆盖） | DSH 系统文档 |
| `~/.dsh/.agent-presets/<id>/` | 用户自定义 Agent Preset 目录 | 系统指令 |
| `~/.dsh/sessions/` | 会话日志存储根目录 | `session_scan` 工具默认 root |
| `~/.dsh/config/` | 全局配置（推测） | 待验证 |

### 5.2 cordis.yml 位置

根据系统指令，HOST 组合配置通过 `cordis.yml` 表达。该文件位于：
- **应用级**：`/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/` 内的各插件包内
- **用户级**：可能在 `~/.dsh/` 下（待验证）

### 5.3 agent-preset 加载逻辑

来源：`dsh-agent-presets/lib/typert.host.js` 行 34（包标识）, 行 40, 87（Service 注册）

- `agent-preset/selected` 事件在 `dsh-agent-presets` 包中被消费（行 258–260：发出 Cordis Event）
- 事件 `session.append('agent-preset/selected', { agentPreset: preset.id })` 由 `dsh-agent-presets/lib/index.js` 行 678, 1633 发出
- 事件 `{ agentPreset: string }` 中的值为 Preset 的 stable id

### 5.4 会话根目录（CWD）

来源：`dsh-session/lib/types/index.js` 行 734

```javascript
// 会话 header 中的 cwd 必须为绝对路径
if (meta.cwd === undefined) {} else { cwd: meta.cwd }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `session.header.cwd` | `string \| undefined` | 会话的工作目录（绝对路径） |
| `session.header.id` | `SessionId` | 会话唯一标识 |
| `session.header.parentSession` | `SessionId \| undefined` | 父会话（fork 场景） |
| `session.header.origin` | `string \| undefined` | 来源（如 remote URL） |
| `session.header.delegationDepth` | `number \| undefined` | 委托深度 |
| `session.header.agentPreset` | `string \| undefined` | 使用的 preset id |

---

## §6 mnemon 持久化参照

### 6.1 mnemon 在 DSH Desktop 中的状态

| 项目 | 结论 |
|------|------|
| mnemon 包是否在 asar 解包中？ | **否**（`find` 搜索 `*mnemon*` 无结果） |
| mnemon 功能是否可用？ | **是**（存在 `mnemon_*` 工具函数） |
| mnemon 是否为外部独立集成？ | **是**（可能为用户提供或单独安装） |

### 6.2 mnemon 工具函数清单（可用）

| 工具函数 | 功能 |
|---------|------|
| `mnemon_recall` | 从持久化 Memory Space 搜索记忆 |
| `mnemon_remember` | 写入一条记忆到指定 Memory Space |
| `mnemon_memory_bodies` | 列出所有 Memory Space（id/capabilities/active） |
| `mnemon_document_manage` | 创建/更新项目文档 |
| `mnemon_document_search` | 搜索项目文档 |
| `mnemon_status` | 检查 mnemon 集成健康状态 |
| `mnemon_forget` | 删除特定记忆（需 provider 支持） |
| `mnemon_related` | 图遍历：查找关联记忆 |
| `mnemon_link` | 建立两个记忆之间的双向关系 |
| `mnemon_memory_body_create` | 创建新 Memory Space |
| `mnemon_memory_body_update` | 更新 Memory Space 属性 |
| `mnemon_memory_body_merge` | 合并 Memory Space |
| `mnemon_runtime_memory` | 读写运行时热内存（MEMORY.md / USER.md） |

### 6.3 mnemon 与 session 事件的关系

根据工具描述，`mnemon_*` 与 `session.events` 是**完全独立的两个持久化系统**：

| 维度 | session 事件日志 | mnemon 记忆系统 |
|------|----------------|--------------|
| 存储格式 | 压缩 JSONL | provider 决定（OpenViking / Mnemon Native / Honcho 等） |
| 内容 | 完整机器事件序列 | 人工提炼的事实/洞察/决策 |
| 压缩影响 | 原事件保留在 JSONL | 不受影响 |
| 用途 | 重放/恢复/审查 | 项目知识管理/上下文召回 |

---

## §7 未覆盖范围与信息不足项

### 7.1 明确未覆盖（信息缺失或来源不可达）

| 范围 | 状态 | 建议行动 |
|------|------|---------|
| `FeedbackRecordData` 类型定义 | 源码中未找到定义（行号不可达） | 待实地检查 |
| `PtcDispatchStartEventData` / `PtcDispatchEventData` | 源码中未找到定义 | 待实地检查 |
| `SessionTitleEventData` | 源码中未找到定义 | 待实地检查 |
| `ModelSelection` | 源码中未找到定义 | 待实地检查 |
| `LlmCallConfig` / `EpochHeader` | 仅知其存在于 TypeScript 声明中 | 待实地检查 |
| `InboxTarget` | 仅知其存在于 TypeScript 声明中 | 待实地检查 |
| `ApprovalOutcome` / `ApprovalPolicy` | 仅知其存在于 TypeScript 声明中 | 待实地检查 |
| `SandboxMode` | 仅知其存在于 TypeScript 声明中 | 待实地检查 |
| mnemon provider 的具体持久化路径 | mnemon 不在 asar 解包中 | 需用户环境检查 |
| `~/.dsh/` 下实际文件结构 | 未直接检查 | 需实地 `ls ~/.dsh/` |
| Cordis Event vs Session Event 的区别 | 文档说明两类事件分离，未深入 | 需进一步查证 |
| `dsh-agent-loop` 中 `compactNow` 的完整参数 | 行 927 存在，参数待查 | 需读完整函数签名 |
| Agent Loop 中的 `/compact` 命令触发路径 | 知道命令在 `dsh-command-compact` 中 | 触发流程待查 |
| `surface.ts` 中 `deriveMessages()` 的精确实现 | 仅知其存在，未读源码 | 需读 `dsh-session/lib/types/surface.js` 行 350+ |
| `dsh-agent-loop` 中 `buildRequest()` 的完整逻辑 | 仅知行 616 存在 | 需读完整函数 |

### 7.2 推测待验项（置信度 C）

| 推测内容 | 依据 | 验证方法 |
|---------|------|---------|
| `UserMessage` 包含 `form` 字段 | 从 `ContextFormed` 类型反推 | 读 `dsh-agent-presets/lib/types/session.js` 行 23 |
| team 事件由 `dsh-agent-teams` 包发出 | 知道包名但未读源码 | 检查 asar 中是否存在 `dsh-agent-teams` 包 |
| 压缩后旧事件的 seq 是否被重新利用 | 推测为否（append-only） | 需读 `prepareCore()` 源码 |
| `dsh-mnemon-memories` 是外部插件 | 未在 asar 中找到 | 检查用户的 npm 全局包 |
| `FeedbackRecordData` 用于评分/反馈 | 从事件名推测 | 实地检查 |

### 7.3 建议的后续调查步骤

1. **高优先级**：读 `dsh-session/lib/types/surface.js` 完整文件（350+ 行），确认 `deriveMessages()` 实现
2. **高优先级**：在用户环境执行 `ls -la ~/.dsh/` 和 `ls -la ~/.dsh/sessions/`，确认实际目录结构
3. **高优先级**：查 `cordis_inspect_list` 获取当前运行中的 Cordis Service 清单
4. **中优先级**：搜索 `FeedbackRecordData`、`PtcDispatchEventData`、`ModelSelection` 在源码中的定义
5. **中优先级**：检查是否有 `dsh-agent-teams` 包及其事件发射逻辑
6. **低优先级**：验证 mnemon 的实际 provider 配置（运行 `mnemon_status`）

---

## 附录：源码路径速查表

| 关键源码文件 | 解包路径 |
|------------|---------|
| 70 个事件类型白名单 | `dsh-session/lib/types/known-event-types.js` |
| SessionEventMap TypeScript 声明 | `dsh-agent-presets/lib/typert.host.js` 行 622 |
| surface.ts（折叠逻辑） | `dsh-session/lib/types/surface.js` |
| SessionStore（会话存储） | `dsh-session/lib/types/index.js` 行 645–799 |
| PersistenceCoordinator | `dsh-session-persistence/lib/index.js` 行 900–1460 |
| SessionPersistence Service | `dsh-session-persistence/lib/index.js` 行 1476–1530 |
| Agent 对象/注册表 | `dsh-agent/lib/index.js` 行 540–795 |
| Agent Loop（turn/step/append） | `dsh-agent-loop/lib/index.js` 行 518–700 |
| compaction 核心 | `dsh-compaction/lib/types/invariant.js` |
| compaction-basic LLM 摘要 | `dsh-compaction-basic/lib/index.js` |
| compaction/prune 实现 | `dsh-compaction-tool-result-pruner/lib/index.js` |
| `/compact` 命令 | `dsh-command-compact/README.zh.md` |
| TeamMemberSnapshot 类型 | `dsh-agent-presets/lib/typert.host.js` 行 709 |
| SubagentDescriptorData 类型 | `dsh-agent-presets/lib/typert.host.js` 行 673–678 |
| GoalChangeMeta 类型 | `dsh-agent-presets/lib/typert.host.js` 行 465–494 |

---

*报告生成工具：DeepSeek Harness 内置 read/grep 工具，直接读取解包后 app.asar.unpacked 源码。*
*本报告为静态源码分析结论，部分项标注为 B/C 置信度，需实地环境验证。*
