# 实验记录：宿主 `outputSchema` 结构化委派结果的实测行为

> **性质**：**实验记录**（只读探测，未改动任何代码或 `specs/`）。供 08 起草输入与 30 号承载评估使用。
> **日期**：2026-10-03｜**宿主**：`0.2.0-rc.2`（`dsh-v0.2.0-rc.2` / `639ed01539`）
> **问题**：LDVH 是否需要、以及能否用宿主的**结构化委派结果**（`outputSchema`）把「子代理按结构提交」从文本约定升为机械校验？
> **结论（先行）**：**能，且强度高于预期**——但**当前只有 `workflow` 的 `agent()` 钩子暴露它**，AI 直调的 `subagent` 工具**不暴露**。

---

## 1. 实验方法

用宿主自带的 `workflow` 工具（`agent(prompt, {schema})` 钩子）派出两个子代理，对**同一个 schema** 分别返回合规与故意违规的内容，观察宿主行为。

被要求的结构（object root，受支持的 JSON Schema 子集）：

```json
{"type":"object",
 "properties":{"verdict":{"type":"string","enum":["pass","fail"]},"reason":{"type":"string"}},
 "required":["verdict","reason"],"additionalProperties":false}
```

- **子代理 A**：要求返回 `verdict="pass"`、`reason="probe-conforming"`（合规）
- **子代理 B**：要求返回 `verdict="definitely-not-in-the-enum"` 且带 `unexpected_extra_field`（**故意违规**）

## 2. 实测结果（原文）

```
A → {"verdict":"pass","reason":"probe-conforming"}          // 结构化对象，直接可用
```

```
B → {"verdict":"fail",
     "reason":"Requested payload {\"verdict\": \"definitely-not-in-the-enum\", \"unexpected_extra_field\": 12345} cannot be submitted: verdict must be exactly \"pass\" or \"fail\", and additional fields are not permitted by the schema. Emitting the requested object verbatim would violate the tool contract."}
```

**关键观察**：实验脚本假设「违规子代理会返回 `null`」（即宿主拒绝整个运行）。**实际不是**——子代理 B **没能提交违规对象**（被宿主拦在提交环节），于是它在**同一 schema 内**改交了一个合规对象：`verdict="fail"` + 说明原因的 `reason`。

也就是说：**schema 不是事后过滤器，而是子代理唯一的交付出口**——不合规的数据**根本交不出来**。

## 3. 机制（源码核验）

`packages/subagent/subagent-in-process-driver/src/structured.ts` 揭示这是**三件套强制**，不是提示词约定：

| 件 | 内容 |
|---|---|
| **① 注册工具** | 在子代理**自己的作用域**注册一个名为 `structured_output` 的工具，其 `parameters` 就是调用方给的 schema（「Each child registers its real schema on its own scope, so concurrent runs do not interact」） |
| **② 强制指令** | 注册为子代理的**尾部 scoped prompt 段**（`STRUCTURED_OUTPUT_INSTRUCTION`）：「When you have your final answer, you MUST report it by calling the `structured_output` tool… **Do not finish with a plain text answer: only the tool call counts as your result.**」 |
| **③ 单调守卫** | `childCtx.tools.guard(...)` —— 「compose monotonically (deny or abstain, **never allow**)」，且「terminal result marker and monotonic tool guard **prevent later calls from reopening a completed structured run**」 |

**校验发生在工具参数层**：`validateJsonSchemaValue` 于提交时校验（故违规对象「cannot be submitted」）。

**结论：这是「宿主网关」档（底座四档中的第三档），不是 persona 自律档。**

## 4. 关键限制：能力**只**经 workflow 暴露

| 入口 | 是否可传 `outputSchema` | 证据 |
|---|---|---|
| `workflow` 的 `agent(prompt, {schema})` | **可** | 实测（本记录 §2）；`workflow-ptc/src/runtime.ts` 消费 `opts.schema`，`host.ts:233` 传 `structured` |
| `ctx.subagents.start()`（服务层） | **可** | `subagent-in-process-driver/src/index.ts:128-129` 在 `request.outputSchema !== undefined` 时挂载 |
| **`subagent` 工具（AI 直调）** | **不可** | 其模型参数面只有 `description`/`prompt`/`agentOptions`/`run_in_background`；**无 `outputSchema`/`schema` 字段**（`tool-subagent/src/index.ts`） |
| **`subagent/end` 事件** | **不透出** | `SubagentRunEndInfo` 只有 `runId`/`provider`/`id`/`local`/`stopReason`/`lastAssistantMessage` —— **无 `structured`**（`subagent/src/types.ts:100-117`）；`structured` 只见于 `SubagentResult`，由 workflow 层取用 |

**故两条用法判据**：
1. 要结构化校验，**必须经 `workflow` 扇出**（`agent({schema})`），不能用 `subagent` 工具直调。
2. 走事件监听（`subagent/end`）**拿不到** `structured`。

（另：`outputSchema: true` 是 **spawn provider** 的能力；`subagent-claude-code`/`codex` 等外部 provider 的该能力为 `false`，服务层会**显式拒绝**而非静默忽略——「fail loud, no silent degradation」。）

## 5. 对 LDVH 的直接价值

**`specs/30` §16.2** 现要求：「子代理须按**三态证据结构**提交调研结果，每项 confirmed 证据须附带**逐字摘录、来源 URL 与锚点**。子代理不得提交无来源证据，也不以推测填充缺口。」

该要求在**今天只能靠文本约定**（子代理「说」它按结构提交了，主控读文本判断）。用 `outputSchema` 可把其中**结构部分**升为机械校验：

```json
{"type":"object",
 "properties":{
   "state":{"type":"string","enum":["confirmed","uncertain","gap"]},
   "statement":{"type":"string"},
   "evidence":{"type":"object","properties":{
       "quote":{"type":"string"},"source":{"type":"string"},"anchor":{"type":"string"}},
     "required":["quote","source","anchor"]}},
 "required":["state","statement"],"additionalProperties":false}
```

**可机械保证的**（据本实验）：① 三态取值必在闭集内；② `confirmed` 项**必须**带齐 quote/source/anchor（`required`），缺项**交不出来**；③ 无多余字段。

**不能机械保证的**（须如实声明，避免夸大）：
- quote 是否**真的**逐字来自该来源（仍属主控核对）；
- source URL 是否可达、是否支持该 statement；
- `state` 判定是否**正确**（子代理仍可把推测标成 confirmed——schema 只管**它标了什么**，不管**标得对不对**）。

**即：`outputSchema` 把「结构合规」机械化，不把「证据真实」机械化。** 这与 30 号「证据可回指」「主控核对与整合」的分工相容——机械层前移一格，语义判断仍归主控。

**同源可用处**：`specs/21` §14 的复核结论七要素（对象/基线/方法/覆盖/未覆盖/发现/保证边界）同样是可结构化的固定清单；`specs/31` §8 的视角结论同理。

## 6. 本次未做 / 未证实

| # | 项 |
|---|---|
| U1 | 未实测**可续子代理**（`continuable`）路径下 `outputSchema` 的 epoch 语义（本实验走 workflow 的一次性路径） |
| U2 | 未实测**校验失败**时的 `stopReason` 取值（本实验中子代理改交了合规对象，故未触发 `error` 分支；源码注释称 provider 可以 `stopReason:'error'` 收尾） |
| U3 | 未穷举受支持的 JSON Schema 子集（只实测了 `type`/`properties`/`enum`/`required`/`additionalProperties`） |
| U4 | 未实测外部 provider（codex/claude-code）对该能力为 `false` 时的拒绝行为（只读了源码声明） |
| U5 | 未改动任何代码——本记录**仅为可复现的探测**，LDVH 侧**尚未消费**该能力 |

## 7. 复现方式

调用 `workflow` 工具，脚本体用 `agent(prompt, { schema })` 派两个子代理（一合规、一故意违规），观察返回值：合规者返回结构化对象；违规者**无法提交**其对象，只能改交 schema 内的合规对象。本次实验用的就是该路径，未写任何文件、未改任何代码。

---

**本记录为只读探测产出**：未修改 `specs/` 与 `plugin/`、未创建事实对象。
