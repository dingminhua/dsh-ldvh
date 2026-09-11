# 规范候选：LDVH 交还结构三态证据 Schema（05 §8 + 05.Att.01）

> 状态：候选（candidate）——已按 01 §11 形成，待 §12 独立对抗审核、Human 终审后受控提交。
> 本文件本身不取得规范效力；生效内容以受控提交后的 specs/05 与 specs/05.Att.01 原文为准。

---

## 1. 问题与缺口

### 1.1 根本问题

00 §7.4 规定"每次交还同时提供 Human 可读正文和机器可读 Output Envelope"，但当前规则源只有根原则，没有定义 Output Envelope 的结构字段。

这导致两个具体问题：

1. **实现无法对齐**：plugin 实现者在设计交还 envelope 时没有规范依据，DSH 宿主没有提供统一交还结构，LLM 每次返回交还时随意性较大，无法保证"两者表达同一结果"的可验证性。

2. **"已证实/未证实/残留风险"三态没有结构化锚点**：00 §7.4 说"已证实范围、未证实范围与残留风险"，但这只是自然语言描述，没有属性字段（如置信度、优先级、验证方法、溯源）——实现者无法机械区分"未证实"（还没验证）与"残留风险"（已识别为威胁）。

### 1.2 缺口来源

| 来源 | 已有内容 | 缺失 |
|---|---|---|
| 00 §7.4 | 根原则（已证实/未证实/残留风险） | 结构化字段定义 |
| 05 §8 | 共同响应语义（partial/unavailable/rejected/invalid_request/exec_error） | 三态属性字段 |
| docs/dsh-0.1.2-upgrade-survey.md §7 U-3/U-4 | 执行/审议用法草案 | 三态落地 |
| docs/execution-usage-mapping-draft.md 点 4 | 交还结构化文档设计（仅概念，无字段） | 结构化正文 |
| docs/investigation-report-dsh-deep-research.md §7.1.4 | 三态证据模型（confirmed/uncertain/gaps） | 映射至 00 §7.4 的字段适配 |

### 1.3 约束边界（必须遵守）

1. **不得修改 00 §7.4**：00 是受保护内容，只能在其声明"具体结构与承载由下位规范定义"的范围内修改下位。
2. **不得在 05 §8 中直接引入领域语义**：05 §8 已定义 `partial`/`unavailable`/`rejected`/`invalid_request`/`exec_error` 五态，这是 Helper 服务状态，区别于交还三态。两者可以正交共存，但 05 共同层不负责解释"已证实"等领域的语义。
3. **不得引入新的 Human Gate 或 Stop Conditions**：候选仅扩展现有 envelope 结构，不在 00 已有定义之外制造新的决定权或停止触发。

---

## 2. 三态证据来源对照

### 2.1 dsh-deep-research 三态 Schema（来源）

`dsh-deep-research` 的 `RESEARCHER_SCHEMA`（`src/index.ts:120-163`）定义：

| 字段 | 含义 | 子属性 |
|---|---|---|
| `confirmed` | 已证实的发现 | `conclusion`（结论），`sources`（引用 URL 列表），`confidence`（高/中/低） |
| `uncertain` | 未确定项 | `issue`（疑点描述），`reason`（原因） |
| `gaps` | 已知信息空白 | `description`（未获信息描述），`priority`（high/medium/low） |

**三态核心机制**：
- 规划代理主动声明 `coverage_gaps` → 转化为 `blind: true` 侦察任务
- 盲区被保留而不隐瞒，结果写入最终报告
- 综合代理输出末尾强制附加原始证据底稿（附录）

### 2.2 00 §7.4 已有语义（必须对齐）

> 每次交还至少包含：当前状态、判断依据与影响、已证实范围、未证实范围与残留风险、待 Human 决定的事项、继续入口。

对比分析：

| 00 §7.4 语义 | dsh-deep-research 对应 | 是否需要扩张 | 说明 |
|---|---|---|---|
| 当前状态 | `ok: true/false` | 复用 05 §8 已有 | |
| 判断依据与影响 | `sources` | 复用 05 §8 `sources` | |
| **已证实范围** | `confirmed` | 是 | 00 无置信度属性；可按最小充分原则加 `confidence`（高/中/低），与 dsh-deep-research 一致 |
| **未证实范围** | `uncertain` | 是 | 00 无疑点/原因子属性；可按最小充分原则加 `issue` + `reason` |
| **残留风险** | `gaps`（高优先级） | 是 | 00 "残留风险"≈已知可能威胁；与 dsh-deep-research "gaps=未获信息"不同：LDVH 三态的 gaps 兼含"未证实"和"已知风险"两层，需在 Schema 中区分 |
| 待 Human 决定的事项 | （无结构化字段） | 是（扩） | 需要明确结构化枚举：decision_requested / authorization_needed / confirmation_required |
| 继续入口 | `follow_up` | 复用 05 §8 `follow_up` | |

### 2.3 关键差异（不可直接照搬）

dsh-deep-research 的 `gaps` = **信息空白**（未知，不一定是风险），而 00 §7.4 的"残留风险" = **已识别的可能威胁**（已知，可能是风险）。两者语义不完全重叠。

因此，候选方案采用：

```
gaps:
  - type: "information_gap"   # 信息空白（来自 deep-research）
  - type: "residual_risk"     # 残留风险（LDVH 特有，与 00 §7.4 对齐）
```

---

## 3. 候选正文

### 3.1 新增 05.Att.01：交还 Output Envelope 三态 Schema

新建 `specs/attachments/05.Att.01-LDVH交还Envelope三态Schema.md`：

```yaml
ldvh_attachment:
  attachment_key: "handover-three-state-envelope-schema"
  attachment_id: "05.Att.01"
  parent_spec: "helper-service-contract"
  canonical_path: "specs/attachments/05.Att.01-LDVH交还Envelope三态Schema.md"
  positioning: "定义 00 §7.4 交还结构的机器可读 Output Envelope 三态字段 Schema，为 Helper 服务和主控交还提供结构化锚点"
  scope: "适用于 00 §7.4 交还结构的三态证据字段；不定义 Helper 服务状态（05 §8）、行动模板判据（04）或 Web 呈现（10）"
  basis: ["ldvh-root", "helper-service-contract"]
  fields:
    - name: "confirmed"
      description: "已证实的范围：当前交还周期内经可验证依据确认的事实、判断或结论"
      type: "array"
      items:
        - name: "statement"
          type: "string"
          required: true
          description: "已证实的具体声明或结论"
        - name: "confidence"
          type: "enum"
          enum: ["high", "medium", "low"]
          required: true
          description: "置信度：高=有多个独立来源/可机械验证；中=单一来源/可重复观察；低=单来源/待进一步验证"
        - name: "sources"
          type: "array"
          items: "string"
          required: false
          description: "可定位的溯源引用（如规范锚点、文件路径:行号、Git commit SHA、工具调用 ID）"
    - name: "uncertain"
      description: "未证实的范围：当前有疑点但无法确认、或有多个矛盾证据待裁决的事项"
      type: "array"
      items:
        - name: "issue"
          type: "string"
          required: true
          description: "疑点描述"
        - name: "reason"
          type: "string"
          required: true
          description: "未证实的原因（来源缺失/证据矛盾/超出能力范围/时间不足）"
        - name: "evidence_count"
          type: "integer"
          required: false
          description: "当前已收集的证据数量（整数，用于审计）"
    - name: "gaps"
      description: "缺口：已知的信息空白或已识别的可能威胁"
      type: "array"
      items:
        - name: "type"
          type: "enum"
          enum: ["information_gap", "residual_risk"]
          required: true
          description: "缺口类型：information_gap=信息空白（deep-research 对齐）；residual_risk=残留风险（00 §7.4 对齐）"
        - name: "description"
          type: "string"
          required: true
          description: "缺口描述"
        - name: "priority"
          type: "enum"
          enum: ["high", "medium", "low"]
          required: true
          description: "优先级：high=阻碍当前交还或决策；medium=影响完整性；low=已知但不紧急"
        - name: "blocked_scope"
          type: "string"
          required: false
          description: "因该缺口被阻塞的作用范围（自由文本，便于 Human 理解）"
    - name: "decisions_requested"
      description: "需要 Human 决定的事项（对应 00 §7.4"待 Human 决定的事项"）"
      type: "array"
      items:
        - name: "kind"
          type: "enum"
          enum: ["decision_requested", "authorization_needed", "confirmation_required"]
          required: true
          description: "决定类型"
        - name: "scope"
          type: "string"
          required: true
          description: "需要决定的作用范围"
        - name: "context"
          type: "string"
          required: true
          description: "决定所需的上下文摘要（Human 可读）"
        - name: "options"
          type: "array"
          items: "string"
          required: false
          description: "可选项（若有）"
    - name: "follow_up"
      description: "继续入口（对应 00 §7.4"继续入口"；复用 05 §8 follow_up 语义）"
      type: "object"
      properties:
        - name: "type"
          type: "enum"
          enum: ["read_more", "retry", "redirect", "human_decision", "none"]
          required: true
        - name: "pointer"
          type: "string"
          required: false
          description: "可定位的继续入口（如规范锚点、文件路径:行号、工具调用 ID、goals blocked reason 指针）"
```

### 3.2 修改 05 §8：追加三态 Schema 引用段落

在 05 §8 末尾"partial/unavailable/rejected/invalid_request 与执行错误必须可区分"之后，追加：

> **§8.5 交还三态与 Helper 服务状态的正交关系**
>
> 00 §7.4 规定每次交还必须同时提供 Human 可读正文和机器可读 Output Envelope，两者不得矛盾。Envelope 的三态证据字段（`confirmed`/`uncertain`/`gaps`）定义于 05.Att.01（三态 Schema 附件）。三态与 05 §8 的服务状态（`partial`/`unavailable`/`rejected`/`invalid_request`/`exec_error`）正交：
>
> - **服务状态**（§8）描述 Helper 服务调用层面的结果（是否完成请求范围、是否可调用）；
> - **三态证据**（Att.01）描述交还内容层面的实质性结论（已证实、未证实、缺口）。
>
> 两者独立报告，不得用服务状态代替三态，或用三态代替服务状态。Human 可读正文是三态的人类投影，两者必须表达同一结果。

---

## 4. 价值判据（补 00 §6.3）

| 价值维度 | 对应 | 预期影响 |
|---|---|---|
| V2 充分理解 | 交还有结构化字段，Human 和 AI 对"已证实/未证实/残留风险"的理解不再依赖自由文本猜测 | 减少因语义模糊导致的重复验证 |
| V5 据实判断 | 三态置信度属性（高/中/低）使证据质量显式化 | 减少"零来源声明"被当作已证实的概率 |
| HV1 决策提请清晰可决 | `decisions_requested` 结构化枚举 | Human 决定请求不再淹没在长文本中 |
| HV2 授权执行受控可续 | `gaps.residual_risk` 显式标识已知风险 | 减少风险被忽略的概率 |
| HV3 入档闭环节点可验 | 三态结构化，可回读、可审计 | 减少"声称完成但无证据"的交还 |
| V8 持续积累 | 三态可结构化沉淀为 ADR/Pitfall 的证据输入 | 减少历史决策无据可查 |

---

## 5. 与现有规范的关系

| 规范 | 关系 | 处理方式 |
|---|---|---|
| 00 §7.4 | 上位依据（受保护） | 不修改；本文在三态字段上与 §7.4 五要素逐条对齐 |
| 05 §8 | 平行正交 | 新增 §8.5 说明两者的正交关系；不修改已有五态服务状态定义 |
| 05.Att.01 | 新建承载 | 05 §3.1 无授权附件；本文新增附件需 05 §8.3 授权段落配合修改 |
| 04 行动模板 | 下游消费者 | 三态 Schema 未来可被 04 行动模板引用（如 WC 完成的证据标准）；本文不涉及，由 04 自行决定 |
| 08/10 | 实现层 | 三态 Schema 可注入 prompt；web 侧可按三态字段渲染交还卡片；本文不涉及 |

---

## 6. 待定事项（开放）

以下事项在本候选形成时未获决定，需在审核阶段确认：

| # | 待定项 | 选项 | 背景 |
|---|---|---|---|
| Q1 | `uncertain` 是否需要 `evidence_count` | 是（推荐）/ 否 | dsh-deep-research 无此字段；LDVH 的不确定性来源更复杂（规范冲突/能力不足/时间不足），证据计数可能误导 |
| Q2 | `gaps.residual_risk` 的"残留风险"定义 | 与 00 §7.4 一致（已识别可能威胁）/ 仅指高优先级缺口 | 与 00 §7.4 "残留风险"语义一致，但 00 §7.4 本身未定义边界 |
| Q3 | `decisions_requested.options` 是否必须有 | 是（Human 期望）/ 否（保持自由文本） | 选项枚举可能限制表达；若规定必须有，则增加实现负担 |
| Q4 | 05.Att.01 是否需要版本迁移机制 | 是（字段可能扩张）/ 否（最小充分） | 过度设计风险；但若 04 未来依赖三态 Schema，版本不兼容是实际问题 |
| Q5 | 三态 Schema 是否进入"规范写入"判断（00 §7.1 防自欺） | 是（结构化字段可机械检查）/ 否（仅作为描述性字段） | 影响实现层的验证密度 |

---

## 7. 审核就绪清单

以下清单在提交前必须全部满足：

| # | 条件 | 当前状态 |
|---|---|---|
| R1 | 三态字段与 00 §7.4 五要素（当前状态/依据/已证实/未证实/残留风险/待决定/继续入口）逐条对齐且无遗漏 | ✅ 已对照（§2.2） |
| R2 | 不修改受保护内容（00/CHANGELOG/受保护文档） | ✅ 仅修改 05 + 新建 05.Att.01 |
| R3 | 05.Att.01 授权段落已写入 05 §8.3 | ❌ 需配合修改 05 §8.3 |
| R4 | 三态与 05 §8 服务状态正交性说明完整 | ✅ 05 §8.5 草案已含 |
| R5 | 01 §8.3 授权附件条件满足（附件无新增规则/授权 key 唯一/父规范已登记） | ⚠️ 05.Att.01 新增，需 05 §8.3 授权段落 |
| R6 | 01 §12 十维审核已完成 | ❌ 待执行 |
| R7 | Human 终审已完成 | ❌ 待执行 |
| R8 | 规范登记（01 §8.1）已更新 | ❌ 待执行 |
| R9 | 受控提交已形成（06 受控提交契约） | ❌ 待执行 |

---

## 8. 实现示意（供审核参考，非规范正文）

以下为基于候选 Schema 的 Helper 响应 envelope 示例（仅供审核理解，不入规范）：

```json
{
  "operation_key": "handover",
  "outcome": "partial",
  "envelope": {
    "confirmed": [
      {
        "statement": "规范候选文档已起草完成，包含三态 Schema 草案",
        "confidence": "high",
        "sources": ["specs/05-Helper服务规范.md:153"]
      }
    ],
    "uncertain": [
      {
        "issue": "三态 Schema 是否需要版本迁移机制",
        "reason": "待 04 行动模板确认依赖关系",
        "evidence_count": 0
      }
    ],
    "gaps": [
      {
        "type": "residual_risk",
        "description": "05.Att.01 授权段落尚未写入 05 §8.3",
        "priority": "high",
        "blocked_scope": "附件资格不成立（R5）"
      },
      {
        "type": "information_gap",
        "description": "当前无 04 行动模板对三态 Schema 的实际依赖声明",
        "priority": "low"
      }
    ],
    "decisions_requested": [
      {
        "kind": "decision_requested",
        "scope": "05.Att.01 授权段落写入 05 §8.3",
        "context": "新建附件需要父规范明确授权；当前 05 §8.3 为空",
        "options": ["新增 05.Att.01 授权段落", "将三态 Schema 合并入 05 正文"]
      }
    ],
    "follow_up": {
      "type": "none",
      "pointer": null
    }
  }
}
```

---

## 9. 关键引用

| 引用 | 位置 | 用途 |
|---|---|---|
| 00 §7.4 | specs/00-理念与构成.md:248-253 | 上位依据；"具体结构由下位规范定义"授权 |
| 05 §8 | specs/05-Helper服务规范.md:151-176 | Helper 响应状态五态；正交性说明依据 |
| dsh-deep-research RESEARCHER_SCHEMA | `/Users/dmh2002/DshProject/dsh-deep-research/src/index.ts:120-163` | 三态来源；三态 Schema 参考 |
| docs/investigation-report-dsh-deep-research.md §7.1.4 | docs/investigation-report-dsh-deep-research.md:114 | "三态证据模型直接对应 LDVH 交还状态三态表达" |
| docs/execution-usage-mapping-draft.md 点 4 | docs/execution-usage-mapping-draft.md:45-48 | 执行用法草案对"结构化交还文档"的概念需求 |
| 01 §11/§12 | specs/01-规范模型基础规范.md:265-380 | 候选形成流程与审核要求 |
| 01 §8.3 | specs/01-规范模型基础规范.md:187-196 | 授权附件成立条件 |
