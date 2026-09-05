# 调研三项目吸收定案（deep-research / socrates / industry-research）

> 性质：开发设计输入（非规范、非事实对象）。  
> 时间：2026-09。  
> 结论：三项目吸收思想，交付由 LDVH 自己的 11/25 候选稿实现，不引入任何外部黑盒插件。

---

## §1 三项目一条线

| 层级 | 项目 | 核心交付 | LDVH 调研系统位置 |
|---|---|---|---|
| 理念 | dsh-deep-research | EIG/三态证据/控制论/信息论→确定性 Schema 与停止判据 | 11 §7 三态证据 + §6 三层收敛；25 事实类型的「已证实/未证实/缺口」三态字段 |
| 流程 | dsh-socrates | 澄清+三分裁决+引用闭环+三层收敛+三保险止损 | 11 §5 入口澄清、§8 引用闭环、§6 三层收敛 |
| 机械 | dsh-industry-research | 三态编码+SHA-256 证据链+交付合同+确定性多视角+版本账本 | 25 Research 字段契约、来源/证据与关系契约、版本账本 |

演进关系：理念把"诚实与停止"具象化为 Schema；流程把 Schema 装进自适应闭环；机械把闭环结果落成可核验产物。LDVH 吸收顺序=理念→流程→机械，每层只取其与 LDVH 规范模型/事实模型/工作模型同构的机制，删去工具外壳与宿主寄生。

---

## §2 吸收清单（定案版）

### 2.1 直接吸收（8 项）

| # | 来源 | 机制 | 吸到 | 备注 |
|---|---|---|---|---|
| 1 | deep-research | 三态证据 `confirmed`/`uncertain`/`gaps` Schema | 24 §8 字段契约 + 11 §7 三态证据 | 必填结构化字段，含置信度 |
| 2 | deep-research | EIG 边际增益停止（连续零新增确认事实即停） | 11 §6 三层收敛 | 必与轮次/预算硬上限并列 |
| 3 | deep-research | 答案空间 `scope` + 维度 `dimensions` + 盲区 `coverage_gaps` | 11 §5 入口澄清 | 替代模糊"开放研究" |
| 4 | socrates | 入口澄清（≤3 问）+ plan-review 审批 | 11 §5 入口澄清 | 走 04 行动模板的预检 |
| 5 | socrates | 引用闭环（编号只对应证据库逐字片段，≤100 字） | 11 §8 引用闭环 | 引用不得超出 F4 展开 |
| 6 | socrates | 三层收敛（缺口驱动扩轮 + 轮次硬上限 + token 预算）三保险止损 | 11 §6 三层收敛 | 叠加 #2 形成"内+外"双闸 |
| 7 | industry-research | SHA-256 证据哈希链 + 版本账本（artifact 写入即追加） | 24 §10 来源与证据 + 06 提交契约 | 哈希由 Code 托管，AI 不可填 |
| 8 | industry-research | 确定性多视角（正反方 bull/bear）+ 交付合同（不全成即失败） | 11 §10 交付合同 + 24 §13 受控操作 | 多视角属 Helper 确定性动作 |

### 2.2 参考不吸收

| 来源 | 机制 | 不吸理由 |
|---|---|---|
| socrates | Pro/Flash 模型分层降本 | 属宿主成本控制，08 接入层已定；不在 11/25 重复 |
| socrates | 学术三源（arXiv/PubMed/S2） | 检索源是 Helper 实现细节，不进规范 |
| socrates | 源策展（LLM 策展子代理） | 评审属 02 复核制度，不在 11 复刻 |
| industry-research | `industry_map` / `industry_track` / `company_scan` 行业领域工具 | 是 Research 的一个领域示例，不是 11/24 的通用契约 |
| industry-research | 国民经济行业分类 taxonomy 内置表 | 领域数据，非规范来源 |
| industry-research | `ctx.researchReport` 密封引擎外挂 | 是第三方实现层；LDVH 由 09 Code 自实现 |
| deep-research | String.raw 硬编码 210 行 workflow 脚本 | 07:243 反过度设计红线禁止；改用独立模板文件 |

### 2.3 明确不吸收（红线理由）

| 来源 | 机制 | 红线依据 |
|---|---|---|
| deep-research | 整体插件（`ctx.tools` 注册 `deep_research`，`@dsh-external/dsh-deep-research` v0.1.0） | 02 §21.2 反过度设计：不引入不可控外部黑盒；吸收=思想，交付=LDVH 自实现 |
| socrates | 整体插件（`dsh1024 plugin add dsh-socrates`） | 同上；且其 workflow 脚本同样内嵌 |
| industry-research | 整体插件（`dsh-industry-research`，依赖 `dsh-base` 复合） | 同上；其 Cordis 事件 `industry-research/*` 是领域专属 |
| industry-research | 自身维护 `versions.jsonl` + 自定义 SHA-256 账本 | 06 事实源与 Git Gate 才是溯源唯一权威；不得建第二账本（03:470） |
| 全部三项目 | 单文件大插件（559 / 多文件 + 工具 + 业务模型一体） | 08 接入规范要求 Helper/工具按职责拆分；禁止复合大插件 |
| socrates | 报告自动生成最终 Markdown | 11 不规定"出报告"产物形态；24 不规定 Research 必须渲染为单文件报告 |
| industry-research | 工具自管 `industryRoot` 目录与文件后缀 | 03 不预定载体；25 字段契约不绑死目录与后缀 |
| deep-research | `researcherModel` / `plannerModel` 等模型分层入参 | 模型路由由 08 决定；调研规范不得要求调用方绑死模型 |

---

## §3 与 11/25 候选稿的映射

| 吸收项 | 11 调研系统 | 24 Research 类型 | 实现层 |
|---|---|---|---|
| 1 三态证据 Schema | §7 三态证据结构（已证实/未证实/缺口范围可区分） | §8 字段契约（confirmed/uncertain/gaps 三态必填） | Code |
| 2 EIG 零增益停止 | §6 三层收敛（与硬上限并列） | — | Helper/Code |
| 3 scope/dimensions/coverage_gaps | §5 入口澄清 | — | AI 起草 |
| 4 入口澄清 + plan-review | §5 入口澄清（走 04 预检） | — | 04 行动模板 |
| 5 引用闭环 | §8 引用闭环 | §10 来源与引用闭环 | Code |
| 6 三层收敛三保险 | §6 三层收敛（叠加 #2） | — | Code 闸门 |
| 7 SHA-256 哈希 + 版本账本 | — | §10 来源与证据（Code 托管哈希）+ §13 受控操作（写入纪律） | 06 + 09 |
| 8 确定性多视角 + 交付合同 | §10 交付合同 | §13 受控操作（不全成即失败） | Helper |

无吸收项落进"两稿都不进"区。

---

## §4 11-14 编号预留建议

01 编号表已加第 11 行（调研系统）。建议 12-14 预留给其余三个业务系统，与 11 形成完整四业务系统号段；待 Human 决定登记。

| 编号 | 规范 | 职责摘要建议（对齐 01 §8.1 格式） |
|---|---|---|
| 12 | 记忆系统规范 | 候选认识分流、效用审计、跨行动留存与召回 |
| 13 | 讨论系统规范 | 意图澄清、多视角扩散、规范/事实/价值/风险收敛为方案 |
| 14 | 遵守系统规范 | 适用规则、授权、禁止动作与未验证范围的识别与落实 |

> 本节为编号预留建议，不构成 01 §8.1 的登记变更；登记与职责摘要以 Human 决定与正式编号登记稿为准。
