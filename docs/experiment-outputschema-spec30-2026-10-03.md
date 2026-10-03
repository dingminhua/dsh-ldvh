# 真实调研验证：`outputSchema` 承载 30 号三态证据结构的实测

> **性质**：**实验记录**（只读探测，未改动任何代码或 `specs/`）。
> **日期**：2026-10-03｜**宿主**：`0.2.0-rc.2`（`dsh-v0.2.0-rc.2` / `639ed01539`）
> **前置**：`docs/experiment-outputschema-2026-10-03.md`（同类机制的隔离探针：合规/违规对照）
> **本篇的不同**：用**真实调研任务**跑一遍，并由主控**逐条核查子代理提交的证据是否属实**——因为该调研问题（`maxDepth` 默认值）的答案为主控已知，可做真伪对照。

---

## 1. 为什么这样设计

`specs/30` §16.2 现要求：「子代理须按**三态证据结构**提交调研结果，每项 confirmed 证据须附带**逐字摘录、来源 URL 与锚点**。子代理不得提交无来源证据，也不以推测填充缺口。」

这要求今天是**文本约定**——子代理「说」它按结构提交了，主控读文本判断。本实验问：**换成 `outputSchema` 后，哪些部分真的变成机械的了？**

设计要点：调研问题选一个**主控已知答案**的（宿主源码里 `maxDepth` 的默认值），这样「结构合规」与「证据属实」可以**分开测量**——前者由宿主保证，后者只能由主控核查。

## 2. 用的 schema（严格按 30 §16.2）

```json
{"type":"object",
 "properties":{
   "state":{"type":"string","enum":["confirmed","uncertain","gap"]},
   "statement":{"type":"string"},
   "evidence":{"type":"object",
     "properties":{"quote":{"type":"string"},"source":{"type":"string"},"anchor":{"type":"string"}},
     "required":["quote","source","anchor"],"additionalProperties":false}},
 "required":["state","statement","evidence"],"additionalProperties":false}
```

## 3. 实测结果

子代理经 `structured_output` 工具提交（**不是**文本），返回：

- `state`: `confirmed`
- `statement`: 声称 `maxDepth` 默认值为 `1`，声明于 `packages/subagent/subagent/src/index.ts:202`
- `evidence.quote`: `    maxDepth: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(1).volatile(),`
- `evidence.source`: 该文件路径（另注 line 195 有 doc comment）
- `evidence.anchor`: `L202`

它还**主动**在 statement 里附了一段 `uncertain` 内容（"运行中实际生效的深度无法从源码判定"），尽管 schema 的 `state` 只有一个字段——即它把不确定项**写进了 statement**，因为该 schema 不承载「多项证据」的结构（见 §5 限制 3）。

## 4. 主控逐条核查（真伪对照）

| # | 子代理的断言 | 主控核查方式 | 结果 |
|---|---|---|---|
| 1 | `index.ts:202` 的 quote | `sed -n '202p'` 逐字比对 | ✅ **逐字一致**（含前导四空格） |
| 2 | doc comment 在 line 195 | `sed -n '195p'` | ✅ 一致（`/** Default delegation depth…defaults to 1. */`） |
| 3 | `resolveMaxDepth()` 在 `index.ts:244-250` | `sed -n '244,250p'` | ✅ 行范围准确 |
| 4 | README.md:47 述及 Plugins→Subagent 页 | `sed -n '47p'` | ✅ 内容吻合 |
| 5 | 无测试直接断言 runtime Config 默认值 | grep 该目录 | ✅ 未找到反例（仅见参数校验类断言） |
| 6 | 「运行中实际深度无法从源码判定」 | 查 profile 覆盖 | ✅ **判断准确**——本机 `cordis.patch.yml` 确无 `maxDepth` 覆盖，故源码默认即运行值，但该推论**确需读取会话外设置**才能确认 |

**六条断言全部属实。** 这是本次实验**最重要的一条发现**：结构化提交下的**证据质量可以很高**（逐字引用、精确行号、并主动区分"已证实/未证实"）。

**但必须如实指出**：这六条属实**是模型自愿做到的，不是 schema 保证的**。schema 保证的只有「quote/source/anchor 三个字符串非空且无多余字段」——它**不检查** quote 是否真在该文件该行、source 是否可达、anchor 是否有效。本次之所以全对，是因为**子代理真的去读了源码**；若它编造一个看起来合理的 quote，schema **照样放行**。

## 5. 由此确立的三条边界

### 边界 1：机械保证的是「结构合规」，不是「证据真实」

| 层次 | 谁保证 | 本实验证据 |
|---|---|---|
| 三态取值必在闭集内 | **宿主机械保证** | `enum` 由 `validateJsonSchemaValue` 于提交时校验 [前置实验已实测：违规值交不出来] |
| confirmed 项必须带 quote/source/anchor 三项非空 | **宿主机械保证** | `required` + `additionalProperties:false` |
| quote 是否**真的**逐字来自该来源 | **不保证**，属主控核对 | 本次属实，但那是模型行为 |
| source URL 是否可达、是否支持该 statement | **不保证**，属主控核对 | 同上 |
| `state` 判定是否**正确**（有无把推测标成 confirmed） | **不保证**，属主控核对 | 该子代理主动分流了不确定项，但 schema 不强制它这么做 |

**结论**：`outputSchema` 把 30 §16.2 的**形态要求**机械化，**不把证据真实性机械化**。这与 30 号「证据可回指」「主控核对与整合」「子代理完成不等于主控完成」的分工**相容**——机械层前移一格，语义判断仍归主控。**不得据本机制主张"证据已获机械保障"。**

### 边界 2：受支持的 schema 子集**表达不出条件式必填**

本实验 schema 里，`evidence` 对**所有** state 取值都必填——包括 `gap`。而 30 §16.2 的语义是**只有 confirmed 需要证据**（gap 条目按定义就是"查不到"）。**这是表达力的真实缺口**，不是设计疏忽：

- 受支持关键字：`type` / `oneOf` / `properties` / `required` / `additionalProperties` / `items` / `enum` / `const`（+ 标注）；
- **但 `oneOf` 不得与 `properties`/`required`/`additionalProperties`/`items`/`enum`/`const` 并用**（源码 `ONE_OF_SIBLING_KEYWORDS` 逐字规定），故「confirmed 分支要求 evidence、gap 分支不要求」这种**判别式**写法**无法表达**；
- 也无 `if`/`then`/`allOf`/`anyOf`（`grep` 零命中）。

**后果与处置**：schema 只能取两种近似之一——① evidence 一律必填（本实验所用，代价：gap 也要填，可能诱发编造）；② evidence 一律不必填（代价：confirmed 可能不带证据）。**推荐 ①**，并把「gap 的 evidence 字段填什么」在委派任务书里明确要求（如填 `{"quote":"","source":"","anchor":""}` 并说明无证据）——**即用委派纪律补 schema 表达力的不足，并如实声明这是纪律而非机械保证。**

### 边界 3：该 schema 只承载**单条**证据

`state`/`statement`/`evidence` 各一个字段 ⇒ **一次提交只能表达一条证据**。而 30 号一轮调研要多条证据、多来源。可改为 `items`/`array` 结构（受支持），但那会**失去"每条 confirmed 都必须带证据"的逐条强约束**——数组内元素的 `required` 仍可表达，需实测确认。

## 6. 对 30 号承载的判断（供起草使用，非结论）

**可以机械化前移的部分**：三态闭集、每项必带三项证据字段、无多余字段。
**不能前移的部分**：证据真实性、state 判定正确性、来源可达性。

**故 30 号若采用该机制，措辞须为**（示意，非候选正文）："在三态证据结构的**形态**上，LDVH 可经宿主的结构化委派机制机械保证（三态闭集、必备字段存在）；**证据真实性、来源可达性与状态判定正确性不因此获得机械保障**，仍由主控核对（§16.3）。"

## 7. 未做 / 未证实

| # | 项 |
|---|---|
| U1 | 未实测**多证据数组**形态（`items` + 逐项 `required`）是否保持同样的强制力 |
| U2 | 未实测**可续子代理**（`continuable`）路径下的 schema 行为（本次走 workflow 一次性路径） |
| U3 | 未实测校验失败时的 `stopReason`（前置实验显示子代理倾向"改交合规对象"而非失败收尾） |
| U4 | 未验证 `source` 字段填 URL 时的可达性——本次它填的是**本地路径**（任务如此），故"URL 可达性不保证"属**推断**而非实测 |
| U5 | 未穷举 schema 子集的全部边界（只验了本实验用到的构造 + `oneOf` 的兄弟关键字限制） |
| U6 | 本次子代理**证据全对**是单次样本，**不足以推断**该机制在长程/多轮委派下的证据质量 |

## 8. 复现方式

调用 `workflow` 工具，脚本内以 `agent(prompt, { schema })` 派一个调研子代理；schema 按上列 `evidenceSchema`；prompt 要求它读源码并只在能给出逐字引用+路径+行号时标 `confirmed`。收到结构化结果后，由主控用 `sed -n '<line>p'` 等**逐条核对其 quote/source/anchor**。本次即如此执行，未写任何代码、未改任何文件。

---

**本记录为只读探测产出**：未修改 `specs/` 与 `plugin/`、未创建事实对象。
