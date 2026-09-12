# Trae 记忆系统实证分析（LDVH 记忆系统设计参考）

> 取证来源：本机 `/Users/dmh2002/.trae-cn/memory`（Trae CN 版真实使用数据，取证时点 2026-09-10）。样本含 LDVH 项目（dsh-ldvh）的完整记忆数据。本文档为 `docs/memory-system-design-prompt.md` 的配套实证——Trae 是继 mnemon/agent-memory/noema/sgme/Letta/Mem0 之后的**第七个样本**，也是唯一有本机真实使用数据的样本。

---

## 一、系统解剖

### 1.1 三级层次

| 层 | 文件 | 内容 | 创建方 |
|---|---|---|---|
| 全局用户画像 | `user_profile.md`（951B） | Preferences（沟通风格/工作流/简洁要求/目标结构/句式偏好）+ Tech Stack | 系统自动 |
| 项目记忆 | `projects/<路径编码>/project_memory.md` | Hard Constraints（硬约束）/ Engineering Conventions（工程惯例）/ Lessons Learned（经验教训）三分区 | 系统自动 |
| 会话记忆 | `projects/<路径编码>/<日期>/session_memory_<id>.jsonl` | 每条 JSON 记录一段消息级工作：intent（意图）→ actions（行动列表）→ outcome（结果）→ learned（学到的东西数组）+ 压缩元数据 | 系统自动 |

另有 `topics.md`（每会话的话题级长摘要，格式 `[session_id | topic_summary_time] 叙述`）、`.cleanup/` 与 `.tmp/` 维护目录。

### 1.2 组织方式

- **项目物理分目录**：目录名为路径编码（斜杠换横线）+ `--p2-` + hash 后缀（如 `-Users-dmh2002-DshProject-dsh-ldvh--p2-89e1527a5b3741ee284a`）——项目隔离是物理级的，等价于我们 scope（作用域）的物理实现版；
- **会话按日期目录**：`20260825` 至 `20260909` 共 6 个日期目录，每目录若干 `session_memory_<会话id>.jsonl`（观测样本中单文件 4~20 行）；
- **自动压缩**：`compact_summary_meta` 字段显示 `trigger: auto, mode: async`（自动、异步触发），带 `summary_digest`（摘要指纹哈希）——会话记忆按消息流式提取、自动压缩、有漂移检测的指纹。

### 1.3 会话记忆条目格式（实测样本）

```json
{
  "intent": "修复「未证实与缺口」重复渲染问题",
  "actions": ["分析重复渲染根因", "实施修复方案", "执行验证检查"],
  "outcome": "重复渲染问题已修复，pnpm run check通过，research相关契约6/6全绿，全量244/244测试用例通过，build成功",
  "learned": [
    "ResearchUncertainGapsNode同时渲染结构化三态卡片和narrative正文导致重复",
    "修复方案遵循底部/结构化最全信息为准原则",
    "narrative仅在uncertain/gaps都为空时作为兜底显示"
  ],
  "message_summary_time": "2026-09-09 03:50:41",
  "compact_summary_meta": { "trigger": "auto", "mode": "async", "summary_digest": "8f1af..." }
}
```

## 二、与 LDVH 记忆系统设计的对照

| Trae 机制 | LDVH 设计对应 | 判定 |
|---|---|---|
| `user_profile.md`（全局偏好/画像） | 本地层 preference + fact（scope: global） | ✓ 同构 |
| `project_memory.md` 三分区 | 本地层 fact/pattern/buffer（scope: project）——Hard Constraints ≈ fact（项目惯例）、Conventions ≈ pattern、Lessons ≈ buffer/Pitfall-lite | ✓ 同构（无 origin/confidence/importance 等治理字段） |
| 会话记忆 JSONL | 我们选 C 不记运行状态——但 Trae 的 learned 数组接近"空闲评审代理"的产物形态 | 部分同构 |
| 按项目物理分目录 | 本地层 scope 字段逻辑分区（storageDomain 单 key 已定） | 实现路线不同（物理 vs 逻辑），语义等价 |
| 自动异步压缩（trigger: auto） | 我们的三路触发（主控随手/空闲评审/容量维护）——Trae 是全自动（Mem0 路线），我们是人工闸门路线 | **有意分歧**：LDVH 拒绝全自动提取（根判断"AI 不可靠"） |
| 会话四元组（intent/actions/outcome/learned） | 02 §9 六入口（目标/判断/行动/结果/摩擦/反馈） | ✓ **实战印证**（见 3.3） |
| —（无晋升通道） | 晋升通道（Human 拍板 → git 事实源） | **缺失**（见 3.2） |

## 三、三个关键发现

### 3.1 反面实证：镜像问题真实发生

Trae 给 LDVH 项目记录的 Hard Constraints 中，**大量内容是 LDVH 规范源的复述**。实测样本（逐条可对照 `specs/` 原文）：

- "00 document is a protected content and requires specific modification procedures: showing existing and proposed content paragraph by paragraph + independent review + Human's explicit agreement..."（= specs/00 受保护文档条款的英译复述）
- "01 document §7 mandates unified expression framework for fixed chapters of ordinary specifications..."（= specs/01 §7 的复述）
- "Verification and Evidence Boundary chapter must include bidirectional statement that 'mechanical results and semantic judgments are not substitutes for each other'"（= 各规范验证表的通用条款复述）

**这就是"用户装了别的记忆系统后内容重复"问题的活体样本**：规范明明在 git 里（`specs/`，受控、权威、会随修订更新），Trae 又在记忆里抄了一份（无治理、不会随规范修订同步、无溯源）。后果：规范修订后记忆侧的复述**静默过时**（Trae 自己在另一条 Lesson 里也记到了类似风险："Copying root definitions from higher-level specifications into domain text creates silent divergence risks"——它意识到了，但没有机制解决）。

**LDVH 设计的解法**：受众判据门 0（不记门）——"可从 git 重新发现的信息不记为记忆"。这条实证是门 0 必要性的最直接证据。

### 3.2 反面实证：没有晋升通道的教训永远停在记忆层

Trae 的 Lessons Learned 里的真实工程坑："Using koa-connect wrapper caused ctx leaks in middleware refactoring; native Koa rewrite is required"（koa-connect 包装导致 ctx 泄漏，需原生 Koa 重写）。

按 LDVH 的受众判据这是典型的**该进 git 层的 Pitfall**（受众是项目、有证据、错了会误导未来任何 AI）。但 Trae 没有晋升通道——它永远是"这台机器这个用户的记忆"，未来会话只能靠"恰好召回"。**无治理的记忆会漏掉该沉淀的东西**——这正是两层架构 + Human 拍板晋升存在的理由。

### 3.3 正面印证：四元组与六入口同构

Trae 会话记忆的 intent → actions → outcome → learned 四元组，与 02 §9 记忆职责的六入口（**目标、判断、行动、结果、摩擦、反馈**）高度同构——商业产品实战摸出来的结构与 LDVH 规范理论结构对上了。六入口的合理性获得独立印证。

## 四、可吸收项（一条）

**learned 四元组结构**：LDVH 空闲评审代理产出经验/摩擦观察时，约束为"意图 → 做了什么 → 结果 → 学到什么"的四段结构（提示词层约束，非新字段）——产出质量比自由文本稳定，且经 Trae 实战检验。已可并入记忆系统设计的空闲评审代理协议文本。

## 五、结论

Trae 样本的价值不在机制参考（其自动化路线是 LDVH 明确不采纳的），而在**提供了两条活的反面实证**：镜像问题（支撑门 0 的必要性）与无晋升通道的教训流失（支撑两层架构的必要性）。对抗审查时这两条可直接作为"受众判据是否必要"与"晋升通道是否必要"的答辩证据。

---

*附注：本文档为普通工作文档（docs/），暂不作为 Research 事实对象——若后续需要对象化（如外部对象取证深度增加、跨行动引用需求出现），按 24 §6 准入逐条重验。取证文件均在用户本机，锚点为文件路径与格式样本。*
